/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The proxy row against a stand-in for the native shell.
 *
 * The shell's commands are answered by a mock of window.__TAURI__ (the Rust
 * side has its own tests and is compiled for every target), so what is
 * checked here is the page: where the row appears, what it says on each
 * platform, what it sends, and that calls go relay-only behind a proxy.
 */
import { chromium } from 'playwright';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const stacks = await startTwoStacks();
const browser = await chromium.launch();
async function shellPage({ os, proxyUrl = '', phone = false, probeEarly = false }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: phone ? 'Mozilla/5.0 (Linux; Android 15) Mobile' : undefined,
  });
  await context.addInitScript(({ osName, proxy }) => {
    try { localStorage.setItem('poorija_lang', 'en'); } catch (_error) { /* private */ }
    window.__shellCalls = [];
    let stored = proxy;
    window.__TAURI__ = {
      core: {
        invoke: async (command, payload) => {
          window.__shellCalls.push({ command, payload });
          if (command === 'desktop_platform_info') return { os: osName, arch: 'x86_64', appVersion: 'test' };
          if (command === 'desktop_get_shell_settings') return { closeBehavior: 'tray', proxyUrl: stored };
          if (command === 'desktop_set_proxy') {
            const value = String(payload?.url || '');
            if (value && !/^(http|socks5):\/\/[^/:]+:\d+$/.test(value)) throw new Error('the proxy needs a host and a port');
            stored = value;
            return value;
          }
          if (command === 'desktop_restart') return null;
          return null;
        },
      },
    };
  }, { osName: os, proxy: proxyUrl });
  const page = await context.newPage();
  await page.goto(`${stacks.a.url}/index.html`, { waitUntil: 'load' });
  if (probeEarly) {
    /* Right after load, long before the settings row is drawn. */
    page.__earlyState = await page.evaluate(async () => { await window.nativeProxyReady; return chatState.nativeProxyActive; });
  }
  await page.waitForTimeout(2500);
  return page;
}

try {
  const linux = await shellPage({ os: 'linux' });
  const row = await linux.evaluate(() => ({
    shown: !document.getElementById('chatProxyRow')?.classList.contains('hidden'),
    editable: !document.getElementById('chatProxyUrl')?.disabled,
    note: document.getElementById('chatProxyNote')?.textContent || '',
  }));
  check('on Linux the proxy can be set here', row.shown && row.editable, JSON.stringify(row));
  check('and the row says calls go relay-only behind it', /relay only/i.test(row.note), row.note);
  await linux.evaluate(() => {
    document.getElementById('chatProxyUrl').value = 'socks5://127.0.0.1:10808';
    document.getElementById('chatProxySaveBtn').click();
  });
  await linux.waitForTimeout(800);
  await linux.evaluate(() => document.querySelector('.poorija-dialog-ok')?.click());
  await linux.waitForTimeout(500);
  const calls = await linux.evaluate(() => window.__shellCalls.map((c) => `${c.command}:${c.payload?.url ?? ''}`));
  check('saving sends the address to the shell', calls.includes('desktop_set_proxy:socks5://127.0.0.1:10808'), calls.join(' '));
  check('and restarts the app to apply it', calls.some((c) => c.startsWith('desktop_restart')));

  const proxied = await shellPage({ os: 'windows', proxyUrl: 'socks5://127.0.0.1:9050' });
  const policy = await proxied.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 500));
    const config = { iceServers: [{ urls: 'turn:relay.example:3478', username: 'u', credential: 'c' }] };
    chatState.peer = chatState.peer || { options: { config } };
    if (!chatState.peer.options) chatState.peer.options = { config };
    chatState.peer.options.config = config;
    applyPathPolicyToPeerOptions({ fingerprint: 'ab'.repeat(32) });
    return { active: chatState.nativeProxyActive, policy: config.iceTransportPolicy || 'all', shown: document.getElementById('chatProxyUrl')?.value };
  });
  check('a proxy set on Windows is shown, and calls are made relay-only behind it', policy.active === true && policy.policy === 'relay' && policy.shown === 'socks5://127.0.0.1:9050', JSON.stringify(policy));
  const closed = await proxied.evaluate(async () => {
    const noTurn = { iceServers: [{ urls: 'stun:stun.example:3478' }] };
    chatState.peer.options.config = noTurn;
    applyPathPolicyToPeerOptions({ fingerprint: 'ab'.repeat(32) });
    const built = await buildIceConfigFor(null);
    return { shared: noTurn.iceTransportPolicy || 'all', built: built.iceTransportPolicy || 'all', base: peerOptions().config.iceTransportPolicy || 'all' };
  });
  check('with no TURN to relay through it still refuses a direct path', closed.shared === 'relay' && closed.built === 'relay' && closed.base === 'relay', JSON.stringify(closed));
  const early = await shellPage({ os: 'linux', proxyUrl: 'socks5://127.0.0.1:9050', probeEarly: true });
  check('and it is known before the first connection, not seconds later', early.__earlyState === true, String(early.__earlyState));

  const mac = await shellPage({ os: 'macos' });
  const macRow = await mac.evaluate(() => ({
    shown: !document.getElementById('chatProxyRow')?.classList.contains('hidden'),
    inputHidden: document.querySelector('.chat-proxy-input')?.classList.contains('hidden'),
    note: document.getElementById('chatProxyNote')?.textContent || '',
  }));
  check('on a Mac it points to the system proxy instead of pretending', macRow.shown && macRow.inputHidden && /System Settings/.test(macRow.note), JSON.stringify(macRow));

  const phone = await shellPage({ os: 'android', phone: true });
  const phoneRow = await phone.evaluate(() => document.getElementById('chatProxyNote')?.textContent || '');
  check('on a phone it points to a VPN-mode client', /VPN mode/.test(phoneRow), phoneRow);

  const plain = await browser.newPage();
  await plain.goto(`${stacks.a.url}/index.html`, { waitUntil: 'load' });
  await plain.waitForTimeout(2500);
  check('in a browser there is no proxy row at all', await plain.evaluate(() => document.getElementById('chatProxyRow')?.classList.contains('hidden')));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
