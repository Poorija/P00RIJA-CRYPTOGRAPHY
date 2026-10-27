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
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { configDir } from './relay-directory.mjs';
import { makeAdminKey, sealAdminKey, openAdminKey } from './admin-key.mjs';
import {
  loadServers, serverRequest, connect, disconnect, freePort, makeAudit, createFamily, describe, setLock,
  sendJson, readBody, cookieOf,
} from './panel/core.mjs';

const require = createRequire(import.meta.url);
const signatures = require('../scripts/lib/operator-signature.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const ADMIN_FILE = 'admin-key.json';
const LOG_FILE = 'control-panel.log';
const TRUST_FILE = 'control-panel-trust.json';
const IDLE_MS = Math.max(1000, Number(process.env.POORIJA_PANEL_IDLE_MS || 15 * 60 * 1000));

const say = (line) => process.stdout.write(`${line}\n`);
const flagValue = (argv, name) => { const at = argv.indexOf(`--${name}`); return at >= 0 ? argv[at + 1] : undefined; };

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

/* ---- whom a signature is for, and the audit log ---------------------------
   (tools/panel/core.mjs) */

let audit = () => {};
let family = null;
const signableRelayId = (server) => family.signableRelayId(server);

/* ---- who may use the panel ------------------------------------------------ */

const session = { token: crypto.randomBytes(24).toString('hex'), secret: crypto.randomBytes(32).toString('hex') };
const sameSecret = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
/* Only this computer's browser, on these exact addresses: the cookie, the
   Host (a name pointed at 127.0.0.1 by another site does not pass), and no
   Origin but our own. */
function allowed(req, port) {
  if (req.headers.host !== `127.0.0.1:${port}`) return 403;
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}`) return 403;
  const cookie = cookieOf(req, 'panel');
  if (!cookie || !sameSecret(cookie, session.secret)) return 401;
  return 0;
}

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

/* ---- the fleet ------------------------------------------------------------ */

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

/* ---- the page and its API ------------------------------------------------- */

let servers = [];
let panelPort = 0;

async function api(req, res, url) {
  if (url.pathname === '/api/servers' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      unlocked: isUnlocked(),
      admin: { name: admin.file?.name, id: admin.file?.id },
      operator: await family.operatorState(),
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
  if (url.pathname === '/api/trust') {
    const { status, reason } = await family.trust(body.operatorId);
    return sendJson(res, status, status === 200 ? { ok: true } : { ok: false, reason });
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
    return sendJson(res, 200, setLock(server, body.on === true, audit));
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
  audit = makeAudit(path.join(dir, LOG_FILE));
  servers = loadServers(dir);
  if (!servers.length) throw new Error('deploy.conf names no server');
  family = createFamily({ dir, trustFile: path.join(dir, TRUST_FILE), audit, servers: () => servers });
  await prepareAdminKey(dir);
  await connect(servers);
  for (const server of servers) {
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
    disconnect(servers);
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
