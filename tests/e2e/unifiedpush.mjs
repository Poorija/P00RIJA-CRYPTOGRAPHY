/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Waking an Android phone without Google in the path.
 *
 * Android's WebView implements service workers but does not expose the Push
 * API to them -- that is a Chrome feature -- so the browser build's push route
 * does not exist inside the native shell. FCM is one answer and puts Google
 * back in the middle of a suite whose whole premise is that nothing but the
 * chosen relay sees any traffic. UnifiedPush is the other: a distributor app
 * the person chose holds the socket, and the relay POSTs to a URL that
 * distributor handed out.
 *
 * This drives the real relay over its real socket and checks what actually
 * arrives at the endpoint, because the interesting question is not whether the
 * code runs but what it sends. The payload must stay contentless: a body that
 * named the sender would hand the distributor exactly what the encryption is
 * there to keep from it.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import crypto from 'node:crypto';
import { relayTestIdentity, answerRelayChallenge } from './_relay-identity.mjs';

/* The same ceremony the presence socket uses, over HTTP: ask for a challenge,
   decrypt it with the private key behind the fingerprint, hand it back. */
async function proveAndSubscribe(port, identity, subscription) {
  const challenge = await fetch(`http://127.0.0.1:${port}/push/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fingerprint: identity.fingerprint, publicKeyData: identity.publicKeyData }),
  }).then((r) => r.json());
  if (!challenge.ok) return { ok: false, reason: challenge.reason, stage: 'challenge' };
  const nonce = crypto.privateDecrypt(
    { key: identity.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(challenge.cipher, 'base64'),
  ).toString('base64');
  return fetch(`http://127.0.0.1:${port}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fingerprint: identity.fingerprint,
      subscription,
      challengeId: challenge.challengeId,
      nonce,
    }),
  }).then((r) => r.json());
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIGNAL_PORT = 9411;
const PRESENCE_PORT = 9412;
const SINK_PORT = 9413;
const PASSWORD = 'unifiedpush-suite-password-2026';

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

// ---- a stand-in for the distributor app on the phone ---------------------
const delivered = [];
const sink = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    delivered.push({ path: req.url, method: req.method, body });
    // /gone answers 410 so the pruning path can be exercised too.
    res.writeHead(req.url.includes('gone') ? 410 : 200);
    res.end('ok');
  });
});
await new Promise((resolve) => sink.listen(SINK_PORT, resolve));

// ---- the relay, in the layout its Dockerfile builds ----------------------
const work = mkdtempSync(join(tmpdir(), 'poorija-up-'));
const libDir = join(ROOT, 'standalone-relay', 'lib');
const libFile = join(libDir, 'push-wording.js');
const libWasMissing = !existsSync(libFile);
if (libWasMissing) {
  mkdirSync(libDir, { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'lib', 'push-wording.js'), libFile);
}

const relay = spawn(process.execPath, [join(ROOT, 'standalone-relay', 'server.js')], {
  env: {
    ...process.env,
    MONITOR_PASSWORD: PASSWORD,
    CHAT_SIGNAL_PORT: String(SIGNAL_PORT),
    CHAT_PRESENCE_PORT: String(PRESENCE_PORT),
    CHAT_POLICY_STORE_PATH: join(work, 'policy.json'),
    CHAT_OFFLINE_STORE_PATH: join(work, 'offline.json'),
    CHAT_PUSH_STORE_PATH: join(work, 'push.json'),
    /* The sink below is on loopback, which the SSRF guard refuses by design.
       This is the same development-only escape hatch the relay already uses
       for ALLOW_INSECURE_DEFAULTS, and the guard itself is exercised by a
       second relay started without it. */
    CHAT_ALLOW_PRIVATE_PUSH_ENDPOINTS: '1',
  },
  stdio: 'ignore',
});

function cleanup() {
  /* Every step guarded: a relay still writing its policy file as the directory
     goes makes rmSync throw ENOTEMPTY, and a cleanup failure that masks the
     result is worse than a leftover temp directory. */
  try { relay.kill(); } catch (_error) { /* already gone */ }
  try { sink.close(); } catch (_error) { /* already closed */ }
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (_error) { /* the OS will reap it */ }
  if (libWasMissing) {
    try { rmSync(libDir, { recursive: true, force: true }); } catch (_error) { /* ignore */ }
  }
}
process.on('exit', cleanup);

async function relayUp() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${SIGNAL_PORT}/chat-health`)).ok) return true;
    } catch (_error) { /* not yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function connect(identity) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PRESENCE_PORT}/chat-signal`);
    const timer = setTimeout(() => reject(new Error('handshake timed out')), 15000);
    socket.on('open', () => socket.send(JSON.stringify({
      type: 'hello',
      username: 'suite',
      peerId: `peer-${identity.fingerprint.slice(0, 8)}`,
      publicKeyData: identity.publicKeyData,
      fingerprint: identity.fingerprint,
    })));
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch (_error) { return; }
      if (answerRelayChallenge(message, identity, socket)) return;
      if (message.type === 'welcome' || message.type === 'peers' || message.type === 'registered') {
        clearTimeout(timer);
        resolve(socket);
      }
    });
    socket.on('error', reject);
  });
}

console.log('\nUnifiedPush delivery');

if (!await relayUp()) {
  console.log('  FAIL  the relay did not start');
  process.exit(1);
}

const sender = relayTestIdentity();
const recipient = relayTestIdentity();

// The recipient is never connected: that is the whole point -- a phone with
// the app closed is exactly what needs waking.
const subscribe = await proveAndSubscribe(SIGNAL_PORT, recipient, {
  type: 'unifiedpush',
  endpoint: `http://127.0.0.1:${SINK_PORT}/up/device-1`,
  lang: 'en',
});
ok(subscribe.ok === true, 'a UnifiedPush endpoint is accepted without Web Push keys');

const noKeys = await proveAndSubscribe(SIGNAL_PORT, recipient, { endpoint: 'https://fcm.example.invalid/x' });
ok(noKeys.ok === false, 'a browser subscription with no keys is still refused');

const notHttp = await proveAndSubscribe(SIGNAL_PORT, recipient, { type: 'unifiedpush', endpoint: 'javascript:alert(1)' });
ok(notHttp.ok === false, 'an endpoint that is not http(s) is refused');

// ---- the real path: relay a message to somebody who is not here ----------
const socket = await connect(sender);
/* persist is what turns "they are not here" into "queue it and wake them";
   without it the relay answers target-offline and nobody is woken, which is
   the correct behaviour for a message that is not worth storing. */
socket.send(JSON.stringify({
  type: 'relay',
  toFingerprint: recipient.fingerprint,
  persist: true,
  payload: { type: 'chat', sealed: 'this is opaque to the relay' },
  tag: 'suite-1',
}));

for (let i = 0; i < 40 && delivered.length === 0; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
socket.close();

ok(delivered.length > 0, 'the relay POSTs to the distributor endpoint');

if (delivered.length > 0) {
  const hit = delivered[0];
  ok(hit.method === 'POST', 'it is a POST');
  ok(hit.path === '/up/device-1', 'it goes to the endpoint the phone handed out');
  let payload = {};
  try { payload = JSON.parse(hit.body); } catch (_error) { /* checked below */ }
  ok(typeof payload.title === 'string' && payload.title.length > 0, 'the body is the same shaped payload the browser path sends');

  /* The reason a bare URL is acceptable as a transport. If any of these ever
     appear, the distributor has been handed what the encryption exists to
     keep from it. */
  const asText = hit.body;
  ok(!asText.includes(sender.fingerprint), 'it does not name the sender');
  ok(!asText.includes('this is opaque to the relay'), 'it carries no message content');
  ok(!asText.includes(recipient.fingerprint), 'it does not name the recipient either');
}

// ---- the guard itself ---------------------------------------------------
/* /push/subscribe takes no credentials, so the endpoint URL is
   attacker-controlled and this process will POST to it. Without a check that
   is an unauthenticated SSRF: aim it at the cloud metadata address and the
   relay knocks on it from inside the perimeter. These run against a second
   relay started WITHOUT the development escape hatch. */
const guarded = spawn(process.execPath, [join(ROOT, 'standalone-relay', 'server.js')], {
  env: {
    ...process.env,
    MONITOR_PASSWORD: PASSWORD,
    CHAT_SIGNAL_PORT: String(SIGNAL_PORT + 100),
    CHAT_PRESENCE_PORT: String(PRESENCE_PORT + 100),
    CHAT_POLICY_STORE_PATH: join(work, 'g-policy.json'),
    CHAT_OFFLINE_STORE_PATH: join(work, 'g-offline.json'),
    CHAT_PUSH_STORE_PATH: join(work, 'g-push.json'),
    CHAT_ALLOW_PRIVATE_PUSH_ENDPOINTS: '',
  },
  stdio: 'ignore',
});
process.on('exit', () => guarded.kill());

for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(`http://127.0.0.1:${SIGNAL_PORT + 100}/chat-health`)).ok) break; }
  catch (_error) { /* not yet */ }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function trySubscribe(endpoint) {
  return proveAndSubscribe(SIGNAL_PORT + 100, recipient, { type: 'unifiedpush', endpoint });
}

for (const [endpoint, label] of [
  ['http://169.254.169.254/latest/meta-data/', 'the cloud metadata address'],
  ['http://127.0.0.1:9099/admin/broadcast', 'loopback'],
  ['http://10.0.0.5/internal', 'an RFC1918 address'],
  ['http://192.168.1.1/', 'a home router'],
  ['http://[::1]:9099/', 'IPv6 loopback'],
  ['http://0.0.0.0:9099/', 'the unspecified address'],
]) {
  const result = await trySubscribe(endpoint);
  ok(result.ok === false, `${label} is refused as a push endpoint`);
}

// ---- a subscription has to belong to the fingerprint it names -----------
/* Without proof, anyone reaching the relay could register THEIR endpoint
   against SOMEBODY ELSE'S fingerprint and learn every time that person was
   sent a message -- who talks to whom and when, the one thing encryption
   cannot hide. Five such rows also displaced the real device from a list
   capped at five, so the victim stopped being woken at all. */
const attacker = relayTestIdentity();

const noProof = await fetch(`http://127.0.0.1:${SIGNAL_PORT}/push/subscribe`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fingerprint: recipient.fingerprint,
    subscription: { type: 'unifiedpush', endpoint: `http://127.0.0.1:${SINK_PORT}/stolen` },
  }),
}).then((r) => r.json());
ok(noProof.ok === false, 'a subscription with no proof at all is refused');

/* The attacker holds a real key and can pass their OWN challenge. What they
   must not be able to do is spend it on somebody else's fingerprint. */
const ownChallenge = await fetch(`http://127.0.0.1:${SIGNAL_PORT}/push/challenge`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fingerprint: attacker.fingerprint, publicKeyData: attacker.publicKeyData }),
}).then((r) => r.json());
ok(ownChallenge.ok === true, 'anybody can ask for a challenge on their own fingerprint');

const stolenNonce = crypto.privateDecrypt(
  { key: attacker.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
  Buffer.from(ownChallenge.cipher, 'base64'),
).toString('base64');

const crossUse = await fetch(`http://127.0.0.1:${SIGNAL_PORT}/push/subscribe`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fingerprint: recipient.fingerprint,
    subscription: { type: 'unifiedpush', endpoint: `http://127.0.0.1:${SINK_PORT}/stolen` },
    challengeId: ownChallenge.challengeId,
    nonce: stolenNonce,
  }),
}).then((r) => r.json());
ok(crossUse.ok === false, 'a challenge solved for one fingerprint cannot be spent on another');

/* Claiming a fingerprint with a key that does not hash to it is the same lie
   one step earlier, and the hello handler refuses it for the same reason. */
const mismatched = await fetch(`http://127.0.0.1:${SIGNAL_PORT}/push/challenge`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fingerprint: recipient.fingerprint, publicKeyData: attacker.publicKeyData }),
}).then((r) => r.json());
ok(mismatched.ok === false, 'a key that does not hash to the claimed fingerprint is refused a challenge');

/* A nonce is spent on use, right or wrong, so it cannot be ground at. */
const replay = await fetch(`http://127.0.0.1:${SIGNAL_PORT}/push/subscribe`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fingerprint: attacker.fingerprint,
    subscription: { type: 'unifiedpush', endpoint: `http://127.0.0.1:${SINK_PORT}/replay` },
    challengeId: ownChallenge.challengeId,
    nonce: stolenNonce,
  }),
}).then((r) => r.json());
ok(replay.ok === false, 'a challenge cannot be replayed once it has been spent');

// ---- the poll fallback, for a phone with no distributor ----------------
/* "Does this fingerprint have mail waiting" is exactly the metadata the rest
   of the relay withholds: answered to anybody, it tells a watcher when a named
   person is being talked to. So it is answered only to a token issued against
   a proven identity, and that token opens one mailbox. */
async function pollToken(identity, port = SIGNAL_PORT) {
  const challenge = await fetch(`http://127.0.0.1:${port}/push/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fingerprint: identity.fingerprint, publicKeyData: identity.publicKeyData }),
  }).then((r) => r.json());
  const nonce = crypto.privateDecrypt(
    { key: identity.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(challenge.cipher, 'base64'),
  ).toString('base64');
  return fetch(`http://127.0.0.1:${port}/push/poll-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fingerprint: identity.fingerprint, challengeId: challenge.challengeId, nonce }),
  }).then((r) => r.json());
}

async function mailbox(token) {
  return fetch(`http://127.0.0.1:${SIGNAL_PORT}/push/mailbox`, {
    headers: token ? { 'X-P00RIJA-Poll-Token': token } : {},
  }).then((r) => r.json().catch(() => ({})));
}

const unproven = await fetch(`http://127.0.0.1:${SIGNAL_PORT}/push/poll-token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fingerprint: recipient.fingerprint }),
}).then((r) => r.json());
ok(unproven.ok === false, 'a poll token is refused without proof of the fingerprint');

const issued = await pollToken(recipient);
ok(issued.ok === true && typeof issued.token === 'string', 'a proven identity is issued a poll token');

ok((await mailbox(null)).ok === false, 'the mailbox refuses a request carrying no token');
ok((await mailbox('not-a-real-token')).ok === false, 'and refuses an invented one');

const own = await mailbox(issued.token);
ok(own.ok === true && own.waiting >= 1, 'the token reads its own mailbox, which has the queued message in it');
ok(Object.keys(own).sort().join(',') === 'ok,waiting',
  'and answers with a count only -- no senders, no timestamps, no shape of who has been talking');

/* The attacker holds a real key and can be issued a real token. It must open
   their mailbox and no one else's. */
const attackerToken = await pollToken(attacker);
const wrongBox = await mailbox(attackerToken.token);
ok(wrongBox.ok === true && wrongBox.waiting === 0,
  "another identity's token reads that identity's mailbox, not this one");

const revoked = await fetch(`http://127.0.0.1:${SIGNAL_PORT}/push/poll-token-revoke`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: issued.token }),
}).then((r) => r.json());
ok(revoked.ok === true, 'a token can be handed back');
ok((await mailbox(issued.token)).ok === false, 'and stops answering the moment it is');

// ---- where the credentials land ----------------------------------------
/* Two files here hold what amount to credentials: the poll tokens, and the
   subscriptions -- a UnifiedPush endpoint IS a capability, and anybody holding
   one can make that phone buzz. Written with the default umask they land 0644,
   and on a server with more than one account that is every other account. */
const fresh = await pollToken(recipient);
ok(fresh.ok === true, 'a token is issued so the store exists to inspect');

for (const [file, label] of [
  [join(work, 'poll-tokens.json'), 'the poll token store'],
  [join(work, 'push.json'), 'the subscription store'],
]) {
  let mode = null;
  try { mode = statSync(file).mode & 0o777; } catch (_error) { /* reported below */ }
  ok(mode === 0o600, `${label} is readable only by its owner (mode ${mode === null ? 'missing' : mode.toString(8)})`);
}

/* The header is the only way in. A query string is written into access logs,
   proxy logs and any Referer the request produces. */
const viaQuery = await fetch(
  `http://127.0.0.1:${SIGNAL_PORT}/push/mailbox?token=${encodeURIComponent(fresh.token)}`,
).then((r) => r.json().catch(() => ({})));
ok(viaQuery.ok === false, 'a token in the query string is not accepted');
ok((await mailbox(fresh.token)).ok === true, 'the same token in the header still is');

console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}\n`);
process.exit(failures ? 1 : 0);
