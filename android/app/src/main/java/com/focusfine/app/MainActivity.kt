package com.focusfine.app

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.app.AppOpsManager
import android.content.Context
import android.provider.Settings
import android.webkit.WebView
import android.webkit.WebSettings
import android.widget.Toast

class MainActivity : AppCompatActivity() {

    companion object {
        private const val USAGE_ACCESS_PERMISSION_CODE = 100
        private const val OVERLAY_PERMISSION_CODE = 101
        private const val NOTIFICATION_PERMISSION_CODE = 102
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Setup WebView to display the React dashboard
        val webView = findViewById<WebView>(R.id.webview)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            // Allow file:// URLs to load other file:// resources (needed for Vite asset chunks)
            @Suppress("SetJavaScriptEnabled")
            allowFileAccessFromFileURLs = true
        }
        webView.loadUrl("file:///android_asset/index.html")
    }

    override fun onResume() {
        super.onResume()
        checkPermissionsAndProceed()
    }

    /**
     * Called on every resume (app start, return from settings screen).
     * Requests permissions one at a time sequentially, then starts service.
     */
    private fun checkPermissionsAndProceed() {
        if (FocusFineApp.preferences.isOnboardingComplete) {
            startMonitoringServiceIfNeeded()
            return
        }

        when {
            !hasUsageAccessPermission() -> requestUsageAccessPermission()
            !hasOverlayPermissionGranted() -> requestOverlayPermission()
            !hasNotificationPermission() -> requestNotificationPermission()
            else -> {
                // All required permissions granted
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
                android.os.Process.myUid(),
                packageName
            )
            mode == AppOpsManager.MODE_ALLOWED
        } catch (e: Exception) {
            false
        }
    }

    private fun requestUsageAccessPermission() {
        Toast.makeText(
            this,
            "Please enable 'Usage Access' in Settings to monitor app usage",
            Toast.LENGTH_LONG
        ).show()
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        startActivityForResult(intent, USAGE_ACCESS_PERMISSION_CODE)
    }

    private fun requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                android.net.Uri.parse("package:$packageName")
            )
            startActivityForResult(intent, OVERLAY_PERMISSION_CODE)
        }
    }

    private fun hasIgnoreBatteryOptimizationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            pm.isIgnoringBatteryOptimizations(packageName)
        } else {
            true
        }
    }

    private fun requestIgnoreBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    android.Manifest.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
                ) == PackageManager.PERMISSION_GRANTED
            ) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = android.net.Uri.parse("package:$packageName")
                }
                startActivity(intent)
                FocusFineApp.preferences.hasIgnoreBatteryOptimization = true
            }
        }
    }

    private fun hasNotificationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                this,
                android.Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true // Not required before Android 13
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_PERMISSION_CODE
            )
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        // Re-run the permission flow after user responds to notification dialog
        if (requestCode == NOTIFICATION_PERMISSION_CODE) {
            checkPermissionsAndProceed()
        }
    }

    private fun startMonitoringServiceIfNeeded() {
        // Always start (or restart) the service — safe because UsageMonitorService
        // removes and re-posts the runnable in onStartCommand, preventing duplicate loops
        val serviceIntent = Intent(this, UsageMonitorService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        when (requestCode) {
            USAGE_ACCESS_PERMISSION_CODE -> {
                if (hasUsageAccessPermission()) {
                    Toast.makeText(this, "Usage access permission granted!", Toast.LENGTH_SHORT)
                        .show()
                }
            }
            OVERLAY_PERMISSION_CODE -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    if (Settings.canDrawOverlays(this)) {
                        Toast.makeText(this, "Overlay permission granted!", Toast.LENGTH_SHORT)
                            .show()
                    }
                }
            }
        }
        // onResume() will be called automatically after returning from settings,
        // which triggers checkPermissionsAndProceed() to continue the sequence
    }

    private fun hasOverlayPermissionGranted(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(this)
        } else {
            true
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        // Keep monitoring service alive even if activity is destroyed
        val serviceIntent = Intent(this, UsageMonitorService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }
    }
}
