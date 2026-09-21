/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A notification the vendor is allowed to sit on is a notification nobody gets.
 *
 * Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
 *
 *   node tests/e2e/pushurgency.mjs        # brings its own relay, needs nothing running
 *
 * web-push sets `Urgency: normal` on every request unless it is told otherwise,
 * and it sends the header either way — `let urgency = NORMAL` near the top of
 * web-push-lib.js, `requestDetails.headers.Urgency = urgency` near the bottom.
 * `normal` is precisely the value that lets FCM and APNs hold a message until
 * the device's next maintenance window, so a phone in Doze stayed silent and
 * the whole pile arrived the moment somebody picked it up. The message was
 * delivered, the ticks were right, and the person was never told.
 *
 * Unlike awaypush, which counts TCP connections because "did the relay reach
 * for it" is all that one asks, this suite has to READ what the relay said. So
 * the vendor speaks TLS: web-push always uses https.request, whatever scheme
 * the endpoint carries. That is also why the relay is spawned here rather than
 * borrowed — it is handed the stand-in's certificate as a trusted CA, and a
 * scratch data directory so a probe subscription never lands in anybody's real
 * store. Certificate verification stays ON: this trusts exactly one loopback
 * certificate generated seconds earlier, which is not the same thing as
 * trusting whatever answers. */
import { WebSocket } from 'ws';
import crypto from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

/* A self-signed pair, generated here so the suite carries no key material and
   nothing has to be regenerated when it expires. */
function selfSigned() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-vendor-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  /* The IP goes in a subjectAltName, not just the CN: Node verifies an
     address against the SAN and ignores a CN that only looks right. */
  spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', keyPath, '-out', certPath,
  ], { stdio: 'ignore' });
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), certPath, dir };
}

const signalPort = await freePort();
const presencePort = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-pushurgency-'));

const vendorCert = selfSigned();
const seen = [];
const vendor = https.createServer({ key: vendorCert.key, cert: vendorCert.cert }, (req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    seen.push({ url: req.url, headers: req.headers, bytes: Buffer.concat(chunks).length });
    res.writeHead(201).end();
  });
});
await new Promise((resolve) => vendor.listen(0, '127.0.0.1', resolve));
const vendorPort = vendor.address().port;

const relay = spawn(process.execPath, [path.join(ROOT, 'scripts', 'server.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    CHAT_SIGNAL_PORT: String(signalPort),
    CHAT_PRESENCE_PORT: String(presencePort),
    CHAT_PUSH_STORE_PATH: path.join(dataDir, 'push-subscriptions.json'),
    CHAT_VAPID_STORE_PATH: path.join(dataDir, 'vapid.json'),
    CHAT_OFFLINE_STORE_PATH: path.join(dataDir, 'offline-messages.json'),
    CHAT_OFFLINE_STORE_DIR: path.join(dataDir, 'mailboxes'),
    /* Trust this one stand-in, rather than turning verification off. */
    NODE_EXTRA_CA_CERTS: vendorCert.certPath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const relayLog = [];
relay.stdout.on('data', (b) => relayLog.push(b.toString()));
relay.stderr.on('data', (b) => relayLog.push(b.toString()));

const RELAY = `http://127.0.0.1:${signalPort}`;
const WS_URL = `ws://127.0.0.1:${presencePort}/chat-signal`;
for (let tries = 0; tries < 60; tries += 1) {
  try {
    const health = await fetch(`${RELAY}/chat-health`);
    if (health.ok) break;
  } catch (_error) { /* not up yet */ }
  await wait(250);
}

const shutdown = () => {
  try { relay.kill('SIGKILL'); } catch (_error) { /* already gone */ }
  try { vendor.close(); } catch (_error) { /* already closed */ }
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(vendorCert.dir, { recursive: true, force: true });
};

/* Same handshake as awaypush: only a socket that has proved it holds the key
   behind its fingerprint can be routed to, so a probe that skips the challenge
   silently tests the offline branch instead of the one it means to. */
const openPeer = (name) => new Promise((resolve, reject) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const fingerprint = crypto.createHash('sha256').update(spki).digest('hex');
  const peerId = `probe-${name}-${crypto.randomUUID()}`;
  const ws = new WebSocket(`${WS_URL}?fingerprint=${fingerprint}&peerId=${peerId}&username=${name}`);
  const inbox = [];
  let verified = false;
  ws.on('message', (raw) => {
    let parsed;
    try { parsed = JSON.parse(raw.toString()); } catch (_error) { return; }
    inbox.push(parsed);
    if (parsed.type === 'id-challenge') {
      const nonce = crypto.privateDecrypt(
        { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(parsed.cipher, 'base64'),
      );
      ws.send(JSON.stringify({ type: 'id-proof', nonce: nonce.toString('base64') }));
      verified = true;
    }
  });
  ws.on('error', reject);
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'hello', username: name, peerId, fingerprint, publicKeyData: spki.toString('base64') }));
    const waitForProof = (tries = 0) => {
      if (verified || tries > 40) return resolve({ ws, inbox, fingerprint, peerId, name });
      setTimeout(() => waitForProof(tries + 1), 100);
    };
    waitForProof();
  });
});

try {
  const A = await openPeer('sender');
  const B = await openPeer('receiver');
  await wait(800);
  check('both probes proved their identity to the relay',
    [A, B].every((peer) => peer.inbox.some((m) => ['id-verified', 'peers', 'welcome'].includes(m.type))),
    'an unverified socket cannot be routed to by fingerprint');

  /* Real ECDH material: web-push encrypts the body to these before it sends,
     and refuses a row it cannot encrypt to. */
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const subscribed = await fetch(`${RELAY}/push/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fingerprint: B.fingerprint,
      ttlDays: 30,
      lang: 'en',
      subscription: {
        endpoint: `https://127.0.0.1:${vendorPort}/send/urgency-probe`,
        keys: {
          p256dh: ec.publicKey.export({ type: 'spki', format: 'der' }).subarray(26).toString('base64url'),
          auth: crypto.randomBytes(16).toString('base64url'),
        },
      },
    }),
  });
  check('the receiver has a push subscription the relay can reach', subscribed.ok);

  /* Away, not gone — the path a backgrounded phone takes. */
  B.ws.send(JSON.stringify({ type: 'presence-state', state: 'away' }));
  await wait(600);

  const send = async (payload) => {
    seen.length = 0;
    A.ws.send(JSON.stringify({ type: 'relay', toFingerprint: B.fingerprint, persist: true, payload }));
    for (let tries = 0; tries < 40 && !seen.length; tries += 1) await wait(100);
    return seen[0];
  };

  console.log('\n===== a message to a sleeping phone =====');
  const chat = await send({
    type: 'offline-chat', inner: 'text', class: 'text', seal: '',
    message: { type: 'text', id: crypto.randomUUID() },
  });
  check('the relay reached the vendor', Boolean(chat), `${seen.length} request(s)`);
  check('THE VENDOR IS TOLD NOT TO WAIT — the bug this suite exists for',
    String(chat?.headers?.urgency) === 'high',
    `Urgency: ${chat?.headers?.urgency ?? '(header absent)'}; "normal" is what lets FCM and APNs hold it until the device wakes`);
  check('the body is still encrypted to the subscription', (chat?.bytes || 0) > 0, `${chat?.bytes || 0} bytes`);
  /* The library's default is four weeks, which for a chat message means a phone
     that was off over a holiday lights up with a fortnight of stale banners. */
  const chatTtl = Number(chat?.headers?.ttl);
  check('a chat notice expires in a day, not the library default of four weeks',
    Number.isFinite(chatTtl) && chatTtl > 0 && chatTtl <= 86400,
    `TTL: ${chat?.headers?.ttl ?? '(absent)'}`);

  console.log('\n===== a call to the same phone =====');
  const call = await send({
    type: 'offline-chat', inner: 'call-invite', signal: 'call-invite', mode: 'voice', class: 'text', seal: '',
    message: { type: 'call-invite', id: crypto.randomUUID() },
  });
  check('a call invite is urgent too', String(call?.headers?.urgency) === 'high',
    `Urgency: ${call?.headers?.urgency ?? '(absent)'}`);
  /* A ringing notice that lands after the call ended is worse than none: the
     person calls back into silence. */
  const callTtl = Number(call?.headers?.ttl);
  check('and stops being worth delivering in minutes, not days',
    Number.isFinite(callTtl) && callTtl > 0 && callTtl <= 300,
    `TTL: ${call?.headers?.ttl ?? '(absent)'}`);

  A.ws.close();
  B.ws.close();
} finally {
  shutdown();
}

const bad = results.filter((ok) => !ok);
if (bad.length && !results[0]) console.log(relayLog.join('').slice(-1200));
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
