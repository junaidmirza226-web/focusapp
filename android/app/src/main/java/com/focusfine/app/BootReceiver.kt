package com.focusfine.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED || 
            action == Intent.ACTION_LOCKED_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            
            Log.d("BootReceiver", "Boot broadcast received: $action")
            DiagnosticsTimeline.record(
                source = "BootReceiver",
                event = "boot_broadcast_received",
                details = action ?: "unknown"
            )
            
            // If onboarding is not complete, do not start the service automatically
            if (!FocusFineApp.preferences.isOnboardingComplete) return

            val serviceIntent = Intent(context, UsageMonitorService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
                DiagnosticsTimeline.record(source = "BootReceiver", event = "monitor_start_requested_on_boot")
                Log.d("BootReceiver", "FocusFine UsageMonitorService auto-restarted.")
            } catch (e: Exception) {
                Log.e("BootReceiver", "Failed to start service on boot", e)
                DiagnosticsTimeline.record(
                    source = "BootReceiver",
                    event = "monitor_start_failed_on_boot",
                    details = e.javaClass.simpleName
                )
            }
        }
    }
}
