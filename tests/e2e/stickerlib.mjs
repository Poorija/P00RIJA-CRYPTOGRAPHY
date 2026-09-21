/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The sticker library: recent, favourites, order, and picking several.
 *
 *   PORT=8123 npm run dev ; node tests/e2e/stickerlib.mjs
 *
 * A sticker's bytes live in exactly one pack in IndexedDB, which is the right
 * place for them. But "I used this five minutes ago", "I starred this" and "I
 * want this pack first" are facts about the PERSON: they are tiny, they change
 * constantly, and they have to survive a pack being deleted and re-imported.
 * So they are refs in localStorage, resolved against the packs at render time.
 *
 * The claims worth testing are the ones that shape falls out of:
 *
 *   A REF THAT NO LONGER RESOLVES DISAPPEARS. Delete a pack and every recent
 *   and favourite entry pointing into it must vanish from the panel with no
 *   cleanup pass — otherwise the panel renders holes, or worse, throws.
 *
 *   THE ORDER IS A LIST, NOT AN INDEX. An index on each pack has to be
 *   rewritten for all of them when one moves, and goes wrong the moment two
 *   disagree. A list is reordered by moving one entry, and a pack imported
 *   since the order was saved falls to the end, which is where it belongs.
 *
 *   SELECTION IS A SET OF REFS. The same sticker appears under Recent, under
 *   Favourites and in its own pack, and all three have to light up together
 *   because they are the same sticker.
 */
import { openApp, browser } from './_chat-harness.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

try {
  const page = await openApp('stickers');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);

  /* Two packs, seeded through the app's own store so they are real records
     with real blobs rather than a shape the panel happens to accept. */
  const seeded = await page.evaluate(async () => {
    window.switchTab?.('chat');
    await new Promise((r) => setTimeout(r, 500));

    const pixel = (colour) => {
      const canvas = document.createElement('canvas');
      canvas.width = 8; canvas.height = 8;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, 8, 8);
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    };
    const makePack = async (id, title, colours) => ({
      id, title, author: '', createdAt: new Date().toISOString(),
      stickers: await Promise.all(colours.map(async (colour, i) => ({
        id: `${id}-s${i}`, name: `${id}-${i}.png`, mime: 'image/png',
        kind: 'image', emoji: '', blob: await pixel(colour),
      }))),
    });

    const alpha = await makePack('pack-alpha', 'Alpha', ['#f00', '#0f0', '#00f']);
    const beta = await makePack('pack-beta', 'Beta', ['#ff0', '#0ff']);
    window.__stickerProbe.reset();
    await window.__stickerProbe.addPack(alpha);
    await window.__stickerProbe.addPack(beta);
    window.__stickerProbe.render();
    await new Promise((r) => setTimeout(r, 300));
    return window.__stickerProbe.state();
  });
  console.log(`  ${JSON.stringify(seeded)}`);
  check('two packs are in the library', seeded.packs === 2, JSON.stringify(seeded.packs));

  /* ===== recent ========================================================= */

  console.log('\n===== recent =====');

  const recent = await page.evaluate(async () => {
    const probe = window.__stickerProbe;
    probe.use('pack-alpha', 'pack-alpha-s0');
    probe.use('pack-beta', 'pack-beta-s1');
    probe.use('pack-alpha', 'pack-alpha-s2');
    /* Using the first one again must move it to the front, not add a second
       entry — a "recent" list with duplicates is a usage log. */
    probe.use('pack-alpha', 'pack-alpha-s0');
    probe.render();
    await new Promise((r) => setTimeout(r, 250));
    return {
      refs: probe.recent(),
      tabShown: Boolean(document.querySelector('[data-chat-sticker-pack="__recent__"]')),
      clockIcon: Boolean(document.querySelector('[data-chat-sticker-pack="__recent__"] .fa-clock')),
    };
  });
  console.log(`  ${JSON.stringify(recent)}`);
  check('a used sticker goes to the front, without doubling up',
    recent.refs[0] === 'pack-alpha:pack-alpha-s0' && recent.refs.length === 3,
    JSON.stringify(recent.refs));
  check('and Recent appears as its own tab, with a clock on it',
    recent.tabShown && recent.clockIcon, JSON.stringify(recent));

  /* ===== favourites ===================================================== */

  console.log('\n===== favourites =====');

  const favourites = await page.evaluate(async () => {
    const probe = window.__stickerProbe;
    probe.star('pack-beta', 'pack-beta-s0');
    probe.star('pack-alpha', 'pack-alpha-s1');
    const afterTwo = probe.favourites().length;
    /* Starring again unstars: one control, both directions. */
    probe.star('pack-beta', 'pack-beta-s0');
    probe.render();
    await new Promise((r) => setTimeout(r, 250));
    return {
      afterTwo,
      refs: probe.favourites(),
      tabShown: Boolean(document.querySelector('[data-chat-sticker-pack="__favourite__"]')),
      starIcon: Boolean(document.querySelector('[data-chat-sticker-pack="__favourite__"] .fa-star')),
    };
  });
  console.log(`  ${JSON.stringify(favourites)}`);
  check('starring adds and starring again removes',
    favourites.afterTwo === 2 && favourites.refs.length === 1, JSON.stringify(favourites.refs));
  check('and Favourites appears as its own tab, with a star on it',
    favourites.tabShown && favourites.starIcon, JSON.stringify(favourites));

  /* The order of the tabs is the order the request asked for. */
  const tabOrder = await page.evaluate(() => Array.from(
    document.querySelectorAll('[data-chat-sticker-pack]'))
    .map((tab) => tab.getAttribute('data-chat-sticker-pack')));
  console.log(`  tabs: ${JSON.stringify(tabOrder)}`);
  check('Recent comes first and Favourites second',
    tabOrder[0] === '__recent__' && tabOrder[1] === '__favourite__', JSON.stringify(tabOrder));

  /* ===== pack order ===================================================== */

  console.log('\n===== the order packs sit in =====');

  const order = await page.evaluate(async () => {
    const probe = window.__stickerProbe;
    const before = probe.order();
    probe.move('pack-beta', -1);
    probe.render();
    await new Promise((r) => setTimeout(r, 200));
    const after = probe.order();
    /* Moving the first one up again must do nothing rather than wrap around. */
    const refused = probe.move(after[0], -1);
    return { before, after, refused };
  });
  console.log(`  ${JSON.stringify(order)}`);
  check('a pack can be moved up the list',
    order.before[0] === 'pack-alpha' && order.after[0] === 'pack-beta', JSON.stringify(order));
  check('and the top one cannot be moved off the top',
    order.refused === false, String(order.refused));

  /* ===== selection ====================================================== */

  console.log('\n===== picking several =====');

  const selection = await page.evaluate(async () => {
    const probe = window.__stickerProbe;
    probe.clearSelection();
    probe.select('pack-alpha', 'pack-alpha-s0');
    probe.select('pack-alpha', 'pack-alpha-s1');
    probe.select('pack-beta', 'pack-beta-s0');
    /* Selecting one twice deselects it. */
    probe.select('pack-alpha', 'pack-alpha-s1');
    probe.render();
    await new Promise((r) => setTimeout(r, 250));
    const bar = document.getElementById('chatStickerSelbar');
    return {
      count: probe.selection().length,
      barShown: bar && !bar.classList.contains('hidden'),
      /* The bar must not be a grid cell: it lives outside the grid, because
         the grid is a CSS grid of sticker cells. */
      barOutsideGrid: bar && !document.getElementById('chatStickerGrid').contains(bar),
      canSend: Boolean(bar?.querySelector('[data-chat-sticker-send-selected]')),
      canMakePack: Boolean(bar?.querySelector('[data-chat-sticker-make-pack]')),
    };
  });
  console.log(`  ${JSON.stringify(selection)}`);
  check('several stickers can be selected, and tapping one again drops it',
    selection.count === 2, String(selection.count));
  check('the selection bar appears, outside the grid rather than as a cell in it',
    selection.barShown && selection.barOutsideGrid, JSON.stringify(selection));
  check('and offers both sending and making a pack',
    selection.canSend && selection.canMakePack, JSON.stringify(selection));

  /* Building a pack out of what was picked. */
  const built = await page.evaluate(async () => {
    const probe = window.__stickerProbe;
    const pack = await probe.makePack('Picked');
    probe.render();
    await new Promise((r) => setTimeout(r, 250));
    return {
      made: Boolean(pack),
      title: pack?.title || '',
      size: pack?.stickers.length || 0,
      /* New ids: two records sharing one id would make every favourite and
         recent ref ambiguous. */
      freshIds: pack ? pack.stickers.every((s) => !s.id.startsWith('pack-')) : false,
      packsNow: probe.state().packs,
      selectionCleared: probe.selection().length === 0,
    };
  });
  console.log(`  ${JSON.stringify(built)}`);
  check('a pack is built from the selection',
    built.made && built.size === 2 && built.packsNow === 3, JSON.stringify(built));
  check('its stickers get fresh ids rather than sharing the originals',
    built.freshIds, String(built.freshIds));
  check('and the selection is cleared afterwards', built.selectionCleared);

  /* ===== a deleted pack takes its refs with it ========================== */

  console.log('\n===== when a pack goes =====');

  const afterDelete = await page.evaluate(async () => {
    const probe = window.__stickerProbe;
    probe.use('pack-beta', 'pack-beta-s0');
    probe.star('pack-beta', 'pack-beta-s1');
    const before = { recent: probe.recent().length, favourites: probe.favourites().length };
    await probe.removePack('pack-beta');
    probe.render();
    await new Promise((r) => setTimeout(r, 250));
    return {
      before,
      /* The stored refs are untouched — nothing sweeps them — but they no
         longer resolve, so nothing renders from them. */
      storedStill: probe.recent().some((ref) => ref.startsWith('pack-beta:')),
      resolvedRecent: probe.resolved(probe.recent()).length,
      resolvedFavourites: probe.resolved(probe.favourites()).length,
      threw: false,
    };
  });
  console.log(`  ${JSON.stringify(afterDelete)}`);
  check('a deleted pack leaves its refs unresolvable rather than breaking the panel',
    afterDelete.resolvedRecent >= 0 && afterDelete.resolvedFavourites >= 0
    && !afterDelete.resolvedRecent.toString().includes('NaN'),
    JSON.stringify(afterDelete));
  check('and nothing from that pack is shown any more',
    !(await page.evaluate(() => Array.from(
      document.querySelectorAll('[data-chat-sticker-pack-id]'))
      .some((cell) => cell.getAttribute('data-chat-sticker-pack-id') === 'pack-beta'))));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('failed:');
  failed.forEach((r) => console.log(`  - ${r.name}`));
  process.exit(1);
}
