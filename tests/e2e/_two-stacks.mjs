/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Two complete deployments on loopback, linked to each other — the shape the
 * Finland and Iran servers have, without either of them.
 *
 * Each side is what a server runs: the application served from one origin,
 * that origin's relay (scripts/server.js) answering /chat-health, /peerjs and
 * the presence socket under the same origin, and the two relays joined by a
 * transit link (B dials A, A only answers). A browser opened on one origin is
 * a user of that deployment, exactly as in production: it cannot see the
 * other side's users in presence and cannot reach them over PeerJS, so
 * anything that arrives across has come over the link.
 *
 *   const stacks = await startTwoStacks();
 *   stacks.a.url, stacks.b.url, stacks.stop()
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const ids = require(path.join(root, 'scripts', 'lib', 'relay-identity.js'));

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function proxyTo(staticPort, relayPort) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const candidate = path.join(root, pathname === '/' ? 'index.html' : pathname);
    const isFile = candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    const upstream = http.request({
      hostname: '127.0.0.1', port: isFile ? staticPort : relayPort, path: req.url, method: req.method, headers: req.headers,
    }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(relayPort, '127.0.0.1', () => {
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
        + Object.entries(req.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') + '\r\n\r\n');
      upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    socket.on('error', () => upstream.destroy());
  });
  return { server, sockets };
}

/* `front`: A also answers for B at an address of its own (scripts/lib/
   relay-front.js), as the relay outside Iran does for the one inside — at
   a.frontUrl, through a proxy standing in for nginx's 8586. `bNames` are extra
   origins B calls its own (a public-looking name a client may know B by). */
export async function startTwoStacks({ turnSecret = 'b'.repeat(64), front = false, bNames = [], envA = {}, envB = {} } = {}) {
  const children = [];
  const logs = [];
  const run = (file, env, label) => {
    const child = spawn(process.execPath, [file], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    children.push(child);
    logs.push({ label, read: () => output });
    return child;
  };
  const staticPort = await freePort();
  run('scripts/dev-static.js', { PORT: String(staticPort) }, 'static');

  const identityA = ids.generateRelayIdentity();
  const identityB = ids.generateRelayIdentity();
  const sides = {};
  for (const [name, identity] of [['a', identityA], ['b', identityB]]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `poorija-two-${name}-`));
    fs.writeFileSync(path.join(dir, 'relay-identity.json'), JSON.stringify(identity, null, 2), { mode: 0o600 });
    sides[name] = { dir, identity, signal: await freePort(), presence: await freePort(), proxy: await freePort() };
  }
  if (front) {
    sides.a.frontSignal = await freePort();
    sides.a.frontProxy = await freePort();
    sides.a.frontUrl = `http://localhost:${sides.a.frontProxy}`;
  }
  for (const name of ['a', 'b']) {
    const side = sides[name];
    const other = sides[name === 'a' ? 'b' : 'a'];
    side.url = `http://localhost:${side.proxy}`;
    /* B dials A; A only answers — Iran dialling Finland. */
    const peers = name === 'b' ? `${other.identity.id}@http://127.0.0.1:${other.signal}` : other.identity.id;
    run('scripts/server.js', {
      CHAT_SIGNAL_HOST: '127.0.0.1',
      CHAT_SIGNAL_PORT: String(side.signal),
      CHAT_PRESENCE_PORT: String(side.presence),
      CHAT_BOOTSTRAP_PORT: '0',
      PORT: String(side.signal),
      DOMAIN: 'localhost',
      CHAT_ALLOWED_ORIGINS: side.url,
      MONITOR_PASSWORD: 'Local-Test-Only-Password-36',
      TURN_USER: 'local-test',
      TURN_PASSWORD: 'Local-Test-Only-Turn-36',
      TURN_SECRET: turnSecret,
      CHAT_TURN_URL: `turn:127.0.0.1:3478?transport=udp`,
      CHAT_OFFLINE_STORE_PATH: path.join(side.dir, 'offline-messages.json'),
      /* Named outright: a runner that set these for its own stack would
         otherwise hand both sides ITS directories, and every check that reads
         a side's mailbox would read somebody else's (an empty one). */
      CHAT_OFFLINE_STORE_DIR: path.join(side.dir, 'mailboxes'),
      CHAT_BEACON_DIR: path.join(side.dir, 'beacons'),
      CHAT_SIBLING_DIR: path.join(side.dir, 'siblings'),
      CHAT_PUSH_STORE_PATH: path.join(side.dir, 'push.json'),
      CHAT_VAPID_STORE_PATH: path.join(side.dir, 'vapid.json'),
      CHAT_POLICY_STORE_PATH: path.join(side.dir, 'policy.json'),
      CHAT_SELF_DESTRUCT_STORE_PATH: path.join(side.dir, 'self-destruct.json'),
      CHAT_EXPIRY_LOG_PATH: path.join(side.dir, 'expiry.json'),
      CHAT_TRANSIT_PEERS: peers,
      ...(front && name === 'a' ? { CHAT_FRONTS: `${other.identity.id}@${side.frontUrl}`, CHAT_FRONT_PORT: String(side.frontSignal) } : {}),
      ...(front && name === 'b' ? {
        /* B's own name, which is what B tells the door it is called. */
        ...(bNames.length ? { DOMAIN: new URL(bNames[0]).hostname } : {}),
        CHAT_FRONT_DOORS: other.identity.id,
        CHAT_MIRROR_ORIGINS: other.frontUrl,
        CHAT_ALLOWED_ORIGINS: [side.url, ...bNames].join(','),
      } : {}),
      /* Whatever a suite needs one side to carry on top — a fake Telegram, an
         upstream to ask. Functions are called with both sides, so one side
         can name the other's address. */
      ...Object.fromEntries(Object.entries(name === 'a' ? envA : envB).map(([key, value]) => [key, typeof value === 'function' ? value(sides) : value])),
    }, `relay-${name}`);
    side.proxyServer = proxyTo(staticPort, side.signal);
    await new Promise((resolve, reject) => {
      side.proxyServer.server.once('error', reject);
      side.proxyServer.server.listen(side.proxy, '127.0.0.1', resolve);
    });
    if (front && name === 'a') {
      side.frontProxyServer = proxyTo(staticPort, side.frontSignal);
      await new Promise((resolve, reject) => {
        side.frontProxyServer.server.once('error', reject);
        side.frontProxyServer.server.listen(side.frontProxy, '127.0.0.1', resolve);
      });
    }
  }
  const ready = async (url) => {
    for (let i = 0; i < 150; i += 1) {
      try {
        const page = await fetch(`${url}/index.html`);
        const health = await fetch(`${url}/chat-health`).then((r) => r.json());
        if (page.ok && health?.transit?.up >= 1) return health;
      } catch (_error) { /* not yet */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`stack at ${url} never came up:\n${logs.map((l) => `--- ${l.label}\n${l.read().slice(-1500)}`).join('\n')}`);
  };
  sides.a.health = await ready(sides.a.url);
  sides.b.health = await ready(sides.b.url);
  return {
    a: sides.a,
    b: sides.b,
    logs,
    async stop() {
      for (const side of [sides.a, sides.b]) {
        for (const proxy of [side.proxyServer, side.frontProxyServer]) {
          proxy?.sockets.forEach((socket) => socket.destroy());
          proxy?.server.close();
        }
      }
      for (const child of children) { try { child.kill('SIGTERM'); } catch (_error) { /* gone */ } }
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
  };
}
