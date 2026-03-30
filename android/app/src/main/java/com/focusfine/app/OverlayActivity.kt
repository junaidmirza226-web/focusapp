package com.focusfine.app

import android.content.Intent
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
import com.focusfine.app.db.Payment
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class OverlayActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "OverlayActivity"
    }

    private lateinit var lockedPackage: String
    private lateinit var appName: String
    private var isStrictMode = false
    private lateinit var paymentManager: PaymentManager
    private val coroutineScope = CoroutineScope(Dispatchers.Main)
    private var isProcessing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_overlay)

        lockedPackage = intent.getStringExtra("LOCKED_PACKAGE") ?: ""
        appName = intent.getStringExtra("APP_NAME")?.takeIf { it.isNotEmpty() } ?: lockedPackage
        isStrictMode = intent.getBooleanExtra("STRICT_MODE", false)

        // Show app name in the lock message
        findViewById<TextView>(R.id.lock_message).text =
            "You've reached your daily limit for $appName."

        // Payment buttons section
        val paymentSection = findViewById<LinearLayout>(R.id.payment_section)
        val strictBanner = findViewById<TextView>(R.id.strict_mode_banner)

        if (isStrictMode) {
            paymentSection.visibility = View.GONE
            strictBanner.visibility = View.VISIBLE
        } else {
            strictBanner.visibility = View.GONE
            setupPaymentButtons()
        }

        // Close button always visible
        findViewById<Button>(R.id.btn_close).setOnClickListener { goHome() }

        paymentManager = PaymentManager(this)
        paymentManager.setPurchaseListener { success, payment ->
            if (success && payment != null) {
                showSuccessScreen(payment)
            } else {
                isProcessing = false
                Toast.makeText(this, "Payment failed. Please try again.", Toast.LENGTH_SHORT).show()
            }
        }
        paymentManager.restorePurchases()
    }

    private fun setupPaymentButtons() {
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
            val unlockCount = db.paymentDao().getUnlockCountToday(lockedPackage, todayStart)

            launch(Dispatchers.Main) {
                val multiplier = (unlockCount + 1).coerceAtMost(3) // cap at 3×

                // Quick unlock: base $1, escalates to $2/$3
                val quickPrice = multiplier
                val extendedPrice = multiplier * 5
                val dailyPrice = multiplier * 20

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
                            paymentManager.launchPurchaseFlow(this@OverlayActivity, PaymentManager.QUICK_UNLOCK_SKU, lockedPackage)
                        }
                    }
                }

                findViewById<Button>(R.id.btn_extended_unlock).apply {
                    text = "Pay \$$extendedPrice.00 — 1 hour"
                    setOnClickListener {
                        if (!isProcessing) {
                            isProcessing = true
                            paymentManager.launchPurchaseFlow(this@OverlayActivity, PaymentManager.EXTENDED_UNLOCK_SKU, lockedPackage)
                        }
                    }
                }

                findViewById<Button>(R.id.btn_daily_pass).apply {
                    text = "Pay \$$dailyPrice.00 — Full day"
                    setOnClickListener {
                        if (!isProcessing) {
                            isProcessing = true
                            paymentManager.launchPurchaseFlow(this@OverlayActivity, PaymentManager.DAILY_PASS_SKU, lockedPackage)
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
        paymentManager.disconnect()
    }
}
