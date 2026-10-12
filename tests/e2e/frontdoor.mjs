/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A front door: relay A answering, at an address of its own, for relay B —
 * the way the relay outside Iran answers for the one inside, which people
 * outside cannot reach over TLS. B dials A (as Iran dials out), and A carries
 * each connection to the door over that link to B's own server.
 *
 *   - A lists the door; through it, B answers as itself (identity, key proof,
 *     its own address for the door);
 *   - somebody registers on B through the door and talks both ways with
 *     somebody on B directly, and with somebody on A across the link;
 *   - large requests pass, and nothing but the named door relay can open a
 *     stream into B;
 *   - a device pinned to B whose address stops answering finds the door
 *     through A and moves to it after the proof; a device that never reached
 *     B finds it by B's name;
 *   - with CHAT_LISTEN_HOSTS the relay's plain port answers loopback and
 *     nothing else.
 */
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, identity, importIdentity, browser, waitFor, makeFile, digestOfLastAttachment, ATTACHMENTS } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const require = createRequire(import.meta.url);
const { createFrontDoor } = require('../../scripts/lib/relay-front.js');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fingerprintOf = (card) => JSON.parse(atob(card.replace('poorija-chat-v1:', ''))).fingerprint;
const sendTo = (page, fp, text) => page.evaluate(async ({ key, value }) => {
  const peer = findPeerByAnyKey(key);
  chatState.activeConversationId = getConversationKey(peer);
  chatState.activePeerClientId = peer.clientId || '';
  renderPeers(); renderActivePeer(); renderMessages();
  await new Promise((r) => setTimeout(r, 300));
  const box = document.getElementById('chatComposer');
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('chatSendMessageBtn').click();
}, { key: fp, value: text });
/* The harness connects to the page's own relay first; moving a device to
   another relay is a reconnect, as it is for a person changing the address. */
const useRelay = async (page, origin) => {
  await page.evaluate(async (target) => {
    chatState.profile.serverUrl = target;
    chatState.profile.presenceUrl = '';
    chatState.profile.peerOrigin = '';
    chatState.profile.activeMirror = null;
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
    renderStaticUi();
    document.getElementById('chatReconnectBtn')?.click();
  }, origin);
  return waitFor(page, (target) => chatState.connected === true
    && new URL(chatState.ws?.url || 'ws://none').host === new URL(target).host, { timeoutMs: 40000, arg: origin });
};
const openConversation = (page, fp) => page.evaluate(async (key) => {
  const peer = findPeerByAnyKey(key);
  chatState.activeConversationId = getConversationKey(peer);
  chatState.activePeerClientId = peer.clientId || '';
  renderPeers(); renderActivePeer(); renderMessages();
  await new Promise((r) => setTimeout(r, 400));
}, fp);
const remoteLive = (page) => page.evaluate(() => {
  const video = document.getElementById('chatRemoteVideo') || document.getElementById('chatFloatingRemoteVideo');
  return (video?.srcObject?.getTracks?.() || []).some((track) => track.readyState === 'live');
});
/* A video call from `caller` to the open conversation; true when media is
   live on both ends. */
async function videoCall(caller, callee, fpCallee) {
  await openConversation(caller, fpCallee);
  await caller.evaluate(() => window.startCall?.('video'));
  const rang = await waitFor(callee, () => {
    const visible = (el) => Boolean(el) && el.offsetParent !== null;
    return visible(document.getElementById('chatAcceptCallBtn')) || visible(document.getElementById('chatModalAcceptBtn'));
  }, { timeoutMs: 60000 });
  if (!rang) return { rang: false, media: false };
  await callee.evaluate(() => (document.getElementById('chatAcceptCallBtn') || document.getElementById('chatModalAcceptBtn'))?.click());
  const onCaller = await waitFor(caller, () => {
    const video = document.getElementById('chatRemoteVideo') || document.getElementById('chatFloatingRemoteVideo');
    return (video?.srcObject?.getTracks?.() || []).some((track) => track.readyState === 'live');
  }, { timeoutMs: 90000 });
  const onCallee = onCaller && await remoteLive(callee);
  await caller.evaluate(() => window.endCurrentCall?.());
  await sleep(2500);
  return { rang: true, media: Boolean(onCaller && onCallee) };
}
async function sendFile(sender, receiver, fpReceiver, bytes) {
  await openConversation(sender, fpReceiver);
  const fixture = makeFile(`door-${bytes}.bin`, bytes);
  const before = await receiver.evaluate((selector) => document.querySelectorAll(selector).length, ATTACHMENTS);
  await sender.setInputFiles('#chatFileInput', fixture.file);
  const arrived = await waitFor(receiver, ({ selector, count }) => {
    document.querySelector('.poorija-dialog:not(.hidden) .poorija-dialog-ok')?.click();
    return document.querySelectorAll(selector).length > count;
  }, { timeoutMs: 180000, arg: { selector: ATTACHMENTS, count: before } });
  if (!arrived) return { arrived: false };
  const got = await digestOfLastAttachment(receiver);
  fs.rmSync(fixture.file, { force: true });
  return { arrived: true, same: got.digest === fixture.digest, size: got.size };
}
const received = (page, text) => waitFor(page, (value) => Object.values(chatState.history)
  .some((list) => list.some((entry) => entry.text === value && entry.direction === 'in')), { timeoutMs: 60000, arg: text });

section('who may open a stream');
{
  const sent = [];
  const link = { peerId: 'c'.repeat(64), send: (frame) => { sent.push(frame); return true; }, bufferedBytes: () => 0 };
  const door = createFrontDoor({ relayPeers: { linkFor: () => link }, doors: ['d'.repeat(64)], localPort: 9 });
  door.onFrame({ kind: 'front', op: 'open', id: '0123456789abcdef' }, link);
  check('a relay that is not a named door is refused, and nothing is connected', sent.some((f) => f.op === 'close') && door.streamCount() === 0);
  door.close();
}

const stacks = await startTwoStacks({ front: true, bNames: ['https://relay-b.test:8585'] });
try {
  section('the door');
  const fronts = await (await fetch(`${stacks.a.url}/relay-fronts`)).json();
  const listed = fronts.fronts?.[0];
  check('A lists the door it keeps for B, with B\'s own names and only those', listed?.relayId === stacks.b.identity.id && listed?.origin === stacks.a.frontUrl
    && listed?.up === true && JSON.stringify(listed?.names) === JSON.stringify(['https://relay-b.test:8585']), JSON.stringify(fronts));
  const viaDoor = await (await fetch(`${stacks.a.frontUrl}/chat-health`)).json();
  check('through it, B answers as itself', viaDoor.relayId === stacks.b.identity.id && viaDoor.relayId !== stacks.a.identity.id);
  check('and gives the door as its address for people who came through it', viaDoor.peerOrigin === stacks.a.frontUrl, viaDoor.peerOrigin);
  const big = 'x'.repeat(3 * 1024 * 1024);
  const started = Date.now();
  const bigAnswer = await fetch(`${stacks.a.frontUrl}/self-destruct/records`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payloadId: 'nope', blob: big }),
  });
  check('a 3 MB request crosses the door whole and is answered by B', bigAnswer.status !== 502 && bigAnswer.status < 500, `${bigAnswer.status} in ${Date.now() - started} ms`);

  section('people on both sides');
  const OUTSIDE = await openApp('OUTSIDE', { origin: stacks.a.url, relay: stacks.a.frontUrl });
  check('the device outside connects its socket through the door', await useRelay(OUTSIDE, stacks.a.frontUrl));
  const INSIDE = await openApp('INSIDE', { origin: stacks.b.url, relay: stacks.b.url });
  const NEIGHBOUR = await openApp('NEIGHBOUR', { origin: stacks.a.url, relay: stacks.a.url });
  const onB = await OUTSIDE.evaluate(() => ({ id: chatState.relayIdentity?.id || relayPinFor(chatServerOrigin())?.id || '', origin: chatServerOrigin(), connected: chatState.connected }));
  const peersOnB = (await (await fetch(`${stacks.b.url}/chat-health`)).json()).peers;
  check('somebody outside registers on B through the door', onB.connected === true && onB.id === stacks.b.identity.id && peersOnB >= 2, `${JSON.stringify(onB)} peers on B: ${peersOnB}`);
  const cardOut = await identity(OUTSIDE);
  const cardIn = await identity(INSIDE);
  const cardNb = await identity(NEIGHBOUR);
  await importIdentity(OUTSIDE, cardIn);
  await importIdentity(INSIDE, cardOut);
  await importIdentity(OUTSIDE, cardNb);
  await importIdentity(NEIGHBOUR, cardOut);
  await sleep(2500);
  const hello = `door-hello-${Date.now()}`;
  await sendTo(OUTSIDE, fingerprintOf(cardIn), hello);
  check('a message from outside reaches somebody inside', await received(INSIDE, hello));
  const back = `door-back-${Date.now()}`;
  await sendTo(INSIDE, fingerprintOf(cardOut), back);
  check('and the answer comes back out', await received(OUTSIDE, back));
  const across = `door-across-${Date.now()}`;
  await sendTo(NEIGHBOUR, fingerprintOf(cardOut), across);
  check('somebody on A reaches the person who came through the door, across the link', await received(OUTSIDE, across));
  const reply = `door-reply-${Date.now()}`;
  await sendTo(OUTSIDE, fingerprintOf(cardNb), reply);
  check('and the reply crosses back', await received(NEIGHBOUR, reply));

  section('calls and files through the door');
  await openConversation(INSIDE, fingerprintOf(cardOut));
  const inCall = await videoCall(OUTSIDE, INSIDE, fingerprintOf(cardIn));
  check('a video call from outside rings inside', inCall.rang === true);
  check('and media flows both ways', inCall.media === true, JSON.stringify(inCall));
  await openConversation(OUTSIDE, fingerprintOf(cardNb));
  const crossCall = await videoCall(NEIGHBOUR, OUTSIDE, fingerprintOf(cardOut));
  check('a call from A to the person behind the door, across the link, connects', crossCall.rang === true && crossCall.media === true, JSON.stringify(crossCall));
  await openConversation(INSIDE, fingerprintOf(cardOut));
  const file = await sendFile(OUTSIDE, INSIDE, fingerprintOf(cardIn), 3 * 1024 * 1024);
  check('a 3 MB file from outside arrives inside byte for byte', file.arrived === true && file.same === true, JSON.stringify(file));
  await openConversation(OUTSIDE, fingerprintOf(cardIn));
  const fileBack = await sendFile(INSIDE, OUTSIDE, fingerprintOf(cardOut), 2 * 1024 * 1024);
  check('and a file from inside arrives outside', fileBack.arrived === true && fileBack.same === true, JSON.stringify(fileBack));

  section('finding the door');
  const moved = await INSIDE.evaluate(async () => {
    /* B's own address stops answering for this device: the configured
       origin is now a dead port, still pinned to B. */
    const pin = relayPinFor(chatServerOrigin());
    const dead = 'http://127.0.0.1:9';
    chatState.profile.relayPins[dead] = pin;
    chatState.profile.serverUrl = dead;
    chatState.profile.activeMirror = null;
    const ok = await attemptRelayFailover();
    return { ok, origin: chatServerOrigin(), primary: chatState.profile.activeMirror?.primary || '' };
  });
  check('a device pinned to B whose address stops answering finds the door through A and moves to it',
    moved.ok === true && moved.origin === stacks.a.frontUrl && moved.primary === 'http://127.0.0.1:9', JSON.stringify(moved));
  check('and connects through it', await waitFor(INSIDE, () => chatState.connected === true, { timeoutMs: 30000 }));

  const FRESH = await openApp('FRESH', { origin: stacks.a.url, relay: stacks.a.url });
  const byName = await FRESH.evaluate(async () => {
    chatState.profile.serverUrl = 'https://relay-b.test:8585';
    chatState.profile.activeMirror = null;
    const ok = await adoptFrontDoorByName();
    return { ok, origin: chatServerOrigin(), pinned: relayPinFor('https://relay-b.test:8585')?.id || '' };
  });
  check('a device that never reached B finds the door by B\'s name, from the relay that served it',
    byName.ok === true && byName.origin === stacks.a.frontUrl && byName.pinned === stacks.b.identity.id, JSON.stringify(byName));
  check('no page errors', [OUTSIDE, INSIDE, NEIGHBOUR, FRESH].every((p) => !(p.__errors || []).length),
    [OUTSIDE, INSIDE, NEIGHBOUR, FRESH].flatMap((p) => p.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}

section('closing the plain port');
{
  const outward = Object.values(os.networkInterfaces()).flat().find((entry) => entry && !entry.internal && (entry.family === 'IPv4' || entry.family === 4));
  if (!outward) {
    check('this machine has an address besides loopback to test from', false, 'none found');
  } else {
    const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-listen-'));
    const child = spawn(process.execPath, ['scripts/server.js'], {
      cwd: ROOT,
      env: {
        ...process.env, CHAT_LISTEN_HOSTS: '127.0.0.1', CHAT_SIGNAL_PORT: String(port), PORT: String(port),
        CHAT_PRESENCE_PORT: '0', CHAT_BOOTSTRAP_PORT: '0', MONITOR_PASSWORD: 'Local-Test-Only-Password-36',
        CHAT_OFFLINE_STORE_PATH: path.join(dir, 'offline.json'), CHAT_OFFLINE_STORE_DIR: path.join(dir, 'mailboxes'),
        CHAT_PUSH_STORE_PATH: path.join(dir, 'push.json'), CHAT_VAPID_STORE_PATH: path.join(dir, 'vapid.json'),
        CHAT_POLICY_STORE_PATH: path.join(dir, 'policy.json'), CHAT_SELF_DESTRUCT_STORE_PATH: path.join(dir, 'sd.json'),
        CHAT_EXPIRY_LOG_PATH: path.join(dir, 'expiry.json'), CHAT_BEACON_DIR: path.join(dir, 'beacons'),
      },
      stdio: 'ignore',
    });
    let local = false;
    for (let i = 0; i < 60 && !local; i += 1) {
      await sleep(250);
      local = await fetch(`http://127.0.0.1:${port}/chat-health`).then((r) => r.ok).catch(() => false);
    }
    const outside = await new Promise((resolve) => {
      const socket = net.connect(port, outward.address);
      socket.on('connect', () => { socket.destroy(); resolve('open'); });
      socket.on('error', (error) => resolve(error.code || 'error'));
      setTimeout(() => { socket.destroy(); resolve('timeout'); }, 3000);
    });
    child.kill('SIGTERM');
    check('the relay answers on loopback', local === true);
    check(`and refuses the same port on ${outward.address}`, outside === 'ECONNREFUSED', outside);
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
