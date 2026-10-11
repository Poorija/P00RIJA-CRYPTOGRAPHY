/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A group whose members live on two relays and do not all know each other.
 *
 * ALPHA (owner) is on deployment A and holds the cards of BETA and GAMMA.
 * BETA is on deployment B, GAMMA on deployment A. BETA and GAMMA have never
 * exchanged cards. Before member cards, the fan-out skipped every member a
 * device had no record for, so in exactly this group BETA and GAMMA never
 * heard each other and nobody was told.
 *
 * Also checked: a message to a contact whose home relay is not known lands as
 * "queued" (not the relayed tick) at a relay that has never seen them, the
 * route is discovered from the linked relay, and the parked message is
 * delivered there.
 */
import { openApp, identity, importIdentity, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);

const stacks = await startTwoStacks();
const fingerprintOf = (card) => JSON.parse(atob(card.replace('poorija-chat-v1:', ''))).fingerprint;
const historyTexts = (page, conversationId) => page.evaluate((id) => (chatState.history[id] || [])
  .map((entry) => entry.text || '').filter(Boolean), conversationId);
const groupId = (page, name) => page.evaluate((n) => (chatState.spaces.groups.find((g) => g.name === n) || {}).conversationId || '', name);
const sendTo = async (page, conversationId, text) => {
  await page.evaluate((id) => {
    chatState.activeConversationId = id;
    chatState.activePeerClientId = '';
    renderPeers(); renderActivePeer(); renderMessages();
  }, conversationId);
  await page.waitForSelector('#chatComposer', { state: 'visible', timeout: 30000 });
  await page.fill('#chatComposer', text);
  await page.click('#chatSendMessageBtn', { timeout: 15000 });
};

try {
  section('three people, two deployments');
  const A = await openApp('ALPHA', { origin: stacks.a.url, relay: stacks.a.url });
  const B = await openApp('BETA', { origin: stacks.b.url, relay: stacks.b.url });
  const C = await openApp('GAMMA', { origin: stacks.a.url, relay: stacks.a.url });
  const cardA = await identity(A);
  const cardB = await identity(B);
  const cardC = await identity(C);
  const fpA = fingerprintOf(cardA);
  const fpB = fingerprintOf(cardB);
  const fpC = fingerprintOf(cardC);
  check('the two deployments are different relays', stacks.a.health.relayId !== stacks.b.health.relayId);

  await importIdentity(A, cardB);
  await importIdentity(A, cardC);
  await importIdentity(B, cardA);
  await importIdentity(C, cardA);
  await A.waitForTimeout(2500);
  const knows = await B.evaluate((fp) => Boolean(findPeerByAnyKey(fp)), fpC);
  check('BETA and GAMMA start out as strangers', knows === false);

  section('the owner makes the group');
  await A.evaluate(({ b, c }) => {
    const id = generateId('space');
    const space = upsertSharedSpace({
      type: 'group', conversationId: id, name: 'two-relays', members: [chatState.identity.fingerprint, b, c],
      ownerPeerId: chatState.peerId, ownerFingerprint: chatState.identity.fingerprint, rev: 1, createdAt: new Date().toISOString(),
    });
    broadcastSpaceRecord(space);
  }, { b: fpB, c: fpC });
  const gotB = await waitFor(B, () => chatState.spaces.groups.some((g) => g.name === 'two-relays'), { timeoutMs: 60000 });
  const gotC = await waitFor(C, () => chatState.spaces.groups.some((g) => g.name === 'two-relays'), { timeoutMs: 60000 });
  check('the member on the other relay receives the group', gotB === true);
  check('the member on the same relay receives it too', gotC === true);
  const learnedC = await waitFor(B, (fp) => Boolean(findPeerByAnyKey(fp)?.publicKeyData), { timeoutMs: 30000, arg: fpC });
  check('BETA learned GAMMA\'s key from the owner\'s member cards', learnedC === true);
  const hidden = await B.evaluate((fp) => {
    const peer = findPeerByAnyKey(fp);
    return { groupMember: Boolean(peer?.groupMember), shown: shouldShowConversation(peer), route: Boolean(routableHomeRelay(peer)) };
  }, fpC);
  check('and keeps GAMMA as a quiet group member, not a new chat', hidden.groupMember && !hidden.shown, JSON.stringify(hidden));
  check('with the route to GAMMA\'s relay', hidden.route, JSON.stringify(hidden));

  section('every member hears every member');
  const gA = await groupId(A, 'two-relays');
  const gB = await groupId(B, 'two-relays');
  const gC = await groupId(C, 'two-relays');
  const m1 = `owner-${Date.now()}`;
  await sendTo(A, gA, m1);
  check('BETA hears the owner across relays', await waitFor(B, ({ id, m }) => (chatState.history[id] || []).some((e) => e.text === m), { timeoutMs: 60000, arg: { id: gB, m: m1 } }) === true);
  check('GAMMA hears the owner', await waitFor(C, ({ id, m }) => (chatState.history[id] || []).some((e) => e.text === m), { timeoutMs: 60000, arg: { id: gC, m: m1 } }) === true);

  const m2 = `beta-${Date.now()}`;
  await sendTo(B, gB, m2);
  check('the owner hears BETA', await waitFor(A, ({ id, m }) => (chatState.history[id] || []).some((e) => e.text === m), { timeoutMs: 60000, arg: { id: gA, m: m2 } }) === true);
  check('GAMMA hears BETA — two strangers on two relays', await waitFor(C, ({ id, m }) => (chatState.history[id] || []).some((e) => e.text === m), { timeoutMs: 60000, arg: { id: gC, m: m2 } }) === true,
    JSON.stringify(await historyTexts(C, gC)));

  const m3 = `gamma-${Date.now()}`;
  await sendTo(C, gC, m3);
  check('BETA hears GAMMA the other way', await waitFor(B, ({ id, m }) => (chatState.history[id] || []).some((e) => e.text === m), { timeoutMs: 60000, arg: { id: gB, m: m3 } }) === true,
    JSON.stringify(await historyTexts(B, gB)));

  section('a contact whose relay nobody told us');
  /* DELTA lives on B. EPSILON on A gets DELTA's card with the home relay
     stripped — the shape of a card made before relay identities, or a contact
     typed in by hand. The message must not settle as "relayed" at A, where
     DELTA never comes; A's relay says it does not know DELTA, the route is
     found from B, and the message is delivered there. */
  const D = await openApp('DELTA', { origin: stacks.b.url, relay: stacks.b.url });
  const E = await openApp('EPSILON', { origin: stacks.a.url, relay: stacks.a.url });
  const cardD = await identity(D);
  const fpD = fingerprintOf(cardD);
  const stripped = 'poorija-chat-v1:' + Buffer.from(JSON.stringify({ ...JSON.parse(atob(cardD.replace('poorija-chat-v1:', ''))), homeRelay: null })).toString('base64');
  await importIdentity(E, stripped);
  await E.waitForTimeout(500);
  const imported = await E.evaluate((fp) => findPeerByAnyKey(fp)?.homeRelay?.source || '', fpD);
  check('EPSILON was given no route to DELTA by the card', imported !== 'card', imported || 'none');
  const m4 = `parked-${Date.now()}`;
  const dKey = await E.evaluate((fp) => getConversationKey(findPeerByAnyKey(fp)), fpD);
  await sendTo(E, dKey, m4);
  const routed = await waitFor(E, (fp) => Boolean(routableHomeRelay(findPeerByAnyKey(fp))), { timeoutMs: 60000, arg: fpD });
  const found = await E.evaluate((fp) => routableHomeRelay(findPeerByAnyKey(fp)), fpD);
  check('the route to DELTA was discovered from the linked relay', routed === true && found?.id === stacks.b.health.relayId,
    JSON.stringify({ id: found?.id?.slice(0, 12), source: found?.source }));
  const arrived = await waitFor(D, (m) => Object.values(chatState.history).some((list) => list.some((e) => e.text === m)), { timeoutMs: 90000, arg: m4 });
  check('and the parked message reached DELTA on the other relay', arrived === true);

  check('no page errors on any client', [A, B, C, D, E].every((p) => !(p.__errors || []).length),
    [A, B, C, D, E].flatMap((p) => p.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
