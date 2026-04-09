package com.focusfine.app.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        AppUsage::class,
        Payment::class,
        UserSettings::class,
        TimeBlockRule::class,
        DailyStats::class
    ],
    version = 3,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun appUsageDao(): AppUsageDao
    abstract fun paymentDao(): PaymentDao
    abstract fun userSettingsDao(): UserSettingsDao
    abstract fun timeBlockRuleDao(): TimeBlockRuleDao
    abstract fun dailyStatsDao(): DailyStatsDao

    companion object {
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE user_settings ADD COLUMN enforcementMode TEXT NOT NULL DEFAULT 'USAGE_ONLY'"
                )
                db.execSQL(
                    "ALTER TABLE user_settings ADD COLUMN usageLimitEnabled INTEGER NOT NULL DEFAULT 1"
                )
                db.execSQL(
                    "ALTER TABLE user_settings ADD COLUMN timeBlockEnabled INTEGER NOT NULL DEFAULT 0"
                )
                db.execSQL(
                    "ALTER TABLE payments ADD COLUMN blockReason TEXT NOT NULL DEFAULT 'USAGE_LIMIT'"
                )
                db.execSQL(
                    "ALTER TABLE payments ADD COLUMN unlockScope TEXT NOT NULL DEFAULT 'REASON_ONLY'"
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `time_block_rules` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `packageName` TEXT NOT NULL,
                        `dayOfWeek` INTEGER NOT NULL,
                        `startMinuteOfDay` INTEGER NOT NULL,
                        `endMinuteOfDay` INTEGER NOT NULL,
                        `isEnabled` INTEGER NOT NULL
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_time_block_rules_packageName` ON `time_block_rules` (`packageName`)"
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_time_block_rules_packageName_dayOfWeek` ON `time_block_rules` (`packageName`, `dayOfWeek`)"
                )
            }
        }

        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "focusfine_database"
                )
                    .addMigrations(MIGRATION_2_3)
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
