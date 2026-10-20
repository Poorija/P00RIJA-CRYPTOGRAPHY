/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Heavy moving packs on a desktop: the page keeps its frames.
 *
 *   A desktop window shows three or four times the stickers a phone does, and
 *   a pack of Lottie stickers there is that many vector scenes animating at
 *   once; the background work that makes every pack's stills runs on the same
 *   thread. On a Mac — WebKit, the engine of the native app's window and of
 *   Safari — that was a slow open and a page that hung. Measured here, frame
 *   by frame, in a 1440 × 900 window with three heavy packs (Lottie stickers
 *   of thirty animated layers each, video stickers, and two hundred static
 *   ones) stored the way an older build left them, with no stills:
 *
 *   - the app opening and bringing every pack up to date in the background;
 *   - the panel opening on the Lottie pack, and sitting open;
 *   - the grid scrolled from top to bottom;
 *   - switching between the packs.
 *
 *   Run it in WebKit with E2E_ENGINE=webkit; it runs in Chromium otherwise.
 *   Frame rates are judged against what the same machine draws with the panel
 *   open on stickers that do not move. PERF_DEBUG=1 prints where long frames
 *   fall and which of the app's functions ran in them.
 */
import { chromium } from 'playwright';
import { openApp, browser, waitFor, PASS, ENGINE } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`);
};

/* A Lottie sticker of the weight Telegram's are: thirty shape layers, each
   moving, turning and changing size over two seconds at 60 frames a second. */
function heavyLottie(seed) {
  const layer = (i) => {
    const hue = ((seed * 37 + i * 23) % 360) / 360;
    const rgb = [Math.abs(Math.sin(hue * 6.28)), Math.abs(Math.sin(hue * 6.28 + 2)), Math.abs(Math.sin(hue * 6.28 + 4)), 1];
    const x = 100 + ((i * 53) % 312);
    const y = 100 + ((i * 97) % 312);
    const ease = { i: { x: [0.5], y: [0.5] }, o: { x: [0.5], y: [0.5] } };
    return {
      ddd: 0, ind: i + 1, ty: 4, nm: `l${i}`, sr: 1, ip: 0, op: 120, st: 0, bm: 0,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 1, k: [{ t: 0, s: [0], ...ease }, { t: 120, s: [360] }] },
        p: { a: 1, k: [{ t: 0, s: [x, y, 0], ...ease }, { t: 60, s: [512 - x, 512 - y, 0], ...ease }, { t: 120, s: [x, y, 0] }] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 1, k: [{ t: 0, s: [100, 100, 100], ...ease }, { t: 60, s: [60, 140, 100], ...ease }, { t: 120, s: [100, 100, 100] }] },
      },
      shapes: [{
        ty: 'gr', nm: 'g',
        it: [
          i % 2 ? { ty: 'el', nm: 'e', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [70, 70] } }
            : { ty: 'rc', nm: 'r', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [60, 60] }, r: { a: 0, k: 12 } },
          { ty: 'fl', nm: 'f', c: { a: 0, k: rgb }, o: { a: 0, k: 100 }, r: 1 },
          { ty: 'st', nm: 's', c: { a: 0, k: [0, 0, 0, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 4 } },
          { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } },
        ],
      }],
    };
  };
  return JSON.stringify({ v: '5.7.4', fr: 60, ip: 0, op: 120, w: 512, h: 512, nm: `heavy${seed}`, ddd: 0, assets: [], layers: Array.from({ length: 30 }, (_, i) => layer(i)) });
}

/* A short video sticker, recorded in Chromium (which writes WebM) and handed
   to whichever engine runs the suite. */
async function webmClip() {
  const recorder = await chromium.launch();
  try {
    const page = await recorder.newPage();
    return await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
      const g = canvas.getContext('2d');
      const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' });
      const parts = [];
      rec.ondataavailable = (e) => parts.push(e.data);
      let t = 0;
      const draw = setInterval(() => { g.fillStyle = '#0b1220'; g.fillRect(0, 0, 512, 512); g.fillStyle = `hsl(${(t += 9) % 360} 80% 55%)`; g.beginPath(); g.arc(256 + 120 * Math.sin(t / 20), 256, 140, 0, 7); g.fill(); }, 33);
      rec.start();
      await new Promise((r) => setTimeout(r, 1500));
      rec.stop();
      await new Promise((r) => { rec.onstop = r; });
      clearInterval(draw);
      const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
      let text = '';
      for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(text);
    });
  } finally {
    await recorder.close();
  }
}

/* Frame gaps, measured inside the page: every requestAnimationFrame more than
   50 ms after the one before is a frame the page could not draw. */
const startFrames = (page) => page.evaluate(() => {
  if (window.__frames) window.__frames.on = false;
  const f = { gaps: [], count: 0, since: performance.now(), last: performance.now(), on: true };
  window.__frames = f;
  const tick = (now) => {
    if (!f.on) return;
    const gap = now - f.last;
    f.last = now;
    f.count += 1;
    if (gap > 50) f.gaps.push(Math.round(gap));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const readFrames = (page) => page.evaluate(() => {
  const f = window.__frames;
  f.on = false;
  const seconds = (performance.now() - f.since) / 1000;
  return {
    fps: Math.round(f.count / seconds),
    over100: f.gaps.filter((g) => g > 100).length,
    over250: f.gaps.filter((g) => g > 250).length,
    worst: Math.max(0, ...f.gaps),
    seconds: Math.round(seconds * 10) / 10,
  };
});

const clip = await webmClip();
const stacks = await startTwoStacks();
const report = {};
try {
  const PAGE = await openApp('PERF', { origin: stacks.a.url, relay: stacks.a.url, context: { viewport: { width: 1440, height: 900 } } });
  console.log(`  engine: ${ENGINE}`);
  if (process.env.PERF_DEBUG) PAGE.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300), '|', String(e.stack || '').slice(0, 400)));
  /* Three packs, stored as an older build left them: no stills, nothing
     brought up to date. */
  await PAGE.evaluate(async ({ lotties, clipB64 }) => {
    window.__stickerProbe.reset();
    const video = Uint8Array.from(atob(clipB64), (c) => c.charCodeAt(0));
    const records = (prefix, count, make) => Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, ...make(i) }));
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const g = canvas.getContext('2d');
    const stills = [];
    for (let i = 0; i < 200; i += 1) {
      g.fillStyle = `hsl(${(i * 29) % 360} 70% 50%)`; g.fillRect(0, 0, 512, 512);
      g.fillStyle = '#fff'; g.font = 'bold 180px sans-serif'; g.fillText(String(i), 120, 320);
      stills.push(await new Promise((r) => canvas.toBlob(r, 'image/png')));
    }
    const pack = (id, title, stickers) => ({ id, title, author: '', source: 'import', createdAt: new Date().toISOString(), stickers });
    await window.__stickerProbe.addPack(pack('perf-lottie', 'Lottie', records('lot', 90, (i) => ({ name: `l${i}.tgs`, mime: 'application/json', kind: 'lottie', emoji: '', blob: new Blob([lotties[i % lotties.length]], { type: 'application/json' }) }))));
    await window.__stickerProbe.addPack(pack('perf-video', 'Video', records('vid', 60, (i) => ({ name: `v${i}.webm`, mime: 'video/webm', kind: 'video', emoji: '', blob: new Blob([video], { type: 'video/webm' }) }))));
    await window.__stickerProbe.addPack(pack('perf-static', 'Static', records('st', 200, (i) => ({ name: `s${i}.png`, mime: 'image/png', kind: 'image', emoji: '', blob: stills[i] }))));
    try { localStorage.setItem('poorija_sticker_active_pack', 'perf-lottie'); } catch (_e) { /* private mode */ }
  }, { lotties: Array.from({ length: 6 }, (_, i) => heavyLottie(i)), clipB64: clip });

  /* The app opened again: the packs come out of storage and are brought up
     to date in the background while the page is in use. */
  if (process.env.PERF_DEBUG) console.log('  errors before reload:', (PAGE.__errors || []).length);
  await PAGE.reload({ waitUntil: 'load' });
  await PAGE.waitForTimeout(1500);
  await PAGE.evaluate((p) => { const el = document.getElementById('unlockPassword'); if (el) { el.value = p; el.dispatchEvent(new Event('input', { bubbles: true })); } }, PASS);
  await PAGE.evaluate(() => window.unlockApp?.());
  await waitFor(PAGE, () => (chatState.stickerPacks || []).length === 3, { timeoutMs: 30000 });
  if (process.env.PERF_DEBUG) {
    await PAGE.evaluate(() => {
      window.__dbg = [];
      const revoke = URL.revokeObjectURL.bind(URL);
      window.__revokedAt = new Map();
      URL.revokeObjectURL = (url) => { window.__revokedAt.set(url, new Error().stack.split('\n').slice(1, 4).join(' <- ')); return revoke(url); };
      window.addEventListener('unhandledrejection', (e) => window.__dbg.push(`rejection: ${e.reason?.message || e.reason}`));
      document.addEventListener('error', (e) => { const n = e.target; if (n && n.tagName) window.__dbg.push(`load-error ${n.tagName}.${n.className} ${String(n.currentSrc || n.src || '').slice(-12)} revokedBy=${window.__revokedAt.get(n.currentSrc || n.src) || 'not revoked'}`); }, true);
    });
  }
  if (process.env.PERF_DEBUG) console.log('  errors after unlock:', (PAGE.__errors || []).length);
  /* Leaving the old page tears down its loads, and WebKit reports each as an
     error of the page; nothing of this run's page is in them. */
  if (PAGE.__errors) PAGE.__errors.length = 0;
  await startFrames(PAGE);
  const startedAt = Date.now();
  await waitFor(PAGE, () => chatState.stickerPacks.every((pack) => pack.stickers.every((r) => r.upkeep === 2 && (r.thumb instanceof Blob || r.thumbChecked))), { timeoutMs: 180000 });
  report.background = { ...(await readFrames(PAGE)), doneInSeconds: Math.round((Date.now() - startedAt) / 1000) };
  if (process.env.PERF_DEBUG) console.log('  errors after background:', (PAGE.__errors || []).length);
  const stills = await PAGE.evaluate(() => chatState.stickerPacks.map((pack) => `${pack.title}:${pack.stickers.filter((r) => r.thumb instanceof Blob).length}/${pack.stickers.length}`));
  report.stills = stills;

  /* What this machine draws with the panel open on stickers that do not move:
     the ceiling the moving packs are measured against. */
  await PAGE.evaluate(() => { openSavedMessages(); });
  await PAGE.waitForTimeout(600);
  await PAGE.evaluate(() => { chatState.stickerActivePackId = 'perf-static'; setStickerPanelVisible(true, { shelf: 'stickers' }); });
  await PAGE.waitForTimeout(1500);
  await startFrames(PAGE);
  await PAGE.waitForTimeout(4000);
  report.still = await readFrames(PAGE);
  await PAGE.evaluate(() => setStickerPanelVisible(false));
  await PAGE.waitForTimeout(600);

  /* The panel opens on the Lottie pack. */
  await PAGE.evaluate(() => { openSavedMessages(); });
  await PAGE.waitForTimeout(600);
  await startFrames(PAGE);
  const open = await PAGE.evaluate(async () => {
    chatState.stickerActivePackId = 'perf-lottie';
    const t0 = performance.now();
    setStickerPanelVisible(true, { shelf: 'stickers' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - t0);
  });
  await PAGE.waitForTimeout(5000);
  report.open = { firstFrameMs: open, ...(await readFrames(PAGE)) };
  /* Once every sticker on screen is built and moving. */
  await startFrames(PAGE);
  await PAGE.waitForTimeout(4000);
  report.steady = await readFrames(PAGE);
  report.animating = await PAGE.evaluate(() => ({
    clock: window.__stickerProbe.lottieClock?.(),
    cells: document.querySelectorAll('#chatStickerGrid .chat-sticker-cell').length,
    registered: typeof lottie !== 'undefined' && lottie.getRegisteredAnimations ? lottie.getRegisteredAnimations().length : -1,
  }));

  /* Scrolled from top to bottom over four seconds. */
  await startFrames(PAGE);
  await PAGE.evaluate(async () => {
    const grid = document.getElementById('chatStickerGrid');
    const end = grid.scrollHeight - grid.clientHeight;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const step = (now) => {
        const p = Math.min(1, (now - t0) / 4000);
        grid.scrollTop = end * p;
        if (p < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  });
  report.scroll = await readFrames(PAGE);

  /* Between the packs. */
  await startFrames(PAGE);
  report.perSwitch = [];
  if (process.env.PERF_DEBUG) {
    await PAGE.evaluate(() => {
      window.__ops = [];
      const wrap = (name) => { const real = window[name]; if (typeof real !== 'function') return; window[name] = function wrapped(...args) { const t0 = performance.now(); const out = real.apply(this, args); const dt = performance.now() - t0; if (dt > 8) window.__ops.push(`${Math.round(t0)} ${name} ${Math.round(dt)}ms`); return out; }; };
      ['renderStickerPanel', 'observeLazyMedia', 'hydrateLottieNodes', 'giveLazyMedia', 'releaseLazyMedia', 'mountWorkerLottie', 'unmountLottieNode', 'sweepLottieNodes', 'pumpMotion', 'sweepStickerMotion', 'lottieTick', 'ensurePackCovers', 'paintStillIntoCell'].forEach(wrap);
      const tick = (now) => { if (window.__lastT && now - window.__lastT > 100) window.__ops.push(`${Math.round(window.__lastT)}..${Math.round(now)} FRAME GAP ${Math.round(now - window.__lastT)}ms`); window.__lastT = now; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  }
  for (const id of ['perf-video', 'perf-static', 'perf-lottie', 'perf-video', 'perf-lottie']) {
    const mark = await PAGE.evaluate(() => window.__frames.gaps.length);
    const clickMs = await PAGE.evaluate((packId) => { const t0 = performance.now(); document.querySelector(`#chatStickerTabs [data-chat-sticker-pack="${packId}"]`)?.click(); return Math.round(performance.now() - t0); }, id);
    await PAGE.waitForTimeout(1200);
    const gaps = await PAGE.evaluate((m) => window.__frames.gaps.slice(m), mark);
    report.perSwitch.push(`${id}:click${clickMs}:worst${Math.max(0, ...gaps)}:n${gaps.filter((g) => g > 100).length}`);
  }
  report.switching = await readFrames(PAGE);
  if (process.env.PERF_DEBUG) console.log('  errors after switching:', (PAGE.__errors || []).length);
  if (process.env.PERF_DEBUG) console.log('  ops:', JSON.stringify(await PAGE.evaluate(() => window.__ops.slice(0, 60))));

  console.log(`  report: ${JSON.stringify(report)}`);
  if (process.env.PERF_DEBUG) console.log('  debug:', JSON.stringify(await PAGE.evaluate(() => [...new Set(window.__dbg || [])].slice(0, 12))));
  check('every pack is brought up to date in the background', report.stills.every((s) => { const [a, b] = s.split(':')[1].split('/'); return Number(a) >= Number(b) * 0.9; }), JSON.stringify(report.stills));
  check('the page never stops for a quarter of a second while that runs', report.background.over250 === 0, JSON.stringify(report.background));
  check('the panel opens on the Lottie pack within a frame or two', report.open.firstFrameMs < 250, JSON.stringify(report.open));
  check('while its moving stickers start, the page never stops for a quarter of a second', report.open.over250 === 0, JSON.stringify(report.open));
  /* Measured against what this machine draws with nothing moving: headless
     Chromium draws far fewer frames than a screen even then, WebKit sixty. */
  const ceiling = report.still.fps;
  check('and with them all moving it keeps drawing smoothly', report.steady.fps >= ceiling * 0.75 && report.steady.over250 === 0, JSON.stringify({ ceiling, ...report.steady, ...report.animating }));
  check('scrolling the grid top to bottom keeps its frames', report.scroll.fps >= ceiling * 0.75 && report.scroll.over250 === 0, JSON.stringify({ ceiling, ...report.scroll }));
  check('switching between the packs never hangs', report.switching.over250 === 0, JSON.stringify(report.switching));
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
