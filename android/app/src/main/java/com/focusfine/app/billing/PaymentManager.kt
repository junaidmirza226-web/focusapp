package com.focusfine.app.billing

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.*
import com.focusfine.app.FocusFineApp
import com.focusfine.app.db.Payment
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Manages Google Play Billing integration for in-app purchases
 * Compatible with Google Play Billing Library v5.1+
 */
class PaymentManager(private val context: Context) {

    companion object {
        private const val TAG = "PaymentManager"
        const val QUICK_UNLOCK_SKU = "quick_unlock_15min" // $1.00
        const val EXTENDED_UNLOCK_SKU = "extended_unlock_1hour" // $5.00
        const val DAILY_PASS_SKU = "daily_pass_unlimited" // $20.00
    }

    private var billingClient: BillingClient? = null
    private val coroutineScope = CoroutineScope(Dispatchers.Main)
    private var purchaseListener: ((Boolean, Payment?) -> Unit)? = null
    private var currentLockedPackage = ""

    init {
        setupBillingClient()
    }

    private fun setupBillingClient() {
        billingClient = BillingClient.newBuilder(context)
            .setListener(::onPurchasesUpdated)
            .enablePendingPurchases()
            .build()

        billingClient?.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    Log.d(TAG, "Billing client setup successful")
                    queryProductDetails()
                } else {
                    Log.e(TAG, "Billing setup failed: ${billingResult.debugMessage}")
                }
            }

            override fun onBillingServiceDisconnected() {
                Log.d(TAG, "Billing service disconnected, attempting reconnect")
                setupBillingClient()
            }
        })
    }

    private fun queryProductDetails() {
        val productList = listOf(QUICK_UNLOCK_SKU, EXTENDED_UNLOCK_SKU, DAILY_PASS_SKU)
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(productList.map { productId ->
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(productId)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            })
            .build()

        billingClient?.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                Log.d(TAG, "Product details queried successfully: ${productDetailsList?.size ?: 0} items")
                productDetailsList?.forEach { product ->
                    Log.d(TAG, "Product: ${product.productId} - ${product.oneTimePurchaseOfferDetails?.formattedPrice}")
                }
            } else {
                Log.e(TAG, "Failed to query product details: ${billingResult.debugMessage}")
            }
        }
    }

    fun launchPurchaseFlow(activity: Activity, productId: String, lockedPackage: String = "") {
        currentLockedPackage = lockedPackage
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(productId)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            ))
            .build()

        billingClient?.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && !productDetailsList.isNullOrEmpty()) {
                val productDetails = productDetailsList[0]

                // INAPP (one-time) purchases do NOT use offerToken — that is subscriptions only
                val productDetailsParamsList = listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(productDetails)
                        .build()
                )

                val flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(productDetailsParamsList)
                    .build()

                billingClient?.launchBillingFlow(activity, flowParams)
                Log.d(TAG, "Billing flow launched for product: $productId")
            } else {
                Log.e(TAG, "Failed to query product details for purchase: ${billingResult.debugMessage}")
                purchaseListener?.invoke(false, null)
            }
        }
    }

    private fun onPurchasesUpdated(
        billingResult: BillingResult,
        purchases: MutableList<Purchase>?
    ) {
        when (billingResult.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                if (!purchases.isNullOrEmpty()) {
                    coroutineScope.launch {
                        for (purchase in purchases) {
                            handlePurchase(purchase)
                        }
                    }
                }
            }

            BillingClient.BillingResponseCode.USER_CANCELED -> {
                Log.d(TAG, "User cancelled the purchase flow")
                purchaseListener?.invoke(false, null)
            }

            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
                Log.d(TAG, "Item already owned")
                restorePurchases()
            }

            else -> {
                Log.e(TAG, "Purchase failed with response code: ${billingResult.responseCode}")
                purchaseListener?.invoke(false, null)
            }
        }
    }

    private suspend fun handlePurchase(purchase: Purchase) {
        try {
            // Verify the purchase signature server-side before granting access
            if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
                val isValid = verifyPurchaseWithBackend(purchase)

                if (isValid) {
                    // Acknowledge the purchase
                    val acknowledgePurchaseParams = AcknowledgePurchaseParams.newBuilder()
                        .setPurchaseToken(purchase.purchaseToken)
                        .build()

                    billingClient?.acknowledgePurchase(acknowledgePurchaseParams) { result ->
                        if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                            Log.d(TAG, "Purchase acknowledged successfully")
                            coroutineScope.launch {
                                processPurchaseInDatabase(purchase)
                            }
                        }
                    }
                } else {
                    Log.e(TAG, "Purchase verification failed - purchase token invalid")
                    purchaseListener?.invoke(false, null)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error handling purchase", e)
            purchaseListener?.invoke(false, null)
        }
    }

    private suspend fun verifyPurchaseWithBackend(purchase: Purchase): Boolean {
        // TODO: Implement backend verification
        // This would call your backend API to verify the purchase token with Google Play
        // For MVP, we'll do local verification only
        return !purchase.purchaseToken.isNullOrEmpty() && purchase.isAcknowledged.not()
    }

    private suspend fun processPurchaseInDatabase(purchase: Purchase) {
        try {
            val productId = purchase.products.firstOrNull() ?: ""
            val packageName = getPurchasePackageName(productId)
            val (amount, durationMinutes) = getPriceAndDuration(productId)

            val payment = Payment(
                packageName = packageName,
                amount = amount,
                unlockDurationMinutes = durationMinutes,
                unlockedAt = System.currentTimeMillis(),
                expiresAt = System.currentTimeMillis() + (durationMinutes * 60 * 1000),
                purchaseToken = purchase.purchaseToken
            )

            val db = FocusFineApp.database
            db.paymentDao().insert(payment)

            // Update preferences
            val prefs = FocusFineApp.preferences
            prefs.totalSpentToday += amount

            Log.d(TAG, "Purchase recorded in database: productId=$productId, Amount=\$$amount")
            purchaseListener?.invoke(true, payment)
        } catch (e: Exception) {
            Log.e(TAG, "Error processing purchase in database", e)
            purchaseListener?.invoke(false, null)
        }
    }

    private fun getPurchasePackageName(skuId: String): String {
        return currentLockedPackage
    }

    private fun getPriceAndDuration(skuId: String): Pair<Double, Int> {
        return when (skuId) {
            QUICK_UNLOCK_SKU -> Pair(1.0, 15) // $1 for 15 minutes
            EXTENDED_UNLOCK_SKU -> Pair(5.0, 60) // $5 for 1 hour
            DAILY_PASS_SKU -> Pair(20.0, 1440) // $20 for 24 hours
            else -> Pair(0.0, 0)
        }
    }

    fun restorePurchases() {
        billingClient?.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP)
            .build()) { billingResult, purchases ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                Log.d(TAG, "Restored ${purchases.size} purchases")
                coroutineScope.launch {
                    for (purchase in purchases) {
                        if (!purchase.isAcknowledged) {
                            handlePurchase(purchase)
                        }
                    }
                }
            }
        }
    }

    fun setPurchaseListener(listener: (Boolean, Payment?) -> Unit) {
        this.purchaseListener = listener
    }

    fun disconnect() {
        billingClient?.endConnection()
    }
}
