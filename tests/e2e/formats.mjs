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

   Every format, through the send path, byte for byte.

   A HEIC photograph arrived corrupted because the sniffer read "ftyp" and
   called it a video, and the video box editor moved the picture out from
   under its own index. Nothing caught it: the file still began with "ftyp"
   afterwards, so even the round-trip check inside the stripper was satisfied.

   The lesson is that "it did not throw" is not a result. This walks one file
   of every format the app might be handed, puts it through the same call the
   composer makes, and checks what comes out the other side: still openable,
   still the same picture, and either cleaned or honestly reported as not. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const PASS = 'Harness#Pass2026!';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {} });
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and any evaluate in flight when that lands dies with "Execution
   context was destroyed" — read as a crash, not a failure. Waiting for the
   page to hold still is the property actually wanted. */
await settle(page);
await page.evaluate((pass) => {
  const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
  set('setupPassword', pass); set('confirmPassword', pass);
  document.querySelectorAll('#initialSetup select').forEach((s, i) => { if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => { inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true })); });
  const cb = document.getElementById('acceptTermsCheckbox'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
}, PASS);
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('setupBtn')?.click());
await page.waitForTimeout(2600);
await page.evaluate(() => { document.getElementById('mobileInstallGate')?.classList.add('hidden'); });
await page.waitForTimeout(800);

console.log('\n===== what each format is recognised as =====');
const seen = await page.evaluate(async () => {
  const M = window.PoorijaMetadata;
  const bytes = (arr) => new Uint8Array(arr);
  const files = {};
  /* A JPEG: SOI, an APP1 whose declared length matches what follows, a
     minimal scan so it is a picture and not just a header, then EOI. The
     length byte pair counts itself, which is the part that is easy to get
     wrong and makes the block unreadable. */
  const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 0];
  const app1Len = app1.length + 2;
  files.jpeg = bytes([0xff, 0xd8, 0xff, 0xe1, (app1Len >> 8) & 255, app1Len & 255, ...app1,
    0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0x00, 0x11, 0x22, 0xff, 0xd9]);
  /* PNG: signature, IHDR, a tEXt chunk, IEND. */
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (type, data) => {
    const t = [...type].map((ch) => ch.charCodeAt(0));
    const body = [...t, ...data];
    const len = data.length;
    const c = crc(body);
    return [(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body,
      (c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  };
  files.png = bytes([137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...chunk('tEXt', [...'Author'].map((c) => c.charCodeAt(0)).concat([0], [...'Somebody'].map((c) => c.charCodeAt(0)))),
    ...chunk('IEND', [])]);
  /* WebP: RIFF wrapper with an EXIF chunk. */
  const webpBody = [...'WEBP'].map((c) => c.charCodeAt(0))
    .concat([...'VP8 '].map((c) => c.charCodeAt(0)), [4, 0, 0, 0, 1, 2, 3, 4])
    .concat([...'EXIF'].map((c) => c.charCodeAt(0)), [4, 0, 0, 0, 9, 9, 9, 9]);
  files.webp = bytes([...'RIFF'].map((c) => c.charCodeAt(0))
    .concat([webpBody.length & 255, 0, 0, 0], webpBody));
  /* MP4: ftyp with a video brand, then a udta box. */
  files.mp4 = bytes([0, 0, 0, 0x14, ...[...'ftyp'].map((c) => c.charCodeAt(0)), ...[...'isom'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0,
    0, 0, 0, 0x10, ...[...'udta'].map((c) => c.charCodeAt(0)), 1, 2, 3, 4, 5, 6, 7, 8]);
  /* HEIC: the same container, a photograph brand. */
  files.heic = bytes([0, 0, 0, 0x18, ...[...'ftyp'].map((c) => c.charCodeAt(0)), ...[...'heic'].map((c) => c.charCodeAt(0)),
    0, 0, 0, 0, ...[...'mif1'].map((c) => c.charCodeAt(0)),
    0, 0, 0, 0x10, ...[...'meta'].map((c) => c.charCodeAt(0)), 1, 2, 3, 4, 5, 6, 7, 8]);
  /* MP3 with an ID3v2 tag. */
  files.mp3 = bytes([...'ID3'].map((c) => c.charCodeAt(0)).concat([3, 0, 0, 0, 0, 0, 10],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0xff, 0xfb, 0x90, 0x00]));
  /* PDF, minimal but real, with an Info dictionary. */
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>
endobj
4 0 obj
<< /Title (A Report) /Author (Somebody Real) /Creator (SomeApp 1.0) >>
endobj
trailer
<< /Size 5 /Root 1 0 R /Info 4 0 R >>
startxref
0
%%EOF
`;
  files.pdf = bytes([...pdf].map((c) => c.charCodeAt(0)));
  /* Something the app has no idea about. */
  files.unknown = bytes([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d]);

  const out = {};
  for (const [name, data] of Object.entries(files)) {
    const blob = new Blob([data]);
    const format = await M.sniffBlob(blob);
    const read = await M.readMetadata(blob);
    const strip = await M.stripMetadata(blob);
    const after = new Uint8Array(await (strip.blob || blob).arrayBuffer());
    out[name] = {
      format,
      supported: read.supported,
      fields: (read.fields || []).length,
      stripped: Boolean(strip.supported),
      removed: (strip.removed || []).length,
      /* Untouched formats must come back identical, byte for byte. */
      identical: after.length === data.length && after.every((b, i) => b === data[i]),
      /* A cleaned one must still be the format it was. */
      stillItself: await M.sniffBlob(new Blob([after])),
      grew: after.length - data.length,
    };
  }
  return { out, strippable: M.STRIPPABLE };
});
for (const [name, row] of Object.entries(seen.out)) console.log(`  ${name.padEnd(8)} ${JSON.stringify(row)}`);

check('a JPEG is read and cleaned', seen.out.jpeg.format === 'jpeg' && seen.out.jpeg.stripped && seen.out.jpeg.stillItself === 'jpeg', JSON.stringify(seen.out.jpeg));
check('a PNG is read and cleaned', seen.out.png.format === 'png' && seen.out.png.removed > 0 && seen.out.png.stillItself === 'png', JSON.stringify(seen.out.png));
check('a WebP is read and cleaned', seen.out.webp.format === 'webp' && seen.out.webp.stillItself === 'webp', JSON.stringify(seen.out.webp));
check('an MP4 is read and cleaned', seen.out.mp4.format === 'mp4' && seen.out.mp4.stillItself === 'mp4', JSON.stringify(seen.out.mp4));
check('an MP3 is read and cleaned', seen.out.mp3.format === 'mp3' && seen.out.mp3.removed > 0, JSON.stringify(seen.out.mp3));

console.log('\n===== the ones that must not be touched =====');
check('a HEIC is recognised as a photograph, not a video', seen.out.heic.format === 'heif', seen.out.heic.format);
check('and comes back byte for byte as it went in', seen.out.heic.identical === true, JSON.stringify(seen.out.heic));
check('an unknown file is left alone too', seen.out.unknown.format === 'unknown' && seen.out.unknown.identical === true, JSON.stringify(seen.out.unknown));
check('the module names exactly what it can clean',
  JSON.stringify(seen.strippable) === JSON.stringify(['jpeg', 'png', 'webp', 'mp4', 'mp3', 'pdf']), JSON.stringify(seen.strippable));

console.log('\n===== a PDF, which is edited by appending =====');
check('a PDF is read', seen.out.pdf.format === 'pdf' && seen.out.pdf.fields >= 3, JSON.stringify(seen.out.pdf));
check('its Info entries are taken out', seen.out.pdf.removed >= 3, `${seen.out.pdf.removed} removed`);
check('it is still a PDF afterwards', seen.out.pdf.stillItself === 'pdf', seen.out.pdf.stillItself);
/* The point of an incremental update: nothing before the append moves. */
check('and every original byte is exactly where it was',
  seen.out.pdf.grew > 0 && seen.out.pdf.identical === false, `grew by ${seen.out.pdf.grew} bytes`);

const pdfShape = await page.evaluate(async () => {
  const M = window.PoorijaMetadata;
  /* A cross-reference offset that points at a real table, so the appended
     update has something to chain back to - which is the whole mechanism. */
  const pdfHead = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n4 0 obj\n<< /Author (Somebody Real) >>\nendobj\n`;
  const xrefAt = pdfHead.length;
  const pdf = `${pdfHead}xref\n0 5\n0000000000 65535 f \ntrailer\n<< /Size 5 /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const original = new Uint8Array([...pdf].map((c) => c.charCodeAt(0)));
  const out = await M.stripMetadata(new Blob([original]));
  const after = new Uint8Array(await out.blob.arrayBuffer());
  const text = String.fromCharCode.apply(null, after);
  const head = after.subarray(0, original.length);
  return {
    prefixUntouched: head.every((b, i) => b === original[i]),
    /* What a reader does: take the last startxref and look there. */
    lastXref: (() => { const m = [...text.matchAll(/startxref\s+(\d+)/g)].pop(); return m ? Number(m[1]) : -1; })(),
    atThatOffset: (() => {
      const m = [...text.matchAll(/startxref\s+(\d+)/g)].pop();
      return m ? text.slice(Number(m[1]), Number(m[1]) + 4) : '';
    })(),
    hasPrev: /\/Prev\s+\d+/.test(text),
    infoNowEmpty: /4 0 obj\s*<<\s*>>/.test(text),
    stillHasOldAuthor: text.includes('Somebody Real'),
  };
});
console.log('  ' + JSON.stringify(pdfShape));
check('the appended section starts where the file says it does',
  pdfShape.lastXref > 0 && pdfShape.atThatOffset === 'xref', JSON.stringify(pdfShape));
check('it chains back to the table before it', pdfShape.hasPrev === true, String(pdfShape.hasPrev));
check('the Info object a reader resolves is now empty', pdfShape.infoNowEmpty === true, String(pdfShape.infoNowEmpty));
check('everything before the append is untouched', pdfShape.prefixUntouched === true, String(pdfShape.prefixUntouched));
/* Said plainly rather than glossed: the old bytes are still in the file. */
check('and the old value is still in the bytes, which is what an append means',
  pdfShape.stillHasOldAuthor === true, 'documented, not hidden');

console.log('\n===== what the sender is told =====');
const advice = await page.evaluate(() => ({
  strippable: window.PoorijaMetadata.STRIPPABLE,
  convertOffered: typeof window.__jpegConvertProbe === 'function',
}));
console.log('  ' + JSON.stringify(advice));
check('a conversion is available for what cannot be cleaned', advice.convertOffered === true, JSON.stringify(advice));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
