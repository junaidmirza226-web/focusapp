package com.focusfine.app

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.view.accessibility.AccessibilityManager

object AccessibilityGrantState {
    fun isServiceEnabled(context: Context): Boolean {
        // Prefer runtime manager signal, but fall back to secure settings when OEMs
        // temporarily return an empty enabled-service list during task/process churn.
        return isManagerReportingEnabled(context) || isSecureSettingEnabled(context)
    }

    private fun isManagerReportingEnabled(context: Context): Boolean {
        return try {
            val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
            am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK).any { serviceInfo ->
                serviceInfo.resolveInfo.serviceInfo.packageName == context.packageName &&
                    serviceInfo.resolveInfo.serviceInfo.name == FocusFineAccessibilityService::class.java.name
            }
        } catch (_: Throwable) {
            false
        }
    }

    private fun isSecureSettingEnabled(context: Context): Boolean {
        return try {
            val accessibilityEnabled = Settings.Secure.getInt(
                context.contentResolver,
                Settings.Secure.ACCESSIBILITY_ENABLED,
                0
            ) == 1
            if (!accessibilityEnabled) return false

            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ).orEmpty()
            if (enabledServices.isBlank()) return false

            val component = ComponentName(
                context.packageName,
                FocusFineAccessibilityService::class.java.name
            )
            val shortName = component.flattenToShortString()
            val fullName = component.flattenToString()

            enabledServices.split(':').any { raw ->
                val value = raw.trim()
                value.equals(shortName, ignoreCase = true) ||
                    value.equals(fullName, ignoreCase = true)
            }
        } catch (_: Throwable) {
            false
        }
    }
}
