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
import org.json.JSONObject
import java.io.File

/**
 * Reads the same `shell-settings.json` the Rust side writes.
 *
 * The alternative was a JNI bridge or a Tauri plugin just to move one boolean
 * from the settings screen into Kotlin. Both sides already agree on this file —
 * `desktop_set_shell_settings` writes it, and the JavaScript toggle drives that
 * command — so reading it here keeps one source of truth instead of two that
 * can disagree.
 */
object BackgroundPreference {

    fun keepRunning(context: Context): Boolean {
        val settings = readSettings(context) ?: return false
        // "tray" is the desktop name for the same idea: stay alive when the
        // window goes away. Absent or "quit" means let the OS reclaim us.
        return settings.optString("closeBehavior", "quit") == "tray"
    }

    private fun readSettings(context: Context): JSONObject? {
        // Tauri's app_data_dir maps to different roots across Android
        // versions, so try the candidates rather than pinning one.
        val candidates = listOf(
            File(context.filesDir, "shell-settings.json"),
            File(context.dataDir, "files/shell-settings.json"),
            File(context.dataDir, "shell-settings.json"),
            File(context.noBackupFilesDir, "shell-settings.json")
        )
        for (file in candidates) {
            try {
                if (file.isFile) {
                    return JSONObject(file.readText())
                }
            } catch (error: Exception) {
                // A half-written or unreadable file is the same as no
                // preference: do not keep the process alive on a guess.
            }
        }
        return null
    }
}
