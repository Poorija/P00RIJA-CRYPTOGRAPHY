/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Servers managed from the panel: deploy.conf edited by tools/panel/deployconf.mjs
 * (comments kept, read back the same by bash and by the panel, a backup
 * before every write), a connection test that is one SSH login, add, edit
 * and remove with a confirming code, and the stack installed over SSH as a
 * job whose output reaches the page but never the audit log.
 *
 *   node tests/e2e/panelservers.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { startPanel, sleep, ROOT } from './_panel-run.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const { parseDeployConf } = await import(pathToFileURL(path.join(ROOT, 'tools/relay-directory.mjs')));

/* ---- the editor --------------------------------------------------------- */
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-deployconf-'));
try {
  const conf = await import(pathToFileURL(path.join(ROOT, 'tools/panel/deployconf.mjs')));
  const original = `# P00RIJA deploy settings
# keep this comment
SERVERS='a'
A_SSH_HOST='a.example'
A_SSH_USER='op'
# a note about a
A_REGION='outside-iran'
UNRELATED_SETTING='kept'
`;
  const added = conf.setServer(original, 'b', { SSH_HOST: 'b.example', SSH_USER: 'op', SSH_PORT: '2222', SSH_KEY: '~/.ssh/k', PUBLIC_URL: 'https://b.example:8585', REGION: 'inside-iran' });
  const parsed = parseDeployConf(added);
  check('a server is added with its fields', parsed.servers.join(' ') === 'a b' && parsed.fields('b', 'SSH_HOST') === 'b.example' && parsed.fields('b', 'SSH_PORT') === '2222');
  check('and everything else stays as it was', added.includes('# keep this comment') && added.includes('# a note about a') && added.includes("UNRELATED_SETTING='kept'") && parseDeployConf(added).fields('a', 'REGION') === 'outside-iran');
  const replaced = conf.setServer(added, 'a', { SSH_HOST: 'a2.example', SSH_USER: 'op' });
  check('a server set again replaces its fields, once', (replaced.match(/^A_SSH_HOST=/gm) || []).length === 1 && parseDeployConf(replaced).fields('a', 'SSH_HOST') === 'a2.example' && !parseDeployConf(replaced).fields('a', 'REGION'));
  const removed = conf.removeServer(added, 'a');
  check('a server removed takes its lines and its place in SERVERS', parseDeployConf(removed).servers.join(' ') === 'b' && !/^A_/m.test(removed) && removed.includes("UNRELATED_SETTING='kept'"));
  const clustered = conf.setField(added, 'b', 'CLUSTER', 'Iran');
  check('one field can be set', parseDeployConf(clustered).fields('b', 'CLUSTER') === 'Iran');
  check('and an empty value removes it', !/^B_CLUSTER=/m.test(conf.setField(clustered, 'b', 'CLUSTER', '')));
  const tricky = conf.setServer(original, 'c', { SSH_HOST: 'c.example', REMOTE_DIR: '/srv/my dir/$HOME/back\\slash' });
  fs.writeFileSync(path.join(scratch, 'deploy.conf'), tricky);
  const sourced = spawnSync('bash', ['-c', 'set -a; . ./deploy.conf; printf %s "$C_REMOTE_DIR"'], { cwd: scratch, encoding: 'utf8' }).stdout;
  check('bash reads back exactly what was written, spaces, $ and \\ included', sourced === '/srv/my dir/$HOME/back\\slash' && parseDeployConf(tricky).fields('c', 'REMOTE_DIR') === sourced, JSON.stringify(sourced));
  let quoteRefused = false;
  try { conf.setServer(original, 'd', { SSH_HOST: "d'; rm -rf ~; '" }); } catch (_error) { quoteRefused = true; }
  let lineRefused = false;
  try { conf.setServer(original, 'd', { SSH_HOST: 'd.example\nEVIL=1' }); } catch (_error) { lineRefused = true; }
  check('a value with a quote or a new line is refused', quoteRefused && lineRefused);
  check('names are short, lower case, start with a letter', conf.validName('ir5') && !conf.validName('IR5') && !conf.validName('5ir') && !conf.validName('a-b') && !conf.validName('abcdefghijklm') && !conf.validName(''));
  fs.writeFileSync(path.join(scratch, 'deploy.conf'), original);
  conf.writeConf(scratch, added);
  const backups = fs.readdirSync(scratch).filter((file) => /^deploy\.conf\.bak-\d{8}-\d{6}/.test(file));
  check('every write keeps a dated backup of what was there', backups.length === 1 && fs.readFileSync(path.join(scratch, backups[0]), 'utf8') === original && fs.readFileSync(path.join(scratch, 'deploy.conf'), 'utf8') === added);
} catch (error) {
  check('the editor loads and runs', false, error?.stack?.split('\n').slice(0, 3).join(' ') || String(error));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

/* ---- the routes --------------------------------------------------------- */
const panel = await startPanel();
try {
  const { cookie } = await panel.signIn();
  const config = await panel.request('/api/servers-config', { cookie });
  check('the panel shows deploy.conf’s servers, whether it may write, and the keys it can use',
    config.json?.writable === true && config.json?.servers?.map((server) => server.name).join() === 'a' && config.json?.keys?.includes('deploy_key'), JSON.stringify(config.json || {}).slice(0, 200));

  panel.ssh('script', 'docker=29.9.2\ninstalled=1\nversion=2.98.84\n');
  const before = panel.calls().length;
  const tested = await panel.request('/api/servers/test', { method: 'POST', body: { fields: { SSH_HOST: 'c.example', SSH_USER: 'op', SSH_KEY: '~/.ssh/deploy_key' } }, cookie });
  check('a connection test is one login, and says what is on the server', tested.json?.ok === true && tested.json?.docker === '29.9.2' && tested.json?.installed === true && tested.json?.version === '2.98.84' && panel.calls().length === before + 1,
    `${JSON.stringify(tested.json)} ${panel.calls().length - before} call(s)`);
  panel.ssh('denied');
  const refused = await panel.request('/api/servers/test', { method: 'POST', body: { fields: { SSH_HOST: 'c.example', SSH_USER: 'op', SSH_KEY: '~/.ssh/deploy_key' } }, cookie });
  check('a refused key is said plainly', refused.json?.ok === false && refused.json?.problem === 'auth-failed', JSON.stringify(refused.json));

  /* deploy.sh sources deploy.conf and puts some of it into commands a shell
     runs (a jump's ProxyCommand): what the panel writes is held to plain
     characters, so nothing written here can become a command there. */
  let shellRefused = 0;
  for (const fields of [
    { SSH_HOST: 'c.example', SSH_KEY: '/x; touch /tmp/pwned' },
    { SSH_HOST: 'c.example', REMOTE_DIR: '/srv/$(id)' },
    { SSH_HOST: 'c.example', CLUSTER: 'a`id`' },
    { SSH_HOST: 'c.example', INSIDE: 'https://a.example;id' },
    { SSH_HOST: 'c.example', GATEWAY: '1 2' },
  ]) {
    const answer = await panel.request('/api/servers/save', { method: 'POST', body: { name: 'c', fields, code: '000000' }, cookie });
    if (answer.status === 400) shellRefused += 1;
  }
  check('settings that could become a command in deploy.sh are refused before anything else', shellRefused === 5, `${shellRefused}/5`);
  const outside = await panel.request('/api/servers/test', { method: 'POST', body: { fields: { SSH_HOST: 'c.example', SSH_KEY: '/etc/passwd' } }, cookie });
  check('a connection test only uses keys from the SSH folder', outside.status === 400, `${outside.status} ${JSON.stringify(outside.json)}`);
  let limited = false;
  for (let i = 0; i < 15 && !limited; i += 1) {
    const answer = await panel.request('/api/servers/test', { method: 'POST', body: { fields: { SSH_HOST: 'c.example', SSH_KEY: '~/.ssh/deploy_key' } }, cookie });
    limited = answer.status === 429;
  }
  check('and connection tests are rate-limited', limited);

  const wrongCode = await panel.request('/api/servers/save', { method: 'POST', body: { name: 'c', fields: { SSH_HOST: 'c.example', SSH_USER: 'op', SSH_KEY: '~/.ssh/deploy_key' }, code: '000000' }, cookie });
  check('saving needs a current code', wrongCode.status === 403, String(wrongCode.status));
  const badName = await panel.request('/api/servers/save', { method: 'POST', body: { name: 'Bad-Name', fields: { SSH_HOST: 'c.example' }, code: panel.code() }, cookie });
  check('a bad name is refused', badName.status === 400, String(badName.status));
  const saved = await panel.request('/api/servers/save', { method: 'POST', body: { name: 'c', fields: { SSH_HOST: 'c.example', SSH_USER: 'op', SSH_KEY: '~/.ssh/deploy_key', PUBLIC_URL: 'https://c.example:8585' }, code: panel.code() }, cookie });
  check('a server is saved to deploy.conf', saved.status === 200 && /^C_SSH_HOST='c\.example'$/m.test(fs.readFileSync(path.join(panel.dirs.config, 'deploy.conf'), 'utf8')), `${saved.status} ${JSON.stringify(saved.json)}`);
  check('with a backup of what was there', fs.readdirSync(panel.dirs.config).some((file) => file.startsWith('deploy.conf.bak-')));
  await sleep(2000);
  const listed = await panel.request('/api/servers', { cookie });
  check('and the panel lists it at once', listed.json?.servers?.map((server) => server.name).join() === 'a,c', JSON.stringify(listed.json?.servers?.map((server) => server.name)));
  const tunnels = panel.calls().filter((line) => line.includes(' -N ') && line.endsWith('op@c.example'));
  check('connected once, not twice', tunnels.length === 1, `${tunnels.length} tunnel start(s)`);

  /* From here the stand-in stays up like a tunnel that got in: a server whose
     key was refused is, rightly, not logged into again to install. */
  panel.ssh('up');
  const edited = await panel.request('/api/servers/save', { method: 'POST', body: { name: 'c', fields: { SSH_HOST: 'c2.example', SSH_USER: 'op', SSH_KEY: '~/.ssh/deploy_key' }, code: panel.code() }, cookie });
  await sleep(2000);
  const refusedInstall = await panel.request('/api/servers/install', { method: 'POST', body: { name: 'a', domain: 'a.example', code: panel.code() }, cookie });
  check('a server whose key was refused is not logged into again to install', refusedInstall.status === 409 && refusedInstall.json?.reason === 'auth-failed', `${refusedInstall.status} ${JSON.stringify(refusedInstall.json)}`);
  check('a changed address connects afresh', edited.status === 200 && panel.calls().some((line) => line.includes(' -N ') && line.endsWith('op@c2.example')));

  /* The stack installed over SSH: the output reaches the page, never the audit. */
  panel.ssh('script', 'Pulling the images\n  Password:   Abc123FirstSecret\n✓ P00RIJA Cryptography is running.\n');
  const install = await panel.request('/api/servers/install', { method: 'POST', body: { name: 'c', domain: 'c.example', registry: 'mirror.example.ir', code: panel.code() }, cookie });
  let job = null;
  for (let i = 0; i < 40 && install.json?.job; i += 1) {
    job = (await panel.request(`/api/jobs?id=${install.json.job}`, { cookie })).json;
    if (job?.done) break;
    await sleep(150);
  }
  check('installing runs as a job whose output the page can read', job?.done === true && job.lines?.some((line) => line.includes('Password:')) && job.lines.some((line) => /running/.test(line)), JSON.stringify(job || install.json).slice(0, 200));
  const sent = panel.lastInput();
  check('it takes the installer and the compose file with it, and the options given', /docker-install\.sh --yes --domain 'c\.example' --registry 'mirror\.example\.ir'/.test(sent) && sent.includes('base64 -d'), sent.slice(-200));
  check('and its output never reaches the audit log', !panel.audit().includes('Password:') && !panel.audit().includes('Abc123FirstSecret') && /install on c/.test(panel.audit()));
  const command = await panel.request('/api/servers/deploy-command?name=c', { cookie });
  check('the deploy.sh command for a server is offered', command.json?.command === 'bash scripts/deploy.sh --skip-bump --prebuilt --server c', JSON.stringify(command.json));

  const gone = await panel.request('/api/servers/remove', { method: 'POST', body: { name: 'c', code: panel.code() }, cookie });
  await sleep(1500);
  const after = await panel.request('/api/servers', { cookie });
  check('a server is removed from deploy.conf and from the panel', gone.status === 200 && !/^C_/m.test(fs.readFileSync(path.join(panel.dirs.config, 'deploy.conf'), 'utf8')) && after.json?.servers?.map((server) => server.name).join() === 'a', `${gone.status} ${JSON.stringify(gone.json)} ${JSON.stringify(after.json?.servers?.map((server) => server.name))}`);

  fs.chmodSync(panel.dirs.config, 0o555);
  const readOnly = await panel.request('/api/servers/save', { method: 'POST', body: { name: 'd', fields: { SSH_HOST: 'd.example' }, code: panel.code() }, cookie });
  fs.chmodSync(panel.dirs.config, 0o755);
  check('without write access nothing is written and it says why', readOnly.status === 409 && readOnly.json?.reason === 'read-only', `${readOnly.status} ${JSON.stringify(readOnly.json)}`);
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await panel.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
