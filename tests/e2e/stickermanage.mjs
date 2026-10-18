/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Managing stickers and GIFs one by one.
 *
 *   - the select button starts picking with nothing picked; a tap then picks
 *     instead of sending, and the bar's actions wait for a pick;
 *   - picked stickers copy into another pack (new ids, same pictures), move
 *     into one (their favourite star goes with them), or are deleted — and a
 *     pack left empty goes;
 *   - picked from "My stickers" works the same;
 *   - a GIF sticker copies onto the GIF shelf;
 *   - on the GIF shelf a long press starts picking; picked GIFs send, copy
 *     into a sticker pack, and delete;
 *   - the pack manager's back arrow and order arrows are icons that draw.
 */
import { openApp, browser } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 260) : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const GIF_B64 = 'R0lGODlhCAAIAPABAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQEFAAAACwAAAAACAAIAAACB4SPqcvtD1wAIfkEBBQAAAAsAAAAAAgACAAAAgeEj6nL7Q9cADs=';

const stacks = await startTwoStacks();
try {
  const PAGE = await openApp('STICKERS', { origin: stacks.a.url, relay: stacks.a.url, context: { viewport: { width: 390, height: 844 } } });
  await PAGE.evaluate(async (gif) => {
    window.__sent = [];
    window.sendStickerRecord = async (record) => { window.__sent.push(record.id); };
    window.sendGifBlob = async (blob) => { window.__sent.push(`gif:${blob.size}`); return true; };
    window.__choose = null;
    PoorijaDialogs.choose = async () => window.__choose;
    PoorijaDialogs.confirm = async () => true;
    PoorijaDialogs.prompt = async () => 'Fresh pack';
    const png = (hue) => new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const paint = canvas.getContext('2d');
      paint.fillStyle = `hsl(${hue} 80% 50%)`; paint.fillRect(0, 0, 64, 64);
      canvas.toBlob(resolve, 'image/png');
    });
    const gifBlob = new Blob([Uint8Array.from(atob(gif), (c) => c.charCodeAt(0))], { type: 'image/gif' });
    const sticker = async (pack, i, blob) => ({ id: `${pack}-s${i}`, name: `s${i}.png`, mime: blob.type, kind: 'image', emoji: '', blob });
    const probe = window.__stickerProbe;
    probe.reset();
    await probe.addPack({ id: 'pack-a', title: 'Alpha', author: '', source: 'import', createdAt: new Date().toISOString(),
      stickers: [await sticker('pack-a', 0, await png(10)), await sticker('pack-a', 1, await png(60)), await sticker('pack-a', 2, await png(120)), { id: 'pack-a-gif', name: 'party.gif', mime: 'image/gif', kind: 'image', emoji: '', blob: gifBlob }] });
    await probe.addPack({ id: 'pack-b', title: 'Beta', author: '', source: 'import', createdAt: new Date().toISOString(),
      stickers: [await sticker('pack-b', 0, await png(200))] });
    await probe.addPack({ id: 'pack-mine', title: 'My stickers', author: '', source: 'custom', createdAt: new Date().toISOString(),
      stickers: [await sticker('pack-mine', 0, await png(300))] });
    openSavedMessages();
    await new Promise((r) => setTimeout(r, 300));
    chatState.stickerActivePackId = 'pack-a';
    setStickerPanelVisible(true, { shelf: 'stickers' });
    await new Promise((r) => setTimeout(r, 400));
  }, GIF_B64);

  section('the select button');
  const picking = await PAGE.evaluate(async () => {
    document.getElementById('chatStickerSelectBtn').click();
    await new Promise((r) => setTimeout(r, 250));
    const bar = document.getElementById('chatStickerSelbar');
    const disabledBefore = [...bar.querySelectorAll('[data-chat-sticker-delete-selected], [data-chat-sticker-copy-selected], [data-chat-sticker-move-selected]')].every((b) => b.disabled);
    document.querySelector('#chatStickerGrid [data-chat-sticker-send="pack-a-s0"]').click();
    await new Promise((r) => setTimeout(r, 250));
    return {
      barShown: !bar.classList.contains('hidden'),
      disabledBefore,
      picked: window.__stickerProbe.selection(),
      sent: window.__sent.length,
      enabledAfter: [...bar.querySelectorAll('[data-chat-sticker-delete-selected], [data-chat-sticker-copy-selected], [data-chat-sticker-move-selected]')].every((b) => !b.disabled),
    };
  });
  check('it starts picking with nothing picked, and the actions wait for a pick', picking.barShown && picking.disabledBefore, JSON.stringify(picking));
  check('a tap then picks instead of sending', picking.picked.length === 1 && picking.sent === 0 && picking.enabledAfter, JSON.stringify(picking));

  section('copy, move, delete');
  const copied = await PAGE.evaluate(async () => {
    const probe = window.__stickerProbe;
    probe.select('pack-a', 'pack-a-s1');
    window.__choose = 'pack-b';
    document.querySelector('[data-chat-sticker-copy-selected]').click();
    await new Promise((r) => setTimeout(r, 500));
    return probe.packs();
  });
  const alpha = copied.find((p) => p.id === 'pack-a');
  const beta = copied.find((p) => p.id === 'pack-b');
  check('copied into Beta: two new stickers there, Alpha untouched',
    alpha.ids.length === 4 && beta.ids.length === 3 && !beta.ids.includes('pack-a-s0') && !beta.ids.includes('pack-a-s1'), JSON.stringify(copied));

  const moved = await PAGE.evaluate(async () => {
    const probe = window.__stickerProbe;
    probe.star('pack-a', 'pack-a-s2');
    probe.select('pack-a', 'pack-a-s2');
    window.__choose = 'pack-mine';
    probe.render();
    await new Promise((r) => setTimeout(r, 200));
    document.querySelector('[data-chat-sticker-move-selected]').click();
    await new Promise((r) => setTimeout(r, 500));
    return { packs: probe.packs(), favourites: probe.favourites() };
  });
  const mine = moved.packs.find((p) => p.id === 'pack-mine');
  check('moved into My stickers, with the same id, out of Alpha',
    mine.ids.includes('pack-a-s2') && !moved.packs.find((p) => p.id === 'pack-a').ids.includes('pack-a-s2'), JSON.stringify(moved.packs));
  check('and its favourite star went with it', moved.favourites.includes('pack-mine:pack-a-s2') && !moved.favourites.includes('pack-a:pack-a-s2'), JSON.stringify(moved.favourites));

  const deleted = await PAGE.evaluate(async () => {
    const probe = window.__stickerProbe;
    probe.select('pack-mine', 'pack-mine-s0');
    probe.render();
    await new Promise((r) => setTimeout(r, 200));
    document.querySelector('[data-chat-sticker-delete-selected]').click();
    await new Promise((r) => setTimeout(r, 500));
    return probe.packs();
  });
  check('deleted from My stickers', !deleted.find((p) => p.id === 'pack-mine').ids.includes('pack-mine-s0'), JSON.stringify(deleted));

  const emptied = await PAGE.evaluate(async () => {
    const probe = window.__stickerProbe;
    probe.select('pack-mine', 'pack-a-s2');
    await probe.deleteSelected();
    return probe.packs().map((p) => p.id);
  });
  check('a pack left with nothing in it goes', !emptied.includes('pack-mine'), JSON.stringify(emptied));

  const toShelf = await PAGE.evaluate(async () => {
    const probe = window.__stickerProbe;
    const before = window.__gifProbe.library().length;
    probe.select('pack-a', 'pack-a-gif');
    await probe.copySelected('__gifs__');
    return { before, after: window.__gifProbe.library().length };
  });
  check('a GIF sticker copies onto the GIF shelf', toShelf.after === toShelf.before + 1, JSON.stringify(toShelf));

  section('the GIF shelf');
  const gifs = await PAGE.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    for (let i = 0; i < 4; i += 1) { const copy = bytes.slice(); copy[copy.length - 2] = 40 + i; await window.__gifProbe.save(new Blob([copy], { type: 'image/gif' })); }
    setStickerPanelVisible(true, { shelf: 'gifs' });
    await new Promise((r) => setTimeout(r, 400));
    const cells = [...document.querySelectorAll('#chatStickerGrid .chat-gif-cell')];
    const first = cells[0];
    const rect = first.getBoundingClientRect();
    first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
    await new Promise((r) => setTimeout(r, 600));
    first.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    const afterHold = window.__gifProbe.picked().length;
    document.querySelectorAll('#chatStickerGrid .chat-gif-cell')[1].click();
    await new Promise((r) => setTimeout(r, 250));
    return { count: cells.length, afterHold, picked: window.__gifProbe.picked().length, ticks: document.querySelectorAll('#chatStickerGrid .chat-gif-cell.is-picked').length, sent: window.__sent.length };
  }, GIF_B64);
  check('a long press starts picking, and a tap adds another without sending', gifs.afterHold === 1 && gifs.picked === 2 && gifs.ticks === 2 && gifs.sent === 0, JSON.stringify(gifs));
  const gifToPack = await PAGE.evaluate(async () => {
    window.__choose = 'pack-b';
    const before = window.__stickerProbe.packs().find((p) => p.id === 'pack-b').ids.length;
    document.querySelector('[data-chat-gif-copy-picked]').click();
    await new Promise((r) => setTimeout(r, 500));
    return { before, after: window.__stickerProbe.packs().find((p) => p.id === 'pack-b').ids.length };
  });
  check('picked GIFs copy into a sticker pack', gifToPack.after === gifToPack.before + 2, JSON.stringify(gifToPack));
  const gifDelete = await PAGE.evaluate(async () => {
    const lib = window.__gifProbe.library();
    window.__gifProbe.pick(lib[0].id);
    window.__gifProbe.pick(lib[1].id);
    document.querySelector('[data-chat-gif-delete-picked]').click();
    await new Promise((r) => setTimeout(r, 500));
    return { before: lib.length, after: window.__gifProbe.library().length };
  });
  check('picked GIFs delete', gifDelete.after === gifDelete.before - 2, JSON.stringify(gifDelete));
  const gifSend = await PAGE.evaluate(async () => {
    const lib = window.__gifProbe.library();
    const before = window.__sent.length;
    window.__gifProbe.pick(lib[0].id);
    document.querySelector('[data-chat-gif-send-picked]').click();
    await new Promise((r) => setTimeout(r, 500));
    return { sent: window.__sent.length - before, pickingAfter: window.__gifProbe.picked().length };
  });
  check('picked GIFs send, and picking ends', gifSend.sent === 1 && gifSend.pickingAfter === 0, JSON.stringify(gifSend));

  section('the pack manager on a phone');
  const manager = await PAGE.evaluate(async () => {
    setStickerPanelVisible(true, { shelf: 'stickers' });
    openPackManager();
    await new Promise((r) => setTimeout(r, 300));
    const back = document.querySelector('.packman-back');
    const icon = back?.querySelector('i');
    const iconBox = icon?.getBoundingClientRect();
    const glyph = icon ? getComputedStyle(icon, '::before').content : '';
    const arrows = [...document.querySelectorAll('.packman-move button i')].length;
    closePackManager();
    return { shown: Boolean(back) && getComputedStyle(back).display !== 'none', icon: icon?.className || '', width: Math.round(iconBox?.width || 0), glyph, font: icon ? getComputedStyle(icon).fontFamily : '', arrows };
  });
  check('the back button draws an arrow icon, and so do the order buttons',
    manager.shown && /fa-arrow-(right|left)/.test(manager.icon) && manager.width >= 10 && manager.glyph && manager.glyph !== 'none' && manager.arrows >= 2, JSON.stringify(manager));

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
