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
   local-mesh.js — a room of up to sixteen, on the local network, with no server.
   ============================================================================

   local-link.js connects two devices by carrying one WebRTC offer and one
   answer through a QR code or a clipboard. This turns that pair into a room.

   HOW A THIRD PERSON JOINS WITHOUT A SERVER

   The hard part of a mesh is not the connections, it is the introductions:
   before C can talk to B it has to learn B's session description, and the
   thing that normally carries it is a server.

   It does not have to be. Once C has paired with the host by QR, the host has
   a channel to C and a channel to B — so the host can carry the introduction
   between them. It is a broker, not a relay: it passes two session
   descriptions and then the two of them talk directly, and it never sees a
   message between them because every link has its own key.

   So joining costs exactly one QR scan, always with the host, however many
   people are already in the room. Nobody scans anybody else.

   WHY SIXTEEN

   A full mesh is n(n-1)/2 connections; at sixteen that is 120 across the room
   and 15 for each device, which a laptop and a modern phone carry without
   complaint for text and files. Video is a different budget entirely — fifteen
   encoders and fifteen decoders on one device — so the call code below warns
   above six cameras and offers audio, which is roughly a hundredth of the
   bandwidth. The cap is on the room, not on the medium, and the warning tells
   the truth rather than pretending the ceiling is the same for both.

   WHAT IS ENCRYPTED, AND BY WHOM

   Every link has its own key: ECDH between that pair, HKDF, AES-256-GCM, the
   same construction local-link uses and for the same reason — the public key
   travelled through a camera, so it is the strongest introduction in the app.
   A broadcast is sent once per link, sealed per link. The host has no more
   access to a message between two members than anyone outside the room does,
   which is the property that makes brokering safe.
   ============================================================================ */

(function (global) {
  'use strict';

  const app = () => global.PoorijaApp;
  const link = () => global.PoorijaLocalLink;
  const t = (fa, en) => (app()?.state?.language === 'fa' ? fa : en);
  const notify = (fa, en, kind = 'info') => app()?.showNotification?.(t(fa, en), kind);

  const MESH_VERSION = 1;
  const MAX_MEMBERS = 16;
  /* Beyond this many cameras a full mesh asks one device to encode and decode
     more video than it can, so the room is told rather than left to discover
     it as stutter. Audio has no such warning: fifteen voice streams is a few
     hundred kbit/s. */
  const VIDEO_COMFORT = 6;
  const CHUNK_BYTES = 16 * 1024;
  /* A member sending several files at once is normal; a member announcing
     hundreds of transfers that never finish is filling this device's memory
     with half-assembled blobs, so there is a ceiling on how many one member can
     have open at a time. */
  const MAX_INCOMING_PER_MEMBER = 8;
  /* Enough that nobody scrolls off the end of a real conversation, small
     enough that rebuilding the whole transcript stays cheap. */
  const MAX_TRANSCRIPT = 500;
  /* A data channel is not a file transfer, and browsers disagree about how big
     one message may be — Chrome will carry megabytes, Safari and Firefox will
     not, and the failure is a channel that stops rather than an error anyone
     sees. Pasting a book into the composer is a file, and the room has a file
     button that has no size limit at all. */
  const MAX_TEXT = 8000;
  /* A sticker travels as a URL. Ours are blobs and data URLs; anything else is
     a request to somewhere, made from inside a room that exists so that nothing
     leaves the network. The receiving side already refuses these — this is the
     same rule applied before it goes out, so one device cannot ask fifteen
     others to fetch a URL on its behalf. */
  const SAFE_STICKER = /^(blob:|data:image\/)/;
  const BUFFER_CEILING = 1024 * 1024;
  /* No file size limit. A warning instead, above this, because on a shared
     Wi-Fi one large transfer is the whole room's bandwidth. */
  const LARGE_FILE_WARN = 100 * 1024 * 1024;

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const room = {
    active: false,
    host: false,
    me: { id: '', name: '' },
    members: new Map(),   /* id -> { id, name, pc, channel, key, safety, state } */
    messages: [],
    polls: new Map(),
    name: '',
    face: '',
    hostId: '',
    call: null,
    /* Somebody in the room has a call running and this device has not joined
       it. Held rather than acted on, because joining takes a microphone and
       that is the person's decision, not the room's. */
    ringing: null,
    listeners: new Set(),
  };

  const emit = (event, detail) => {
    room.listeners.forEach((fn) => { try { fn(event, detail); } catch (error) { /* a listener must not stop the room */ } });
    global.dispatchEvent(new CustomEvent(`poorija:mesh-${event}`, { detail }));
  };
  const on = (fn) => { room.listeners.add(fn); return () => room.listeners.delete(fn); };

  const b64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  const newId = () => crypto.randomUUID?.() || Math.random().toString(36).slice(2, 12);

  /* ---- identity ---------------------------------------------------------- */

  /* What this device calls itself in a room, and what the room calls itself.
   *
   * Kept apart from the Secure Chat profile on purpose: the person joining a
   * room on somebody's Wi-Fi is often not the person the chat profile
   * describes, and a room is a place rather than a person. The chat profile is
   * still the default, so nobody has to fill anything in to start. */
  const IDENTITY_KEY = 'poorija_local_identity';

  function readIdentity() {
    try {
      const raw = localStorage.getItem(IDENTITY_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (error) { return {}; }
  }

  function writeIdentity(next) {
    const merged = { ...readIdentity(), ...next };
    /* An avatar is one emoji and a name is forty characters, because both
       travel in every roster message a room sends. */
    if (merged.name !== undefined) merged.name = String(merged.name || '').slice(0, 40);
    if (merged.face !== undefined) merged.face = Array.from(String(merged.face || '')).slice(0, 2).join('');
    if (merged.roomName !== undefined) merged.roomName = String(merged.roomName || '').slice(0, 40);
    if (merged.roomFace !== undefined) merged.roomFace = Array.from(String(merged.roomFace || '')).slice(0, 2).join('');
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(merged)); }
    catch (error) { /* private mode; the choice lasts the session */ }
    const renamed = room.me.name !== myName() || room.me.face !== myFace();
    room.me.name = myName();
    room.me.face = myFace();
    /* A new name is no use if it only exists on this device. `hello` is what
       carries a name into a room, and it is idempotent — the other side just
       overwrites what it had — so it is the right message to send again. */
    if (renamed && room.active) {
      broadcast({ kind: 'hello', name: room.me.name, face: room.me.face }).catch(() => {});
    }
    if (room.host && (next.roomName !== undefined || next.roomFace !== undefined)) {
      room.name = merged.roomName || '';
      room.face = merged.roomFace || '';
      /* The host owns the room's name, so everybody else is told. */
      broadcast({ kind: 'room-identity', name: room.name, face: room.face }).catch(() => {});
    }
    emit('room', snapshot());
    return merged;
  }

  function myName() {
    const chosen = readIdentity().name;
    if (chosen) return chosen;
    const profile = global.chatState?.profile;
    return String(profile?.name || t('کاربر P00RIJA', 'P00RIJA User')).slice(0, 40);
  }

  const myFace = () => readIdentity().face || '🙂';

  function begin({ host = false } = {}) {
    /* A room with nobody in it is a new room, and it starts empty. Without
       this the previous conversation survived into the next pairing: reset the
       link, pair with somebody else, open the room, and the messages from the
       person before them were still on screen. Nothing had leaked to anyone —
       the transcript never leaves the device — but a tool whose whole promise
       is that a local room leaves nothing behind should not be the one holding
       the last one. */
    room.ringing = null;
    if (!room.members.size) forgetRoom();
    room.active = true;
    room.host = host;
    room.me = { id: room.me.id || newId(), name: myName(), face: myFace() };
    if (host) {
      const identity = readIdentity();
      room.name = identity.roomName || '';
      room.face = identity.roomFace || '';
    }
    emit('room', snapshot());
    return room.me;
  }

  function forgetRoom() {
    room.ringing = null;
    /* The name belongs to the room, not to this device. A guest holds whatever
       the host told them; carrying that into the next pairing would put the
       last room's name on somebody else's room until its host happened to
       mention one. The host's own choice is stored and read back in begin(). */
    room.name = '';
    room.face = '';
    room.hostId = '';
    room.messages.forEach((message) => {
      if (message.url && message.url.startsWith('blob:')) {
        try { URL.revokeObjectURL(message.url); } catch (error) { /* already gone */ }
      }
    });
    room.messages = [];
    room.polls.clear();
    if (room.call) {
      try { room.call.stream.getTracks().forEach((track) => track.stop()); } catch (error) { /* gone */ }
      room.call = null;
    }
  }

  function snapshot() {
    return {
      active: room.active,
      host: room.host,
      me: { ...room.me },
      name: room.name,
      face: room.face,
      members: Array.from(room.members.values()).map((m) => ({
        id: m.id, name: m.name, face: m.face || '', state: m.state, safety: m.safety,
        video: Boolean(m.videoOn), audio: Boolean(m.audioOn),
      })),
      count: room.members.size + 1,
      capacity: MAX_MEMBERS,
      full: room.members.size + 1 >= MAX_MEMBERS,
    };
  }

  /* ---- one link ---------------------------------------------------------- */

  /* No ICE servers, exactly as local-link: the only candidates that can exist
     are host candidates, so a room is structurally incapable of leaving the
     local network. */
  function newConnection() {
    return new RTCPeerConnection({ iceServers: [] });
  }

  function waitForIce(pc, timeout = 6000) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      let timer = null;
      const finish = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
      pc.addEventListener('icegatheringstatechange', check);
      timer = setTimeout(finish, timeout);
    });
  }

  /* Both the identifier and the name arrive from another device, and the
     sixteen is a promise this device makes to itself about how many connections
     it will open — not a number it takes another device's word for. A roster of
     ten thousand from a host that has been tampered with would otherwise become
     ten thousand peer connections here before anything else got a chance to
     object. Returns null when it will not make room, so every caller has to
     decide what to do about that rather than carrying on with a half-member. */
  function member(id, name = '') {
    const key = String(id || '').slice(0, 64);
    if (!key) return null;
    let entry = room.members.get(key);
    if (!entry) {
      if (room.members.size + 1 >= MAX_MEMBERS) return null;
      entry = { id: key, name: '', pc: null, channel: null, key: null, safety: '', state: 'new',
        incoming: new Map(), keys: null };
      room.members.set(key, entry);
    }
    const clean = String(name || '').slice(0, 40);
    if (clean) entry.name = clean;
    return entry;
  }

  function attachChannel(entry, channel) {
    entry.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      entry.state = 'open';
      emit('member', snapshot());
      /* The host tells a newcomer who else is here, and tells everyone else
         that somebody arrived. Nobody has to scan anybody but the host. */
      if (room.host) {
        sendTo(entry, { kind: 'roster', members: rosterFor(entry.id) });
        broadcast({ kind: 'joined', id: entry.id, name: entry.name }, entry.id);
      }
    };
    channel.onclose = () => dropMember(entry, { announce: true });
    channel.onmessage = (event) => { receive(entry, event.data).catch(() => {}); };
  }

  /* A member who says goodbye and a member whose laptop lid closes leave the
     same hole; only one of them says so. Handling just the polite case left a
     ghost in the roster with its peer connection still open, still holding a
     camera track if a call was running, and still counting against the sixteen
     — enough dropped links and a room with nobody in it refuses new arrivals.
     So both paths end here, and the host tells everyone else, because from B's
     side a silent A is indistinguishable from an A who is merely quiet. */
  function dropMember(entry, { announce = false } = {}) {
    if (!room.members.has(entry.id)) return;
    room.members.delete(entry.id);
    entry.state = 'left';
    try { entry.channel?.close(); } catch (error) { /* already gone */ }
    try { entry.pc?.close(); } catch (error) { /* already gone */ }
    entry.incoming?.clear?.();
    if (entry.stream) {
      entry.stream.getTracks().forEach((track) => { try { track.stop(); } catch (e) { /* gone */ } });
      entry.stream = null;
    }
    if (announce && room.host && room.active) {
      broadcast({ kind: 'bye-for', id: entry.id }, entry.id).catch(() => {});
    }
    emit('member', snapshot());
  }

  function rosterFor(exceptId) {
    return Array.from(room.members.values())
      .filter((m) => m.id !== exceptId && m.state === 'open')
      .map((m) => ({ id: m.id, name: m.name }))
      .concat([{ id: room.me.id, name: room.me.name, host: true }]);
  }

  /* ---- pairing ----------------------------------------------------------- */

  /* The same shape local-link uses, plus who is offering: a room needs to know
     which member an answer belongs to, and a two-person link never did. */
  async function createOffer({ to = '', broker = '' } = {}) {
    const helpers = link();
    const keys = await helpers.makeKeys();
    const pc = newConnection();
    const id = to || newId();
    const entry = member(id);
    /* The room is full, so there is no connection to build and nothing to hand
       back. Closing the connection that was opened a line ago rather than
       leaving it dangling. */
    if (!entry) { try { pc.close(); } catch (error) { /* gone */ } return null; }
    entry.keys = keys;
    entry.pc = pc;
    entry.state = 'offering';
    attachChannel(entry, pc.createDataChannel('poorija-mesh', { ordered: true }));
    prepareInboundMedia(entry);

    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc);
    return {
      v: MESH_VERSION,
      role: 'offer',
      room: room.me.id,
      name: room.me.name,
      member: id,
      broker,
      key: b64(await crypto.subtle.exportKey('raw', keys.publicKey)),
      sdp: pc.localDescription.sdp,
    };
  }

  async function acceptOffer(payload) {
    if (room.members.size + 1 >= MAX_MEMBERS) {
      notify(`اتاق پر است (سقف ${MAX_MEMBERS} نفر).`,
        `The room is full (${MAX_MEMBERS} people).`, 'warning');
      return null;
    }
    const helpers = link();
    const keys = await helpers.makeKeys();
    const pc = newConnection();
    const id = payload.room || newId();
    const entry = member(id, payload.name || '');
    if (!entry) { try { pc.close(); } catch (error) { /* gone */ } return null; }
    entry.keys = keys;
    entry.pc = pc;
    entry.state = 'answering';
    pc.ondatachannel = (event) => attachChannel(entry, event.channel);
    prepareInboundMedia(entry);

    await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIce(pc);

    entry.key = await helpers.deriveSessionKey(keys.privateKey, unb64(payload.key));
    const mine = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
    entry.safety = await helpers.safetyPhrase(mine, unb64(payload.key));

    if (!room.active) begin({ host: false });
    emit('member', snapshot());
    return {
      v: MESH_VERSION,
      role: 'answer',
      room: room.me.id,
      name: room.me.name,
      member: payload.member || id,
      broker: payload.broker || '',
      key: b64(mine),
      sdp: pc.localDescription.sdp,
    };
  }

  async function acceptAnswer(payload) {
    const entry = room.members.get(payload.member) || room.members.get(payload.room);
    if (!entry?.pc || !entry.keys) return false;
    const helpers = link();
    if (payload.name) entry.name = payload.name;
    /* The id the other side chose for itself wins, so both ends of the link
       agree on one name for it — a room where two members disagree about who
       is who cannot route anything. */
    if (payload.room && payload.room !== entry.id) {
      room.members.delete(entry.id);
      entry.id = payload.room;
      room.members.set(entry.id, entry);
    }
    await entry.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
    entry.key = await helpers.deriveSessionKey(entry.keys.privateKey, unb64(payload.key));
    const mine = new Uint8Array(await crypto.subtle.exportKey('raw', entry.keys.publicKey));
    entry.safety = await helpers.safetyPhrase(mine, unb64(payload.key));
    emit('member', snapshot());
    return true;
  }

  /* A connection somebody else built, joining the room.
   *
   * local-link.js does the introduction — the QR, the clipboard, the ECDH and
   * the safety phrase — and by the time its channel opens it holds everything
   * a member needs. Adopting that rather than making a second connection means
   * the room runs on the link the two people verified by eye, and there is one
   * pairing path in the app instead of two that must stay in step. */
  function adoptLink({ id, pc, channel, key, safety, host = false }) {
    if (!pc || !channel || !key) return null;
    if (!room.active) begin({ host });
    const entry = member(id, '');
    if (!entry) return null;
    /* Whoever we paired with is the host, unless we are. Held so a later
       claim to rename the room can be checked against it. */
    if (!host && !room.hostId) room.hostId = entry.id;
    entry.pc = pc;
    entry.key = key;
    entry.safety = safety || '';
    entry.state = channel.readyState === 'open' ? 'open' : 'connecting';
    prepareInboundMedia(entry);

    /* The channel already exists and already has handlers from local-link, so
       this takes over its message events rather than opening a second one —
       two readers on one channel would each see half the traffic. */
    entry.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onmessage = (event) => { receive(entry, event.data).catch(() => {}); };
    channel.onclose = () => dropMember(entry, { announce: true });

    emit('member', snapshot());
    /* Names are exchanged straight away so the roster is not a list of
       identifiers, and the host sends the newcomer everyone else. */
    sendTo(entry, { kind: 'hello', name: room.me.name, face: room.me.face }).then(() => {
      if (room.host) sendTo(entry, { kind: 'roster', members: rosterFor(entry.id) });
    }).catch(() => {});
    return entry;
  }

  /* ---- the wire ---------------------------------------------------------- */

  async function seal(entry, payload, isBinary = false) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = isBinary ? payload : enc.encode(JSON.stringify(payload));
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, entry.key, plain);
    const out = new Uint8Array(12 + sealed.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(sealed), 12);
    return out;
  }

  async function unseal(entry, data) {
    const view = new Uint8Array(data);
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: view.subarray(0, 12) }, entry.key, view.subarray(12)));
  }

  const canTalk = (entry) => Boolean(entry?.channel?.readyState === 'open' && entry.key);

  async function sendTo(entry, message) {
    if (!canTalk(entry)) return false;
    entry.channel.send(await seal(entry, { ...message, from: room.me.id, at: Date.now() }));
    return true;
  }

  /* Sealed once per link rather than once for the room. That costs an
     encryption per member, and it is what makes the host no more privileged
     than anyone else: there is no room key it could hold. */
  async function broadcast(message, exceptId = '') {
    const sent = [];
    for (const entry of room.members.values()) {
      if (entry.id === exceptId) continue;
      sent.push(sendTo(entry, message));
    }
    await Promise.all(sent);
    return sent.length;
  }

  const FRAME_MARKER = 0xf2;

  function chunkHeader(id, index) {
    const idBytes = enc.encode(id);
    const header = new Uint8Array(2 + idBytes.length + 3);
    header[0] = FRAME_MARKER;
    header[1] = idBytes.length;
    header.set(idBytes, 2);
    const at = 2 + idBytes.length;
    header[at] = index & 0xff;
    header[at + 1] = (index >> 8) & 0xff;
    header[at + 2] = (index >> 16) & 0xff;
    return header;
  }

  function readChunkHeader(plain) {
    if (plain[0] !== FRAME_MARKER) return null;
    const idLength = plain[1];
    const at = 2 + idLength;
    if (plain.length < at + 3) return null;
    return {
      id: dec.decode(plain.subarray(2, at)),
      index: plain[at] | (plain[at + 1] << 8) | (plain[at + 2] << 16),
      body: plain.subarray(at + 3),
    };
  }

  async function receive(entry, data) {
    if (!entry.key) return;
    let plain;
    try { plain = await unseal(entry, data); } catch (error) { return; }

    const chunk = readChunkHeader(plain);
    if (chunk) {
      const record = entry.incoming.get(chunk.id);
      /* An index outside the transfer it belongs to is either a bug or somebody
         growing this device's memory a chunk at a time under an announced total
         of one. The transfer decides which indices exist; the sender does not. */
      if (record && chunk.index >= 0 && chunk.index < record.total) {
        record.chunks.set(chunk.index, chunk.body);
        /* The sender watches a counter go up; the receiver used to watch
           nothing at all between "a file is coming" and the file arriving,
           which for a transfer with no size limit is minutes of a frozen line.
           Announced on a timer rather than per chunk: 16 KB pieces of a
           gigabyte is sixty thousand events, and repainting on each of them
           costs more than the transfer does. */
        const now = Date.now();
        if (now - (record.toldAt || 0) > 250 || record.chunks.size === record.total) {
          record.toldAt = now;
          emit('transfer', {
            id: chunk.id, name: record.name, from: entry.id,
            received: record.chunks.size, total: record.total,
            bytes: record.chunks.size * CHUNK_BYTES, size: record.size,
          });
        }
      }
      return;
    }
    let message;
    try { message = JSON.parse(dec.decode(plain)); } catch (error) { return; }
    await handle(entry, message);
  }

  /* ---- what a room says to itself ---------------------------------------- */

  async function handle(entry, message) {
    switch (message.kind) {
      case 'roster':
        /* The newcomer's list of everyone else. It offers to each of them, and
           asks the host to carry the offer — one scan, then the mesh completes
           itself. */
        for (const other of (Array.isArray(message.members) ? message.members : []).slice(0, MAX_MEMBERS)) {
          if (other.id === room.me.id || room.members.has(other.id)) continue;
          if (!member(other.id, other.name)) break;
          const offer = await createOffer({ to: other.id, broker: entry.id });
          await sendTo(entry, { kind: 'broker', to: other.id, payload: offer });
        }
        emit('member', snapshot());
        break;

      case 'hello':
        entry.name = String(message.name || '').slice(0, 40) || entry.name;
        entry.face = Array.from(String(message.face || '')).slice(0, 2).join('') || entry.face;
        /* The host owns the room's name and picture, so a newcomer is told
           them rather than guessing or showing a blank header. */
        if (room.host && (room.name || room.face)) {
          sendTo(entry, { kind: 'room-identity', name: room.name, face: room.face }).catch(() => {});
        }
        emit('member', snapshot());
        break;

      case 'room-identity':
        /* Only from the host. Anybody else claiming to rename the room is
           somebody renaming a room they do not own. */
        if (entry.id === room.hostId || room.members.size === 1) {
          room.name = String(message.name || '').slice(0, 40);
          room.face = Array.from(String(message.face || '')).slice(0, 2).join('');
          emit('room', snapshot());
        }
        break;

      case 'removed':
        /* The host has closed this room for us. Leaving is the honest response:
           the connection is about to go anyway, and staying in a roster nobody
           else has is worse than being told. */
        notify(message.dissolved
          ? 'اتاق توسط میزبان منحل شد.' : 'میزبان شما را از اتاق خارج کرد.',
          message.dissolved ? 'The host dissolved the room.' : 'The host removed you from the room.',
          'warning');
        leave().catch(() => {});
        break;

      case 'joined':
        /* Announced, not connected: the newcomer offers to us. If the room is
           full here the roster entry is simply not made, and the offer that
           follows is refused by the same rule. */
        member(message.id, message.name);
        emit('member', snapshot());
        break;

      case 'broker': {
        /* Carrying an introduction between two members. The host does this on
           behalf of people who cannot yet reach each other; it reads the
           envelope, never the conversation. */
        if (message.to === room.me.id) {
          const payload = message.payload;
          if (payload.role === 'offer') {
            const answer = await acceptOffer(payload);
            if (answer) await sendTo(entry, { kind: 'broker', to: payload.room, payload: answer });
          } else {
            await acceptAnswer(payload);
          }
        } else if (room.host) {
          const target = room.members.get(message.to);
          if (target) await sendTo(target, message);
        }
        break;
      }

      case 'text':
      case 'sticker':
      case 'rich':
        {
          const burn = Math.max(0, Math.min(36000, Number(message.burn) || 0));
          const landed = addMessage({
            ...message,
            text: message.kind === 'text' ? String(message.text || '').slice(0, MAX_TEXT) : message.text,
            url: message.kind === 'sticker' && SAFE_STICKER.test(String(message.url || ''))
              ? String(message.url) : '',
            hidden: Boolean(message.hidden),
            burn,
            from: entry.id, fromName: entry.name, direction: 'in',
          });
          if (burn) scheduleBurn(landed.id, burn);
        }
        break;

      case 'reaction':
        applyReaction(message);
        break;

      case 'poll-vote':
        applyVote(message, entry);
        break;

      case 'file-start': {
        /* Everything in this message was chosen by the other device. A `total`
           of 1e9 used to reach Array.from({ length: total }) at the end of the
           transfer and take the tab out with it, which any member of the room
           could do to any other with one message. A count is only meaningful as
           a positive integer, and more than a few in flight from one member at
           once is not a file transfer. */
        const total = Number(message.total);
        if (!Number.isSafeInteger(total) || total < 1) break;
        if (entry.incoming.size >= MAX_INCOMING_PER_MEMBER) break;
        entry.incoming.set(message.id, {
          ...message,
          total,
          size: Number.isFinite(Number(message.size)) ? Number(message.size) : 0,
          name: String(message.name || 'file'),
          chunks: new Map(),
        });
        emit('transfer', { id: message.id, name: message.name, from: entry.id, received: 0, total });
        break;
      }

      case 'file-end': {
        const record = entry.incoming.get(message.id);
        if (!record) break;
        entry.incoming.delete(message.id);
        /* Counted before anything is allocated: with the chunks that actually
           arrived doing the counting, a claimed total can no longer decide how
           much memory this device reserves. */
        if (record.chunks.size !== record.total) {
          notify(`${record.name} ناقص رسید.`, `${record.name} arrived incomplete.`, 'error');
          break;
        }
        const ordered = [];
        for (let i = 0; i < record.total; i += 1) {
          const part = record.chunks.get(i);
          if (!part) break;
          ordered.push(part);
        }
        if (ordered.length !== record.total) {
          notify(`${record.name} ناقص رسید.`, `${record.name} arrived incomplete.`, 'error');
          break;
        }
        const blob = new Blob(ordered, { type: record.mime || 'application/octet-stream' });
        addMessage({
          kind: 'file', direction: 'in', from: entry.id, fromName: entry.name,
          id: message.id, name: record.name, size: blob.size,
          url: URL.createObjectURL(blob), at: Date.now(),
        });
        break;
      }

      case 'call-offer':
      case 'call-answer':
      case 'call-ice':
      case 'call-state':
      case 'call-end':
        await handleCallSignal(entry, message);
        break;

      case 'bye':
        dropMember(entry, { announce: true });
        break;

      /* The host saw a link die and is telling the rest of the room, so nobody
         is left holding a member that stopped existing several minutes ago. */
      case 'bye-for': {
        const gone = room.members.get(message.id);
        if (gone) dropMember(gone);
        break;
      }

      default:
        break;
    }
  }

  /* ---- messages ---------------------------------------------------------- */

  function addMessage(entry) {
    /* reactions after the spread, not before: a member sets the id so everyone
       can agree which message a reaction belongs to, but the reaction tally is
       this device's own bookkeeping and arriving pre-filled from the wire is
       never anything but somebody writing into it. */
    const record = { id: entry.id || newId(), at: entry.at || Date.now(), ...entry, reactions: {} };
    room.messages.push(record);
    /* A room is a conversation happening now, not an archive — the transcript
       is never written to disk. Without a ceiling it grows for as long as the
       room is open while renderMessages rebuilds all of it on every arrival,
       so a long or noisy session gets slower with every message until it stops.
       Dropped file messages take their blob URLs with them, or the data stays
       in memory with nothing left pointing at it. */
    if (room.messages.length > MAX_TRANSCRIPT) {
      const dropped = room.messages.splice(0, room.messages.length - MAX_TRANSCRIPT);
      dropped.forEach((old) => {
        if (old.url && old.url.startsWith('blob:')) {
          try { URL.revokeObjectURL(old.url); } catch (error) { /* already gone */ }
        }
        room.polls.delete(old.id);
      });
    }
    if (record.kind === 'rich' && record.rich?.kind === 'poll') {
      room.polls.set(record.id, { ...record.rich, votes: {} });
    }
    emit('message', record);
    return record;
  }

  /* `hidden` and `burn` are the two things Secure Chat's composer can attach to
     a line of text, and they mean the same here: hidden is covered until the
     reader taps it, burn is a number of seconds after which it goes. Neither is
     a security claim — the message is on the other device and a determined
     reader can keep it. They are courtesies, and the room says so rather than
     implying more. */
  async function sendText(text, { hidden = false, burn = 0 } = {}) {
    const body = String(text || '').trim().slice(0, MAX_TEXT);
    if (!body) return null;
    const seconds = Math.max(0, Math.min(36000, Number(burn) || 0));
    const record = addMessage({ kind: 'text', direction: 'out', from: room.me.id,
      fromName: room.me.name, text: body, hidden: Boolean(hidden), burn: seconds });
    await broadcast({ kind: 'text', id: record.id, text: body, hidden: Boolean(hidden), burn: seconds });
    if (seconds) scheduleBurn(record.id, seconds);
    return record;
  }

  /* A timer that starts when the message lands, and takes the message out of
     the transcript on both sides when it runs out. */
  function scheduleBurn(id, seconds) {
    setTimeout(() => {
      const index = room.messages.findIndex((m) => m.id === id);
      if (index < 0) return;
      const [gone] = room.messages.splice(index, 1);
      if (gone?.url && gone.url.startsWith('blob:')) {
        try { URL.revokeObjectURL(gone.url); } catch (error) { /* already gone */ }
      }
      room.polls.delete(id);
      emit('message', { burned: id });
    }, seconds * 1000);
  }

  async function sendSticker({ emoji = '', url = '', pack = '' } = {}) {
    const safe = SAFE_STICKER.test(String(url || '')) ? String(url) : '';
    const record = addMessage({ kind: 'sticker', direction: 'out', from: room.me.id,
      fromName: room.me.name, emoji, url: safe, pack });
    await broadcast({ kind: 'sticker', id: record.id, emoji, url: safe, pack });
    return record;
  }

  /* Polls, location and contact cards travel as `rich`, the same shape Secure
     Chat already uses (js/chat/05-structured-messages.js), so the two agree on
     what a poll is rather than each inventing one. */
  async function sendRich(rich) {
    const record = addMessage({ kind: 'rich', direction: 'out', from: room.me.id,
      fromName: room.me.name, rich });
    await broadcast({ kind: 'rich', id: record.id, rich });
    return record;
  }

  const sendPoll = (question, options) => sendRich({
    kind: 'poll',
    question: String(question || '').slice(0, 200),
    options: (options || []).map((o) => String(o).slice(0, 80)).slice(0, 10),
  });

  /* The two structured cards the composer offers, in the shape
     js/chat/05-structured-messages.js already uses, so the two parts of the app
     agree on what a location and a contact card are. */
  async function sendLocation() {
    if (!navigator.geolocation) throw new Error('no geolocation');
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject,
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    });
    const { latitude, longitude, accuracy } = position.coords;
    return sendRich({
      kind: 'location',
      lat: Number(latitude.toFixed(6)),
      lng: Number(longitude.toFixed(6)),
      accuracy: Math.round(accuracy || 0),
      at: new Date().toISOString(),
    });
  }

  async function sendContact({ name = '', fingerprint = '', peerId = '' } = {}) {
    const clean = String(name || '').slice(0, 80);
    if (!clean) return null;
    return sendRich({
      kind: 'contact',
      name: clean,
      fingerprint: String(fingerprint || '').slice(0, 128),
      peerId: String(peerId || '').slice(0, 128),
    });
  }

  async function vote(messageId, optionIndex) {
    const poll = room.polls.get(messageId);
    if (!poll) return false;
    poll.votes[room.me.id] = optionIndex;
    emit('poll', { id: messageId, poll });
    await broadcast({ kind: 'poll-vote', id: messageId, option: optionIndex });
    return true;
  }

  function applyVote(message, entry) {
    const poll = room.polls.get(message.id);
    if (!poll) return;
    poll.votes[entry.id] = message.option;
    emit('poll', { id: message.id, poll });
  }

  async function react(messageId, emoji) {
    const record = room.messages.find((m) => m.id === messageId);
    if (!record) return false;
    record.reactions[emoji] = record.reactions[emoji] || new Set();
    record.reactions[emoji].add(room.me.id);
    emit('message', record);
    await broadcast({ kind: 'reaction', id: messageId, emoji });
    return true;
  }

  function applyReaction(message) {
    const record = room.messages.find((m) => m.id === message.id);
    if (!record) return;
    record.reactions[message.emoji] = record.reactions[message.emoji] || new Set();
    record.reactions[message.emoji].add(message.from);
    emit('message', record);
  }

  /* ---- files ------------------------------------------------------------- */

  /* No size ceiling. On a LAN the transfer is between two devices on the same
     switch, and a limit copied from a relay's disk budget makes no sense here.
     What is true is that a large file is the room's bandwidth while it runs,
     so above LARGE_FILE_WARN the sender is told rather than stopped. */
  function describeFileCost(file) {
    if (!file || file.size < LARGE_FILE_WARN) return null;
    const mb = Math.round(file.size / 1024 / 1024);
    const peers = Math.max(1, room.members.size);
    return {
      bytes: file.size,
      peers,
      fa: `${mb} مگابایت برای ${peers} نفر فرستاده می‌شود. تا پایان کار، بیشتر پهنای باند شبکهٔ محلی را می‌گیرد و تماس یا پیام دیگران کند می‌شود.`,
      en: `${mb} MB going to ${peers} ${peers === 1 ? 'person' : 'people'}. Until it finishes it will take most of the local network, and calls or messages from others will slow down.`,
    };
  }

  async function sendFile(file, { onProgress } = {}) {
    if (!file) return false;
    const targets = Array.from(room.members.values()).filter(canTalk);
    if (!targets.length) return false;
    const id = newId();
    const total = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));

    for (const entry of targets) {
      await sendTo(entry, { kind: 'file-start', id, name: file.name, size: file.size,
        mime: file.type, total });
    }

    for (let index = 0; index < total; index += 1) {
      const slice = new Uint8Array(
        await file.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).arrayBuffer());
      const header = chunkHeader(id, index);
      const framed = new Uint8Array(header.length + slice.length);
      framed.set(header, 0);
      framed.set(slice, header.length);
      for (const entry of targets) {
        if (!canTalk(entry)) continue;
        /* Backpressure per link: a data channel written to faster than it
           drains does not error, it buffers until the implementation closes
           it — which is how a large file stalls with nothing in the console. */
        while (entry.channel.bufferedAmount > BUFFER_CEILING) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          if (!canTalk(entry)) break;
        }
        if (canTalk(entry)) entry.channel.send(await seal(entry, framed, true));
      }
      onProgress?.({ index: index + 1, total, id });
    }

    for (const entry of targets) await sendTo(entry, { kind: 'file-end', id });
    addMessage({ kind: 'file', direction: 'out', from: room.me.id, fromName: room.me.name,
      id, name: file.name, size: file.size });
    return true;
  }

  /* ---- calls ------------------------------------------------------------- */

  function prepareInboundMedia(entry) {
    entry.pc.ontrack = (event) => {
      entry.stream = event.streams[0] || new MediaStream([event.track]);
      entry.videoOn = entry.stream.getVideoTracks().length > 0;
      entry.audioOn = entry.stream.getAudioTracks().length > 0;
      emit('stream', { id: entry.id, stream: entry.stream });
      emit('member', snapshot());
    };
    /* Renegotiation is how a call starts on an already-open link: tracks are
       added to the existing connection rather than a second one being built,
       so the data channel and the media share one path through the network. */
    entry.pc.onnegotiationneeded = async () => {
      if (entry.state !== 'open' || !entry.negotiator) return;
      try {
        await entry.pc.setLocalDescription(await entry.pc.createOffer());
        await waitForIce(entry.pc, 3000);
        await sendTo(entry, { kind: 'call-offer', sdp: entry.pc.localDescription.sdp });
      } catch (error) { /* the other side will retry */ }
    };
  }

  function callAdvice(video) {
    const cameras = video ? room.members.size + 1 : 0;
    if (!video || cameras <= VIDEO_COMFORT) return null;
    return {
      cameras,
      fa: `${cameras} دوربین در یک شبکهٔ نظیربه‌نظیر یعنی هر دستگاه ${cameras - 1} ویدئو می‌فرستد و ${cameras - 1} تا می‌گیرد. احتمالاً کند می‌شود؛ تماس صوتی حدود صدم این پهنای باند را می‌خواهد.`,
      en: `${cameras} cameras in a peer-to-peer room means every device sends ${cameras - 1} videos and receives ${cameras - 1}. It will probably struggle; an audio call costs about a hundredth of that.`,
    };
  }

  async function startCall({ video = false } = {}) {
    if (room.call) return room.call;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    room.call = { video, stream, startedAt: Date.now() };
    /* Per member, because one connection that has quietly closed should cost
       that one person the call and not everybody. Thrown out of the loop, it
       left room.call set and the microphone live while the room reported that
       the microphone was unavailable — the light stays on and the message says
       the opposite. */
    let reached = 0;
    for (const entry of room.members.values()) {
      if (!canTalk(entry)) continue;
      try {
        stream.getTracks().forEach((track) => entry.pc.addTrack(track, stream));
        entry.negotiator = true;
        reached += 1;
      } catch (error) {
        entry.negotiator = false;
      }
    }
    if (!reached) {
      /* Nobody could be reached, so there is no call — and no reason to keep
         holding the camera while pretending otherwise. */
      stream.getTracks().forEach((track) => { try { track.stop(); } catch (error) { /* gone */ } });
      room.call = null;
      emit('call', { active: false });
      return null;
    }
    await broadcast({ kind: 'call-state', video, active: true });
    emit('call', { active: true, video });
    return room.call;
  }

  async function handleCallSignal(entry, message) {
    if (message.kind === 'call-offer') {
      await entry.pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
      /* Answering a call the room started: if media is already flowing from
         here it is reused, otherwise this side answers audio-only until the
         person chooses to turn a camera on. */
      if (room.call?.stream) {
        const senders = entry.pc.getSenders();
        room.call.stream.getTracks().forEach((track) => {
          if (!senders.some((sender) => sender.track === track)) entry.pc.addTrack(track, room.call.stream);
        });
      }
      await entry.pc.setLocalDescription(await entry.pc.createAnswer());
      await waitForIce(entry.pc, 3000);
      await sendTo(entry, { kind: 'call-answer', sdp: entry.pc.localDescription.sdp });
    } else if (message.kind === 'call-answer') {
      if (entry.pc.signalingState !== 'stable') {
        await entry.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
      }
    } else if (message.kind === 'call-state') {
      entry.videoOn = Boolean(message.video);
      /* Somebody in the room started a call, and this side has to be told so
         it can be asked whether to join.
       *
         Without this the call was one-directional and looked broken from every
         seat but the caller's: the offer that follows was answered, so their
         audio arrived here, but this device never entered a call, never
         captured its own microphone and never sent anything back. The caller
         heard silence, this side had no call to hang up, and both people
         reported that calls do not work. */
      if (message.active && !room.call) {
        room.ringing = { from: entry.id, name: entry.name, video: Boolean(message.video), at: Date.now() };
        emit('ringing', { ...room.ringing });
      }
      if (message.active === false) {
        room.ringing = null;
        emit('ringing', null);
      }
      emit('member', snapshot());
    } else if (message.kind === 'call-end') {
      entry.stream = null;
      entry.videoOn = false;
      entry.audioOn = false;
      /* The last other person hung up, so there is no call left to be in.
       *
         Staying in it looked harmless and was not: room.call was still set, so
         startCall returned the old call instead of making a new one, announced
         nothing, and the next call from this device never rang anywhere. The
         microphone also stayed live for a call with nobody in it. */
      const stillTalking = Array.from(room.members.values())
        .some((m) => m.stream && m.stream.getTracks().length);
      if (room.call && !stillTalking) {
        endCall().catch(() => {});
      } else {
        emit('member', snapshot());
      }
    }
  }

  /* Joining a call somebody else started.
   *
   * The same work startCall does, minus announcing a new call: capture, add the
   * tracks to every open link, and let renegotiation carry them. `negotiator`
   * is set here too, because whoever adds tracks is the side that has to make
   * the next offer. */
  async function joinCall({ video = false } = {}) {
    if (room.call) return room.call;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    room.call = { video, stream, startedAt: Date.now(), joined: true };
    room.ringing = null;
    let reached = 0;
    for (const entry of room.members.values()) {
      if (!canTalk(entry)) continue;
      try {
        stream.getTracks().forEach((track) => entry.pc.addTrack(track, stream));
        entry.negotiator = true;
        reached += 1;
      } catch (error) { entry.negotiator = false; }
    }
    if (!reached) {
      stream.getTracks().forEach((track) => { try { track.stop(); } catch (error) { /* gone */ } });
      room.call = null;
      emit('call', { active: false });
      return null;
    }
    await broadcast({ kind: 'call-state', video, active: true });
    emit('ringing', null);
    emit('call', { active: true, video });
    return room.call;
  }

  /* Removing one person, and closing the room for everyone.
   *
   * Both are the host's to do — it is the host that every other member paired
   * with — and both tell the people affected before the connection goes, so a
   * room that closes does not look like a network that dropped. */
  async function removeMember(id) {
    const entry = room.members.get(id);
    if (!entry || !room.host) return false;
    await sendTo(entry, { kind: 'removed', dissolved: false }).catch(() => {});
    dropMember(entry, { announce: true });
    return true;
  }

  async function dissolveRoom() {
    if (!room.host) return false;
    await broadcast({ kind: 'removed', dissolved: true }).catch(() => {});
    await leave();
    return true;
  }

  function declineCall() {
    room.ringing = null;
    emit('ringing', null);
  }

  async function endCall() {
    room.ringing = null;
    if (!room.call) return;
    room.call.stream.getTracks().forEach((track) => { try { track.stop(); } catch (error) { /* gone */ } });
    for (const entry of room.members.values()) {
      entry.negotiator = false;
      entry.pc?.getSenders?.().forEach((sender) => {
        try { if (sender.track) entry.pc.removeTrack(sender); } catch (error) { /* gone */ }
      });
      /* Their media as well as ours. Removing only our own senders told the
         room we had hung up while this device went on holding every incoming
         stream — the roster kept showing their cameras lit, and the tracks
         stayed alive with nothing drawing them. Leaving a call means leaving
         it in both directions. */
      entry.stream = null;
      entry.videoOn = false;
      entry.audioOn = false;
    }
    await broadcast({ kind: 'call-end' });
    room.call = null;
    emit('call', { active: false });
  }

  async function setMuted(muted) {
    room.call?.stream.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    emit('call', { active: Boolean(room.call), muted });
  }

  async function setCameraOn(on) {
    if (!room.call) return false;
    const existing = room.call.stream.getVideoTracks()[0];
    if (existing) {
      existing.enabled = on;
    } else if (on) {
      const extra = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = extra.getVideoTracks()[0];
      room.call.stream.addTrack(track);
      for (const entry of room.members.values()) {
        if (canTalk(entry)) entry.pc.addTrack(track, room.call.stream);
      }
      room.call.video = true;
    }
    await broadcast({ kind: 'call-state', video: on, active: true });
    emit('call', { active: true, video: on });
    return true;
  }

  /* ---- leaving ----------------------------------------------------------- */

  async function leave() {
    await broadcast({ kind: 'bye' }).catch(() => {});
    if (room.call) await endCall().catch(() => {});
    /* Cleared first, so the close events these produce find nothing left to
       drop and nothing to announce — leaving is not news the leaver reports
       sixteen more times on its way out. */
    const departing = Array.from(room.members.values());
    room.members.clear();
    departing.forEach((entry) => {
      try { entry.channel?.close(); } catch (error) { /* gone */ }
      try { entry.pc?.close(); } catch (error) { /* gone */ }
    });
    forgetRoom();
    room.active = false;
    room.host = false;
    emit('room', snapshot());
  }

  global.PoorijaLocalMesh = {
    MESH_VERSION, MAX_MEMBERS, VIDEO_COMFORT, LARGE_FILE_WARN,
    MAX_TRANSCRIPT, MAX_INCOMING_PER_MEMBER, CHUNK_BYTES, MAX_TEXT,
    begin, snapshot, on, leave, adoptLink, removeMember, dissolveRoom,
    readIdentity, writeIdentity,
    createOffer, acceptOffer, acceptAnswer,
    sendText, sendSticker, sendRich, sendPoll, vote, react, sendLocation, sendContact,
    sendFile, describeFileCost,
    startCall, joinCall, declineCall, endCall, setMuted, setCameraOn, callAdvice,
    room,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
