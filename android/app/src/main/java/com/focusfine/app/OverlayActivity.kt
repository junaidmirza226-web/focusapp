package com.focusfine.app

import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.focusfine.app.billing.PaymentManager
import com.focusfine.app.db.BlockReason
import com.focusfine.app.db.Payment
import com.focusfine.app.db.UnlockScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class OverlayActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "OverlayActivity"

        @Volatile
        private var billingDisabledForProcess = false
    }

    private lateinit var lockedPackage: String
    private lateinit var appName: String
    private var isStrictMode = false
    private var blockReason = BlockReason.USAGE_LIMIT
    private var blockEndsAt: Long? = null
    private var unlockScope = UnlockScope.REASON_ONLY
    private var paymentManager: PaymentManager? = null
    private val coroutineScope = CoroutineScope(Dispatchers.Main)
    private var isProcessing = false
    private var purchasesUnavailable = false
    private val timeFormatter = SimpleDateFormat("hh:mm a", Locale.getDefault())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        overridePendingTransition(0, 0)
        setContentView(R.layout.activity_overlay)

        // Show over lock screen if phone is locked
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }

        handleIntent(intent)

        // Close button always visible
        findViewById<Button>(R.id.btn_close).setOnClickListener { goHome() }

        if (!isStrictMode) {
            initializePaymentManager()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        overridePendingTransition(0, 0)
        setIntent(intent)
        handleIntent(intent)
        if (!isStrictMode && paymentManager == null && !purchasesUnavailable) {
            initializePaymentManager()
        }
    }

    private fun handleIntent(intent: Intent) {
        lockedPackage = intent.getStringExtra("LOCKED_PACKAGE") ?: ""
        appName = intent.getStringExtra("APP_NAME")?.takeIf { it.isNotEmpty() } ?: lockedPackage
        isStrictMode = intent.getBooleanExtra("STRICT_MODE", false)
        blockReason = parseBlockReason(intent.getStringExtra("BLOCK_REASON"))
        unlockScope = parseUnlockScope(intent.getStringExtra("UNLOCK_SCOPE"))
        val endsAt = intent.getLongExtra("BLOCK_ENDS_AT", -1L)
        blockEndsAt = if (endsAt > 0L) endsAt else null

        val lockTitle = findViewById<TextView>(R.id.lock_title)
        val lockMessage = findViewById<TextView>(R.id.lock_message)
        val reasonHint = findViewById<TextView>(R.id.block_reason_hint)

        when (blockReason) {
            BlockReason.TIME_BLOCK -> {
                lockTitle.text = "Barrier Active"
                lockMessage.text = "$appName is closed inside this protected time window."
                reasonHint.visibility = View.VISIBLE
                reasonHint.text = if (blockEndsAt != null) {
                    "Available again at ${timeFormatter.format(Date(blockEndsAt!!))}"
                } else {
                    "Time block is active"
                }
            }
            BlockReason.USAGE_LIMIT -> {
                lockTitle.text = "Allowance Spent"
                lockMessage.text = "Today's allowance for $appName is gone."
                reasonHint.visibility = View.GONE
            }
        }

        // Payment buttons section
        refreshLockModeUi()
    }

    private fun initializePaymentManager() {
        if (billingDisabledForProcess) {
            purchasesUnavailable = true
            refreshLockModeUi()
            return
        }

        // Billing v5.1.0 throws on Android 14+ due dynamic receiver flag requirements.
        // Keep lock flow fast and reliable: disable purchase init for this process.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            billingDisabledForProcess = true
            purchasesUnavailable = true
            Log.w(
                TAG,
                "Skipping billing init on Android 14+; lock screen remains active without purchases"
            )
            refreshLockModeUi()
            return
        }

        try {
            val manager = PaymentManager(this)
            paymentManager = manager
            manager.setPurchaseListener { success, payment ->
                if (success && payment != null) {
                    showSuccessScreen(payment)
                } else {
                    isProcessing = false
                    Toast.makeText(this, "Payment failed. Please try again.", Toast.LENGTH_SHORT).show()
                }
            }
            setupPaymentButtons()
            manager.restorePurchases()
        } catch (t: Throwable) {
            billingDisabledForProcess = true
            purchasesUnavailable = true
            paymentManager = null
            Log.e(TAG, "Billing unavailable; keeping lock screen active without purchases", t)
            refreshLockModeUi()
        }
    }

    private fun refreshLockModeUi() {
        val paymentSection = findViewById<LinearLayout>(R.id.payment_section)
        val strictBanner = findViewById<TextView>(R.id.strict_mode_banner)

        when {
            isStrictMode -> {
                paymentSection.visibility = View.GONE
                strictBanner.visibility = View.VISIBLE
                strictBanner.setTextColor(Color.parseColor("#EF4444"))
                strictBanner.text = "Strict Mode is active.\nUnlock stays disabled until this rule clears."
            }
            purchasesUnavailable -> {
                paymentSection.visibility = View.GONE
                strictBanner.visibility = View.VISIBLE
                strictBanner.setTextColor(Color.parseColor("#F59E0B"))
                strictBanner.text = "Unlock purchases are unavailable on this device.\nThe barrier will stay in place."
            }
            else -> {
                paymentSection.visibility = View.VISIBLE
                strictBanner.visibility = View.GONE
            }
        }
    }

    private fun setupPaymentButtons() {
        val manager = paymentManager ?: return

        // Query how many times the user has already unlocked this app today
        // to apply escalating prices: 1st=$1, 2nd=$2, 3rd=$3
        coroutineScope.launch(Dispatchers.IO) {
            val db = FocusFineApp.database
            val todayStart = java.util.Calendar.getInstance().apply {
                set(java.util.Calendar.HOUR_OF_DAY, 0)
                set(java.util.Calendar.MINUTE, 0)
                set(java.util.Calendar.SECOND, 0)
                set(java.util.Calendar.MILLISECOND, 0)
            }.timeInMillis
            val unlockCount = db.paymentDao().getUnlockCountTodayForReason(
                lockedPackage,
                blockReason.name,
                todayStart
            )

            launch(Dispatchers.Main) {
                val multiplier = (unlockCount + 1).coerceAtMost(3) // cap at 3×
                val (baseQuick, baseExtended, baseDaily) = when (blockReason) {
                    BlockReason.TIME_BLOCK -> Triple(3, 12, 40) // stricter pricing ladder
                    BlockReason.USAGE_LIMIT -> Triple(1, 5, 20)
                }

                val quickPrice = baseQuick * multiplier
                val extendedPrice = baseExtended * multiplier
                val dailyPrice = baseDaily * multiplier

                val escalationNote = if (unlockCount > 0)
                    "Unlock #${unlockCount + 1} today — price increases!" else ""

                if (escalationNote.isNotEmpty()) {
                    findViewById<TextView>(R.id.escalation_note).apply {
                        text = escalationNote
                        visibility = View.VISIBLE
                    }
                }

                findViewById<Button>(R.id.btn_pay).apply {
                    text = "Pay \$$quickPrice.00 — 15 min"
                    setOnClickListener {
                        if (!isProcessing) {
                            isProcessing = true
                            manager.launchPurchaseFlow(
                                activity = this@OverlayActivity,
                                productId = PaymentManager.QUICK_UNLOCK_SKU,
                                lockedPackage = lockedPackage,
                                blockReason = blockReason,
                                unlockScope = unlockScope,
                                quotedAmount = quickPrice.toDouble()
                            )
                        }
                    }
                }

                findViewById<Button>(R.id.btn_extended_unlock).apply {
                    text = "Pay \$$extendedPrice.00 — 1 hour"
                    setOnClickListener {
                        if (!isProcessing) {
                            isProcessing = true
                            manager.launchPurchaseFlow(
                                activity = this@OverlayActivity,
                                productId = PaymentManager.EXTENDED_UNLOCK_SKU,
                                lockedPackage = lockedPackage,
                                blockReason = blockReason,
                                unlockScope = unlockScope,
                                quotedAmount = extendedPrice.toDouble()
                            )
                        }
                    }
                }

                findViewById<Button>(R.id.btn_daily_pass).apply {
                    text = "Pay \$$dailyPrice.00 — Full day"
                    setOnClickListener {
                        if (!isProcessing) {
                            isProcessing = true
                            manager.launchPurchaseFlow(
                                activity = this@OverlayActivity,
                                productId = PaymentManager.DAILY_PASS_SKU,
                                lockedPackage = lockedPackage,
                                blockReason = blockReason,
                                unlockScope = unlockScope,
                                quotedAmount = dailyPrice.toDouble()
                            )
                        }
                    }
                }
            }
        }
    }

    /** Shows a brief success screen for 3 seconds before dismissing. */
    private fun showSuccessScreen(payment: Payment) {
        val successView = findViewById<LinearLayout>(R.id.success_section)
        val mainView = findViewById<LinearLayout>(R.id.lock_content)
        val durationText = when {
            payment.unlockDurationMinutes >= 1440 -> "Full day"
            payment.unlockDurationMinutes >= 60 -> "${payment.unlockDurationMinutes / 60} hour"
            else -> "${payment.unlockDurationMinutes} minutes"
        }
        findViewById<TextView>(R.id.success_message).text =
            "$appName unlocked for $durationText"

        mainView.visibility = View.GONE
        successView.visibility = View.VISIBLE

        Log.d(TAG, "Purchase successful: \$${payment.amount} for $durationText")

        // Auto-dismiss after 2.5 seconds
        Handler(Looper.getMainLooper()).postDelayed({ finish() }, 2500)
    }

    private fun parseBlockReason(raw: String?): BlockReason {
        return try {
            BlockReason.valueOf(raw ?: BlockReason.USAGE_LIMIT.name)
        } catch (_: IllegalArgumentException) {
            BlockReason.USAGE_LIMIT
        }
    }

    private fun parseUnlockScope(raw: String?): UnlockScope {
        return try {
            UnlockScope.valueOf(raw ?: UnlockScope.REASON_ONLY.name)
        } catch (_: IllegalArgumentException) {
            UnlockScope.REASON_ONLY
        }
    }

    private fun goHome() {
        startActivity(
            Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_HOME)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        finish()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Prevent bypass via back button — user must pay or go home
    }

    override fun onDestroy() {
        super.onDestroy()
        paymentManager?.disconnect()
    }
}
