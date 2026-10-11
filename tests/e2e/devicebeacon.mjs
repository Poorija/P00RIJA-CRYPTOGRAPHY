/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Two devices of one account, synced device to device, with the relay
 * keeping nothing for the one that was away.
 *
 *   ONE and TWO hold the same identity on deployment A. A contact, FRIEND,
 *   lives on deployment B. ONE goes away; FRIEND writes; TWO receives it and
 *   acknowledges at once — so the relay's mailbox for the account is empty,
 *   not holding the message for ONE. ONE comes back, reads TWO's encrypted
 *   beacon, sees it is behind, asks TWO for what it missed, and gets it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openApp, identity, importIdentity, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const fingerprintOf = (card) => JSON.parse(atob(card.replace('poorija-chat-v1:', ''))).fingerprint;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stacks = await startTwoStacks();
try {
  section('one account, two devices, and a friend on the other relay');
  const ONE = await openApp('ONE', { origin: stacks.a.url, relay: stacks.a.url });
  const FRIEND = await openApp('FRIEND', { origin: stacks.b.url, relay: stacks.b.url });
  const cardOne = await identity(ONE);
  const fpOne = fingerprintOf(cardOne);
  const shared = await ONE.evaluate(() => ({
    publicKeyData: chatState.identity.publicKeyData,
    privateKeyData: chatState.identity.privateKeyData,
    fingerprint: chatState.identity.fingerprint,
    createdAt: chatState.identity.createdAt || '',
  }));
  const TWO = await openApp('TWO', { origin: stacks.a.url, relay: stacks.a.url });
  await TWO.evaluate(async (ident) => {
    chatState.shouldReconnect = false;
    try { chatState.ws?.close(); } catch (_error) { /* gone */ }
    await new Promise((r) => setTimeout(r, 800));
    chatState.identity = { ...ident };
    saveEncrypted(CHAT_IDENTITY_STORAGE_KEY, chatState.identity);
    chatState.shouldReconnect = true;
    renderStaticUi();
    await connectChatTransport();
    /* The socket may have reconnected on its own before the swap landed, in
       which case it said hello as the old identity; say it again as this one. */
    await new Promise((r) => setTimeout(r, 600));
    broadcastHello();
  }, shared);
  await importIdentity(FRIEND, cardOne);
  const cardFriend = await identity(FRIEND);
  const fpFriend = fingerprintOf(cardFriend);
  await importIdentity(ONE, cardFriend);
  await importIdentity(TWO, cardFriend);
  const linked = await waitFor(TWO, () => (chatState.linkedDevices || []).length >= 2, { timeoutMs: 30000 });
  check('the two devices see each other as siblings', linked === true);

  section('ONE goes away; FRIEND writes');
  await ONE.evaluate(() => {
    chatState.shouldReconnect = false;
    try { chatState.ws?.close(); } catch (_error) { /* gone */ }
    try { chatState.peer?.destroy(); } catch (_error) { /* gone */ }
  });
  await sleep(2000);
  const marker = `while-one-was-away-${Date.now()}`;
  await FRIEND.evaluate(async ({ fp, text }) => {
    const peer = findPeerByAnyKey(fp);
    chatState.activeConversationId = getConversationKey(peer);
    chatState.activePeerClientId = peer.clientId || '';
    renderPeers(); renderActivePeer(); renderMessages();
    await new Promise((r) => setTimeout(r, 500));
    document.getElementById('chatComposer').value = text;
    document.getElementById('chatSendMessageBtn').click();
  }, { fp: fpOne, text: marker });
  const twoGot = await waitFor(TWO, (m) => Object.values(chatState.history).some((list) => list.some((e) => e.text === m)), { timeoutMs: 60000, arg: marker });
  check('TWO receives it', twoGot === true);
  await sleep(3000);
  const mailbox = path.join(stacks.a.dir, 'mailboxes', `${fpOne}.json`);
  const held = fs.existsSync(mailbox) ? JSON.parse(fs.readFileSync(mailbox, 'utf8')) : [];
  check('the relay keeps nothing for the device that is away', held.length === 0, `${held.length} envelope(s) in the account's mailbox`);

  await TWO.evaluate(() => writeBeacon());
  await sleep(1500);
  const beacons = fs.readdirSync(path.join(stacks.a.dir, 'beacons')).map((name) => fs.readFileSync(path.join(stacks.a.dir, 'beacons', name), 'utf8')).join('');
  check('TWO left an encrypted beacon', beacons.length > 100);
  check('which says nothing readable — no message, no name', !beacons.includes(marker) && !beacons.includes('FRIEND') && !beacons.includes(fpFriend));
  const size = Math.max(...Object.values(JSON.parse(fs.readFileSync(path.join(stacks.a.dir, 'beacons', `${fpOne}.json`), 'utf8'))).map((entry) => entry.blob.length));
  check('and fits the 8 KB the relay allows', size <= 11000, `${size} chars`);

  section('ONE comes back');
  await ONE.evaluate(async () => {
    chatState.shouldReconnect = true;
    await connectChatTransport();
  });
  const caughtUp = await waitFor(ONE, (m) => Object.values(chatState.history).some((list) => list.some((e) => e.text === m)), { timeoutMs: 60000, arg: marker });
  check('ONE gets the message from TWO, device to device', caughtUp === true);
  const state = await ONE.evaluate(() => ({ behind: chatState.deviceSyncBehind, siblings: (chatState.linkedDevices || []).length }));
  check('and is no longer marked behind', !state.behind, JSON.stringify(state.behind));

  section('a message sent on one device appears on the other');
  const sent = `mirrored-${Date.now()}`;
  await TWO.evaluate(async ({ fp, text }) => {
    const peer = findPeerByAnyKey(fp);
    chatState.activeConversationId = getConversationKey(peer);
    chatState.activePeerClientId = peer.clientId || '';
    renderPeers(); renderActivePeer(); renderMessages();
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('chatComposer').value = text;
    document.getElementById('chatSendMessageBtn').click();
  }, { fp: fpFriend, text: sent });
  const mirrored = await waitFor(ONE, (m) => Object.values(chatState.history).some((list) => list.some((e) => e.text === m && e.direction === 'out')), { timeoutMs: 30000, arg: sent });
  check('ONE shows what TWO sent, as sent', mirrored === true);

  check('no page errors', [ONE, TWO, FRIEND].every((p) => !(p.__errors || []).length), [ONE, TWO, FRIEND].flatMap((p) => p.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
