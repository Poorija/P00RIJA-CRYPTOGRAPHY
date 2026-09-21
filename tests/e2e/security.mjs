/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What the relay gives away, and what it lets an unauthenticated stranger do.
 *
 *   npm run relay          # terminal 1
 *   node tests/e2e/security.mjs
 *
 * These are probes against a running server, not a code read. Each check names
 * the concrete thing an attacker gets if it fails. RELAY_URL points it at a
 * deployment; by default it exercises the local one.
 */
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import process from 'node:process';

const RELAY = process.env.RELAY_URL || 'http://localhost:9000';
const WS_URL = process.env.RELAY_WS || 'ws://localhost:9001/chat-signal';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const note = (name, detail) => {
  results.push({ name, ok: true, informational: true });
  console.log(`  NOTE  ${name}  — ${detail}`);
};

function request(path, { method = 'GET', body = null, headers = {}, timeout = 20000 } = {}) {
  const url = new URL(path, RELAY);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = lib.request(url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      rejectUnauthorized: false,
      timeout,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { if (data.length < 400000) data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', (error) => resolve({ status: 0, headers: {}, body: '', error: error.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, body: '', error: 'timeout' }); });
    if (body) req.write(body);
    req.end();
  });
}

/* Read once, before anything below spends this address's budget. Asking later
   gets a 429 with no capacity in it, and the probes then size themselves from
   a fallback instead of from the truth. */
const opening = await request('/chat-health');
let CAPACITY = null;
try { CAPACITY = JSON.parse(opening.body).capacity; } catch { /* older server */ }
const RATE_CEILING = Number(opening.headers['x-ratelimit-limit'] || 0);
console.log(`  this instance: tier=${CAPACITY?.tier || '?'} cpus=${CAPACITY?.cpus || '?'} `
  + `sockets<=${CAPACITY?.sockets?.max || '?'} perAddress<=${CAPACITY?.sockets?.maxPerAddress || '?'} `
  + `rate<=${RATE_CEILING || '?'}/min`);

console.log('\n===== is the admin surface actually closed =====');
const ADMIN = ['/admin/broadcast', '/admin/clear-memory', '/admin/clear-offline', '/admin/kick-peer',
  '/admin/optimize-ram', '/admin/suspend-peer', '/admin/resume-peer', '/admin/unkick-peer',
  '/admin/change-password'];
const open = [];
for (const path of ADMIN) {
  const res = await request(path, { method: 'POST', body: '{}' });
  /* 429 counts as closed: the caller was refused before the endpoint even
     looked at them. What must never appear here is a 2xx. */
  if (res.status && ![401, 403, 423, 429].includes(res.status)) open.push(`${path}:${res.status}`);
}
check('every admin endpoint refuses an anonymous caller', open.length === 0, open.join(' ') || 'all 401');

/* Run before the timing probe below: that one spends two dozen login attempts,
   and once the per-address login bucket is empty the rate limiter answers
   first and the lockout never gets a chance to. */
const loginBurst = [];
for (let i = 0; i < 6; i += 1) {
  loginBurst.push(await request('/admin/login', { method: 'POST', body: JSON.stringify({ password: `guess-${i}` }) }));
}
const codes = loginBurst.map((r) => r.status);
check('repeated bad passwords are refused, and the account locks out',
  codes.includes(423) || codes.every((c) => c === 429),
  codes.join(','));

/* A wrong password must not be distinguishable by how long the answer takes.
   `password === MONITOR_PASSWORD` compares byte by byte and returns on the
   first mismatch, which leaks the length of the correct prefix. */
const timeFor = async (password) => {
  const samples = [];
  for (let i = 0; i < 12; i += 1) {
    const started = process.hrtime.bigint();
    await request('/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
};
const tEmpty = await timeFor('');
const tLong = await timeFor('A'.repeat(64));
note('login timing (median ms)', `empty=${tEmpty.toFixed(2)} long=${tLong.toFixed(2)}`);
check('the login comparison is constant time',
  /timingSafeEqual/.test(await (async () => (await import('node:fs')).readFileSync('scripts/server.js', 'utf8'))()),
  'a byte-by-byte === on the password leaks a timing signal');

/* The session token should be an opaque handle. If it is a reversible encoding
   of the password then stealing the cookie hands over the password itself. */
const serverSrc = (await import('node:fs')).readFileSync('scripts/server.js', 'utf8');
check('the session token is not a reversible encoding of the password',
  !/Buffer\.from\(`admin:\$\{password\}`\)\.toString\('base64'\)/.test(serverSrc),
  'base64("admin:"+password) means the cookie IS the password');
check('credentials are not accepted from the query string',
  !/req\.query\.auth/.test(serverSrc),
  'a password in a URL lands in access logs, history and Referer headers');
check('the auth cookie is marked Secure',
  !/monitor_token_v2=\$\{[^}]+\}; Path=\/; Max-Age=86400; SameSite=Strict; HttpOnly`/.test(serverSrc)
  || /Secure/.test(serverSrc),
  'without Secure the cookie can ride a plaintext downgrade');
check('the token is not also handed to page JavaScript',
  !/res\.json\(\{ ok: true, token,/.test(serverSrc),
  'returning it in the body defeats HttpOnly on the cookie');

console.log('\n===== path handling =====');
for (const attempt of ['/../.env', '/%2e%2e/%2e%2e/.env', '/static/../../.env', '/.env', '/.git/config']) {
  const res = await request(attempt);
  /* Behind nginx an unknown path returns the app's own index.html, and the
     app's help text contains the WORDS "TURN_PASSWORD" and "MONITOR_PASSWORD"
     while explaining where to find them. Matching on the word alone therefore
     reported a leak every time the catch-all fired. What a real leak looks
     like is an assignment with a value on the right of it, in something that
     is not HTML. */
  const isHtml = /text\/html/i.test(String(res.headers['content-type'] || ''));
  const leaked = res.status === 200 && !isHtml
    && /(MONITOR_PASSWORD|TURN_PASSWORD|VAPID_PRIVATE_KEY)\s*=\s*\S/.test(res.body);
  const gitLeak = res.status === 200 && !isHtml && /\[core\][\s\S]*repositoryformatversion/i.test(res.body);
  check(`${attempt} does not serve a private file`, !leaked && !gitLeak,
    `HTTP ${res.status}${isHtml ? ' (the app shell, not a file)' : ''}`);
}

console.log('\n===== headers and transport =====');
const health = await request('/chat-health');
const h = health.headers || {};
check('the server does not advertise its stack', !h['x-powered-by'], String(h['x-powered-by'] || 'absent'));
/* nginx sets this too, so behind the proxy the value arrives as
   "nosniff, nosniff". Both are correct; what matters is that it is there and
   says nothing but nosniff. */
check('content type sniffing is off',
  String(h['x-content-type-options'] || '').split(',').every((part) => part.trim() === 'nosniff')
  && Boolean(h['x-content-type-options']),
  String(h['x-content-type-options'] || 'missing'));
check('framing is refused', Boolean(h['x-frame-options'] || h['content-security-policy']),
  String(h['x-frame-options'] || h['content-security-policy'] || 'missing'));
if (RELAY.startsWith('https')) {
  check('HSTS is set', Boolean(h['strict-transport-security']), String(h['strict-transport-security'] || 'missing'));
} else {
  note('HSTS', 'not applicable over plain http');
}
const cors = await request('/chat-health', { headers: { Origin: 'https://evil.example.com' } });
check('an unknown origin is not granted CORS access',
  cors.headers['access-control-allow-origin'] !== 'https://evil.example.com'
  && cors.headers['access-control-allow-origin'] !== '*',
  String(cors.headers['access-control-allow-origin'] || 'no header'));

console.log('\n===== rate limiting and resource ceilings =====');
/* The ceiling is derived from the hardware, so a fixed burst size proves
   nothing: on a big machine it sits far below the limit and the check passes
   for the wrong reason. Ask the server what its limit is, then go past it. */
const BURST = RATE_CEILING > 0 ? Math.min(RATE_CEILING + 30, 2200) : 340;
const burst = [];
for (let i = 0; i < BURST; i += 10) {
  burst.push(...await Promise.all(Array.from({ length: 10 }, () => request('/chat-health'))));
}
const served = burst.filter((r) => r.status === 200).length;
const limited = burst.filter((r) => r.status === 429).length;
check('a flood from one address is eventually refused', limited > 0,
  `${served} served, ${limited} refused of ${BURST}`);
check('and the refusal tells the caller when to come back',
  burst.some((r) => r.status === 429 && r.headers['retry-after']),
  String(burst.find((r) => r.status === 429)?.headers['retry-after'] || 'no Retry-After'));

/* express.json({ limit: '50mb' }) applies to every route, authenticated or
   not: an anonymous caller can make the process parse 50 MB of JSON at will. */
check('the JSON body ceiling is modest', !/express\.json\(\{ limit: '50mb' \}\)/.test(serverSrc),
  '50mb on every endpoint is a memory and CPU amplifier');

const big = await request('/push/subscribe', { method: 'POST', body: JSON.stringify({ pad: 'A'.repeat(8 * 1024 * 1024) }) });
note('an 8 MB anonymous body', `answered ${big.status || big.error}`);

console.log('\n===== the presence socket =====');
const openSocket = (payload) => new Promise((resolve) => {
  const ws = new WebSocket(WS_URL, { rejectUnauthorized: false });
  const done = (verdict) => { try { ws.close(); } catch {} resolve(verdict); };
  const timer = setTimeout(() => done('timeout'), 8000);
  ws.on('open', () => { if (payload) ws.send(payload); setTimeout(() => { clearTimeout(timer); done('accepted'); }, 500); });
  ws.on('error', (e) => { clearTimeout(timer); done('error:' + e.message.slice(0, 40)); });
  ws.on('close', (code) => { clearTimeout(timer); done('closed:' + code); });
});

const garbage = await openSocket('not json at all {{{');
check('malformed frames do not take the server down', garbage !== 'error:socket hang up', String(garbage));
/* 200 or 429 both prove the process is alive and answering — by this point in
   the run the earlier flood has legitimately spent this address's budget, and
   a rate-limited answer is still an answer. A dead server gives status 0. */
const afterGarbage = await request('/chat-health');
check('and the server still answers afterwards', afterGarbage.status > 0,
  String(afterGarbage.status || afterGarbage.error));

/* One machine holding thousands of sockets is the cheapest denial of service
   there is, and nothing in the upgrade path counts them. */
/* Same reasoning: the per-address ceiling scales with RAM, so read it. */
const perAddress = Number(CAPACITY?.sockets?.maxPerAddress || 40);
const SOCKET_ATTEMPTS = Math.min(perAddress + 8, 320);
const sockets = [];
let accepted = 0;
for (let i = 0; i < SOCKET_ATTEMPTS; i += 1) {
  const ws = new WebSocket(WS_URL, { rejectUnauthorized: false });
  sockets.push(ws);
  await new Promise((resolve) => {
    ws.once('open', () => { accepted += 1; resolve(); });
    ws.once('error', () => resolve());
    setTimeout(resolve, 250);
  });
}
sockets.forEach((ws) => { try { ws.close(); } catch {} });
check('one address cannot hold an unbounded number of sockets', accepted < SOCKET_ATTEMPTS,
  `${accepted} of ${SOCKET_ATTEMPTS} accepted, ceiling advertised as ${perAddress}`);

const relayFlood = await openSocket(JSON.stringify({
  type: 'relay', toFingerprint: crypto.randomBytes(32).toString('hex'),
  payload: { type: 'offline-chat', message: { type: 'text' } }, persist: true,
}));
note('an anonymous relay write', String(relayFlood));

await new Promise((r) => setTimeout(r, 400));
const alive = await request('/chat-health');
check('the relay survived every probe above', alive.status > 0, String(alive.status || alive.error));

/* Put the relay back the way it was found.
 *
 * The flood above sends RATE_CEILING + 30 requests to prove the rate limiter
 * works, which leaves this machine's bucket exhausted for the rest of the
 * sixty-second window — the check two lines up literally records the relay
 * answering 429 afterwards. Whatever suite the runner starts next comes from
 * the same address, so its browsers get 429 on /chat-health and /turn-config,
 * never connect, and fail in ways that have nothing to do with what they test.
 * That is exactly what happened to security3's global search across two full
 * sweeps: "messages never arrived" because the relay was refusing its clients.
 *
 * There is no way to clear a bucket from outside, so this waits for the window
 * it consumed. Sixty seconds once per sweep is cheaper than one suite that
 * fails for a reason nobody can see. */
if (!process.env.SECURITY_NO_DRAIN) {
  const windowMs = 60_000;
  process.stdout.write(`\n  draining the rate-limit window this suite consumed (${windowMs / 1000}s)…`);
  const started = Date.now();
  while (Date.now() - started < windowMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const probe = await request('/chat-health');
    if (probe.status === 200) {
      /* Two clean responses in a row: the window has rolled over. */
      const again = await request('/chat-health');
      if (again.status === 200) break;
    }
  }
  console.log(` done after ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${failed.length} failed of ${results.filter((r) => !r.informational).length} =====`);
if (failed.length) {
  console.log('\nWhat each failure gives an attacker:');
  failed.forEach((r) => console.log('  · ' + r.name));
}
process.exit(failed.length ? 1 : 0);
