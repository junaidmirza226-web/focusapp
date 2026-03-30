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
    }

    override fun onCreate() {
        super.onCreate()
        database = AppDatabase.getInstance(this)
        preferences = UserPreferences(this)
        createNotificationChannels()
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
