/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* ============================================================================
   Screen guard: keeping what is on screen out of screenshots, recordings,
   screen shares and the app switcher.
   ============================================================================

   What each platform can actually do, and what this switch does on it:

     Android (native)  FLAG_SECURE: screenshots and screen recording are
                       refused by the system, the recent-apps card is blank.
     Windows, macOS    content protection: the window is left out of
     (native)          screenshots, recordings and screen sharing.
     Linux (native),   no system switch exists. The page covers itself the
     iOS, browsers     moment it is hidden or loses focus, which keeps it out
                       of the app switcher's snapshot and away from a glance —
                       but a screenshot of the visible window cannot be
                       stopped there, and the settings line says so.

   The cover is the same on every platform, on top of whatever the system
   adds. The choice is kept outside the vault, so the lock screen is covered
   too, and it is not a secret: it says only that the switch is on.
   ============================================================================ */
(function () {
  const STORAGE_KEY = 'poorija_screen_guard';
  const desktop = () => window.PoorijaDesktop;

  function readChoice() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (_error) { return false; }
  }
  let enabled = readChoice();
  let enforcedBySystem = false;

  function cover(on) {
    document.documentElement.classList.toggle('screen-shield', Boolean(on) && enabled);
  }

  function language() {
    return (document.documentElement.lang || 'fa').startsWith('en') ? 'en' : 'fa';
  }
  function say(fa, en) {
    return language() === 'en' ? en : fa;
  }

  function renderStatus() {
    const toggle = document.getElementById('screenGuardToggle');
    if (toggle) toggle.checked = enabled;
    const note = document.getElementById('screenGuardStatus');
    if (!note) return;
    if (!enabled) {
      note.textContent = '';
      note.classList.add('hidden');
      return;
    }
    note.classList.remove('hidden');
    note.textContent = enforcedBySystem
      ? say('روشن است و سیستم هم جلوی اسکرین‌شات و ضبط صفحه را می‌گیرد.', 'On, and the system itself refuses screenshots and screen recording.')
      : say('روشن است: صفحه هنگام پنهان شدن یا خروج از فوکوس پوشانده می‌شود. روی این پلتفرم جلوی اسکرین‌شاتِ پنجرهٔ باز را نمی‌شود گرفت.',
        'On: the screen is covered whenever it is hidden or loses focus. On this platform a screenshot of the open window cannot be stopped.');
  }

  async function applyNative(on) {
    const bridge = desktop();
    if (!bridge?.available || typeof bridge.setScreenGuard !== 'function') {
      enforcedBySystem = false;
      return false;
    }
    try {
      enforcedBySystem = Boolean(await bridge.setScreenGuard(on));
    } catch (error) {
      console.warn('[ScreenGuard] the system switch failed:', error);
      enforcedBySystem = false;
    }
    return enforcedBySystem;
  }

  async function setScreenGuard(on) {
    enabled = Boolean(on);
    try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_error) { /* private mode */ }
    if (!enabled) cover(false);
    await applyNative(enabled);
    renderStatus();
    return enforcedBySystem;
  }

  document.addEventListener('visibilitychange', () => cover(document.visibilityState !== 'visible'));
  window.addEventListener('pagehide', () => cover(true));
  window.addEventListener('blur', () => cover(true));
  window.addEventListener('focus', () => cover(false));
  /* A tap or a key while covered is somebody using the app again. */
  document.addEventListener('pointerdown', () => { if (document.hasFocus()) cover(false); }, true);

  document.addEventListener('change', (event) => {
    if (event.target?.id === 'screenGuardToggle') setScreenGuard(event.target.checked).catch(() => {});
  });
  window.addEventListener('poorija:language-changed', renderStatus);

  function boot() {
    renderStatus();
    /* The native shell keeps its own copy of the choice; this makes sure the
       two never disagree after an update or a restore. */
    if (enabled) applyNative(true).then(renderStatus).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PoorijaScreenGuard = { set: setScreenGuard, enabled: () => enabled, enforced: () => enforcedBySystem };
}());
