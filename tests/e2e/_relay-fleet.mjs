/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Any number of real relays (scripts/server.js) on loopback, and clients that
 * prove their key to them the way the app does.
 *
 * Every relay gets its own data directory, identity and ports up front, so a
 * relay's settings can name the others before any of them starts. A relay
 * can be stopped and started again on the same directory and ports, which is
 * a restart as a server sees one.
 *
 *   const fleet = await createFleet(['a1', 'a2'], { env: { a1: (f) => ({...}) } });
 *   await fleet.startAll();
 *   fleet.relays.a1.origin, await fleet.post('a1', '/Monitor_Server/transit', {})
 *   await fleet.stopAll();
 */
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { relayTestIdentity, answerRelayChallenge } from './_relay-identity.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const ids = require(path.join(ROOT, 'scripts', 'lib', 'relay-identity.js'));
const { WebSocket } = require('ws');

export const PASSWORD = 'Local-Test-Only-Password-36';
export const AUTH = 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const short = (id) => String(id || '').slice(0, 16);

export async function waitUntil(test, ms = 15000, step = 250) {
  for (let waited = 0; waited <= ms; waited += step) {
    try {
      if (await test()) return true;
    } catch (_error) { /* not yet */ }
    await sleep(step);
  }
  return false;
}

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

export async function fetchJson(url, { method = 'GET', body, headers = {}, ms = 8000 } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, ...json };
}

export async function createFleet(names, { env = {} } = {}) {
  const used = new Set();
  const port = async () => {
    for (;;) {
      const candidate = await freePort();
      if (!used.has(candidate)) { used.add(candidate); return candidate; }
    }
  };
  const relays = {};
  for (const name of names) {
    const identity = ids.generateRelayIdentity();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `poorija-fleet-${name}-`));
    fs.writeFileSync(path.join(dir, 'relay-identity.json'), JSON.stringify(identity, null, 2), { mode: 0o600 });
    const signal = await port();
    relays[name] = {
      name,
      identity,
      id: identity.id,
      key: ids.publicRelayIdentity(identity).publicKey,
      privateKey: ids.relayPrivateKey(identity),
      dir,
      signal,
      presence: await port(),
      origin: `http://127.0.0.1:${signal}`,
      child: null,
      output: '',
    };
  }
  const fleet = { relays };

  fleet.start = async (name) => {
    const relay = relays[name];
    const own = typeof env[name] === 'function' ? env[name](fleet) : (env[name] || {});
    const child = spawn(process.execPath, ['scripts/server.js'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CHAT_SIGNAL_HOST: '127.0.0.1',
        DOMAIN: '127.0.0.1',
        CHAT_SIGNAL_PORT: String(relay.signal),
        CHAT_PRESENCE_PORT: String(relay.presence),
        CHAT_BOOTSTRAP_PORT: '0',
        PORT: String(relay.signal),
        MONITOR_PASSWORD: PASSWORD,
        TURN_USER: 'local-test',
        TURN_PASSWORD: 'Local-Test-Only-Turn-36',
        TURN_SECRET: 'f'.repeat(64),
        CHAT_TURN_URL: 'turn:127.0.0.1:3478?transport=udp',
        CHAT_RELAY_IDENTITY_PATH: path.join(relay.dir, 'relay-identity.json'),
        CHAT_OFFLINE_STORE_PATH: path.join(relay.dir, 'offline-messages.json'),
        CHAT_OFFLINE_STORE_DIR: path.join(relay.dir, 'mailboxes'),
        CHAT_BEACON_DIR: path.join(relay.dir, 'beacons'),
        CHAT_SIBLING_DIR: path.join(relay.dir, 'siblings'),
        CHAT_ROSTER_DIR: path.join(relay.dir, 'rosters'),
        CHAT_DIRECTORY_PATH: path.join(relay.dir, 'relay-directory.json'),
        CHAT_TRANSIT_PEERS_STORE: path.join(relay.dir, 'transit-peers.json'),
        CHAT_PARTNERS_PATH: path.join(relay.dir, 'relay-partners.json'),
        CHAT_PUSH_STORE_PATH: path.join(relay.dir, 'push.json'),
        CHAT_VAPID_STORE_PATH: path.join(relay.dir, 'vapid.json'),
        CHAT_POLICY_STORE_PATH: path.join(relay.dir, 'policy.json'),
        CHAT_SELF_DESTRUCT_STORE_PATH: path.join(relay.dir, 'self-destruct.json'),
        CHAT_EXPIRY_LOG_PATH: path.join(relay.dir, 'expiry.json'),
        CHAT_TRANSIT_PEERS: '',
        /* Every relay here is on loopback, which a partner's directory may
           otherwise never point at. */
        CHAT_PARTNER_ALLOW_PRIVATE: '1',
        ...own,
      },
    });
    relay.child = child;
    relay.output = '';
    child.stdout.on('data', (chunk) => { relay.output += chunk; });
    child.stderr.on('data', (chunk) => { relay.output += chunk; });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`${name} exited early:\n${relay.output.slice(-3000)}`);
      try {
        const health = await fetchJson(`${relay.origin}/chat-health`, { ms: 1000 });
        if (health.status === 200) return relay;
      } catch (_error) { /* not up yet */ }
      await sleep(100);
    }
    throw new Error(`${name} never answered:\n${relay.output.slice(-3000)}`);
  };

  fleet.stop = async (name) => {
    const child = relays[name].child;
    if (!child || child.exitCode !== null) return;
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([gone, sleep(5000)]);
  };

  fleet.startAll = async () => { for (const name of names) await fleet.start(name); };
  fleet.stopAll = async () => {
    for (const name of names) await fleet.stop(name);
    for (const name of names) fs.rmSync(relays[name].dir, { recursive: true, force: true });
  };

  /* The dashboard, as the admin of that relay. */
  fleet.post = (name, route, body = {}, auth = AUTH) => fetchJson(`${relays[name].origin}${route}`, { method: 'POST', body, headers: auth ? { Authorization: auth } : {} });
  fleet.get = (name, route) => fetchJson(`${relays[name].origin}${route}`);
  fleet.transit = async (name) => fleet.post(name, '/Monitor_Server/transit', {});
  /* The relays this one allows a link with, and those linked now, by the
     first 16 characters of their ids, which is what the dashboard shows. */
  fleet.allowed = async (name) => new Set(((await fleet.transit(name)).peers || []).map((peer) => peer.id));
  fleet.linked = async (name) => new Set(((await fleet.transit(name)).peers || []).filter((peer) => peer.linked).map((peer) => peer.id));

  /* A client of one relay that has proved its key, as the app does. */
  fleet.client = (name, label, identity = relayTestIdentity()) => {
    const socket = new WebSocket(`ws://127.0.0.1:${relays[name].presence}/chat-signal`);
    const inbox = [];
    const waiters = [];
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
      if (answerRelayChallenge(message, identity, socket)) return;
      inbox.push(message);
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        if (waiters[i].match(message)) waiters.splice(i, 1)[0].resolve(message);
      }
    });
    const ready = new Promise((resolve, reject) => {
      socket.on('open', () => {
        socket.send(JSON.stringify({
          type: 'hello', clientId: label, username: label, peerId: label, deviceId: label,
          publicKeyData: identity.publicKeyData, fingerprint: identity.fingerprint,
        }));
        resolve();
      });
      socket.on('error', reject);
    });
    return {
      identity,
      ready,
      inbox,
      send: (payload) => socket.send(JSON.stringify(payload)),
      waitFor(match, ms = 10000) {
        const found = inbox.find(match);
        if (found) return Promise.resolve(found);
        return new Promise((resolve, reject) => {
          const waiter = { match, resolve };
          waiters.push(waiter);
          setTimeout(() => {
            const at = waiters.indexOf(waiter);
            if (at >= 0) waiters.splice(at, 1);
            reject(new Error(`nothing matched within ${ms}ms; saw ${JSON.stringify(inbox.slice(-4)).slice(0, 300)}`));
          }, ms);
        });
      },
      close: () => { try { socket.close(); } catch (_error) { /* gone */ } },
    };
  };
  return fleet;
}
