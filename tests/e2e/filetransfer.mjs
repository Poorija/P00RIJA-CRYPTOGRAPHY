/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Does a file — any type, any size — actually arrive?
 *
 *   npm run relay             # terminal 1
 *   PORT=8123 npm run dev     # terminal 2
 *   node tests/e2e/filetransfer.mjs
 *
 * FT_HUGE=1 adds a 450 MB pass. It is off by default because it takes minutes
 * and holds most of a gigabyte across the two headless browsers, not because
 * it is less important — it is the size at which the old code threw outright.
 *
 * This is the regression guard for the reported bug: a file "sometimes sends
 * and sometimes gets stuck in sending, especially if it is large". Four
 * separate defects produced that one symptom, and each has a check here.
 *
 *   1. sendEncryptedBlob() read the whole file, encrypted it in one piece and
 *      base64'd the result into a single JS string. Past ~384 MB that string
 *      exceeds V8's maximum length and throws.               -> the 450 MB pass
 *   2. Nothing watched the data channel. Thousands of 48 KB chunks went out
 *      with a fixed 20 ms nap every fifth one; past 8 MB unsent PeerJS either
 *      buffers without bound or closes the connection outright, and the send
 *      stops with no error anywhere.                         -> the 120 MB pass
 *   3. The receiver counted arrivals rather than distinct indices, so one
 *      retransmitted chunk "completed" a transfer with a hole in it.
 *                                                  -> the duplicate-chunk pass
 *   4. The receiver rebuilt the same oversized string to decrypt it.
 *                                                            -> the 450 MB pass
 *
 * Sizes are checked by digest, not by byte count: a truncated file has the
 * right length surprisingly often, and only the hash catches a hole.
 */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
const PASS = 'Transfer#Harness2026!';
const HUGE = process.env.FT_HUGE === '1';
const MB = 1024 * 1024;

/* Against the deployed server every step takes longer than it does on
   localhost — TLS, a real network, a much larger first load — and fixed sleeps
   that are generous locally silently race there: the profile save lands before
   the chat tab exists, no identity is published, and every later failure reads
   as a file-transfer bug when it is really a harness one. Wait on conditions
   instead. */
const waitFor = async (page, fn, { timeoutMs = 90000, arg = null } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(fn, arg)) return true;
    } catch (_error) { /* mid-navigation */ }
    await page.waitForTimeout(500);
  }
  return false;
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const STORE = process.env.CHAT_OFFLINE_STORE_PATH
  || path.resolve('data/chat-signal/offline-messages.json');
/* Against a deployed relay the store is not on this disk. REMOTE_STORE_CMD
   supplies a way to read it — an ssh plus docker exec, typically — so the same
   suite proves the queueing half locally and on the real server. */
const REMOTE_STORE_CMD = process.env.REMOTE_STORE_CMD || '';
const mailbox = (fingerprint) => {
  try {
    const raw = REMOTE_STORE_CMD
      ? JSON.parse(execSync(REMOTE_STORE_CMD, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }))
      : readMailboxes(STORE);
    return raw[fingerprint] || [];
  } catch (_error) { return []; }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-ft-'));
/* Real bytes, written a megabyte at a time so building a 450 MB fixture does
   not need 450 MB of Node heap. */
function makeFile(name, bytes) {
  const file = path.join(tmp, name);
  const block = crypto.randomBytes(MB);
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'w');
  for (let written = 0; written < bytes; written += MB) {
    const piece = block.subarray(0, Math.min(MB, bytes - written));
    fs.writeSync(fd, piece);
    hash.update(piece);
  }
  fs.closeSync(fd);
  return { file, digest: hash.digest('hex'), size: bytes };
}
/* For the two "should be refused" cases the bytes are never read, so a sparse
   file costs no disk and no time. */
function makeSparseFile(name, bytes) {
  const file = path.join(tmp, name);
  fs.closeSync(fs.openSync(file, 'w'));
  fs.truncateSync(file, bytes);
  return { file, size: bytes };
}

const browser = await chromium.launch();

async function openApp(tag, { duplicateChunk = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('poorija_lang', 'en'); } catch (e) {}
    /* A deployed build registers a service worker, and the app reloads itself
       once when it sees a new one. That reload lands in the middle of the
       harness driving the setup form and wipes it, which looked like the app
       failing on the server. Taking the API away is what the native shell does
       too, so the app is known to cope with its absence. */
    try { delete Navigator.prototype.serviceWorker; } catch (e) {}
  });
  if (duplicateChunk) {
    /* Replay one whole application message onto the wire a second time, so the
       receiver genuinely sees the same file-chunk index twice.
       PeerJS splits anything over 16300 bytes into several frames inside one
       synchronous loop, so the frames captured before the next microtask are
       exactly one message; replaying that set makes PeerJS reassemble and emit
       it again. Duplicating a single frame instead would not test this code at
       all — PeerJS's own assembler counts arrivals the same way the receiver
       used to, so it would complete early with a hole and corrupt the message
       before it ever reached the app. */
    await ctx.addInitScript(() => {
      const send = RTCDataChannel.prototype.send;
      let sends = 0;
      let burst = [];
      let scheduled = false;
      window.__duplicated = 0;
      RTCDataChannel.prototype.send = function patched(data) {
        const result = send.call(this, data);
        sends += 1;
        /* Past the handshake, and only once. */
        if (window.__duplicated === 0 && sends > 60) {
          burst.push(typeof data === 'string' ? data : data.slice(0));
          if (!scheduled) {
            scheduled = true;
            const channel = this;
            queueMicrotask(() => {
              const frames = burst;
              burst = [];
              scheduled = false;
              window.__duplicated = 1;
              try {
                for (const frame of frames) send.call(channel, frame);
              } catch (e) { window.__duplicated = -1; }
            });
          }
        }
        return result;
      };
    });
  }
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message.slice(0, 160)}`));
  page.__errors = errors;
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
  /* isLocked is the honest signal. #initialSetup keeps display:block and never
     gains .hidden even once the app is unlocked, so watching it waits out the
     full timeout and then carries on as if nothing were wrong. */
  const unlocked = await waitFor(page, () => window.PoorijaApp?.state?.isLocked === false);
  if (!unlocked) console.log(`  ${tag}: setup never finished`);
  await page.evaluate(() => {
    window.__toasts = [];
    window.__clip = [];
    const orig = window.PoorijaApp?.showNotification?.bind(window.PoorijaApp);
    if (window.PoorijaApp) {
      window.PoorijaApp.showNotification = (m, t) => { window.__toasts.push(`${t}: ${m}`); return orig?.(m, t); };
    }
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__clip.push(t); return write(t).catch(() => {}); };
    document.getElementById('mobileInstallGate')?.classList.add('hidden');
    window.switchTab?.('chat');
  });
  /* A display name is cosmetic here — contacts are picked by position, and the
     ghost by its name in the card — so this is best-effort. The field lives in
     the chat settings pane and is not built until that pane is opened. */
  await waitFor(page, () => Boolean(document.getElementById('chatDisplayName')), { timeoutMs: 5000 });
  await page.evaluate((name) => {
    const field = document.getElementById('chatDisplayName');
    if (!field) return;
    field.value = name;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('chatSaveProfileBtn')?.click();
  }, tag);
  await page.waitForTimeout(900);
  await page.evaluate((relay) => {
    const el = document.getElementById('chatServerUrl');
    if (el) { el.value = relay; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    document.getElementById('chatConnectBtn')?.click();
  }, RELAY);
  /* A peer id only appears once the signalling server has assigned one, which
     is the honest "we are connected" signal. */
  const online = await waitFor(page, () => (document.getElementById('chatPeerId')?.textContent || '').trim().length > 8);
  if (!online) console.log(`  ${tag}: never got a peer id from the relay`);
  return page;
}

const identity = async (p) => {
  await waitFor(p, () => typeof window.copyChatFullIdentity === 'function');
  return p.evaluate(async () => { await window.copyChatFullIdentity(); return window.__clip.at(-1); });
};
const importIdentity = (p, text) => p.evaluate(async (t) => {
  document.getElementById('chatStartChatBtn')?.click();
  await new Promise((r) => setTimeout(r, 1200));
  const field = document.querySelector('[data-chat-manual-json]');
  if (field) { field.value = t; field.dispatchEvent(new Event('input', { bubbles: true })); }
  document.querySelector('[data-chat-manual-submit]')?.click();
}, text);

const openFirstChat = async (p) => {
  await p.evaluate(() => document.querySelector('#chatPeerList .chat-peer-card')?.click());
  await p.waitForSelector('#chatComposer', { state: 'visible', timeout: 30000 });
  await p.waitForTimeout(1200);
};

/* The received file is only reachable as an object URL on its bubble, which is
   the right thing to hash: it is exactly what the user would open. */
const ATTACHMENTS = '#chatMessages a[data-chat-download-message][href^="blob:"]';
const digestOfLastAttachment = (p) => p.evaluate(async (selector) => {
  const links = [...document.querySelectorAll(selector)];
  const url = links[links.length - 1]?.getAttribute('href');
  if (!url) return { error: 'no attachment link' };
  const blob = await (await fetch(url)).blob();
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return {
    size: blob.size,
    digest: [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join(''),
  };
}, ATTACHMENTS);

const countAttachments = (p) => p.evaluate((selector) => document.querySelectorAll(selector).length, ATTACHMENTS);

/* What the user actually looks at while a big file moves. Sampled rather than
   read once at the end: the banner is meant to be alive during the transfer,
   and by the time it finishes it says "Sent". */
const bannerSample = (p) => p.evaluate(() => {
  const banner = document.getElementById('chatTransferBanner');
  if (!banner || banner.classList.contains('hidden')) return null;
  return {
    text: document.getElementById('chatTransferBannerText')?.textContent || '',
    detail: document.getElementById('chatTransferBannerDetail')?.textContent || '',
    width: document.getElementById('chatTransferBarFill')?.style.width || '',
    incoming: banner.classList.contains('is-incoming'),
  };
});

console.log('\n===== two peers, one channel =====');
const A = await openApp('SENDER', { duplicateChunk: true });
const B = await openApp('RECEIVER');
const idA = await identity(A);
const idB = await identity(B);
await importIdentity(A, idB);
await importIdentity(B, idA);
await waitFor(A, () => document.querySelectorAll('#chatPeerList .chat-peer-card').length > 0);
await waitFor(B, () => document.querySelectorAll('#chatPeerList .chat-peer-card').length > 0);
await openFirstChat(A);
await openFirstChat(B);

/* Presence first, then an actual key exchange. Sending a file before the
   session is up is refused by design, and that refusal is not the bug under
   test — reading it as one is what made the first remote run look like a
   product failure. */
await waitFor(A, () => !/offline|آفلاین/i.test(document.getElementById('chatActivePeerMeta')?.textContent || 'offline'));
const live = await A.evaluate(() => (document.getElementById('chatActivePeerMeta')?.textContent || '').trim());
check('the two peers see each other', Boolean(live) && !/offline|آفلاین/i.test(live), live.slice(0, 70) || '(no status shown)');

await A.fill('#chatComposer', 'session warm-up');
await A.click('#chatSendMessageBtn');
const paired = await waitFor(B, () => [...document.querySelectorAll('#chatMessages [data-id]')]
  .some((n) => (n.textContent || '').includes('session warm-up')));
check('a secure session is established between them', paired,
  paired ? '' : 'the warm-up message never landed, so nothing below is about file transfer');

async function sendOverChannel(label, bytes, { timeoutMs = 180000, autoAccept = true } = {}) {
  const fixture = makeFile(`${label}.bin`, bytes);
  const before = await countAttachments(B);
  await A.evaluate(() => { window.__toasts = []; });
  await A.setInputFiles('#chatFileInput', fixture.file);
  const deadline = Date.now() + timeoutMs;
  let arrived = false;
  const sent = [];
  const received = [];
  while (Date.now() < deadline) {
    await B.waitForTimeout(400);
    /* A live file-start above the receiver's quota (or the large-file line) is
       an offer now, not a delivery: the receiver is asked before the bytes
       move. Answering it here is what the person at that keyboard would do. */
    if (autoAccept) {
      await B.evaluate(() => {
        const btn = document.querySelector('.poorija-dialog:not(.hidden) .poorija-dialog-ok');
        if (btn && !btn.disabled) btn.click();
      });
    }
    const [outgoing, incoming] = await Promise.all([bannerSample(A), bannerSample(B)]);
    if (outgoing?.detail) sent.push(outgoing);
    if (incoming?.detail) received.push(incoming);
    if ((await countAttachments(B)) > before) { arrived = true; break; }
  }
  const toasts = await A.evaluate(() => (window.__toasts || []).slice(-4));
  check(`${label}: the sender did not refuse it`,
    !toasts.some((t) => /limited to|حداکثر حجم/i.test(t)), toasts.join(' | ').slice(0, 120));
  check(`${label}: it arrived`, arrived, arrived ? '' : `nothing new on the receiver in ${timeoutMs / 1000}s`);
  if (!arrived) { fs.rmSync(fixture.file, { force: true }); return null; }
  const got = await digestOfLastAttachment(B);
  check(`${label}: byte-for-byte identical`, got.digest === fixture.digest,
    `${got.size ?? '?'} bytes, ${String(got.digest).slice(0, 16)} vs ${fixture.digest.slice(0, 16)}`);
  const status = await A.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-id]')];
    return nodes[nodes.length - 1]?.className || '';
  });
  check(`${label}: the sender is not still "sending"`, !/queued|sending|failed/i.test(status), status.slice(0, 90));
  /* Removed as we go rather than at the end: the four fixtures together are
     nearly 600 MB with FT_HUGE set. */
  fs.rmSync(fixture.file, { force: true });
  return { got, sent, received };
}

console.log('\n===== 1 MB — the size that always worked =====');
await sendOverChannel('1 MB', 1 * MB, { timeoutMs: 60000 });

const duplicated = await A.evaluate(() => window.__duplicated);
check('one message really was put on the wire twice, so the 1 MB file above was reassembled despite a duplicate',
  duplicated === 1, String(duplicated));

console.log('\n===== 20 MB — refused outright by the old 16 MB limit =====');
await sendOverChannel('20 MB', 20 * MB, { timeoutMs: 120000 });

/* ---- the consent gate ------------------------------------------------
   A live file-start above the receiver's quota is an offer: nothing moves
   until they answer. The 5 MB fixture against a 1 MB quota must sit in the
   dialog, and accepting it must land the file. Declining must cancel BOTH
   directions: no arrival, a refusal note on the sender's side, and their
   bubble must not sit on "sending" forever. */
console.log('\n===== quota gate — ask, then accept =====');
const setQuota = async (p, bytes) => p.evaluate((value) => {
  const select = document.getElementById('chatAutoDownloadLimit');
  if (!select) return false;
  select.value = String(value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, bytes);
const quotaSet = await setQuota(B, 1 * MB);
check('the auto-download quota control exists and takes a value', quotaSet, '');
{
  const fixture = makeFile('quota-ask.bin', 5 * MB);
  const before = await countAttachments(B);
  await A.evaluate(() => { window.__toasts = []; });
  await A.setInputFiles('#chatFileInput', fixture.file);
  /* The offer must actually be a question: give the receiver a moment in
     which the file could have started arriving had the gate not been there. */
  await B.waitForTimeout(2500);
  const asked = await B.evaluate(() => {
    const dialog = document.querySelector('.poorija-dialog:not(.hidden)');
    return Boolean(dialog) && /دریافت فایل|Incoming file/.test(dialog.textContent || '');
  });
  check('a file over the quota asks before any bytes move', asked,
    asked ? '' : 'no consent dialog appeared on the receiver');
  const movedAnyway = await countAttachments(B);
  check('and nothing arrives while the question is open',
    movedAnyway === before, `attachments went ${before} -> ${movedAnyway}`);
  await B.evaluate(() => {
    const btn = document.querySelector('.poorija-dialog:not(.hidden) .poorija-dialog-ok');
    if (btn) btn.click();
  });
  const deadline = Date.now() + 90000;
  let landed = false;
  while (Date.now() < deadline && !landed) {
    await B.waitForTimeout(500);
    landed = (await countAttachments(B)) > before;
  }
  check('accepting the offer completes the download', landed, 'nothing arrived after accepting');
  const toasts = await A.evaluate(() => (window.__toasts || []).slice(-3));
  check('the sender was not told anything failed', !toasts.some((x) => /رد|declin|ناتمام/i.test(x)), toasts.join(' | ').slice(0, 120));
}

console.log('\n===== quota gate — decline cancels both directions =====');
{
  const fixture = makeFile('quota-decline.bin', 5 * MB);
  const before = await countAttachments(B);
  await A.evaluate(() => { window.__toasts = []; });
  await A.setInputFiles('#chatFileInput', fixture.file);
  await B.waitForTimeout(2500);
  const asked = await B.evaluate(() => Boolean(document.querySelector('.poorija-dialog:not(.hidden)')));
  check('the decline pass also starts as a question', asked, 'no dialog to decline');
  await B.evaluate(() => {
    const btn = document.querySelector('.poorija-dialog:not(.hidden) .poorija-dialog-cancel');
    if (btn) btn.click();
  });
  const deadline = Date.now() + 20000;
  let refused = false;
  let toasts = [];
  while (Date.now() < deadline && !refused) {
    await A.waitForTimeout(500);
    toasts = await A.evaluate(() => (window.__toasts || []).slice(-4));
    refused = toasts.some((x) => /رد|declin/i.test(x));
  }
  check('the sender learns the file was declined', refused, toasts.join(' | ').slice(0, 140));
  await B.waitForTimeout(2500);
  const after = await countAttachments(B);
  check('and nothing arrived on the receiver', after === before, `attachments went ${before} -> ${after}`);
  const refusedNote = await A.evaluate(() => [...document.querySelectorAll('#chatMessages .chat-system-note')]
    .some((n) => /رد|cancel/i.test(n.textContent || '')));
  check('the sender\'s thread carries the refusal note', refusedNote, 'no system note about the refusal');
  const stuck = await A.evaluate(() => [...document.querySelectorAll('[data-chat-message-status]')]
    .filter((n) => /sending|در حال ارسال/i.test(n.textContent || '')).length);
  check('no bubble is left claiming to still be sending', stuck === 0, `${stuck} bubble(s) stuck on "sending"`);
}
await setQuota(B, 5 * 1024 * 1024);

console.log('\n===== 120 MB — the size that stalled with no error =====');
const big = await sendOverChannel('120 MB', 120 * MB, { timeoutMs: 300000 });

console.log('\n===== what the banner says while it moves =====');
const outSamples = big?.sent || [];
const inSamples = big?.received || [];
console.log('  sender: ' + JSON.stringify(outSamples.slice(-1)[0] || null));
console.log('  receiver: ' + JSON.stringify(inSamples.slice(-1)[0] || null));
/* "128.4 MB / 500 MB · 12.3 MB/s · 30s left" — bytes, a rate and an estimate.
   The line carries invisible bidi isolates so a right-to-left reader is not
   told 500 MB was sent out of 128; they are formatting, not content, so they
   come off before matching. */
const noMarks = (text) => String(text || '').replace(/[\u2066-\u2069\u200e\u200f]/g, '');
const RATE = /\d[\d.]*\s*(Bytes|KB|MB|GB)\/s/;
const AMOUNT = /\d[\d.]*\s*(Bytes|KB|MB|GB)\s*\/\s*\d[\d.]*\s*(Bytes|KB|MB|GB)/;
check('the sender shows how much has gone', outSamples.some((s) => AMOUNT.test(noMarks(s.detail))),
  outSamples.slice(-1)[0]?.detail || 'no sample');
/* Stripping the marks to match would pass just as well with the isolation
   gone, so check the marks are actually there. Without them a Persian reader
   is shown the total where the sent amount should be. */
const wrapped = (part) => /^[\u2066\u2068]/.test(part) && /\u2069$/.test(part);
const isolated = outSamples.filter((s) => AMOUNT.test(noMarks(s.detail)))
  .every((s) => s.detail.split(' \u00b7 ').every(wrapped));
check('and each part is isolated so it is not read backwards in Persian', isolated,
  JSON.stringify(outSamples.slice(-1)[0]?.detail || '').slice(0, 90));
check('the sender shows a transfer rate', outSamples.some((s) => RATE.test(noMarks(s.detail))),
  outSamples.slice(-1)[0]?.detail || 'no sample');
check('the sender shows an estimate of what is left',
  outSamples.some((s) => /left|مانده/.test(s.detail)), outSamples.slice(-1)[0]?.detail || 'no sample');
/* The bar has to move, not just exist: a fill stuck at one width is what a
   stalled transfer looked like. */
const widths = new Set(outSamples.map((s) => s.width));
check('the progress bar advances', widths.size > 2, [...widths].slice(0, 6).join(' '));
check('the receiver shows progress too, which it never used to',
  inSamples.some((s) => AMOUNT.test(noMarks(s.detail)) && s.incoming),
  inSamples.slice(-1)[0]?.detail || 'no sample');
/* It hides on a short delay after the last chunk, so this waits rather than
   sampling once — the poll above exits the moment the receiver has the file,
   which can be before the sender has painted "Sent". */
const bannerGone = await waitFor(A, () => document.getElementById('chatTransferBanner')?.classList.contains('hidden'), { timeoutMs: 20000 });
check('the banner goes away when it is done', bannerGone,
  bannerGone ? '' : await A.evaluate(() => document.getElementById('chatTransferBannerText')?.textContent || ''));

if (HUGE) {
  console.log('\n===== 450 MB — the size that threw on the base64 string =====');
  await sendOverChannel('450 MB', 450 * MB, { timeoutMs: 900000 });
} else {
  console.log('\n  (skipping the 450 MB pass; set FT_HUGE=1 to include it)');
}

console.log('\n===== a file for someone who is not there =====');
const ghost = await A.evaluate(async () => {
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
  const digest = await crypto.subtle.digest('SHA-256', spki);
  const fingerprint = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
  window.__ghostPrivate = b64(pkcs8);
  const payload = {
    app: 'P00RIJA Cryptography', type: 'poorija-chat-identity', version: 1,
    name: 'Absent Friend',
    peerId: 'poorija-peer-absent-' + Math.random().toString(36).slice(2, 10),
    fingerprint, publicKeyData: b64(spki), createdAt: new Date().toISOString(),
  };
  return { text: 'poorija-chat-v1:' + btoa(unescape(encodeURIComponent(JSON.stringify(payload)))), fingerprint };
});
await importIdentity(A, ghost.text);
await waitFor(A, () => [...document.querySelectorAll('#chatPeerList .chat-peer-card')]
  .some((c) => (c.textContent || '').includes('Absent')));
await A.evaluate(() => {
  const cards = [...document.querySelectorAll('#chatPeerList .chat-peer-card')];
  cards.find((c) => (c.textContent || '').includes('Absent'))?.click();
});
/* Confirm the right conversation is open before sending: clicking the wrong
   card sends the file to the live peer and the mailbox check then reads zero
   for a reason that has nothing to do with queueing. */
const onGhost = await waitFor(A, () => /Absent/.test(document.getElementById('chatActivePeerName')?.textContent || ''));
check('the absent contact\'s conversation is the one open', onGhost,
  await A.evaluate(() => document.getElementById('chatActivePeerName')?.textContent || '(none)'));

let queueSettled = false;
let queueSeen = 0;
let queueExpected = 0;
const offlineFixture = makeFile('offline.bin', 6 * MB);
await A.evaluate(() => { window.__toasts = []; });
await A.setInputFiles('#chatFileInput', offlineFixture.file);
/* 96 sealed envelopes, each with its own RSA wrap, and against a deployed
   relay each is a round trip. Wait for the count to settle rather than
   guessing how long that takes. */
{
  /* Count what is actually visible on disk. A sealed envelope has no
     `payload.message` at all - only `seal` and `body` - so a predicate that
     reads `payload.message.type` can never be true, and the loop silently
     degrades into a fixed sleep that passes until the machine gets slower.
     `class` survives sealing, and the transfer marks every frame as media. */
  const expected = Math.ceil(offlineFixture.size / (64 * 1024)) + 1;
  /* Generous, because the cost here is 96 RSA wraps and 96 round trips and a
     loaded machine can take twice as long as an idle one. The loop still ends
     the moment the count settles; the cap only decides how patient it is
     before giving up, and giving up is reported as its own failure below
     rather than being folded into "chunks went missing" - a slow queue and a
     lossy one need different answers. */
  const deadline = Date.now() + 600000;
  let seen = 0;
  let settled = false;
  while (Date.now() < deadline) {
    await A.waitForTimeout(1000);
    seen = mailbox(ghost.fingerprint).filter((i) => i?.payload?.class === 'media').length;
    if (seen >= expected) { settled = true; break; }
  }
  queueSettled = settled;
  queueSeen = seen;
  queueExpected = expected;
  if (!settled) console.log(`  (only ${seen} of ${expected} media envelopes landed within ${Math.round((Date.now() - (deadline - 600000)) / 1000)}s)`);
}

const queued = mailbox(ghost.fingerprint).map((i) => i?.payload).filter(Boolean);

/* The envelope is sealed now, so the relay's copy says nothing about what is
   inside it. Open each one the way the recipient would — the seal gives up the
   session key, that key opens the body — and assert on what comes out. */
const opened = await A.evaluate(async (envelopes) => {
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', bytes(window.__ghostPrivate), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  const out = [];
  for (const envelope of envelopes) {
    if (!envelope.body || !envelope.seal) { out.push({ plain: envelope.message || null, class: envelope.class }); continue; }
    try {
      const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, bytes(envelope.seal));
      const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
      const clear = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(envelope.body.iv) }, key, bytes(envelope.body.cipher));
      out.push({ plain: JSON.parse(new TextDecoder().decode(clear)), class: envelope.class });
    } catch (error) {
      out.push({ error: String(error).slice(0, 80), class: envelope.class });
    }
  }
  return out;
}, queued);

/* The whole point of sealing the envelope: the mailbox on disk must not name
   the file, its type, or what kind of message it was.
   Scoped to the chat envelopes on purpose. A session-offer is the key exchange
   itself — the recipient has no session key yet, so by construction it cannot
   be encrypted under one, and it carries the sender's display name and public
   key in the clear. That is the same trade Signal makes before sealed sender,
   and it is a known limit rather than an oversight. */
const chatEnvelopes = queued.filter((envelope) => envelope.type === 'offline-chat');
const rawText = JSON.stringify(chatEnvelopes);
check('the relay holds no filename or media type for the queued file',
  !rawText.includes('offline.bin') && !/"(mime|name|kind|durationMs)"/.test(rawText),
  (rawText.match(/"(mime|name|kind)"/g) || ['none']).join(','));

const starts = opened.filter((entry) => entry.plain?.type === 'file-start');
const chunks = opened.filter((entry) => entry.plain?.type === 'file-chunk');
check('the file was queued rather than dropped', starts.length === 1 && chunks.length > 0,
  `${starts.length} start, ${chunks.length} chunks`);

const start = starts[0]?.plain || {};
const expectedChunks = Math.ceil(offlineFixture.size / (64 * 1024));
check('it announces the streaming wire format', Number(start.v) === 2, `v=${start.v}`);
check('the chunk count matches a 64 KB stride', Number(start.totalChunks) === expectedChunks,
  `${start.totalChunks} vs ${expectedChunks}`);
check('the queue finished rather than running out of time', queueSettled,
  queueSettled ? `${queueSeen} envelopes` : `gave up at ${queueSeen} of ${queueExpected} - slow machine, not a lost chunk`);
check('every chunk was queued', chunks.length === expectedChunks, `${chunks.length} of ${expectedChunks}`);
check('the relay was told to treat it as media', starts[0]?.class === 'media', String(starts[0]?.class));

/* Reusing an IV under one AES-GCM key is a genuine break, not a style point:
   two chunks sharing an IV leak the XOR of their plaintexts. */
const ivs = new Set(chunks.map((entry) => JSON.stringify(entry.plain.iv)));
check('each chunk carries its own IV', ivs.size === chunks.length, `${ivs.size} distinct of ${chunks.length}`);
check('no chunk is readable as plain text',
  chunks.every((entry) => typeof entry.plain.chunk === 'string' && !entry.plain.chunk.includes('offline.bin')),
  '');

/* The half that matters: what the relay holds must reassemble, in order, into
   exactly the bytes that were picked. */
const rebuilt = await A.evaluate(async ({ seal, pieces }) => {
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  try {
    const privateKey = await crypto.subtle.importKey(
      'pkcs8', bytes(window.__ghostPrivate), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']
    );
    const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, bytes(seal));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    const out = new Array(pieces.length);
    for (const piece of pieces) {
      out[piece.index] = new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(piece.iv) }, key, bytes(piece.chunk)
      ));
    }
    const blob = new Blob(out);
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return { size: blob.size, digest: [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('') };
  } catch (error) {
    return { error: String(error).slice(0, 140) };
  }
}, {
  seal: queued.find((envelope) => envelope.seal)?.seal,
  pieces: chunks.map((entry) => ({ index: entry.plain.index, iv: entry.plain.iv, chunk: entry.plain.chunk })),
});
check('the absent contact\'s key rebuilds the file exactly', rebuilt.digest === offlineFixture.digest,
  rebuilt.error || `${rebuilt.size} bytes, ${String(rebuilt.digest).slice(0, 16)} vs ${offlineFixture.digest.slice(0, 16)}`);
fs.rmSync(offlineFixture.file, { force: true });

console.log('\n===== the two ceilings =====');
const queuedBefore = mailbox(ghost.fingerprint).length;
const tooBigOffline = makeSparseFile('offline-200mb.bin', 200 * MB);
await A.evaluate(() => { window.__toasts = []; });
await A.setInputFiles('#chatFileInput', tooBigOffline.file);
await A.waitForTimeout(6000);
/* Sizes are wrapped in bidi isolates so "500 MB" does not come out backwards
   inside Persian text. The marks are invisible formatting, not content, so
   take them off before matching. */
const plain = (text) => String(text || '').replace(/[\u2066-\u2069\u200e\u200f]/g, '');
const offlineToasts = await A.evaluate(() => (window.__toasts || []).slice(-4));
check('200 MB to an absent contact is refused, with the reason',
  offlineToasts.some((t) => /only be sent while they are online|larger than/i.test(plain(t))),
  offlineToasts.join(' | ').slice(0, 140));
check('and nothing was added to their mailbox',
  mailbox(ghost.fingerprint).length === queuedBefore,
  `${mailbox(ghost.fingerprint).length} vs ${queuedBefore}`);

/* The absolute ceiling, which is now 4 GB rather than the 500 MB this case was
   written against: the live path is peer to peer, so what bounds it is what
   the two devices can hold, not what a server can carry.
   Driven through sendEncryptedBlob with a stub rather than a 4 GB file,
   because the guard reads file.size and returns before anything opens the
   bytes — and a real one would have to cross the CDP connection as four
   gigabytes of zeroes to prove the same thing. */
const capCheck = await A.evaluate(async () => {
  window.__toasts = [];
  const ceiling = MAX_FILE_BYTES;
  await window.sendEncryptedBlob({ name: 'past-the-ceiling.bin', size: ceiling + 1, type: 'application/octet-stream' }, 'file', 0);
  return { ceiling, toasts: (window.__toasts || []).slice(-4) };
});
check('the live ceiling is 4 GB', capCheck.ceiling === 4 * 1024 * 1024 * 1024,
  `MAX_FILE_BYTES = ${capCheck.ceiling}`);
check('past the ceiling the sender says so, and names it',
  capCheck.toasts.some((t) => /limited to 4 GB/i.test(plain(t))),
  capCheck.toasts.join(' | ').slice(0, 140) || 'no toast at all');

console.log('\n===== the gallery entry =====');
const gallery = await A.evaluate(() => {
  const button = document.getElementById('chatGalleryBtn');
  const input = document.getElementById('chatGalleryInput');
  return {
    button: Boolean(button),
    accept: input?.getAttribute('accept') || '',
    multiple: Boolean(input?.multiple),
    inSheet: Boolean(button?.closest('#chatComposerActions')),
  };
});
check('a gallery action sits in the composer sheet', gallery.button && gallery.inSheet, JSON.stringify(gallery));
check('it asks for photos and videos, which is what opens the library',
  gallery.accept === 'image/*,video/*' && gallery.multiple, gallery.accept);

const errors = [...A.__errors, ...B.__errors];
check('no script threw while doing any of it', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
