/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Clusters and the operator key, as the panel changes them. A cluster is a
 * name on each of its relays in the signed family list, so every change to
 * one — made, renamed, filled, emptied — is planned here as the per-relay
 * edits the list already knows (tools/relay-directory.mjs editRelay). The
 * operator key is replaced server by server: each gets the new key and, at
 * once, the list signed with it, so no server is ever left trusting a key
 * no list it holds is signed by.
 */

const CLUSTER_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;
export const validCluster = (name) => CLUSTER_NAME.test(String(name || ''));

export function clusterView(draft) {
  const groups = new Map();
  for (const relay of draft?.relays || []) {
    if (!relay.cluster) continue;
    if (!groups.has(relay.cluster)) groups.set(relay.cluster, []);
    groups.get(relay.cluster).push(relay);
  }
  return [...groups.entries()].map(([name, members]) => ({
    name,
    members: members.map((relay) => relay.name),
    /* On its own when the international internet is cut: every member can be
       reached at an inside address. */
    independent: members.every((relay) => (relay.inside || []).length > 0),
    gateways: members.filter((relay) => Number(relay.gateway) > 0).sort((a, b) => a.gateway - b.gateway).map((relay) => relay.name),
  }));
}

export function planClusterChange(draft, change) {
  const relays = draft?.relays || [];
  const known = new Set(relays.map((relay) => relay.name));
  const named = (name) => { if (!validCluster(name)) throw new Error(`a cluster name is 1–40 letters, digits, spaces, dots, dashes or underscores (${String(name).slice(0, 50)})`); return String(name); };
  switch (change?.op) {
    case 'create':
    case 'members': {
      const name = named(change.name);
      const members = Array.isArray(change.servers) ? change.servers.map(String) : [];
      if (!members.length) throw new Error('a cluster needs at least one server');
      for (const member of members) if (!known.has(member)) throw new Error(`no server called ${member} in the family list`);
      const edits = [];
      for (const relay of relays) {
        if (members.includes(relay.name)) edits.push({ op: 'cluster', name: relay.name, cluster: name });
        else if (relay.cluster === name) edits.push({ op: 'cluster', name: relay.name, cluster: '' });
      }
      return edits;
    }
    case 'rename': {
      const to = named(change.to);
      const edits = relays.filter((relay) => relay.cluster === change.from).map((relay) => ({ op: 'cluster', name: relay.name, cluster: to }));
      if (!edits.length) throw new Error(`no cluster called ${String(change.from).slice(0, 40)}`);
      return edits;
    }
    case 'delete': {
      const edits = relays.filter((relay) => relay.cluster === change.name).map((relay) => ({ op: 'cluster', name: relay.name, cluster: '' }));
      if (!edits.length) throw new Error(`no cluster called ${String(change.name).slice(0, 40)}`);
      return edits;
    }
    case 'inside': {
      if (!known.has(String(change.server))) throw new Error(`no server called ${change.server} in the family list`);
      return [{ op: 'inside', name: String(change.server), inside: Array.isArray(change.inside) ? change.inside.map(String) : [] }];
    }
    default:
      throw new Error(`unknown cluster change ${String(change?.op).slice(0, 20)}`);
  }
}

/* Server by server: the new key, then at once the list signed with it. The
   first that fails is put back on its old key, and nothing after it is
   touched; the ones done keep the new key and a list it signed. */
export async function rotateOperator({ servers, applyKey, revertKey, deliver, log = () => {} }) {
  const done = [];
  for (const server of servers) {
    log(`▶ ${server.name}: the new key`);
    const applied = await applyKey(server);
    if (!applied.ok) {
      log(`✗ ${server.name}: ${applied.reason || 'the key was not taken'}; putting the old one back`);
      await revertKey(server);
      return { done, failed: { name: server.name, reason: applied.reason || '' } };
    }
    const taken = await deliver(server);
    if (!taken.ok) {
      log(`✗ ${server.name}: the new list was not taken (${taken.reason || ''}); putting the old key back`);
      await revertKey(server);
      return { done, failed: { name: server.name, reason: taken.reason || '' } };
    }
    log(`✓ ${server.name}: new key and new list`);
    done.push(server.name);
  }
  return { done, failed: null };
}
