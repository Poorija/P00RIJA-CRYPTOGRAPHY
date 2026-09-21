/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A 4 GB ceiling has to be one the receiver can actually reach.
 *
 * Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
 *
 *   PORT=8123 npm run dev        # terminal 1
 *   node tests/e2e/bigfile.mjs   # no relay needed: this is about the receiver
 *
 * MAX_FILE_BYTES went from 500 MB to 4 GB for the live peer-to-peer path,
 * where nothing is stored on a server and the only ceiling is what the two
 * devices can hold. The receiver could not hold it: every decrypted chunk was
 * kept as a Uint8Array in `transfer.chunks` until the last one arrived, so the
 * peak cost of a file was the file. A tab does not have a 4 GB heap, so the
 * new ceiling was a promise the code could not keep.
 *
 * flushReceivedChunks() moves finished runs into Blobs, whose bytes live in
 * the browser's blob store rather than the heap. That is a change to how the
 * file is put back together, which is exactly the kind of change that
 * corrupts files quietly — so every assertion below ends at a digest, not a
 * byte count. A truncated or mis-ordered file has the right length more often
 * than it has the right hash.
 *
 * This drives the real function out of the real page. It does not push 4 GB
 * through a headless browser — filetransfer.mjs with FT_HUGE=1 is the
 * integration pass. What this measures is the property that makes 4 GB
 * possible at all: that the heap holds a buffer rather than a file.
 */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await settle(page);

/* The chat parts are classic scripts in one realm, so a function declaration
   is a property of window and a const is a bare global. If the helper is not
   there, everything below would pass by testing nothing. */
const present = await page.evaluate(() => ({
  flush: typeof window.flushReceivedChunks === 'function',
  threshold: (() => { try { return TRANSFER_FLUSH_BYTES; } catch (_error) { return 0; } })(),
  ceiling: (() => { try { return MAX_FILE_BYTES; } catch (_error) { return 0; } })(),
  chunk: (() => { try { return FILE_CHUNK_BYTES; } catch (_error) { return 0; } })(),
}));
check('the receiver has a flush path at all', present.flush,
  'without it transfer.chunks holds the whole file until the last chunk lands');
check('the live ceiling is the 4 GB that was asked for',
  present.ceiling === 4 * 1024 * 1024 * 1024,
  `MAX_FILE_BYTES = ${present.ceiling}`);
check('the flush threshold is a buffer, not a file',
  present.threshold > 0 && present.threshold <= 16 * 1024 * 1024,
  `TRANSFER_FLUSH_BYTES = ${present.threshold}`);

if (!present.flush) {
  console.log(`\n===== ${results.filter((ok) => !ok).length} failed of ${results.length} =====`);
  await browser.close();
  process.exit(1);
}

/* A record shaped the way handleFileChunk builds one, fed the way the channel
   feeds it. 24 MB at the real chunk size is 384 chunks — enough to cross the
   flush threshold several times over, small enough to run in seconds. */
const harness = `
  const CHUNK = FILE_CHUNK_BYTES;
  const TOTAL_BYTES = 24 * 1024 * 1024;
  const totalChunks = Math.ceil(TOTAL_BYTES / CHUNK);

  /* Deterministic, and different in every chunk: a fill of zeroes would let a
     mis-ordered reassembly hash correctly. */
  function sourceBytes() {
    const bytes = new Uint8Array(TOTAL_BYTES);
    let x = 0x2545f491;
    for (let i = 0; i < TOTAL_BYTES; i += 1) {
      x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
      bytes[i] = x & 0xff;
    }
    return bytes;
  }

  function makeTransfer() {
    return {
      meta: { totalChunks, mime: 'application/octet-stream' },
      chunks: new Array(totalChunks).fill(null),
      parts: [],
      flushedThrough: 0,
      seen: new Set(),
      bytes: 0,
    };
  }

  async function digest(blob) {
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const heldBytes = (transfer) => transfer.chunks
    .reduce((sum, piece) => sum + (piece ? piece.byteLength : 0), 0);
`;

const inOrder = await page.evaluate(`(async () => {
  ${harness}
  const source = sourceBytes();
  const expected = await digest(new Blob([source]));
  const transfer = makeTransfer();
  let peakHeld = 0;
  for (let i = 0; i < totalChunks; i += 1) {
    transfer.chunks[i] = source.slice(i * CHUNK, (i + 1) * CHUNK);
    transfer.seen.add(i);
    flushReceivedChunks(transfer);
    peakHeld = Math.max(peakHeld, heldBytes(transfer));
  }
  flushReceivedChunks(transfer, { force: true });
  const blob = new Blob(transfer.parts, { type: transfer.meta.mime });
  return {
    expected,
    actual: await digest(blob),
    size: blob.size,
    totalBytes: TOTAL_BYTES,
    parts: transfer.parts.length,
    peakHeld,
    leftInHeap: heldBytes(transfer),
    threshold: TRANSFER_FLUSH_BYTES,
  };
})()`);

check('AN IN-ORDER FILE COMES BACK BYTE-IDENTICAL — the assertion this suite exists for',
  inOrder.actual === inOrder.expected && inOrder.size === inOrder.totalBytes,
  `${inOrder.size} bytes, sha256 ${inOrder.actual.slice(0, 16)}… vs ${inOrder.expected.slice(0, 16)}…`);
check('THE HEAP HOLDS A BUFFER, NOT THE FILE — what makes 4 GB reachable',
  inOrder.peakHeld <= inOrder.threshold + 2 * 64 * 1024,
  `peak ${(inOrder.peakHeld / 1048576).toFixed(1)} MB held of ${(inOrder.totalBytes / 1048576)} MB received`);
check('and the pieces were moved into the blob store as they arrived',
  inOrder.parts > 1 && inOrder.leftInHeap === 0,
  `${inOrder.parts} blob part(s), ${inOrder.leftInHeap} bytes still referenced`);

/* The resend path can leave a hole. A Blob is ordered and cannot be patched
   afterwards, so the flush has to stall at the gap rather than write past it
   — a flush that skipped ahead would produce a file of the right length with
   two chunks transposed, which is the failure a byte count misses. */
const withGap = await page.evaluate(`(async () => {
  ${harness}
  const source = sourceBytes();
  const expected = await digest(new Blob([source]));
  const transfer = makeTransfer();
  /* Past the flush threshold on purpose. A hole inside the first buffer never
     reaches a flush at all, so it would prove only that nothing happened —
     this one has to let several flushes through and then stop. */
  const HOLE = Math.ceil(TRANSFER_FLUSH_BYTES / CHUNK) * 2 + 5;
  let flushedPastHole = false;
  for (let i = 0; i < totalChunks; i += 1) {
    if (i === HOLE) continue;
    transfer.chunks[i] = source.slice(i * CHUNK, (i + 1) * CHUNK);
    transfer.seen.add(i);
    flushReceivedChunks(transfer);
    if (transfer.flushedThrough > HOLE) flushedPastHole = true;
  }
  const stalledAt = transfer.flushedThrough;
  const partsBeforeFill = transfer.parts.length;
  /* The late arrival, as file-resend delivers it. */
  transfer.chunks[HOLE] = source.slice(HOLE * CHUNK, (HOLE + 1) * CHUNK);
  transfer.seen.add(HOLE);
  flushReceivedChunks(transfer, { force: true });
  const blob = new Blob(transfer.parts, { type: transfer.meta.mime });
  return {
    expected,
    actual: await digest(blob),
    size: blob.size,
    totalBytes: TOTAL_BYTES,
    stalledAt,
    partsBeforeFill,
    hole: HOLE,
    flushedPastHole,
    flushedThrough: transfer.flushedThrough,
    totalChunks,
  };
})()`);

check('a gap stops the flush instead of being written over',
  withGap.flushedPastHole === false && withGap.stalledAt > 0 && withGap.stalledAt <= withGap.hole,
  `${withGap.partsBeforeFill} part(s) written, then stalled at ${withGap.stalledAt} for the hole at ${withGap.hole}`);
check('A RESENT CHUNK STILL LANDS IN ITS OWN PLACE — a transposed file hashes wrong, not short',
  withGap.actual === withGap.expected && withGap.size === withGap.totalBytes,
  `${withGap.size} bytes, sha256 ${withGap.actual.slice(0, 16)}… vs ${withGap.expected.slice(0, 16)}…`);
check('and every chunk ends up accounted for',
  withGap.flushedThrough === withGap.totalChunks,
  `${withGap.flushedThrough} of ${withGap.totalChunks}`);

/* Chunks can arrive twice — that is defect 3 in filetransfer.mjs, guarded by
   `seen` in the handler. The flush must not double-count if one slips past. */
const singleChunk = await page.evaluate(`(async () => {
  ${harness}
  const transfer = makeTransfer();
  transfer.meta.totalChunks = 1;
  transfer.chunks = [new Uint8Array([1, 2, 3, 4])];
  flushReceivedChunks(transfer, { force: true });
  const before = transfer.parts.length;
  flushReceivedChunks(transfer, { force: true });
  const blob = new Blob(transfer.parts);
  return { before, after: transfer.parts.length, size: blob.size };
})()`);
check('flushing an already-flushed transfer adds nothing',
  singleChunk.before === 1 && singleChunk.after === 1 && singleChunk.size === 4,
  `${singleChunk.before} then ${singleChunk.after} part(s), ${singleChunk.size} bytes`);

/* The v1 shape stores base64 strings in the same field and rebuilds by
   joining them. flushReceivedChunks is only called from the v2 branch; if it
   were ever reached with v1 data it must not silently produce a Blob of
   "[object Object]". A record without `parts` is the v1 record. */
const v1Safe = await page.evaluate(`(async () => {
  ${harness}
  const legacy = { meta: { totalChunks: 2 }, chunks: ['AAAA', 'BBBB'], seen: new Set([0, 1]) };
  let threw = '';
  try { flushReceivedChunks(legacy, { force: true }); } catch (error) { threw = String(error && error.message || error); }
  return { threw, joined: legacy.chunks.join(''), untouched: !('parts' in legacy) };
})()`);
check('a v1 record is left alone rather than half-converted',
  v1Safe.threw === '' && v1Safe.joined === 'AAAABBBB' && v1Safe.untouched,
  v1Safe.threw ? `threw: ${v1Safe.threw}` : 'chunks still joinable, no parts added');

await browser.close();
const bad = results.filter((ok) => !ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
