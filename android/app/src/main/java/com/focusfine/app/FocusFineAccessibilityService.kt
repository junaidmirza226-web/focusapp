package com.focusfine.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import com.focusfine.app.db.BlockReason
import com.focusfine.app.db.UnlockScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap
import java.util.Calendar
import kotlin.coroutines.coroutineContext

/**
 * Intercepts every foreground app change and immediately redirects to OverlayActivity
 * when a locked package comes into view — including via Recent Apps, notifications, or
 * any other entry point. Reacts in <50 ms (event-driven, not polling).
 *
 * Uses a direct DB + UsageStats fallback so app blocking still works even if the
 * polling monitor hasn't refreshed the in-memory cache yet.
 */
class FocusFineAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "FocusFineA11y"
        // Keep anti-loop debounce tight so hostile rapid reopens are still intercepted.
        private const val REDIRECT_DEBOUNCE_MS = 120L
        private const val EVENT_DEBOUNCE_MS = 50L
        private const val FAST_PATH_CACHE_MS = 1500L

        private data class CachedBlockDecision(
            val appName: String,
            val strictMode: Boolean,
            val reason: BlockReason,
            val blockEndsAt: Long?,
            val unlockScope: UnlockScope,
            val cachedAt: Long
        )

        // Packages that should never trigger a lock redirect
        private val SYSTEM_PACKAGES = setOf(
            "com.android.systemui",
            "com.android.launcher",
            "com.android.launcher2",
            "com.android.launcher3",
            "com.google.android.apps.nexuslauncher",
            "com.sec.android.app.launcher",
            "com.miui.home",
            "com.coloros.launcher",       // Realme / OPPO
            "com.oppo.launcher",
            "com.realme.launcher",
            "com.android.settings",
            "com.android.packageinstaller"
        )

        @Volatile
        private var activeInstance: FocusFineAccessibilityService? = null
        private val recentBlockDecisions = ConcurrentHashMap<String, CachedBlockDecision>()

        fun forceBlockPackage(
            packageName: String,
            appName: String,
            strictMode: Boolean,
            reason: BlockReason = BlockReason.USAGE_LIMIT,
            blockEndsAt: Long? = null,
            unlockScope: UnlockScope = UnlockScope.REASON_ONLY
        ) {
            cacheDecision(
                packageName = packageName,
                appName = appName,
                strictMode = strictMode,
                reason = reason,
                blockEndsAt = blockEndsAt,
                unlockScope = unlockScope,
                now = System.currentTimeMillis()
            )
            activeInstance?.postRedirect(
                packageName = packageName,
                appName = appName,
                strictMode = strictMode,
                reason = reason,
                blockEndsAt = blockEndsAt,
                unlockScope = unlockScope
            )
        }

        private fun cacheDecision(
            packageName: String,
            appName: String,
            strictMode: Boolean,
            reason: BlockReason,
            blockEndsAt: Long?,
            unlockScope: UnlockScope,
            now: Long
        ) {
            recentBlockDecisions[packageName] = CachedBlockDecision(
                appName = appName,
                strictMode = strictMode,
                reason = reason,
                blockEndsAt = blockEndsAt,
                unlockScope = unlockScope,
                cachedAt = now
            )
        }

        private fun clearDecision(packageName: String) {
            recentBlockDecisions.remove(packageName)
        }

        private fun getFreshCachedDecision(
            packageName: String,
            now: Long
        ): CachedBlockDecision? {
            val cached = recentBlockDecisions[packageName] ?: return null
            if ((now - cached.cachedAt) > FAST_PATH_CACHE_MS) {
                recentBlockDecisions.remove(packageName)
                return null
            }
            return cached
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val decisionEngine by lazy { BlockingDecisionEngine(FocusFineApp.database) }
    private val usageStatsManager by lazy {
        getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    }

    @Volatile
    private var lastObservedPackage: String? = null

    @Volatile
    private var lastObservedAt: Long = 0L

    @Volatile
    private var lastRedirectedPackage: String? = null

    @Volatile
    private var lastRedirectAt: Long = 0L
    private var hasAttemptedMonitorStart = false
    private var lastMonitorStartAttemptAt = 0L
    private val evaluationJobs = ConcurrentHashMap<String, Job>()

    override fun onServiceConnected() {
        activeInstance = this
        serviceInfo = AccessibilityServiceInfo().apply {
            // Listen for both traditional window-state changes and OEM variants that
            // only emit windows-changed events during app transitions.
            eventTypes =
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOWS_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            // No framework batching delay on transitions; we handle debounce ourselves.
            notificationTimeout = 0
            flags = 0
        }
        ensureUsageMonitorServiceRunning()
        ActivationStateNotifier.broadcast(this)
        DiagnosticsTimeline.record(
            source = TAG,
            event = "service_connected",
            details = "onboardingComplete=${FocusFineApp.preferences.isOnboardingComplete}"
        )
        Log.d(TAG, "Accessibility service connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        ensureUsageMonitorServiceRunning()

        if (
            event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOWS_CHANGED
        ) return

        val pkg = event.packageName?.toString() ?: return

        // Never lock our own app or core system UI
        if (pkg == packageName) return
        if (SYSTEM_PACKAGES.any { pkg.startsWith(it) }) return

        val now = System.currentTimeMillis()
        if (pkg == lastObservedPackage && (now - lastObservedAt) < EVENT_DEBOUNCE_MS) return
        lastObservedPackage = pkg
        lastObservedAt = now

        val cachedDecision = getFreshCachedDecision(pkg, now)
        if (cachedDecision != null) {
            redirectToLockScreen(
                packageName = pkg,
                appName = cachedDecision.appName,
                strictMode = cachedDecision.strictMode,
                reason = cachedDecision.reason,
                blockEndsAt = cachedDecision.blockEndsAt,
                unlockScope = cachedDecision.unlockScope,
                eventObservedAt = now
            )
            return
        }

        val runningJob = evaluationJobs[pkg]
        if (runningJob?.isActive == true) {
            // Avoid cancel/relaunch thrash on event storms (notably Chrome first-run on API 34).
            // Let one evaluation complete, then the next event can enqueue a fresh decision.
            return
        }
        val evaluationJob = serviceScope.launch {
            val thisJob = coroutineContext[Job]
            try {
                val blockDecision = evaluateBlockingState(pkg, now)

                if (blockDecision != null) {
                    FocusFineApp.lockedPackages.add(pkg)
                    FocusFineApp.lockedPackageNames[pkg] = blockDecision.appName
                    cacheDecision(
                        packageName = pkg,
                        appName = blockDecision.appName,
                        strictMode = blockDecision.strictMode,
                        reason = blockDecision.reason,
                        blockEndsAt = blockDecision.blockEndsAt,
                        unlockScope = blockDecision.unlockScope,
                        now = System.currentTimeMillis()
                    )
                    withContext(Dispatchers.Main) {
                        redirectToLockScreen(
                            packageName = pkg,
                            appName = blockDecision.appName,
                            strictMode = blockDecision.strictMode,
                            reason = blockDecision.reason,
                            blockEndsAt = blockDecision.blockEndsAt,
                            unlockScope = blockDecision.unlockScope,
                            eventObservedAt = now
                        )
                    }
                } else {
                    FocusFineApp.lockedPackages.remove(pkg)
                    FocusFineApp.lockedPackageNames.remove(pkg)
                    clearDecision(pkg)
                }
            } catch (_: CancellationException) {
                // Ignore normal cancellation when service is shutting down.
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to process accessibility event for $pkg", t)
            } finally {
                if (thisJob != null) {
                    evaluationJobs.remove(pkg, thisJob)
                } else {
                    evaluationJobs.remove(pkg)
                }
            }
        }
        evaluationJobs[pkg] = evaluationJob
    }

    override fun onInterrupt() {
        ActivationStateNotifier.broadcast(this)
        DiagnosticsTimeline.record(source = TAG, event = "service_interrupted")
        Log.d(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        if (activeInstance === this) {
            activeInstance = null
        }
        serviceScope.cancel()
        ActivationStateNotifier.broadcast(this)
        DiagnosticsTimeline.record(source = TAG, event = "service_destroyed")
    }

    private suspend fun evaluateBlockingState(
        packageName: String,
        now: Long
    ): BlockDecision? {
        val todayStart = getTodayStartMillis()
        val evaluation = decisionEngine.evaluate(
            packageName = packageName,
            now = now,
            todayStartMillis = todayStart,
            rawUsageMinutesTodayProvider = {
                getUsageMinutesToday(
                    packageName = packageName,
                    todayStart = todayStart,
                    now = now
                )
            }
        )
        return evaluation.decision
    }

    private fun getUsageMinutesToday(
        packageName: String,
        todayStart: Long,
        now: Long
    ): Long {
        val statsMap = usageStatsManager.queryAndAggregateUsageStats(todayStart, now)
        val usage = statsMap?.get(packageName)
        return if (usage != null) usage.totalTimeInForeground / 60_000L else 0L
    }

    private fun postRedirect(
        packageName: String,
        appName: String,
        strictMode: Boolean,
        reason: BlockReason,
        blockEndsAt: Long?,
        unlockScope: UnlockScope
    ) {
        mainHandler.post {
            redirectToLockScreen(
                packageName = packageName,
                appName = appName,
                strictMode = strictMode,
                reason = reason,
                blockEndsAt = blockEndsAt,
                unlockScope = unlockScope,
                eventObservedAt = System.currentTimeMillis()
            )
        }
    }

    private fun ensureUsageMonitorServiceRunning() {
        if (!FocusFineApp.preferences.isOnboardingComplete) return
        val now = System.currentTimeMillis()
        val heartbeatAge = now - FocusFineApp.preferences.lastServiceCheckTime
        val serviceHealthy =
            FocusFineApp.preferences.isMonitoringServiceRunning && heartbeatAge in 0..15_000L
        if (serviceHealthy) {
            hasAttemptedMonitorStart = false
            return
        }
        if (hasAttemptedMonitorStart && (now - lastMonitorStartAttemptAt) < 3_000L) return

        hasAttemptedMonitorStart = true
        lastMonitorStartAttemptAt = now

        val intent = Intent(this, UsageMonitorService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            DiagnosticsTimeline.record(source = TAG, event = "monitor_start_requested_from_a11y")
            Log.d(TAG, "Requested UsageMonitorService start from accessibility binding")
        } catch (t: Throwable) {
            hasAttemptedMonitorStart = false
            DiagnosticsTimeline.record(
                source = TAG,
                event = "monitor_start_failed_from_a11y",
                details = t.javaClass.simpleName
            )
            Log.w(TAG, "Unable to start UsageMonitorService from accessibility binding", t)
        }
    }

    private fun redirectToLockScreen(
        packageName: String,
        appName: String,
        strictMode: Boolean,
        reason: BlockReason,
        blockEndsAt: Long?,
        unlockScope: UnlockScope,
        eventObservedAt: Long
    ) {
        val now = System.currentTimeMillis()
        if (packageName == lastRedirectedPackage && (now - lastRedirectAt) < REDIRECT_DEBOUNCE_MS) {
            return
        }

        lastRedirectedPackage = packageName
        lastRedirectAt = now

        val latencyMs = now - eventObservedAt
        Log.d(
            TAG,
            "Blocking $packageName ($appName) reason=$reason latency=${latencyMs}ms blockEndsAt=${blockEndsAt ?: -1L}"
        )
        DiagnosticsTimeline.record(
            source = TAG,
            event = "redirect_to_overlay",
            details = "pkg=$packageName reason=$reason latencyMs=$latencyMs"
        )
        val intent = Intent(this, OverlayActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_NO_ANIMATION
            )
            putExtra("LOCKED_PACKAGE", packageName)
            putExtra("APP_NAME", appName)
            putExtra("STRICT_MODE", strictMode)
            putExtra("BLOCK_REASON", reason.name)
            putExtra("BLOCK_ENDS_AT", blockEndsAt ?: -1L)
            putExtra("UNLOCK_SCOPE", unlockScope.name)
        }

        try {
            startActivity(intent)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to launch lock screen; falling back to Home", t)
            DiagnosticsTimeline.record(
                source = TAG,
                event = "overlay_launch_failed_fallback_home",
                details = t.javaClass.simpleName
            )
            performGlobalAction(GLOBAL_ACTION_HOME)
        }
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
