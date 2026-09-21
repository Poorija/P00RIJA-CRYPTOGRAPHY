/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A file-by-file, case-by-case audit of Secure Chat.
 *
 *   npm run relay             # terminal 1
 *   PORT=8123 npm run dev     # terminal 2
 *   node tests/e2e/chataudit.mjs
 *
 * filetransfer.mjs asks whether a large file arrives. This asks the questions
 * that sit underneath that one and are easier to get wrong:
 *
 *   - Does every KIND of file arrive byte for byte? An image, a video, a PDF,
 *     an archive, something with no extension, something empty, something whose
 *     name is Persian or has a newline in it.
 *   - Does the metadata stripper leave a file it cannot clean alone, rather
 *     than half-editing it? That is what corrupted a HEIC once already.
 *   - Do the size limits hold at the boundary, and refuse rather than truncate?
 *   - Does text survive? RTL, emoji beyond the basic plane, zero-width
 *     characters, something long enough to matter.
 *
 * Every file is checked by SHA-256 of what the receiver can actually open, not
 * by length: a truncated file has the right length more often than it should,
 * and only a digest notices a hole.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  browser, openApp, identity, importIdentity, openFirstChat,
  digestOfLastAttachment, ATTACHMENTS, waitFor, tmp, MB
} from './_chat-harness.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/* ---- fixtures ----------------------------------------------------------- */

/* Real headers, so the app's sniffer sees what it would see from a phone.
   A file whose bytes are random noise with a .jpg name tests nothing about
   the JPEG path. */
const FIXTURES = [
  {
    name: 'photo.jpg', type: 'image/jpeg',
    head: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01],
    tail: [0xff, 0xd9], body: 4096
  },
  {
    name: 'graphic.png', type: 'image/png',
    head: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
           0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52],
    body: 3000
  },
  {
    name: 'sticker.webp', type: 'image/webp',
    head: [0x52, 0x49, 0x46, 0x46, 0x40, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
    body: 2000
  },
  {
    name: 'animation.gif', type: 'image/gif',
    head: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], body: 1500
  },
  {
    /* The format that arrived corrupted once. It must travel untouched. */
    name: 'from-iphone.heic', type: 'image/heic',
    head: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
           0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00],
    body: 5000
  },
  {
    name: 'clip.mp4', type: 'video/mp4',
    head: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
           0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00],
    body: 8000
  },
  {
    name: 'voice.mp3', type: 'audio/mpeg',
    head: [0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], body: 4000
  },
  {
    name: 'sound.wav', type: 'audio/wav',
    head: [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45],
    body: 3000
  },
  {
    name: 'contract.pdf', type: 'application/pdf',
    head: [...Buffer.from('%PDF-1.7\n')],
    tail: [...Buffer.from('\n%%EOF\n')], body: 2500
  },
  {
    name: 'archive.zip', type: 'application/zip',
    head: [0x50, 0x4b, 0x03, 0x04], body: 6000
  },
  { name: 'notes.txt', type: 'text/plain', head: [...Buffer.from('hello\n')], body: 800 },
  { name: 'data.json', type: 'application/json', head: [...Buffer.from('{"a":1}')], body: 600 },
  /* The awkward ones. */
  { name: 'README', type: '', head: [...Buffer.from('no extension at all\n')], body: 400 },
  { name: 'empty.bin', type: 'application/octet-stream', head: [], body: 0 },
  { name: 'یادداشت مهم.txt', type: 'text/plain', head: [...Buffer.from('فارسی\n')], body: 500 },
  { name: 'مستند ۱۴۰۵.pdf', type: 'application/pdf', head: [...Buffer.from('%PDF-1.4\n')], body: 700 },
  { name: 'a'.repeat(180) + '.dat', type: '', head: [0x01, 0x02], body: 300 }
];

function buildFixture(spec) {
  const head = Buffer.from(spec.head || []);
  const tail = Buffer.from(spec.tail || []);
  const body = crypto.randomBytes(spec.body || 0);
  const bytes = Buffer.concat([head, body, tail]);
  const file = path.join(tmp, spec.name.replace(/[/\\]/g, '_'));
  fs.writeFileSync(file, bytes);
  return {
    ...spec,
    file,
    size: bytes.length,
    digest: crypto.createHash('sha256').update(bytes).digest('hex')
  };
}

/* ---- pair two peers ----------------------------------------------------- */

console.log('\n===== pairing =====');
const A = await openApp('SENDER');
const B = await openApp('RECEIVER');
const idA = await identity(A);
const idB = await identity(B);
await importIdentity(A, idB);
await importIdentity(B, idA);
await A.waitForTimeout(2500);
await openFirstChat(A);
await openFirstChat(B);
const paired = await waitFor(B, () => document.querySelectorAll('#chatPeerList .chat-peer-card').length > 0);
check('two peers are paired over the relay', paired === true);

/* Send a file and wait for the receiver to be able to open it. */
async function sendFile(fixture, { timeoutMs = 90000 } = {}) {
  const before = await B.evaluate((sel) => document.querySelectorAll(sel).length, ATTACHMENTS);
  await A.setInputFiles('#chatFileInput', fixture.file);
  const arrived = await waitFor(B,
    (n) => document.querySelectorAll('#chatMessages a[data-chat-download-message][href^="blob:"]').length > n,
    { timeoutMs, arg: before });
  if (!arrived) return { arrived: false };
  const got = await digestOfLastAttachment(B);
  return { arrived: true, ...got };
}

/* ===== 1. every kind of file ============================================ */

console.log('\n===== 1. every kind of file, byte for byte =====');
const fileResults = [];
for (const spec of FIXTURES) {
  const fixture = buildFixture(spec);
  const got = await sendFile(fixture);
  const exact = got.arrived && got.digest === fixture.digest && got.size === fixture.size;
  fileResults.push({ name: spec.name, exact, sent: fixture.size, got: got.size ?? null });
  const label = spec.name.length > 34 ? spec.name.slice(0, 31) + '…' : spec.name;
  check(`${label} arrives byte for byte`, exact,
    got.arrived ? `${fixture.size} -> ${got.size}` : 'never arrived');
}
const perfect = fileResults.filter((r) => r.exact).length;
console.log(`  ${perfect}/${fileResults.length} file types survived intact`);

/* ===== 2. the metadata stripper, per format ============================= */

/* The HEIC that arrived "damaged" came from the stripper editing a format it
   had misidentified. What matters is not only that it cleans what it knows,
   but that it refuses to touch what it does not. */
console.log('\n===== 2. metadata on the way out =====');
const stripReport = await A.evaluate(async () => {
  const M = window.PoorijaMetadata;
  if (!M) return { error: 'metadata module missing' };
  const make = (name, type, head) => new File([new Uint8Array(head)], name, { type });
  const cases = [
    ['jpeg', 'p.jpg', 'image/jpeg', [0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]],
    ['png', 'p.png', 'image/png', [0x89, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]],
    ['heif', 'p.heic', 'image/heic', [0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99, 0, 0, 0, 0]],
    ['avif', 'p.avif', 'image/avif', [0, 0, 0, 24, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0]],
    ['zip', 'a.zip', 'application/zip', [0x50, 0x4b, 3, 4, 0, 0, 0, 0]]
  ];
  const out = {};
  for (const [label, name, type, head] of cases) {
    const file = make(name, type, head);
    const before = new Uint8Array(await file.arrayBuffer());
    try {
      const res = await M.stripMetadata(file);
      const after = new Uint8Array(await (res.blob || file).arrayBuffer());
      out[label] = {
        supported: Boolean(res.supported),
        identical: before.length === after.length && before.every((b, i) => b === after[i])
      };
    } catch (error) { out[label] = { error: String(error).slice(0, 60) }; }
  }
  return out;
});
console.log('  ' + JSON.stringify(stripReport));
if (!stripReport.error) {
  check('a JPEG is a format it cleans', stripReport.jpeg?.supported === true);
  check('a PNG is too', stripReport.png?.supported === true);
  check('a HEIC is NOT touched — the corruption that started this',
    stripReport.heif?.supported === false && stripReport.heif?.identical === true,
    JSON.stringify(stripReport.heif));
  check('nor is an AVIF',
    stripReport.avif?.supported === false && stripReport.avif?.identical === true,
    JSON.stringify(stripReport.avif));
  check('nor a format it has never heard of',
    stripReport.zip?.supported === false && stripReport.zip?.identical === true,
    JSON.stringify(stripReport.zip));
}

/* ===== 3. the size limits, at the boundary ============================== */

console.log('\n===== 3. size limits =====');
const limits = await A.evaluate(() => {
  /* eval, deliberately and only here.

     MAX_FILE_BYTES and its neighbours are top-level `const` declarations in
     js/chat/01-constants.js. Since the chat module was split into ordered
     classic scripts they live in the global LEXICAL scope, which is not the
     same thing as being properties of window — window.MAX_FILE_BYTES is
     undefined while the binding itself is perfectly reachable by name.

     The strings evaluated are literals written above, in test code, running in
     a headless browser against a local build. No input reaches them. Reading
     the real constants is the whole point: a test that restates the numbers it
     is checking proves only that it can copy. */
  try {
    return {
      max: eval('MAX_FILE_BYTES'),
      offline: eval('MAX_OFFLINE_FILE_BYTES'),
      vault: eval('MEDIA_VAULT_MAX_FILE_BYTES'),
      chunk: eval('FILE_CHUNK_BYTES')
    };
  } catch (error) { return { error: String(error).slice(0, 80) }; }
});
console.log('  ' + JSON.stringify(limits));
/* The live ceiling is 4 GB, not 500 MB: those bytes go peer to peer and never
   touch a server, so what bounds them is the two devices. The offline one is
   the opposite case and stays at 100 MB — it is the relay's 512 MB mailbox
   that is being protected, and one large file there evicts everything else
   somebody is waiting on. */
check('the limits are the documented ones',
  limits.max === 4 * 1024 * MB && limits.offline === 100 * MB && limits.vault === 64 * MB,
  JSON.stringify(limits));
check('the chunk size stays under the data channel frame limit',
  limits.chunk <= 64 * 1024, String(limits.chunk));

/* A file one byte over the ceiling must be REFUSED, in words, not truncated
   into something that arrives looking whole. */
/* The first version of this called window.__fileLimitProbe, which does not
   exist, got undefined back and called that a pass-or-fail — a check that
   could never have told the truth either way. Drive the real send path with a
   File whose size lies, and watch for the refusal the user would see. */
const overLimit = await A.evaluate(async (max) => {
  window.__toasts = [];
  const before = document.querySelectorAll('#chatMessages [data-id]').length;
  const oversized = new File([new Uint8Array(64)], 'huge.bin',
    { type: 'application/octet-stream' });
  Object.defineProperty(oversized, 'size', { value: max + 1 });
  let threw = null;
  try {
    await window.sendFile?.(oversized);
  } catch (error) { threw = String(error).slice(0, 90); }
  await new Promise((r) => setTimeout(r, 1500));
  return {
    toast: window.__toasts.at(-1) || null,
    threw,
    newBubbles: document.querySelectorAll('#chatMessages [data-id]').length - before
  };
}, limits.max || 500 * MB);
console.log('  ' + JSON.stringify(overLimit));
check('a file past the ceiling is refused, and says so',
  Boolean(overLimit.toast) || Boolean(overLimit.threw),
  JSON.stringify(overLimit));
check('and nothing is queued for sending anyway',
  overLimit.newBubbles === 0, `${overLimit.newBubbles} new bubbles`);

/* ===== 4. text that breaks naive rendering ============================== */

console.log('\n===== 4. awkward text =====');
const TEXTS = [
  ['plain Persian', 'سلام، حال شما چطور است؟'],
  ['mixed direction', 'the code is ABC-123 و بقیه‌اش فارسی است'],
  ['emoji past the BMP', 'family 👨‍👩‍👧‍👦 flag 🏴󠁧󠁢󠁳󠁣󠁴󠁿 skin 👍🏽'],
  ['zero-width and marks', 'a​b‌‍‮c⁦d⁩'],
  ['looks like markup', '<img src=x onerror=alert(1)> & <script>bad()</script>'],
  ['newlines and tabs', 'line one\nline two\t\tindented\n\n\nend'],
  ['only whitespace', '     '],
  ['very long', 'ط'.repeat(4000)]
];
for (const [label, text] of TEXTS) {
  const before = await B.evaluate(() => document.querySelectorAll('#chatMessages [data-id]').length);
  /* Two corrections live in these four lines.
     The ids: #chatComposer and #chatSendMessageBtn. The first version of this
     suite guessed #chatMessageInput / #chatSendBtn, which exist nowhere, so
     every text case reported "does not arrive" — seven failures that were
     entirely the test's, while files passed in the same run over the same
     channel.
     The gesture: page.click(), not element.click() inside evaluate. The
     synthetic click did nothing at all — the composer was not even cleared —
     while a real one sends. Whatever the app does with the event, a user
     produces a real click, so the test should too. */
  await A.evaluate((t) => {
    const input = document.getElementById('chatComposer');
    if (!input) return;
    input.value = t;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await A.click('#chatSendMessageBtn').catch(() => {});
  const landed = await waitFor(B,
    (n) => document.querySelectorAll('#chatMessages [data-id]').length > n,
    { timeoutMs: 25000, arg: before });

  if (label === 'only whitespace') {
    /* An empty message should not be sent at all. */
    check('a whitespace-only message is not sent', landed === false);
    continue;
  }

  const received = landed ? await B.evaluate(() => {
    const nodes = [...document.querySelectorAll('#chatMessages [data-id]')];
    const last = nodes[nodes.length - 1];
    return {
      text: last?.querySelector('.chat-bubble-text')?.textContent
         ?? last?.textContent ?? '',
      html: (last?.innerHTML || '').slice(0, 400)
    };
  }) : null;

  check(`${label} arrives`, landed === true);
  if (label === 'looks like markup' && received) {
    /* The injection surface. It must be escaped, not parsed. */
    check('markup in a message is escaped, never rendered',
      !/<script|<img/i.test(received.html) || /&lt;(script|img)/i.test(received.html),
      received.html.slice(0, 120));
  }
  if (label === 'very long' && received) {
    check('a 4000-character message is not truncated on the way',
      (received.text || '').replace(/\s/g, '').length >= 3900,
      `${(received.text || '').length} chars`);
  }
}

/* ===== 5. nothing threw through any of it =============================== */

console.log('\n===== 5. errors =====');
check('the sender logged no uncaught errors', A.__errors.length === 0,
  A.__errors.slice(0, 3).join(' | '));
check('nor did the receiver', B.__errors.length === 0,
  B.__errors.slice(0, 3).join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
if (bad.length) console.log(bad.map((r) => '  ' + r.name).join('\n'));
process.exit(bad.length ? 1 : 0);
