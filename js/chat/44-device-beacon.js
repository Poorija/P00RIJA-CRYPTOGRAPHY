/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* ============================================================================
   Several devices, one history — kept device to device.
   ============================================================================

   The rule this follows: no server keeps anybody's history, files or
   sessions for the sake of a second device. Devices of one account sync with
   each other directly while both are online; one that is away carries on and
   catches up the moment it and a sibling are online together.

   What used to break that rule was the shared mailbox. A device with
   siblings held back its acknowledgements while any sibling was away, so the
   relay kept every message — media chunks included — until the last device
   returned, possibly for weeks: a mailbox turned into a sync store by the back
   door. Acknowledgements now go out at once (ackRelayMessage); the sibling
   that was away gets those messages from a sibling, not from the relay.

   For it to know THAT it is behind, and which sibling to ask, each device
   leaves a beacon with the relay: a few kilobytes, encrypted on the device to
   the account's own key, opaque to the relay, hard-capped at 8 KB and kept
   for thirty days. It names, per conversation, the time of the newest entry
   this device holds (under a hashed name), when the call log last changed,
   and which relay this device lives on — nothing that was said, nobody's
   name, no file. A device that comes back reads its siblings' beacons, sees
   which conversations are ahead elsewhere, says so, and asks for exactly
   those the moment the sibling is online. Files never travel unless asked
   for, and then only between two devices that are both online.
   ============================================================================ */

const BEACON_WRITE_DELAY_MS = 15000;
const BEACON_MAX_CONVERSATIONS = 160;
const BEACON_PAYLOAD_BUDGET = 7600;     /* bytes of ciphertext; the relay caps the blob at 11000 base64 chars */
const SIBLING_SYNC_MIN_INTERVAL_MS = 20000;
const MIRROR_BATCH_DELAY_MS = 400;

let beaconWriteTimer = null;
let beaconLastWrittenSignature = '';
const siblingBeacons = new Map();       /* deviceId -> decoded beacon */

function conversationLatestAt(entries) {
  let latest = 0;
  for (const entry of entries || []) {
    const at = Date.parse(entry?.createdAt || 0) || Number(entry?.timestamp || 0) || 0;
    if (at > latest) latest = at;
  }
  return latest;
}

async function syncNameHash(conversationKey) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`poorija-sync|${conversationKey}`));
  return Array.from(new Uint8Array(digest).slice(0, 6)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/* This device's cursors: newest entry per conversation, newest first. */
function localSyncCursors() {
  const out = [];
  for (const [key, entries] of Object.entries(chatState.history || {})) {
    if (!key || key === 'system' || !Array.isArray(entries) || !entries.length) continue;
    out.push({ key, at: conversationLatestAt(entries), count: entries.length });
  }
  return out.sort((a, b) => b.at - a.at);
}

function deviceLabel() {
  const platform = navigator.userAgentData?.platform || '';
  const ua = navigator.userAgent || '';
  const guess = platform
    || (/iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '');
  const shell = window.__POORIJA_DESKTOP__ ? 'app' : 'web';
  return `${guess || 'device'} ${shell}`.trim().slice(0, 32);
}

async function compressBytes(bytes) {
  if (typeof CompressionStream !== 'function') return { bytes, packed: false };
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), packed: true };
  } catch (_error) {
    return { bytes, packed: false };
  }
}
async function decompressBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* [u16 seal length][RSA-OAEP seal of the AES key][12-byte IV][flag][AES-GCM ciphertext] */
async function sealBeacon(object) {
  const json = new TextEncoder().encode(JSON.stringify(object));
  const { bytes, packed } = await compressBytes(json);
  const rawKey = app().generateSecureRandomBytes(32);
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = app().generateSecureRandomBytes(12);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const publicKey = await importIdentityPublicKey(chatState.identity.publicKeyData);
  const seal = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey));
  const out = new Uint8Array(2 + seal.length + 12 + 1 + cipher.length);
  new DataView(out.buffer).setUint16(0, seal.length);
  out.set(seal, 2);
  out.set(iv, 2 + seal.length);
  out[2 + seal.length + 12] = packed ? 1 : 0;
  out.set(cipher, 2 + seal.length + 13);
  return { blob: bytesToBase64(out), cipherBytes: cipher.length };
}

async function openBeacon(blob) {
  const bytes = base64ToBytes(blob);
  const sealLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0);
  const seal = bytes.slice(2, 2 + sealLength);
  const iv = bytes.slice(2 + sealLength, 2 + sealLength + 12);
  const packed = bytes[2 + sealLength + 12] === 1;
  const cipher = bytes.slice(2 + sealLength + 13);
  const key = await openOfflineSeal(app().arrayBufferToBase64(seal));
  let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
  if (packed) plain = await decompressBytes(plain);
  return JSON.parse(new TextDecoder().decode(plain));
}

/* What goes in: as many conversations as fit the budget, newest first. */
async function buildBeacon() {
  const cursors = localSyncCursors();
  const conversations = [];
  for (const cursor of cursors.slice(0, BEACON_MAX_CONVERSATIONS)) {
    conversations.push([await syncNameHash(cursor.key), Math.floor(cursor.at / 1000).toString(36), cursor.count.toString(36)]);
  }
  const newestCall = (chatState.calls || []).reduce((latest, call) => Math.max(latest, Date.parse(call?.createdAt || 0) || 0), 0);
  const base = {
    v: 1,
    d: getDeviceId(),
    n: deviceLabel(),
    u: Math.floor(Date.now() / 1000),
    r: typeof myHomeRelay === 'function' ? myHomeRelay() : null,
    k: Math.floor(newestCall / 1000),
    p: (chatState.peers || []).filter((peer) => !peer.type && typeof isStoredContact === 'function' && isStoredContact(peer)).length,
  };
  /* Shrunk until it fits: a very long list of conversations loses its oldest
     entries, which are the ones least likely to matter. */
  let keep = conversations.length;
  for (;;) {
    const sealed = await sealBeacon({ ...base, c: conversations.slice(0, keep) });
    if (sealed.cipherBytes <= BEACON_PAYLOAD_BUDGET || keep <= 8) return sealed.blob;
    keep = Math.floor(keep * 0.75);
  }
}

function scheduleBeaconWrite(delay = BEACON_WRITE_DELAY_MS) {
  if (beaconWriteTimer) return;
  beaconWriteTimer = window.setTimeout(() => {
    beaconWriteTimer = null;
    writeBeacon().catch((error) => console.warn('[Devices] the beacon was not written:', error?.message || error));
  }, delay);
}

async function writeBeacon() {
  if (!chatState.identity?.publicKeyData || !chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return;
  /* Unchanged since the last write: nothing to tell anybody. */
  const signature = JSON.stringify(localSyncCursors().slice(0, 40).map((cursor) => [cursor.key, cursor.at, cursor.count]))
    + `|${(chatState.calls || []).length}`;
  if (signature === beaconLastWrittenSignature) return;
  const blob = await buildBeacon();
  chatState.ws.send(JSON.stringify({ type: 'beacon-put', deviceId: getDeviceId(), blob }));
  beaconLastWrittenSignature = signature;
}

function requestBeacons() {
  if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return;
  chatState.ws.send(JSON.stringify({ type: 'beacon-get' }));
}

/* The relay's answer to beacon-get: every device's blob, this one's included. */
async function handleBeacons(items) {
  const mine = getDeviceId();
  const cursorsByHash = new Map();
  for (const cursor of localSyncCursors()) cursorsByHash.set(await syncNameHash(cursor.key), cursor);
  let behindConversations = 0;
  let behindDevice = null;
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.deviceId || item.deviceId === mine || !item.blob) continue;
    let beacon;
    try {
      beacon = await openBeacon(item.blob);
    } catch (_error) {
      continue;   /* not sealed to this account's key: not a sibling's */
    }
    if (!beacon || beacon.d !== item.deviceId) continue;
    siblingBeacons.set(item.deviceId, { ...beacon, at: item.at });
    let ahead = 0;
    for (const [hash, atBase36] of Array.isArray(beacon.c) ? beacon.c : []) {
      const theirs = parseInt(atBase36, 36) * 1000;
      const ours = cursorsByHash.get(hash)?.at || 0;
      if (theirs > ours + 2000) ahead += 1;
    }
    if (ahead > behindConversations) { behindConversations = ahead; behindDevice = beacon; }
  }
  chatState.deviceSyncBehind = behindConversations ? { conversations: behindConversations, device: behindDevice?.n || '', deviceId: behindDevice?.d || '' } : null;
  renderDeviceSyncHint();
  if (behindConversations) requestDeltaFromSiblings({ reason: 'beacon' });
}

/* A quiet line, not a toast: it stays true until the sync happens. */
function renderDeviceSyncHint() {
  const behind = chatState.deviceSyncBehind;
  let hint = document.getElementById('chatDeviceSyncHint');
  if (!behind) { hint?.remove(); return; }
  if (!hint) {
    const host = document.getElementById('chatPeerList')?.parentElement;
    if (!host) return;
    hint = document.createElement('div');
    hint.id = 'chatDeviceSyncHint';
    hint.className = 'chat-device-sync-hint';
    hint.setAttribute('role', 'status');
    host.insertBefore(hint, host.firstChild);
  }
  const online = siblingOnline(behind.deviceId);
  hint.textContent = online
    ? t(`در حال همگام‌سازی ${behind.conversations} گفتگو از دستگاه دیگر شما (${behind.device})…`,
      `Syncing ${behind.conversations} conversation(s) from your other device (${behind.device})…`)
    : t(`${behind.conversations} گفتگو روی دستگاه دیگر شما (${behind.device}) جدیدتر است؛ به‌محض آنلاین شدن هر دو، همگام می‌شود.`,
      `${behind.conversations} conversation(s) are newer on your other device (${behind.device}); they sync as soon as both are online.`);
}

function siblingOnline(deviceId) {
  return (chatState.linkedDevices || []).some((device) => device.deviceId === deviceId)
    || Boolean(chatState.remoteSiblings?.has?.(deviceId));
}

/* ---- delta sync ---------------------------------------------------------- */

let lastDeltaRequestAt = 0;
let deferredDeltaTimer = null;

/* Asks every sibling that is online for what this device is missing: the
   cursors go inside the sealed bundle, so the relay carrying it sees nothing
   of them. A request that falls inside the rate limit is not dropped — it is
   made when the window ends, so a device that came back moments after its
   last request still asks. */
function requestDeltaFromSiblings({ reason = '', force = false } = {}) {
  const wait = SIBLING_SYNC_MIN_INTERVAL_MS - (Date.now() - lastDeltaRequestAt);
  if (!force && wait > 0) {
    if (!deferredDeltaTimer) {
      deferredDeltaTimer = window.setTimeout(() => {
        deferredDeltaTimer = null;
        requestDeltaFromSiblings({ reason, force: true });
      }, wait + 50);
    }
    return false;
  }
  if (deferredDeltaTimer) { window.clearTimeout(deferredDeltaTimer); deferredDeltaTimer = null; }
  lastDeltaRequestAt = Date.now();
  const cursors = {};
  for (const cursor of localSyncCursors()) cursors[cursor.key] = cursor.at;
  const newestCall = (chatState.calls || []).reduce((latest, call) => Math.max(latest, Date.parse(call?.createdAt || 0) || 0), 0);
  sendDeviceBundles([{ syncRequest: { fromDeviceId: getDeviceId(), cursors, callsAt: newestCall, reason } }]);
  return true;
}

const deltaServedAt = new Map();

/* A sibling asked. Only what is newer than its cursors goes back — a margin of
   a minute either side, because clocks differ — plus the address book and the
   prekeys, which are small and must match on every device. */
async function serveDeltaRequest(request) {
  const requester = String(request?.fromDeviceId || '');
  if (!requester || requester === getDeviceId()) return;
  const last = deltaServedAt.get(requester) || 0;
  if (Date.now() - last < SIBLING_SYNC_MIN_INTERVAL_MS / 2) return;
  deltaServedAt.set(requester, Date.now());
  const cursors = request.cursors && typeof request.cursors === 'object' ? request.cursors : {};
  const includeFiles = typeof deviceSyncFilesEnabled === 'function' && deviceSyncFilesEnabled();
  const bundles = [];
  /* What this account deleted lately goes first: a sibling that was away
     deletes it too before it hears anything else. */
  const deletions = typeof recentDeletions === 'function' ? recentDeletions() : [];
  if (deletions.length) bundles.push({ deletions, toDeviceId: requester });
  for (const [key, entries] of Object.entries(chatState.history || {})) {
    if (!key || key === 'system' || !Array.isArray(entries) || !entries.length) continue;
    const cursor = Number(cursors[key] || 0);
    const fresh = entries.filter((entry) => (Date.parse(entry?.createdAt || 0) || 0) > cursor - 60000);
    if (!fresh.length) continue;
    let wire = [];
    let inlineBytes = 0;
    for (const entry of fresh) {
      const wireEntry = await deviceSyncEntryForWire(entry, includeFiles);
      wire.push(wireEntry);
      inlineBytes += (wireEntry.mediaData || '').length;
      if (wire.length >= DEVICE_SYNC_BATCH_ENTRIES || inlineBytes >= DEVICE_SYNC_BATCH_INLINE_BUDGET) {
        bundles.push({ conversation: key, entries: wire, toDeviceId: requester });
        wire = [];
        inlineBytes = 0;
      }
    }
    if (wire.length) bundles.push({ conversation: key, entries: wire, toDeviceId: requester });
  }
  const callsAt = Number(request.callsAt || 0);
  const calls = (chatState.calls || []).filter((call) => (Date.parse(call?.createdAt || 0) || 0) > callsAt - 60000).map((call) => ({ ...call }));
  if (calls.length) bundles.push({ calls, toDeviceId: requester });
  const contactBundle = typeof buildContactSyncBundle === 'function' ? buildContactSyncBundle() : null;
  if (contactBundle) bundles.push({ ...contactBundle, toDeviceId: requester });
  const prekeys = prunePrekeys(loadPrekeys() || []);
  if (prekeys.length) bundles.push({ prekeys: prekeys.map((entry) => ({ ...entry })), toDeviceId: requester });
  bundles.push({ syncDone: { forDeviceId: requester, at: Date.now() } });
  await sendDeviceBundles(bundles);
}

/* ---- live mirror --------------------------------------------------------- */

/* A message this device sends appears on the account's other online devices
   at once, not at the next sync. Batched briefly so a burst is one envelope. */
const mirrorQueue = new Map();
let mirrorTimer = null;
function mirrorToSiblings(conversationKey, entry) {
  if (!conversationKey || !entry?.id || entry.direction !== 'out') return;
  if ((chatState.linkedDevices || []).length < 2 && !chatState.remoteSiblings?.size) return;
  const list = mirrorQueue.get(conversationKey) || [];
  list.push(entry);
  mirrorQueue.set(conversationKey, list);
  if (mirrorTimer) return;
  mirrorTimer = window.setTimeout(async () => {
    mirrorTimer = null;
    const bundles = [];
    for (const [key, entries] of mirrorQueue) {
      const wire = [];
      for (const item of entries) wire.push(await deviceSyncEntryForWire(item, false));
      bundles.push({ conversation: key, entries: wire, mirror: true });
    }
    mirrorQueue.clear();
    sendDeviceBundles(bundles).catch(() => {});
  }, MIRROR_BATCH_DELAY_MS);
}

/* ---- delivery to siblings, wherever they live ---------------------------- */

/* Sealed exactly like every device-sync envelope (to the account's own key,
   signed by it) and sent to this account's fingerprint: the relay delivers it
   live to every device holding the key and stores none of it. A sibling that
   lives on ANOTHER relay is reached over transit, using the home relay its
   beacon names. */
async function sendDeviceBundles(bundles) {
  if (!Array.isArray(bundles) || !bundles.length) return false;
  if (!chatState.connected || !chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return false;
  const mine = chatState.identity?.fingerprint;
  if (!mine) return false;
  const myRelay = relayPinFor(chatServerOrigin())?.id || '';
  const farRelays = new Map();
  for (const beacon of siblingBeacons.values()) {
    const home = normalizeHomeRelay(beacon?.r, 'session');
    if (home?.id && home.key && home.id !== myRelay) farRelays.set(home.id, home);
  }
  for (const bundle of bundles) {
    const envelope = await sealDeviceSyncBundle(bundle);
    sendRelayEnvelope({ fingerprint: mine }, envelope);
    for (const home of farRelays.values()) {
      sendViaTransit({ type: 'relay', toClientId: '', toFingerprint: mine, payload: envelope, persist: false }, home, null);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  return true;
}

/* Siblings on another relay are not in this relay's presence table. Their
   relay is asked about this account's own fingerprint — the same one-question
   presence probe any contact gets — and a yes means at least one sibling is
   there. */
async function probeRemoteSiblings() {
  chatState.remoteSiblings = chatState.remoteSiblings || new Set();
  const mine = chatState.identity?.fingerprint;
  const myRelay = relayPinFor(chatServerOrigin())?.id || '';
  if (!mine) return;
  for (const [deviceId, beacon] of siblingBeacons) {
    const home = normalizeHomeRelay(beacon?.r, 'session');
    if (!home?.id || !home.key || home.id === myRelay) continue;
    const tag = transitQueryTag('presence');
    const answer = awaitTransitAnswer(tag, 8000);
    sendViaTransit({ type: 'presence-query', toFingerprint: mine, tag }, home, null);
    const reply = await answer;
    const wasThere = chatState.remoteSiblings.has(deviceId);
    if (reply?.type === 'presence' && reply.up) chatState.remoteSiblings.add(deviceId);
    else chatState.remoteSiblings.delete(deviceId);
    if (!wasThere && chatState.remoteSiblings.has(deviceId)) requestDeltaFromSiblings({ reason: 'sibling on another relay', force: true });
  }
  renderDeviceSyncHint();
}

/* Called when the relay connection is up and this device's identity proven. */
let deviceBeaconTimer = null;
function startDeviceBeacon() {
  requestBeacons();
  scheduleBeaconWrite(3000);
  if (deviceBeaconTimer) return;
  deviceBeaconTimer = window.setInterval(() => {
    if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return;
    if (siblingBeacons.size) probeRemoteSiblings().catch(() => {});
  }, 60000);
}

window.requestDeltaFromSiblings = requestDeltaFromSiblings;
