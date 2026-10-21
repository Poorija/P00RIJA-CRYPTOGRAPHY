/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Is the relay ready for production, and how many people can it carry?
 *
 *   node tests/e2e/prodready.mjs            # needs Docker
 *
 * The relay is built from the same Dockerfile production uses
 * (config/Dockerfile.chat-signal, node:20-alpine) and run with the limits
 * the two production servers actually have — two cores, their memory, and
 * the 1024 open files Docker gives a container by default — so the numbers
 * are the servers' numbers, not this laptop's:
 *
 *   1. capacity, as deployed — the relay outside Iran (2 cores, 3.8 GB) and
 *      the one in Iran (2 cores, ~600 MB actually free), each with 1024 open
 *      files: connections, messages and calls, ramped until something gives
 *      (stress.mjs);
 *   2. capacity, tuned — the relay outside Iran with 65536 open files: what
 *      the same code on the same two cores carries once the file limit is out
 *      of the way;
 *   3. persistence — mail queued for people who are away survives the relay
 *      being killed outright and restarted, and all of it is delivered;
 *   4. leaks — sockets opened and closed in waves give their memory and file
 *      descriptors back;
 *   5. abuse — one client flooding frames is throttled without slowing anyone
 *      else, and an oversized frame closes only its own socket.
 *
 * What it cannot see: nginx in front (its 2 × 1024 worker connections are a
 * second ceiling, read from config/nginx.conf and reported), TURN media,
 * real networks, and real browsers' own cost. One-address load means the
 * per-address cap is raised for the capacity runs, as stress.mjs does.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, fork, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { relayTestIdentity, answerRelayChallenge } from './_relay-identity.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const IMAGE = 'poorija-relay-prodtest';
const PASSWORD = 'prodready-harness-password';
const results = [];
const findings = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryDocker = (...args) => { try { return docker(...args); } catch (error) { return String(error.stdout || '') + String(error.stderr || ''); } };

/* What the servers' own memory makes of the socket ceiling (capacityProfile in
   scripts/server.js), so the container is not judged by this laptop's RAM. */
const wsMaxTotalFor = (memMb) => Math.max(500, Math.min(50000, Math.round(memMb / 0.35)));

/* PROD_ONLY=capacity,persistence,leaks,abuse runs part of it. */
const ONLY = new Set(String(process.env.PROD_ONLY || 'security,steady,capacity,persistence,leaks,abuse').split(',').map((part) => part.trim()));
/* As config/docker-compose.yaml now runs them: 65536 open files. The old
   1024 is kept for the open-file guard's own test (security). */
const PROFILE_KEYS = new Set(String(process.env.PROD_PROFILES || 'fl,ir').split(','));
const PROFILES = [
  { key: 'fl', name: 'outside Iran', cpus: '2', memory: '3800m', memMb: 3819, nofile: 65536, waves: process.env.PROD_WAVES || '1000,2000,3000,4500,6000,8000' },
  { key: 'ir', name: 'Iran', cpus: '2', memory: '600m', memMb: 1642, nofile: 65536, waves: process.env.PROD_WAVES || '1000,2000,3000,4500,6000,8000' },
];
const CAPPED = { key: 'capped', name: 'outside Iran, 1024 open files', cpus: '2', memory: '3800m', memMb: 3819, nofile: 1024 };

let basePort = 19100;
function startRelay(profile, { volume = '', extraEnv = {} } = {}) {
  const name = `poorija-prodtest-${profile.key}-${Date.now().toString(36)}`;
  const port = (basePort += 10);
  const env = {
    MONITOR_PASSWORD: PASSWORD,
    TURN_PASSWORD: 'prodready',
    CHAT_TURN_USERNAME: 'prodready',
    CHAT_TURN_CREDENTIAL: 'prodready',
    CHAT_SIGNAL_PORT: '9000',
    CHAT_PRESENCE_PORT: '9001',
    CHAT_OFFLINE_STORE_PATH: '/data/offline-messages.json',
    CHAT_PUSH_STORE_PATH: '/data/push-subscriptions.json',
    CHAT_VAPID_STORE_PATH: '/data/vapid.json',
    CHAT_POLICY_STORE_PATH: '/data/server-policy.json',
    CHAT_SELF_DESTRUCT_STORE_PATH: '/data/self-destruct-records.json',
    CHAT_WS_MAX_TOTAL: String(wsMaxTotalFor(profile.memMb)),
    CHAT_WS_MAX_PER_IP: '50000',
    ...extraEnv,
  };
  const args = ['run', '-d', '--name', name,
    '--cpus', profile.cpus, '--memory', profile.memory, '--memory-swap', profile.memory,
    '--ulimit', `nofile=${profile.nofile}:${profile.nofile}`,
    /* What the servers' own kernels allow: the relay runs on the host network
       there, where somaxconn is 4096. */
    '--sysctl', 'net.core.somaxconn=4096',
    '-p', `127.0.0.1:${port}:9000`, '-p', `127.0.0.1:${port + 1}:9001`];
  if (volume) args.push('-v', `${volume}:/data`);
  else args.push('--tmpfs', '/data:rw,size=512m');
  for (const [key, value] of Object.entries(env)) args.push('-e', `${key}=${value}`);
  args.push(IMAGE);
  docker(...args);
  return { name, port, health: `http://127.0.0.1:${port}/healthz`, ws: `ws://127.0.0.1:${port + 1}/chat-signal`, profile };
}
async function waitHealthy(relay, ms = 60000) {
  const auth = 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64');
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const response = await fetch(relay.health, { headers: { Authorization: auth } });
      if (response.ok) return await response.json();
    } catch (_error) { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`${relay.name} did not come up: ${tryDocker('logs', '--tail', '30', relay.name)}`);
}
async function health(relay) {
  try {
    const response = await fetch(relay.health, { headers: { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') } });
    return response.ok ? await response.json() : null;
  } catch (_error) { return null; }
}
function stopRelay(relay) {
  /* What became of it, before it is gone: a crash or an out-of-memory kill
     would otherwise read as a client-side failure. */
  const state = tryDocker('inspect', relay.name, '--format', '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}');
  const logs = tryDocker('logs', '--tail', '400', relay.name);
  const notable = logs.split('\n').filter((line) => /Error|error|FATAL|heap|terminat|EMFILE|ENOMEM|Uncaught|Send buffer|refus|ceiling|503/i.test(line)).slice(-12);
  if (process.env.PROD_VERBOSE || /exit=[1-9]|oom=true/.test(state) || notable.length) {
    console.log(`  [${relay.name}] ${state}`);
    notable.forEach((line) => console.log(`    | ${line.slice(0, 220)}`));
  }
  tryDocker('rm', '-f', relay.name);
}
function containerReading(relay) {
  const stats = tryDocker('stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemUsage}}', relay.name);
  const [cpu, mem] = stats.split('|');
  const fds = Number(tryDocker('exec', relay.name, 'sh', '-c', 'ls /proc/1/fd | wc -l')) || 0;
  return { cpu: parseFloat(cpu) || 0, mem: String(mem || '').split('/')[0].trim(), fds };
}
function relayErrors(relay) {
  const logs = tryDocker('logs', relay.name);
  const lines = logs.split('\n');
  const pick = (pattern) => lines.filter((line) => pattern.test(line)).length;
  return {
    emfile: pick(/EMFILE|too many open files/i),
    enomem: pick(/ENOMEM|heap out of memory|JavaScript heap/i),
    fatal: pick(/FATAL|Uncaught|unhandled/i),
    refusedFull: pick(/socket ceiling|wsMaxTotal|too many sockets|refusing/i),
  };
}

/* ---- one authenticated client ------------------------------------------- */

function client(url, identity, { onMessage } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: 15000, maxPayload: 64 * 1024 * 1024 });
    const self = { socket, identity, proven: false, inbox: [] };
    const timer = setTimeout(() => { try { socket.terminate(); } catch (_error) { /* gone */ } reject(new Error('timeout')); }, 20000);
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'hello', username: 'prodready', peerId: `pr-${identity.fingerprint.slice(0, 12)}`, fingerprint: identity.fingerprint, publicKeyData: identity.publicKeyData, deviceId: `pr-device-${identity.fingerprint.slice(0, 10)}` }));
    });
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch (_error) { return; }
      if (answerRelayChallenge(message, identity, socket)) return;
      if (message.type === 'roster' && !self.proven) { self.proven = true; clearTimeout(timer); resolve(self); }
      self.inbox.push(message);
      onMessage?.(message, self);
    });
    socket.on('error', (error) => { clearTimeout(timer); reject(error); });
    socket.on('close', () => { self.closed = true; });
  });
}
const closeAll = (clients) => clients.forEach((item) => { try { item.socket.close(); } catch (_error) { /* gone */ } });

/* ---- capacity, via stress.mjs ------------------------------------------- */

function runStress(relay, waves) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['tests/e2e/stress.mjs'], {
      cwd: ROOT,
      env: {
        ...process.env,
        RELAY_URL: `http://127.0.0.1:${relay.port}`,
        RELAY_WS_URL: relay.ws,
        RELAY_HEALTH_URL: relay.health,
        MONITOR_PASSWORD: PASSWORD,
        STRESS_WAVES: waves,
        STRESS_MESSAGES: process.env.PROD_MESSAGES || '10',
        STRESS_CALLS: process.env.PROD_CALLS || '40',
        STRESS_WORKERS: process.env.PROD_WORKERS || process.env.STRESS_WORKERS || '8',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let peak = { cpu: 0, fds: 0, mem: '' };
    const sampler = setInterval(() => {
      const reading = containerReading(relay);
      if (reading.cpu > peak.cpu) peak.cpu = reading.cpu;
      if (reading.fds > peak.fds) { peak.fds = reading.fds; peak.mem = reading.mem; }
    }, 4000);
    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      output += text;
      text.split('\n').filter((line) => /^\s+\d+\s+\d+\s+\d|clients connected|PASS|FAIL|offered|latency|setup p|calls completed/.test(line)).forEach((line) => console.log(`    ${line.trim()}`));
    });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('exit', () => {
      clearInterval(sampler);
      const line = output.split('\n').find((row) => row.startsWith('STRESS_SUMMARY '));
      let summary = null;
      try { summary = line ? JSON.parse(line.slice('STRESS_SUMMARY '.length)) : null; } catch (_error) { summary = null; }
      resolve({ summary, peak, output });
    });
  });
}

const report = { profiles: [], steady: [], persistence: null, leaks: null, abuse: null, nginx: null };

try {
  section('the image production runs');
  docker('build', '-q', '-f', 'config/Dockerfile.chat-signal', '-t', IMAGE, ROOT);
  const nodeVersion = docker('run', '--rm', '--entrypoint', 'node', IMAGE, '-v');
  console.log(`  built ${IMAGE} (node ${nodeVersion}, alpine) from config/Dockerfile.chat-signal`);

  /* nginx in front: every proxied WebSocket holds two of its connections. */
  /* Set in the image (config/Dockerfile rewrites the stock nginx.conf), not
     in the site configuration. */
  const nginxImage = fs.readFileSync(path.join(ROOT, 'config/Dockerfile'), 'utf8');
  const workerConnections = Number(/worker_connections (\d+);/.exec(nginxImage)?.[1] || 1024);
  report.nginx = { workerConnections, workers: 2, proxiedSockets: Math.floor((workerConnections * 2) / 2) };
  console.log(`  nginx in front: ${workerConnections} connections × 2 workers, two per proxied socket — about ${report.nginx.proxiedSockets} sockets`);

  /* ---- security: what the audit found, closed ---------------------------- */

  if (ONLY.has('security')) {
    section('security — addresses, the per-address cap, the open-file guard');
    const relay = startRelay(CAPPED, { extraEnv: { CHAT_WS_MAX_PER_IP: '10' } });
    try {
      await waitHealthy(relay);
      /* As nginx forwards a real person: whatever the client wrote first, the
         address nginx saw appended last. */
      const viaNginx = (claimed, real) => ({ 'X-Forwarded-For': `${claimed}, ${real}`, 'X-Real-IP': real });
      const openRaw = (headers) => new Promise((resolve) => {
        const socket = new WebSocket(relay.ws, { headers, handshakeTimeout: 8000 });
        socket.on('open', () => resolve(socket));
        socket.on('error', () => resolve(null));
        socket.on('unexpected-response', () => resolve(null));
      });
      const held = [];
      let accepted = 0;
      for (let index = 0; index < 30; index += 1) {
        const socket = await openRaw(viaNginx(`203.0.113.${index + 1}`, '198.51.100.9'));
        if (socket) { accepted += 1; held.push(socket); }
      }
      check('a client renaming itself in X-Forwarded-For is still counted under the address nginx saw', accepted === 10, `${accepted} of 30 accepted against a cap of 10`);
      closeAll(held.map((socket) => ({ socket })));
      await sleep(1500);

      const identityA = relayTestIdentity();
      const identityB = relayTestIdentity();
      const presenceSeen = [];
      const connectAs = (identity, real, onMessage, caps = ['pd1']) => new Promise((resolve, reject) => {
        const socket = new WebSocket(relay.ws, { headers: viaNginx('10.0.0.1', real) });
        socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', username: 'panel-check', peerId: `pc-${identity.fingerprint.slice(0, 10)}`, fingerprint: identity.fingerprint, publicKeyData: identity.publicKeyData, ...(caps ? { caps } : {}) })));
        socket.on('message', (raw) => {
          const message = JSON.parse(String(raw));
          if (answerRelayChallenge(message, identity, socket)) return;
          onMessage?.(message);
          if (message.type === 'roster') resolve(socket);
        });
        socket.on('error', reject);
      });
      const a = await connectAs(identityA, '198.51.100.21');
      const b = await connectAs(identityB, '198.51.100.22', (message) => { if (message.type === 'peers' || message.type === 'peers-delta') presenceSeen.push(message); });
      await sleep(1500);
      const leaked = presenceSeen.some((message) => JSON.stringify(message).includes('198.51.100.21'));
      check('the presence table every client gets carries nobody\'s address', presenceSeen.length > 0 && !leaked, `${presenceSeen.length} presence frame(s), address ${leaked ? 'PRESENT' : 'absent'}`);
      const panel = await health(relay);
      const panelIps = (panel?.peersList || []).map((peer) => peer.ip);
      check('the monitor still sees each person\'s real address, for its user list and bans', panelIps.includes('198.51.100.21') && panelIps.includes('198.51.100.22'), JSON.stringify(panelIps));

      /* Changes only, to a client that reads them; whole tables to an older
         build; nothing at all while nobody comes or goes; and never anybody
         who has not proven who they are. */
      const legacySeen = [];
      const legacy = await connectAs(relayTestIdentity(), '198.51.100.23', (message) => { if (message.type === 'peers' || message.type === 'peers-delta') legacySeen.push(message); }, null);
      const ghostPeerId = 'pc-ghost-unproven';
      const ghost = await openRaw(viaNginx('10.0.0.1', '198.51.100.25'));
      ghost?.send(JSON.stringify({ type: 'hello', username: 'ghost', peerId: ghostPeerId, fingerprint: identityA.fingerprint, publicKeyData: identityA.publicKeyData, caps: ['pd1'] }));
      await sleep(2500);
      const idleFrom = { b: presenceSeen.length, legacy: legacySeen.length };
      await sleep(3000);
      check('while nobody comes or goes, no presence frame is sent at all', presenceSeen.length === idleFrom.b && legacySeen.length === idleFrom.legacy, `${presenceSeen.length - idleFrom.b} + ${legacySeen.length - idleFrom.legacy} frame(s) in 3 s idle`);
      const identityD = relayTestIdentity();
      const d = await connectAs(identityD, '198.51.100.24');
      await sleep(1500);
      d.close();
      await sleep(2000);
      const changes = presenceSeen.slice(idleFrom.b);
      const dRecord = changes.flatMap((message) => message.upsert || []).find((peer) => peer.fingerprint === identityD.fingerprint);
      const dRemoved = Boolean(dRecord) && changes.some((message) => (message.remove || []).includes(dRecord.clientId));
      check('a client that reads changes gets the table once, then only who came and went', presenceSeen[0]?.type === 'peers' && Boolean(dRecord) && dRemoved && changes.every((message) => message.type === 'peers-delta'), `first ${presenceSeen[0]?.type}, then ${changes.map((message) => message.type).join(', ')}`);
      const legacyChanges = legacySeen.slice(idleFrom.legacy);
      check('an older build still gets the whole table on each change', legacyChanges.length >= 2 && legacyChanges.every((message) => message.type === 'peers') && legacyChanges.some((message) => message.peers.some((peer) => peer.fingerprint === identityD.fingerprint)), `${legacyChanges.length} frame(s): ${legacyChanges.map((message) => message.type).join(', ')}`);

      /* The table with keys (asked for when a contact is added): a burst of
         three answered at once, and a fourth answered when the next one is
         due rather than dropped. */
      const askPeers = () => new Promise((resolve) => {
        const started = Date.now();
        const onRaw = (raw) => {
          const message = JSON.parse(String(raw));
          if (message.type !== 'peers' || !message.peers.some((peer) => 'publicKeyData' in peer)) return;
          b.off('message', onRaw);
          resolve({ message, ms: Date.now() - started });
        };
        b.on('message', onRaw);
        b.send(JSON.stringify({ type: 'get-peers' }));
        setTimeout(() => { b.off('message', onRaw); resolve(null); }, 15000);
      });
      const asks = [];
      for (let index = 0; index < 4; index += 1) asks.push(await askPeers());
      const askTimes = asks.map((ask) => ask?.ms ?? 'never');
      check('the table with keys: three asks in a row answered at once, a fourth when the next is due', asks.slice(0, 3).every((ask) => ask && ask.ms < 2000) && Boolean(asks[3]) && asks[3].ms > 5000 && asks[3].ms < 13000, `${askTimes.join(' ms, ')} ms`);
      const ghostListed = [...presenceSeen, ...legacySeen, ...asks.map((ask) => ask?.message)].some((message) => JSON.stringify(message || {}).includes(ghostPeerId));
      check('no table names a socket that never proved its identity', !ghostListed, ghostListed ? 'the unproven socket was listed' : 'not listed');
      closeAll([{ socket: legacy }, { socket: ghost }]);

      const anonymous = await openRaw({});
      const purgeAnswer = await new Promise((resolve) => {
        anonymous.on('message', (raw) => { const message = JSON.parse(String(raw)); if (message.type === 'purged') resolve(message); });
        anonymous.send(JSON.stringify({ type: 'purge-space', conversationId: 'space-anything' }));
        setTimeout(() => resolve(null), 4000);
      });
      check('an unproven socket cannot empty a group\'s queued mail', purgeAnswer?.refused === 'identity-unverified', JSON.stringify(purgeAnswer));
      closeAll([{ socket: a }, { socket: b }, { socket: anonymous }]);
      await sleep(1500);
    } finally {
      stopRelay(relay);
    }

    /* The open-file guard: with the old 1024 limit, sockets stop being
       accepted while files are left for everything else. */
    const guarded = startRelay(CAPPED, { extraEnv: { CHAT_WS_MAX_PER_IP: '50000' } });
    try {
      await waitHealthy(guarded);
      const sockets = [];
      let refusedWithAnswer = 0;
      let hung = 0;
      for (let start = 0; start < 1100; start += 100) {
        const batch = await Promise.all(Array.from({ length: 100 }, () => new Promise((resolve) => {
          const socket = new WebSocket(guarded.ws, { handshakeTimeout: 6000 });
          socket.on('open', () => resolve({ socket }));
          socket.on('unexpected-response', (_request, response) => resolve({ status: response.statusCode }));
          socket.on('error', (error) => resolve({ error: String(error.message || error) }));
        })));
        for (const outcome of batch) {
          if (outcome.socket) sockets.push(outcome.socket);
          else if (outcome.status === 503) refusedWithAnswer += 1;
          else hung += 1;
        }
      }
      const alive = await health(guarded);
      console.log(`  ${sockets.length} sockets held, ${refusedWithAnswer} refused with an answer, ${hung} without; files ${alive?.files?.open}/${alive?.files?.limit}`);
      check('near the open-file limit, new sockets are refused with an answer instead of hanging', refusedWithAnswer > 0 && hung === 0, `${refusedWithAnswer} refused, ${hung} hung`);
      check('and the health endpoint still answers, with the open-file count in it', Boolean(alive?.files?.limit), JSON.stringify(alive?.files || null));
      sockets.forEach((socket) => { try { socket.terminate(); } catch (_error) { /* gone */ } });
    } finally {
      stopRelay(guarded);
    }
  }

  /* ---- steady: how many people, using it the way people do ---------------- */

  for (const profile of ONLY.has('steady') ? PROFILES.filter((item) => PROFILE_KEYS.has(item.key)) : []) {
    section(`ordinary use — ${profile.name} (${profile.cpus} cores, ${profile.memory}): people arrive, each sends a message every 10 s`);
    const relay = startRelay(profile);
    const workers = [];
    try {
      await waitHealthy(relay);
      let nextId = 1;
      const ask = (worker, command) => new Promise((resolve, reject) => {
        const id = (nextId += 1);
        const onReply = (reply) => {
          if (reply?.id !== id) return;
          worker.off('message', onReply);
          reply.ok ? resolve(reply) : reject(new Error(reply.error || 'worker failed'));
        };
        worker.on('message', onReply);
        worker.send({ ...command, id });
      });
      const count = Number(process.env.PROD_WORKERS || 8);
      for (let index = 0; index < count; index += 1) {
        const worker = fork(fileURLToPath(new URL('./_stress-worker.mjs', import.meta.url)), [], {
          env: { ...process.env, STRESS_SIGNAL_URL: relay.ws, STRESS_WORKER_ID: String(index) },
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        });
        await new Promise((resolve) => worker.once('message', resolve));
        workers.push(worker);
      }
      const levels = String(process.env.PROD_STEADY_LEVELS || '2000,4000,6000,8000').split(',').map(Number);
      let held = 0;
      let next = 0;
      const rows = [];
      console.log('  people    held   failed   msgs/s   p50 ms   p95 ms   p99 ms   lost   relay CPU   RSS MB   files');
      for (const level of levels) {
        const add = level - held;
        if (add <= 0) continue;
        const share = Math.ceil(add / workers.length);
        const connected = await Promise.all(workers.map((worker, index) => ask(worker, { op: 'connect-paced', from: next + index * share, count: share, batch: 25, gapMs: 250 })));
        next += share * workers.length;
        held = connected.reduce((sum, reply) => sum + reply.held, 0);
        const failed = connected.reduce((sum, reply) => sum + reply.failed, 0);
        await sleep(3000);
        let peakCpu = 0;
        const sampler = setInterval(() => { const reading = containerReading(relay); if (reading.cpu > peakCpu) peakCpu = reading.cpu; }, 3000);
        const steady = await Promise.all(workers.map((worker) => ask(worker, { op: 'steady', durationMs: 20000, periodMs: 10000 })));
        clearInterval(sampler);
        const latencies = steady.flatMap((reply) => reply.latencies).sort((a, b) => a - b);
        const at = (fraction) => Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))] || 0);
        const expected = steady.reduce((sum, reply) => sum + reply.expected, 0);
        const delivered = steady.reduce((sum, reply) => sum + reply.delivered, 0);
        const reading = await health(relay);
        const row = { level, held, failed, rate: Math.round(expected / 20), p50: at(0.5), p95: at(0.95), p99: at(0.99), lost: expected - delivered, cpu: Math.round(peakCpu), rss: reading?.memory?.rss, files: reading?.files?.open };
        rows.push(row);
        console.log(`  ${String(level).padStart(6)}  ${String(held).padStart(6)}  ${String(failed).padStart(7)}  ${String(row.rate).padStart(7)}  ${String(row.p50).padStart(7)}  ${String(row.p95).padStart(7)}  ${String(row.p99).padStart(7)}  ${String(row.lost).padStart(5)}  ${String(row.cpu + '%').padStart(10)}  ${String(row.rss).padStart(7)}  ${String(row.files).padStart(6)}`);
        if (failed > held * 0.02) break;
      }
      /* A crowd coming back at once: a thousand dropped together, reconnecting
         together with the app's retries. */
      const dropped = (await Promise.all(workers.map((worker) => ask(worker, { op: 'drop', count: Math.ceil(1000 / workers.length) })))).map((reply) => reply.dropped);
      await sleep(2000);
      const storm = await Promise.all(workers.map((worker, index) => ask(worker, { op: 'reconnect', indices: dropped[index] })));
      const asked = storm.reduce((sum, reply) => sum + reply.asked, 0);
      const back = storm.reduce((sum, reply) => sum + reply.back, 0);
      const seconds = Math.max(...storm.map((reply) => reply.seconds));
      console.log(`  a thousand dropped at once came back: ${back} of ${asked} in ${seconds.toFixed(1)} s`);
      const comfortable = [...rows].reverse().find((row) => row.lost === 0 && row.p95 < 250 && row.failed <= row.held * 0.01);
      report.steady = report.steady || [];
      report.steady.push({ profile: profile.name, rows, storm: { asked, back, seconds }, comfortable });
      check(`${profile.name}: every message delivered at every level reached`, rows.every((row) => row.lost === 0), JSON.stringify(rows.map((row) => [row.level, row.lost])));
      check(`${profile.name}: thousands of people at once with messages under a quarter second`, (comfortable?.held || 0) >= 2000, comfortable ? `${comfortable.held} people, p95 ${comfortable.p95} ms` : 'none');
      check(`${profile.name}: a crowd dropped at once all comes back`, back === asked, `${back} of ${asked}`);
    } finally {
      await Promise.allSettled(workers.map((worker) => new Promise((resolve) => { try { worker.send({ op: 'stop', id: -1 }); } catch (_error) { /* gone */ } setTimeout(resolve, 300); })));
      workers.forEach((worker) => { try { worker.kill(); } catch (_error) { /* gone */ } });
      stopRelay(relay);
    }
  }

  for (const profile of ONLY.has('capacity') ? PROFILES.filter((item) => PROFILE_KEYS.has(item.key)) : []) {
    section(`capacity — ${profile.name} (${profile.cpus} cores, ${profile.memory}, ${profile.nofile} open files)`);
    const relay = startRelay(profile);
    try {
      const first = await waitHealthy(relay);
      console.log(`  relay up: ceiling ${first?.relay?.limits?.wsMaxTotal} sockets, ${containerReading(relay).fds} files open at rest`);
      const { summary, peak } = await runStress(relay, profile.waves);
      const errors = relayErrors(relay);
      const alive = Boolean(await health(relay));
      const clean = summary?.waves?.filter((wave) => !wave.failed && !wave.lost) || [];
      const lastClean = clean[clean.length - 1] || null;
      const comfortable = [...clean].reverse().find((wave) => wave.p95 < 250) || null;
      const row = {
        profile: profile.name, key: profile.key, nofile: profile.nofile,
        connected: summary?.connected || 0, harnessLimited: Boolean(summary?.harnessLimited), ceilingHit: Boolean(summary?.ceilingHit),
        lastClean, comfortable, full: summary?.full || null, calls: summary?.calls || null,
        peak, errors, alive, waves: summary?.waves || [],
      };
      report.profiles.push(row);
      console.log(`  peak: ${peak.cpu.toFixed(0)}% CPU (of ${Number(profile.cpus) * 100}%), ${peak.mem}, ${peak.fds} open files;`
        + ` relay log: ${errors.emfile} EMFILE, ${errors.enomem} out-of-memory, ${errors.fatal} fatal`);
      check(`${profile.name}: the relay is still answering at the end`, alive);
      check(`${profile.name}: it holds several thousand sockets, everything delivered`, (lastClean?.total || 0) >= 3000, `last clean wave ${lastClean?.total || 0} sockets`);
    } finally {
      stopRelay(relay);
    }
  }

  /* ---- persistence: killed outright, nothing lost ------------------------ */

  if (ONLY.has('persistence')) {
  section('persistence — mail for people who are away survives a crash');
  const volume = `poorija-prodtest-data-${Date.now().toString(36)}`;
  docker('volume', 'create', volume);
  const tuned = PROFILES.find((profile) => profile.key === 'fl');
  const relay = startRelay(tuned, { volume });
  try {
    await waitHealthy(relay);
    const recipients = Array.from({ length: 100 }, () => relayTestIdentity());
    const senders = Array.from({ length: 50 }, () => relayTestIdentity());
    const senderClients = [];
    for (const identity of senders) senderClients.push(await client(relay.ws, identity));
    let queued = 0;
    for (const sender of senderClients) sender.socket.on('message', (raw) => { if (String(raw).includes('"queued"')) queued += 1; });
    const perSender = 40;
    const filler = 'x'.repeat(1500);
    const started = Date.now();
    for (let round = 0; round < perSender; round += 1) {
      senderClients.forEach((sender, index) => {
        const to = recipients[(index * 7 + round) % recipients.length];
        sender.socket.send(JSON.stringify({ type: 'relay', toClientId: '', toFingerprint: to.fingerprint, persist: true, tag: `m-${index}-${round}`, payload: { type: 'offline-chat', id: `m-${index}-${round}`, body: { cipher: filler } } }));
      });
      await sleep(25);
    }
    const expected = senders.length * perSender;
    const until = Date.now() + 60000;
    while (queued < expected && Date.now() < until) await sleep(200);
    const queueSeconds = (Date.now() - started) / 1000;
    const before = await health(relay);
    const diskKb = Number(tryDocker('exec', relay.name, 'sh', '-c', 'du -sk /data | cut -f1')) || 0;
    console.log(`  ${queued} of ${expected} queued in ${queueSeconds.toFixed(1)}s; relay ${before?.memory?.rss} MB, /data ${Math.round(diskKb / 1024)} MB`);
    check('every message for an absent person is queued', queued === expected, `${queued}/${expected}`);
    closeAll(senderClients);
    await sleep(3000);
    /* Killed, not stopped: no chance to flush anything on the way out. */
    docker('kill', '-s', 'KILL', relay.name);
    docker('start', relay.name);
    await waitHealthy(relay);
    const delivered = new Set();
    const drainStart = Date.now();
    const recipientClients = [];
    for (const identity of recipients) {
      recipientClients.push(await client(relay.ws, identity, {
        onMessage: (message, self) => {
          if (message.type !== 'relay' || !message.payload?.id) return;
          delivered.add(message.payload.id);
          if (message.relayId) self.socket.send(JSON.stringify({ type: 'relay-ack', ids: [message.relayId] }));
        },
      }));
    }
    const drainUntil = Date.now() + 90000;
    while (delivered.size < expected && Date.now() < drainUntil) await sleep(250);
    const drainSeconds = (Date.now() - drainStart) / 1000;
    console.log(`  after a kill -9 and a restart: ${delivered.size} of ${expected} delivered in ${drainSeconds.toFixed(1)}s`);
    check('nothing queued is lost when the relay is killed and restarted', delivered.size === expected, `${delivered.size}/${expected}`);
    /* The mailbox files themselves: the health reading is a summary cached
       for a while, and what matters is what is on disk. */
    await sleep(4000);
    const leftOnDisk = Number(tryDocker('exec', relay.name, 'sh', '-c', 'cat /data/mailboxes/*.json 2>/dev/null | grep -o "\"relayId\"" | wc -l')) || 0;
    check('and once collected and acknowledged, the relay holds none of it', leftOnDisk === 0, `${leftOnDisk} envelope(s) still on disk`);
    closeAll(recipientClients);
    report.persistence = { expected, queued, delivered: delivered.size, queueSeconds, drainSeconds, diskMb: Math.round(diskKb / 1024), rssMb: before?.memory?.rss };
  } finally {
    stopRelay(relay);
    tryDocker('volume', 'rm', '-f', volume);
  }
  }
  const tunedProfile = PROFILES.find((profile) => profile.key === 'fl');
  let relay = null;

  /* ---- leaks: waves in and out --------------------------------------------- */

  if (ONLY.has('leaks')) {
  section('leaks — sockets opened and closed in waves give everything back');
  relay = startRelay(tunedProfile);
  try {
    await waitHealthy(relay);
    await sleep(2000);
    const rest = { rss: (await health(relay))?.memory?.rss, fds: containerReading(relay).fds };
    const identities = Array.from({ length: 300 }, () => relayTestIdentity());
    const samples = [];
    for (let cycle = 0; cycle < 12; cycle += 1) {
      const wave = [];
      for (let start = 0; start < identities.length; start += 50) {
        const batch = await Promise.allSettled(identities.slice(start, start + 50).map((identity) => client(relay.ws, identity)));
        batch.forEach((outcome) => { if (outcome.status === 'fulfilled') wave.push(outcome.value); });
      }
      wave.forEach((item, index) => item.socket.send(JSON.stringify({ type: 'relay', toClientId: '', toFingerprint: wave[(index + 1) % wave.length].identity.fingerprint, persist: false, payload: { type: 'typing', at: Date.now() } })));
      await sleep(500);
      closeAll(wave);
      await sleep(1500);
      const reading = { rss: (await health(relay))?.memory?.rss, fds: containerReading(relay).fds, opened: wave.length };
      samples.push(reading);
    }
    await sleep(20000);
    const settled = { rss: (await health(relay))?.memory?.rss, fds: containerReading(relay).fds };
    console.log(`  at rest ${rest.rss} MB / ${rest.fds} files · after 12 waves of ${identities.length}: ${settled.rss} MB / ${settled.fds} files`);
    console.log(`  per wave: ${samples.map((sample) => `${sample.rss}MB/${sample.fds}f`).join(' ')}`);
    const growthLate = (samples[samples.length - 1]?.rss || 0) - (samples[5]?.rss || 0);
    check('open files return to where they started', settled.fds <= rest.fds + 5, `${rest.fds} → ${settled.fds}`);
    check('memory levels off instead of climbing wave after wave', growthLate < 40, `+${growthLate} MB over the last six waves`);
    report.leaks = { rest, settled, samples, growthLate };
  } finally {
    stopRelay(relay);
  }
  }

  /* ---- abuse ------------------------------------------------------------------ */

  if (ONLY.has('abuse')) {
  section('abuse — a flood and an oversized frame');
  relay = startRelay(tunedProfile);
  try {
    await waitHealthy(relay);
    const [alice, bob, mallory] = await Promise.all([relayTestIdentity(), relayTestIdentity(), relayTestIdentity()].map((identity) => client(relay.ws, identity)));
    const latencies = [];
    bob.socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'relay' && message.payload?.type === 'probe') latencies.push(Date.now() - message.payload.at);
    });
    let throttled = 0;
    mallory.socket.on('message', (raw) => { if (/rate|throttl|slow-down|too-many/i.test(String(raw))) throttled += 1; });
    let malloryClosed = false;
    mallory.socket.on('close', () => { malloryClosed = true; });
    const probe = setInterval(() => alice.socket.send(JSON.stringify({ type: 'relay', toClientId: '', toFingerprint: bob.identity.fingerprint, persist: false, payload: { type: 'probe', at: Date.now() } })), 50);
    const floodStart = Date.now();
    for (let index = 0; index < 20000 && !malloryClosed; index += 1) {
      if (mallory.socket.readyState !== WebSocket.OPEN) break;
      mallory.socket.send(JSON.stringify({ type: 'get-peers' }));
      if (index % 500 === 0) await sleep(1);
    }
    await sleep(3000);
    clearInterval(probe);
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    console.log(`  flood of up to 20000 frames in ${((Date.now() - floodStart) / 1000).toFixed(1)}s: ${throttled} throttle answers, flooder ${malloryClosed ? 'disconnected' : 'still connected'}; others' p95 ${p95} ms over ${latencies.length} probes`);
    check('a client flooding frames is throttled or cut off', throttled > 0 || malloryClosed);
    check('and everyone else keeps talking at normal speed meanwhile', latencies.length > 20 && p95 < 250, `p95 ${p95} ms`);

    const big = await client(relay.ws, relayTestIdentity());
    let bigClosed = false;
    big.socket.on('close', () => { bigClosed = true; });
    try { big.socket.send('x'.repeat(13 * 1024 * 1024)); } catch (_error) { bigClosed = true; }
    await sleep(3000);
    const stillUp = Boolean(await health(relay));
    check('a frame over the size limit closes only that socket', bigClosed && stillUp && alice.socket.readyState === WebSocket.OPEN);
    report.abuse = { throttled, malloryClosed, probeP95: p95, probes: latencies.length, oversizeClosed: bigClosed };
    closeAll([alice, bob, mallory, big]);
  } finally {
    stopRelay(relay);
  }
  }
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
}

const out = path.join(os.tmpdir(), `poorija-prodready-${Date.now()}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\n  full readings: ${out}`);
console.log(`PRODREADY_REPORT ${JSON.stringify(report)}`);
const failed = results.filter((result) => !result.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
