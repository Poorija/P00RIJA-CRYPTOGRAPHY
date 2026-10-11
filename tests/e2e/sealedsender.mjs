/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Sealed sender and padding, read off the relay's own mailbox file.
 *
 *   - what is queued for somebody away names no sender: not on the envelope,
 *     not in the item the relay files, and the recipient still knows exactly
 *     who wrote and verifies it;
 *   - two messages of very different lengths are queued at the same size;
 *   - a contact whose build does not read sealed envelopes gets the old shape;
 *   - an envelope written to one person does not verify for another, and one
 *     claiming the reader's own name does not verify unless the reader signed it;
 *   - a sealed envelope can be taken back with its secret, and a sealed
 *     receipt is not stored for somebody who is away.
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
/* The app's own Disconnect: the supervisor and the heal loop honour it, so
   the device really is away until it is told to come back. */
const goAway = (page) => page.evaluate(async () => {
  disconnectChat();
  await new Promise((r) => setTimeout(r, 500));
});
const comeBack = (page) => page.evaluate(async () => {
  chatState.shouldReconnect = true;
  await connectChatTransport();
});

const stacks = await startTwoStacks();
const mailboxOf = (fp) => {
  const file = path.join(stacks.a.dir, 'mailboxes', `${fp}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
};
try {
  section('two contacts on one relay');
  const ARASH = await openApp('ARASH', { origin: stacks.a.url, relay: stacks.a.url });
  const BITA = await openApp('BITA', { origin: stacks.a.url, relay: stacks.a.url });
  const cardArash = await identity(ARASH);
  const cardBita = await identity(BITA);
  const fpArash = fingerprintOf(cardArash);
  const fpBita = fingerprintOf(cardBita);
  await importIdentity(ARASH, cardBita);
  await importIdentity(BITA, cardArash);
  const capsKnown = await waitFor(ARASH, (fp) => peerSupports(findPeerByAnyKey(fp), 'ss1') && Boolean(findPeerByAnyKey(fp)?.prekeyPublic), { timeoutMs: 40000, arg: fpBita });
  check('the relay passed on what BITA\'s build reads', capsKnown === true);

  section('BITA is away; ARASH writes twice');
  await goAway(BITA);
  /* Until ARASH's side has seen BITA leave, a send can still go into the
     data channel that has not noticed yet — wait for the relay's word. */
  const gone = await waitFor(ARASH, (fp) => {
    const peer = findPeerByAnyKey(fp);
    return !peerLooksOnline(peer) && !chatState.sessions.get(peer.peerId)?.connection?.open;
  }, { timeoutMs: 30000, arg: fpBita });
  check('ARASH sees BITA go', gone === true);
  await openConversation(ARASH, fpBita);
  const short = `hi-${Date.now()}`;
  /* Six times the length, still inside one step of the ladder. */
  const long = `longer-${Date.now()}-${'a longer one '.repeat(9)}`.trim();
  await say(ARASH, short);
  await sleep(1500);
  await say(ARASH, long);
  await sleep(4000);
  const box = mailboxOf(fpBita).filter((item) => item?.payload?.type === 'offline-chat');
  check('both are queued for BITA', box.length >= 2, `${box.length} item(s)`);
  const sealedItems = box.filter((item) => item.payload.ss === 1);
  check('as sealed-sender envelopes', sealedItems.length >= 2, `${sealedItems.length} sealed`);
  const leaks = sealedItems.flatMap((item) => ['fromFingerprint', 'fromPeerId', 'sig', 'inner', 'createdAt', 'to']
    .filter((field) => item.payload[field] !== undefined).map((field) => `payload.${field}`)
    .concat(item.fromFingerprint ? ['item.fromFingerprint'] : [], item.fromClientId ? ['item.fromClientId'] : []));
  check('nothing on the envelope or the filed item names ARASH', leaks.length === 0, leaks.join(', ') || 'none');
  const raw = JSON.stringify(sealedItems);
  check('ARASH\'s fingerprint appears nowhere in the mailbox file', !raw.includes(fpArash));
  const bodySizes = Array.from(new Set(sealedItems.map((item) => item.payload.body?.cipher?.length || 0)));
  const ladderSizes = [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].map((n) => Math.ceil((n + 16) / 3) * 4);
  check('a two-word message and one six times longer are queued at the same size', bodySizes.length === 1 && bodySizes[0] > 0, bodySizes.join(', '));
  check('and that size is a step of the ladder, not a length', bodySizes.every((size) => ladderSizes.includes(size)), bodySizes.join(', '));
  check('each carries the hash of its take-back secret', sealedItems.every((item) => /^[a-f0-9]{64}$/.test(item.payload.wd || '')));

  section('BITA comes back');
  await comeBack(BITA);
  const got = await waitFor(BITA, ({ a, b }) => {
    const key = getConversationKey(findPeerByAnyKey(a));
    const list = chatState.history[key] || [];
    return list.some((e) => e.text === b.short) && list.some((e) => e.text === b.long);
  }, { timeoutMs: 60000, arg: { a: fpArash, b: { short, long } } });
  const whereGot = await BITA.evaluate(({ a, b }) => ({
    keyA: getConversationKey(findPeerByAnyKey(a)).slice(0, 12),
    short: Object.entries(chatState.history).filter(([, l]) => l.some((e) => e.text === b.short)).map(([k]) => k.slice(0, 12)),
    long: Object.entries(chatState.history).filter(([, l]) => l.some((e) => e.text === b.long)).map(([k]) => k.slice(0, 12)),
    forged: chatState.forgedEnvelopes || 0,
  }), { a: fpArash, b: { short, long } });
  check('both arrive, in ARASH\'s conversation — BITA knows who wrote', got === true, JSON.stringify(whereGot));
  const drained = await waitFor(BITA, () => true, { timeoutMs: 3000 });
  await sleep(3000);
  check('and the mailbox is emptied', drained && mailboxOf(fpBita).filter((item) => item?.payload?.type === 'offline-chat').length === 0);

  section('a contact whose build does not read sealed envelopes');
  await ARASH.evaluate((fp) => { findPeerByAnyKey(fp).caps = []; }, fpBita);
  await goAway(BITA);
  await sleep(2500);
  const plain = `old-shape-${Date.now()}`;
  await say(ARASH, plain);
  await sleep(4000);
  const oldShape = mailboxOf(fpBita).filter((item) => item?.payload?.type === 'offline-chat').slice(-1)[0];
  check('gets the old shape, which it can attribute', oldShape && oldShape.payload.ss !== 1 && oldShape.payload.fromFingerprint === fpArash, JSON.stringify({ ss: oldShape?.payload?.ss, from: Boolean(oldShape?.payload?.fromFingerprint) }));
  await ARASH.evaluate((fp) => { findPeerByAnyKey(fp).caps = ['ss1', 'pad1']; }, fpBita);

  section('taking a sealed envelope back');
  const takeBack = `take-back-${Date.now()}`;
  await say(ARASH, takeBack);
  await sleep(4000);
  const before = mailboxOf(fpBita).filter((item) => item?.payload?.ss === 1);
  const target = before.slice(-1)[0];
  await ARASH.evaluate(async ({ fp, tag }) => {
    const secret = await withdrawSecretFor(tag);
    chatState.ws.send(JSON.stringify({ type: 'relay-withdraw', toFingerprint: fp, tags: [], secrets: [secret] }));
  }, { fp: fpBita, tag: target?.payload?.tag || '' });
  await sleep(2500);
  const after = mailboxOf(fpBita).filter((item) => item?.payload?.ss === 1);
  check('the sender\'s secret takes exactly that envelope back', before.length - after.length === 1 && !after.some((item) => item.payload.wd === target.payload.wd), `${before.length} → ${after.length}`);
  const strangerTry = await (async () => {
    const STRANGER = await openApp('STRANGER', { origin: stacks.a.url, relay: stacks.a.url });
    const count = mailboxOf(fpBita).length;
    await STRANGER.evaluate(async ({ fp, tags }) => {
      const secrets = await Promise.all(tags.map((tag) => withdrawSecretFor(tag)));
      chatState.ws.send(JSON.stringify({ type: 'relay-withdraw', toFingerprint: fp, tags, secrets }));
    }, { fp: fpBita, tags: mailboxOf(fpBita).map((item) => item?.payload?.tag).filter(Boolean) });
    await sleep(2500);
    return { before: count, after: mailboxOf(fpBita).length };
  })();
  check('somebody else\'s secrets take nothing', strangerTry.before === strangerTry.after, JSON.stringify(strangerTry));

  section('a sealed receipt is not kept for somebody away');
  const countBefore = mailboxOf(fpBita).length;
  await ARASH.evaluate((fp) => relaySessionEvent(findPeerByAnyKey(fp), { type: 'receipt', messageId: 'msg-x', status: 'seen', createdAt: new Date().toISOString() }), fpBita);
  await sleep(3000);
  check('the relay refuses to store it', mailboxOf(fpBita).length === countBefore, `${countBefore} → ${mailboxOf(fpBita).length}`);
  await comeBack(BITA);
  await sleep(4000);

  section('envelopes that must not verify');
  const verdicts = await BITA.evaluate(async ({ arash }) => {
    const me = chatState.identity.fingerprint;
    const base = { fromFingerprint: arash, fromPeerId: findPeerByAnyKey(arash).peerId, createdAt: new Date().toISOString(), body: { iv: [1, 2, 3], cipher: 'AAAA' } };
    return {
      writtenToSomebodyElse: await verifyOfflineEnvelopeSender({ ...base, to: 'ab'.repeat(32), sig: 'AAAA' }, base.fromPeerId),
      relayDisagrees: await verifyOfflineEnvelopeSender({ ...base, sig: 'AAAA' }, base.fromPeerId, { relayFingerprint: 'cd'.repeat(32) }),
      contactUnsigned: await verifyOfflineEnvelopeSender({ ...base }, base.fromPeerId),
      contactFingerprintUnderUnknownId: await verifyOfflineEnvelopeSender({ ...base, fromPeerId: 'poorija-peer-nobody', sig: 'AAAA' }, 'poorija-peer-nobody'),
      claimsMeUnsigned: await verifyOfflineEnvelopeSender({ ...base, fromFingerprint: me, fromPeerId: 'poorija-peer-nobody' }, 'poorija-peer-nobody'),
      claimsMeBadSig: await verifyOfflineEnvelopeSender({ ...base, fromFingerprint: me, fromPeerId: 'poorija-peer-nobody', sig: 'AAAA' }, 'poorija-peer-nobody'),
      malformedSignature: await verifyOfflineEnvelopeSender({ ...base, sig: '%%%' }, base.fromPeerId),
    };
  }, { arash: fpArash });
  check('an envelope written to somebody else is refused', verdicts.writtenToSomebodyElse === 'forged');
  check('a claim the relay\'s own proof contradicts is refused', verdicts.relayDisagrees === 'forged');
  check('a contact\'s name with no signature passes only as unsigned-pinned', verdicts.contactUnsigned === 'unsigned-pinned');
  check('a contact\'s fingerprint under an unknown peer id is checked against the contact\'s key', verdicts.contactFingerprintUnderUnknownId === 'forged');
  check('the reader\'s own name is refused unless the reader signed it', verdicts.claimsMeUnsigned === 'forged' && verdicts.claimsMeBadSig === 'forged', JSON.stringify(verdicts));
  check('a signature that cannot even be read is a refusal, not a pass', verdicts.malformedSignature === 'forged');

  section('live frames on the ladder');
  const ladder = await ARASH.evaluate(() => {
    const sizes = [10, 120, 400].map((n) => JSON.stringify(padLiveFrame({ type: 'text', id: 'm', payload: { iv: [1], cipher: 'x'.repeat(n) } })).length);
    const chunk = padLiveFrame({ type: 'file-chunk', index: 1, data: 'y'.repeat(100) });
    return { sizes, chunkUntouched: chunk.pad === undefined, body: paddedJson({ message: 'a' }).length };
  });
  check('three different text frames come out the same size', new Set(ladder.sizes).size === 1 && [512, 1024].includes(ladder.sizes[0]), ladder.sizes.join(', '));
  check('file chunks are left as they are', ladder.chunkUntouched === true);
  check('a sealed body is exactly a ladder size', ladder.body === 512, String(ladder.body));

  check('no page errors', [ARASH, BITA].every((p) => !(p.__errors || []).length), [ARASH, BITA].flatMap((p) => p.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
