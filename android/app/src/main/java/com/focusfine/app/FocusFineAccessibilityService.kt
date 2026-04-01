package com.focusfine.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent

/**
 * Intercepts every foreground app change and immediately redirects to OverlayActivity
 * when a locked package comes into view — including via Recent Apps, notifications, or
 * any other entry point. Reacts in <50 ms (event-driven, not polling).
 *
 * Shared state with UsageMonitorService via FocusFineApp.lockedPackages (ConcurrentHashSet).
 * No DB access on the hot path.
 */
class FocusFineAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "FocusFineA11y"

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
    }

    override fun onServiceConnected() {
        serviceInfo = AccessibilityServiceInfo().apply {
            // Only listen for window-state changes (app switches) — no content reading needed
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            // 100 ms debounce — fast enough to catch instant switches, avoids noise
            notificationTimeout = 100
            flags = 0
        }
        Log.d(TAG, "Accessibility service connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val pkg = event.packageName?.toString() ?: return

        // Never lock our own app or core system UI
        if (pkg == packageName) return
        if (SYSTEM_PACKAGES.any { pkg.startsWith(it) }) return

        if (FocusFineApp.lockedPackages.contains(pkg)) {
            val appName = FocusFineApp.lockedPackageNames[pkg] ?: pkg
            Log.d(TAG, "Blocking $pkg ($appName) — limit exceeded")

            val intent = Intent(this, OverlayActivity::class.java).apply {
                // NEW_TASK required from a service context.
                // CLEAR_TOP + SINGLE_TOP prevents stacking multiple OverlayActivity instances.
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
                )
                putExtra("LOCKED_PACKAGE", pkg)
                putExtra("APP_NAME", appName)
                putExtra("STRICT_MODE", FocusFineApp.preferences.isStrictModeEnabled)
            }
            startActivity(intent)
        }
    }

    override fun onInterrupt() {
        Log.d(TAG, "Accessibility service interrupted")
    }
}
