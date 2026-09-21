/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.

   The reported symptom: open the app, nothing there; close it, and a
   notification arrives a minute or two later; open it again, still nothing.
   Every time.

   That is one envelope that the relay hands over, the app fails to open, and
   therefore never acknowledges - so it stays in the mailbox, and the next time
   the device is seen as away it is queued and rung for all over again. This
   suite pins the two halves that make the loop impossible: the envelope has to
   open after a restart, and the mailbox has to actually empty. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readMailboxes } from './_relay-store.mjs';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
/* Reachable FROM THE PAGE, not just from here: an https page cannot fetch
   http://localhost:9000 or open a ws:// socket to it — the browser blocks it as
   mixed content and the suite reads that as a relay that is down. When the app
   is served over https the relay defaults to that same origin, which is the
   container serving both halves. The env var still wins. */
const RELAY = process.env.RELAY_URL
  || (/^https:/i.test(BASE_URL) ? String(BASE_URL).replace(/\/+$/, '') : 'http://localhost:9000');
const STORE = process.env.CHAT_OFFLINE_STORE_PATH || path.resolve(process.cwd(), 'data/chat-signal/offline-messages.json');
const PASS = 'Harness#Pass2026!';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const mailbox = (fp) => readMailboxes(STORE)[fp] || [];
const initScript = () => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {} window.__clip = []; };

/* web-push always speaks TLS, so a plain listener only ever sees a failed
   handshake. The count of delivery attempts is what matters, and every attempt
   opens a socket first. */
const pushes = [];
const vendor = net.createServer((socket) => { pushes.push(Date.now()); socket.destroy(); });
await new Promise((r) => vendor.listen(0, '127.0.0.1', r));
const vendorPort = vendor.address().port;

async function setup(page, tag) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  await page.evaluate((pass) => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('setupPassword', pass); set('confirmPassword', pass);
    document.querySelectorAll('#initialSetup select').forEach((s, i) => { if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => { inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true })); });
    const cb = document.getElementById('acceptTermsCheckbox'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  }, PASS);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(2500);
  await page.evaluate((name) => {
    const w = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__clip.push(t); return w(t).catch(() => {}); };
    const n = document.getElementById('chatDisplayName'); if (n) { n.value = name; n.dispatchEvent(new Event('input', { bubbles: true })); }
    document.getElementById('chatSaveProfileBtn')?.click();
    document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');
  }, tag);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById('chatConnectBtn')?.click());
  await page.waitForTimeout(6500);
}
async function unlock(page) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  await page.evaluate((p) => { const el = document.getElementById('unlockPassword'); if (el) { el.value = p; el.dispatchEvent(new Event('input', { bubbles: true })); } }, PASS);
  await page.evaluate(() => window.unlockApp?.());
  await page.waitForTimeout(4000);
  await page.evaluate(() => { document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat'); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById('chatConnectBtn')?.click());
  await page.waitForTimeout(10000);
}
const idOf = (p) => p.evaluate(async () => { await window.copyChatFullIdentity(); return window.__clip.at(-1); });
const imp = (p, x) => p.evaluate(async (t) => {
  document.getElementById('chatStartChatBtn')?.click();
  await new Promise((r) => setTimeout(r, 500));
  document.querySelector('[data-chat-manual-json]').value = t;
  document.querySelector('[data-chat-manual-submit]')?.click();
}, x);
const fpOf = (x) => JSON.parse(atob(x.replace('poorija-chat-v1:', '')))?.fingerprint;
const openPeer = (p, name) => p.evaluate((n) => {
  document.querySelector('[data-chat-view="chats"]')?.click();
  const c = [...document.querySelectorAll('#chatPeerList .chat-peer-card')].find((x) => x.getAttribute('data-chat-conversation') === n);
  c?.click(); return Boolean(c);
}, name);
const texts = (p) => p.evaluate(() => [...document.querySelectorAll('#chatMessages .chat-message-text')].map((e) => e.textContent.trim().slice(0, 48)));

const browser = await chromium.launch();
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-phantom-'));
let ctxA = await chromium.launchPersistentContext(dirA, { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
await ctxA.addInitScript(initScript);
let pageA = ctxA.pages()[0] || await ctxA.newPage(); pageA.on('dialog', (d) => d.accept());
await setup(pageA, 'ALPHA');

const ctxB = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
await ctxB.addInitScript(initScript);
const pageB = await ctxB.newPage(); pageB.on('dialog', (d) => d.accept());
await setup(pageB, 'BETA');

const idA = await idOf(pageA); const idB = await idOf(pageB);
await imp(pageA, idB); await imp(pageB, idA);
await pageA.waitForTimeout(4000);
const fpA = fpOf(idA);
const fpB = fpOf(idB);

/* Registered straight at the relay: what is under test is what the relay does
   with a queued envelope, not the browser's own push plumbing. */
await fetch(`${RELAY}/push/subscribe`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fingerprint: fpA, ttlDays: 30, deviceId: 'phantom-probe', subscription: {
    endpoint: `http://127.0.0.1:${vendorPort}/send/phantom`,
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' } } }),
});

console.log('\n===== one message away, one notification =====');
await ctxA.close();
await pageB.waitForTimeout(120000); /* past the relay's 90s presence TTL */
const pushesBefore = pushes.length;
const boxBefore = mailbox(fpA).length;
await openPeer(pageB, fpA); await pageB.waitForTimeout(1500);
await pageB.fill('#chatComposer', 'PHANTOM-CHECK-ONE');
await pageB.click('#chatSendMessageBtn', { timeout: 15000 }).catch(() => {});
await pageB.waitForTimeout(8000);
const boxAfter = mailbox(fpA);
check('the message is queued for the device that is away', boxAfter.length > boxBefore, `${boxBefore} -> ${boxAfter.length}`);
check('and it rings exactly once', pushes.length - pushesBefore === 1, `${pushes.length - pushesBefore} push(es)`);

console.log('\n===== the notification has something behind it =====');
ctxA = await chromium.launchPersistentContext(dirA, { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
await ctxA.addInitScript(initScript);
pageA = ctxA.pages()[0] || await ctxA.newPage(); pageA.on('dialog', (d) => d.accept());
await unlock(pageA);
await openPeer(pageA, fpB); await pageA.waitForTimeout(3000);
const seen = await texts(pageA);
console.log('  ALPHA sees: ' + JSON.stringify(seen));
check('the message the notification was about is actually readable',
  seen.some((x) => /PHANTOM-CHECK-ONE/.test(x)), JSON.stringify(seen));
check('and the mailbox empties, so nothing can be rung for twice',
  mailbox(fpA).length === 0, `${mailbox(fpA).length} left`);

console.log('\n===== leaving again rings nothing =====');
const pushesAfterRead = pushes.length;
await ctxA.close();
await pageB.waitForTimeout(120000);
check('going away with an empty mailbox produces no notification',
  pushes.length === pushesAfterRead, `${pushes.length - pushesAfterRead} unexpected push(es)`);

console.log('\n===== a receipt is not a message and must not ring =====');
/* The reported screenshot: a column of "Encrypted chat update received" with
   nothing behind any of them. Every session event - a delivery receipt, a
   typing flag - is wrapped in an envelope whose type reads 'offline-chat', and
   both the decision to store it and the decision to ring were made from that
   outer name. So writing to somebody who had stepped away rang their phone
   once per keystroke burst and once per receipt. */
const beforeEphemeral = pushes.length;
const mailBefore = mailbox(fpA).length;
await pageB.evaluate(() => {
  const composer = document.getElementById('chatComposer');
  if (!composer) return;
  composer.value = 'typing…';
  composer.dispatchEvent(new Event('input', { bubbles: true }));
});
await pageB.waitForTimeout(4000);
await pageB.evaluate(() => {
  const composer = document.getElementById('chatComposer');
  if (composer) { composer.value = 'typing more…'; composer.dispatchEvent(new Event('input', { bubbles: true })); }
});
await pageB.waitForTimeout(6000);
check('typing at somebody who is away rings nothing',
  pushes.length === beforeEphemeral, `${pushes.length - beforeEphemeral} unexpected push(es)`);
check('and nothing about it is kept for them to collect',
  mailbox(fpA).length === mailBefore, `${mailBefore} -> ${mailbox(fpA).length}`);
const queuedInner = mailbox(fpA).map((i) => i?.payload?.inner || i?.payload?.type);
check('no ephemeral signal is sitting in the mailbox',
  !queuedInner.some((k) => ['typing', 'receipt', 'ping', 'pong'].includes(k)), JSON.stringify(queuedInner));

console.log('\n===== a second message rings once more, not again for the first =====');
await pageB.fill('#chatComposer', 'PHANTOM-CHECK-TWO');
await pageB.click('#chatSendMessageBtn', { timeout: 15000 }).catch(() => {});
await pageB.waitForTimeout(8000);
check('the second message rings exactly once', pushes.length - pushesAfterRead === 1, `${pushes.length - pushesAfterRead} push(es)`);
check('and only it is waiting', mailbox(fpA).length === 1, `${mailbox(fpA).length} queued`);

ctxA = await chromium.launchPersistentContext(dirA, { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
await ctxA.addInitScript(initScript);
pageA = ctxA.pages()[0] || await ctxA.newPage(); pageA.on('dialog', (d) => d.accept());
await unlock(pageA);
await openPeer(pageA, fpB); await pageA.waitForTimeout(3000);
const seen2 = await texts(pageA);
check('both messages are there in the end', seen2.some((x) => /PHANTOM-CHECK-TWO/.test(x)) && seen2.some((x) => /PHANTOM-CHECK-ONE/.test(x)), JSON.stringify(seen2));
check('and the mailbox is empty again', mailbox(fpA).length === 0, `${mailbox(fpA).length} left`);

await ctxA.close(); await ctxB.close(); await browser.close(); vendor.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
