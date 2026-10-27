/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The central panel (tools/panel/server.mjs) run for a suite: its own
 * config, state and home folders, a stand-in `ssh` that never leaves this
 * machine (each call written to calls.log, answering as $FAKE_SSH says),
 * a login made for it, and a clock the suite can move forward so each
 * single-use authenticator code can be followed by the next without waiting.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const login = await import(pathToFileURL(path.join(ROOT, 'tools/panel/login.mjs')));
export const PASSWORD = 'A-long-enough-password-42';

/* Its answer comes from files the suite can change between calls: the mode
   (denied, script, or anything else to stay up like a tunnel) and, in
   script mode, what it prints. */
const STAND_IN_SSH = `#!/bin/sh
echo "$*" >> "$FAKE_SSH_LOG"
mode="$(cat "$FAKE_SSH_MODE_FILE" 2>/dev/null || echo denied)"
case "$mode" in
  denied) echo "op@relay.example: Permission denied (publickey,password)." >&2; exit 255 ;;
  script) cat > "$FAKE_SSH_LOG.stdin"; cat "$FAKE_SSH_OUT_FILE" 2>/dev/null; exit 0 ;;
  *) exec sleep 30 ;;
esac
`;

export const DEPLOY_CONF = `# a deploy.conf for a suite
SERVERS='a'
A_SSH_HOST='a.example'
A_SSH_USER='op'
A_SSH_KEY='~/.ssh/deploy_key'
A_PUBLIC_URL='https://a.example:8585'
`;

export async function startPanel({ conf = DEPLOY_CONF, env = {}, username = 'op' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-panel-run-'));
  const dirs = { root, bin: path.join(root, 'bin'), home: path.join(root, 'home'), config: path.join(root, 'config'), state: path.join(root, 'state') };
  for (const dir of [dirs.bin, dirs.home, dirs.config, dirs.state, path.join(dirs.home, '.ssh')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dirs.bin, 'ssh'), STAND_IN_SSH, { mode: 0o755 });
  fs.writeFileSync(path.join(dirs.home, '.ssh/deploy_key'), 'key', { mode: 0o600 });
  if (conf !== null) fs.writeFileSync(path.join(dirs.config, 'deploy.conf'), conf);
  const record = login.makeLogin({ username, password: PASSWORD });
  fs.writeFileSync(path.join(dirs.state, 'control-panel-login.json'), JSON.stringify(record), { mode: 0o600 });
  const clockFile = path.join(root, 'clock');
  fs.writeFileSync(clockFile, '0');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const panel = {
    dirs, port, record, clockFile, out: '', child: null,
    calls: () => (fs.existsSync(path.join(root, 'calls.log')) ? fs.readFileSync(path.join(root, 'calls.log'), 'utf8').split('\n').filter(Boolean) : []),
    audit: () => (fs.existsSync(path.join(dirs.state, 'control-panel.log')) ? fs.readFileSync(path.join(dirs.state, 'control-panel.log'), 'utf8') : ''),
  };
  const baseEnv = {
    ...process.env,
    PATH: `${dirs.bin}:${process.env.PATH}`,
    HOME: dirs.home,
    FAKE_SSH_LOG: path.join(root, 'calls.log'),
    FAKE_SSH_MODE_FILE: path.join(root, 'ssh-mode'),
    FAKE_SSH_OUT_FILE: path.join(root, 'ssh-out'),
    POORIJA_CONFIG_DIR: dirs.config,
    POORIJA_PANEL_STATE_DIR: dirs.state,
    POORIJA_PANEL_PORT: String(port),
    POORIJA_PANEL_CONF_POLL_MS: '300',
    POORIJA_PANEL_RETRY_MS: '300',
    POORIJA_PANEL_CLOCK_FILE: clockFile,
    ...env,
  };
  panel.ssh = (mode, out = '') => {
    fs.writeFileSync(path.join(root, 'ssh-mode'), mode);
    fs.writeFileSync(path.join(root, 'ssh-out'), out);
  };
  panel.lastInput = () => (fs.existsSync(path.join(root, 'calls.log.stdin')) ? fs.readFileSync(path.join(root, 'calls.log.stdin'), 'utf8') : '');
  panel.ssh('denied');
  panel.start = async () => {
    panel.out = '';
    panel.child = spawn(process.execPath, ['tools/panel/server.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: baseEnv });
    panel.child.stdout.on('data', (chunk) => { panel.out += chunk; });
    panel.child.stderr.on('data', (chunk) => { panel.out += chunk; });
    for (let i = 0; i < 100 && !/panel: http/.test(panel.out); i += 1) {
      if (panel.child.exitCode !== null) throw new Error(`the panel stopped: ${panel.out.slice(-500)}`);
      await sleep(100);
    }
  };
  panel.stop = async () => {
    if (!panel.child || panel.child.exitCode !== null) return;
    const done = new Promise((resolve) => panel.child.once('exit', resolve));
    panel.child.kill('SIGTERM');
    await done;
  };
  panel.cleanup = async () => { await panel.stop(); fs.rmSync(root, { recursive: true, force: true }); };
  /* The next code the panel will take: its clock moved one step on each call. */
  let offset = 0;
  panel.code = (secret = panel.record.totp) => {
    offset += 30000;
    fs.writeFileSync(clockFile, String(offset));
    return login.totp(secret, Math.floor((Date.now() + offset) / 30000));
  };
  panel.request = (route, { method = 'GET', body, cookie, raw = false } = {}) => new Promise((resolve) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers: { Host: `127.0.0.1:${port}`, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_error) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: raw ? text : undefined });
      });
    });
    req.on('error', (error) => resolve({ status: 0, json: { error: error.message } }));
    req.end(payload || undefined);
  });
  panel.signIn = async (password = PASSWORD, secret = panel.record.totp) => {
    const answer = await panel.request('/api/login', { method: 'POST', body: { username, password, code: panel.code(secret) } });
    return { ...answer, cookie: String(answer.headers?.['set-cookie']?.[0] || '').split(';')[0] };
  };
  await panel.start();
  return panel;
}
