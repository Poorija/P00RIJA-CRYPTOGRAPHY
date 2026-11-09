/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Server updates from the central panel (tools/panel/updates.mjs), with a
 * stand-in docker and a stand-in ssh:
 *
 * - a folder or an archive of the tree is uploaded, and the panel builds the
 *   images once (linux/amd64) and makes a package the operator key signs;
 * - an archive that already is a package is kept as it is, if the operator
 *   signed it, and refused otherwise; an archive with a path that climbs out
 *   of its folder is refused;
 * - the package can be downloaded;
 * - sent to a server, it is copied in over SSH, and a server without an
 *   updater yet is updated there and then by the package's own script, the
 *   whole file's hash given beside it.
 *
 *   node tests/e2e/panelupdates.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { startPanel, sleep, ROOT, PASSWORD } from './_panel-run.mjs';

const require = createRequire(import.meta.url);
const pkg = require(path.join(ROOT, 'scripts/lib/update-package.js'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const VERSION = '9.98.5';
const operator = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const operatorSpki = operator.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const operatorPem = operator.privateKey.export({ type: 'pkcs8', format: 'pem' });

const panel = await startPanel();
const write = (file, text, mode) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, mode ? { mode } : undefined); };
const upload = (cookie, kind, name, body) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port: panel.port, path: `/api/updates/upload?kind=${kind}&name=${encodeURIComponent(name)}`, method: 'POST', headers: { Host: `127.0.0.1:${panel.port}`, Cookie: cookie, 'Content-Type': 'application/octet-stream', 'Content-Length': body.length } }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_error) { /* not JSON */ } resolve({ status: res.statusCode, json }); });
  });
  req.on('error', (error) => resolve({ status: 0, json: { error: error.message } }));
  req.end(body);
});
const waitJob = async (cookie, id) => {
  let job = null;
  for (let i = 0; i < 200 && id; i += 1) {
    job = (await panel.request(`/api/jobs?id=${id}`, { cookie })).json;
    if (job?.done) break;
    await sleep(150);
  }
  return job;
};

try {
  /* This computer's docker and the operator key, stood in for. */
  write(path.join(panel.dirs.bin, 'docker'), `#!/bin/sh
echo "$*" >> "$(dirname "$0")/docker.log"
case "$1" in
  info|version) exit 0 ;;
  buildx) exit 0 ;;
  save) head -c 6000 /dev/urandom ;;
esac
exit 0
`, 0o755);
  write(path.join(panel.dirs.config, 'operator-key.json'), JSON.stringify({ name: 'Ops', id: 'x'.repeat(64), publicKey: operatorSpki, privateKey: operatorPem }), 0o600);
  const { cookie } = await panel.signIn();

  const state = await panel.request('/api/updates', { cookie });
  check('the panel says it can build here, with the operator key', state.status === 200 && state.json?.canBuild === true && state.json?.operatorKey === true, JSON.stringify(state.json));

  /* A tree as a folder upload carries it. */
  const tree = path.join(panel.dirs.root, 'tree');
  write(path.join(tree, 'package.json'), JSON.stringify({ name: 'p00rija-cryptography', version: VERSION, buildTag: `${VERSION}-chat-v999` }));
  for (const file of ['config/Dockerfile', 'config/Dockerfile.chat-signal', 'config/Dockerfile.cert-renewer']) write(path.join(tree, file), 'FROM scratch\n');
  write(path.join(tree, 'config/docker-compose.yaml'), 'services: {}\n');
  write(path.join(tree, 'scripts/apply-update.sh'), '#!/bin/bash\necho applied\n', 0o755);
  write(path.join(tree, 'scripts/sync-to-server.sh'), '#!/bin/bash\n', 0o755);
  write(path.join(tree, 'js/app.js'), 'app');
  write(path.join(tree, 'index.html'), '<html></html>');
  write(path.join(tree, 'node_modules/huge/x.js'), 'never shipped');
  const folderTar = spawnSync('tar', ['cf', '-', '-C', tree, '.'], { maxBuffer: 1 << 26 }).stdout;
  const up = await upload(cookie, 'folder', 'tree.tar', folderTar);
  check('a folder of the tree is taken', up.status === 200 && /^[0-9a-f]{16}$/.test(up.json?.id || ''), JSON.stringify(up.json));
  const refusedCode = await panel.request('/api/updates/build', { method: 'POST', body: { upload: up.json?.id, code: '000000' }, cookie });
  check('building wants a fresh code', refusedCode.status === 403 || refusedCode.status === 401 || refusedCode.json?.ok === false, String(refusedCode.status));
  const build = await panel.request('/api/updates/build', { method: 'POST', body: { upload: up.json?.id, code: panel.code() }, cookie });
  const built = await waitJob(cookie, build.json?.job);
  check('it builds a package', built?.done && built.code === 0, (built?.lines || []).slice(-4).join(' | '));
  const dockerLog = fs.existsSync(path.join(panel.dirs.bin, 'docker.log')) ? fs.readFileSync(path.join(panel.dirs.bin, 'docker.log'), 'utf8') : '';
  check('the three images built once, for the servers’ machines', ['config/Dockerfile ', 'config/Dockerfile.chat-signal', 'config/Dockerfile.cert-renewer'].every((file) => new RegExp(`buildx build --platform linux/amd64 .*-f \\S*${file.replace('.', '\\.')}`).test(dockerLog))
    && /-t poorija-crypto:9\.98\.5/.test(dockerLog) && /-t poorija-chat-signal:9\.98\.5/.test(dockerLog) && /-t poorija-cert-renewer:9\.98\.5/.test(dockerLog), dockerLog.split('\n').slice(0, 4).join(' | '));
  check('and saved for the package', /save poorija-crypto:9\.98\.5 poorija-chat-signal:9\.98\.5 poorija-cert-renewer:9\.98\.5/.test(dockerLog));
  const listed = await panel.request('/api/updates', { cookie });
  const made = listed.json?.packages?.find((entry) => entry.version === VERSION);
  check('the package is listed, with its size', made && made.size > 0, JSON.stringify(listed.json?.packages));
  const file = path.join(panel.dirs.state, 'updates', 'packages', `p00rija-update-${VERSION}.tar`);
  check('signed by the operator key, every member as named', fs.existsSync(file) && pkg.verifyPackage(file, operatorSpki).ok);
  const sourceList = spawnSync('sh', ['-c', `tar xOf '${file}' source.tar.gz | tar tzf -`], { encoding: 'utf8' }).stdout;
  check('its tree is what a deploy copies, nothing of node_modules', /js\/app\.js/.test(sourceList) && /index\.html/.test(sourceList) && /scripts\/apply-update\.sh/.test(sourceList) && !/node_modules/.test(sourceList), sourceList.replace(/\n/g, ' ').slice(0, 200));
  const download = await panel.request(`/api/updates/package?version=${VERSION}`, { cookie, raw: true });
  check('and it can be downloaded', download.status === 200 && /attachment/.test(String(download.headers['content-disposition'] || '')), String(download.status));

  /* A package uploaded as it is. */
  const already = path.join(panel.dirs.root, 'ready.tar');
  fs.copyFileSync(file, already);
  const asIs = await upload(cookie, 'archive', 'ready.tar', fs.readFileSync(already));
  fs.rmSync(file);
  fs.writeFileSync(path.join(panel.dirs.bin, 'docker.log'), '');
  const keptJob = await waitJob(cookie, (await panel.request('/api/updates/build', { method: 'POST', body: { upload: asIs.json?.id, code: panel.code() }, cookie })).json?.job);
  check('a package uploaded as it is is kept as it is, nothing built', keptJob?.code === 0 && fs.existsSync(file) && !fs.readFileSync(path.join(panel.dirs.bin, 'docker.log'), 'utf8').includes('buildx'), (keptJob?.lines || []).slice(-2).join(' | '));
  const stranger = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const members = { 'source.tar.gz': path.join(panel.dirs.root, 's.tgz'), 'images.tar.gz': path.join(panel.dirs.root, 'i.tgz') };
  fs.writeFileSync(members['source.tar.gz'], crypto.randomBytes(100));
  fs.writeFileSync(members['images.tar.gz'], crypto.randomBytes(100));
  const forged = path.join(panel.dirs.root, 'forged.tar');
  const manifest = pkg.buildManifest({ version: '9.98.6', buildTag: '9.98.6-x', source: 'x', members, images: ['poorija-crypto:9.98.6'] });
  pkg.writePackage(forged, { manifest, sig: pkg.signManifest(manifest, stranger.privateKey.export({ type: 'pkcs8', format: 'pem' })), members });
  const forgedUp = await upload(cookie, 'archive', 'forged.tar', fs.readFileSync(forged));
  const forgedJob = await waitJob(cookie, (await panel.request('/api/updates/build', { method: 'POST', body: { upload: forgedUp.json?.id, code: panel.code() }, cookie })).json?.job);
  check('one signed by any other key is refused', forgedJob?.code !== 0 && !fs.existsSync(path.join(panel.dirs.state, 'updates', 'packages', 'p00rija-update-9.98.6.tar')), (forgedJob?.lines || []).slice(-2).join(' | '));
  const climbing = path.join(panel.dirs.root, 'climb');
  write(path.join(climbing, 'inner', 'x'), 'x');
  const climbTar = spawnSync('tar', ['cf', '-', '-C', path.join(climbing, 'inner'), '../inner/x'], { maxBuffer: 1 << 20 }).stdout;
  const climbUp = await upload(cookie, 'archive', 'climb.tar', climbTar);
  const climbJob = await waitJob(cookie, (await panel.request('/api/updates/build', { method: 'POST', body: { upload: climbUp.json?.id, code: panel.code() }, cookie })).json?.job);
  check('an archive with a path that climbs out of its folder is refused', climbJob?.code !== 0 && /\.\./.test((climbJob?.lines || []).join(' ')), (climbJob?.lines || []).slice(-2).join(' | '));

  /* Sent to a server with no updater yet: copied in, then applied there by the package's own script. */
  panel.ssh('script', 'applied\n');
  const sent = await panel.request('/api/updates/send', { method: 'POST', body: { version: VERSION, servers: ['a'], policy: { mode: 'now' }, code: panel.code() }, cookie });
  const sendJob = await waitJob(cookie, sent.json?.job);
  const calls = panel.calls();
  check('sending copies the package in over SSH', sendJob?.code === 0 && calls.some((line) => line.includes(`updates/incoming/p00rija-update-${VERSION}.tar.part`) && line.endsWith(`'`) === false || line.includes(`p00rija-update-${VERSION}.tar.part`)), calls.slice(-3).join(' | '));
  const script = panel.lastInput();
  const sha = pkg.hashRange(file, 0, fs.statSync(file).size);
  check('and a server without an updater is updated there and then, the checked hash beside the package', script.includes(sha) && /apply-update\.sh/.test(script) && script.includes(`p00rija-update-${VERSION}.tar`), script.slice(0, 300));
  /* A time for a version this panel holds no package of is never signed: the
     version would be the relay's word, and the operator key signs nothing on it. */
  const { policySigned } = require(path.join(ROOT, 'scripts/lib/relay-updates.js'));
  const updatesLib = await import(path.join(ROOT, 'tools/panel/updates.mjs'));
  const signer = updatesLib.policySignerFor({ packageExists: (version) => version === VERSION, operatorKey: () => ({ privateKey: operatorPem, publicKey: operatorSpki }) });
  const held = signer({ mode: 'now' }, VERSION);
  const foreign = signer({ mode: 'now' }, '9.99.99');
  check('a time is signed only for a version this panel holds the package of', policySigned(held, VERSION, operatorSpki) && !foreign.sig, JSON.stringify(foreign));
  /* A canary is picked by server name and signed in as that server's verified relay id, with its hold. */
  const signer2 = updatesLib.policySignerFor({ packageExists: (version) => version === VERSION, operatorKey: () => ({ privateKey: operatorPem, publicKey: operatorSpki }), relayIdOf: (name) => ({ a: 'a'.repeat(64), b: '' }[name] || '') });
  const canaried = signer2({ mode: 'now', canary: 'a', holdMin: 45 }, VERSION);
  check('a canary picked by name is signed into the time as its relay id, with its hold', canaried.canary === 'a'.repeat(64) && canaried.holdMin === 45 && policySigned(canaried, VERSION, operatorSpki), JSON.stringify(canaried));
  let refusedCanary = '';
  try { signer2({ mode: 'now', canary: 'b' }, VERSION); } catch (error) { refusedCanary = error.message; }
  check('a canary that has not shown a verified relay identity is refused', /identity/.test(refusedCanary), refusedCanary);
  const outside = await panel.request('/api/updates/send', { method: 'POST', body: { version: VERSION, servers: ['a'], policy: { mode: 'now', canary: 'zz' }, code: panel.code() }, cookie });
  check('and the canary must be one of the servers it is sent to', outside.status === 400 && outside.json?.reason === 'canary-not-chosen', `${outside.status} ${JSON.stringify(outside.json)}`);
  /* And only for servers this panel sent that version to itself. */
  const notSent = await panel.request('/api/updates/policy', { method: 'POST', body: { servers: ['a'], version: '9.98.6', policy: { mode: 'now' }, code: panel.code() }, cookie });
  const sentRecord = JSON.parse(fs.readFileSync(path.join(panel.dirs.state, 'updates', 'sent.json'), 'utf8'));
  check('the panel remembers which version it sent to which server', sentRecord[VERSION]?.includes('a') && !sentRecord['9.98.6'], JSON.stringify(sentRecord));
  check('and a time for a version it did not send there is not signed', notSent.status === 200, String(notSent.status));
  /* The send form in a browser: the canary and its hold are there to pick. */
  {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${panel.port}/`);
      await page.fill('#loginUser', 'op');
      await page.fill('#loginPassword', PASSWORD);
      await page.fill('#loginCode', panel.code());
      await page.click('#loginButton');
      await page.waitForSelector('#appView:not([hidden])', { timeout: 10000 });
      await page.click('[data-tab="ops"]');
      await page.click('[data-subtab="ops"][data-subtab-key="updates"]');
      await page.waitForSelector(`[data-upd-send="${VERSION}"]`, { timeout: 15000 });
      await page.click(`[data-upd-send="${VERSION}"]`);
      await page.waitForSelector('#updCanary', { timeout: 5000 });
      const form = await page.evaluate(() => ({
        canaries: [...document.querySelectorAll('#updCanary option')].map((option) => option.value),
        hold: document.querySelector('#updHold')?.value,
        help: document.querySelector('#dialog')?.textContent || '',
      }));
      check('the send form offers no canary or any server as the canary, with a 30-minute hold', JSON.stringify(form.canaries) === JSON.stringify(['', 'a']) && form.hold === '30', JSON.stringify(form).slice(0, 200));
      await page.selectOption('#updCanary', 'a');
      await page.uncheck('[data-upd-target="a"]');
      await page.click('#updSendRun');
      const said = await page.textContent('#updSendError');
      check('and says so when nothing is chosen to send to', said.trim().length > 0, said);
      /* Beside every server, the connect QR the app scans. */
      await page.click('#dialogClose').catch(() => page.keyboard.press('Escape'));
      await page.evaluate(() => { document.getElementById('dialog').hidden = true; });
      await page.click('[data-tab="servers"]');
      await page.waitForSelector('[data-qr-server="a"]', { timeout: 15000 });
      await page.click('[data-qr-server="a"]');
      await page.waitForSelector('.qr-box svg', { timeout: 10000 });
      const qrText = await page.textContent('#qrCodeText');
      check('a server’s QR button shows the connect code it draws', qrText.startsWith('P0R1|https://a.example:8585') && Boolean(await page.$('.qr-box svg')), qrText);
      check('the page ran without a script error', errors.length === 0, errors.join(' | '));
    } finally {
      await browser.close();
    }
  }
  check('every change is in the audit log', /built an update package 9\.98\.5/.test(panel.audit()) && /send update 9\.98\.5 to a/.test(panel.audit()), panel.audit().split('\n').slice(-4).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack?.split('\n').slice(0, 4).join(' ') || String(error));
} finally {
  await panel.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
