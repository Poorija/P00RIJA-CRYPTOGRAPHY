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
        /* As the app does: it reads the presence table as changes after the
           first whole one. STRESS_CAPS='' measures an older build instead. */
        caps: String(process.env.STRESS_CAPS ?? 'pd1').split(',').filter(Boolean),
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

/* People arriving, not a stampede: a batch at a time, each failure tried
   again a couple of times after a pause, the way the app's own reconnect
   does. */
async function addClientsPaced(from, count, batch, gapMs) {
  const totals = { opened: 0, failed: 0, refused: 0, timedOut: 0, reasons: {} };
  const retry = [];
  for (let offset = 0; offset < count; offset += batch) {
    const indices = Array.from({ length: Math.min(batch, count - offset) }, (_, step) => from + offset + step);
    const settled = await Promise.allSettled(indices.map((index) => connect(index)));
    settled.forEach((entry, position) => {
      if (entry.status === 'fulfilled') { clients.push(entry.value); totals.opened += 1; }
      else retry.push(indices[position]);
    });
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  for (let attempt = 0; attempt < 2 && retry.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500 + attempt * 1500));
    const again = retry.splice(0);
    const settled = await Promise.allSettled(again.map((index) => connect(index)));
    settled.forEach((entry, position) => {
      if (entry.status === 'fulfilled') { clients.push(entry.value); totals.opened += 1; }
      else retry.push(again[position]);
    });
  }
  for (const index of retry) {
    totals.failed += 1;
    void index;
  }
  return { ...totals, held: clients.filter((client) => client.socket.readyState === 1).length };
}

/* Ordinary use: every client sends one message every `periodMs`, at its own
   moment within the period, for `durationMs`. */
async function runSteady(durationMs, periodMs) {
  const live = clients.filter((client) => client.socket.readyState === 1);
  const pairs = [];
  for (let index = 0; index + 1 < live.length; index += 2) pairs.push([live[index], live[index + 1]]);
  const latencies = [];
  const sentAt = new Map();
  let delivered = 0;
  let expected = 0;
  onWireMessage = (client, message) => {
    if (message.type !== 'relay') return;
    const id = message.payload?.stressId;
    if (!id || !sentAt.has(id)) return;
    latencies.push(Number(process.hrtime.bigint() - sentAt.get(id)) / 1e6);
    sentAt.delete(id);
    delivered += 1;
  };
  const body = 'x'.repeat(1024);
  const timers = [];
  let sequence = 0;
  const started = Date.now();
  for (const [a, b] of pairs) {
    for (const [from, to] of [[a, b], [b, a]]) {
      const tick = () => {
        if (Date.now() - started > durationMs || from.socket.readyState !== 1) return;
        const id = `${ID}-s-${from.index}-${sequence += 1}`;
        sentAt.set(id, process.hrtime.bigint());
        expected += 1;
        from.socket.send(JSON.stringify({ type: 'relay', toFingerprint: to.fingerprint, toClientId: to.clientId, payload: { type: 'offline-chat', inner: 'text', stressId: id, ciphertext: body } }));
        timers.push(setTimeout(tick, periodMs));
      };
      timers.push(setTimeout(tick, Math.random() * periodMs));
    }
  }
  await new Promise((resolve) => setTimeout(resolve, durationMs + 6000));
  timers.forEach((timer) => clearTimeout(timer));
  onWireMessage = null;
  return { pairs: pairs.length, expected, delivered, latencies };
}

/* Drop some sockets at once, as a network blip does. */
function dropClients(count) {
  const dropped = [];
  for (const client of clients.splice(0, count)) {
    try { client.socket.terminate(); } catch (_error) { /* gone */ }
    dropped.push(client.index);
  }
  return dropped;
}

process.on('message', async (command) => {
  try {
    if (command.op === 'connect-paced') {
      process.send({ id: command.id, ok: true, ...(await addClientsPaced(command.from, command.count, command.batch || 25, command.gapMs || 250)) });
    } else if (command.op === 'steady') {
      process.send({ id: command.id, ok: true, ...(await runSteady(command.durationMs || 20000, command.periodMs || 10000)) });
    } else if (command.op === 'drop') {
      process.send({ id: command.id, ok: true, dropped: dropClients(command.count) });
    } else if (command.op === 'reconnect') {
      /* Everybody that was dropped, at once — the storm a restart causes —
         with the retries the app makes. */
      const started = Date.now();
      const indices = command.indices || [];
      const result = await addClientsPaced(indices[0] ?? 0, 0, 1, 0);
      void result;
      const settled = await Promise.allSettled(indices.map((index) => connect(index)));
      const failedIndices = [];
      settled.forEach((entry, position) => { if (entry.status === 'fulfilled') clients.push(entry.value); else failedIndices.push(indices[position]); });
      let back = indices.length - failedIndices.length;
      for (let attempt = 0; attempt < 3 && failedIndices.length; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        const again = failedIndices.splice(0);
        const retried = await Promise.allSettled(again.map((index) => connect(index)));
        retried.forEach((entry, position) => { if (entry.status === 'fulfilled') { clients.push(entry.value); back += 1; } else failedIndices.push(again[position]); });
      }
      process.send({ id: command.id, ok: true, asked: indices.length, back, seconds: (Date.now() - started) / 1000 });
    } else if (command.op === 'connect') {
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
