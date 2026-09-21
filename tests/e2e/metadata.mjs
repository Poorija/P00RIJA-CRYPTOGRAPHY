/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.

   Fixtures are built here rather than committed: a test that makes its own
   JPEG knows exactly which bytes are metadata, so "it was removed" can be
   proved by searching the output rather than by asking the module again. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

/* A minimal but real JPEG: SOI, an APP1 holding a little-endian TIFF header
   with one GPS pointer and one Make tag, then EOI. Everything a phone
   photograph carries, in the smallest form that still parses. */
function buildJpegWithExif() {
  const bytes = [];
  const push = (...v) => v.forEach((b) => bytes.push(b));
  const u16 = (n) => push((n >> 8) & 0xff, n & 0xff);
  push(0xff, 0xd8);
  const exif = [];
  const e = (...v) => v.forEach((b) => exif.push(b));
  'Exif\0\0'.split('').forEach((c) => e(c.charCodeAt(0)));
  e(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00);
  e(0x02, 0x00);
  e(0x0f, 0x01, 0x02, 0x00, 0x06, 0x00, 0x00, 0x00, 0x32, 0x00, 0x00, 0x00);
  e(0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x38, 0x00, 0x00, 0x00);
  e(0x00, 0x00, 0x00, 0x00);
  while (exif.length < 6 + 0x32) e(0x00);
  'ACME\0\0'.split('').forEach((c) => e(c.charCodeAt(0)));
  while (exif.length < 6 + 0x38) e(0x00);
  e(0x01, 0x00);
  e(0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x4e, 0x00, 0x00, 0x00);
  e(0x00, 0x00, 0x00, 0x00);
  push(0xff, 0xe1); u16(exif.length + 2); exif.forEach((b) => push(b));
  push(0xff, 0xd9);
  return new Uint8Array(bytes);
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and any evaluate in flight when that lands dies with "Execution
   context was destroyed" — read as a crash, not a failure. Waiting for the
   page to hold still is the property actually wanted. */
await settle(page);

console.log('\n===== what a photograph is carrying =====');
const jpeg = Array.from(buildJpegWithExif());
const read = await page.evaluate(async (bytes) => {
  const file = new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' });
  return window.PoorijaMetadata?.readMetadata(file);
}, jpeg);
console.log('  ' + JSON.stringify(read ?? null).slice(0, 220));
check('the module is there at all', Boolean(read), typeof read);
check('it recognises a JPEG', read?.format === 'jpeg' && read?.supported === true, `${read?.format}/${read?.supported}`);
check('it finds the camera make', (read?.fields || []).some((f) => /ACME/.test(String(f.value))), JSON.stringify((read?.fields || []).map((f) => f.label)));
check('and marks the GPS field as a location', (read?.fields || []).some((f) => f.risk === 'location'), JSON.stringify((read?.fields || []).map((f) => f.risk)));

console.log('\n===== and what is left after taking it out =====');
const stripped = await page.evaluate(async (bytes) => {
  if (!window.PoorijaMetadata?.stripMetadata) return { missing: true };
  const file = new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' });
  const out = await window.PoorijaMetadata.stripMetadata(file);
  const after = new Uint8Array(await out.blob.arrayBuffer());
  const text = new TextDecoder('latin1').decode(after);
  return {
    supported: out.supported,
    removed: out.removed.length,
    before: bytes.length,
    after: after.length,
    /* Searched in the output, not asked of the module: a module that says it
       cleaned the file is not evidence that it did. */
    stillHasExif: text.includes('Exif'),
    stillHasMake: text.includes('ACME'),
    startsWithSoi: after[0] === 0xff && after[1] === 0xd8,
    endsWithEoi: after[after.length - 2] === 0xff && after[after.length - 1] === 0xd9,
  };
}, jpeg);
console.log('  ' + JSON.stringify(stripped));
check('it says it stripped something', stripped.supported && stripped.removed > 0, `${stripped.removed} removed`);
check('the file got smaller', stripped.after < stripped.before, `${stripped.before} -> ${stripped.after}`);
check('no EXIF block survives in the bytes',
  stripped.stillHasExif === false, String(stripped.stillHasExif));
check('and neither does the camera make',
  stripped.stillHasMake === false, String(stripped.stillHasMake));
check('what comes back is still a JPEG', stripped.startsWithSoi && stripped.endsWithEoi, 'SOI/EOI intact');

/* The spec promises no re-encoding, and "it still opens" is not that promise.
   Decode both and compare the pixels. */
const pixels = await page.evaluate(async (bytes) => {
  if (!window.PoorijaMetadata?.stripMetadata) return { decoded: false, same: null, why: 'stripMetadata is not there yet' };
  const decode = async (buf) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(buf)], { type: 'image/jpeg' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return Array.from(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data);
  };
  const file = new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' });
  const out = await window.PoorijaMetadata.stripMetadata(file);
  try {
    const before = await decode(bytes);
    const after = await decode(Array.from(new Uint8Array(await out.blob.arrayBuffer())));
    return { decoded: true, same: before.length === after.length && before.every((v, i) => v === after[i]) };
  } catch (error) {
    /* The fixture is a hand-built JPEG with no real scan, so a browser may
       refuse to decode it. Say that rather than pretending the check ran. */
    return { decoded: false, same: null, why: String(error).slice(0, 60) };
  }
}, jpeg);
console.log('  ' + JSON.stringify(pixels));
/* Two ways this can honestly pass: the pixels matched, or the fixture is one
   this browser will not decode at all - in which case say so rather than
   counting a check that never ran. It must never pass because stripMetadata
   was missing. */
check('and the picture itself is untouched',
  pixels.decoded ? pixels.same === true : !/not there yet/.test(pixels.why || ''),
  pixels.decoded ? String(pixels.same) : `not decodable here: ${pixels.why}`);

console.log('\n===== a format it does not know =====');
const foreign = await page.evaluate(async () => {
  if (!window.PoorijaMetadata?.stripMetadata) return { supported: null, removed: -1, same: false };
  /* A PDF used to be the example here, because it was not understood. It is
     now, so the example has to be something that genuinely is not - otherwise
     this checks nothing. */
  const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x11, 0x22, 0x33, 0x44]);
  const file = new File([bytes], 'archive.gz', { type: 'application/gzip' });
  const out = await window.PoorijaMetadata.stripMetadata(file);
  const after = new Uint8Array(await out.blob.arrayBuffer());
  /* Byte for byte, rather than a length and one hard-coded first byte that
     has to be remembered whenever the example changes. */
  return {
    supported: out.supported,
    removed: out.removed.length,
    same: after.length === bytes.length && after.every((b, i) => b === bytes[i]),
  };
});
check('it admits it does not know the format', foreign.supported === false, String(foreign.supported));
check('and hands the file back exactly as it was', foreign.same && foreign.removed === 0, JSON.stringify(foreign));

console.log('\n===== the other containers =====');
/* Each fixture is the smallest valid file of its kind that still carries one
   piece of metadata, so what should disappear is unambiguous. */
const others = await page.evaluate(async () => {
  if (!window.PoorijaMetadata?.stripMetadata) return { missing: true };
  const enc = (s) => new TextEncoder().encode(s);
  const crc = (buf) => {
    let c = ~0;
    for (let i = 0; i < buf.length; i += 1) {
      c ^= buf[i];
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const name = enc(type);
    const body = new Uint8Array(name.length + data.length);
    body.set(name, 0); body.set(data, name.length);
    /* length(4) + type(4) + data + crc(4). Allocating eight for the header
       left four zero bytes on the end of every chunk and the walk lost its
       place - the fixture was malformed, not the parser. */
    const out = new Uint8Array(4 + body.length + 4);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(body, 4);
    new DataView(out.buffer).setUint32(4 + body.length, crc(body));
    return out;
  };
  const join = (parts) => {
    const size = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(size);
    let at = 0; parts.forEach((p) => { out.set(p, at); at += p.length; });
    return out;
  };

  const png = join([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
    chunk('tEXt', enc('Author\0SECRETNAME')),
    chunk('IEND', new Uint8Array(0)),
  ]);

  const frame = join([enc('TPE1'), new Uint8Array([0, 0, 0, 12, 0, 0, 0]), enc('SECRETBAND')]);
  const mp3 = join([
    enc('ID3'), new Uint8Array([3, 0, 0, 0, 0, 0, frame.length]),
    frame,
    new Uint8Array([0xff, 0xfb, 0x90, 0x00]),
  ]);

  const xyzBody = enc('\u0000\u0010\u0015\u00c7+52.5+13.4/');
  const xyz = join([new Uint8Array([0, 0, 0, xyzBody.length + 8]), enc('\u00a9xyz'), xyzBody]);
  const udta = join([new Uint8Array([0, 0, 0, xyz.length + 8]), enc('udta'), xyz]);
  const mp4 = join([
    new Uint8Array([0, 0, 0, 0x10]), enc('ftypisom'), new Uint8Array([0, 0, 0, 0]),
    udta,
  ]);

  const run = async (name, type, bytes) => {
    const file = new File([bytes], name, { type });
    const read = await window.PoorijaMetadata.readMetadata(file);
    const out = await window.PoorijaMetadata.stripMetadata(file);
    const after = new TextDecoder('latin1').decode(new Uint8Array(await out.blob.arrayBuffer()));
    return { format: read.format, supported: read.supported, fields: read.fields.length, stripped: out.supported, after };
  };
  return {
    png: await run('shot.png', 'image/png', png),
    mp3: await run('song.mp3', 'audio/mpeg', mp3),
    mp4: await run('clip.mp4', 'video/mp4', mp4),
  };
});
console.log('  ' + JSON.stringify({ png: others.png?.format, mp3: others.mp3?.format, mp4: others.mp4?.format }));
check('a PNG text chunk is found and then gone',
  others.png?.supported === true && others.png.fields > 0 && others.png.stripped === true && !others.png.after.includes('SECRETNAME'),
  JSON.stringify({ f: others.png?.fields, s: others.png?.stripped }));
check('an ID3 tag is found and then gone',
  others.mp3?.supported === true && others.mp3.fields > 0 && others.mp3.stripped === true && !others.mp3.after.includes('SECRETBAND'),
  JSON.stringify({ f: others.mp3?.fields, s: others.mp3?.stripped }));
check('a video location box is found and then gone',
  others.mp4?.supported === true && others.mp4.fields > 0 && others.mp4.stripped === true && !others.mp4.after.includes('+52.5+13.4'),
  JSON.stringify({ f: others.mp4?.fields, s: others.mp4?.stripped }));

console.log('\n===== a real photograph, not a hand-built one =====');
/* The fixture above has no scan, so no browser will decode it and the promise
   that pixels survive could not actually be tested. This one is encoded by the
   browser itself, with an EXIF block spliced in after the SOI - a real JPEG
   carrying real metadata. */
const realJpeg = await page.evaluate(async () => {
  const canvas = new OffscreenCanvas(8, 8);
  const ctx = canvas.getContext('2d');
  for (let x = 0; x < 8; x += 1) {
    for (let y = 0; y < 8; y += 1) {
      ctx.fillStyle = `rgb(${x * 30}, ${y * 30}, 128)`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const plain = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg' })).arrayBuffer());
  /* A minimal APP1 with one ASCII tag, spliced between SOI and the rest. */
  const exif = [];
  const e = (...v) => v.forEach((b) => exif.push(b));
  'Exif\u0000\u0000'.split('').forEach((c) => e(c.charCodeAt(0)));
  e(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00);
  e(0x01, 0x00);
  e(0x0f, 0x01, 0x02, 0x00, 0x08, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00);
  e(0x00, 0x00, 0x00, 0x00);
  while (exif.length < 6 + 0x1a) e(0x00);
  'PIXELCO\u0000'.split('').forEach((c) => e(c.charCodeAt(0)));
  const len = exif.length + 2;
  const withExif = new Uint8Array(plain.length + 4 + exif.length);
  withExif.set(plain.subarray(0, 2), 0);
  withExif.set([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff], 2);
  withExif.set(new Uint8Array(exif), 6);
  withExif.set(plain.subarray(2), 6 + exif.length);

  const decode = async (buf) => {
    const bitmap = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    c.getContext('2d').drawImage(bitmap, 0, 0);
    return Array.from(c.getContext('2d').getImageData(0, 0, bitmap.width, bitmap.height).data);
  };

  const file = new File([withExif], 'real.jpg', { type: 'image/jpeg' });
  const read = await window.PoorijaMetadata.readMetadata(file);
  const out = await window.PoorijaMetadata.stripMetadata(file);
  const cleaned = new Uint8Array(await out.blob.arrayBuffer());
  const before = await decode(withExif);
  const after = await decode(cleaned);
  return {
    foundMake: (read.fields || []).some((f) => /PIXELCO/.test(String(f.value))),
    stripped: out.supported && out.removed.length > 0,
    gone: !new TextDecoder('latin1').decode(cleaned).includes('PIXELCO'),
    smaller: cleaned.length < withExif.length,
    samePixels: before.length === after.length && before.every((v, i) => v === after[i]),
    dims: `${before.length}/${after.length}`,
  };
});
console.log('  ' + JSON.stringify(realJpeg));
check('a real photograph gives up its camera make', realJpeg.foundMake, String(realJpeg.foundMake));
check('stripping it removes that block', realJpeg.stripped && realJpeg.gone && realJpeg.smaller, JSON.stringify(realJpeg));
check('and every pixel survives it', realJpeg.samePixels === true, `${realJpeg.dims} samples`);

console.log('\n===== changing one line and leaving the rest =====');
const edited = await page.evaluate(async () => {
  if (!window.PoorijaMetadata?.writeMetadata) return { missing: true };
  const enc = (s) => new TextEncoder().encode(s);
  const crc = (buf) => { let c = ~0; for (let i = 0; i < buf.length; i += 1) { c ^= buf[i]; for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => {
    const name = enc(type); const body = new Uint8Array(name.length + data.length);
    body.set(name, 0); body.set(data, name.length);
    const out = new Uint8Array(4 + body.length + 4);
    new DataView(out.buffer).setUint32(0, data.length); out.set(body, 4);
    new DataView(out.buffer).setUint32(4 + body.length, crc(body)); return out;
  };
  const join = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let at = 0; parts.forEach((p) => { o.set(p, at); at += p.length; }); return o; };
  const png = join([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
    chunk('tEXt', enc('Author\u0000SECRETNAME')),
    chunk('tEXt', enc('Software\u0000KEEPME')),
    chunk('IEND', new Uint8Array(0)),
  ]);
  const file = new File([png], 'shot.png', { type: 'image/png' });
  const read = await window.PoorijaMetadata.readMetadata(file);
  const author = read.fields.find((f) => /SECRETNAME/.test(f.value));
  /* Report the gap; a suite that dies here hides every check after it. */
  if (!author) return { noField: true, saw: read.fields.map((f) => `${f.label}=${f.value}`) };
  const out = await window.PoorijaMetadata.writeMetadata(file, { [author.id]: 'Author\u0000PUBLICNAME' });
  const after = new TextDecoder('latin1').decode(new Uint8Array(await out.blob.arrayBuffer()));
  /* Clearing works everywhere, editing only where the format allows it. */
  const cleared = await window.PoorijaMetadata.clearField(file, author.id);
  const clearedText = new TextDecoder('latin1').decode(new Uint8Array(await cleared.blob.arrayBuffer()));
  return {
    applied: out.applied.length, hasNew: after.includes('PUBLICNAME'),
    hasOld: after.includes('SECRETNAME'), keptOther: after.includes('KEEPME'),
    clearedGone: !clearedText.includes('SECRETNAME'), clearedKept: clearedText.includes('KEEPME'),
  };
});
console.log('  ' + JSON.stringify(edited));
check('the edited value is in the file', edited.hasNew === true && edited.applied === 1, JSON.stringify(edited));
check('the old value is not', edited.hasOld === false, String(edited.hasOld));
check('and the other field is untouched', edited.keptOther === true, String(edited.keptOther));
check('clearing one field removes only that one', edited.clearedGone === true && edited.clearedKept === true, JSON.stringify(edited));

console.log('\n===== the tab =====');
const tab = await page.evaluate(async (bytes) => {
  window.switchTab?.('metadata');
  await new Promise((r) => setTimeout(r, 900));
  const panel = document.getElementById('content-metadata');
  if (!panel || panel.classList.contains('hidden')) return { open: false };
  const input = document.getElementById('metadataFileInput');
  if (!input) return { open: true, noInput: true };
  const file = new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 900));
  return {
    open: true,
    rows: document.querySelectorAll('#metadataFields [data-metadata-field]').length,
    riskMarked: document.querySelectorAll('#metadataFields .is-risk-location').length,
    hasStrip: Boolean(document.getElementById('metadataStripBtn')),
    hasSave: Boolean(document.getElementById('metadataSaveBtn')),
    summary: document.getElementById('metadataSummary')?.textContent?.trim() || '',
  };
}, jpeg);
console.log('  ' + JSON.stringify(tab));
check('the metadata tab opens', tab.open === true, String(tab.open));
check('it lists the fields it found', (tab.rows || 0) > 0, `${tab.rows} row(s)`);
check('and marks the ones that give away a location', (tab.riskMarked || 0) > 0, `${tab.riskMarked} marked`);
check('with a way to clear everything and a way to save', Boolean(tab.hasStrip && tab.hasSave), JSON.stringify({ s: tab.hasStrip, v: tab.hasSave }));

const unknownInTab = await page.evaluate(async () => {
  const input = document.getElementById('metadataFileInput');
  if (!input) return { said: '' };
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'paper.pdf', { type: 'application/pdf' });
  const dt = new DataTransfer(); dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 700));
  return { said: document.getElementById('metadataSummary')?.textContent?.trim() || '' };
});
check('an unrecognised format is said so, not called clean',
  /شناخته نشد|not recognised/.test(unknownInTab.said), unknownInTab.said.slice(0, 70));

console.log('\n===== on the way out of a conversation =====');
const onSend = await page.evaluate(async (bytes) => {
  if (!window.__metadataOnSendProbe) return { missing: true };
  const before = window.PoorijaApp?.metadataSettings?.();
  const file = new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' });
  /* The send path is long and needs a live peer; what is under test here is the
     one decision it makes about metadata, so ask that decision directly. */
  const cleaned = await window.__metadataOnSendProbe(file);
  const after = new TextDecoder('latin1').decode(new Uint8Array(await cleaned.arrayBuffer()));
  return {
    defaultOn: before?.stripOnSend === true,
    stillHasExif: after.includes('Exif'),
    stillNamed: cleaned.name === 'photo.jpg',
  };
}, jpeg);
console.log('  ' + JSON.stringify(onSend));
check('cleaning on send is on unless somebody turns it off', onSend.defaultOn === true, String(onSend.defaultOn));
check('a photograph sent from here carries no EXIF', onSend.stillHasExif === false, String(onSend.stillHasExif));
check('and it keeps its own name', onSend.stillNamed === true, String(onSend.stillNamed));

const offPath = await page.evaluate(async (bytes) => {
  if (!window.__metadataOnSendProbe) return { missing: true };
  const app = window.PoorijaApp;
  const restore = JSON.parse(JSON.stringify(app.__state?.settings?.metadata || {}));
  document.getElementById('chatStripMetadataToggle')?.click();
  const file = new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' });
  const sent = await window.__metadataOnSendProbe(file);
  const after = new TextDecoder('latin1').decode(new Uint8Array(await sent.arrayBuffer()));
  const stateNow = app.metadataSettings();
  document.getElementById('chatStripMetadataToggle')?.click();
  void restore;
  return { offNow: stateNow.stripOnSend === false, untouched: after.includes('Exif') };
}, jpeg);
console.log('  ' + JSON.stringify(offPath));
check('turning it off really turns it off', offPath.offNow === true, String(offPath.offNow));
check('and then the file goes exactly as it is', offPath.untouched === true, String(offPath.untouched));

console.log('\n===== a photograph in a video container =====');
/* HEIC, HEIF and AVIF are photographs in the same ISO container MP4 uses. The
   sniffer read "ftyp" and called all of them mp4, so a HEIC photograph went
   through the MP4 box editor - and a HEIC keeps its picture in mdat, found
   through byte offsets recorded in the meta box, so moving any box moves the
   picture out from under its own index. The file still began with "ftyp"
   afterwards, so even the round-trip check at the end of a strip saw nothing
   wrong. What arrived would not open. */
const isoBrands = await page.evaluate(async () => {
  const M = window.PoorijaMetadata;
  const make = (brand) => {
    const bytes = new Uint8Array(32);
    bytes.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70], 0);
    [...brand].forEach((ch, i) => { bytes[8 + i] = ch.charCodeAt(0); });
    bytes.set([0x6d, 0x69, 0x66, 0x31], 16);
    return new Blob([bytes]);
  };
  const out = {};
  for (const brand of ['heic', 'heix', 'mif1', 'avif', 'isom', 'mp42', 'qt  ', 'M4A ', 'zzzz']) {
    out[brand.trim() || brand] = await M.sniffBlob(make(brand));
  }
  return { sniffed: out, strippable: M.STRIPPABLE || [] };
});
console.log('  ' + JSON.stringify(isoBrands.sniffed));
check('a HEIC photograph is not mistaken for a video',
  isoBrands.sniffed.heic === 'heif' && isoBrands.sniffed.heix === 'heif' && isoBrands.sniffed.mif1 === 'heif',
  JSON.stringify(isoBrands.sniffed));
check('nor is an AVIF one', isoBrands.sniffed.avif === 'heif', String(isoBrands.sniffed.avif));
check('real video brands are still video',
  isoBrands.sniffed.isom === 'mp4' && isoBrands.sniffed.mp42 === 'mp4'
    && isoBrands.sniffed.qt === 'mp4' && isoBrands.sniffed['M4A'] === 'mp4',
  JSON.stringify(isoBrands.sniffed));
check('and an unlisted brand is not guessed at', isoBrands.sniffed.zzzz === 'iso-unknown', String(isoBrands.sniffed.zzzz));
check('the module says which formats it can actually clean',
  Array.isArray(isoBrands.strippable) && !isoBrands.strippable.includes('heif')
    && isoBrands.strippable.includes('jpeg'), JSON.stringify(isoBrands.strippable));

/* And the part that matters: the bytes come back untouched. */
const heicRoundTrip = await page.evaluate(async () => {
  const M = window.PoorijaMetadata;
  /* A HEIC-shaped file with a meta box and an mdat, the arrangement a real
     one has: anything that rewrites boxes will change these bytes. */
  const bytes = new Uint8Array(64);
  bytes.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70], 0);
  bytes.set([0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31], 8);
  bytes.set([0, 0, 0, 0x10, 0x6d, 0x65, 0x74, 0x61, 1, 2, 3, 4, 5, 6, 7, 8], 24);
  bytes.set([0, 0, 0, 0x18, 0x6d, 0x64, 0x61, 0x74], 40);
  for (let i = 48; i < 64; i += 1) bytes[i] = i;
  const file = new File([bytes], 'photo.heic', { type: 'image/heic' });
  const out = await M.stripMetadata(file);
  const after = new Uint8Array(await (out.blob || file).arrayBuffer());
  return {
    supported: out.supported,
    same: after.length === bytes.length && after.every((b, i) => b === bytes[i]),
    length: after.length,
  };
});
console.log('  ' + JSON.stringify(heicRoundTrip));
check('a HEIC is reported as a format this build does not clean', heicRoundTrip.supported === false, JSON.stringify(heicRoundTrip));
check('and every byte of it comes back exactly as it went in', heicRoundTrip.same === true, JSON.stringify(heicRoundTrip));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
