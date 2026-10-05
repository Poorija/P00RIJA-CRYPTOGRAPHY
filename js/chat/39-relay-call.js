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
   A call between two people whose relays are not the same one.
   ============================================================================

   Everything else about a cross-relay conversation already worked: the message,
   the file, the queued envelope, the push. A CALL did not, and the reason was
   one line:

       chatState.peer.call(peerRecord.peerId, stream, …)

   A PeerJS id only means something on the server that issued it. Two people who
   loaded the app from two different deployments are registered on two different
   PeerJS instances, so that id names nobody and the offer never leaves. The ring
   arrived — call-invite travels as a relay envelope and relay envelopes cross
   transit — and then the call sat there until it timed out as a missed one. It
   rang and could not connect, which is the worst of the three possible
   behaviours.

   So the media negotiation goes the way everything else goes. The offer, the
   answer and the candidates travel as relay payloads, sealed to the recipient's
   relay by sendRelayEnvelope exactly like a message, and the RTCPeerConnection
   is built here instead of inside the library.

   WHAT DOES NOT CHANGE
   --------------------
   The media. Once the two descriptions are exchanged, this is an ordinary peer
   connection: it goes directly between the two people if their networks allow
   it, and through TURN if they do not. Each side uses its OWN relay's TURN
   server — a relayed candidate is just an address, so there is nothing to share
   and no server-to-server media path to build. Two independent TURN servers
   give better odds than one, not worse.

   WHAT THE RELAYS SEE
   -------------------
   The same thing a signalling server has always seen: that these two are
   negotiating, and the SDP, which carries candidate addresses and a DTLS
   fingerprint. It carries no key material — DTLS-SRTP derives the media keys
   from the handshake between the two browsers, and the fingerprint only lets
   each side check it is talking to the party it negotiated with. A call on ONE
   relay exposes precisely this much to that relay's PeerJS. Nothing new is
   given up by the second relay seeing it; what is new is that two relays see it
   rather than one, which is why the carrying relay is not one of them: the
   envelope is sealed to the recipient's relay before it is handed over.

   WHY A SHIM AND NOT A SECOND CALL UI
   -----------------------------------
   The interface above touches six things on a PeerJS MediaConnection: `peer`,
   `metadata`, `on`, `emit`, `answer`, `close`, and it reads `peerConnection`.
   That is a small enough surface to present honestly, so the incoming screen,
   the quality panel, the video ladder, the ICE-restart recovery and the call log
   all work on a relay call without knowing it is one. `relayCall: true` is there
   for the places that genuinely have to care.
   ============================================================================ */

/* Long enough for a phone to be picked up, short enough that a call to somebody
   whose relay has gone away does not ring forever. The offline ring in
   32-file-transfer-4.js uses thirty seconds for the same decision. */
const RELAY_CALL_SETUP_TIMEOUT_MS = 45000;

function relayCalls() {
  chatState.relayCalls = chatState.relayCalls || new Map();
  return chatState.relayCalls;
}

/* Candidates that arrived before the offer they belong to. Bounded in both
   directions -- a few seconds and a few dozen candidates -- because an id nobody
   ever claims must not become somewhere to put things. */
const EARLY_CANDIDATE_MS = 20000;
const EARLY_CANDIDATE_MAX = 40;
const earlyCandidates = new Map();

function holdEarlyCandidate(callId, candidate) {
  const now = Date.now();
  for (const [id, held] of earlyCandidates) {
    if (now - held.at > EARLY_CANDIDATE_MS) earlyCandidates.delete(id);
  }
  if (!earlyCandidates.has(callId)) earlyCandidates.set(callId, { at: now, list: [] });
  const held = earlyCandidates.get(callId);
  if (held.list.length < EARLY_CANDIDATE_MAX) held.list.push(candidate);
}

function replayEarlyCandidates(callId, call) {
  const held = earlyCandidates.get(callId);
  if (!held) return;
  earlyCandidates.delete(callId);
  for (const candidate of held.list) call.acceptCandidate(candidate);
}

/* The same ICE configuration an ordinary call gets, including the per-contact
   TURN ordering the measurements produced.
 *
 * prepareIceForContact cannot be reused: it reorders the list inside
 * chatState.peer.options because that is the only place PeerJS reads it from,
 * and this connection is not PeerJS's. The ordering function is the part that
 * matters and it is pure. */
function relayCallConfig(peerRecord) {
  let config;
  try {
    config = peerOptions().config;
  } catch (_error) {
    config = { iceServers: [] };
  }
  const servers = Array.isArray(config.iceServers) ? config.iceServers : [];
  const ordered = typeof orderIceServersFor === 'function'
    ? orderIceServersFor(peerRecord?.fingerprint, servers)
    : servers;
  return { ...config, iceServers: ordered };
}

/* An id for the call itself, because a relay payload has no connection to hang
   state off. Both sides quote it back, and it is what tells a late-arriving
   candidate which negotiation it belongs to. */
function relayCallId() {
  return `rc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* The object the rest of the interface treats as a call.
 *
 * Every listener is attached with addEventListener rather than an `on…`
 * property. 31-file-transfer-3.js ASSIGNS pc.oniceconnectionstatechange to take
 * PeerJS's hang-up-on-failure handler away from it, and it would take this
 * file's candidate trickling with it. */
function makeRelayCall(peerRecord, { callId, metadata = {}, mode = 'voice' }) {
  const listeners = new Map();
  const pc = new RTCPeerConnection(relayCallConfig(peerRecord));
  const remote = new MediaStream();
  /* Candidates routinely arrive before the description they belong to — the
     other side starts gathering the moment it has a local description, and the
     relay hop is not ordered with respect to the SDP. Adding one before
     setRemoteDescription throws, so they wait here. */
  const heldCandidates = [];
  let remoteDescriptionSet = false;
  let announcedStream = false;
  let closed = false;

  /* 'stream' and 'close' are replayed to a listener that subscribes late.
     startCall awaits placeRelayCall and calls bindMediaCall afterwards, so there
     is a window -- short, but a real one across an await -- in which a one-shot
     event would fire into an empty listener list and the call would connect with
     no video attached and nothing to say why. */
  const replayable = new Map();
  const emit = (event, ...args) => {
    if (event === 'stream' || event === 'close') replayable.set(event, args);
    for (const fn of listeners.get(event) || []) {
      try { fn(...args); } catch (error) { console.error('[RelayCall]', event, error); }
    }
  };

  /* Where the answer, the candidates and the hang-up are sent.
   *
   * sendRelayEnvelope routes by what the CONTACT RECORD says, and on the
   * answering side that record may not yet say anything routable: a first call,
   * before any message has been exchanged, leaves the person being called with
   * no way back to the person calling them. The ring arrives, they press answer,
   * and the answer goes to their own relay -- which has never heard of the
   * caller -- and is dropped. From both sides that looks like a call that
   * connected and carries nothing, which is exactly what it is.
   *
   * So the offer brings the caller's own relay with it, and it is used for this
   * call and nothing else. It is NOT written onto the contact record: a relay
   * payload is not signed, so a relay could put a route of its own choosing
   * here, and the ladder in 18-file-manager-2.js exists to stop that becoming
   * durable. What a forged one could achieve is to receive an SDP and learn that
   * this person answered; it cannot listen, because the media keys come from the
   * DTLS handshake between the two browsers and never from the signalling. The
   * contact's own record wins whenever it already has something routable. */
  let callRoute = null;
  const signal = (payload) => {
    /* Who is speaking, inside the payload: over transit the envelope's sender
       field is blank by design, and without this the far end could not tell
       an answer of this call's contact from noise — it resolved the sender
       from the payload or not at all. */
    const frame = {
      ...payload,
      callId,
      fromFingerprint: chatState.identity?.fingerprint || '',
      peerId: payload.peerId || chatState.peerId || '',
    };
    if (typeof transitRouteFor === 'function' && transitRouteFor(peerRecord)) {
      return sendRelayEnvelope(peerRecord, frame);
    }
    if (callRoute && typeof sendViaTransit === 'function') {
      /* Built the way sendRelayEnvelope builds one, because that is what the far
         relay expects to open and hand to its own client. */
      sendViaTransit({
        type: 'relay',
        toClientId: peerRecord.clientId || '',
        toFingerprint: peerRecord.fingerprint || '',
        payload: frame,
        persist: false,
      }, callRoute, peerRecord);
      return true;
    }
    return sendRelayEnvelope(peerRecord, frame);
  };

  const call = {
    /* The far peer id as the card or presence reported it. Nothing dials it —
       it is what the call log and the incoming screen name the caller by. */
    peer: peerRecord.peerId || peerRecord.clientId || peerRecord.fingerprint || '',
    metadata: { mode, ...metadata },
    peerConnection: pc,
    relayCall: true,
    callId,
    fingerprint: peerRecord.fingerprint || '',
    /* Set from the offer, used only while this call lasts. */
    useRouteForThisCall(home) {
      if (home && home.id && home.key) callRoute = home;
    },
    on(event, fn) {
      if (typeof fn !== 'function') return call;
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
      if (replayable.has(event)) {
        try { fn(...replayable.get(event)); } catch (error) { console.error('[RelayCall]', event, error); }
      }
      return call;
    },
    emit,
    /* The callee's side of the negotiation. Same signature as PeerJS's, so
       acceptIncomingCall needs no branch. */
    async answer(stream, options = {}) {
      if (closed) return;
      try {
        call.rearmForConnecting?.();
        for (const track of stream?.getTracks?.() || []) addLocalTrack(pc, track, stream);
        const answer = await pc.createAnswer();
        const sdp = typeof options.sdpTransform === 'function'
          ? options.sdpTransform(answer.sdp)
          : answer.sdp;
        await pc.setLocalDescription({ type: 'answer', sdp });
        signal({ type: 'call-relay-answer', sdp, mode: call.metadata.mode });
      } catch (error) {
        emit('error', error);
        call.close();
      }
    },
    close() {
      if (closed) return;
      closed = true;
      relayCalls().delete(callId);
      /* Told, not left to time out. Without this the other side rings until its
         own setup timeout, which is the difference between "they hung up" and
         "something broke". */
      try { signal({ type: 'call-relay-end' }); } catch (_error) { /* the relay may be gone too */ }
      try { pc.close(); } catch (_error) { /* already closed */ }
      emit('close');
    },
    /* Called by the signal router below, not from the interface. */
    async acceptDescription(type, sdp) {
      await pc.setRemoteDescription({ type, sdp });
      remoteDescriptionSet = true;
      for (const candidate of heldCandidates.splice(0)) {
        try { await pc.addIceCandidate(candidate); } catch (_error) { /* a stale candidate is not fatal */ }
      }
    },
    async acceptCandidate(candidate) {
      if (!candidate) return;
      if (!remoteDescriptionSet) { heldCandidates.push(candidate); return; }
      try { await pc.addIceCandidate(candidate); } catch (_error) { /* likewise */ }
    },
    remoteEnded() {
      if (closed) return;
      closed = true;
      relayCalls().delete(callId);
      try { pc.close(); } catch (_error) { /* already closed */ }
      emit('close');
    },
  };

  pc.addEventListener('track', (event) => {
    for (const track of event.streams?.[0]?.getTracks?.() || (event.track ? [event.track] : [])) {
      if (!remote.getTracks().includes(track)) remote.addTrack(track);
    }
    /* Announced once. PeerJS emits 'stream' a single time and the interface
       attaches the stream to a video element on that event; emitting per track
       would re-attach mid-call and restart playback. */
    if (!announcedStream && remote.getTracks().length) {
      announcedStream = true;
      emit('stream', remote);
    }
  });

  pc.addEventListener('icecandidate', (event) => {
    if (!event.candidate) return;
    signal({
      type: 'call-relay-ice',
      candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
    });
  });

  pc.addEventListener('iceconnectionstatechange', () => {
    emit('iceStateChanged', pc.iceConnectionState);
    if (pc.iceConnectionState === 'closed') call.remoteEnded();
  });

  relayCalls().set(callId, call);

  /* A negotiation that never completes has to end by itself, or the entry above
     leaks and the user is left on a ringing screen. Cleared as soon as the
     connection reports it is up. */
  let giveUp = null;
  const armDeadline = (ms, reason) => {
    if (giveUp) clearTimeout(giveUp);
    giveUp = setTimeout(() => {
      if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected'
        || pc.iceConnectionState === 'completed') return;
      emit('error', new Error(reason));
      call.close();
    }, ms);
  };
  armDeadline(RELAY_CALL_SETUP_TIMEOUT_MS, 'the call was not answered');
  /* Answering restarts it. On the callee's side the first deadline began when the
     offer ARRIVED, which is before anybody had been asked anything, so a call
     picked up late was torn down partway through connecting. */
  call.rearmForConnecting = () => armDeadline(20000, 'the media path could not be established');
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'connected') clearTimeout(giveUp);
    if (pc.connectionState === 'failed') {
      emit('error', new Error('the media path could not be established'));
      call.close();
    }
  });
  call.on('close', () => clearTimeout(giveUp));

  return call;
}

/* The caller's side. Returns something the call interface can treat exactly as
   it treats the value of chatState.peer.call(). */
async function placeRelayCall(peerRecord, stream, { mode = 'voice', metadata = {} } = {}) {
  const callId = relayCallId();
  const call = makeRelayCall(peerRecord, { callId, mode, metadata });
  try {
    for (const track of stream?.getTracks?.() || []) addLocalTrack(call.peerConnection, track, stream);
    const offer = await call.peerConnection.createOffer();
    const sdp = typeof preferCallCodecs === 'function' ? preferCallCodecs(offer.sdp) : offer.sdp;
    await call.peerConnection.setLocalDescription({ type: 'offer', sdp });
    const sent = sendRelayEnvelope(peerRecord, {
      type: 'call-relay-offer', tag: generateId('relay-call'),
      callId,
      sdp,
      mode,
      /* So the person being called can answer even if this is the first thing
         that has ever passed between the two of them. */
      fromHomeRelay: typeof myHomeRelay === 'function' ? myHomeRelay() : null,
      name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
      peerId: chatState.peerId,
      metadata: { mode, username: chatState.profile.name, peerId: chatState.peerId, ...metadata },
    });
    if (!sent) throw new Error('the relay would not take the offer');
  } catch (error) {
    call.close();
    throw error;
  }
  return call;
}

/* A helper only so the failure is attributable: a track that cannot be added
   leaves a connection that negotiates and carries no media, which looks like a
   network problem and is not one. */
function addLocalTrack(pc, track, stream) {
  try {
    pc.addTrack(track, stream);
  } catch (error) {
    console.error('[RelayCall] a local track was refused:', error);
    throw error;
  }
}

/* The callee's side, up to the point where the user is asked.
 *
 * Nothing is answered here and no microphone is opened: the incoming screen is
 * raised with a call object that is ready to be answered, and answering is what
 * acceptIncomingCall already does. */
function relayCallOfferArrived(peerRecord, payload) {
  const callId = String(payload?.callId || '');
  if (!callId || !payload?.sdp) return false;
  /* A second offer for a call already being set up is a retry, not a new call.
     Raising another incoming screen for it is how one caller turns into two. */
  if (relayCalls().has(callId)) return true;
  const mode = payload.mode === 'video' ? 'video' : 'voice';
  const call = makeRelayCall(peerRecord, {
    callId,
    mode,
    metadata: {
      mode,
      username: payload.metadata?.username || payload.name || peerRecord.name || '',
      peerId: payload.metadata?.peerId || payload.peerId || '',
      /* A leg of a group call is a group call, and the only thing that says
         so is the group's id in the offer's metadata. Dropping it here made
         the callee read a group leg as a 1:1 call: a full-screen ringing
         modal stacked over the group stage the member had already joined,
         and a second parallel call if they answered. The roster keyed on
         this field is what puts the leg where it belongs instead. */
      groupCall: payload.metadata?.groupCall || '',
      spaceId: payload.metadata?.spaceId || '',
    },
  });
  if (payload.fromHomeRelay) call.useRouteForThisCall(payload.fromHomeRelay);
  call.acceptDescription('offer', payload.sdp)
    .then(() => {
      replayEarlyCandidates(callId, call);
      if (typeof handleIncomingGroupCallLeg === 'function' && handleIncomingGroupCallLeg(call)) return;
      appendCall({
        name: call.metadata.username || call.peer,
        peerId: call.peer,
        mode,
        status: 'incoming',
        direction: 'in',
        logToChat: false,
      });
      showIncomingCall(call);
      if (chatState.pendingIncomingAccept) acceptIncomingCall().catch(console.error);
    })
    .catch((error) => {
      console.error('[RelayCall] the offer could not be read:', error);
      call.close();
    });
  return true;
}

/* Every relay payload that belongs to a relay call. Returns true when the
   message was one, so the ordinary message router can stop looking.
 *
 * The sender is resolved from the contact list, not from what the payload says
 * about itself: a payload that names its own sender names whoever wrote it. */
function handleRelayCallSignal(message) {
  const payload = message?.payload;
  const type = String(payload?.type || '');
  if (!type.startsWith('call-relay-')) return false;

  /* Who sent it.
   *
   * message.fromFingerprint is the field the relay fills in with the identity it
   * CHALLENGED, and for a message that arrived over transit it is deliberately
   * blank: nothing was proved to the carrying relay, so it vouches for nothing.
   * Reading only that field dropped every cross-relay call on the floor -- the
   * exact calls this file exists for.
   *
   * So the sender is looked up by what the payload says as well, which is the
   * same fallback the ICE-restart signalling already lives on (see
   * isCallSignalFromActivePeer in 31-file-transfer-3.js). What that buys is
   * "somebody I already hold a card for", not proof: a payload that names its own
   * sender names whoever wrote it. It is enough for the decision made here, which
   * is only whether to raise a ringing screen for a known contact, and it is
   * exactly the assurance a same-relay call has had all along -- the media keys
   * come from the DTLS handshake between the two browsers, so no relay and no
   * impostor in the signalling can listen to what follows. */
  const peerRecord = typeof findPeerByAnyKey === 'function'
    ? (findPeerByAnyKey(message.fromFingerprint || '')
      || findPeerByAnyKey(payload.fromFingerprint || '')
      || findPeerByAnyKey(payload.metadata?.peerId || payload.peerId || '')
      || findPeerByAnyKey(message.fromClientId || ''))
    : null;

  if (type === 'call-relay-offer') {
    if (!peerRecord) {
      /* An offer from somebody who is not a contact. There is nothing to
         verify it against and nothing to seal a reply to, so it is dropped
         rather than shown — an incoming call screen for an unknown party is a
         way to make the user answer a stranger. */
      console.warn('[RelayCall] an offer arrived from somebody who is not a contact; dropped.');
      return true;
    }
    return relayCallOfferArrived(peerRecord, payload);
  }

  const callId = String(payload.callId || '');
  const call = relayCalls().get(callId);
  if (!call) {
    /* A candidate for a call that has not arrived yet.
     *
     * The caller starts trickling the moment it has a local description, and the
     * offer and the candidates then race each other over two relays with no
     * ordering between them. Dropping the early ones is not harmless: the first
     * candidates are the host and reflexive ones, so losing them can leave the
     * answering side with nothing to reach the caller on at all -- a call that
     * connects to nothing, which is the shape of "it rang and then carried no
     * sound". They are held briefly and replayed once the offer lands. */
    if (type === 'call-relay-ice' && payload.candidate) holdEarlyCandidate(callId, payload.candidate);
    return true;
  }
  /* The call was set up with one contact; a payload about it from anybody else
     is not part of it. The offer path drops what a non-contact sends, and the
     answer and candidate paths answer to the same rule — the guard used to
     run only when the sender resolved to a record, so a sender that resolved
     to nobody slipped through to a live call on the strength of the callId
     alone. */
  if (!peerRecord || (call.fingerprint && peerRecord.fingerprint !== call.fingerprint)) {
    console.warn('[RelayCall] a signal for this call came from outside its contact; dropped.');
    return true;
  }

  if (type === 'call-relay-answer') {
    call.acceptDescription('answer', payload.sdp).catch((error) => {
      console.error('[RelayCall] the answer could not be read:', error);
      call.emit('error', error);
      call.close();
    });
    return true;
  }
  if (type === 'call-relay-ice') {
    call.acceptCandidate(payload.candidate);
    return true;
  }
  if (type === 'call-relay-end') {
    call.remoteEnded();
    return true;
  }
  return true;
}

/* Whether a call to this contact has to go this way.
 *
 * transitRouteFor is the same question the message path asks, and asking it the
 * same way is the point: if a message to them needs a carrier, so does a call,
 * and if it does not, PeerJS is the faster road and keeps working. */
function callNeedsRelay(peerRecord) {
  if (typeof transitRouteFor !== 'function') return false;
  return Boolean(transitRouteFor(peerRecord));
}

window.placeRelayCall = placeRelayCall;
window.handleRelayCallSignal = handleRelayCallSignal;
window.callNeedsRelay = callNeedsRelay;
