/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Admission by invitation.
 *
 * Suspension and kicking are deny lists -- everybody is welcome until named.
 * The allowlist is the other way round, and the difference matters because a
 * deny list cannot answer "keep strangers out", only "keep that stranger out".
 *
 * The case this suite exists for is the last one: a peer who generates a new
 * key gets a new fingerprint, and on a deny list that is a way back in. Here
 * it must read as a new stranger. If that check ever goes green by accident,
 * the feature is decorative.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 9399;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'allowlist-suite-password-2026';

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

const fp = (ch) => ch.repeat(64);
const header = (value) => ({ 'X-P00RIJA-Fingerprint': Buffer.from(value, 'utf8').toString('base64') });

async function admin(pathname, body, cookie) {
  const response = await fetch(`${BASE}${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => ({})), raw: response };
}

async function reach(fingerprint) {
  const response = await fetch(`${BASE}/turn-config`, { headers: fingerprint ? header(fingerprint) : {} });
  return response.status;
}

const work = mkdtempSync(join(tmpdir(), 'poorija-allowlist-'));
/* The relay reads this from ./lib because its Dockerfile copies it there;
   running from the source tree has to reproduce that layout. */
const libDir = join(ROOT, 'standalone-relay', 'lib');
const libFile = join(libDir, 'push-wording.js');
const libWasMissing = !existsSync(libFile);
if (libWasMissing) {
  mkdirSync(libDir, { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'lib', 'push-wording.js'), libFile);
}

const relay = spawn(process.execPath, [join(ROOT, 'standalone-relay', 'server.js')], {
  env: {
    ...process.env,
    MONITOR_PASSWORD: PASSWORD,
    CHAT_SIGNAL_PORT: String(PORT),
    CHAT_PRESENCE_PORT: String(PORT + 1),
    CHAT_POLICY_STORE_PATH: join(work, 'policy.json'),
    CHAT_OFFLINE_STORE_PATH: join(work, 'offline.json'),
    CHAT_PUSH_STORE_PATH: join(work, 'push.json'),
  },
  stdio: 'ignore',
});

function cleanup() {
  /* Guarded step by step: a relay still writing its policy file as the
     directory goes makes rmSync throw ENOTEMPTY, and a cleanup failure that
     buries the result is worse than a leftover temp directory. */
  try { relay.kill(); } catch (_error) { /* already gone */ }
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (_error) { /* the OS will reap it */ }
  if (libWasMissing) {
    try { rmSync(libDir, { recursive: true, force: true }); } catch (_error) { /* ignore */ }
  }
}
process.on('exit', cleanup);

async function waitForRelay() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`${BASE}/chat-health`);
      if (response.ok) return true;
    } catch (_error) { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

console.log('\nRelay allowlist');

if (!await waitForRelay()) {
  console.log('  FAIL  the relay did not start');
  process.exit(1);
}

const login = await admin('/admin/login', { password: PASSWORD });
const cookie = (login.raw.headers.get('set-cookie') || '').split(';')[0];
ok(login.json.ok === true, 'the admin can log in');

const empty = await admin('/admin/allowlist', null, cookie);
ok(empty.json.enabled === false, 'an install that never used it starts open');
ok(Array.isArray(empty.json.users) && empty.json.users.length === 0, 'and with nobody on the list');

/* The guard that matters most on a live server: turning the door on with
   nobody behind it locks the admin out of their own relay, and the way back
   in is a text editor over SSH. */
const lockout = await admin('/admin/allowlist-mode', { enabled: true }, cookie);
ok(lockout.status === 400 && lockout.json.ok === false,
  'closing the door on an empty list is refused, rather than locking the admin out');

await admin('/admin/allowlist-add', { fingerprint: fp('a'), label: 'laptop' }, cookie);
const enabled = await admin('/admin/allowlist-mode', { enabled: true }, cookie);
ok(enabled.json.ok === true && enabled.json.enabled === true, 'with somebody on it, the door closes');

ok(await reach(fp('a')) === 200, 'an invited fingerprint is admitted');
ok(await reach(fp('b')) === 403, 'a stranger is refused');
ok(await reach(null) === 403, 'a caller with no identity is refused');

/* The whole reason this is an allowlist and not another deny list. */
ok(await reach(fp('c')) === 403, 'a freshly generated key is a new stranger, not a way around the door');

const removed = await admin('/admin/allowlist-remove', { fingerprint: fp('a') }, cookie);
ok(removed.json.ok === true, 'somebody can be taken back off the list');
ok(await reach(fp('a')) === 403, 'and is refused from the next connection on');

const reopened = await admin('/admin/allowlist-mode', { enabled: false }, cookie);
ok(reopened.json.enabled === false, 'the door can be opened again');
ok(await reach(fp('b')) === 200, 'and then the same stranger is welcome');

console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}\n`);
process.exit(failures ? 1 : 0);
