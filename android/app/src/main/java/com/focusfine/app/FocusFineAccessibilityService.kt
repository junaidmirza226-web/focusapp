package com.focusfine.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Calendar

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
        private const val REDIRECT_DEBOUNCE_MS = 1500L
        private const val EVENT_DEBOUNCE_MS = 500L

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

        fun forceBlockPackage(packageName: String, appName: String, strictMode: Boolean) {
            activeInstance?.postRedirect(packageName, appName, strictMode)
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mainHandler = Handler(Looper.getMainLooper())
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

    override fun onServiceConnected() {
        activeInstance = this
        serviceInfo = AccessibilityServiceInfo().apply {
            // Listen for both traditional window-state changes and OEM variants that
            // only emit windows-changed events during app transitions.
            eventTypes =
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOWS_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            // 100 ms debounce — fast enough to catch instant switches, avoids noise
            notificationTimeout = 100
            flags = 0
        }
        Log.d(TAG, "Accessibility service connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
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

        serviceScope.launch {
            val blockDecision = evaluateBlockingState(pkg, now)

            if (blockDecision != null) {
                FocusFineApp.lockedPackages.add(pkg)
                FocusFineApp.lockedPackageNames[pkg] = blockDecision.appName
                withContext(Dispatchers.Main) {
                    redirectToLockScreen(pkg, blockDecision.appName, blockDecision.strictMode)
                }
            } else {
                FocusFineApp.lockedPackages.remove(pkg)
                FocusFineApp.lockedPackageNames.remove(pkg)
            }
        }
    }

    override fun onInterrupt() {
        Log.d(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        if (activeInstance === this) {
            activeInstance = null
        }
        serviceScope.cancel()
    }

    private suspend fun evaluateBlockingState(
        packageName: String,
        now: Long
    ): BlockDecision? {
        val db = FocusFineApp.database
        val settings = db.userSettingsDao().getSettings(packageName) ?: return null
        if (!settings.isEnabled) return null

        val activeUnlocks = db.paymentDao().getActiveUnlocks(packageName, now)
        if (activeUnlocks.isNotEmpty()) return null

        val todayStart = getTodayStartMillis()
        val rawUsageMinutes = getUsageMinutesToday(packageName, todayStart, now)
        val baseUsage = if (todayStart > settings.lastResetDate) 0L else settings.baseUsageMinutes
        val effectiveUsage = (rawUsageMinutes - baseUsage).coerceAtLeast(0L)

        return if (effectiveUsage >= settings.dailyLimitMinutes.toLong()) {
            BlockDecision(
                appName = settings.appName.ifEmpty { packageName },
                strictMode = FocusFineApp.preferences.isStrictModeEnabled
            )
        } else {
            null
        }
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

    private fun postRedirect(packageName: String, appName: String, strictMode: Boolean) {
        mainHandler.post {
            redirectToLockScreen(packageName, appName, strictMode)
        }
    }

    private fun redirectToLockScreen(
        packageName: String,
        appName: String,
        strictMode: Boolean
    ) {
        val now = System.currentTimeMillis()
        if (packageName == lastRedirectedPackage && (now - lastRedirectAt) < REDIRECT_DEBOUNCE_MS) {
            return
        }

        lastRedirectedPackage = packageName
        lastRedirectAt = now

        Log.d(TAG, "Blocking $packageName ($appName) — limit exceeded")
        val intent = Intent(this, OverlayActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TASK
            )
            putExtra("LOCKED_PACKAGE", packageName)
            putExtra("APP_NAME", appName)
            putExtra("STRICT_MODE", strictMode)
        }

        try {
            startActivity(intent)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to launch lock screen; falling back to Home", t)
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

    private data class BlockDecision(
        val appName: String,
        val strictMode: Boolean
    )
}
