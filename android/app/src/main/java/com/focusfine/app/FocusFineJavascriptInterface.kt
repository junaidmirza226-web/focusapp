package com.focusfine.app

import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Base64
import android.webkit.JavascriptInterface
import androidx.core.graphics.drawable.toBitmap
import com.focusfine.app.db.UserSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.lang.ref.WeakReference
import java.util.Calendar

/**
 * Exposes Android functionality to the React WebView via window.Android.*
 * All methods must return primitives or Strings (JSON-encoded).
 * Methods that mutate state are fire-and-forget (void); data reads use runBlocking(IO).
 */
class FocusFineJavascriptInterface(
    private val context: Context,
    activity: MainActivity
) {
    private val activityRef = WeakReference(activity)
    private val db get() = FocusFineApp.database
    private val prefs get() = FocusFineApp.preferences

    // ── Permissions ──────────────────────────────────────────────────────────

    @JavascriptInterface
    fun isPermissionsGranted(): String {
        val usageAccess = hasUsageAccess()
        val overlay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            Settings.canDrawOverlays(context) else true
        return JSONObject().apply {
            put("usageAccess", usageAccess)
            put("overlay", overlay)
            put("onboardingComplete", prefs.isOnboardingComplete)
        }.toString()
    }

    @JavascriptInterface
    fun requestUsageAccess() {
        activityRef.get()?.runOnUiThread {
            context.startActivity(
                Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }

    @JavascriptInterface
    fun requestOverlay() {
        activityRef.get()?.runOnUiThread {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                context.startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        android.net.Uri.parse("package:${context.packageName}")
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
        }
    }

    @JavascriptInterface
    fun requestBatteryOptimization() {
        activityRef.get()?.runOnUiThread {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    context.startActivity(
                        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                            .setData(android.net.Uri.parse("package:${context.packageName}"))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                } catch (e: Exception) { /* not all devices support this intent */ }
            }
        }
    }

    // ── Installed Apps ────────────────────────────────────────────────────────

    /** Returns JSON array of {packageName, appName} for all launchable apps. */
    @JavascriptInterface
    fun getInstalledApps(): String {
        val pm = context.packageManager
        val launchIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = pm.queryIntentActivities(launchIntent, 0)
            .filter { it.activityInfo.packageName != context.packageName }
            .sortedBy { it.loadLabel(pm).toString().lowercase() }

        val result = JSONArray()
        for (app in apps) {
            result.put(JSONObject().apply {
                put("packageName", app.activityInfo.packageName)
                put("appName", app.loadLabel(pm).toString())
            })
        }
        return result.toString()
    }

    /**
     * Returns a Base64-encoded PNG data URI for a single app icon.
     * React calls this lazily per visible row to avoid loading all icons at once.
     */
    @JavascriptInterface
    fun getAppIcon(packageName: String): String {
        return try {
            val drawable = context.packageManager.getApplicationIcon(packageName)
            val bitmap = drawable.toBitmap(64, 64, Bitmap.Config.ARGB_8888)
            val stream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 85, stream)
            "data:image/png;base64," + Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            ""
        }
    }

    // ── App Settings (Room DB) ────────────────────────────────────────────────

    @JavascriptInterface
    fun saveApp(packageName: String, limitMinutes: Int, appName: String) {
        runBlocking(Dispatchers.IO) {
            val existing = db.userSettingsDao().getSettings(packageName)
            if (existing != null) {
                db.userSettingsDao().update(
                    existing.copy(dailyLimitMinutes = limitMinutes, appName = appName, isEnabled = true)
                )
            } else {
                db.userSettingsDao().insert(
                    UserSettings(packageName = packageName, dailyLimitMinutes = limitMinutes, appName = appName)
                )
            }
        }
    }

    @JavascriptInterface
    fun removeApp(packageName: String) {
        runBlocking(Dispatchers.IO) {
            db.userSettingsDao().getSettings(packageName)?.let {
                db.userSettingsDao().delete(it)
            }
        }
    }

    /** Returns JSON array of enabled UserSettings records. */
    @JavascriptInterface
    fun getMonitoredApps(): String {
        return runBlocking(Dispatchers.IO) {
            val result = JSONArray()
            db.userSettingsDao().getAllSettings()
                .filter { it.isEnabled }
                .forEach { app ->
                    result.put(JSONObject().apply {
                        put("packageName", app.packageName)
                        put("appName", app.appName)
                        put("dailyLimitMinutes", app.dailyLimitMinutes)
                    })
                }
            result.toString()
        }
    }

    // ── Usage Data ────────────────────────────────────────────────────────────

    /** Returns JSON array of {packageName, usedMinutes, limitMinutes} for today. */
    @JavascriptInterface
    fun getTodayUsage(): String {
        return runBlocking(Dispatchers.IO) {
            val todayStart = getTodayStartMillis()
            val result = JSONArray()
            db.userSettingsDao().getAllSettings()
                .filter { it.isEnabled }
                .forEach { app ->
                    val used = db.appUsageDao().getUsageForDate(app.packageName, todayStart)?.totalTimeMinutes ?: 0L
                    result.put(JSONObject().apply {
                        put("packageName", app.packageName)
                        put("usedMinutes", used)
                        put("limitMinutes", app.dailyLimitMinutes)
                    })
                }
            result.toString()
        }
    }

    // ── Dashboard Stats ───────────────────────────────────────────────────────

    /**
     * Returns all stats needed to populate the dashboard hero card, stat tiles,
     * and weekly summary in one call.
     */
    @JavascriptInterface
    fun getDashboardStats(): String {
        return runBlocking(Dispatchers.IO) {
            val todayStart = getTodayStartMillis()
            val yesterdayStart = todayStart - 86_400_000L
            val weekStart = todayStart - 6 * 86_400_000L

            val apps = db.userSettingsDao().getAllSettings().filter { it.isEnabled }
            val totalApps = apps.size
            var appsUnderLimit = 0
            var timeSavedMinutes = 0L

            apps.forEach { app ->
                val used = db.appUsageDao().getUsageForDate(app.packageName, todayStart)?.totalTimeMinutes ?: 0L
                if (used <= app.dailyLimitMinutes) {
                    appsUnderLimit++
                    timeSavedMinutes += (app.dailyLimitMinutes - used)
                }
            }

            val focusScore = if (totalApps > 0) appsUnderLimit * 100 / totalApps else 100

            val spentToday = db.paymentDao().getTotalSpentToday(todayStart) ?: 0.0
            val spentThisWeek = db.paymentDao().getTotalSpentToday(weekStart) ?: 0.0

            val yesterdayScore = db.dailyStatsDao().getStatsForDate(yesterdayStart)?.focusScore ?: focusScore
            val scoreDiff = focusScore - yesterdayScore

            val streakDays = prefs.currentStreak

            JSONObject().apply {
                put("focusScore", focusScore)
                put("scoreDiffVsYesterday", scoreDiff)
                put("totalSpentToday", spentToday)
                put("totalSpentThisWeek", spentThisWeek)
                put("timeSavedMinutes", timeSavedMinutes)
                put("streakDays", streakDays)
                put("strictMode", prefs.isStrictModeEnabled)
            }.toString()
        }
    }

    /** Returns JSON array of 7 daily stats (oldest → today): {focusScore, totalSpent}. */
    @JavascriptInterface
    fun getWeeklyStats(): String {
        return runBlocking(Dispatchers.IO) {
            val result = JSONArray()
            for (daysAgo in 6 downTo 0) {
                val dayStart = getTodayStartMillis() - daysAgo * 86_400_000L
                val stats = db.dailyStatsDao().getStatsForDate(dayStart)
                result.put(JSONObject().apply {
                    put("focusScore", stats?.focusScore ?: 0)
                    put("totalSpent", stats?.totalSpentDollars ?: 0.0)
                })
            }
            result.toString()
        }
    }

    // ── Strict Mode ───────────────────────────────────────────────────────────

    @JavascriptInterface
    fun setStrictMode(enabled: Boolean) {
        prefs.isStrictModeEnabled = enabled
    }

    @JavascriptInterface
    fun getStrictMode(): Boolean = prefs.isStrictModeEnabled

    // ── Active Unlock ─────────────────────────────────────────────────────────

    /**
     * Returns JSON {expiresAt, minutesRemaining} if an active paid unlock exists,
     * or the string "null" if none. React uses this to show the countdown.
     */
    @JavascriptInterface
    fun getActiveUnlock(packageName: String): String {
        return runBlocking(Dispatchers.IO) {
            val now = System.currentTimeMillis()
            val unlocks = db.paymentDao().getActiveUnlocks(packageName, now)
            if (unlocks.isNotEmpty()) {
                JSONObject().apply {
                    put("expiresAt", unlocks[0].expiresAt)
                    put("minutesRemaining", ((unlocks[0].expiresAt - now) / 60_000).toInt())
                }.toString()
            } else "null"
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private fun hasUsageAccess(): Boolean {
        return try {
            val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
            mode == AppOpsManager.MODE_ALLOWED
        } catch (e: Exception) { false }
    }

    private fun getTodayStartMillis(): Long {
        return Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
    }
}
