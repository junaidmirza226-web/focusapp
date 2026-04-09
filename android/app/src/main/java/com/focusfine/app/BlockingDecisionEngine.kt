package com.focusfine.app

import android.util.Log
import com.focusfine.app.db.AppDatabase
import com.focusfine.app.db.BlockReason
import com.focusfine.app.db.EnforcementMode
import com.focusfine.app.db.TimeBlockRule
import com.focusfine.app.db.UnlockScope
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

data class BlockDecision(
    val packageName: String,
    val appName: String,
    val reason: BlockReason,
    val blockEndsAt: Long?,
    val strictMode: Boolean,
    val unlockScope: UnlockScope
)

data class BlockingEvaluationResult(
    val decision: BlockDecision?,
    val effectiveUsageMinutes: Long,
    val usageLimitMinutes: Long,
    val enforcementMode: EnforcementMode,
    val usageRuleEnabled: Boolean,
    val timeRuleEnabled: Boolean,
    val matchedTimeRuleEndAt: Long?,
    val evaluationDurationMs: Long
)

/**
 * Central policy evaluator used by all enforcement surfaces.
 * Rule precedence is always:
 * 1) Time block
 * 2) Usage limit
 */
class BlockingDecisionEngine(
    private val database: AppDatabase,
    private val zoneId: ZoneId = ZoneId.systemDefault(),
    private val strictModeProvider: () -> Boolean = { FocusFineApp.preferences.isStrictModeEnabled }
) {
    companion object {
        private const val TAG = "BlockingDecisionEngine"
    }

    suspend fun evaluate(
        packageName: String,
        now: Long,
        todayStartMillis: Long,
        rawUsageMinutesToday: Long
    ): BlockingEvaluationResult {
        return evaluate(
            packageName = packageName,
            now = now,
            todayStartMillis = todayStartMillis,
            rawUsageMinutesTodayProvider = { rawUsageMinutesToday }
        )
    }

    suspend fun evaluate(
        packageName: String,
        now: Long,
        todayStartMillis: Long,
        rawUsageMinutesTodayProvider: suspend () -> Long
    ): BlockingEvaluationResult {
        val startedAt = System.currentTimeMillis()
        val settings = database.userSettingsDao().getSettings(packageName)
            ?: return emptyResult(EnforcementMode.USAGE_ONLY, startedAt)
        if (!settings.isEnabled) {
            return emptyResult(parseMode(settings.enforcementMode), startedAt)
        }

        val enforcementMode = parseMode(settings.enforcementMode)
        val usageRuleEnabled = when (enforcementMode) {
            EnforcementMode.USAGE_ONLY -> true
            EnforcementMode.TIME_ONLY -> false
            EnforcementMode.COMBINED -> true
        } && settings.usageLimitEnabled
        val timeRuleEnabled = when (enforcementMode) {
            EnforcementMode.USAGE_ONLY -> false
            EnforcementMode.TIME_ONLY -> true
            EnforcementMode.COMBINED -> true
        } && settings.timeBlockEnabled

        val appDisplayName = settings.appName.ifEmpty { packageName }
        val strictMode = strictModeProvider()
        val usageLimit = settings.dailyLimitMinutes.toLong()
        var rawUsageMinutesToday: Long? = null

        suspend fun getRawUsageMinutesToday(): Long {
            if (rawUsageMinutesToday == null) {
                rawUsageMinutesToday = rawUsageMinutesTodayProvider()
            }
            return rawUsageMinutesToday ?: 0L
        }

        // 1) Time block always wins in combined mode.
        var matchedTimeRuleEndAt: Long? = null
        if (timeRuleEnabled) {
            val timeRules = database.timeBlockRuleDao().getEnabledRulesForPackage(packageName)
            val matched = findActiveTimeBlock(now, timeRules)
            if (matched != null) {
                matchedTimeRuleEndAt = matched.second
                val timeUnlock = database.paymentDao().getActiveUnlocksForReason(
                    packageName = packageName,
                    blockReason = BlockReason.TIME_BLOCK.name,
                    currentTime = now
                )
                if (timeUnlock.isEmpty()) {
                    val effectiveUsage = if (usageRuleEnabled) {
                        computeEffectiveUsage(
                            rawUsageMinutesToday = getRawUsageMinutesToday(),
                            baseUsageMinutes = settings.baseUsageMinutes,
                            todayStartMillis = todayStartMillis,
                            lastResetDate = settings.lastResetDate
                        )
                    } else {
                        0L
                    }
                    return BlockingEvaluationResult(
                        decision = BlockDecision(
                            packageName = packageName,
                            appName = appDisplayName,
                            reason = BlockReason.TIME_BLOCK,
                            blockEndsAt = matchedTimeRuleEndAt,
                            strictMode = strictMode,
                            unlockScope = UnlockScope.REASON_ONLY
                        ),
                        effectiveUsageMinutes = effectiveUsage,
                        usageLimitMinutes = usageLimit,
                        enforcementMode = enforcementMode,
                        usageRuleEnabled = usageRuleEnabled,
                        timeRuleEnabled = timeRuleEnabled,
                        matchedTimeRuleEndAt = matchedTimeRuleEndAt,
                        evaluationDurationMs = System.currentTimeMillis() - startedAt
                    )
                }
                Log.d(
                    TAG,
                    "Active time block for $packageName was bypassed by a valid reason unlock"
                )
            }
        }

        // 2) Usage limit applies when time block does not currently block.
        val effectiveUsage = if (usageRuleEnabled) {
            computeEffectiveUsage(
                rawUsageMinutesToday = getRawUsageMinutesToday(),
                baseUsageMinutes = settings.baseUsageMinutes,
                todayStartMillis = todayStartMillis,
                lastResetDate = settings.lastResetDate
            )
        } else {
            0L
        }

        if (usageRuleEnabled && effectiveUsage >= usageLimit) {
            val usageUnlocks = database.paymentDao().getActiveUnlocksForReason(
                packageName = packageName,
                blockReason = BlockReason.USAGE_LIMIT.name,
                currentTime = now
            )
            if (usageUnlocks.isEmpty()) {
                return BlockingEvaluationResult(
                    decision = BlockDecision(
                        packageName = packageName,
                        appName = appDisplayName,
                        reason = BlockReason.USAGE_LIMIT,
                        blockEndsAt = null,
                        strictMode = strictMode,
                        unlockScope = UnlockScope.REASON_ONLY
                    ),
                    effectiveUsageMinutes = effectiveUsage,
                    usageLimitMinutes = usageLimit,
                    enforcementMode = enforcementMode,
                    usageRuleEnabled = usageRuleEnabled,
                    timeRuleEnabled = timeRuleEnabled,
                    matchedTimeRuleEndAt = matchedTimeRuleEndAt,
                    evaluationDurationMs = System.currentTimeMillis() - startedAt
                )
            }
            Log.d(
                TAG,
                "Usage limit block for $packageName was bypassed by a valid reason unlock"
            )
        }

        return BlockingEvaluationResult(
            decision = null,
            effectiveUsageMinutes = effectiveUsage,
            usageLimitMinutes = usageLimit,
            enforcementMode = enforcementMode,
            usageRuleEnabled = usageRuleEnabled,
            timeRuleEnabled = timeRuleEnabled,
            matchedTimeRuleEndAt = matchedTimeRuleEndAt,
            evaluationDurationMs = System.currentTimeMillis() - startedAt
        )
    }

    private fun emptyResult(
        mode: EnforcementMode,
        startedAt: Long
    ): BlockingEvaluationResult {
        return BlockingEvaluationResult(
            decision = null,
            effectiveUsageMinutes = 0L,
            usageLimitMinutes = 0L,
            enforcementMode = mode,
            usageRuleEnabled = false,
            timeRuleEnabled = false,
            matchedTimeRuleEndAt = null,
            evaluationDurationMs = System.currentTimeMillis() - startedAt
        )
    }

    private fun parseMode(raw: String): EnforcementMode {
        return try {
            EnforcementMode.valueOf(raw)
        } catch (_: IllegalArgumentException) {
            EnforcementMode.USAGE_ONLY
        }
    }

    private fun computeEffectiveUsage(
        rawUsageMinutesToday: Long,
        baseUsageMinutes: Long,
        todayStartMillis: Long,
        lastResetDate: Long
    ): Long {
        val baseUsage = if (todayStartMillis > lastResetDate) 0L else baseUsageMinutes
        return (rawUsageMinutesToday - baseUsage).coerceAtLeast(0L)
    }

    private fun findActiveTimeBlock(
        nowMillis: Long,
        rules: List<TimeBlockRule>
    ): Pair<TimeBlockRule, Long>? {
        if (rules.isEmpty()) return null

        val now = ZonedDateTime.ofInstant(Instant.ofEpochMilli(nowMillis), zoneId)
        val nowIsoDay = now.dayOfWeek.value // 1=Mon ... 7=Sun
        val minuteOfDay = now.hour * 60 + now.minute

        var chosen: Pair<TimeBlockRule, Long>? = null
        for (rule in rules) {
            val start = rule.startMinuteOfDay.coerceIn(0, 1439)
            val end = rule.endMinuteOfDay.coerceIn(0, 1439)
            val day = rule.dayOfWeek.coerceIn(1, 7)
            val nextDay = if (day == 7) 1 else day + 1

            if (start == end) continue

            if (end > start) {
                if (nowIsoDay == day && minuteOfDay in start until end) {
                    val endAt = now.withHour(end / 60).withMinute(end % 60).withSecond(0)
                        .withNano(0).toInstant().toEpochMilli()
                    chosen = chooseLongerActiveWindow(chosen, rule, endAt)
                }
            } else {
                if (nowIsoDay == day && minuteOfDay >= start) {
                    val endAt = now.plusDays(1)
                        .withHour(end / 60).withMinute(end % 60).withSecond(0).withNano(0)
                        .toInstant().toEpochMilli()
                    chosen = chooseLongerActiveWindow(chosen, rule, endAt)
                } else if (nowIsoDay == nextDay && minuteOfDay < end) {
                    val endAt = now.withHour(end / 60).withMinute(end % 60).withSecond(0)
                        .withNano(0).toInstant().toEpochMilli()
                    chosen = chooseLongerActiveWindow(chosen, rule, endAt)
                }
            }
        }
        return chosen
    }

    private fun chooseLongerActiveWindow(
        current: Pair<TimeBlockRule, Long>?,
        candidateRule: TimeBlockRule,
        candidateEndAt: Long
    ): Pair<TimeBlockRule, Long> {
        if (current == null) return candidateRule to candidateEndAt
        return if (candidateEndAt > current.second) {
            candidateRule to candidateEndAt
        } else {
            current
        }
    }
}
