package com.focusfine.app

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Base64
import android.webkit.JavascriptInterface
import androidx.core.graphics.drawable.toBitmap
import com.focusfine.app.db.BlockReason
import com.focusfine.app.db.EnforcementMode
import com.focusfine.app.db.TimeBlockRule
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
    private val decisionEngine by lazy { BlockingDecisionEngine(db) }

    // ── Permissions ──────────────────────────────────────────────────────────

    @JavascriptInterface
    fun isPermissionsGranted(): String {
        val usageAccess = hasUsageAccess()
        val overlay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            Settings.canDrawOverlays(context) else true
        val accessibility = hasAccessibilityServiceEnabled()
        return JSONObject().apply {
            put("usageAccess", usageAccess)
            put("overlay", overlay)
            put("accessibility", accessibility)
            put("onboardingComplete", prefs.isOnboardingComplete)
        }.toString()
    }

    @JavascriptInterface
    fun isAccessibilityGranted(): Boolean = hasAccessibilityServiceEnabled()

    @JavascriptInterface
    fun requestAccessibilityService() {
        activityRef.get()?.runOnUiThread {
            context.startActivity(
                Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
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
            .filter { info ->
                // Only exclude FocusFine itself — show everything else that appears in the launcher.
                // On many OEM devices (Realme, Oppo etc.) social apps ship preinstalled with
                // FLAG_SYSTEM set, so a system-flag filter would silently hide them.
                info.activityInfo.packageName != context.packageName
            }
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
            val todayStart = getTodayStartMillis()
            val currentUsage = getCurrentTotalUsageToday(packageName)
            val existing = db.userSettingsDao().getSettings(packageName)
            
            if (existing != null) {
                db.userSettingsDao().update(
                    existing.copy(
                        dailyLimitMinutes = limitMinutes, 
                        appName = appName, 
                        isEnabled = true,
                        baseUsageMinutes = currentUsage,
                        lastResetDate = todayStart,
                        enforcementMode = EnforcementMode.USAGE_ONLY.name,
                        usageLimitEnabled = true,
                        timeBlockEnabled = false
                    )
                )
            } else {
                db.userSettingsDao().insert(
                    UserSettings(
                        packageName = packageName, 
                        dailyLimitMinutes = limitMinutes, 
                        appName = appName,
                        baseUsageMinutes = currentUsage,
                        lastResetDate = todayStart,
                        enforcementMode = EnforcementMode.USAGE_ONLY.name,
                        usageLimitEnabled = true,
                        timeBlockEnabled = false
                    )
                )
            }
        }
    }

    /**
     * Saves full per-app policy JSON:
     * {
     *   packageName, appName, dailyLimitMinutes, isEnabled,
     *   enforcementMode: USAGE_ONLY|TIME_ONLY|COMBINED,
     *   usageLimitEnabled, timeBlockEnabled,
     *   timeRules: [{dayOfWeek,startMinuteOfDay,endMinuteOfDay,isEnabled}]
     * }
     */
    @JavascriptInterface
    fun saveAppPolicy(policyJson: String): Boolean {
        return runBlocking(Dispatchers.IO) {
            try {
                val obj = JSONObject(policyJson)
                val packageName = obj.optString("packageName", "")
                if (packageName.isBlank()) return@runBlocking false

                val appName = obj.optString("appName", packageName)
                val limitMinutes = obj.optInt("dailyLimitMinutes", 30).coerceAtLeast(1)
                val isEnabled = obj.optBoolean("isEnabled", true)
                val enforcementMode = parseMode(obj.optString("enforcementMode", EnforcementMode.COMBINED.name))
                val usageEnabled = obj.optBoolean("usageLimitEnabled", true)
                val timeEnabled = obj.optBoolean("timeBlockEnabled", false)

                val todayStart = getTodayStartMillis()
                val currentUsage = getCurrentTotalUsageToday(packageName)
                val existing = db.userSettingsDao().getSettings(packageName)

                if (existing != null) {
                    db.userSettingsDao().update(
                        existing.copy(
                            appName = appName,
                            dailyLimitMinutes = limitMinutes,
                            isEnabled = isEnabled,
                            enforcementMode = enforcementMode.name,
                            usageLimitEnabled = usageEnabled,
                            timeBlockEnabled = timeEnabled,
                            baseUsageMinutes = currentUsage,
                            lastResetDate = todayStart
                        )
                    )
                } else {
                    db.userSettingsDao().insert(
                        UserSettings(
                            packageName = packageName,
                            appName = appName,
                            dailyLimitMinutes = limitMinutes,
                            isEnabled = isEnabled,
                            enforcementMode = enforcementMode.name,
                            usageLimitEnabled = usageEnabled,
                            timeBlockEnabled = timeEnabled,
                            baseUsageMinutes = currentUsage,
                            lastResetDate = todayStart
                        )
                    )
                }

                if (obj.has("timeRules")) {
                    val rules = obj.optJSONArray("timeRules") ?: JSONArray()
                    upsertTimeRules(packageName, rules)
                }
                true
            } catch (_: Exception) {
                false
            }
        }
    }

    @JavascriptInterface
    fun setTimeBlockRules(packageName: String, rulesJson: String): Boolean {
        return runBlocking(Dispatchers.IO) {
            try {
                val rulesArray = JSONArray(rulesJson)
                upsertTimeRules(packageName, rulesArray)
                true
            } catch (_: Exception) {
                false
            }
        }
    }

    @JavascriptInterface
    fun removeApp(packageName: String) {
        runBlocking(Dispatchers.IO) {
            db.userSettingsDao().getSettings(packageName)?.let {
                db.userSettingsDao().delete(it)
            }
            db.timeBlockRuleDao().deleteByPackage(packageName)
            FocusFineApp.lockedPackages.remove(packageName)
            FocusFineApp.lockedPackageNames.remove(packageName)
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
                        put("enforcementMode", app.enforcementMode)
                        put("usageLimitEnabled", app.usageLimitEnabled)
                        put("timeBlockEnabled", app.timeBlockEnabled)
                    })
                }
            result.toString()
        }
    }

    @JavascriptInterface
    fun getAppPolicies(): String {
        return runBlocking(Dispatchers.IO) {
            val result = JSONArray()
            db.userSettingsDao().getAllSettings()
                .filter { it.isEnabled }
                .forEach { app ->
                    val rulesJson = JSONArray()
                    db.timeBlockRuleDao().getRulesForPackage(app.packageName).forEach { rule ->
                        rulesJson.put(JSONObject().apply {
                            put("id", rule.id)
                            put("dayOfWeek", rule.dayOfWeek)
                            put("startMinuteOfDay", rule.startMinuteOfDay)
                            put("endMinuteOfDay", rule.endMinuteOfDay)
                            put("isEnabled", rule.isEnabled)
                        })
                    }
                    result.put(JSONObject().apply {
                        put("packageName", app.packageName)
                        put("appName", app.appName)
                        put("dailyLimitMinutes", app.dailyLimitMinutes)
                        put("enforcementMode", app.enforcementMode)
                        put("usageLimitEnabled", app.usageLimitEnabled)
                        put("timeBlockEnabled", app.timeBlockEnabled)
                        put("timeRules", rulesJson)
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
                    val rawUsed = db.appUsageDao().getUsageForDate(app.packageName, todayStart)?.totalTimeMinutes ?: 0L
                    // Subtract baseUsageMinutes so the UI shows usage since limit was set,
                    // not total usage from midnight. Matches the lock logic in UsageMonitorService.
                    val effectiveBase = if (todayStart > app.lastResetDate) 0L else app.baseUsageMinutes
                    val effectiveUsed = (rawUsed - effectiveBase).coerceAtLeast(0L)
                    result.put(JSONObject().apply {
                        put("packageName", app.packageName)
                        put("usedMinutes", effectiveUsed)
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

    @JavascriptInterface
    fun getCurrentBlockState(packageName: String): String {
        return runBlocking(Dispatchers.IO) {
            val now = System.currentTimeMillis()
            val todayStart = getTodayStartMillis()
            val rawUsage = getCurrentTotalUsageToday(packageName)
            val evaluation = decisionEngine.evaluate(
                packageName = packageName,
                now = now,
                todayStartMillis = todayStart,
                rawUsageMinutesToday = rawUsage
            )

            JSONObject().apply {
                put("packageName", packageName)
                put("blocked", evaluation.decision != null)
                put("reason", evaluation.decision?.reason?.name ?: JSONObject.NULL)
                put("blockEndsAt", evaluation.decision?.blockEndsAt ?: JSONObject.NULL)
                put("effectiveUsageMinutes", evaluation.effectiveUsageMinutes)
                put("usageLimitMinutes", evaluation.usageLimitMinutes)
                put("enforcementMode", evaluation.enforcementMode.name)
                put("usageRuleEnabled", evaluation.usageRuleEnabled)
                put("timeRuleEnabled", evaluation.timeRuleEnabled)
                put("evaluationDurationMs", evaluation.evaluationDurationMs)
            }.toString()
        }
    }

    @JavascriptInterface
    fun getUnlockQuote(packageName: String, reasonRaw: String): String {
        return runBlocking(Dispatchers.IO) {
            val reason = parseBlockReason(reasonRaw)
            val todayStart = getTodayStartMillis()
            val count = db.paymentDao().getUnlockCountTodayForReason(
                packageName = packageName,
                blockReason = reason.name,
                todayStart = todayStart
            )
            val multiplier = (count + 1).coerceAtMost(3)
            val base = when (reason) {
                BlockReason.TIME_BLOCK -> Triple(3, 12, 40)
                BlockReason.USAGE_LIMIT -> Triple(1, 5, 20)
            }
            JSONObject().apply {
                put("reason", reason.name)
                put("unlockCountToday", count)
                put("quickAmount", base.first * multiplier)
                put("extendedAmount", base.second * multiplier)
                put("dailyAmount", base.third * multiplier)
            }.toString()
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    @JavascriptInterface
    fun setOnboardingComplete(complete: Boolean) {
        prefs.isOnboardingComplete = complete
    }

    private suspend fun upsertTimeRules(packageName: String, rulesArray: JSONArray) {
        val rules = mutableListOf<TimeBlockRule>()
        for (i in 0 until rulesArray.length()) {
            val row = rulesArray.optJSONObject(i) ?: continue
            val day = row.optInt("dayOfWeek", 1).coerceIn(1, 7)
            val start = row.optInt("startMinuteOfDay", 0).coerceIn(0, 1439)
            val end = row.optInt("endMinuteOfDay", 0).coerceIn(0, 1439)
            val enabled = row.optBoolean("isEnabled", true)
            rules.add(
                TimeBlockRule(
                    packageName = packageName,
                    dayOfWeek = day,
                    startMinuteOfDay = start,
                    endMinuteOfDay = end,
                    isEnabled = enabled
                )
            )
        }
        db.timeBlockRuleDao().deleteByPackage(packageName)
        if (rules.isNotEmpty()) {
            db.timeBlockRuleDao().insertAll(rules)
        }
    }

    private fun parseMode(raw: String?): EnforcementMode {
        return try {
            EnforcementMode.valueOf(raw ?: EnforcementMode.COMBINED.name)
        } catch (_: IllegalArgumentException) {
            EnforcementMode.COMBINED
        }
    }

    private fun parseBlockReason(raw: String?): BlockReason {
        return try {
            BlockReason.valueOf(raw ?: BlockReason.USAGE_LIMIT.name)
        } catch (_: IllegalArgumentException) {
            BlockReason.USAGE_LIMIT
        }
    }

    private fun hasAccessibilityServiceEnabled(): Boolean {
        val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE)
            as android.view.accessibility.AccessibilityManager
        return am.getEnabledAccessibilityServiceList(
            android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK
        ).any {
            it.resolveInfo.serviceInfo.packageName == context.packageName &&
            it.resolveInfo.serviceInfo.name == FocusFineAccessibilityService::class.java.name
        }
    }

    private fun hasUsageAccess(): Boolean {
        return try {
            val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
            val appOpsGranted = mode == AppOpsManager.MODE_ALLOWED
            
            // Smart Fallback: Actually try to query UsageStatsManager.
            // If it returns any data, the permission is definitely working.
            if (!appOpsGranted) {
                val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
                val now = System.currentTimeMillis()
                val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 1000 * 60, now)
                stats != null && stats.isNotEmpty()
            } else {
                true
            }
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

    private fun getCurrentTotalUsageToday(packageName: String): Long {
        // MUST use queryAndAggregateUsageStats — same method as UsageMonitorService.
        // queryUsageStats(INTERVAL_DAILY) returns different values and causes the effective
        // usage to go negative (clamped to 0), preventing locks from ever firing.
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val now = System.currentTimeMillis()
        val statsMap = usm.queryAndAggregateUsageStats(getTodayStartMillis(), now)
        val usage = statsMap?.get(packageName)
        return if (usage != null) usage.totalTimeInForeground / 1000L / 60L else 0L
    }
}
