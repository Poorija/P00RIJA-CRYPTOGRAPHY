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
import { chatSource } from './_chat-source.mjs';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { WebSocket } from 'ws';
import { readMailboxes, writeMailboxes } from './_relay-store.mjs';
/* Background push, end to end.
 *
 *   npm run relay                 # terminal 1
 *   PORT=8123 npm run dev         # terminal 2
 *   npm run test:push
 *
 * Push is the one feature that puts a third party in the path, so what is
 * checked here is mostly about restraint: that nothing is registered until the
 * user has been told what it costs and said yes, that the relay stores the
 * device under a hash rather than the chat identity, that the record expires on
 * the window the user picked, and that turning it off takes it off the relay
 * rather than only out of the settings screen.
 *
 * One substitution, and only one: a headless browser has no vendor push
 * service, so PushManager.subscribe can never succeed and Notification reports
 * a permission state no real browser starts in. Both are browser facilities,
 * not app logic — everything the app does around them runs for real against
 * the real relay, and the relay's own files are read from disk afterwards.
 */
const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
/* Reachable FROM THE PAGE, not just from here: an https page cannot fetch
   http://localhost:9000 or open a ws:// socket to it — the browser blocks it as
   mixed content and the suite reads that as a relay that is down. When the app
   is served over https the relay defaults to that same origin, which is the
   container serving both halves. The env var still wins. */
const RELAY = process.env.PKG_RELAY
  || (/^https:/i.test(BASE_URL) ? String(BASE_URL).replace(/\/+$/, '') : 'http://localhost:9000');
const DATA_DIR = process.env.CHAT_DATA_DIR
  || path.resolve(process.cwd(), 'data', 'chat-signal');
const PASS = 'Harness#Pass2026!';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const readStore = () => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'push-subscriptions.json'), 'utf8')); }
  catch (error) { return {}; }
};
const indexKeyFor = (fingerprint) => {
  try {
    const salt = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'vapid.json'), 'utf8')).salt;
    return crypto.createHmac('sha256', salt).update(fingerprint).digest('hex');
  } catch (error) { return ''; }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 940 }, permissions: ['notifications'] });
await ctx.addInitScript(() => {
  try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) { /* blocked */ }
  const fake = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/HARNESS-' + Math.random().toString(36).slice(2),
    expirationTime: null,
    toJSON() {
      return { endpoint: this.endpoint, expirationTime: null,
        keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' } };
    },
    unsubscribe() { return Promise.resolve(true); },
  };
  try {
    let level = 'default';
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => level });
    const ask = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = async () => { const r = await ask(); level = r; return r; };
  } catch (e) { /* older engines */ }
  if (window.PushManager) {
    PushManager.prototype.subscribe = function subscribe() { window.__pushSubscribed = true; return Promise.resolve(fake); };
    PushManager.prototype.getSubscription = function getSubscription() {
      return Promise.resolve(window.__pushSubscribed ? fake : null);
    };
  }
});
await ctx.grantPermissions(['notifications'], { origin: BASE_URL });
const page = await ctx.newPage();
const pushCalls = [];
page.on('request', (r) => {
  if (r.url().includes('/push/')) pushCalls.push({ method: r.method(), path: r.url().split('/push/')[1], body: r.postData() || '' });
});
await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(2200);
await page.evaluate((pass) => {
  const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
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
await page.waitForTimeout(3800);
await page.evaluate(() => { document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat'); });
await page.waitForTimeout(1500);

console.log('\n===== nothing is registered just because the app connected =====');
await page.evaluate((relay) => {
  const url = document.getElementById('chatServerUrl');
  if (url) { url.value = relay; url.dispatchEvent(new Event('input', { bubbles: true })); url.dispatchEvent(new Event('change', { bubbles: true })); }
  document.getElementById('chatConnectBtn')?.click();
}, RELAY);
await page.waitForTimeout(6000);
check('connecting to the relay subscribes nobody', pushCalls.length === 0, JSON.stringify(pushCalls));

await page.evaluate(() => window.switchTab?.('settings'));
await page.waitForTimeout(1200);
const initial = await page.evaluate(() => ({
  toggle: document.getElementById('pushBackgroundToggle')?.checked,
  ttl: document.getElementById('pushTtlSelect')?.value,
  options: [...(document.getElementById('pushTtlSelect')?.options || [])].map((o) => o.value),
  stored: JSON.parse(localStorage.getItem('poorija_settings') || '{}')?.push,
}));
console.log('  ' + JSON.stringify(initial));
/* Nothing is written to storage until something is saved, so on a fresh
   install the default lives in code and the record is simply absent — which is
   itself the point: off is not a value someone has to have set. */
check('the switch starts off, at the shortest window',
  initial.toggle === false && initial.ttl === '30' && (initial.stored?.enabled ?? false) === false,
  JSON.stringify({ ...initial, stored: initial.stored ?? '(nothing stored yet)' }));
check('and the windows offered are the five that were asked for',
  JSON.stringify(initial.options) === JSON.stringify(['30', '60', '90', '120', '180']),
  JSON.stringify(initial.options));

console.log('\n===== it explains itself before it asks =====');
await page.evaluate(() => document.getElementById('pushBackgroundToggle')?.click());
await page.waitForTimeout(700);
const disclosure = await page.evaluate(() => ({
  open: !document.querySelector('.poorija-dialog-backdrop')?.classList.contains('hidden'),
  body: document.querySelector('.poorija-dialog-message')?.textContent || '',
  cancel: document.querySelector('.poorija-dialog-cancel')?.textContent.trim() || '',
}));
const says = (needle) => disclosure.body.includes(needle);
check('the disclosure appears before anything is registered',
  disclosure.open === true && pushCalls.length === 0, `${disclosure.open}, ${pushCalls.length} calls`);
check('it says the default is off, names the third party, and promises no content',
  says('پیش‌فرض خاموش') && says('سرویس پوشِ مرورگر') && says('IP')
  && says('متن پیام') && says('رمزنگاری سرتاسری'),
  disclosure.body.slice(0, 60));
check('and declining is offered as its own answer', disclosure.cancel.length > 0, disclosure.cancel);

await page.evaluate(() => document.querySelector('.poorija-dialog-cancel')?.click());
await page.waitForTimeout(800);
const declined = await page.evaluate(() => ({
  toggle: document.getElementById('pushBackgroundToggle')?.checked,
  stored: JSON.parse(localStorage.getItem('poorija_settings') || '{}')?.push,
}));
check('saying no leaves it off and registers nothing',
  declined.toggle === false && declined.stored?.enabled === false && pushCalls.length === 0,
  JSON.stringify({ ...declined, calls: pushCalls.length }));

console.log('\n===== saying yes, and what the relay then holds =====');
await page.evaluate(() => document.getElementById('pushBackgroundToggle')?.click());
await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('.poorija-dialog-ok')?.click());
await page.waitForTimeout(4000);
const fingerprint = await page.evaluate(() => window.PoorijaChat?.identityFingerprint?.() || '');
const subscribeCall = pushCalls.find((c) => c.path === 'subscribe');
let body = {};
try { body = JSON.parse(subscribeCall?.body || '{}'); } catch (error) { body = {}; }
check('it registers only after consent, with the chosen window',
  Boolean(subscribeCall) && body.ttlDays === 30 && body.fingerprint === fingerprint,
  JSON.stringify({ ttlDays: body.ttlDays, hasSub: Boolean(body.subscription) }));

const key = indexKeyFor(fingerprint);
const stored = readStore()[key] || [];
check('the relay files it under a hash, never the chat identity',
  key.length === 64 && stored.length === 1 && !JSON.stringify(readStore()).includes(fingerprint),
  `${key.slice(0, 12)}… holds ${stored.length}`);
check('and gives it an expiry rather than keeping it forever',
  Boolean(stored[0]?.expiresAt) && stored[0]?.ttlDays === 30,
  JSON.stringify({ ttlDays: stored[0]?.ttlDays, expiresAt: stored[0]?.expiresAt }));

console.log('\n===== a subscription made for a key the relay no longer uses =====');
/* The relay's VAPID pair used to change on every restart, so a device can be
   holding a subscription that no push service will ever accept. Reusing it
   means nothing arrives and nothing says why. */
const rekey = await page.evaluate(async () => {
  /* Raced against a timeout, because serviceWorker.ready never rejects — it
     simply never settles when registration cannot happen, and .catch() does
     nothing for a promise that does not reject. Against an origin whose
     certificate the browser will not accept, this awaited for three hours
     and blocked every suite queued behind it. */
  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 20000)),
  ]);
  const registration = ready;
  if (!registration) return { error: 'the service worker never registered' };
  const before = await registration.pushManager.getSubscription();
  const stale = new Uint8Array(65); stale[0] = 4; stale.fill(9, 1);
  /* Present a subscription that was made for a different server key. */
  window.__pushSubscribed = true;
  const original = PushManager.prototype.getSubscription;
  PushManager.prototype.getSubscription = function getSubscription() {
    return Promise.resolve({ endpoint: 'https://fcm.googleapis.com/fcm/send/STALE',
      options: { applicationServerKey: stale.buffer },
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'x', auth: 'y' } }; },
      unsubscribe() { window.__staleDropped = true; return Promise.resolve(true); } });
  };
  await window.PoorijaApp?.registerWebPushSubscription?.(
    window.PoorijaChat.identityFingerprint(), window.PoorijaChat.serverOrigin(), false).catch(() => {});
  PushManager.prototype.getSubscription = original;
  return { droppedStale: Boolean(window.__staleDropped), had: Boolean(before) };
});
console.log('  ' + JSON.stringify(rekey));
check('a subscription signed for an old key is replaced, not reused',
  rekey.droppedStale === true, JSON.stringify(rekey));

console.log('\n===== the window is the user\'s to change =====');
await page.evaluate(() => { const s = document.getElementById('pushTtlSelect'); s.value = '180'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(2600);
const after180 = readStore()[key] || [];
check('choosing 180 days rewrites the record on the relay',
  after180[0]?.ttlDays === 180 && Date.parse(after180[0]?.expiresAt) > Date.now() + 170 * 24 * 3600 * 1000,
  JSON.stringify({ ttlDays: after180[0]?.ttlDays, expiresAt: after180[0]?.expiresAt }));

console.log('\n===== turning it off takes it off the relay =====');
await page.evaluate(() => document.getElementById('pushBackgroundToggle')?.click());
await page.waitForTimeout(2600);
const unsubscribeCall = pushCalls.find((c) => c.path === 'unsubscribe');
check('the switch sends an unsubscribe, not just a local flag',
  Boolean(unsubscribeCall), unsubscribeCall ? 'sent' : 'missing');
check('and the relay no longer holds this device',
  (readStore()[key] || []).length === 0, JSON.stringify(readStore()[key] || []));

console.log('\n===== typing does not wake anybody =====');
/* The reported bug: writing one long message rang the other phone every few
   seconds. Typing indicators were relayed with persist set like everything
   else, so each one queued a row and fired a push. Driven straight at the
   relay's socket, and checked twice: what it answers, and what it stores.
   A local HTTP listener stands in for the vendor's push service, so "did a
   push actually go out" is observed rather than assumed. */
/* web-push always speaks TLS to an endpoint, so a plain HTTP listener would
   only ever see a failed handshake. What is wanted here is the count of
   delivery ATTEMPTS, and every attempt opens a TCP connection first — so count
   connections and let the handshake fail. */
/* This fingerprint is a fixture, not a person, and every past run has queued
   into it and subscribed for it. Left alone the mailbox climbs to the relay's
   own per-box cap and the next run measures the cap rather than the relay -
   which is exactly what it started doing. Tidy up first. */
const wipeFixture = (fingerprint) => {
  /* The mailboxes live one file per recipient now, so clearing this run's
     fixture is a single file rather than a rewrite of the whole store. */
  const storePath = path.resolve(process.cwd(), 'data/chat-signal', 'offline-messages.json');
  const boxes = readMailboxes(storePath);
  if (boxes[fingerprint]) {
    delete boxes[fingerprint];
    writeMailboxes(storePath, boxes);
  }
  for (const file of ['push-subscriptions.json']) {
    const at = path.resolve(process.cwd(), 'data/chat-signal', file);
    try {
      const store = JSON.parse(fs.readFileSync(at, 'utf8'));
      let touched = false;
      for (const key of Object.keys(store)) {
        const rows = store[key] || [];
        const kept = rows.filter((row) => !/\/send\/probe/.test(String(row?.endpoint || '')));
        if (kept.length !== rows.length) touched = true;
        if (kept.length) store[key] = kept; else delete store[key];
      }
      if (touched) fs.writeFileSync(at, JSON.stringify(store));
    } catch (_error) { /* nothing stored yet */ }
  }
};

const pushed = [];
const fakeVendor = net.createServer((socket) => {
  pushed.push(Date.now());
  socket.destroy();
});
await new Promise((resolve) => fakeVendor.listen(0, resolve));
const vendorPort = fakeVendor.address().port;
const target = 'ff:ee:dd:cc:bb:aa:99:88:77:66:55:44:33:22:11:00';
wipeFixture(target);
await fetch(`${RELAY}/push/subscribe`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fingerprint: target, ttlDays: 30, subscription: {
    endpoint: `http://localhost:${vendorPort}/send/probe`,
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' } } }),
});

/* The probe's own identity, built so that sha256(key) === fingerprint, which
   is what the relay checks on hello. */
const probeKeyData = Buffer.from('p00rija-push-probe-key').toString('base64');
const probeFingerprint = crypto.createHash('sha256')
  .update(Buffer.from(probeKeyData, 'base64')).digest('hex');

const relayAnswers = await new Promise((resolve) => {
  const answers = [];
  const ws = new WebSocket(RELAY.replace('http', 'ws').replace(':9000', ':9001') + '/chat-signal');
  ws.on('open', () => {
    /* A hello the relay will accept.
     *
     * The presence socket now proves identity: it hashes publicKeyData and
     * refuses the connection with `identity-mismatch` unless the digest IS the
     * claimed fingerprint. This probe used to say it was `push:probe` while
     * presenting the key `x`, which is exactly the forgery that check exists to
     * stop — so the relay closed the socket, every relay frame after it was
     * ignored, and six assertions about queueing and device wakes reported that
     * the relay "never tried". It was refusing a liar, correctly. */
    ws.send(JSON.stringify({ type: 'hello', clientId: 'push-probe', username: 'probe', peerId: 'push-probe-peer', fingerprint: probeFingerprint, publicKeyData: probeKeyData }));
    setTimeout(() => {
      for (const type of ['typing', 'receipt', 'text', 'call-invite', 'call-missed']) {
        ws.send(JSON.stringify({ type: 'relay', toFingerprint: target, payload: { type }, persist: true }));
      }
      /* Wait for the five answers rather than for a number of milliseconds.
         A fixed sleep passes on a quiet machine and reports a missing answer on
         a busy one, which reads as the relay dropping something. */
      const deadline = Date.now() + 12000;
      const settle = () => {
        if (answers.length >= 5 || Date.now() > deadline) {
          /* The pushes are fired after the answer goes out, so give them a
             moment of their own before counting. */
          setTimeout(() => { ws.close(); resolve(answers); }, 1500);
          return;
        }
        setTimeout(settle, 150);
      };
      settle();
    }, 700);
  });
  ws.on('message', (raw) => {
    const data = JSON.parse(raw);
    if (data.type === 'queued') answers.push('queued');
    if (data.type === 'error' && data.reason === 'target-offline') answers.push('refused');
  });
  ws.on('error', () => resolve(answers));
});
fakeVendor.close();
console.log('  relay answered: ' + JSON.stringify(relayAnswers) + `, pushes sent: ${pushed.length}`);
check('typing and receipts are turned away, not stored',
  relayAnswers.slice(0, 2).join(',') === 'refused,refused', JSON.stringify(relayAnswers));
check('while a message and the two call events are kept',
  relayAnswers.filter((a) => a === 'queued').length === 3, JSON.stringify(relayAnswers));
check('and exactly three devices-wakes go out — one per real event, none for typing',
  pushed.length === 3, `${pushed.length} pushes`);

/* Grepping the server source for these lines stopped meaning anything once
   the rule moved into its own module; asked of the rule directly, the same
   question survives the next move. */
const wording = await import(pathToFileURL(path.resolve(process.cwd(), 'scripts/lib/push-wording.js')).href);
const plainIn = wording.pushBodyFor(wording.pushKindFor('call-invite', {}));
const plainMissed = wording.pushBodyFor(wording.pushKindFor('call-missed', {}));
check('a call says it is a call, and a missed one says that',
  /^Incoming encrypted call\.$/.test(plainIn) && /^Missed encrypted call\.$/.test(plainMissed),
  `${plainIn} / ${plainMissed}`);
check('and the relay is wired to that same rule, not a copy of it',
  /require\('\.\/lib\/push-wording\.js'\)/.test(fs.readFileSync(path.resolve(process.cwd(), 'scripts', 'server.js'), 'utf8')),
  'server.js requires the module');

console.log('\n===== a real message to an absent contact rings the device =====');
/* The check that was missing, and the reason a bug shipped: everything above
   injects payload types straight at the relay. A real chat message does not
   travel as `text` — it travels as a sealed `offline-chat` envelope, and
   gating on the inner names meant nothing ever rang. This drives the actual
   send path instead. */
/* A push service of our own. web-push POSTs to whatever endpoint the
   subscription names, so a local one proves the whole chain — relay decides to
   send, signs with VAPID, and delivers — without needing Google or Apple. */
/* web-push speaks TLS to whatever endpoint the subscription names, so an HTTP
   listener would only ever see a handshake it cannot answer. What is under
   test is the relay's DECISION to wake this device, and that is proven the
   moment it opens a connection to the endpoint — so this counts connections
   rather than parsing requests. */
const deliveries = [];
const pushService = net.createServer((socket) => {
  deliveries.push({ at: Date.now() });
  socket.on('error', () => {});
  socket.destroy();
});
await new Promise((resolve) => pushService.listen(0, '127.0.0.1', resolve));
const pushPort = pushService.address().port;
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fakeSubscription = {
  endpoint: `https://127.0.0.1:${pushPort}/wake-me`,
  keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(crypto.randomBytes(16)) },
};
const peerCtx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
await peerCtx.addInitScript(() => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {} window.__clip = []; });
const peerPage = await peerCtx.newPage();
await peerPage.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
await peerPage.waitForTimeout(2200);
await peerPage.evaluate((pass) => {
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
await peerPage.waitForTimeout(400);
await peerPage.evaluate(() => document.getElementById('setupBtn')?.click());
await peerPage.waitForTimeout(3800);
await peerPage.evaluate((relay) => {
  document.getElementById('mobileInstallGate')?.classList.add('hidden');
  const w = navigator.clipboard.writeText.bind(navigator.clipboard);
  navigator.clipboard.writeText = (t) => { window.__clip.push(t); return w(t).catch(() => {}); };
  window.switchTab?.('chat');
  const url = document.getElementById('chatServerUrl');
  if (url) { url.value = relay; url.dispatchEvent(new Event('input', { bubbles: true })); url.dispatchEvent(new Event('change', { bubbles: true })); }
  document.getElementById('chatConnectBtn')?.click();
}, RELAY);
await peerPage.waitForTimeout(5500);
const peerCard = await peerPage.evaluate(async () => { await window.copyChatFullIdentity(); return window.__clip.at(-1); });
await page.evaluate(async (card) => {
  window.switchTab?.('chat');
  await new Promise((r) => setTimeout(r, 800));
  document.getElementById('chatStartChatBtn')?.click();
  await new Promise((r) => setTimeout(r, 500));
  document.querySelector('[data-chat-manual-json]').value = card;
  document.querySelector('[data-chat-manual-submit]')?.click();
}, peerCard);
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('#chatPeerList .chat-peer-card')?.click());
await page.waitForTimeout(2500);
/* The contact steps away, then a real message is sent to them. */
/* The absent contact is the one who must be woken, so the subscription is
   registered against their fingerprint. */
const peerFingerprint = await peerPage.evaluate(() => window.PoorijaChat.identityFingerprint());
const registered = await peerPage.evaluate(async ({ relay, subscription, fingerprint }) => {
  const response = await fetch(new URL('/push/subscribe', relay), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fingerprint, subscription, ttlDays: 30 }),
  });
  return response.ok;
}, { relay: RELAY, subscription: fakeSubscription, fingerprint: peerFingerprint });
check('the absent contact has a subscription on the relay', registered === true, String(registered));
/* Genuinely absent, not merely locked.
 *
 * Since 2.111 a locked app deliberately KEEPS its relay connection — that was
 * the fix for messages lost while the app sat locked in the background — so
 * lockApp() alone leaves the recipient online as far as the relay can tell. It
 * forwards live, has no reason to reach for the push service, and this section
 * measured that absence of a wake-up as the relay failing to send one.
 *
 * disconnectChat() is what the app itself calls when somebody leaves: it closes
 * the relay socket, destroys the peer and stops reconnecting. That is what
 * "steps away" has to mean now. */
await peerPage.evaluate(() => {
  window.disconnectChat?.();
  (window.lockApp || window.PoorijaApp?.lockApp)?.();
});
await peerPage.waitForTimeout(4000);
await page.fill('#chatComposer', 'this should ring their phone');
await page.click('#chatSendMessageBtn');
await page.waitForTimeout(4000);
console.log(`  connections to our own push endpoint: ${deliveries.length}`);
check('a queued chat message makes the relay reach for the push service',
  deliveries.length >= 1, deliveries.length ? `${deliveries.length} connection(s)` : 'the relay never tried');
/* One message, one wake. Anything more is a notification storm on the phone. */
check('and it does so exactly once for one message',
  deliveries.length === 1, `${deliveries.length} connection(s) for a single message`);
pushService.close();

console.log('\n===== one device, one row, however often it re-subscribes =====');
/* The reported symptom: one message, several notifications. A device that
   re-subscribes is issued a new endpoint, and the relay kept every old row —
   so one message woke the phone once per row. */
const deviceKey = indexKeyFor(fingerprint);
const rows = [];
for (let attempt = 0; attempt < 3; attempt += 1) {
  await page.evaluate(async ({ relay, fp, attemptIndex }) => {
    await fetch(new URL('/push/subscribe', relay), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fingerprint: fp,
        subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/ROTATED-${attemptIndex}`,
          keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' } },
        ttlDays: 30,
        deviceId: 'audit-device-one',
      }),
    });
  }, { relay: RELAY, fp: fingerprint, attemptIndex: attempt });
  await page.waitForTimeout(400);
  rows.push((readStore()[deviceKey] || []).length);
}
console.log('  rows after each re-subscribe: ' + JSON.stringify(rows));
check('re-subscribing replaces the row instead of adding another',
  rows.every((count) => count === 1), JSON.stringify(rows));

/* Rows left by older builds carry no device id and cannot be matched, so a
   device that registers with one sweeps them away. Without this the phones
   that accumulated duplicates before the fix would keep ringing twice. */
await page.evaluate(async ({ relay, fp }) => {
  await fetch(new URL('/push/subscribe', relay), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fingerprint: fp,
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/LEGACY-NO-DEVICE-ID',
        keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' } },
      ttlDays: 30 }),
  });
}, { relay: RELAY, fp: fingerprint });
await page.waitForTimeout(400);
const withLegacy = (readStore()[deviceKey] || []).length;
await page.evaluate(async ({ relay, fp }) => {
  await fetch(new URL('/push/subscribe', relay), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fingerprint: fp,
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/ROTATED-AGAIN',
        keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' } },
      ttlDays: 30, deviceId: 'audit-device-one' }),
  });
}, { relay: RELAY, fp: fingerprint });
await page.waitForTimeout(500);
const afterSweep = (readStore()[deviceKey] || []).length;
console.log(`  rows with a legacy entry: ${withLegacy} → after a device re-registers: ${afterSweep}`);
check('a legacy row with no device id is swept when a device re-registers',
  withLegacy === 2 && afterSweep === 1, `${withLegacy} → ${afterSweep}`);

/* And a genuinely different device still gets its own row. */
await page.evaluate(async ({ relay, fp }) => {
  await fetch(new URL('/push/subscribe', relay), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fingerprint: fp,
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/SECOND-DEVICE',
        keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' } },
      ttlDays: 30, deviceId: 'audit-device-two',
    }),
  });
}, { relay: RELAY, fp: fingerprint });
await page.waitForTimeout(500);
const bothDevices = (readStore()[deviceKey] || []).length;
check('a second device still gets a row of its own', bothDevices === 2, `${bothDevices} rows`);

console.log('\n===== a call rings once, and a missed call says so =====');
/* Calls take a different road to the relay than messages — they are direct
   payload types, not sealed envelopes — so they need their own proof. */
const callService = net.createServer((socket) => { callWakes.push(Date.now()); socket.on('error', () => {}); socket.destroy(); });
const callWakes = [];
await new Promise((resolve) => callService.listen(0, '127.0.0.1', resolve));
const callPort = callService.address().port;
const callEcdh = crypto.createECDH('prime256v1');
callEcdh.generateKeys();
await page.evaluate(async ({ relay, fp, port, p256dh }) => {
  await fetch(new URL('/push/subscribe', relay), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fingerprint: fp,
      subscription: { endpoint: `https://127.0.0.1:${port}/call-wake`, keys: { p256dh, auth: 'tBHItJI5svbpez7KI4CCXg==' } },
      ttlDays: 30, deviceId: 'audit-call-device' }),
  });
}, { relay: RELAY, fp: peerFingerprint, port: callPort,
     p256dh: callEcdh.getPublicKey().toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'') });
await page.waitForTimeout(600);
const wakesBeforeCall = callWakes.length;
/* An incoming call and then a missed one, sent the way the app sends them. */
await page.evaluate(async ({ relay, fp }) => {
  const send = (payload) => fetch(new URL('/relay-test-not-used', relay)).catch(() => {});
  void send; void fp;
}, { relay: RELAY, fp: peerFingerprint });
await page.evaluate(() => {
  const peer = (window.__peerForCalls = null);
  void peer;
});
/* Drive it through the app: place a call to the absent contact. */
await page.evaluate(() => document.getElementById('chatVoiceCallBtn')?.click());
await page.waitForTimeout(6000);
await page.evaluate(() => document.getElementById('chatEndCallBtn')?.click()
  || document.getElementById('chatFloatingEndCallBtn')?.click());
await page.waitForTimeout(4000);
console.log(`  wakes for the call attempt: ${callWakes.length - wakesBeforeCall}`);
check('calling an absent contact wakes their device',
  callWakes.length > wakesBeforeCall, `${callWakes.length - wakesBeforeCall} wake(s)`);
callService.close();

/* What a notification is allowed to say, checked against the rule itself
   rather than against the source it happens to be written in. The push body is
   encrypted to the subscription's keys, so it cannot be read off the wire once
   sent - this is the one place the wording can be observed at all. */
const { pushKindFor, pushBodyFor, pushTagFor } = wording;
const say = (type, payload) => pushBodyFor(pushKindFor(type, payload));
const chat1 = say('offline-chat', { class: 'text' });
const chatG = say('offline-chat', { class: 'text', scope: 'group' });
const callV = say('offline-chat', { signal: 'call-invite', mode: 'video' });
const gcallV = say('offline-chat', { signal: 'gcall-invite', mode: 'video', scope: 'group' });
const gcallA = say('offline-chat', { signal: 'gcall-invite', mode: 'voice', scope: 'group' });
const missedG = say('offline-chat', { signal: 'call-missed', mode: 'video', scope: 'group' });
console.log(`  1:1 message   : ${chat1}`);
console.log(`  group message : ${chatG}`);
console.log(`  1:1 video call: ${callV}`);
console.log(`  group video   : ${gcallV}`);
console.log(`  group voice   : ${gcallA}`);
console.log(`  missed group  : ${missedG}`);
check('an incoming call and a missed call do not read the same',
  /Incoming/.test(callV) && /Missed/.test(missedG) && callV !== missedG, `${callV} / ${missedG}`);
check('a group message says it came from a group', /group/i.test(chatG) && !/group/i.test(chat1), chatG);
check('a group call says it is a group call', /group/i.test(gcallV), gcallV);
check('and still says voice or video', /video/.test(gcallV) && /voice/.test(gcallA), `${gcallV} / ${gcallA}`);
check('a missed group call says both', /Missed/.test(missedG) && /group/i.test(missedG) && /video/.test(missedG), missedG);
check('nothing in the wording names a person, a group or a message',
  [chat1, chatG, callV, gcallV, gcallA, missedG].every((line) => !/[\u0600-\u06FF]/.test(line) && line.split(' ').length <= 8),
  'no names, no content');
check('calls and messages stack under different tags',
  pushTagFor(pushKindFor('offline-chat', { signal: 'gcall-invite', scope: 'group' })) === 'poorija-call'
  && pushTagFor(pushKindFor('offline-chat', { scope: 'group' })) === 'poorija-chat', 'call vs chat tag');

/* Ringing somebody who is not connected: the invitation is queued rather than
   written off as missed on the spot, and it becomes missed only after the
   window closes. */
const offlineRing = chatSource();
check('an offline contact is rung rather than written off immediately',
  /startOfflineRing\(peerRecord, mode\)/.test(offlineRing)
  && /OFFLINE_RING_MS = 30000/.test(offlineRing), 'js/chat/*');
check('and the ring turns into a missed call, on both sides',
  /clearOfflineRing\(\);[\s\S]{0,400}type: 'call-missed'/.test(offlineRing), 'js/chat/*');

console.log('\n===== what the native shell is told instead =====');
/* The desktop build has no Push API: wry does not implement it and there is no
   push service behind it. What it does have is an OS notification while the app
   is running. The settings card has to say that, rather than reusing the
   browser's "this browser cannot" line, which talks about iPhone home screens
   and means nothing on a Mac. Nothing pinned this before. */
const nativeNote = await page.evaluate(() => {
  const before = window.__POORIJA_DESKTOP__;
  window.__POORIJA_DESKTOP__ = true;
  window.syncPushSettingsUi?.();
  const out = {
    hint: document.getElementById('pushStatusHint')?.textContent?.trim() || '',
    toggleDisabled: !!document.getElementById('pushBackgroundToggle')?.disabled,
  };
  if (before === undefined) delete window.__POORIJA_DESKTOP__; else window.__POORIJA_DESKTOP__ = before;
  window.syncPushSettingsUi?.();
  out.hintBack = document.getElementById('pushStatusHint')?.textContent?.trim() || '';
  return out;
});
console.log(`  native hint: ${nativeNote.hint}`);
check('the native shell gets its own note, not the browser one',
  /نیتیو|native app/i.test(nativeNote.hint) && !/آیفون|iPhone/i.test(nativeNote.hint),
  nativeNote.hint.slice(0, 90));
check('and that note says a fully closed app is a web-only trick',
  /PWA|وب/i.test(nativeNote.hint), nativeNote.hint.slice(0, 90));
check('the toggle is off-limits there rather than dead',
  nativeNote.toggleDisabled === true, String(nativeNote.toggleDisabled));
check('and the browser hint comes back afterwards',
  nativeNote.hintBack !== nativeNote.hint, nativeNote.hintBack.slice(0, 60));

console.log('\n===== the service worker can actually show one =====');
const sw = fs.readFileSync(path.resolve(process.cwd(), 'sw.js'), 'utf8');
check('the worker listens for push and shows a notification',
  /addEventListener\('push'/.test(sw) && /showNotification/.test(sw),
  'sw.js');

console.log('\n===== when it cannot subscribe, it says why =====');
/* "Push failed" is true and useless: every browser that refuses a
   subscription refuses it for its own reason, and most are one setting the
   reader could change if somebody named it. */
const advice = await page.evaluate(async () => {
  const probe = window.__pushAdviceProbe;
  if (!probe) return { missing: true };
  const cases = ['brave', 'firefox', 'vivaldi', 'chrome', 'edge', 'safari', 'other'];
  const out = {};
  for (const family of cases) out[family] = await probe(family);
  return out;
});
console.log('  ' + JSON.stringify(Object.fromEntries(
  Object.entries(advice).map(([k, v]) => [k, String(v).slice(0, 44)]))));
check('there is advice for every browser family', !advice.missing
  && Object.values(advice).every((line) => typeof line === 'string' && line.length > 20),
  Object.keys(advice).join(', '));
check('each family gets its own advice, not one generic line',
  new Set(Object.values(advice)).size === Object.keys(advice).length,
  `${new Set(Object.values(advice)).size} distinct of ${Object.keys(advice).length}`);
check('the Brave answer names the setting that actually fixes it',
  /brave:\/\/settings\/privacy/.test(advice.brave || '') && /push messaging/i.test(advice.brave || ''),
  String(advice.brave || '').slice(0, 70));
check('and the Firefox answer says the desktop cannot install it as an app',
  /PWA|صفحهٔ اصلی|as an app|نصب/i.test(advice.firefox || ''), String(advice.firefox || '').slice(0, 70));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
