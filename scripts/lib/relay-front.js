/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A front door: one relay answering at an address of its own for another
 * relay that people cannot reach directly.
 *
 * Measured in October 2026: from outside Iran, every TLS connection to the
 * relay inside Iran completes its handshake and then receives nothing, while
 * that relay can still open TLS connections outward — which is how the
 * transit link between the two relays stays up (the Iranian one dials). So
 * the way in is the way out: a client outside connects to the outside relay
 * at a separate address (CHAT_FRONTS, behind its own nginx port), and each
 * connection it makes is carried as a stream over the transit link the inner
 * relay already holds open, to the inner relay's own server. To the client it
 * is the inner relay — the same identity, the same mailboxes, the same TURN —
 * and the client proves that before using it (the mirror proof, which only
 * the holder of the inner relay's key can answer).
 *
 * What each side can see: the outer relay terminates the client's TLS, so it
 * sees the relay protocol of the people using the door — what the inner relay
 * sees, and no message content, which is end-to-end encrypted. Between the
 * two relays the bytes travel inside the transit link's own encryption, on a
 * connection authenticated by both relays' identities. The inner relay
 * accepts streams only from the relays it names (CHAT_FRONT_DOORS) and only
 * ever connects them to its own local port.
 *
 * Streams ride the link as frames { kind: 'front', op, id, d }:
 *   open  — the outer relay accepted a connection; the inner one connects to
 *           its own server;
 *   data  — bytes, base64, either way;
 *   end   — one side finished writing;
 *   close — the stream is gone (either side, or the link dropped).
 * A full link buffer pauses the socket feeding it, and it resumes as the
 * buffer drains, so a large upload does not pile up in memory.
 */
'use strict';

const net = require('net');
const crypto = require('crypto');

const PAUSE_ABOVE_BYTES = 2 * 1024 * 1024;
const RESUME_BELOW_BYTES = 512 * 1024;
const MAX_STREAMS_PER_LINK = 512;
const FLOW_CHECK_MS = 40;

/**
 * @param {object} options
 * @param {object} options.relayPeers  createRelayPeers() — linkFor(peerId)
 * @param {Array<{relayId:string, origin:string, port:number}>} options.fronts
 *        relays this one answers for, the public address it answers at, and
 *        the local port nginx hands those connections to
 * @param {string[]} options.doors  relays allowed to open streams into this one
 * @param {number} options.localPort  this relay's own server port
 * @param {string[]} options.listenHosts  where the front ports listen
 * @param {string[]} options.ownOrigins  this relay's public addresses, told to
 *        the relays that front for it so they can name it to clients
 */
function createFrontDoor({ relayPeers, fronts = [], doors = [], localPort, listenHosts = ['127.0.0.1'], ownOrigins = [], log = console } = {}) {
  const doorSet = new Set(doors.map((id) => String(id).toLowerCase()));
  const frontByRelay = new Map(fronts.map((front) => [front.relayId, front]));
  const streams = new Map(); // id -> { socket, link, paused }
  const namesByRelay = new Map(); // relayId -> [origins], as the inner relay told us
  const servers = [];

  function streamsOn(link) {
    let count = 0;
    for (const stream of streams.values()) if (stream.link === link) count += 1;
    return count;
  }

  function drop(id, notify = true) {
    const stream = streams.get(id);
    if (!stream) return;
    streams.delete(id);
    if (notify) stream.link.send({ kind: 'front', op: 'close', id });
    try { stream.socket.destroy(); } catch (_error) { /* gone */ }
  }

  /* Pipes one socket into the link, pausing it while the link is backed up. */
  function feed(id, socket, link) {
    socket.on('data', (chunk) => {
      const stream = streams.get(id);
      if (!stream) return;
      if (!link.send({ kind: 'front', op: 'data', id, d: chunk.toString('base64') })) {
        /* The link refused outright (its hard ceiling): this stream cannot
           be carried without losing bytes, so it ends rather than corrupts. */
        drop(id);
        return;
      }
      if (!stream.paused && link.bufferedBytes() > PAUSE_ABOVE_BYTES) {
        stream.paused = true;
        socket.pause();
      }
    });
    socket.on('end', () => { if (streams.has(id)) link.send({ kind: 'front', op: 'end', id }); });
    socket.on('close', () => drop(id));
    socket.on('error', () => drop(id));
  }

  const flow = setInterval(() => {
    for (const stream of streams.values()) {
      if (stream.paused && stream.link.bufferedBytes() < RESUME_BELOW_BYTES) {
        stream.paused = false;
        stream.socket.resume();
      }
    }
  }, FLOW_CHECK_MS);
  flow.unref?.();

  /* ---- the outer relay: a public address for a relay behind it ---------- */

  function acceptFor(front, socket) {
    const link = relayPeers.linkFor(front.relayId);
    if (!link || streamsOn(link) >= MAX_STREAMS_PER_LINK) {
      socket.destroy();
      return;
    }
    const id = crypto.randomBytes(8).toString('hex');
    streams.set(id, { socket, link, paused: false });
    socket.setNoDelay?.(true);
    link.send({ kind: 'front', op: 'open', id });
    feed(id, socket, link);
  }

  function listen() {
    for (const front of fronts) {
      for (const host of listenHosts) {
        const server = net.createServer((socket) => acceptFor(front, socket));
        server.on('error', (error) => log.warn?.(`[Front] cannot listen on ${host}:${front.port} for ${front.relayId.slice(0, 12)}: ${error.code || error.message}`));
        server.listen(front.port, host, () => log.log?.(`[Front] answering at ${front.origin} for ${front.relayId.slice(0, 12)} (local ${host}:${front.port})`));
        servers.push(server);
      }
    }
  }

  /* ---- the inner relay: streams from a named door, to its own server ---- */

  function openLocal(id, link) {
    if (streamsOn(link) >= MAX_STREAMS_PER_LINK) {
      link.send({ kind: 'front', op: 'close', id });
      return;
    }
    const socket = net.connect(localPort, '127.0.0.1');
    socket.setNoDelay?.(true);
    streams.set(id, { socket, link, paused: false });
    feed(id, socket, link);
  }

  /** True when the frame was a front-door frame (handled or refused). */
  function onFrame(payload, link) {
    if (payload?.kind !== 'front') return false;
    const id = String(payload.id || '');
    const op = String(payload.op || '');
    if (op === 'names') {
      /* The inner relay naming its own public addresses. Only kept for a
         relay this one actually fronts. */
      if (frontByRelay.has(link.peerId) && Array.isArray(payload.origins)) {
        namesByRelay.set(link.peerId, payload.origins.map((origin) => String(origin)).filter((origin) => /^https?:\/\/[^/\s]+$/i.test(origin)).slice(0, 8));
      }
      return true;
    }
    if (!/^[a-f0-9]{16}$/.test(id)) return true;
    const stream = streams.get(id);
    if (op === 'open') {
      /* Only a door this relay named may open anything here, and a stream id
         already in use is not reopened. */
      if (!doorSet.has(link.peerId) || stream) {
        link.send({ kind: 'front', op: 'close', id });
        return true;
      }
      openLocal(id, link);
      return true;
    }
    if (!stream || stream.link !== link) return true;
    if (op === 'data') {
      try { stream.socket.write(Buffer.from(String(payload.d || ''), 'base64')); } catch (_error) { drop(id); }
    } else if (op === 'end') {
      try { stream.socket.end(); } catch (_error) { drop(id); }
    } else if (op === 'close') {
      drop(id, false);
    }
    return true;
  }

  function linkUp(link) {
    /* The inner side tells a door relay its own addresses, so the door can
       name it to clients who only know those addresses. */
    if (doorSet.has(link.peerId) && ownOrigins.length) {
      link.send({ kind: 'front', op: 'names', origins: ownOrigins });
    }
  }

  function linkDown(link) {
    for (const [id, stream] of streams) {
      if (stream.link === link) drop(id, false);
    }
  }

  /** What GET /relay-fronts says: the relays this one answers for. */
  function listing() {
    return fronts.map((front) => ({
      relayId: front.relayId,
      origin: front.origin,
      names: namesByRelay.get(front.relayId) || [],
      up: Boolean(relayPeers.linkFor(front.relayId)),
    }));
  }

  function close() {
    clearInterval(flow);
    for (const server of servers) { try { server.close(); } catch (_error) { /* gone */ } }
    for (const id of Array.from(streams.keys())) drop(id, false);
  }

  return { listen, onFrame, linkUp, linkDown, listing, close, streamCount: () => streams.size };
}

/* CHAT_FRONTS: `<relay id>@<public origin>`, comma or space separated. Each
   gets a local port from CHAT_FRONT_PORT upward, in order. */
function parseFronts(value, firstPort) {
  const out = [];
  let port = Number(firstPort) || 9011;
  for (const entry of String(value || '').split(/[,\s]+/)) {
    const at = entry.indexOf('@');
    if (at < 0) continue;
    const relayId = entry.slice(0, at).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(relayId)) continue;
    let origin = '';
    try {
      const parsed = new URL(entry.slice(at + 1));
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') origin = parsed.origin;
    } catch (_error) { /* not an address */ }
    if (!origin || out.some((front) => front.relayId === relayId)) continue;
    out.push({ relayId, origin, port });
    port += 1;
  }
  return out;
}

function parseDoors(value) {
  return String(value || '').split(/[,\s]+/).map((id) => id.trim().toLowerCase()).filter((id) => /^[a-f0-9]{64}$/.test(id));
}

module.exports = { createFrontDoor, parseFronts, parseDoors };
