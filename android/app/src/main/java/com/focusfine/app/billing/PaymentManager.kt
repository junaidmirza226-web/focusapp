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
                    querySkuDetails()
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

    private fun querySkuDetails() {
        val skuList = listOf(QUICK_UNLOCK_SKU, EXTENDED_UNLOCK_SKU, DAILY_PASS_SKU)
        val params = SkuDetailsParams.newBuilder()
            .setSkusList(skuList)
            .setType(BillingClient.SkuType.INAPP)
            .build()

        billingClient?.querySkuDetailsAsync(params) { billingResult, skuDetailsList ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                Log.d(TAG, "SKU details queried successfully: ${skuDetailsList?.size ?: 0} items")
                skuDetailsList?.forEach { sku ->
                    Log.d(TAG, "SKU: ${sku.sku} - ${sku.price}")
                }
            } else {
                Log.e(TAG, "Failed to query SKU details: ${billingResult.debugMessage}")
            }
        }
    }

    fun launchPurchaseFlow(activity: Activity, skuId: String) {
        val queryParams = SkuDetailsParams.newBuilder()
            .setSkusList(listOf(skuId))
            .setType(BillingClient.SkuType.INAPP)
            .build()

        billingClient?.querySkuDetailsAsync(queryParams) { billingResult, skuDetailsList ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && !skuDetailsList.isNullOrEmpty()) {
                val skuDetails = skuDetailsList[0]
                val flowParams = BillingFlowParams.newBuilder()
                    .setSkuDetails(skuDetails)
                    .build()

                billingClient?.launchBillingFlow(activity, flowParams)
                Log.d(TAG, "Billing flow launched for SKU: $skuId")
            } else {
                Log.e(TAG, "Failed to query SKU details for purchase: ${billingResult.debugMessage}")
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
            val packageName = getPurchasePackageName(purchase.sku)
            val (amount, durationMinutes) = getPriceAndDuration(purchase.sku)

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

            Log.d(TAG, "Purchase recorded in database: SKU=${purchase.sku}, Amount=\$$amount")
            purchaseListener?.invoke(true, payment)
        } catch (e: Exception) {
            Log.e(TAG, "Error processing purchase in database", e)
            purchaseListener?.invoke(false, null)
        }
    }

    private fun getPurchasePackageName(skuId: String): String {
        // This would be set dynamically based on which app was locked
        // For now, return a placeholder
        return "locked_app_package"
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
            .setProductType(BillingClient.SkuType.INAPP)
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
