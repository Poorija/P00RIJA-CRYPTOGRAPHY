/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* "They are offline" is the wrong thing to say to somebody whose recipient
 * is online and typing.
 *
 * Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
 *
 *   PORT=8123 npm run dev            # terminal 1
 *   node tests/e2e/sendsession.mjs
 *
 * A direct conversation has two separate states that looked identical from
 * the composer: the recipient is away, and the recipient is here but the
 * peer-to-peer channel has not been opened yet. The second is the ordinary
 * state of a conversation you have not sent anything in yet, and it produced
 * two confusing outcomes — a file over MAX_OFFLINE_FILE_BYTES refused with
 * "this contact is offline", and everything under it routed the slow way
 * through the relay mailbox for no reason. Opening the session is one button
 * in the chat menu.
 *
 * So the send now offers it. The risk in an advisory is that it becomes
 * noise, and noise is not read, so most of what follows asserts the times it
 * must stay quiet — an open channel, a small file, a group, a peer who really
 * is away. One assertion covers the case it exists for.
 */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await settle(page);

const present = await page.evaluate(() => ({
  offer: typeof window.offerSecureSessionBeforeLargeSend === 'function',
  start: typeof window.startSecureSession === 'function',
  threshold: (() => { try { return LARGE_FILE_CONFIRM_BYTES; } catch (_error) { return 0; } })(),
  offlineCap: (() => { try { return MAX_OFFLINE_FILE_BYTES; } catch (_error) { return 0; } })(),
}));
check('the send path has somewhere to make the offer from', present.offer);
check('and the button it names is a real function', present.start);
check('the size that counts as large is the project\'s own line',
  present.threshold === 25 * 1024 * 1024, `LARGE_FILE_CONFIRM_BYTES = ${present.threshold}`);

if (!present.offer) {
  console.log(`\n===== ${results.filter((ok) => !ok).length} failed of ${results.length} =====`);
  await browser.close();
  process.exit(1);
}

/* The stub records what was asked and answers however the case wants. The
   real startSecureSession dials a peer that is not there, so it is replaced
   too — what is under test is whether the offer is made and acted on, not
   whether PeerJS can reach a peer that does not exist. */
await page.evaluate(() => {
  window.__probe = { prompts: [], starts: 0, answer: false, opensChannel: false };
  PoorijaDialogs.confirm = async (message, options) => {
    window.__probe.prompts.push({ message: String(message), ok: String(options?.okLabel || '') });
    return window.__probe.answer;
  };
  window.startSecureSession = async (peerRecord) => {
    window.__probe.starts += 1;
    const session = { cryptoKey: {}, connection: { open: window.__probe.opensChannel } };
    chatState.sessions.set(peerRecord.peerId, session);
    return session;
  };
  window.__ask = async ({ status = 'online', size = 40 * 1024 * 1024, type = '', open = false, key = 'k' }) => {
    const before = window.__probe.prompts.length;
    const peer = { peerId: `peer-${key}`, conversationId: `conv-${key}`, username: 'Somebody', status, type };
    const session = open ? { cryptoKey: {}, connection: { open: true } } : null;
    const file = { name: 'clip.mp4', size };
    const out = await window.offerSecureSessionBeforeLargeSend(peer, session, file);
    return {
      prompted: window.__probe.prompts.length > before,
      message: window.__probe.prompts[window.__probe.prompts.length - 1]?.message || '',
      okLabel: window.__probe.prompts[window.__probe.prompts.length - 1]?.ok || '',
      starts: window.__probe.starts,
      channelOpen: Boolean(out?.connection?.open),
    };
  };
});

/* Every case that must stay silent. A distinct key each time, because the
   once-per-conversation memory is the whole point of the last one. */
const quiet = await page.evaluate(async () => ({
  openChannel: await window.__ask({ open: true, key: 'open' }),
  smallFile: await window.__ask({ size: 2 * 1024 * 1024, key: 'small' }),
  offlinePeer: await window.__ask({ status: 'offline', key: 'away' }),
  group: await window.__ask({ type: 'group', key: 'group' }),
}));
check('an open channel is not interrupted', quiet.openChannel.prompted === false);
check('a small file is not interrupted', quiet.smallFile.prompted === false);
check('a peer who really is away gets no session advice',
  quiet.offlinePeer.prompted === false,
  'there is nobody to open a channel to');
check('a group is not offered a session it does not have',
  quiet.group.prompted === false,
  'each member has their own, created automatically');

/* The case it exists for. */
const asked = await page.evaluate(async () => window.__ask({ key: 'real' }));
check('A LARGE FILE TO AN ONLINE PEER WITH NO CHANNEL IS OFFERED THE SESSION — the case this exists for',
  asked.prompted === true, asked.message.slice(0, 70).replace(/\n/g, ' ⏎ '));
check('and the popup names the button in the chat menu, in the user\'s own words',
  /ساخت سشن امن/.test(asked.message) || /Create secure session/i.test(asked.message),
  asked.okLabel);
check('the confirm button is the action itself, not "OK"',
  /ساخت سشن امن|Create secure session/i.test(asked.okLabel), asked.okLabel);

/* Advice that repeats is not read. */
const again = await page.evaluate(async () => window.__ask({ key: 'real' }));
check('the same conversation is not asked twice', again.prompted === false);
const other = await page.evaluate(async () => window.__ask({ key: 'other' }));
check('but a different conversation still gets asked once', other.prompted === true);

/* Declining must leave the send alone rather than cancelling it: the file
   still goes, by whatever route is available. */
const declined = await page.evaluate(async () => {
  window.__probe.answer = false;
  const startsBefore = window.__probe.starts;
  const out = await window.__ask({ key: 'declined' });
  return { ...out, opened: window.__probe.starts > startsBefore };
});
check('declining opens no session and does not cancel the send',
  declined.prompted === true && declined.opened === false,
  'the file continues on whatever route is available');

/* Accepting has to actually produce a channel the caller can use — the whole
   reason the helper returns a session rather than a boolean. */
const accepted = await page.evaluate(async () => {
  window.__probe.answer = true;
  window.__probe.opensChannel = true;
  const startsBefore = window.__probe.starts;
  const out = await window.__ask({ key: 'accepted' });
  return { ...out, opened: window.__probe.starts > startsBefore };
});
check('accepting creates the session', accepted.opened === true);
check('AND HANDS THE SEND THE OPEN CHANNEL, not the stale one it came in with',
  accepted.channelOpen === true,
  'a boolean return would have left the caller holding the session that had no channel');

/* A peer that never answers must not hang the send. */
const neverOpens = await page.evaluate(async () => {
  window.__probe.answer = true;
  window.__probe.opensChannel = false;
  const began = Date.now();
  const out = await window.__ask({ key: 'silent' });
  return { ...out, ms: Date.now() - began };
});
check('a peer that does not answer times out instead of hanging the send',
  neverOpens.ms < 20000 && neverOpens.channelOpen === false,
  `gave up after ${(neverOpens.ms / 1000).toFixed(1)}s`);

/* The refusal wording, which is where the original lie lived. */
const wording = await page.evaluate(() => {
  const source = String(window.sendEncryptedBlob || '');
  return {
    checksPresence: /peerIsHere/.test(source),
    keepsOfflineWording: /آفلاین است/.test(source),
    hasSessionWording: /ساخت سشن امن/.test(source),
  };
});
check('THE BIG-FILE REFUSAL NO LONGER CALLS AN ONLINE PEER OFFLINE — the report behind this',
  wording.checksPresence && wording.hasSessionWording,
  'it now says which of the two states actually blocked the send');
check('and still says "offline" when the peer genuinely is',
  wording.keepsOfflineWording,
  'the old sentence was right for the case it was written for');

await browser.close();
const bad = results.filter((ok) => !ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
