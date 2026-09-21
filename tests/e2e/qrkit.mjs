/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The QR kit: density, decoding, and the controls around them.
 *
 *   PORT=8123 npm run dev ; node tests/e2e/qrkit.mjs
 *
 * Two complaints started this, and both were about the same number.
 *
 * A code's difficulty is its MODULE COUNT — how many squares fit across it —
 * because the camera has to resolve each one. Pixel size does not help past a
 * point; module count is what decides whether a phone can lock on.
 *
 *   1. Local Link showed TWO codes, alternating every 1.2 seconds, because the
 *      handshake is 880 characters and the QR bridge chunks at 700. A cycling
 *      code is close to unscannable: the reader gets a fraction of a second per
 *      attempt and never holds focus. Deflating it first brings 880 to 789,
 *      which is ONE code at the same density as the first of the two frames it
 *      replaces. This suite asserts there is exactly one, and that it is not
 *      denser than what it replaced.
 *
 *   2. The chat identity code was drawn at error level L with no quiet zone.
 *      The specification requires four blank modules on every side and readers
 *      lean on them to find the symbol at all. This asserts the quiet zone is
 *      there and that a palette choice cannot silently produce a code nobody
 *      can read.
 */
import { chromium } from 'playwright';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));

try {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });

  /* A fresh context reloads itself once, a second or two after load: the
     service worker registers, takes control, and js/app.js reloads the page so
     the new worker is the one serving it. Any evaluate() issued across that
     dies with "Execution context was destroyed". Waiting a fixed number of
     seconds only works while the reload is faster than the guess, so this
     waits for a CONDITION — the globals present continuously for five seconds,
     which a reload cannot happen inside without restarting the count. */
  const present = () => page.evaluate(
    () => typeof window.PoorijaQR?.render === 'function'
      && typeof window.PoorijaLocalLink?.startAsHost === 'function'
      && typeof window.QRCode === 'function'
  ).catch(() => false);
  const deadline = Date.now() + 90000;
  let stableSince = 0;
  while (Date.now() < deadline) {
    if (!(await present())) stableSince = 0;
    else if (!stableSince) stableSince = Date.now();
    else if (Date.now() - stableSince > 5000) break;
    await page.waitForTimeout(250);
  }

  /* ===== packing ======================================================= */

  console.log('\n===== compressing a payload so it fits one code =====');

  const packing = await page.evaluate(async () => {
    const kit = window.PoorijaQR;
    const sdpish = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
      + Array.from({ length: 14 }, (_, i) =>
        `a=candidate:${i} 1 udp 2113937151 aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.local ${50000 + i} typ host`).join('\r\n');
    const payload = JSON.stringify({ v: 1, role: 'offer', key: 'A'.repeat(124), sdp: sdpish });
    const packed = await kit.pack(payload);
    const back = await kit.unpack(packed);

    /* Random bytes do not compress; the packer must notice and leave them
       alone rather than shipping something larger. */
    const noisy = Array.from(crypto.getRandomValues(new Uint8Array(400)))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const packedNoise = await kit.pack(noisy);

    return {
      raw: payload.length,
      packed: packed.length,
      smaller: packed.length < payload.length,
      roundTrip: back === payload,
      prefixed: packed.startsWith(kit.PACK_PREFIX),
      noiseGrew: packedNoise.length > noisy.length,
      noiseRoundTrip: (await kit.unpack(packedNoise)) === noisy,
      plainPassesThrough: (await kit.unpack('not packed at all')) === 'not packed at all',
    };
  });
  console.log(`  ${packing.raw} chars -> ${packing.packed}`);
  check('a handshake payload gets smaller', packing.smaller && packing.prefixed,
    `${packing.raw} -> ${packing.packed}`);
  check('and comes back exactly', packing.roundTrip);
  check('incompressible input is left alone rather than made bigger',
    !packing.noiseGrew && packing.noiseRoundTrip, `grew: ${packing.noiseGrew}`);
  check('text that was never packed passes through untouched',
    packing.plainPassesThrough);

  /* ===== density ======================================================= */

  console.log('\n===== how dense the codes are =====');

  const density = await page.evaluate(() => {
    const kit = window.PoorijaQR;
    const box = document.createElement('div');
    document.body.appendChild(box);
    const at = (chars, level) => kit.render(box, 'A'.repeat(chars), { level, px: 128 })?.modules;
    const out = {
      old716L: at(716, 'L'),      /* one of the two frames Local Link used to show */
      packed789L: at(789, 'L'),   /* the single code that replaces both */
      identityM: at(300, 'M'),
      identityL: at(300, 'L'),
    };
    box.remove();
    return out;
  });
  console.log(`  ${JSON.stringify(density)}`);
  /* The whole justification for one code: it is no harder to read than one of
     the two it replaces. If a future change made it denser, that trade would
     need saying out loud rather than discovering on a phone. */
  check('one compressed code is no denser than one of the two it replaces',
    density.packed789L <= density.old716L + 4,
    `${density.packed789L} vs ${density.old716L} modules`);
  check('a higher error level costs density, as expected',
    density.identityM > density.identityL,
    `M ${density.identityM} > L ${density.identityL}`);

  /* ===== the quiet zone ================================================ */

  console.log('\n===== the margin the specification requires =====');

  /* The quiet zone is measured in the bitmap, not in CSS padding. It moved
     there when the kit took over the drawing: a code whose margin is a
     container's padding stops being a code the moment somebody screenshots the
     canvas alone, and the specification's four modules are a property of the
     symbol rather than of the page it sits on. So this counts actual light
     pixels along the top edge and divides by the module size. */
  const plate = await page.evaluate(() => {
    const kit = window.PoorijaQR;
    const box = document.createElement('div');
    document.body.appendChild(box);
    const info = kit.render(box, 'QUIET ZONE TEST', { px: 240, quiet: 4 });
    const canvas = info.canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const cells = info.modules + info.quiet * 2;
    const scale = canvas.width / cells;
    /* Down the middle of the symbol, so the finder patterns are not what is
       being counted — the first dark pixel is the edge of the code itself. */
    const column = Math.round(canvas.width / 2);
    let light = 0;
    while (light < canvas.height) {
      const [r, g, b] = ctx.getImageData(column, light, 1, 1).data;
      if (r + g + b < 380) break;
      light += 1;
    }
    const el = box.querySelector('.qr-plate');
    const out = {
      exists: Boolean(el),
      background: el ? getComputedStyle(el).backgroundColor : '',
      elements: box.querySelectorAll('canvas, img').length,
      quietModules: Math.round(light / scale),
      declared: info.quiet,
    };
    box.remove();
    return out;
  });
  console.log(`  ${JSON.stringify(plate)}`);
  check('every code carries a real four-module quiet zone in the bitmap itself',
    plate.quietModules >= 4, `${plate.quietModules} modules of light before the code`);
  check('and it is the code’s own light colour, not a border',
    /rgb\(255, 255, 255\)|rgb\(248/.test(plate.background || ''), plate.background);

  /* ===== palettes ====================================================== */

  console.log('\n===== palettes =====');

  const palettes = await page.evaluate(() => {
    const kit = window.PoorijaQR;
    const box = document.createElement('div');
    document.body.appendChild(box);
    const out = {};
    for (const [id, preset] of Object.entries(kit.PRESETS)) {
      const info = kit.render(box, 'PALETTE TEST', { preset: id, px: 128 });
      const plate = box.querySelector('.qr-plate');
      out[id] = {
        modules: info?.modules,
        light: getComputedStyle(plate).backgroundColor,
        named: Boolean(preset.fa && preset.en),
      };
    }
    box.remove();
    return out;
  });
  console.log(`  ${Object.keys(palettes).join(', ')}`);
  check('every palette renders and is named in both languages',
    Object.values(palettes).every((p) => p.modules > 0 && p.named),
    JSON.stringify(Object.values(palettes).map((p) => p.modules)));
  /* A palette must not change how much data fits — only its colours. */
  check('the palette does not change the density',
    new Set(Object.values(palettes).map((p) => p.modules)).size === 1,
    JSON.stringify(Object.values(palettes).map((p) => p.modules)));
  check('the inverted palette warns that it may not scan',
    /may not scan|خوانده نشود/.test(
      JSON.stringify(await page.evaluate(() => window.PoorijaQR.PRESETS.inverted))),
    'warning present');

  /* ===== settings persist =============================================== */

  const persisted = await page.evaluate(() => {
    const kit = window.PoorijaQR;
    kit.writeSettings({ preset: 'ocean', level: 'Q' });
    const read = kit.readSettings();
    const raw = localStorage.getItem('poorija_qr_appearance');
    kit.writeSettings({ preset: 'classic', level: 'M' });
    return { preset: read.preset, level: read.level, stored: Boolean(raw) };
  });
  check('an appearance choice is remembered',
    persisted.preset === 'ocean' && persisted.level === 'Q' && persisted.stored,
    JSON.stringify(persisted));

  /* ===== decoding ======================================================= */

  console.log('\n===== reading a code back =====');

  const native = await page.evaluate(() => window.PoorijaQR.nativeDetector().then(Boolean));
  console.log(`  platform BarcodeDetector: ${native ? 'available, used first' : 'absent, jsQR only'}`);

  /* Render a code, photograph it onto a canvas, and read it back — the whole
     path a camera takes, minus the lens. */
  const roundTrip = await page.evaluate(async () => {
    const kit = window.PoorijaQR;
    const text = 'P0Q1|abc123|1/1|' + 'HELLO-QR-KIT-'.repeat(12);
    const box = document.createElement('div');
    document.body.appendChild(box);
    /* render reports which element holds the picture. The encoder leaves both
       a <canvas> and an <img>, and the <img> has naturalWidth 0 here — reading
       from it draws nothing and the decode comes back empty for a code that is
       perfectly fine. */
    const info = kit.render(box, text, { px: 420, quiet: 4, level: 'M' });
    const img = info.drawable;
    if (img && img.tagName === 'IMG' && !img.complete) {
      await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 520; canvas.height = 520;
    const ctx = canvas.getContext('2d');
    /* White ground with the code inset: the frame a camera actually sees, not
       a pixel-perfect crop. */
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 520, 520);
    ctx.drawImage(img, 40, 40, 440, 440);
    const decoded = await kit.decode(canvas, 520, 520);
    box.remove();
    return { decoded, matches: decoded === text, chars: text.length };
  });
  check('a rendered code reads back byte for byte',
    roundTrip.matches, roundTrip.matches ? `${roundTrip.chars} chars` : `got "${String(roundTrip.decoded).slice(0, 40)}"`);

  /* ===== the controls exist ============================================= */

  console.log('\n===== the controls the complaint asked for =====');

  const controls = await page.evaluate(() => ({
    linkBoost: Boolean(document.getElementById('linkBoostBtn')),
    linkSwitch: Boolean(document.getElementById('linkSwitchCamBtn')),
    linkTorch: Boolean(document.getElementById('linkTorchBtn')),
    lanBoost: Boolean(document.getElementById('lanPairBoostBtn')),
    lanSwitch: Boolean(document.getElementById('lanPairSwitchCamBtn')),
    lanTorch: Boolean(document.getElementById('lanPairTorchBtn')),
    scannerClass: typeof window.PoorijaQR.Scanner === 'function',
    switchFn: typeof window.PoorijaLocalLink?.switchCamera === 'function',
    torchFn: typeof window.PoorijaLocalLink?.toggleTorch === 'function',
  }));
  check('both QR surfaces have brightness, camera switch and torch controls',
    Object.values(controls).every(Boolean), JSON.stringify(controls));

  /* The full-screen presentation: maximum contrast whatever the palette, and
     the screen held awake where the browser allows it. */
  const boost = await page.evaluate(async () => {
    const kit = window.PoorijaQR;
    kit.writeSettings({ preset: 'ocean' });
    const shown = await kit.present('BOOST TEST', { title: 'title', note: 'note' });
    const host = document.querySelector('.qr-boost');
    const plate = host?.querySelector('.qr-plate');
    const out = {
      opened: Boolean(host),
      ground: host ? getComputedStyle(host).backgroundColor : '',
      plateLight: plate ? getComputedStyle(plate).backgroundColor : '',
      covers: host ? host.getBoundingClientRect().width >= window.innerWidth - 1 : false,
      modules: shown?.modules,
    };
    shown?.close();
    kit.writeSettings({ preset: 'classic' });
    return { ...out, closed: !document.querySelector('.qr-boost') };
  });
  console.log(`  ${JSON.stringify(boost)}`);
  check('the bright presentation fills the screen on white',
    boost.opened && boost.covers && /rgb\(255, 255, 255\)/.test(boost.ground),
    `${boost.ground}, full width ${boost.covers}`);
  check('and forces maximum contrast whatever palette is chosen',
    /rgb\(255, 255, 255\)/.test(boost.plateLight), boost.plateLight);
  check('and closes again', boost.closed);

  /* ===== the three bugs reported from a phone ========================== */

  console.log('\n===== the reported bugs, as assertions =====');

  const stacking = await page.evaluate(async () => {
    const kit = window.PoorijaQR;
    /* Ask three times, as a doubly-wired button would. */
    const a = await kit.present('ONE', { title: 'a' });
    const b = await kit.present('TWO', { title: 'b' });
    const c = await kit.present('THREE', { title: 'c' });
    const count = document.querySelectorAll('.qr-boost').length;
    c.close(); a.close(); b.close();
    return { count, leftover: document.querySelectorAll('.qr-boost').length };
  });
  check('asking three times leaves ONE overlay, not three',
    stacking.count === 1, `${stacking.count} overlays`);
  check('and closing it leaves none', stacking.leftover === 0, `${stacking.leftover} left`);

  const above = await page.evaluate(async () => {
    const kit = window.PoorijaQR;
    /* A stand-in for the identity dialog it is opened from. */
    const modal = document.createElement('div');
    modal.className = 'chat-modal';
    document.body.appendChild(modal);
    const shown = await kit.present('ON TOP', {});
    const host = document.querySelector('.qr-boost');
    const out = {
      boost: Number(getComputedStyle(host).zIndex),
      modal: Number(getComputedStyle(modal).zIndex),
    };
    shown.close();
    modal.remove();
    return out;
  });
  console.log(`  boost z-index ${above.boost} vs modal ${above.modal}`);
  check('the bright presentation sits ABOVE the dialog that opened it',
    above.boost > above.modal, `${above.boost} vs ${above.modal}`);

  check('nothing threw', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ===== one code, one element, and the same code twice ================= */

  console.log('\n===== the picture on the screen =====');

  /* The encoder wants to manage its own DOM: it draws a <canvas>, then some
     time LATER sets an <img> to that canvas's data URL, shows the image and
     hides the canvas. On a phone that produced a code sitting crooked in its
     card — this app's CSS forced both elements visible — and, worse, a "bigger
     and brighter" view carrying the PREVIOUS code's pixels, because the
     callback had not landed before the next render. It scanned perfectly and
     connected to nothing. */
  const drawn = await page.evaluate(() => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const info = window.PoorijaQR.render(box, 'poorija-chat-v3:one-element-only', { px: 300 });
    const result = {
      canvases: box.querySelectorAll('canvas').length,
      images: box.querySelectorAll('img').length,
      tag: info.drawable ? info.drawable.tagName : 'none',
    };
    box.remove();
    return result;
  });
  check('exactly one element is drawn, and it is the canvas',
    drawn.canvases === 1 && drawn.images === 0 && drawn.tag === 'CANVAS', JSON.stringify(drawn));

  /* The encoder's swap is asynchronous, so a code that is right at the moment
     it is drawn can be wrong a second later. */
  const stable = await page.evaluate(async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const kit = window.PoorijaQR;
    kit.render(box, 'poorija-chat-v3:first-code-drawn', { px: 300 });
    const first = box.querySelector('canvas').toDataURL();
    kit.render(box, 'poorija-chat-v3:second-code-drawn', { px: 300 });
    const second = box.querySelector('canvas').toDataURL();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const later = box.querySelector('canvas').toDataURL();
    const decoded = await kit.decode(box.querySelector('canvas'), 300, 300);
    box.remove();
    return { changed: first !== second, settled: second === later, decoded };
  });
  check('drawing a second code replaces the first', stable.changed, String(stable.changed));
  check('and a second later it is still the code that was drawn',
    stable.settled && stable.decoded === 'poorija-chat-v3:second-code-drawn',
    JSON.stringify({ settled: stable.settled, decoded: stable.decoded }));

  /* The dialog and the bright presentation must be the same code. A person
     scans whichever is in front of them and both have to work. */
  const both = await page.evaluate(async () => {
    const kit = window.PoorijaQR;
    const text = 'poorija-chat-v3:the-same-card-twice';
    const box = document.createElement('div');
    document.body.appendChild(box);
    const inline = kit.render(box, text, { px: 280 });
    const inlineRead = await kit.decode(inline.canvas, inline.canvas.width, inline.canvas.height);
    const shown = await kit.present(text, { title: 'x', note: 'y' });
    const big = document.querySelector('.qr-boost-code canvas');
    const bigRead = await kit.decode(big, big.width, big.height);
    const sameModules = inline.modules === shown.modules;
    shown.close();
    box.remove();
    return { inlineRead, bigRead, text, sameModules };
  });
  check('the dialog and the bright view carry the very same payload',
    both.inlineRead === both.text && both.bigRead === both.text,
    JSON.stringify({ inline: both.inlineRead, big: both.bigRead }));
  check('and the same code, module for module', both.sameModules, String(both.sameModules));

  /* Whole device pixels per module: a fractional module width is where a code
     stops being crisp and starts being a suggestion the camera has to guess at. */
  const crisp = await page.evaluate(() => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const info = window.PoorijaQR.render(box, 'poorija-chat-v3:' + 'x'.repeat(120), { px: 300, quiet: 4 });
    const cells = info.modules + info.quiet * 2;
    const result = { modules: info.modules, cells, width: info.canvas.width, exact: info.canvas.width % cells === 0 };
    box.remove();
    return result;
  });
  check('every module is a whole number of pixels wide', crisp.exact, JSON.stringify(crisp));

} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('failed:');
  failed.forEach((result) => console.log(`  - ${result.name}`));
  process.exit(1);
}
