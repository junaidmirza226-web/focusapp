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
    }

    override fun onCreate() {
        super.onCreate()

        // Initialize database
        database = AppDatabase.getInstance(this)

        // Initialize preferences
        preferences = UserPreferences(this)

        // Create notification channel (required for Android 8+)
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "FocusFine Monitoring",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Notifications for app usage monitoring"
                setShowBadge(false)
            }

            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager?.createNotificationChannel(channel)
        }
    }
}
