/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A Telegram sticker pack from its share link, through the relay.
 *
 *   A fake Telegram stands where api.telegram.org would. Relay A holds a bot
 *   token; relay B has none and names A as its upstream — a relay inside a
 *   network that cannot reach Telegram asking the one outside.
 *
 *   - every form a pack link comes in is read for the pack's name;
 *   - pasted into A, the pack arrives whole: its title, its emoji, a .webp as
 *     a picture with a thumbnail and a .tgs as an animation;
 *   - through B, the same pack arrives by way of A;
 *   - a relay with neither a token nor an upstream says so, in words;
 *   - a pack Telegram does not have is said to be missing;
 *   - the relay fetches only files out of a pack it has described, and the
 *     token appears in nothing it sends back.
 */
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, browser } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 260) : ''}`);
};
const FIX = fileURLToPath(new URL('./fixtures', import.meta.url));
const TOKEN = '123456:FAKE-token-for-the-suite_abcdefghijklmnop';
/* A real 512 px picture, the size Telegram's stickers are, written out as a
   PNG by hand: a ring of colour, so it is not a single flat block. */
function png512() {
  const size = 512;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - 256, y - 256);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const on = d < 240 && d > 120;
      raw[o] = on ? (x * 7) & 255 : 0; raw[o + 1] = on ? (y * 5) & 255 : 0; raw[o + 2] = on ? 200 : 0; raw[o + 3] = on ? 255 : 0;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const head = Buffer.alloc(4); head.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body)); return Buffer.concat([head, body, tail]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const files = {
  'stickers/a.webp': fs.readFileSync(path.join(FIX, 'loose1.png')),
  'stickers/b.webp': fs.readFileSync(path.join(FIX, 'loose2.png')),
  'stickers/c.webp': png512(),
  'stickers/d.tgs': fs.readFileSync(path.join(FIX, 'anim.tgs')),
};
const ids = { 'stickers/a.webp': 'AAQCAgADfakeidA000000000000001', 'stickers/b.webp': 'AAQCAgADfakeidB000000000000002', 'stickers/c.webp': 'AAQCAgADfakeidC000000000000003', 'stickers/d.tgs': 'AAQCAgADfakeidD000000000000004' };
const byId = Object.fromEntries(Object.entries(ids).map(([file, id]) => [id, file]));
const asked = [];
const telegram = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  asked.push(url.pathname);
  const send = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === `/bot${TOKEN}/getStickerSet`) {
    if (url.searchParams.get('name') !== 'PoorijaTestPack') return send({ ok: false, error_code: 400, description: 'Bad Request: STICKERSET_INVALID' });
    return send({ ok: true, result: { name: 'PoorijaTestPack', title: 'Poorija Test Pack', stickers: [
      { file_id: ids['stickers/a.webp'], emoji: '😀', is_animated: false, is_video: false },
      { file_id: ids['stickers/b.webp'], emoji: '😎', is_animated: false, is_video: false },
      { file_id: ids['stickers/c.webp'], emoji: '🔥', is_animated: false, is_video: false },
      { file_id: ids['stickers/d.tgs'], emoji: '🎉', is_animated: true, is_video: false },
    ] } });
  }
  if (url.pathname === `/bot${TOKEN}/getFile`) {
    const file = byId[url.searchParams.get('file_id')];
    return file ? send({ ok: true, result: { file_path: file } }) : send({ ok: false, description: 'Bad Request: wrong file_id' });
  }
  const prefix = `/file/bot${TOKEN}/`;
  if (url.pathname.startsWith(prefix) && files[url.pathname.slice(prefix.length)]) {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end(files[url.pathname.slice(prefix.length)]);
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, description: 'Not Found' }));
});
await new Promise((resolve) => telegram.listen(0, '127.0.0.1', resolve));
const telegramBase = `http://127.0.0.1:${telegram.address().port}`;

const stacks = await startTwoStacks({
  envA: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: telegramBase },
  envB: { TELEGRAM_STICKERS_UPSTREAM: (sides) => `http://127.0.0.1:${sides.a.signal}` },
});
let lonely = null;
try {
  check('the relays say whether they can do it', stacks.a.health.telegramStickers === true && stacks.b.health.telegramStickers === true, JSON.stringify({ a: stacks.a.health.telegramStickers, b: stacks.b.health.telegramStickers }));
  const A = await openApp('TG-A', { origin: stacks.a.url, relay: stacks.a.url });
  await A.evaluate(() => { window.__notes = []; const original = window.notify; window.notify = (m, k) => { window.__notes.push(`${k}: ${m}`); return original?.(m, k); }; window.__stickerProbe.reset(); });

  const names = await A.evaluate(() => [
    'https://t.me/addstickers/PoorijaTestPack', 't.me/addstickers/PoorijaTestPack?x=1', 'tg://addstickers?set=PoorijaTestPack',
    'https://telegram.me/addstickers/PoorijaTestPack', 'PoorijaTestPack', 'https://example.com/not-a-pack', 'bad name!',
  ].map((text) => window.__stickerProbe.telegramName(text)));
  check('every form of a pack link is read for its name, and anything else is not', JSON.stringify(names) === JSON.stringify(['PoorijaTestPack', 'PoorijaTestPack', 'PoorijaTestPack', 'PoorijaTestPack', 'PoorijaTestPack', '', '']), JSON.stringify(names));

  const viaA = await A.evaluate(async () => {
    const pack = await window.__stickerProbe.importTelegram('https://t.me/addstickers/PoorijaTestPack');
    return pack ? {
      title: pack.title, source: pack.source, count: pack.stickers.length,
      kinds: pack.stickers.map((r) => r.kind), emoji: pack.stickers.map((r) => r.emoji),
      thumbs: pack.stickers.filter((r) => r.thumb instanceof Blob).length,
      stored: chatState.stickerPacks.some((p) => p.id === pack.id),
    } : null;
  });
  check('pasted into A, the pack arrives whole, with its title and emoji', viaA?.title === 'Poorija Test Pack' && viaA.count === 4 && viaA.stored && viaA.emoji.join('') === '😀😎🔥🎉', JSON.stringify(viaA));
  check('a .webp is a picture with a thumbnail, a .tgs an animation', JSON.stringify(viaA?.kinds) === JSON.stringify(['image', 'image', 'image', 'lottie']) && viaA.thumbs >= 1, JSON.stringify(viaA));

  const B = await openApp('TG-B', { origin: stacks.b.url, relay: stacks.b.url });
  const viaB = await B.evaluate(async () => {
    window.__stickerProbe.reset();
    const pack = await window.__stickerProbe.importTelegram('t.me/addstickers/PoorijaTestPack');
    return pack ? { count: pack.stickers.length, title: pack.title } : null;
  });
  check('through B, which has no token, the pack arrives by way of A', viaB?.count === 4 && viaB.title === 'Poorija Test Pack', JSON.stringify(viaB));

  const fromButton = await A.evaluate(async () => {
    window.__stickerProbe.reset();
    openSavedMessages();
    await new Promise((r) => setTimeout(r, 300));
    setStickerPanelVisible(true, { shelf: 'stickers' });
    await new Promise((r) => setTimeout(r, 300));
    const asked = [];
    PoorijaDialogs.choose = async (question, choices) => { asked.push(choices.map((c) => c.value).join(',')); return 'telegram'; };
    PoorijaDialogs.prompt = async () => 'https://t.me/addstickers/PoorijaTestPack';
    document.getElementById('chatStickerImportBtn').click();
    for (let i = 0; i < 60 && !chatState.stickerPacks.length; i += 1) await new Promise((r) => setTimeout(r, 100));
    return { offered: asked[0] || '', packs: chatState.stickerPacks.map((p) => p.title), tabs: document.querySelectorAll('#chatStickerTabs [data-chat-sticker-pack]').length };
  });
  check('the import button offers a file or a Telegram link, and the link imports', fromButton.offered === 'file,telegram' && fromButton.packs[0] === 'Poorija Test Pack' && fromButton.tabs >= 1, JSON.stringify(fromButton));

  const missing = await A.evaluate(async () => {
    window.__notes = [];
    const pack = await window.__stickerProbe.importTelegram('https://t.me/addstickers/NoSuchPackHere');
    return { pack, notes: window.__notes.slice() };
  });
  check('a pack Telegram does not have is said to be missing', missing.pack === null && missing.notes.some((n) => /no pack|پکی با این نام/i.test(n)), JSON.stringify(missing.notes));

  const guarded = await A.evaluate(async () => {
    const res = await fetch('/telegram-stickers/file?id=AAQCAgADnotFromAnyPack00000000');
    const set = await fetch('/telegram-stickers/set?name=PoorijaTestPack').then((r) => r.text());
    const health = await fetch('/chat-health').then((r) => r.text());
    return { status: res.status, setText: set, healthText: health };
  });
  check('only files out of a pack it has described are fetched', guarded.status === 409, String(guarded.status));
  check('the token appears in nothing the relay sends back', !guarded.setText.includes(TOKEN) && !guarded.healthText.includes(TOKEN) && !guarded.setText.includes('FAKE-token'), guarded.setText.slice(0, 120));

  lonely = await startTwoStacks();
  const C = await openApp('TG-C', { origin: lonely.a.url, relay: lonely.a.url });
  const notConfigured = await C.evaluate(async () => {
    window.__notes = [];
    const original = window.notify; window.notify = (m, k) => { window.__notes.push(`${k}: ${m}`); return original?.(m, k); };
    const pack = await window.__stickerProbe.importTelegram('https://t.me/addstickers/PoorijaTestPack');
    return { pack, notes: window.__notes.slice() };
  });
  check('a relay with neither a token nor an upstream says so, in words', notConfigured.pack === null && notConfigured.notes.some((n) => /TELEGRAM_BOT_TOKEN/.test(n)), JSON.stringify(notConfigured.notes));

  const errors = [...(A.__errors || []), ...(B.__errors || []), ...(C.__errors || [])];
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
  await lonely?.stop();
  telegram.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
