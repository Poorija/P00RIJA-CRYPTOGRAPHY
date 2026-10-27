/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* How the central panel reaches its servers over SSH (tools/panel/core.mjs).
 *
 * In its container the panel showed every server unreachable: deploy.conf
 * names keys by the host's path (/Users/<name>/.ssh/...), which does not exist
 * inside, and every tunnel then failed to authenticate and was tried again,
 * forever — a stream of failed logins at servers that lock an address out
 * after a few. A stand-in `ssh` stands for every server here: nothing leaves
 * this machine.
 *
 *   node tests/e2e/panelconnect.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dirs = [];
const tmp = (label) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), `poorija-connect-${label}-`)); dirs.push(dir); return dir; };

/* A stand-in ssh: it writes each call to calls.log and answers as $FAKE_SSH says. */
const bin = tmp('bin');
fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh
echo "$*" >> "$FAKE_SSH_LOG"
case "$FAKE_SSH" in
  denied) echo "pooriya@relay.example: Permission denied (publickey,password)." >&2; exit 255 ;;
  timeout) echo "ssh: connect to host relay.example port 22: Operation timed out" >&2; exit 255 ;;
  *) exec sleep 30 ;;
esac
`, { mode: 0o755 });
process.env.PATH = `${bin}:${process.env.PATH}`;
process.env.POORIJA_PANEL_RETRY_MS = '300';
const calls = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);

const core = await import(pathToFileURL(path.join(ROOT, 'tools/panel/core.mjs')));
try {
  /* ---- the key, wherever deploy.conf says it is --------------------------- */
  const home = tmp('home');
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh/deploy_key'), 'key');
  check('a key under ~ is found in this home', core.resolveKeyPath('~/.ssh/deploy_key', { home }) === path.join(home, '.ssh/deploy_key'));
  check('a key named by the host’s own path is found in the copy of that folder',
    core.resolveKeyPath('/Users/someone/.ssh/deploy_key', { home, hostSshDir: '/Users/someone/.ssh' }) === path.join(home, '.ssh/deploy_key'));
  check('and by its name alone when the host folder is not known',
    core.resolveKeyPath('/Users/someone/.ssh/deploy_key', { home }) === path.join(home, '.ssh/deploy_key'));
  check('a key that is nowhere stays as written, to be reported missing',
    core.resolveKeyPath('/Users/someone/.ssh/absent_key', { home }) === '/Users/someone/.ssh/absent_key');

  /* ---- deploy.conf, jumps included ---------------------------------------- */
  const conf = tmp('conf');
  const write = (servers, extra = '') => fs.writeFileSync(path.join(conf, 'deploy.conf'), `SERVERS='${servers}'
A_SSH_HOST='a.example'
A_SSH_USER='op'
A_SSH_KEY='~/.ssh/deploy_key'
A_PUBLIC_URL='https://a.example:8585'
B_SSH_HOST='b.example'
B_SSH_USER='op'
B_SSH_PORT='2420'
B_SSH_KEY='~/.ssh/deploy_key'
B_JUMP='a'
${extra}`);
  write('a b');
  const servers = core.loadServers(conf, { home });
  const b = servers.find((server) => server.name === 'b');
  check('a server behind a jump knows the server it goes through', b?.ssh.jump?.host === 'a.example' && b.ssh.jump.user === 'op', JSON.stringify(b?.ssh.jump || null));
  const args = core.sshArgs(b.ssh).join(' ');
  check('and its ssh goes through that server', args.includes(`ProxyCommand=ssh -p 22 -o BatchMode=yes -i '${path.join(home, '.ssh/deploy_key')}' -o IdentitiesOnly=yes op@a.example -W %h:%p`), args);

  /* ---- a refused key is tried once ---------------------------------------- */
  const deniedLog = path.join(tmp('log'), 'calls.log');
  process.env.FAKE_SSH_LOG = deniedLog;
  process.env.FAKE_SSH = 'denied';
  const refused = { name: 'a', ssh: { ...servers[0].ssh } };
  await core.openTunnel(refused);
  await sleep(2500);
  check('a server that refuses the key is asked once, not again and again', calls(deniedLog).length === 1, `${calls(deniedLog).length} attempts`);
  check('and says why', refused.sshState === 'auth-failed' && /Permission denied/.test(refused.sshReason || ''), `${refused.sshState} ${refused.sshReason}`);
  core.disconnect([refused]);

  /* ---- a missing key is not tried at all ---------------------------------- */
  const missingLog = path.join(tmp('log'), 'calls.log');
  process.env.FAKE_SSH_LOG = missingLog;
  const noKey = { name: 'x', ssh: { ...servers[0].ssh, key: '/nowhere/absent_key' } };
  await core.openTunnel(noKey);
  await sleep(500);
  check('a key file that is not there is reported, and no login is attempted', calls(missingLog).length === 0 && noKey.sshState === 'key-missing', `${calls(missingLog).length} attempts, ${noKey.sshState}`);
  core.disconnect([noKey]);

  /* ---- a network that does not answer is tried again ---------------------- */
  const slowLog = path.join(tmp('log'), 'calls.log');
  process.env.FAKE_SSH_LOG = slowLog;
  process.env.FAKE_SSH = 'timeout';
  const away = { name: 'a', ssh: { ...servers[0].ssh } };
  await core.openTunnel(away);
  await sleep(2500);
  check('a server that does not answer is tried again, further apart', calls(slowLog).length >= 2 && away.sshState === 'retrying', `${calls(slowLog).length} attempts, ${away.sshState}`);
  core.disconnect([away]);

  /* ---- the list follows deploy.conf --------------------------------------- */
  const state = tmp('state');
  const login = await import(pathToFileURL(path.join(ROOT, 'tools/panel/login.mjs')));
  const record = login.makeLogin({ username: 'check', password: 'a long enough check password' });
  fs.writeFileSync(path.join(state, 'control-panel-login.json'), JSON.stringify(record), { mode: 0o600 });
  process.env.FAKE_SSH = 'denied';
  process.env.FAKE_SSH_LOG = path.join(state, 'calls.log');
  write('a');
  const port = 18000 + (process.pid % 1000);
  const panel = spawn(process.execPath, ['tools/panel/server.mjs'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home, POORIJA_CONFIG_DIR: conf, POORIJA_PANEL_STATE_DIR: state, POORIJA_PANEL_PORT: String(port), POORIJA_PANEL_CONF_POLL_MS: '300' },
  });
  let out = '';
  panel.stdout.on('data', (chunk) => { out += chunk; });
  panel.stderr.on('data', (chunk) => { out += chunk; });
  const request = (route, { method = 'GET', body, cookie } = {}) => new Promise((resolve) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers: { Host: `127.0.0.1:${port}`, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (_e) { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
    });
    req.on('error', (error) => resolve({ status: 0, json: { error: error.message } }));
    req.end(payload || undefined);
  });
  for (let i = 0; i < 60 && !/panel: http/.test(out); i += 1) await sleep(200);
  const signed = await request('/api/login', { method: 'POST', body: { username: 'check', password: 'a long enough check password', code: login.totp(record.totp, Math.floor(Date.now() / 30000)) } });
  const cookie = String(signed.headers?.['set-cookie']?.[0] || '').split(';')[0];
  const first = await request('/api/servers', { cookie });
  check('the panel lists the servers in deploy.conf', first.json?.servers?.map((server) => server.name).join() === 'a', JSON.stringify(first.json || out.slice(-300)).slice(0, 200));
  check('with the reason a server cannot be reached', first.json?.servers?.[0]?.problem === 'auth-failed', JSON.stringify(first.json?.servers?.[0] || {}).slice(0, 200));
  write('a b');
  await sleep(1500);
  const second = await request('/api/servers', { cookie });
  check('a server added to deploy.conf appears without a restart', second.json?.servers?.map((server) => server.name).join() === 'a,b', JSON.stringify(second.json?.servers?.map((server) => server.name) || []));
  write('b');
  await sleep(1500);
  const third = await request('/api/servers', { cookie });
  check('and one removed disappears', third.json?.servers?.map((server) => server.name).join() === 'b', JSON.stringify(third.json?.servers?.map((server) => server.name) || []));
  const before = calls(process.env.FAKE_SSH_LOG).length;
  const again = await request('/api/reconnect', { method: 'POST', body: { server: 'b' }, cookie });
  await sleep(800);
  check('a server can be asked to connect again, once', again.json?.ok === true && calls(process.env.FAKE_SSH_LOG).length === before + 1, `${again.status} ${calls(process.env.FAKE_SSH_LOG).length - before} attempt(s)`);
  panel.kill('SIGTERM');
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
