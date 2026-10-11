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

import android.app.Activity
import android.content.Context
import android.view.WindowManager

/**
 * FLAG_SECURE on the app's window: no screenshots, no screen recording, and a
 * blank card in the recent-apps list. Switched from Settings through Rust
 * (mobile_screen_guard.rs) and remembered here, so the next start is covered
 * from its first frame rather than from whenever the web view gets round to it.
 */
object ScreenGuard {
  private const val PREFS = "poorija_screen_guard"
  private const val KEY = "on"

  @JvmStatic external fun nativeRegister(activity: Activity)

  @JvmStatic
  fun enabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

  @JvmStatic
  fun apply(activity: Activity, on: Boolean) {
    activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply()
    activity.runOnUiThread {
      if (on) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }
  }
}
