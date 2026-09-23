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

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Keeps the process alive while the window is not on screen.
 *
 * Android reclaims a backgrounded process whenever it feels like it, and a
 * chat client that is reclaimed stops receiving messages until the user opens
 * it again. A foreground service is the only sanctioned way to say "this
 * process is doing something the user asked for"; the persistent notification
 * is the price the platform charges for it, and it doubles as an honest signal
 * that the app is still connected.
 *
 * This deliberately does not use Firebase. Cloud Messaging would mean routing
 * a wake-up signal through Google for an app whose entire premise is that only
 * the relay the user chose sees any of their traffic. Holding the connection
 * open costs battery instead, which is a trade the user makes knowingly by
 * turning the setting on.
 */
class KeepAliveService : Service() {

    companion object {
        private const val CHANNEL_ID = "poorija_keep_alive"
        private const val NOTIFICATION_ID = 4711

        fun start(context: Context) {
            val intent = Intent(context, KeepAliveService::class.java)
            // Android 8 refuses startService() from the background; the
            // foreground variant is what survives the transition.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, KeepAliveService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14 wants the type restated at startForeground time, and
            // throws if it disagrees with the manifest.
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        // START_STICKY: if the system does kill us under memory pressure, come
        // back — the point of the service is to be there when a message lands.
        return START_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Background connection",
            // LOW: no sound, no heads-up. The user did not ask to be
            // interrupted by the fact that the app is running.
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shown while P00RIJA Cryptography stays connected in the background."
            setShowBadge(false)
            enableVibration(false)
            enableLights(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val launch = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("P00RIJA Cryptography")
            // Deliberately not "connected": Android freezes the webview when
            // the app is backgrounded, so nothing arrives until it is opened.
            // Claiming otherwise on a lock screen would be a lie the user only
            // discovers by missing a message.
            .setContentText("Kept in memory — open the app to receive waiting messages.")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(pending)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            // The notification says the app is connected and nothing else; a
            // messaging app's ongoing notification should not leak who from.
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .build()
    }
}
