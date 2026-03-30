package com.focusfine.app

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import com.focusfine.app.db.AppUsage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.Calendar

class UsageMonitorService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private val coroutineScope = CoroutineScope(Dispatchers.Default)

    // Tracks apps that have been locked this session (cleared only on service restart)
    private val lockedAppsThisSession = mutableSetOf<String>()

    // Used to detect day changes and reset the "warned" flag in UserSettings
    private var lastTodayStart = 0L

    private val monitorRunnable = object : Runnable {
        override fun run() {
            checkUsage()
            // Poll every 30 seconds
            handler.postDelayed(this, 30_000L)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, buildServiceNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, buildServiceNotification())
        }
        // Clear any existing callbacks before posting — prevents duplicate loops on re-start
        handler.removeCallbacks(monitorRunnable)
        handler.post(monitorRunnable)
        Log.d(TAG, "Service started")
        return START_STICKY
    }

    private fun checkUsage() {
        try {
            val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val now = System.currentTimeMillis()
            val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 86_400_000L, now)
                ?: return

            coroutineScope.launch {
                val todayStart = getTodayStartMillis()

                // Reset warned flags at the start of a new day
                if (todayStart != lastTodayStart) {
                    lastTodayStart = todayStart
                    resetDailyWarnings()
                }

                val db = FocusFineApp.database
                val enabledApps = db.userSettingsDao().getAllSettings().filter { it.isEnabled }

                for (usageStat in stats) {
                    val pkg = usageStat.packageName
                    val usedMinutes = usageStat.totalTimeInForeground / 1000L / 60L
                    val settings = enabledApps.find { it.packageName == pkg } ?: continue

                    // Persist today's usage
                    val existing = db.appUsageDao().getUsageForDate(pkg, todayStart)
                    if (existing != null) {
                        db.appUsageDao().update(existing.copy(totalTimeMinutes = usedMinutes))
                    } else {
                        db.appUsageDao().insert(AppUsage(packageName = pkg, date = todayStart, totalTimeMinutes = usedMinutes))
                    }

                    val limitMinutes = settings.dailyLimitMinutes.toLong()

                    // ── 80% warning notification ─────────────────────────────
                    if (usedMinutes >= limitMinutes * 80 / 100 && !settings.isNotified) {
                        val remaining = limitMinutes - usedMinutes
                        sendWarningNotification(pkg, settings.appName, remaining)
                        db.userSettingsDao().markAsNotified(pkg)
                    }

                    // ── Lock logic ────────────────────────────────────────────
                    if (usedMinutes > limitMinutes) {
                        val activeUnlocks = db.paymentDao().getActiveUnlocks(pkg, now)
                        if (activeUnlocks.isEmpty()) {
                            if (!lockedAppsThisSession.contains(pkg)) {
                                lockedAppsThisSession.add(pkg)
                                launchLockScreen(pkg, settings.appName)
                            }
                        } else {
                            // Paid unlock is active — remove from locked set so it re-locks after expiry
                            lockedAppsThisSession.remove(pkg)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error checking usage", e)
        }
    }

    private suspend fun resetDailyWarnings() {
        val db = FocusFineApp.database
        db.userSettingsDao().getAllSettings()
            .filter { it.isNotified }
            .forEach { db.userSettingsDao().update(it.copy(isNotified = false)) }
        Log.d(TAG, "Daily warning flags reset")
    }

    private fun launchLockScreen(packageName: String, appName: String) {
        val strictMode = FocusFineApp.preferences.isStrictModeEnabled
        val intent = Intent(this, OverlayActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra("LOCKED_PACKAGE", packageName)
            putExtra("APP_NAME", appName)
            putExtra("STRICT_MODE", strictMode)
        }
        startActivity(intent)
        Log.d(TAG, "Lock screen launched for $appName ($packageName), strict=$strictMode")
    }

    private fun sendWarningNotification(packageName: String, appName: String, remainingMinutes: Long) {
        val displayName = appName.ifEmpty { packageName }
        val message = when {
            remainingMinutes <= 0 -> "$displayName: Daily limit reached!"
            remainingMinutes == 1L -> "$displayName: 1 minute left today"
            else -> "$displayName: $remainingMinutes minutes left today"
        }

        val tapIntent = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName) ?: Intent(),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = Notification.Builder(this, FocusFineApp.NOTIFICATION_CHANNEL_WARNING_ID)
            .setContentTitle("Approaching Daily Limit")
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentIntent(tapIntent)
            .setAutoCancel(true)
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(packageName.hashCode(), notification)
    }

    private fun buildServiceNotification(): Notification {
        val tapIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return Notification.Builder(this, FocusFineApp.NOTIFICATION_CHANNEL_ID)
            .setContentTitle("FocusFine is Active")
            .setContentText("Monitoring your app usage...")
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentIntent(tapIntent)
            .setOngoing(true)
            .build()
    }

    private fun getTodayStartMillis(): Long {
        return Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(monitorRunnable)
        Log.d(TAG, "Service destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val TAG = "UsageMonitorService"
        private const val NOTIFICATION_ID = 1
    }
}
