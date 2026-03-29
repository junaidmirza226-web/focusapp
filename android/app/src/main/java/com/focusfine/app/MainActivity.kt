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
import android.widget.Toast

class MainActivity : AppCompatActivity() {

    companion object {
        private const val USAGE_ACCESS_PERMISSION_CODE = 100
        private const val OVERLAY_PERMISSION_CODE = 101
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Check if onboarding is needed
        if (!FocusFineApp.preferences.isOnboardingComplete) {
            // TODO: Start onboarding flow
            // For now, request necessary permissions
            requestRequiredPermissions()
        } else {
            // Start monitoring service if not already running
            startMonitoringServiceIfNeeded()
        }
    }

    private fun requestRequiredPermissions() {
        // Check and request PACKAGE_USAGE_STATS permission
        if (!hasUsageAccessPermission()) {
            requestUsageAccessPermission()
        }

        // Check and request SYSTEM_ALERT_WINDOW (overlay) permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(this)) {
                requestOverlayPermission()
            }
        }

        // Check and request IGNORE_BATTERY_OPTIMIZATIONS
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!hasIgnoreBatteryOptimizationPermission()) {
                requestIgnoreBatteryOptimization()
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
        FocusFineApp.preferences.hasUsageAccessPermission = true
    }

    private fun requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                android.net.Uri.parse("package:$packageName")
            )
            startActivityForResult(intent, OVERLAY_PERMISSION_CODE)
            FocusFineApp.preferences.hasOverlayPermission = true
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

    private fun startMonitoringServiceIfNeeded() {
        if (!FocusFineApp.preferences.isMonitoringServiceRunning) {
            val serviceIntent = Intent(this, UsageMonitorService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            FocusFineApp.preferences.isMonitoringServiceRunning = true
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

        // After all permissions, mark onboarding as complete
        if (hasUsageAccessPermission() && hasOverlayPermissionGranted()) {
            FocusFineApp.preferences.isOnboardingComplete = true
            startMonitoringServiceIfNeeded()
        }
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
