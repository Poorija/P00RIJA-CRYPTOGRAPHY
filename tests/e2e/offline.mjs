/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Can the app send to somebody who is not there?
 *
 *   npm run relay             # terminal 1
 *   PORT=8123 npm run dev     # terminal 2
 *   node tests/e2e/offline.mjs
 *
 * One profile, one invented contact who has never been online. The contact is
 * added by pasting an identity built here, so the test holds the matching
 * private key and can prove the queued envelope really opens.
 *
 * This is the regression guard for the bug it was written for:
 * `ensureDirectSession()` used to return a session with no key whenever the
 * peer was offline, every send path then marked the message "failed" with "the
 * secure session is not ready", and nothing was handed to the relay at all.
 * The message did not exist anywhere — not late, not queued, gone.
 *
 * Driving one browser rather than pairing two keeps this about delivery rather
 * than about whether PeerJS managed a handshake on this machine today.
 */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { readMailboxes } from './_relay-store.mjs';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
/* Reachable FROM THE PAGE, not just from here: an https page cannot fetch
   http://localhost:9000 or open a ws:// socket to it — the browser blocks it as
   mixed content and the suite reads that as a relay that is down. When the app
   is served over https the relay defaults to that same origin, which is the
   container serving both halves. The env var still wins. */
const RELAY = process.env.RELAY_URL
  || (/^https:/i.test(BASE) ? String(BASE).replace(/\/+$/, '') : 'http://localhost:9000');
const PASS = 'Offline#Harness2026!';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/* `/chat-health` reports peers, not the queue — the count lives behind the
   admin endpoint. Reading the store the relay actually wrote is both simpler
   and stronger: it lets the envelope be inspected, not just counted. */
const STORE = process.env.CHAT_OFFLINE_STORE_PATH
  || path.resolve('data/chat-signal/offline-messages.json');
/* Against a remote relay the store is not on this disk. REMOTE_STORE_CMD lets
   the caller supply a way to read it — an ssh + docker exec, typically — so the
   same suite proves delivery locally and on a real deployment. */
const REMOTE_STORE_CMD = process.env.REMOTE_STORE_CMD || '';
const mailbox = (fingerprint) => {
  try {
    const raw = REMOTE_STORE_CMD
      ? JSON.parse(execSync(REMOTE_STORE_CMD, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
      : readMailboxes(STORE);
    return raw[fingerprint] || [];
  } catch (error) { return []; }
};

const relayHealth = async () => {
  try {
    const res = await fetch(new URL('/chat-health', RELAY), { cache: 'no-store' });
    return await res.json();
  } catch (error) { return null; }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => { try { localStorage.setItem('poorija_lang', 'en'); } catch (e) {} });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 140)));

console.log('\n===== a contact who has never been online =====');

await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and any evaluate in flight when that lands dies with "Execution
   context was destroyed" — read as a crash, not a failure. Waiting for the
   page to hold still is the property actually wanted. */
await settle(page);
await page.evaluate((pass) => {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('setupPassword', pass); set('confirmPassword', pass);
  document.querySelectorAll('#initialSetup select').forEach((s, i) => {
    if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => {
    inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const cb = document.getElementById('acceptTermsCheckbox');
  if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
}, PASS);
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('setupBtn')?.click());
await page.waitForTimeout(3500);

await page.evaluate(() => {
  window.__toasts = [];
  const orig = window.PoorijaApp?.showNotification?.bind(window.PoorijaApp);
  if (window.PoorijaApp) {
    window.PoorijaApp.showNotification = (m, t) => { window.__toasts.push(`${t}: ${m}`); return orig?.(m, t); };
  }
  document.getElementById('mobileInstallGate')?.classList.add('hidden');
  window.switchTab?.('chat');
});
await page.waitForTimeout(1200);
await page.evaluate((relay) => {
  const el = document.getElementById('chatServerUrl');
  if (el) { el.value = relay; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  document.getElementById('chatConnectBtn')?.click();
}, RELAY);
await page.waitForTimeout(6000);

const health = await relayHealth();
check('the relay is up and this profile reached it', Boolean(health?.ok), JSON.stringify(health?.peers ?? null));
if (!health?.ok) {
  console.log('\n  Start it with `npm run relay` and retry.');
  await browser.close();
  process.exit(1);
}
// Start from whatever this mailbox already holds, so a re-run is honest.

/* Mint the absent contact inside the page: a real RSA-OAEP-3072 keypair, whose
   private half stays here so the seal can be opened at the end. */
const ghost = await page.evaluate(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']
  );
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  const publicKeyData = b64(spki);
  const digest = await crypto.subtle.digest('SHA-256', spki);
  const fingerprint = Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, '0')).join('');
  window.__ghostPrivate = b64(pkcs8);
  const payload = {
    app: 'P00RIJA Cryptography',
    type: 'poorija-chat-identity',
    version: 1,
    name: 'Absent Friend',
    peerId: 'poorija-peer-absent-' + Math.random().toString(36).slice(2, 10),
    fingerprint,
    publicKeyData,
    createdAt: new Date().toISOString(),
  };
  return {
    text: 'poorija-chat-v1:' + btoa(unescape(encodeURIComponent(JSON.stringify(payload)))),
    fingerprint,
  };
});
check('an absent contact was minted with a real keypair', Boolean(ghost?.fingerprint), String(ghost?.fingerprint).slice(0, 16));

await page.evaluate(async (payload) => {
  document.getElementById('chatStartChatBtn')?.click();
  await new Promise((r) => setTimeout(r, 700));
  const field = document.querySelector('[data-chat-manual-json]');
  if (field) { field.value = payload; field.dispatchEvent(new Event('input', { bubbles: true })); }
  document.querySelector('[data-chat-manual-submit]')?.click();
}, ghost.text);
await page.waitForTimeout(3000);

const cards = await page.evaluate(() => document.querySelectorAll('#chatPeerList .chat-peer-card').length);
check('the absent contact appears in the list', cards > 0, `${cards} card(s)`);

await page.evaluate(() => document.querySelector('#chatPeerList .chat-peer-card')?.click());
await page.waitForSelector('#chatComposer', { state: 'visible', timeout: 30000 });
await page.waitForTimeout(1500);

console.log('\n===== writing to the empty chair =====');
await page.fill('#chatComposer', 'this should survive until you return');
await page.click('#chatSendMessageBtn');
await page.waitForTimeout(4000);

const toasts = await page.evaluate(() => (window.__toasts || []).slice(-6));
console.log('  toasts: ' + JSON.stringify(toasts));

/* The exact old failure. */
const refused = toasts.some((t) => /session is not ready|not ready|سشن امن/i.test(t));
check('the sender no longer refuses with "the secure session is not ready"', !refused, toasts.join(' | '));

const bubble = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[data-id]')];
  const last = nodes[nodes.length - 1];
  return last ? last.className : '';
});
check('the message was not marked failed', !/failed/i.test(bubble), bubble.slice(0, 90));

const queued = mailbox(ghost.fingerprint)
  .filter((item) => item?.payload?.type === 'offline-chat');
check('the relay is holding it for later', queued.length > 0, `${queued.length} envelope(s)`);

const envelope = queued[queued.length - 1]?.payload || {};
check('the envelope carries its own wrapped key', (envelope.seal || '').length > 300,
  `${(envelope.seal || '').length} chars`);
check('the relay was told how long to keep it', envelope.class === 'text', String(envelope.class));
/* The envelope itself is sealed now, not just the message inside it: the relay
   holds no filename, no mime type, no message kind and no timers — only the
   routing fields and the retention class. */
check('the body is ciphertext, not readable text',
  Boolean(envelope.body?.cipher) && !JSON.stringify(envelope).includes('should survive'),
  Object.keys(envelope.body || {}).join(',') || 'no sealed body');
check('the relay is told nothing about what the message is',
  !('message' in envelope) && !JSON.stringify(envelope).match(/"(name|mime|kind|durationMs|timerSeconds)"/),
  Object.keys(envelope).join(','));

/* The half that matters most: what the relay holds must actually open, and
   only with the absent contact's private key. */
const opened = await page.evaluate(async ({ seal, payload }) => {
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  try {
    const privateKey = await crypto.subtle.importKey(
      'pkcs8', bytes(window.__ghostPrivate),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']
    );
    const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, bytes(seal));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    /* Two layers: the seal gives up the session key, and that key opens the
       envelope body, which is the whole message including its metadata. */
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(payload.iv) }, key, bytes(payload.cipher)
    );
    const message = JSON.parse(new TextDecoder().decode(opened));
    const inner = message?.payload
      ? await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(message.payload.iv) }, key, bytes(message.payload.cipher))
      : null;
    return {
      text: inner ? new TextDecoder().decode(inner).slice(0, 120) : '',
      type: message?.type || '',
    };
  } catch (error) {
    return { error: String(error).slice(0, 120) };
  }
}, { seal: envelope.seal, payload: envelope.body || {} });
console.log('  unsealed: ' + JSON.stringify(opened));
check('the absent contact\'s private key opens it',
  String(opened.text || '').includes('should survive until you return'),
  opened.error || String(opened.text).slice(0, 60));

check('no script threw while doing it', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
