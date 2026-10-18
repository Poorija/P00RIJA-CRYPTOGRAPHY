/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* No picture read from IndexedDB is ever written back to it as it came.
 *
 *   On an iPhone a picture read from IndexedDB is a handle onto a file Safari
 *   keeps for that record. Putting a record again with those same handles in
 *   it leaves it pointing at files Safari then throws away: every sticker of a
 *   pack written that way became a broken image. Packs broke once thumbnails
 *   were stored for them, the GIF shelf once it was rewritten after a send.
 *   Chromium does not break, so this watches for the cause instead: every
 *   Blob that comes out of IndexedDB is noted, and every write is searched for
 *   one of them. Then, for each kind of write a person can cause —
 *
 *   - thumbnails stored for a pack imported before thumbnails;
 *   - stickers copied, moved and deleted; a pack renamed and reordered;
 *   - a GIF saved, a GIF removed, GIFs copied into a pack —
 *
 *   no write carries a picture as IndexedDB handed it over, and the stickers
 *   still draw afterwards.
 */
import { openApp, browser } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 260) : ''}`);
};

const stacks = await startTwoStacks();
try {
  const PAGE = await openApp('IDB', { origin: stacks.a.url, relay: stacks.a.url, context: { viewport: { width: 390, height: 844 } } });
  const setup = await PAGE.evaluate(async () => {
    const png = (hue, size = 300) => new Promise((resolve) => {
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const g = c.getContext('2d'); g.fillStyle = `hsl(${hue} 80% 50%)`; g.beginPath(); g.arc(size / 2, size / 2, size / 2.2, 0, 7); g.fill();
      c.toBlob(resolve, 'image/png');
    });
    const probe = window.__stickerProbe;
    probe.reset();
    /* Two packs as an older build stored them: no thumbnails. */
    const make = async (id, count, hue) => ({ id, title: id, author: '', source: 'import', createdAt: new Date().toISOString(),
      stickers: await Promise.all(Array.from({ length: count }, async (_, i) => ({ id: `${id}-s${i}`, name: `s${i}.png`, mime: 'image/png', kind: 'image', emoji: '', blob: await png(hue + i * 9) }))) });
    await probe.addPack(await make('old-a', 12, 10));
    await probe.addPack(await make('old-b', 6, 200));
    for (let i = 0; i < 4; i += 1) await window.__gifProbe.save(await png(i * 70, 64).then((b) => new Blob([b], { type: 'image/gif' })));

    /* Every Blob IndexedDB hands out, noted; every put, searched. */
    window.__fromIdb = new WeakSet();
    window.__violations = [];
    window.__puts = 0;
    const note = (value, depth = 0) => {
      if (!value || depth > 4) return;
      if (value instanceof Blob) { window.__fromIdb.add(value); return; }
      if (Array.isArray(value)) { value.forEach((item) => note(item, depth + 1)); return; }
      if (typeof value === 'object') Object.values(value).forEach((item) => note(item, depth + 1));
    };
    const search = (value, path, depth = 0) => {
      if (!value || depth > 4) return;
      if (value instanceof Blob) { if (window.__fromIdb.has(value)) window.__violations.push(path); return; }
      if (Array.isArray(value)) { value.forEach((item, i) => search(item, `${path}[${i}]`, depth + 1)); return; }
      if (typeof value === 'object') Object.entries(value).forEach(([key, item]) => search(item, `${path}.${key}`, depth + 1));
    };
    for (const method of ['get', 'getAll']) {
      const real = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function wrapped(...args) {
        const request = real.apply(this, args);
        request.addEventListener('success', () => note(request.result));
        return request;
      };
    }
    const realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put(value, ...rest) {
      if (this.name === 'packs') { window.__puts += 1; search(value, value?.id || '?'); }
      return realPut.call(this, value, ...rest);
    };
    /* What a start leaves in memory: everything as IndexedDB handed it out. */
    await loadStickerPacks();
    return { packs: chatState.stickerPacks.length, gifs: window.__gifProbe.library().length };
  });
  check('two older packs and four GIFs, loaded from storage', setup.packs === 2 && setup.gifs === 4, JSON.stringify(setup));

  const steps = await PAGE.evaluate(async () => {
    const probe = window.__stickerProbe;
    const log = {};
    const step = async (name, work, fromStart = false) => {
      const before = fromStart ? 0 : window.__violations.length;
      const putsBefore = fromStart ? 0 : window.__puts;
      await work();
      log[name] = { puts: window.__puts - putsBefore, bad: window.__violations.length - before };
    };
    const packA = chatState.stickerPacks.find((p) => p.id === 'old-a');
    /* Drawing the pack started its thumbnails in the background already; the
       step waits for them to be made and stored. */
    await step('thumbnails', async () => {
      /* As an older build left it: pictures read from storage, no thumbnails. */
      packA.stickers.forEach((r) => { delete r.thumb; delete r.thumbChecked; });
      await ensurePackThumbs(packA);
      for (let i = 0; i < 100 && !packA.stickers.every((r) => r.thumb instanceof Blob || r.thumbChecked); i += 1) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 400));
    }, true);
    await step('copy', async () => { probe.select('old-a', 'old-a-s1'); await probe.copySelected('old-b'); });
    await step('move', async () => { probe.select('old-a', 'old-a-s2'); await probe.copySelected('old-b', true); });
    await step('delete', async () => { probe.select('old-b', 'old-b-s0'); await probe.deleteSelected(); });
    await step('rename', () => renameStickerPack('old-b', 'Renamed B'));
    await step('reorder', () => moveStickerPack('old-b', -1));
    await step('save gif', async () => {
      const c = document.createElement('canvas'); c.width = 40; c.height = 40; c.getContext('2d').fillRect(0, 0, 40, 40);
      await window.__gifProbe.save(await new Promise((r) => c.toBlob((b) => r(new Blob([b], { type: 'image/gif' })), 'image/png')));
    });
    await step('remove gif', () => window.__gifProbe.remove(window.__gifProbe.library()[0].id));
    return { log, total: window.__violations.slice(0, 6) };
  });
  const bad = Object.entries(steps.log).filter(([, v]) => v.bad > 0).map(([k, v]) => `${k}:${v.bad}`);
  const wrote = Object.entries(steps.log).filter(([, v]) => v.puts > 0).map(([k]) => k);
  check('every kind of write happened', ['thumbnails', 'copy', 'move', 'delete', 'rename', 'save gif', 'remove gif'].every((k) => wrote.includes(k)), JSON.stringify(steps.log));
  check('and none carried a picture as IndexedDB handed it over', bad.length === 0, bad.join(', ') || JSON.stringify(steps.total));

  const drawn = await PAGE.evaluate(async () => {
    openSavedMessages();
    await new Promise((r) => setTimeout(r, 300));
    chatState.stickerActivePackId = 'old-b';
    setStickerPanelVisible(true, { shelf: 'stickers' });
    await new Promise((r) => setTimeout(r, 900));
    const imgs = [...document.querySelectorAll('#chatStickerGrid .chat-sticker-thumb')].filter((img) => img.getAttribute('src'));
    await Promise.all(imgs.map((img) => img.decode().catch(() => {})));
    return { shown: imgs.length, loaded: imgs.filter((img) => img.naturalWidth > 0).length };
  });
  check('and the stickers still draw', drawn.shown > 0 && drawn.loaded === drawn.shown, JSON.stringify(drawn));

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
