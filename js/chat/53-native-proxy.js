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
   A proxy for the native app: a local v2ray, xray or Tor in front of the
   relay, set here instead of system-wide.
   ============================================================================

   Where it can be set, and where it cannot:

     Windows, Linux   here. The window's own network stack takes it (HTTP
                      CONNECT or SOCKS5), and so do the shell's own requests.
                      It applies when the window is created, so saving it
                      restarts the app.
     macOS            the system proxy (System Settings → Network → Proxies),
                      which the window follows. An in-app proxy there needs
                      macOS 14, and this app still runs on 12.
     Android, iOS     a VPN-mode client (v2rayNG, Streisand, …): the system
                      routes the app through it. Phones have no per-app proxy
                      for a web view.
     the web, a PWA   the same VPN-mode client. No page can set a proxy for
                      itself — the browser does not let it — so the row is
                      shown with the way that works instead of a field.

   What a proxy does not carry, said plainly: WebRTC media over UDP. So while
   a proxy is set, calls and direct transfers are made relay-only — through
   TURN, never directly between devices — and the peer's address never sees
   this one. The TURN server, which is the relay's own, still does.
   ============================================================================ */

const NATIVE_PROXY_PLATFORMS = new Set(['windows', 'linux']);
const NATIVE_PROXY_WAIT_MS = 10000;

/* Known before the first peer connection is built: the desktop bridge starts
   reading the shell settings the moment it loads, and buildChatTransport
   waits for this. A shell that does not answer in time is treated as
   proxied — relay-only until it says otherwise — never as direct. Any stored
   proxy counts, whatever the platform: failing closed is the point. */
const nativeProxyReady = (() => {
  if (!window.PoorijaDesktop?.available || !window.__POORIJA_SHELL_SETTINGS__) {
    chatState.nativeProxyActive = false;
    return Promise.resolve(false);
  }
  chatState.nativeProxyActive = true;
  const answered = window.__POORIJA_SHELL_SETTINGS__.then((settings) => {
    chatState.nativeProxyActive = Boolean(String(settings?.proxyUrl || '').trim());
    return chatState.nativeProxyActive;
  });
  return Promise.race([answered, new Promise((resolve) => window.setTimeout(() => resolve(true), NATIVE_PROXY_WAIT_MS))]);
})();

function nativeProxyHint(os, phone, browser = false) {
  if (browser) {
    return t('نسخهٔ وب و PWA نمی‌تواند خودش از پراکسی عبور کند؛ مرورگر به هیچ صفحه‌ای اجازهٔ تنظیم پراکسی نمی‌دهد. راهی که کار می‌کند: یک برنامهٔ v2ray/xray را روی دستگاه در حالت VPN روشن کنید (آیفون: Streisand یا V2Box؛ اندروید: v2rayNG)؛ سیستم مرورگر و همین برنامه را از آن عبور می‌دهد. برنامهٔ دسکتاپ روی ویندوز و لینوکس پراکسی را در خودش تنظیم می‌کند.',
      'The web app and the PWA cannot go through a proxy on their own: the browser lets no page set one. What works: turn on a v2ray/xray client on the device in VPN mode (iPhone: Streisand or V2Box; Android: v2rayNG); the system routes the browser, and this app with it, through it. The desktop app on Windows and Linux sets a proxy itself.');
  }
  if (phone) {
    return t('روی گوشی، از برنامه‌ای مثل v2rayNG در حالت VPN استفاده کنید؛ سیستم این برنامه را از آن عبور می‌دهد.',
      'On a phone, use a client such as v2rayNG in VPN mode; the system routes this app through it.');
  }
  if (os === 'macos') {
    return t('روی مک، پراکسی را در System Settings → Network → Proxies تنظیم کنید؛ پنجرهٔ برنامه از آن پیروی می‌کند.',
      'On a Mac, set the proxy in System Settings → Network → Proxies; the app window follows it.');
  }
  return t('مثلاً socks5://127.0.0.1:10808 برای v2ray/xray یا socks5://127.0.0.1:9050 برای Tor. با پراکسی، تماس‌ها فقط از مسیر رله برقرار می‌شوند تا آدرس شما به طرف مقابل نرسد.',
    'For example socks5://127.0.0.1:10808 for v2ray/xray, or socks5://127.0.0.1:9050 for Tor. With a proxy, calls go through the relay only, so your address never reaches the other side.');
}

async function renderNativeProxyRow() {
  const row = document.getElementById('chatProxyRow');
  const desktop = window.PoorijaDesktop;
  if (!row) return;
  if (!desktop?.available) {
    /* The web and the PWA: the row says how, since it cannot be a setting. */
    row.classList.remove('hidden');
    row.querySelector('.chat-proxy-input')?.classList.add('hidden');
    const note = document.getElementById('chatProxyNote');
    if (note) note.textContent = nativeProxyHint('', false, true);
    return;
  }
  row.classList.remove('hidden');
  const phone = Boolean(window.__POORIJA_NATIVE_MOBILE__);
  let os = '';
  try { os = String((await desktop.platformInfo())?.os || ''); } catch (_error) { os = ''; }
  const settable = !phone && NATIVE_PROXY_PLATFORMS.has(os);
  let current = '';
  try { current = String((await desktop.getShellSettings())?.proxyUrl || ''); } catch (_error) { current = ''; }
  chatState.nativeProxyActive = Boolean(current);
  const input = document.getElementById('chatProxyUrl');
  const save = document.getElementById('chatProxySaveBtn');
  if (input) {
    input.value = current;
    input.disabled = !settable;
    input.closest('.chat-proxy-input')?.classList.toggle('hidden', !settable);
  }
  if (save) save.disabled = !settable;
  const note = document.getElementById('chatProxyNote');
  if (note) note.textContent = nativeProxyHint(os, phone);
}

async function saveNativeProxy() {
  const desktop = window.PoorijaDesktop;
  const input = document.getElementById('chatProxyUrl');
  if (!desktop?.available || !input) return;
  let saved;
  try {
    saved = await desktop.setProxy(input.value.trim());
  } catch (error) {
    notify(String(error?.message || error || t('آدرس پراکسی معتبر نیست.', 'That proxy address is not valid.')), 'warning');
    return;
  }
  input.value = saved || '';
  const restart = await PoorijaDialogs.confirm(saved
    ? t(`پراکسی ${saved} ذخیره شد. برای اعمال، برنامه دوباره راه‌اندازی می‌شود.`, `The proxy ${saved} is saved. The app restarts to apply it.`)
    : t('پراکسی برداشته شد. برای اعمال، برنامه دوباره راه‌اندازی می‌شود.', 'The proxy is removed. The app restarts to apply it.'));
  if (restart) desktop.restart().catch(() => {});
}

document.getElementById('chatProxySaveBtn')?.addEventListener('click', () => { saveNativeProxy().catch(console.error); });
window.addEventListener('poorija:language-changed', () => { renderNativeProxyRow().catch(() => {}); });
window.setTimeout(() => { renderNativeProxyRow().catch(() => {}); }, 1500);
window.nativeProxyReady = nativeProxyReady;
