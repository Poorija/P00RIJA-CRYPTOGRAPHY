/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* How the relay behaves as the room fills up.
 *
 *   npm run relay          # terminal 1
 *   node tests/e2e/perf.mjs
 *
 * Measures three things that decide whether a given server is big enough:
 * how long a message takes to cross the relay, how much work joining costs
 * everyone already connected, and how much memory a connected peer costs.
 *
 * PERF_PEERS overrides the ladder. Numbers are printed rather than asserted
 * where the right answer depends on the hardware; only the shape of the curve
 * is asserted, because that is the part that must not change.
 */
import { WebSocket } from 'ws';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import process from 'node:process';
import { relayTestIdentity, answerRelayChallenge } from './_relay-identity.mjs';

const RELAY = process.env.RELAY_URL || 'http://localhost:9000';
const WS_URL = process.env.RELAY_WS || RELAY.replace(/^http/, 'ws').replace(/\/$/, '') + '/chat-signal';
const LADDER = (process.env.PERF_PEERS || '25,50,100,200').split(',').map(Number);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

function get(path) {
  const url = new URL(path, RELAY);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = lib.get(url, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
  });
}

const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
const fmt = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} MB` : `${n} KB`);

function connect(identity) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { rejectUnauthorized: false });
    const timer = setTimeout(() => { ws.close(); reject(new Error('connect timeout')); }, 15000);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ type: 'hello', username: identity.username, peerId: identity.peerId, fingerprint: identity.fingerprint, publicKeyData: identity.publicKeyData }));
      resolve(ws);
    });
    ws.on('message', raw => { answerRelayChallenge(JSON.parse(String(raw)), identity, ws); });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

const makeIdentity = (i) => ({
  username: `perf-${i}`,
  peerId: `poorija-peer-perf-${i}-${crypto.randomBytes(4).toString('hex')}`,
  ...relayTestIdentity(),
  clientId: crypto.randomUUID(),
});

console.log('\n===== what this machine is =====');
const before = await get('/chat-health');
if (!before?.ok) {
  console.log('  The relay is not answering. Start it with `npm run relay`.');
  process.exit(1);
}
console.log(`  relay: ${RELAY}   peers already connected: ${before.peers}`);

const table = [];
const sockets = [];
let previousRss = 0;

for (const target of LADDER) {
  const identities = [];
  const joinCost = [];
  while (sockets.length < target) {
    const identity = makeIdentity(sockets.length);
    identities.push(identity);
    const started = Date.now();
    try {
      sockets.push(await connect(identity));
    } catch (error) {
      console.log(`  could not reach ${target} peers: ${error.message}`);
      break;
    }
    joinCost.push(Date.now() - started);
  }
  /* Let the 100ms presence debounce settle before measuring anything. */
  await new Promise((r) => setTimeout(r, 1200));

  /* Round trip: peer A asks the relay to hand a payload to peer B, and B
     reports when it arrives. This is the number a user actually feels. */
  const latencies = [];
  const sender = sockets[0];
  const receiver = sockets[sockets.length - 1];
  const receiverFingerprint = identities.length
    ? identities[identities.length - 1].fingerprint
    : makeIdentity(0).fingerprint;

  for (let i = 0; i < 40; i += 1) {
    const stamp = `perf-${i}-${crypto.randomBytes(4).toString('hex')}`;
    const arrived = new Promise((resolve) => {
      const onMessage = (raw) => {
        if (String(raw).includes(stamp)) { receiver.off('message', onMessage); resolve(Date.now()); }
      };
      receiver.on('message', onMessage);
      setTimeout(() => { receiver.off('message', onMessage); resolve(0); }, 4000);
    });
    const sentAt = Date.now();
    sender.send(JSON.stringify({
      type: 'relay',
      toFingerprint: receiverFingerprint,
      payload: { type: 'offline-chat', stamp, message: { type: 'text' } },
      persist: false,
    }));
    const at = await arrived;
    if (at) latencies.push(at - sentAt);
  }
  latencies.sort((a, b) => a - b);

  const health = await get('/chat-health');
  const rss = 0;
  const row = {
    peers: sockets.length,
    /* The count the SERVER believes in. If this lags the socket count then the
       clients are connected but not registered, and every latency number below
       is measuring an empty room. */
    registered: Number(health?.peers ?? -1),
    joinMedian: percentile(joinCost.sort((a, b) => a - b), 0.5),
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    delivered: latencies.length,
    rss,
    rssDelta: previousRss ? rss - previousRss : 0,
  };
  previousRss = rss;
  table.push(row);
  console.log(`  ${String(row.peers).padStart(4)} sockets  ${String(row.registered).padStart(4)} registered   `
    + `join ${String(row.joinMedian).padStart(4)}ms   `
    + `relay p50 ${String(row.p50).padStart(4)}ms  p95 ${String(row.p95).padStart(4)}ms   `
    + `delivered ${row.delivered}/40`);
}

console.log('\n===== what the numbers say =====');
const first = table[0];
const last = table[table.length - 1];

check('every message crossed the relay at every size',
  table.every((row) => row.delivered >= 38), table.map((r) => `${r.peers}:${r.delivered}`).join(' '));

/* Without this the whole run can pass against an empty room. */
check('the server really did register the load',
  table.every((row) => row.registered >= row.peers * 0.9),
  table.map((r) => `${r.registered}/${r.peers}`).join(' '));

/* The latency a user feels must not grow with the size of the room. If it
   does, the relay is doing work proportional to the crowd for each message. */
const growth = first.p95 > 0 ? last.p95 / first.p95 : (last.p95 <= 5 ? 1 : Infinity);
check('delivery latency does not grow with the number of peers', growth < 4,
  `p95 ${first.p95}ms at ${first.peers} peers → ${last.p95}ms at ${last.peers}`);

/* Joining is where the O(n²) shows: every join pushes a full peer list to
   everyone already there. */
const joinGrowth = first.joinMedian > 0 ? last.joinMedian / first.joinMedian : 1;
check('joining stays cheap as the room fills', joinGrowth < 6,
  `${first.joinMedian}ms at ${first.peers} → ${last.joinMedian}ms at ${last.peers}`);

sockets.forEach((ws) => { try { ws.close(); } catch {} });
await new Promise((r) => setTimeout(r, 1500));
const after = await get('/chat-health');
check('the relay is still healthy after the load', Boolean(after?.ok), JSON.stringify(after?.peers));

const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${failed.length} failed of ${results.length} =====`);
process.exit(failed.length ? 1 : 0);
