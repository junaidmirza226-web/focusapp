package com.focusfine.app.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Update
import androidx.room.Delete
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface AppUsageDao {
    @Insert
    suspend fun insert(usage: AppUsage)

    @Update
    suspend fun update(usage: AppUsage)

    @Query("SELECT * FROM app_usage WHERE packageName = :packageName AND date = :dateStart")
    suspend fun getUsageForDate(packageName: String, dateStart: Long): AppUsage?

    @Query("SELECT * FROM app_usage WHERE packageName = :packageName ORDER BY date DESC LIMIT 7")
    fun getLastWeekUsage(packageName: String): Flow<List<AppUsage>>

    @Query("SELECT SUM(totalTimeMinutes) FROM app_usage WHERE date >= :dateStart AND packageName = :packageName")
    suspend fun getTotalUsageSinceDate(packageName: String, dateStart: Long): Long?

    @Query("DELETE FROM app_usage WHERE date < :cutoffDate")
    suspend fun deleteOldData(cutoffDate: Long)
}

@Dao
interface PaymentDao {
    @Insert
    suspend fun insert(payment: Payment)

    @Query("SELECT * FROM payments WHERE packageName = :packageName AND expiresAt > :currentTime ORDER BY unlockedAt DESC")
    suspend fun getActiveUnlocks(packageName: String, currentTime: Long): List<Payment>

    @Query("SELECT SUM(amount) FROM payments WHERE unlockedAt >= :dateStart")
    suspend fun getTotalSpentToday(dateStart: Long): Double?

    @Query("SELECT * FROM payments ORDER BY unlockedAt DESC LIMIT 100")
    fun getPaymentHistory(): Flow<List<Payment>>

    @Query("DELETE FROM payments WHERE expiresAt < :currentTime")
    suspend fun deleteExpiredUnlocks(currentTime: Long)

    @Query("SELECT COUNT(*) FROM payments WHERE packageName = :packageName AND unlockedAt >= :todayStart")
    suspend fun getUnlockCountToday(packageName: String, todayStart: Long): Int
}

@Dao
interface UserSettingsDao {
    @Insert
    suspend fun insert(settings: UserSettings)

    @Update
    suspend fun update(settings: UserSettings)

    @Delete
    suspend fun delete(settings: UserSettings)

    @Query("SELECT * FROM user_settings WHERE isEnabled = 1")
    fun getEnabledApps(): Flow<List<UserSettings>>

    @Query("SELECT * FROM user_settings WHERE packageName = :packageName")
    suspend fun getSettings(packageName: String): UserSettings?

    @Query("SELECT * FROM user_settings")
    suspend fun getAllSettings(): List<UserSettings>

    @Query("UPDATE user_settings SET isNotified = 1 WHERE packageName = :packageName")
    suspend fun markAsNotified(packageName: String)

    @Query("UPDATE user_settings SET lastResetTime = :newTime WHERE packageName = :packageName")
    suspend fun updateResetTime(packageName: String, newTime: Long)
}

@Dao
interface DailyStatsDao {
    @Insert
    suspend fun insert(stats: DailyStats)

    @Update
    suspend fun update(stats: DailyStats)

    @Query("SELECT * FROM daily_stats WHERE date = :dateStart")
    suspend fun getStatsForDate(dateStart: Long): DailyStats?

    @Query("SELECT * FROM daily_stats ORDER BY date DESC LIMIT 30")
    fun getLastMonthStats(): Flow<List<DailyStats>>

    @Query("SELECT AVG(focusScore) FROM daily_stats WHERE date >= :dateStart")
    suspend fun getAverageScoreSince(dateStart: Long): Double?
}
