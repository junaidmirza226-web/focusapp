package com.focusfine.app.preferences

import android.content.Context
import android.content.SharedPreferences

class UserPreferences(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences(
        "focusfine_prefs",
        Context.MODE_PRIVATE
    )

    // Onboarding state
    var isOnboardingComplete: Boolean
        get() = prefs.getBoolean(KEY_ONBOARDING_COMPLETE, false)
        set(value) = prefs.edit().putBoolean(KEY_ONBOARDING_COMPLETE, value).apply()

    var hasUsageAccessPermission: Boolean
        get() = prefs.getBoolean(KEY_USAGE_ACCESS, false)
        set(value) = prefs.edit().putBoolean(KEY_USAGE_ACCESS, value).apply()

    var hasOverlayPermission: Boolean
        get() = prefs.getBoolean(KEY_OVERLAY_PERMISSION, false)
        set(value) = prefs.edit().putBoolean(KEY_OVERLAY_PERMISSION, value).apply()

    var hasIgnoreBatteryOptimization: Boolean
        get() = prefs.getBoolean(KEY_BATTERY_OPT, false)
        set(value) = prefs.edit().putBoolean(KEY_BATTERY_OPT, value).apply()

    // App settings
    var isStrictModeEnabled: Boolean
        get() = prefs.getBoolean(KEY_STRICT_MODE, false)
        set(value) = prefs.edit().putBoolean(KEY_STRICT_MODE, value).apply()

    var dailyResetHour: Int
        get() = prefs.getInt(KEY_RESET_HOUR, 0) // Default: midnight
        set(value) = prefs.edit().putInt(KEY_RESET_HOUR, value).apply()

    var lastDailyResetTime: Long
        get() = prefs.getLong(KEY_LAST_RESET, 0)
        set(value) = prefs.edit().putLong(KEY_LAST_RESET, value).apply()

    var totalSpentToday: Double
        get() = prefs.getString(KEY_TOTAL_SPENT, "0.0")?.toDoubleOrNull() ?: 0.0
        set(value) = prefs.edit().putString(KEY_TOTAL_SPENT, value.toString()).apply()

    var currentFocusScore: Int
        get() = prefs.getInt(KEY_FOCUS_SCORE, 85)
        set(value) = prefs.edit().putInt(KEY_FOCUS_SCORE, value).apply()

    var currentStreak: Int
        get() = prefs.getInt(KEY_STREAK, 0)
        set(value) = prefs.edit().putInt(KEY_STREAK, value).apply()

    // Service management
    var isMonitoringServiceRunning: Boolean
        get() = prefs.getBoolean(KEY_SERVICE_RUNNING, false)
        set(value) = prefs.edit().putBoolean(KEY_SERVICE_RUNNING, value).apply()

    var lastServiceCheckTime: Long
        get() = prefs.getLong(KEY_LAST_SERVICE_CHECK, 0)
        set(value) = prefs.edit().putLong(KEY_LAST_SERVICE_CHECK, value).apply()

    fun clearAllData() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_ONBOARDING_COMPLETE = "onboarding_complete"
        private const val KEY_USAGE_ACCESS = "usage_access_permission"
        private const val KEY_OVERLAY_PERMISSION = "overlay_permission"
        private const val KEY_BATTERY_OPT = "battery_optimization"
        private const val KEY_STRICT_MODE = "strict_mode"
        private const val KEY_RESET_HOUR = "reset_hour"
        private const val KEY_LAST_RESET = "last_reset_time"
        private const val KEY_TOTAL_SPENT = "total_spent_today"
        private const val KEY_FOCUS_SCORE = "focus_score"
        private const val KEY_STREAK = "streak_days"
        private const val KEY_SERVICE_RUNNING = "service_running"
        private const val KEY_LAST_SERVICE_CHECK = "last_service_check"
    }
}
