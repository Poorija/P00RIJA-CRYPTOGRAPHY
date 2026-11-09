/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Three relays of one operator's family on loopback — a home (h) and two
 * relays that may take its people in as guests (g1, g2) — for guest mode
 * (docs/RELAY-NETWORK.md, "Guest mode").
 *
 * The pages are served from a static origin of their own, so stopping a relay
 * or filtering it never takes the page away. Each relay answers at its own
 * proxy address (`url`), which is also the address the signed family list
 * names and the one the relays dial each other at. A door is a second proxy
 * to one relay: a browser configured with a door is cut off from that relay
 * the moment the door is blocked, while every relay link — which goes through
 * `url` — stays up. That is "filtered for one person".
 *
 *   const bed = await startThreeStacks({ guests: { g1: true, g2: true } });
 *   bed.app, bed.relays.h.url, await bed.relays.h.door(), bed.stop('h'), bed.shutdown()
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const ids = require(path.join(root, 'scripts', 'lib', 'relay-identity.js'));
const dirlib = require(path.join(root, 'scripts', 'lib', 'relay-directory.js'));

const AUTH = 'Basic ' + Buffer.from('admin:Local-Test-Only-Password-36').toString('base64');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

/* nginx's split: files from the static server, everything else from the
   relay. Listens on every address, so `localhost` works whichever of ::1 and
   127.0.0.1 a client resolves it to. `blocked` cuts every connection. */
function proxy(staticPort, relayPort, delay = { ms: 0 }) {
  const sockets = new Set();
  let blocked = false;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const candidate = path.join(root, pathname === '/' ? 'index.html' : pathname);
    const isFile = candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    /* A relay further away: every request to it waits this long first. */
    if (!isFile && delay.ms > 0 && !req.__delayed) {
      req.pause();
      setTimeout(() => { req.__delayed = true; server.emit('request', req, res); req.resume(); }, delay.ms);
      return;
    }
    const upstream = http.request({ hostname: '127.0.0.1', port: isFile ? staticPort : relayPort.current, path: req.url, method: req.method, headers: req.headers }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => { try { res.writeHead(502); res.end(); } catch (_error) { /* gone */ } });
    req.pipe(upstream);
  });
  server.on('connection', (socket) => {
    if (blocked) { socket.destroy(); return; }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) => {
    if (blocked) { socket.destroy(); return; }
    const upstream = net.connect(relayPort.current, '127.0.0.1', () => {
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    socket.on('error', () => upstream.destroy());
  });
  return {
    listen: (port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, resolve); }),
    block: () => { blocked = true; sockets.forEach((socket) => socket.destroy()); },
    unblock: () => { blocked = false; },
    close: () => new Promise((resolve) => { sockets.forEach((socket) => socket.destroy()); server.close(() => resolve()); }),
  };
}

export async function startThreeStacks({ guests = { h: false, g1: true, g2: true }, clusters = {}, regions = {}, env = {}, names = ['h', 'g1', 'g2'], delays = {} } = {}) {
  const children = new Map();
  const logs = new Map();
  const proxies = [];
  const staticPort = await freePort();
  const staticChild = spawn(process.execPath, ['scripts/dev-static.js'], { cwd: root, env: { ...process.env, PORT: String(staticPort) }, stdio: ['ignore', 'pipe', 'pipe'] });

  const operatorPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const operatorKey = operatorPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const operator = { pair: operatorPair, key: operatorKey, id: dirlib.operatorIdFor(operatorKey) };

  const relays = {};
  for (const name of names) {
    const identity = ids.generateRelayIdentity();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `poorija-three-${name}-`));
    fs.writeFileSync(path.join(dir, 'relay-identity.json'), JSON.stringify(identity, null, 2), { mode: 0o600 });
    const port = { current: await freePort() };
    const proxyPort = await freePort();
    const delay = { ms: Number(delays[name]) || 0 };
    const front = proxy(staticPort, port, delay);
    await front.listen(proxyPort);
    proxies.push(front);
    relays[name] = {
      name, dir, identity, id: identity.id, key: ids.publicRelayIdentity(identity).publicKey,
      port, signal: port.current, presence: await freePort(), url: `http://localhost:${proxyPort}`, front, delay,
    };
  }

  let serial = 0;
  let entries = names.map((name) => ({
    id: relays[name].id, name, origins: [relays[name].url], region: regions[name] || 'outside-iran', gateway: 0,
    ...(clusters[name] ? { cluster: clusters[name] } : {}),
    ...(guests[name] ? { guests: true } : {}),
  }));
  const signed = () => dirlib.signDirectory({
    v: 1, serial, operator: { id: operator.id, key: operator.key, name: 'Test family' }, relays: entries, revoked: [], signedAt: new Date().toISOString(),
  }, operatorPair.privateKey);
  serial += 1;
  let doc = signed();

  const bed = { relays, operator, app: `http://localhost:${staticPort}`, logs: (name) => logs.get(name)?.() || '' };

  bed.start = async (name) => {
    const relay = relays[name];
    const dir = relay.dir;
    fs.writeFileSync(path.join(dir, 'relay-directory.json'), JSON.stringify(doc));
    const own = typeof env[name] === 'function' ? env[name](bed) : (env[name] || {});
    const child = spawn(process.execPath, ['scripts/server.js'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CHAT_SIGNAL_HOST: '127.0.0.1', CHAT_SIGNAL_PORT: String(relay.signal), CHAT_PRESENCE_PORT: String(relay.presence),
        CHAT_BOOTSTRAP_PORT: '0', PORT: String(relay.signal), DOMAIN: 'localhost', CHAT_ALLOWED_ORIGINS: relay.url,
        CHAT_PUBLIC_RELAY_ORIGIN: relay.url,
        MONITOR_PASSWORD: 'Local-Test-Only-Password-36', TURN_USER: 'local-test', TURN_PASSWORD: 'Local-Test-Only-Turn-36',
        TURN_SECRET: 'b'.repeat(64), CHAT_TURN_URL: 'turn:127.0.0.1:3478?transport=udp',
        CHAT_OPERATOR_KEY: operator.key, CHAT_DIRECTORY_PATH: path.join(dir, 'relay-directory.json'), CHAT_UPDATES_DIR: path.join(dir, 'updates'),
        CHAT_RELAY_IDENTITY_PATH: path.join(dir, 'relay-identity.json'),
        CHAT_OFFLINE_STORE_PATH: path.join(dir, 'offline-messages.json'), CHAT_OFFLINE_STORE_DIR: path.join(dir, 'mailboxes'),
        CHAT_PUSH_STORE_PATH: path.join(dir, 'push.json'), CHAT_VAPID_STORE_PATH: path.join(dir, 'vapid.json'),
        CHAT_POLICY_STORE_PATH: path.join(dir, 'policy.json'), CHAT_SELF_DESTRUCT_STORE_PATH: path.join(dir, 'self-destruct.json'),
        CHAT_EXPIRY_LOG_PATH: path.join(dir, 'expiry.json'), CHAT_TRANSIT_PEERS_STORE: path.join(dir, 'transit-peers.json'),
        CHAT_BEACON_DIR: path.join(dir, 'beacons'), CHAT_SIBLING_DIR: path.join(dir, 'siblings'), CHAT_ROSTER_DIR: path.join(dir, 'rosters'),
        CHAT_PARTNERS_PATH: path.join(dir, 'relay-partners.json'),
        CHAT_KNOWN_IDENTITIES_PATH: path.join(dir, 'known-identities.json'),
        CHAT_TRANSIT_PEERS: '', CHAT_ALERTS: '0',
        ...own,
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    children.set(name, child);
    logs.set(name, () => output);
    for (let i = 0; i < 200; i += 1) {
      if (child.exitCode !== null) throw new Error(`${name} exited early:\n${output.slice(-3000)}`);
      try { if ((await fetch(`http://127.0.0.1:${relay.signal}/chat-health`)).ok) return relay; } catch (_error) { /* not yet */ }
      await sleep(100);
    }
    throw new Error(`${name} never came up:\n${output.slice(-3000)}`);
  };

  bed.stop = async (name) => {
    const child = children.get(name);
    if (!child || child.exitCode !== null) return;
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([gone, sleep(5000)]);
    if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch (_error) { /* gone */ } await sleep(200); }
  };

  bed.post = (name, route, body = {}) => fetch(`http://127.0.0.1:${relays[name].signal}${route}`, {
    method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
  bed.health = (name) => fetch(`http://127.0.0.1:${relays[name].signal}/chat-health`).then((r) => r.json());
  bed.linked = async (name) => new Set(((await bed.post(name, '/Monitor_Server/transit')).peers || []).filter((peer) => peer.linked).map((peer) => peer.fullId || peer.id));

  /* The list again, with some entries changed, at the next serial, handed to
     every relay that is running. */
  bed.sign = async (patch = {}) => {
    entries = entries.map((entry) => {
      const change = patch[entry.name];
      if (!change) return entry;
      const next = { ...entry, ...change };
      for (const [key, value] of Object.entries(change)) if (value === undefined || value === false) delete next[key];
      return next;
    });
    serial += 1;
    doc = signed();
    const answers = {};
    for (const name of names) {
      if (children.get(name)?.exitCode === null) answers[name] = await bed.post(name, '/Monitor_Server/directory', doc);
    }
    return answers;
  };
  bed.directory = () => doc;

  for (const name of names) {
    relays[name].door = async () => {
      const port = await freePort();
      const door = proxy(staticPort, relays[name].port);
      await door.listen(port);
      proxies.push(door);
      return { url: `http://localhost:${port}`, block: door.block, unblock: door.unblock, close: door.close };
    };
  }

  bed.shutdown = async () => {
    for (const name of names) await bed.stop(name);
    for (const door of proxies) await door.close().catch(() => {});
    try { staticChild.kill('SIGTERM'); } catch (_error) { /* gone */ }
    for (const name of names) fs.rmSync(relays[name].dir, { recursive: true, force: true });
  };

  for (const name of names) await bed.start(name);
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${bed.app}/index.html`)).ok) break; } catch (_error) { /* not yet */ }
    await sleep(100);
  }
  return bed;
}
