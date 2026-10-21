/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The dashboard's server tools — backups and disk cleanup — against a Docker
 * Engine that is ours.
 *
 * The relay drives Docker through its socket: a backup, a restore, a rollback
 * or a listing is a short job container that sees the install at /job and the
 * backups at /backups. Here the socket is answered by this file. A job's
 * command really runs, with every path it was given as a bind pointed at the
 * host directory the bind names, so a backup is a real archive and a restore
 * really overlays the tree; the images and containers are a fixed little
 * machine.
 *
 *   - the newest two backups are kept, whichever path made the others;
 *   - deleting one from the dashboard deletes the file, and the list says so;
 *   - a restore puts the files back and keeps the backup it came from;
 *   - "roll back" with no name takes the newest backup (it never found one);
 *   - a backup downloads whole, and so does the clean bundle — both used to
 *     be handed over from a directory the relay does not read;
 *   - an image a container is made from is never offered or removed, and the
 *     "dangling" button removes dangling layers — not every unused image.
 *
 *   node tests/e2e/opspanel.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PASSWORD = 'opspanel-suite-pw-123456';
const PORT = 9861;
const RELAY = `http://127.0.0.1:${PORT}`;
const AUTH = 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-opspanel-'));
const jobDir = path.join(dir, 'install');
const backupDir = path.join(dir, 'host-backups');
const socketPath = path.join(dir, 'docker.sock');
fs.mkdirSync(path.join(jobDir, 'data'), { recursive: true });
fs.mkdirSync(backupDir);
fs.writeFileSync(path.join(jobDir, 'index.html'), '<!doctype html><title>install</title>');
fs.writeFileSync(path.join(jobDir, 'marker.txt'), 'first');
fs.writeFileSync(path.join(jobDir, '.env'), 'MONITOR_PASSWORD=not-for-the-bundle');
fs.writeFileSync(path.join(jobDir, 'data', 'mailbox.json'), '{}');
/* This relay's own data directory when it runs outside a container — where
   a job hands it a file (the relay reads what lands here). */
const relayDataDir = path.join(ROOT, 'data', 'chat-signal');
fs.mkdirSync(relayDataDir, { recursive: true });
const handOffs = () => fs.readdirSync(relayDataDir).filter((name) => name.startsWith('.monitor-'));

/* ---- the machine ------------------------------------------------------------ */

const APP_VERSION = '2.98.71';
const images = [
  { Id: 'sha256:current', RepoTags: [`poorija-crypto:${APP_VERSION}`], Size: 300, Containers: -1 },
  /* An older build a stopped container is still made from. */
  { Id: 'sha256:rollback', RepoTags: ['poorija-crypto:2.98.70'], Size: 100, Containers: -1 },
  { Id: 'sha256:stale', RepoTags: ['poorija-crypto:2.98.60'], Size: 200, Containers: -1 },
  { Id: 'sha256:dangling', RepoTags: [], Size: 50, Containers: -1 },
  /* The base image the next build needs; nothing runs from it right now. */
  { Id: 'sha256:base', RepoTags: ['node:26.12.0-alpine'], Size: 400, Containers: -1 },
];
const containers = [
  { Id: 'app', ImageID: 'sha256:current', State: 'running' },
  { Id: 'old', ImageID: 'sha256:rollback', State: 'exited' },
];
const jobs = new Map();
const engineLog = { prunes: [], deleted: [] };

/* Each bind's container path, wherever a job's command names it as a path,
   becomes the host directory the bind gives — as the engine would see it. */
const mapPath = (value, binds) => {
  let mapped = String(value);
  for (const bind of binds) {
    const [host, inside] = String(bind).split(':');
    const name = inside.replace(/^\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    mapped = mapped.replace(new RegExp(`(^|[\\s'"=(])\\/${name}(?=\\/|\\s|'|"|$)`, 'g'), (_all, lead) => `${lead}${host}`);
  }
  return mapped;
};
const findImage = (ref) => images.find((image) => image.Id === ref || image.RepoTags.includes(ref));
const usedIds = () => new Set(containers.map((container) => container.ImageID));

const engine = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://docker');
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const route = `${req.method} ${url.pathname.replace(/^\/v[\d.]+/, '')}`;
    let match;
    if (route === 'GET /images/json') return send(200, images);
    if (route === 'GET /containers/json') {
      return send(200, url.searchParams.get('all') ? containers : containers.filter((container) => container.State === 'running'));
    }
    if ((match = /^GET \/images\/(.+)\/json$/.exec(route))) {
      const image = findImage(decodeURIComponent(match[1]));
      /* An inspection carries no container count at all, as the real one. */
      return image ? send(200, { Id: image.Id, RepoTags: image.RepoTags, Size: image.Size }) : send(404, { message: 'No such image' });
    }
    if ((match = /^DELETE \/images\/(.+)$/.exec(route))) {
      const ref = decodeURIComponent(match[1]);
      const image = findImage(ref);
      if (!image) return send(404, { message: 'No such image' });
      if (usedIds().has(image.Id) && url.searchParams.get('force') !== '1') return send(409, { message: 'image is being used' });
      engineLog.deleted.push(ref);
      images.splice(images.indexOf(image), 1);
      return send(200, [{ Deleted: image.Id }]);
    }
    if (route === 'POST /images/prune') {
      const filters = JSON.parse(url.searchParams.get('filters') || '{}');
      engineLog.prunes.push(filters);
      /* As the engine reads it: the keys under "dangling", not the values. */
      const onlyDangling = Object.keys(filters.dangling || { true: true }).includes('true');
      let reclaimed = 0;
      for (const image of [...images]) {
        if (usedIds().has(image.Id)) continue;
        if (onlyDangling && image.RepoTags.length) continue;
        reclaimed += image.Size;
        images.splice(images.indexOf(image), 1);
      }
      return send(200, { SpaceReclaimed: reclaimed, SizeReclaimed: reclaimed });
    }
    if (route === 'POST /containers/create') {
      const body = JSON.parse(raw || '{}');
      const id = `job-${jobs.size + 1}`;
      jobs.set(id, { cmd: body.Cmd || [], binds: body.HostConfig?.Binds || [], exitCode: null, output: '' });
      return send(201, { Id: id });
    }
    if ((match = /^POST \/containers\/([^/]+)\/start$/.exec(route))) {
      const job = jobs.get(match[1]);
      if (!job) return send(404, { message: 'No such container' });
      const [file, ...args] = job.cmd.map((part) => mapPath(part, job.binds));
      const run = spawnSync(file, args, { cwd: jobDir, encoding: 'utf8' });
      job.exitCode = run.status ?? 1;
      job.output = `${run.stdout || ''}${run.stderr || ''}`;
      return send(204);
    }
    if ((match = /^GET \/containers\/([^/]+)\/json$/.exec(route))) {
      const job = jobs.get(match[1]);
      return job ? send(200, { State: { Status: 'exited', ExitCode: job.exitCode } }) : send(404, { message: 'No such container' });
    }
    if ((match = /^GET \/containers\/([^/]+)\/logs$/.exec(route))) {
      const job = jobs.get(match[1]);
      const payload = Buffer.from(job?.output || '');
      const header = Buffer.alloc(8);
      header[0] = 1;
      header.writeUInt32BE(payload.length, 4);
      res.writeHead(200, { 'Content-Type': 'application/vnd.docker.raw-stream' });
      return res.end(Buffer.concat([header, payload]));
    }
    if ((match = /^DELETE \/containers\/([^/]+)$/.exec(route))) {
      jobs.delete(match[1]);
      return send(204);
    }
    return send(404, { message: `not in this engine: ${route}` });
  });
});
await new Promise((resolve) => engine.listen(socketPath, resolve));

/* ---- the relay --------------------------------------------------------------- */

const relay = spawn(process.execPath, ['scripts/server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    MONITOR_PASSWORD: PASSWORD,
    APP_VERSION,
    CHAT_SIGNAL_PORT: String(PORT),
    CHAT_PRESENCE_PORT: String(PORT + 1),
    CHAT_BOOTSTRAP_PORT: String(PORT + 2),
    CHAT_OFFLINE_STORE_PATH: path.join(dir, 'offline-messages.json'),
    CHAT_OFFLINE_STORE_DIR: path.join(dir, 'mailboxes'),
    CHAT_PUSH_STORE_PATH: path.join(dir, 'push.json'),
    CHAT_VAPID_STORE_PATH: path.join(dir, 'vapid.json'),
    CHAT_POLICY_STORE_PATH: path.join(dir, 'policy.json'),
    CHAT_EXPIRY_LOG_PATH: path.join(dir, 'expiry.json'),
    CHAT_SELF_DESTRUCT_STORE_PATH: path.join(dir, 'self-destruct.json'),
    OPS_DOCKER_SOCKET: socketPath,
    OPS_INSTALL_DIR: jobDir,
    OPS_BACKUP_DIR: backupDir,
    OPS_DATA_DIR: relayDataDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const relayLog = [];
relay.stdout.on('data', (chunk) => relayLog.push(String(chunk)));
relay.stderr.on('data', (chunk) => relayLog.push(String(chunk)));

const ops = async (name, body = {}) => {
  const response = await fetch(`${RELAY}/Monitor_Server/${name}`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json().catch(() => ({ ok: false, status: response.status }));
};
const onDisk = () => fs.readdirSync(backupDir).filter((name) => /^server-backup_.+\.tar\.gz$/.test(name)).sort();
const listed = async () => ((await ops('ops-backup-list')).backups || []).map((row) => row.name).sort();
/* Backup names carry the time to the second. */
const create = async () => { await sleep(1100); return ops('ops-backup-create'); };
const download = async (name, body = {}) => {
  const response = await fetch(`${RELAY}/Monitor_Server/${name}`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
};

let exitCode = 1;
try {
  let up = false;
  for (let attempt = 0; attempt < 80 && !up; attempt += 1) {
    try { up = (await fetch(`${RELAY}/chat-health`)).ok; } catch (_error) { await sleep(250); }
  }
  if (!up) throw new Error(`the relay never started\n${relayLog.join('').slice(-1500)}`);

  section('backups: the newest two are kept');
  const made = [];
  for (let index = 0; index < 3; index += 1) made.push((await create()).name);
  check('each backup made from the dashboard is a real archive', made.every(Boolean) && onDisk().length > 0, JSON.stringify(made));
  const afterThree = onDisk();
  check('three made, the newest two kept', afterThree.length === 2 && afterThree.join() === made.slice(1).sort().join(), afterThree.join(', '));
  check('and the dashboard lists exactly what is on the disk', (await listed()).join() === afterThree.join(), (await listed()).join(', '));

  section('deleting one from the dashboard');
  const removed = await ops('ops-backup-delete', { name: afterThree[0] });
  check('the dashboard says it is deleted', removed.ok === true, JSON.stringify(removed));
  check('the file is gone from the disk', !onDisk().includes(afterThree[0]), onDisk().join(', '));
  check('and from the dashboard\'s list', !(await listed()).includes(afterThree[0]) && (await listed()).length === 1, (await listed()).join(', '));
  const refused = await ops('ops-backup-delete', { name: '../../etc/passwd' });
  check('a name that is not a backup is refused', refused.ok !== true, JSON.stringify(refused));

  section('downloads');
  const kept = onDisk()[0];
  const fetched = await download('ops-backup-download', { name: kept });
  const original = fs.readFileSync(path.join(backupDir, kept));
  check('a backup downloads whole, byte for byte', fetched.status === 200 && fetched.bytes.length > 0 && fetched.bytes.equals(original), `${fetched.status}, ${fetched.bytes.length} of ${original.length} bytes`);
  const bundle = await download('ops-bundle');
  const bundlePath = path.join(dir, 'bundle.tar.gz');
  fs.writeFileSync(bundlePath, bundle.bytes);
  const inside = spawnSync('tar', ['-tzf', bundlePath], { encoding: 'utf8' }).stdout.split('\n').map((line) => line.replace(/^\.\//, '')).filter(Boolean);
  check('the clean bundle downloads, with the program in it', bundle.status === 200 && inside.includes('index.html'), `${bundle.status}, ${bundle.bytes.length} bytes, ${inside.length} entries`);
  check('and none of this machine\'s own: no data, no .env', !inside.some((entry) => entry === '.env' || entry.startsWith('data/')), inside.join(', '));
  await sleep(300);
  check('nothing handed over is left behind', handOffs().length === 0, handOffs().join(', '));

  section('a restore puts the files back and keeps its backup');
  const older = onDisk()[0];
  fs.writeFileSync(path.join(jobDir, 'marker.txt'), 'second');
  /* One more: the older one is now the oldest of the two, the first to go
     when the safety copy is taken — unless the restore keeps it. */
  await create();
  await sleep(1100);
  const restored = await ops('ops-backup-restore', { name: older });
  const marker = fs.readFileSync(path.join(jobDir, 'marker.txt'), 'utf8');
  check('the tree is back as it was in that backup', restored.ok === true && marker === 'first', `${JSON.stringify(restored)} marker=${marker}`);
  check('the backup it came from is still there', onDisk().includes(older), onDisk().join(', '));
  check('and the safety copy taken first is kept', Boolean(restored.safetyBackup) && onDisk().includes(restored.safetyBackup), restored.safetyBackup);
  check('nothing piles up past the newest two and the one restored', onDisk().length <= 3, `${onDisk().length}: ${onDisk().join(', ')}`);

  section('"roll back" with no name');
  await sleep(1100);
  const newest = onDisk().slice(-1)[0];
  const rolled = await ops('ops-github-rollback', {});
  check('it finds the newest backup and restores it', rolled.ok === true && rolled.restored === newest, JSON.stringify(rolled));
  check('and the backups stay within the newest two and that one', onDisk().length <= 3, `${onDisk().length}: ${onDisk().join(', ')}`);

  section('disk cleanup');
  const disk = await ops('ops-disk');
  const staleRefs = (disk.cleanup?.staleSelfImages || []).map((image) => image.ref);
  check('an old build of ours that nothing runs is offered', staleRefs.includes('poorija-crypto:2.98.60'), staleRefs.join(', '));
  check('an old build a container is made from is not', !staleRefs.includes('poorija-crypto:2.98.70'), staleRefs.join(', '));
  check('nor this build', !staleRefs.includes(`poorija-crypto:${APP_VERSION}`), staleRefs.join(', '));
  const chosen = await ops('ops-cleanup', { what: 'selected', refs: ['poorija-crypto:2.98.70', 'poorija-crypto:2.98.60'] });
  check('ticking both removes only the one nothing uses', (chosen.removed || []).join() === 'poorija-crypto:2.98.60' && Boolean(findImage('poorija-crypto:2.98.70')), JSON.stringify(chosen.removed));
  const pruned = await ops('ops-cleanup', { what: 'dangling' });
  const asked = engineLog.prunes.slice(-1)[0] || {};
  check('the dangling button asks the engine for dangling layers only', Object.keys(asked.dangling || {}).join() === 'true', JSON.stringify(asked));
  check('the untagged layer is gone, the base image the next build needs is not', !findImage('sha256:dangling') && Boolean(findImage('node:26.12.0-alpine')), `${pruned.freedBytes} bytes freed; left ${images.map((image) => image.RepoTags[0] || image.Id).join(', ')}`);

  exitCode = results.every((result) => result.ok) ? 0 : 1;
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  /* Gone before its directory is: it writes its stores there to the last. */
  const exited = new Promise((resolve) => { relay.once('exit', resolve); setTimeout(resolve, 5000); });
  relay.kill();
  await exited;
  engine.close();
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n===== ${failed} failed of ${results.length} =====`);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.exit(failed ? 1 : exitCode);
}
