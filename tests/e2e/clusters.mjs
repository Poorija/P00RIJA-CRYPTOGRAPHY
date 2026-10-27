/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Clusters: groups of one family's relays, each able to carry on alone
 * (docs/RELAY-NETWORK.md, "Clusters").
 *
 * "rules" checks the directory fields, the order a relay tries a cluster
 * mate's addresses in, and when a certificate's name may go unchecked.
 * "cut" runs four relays of one family in two clusters, takes the outside
 * cluster away and gives the inside relays public addresses that no longer
 * answer (the way names stop resolving when a country is cut off): the
 * inside cluster still links through its inside addresses and carries.
 *
 *   node tests/e2e/clusters.mjs            # every section
 *   node tests/e2e/clusters.mjs rules      # one of them
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createFleet, waitUntil, sleep, short } from './_relay-fleet.mjs';

const require = createRequire(import.meta.url);
const ONLY = new Set(process.argv.slice(2));
const wants = (name) => !ONLY.size || ONLY.has(name);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const spki = (publicKey) => publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const newKey = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const fakeId = (n) => crypto.createHash('sha256').update(`relay-${n}`).digest('hex');

try {
  if (wants('rules')) {
    section('the rules');
    const dir = require('../../scripts/lib/relay-directory.js');
    const operator = newKey();
    const operatorKey = spki(operator.publicKey);
    const [me, mate, far] = [1, 2, 3].map(fakeId);
    const body = (relays, extra = {}) => ({
      v: 1, operator: { id: dir.operatorIdFor(operatorKey), key: operatorKey, name: 'C' }, serial: 1, issuedAt: '', relays, revoked: [], ...extra,
    });
    const relays = [
      { id: me, name: 'me', origins: ['https://me.example.ca:8585'], inside: ['https://me.example.ir:8585'], region: 'inside-iran', gateway: 0, cluster: 'Iran' },
      { id: mate, name: 'mate', origins: ['https://mate.example.ca:8585'], inside: ['https://198.51.100.7:8585'], region: 'inside-iran', gateway: 0, cluster: 'Iran' },
      { id: far, name: 'far', origins: ['https://far.example.com:8585'], inside: ['https://10.0.0.9:8585'], region: 'outside-iran', gateway: 1, cluster: 'Outside' },
    ];
    const doc = dir.signDirectory(body(relays), operator.privateKey);
    check('a directory with clusters and inside addresses is well formed', dir.verifyDirectory(doc, { operatorKey, selfId: me }).ok === true);
    const tooLong = dir.signDirectory(body([{ ...relays[0], cluster: 'x'.repeat(41) }, relays[1]]), operator.privateKey);
    const badInside = dir.signDirectory(body([{ ...relays[0], inside: ['ftp://nope'] }, relays[1]]), operator.privateKey);
    check('a cluster name over 40 characters, or an inside address that is not one, is malformed',
      dir.verifyDirectory(tooLong, { operatorKey, selfId: me }).reason === 'malformed' && dir.verifyDirectory(badInside, { operatorKey, selfId: me }).reason === 'malformed');

    const plan = dir.planChanges(doc.body, me, new Set());
    const origins = Object.fromEntries(plan.allow.map((entry) => [entry.id, entry.origins.split('|')]));
    check('a cluster mate is tried at its inside addresses first', origins[mate][0] === 'https://198.51.100.7:8585' && origins[mate][1] === 'https://mate.example.ca:8585', origins[mate].join(' '));
    check('a relay of another cluster at its public addresses first, its inside ones last', origins[far][0] === 'https://far.example.com:8585' && origins[far].at(-1) === 'https://10.0.0.9:8585', origins[far].join(' '));
    const noCluster = dir.planChanges(dir.signDirectory(body(relays.map(({ cluster, ...rest }) => rest)), operator.privateKey).body, me, new Set());
    check('without clusters, public addresses come first as before', noCluster.allow.find((entry) => entry.id === mate).origins.startsWith('https://mate.example.ca:8585'));

    check('the certificate name goes unchecked only for an IP address of a family relay',
      dir.verifyTlsFor({ origin: 'https://198.51.100.7:8585', familyMember: true, verifyTls: true }) === false
        && dir.verifyTlsFor({ origin: 'https://198.51.100.7:8585', familyMember: false, verifyTls: true }) === true
        && dir.verifyTlsFor({ origin: 'https://mate.example.ir:8585', familyMember: true, verifyTls: true }) === true
        && dir.verifyTlsFor({ origin: 'https://[2001:db8::1]:8585', familyMember: true, verifyTls: true }) === false
        && dir.verifyTlsFor({ origin: 'https://mate.example.ir:8585', familyMember: true, verifyTls: false }) === false);

    /* The dial passes the per-address decision on to both the identity fetch and the socket. */
    const { createRelayPeers } = require('../../scripts/lib/relay-peers.js');
    const seen = [];
    class FakeSocket { constructor(url, options) { seen.push({ socket: url, verify: options.rejectUnauthorized }); setTimeout(() => this.onError?.(new Error('fake')), 0); } on(event, handler) { if (event === 'error') this.onError = handler; } close() {} }
    const peers = createRelayPeers({
      identity: { id: me, publicKey: 'x' }, privateKey: null, allowlist: [mate], WebSocketImpl: FakeSocket,
      fetchIdentity: async (origin, options = {}) => { seen.push({ identity: origin, verify: options.verifyTls }); throw new Error('stop here'); },
      verifyTls: true,
      verifyTlsFor: (peerId, origin) => dir.verifyTlsFor({ origin, familyMember: peerId === mate, verifyTls: true }),
      log: { log() {}, warn() {} },
    });
    await peers.dial(mate, 'https://198.51.100.7:8585');
    peers.close();
    check('the dial asks for the identity at an IP inside address without the name check', seen[0]?.identity === 'https://198.51.100.7:8585' && seen[0]?.verify === false, JSON.stringify(seen));

    const tool = await import('../../tools/relay-directory.mjs');
    const conf = tool.parseDeployConf("SERVERS='ir3 se'\nIR3_PUBLIC_URL='https://ir.example.ir:8585'\nIR3_CLUSTER='Iran'\nIR3_INSIDE='https://198.51.100.7:8585'\nSE_PUBLIC_URL='https://se.example:8585'\n");
    const entry = tool.serverEntry(conf, 'ir3', null, { id: fakeId(7) });
    check('deploy.conf gives a server its cluster and inside addresses', entry.cluster === 'Iran' && entry.inside.join() === 'https://198.51.100.7:8585', JSON.stringify(entry));
    check('and a server without them has none', !tool.serverEntry(conf, 'se', null, { id: fakeId(8) }).cluster);
    /* A cluster changed in the panel or with the cluster command stays put
       when the next deploy reads deploy.conf again. */
    const kept = tool.serverEntry(conf, 'ir3', { cluster: 'Tehran', inside: ['https://10.1.1.1:8585'] }, { id: fakeId(7) });
    check('a cluster set since stays over what deploy.conf says', kept.cluster === 'Tehran' && kept.inside.join() === 'https://10.1.1.1:8585', JSON.stringify(kept));
    const draft = { relays: [{ id: fakeId(7), name: 'ir3', origins: ['https://ir.example.ir:8585'], region: 'inside-iran', gateway: 0, cluster: 'Iran' }], revoked: [] };
    const movedDraft = tool.editRelay(draft, 'ir3', { cluster: 'Tehran', inside: ['https://198.51.100.7:8585'] });
    const cleared = tool.editRelay(movedDraft, 'ir3', { cluster: '', inside: [] });
    check('a relay can be moved to another cluster and out of all of them', movedDraft.relays[0].cluster === 'Tehran' && movedDraft.relays[0].inside[0] === 'https://198.51.100.7:8585'
      && cleared.relays[0].cluster === undefined && cleared.relays[0].inside === undefined, JSON.stringify(cleared.relays[0]));
    let badInsideRefused = false;
    try { tool.editRelay(draft, 'ir3', { inside: ['ftp://nope'] }); } catch (_error) { badInsideRefused = true; }
    check('and an inside address that is not one is refused', badInsideRefused);
  }

  if (wants('cut')) {
    section('cut: the inside cluster alone');
    const dir = require('../../scripts/lib/relay-directory.js');
    const { sealTransit } = require('../../scripts/lib/relay-transit.js');
    const operator = newKey();
    const operatorKey = spki(operator.publicKey);
    const fleet = await createFleet(['c1', 'c2', 'o1', 'o2'], {
      env: Object.fromEntries(['c1', 'c2', 'o1', 'o2'].map((name) => [name, () => ({ CHAT_OPERATOR_KEY: operatorKey, CHAT_DIRECTORY_PULL_MS: '3000' })])),
    });
    const { c1, c2, o1, o2 } = fleet.relays;
    /* The inside relays' public names no longer answer; their inside
       addresses do. */
    const dead = (n) => `http://127.0.0.1:${n}`;
    const doc = dir.signDirectory({
      v: 1, operator: { id: dir.operatorIdFor(operatorKey), key: operatorKey, name: 'Cut Ops' }, serial: 1, issuedAt: new Date().toISOString(),
      relays: [
        { id: c1.id, name: 'c1', origins: [dead(9)], inside: [c1.origin], region: 'inside-iran', gateway: 0, cluster: 'Inside' },
        { id: c2.id, name: 'c2', origins: [dead(9)], inside: [c2.origin], region: 'inside-iran', gateway: 0, cluster: 'Inside' },
        { id: o1.id, name: 'o1', origins: [o1.origin], region: 'outside-iran', gateway: 1, cluster: 'Outside' },
        { id: o2.id, name: 'o2', origins: [o2.origin], region: 'outside-iran', gateway: 2, cluster: 'Outside' },
      ],
      revoked: [],
    }, operator.privateKey);
    const clients = [];
    try {
      await fleet.startAll();
      for (const name of ['c1', 'c2', 'o1', 'o2']) await fleet.post(name, '/Monitor_Server/directory', doc);
      check('the family meshes, inside relays through their inside addresses', await waitUntil(async () => (await fleet.linked('c1')).size === 3 && (await fleet.linked('c2')).size === 3, 30000), JSON.stringify([...await fleet.linked('c1')]));
      await fleet.stop('o1');
      await fleet.stop('o2');
      await sleep(1500);
      const alone = await fleet.linked('c1');
      check('with the outside cluster gone, the inside relays are still linked to each other', alone.has(short(c2.id)) && !alone.has(short(o1.id)), JSON.stringify([...alone]));
      const sender = fleet.client('c1', 'inside-sender');
      const recipient = fleet.client('c2', 'inside-recipient');
      clients.push(sender, recipient);
      await sender.ready;
      await recipient.ready;
      await sleep(800);
      sender.send({ ...sealTransit(c2.id, c2.key, { type: 'relay', toFingerprint: recipient.identity.fingerprint, persist: true, tag: 'cut1', payload: { type: 'offline-chat', inner: 'inside-only' } }), tag: 'cut1' });
      const arrived = await recipient.waitFor((message) => message.type === 'relay' && message.payload?.inner === 'inside-only', 15000).catch((error) => ({ error: error.message }));
      check('and a message from one inside relay’s user reaches the other’s', arrived?.payload?.inner === 'inside-only', JSON.stringify(arrived).slice(0, 200));
      sender.send({ ...sealTransit(c2.id, c2.key, { type: 'turn-query' }), tag: 'turn1' });
      const turn = await sender.waitFor((message) => message.tag === 'turn1', 15000).catch((error) => ({ error: error.message }));
      check('and a call can still get its TURN credentials from the cluster', turn?.type === 'turn', JSON.stringify(turn).slice(0, 160));
      await fleet.stop('c2');
      await fleet.start('c2');
      check('an inside relay restarted with the outside still gone links back inside', await waitUntil(async () => (await fleet.linked('c1')).has(short(c2.id)), 30000));
    } finally {
      for (const client of clients) client.close();
      await fleet.stopAll();
    }
  }

  if (wants('detour')) {
    section('detour: two members whose own path is closed, through a third');
    const dir = require('../../scripts/lib/relay-directory.js');
    const { sealTransit } = require('../../scripts/lib/relay-transit.js');
    const operator = newKey();
    const operatorKey = spki(operator.publicKey);
    const fleet = await createFleet(['d1', 'd2', 'd3'], {
      env: Object.fromEntries(['d1', 'd2', 'd3'].map((name) => [name, () => ({ CHAT_OPERATOR_KEY: operatorKey, CHAT_DIRECTORY_PULL_MS: '600000', CHAT_FAMILY_LINKS_MS: '2000' })])),
    });
    const { d1, d2, d3 } = fleet.relays;
    const doc = dir.signDirectory({
      v: 1, operator: { id: dir.operatorIdFor(operatorKey), key: operatorKey, name: 'Detour Ops' }, serial: 1, issuedAt: new Date().toISOString(),
      relays: [
        { id: d1.id, name: 'd1', origins: [d1.origin], region: 'inside-iran', gateway: 0, cluster: 'Inside' },
        { id: d2.id, name: 'd2', origins: [d2.origin], region: 'inside-iran', gateway: 0, cluster: 'Inside' },
        { id: d3.id, name: 'd3', origins: [d3.origin], region: 'outside-iran', gateway: 1, cluster: 'Outside' },
      ],
      revoked: [],
    }, operator.privateKey);
    const clients = [];
    try {
      await fleet.startAll();
      for (const name of ['d1', 'd2', 'd3']) await fleet.post(name, '/Monitor_Server/directory', doc);
      check('the three link with each other', await waitUntil(async () => (await fleet.linked('d1')).size === 2 && (await fleet.linked('d3')).size === 2, 30000));
      /* The path between d1 and d3 closes, the way a network can close one
         route while each end still reaches everybody else. */
      await fleet.post('d1', '/Monitor_Server/transit-remove', { id: d3.id });
      await fleet.post('d3', '/Monitor_Server/transit-remove', { id: d1.id });
      const apart = await waitUntil(async () => !(await fleet.linked('d1')).has(short(d3.id)) && !(await fleet.linked('d3')).has(short(d1.id)), 15000);
      check('d1 and d3 have no link of their own', apart, JSON.stringify([...await fleet.linked('d1')]));
      const sender = fleet.client('d1', 'detour-sender');
      const recipient = fleet.client('d3', 'detour-recipient');
      clients.push(sender, recipient);
      await sender.ready;
      await recipient.ready;
      await sleep(4500);
      sender.send({ ...sealTransit(d3.id, d3.key, { type: 'relay', toFingerprint: recipient.identity.fingerprint, persist: true, tag: 'dt1', payload: { type: 'offline-chat', inner: 'around-the-gap' } }), tag: 'dt1' });
      const arrived = await recipient.waitFor((message) => message.type === 'relay' && message.payload?.inner === 'around-the-gap', 15000).catch((error) => ({ error: error.message }));
      check('a message from a user of d1 still reaches a user of d3, through d2', arrived?.payload?.inner === 'around-the-gap', JSON.stringify(arrived).slice(0, 200));
      const carried = await fleet.post('d2', '/Monitor_Server/transit', {});
      const carriedBytes = (carried.peers || []).reduce((total, peer) => total + (peer.traffic?.bytes || 0), 0);
      check('and d2 is the one that carried it, sealed, without opening it', carriedBytes > 0 && !String(d2.output).includes('around-the-gap'), `${carriedBytes}`);
      sender.send({ ...sealTransit(d3.id, d3.key, { type: 'turn-query' }), tag: 'dt2' });
      const turn = await sender.waitFor((message) => message.tag === 'dt2', 15000).catch((error) => ({ error: error.message }));
      check('a call can get its TURN credentials from d3 the same way', turn?.type === 'turn', JSON.stringify(turn).slice(0, 160));
    } finally {
      for (const client of clients) client.close();
      await fleet.stopAll();
    }
  }
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n===== ${failed} failed of ${results.length} =====`);
  process.exit(failed ? 1 : 0);
}
