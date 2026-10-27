/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The network tab: the graph of graphdata.js drawn in SVG, laid out by a
 * small force simulation that keeps each cluster together, and the controls
 * on it: drag a node (kept on this computer), drop a relay on another
 * cluster's frame or pick one to move it there (a signed family list), order
 * the gateways, link two relays by hand, and answer other operators. Every
 * change asks first, and a dangerous one is signed in this browser. */
import { signHeader } from './sign.js';
import { state, t, esc, num, api, hooks, show, explain, deviceListed, rowRef, button, allServers, regionText, report } from './ui.js';
import { runGroup, runOn } from './sections.js';

const PALETTE = 8;
const clusterClass = (() => {
  const seen = new Map();
  return (name) => {
    if (!seen.has(name)) seen.set(name, `c${seen.size % PALETTE}`);
    return seen.get(name);
  };
})();

/* ---- layout --------------------------------------------------------------- */

/* Positions for every node: the saved ones stay where the admin put them;
   the rest start around their cluster's centre and settle. */
export function layOut(graph, saved = {}) {
  const clusters = graph.clusters.map((entry) => entry.name);
  const radius = Math.max(260, clusters.length * 120);
  const centre = new Map(clusters.map((name, index) => {
    const angle = (2 * Math.PI * index) / Math.max(1, clusters.length) - Math.PI / 2;
    return [name, { x: Math.cos(angle) * radius * (clusters.length > 1 ? 1 : 0), y: Math.sin(angle) * radius * (clusters.length > 1 ? 1 : 0) }];
  }));
  const at = new Map();
  const pinned = new Set();
  graph.nodes.forEach((node, index) => {
    if (saved[node.key]) { at.set(node.key, { x: num(saved[node.key].x), y: num(saved[node.key].y) }); pinned.add(node.key); return; }
    const home = node.kind === 'relay' ? centre.get(node.cluster) || { x: 0, y: 0 } : null;
    const angle = index * 2.399;
    if (home) at.set(node.key, { x: home.x + Math.cos(angle) * 70, y: home.y + Math.sin(angle) * 70 });
    else at.set(node.key, { x: Math.cos(angle) * (radius + 260), y: Math.sin(angle) * (radius + 260) });
  });
  for (let round = 0; round < 160; round += 1) {
    const move = new Map(graph.nodes.map((node) => [node.key, { x: 0, y: 0 }]));
    for (const a of graph.nodes) {
      for (const b of graph.nodes) {
        if (a === b) continue;
        const pa = at.get(a.key); const pb = at.get(b.key);
        let dx = pa.x - pb.x; let dy = pa.y - pb.y;
        const d2 = Math.max(100, dx * dx + dy * dy);
        if (!dx && !dy) { dx = 1; dy = 0; }
        const push = 9000 / d2;
        move.get(a.key).x += (dx / Math.sqrt(d2)) * push;
        move.get(a.key).y += (dy / Math.sqrt(d2)) * push;
      }
    }
    for (const edge of graph.edges) {
      const pa = at.get(edge.from); const pb = at.get(edge.to);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x; const dy = pb.y - pa.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const pull = (d - 160) * 0.02;
      move.get(edge.from).x += (dx / d) * pull; move.get(edge.from).y += (dy / d) * pull;
      move.get(edge.to).x -= (dx / d) * pull; move.get(edge.to).y -= (dy / d) * pull;
    }
    for (const node of graph.nodes) {
      if (pinned.has(node.key)) continue;
      const home = node.kind === 'relay' ? centre.get(node.cluster) : null;
      const p = at.get(node.key);
      const m = move.get(node.key);
      if (home) { m.x += (home.x - p.x) * 0.03; m.y += (home.y - p.y) * 0.03; }
      p.x += Math.max(-20, Math.min(20, m.x));
      p.y += Math.max(-20, Math.min(20, m.y));
    }
  }
  return at;
}

/* Each cluster's frame: the box round its members. */
function frames(graph, at) {
  return graph.clusters.map((cluster) => {
    const points = cluster.members.map((key) => at.get(key)).filter(Boolean);
    if (!points.length) return null;
    const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
    return { cluster, x: Math.min(...xs) - 70, y: Math.min(...ys) - 70, w: Math.max(...xs) - Math.min(...xs) + 140, h: Math.max(...ys) - Math.min(...ys) + 150 };
  }).filter(Boolean);
}

/* ---- drawing -------------------------------------------------------------- */

function nodeSvg(node, p, selected) {
  const cls = node.kind === 'relay' ? clusterClass(node.cluster) : node.kind === 'partner' ? 'partner' : 'external';
  const state_ = node.kind === 'relay' && node.reachable === false ? ' unreachable' : '';
  const ring = node.kind === 'relay' && node.gateway > 0 ? `<circle r="27" class="gw-ring"/><text class="gw-num" x="20" y="-18">${num(node.gateway)}</text>` : '';
  const lock = node.locked ? '<text class="lock" x="-26" y="-16">🔒</text>' : '';
  const shape = node.kind === 'partner' ? '<rect x="-24" y="-18" width="48" height="36" rx="9"/>' : '<circle r="20"/>';
  const sub = node.kind === 'partner' ? t(`st${node.state.charAt(0).toUpperCase()}${node.state.slice(1)}`) : node.kind === 'relay' ? node.cluster : t('external');
  return `<g class="node ${cls}${state_}${selected ? ' selected' : ''}" data-node="${esc(node.key)}" transform="translate(${num(p.x).toFixed(1)},${num(p.y).toFixed(1)})">`
    + `${ring}${shape}${lock}<text class="label" y="38">${esc(node.name)}</text><text class="sub" y="52">${esc(sub)}</text></g>`;
}

function edgeSvg(edge, at) {
  const a = at.get(edge.from); const b = at.get(edge.to);
  if (!a || !b) return '';
  return `<line class="edge ${esc(edge.kind)} ${edge.linked ? 'up' : 'down'}" data-edge="${esc(edge.key)}" x1="${num(a.x).toFixed(1)}" y1="${num(a.y).toFixed(1)}" x2="${num(b.x).toFixed(1)}" y2="${num(b.y).toFixed(1)}"/>`;
}

function details(graph, key) {
  const node = graph.nodes.find((entry) => entry.key === key);
  if (!node) return `<p class="mut">${esc(t('pickNode'))}</p>`;
  if (node.kind === 'partner') {
    const server = allServers().find((entry) => entry.reachable);
    const ref = server ? rowRef({ server: server.name, operatorId: node.operatorId }) : '';
    const acts = !ref ? '' : node.state === 'incoming' ? button('partner-approve', ref, { cls: 'acc' }) + button('partner-reject', ref, { cls: 'bad' })
      : node.state === 'approved' || node.state === 'requested' ? button('partner-remove', ref, { cls: 'bad' }) : node.state === 'rejected' ? button('partner-approve', ref) : '';
    return `<h3>${esc(node.name)}</h3><div class="kv"><span>${esc(t('operatorId'))}</span><span class="mono">${esc(node.operatorId.slice(0, 16))}</span>
      <span>${esc(t('state'))}</span><span>${esc(t(`st${node.state.charAt(0).toUpperCase()}${node.state.slice(1)}`))}</span>
      <span>${esc(t('gateways'))}</span><span>${node.gateways.map((gateway) => `${esc(gateway.name || gateway.id)} #${num(gateway.priority)}`).join('، ') || '—'}</span></div><div class="row">${acts}</div>`;
  }
  const clusters = [...new Set(graph.clusters.map((entry) => entry.name))];
  const others = graph.nodes.filter((entry) => entry.kind === 'relay' && entry.key !== node.key && entry.server);
  const manual = graph.edges.filter((edge) => edge.kind === 'manual' && (edge.from === node.key || edge.to === node.key));
  const editable = state.cache.directory?.canEdit;
  return `<h3 id="nodeName">${esc(node.name)}</h3>
    <div class="kv"><span>${esc(t('id'))}</span><span class="mono">${esc(String(node.id).slice(0, 16))}</span>
      <span>${esc(t('cluster'))}</span><span>${esc(node.cluster || '—')}</span><span>${esc(t('region'))}</span><span>${esc(regionText(node.region))}</span>
      <span>${esc(t('gateway'))}</span><span>${node.gateway ? num(node.gateway) : '—'}</span>
      <span>${esc(t('state'))}</span><span>${node.reachable === false ? esc(t('unreachable')) : node.locked ? esc(t('locked')) : esc(t('unlocked'))}</span>
      <span>${esc(t('insideAddresses'))}</span><span class="mono">${esc((node.inside || []).join(' ') || '—')}</span></div>
    ${node.kind === 'relay' ? `<div class="grid">
      <div class="row"><select id="moveCluster">${clusters.map((name) => `<option${name === node.cluster ? ' selected' : ''}>${esc(name)}</option>`).join('')}<option value="__new">${esc(t('newCluster'))}</option></select>
        <button id="moveButton" data-node-key="${esc(node.key)}"${editable ? '' : ' disabled'}>${esc(t('moveToCluster'))}</button></div>
      <div class="row"><input id="insideInput" class="mono wide" value="${esc((node.inside || []).join(' '))}" placeholder="https://185.0.0.1:8585">
        <button id="insideButton" data-node-key="${esc(node.key)}"${editable ? '' : ' disabled'}>${esc(t('saveInside'))}</button></div>
      ${editable ? '' : `<p class="mut">${esc(t('directoryReadOnly'))}</p>`}
      ${node.server ? `<div class="row"><select id="linkTarget">${others.map((other) => `<option value="${esc(other.key)}">${esc(other.name)}</option>`).join('')}</select>
        <button id="linkButton" data-node-key="${esc(node.key)}">${esc(t('manualLink'))}</button></div>` : ''}
      ${manual.map((edge) => {
        const other = graph.nodes.find((entry) => entry.key === (edge.from === node.key ? edge.to : edge.from));
        return node.server && other ? `<div class="row"><span class="tag">${esc(t('manualLinkTo'))} ${esc(other.name)}</span>${button('transit-remove', rowRef({ server: node.server, id: other.id }), { cls: 'bad' })}</div>` : '';
      }).join('')}
      ${node.server ? `<button data-show-server="${esc(node.server)}">${esc(t('openServer'))}</button>` : ''}
    </div>` : ''}`;
}

function gatewayList(graph) {
  const relays = graph.nodes.filter((node) => node.kind === 'relay').sort((a, b) => (a.gateway || 99) - (b.gateway || 99) || a.name.localeCompare(b.name));
  const order = state.cache.gatewayOrder || relays.filter((node) => node.gateway > 0).map((node) => node.key);
  state.cache.gatewayOrder = order.filter((key) => relays.some((node) => node.key === key));
  const rest = relays.filter((node) => !state.cache.gatewayOrder.includes(node.key));
  const item = (node, index) => `<li draggable="true" data-gw-item="${esc(node.key)}"><span class="tag good">${index + 1}</span> ${esc(node.name)} <span class="mut">${esc(node.cluster)}</span>
    <button data-gw-up="${esc(node.key)}">▲</button><button data-gw-down="${esc(node.key)}">▼</button><button data-gw-out="${esc(node.key)}">✕</button></li>`;
  return `<ol class="gw-list" id="gatewayList">${state.cache.gatewayOrder.map((key, index) => item(relays.find((node) => node.key === key), index)).join('')}</ol>
    <div class="row">${rest.map((node) => `<button data-gw-in="${esc(node.key)}">+ ${esc(node.name)}</button>`).join('')}</div>
    <div class="row"><button class="acc" id="saveGateways">${esc(t('gwSave'))}</button></div>`;
}

export const network = {
  id: 'network', title: 'network',
  async load(poll) {
    const [graph, directory] = await Promise.all([api('/api/graph', undefined, { poll }), api('/api/directory', undefined, { poll })]);
    if (graph.httpStatus === 200) state.cache.network = graph;
    if (directory.httpStatus === 200) state.cache.directory = directory;
  },
  render() {
    const graph = state.cache.network;
    if (!graph?.nodes) return `<section class="card mut">${esc(t('loading'))}</section>`;
    /* Nodes stay where they were drawn last, so new data does not shuffle the
       picture; only a node never drawn before is placed afresh. */
    const memo = Object.fromEntries(state.cache.positions || []);
    for (const key of state.cache.replace || []) delete memo[key];
    state.cache.replace = [];
    const at = layOut(graph, { ...memo, ...(graph.layout || {}), ...(state.cache.dragged || {}) });
    state.cache.positions = at;
    const boxes = frames(graph, at);
    state.cache.frames = boxes;
    const xs = [...at.values()].map((p) => p.x); const ys = [...at.values()].map((p) => p.y);
    const minX = Math.min(...xs, 0) - 140; const minY = Math.min(...ys, 0) - 140;
    const width = Math.max(...xs, 0) - minX + 140; const height = Math.max(...ys, 0) - minY + 160;
    const svg = `<svg id="graph" class="graph" viewBox="${minX.toFixed(0)} ${minY.toFixed(0)} ${width.toFixed(0)} ${height.toFixed(0)}" role="img" aria-label="${esc(t('network'))}">`
      + boxes.map((box) => `<g data-cluster="${esc(box.cluster.name)}" class="frame ${clusterClass(box.cluster.name)}"><rect x="${box.x.toFixed(0)}" y="${box.y.toFixed(0)}" width="${box.w.toFixed(0)}" height="${box.h.toFixed(0)}" rx="18"/>`
        + `<text x="${(box.x + 14).toFixed(0)}" y="${(box.y + 22).toFixed(0)}">${esc(box.cluster.name)} · ${esc(box.cluster.independent ? t('independent') : t('notIndependent'))}</text></g>`).join('')
      + graph.edges.map((edge) => edgeSvg(edge, at)).join('')
      + graph.nodes.map((node) => nodeSvg(node, at.get(node.key), node.key === state.cache.selected)).join('')
      + '</svg>';
    const { found } = state.cache.relays || {};
    const servers = allServers().map((server) => `<option value="${esc(server.name)}">${esc(server.name)}</option>`).join('');
    return `<section class="card"><div class="row spread"><strong>${esc(t('network'))}</strong>
        <div class="row legend"><span class="edge-key family up">${esc(t('familyLink'))}</span><span class="edge-key family down">${esc(t('down'))}</span><span class="edge-key manual">${esc(t('manualLink'))}</span><span class="edge-key partner">${esc(t('partnerLink'))}</span><span class="edge-key via">${esc(t('pathVia'))}</span></div></div>
        <div class="graph-wrap">${svg}<aside class="card" id="nodeDetails">${details(graph, state.cache.selected)}</aside></div>
        <p class="mut">${esc(t('graphHint'))}</p></section>
      <section class="card"><strong>${esc(t('gateways'))}</strong><p class="mut">${esc(t('gwOrderHint'))}</p>${gatewayList(graph)}</section>
      <section class="card"><strong>${esc(t('partnerRequest'))}</strong>
        <div class="row" data-form="partner-lookup"><select data-field="server">${servers}</select><input data-field="origin" class="mono wide" placeholder="https://relay.example.com:8585"><button data-form-run="partner-lookup">${esc(t('lookup'))}</button>
        ${found ? `<span class="mut">${esc(found.name || '—')} · <span class="mono">${esc(String(found.id).slice(0, 16))}</span></span>${button('partner-request', rowRef(found), { cls: 'acc' })}` : ''}</div></section>`;
  },
  mount() {
    const svg = document.getElementById('graph');
    if (svg) wireDrag(svg);
  },
};

/* ---- the controls --------------------------------------------------------- */

function svgPoint(svg, event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX; point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function wireDrag(svg) {
  let drag = null;
  svg.addEventListener('pointerdown', (event) => {
    const node = event.target.closest('[data-node]');
    if (!node) return;
    const key = node.getAttribute('data-node');
    const p = state.cache.positions.get(key);
    const start = svgPoint(svg, event);
    drag = { key, node, dx: p.x - start.x, dy: p.y - start.y, moved: false, x: p.x, y: p.y };
    node.setPointerCapture?.(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const at = svgPoint(svg, event);
    drag.x = at.x + drag.dx; drag.y = at.y + drag.dy;
    if (Math.abs(drag.x - state.cache.positions.get(drag.key).x) + Math.abs(drag.y - state.cache.positions.get(drag.key).y) > 4) drag.moved = true;
    drag.node.setAttribute('transform', `translate(${drag.x.toFixed(1)},${drag.y.toFixed(1)})`);
    for (const line of svg.querySelectorAll('line[data-edge]')) {
      const edge = state.cache.network.edges.find((entry) => entry.key === line.getAttribute('data-edge'));
      if (edge?.from === drag.key) { line.setAttribute('x1', drag.x.toFixed(1)); line.setAttribute('y1', drag.y.toFixed(1)); }
      if (edge?.to === drag.key) { line.setAttribute('x2', drag.x.toFixed(1)); line.setAttribute('y2', drag.y.toFixed(1)); }
    }
  });
  svg.addEventListener('pointerup', async () => {
    if (!drag) return;
    const { key, moved, x, y } = drag;
    drag = null;
    if (!moved) { state.cache.selected = key; hooks.render(); return; }
    state.cache.dragged = { ...(state.cache.dragged || {}), [key]: { x, y } };
    await api('/api/layout', { positions: { [key]: { x: Math.round(x), y: Math.round(y) } } });
    /* Dropped on another cluster's frame: move it there, if the admin agrees. */
    const node = state.cache.network.nodes.find((entry) => entry.key === key);
    const into = (state.cache.frames || []).find((box) => x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h && box.cluster.name !== node?.cluster);
    if (node?.kind === 'relay' && into && state.cache.directory?.canEdit && confirm(`${t('confirmMoveCluster')} ${node.name} → ${into.cluster.name}`)) {
      await editDirectory([{ op: 'cluster', name: node.name, cluster: into.cluster.name }]);
    }
    hooks.render();
  });
}

/* A node moved to another cluster is placed afresh, near its new mates. */
async function placeAfresh(keys) {
  state.cache.replace = [...(state.cache.replace || []), ...keys];
  for (const key of keys) {
    if (state.cache.dragged) delete state.cache.dragged[key];
    if (state.cache.network?.layout) delete state.cache.network.layout[key];
  }
  await api('/api/layout', { positions: Object.fromEntries(keys.map((key) => [key, null])) });
}

/* A change to the family list, signed in this browser and by the operator key on the panel. */
export async function editDirectory(edits) {
  const directory = state.cache.directory;
  if (!directory?.canEdit) { show(t('directoryReadOnly')); return; }
  if (!deviceListed()) { show(t('signNeeded')); return; }
  const signature = await signHeader({ method: 'POST', path: '/control-panel/directory', body: { edits }, relay: directory.operatorId }, state.device);
  const answer = await api('/api/directory', { edits, signature });
  if (answer.ok) {
    show((answer.published || []).map((entry) => `${entry.server}: ${entry.ok ? 'ok' : 'error'} — ${t('familyListSerial')} ${num(answer.serial)}${entry.reason ? ` (${entry.reason})` : ''}`).join('\n'));
    await api('/api/family-refresh', {});
  } else {
    show(explain(answer));
  }
  await hooks.reload?.();
}

/* Clicks in the network tab; true when one was handled. */
export async function networkClick(target) {
  const graph = state.cache.network;
  if (!graph) return false;
  const nodeOf = (button_) => graph.nodes.find((entry) => entry.key === button_.getAttribute('data-node-key'));
  if (target.closest('#moveButton')) {
    const node = nodeOf(target.closest('#moveButton'));
    let cluster = document.getElementById('moveCluster').value;
    if (cluster === '__new') cluster = (prompt(t('newClusterPrompt')) || '').trim();
    if (!node || !cluster || cluster === node.cluster) return true;
    if (!confirm(`${t('confirmMoveCluster')} ${node.name} → ${cluster}`)) return true;
    await placeAfresh([node.key]);
    await editDirectory([{ op: 'cluster', name: node.name, cluster }]);
    return true;
  }
  if (target.closest('#insideButton')) {
    const node = nodeOf(target.closest('#insideButton'));
    const inside = document.getElementById('insideInput').value.split(/[\s,]+/).filter(Boolean);
    if (!node || !confirm(`${t('confirmInside')} ${node.name}: ${inside.join(' ') || '—'}`)) return true;
    await editDirectory([{ op: 'inside', name: node.name, inside }]);
    return true;
  }
  if (target.closest('#linkButton')) {
    const node = nodeOf(target.closest('#linkButton'));
    const other = graph.nodes.find((entry) => entry.key === document.getElementById('linkTarget').value);
    const origin = allServers().find((server) => server.name === other?.server)?.publicUrl || '';
    if (!node?.server || !other || !confirm(`${t('confirmManualLink')} ${node.name} → ${other.name}`)) return true;
    report([{ server: node.server, answer: await runOn('transit-add', node.server, { id: other.id, origin }) }]);
    await hooks.reload?.();
    return true;
  }
  const show_ = target.closest('[data-show-server]');
  if (show_) {
    state.filter.cluster = '';
    state.filter.hidden = new Set(allServers().map((server) => server.name).filter((name) => name !== show_.getAttribute('data-show-server')));
    state.tab = 'overview';
    hooks.render();
    return true;
  }
  const order = state.cache.gatewayOrder || [];
  const move = (key, by) => {
    const at = order.indexOf(key);
    const to = at + by;
    if (at < 0 || to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to], order[at]];
  };
  const up = target.closest('[data-gw-up]'); const down = target.closest('[data-gw-down]');
  const out = target.closest('[data-gw-out]'); const into = target.closest('[data-gw-in]');
  if (up) { move(up.getAttribute('data-gw-up'), -1); hooks.render(); return true; }
  if (down) { move(down.getAttribute('data-gw-down'), 1); hooks.render(); return true; }
  if (out) { state.cache.gatewayOrder = order.filter((key) => key !== out.getAttribute('data-gw-out')); hooks.render(); return true; }
  if (into) { state.cache.gatewayOrder = [...order, into.getAttribute('data-gw-in')]; hooks.render(); return true; }
  if (target.closest('#saveGateways')) {
    const gateways = order.map((key, index) => ({ id: graph.nodes.find((node) => node.key === key)?.id, priority: index + 1 })).filter((entry) => entry.id);
    const inside = order.some((key) => graph.nodes.find((node) => node.key === key)?.region === 'inside-iran');
    if (inside && !confirm(t('gwInsideIran'))) return true;
    await runGroup('gateways', allServers().filter((server) => server.reachable).map((server) => server.name), { body: { gateways } });
    state.cache.gatewayOrder = null;
    return true;
  }
  return false;
}

/* The gateway list also takes drag and drop. */
export function wireGatewayDrag(root) {
  let dragged = '';
  root.addEventListener('dragstart', (event) => { const item = event.target.closest?.('[data-gw-item]'); if (item) dragged = item.getAttribute('data-gw-item'); });
  root.addEventListener('dragover', (event) => { if (event.target.closest?.('[data-gw-item]')) event.preventDefault(); });
  root.addEventListener('drop', (event) => {
    const item = event.target.closest?.('[data-gw-item]');
    if (!item || !dragged) return;
    event.preventDefault();
    const order = state.cache.gatewayOrder || [];
    const from = order.indexOf(dragged); const to = order.indexOf(item.getAttribute('data-gw-item'));
    if (from < 0 || to < 0) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    dragged = '';
    hooks.render();
  });
}
