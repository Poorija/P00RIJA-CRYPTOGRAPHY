/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Two devices of one account, kept as one — while both are here, while one is
 * away, and after the other has gone too.
 *
 * ALI and ALI2 hold one identity, with file sync on; SARA is a contact.
 *
 *   Both online:
 *   - a message ALI sends, and one SARA sends, are on both devices;
 *   - an edit, a reaction and a deleted message on ALI are on ALI2 too;
 *   - a 20 MB file ALI has is fetched by ALI2 on a click, device to device
 *     (nothing of it through the relay), whole, and kept on ALI2 — and what
 *     crosses the channel is encrypted with a key only the account can open,
 *     not the file as it is.
 *
 *   ALI2 away:
 *   - ALI sends, SARA sends, ALI edits; then ALI goes away as well;
 *   - the relay holds only what ALI2 needs to catch up (no file bytes, and
 *     nothing at all for a device that is online), and never a message meant
 *     to disappear — that goes to a sibling only while it is here;
 *   - ALI2 comes back with ALI still gone and catches up from the relay;
 *   - and once it has, the relay holds nothing more for it.
 *
 *   And by hand: a manual sync still brings a sibling everything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openApp, identity, importIdentity, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const fingerprintOf = (card) => JSON.parse(Buffer.from(card.replace('poorija-chat-v1:', ''), 'base64').toString('utf8')).fingerprint;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const openConversation = (page, fp) => page.evaluate(async (key) => {
  const peer = findPeerByAnyKey(key);
  chatState.activeConversationId = getConversationKey(peer);
  chatState.activePeerClientId = peer.clientId || '';
  renderPeers(); renderActivePeer(); renderMessages();
  await new Promise((r) => setTimeout(r, 400));
}, fp);
const sendText = (page, text) => page.evaluate(async (value) => {
  const box = document.getElementById('chatComposer');
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('chatSendMessageBtn').click();
  await new Promise((r) => setTimeout(r, 300));
}, text);
const entryOn = (page, fp, text) => page.evaluate(({ key, value }) => {
  const list = chatState.history[getConversationKey(findPeerByAnyKey(key))] || [];
  return list.find((e) => e.text === value || e.text === `${value} (edited)`) || null;
}, { key: fp, value: text });
const hasText = (page, fp, text) => waitFor(page, ({ key, value }) => (chatState.history[getConversationKey(findPeerByAnyKey(key))] || []).some((e) => e.text === value), { timeoutMs: 45000, arg: { key: fp, value: text } });
const heldFiles = (dir) => {
  const folder = path.join(dir, 'siblings');
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).map((name) => {
    const text = fs.readFileSync(path.join(folder, name), 'utf8');
    let items = [];
    try { items = JSON.parse(text).items || []; } catch (_error) { items = []; }
    return { name, bytes: text.length, items: items.length, pending: items.map((item) => item.pending || []) };
  });
};

const stacks = await startTwoStacks();
try {
  section('two devices of one account, and a contact');
  const ALI = await openApp('ALI', { origin: stacks.a.url, relay: stacks.a.url });
  const SARA = await openApp('SARA', { origin: stacks.a.url, relay: stacks.a.url });
  const cardAli = await identity(ALI);
  const fpAli = fingerprintOf(cardAli);
  const shared = await ALI.evaluate(() => ({ ...chatState.identity }));
  const ALI2 = await openApp('ALI2', { origin: stacks.a.url, relay: stacks.a.url });
  await ALI2.evaluate(async (ident) => {
    chatState.shouldReconnect = false;
    try { chatState.ws?.close(); } catch (_error) { /* gone */ }
    await new Promise((r) => setTimeout(r, 800));
    chatState.identity = { ...ident };
    saveEncrypted(CHAT_IDENTITY_STORAGE_KEY, chatState.identity);
    chatState.shouldReconnect = true;
    renderStaticUi();
    await connectChatTransport();
    await new Promise((r) => setTimeout(r, 600));
    broadcastHello();
  }, shared);
  const cardSara = await identity(SARA);
  const fpSara = fingerprintOf(cardSara);
  await importIdentity(SARA, cardAli);
  await importIdentity(ALI, cardSara);
  await importIdentity(ALI2, cardSara);
  for (const page of [ALI, ALI2]) await page.evaluate(() => setDeviceSyncFilesEnabled(true));
  const linked = await waitFor(ALI, () => (chatState.linkedDevices || []).length >= 2, { timeoutMs: 40000 });
  check('ALI and ALI2 see each other as devices of one account', linked === true);
  await sleep(4000);

  section('both online');
  await openConversation(ALI, fpSara);
  await openConversation(ALI2, fpSara);
  await openConversation(SARA, fpAli);
  await sendText(ALI, 'both-online-out');
  check('a message ALI sends is on ALI2', await hasText(ALI2, fpSara, 'both-online-out'));
  await sendText(SARA, 'both-online-in');
  check('a message SARA sends is on both', (await hasText(ALI, fpSara, 'both-online-in')) && (await hasText(ALI2, fpSara, 'both-online-in')));

  await ALI.evaluate(async () => {
    const list = chatState.history[chatState.activeConversationId] || [];
    const mine = list.find((e) => e.text === 'both-online-out');
    handleEditMessage(mine.id);
    const box = document.getElementById('chatComposer');
    box.value = 'both-online-out, edited';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('chatSendMessageBtn').click();
    await new Promise((r) => setTimeout(r, 300));
    const theirs = list.find((e) => e.text === 'both-online-in');
    applyReactionFromPicker(theirs.id, '👍');
  });
  check('an edit on ALI is on ALI2', await hasText(ALI2, fpSara, 'both-online-out, edited'));
  const reacted = await waitFor(ALI2, (key) => {
    const entry = (chatState.history[getConversationKey(findPeerByAnyKey(key))] || []).find((e) => e.text === 'both-online-in');
    return Boolean(entry && Object.values(normalizeMessageReactions(entry)).includes('👍'));
  }, { timeoutMs: 30000, arg: fpSara });
  check('a reaction on ALI is on ALI2', reacted);

  await sendText(ALI, 'to-be-deleted');
  await hasText(ALI2, fpSara, 'to-be-deleted');
  await ALI.evaluate(() => {
    const key = chatState.activeConversationId;
    const entry = (chatState.history[key] || []).find((e) => e.text === 'to-be-deleted');
    deleteMessageEntry(key, entry.id);
  });
  const deletedThere = await waitFor(ALI2, (key) => !(chatState.history[getConversationKey(findPeerByAnyKey(key))] || []).some((e) => e.text === 'to-be-deleted'), { timeoutMs: 30000, arg: fpSara });
  check('a message deleted on ALI is gone from ALI2', deletedThere);

  /* A 20 MB file on ALI, its row on ALI2, the bytes fetched on a click. */
  const made = await ALI.evaluate(async () => {
    const size = 20 * 1024 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(size, i + 65536)));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
    const key = chatState.activeConversationId;
    const entry = { id: `big-${Date.now()}`, type: 'file', direction: 'out', name: 'big.bin', mime: 'application/octet-stream', size, createdAt: new Date().toISOString(), status: 'sent' };
    const blob = new Blob([bytes], { type: entry.mime });
    window.__bigHead = Array.from(bytes.subarray(0, 32)).join(',');
    /* What actually crosses the data channel, as ALI sends it. */
    window.__channelPieces = [];
    const realSend = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function send(data) {
      if (data instanceof ArrayBuffer && window.__channelPieces.length < 3) window.__channelPieces.push({ size: data.byteLength, head: Array.from(new Uint8Array(data, 0, 32)).join(',') });
      return realSend.call(this, data);
    };
    await persistMessageMedia(key, entry, blob);
    entry.downloadUrl = URL.createObjectURL(blob);
    appendHistory(key, entry);
    return { id: entry.id, digest, size };
  });
  const rowThere = await waitFor(ALI2, (id) => Object.values(chatState.history).some((list) => list.some((e) => e.id === id)), { timeoutMs: 30000, arg: made.id });
  check('the file\'s row reaches ALI2, without its bytes', rowThere);
  await ALI2.evaluate(() => {
    window.__relaySyncFrames = 0;
    const original = window.handleDeviceSyncEnvelope;
    window.handleDeviceSyncEnvelope = (message) => { window.__relaySyncFrames += 1; return original(message); };
    renderMessages();
  });
  await sleep(500);
  const started = Date.now();
  await ALI2.evaluate((id) => document.querySelector(`[data-chat-device-file="${CSS.escape(id)}"]`)?.click(), made.id);
  const fetched = await waitFor(ALI2, async (id) => Boolean(await readMessageMedia(id).catch(() => null)), { timeoutMs: 120000, arg: made.id });
  const landed = await ALI2.evaluate(async (id) => {
    const stored = await readMessageMedia(id).catch(() => null);
    if (!stored) return null;
    const bytes = new Uint8Array(await stored.blob.arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
    const entry = Object.values(chatState.history).flat().find((e) => e.id === id);
    return { size: bytes.length, digest, url: Boolean(entry?.downloadUrl), relayFrames: window.__relaySyncFrames };
  }, made.id);
  check('ALI2 fetches the 20 MB file on a click, whole, and keeps it', fetched && landed?.size === made.size && landed.digest === made.digest && landed.url, JSON.stringify({ ...landed, seconds: Math.round((Date.now() - started) / 1000) }));
  check('and none of it came through the relay', landed && landed.relayFrames <= 2, JSON.stringify(landed));
  const wire = await ALI.evaluate(() => ({ pieces: window.__channelPieces, head: window.__bigHead }));
  check('what crossed the channel is encrypted, not the file itself', wire.pieces.length > 0 && wire.pieces.every((piece) => piece.head !== wire.head && piece.size === 65536 + 16), JSON.stringify({ pieces: wire.pieces.map((piece) => piece.size), sameAsFile: wire.pieces.some((piece) => piece.head === wire.head) }));

  section('ALI2 away');
  await ALI2.evaluate(() => disconnectChat());
  await sleep(2500);
  check('the relay holds nothing for a device while it is online', heldFiles(stacks.a.dir).every((file) => file.items === 0), JSON.stringify(heldFiles(stacks.a.dir)));
  /* A self-destruct message, sent while ALI2 is away: only ever live. */
  await ALI.evaluate(() => {
    window.__heldTimed = 0;
    window.__liveTimed = 0;
    const real = window.sendDeviceBundles;
    window.sendDeviceBundles = (bundles, options = {}) => {
      for (const bundle of bundles || []) {
        const timed = (bundle.entries || []).filter((entry) => Number(entry.timerSeconds || 0) > 0 || entry.expiresAt).length;
        if (options.hold) window.__heldTimed += timed; else window.__liveTimed += timed;
      }
      return real(bundles, options);
    };
    chatState.timerSeconds = 3600;
  });
  await sendText(ALI, 'away-timed');
  await sleep(1500);
  const timed = await ALI.evaluate(() => { chatState.timerSeconds = 0; return { held: window.__heldTimed, live: window.__liveTimed }; });
  check('a message meant to disappear is never held for an away device', timed.held === 0 && timed.live >= 1, JSON.stringify(timed));
  await sendText(ALI, 'away-out');
  await sendText(SARA, 'away-in');
  await hasText(ALI, fpSara, 'away-in');
  await ALI.evaluate(async () => {
    const list = chatState.history[chatState.activeConversationId] || [];
    const mine = list.find((e) => e.text === 'away-out');
    handleEditMessage(mine.id);
    const box = document.getElementById('chatComposer');
    box.value = 'away-out, edited';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('chatSendMessageBtn').click();
    await new Promise((r) => setTimeout(r, 1500));
  });
  await sleep(2000);
  const held = heldFiles(stacks.a.dir);
  check('the relay holds what ALI2 missed, and only that — small, no file bytes', held.length === 1 && held[0].items > 0 && held[0].bytes < 200000, JSON.stringify(held));

  await ALI.evaluate(() => disconnectChat());
  await sleep(1500);
  await ALI2.evaluate(async () => { await connectChatTransport(); });
  const caughtUp = await waitFor(ALI2, (key) => {
    const list = chatState.history[getConversationKey(findPeerByAnyKey(key))] || [];
    return list.some((e) => e.text === 'away-out, edited') && list.some((e) => e.text === 'away-in');
  }, { timeoutMs: 45000, arg: fpSara });
  check('ALI2 comes back with ALI gone, and catches up from the relay', caughtUp);
  await sleep(2500);
  check('and once it has, the relay holds nothing more for it', heldFiles(stacks.a.dir).every((file) => file.items === 0), JSON.stringify(heldFiles(stacks.a.dir)));

  section('by hand');
  await ALI.evaluate(async () => { await connectChatTransport(); });
  await waitFor(ALI, () => (chatState.linkedDevices || []).length >= 2, { timeoutMs: 40000 });
  await ALI2.evaluate(() => {
    const key = chatState.activeConversationId;
    chatState.history[key] = (chatState.history[key] || []).filter((e) => e.text !== 'both-online-in');
    renderMessages();
  });
  await ALI.evaluate(() => sendDeviceSyncFromUi());
  check('a manual sync still brings a sibling everything', await hasText(ALI2, fpSara, 'both-online-in'));

  const errors = [...(ALI.__errors || []), ...(ALI2.__errors || []), ...(SARA.__errors || [])];
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
