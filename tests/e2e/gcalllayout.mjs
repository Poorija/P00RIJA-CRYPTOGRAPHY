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

   How a group call arranges the people in it.

   The stage was a masonry column layout that scrolled, so with more than a
   few people some of them were below the fold - including, sometimes, whoever
   had just started speaking. Every serious client fits every tile into the
   visible area instead and sizes them to whatever that allows.

   Two halves are checked separately: the arithmetic that picks the shape, in
   isolation, and then the real stage in a real call. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const PASS = 'Harness#Pass2026!';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
async function app(tag) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('poorija_lang', 'fa'); } catch (e) {} window.__clip = []; window.__err = [];
    window.addEventListener('error', (e) => window.__err.push('ERR ' + e.message)); });
  const page = await ctx.newPage(); page.on('dialog', (d) => d.accept());
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
  await page.waitForTimeout(2500);
  await page.evaluate((name) => {
    const w = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__clip.push(t); return w(t).catch(() => {}); };
    const n = document.getElementById('chatDisplayName'); if (n) { n.value = name; n.dispatchEvent(new Event('input', { bubbles: true })); }
    document.getElementById('chatSaveProfileBtn')?.click();
    document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat');
  }, tag);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById('chatConnectBtn')?.click());
  await page.waitForTimeout(6500);
  return page;
}
const imp = (p, x) => p.evaluate(async (t) => {
  document.getElementById('chatStartChatBtn')?.click();
  await new Promise((r) => setTimeout(r, 500));
  document.querySelector('[data-chat-manual-json]').value = t;
  document.querySelector('[data-chat-manual-submit]')?.click();
}, x);
const idOf = (p) => p.evaluate(async () => { await window.copyChatFullIdentity(); return window.__clip.at(-1); });

const A = await app('ALPHA'); const B = await app('BETA'); const C = await app('GAMMA');
const idA = await idOf(A); const idB = await idOf(B); const idC = await idOf(C);
const fpOf = (x) => JSON.parse(atob(x.replace('poorija-chat-v1:', '')))?.fingerprint;
const fpB = fpOf(idB); const fpC = fpOf(idC);
await imp(A, idB); await imp(A, idC); await imp(B, idA); await imp(B, idC); await imp(C, idA); await imp(C, idB);
await A.waitForTimeout(4000);

console.log('\n===== the arithmetic, on its own =====');
const fits = await A.evaluate(() => {
  const probe = window.__gcallFitProbe;
  if (!probe) return null;
  const wide = (n) => probe(n, 1200, 700, 16 / 9);
  const tall = (n) => probe(n, 390, 700, 3 / 4);
  return {
    wide: [1, 2, 3, 4, 6, 9].map((n) => ({ n, c: wide(n).columns, r: wide(n).rows })),
    /* A landscape room never gets a portrait arrangement, and the reverse. */
    orientation: [2, 3, 5, 6, 8].every((n) => wide(n).columns >= wide(n).rows)
      && [2, 3, 5, 6].every((n) => tall(n).rows >= tall(n).columns),
    tall: [1, 2, 3, 4, 6].map((n) => ({ n, c: tall(n).columns, r: tall(n).rows })),
    /* Every tile has to be inside the box it was measured for. */
    inside: [2, 3, 5, 7, 12].every((n) => {
      const f = probe(n, 1200, 700, 16 / 9);
      return f.tileWidth * f.columns <= 1200 + 1 && f.tileHeight * f.rows <= 700 + 1;
    }),
  };
});
console.log('  wide 1200x700: ' + JSON.stringify(fits?.wide));
console.log('  tall  390x700: ' + JSON.stringify(fits?.tall));
check('the layout arithmetic is there', Boolean(fits), String(Boolean(fits)));
check('one person fills the box', fits?.wide[0].c === 1 && fits?.wide[0].r === 1, JSON.stringify(fits?.wide[0]));
check('two side by side on a wide screen', fits?.wide[1].c === 2 && fits?.wide[1].r === 1, JSON.stringify(fits?.wide[1]));
check('three make a two-by-two on a wide screen', fits?.wide[2].c === 2 && fits?.wide[2].r === 2, JSON.stringify(fits?.wide[2]));
check('six make three across and two down', fits?.wide[4].c === 3 && fits?.wide[4].r === 2, JSON.stringify(fits?.wide[4]));
check('and stacked on a tall narrow one', fits?.tall[1].c === 1 && fits?.tall[1].r === 2, JSON.stringify(fits?.tall[1]));
check('four make a square', fits?.wide[3].c === 2 && fits?.wide[3].r === 2, JSON.stringify(fits?.wide[3]));
check('nine make three by three', fits?.wide[5].c === 3 && fits?.wide[5].r === 3, JSON.stringify(fits?.wide[5]));
check('every arrangement fits inside the box it was given', fits?.inside === true, String(fits?.inside));
check('the arrangement follows the shape of the room', fits?.orientation === true, String(fits?.orientation));

console.log('\n===== a real call, on a desktop =====');
await A.evaluate(() => document.querySelector('[data-chat-view="calls"]')?.click());
await A.waitForTimeout(1200);
await A.evaluate(() => document.querySelector('[data-adhoc-call="video"]')?.click());
await A.waitForTimeout(900);
/* By fingerprint, not "everything in the list": a shared relay advertises
   real devices too, and picking those would ring somebody's actual phone. */
await A.evaluate(({ b, c }) => {
  document.querySelectorAll('#chatCallPickerList input[type="checkbox"]').forEach((box) => {
    box.checked = (box.value === b || box.value === c);
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });
}, { b: fpB, c: fpC });
await A.waitForTimeout(500);
await A.evaluate(() => document.querySelector('[data-call-picker-go]')?.click());
await Promise.all([B.waitForTimeout(7000), C.waitForTimeout(7000)]);
for (const page of [B, C]) {
  await page.evaluate(() => document.querySelector('[data-gcall-accept]')?.click());
  await page.waitForTimeout(1200);
}
await A.waitForTimeout(9000);

const measure = (page) => page.evaluate(() => {
  const stage = document.getElementById('chatGroupCallGrid');
  if (!stage) return { missing: true };
  const box = stage.getBoundingClientRect();
  const tiles = [...stage.querySelectorAll('.chat-gcall-tile')].map((tile) => {
    const r = tile.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
  return {
    mode: stage.dataset.gcallMode || '',
    scrollsDown: stage.scrollHeight > stage.clientHeight + 2,
    scrollsAcross: stage.scrollWidth > stage.clientWidth + 2,
    tiles: tiles.length,
    /* Fully inside the stage, with a pixel of slack for rounding. */
    allInside: tiles.every((tl) => tl.x >= Math.floor(box.left) - 1 && tl.y >= Math.floor(box.top) - 1
      && tl.x + tl.w <= Math.ceil(box.right) + 1 && tl.y + tl.h <= Math.ceil(box.bottom) + 1),
    smallest: tiles.length ? Math.min(...tiles.map((tl) => tl.w * tl.h)) : 0,
    /* Position is not shape. A tile can be entirely inside the stage and still
       be a 90px-wide ribbon, which is exactly what shipped. */
    shapes: [...stage.querySelectorAll('.chat-gcall-tile .chat-gcall-frame')].map((f) => {
      const r = f.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), ratio: Number((r.width / r.height).toFixed(2)),
        cssAspect: getComputedStyle(f).aspectRatio };
    }),
    columns: Number(getComputedStyle(stage).getPropertyValue('--gcall-columns')) || 0,
    /* Where each row sits, so a short last row can be checked for being
       centred rather than left in a corner. */
    rows: (() => {
      const byTop = new Map();
      [...stage.querySelectorAll(':scope > .chat-gcall-tile')].forEach((tile) => {
        const r = tile.getBoundingClientRect();
        const key = Math.round(r.top);
        if (!byTop.has(key)) byTop.set(key, []);
        byTop.get(key).push({ left: Math.round(r.left), right: Math.round(r.right) });
      });
      const box = stage.getBoundingClientRect();
      return [...byTop.entries()].sort((a, b) => a[0] - b[0]).map(([, cells]) => {
        const left = Math.min(...cells.map((c) => c.left));
        const right = Math.max(...cells.map((c) => c.right));
        return { n: cells.length, gapStart: Math.round(left - box.left), gapEnd: Math.round(box.right - right) };
      });
    })(),
  };
});

const onDesktop = await measure(A);
console.log('  ' + JSON.stringify(onDesktop));
check('three people are on the stage', onDesktop.tiles === 3, `${onDesktop.tiles} tile(s)`);
check('the stage does not scroll', !onDesktop.scrollsDown && !onDesktop.scrollsAcross, JSON.stringify(onDesktop));
check('and every tile is inside it', onDesktop.allInside === true, JSON.stringify(onDesktop));
check('nobody is reduced to a sliver', onDesktop.smallest > 8000, `smallest tile ${onDesktop.smallest}px²`);
/* A face needs a frame roughly as wide as it is tall. Anything narrower than
   about one to three is a ribbon, whatever its area. */
check('and every frame is a usable shape, not a ribbon',
  onDesktop.shapes.every((s2) => s2.ratio >= 0.34 && s2.ratio <= 3.2),
  JSON.stringify(onDesktop.shapes));
/* Three people are two above and one centred below, not two above and one in
   the corner. Meet and Zoom both do this. */
console.log('  rows: ' + JSON.stringify(onDesktop.rows));
check('three people are two above and one below', onDesktop.rows.length === 2
  && onDesktop.rows[0].n === 2 && onDesktop.rows[1].n === 1, JSON.stringify(onDesktop.rows));
check('and the one below is centred, not pushed into a corner',
  onDesktop.rows.length === 2 && Math.abs(onDesktop.rows[1].gapStart - onDesktop.rows[1].gapEnd) <= 6,
  JSON.stringify(onDesktop.rows[1]));
check('the tiles are landscape, the shape a camera makes',
  onDesktop.shapes.every((s2) => s2.ratio > 1), JSON.stringify(onDesktop.shapes.map((x) => x.ratio)));

console.log('\n===== pinning somebody =====');
await A.evaluate(() => document.querySelector('.chat-gcall-tile:not(.is-pinned) [data-gcall-pin]')?.click());
await A.waitForTimeout(1200);
const pinnedView = await A.evaluate(() => {
  const stage = document.getElementById('chatGroupCallGrid');
  const pinned = stage?.querySelector('.chat-gcall-tile.is-pinned');
  const rail = stage?.querySelector('.chat-gcall-rail');
  const box = stage?.getBoundingClientRect();
  const p = pinned?.getBoundingClientRect();
  return {
    mode: stage?.dataset.gcallMode || '',
    hasPinned: Boolean(pinned),
    railTiles: rail ? rail.querySelectorAll('.chat-gcall-tile').length : 0,
    /* The pinned tile has to be the big one, not just the first one. */
    pinnedShare: (p && box) ? Math.round((p.width * p.height) / (box.width * box.height) * 100) : 0,
    stillPlaying: [...(stage?.querySelectorAll('video') || [])].filter((v) => v.srcObject).length,
  };
});
console.log('  ' + JSON.stringify(pinnedView));
check('a pin puts one person on the stage', pinnedView.hasPinned === true, JSON.stringify(pinnedView));
check('and the rest into a strip', pinnedView.railTiles === 2, `${pinnedView.railTiles} in the rail`);
check('the pinned tile is the big one', pinnedView.pinnedShare >= 45, `${pinnedView.pinnedShare}% of the stage`);
check('and nobody lost their picture when the layout changed',
  pinnedView.stillPlaying >= 2, `${pinnedView.stillPlaying} live video element(s)`);

await A.evaluate(() => document.querySelector('.chat-gcall-tile.is-pinned [data-gcall-pin]')?.click());
await A.waitForTimeout(1200);
const unpinned = await measure(A);
console.log('  ' + JSON.stringify(unpinned));
check('unpinning goes back to the grid', unpinned.mode === 'grid' && unpinned.tiles === 3, JSON.stringify(unpinned));
check('and it still does not scroll', !unpinned.scrollsDown && !unpinned.scrollsAcross, JSON.stringify(unpinned));

console.log('\n===== the same call on a phone =====');
await A.setViewportSize({ width: 390, height: 844 });
await A.waitForTimeout(1800);
const onPhone = await measure(A);
console.log('  ' + JSON.stringify(onPhone));
check('a phone shows all three too', onPhone.tiles === 3, `${onPhone.tiles} tile(s)`);
check('without scrolling', !onPhone.scrollsDown && !onPhone.scrollsAcross, JSON.stringify(onPhone));
check('and without anybody hanging over the edge', onPhone.allInside === true, JSON.stringify(onPhone));
check('with frames a face fits in, not ribbons',
  onPhone.shapes.every((s2) => s2.ratio >= 0.34 && s2.ratio <= 3.2), JSON.stringify(onPhone.shapes));
console.log('  phone rows: ' + JSON.stringify(onPhone.rows));
check('and a short last row is centred on a phone too',
  onPhone.rows.length < 2 || Math.abs(onPhone.rows[onPhone.rows.length - 1].gapStart
    - onPhone.rows[onPhone.rows.length - 1].gapEnd) <= 6, JSON.stringify(onPhone.rows));

await A.setViewportSize({ width: 1024, height: 768 });
await A.waitForTimeout(1600);
const onTablet = await measure(A);
console.log('  ' + JSON.stringify(onTablet));
check('a tablet is no different', onTablet.tiles === 3 && onTablet.allInside === true
  && !onTablet.scrollsDown && !onTablet.scrollsAcross, JSON.stringify(onTablet));

const errs = await Promise.all([A, B, C].map((p) => p.evaluate(() => (window.__err || []).slice(-3))));
check('nothing threw on any of the three', errs.every((list) => list.length === 0), JSON.stringify(errs));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
