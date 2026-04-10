package com.focusfine.app

import android.content.Context
import android.content.Intent

object ActivationStateNotifier {
    const val ACTION = "com.focusfine.app.ACTIVATION_STATE_CHANGED"

    fun broadcast(context: Context) {
        context.sendBroadcast(Intent(ACTION).setPackage(context.packageName))
    }
}
