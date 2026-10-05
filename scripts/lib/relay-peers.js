/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Keeping the links between relays up, and deciding who may have one.
 *
 * The handshake itself is in relay-link.js; this is the part that dials,
 * redials, and answers. Two rules shape it:
 *
 *   Fail closed. A relay carries transit for nobody until an operator names
 *   who it will carry for. An open transit relay is an open relay: anyone
 *   could push traffic through it at somebody else's expense, and the
 *   two-jurisdiction arrangement this exists for is between operators who
 *   have already agreed with each other.
 *
 *   Name relays by identity, never by address. The allowlist holds ids, the
 *   dialler checks the id it reached against the id it meant to reach, and
 *   the address is only ever how to get there. A hostname is whoever holds
 *   the hostname today, which is what relay identities were added to fix.
 */
const http = require('node:http');
const https = require('node:https');
const {
  startLink, answerLink, finishLink, confirmLink, linkCipher, idForKey,
} = require('./relay-link.js');

const DIAL_TIMEOUT_MS = 15000;
const HANDSHAKE_TIMEOUT_MS = 10000;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 60000;
const HEARTBEAT_MS = 25000;
/* How many heartbeats a link may hear nothing back on before it is declared
   dead. Two is about a minute of silence — long enough that a busy relay
   answers the odd ping late, short enough that a link black-holed by a NAT
   retable or a paused machine is redialled while the envelopes it was asked
   to carry are still worth delivering. */
const MISSED_PONGS_LIMIT = 2;
/* A frame may be up to 24 MB, so the buffer has to be allowed a few of those
   before it is judged stuck — but it must be allowed to stop somewhere. A far
   end that stopped reading turns an unbounded buffer into an unbounded
   liability: every transit envelope this relay accepted would sit in memory
   awaiting a drain that is never coming, and the 60-second wait would expire
   client-side before the socket ever said no. */
const LINK_BUFFER_LIMIT_BYTES = 16 * 1024 * 1024;

/* The peers an operator named, as `<relay id>@<origin>` — or as a bare id,
   which means "accept a link from this relay but never dial it". That is the
   setting for a relay behind a firewall: it dials out, and the far side only
   has to recognise it.
   An entry that is not a relay fingerprint is dropped rather than
   half-accepted. A typo in this setting must not widen who may connect, and
   an address with no id would be naming a relay by its hostname, which is the
   thing relay identities exist to stop. */
function parseTransitPeers(value) {
  const seen = new Map();
  for (const entry of String(value || '').split(/[,\s]+/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf('@');
    const id = (at < 0 ? trimmed : trimmed.slice(0, at)).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(id)) continue;
    let origin = '';
    if (at >= 0) {
      try {
        const parsed = new URL(trimmed.slice(at + 1));
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') origin = parsed.origin;
      } catch (_error) { origin = ''; }
    }
    /* Last one wins, so a later line can correct an earlier address. */
    seen.set(id, { id, origin });
  }
  return Array.from(seen.values());
}

/** Just the ids, which is what the allowlist check needs. */
function parsePeerAllowlist(value) {
  return parseTransitPeers(value).map((peer) => peer.id);
}

/* Reads another relay's published identity.
 *
 * Written against node:http rather than fetch for one reason: the certificate
 * decision has to be the SAME one the WebSocket dial makes. An operator with
 * a self-signed certificate between their own two relays who could fetch the
 * identity but not open the link — or the reverse — would have a link that
 * half works, and the half that works is the one that proves nothing.
 *
 * Turning the check off is not as bad as it sounds here and is still not the
 * default: the link is authenticated by relay identity whatever the transport
 * says, so the certificate is defence in depth rather than the control. */
function makeIdentityFetcher({ verifyTls = true, timeoutMs = 8000 } = {}) {
  return function fetchIdentity(origin) {
    return new Promise((resolve, reject) => {
      let url;
      try { url = new URL('/relay-identity', origin); } catch (error) { return reject(error); }
      const agent = url.protocol === 'https:' ? https : http;
      const request = agent.get(url, { rejectUnauthorized: verifyTls, timeout: timeoutMs }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          return reject(new Error(`relay identity answered ${response.statusCode}`));
        }
        let body = '';
        response.setEncoding('utf8');
        /* A relay that is not one, or one that is being impersonated by
           something that answers everything, should not be able to make this
           allocate without bound. */
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > 8192) { request.destroy(new Error('relay identity is implausibly large')); }
        });
        response.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
        });
      });
      request.on('timeout', () => request.destroy(new Error('relay identity timed out')));
      request.on('error', reject);
    });
  };
}

function backoffFor(attempt) {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * (2 ** Math.min(attempt, 10)));
  /* Jitter, so two relays that lost the same network do not come back in
     lockstep and beat on each other. */
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

/* `deps` is everything that is not pure: the socket implementation, a way to
   fetch another relay's identity, the clock, and the log. Passing them in is
   what lets the whole of this be driven from a test without a network. */
function createRelayPeers({
  identity,
  privateKey,
  pqPrivateKey = null,
  allowlist = [],
  WebSocketImpl,
  fetchIdentity,
  verifyTls = true,
  log = console,
  onFrame = () => {},
  onLinkUp = () => {},
  onLinkDown = () => {},
  onChange = null,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const allowed = new Set(allowlist);
  const outbound = new Map();   // peerId -> link
  const inbound = new Map();    // peerId -> Set(link)
  const dialling = new Map();   // peerId -> { attempt, timer }
  /* Where each peer was last dialled. The allowlist this object is built with
     holds ids and nothing else -- the address arrives with the dial -- and a
     link that drops has to be remade at the same address, so it is kept here.
     A peer that is answer-only never appears in it, which is correct: there is
     no address to go back to. */
  const dialOrigins = new Map(); // peerId -> origin
  let closed = false;

  const enabled = () => allowed.size > 0;
  const mayLinkWith = (peerId) => allowed.has(String(peerId || '').toLowerCase());

  function register(link) {
    if (link.role === 'dialer') {
      outbound.set(link.peerId, link);
    } else {
      if (!inbound.has(link.peerId)) inbound.set(link.peerId, new Set());
      inbound.get(link.peerId).add(link);
    }
    onLinkUp(link);
  }

  function forget(link) {
    if (link.role === 'dialer') {
      if (outbound.get(link.peerId) === link) outbound.delete(link.peerId);
      /* And dialled again.
       *
       * Nothing used to do this. dial() is called once at start-up, and the only
       * retry was inside its own catch -- so it kept trying while it kept
       * FAILING, and a link that succeeded and then dropped was never remade.
       * The other relay restarting for a deployment was enough: the far side
       * closed the socket, this side forgot it, and transit stayed down until
       * somebody restarted THIS relay too. Both servers being redeployed in turn
       * is what hid it, because the second restart ran the start-up dial again.
       *
       * The backoff starts at zero rather than continuing from where the last
       * failure left it: a link that was up is evidence the address works, so
       * the first retry belongs inside a second, not a minute. */
      const origin = dialOrigins.get(link.peerId);
      if (!closed && origin) scheduleDial(link.peerId, origin, 0);
    } else {
      inbound.get(link.peerId)?.delete(link);
      if (!inbound.get(link.peerId)?.size) inbound.delete(link.peerId);
    }
    onLinkDown(link);
  }

  /* An outbound link is preferred because this relay knows it dialled the
     right identity; an inbound one is used when there is no other, which is
     what lets the far side be the one behind the firewall. */
  function linkFor(peerId) {
    const out = outbound.get(String(peerId || ''));
    if (out?.isOpen()) return out;
    for (const link of inbound.get(String(peerId || '')) || []) {
      if (link.isOpen()) return link;
    }
    return null;
  }

  function wrap(socket, peerId, key, role, hybrid = false) {
    const cipher = linkCipher(key, role);
    let alive = true;
    const link = {
      peerId,
      role,
      /* Whether the post-quantum half was in play. Reported rather than
         assumed: a link that quietly fell back to classical looks identical
         to one that never had the option. */
      hybrid,
      openedAt: now(),
      isOpen: () => alive && socket.readyState === 1,
      send(payload) {
        if (!link.isOpen()) return false;
        /* The client sockets have a buffered-amount guard that cuts a peer
           who never reads; a link deserves the same mercy in both directions.
           Crossing the line closes the link rather than dropping the frame,
           so the far end's redial — and ours — starts from a known state. */
        if (socket.bufferedAmount > LINK_BUFFER_LIMIT_BYTES) {
          log.warn?.(`[Transit] link with ${peerId.slice(0, 12)} stopped draining; closing it`);
          link.close('send buffer full');
          return false;
        }
        socket.send(JSON.stringify({ t: 'f', ...cipher.seal(payload) }));
        return true;
      },
      close(reason = '') {
        alive = false;
        try { socket.close(1000, String(reason).slice(0, 100)); } catch (_error) { /* already gone */ }
      },
    };
    /* A ping proves nothing about the far end until a pong has failed to come
       back. The heartbeat used to fire pings into whatever the socket's state
       said was open, and a link lost without a FIN — a NAT table expiring, a
       cable pulled, a VM paused — stays readyState 1 for as long as TCP takes
       to notice, which can be an hour. Everything above kept working: the
       link answered as up, envelopes were handed to it, and each one sat in
       the send buffer until its client-side wait expired. Now two heartbeats
       without a pong terminate the socket, which is the close event the
       redial path has been waiting for all along. */
    let missedPongs = 0;
    socket.on('pong', () => { missedPongs = 0; });
    const heartbeat = setInterval(() => {
      if (!link.isOpen()) return;
      if (missedPongs >= MISSED_PONGS_LIMIT) {
        log.warn?.(`[Transit] link with ${peerId.slice(0, 12)} stopped answering pings; dropping it`);
        try { socket.terminate(); } catch (_error) { /* the close handler deals with it */ }
        return;
      }
      missedPongs += 1;
      try { socket.ping(); } catch (_error) { /* the close handler deals with it */ }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    socket.on('message', (raw) => {
      let frame;
      try { frame = JSON.parse(raw.toString()); } catch (_error) { return; }
      if (frame?.t !== 'f') return;
      let payload;
      try {
        payload = cipher.open(frame);
      } catch (error) {
        /* A frame that does not open is either a machine in the middle or a
           broken peer. Neither is worth staying connected to, and answering
           differently for the two would say which it was. */
        log.warn?.(`[Transit] dropping link with ${peerId.slice(0, 12)}: ${error.message}`);
        link.close('bad frame');
        return;
      }
      try {
        onFrame(payload, link);
      } catch (error) {
        log.warn?.(`[Transit] frame handler failed: ${error?.message || error}`);
      }
    });
    socket.on('close', () => { alive = false; clearInterval(heartbeat); forget(link); });
    socket.on('error', () => { alive = false; });
    return link;
  }

  /* ---- answering ----------------------------------------------------- */

  /** Drives one inbound socket through the handshake. The socket is closed
      unless it gets all the way to a confirmed key. */
  function accept(socket) {
    let state = null;
    let settled = false;
    const refuse = (code, reason) => {
      settled = true;
      try { socket.close(code, reason); } catch (_error) { /* already gone */ }
    };
    const timer = setTimer(() => {
      if (!settled) refuse(1002, 'handshake timed out');
    }, HANDSHAKE_TIMEOUT_MS);
    timer.unref?.();

    socket.on('message', (raw) => {
      if (settled) return;
      let message;
      try { message = JSON.parse(raw.toString()); } catch (_error) { return refuse(1003, 'unreadable'); }
      try {
        if (!state && message?.t === 'hello') {
          if (!enabled()) return refuse(1008, 'transit is not enabled here');
          /* The claim is checked before the work, not after. answerLink proves
             the claim against the key it carries, but proving it costs an
             ECDH, a second keypair, and a post-quantum encapsulation — and
             every one of those is spent on a socket that has proven nothing.
             An id nobody named is not worth the arithmetic, and rejecting the
             claim early cannot admit anybody: acceptance still runs the full
             proof and the allowlist against the verified id afterwards. */
          if (!mayLinkWith(message?.from)) {
            log.warn?.(`[Transit] refused a link from ${String(message?.from || '').slice(0, 12)}: not in the allowlist`);
            return refuse(1008, 'not allowed');
          }
          const answered = answerLink(identity, privateKey, message, pqPrivateKey);
          if (!mayLinkWith(answered.peerId)) {
            log.warn?.(`[Transit] refused a link from ${answered.peerId.slice(0, 12)}: not in the allowlist`);
            return refuse(1008, 'not allowed');
          }
          state = answered.state;
          socket.send(JSON.stringify({ t: 'proof', ...answered.proof }));
          return;
        }
        if (state && message?.t === 'confirm') {
          const { key, hybrid } = confirmLink(state, message);
          clearTimer(timer);
          settled = true;
          const link = wrap(socket, state.peerId, key, 'answerer', hybrid);
          log.log?.(`[Transit] link up (inbound) with ${state.peerId.slice(0, 12)}`
            + `${hybrid ? ', hybrid post-quantum' : ', classical only'}`);
          register(link);
          return;
        }
        refuse(1002, 'unexpected frame');
      } catch (error) {
        log.warn?.(`[Transit] inbound handshake failed: ${error.message}`);
        refuse(1008, 'handshake failed');
      }
    });
    socket.on('close', () => clearTimer(timer));
    socket.on('error', () => clearTimer(timer));
  }

  /* ---- dialling ------------------------------------------------------ */

  function scheduleDial(peerId, origin, attempt) {
    if (closed) return;
    /* One pending dial per peer. This used to overwrite the map entry without
       clearing the timer it replaced, so two paths arriving at once -- a failed
       dial and a dropped link -- left two timers running and the peer was dialled
       twice for every retry after that. */
    const pending = dialling.get(peerId);
    if (pending?.timer) clearTimer(pending.timer);
    const delay = backoffFor(attempt);
    const timer = setTimer(() => {
      dialling.delete(peerId);
      dial(peerId, origin, attempt + 1).catch(() => {});
    }, delay);
    timer.unref?.();
    dialling.set(peerId, { attempt, timer });
  }

  async function dial(peerId, origin, attempt = 0) {
    if (origin) dialOrigins.set(peerId, origin);
    if (closed || !mayLinkWith(peerId)) return null;
    if (linkFor(peerId)) return linkFor(peerId);
    if (dialling.has(peerId)) return null;
    dialling.set(peerId, { attempt, timer: null });
    try {
      const bundle = await fetchIdentity(origin);
      /* The key is checked against the id that was WANTED, not against the id
         the answer carried. Otherwise whoever answers is authenticated as
         themselves, which is not the question being asked. */
      if (!bundle?.publicKey || idForKey(bundle.publicKey) !== peerId) {
        throw new Error('the relay at that address is not the one named');
      }
      const started = startLink(identity, bundle.publicKey, bundle.pqPublicKey || '');
      const url = new URL('/relay-link', origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocketImpl(url.toString(), {
        handshakeTimeout: DIAL_TIMEOUT_MS,
        rejectUnauthorized: verifyTls,
      });
      const link = await new Promise((resolve, reject) => {
        const giveUp = setTimer(() => reject(new Error('handshake timed out')), HANDSHAKE_TIMEOUT_MS);
        giveUp.unref?.();
        const fail = (error) => { clearTimer(giveUp); try { socket.close(); } catch (_e) { /* gone */ } reject(error); };
        socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', ...started.hello })));
        socket.on('error', fail);
        socket.on('close', () => fail(new Error('closed before the link was up')));
        socket.once('message', (raw) => {
          try {
            const message = JSON.parse(raw.toString());
            if (message?.t !== 'proof') throw new Error('expected a proof');
            const finished = finishLink(identity, privateKey, started.state, message, peerId, pqPrivateKey);
            socket.send(JSON.stringify({ t: 'confirm', ...finished.answer }));
            clearTimer(giveUp);
            socket.removeAllListeners('close');
            socket.removeAllListeners('error');
            resolve(wrap(socket, finished.peerId, finished.key, 'dialer', finished.hybrid));
          } catch (error) { fail(error); }
        });
      });
      dialling.delete(peerId);
      log.log?.(`[Transit] link up (outbound) with ${peerId.slice(0, 12)}`
        + `${link.hybrid ? ', hybrid post-quantum' : ', classical only'}`);
      register(link);
      return link;
    } catch (error) {
      dialling.delete(peerId);
      log.warn?.(`[Transit] could not reach ${peerId.slice(0, 12)}: ${error.message}`);
      scheduleDial(peerId, origin, attempt);
      return null;
    }
  }

  /* ---- the allowlist, at runtime -----------------------------------------
   *
   * The allowlist used to be fixed at construction, which meant the only way
   * to link a new relay or retire one was to edit the environment and restart
   * — a restart that also drops every connected client. The monitor drives
   * these; the caller owns persistence (an onChange callback fires on every
   * mutation) so a restart keeps the same set the operator last saw. */
  function allowPeer(id, origin = '') {
    const key = String(id || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(key)) return false;
    let cleanOrigin = '';
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') cleanOrigin = parsed.origin;
      } catch (_error) { return false; }
    }
    const existed = allowed.has(key);
    allowed.add(key);
    /* An address given now replaces one remembered from an earlier dial, so
       correcting a relay's origin does not need a restart either. */
    if (cleanOrigin) {
      dialOrigins.set(key, cleanOrigin);
      if (!outbound.get(key)?.isOpen()) scheduleDial(key, cleanOrigin, 0);
    }
    if (!existed) onChange?.('add', key, cleanOrigin);
    return true;
  }

  function disallowPeer(id) {
    const key = String(id || '').toLowerCase();
    if (!allowed.has(key)) return false;
    allowed.delete(key);
    dialOrigins.delete(key);
    const pending = dialling.get(key);
    if (pending?.timer) clearTimer(pending.timer);
    dialling.delete(key);
    outbound.get(key)?.close('removed from the allowlist');
    for (const link of inbound.get(key) || []) link.close('removed from the allowlist');
    onChange?.('remove', key, '');
    return true;
  }

  /* The whole set with addresses, which is what an operator needs and the
     plain id list never said: which relays may link, where each is dialled,
     and whether a link is actually standing. */
  function peerEntries() {
    return Array.from(allowed, (id) => ({
      id,
      origin: dialOrigins.get(id) || '',
      linked: Boolean(linkFor(id)),
      role: outbound.get(id)?.isOpen() ? 'dialer' : (inbound.get(id)?.size ? 'answerer' : 'none'),
    }));
  }

  return {
    enabled,
    mayLinkWith,
    accept,
    dial,
    linkFor,
    allowPeer,
    disallowPeer,
    peerEntries,
    allowedPeers: () => Array.from(allowed),
    /* What /chat-health reports: how many relays this one is actually able to
       hand traffic to right now, which is the only honest measure of it. */
    status() {
      const up = new Set();
      let hybrid = 0;
      for (const id of allowed) {
        const link = linkFor(id);
        if (!link) continue;
        up.add(id);
        if (link.hybrid) hybrid += 1;
      }
      return { enabled: enabled(), allowed: allowed.size, up: up.size, hybrid };
    },
    close() {
      closed = true;
      for (const { timer } of dialling.values()) if (timer) clearTimer(timer);
      dialling.clear();
      for (const link of outbound.values()) link.close('shutting down');
      for (const set of inbound.values()) for (const link of set) link.close('shutting down');
      outbound.clear();
      inbound.clear();
    },
  };
}

module.exports = {
  createRelayPeers, parseTransitPeers, parsePeerAllowlist, backoffFor, makeIdentityFetcher,
};
