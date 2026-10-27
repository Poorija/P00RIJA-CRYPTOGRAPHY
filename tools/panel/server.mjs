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
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { configDir, loadState, editRelay, signDraft, saveDraft, saveSigned } from '../relay-directory.mjs';
import { buildGraph } from './web/graphdata.js';
import {
  loadServers, serverRequest, connect, disconnect, makeAudit, createFamily, describe, setLock,
  sendJson, readBody, cookieOf, readJsonFile,
} from './core.mjs';
import { checkPassword, checkCode } from './login.mjs';

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

const say = (line) => process.stdout.write(`${line}\n`);

/* ---- state ---------------------------------------------------------------- */

let servers = [];
let family = null;
let audit = () => {};
let loginFile = '';
let layoutFile = '';
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
  for (const [token, entry] of sessions) if (now - entry.lastSeen > SESSION_IDLE_MS) sessions.delete(token);
  for (const [address, entry] of failures) if (entry.until && entry.until <= now) failures.delete(address);
  for (const [nonce, until] of lockNonces) if (until <= now) lockNonces.delete(nonce);
  for (const [nonce, until] of directoryNonces) if (until <= now) directoryNonces.delete(nonce);
}, 60000).unref();

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
  const entry = sessions.get(token);
  if (!entry) return null;
  const now = Date.now();
  if (now - entry.lastSeen > SESSION_IDLE_MS) { sessions.delete(token); return null; }
  if (req.headers['x-panel-poll'] !== '1') entry.lastSeen = now;
  return { token, ...entry };
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

async function login(req, res, body) {
  const address = clientAddress(req);
  const now = Date.now();
  const strikes = failures.get(address);
  if (strikes?.until > now) return sendJson(res, 429, { ok: false, reason: 'locked', retryAfter: Math.ceil((strikes.until - now) / 1000) });
  const record = readJsonFile(loginFile);
  const passwordOk = checkPassword(record, body.username, body.password);
  const step = passwordOk ? checkCode(record.totp, body.code, { now, lastStep: Number(record.lastStep) || 0 }) : -1;
  if (step < 0) {
    const count = (strikes && !strikes.until ? strikes.count : 0) + 1;
    failures.set(address, { count, until: count >= MAX_FAILURES ? now + LOCK_MS : 0 });
    audit(`login failed from ${address}${count >= MAX_FAILURES ? ', address locked' : ''}`);
    return sendJson(res, 401, { ok: false, reason: 'login-failed' });
  }
  failures.delete(address);
  writeLogin({ ...record, lastStep: step });
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user: record.username, lastSeen: now, since: now });
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

async function editDirectory(res, body, who) {
  const { state, canEdit, reason } = operatorFiles();
  if (!canEdit) return sendJson(res, 409, { ok: false, reason });
  const edits = body.edits;
  if (!Array.isArray(edits) || !edits.length || edits.length > 20) return sendJson(res, 400, { ok: false, reason: 'bad-edits' });
  if (!body.signature) return sendJson(res, 403, { ok: false, reason: 'signature-needed' });
  const directory = await family.directory();
  if (!directory || directory.operator?.id !== state.key.id) return sendJson(res, 409, { ok: false, reason: 'operator-unconfirmed' });
  const verdict = signatures.verifyRequest(String(body.signature), {
    method: 'POST', path: DIRECTORY_PATH, body: { edits }, relay: state.key.id,
    keys: signatures.signingKeys(directory, directory.operator.key),
    nonceSeen: (nonce) => (directoryNonces.get(nonce) || 0) > Date.now(),
  });
  if (!verdict.ok) {
    audit(`${who.user} family list change refused: ${verdict.reason}`);
    return sendJson(res, 403, { ok: false, reason: 'bad-signature', detail: verdict.reason });
  }
  directoryNonces.set(verdict.nonce, Date.now() + 10 * 60 * 1000);
  let draft = state.draft;
  try {
    for (const edit of edits) {
      const changes = {};
      if (edit?.op === 'cluster') changes.cluster = String(edit.cluster ?? '');
      else if (edit?.op === 'inside') changes.inside = edit.inside;
      else if (edit?.op === 'gateway') changes.gateway = edit.gateway;
      else throw new Error(`unknown change ${String(edit?.op).slice(0, 20)}`);
      draft = editRelay(draft, String(edit.name || ''), changes);
    }
  } catch (error) {
    return sendJson(res, 400, { ok: false, reason: 'bad-edits', detail: error.message });
  }
  saveDraft(configPath, draft);
  const doc = signDraft(loadState(configPath));
  saveSigned(configPath, doc);
  const published = [];
  for (const server of servers) {
    const answer = await serverRequest(server, '/Monitor_Server/directory', { method: 'POST', body: doc });
    published.push({ server: server.name, ok: answer.json?.ok === true || answer.json?.reason === 'stale', reason: answer.json?.reason || (answer.status ? '' : 'unreachable') });
  }
  family.forget();
  audit(`${who.user} family list ${doc.body.serial} signed (${edits.map((edit) => `${edit.op} ${String(edit.name || '').slice(0, 30)}`).join(', ')}) by ${verdict.name}; ${published.filter((entry) => entry.ok).length}/${published.length} servers took it`);
  return sendJson(res, 200, { ok: true, serial: doc.body.serial, published });
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
    return sendJson(res, 404, { ok: false });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false });
  /* An announcement may carry a 2 MB attachment as a data URL. */
  const raw = await readBody(req, 4 * 1024 * 1024);
  if (raw === null) return sendJson(res, 413, { ok: false, reason: 'too-large' });
  let body = {};
  try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch (_error) { return sendJson(res, 400, { ok: false, reason: 'bad-json' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { ok: false, reason: 'bad-json' });
  if (url.pathname === '/api/logout') {
    sessions.delete(who.token);
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
};
const PAGE_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
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
  audit = makeAudit(path.join(stateDir, LOG_FILE));
  servers = loadServers(dir);
  if (!servers.length) throw new Error('deploy.conf names no server');
  family = createFamily({ dir, trustFile: path.join(stateDir, TRUST_FILE), audit, servers: () => servers });
  await connect(servers);

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
