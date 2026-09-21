/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* One slice of the load, in its own process.
 *
 * The parent (stress.mjs) cannot hold more than about 1500 sockets on its own:
 * past that its event loop stalls for longer than the relay's fifteen-second
 * liveness ping, the pongs stop, and the relay terminates every socket — which
 * looks exactly like a server collapsing and is not. Splitting the clients
 * across processes moves that limit out of the way so the number being
 * measured is the relay's.
 *
 * Pairs are formed WITHIN a worker on purpose. process.hrtime has no shared
 * origin between processes, so a message timed in one and received in another
 * would be measured against two different clocks. Both ends of every
 * conversation living here keeps one-way latency directly measurable, and the
 * relay does identical work either way.
 */
import crypto from 'node:crypto';
import { relayTestIdentity, answerRelayChallenge } from './_relay-identity.mjs';
import { WebSocket } from 'ws';

const { STRESS_SIGNAL_URL: SIGNAL, STRESS_WORKER_ID: ID } = process.env;
const clients = [];
let onWireMessage = null;

const testIdentities = new Map();
const identityFor = (index) => {
  if (!testIdentities.has(index)) testIdentities.set(index, relayTestIdentity());
  return testIdentities.get(index);
};
const fingerprintFor = (index) => identityFor(index).fingerprint;

function connect(index) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(SIGNAL, { handshakeTimeout: 20000 });
    const client = {
      index, socket,
      fingerprint: fingerprintFor(index),
      clientId: `stress-client-${index}`,
      peerId: `stress-peer-${index}`,
    };
    /* Refused and "took too long" are different facts. A relay that answers
       429 or 503 has made a decision; a handshake that never finished says the
       relay, this machine, or both were too busy to complete it. Counting the
       second as the first would report an overloaded laptop as a server
       rejecting connections. */
    const timer = setTimeout(() => {
      try { socket.close(); } catch (error) { /* going anyway */ }
      reject(new Error('timeout'));
    }, 20000);
    socket.on('open', () => {
      clearTimeout(timer);
      socket.send(JSON.stringify({
        type: 'hello',
        username: `stress-${index}`,
        peerId: client.peerId,
        clientId: client.clientId,
        fingerprint: client.fingerprint,
        publicKeyData: identityFor(index).publicKeyData,
      }));
      resolve(client);
    });
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch (error) { return; }
      if (answerRelayChallenge(message, identityFor(index), socket)) return;
      if (onWireMessage) onWireMessage(client, message);
    });
    socket.on('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      reject(new Error(`refused ${response.statusCode}`));
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(String(error?.message || 'socket error').slice(0, 60)));
    });
  });
}

/* Same cadence as the real client, so the relay does not age these out. */
setInterval(() => {
  for (const client of clients) {
    if (client.socket.readyState !== 1) continue;
    try { client.socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() })); }
    catch (error) { /* it will be reaped soon enough */ }
  }
}, 10000).unref?.();

async function addClients(from, count) {
  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, offset) => connect(from + offset)));
  let failed = 0;
  let refused = 0;
  let timedOut = 0;
  /* Anything that is neither: ECONNRESET, EMFILE, ENOBUFS. Named rather than
     lumped in, because those three point at this machine and a 429 points at
     the relay, and the whole value of this run is telling them apart. */
  const reasons = {};
  for (const entry of settled) {
    if (entry.status === 'fulfilled') { clients.push(entry.value); continue; }
    failed += 1;
    const why = String(entry.reason?.message || '');
    if (why.startsWith('refused')) refused += 1;
    else if (why === 'timeout') timedOut += 1;
    else reasons[why] = (reasons[why] || 0) + 1;
  }
  return { opened: settled.length - failed, failed, refused, timedOut, reasons, held: clients.length };
}

async function runBurst(rounds) {
  const pairs = [];
  for (let index = 0; index + 1 < clients.length; index += 2) {
    pairs.push([clients[index], clients[index + 1]]);
  }
  const latencies = [];
  const sentAt = new Map();
  let delivered = 0;

  onWireMessage = (client, message) => {
    if (message.type !== 'relay') return;
    const id = message.payload?.stressId;
    if (!id || !sentAt.has(id)) return;
    latencies.push(Number(process.hrtime.bigint() - sentAt.get(id)) / 1e6);
    delivered += 1;
  };

  const body = 'x'.repeat(2048);
  const send = (from, to, sequence) => {
    const id = `${ID}-${from.index}-${to.index}-${sequence}`;
    sentAt.set(id, process.hrtime.bigint());
    from.socket.send(JSON.stringify({
      type: 'relay',
      toFingerprint: to.fingerprint,
      toClientId: to.clientId,
      payload: { type: 'offline-chat', inner: 'text', stressId: id, ciphertext: body },
    }));
  };

  const started = Date.now();
  for (let sequence = 0; sequence < rounds; sequence += 1) {
    for (const [a, b] of pairs) { send(a, b, sequence); send(b, a, sequence); }
    await new Promise((resolve) => setImmediate(resolve));
  }
  const offeredSeconds = (Date.now() - started) / 1000;

  const expected = pairs.length * 2 * rounds;
  const deadline = Date.now() + 25000;
  while (delivered < expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  onWireMessage = null;
  return {
    pairs: pairs.length, expected, delivered, latencies,
    offeredSeconds, totalSeconds: (Date.now() - started) / 1000,
  };
}

/* A call is an exchange, not a message: invite, accept, then a burst of ICE
   both ways. Only the whole thing completing counts as a call. */
async function runCalls(limit, iceEach) {
  const pairs = [];
  for (let index = 0; index + 1 < clients.length && pairs.length < limit; index += 2) {
    pairs.push([clients[index], clients[index + 1]]);
  }
  const setups = [];
  let completed = 0;
  const waiting = new Map();

  onWireMessage = (client, message) => {
    const payload = message.payload;
    if (!payload?.callId) return;
    const entry = waiting.get(payload.callId);
    if (!entry) return;
    if (payload.type === 'call-invite' && client === entry.callee) {
      entry.callee.socket.send(JSON.stringify({
        type: 'relay', toFingerprint: entry.caller.fingerprint, toClientId: entry.caller.clientId,
        payload: { type: 'call-accepted', callId: payload.callId, sdp: 'answer' },
      }));
      for (let n = 0; n < iceEach; n += 1) {
        entry.callee.socket.send(JSON.stringify({
          type: 'relay', toFingerprint: entry.caller.fingerprint, toClientId: entry.caller.clientId,
          payload: {
            type: 'call-ice', callId: payload.callId,
            candidate: `candidate:${n} 1 udp 2113937151 192.168.1.9 5${n}000 typ host`,
          },
        }));
      }
      return;
    }
    if (payload.type === 'call-ice' && client === entry.caller) {
      entry.ice += 1;
      if (entry.ice >= iceEach && !entry.done) {
        entry.done = true;
        setups.push(Number(process.hrtime.bigint() - entry.started) / 1e6);
        completed += 1;
        entry.resolve();
      }
    }
  };

  await Promise.all(pairs.map(([caller, callee]) => new Promise((resolve) => {
    const callId = `call-${ID}-${caller.index}`;
    waiting.set(callId, { caller, callee, ice: 0, started: process.hrtime.bigint(), resolve, done: false });
    setTimeout(resolve, 20000);
    caller.socket.send(JSON.stringify({
      type: 'relay', toFingerprint: callee.fingerprint, toClientId: callee.clientId,
      payload: { type: 'call-invite', callId, sdp: 'offer' },
    }));
  })));

  onWireMessage = null;
  return { attempted: pairs.length, completed, setups };
}

process.on('message', async (command) => {
  try {
    if (command.op === 'connect') {
      process.send({ id: command.id, ok: true, ...(await addClients(command.from, command.count)) });
    } else if (command.op === 'burst') {
      process.send({ id: command.id, ok: true, ...(await runBurst(command.rounds)) });
    } else if (command.op === 'calls') {
      process.send({ id: command.id, ok: true, ...(await runCalls(command.limit, command.iceEach)) });
    } else if (command.op === 'stop') {
      clients.forEach((client) => { try { client.socket.close(); } catch (error) { /* going */ } });
      process.send({ id: command.id, ok: true });
      setTimeout(() => process.exit(0), 200);
    }
  } catch (error) {
    process.send({ id: command.id, ok: false, error: String(error).slice(0, 200) });
  }
});

process.send({ ready: true });
