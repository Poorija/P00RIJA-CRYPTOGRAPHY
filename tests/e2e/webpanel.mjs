/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The central panel as a web app (docs/CONTROL-PANEL.md).
 *
 * "login" starts the web panel against servers that are not there and checks
 * who gets in: a name, a password and a code from an authenticator app; a
 * code used once is spent; five failures lock the address for a while; an
 * idle session ends; other sites and other host names are kept out.
 * "sign" checks that the page's own signing code builds, byte for byte, the
 * text a relay verifies, and that what it signs a relay takes.
 * "relay" runs two real relays, one of them locked, and drives them through
 * the web panel with a key made the way a browser makes it: a signed call
 * reaches the locked relay, an unsigned, replayed, moved or altered one does
 * not, and the panel will not change a server's lock without a signature.
 *
 *   node tests/e2e/webpanel.mjs            # every section
 *   node tests/e2e/webpanel.mjs login      # one of them
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFleet, waitUntil, sleep, PASSWORD } from './_relay-fleet.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ONLY = new Set(process.argv.slice(2));
const wants = (name) => !ONLY.size || ONLY.has(name);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const subtle = globalThis.crypto.subtle;

/* A request with whatever Host, Origin and type a caller likes. */
const raw = (port, route, { method = 'GET', headers = {}, body, type = 'application/json' } = {}) => new Promise((resolve) => {
  const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const request = http.request({ host: '127.0.0.1', port, path: route, method, headers: { ...(payload ? { 'Content-Type': type, 'Content-Length': payload.length } : {}), ...headers } }, (response) => {
    let text = '';
    response.on('data', (chunk) => { text += chunk; });
    response.on('end', () => {
      let json = null;
      try { json = JSON.parse(text); } catch (_error) { /* not JSON */ }
      resolve({ status: response.statusCode, headers: response.headers, text, json });
    });
  });
  request.on('error', (error) => resolve({ status: 0, text: error.message, headers: {} }));
  request.end(payload || undefined);
});

/* The web panel, started the way the image starts it. */
async function startPanel(env) {
  const child = spawn(process.execPath, ['tools/panel/server.mjs'], {
    cwd: ROOT, env: { ...process.env, POORIJA_PANEL_PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  let exited = null;
  child.on('exit', (code) => { exited = code; });
  await waitUntil(() => /panel: http:\/\/127\.0\.0\.1:\d+\//.test(out) || exited !== null, 20000, 100);
  const port = Number((/panel: http:\/\/127\.0\.0\.1:(\d+)\//.exec(out) || [])[1] || 0);
  return { child, port, host: `127.0.0.1:${port}`, output: () => out, exited: () => exited };
}

async function makeLoginFile(dir, username, password) {
  const login = await import(pathToFileURL(path.join(ROOT, 'tools/panel/login.mjs')).href);
  const record = login.makeLogin({ username, password });
  fs.writeFileSync(path.join(dir, 'control-panel-login.json'), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return { login, record };
}

const fetchRelayDirectory = (origin) => new Promise((resolve) => {
  http.get(`${origin}/relay-directory`, (response) => { let text = ''; response.on('data', (chunk) => { text += chunk; }); response.on('end', () => { try { resolve(JSON.parse(text)); } catch (_error) { resolve(null); } }); }).on('error', () => resolve(null));
});

/* A device key the way the page makes one: WebCrypto, private half not extractable. */
async function browserKey() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const spki = Buffer.from(await subtle.exportKey('spki', pair.publicKey)).toString('base64');
  return { ...pair, spki, keyId: crypto.createHash('sha256').update(Buffer.from(spki, 'base64')).digest('hex') };
}

try {
  if (wants('login')) {
    section('login: who gets in');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-webpanel-'));
    let panel = null;
    try {
      const login = await import(pathToFileURL(path.join(ROOT, 'tools/panel/login.mjs')).href);
      /* RFC 6238, appendix B, cut to six digits. */
      const rfcSecret = login.base32Encode(Buffer.from('12345678901234567890'));
      check('the codes are RFC 6238 codes', login.totp(rfcSecret, Math.floor(59 / 30)) === '287082' && login.totp(rfcSecret, Math.floor(1111111109 / 30)) === '081804',
        `${login.totp(rfcSecret, 1)} ${login.totp(rfcSecret, Math.floor(1111111109 / 30))}`);

      const none = await startPanel({ POORIJA_CONFIG_DIR: home, POORIJA_PANEL_DIRECT: 'a=http://127.0.0.1:9' });
      await waitUntil(() => none.exited() !== null, 10000, 100);
      check('without a login made first, the panel does not start, and says how to make one', none.exited() !== 0 && /setup-login/.test(none.output()), none.output().slice(0, 200));

      const { record } = await makeLoginFile(home, 'operator', 'a long test password 42');
      check('the login file is the owner’s alone and holds no password', (fs.statSync(path.join(home, 'control-panel-login.json')).mode & 0o777) === 0o600
        && !fs.readFileSync(path.join(home, 'control-panel-login.json'), 'utf8').includes('a long test password 42'));
      panel = await startPanel({
        POORIJA_CONFIG_DIR: home, POORIJA_PANEL_DIRECT: 'a=http://127.0.0.1:9,b=http://127.0.0.1:10',
        POORIJA_PANEL_SESSION_IDLE_MS: '3000', POORIJA_PANEL_LOCK_MS: '4000', POORIJA_PANEL_TRUSTED_PROXY: '127.0.0.1',
      });
      const { port, host } = panel;
      check('the panel starts and says where', port > 0, panel.output().slice(0, 200));
      const page = await raw(port, '/', { headers: { Host: host } });
      const policy = page.headers['content-security-policy'] || '';
      check('the page loads without a session, with a policy that keeps other sites and inline scripts out',
        page.status === 200 && page.text.includes('id="loginForm"') && /script-src 'self'(;|$)/.test(policy) && /frame-ancestors 'none'/.test(policy), policy);
      check('without a session nothing else answers', (await raw(port, '/api/servers', { headers: { Host: host } })).status === 401);

      const code = (offset = 0) => login.totp(record.totp, Math.floor(Date.now() / 30000) + offset);
      const attempt = (fields) => raw(port, '/api/login', { method: 'POST', headers: { Host: host }, body: { username: 'operator', password: 'a long test password 42', code: code(), ...fields } });
      const badPassword = await attempt({ password: 'not it' });
      check('a wrong password is refused', badPassword.status === 401 && badPassword.json?.reason === 'login-failed');
      const badCode = await attempt({ code: String((Number(code()) + 1) % 1000000).padStart(6, '0') });
      check('the right password with a wrong code is refused, the same way', badCode.status === 401 && badCode.json?.reason === 'login-failed');
      const used = code();
      const good = await attempt({ code: used });
      const setCookie = String(good.headers?.['set-cookie']?.[0] || '');
      const cookie = setCookie.split(';')[0];
      check('the name, password and code give a session cookie, HttpOnly and SameSite=Strict',
        good.status === 200 && /^panel_session=[a-f0-9]{64}$/.test(cookie) && /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie), setCookie);
      const again = await attempt({ code: used });
      check('a code used once does not let anyone in again', again.status === 401, JSON.stringify(again.json));
      const servers = await raw(port, '/api/servers', { headers: { Host: host, Cookie: cookie } });
      check('with the session the servers answer', servers.status === 200 && (servers.json?.servers || []).map((server) => server.name).join() === 'a,b', servers.text.slice(0, 200));
      check('a request from another site is refused', (await raw(port, '/api/servers', { headers: { Host: host, Cookie: cookie, Origin: 'http://evil.example' } })).status === 403);
      check('so is one naming another host (DNS rebinding)', (await raw(port, '/api/servers', { headers: { Host: `evil.example:${port}`, Cookie: cookie } })).status === 403);
      const form = await raw(port, '/api/call', { method: 'POST', headers: { Host: host, Cookie: cookie }, body: 'server=a', type: 'application/x-www-form-urlencoded' });
      check('a write that is not JSON (what a form on another site can send) is refused', form.status === 415, `${form.status}`);

      /* The page looking every few seconds is not someone using it. */
      for (let i = 0; i < 4; i += 1) { await raw(port, '/api/servers', { headers: { Host: host, Cookie: cookie, 'X-Panel-Poll': '1' } }); await sleep(1000); }
      check('an idle session ends, however often the page looked', (await raw(port, '/api/servers', { headers: { Host: host, Cookie: cookie } })).status === 401);

      /* A code is good for a step either side, so the next step's code lets
         in now, and is spent after. */
      const usedStep = Math.floor(Date.now() / 30000);
      const second = await attempt({ code: login.totp(record.totp, usedStep + 1) });
      const cookie2 = String(second.headers?.['set-cookie']?.[0] || '').split(';')[0];
      check('a fresh code lets in again', second.status === 200, JSON.stringify(second.json));
      const out = await raw(port, '/api/logout', { method: 'POST', headers: { Host: host, Cookie: cookie2 }, body: {} });
      check('logging out ends the session', out.status === 200 && (await raw(port, '/api/servers', { headers: { Host: host, Cookie: cookie2 } })).status === 401);

      await sleep(31000 - (Date.now() % 30000));
      const fresh = login.totp(record.totp, usedStep + 2);
      for (let i = 0; i < 5; i += 1) await attempt({ password: `wrong ${i}` });
      const locked = await attempt({ code: fresh });
      check('after five failures the address is locked, even for the right login', locked.status === 429 && locked.json?.reason === 'locked', JSON.stringify(locked.json));
      await sleep(4500);
      check('and the lock lifts after its time', (await attempt({ code: fresh })).status === 200);
      /* Behind a reverse proxy every login comes from the proxy's address; the
         address the proxy names is the one that gets locked. */
      const viaProxy = (client, fields) => raw(port, '/api/login', { method: 'POST', headers: { Host: host, 'X-Forwarded-For': `198.51.100.9, ${client}` }, body: { username: 'operator', password: 'a long test password 42', code: code(), ...fields } });
      for (let i = 0; i < 5; i += 1) await viaProxy('203.0.113.7', { password: `wrong ${i}` });
      const lockedOne = await viaProxy('203.0.113.7', { password: 'wrong again' });
      const otherOne = await viaProxy('203.0.113.8', { password: 'wrong again' });
      check('behind a trusted proxy, failures lock the address the proxy names and not everyone behind it',
        lockedOne.status === 429 && otherOne.status === 401, `${lockedOne.status} ${otherOne.status}`);
      const log = fs.readFileSync(path.join(home, 'control-panel.log'), 'utf8');
      check('the audit log has the logins and the failures, never a password', /login operator ok/.test(log) && /login failed/.test(log) && !log.includes('a long test password 42'), log.slice(-300));
    } finally {
      panel?.child.kill('SIGTERM');
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  if (wants('sign')) {
    section('sign: the page signs what a relay verifies');
    const sig = require('../../scripts/lib/operator-signature.js');
    const { canonicalJson } = require('../../scripts/lib/relay-directory.js');
    const page = await import(pathToFileURL(path.join(ROOT, 'tools/panel/web/sign.js')).href);
    const samples = [
      {}, { b: 1, a: [3, 2, { z: null, y: 'ی' }] }, { text: 'سلام "دنیا"\n\t\u2028', n: -0.5, big: 1e21, t: true, f: false },
      [1, 'two', { 'é': 'x', e: 'y' }], 'plain', 12, null, { nested: { deeper: { deepest: ['a', { k: 'v' }] } } },
    ];
    const differ = samples.filter((value) => page.canonicalJson(value) !== canonicalJson(value));
    check('its canonical JSON is the relay’s, for every shape', differ.length === 0, JSON.stringify(differ));
    const paths = ['/Monitor_Server/Transit-Add/', '//admin//kick-peer', '/', '', '/MONITOR_SERVER/partners/approve///'];
    check('it spells paths the way the relay does', paths.every((route) => page.normalizePath(route) === sig.normalizePath(route)), paths.map(page.normalizePath).join(' '));
    const fields = { method: 'post', path: '/Monitor_Server/gateways/', body: { gateways: [{ id: 'a'.repeat(64), priority: 1 }] }, relay: 'b'.repeat(64), at: Date.now(), nonce: 'c'.repeat(32) };
    check('it builds the exact text a signature covers', await page.requestText(fields) === sig.requestText(fields));
    const key = await browserKey();
    check('it names a key the way the directory does', await page.keyIdOf(key.publicKey) === key.keyId && await page.spkiOf(key.publicKey) === key.spki);
    const header = await page.signHeader({ method: 'POST', path: fields.path, body: fields.body, relay: fields.relay }, { privateKey: key.privateKey, keyId: key.keyId });
    const keys = new Map([[key.keyId, { key: key.spki, name: 'browser' }]]);
    const verdict = sig.verifyRequest(header, { method: 'POST', path: fields.path, body: fields.body, relay: fields.relay, keys });
    check('and what it signs, the relay’s check takes', verdict.ok === true && verdict.name === 'browser', JSON.stringify(verdict));
    const nonces = new Set();
    for (let i = 0; i < 20; i += 1) nonces.add((await page.signHeader({ method: 'POST', path: '/admin/broadcast', body: {}, relay: fields.relay }, key)).split('.')[3]);
    check('each signature has a fresh nonce', nonces.size === 20);
  }

  if (wants('relay')) {
    section('relay: a browser-signed call through the web panel');
    const dirlib = require('../../scripts/lib/relay-directory.js');
    const page = await import(pathToFileURL(path.join(ROOT, 'tools/panel/web/sign.js')).href);
    const operator = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const operatorKey = operator.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const operatorId = dirlib.operatorIdFor(operatorKey);
    const fleet = await createFleet(['r1', 'r2'], {
      env: {
        r1: () => ({ CHAT_OPERATOR_KEY: operatorKey }),
        r2: () => ({ CHAT_OPERATOR_KEY: operatorKey, CHAT_REQUIRE_OPERATOR_SIGNATURE: '1' }),
      },
    });
    const { r1, r2 } = fleet.relays;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-webpanel-'));
    let panel = null;
    try {
      const device = await browserKey();
      const stranger = await browserKey();
      const doc = dirlib.signDirectory({
        v: 1, operator: { id: operatorId, key: operatorKey, name: 'Web Ops' }, serial: 1, issuedAt: new Date().toISOString(),
        relays: [r1, r2].map((relay) => ({ id: relay.id, name: relay.name, origins: [relay.origin], region: 'outside-iran', gateway: 0, cluster: 'Outside' })), revoked: [],
        admins: [{ id: device.keyId, key: device.spki, name: 'office-browser' }],
      }, operator.privateKey);
      await fleet.startAll();
      for (const name of ['r1', 'r2']) await fleet.post(name, '/Monitor_Server/directory', doc);
      const { login, record } = await makeLoginFile(home, 'operator', 'a long test password 42');
      panel = await startPanel({
        POORIJA_CONFIG_DIR: home, POORIJA_PANEL_DIRECT: `r1=${r1.origin},r2=${r2.origin}`,
        POORIJA_PANEL_PASSWORD: PASSWORD, POORIJA_PANEL_OPERATOR_ID: operatorId,
      });
      const { port, host } = panel;
      const loggedIn = await raw(port, '/api/login', { method: 'POST', headers: { Host: host }, body: { username: 'operator', password: 'a long test password 42', code: login.totp(record.totp, Math.floor(Date.now() / 30000)) } });
      const cookie = String(loggedIn.headers?.['set-cookie']?.[0] || '').split(';')[0];
      const call = (body) => raw(port, '/api/call', { method: 'POST', headers: { Host: host, Cookie: cookie }, body });
      const listed = await raw(port, '/api/servers', { headers: { Host: host, Cookie: cookie } });
      const byName = Object.fromEntries((listed.json?.servers || []).map((server) => [server.name, server]));
      check('the overview has each server, its lock, its cluster and the relay a signature for it must name',
        byName.r2?.locked === true && byName.r1?.locked === false && byName.r2.signFor === r2.id && byName.r1.cluster === 'Outside', JSON.stringify(byName.r2 || listed.json).slice(0, 300));
      check('and the keys the family lists, so a browser knows whether its own is one',
        (listed.json?.admins || []).some((admin) => admin.id === device.keyId && admin.name === 'office-browser'), JSON.stringify(listed.json?.admins));

      const route = '/Monitor_Server/transit-add';
      const addBody = () => ({ id: crypto.randomBytes(32).toString('hex'), origin: '' });
      const read = await call({ server: 'r2', method: 'POST', path: '/Monitor_Server/transit', body: {} });
      check('a read reaches the locked relay without a signature', read.status === 200 && read.json?.status === 200 && read.json?.answer?.ok === true, read.text.slice(0, 200));
      const unsigned = await call({ server: 'r2', method: 'POST', path: route, body: addBody() });
      check('an unsigned dangerous call does not get past the lock', unsigned.json?.status === 403 && unsigned.json?.answer?.reason === 'operator-signature-required', unsigned.text.slice(0, 200));
      const body = addBody();
      const signature = await page.signHeader({ method: 'POST', path: route, body, relay: byName.r2.signFor }, device);
      const signed = await call({ server: 'r2', method: 'POST', path: route, body, signature });
      check('a call the browser signed reaches the locked relay and is taken', signed.json?.status === 200 && signed.json?.answer?.ok === true, signed.text.slice(0, 200));
      check('the relay writes down which browser signed it', await waitUntil(() => r2.output.includes('Signed by office-browser'), 5000));
      const replay = await call({ server: 'r2', method: 'POST', path: route, body, signature });
      check('the same signed call again is refused', replay.json?.status === 403 && replay.json?.answer?.detail === 'replayed', replay.text.slice(0, 200));
      const changed = addBody();
      const altered = await call({ server: 'r2', method: 'POST', path: route, body: changed, signature: await page.signHeader({ method: 'POST', path: route, body: addBody(), relay: r2.id }, device) });
      check('a signature over another body is refused', altered.json?.status === 403 && altered.json?.answer?.detail === 'bad-signature', altered.text.slice(0, 200));
      const forR1 = addBody();
      const moved = await call({ server: 'r2', method: 'POST', path: route, body: forR1, signature: await page.signHeader({ method: 'POST', path: route, body: forR1, relay: r1.id }, device) });
      check('one made for the other relay is refused', moved.json?.status === 403 && moved.json?.answer?.detail === 'bad-signature', moved.text.slice(0, 200));
      const unlisted = addBody();
      const strangers = await call({ server: 'r2', method: 'POST', path: route, body: unlisted, signature: await page.signHeader({ method: 'POST', path: route, body: unlisted, relay: r2.id }, stranger) });
      check('one from a key the family does not list is refused', strangers.json?.status === 403 && strangers.json?.answer?.detail === 'unknown-key', strangers.text.slice(0, 200));
      const manual = addBody();
      check('an unlocked relay still takes an unsigned call, as its own dashboard does', (await call({ server: 'r1', method: 'POST', path: route, body: manual })).json?.answer?.ok === true);
      const transit = (await call({ server: 'r1', method: 'POST', path: '/Monitor_Server/transit', body: {} })).json?.answer || {};
      const listedPeer = (transit.peers || []).find((peer) => peer.id === manual.id.slice(0, 16));
      check('a relay names each of its links in full, so one can be removed', listedPeer?.fullId === manual.id, JSON.stringify(listedPeer));
      const removed = await call({ server: 'r1', method: 'POST', path: '/Monitor_Server/transit-remove', body: { id: listedPeer?.fullId || manual.id.slice(0, 16) } });
      check('and removing it by that name works', removed.json?.answer?.ok === true, removed.text.slice(0, 160));
      const own = (transit.directory?.relays || []).find((relay) => relay.self);
      check('a relay’s own dashboard shows the cluster the directory gives it', own?.cluster === 'Outside', JSON.stringify(own));

      const outside = await Promise.all([
        call({ server: 'r2', method: 'GET', path: 'http://evil.example/' }),
        call({ server: 'r2', method: 'GET', path: '/Monitor_Server/../../etc/passwd' }),
        call({ server: 'r2', method: 'GET', path: '/not-a-dashboard-path' }),
        call({ server: 'r2', method: 'DELETE', path: '/Monitor_Server/transit' }),
        call({ server: 'nobody', method: 'POST', path: '/Monitor_Server/transit', body: {} }),
        call({ server: 'r2', method: 'POST', path: route, body: addBody(), signature: 'v1.garbage' }),
      ]);
      check('a call outside the dashboard, to no server, or with a broken signature is not sent on',
        outside.map((answer) => answer.status).join() === '400,400,400,400,404,400', outside.map((answer) => answer.status).join());

      const lockBody = { server: 'r2', on: false };
      const noSig = await raw(port, '/api/lock', { method: 'POST', headers: { Host: host, Cookie: cookie }, body: lockBody });
      check('the panel does not change a lock without a signature from a key the family lists', noSig.status === 403 && noSig.json?.reason === 'signature-needed', noSig.text.slice(0, 160));
      const badSig = await raw(port, '/api/lock', { method: 'POST', headers: { Host: host, Cookie: cookie }, body: { ...lockBody, signature: await page.signHeader({ method: 'POST', path: '/control-panel/lock', body: lockBody, relay: r2.id }, stranger) } });
      check('nor with one from a key it does not list', badSig.status === 403 && badSig.json?.reason === 'bad-signature', badSig.text.slice(0, 160));
      const goodSig = await raw(port, '/api/lock', { method: 'POST', headers: { Host: host, Cookie: cookie }, body: { ...lockBody, signature: await page.signHeader({ method: 'POST', path: '/control-panel/lock', body: lockBody, relay: r2.id }, device) } });
      check('with one from a listed key it goes ahead (here: a server it can only reach without SSH)', goodSig.status === 200 && goodSig.json?.reason === 'ssh-only', goodSig.text.slice(0, 160));

      const log = fs.readFileSync(path.join(home, 'control-panel.log'), 'utf8');
      check('the audit log has who did what, and whether it was signed', /operator r2 POST \/Monitor_Server\/transit-add signed 200/.test(log) && /operator r2 POST \/Monitor_Server\/transit-add unsigned 403/.test(log), log.slice(-400));
      const written = fs.readdirSync(home).map((name) => fs.readFileSync(path.join(home, name), 'utf8')).join('\n');
      check('nothing the panel wrote holds a server’s password', !written.includes(PASSWORD));
    } finally {
      panel?.child.kill('SIGTERM');
      await fleet.stopAll();
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  if (wants('actions')) {
    section('actions: everything the relay dashboard does');
    const sig = require('../../scripts/lib/operator-signature.js');
    const actions = await import(pathToFileURL(path.join(ROOT, 'tools/panel/web/actions.js')).href);
    const { T } = await import(pathToFileURL(path.join(ROOT, 'tools/panel/web/strings.js')).href);
    const dashboard = fs.readFileSync(path.join(ROOT, 'scripts/lib/monitor-dashboard.js'), 'utf8');
    const called = new Set([...dashboard.matchAll(/(?:api|downloadPost)\('([^']+)'/g)].map((match) => match[1]));
    /* Two paths the dashboard puts together from parts. */
    check('the dashboard still builds its kick/suspend and partner paths from parts, as this test reads them',
      /api\('\/admin\/' \+ \(policyTarget\.action === 'kick' \? 'kick-peer' : 'suspend-peer'\)/.test(dashboard) && /api\('\/Monitor_Server\/partners\/' \+ act/.test(dashboard));
    called.delete('/admin/');
    called.delete('/Monitor_Server/partners/');
    for (const route of ['/admin/kick-peer', '/admin/suspend-peer', '/Monitor_Server/partners/approve', '/Monitor_Server/partners/reject', '/Monitor_Server/partners/remove']) called.add(route);
    const actionPaths = new Set(Object.values(actions.ACTIONS).map((action) => action.path));
    const known = new Set([...actions.READS.map((read) => read.path), ...actionPaths, ...Object.keys(actions.NOT_NEEDED)]);
    const missing = [...called].filter((route) => !known.has(route));
    check('every call the relay dashboard makes, the panel makes too', called.size > 40 && missing.length === 0, `${called.size} calls; missing: ${missing.join(' ')}`);
    check('the one it leaves out is the dashboard’s own logout, and the panel says why',
      Object.keys(actions.NOT_NEEDED).join() === '/admin/logout' && String(actions.NOT_NEEDED['/admin/logout']).length > 20);
    const writes = [...sig.DANGEROUS_PATHS].filter((route) => !actionPaths.has(route) && !actions.READS.some((read) => read.path === route));
    check('every dangerous action of a relay is a button in the panel', writes.length === 0, writes.join(' '));
    const extra = ['/Monitor_Server/alert-test', '/Monitor_Server/identities', '/Monitor_Server/ops-status', '/Monitor_Server/ops-bundle'];
    check('and so are the relay’s endpoints its own dashboard does not call', extra.every((route) => known.has(route)), extra.filter((route) => !known.has(route)).join(' '));
    const labels = Object.entries(actions.ACTIONS).flatMap(([id, action]) => [action.label, action.confirm].filter(Boolean).map((key) => [id, key]));
    const unlabelled = labels.filter(([, key]) => !T.fa[key] || !T.en[key]).map(([id, key]) => `${id}:${key}`);
    check('every action has its label and its question in Persian and in English', unlabelled.length === 0, unlabelled.join(' '));
    const faOnly = Object.keys(T.fa).filter((key) => !(key in T.en));
    const enOnly = Object.keys(T.en).filter((key) => !(key in T.fa));
    check('every string of the page is there in both languages', faOnly.length === 0 && enOnly.length === 0, [...faOnly, ...enOnly].join(' '));
    const ui = await import(pathToFileURL(path.join(ROOT, 'tools/panel/web/ui.js')).href);
    const cells = ['=HYPERLINK("http://evil")', '+1', '-2', '@SUM(A1)', '\tx', '\rx', 'plain', 'a "quote"'].map(ui.csvCell);
    check('a CSV cell a spreadsheet would run as a formula is written as text',
      cells.slice(0, 6).every((cell) => cell.startsWith(`"'`)) && cells[6] === '"plain"' && cells[7] === '"a ""quote"""', cells.join(' '));
    const first = ui.rowRef({ who: 'first' });
    ui.state.rows.clear();
    const second = ui.rowRef({ who: 'second' });
    check('a row’s handle is never reused after the page redraws, so a stale one finds nothing', first !== second && ui.state.rows.get(first) === undefined, `${first} ${second}`);
    const downloads = Object.values(actions.ACTIONS).filter((action) => action.download).map((action) => action.path).sort().join();
    check('the three downloads are downloads', downloads === ['/Monitor_Server/ops-backup-download', '/Monitor_Server/ops-bundle', '/Monitor_Server/ops-image-export'].sort().join(), downloads);
  }

  if (wants('sections')) {
    section('sections: every section, for every server, in a browser');
    const { chromium } = await import('playwright');
    const dirlib = require('../../scripts/lib/relay-directory.js');
    const operator = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const operatorKey = operator.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const operatorId = dirlib.operatorIdFor(operatorKey);
    const fleet = await createFleet(['r1', 'r2'], {
      env: {
        r1: () => ({ CHAT_OPERATOR_KEY: operatorKey }),
        r2: () => ({ CHAT_OPERATOR_KEY: operatorKey, CHAT_REQUIRE_OPERATOR_SIGNATURE: '1' }),
      },
    });
    const { r1, r2 } = fleet.relays;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-webpanel-'));
    let panel = null;
    let browser = null;
    const clients = [];
    const directory = (serial, admins = []) => dirlib.signDirectory({
      v: 1, operator: { id: operatorId, key: operatorKey, name: 'Web Ops' }, serial, issuedAt: new Date().toISOString(),
      relays: [
        { id: r1.id, name: 'r1', origins: [r1.origin], region: 'outside-iran', gateway: 1, cluster: 'Alpha' },
        { id: r2.id, name: 'r2', origins: [r2.origin], region: 'outside-iran', gateway: 0, cluster: 'Beta' },
      ],
      revoked: [], admins,
    }, operator.privateKey);
    try {
      await fleet.startAll();
      for (const name of ['r1', 'r2']) await fleet.post(name, '/Monitor_Server/directory', directory(1));
      for (const [relay, label] of [['r1', 'user-on-r1'], ['r2', 'user-on-r2']]) {
        const client = fleet.client(relay, label);
        clients.push(client);
        await client.ready;
      }
      const { login, record } = await makeLoginFile(home, 'operator', 'a long test password 42');
      panel = await startPanel({
        POORIJA_CONFIG_DIR: home, POORIJA_PANEL_DIRECT: `r1=${r1.origin},r2=${r2.origin}`,
        POORIJA_PANEL_PASSWORD: PASSWORD, POORIJA_PANEL_OPERATOR_ID: operatorId,
      });
      browser = await chromium.launch();
      const page = await browser.newPage();
      const dialogs = [];
      page.on('dialog', (dialog) => { dialogs.push(dialog.message()); dialog.accept(dialog.type() === 'prompt' ? (dialog.message().includes('name') || dialog.message().includes('نام') ? 'test-browser' : '5') : undefined); });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://${panel.host}/`);
      await page.fill('#loginUser', 'operator');
      await page.fill('#loginPassword', 'a long test password 42');
      await page.fill('#loginCode', login.totp(record.totp, Math.floor(Date.now() / 30000)));
      await page.click('#loginButton');
      await page.waitForSelector('#appView:not([hidden])', { timeout: 10000 });
      check('the page logs in with the name, password and code', true);

      /* This browser's key, listed by the operator. */
      await page.click('[data-tab="keys"]');
      await page.click('#makeKey');
      await page.waitForSelector('#forgetKey', { timeout: 10000 });
      const device = await page.evaluate(async () => { const key = await (await import('/sign.js')).deviceKey(); return { spki: key.spki, keyId: key.keyId }; });
      for (const name of ['r1', 'r2']) await fleet.post(name, '/Monitor_Server/directory', directory(2, [{ id: device.keyId, key: device.spki, name: 'test-browser' }]));
      await page.click('#checkAgain');
      await page.waitForFunction(() => document.querySelector('#deviceState')?.classList.contains('good'), null, { timeout: 15000 });
      check('a key made in the browser, once the operator lists it, shows as listed', true);

      await page.click('[data-tab="overview"]');
      const overview = await page.textContent('#sections');
      check('the overview groups the servers by cluster', overview.includes('Alpha') && overview.includes('Beta') && overview.includes('r1') && overview.includes('r2'));

      const sectionIds = ['queues', 'users', 'relays', 'traffic', 'machine', 'reports', 'bootstrap', 'system', 'clusters'];
      const unrendered = [];
      for (const id of sectionIds) {
        await page.click(`[data-tab="${id}"]`);
        const ok = await page.waitForFunction(() => document.querySelector('#sections [data-server-row="r1"]') && document.querySelector('#sections [data-server-row="r2"]'), null, { timeout: 20000 }).then(() => true, () => false);
        if (!ok) unrendered.push(id);
      }
      check('every section shows rows for every server', unrendered.length === 0, unrendered.join(' '));

      await page.click('[data-tab="users"]');
      await page.waitForFunction(() => document.querySelector('#sections').textContent.includes('user-on-r2'), null, { timeout: 20000 });
      const users = await page.textContent('#sections');
      check('the users of both servers are in one table, with their server and cluster', users.includes('user-on-r1') && users.includes('user-on-r2') && users.includes('Alpha') && users.includes('Beta'));
      await page.click('tr[data-label="user-on-r2"] [data-act="kick-peer"]');
      check('a row action on the locked server reaches it, signed by this browser', await waitUntil(() => r2.output.includes('Signed by test-browser: /admin/kick-peer'), 15000), r2.output.split('\n').filter((line) => line.includes('Signed')).slice(-2).join(' | '));
      await page.click('tr[data-label="user-on-r1"] [data-act="kick-peer"]');
      check('and one on the other server reaches that one', await waitUntil(() => r1.output.includes('Signed by test-browser: /admin/kick-peer'), 15000));

      await page.selectOption('#filterCluster', 'Beta');
      await page.click('[data-tab="queues"]');
      await page.waitForSelector('#sections [data-server-row="r2"]', { timeout: 20000 });
      check('choosing a cluster shows only its servers', !(await page.$('#sections [data-server-row="r1"]')));
      await page.selectOption('#filterCluster', '');
      await page.waitForSelector('#sections [data-server-row="r1"]', { timeout: 20000 });
      await page.click('[data-group="queue-flush"]');
      await page.waitForFunction(() => /r1/.test(document.querySelector('#results').textContent) && /r2/.test(document.querySelector('#results').textContent), null, { timeout: 20000 });
      const results = await page.textContent('#results');
      check('a group action runs on every server shown, and says how each went', /r1[^\n]*ok/.test(results) && /r2[^\n]*ok/.test(results), results.slice(0, 300));
      check('the page ran without a script error', errors.length === 0, errors.join(' | '));
    } finally {
      for (const client of clients) client.close();
      await browser?.close();
      panel?.child.kill('SIGTERM');
      await fleet.stopAll();
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  if (wants('graph')) {
    section('graph: the network as nodes and links, and changing it');
    const { buildGraph } = await import(pathToFileURL(path.join(ROOT, 'tools/panel/web/graphdata.js')).href);
    const hex = (seed) => crypto.createHash('sha256').update(seed).digest('hex');
    const [A, B, C, E, P1, OP, OP2] = ['a', 'b', 'c', 'e', 'p1', 'op', 'op2'].map(hex);
    const s16 = (id) => id.slice(0, 16);
    const directory = { relays: [
      { id: A, name: 'a', cluster: 'X', region: 'inside-iran', gateway: 0 }, { id: B, name: 'b', cluster: 'X', region: 'inside-iran', gateway: 0 },
      { id: C, name: 'c', cluster: 'Y', region: 'outside-iran', gateway: 1 },
    ] };
    const graph = buildGraph({
      servers: [
        { name: 'a', relayId: A, cluster: 'X', region: 'inside-iran', locked: true, reachable: true },
        { name: 'b', relayId: B, cluster: 'X', region: 'inside-iran', reachable: true, inside: ['https://10.0.0.2:8585'] },
        { name: 'c', relayId: C, cluster: 'Y', region: 'outside-iran', gateway: 1, reachable: true },
      ],
      transit: {
        a: { directory, peers: [{ id: s16(B), fullId: B, linked: true, kind: 'family', traffic: { bytes: 10 } }, { id: s16(C), fullId: C, linked: false, kind: 'family' }] },
        b: { directory, peers: [{ id: s16(A), fullId: A, linked: true, kind: 'family' }, { id: s16(C), fullId: C, linked: true, kind: 'family' }, { id: s16(E), fullId: E, linked: true, kind: 'manual' }] },
        c: { directory, peers: [{ id: s16(A), fullId: A, linked: false, kind: 'family' }, { id: s16(B), fullId: B, linked: true, kind: 'family' }, { id: s16(P1), fullId: P1, linked: true, kind: 'partner' }] },
      },
      partners: {
        c: { self: { gateways: [{ id: s16(C), priority: 1 }] }, partners: [
          { operatorId: OP, name: 'Q', state: 'approved', relayIds: [s16(P1)], gateways: [{ id: s16(P1), name: 'q1', priority: 1, linked: true }], path: 'direct' },
          { operatorId: OP2, name: 'R', state: 'incoming', relayIds: [], gateways: [], path: `via:${s16(OP)}` },
        ] },
      },
    });
    const node = (key) => graph.nodes.find((entry) => entry.key === key);
    const edge = (kind, x, y) => graph.edges.find((entry) => entry.kind === kind && ((entry.from === x && entry.to === y) || (entry.from === y && entry.to === x)));
    check('every relay is a node, with its cluster, its gateway place and its lock',
      node(`relay:${s16(A)}`)?.cluster === 'X' && node(`relay:${s16(A)}`)?.locked === true && node(`relay:${s16(C)}`)?.gateway === 1 && node(`relay:${s16(B)}`)?.inside?.[0] === 'https://10.0.0.2:8585', JSON.stringify(graph.nodes).slice(0, 300));
    check('family links are one edge per pair, up when either end has it up',
      edge('family', `relay:${s16(A)}`, `relay:${s16(B)}`)?.linked === true && edge('family', `relay:${s16(A)}`, `relay:${s16(C)}`)?.linked === false
        && edge('family', `relay:${s16(B)}`, `relay:${s16(C)}`)?.linked === true && graph.edges.filter((entry) => entry.kind === 'family').length === 3, JSON.stringify(graph.edges.filter((entry) => entry.kind === 'family')));
    check('a manual link to a relay outside the family is an edge to a node of its own', node(`relay:${s16(E)}`)?.kind === 'external' && edge('manual', `relay:${s16(B)}`, `relay:${s16(E)}`)?.linked === true);
    check('a partner family is one node, linked from the gateway that reaches it', node(`partner:${s16(OP)}`)?.state === 'approved' && edge('partner', `relay:${s16(C)}`, `partner:${s16(OP)}`)?.linked === true);
    check('a partner reached through another is drawn through it', node(`partner:${s16(OP2)}`)?.state === 'incoming' && Boolean(edge('via', `partner:${s16(OP2)}`, `partner:${s16(OP)}`)));
    const clusterNamed = (name) => graph.clusters.find((entry) => entry.name === name);
    check('each cluster knows whether it stands alone and whether it reaches the others',
      clusterNamed('X')?.independent === true && clusterNamed('X')?.connected === true && clusterNamed('Y')?.members.length === 1, JSON.stringify(graph.clusters));

    /* Now real relays: family A (r1 gateway, r2 locked) and another operator's b1. */
    const dirlib = require('../../scripts/lib/relay-directory.js');
    const page = await import(pathToFileURL(path.join(ROOT, 'tools/panel/web/sign.js')).href);
    const tool = await import(pathToFileURL(path.join(ROOT, 'tools/relay-directory.mjs')).href);
    const keyA = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const keyB = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const spkiOf = (pair) => pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const opA = { key: spkiOf(keyA), id: dirlib.operatorIdFor(spkiOf(keyA)) };
    const opB = { key: spkiOf(keyB), id: dirlib.operatorIdFor(spkiOf(keyB)) };
    const FAST = { CHAT_DIRECTORY_PULL_MS: '3000', CHAT_PARTNER_PULL_MS: '3000', CHAT_JOIN_POLL_MS: '2000', CHAT_GATEWAY_STABLE_MS: '3000' };
    const fleet = await createFleet(['r1', 'r2', 'b1'], {
      env: {
        r1: () => ({ ...FAST, CHAT_OPERATOR_KEY: opA.key }),
        r2: () => ({ ...FAST, CHAT_OPERATOR_KEY: opA.key, CHAT_REQUIRE_OPERATOR_SIGNATURE: '1' }),
        b1: () => ({ ...FAST, CHAT_OPERATOR_KEY: opB.key }),
      },
    });
    const { r1, r2, b1 } = fleet.relays;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-webpanel-'));
    let panel = null;
    try {
      const device = await browserKey();
      const stranger = await browserKey();
      /* The operator's files, as relay-directory.mjs keeps them, on the panel's computer. */
      const draft = {
        relays: [
          { id: r1.id, name: 'r1', origins: [r1.origin], region: 'outside-iran', gateway: 1, cluster: 'Alpha' },
          { id: r2.id, name: 'r2', origins: [r2.origin], region: 'outside-iran', gateway: 0, cluster: 'Beta' },
        ],
        revoked: [], admins: [{ id: device.keyId, key: device.spki, name: 'office-browser' }],
      };
      fs.writeFileSync(path.join(home, 'operator-key.json'), JSON.stringify({ name: 'Graph Ops', id: opA.id, publicKey: opA.key, privateKey: keyA.privateKey.export({ type: 'pkcs8', format: 'pem' }), createdAt: '' }), { mode: 0o600 });
      fs.writeFileSync(path.join(home, 'relay-directory.draft.json'), JSON.stringify(draft), { mode: 0o600 });
      const docA = tool.signDraft(tool.loadState(home));
      fs.writeFileSync(path.join(home, 'relay-directory.json'), JSON.stringify(docA), { mode: 0o600 });
      const docB = dirlib.signDirectory({ v: 1, operator: { id: opB.id, key: opB.key, name: 'Bravo Ops' }, serial: 1, issuedAt: new Date().toISOString(),
        relays: [{ id: b1.id, name: 'b1', origins: [b1.origin], region: 'outside-iran', gateway: 1 }], revoked: [] }, keyB.privateKey);
      await fleet.startAll();
      for (const name of ['r1', 'r2']) await fleet.post(name, '/Monitor_Server/directory', docA);
      await fleet.post('b1', '/Monitor_Server/directory', docB);
      const { login, record } = await makeLoginFile(home, 'operator', 'a long test password 42');
      panel = await startPanel({ POORIJA_CONFIG_DIR: home, POORIJA_PANEL_DIRECT: `r1=${r1.origin},r2=${r2.origin}`, POORIJA_PANEL_PASSWORD: PASSWORD });
      const { port, host } = panel;
      const loggedIn = await raw(port, '/api/login', { method: 'POST', headers: { Host: host }, body: { username: 'operator', password: 'a long test password 42', code: login.totp(record.totp, Math.floor(Date.now() / 30000)) } });
      const cookie = String(loggedIn.headers?.['set-cookie']?.[0] || '').split(';')[0];
      const get = (route) => raw(port, route, { headers: { Host: host, Cookie: cookie } });
      const post = (route, body) => raw(port, route, { method: 'POST', headers: { Host: host, Cookie: cookie }, body });
      const k1 = `relay:${s16(r1.id)}`;
      const k2 = `relay:${s16(r2.id)}`;
      const graphNow = async () => (await get('/api/graph')).json || {};
      const linkedUp = await waitUntil(async () => (await graphNow()).edges?.some((entry) => entry.kind === 'family' && entry.linked), 20000);
      const live = await graphNow();
      check('the panel draws the real family: both relays, their clusters, r1 the gateway, r2 locked, and their link up',
        linkedUp && live.nodes?.find((entry) => entry.key === k1)?.cluster === 'Alpha' && live.nodes?.find((entry) => entry.key === k2)?.cluster === 'Beta'
          && live.nodes?.find((entry) => entry.key === k1)?.gateway === 1 && live.nodes?.find((entry) => entry.key === k2)?.locked === true, JSON.stringify(live).slice(0, 300));

      const saved = await post('/api/layout', { positions: { [k1]: { x: 120, y: -40 }, [k2]: { x: 300, y: 80 } } });
      check('where nodes were dragged is kept, on this computer only', saved.status === 200 && (await graphNow()).layout?.[k1]?.x === 120
        && JSON.parse(fs.readFileSync(path.join(home, 'control-panel-layout.json'), 'utf8'))[k2]?.y === 80);
      const badLayout = await post('/api/layout', { positions: { [k1]: { x: 'left', y: 1 } } });
      check('a layout that is not numbers is refused', badLayout.status === 400);

      const editable = await get('/api/directory');
      check('with the operator key on this computer, the family list can be changed here', editable.json?.canEdit === true && editable.json?.relays?.length === 2, editable.text.slice(0, 200));
      const edits = [{ op: 'cluster', name: 'r2', cluster: 'Alpha' }];
      const noSig = await post('/api/directory', { edits });
      check('moving a relay to another cluster needs a signature from a listed key', noSig.status === 403 && noSig.json?.reason === 'signature-needed');
      const sigBy = async (key) => page.signHeader({ method: 'POST', path: '/control-panel/directory', body: { edits }, relay: opA.id }, key);
      const strangers = await post('/api/directory', { edits, signature: await sigBy(stranger) });
      check('and not from a key the family does not list', strangers.status === 403 && strangers.json?.reason === 'bad-signature', strangers.text.slice(0, 160));
      const moved = await post('/api/directory', { edits, signature: await sigBy(device) });
      check('with one, the list is signed again and handed to every server', moved.status === 200 && moved.json?.serial === 2 && (moved.json?.published || []).every((entry) => entry.ok) && moved.json?.published?.length === 2, moved.text.slice(0, 300));
      const onRelay = (await fetchRelayDirectory(r1.origin));
      check('the relays hold the new list, r2 now in Alpha', onRelay?.body?.serial === 2 && onRelay.body.relays.find((relay) => relay.id === r2.id)?.cluster === 'Alpha', JSON.stringify(onRelay?.body?.relays));
      check('and the operator’s own files say the same, for the next deploy',
        JSON.parse(fs.readFileSync(path.join(home, 'relay-directory.json'), 'utf8')).body.serial === 2 && JSON.parse(fs.readFileSync(path.join(home, 'relay-directory.draft.json'), 'utf8')).relays.find((relay) => relay.name === 'r2').cluster === 'Alpha');
      await post('/api/family-refresh', {});
      check('the graph shows the move', await waitUntil(async () => (await graphNow()).nodes?.find((entry) => entry.key === k2)?.cluster === 'Alpha', 15000));

      const callAs = async (server, route, body, relay) => post('/api/call', { server, method: 'POST', path: route, body, signature: relay ? await page.signHeader({ method: 'POST', path: route, body, relay }, device) : '' });
      const gatewaysBody = { gateways: [{ id: r2.id, priority: 1 }, { id: r1.id, priority: 2 }] };
      const g1 = await callAs('r1', '/Monitor_Server/gateways', gatewaysBody, r1.id);
      const g2 = await callAs('r2', '/Monitor_Server/gateways', gatewaysBody, r2.id);
      check('gateway order set from the graph reaches both servers', g1.json?.answer?.ok === true && g2.json?.answer?.ok === true, `${g1.text.slice(0, 120)} ${g2.text.slice(0, 120)}`);
      check('and the graph shows r2 first, r1 second', await waitUntil(async () => { const now = await graphNow(); return now.nodes?.find((entry) => entry.key === k2)?.gateway === 1 && now.nodes?.find((entry) => entry.key === k1)?.gateway === 2; }, 15000));

      const asked = await callAs('r1', '/Monitor_Server/partners/request', { origin: b1.origin, operatorId: opB.id }, r1.id);
      check('a partner request from the graph goes out', asked.json?.answer?.ok === true, asked.text.slice(0, 200));
      const pk = `partner:${s16(opB.id)}`;
      check('and the other operator appears as a node, asked', await waitUntil(async () => (await graphNow()).nodes?.find((entry) => entry.key === pk)?.state === 'requested', 15000));
      await waitUntil(async () => ((await fleet.post('b1', '/Monitor_Server/partners', {})).partners || []).some((entry) => entry.operatorId === opA.id), 15000);
      await fleet.post('b1', '/Monitor_Server/partners/approve', { operatorId: opA.id });
      check('once they approve, a gateway links to them', await waitUntil(async () => { const now = await graphNow(); return now.nodes?.find((entry) => entry.key === pk)?.state === 'approved' && now.edges?.some((entry) => entry.kind === 'partner' && entry.to === pk && entry.linked); }, 30000), JSON.stringify((await graphNow()).edges));

      fs.renameSync(path.join(home, 'operator-key.json'), path.join(home, 'operator-key.away'));
      const readOnly = await get('/api/directory');
      const refused = await post('/api/directory', { edits, signature: await sigBy(device) });
      check('without the operator key here, clusters are only shown', readOnly.json?.canEdit === false && refused.status === 409 && refused.json?.reason === 'no-operator-key', `${readOnly.text.slice(0, 100)} ${refused.text.slice(0, 100)}`);
    } finally {
      panel?.child.kill('SIGTERM');
      await fleet.stopAll();
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  if (wants('network')) {
    section('network: the graph in a browser, and changing the network from it');
    const { chromium } = await import('playwright');
    const dirlib = require('../../scripts/lib/relay-directory.js');
    const tool = await import(pathToFileURL(path.join(ROOT, 'tools/relay-directory.mjs')).href);
    const keyA = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const opKey = keyA.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const opId = dirlib.operatorIdFor(opKey);
    const fleet = await createFleet(['r1', 'r2'], {
      env: { r1: () => ({ CHAT_OPERATOR_KEY: opKey }), r2: () => ({ CHAT_OPERATOR_KEY: opKey, CHAT_REQUIRE_OPERATOR_SIGNATURE: '1' }) },
    });
    const { r1, r2 } = fleet.relays;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-webpanel-'));
    let panel = null;
    let browser = null;
    const s16 = (id) => id.slice(0, 16);
    try {
      fs.writeFileSync(path.join(home, 'operator-key.json'), JSON.stringify({ name: 'Net Ops', id: opId, publicKey: opKey, privateKey: keyA.privateKey.export({ type: 'pkcs8', format: 'pem' }), createdAt: '' }), { mode: 0o600 });
      tool.saveDraft(home, { relays: [
        { id: r1.id, name: 'r1', origins: [r1.origin], region: 'outside-iran', gateway: 1, cluster: 'Alpha' },
        { id: r2.id, name: 'r2', origins: [r2.origin], region: 'outside-iran', gateway: 2, cluster: 'Beta' },
      ], revoked: [] });
      const publish = async () => {
        const doc = tool.signDraft(tool.loadState(home));
        tool.saveSigned(home, doc);
        for (const name of ['r1', 'r2']) await fleet.post(name, '/Monitor_Server/directory', doc);
        return doc;
      };
      await fleet.startAll();
      await publish();
      const { login, record } = await makeLoginFile(home, 'operator', 'a long test password 42');
      panel = await startPanel({ POORIJA_CONFIG_DIR: home, POORIJA_PANEL_DIRECT: `r1=${r1.origin},r2=${r2.origin}`, POORIJA_PANEL_PASSWORD: PASSWORD });
      browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'net-browser' : undefined));
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://${panel.host}/`);
      await page.fill('#loginUser', 'operator');
      await page.fill('#loginPassword', 'a long test password 42');
      await page.fill('#loginCode', login.totp(record.totp, Math.floor(Date.now() / 30000)));
      await page.click('#loginButton');
      await page.waitForSelector('#appView:not([hidden])');
      await page.click('[data-tab="keys"]');
      await page.click('#makeKey');
      await page.waitForSelector('#forgetKey');
      const device = await page.evaluate(async () => { const key = await (await import('/sign.js')).deviceKey(); return { spki: key.spki, keyId: key.keyId }; });
      tool.saveDraft(home, tool.applyEdit(tool.loadState(home).draft, { op: 'admin-add', admin: { name: 'net-browser', key: device.spki } }));
      await publish();
      await page.click('#checkAgain');
      await page.waitForFunction(() => document.querySelector('#deviceState')?.classList.contains('good'), null, { timeout: 15000 });

      await waitUntil(async () => (await fleet.linked('r1')).has(s16(r2.id)), 20000);
      await page.click('[data-tab="network"]');
      const n1 = `[data-node="relay:${s16(r1.id)}"]`;
      const n2 = `[data-node="relay:${s16(r2.id)}"]`;
      await page.waitForSelector(`${n1}`, { timeout: 20000 });
      check('the network tab draws both relays and both clusters as frames',
        Boolean(await page.$(n2)) && Boolean(await page.$('[data-cluster="Alpha"]')) && Boolean(await page.$('[data-cluster="Beta"]')));
      const linkDrawn = await page.waitForSelector('line.edge.family.up', { timeout: 20000, state: 'attached' }).then(() => true, () => false);
      check('and the family link between them, up', linkDrawn, await page.$$eval('svg line', (lines) => lines.map((line) => line.getAttribute('class')).join('|')));

      await page.click(n2);
      await page.waitForFunction(() => document.querySelector('#nodeName')?.textContent === 'r2', null, { timeout: 5000 });
      check('clicking a node shows its details and actions', Boolean(await page.$('#moveButton:not([disabled])')));
      await page.selectOption('#moveCluster', 'Alpha');
      await page.click('#moveButton');
      const movedOnRelays = await waitUntil(async () => (await fetchRelayDirectory(r1.origin))?.body?.relays?.find((relay) => relay.id === r2.id)?.cluster === 'Alpha', 20000);
      check('moving it to another cluster from the graph signs the family list again and the relays take it', movedOnRelays);
      check('and the graph redraws r2 inside Alpha', await page.waitForFunction(() => !document.querySelector('[data-cluster="Beta"]'), null, { timeout: 20000 }).then(() => true, () => false));

      await page.click(`[data-gw-up="relay:${s16(r2.id)}"]`);
      await page.click('#saveGateways');
      const reordered = await waitUntil(async () => {
        const self = (await fleet.post('r1', '/Monitor_Server/partners', {})).self || {};
        return (self.gateways || [])[0]?.id === s16(r2.id);
      }, 20000);
      check('reordering the gateways in the list and saving reaches the servers', reordered);

      await page.click(n1);
      await page.waitForFunction(() => document.querySelector('#nodeName')?.textContent === 'r1', null, { timeout: 5000 });
      await page.selectOption('#linkTarget', `relay:${s16(r2.id)}`);
      await page.click('#linkButton');
      const manual = await waitUntil(async () => ((await fleet.post('r1', '/Monitor_Server/transit', {})).peers || []).some((peer) => peer.fullId === r2.id && peer.kind === 'manual'), 15000);
      check('a manual link made from the graph reaches the relay', manual);
      const before = await page.getAttribute(n2, 'transform');
      await page.click('#refreshButton');
      await page.waitForTimeout(1500);
      check('new data does not move the nodes already drawn', await page.getAttribute(n2, 'transform') === before, `${before} ${await page.getAttribute(n2, 'transform')}`);

      const box = await (await page.$(n1)).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 8 });
      await page.mouse.up();
      const kept = await waitUntil(() => { try { return Boolean(JSON.parse(fs.readFileSync(path.join(home, 'control-panel-layout.json'), 'utf8'))[`relay:${s16(r1.id)}`]); } catch (_error) { return false; } }, 5000);
      check('dragging a node keeps where it was put, on this computer', kept);
      check('the page ran without a script error', errors.length === 0, errors.join(' | '));
    } finally {
      await browser?.close();
      panel?.child.kill('SIGTERM');
      await fleet.stopAll();
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  if (wants('docker')) {
    section('docker: the panel as an image');
    const { spawnSync } = await import('node:child_process');
    const run = (args, options = {}) => spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', timeout: 600000, ...options });
    const tag = 'poorija-control-panel:suite';
    const built = run(['build', '-f', 'config/Dockerfile.control-panel', '-t', tag, '.']);
    check('the image builds from config/Dockerfile.control-panel', built.status === 0, `${built.stderr || ''}`.split('\n').slice(-6).join(' | '));
    const compose = fs.existsSync(path.join(ROOT, 'config/control-panel.compose.yaml')) ? fs.readFileSync(path.join(ROOT, 'config/control-panel.compose.yaml'), 'utf8') : '';
    check('its compose file publishes it on this computer only and keeps the settings read-only',
      /127\.0\.0\.1:\$\{POORIJA_PANEL_PORT:-8686\}:8686/.test(compose) && /:\/config:\$\{POORIJA_CONFIG_ACCESS:-ro\}/.test(compose) && /\/ssh-src:ro/.test(compose), compose.slice(0, 200));
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-panel-image-'));
    const config = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-panel-config-'));
    let container = '';
    try {
      fs.chmodSync(state, 0o777);
      const noLogin = run(['run', '--rm', '-e', 'POORIJA_PANEL_DIRECT=a=http://127.0.0.1:9', '-v', `${state}:/state`, '-v', `${config}:/config:ro`, tag]);
      check('without a login it stops and says how to make one', noLogin.status !== 0 && /setup-login/.test(`${noLogin.stdout}${noLogin.stderr}`), `${noLogin.stdout}${noLogin.stderr}`.slice(0, 200));
      const { record } = await makeLoginFile(state, 'operator', 'a long test password 42');
      fs.chmodSync(path.join(state, 'control-panel-login.json'), 0o666);
      const port = await new Promise((resolve) => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const { port: free } = probe.address(); probe.close(() => resolve(free)); }); });
      const started = run(['run', '-d', '-p', `127.0.0.1:${port}:8686`, '-e', 'POORIJA_PANEL_DIRECT=a=http://127.0.0.1:9', '-e', `POORIJA_PANEL_ORIGINS=http://127.0.0.1:${port}`,
        '-v', `${state}:/state`, '-v', `${config}:/config:ro`, tag]);
      container = String(started.stdout || '').trim();
      const host = `127.0.0.1:${port}`;
      const up = await waitUntil(async () => (await raw(port, '/', { headers: { Host: host } })).status === 200, 20000, 300);
      const page = await raw(port, '/', { headers: { Host: host } });
      check('the container serves the login page at 127.0.0.1', up && page.text.includes('id="loginForm"'), `${started.stderr || ''} ${page.status}`);
      check('and nothing else without a session', (await raw(port, '/api/servers', { headers: { Host: host } })).status === 401);
      check('and another host name is refused', (await raw(port, '/', { headers: { Host: `evil.example:${port}` } })).status === 403);
      const user = String(run(['exec', container, 'sh', '-c', "ps -o user,args | grep 'panel/server.mjs' | grep -v grep"]).stdout || '');
      check('the panel runs as an unprivileged user inside the image', /^\s*node\s/m.test(user) && !/^\s*root\s/m.test(user), user.trim());
      check('the login file it was given is untouched', JSON.parse(fs.readFileSync(path.join(state, 'control-panel-login.json'), 'utf8')).hash === record.hash);
    } finally {
      if (container) run(['rm', '-f', container]);
      run(['rmi', '-f', tag]);
      fs.rmSync(state, { recursive: true, force: true });
      fs.rmSync(config, { recursive: true, force: true });
    }
  }
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n===== ${failed} failed of ${results.length} =====`);
  process.exit(failed ? 1 : 0);
}
