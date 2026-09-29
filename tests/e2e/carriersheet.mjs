/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* "Send another way", driven the way a person drives it.
 *
 * tests/e2e/carrier.mjs already tests the cryptography and the stego wire
 * format, and it passed the whole time the feature was unusable — because it
 * calls the functions and never touches the interface. What was wrong was one
 * thing the functions cannot see: the sheet was placed inside #linkRoom, inside
 * #content-locallink, inside #content-chat, and all three are display:none while
 * somebody is reading a conversation. position:fixed does not escape a hidden
 * ancestor, so the sheet opened, computed to display:flex at full opacity, and
 * measured zero by zero. The button worked. Nothing appeared.
 *
 * So this suite asks the questions a unit test cannot: is it on screen, is it
 * big enough to use, and does a message put in one end come out of the other.
 */

import { openApp, browser, identity, importIdentity, openFirstChat, waitFor, tmp } from './_chat-harness.mjs';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const APP = process.env.PKG_URL || 'https://chat.example.com:8585';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);

/* A photograph with enough room in it.
 *
 * A real PNG, written here rather than committed as a fixture. It has to be a
 * format the BROWSER can decode: the sheet measures the room by decoding the
 * image and counting DCT coefficients, so a PPM -- which nothing in a browser
 * reads -- leaves the room unmeasured and the button disabled, which is a fault
 * in the test and looks exactly like a fault in the feature.
 *
 * Noise rather than a flat colour, at a size somebody would actually send: small
 * images hold almost nothing once the wrapped key is paid for, and flat areas are
 * the worst case for DCT. */
function makePhoto(file, width = 900, height = 700) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    raw[at] = 0; at += 1;               // filter type 0 for this scanline
    for (let x = 0; x < width * 3; x += 1) {
      raw[at] = (x * 2654435761 + y * 40503) % 251;
      at += 1;
    }
  }
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const head = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(head) : crc32(head));
    return Buffer.concat([length, head, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // truecolour
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
  return file;
}

/* Node did not always expose zlib.crc32. */
function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

try {
  const a = await openApp('carrier-sender', { origin: APP, relay: APP });
  const b = await openApp('carrier-reader', { origin: APP, relay: APP });
  await importIdentity(a, await identity(b));
  await importIdentity(b, await identity(a));
  await a.waitForTimeout(3500);
  await openFirstChat(a);
  await openFirstChat(b);
  await a.waitForTimeout(1000);

  section('the sheet is on screen, not merely unhidden');
  await a.evaluate(() => document.getElementById('chatCarrierBtn')?.click());
  await a.waitForTimeout(900);
  const shown = await a.evaluate(() => {
    const sheet = document.getElementById('chatCarrierSheet');
    const panel = document.querySelector('.chat-carrier-panel');
    const style = sheet ? getComputedStyle(sheet) : null;
    const rect = sheet?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    return {
      display: style?.display || '',
      opacity: Number(style?.opacity || 0),
      width: Math.round(rect?.width || 0),
      height: Math.round(rect?.height || 0),
      panelWidth: Math.round(panelRect?.width || 0),
      panelHeight: Math.round(panelRect?.height || 0),
      /* The one thing the old placement failed, and the only one that a
         display/opacity check would have passed anyway. */
      reachable: Boolean(sheet?.offsetParent) || style?.position === 'fixed',
    };
  });
  check('clicking the composer entry opens it', shown.display === 'flex' && shown.opacity > 0, JSON.stringify(shown));
  check('and it actually covers the screen rather than measuring nothing',
    shown.width > 200 && shown.height > 200, `${shown.width}x${shown.height}`);
  check('the panel inside it has a usable size',
    shown.panelWidth > 150 && shown.panelHeight > 150, `${shown.panelWidth}x${shown.panelHeight}`);
  const fields = await a.evaluate(() => ({
    forWhom: (document.getElementById('chatCarrierPeerName')?.textContent || '').trim(),
    text: Boolean(document.getElementById('chatCarrierText')),
    pick: Boolean(document.getElementById('chatCarrierPickBtn')),
    make: document.getElementById('chatCarrierMakeBtn')?.disabled,
    room: (document.getElementById('chatCarrierRoom')?.textContent || '').trim(),
  }));
  check('it says who the photo is for', fields.forWhom.length > 0 && fields.forWhom !== '—', fields.forWhom);
  check('and refuses to make one before a photo is chosen', fields.make === true, JSON.stringify(fields));

  section('a message goes into a photograph');
  const secret = `carrier round trip ${Date.now()}`;
  const source = makePhoto(path.join(tmp, 'carrier-source.png'));
  await a.evaluate((body) => {
    const field = document.getElementById('chatCarrierText');
    field.value = body;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, secret);
  await a.setInputFiles('#chatCarrierImageInput', source);
  const roomKnown = await waitFor(a, () => {
    const label = (document.getElementById('chatCarrierRoom')?.textContent || '');
    return /\d/.test(label) && !document.getElementById('chatCarrierMakeBtn')?.disabled;
  }, { timeoutMs: 30000 });
  check('choosing a photo measures the room in it and enables the button', roomKnown === true,
    await a.evaluate(() => (document.getElementById('chatCarrierRoom')?.textContent || '').trim()));

  /* The download is what a person gets, so that is what is captured. */
  const download = a.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await a.evaluate(() => document.getElementById('chatCarrierMakeBtn')?.click());
  const saved = await download;
  check('making the photo produces a file to send', Boolean(saved), saved ? await saved.suggestedFilename() : '(no download)');

  let carrierFile = '';
  if (saved) {
    carrierFile = path.join(tmp, 'carrier-out.jpg');
    await saved.saveAs(carrierFile);
    const bytes = fs.statSync(carrierFile).size;
    check('and the file is a photograph of a plausible size', bytes > 8000, `${bytes} bytes`);
  }

  section('and comes out at the other end');
  if (carrierFile) {
    await b.evaluate(() => document.getElementById('chatCarrierBtn')?.click());
    await b.waitForTimeout(700);
    await b.evaluate(() => document.getElementById('chatCarrierReadTab')?.click());
    await b.waitForTimeout(500);
    await b.setInputFiles('#chatCarrierReadInput', carrierFile);
    const read = await waitFor(b, (needle) => (document.getElementById('chatCarrierReadOutput')?.value || '').includes(needle),
      { timeoutMs: 60000, arg: secret });
    check('the recipient reads the message back out of the photograph', read === true,
      await b.evaluate(() => (document.getElementById('chatCarrierReadOutput')?.value || '').slice(0, 80)
        || (document.getElementById('chatCarrierReadVerdict')?.textContent || '').trim()));
    const keep = await b.evaluate(() => !document.getElementById('chatCarrierKeepBtn')?.classList.contains('hidden'));
    check('and is offered the chance to keep it in the conversation', keep === true);
  }

  section('nothing threw on either side');
  check('the sender logged no page errors', (a.__errors || []).length === 0, (a.__errors || []).join(' | '));
  check('the reader logged no page errors', (b.__errors || []).length === 0, (b.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.message || String(error));
} finally {
  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`\n===== ${failed} failed of ${results.length} =====\n`);
  await browser.close();
  process.exitCode = failed > 0 ? 1 : 0;
}
