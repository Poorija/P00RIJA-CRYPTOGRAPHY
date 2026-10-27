/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A relay started with no monitor password — the ready-made Docker install
 * sets none — makes a random one on its first start, keeps only its hash, and
 * shows it once: a banner on stdout and a 0600 file beside server-config.json
 * that the installer reads. It is never up with a password anyone else knows,
 * a restart does not make another, a change from the dashboard removes the
 * file, and a relay given MONITOR_PASSWORD behaves as it always has.
 *
 *   node tests/e2e/firstpassword.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createFleet, fetchJson } from './_relay-fleet.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const basic = (password) => ({ Authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}` });
const BANNER = /Monitor password \(first start\): ([A-Za-z0-9]{20})\b/;

const fleet = await createFleet(['fresh', 'given'], { env: { fresh: { MONITOR_PASSWORD: '', CHAT_ENV_FILE: 'none' }, given: { MONITOR_PASSWORD: 'Env-Password-Long-77', CHAT_ENV_FILE: 'none' } } });
try {
  const fresh = await fleet.start('fresh');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const shown = (BANNER.exec(fresh.output) || [])[1] || '';
  check('a relay with no password prints one random 20-character password', Boolean(shown), shown ? 'shown' : fresh.output.slice(-300));
  const file = path.join(fresh.dir, 'initial-monitor-password');
  const stat = fs.existsSync(file) ? fs.statSync(file) : null;
  check('and writes it to initial-monitor-password, readable by its owner only',
    stat && (stat.mode & 0o777) === 0o600 && fs.readFileSync(file, 'utf8').trim() === shown, stat ? (stat.mode & 0o777).toString(8) : 'no file');
  const config = fs.existsSync(path.join(fresh.dir, 'server-config.json')) ? fs.readFileSync(path.join(fresh.dir, 'server-config.json'), 'utf8') : '';
  check('server-config.json keeps only its hash', config.includes('monitorPasswordHash') && Boolean(shown) && !config.includes(shown));
  const ok = await fetchJson(`${fresh.origin}/healthz`, { headers: basic(shown) });
  const wrong = await fetchJson(`${fresh.origin}/healthz`, { headers: basic('Not-The-Password-123') });
  check('that password opens the dashboard and another does not', ok.status === 200 && wrong.status === 401, `${ok.status}/${wrong.status}`);

  await fleet.stop('fresh');
  const again = await fleet.start('fresh');
  await new Promise((resolve) => setTimeout(resolve, 300));
  check('a restart makes no new password and prints none', !BANNER.test(again.output), BANNER.test(again.output) ? 'printed again' : '');
  const still = await fetchJson(`${again.origin}/healthz`, { headers: basic(shown) });
  check('and the first one still opens the dashboard', still.status === 200, String(still.status));

  const changed = await fetchJson(`${again.origin}/admin/change-password`, {
    method: 'POST', headers: basic(shown), body: { currentPassword: shown, newPassword: 'A-new-long-pass-42' },
  });
  check('changing it from the dashboard works', changed.status === 200, JSON.stringify(changed).slice(0, 120));
  check('and removes the file with the first password', !fs.existsSync(file));
  const after = await fetchJson(`${again.origin}/healthz`, { headers: basic('A-new-long-pass-42') });
  check('the new password opens the dashboard', after.status === 200, String(after.status));

  const given = await fleet.start('given');
  await new Promise((resolve) => setTimeout(resolve, 300));
  check('a relay given MONITOR_PASSWORD prints no password and writes no file',
    !BANNER.test(given.output) && !fs.existsSync(path.join(given.dir, 'initial-monitor-password')));
  const env = await fetchJson(`${given.origin}/healthz`, { headers: basic('Env-Password-Long-77') });
  check('and its own password works as before', env.status === 200, String(env.status));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await fleet.stopAll?.();
  for (const name of ['fresh', 'given']) {
    try { await fleet.stop(name); } catch (_error) { /* already down */ }
    fs.rmSync(fleet.relays[name].dir, { recursive: true, force: true });
  }
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
