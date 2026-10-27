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

/* The central panel as a web app (docs/CONTROL-PANEL.md).
 *
 * The same servers, tunnels and family trust as the command-line panel
 * (tools/panel/core.mjs), behind a login: a name, a password and a code from
 * an authenticator app (tools/panel/login.mjs, made with
 * tools/panel/setup-login.mjs). Five failed logins lock the address for a
 * while; a session ends after it has been idle.
 *
 * The panel holds no signing key. Each browser makes its own with WebCrypto
 * (tools/panel/web/sign.js) and signs the dangerous actions itself; the panel
 * only passes the signature on, so a locked relay takes the action only if
 * the operator listed that browser's key. What a panel host that was broken
 * into can still do is ask an open page for signatures; that is why the
 * panel runs on the admin's own computer by default.
 *
 *   node tools/panel/server.mjs                  # http://127.0.0.1:8686/
 *
 * Settings, all optional: POORIJA_PANEL_HOST, POORIJA_PANEL_PORT,
 * POORIJA_PANEL_ORIGINS (the addresses browsers reach it at, comma
 * separated), POORIJA_PANEL_TLS_CERT and POORIJA_PANEL_TLS_KEY (serve HTTPS),
 * POORIJA_PANEL_STATE_DIR (where the login, trust, layout and audit log are
 * written; deploy.conf and the operator's files stay in POORIJA_CONFIG_DIR),
 * POORIJA_PANEL_SESSION_IDLE_MS, POORIJA_PANEL_LOCK_MS, POORIJA_PANEL_TRUSTED_PROXY
 * (the address of a reverse proxy in front of it, whose X-Forwarded-For is
 * then believed for who is logging in).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { configDir, loadState, editRelay, applyEdit, serverEntry, initKey, signDraft, saveDraft, saveSigned, parseDeployConf } from '../relay-directory.mjs';
import { buildGraph } from './web/graphdata.js';
import {
  loadServers, serverRequest, connect, disconnect, reconnect, makeAudit, createFamily, describe, setLock,
  sshArgs, onServerAsync, resolveKeyPath, sshFailure, SSH_FAILURES,
  sendJson, readBody, cookieOf, readJsonFile,
} from './core.mjs';
import { checkPassword, checkCode, otpauthUri } from './login.mjs';
import { stepUp, changePassword, beginTotp, confirmTotp, history } from './account.mjs';
import { qrSvg } from './qr.mjs';
import { readServers, setServer, removeServer, setField, writeConf, validName, SERVER_KEYS } from './deployconf.mjs';
import { clusterView, planClusterChange, rotateOperator } from './family.mjs';
import { startJob, startTask, jobView } from './jobs.mjs';

const require = createRequire(import.meta.url);
const signatures = require('../../scripts/lib/operator-signature.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const LOGIN_FILE = 'control-panel-login.json';
const LOG_FILE = 'control-panel.log';
const TRUST_FILE = 'control-panel-trust.json';
const SESSION_IDLE_MS = Math.max(1000, Number(env.POORIJA_PANEL_SESSION_IDLE_MS || 30 * 60 * 1000));
const LOCK_MS = Math.max(1000, Number(env.POORIJA_PANEL_LOCK_MS || 15 * 60 * 1000));
const MAX_FAILURES = 5;
const MAX_SESSIONS = 32;
const COOKIE = 'panel_session';
const LOCK_PATH = '/control-panel/lock';
const DIRECTORY_PATH = '/control-panel/directory';
const LAYOUT_FILE = 'control-panel-layout.json';
const SESSIONS_FILE = 'control-panel-sessions.json';

const say = (line) => process.stdout.write(`${line}\n`);

/* ---- state ---------------------------------------------------------------- */

let servers = [];
let family = null;
let audit = () => {};
let loginFile = '';
let layoutFile = '';
let sessionsFile = '';
let auditFile = '';
let configPath = '';
let allowedOrigins = new Set();
let allowedHosts = new Set();
let secureCookie = false;
const sessions = new Map();
const failures = new Map();
const lockNonces = new Map();
const directoryNonces = new Map();

setInterval(() => {
  const now = Date.now();
  let dropped = false;
  for (const [key, entry] of sessions) if (now - entry.lastSeen > SESSION_IDLE_MS) { sessions.delete(key); dropped = true; }
  if (dropped) saveSessions();
  for (const [address, entry] of failures) if (entry.until && entry.until <= now) failures.delete(address);
  for (const [nonce, until] of lockNonces) if (until <= now) lockNonces.delete(nonce);
  for (const [nonce, until] of directoryNonces) if (until <= now) directoryNonces.delete(nonce);
}, 60000).unref();

/* The time the authenticator codes are checked against. A suite can move it
   forward (POORIJA_PANEL_CLOCK_FILE, milliseconds to add) so one single-use
   code can follow another without waiting half a minute; unset, it is the
   clock. */
function now() {
  if (!env.POORIJA_PANEL_CLOCK_FILE) return Date.now();
  try { return Date.now() + (Number(fs.readFileSync(env.POORIJA_PANEL_CLOCK_FILE, 'utf8')) || 0); } catch (_error) { return Date.now(); }
}

/* Sessions outlive a restart: kept in the state folder by the hash of their
   token (the token itself only ever in the browser's cookie), with the same
   idle timeout. */
const tokenKey = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
let sessionsSavedAt = 0;
function saveSessions() {
  if (!sessionsFile) return;
  sessionsSavedAt = Date.now();
  try {
    const temp = `${sessionsFile}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
    fs.renameSync(temp, sessionsFile);
  } catch (_error) { /* the session still works until a restart */ }
}
function loadSessions() {
  const saved = readJsonFile(sessionsFile) || {};
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [key, entry] of Object.entries(saved)) {
    if (/^[a-f0-9]{64}$/.test(key) && entry && entry.lastSeen > cutoff && typeof entry.user === 'string') sessions.set(key, { user: entry.user, since: Number(entry.since) || entry.lastSeen, lastSeen: entry.lastSeen });
  }
}

/* ---- who may use it ------------------------------------------------------- */

/* Only these addresses: a name pointed at the panel by another site (DNS
   rebinding) does not pass the Host check, and no Origin but its own does. */
function placeAllowed(req) {
  if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) return false;
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(String(origin).toLowerCase());
}

/* The session behind a request, or null. The page's own polling (marked
   X-Panel-Poll) does not count as someone using it, so a page left open
   still ends its session. */
function sessionOf(req) {
  const token = cookieOf(req, COOKIE);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const key = tokenKey(token);
  const entry = sessions.get(key);
  if (!entry) return null;
  const at = Date.now();
  if (at - entry.lastSeen > SESSION_IDLE_MS) { sessions.delete(key); saveSessions(); return null; }
  if (req.headers['x-panel-poll'] !== '1') {
    entry.lastSeen = at;
    if (at - sessionsSavedAt > 60000) saveSessions();
  }
  return { key, ...entry };
}

function writeLogin(record) {
  const temp = `${loginFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, loginFile);
}

/* Where a login comes from. Behind a reverse proxy (POORIJA_PANEL_TRUSTED_PROXY,
   its address) every connection is the proxy's, so the address it names last
   in X-Forwarded-For is taken instead; from anyone else that header is
   ignored, since anyone can write it. */
const TRUSTED_PROXY = String(env.POORIJA_PANEL_TRUSTED_PROXY || '').trim();
const bare = (address) => String(address || '').replace(/^::ffff:/, '');
function clientAddress(req) {
  const socket = bare(req.socket.remoteAddress);
  if (!TRUSTED_PROXY || socket !== TRUSTED_PROXY) return socket;
  const named = String(req.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean).pop();
  return named && /^[0-9a-fA-F.:]{2,45}$/.test(named) ? bare(named) : socket;
}

/* A failed sign-in or a wrong step-up code: five lock the address. */
function strike(address, what = 'login failed') {
  const at = Date.now();
  const strikes = failures.get(address);
  const count = (strikes && !strikes.until ? strikes.count : 0) + 1;
  failures.set(address, { count, until: count >= MAX_FAILURES ? at + LOCK_MS : 0 });
  audit(`${what} from ${address}${count >= MAX_FAILURES ? ', address locked' : ''}`);
}

/* Every change to the panel itself, its servers, the family list or the
   operator key asks for a current code. A wrong one counts against the
   address like a failed sign-in; one already used is refused as used. */
function confirmCode(req, res, code) {
  const address = clientAddress(req);
  if (lockedOut(req, res)) return false;
  const record = readJsonFile(loginFile);
  const verdict = stepUp(record, code, now());
  if (!verdict.ok) {
    if (verdict.reason === 'bad-code') strike(address, 'step-up code wrong');
    sendJson(res, 403, { ok: false, reason: verdict.reason });
    return false;
  }
  writeLogin({ ...readJsonFile(loginFile), lastStep: verdict.step });
  return true;
}

/* ---- servers in deploy.conf ------------------------------------------------ */

const testsBy = new Map();
const configWritable = () => { try { fs.accessSync(configPath, fs.constants.W_OK); return true; } catch (_error) { return false; } };
const confText = () => { try { return fs.readFileSync(path.join(configPath, 'deploy.conf'), 'utf8'); } catch (_error) { return ''; } };

/* What a server's settings must look like before they are written or tried. */
function cleanFields(raw) {
  const fields = {};
  for (const key of SERVER_KEYS) {
    if (raw?.[key] === undefined || raw[key] === null || String(raw[key]).trim() === '') continue;
    const value = String(raw[key]).trim();
    if (value.length > 400 || /['\n\r\0]/.test(value)) throw new Error(`bad ${key}`);
    fields[key] = value;
  }
  /* deploy.sh sources deploy.conf as shell and puts some values into a
     command a shell runs (a jump's ProxyCommand), so every value is held to
     the characters it needs and nothing a shell would act on. */
  const allowed = {
    SSH_HOST: /^[A-Za-z0-9.:-]{1,253}$/,
    SSH_PORT: /^\d{1,5}$/,
    SSH_USER: /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/,
    SSH_KEY: /^[A-Za-z0-9._~\/-]{1,300}$/,
    REMOTE_DIR: /^[A-Za-z0-9._~\/-]{1,300}$/,
    PUBLIC_URL: /^https?:\/\/[A-Za-z0-9.:-]+(\/[A-Za-z0-9._~\/-]*)?$/,
    REGION: /^[a-z][a-z-]{0,39}$/,
    GATEWAY: /^\d{1,2}$/,
    CLUSTER: /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u,
    ROLE: /^[a-z][a-z-]{0,19}$/,
  };
  for (const [key, pattern] of Object.entries(allowed)) if (fields[key] !== undefined && !pattern.test(fields[key])) throw new Error(`bad ${key}`);
  if (fields.SSH_HOST === undefined) throw new Error('bad SSH_HOST');
  if (fields.JUMP && !validName(fields.JUMP)) throw new Error('bad JUMP');
  if (fields.INSIDE !== undefined) {
    const inside = fields.INSIDE.split(/[,\s]+/).filter(Boolean);
    if (!inside.length || inside.length > 4 || !inside.every((origin) => /^https?:\/\/[A-Za-z0-9.\-[\]:]{1,200}$/.test(origin))) throw new Error('bad INSIDE');
    fields.INSIDE = inside.join(',');
  }
  return fields;
}

/* An ssh target from settings not yet saved, the way loadServers reads them. */
function sshFromFields(fields) {
  const conf = parseDeployConf(confText());
  const ssh = {
    host: fields.SSH_HOST, user: fields.SSH_USER || os.userInfo().username, port: fields.SSH_PORT || '22',
    key: fields.SSH_KEY ? resolveKeyPath(fields.SSH_KEY) : '', dir: fields.REMOTE_DIR || '~/work/pkg',
  };
  if (fields.JUMP && conf.servers.includes(fields.JUMP)) {
    const key = conf.fields(fields.JUMP, 'SSH_KEY');
    ssh.jump = { host: conf.fields(fields.JUMP, 'SSH_HOST'), user: conf.fields(fields.JUMP, 'SSH_USER') || ssh.user, port: conf.fields(fields.JUMP, 'SSH_PORT') || '22', key: key ? resolveKeyPath(key) : '' };
  }
  return ssh;
}

function sshKeysHere() {
  const dir = path.join(os.homedir(), '.ssh');
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.endsWith('.pub') && !/^(known_hosts|config|authorized_keys|environment)/.test(entry.name) && !entry.name.endsWith('.old'))
      .map((entry) => entry.name).sort();
  } catch (_error) { return []; }
}

/* One login: is Docker there, is the stack, which version. */
const PROBE = `printf 'docker=%s\\n' "$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
printf 'installed=%s\\n' "$(docker ps --format '{{.Names}}' 2>/dev/null | grep -c '^Poorija-Cryptography_ChatSignal$')"
printf 'version=%s\\n' "$(curl -sk --max-time 5 https://127.0.0.1:8585/ 2>/dev/null | grep -o '?v=[0-9][^\"&]*' | head -1 | cut -c4-)"
`;
const shellArg = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

async function serversRoute(req, res, url, body, who) {
  if (url.pathname === '/api/servers/test') {
    /* Each test is a login somewhere: a few a minute per session. */
    const recent = (testsBy.get(who.key) || []).filter((at) => Date.now() - at < 60000);
    if (recent.length >= 10) return sendJson(res, 429, { ok: false, reason: 'too-many-tests' });
    testsBy.set(who.key, [...recent, Date.now()]);
    let fields;
    try { fields = cleanFields(body.fields); } catch (error) { return sendJson(res, 400, { ok: false, reason: error.message }); }
    const ssh = sshFromFields(fields);
    /* Only a key from the SSH folder the panel was given, never another file. */
    const keys = path.join(os.homedir(), '.ssh');
    if (ssh.key && !path.resolve(ssh.key).startsWith(`${keys}${path.sep}`)) return sendJson(res, 400, { ok: false, reason: 'key-outside-ssh-folder' });
    if (ssh.key && !fs.existsSync(ssh.key)) return sendJson(res, 200, { ok: false, problem: 'key-missing', detail: `no key ${path.basename(ssh.key)} in the SSH folder` });
    const run = await onServerAsync(ssh, PROBE, 30000);
    audit(`${who.user} tested ${fields.SSH_USER || ''}@${fields.SSH_HOST}: ${run.ok ? 'answered' : 'no answer'}`);
    if (!run.ok) return sendJson(res, 200, { ok: false, problem: sshFailure(run.err) || 'unreachable', detail: String(run.err).trim().split('\n').pop()?.slice(0, 200) || '' });
    const seen = Object.fromEntries(run.out.split('\n').map((line) => /^(\w+)=(.*)$/.exec(line.trim())).filter(Boolean).map((match) => [match[1], match[2]]));
    return sendJson(res, 200, { ok: true, docker: seen.docker || '', installed: seen.installed === '1', version: seen.version || '' });
  }
  if (url.pathname === '/api/servers/save') {
    const name = String(body.name || '');
    let fields;
    try {
      if (!validName(name)) throw new Error('bad name');
      fields = cleanFields(body.fields);
    } catch (error) { return sendJson(res, 400, { ok: false, reason: error.message }); }
    if (!configWritable()) return sendJson(res, 409, { ok: false, reason: 'read-only' });
    if (!confirmCode(req, res, body.code)) return undefined;
    try { writeConf(configPath, setServer(confText(), name, fields)); } catch (error) { return sendJson(res, 400, { ok: false, reason: error.message }); }
    audit(`${who.user} saved server ${name} in deploy.conf`);
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/api/servers/remove') {
    const name = String(body.name || '');
    if (!readServers(confText()).some((server) => server.name === name)) return sendJson(res, 404, { ok: false, reason: 'no-such-server' });
    if (!configWritable()) return sendJson(res, 409, { ok: false, reason: 'read-only' });
    if (!confirmCode(req, res, body.code)) return undefined;
    writeConf(configPath, removeServer(confText(), name));
    audit(`${who.user} removed server ${name} from deploy.conf`);
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/api/servers/install') {
    const server = servers.find((candidate) => candidate.name === body.name);
    if (!server?.ssh) return sendJson(res, 404, { ok: false, reason: 'no-such-server' });
    const domain = String(body.domain || '');
    const email = String(body.email || '');
    const registry = String(body.registry || '');
    if (!/^[A-Za-z0-9.-]{1,253}$/.test(domain) || (email && !/^[^\s'"\\]+@[^\s'"\\]+$/.test(email)) || (registry && !/^[A-Za-z0-9.:/-]{1,200}$/.test(registry))) {
      return sendJson(res, 400, { ok: false, reason: 'bad-options' });
    }
    if (SSH_FAILURES.has(server.sshState)) return sendJson(res, 409, { ok: false, reason: server.sshState });
    if (!confirmCode(req, res, body.code)) return undefined;
    /* The panel's own copies of the installer and its compose file go with it,
       so a server installs the release the panel is. */
    const installer = fs.readFileSync(path.join(HERE, '..', '..', 'scripts', 'docker-install.sh')).toString('base64');
    const compose = fs.readFileSync(path.join(HERE, '..', '..', 'docker', 'compose.yaml')).toString('base64');
    const options = [`--domain ${shellArg(domain)}`, ...(email ? [`--email ${shellArg(email)}`] : []), ...(registry ? [`--registry ${shellArg(registry)}`] : [])].join(' ');
    const script = `set -e
mkdir -p ~/p00rija-installer/scripts ~/p00rija-installer/docker
printf '%s' '${installer}' | base64 -d > ~/p00rija-installer/scripts/docker-install.sh
printf '%s' '${compose}' | base64 -d > ~/p00rija-installer/docker/compose.yaml
bash ~/p00rija-installer/scripts/docker-install.sh --yes ${options} < /dev/null
`;
    const name = server.name;
    const job = startJob(`install on ${name}`, ['ssh', ...sshArgs(server.ssh), 'bash -s'], {
      input: script,
      onDone: (done) => audit(`install on ${name} finished (exit ${done.code})`),
    });
    audit(`${who.user} install on ${name} started (${domain})`);
    return sendJson(res, 200, { ok: true, job });
  }
  return sendJson(res, 404, { ok: false });
}

/* ---- the account ----------------------------------------------------------- */

function signOutOthers(who) {
  let count = 0;
  for (const key of [...sessions.keys()]) if (key !== who.key) { sessions.delete(key); count += 1; }
  saveSessions();
  return count;
}

/* A locked address is answered the same whatever it sends, before any
   password or code is looked at: otherwise the answers would still tell a
   right password from a wrong one while it is locked. */
function lockedOut(req, res) {
  const strikes = failures.get(clientAddress(req));
  if (!(strikes?.until > Date.now())) return false;
  sendJson(res, 429, { ok: false, reason: 'locked', retryAfter: Math.ceil((strikes.until - Date.now()) / 1000) });
  return true;
}

async function account(req, res, url, body, who) {
  if (lockedOut(req, res)) return undefined;
  if (url.pathname === '/api/account/password') {
    if (!confirmCode(req, res, body.code)) return undefined;
    let record;
    try { record = changePassword(readJsonFile(loginFile), { current: body.current, next: body.next }); } catch (error) {
      if (error.message === 'bad-password') strike(clientAddress(req), 'password change with a wrong password');
      return sendJson(res, error.message === 'bad-password' ? 403 : 400, { ok: false, reason: error.message });
    }
    writeLogin(record);
    const count = signOutOthers(who);
    audit(`${who.user} password changed; signed out ${count} other session(s)`);
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/api/account/totp/begin') {
    if (!checkPassword(readJsonFile(loginFile), who.user, body.password)) {
      strike(clientAddress(req), 'authenticator change with a wrong password');
      return sendJson(res, 403, { ok: false, reason: 'bad-password' });
    }
    if (!confirmCode(req, res, body.code)) return undefined;
    const { record, secret } = beginTotp(readJsonFile(loginFile));
    writeLogin(record);
    const uri = otpauthUri({ ...record, totp: secret });
    audit(`${who.user} began a new authenticator`);
    return sendJson(res, 200, { ok: true, secret, uri, svg: qrSvg(uri) });
  }
  if (url.pathname === '/api/account/totp/confirm') {
    let record;
    try { record = confirmTotp(readJsonFile(loginFile), body.code, now()); } catch (error) {
      return sendJson(res, 400, { ok: false, reason: error.message });
    }
    writeLogin(record);
    audit(`${who.user} authenticator replaced`);
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/api/account/sessions/revoke') {
    if (!confirmCode(req, res, body.code)) return undefined;
    const count = signOutOthers(who);
    audit(`${who.user} signed out ${count} other session(s)`);
    return sendJson(res, 200, { ok: true, count });
  }
  return sendJson(res, 404, { ok: false });
}

async function login(req, res, body) {
  const address = clientAddress(req);
  const at = Date.now();
  const strikes = failures.get(address);
  if (strikes?.until > at) return sendJson(res, 429, { ok: false, reason: 'locked', retryAfter: Math.ceil((strikes.until - at) / 1000) });
  const record = readJsonFile(loginFile);
  const passwordOk = checkPassword(record, body.username, body.password);
  const step = passwordOk ? checkCode(record.totp, body.code, { now: now(), lastStep: Number(record.lastStep) || 0 }) : -1;
  if (step < 0) {
    strike(address);
    return sendJson(res, 401, { ok: false, reason: 'login-failed' });
  }
  failures.delete(address);
  writeLogin({ ...record, lastStep: step });
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(tokenKey(token), { user: record.username, lastSeen: at, since: at });
  saveSessions();
  audit(`login ${record.username} ok from ${address}`);
  res.writeHead(200, {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${secureCookie ? '; Secure' : ''}`,
  });
  return res.end(JSON.stringify({ ok: true, user: record.username }));
}

/* ---- calling a server's dashboard ----------------------------------------- */

const OPEN_PATHS = new Set(['/healthz', '/chat-health', '/relay-identity', '/relay-directory', '/relay-gateways', '/transit-peers']);
/* A path on a server's dashboard, and nothing else: no scheme or host, no
   dot segments, only the dashboard's own routes. */
function callablePath(route) {
  if (typeof route !== 'string' || route.length > 1024 || !route.startsWith('/') || route.startsWith('//')) return '';
  const [pathname, query = ''] = route.split(/\?(.*)/s);
  if (!/^[A-Za-z0-9_\-/.]+$/.test(pathname) || pathname.split('/').some((part) => part === '.' || part === '..')) return '';
  if (query && !/^[A-Za-z0-9_\-.=&%+]*$/.test(query)) return '';
  const lower = pathname.toLowerCase();
  const ok = lower === '/monitor_server' || lower.startsWith('/monitor_server/') || lower.startsWith('/admin/') || OPEN_PATHS.has(lower);
  return ok ? pathname : '';
}
const SIGNATURE_SHAPE = /^v1\.[a-f0-9]{64}\.\d{10,16}\.[a-f0-9]{32}\.[A-Za-z0-9+/]+=*$/;

async function call(req, res, body, who) {
  const server = servers.find((candidate) => candidate.name === body.server);
  if (!server) return sendJson(res, 404, { ok: false, reason: 'no-such-server' });
  const method = String(body.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') return sendJson(res, 400, { ok: false, reason: 'method' });
  const pathname = callablePath(body.path);
  if (!pathname) return sendJson(res, 400, { ok: false, reason: 'path' });
  const signature = body.signature === undefined || body.signature === null || body.signature === '' ? '' : String(body.signature);
  if (signature && !SIGNATURE_SHAPE.test(signature)) return sendJson(res, 400, { ok: false, reason: 'signature' });
  const answer = await serverRequest(server, body.path, {
    method,
    body: method === 'POST' ? (body.body ?? {}) : undefined,
    headers: signature ? { 'X-Operator-Signature': signature } : {},
    /* Backups, updates and restarts take minutes, not seconds. */
    timeout: /^\/monitor_server\/ops-/i.test(pathname) ? 10 * 60 * 1000 : 30000,
  });
  if (method !== 'GET') audit(`${who.user} ${server.name} ${method} ${pathname} ${signature ? 'signed' : 'unsigned'} ${answer.status}`);
  return sendJson(res, 200, {
    ok: answer.status >= 200 && answer.status < 300,
    status: answer.status,
    answer: answer.json ?? { text: String(answer.text || '').slice(0, 4000) },
  });
}

/* A file from a server's dashboard (a backup, the image, the install
   bundle), passed through to the browser as it comes. */
const DOWNLOADS = new Set(['/monitor_server/ops-backup-download', '/monitor_server/ops-image-export', '/monitor_server/ops-bundle']);
async function download(req, res, body, who) {
  const server = servers.find((candidate) => candidate.name === body.server);
  if (!server) return sendJson(res, 404, { ok: false, reason: 'no-such-server' });
  const pathname = callablePath(body.path);
  if (!pathname || !DOWNLOADS.has(pathname.toLowerCase())) return sendJson(res, 400, { ok: false, reason: 'path' });
  const signature = body.signature ? String(body.signature) : '';
  if (signature && !SIGNATURE_SHAPE.test(signature)) return sendJson(res, 400, { ok: false, reason: 'signature' });
  const answer = await serverRequest(server, pathname, {
    method: 'POST', body: body.body ?? {}, raw: true, timeout: 30 * 60 * 1000,
    headers: signature ? { 'X-Operator-Signature': signature } : {},
  });
  audit(`${who.user} ${server.name} POST ${pathname} ${signature ? 'signed' : 'unsigned'} ${answer.status} (download)`);
  if (!answer.response) return sendJson(res, 502, { ok: false, reason: 'unreachable' });
  const type = String(answer.response.headers['content-type'] || '');
  if (answer.status !== 200 || /application\/json/i.test(type)) {
    const chunks = [];
    for await (const chunk of answer.response) chunks.push(chunk);
    let reason = `http-${answer.status}`;
    try { reason = JSON.parse(Buffer.concat(chunks).toString('utf8')).reason || reason; } catch (_error) { /* not JSON */ }
    return sendJson(res, answer.status === 200 ? 502 : answer.status, { ok: false, reason });
  }
  const name = String(body.body?.name || pathname.split('/').pop()).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'download';
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${name}"`,
    ...(answer.response.headers['content-length'] ? { 'Content-Length': answer.response.headers['content-length'] } : {}),
  });
  return answer.response.pipe(res);
}

/* A server's lock goes on and off over SSH, which no relay checks a
   signature for; so the panel checks one itself, from a key the family's
   directory lists, for that server's relay. */
async function lock(req, res, body, who) {
  const server = servers.find((candidate) => candidate.name === body.server);
  if (!server) return sendJson(res, 404, { ok: false, reason: 'no-such-server' });
  const on = body.on === true;
  if (!body.signature) return sendJson(res, 403, { ok: false, reason: 'signature-needed' });
  const directory = await family.directory();
  const { id: relay, reason } = await family.signableRelayId(server);
  if (!directory || !relay) return sendJson(res, 409, { ok: false, reason });
  const verdict = signatures.verifyRequest(String(body.signature), {
    method: 'POST', path: LOCK_PATH, body: { server: server.name, on }, relay,
    keys: signatures.signingKeys(directory, directory.operator?.key),
    nonceSeen: (nonce) => (lockNonces.get(nonce) || 0) > Date.now(),
  });
  if (!verdict.ok) {
    audit(`${who.user} ${server.name} lock ${on ? 'on' : 'off'} refused: ${verdict.reason}`);
    return sendJson(res, 403, { ok: false, reason: 'bad-signature', detail: verdict.reason });
  }
  lockNonces.set(verdict.nonce, Date.now() + 10 * 60 * 1000);
  audit(`${who.user} ${server.name} lock ${on ? 'on' : 'off'} signed by ${verdict.name}`);
  return sendJson(res, 200, setLock(server, on, audit));
}

/* ---- the network graph ---------------------------------------------------- */

async function graphData() {
  const directory = await family.directory();
  const placed = (name) => directory?.relays?.find((relay) => relay.name === name) || {};
  const answers = await Promise.all(servers.map(async (server) => {
    const [health, transit, partners] = await Promise.all([
      serverRequest(server, '/chat-health', { auth: false }),
      serverRequest(server, '/Monitor_Server/transit', { method: 'POST', body: {} }),
      serverRequest(server, '/Monitor_Server/partners', { method: 'POST', body: {} }),
    ]);
    return { server, health, transit, partners };
  }));
  const rows = answers.map(({ server, health }) => {
    const entry = placed(server.name);
    return {
      name: server.name, relayId: server.relayId || '', cluster: String(entry.cluster || ''), region: String(entry.region || ''), gateway: Number(entry.gateway) || 0,
      inside: Array.isArray(entry.inside) ? entry.inside.map(String) : [], locked: health.json?.locked === true, reachable: health.status === 200,
    };
  });
  const graph = buildGraph({
    servers: rows,
    transit: Object.fromEntries(answers.filter((answer) => answer.transit.json?.ok).map((answer) => [answer.server.name, answer.transit.json])),
    partners: Object.fromEntries(answers.filter((answer) => answer.partners.json?.ok).map((answer) => [answer.server.name, answer.partners.json])),
  });
  return { ok: true, ...graph, layout: readJsonFile(layoutFile) || {}, editable: operatorFiles().canEdit };
}

/* Where the admin dragged the nodes: on this computer only, never on a server. */
const NODE_KEY = /^(relay|partner):[a-f0-9]{16}$/;
function saveLayout(body) {
  const positions = body?.positions;
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) return { status: 400, reason: 'bad-layout' };
  const entries = Object.entries(positions);
  if (entries.length > 500) return { status: 400, reason: 'bad-layout' };
  const finite = (value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100000;
  /* null forgets a node's place, so it is laid out afresh. */
  if (!entries.every(([key, at]) => NODE_KEY.test(key) && (at === null || (at && finite(at.x) && finite(at.y))))) return { status: 400, reason: 'bad-layout' };
  const layout = { ...(readJsonFile(layoutFile) || {}) };
  for (const [key, at] of entries) {
    if (at === null) delete layout[key]; else layout[key] = { x: Math.round(at.x), y: Math.round(at.y) };
  }
  const temp = `${layoutFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(layout)}\n`, { mode: 0o600 });
  fs.renameSync(temp, layoutFile);
  return { status: 200 };
}

/* ---- the family list, where the operator key is ---------------------------

   Clusters, inside addresses and the directory's gateway places live in the
   family's signed directory, so changing them takes the operator key. Only
   on the computer that holds it (relay-directory.mjs's files beside
   deploy.conf, writable) can the panel change them; elsewhere it shows them.
   A change also needs a signature from a key the directory lists, made in
   the browser, so a stolen session alone cannot re-sign the family. */
function operatorFiles() {
  const state = loadState(configPath);
  let writable = false;
  try { fs.accessSync(configPath, fs.constants.W_OK); writable = true; } catch (_error) { writable = false; }
  const canEdit = Boolean(state.key?.privateKey && state.draft && writable);
  return { state, canEdit, reason: !state.key ? 'no-operator-key' : !state.draft ? 'no-draft' : !writable ? 'read-only' : '' };
}

function directoryView() {
  const { state, canEdit, reason } = operatorFiles();
  return {
    ok: true, canEdit, reason, operatorId: state.key?.id || '', serial: state.signed?.body?.serial || 0,
    relays: (state.draft?.relays || []).map((relay) => ({
      name: String(relay.name || ''), id: String(relay.id || ''), region: String(relay.region || ''), gateway: Number(relay.gateway) || 0,
      cluster: String(relay.cluster || ''), inside: Array.isArray(relay.inside) ? relay.inside.map(String) : [],
    })),
  };
}

/* The signed list, handed to every server; what each said. */
async function publishDirectory(doc) {
  const published = [];
  for (const server of servers) {
    const answer = await serverRequest(server, '/Monitor_Server/directory', { method: 'POST', body: doc });
    published.push({ server: server.name, ok: answer.json?.ok === true || answer.json?.reason === 'stale', reason: answer.json?.reason || (answer.status ? '' : 'unreachable') });
  }
  family.forget();
  return published;
}

/* A cluster or inside address changed in the list is written to deploy.conf
   too, so the next deploy keeps it. */
function clustersToDeployConf(draft, names) {
  if (!configWritable()) return;
  let text = confText();
  const inConf = new Set(readServers(text).map((server) => server.name));
  let changed = false;
  for (const relay of draft.relays || []) {
    if (!names.has(relay.name) || !inConf.has(relay.name)) continue;
    text = setField(text, relay.name, 'CLUSTER', relay.cluster || '');
    text = setField(text, relay.name, 'INSIDE', (relay.inside || []).join(','));
    changed = true;
  }
  if (changed) writeConf(configPath, text);
}

async function editDirectory(res, body, who) {
  const { state, canEdit, reason } = operatorFiles();
  if (!canEdit) return sendJson(res, 409, { ok: false, reason });
  /* What is signed is exactly what is sent: a list of edits, or one cluster
     change the panel turns into edits. */
  const signedBody = body.change !== undefined ? { change: body.change } : { edits: body.edits };
  let edits;
  try {
    edits = body.change !== undefined ? planClusterChange(state.draft, body.change) : body.edits;
  } catch (error) { return sendJson(res, 400, { ok: false, reason: 'bad-edits', detail: error.message }); }
  if (!Array.isArray(edits) || !edits.length || edits.length > 40) return sendJson(res, 400, { ok: false, reason: 'bad-edits' });
  if (!body.signature) return sendJson(res, 403, { ok: false, reason: 'signature-needed' });
  const directory = await family.directory();
  if (!directory || directory.operator?.id !== state.key.id) return sendJson(res, 409, { ok: false, reason: 'operator-unconfirmed' });
  const verdict = signatures.verifyRequest(String(body.signature), {
    method: 'POST', path: DIRECTORY_PATH, body: signedBody, relay: state.key.id,
    keys: signatures.signingKeys(directory, directory.operator.key),
    nonceSeen: (nonce) => (directoryNonces.get(nonce) || 0) > Date.now(),
  });
  if (!verdict.ok) {
    audit(`${who.user} family list change refused: ${verdict.reason}`);
    return sendJson(res, 403, { ok: false, reason: 'bad-signature', detail: verdict.reason });
  }
  directoryNonces.set(verdict.nonce, Date.now() + 10 * 60 * 1000);
  let draft = state.draft;
  const touched = new Set();
  try {
    for (const edit of edits) {
      const name = String(edit?.name || '');
      if (edit?.op === 'cluster' || edit?.op === 'inside' || edit?.op === 'gateway') {
        const changes = edit.op === 'cluster' ? { cluster: String(edit.cluster ?? '') } : edit.op === 'inside' ? { inside: edit.inside } : { gateway: edit.gateway };
        draft = editRelay(draft, name, changes);
        if (edit.op !== 'gateway') touched.add(name);
      } else if (edit?.op === 'remove') {
        const relay = (draft.relays || []).find((entry) => entry.name === name);
        if (!relay) throw new Error(`no relay called ${name}`);
        draft = applyEdit(draft, { op: 'remove', id: relay.id });
      } else if (edit?.op === 'add') {
        const server = servers.find((candidate) => candidate.name === name);
        if (!server?.relayId) throw new Error(`${name} has not shown a verified relay identity`);
        const existing = (draft.relays || []).find((entry) => entry.id === server.relayId || entry.name === name);
        draft = applyEdit(draft, { op: 'add', relay: serverEntry(parseDeployConf(confText()), name, existing, { id: server.relayId, origin: server.publicUrl }) });
        touched.add(name);
      } else if (edit?.op === 'admin-add') {
        draft = applyEdit(draft, { op: 'admin-add', admin: { name: String(edit.name || ''), key: String(edit.key || '') } });
      } else if (edit?.op === 'admin-remove') {
        draft = applyEdit(draft, { op: 'admin-remove', name });
      } else {
        throw new Error(`unknown change ${String(edit?.op).slice(0, 20)}`);
      }
    }
  } catch (error) {
    return sendJson(res, 400, { ok: false, reason: 'bad-edits', detail: error.message });
  }
  saveDraft(configPath, draft);
  const doc = signDraft(loadState(configPath));
  saveSigned(configPath, doc);
  clustersToDeployConf(draft, touched);
  const published = await publishDirectory(doc);
  audit(`${who.user} family list ${doc.body.serial} signed (${edits.map((edit) => `${edit.op} ${String(edit.name || '').slice(0, 30)}`).join(', ')}) by ${verdict.name}; ${published.filter((entry) => entry.ok).length}/${published.length} servers took it`);
  return sendJson(res, 200, { ok: true, serial: doc.body.serial, published });
}

/* ---- the family list and the operator key, as the page shows them ---------- */

async function familyView() {
  const { state, canEdit, reason } = operatorFiles();
  const draft = state.draft || { relays: [], admins: [] };
  const carried = await Promise.all(servers.map(async (server) => {
    const answer = await serverRequest(server, '/relay-directory', { auth: false, timeout: 8000 });
    return { server: server.name, serial: Number(answer.json?.body?.serial) || 0 };
  }));
  return {
    ok: true, canEdit, reason,
    operator: { present: Boolean(state.key?.privateKey), id: state.key?.id || '', name: String(state.key?.name || '') },
    serial: state.signed?.body?.serial || 0,
    signedAt: state.signed?.body?.issuedAt || '',
    relays: (draft.relays || []).map((relay) => ({
      name: String(relay.name || ''), id: String(relay.id || ''), origins: (relay.origins || []).map(String), region: String(relay.region || ''),
      gateway: Number(relay.gateway) || 0, cluster: String(relay.cluster || ''), inside: (relay.inside || []).map(String),
    })),
    admins: (draft.admins || []).map((admin) => ({ name: String(admin.name || ''), id: String(admin.id || '') })),
    clusters: clusterView(draft),
    carried,
  };
}

const stampNow = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const writePrivateJson = (file, value) => {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
};

/* The keys of an operator key file belong together: the private key makes
   the public one, and the id is its hash. */
function checkKeyFile(file) {
  const publicKey = String(file?.publicKey || '');
  const derived = crypto.createPublicKey(crypto.createPrivateKey(String(file?.privateKey || ''))).export({ type: 'spki', format: 'der' }).toString('base64');
  if (derived !== publicKey) throw new Error('the private key does not make that public key');
  if (crypto.createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex') !== file.id) throw new Error('the id is not that key’s');
  return { name: String(file.name || 'operator').slice(0, 64), id: file.id, publicKey, privateKey: String(file.privateKey), createdAt: String(file.createdAt || '') };
}

async function operatorRoute(req, res, url, body, who) {
  if (lockedOut(req, res)) return undefined;
  const keyFile = path.join(configPath, 'operator-key.json');
  const present = fs.existsSync(keyFile);
  if (url.pathname === '/api/family/bootstrap-admin') {
    const { state, canEdit, reason } = operatorFiles();
    if (!canEdit) return sendJson(res, 409, { ok: false, reason });
    if ((state.draft.admins || []).length) return sendJson(res, 409, { ok: false, reason: 'admins-exist' });
    let draft;
    try { draft = applyEdit(state.draft, { op: 'admin-add', admin: { name: String(body.name || ''), key: String(body.key || '') } }); } catch (error) {
      return sendJson(res, 400, { ok: false, reason: 'bad-key', detail: error.message });
    }
    if (!confirmCode(req, res, body.code)) return undefined;
    saveDraft(configPath, draft);
    const doc = signDraft(loadState(configPath));
    saveSigned(configPath, doc);
    const published = await publishDirectory(doc);
    audit(`${who.user} listed the first admin key ${String(body.name || '').slice(0, 40)}; family list ${doc.body.serial}, ${published.filter((entry) => entry.ok).length}/${published.length} servers took it`);
    return sendJson(res, 200, { ok: true, serial: doc.body.serial, published });
  }
  if (!configWritable()) return sendJson(res, 409, { ok: false, reason: 'read-only' });
  if (url.pathname === '/api/operator/create') {
    if (present) return sendJson(res, 409, { ok: false, reason: 'exists' });
    if (!confirmCode(req, res, body.code)) return undefined;
    const made = initKey(configPath, String(body.name || 'operator').slice(0, 64));
    if (!loadState(configPath).draft) saveDraft(configPath, { relays: [], revoked: [], admins: [] });
    audit(`${who.user} made an operator key ${made.id.slice(0, 16)}`);
    return sendJson(res, 200, { ok: true, id: made.id });
  }
  if (url.pathname === '/api/operator/import') {
    if (present) return sendJson(res, 409, { ok: false, reason: 'exists' });
    let file;
    try { file = checkKeyFile(body.file); } catch (error) { return sendJson(res, 400, { ok: false, reason: 'bad-key-file', detail: error.message }); }
    if (!confirmCode(req, res, body.code)) return undefined;
    writePrivateJson(keyFile, file);
    if (!loadState(configPath).draft) saveDraft(configPath, { relays: [], revoked: [], admins: [] });
    family.forget();
    audit(`${who.user} imported the operator key ${file.id.slice(0, 16)}`);
    return sendJson(res, 200, { ok: true, id: file.id });
  }
  if (url.pathname === '/api/operator/export') {
    if (!present) return sendJson(res, 404, { ok: false, reason: 'no-operator-key' });
    if (!checkPassword(readJsonFile(loginFile), who.user, body.password)) {
      strike(clientAddress(req), 'operator key export with a wrong password');
      return sendJson(res, 403, { ok: false, reason: 'bad-password' });
    }
    if (!confirmCode(req, res, body.code)) return undefined;
    const content = fs.readFileSync(keyFile);
    const id = String(readJsonFile(keyFile)?.id || 'operator').slice(0, 12);
    audit(`${who.user} operator key exported`);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="operator-key-${id}.json"` });
    return res.end(content);
  }
  if (url.pathname === '/api/operator/remove') {
    if (!present) return sendJson(res, 404, { ok: false, reason: 'no-operator-key' });
    if (!confirmCode(req, res, body.code)) return undefined;
    /* A copy stays beside it: removing the family's master key by mistake
       must not lose the family. */
    fs.renameSync(keyFile, path.join(configPath, `operator-key.json.removed-${stampNow()}`));
    family.forget();
    audit(`${who.user} removed the operator key from this computer (a copy kept beside deploy.conf)`);
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/api/operator/rotate') {
    if (!present) return sendJson(res, 404, { ok: false, reason: 'no-operator-key' });
    if (servers.some((server) => !server.ssh)) return sendJson(res, 409, { ok: false, reason: 'needs-ssh' });
    if (servers.some((server) => SSH_FAILURES.has(server.sshState))) return sendJson(res, 409, { ok: false, reason: 'servers-unreachable' });
    if (!checkPassword(readJsonFile(loginFile), who.user, body.password)) {
      strike(clientAddress(req), 'operator key replacement with a wrong password');
      return sendJson(res, 403, { ok: false, reason: 'bad-password' });
    }
    if (!confirmCode(req, res, body.code)) return undefined;
    const job = startTask('replace the operator key', (log) => replaceOperatorKey(log), { onDone: (done) => audit(`operator key replacement finished (${done.code === 0 ? 'every server' : 'stopped'})`) });
    audit(`${who.user} began replacing the operator key`);
    return sendJson(res, 200, { ok: true, job });
  }
  return sendJson(res, 404, { ok: false });
}

/* The new key is kept as operator-key.next.json until every server has it, so
   a replacement that stopped carries on with the same key when run again. */
async function replaceOperatorKey(log) {
  const nextFile = path.join(configPath, 'operator-key.next.json');
  const state = loadState(configPath);
  let next = readJsonFile(nextFile);
  if (!next?.privateKey) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    next = { name: state.key.name, id: crypto.createHash('sha256').update(Buffer.from(spki, 'base64')).digest('hex'), publicKey: spki, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), createdAt: new Date().toISOString() };
    writePrivateJson(nextFile, next);
  }
  log(`new operator key ${next.id.slice(0, 16)}…`);
  const doc = signDraft({ ...state, key: next });
  const stamp = stampNow();
  const restart = `p="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' Poorija-Cryptography_ChatSignal)"
f="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' Poorija-Cryptography_ChatSignal)"
docker compose -p "$p" -f "$f" --env-file .env up -d chat-signal >/dev/null 2>&1`;
  const onEnv = (server, script) => onServerAsync(server.ssh, `set -e\ncd ${server.ssh.dir.replace(/[^A-Za-z0-9._~/-]/g, '')}\n${script}\n${restart}\n`, 120000);
  const healthy = async (server) => {
    for (let i = 0; i < 40; i += 1) {
      const health = await serverRequest(server, '/chat-health', { auth: false, timeout: 5000 });
      if (health.status === 200) return true;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return false;
  };
  const result = await rotateOperator({
    servers,
    log,
    applyKey: async (server) => {
      const run = await onEnv(server, `cp .env .env.bak-operator-${stamp}
if grep -q '^CHAT_OPERATOR_KEY=' .env; then sed -i "s|^CHAT_OPERATOR_KEY=.*|CHAT_OPERATOR_KEY=${next.publicKey}|" .env; else echo "CHAT_OPERATOR_KEY=${next.publicKey}" >> .env; fi`);
      if (!run.ok) return { ok: false, reason: String(run.err).trim().split('\n').pop()?.slice(0, 160) || 'ssh failed' };
      return (await healthy(server)) ? { ok: true } : { ok: false, reason: 'the relay did not come back' };
    },
    revertKey: async (server) => {
      await onEnv(server, `[ -f .env.bak-operator-${stamp} ] && cp .env.bak-operator-${stamp} .env`);
      await healthy(server);
      return { ok: true };
    },
    deliver: async (server) => {
      const answer = await serverRequest(server, '/Monitor_Server/directory', { method: 'POST', body: doc });
      return { ok: answer.json?.ok === true, reason: answer.json?.reason || (answer.status ? '' : 'unreachable') };
    },
  });
  if (result.failed) throw new Error(`stopped at ${result.failed.name}: ${result.failed.reason}. ${result.done.length ? `${result.done.join(', ')} already have the new key; ` : ''}run it again to carry on with the same new key.`);
  const keyFile = path.join(configPath, 'operator-key.json');
  fs.renameSync(keyFile, path.join(configPath, `operator-key.json.old-${stamp}`));
  fs.renameSync(nextFile, keyFile);
  saveSigned(configPath, doc);
  /* The panel trusts the family it just handed a new key. */
  writePrivateJson(path.join(env.POORIJA_PANEL_STATE_DIR || configPath, TRUST_FILE), { operatorId: next.id, operatorKey: next.publicKey, name: next.name, pinnedAt: new Date().toISOString() });
  family.forget();
  log(`✓ every server trusts the new key; the old one is kept as operator-key.json.old-${stamp}`);
}

async function overview(who) {
  const directory = await family.directory();
  const placed = (name) => directory?.relays?.find((relay) => relay.name === name) || {};
  const rows = await Promise.all(servers.map(async (server) => {
    const row = await describe(server);
    const { id, reason } = await family.signableRelayId(server);
    const entry = placed(server.name);
    return {
      ...row,
      signFor: id,
      signReason: reason || '',
      relayId: server.relayId || '',
      publicUrl: String(server.publicUrl || '').slice(0, 200),
      cluster: String(entry.cluster || '').slice(0, 40),
      region: String(entry.region || '').slice(0, 40),
      gateway: Number(entry.gateway) || 0,
      inside: Array.isArray(entry.inside) ? entry.inside.slice(0, 4).map((origin) => String(origin).slice(0, 200)) : [],
    };
  }));
  return {
    ok: true,
    user: who.user,
    idleMs: SESSION_IDLE_MS,
    operator: await family.operatorState(),
    admins: (directory?.admins || []).map((admin) => ({ id: String(admin.id || ''), name: String(admin.name || '').slice(0, 64) })),
    dangerous: [...signatures.DANGEROUS_PATHS],
    servers: rows,
  };
}

async function api(req, res, url, who) {
  if (req.method === 'GET') {
    if (url.pathname === '/api/session') return sendJson(res, 200, { ok: true, user: who.user, idleMs: SESSION_IDLE_MS });
    if (url.pathname === '/api/servers') return sendJson(res, 200, await overview(who));
    if (url.pathname === '/api/graph') return sendJson(res, 200, await graphData());
    if (url.pathname === '/api/directory') return sendJson(res, 200, directoryView());
    if (url.pathname === '/api/family') return sendJson(res, 200, await familyView());
    /* What the top bar's chips need, every few seconds, without asking any
       server anything: names and the last state each was seen in. */
    if (url.pathname === '/api/chips') {
      return sendJson(res, 200, { ok: true, servers: servers.map((server) => ({ name: server.name, reachable: server.lastReachable === true, problem: SSH_FAILURES.has(server.sshState) ? server.sshState : '' })) });
    }
    if (url.pathname === '/api/system') {
      const { state } = operatorFiles();
      return sendJson(res, 200, {
        ok: true, version: VERSION, uptimeMs: Date.now() - STARTED_AT, configDir: configPath, writable: configWritable(),
        operatorKey: Boolean(state.key?.privateKey), servers: servers.length, direct: Boolean(env.POORIJA_PANEL_DIRECT),
        sessionIdleMs: SESSION_IDLE_MS, node: process.version,
      });
    }
    if (url.pathname === '/api/log') {
      let lines = [];
      try { lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').slice(-300).reverse(); } catch (_error) { lines = []; }
      return sendJson(res, 200, { ok: true, lines });
    }
    if (url.pathname === '/api/servers-config') {
      return sendJson(res, 200, { ok: true, writable: configWritable(), keys: sshKeysHere(), servers: readServers(confText()) });
    }
    if (url.pathname === '/api/jobs') {
      const view = jobView(url.searchParams.get('id'));
      return view ? sendJson(res, 200, view) : sendJson(res, 404, { ok: false });
    }
    if (url.pathname === '/api/servers/deploy-command') {
      const name = String(url.searchParams.get('name') || '');
      if (!validName(name)) return sendJson(res, 400, { ok: false });
      return sendJson(res, 200, { ok: true, command: `bash scripts/deploy.sh --skip-bump --prebuilt --server ${name}` });
    }
    if (url.pathname === '/api/account') {
      return sendJson(res, 200, {
        ok: true, user: who.user,
        sessions: [...sessions.entries()].map(([key, entry]) => ({ since: entry.since, lastSeen: entry.lastSeen, current: key === who.key })),
        history: history(auditFile),
        pending: Boolean(readJsonFile(loginFile)?.pendingTotp),
      });
    }
    return sendJson(res, 404, { ok: false });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false });
  /* An announcement may carry a 2 MB attachment as a data URL. */
  const raw = await readBody(req, 4 * 1024 * 1024);
  if (raw === null) return sendJson(res, 413, { ok: false, reason: 'too-large' });
  let body = {};
  try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch (_error) { return sendJson(res, 400, { ok: false, reason: 'bad-json' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { ok: false, reason: 'bad-json' });
  if (url.pathname.startsWith('/api/account/')) return account(req, res, url, body, who);
  if (url.pathname.startsWith('/api/servers/')) return serversRoute(req, res, url, body, who);
  if (url.pathname.startsWith('/api/operator/') || url.pathname === '/api/family/bootstrap-admin') return operatorRoute(req, res, url, body, who);
  if (url.pathname === '/api/logout') {
    sessions.delete(who.key);
    saveSessions();
    audit(`logout ${who.user}`);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie ? '; Secure' : ''}` });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (url.pathname === '/api/call') return call(req, res, body, who);
  if (url.pathname === '/api/download') return download(req, res, body, who);
  /* After the operator lists a key or signs a new directory: read it again now. */
  if (url.pathname === '/api/family-refresh') { family.forget(); return sendJson(res, 200, { ok: true }); }
  if (url.pathname === '/api/lock') return lock(req, res, body, who);
  if (url.pathname === '/api/directory') return editDirectory(res, body, who);
  if (url.pathname === '/api/layout') {
    const { status, reason } = saveLayout(body);
    return sendJson(res, status, status === 200 ? { ok: true } : { ok: false, reason });
  }
  if (url.pathname === '/api/trust') {
    const { status, reason } = await family.trust(body.operatorId);
    if (status === 200) audit(`${who.user} confirmed the family operator`);
    return sendJson(res, status, status === 200 ? { ok: true } : { ok: false, reason });
  }
  if (url.pathname === '/api/reconnect') {
    const server = servers.find((candidate) => candidate.name === body.server);
    if (!server || server.direct) return sendJson(res, 404, { ok: false });
    audit(`${who.user} ${server.name} asked to connect again`);
    await reconnect(server);
    return sendJson(res, 200, { ok: true, state: server.sshState || '' });
  }
  if (url.pathname === '/api/password') {
    const server = servers.find((candidate) => candidate.name === body.server);
    if (!server) return sendJson(res, 404, { ok: false });
    server.password = String(body.password || '');
    audit(`${who.user} ${server.name} password entered for this session`);
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 404, { ok: false });
}

/* ---- the page ------------------------------------------------------------- */

const ASSETS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
  '/sign.js': ['sign.js', 'application/javascript; charset=utf-8'],
  '/ui.js': ['ui.js', 'application/javascript; charset=utf-8'],
  '/sections.js': ['sections.js', 'application/javascript; charset=utf-8'],
  '/actions.js': ['actions.js', 'application/javascript; charset=utf-8'],
  '/strings.js': ['strings.js', 'application/javascript; charset=utf-8'],
  '/graph.js': ['graph.js', 'application/javascript; charset=utf-8'],
  '/graphdata.js': ['graphdata.js', 'application/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/admin.js': ['admin.js', 'application/javascript; charset=utf-8'],
};
/* The brand and the fonts, from the repository itself (CSP stays 'self'). */
const BRAND = {
  '/logo.svg': [path.join(HERE, '..', '..', 'assets', 'icon-app.svg'), 'image/svg+xml'],
  '/fonts/vazirmatn.ttf': [path.join(HERE, '..', '..', 'fonts', 'Vazirmatn', 'Vazirmatn-VariableFont_wght.ttf'), 'font/ttf'],
  '/fonts/inter.ttf': [path.join(HERE, '..', '..', 'fonts', 'Inter-Regular.ttf'), 'font/ttf'],
  /* The icons, from the repository's own Font Awesome. */
  '/fa/css/all.min.css': [path.join(HERE, '..', '..', 'vendor', 'fontawesome', 'css', 'all.min.css'), 'text/css; charset=utf-8'],
  ...Object.fromEntries(['fa-solid-900', 'fa-regular-400', 'fa-brands-400', 'fa-v4compatibility'].map((name) => [`/fa/webfonts/${name}.woff2`, [path.join(HERE, '..', '..', 'vendor', 'fontawesome', 'webfonts', `${name}.woff2`), 'font/woff2']])),
};
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'package.json'), 'utf8')).version || ''; } catch (_error) { return ''; } })();
const STARTED_AT = Date.now();
const PAGE_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const asset = (name) => { const file = path.join(HERE, 'web', name); return fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0); };

async function handle(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (!placeAllowed(req)) return sendJson(res, 403, { ok: false, reason: 'forbidden' });
  const url = new URL(req.url, 'http://panel.invalid');
  const page = ASSETS[url.pathname === '/index.html' ? '/' : url.pathname];
  if (page && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': page[1], 'Cache-Control': 'no-store', 'Content-Security-Policy': PAGE_POLICY });
    return res.end(asset(page[0]));
  }
  const brand = BRAND[url.pathname];
  if (brand && req.method === 'GET' && fs.existsSync(brand[0])) {
    res.writeHead(200, { 'Content-Type': brand[1], 'Cache-Control': 'public, max-age=86400' });
    return res.end(fs.readFileSync(brand[0]));
  }
  /* The version, for the login page's foot: nothing else is said before a login. */
  if (url.pathname === '/api/version' && req.method === 'GET') return sendJson(res, 200, { ok: true, version: VERSION });
  if (!url.pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false });
  /* Writes come as JSON only: a form on another site can post, but not JSON. */
  if (req.method === 'POST' && !/^application\/json(;|$)/i.test(String(req.headers['content-type'] || ''))) return sendJson(res, 415, { ok: false, reason: 'json-only' });
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const raw = await readBody(req, 16 * 1024);
    let body = {};
    try { body = raw && raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch (_error) { return sendJson(res, 400, { ok: false, reason: 'bad-json' }); }
    return login(req, res, body || {});
  }
  const who = sessionOf(req);
  if (!who) return sendJson(res, 401, { ok: false, reason: 'login' });
  return api(req, res, url, who);
}

/* The list of servers is deploy.conf's, followed as it changes: a server
   added there is connected, one removed is let go, one whose address or key
   changed is connected afresh. Polled, because a folder bind-mounted into a
   container does not always pass file events through. */
const sshSignature = (server) => JSON.stringify([server.publicUrl, server.ssh]);
function followDeployConf(dir) {
  if (env.POORIJA_PANEL_DIRECT) return;
  const file = path.join(dir, 'deploy.conf');
  const stamp = () => { try { const stat = fs.statSync(file); return `${stat.mtimeMs}:${stat.size}`; } catch (_error) { return ''; } };
  let last = stamp();
  let busy = false;
  const timer = setInterval(async () => {
    const now = stamp();
    if (busy || !now || now === last) return;
    busy = true;
    last = now;
    try {
      const fresh = loadServers(dir);
      const kept = [];
      const added = [];
      for (const server of fresh) {
        const old = servers.find((candidate) => candidate.name === server.name);
        if (old && sshSignature(old) === sshSignature(server)) kept.push(old);
        else added.push(server);
      }
      const gone = servers.filter((server) => !kept.includes(server));
      disconnect(gone);
      servers = fresh.map((server) => kept.find((candidate) => candidate.name === server.name) || server);
      /* Connected in the background: waiting here for a slow tunnel held up
         every change after it, a removal included. */
      if (added.length) connect(added).catch(() => {});
      family.forget();
      if (added.length || gone.length) audit(`deploy.conf changed: ${servers.map((server) => server.name).join(', ')}`);
    } catch (error) {
      audit(`deploy.conf could not be read: ${error.message}`);
    } finally {
      busy = false;
    }
  }, Math.max(200, Number(env.POORIJA_PANEL_CONF_POLL_MS) || 3000));
  timer.unref?.();
}

async function main() {
  const dir = configDir();
  const stateDir = env.POORIJA_PANEL_STATE_DIR || dir;
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  loginFile = path.join(stateDir, LOGIN_FILE);
  layoutFile = path.join(stateDir, LAYOUT_FILE);
  configPath = dir;
  if (!readJsonFile(loginFile)?.hash) {
    throw new Error(`no login yet at ${loginFile}; make one first with: node tools/panel/setup-login.mjs (in Docker: docker compose -f config/control-panel.compose.yaml run --rm -it control-panel setup-login)`);
  }
  auditFile = path.join(stateDir, LOG_FILE);
  audit = makeAudit(auditFile);
  sessionsFile = path.join(stateDir, SESSIONS_FILE);
  loadSessions();
  servers = loadServers(dir);
  if (!servers.length) throw new Error('deploy.conf names no server');
  family = createFamily({ dir, trustFile: path.join(stateDir, TRUST_FILE), audit, servers: () => servers });
  await connect(servers);
  followDeployConf(dir);

  const tls = env.POORIJA_PANEL_TLS_CERT && env.POORIJA_PANEL_TLS_KEY
    ? { cert: fs.readFileSync(env.POORIJA_PANEL_TLS_CERT), key: fs.readFileSync(env.POORIJA_PANEL_TLS_KEY) }
    : null;
  secureCookie = Boolean(tls) || env.POORIJA_PANEL_SECURE_COOKIE === '1';
  const host = env.POORIJA_PANEL_HOST || '127.0.0.1';
  const server = tls ? https.createServer(tls, handle) : http.createServer(handle);
  await new Promise((resolve) => server.listen(Number(env.POORIJA_PANEL_PORT ?? 8686), host, resolve));
  const { port } = server.address();
  const scheme = tls ? 'https' : 'http';
  const origins = String(env.POORIJA_PANEL_ORIGINS || '').split(',').map((origin) => origin.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);
  if (!origins.length) origins.push(`${scheme}://127.0.0.1:${port}`, `${scheme}://localhost:${port}`);
  allowedOrigins = new Set(origins);
  allowedHosts = new Set(origins.map((origin) => new URL(origin).host));
  audit('web panel started');
  say(`panel: ${scheme}://${host}:${port}/`);
  if (host !== '127.0.0.1' && host !== 'localhost') say('note: the panel answers beyond this computer; only the addresses in POORIJA_PANEL_ORIGINS get in');
  const stop = () => { disconnect(servers); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
