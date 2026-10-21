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

   And the channel's own encryption is not relied on alone: the relay that
   introduces the two devices could, in principle, put itself between them
   and terminate that encryption on each side. So the asking device makes a
   fresh AES-GCM key for this one transfer, seals it to the account's public
   key (only a device of this account can open it) and signs it with the
   challenge; every piece of the file, and what it is called and how big it
   is, travels encrypted with that key. Whatever sits in the middle sees
   ciphertext, and cannot swap the key without breaking the signature.

   The file comes in 64 KB pieces, as fast as the channel takes them and no
   faster (the sender waits while the channel's buffer is full, so a large
   file never sits in memory twice), and a channel that drops mid-way picks up
   where it stopped. It is checked for its full size, then kept in this
   device's encrypted media store like any file that arrived here; one larger
   than that store holds is offered to be saved on the device instead.

   Whether a device hands its files to a sibling at all is the setting "Move
   files between devices" on the device that has them — or "Sync all
   content", the account's choice, under which every file, photo, video,
   voice note, sticker and GIF a device lacks comes over by itself whenever a
   sibling that has it is online (runSiblingAutoPull, below).

   Once the account's primary has revoked a device, a sibling also asks the
   device asking for a file to prove which device it is, with its own key
   (58-device-roster.js), and a revoked one gets nothing.

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
  return (chatState.linkedDevices || []).filter((device) => device.peerId && device.deviceId !== mine && device.peerId !== chatState.peerId
    && !(typeof deviceRevoked === 'function' && deviceRevoked(device.deviceId)));
}
/* Which device is asking, signed with its own key over this exchange. */
function siblingDeviceProofText(challenge, toPeerId) {
  return `poorija-sibling-device|${challenge}|${toPeerId}`;
}
async function siblingDeviceProof(challenge, toPeerId) {
  if (typeof ensureDeviceKey !== 'function') return null;
  const key = await ensureDeviceKey().catch(() => null);
  if (!key) return null;
  return { d: getDeviceId(), k: key.publicKeyData, s: await deviceSign(siblingDeviceProofText(challenge, toPeerId)) };
}
/* Nothing to prove while the account has revoked nobody (an older sibling
   sends no proof at all); after that, a proof from a device still in it. */
async function siblingDeviceAcceptable(proof, challenge) {
  if (typeof rosterHasRevocations !== 'function' || !rosterHasRevocations()) return true;
  if (!proof?.d || !proof?.k || deviceRevoked(proof.d, proof.k)) return false;
  const listed = currentRoster()?.members.find((member) => member.d === proof.d);
  if (listed && listed.k !== proof.k) return false;
  return deviceVerify(proof.k, siblingDeviceProofText(challenge, chatState.peerId), proof.s);
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
/* The transfer key, as the asking device makes and seals it. */
async function siblingTransferKey() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const publicKey = await importIdentityPublicKey(chatState.identity.publicKeyData);
  const sealed = app().arrayBufferToBase64(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, raw));
  return { key, sealed };
}
async function siblingSealDigest(sealed) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(sealed || '')));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
/* A piece's IV is its index under a per-transfer prefix: the same piece is
   always the same plaintext, so a resumed transfer re-encrypting it repeats
   nothing that matters, and no two different pieces ever share one. */
function siblingPieceIv(prefix, index) {
  const iv = new Uint8Array(12);
  iv.set(prefix.subarray(0, 4), 0);
  new DataView(iv.buffer).setBigUint64(4, BigInt(index));
  return iv;
}
async function siblingBox(key, object) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(object)));
  return { iv: bytesToBase64(iv), c: app().arrayBufferToBase64(cipher) };
}
async function siblingUnbox(key, box) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(box.iv) }, key, app().base64ToArrayBuffer(box.c));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ---- the device that has the file ---------------------------------------- */

/* A sibling's channel (peer.on('connection') hands it here when it says what
   it is for). Nothing is answered until it has proved it is this account. */
function serveSiblingFileConnection(connection) {
  let proven = false;
  let transferKey = null;
  const send = (object) => { try { connection.send(JSON.stringify(object)); } catch (_error) { /* closed */ } };
  const closeSoon = () => window.setTimeout(() => { try { connection.close(); } catch (_error) { /* gone */ } }, 200);
  const giveUp = window.setTimeout(() => { if (!proven) closeSoon(); }, SIBLING_FILE_CONNECT_MS);
  connection.on('data', async (data) => {
    if (typeof data !== 'string') return;
    let message;
    try { message = JSON.parse(data); } catch (_error) { return; }
    if (message?.t === 'hello') {
      const challenge = `${String(message.nonce || '')}|${await siblingSealDigest(message.key)}`;
      if (!message.key || !await siblingProofValid('pull', challenge, chatState.peerId, message.sig)
        || !await siblingDeviceAcceptable(message.dev, challenge)) {
        send({ t: 'error', reason: 'not-a-sibling' });
        closeSoon();
        return;
      }
      try {
        transferKey = await openOfflineSeal(message.key);
      } catch (_error) {
        transferKey = null;
      }
      if (!transferKey) { send({ t: 'error', reason: 'not-a-sibling' }); closeSoon(); return; }
      proven = true;
      window.clearTimeout(giveUp);
      send({ t: 'hello-ok', sig: await siblingProof('serve', String(message.nonce), String(connection.peer || '')) });
      return;
    }
    if (message?.t === 'get' && proven) {
      await serveSiblingFile(connection, transferKey, String(message.messageId || ''), Math.max(0, Number(message.offset) || 0)).catch((error) => {
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

async function serveSiblingFile(connection, key, messageId, offset) {
  const send = (object) => connection.send(JSON.stringify(object));
  if (!deviceSyncFilesEnabled() && !deviceSyncAllEnabled()) { send({ t: 'error', reason: 'files-off' }); return; }
  const stored = messageId ? await readMessageMedia(messageId).catch(() => null) : null;
  const sessionUrl = !stored && chatState.mediaUrls?.get(messageId);
  const blob = stored?.blob || (sessionUrl ? await (await fetch(sessionUrl)).blob().catch(() => null) : null);
  if (!blob) { send({ t: 'error', reason: 'not-here' }); return; }
  const record = stored?.record || {};
  const prefix = crypto.getRandomValues(new Uint8Array(4));
  send({ t: 'meta', box: await siblingBox(key, { size: blob.size, name: record.name || '', mime: blob.type || record.mime || '', kind: record.kind || '', prefix: bytesToBase64(prefix) }) });
  for (let start = Math.floor(Math.min(offset, blob.size) / SIBLING_FILE_CHUNK) * SIBLING_FILE_CHUNK; start < blob.size; start += SIBLING_FILE_CHUNK) {
    if (!await siblingChannelRoom(connection)) return;
    const plain = await blob.slice(start, start + SIBLING_FILE_CHUNK).arrayBuffer();
    connection.send(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: siblingPieceIv(prefix, start / SIBLING_FILE_CHUNK) }, key, plain));
  }
  if (await siblingChannelRoom(connection)) send({ t: 'end' });
}

/* ---- the device that wants it -------------------------------------------- */

function siblingPullLabel(messageId, text) {
  document.querySelectorAll(`[data-chat-device-file="${CSS.escape(messageId)}"]`).forEach((button) => {
    (button.querySelector('span') || button).textContent = text;
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
    let transfer = null;
    let prefix = null;
    let nextIndex = 0;
    /* Pieces decrypt in order: each waits for the one before it. */
    let opened = Promise.resolve();
    connection.on('open', async () => {
      touch();
      transfer = await siblingTransferKey();
      const challenge = `${nonce}|${await siblingSealDigest(transfer.sealed)}`;
      connection.send(JSON.stringify({
        t: 'hello', nonce, key: transfer.sealed, sig: await siblingProof('pull', challenge, peerId),
        dev: await siblingDeviceProof(challenge, peerId),
      }));
    });
    connection.on('error', () => finish(state.received ? 'dropped' : 'unreachable'));
    connection.on('close', () => finish(state.done ? 'done' : (state.received ? 'dropped' : 'unreachable')));
    connection.on('data', async (data) => {
      touch();
      if (typeof data !== 'string') {
        if (!state.meta || !prefix) return;
        const piece = data instanceof ArrayBuffer ? data : (data?.buffer instanceof ArrayBuffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null);
        if (!piece) return;
        const index = nextIndex;
        nextIndex += 1;
        opened = opened.then(async () => {
          if (settled) return;
          try {
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: siblingPieceIv(prefix, index) }, transfer.key, piece);
            state.chunks.push(plain);
            state.received += plain.byteLength;
            siblingPullProgress(state);
          } catch (_error) {
            /* Not what this transfer's key made: something in between. */
            state.chunks = [];
            state.received = 0;
            finish('unreachable');
          }
        });
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
        let meta;
        try { meta = await siblingUnbox(transfer.key, message.box); } catch (_error) { finish('unreachable'); return; }
        const size = Number(meta.size) || 0;
        if (state.meta && state.size !== size) { state.chunks = []; state.received = 0; }
        /* Resumed: the sender starts again at the piece boundary below what
           arrived, so what is already here is trimmed to that boundary. */
        const resumeAt = Math.floor(state.received / SIBLING_FILE_CHUNK) * SIBLING_FILE_CHUNK;
        while (state.received > resumeAt && state.chunks.length) state.received -= state.chunks.pop().byteLength;
        nextIndex = resumeAt / SIBLING_FILE_CHUNK;
        prefix = base64ToBytes(String(meta.prefix || ''));
        state.meta = { name: String(meta.name || ''), mime: String(meta.mime || ''), kind: String(meta.kind || '') };
        state.size = size;
        siblingPullProgress(state);
        return;
      }
      if (message.t === 'end') {
        await opened;
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
  if (state.quiet && kept) return;
  if (kept) {
    notify(t(`«${name}» از دستگاه دیگر شما رسید و روی این دستگاه ذخیره شد.`, `"${name}" arrived from your other device and is kept on this one.`), 'success');
  } else if (typeof saveFilesToDevice === 'function') {
    /* Larger than the in-app store keeps: saved to the device itself. */
    notify(t(`«${name}» از دستگاه دیگر رسید؛ بزرگ‌تر از فضای داخلی برنامه است، روی دستگاه ذخیره می‌شود.`, `"${name}" arrived from your other device; it is larger than the app's own store, so it is saved to this device.`), 'info');
    saveFilesToDevice([new File([blob], name, { type: blob.type })]).catch(() => {});
  }
}

/* The button on a row whose file is on another device of this account —
   and, `quiet`, the automatic pass, which neither toasts nor falls back to
   the relay. Resolves what happened: 'done', 'refused' or 'unreachable'. */
async function fetchFromSibling(conversationKey, messageId, { quiet = false } = {}) {
  if (!messageId || siblingFilePulls.has(messageId)) return 'busy';
  const siblings = siblingDevicesOnline();
  const peerReady = chatState.peer && !chatState.peer.destroyed && chatState.peer.open;
  const state = { messageId, conversationKey, chunks: [], received: 0, size: 0, meta: null, verified: false, done: false, shownPercent: -1, quiet };
  if (!siblings.length || !peerReady) {
    if (!quiet) notify(t('هیچ دستگاه دیگری از این حساب الان آنلاین نیست؛ وقتی آنلاین شد دوباره بزنید.', 'No other device of this account is online right now; try again when one is.'), 'warning');
    return 'unreachable';
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
      return 'done';
    }
  } finally {
    siblingFilePulls.delete(messageId);
  }
  renderMessages();
  if (quiet) return outcome === 'refused' ? 'refused' : 'unreachable';
  const entry = (chatState.history[conversationKey] || []).find((item) => item.id === messageId);
  if (outcome === 'unreachable' && typeof requestDeviceFile === 'function' && entry && Number(entry.size || 0) <= SIBLING_FILE_LEGACY_MAX) {
    requestDeviceFile(conversationKey, messageId);
    return 'legacy';
  }
  notify(outcome === 'refused'
    ? t('دستگاه دیگر این فایل را ندارد یا «جابه‌جایی فایل بین دستگاه‌ها» روی آن خاموش است.', 'Your other device does not have this file, or "Move files between devices" is off on it.')
    : t('به دستگاه دیگر مستقیم وصل نشدیم؛ هر دو آنلاین باشند و دوباره امتحان کنید.', 'Could not reach your other device directly; with both online, try again.'), 'warning');
  return outcome === 'refused' ? 'refused' : 'unreachable';
}

/* ---- everything, by itself ------------------------------------------------- */

/* "Sync all content" is the account's choice, not one device's: switched on
   or off on any device, it is carried to the others (sealed, like any sync
   bundle), and the newest word wins. */
const SIBLING_AUTO_MAX_TRIES = 3;
const SIBLING_AUTO_BUDGET_SHARE = 0.85;
const siblingAuto = { timer: 0, running: false, again: false, tries: new Map(), done: 0, left: 0, full: false };

function deviceSyncAllSetting() {
  try {
    const stored = JSON.parse(localStorage.getItem(CHAT_DEVICE_SYNC_ALL_STORAGE_KEY) || 'null');
    return stored && typeof stored === 'object' ? { on: Boolean(stored.on), at: Number(stored.at) || 0 } : { on: false, at: 0 };
  } catch (_error) {
    return { on: false, at: 0 };
  }
}
function deviceSyncAllEnabled() {
  return deviceSyncAllSetting().on;
}
function storeDeviceSyncAll(on, at) {
  try { localStorage.setItem(CHAT_DEVICE_SYNC_ALL_STORAGE_KEY, JSON.stringify({ on: Boolean(on), at })); } catch (_error) { /* private mode */ }
}
function setDeviceSyncAllEnabled(on) {
  const at = Date.now();
  storeDeviceSyncAll(on, at);
  if (typeof sendDeviceBundles === 'function') sendDeviceBundles([{ deviceSettings: { syncAll: Boolean(on), at } }], { hold: true }).catch(() => false);
  if (on) {
    siblingAuto.tries.clear();
    siblingAuto.full = false;
    scheduleSiblingAutoPull(400);
  }
  if (typeof renderAccountDeviceViews === 'function') renderAccountDeviceViews();
}
function applySiblingDeviceSettings(settings) {
  if (!settings || typeof settings.syncAll !== 'boolean') return;
  const at = Number(settings.at) || 0;
  if (at <= deviceSyncAllSetting().at) return;
  storeDeviceSyncAll(settings.syncAll, at);
  if (settings.syncAll) scheduleSiblingAutoPull(1500);
  if (typeof renderAccountDeviceViews === 'function') renderAccountDeviceViews();
}

function scheduleSiblingAutoPull(delay = 3000) {
  if (siblingAuto.timer || !deviceSyncAllEnabled()) return;
  siblingAuto.timer = window.setTimeout(() => {
    siblingAuto.timer = 0;
    runSiblingAutoPull().catch((error) => console.warn('[Devices] the automatic file sync stopped:', error?.message || error));
  }, delay);
}

/* Every row whose file is not on this device, newest first. Not a message
   meant to disappear (that is opened by hand or not at all), and not one
   larger than the in-app store keeps (still one tap away). */
async function siblingAutoCandidates() {
  const stored = await mediaVaultIds().catch(() => new Set());
  const out = [];
  for (const [conversationKey, entries] of Object.entries(chatState.history || {})) {
    if (!conversationKey || conversationKey === 'system' || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry?.id || !isMediaEntry(entry)) continue;
      if (entry.downloadUrl || chatState.mediaUrls.has(entry.id) || stored.has(entry.id)) continue;
      if (entry.viewOnce || entry.expiresAt || Number(entry.timerSeconds || 0) > 0) continue;
      if (Number(entry.size || 0) > MEDIA_VAULT_MAX_FILE_BYTES) continue;
      if ((siblingAuto.tries.get(entry.id) || 0) >= SIBLING_AUTO_MAX_TRIES) continue;
      out.push({ conversationKey, entry });
    }
  }
  return out.sort((a, b) => (Date.parse(b.entry.createdAt || 0) || 0) - (Date.parse(a.entry.createdAt || 0) || 0));
}

/* One file at a time, device to device, while a sibling is here — and never
   so much that the store starts evicting what it already holds to make room. */
async function runSiblingAutoPull() {
  /* Asked again mid-pass — something new arrived: it is looked at the moment
     this pass ends, not dropped. */
  if (siblingAuto.running) { siblingAuto.again = true; return; }
  if (!deviceSyncAllEnabled()) return;
  if (!siblingDevicesOnline().length || !chatState.peer || chatState.peer.destroyed || !chatState.peer.open) return;
  siblingAuto.running = true;
  let failed = 0;
  try {
    const candidates = await siblingAutoCandidates();
    siblingAuto.left = candidates.length;
    let used = Number((await mediaStorageStats()).bytes || 0);
    for (const { conversationKey, entry } of candidates) {
      if (!deviceSyncAllEnabled() || !siblingDevicesOnline().length) break;
      const size = Number(entry.size || 0);
      if (used + size > MEDIA_BUDGET_BYTES * SIBLING_AUTO_BUDGET_SHARE) { siblingAuto.full = true; break; }
      siblingAuto.tries.set(entry.id, (siblingAuto.tries.get(entry.id) || 0) + 1);
      const outcome = entry.downloadUrl ? 'done' : await fetchFromSibling(conversationKey, entry.id, { quiet: true });
      siblingAuto.left = Math.max(0, siblingAuto.left - 1);
      if (outcome === 'done') {
        siblingAuto.done += 1;
        siblingAuto.tries.delete(entry.id);
        used += size;
      } else if (outcome !== 'busy') {
        failed += 1;
      }
      if (typeof renderAccountDeviceViews === 'function') renderAccountDeviceViews();
      /* A breath between two channels to the same device: the one just
         closed is let go before the next one opens. */
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  } finally {
    siblingAuto.running = false;
    if (typeof renderAccountDeviceViews === 'function') renderAccountDeviceViews();
  }
  if (siblingAuto.again) {
    siblingAuto.again = false;
    scheduleSiblingAutoPull(800);
    return;
  }
  /* What did not come is tried again a little later — soon the first time, a
     transient miss being the usual reason — and a few times at most. */
  if (failed && !siblingAuto.full) scheduleSiblingAutoPull(siblingAuto.retried ? 30000 : 5000);
  siblingAuto.retried = Boolean(failed);
}
function siblingAutoPullStatus() {
  if (!deviceSyncAllEnabled()) return '';
  if (siblingAuto.running && siblingAuto.left) return t(`در حال همگام‌سازی… ${siblingAuto.left} فایل مانده`, `Syncing… ${siblingAuto.left} file(s) left`);
  if (siblingAuto.full) return t('فضای داخلی برنامه نزدیک سقف است؛ بقیه با دکمهٔ «دریافت از دستگاه دیگر».', 'The in-app store is nearly full; the rest come with the "Fetch" button.');
  if (siblingAuto.done) return t(`${siblingAuto.done} فایل از دستگاه دیگر رسید.`, `${siblingAuto.done} file(s) arrived from your other device.`);
  return '';
}

window.__siblingFileProbe = {
  pulls: () => [...siblingFilePulls.keys()],
  online: () => siblingDevicesOnline().map((device) => device.deviceId),
  auto: () => ({ running: siblingAuto.running, done: siblingAuto.done, left: siblingAuto.left, full: siblingAuto.full, on: deviceSyncAllEnabled() }),
  runAuto: () => runSiblingAutoPull(),
};
