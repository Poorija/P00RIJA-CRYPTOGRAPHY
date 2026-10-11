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
   A live channel to somebody on another relay.
   ============================================================================

   On one relay two people get a peer-to-peer data channel from PeerJS, and
   messages, receipts and — above all — files ride it directly, at the speed
   of the path between the two devices. Across two relays they never did: a
   PeerJS id only means something on the server that issued it, so
   startSecureSession dialled an id nobody knew and every byte went through
   the relays instead, sealed envelope by sealed envelope, a large file as
   thousands of them through a border that throttles.

   This builds the same channel the way 39-relay-call.js builds a call: the
   offer, the answer and the candidates travel as relay payloads (sealed to
   the recipient's relay over transit, the carrier unable to read them), and
   the RTCPeerConnection is made here. What comes back is shaped like a PeerJS
   DataConnection — open, send, on('open'|'data'|'close'|'error'), close,
   dataChannel, bufferSize — so the session layer (bindDataConnection, the key
   exchange, safeConnectionSend, awaitChannelDrain, every send path) runs over
   it without knowing.

   The path is chosen like a call's: direct when the networks allow, a TURN
   otherwise — this device's own plus, for this link only, one on the
   contact's relay (buildIceConfigFor). When the link cannot open, or drops,
   nothing is lost: the session's connection goes back to null and every send
   path already falls through to the relay.

   Framing: PeerJS serialises with BinaryPack, which this does not have. A
   message is JSON with every Uint8Array lifted out into a binary tail, and
   anything over 16 KB is fragmented — the size every engine's SCTP stack
   delivers without argument.
   ============================================================================ */

const LINK_SETUP_TIMEOUT_MS = 20000;
const LINK_FRAGMENT_BYTES = 16 * 1024;
const LINK_MAX_FRAGMENTS = 4096;          /* 64 MB in one message, far above a file chunk */
const LINK_MAX_ASSEMBLIES = 64;

function relayLinks() {
  chatState.relayLinks = chatState.relayLinks || new Map();
  return chatState.relayLinks;
}

/* ---- framing ------------------------------------------------------------- */

function encodeLinkMessage(message) {
  const blobs = [];
  const json = JSON.stringify(message, (_key, value) => {
    if (value instanceof Uint8Array) { blobs.push(value); return { __b: blobs.length - 1 }; }
    if (value instanceof ArrayBuffer) { blobs.push(new Uint8Array(value)); return { __b: blobs.length - 1 }; }
    if (ArrayBuffer.isView(value)) { blobs.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)); return { __b: blobs.length - 1 }; }
    return value;
  });
  const head = new TextEncoder().encode(json);
  let total = 4 + head.length + 4;
  for (const blob of blobs) total += 4 + blob.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;
  view.setUint32(at, head.length); at += 4;
  out.set(head, at); at += head.length;
  view.setUint32(at, blobs.length); at += 4;
  for (const blob of blobs) {
    view.setUint32(at, blob.length); at += 4;
    out.set(blob, at); at += blob.length;
  }
  return out;
}

function decodeLinkMessage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const headLength = view.getUint32(at); at += 4;
  if (headLength > bytes.length - 8) throw new Error('link frame is truncated');
  const json = new TextDecoder().decode(bytes.subarray(at, at + headLength)); at += headLength;
  const count = view.getUint32(at); at += 4;
  if (count > 64) throw new Error('link frame carries too many parts');
  const blobs = [];
  for (let i = 0; i < count; i += 1) {
    const length = view.getUint32(at); at += 4;
    if (at + length > bytes.length) throw new Error('link frame part is truncated');
    blobs.push(bytes.slice(at, at + length)); at += length;
  }
  return JSON.parse(json, (_key, value) => (
    value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === 1 && Number.isInteger(value.__b) && blobs[value.__b]
      ? blobs[value.__b] : value
  ));
}

/* ---- the link ------------------------------------------------------------ */

function relayLinkId() {
  return `rl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeRelayLink(peerRecord, { linkId, initiator, config, route = null }) {
  const listeners = new Map();
  const pc = new RTCPeerConnection(config || undefined);
  const heldCandidates = [];
  const assemblies = new Map();
  let remoteDescriptionSet = false;
  let channel = null;
  let isOpen = false;
  let closed = false;
  let nextMessageId = 1;
  let linkRoute = route;

  const emit = (event, ...args) => {
    for (const fn of listeners.get(event) || []) {
      try { fn(...args); } catch (error) { console.error('[RelayLink]', event, error); }
    }
  };
  /* The same routing rule a relay call uses: the contact's record when it is
     routable, otherwise the route the offer carried, for this link only. */
  const signal = (payload) => {
    const frame = {
      ...payload,
      linkId,
      fromFingerprint: chatState.identity?.fingerprint || '',
      peerId: chatState.peerId || '',
    };
    if (typeof transitRouteFor === 'function' && transitRouteFor(peerRecord)) return sendRelayEnvelope(peerRecord, frame);
    if (linkRoute && typeof sendViaTransit === 'function') {
      sendViaTransit({
        type: 'relay', toClientId: peerRecord.clientId || '', toFingerprint: peerRecord.fingerprint || '',
        payload: frame, persist: false,
      }, linkRoute, peerRecord);
      return true;
    }
    return sendRelayEnvelope(peerRecord, frame);
  };

  const finish = (reason) => {
    if (closed) return;
    closed = true;
    isOpen = false;
    relayLinks().delete(linkId);
    window.clearTimeout(setupTimer);
    try { channel?.close(); } catch (_error) { /* already closed */ }
    try { pc.close(); } catch (_error) { /* already closed */ }
    if (reason) console.log(`[RelayLink] ${linkId} closed: ${reason}`);
    emit('close');
  };

  const receive = (data) => {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer || data);
    if (!bytes.length) return;
    let message = null;
    if (bytes[0] === 0) {
      message = decodeLinkMessage(bytes.subarray(1));
    } else if (bytes[0] === 1 && bytes.length > 9) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const messageId = view.getUint32(1);
      const index = view.getUint16(5);
      const total = view.getUint16(7);
      if (!total || total > LINK_MAX_FRAGMENTS || index >= total) return;
      let assembly = assemblies.get(messageId);
      if (!assembly) {
        if (assemblies.size >= LINK_MAX_ASSEMBLIES) return;
        assembly = { total, parts: new Array(total), received: 0 };
        assemblies.set(messageId, assembly);
      }
      if (assembly.total !== total || assembly.parts[index]) return;
      assembly.parts[index] = bytes.slice(9);
      assembly.received += 1;
      if (assembly.received < total) return;
      assemblies.delete(messageId);
      const length = assembly.parts.reduce((sum, part) => sum + part.length, 0);
      const whole = new Uint8Array(length);
      let at = 0;
      for (const part of assembly.parts) { whole.set(part, at); at += part.length; }
      message = decodeLinkMessage(whole);
    }
    if (message) emit('data', message);
  };

  const wire = (dataChannel) => {
    channel = dataChannel;
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('open', () => {
      isOpen = true;
      window.clearTimeout(setupTimer);
      emit('open');
    });
    channel.addEventListener('message', (event) => {
      try { receive(event.data); } catch (error) { console.warn('[RelayLink] a frame could not be read:', error?.message || error); }
    });
    channel.addEventListener('close', () => finish('the channel closed'));
    channel.addEventListener('error', (event) => emit('error', event?.error || new Error('data channel error')));
  };

  const link = {
    peer: peerRecord.peerId || peerRecord.clientId || peerRecord.fingerprint || '',
    metadata: {
      clientId: peerRecord.clientId || peerRecord.peerId || '',
      username: peerRecord.username || peerRecord.name || '',
      publicKeyData: peerRecord.publicKeyData || '',
      fingerprint: peerRecord.fingerprint || '',
    },
    relayLink: true,
    linkId,
    peerConnection: pc,
    /* PeerJS keeps its own send queue and reports its length here; this link
       hands every frame straight to the channel, so it never has one. */
    bufferSize: 0,
    get open() { return isOpen && !closed && channel?.readyState === 'open'; },
    get dataChannel() { return channel; },
    useRouteForThisLink(home) { if (home?.id && home?.key) linkRoute = home; },
    on(event, fn) {
      if (typeof fn !== 'function') return link;
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
      /* A listener attached after the channel opened still hears it — the
         session layer subscribes right after this object is returned, and an
         answerer's channel can open within the same tick. */
      if (event === 'open' && link.open) {
        try { fn(); } catch (error) { console.error('[RelayLink] open', error); }
      }
      return link;
    },
    send(message) {
      if (!link.open) throw new Error('the link is not open');
      const encoded = encodeLinkMessage(message);
      if (encoded.length + 1 <= LINK_FRAGMENT_BYTES) {
        const frame = new Uint8Array(encoded.length + 1);
        frame[0] = 0;
        frame.set(encoded, 1);
        channel.send(frame);
        return;
      }
      const total = Math.ceil(encoded.length / (LINK_FRAGMENT_BYTES - 9));
      if (total > LINK_MAX_FRAGMENTS) throw new Error('message is too large for the link');
      const messageId = nextMessageId;
      nextMessageId = (nextMessageId + 1) >>> 0 || 1;
      for (let index = 0; index < total; index += 1) {
        const part = encoded.subarray(index * (LINK_FRAGMENT_BYTES - 9), (index + 1) * (LINK_FRAGMENT_BYTES - 9));
        const frame = new Uint8Array(part.length + 9);
        const view = new DataView(frame.buffer);
        frame[0] = 1;
        view.setUint32(1, messageId);
        view.setUint16(5, index);
        view.setUint16(7, total);
        frame.set(part, 9);
        channel.send(frame);
      }
    },
    close() {
      if (closed) return;
      try { signal({ type: 'link-relay-end' }); } catch (_error) { /* the relay may be gone too */ }
      finish('closed here');
    },
    remoteEnded() { finish('closed by the other side'); },
    async acceptDescription(type, sdp) {
      await pc.setRemoteDescription({ type, sdp });
      remoteDescriptionSet = true;
      for (const candidate of heldCandidates.splice(0)) {
        try { await pc.addIceCandidate(candidate); } catch (_error) { /* stale */ }
      }
    },
    async acceptCandidate(candidate) {
      if (!candidate) return;
      if (!remoteDescriptionSet) { heldCandidates.push(candidate); return; }
      try { await pc.addIceCandidate(candidate); } catch (_error) { /* stale */ }
    },
    async answer() {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signal({ type: 'link-relay-answer', sdp: answer.sdp });
    },
  };

  pc.addEventListener('icecandidate', (event) => {
    if (!event.candidate) return;
    signal({ type: 'link-relay-ice', candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate });
  });
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed') {
      if (typeof noteDirectPath === 'function' && pc.getConfiguration?.().iceTransportPolicy !== 'relay') {
        noteDirectPath(peerRecord.fingerprint, false);
      }
      finish('the path failed');
    }
  });
  if (initiator) wire(pc.createDataChannel('poorija-link', { ordered: true }));
  else pc.addEventListener('datachannel', (event) => wire(event.channel));

  const setupTimer = window.setTimeout(() => { if (!link.open) finish('it did not open in time'); }, LINK_SETUP_TIMEOUT_MS);
  relayLinks().set(linkId, link);
  return link;
}

/* ---- the two ends -------------------------------------------------------- */

/* The dialling side. Returns the link at once, the way peer.connect() returns
   a DataConnection that opens later. */
async function openRelayDataLink(peerRecord) {
  if (!peerRecord?.fingerprint || typeof RTCPeerConnection !== 'function') return null;
  for (const existing of relayLinks().values()) {
    if (existing.metadata.fingerprint === peerRecord.fingerprint) return existing;
  }
  const config = typeof buildIceConfigFor === 'function' ? await buildIceConfigFor(peerRecord).catch(() => null) : null;
  const linkId = relayLinkId();
  const link = makeRelayLink(peerRecord, { linkId, initiator: true, config });
  try {
    const offer = await link.peerConnection.createOffer();
    await link.peerConnection.setLocalDescription(offer);
    const sent = sendRelayEnvelope(peerRecord, {
      type: 'link-relay-offer',
      linkId,
      sdp: offer.sdp,
      fromFingerprint: chatState.identity?.fingerprint || '',
      peerId: chatState.peerId || '',
      fromHomeRelay: typeof myHomeRelay === 'function' ? myHomeRelay() : null,
      ...(config?.iceTransportPolicy === 'relay' ? { relayOnly: true } : {}),
    });
    if (!sent) { link.close(); return null; }
  } catch (error) {
    console.warn('[RelayLink] the offer could not be made:', error?.message || error);
    link.close();
    return null;
  }
  return link;
}

/* Every relay payload that belongs to a link. True when it was one. */
function handleRelayLinkSignal(message) {
  const payload = message?.payload;
  const type = String(payload?.type || '');
  if (!type.startsWith('link-relay-')) return false;
  const peerRecord = findPeerByAnyKey(message.fromFingerprint || '')
    || findPeerByAnyKey(payload.fromFingerprint || '')
    || findPeerByAnyKey(payload.peerId || '');
  /* Only a contact — somebody this device already holds a key for — may open
     a channel to it, exactly as only a contact may ring it. */
  if (!peerRecord || !peerRecord.publicKeyData || isConversationBlocked(peerRecord)) return true;
  const linkId = String(payload.linkId || '');
  if (!linkId) return true;
  if (type === 'link-relay-offer') {
    acceptRelayDataLink(peerRecord, payload).catch((error) => console.warn('[RelayLink] an offer failed:', error?.message || error));
    return true;
  }
  const link = relayLinks().get(linkId);
  if (!link || link.metadata.fingerprint !== peerRecord.fingerprint) return true;
  if (type === 'link-relay-answer' && payload.sdp) link.acceptDescription('answer', payload.sdp).catch(() => link.close());
  else if (type === 'link-relay-ice') link.acceptCandidate(payload.candidate);
  else if (type === 'link-relay-end') link.remoteEnded();
  return true;
}

async function acceptRelayDataLink(peerRecord, payload) {
  /* Both ends dialled at once: the smaller fingerprint keeps its own link and
     the other side's offer is declined, so exactly one channel survives. A
     link that is already OPEN here and is offered again means the other side
     lost it; theirs is taken and ours let go. */
  const mine = chatState.identity?.fingerprint || '';
  for (const existing of Array.from(relayLinks().values())) {
    if (existing.metadata.fingerprint !== peerRecord.fingerprint) continue;
    if (!existing.open && mine && mine < peerRecord.fingerprint) return;
    existing.close();
  }
  const config = typeof buildIceConfigFor === 'function'
    ? await buildIceConfigFor(peerRecord, { forceRelay: payload.relayOnly === true }).catch(() => null)
    : null;
  const link = makeRelayLink(peerRecord, { linkId: String(payload.linkId), initiator: false, config });
  if (payload.fromHomeRelay) link.useRouteForThisLink(normalizeHomeRelay(payload.fromHomeRelay, 'session'));
  /* The same door an incoming PeerJS connection comes through: the merged,
     pinned record — never the raw claim — is what the session is built on. */
  bindDataConnection(peerRecord, link, false);
  await link.acceptDescription('offer', payload.sdp);
  await link.answer();
}

/* Whether a live channel to this contact has to be built this way. */
function sessionNeedsRelayLink(peerRecord) {
  return Boolean(peerRecord && typeof transitRouteFor === 'function' && transitRouteFor(peerRecord)
    && typeof webRTCSupported === 'function' && webRTCSupported());
}

window.openRelayDataLink = openRelayDataLink;
window.handleRelayLinkSignal = handleRelayLinkSignal;
