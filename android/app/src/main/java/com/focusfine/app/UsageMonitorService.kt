package com.focusfine.app

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.app.ActivityManager
import com.focusfine.app.db.AppUsage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.Calendar

class UsageMonitorService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private val coroutineScope = CoroutineScope(Dispatchers.Default)
    private val lockedAppsThisSession = mutableSetOf<String>()

    private var isAppInForeground = true
    private var lastCheckTime = 0L

    private val monitorRunnable = object : Runnable {
        override fun run() {
            // Adaptive polling based on app state
            val checkInterval = if (isAppInForeground) {
                30000L // 30 seconds when app is active
            } else {
                120000L // 2 minutes when in background
            }

            // Only check if enough time has passed (prevent excessive checks)
            val currentTime = System.currentTimeMillis()
            if (currentTime - lastCheckTime >= checkInterval - 5000) {
                checkUsage()
                lastCheckTime = currentTime
            }

            handler.postDelayed(this, 30000) // Recheck interval
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Android 14+ requires specifying the foreground service type explicitly
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(1, createNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(1, createNotification())
        }
        // Remove any existing callbacks before re-posting to prevent duplicate polling loops
        // when the service is started multiple times (e.g., from onResume + onDestroy)
        handler.removeCallbacks(monitorRunnable)
        handler.post(monitorRunnable)
        Log.d("UsageMonitor", "Service started and monitoring enabled")
        return START_STICKY
    }

    private fun checkUsage() {
        try {
            val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val time = System.currentTimeMillis()
            val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, time - 1000 * 60 * 24, time)

            if (stats != null) {
                coroutineScope.launch {
                    // Get today's start time
                    val cal = Calendar.getInstance()
                    cal.set(Calendar.HOUR_OF_DAY, 0)
                    cal.set(Calendar.MINUTE, 0)
                    cal.set(Calendar.SECOND, 0)
                    val todayStart = cal.timeInMillis

                    val db = FocusFineApp.database
                    val settingsDao = db.userSettingsDao()
                    val usageDao = db.appUsageDao()
                    val enabledApps = settingsDao.getAllSettings().filter { it.isEnabled }

                    for (usageStats in stats) {
                        val packageName = usageStats.packageName
                        val timeUsedMinutes = usageStats.totalTimeInForeground / 1000 / 60

                        // Check if this app is monitored
                        val settings = enabledApps.find { it.packageName == packageName }
                        if (settings != null) {
                            // Update or create usage record
                            var appUsage = usageDao.getUsageForDate(packageName, todayStart)
                            if (appUsage != null) {
                                appUsage = appUsage.copy(totalTimeMinutes = timeUsedMinutes)
                                usageDao.update(appUsage)
                            } else {
                                usageDao.insert(AppUsage(
                                    packageName = packageName,
                                    date = todayStart,
                                    totalTimeMinutes = timeUsedMinutes
                                ))
                            }

                            // Check if over limit
                            if (timeUsedMinutes > settings.dailyLimitMinutes) {
                                val now = System.currentTimeMillis()
                                val activeUnlocks = db.paymentDao().getActiveUnlocks(packageName, now)
                                if (activeUnlocks.isEmpty()) {
                                    // No active paid unlock — lock if not already locked this session
                                    if (!lockedAppsThisSession.contains(packageName)) {
                                        lockedAppsThisSession.add(packageName)
                                        launchLockScreen(packageName)
                                    }
                                } else {
                                    // Active unlock exists — clear from locked set so re-lock fires after expiry
                                    lockedAppsThisSession.remove(packageName)
                                }
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("UsageMonitor", "Error checking usage", e)
        }
    }

    private fun launchLockScreen(packageName: String) {
        val intent = Intent(this, OverlayActivity::class.java)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        intent.putExtra("LOCKED_PACKAGE", packageName)
        startActivity(intent)
        Log.d("UsageMonitor", "Lock screen launched for $packageName")
    }

    private fun createNotification(): android.app.Notification {
        return android.app.Notification.Builder(this, FocusFineApp.NOTIFICATION_CHANNEL_ID)
            .setContentTitle("FocusFine is Active")
            .setContentText("Monitoring your digital discipline...")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(android.app.Notification.PRIORITY_LOW)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(monitorRunnable)
        Log.d("UsageMonitor", "Service destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
