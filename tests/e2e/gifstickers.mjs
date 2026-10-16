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
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
/* GIFs, and stickers from the keyboard (js/chat/55-gifs-and-keyboard-stickers.js).
   Two peers over a real relay. What a phone keyboard does cannot be driven from
   desktop Chromium, so its two hand-overs are reproduced the way the engines
   deliver them: a paste event carrying the file (Chrome on Android, and every
   copy-paste), and an <img> written straight into the rich keyboard box (WebKit).
     node tests/e2e/gifstickers.mjs
     npm run test:local -- gifstickers */
const BASE_URL = process.env.PKG_URL || 'https://localhost:8585';
const FIX = fileURLToPath(new URL('./fixtures', import.meta.url));
const PASS = 'Harness#Pass2026!';
/* The two flags every call suite launches with. Granting media lets Chromium
   hand WebRTC the machine's real addresses instead of mDNS names; without it,
   the data channel between the two pages formed only some of the time, and
   pairing failed with "Secure session is not ready yet". */
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/* A real animated GIF, built here rather than kept as a binary fixture: two
   64x48 frames, red then blue, looping. LZW is written "uncompressed" — a
   clear code every 250 pixels keeps every code nine bits wide — which every
   decoder reads and which needs no compressor. */
function makeAnimatedGif(width = 64, height = 48) {
  const bytes = [];
  const push = (...values) => values.forEach((v) => bytes.push(v & 0xff));
  const word = (v) => push(v, v >> 8);
  push(...Buffer.from('GIF89a'));
  word(width); word(height);
  push(0xf7, 0, 0);
  for (let i = 0; i < 256; i += 1) {
    if (i === 1) push(220, 38, 38);
    else if (i === 2) push(37, 99, 235);
    else push(i, i, i);
  }
  push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00);
  for (const colour of [1, 2]) {
    push(0x21, 0xf9, 0x04, 0x04); word(20); push(0x00, 0x00);
    push(0x2c); word(0); word(0); word(width); word(height); push(0x00);
    push(0x08);
    const codes = [256];
    for (let p = 0; p < width * height; p += 1) {
      if (p && p % 250 === 0) codes.push(256);
      codes.push(colour);
    }
    codes.push(257);
    const packed = [];
    let acc = 0;
    let bits = 0;
    for (const code of codes) {
      acc |= code << bits;
      bits += 9;
      while (bits >= 8) { packed.push(acc & 0xff); acc >>= 8; bits -= 8; }
    }
    if (bits) packed.push(acc & 0xff);
    for (let i = 0; i < packed.length; i += 255) {
      const block = packed.slice(i, i + 255);
      push(block.length, ...block);
    }
    push(0x00);
  }
  push(0x3b);
  return Buffer.from(bytes).toString('base64');
}
const GIF_B64 = makeAnimatedGif();
const PHOTO_B64 = fs.readFileSync(`${FIX}/huge.png`).toString('base64');

async function newPeer(w, h) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('poorija_lang', 'en'); } catch (e) {}
    window.__clip = []; window.__err = [];
    window.addEventListener('error', (e) => window.__err.push('ERR ' + e.message));
    window.addEventListener('unhandledrejection', (e) => window.__err.push('REJ ' + (e.reason?.message || e.reason)));
  });
  return ctx;
}
async function instrument(page) {
  await page.evaluate((assets) => {
    window.__toasts = [];
    const orig = window.PoorijaApp.showNotification?.bind(window.PoorijaApp);
    window.PoorijaApp.showNotification = (m, t) => { window.__toasts.push(`${t}: ${m}`); return orig?.(m, t); };
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (txt) => { window.__clip.push(txt); return write(txt).catch(() => {}); };
    document.getElementById('mobileInstallGate')?.classList.add('hidden');
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    window.__fixtures = {
      gif: () => new File([bytes(assets.gif)], 'party.gif', { type: 'image/gif' }),
      photo: () => new File([bytes(assets.photo)], 'huge.png', { type: 'image/png' }),
      /* A sticker the way a keyboard makes one: a cut-out on a transparent
         background, 320 px. */
      sticker: () => new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 320;
        const paint = canvas.getContext('2d');
        paint.fillStyle = '#f59e0b';
        paint.beginPath(); paint.arc(160, 160, 120, 0, Math.PI * 2); paint.fill();
        canvas.toBlob((blob) => resolve(new File([blob], 'sticker.png', { type: 'image/png' })), 'image/png');
      }),
    };
    window.__paste = (file, text = '') => {
      const data = new DataTransfer();
      if (file) data.items.add(file);
      if (text) data.setData('text/plain', text);
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      document.getElementById('chatComposer').dispatchEvent(event);
      return event.defaultPrevented;
    };
  }, { gif: GIF_B64, photo: PHOTO_B64 });
}
async function onboard(tag, ctx) {
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log(`   ${tag}!! ${e.message.slice(0, 150)}`));
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
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
const bubbles = (page) => page.evaluate(() => ({
  gifs: document.querySelectorAll('.chat-sticker-bubble.is-gif').length,
  stickers: document.querySelectorAll('.chat-sticker-bubble:not(.is-gif)').length,
  gifDecoded: [...document.querySelectorAll('.chat-sticker-bubble.is-gif img.chat-gif-media')].map((i) => i.naturalWidth || 0),
  gifBadges: document.querySelectorAll('.chat-sticker-bubble.is-gif .chat-gif-badge').length,
  stickerDecoded: [...document.querySelectorAll('.chat-sticker-bubble:not(.is-gif) img.chat-sticker-media')].map((i) => i.naturalWidth || 0),
  files: [...document.querySelectorAll('.chat-message-bubble .font-bold.text-sm.truncate')].map((e) => e.textContent.trim()),
}));

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
/* Waited for, not timed: the first message waits on the secure session. */
await A.waitForFunction(() => Object.values(chatState.history).flat().some((e) => e.direction === 'in' && e.text === 'hello-for-pairing'), null, { timeout: 60000 }).catch(() => {});
await A.evaluate(() => { allConversationRecords().filter((r) => isMessageRequest(r)).forEach((r) => acceptMessageRequest(r)); });
await A.waitForTimeout(800);
await A.evaluate(() => document.querySelector('.chat-peer-card, [data-conversation-key]')?.click());
await A.waitForTimeout(3000);
check('peers paired', (await A.evaluate(() => [...document.querySelectorAll('.chat-message-text')].map((e) => e.textContent.trim()))).some((t) => t.includes('hello-for-pairing')));

console.log('\n===== 1. the GIF row and the two shelves =====');
await A.evaluate(() => document.getElementById('chatComposerPlusBtn')?.click());
await A.waitForTimeout(400);
await A.click('#chatGifBtn');
await A.waitForTimeout(600);
const shelf = await A.evaluate(() => {
  const panel = document.getElementById('chatStickerPanel');
  const shown = (id) => { const el = document.getElementById(id); return Boolean(el) && getComputedStyle(el).display !== 'none'; };
  return {
    open: !panel.classList.contains('hidden'),
    active: document.querySelector('.chat-sticker-shelf.is-active')?.getAttribute('data-chat-panel-shelf'),
    empty: Boolean(document.querySelector('#chatStickerGrid .chat-sticker-empty [data-chat-gif-import]')),
    gifImport: shown('chatGifImportBtn'),
    stickerImport: shown('chatStickerImportBtn'),
    manage: shown('chatStickerManageBtn'),
    tabs: shown('chatStickerTabs'),
    sheetClosed: document.getElementById('chatComposerActions')?.classList.contains('hidden'),
  };
});
check('the + menu GIF row opens the panel on the GIF shelf', shelf.open && shelf.active === 'gifs', JSON.stringify(shelf));
check('an empty GIF shelf says how to fill it', shelf.empty);
check('the GIF shelf shows its own import and hides the sticker tools',
  shelf.gifImport && !shelf.stickerImport && !shelf.manage && !shelf.tabs, JSON.stringify(shelf));
check('the + menu closes behind it', shelf.sheetClosed);
await A.evaluate(() => document.querySelector('[data-chat-panel-shelf="stickers"]')?.click());
await A.waitForTimeout(300);
const back = await A.evaluate(() => ({
  active: document.querySelector('.chat-sticker-shelf.is-active')?.getAttribute('data-chat-panel-shelf'),
  stickerImport: getComputedStyle(document.getElementById('chatStickerImportBtn')).display !== 'none',
  open: !document.getElementById('chatStickerPanel').classList.contains('hidden'),
}));
check('switching to the sticker shelf keeps the panel open and brings its tools back', back.open && back.active === 'stickers' && back.stickerImport, JSON.stringify(back));
await A.evaluate(() => document.getElementById('chatStickerCloseBtn')?.click());

console.log('\n===== 2. pasting a GIF into the message box =====');
const pastedGif = await A.evaluate(() => window.__paste(window.__fixtures.gif()));
check('the paste is taken (nothing lands in the text box)', pastedGif && (await A.evaluate(() => document.getElementById('chatComposer').value)) === '');
await A.waitForTimeout(1800);
const aGif = await bubbles(A);
check('the sender shows a GIF bubble with its GIF mark', aGif.gifs === 1 && aGif.gifBadges === 1, JSON.stringify(aGif));
await B.waitForTimeout(5000);
const bGif = await bubbles(B);
check('the receiver gets a GIF, not a file', bGif.gifs === 1 && bGif.files.length === 0, JSON.stringify(bGif));
check('the received GIF decodes', bGif.gifDecoded.some((w) => w === 64), JSON.stringify(bGif.gifDecoded));
const gifShape = await B.evaluate(() => {
  const body = document.querySelector('.chat-sticker-bubble.is-gif .chat-sticker-body');
  const img = body?.querySelector('img');
  const box = body?.getBoundingClientRect();
  const pic = img?.getBoundingClientRect();
  return { w: Math.round(box?.width || 0), h: Math.round(pic?.height || 0), ratio: pic ? +(pic.width / pic.height).toFixed(2) : 0 };
});
check('a GIF keeps its own shape rather than the sticker square', gifShape.w > 150 && Math.abs(gifShape.ratio - 64 / 48) < 0.05, JSON.stringify(gifShape));
const preview = await B.evaluate(() => [...document.querySelectorAll('#chatPeerList .chat-peer-card')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
check('the conversation list says GIF', /GIF/.test(preview), preview.slice(0, 160));

console.log('\n===== 3. pasting a keyboard-sized sticker =====');
await A.evaluate(async () => window.__paste(await window.__fixtures.sticker()));
await A.waitForTimeout(1800);
await B.waitForTimeout(4500);
const bSticker = await bubbles(B);
check('a small cut-out goes as a sticker, without asking', bSticker.stickers === 1 && bSticker.stickerDecoded.some((w) => w > 0), JSON.stringify(bSticker));
check('no question was asked for it', await A.evaluate(() => !document.querySelector('.poorija-dialog-choice')));

console.log('\n===== 4. text and photos still behave =====');
const textPaste = await A.evaluate(() => window.__paste(null, 'just words'));
check('a paste of plain text is left to the browser', textPaste === false);
const rtf = await A.evaluate(async () => {
  const data = new DataTransfer();
  data.items.add(await window.__fixtures.sticker());
  data.setData('text/plain', 'cell text');
  data.setData('text/rtf', '{\\rtf1 cell text}');
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  document.getElementById('chatComposer').dispatchEvent(event);
  return event.defaultPrevented;
});
check('a document copy (text, rich text and a picture of it) pastes the words', rtf === false);
await A.evaluate(() => window.__paste(window.__fixtures.photo()));
await A.waitForTimeout(900);
const asked = await A.evaluate(() => [...document.querySelectorAll('.poorija-dialog-choice')].map((b) => b.textContent.trim()));
check('a large photo asks: photo or sticker', asked.length === 2, JSON.stringify(asked));
await A.evaluate(() => document.querySelector('.poorija-dialog-choice')?.click());
await A.waitForTimeout(2500);
const aPhoto = await bubbles(A);
check('"Send as a photo" sends it as the file it is', aPhoto.files.includes('huge.png'), JSON.stringify(aPhoto.files));

console.log('\n===== 5. the keyboard box (WebKit hands over an <img>) =====');
const catcher = await A.evaluate(() => {
  document.documentElement.classList.add('touch-device');
  setStickerPanelVisible(true);
  const row = document.querySelector('.chat-keyboard-catcher-row');
  const box = document.getElementById('chatKeyboardCatcher');
  return {
    shown: getComputedStyle(row).display !== 'none',
    editable: box.isContentEditable,
    hint: getComputedStyle(document.querySelector('.chat-keyboard-catcher-hint')).display !== 'none',
  };
});
check('on a touch screen the panel carries a rich keyboard box with its hint', catcher.shown && catcher.editable && catcher.hint, JSON.stringify(catcher));
const bBeforeKeyboard = (await bubbles(B)).stickers;
await A.evaluate(async () => {
  const file = await window.__fixtures.sticker();
  const box = document.getElementById('chatKeyboardCatcher');
  box.focus();
  /* What a Genmoji looks like when the keyboard writes it in. */
  const picture = document.createElement('picture');
  const img = document.createElement('img');
  img.src = URL.createObjectURL(file);
  img.alt = 'orange circle';
  picture.appendChild(img);
  box.appendChild(picture);
});
await A.waitForTimeout(2500);
const boxAfter = await A.evaluate(() => document.getElementById('chatKeyboardCatcher').innerHTML);
check('the picture the keyboard wrote is read back and the box empties', boxAfter === '', boxAfter.slice(0, 80));
await B.waitForTimeout(4500);
check('and it arrives as a sticker', (await bubbles(B)).stickers === bBeforeKeyboard + 1);
await A.evaluate(() => {
  const box = document.getElementById('chatKeyboardCatcher');
  box.appendChild(document.createTextNode('typed here 🙂'));
});
await A.waitForTimeout(600);
const moved = await A.evaluate(() => ({ composer: document.getElementById('chatComposer').value, box: document.getElementById('chatKeyboardCatcher').textContent }));
check('text typed into the keyboard box moves to the message box', moved.composer === 'typed here 🙂' && moved.box === '', JSON.stringify(moved));
await A.evaluate(() => { const c = document.getElementById('chatComposer'); c.value = ''; c.dispatchEvent(new Event('input', { bubbles: true })); });
const keyboardPaste = await A.evaluate(() => {
  const data = new DataTransfer();
  data.items.add(window.__fixtures.gif());
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  document.getElementById('chatKeyboardCatcher').dispatchEvent(event);
  return event.defaultPrevented;
});
check('a GIF pasted into the keyboard box is taken', keyboardPaste);
await A.waitForTimeout(2000);
await B.waitForTimeout(4500);
check('and it arrives as a GIF', (await bubbles(B)).gifs === 2, JSON.stringify(await bubbles(B)));

console.log('\n===== 6. a sticker lost in the message box =====');
await A.evaluate(() => {
  setStickerPanelVisible(false);
  const composer = document.getElementById('chatComposer');
  composer.focus();
  composer.value = 'hi ￼';
  composer.setSelectionRange(composer.value.length, composer.value.length);
  composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
});
await A.waitForTimeout(500);
const lost = await A.evaluate(() => ({
  composer: document.getElementById('chatComposer').value,
  panel: !document.getElementById('chatStickerPanel').classList.contains('hidden'),
  focused: document.activeElement?.id,
}));
check('the placeholder character is taken back out and the keyboard box offered', lost.composer === 'hi ' && lost.panel && lost.focused === 'chatKeyboardCatcher', JSON.stringify(lost));
await A.evaluate(() => { const c = document.getElementById('chatComposer'); c.value = ''; c.dispatchEvent(new Event('input', { bubbles: true })); setStickerPanelVisible(false); });

console.log('\n===== 7. dropping a GIF on the message box =====');
const aGifsBeforeDrop = (await bubbles(A)).gifs;
await A.evaluate(() => {
  const surface = document.querySelector('.chat-composer-surface');
  const data = new DataTransfer();
  data.items.add(window.__fixtures.gif());
  surface.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
  surface.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
});
await A.waitForTimeout(2000);
check('a GIF dropped on the message box is sent', (await bubbles(A)).gifs === aGifsBeforeDrop + 1);

console.log('\n===== 8. keeping what somebody sent =====');
await B.evaluate(() => document.querySelector('.chat-sticker-bubble.is-gif [data-chat-keep-sticker]')?.click());
await B.waitForTimeout(1200);
const kept = await B.evaluate(() => ({ library: window.__gifProbe.library().length, packs: window.__stickerProbe.state().packs }));
check('the bookmark on a received GIF saves it to the GIF shelf', kept.library === 1, JSON.stringify(kept));
check('saved GIFs are not counted as a sticker pack', kept.packs === 0, JSON.stringify(kept));
await B.evaluate(() => [...document.querySelectorAll('.chat-sticker-bubble.is-gif [data-chat-keep-sticker]')].at(-1)?.click());
await B.waitForTimeout(1200);
check('the same GIF saved twice is kept once', (await B.evaluate(() => window.__gifProbe.library().length)) === 1);
await B.evaluate(() => document.querySelector('.chat-sticker-bubble:not(.is-gif) [data-chat-keep-sticker]')?.click());
await B.waitForTimeout(1500);
const keptSticker = await B.evaluate(() => ({ packs: window.__stickerProbe.state().packs }));
check('the bookmark on a received sticker adds it to "My stickers"', keptSticker.packs === 1, JSON.stringify(keptSticker));

console.log('\n===== 9. sending from the GIF shelf =====');
const aGifsBefore = (await bubbles(A)).gifs;
await B.evaluate(() => setStickerPanelVisible(true, { shelf: 'gifs' }));
await B.waitForTimeout(500);
const cells = await B.evaluate(() => ({
  cells: document.querySelectorAll('#chatStickerGrid [data-chat-gif-send]').length,
  decoded: [...document.querySelectorAll('#chatStickerGrid .chat-gif-thumb')].map((i) => i.naturalWidth || 0),
}));
check('the GIF shelf lists the saved GIF', cells.cells === 1, JSON.stringify(cells));
await B.evaluate(() => document.querySelector('#chatStickerGrid [data-chat-gif-send]')?.click());
await B.waitForTimeout(2000);
await A.waitForTimeout(4500);
check('one tap sends it, and it arrives as a GIF', (await bubbles(A)).gifs === aGifsBefore + 1, JSON.stringify(await bubbles(A)));

console.log('\n===== 10. saved GIFs survive a reload =====');
await B.reload({ waitUntil: 'load' });
await B.waitForTimeout(1800);
await B.evaluate((p) => { const el = document.getElementById('unlockPassword'); if (el) { el.value = p; el.dispatchEvent(new Event('input', { bubbles: true })); } }, PASS);
await B.evaluate(() => window.unlockApp?.());
await B.waitForTimeout(3000);
await instrument(B);
await B.evaluate(() => window.switchTab?.('chat'));
await B.waitForTimeout(2500);
const reloaded = await B.evaluate(() => ({ library: window.__gifProbe.library().length, packs: window.__stickerProbe.state().packs }));
check('the GIF shelf and the sticker pack both come back, apart', reloaded.library === 1 && reloaded.packs === 1, JSON.stringify(reloaded));
await B.evaluate(() => setStickerPanelVisible(true, { shelf: 'gifs' }));
await B.waitForTimeout(400);
await B.evaluate(() => document.querySelector('#chatStickerGrid [data-chat-gif-remove]')?.click());
await B.waitForTimeout(800);
check('the cross removes a GIF from the shelf, and does not send it',
  (await B.evaluate(() => window.__gifProbe.library().length)) === 0
  && (await B.evaluate(() => Boolean(document.querySelector('#chatStickerGrid .chat-sticker-empty')))));

console.log('\n===== 11. Chrome on Android: the keyboard is offered pictures =====');
const ctxDroid = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 412, height: 860 },
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
});
const droid = await ctxDroid.newPage();
await droid.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
await settle(droid);
const droidState = await droid.evaluate(() => ({
  marked: document.documentElement.classList.contains('keyboard-pictures'),
  modify: getComputedStyle(document.getElementById('chatComposer')).webkitUserModify || getComputedStyle(document.getElementById('chatComposer')).getPropertyValue('-webkit-user-modify'),
}));
check('Android Chrome marks the message box as one the keyboard may put pictures in', droidState.marked && droidState.modify === 'read-write', JSON.stringify(droidState));
const desktopState = await A.evaluate(() => ({
  marked: document.documentElement.classList.contains('keyboard-pictures'),
  modify: getComputedStyle(document.getElementById('chatComposer')).webkitUserModify,
}));
check('a desktop leaves the message box exactly as it was', !desktopState.marked && desktopState.modify !== 'read-write', JSON.stringify(desktopState));
await ctxDroid.close();

console.log('\n===== 12. no page errors anywhere =====');
for (const [tag, p] of [['A', A], ['B', B]]) {
  const errs = await p.evaluate(() => (window.__err || []).filter((x) => !/SSL|Failed to load resource/.test(x)));
  check(`${tag}: no uncaught errors`, errs.length === 0, JSON.stringify(errs.slice(0, 3)));
}

const failing = results.filter((r) => !r.ok);
console.log(`\n===== ${failing.length} failing of ${results.length} =====`);
failing.forEach((f) => console.log(`  FAIL ${f.name} — ${f.detail}`));
await browser.close();
process.exit(failing.length ? 1 : 0);
