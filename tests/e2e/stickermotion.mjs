/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Stickers that keep moving, a still for every sticker, a sticker held up.
 *
 *   - an animated GIF, WebP or PNG that says it plays a few times is made to
 *     say "forever" — the loop count and nothing else — and a GIF with no
 *     count at all (which plays once) is given one;
 *   - a video, a Lottie and an animated picture each get a still on import,
 *     the picker draws the still at once with the moving sticker over it, and
 *     a video sticker paused under it starts again;
 *   - Lottie stickers move only near the view, and the ones a redraw threw
 *     away stop being animated;
 *   - a pack whose first sticker is a video shows a picture on its tab and in
 *     the manager, not a broken image, and its cover can be chosen there, or
 *     from the selection bar;
 *   - a GIF somebody sent that plays three times is drawn in the thread from
 *     a copy that loops forever;
 *   - tapping a sticker in a conversation lifts it, large, with the reactions
 *     (for one somebody else sent) and every action of its toolbar, and those
 *     actions are the toolbar's own: a reaction is recorded, a pin pins.
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, identity, importIdentity, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`);
};
const FIX = fileURLToPath(new URL('./fixtures', import.meta.url));
const decode = (card) => JSON.parse(Buffer.from(card.replace('poorija-chat-v1:', ''), 'base64').toString('utf8'));

/* A 2x2, two-frame APNG that says it plays twice. */
function apng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const head = Buffer.alloc(4); head.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body)); return Buffer.concat([head, body, tail]); };
  const u32 = (...values) => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeUInt32BE(v, i * 4)); return b; };
  const pixels = (r, g, b) => zlib.deflateSync(Buffer.from([0, r, g, b, 255, r, g, b, 255, 0, r, g, b, 255, r, g, b, 255]));
  const fctl = (seq) => Buffer.concat([u32(seq, 2, 2, 0, 0), Buffer.from([0, 1, 0, 10, 0, 0])]);
  const ihdr = Buffer.concat([u32(2, 2), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('acTL', u32(2, 2)), chunk('fcTL', fctl(0)), chunk('IDAT', pixels(255, 0, 0)),
    chunk('fcTL', fctl(1)), chunk('fdAT', Buffer.concat([u32(2), pixels(0, 0, 255)])), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}
const TGS = fs.readFileSync(path.join(FIX, 'anim.tgs')).toString('base64');

const stacks = await startTwoStacks();
try {
  const ARIF = await openApp('ARIF', { origin: stacks.a.url, relay: stacks.a.url, context: { viewport: { width: 390, height: 844 } } });
  const BAHAR = await openApp('BAHAR', { origin: stacks.a.url, relay: stacks.a.url, context: { viewport: { width: 390, height: 844 } } });
  const cards = { ARIF: await identity(ARIF), BAHAR: await identity(BAHAR) };
  const fp = { ARIF: decode(cards.ARIF).fingerprint, BAHAR: decode(cards.BAHAR).fingerprint };
  await importIdentity(ARIF, cards.BAHAR);
  await importIdentity(BAHAR, cards.ARIF);
  await waitFor(ARIF, (key) => Boolean(findPeerByAnyKey(key)), { timeoutMs: 30000, arg: fp.BAHAR });

  /* Pictures made in the page: GIFs by hand (two 1x1 frames), a WebP header
     carrying an ANIM chunk, the APNG above, a short video off a canvas. */
  await ARIF.evaluate(async ({ apngB64, tgsB64 }) => {
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ascii = (text) => Array.from(text, (c) => c.charCodeAt(0));
    const frame = (index) => [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0x02, 0x02, index ? 0x4c : 0x44, 0x01, 0x00];
    const gif = (loop) => new Blob([new Uint8Array([
      ...ascii('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0xff, 0xff, 0xff, 0, 0, 0,
      ...(loop === null ? [] : [0x21, 0xff, 0x0b, ...ascii('NETSCAPE2.0'), 0x03, 0x01, loop, 0x00, 0x00]),
      ...frame(0), ...frame(1), 0x3b])], { type: 'image/gif' });
    window.__pics = {
      gif3: gif(3),
      gifOnce: gif(null),
      gifForever: gif(0),
      webp: new Blob([new Uint8Array([...ascii('RIFF'), 30, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8X'), 10, 0, 0, 0, 0x12, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ...ascii('ANIM'), 6, 0, 0, 0, 0, 0, 0, 0, 2, 0])], { type: 'image/webp' }),
      apng: new Blob([bytes(apngB64)], { type: 'image/png' }),
      tgs: new File([bytes(tgsB64)], 'anim.tgs', { type: 'application/x-tgsticker' }),
    };
    try {
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
      const g = canvas.getContext('2d');
      const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' });
      const parts = [];
      recorder.ondataavailable = (e) => parts.push(e.data);
      let tick = 0;
      const draw = setInterval(() => { g.fillStyle = `hsl(${(tick += 20) % 360} 80% 50%)`; g.fillRect(0, 0, 128, 128); }, 33);
      recorder.start();
      await new Promise((r) => setTimeout(r, 700));
      recorder.stop();
      await new Promise((r) => { recorder.onstop = r; });
      clearInterval(draw);
      window.__pics.webm = new File([new Blob(parts, { type: 'video/webm' })], 'clip.webm', { type: 'video/webm' });
    } catch (_error) { window.__pics.webm = null; }
  }, { apngB64: apng(), tgsB64: TGS });

  const loops = await ARIF.evaluate(async () => {
    const p = window.__pics;
    const head = async (blob, n = 64) => Array.from(new Uint8Array(await blob.slice(0, n).arrayBuffer()));
    const netscapeLoop = async (blob) => { const b = await head(blob, 80); const i = b.findIndex((v, k) => v === 0x21 && b[k + 1] === 0xff && b[k + 2] === 0x0b); return i < 0 ? null : b[i + 16] | (b[i + 17] << 8); };
    const decodes = async (blob) => { try { const bm = await createImageBitmap(blob); bm.close(); return true; } catch (_e) { return false; } };
    const gif3 = await window.__stickerMotionProbe.loopForever(p.gif3);
    const gifOnce = await window.__stickerMotionProbe.loopForever(p.gifOnce);
    const gifForever = await window.__stickerMotionProbe.loopForever(p.gifForever);
    const webp = await window.__stickerMotionProbe.loopForever(p.webp);
    const apngOut = await window.__stickerMotionProbe.loopForever(p.apng);
    const a = new Uint8Array(await apngOut.arrayBuffer());
    let actl = null;
    for (let at = 8; at < a.length;) {
      const len = (a[at] << 24 | a[at + 1] << 16 | a[at + 2] << 8 | a[at + 3]) >>> 0;
      const tag = String.fromCharCode(...a.slice(at + 4, at + 8));
      if (tag === 'acTL') {
        const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
        let c = 0xffffffff; for (const v of a.slice(at + 4, at + 8 + len)) c = table[(c ^ v) & 255] ^ (c >>> 8);
        const stored = (a[at + 8 + len] << 24 | a[at + 9 + len] << 16 | a[at + 10 + len] << 8 | a[at + 11 + len]) >>> 0;
        actl = { plays: (a[at + 12] << 24 | a[at + 13] << 16 | a[at + 14] << 8 | a[at + 15]) >>> 0, crcOk: ((c ^ 0xffffffff) >>> 0) === stored };
        break;
      }
      at += 12 + len;
    }
    return {
      gif3: { loop: await netscapeLoop(gif3), size: gif3.size === p.gif3.size, decodes: await decodes(gif3) },
      gifOnce: { loop: await netscapeLoop(gifOnce), grew: gifOnce.size - p.gifOnce.size, decodes: await decodes(gifOnce), animated: await pictureIsAnimated(gifOnce, 'image/gif') },
      foreverUntouched: gifForever === p.gifForever,
      webpLoop: (await head(webp, 44)).slice(42, 44),
      apng: { ...actl, size: apngOut.size === p.apng.size, decodes: await decodes(apngOut) },
    };
  });
  check('a GIF that plays three times is made to loop forever, its size unchanged', loops.gif3.loop === 0 && loops.gif3.size && loops.gif3.decodes, JSON.stringify(loops.gif3));
  check('a GIF with no loop count (it plays once) is given one, and still decodes as animated', loops.gifOnce.loop === 0 && loops.gifOnce.grew === 19 && loops.gifOnce.decodes && loops.gifOnce.animated, JSON.stringify(loops.gifOnce));
  check('a GIF that already loops forever is left exactly as it was', loops.foreverUntouched);
  check('an animated WebP\'s ANIM count is set to forever', JSON.stringify(loops.webpLoop) === '[0,0]', JSON.stringify(loops.webpLoop));
  check('an APNG\'s plays are set to forever, with the chunk\'s checksum made again', loops.apng.plays === 0 && loops.apng.crcOk && loops.apng.size && loops.apng.decodes, JSON.stringify(loops.apng));

  const imported = await ARIF.evaluate(async () => {
    window.__stickerProbe.reset();
    openSavedMessages();
    await new Promise((r) => setTimeout(r, 300));
    const p = window.__pics;
    const files = [p.webm, p.tgs, new File([p.gif3], 'moving.gif', { type: 'image/gif' })].filter(Boolean);
    await importStickerFiles(files);
    const pack = chatState.stickerPacks[0];
    const gifRecord = pack?.stickers.find((r) => r.name === 'moving.gif');
    const loopOf = async (blob) => { const b = new Uint8Array(await blob.slice(0, 80).arrayBuffer()); const i = b.findIndex((v, k) => v === 0x21 && b[k + 1] === 0xff && b[k + 2] === 0x0b); return i < 0 ? null : b[i + 16]; };
    return {
      video: Boolean(p.webm),
      kinds: pack?.stickers.map((r) => r.kind),
      stills: pack?.stickers.map((r) => r.thumb instanceof Blob),
      gifAnimated: gifRecord?.animated === true,
      gifLoop: gifRecord ? await loopOf(gifRecord.blob) : -1,
    };
  });
  check('a video, a Lottie and an animated GIF each get a still on import', imported.stills?.length === imported.kinds?.length && imported.stills.every(Boolean), JSON.stringify(imported));
  check('the imported GIF is known to move, and is stored looping forever', imported.gifAnimated && imported.gifLoop === 0, JSON.stringify(imported));
  if (!imported.video) console.log('  (no MediaRecorder here: the video sticker was left out)');

  const grid = await ARIF.evaluate(async () => {
    const pack = chatState.stickerPacks[0];
    chatState.stickerActivePackId = pack.id;
    setStickerPanelVisible(true, { shelf: 'stickers' });
    await new Promise((r) => setTimeout(r, 1500));
    const cells = [...document.querySelectorAll('#chatStickerGrid .chat-sticker-cell')];
    const stills = cells.map((cell) => cell.querySelector('.chat-sticker-still')?.getAttribute('src') || '');
    const motion = cells.map((cell) => Boolean(cell.querySelector('.chat-sticker-thumb.is-motion')));
    const tab = document.querySelector(`#chatStickerTabs [data-chat-sticker-pack="${pack.id}"]`);
    const tabImg = tab?.querySelector('img');
    await tabImg?.decode().catch(() => {});
    const video = document.querySelector('#chatStickerGrid video.is-motion');
    let resumed = null;
    if (video) {
      for (let i = 0; i < 20 && video.paused; i += 1) await new Promise((r) => setTimeout(r, 100));
      video.pause();
      await new Promise((r) => setTimeout(r, 2600));
      resumed = !video.paused;
    }
    const ready = cells.filter((cell) => cell.classList.contains('motion-ready')).length;
    return { cells: cells.length, stills: stills.filter(Boolean).length, motion: motion.filter(Boolean).length, ready, tabPicture: Boolean(tabImg && tabImg.naturalWidth > 0), resumed };
  });
  check('the picker draws every moving sticker\'s still at once, with the moving sticker over it', grid.cells >= 2 && grid.stills === grid.cells && grid.motion === grid.cells, JSON.stringify(grid));
  check('and the moving ones take over once they have a frame', grid.ready >= 1, JSON.stringify(grid));
  check('a pack whose first sticker moves shows a picture on its tab', grid.tabPicture, JSON.stringify(grid));
  if (grid.resumed !== null) check('a video sticker paused under the picker starts again', grid.resumed === true, JSON.stringify(grid));

  /* WebKit on an iPhone stops a looping WebM on its last frame while it still
     claims to play. Stood in for here by freezing the clock near the end: it
     must be sent back to the start within a few frames, not seconds. */
  const replay = await ARIF.evaluate(async () => {
    const video = document.querySelector('#chatStickerGrid video.is-motion');
    if (!video) return null;
    for (let i = 0; i < 30 && !(video.duration > 0); i += 1) await new Promise((r) => setTimeout(r, 100));
    const proto = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    const frozenAt = Math.max(0, video.duration - 0.05);
    let sentBackAfter = null;
    const started = performance.now();
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => frozenAt,
      set: (value) => { if (value === 0 && sentBackAfter === null) sentBackAfter = Math.round(performance.now() - started); proto.set.call(video, value); },
    });
    await new Promise((r) => setTimeout(r, 1200));
    delete video.currentTime;
    /* And a plain end, with the browser's own loop off: started again at once. */
    video.loop = false;
    let endedAt = 0;
    let gap = null;
    video.addEventListener('ended', () => { endedAt = performance.now(); }, { once: true });
    const onTime = () => { if (endedAt && video.currentTime < 0.3 && !video.paused) { gap = Math.round(performance.now() - endedAt); video.removeEventListener('timeupdate', onTime); } };
    video.addEventListener('timeupdate', onTime);
    await new Promise((r) => setTimeout(r, (video.duration || 1) * 1000 + 1200));
    video.loop = true;
    return { sentBackAfter, gap };
  });
  if (replay) check('a video sticker stuck on its last frame goes back to the start within a few frames, and one that ends starts again at once', replay.sentBackAfter !== null && replay.sentBackAfter < 400 && replay.gap !== null && replay.gap < 400, JSON.stringify(replay));

  const covers = await ARIF.evaluate(async () => {
    const pack = chatState.stickerPacks[0];
    const second = pack.stickers[1];
    await window.__stickerProbe.setCover(pack.id, second.id);
    const stored = (await stickerDbGetAllPacks()).find((p) => p.id === pack.id);
    const tabSrc = document.querySelector(`#chatStickerTabs [data-chat-sticker-pack="${pack.id}"] img`)?.getAttribute('src');
    const fromProbe = window.__stickerProbe.coverUrl(pack.id);
    openPackManager();
    await new Promise((r) => setTimeout(r, 300));
    const managerImg = document.querySelector('.packman-cover img');
    await managerImg?.decode().catch(() => {});
    const managerOk = Boolean(managerImg && managerImg.naturalWidth > 0);
    document.querySelector(`[data-pack-cover="${pack.id}"]`).click();
    await new Promise((r) => setTimeout(r, 300));
    const pickCells = document.querySelectorAll('.packman-coverpick [data-cover-pick]').length;
    document.querySelector(`.packman-coverpick [data-cover-pick="${pack.stickers[2].id}"]`).click();
    await new Promise((r) => setTimeout(r, 600));
    const afterPicker = pack.coverId === pack.stickers[2].id;
    closePackManager();
    /* From the selection bar: one sticker picked. */
    window.__stickerProbe.select(pack.id, pack.stickers[0].id);
    renderStickerPanel();
    document.querySelector('[data-chat-sticker-cover-selected]').click();
    await new Promise((r) => setTimeout(r, 600));
    return { storedCover: stored?.coverId === second.id, tabMatches: tabSrc === fromProbe && Boolean(tabSrc), managerOk, pickCells, afterPicker, fromBar: pack.coverId === pack.stickers[0].id };
  });
  check('a chosen cover is stored with the pack and shown on its tab', covers.storedCover && covers.tabMatches, JSON.stringify(covers));
  check('the pack manager shows a real picture for it, and its picture opens a chooser that sets the cover', covers.managerOk && covers.pickCells >= 2 && covers.afterPicker, JSON.stringify(covers));
  check('one sticker picked in the panel can be made the cover from the selection bar', covers.fromBar, JSON.stringify(covers));

  const movingCover = await ARIF.evaluate(async () => {
    const pack = chatState.stickerPacks[0];
    const moving = pack.stickers.find((r) => r.kind === 'lottie');
    await window.__stickerProbe.setCover(pack.id, moving.id);
    setStickerPanelVisible(true, { shelf: 'stickers' });
    renderStickerPanel();
    await new Promise((r) => setTimeout(r, 1500));
    const cover = document.querySelector(`#chatStickerTabs [data-chat-sticker-pack="${pack.id}"] .sticker-cover`);
    return { motion: Boolean(cover?.querySelector('.sticker-cover-motion')), svg: Boolean(cover?.querySelector('svg')), ready: Boolean(cover?.classList.contains('motion-ready')) };
  });
  check('a moving sticker made the cover moves on the pack\'s tab', movingCover.motion && movingCover.svg && movingCover.ready, JSON.stringify(movingCover));

  /* A moving cover once grew to the width of its row in the pack manager. */
  const coverSizes = await ARIF.evaluate(async () => {
    openPackManager();
    await new Promise((r) => setTimeout(r, 1200));
    const box = (node) => { const r = node?.getBoundingClientRect(); return r ? [Math.round(r.width), Math.round(r.height)] : null; };
    const moving = box(document.querySelector('.packman-cover .sticker-cover'));
    const still = box(document.querySelector('.packman-cover img.packman-thumb, .packman-cover span.packman-thumb:not(.sticker-cover)'));
    const tab = box(document.querySelector('#chatStickerTabs .sticker-cover'));
    const tabButton = box(document.querySelector('#chatStickerTabs .sticker-cover')?.closest('.chat-sticker-tab'));
    closePackManager();
    return { moving, still, tab, tabButton };
  });
  check('a moving cover is the size of a still one in the pack manager, and fits its tab', coverSizes.moving && coverSizes.moving[0] <= 48 && coverSizes.moving[1] <= 48
    && (!coverSizes.still || (coverSizes.moving[0] === coverSizes.still[0] && coverSizes.moving[1] === coverSizes.still[1]))
    && coverSizes.tab && coverSizes.tab[0] <= coverSizes.tabButton[0], JSON.stringify(coverSizes));

  const eager = await ARIF.evaluate(async () => {
    const make = async (i) => { const c = document.createElement('canvas'); c.width = 400; c.height = 400; const g = c.getContext('2d'); g.fillStyle = `hsl(${i * 13} 70% 50%)`; g.fillRect(0, 0, 400, 400); return new Promise((r) => c.toBlob(r, 'image/webp', 0.9)); };
    const stickers = [];
    for (let i = 0; i < 60; i += 1) { const blob = await make(i); stickers.push({ id: `e-${i}`, name: `e${i}.webp`, mime: 'image/webp', kind: 'image', emoji: '', blob, thumb: blob, upkeep: 2 }); }
    await window.__stickerProbe.addPack({ id: 'eager-pack', title: 'Eager', author: '', source: 'import', createdAt: new Date().toISOString(), stickers });
    chatState.stickerActivePackId = 'eager-pack';
    renderStickerPanel();
    /* Read in the same task: nothing has had a chance to observe anything. */
    const imgs = [...document.querySelectorAll('#chatStickerGrid .chat-sticker-thumb')];
    return { first: imgs.slice(0, 30).filter((img) => img.getAttribute('src')).length, rest: imgs.slice(30).filter((img) => img.getAttribute('src')).length };
  });
  check('the first screenfuls of a pack are drawn with the grid, without waiting to be observed', eager.first === 30 && eager.rest === 0, JSON.stringify(eager));

  const lottie = await ARIF.evaluate(async () => {
    /* Forty Lottie stickers in one pack. */
    const json = await (await fetch(stickerObjectUrl(chatState.stickerPacks[0].stickers.find((r) => r.kind === 'lottie')))).text();
    const stickers = Array.from({ length: 40 }, (_, i) => ({ id: `lot-${i}`, name: `l${i}.tgs`, mime: 'application/json', kind: 'lottie', emoji: '', blob: new Blob([json], { type: 'application/json' }) }));
    await window.__stickerProbe.addPack({ id: 'lottie-heavy', title: 'Lottie heavy', author: '', source: 'import', createdAt: new Date().toISOString(), stickers });
    chatState.stickerActivePackId = 'lottie-heavy';
    setStickerPanelVisible(true, { shelf: 'stickers' });
    renderStickerPanel();
    await new Promise((r) => setTimeout(r, 2500));
    const mounted = document.querySelectorAll('#chatStickerGrid .chat-lottie svg').length;
    const registered = () => (typeof lottie.getRegisteredAnimations === 'function' ? lottie.getRegisteredAnimations().length : -1);
    const whileShown = registered();
    chatState.stickerActivePackId = chatState.stickerPacks[0].id;
    renderStickerPanel();
    await new Promise((r) => setTimeout(r, 400));
    hydrateLottieNodes(document);
    return { mounted, whileShown, afterLeaving: registered() };
  });
  check('of forty Lottie stickers only those near the view are animated', lottie.mounted > 0 && lottie.mounted < 40, JSON.stringify(lottie));
  check('and leaving the pack stops the animations it threw away', lottie.afterLeaving >= 0 ? lottie.afterLeaving < lottie.whileShown : true, JSON.stringify(lottie));

  /* A GIF that plays three times, and a Lottie sticker, to BAHAR. */
  await ARIF.evaluate(async (key) => {
    setStickerPanelVisible(false);
    const peer = findPeerByAnyKey(key);
    chatState.activeConversationId = getConversationKey(peer);
    chatState.activePeerClientId = peer.clientId || '';
    renderPeers(); renderActivePeer(); renderMessages();
    await new Promise((r) => setTimeout(r, 400));
    await sendGifBlob(window.__pics.gif3);
    await new Promise((r) => setTimeout(r, 1200));
    await sendStickerRecord(chatState.stickerPacks[0].stickers.find((r) => r.kind === 'lottie'));
  }, fp.BAHAR);
  const arrived = await waitFor(BAHAR, (key) => {
    const list = chatState.history[getConversationKey(findPeerByAnyKey(key))] || [];
    return list.filter((e) => e.direction === 'in' && e.type === 'sticker' && e.downloadUrl).length >= 2;
  }, { timeoutMs: 90000, arg: fp.ARIF });
  check('BAHAR receives the GIF and the sticker', arrived);

  const thread = await BAHAR.evaluate(async (key) => {
    const peer = findPeerByAnyKey(key);
    chatState.activeConversationId = getConversationKey(peer);
    chatState.activePeerClientId = peer.clientId || '';
    renderPeers(); renderActivePeer(); renderMessages();
    await new Promise((r) => setTimeout(r, 2000));
    const img = document.querySelector('#chatMessages .chat-sticker-bubble.is-gif img.chat-sticker-media');
    const entry = (chatState.history[getConversationKey(peer)] || []).find((e) => isGifEntry(e));
    const blob = img ? await (await fetch(img.getAttribute('src'))).blob() : null;
    const b = blob ? new Uint8Array(await blob.slice(0, 80).arrayBuffer()) : new Uint8Array();
    const i = b.findIndex((v, k) => v === 0x21 && b[k + 1] === 0xff && b[k + 2] === 0x0b);
    const original = entry ? new Uint8Array(await (await (await fetch(entry.downloadUrl)).blob()).slice(0, 80).arrayBuffer()) : new Uint8Array();
    const j = original.findIndex((v, k) => v === 0x21 && original[k + 1] === 0xff && original[k + 2] === 0x0b);
    return { drawnLoop: i < 0 ? null : b[i + 16], receivedLoop: j < 0 ? null : original[j + 16], swapped: img?.getAttribute('src') !== entry?.downloadUrl };
  }, fp.ARIF);
  check('a GIF that arrived playing three times is drawn from a copy that loops forever', thread.receivedLoop === 3 && thread.drawnLoop === 0 && thread.swapped, JSON.stringify(thread));

  const focus = await BAHAR.evaluate(async (key) => {
    const conversation = getConversationKey(findPeerByAnyKey(key));
    const entry = (chatState.history[conversation] || []).find((e) => e.type === 'sticker' && e.stickerKind !== 'gif' && e.direction === 'in');
    const bubbleOf = () => document.querySelector(`#chatMessages .chat-message-bubble[data-id="${CSS.escape(entry.id)}"]`);
    const toolbarCount = bubbleOf().querySelectorAll('.chat-message-toolbar > button:not([data-chat-toggle-reaction])').length;
    bubbleOf().querySelector('.chat-sticker-body').click();
    await new Promise((r) => setTimeout(r, 900));
    const host = document.querySelector('.sticker-focus');
    const opened = {
      open: Boolean(host),
      media: Boolean(host?.querySelector('.sticker-focus-media')),
      svg: Boolean(host?.querySelector('.sticker-focus-media svg')),
      reactions: host?.querySelectorAll('.sticker-focus-reactions [data-focus-react]').length || 0,
      actions: host?.querySelectorAll('[data-focus-act]').length || 0,
      labelled: [...(host?.querySelectorAll('[data-focus-act] span') || [])].every((s) => s.textContent.trim()),
      toolbarCount,
      lifted: bubbleOf().querySelector('.chat-sticker-body').classList.contains('is-lifted'),
    };
    host.querySelector('[data-focus-react="👍"]').click();
    await new Promise((r) => setTimeout(r, 900));
    const reacted = normalizeMessageReactions(entry)[currentReactorId()] === '👍';
    const closedAfterReact = !document.querySelector('.sticker-focus');
    bubbleOf().querySelector('.chat-sticker-body').click();
    await new Promise((r) => setTimeout(r, 700));
    [...document.querySelectorAll('.sticker-focus [data-focus-act]')].find((b) => /pin|سنجاق/i.test(b.textContent))?.click();
    await new Promise((r) => setTimeout(r, 900));
    const pinned = Boolean((chatState.history[conversation] || []).find((e) => e.id === entry.id)?.pinned);
    bubbleOf().querySelector('.chat-sticker-body').click();
    await new Promise((r) => setTimeout(r, 600));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    const escaped = !document.querySelector('.sticker-focus');
    const restored = !bubbleOf().querySelector('.chat-sticker-body').classList.contains('is-lifted');
    enterSelectionMode(entry.id);
    await new Promise((r) => setTimeout(r, 300));
    bubbleOf().querySelector('.chat-sticker-body').click();
    await new Promise((r) => setTimeout(r, 500));
    const notInSelection = !document.querySelector('.sticker-focus');
    exitSelectionMode?.();
    return { opened, reacted, closedAfterReact, pinned, escaped, restored, notInSelection };
  }, fp.ARIF);
  check('tapping a sticker lifts it, large and moving, out of the thread', focus.opened.open && focus.opened.media && focus.opened.svg && focus.opened.lifted, JSON.stringify(focus.opened));
  check('with reactions, and every action of its toolbar, each named', focus.opened.reactions >= 5 && focus.opened.actions === focus.opened.toolbarCount && focus.opened.actions >= 4 && focus.opened.labelled, JSON.stringify(focus.opened));
  check('a reaction chosen there is recorded, and the view closes', focus.reacted && focus.closedAfterReact, JSON.stringify(focus));
  check('an action there is the toolbar\'s own: pin pins', focus.pinned, JSON.stringify(focus));
  check('Escape puts it back where it was', focus.escaped && focus.restored, JSON.stringify(focus));
  check('while picking messages, a tap picks rather than lifts', focus.notInSelection, JSON.stringify(focus));

  const own = await ARIF.evaluate(async () => {
    renderMessages();
    await new Promise((r) => setTimeout(r, 500));
    const bubble = [...document.querySelectorAll('#chatMessages .chat-sticker-bubble.me')].pop();
    bubble?.querySelector('.chat-sticker-body')?.click();
    await new Promise((r) => setTimeout(r, 700));
    const host = document.querySelector('.sticker-focus');
    const result = { open: Boolean(host), reactions: host?.querySelectorAll('[data-focus-react]').length || 0, actions: host?.querySelectorAll('[data-focus-act]').length || 0 };
    window.__stickerMotionProbe.closeFocus();
    return result;
  });
  check('your own sticker opens too, without reactions — you do not react to yourself', own.open && own.reactions === 0 && own.actions >= 3, JSON.stringify(own));

  const errors = [...(ARIF.__errors || []), ...(BAHAR.__errors || [])];
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
