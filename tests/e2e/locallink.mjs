/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Local Link — the offline pair: LAN pairing codes, and the serverless link.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT
 *
 * Two real browser contexts complete a real WebRTC handshake with no signalling
 * server, no STUN and no TURN, and then move a file over it. The one thing
 * standing in for hardware is the camera: instead of pointing a lens at a
 * screen, the test hands the decoded frame strings to `onScanned()` — the same
 * function jsQR feeds. So everything downstream of the optics is under test
 * (chunking, out-of-order reassembly, SDP exchange, ECDH agreement, the sealed
 * wire format, backpressure), and the optics themselves are not.
 *
 * The second thing it cannot prove is the network. Both contexts run on one
 * machine, so mDNS candidate resolution between two physical devices, and Wi-Fi
 * client isolation, still have to be confirmed on real hardware.
 */
import { chromium } from 'playwright';


const BASE = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});

/* A fresh context reloads itself once, shortly after load: the service worker
 * registers, takes control, and js/app.js:5032 reloads the page so the new
 * worker is the one serving it (guarded by a per-version sessionStorage key, so
 * it happens exactly once). That is correct behaviour, but any evaluate()
 * issued across it dies with "Execution context was destroyed".
 *
 * Waiting a fixed number of seconds does not settle it — that only works while
 * the reload is faster than the guess, which is true on localhost and false
 * against a real server. So this waits for a CONDITION instead: the app's
 * globals present CONTINUOUSLY for five seconds. A reload cannot happen inside
 * that window without clearing them and restarting the count, which makes the
 * check correct at any network speed rather than at one that was measured once.
 *
 * PoorijaApp is in the list deliberately. It is by far the largest script, so
 * it is the last to arrive; gating on the small modules alone passed here and
 * then failed forty lines later with "Cannot read properties of undefined". */
async function settle(page, label) {
  const present = () => page.evaluate(
    () => typeof window.PoorijaApp?.switchTab === 'function'
      && typeof window.PoorijaApp?.translations?.fa === 'object'
      && typeof window.PoorijaLocalLink?.startAsHost === 'function'
      && typeof window.PoorijaToolsExtra?.qrSplit === 'function'
      && typeof window.QRCode === 'function'
  ).catch(() => false);   /* a destroyed context is a "no", not a crash */

  const deadline = Date.now() + 90000;
  let stableSince = 0;
  while (Date.now() < deadline) {
    if (!(await present())) stableSince = 0;
    else if (!stableSince) stableSince = Date.now();
    else if (Date.now() - stableSince > 5000) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`${label}: the app never settled at ${BASE}`);
}

async function openPage(label) {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (error) => console.log(`  [${label} pageerror] ${error.message.slice(0, 160)}`));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await settle(page, label);
  return page;
}

const alice = await openPage('A');
const bob = await openPage('B');

/* ===== the pane exists and is named ===================================== */

console.log('\n===== the pane =====');

const shell = await alice.evaluate(() => ({
  button: Boolean(document.getElementById('tab-locallink')),
  panel: Boolean(document.getElementById('content-locallink')),
  composer: Boolean(document.getElementById('linkComposer')),
  qrCanvas: Boolean(document.getElementById('linkQrCanvas')),
  video: Boolean(document.getElementById('linkVideo')),
  lanShow: Boolean(document.getElementById('lanPairShowBtn')),
  lanScan: Boolean(document.getElementById('lanPairScanBtn')),
  lanCanvas: Boolean(document.getElementById('lanPairCanvas'))
}));
check('the Local Link tab, its panel and its controls are all present',
  Object.values(shell).every(Boolean), JSON.stringify(shell));

const named = await alice.evaluate(() => {
  const keys = ['localLink', 'localLinkTitle', 'localLinkIntro', 'localLinkCaveat',
    'linkHostBtn', 'linkScanBtn', 'linkResetBtn', 'lanPairShow', 'lanPairScan', 'lanPairHint'];
  const out = {};
  for (const lang of ['fa', 'en']) {
    out[lang] = keys.filter((key) => !window.PoorijaApp?.translations?.[lang]?.[key]);
  }
  return out;
});
check('every new string exists in both languages',
  named.fa.length === 0 && named.en.length === 0, JSON.stringify(named));

/* ===== key agreement and the safety phrase ============================== */

console.log('\n===== keys =====');

const keyFacts = await alice.evaluate(async () => {
  const L = window.PoorijaLocalLink;
  const a = await L.makeKeys();
  const b = await L.makeKeys();
  const c = await L.makeKeys();
  const raw = async (pair) => new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const [ra, rb, rc] = [await raw(a), await raw(b), await raw(c)];

  /* Two independently derived keys must encrypt for each other. Comparing the
     CryptoKey objects proves nothing — they are non-extractable by design — so
     the only honest test is to seal on one side and open on the other. */
  const ka = await L.deriveSessionKey(a.privateKey, rb);
  const kb = await L.deriveSessionKey(b.privateKey, ra);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const message = new TextEncoder().encode('the same key or not');
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ka, message);
  let agreed = false;
  try {
    const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kb, sealed);
    agreed = new TextDecoder().decode(opened) === 'the same key or not';
  } catch (error) { agreed = false; }

  /* A third party's key must not open it. */
  const kc = await L.deriveSessionKey(c.privateKey, ra);
  let strangerOpened = true;
  try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kc, sealed); }
  catch (error) { strangerOpened = false; }

  return {
    agreed,
    strangerOpened,
    phraseSameEitherOrder: (await L.safetyPhrase(ra, rb)) === (await L.safetyPhrase(rb, ra)),
    phraseDiffersForOtherPeer: (await L.safetyPhrase(ra, rb)) !== (await L.safetyPhrase(ra, rc)),
    phraseWords: (await L.safetyPhrase(ra, rb)).split(' ').length
  };
});
check('two devices derive a key that actually opens each other’s traffic', keyFacts.agreed);
check('a third key does not open it', keyFacts.strangerOpened === false);
check('the safety phrase does not depend on who scanned first', keyFacts.phraseSameEitherOrder);
check('a different peer produces a different phrase', keyFacts.phraseDiffersForOtherPeer);
check('the phrase is six words', keyFacts.phraseWords === 6, `${keyFacts.phraseWords}`);

/* ===== the chunk header ================================================= */

console.log('\n===== chunk header =====');

const header = await alice.evaluate(() => {
  const L = window.PoorijaLocalLink;
  const cases = [
    ['abc12345', 0],
    ['abc12345', 1],
    ['x', 65535],
    ['x', 65536],          /* the byte that a 2-byte index would have lost */
    ['zzzzzzzzzz', 8388607]
  ];
  const roundTrips = cases.map(([id, index]) => {
    const head = L.chunkHeader(id, index);
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const framed = new Uint8Array(head.length + body.length);
    framed.set(head, 0);
    framed.set(body, head.length);
    const read = L.readChunkHeader(framed);
    return read && read.id === id && read.index === index
      && Array.from(read.body).join(',') === '1,2,3,4,5';
  });
  /* A JSON control message must never be mistaken for a chunk. */
  const json = new TextEncoder().encode(JSON.stringify({ kind: 'text', text: 'hello' }));
  return { roundTrips, jsonNotAChunk: L.readChunkHeader(json) === null };
});
check('the chunk header round-trips, including indices above 65535',
  header.roundTrips.every(Boolean), JSON.stringify(header.roundTrips));
check('a control message is not mistaken for a chunk', header.jsonNotAChunk);

/* ===== LAN pairing codes ================================================ */

console.log('\n===== LAN pairing =====');

const relay = await alice.evaluate(() => {
  const L = window.PoorijaLocalLink;
  return {
    builds: L.buildRelayCode('http://192.168.1.34:9000') === 'P0R1|http://192.168.1.34:9000',
    refusesBare: L.buildRelayCode('192.168.1.34:9000') === '',
    readsOwn: L.readRelayCode('P0R1|http://192.168.1.34:9000') === 'http://192.168.1.34:9000',
    readsPlainUrl: L.readRelayCode('https://relay.example.com:8585') === 'https://relay.example.com:8585',
    dropsPathAndQuery: L.readRelayCode('P0R1|http://192.168.1.34:9000/x?y=1') === 'http://192.168.1.34:9000',
    refusesJunk: L.readRelayCode('hello world') === '',
    refusesOtherScheme: L.readRelayCode('javascript:alert(1)') === '',
    refusesEmpty: L.readRelayCode('') === ''
  };
});
check('the relay code is built, read back, and normalised to an origin',
  relay.builds && relay.readsOwn && relay.dropsPathAndQuery, JSON.stringify(relay));
check('a bare URL from another generator is still accepted', relay.readsPlainUrl);
check('junk and non-http schemes are refused',
  relay.refusesJunk && relay.refusesOtherScheme && relay.refusesEmpty && relay.refusesBare,
  JSON.stringify(relay));

const applied = await alice.evaluate(() => {
  const field = document.getElementById('chatServerUrl');
  let sawInput = false;
  field.addEventListener('input', () => { sawInput = true; }, { once: true });
  window.PoorijaLocalLink.applyRelayOrigin('http://192.168.1.34:9000');
  return { value: field.value, sawInput };
});
check('scanning a code fills the server box and tells the settings pane',
  applied.value === 'http://192.168.1.34:9000' && applied.sawInput, JSON.stringify(applied));

const painted = await alice.evaluate(() => {
  document.getElementById('lanPairShowBtn').click();
  const stage = document.getElementById('lanPairStage');
  const canvas = document.getElementById('lanPairCanvas');
  return {
    visible: !stage.classList.contains('hidden'),
    drew: canvas.querySelectorAll('img, canvas').length > 0,
    caption: document.getElementById('lanPairCaption').textContent
  };
});
check('the address renders as a real QR code',
  painted.visible && painted.drew && painted.caption === 'http://192.168.1.34:9000',
  JSON.stringify(painted));

/* ===== the serverless handshake ========================================= */

console.log('\n===== the handshake, with no server of any kind =====');

await alice.evaluate(() => window.PoorijaApp.switchTab('locallink'));
await bob.evaluate(() => window.PoorijaApp.switchTab('locallink'));

await alice.evaluate(() => window.PoorijaLocalLink.startAsHost());
await alice.waitForFunction(() => window.PoorijaLocalLink.state.frames.length > 0,
  null, { timeout: 20000 });

const offer = await alice.evaluate(() => ({
  frames: window.PoorijaLocalLink.state.frames.slice(),
  sdp: window.PoorijaLocalLink.state.pc.localDescription.sdp
}));
console.log(`  offer: ${offer.frames.length} frame(s), ${offer.sdp.length} chars of SDP`);

const candidates = offer.sdp.split('\n').filter((line) => line.startsWith('a=candidate:'));
console.log(`  ${candidates.length} candidate(s):`);
candidates.forEach((line) => console.log(`    ${line.trim().slice(0, 96)}`));
check('the offer carries at least one candidate', candidates.length > 0);
/* The point of iceServers: [] is that this cannot leave the local network.
   Checking the candidates rather than the configuration proves the outcome. */
check('no candidate can leave the local network (no srflx, no relay)',
  candidates.every((line) => / typ host/.test(line)),
  candidates.filter((line) => !/ typ host/.test(line)).join(' | ') || 'all host');
check('the offer fits in a small number of codes', offer.frames.length <= 3,
  `${offer.frames.length} frames`);

/* Feed the frames to the other device out of order and with one repeated,
   which is what a camera reading a cycling display actually produces. */
const jumbled = offer.frames.slice().reverse();
jumbled.splice(1, 0, jumbled[0]);
for (const frame of jumbled) {
  await bob.evaluate((f) => window.PoorijaLocalLink.onScanned(f), frame);
}
await bob.waitForFunction(() => window.PoorijaLocalLink.state.frames.length > 0,
  null, { timeout: 20000 });

const answer = await bob.evaluate(() => ({
  frames: window.PoorijaLocalLink.state.frames.slice(),
  safety: window.PoorijaLocalLink.state.safety,
  role: window.PoorijaLocalLink.state.role
}));
console.log(`  answer: ${answer.frames.length} frame(s)`);
check('the second device read the offer and produced an answer',
  answer.role === 'answer' && answer.frames.length > 0, JSON.stringify({ role: answer.role }));

for (const frame of answer.frames) {
  await alice.evaluate((f) => window.PoorijaLocalLink.onScanned(f), frame);
}

await alice.waitForFunction(() => window.PoorijaLocalLink.canSend(), null, { timeout: 25000 })
  .catch(() => {});
await bob.waitForFunction(() => window.PoorijaLocalLink.canSend(), null, { timeout: 25000 })
  .catch(() => {});

const connected = {
  a: await alice.evaluate(() => ({
    open: window.PoorijaLocalLink.canSend(),
    connection: window.PoorijaLocalLink.state.pc?.connectionState,
    safety: window.PoorijaLocalLink.state.safety
  })),
  b: await bob.evaluate(() => ({
    open: window.PoorijaLocalLink.canSend(),
    connection: window.PoorijaLocalLink.state.pc?.connectionState,
    safety: window.PoorijaLocalLink.state.safety
  }))
};
console.log(`  A: ${JSON.stringify(connected.a)}`);
console.log(`  B: ${JSON.stringify(connected.b)}`);
check('both sides have an open channel with no server involved',
  connected.a.open && connected.b.open, JSON.stringify(connected));
check('both sides show the same safety phrase',
  Boolean(connected.a.safety) && connected.a.safety === connected.b.safety,
  `${connected.a.safety} | ${connected.b.safety}`);

const statusLine = await alice.evaluate(() => ({
  text: document.getElementById('linkStatus').textContent,
  className: document.getElementById('linkStatus').className,
  composerShown: !document.getElementById('linkComposerRow').classList.contains('hidden'),
  roomShown: !document.getElementById('linkRoom')?.classList.contains('hidden'),
}));
/* A finished link is a room, and the room owns the channel. This pane used to
   keep its own composer once connected; leaving it there now would be a second
   message box that looks live and sends into something somebody else is
   reading from. What the pane offers instead is the way into the room. */
check('the pane says it is connected',
  statusLine.className.includes('is-open'), JSON.stringify(statusLine));
check('and hands over to the room rather than keeping its own composer',
  !statusLine.composerShown && statusLine.roomShown, JSON.stringify(statusLine));

/* ===== messages ========================================================= */

console.log('\n===== over the link =====');

/* A finished link is a room of two: local-link's job ends at the introduction
   and the mesh takes the connection over, so the transcript to assert on is the
   room's, not this module's. Both are checked below — the sender's copy as well
   as the receiver's, because for a while the two wire formats were compatible
   enough that a message ARRIVED on the far device while the sender's own copy
   went into a transcript nothing displays, and the composer looked broken from
   the only seat that mattered. */
if (connected.a.open && connected.b.open) {
  await alice.evaluate(() => window.PoorijaLocalLink.sendText('سلام، این بدون سرور رفت'));
  await bob.waitForFunction(
    () => window.PoorijaLocalMesh.room.messages.some((m) => m.direction === 'in'),
    null, { timeout: 10000 }).catch(() => {});
  const gotText = await bob.evaluate(() => window.PoorijaLocalMesh.room.messages
    .filter((m) => m.direction === 'in').map((m) => m.text));
  check('a message arrives on the other device, in Persian, intact',
    gotText.includes('سلام، این بدون سرور رفت'), JSON.stringify(gotText));

  const sentCopy = await alice.evaluate(() => window.PoorijaLocalMesh.room.messages
    .filter((m) => m.direction === 'out').map((m) => m.text));
  check('and the sender sees their own message where the replies land',
    sentCopy.includes('سلام، این بدون سرور رفت'), JSON.stringify(sentCopy));

  /* A link of two people must stay two people. The mesh keys every member on
     the identifier that member picked for itself; when the adoption invented
     one locally instead, the two devices used different names for the same
     link, the roster told each to connect to itself, and a room of two reported
     three. */
  const roster = await Promise.all([alice, bob].map((page) =>
    page.evaluate(() => window.PoorijaLocalMesh.snapshot().count)));
  check('and the room holds exactly the two people in it',
    roster.every((n) => n === 2), JSON.stringify(roster));

  const rendered = await bob.evaluate(() =>
    document.getElementById('linkRoomMessages')?.querySelectorAll('.link-bubble').length || 0);
  check('the arriving message is rendered', rendered > 0, `${rendered} bubbles`);

  /* A file large enough to cross the backpressure ceiling several times over:
     4 MB is 256 chunks and roughly four times BUFFER_CEILING, so a send loop
     without flow control stalls here rather than passing by luck. */
  const SIZE = 4 * 1024 * 1024;
  const sent = await alice.evaluate(async (size) => {
    const bytes = new Uint8Array(size);
    /* Not random noise and not zeros: a pattern whose every byte depends on its
       position, so a chunk delivered at the wrong index changes the hash. */
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >> 11)) & 0xff;
    const file = new File([bytes], 'proof.bin', { type: 'application/octet-stream' });
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const started = performance.now();
    const ok = await window.PoorijaLocalLink.sendFile(file);
    return {
      ok,
      ms: Math.round(performance.now() - started),
      sha: Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
    };
  }, SIZE);
  console.log(`  sent ${(SIZE / 1024 / 1024).toFixed(0)} MB in ${sent.ms} ms`);

  await bob.waitForFunction(
    () => window.PoorijaLocalMesh.room.messages.some((m) => m.kind === 'file' && m.url),
    null, { timeout: 60000 }).catch(() => {});

  const received = await bob.evaluate(async () => {
    const entry = window.PoorijaLocalMesh.room.messages
      .filter((m) => m.kind === 'file' && m.direction === 'in' && m.url).pop();
    if (!entry) return null;
    const buffer = await (await fetch(entry.url)).arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return {
      name: entry.name,
      size: entry.size,
      sha: Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
    };
  });
  check('a 4 MB file arrives complete and byte-exact',
    Boolean(received) && received.size === SIZE && received.sha === sent.sha,
    received ? `${received.size} bytes, sha ${received.sha.slice(0, 16)}… vs ${sent.sha.slice(0, 16)}…` : 'nothing arrived');
  check('the file kept its name', received?.name === 'proof.bin', received?.name || '-');

  /* Tampering. The channel's own DTLS is not what is being tested here — the
     app's own seal is, because that is the layer bound to the key that came
     through the camera. */
  const tamper = await bob.evaluate(async () => {
    const L = window.PoorijaLocalLink;
    const room = window.PoorijaLocalMesh.room;
    const sealed = await L.seal({ kind: 'text', text: 'authentic', at: Date.now() }, false);
    sealed[sealed.length - 3] ^= 0x01;
    const before = room.messages.length;
    /* Straight at whoever owns the channel now, which is the room. */
    await L.state.channel.onmessage({ data: sealed.buffer });
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { before, after: room.messages.length };
  });
  check('a tampered frame is discarded, not shown',
    tamper.after === tamper.before, JSON.stringify(tamper));
} else {
  check('a message arrives on the other device, in Persian, intact', false, 'no channel');
  check('the arriving message is rendered', false, 'no channel');
  check('a 4 MB file arrives complete and byte-exact', false, 'no channel');
  check('the file kept its name', false, 'no channel');
  check('a tampered frame is discarded, not shown', false, 'no channel');
}

/* ===== pairing with no camera at all ==================================== */

console.log('\n===== a link built entirely by copy and paste =====');

/* The reason this exists: a desktop often has no usable camera, and a tower
   with a monitor has none at all. The handshake is ~790 characters, so reading
   it out is not an option either — the same bytes have to travel as text.
   These two contexts are created WITHOUT camera permission, so if anything
   here quietly fell back to getUserMedia it would fail rather than pass. */
const noCamA = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
const noCamB = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
try {
  for (const page of [noCamA, noCamB]) {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await settle(page, 'nocam');
    await page.evaluate(() => window.PoorijaApp.switchTab('locallink'));
  }

  await noCamA.evaluate(() => window.PoorijaLocalLink.startAsHost());
  await noCamA.waitForFunction(() => window.PoorijaLocalLink.state.frames.length > 0,
    null, { timeout: 20000 });

  /* Read it out of the text box the panel fills, not out of state — that box
     is what a person actually copies. */
  const offerText = await noCamA.evaluate(() => document.getElementById('linkMineText')?.value || '');
  console.log(`  the code offered for copying: ${offerText.length} chars`);
  check('the code is published as copyable text', offerText.length > 100,
    `${offerText.length} chars`);
  check('and it is exactly what the QR carries',
    offerText === await noCamA.evaluate(() => window.PoorijaLocalLink.state.frames[0]),
    'identical to frame 1');

  /* Typed into the other machine, as if it arrived by email. */
  await noCamB.evaluate((text) => {
    document.getElementById('linkTheirText').value = text;
  }, offerText);
  await noCamB.evaluate(() => document.getElementById('linkUseTextBtn').click());
  await noCamB.waitForFunction(() => window.PoorijaLocalLink.state.frames.length > 0,
    null, { timeout: 20000 }).catch(() => {});

  const answerText = await noCamB.evaluate(() => document.getElementById('linkMineText')?.value || '');
  check('the second device answers without a camera', answerText.length > 100,
    `${answerText.length} chars`);

  await noCamA.evaluate((text) => {
    document.getElementById('linkTheirText').value = text;
    document.getElementById('linkUseTextBtn').click();
  }, answerText);

  await noCamA.waitForFunction(() => window.PoorijaLocalLink.canSend(), null, { timeout: 25000 })
    .catch(() => {});
  await noCamB.waitForFunction(() => window.PoorijaLocalLink.canSend(), null, { timeout: 25000 })
    .catch(() => {});

  const pairedA = await noCamA.evaluate(() => ({
    open: window.PoorijaLocalLink.canSend(),
    safety: window.PoorijaLocalLink.state.safety,
  }));
  const pairedB = await noCamB.evaluate(() => ({
    open: window.PoorijaLocalLink.canSend(),
    safety: window.PoorijaLocalLink.state.safety,
  }));
  console.log(`  A ${JSON.stringify(pairedA)}\n  B ${JSON.stringify(pairedB)}`);
  check('A LINK FORMS WITH NO CAMERA INVOLVED',
    pairedA.open && pairedB.open, JSON.stringify({ a: pairedA.open, b: pairedB.open }));
  check('and the safety phrase still matches',
    Boolean(pairedA.safety) && pairedA.safety === pairedB.safety,
    `${pairedA.safety} | ${pairedB.safety}`);

  if (pairedA.open && pairedB.open) {
    await noCamA.evaluate(() => window.PoorijaLocalLink.sendText('paired by clipboard'));
    await noCamB.waitForFunction(
      () => window.PoorijaLocalMesh.room.messages.some((m) => m.direction === 'in'),
      null, { timeout: 10000 }).catch(() => {});
    const got = await noCamB.evaluate(() => window.PoorijaLocalMesh.room.messages
      .filter((m) => m.direction === 'in').map((m) => m.text));
    check('and messages flow over it', got.includes('paired by clipboard'), JSON.stringify(got));
  } else {
    check('and messages flow over it', false, 'no channel');
  }

  /* Junk must be refused rather than half-accepted. */
  const junk = await noCamB.evaluate(async () => {
    const before = window.PoorijaLocalLink.state.role;
    const ok = await window.PoorijaLocalLink.useTypedCode('this is not a link code');
    return { ok, roleUnchanged: window.PoorijaLocalLink.state.role === before };
  });
  check('text that is not a link code is refused',
    junk.ok === false && junk.roleUnchanged, JSON.stringify(junk));
} finally {
  await noCamA.close().catch(() => {});
  await noCamB.close().catch(() => {});
}

/* ===== hygiene ========================================================== */

console.log('\n===== hygiene =====');

const reset = await alice.evaluate(() => {
  document.getElementById('linkResetBtn').click();
  const L = window.PoorijaLocalLink;
  return {
    channel: L.state.channel,
    pc: L.state.pc,
    sessionKey: L.state.sessionKey,
    messages: L.state.messages.length,
    canSend: L.canSend(),
    composerHidden: document.getElementById('linkComposerRow').classList.contains('hidden')
  };
});
check('reset drops the connection, the key and the transcript',
  reset.channel === null && reset.pc === null && reset.sessionKey === null
  && reset.messages === 0 && reset.canSend === false && reset.composerHidden,
  JSON.stringify(reset));

const parked = await bob.evaluate(() => {
  window.PoorijaApp.switchTab('keys');
  const L = window.PoorijaLocalLink;
  /* The camera moved behind PoorijaQR.Scanner, so "is the camera off" is now
     "is there a scanner at all" rather than a raw timer and a raw stream. */
  return { scanner: L.state.scanner, frameTimer: L.state.frameTimer, purpose: L.state.scanPurpose };
});
check('leaving the tab stops the camera and the frame cycle',
  !parked.scanner && parked.frameTimer === null && !parked.purpose,
  JSON.stringify(parked));

/* ===== the offline claim ================================================ */

console.log('\n===== the offline claim =====');

/* The whole point. If any request left the page during the handshake, the
   feature does not do what its own title says. */
const requests = [];
const watcher = await openPage('C');
/* Attached only after the page has settled, so the app's own asset loads and
   the service-worker reload are not counted as the feature reaching out. */
watcher.on('request', (request) => {
  const url = request.url();
  if (!url.startsWith(BASE) && !url.startsWith('data:') && !url.startsWith('blob:')) {
    requests.push(url);
  }
});
await watcher.evaluate(() => window.PoorijaApp.switchTab('locallink'));
await watcher.evaluate(() => window.PoorijaLocalLink.startAsHost());
await watcher.waitForFunction(() => window.PoorijaLocalLink.state.frames.length > 0,
  null, { timeout: 20000 }).catch(() => {});
check('creating a link contacts nothing outside the page',
  requests.length === 0, requests.slice(0, 4).join(', ') || 'no external requests');

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('failed:');
  failed.forEach((r) => console.log(`  - ${r.name}`));
  process.exit(1);
}
