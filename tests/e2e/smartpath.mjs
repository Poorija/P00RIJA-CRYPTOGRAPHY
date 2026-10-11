/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The route a connection across two relays takes, and what carries it.
 *
 *   - a TURN credential for the contact's relay is borrowed for one
 *     connection and never written into the profile;
 *   - a contact whose direct path failed recently starts relay-only;
 *   - a direct path that stays poor asks for a relay path once;
 *   - a live data channel opens between two people on two relays, and a
 *     message and a file ride it rather than the relays.
 */
import { openApp, identity, importIdentity, browser, waitFor, makeFile, digestOfLastAttachment, MB } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const fingerprintOf = (card) => JSON.parse(atob(card.replace('poorija-chat-v1:', ''))).fingerprint;

const stacks = await startTwoStacks();
try {
  section('two people on two relays who have swapped cards');
  const A = await openApp('NORTH', { origin: stacks.a.url, relay: stacks.a.url });
  const B = await openApp('SOUTH', { origin: stacks.b.url, relay: stacks.b.url });
  const cardA = await identity(A);
  const cardB = await identity(B);
  const fpA = fingerprintOf(cardA);
  const fpB = fingerprintOf(cardB);
  await importIdentity(A, cardB);
  await importIdentity(B, cardA);
  const routed = await waitFor(A, (fp) => Boolean(routableHomeRelay(findPeerByAnyKey(fp))), { timeoutMs: 30000, arg: fpB });
  check('the card gave a route across the link', routed === true);
  await waitFor(B, (fp) => Boolean(routableHomeRelay(findPeerByAnyKey(fp))), { timeoutMs: 30000, arg: fpA });

  section('a TURN borrowed for one connection');
  const borrowed = await A.evaluate(async (fp) => {
    const far = await turnServersForContact(findPeerByAnyKey(fp));
    const config = await buildIceConfigFor(findPeerByAnyKey(fp));
    return {
      far,
      servers: config.iceServers.length,
      policy: config.iceTransportPolicy || 'all',
      profileUser: chatState.profile.turnUsername,
    };
  }, fpB);
  check('the contact\'s relay handed over an expiring credential', /^\d+:[0-9a-f]+$/.test(borrowed.far?.username || ''), borrowed.far?.username);
  check('the connection is configured with both TURN servers', borrowed.servers >= 2, String(borrowed.servers));
  check('and starts on every path, direct ones included', borrowed.policy === 'all');
  check('the profile still holds only this device\'s own TURN', borrowed.profileUser !== borrowed.far?.username);

  const relayFirst = await A.evaluate(async (fp) => {
    noteDirectPath(fp, false);
    const config = await buildIceConfigFor(findPeerByAnyKey(fp));
    const policy = config.iceTransportPolicy || 'all';
    noteDirectPath(fp, true);
    const after = (await buildIceConfigFor(findPeerByAnyKey(fp))).iceTransportPolicy || 'all';
    return { policy, after };
  }, fpB);
  check('after a direct path failed, the next connection starts relay-only', relayFirst.policy === 'relay', relayFirst.policy);
  check('and a direct path that held clears that again', relayFirst.after === 'all', relayFirst.after);

  const escalated = await A.evaluate((fp) => {
    const sent = [];
    const fakePc = {
      config: { iceServers: [{ urls: ['turn:127.0.0.1:3478?transport=udp'], username: 'u', credential: 'c' }] },
      getConfiguration() { return this.config; },
      setConfiguration(next) { this.config = next; },
    };
    const realSend = window.sendIceRestartOffer;
    window.sendIceRestartOffer = (pc, options) => { sent.push(options); return Promise.resolve(true); };
    chatState.currentCallDirection = 'out';
    const peer = findPeerByAnyKey(fp);
    for (let i = 0; i < 4; i += 1) watchCallPath(fakePc, { route: 'direct', rtt: 900, lossPercent: 12 }, peer);
    window.sendIceRestartOffer = realSend;
    noteDirectPath(fp, true);
    return { policy: fakePc.config.iceTransportPolicy || 'all', restarts: sent.length, forced: sent[0]?.forceRelay === true };
  }, fpB);
  check('a direct path that stays poor is moved to a relay path once', escalated.policy === 'relay' && escalated.restarts === 1 && escalated.forced,
    JSON.stringify(escalated));

  section('a live channel across the two relays');
  await A.evaluate((fp) => startSecureSession(findPeerByAnyKey(fp), { silent: true }), fpB);
  const opened = await waitFor(A, (fp) => {
    const peer = findPeerByAnyKey(fp);
    const session = peer && chatState.sessions.get(peer.peerId);
    return Boolean(session?.connection?.relayLink && session.connection.open && session.cryptoKey);
  }, { timeoutMs: 45000, arg: fpB });
  check('the data link opened and the session keyed itself over it', opened === true);
  const openedB = await waitFor(B, (fp) => {
    const peer = findPeerByAnyKey(fp);
    const session = peer && chatState.sessions.get(peer.peerId);
    return Boolean(session?.connection?.relayLink && session.connection.open);
  }, { timeoutMs: 20000, arg: fpA });
  check('on the other side too', openedB === true);

  const marker = `over-the-link-${Date.now()}`;
  const carriedBefore = await fetch(`${stacks.a.url}/chat-health`).then((r) => r.json()).then((h) => h.transit);
  await A.evaluate(async ({ fp, text }) => {
    const peer = findPeerByAnyKey(fp);
    chatState.activeConversationId = getConversationKey(peer);
    chatState.activePeerClientId = peer.clientId || '';
    renderPeers(); renderActivePeer(); renderMessages();
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('chatComposer').value = text;
    document.getElementById('chatSendMessageBtn').click();
  }, { fp: fpB, text: marker });
  const arrived = await waitFor(B, (m) => Object.values(chatState.history).some((list) => list.some((e) => e.text === m)), { timeoutMs: 30000, arg: marker });
  check('a message rides the link', arrived === true);
  const status = await A.evaluate((m) => Object.values(chatState.history).flat().find((e) => e.text === m)?.status, marker);
  check('and the sender sees it as sent directly, not queued at a relay', ['sent', 'delivered', 'seen'].includes(status), status);

  const made = makeFile('link-file.bin', 3 * MB);
  const expected = made.digest;
  await B.evaluate((fp) => {
    const peer = findPeerByAnyKey(fp);
    chatState.activeConversationId = getConversationKey(peer);
    chatState.activePeerClientId = peer.clientId || '';
    renderPeers(); renderActivePeer(); renderMessages();
  }, fpA);
  await A.setInputFiles('#chatFileInput', made.file);
  const landed = await waitFor(B, () => document.querySelectorAll('#chatMessages a[data-chat-download-message][href^="blob:"]').length > 0, { timeoutMs: 90000 });
  const got = landed ? await digestOfLastAttachment(B) : null;
  check('a 3 MB file crosses over the link intact', got?.digest === expected, got ? `${got.size} bytes ${String(got.digest).slice(0, 12)}` : 'nothing arrived');
  const viaLink = await A.evaluate(() => Array.from(chatState.sessions.values()).some((s) => s.connection?.relayLink && s.connection.open));
  check('and the link is still the live channel afterwards', viaLink === true);

  check('no page errors', [A, B].every((p) => !(p.__errors || []).length), [A, B].flatMap((p) => p.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
