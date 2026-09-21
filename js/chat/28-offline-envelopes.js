/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 28 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Offline envelopes seal themselves.
*/

/* ------------------------------------------------------------------
 * Offline envelopes seal themselves.
 *
 * A live session negotiates one AES key that both ends keep. That model
 * cannot be reused for store-and-forward: if both peers are offline and both
 * write to each other, each would mint a key, each would accept the other's,
 * and each would then encrypt under a key the other has just discarded. The
 * messages become unreadable and nothing reports an error, because both sides
 * believe they hold "the" session key.
 *
 * So an offline envelope carries its own. A fresh AES-256-GCM key per
 * envelope, wrapped to the recipient's RSA-OAEP-3072 public key, travels with
 * the ciphertext. There is no shared state to disagree about, no dependency on
 * delivery order, and no requirement that the recipient still holds a session
 * key from some earlier conversation — which is the other way offline delivery
 * used to fail, silently, after a reinstall.
 *
 * The relay sees the wrapped key and cannot open it: unwrapping needs the
 * recipient's private key, which never leaves their device.
 * ------------------------------------------------------------------ */
/* The forward-secret way to write to somebody who is not here.
   An ephemeral pair is made for this one envelope, the shared secret comes
   from it and the recipient's published prekey, and the private half is
   dropped before this function returns — it exists only inside this call.
   What travels is the ephemeral PUBLIC key and the id of the prekey used, so
   the recipient knows which of their own private prekeys to reach for. When
   that prekey expires they delete it, and the envelope stops being openable
   by anyone including them. That is the fifteen-day window the UI promises. */
/* Silence would be the wrong answer here: something was sent, it waited too
   long, and the person it was sent to should be told that rather than left to
   assume nothing was ever sent. */
function noteExpiredEnvelope(session, payload) {
  const peer = findPeerBySession(session);
  /* Whatever names this conversation. An envelope whose window has closed
     still knows who sent it, so there is always somewhere to put the note. */
  const conversationId = getPeerHistoryKey(peer, session)
    || session?.conversationId
    || (payload?.fromPeerId ? `peer:${payload.fromPeerId}` : '')
    || payload?.fromFingerprint
    || '';
  if (!conversationId) return;
  appendHistory(conversationId, {
    id: `expired-${payload.createdAt || Date.now()}`,
    type: 'system-note',
    direction: 'in',
    text: t(
      'یک پیام تحویل‌نشده رسید که پنجرهٔ ۱۵ روزه‌اش تمام شده بود و دیگر قابل باز کردن نیست.',
      'An undelivered message arrived after its 15-day window had closed and can no longer be opened.',
    ),
    createdAt: new Date().toISOString(),
  });
  renderPeers();
  renderMessages();
}

async function sealWithPrekey(peerRecord, rawKeyBytes) {
  const prekeyPublic = peerRecord?.prekeyPublic || '';
  const prekeyId = peerRecord?.prekeyId || '';
  if (!prekeyPublic || !prekeyId) return null;
  if (peerRecord.prekeyExpiresAt && Date.parse(peerRecord.prekeyExpiresAt) <= Date.now()) return null;
  try {
    const ephemeral = await generateEcdhPair();
    const theirPrekey = await importEcdhPublic(prekeyPublic);
    const wrapKey = await deriveSharedAesKey(ephemeral.keyPair.privateKey, theirPrekey, 'poorija-offline-v2');
    const iv = app().generateSecureRandomBytes(12);
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, rawKeyBytes);
    return {
      v: 2,
      prekeyId,
      kex: ephemeral.publicKeyData,
      iv: Array.from(iv),
      key: app().arrayBufferToBase64(wrapped),
    };
  } catch (error) {
    console.warn('[Chat] prekey seal unavailable, falling back:', error);
    return null;
  }
}
/* The other side of it. A missing or expired prekey is not an error to work
   around — it is the window having closed. */
async function openPrekeySeal(kex) {
  if (!kex || kex.v !== 2 || !kex.prekeyId || !kex.kex) return null;
  const mine = findPrekey(kex.prekeyId);
  if (!mine) return null;
  const privateKey = await importEcdhPrivate(mine.privateKeyData);
  const theirEphemeral = await importEcdhPublic(kex.kex);
  const wrapKey = await deriveSharedAesKey(privateKey, theirEphemeral, 'poorija-offline-v2');
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(kex.iv || []) }, wrapKey, app().base64ToArrayBuffer(kex.key));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

async function sealSessionKeyFor(session, peerRecord) {
if (!session?.cryptoKey) return '';
const publicKeyData = peerRecord?.publicKeyData || session.remotePublicKeyData || '';
if (!publicKeyData) return '';
const rawKey = await crypto.subtle.exportKey('raw', session.cryptoKey);
const remotePublicKey = await importIdentityPublicKey(publicKeyData);
const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, remotePublicKey, rawKey);
return app().arrayBufferToBase64(wrapped);
}
async function openOfflineSeal(seal) {
if (!seal) return null;
const privateKey = await importIdentityPrivateKey();
const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, app().base64ToArrayBuffer(seal));
return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}
/* Builds the envelope every offline send goes through, so the seal cannot be
   forgotten at one call site out of ten. `class` is the only thing the relay
   reads: it keeps text indefinitely and expires media after seven days, and it
   cannot tell them apart from ciphertext alone. */
/* ------------------------------------------------------------------
 * What the relay is allowed to see
 *
 * The body was already sealed; the envelope around it was not. A queued
 * file-start sat in the mailbox with `name`, `mime`, `kind`, `size`,
 * `durationMs` and the timers all in the clear, so anyone holding that file —
 * a server operator, whoever finds a backup, anyone who compels one — learned
 * every filename people had sent while the other side was away, with its type
 * and size. The contents were encrypted and nothing else was.
 *
 * `body` now carries the whole message encrypted under the session key that
 * `seal` already wraps to the recipient, so opening it needs the recipient's
 * private key and nothing else. The relay keeps only what it actually uses:
 * the class, to know how long to hold it, and the routing fields.
 * ------------------------------------------------------------------ */
function offlineEnvelope(message, { createdAt, seal = '', messageClass = 'text', body = null, kex = null, notify = true, scope = '' } = {}) {
const envelope = {
type: 'offline-chat',
fromPeerId: chatState.peerId,
fromFingerprint: chatState.identity?.fingerprint || '',
seal,
class: messageClass,
createdAt: createdAt || message?.createdAt || new Date().toISOString(),
};
/* Two hints the relay is allowed to read, so the notification it sends can say
   what kind of thing is waiting. Neither carries content, a name, or a group
   id: `scope` says only "this belongs to a group", and `signal` is the call
   verb plus voice-or-video, which 1:1 call signalling has always sent in the
   clear anyway. Without them a group call to a phone that is asleep rings as
   "chat update", which is worse than the small amount this admits. */
const signalType = String(message?.type || '');
/* What is inside, by name only.
 *
 * Everything an envelope wraps comes out as type 'offline-chat', and both the
 * decision to store it and the decision to ring a phone for it were made from
 * that outer name. A delivery receipt or a typing flag sent to somebody who
 * had stepped away was therefore stored like a message and rang like one -
 * which is where a screen full of "Encrypted chat update received" with
 * nothing behind it came from. The name is enough to tell them apart and says
 * nothing the relay could not already infer from the timing. */
if (signalType) envelope.inner = signalType;
if (/^g?call-/.test(signalType)) {
envelope.signal = signalType;
if (message?.mode === 'video' || message?.mode === 'voice') envelope.mode = message.mode;
}
/* Nothing ephemeral is worth waking anyone for. */
if (EPHEMERAL_RELAY_TYPES.has(signalType)) envelope.notify = false;
/* A `gcall-` verb is a group call by definition, so the caller does not have
   to remember to say so. */
const groupScope = scope || (signalType.startsWith('gcall-') || message?.spaceId ? 'group' : '');
if (groupScope) envelope.scope = groupScope;
/* The forward-secret path. Present instead of `seal` when the recipient had a
   live prekey to write to. */
if (kex) envelope.kex = kex;
/* Whether this envelope is worth waking a device for. The relay cannot see
   inside a sealed envelope, so it cannot tell a message from the fortieth
   chunk of a file — this is the one bit of metadata that lets it ring once for
   the file rather than once per chunk, and it says nothing about content. */
if (notify === false) envelope.notify = false;
/* No session key means no key to encrypt with, and in that case the plaintext
   shape is the only way the message travels at all. Older builds also only
   understand that shape, so it stays readable. */
if (body) envelope.body = body;
else envelope.message = message;
return envelope;
}
async function encryptForSession(session, plainBytes) {
const iv = app().generateSecureRandomBytes(12);
const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session.cryptoKey, plainBytes);
return {
iv: Array.from(iv),
cipher: app().arrayBufferToBase64(cipher),
};
}
async function decryptForSession(session, payload) {
const decrypted = await crypto.subtle.decrypt(
{ name: 'AES-GCM', iv: new Uint8Array(payload.iv || []) },
session.cryptoKey,
app().base64ToArrayBuffer(payload.cipher)
);
return decrypted;
}
