/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A heavy sticker pack: 240 stickers, 512 px WebP each, the way a Telegram
 * pack exports.
 *
 *   The picker drew every sticker at full size, all at once — on a phone a
 *   quarter of a gigabyte of decoded pictures and a frozen app — and the
 *   import ran start to finish without letting the page breathe. Here:
 *
 *   - the import keeps the page responsive and says how far it has got;
 *   - every static sticker gets a small thumbnail, and the picker draws those;
 *   - only the stickers near the visible part of the grid are given a picture;
 *   - a pack from before thumbnails gets them in the background;
 *   - sending still sends the full sticker.
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
  const PAGE = await openApp('HEAVY', { origin: stacks.a.url, relay: stacks.a.url, context: { viewport: { width: 390, height: 844 } } });
  const imported = await PAGE.evaluate(async () => {
    window.__stickerProbe.reset();
    const zip = new window.JSZip();
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const paint = canvas.getContext('2d');
    for (let i = 0; i < 240; i += 1) {
      paint.clearRect(0, 0, 512, 512);
      paint.fillStyle = `hsl(${(i * 37) % 360} 80% 50%)`;
      paint.beginPath(); paint.arc(256, 256, 200 + (i % 40), 0, Math.PI * 2); paint.fill();
      paint.fillStyle = '#fff'; paint.font = 'bold 120px sans-serif'; paint.fillText(String(i), 160, 300);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.95));
      zip.file(`sticker_${String(i).padStart(3, '0')}.webp`, blob);
    }
    const file = new File([await zip.generateAsync({ type: 'blob', compression: 'STORE' })], 'telegram_pack.zip', { type: 'application/zip' });
    /* The longest the page went without running anything else. */
    let last = performance.now();
    let longest = 0;
    const ticker = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; }, 16);
    const banners = new Set();
    const watch = setInterval(() => { const text = document.getElementById('chatTransferBannerText')?.textContent || ''; if (/stickers|استیکر/i.test(text)) banners.add(text); }, 50);
    const started = performance.now();
    await importStickerFiles([file]);
    clearInterval(ticker); clearInterval(watch);
    const pack = chatState.stickerPacks.find((p) => p.title === 'telegram_pack');
    const records = pack?.stickers || [];
    return {
      count: records.length,
      withThumb: records.filter((r) => r.thumb instanceof Blob).length,
      biggestThumb: Math.max(0, ...records.map((r) => r.thumb?.size || 0)),
      smallestSticker: Math.min(...records.map((r) => r.blob.size)),
      longestStallMs: Math.round(longest),
      seconds: Math.round((performance.now() - started) / 100) / 10,
      progressShown: banners.size > 0,
    };
  });
  check('a 240-sticker pack imports whole', imported.count === 240, JSON.stringify(imported));
  check('and the page keeps breathing while it does', imported.longestStallMs < 400, JSON.stringify(imported));
  check('with its progress shown', imported.progressShown, JSON.stringify(imported));
  check('every sticker has a small thumbnail', imported.withThumb === 240 && imported.biggestThumb < imported.smallestSticker, JSON.stringify(imported));

  const drawn = await PAGE.evaluate(async () => {
    openSavedMessages();
    await new Promise((r) => setTimeout(r, 300));
    chatState.stickerActivePackId = chatState.stickerPacks.find((p) => p.title === 'telegram_pack').id;
    setStickerPanelVisible(true, { shelf: 'stickers' });
    await new Promise((r) => setTimeout(r, 800));
    const imgs = [...document.querySelectorAll('#chatStickerGrid .chat-sticker-thumb')];
    const given = imgs.filter((img) => img.getAttribute('src'));
    await Promise.all(given.map((img) => img.decode().catch(() => {})));
    const thumbUrls = new Set([...chatState.stickerUrls.entries()].filter(([key]) => key.endsWith('#thumb')).map(([, url]) => url));
    const loaded = given.filter((img) => img.complete && img.naturalWidth > 0);
    /* Read now: scrolled away below, these are let go on purpose. */
    const thumbsDrawn = given.every((img) => thumbUrls.has(img.getAttribute('src')));
    const widest = Math.max(0, ...loaded.map((img) => img.naturalWidth));
    const grid = document.getElementById('chatStickerGrid');
    grid.scrollTop = grid.scrollHeight;
    await new Promise((r) => setTimeout(r, 600));
    const lastGiven = imgs.slice(-6).every((img) => img.getAttribute('src'));
    const firstReleased = imgs.slice(0, 6).every((img) => !img.getAttribute('src'));
    return {
      cells: imgs.length,
      given: given.length,
      thumbsDrawn,
      widest,
      lastGiven,
      firstReleased,
    };
  });
  check('the picker draws thumbnails, not the 512 px stickers', drawn.thumbsDrawn && drawn.widest > 0 && drawn.widest <= 256, JSON.stringify(drawn));
  check('only the stickers near the visible part get a picture', drawn.cells === 240 && drawn.given > 0 && drawn.given < 100, JSON.stringify(drawn));
  check('scrolled to the end, the end is drawn and the top let go', drawn.lastGiven && drawn.firstReleased, JSON.stringify(drawn));

  const backfill = await PAGE.evaluate(async () => {
    const pack = chatState.stickerPacks.find((p) => p.title === 'telegram_pack');
    pack.stickers.slice(0, 30).forEach((record) => { delete record.thumb; delete record.thumbChecked; });
    await ensurePackThumbs(pack);
    return pack.stickers.slice(0, 30).filter((record) => record.thumb instanceof Blob).length;
  });
  check('a pack from before thumbnails gets them in the background', backfill === 30, String(backfill));

  const sent = await PAGE.evaluate(async () => {
    const pack = chatState.stickerPacks.find((p) => p.title === 'telegram_pack');
    const record = pack.stickers[5];
    let size = 0;
    const original = window.sendEncryptedBlob;
    window.sendEncryptedBlob = async (file) => { size = file.size; };
    await sendStickerRecord(record);
    window.sendEncryptedBlob = original;
    return { size, full: record.blob.size, thumb: record.thumb?.size || 0 };
  });
  check('sending still sends the full sticker', sent.size === sent.full && sent.size > sent.thumb, JSON.stringify(sent));

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
