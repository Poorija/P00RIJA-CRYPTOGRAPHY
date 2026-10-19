/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A device whose account address is already held still gets onto P2P.
 *
 *   When the relay says the account's peer id is taken — a linked sibling is
 *   online with it, or this device's own socket from before an unclean close
 *   is still registered — the device takes its own id: the account's id plus
 *   the end of its device id. That id was joined with "~", which PeerJS
 *   refuses, so the peer never opened; the choice is kept in the profile, so
 *   every reconnect and every restart failed the same way until the app was
 *   wiped. Here:
 *
 *   - BAHAR, given ARIF's address, comes up on an id of her own that PeerJS
 *     takes, while ARIF keeps his;
 *   - the id is the same on the next connect, and after a restart;
 *   - a device left stuck by the old build (the flag already set) comes up at
 *     once, with no wipe;
 *   - and an id PeerJS refuses anyway is not retried forever: the device goes
 *     back to the account's id and comes up on it.
 */
import { openApp, browser, waitFor, PASS } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 260) : ''}`);
};
const PEERJS_ID = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;
const state = (page) => page.evaluate(() => ({
  open: Boolean(chatState.peer?.open),
  peerId: chatState.peerId,
  account: chatState.profile.stablePeerId,
  suffix: Boolean(chatState.profile.peerIdSuffix),
}));
const opened = (page) => waitFor(page, () => Boolean(chatState.peer?.open && chatState.peerId), { timeoutMs: 30000 });

const stacks = await startTwoStacks();
try {
  const ARIF = await openApp('ARIF', { origin: stacks.a.url, relay: stacks.a.url });
  const BAHAR = await openApp('BAHAR', { origin: stacks.a.url, relay: stacks.a.url });
  const arif = await state(ARIF);
  check('both start on P2P with ids of their own', arif.open && (await state(BAHAR)).open, JSON.stringify(arif));

  /* BAHAR now carries ARIF's address, as a linked sibling does. */
  await BAHAR.evaluate((id) => {
    chatState.profile.stablePeerId = id;
    chatState.profile.peerIdSuffix = false;
    rebuildPeerTransport();
  }, arif.account);
  await opened(BAHAR);
  const sibling = await state(BAHAR);
  check('given an address that is already held, she comes up on an id of her own that PeerJS takes',
    sibling.open && sibling.suffix && sibling.peerId.startsWith(`${arif.account}-`) && PEERJS_ID.test(sibling.peerId),
    JSON.stringify(sibling));
  const stillArif = await state(ARIF);
  check('and the account\'s address stays with the device that holds it', stillArif.open && stillArif.peerId === arif.account, JSON.stringify(stillArif));

  await BAHAR.evaluate(() => rebuildPeerTransport());
  await BAHAR.waitForTimeout(800);
  await opened(BAHAR);
  const again = await state(BAHAR);
  check('the same id on the next connect', again.open && again.peerId === sibling.peerId, JSON.stringify(again));

  await BAHAR.reload({ waitUntil: 'load' });
  await BAHAR.waitForTimeout(1800);
  await BAHAR.evaluate((p) => { const el = document.getElementById('unlockPassword'); if (el) { el.value = p; el.dispatchEvent(new Event('input', { bubbles: true })); } }, PASS);
  await BAHAR.evaluate(() => window.unlockApp?.());
  await opened(BAHAR);
  const restarted = await state(BAHAR);
  check('and after a restart', restarted.open && restarted.peerId === sibling.peerId, JSON.stringify(restarted));

  /* A device the old build left stuck: its own address, the flag already set. */
  const CAVEH = await openApp('CAVEH', { origin: stacks.a.url, relay: stacks.a.url });
  await CAVEH.evaluate(() => {
    chatState.profile.peerIdSuffix = true;
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
    rebuildPeerTransport();
  });
  await CAVEH.waitForTimeout(800);
  await opened(CAVEH);
  const unstuck = await state(CAVEH);
  check('a device the old build left stuck comes up at once, with no wipe', unstuck.open && PEERJS_ID.test(unstuck.peerId), JSON.stringify(unstuck));

  /* An id PeerJS refuses, whatever the reason: back to the account's id. */
  await CAVEH.evaluate(() => {
    window.__realDevicePeerId = window.devicePeerId;
    window.devicePeerId = () => 'not~valid';
    chatState.invalidPeerIdRetried = false;
    chatState.profile.peerIdSuffix = true;
    rebuildPeerTransport();
  });
  await CAVEH.waitForTimeout(1500);
  await opened(CAVEH);
  const recovered = await state(CAVEH);
  await CAVEH.evaluate(() => { window.devicePeerId = window.__realDevicePeerId; });
  check('an id PeerJS refuses is not retried forever: the device comes up on the account\'s id', recovered.open && recovered.peerId === recovered.account && !recovered.suffix, JSON.stringify(recovered));

  const errors = [...(ARIF.__errors || []), ...(BAHAR.__errors || []), ...(CAVEH.__errors || [])];
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
