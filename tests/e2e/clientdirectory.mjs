/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The operator's relay directory in the app (js/chat/61-relay-directory.js).
 *
 * "rules"    the app's checks give the relay's answers on directories and
 *            handovers signed in Node (scripts/lib/relay-directory.js);
 * "relay"    against a real relay: the anchor at the first connection or from
 *            a QR code, keeping and refreshing, a key handover, the question
 *            about another operator, and a relay with no directory;
 * "qr"       the server code carries the anchor, and older apps still read
 *            the address out of it;
 * "settings" the relay family card in Connection and TURN.
 *
 *   node tests/e2e/clientdirectory.mjs            # every section
 *   node tests/e2e/clientdirectory.mjs rules      # one of them
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
import { openApp, browser, waitFor, PASS } from './_chat-harness.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const ids = require(path.join(root, 'scripts', 'lib', 'relay-identity.js'));
const dirlib = require(path.join(root, 'scripts', 'lib', 'relay-directory.js'));

const ONLY = new Set(process.argv.slice(2));
const wants = (name) => !ONLY.size || ONLY.has(name);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

/* ---- keys and documents, signed in Node ------------------------------------ */
const newKey = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const spki = (pair) => pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const party = (pair) => ({ id: dirlib.operatorIdFor(spki(pair)), key: spki(pair) });
function directory(pair, serial, relays, { revoked = [], name = 'Test family' } = {}) {
  const body = { v: 1, serial, operator: { ...party(pair), name }, relays, revoked, signedAt: '2026-11-08T12:00:00.000Z' };
  return dirlib.signDirectory(body, pair.privateKey);
}
const member = (id, origin, extra = {}) => ({ id, name: extra.name || 'relay', origins: [origin], region: 'outside-iran', gateway: 0, ...extra });

/* ---- a static server, a relay, and nginx's split between them ------------- */
function proxy(staticPort, relayPort) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const candidate = path.join(root, pathname === '/' ? 'index.html' : pathname);
    const isFile = candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    const upstream = http.request({ hostname: '127.0.0.1', port: isFile ? staticPort : relayPort.current, path: req.url, method: req.method, headers: req.headers }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
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
    listen: (port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }),
    close: () => new Promise((resolve) => { sockets.forEach((socket) => socket.destroy()); server.close(() => resolve()); }),
  };
}

const children = [];
const logs = [];
function run(file, env, label) {
  const child = spawn(process.execPath, [file], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (c) => { output += c; });
  child.stderr.on('data', (c) => { output += c; });
  children.push(child);
  logs.push({ label, read: () => output });
  return child;
}
const AUTH = 'Basic ' + Buffer.from('admin:Local-Test-Only-Password-36').toString('base64');

/* A relay with its own folder and identity; started, stopped and started
   again with other settings (the same identity), as a server is. */
async function makeRelay(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `poorija-clientdir-${name}-`));
  const identity = ids.generateRelayIdentity();
  fs.writeFileSync(path.join(dir, 'relay-identity.json'), JSON.stringify(identity, null, 2), { mode: 0o600 });
  const relay = { name, dir, identity, id: identity.id, port: { current: 0 }, child: null };
  relay.start = async ({ allowed = relay.allowed || '', operatorKey = '', directoryDoc = null } = {}) => {
    relay.allowed = allowed;
    const signal = await freePort();
    relay.port.current = signal;
    if (directoryDoc) fs.writeFileSync(path.join(dir, 'relay-directory.json'), JSON.stringify(directoryDoc));
    else fs.rmSync(path.join(dir, 'relay-directory.json'), { force: true });
    relay.child = run('scripts/server.js', {
      CHAT_SIGNAL_HOST: '127.0.0.1', CHAT_SIGNAL_PORT: String(signal), CHAT_PRESENCE_PORT: String(await freePort()),
      CHAT_BOOTSTRAP_PORT: '0', PORT: String(signal), DOMAIN: 'localhost', CHAT_ALLOWED_ORIGINS: allowed,
      MONITOR_PASSWORD: 'Local-Test-Only-Password-36', TURN_USER: 'local-test', TURN_PASSWORD: 'Local-Test-Only-Turn-36',
      CHAT_OPERATOR_KEY: operatorKey, CHAT_DIRECTORY_PATH: path.join(dir, 'relay-directory.json'), CHAT_UPDATES_DIR: path.join(dir, 'updates'),
      CHAT_OFFLINE_STORE_PATH: path.join(dir, 'offline-messages.json'), CHAT_OFFLINE_STORE_DIR: path.join(dir, 'mailboxes'),
      CHAT_PUSH_STORE_PATH: path.join(dir, 'push.json'), CHAT_VAPID_STORE_PATH: path.join(dir, 'vapid.json'),
      CHAT_POLICY_STORE_PATH: path.join(dir, 'policy.json'), CHAT_SELF_DESTRUCT_STORE_PATH: path.join(dir, 'self-destruct.json'),
      CHAT_EXPIRY_LOG_PATH: path.join(dir, 'expiry.json'), CHAT_TRANSIT_PEERS_STORE: path.join(dir, 'transit-peers.json'),
      CHAT_BEACON_DIR: path.join(dir, 'beacons'), CHAT_SIBLING_DIR: path.join(dir, 'siblings'), CHAT_ROSTER_DIR: path.join(dir, 'rosters'),
      CHAT_ALERTS: '0',
    }, `relay-${name}`);
    for (let i = 0; i < 150; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${signal}/chat-health`)).ok) return relay; } catch (_error) { /* not yet */ }
      await sleep(200);
    }
    throw new Error(`relay ${name} never came up:\n${logs.map((l) => `--- ${l.label}\n${l.read().slice(-1200)}`).join('\n')}`);
  };
  relay.stop = async () => {
    if (!relay.child || relay.child.exitCode !== null) return;
    const done = new Promise((resolve) => relay.child.once('exit', resolve));
    relay.child.kill('SIGTERM');
    await done;
  };
  relay.post = (route, body) => fetch(`http://127.0.0.1:${relay.port.current}${route}`, { method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
  return relay;
}

const staticPort = await freePort();
run('scripts/dev-static.js', { PORT: String(staticPort) }, 'static');
const proxies = [];
async function front(relay) {
  const port = await freePort();
  const door = proxy(staticPort, relay.port);
  await door.listen(port);
  proxies.push(door);
  return `http://localhost:${port}`;
}

try {
  /* ---- rules ---------------------------------------------------------------- */
  if (wants('rules')) {
    section('rules: the app checks what a relay checks');
    const opPair = newKey();
    const op = party(opPair);
    const R1 = 'a1'.repeat(32); const R2 = 'b2'.repeat(32); const R3 = 'c3'.repeat(32);
    const good = directory(opPair, 3, [member(R1, 'https://r1.example:8585', { name: 'r1', cluster: 'X' }), member(R2, 'https://r2.example:8585', { name: 'r2', inside: ['https://10.0.0.2:8585'] })]);
    const revokedListed = directory(opPair, 4, [member(R1, 'https://r1.example:8585')], { revoked: [R1] });
    const otherBody = directory(opPair, 3, [member(R1, 'https://r1.example:8585')]).body;
    const wrongSig = { body: good.body, sig: directory(opPair, 9, []).sig };
    const keyA = newKey(); const keyB = newKey(); const keyC = newKey();
    const ab = dirlib.signHandover({ from: party(keyA), to: party(keyB), at: '2026-11-08T12:00:00.000Z' }, keyA.privateKey);
    const bc = dirlib.signHandover({ from: party(keyB), to: party(keyC), at: '2026-11-08T12:00:00.000Z' }, keyB.privateKey);
    const nested = { z: [3, { y: 'پنل', a: null }], a: { c: true, b: 1.5 }, m: 'x"y' };
    /* Guest mode's switch on a relay: a boolean or nothing. */
    const guestsTrue = directory(opPair, 3, [member(R1, 'https://r1.example:8585', { guests: true })]);
    const guestsText = directory(opPair, 3, [member(R1, 'https://r1.example:8585', { guests: 'yes' })]);

    const relay = await makeRelay('rules');
    const origin = await front(relay);
    await relay.start({ allowed: origin });
    const PAGE = await openApp('RULES', { origin, relay: origin });
    const seen = await PAGE.evaluate(async (v) => {
      const at = (doc, options) => checkRelayDirectory(doc, options).then((r) => (r.ok ? 'ok' : r.reason));
      const base = { operatorKey: v.op.key, operatorId: v.op.id };
      return {
        canonical: directoryCanonicalJson(v.nested),
        id: await operatorIdOf(v.op.key),
        good: await at(v.good, base),
        goodNoKey: await at(v.good, { operatorId: v.op.id }),
        home: await at(v.good, { ...base, homeRelayId: v.R1 }),
        malformed: await at({ body: { v: 2 }, sig: 'x' }, base),
        wrongOperator: await at(v.good, { ...base, operatorId: 'ee'.repeat(32), operatorKey: '' }),
        badSignature: await at(v.wrongSig, base),
        revoked: await at(v.revokedListed, base),
        stale: await at(v.good, { ...base, heldSerial: 5 }),
        sameSerial: await at(v.good, { ...base, heldSerial: 3, heldBody: v.otherBody }),
        sameSerialSameBody: await at(v.good, { ...base, heldSerial: 3, heldBody: v.good.body }),
        homeNotListed: await at(v.good, { ...base, homeRelayId: v.R3 }),
        guestsTrue: await at(v.guestsTrue, base),
        guestsText: await at(v.guestsText, base),
        chain: (await followOperatorHandovers([v.bc, v.ab], v.A))?.id || '',
        broken: (await followOperatorHandovers([v.ab, { ...v.bc, sig: v.ab.sig }], v.A))?.id || '',
        none: await followOperatorHandovers([v.bc], v.A),
      };
    }, { op, good, revokedListed, otherBody, wrongSig, nested, R1, R3, ab, bc, A: party(keyA).id, guestsTrue, guestsText });
    check('canonical JSON is the bytes Node signs', seen.canonical === dirlib.canonicalJson(nested), seen.canonical);
    check('the operator is named as Node names it', seen.id === op.id);
    check('a directory the operator signed holds', seen.good === 'ok' && seen.goodNoKey === 'ok' && seen.home === 'ok', `${seen.good} ${seen.goodNoKey} ${seen.home}`);
    check('one that is not a directory is malformed', seen.malformed === 'malformed', seen.malformed);
    check('another operator’s is refused', seen.wrongOperator === 'wrong-operator', seen.wrongOperator);
    check('a signature that is not over this body is refused', seen.badSignature === 'bad-signature', seen.badSignature);
    check('a relay both listed and revoked is refused', seen.revoked === 'revoked-and-listed', seen.revoked);
    check('an older serial than the one kept is stale', seen.stale === 'stale' && seen.sameSerialSameBody === 'stale', `${seen.stale} ${seen.sameSerialSameBody}`);
    check('the same serial with another body is refused', seen.sameSerial === 'same-serial-different-body', seen.sameSerial);
    check('a directory that does not list the home relay is not about this family', seen.homeNotListed === 'home-not-listed', seen.homeNotListed);
    const nodeGuests = (doc) => (dirlib.verifyDirectory(doc, { operatorKey: op.key, selfId: R1 }).ok ? 'ok' : dirlib.verifyDirectory(doc, { operatorKey: op.key, selfId: R1 }).reason);
    check('guests is a boolean or nothing, in the app and on relays', seen.guestsTrue === 'ok' && seen.guestsText === 'malformed'
      && nodeGuests(guestsTrue) === 'ok' && nodeGuests(guestsText) === 'malformed', `${seen.guestsTrue} ${seen.guestsText} ${nodeGuests(guestsTrue)} ${nodeGuests(guestsText)}`);
    check('a chain of handovers is followed to its end', seen.chain === party(keyC).id);
    check('a broken link stops it, and no link means nothing', seen.broken === party(keyB).id && seen.none === null, `${seen.broken} ${seen.none}`);
    check('no page errors', !(PAGE.__errors || []).length, (PAGE.__errors || []).join(' | '));
    await PAGE.context().close();
    await relay.stop();
  }
  /* ---- relay ---------------------------------------------------------------- */
  if (wants('relay')) {
    section('relay: the anchor, keeping, refreshing, and a new key');
    const A = newKey(); const B = newKey(); const C = newKey();
    const relay = await makeRelay('home');
    const origin = await front(relay);
    const second = await front(relay);
    const listing = (serial, pair = A) => directory(pair, serial, [member(relay.id, origin, { name: 'home', cluster: 'Outside' }), member('d4'.repeat(32), 'https://other.example:8585', { name: 'other' })]);
    await relay.start({ allowed: `${origin},${second}`, operatorKey: party(A).key, directoryDoc: listing(1) });
    const APP = await openApp('FAMILY', { origin, relay: origin });
    const state = () => APP.evaluate(() => ({
      pin: chatState.profile.operatorPin || null,
      serial: chatState.profile.relayDirectory?.body?.serial || 0,
      operator: chatState.profile.relayDirectory?.body?.operator?.id || '',
      alert: chatState.operatorPinAlert ? { expected: chatState.operatorPinAlert.expected, seen: chatState.operatorPinAlert.seen } : null,
    }));
    const refresh = () => APP.evaluate(() => refreshRelayDirectory({ force: true }));

    const anchored = await waitFor(APP, () => Boolean(chatState.profile.operatorPin?.id), { timeoutMs: 30000 });
    let now = await state();
    check('after connecting, the app anchors to the operator its relay’s list names', anchored && now.pin?.id === party(A).id && now.pin.key === party(A).key && now.pin.source === 'first-connection', JSON.stringify(now.pin));
    check('and keeps that list', now.serial === 1 && now.operator === party(A).id, String(now.serial));

    const garbage = await APP.evaluate(async () => {
      const realFetch = window.fetch;
      window.fetch = async (url, options) => (String(url).includes('/relay-directory')
        ? new Response('<html>502 Bad Gateway</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
        : realFetch(url, options));
      try { return await refreshRelayDirectory({ force: true }); } finally { window.fetch = realFetch; }
    });
    now = await state();
    check('garbage is ignored: nothing kept from it, no question asked', garbage.ok === false && now.serial === 1 && !now.alert, `${JSON.stringify(garbage)} ${JSON.stringify(now)}`);

    const handed = await relay.post('/Monitor_Server/directory', listing(2));
    const fresher = await refresh();
    now = await state();
    check('a newer list from the relay replaces the kept one', handed.ok === true && fresher.ok === true && now.serial === 2, `${JSON.stringify(handed)} ${JSON.stringify(fresher)}`);
    const replayed = await APP.evaluate(async (old) => {
      const realFetch = window.fetch;
      window.fetch = async (url, options) => (String(url).includes('/relay-directory') ? new Response(JSON.stringify(old), { status: 200, headers: { 'Content-Type': 'application/json' } }) : realFetch(url, options));
      try { return await refreshRelayDirectory({ force: true }); } finally { window.fetch = realFetch; }
    }, listing(1));
    check('an older one replayed is refused', replayed.ok === false && replayed.reason === 'stale' && (await state()).serial === 2, JSON.stringify(replayed));

    const onMirror = await APP.evaluate(async (mirror) => {
      chatState.profile.activeMirror = { primary: configuredRelayOrigin(), origin: mirror, at: Date.now() };
      try { return await refreshRelayDirectory({ force: true }); } finally { delete chatState.profile.activeMirror; }
    }, second);
    check('on a mirror, the list still comes and is checked against the home relay', onMirror.ok === false ? onMirror.reason === 'stale' : onMirror.ok === true, JSON.stringify(onMirror));

    /* The first anchor comes only from the configured address, over HTTPS or a
       local network, from a relay whose identity is pinned and listed. */
    const anchorRules = await APP.evaluate(async ({ doc, mirror }) => {
      const kept = { pin: chatState.profile.operatorPin, dir: chatState.profile.relayDirectory, pins: JSON.parse(JSON.stringify(chatState.profile.relayPins || {})) };
      const fresh = () => { delete chatState.profile.operatorPin; delete chatState.profile.relayDirectory; chatState.profile.relayPins = JSON.parse(JSON.stringify(kept.pins)); };
      try {
        fresh();
        const fromMirror = await adoptRelayDirectory(doc, mirror);
        fresh();
        const plainPublic = await adoptRelayDirectory(doc, 'http://relay.example:8585');
        fresh();
        chatState.profile.relayPins = {};
        const noHomePin = await adoptRelayDirectory(doc, configuredRelayOrigin());
        fresh();
        const fromHome = await adoptRelayDirectory(doc, configuredRelayOrigin());
        return { fromMirror, plainPublic, noHomePin, fromHome, pinned: Boolean(chatState.profile.operatorPin) };
      } finally {
        chatState.profile.operatorPin = kept.pin; chatState.profile.relayDirectory = kept.dir; chatState.profile.relayPins = kept.pins;
      }
    }, { doc: listing(2), mirror: second });
    check('no first anchor from a mirror, a plain-HTTP public address, or a relay whose identity is not pinned',
      anchorRules.fromMirror.reason === 'not-anchored' && anchorRules.plainPublic.reason === 'not-anchored' && anchorRules.noHomePin.reason === 'not-anchored', JSON.stringify(anchorRules));
    check('from the configured address with its relay pinned, it anchors', anchorRules.fromHome.ok === true && anchorRules.pinned, JSON.stringify(anchorRules.fromHome));

    /* A reply far larger than any list is not read to its end. */
    const huge = await APP.evaluate(async () => {
      const realFetch = window.fetch;
      let pulled = 0;
      window.fetch = async (url, options) => {
        if (!String(url).includes('/relay-directory')) return realFetch(url, options);
        const stream = new ReadableStream({
          pull(controller) {
            pulled += 1;
            if (pulled > 200) { controller.close(); return; }
            controller.enqueue(new TextEncoder().encode(' '.repeat(65536)));
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      try { return { result: await refreshRelayDirectory({ force: true }), pulled }; } finally { window.fetch = realFetch; }
    });
    check('a reply far larger than any list is cut off unread', huge.result.ok === false && huge.pulled < 40, JSON.stringify(huge));

    /* The question shown is the one answered. */
    const toctou = await APP.evaluate(async ({ docC, docD }) => {
      const kept = { pin: chatState.profile.operatorPin, dir: chatState.profile.relayDirectory };
      try {
        chatState.operatorPinAlert = { expected: kept.pin.id, seen: docC.body.operator.id, doc: docC, origin: configuredRelayOrigin() };
        const shown = chatState.operatorPinAlert;
        chatState.operatorPinPromptOpen = true;
        const realFetch = window.fetch;
        window.fetch = async (url, options) => (String(url).includes('/relay-directory') ? new Response(JSON.stringify(docD), { status: 200 }) : realFetch(url, options));
        try { await refreshRelayDirectory({ force: true }); } finally { window.fetch = realFetch; }
        const stillShown = chatState.operatorPinAlert === shown;
        const replaced = { ...shown };
        const staleYes = acceptOperatorKey(replaced);
        const pinAfterStale = chatState.profile.operatorPin.id;
        return { stillShown, staleYes, pinAfterStale };
      } finally {
        chatState.operatorPinPromptOpen = false; chatState.operatorPinAlert = null;
        chatState.profile.operatorPin = kept.pin; chatState.profile.relayDirectory = kept.dir;
      }
    }, { docC: listing(5, C), docD: listing(6, B) });
    check('while the question is open, a list from yet another key does not replace it', toctou.stillShown === true, JSON.stringify(toctou));
    check('and a yes to a question no longer open accepts nothing', toctou.staleYes === false && toctou.pinAfterStale === party(A).id, JSON.stringify(toctou));

    await relay.stop();
    await APP.reload({ waitUntil: 'load' });
    await APP.waitForFunction(() => typeof loadPersistedChatState === 'function' && !!window.PoorijaApp);
    await APP.evaluate(async (pass) => {
      const profile = await PoorijaVault.openVault(pass);
      Object.assign(PoorijaApp.state, { activeProfile: profile, masterPassword: pass, isLocked: false });
      await migrateLegacyStorageIntoProfile(profile, pass);
      loadPersistedChatState();
    }, PASS);
    now = await state();
    check('kept across a restart, with the relay down', now.serial === 2 && now.pin?.id === party(A).id, JSON.stringify(now));
    const down = await refresh();
    check('and a refresh with the relay down changes nothing, said as no answer', down.ok === false && down.reason === 'unreachable' && (await state()).serial === 2, JSON.stringify(down));

    await relay.start({ operatorKey: party(A).key, directoryDoc: listing(2) });
    const qr = await APP.evaluate(async (id) => {
      delete chatState.profile.operatorPin; delete chatState.profile.relayDirectory;
      const set = setOperatorAnchorFromCode({ operatorId: id });
      const before = { ...chatState.profile.operatorPin };
      const result = await refreshRelayDirectory({ force: true });
      return { set, before, result, after: chatState.profile.operatorPin };
    }, party(A).id);
    check('a QR anchor names only the operator, and the first list from it fills in the key', qr.set === true && qr.before.source === 'qr' && !qr.before.key && qr.result.ok === true && qr.after.key === party(A).key && qr.after.source === 'qr', JSON.stringify(qr).slice(0, 300));
    const otherQr = await APP.evaluate(async (id) => {
      const kept = { pin: chatState.profile.operatorPin, dir: chatState.profile.relayDirectory };
      delete chatState.profile.operatorPin; delete chatState.profile.relayDirectory;
      setOperatorAnchorFromCode({ operatorId: id });
      const result = await refreshRelayDirectory({ force: true });
      const seen = { result, kept: Boolean(chatState.profile.relayDirectory), alert: Boolean(chatState.operatorPinAlert) };
      chatState.profile.operatorPin = kept.pin; chatState.profile.relayDirectory = kept.dir; chatState.operatorPinAlert = null;
      return seen;
    }, party(C).id);
    check('a QR naming another operator: nothing kept, and the person is asked', otherQr.result.ok === false && !otherQr.kept && otherQr.alert, JSON.stringify(otherQr));
    const qrAgain = await APP.evaluate((id) => setOperatorAnchorFromCode({ operatorId: id }), party(C).id);
    check('a QR never replaces an anchor that is set', qrAgain === false && (await state()).pin?.id === party(A).id);
    await APP.evaluate(() => { chatState.operatorPinAlert = null; document.querySelectorAll('.poorija-dialog, .dialog-backdrop').forEach((node) => node.remove()); });

    await relay.stop();
    await relay.start({ operatorKey: party(B).key, directoryDoc: listing(3, B) });
    const keptHandover = await relay.post('/Monitor_Server/operator-handover', dirlib.signHandover({ from: party(A), to: party(B), at: '2026-11-08T12:00:00.000Z' }, A.privateKey));
    const followed = await refresh();
    now = await state();
    check('a new key the old key handed over is followed without asking', keptHandover.ok === true && followed.ok === true && now.pin?.id === party(B).id && now.pin.source === 'handover' && !now.alert && now.serial === 3 && now.operator === party(B).id, `${JSON.stringify(followed)} ${JSON.stringify(now)}`);

    await relay.stop();
    await relay.start({ operatorKey: party(C).key, directoryDoc: listing(4, C) });
    const unexplained = await refresh();
    now = await state();
    check('a new key with no handover is a question, and the list is not believed meanwhile', unexplained.ok === false && unexplained.reason === 'operator-changed' && now.alert?.seen === party(C).id && now.pin?.id === party(B).id && now.operator === party(B).id, `${JSON.stringify(unexplained)} ${JSON.stringify(now)}`);
    const accepted = await APP.evaluate(() => acceptOperatorKey());
    now = await state();
    check('answered yes, the anchor moves and the list is kept', accepted === true && now.pin?.id === party(C).id && now.pin.source === 'accepted' && !now.alert && now.operator === party(C).id, JSON.stringify(now));
    await APP.evaluate(() => { document.querySelectorAll('.poorija-dialog, .dialog-backdrop').forEach((node) => node.remove()); });

    await relay.stop();
    await relay.start({ operatorKey: '', directoryDoc: null });
    const none = await APP.evaluate(async () => {
      delete chatState.profile.operatorPin; delete chatState.profile.relayDirectory; chatState.operatorPinAlert = null;
      const result = await refreshRelayDirectory({ force: true });
      return { result, pin: chatState.profile.operatorPin || null, alert: chatState.operatorPinAlert };
    });
    check('a relay with no list: no anchor, no question', none.result.ok === false && none.result.reason === 'no-directory' && !none.pin && !none.alert, JSON.stringify(none));
    check('no page errors', !(APP.__errors || []).length, (APP.__errors || []).join(' | '));
    await APP.context().close();
    await relay.stop();
  }
  /* ---- qr -------------------------------------------------------------------- */
  if (wants('qr')) {
    section('qr: the server code carries the anchor');
    const A = newKey();
    const relay = await makeRelay('qr');
    const origin = await front(relay);
    await relay.start({ allowed: origin, operatorKey: party(A).key, directoryDoc: directory(A, 1, [member(relay.id, origin, { name: 'qr' })]) });
    const APP = await openApp('QRCODE', { origin, relay: origin });
    const OP = 'ab'.repeat(32); const RELAY = 'cd'.repeat(32);
    const codes = await APP.evaluate(({ op, relay }) => {
      const link = window.PoorijaLocalLink;
      const code = link.buildRelayCode('https://a.example:8585/', { op, relay });
      return {
        code,
        plain: link.buildRelayCode('https://a.example:8585'),
        read: link.readRelayCode(code),
        oldWay: new URL(code.slice(5)).origin,
        parts: link.readRelayCodeParts(code),
        bad: link.readRelayCodeParts('P0R1|https://a.example:8585/#op=zz&relay=' + relay),
        bare: link.readRelayCodeParts('https://b.example:8585'),
      };
    }, { op: OP, relay: RELAY });
    check('the code names the address, the operator and the relay', codes.code === `P0R1|https://a.example:8585/#op=${OP}&relay=${RELAY}` && codes.plain === 'P0R1|https://a.example:8585', codes.code);
    check('read as before, it is still the address — and so for an older app', codes.read === 'https://a.example:8585' && codes.oldWay === 'https://a.example:8585');
    check('read in full, both ids come out', codes.parts.origin === 'https://a.example:8585' && codes.parts.op === OP && codes.parts.relay === RELAY, JSON.stringify(codes.parts));
    check('an id that is not one is dropped, and a bare address still reads', codes.bad.op === '' && codes.bad.relay === RELAY && codes.bare.origin === 'https://b.example:8585' && codes.bare.op === '', JSON.stringify([codes.bad, codes.bare]));

    const adopted = await APP.evaluate(({ op, relay }) => {
      const before = { pin: chatState.profile.operatorPin?.id || '', relayPin: chatState.profile.relayPins?.['https://c.example:8585']?.id || '' };
      window.PoorijaRelayDirectory.adoptCode({ origin: 'https://c.example:8585', op, relay });
      return { before, pin: chatState.profile.operatorPin?.id || '', relayPin: chatState.profile.relayPins?.['https://c.example:8585']?.id || '', pending: chatState.pendingRelayCode };
    }, { op: OP, relay: RELAY });
    check('a scanned code changes nothing until its address is the one in use', adopted.pin === adopted.before.pin && adopted.relayPin === '' && adopted.pending?.op === OP && adopted.pending.origin === 'https://c.example:8585', JSON.stringify(adopted));

    await waitFor(APP, () => Boolean(chatState.profile.operatorPin?.key), { timeoutMs: 30000 });
    const parts = await APP.evaluate(() => window.PoorijaRelayDirectory.codeParts(configuredRelayOrigin()));
    check('the app knows both ids of its own server once connected', parts.op === party(A).id && parts.relay === relay.id, JSON.stringify(parts));
    const shown = await APP.evaluate(async () => {
      const Real = window.QRCode;
      let text = '';
      window.QRCode = function Captured(box, options) { text = options.text; return new Real(box, options); };
      window.QRCode.CorrectLevel = Real.CorrectLevel;
      try { document.getElementById('lanPairShowBtn')?.click(); await new Promise((resolve) => setTimeout(resolve, 200)); } finally { window.QRCode = Real; }
      return text;
    });
    check('“show address as QR” hands the anchor on with the address', shown.startsWith(`P0R1|${origin}/#op=${party(A).id}&relay=${relay.id}`), shown);
    const promoted = await APP.evaluate(async ({ op, relay }) => {
      const kept = { pin: chatState.profile.operatorPin, pins: JSON.parse(JSON.stringify(chatState.profile.relayPins || {})) };
      delete chatState.profile.operatorPin;
      window.PoorijaRelayDirectory.adoptCode({ origin: configuredRelayOrigin(), op, relay });
      const result = await refreshRelayDirectory();
      const seen = { result, pin: chatState.profile.operatorPin, relayPin: chatState.profile.relayPins[configuredRelayOrigin()], pending: chatState.pendingRelayCode };
      return { seen, kept };
    }, { op: party(A).id, relay: relay.id });
    check('connected to the scanned address, its operator becomes the anchor and its relay is confirmed', promoted.seen.result.ok === true && promoted.seen.pin?.id === party(A).id && promoted.seen.pin.source === 'qr' && promoted.seen.relayPin?.id === relay.id && promoted.seen.relayPin.source === 'qr' && Boolean(promoted.seen.relayPin.publicKey) && !promoted.seen.pending, JSON.stringify(promoted.seen).slice(0, 300));
    const mismatch = await APP.evaluate(async (wrong) => {
      const before = chatState.profile.relayPins[configuredRelayOrigin()]?.id;
      window.PoorijaRelayDirectory.adoptCode({ origin: configuredRelayOrigin(), relay: wrong });
      await refreshRelayDirectory();
      return { before, after: chatState.profile.relayPins[configuredRelayOrigin()]?.id, flagged: chatState.relayCodeMismatch || null };
    }, 'ef'.repeat(32));
    check('a relay that is not the one the code named: the pin stays as it was, and it is said', mismatch.before === relay.id && mismatch.after === relay.id && mismatch.flagged?.expected === 'ef'.repeat(32) && mismatch.flagged.seen === relay.id, JSON.stringify(mismatch));
    check('no page errors', !(APP.__errors || []).length, (APP.__errors || []).join(' | '));
    await APP.context().close();
    await relay.stop();
  }
  /* ---- settings ------------------------------------------------------------ */
  if (wants('settings')) {
    section('settings: the relay family card');
    const A = newKey();
    const relay = await makeRelay('card');
    const origin = await front(relay);
    const listing = (serial) => directory(A, serial, [member(relay.id, origin, { name: 'home-relay', cluster: 'Outside', region: 'outside-iran' }), member('d4'.repeat(32), 'https://other.example:8585', { name: 'second-relay', region: 'inside-iran' })]);
    await relay.start({ allowed: origin, operatorKey: party(A).key, directoryDoc: listing(1) });
    const APP = await openApp('CARD', { origin, relay: origin });
    const hiddenBefore = await APP.evaluate(() => {
      const kept = chatState.profile.operatorPin;
      delete chatState.profile.operatorPin;
      const dir = chatState.profile.relayDirectory;
      delete chatState.profile.relayDirectory;
      renderRelayFamily();
      const hidden = document.getElementById('chatRelayFamily')?.classList.contains('hidden');
      if (kept) chatState.profile.operatorPin = kept;
      if (dir) chatState.profile.relayDirectory = dir;
      return hidden;
    });
    check('with no anchor and no list, there is no card', hiddenBefore === true);
    await waitFor(APP, () => Boolean(chatState.profile.relayDirectory), { timeoutMs: 30000 });
    const card = await APP.evaluate(() => {
      renderRelayFamily();
      const node = document.getElementById('chatRelayFamily');
      return { hidden: node?.classList.contains('hidden'), text: node?.textContent || '', rows: node?.querySelectorAll('[data-family-relay]').length || 0, home: node?.querySelector('[data-family-relay].is-home')?.textContent || '' };
    });
    check('after the first connection the card shows the family', card.hidden === false && card.rows === 2, JSON.stringify(card).slice(0, 200));
    check('naming the operator, where the trust came from, and the serial', card.text.includes(party(A).id.slice(0, 4)) && /first connection/i.test(card.text) && /#1\b/.test(card.text), card.text.slice(0, 300));
    check('the home relay marked', card.home.includes('home-relay') && /home/i.test(card.home), card.home);

    await relay.post('/Monitor_Server/directory', listing(3));
    await APP.evaluate(() => document.getElementById('chatRelayFamilyCheck')?.click());
    const checked = await waitFor(APP, () => /#3\b/.test(document.getElementById('chatRelayFamily')?.textContent || ''), { timeoutMs: 15000 });
    check('“check now” fetches the newer list and shows it', checked === true);
    if (process.env.CARD_SHOT) {
      /* A look at the card as a person sees it (not a check). */
      await APP.evaluate(() => { document.querySelector('[data-chat-rail-tab="settings"], [data-rail="settings"]')?.click(); setChatSettingsTab('connection'); });
      await sleep(800);
      await APP.locator('#chatRelayFamily').scrollIntoViewIfNeeded().catch(() => {});
      await APP.locator('#chatRelayFamily').screenshot({ path: process.env.CARD_SHOT }).catch((error) => console.log(`  (no picture: ${error.message.split('\n')[0]})`));
    }

    await relay.stop();
    await APP.reload({ waitUntil: 'load' });
    await APP.waitForFunction(() => typeof loadPersistedChatState === 'function' && !!window.PoorijaApp);
    const started = Date.now();
    await APP.evaluate(async (pass) => {
      const profile = await PoorijaVault.openVault(pass);
      Object.assign(PoorijaApp.state, { activeProfile: profile, masterPassword: pass, isLocked: false });
      await migrateLegacyStorageIntoProfile(profile, pass);
      loadPersistedChatState();
      renderStaticUi();
    }, PASS);
    const offline = await waitFor(APP, () => /#3\b/.test(document.getElementById('chatRelayFamily')?.textContent || '') && !document.getElementById('chatRelayFamily').classList.contains('hidden'), { timeoutMs: 2000 });
    check('offline, the kept list is on the card at once', offline === true && Date.now() - started < 8000, `${Date.now() - started} ms`);
    const persian = await APP.evaluate(() => {
      PoorijaApp.state.language = 'fa';
      window.dispatchEvent(new Event('poorija:language-changed'));
      return new Promise((resolve) => setTimeout(() => resolve(document.getElementById('chatRelayFamily')?.textContent || ''), 300));
    });
    check('and in Persian when the language changes', /خانوادهٔ رله‌ها/.test(persian), persian.slice(0, 120));
    check('no page errors', !(APP.__errors || []).length, (APP.__errors || []).join(' | '));
    await APP.context().close();
  }
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await Promise.all(proxies.map((door) => door.close().catch(() => {})));
  for (const child of children) { try { child.kill('SIGTERM'); } catch (_error) { /* gone */ } }
  await sleep(300);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
