/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The network as a graph (docs/CONTROL-PANEL.md, "The network"), from what
 * the servers say: each relay of the family a node, in its cluster, with its
 * gateway place; each other operator's family one node; links between them
 * as edges. The panel builds it (tools/panel/server.mjs, /api/graph) and the
 * page draws it (graph.js); no HTML here, only data.
 *
 *   servers   the panel's rows: name, relayId, cluster, region, gateway, locked, reachable, inside
 *   transit   each server's /Monitor_Server/transit answer, by server name
 *   partners  each server's /Monitor_Server/partners answer, by server name
 */

const short = (id) => String(id || '').slice(0, 16);
const relayKey = (id) => `relay:${short(id)}`;
const partnerKey = (operatorId) => `partner:${short(operatorId)}`;
const regionCluster = (region) => (region === 'inside-iran' ? 'Iran' : region ? 'Outside' : '');

export function buildGraph({ servers = [], transit = {}, partners = {} } = {}) {
  const nodes = new Map();
  const edges = new Map();
  const answers = Object.values(transit).filter(Boolean);
  const directory = answers.map((answer) => answer.directory).filter(Boolean).sort((a, b) => (b.serial || 0) - (a.serial || 0))[0] || { relays: [] };
  const serverOf = (id) => servers.find((server) => short(server.relayId || server.signFor) === short(id));

  /* Gateway places in force: a dashboard's choice where one was made, the
     directory's otherwise. */
  const chosen = new Map();
  for (const answer of Object.values(partners)) for (const gateway of answer?.self?.gateways || []) if (!chosen.has(short(gateway.id))) chosen.set(short(gateway.id), Number(gateway.priority) || 0);

  for (const relay of directory.relays || []) {
    const server = serverOf(relay.id) || servers.find((candidate) => candidate.name === relay.name);
    nodes.set(relayKey(relay.id), {
      key: relayKey(relay.id), kind: 'relay', id: String(relay.id), name: String(relay.name || server?.name || short(relay.id)),
      cluster: String(relay.cluster || server?.cluster || regionCluster(relay.region)), region: String(relay.region || ''),
      gateway: chosen.has(short(relay.id)) ? chosen.get(short(relay.id)) : Number(relay.gateway) || 0,
      inside: Array.isArray(relay.inside) && relay.inside.length ? relay.inside.map(String) : (server?.inside || []),
      server: server?.name || '', locked: Boolean(server?.locked), reachable: server ? Boolean(server.reachable) : null,
    });
  }
  /* Servers the directory does not name (no family yet) are nodes too. */
  for (const server of servers) {
    const id = server.relayId || server.signFor;
    if (!id || nodes.has(relayKey(id))) continue;
    nodes.set(relayKey(id), {
      key: relayKey(id), kind: 'relay', id: String(id), name: server.name, cluster: String(server.cluster || regionCluster(server.region)), region: String(server.region || ''),
      gateway: Number(server.gateway) || 0, inside: server.inside || [], server: server.name, locked: Boolean(server.locked), reachable: Boolean(server.reachable),
    });
  }

  /* Each other operator, once, however many of our servers know them. */
  const partnerOf = new Map();
  for (const answer of Object.values(partners)) {
    for (const entry of answer?.partners || []) {
      const key = partnerKey(entry.operatorId);
      if (!nodes.has(key)) {
        nodes.set(key, {
          key, kind: 'partner', operatorId: String(entry.operatorId), name: String(entry.name || short(entry.operatorId)), state: String(entry.state || ''),
          path: String(entry.path || ''), gateways: (entry.gateways || []).map((gateway) => ({ id: String(gateway.id), name: String(gateway.name || ''), priority: Number(gateway.priority) || 0, linked: Boolean(gateway.linked) })),
        });
      }
      for (const id of [...(entry.relayIds || []), ...(entry.gateways || []).map((gateway) => gateway.id)]) partnerOf.set(short(id), key);
    }
  }

  const addEdge = (kind, from, to, linked, bytes = 0) => {
    const [a, b] = [from, to].sort();
    const key = `${kind}:${a}|${b}`;
    const known = edges.get(key);
    if (known) {
      known.linked = known.linked || linked;
      known.bytes += bytes;
    } else {
      edges.set(key, { key, kind, from, to, linked: Boolean(linked), bytes });
    }
  };

  for (const [serverName, answer] of Object.entries(transit)) {
    const server = servers.find((candidate) => candidate.name === serverName);
    const self = server && relayKey(server.relayId || server.signFor);
    if (!self || !nodes.has(self)) continue;
    for (const peer of answer?.peers || []) {
      const id = String(peer.fullId || peer.id || '');
      const bytes = Number(peer.traffic?.bytes) || 0;
      const toPartner = partnerOf.get(short(id));
      if (peer.kind === 'partner' || (toPartner && !nodes.has(relayKey(id)))) {
        if (toPartner) addEdge('partner', self, toPartner, peer.linked, bytes);
        continue;
      }
      const other = relayKey(id);
      if (!nodes.has(other)) {
        nodes.set(other, { key: other, kind: 'external', id, name: short(id), cluster: '', region: '', gateway: 0, inside: [], server: '', locked: false, reachable: null });
      }
      addEdge(peer.kind === 'manual' ? 'manual' : 'family', self, other, peer.linked, bytes);
    }
  }
  /* The partner side the relays report even before a link carries anything. */
  for (const node of nodes.values()) {
    if (node.kind !== 'partner') continue;
    for (const gateway of node.gateways) {
      if (!gateway.linked) continue;
      const ours = [...nodes.values()].filter((candidate) => candidate.kind === 'relay' && candidate.gateway > 0);
      if (ours.length && ![...edges.values()].some((edge) => edge.kind === 'partner' && (edge.from === node.key || edge.to === node.key))) addEdge('partner', ours[0].key, node.key, true);
    }
    if (node.path.startsWith('via:')) {
      const through = [...nodes.values()].find((candidate) => candidate.kind === 'partner' && short(candidate.operatorId) === short(node.path.slice(4)));
      if (through) addEdge('via', node.key, through.key, true);
    }
  }

  const list = [...edges.values()];
  const linkedPair = (a, b) => list.some((edge) => edge.linked && ((edge.from === a && edge.to === b) || (edge.from === b && edge.to === a)));
  const clusters = new Map();
  for (const node of nodes.values()) {
    if (node.kind !== 'relay') continue;
    if (!clusters.has(node.cluster)) clusters.set(node.cluster, []);
    clusters.get(node.cluster).push(node.key);
  }
  return {
    nodes: [...nodes.values()],
    edges: list,
    clusters: [...clusters.entries()].map(([name, members]) => ({
      name,
      members,
      /* Every member linked to every other: the cluster carries on alone. */
      independent: members.every((a) => members.every((b) => a === b || linkedPair(a, b))),
      connected: members.some((member) => list.some((edge) => edge.linked && (edge.from === member || edge.to === member)
        && !members.includes(edge.from === member ? edge.to : edge.from))),
    })),
  };
}
