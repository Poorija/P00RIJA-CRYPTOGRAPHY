package com.p00rija.cryptography

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * Keeps the process resident while the window is off screen.
   *
   * What this does and does not buy, measured on Android 15 rather than
   * assumed:
   *
   *   It does keep the process alive. oom_score_adj drops to 50 with the
   *   service running, so the app is not reclaimed, it resumes instantly with
   *   its state intact, and it picks up everything the relay queued the moment
   *   it comes back.
   *
   *   It does not keep the webview running. WryActivity.onPause() calls
   *   WebView.onPause(), and a process lifecycle observer calls Rust.pause()
   *   after that. Calling onResume()/resumeTimers() back — immediately, and
   *   again seven times over the following seconds — did not restart a single
   *   JavaScript timer across a 100-second background window. Android freezes
   *   the sandboxed renderer, and an app cannot ask it not to.
   *
   * That code was removed rather than left in as a hopeful no-op: it burned
   * battery retrying something the platform had already decided.
   *
   * Delivering a message to a backgrounded app therefore needs a push channel
   * the system itself wakes — FCM or UnifiedPush. See MOBILE_BUILD.md.
   */
  override fun onPause() {
    super.onPause()
    if (BackgroundPreference.keepRunning(this)) {
      KeepAliveService.start(this)
    }
  }

  override fun onResume() {
    super.onResume()
    KeepAliveService.stop(this)
  }

  override fun onDestroy() {
    KeepAliveService.stop(this)
    super.onDestroy()
  }
}
