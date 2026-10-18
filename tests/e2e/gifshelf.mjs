/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The GIF shelf, kept stickers, picking messages, and saving files.
 *
 *   - forty GIFs on a phone sit in rows that never overlap, three to a line;
 *   - the cross that removes one is there only in the manage view;
 *   - sending a GIF from far down the shelf leaves the shelf where it was;
 *   - an animated sticker kept from a chat stays animated;
 *   - with several messages being picked, one tap picks one more, and no
 *     message toolbar opens;
 *   - the picked files save in one go: one zip with every file in it;
 *   - a profile photo on an iPhone goes to the share sheet as a picture,
 *     since an iPhone ignores a download link to a data: URL.
 */
import { openApp, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 240) : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);

/* An animated GIF of any size, written out by hand: two frames, nine-bit
   codes with a clear code every 250 pixels, which every decoder reads. */
function animatedGif(width, height) {
  const bytes = [];
  const push = (...values) => values.forEach((v) => bytes.push(v & 0xff));
  const word = (v) => push(v, v >> 8);
  push(...Buffer.from('GIF89a')); word(width); word(height); push(0xf7, 0, 0);
  for (let i = 0; i < 256; i += 1) { if (i === 1) push(220, 38, 38); else if (i === 2) push(37, 99, 235); else push(i, i, i); }
  push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00);
  for (const colour of [1, 2]) {
    push(0x21, 0xf9, 0x04, 0x04); word(20); push(0x00, 0x00);
    push(0x2c); word(0); word(0); word(width); word(height); push(0x00); push(0x08);
    const codes = [256];
    for (let p = 0; p < width * height; p += 1) { if (p && p % 250 === 0) codes.push(256); codes.push(colour); }
    codes.push(257);
    const packed = []; let acc = 0; let bits = 0;
    for (const code of codes) { acc |= code << bits; bits += 9; while (bits >= 8) { packed.push(acc & 0xff); acc >>= 8; bits -= 8; } }
    if (bits) packed.push(acc & 0xff);
    for (let i = 0; i < packed.length; i += 255) { const block = packed.slice(i, i + 255); push(block.length, ...block); }
    push(0x00);
  }
  push(0x3b);
  return Buffer.from(bytes).toString('base64');
}
const SMALL = animatedGif(40, 30);
const BIG = animatedGif(560, 560);

const stacks = await startTwoStacks();
try {
  const PAGE = await openApp('SHELF', { origin: stacks.a.url, relay: stacks.a.url, context: { viewport: { width: 390, height: 844 } } });
  await PAGE.evaluate(() => { window.__sent = []; window.sendGifBlob = async (blob) => { window.__sent.push(blob.size); return true; }; });

  section('forty GIFs on a phone');
  await PAGE.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    for (let i = 0; i < 40; i += 1) {
      /* Each one different by a byte, so none is folded into another. */
      const copy = bytes.slice(); copy[copy.length - 2] = i;
      await window.__gifProbe.save(new Blob([copy], { type: 'image/gif' }));
    }
    openSavedMessages();
    await new Promise((r) => setTimeout(r, 300));
    setStickerPanelVisible(true, { shelf: 'gifs' });
    await new Promise((r) => setTimeout(r, 600));
  }, SMALL);
  const layout = await PAGE.evaluate(() => {
    const cells = [...document.querySelectorAll('#chatStickerGrid .chat-gif-cell')].map((cell) => cell.getBoundingClientRect());
    let overlaps = 0;
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        const a = cells[i]; const b = cells[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps += 1;
      }
    }
    const firstRow = cells.filter((rect) => Math.abs(rect.top - cells[0].top) < 1).length;
    return { count: cells.length, overlaps, firstRow, minHeight: Math.round(Math.min(...cells.map((rect) => rect.height))) };
  });
  check('all forty are drawn, none over another, three to a line', layout.count === 40 && layout.overlaps === 0 && layout.firstRow === 3 && layout.minHeight >= 70, JSON.stringify(layout));
  const crosses = await PAGE.evaluate(async () => {
    const before = document.querySelectorAll('#chatStickerGrid .chat-gif-remove').length;
    document.getElementById('chatStickerManageBtn').click();
    await new Promise((r) => setTimeout(r, 300));
    const managing = document.querySelectorAll('#chatStickerGrid .chat-gif-remove').length;
    document.getElementById('chatStickerManageBtn').click();
    await new Promise((r) => setTimeout(r, 300));
    return { before, managing };
  });
  check('the remove cross shows only in the manage view', crosses.before === 0 && crosses.managing === 40, JSON.stringify(crosses));

  section('sending from far down the shelf');
  const stays = await PAGE.evaluate(async () => {
    const grid = document.getElementById('chatStickerGrid');
    grid.scrollTop = grid.scrollHeight;
    await new Promise((r) => setTimeout(r, 200));
    const scrolled = grid.scrollTop;
    const cells = [...grid.querySelectorAll('.chat-gif-cell')];
    const target = cells[cells.length - 2];
    const id = target.getAttribute('data-chat-gif-send');
    target.click();
    await new Promise((r) => setTimeout(r, 800));
    const after = [...grid.querySelectorAll('.chat-gif-cell')];
    return { scrolled, now: grid.scrollTop, samePlace: after[after.length - 2]?.getAttribute('data-chat-gif-send') === id, sent: window.__sent.length };
  });
  check('the GIF is sent, and the shelf stays where it was', stays.sent === 1 && stays.scrolled > 100 && Math.abs(stays.now - stays.scrolled) < 2 && stays.samePlace, JSON.stringify(stays));
  const reopened = await PAGE.evaluate(async () => {
    setStickerPanelVisible(false);
    await new Promise((r) => setTimeout(r, 200));
    setStickerPanelVisible(true, { shelf: 'gifs' });
    await new Promise((r) => setTimeout(r, 400));
    const first = document.querySelector('#chatStickerGrid .chat-gif-cell')?.getAttribute('data-chat-gif-send');
    const used = Object.keys(JSON.parse(localStorage.getItem('poorija_gif_used') || '{}'));
    return { first, used };
  });
  check('opened again, the shelf starts with the GIF used last', reopened.used.length === 1 && reopened.first === reopened.used[0], JSON.stringify(reopened));

  section('an animated sticker, kept');
  const kept = await PAGE.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/gif' });
    const out = await normalizeStickerImage(blob, 'party.gif');
    const record = await buildStickerRecord('party.gif', blob);
    return { size: blob.size, same: out === blob, recordSize: record?.blob?.size || 0, animated: await pictureIsAnimated(record.blob, 'image/gif') };
  }, BIG);
  check('a large animated sticker is kept as it came, still moving', kept.size > 220 * 1024 && kept.same && kept.recordSize === kept.size && kept.animated, JSON.stringify(kept));

  section('picking several messages');
  const picked = await PAGE.evaluate(async (b64) => {
    setStickerPanelVisible(false);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const one = await keepBlobInSaved(new File([bytes], 'one.gif', { type: 'image/gif' }), 'file');
    const two = await keepBlobInSaved(new File([new TextEncoder().encode('hello there')], 'notes.txt', { type: 'text/plain' }), 'file');
    renderMessages();
    await new Promise((r) => setTimeout(r, 500));
    enterSelectionMode(one.id);
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector(`#chatMessages .chat-message-bubble[data-id="${two.id}"]`).click();
    await new Promise((r) => setTimeout(r, 300));
    return {
      selected: [...chatState.selectedMessages],
      toolbar: chatState.activeMessageId || '',
      download: !document.getElementById('chatSelectionDownloadBtn').classList.contains('hidden'),
      ids: [one.id, two.id],
    };
  }, SMALL);
  check('one tap picks another message, and no toolbar opens', picked.selected.length === 2 && picked.ids.every((id) => picked.selected.includes(id)) && !picked.toolbar, JSON.stringify(picked));
  check('the bar offers to save the picked files', picked.download);
  const zipped = await PAGE.evaluate(async () => {
    window.__dl = null;
    const original = window.chatDownloadBlob;
    window.chatDownloadBlob = (blob, name) => { window.__dl = { blob, name }; };
    document.getElementById('chatSelectionDownloadBtn').click();
    for (let i = 0; i < 40 && !window.__dl; i += 1) await new Promise((r) => setTimeout(r, 100));
    window.chatDownloadBlob = original;
    if (!window.__dl) return null;
    const zip = await window.JSZip.loadAsync(window.__dl.blob);
    const names = Object.keys(zip.files);
    const text = await zip.file('notes.txt')?.async('string');
    return { name: window.__dl.name, names, text };
  });
  check('they save as one zip holding every file', Boolean(zipped) && /^poorija-files-.*\.zip$/.test(zipped.name) && zipped.names.length === 2 && zipped.names.includes('one.gif') && zipped.text === 'hello there', JSON.stringify(zipped));
  await PAGE.evaluate(() => exitSelectionMode());

  section('a profile photo on an iPhone');
  const IOS = await openApp('IPHONE', { origin: stacks.a.url, relay: stacks.a.url, context: {
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  } });
  const shared = await IOS.evaluate(async () => {
    window.__shared = null;
    navigator.canShare = (data) => Array.isArray(data?.files) && data.files.length > 0;
    navigator.share = async (data) => { window.__shared = data.files.map((file) => ({ name: file.name, type: file.type, size: file.size })); };
    const clicks = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() { clicks.push(this.href.slice(0, 16)); };
    const avatar = generatedAvatarData('emerald', 'Dorna');
    openPeerPhotoCard({ peerId: 'peer-dorna', username: 'Dorna', avatarData: avatar });
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('[data-peer-photo-download]')?.click();
    await new Promise((r) => setTimeout(r, 300));
    HTMLAnchorElement.prototype.click = realClick;
    return { shared: window.__shared, clicks };
  });
  check('it goes to the share sheet as a picture file, not a data: link', Array.isArray(shared.shared) && shared.shared.length === 1 && shared.shared[0].type.startsWith('image/') && shared.shared[0].size > 0 && shared.shared[0].name === 'Dorna.jpg' && !shared.clicks.length, JSON.stringify(shared));

  const errors = [...(PAGE.__errors || []), ...(IOS.__errors || [])];
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
