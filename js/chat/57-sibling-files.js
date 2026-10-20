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
   Files between the account's own devices — device to device.
   ============================================================================

   A message that reached one device of an account reaches the others as a
   row (44-device-beacon.js); its file stays where it landed until another
   device wants it. Then that device asks a sibling that is online for it,
   and the bytes go straight from one device to the other over a WebRTC data
   channel — encrypted by the channel itself (DTLS), and never through the
   relay. The relay only introduces the two devices to each other, as it does
   for a call; the file is not on it, not even in passing.

   Before a byte moves, each device proves it holds the account's private key
   (a signature over a fresh challenge, checked against the account's own
   public key): nobody who merely knows a peer id gets a file, and nobody can
   pretend to be the sibling and hand over something else.

   The file comes in 64 KB pieces, as fast as the channel takes them and no
   faster (the sender waits while the channel's buffer is full, so a large
   file never sits in memory twice), and a channel that drops mid-way picks up
   where it stopped. It is checked for its full size, then kept in this
   device's encrypted media store like any file that arrived here; one larger
   than that store holds is offered to be saved on the device instead.

   Whether a device hands its files to a sibling at all is the setting "Move
   files between devices" on the device that has them.

   A sibling still on an older build does not answer here; for one of those,
   a small file (within what the old way could carry) is fetched the old way,
   through the relay's live sync envelopes, kept by nobody.
   ============================================================================ */

const SIBLING_FILE_CHUNK = 64 * 1024;
const SIBLING_FILE_BUFFER_HIGH = 4 * 1024 * 1024;
const SIBLING_FILE_CONNECT_MS = 15000;
const SIBLING_FILE_IDLE_MS = 30000;
const SIBLING_FILE_LEGACY_MAX = 256 * 64 * 1024;
const siblingFilePulls = new Map();

function siblingDevicesOnline() {
  const mine = typeof getDeviceId === 'function' ? getDeviceId() : '';
  return (chatState.linkedDevices || []).filter((device) => device.peerId && device.deviceId !== mine && device.peerId !== chatState.peerId);
}

/* The proof: a signature, with the account's private key, over what this
   exchange is (`purpose`), a fresh challenge, and the peer it is meant for —
   so a proof made for one device or one step is worth nothing for another. */
function siblingProofBytes(purpose, nonce, toPeerId) {
  return new TextEncoder().encode(['poorija-sibling-file', purpose, nonce, toPeerId, chatState.identity?.fingerprint || ''].join('|'));
}
async function siblingProof(purpose, nonce, toPeerId) {
  const key = await importIdentitySigningKey();
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, siblingProofBytes(purpose, nonce, toPeerId));
  return app().arrayBufferToBase64(signature);
}
async function siblingProofValid(purpose, nonce, toPeerId, signature) {
  try {
    if (!signature || !nonce) return false;
    return await verifyIdentitySignature(chatState.identity.publicKeyData, app().base64ToArrayBuffer(signature), siblingProofBytes(purpose, nonce, toPeerId));
  } catch (_error) {
    return false;
  }
}
function siblingNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/* ---- the device that has the file ---------------------------------------- */

/* A sibling's channel (peer.on('connection') hands it here when it says what
   it is for). Nothing is answered until it has proved it is this account. */
function serveSiblingFileConnection(connection) {
  let proven = false;
  const send = (object) => { try { connection.send(JSON.stringify(object)); } catch (_error) { /* closed */ } };
  const closeSoon = () => window.setTimeout(() => { try { connection.close(); } catch (_error) { /* gone */ } }, 200);
  const giveUp = window.setTimeout(() => { if (!proven) closeSoon(); }, SIBLING_FILE_CONNECT_MS);
  connection.on('data', async (data) => {
    if (typeof data !== 'string') return;
    let message;
    try { message = JSON.parse(data); } catch (_error) { return; }
    if (message?.t === 'hello') {
      if (!await siblingProofValid('pull', String(message.nonce || ''), chatState.peerId, message.sig)) {
        send({ t: 'error', reason: 'not-a-sibling' });
        closeSoon();
        return;
      }
      proven = true;
      window.clearTimeout(giveUp);
      send({ t: 'hello-ok', sig: await siblingProof('serve', String(message.nonce), String(connection.peer || '')) });
      return;
    }
    if (message?.t === 'get' && proven) {
      await serveSiblingFile(connection, String(message.messageId || ''), Math.max(0, Number(message.offset) || 0)).catch((error) => {
        console.warn('[Devices] a file for a sibling could not be sent:', error?.message || error);
        send({ t: 'error', reason: 'failed' });
      });
    }
  });
}

/* Waits while the channel holds more than it can pass on: PeerJS would
   otherwise keep everything not yet sent in memory. */
async function siblingChannelRoom(connection) {
  const channel = connection.dataChannel;
  for (let waited = 0; connection.open && waited < SIBLING_FILE_IDLE_MS; waited += 25) {
    const queued = (channel?.bufferedAmount || 0) + (connection.bufferSize || 0) * SIBLING_FILE_CHUNK;
    if (queued < SIBLING_FILE_BUFFER_HIGH) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
  return connection.open;
}

async function serveSiblingFile(connection, messageId, offset) {
  const send = (object) => connection.send(JSON.stringify(object));
  if (!deviceSyncFilesEnabled()) { send({ t: 'error', reason: 'files-off' }); return; }
  const stored = messageId ? await readMessageMedia(messageId).catch(() => null) : null;
  const sessionUrl = !stored && chatState.mediaUrls?.get(messageId);
  const blob = stored?.blob || (sessionUrl ? await (await fetch(sessionUrl)).blob().catch(() => null) : null);
  if (!blob) { send({ t: 'error', reason: 'not-here' }); return; }
  const record = stored?.record || {};
  send({ t: 'meta', size: blob.size, name: record.name || '', mime: blob.type || record.mime || '', kind: record.kind || '', offset });
  for (let start = Math.min(offset, blob.size); start < blob.size; start += SIBLING_FILE_CHUNK) {
    if (!await siblingChannelRoom(connection)) return;
    connection.send(await blob.slice(start, start + SIBLING_FILE_CHUNK).arrayBuffer());
  }
  if (await siblingChannelRoom(connection)) send({ t: 'end', size: blob.size });
}

/* ---- the device that wants it -------------------------------------------- */

function siblingPullLabel(messageId, text) {
  document.querySelectorAll(`[data-chat-device-file="${CSS.escape(messageId)}"]`).forEach((button) => {
    button.textContent = text;
    button.disabled = Boolean(siblingFilePulls.get(messageId));
  });
}
function siblingPullProgress(state) {
  if (!state.size) return;
  const percent = Math.floor((state.received / state.size) * 100);
  if (percent === state.shownPercent) return;
  state.shownPercent = percent;
  siblingPullLabel(state.messageId, t(`در حال دریافت از دستگاه دیگر… ${percent}٪`, `Fetching from your other device… ${percent}%`));
}

/* One sibling, one attempt (resumed once if the channel drops part-way).
   Resolves 'done', 'refused' (it answered and does not have it or will not
   give it) or 'unreachable' (no channel, or not a sibling that speaks this). */
function pullFromSibling(peerId, state) {
  return new Promise((resolve) => {
    let settled = false;
    let connection = null;
    let idle = 0;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(idle);
      try { connection?.close(); } catch (_error) { /* gone */ }
      resolve(outcome);
    };
    const touch = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(() => finish(state.received ? 'dropped' : 'unreachable'), state.verified ? SIBLING_FILE_IDLE_MS : SIBLING_FILE_CONNECT_MS);
    };
    try {
      connection = chatState.peer.connect(peerId, {
        reliable: true,
        serialization: 'raw',
        metadata: { purpose: 'sibling-file', fingerprint: chatState.identity?.fingerprint || '' },
      });
    } catch (_error) {
      finish('unreachable');
      return;
    }
    touch();
    const nonce = siblingNonce();
    connection.on('open', async () => {
      touch();
      connection.send(JSON.stringify({ t: 'hello', nonce, sig: await siblingProof('pull', nonce, peerId) }));
    });
    connection.on('error', () => finish(state.received ? 'dropped' : 'unreachable'));
    connection.on('close', () => finish(state.done ? 'done' : (state.received ? 'dropped' : 'unreachable')));
    connection.on('data', async (data) => {
      touch();
      if (typeof data !== 'string') {
        if (!state.meta) return;
        const piece = data instanceof ArrayBuffer ? data : (data?.buffer instanceof ArrayBuffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null);
        if (!piece) return;
        state.chunks.push(piece);
        state.received += piece.byteLength;
        siblingPullProgress(state);
        return;
      }
      let message;
      try { message = JSON.parse(data); } catch (_error) { return; }
      if (message.t === 'hello-ok') {
        if (!await siblingProofValid('serve', nonce, chatState.peerId, message.sig)) { finish('unreachable'); return; }
        state.verified = true;
        connection.send(JSON.stringify({ t: 'get', messageId: state.messageId, offset: state.received }));
        return;
      }
      if (message.t === 'meta') {
        const size = Number(message.size) || 0;
        if (state.meta && state.size !== size) { state.chunks = []; state.received = 0; }
        state.meta = { name: String(message.name || ''), mime: String(message.mime || ''), kind: String(message.kind || '') };
        state.size = size;
        siblingPullProgress(state);
        return;
      }
      if (message.t === 'end') {
        state.done = state.received === state.size;
        finish(state.done ? 'done' : 'dropped');
        return;
      }
      if (message.t === 'error') finish('refused');
    });
  });
}

async function keepSiblingFile(state) {
  const blob = new Blob(state.chunks, { type: state.meta?.mime || 'application/octet-stream' });
  state.chunks = [];
  const conversationKey = state.conversationKey
    || Object.keys(chatState.history).find((key) => (chatState.history[key] || []).some((item) => item.id === state.messageId)) || '';
  const entry = (chatState.history[conversationKey] || []).find((item) => item.id === state.messageId);
  const kept = await persistMessageMedia(conversationKey, entry || {
    id: state.messageId,
    type: state.meta?.kind || 'file',
    name: state.meta?.name || '',
    mime: state.meta?.mime || '',
    createdAt: new Date().toISOString(),
  }, blob);
  const url = URL.createObjectURL(blob);
  chatState.mediaUrls.set(state.messageId, url);
  if (entry) {
    entry.downloadUrl = url;
    entry.mediaMissing = false;
    storeHistory();
  }
  renderMessages();
  const name = state.meta?.name || entry?.name || t('فایل', 'file');
  if (kept) {
    notify(t(`«${name}» از دستگاه دیگر شما رسید و روی این دستگاه ذخیره شد.`, `"${name}" arrived from your other device and is kept on this one.`), 'success');
  } else if (typeof saveFilesToDevice === 'function') {
    /* Larger than the in-app store keeps: saved to the device itself. */
    notify(t(`«${name}» از دستگاه دیگر رسید؛ بزرگ‌تر از فضای داخلی برنامه است، روی دستگاه ذخیره می‌شود.`, `"${name}" arrived from your other device; it is larger than the app's own store, so it is saved to this device.`), 'info');
    saveFilesToDevice([new File([blob], name, { type: blob.type })]).catch(() => {});
  }
}

/* The button on a row whose file is on another device of this account. */
async function fetchFromSibling(conversationKey, messageId) {
  if (!messageId || siblingFilePulls.has(messageId)) return;
  const siblings = siblingDevicesOnline();
  const peerReady = chatState.peer && !chatState.peer.destroyed && chatState.peer.open;
  const state = { messageId, conversationKey, chunks: [], received: 0, size: 0, meta: null, verified: false, done: false, shownPercent: -1 };
  if (!siblings.length || !peerReady) {
    notify(t('هیچ دستگاه دیگری از این حساب الان آنلاین نیست؛ وقتی آنلاین شد دوباره بزنید.', 'No other device of this account is online right now; try again when one is.'), 'warning');
    return;
  }
  siblingFilePulls.set(messageId, state);
  siblingPullLabel(messageId, t('در حال اتصال به دستگاه دیگر…', 'Reaching your other device…'));
  let outcome = 'unreachable';
  try {
    for (const sibling of siblings) {
      outcome = await pullFromSibling(sibling.peerId, state);
      /* Dropped part-way: once more from where it stopped. */
      if (outcome === 'dropped') outcome = await pullFromSibling(sibling.peerId, state);
      if (outcome === 'done') break;
      if (outcome !== 'unreachable') { state.chunks = []; state.received = 0; state.meta = null; state.size = 0; }
    }
    if (outcome === 'done') {
      await keepSiblingFile(state);
      return;
    }
  } finally {
    siblingFilePulls.delete(messageId);
  }
  const entry = (chatState.history[conversationKey] || []).find((item) => item.id === messageId);
  if (outcome === 'unreachable' && typeof requestDeviceFile === 'function' && entry && Number(entry.size || 0) <= SIBLING_FILE_LEGACY_MAX) {
    requestDeviceFile(conversationKey, messageId);
    return;
  }
  renderMessages();
  notify(outcome === 'refused'
    ? t('دستگاه دیگر این فایل را ندارد یا «جابه‌جایی فایل بین دستگاه‌ها» روی آن خاموش است.', 'Your other device does not have this file, or "Move files between devices" is off on it.')
    : t('به دستگاه دیگر مستقیم وصل نشدیم؛ هر دو آنلاین باشند و دوباره امتحان کنید.', 'Could not reach your other device directly; with both online, try again.'), 'warning');
}

window.__siblingFileProbe = {
  pulls: () => [...siblingFilePulls.keys()],
  online: () => siblingDevicesOnline().map((device) => device.deviceId),
};
