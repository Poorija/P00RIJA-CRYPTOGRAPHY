/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
import { chatSource } from './_chat-source.mjs';
import fs from 'node:fs';
import path from 'node:path';
/* The audit.
 *
 *   npm run relay ; PORT=8123 npm run dev ; npm run audit
 *
 * The other suites each prove one feature works. This one asks a different
 * question: is there anything the app claims, or ought to hold, that nothing
 * else checks? It is deliberately adversarial about its own codebase.
 *
 * Two halves. The static half reads the source for the shapes that have caused
 * real defects here before — a security path that fails silently into a weaker
 * one, a secret written outside the vault, an error swallowed where it matters.
 * The dynamic half drives a real session and then reads what was actually
 * written to disk and sent over the wire, because a claim nobody measured from
 * the outside is a comment, not a guarantee.
 */
const BASE = process.env.PKG_URL || 'http://localhost:8123';
/* Reachable FROM THE PAGE, not just from here: an https page cannot fetch
   http://localhost:9000 or open a ws:// socket to it — the browser blocks it as
   mixed content and the suite reads that as a relay that is down. When the app
   is served over https the relay defaults to that same origin, which is the
   container serving both halves. The env var still wins. */
const RELAY = process.env.PKG_RELAY
  || (/^https:/i.test(BASE) ? String(BASE).replace(/\/+$/, '') : 'http://localhost:9000');
const DATA = process.env.CHAT_DATA_DIR || path.resolve(process.cwd(), 'data', 'chat-signal');
const ROOT = process.cwd();
const PASS = 'Audit#Pass2026!';
const SECRET = 'canary-3f9a2b-do-not-leak';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; } };

console.log('\n===== static: what the source promises =====');
/* js/chat.js is now js/chat/NN-*.js; the parts share one scope and run in
   numeric order, so the concatenation is what these greps used to read. */
const chat = chatSource();
const app = read('js/app.js');
const sw = read('sw.js');
const server = read('scripts/server.js');
const html = read('index.html');

check('no eval and no Function constructor anywhere in the shipped scripts',
  !/(^|[^.\w])eval\s*\(|new\s+Function\s*\(/m.test(chat + app + sw),
  'js/chat/*, js/app.js, sw.js');
check('nothing is loaded from a third-party origin',
  !/src="https?:\/\//.test(html) && !/@import\s+url\(["']?https?:/.test(read('css/styles.css')),
  'index.html, css/styles.css');
check('no key material is ever written to the console',
  !/console\.(log|warn|error|info)\([^)]*\b(rawKey|privateKeyData|cryptoKey|masterKey|passphrase)\b/.test(chat + app),
  'no key logging');

/* The bug that started this audit: a security path that quietly degrades. Each
   of these fallbacks is legitimate, but each must be observable from a test. */
const fallbacks = [
  ['prekey seal falls back to the identity wrap', /const seal = kex \? '' : await sealSessionKeyFor/],
  ['key exchange falls back when the peer cannot answer', /mintSessionKeyLegacy\(session, remotePeerRecord\)/],
  ['a stored session key is dropped once it is too old', /SESSION_KEY_LIFETIME_MS/],
];
fallbacks.forEach(([label, pattern]) => {
  check(`the source still contains the guard: ${label}`, pattern.test(chat), label);
});

/* Every direct localStorage write in the chat module has to be a preference,
   not content. This is what would have caught the drafts finding. */
const directWrites = [...chat.matchAll(/localStorage\.setItem\(([A-Z_]+)/g)].map((m) => m[1]);
const contentish = directWrites.filter((k) => /DRAFT|HISTORY|CONTACT|IDENTITY|SESSION|PREKEY|CALLS|SPACES|UNREAD/i.test(k));
console.log('  direct writes: ' + (directWrites.join(', ') || 'none'));
check('nothing that holds content or keys is written outside the vault',
  contentish.length === 0, contentish.join(', ') || 'only preferences');

check('the relay refuses to store ephemeral signalling',
  /EPHEMERAL_PAYLOADS/.test(server) && /PUSHABLE_PAYLOADS/.test(server),
  'typing and receipts are neither queued nor pushed');
check('the service worker can display a push',
  /addEventListener\('push'/.test(sw) && /showNotification/.test(sw), 'sw.js');
check('the emergency wipe reaches the relay, the storages, the databases and the worker',
  /purge-me/.test(chat) && /indexedDB/.test(app) && /caches\.keys/.test(app)
  && /getRegistrations/.test(app) && /sessionStorage\.clear/.test(app), 'js/app.js');

console.log('\n===== dynamic: what actually lands on disk and on the wire =====');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {} window.__clip = []; });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
/* Everything the page sends to the relay, so the wire can be searched too. */
const sent = [];
await page.exposeFunction('__auditRecord', (frame) => { sent.push(frame); });
await page.addInitScript(() => {
  const original = WebSocket.prototype.send;
  WebSocket.prototype.send = function send(data) {
    try { window.__auditRecord?.(String(data).slice(0, 4000)); } catch (e) { /* ignore */ }
    return original.call(this, data);
  };
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and any evaluate in flight when that lands dies with "Execution
   context was destroyed" — read as a crash, not a failure. Waiting for the
   page to hold still is the property actually wanted. */
await settle(page);
await page.evaluate((pass) => {
  const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
  set('setupPassword', pass); set('confirmPassword', pass);
  document.querySelectorAll('#initialSetup select').forEach((s, i) => {
    if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => {
    inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true })); });
  const cb = document.getElementById('acceptTermsCheckbox');
  if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
}, PASS);
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('setupBtn')?.click());
await page.waitForTimeout(3800);
await page.evaluate((relay) => {
  document.getElementById('mobileInstallGate')?.classList.add('hidden');
  window.switchTab?.('chat');
  const url = document.getElementById('chatServerUrl');
  if (url) { url.value = relay; url.dispatchEvent(new Event('input', { bubbles: true })); url.dispatchEvent(new Event('change', { bubbles: true })); }
  document.getElementById('chatConnectBtn')?.click();
}, RELAY);
await page.waitForTimeout(5500);

/* A draft needs a conversation to belong to, so there has to be somebody to
   write to. A second window, paired for real, also gives the wire something
   worth searching. */
const other = await ctx.browser().newContext({ viewport: { width: 1100, height: 800 } });
await other.addInitScript(() => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {} window.__clip = []; });
const peer = await other.newPage();
await peer.goto(`${BASE}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and any evaluate in flight when that lands dies with "Execution
   context was destroyed" — read as a crash, not a failure. Waiting for the
   page to hold still is the property actually wanted. */
await settle(peer);
await peer.evaluate((pass) => {
  const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
  set('setupPassword', pass); set('confirmPassword', pass);
  document.querySelectorAll('#initialSetup select').forEach((s, i) => {
    if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => {
    inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true })); });
  const cb = document.getElementById('acceptTermsCheckbox');
  if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
}, PASS);
await peer.waitForTimeout(400);
await peer.evaluate(() => document.getElementById('setupBtn')?.click());
await peer.waitForTimeout(3800);
await peer.evaluate((relay) => {
  document.getElementById('mobileInstallGate')?.classList.add('hidden');
  const w = navigator.clipboard.writeText.bind(navigator.clipboard);
  navigator.clipboard.writeText = (t) => { window.__clip.push(t); return w(t).catch(() => {}); };
  window.switchTab?.('chat');
  const url = document.getElementById('chatServerUrl');
  if (url) { url.value = relay; url.dispatchEvent(new Event('input', { bubbles: true })); url.dispatchEvent(new Event('change', { bubbles: true })); }
  document.getElementById('chatConnectBtn')?.click();
}, RELAY);
await peer.waitForTimeout(5500);
const peerIdentity = await peer.evaluate(async () => { await window.copyChatFullIdentity(); return window.__clip.at(-1); });
await page.evaluate(async (card) => {
  document.getElementById('chatStartChatBtn')?.click();
  await new Promise((r) => setTimeout(r, 500));
  document.querySelector('[data-chat-manual-json]').value = card;
  document.querySelector('[data-chat-manual-submit]')?.click();
}, peerIdentity);
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('#chatPeerList .chat-peer-card')?.click());
await page.waitForTimeout(2500);

/* Now the canary: typed into the composer and left there, unsent. */
await page.evaluate(async (secret) => {
  const composer = document.getElementById('chatComposer');
  if (composer) {
    composer.value = secret;
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    composer.dispatchEvent(new Event('blur', { bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 1500));
}, SECRET);
await page.evaluate(() => window.switchTab?.('encrypt'));
await page.waitForTimeout(2500);

const atRest = await page.evaluate((secret) => {
  const out = { keys: [], leaks: [] };
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key) || '';
    out.keys.push(key);
    if (value.includes(secret)) out.leaks.push(key);
  }
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if ((sessionStorage.getItem(key) || '').includes(secret)) out.leaks.push('session:' + key);
  }
  return out;
}, SECRET);
console.log('  storage keys: ' + atRest.keys.join(', '));
const draftStored = await page.evaluate((secret) => {
  const raw = localStorage.getItem('poorija_chat_drafts') || '';
  /* encryptStorageData returns a JSON envelope; what matters is that the
     content inside it is not the text, and that the text is nowhere in it. */
  let shape = 'none';
  try { shape = Object.keys(JSON.parse(raw)).sort().join(','); } catch (e) { shape = 'opaque'; }
  return { present: Boolean(raw), carriesText: raw.includes(secret), shape, sample: raw.slice(0, 60) };
}, SECRET);
console.log('  draft record: ' + JSON.stringify(draftStored));
check('the draft really was written, and what was written is not the text',
  draftStored.present && draftStored.carriesText === false, JSON.stringify(draftStored));
check('an unsent draft is not readable in storage',
  atRest.leaks.length === 0, atRest.leaks.join(', ') || 'no plaintext anywhere in storage');

const wireLeaks = sent.filter((frame) => frame.includes(SECRET));
check('nothing typed reaches the relay in the clear',
  wireLeaks.length === 0, wireLeaks.length ? wireLeaks[0].slice(0, 80) : `${sent.length} frames, none carrying it`);

/* And the relay's own files - every one of them, found by walking the data
   directory rather than by naming three files. The queue is one file per
   recipient under mailboxes/ now, and a fixed list would have quietly stopped
   looking at the queue at all: reading a file that no longer exists yields an
   empty string, which contains no secret, which passes. */
const relayFiles = [];
const walk = (dir) => {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_error) { return; }
  for (const entry of entries) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(at); continue; }
    let body = '';
    try { body = fs.readFileSync(at, 'utf8'); } catch (_error) { continue; }
    relayFiles.push({ f: path.relative(DATA, at), body });
  }
};
walk(DATA);
const relayLeak = relayFiles.filter((r) => r.body.includes(SECRET)).map((r) => r.f);
check('the relay keeps files to search at all', relayFiles.length > 0, `${relayFiles.length} file(s)`);
check('and nothing typed is in any file the relay keeps',
  relayLeak.length === 0, relayLeak.join(', ') || `${relayFiles.length} file(s) clean`);

console.log('\n===== views stay in their own lane =====');
/* One view repainting another's panel is the shape of several defects here
   now: the call log took over the chat list, and settings once wiped it. Each
   render has to leave the others alone. */
const lanes = await page.evaluate(async () => {
  const out = {};
  const titleOf = () => document.getElementById('chatListTitle')?.textContent || '';
  window.switchTab?.('chat');
  await new Promise((r) => setTimeout(r, 600));
  document.querySelector('[data-chat-view="chats"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  out.chatsTitle = titleOf();
  window.__callLogProbe?.append({ name: 'Audit', peerId: 'audit-peer', mode: 'voice', status: 'missed', direction: 'in' });
  await new Promise((r) => setTimeout(r, 500));
  out.afterCallLog = titleOf();
  out.callRowsInChats = document.querySelectorAll('#chatPeerList .chat-call-log-row').length;
  document.querySelector('[data-chat-view="calls"]')?.click();
  await new Promise((r) => setTimeout(r, 600));
  out.callsTitle = titleOf();
  /* On a wide layout the log lives in its own column, not in the rail list. */
  out.callRowsInCalls = document.querySelectorAll('.chat-call-log-row').length;
  document.querySelector('[data-chat-view="chats"]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  out.backToChats = titleOf();
  return out;
});
console.log('  ' + JSON.stringify(lanes));
check('a logged call does not repaint the chat list',
  lanes.afterCallLog === lanes.chatsTitle && lanes.callRowsInChats === 0, JSON.stringify(lanes));
check('and the calls view still shows the log when it is the one open',
  lanes.callRowsInCalls > 0 && lanes.backToChats === lanes.chatsTitle, JSON.stringify(lanes));

check('no script threw during the audit', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
