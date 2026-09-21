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
import { fileURLToPath } from 'node:url';
/* Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
   Point it somewhere else with PKG_URL=https://host:port npm run test:e2e */
const BASE_URL = process.env.PKG_URL || 'https://localhost:8585';
const SHOTS = process.env.PKG_SHOTS || fileURLToPath(new URL('./screenshots', import.meta.url));
const FIX = fileURLToPath(new URL('./fixtures', import.meta.url));
const PASS = 'Harness#Pass2026!';
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
async function newPeer(w, h) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {}
    window.__clip = []; window.__err = [];
    window.addEventListener('error', (e) => window.__err.push('ERR ' + e.message));
    window.addEventListener('unhandledrejection', (e) => window.__err.push('REJ ' + (e.reason?.message || e.reason)));
  });
  return ctx;
}
async function instrument(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const orig = window.PoorijaApp.showNotification?.bind(window.PoorijaApp);
    window.PoorijaApp.showNotification = (m, t) => { window.__toasts.push(`${t}: ${m}`); return orig?.(m, t); };
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (txt) => { window.__clip.push(txt); return write(txt).catch(() => {}); };
    document.getElementById('mobileInstallGate')?.classList.add('hidden');
  });
}
async function onboard(tag, ctx) {
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log(`   ${tag}!! ${e.message.slice(0, 150)}`));
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  /* Not a fixed wait. The service worker reloads a fresh profile once per
     version, and any evaluate in flight when that lands dies with "Execution
     context was destroyed" — read as a crash, not a failure. Waiting for the
     page to hold still is the property actually wanted. */
  await settle(page);
  await page.evaluate((pass) => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) {
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
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
  await page.waitForTimeout(2500);
  await instrument(page);
  await page.evaluate(() => window.switchTab?.('chat'));
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById('chatConnectBtn')?.click());
  await page.waitForTimeout(6500);
  return page;
}

const ctxA = await newPeer(1440, 900);
const ctxB = await newPeer(1280, 860);
const A = await onboard('A', ctxA);
const B = await onboard('B', ctxB);

console.log('\n===== pairing =====');
const idA = await A.evaluate(async () => { await window.copyChatFullIdentity(); return window.__clip.at(-1); });
await B.evaluate(async (x) => {
  document.getElementById('chatStartChatBtn')?.click();
  await new Promise((r) => setTimeout(r, 500));
  document.querySelector('[data-chat-manual-json]').value = x;
  document.querySelector('[data-chat-manual-submit]')?.click();
}, idA);
await B.waitForTimeout(2500);
await B.evaluate(() => document.querySelector('.chat-peer-card, [data-conversation-key]')?.click());
await B.waitForTimeout(3500);
await B.fill('#chatComposer', 'hello-for-pairing');
await B.click('#chatSendMessageBtn');
await A.waitForTimeout(5000);
await A.evaluate(() => document.querySelector('.chat-peer-card, [data-conversation-key]')?.click());
await A.waitForTimeout(3000);
check('peers paired', (await A.evaluate(() => [...document.querySelectorAll('.chat-message-text')].map(e=>e.textContent.trim()))).some(t=>t.includes('hello-for-pairing')));

console.log('\n===== 1. .wastickers import (WhatsApp) =====');
await A.evaluate(() => document.getElementById('chatComposerPlusBtn')?.click());
await A.waitForTimeout(400);
await A.click('#chatStickerBtn');
await A.waitForTimeout(600);
const panelOpen = await A.evaluate(() => !document.getElementById('chatStickerPanel')?.classList.contains('hidden'));
check('sticker panel opens from the + menu', panelOpen);
const emptyState = await A.evaluate(() => Boolean(document.querySelector('.chat-sticker-empty')));
check('empty state shown before any import', emptyState);

await A.setInputFiles('#chatStickerInput', `${FIX}/pack.wastickers`);
await A.waitForTimeout(2500);
const waPack = await A.evaluate(() => ({
  packs: window.__chatDiag?.packs ?? null,
  /* Real packs only. Recent and Favourites are tabs without being packs, so
     they carry data-chat-sticker-virtual and are excluded here — counting
     them made every pack-count assertion read too high. */
  tabs: document.querySelectorAll('[data-chat-sticker-pack]:not([data-chat-sticker-virtual])').length,
  cells: document.querySelectorAll('[data-chat-sticker-send]').length,
  title: document.querySelector('.chat-sticker-tab.active')?.title || '',
  toasts: (window.__toasts||[]).slice(-2),
}));
check('.wastickers pack imported with its 5 stickers (tray + manifest skipped)', waPack.cells === 5, JSON.stringify(waPack));
check('pack title read from contents.json', waPack.title === 'Test WA Pack', waPack.title);

console.log('\n===== 2. sending a sticker end to end =====');
const bBefore = await B.evaluate(() => document.querySelectorAll('.chat-sticker-bubble').length);
await A.evaluate(() => document.querySelector('[data-chat-sticker-send]')?.click());
await A.waitForTimeout(1200);
const aBubbles = await A.evaluate(() => ({
  bubbles: document.querySelectorAll('.chat-sticker-bubble').length,
  imgs: document.querySelectorAll('.chat-sticker-media').length,
  hasCard: Boolean(document.querySelector('.chat-sticker-bubble .fa-file-shield')),
  bg: (() => { const b = document.querySelector('.chat-sticker-bubble'); return b ? getComputedStyle(b).backgroundColor : ''; })(),
}));
check('sender shows a sticker bubble', aBubbles.bubbles === 1 && aBubbles.imgs === 1, JSON.stringify(aBubbles));
check('sticker bubble is transparent, not a file card', !aBubbles.hasCard && /rgba\(0, 0, 0, 0\)|transparent/.test(aBubbles.bg), aBubbles.bg);
await B.waitForTimeout(5000);
const bAfter = await B.evaluate(() => ({
  bubbles: document.querySelectorAll('.chat-sticker-bubble').length,
  imgLoaded: [...document.querySelectorAll('.chat-sticker-media')].map((i) => i.naturalWidth || 0),
  preview: [...document.querySelectorAll('#chatPeerList .text-xs')].map(e=>e.textContent.trim()).slice(0,3),
}));
check('receiver gets the sticker', bAfter.bubbles > bBefore, JSON.stringify(bAfter));
check('received sticker image actually decodes', bAfter.imgLoaded.some((w) => w > 0), JSON.stringify(bAfter.imgLoaded));
check('conversation preview says "sticker", not a file name', bAfter.preview.some((p)=>/استیکر|Sticker/.test(p)), JSON.stringify(bAfter.preview));

console.log('\n===== 3. generic .zip import (Telegram-style export) =====');
await A.setInputFiles('#chatStickerInput', `${FIX}/tgpack.zip`);
await A.waitForTimeout(2500);
const zipPack = await A.evaluate(() => ({
  /* Real packs only. Recent and Favourites are tabs without being packs, so
     they carry data-chat-sticker-virtual and are excluded here — counting
     them made every pack-count assertion read too high. */
  tabs: document.querySelectorAll('[data-chat-sticker-pack]:not([data-chat-sticker-virtual])').length,
  cells: document.querySelectorAll('[data-chat-sticker-send]').length,
  title: document.querySelector('.chat-sticker-tab.active')?.title || '',
}));
check('.zip without a manifest becomes its own pack', zipPack.tabs === 2 && zipPack.cells === 5, JSON.stringify(zipPack));
check('zip pack titled from the file name', zipPack.title === 'tgpack', zipPack.title);

console.log('\n===== 4. loose files merge into one pack =====');
await A.setInputFiles('#chatStickerInput', [`${FIX}/loose1.png`, `${FIX}/loose2.png`, `${FIX}/loose3.png`]);
await A.waitForTimeout(2500);
const loose = await A.evaluate(() => ({
  /* Real packs only. Recent and Favourites are tabs without being packs, so
     they carry data-chat-sticker-virtual and are excluded here — counting
     them made every pack-count assertion read too high. */
  tabs: document.querySelectorAll('[data-chat-sticker-pack]:not([data-chat-sticker-virtual])').length,
  cells: document.querySelectorAll('[data-chat-sticker-send]').length,
  packTitles: Array.from(document.querySelectorAll('[data-chat-sticker-pack]:not([data-chat-sticker-virtual])'))
    .map((tab) => tab.getAttribute('title')),
}));
check('three loose files make ONE pack of three', loose.tabs === 3 && loose.cells === 3, JSON.stringify(loose));

console.log('\n===== 5. .tgs (animated Telegram sticker) =====');
await A.setInputFiles('#chatStickerInput', `${FIX}/anim.tgs`);
await A.waitForTimeout(3500);
const tgs = await A.evaluate(() => ({
  cells: document.querySelectorAll('[data-chat-sticker-send]').length,
  lottieNodes: document.querySelectorAll('.chat-lottie').length,
  mounted: document.querySelectorAll('.chat-lottie[data-lottie-mounted]').length,
  svg: document.querySelectorAll('.chat-lottie svg').length,
  fallback: document.querySelectorAll('.chat-lottie.is-fallback').length,
  lottieLoaded: typeof window.lottie !== 'undefined',
}));
check('.tgs gunzips into a lottie sticker', tgs.lottieNodes >= 1, JSON.stringify(tgs));
check('lottie-web lazy-loads and renders an SVG', tgs.lottieLoaded && tgs.svg >= 1 && tgs.fallback === 0, JSON.stringify(tgs));

console.log('\n===== 6. sending an animated sticker =====');
await A.evaluate(() => [...document.querySelectorAll('[data-chat-sticker-send]')].at(-1)?.click());
await A.waitForTimeout(1500);
await B.waitForTimeout(5000);
const bTgs = await B.evaluate(() => ({
  bubbles: document.querySelectorAll('.chat-sticker-bubble').length,
  lottie: document.querySelectorAll('.chat-sticker-bubble .chat-lottie').length,
  svg: document.querySelectorAll('.chat-sticker-bubble .chat-lottie svg').length,
}));
check('animated sticker arrives and animates on the far side', bTgs.lottie >= 1 && bTgs.svg >= 1, JSON.stringify(bTgs));

console.log('\n===== 7. packs survive a reload =====');
await A.reload({ waitUntil: 'load' });
await A.waitForTimeout(1800);
await A.evaluate((p) => { const el = document.getElementById('unlockPassword'); if (el) { el.value = p; el.dispatchEvent(new Event('input', { bubbles: true })); } }, PASS);
await A.evaluate(() => window.unlockApp?.());
await A.waitForTimeout(3000);
await instrument(A);
await A.evaluate(() => window.switchTab?.('chat'));
await A.waitForTimeout(2500);
await A.evaluate(() => document.querySelector('#chatPeerList .chat-peer-card')?.click());
await A.waitForTimeout(600);
await A.evaluate(() => document.getElementById('chatComposerPlusBtn')?.click());
await A.waitForTimeout(400);
await A.click('#chatStickerBtn');
await A.waitForTimeout(1200);
const afterReload = await A.evaluate(() => ({
  /* Real packs only. Recent and Favourites are tabs without being packs, so
     they carry data-chat-sticker-virtual and are excluded here — counting
     them made every pack-count assertion read too high. */
  tabs: document.querySelectorAll('[data-chat-sticker-pack]:not([data-chat-sticker-virtual])').length,
  cells: document.querySelectorAll('[data-chat-sticker-send]').length,
}));
check('every pack is still there after a reload', afterReload.tabs === 3, JSON.stringify(afterReload));
check('the pack that was open is reopened', afterReload.cells === 4, JSON.stringify(afterReload));

console.log('\n===== 8. pack manager =====');
await A.evaluate(() => document.getElementById('chatStickerManageBtn')?.click());
await A.waitForTimeout(600);
const manage = await A.evaluate(() => ({
  rows: document.querySelectorAll('[data-chat-sticker-delete]').length,
  titles: [...document.querySelectorAll('.chat-sticker-manage-title')].map(e=>e.textContent.trim()),
}));
check('manager lists every pack', manage.rows === 3, JSON.stringify(manage));
/* A row that says only a name and a count is a row nobody can tell from the
   one above it: the names are the user's own and they blur together. The
   pictures are what make a pack recognisable, so every row carries a strip of
   its own stickers. */
const strips = await A.evaluate(() => [...document.querySelectorAll('.chat-sticker-manage-row')].map((row) => ({
  title: row.querySelector('.chat-sticker-manage-title')?.textContent.trim(),
  thumbs: row.querySelectorAll('.chat-sticker-manage-thumb').length,
  sources: [...row.querySelectorAll('.chat-sticker-manage-thumb')]
    .map((el) => (el.getAttribute('src') || el.dataset.lottieSrc || '').slice(0, 5)),
  painted: [...row.querySelectorAll('.chat-sticker-manage-thumb')]
    .every((el) => el.getBoundingClientRect().width > 4),
})));
console.log('  ' + JSON.stringify(strips));
check('every pack row shows thumbnails of its own stickers',
  strips.length > 0 && strips.every((row) => row.thumbs > 0),
  strips.map((row) => `${row.title}:${row.thumbs}`).join(' '));
check('and they are real sticker sources, not placeholders',
  strips.every((row) => row.sources.every((src) => src.startsWith('blob:') || src.startsWith('data:'))),
  strips.flatMap((row) => row.sources).join(' '));
check('each thumbnail is actually laid out', strips.every((row) => row.painted),
  strips.filter((row) => !row.painted).map((row) => row.title).join(', ') || 'all painted');
await A.evaluate(() => document.querySelector('[data-chat-sticker-delete]')?.click());
/* Deleting asks first — and it asks with the in-page dialog, not
   window.confirm, because the native shell has no window.confirm to answer.
   The suite predates that change and was clicking delete into a question
   nobody answered. */
await A.waitForTimeout(600);
await A.evaluate(() => document.querySelector('.poorija-dialog-ok')?.click());
await A.waitForTimeout(1500);
const afterDelete = await A.evaluate(() => document.querySelectorAll('[data-chat-sticker-delete]').length);
check('deleting a pack removes it', afterDelete === 2, String(afterDelete));

console.log('\n===== 9. custom ringtone =====');
await A.evaluate(() => window.PoorijaChat?.setView?.('connection') || document.querySelector('[data-chat-view="connection"]')?.click());
await A.waitForTimeout(900);
await A.setInputFiles('#chatRingtoneFileInput', `${FIX}/ring.wav`);
await A.waitForTimeout(2000);
const sound = await A.evaluate(() => {
  const sel = document.getElementById('chatRingtoneSelect');
  return {
    value: sel?.value || '',
    isCustom: /^snd_/.test(sel?.value || ''),
    optgroup: Boolean(sel?.querySelector('optgroup')),
    label: sel?.selectedOptions?.[0]?.textContent || '',
    delVisible: !document.getElementById('chatDeleteRingtoneBtn')?.classList.contains('hidden'),
    builtins: sel ? sel.querySelectorAll('option').length : 0,
  };
});
check('imported ringtone is stored and selected', sound.isCustom && sound.label === 'ring', JSON.stringify(sound));
check('built-in ringtone catalogue grew to 10', sound.builtins === 11, `${sound.builtins} options incl. the custom one`);
check('delete button appears for a custom sound', sound.delVisible);
await A.evaluate(() => document.getElementById('chatTestRingtoneBtn')?.click());
await A.waitForTimeout(800);
const ringing = await A.evaluate(() => Boolean(window.__err?.length));
check('testing the imported ringtone throws nothing', !ringing, JSON.stringify(await A.evaluate(()=>window.__err||[])));
await A.evaluate(() => document.getElementById('chatDeleteRingtoneBtn')?.click());
await A.waitForTimeout(1200);
const afterSoundDelete = await A.evaluate(() => ({
  value: document.getElementById('chatRingtoneSelect')?.value,
  hidden: document.getElementById('chatDeleteRingtoneBtn')?.classList.contains('hidden'),
}));
check('removing the custom sound falls back to classic', afterSoundDelete.value === 'classic' && afterSoundDelete.hidden, JSON.stringify(afterSoundDelete));

console.log('\n===== 10. no page errors anywhere =====');
for (const [tag, p] of [['A', A], ['B', B]]) {
  const errs = await p.evaluate(() => (window.__err || []).filter((x) => !/SSL|Failed to load resource/.test(x)));
  check(`${tag}: no uncaught errors`, errs.length === 0, JSON.stringify(errs.slice(0, 3)));
}

const failing = results.filter((r) => !r.ok);
console.log(`\n===== ${failing.length} failing of ${results.length} =====`);
failing.forEach((f) => console.log(`  FAIL ${f.name} — ${f.detail}`));
await browser.close();
process.exit(failing.length ? 1 : 0);
