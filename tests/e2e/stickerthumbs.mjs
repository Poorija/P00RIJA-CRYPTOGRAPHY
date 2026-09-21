/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Thumbnails on the sticker pack manager's rows.
 *
 * Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
 *
 *   node tests/e2e/stickerthumbs.mjs
 *
 * A row that says only "<name> · 24 stickers" is a row nobody can tell from
 * the one above it: the names are the user's own and they blur together, while
 * the pictures never do.
 *
 * The packs are built in the page rather than imported from a fixture, because
 * what is under test is the row's rendering and not the import path — stickers
 * .mjs owns that. The bounding box is deliberately not asserted on: with no
 * conversation open the chat pane is collapsed and every descendant measures
 * zero, so the computed size is what says the rule reached the element. */
import { openApp, browser } from './_chat-harness.mjs';
const A = await openApp('STICKERS');
const results = [];
const check = (n, ok, d='') => { results.push(ok); console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

console.log('\n===== the manage rows carry their own stickers =====');
const seen = await A.evaluate(async () => {
  /* Real PNG bytes, so the thumbnails decode and lay out rather than being
     broken images that still count in a querySelectorAll. */
  const png = (hue) => {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = `hsl(${hue} 80% 55%)`;
    context.fillRect(0, 0, 32, 32);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  };
  const makePack = async (title, count) => ({
    id: `probe-${title}`,
    title,
    author: 'probe',
    source: 'local',
    stickers: await Promise.all(Array.from({ length: count }, async (_unused, index) => ({
      id: `${title}-${index}`,
      name: `s${index}`,
      emoji: '🙂',
      kind: 'image',
      blob: await png(index * 37),
    }))),
  });
  chatState.stickerPacks = [await makePack('small', 3), await makePack('big', 11)];
  chatState.stickerActivePackId = 'probe-small';
  chatState.stickerManageMode = true;
  document.getElementById('chatStickerPanel')?.classList.remove('hidden');
  renderStickerPanel();
  await new Promise((r) => setTimeout(r, 700));
  return [...document.querySelectorAll('.chat-sticker-manage-row')].map((row) => ({
    title: row.querySelector('.chat-sticker-manage-title')?.textContent.trim(),
    thumbs: row.querySelectorAll('.chat-sticker-manage-thumb').length,
    allBlobs: [...row.querySelectorAll('.chat-sticker-manage-thumb')]
      .every((el) => (el.getAttribute('src') || '').startsWith('blob:')),
    /* The bounding box is the wrong measure here: with no conversation open
       the chat pane itself is collapsed, so every descendant reads zero and
       the answer would be about the harness, not about the strip. What this
       change is responsible for is that the rule reaches the element, which is
       what the computed size says. */
    sized: [...row.querySelectorAll('.chat-sticker-manage-thumb')]
      .every((el) => parseFloat(getComputedStyle(el).width) > 12
        && parseFloat(getComputedStyle(el).height) > 12),
    fitted: [...row.querySelectorAll('.chat-sticker-manage-thumb')]
      .every((el) => getComputedStyle(el).objectFit === 'contain'),
    more: row.querySelector('.chat-sticker-manage-more')?.textContent || '',
    distinct: new Set([...row.querySelectorAll('.chat-sticker-manage-thumb')]
      .map((el) => el.getAttribute('src'))).size,
    rowWidth: Math.round(row.getBoundingClientRect().width),
    panelHidden: document.getElementById('chatStickerPanel')?.classList.contains('hidden'),
    inContentChat: Boolean(row.closest('#content-chat')),
    thumbCss: (() => { const el = row.querySelector('.chat-sticker-manage-thumb');
      if (!el) return null; const cs = getComputedStyle(el);
      return { width: cs.width, display: cs.display, complete: el.complete }; })(),
  }));
});
seen.forEach((row) => console.log('  ' + JSON.stringify(row)));
check('both packs have a thumbnail strip', seen.length === 2 && seen.every((r) => r.thumbs > 0),
  seen.map((r) => `${r.title}:${r.thumbs}`).join(' '));
check('a small pack shows all of its stickers', seen.find((r) => r.title === 'small')?.thumbs === 3,
  String(seen.find((r) => r.title === 'small')?.thumbs));
check('and says nothing about more', seen.find((r) => r.title === 'small')?.more === '',
  seen.find((r) => r.title === 'small')?.more || '(none)');
check('a big pack is capped at six', seen.find((r) => r.title === 'big')?.thumbs === 6,
  String(seen.find((r) => r.title === 'big')?.thumbs));
check('and says how many it is not showing', seen.find((r) => r.title === 'big')?.more === '+5',
  seen.find((r) => r.title === 'big')?.more);
check('every thumbnail is a real sticker, not a placeholder', seen.every((r) => r.allBlobs),
  seen.map((r) => r.allBlobs).join(' '));
check('each one is given a real size by the stylesheet', seen.every((r) => r.sized),
  JSON.stringify(seen.map((r) => r.thumbCss?.width)));
check('and a tall sticker is fitted rather than cropped', seen.every((r) => r.fitted),
  seen.map((r) => r.fitted).join(' '));
check('they are different stickers, not the same one repeated',
  seen.every((r) => r.distinct === r.thumbs), seen.map((r) => `${r.distinct}/${r.thumbs}`).join(' '));

console.log('\n===== a pack with no stickers shows no empty strip =====');
const empty = await A.evaluate(async () => {
  chatState.stickerPacks = [{ id: 'probe-empty', title: 'empty', source: 'local', stickers: [] }];
  chatState.stickerManageMode = true;
  renderStickerPanel();
  await new Promise((r) => setTimeout(r, 400));
  return {
    rows: document.querySelectorAll('.chat-sticker-manage-row').length,
    strips: document.querySelectorAll('.chat-sticker-manage-strip').length,
  };
});
check('the row is still listed', empty.rows === 1, JSON.stringify(empty));
check('but carries no strip at all', empty.strips === 0, JSON.stringify(empty));

const failed = results.filter((r) => !r).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
await browser.close();
process.exit(failed ? 1 : 0);
