package com.focusfine.app

import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import android.webkit.WebView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : AppCompatActivity() {

    companion object {
        private const val USAGE_ACCESS_PERMISSION_CODE = 100
        private const val OVERLAY_PERMISSION_CODE = 101
        private const val NOTIFICATION_PERMISSION_CODE = 102
        private const val ACCESSIBILITY_PERMISSION_CODE = 103
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Install the splash screen before super.onCreate so it shows immediately
        installSplashScreen()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val webView = findViewById<WebView>(R.id.webview)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            @Suppress("SetJavaScriptEnabled")
            allowFileAccessFromFileURLs = true
        }

        // Register the JavaScript bridge — React calls window.Android.*
        webView.addJavascriptInterface(
            FocusFineJavascriptInterface(this, this),
            "Android"
        )

        webView.loadUrl("file:///android_asset/index.html")
    }

    override fun onResume() {
        super.onResume()
        checkPermissionsAndProceed()
    }

    private fun checkPermissionsAndProceed() {
        val onboardingComplete = FocusFineApp.preferences.isOnboardingComplete
        val hasCorePermissions =
            hasUsageAccessPermission() &&
            hasOverlayPermissionGranted() &&
            hasAccessibilityServiceEnabled()

        if (onboardingComplete && hasCorePermissions) {
            startMonitoringServiceIfNeeded()
            return
        }

        if (onboardingComplete && !hasCorePermissions) {
            FocusFineApp.preferences.isOnboardingComplete = false
        }

        when {
            !hasUsageAccessPermission() -> requestUsageAccessPermission()
            !hasOverlayPermissionGranted() -> requestOverlayPermission()
            !hasNotificationPermission() -> requestNotificationPermission()
            !hasAccessibilityServiceEnabled() -> requestAccessibilityService()
            else -> {
                FocusFineApp.preferences.isOnboardingComplete = true
                startMonitoringServiceIfNeeded()
                Toast.makeText(this, "FocusFine is now active!", Toast.LENGTH_SHORT).show()
            }
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
        if (requestCode == NOTIFICATION_PERMISSION_CODE) checkPermissionsAndProceed()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        // onResume fires automatically after returning from settings, continuing the permission sequence
    }

    private fun startMonitoringServiceIfNeeded() {
        val serviceIntent = Intent(this, UsageMonitorService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(serviceIntent)
        else startService(serviceIntent)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val webView = findViewById<WebView>(R.id.webview)
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
