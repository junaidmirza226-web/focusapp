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
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.graphics.PixelFormat
import android.widget.Button
import android.widget.TextView
import com.focusfine.app.db.AppUsage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.Calendar

class UsageMonitorService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    // SupervisorJob: a failed child coroutine does NOT cancel the scope or crash the process.
    private val coroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // Thread-safe set — multiple 1-second coroutines run concurrently and all touch this set.
    // A plain mutableSetOf() is a LinkedHashSet which is not thread-safe.
    private val lockedAppsThisSession: MutableSet<String> =
        java.util.Collections.synchronizedSet(mutableSetOf())

    // Used to detect day changes and reset the "warned" flag in UserSettings
    private var lastTodayStart = 0L
    private var isAnyAppLockedRightNow = false
    
    // The invincible floating lock view
    private var floatingLockView: View? = null
    
    // Live Tracker Properties to instantly catch the user mid-session
    private var cachedSessionApp: String? = null
    private var cachedSessionStart: Long = 0L
    private var lastEventTimeProcessed: Long = 0L

    // Throttle: don't launch OverlayActivity more than once every 3 seconds from the service
    private var lastOverlayLaunchTime: Long = 0L

    private val monitorRunnable = object : Runnable {
        override fun run() {
            checkUsage()
            // Poll rapidly to ensure instantaneous locking
            handler.postDelayed(this, 1000L)
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
            val todayStart = getTodayStartMillis()

            // 1. Live Session Tracker: Process only the NEW events since the last 1-second tick!
            if (lastEventTimeProcessed < todayStart) {
                lastEventTimeProcessed = todayStart
                cachedSessionApp = null
                cachedSessionStart = 0L
            }

            val events = usm.queryEvents(lastEventTimeProcessed, now)
            val event = android.app.usage.UsageEvents.Event()
            var anyEventProcessed = false

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                anyEventProcessed = true
                if (event.timeStamp >= lastEventTimeProcessed) {
                    if (event.eventType == android.app.usage.UsageEvents.Event.ACTIVITY_RESUMED ||
                        event.eventType == android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND) {
                        cachedSessionApp = event.packageName
                        cachedSessionStart = event.timeStamp
                    } else if (event.eventType == android.app.usage.UsageEvents.Event.ACTIVITY_PAUSED ||
                               event.eventType == android.app.usage.UsageEvents.Event.MOVE_TO_BACKGROUND) {
                        if (event.packageName == cachedSessionApp) {
                            cachedSessionApp = null
                        }
                    }
                    lastEventTimeProcessed = maxOf(lastEventTimeProcessed, event.timeStamp)
                }
            }

            // If there's no events for 10 seconds, drag the tracker forward to stay fast
            if (!anyEventProcessed && (now - lastEventTimeProcessed) > 10_000L) {
                lastEventTimeProcessed = now - 5000L
            }

            val currentApp = cachedSessionApp

            val statsMap = usm.queryAndAggregateUsageStats(todayStart, now)
            if (statsMap == null || statsMap.isEmpty()) return

            coroutineScope.launch {
              try {
                // Reset warned flags at the start of a new day
                if (todayStart != lastTodayStart) {
                    lastTodayStart = todayStart
                    resetDailyWarnings()
                }

                val db = FocusFineApp.database
                val enabledApps = db.userSettingsDao().getAllSettings().filter { it.isEnabled }
                var isAnyAppLockedRightNow = false
                var shouldShowFloatingLockFor: Pair<String, String>? = null

                for (settings in enabledApps) {
                    val pkg = settings.packageName
                    
                    // Safety: Never lock or kill the timer app itself
                    if (pkg == packageName) {
                        lockedAppsThisSession.remove(pkg)
                        continue
                    }

                    val usageStat = statsMap[pkg]
                    var usedMs = if (usageStat != null) usageStat.totalTimeInForeground else 0L

                    // 🔥 MAGIC OVERRIDE: Add the currently active session because `statsMap` lags behind!
                    if (pkg == currentApp && cachedSessionStart > 0) {
                        val liveSessionMs = now - cachedSessionStart
                        if (liveSessionMs > 0) {
                            usedMs += liveSessionMs
                        }
                    }

                    val usedMinutes = usedMs / 1000L / 60L

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
                    if (effectiveUsage >= limitMinutes) {
                        val activeUnlocks = db.paymentDao().getActiveUnlocks(pkg, now)
                        if (activeUnlocks.isEmpty()) {
                            isAnyAppLockedRightNow = true

                            // Publish to shared set so AccessibilityService can redirect instantly
                            FocusFineApp.lockedPackages.add(pkg)
                            FocusFineApp.lockedPackageNames[pkg] = settings.appName

                            // Show Toast ONLY ONCE when the limit is first breached
                            if (!lockedAppsThisSession.contains(pkg)) {
                                lockedAppsThisSession.add(pkg)
                                handler.post {
                                    android.widget.Toast.makeText(applicationContext, "${settings.appName}: Limit exceeded", android.widget.Toast.LENGTH_SHORT).show()
                                }
                            }

                            // Mark this app for the invincible floating blackout
                            if (currentApp == pkg) {
                                shouldShowFloatingLockFor = Pair(pkg, settings.appName)
                                FocusFineAccessibilityService.forceBlockPackage(
                                    pkg,
                                    settings.appName.ifEmpty { pkg },
                                    FocusFineApp.preferences.isStrictModeEnabled
                                )
                            }
                        } else {
                            // Paid unlock is active
                            lockedAppsThisSession.remove(pkg)
                            FocusFineApp.lockedPackages.remove(pkg)
                            FocusFineApp.lockedPackageNames.remove(pkg)
                        }
                    } else {
                        // Under limit
                        lockedAppsThisSession.remove(pkg)
                        FocusFineApp.lockedPackages.remove(pkg)
                        FocusFineApp.lockedPackageNames.remove(pkg)
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
                    shouldShowFloatingLockFor = Pair(currentApp, "System Blocked")
                }

                // Apply the floating lock state safely on the Main Thread
                handler.post {
                    if (shouldShowFloatingLockFor != null) {
                        showFloatingLock(shouldShowFloatingLockFor!!.first, shouldShowFloatingLockFor!!.second)
                    } else {
                        removeFloatingLock()
                    }
                }
              } catch (e: Exception) {
                // Catch all errors inside the coroutine so they never escape to crash the process.
                // With SupervisorJob the scope survives, but we still want no silent data loss.
                Log.e(TAG, "Error in monitor coroutine", e)
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

    private fun showFloatingLock(packageName: String, appName: String) {
        if (floatingLockView != null) {
            // Update the text dynamically if already showing
            try {
                floatingLockView?.findViewById<TextView>(R.id.overlay_lock_message)?.text = "Daily limit reached for $appName"
            } catch (e: Exception) {}
            return
        }
        
        try {
            val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) 
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY 
                else 
                    WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT
            )
            
            val view = LayoutInflater.from(this).inflate(R.layout.window_lock_overlay, null)
            view.findViewById<TextView>(R.id.overlay_lock_message).text = "Daily limit reached for $appName"
            
            val strictMode = FocusFineApp.preferences.isStrictModeEnabled
            if (strictMode) {
                view.findViewById<Button>(R.id.overlay_btn_pay_fine).visibility = View.GONE
                view.findViewById<TextView>(R.id.overlay_strict_mode_banner).visibility = View.VISIBLE
            } else {
                view.findViewById<Button>(R.id.overlay_btn_pay_fine).setOnClickListener {
                    // Tapping the floating overlay counts as a USER INTERACTION! 
                    // This grants us immediate permission to launch our Payment Activity from the background!
                    val intent = Intent(this@UsageMonitorService, OverlayActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                        putExtra("LOCKED_PACKAGE", packageName)
                        putExtra("APP_NAME", appName)
                        putExtra("STRICT_MODE", false)
                    }
                    startActivity(intent)
                }
            }
            
            windowManager.addView(view, params)
            floatingLockView = view
            Log.d(TAG, "Invincible WindowManager lock deployed over $appName ($packageName)")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to deploy WindowManager overlay! Missing permission?", e)
        }
    }

    private fun removeFloatingLock() {
        floatingLockView?.let { view ->
            try {
                val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
                windowManager.removeView(view)
                floatingLockView = null
                Log.d(TAG, "WindowManager lock retracted.")
            } catch (e: Exception) {
                Log.e(TAG, "Error removing floating view", e)
            }
        }
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
