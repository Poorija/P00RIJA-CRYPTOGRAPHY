/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The GIF shelf after a GIF is sent, closed and opened again.
 *
 *   On an iPhone a picture read from IndexedDB is a handle onto the stored
 *   copy, and writing the record again throws the copy away. Sending a GIF
 *   rewrote the GIF library to note when it was used, so the next time the
 *   shelf opened every GIF was a broken image. Here:
 *
 *   - sending a GIF writes nothing to the library;
 *   - after a write that has to happen, the pictures in memory are the ones
 *     read back from it, and no URL made from the old ones is kept;
 *   - with every picture's URL dead, the shelf reads the packs back and draws
 *     them again, rather than staying broken;
 *   - closed and opened again after a send, every GIF on the shelf draws.
 */
import { openApp, browser } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 260) : ''}`);
};
const GIF_B64 = 'R0lGODlhCAAIAPABAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQEFAAAACwAAAAACAAIAAACB4SPqcvtD1wAIfkEBBQAAAAsAAAAAAgACAAAAgeEj6nL7Q9cADs=';

const stacks = await startTwoStacks();
try {
  const PAGE = await openApp('REOPEN', { origin: stacks.a.url, relay: stacks.a.url, context: { viewport: { width: 390, height: 844 } } });
  await PAGE.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    for (let i = 0; i < 9; i += 1) { const copy = bytes.slice(); copy[copy.length - 2] = 60 + i; await window.__gifProbe.save(new Blob([copy], { type: 'image/gif' })); }
    /* What a reload leaves in memory: the library as read from storage. */
    await loadStickerPacks();
    openSavedMessages();
    await new Promise((r) => setTimeout(r, 300));
    setStickerPanelVisible(true, { shelf: 'gifs' });
    await new Promise((r) => setTimeout(r, 500));
  }, GIF_B64);
  const drawn = () => PAGE.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 600));
    const imgs = [...document.querySelectorAll('#chatStickerGrid .chat-gif-thumb')];
    return { count: imgs.length, loaded: imgs.filter((img) => img.complete && img.naturalWidth > 0).length };
  });

  const writes = await PAGE.evaluate(async () => {
    const puts = [];
    const realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put(value, ...rest) { if (value?.id === GIF_LIBRARY_ID) puts.push(value.id); return realPut.call(this, value, ...rest); };
    document.querySelector('#chatStickerGrid .chat-gif-cell').click();
    await new Promise((r) => setTimeout(r, 1200));
    IDBObjectStore.prototype.put = realPut;
    return { puts: puts.length, sent: (chatState.history.saved || []).filter((e) => isGifEntry(e)).length };
  });
  check('sending a GIF writes nothing to the GIF library', writes.sent === 1 && writes.puts === 0, JSON.stringify(writes));

  const fresh = await PAGE.evaluate(async (b64) => {
    const library = chatState.gifLibrary;
    const before = new Map(library.stickers.map((record) => [record.id, record.blob]));
    const urlsBefore = new Map(library.stickers.map((record) => [record.id, chatState.stickerUrls.get(record.id)]));
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); bytes[bytes.length - 2] = 99;
    await window.__gifProbe.save(new Blob([bytes], { type: 'image/gif' }));
    const kept = library.stickers.filter((record) => before.has(record.id));
    return {
      handlesReplaced: kept.every((record) => record.blob !== before.get(record.id)),
      oldUrlsDropped: kept.every((record) => !urlsBefore.get(record.id) || chatState.stickerUrls.get(record.id) !== urlsBefore.get(record.id)),
      count: kept.length,
    };
  }, GIF_B64);
  check('after a write, the pictures in memory are the ones read back, and old URLs are gone', fresh.handlesReplaced && fresh.oldUrlsDropped && fresh.count === 9, JSON.stringify(fresh));

  const healed = await PAGE.evaluate(async () => {
    /* Every picture's URL dead at once, the way a dropped stored copy leaves
       them; the panel is drawn again from those dead URLs. */
    chatState.stickerUrls.forEach((url) => URL.revokeObjectURL(url));
    setStickerPanelVisible(false);
    setStickerPanelVisible(true, { shelf: 'gifs' });
    await new Promise((r) => setTimeout(r, 1500));
    const imgs = [...document.querySelectorAll('#chatStickerGrid .chat-gif-thumb')];
    return { count: imgs.length, loaded: imgs.filter((img) => img.complete && img.naturalWidth > 0).length };
  });
  check('with every URL dead, the shelf reads the packs back and draws again', healed.count === 10 && healed.loaded === 10, JSON.stringify(healed));

  await PAGE.evaluate(async () => {
    document.querySelectorAll('#chatStickerGrid .chat-gif-cell')[2].click();
    await new Promise((r) => setTimeout(r, 1000));
    setStickerPanelVisible(false);
    await new Promise((r) => setTimeout(r, 300));
    setStickerPanelVisible(true, { shelf: 'gifs' });
  });
  const reopened = await drawn();
  check('sent, closed and opened again: every GIF draws', reopened.count === 10 && reopened.loaded === 10, JSON.stringify(reopened));

  check('no page errors', !(PAGE.__errors || []).length, (PAGE.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
