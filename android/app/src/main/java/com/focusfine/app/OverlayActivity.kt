package com.focusfine.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import android.content.Intent
import android.util.Log
import com.focusfine.app.billing.PaymentManager
import com.focusfine.app.db.Payment
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class OverlayActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "OverlayActivity"
    }

    private lateinit var packageName: String
    private lateinit var paymentManager: PaymentManager
    private val coroutineScope = CoroutineScope(Dispatchers.Main)
    private var isProcessing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_overlay)

        packageName = intent.getStringExtra("LOCKED_PACKAGE") ?: "Social Media"

        val messageView = findViewById<TextView>(R.id.lock_message)
        messageView.text = "Daily limit reached for $packageName"

        // Initialize PaymentManager
        paymentManager = PaymentManager(this)
        paymentManager.setPurchaseListener { success, payment ->
            if (success && payment != null) {
                Toast.makeText(
                    this,
                    "Unlocked for ${payment.unlockDurationMinutes} minutes!",
                    Toast.LENGTH_LONG
                ).show()
                Log.d(TAG, "Purchase successful: \$${payment.amount}")
                finish()
            } else {
                Toast.makeText(this, "Payment failed. Please try again.", Toast.LENGTH_SHORT).show()
                isProcessing = false
            }
        }

        // Quick Unlock Button ($1 for 15 min)
        findViewById<Button>(R.id.btn_pay).apply {
            text = "Pay \$1.00 for 15 min"
            setOnClickListener {
                if (!isProcessing) {
                    isProcessing = true
                    Log.d(TAG, "Launching payment flow for Quick Unlock")
                    paymentManager.launchPurchaseFlow(
                        this@OverlayActivity,
                        PaymentManager.QUICK_UNLOCK_SKU
                    )
                }
            }
        }

        // Extended Unlock Button ($5 for 1 hour)
        findViewById<Button>(R.id.btn_extended_unlock).apply {
            visibility = android.view.View.VISIBLE
            text = "Pay \$5.00 for 1 hour"
            setOnClickListener {
                if (!isProcessing) {
                    isProcessing = true
                    Log.d(TAG, "Launching payment flow for Extended Unlock")
                    paymentManager.launchPurchaseFlow(
                        this@OverlayActivity,
                        PaymentManager.EXTENDED_UNLOCK_SKU
                    )
                }
            }
        }

        // Daily Pass Button ($20 for 24 hours)
        findViewById<Button>(R.id.btn_daily_pass).apply {
            visibility = android.view.View.VISIBLE
            text = "Pay \$20.00 for 24 hours"
            setOnClickListener {
                if (!isProcessing) {
                    isProcessing = true
                    Log.d(TAG, "Launching payment flow for Daily Pass")
                    paymentManager.launchPurchaseFlow(
                        this@OverlayActivity,
                        PaymentManager.DAILY_PASS_SKU
                    )
                }
            }
        }

        // Close App Button
        findViewById<Button>(R.id.btn_close).setOnClickListener {
            goHome()
        }

        // Restore any pending purchases on startup
        paymentManager.restorePurchases()
    }

    private fun goHome() {
        val startMain = Intent(Intent.ACTION_MAIN)
        startMain.addCategory(Intent.CATEGORY_HOME)
        startMain.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        startActivity(startMain)
        finish()
    }

    override fun onBackPressed() {
        // Disable back button to prevent bypass
        // User must either pay or close the app
    }

    override fun onDestroy() {
        super.onDestroy()
        paymentManager.disconnect()
    }
}
