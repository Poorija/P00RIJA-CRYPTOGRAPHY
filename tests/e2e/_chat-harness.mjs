/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The two-peer harness the chat suites share.
 *
 * openApp() drives the real setup wizard, connects to the relay and returns a
 * page that is signed in and on the chat tab. identity()/importIdentity() pair
 * two of them the way a person would — by exchanging an identity blob — rather
 * than by reaching into storage, so what is tested is the path a user takes.
 *
 * It lived inside filetransfer.mjs until a second suite needed it. Copying a
 * hundred and fifty lines of setup is how two suites quietly stop testing the
 * same application, so it moved here instead.
 *
 * Underscore-prefixed: tests/e2e/run-all.mjs does not run it. */

import { chromium } from 'playwright';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { readMailboxes } from './_relay-store.mjs';

export const BASE = process.env.PKG_URL || 'http://localhost:8123';
/* The relay has to be reachable FROM THE PAGE, which is not the same as being
   reachable from here. An https page cannot open a ws:// socket or fetch
   http://localhost:9000 — the browser blocks it as mixed content, and the suite
   reports "in use unreachable (0 ms)" as though the relay were down. So when
   the app is served over https the default relay is that same origin, which is
   the container serving both halves anyway; the standalone dev server on 8123
   is http and keeps the separate relay. RELAY_URL still wins over both. */
const sameOriginRelay = /^https:/i.test(BASE);
export const RELAY = process.env.RELAY_URL
  || (sameOriginRelay ? BASE.replace(/\/+$/, '') : 'http://localhost:9000');
export const PASS = 'Transfer#Harness2026!';
export const MB = 1024 * 1024;

export const browser = await chromium.launch();

export const waitFor = async (page, fn, { timeoutMs = 90000, arg = null } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(fn, arg)) return true;
    } catch (_error) { /* mid-navigation */ }
    await page.waitForTimeout(500);
  }
  return false;
};


export const STORE = process.env.CHAT_OFFLINE_STORE_PATH
  || path.resolve('data/chat-signal/offline-messages.json');
/* Against a deployed relay the store is not on this disk. REMOTE_STORE_CMD
   supplies a way to read it — an ssh plus docker exec, typically — so the same
   suite proves the queueing half locally and on the real server. */
export const REMOTE_STORE_CMD = process.env.REMOTE_STORE_CMD || '';
/* A store command that fails must not read as an empty mailbox. It did, and
   the difference between "the relay queued nothing" and "this machine could
   not see the relay" is the difference between a bug and a wrong test — the
   documented command still said `cat offline-messages.json`, which the relay
   stopped writing when the store became one file per recipient, so every
   queueing check against a deployed server quietly asserted against {}. */
export const mailbox = (fingerprint) => {
  if (REMOTE_STORE_CMD) {
    const raw = execSync(REMOTE_STORE_CMD, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return (JSON.parse(raw) || {})[fingerprint] || [];
  }
  try {
    return readMailboxes(STORE)[fingerprint] || [];
  } catch (_error) { return []; }
};

export const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-ft-'));
/* Real bytes, written a megabyte at a time so building a 450 MB fixture does
   not need 450 MB of Node heap. */
export function makeFile(name, bytes) {
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
export function makeSparseFile(name, bytes) {
  const file = path.join(tmp, name);
  fs.closeSync(fs.openSync(file, 'w'));
  fs.truncateSync(file, bytes);
  return { file, size: bytes };
}


export async function openApp(tag, { duplicateChunk = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, ignoreHTTPSErrors: true });
  /* The chat module wires its console probes only when a page asks for them
     before load — shipping them unconditionally would be a bypass rather than
     a diagnostic. Every suite that reaches this harness drives conversations
     through those probes, so the harness asks on their behalf; without it they
     died on `window.__convoLockProbe` being undefined. */
  await ctx.addInitScript(() => {
    try { localStorage.setItem('poorija-debug-probes', '1'); } catch (error) { /* private mode */ }
  });
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
  await page.waitForTimeout(2000);
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

export const identity = async (p) => {
  await waitFor(p, () => typeof window.copyChatFullIdentity === 'function');
  return p.evaluate(async () => { await window.copyChatFullIdentity(); return window.__clip.at(-1); });
};
export const importIdentity = (p, text) => p.evaluate(async (t) => {
  document.getElementById('chatStartChatBtn')?.click();
  await new Promise((r) => setTimeout(r, 1200));
  const field = document.querySelector('[data-chat-manual-json]');
  if (field) { field.value = t; field.dispatchEvent(new Event('input', { bubbles: true })); }
  document.querySelector('[data-chat-manual-submit]')?.click();
}, text);

export const openFirstChat = async (p) => {
  await p.evaluate(() => document.querySelector('#chatPeerList .chat-peer-card')?.click());
  await p.waitForSelector('#chatComposer', { state: 'visible', timeout: 30000 });
  await p.waitForTimeout(1200);
};

/* The received file is only reachable as an object URL on its bubble, which is
   the right thing to hash: it is exactly what the user would open. */
export const ATTACHMENTS = '#chatMessages a[data-chat-download-message][href^="blob:"]';
export const digestOfLastAttachment = (p) => p.evaluate(async (selector) => {
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
