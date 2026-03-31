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
            // Poll rapidly to ensure instantaneous locking
            handler.postDelayed(this, 1500L)
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

    private fun getForegroundApp(usm: UsageStatsManager, now: Long): String? {
        // Look back 5 minutes for events to find the most recent foreground activity
        val events = usm.queryEvents(now - 300_000L, now)
        var lastValidPkg: String? = null
        val event = android.app.usage.UsageEvents.Event()
        
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            // We care about any event that places a package in the foreground
            if (event.eventType == android.app.usage.UsageEvents.Event.ACTIVITY_RESUMED ||
                event.eventType == android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND) {
                lastValidPkg = event.packageName
            } else if (event.eventType == android.app.usage.UsageEvents.Event.ACTIVITY_PAUSED ||
                event.eventType == android.app.usage.UsageEvents.Event.MOVE_TO_BACKGROUND) {
                // If the package we thought was foreground is now explicitly backgrounded, clear it
                // unless another resume event happens later in the buffer
                if (event.packageName == lastValidPkg) {
                    lastValidPkg = null
                }
            }
        }
        return lastValidPkg
    }

    private fun checkUsage() {
        try {
            val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val now = System.currentTimeMillis()
            val todayStart = getTodayStartMillis()

            val statsMap = usm.queryAndAggregateUsageStats(todayStart, now)
            if (statsMap == null || statsMap.isEmpty()) return
            
            val currentApp = getForegroundApp(usm, now)

            coroutineScope.launch {
                // Reset warned flags at the start of a new day
                if (todayStart != lastTodayStart) {
                    lastTodayStart = todayStart
                    resetDailyWarnings()
                }

                val db = FocusFineApp.database
                val enabledApps = db.userSettingsDao().getAllSettings().filter { it.isEnabled }
                var isAnyAppLockedRightNow = false

                for (settings in enabledApps) {
                    val pkg = settings.packageName
                    
                    // Safety: Never lock or kill the timer app itself
                    if (pkg == packageName) {
                        lockedAppsThisSession.remove(pkg)
                        continue
                    }

                    val usageStat = statsMap[pkg]
                    val usedMinutes = if (usageStat != null) usageStat.totalTimeInForeground / 1000L / 60L else 0L

                    // Persist today's usage
                    val existing = db.appUsageDao().getUsageForDate(pkg, todayStart)
                    if (existing != null) {
                        db.appUsageDao().update(existing.copy(totalTimeMinutes = usedMinutes))
                    } else {
                        db.appUsageDao().insert(AppUsage(packageName = pkg, date = todayStart, totalTimeMinutes = usedMinutes))
                    }

                    val limitMinutes = settings.dailyLimitMinutes.toLong()

                    // Reset baseline at midnight
                    val effectiveBaseUsage = if (todayStart > settings.lastResetDate) {
                        db.userSettingsDao().update(settings.copy(baseUsageMinutes = 0, lastResetDate = todayStart))
                        0L
                    } else {
                        settings.baseUsageMinutes
                    }

                    val effectiveUsage = (usedMinutes - effectiveBaseUsage).coerceAtLeast(0L)

                    // ── 80% warning notification ─────────────────────────────
                    if (effectiveUsage >= limitMinutes * 80 / 100 && !settings.isNotified) {
                        val remaining = limitMinutes - effectiveUsage
                        sendWarningNotification(pkg, settings.appName, remaining)
                        db.userSettingsDao().markAsNotified(pkg)
                    }

                    // ── Lock logic ────────────────────────────────────────────
                    if (effectiveUsage > limitMinutes) {
                        val activeUnlocks = db.paymentDao().getActiveUnlocks(pkg, now)
                        if (activeUnlocks.isEmpty()) {
                            isAnyAppLockedRightNow = true
                            
                            // 1. Show Toast ONLY ONCE when the limit is breached
                            if (!lockedAppsThisSession.contains(pkg)) {
                                lockedAppsThisSession.add(pkg)
                                handler.post {
                                    android.widget.Toast.makeText(applicationContext, "${settings.appName}: Limit exceeded", android.widget.Toast.LENGTH_SHORT).show()
                                }
                                
                                // One-time background kill boost
                                try {
                                    val am = getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
                                    am.killBackgroundProcesses(pkg)
                                } catch (e: Exception) {
                                    Log.e(TAG, "Failed to kill process for $pkg", e)
                                }
                            }

                            // 2. Continuous Locking: If the user is currently in the forbidden app,
                            // we KEEP launching the lock screen to prevent bypass.
                            if (currentApp == pkg) {
                                try {
                                    launchLockScreen(pkg, settings.appName)
                                } catch (e: Exception) {
                                    Log.e(TAG, "Failed to launch lock screen", e)
                                }
                            }
                        } else {
                            // Paid unlock is active
                            lockedAppsThisSession.remove(pkg)
                        }
                    } else {
                        lockedAppsThisSession.remove(pkg)
                    }
                }

                // Uninstall prevention block (for settings and installer)
                val systemAppsToCheck = listOf(
                    "com.android.settings", 
                    "com.google.android.packageinstaller",
                    "com.miui.securitycenter",
                    "com.android.vending"
                )
                
                if (isAnyAppLockedRightNow && currentApp != null && systemAppsToCheck.contains(currentApp)) {
                    // Constant re-locking for system apps if an app limit is breached
                    launchLockScreen(currentApp, "System Blocked")
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
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
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
