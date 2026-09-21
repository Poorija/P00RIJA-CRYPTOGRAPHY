/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 3 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Call screen behaviour — FaceTime/Telegram habits
*/

/* =====================================================================
   Call screen behaviour — FaceTime/Telegram habits
   ---------------------------------------------------------------------
   Three things separate a call screen that feels native from one that
   feels like a web page: the chrome gets out of the way while you watch,
   the self-view can be moved and swapped, and a voice call shows that
   the other person is actually saying something.
   ===================================================================== */
const CALL_CHROME_IDLE_MS = 5000;

/* The tile is whichever stage is NOT the primary view. Read it from the DOM
   rather than from state so the answer cannot drift from what is painted. */
function isCallTile(element) {
  const win = document.querySelector('#chatFloatingCall .chat-floating-call-window');
  if (!win || win.dataset.callMode !== 'video') return false;
  const primary = win.dataset.callPrimary === 'local' ? 'chat-local-stage' : 'chat-remote-stage';
  return !element.classList.contains(primary);
}

function callShellElement() {
  return document.getElementById('chatFloatingCall');
}

/* Controls fade out while nothing is happening and come back on any input.
   Never hides while a menu is open — losing the sheet you just opened is the
   fastest way to make auto-hide feel broken. */
/* An idle timeout restarted by every caller is only as long as the gap between
   callers, and syncCallStageState runs on a video resize, a control refresh and
   a stream swap. Keep one timestamp of real user input and let a single poller
   decide, so a busy render loop cannot keep the chrome pinned open forever. */
function revealCallChrome() {
  callShellElement()?.classList.remove('chrome-hidden');
}
function noteCallActivity() {
  chatState.callLastInputAt = Date.now();
  revealCallChrome();
}
function startCallChromeWatcher() {
  stopCallChromeWatcher();
  noteCallActivity();
  chatState.callChromeTimer = window.setInterval(() => {
    const shell = callShellElement();
    if (!shell || !chatState.currentCall) return;
    /* A voice call has nothing to look at, so there is nothing to get out of
       the way of — only video hides its chrome. */
    if (chatState.currentCallMode !== 'video') {
      shell.classList.remove('chrome-hidden');
      return;
    }
    const menusOpen = !document.getElementById('chatCallMoreSheet')?.classList.contains('hidden')
      || !document.getElementById('chatCallSettingsPanel')?.classList.contains('hidden');
    if (menusOpen) {
      chatState.callLastInputAt = Date.now();
      return;
    }
    const idleFor = Date.now() - (chatState.callLastInputAt || 0);
    shell.classList.toggle('chrome-hidden', idleFor > CALL_CHROME_IDLE_MS);
  }, 700);
}
function stopCallChromeWatcher() {
  if (chatState.callChromeTimer) window.clearInterval(chatState.callChromeTimer);
  chatState.callChromeTimer = 0;
  callShellElement()?.classList.remove('chrome-hidden');
}

function toggleCallMoreSheet(force) {
  const sheet = document.getElementById('chatCallMoreSheet');
  const button = document.getElementById('chatCallMoreBtn');
  if (!sheet) return;
  const next = typeof force === 'boolean' ? force : sheet.classList.contains('hidden');
  sheet.classList.toggle('hidden', !next);
  button?.classList.toggle('is-active', next);
  button?.setAttribute('aria-expanded', next ? 'true' : 'false');
  noteCallActivity();
}
