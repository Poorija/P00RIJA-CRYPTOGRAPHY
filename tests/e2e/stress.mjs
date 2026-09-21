/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* How much the relay can actually hold at once.
 *
 *   node tests/e2e/stress.mjs                 # against a relay it starts itself
 *   RELAY_URL=https://host:8585 node tests/e2e/stress.mjs   # against a real one
 *
 * relayscale.mjs already measures how the cost of STORING a message grows. This
 * measures the other question, and the one that was actually asked: how many
 * people can be connected, talking, and calling each other at the same time
 * before it stops keeping up.
 *
 * Three phases, each answering something different:
 *
 *   1. CONNECTIONS  Open sockets in growing waves and see where they stop
 *      being accepted, and what it costs the relay to hold them.
 *   2. MESSAGES     Pair everyone up and send at once. Report the latency
 *      distribution, not the average — an average hides the tail, and the tail
 *      is what a person experiences as "it did not send".
 *   3. CALLS        A call is not one message. It is an invite, an accept and
 *      a burst of ICE candidates through the relay in a fraction of a second,
 *      and only the whole exchange completing counts as a call.
 *
 * WHAT THE NUMBERS ARE AND ARE NOT. Both ends of every conversation run in this
 * one Node process, so the load generator competes with nothing but itself and
 * the clock is shared, which makes one-way latency directly measurable. It also
 * means the client side is far cheaper than real browsers would be, and that
 * there is no network between them. Against a local relay these are the
 * relay's own limits. Point it at a real server with RELAY_URL and the same
 * numbers include the path to it, which is usually what you want to know.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { relayTestIdentity, answerRelayChallenge } from './_relay-identity.mjs';
import { spawn, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const REMOTE = process.env.RELAY_URL || '';
const PORT = 9520;
const PRESENCE_PORT = 9521;
const PASSWORD = 'stress-harness-password';
const WAVES = (process.env.STRESS_WAVES || '50,100,200,400')
  .split(',').map((value) => Number(value.trim())).filter(Boolean);
const MESSAGES_EACH = Number(process.env.STRESS_MESSAGES || 20);
/* Short enough to run at every wave without the ramp taking minutes. */
const BURST_ROUNDS = Number(process.env.STRESS_BURST_ROUNDS || 8);
const CALLS_PER_WORKER = Number(process.env.STRESS_CALLS || 50);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-stress-'));

let relay = null;
let signalUrl;
let healthUrl;
let auth;

if (REMOTE) {
  const base = new URL(REMOTE);
  healthUrl = `${base.origin}/healthz`;
  signalUrl = `${base.protocol === 'https:' ? 'wss' : 'ws'}://${base.host}/chat-signal`;
  auth = process.env.MONITOR_PASSWORD
    ? 'Basic ' + Buffer.from(`admin:${process.env.MONITOR_PASSWORD}`).toString('base64')
    : '';
  console.log(`\n  driving ${base.origin}`);
  console.log(auth ? '  health readings enabled' : '  no MONITOR_PASSWORD set — health readings will be skipped');
} else {
  relay = spawn(process.execPath, ['scripts/server.js'], {
    cwd: path.resolve(fileURLToPath(new URL('../..', import.meta.url))),
    env: {
      ...process.env,
      MONITOR_PASSWORD: PASSWORD,
      TURN_PASSWORD: 'stress-harness',
      CHAT_SIGNAL_PORT: String(PORT),
      CHAT_PRESENCE_PORT: String(PRESENCE_PORT),
      CHAT_OFFLINE_STORE_PATH: path.join(dir, 'offline-messages.json'),
      CHAT_PUSH_STORE_PATH: path.join(dir, 'push-subscriptions.json'),
      CHAT_RETENTION_SWEEP_MS: '600000',
      /* Every client here comes from 127.0.0.1, so the per-address cap — 276
         on this machine — is what a load generator meets first, and the run
         would measure an anti-abuse rule rather than the relay. Raised for the
         capacity phases; the cap itself is proved separately at the end, on a
         second relay, where it is the thing under test rather than in the way. */
      CHAT_WS_MAX_PER_IP: '20000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  relay.stdout.on('data', () => {});
  relay.stderr.on('data', (chunk) => {
    const text = String(chunk);
    if (/Error|EMFILE|ENOMEM/.test(text)) console.log('  relay!! ' + text.slice(0, 200));
  });
  healthUrl = `http://127.0.0.1:${PORT}/healthz`;
  signalUrl = `ws://127.0.0.1:${PRESENCE_PORT}/chat-signal`;
  auth = 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64');
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

async function health() {
  if (!auth) return null;
  try {
    const response = await fetch(healthUrl, { headers: { Authorization: auth } });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  }
}

const testIdentities = new Map();
const identityFor = (index) => {
  if (!testIdentities.has(index)) testIdentities.set(index, relayTestIdentity());
  return testIdentities.get(index);
};
const fingerprintFor = (index) => identityFor(index).fingerprint;

/* Every client is a real presence record: the relay refuses to route for one
   that has not introduced itself, so a load generator that skips `hello`
   measures the rejection path and nothing else. */
function connect(index) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(signalUrl, { handshakeTimeout: 15000 });
    const fingerprint = fingerprintFor(index);
    const client = {
      index, socket, fingerprint,
      clientId: `stress-client-${index}`,
      peerId: `stress-peer-${index}`,
      inbox: [],
    };
    const timer = setTimeout(() => { try { socket.close(); } catch (e) {} reject(new Error('timeout')); }, 15000);
    socket.on('open', () => {
      clearTimeout(timer);
      socket.send(JSON.stringify({
        type: 'hello',
        username: `stress-${index}`,
        peerId: client.peerId,
        clientId: client.clientId,
        fingerprint,
        publicKeyData: identityFor(index).publicKeyData,
      }));
      resolve(client);
    });
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch (error) { return; }
      if (answerRelayChallenge(message, identityFor(index), socket)) return;
      client.inbox.push(message);
      client.onMessage?.(message);
    });
    socket.on('error', () => { clearTimeout(timer); reject(new Error('socket error')); });
  });
}

function percentiles(samples) {
  if (!samples.length) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] };
}

/* ---------------------------------------------------------------------------
 * The load lives in worker processes.
 *
 * One Node process cannot hold much past 1500 sockets: its event loop stalls
 * for longer than the relay's fifteen-second liveness ping, the pongs stop
 * going out, and the relay terminates every socket. That reads as a server
 * collapsing under load and is nothing of the kind — it is the measuring
 * instrument failing. Splitting the clients across processes moves that limit
 * far enough out that what remains is the relay's.
 * ------------------------------------------------------------------------- */
const WORKERS = Number(process.env.STRESS_WORKERS || Math.max(2, Math.min(6, os.cpus().length - 2)));
const workers = [];
let nextCommandId = 1;

function ask(worker, command) {
  const id = nextCommandId += 1;
  return new Promise((resolve, reject) => {
    const onReply = (reply) => {
      if (reply?.id !== id) return;
      worker.off('message', onReply);
      reply.ok ? resolve(reply) : reject(new Error(reply.error || 'worker failed'));
    };
    worker.on('message', onReply);
    worker.send({ ...command, id });
  });
}

const askAll = (command) => Promise.all(workers.map((worker) => ask(worker, command)));

for (let index = 0; index < WORKERS; index += 1) {
  const worker = fork(fileURLToPath(new URL('./_stress-worker.mjs', import.meta.url)), [], {
    env: { ...process.env, STRESS_SIGNAL_URL: signalUrl, STRESS_WORKER_ID: String(index) },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  await new Promise((resolve) => worker.once('message', resolve));
  workers.push(worker);
}
console.log(`\n  ${WORKERS} load-generator processes`);

const waveReport = [];
let connectedTotal = 0;

function mergeBursts(replies) {
  const latencies = replies.flatMap((reply) => reply.latencies);
  const expected = replies.reduce((sum, reply) => sum + reply.expected, 0);
  const delivered = replies.reduce((sum, reply) => sum + reply.delivered, 0);
  const pairs = replies.reduce((sum, reply) => sum + reply.pairs, 0);
  const offeredSeconds = Math.max(...replies.map((reply) => reply.offeredSeconds));
  const totalSeconds = Math.max(...replies.map((reply) => reply.totalSeconds));
  return {
    pairs, expected, delivered,
    offeredRate: expected / (offeredSeconds || 1),
    sustainedRate: delivered / (totalSeconds || 1),
    ...percentiles(latencies),
  };
}

try {
  /* ===== 1. the room fills, and is measured at every size =============== */

  console.log('\n===== how it behaves as the room fills =====');
  console.log('  clients   failed   msg p50   msg p95   msg p99    lost   relay in/out   RSS MB');

  let ceilingHit = false;
  let harnessLimited = false;

  for (const size of WAVES) {
    const share = Math.ceil(size / WORKERS);
    const before = await health();
    const connectReplies = await Promise.all(workers.map((worker, index) =>
      ask(worker, { op: 'connect', from: connectedTotal + index * share, count: share })));
    const failed = connectReplies.reduce((sum, reply) => sum + reply.failed, 0);
    const refused = connectReplies.reduce((sum, reply) => sum + (reply.refused || 0), 0);
    const timedOut = connectReplies.reduce((sum, reply) => sum + (reply.timedOut || 0), 0);
    connectedTotal += connectReplies.reduce((sum, reply) => sum + reply.opened, 0);

    /* Presence is recorded when `hello` is processed, not when the socket
       opens, so give the relay a moment before reading it back. */
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const load = mergeBursts(await askAll({ op: 'burst', rounds: BURST_ROUNDS }));
    const after = await health();
    const relayIn = (after?.traffic?.msgsIn ?? 0) - (before?.traffic?.msgsIn ?? 0);
    const relayOut = (after?.traffic?.msgsOut ?? 0) - (before?.traffic?.msgsOut ?? 0);

    const row = {
      size, total: connectedTotal, failed, relayIn, relayOut, ...load,
      peers: after?.peers ?? null,
      rss: after?.memory?.rss ?? null,
      cpu: after?.cpuLoad ?? null,
    };
    waveReport.push(row);
    console.log(`  ${String(row.total).padStart(7)}   ${String(failed).padStart(6)}`
      + `   ${row.p50.toFixed(0).padStart(7)}   ${row.p95.toFixed(0).padStart(7)}   ${row.p99.toFixed(0).padStart(7)}`
      + `   ${String(row.expected - row.delivered).padStart(5)}`
      + `   ${String(relayIn).padStart(6)}/${String(relayOut).padEnd(6)}`
      + `   ${String(row.rss ?? '-').padStart(6)}`);

    if (failed > 0) {
      const others = {};
      connectReplies.forEach((reply) => Object.entries(reply.reasons || {})
        .forEach(([why, count]) => { others[why] = (others[why] || 0) + count; }));
      console.log(`  of ${failed} that did not connect: ${refused} refused by the relay,`
        + ` ${timedOut} never finished the handshake`
        + (Object.keys(others).length ? `, ${JSON.stringify(others)}` : ''));
      /* Only an outright refusal is the relay drawing a line. A handshake that
         never completed means something was too busy to finish it, and on one
         laptop running six generators and the relay, that something is usually
         this machine. */
      if (refused > 0) ceilingHit = true; else harnessLimited = true;
      break;
    }
    /* Fewer messages reaching the relay than were sent means the generator did
       not manage to send them. That is this harness reaching ITS limit, not the
       relay reaching its own, and reporting it as capacity would be a lie. */
    if (relayIn > 0 && relayIn < row.expected * 0.98) { harnessLimited = true; break; }
    if (row.delivered === 0 && row.expected > 0) { harnessLimited = true; break; }
  }

  console.log(`\n  ${connectedTotal} clients connected concurrently across ${WORKERS} processes`);
  const perIpCap = (await health())?.relay?.limits?.wsMaxPerIp ?? Infinity;
  if (harnessLimited) {
    check('the ramp stopped at the load generator, not at the relay', true,
      'add STRESS_WORKERS, or run this from more than one machine, to push further');
  } else if (ceilingHit && connectedTotal >= perIpCap) {
    check('the run reached the relay’s per-address cap, as one machine must',
      true, `${connectedTotal} from one address, cap ${perIpCap}`);
  } else {
    check('every connection in every wave was accepted', !ceilingHit,
      ceilingHit ? 'a wave was refused — see the table above' : `${connectedTotal} held`);
  }

  const lastGood = [...waveReport].reverse().find((row) => row.delivered === row.expected);
  check('the relay forwarded everything it accepted',
    Boolean(lastGood) && lastGood.relayIn === lastGood.relayOut,
    lastGood ? `${lastGood.relayIn} in, ${lastGood.relayOut} out at ${lastGood.total} clients` : 'no clean wave');

  /* ===== 2. the full-load run =========================================== */

  console.log('\n===== everyone at once =====');

  if (harnessLimited) {
    /* The ramp already established that the generator, not the relay, gave
       way. Running a bigger burst on top of a client set that is half broken
       would produce numbers about this laptop and print them as the server's
       capacity. The last clean wave is the honest answer. */
    console.log('  skipped: the load generator gave way during the ramp, so a bigger');
    console.log('  burst on the same clients would measure this machine, not the relay.');
    console.log(`  The last clean wave stands as the result: ${lastGood?.total ?? 0} clients,`
      + ` p95 ${lastGood?.p95.toFixed(0) ?? '-'}ms, ${lastGood?.expected ?? 0} messages, none lost.`);
  }

  const trafficBefore = harnessLimited ? null : await health();
  const full = harnessLimited
    ? { ...lastGood, offeredRate: lastGood?.offeredRate ?? 0, sustainedRate: lastGood?.sustainedRate ?? 0 }
    : mergeBursts(await askAll({ op: 'burst', rounds: MESSAGES_EACH }));
  const trafficAfter = harnessLimited ? null : await health();
  full.relayIn = (trafficAfter?.traffic?.msgsIn ?? 0) - (trafficBefore?.traffic?.msgsIn ?? 0);
  full.relayOut = (trafficAfter?.traffic?.msgsOut ?? 0) - (trafficBefore?.traffic?.msgsOut ?? 0);

  if (!harnessLimited) {
    console.log(`  ${full.expected} sent from ${full.pairs} pairs, ${full.delivered} delivered`);
  }
  if (!harnessLimited) {
    console.log(`  offered ${full.offeredRate.toFixed(0)} msg/s · sustained ${full.sustainedRate.toFixed(0)} msg/s including the drain`);
    console.log(`  the relay accepted ${full.relayIn} and wrote back ${full.relayOut}`);
    console.log(`  latency p50 ${full.p50.toFixed(1)}ms · p95 ${full.p95.toFixed(1)}ms`
      + ` · p99 ${full.p99.toFixed(1)}ms · worst ${full.max.toFixed(1)}ms`);
  }

  check('every message reached the other side',
    full.delivered === full.expected, `${full.delivered} of ${full.expected}`);

  /* The absolute figure moves with whatever load the caller asked for, so
     "under 500ms" only means something at one particular size. The SHAPE does
     not move: a healthy server under saturation degrades evenly and its tail
     stays a small multiple of the median, while one that is stalling — a
     blocked event loop, a synchronous write, a lock — throws a tail tens of
     times the median. That is the failure worth catching. */
  const tailRatio = full.p50 > 0 ? full.p99 / full.p50 : 0;
  console.log(`  tail is ${tailRatio.toFixed(1)}x the median`);
  check('it degrades evenly rather than stalling',
    tailRatio > 0 && tailRatio < 8, `p99 is ${tailRatio.toFixed(1)}x p50`);

  if (trafficAfter) {
    console.log(`  relay during the run: ${trafficAfter.memory?.rss} MB RSS,`
      + ` host load ${trafficAfter.cpuLoad}%, ${trafficAfter.relay?.mailboxes?.envelopes ?? 0} queued`);
    check('nothing was queued: every recipient was present',
      (trafficAfter.relay?.mailboxes?.envelopes ?? 0) === 0,
      `${trafficAfter.relay?.mailboxes?.envelopes} envelopes queued`);
  }

  /* ===== 3. calls ======================================================= */

  console.log('\n===== calls =====');

  const callReplies = await askAll({ op: 'calls', limit: CALLS_PER_WORKER, iceEach: 8 });
  const callAttempted = callReplies.reduce((sum, reply) => sum + reply.attempted, 0);
  const callCompleted = callReplies.reduce((sum, reply) => sum + reply.completed, 0);
  const callStats = percentiles(callReplies.flatMap((reply) => reply.setups));
  console.log(`  ${callCompleted} of ${callAttempted} calls completed the full exchange`);
  console.log(`  setup p50 ${callStats.p50.toFixed(1)}ms · p95 ${callStats.p95.toFixed(1)}ms · worst ${callStats.max.toFixed(1)}ms`);
  check('every simultaneous call completed its signalling',
    callCompleted === callAttempted, `${callCompleted} of ${callAttempted}`);
  /* Two seconds of silence after pressing call is when people hang up and try
     again, which doubles the load. */
  check('call setup stays under two seconds at the tail',
    callStats.p95 < 2000 && callCompleted > 0, `p95 ${callStats.p95.toFixed(1)}ms`);

  /* ===== the reading ==================================================== */

  const after = await health();
  console.log('\n===== what this relay can hold =====');
  console.log(`  concurrent clients      ${connectedTotal} across ${WORKERS} processes`);
  console.log(`  messages offered        ${full.offeredRate.toFixed(0)}/s, all delivered at p95 ${full.p95.toFixed(0)}ms`);
  console.log(`  simultaneous calls      ${callCompleted} signalled, p95 ${callStats.p95.toFixed(0)}ms`);
  if (after?.relay?.limits) {
    const limits = after.relay.limits;
    console.log(`  the relay's own ceiling ${limits.wsMaxTotal} sockets (${limits.wsMaxPerIp} per address), tier ${limits.tier}`);
    /* cpuLoad is os.loadavg() over every core on the host, so on a laptop that
       is also running the load generator and a browser it says more about this
       machine than about the relay. Reported, not interpreted. */
    console.log(`  cost of the above       ${after.memory?.rss} MB RSS, host load ${after.cpuLoad}%`);
  }
  /* The curve, read back as a sentence. "Comfortable" is a quarter of a second
     at the tail: below that a message feels instant, above it people start
     watching the screen. */
  const comfortable = [...waveReport].reverse()
    .find((row) => row.delivered === row.expected && row.delivered > 0 && row.p95 < 250);
  if (comfortable) {
    console.log(`  comfortable up to       ${comfortable.total} clients`
      + ` (p95 ${comfortable.p95.toFixed(0)}ms at ${comfortable.offeredRate.toFixed(0)} msg/s offered)`);
  } else {
    console.log('  comfortable up to       not reached — even the smallest wave passed 250ms at the tail');
  }

  if (after?.relay?.throttle?.nearOrOverLimit?.length) {
    console.log(`  throttled during the run: ${JSON.stringify(after.relay.throttle.nearOrOverLimit).slice(0, 160)}`);
  }

  /* ===== the cap the phases above deliberately stepped around ============ */

  if (!REMOTE) {
    console.log('\n===== the per-address cap =====');
    const capPort = PORT + 10;
    const capped = spawn(process.execPath, ['scripts/server.js'], {
      cwd: path.resolve(fileURLToPath(new URL('../..', import.meta.url))),
      env: {
        ...process.env,
        MONITOR_PASSWORD: PASSWORD,
        TURN_PASSWORD: 'stress-harness',
        CHAT_SIGNAL_PORT: String(capPort),
        CHAT_PRESENCE_PORT: String(capPort + 1),
        CHAT_OFFLINE_STORE_PATH: path.join(dir, 'capped-messages.json'),
        CHAT_PUSH_STORE_PATH: path.join(dir, 'capped-push.json'),
        CHAT_WS_MAX_PER_IP: '10',
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const cappedUrl = `ws://127.0.0.1:${capPort + 1}/chat-signal`;
    const openOne = () => new Promise((resolve) => {
      const socket = new WebSocket(cappedUrl, { handshakeTimeout: 8000 });
      socket.on('open', () => resolve(socket));
      socket.on('error', () => resolve(null));
    });
    const held = [];
    let refused = 0;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const socket = await openOne();
      if (socket) held.push(socket); else refused += 1;
    }
    console.log(`  ${held.length} accepted, ${refused} refused against a cap of 10`);
    check('one address cannot open more sockets than its cap allows',
      held.length <= 10 && refused > 0, `${held.length} accepted, ${refused} refused`);
    held.forEach((socket) => { try { socket.close(); } catch (error) { /* going anyway */ } });
    capped.kill();
  }
} finally {
  await Promise.allSettled(workers.map((worker) => ask(worker, { op: 'stop' })));
  workers.forEach((worker) => { try { worker.kill(); } catch (error) { /* going anyway */ } });
  await new Promise((resolve) => setTimeout(resolve, 500));
  relay?.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* gone */ }
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('failed:');
  failed.forEach((result) => console.log(`  - ${result.name}`));
  process.exit(1);
}
