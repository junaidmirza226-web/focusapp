package com.focusfine.app.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

enum class EnforcementMode {
    USAGE_ONLY,
    TIME_ONLY,
    COMBINED
}

enum class BlockReason {
    USAGE_LIMIT,
    TIME_BLOCK
}

enum class UnlockScope {
    REASON_ONLY,
    ALL_RULES
}

/**
 * Tracks daily app usage statistics
 */
@Entity(tableName = "app_usage")
data class AppUsage(
    @PrimaryKey(autoGenerate = true)
    val id: Int = 0,
    val packageName: String,
    val date: Long, // Unix timestamp of day start
    val totalTimeMinutes: Long, // Total foreground time in minutes
    val lastUpdated: Long = System.currentTimeMillis()
)

/**
 * Stores payment history and unlock records
 */
@Entity(tableName = "payments")
data class Payment(
    @PrimaryKey(autoGenerate = true)
    val id: Int = 0,
    val packageName: String,
    val amount: Double, // Dollar amount paid
    val unlockDurationMinutes: Int, // How long the unlock is valid
    val unlockedAt: Long, // When the unlock was purchased
    val expiresAt: Long, // When the unlock expires
    val purchaseToken: String = "", // Google Play Billing token
    val blockReason: String = BlockReason.USAGE_LIMIT.name,
    val unlockScope: String = UnlockScope.REASON_ONLY.name
)

/**
 * User settings and app limit configurations
 */
@Entity(tableName = "user_settings")
data class UserSettings(
    @PrimaryKey
    val packageName: String, // Unique identifier for each monitored app
    val dailyLimitMinutes: Int, // Daily usage limit in minutes
    val isEnabled: Boolean = true, // Whether this app is being monitored
    val isNotified: Boolean = false, // Whether user was notified about approaching limit
    val appName: String = "", // Display name of the app
    val lastResetTime: Long = System.currentTimeMillis(), // When the daily limit was last reset
    val baseUsageMinutes: Long = 0, // Usage time already spent today BEFORE the limit was set
    val lastResetDate: Long = 0, // Unix timestamp of the day when baseUsageMinutes was recorded
    val enforcementMode: String = EnforcementMode.USAGE_ONLY.name,
    val usageLimitEnabled: Boolean = true,
    val timeBlockEnabled: Boolean = false
)

/**
 * Weekly recurring block windows for a monitored app.
 * dayOfWeek uses ISO-8601 style: 1=Monday ... 7=Sunday.
 * If endMinuteOfDay <= startMinuteOfDay, the rule crosses midnight.
 */
@Entity(
    tableName = "time_block_rules",
    indices = [Index(value = ["packageName"]), Index(value = ["packageName", "dayOfWeek"])]
)
data class TimeBlockRule(
    @PrimaryKey(autoGenerate = true)
    val id: Int = 0,
    val packageName: String,
    val dayOfWeek: Int,
    val startMinuteOfDay: Int,
    val endMinuteOfDay: Int,
    val isEnabled: Boolean = true
)

/**
 * Tracks daily statistics for insights and analytics
 */
@Entity(tableName = "daily_stats")
data class DailyStats(
    @PrimaryKey
    val date: Long, // Unix timestamp of day start
    val totalSpentDollars: Double = 0.0,
    val totalTimeSavedMinutes: Long = 0,
    val focusScore: Int = 0, // 0-100 score based on adherence to limits
    val streakDays: Int = 0 // Consecutive days without going over limit
)
