/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A relay reachable at two addresses, and an impostor that claims to be one.
 *
 *   MAIN and MIRROR both lead to the same relay; IMPOSTOR is another relay
 *   with its own key, and the published mirror list names it too. The app is
 *   opened at MAIN, learns the list, and then MAIN goes dark — the way a
 *   blocked domain does. The client must move to MIRROR, never to IMPOSTOR,
 *   keep the configured address as it was, and come back to MAIN once MAIN
 *   answers again.
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { openApp, browser, waitFor } from './_chat-harness.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const ids = require(path.join(root, 'scripts', 'lib', 'relay-identity.js'));
const { sealTransit } = require(path.join(root, 'scripts', 'lib', 'relay-transit.js'));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

/* The same split a deployment's nginx makes: files from the static server,
   everything else to the relay. */
function proxy(staticPort, relayPort) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const candidate = path.join(root, pathname === '/' ? 'index.html' : pathname);
    const isFile = candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    const upstream = http.request({ hostname: '127.0.0.1', port: isFile ? staticPort : relayPort, path: req.url, method: req.method, headers: req.headers }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(relayPort, '127.0.0.1', () => {
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
    listen: (port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }),
    close: () => new Promise((resolve) => { sockets.forEach((socket) => socket.destroy()); server.close(() => resolve()); }),
  };
}

const children = [];
const logs = [];
const run = (file, env, label) => {
  const child = spawn(process.execPath, [file], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (c) => { output += c; });
  child.stderr.on('data', (c) => { output += c; });
  children.push(child);
  logs.push({ label, read: () => output });
};
async function startRelay(name, { allowed, mirrors = '' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `poorija-mirror-${name}-`));
  const identity = ids.generateRelayIdentity();
  fs.writeFileSync(path.join(dir, 'relay-identity.json'), JSON.stringify(identity, null, 2), { mode: 0o600 });
  const signal = await freePort();
  run('scripts/server.js', {
    CHAT_SIGNAL_HOST: '127.0.0.1', CHAT_SIGNAL_PORT: String(signal), CHAT_PRESENCE_PORT: String(await freePort()),
    CHAT_BOOTSTRAP_PORT: '0', PORT: String(signal), DOMAIN: 'localhost',
    CHAT_ALLOWED_ORIGINS: allowed, CHAT_MIRROR_ORIGINS: mirrors,
    MONITOR_PASSWORD: 'Local-Test-Only-Password-36', TURN_USER: 'local-test', TURN_PASSWORD: 'Local-Test-Only-Turn-36',
    CHAT_OFFLINE_STORE_PATH: path.join(dir, 'offline-messages.json'), CHAT_PUSH_STORE_PATH: path.join(dir, 'push.json'),
    CHAT_VAPID_STORE_PATH: path.join(dir, 'vapid.json'), CHAT_POLICY_STORE_PATH: path.join(dir, 'policy.json'),
    CHAT_SELF_DESTRUCT_STORE_PATH: path.join(dir, 'self-destruct.json'), CHAT_EXPIRY_LOG_PATH: path.join(dir, 'expiry.json'),
  }, `relay-${name}`);
  return { identity, signal, dir };
}
const ready = async (url) => {
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(`${url}/chat-health`)).ok) return true; } catch (_error) { /* not yet */ }
    await sleep(200);
  }
  throw new Error(`${url} never came up:\n${logs.map((l) => `--- ${l.label}\n${l.read().slice(-1200)}`).join('\n')}`);
};

const staticPort = await freePort();
run('scripts/dev-static.js', { PORT: String(staticPort) }, 'static');
const mainPort = await freePort();
const mirrorPort = await freePort();
const impostorPort = await freePort();
const MAIN = `http://localhost:${mainPort}`;
const MIRROR = `http://localhost:${mirrorPort}`;
const IMPOSTOR = `http://localhost:${impostorPort}`;
const relay = await startRelay('real', { allowed: `${MAIN},${MIRROR}`, mirrors: `${IMPOSTOR} ${MIRROR}` });
const fake = await startRelay('impostor', { allowed: `${MAIN},${IMPOSTOR}` });
let mainProxy = proxy(staticPort, relay.signal);
const mirrorProxy = proxy(staticPort, relay.signal);
const impostorProxy = proxy(staticPort, fake.signal);
await mainProxy.listen(mainPort);
await mirrorProxy.listen(mirrorPort);
await impostorProxy.listen(impostorPort);

try {
  await ready(MAIN); await ready(MIRROR); await ready(IMPOSTOR);
  section('the relay\'s own answers');
  const list = await (await fetch(`${MAIN}/relay-mirrors`)).json();
  check('it publishes its mirrors beside its own id', list.relayId === relay.identity.id && list.origins.includes(MIRROR), JSON.stringify(list.origins));
  const notAProof = await fetch(`${MAIN}/relay-prove`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envelope: sealTransit(relay.identity.id, ids.publicRelayIdentity(relay.identity).publicKey, { type: 'relay', toFingerprint: 'ab'.repeat(32), payload: { secret: 'x' } }) }),
  });
  const notAProofBody = await notAProof.json();
  check('it will not open an envelope that is not a proof', notAProof.status === 400 && notAProofBody.reason === 'not-a-proof' && !JSON.stringify(notAProofBody).includes('secret'), JSON.stringify(notAProofBody));

  section('the app, opened at the main address');
  const USER = await openApp('USER', { origin: MAIN, relay: MAIN });
  const learnt = await USER.evaluate(async () => learnRelayMirrors({ force: true }));
  check('it learns the mirror list from its relay, vouched for by the relay\'s key', Array.isArray(learnt) && learnt.includes(MIRROR) && learnt.includes(IMPOSTOR), JSON.stringify(learnt));
  const tampered = await USER.evaluate(async (evil) => {
    /* A path that rewrites the answer — one more address in the list —
       without the secret only the relay could read. */
    const realFetch = window.fetch;
    window.fetch = async (url, options) => {
      const response = await realFetch(url, options);
      if (!String(url).endsWith('/relay-mirrors') || options?.method !== 'POST') return response;
      const body = await response.json();
      body.origins = [...body.origins, evil];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const pin = relayPinFor(chatServerOrigin());
      delete chatState.profile.relayMirrors[pin.id];
      const result = await learnRelayMirrors({ force: true });
      return { result, kept: Boolean(chatState.profile.relayMirrors?.[pin.id]) };
    } finally {
      window.fetch = realFetch;
    }
  }, 'https://evil.example');
  check('a list altered on the way is refused, and nothing of it is kept', !tampered.result.includes('https://evil.example') && tampered.kept === false, JSON.stringify(tampered));
  await USER.evaluate(async () => learnRelayMirrors({ force: true }));
  const proofs = await USER.evaluate(async ({ mirror, impostor }) => {
    const pin = relayPinFor(chatServerOrigin());
    return { mirror: await proveRelayAt(mirror, pin), impostor: await proveRelayAt(impostor, pin) };
  }, { mirror: MIRROR, impostor: IMPOSTOR });
  check('the real mirror proves it holds the relay\'s key', proofs.mirror === true);
  check('the impostor in the list cannot', proofs.impostor === false);

  section('the main address goes dark');
  await mainProxy.close();
  const down = await waitFor(USER, () => !(chatState.connected && chatState.ws?.readyState === WebSocket.OPEN), { timeoutMs: 30000 });
  check('the connection drops', down === true);
  await USER.evaluate(() => attemptRelayFailover());
  const moved = await waitFor(USER, (mirror) => chatServerOrigin() === mirror && chatState.connected && chatState.ws?.readyState === WebSocket.OPEN, { timeoutMs: 45000, arg: MIRROR });
  const state = await USER.evaluate(() => ({ origin: chatServerOrigin(), configured: chatState.profile.serverUrl, mirror: chatState.profile.activeMirror?.origin || '' }));
  check('it reconnects through the mirror — not the impostor', moved === true && state.origin === MIRROR, JSON.stringify(state));
  check('and the configured address is left exactly as it was', String(state.configured).replace(/\/$/, '') === MAIN, state.configured);

  section('the main address comes back');
  mainProxy = proxy(staticPort, relay.signal);
  await mainProxy.listen(mainPort);
  await USER.evaluate(() => checkPrimaryWhileOnMirror());
  const back = await waitFor(USER, (main) => chatServerOrigin() === main && !chatState.profile.activeMirror && chatState.connected, { timeoutMs: 45000, arg: MAIN });
  check('it goes back to the main address, and forgets the detour', back === true);

  check('no page errors', !(USER.__errors || []).length, (USER.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await Promise.all([mainProxy.close(), mirrorProxy.close(), impostorProxy.close()].map((p) => p.catch(() => {})));
  for (const child of children) { try { child.kill('SIGTERM'); } catch (_error) { /* gone */ } }
  await sleep(300);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
