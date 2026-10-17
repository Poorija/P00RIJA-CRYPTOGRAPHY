/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A picture whose object URL dies is drawn again from the vault.
 *
 *   On Android a pasted GIF, or one a keyboard inserts, is a temporary file
 *   the system deletes later; the bubble drew from it and went blank until a
 *   restart. Here the URL is killed outright, which is what that looks like
 *   from the page:
 *
 *   - a GIF kept in Saved Messages shows;
 *   - its object URL is revoked and the thread redrawn: the picture fails to
 *     load, is read back from the vault, and shows again under a new URL;
 *   - a file handed to the send path is copied into memory first, so the
 *     bubble never depended on the handle at all.
 */
import { openApp, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 240) : ''}`);
};

/* A 2-frame 8x8 GIF, small enough to write out by hand. */
const GIF_B64 = 'R0lGODlhCAAIAPABAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQEFAAAACwAAAAACAAIAAACB4SPqcvtD1wAIfkEBBQAAAAsAAAAAAgACAAAAgeEj6nL7Q9cADs=';

const stacks = await startTwoStacks();
try {
  const PAGE = await openApp('HEAL', { origin: stacks.a.url, relay: stacks.a.url });
  const first = await PAGE.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'party.gif', { type: 'image/gif' });
    const entry = await keepBlobInSaved(file, 'sticker', 0, { stickerKind: 'gif' });
    openSavedMessages();
    await new Promise((r) => setTimeout(r, 800));
    const img = document.querySelector(`#chatMessages [data-id="${entry.id}"] img`);
    return { id: entry.id, src: img?.getAttribute('src') || '', width: img?.naturalWidth || 0 };
  }, GIF_B64);
  check('a GIF kept in Saved Messages shows', first.width > 0 && first.src.startsWith('blob:'), JSON.stringify(first));

  await PAGE.evaluate((id) => {
    const entry = chatState.history.saved.find((item) => item.id === id);
    URL.revokeObjectURL(entry.downloadUrl);
    renderMessages();
  }, first.id);
  const healed = await waitFor(PAGE, ({ id, old }) => {
    const img = document.querySelector(`#chatMessages [data-id="${id}"] img`);
    return Boolean(img && img.naturalWidth > 0 && img.getAttribute('src') !== old);
  }, { timeoutMs: 10000, arg: { id: first.id, old: first.src } });
  check('with its URL dead, it is read back from the vault and shows again', healed);

  const copied = await PAGE.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const handle = new File([bytes], 'party.gif', { type: 'image/gif' });
    const held = await holdFileInMemory(handle);
    return { different: held !== handle, size: held.size === handle.size, type: held.type, name: held.name };
  }, GIF_B64);
  check('a file on its way out is copied into memory, not kept as a handle', copied.different && copied.size && copied.type === 'image/gif' && copied.name === 'party.gif', JSON.stringify(copied));

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
