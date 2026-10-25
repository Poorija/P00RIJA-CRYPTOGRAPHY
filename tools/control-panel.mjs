#!/usr/bin/env node
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
 * Runs on the admin's own computer and nowhere else. It reads the servers
 * from the same deploy.conf the deploy uses, opens an SSH tunnel to each
 * server's dashboard on that server's own loopback, reads the dashboard
 * password over SSH into memory, and serves a page on 127.0.0.1 only: every
 * server at a glance, a few actions for the whole fleet, and each server's
 * own dashboard through a local proxy that adds the password and, for the
 * dangerous actions, a signature from this computer's admin key.
 *
 *   node tools/control-panel.mjs                # opens the page
 *   node tools/control-panel.mjs --port 7000 --no-open
 *
 * Nothing is opened on any server for it, and nothing secret is written
 * here in the clear: the admin key is sealed under a passphrase, passwords
 * live in memory, and the audit log records what was done, never with what.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { configDir, parseDeployConf } from './relay-directory.mjs';
import { makeAdminKey, sealAdminKey, openAdminKey } from './admin-key.mjs';

const require = createRequire(import.meta.url);
const signatures = require('../scripts/lib/operator-signature.js');
const { verifyDirectory } = require('../scripts/lib/relay-directory.js');
const { relayIdFor } = require('../scripts/lib/relay-identity.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const ADMIN_FILE = 'admin-key.json';
const LOG_FILE = 'control-panel.log';
const TRUST_FILE = 'control-panel-trust.json';
const IDLE_MS = Math.max(1000, Number(process.env.POORIJA_PANEL_IDLE_MS || 15 * 60 * 1000));
const DASHBOARD_PORT = 9000;

const say = (line) => process.stdout.write(`${line}\n`);
const flagValue = (argv, name) => { const at = argv.indexOf(`--${name}`); return at >= 0 ? argv[at + 1] : undefined; };

/* ---- the servers ---------------------------------------------------------- */

/* POORIJA_PANEL_DIRECT is for the test suite: servers on this machine,
   reached without SSH. Only loopback addresses are taken, so it can never
   send a dashboard password across a network. */
function loadServers(dir) {
  const direct = String(process.env.POORIJA_PANEL_DIRECT || '').trim();
  if (direct) {
    return direct.split(',').map((pair) => {
      const [name, origin] = pair.split('=');
      const url = new URL(origin);
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('direct mode reaches loopback only');
      return { name, direct: url.origin };
    });
  }
  const file = path.join(dir, 'deploy.conf');
  if (!fs.existsSync(file)) throw new Error(`no deployment settings at ${file}; run scripts/deploy.sh once first`);
  const conf = parseDeployConf(fs.readFileSync(file, 'utf8'));
  return conf.servers.map((name) => ({
    name,
    ssh: {
      host: conf.fields(name, 'SSH_HOST'),
      user: conf.fields(name, 'SSH_USER') || os.userInfo().username,
      port: conf.fields(name, 'SSH_PORT') || '22',
      key: conf.fields(name, 'SSH_KEY').replace(/^~(?=\/)/, os.homedir()),
      dir: conf.fields(name, 'REMOTE_DIR') || '~/work/pkg',
    },
  })).filter((server) => server.ssh.host);
}

const sshArgs = (ssh, extra = []) => [
  '-p', ssh.port, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
  ...(ssh.key ? ['-i', ssh.key, '-o', 'IdentitiesOnly=yes'] : []), ...extra, `${ssh.user}@${ssh.host}`,
];
/* A script on stdin to `bash -s`: whatever the login shell, and nothing on
   a command line. */
const onServer = (ssh, script) => {
  const run = spawnSync('ssh', [...sshArgs(ssh), 'bash -s'], { input: script, encoding: 'utf8', timeout: 60000 });
  return { ok: run.status === 0, out: String(run.stdout || ''), err: String(run.stderr || '') };
};

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

/* One tunnel per server, kept up: a dropped one comes back with backoff. */
async function openTunnel(server) {
  const port = await freePort();
  server.base = `http://127.0.0.1:${port}`;
  let delay = 2000;
  const start = () => {
    const child = spawn('ssh', [...sshArgs(server.ssh, ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${port}:127.0.0.1:${DASHBOARD_PORT}`])], { stdio: 'ignore' });
    server.tunnel = child;
    const upAt = Date.now();
    child.on('exit', () => {
      if (server.closing) return;
      if (Date.now() - upAt > 60000) delay = 2000;
      setTimeout(start, delay).unref?.();
      delay = Math.min(delay * 2, 60000);
    });
  };
  start();
}

function readPassword(server) {
  if (server.direct) return String(process.env.POORIJA_PANEL_PASSWORD || '');
  const dir = server.ssh.dir.replace(/'/g, '');
  const read = onServer(server.ssh, `sed -n 's/^MONITOR_PASSWORD=//p' '${dir}/.env' 2>/dev/null | head -1 | tr -d "\\"'"\n`);
  return read.ok ? read.out.trim() : '';
}

/* ---- talking to one server ------------------------------------------------ */

function serverRequest(server, route, { method = 'GET', body, headers = {}, auth = true } = {}) {
  return new Promise((resolve) => {
    if (!server.base) return resolve({ status: 0, json: null, text: 'no route' });
    const url = new URL(route, server.base);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({
      host: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(auth && server.password ? { Authorization: `Basic ${Buffer.from(`admin:${server.password}`).toString('base64')}` } : {}),
        ...headers,
      },
      timeout: 20000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_error) { /* not JSON */ }
        resolve({ status: response.statusCode, json, text });
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', (error) => resolve({ status: 0, json: null, text: error.message }));
    request.end(payload || undefined);
  });
}

/* ---- this computer's admin key ------------------------------------------- */

const admin = { file: null, open: null, lastUse: 0 };

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => { if (text.includes(question)) rl.output.write(text); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function prepareAdminKey(dir) {
  const file = path.join(dir, ADMIN_FILE);
  const fromEnv = process.env.POORIJA_PANEL_PASSPHRASE;
  if (fs.existsSync(file)) {
    admin.file = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    const name = process.env.POORIJA_PANEL_ADMIN_NAME || os.hostname().split('.')[0] || 'admin';
    let passphrase = fromEnv;
    if (!passphrase) {
      if (!process.stdin.isTTY) throw new Error('no admin key yet; run the panel once in a terminal to make one');
      say(`This computer has no admin key yet. Making one called "${name}".`);
      passphrase = await promptHidden('A passphrase for it (at least 10 characters): ');
      if (String(passphrase).length < 10) throw new Error('the passphrase is too short');
      if (await promptHidden('The same passphrase again: ') !== passphrase) throw new Error('the two passphrases differ');
    }
    const made = makeAdminKey(name);
    admin.file = sealAdminKey(made, passphrase);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(admin.file, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    say(`admin key made: ${file}`);
    say('For it to sign, the operator lists it in the family directory (on the computer with the operator key):');
    say(`  node tools/relay-directory.mjs admin-add ${JSON.stringify(made.name)} ${made.publicKey}`);
    say('  node tools/relay-directory.mjs sign && node tools/relay-directory.mjs publish');
  }
  if (fromEnv) unlock(fromEnv);
}

function unlock(passphrase) {
  const opened = openAdminKey(admin.file, passphrase);
  admin.open = { keyId: opened.id, name: opened.name, privateKey: crypto.createPrivateKey(opened.privatePem) };
  admin.lastUse = Date.now();
}
/* Whether the key is open, without counting as a use: the page asks every
   few seconds, and asking must not keep the key open for ever. */
function isUnlocked() {
  if (admin.open && Date.now() - admin.lastUse > IDLE_MS) admin.open = null;
  return Boolean(admin.open);
}
/* The key, for a signature about to be made; only that counts as a use. */
function signingKey() {
  if (!isUnlocked()) return null;
  admin.lastUse = Date.now();
  return admin.open;
}

/* ---- whom a signature is for ----------------------------------------------

   A signature names the relay it is for, and that name must never come from
   the server being talked to: a server that lied about who it is would be
   handed signatures good on another relay. So each server's relay id comes
   from the family's signed directory, by the name deploy.conf gives it, and
   the panel signs for a server only when the identity it answers with is
   that one.

   Which operator signed the right directory is never taken from a server
   either, since a server can sign a directory of its own: it is the operator
   key beside deploy.conf when this is the operator's computer
   (relay-directory.json), or the operator id the admin confirms in the page
   (or gives as POORIJA_PANEL_OPERATOR_ID) from what the operator told them
   (`node tools/relay-directory.mjs show` prints it). Until then the panel
   signs nothing. The confirmed operator is kept in control-panel-trust.json. */
let trustFile = '';
let familyCache = { at: 0, body: null };
const readJsonFile = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return null; } };
const selfSigned = (doc) => Boolean(doc?.body?.operator?.key)
  && verifyDirectory(doc, { operatorKey: String(doc.body.operator.key), selfId: doc.body.relays?.[0]?.id }).ok
  && relayIdFor(String(doc.body.operator.key)) === doc.body.operator.id;

async function directoriesOnOffer(dir) {
  const offers = [];
  const local = readJsonFile(path.join(dir, 'relay-directory.json'));
  if (selfSigned(local)) offers.push({ doc: local, local: true });
  for (const server of servers) {
    const answer = await serverRequest(server, '/relay-directory', { auth: false });
    if (selfSigned(answer.json)) offers.push({ doc: answer.json, local: false });
  }
  return offers;
}
function confirmedOperator(offers) {
  const pinned = readJsonFile(trustFile);
  if (pinned?.operatorId) return pinned.operatorId;
  const given = String(process.env.POORIJA_PANEL_OPERATOR_ID || '').toLowerCase();
  if (/^[a-f0-9]{64}$/.test(given)) return given;
  return offers.find((offer) => offer.local)?.doc.body.operator.id || '';
}
function pinOperator(body) {
  if (readJsonFile(trustFile)?.operatorId) return;
  fs.writeFileSync(trustFile, `${JSON.stringify({ operatorId: body.operator.id, operatorKey: body.operator.key, name: body.operator.name, pinnedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(trustFile, 0o600);
  audit(`family operator pinned: ${body.operator.name} ${body.operator.id.slice(0, 16)}`);
}
async function familyDirectory(dir) {
  if (familyCache.body && Date.now() - familyCache.at < 60000) return familyCache.body;
  const offers = await directoriesOnOffer(dir);
  const operatorId = confirmedOperator(offers);
  let best = null;
  for (const { doc } of offers) {
    if (!operatorId || doc.body.operator.id !== operatorId) continue;
    if (!best || doc.body.serial > best.body.serial) best = doc;
  }
  if (best) pinOperator(best.body);
  familyCache = { at: Date.now(), body: best ? best.body : null };
  return familyCache.body;
}
/* The relay id a signature for this server may name, or why there is none. */
async function signableRelayId(server) {
  const family = await familyDirectory(configDir());
  if (!family) return { id: '', reason: 'operator-unconfirmed' };
  const expected = family.relays?.find((relay) => relay.name === server.name)?.id || '';
  return expected && expected === server.relayId ? { id: expected } : { id: '', reason: 'identity-mismatch' };
}

/* ---- the audit log -------------------------------------------------------- */

let auditFile = '';
function audit(line) {
  try {
    fs.appendFileSync(auditFile, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
  } catch (_error) { /* the panel goes on */ }
}

/* ---- who may use the panel ------------------------------------------------ */

const session = { token: crypto.randomBytes(24).toString('hex'), secret: crypto.randomBytes(32).toString('hex') };
const cookieOf = (req) => (String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('panel=')) || '').slice(6);
const sameSecret = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
/* Only this computer's browser, on these exact addresses: the cookie, the
   Host (a name pointed at 127.0.0.1 by another site does not pass), and no
   Origin but our own. */
function allowed(req, port) {
  if (req.headers.host !== `127.0.0.1:${port}`) return 403;
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}`) return 403;
  const cookie = cookieOf(req);
  if (!cookie || !sameSecret(cookie, session.secret)) return 401;
  return 0;
}
const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req, limit = 1024 * 1024) => new Promise((resolve) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => { size += chunk.length; if (size <= limit) chunks.push(chunk); });
  req.on('end', () => resolve(size > limit ? null : Buffer.concat(chunks)));
  req.on('error', () => resolve(null));
});

/* ---- each server's dashboard, through its proxy ---------------------------- */

const HOP_HEADERS = new Set(['host', 'cookie', 'origin', 'referer', 'authorization', 'connection', 'content-length', 'x-operator-signature']);
function proxyFor(server) {
  return http.createServer(async (req, res) => {
    const refusal = allowed(req, server.proxy);
    if (refusal) return sendJson(res, refusal, { ok: false, reason: refusal === 401 ? 'login' : 'forbidden' });
    const raw = await readBody(req);
    if (raw === null) return sendJson(res, 413, { ok: false, reason: 'too-large' });
    const url = new URL(req.url, 'http://127.0.0.1');
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) => !HOP_HEADERS.has(key.toLowerCase())));
    let signed = false;
    if (req.method === 'POST' && signatures.isDangerous(url.pathname)) {
      if (!isUnlocked()) return sendJson(res, 423, { ok: false, reason: 'unlock-needed' });
      const { id: relay, reason } = await signableRelayId(server);
      if (!relay) {
        audit(`${server.name} ${req.method} ${url.pathname} refused: ${reason}`);
        return sendJson(res, 409, { ok: false, reason });
      }
      let body = {};
      try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch (_error) { return sendJson(res, 400, { ok: false, reason: 'bad-json' }); }
      headers['x-operator-signature'] = signatures.signRequest({ method: 'POST', path: url.pathname, body, relay }, signingKey());
      signed = true;
    }
    const upstream = http.request({
      host: '127.0.0.1', port: new URL(server.base).port, path: req.url, method: req.method,
      headers: {
        ...headers,
        ...(server.password ? { authorization: `Basic ${Buffer.from(`admin:${server.password}`).toString('base64')}` } : {}),
        ...(raw.length ? { 'content-length': raw.length } : {}),
      },
    }, (answer) => {
      if (req.method !== 'GET') audit(`${server.name} ${req.method} ${url.pathname} ${signed ? 'signed' : 'unsigned'} ${answer.statusCode}`);
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    upstream.on('error', () => sendJson(res, 502, { ok: false, reason: 'unreachable' }));
    upstream.end(raw.length ? raw : undefined);
  });
}

/* ---- the overview and the fleet ------------------------------------------- */

async function describe(server) {
  const health = await serverRequest(server, '/chat-health', { auth: false });
  const row = { name: server.name, proxy: server.proxy, reachable: health.status === 200, version: String(health.json?.version || '').slice(0, 40), locked: health.json?.locked === true, passwordOk: false };
  if (!row.reachable) return row;
  const [stats, transit, partners] = await Promise.all([
    serverRequest(server, '/healthz'),
    serverRequest(server, '/Monitor_Server/transit', { method: 'POST', body: {} }),
    serverRequest(server, '/Monitor_Server/partners', { method: 'POST', body: {} }),
  ]);
  /* Only numbers and short strings go on to the page. */
  const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  row.passwordOk = stats.status === 200;
  if (stats.json) {
    Object.assign(row, {
      cpu: Array.isArray(stats.json.cpuLoad) ? stats.json.cpuLoad.slice(0, 3).map(n) : [n(stats.json.cpuLoad)],
      memory: { total: n(stats.json.memory?.total), free: n(stats.json.memory?.free) },
      storage: { total: n(stats.json.storage?.total), free: n(stats.json.storage?.free) },
      peers: n(typeof stats.json.peers === 'object' ? stats.json.peers?.length ?? stats.json.peers?.count : stats.json.peers),
    });
  }
  if (transit.json?.status) row.links = { up: n(transit.json.status.up), allowed: n(transit.json.status.allowed) };
  if (transit.json?.directory) row.family = { serial: n(transit.json.directory.serial), name: String(transit.json.directory.operator?.name || '').slice(0, 60) };
  if (Array.isArray(partners.json?.partners)) row.partners = partners.json.partners.slice(0, 50).map((entry) => ({ name: String(entry.name || '').slice(0, 60), state: String(entry.state || '').slice(0, 20) }));
  return row;
}

const FLEET = {
  check: { route: '/Monitor_Server/ops-github-check' },
  update: { route: '/Monitor_Server/ops-github-apply', oneByOne: true },
  backup: { route: '/Monitor_Server/ops-backup-create' },
  'alert-test': { route: '/Monitor_Server/alert-test' },
};
async function runFleet(action, body) {
  const plan = FLEET[action];
  const results = [];
  for (const server of servers) {
    const headers = {};
    if (signatures.isDangerous(plan.route)) {
      if (!isUnlocked()) return { ok: false, reason: 'unlock-needed', results };
      const { id: relay, reason } = await signableRelayId(server);
      if (!relay) {
        results.push({ server: server.name, status: 409, answer: { ok: false, reason } });
        if (plan.oneByOne) break;
        continue;
      }
      headers['X-Operator-Signature'] = signatures.signRequest({ method: 'POST', path: plan.route, body, relay }, signingKey());
    }
    const answer = await serverRequest(server, plan.route, { method: 'POST', body, headers });
    audit(`${server.name} POST ${plan.route} ${headers['X-Operator-Signature'] ? 'signed' : 'unsigned'} ${answer.status} (fleet ${action})`);
    results.push({ server: server.name, status: answer.status, answer: answer.json });
    /* An update stops at the first server that does not take it. */
    if (plan.oneByOne && !(answer.status === 200 && answer.json?.ok)) break;
  }
  return { ok: true, results };
}

async function setLock(server, on) {
  if (!server.ssh) return { ok: false, reason: 'ssh-only' };
  const dir = server.ssh.dir.replace(/'/g, '');
  const script = `set -u
cd '${dir}' || exit 1
cp -p .env .env.bak-lock 2>/dev/null
sed -i '/^CHAT_REQUIRE_OPERATOR_SIGNATURE=/d' .env
printf 'CHAT_REQUIRE_OPERATOR_SIGNATURE=%s\\n' '${on ? '1' : '0'}' >> .env
project="$(docker inspect Poorija-Cryptography_ChatSignal --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || echo config)"
version="$(sed -n 's/.*"version": *"\\([^"]*\\)".*/\\1/p' package.json 2>/dev/null | head -1)"
OPS_INSTALL_DIR="$PWD" OPS_BACKUP_DIR="$PWD/backups" APP_VERSION="$version" \\
  docker compose -p "\${project:-config}" --env-file .env -f config/docker-compose.yaml up -d chat-signal >/dev/null 2>&1
echo done
`;
  const run = onServer(server.ssh, script);
  audit(`${server.name} lock ${on ? 'on' : 'off'} ${run.ok ? 'done' : 'failed'}`);
  return { ok: run.ok && run.out.includes('done') };
}

/* ---- the page and its API ------------------------------------------------- */

let servers = [];
let panelPort = 0;

async function api(req, res, url) {
  if (url.pathname === '/api/servers' && req.method === 'GET') {
    const offers = await directoriesOnOffer(configDir());
    const operatorId = confirmedOperator(offers);
    const candidates = Array.from(new Map(offers.map(({ doc }) => [doc.body.operator.id, { id: doc.body.operator.id, name: String(doc.body.operator.name || '').slice(0, 60) }])).values());
    return sendJson(res, 200, {
      ok: true,
      unlocked: isUnlocked(),
      admin: { name: admin.file?.name, id: admin.file?.id },
      operator: { confirmed: Boolean(operatorId), id: operatorId, candidates },
      servers: await Promise.all(servers.map(describe)),
    });
  }
  const raw = await readBody(req, 64 * 1024);
  let body = {};
  try { body = raw && raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch (_error) { return sendJson(res, 400, { ok: false, reason: 'bad-json' }); }
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false });
  if (url.pathname === '/api/unlock') {
    try { unlock(String(body.passphrase || '')); audit('admin key unlocked'); return sendJson(res, 200, { ok: true }); } catch (_error) { audit('admin key: wrong passphrase'); return sendJson(res, 403, { ok: false, reason: 'wrong-passphrase' }); }
  }
  /* The admin confirms the operator id the operator gave them; it has to be
     one a directory on offer is signed by. */
  if (url.pathname === '/api/trust') {
    const wanted = String(body.operatorId || '').trim().toLowerCase();
    const offer = (await directoriesOnOffer(configDir())).find(({ doc }) => doc.body.operator.id === wanted);
    if (!/^[a-f0-9]{64}$/.test(wanted) || !offer) return sendJson(res, 400, { ok: false, reason: 'no-such-operator' });
    if (readJsonFile(trustFile)?.operatorId && readJsonFile(trustFile).operatorId !== wanted) return sendJson(res, 409, { ok: false, reason: 'another-operator-pinned' });
    pinOperator(offer.doc.body);
    familyCache = { at: 0, body: null };
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/api/password') {
    const server = servers.find((candidate) => candidate.name === body.server);
    if (!server) return sendJson(res, 404, { ok: false });
    server.password = String(body.password || '');
    audit(`${server.name} password entered for this session`);
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/api/lock') {
    const server = servers.find((candidate) => candidate.name === body.server);
    if (!server) return sendJson(res, 404, { ok: false });
    return sendJson(res, 200, await setLock(server, body.on === true));
  }
  const fleet = /^\/api\/fleet\/([a-z-]+)$/.exec(url.pathname);
  if (fleet && FLEET[fleet[1]]) return sendJson(res, 200, await runFleet(fleet[1], body.body || {}));
  return sendJson(res, 404, { ok: false });
}

const asset = (name) => { const file = path.join(HERE, name); return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; };
const PAGE_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

async function main(argv) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  auditFile = path.join(dir, LOG_FILE);
  trustFile = path.join(dir, TRUST_FILE);
  servers = loadServers(dir);
  if (!servers.length) throw new Error('deploy.conf names no server');
  await prepareAdminKey(dir);
  for (const server of servers) {
    if (server.direct) server.base = server.direct; else await openTunnel(server);
  }
  /* A moment for the tunnels, then what each server is and its password. */
  if (servers.some((server) => server.ssh)) await new Promise((resolve) => setTimeout(resolve, 2500));
  for (const server of servers) {
    server.password = readPassword(server);
    const identity = await serverRequest(server, '/relay-identity', { auth: false });
    const said = String(identity.json?.id || '');
    server.relayId = said && relayIdFor(String(identity.json?.publicKey || '')) === said ? said : '';
    server.proxy = await freePort();
    proxyFor(server).listen(server.proxy, '127.0.0.1');
  }
  const wanted = Number(flagValue(argv, 'port') || 0);
  const main = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/login') {
      if (req.headers.host !== `127.0.0.1:${panelPort}`) return sendJson(res, 403, { ok: false });
      const token = String(url.searchParams.get('token') || '');
      if (!session.token || !sameSecret(token, session.token)) {
        return sendJson(res, 403, { ok: false, reason: 'spent' });
      }
      session.token = '';
      audit('panel opened');
      res.writeHead(302, { 'Set-Cookie': `panel=${session.secret}; HttpOnly; SameSite=Strict; Path=/`, Location: '/', 'Cache-Control': 'no-store' });
      return res.end();
    }
    const refusal = allowed(req, panelPort);
    if (refusal) return sendJson(res, refusal, { ok: false, reason: refusal === 401 ? 'login' : 'forbidden' });
    if (url.pathname.startsWith('/api/')) return api(req, res, url);
    if (url.pathname === '/panel.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(asset('control-panel.js'));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': PAGE_POLICY, 'X-Content-Type-Options': 'nosniff' });
    return res.end(asset('control-panel.html'));
  });
  await new Promise((resolve) => main.listen(wanted, '127.0.0.1', resolve));
  panelPort = main.address().port;
  const link = `http://127.0.0.1:${panelPort}/login?token=${session.token}`;
  say(`panel: ${link}`);
  for (const server of servers) say(`proxy ${server.name}: http://127.0.0.1:${server.proxy}/Monitor_Server`);
  if (!argv.includes('--no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [link], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  }
  const stop = () => {
    for (const server of servers) { server.closing = true; server.tunnel?.kill('SIGTERM'); }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
