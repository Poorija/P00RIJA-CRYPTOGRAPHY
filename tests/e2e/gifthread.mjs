/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* GIFs one after another in a conversation, and the thread holding still.
 *
 *   Every redraw rebuilds every bubble, and WebKit decodes each picture again.
 *   A GIF bubble took its height from its picture, so for a moment it had
 *   none: the reader's place was restored against that, then the GIFs filled
 *   in and the thread slid — sending several in a row left the view on an
 *   earlier one instead of the newest. Here:
 *
 *   - a GIF bubble whose picture has not loaded already stands at its height;
 *   - sending GIFs one after another keeps the newest in view, at the bottom;
 *   - selecting GIF messages, and redrawing, leaves the reader where they were;
 *   - a GIF that came without its size learns it the first time it loads.
 */
import { openApp, browser } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 260) : ''}`);
};

const stacks = await startTwoStacks();
try {
  const PAGE = await openApp('THREAD', { origin: stacks.a.url, relay: stacks.a.url, context: { viewport: { width: 390, height: 844 } } });
  await PAGE.evaluate(async () => {
    window.__gif = (hue, w = 240, h = 180) => new Promise((resolve) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = `hsl(${hue} 80% 50%)`; g.fillRect(0, 0, w, h);
      c.toBlob((b) => resolve(new Blob([b], { type: 'image/gif' })), 'image/png');
    });
    for (let i = 0; i < 3; i += 1) await keepTextInSaved(`before ${i}`);
    openSavedMessages();
    await new Promise((r) => setTimeout(r, 500));
  });

  const unloaded = await PAGE.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'chat-message-bubble chat-sticker-bubble is-gif';
    host.innerHTML = `<div class="chat-sticker-body">${stickerMediaHtml('blob:http://localhost/never-there', 'gif', 'chat-sticker-media chat-gif-media', { width: 200, height: 100 })}</div>`;
    document.getElementById('chatMessages').appendChild(host);
    const img = host.querySelector('img');
    const box = img.getBoundingClientRect();
    host.remove();
    return { w: Math.round(box.width), h: Math.round(box.height) };
  });
  check('a GIF whose picture has not loaded already stands at its height', unloaded.h > 50 && Math.abs(unloaded.w / unloaded.h - 2) < 0.05, JSON.stringify(unloaded));

  const sends = await PAGE.evaluate(async () => {
    const thread = document.getElementById('chatMessages');
    const fromBottom = () => Math.round(thread.scrollHeight - thread.scrollTop - thread.clientHeight);
    const after = [];
    for (let k = 0; k < 5; k += 1) {
      await sendGifBlob(await window.__gif(k * 50, 240, 300));
      await new Promise((r) => setTimeout(r, 700));
      after.push(fromBottom());
    }
    await new Promise((r) => setTimeout(r, 800));
    const bubbles = [...thread.querySelectorAll('.chat-sticker-bubble.is-gif')];
    const last = bubbles[bubbles.length - 1].getBoundingClientRect();
    const box = thread.getBoundingClientRect();
    return { after, settled: fromBottom(), lastFullyInView: last.top >= box.top - 1 && last.bottom <= box.bottom + 1 };
  });
  check('GIFs sent one after another keep the newest in view, at the bottom', sends.after.every((d) => d <= 2) && sends.settled <= 2 && sends.lastFullyInView, JSON.stringify(sends));

  const held = await PAGE.evaluate(async () => {
    const thread = document.getElementById('chatMessages');
    const bubbles = [...thread.querySelectorAll('.chat-sticker-bubble.is-gif')];
    /* Placed without the thread's smooth scrolling, so nothing is still
       gliding when the place is measured. */
    scrollThreadTo(thread, bubbles[1].offsetTop - 20);
    await new Promise((r) => setTimeout(r, 300));
    const id = bubbles[1].getAttribute('data-id');
    const place = () => Math.round(thread.querySelector(`[data-id="${id}"]`).getBoundingClientRect().top);
    const before = place();
    const node = thread.querySelector(`[data-id="${id}"]`);
    enterSelectionMode(id);
    await new Promise((r) => setTimeout(r, 400));
    const afterSelect = place();
    thread.querySelector(`[data-id="${bubbles[2].getAttribute('data-id')}"]`).click();
    await new Promise((r) => setTimeout(r, 400));
    const afterTap = place();
    const sameNode = thread.querySelector(`[data-id="${id}"]`) === node;
    exitSelectionMode();
    renderMessages();
    await new Promise((r) => setTimeout(r, 400));
    return { before, afterSelect, afterTap, afterRedraw: place(), sameNode };
  });
  check('picking messages marks them without rebuilding the thread', held.sameNode, JSON.stringify(held));
  check('selecting GIF messages and redrawing leave the reader where they were',
    Math.abs(held.afterSelect - held.before) <= 2 && Math.abs(held.afterTap - held.before) <= 2 && Math.abs(held.afterRedraw - held.before) <= 2, JSON.stringify(held));

  const learned = await PAGE.evaluate(async () => {
    const blob = await window.__gif(10, 150, 300);
    const file = new File([blob], 'animation.gif', { type: 'image/gif' });
    const entry = await keepBlobInSaved(file, 'sticker', 0, { stickerKind: 'gif' });
    renderMessages();
    await new Promise((r) => setTimeout(r, 800));
    const kept = chatState.history.saved.find((item) => item.id === entry.id);
    return { w: kept.mediaWidth || 0, h: kept.mediaHeight || 0 };
  });
  check('a GIF that came without its size learns it on first load', learned.w === 150 && learned.h === 300, JSON.stringify(learned));

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
