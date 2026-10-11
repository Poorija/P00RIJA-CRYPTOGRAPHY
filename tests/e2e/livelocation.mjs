/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Live location, with the browser's own geolocation moved by the test.
 *
 *   - one card arrives and its pin follows the sender, the updates never
 *     becoming messages of their own;
 *   - a move inside the minimum interval is sent when the interval is up;
 *   - an update that is older, out of range, or from somebody else is
 *     refused by the receiver;
 *   - stopping, running out, and closing the app all end the share, on both
 *     sides, and a share is never resumed by itself.
 */
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
const liveCard = (page, id) => page.evaluate((shareId) => {
  const entry = Object.values(chatState.history).flat().find((e) => e.id === shareId);
  const rich = entry ? richPayloadOf(entry) : null;
  return rich ? { lat: rich.lat, lng: rich.lng, stopped: Boolean(rich.stopped), at: rich.at, until: rich.until, direction: entry.direction } : null;
}, id);

const stacks = await startTwoStacks();
try {
  section('two contacts, one of them about to walk somewhere');
  const WALKER = await openApp('WALKER', { origin: stacks.a.url, relay: stacks.a.url });
  const WATCHER = await openApp('WATCHER', { origin: stacks.a.url, relay: stacks.a.url });
  await WALKER.context().grantPermissions(['geolocation'], { origin: stacks.a.url });
  await WALKER.context().setGeolocation({ latitude: 35.6997, longitude: 51.3380, accuracy: 12 });
  const cardWalker = await identity(WALKER);
  const cardWatcher = await identity(WATCHER);
  const fpWalker = fingerprintOf(cardWalker);
  const fpWatcher = fingerprintOf(cardWatcher);
  await importIdentity(WALKER, cardWatcher);
  await importIdentity(WATCHER, cardWalker);
  await waitFor(WALKER, (fp) => Boolean(findPeerByAnyKey(fp)?.publicKeyData), { timeoutMs: 30000, arg: fpWatcher });

  section('starting a share for 15 minutes');
  await openConversation(WALKER, fpWatcher);
  const shareId = await WALKER.evaluate(async () => {
    const original = PoorijaDialogs.choose;
    PoorijaDialogs.choose = async () => String(15 * 60 * 1000);
    try { return await startLiveLocation(); } finally { PoorijaDialogs.choose = original; }
  });
  check('the share starts', typeof shareId === 'string' && shareId.length > 4, String(shareId));
  const arrived = await waitFor(WATCHER, (id) => Object.values(chatState.history).flat().some((e) => e.id === id), { timeoutMs: 60000, arg: shareId });
  check('one card arrives', arrived === true);
  const first = await liveCard(WATCHER, shareId);
  check('at the walker\'s position, live, ending in about 15 minutes',
    Math.abs(first.lat - 35.6997) < 1e-4 && Math.abs(first.lng - 51.338) < 1e-4 && !first.stopped
    && Math.abs(Date.parse(first.until) - Date.now() - 15 * 60 * 1000) < 120000, JSON.stringify(first));
  await openConversation(WATCHER, fpWalker);
  const drawn = await WATCHER.evaluate(() => Boolean(document.querySelector('#chatMessages .chat-live-location.is-live .chat-live-dot')));
  check('drawn as a live card', drawn === true);

  section('walking');
  const entriesBefore = await WATCHER.evaluate(() => Object.values(chatState.history).flat().length);
  await WALKER.context().setGeolocation({ latitude: 35.7030, longitude: 51.3420, accuracy: 10 });
  const moved = await waitFor(WATCHER, ({ id }) => {
    const entry = Object.values(chatState.history).flat().find((e) => e.id === id);
    return Math.abs(richPayloadOf(entry)?.lat - 35.703) < 1e-4;
  }, { timeoutMs: 45000, arg: { id: shareId } });
  check('a move inside the minimum interval still arrives, once the interval is up', moved === true);
  const entriesAfter = await WATCHER.evaluate(() => Object.values(chatState.history).flat().length);
  check('the update moved the pin and added no message', entriesAfter === entriesBefore, `${entriesBefore} → ${entriesAfter}`);

  section('updates the receiver must refuse');
  const refusals = await WATCHER.evaluate(({ id, walker }) => {
    const key = getConversationKey(findPeerByAnyKey(walker));
    const session = chatState.sessions.get(findPeerByAnyKey(walker).peerId) || { remoteFingerprint: walker };
    const entry = Object.values(chatState.history).flat().find((e) => e.id === id);
    const before = { ...richPayloadOf(entry) };
    const older = applyLiveLocationUpdate(key, { kind: 'live-location-update', shareId: id, lat: 1, lng: 1, at: new Date(Date.parse(before.at) - 60000).toISOString() }, session);
    const nonsense = applyLiveLocationUpdate(key, { kind: 'live-location-update', shareId: id, lat: 200, lng: 1, at: new Date().toISOString() }, session);
    const future = applyLiveLocationUpdate(key, { kind: 'live-location-update', shareId: id, lat: 2, lng: 2, at: new Date(Date.now() + 3600000).toISOString() }, session);
    const otherThread = applyLiveLocationUpdate('some-other-conversation', { kind: 'live-location-update', shareId: id, lat: 3, lng: 3, at: new Date().toISOString() }, session);
    const after = richPayloadOf(entry);
    return { older, nonsense, future, otherThread, unchanged: after.lat === before.lat && after.lng === before.lng };
  }, { id: shareId, walker: fpWalker });
  check('an older update, a position off the planet, a time in the future and another thread are all refused',
    !refusals.older && !refusals.nonsense && !refusals.future && !refusals.otherThread && refusals.unchanged, JSON.stringify(refusals));

  section('stopping');
  await WALKER.evaluate((id) => stopLiveLocation(id, 'stopped'), shareId);
  const stopped = await waitFor(WATCHER, (id) => richPayloadOf(Object.values(chatState.history).flat().find((e) => e.id === id))?.stopped === true, { timeoutMs: 30000, arg: shareId });
  check('stopping ends it on the other side', stopped === true);
  const afterStop = await WATCHER.evaluate(({ id, walker }) => {
    const key = getConversationKey(findPeerByAnyKey(walker));
    return applyLiveLocationUpdate(key, { kind: 'live-location-update', shareId: id, lat: 4, lng: 4, at: new Date().toISOString() }, { remoteFingerprint: walker });
  }, { id: shareId, walker: fpWalker });
  check('and nothing moves it afterwards', afterStop === false);
  const watchCleared = await WALKER.evaluate((id) => !liveShares.has(id), shareId);
  check('the walker\'s device stopped watching its position', watchCleared === true);

  section('running out');
  const shortId = await WALKER.evaluate(async (fp) => {
    const coords = { lat: 35.70, lng: 51.34, accuracy: 10, at: new Date().toISOString() };
    return beginLiveShare(findPeerByAnyKey(fp), coords, 4000);
  }, fpWatcher);
  await waitFor(WATCHER, (id) => Object.values(chatState.history).flat().some((e) => e.id === id), { timeoutMs: 60000, arg: shortId });
  const ranOut = await waitFor(WATCHER, (id) => richPayloadOf(Object.values(chatState.history).flat().find((e) => e.id === id))?.stopped === true, { timeoutMs: 40000, arg: shortId });
  check('a share that runs out ends by itself, on both sides', ranOut === true);

  section('closing the app');
  const orphanId = await WALKER.evaluate(async (fp) => {
    const coords = { lat: 35.71, lng: 51.35, accuracy: 10, at: new Date().toISOString() };
    const id = await beginLiveShare(findPeerByAnyKey(fp), coords, 60 * 60 * 1000);
    /* What a restart leaves behind: the card, and no watch running for it. */
    const share = liveShares.get(id);
    if (share?.watchId !== null) navigator.geolocation.clearWatch(share.watchId);
    clearTimeout(share?.stopTimer);
    clearInterval(share?.heartbeatTimer);
    liveShares.delete(id);
    endOrphanedLiveShares();
    return id;
  }, fpWatcher);
  const notResumed = await liveCard(WALKER, orphanId);
  check('a share left running when the app closed is ended, not resumed', notResumed?.stopped === true, JSON.stringify(notResumed));
  const otherSideToo = await waitFor(WATCHER, (id) => richPayloadOf(Object.values(chatState.history).flat().find((e) => e.id === id))?.stopped === true, { timeoutMs: 40000, arg: orphanId });
  check('and the other side is told', otherSideToo === true);

  check('no page errors', [WALKER, WATCHER].every((p) => !(p.__errors || []).length), [WALKER, WATCHER].flatMap((p) => p.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
