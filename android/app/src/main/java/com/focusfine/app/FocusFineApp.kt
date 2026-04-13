package com.focusfine.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.focusfine.app.db.AppDatabase
import com.focusfine.app.preferences.UserPreferences

class FocusFineApp : Application() {

    companion object {
        lateinit var database: AppDatabase
            private set
        lateinit var preferences: UserPreferences
            private set

        const val NOTIFICATION_CHANNEL_ID = "focus_fine_channel"
        const val NOTIFICATION_CHANNEL_WARNING_ID = "focus_fine_warnings"

        // Shared between UsageMonitorService (writer) and FocusFineAccessibilityService (reader).
        // ConcurrentHashMap.newKeySet() is thread-safe and O(1) for contains/add/remove.
        val lockedPackages: MutableSet<String> =
            java.util.concurrent.ConcurrentHashMap.newKeySet()

        // Maps packageName → display name so the AccessibilityService can title the overlay
        // without a DB lookup on the hot path.
        val lockedPackageNames: java.util.concurrent.ConcurrentHashMap<String, String> =
            java.util.concurrent.ConcurrentHashMap()
    }

    override fun onCreate() {
        super.onCreate()
        database = AppDatabase.getInstance(this)
        preferences = UserPreferences(this)
        // Process-local health flags must be reset on every fresh process start.
        preferences.isMonitoringServiceRunning = false
        preferences.isAccessibilityServiceBound = false
        createNotificationChannels()
        DiagnosticsTimeline.record(
            source = "FocusFineApp",
            event = "process_initialized",
            details = "onboardingComplete=${preferences.isOnboardingComplete}"
        )
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(NotificationManager::class.java)

            // Persistent foreground service channel
            val serviceChannel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "FocusFine Monitoring",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Shows that FocusFine is actively monitoring your app usage"
                setShowBadge(false)
            }

            // Limit-approaching warning channel
            val warningChannel = NotificationChannel(
                NOTIFICATION_CHANNEL_WARNING_ID,
                "Usage Warnings",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Alerts when you're approaching your daily limit for an app"
                enableVibration(true)
            }

            notificationManager?.createNotificationChannel(serviceChannel)
            notificationManager?.createNotificationChannel(warningChannel)
        }
    }
}
