/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* One panel for all of an operator's servers (docs/MONITOR-SERVER.md,
 * "Managing all your servers from one place").
 *
 * "rules" checks the signature a dangerous dashboard request carries and the
 * passphrase-sealed admin key on their own.
 *
 * "relay" runs two relays of one family: r2 is locked and takes a dangerous
 * action only signed; r1 is not, and has central control turned off.
 *
 * "admins" lists a laptop's admin key in the family directory, signs with
 * it, and takes it out again.
 *
 * "panel" runs tools/control-panel.mjs against two relays in its test-only
 * direct mode (loopback only; the SSH tunnel is the one part a test cannot
 * stand up): who may use it, what it shows, and that a dangerous action
 * through its proxy reaches a locked relay signed.
 *
 * "page" reads the page the panel serves: its controls, both languages, and
 * a script that parses.
 *
 *   node tests/e2e/centralpanel.mjs            # every section
 *   node tests/e2e/centralpanel.mjs rules      # one of them
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createFleet, waitUntil, sleep, short, fetchJson, AUTH } from './_relay-fleet.mjs';

const require = createRequire(import.meta.url);
const ONLY = new Set(process.argv.slice(2));
const wants = (name) => !ONLY.size || ONLY.has(name);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const spki = (publicKey) => publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const newKey = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

try {
  if (wants('rules')) {
    section('the rules');
    const sig = require('../../scripts/lib/operator-signature.js');
    const dirlib = require('../../scripts/lib/relay-directory.js');
    const adminKey = await import('../../tools/admin-key.mjs');

    const operator = newKey();
    const operatorKey = spki(operator.publicKey);
    const laptop = newKey();
    const laptopKey = spki(laptop.publicKey);
    const laptopId = dirlib.operatorIdFor(laptopKey);
    const relay = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    const body = { id: 'c'.repeat(64), origin: 'https://x.example:8585' };
    const keys = sig.signingKeys({ operator: { key: operatorKey }, admins: [{ id: laptopId, key: laptopKey, name: 'laptop' }] }, operatorKey);
    const now = Date.now();
    const signed = (over = {}, key = { keyId: laptopId, privateKey: laptop.privateKey }) => sig.signRequest({
      method: 'POST', path: '/Monitor_Server/transit-add', body, relay, at: now, nonce: crypto.randomBytes(16).toString('hex'), ...over,
    }, key);
    const verify = (header, over = {}) => sig.verifyRequest(header, {
      method: 'POST', path: '/Monitor_Server/transit-add', body, relay, now, keys, nonceSeen: () => false, ...over,
    });

    const good = verify(signed());
    check('a request signed by a listed admin key verifies, naming the admin', good.ok === true && good.name === 'laptop' && good.keyId === laptopId, JSON.stringify(good));
    check('one signed by the operator key verifies too', verify(signed({}, { keyId: dirlib.operatorIdFor(operatorKey), privateKey: operator.privateKey })).name === 'operator');
    const refused = (name, header, want, over) => {
      const verdict = verify(header, over);
      check(name, verdict.ok === false && verdict.reason === want, JSON.stringify(verdict));
    };
    refused('a header that is not one is malformed', 'v1.nonsense', 'malformed');
    const stranger = newKey();
    refused('a key nobody listed is unknown', signed({}, { keyId: dirlib.operatorIdFor(spki(stranger.publicKey)), privateKey: stranger.privateKey }), 'unknown-key');
    refused('a changed body breaks the signature', signed(), 'bad-signature', { body: { ...body, origin: 'https://evil.example' } });
    refused('so does another path', signed(), 'bad-signature', { path: '/Monitor_Server/transit-remove' });
    refused('a signature made for another relay is refused here', signed({ relay: other }), 'bad-signature');
    refused('one older than two minutes is stale', signed({ at: now - 3 * 60 * 1000 }), 'stale');
    refused('one heard before is replayed', signed(), 'replayed', { nonceSeen: () => true });
    check('the body is hashed the same however its keys are ordered', sig.bodyHash({ b: 1, a: [2, 1] }) === sig.bodyHash({ a: [2, 1], b: 1 }));

    const forged = sig.signingKeys({ operator: { key: operatorKey }, admins: [{ id: 'd'.repeat(64), key: laptopKey, name: 'liar' }, { id: laptopId, key: laptopKey, name: 'laptop' }] }, operatorKey);
    check('an admin whose id is not its key’s hash is dropped', forged.size === 2 && !forged.has('d'.repeat(64)) && forged.get(laptopId)?.name === 'laptop');

    check('the dangerous list covers what can do harm and not what only reads',
      ['/admin/change-password', '/admin/kick-peer', '/Monitor_Server/ops-backup-restore', '/Monitor_Server/partners/approve', '/Monitor_Server/gateways', '/Monitor_Server/ops-github-apply'].every((path) => sig.DANGEROUS_PATHS.has(path))
        && !sig.DANGEROUS_PATHS.has('/healthz') && !sig.DANGEROUS_PATHS.has('/Monitor_Server/transit') && !sig.DANGEROUS_PATHS.has('/Monitor_Server/partners'));

    check('a path is judged however it is cased or slashed, as the router judges it',
      ['/ADMIN/Kick-Peer', '/admin/kick-peer/', '//admin//kick-peer', '/Monitor_Server/TRANSIT-ADD/'].every((path) => sig.isDangerous(path))
        && sig.normalizePath('/Monitor_Server/Transit-Add//') === '/monitor_server/transit-add' && !sig.isDangerous('/healthz/'));
    check('creating a backup is on the list too, since it prunes old ones', sig.isDangerous('/Monitor_Server/ops-backup-create'));
    const variant = verify(signed({ path: '/MONITOR_SERVER/transit-add/' }));
    check('a signature made over one spelling of a path holds for another spelling of it', variant.ok === true, JSON.stringify(variant));
    /* A browser signs with WebCrypto: ECDSA P-256, the signature raw r||s. */
    const subtle = globalThis.crypto.subtle;
    const browserPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const browserKey = Buffer.from(await subtle.exportKey('spki', browserPair.publicKey)).toString('base64');
    const browserId = dirlib.operatorIdFor(browserKey);
    const browserKeys = sig.signingKeys({ admins: [{ id: browserId, key: browserKey, name: 'browser' }] }, operatorKey);
    const fields = { method: 'POST', path: '/Monitor_Server/transit-add', body, relay, at: now, nonce: crypto.randomBytes(16).toString('hex') };
    const raw = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, browserPair.privateKey, Buffer.from(sig.requestText(fields), 'utf8')));
    const browserHeader = `v1.${browserId}.${fields.at}.${fields.nonce}.${raw.toString('base64')}`;
    const fromBrowser = sig.verifyRequest(browserHeader, { method: 'POST', path: '/Monitor_Server/transit-add', body, relay, now, keys: browserKeys, nonceSeen: () => false });
    check('a signature made in a browser with WebCrypto verifies', raw.length === 64 && fromBrowser.ok === true && fromBrowser.name === 'browser', JSON.stringify(fromBrowser));
    const tamperedBrowser = sig.verifyRequest(browserHeader, { method: 'POST', path: '/Monitor_Server/transit-add', body: { ...body, origin: 'x' }, relay, now, keys: browserKeys, nonceSeen: () => false });
    check('and one whose body was changed does not', tamperedBrowser.ok === false && tamperedBrowser.reason === 'bad-signature');

    const made = adminKey.makeAdminKey('my laptop');
    const sealed = adminKey.sealAdminKey(made, 'correct horse battery staple');
    const opened = adminKey.openAdminKey(sealed, 'correct horse battery staple');
    check('the admin key opens with its passphrase', opened.privatePem === made.privatePem && opened.id === made.id && opened.id === dirlib.operatorIdFor(made.publicKey));
    let wrong = '';
    try { adminKey.openAdminKey(sealed, 'wrong'); } catch (error) { wrong = error.message; }
    check('and not with another', wrong === 'wrong passphrase', wrong);
    check('the sealed file holds no private key in the clear', !JSON.stringify(sealed).includes('PRIVATE KEY') && sealed.publicKey === made.publicKey && sealed.name === 'my laptop');
  }

  if (wants('relay')) {
    section('relay: signed dangerous actions, and the lock');
    const sig = require('../../scripts/lib/operator-signature.js');
    const dirlib = require('../../scripts/lib/relay-directory.js');
    const TOKEN = '123456:panel-suite-token';
    const sent = [];
    const telegram = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (req.url === `/bot${TOKEN}/sendMessage`) {
          try { sent.push(JSON.parse(body)); } catch (_error) { /* not JSON */ }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise((resolve) => telegram.listen(0, '127.0.0.1', resolve));
    const operator = newKey();
    const operatorKey = spki(operator.publicKey);
    const operatorId = dirlib.operatorIdFor(operatorKey);
    const fleet = await createFleet(['r1', 'r2'], {
      env: {
        r1: () => ({
          CHAT_OPERATOR_KEY: operatorKey, CHAT_CENTRAL_CONTROL: '0', CHAT_ALERT_INTERVAL_MS: '2000',
          TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: `http://127.0.0.1:${telegram.address().port}`, CHAT_ALERT_TELEGRAM_CHAT_ID: '424242',
        }),
        r2: () => ({ CHAT_OPERATOR_KEY: operatorKey, CHAT_REQUIRE_OPERATOR_SIGNATURE: '1', CHAT_ALERT_INTERVAL_MS: '2000' }),
      },
    });
    const { r1, r2 } = fleet.relays;
    const doc = dirlib.signDirectory({
      v: 1, operator: { id: operatorId, key: operatorKey, name: 'Panel Ops' }, serial: 1, issuedAt: new Date().toISOString(),
      relays: [r1, r2].map((relay) => ({ id: relay.id, name: relay.name, origins: [relay.origin], region: 'outside-iran', gateway: 0 })), revoked: [],
    }, operator.privateKey);
    const path = '/Monitor_Server/transit-add';
    const addBody = () => ({ id: crypto.randomBytes(32).toString('hex'), origin: '' });
    const post = (relay, route, body, headers = {}, auth = AUTH) => fetchJson(`${relay.origin}${route}`, {
      method: 'POST', body, headers: { ...(auth ? { Authorization: auth } : {}), ...headers },
    });
    const signedFor = (relay, route, body, forRelay = relay) => ({
      'X-Operator-Signature': sig.signRequest({ method: 'POST', path: route, body, relay: forRelay.id }, { keyId: operatorId, privateKey: operator.privateKey }),
    });
    try {
      await fleet.startAll();
      for (const name of ['r1', 'r2']) await fleet.post(name, '/Monitor_Server/directory', doc);
      await waitUntil(async () => (await fleet.linked('r1')).has(short(r2.id)));

      check('an unlocked relay takes a dangerous action unsigned, as it always has', (await post(r1, path, addBody())).ok === true);
      const unsigned = await post(r2, path, addBody());
      check('a locked relay refuses it unsigned', unsigned.status === 403 && unsigned.reason === 'operator-signature-required', JSON.stringify(unsigned));
      check('but still serves every read', (await fetchJson(`${r2.origin}/healthz`, { headers: { Authorization: AUTH } })).status === 200 && (await post(r2, '/Monitor_Server/transit', {})).ok === true);
      const health = await fetchJson(`${r2.origin}/chat-health`);
      check('and says it is locked', health.locked === true && (await fetchJson(`${r1.origin}/chat-health`)).locked === false, JSON.stringify({ locked: health.locked }));
      const spellings = [];
      for (const route of ['/MONITOR_SERVER/Transit-Add', '/Monitor_Server/transit-add/']) spellings.push(await post(r2, route, addBody()));
      check('another spelling of the path does not slip past the lock', spellings.every((answer) => answer.status === 403 && answer.reason === 'operator-signature-required'), JSON.stringify(spellings));
      const nobody = await post(r2, path, addBody(), {}, null);
      check('a caller without the password gets 401, which tells it nothing about the lock', nobody.status === 401, JSON.stringify(nobody));

      const body = addBody();
      const headers = signedFor(r2, path, body);
      const signed = await post(r2, path, body, headers);
      check('a request signed with the operator key is taken', signed.ok === true, JSON.stringify(signed));
      check('and the relay writes down who signed it', await waitUntil(() => r2.output.includes('Signed by operator') && r2.output.includes(path), 5000));
      check('and Telegram hears of it', await waitUntil(() => sent.some((message) => String(message.text || '').includes(path)), 15000), JSON.stringify(sent.map((m) => m.text)).slice(0, 300));
      const replay = await post(r2, path, body, headers);
      check('the same signed request again is refused', replay.status === 403 && replay.detail === 'replayed', JSON.stringify(replay));
      const elsewhere = addBody();
      const moved = await post(r2, path, elsewhere, signedFor(r2, path, elsewhere, r1));
      check('one signed for the other relay is refused here', moved.status === 403 && moved.detail === 'bad-signature', JSON.stringify(moved));
      const garbage = await post(r2, path, addBody(), { 'X-Operator-Signature': 'v1.garbage' });
      check('a broken signature is refused', garbage.status === 403 && garbage.reason === 'bad-operator-signature', JSON.stringify(garbage));
      const off = addBody();
      const centralOff = await post(r1, path, off, signedFor(r1, path, off));
      check('a relay with central control off refuses even a valid signed request', centralOff.status === 403 && centralOff.reason === 'central-control-off', JSON.stringify(centralOff));
    } finally {
      await fleet.stopAll();
      telegram.close();
    }
  }

  if (wants('admins')) {
    section('admins: keys the directory lists');
    const sig = require('../../scripts/lib/operator-signature.js');
    const dirlib = require('../../scripts/lib/relay-directory.js');
    const adminKey = await import('../../tools/admin-key.mjs');
    const operator = newKey();
    const operatorKey = spki(operator.publicKey);
    const operatorId = dirlib.operatorIdFor(operatorKey);
    const laptop = adminKey.makeAdminKey('laptop');
    const fleet = await createFleet(['solo'], { env: { solo: () => ({ CHAT_OPERATOR_KEY: operatorKey, CHAT_REQUIRE_OPERATOR_SIGNATURE: '1' }) } });
    const { solo } = fleet.relays;
    const directory = (serial, admins) => dirlib.signDirectory({
      v: 1, operator: { id: operatorId, key: operatorKey, name: 'Panel Ops' }, serial, issuedAt: new Date().toISOString(),
      relays: [{ id: solo.id, name: 'solo', origins: [solo.origin], region: 'outside-iran', gateway: 1 }], revoked: [],
      ...(admins.length ? { admins } : {}),
    }, operator.privateKey);
    const path = '/Monitor_Server/gateways';
    const tryWith = async () => {
      const body = { reset: true };
      const header = sig.signRequest({ method: 'POST', path, body, relay: solo.id }, { keyId: laptop.id, privateKey: crypto.createPrivateKey(laptop.privatePem) });
      return fetchJson(`${solo.origin}${path}`, { method: 'POST', body, headers: { Authorization: AUTH, 'X-Operator-Signature': header } });
    };
    try {
      await fleet.startAll();
      await fleet.post('solo', '/Monitor_Server/directory', directory(1, [{ id: laptop.id, key: laptop.publicKey, name: 'laptop' }]));
      const listed = await tryWith();
      check('a locked relay takes a request signed by an admin key the directory lists', listed.ok === true, JSON.stringify(listed));
      check('and names that admin in its log', await waitUntil(() => solo.output.includes('Signed by laptop'), 5000));
      await fleet.post('solo', '/Monitor_Server/directory', directory(2, []));
      const dropped = await tryWith();
      check('a newer directory without that key stops it at once', dropped.status === 403 && dropped.detail === 'unknown-key', JSON.stringify(dropped));
    } finally {
      await fleet.stopAll();
    }
  }

  if (wants('panel')) {
    section('panel: one place, on this computer');
    const dirlib = require('../../scripts/lib/relay-directory.js');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const operator = newKey();
    const operatorKey = spki(operator.publicKey);
    const operatorId = dirlib.operatorIdFor(operatorKey);
    const fleet = await createFleet(['r1', 'r2'], {
      env: {
        r1: () => ({ CHAT_OPERATOR_KEY: operatorKey }),
        r2: () => ({ CHAT_OPERATOR_KEY: operatorKey, CHAT_REQUIRE_OPERATOR_SIGNATURE: '1' }),
      },
    });
    const { r1, r2 } = fleet.relays;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-panel-'));
    const PASSWORD = 'Local-Test-Only-Password-36';
    let panel = null;
    /* A request with whatever Host and Origin a caller likes. */
    const raw = (port, route, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve) => {
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const request = http.request({ host: '127.0.0.1', port, path: route, method, headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...headers } }, (response) => {
        let text = '';
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => {
          let json = null;
          try { json = JSON.parse(text); } catch (_error) { /* not JSON */ }
          resolve({ status: response.statusCode, headers: response.headers, text, json });
        });
      });
      request.on('error', (error) => resolve({ status: 0, text: error.message }));
      request.end(payload || undefined);
    });
    try {
      await fleet.startAll();
      panel = spawn(process.execPath, ['tools/control-panel.mjs', '--port', '0', '--no-open'], {
        cwd: ROOT,
        env: {
          ...process.env,
          POORIJA_CONFIG_DIR: home,
          /* "impostor" answers at r1's address under a name the family
             directory does not have: the panel must never sign for it. */
          POORIJA_PANEL_DIRECT: `r1=${r1.origin},r2=${r2.origin},impostor=${r1.origin}`,
          POORIJA_PANEL_IDLE_MS: '6000',
          POORIJA_PANEL_PASSWORD: PASSWORD,
          POORIJA_PANEL_PASSPHRASE: 'a test passphrase',
          POORIJA_PANEL_ADMIN_NAME: 'test-laptop',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      panel.stdout.on('data', (chunk) => { out += chunk; });
      panel.stderr.on('data', (chunk) => { out += chunk; });
      const started = await waitUntil(() => /panel: http:\/\/127\.0\.0\.1:\d+\/login\?token=[a-f0-9]+/.test(out) && /proxy r2: http:\/\/127\.0\.0\.1:\d+/.test(out), 20000, 100);
      check('the panel starts and prints its one-time link and a proxy per server', started, out.slice(0, 400));
      const [, port, token] = /panel: http:\/\/127\.0\.0\.1:(\d+)\/login\?token=([a-f0-9]+)/.exec(out) || [];
      const proxyR2 = Number((/proxy r2: http:\/\/127\.0\.0\.1:(\d+)/.exec(out) || [])[1]);
      const proxyImpostor = Number((/proxy impostor: http:\/\/127\.0\.0\.1:(\d+)/.exec(out) || [])[1]);
      const host = `127.0.0.1:${port}`;

      /* The panel's admin key goes into the family directory, as the operator would. */
      const sealed = JSON.parse(fs.readFileSync(path.join(home, 'admin-key.json'), 'utf8'));
      check('the admin key file is the owner’s alone and holds no private key in the clear',
        (fs.statSync(path.join(home, 'admin-key.json')).mode & 0o777) === 0o600 && !JSON.stringify(sealed).includes('PRIVATE KEY') && sealed.name === 'test-laptop');
      const doc = dirlib.signDirectory({
        v: 1, operator: { id: operatorId, key: operatorKey, name: 'Panel Ops' }, serial: 1, issuedAt: new Date().toISOString(),
        relays: [r1, r2].map((relay) => ({ id: relay.id, name: relay.name, origins: [relay.origin], region: 'outside-iran', gateway: 0 })), revoked: [],
        admins: [{ id: sealed.id, key: sealed.publicKey, name: sealed.name }],
      }, operator.privateKey);
      for (const name of ['r1', 'r2']) await fleet.post(name, '/Monitor_Server/directory', doc);

      check('without the session cookie nothing answers', (await raw(port, '/api/servers', { headers: { Host: host } })).status === 401);
      const login = await raw(port, `/login?token=${token}`, { headers: { Host: host } });
      const cookie = String(login.headers?.['set-cookie']?.[0] || '').split(';')[0];
      check('the one-time link gives a session cookie, HttpOnly and SameSite=Strict',
        login.status === 302 && /HttpOnly/i.test(login.headers['set-cookie'][0]) && /SameSite=Strict/i.test(login.headers['set-cookie'][0]), JSON.stringify(login.headers['set-cookie']));
      check('and works only once', (await raw(port, `/login?token=${token}`, { headers: { Host: host } })).status === 403);
      const servers = await raw(port, '/api/servers', { headers: { Host: host, Cookie: cookie } });
      const byName = Object.fromEntries((servers.json?.servers || []).map((server) => [server.name, server]));
      check('the overview shows every server, its version and whether it is locked',
        servers.status === 200 && byName.r1?.reachable === true && /^2\.98\./.test(byName.r2?.version || '') && byName.r2.locked === true && byName.r1.locked === false && byName.r2.proxy === proxyR2,
        JSON.stringify(servers.json).slice(0, 300));
      check('a request from another site is refused', (await raw(port, '/api/servers', { headers: { Host: host, Cookie: cookie, Origin: 'http://evil.example' } })).status === 403);
      check('so is one naming another host (DNS rebinding)', (await raw(port, '/api/servers', { headers: { Host: `evil.example:${port}`, Cookie: cookie } })).status === 403);
      check('a server’s proxy wants the cookie too', (await raw(proxyR2, '/Monitor_Server/transit', { method: 'POST', body: {}, headers: { Host: `127.0.0.1:${proxyR2}` } })).status === 401);

      /* No operator confirmed yet: the directory the servers hand out, even
         one that lists this computer's key, is not taken on their word. */
      const unconfirmed = await raw(proxyR2, '/Monitor_Server/transit-add', { method: 'POST', body: { id: crypto.randomBytes(32).toString('hex'), origin: '' }, headers: { Host: `127.0.0.1:${proxyR2}`, Cookie: cookie } });
      check('until the admin confirms the operator, the panel signs nothing', unconfirmed.status === 409 && unconfirmed.json?.reason === 'operator-unconfirmed', unconfirmed.text.slice(0, 200));
      const listed = await raw(port, '/api/servers', { headers: { Host: host, Cookie: cookie } });
      check('and it shows the operator the servers name, for the admin to compare', (listed.json?.operator?.candidates || []).some((candidate) => candidate.id === operatorId) && listed.json.operator.confirmed === false, JSON.stringify(listed.json?.operator));
      const wrongTrust = await raw(port, '/api/trust', { method: 'POST', body: { operatorId: 'e'.repeat(64) }, headers: { Host: host, Cookie: cookie } });
      check('an operator id no server’s directory carries is refused', wrongTrust.status === 400, wrongTrust.text.slice(0, 120));
      const trusted = await raw(port, '/api/trust', { method: 'POST', body: { operatorId }, headers: { Host: host, Cookie: cookie } });
      check('the operator id the admin got from the operator is pinned', trusted.status === 200 && JSON.parse(fs.readFileSync(path.join(home, 'control-panel-trust.json'), 'utf8')).operatorId === operatorId, trusted.text.slice(0, 120));
      const added = await raw(proxyR2, '/Monitor_Server/transit-add', { method: 'POST', body: { id: crypto.randomBytes(32).toString('hex'), origin: '' }, headers: { Host: `127.0.0.1:${proxyR2}`, Cookie: cookie } });
      check('a dangerous action through the proxy reaches the locked relay, signed', added.status === 200 && added.json?.ok === true, added.text.slice(0, 200));
      check('the locked relay logs who signed it', await waitUntil(() => r2.output.includes('Signed by test-laptop'), 5000));
      const impostor = await raw(proxyImpostor, '/Monitor_Server/transit-add', { method: 'POST', body: { id: crypto.randomBytes(32).toString('hex'), origin: '' }, headers: { Host: `127.0.0.1:${proxyImpostor}`, Cookie: cookie } });
      check('the panel will not sign for a server the family directory does not name as it', impostor.status === 409 && impostor.json?.reason === 'identity-mismatch', impostor.text.slice(0, 200));
      check('the panel page cannot drive a server’s proxy either', (await raw(proxyR2, '/Monitor_Server/transit', { method: 'POST', body: {}, headers: { Host: `127.0.0.1:${proxyR2}`, Cookie: cookie, Origin: `http://127.0.0.1:${port}` } })).status === 403);
      const page = await raw(proxyR2, '/Monitor_Server', { headers: { Host: `127.0.0.1:${proxyR2}`, Cookie: cookie } });
      check('the server’s own dashboard opens through its proxy without a password', page.status === 200 && page.text.includes('id="tPartners"'), `${page.status}`);

      const home_page = await raw(port, '/', { headers: { Host: host, Cookie: cookie } });
      const policy = home_page.headers['content-security-policy'] || '';
      check('the panel serves its page, with a policy that keeps other sites and inline scripts out',
        home_page.status === 200 && home_page.text.includes('id="servers"') && /frame-ancestors 'none'/.test(policy) && /script-src 'self'(;|$)/.test(policy) && !/script-src[^;]*unsafe-inline/.test(policy), policy);
      const script = await raw(port, '/panel.js', { headers: { Host: host, Cookie: cookie } });
      check('and its script comes from its own address', script.status === 200 && /javascript/.test(script.headers['content-type'] || '') && script.text.includes('function rowHtml'));
      /* Watching the page is not using the key: polled for longer than the
         idle time, the key still locks itself. */
      for (let i = 0; i < 8; i += 1) { await raw(port, '/api/servers', { headers: { Host: host, Cookie: cookie } }); await sleep(1000); }
      const idle = await raw(proxyR2, '/Monitor_Server/transit-add', { method: 'POST', body: { id: crypto.randomBytes(32).toString('hex'), origin: '' }, headers: { Host: `127.0.0.1:${proxyR2}`, Cookie: cookie } });
      check('after the idle time the key is locked again, however often the page looked', idle.status === 423 && idle.json?.reason === 'unlock-needed', idle.text.slice(0, 160));
      const log = fs.readFileSync(path.join(home, 'control-panel.log'), 'utf8');
      check('the audit log has the action and whether it was signed', /r2 POST \/Monitor_Server\/transit-add signed 200/.test(log), log.slice(-300));
      const written = fs.readdirSync(home).map((name) => fs.readFileSync(path.join(home, name), 'utf8')).join('\n');
      check('nothing the panel wrote holds the password or a private key', !written.includes(PASSWORD) && !written.includes('PRIVATE KEY'));
    } finally {
      if (panel) panel.kill('SIGTERM');
      await fleet.stopAll();
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  if (wants('page')) {
    section('page: the controls');
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const file = path.join(ROOT, 'tools', 'control-panel.html');
    const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const scriptFile = path.join(ROOT, 'tools', 'control-panel.js');
    const js = fs.existsSync(scriptFile) ? fs.readFileSync(scriptFile, 'utf8') : '';
    check('the page carries no inline script; its script is a file of its own', !/<script>/.test(html) && html.includes('<script src="/panel.js"></script>') && js.length > 0);
    const ids = ['servers', 'serverRows', 'unlockBox', 'passphrase', 'unlockButton', 'trustBox', 'operatorId', 'operatorCandidates', 'trustButton', 'fleetCheck', 'fleetUpdate', 'fleetBackup', 'fleetAlert', 'results', 'langToggle'];
    const missing = ids.filter((id) => !html.includes(`id="${id}"`));
    check('the page has the server table, the fleet actions, the unlock box and the language switch', missing.length === 0, missing.join(', '));
    check('each row offers its dashboard, a lock switch and a password box', /data-open=/.test(js) && /data-lock=/.test(js) && /data-password=/.test(js));
    let parses = '';
    try { new vm.Script(js); } catch (error) { parses = error.message; }
    check('its script parses', js.length > 0 && !parses, parses);
    /* Every value a relay sends goes through esc() or Number() before it is
       written into the page. */
    const rowSource = (/function rowHtml[\s\S]*?\n}\n/.exec(js) || [''])[0];
    const raw = rowSource.match(/' \+ server\.[a-zA-Z.]+ \+ '/g) || [];
    check('nothing a relay sends reaches the page unescaped', rowSource.length > 0 && raw.length === 0, raw.join(' | '));
    const keys = ['title', 'unlock', 'passphrase', 'servers', 'version', 'load', 'memory', 'disk', 'online', 'links', 'family', 'partners', 'open', 'lockOn', 'lockOff',
      'locked', 'unlocked', 'passwordNeeded', 'fleet', 'check', 'update', 'backup', 'alertTest', 'tagPrompt', 'confirmUpdate', 'confirmBackup', 'confirmLock', 'confirmUnlock',
      'unreachable', 'wrongPassphrase', 'unlockFirst', 'sshOnly', 'keyLocked', 'keyOpen', 'trustNeeded', 'operatorIdLabel', 'trust', 'trustRefused'];
    const half = keys.filter((key) => (js.match(new RegExp(`[{,\\s]${key}:\\s*'`, 'g')) || []).length !== 2);
    check('every string is there in Persian and in English', half.length === 0, half.join(', '));
  }
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n===== ${failed} failed of ${results.length} =====`);
  process.exit(failed ? 1 : 0);
}
