/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What both faces of the central panel share (docs/CONTROL-PANEL.md): the
 * command-line panel of tools/control-panel.mjs and the web panel of
 * tools/panel/server.mjs.
 *
 * The servers come from deploy.conf; each is reached through an SSH tunnel
 * to its dashboard on its own loopback, with the dashboard password read
 * over SSH into memory. Which relay a signature for a server must name comes
 * from the family's signed directory, under an operator the admin confirmed,
 * never from the server itself.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseDeployConf } from '../relay-directory.mjs';

const require = createRequire(import.meta.url);
const { verifyDirectory } = require('../../scripts/lib/relay-directory.js');
const { relayIdFor } = require('../../scripts/lib/relay-identity.js');

export const DASHBOARD_PORT = 9000;

/* ---- the servers ---------------------------------------------------------- */

/* POORIJA_PANEL_DIRECT is for the test suite: servers on this machine,
   reached without SSH. Only loopback addresses are taken, so it can never
   send a dashboard password across a network. */
export function loadServers(dir, { home = os.homedir() } = {}) {
  const direct = String(process.env.POORIJA_PANEL_DIRECT || '').trim();
  if (direct) {
    return direct.split(',').map((pair) => {
      const [name, origin] = pair.split('=');
      const url = new URL(origin);
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('direct mode reaches loopback only');
      return { name, direct: url.origin, publicUrl: url.origin };
    });
  }
  const file = path.join(dir, 'deploy.conf');
  if (!fs.existsSync(file)) throw new Error(`no deployment settings at ${file}; run scripts/deploy.sh once first`);
  const conf = parseDeployConf(fs.readFileSync(file, 'utf8'));
  const sshOf = (name) => ({
    host: conf.fields(name, 'SSH_HOST'),
    user: conf.fields(name, 'SSH_USER') || os.userInfo().username,
    port: conf.fields(name, 'SSH_PORT') || '22',
    key: conf.fields(name, 'SSH_KEY') ? resolveKeyPath(conf.fields(name, 'SSH_KEY'), { home }) : '',
    dir: conf.fields(name, 'REMOTE_DIR') || '~/work/pkg',
  });
  return conf.servers.map((name) => {
    const ssh = sshOf(name);
    /* <NAME>_JUMP names the server to go through, as scripts/deploy.sh does. */
    const via = conf.fields(name, 'JUMP');
    if (via && via !== name && conf.servers.includes(via)) {
      const jump = sshOf(via);
      if (jump.host) ssh.jump = { host: jump.host, user: jump.user, port: jump.port, key: jump.key };
    }
    return { name, publicUrl: conf.fields(name, 'PUBLIC_URL'), ssh };
  }).filter((server) => server.ssh.host);
}

/* deploy.conf names keys as the computer that wrote it sees them. In the
   panel's container that computer's SSH folder is a copy at ~/.ssh, so a key
   named by the host's own path (/Users/<name>/.ssh/key) is looked for there:
   by the folder the launcher says it mounted, then by the file's name. A key
   found nowhere keeps its path, to be reported missing rather than tried. */
export function resolveKeyPath(key, { home = os.homedir(), hostSshDir = process.env.POORIJA_PANEL_HOST_SSH_DIR || '' } = {}) {
  const value = String(key || '');
  if (!value) return '';
  if (value.startsWith('~/')) return path.join(home, value.slice(2));
  if (fs.existsSync(value)) return value;
  const local = path.join(home, '.ssh');
  const hostDir = String(hostSshDir || '').replace(/\/+$/, '');
  if (hostDir && value.startsWith(`${hostDir}/`)) {
    const mapped = path.join(local, value.slice(hostDir.length + 1));
    if (fs.existsSync(mapped)) return mapped;
  }
  const byName = path.join(local, path.basename(value));
  return fs.existsSync(byName) ? byName : value;
}

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
export const sshArgs = (ssh, extra = []) => [
  '-p', ssh.port, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
  ...(process.env.POORIJA_PANEL_KNOWN_HOSTS ? ['-o', `UserKnownHostsFile=${process.env.POORIJA_PANEL_KNOWN_HOSTS}`] : []),
  ...(ssh.key ? ['-i', ssh.key, '-o', 'IdentitiesOnly=yes'] : []),
  /* Through a faster server, the way scripts/deploy.sh goes (its JUMP). */
  ...(ssh.jump ? ['-o', `ProxyCommand=ssh -p ${ssh.jump.port || 22} -o BatchMode=yes${ssh.jump.key ? ` -i ${shellQuote(ssh.jump.key)} -o IdentitiesOnly=yes` : ''} ${ssh.jump.user}@${ssh.jump.host} -W %h:%p`] : []),
  ...extra, `${ssh.user}@${ssh.host}`,
];
/* A script on stdin to `bash -s`: whatever the login shell, and nothing on
   a command line. */
export const onServer = (ssh, script, timeout = 60000) => {
  const run = spawnSync('ssh', [...sshArgs(ssh), 'bash -s'], { input: script, encoding: 'utf8', timeout });
  return { ok: run.status === 0, out: String(run.stdout || ''), err: String(run.stderr || '') };
};

/* The same, without holding the panel up while it runs. */
export function onServerAsync(ssh, script, timeout = 60000) {
  return new Promise((resolve) => {
    const child = spawn('ssh', [...sshArgs(ssh), 'bash -s'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', (error) => { err += error.message; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out, err }); });
    child.stdin.end(script);
  });
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

/* What ssh said when it gave up, as a state the page can show. A refused key
   or a changed host key is never tried again on its own: some servers lock an
   address out after a few failed logins, and a tunnel that retried a wrong key
   every minute was exactly that. Only a network that did not answer is tried
   again, further apart each time. */
export const SSH_FAILURES = new Set(['auth-failed', 'key-missing', 'host-unknown']);
export function sshFailure(stderr) {
  const text = String(stderr || '');
  if (/Permission denied|Too many authentication failures|Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) return 'auth-failed';
  if (/Could not resolve hostname|Name or service not known|nodename nor servname/i.test(text)) return 'host-unknown';
  return '';
}
const lastLine = (text) => String(text || '').trim().split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 200) || '';

/* One tunnel per server, kept up: a dropped one comes back with backoff. */
export async function openTunnel(server) {
  server.closing = false;
  if (server.ssh.key && !fs.existsSync(server.ssh.key)) {
    server.sshState = 'key-missing';
    server.sshReason = `no key file at ${server.ssh.key}`;
    return;
  }
  const port = await freePort();
  server.base = `http://127.0.0.1:${port}`;
  const first = Math.max(100, Number(process.env.POORIJA_PANEL_RETRY_MS) || 2000);
  let delay = first;
  const start = () => {
    if (server.closing) return;
    server.sshState = 'connecting';
    const child = spawn('ssh', [...sshArgs(server.ssh, ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${port}:127.0.0.1:${DASHBOARD_PORT}`])], { stdio: ['ignore', 'ignore', 'pipe'] });
    server.tunnel = child;
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    const upAt = Date.now();
    child.on('exit', () => {
      if (server.closing || server.tunnel !== child) return;
      const failure = sshFailure(stderr);
      server.sshReason = lastLine(stderr);
      if (failure) { server.sshState = failure; return; }
      server.sshState = 'retrying';
      if (Date.now() - upAt > 60000) delay = first;
      setTimeout(start, delay).unref?.();
      delay = Math.min(delay * 2, 60000);
    });
  };
  start();
}

/* Waits until the tunnel is up (its local port answers) or ssh has given up. */
export async function tunnelSettled(server, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!server.base || SSH_FAILURES.has(server.sshState)) return false;
    const { port } = new URL(server.base);
    const open = await new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port: Number(port) });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (open) { server.sshState = 'up'; return true; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/* Asked for from the page: one fresh attempt, whatever happened before. */
export async function reconnect(server) {
  server.closing = true;
  const old = server.tunnel;
  server.tunnel = null;
  old?.kill('SIGTERM');
  await openTunnel(server);
  if (await tunnelSettled(server)) {
    server.password = readPassword(server) || server.password || '';
    await identify(server);
  }
}

export function readPassword(server) {
  if (server.direct) return String(process.env.POORIJA_PANEL_PASSWORD || '');
  /* No second login where the tunnel's was already refused. */
  if (SSH_FAILURES.has(server.sshState)) return '';
  const dir = server.ssh.dir.replace(/'/g, '');
  const read = onServer(server.ssh, `sed -n 's/^MONITOR_PASSWORD=//p' '${dir}/.env' 2>/dev/null | head -1 | tr -d "\\"'"\n`);
  return read.ok ? read.out.trim() : '';
}

/* ---- talking to one server ------------------------------------------------ */

export function serverRequest(server, route, { method = 'GET', body, headers = {}, auth = true, raw = false, timeout = 20000 } = {}) {
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
      timeout,
    }, (response) => {
      if (raw) return resolve({ status: response.statusCode, response });
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_error) { /* not JSON */ }
        resolve({ status: response.statusCode, json, text, type: String(response.headers['content-type'] || '') });
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', (error) => resolve({ status: 0, json: null, text: error.message }));
    request.end(payload || undefined);
  });
}

/* The relay a server says it is, kept only when the id is the hash of the key. */
export async function identify(server) {
  const identity = await serverRequest(server, '/relay-identity', { auth: false });
  const said = String(identity.json?.id || '');
  server.relayId = said && relayIdFor(String(identity.json?.publicKey || '')) === said ? said : '';
  return server.relayId;
}

/* Tunnels, passwords and identities, for every server. */
export async function connect(servers) {
  for (const server of servers) {
    if (server.direct) server.base = server.direct; else await openTunnel(server);
  }
  /* Each tunnel up or given up, then what each server is and its password:
     reading the password is another SSH login, never tried with a key the
     tunnel's own login just had refused. */
  await Promise.all(servers.filter((server) => !server.direct).map((server) => tunnelSettled(server)));
  for (const server of servers) {
    if (SSH_FAILURES.has(server.sshState)) continue;
    server.password = readPassword(server);
    await identify(server);
  }
}

export function disconnect(servers) {
  for (const server of servers) { server.closing = true; server.tunnel?.kill('SIGTERM'); }
}

/* ---- the audit log -------------------------------------------------------- */

export function makeAudit(file) {
  return (line) => {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
    } catch (_error) { /* the panel goes on */ }
  };
}

/* ---- whom a signature is for ----------------------------------------------

   A signature names the relay it is for, and that name must never come from
   the server being talked to: a server that lied about who it is would be
   handed signatures good on another relay. So each server's relay id comes
   from the family's signed directory, by the name deploy.conf gives it, and
   a signature is made for a server only when the identity it answers with is
   that one.

   Which operator signed the right directory is never taken from a server
   either, since a server can sign a directory of its own: it is the operator
   key beside deploy.conf when this is the operator's computer
   (relay-directory.json), or the operator id the admin confirms in the page
   (or gives as POORIJA_PANEL_OPERATOR_ID) from what the operator told them
   (`node tools/relay-directory.mjs show` prints it). Until then nothing is
   signed. The confirmed operator is kept in control-panel-trust.json. */
export const readJsonFile = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return null; } };
const selfSigned = (doc) => Boolean(doc?.body?.operator?.key)
  && verifyDirectory(doc, { operatorKey: String(doc.body.operator.key), selfId: doc.body.relays?.[0]?.id }).ok
  && relayIdFor(String(doc.body.operator.key)) === doc.body.operator.id;

export function createFamily({ dir, trustFile, audit, servers }) {
  let cache = { at: 0, body: null };
  async function directoriesOnOffer() {
    const offers = [];
    const local = readJsonFile(path.join(dir, 'relay-directory.json'));
    if (selfSigned(local)) offers.push({ doc: local, local: true });
    for (const server of servers()) {
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
  async function directory() {
    if (cache.body && Date.now() - cache.at < 60000) return cache.body;
    const offers = await directoriesOnOffer();
    const operatorId = confirmedOperator(offers);
    let best = null;
    for (const { doc } of offers) {
      if (!operatorId || doc.body.operator.id !== operatorId) continue;
      if (!best || doc.body.serial > best.body.serial) best = doc;
    }
    if (best) pinOperator(best.body);
    cache = { at: Date.now(), body: best ? best.body : null };
    return cache.body;
  }
  /* The relay id a signature for this server may name, or why there is none. */
  async function signableRelayId(server) {
    const family = await directory();
    if (!family) return { id: '', reason: 'operator-unconfirmed' };
    const expected = family.relays?.find((relay) => relay.name === server.name)?.id || '';
    return expected && expected === server.relayId ? { id: expected } : { id: '', reason: 'identity-mismatch' };
  }
  /* The admin confirms the operator id the operator gave them; it has to be
     one a directory on offer is signed by. */
  async function trust(operatorId) {
    const wanted = String(operatorId || '').trim().toLowerCase();
    const offer = (await directoriesOnOffer()).find(({ doc }) => doc.body.operator.id === wanted);
    if (!/^[a-f0-9]{64}$/.test(wanted) || !offer) return { status: 400, reason: 'no-such-operator' };
    if (readJsonFile(trustFile)?.operatorId && readJsonFile(trustFile).operatorId !== wanted) return { status: 409, reason: 'another-operator-pinned' };
    pinOperator(offer.doc.body);
    cache = { at: 0, body: null };
    return { status: 200 };
  }
  /* What the page shows about the operator, for the admin to compare. */
  async function operatorState() {
    const offers = await directoriesOnOffer();
    const operatorId = confirmedOperator(offers);
    const candidates = Array.from(new Map(offers.map(({ doc }) => [doc.body.operator.id, { id: doc.body.operator.id, name: String(doc.body.operator.name || '').slice(0, 60) }])).values());
    return { confirmed: Boolean(operatorId), id: operatorId, candidates };
  }
  return { directoriesOnOffer, confirmedOperator, pinOperator, directory, signableRelayId, trust, operatorState, forget: () => { cache = { at: 0, body: null }; } };
}

/* ---- one server at a glance ----------------------------------------------- */

export async function describe(server) {
  const health = await serverRequest(server, '/chat-health', { auth: false });
  const row = { name: server.name, proxy: server.proxy, reachable: health.status === 200, version: String(health.json?.version || '').slice(0, 40), locked: health.json?.locked === true, passwordOk: false };
  server.lastReachable = row.reachable;
  if (!row.reachable) {
    /* Why not, in words the page can show: a refused key reads differently
       from a server that is down. */
    row.problem = SSH_FAILURES.has(server.sshState) ? server.sshState : 'unreachable';
    row.problemDetail = String(server.sshReason || '').slice(0, 200);
    return row;
  }
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
      memory: { total: n(stats.json.memory?.total), free: n(stats.json.memory?.free), rss: n(stats.json.memory?.rss) },
      containerMem: stats.json.containerMem ? { usageMb: n(stats.json.containerMem.usageMb), limitMb: n(stats.json.containerMem.limitMb) } : null,
      storage: { total: n(stats.json.storage?.total), free: n(stats.json.storage?.free) },
      peers: n(typeof stats.json.peers === 'object' ? stats.json.peers?.length ?? stats.json.peers?.count : stats.json.peers),
    });
  }
  if (transit.json?.status) row.links = { up: n(transit.json.status.up), allowed: n(transit.json.status.allowed) };
  if (transit.json?.directory) row.family = { serial: n(transit.json.directory.serial), name: String(transit.json.directory.operator?.name || '').slice(0, 60) };
  if (Array.isArray(partners.json?.partners)) row.partners = partners.json.partners.slice(0, 50).map((entry) => ({ name: String(entry.name || '').slice(0, 60), state: String(entry.state || '').slice(0, 20) }));
  return row;
}

/* ---- a server's lock, over SSH -------------------------------------------- */

export function setLock(server, on, audit) {
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

/* ---- HTTP odds and ends --------------------------------------------------- */

export const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
export const readBody = (req, limit = 1024 * 1024) => new Promise((resolve) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => { size += chunk.length; if (size <= limit) chunks.push(chunk); });
  req.on('end', () => resolve(size > limit ? null : Buffer.concat(chunks)));
  req.on('error', () => resolve(null));
});
export const cookieOf = (req, name) => (String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`)) || '').slice(name.length + 1);
