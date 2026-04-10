package com.focusfine.app

import android.app.AppOpsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.accessibility.AccessibilityManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val USAGE_ACCESS_PERMISSION_CODE = 100
        private const val OVERLAY_PERMISSION_CODE = 101
        private const val NOTIFICATION_PERMISSION_CODE = 102
        private const val ACCESSIBILITY_PERMISSION_CODE = 103
    }

    private lateinit var webView: WebView
    private lateinit var loadingOverlay: View
    @Volatile
    private var isWebAppReady = false
    @Volatile
    private var isPageContentVisible = false
    private var splashDeadlineElapsed = 0L
    private var activationPulseIndex = 0
    private val activationPulseScheduleMs = longArrayOf(0L, 900L, 2200L, 4200L)
    private val activationPulseRunnable = object : Runnable {
        override fun run() {
            announceActivationStateChanged()
            activationPulseIndex += 1
            if (activationPulseIndex >= activationPulseScheduleMs.size) return

            val previousAt = activationPulseScheduleMs[activationPulseIndex - 1]
            val nextAt = activationPulseScheduleMs[activationPulseIndex]
            webView.postDelayed(this, (nextAt - previousAt).coerceAtLeast(0L))
        }
    }
    private val activationStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            scheduleActivationPulses()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Install the splash screen before super.onCreate so it shows immediately
        splashDeadlineElapsed = SystemClock.elapsedRealtime() + 8_000L
        installSplashScreen().setKeepOnScreenCondition {
            !isWebAppReady && SystemClock.elapsedRealtime() < splashDeadlineElapsed
        }
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        loadingOverlay = findViewById(R.id.loading_overlay)
        webView.alpha = 0f
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            @Suppress("SetJavaScriptEnabled")
            allowFileAccessFromFileURLs = true
        }
        webView.setBackgroundColor(Color.BLACK)
        webView.webViewClient = object : WebViewClient() {
            override fun onPageCommitVisible(view: WebView?, url: String?) {
                super.onPageCommitVisible(view, url)
                Log.d(TAG, "WebView content committed: $url")
                isPageContentVisible = true
                revealWebAppIfReady()
            }
        }

        // Register the JavaScript bridge — React calls window.Android.*
        webView.addJavascriptInterface(
            FocusFineJavascriptInterface(this, this),
            "Android"
        )

        webView.loadUrl("file:///android_asset/index.html")
    }

    fun markWebAppReady() {
        isWebAppReady = true
        Log.d(TAG, "Web app reported ready")
        revealWebAppIfReady()
    }

    private fun revealWebAppIfReady() {
        if (!::webView.isInitialized || !::loadingOverlay.isInitialized) return
        if (!isWebAppReady || !isPageContentVisible) return
        runOnUiThread {
            webView.alpha = 1f
            loadingOverlay.visibility = View.GONE
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
        refreshProtectionState()
        scheduleActivationPulses()
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(ActivationStateNotifier.ACTION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(activationStateReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(activationStateReceiver, filter)
        }
    }

    override fun onPause() {
        if (::webView.isInitialized) {
            webView.removeCallbacks(activationPulseRunnable)
        }
        webView.onPause()
        webView.pauseTimers()
        super.onPause()
    }

    override fun onStop() {
        runCatching {
            unregisterReceiver(activationStateReceiver)
        }
        super.onStop()
    }

    private fun refreshProtectionState() {
        val onboardingComplete = FocusFineApp.preferences.isOnboardingComplete
        if (onboardingComplete && hasCorePermissions()) {
            ensureMonitoringServiceIfEligible()
        }
    }

    private fun hasUsageAccessPermission(): Boolean {
        return try {
            val appOps = getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                packageName
            )
            mode == AppOpsManager.MODE_ALLOWED
        } catch (e: Exception) { false }
    }

    private fun requestUsageAccessPermission() {
        Toast.makeText(this, "Please enable Usage Access for FocusFine", Toast.LENGTH_LONG).show()
        startActivityForResult(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS), USAGE_ACCESS_PERMISSION_CODE)
    }

    private fun hasOverlayPermissionGranted(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(this) else true
    }

    private fun requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            startActivityForResult(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:$packageName")),
                OVERLAY_PERMISSION_CODE
            )
        }
    }

    private fun hasNotificationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        } else true
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ActivityCompat.requestPermissions(this, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_CODE)
        }
    }

    fun hasAccessibilityServiceEnabled(): Boolean {
        val am = getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        val enabledServices = am.getEnabledAccessibilityServiceList(
            android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK
        )
        return enabledServices.any {
            it.resolveInfo.serviceInfo.packageName == packageName &&
            it.resolveInfo.serviceInfo.name == FocusFineAccessibilityService::class.java.name
        }
    }

    private fun requestAccessibilityService() {
        Toast.makeText(
            this,
            "Enable FocusFine in Accessibility Settings to enforce app locks",
            Toast.LENGTH_LONG
        ).show()
        startActivityForResult(
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS),
            ACCESSIBILITY_PERMISSION_CODE
        )
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == NOTIFICATION_PERMISSION_CODE) {
            refreshProtectionState()
            announceActivationStateChanged()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        // onResume fires automatically after returning from settings, continuing the permission sequence
    }

    fun hasCorePermissions(): Boolean {
        return hasUsageAccessPermission() &&
            hasOverlayPermissionGranted() &&
            hasAccessibilityServiceEnabled()
    }

    fun ensureMonitoringServiceIfEligible(): Boolean {
        if (!FocusFineApp.preferences.isOnboardingComplete || !hasCorePermissions()) {
            return false
        }
        val serviceIntent = Intent(this, UsageMonitorService::class.java)
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            true
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to ensure UsageMonitorService is active", t)
            false
        }
    }

    private fun announceActivationStateChanged() {
        if (!::webView.isInitialized) return
        webView.post {
            webView.evaluateJavascript(
                "window.dispatchEvent(new Event('focusfine:activation'));",
                null
            )
        }
    }

    private fun scheduleActivationPulses() {
        if (!::webView.isInitialized) return
        webView.removeCallbacks(activationPulseRunnable)
        activationPulseIndex = 0
        webView.post(activationPulseRunnable)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            // Go home — keep the monitoring service alive rather than closing the app
            startActivity(
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            )
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        // Service is already running (started in startMonitoringServiceIfNeeded).
        // Do NOT call startForegroundService here — on Android 12+ this throws
        // ForegroundServiceStartNotAllowedException when the app is going to background.
    }
}
