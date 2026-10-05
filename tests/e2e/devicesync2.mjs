/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The history half of device sync, end to end in two real browsers.
 *
 * Phase one proved on the wire that two sockets holding one identity
 * coexist and both receive live frames. This is what a linked device is
 * FOR: the machine that was linked yesterday, or was away this morning,
 * collecting the conversations it never saw. One page holds a history;
 * a second page adopts the same identity exactly the way the portable
 * profile import does; the sibling's appearance is the trigger, and the
 * bundle arrives sealed — same envelope machinery as offline mail, so
 * the relay carries it and cannot read it.
 *
 * What has to hold:
 *   - the text history arrives, entry for entry, without duplicates
 *   - an attachment row arrives WITHOUT its session-local blob url
 *   - the call log arrives
 *   - the machine that sent it is unchanged by its own broadcast
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const RELAY_FOR_PAGE = process.env.RELAY_URL
  || (/^https:/i.test(BASE_URL) ? String(BASE_URL).replace(/\/+$/, '') : 'http://localhost:9000');
const PASS = 'Harness#Pass2026!';

const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

/* Two genuinely separate installs: a phone in portrait and a desktop in
   landscape. The histories they hold must survive on shape alone. */
const browser = await chromium.launch();
async function makePage(tag, w, h, mobile = false) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h }, permissions: ['microphone', 'camera'], isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(() => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {} window.__clip = []; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`   ${tag}!! ${e.message.slice(0, 140)}`));
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(2200);
  await page.evaluate(() => { if (typeof continueInBrowserExperience === 'function') continueInBrowserExperience(); });
  await page.waitForTimeout(600);
  await page.evaluate((pass) => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('setupPassword', pass); set('confirmPassword', pass);
    document.querySelectorAll('#initialSetup select').forEach((s, i) => { if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => { inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true })); });
    const cb = document.getElementById('acceptTermsCheckbox'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  }, PASS);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const w = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__clip.push(t); return w(t).catch(() => {}); };
    document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');
  });
  await page.waitForTimeout(700);
  await page.evaluate((RELAY_FOR_PAGE) => {
    const url = document.getElementById('chatServerUrl');
    if (url) { url.value = RELAY_FOR_PAGE; url.dispatchEvent(new Event('input', { bubbles: true })); url.dispatchEvent(new Event('change', { bubbles: true })); }
    document.getElementById('chatConnectBtn')?.click();
  }, RELAY_FOR_PAGE);
  await page.waitForTimeout(6500);
  return page;
}

const CONV = 'c'.repeat(64);

console.log('\nDevice sync — the history half');

/* The machine that already has the past. */
const A = await makePage('A', 1440, 900);
await A.evaluate((conv) => {
  appendHistory(conv, { id: 'sync-text-1', direction: 'out', type: 'text', text: 'salam from A', status: 'delivered', createdAt: new Date().toISOString() });
  appendHistory(conv, { id: 'sync-text-2', direction: 'in', type: 'text', text: 'the reply', status: 'seen', createdAt: new Date().toISOString() });
  appendHistory(conv, { id: 'sync-file-1', direction: 'in', type: 'file', name: 'pic.jpg', size: 2048, mime: 'image/jpeg', status: 'delivered', downloadUrl: 'blob:fake-session-url', createdAt: new Date().toISOString() });
  appendCall({ id: 'sync-call-1', name: 'Somebody', peerId: 'peer-x', mode: 'voice', status: 'missed', direction: 'in', createdAt: new Date(Date.now() - 60000).toISOString(), standalone: true });
  storeHistory();
  saveCalls();
}, CONV);

const identityOfA = await A.evaluate(() => ({
  publicKeyData: chatState.identity.publicKeyData,
  privateKeyData: chatState.identity.privateKeyData,
  fingerprint: chatState.identity.fingerprint,
  createdAt: chatState.identity.createdAt || '',
}));
check('the first device has an identity to share', Boolean(identityOfA.fingerprint));

/* The machine that was linked: fresh install, then the identity the
   portable profile import would have delivered, adopted the same way
   the import adopts it. */
const B = await makePage('B', 430, 932, true);
await B.evaluate(async (ident) => {
  chatState.shouldReconnect = false;
  try { chatState.ws?.close(); } catch (_error) { /* already gone */ }
  await new Promise((r) => setTimeout(r, 800));
  chatState.identity = {
    publicKeyData: String(ident.publicKeyData),
    privateKeyData: String(ident.privateKeyData),
    fingerprint: String(ident.fingerprint),
    createdAt: String(ident.createdAt || new Date().toISOString()),
  };
  saveEncrypted(CHAT_IDENTITY_STORAGE_KEY, chatState.identity);
  chatState.shouldReconnect = true;
  renderStaticUi();
  await connectChatTransport();
}, identityOfA);
await B.waitForTimeout(1500);

/* Nothing forces the sender here: the sibling appearing in the live
   device list is the trigger, and the broadcast follows a few seconds
   behind it. The envelopes are spaced out, so what is waited for is the
   WHOLE outcome — history and call log — not the first bundle to land. */
const arrived = await B.waitForFunction((conv) => {
  const list = (typeof chatState !== 'undefined' && chatState.history && chatState.history[conv]) || [];
  const calls = (typeof chatState !== 'undefined' && chatState.calls) || [];
  return list.some((item) => item.id === 'sync-text-1') && calls.some((call) => call.id === 'sync-call-1')
    ? list : false;
}, CONV, { timeout: 30000 }).then((handle) => handle.jsonValue()).catch(() => null);

check('the linked device collected the conversation history',
  Array.isArray(arrived) && arrived.length >= 3,
  Array.isArray(arrived) ? `${arrived.length} entries` : 'nothing arrived');
check('and the attachment row arrived without the session-local blob url',
  Array.isArray(arrived) && arrived.every((item) => item.id !== 'sync-file-1' || !item.downloadUrl));
check('history arriving is not news arriving — nothing synced in as unread',
  Array.isArray(arrived) && !arrived.some((item) => item.id === 'sync-text-1' && item.unread));

const callsOnB = await B.evaluate(() => (chatState.calls || []).map((call) => call.id));
check('the call log arrived too', callsOnB.includes('sync-call-1'));

const unchangedOnA = await A.evaluate((conv) => (chatState.history[conv] || []).length, CONV);
check('the sending device\'s own history is unchanged', unchangedOnA === 3, `${unchangedOnA} entries`);

const fingerprints = await Promise.all([A, B].map((page) => page.evaluate(() => chatState.identity?.fingerprint || '')));
check('both pages hold one identity', fingerprints[0] === fingerprints[1]);

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
