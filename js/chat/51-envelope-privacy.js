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
   What a relay — and anybody watching the wire — can still learn from a
   message it cannot read: who sent it, and how long it is.
   ============================================================================

   SEALED SENDER

   A queued envelope used to carry the sender's fingerprint and peer id, its
   signature, its inner type and its timestamp in the clear, and the relay
   filed every queued item under the proven sender as well. So a mailbox on
   disk — or seized, or subpoenaed — said who wrote to whom and when, and an
   envelope carried over the relay link told the far relay the same.

   Now those fields travel in a small box encrypted under the same key that
   opens the body, which only the recipient can recover (through their prekey
   or their identity key). The relay sees: a recipient, a seal, a box, a body,
   a retention class and whether to wake the device. It stores the item
   without a sender, and delivers it live without one. The signature inside
   the box now also covers the recipient, so an envelope one person received
   cannot be re-sealed to somebody else and pass as written to them.

   What it does not hide, said plainly: the relay still knows which socket
   handed it the frame, while it handed it over. Sealed sender removes the
   sender from what is kept and from what is passed on — not from the moment
   of sending. And it is only used toward a contact whose build reads it
   (the 'ss1' capability), so an older recipient never gets an envelope it
   cannot attribute.

   A sender who later needs to take back a queued envelope (a contact who
   turned out to live on another relay) can no longer be matched by name, so
   each sealed envelope carries the hash of a secret only the sender can
   derive for that message, and the take-back presents the secret.

   PADDING

   Ciphertext is as long as what it hides. A one-word reply, a long letter, a
   voice note's first chunk and a delivery receipt were all distinguishable
   by size alone. Sealed bodies are now padded to fixed sizes (512 B to
   64 KB, then 16 KB steps), and every small frame on a live channel gets a
   filler field that rounds it to the same ladder — so a relay, a TURN server
   or somebody on the path sees a handful of sizes instead of a length.
   ============================================================================ */

const LOCAL_CAPS = ['ss1', 'pad1'];
const PAD_LADDER = [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const PAD_STEP_ABOVE = 16384;
const LIVE_PAD_LIMIT = 16384;
const SEALED_SENDER_FIELDS = ['fromPeerId', 'fromFingerprint', 'sig', 'sigv', 'inner', 'createdAt', 'to'];

function padTargetFor(length) {
  for (const size of PAD_LADDER) if (length <= size) return size;
  return Math.ceil(length / PAD_STEP_ABOVE) * PAD_STEP_ABOVE;
}

/* JSON of `object` grown to exactly a ladder size with a filler field. The
   filler is plain ASCII, so characters and bytes agree and the length is
   exact; a reader ignores a field it does not know. */
function paddedJson(object) {
  const json = JSON.stringify(object);
  if (!json || json[0] !== '{') return json;
  const empty = json === '{}';
  const overhead = (empty ? 0 : 1) + '"pad":""'.length;
  const target = padTargetFor(json.length + overhead);
  const fill = Math.max(0, target - json.length - overhead);
  return `${json.slice(0, -1)}${empty ? '' : ','}"pad":"${'0'.repeat(fill)}"}`;
}

function frameHasBinary(payload) {
  for (const value of Object.values(payload)) {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob) return true;
  }
  return false;
}
/* A small frame on a live channel, rounded up the same ladder. Chunks of a
   file are already one size and are left alone, as is anything binary or
   already large. */
function padLiveFrame(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (payload.pad !== undefined || String(payload.type || '') === 'file-chunk') return payload;
  if (frameHasBinary(payload)) return payload;
  let length;
  try { length = JSON.stringify(payload).length; } catch (_error) { return payload; }
  if (length > LIVE_PAD_LIMIT) return payload;
  const overhead = ',"pad":""'.length;
  const fill = Math.max(0, padTargetFor(length + overhead) - length - overhead);
  return { ...payload, pad: '0'.repeat(fill) };
}

/* ---- capabilities ------------------------------------------------------------ */

function sanitizeCaps(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '')).filter((item) => /^[a-z0-9-]{1,16}$/.test(item)))).slice(0, 8);
}
function peerSupports(peerRecord, cap) {
  return Array.isArray(peerRecord?.caps) && peerRecord.caps.includes(cap);
}
/* Learnt from inside a sealed body, where the sender's own key vouched for
   it, and from presence. Only ever added to a record that already exists. */
function noteSenderCaps(fingerprint, caps) {
  const clean = sanitizeCaps(caps);
  if (!fingerprint || !clean.length) return;
  const record = (chatState.peers || []).find((peer) => peer.fingerprint === fingerprint);
  if (!record) return;
  const before = JSON.stringify(record.caps || []);
  record.caps = clean;
  if (before !== JSON.stringify(clean)) saveContacts();
}

/* ---- taking an envelope back ------------------------------------------------- */

async function envelopeSha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || '')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function withdrawSeed() {
  if (!chatState.profile.withdrawSeed) {
    chatState.profile.withdrawSeed = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  }
  return chatState.profile.withdrawSeed;
}
async function withdrawSecretFor(tag) {
  return envelopeSha256Hex(`poorija-withdraw-v1|${withdrawSeed()}|${tag}`);
}
async function withdrawHashFor(tag) {
  return envelopeSha256Hex(await withdrawSecretFor(tag));
}

/* ---- sealing the sender ------------------------------------------------------ */

async function sealEnvelopeSender(envelope, key, { ephemeral = false } = {}) {
  if (!envelope || !key) return envelope;
  const hidden = {};
  for (const field of SEALED_SENDER_FIELDS) {
    if (envelope[field] !== undefined) {
      hidden[field] = envelope[field];
      delete envelope[field];
    }
  }
  const iv = app().generateSecureRandomBytes(12);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(paddedJson(hidden)));
  envelope.ss = 1;
  envelope.box = { iv: Array.from(iv), cipher: app().arrayBufferToBase64(cipher) };
  /* The one fact the relay still needs about what is inside: whether to keep
     it at all. */
  if (ephemeral) envelope.eph = 1;
  if (envelope.tag) envelope.wd = await withdrawHashFor(envelope.tag);
  return envelope;
}

/* The receiving half: the box opens with the key that opens the body, and
   what comes out is put back where it always was, so everything downstream
   reads the envelope it always read. Null when the key will not open it —
   the caller treats that exactly like a body that will not open. */
async function openSealedSender(payload) {
  if (payload?.ss !== 1 || !payload.box) return payload;
  const key = payload.kex
    ? await openPrekeySeal(payload.kex).catch(() => null)
    : await openOfflineSeal(payload.seal).catch(() => null);
  if (!key) return null;
  let hidden;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(payload.box.iv || []) },
      key,
      app().base64ToArrayBuffer(payload.box.cipher),
    );
    hidden = JSON.parse(new TextDecoder().decode(plain));
  } catch (_error) {
    return null;
  }
  if (!hidden || typeof hidden !== 'object') return null;
  const opened = { ...payload };
  delete opened.box;
  delete opened.pad;
  for (const field of SEALED_SENDER_FIELDS) {
    if (hidden[field] !== undefined) opened[field] = hidden[field];
  }
  return opened;
}

window.paddedJson = paddedJson;
window.padLiveFrame = padLiveFrame;
window.peerSupports = peerSupports;
