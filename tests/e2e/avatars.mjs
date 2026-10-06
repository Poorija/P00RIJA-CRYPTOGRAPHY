/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A photograph, end to end: chosen in any format a camera produces, stored as
 * one format every device can show, and delivered to contacts who already had
 * the old one. Plus what a hidden message owes the conversation list.
 *
 * The delivery half exists because of a quiet architectural hole: the presence
 * table stopped carrying avatars (rightly — re-serialising megabytes of photo
 * per peer per tick is a GC death spiral), which made the profile card the
 * only carrier of a photograph — and the card was only ever sent to contacts
 * on ANOTHER relay, and only when the receiver's record had NO avatar at all.
 * So a changed photograph reached nobody, on either relay, ever. The card now
 * goes to same-relay contacts too, is pushed the moment the profile changes,
 * and is re-sent per contact whenever the profile version moved — which is
 * what the version-map checks below drive directly.
 *
 * Run like the other browser suites:
 *   PORT=8123 npm run dev     # or the isolated stack's PKG_URL
 *   node tests/e2e/avatars.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const PASS = 'Avatars#Harness2026!';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${String(detail).slice(0, 120)}` : ''}`);
};
const read = (p) => { try { return fs.readFileSync(path.resolve(p), 'utf8'); } catch { return ''; } };

console.log('\n===== source-level guarantees =====');

/* The stored avatar must be one format, and JPEG is it: whatever arrives —
   HEIC, a raw container, a PNG — the editor re-encodes on the way in, so
   every device can display it and every browser can download it. */
const constantsJs = read('js/chat/01-constants.js');
check('the input ceiling is twenty megabytes', constantsJs.includes('MAX_PROFILE_AVATAR_BYTES = 20 * 1024 * 1024'), '');
const profileJs = read('js/chat/34-sheets-profile-clocks.js');
check('the editor stores JPEG, not PNG',
  profileJs.includes("canvas.toDataURL('image/jpeg'") && !profileJs.includes("canvas.toDataURL('image/png'"), '');
check('the editor canvas is big enough to be worth downloading',
  read('index.html').includes('id="chatAvatarEditorCanvas" width="640" height="640"'), '');

/* The conversation list must not quote a hidden message — the whole point of
   the list is to be read at a glance, often over a shoulder. */
const listJs = read('js/chat/24-settings-panels.js');
check('the conversation list labels a hidden message instead of quoting it',
  listJs.includes("last?.hidden ? t('پیام مخفی', 'Hidden message')") && listJs.includes('(last?.hidden ? \'\' : last?.text)'), '');

/* Telegram semantics for the reveal: it lasts exactly as long as the reader
   stays in that thread. */
check('leaving the thread or the chat screen hides revealed messages again',
  read('js/chat/27-message-render.js').includes('function hideRevealedMessages')
  && profileJs.includes('hideRevealedMessages()'), '');

/* The popup: the WHOLE photograph, contain-fit, and a way to take it with
   you. The first cut answered a tap on the face with the same 16-rem circle
   the header shows. */
const renderJs = read('js/chat/27-message-render.js');
const stylesCss = read('css/styles.css');
check('the photo viewer is full-frame, not a circular crop',
  stylesCss.includes('.chat-peer-photo-frame img { max-width: 100%; max-height: 100%;') && stylesCss.includes('object-fit: contain'), '');
check('the photo viewer offers the picture as a download',
  renderJs.includes('data-peer-photo-download') && renderJs.includes('link.download = '), '');

/* ---- the version map, driven directly ----------------------------------- */

console.log('\n===== who gets told about a new photograph =====');

{
  const source = read('js/chat/29-file-transfer.js');
  const start = source.indexOf('function announceProfileCardIfStale(');
  if (start < 0) {
    check('announceProfileCardIfStale exists', false, 'gone from 29-file-transfer.js');
  } else {
    let depth = 0;
    let end = start;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') { depth -= 1; if (!depth) { end = i + 1; break; } }
    }
    const sent = [];
    const online = new Set();
    /* A mutable state object, so a version bump between calls is seen by the
       same closure — exactly the shape the page has. */
    const state = { profile: { updatedAt: 'v1' } };
    const card = new Function('profileCardVersionSent', 'getConversationKey', 'peerLooksOnline',
      'sendProfileCard', 'chatState', `
      ${source.slice(start, end)}
      return announceProfileCardIfStale;
    `)(
      new Map(),
      (peer) => `conv:${peer.peerId}`,
      (peer) => online.has(peer.peerId),
      (peer) => { sent.push(peer.peerId); return true; },
      state,
    );
    const peer = { peerId: 'far-friend', type: '' };

    check('an absent contact is not sent a card — and not stamped as if it had been',
      card(peer) === false && sent.length === 0, JSON.stringify(sent));

    online.add('far-friend');
    check('a contact who is here gets the new version',
      card(peer) === true && sent.join() === 'far-friend', sent.join());

    check('the same version is not sent twice',
      card(peer) === false && sent.length === 1, `${sent.length} sends`);

    state.profile.updatedAt = 'v2';
    check('a changed version reaches the contact again',
      card(peer) === true && sent.length === 2, `${sent.length} sends`);
  }
}

/* ---- in the page --------------------------------------------------------- */

console.log('\n===== in the running app =====');

const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));

  await page.goto(`${BASE}/`, { waitUntil: 'load' });

  /* First run, exactly the way uxfixes does it: fill setup, submit, and
     unlock whenever the lock screen turns up. */
  await page.waitForFunction(
    () => [...document.querySelectorAll('#initialSetup select')].every((s) => s.options.length > 1),
    { timeout: 30000 },
  ).catch(() => {});
  await page.evaluate((pass) => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('setupPassword', pass); set('confirmPassword', pass);
    document.querySelectorAll('#initialSetup select').forEach((s, i) => { if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => { inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true })); });
    const cb = document.getElementById('acceptTermsCheckbox'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  }, PASS);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(3200);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const state = await page.evaluate(() => {
      const lock = document.getElementById('lockScreen');
      const locked = Boolean(lock) && getComputedStyle(lock).display !== 'none' && !lock.classList.contains('hidden');
      return { locked, hasField: Boolean(document.getElementById('unlockPassword')) };
    });
    if (!state.locked) { if (attempt > 2) break; }
    if (state.locked && state.hasField) {
      await page.evaluate(async (pass) => {
        const field = document.getElementById('unlockPassword');
        field.value = pass;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await window.unlockApp?.();
      }, PASS);
    }
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => { document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat'); });
  await page.waitForTimeout(1200);

  /* 1. A PNG that is NOT small goes in; what comes out of the editor is a
        JPEG, the profile is stamped with a version, and the card fan-out
        fires on the stub socket. */
  const avatar = await page.evaluate(async () => {
    window.__sentFrames = [];
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 900, 700);
    gradient.addColorStop(0, '#0ea5e9');
    gradient.addColorStop(1, '#f472b6');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 900, 700);
    for (let i = 0; i < 40; i += 1) {
      ctx.fillStyle = `hsl(${i * 9}, 70%, 60%)`;
      ctx.beginPath();
      ctx.arc((i * 97) % 900, (i * 61) % 700, 8 + (i % 5) * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'photo.png', { type: 'image/png' });
    await updateProfileAvatar(file);
    return { size: file.size };
  });
  await page.waitForFunction(() => { try { return Boolean(chatState?.avatarEditor); } catch (_error) { return false; } },
    null, { timeout: 15000 }).catch(() => {});
  check('a PNG of any size opens the editor', Boolean(await page.evaluate(() => chatState?.avatarEditor)), '');
  const saved = await page.evaluate(() => {
    applyAvatarEditor();
    savePendingAvatar();
    const data = chatState.profile.avatarData || '';
    return { head: data.slice(0, 30), length: data.length, updatedAt: chatState.profile.updatedAt || '' };
  });
  check('what is stored is a JPEG', saved.head.startsWith('data:image/jpeg'), saved.head);
  check('and a sensible one, not a base64 monster', saved.length > 1000 && saved.length < 900000, `${saved.length} chars`);
  check('the profile carries a version contacts can compare against', saved.updatedAt !== '', saved.updatedAt);

  /* 2. Over the ceiling: refused with the honest number, editor never opens. */
  const refused = await page.evaluate(async () => {
    window.__toasts = [];
    const original = window.notify;
    window.notify = (message, type) => { window.__toasts.push(String(message)); original(message, type); };
    try {
      const bytes = new Uint8Array(20 * 1024 * 1024 + 1);
      const file = new File([bytes], 'huge.png', { type: 'image/png' });
      await updateProfileAvatar(file);
    } finally { window.notify = original; }
    return { toasts: window.__toasts, editor: Boolean(chatState.avatarEditor) };
  });
  check('twenty megabytes is the ceiling and the refusal says so',
    refused.toasts.some((text) => text.includes('20 مگابایت') || text.includes('20 MB')) && !refused.editor,
    refused.toasts[0] || '(no toast)');

  /* 3. Same-relay fan-out: the stub socket is the relay; a card must come
        out of it for a contact who is HERE, once per profile version. */
  const fanout = await page.evaluate(() => {
    window.__sentFrames = [];
    chatState.ws = { readyState: 1, send: (raw) => window.__sentFrames.push(JSON.parse(raw)) };
    const peer = {
      peerId: 'same-relay-friend', clientId: 'same-relay-friend',
      fingerprint: 'a'.repeat(64), username: 'هم‌رله', status: 'online',
    };
    chatState.peers.push(peer);
    announceProfileToContacts();
    const firstOut = window.__sentFrames.filter((frame) => frame.type === 'relay');
    announceProfileToContacts();
    return {
      firstCount: firstOut.length,
      card: firstOut[0] || null,
      stillAfterSecondCall: window.__sentFrames.filter((frame) => frame.type === 'relay').length,
      key: getConversationKey(peer),
    };
  });
  check('a contact on THIS relay is handed the card',
    fanout.firstCount === 1 && fanout.card?.payload?.type === 'profile-card', JSON.stringify(fanout.card?.payload?.type));
  check('the card carries the photograph itself',
    String(fanout.card?.payload?.avatarData || '').startsWith('data:image/jpeg'), '');
  check('and it is addressed to them', fanout.card?.toFingerprint === 'a'.repeat(64), fanout.card?.toFingerprint || '');
  check('the same version is not pushed twice', fanout.stillAfterSecondCall === 1, `${fanout.stillAfterSecondCall} frames`);

  const reannounce = await page.evaluate((key) => {
    window.__sentFrames = [];
    chatState.profile.updatedAt = new Date().toISOString();
    for (const peer of chatState.peers) announceProfileCardIfStale(peer);
    return window.__sentFrames.filter((frame) => frame.type === 'relay').length;
  }, fanout.key);
  check('a changed version goes out again without being asked', reannounce === 1, `${reannounce} frames`);

  /* 4. The hidden message and the list that must not quote it. */
  const hidden = await page.evaluate(() => {
    const peer = chatState.peers.find((record) => record.peerId === 'same-relay-friend');
    const key = getConversationKey(peer);
    chatState.history[key] = [{
      id: 'hidden-1', direction: 'in', type: 'text', hidden: true,
      text: 'SECRET-PLAINTEXT-NOT-FOR-THE-LIST', createdAt: new Date().toISOString(),
    }];
    setChatView('chats');
    renderPeers();
    return { key };
  });
  const preview = await page.evaluate((key) => {
    const card = document.querySelector(`[data-chat-conversation="${CSS.escape(key)}"]`);
    return { text: card ? card.textContent || '' : '', found: Boolean(card) };
  }, hidden.key);
  check('the list says there is a hidden message, not what it says',
    preview.found && preview.text.includes('پیام مخفی') && !preview.text.includes('SECRET-PLAINTEXT'), '');

  const rehide = await page.evaluate((key) => {
    chatState.activeConversationId = key;
    renderMessages();
    revealHiddenMessage('hidden-1');
    const shown = Boolean(document.querySelector(`[data-chat-reveal]`) === null)
      && (chatState.history[key][0] && !isMessageHidden(chatState.history[key][0]) ? 'revealed' : 'masked');
    hideRevealedMessages();
    renderMessages();
    return {
      whileOpen: shown,
      afterLeaving: isMessageHidden(chatState.history[key][0]) ? 'masked' : 'revealed',
      maskDrawn: Boolean(document.querySelector('[data-chat-reveal]')),
    };
  }, hidden.key);
  check('revealing works, and leaving the thread masks it again — Telegram semantics',
    rehide.whileOpen === 'revealed' && rehide.afterLeaving === 'masked' && rehide.maskDrawn,
    JSON.stringify(rehide));

  /* 5. The photo viewer: contain-fit, whole picture, and a download. */
  const viewer = await page.evaluate(async () => {
    const peer = chatState.peers.find((record) => record.peerId === 'same-relay-friend');
    /* The popup reads the CONTACT's record — give it the avatar this run
       saved, which is exactly what a card would have delivered. */
    peer.avatarData = chatState.profile.avatarData;
    openPeerPhotoCard(peer);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const frame = document.querySelector('.chat-peer-photo-frame');
    const img = frame ? frame.querySelector('img') : null;
    const button = document.querySelector('[data-peer-photo-download]');
    return {
      hasImage: Boolean(img),
      fit: img ? getComputedStyle(img).objectFit : '',
      frameWidth: frame ? frame.getBoundingClientRect().width : 0,
      round: frame ? getComputedStyle(frame).borderRadius : '',
      hasDownload: Boolean(button),
    };
  });
  check('the viewer shows the whole photograph, contain-fit',
    viewer.hasImage && viewer.fit === 'contain' && viewer.frameWidth > 300,
    `${viewer.fit}, ${Math.round(viewer.frameWidth)}px`);
  check('and the circle is gone — corners are corners', !viewer.round.includes('999'), viewer.round);
  check('the photograph can be downloaded', viewer.hasDownload, '');

  check('no script threw while doing any of it', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
if (bad.length) bad.forEach((r) => console.log(`  - ${r.name}`));
process.exit(bad.length ? 1 : 0);
