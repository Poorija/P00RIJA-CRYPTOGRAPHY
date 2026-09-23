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

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * Looks for waiting mail on a phone that has no UnifiedPush distributor.
 *
 * This is the worse answer and it is meant to be. A distributor holds a socket
 * and the phone is woken the moment something arrives; this looks every
 * fifteen minutes at best, and under Doze considerably less often. It exists
 * so that somebody who will not install a distributor is not left with
 * nothing, not because it is a good substitute for one.
 *
 * WHAT IT SENDS
 *
 * A token and nothing else. "Does this fingerprint have mail" is exactly the
 * metadata the relay works to withhold, so the relay will not answer it to
 * anybody who asks -- the webview proves the identity once, the relay issues a
 * token bound to that fingerprint, and this carries the token. It can ask
 * about one mailbox, its own, and the answer is a count with no senders and no
 * timestamps in it.
 *
 * WHAT IT COSTS
 *
 * A bearer token at rest in app-private storage, and a request to the relay on
 * a schedule, which is a traffic pattern where there was none. Both are real,
 * both are why this is off until somebody turns it on, and the token can be
 * handed back the moment they turn it off.
 */
class MailPoller(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val config = readConfig(applicationContext) ?: return Result.success()
        val waiting = try {
            askRelay(config.origin, config.token)
        } catch (error: Throwable) {
            // A relay that is unreachable is not a failure worth retrying
            // aggressively; the next run is fifteen minutes away regardless.
            return Result.success()
        }
        if (waiting > 0) UnifiedPush.notifyArrival(applicationContext)
        return Result.success()
    }

    private fun askRelay(origin: String, token: String): Int {
        val connection = (URL("$origin/push/mailbox").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("X-P00RIJA-Poll-Token", token)
            connectTimeout = 15000
            readTimeout = 15000
            instanceFollowRedirects = false
        }
        try {
            if (connection.responseCode != 200) return 0
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            return JSONObject(body).optInt("waiting", 0)
        } finally {
            connection.disconnect()
        }
    }

    private data class Config(val origin: String, val token: String)

    private fun readConfig(context: Context): Config? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val origin = prefs.getString(KEY_ORIGIN, "").orEmpty()
        val token = prefs.getString(KEY_TOKEN, "").orEmpty()
        // https only: a token is a bearer credential and this runs on whatever
        // network the phone happens to be on.
        if (origin.isEmpty() || token.isEmpty() || !origin.startsWith("https://")) return null
        return Config(origin.trimEnd('/'), token)
    }

    companion object {
        private const val PREFS = "p00rija_mail_poller"
        private const val KEY_ORIGIN = "origin"
        private const val KEY_TOKEN = "token"
        private const val WORK_NAME = "p00rija-mail-poll"
        /** The platform's floor. Asking for less does not make it happen. */
        private const val INTERVAL_MINUTES = 15L

        /** Called from Rust once the webview has a token to hand over. */
        @JvmStatic
        fun enable(context: Context, origin: String, token: String): String {
            if (!origin.startsWith("https://")) {
                return "the relay origin must be https for a token to travel over it"
            }
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_ORIGIN, origin)
                .putString(KEY_TOKEN, token)
                .apply()
            val request = PeriodicWorkRequestBuilder<MailPoller>(INTERVAL_MINUTES, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                // Replace rather than keep: a new token has to displace the old
                // schedule, or the worker goes on presenting a revoked one.
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
            return ""
        }

        @JvmStatic
        fun disable(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
        }

        @JvmStatic
        fun isEnabled(context: Context): Boolean =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).contains(KEY_TOKEN)
    }
}
