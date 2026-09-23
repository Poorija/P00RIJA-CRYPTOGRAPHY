/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */
package com.p00rija.cryptography

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Waking this app without Google in the path.
 *
 * Android's WebView implements service workers but does not expose the Push
 * API to them -- that is a Chrome feature, not a WebView one -- so the browser
 * build's push route simply does not exist inside the native shell. FCM is one
 * answer and puts Google back in the middle of a suite whose whole premise is
 * that nothing but the chosen relay sees any traffic. UnifiedPush is the
 * other: a distributor app the person installed and chose holds the socket,
 * and the relay POSTs to a URL that distributor hands out.
 *
 * Spoken here as raw broadcasts rather than through the connector library. The
 * protocol is four intents wide, and a dependency that exists to send four
 * intents is a dependency to audit for no benefit.
 *
 * WHAT THE DISTRIBUTOR LEARNS
 *
 * That something arrived, and when. The payload the relay sends names no
 * sender, no recipient and no message -- see sendPushNotification in the
 * relay, and the suite that asserts all three absences. Choosing the
 * distributor is the person's decision, which is the entire point of
 * preferring this over a channel they cannot opt out of.
 */
object UnifiedPush {

    private const val PREFS = "p00rija_unifiedpush"
    private const val KEY_ENDPOINT = "endpoint"
    private const val KEY_DISTRIBUTOR = "distributor"
    /** Identifies this app to the distributor; any stable string will do. */
    private const val INSTANCE = "p00rija-cryptography"
    private const val CHANNEL_ID = "poorija_messages"

    // The UnifiedPush v2 intent vocabulary.
    const val ACTION_MESSAGE = "org.unifiedpush.android.connector.MESSAGE"
    const val ACTION_NEW_ENDPOINT = "org.unifiedpush.android.connector.NEW_ENDPOINT"
    const val ACTION_UNREGISTERED = "org.unifiedpush.android.connector.UNREGISTERED"
    const val ACTION_REGISTRATION_FAILED = "org.unifiedpush.android.connector.REGISTRATION_FAILED"
    private const val ACTION_REGISTER = "org.unifiedpush.android.distributor.REGISTER"
    private const val ACTION_UNREGISTER = "org.unifiedpush.android.distributor.UNREGISTER"

    /** Hands the virtual machine and the Activity to Rust, once. Same reason
     *  as SecureStore: nothing on the Rust side can find them by itself. */
    @JvmStatic
    external fun nativeRegister(context: Context)

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * Every installed app that can act as a distributor.
     *
     * Returned rather than picked for them: which app holds a socket to which
     * server on their behalf is exactly the choice this feature exists to give
     * back, and choosing silently would be the same paternalism as FCM with a
     * different logo.
     */
    @JvmStatic
    fun distributors(context: Context): List<String> {
        val intent = Intent(ACTION_REGISTER)
        return context.packageManager
            .queryBroadcastReceivers(intent, 0)
            .mapNotNull { it.activityInfo?.packageName }
            .distinct()
    }

    /** The endpoint the distributor gave us, or empty before one has. */
    @JvmStatic
    fun endpoint(context: Context): String =
        prefs(context).getString(KEY_ENDPOINT, "") ?: ""

    @JvmStatic
    fun distributor(context: Context): String =
        prefs(context).getString(KEY_DISTRIBUTOR, "") ?: ""

    /**
     * Asks a distributor for an endpoint.
     *
     * The answer arrives later, as a NEW_ENDPOINT broadcast, because the
     * distributor has to talk to its own server first. Returns whether the
     * request could be sent at all -- false means nothing on this phone can
     * act as a distributor, which is a thing to tell the person rather than
     * retry forever.
     */
    @JvmStatic
    fun register(context: Context, distributorPackage: String): Boolean {
        val target = distributorPackage.ifEmpty { distributors(context).firstOrNull().orEmpty() }
        if (target.isEmpty()) return false
        prefs(context).edit().putString(KEY_DISTRIBUTOR, target).apply()
        val intent = Intent(ACTION_REGISTER).apply {
            `package` = target
            putExtra("token", INSTANCE)
            putExtra("application", context.packageName)
        }
        context.sendBroadcast(intent)
        return true
    }

    /** Gives the endpoint back and forgets it. */
    @JvmStatic
    fun unregister(context: Context) {
        val target = distributor(context)
        if (target.isNotEmpty()) {
            context.sendBroadcast(Intent(ACTION_UNREGISTER).apply {
                `package` = target
                putExtra("token", INSTANCE)
            })
        }
        prefs(context).edit().remove(KEY_ENDPOINT).remove(KEY_DISTRIBUTOR).apply()
    }

    internal fun storeEndpoint(context: Context, endpoint: String) {
        prefs(context).edit().putString(KEY_ENDPOINT, endpoint).apply()
    }

    internal fun clearEndpoint(context: Context) {
        prefs(context).edit().remove(KEY_ENDPOINT).apply()
    }

    /**
     * Raises the notification a push is for.
     *
     * Deliberately says nothing beyond "something arrived". The bytes that
     * came through the distributor contain no sender and no text -- there is
     * nothing more to say, and inventing a name here would be a lie that a
     * lock screen makes very public.
     */
    internal fun notifyArrival(context: Context) {
        ensureChannel(context)
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP }
        val pending = launch?.let {
            PendingIntent.getActivity(
                context, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("P00RIJA Cryptography")
            .setContentText("A new message is waiting.")
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            // Nothing on the lock screen: the relay does not know who sent it
            // and neither does this, so there is nothing to reveal and no
            // reason to look as though there might be.
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .apply { if (pending != null) setContentIntent(pending) }
            .build()
        try {
            NotificationManagerCompat.from(context).notify(CHANNEL_ID.hashCode(), notification)
        } catch (error: Throwable) {
            /* Catching only SecurityException here meant a refused
               POST_NOTIFICATIONS was handled and everything else -- a channel
               the system would not take, a builder that threw -- vanished
               without a trace, which is how a push that arrives and shows
               nothing becomes impossible to diagnose. The message is still
               queued on the relay either way and arrives when the app opens. */
            android.util.Log.w("P00RIJA", "could not post the arrival notice: $error")
        }
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Tells you a message is waiting. It never carries the message."
                setShowBadge(true)
            }
        )
    }
}

/**
 * The four broadcasts a distributor sends back.
 *
 * Registered in the manifest rather than at runtime so a push can wake the app
 * from cold -- which is the entire point, and a receiver registered in code
 * dies with the process that registered it.
 */
class UnifiedPushReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            UnifiedPush.ACTION_NEW_ENDPOINT -> {
                val endpoint = intent.getStringExtra("endpoint").orEmpty()
                if (endpoint.isNotEmpty()) {
                    UnifiedPush.storeEndpoint(context, endpoint)
                    /* The webview registers it with the relay, because only it
                       holds the identity key the relay demands proof from. It
                       reads this the next time it looks; nothing is pushed at
                       it here, since the process may have no window at all. */
                }
            }
            UnifiedPush.ACTION_MESSAGE -> UnifiedPush.notifyArrival(context)
            UnifiedPush.ACTION_UNREGISTERED,
            UnifiedPush.ACTION_REGISTRATION_FAILED -> UnifiedPush.clearEndpoint(context)
        }
    }
}
