/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Clusters, the signed family list and the operator key, managed from the
 * panel against real local relays. The first admin key goes in with a
 * confirming code while none is listed; every change after that needs that
 * key's signature. Clusters are created, renamed, given inside addresses
 * and deleted, and the relays, the operator's files and deploy.conf agree
 * afterwards. The operator key is exported, removed (the panel turns
 * read-only, not broken) and imported back. Replacing it runs server by
 * server and stops, putting the failing one back, at the first failure.
 *
 *   node tests/e2e/panelfamily.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createFleet, PASSWORD as RELAY_PASSWORD, waitUntil } from './_relay-fleet.mjs';
import { startPanel, ROOT, PASSWORD } from './_panel-run.mjs';

const require = createRequire(import.meta.url);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const { subtle } = globalThis.crypto;
const dirlib = require(path.join(ROOT, 'scripts/lib/relay-directory.js'));
const page = await import(pathToFileURL(path.join(ROOT, 'tools/panel/web/sign.js')));
const tool = await import(pathToFileURL(path.join(ROOT, 'tools/relay-directory.mjs')));
async function browserKey() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const spki = Buffer.from(await subtle.exportKey('spki', pair.publicKey)).toString('base64');
  return { ...pair, spki, keyId: crypto.createHash('sha256').update(Buffer.from(spki, 'base64')).digest('hex') };
}
const onRelay = async (origin) => (await fetch(`${origin}/relay-directory`)).json().catch(() => null);

/* ---- the pure parts ------------------------------------------------------ */
try {
  const family = await import(pathToFileURL(path.join(ROOT, 'tools/panel/family.mjs')));
  const draft = { relays: [{ id: 'a'.repeat(64), name: 'a', cluster: 'X' }, { id: 'b'.repeat(64), name: 'b', cluster: 'X' }, { id: 'c'.repeat(64), name: 'c' }], admins: [], revoked: [] };
  const plan = family.planClusterChange(draft, { op: 'members', name: 'Y', servers: ['a', 'c'] });
  check('setting a cluster’s members moves them in and nobody else', JSON.stringify(plan) === JSON.stringify([{ op: 'cluster', name: 'a', cluster: 'Y' }, { op: 'cluster', name: 'c', cluster: 'Y' }]), JSON.stringify(plan));
  const emptied = family.planClusterChange(draft, { op: 'members', name: 'X', servers: ['a'] });
  check('and a member left out leaves it', JSON.stringify(emptied) === JSON.stringify([{ op: 'cluster', name: 'a', cluster: 'X' }, { op: 'cluster', name: 'b', cluster: '' }]), JSON.stringify(emptied));
  check('renaming moves every member', JSON.stringify(family.planClusterChange(draft, { op: 'rename', from: 'X', to: 'Z' })) === JSON.stringify([{ op: 'cluster', name: 'a', cluster: 'Z' }, { op: 'cluster', name: 'b', cluster: 'Z' }]));
  check('deleting takes every member out', JSON.stringify(family.planClusterChange(draft, { op: 'delete', name: 'X' })) === JSON.stringify([{ op: 'cluster', name: 'a', cluster: '' }, { op: 'cluster', name: 'b', cluster: '' }]));
  let refusals = 0;
  for (const bad of [{ op: 'members', name: '', servers: ['a'] }, { op: 'members', name: 'x'.repeat(41), servers: ['a'] }, { op: 'members', name: 'Y', servers: ['nobody'] }, { op: 'members', name: 'Y', servers: [] }, { op: 'rename', from: 'X', to: 'bad\nname' }]) {
    try { family.planClusterChange(draft, bad); } catch (_error) { refusals += 1; }
  }
  check('a cluster with no name, too long a name, an unknown or no member is refused', refusals === 5, `${refusals}/5`);
  const view = family.clusterView({ relays: [{ name: 'a', cluster: 'X', inside: ['https://10.0.0.1:8585'], gateway: 1 }, { name: 'b', cluster: 'X' }] });
  check('a cluster shows its members, its gateways and whether it can work on its own', view[0]?.name === 'X' && view[0].members.join() === 'a,b' && view[0].independent === false && view[0].gateways.join() === 'a', JSON.stringify(view));

  /* Replacing the key: server by server, the failing one put back, and stop. */
  const order = [];
  const fake = (failOn) => ({
    servers: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    applyKey: async (server) => { order.push(`apply ${server.name}`); return { ok: server.name !== failOn, reason: server.name === failOn ? 'no answer' : '' }; },
    revertKey: async (server) => { order.push(`revert ${server.name}`); return { ok: true }; },
    deliver: async (server) => { order.push(`deliver ${server.name}`); return { ok: true }; },
  });
  const stopped = await family.rotateOperator(fake('b'));
  check('a replacement stops at the first server that fails, and puts that one back',
    JSON.stringify(stopped) === JSON.stringify({ done: ['a'], failed: { name: 'b', reason: 'no answer' } }) && order.join(',') === 'apply a,deliver a,apply b,revert b', `${JSON.stringify(stopped)} ${order.join(',')}`);
  order.length = 0;
  const finished = await family.rotateOperator(fake(''));
  check('and when every server takes it, each gets the new list right after its new key', finished.failed === null && order.join(',') === 'apply a,deliver a,apply b,deliver b,apply c,deliver c', order.join(','));
} catch (error) {
  check('family.mjs loads and runs', false, error?.stack?.split('\n').slice(0, 3).join(' ') || String(error));
}

/* ---- against real relays ------------------------------------------------- */
const opPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const opKey = opPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const opId = dirlib.operatorIdFor(opKey);
const fleet = await createFleet(['r1', 'r2'], { env: { r1: () => ({ CHAT_OPERATOR_KEY: opKey }), r2: () => ({ CHAT_OPERATOR_KEY: opKey }) } });
const { r1, r2 } = fleet.relays;
let panel = null;
try {
  await fleet.startAll();
  const conf = `SERVERS='r1 r2'\nR1_SSH_HOST='r1.example'\nR1_PUBLIC_URL='${r1.origin}'\nR2_SSH_HOST='r2.example'\nR2_PUBLIC_URL='${r2.origin}'\n`;
  panel = await startPanel({ conf, env: { POORIJA_PANEL_DIRECT: `r1=${r1.origin},r2=${r2.origin}`, POORIJA_PANEL_PASSWORD: RELAY_PASSWORD } });
  const home = panel.dirs.config;
  fs.writeFileSync(path.join(home, 'operator-key.json'), JSON.stringify({ name: 'Family Ops', id: opId, publicKey: opKey, privateKey: opPair.privateKey.export({ type: 'pkcs8', format: 'pem' }), createdAt: '' }), { mode: 0o600 });
  tool.saveDraft(home, { relays: [{ id: r1.id, name: 'r1', origins: [r1.origin], region: 'outside-iran', gateway: 1 }, { id: r2.id, name: 'r2', origins: [r2.origin], region: 'outside-iran', gateway: 0 }], revoked: [], admins: [] });
  const first = tool.signDraft(tool.loadState(home));
  tool.saveSigned(home, first);
  for (const name of ['r1', 'r2']) await fleet.post(name, '/Monitor_Server/directory', first);
  const { cookie } = await panel.signIn();
  const get = (route) => panel.request(route, { cookie });
  const post = (route, body) => panel.request(route, { method: 'POST', body, cookie });

  const shown = await get('/api/family');
  check('the panel shows the family list: the key here, its relays, no admin yet',
    shown.json?.canEdit === true && shown.json?.operator?.present === true && shown.json?.operator?.id === opId && shown.json?.relays?.length === 2 && shown.json?.admins?.length === 0, JSON.stringify(shown.json || {}).slice(0, 200));

  const device = await browserKey();
  const boot = await post('/api/family/bootstrap-admin', { name: 'office', key: device.spki, code: panel.code() });
  check('while no admin key is listed, this browser’s key goes in with a confirming code', boot.status === 200 && (await get('/api/family')).json?.admins?.some((admin) => admin.name === 'office'), `${boot.status} ${JSON.stringify(boot.json)}`);
  check('and the relays carry the list with it', await waitUntil(async () => (await onRelay(r1.origin))?.body?.admins?.some((admin) => admin.name === 'office'), 8000));
  const again = await post('/api/family/bootstrap-admin', { name: 'other', key: (await browserKey()).spki, code: panel.code() });
  check('once one is listed, no other key gets in that way', again.status === 409 && again.json?.reason === 'admins-exist', `${again.status} ${JSON.stringify(again.json)}`);

  await post('/api/family-refresh', {});
  const signed = async (body, key = device) => post('/api/directory', { ...body, signature: await page.signHeader({ method: 'POST', path: '/control-panel/directory', body, relay: opId }, key) });
  const unsigned = await post('/api/directory', { change: { op: 'members', name: 'Inside', servers: ['r1', 'r2'] } });
  check('a cluster change needs the listed key’s signature', unsigned.status === 403 && unsigned.json?.reason === 'signature-needed', `${unsigned.status} ${JSON.stringify(unsigned.json)}`);
  const made = await signed({ change: { op: 'members', name: 'Inside', servers: ['r1', 'r2'] } });
  const deployConf = () => fs.readFileSync(path.join(home, 'deploy.conf'), 'utf8');
  check('a cluster is made with its members, signed and handed to every server', made.status === 200 && made.json?.published?.every((entry) => entry.ok)
    && (await onRelay(r2.origin))?.body?.relays?.every((relay) => relay.cluster === 'Inside'), `${made.status} ${JSON.stringify(made.json).slice(0, 200)}`);
  check('and deploy.conf says the same, for the next deploy', /^R1_CLUSTER='Inside'$/m.test(deployConf()) && /^R2_CLUSTER='Inside'$/m.test(deployConf()));
  await signed({ change: { op: 'rename', from: 'Inside', to: 'Iran' } });
  check('renamed, every member moves', (await onRelay(r1.origin))?.body?.relays?.every((relay) => relay.cluster === 'Iran') && /^R2_CLUSTER='Iran'$/m.test(deployConf()));
  await signed({ change: { op: 'inside', server: 'r1', inside: ['https://198.51.100.7:8585'] } });
  check('a member gets its inside address', (await onRelay(r1.origin))?.body?.relays?.find((relay) => relay.name === 'r1')?.inside?.join() === 'https://198.51.100.7:8585' && /^R1_INSIDE='https:\/\/198\.51\.100\.7:8585'$/m.test(deployConf()));
  const view = await get('/api/family');
  check('the cluster view shows it, with who can work alone', view.json?.clusters?.find((cluster) => cluster.name === 'Iran')?.members?.length === 2 && view.json.clusters[0].independent === false, JSON.stringify(view.json?.clusters));
  await signed({ change: { op: 'delete', name: 'Iran' } });
  check('deleted, its members are in no cluster, here or in deploy.conf', (await onRelay(r1.origin))?.body?.relays?.every((relay) => !relay.cluster) && !/^R[12]_CLUSTER=/m.test(deployConf()));

  const laptop = await browserKey();
  await signed({ edits: [{ op: 'admin-add', name: 'laptop', key: laptop.spki }] });
  check('a listed key adds another admin key', (await get('/api/family')).json?.admins?.some((admin) => admin.name === 'laptop'));
  await signed({ edits: [{ op: 'admin-remove', name: 'laptop' }] }, laptop);
  check('and an admin key is removed', !(await get('/api/family')).json?.admins?.some((admin) => admin.name === 'laptop'));

  /* The operator key. */
  const noPassword = await post('/api/operator/export', { code: panel.code() });
  check('exporting the operator key needs the password', noPassword.status === 403, String(noPassword.status));
  const exported = await panel.request('/api/operator/export', { method: 'POST', body: { password: PASSWORD, code: panel.code() }, cookie, raw: true });
  const keyFile = JSON.parse(exported.text || '{}');
  check('with it, the key file comes as a download', exported.status === 200 && /attachment/.test(exported.headers['content-disposition'] || '') && keyFile.id === opId && /PRIVATE KEY/.test(keyFile.privateKey || ''), `${exported.status}`);
  check('and the audit says so without the key', /operator key exported/.test(panel.audit()) && !panel.audit().includes('PRIVATE KEY'));
  const removed = await post('/api/operator/remove', { code: panel.code() });
  const without = await get('/api/family');
  check('removed from this computer, the panel shows the list read-only and keeps working',
    removed.status === 200 && without.json?.canEdit === false && without.json?.reason === 'no-operator-key' && (await get('/api/servers')).status === 200, `${removed.status} ${JSON.stringify(without.json || {}).slice(0, 120)}`);
  check('and a copy of the key stays beside it', fs.readdirSync(home).some((file) => file.startsWith('operator-key.json.removed-')));
  const imported = await post('/api/operator/import', { file: keyFile, code: panel.code() });
  check('importing the exported file puts it back', imported.status === 200 && (await get('/api/family')).json?.canEdit === true, `${imported.status} ${JSON.stringify(imported.json)}`);
  const wrongFile = await post('/api/operator/import', { file: { ...keyFile, publicKey: laptop.spki }, code: panel.code() });
  check('a file whose keys do not belong together is refused', wrongFile.status === 400 || wrongFile.status === 409, String(wrongFile.status));
  const rotateDirect = await post('/api/operator/rotate', { password: PASSWORD, code: panel.code() });
  check('replacing the key asks for servers it can reach over SSH, and says so when it cannot', rotateDirect.status === 409 && rotateDirect.json?.reason === 'needs-ssh', `${rotateDirect.status} ${JSON.stringify(rotateDirect.json)}`);

  const dropped = await signed({ edits: [{ op: 'remove', name: 'r2' }] });
  check('an entry is taken out of the list', dropped.status === 200 && !(await onRelay(r1.origin))?.body?.relays?.some((relay) => relay.name === 'r2'));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await panel?.cleanup();
  await fleet.stopAll();
  for (const name of ['r1', 'r2']) fs.rmSync(fleet.relays[name].dir, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
