/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Going offline has to stay offline.
 *
 * The transport carries a supervisor on a 12-second interval that rebuilds
 * anything "not fully up". It read neither of the two flags that mean "this is
 * down on purpose", so it undid every deliberate disconnect a few seconds
 * later: the Disconnect button showed Offline and then quietly reconnected,
 * and a device told to step away kept draining its relay queue. The wait below
 * is longer than that interval on purpose — sampling once proves nothing.
 *
 * The other half is that the latch has to lift again. The Reconnect button is
 * disconnectChat() followed by a connect, so a latch that never cleared would
 * turn "reconnect" into "disconnect for good".
 *
 *   npm run relay ; PORT=8099 npm run dev ; node tests/e2e/disconnect.mjs
 */
import { chromium, webkit } from 'playwright';
import { settle } from './_settle.mjs';
const engine = process.env.E2E_ENGINE === 'webkit' ? webkit : chromium;
const BASE = process.env.PKG_URL || 'http://localhost:8099';
const RELAY = process.env.PKG_RELAY || 'http://localhost:9000';
const PASS = 'Offline#Pass2026!';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await engine.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await context.addInitScript(() => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (_e) {} });
const page = await context.newPage();
const transportLogs = [];
page.on('console', (m) => { const text = m.text(); if (text.includes('[Transport]')) transportLogs.push(text); });
page.on('pageerror', (e) => console.log('   !!', e.message.slice(0, 120)));

await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await settle(page);
await page.evaluate((pass) => {
  const set = (id, value) => { const el = document.getElementById(id); if (!el) return; el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('setupPassword', pass); set('confirmPassword', pass);
  document.querySelectorAll('#initialSetup select').forEach((s, i) => { if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  document.querySelectorAll('#initialSetup input[type="text"]').forEach((el, i) => { el.value = 'answer' + i; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const terms = document.getElementById('acceptTermsCheckbox'); if (terms && !terms.checked) { terms.checked = true; terms.dispatchEvent(new Event('change', { bubbles: true })); }
}, PASS);
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('setupBtn')?.click());
await page.waitForTimeout(3500);
await page.evaluate(() => { document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat'); });
await page.waitForTimeout(1200);
await page.evaluate((relay) => {
  const url = document.getElementById('chatServerUrl');
  if (url) { url.value = relay; url.dispatchEvent(new Event('input', { bubbles: true })); url.dispatchEvent(new Event('change', { bubbles: true })); }
  document.getElementById('chatConnectBtn')?.click();
}, RELAY);
await page.waitForTimeout(6000);

/* chatState is a module-level binding shared across js/chat/*, not a property
   of window, so it is read as a bare identifier here. */
const transport = () => page.evaluate(() => ({
  connected: chatState.connected,
  state: chatState.connectionState,
  socket: chatState.ws ? chatState.ws.readyState : null,
  manualOffline: Boolean(chatState.manualOffline),
  shouldReconnect: Boolean(chatState.shouldReconnect),
  dot: document.getElementById('chatConnectionDot')?.className || '',
  status: document.getElementById('chatConnectionStatus')?.textContent || '',
}));

const online = await transport();
check('the app is connected to the relay to begin with',
  online.connected === true && online.state === 'online' && online.socket === 1 && online.dot.includes('online'),
  JSON.stringify(online));

transportLogs.length = 0;
await page.evaluate(() => disconnectChat());
await page.waitForTimeout(1500);
const justAfter = await transport();
check('disconnecting drops the socket and latches the app offline',
  justAfter.connected === false && justAfter.state === 'offline' && justAfter.socket === null
  && justAfter.manualOffline === true && justAfter.shouldReconnect === false,
  JSON.stringify(justAfter));

/* Longer than the supervisor's own interval, or this measures nothing. */
await page.waitForTimeout(20000);
const later = await transport();
const rebuilds = transportLogs.filter((line) => line.includes('Supervisor: transport is not fully up'));
check('and it is still offline a full supervisor interval later',
  later.connected === false && later.socket === null && later.manualOffline === true,
  JSON.stringify(later));
check('the supervisor did not rebuild the transport behind the disconnect',
  rebuilds.length === 0, `${rebuilds.length} rebuild(s) in 20s`);

/* The Reconnect button's second half. */
await page.evaluate(() => connectChatTransport());
await page.waitForTimeout(7000);
const back = await transport();
check('connecting again lifts the latch and reconnects',
  back.connected === true && back.state === 'online' && back.socket === 1 && back.manualOffline === false,
  JSON.stringify(back));
check('and the status line says connected rather than disconnected',
  back.dot.includes('online') && !/قطع شد|Disconnected/i.test(back.status),
  JSON.stringify(back.status));

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====\n`);
process.exit(failed ? 1 : 0);
