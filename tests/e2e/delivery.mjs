/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A message is delivered whatever the live channel does.
 *
 *   ARIA and BARAN on one relay, both online.
 *
 *   - the live channel holds the wrong key: BARAN cannot open what arrives
 *     on it, and the message still reaches him (sent again through the relay);
 *   - the live channel looks open and swallows everything: the message still
 *     reaches him, the same way;
 *   - no live channel comes up at all: the message goes through the relay at
 *     once, never "not ready, try again", and ARIA is told it went that way;
 *   - a key kept from before is not mistaken for a channel: reaching for the
 *     message box dials one, so the message about to be written goes live.
 *
 *   Each of these lost the message, or refused to send it, before.
 */
import { openApp, identity, importIdentity, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 240) : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const decode = (card) => JSON.parse(Buffer.from(card.replace('poorija-chat-v1:', ''), 'base64').toString('utf8'));
const openConversation = (page, fp) => page.evaluate(async (key) => {
  const peer = findPeerByAnyKey(key);
  chatState.activeConversationId = getConversationKey(peer);
  chatState.activePeerClientId = peer.clientId || '';
  renderPeers(); renderActivePeer(); renderMessages();
  await new Promise((r) => setTimeout(r, 400));
}, fp);
const say = (page, text) => page.evaluate((value) => {
  const box = document.getElementById('chatComposer');
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('chatSendMessageBtn').click();
}, text);
const received = (page, text, timeoutMs = 45000) => waitFor(page, (value) => Object.values(chatState.history)
  .some((list) => list.some((e) => e.text === value && e.direction === 'in')), { timeoutMs, arg: text });
const liveBoth = async (A, B, fpA, fpB, timeoutMs = 60000) => {
  const ready = (fp) => {
    const peer = findPeerByAnyKey(fp);
    const session = peer && chatState.sessions.get(peer.peerId);
    return Boolean(session?.cryptoKey && session?.connection?.open);
  };
  const [a, b] = await Promise.all([waitFor(A, ready, { timeoutMs, arg: fpB }), waitFor(B, ready, { timeoutMs, arg: fpA })]);
  return a && b;
};

const stacks = await startTwoStacks();
try {
  section('two people, both online');
  const ARIA = await openApp('ARIA', { origin: stacks.a.url, relay: stacks.a.url });
  const BARAN = await openApp('BARAN', { origin: stacks.a.url, relay: stacks.a.url });
  const cards = { ARIA: await identity(ARIA), BARAN: await identity(BARAN) };
  const fp = { ARIA: decode(cards.ARIA).fingerprint, BARAN: decode(cards.BARAN).fingerprint };
  await importIdentity(ARIA, cards.BARAN);
  await importIdentity(BARAN, cards.ARIA);
  await openConversation(ARIA, fp.BARAN);
  await openConversation(BARAN, fp.ARIA);
  await say(ARIA, `hello-${Date.now()}`);
  check('a live channel opens between them', await liveBoth(ARIA, BARAN, fp.ARIA, fp.BARAN));

  section('the live channel holds the wrong key');
  /* ARIA's side of the channel now encrypts under a key BARAN never had. */
  await ARIA.evaluate(async (key) => {
    const session = chatState.sessions.get(findPeerByAnyKey(key).peerId);
    session.cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }, fp.BARAN);
  const wrongKey = `wrong-key-${Date.now()}`;
  await say(ARIA, wrongKey);
  check('BARAN still gets the message', await received(BARAN, wrongKey), wrongKey);

  section('the live channel looks open and swallows everything');
  await liveBoth(ARIA, BARAN, fp.ARIA, fp.BARAN, 30000);
  await ARIA.evaluate((key) => {
    const session = chatState.sessions.get(findPeerByAnyKey(key).peerId);
    if (session?.connection) session.connection.send = () => {};
  }, fp.BARAN);
  const swallowed = `swallowed-${Date.now()}`;
  await say(ARIA, swallowed);
  const swallowedStatus = await ARIA.evaluate((value) => Object.values(chatState.history).flat().find((e) => e.text === value)?.status || '', swallowed);
  check('ARIA first shows it as sent down the channel', swallowedStatus === 'sent', swallowedStatus);
  check('and BARAN still gets it', await received(BARAN, swallowed), swallowed);

  section('no live channel comes up at all');
  const notes = await ARIA.evaluate(async (key) => {
    window.__notes = [];
    const original = window.notify;
    window.notify = (message, kind) => { window.__notes.push(`${kind}: ${message}`); return original?.(message, kind); };
    const peer = findPeerByAnyKey(key);
    try { chatState.sessions.get(peer.peerId)?.connection?.close(); } catch (_error) { /* already gone */ }
    chatState.sessions.delete(peer.peerId);
    /* Nothing can be dialled: every attempt at a live channel comes back
       without a key, as on two networks with no path between them. */
    window.ensureDirectSession = async () => null;
    window.startSecureSession = async () => null;
    return true;
  }, fp.BARAN);
  const noChannel = `no-channel-${Date.now()}`;
  await say(ARIA, noChannel);
  const noChannelState = await waitFor(ARIA, (value) => {
    const entry = Object.values(chatState.history).flat().find((e) => e.text === value);
    return entry && entry.status !== 'failed' ? entry.status : false;
  }, { timeoutMs: 20000, arg: noChannel });
  check('ARIA\'s message is not refused', Boolean(noChannelState), String(noChannelState));
  check('BARAN gets it through the relay', await received(BARAN, noChannel), noChannel);
  const told = await ARIA.evaluate(() => window.__notes.slice());
  check('and ARIA is told it went through the relay, once',
    notes && told.filter((note) => /relay|رله/.test(note)).length === 1 && !told.some((note) => /not ready|آماده نیست/.test(note)), JSON.stringify(told));

  section('a key kept from before is not a channel');
  await ARIA.close?.();
  const BARAN_FP = fp.BARAN;
  const warm = await BARAN.evaluate(async (key) => {
    const peer = findPeerByAnyKey(key);
    const session = chatState.sessions.get(peer.peerId);
    try { session?.connection?.close(); } catch (_error) { /* already gone */ }
    if (session) session.connection = null;
    return Boolean(session?.cryptoKey);
  }, fp.ARIA);
  check('BARAN holds a key for ARIA with no channel open', warm === true);
  const ARIA2 = await openApp('ARIA-again', { origin: stacks.a.url, relay: stacks.a.url });
  /* Not ARIA's page — that one is closed — but a fresh contact for BARAN to
     open a conversation with while they both hold a key: the dial is what is
     under test, and it needs somebody online to dial. */
  const cardAria2 = await identity(ARIA2);
  const fpAria2 = decode(cardAria2).fingerprint;
  /* ARIA2 never dials: whatever channel appears is the one BARAN opened. */
  await ARIA2.evaluate(() => {
    window.ensureDirectSession = async () => null;
    window.startSecureSession = async () => null;
    window.scheduleSessionWarmup = () => {};
  });
  await importIdentity(ARIA2, cards.BARAN);
  await BARAN.evaluate(() => { window.__realStart = startSecureSession; window.startSecureSession = async () => null; });
  await importIdentity(BARAN, cardAria2);
  await new Promise((r) => setTimeout(r, 2500));
  await BARAN.evaluate(() => { window.__dialled = []; window.startSecureSession = (peer, options) => { window.__dialled.push(peer?.peerId || ''); return window.__realStart(peer, options); }; });
  await BARAN.evaluate(async (key) => {
    /* A warm-up the import started is still waiting on its own dial; the
       conversation is opened once it has given up. */
    for (let i = 0; i < 100 && chatState.sessionWarmupInFlight.size; i += 1) await new Promise((r) => setTimeout(r, 200));
    const peer = findPeerByAnyKey(key);
    const session = await ensureStoredSession(peer);
    await prepareOfflineSession(session, peer);
    try { session.connection?.close(); } catch (_error) { /* none */ }
    session.connection = null;
    chatState.sessionWarmupLastAt?.clear?.();
  }, fpAria2);
  await openConversation(BARAN, fpAria2);
  await BARAN.evaluate(() => document.getElementById('chatComposer')?.focus());
  const dialled = await waitFor(BARAN, (key) => {
    const peer = findPeerByAnyKey(key);
    return window.__dialled.includes(peer?.peerId) && Boolean(chatState.sessions.get(peer?.peerId)?.connection);
  }, { timeoutMs: 15000, arg: fpAria2 });
  check('reaching for the message box dials a live channel', dialled, BARAN_FP.slice(0, 8));

  const errors = [];
  for (const page of [BARAN, ARIA2]) errors.push(...(page.__errors || []));
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
