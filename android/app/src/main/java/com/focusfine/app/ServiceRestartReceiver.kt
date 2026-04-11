package com.focusfine.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class ServiceRestartReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_RESTART_USAGE_MONITOR) return
        if (!FocusFineApp.preferences.isOnboardingComplete) return

        try {
            DiagnosticsTimeline.record(
                source = TAG,
                event = "restart_broadcast_received",
                details = intent.getStringExtra("reason") ?: "unknown"
            )
            val serviceIntent = Intent(context, UsageMonitorService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
            Log.d(TAG, "UsageMonitorService restart broadcast delivered")
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to restart UsageMonitorService from broadcast", t)
            DiagnosticsTimeline.record(
                source = TAG,
                event = "restart_broadcast_failed",
                details = t.javaClass.simpleName
            )
        }
    }

    companion object {
        private const val TAG = "ServiceRestartReceiver"
        const val ACTION_RESTART_USAGE_MONITOR = "com.focusfine.app.action.RESTART_USAGE_MONITOR"
        private const val REQUEST_CODE = 8801

        fun schedule(context: Context, delayMs: Long, reason: String) {
            val triggerAt = System.currentTimeMillis() + delayMs.coerceAtLeast(250L)
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, ServiceRestartReceiver::class.java).apply {
                action = ACTION_RESTART_USAGE_MONITOR
                putExtra("reason", reason)
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val usedExactAlarm = try {
                when {
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
                        if (alarmManager.canScheduleExactAlarms()) {
                            alarmManager.setExactAndAllowWhileIdle(
                                AlarmManager.RTC_WAKEUP,
                                triggerAt,
                                pendingIntent
                            )
                            true
                        } else {
                            alarmManager.setAndAllowWhileIdle(
                                AlarmManager.RTC_WAKEUP,
                                triggerAt,
                                pendingIntent
                            )
                            false
                        }
                    }
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M -> {
                        alarmManager.setExactAndAllowWhileIdle(
                            AlarmManager.RTC_WAKEUP,
                            triggerAt,
                            pendingIntent
                        )
                        true
                    }
                    else -> {
                        alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
                        true
                    }
                }
            } catch (security: SecurityException) {
                // Android 12+ may reject exact alarms without explicit capability; fall back.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        triggerAt,
                        pendingIntent
                    )
                } else {
                    alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
                }
                Log.w(TAG, "Exact-alarm restart not allowed; used inexact fallback", security)
                false
            }
            DiagnosticsTimeline.record(
                source = TAG,
                event = "restart_scheduled",
                details = "reason=$reason delayMs=${triggerAt - System.currentTimeMillis()} exact=$usedExactAlarm"
            )
            Log.d(TAG, "Scheduled UsageMonitorService restart in ${triggerAt - System.currentTimeMillis()}ms ($reason)")
        }
    }
}
