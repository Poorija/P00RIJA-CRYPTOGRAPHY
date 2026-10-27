/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The sections of the web panel: each section of a relay's own dashboard,
 * for every server shown, in tables with the server and its cluster on each
 * row. Each section reads (load) and draws (render); the buttons on a row
 * act on that row's server, the buttons above a table on every server shown.
 * How each action builds its request is in BODIES, GROUP_BODIES and FORMS. */
import { loadClusterAdmin, renderClusterAdmin, loadPanelSystem, renderPanelSystem } from './admin.js';
import {
  state, t, esc, num, pct, fmtBytes, fmtTime, serverCall, serverDownload, fanOut, shownServers, clusterOf, byCluster,
  rowRef, serverCells, button, groupButton, table, serverTable, card, show, explain, report, allServers, hooks, regionText, csvCell, visible,
} from './ui.js';
import { ACTIONS } from './actions.js';

const okResults = (results) => visible(results).filter((result) => result.ok);
const relayName = (id) => {
  const family = state.cache.relays?.transit?.find((result) => result.data?.directory)?.data.directory;
  return (family?.relays || []).find((relay) => String(relay.id).startsWith(String(id).slice(0, 16)))?.name || '';
};
const pick = (ref) => `<input type="checkbox" data-pick="${esc(ref)}">`;
const tag = (text, cls = '') => `<span class="tag ${esc(cls)}">${esc(text)}</span>`;
const serverOptions = () => shownServers().map((server) => `<option value="${esc(server.name)}">${esc(server.name)} · ${esc(clusterOf(server))}</option>`).join('');

/* ---- message queues ------------------------------------------------------- */

const queues = {
  id: 'queues', title: 'queues',
  async load(poll) {
    const [boxes, expiry] = await Promise.all([fanOut('/Monitor_Server/queues', { poll }), fanOut('/Monitor_Server/expiry-log', { poll })]);
    state.cache.queues = { ...state.cache.queues, boxes, expiry };
  },
  render() {
    const { boxes = [], expiry = [], mailbox } = state.cache.queues || {};
    const servers = serverTable(boxes, {
      extra: ['queued', 'bytes', 'held', 'transitWaiting'],
      cells: ({ data }) => [num(data.totals?.queued), esc(fmtBytes(data.totals?.bytes)), num(data.heldForConnected), num(data.transitWaiting)],
    });
    const rows = okResults(boxes).flatMap(({ server, data }) => (data.mailboxes || []).map((box) => {
      const ref = rowRef({ server: server.name, fingerprint: String(box.fingerprint || '') });
      return `<tr><td>${pick(ref)}</td>${serverCells(server)}<td><button class="link mono" data-open-mailbox="${esc(ref)}">${esc(box.fingerprint)}</button></td>`
        + `<td>${num(box.count)}</td><td>${esc(fmtBytes(box.bytes))}</td><td>${esc(fmtTime(box.oldestAt))}</td><td>${esc(fmtTime(box.newestAt))}</td><td>${button('queue-drop', ref, { cls: 'bad' })}</td></tr>`;
    }));
    const detail = mailbox ? card('mailbox', table(['index', 'id', 'from', 'type', 'size', 'queuedAt', ''], (mailbox.items || []).map((item) => {
      const ref = rowRef({ server: mailbox.server, fingerprint: mailbox.fingerprint, index: num(item.index) });
      return `<tr><td>${num(item.index)}</td><td class="mono">${esc(item.id)}</td><td class="mono">${esc(item.from)}</td><td>${tag(item.type, 'mut')}</td><td>${esc(fmtBytes(item.size))}</td><td>${esc(fmtTime(item.queuedAt))}</td><td>${button('queue-drop-item', ref, { cls: 'bad' })}</td></tr>`;
    })), `<span class="mut">${esc(mailbox.server)} · <span class="mono">${esc(mailbox.fingerprint)}</span></span>`) : '';
    const expiryRows = okResults(expiry).flatMap(({ server, data }) => (data.entries || []).slice(0, 100).map((entry) => {
      const row = Array.isArray(entry) ? entry : [entry.at || entry.time || '', entry.reason || entry.kind || '', entry.fingerprint || entry.to || '', entry.bytes || 0];
      return `<tr>${serverCells(server)}<td>${esc(fmtTime(row[0]))}</td><td>${tag(row[1], 'mut')}</td><td class="mono">${esc(String(row[2]).slice(0, 16))}</td><td>${Math.round(num(row[3]) / 1024)}</td></tr>`;
    }));
    return card('queues', servers, `${groupButton('queue-flush')}${groupButton('clear-offline', { cls: 'bad' })}`)
      + card('mailboxes', table(['', 'server', 'cluster', 'fingerprint', 'count', 'bytes', 'oldest', 'newest', ''], rows),
        `<button data-pick-run="queue-drop" class="bad">${esc(t('dropPicked'))}</button><button data-export="mailboxes">CSV</button>`)
      + detail
      + card('expiryLog', table(['server', 'cluster', 'at', 'reason', 'fingerprint', 'KB'], expiryRows));
  },
};

/* ---- users ---------------------------------------------------------------- */

const users = {
  id: 'users', title: 'users',
  async load(poll) {
    const [health, allow] = await Promise.all([fanOut('/healthz', { method: 'GET', poll }), fanOut('/admin/allowlist', { method: 'GET', poll })]);
    state.cache.users = { health, allow };
  },
  render() {
    const { health = [], allow = [] } = state.cache.users || {};
    const allowOf = (name) => allow.find((result) => result.server.name === name)?.data || {};
    const servers = serverTable(health, {
      extra: ['online', 'suspended', 'kicked', 'allowlist'],
      cells: ({ server, data }) => [num(data.peers), num((data.suspendedUsers || []).length), num((data.kickedUsers || []).length), allowOf(server.name).allowlistEnabled ? tag('ON', 'warn') : tag('OFF')],
      actions: ({ server }) => button('allowlist-mode', rowRef({ server: server.name })),
    });
    const online = okResults(health).flatMap(({ server, data }) => (data.peersList || []).map((peer) => {
      const label = String(peer.username || peer.peerId || '');
      const ref = rowRef({ server: server.name, clientId: String(peer.clientId || ''), fingerprint: String(peer.fingerprint || ''), label });
      return `<tr data-label="${esc(label)}"><td>${pick(ref)}</td>${serverCells(server)}<td>${esc(label)}</td><td class="mono">${esc(String(peer.fingerprint || peer.clientId || '').slice(0, 12))}</td>`
        + `<td class="mono">${esc(peer.ip)}</td><td>${esc(fmtTime(peer.connectedAt))}</td><td>${esc(fmtTime(peer.lastSeenAt))}</td>`
        + `<td>${typeof peer.crossRelayMinutes === 'number' ? tag(t('crossRelay'), 'warn') : ''}</td>`
        + `<td class="row">${button('suspend-peer', ref)}${button('kick-peer', ref, { cls: 'bad' })}</td></tr>`;
    }));
    const restricted = (field, act) => okResults(health).flatMap(({ server, data }) => (data[field] || []).map((entry) => {
      const key = String(entry.fingerprint || entry.clientId || entry.key || '');
      return `<tr>${serverCells(server)}<td class="mono">${esc(key.slice(0, 16))}</td><td>${button(act, rowRef({ server: server.name, fingerprint: key }))}</td></tr>`;
    }));
    const allowRows = okResults(allow).flatMap(({ server, data }) => (data.allowedUsers || []).map((entry) => {
      const fingerprint = String(entry.fingerprint || entry);
      return `<tr>${serverCells(server)}<td class="mono">${esc(fingerprint.slice(0, 24))}</td><td>${esc(entry.label || '')}</td><td>${button('allowlist-remove', rowRef({ server: server.name, fingerprint }), { cls: 'bad' })}</td></tr>`;
    }));
    return card('users', servers)
      + card('onlineUsers', table(['', 'server', 'cluster', 'name', 'fingerprint', 'ip', 'since', 'lastSeen', '', ''], online),
        `<button data-pick-run="suspend-peer">${esc(t('suspendPicked'))}</button><button data-pick-run="kick-peer" class="bad">${esc(t('kickPicked'))}</button><button data-export="users">CSV</button>`)
      + `<div class="cards">${card('suspended', table(['server', 'cluster', 'fingerprint', ''], restricted('suspendedUsers', 'resume-peer')))}${card('kicked', table(['server', 'cluster', 'fingerprint', ''], restricted('kickedUsers', 'unkick-peer')))}</div>`
      + card('allowlist', `${table(['server', 'cluster', 'fingerprint', 'label', ''], allowRows)}
        <div class="row" data-form="allowlist-add"><input data-field="fingerprint" class="mono wide" placeholder="${esc(t('fingerprint'))}"><input data-field="label" placeholder="${esc(t('label'))}"><button data-form-run="allowlist-add" class="acc">${esc(t('allowlistAddShown'))}</button></div>`)
      + card('messageCenter', `<div class="grid" data-form="announce">
          <input data-field="title" placeholder="${esc(t('msgTitle'))}">
          <textarea data-field="message" rows="3" placeholder="${esc(t('msgText'))}"></textarea>
          <input data-field="targets" class="mono" placeholder="${esc(t('msgTargets'))}">
          <div class="row"><select data-field="kind"><option value="">${esc(t('noAttachment'))}</option><option value="image">image</option><option value="file">file</option><option value="audio">audio</option><option value="sticker">sticker</option></select><input type="file" data-field="file"></div>
          <div class="row"><button data-form-run="announce" class="acc">${esc(t('announceShown'))}</button><button data-form-run="broadcast">${esc(t('broadcastShown'))}</button><span class="mut">${esc(t('announceHint'))}</span></div>
        </div>`);
  },
};

/* ---- relays: links, family and gateways, partners ------------------------- */

const relays = {
  id: 'relays', title: 'relays',
  async load(poll) {
    const [transit, partners] = await Promise.all([fanOut('/Monitor_Server/transit', { poll }), fanOut('/Monitor_Server/partners', { poll })]);
    state.cache.relays = { ...state.cache.relays, transit, partners };
  },
  render() {
    const { transit = [], partners = [], found } = state.cache.relays || {};
    const partnersOf = (name) => partners.find((result) => result.server.name === name)?.data || {};
    const servers = serverTable(transit, {
      extra: ['links', 'family', 'carryBetween'],
      cells: ({ server, data }) => [`${num(data.status?.up)}/${num(data.status?.allowed)}`, data.directory ? `${esc(data.directory.operator?.name)} #${num(data.directory.serial)}` : '—', partnersOf(server.name).self?.carryBetween ? tag('ON', 'good') : tag('OFF')],
      actions: ({ server }) => button('partner-carry', rowRef({ server: server.name, on: !partnersOf(server.name).self?.carryBetween })),
    });
    /* One editor for the family's gateways: the dashboard's choice where a
       server has one, the directory's otherwise. */
    const family = okResults(transit).find((result) => result.data.directory)?.data.directory;
    const chosen = {};
    for (const result of okResults(partners)) for (const gateway of result.data.self?.gateways || []) chosen[gateway.id] = gateway.priority;
    const priorityOf = (relay) => chosen[String(relay.id).slice(0, 16)] ?? relay.gateway ?? 0;
    const gatewayRows = (family?.relays || []).map((relay) => `<tr><td>${esc(relay.name || '—')}</td><td class="mono">${esc(String(relay.id).slice(0, 16))}</td>`
      + `<td>${esc(regionText(relay.region))}</td><td>${esc(relay.cluster || '—')}</td><td><select data-gw-id="${esc(relay.id)}" data-gw-region="${esc(relay.region || '')}">`
      + [0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}"${n === num(priorityOf(relay)) ? ' selected' : ''}>${n || '—'}</option>`).join('') + '</select></td></tr>');
    const links = okResults(transit).flatMap(({ server, data }) => (data.peers || []).map((peer) => {
      const ref = rowRef({ server: server.name, id: String(peer.fullId || peer.id) });
      return `<tr>${serverCells(server)}<td>${esc(relayName(peer.fullId || peer.id) || '—')}</td><td class="mono">${esc(String(peer.id).slice(0, 16))}</td><td class="mono">${esc(peer.origin || '—')}</td>`
        + `<td>${peer.linked ? tag(t('linked'), 'good') : tag(t('down'), 'bad')}</td><td>${tag(peer.kind || peer.role || '', 'mut')}</td><td>${num(peer.traffic?.carried)}</td><td>${esc(fmtBytes(peer.traffic?.bytes))}</td>`
        + `<td>${button('transit-remove', ref, { cls: 'bad' })}</td></tr>`;
    }));
    const STATE = { requested: 'stRequested', incoming: 'stIncoming', approved: 'stApproved', rejected: 'stRejected', removed: 'stRemoved' };
    const partnerRows = okResults(partners).flatMap(({ server, data }) => (data.partners || []).map((entry) => {
      const ref = rowRef({ server: server.name, operatorId: String(entry.operatorId || '') });
      const acts = entry.state === 'incoming' ? button('partner-approve', ref, { cls: 'acc' }) + button('partner-reject', ref, { cls: 'bad' })
        : entry.state === 'approved' || entry.state === 'requested' ? button('partner-remove', ref, { cls: 'bad' })
          : entry.state === 'rejected' ? button('partner-approve', ref) : '';
      const gateways = (entry.gateways || []).map((gateway) => `${esc(gateway.name || gateway.id)} #${num(gateway.priority)} ${gateway.linked ? tag(t('linked'), 'good') : tag(t('down'), 'bad')}`).join('<br>') || '—';
      return `<tr>${serverCells(server)}<td>${esc(entry.name || '—')}</td><td class="mono">${esc(String(entry.operatorId || '').slice(0, 16))}</td>`
        + `<td>${tag(t(STATE[entry.state] || 'unknown'), entry.state === 'incoming' ? 'warn' : entry.state === 'approved' ? 'good' : 'mut')}</td><td>${gateways}</td>`
        + `<td>${esc(entry.path === 'direct' ? t('pathDirect') : String(entry.path || '').startsWith('via:') ? `${t('pathVia')} ${entry.path.slice(4)}` : '—')}</td><td class="row">${acts}</td></tr>`;
    }));
    return card('relays', servers)
      + card('gateways', `${table(['name', 'id', 'region', 'cluster', 'priority'], gatewayRows)}<p class="mut">${esc(t('gwHint'))}</p>`, `${groupButton('gateways', { cls: 'acc' })}${groupButton('gateways-reset')}`)
      + card('links', `${table(['server', 'cluster', 'name', 'id', 'origin', 'state', 'kind', 'carried', 'bytes', ''], links)}
        <div class="row" data-form="transit-add"><select data-field="server">${serverOptions()}</select><input data-field="id" class="mono wide" placeholder="64-hex relay id"><input data-field="origin" class="mono" placeholder="https://relay.example.com:8585"><button data-form-run="transit-add" class="acc">${esc(t('transitAdd'))}</button></div>`)
      + card('partners', `${table(['server', 'cluster', 'name', 'operatorId', 'state', 'gateways', 'path', ''], partnerRows)}
        <div class="row" data-form="partner-lookup"><select data-field="server">${serverOptions()}</select><input data-field="origin" class="mono wide" placeholder="https://relay.example.com:8585"><button data-form-run="partner-lookup">${esc(t('lookup'))}</button>
        ${found ? `<span class="mut">${esc(found.name || '—')} · <span class="mono">${esc(String(found.id).slice(0, 16))}</span> · ${num(found.relays)} ${esc(t('foundRelays'))}</span>${button('partner-request', rowRef(found), { cls: 'acc' })}` : ''}</div>`);
  },
};

/* ---- traffic -------------------------------------------------------------- */

const traffic = {
  id: 'traffic', title: 'traffic',
  async load(poll) { state.cache.traffic = await fanOut('/Monitor_Server/traffic', { poll }); },
  render() {
    const results = state.cache.traffic || [];
    const totals = (data) => [num(data.totals?.msgsIn), num(data.totals?.msgsOut), esc(fmtBytes(data.totals?.bytesIn)), esc(fmtBytes(data.totals?.bytesOut)), num(data.totals?.relays)];
    const servers = serverTable(results, { extra: ['msgsIn', 'msgsOut', 'bytesIn', 'bytesOut', 'relayed'], cells: ({ data }) => totals(data) });
    const sums = byCluster(okResults(results).map((result) => result.server)).map(([cluster, members]) => {
      const sum = (key) => members.reduce((total, member) => total + num(results.find((result) => result.server.name === member.name)?.data.totals?.[key]), 0);
      return `<tr class="group"><td>${esc(cluster)}</td><td>${members.length}</td><td>${sum('msgsIn')}</td><td>${sum('msgsOut')}</td><td>${esc(fmtBytes(sum('bytesIn')))}</td><td>${esc(fmtBytes(sum('bytesOut')))}</td><td>${sum('relays')}</td></tr>`;
    });
    const clients = okResults(results).flatMap(({ server, data }) => (data.clients || []).slice(0, 50).map((row) => `<tr>${serverCells(server)}<td>${esc(row.label || '—')}</td><td class="mono">${esc(row.clientId)}</td><td>${num(row.msgsIn)}</td><td>${num(row.msgsOut)}</td><td>${esc(fmtBytes(num(row.bytesIn) + num(row.bytesOut)))}</td><td>${esc(fmtTime(row.lastAt))}</td></tr>`));
    const links = okResults(results).flatMap(({ server, data }) => (data.relays || []).map((row) => `<tr>${serverCells(server)}<td>${esc(relayName(row.relayId) || '—')}</td><td class="mono">${esc(row.relayId)}</td><td>${num(row.carried)}</td><td>${esc(fmtBytes(row.bytes))}</td><td>${esc(fmtTime(row.lastAt))}</td></tr>`));
    return card('traffic', servers, '<button data-export="traffic">CSV</button>')
      + card('clusterTotals', table(['cluster', 'servers', 'msgsIn', 'msgsOut', 'bytesIn', 'bytesOut', 'relayed'], sums))
      + card('topUsers', table(['server', 'cluster', 'name', 'id', 'msgsIn', 'msgsOut', 'bytes', 'lastAt'], clients))
      + card('relayTraffic', table(['server', 'cluster', 'name', 'id', 'carried', 'bytes', 'lastAt'], links));
  },
};

/* ---- the machine: backups, memory, disk, images, updates ------------------ */

const machine = {
  id: 'machine', title: 'machine',
  async load(poll) {
    const [backups, memory, disk, images, github] = await Promise.all([
      fanOut('/Monitor_Server/ops-backup-list', { poll }), fanOut('/Monitor_Server/ops-memory', { poll }), fanOut('/Monitor_Server/ops-disk', { poll }),
      fanOut('/Monitor_Server/ops-images', { poll }), fanOut('/Monitor_Server/ops-github-check', { poll }),
    ]);
    state.cache.machine = { backups, memory, disk, images, github };
  },
  render() {
    const { backups = [], memory = [], disk = [], images = [], github = [] } = state.cache.machine || {};
    const of = (list, name) => list.find((result) => result.server.name === name)?.data || {};
    const servers = serverTable(backups, {
      extra: ['backups', 'ram', 'disk', 'running', 'latest'],
      cells: ({ server, data }) => {
        const d = of(disk, server.name).disk || {};
        const g = of(github, server.name);
        return [num((data.backups || []).length), `${num(of(memory, server.name).host?.totalMb)} MB`, pct(num(d.total) - num(d.free), num(d.total)),
          esc(g.running?.version || '—'), `${esc(g.latest?.tag || '—')}${g.updateAvailable ? ` ${tag(t('updateAvailable'), 'warn')}` : ''}`];
      },
      actions: ({ server }) => { const ref = rowRef({ server: server.name }); return button('ops-image-export', ref) + button('ops-bundle', ref) + button('ops-github-rollback', ref, { cls: 'bad' }); },
    });
    const backupRows = okResults(backups).flatMap(({ server, data }) => (data.backups || []).map((row) => {
      const ref = rowRef({ server: server.name, name: String(row.name || '') });
      return `<tr>${serverCells(server)}<td class="mono">${esc(row.name)}</td><td>${esc(row.size)}</td><td class="row">${button('ops-backup-download', ref)}${button('ops-backup-restore', ref, { cls: 'bad' })}${button('ops-backup-delete', ref, { cls: 'bad' })}</td></tr>`;
    }));
    const containerRows = okResults(memory).flatMap(({ server, data }) => (data.containers || []).map((row) => {
      const ref = rowRef({ server: server.name, container: String(row.name || '') });
      const suggested = Math.max(128, Math.ceil((num(row.usageMb) * 2) / 64) * 64);
      return `<tr>${serverCells(server)}<td class="mono">${esc(String(row.name || '').replace('Poorija-Cryptography_', ''))}</td><td>${row.limitMb ? `${num(row.limitMb)} / ${num(row.usageMb)} MB` : `${esc(t('unlimited'))} / ${num(row.usageMb)} MB`}</td>`
        + `<td>${row.cpuPct != null ? `${num(row.cpuPct)}%` : '—'}</td><td><input type="number" min="0" max="16384" step="64" value="${suggested}" data-ram="${esc(ref)}" class="narrow"></td>`
        + `<td><input type="number" min="0" max="800" step="25" value="100" data-cpu="${esc(ref)}" class="narrow"></td><td>${button('ops-memory-set', ref, { cls: 'acc' })}</td></tr>`;
    }));
    const cleanupRows = okResults(disk).flatMap(({ server, data }) => [
      ...(data.cleanup?.staleSelfImages || []).map((image) => [server, 'stale', image]),
      ...(data.cleanup?.danglingImages || []).map((image) => [server, 'dangling', image]),
    ].map(([owner, kind, image]) => `<tr>${serverCells(owner)}<td>${tag(t(kind), 'mut')}</td><td class="mono">${esc(String(image.ref).slice(0, 48))}</td><td>${esc(fmtBytes(image.size))}</td><td>${button('ops-cleanup-image', rowRef({ server: owner.name, ref: String(image.ref || '') }), { cls: 'bad' })}</td></tr>`));
    const imageRows = okResults(images).flatMap(({ server, data }) => (data.images || []).slice(0, 30).map((image) => {
      const reference = `${image.repository}:${image.tag}`;
      const watched = /^(node|docker|coturn\/coturn|nginx|certbot\/certbot)/.test(String(image.repository));
      const ref = rowRef({ server: server.name, reference });
      return `<tr>${serverCells(server)}<td class="mono">${esc(image.repository)}</td><td>${esc(image.tag)}</td><td class="mono">${esc(String(image.id).slice(0, 19))}</td><td>${esc(fmtBytes(image.size))}</td><td>${esc(fmtTime(image.created))}</td>`
        + `<td class="row">${watched ? button('ops-image-check', ref) + button('ops-image-update', ref) : ''}</td></tr>`;
    }));
    return card('machine', servers, `${groupButton('ops-backup-create', { cls: 'acc' })}${groupButton('ops-github-apply')}${groupButton('ops-stack-restart', { cls: 'bad' })}`)
      + card('backups', table(['server', 'cluster', 'name', 'size', ''], backupRows))
      + card('containers', `${table(['server', 'cluster', 'container', 'ram', 'cpu', 'ramMb', 'cpuPct', ''], containerRows)}<p class="mut">${esc(t('ramHint'))}</p>`)
      + card('cleanup', table(['server', 'cluster', 'kind', 'image', 'size', ''], cleanupRows), groupButton('ops-cleanup-temps'))
      + card('images', table(['server', 'cluster', 'repository', 'tag', 'id', 'size', 'created', ''], imageRows));
  },
};

/* ---- reports -------------------------------------------------------------- */

const reports = {
  id: 'reports', title: 'reports',
  async load(poll) { state.cache.reports = await fanOut('/Monitor_Server/reports', { poll }); },
  render() {
    const results = state.cache.reports || [];
    const lastHour = (data) => {
      const last = (data.hourly || []).slice(-2);
      return last.length === 2 ? num(last[1].msgsIn) - num(last[0].msgsIn) : 0;
    };
    const servers = serverTable(results, { extra: ['activeCalls', 'transitActive', 'lastHour'], cells: ({ data }) => [num((data.activeCalls || []).length), num((data.transitActive || []).length), lastHour(data)] });
    const calls = okResults(results).flatMap(({ server, data }) => (data.activeCalls || []).map((call) => `<tr>${serverCells(server)}<td>${esc(call.username)}</td><td class="mono">${esc(call.peer)}</td><td>${tag(call.group ? 'group' : '1:1', call.group ? 'warn' : 'good')}</td><td>${esc(fmtTime(call.since))}</td></tr>`));
    const events = okResults(results).flatMap(({ server, data }) => (data.events || []).map((event) => ({ server, event })))
      .sort((a, b) => String(b.event.at).localeCompare(String(a.event.at))).slice(0, 200)
      .map(({ server, event }) => `<tr>${serverCells(server)}<td>${esc(fmtTime(event.at))}</td><td>${tag(event.kind, 'mut')}</td><td>${esc(event.text)}</td></tr>`);
    return card('reports', servers)
      + card('liveCalls', table(['server', 'cluster', 'name', 'peer', 'kind', 'since'], calls))
      + card('events', table(['server', 'cluster', 'at', 'kind', 'text'], events));
  },
};

/* ---- installing on another server ----------------------------------------- */

const bootstrap = {
  id: 'bootstrap', title: 'bootstrap',
  async load() { state.cache.bootstrap = shownServers().map((server) => ({ server, ok: server.reachable, data: {}, reason: server.reachable ? '' : 'unreachable' })); },
  render() {
    return card('bootstrap', `<p class="mut">${esc(t('bootstrapHint'))}</p>${serverTable(state.cache.bootstrap || [], {
      extra: ['address'], cells: ({ server }) => [`<span class="mono">${esc(server.publicUrl || '—')}</span>`],
      actions: ({ server }) => button('bootstrap-token', rowRef({ server: server.name })),
    })}`);
  },
};

/* ---- the system ----------------------------------------------------------- */

const system = {
  id: 'system', title: 'system',
  async load(poll) { [state.cache.system] = await Promise.all([fanOut('/healthz', { method: 'GET', poll }), loadPanelSystem()]); },
  render() {
    const results = state.cache.system || [];
    const servers = serverTable(results, {
      extra: ['host', 'node', 'uptime', 'turn', 'relayId'],
      cells: ({ data }) => [esc(data.hostname || '—'), esc(data.nodeVersion || '—'), `${Math.round(num(data.uptime) / 60)} min`, data.turnEnabled ? tag('on', 'good') : tag('off', 'bad'), `<span class="mono">${esc(String(data.relayId || '').slice(0, 16))}</span>`],
      actions: ({ server }) => `<button data-logs="${esc(rowRef({ server: server.name }))}">${esc(t('logs'))}</button>`,
    });
    return renderPanelSystem() + card('system', servers, `${groupButton('optimize-ram')}${groupButton('clear-memory', { cls: 'bad' })}${groupButton('alert-test')}`)
      + card('changePassword', `<div class="row" data-form="change-password"><select data-field="server">${serverOptions()}</select>
        <input type="password" data-field="oldPassword" autocomplete="off" placeholder="${esc(t('oldPassword'))}"><input type="password" data-field="newPassword" autocomplete="new-password" placeholder="${esc(t('newPassword'))}">
        <input type="password" data-field="newPassword2" autocomplete="new-password" placeholder="${esc(t('newPassword2'))}"><button data-form-run="change-password" class="acc">${esc(t('changePassword'))}</button></div>`);
  },
};

/* ---- clusters ------------------------------------------------------------- */

const clusters = {
  id: 'clusters', title: 'clusters',
  async load(poll) { [state.cache.clusters] = await Promise.all([fanOut('/Monitor_Server/transit', { poll }), loadClusterAdmin()]); },
  render() {
    const results = state.cache.clusters || [];
    const linkedTo = (name) => {
      const result = results.find((entry) => entry.server.name === name);
      return new Set((result?.data.peers || []).filter((peer) => peer.linked).map((peer) => String(peer.fullId || peer.id).slice(0, 16)));
    };
    const servers = allServers();
    const idOf = (server) => String(server.signFor || server.relayId || '').slice(0, 16);
    const rows = byCluster(servers).flatMap(([cluster, members]) => {
      const mates = (server) => members.filter((other) => other !== server && idOf(other));
      const inside = (server) => mates(server).filter((mate) => linkedTo(server.name).has(idOf(mate))).length;
      const outside = (server) => servers.filter((other) => clusterOf(other) !== cluster && idOf(other) && linkedTo(server.name).has(idOf(other))).length;
      const independent = members.every((server) => inside(server) === mates(server).length);
      const connected = members.some((server) => outside(server) > 0);
      const head = `<tr class="group"><td colspan="7">${esc(cluster)} — ${independent ? tag(t('independent'), 'good') : tag(t('notIndependent'), 'bad')} ${connected ? tag(t('connected'), 'good') : tag(t('isolated'), 'warn')}</td></tr>`;
      return [head, ...members.filter((server) => shownServers().includes(server)).map((server) => {
        const warn = server.region === 'inside-iran' && !(server.inside || []).length ? tag(t('noInsideAddress'), 'warn') : '';
        return `<tr data-server-row="${esc(server.name)}">${serverCells(server)}<td>${esc(regionText(server.region))}</td><td class="mono">${esc((server.inside || []).join(' ') || '—')}</td>`
          + `<td>${inside(server)}/${mates(server).length}</td><td>${outside(server)}</td><td>${warn}</td></tr>`;
      })];
    });
    return renderClusterAdmin() + card('clusters', `${table(['server', 'cluster', 'region', 'insideAddresses', 'inCluster', 'otherClusters', ''], rows)}<p class="mut">${esc(t('clustersHint'))}</p>`);
  },
};

export const SECTIONS = [queues, users, relays, traffic, machine, reports, bootstrap, system, clusters];

/* ---- how each action builds its request ----------------------------------- */

/* A row's action: the body from the row (null cancels). */
export const BODIES = {
  'queue-drop': (row) => ({ fingerprint: row.fingerprint }),
  'queue-drop-item': (row) => ({ fingerprint: row.fingerprint, index: row.index }),
  'kick-peer': (row) => policy(row),
  'suspend-peer': (row) => policy(row),
  'resume-peer': (row) => ({ fingerprint: row.fingerprint }),
  'unkick-peer': (row) => ({ fingerprint: row.fingerprint }),
  'allowlist-mode': () => ({}),
  'allowlist-remove': (row) => ({ fingerprint: row.fingerprint }),
  'transit-remove': (row) => ({ id: row.id }),
  'partner-approve': (row) => ({ operatorId: row.operatorId }),
  'partner-reject': (row) => ({ operatorId: row.operatorId }),
  'partner-remove': (row) => ({ operatorId: row.operatorId }),
  'partner-carry': (row) => ({ on: row.on === true }),
  'partner-request': (row) => ({ origin: row.origin, operatorId: row.id }),
  'ops-backup-download': (row) => ({ name: row.name }),
  'ops-backup-restore': (row) => ({ name: row.name }),
  'ops-backup-delete': (row) => ({ name: row.name }),
  'ops-memory-set': (row, ref) => ({ container: row.container, mb: num(document.querySelector(`[data-ram="${ref}"]`)?.value), cpu: num(document.querySelector(`[data-cpu="${ref}"]`)?.value) }),
  'ops-cleanup-image': (row) => ({ what: 'selected', refs: [row.ref] }),
  'ops-image-check': (row) => ({ reference: row.reference }),
  'ops-image-update': (row) => ({ reference: row.reference }),
  'ops-image-export': () => ({}),
  'ops-bundle': () => ({}),
  'ops-github-rollback': () => ({}),
  'bootstrap-token': () => ({}),
};
/* How long a kick or a suspension lasts: asked once for a click, however
   many rows it covers. */
let policyAsked = null;
function policy(row) {
  if (!policyAsked) {
    const answer = prompt(t('policyPrompt'), '60');
    if (answer === null) return null;
    policyAsked = { minutes: Math.max(0, Math.round(num(answer))) };
  }
  return { clientId: row.clientId, days: 0, hours: 0, minutes: policyAsked.minutes, permanent: policyAsked.minutes === 0 };
}

/* A group action's body, asked once for every server (null cancels). */
export const GROUP_BODIES = {
  'queue-flush': () => ({}),
  'clear-offline': () => ({}),
  'ops-backup-create': () => ({}),
  'ops-cleanup-temps': () => ({ what: 'temps' }),
  'ops-stack-restart': () => ({}),
  'optimize-ram': () => ({}),
  'clear-memory': () => ({}),
  'alert-test': () => ({}),
  'gateways-reset': () => ({ reset: true }),
  'ops-github-apply': () => {
    const latest = (state.cache.machine?.github || []).find((result) => result.data.latest?.tag)?.data.latest.tag || '';
    const tag_ = (prompt(t('tagPrompt'), String(latest).replace(/^v/, '')) || '').trim().replace(/^v/, '');
    return tag_ ? { tag: tag_ } : null;
  },
  gateways: () => {
    const picks = Array.from(document.querySelectorAll('[data-gw-id]')).map((select) => ({ id: select.getAttribute('data-gw-id'), priority: num(select.value), region: select.getAttribute('data-gw-region') })).filter((entry) => entry.priority > 0);
    if (picks.some((entry) => entry.region === 'inside-iran') && !confirm(t('gwInsideIran'))) return null;
    return { gateways: picks.map(({ id, priority }) => ({ id, priority })) };
  },
};

const fileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

/* A form: which action, with what body, on which servers (null cancels). */
export const FORMS = {
  'allowlist-add': async (fields) => (fields.fingerprint ? { act: 'allowlist-add', body: { fingerprint: fields.fingerprint, label: fields.label } } : null),
  announce: async (fields, box) => {
    if (!fields.message && !fields.kind) return null;
    const body = { message: fields.message, title: fields.title };
    if (fields.targets) body.targets = fields.targets.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const file = box.querySelector('[data-field="file"]')?.files?.[0];
    if (fields.kind && file) {
      if (file.size > 2 * 1024 * 1024) { show(t('attachmentTooLarge')); return null; }
      body.attachment = { kind: fields.kind, name: file.name, mimeType: file.type || 'application/octet-stream', dataUrl: await fileAsDataUrl(file) };
    }
    return { act: 'announce', body };
  },
  broadcast: async (fields) => (fields.message ? { act: 'broadcast', body: { message: fields.message } } : null),
  'transit-add': async (fields) => ({ act: 'transit-add', body: { id: fields.id.toLowerCase(), origin: fields.origin }, servers: [fields.server] }),
  'change-password': async (fields) => {
    if (!fields.newPassword || fields.newPassword !== fields.newPassword2) { show(t('passwordsDiffer')); return null; }
    return { act: 'change-password', body: { oldPassword: fields.oldPassword, newPassword: fields.newPassword }, servers: [fields.server], newPassword: fields.newPassword };
  },
};

/* What some answers mean, beyond ok. */
export async function afterAction(act, server, answer, extra = {}) {
  const data = answer?.answer || {};
  if (act === 'bootstrap-token' && data.token) {
    const base = `${String(serverNamed_(server)?.publicUrl || '').replace(/\/+$/, '')}/bootstrap`;
    show(`curl -sSL ${base}/install | bash -s -- ${base} ${data.token} ~/poorija-cryptography`);
    return true;
  }
  if (act === 'change-password' && answer?.ok && data.ok) {
    await fetch('/api/password', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ server, password: extra.newPassword }) });
  }
  return false;
}
const serverNamed_ = (name) => allServers().find((server) => server.name === name);

/* The partner lookup is a read with a form. */
export async function lookupPartner(fields) {
  const answer = await serverCall(fields.server, 'POST', '/Monitor_Server/partners/lookup', { origin: fields.origin });
  const data = answer.answer || {};
  if (!answer.ok || !data.ok) { show(explain(data.reason ? data : answer)); state.cache.relays = { ...state.cache.relays, found: null }; return; }
  state.cache.relays = { ...state.cache.relays, found: { server: fields.server, origin: fields.origin, id: data.operator?.id, name: data.operator?.name, relays: data.relays } };
}

/* A mailbox's messages, under the queues. */
export async function openMailbox(row) {
  const answer = await serverCall(row.server, 'POST', '/Monitor_Server/queue-mailbox', { fingerprint: row.fingerprint });
  state.cache.queues = { ...state.cache.queues, mailbox: { server: row.server, fingerprint: answer.answer?.fingerprint || row.fingerprint, items: answer.answer?.items || [] } };
}

export async function showLogs(row) {
  const answer = await serverCall(row.server, 'GET', '/healthz');
  show((answer.answer?.logs || []).slice(-200).map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') || explain(answer));
}

/* A table as CSV, with the server and cluster on each line. */
export function exportCsv(which) {
  const lines = [];
  if (which === 'users') {
    lines.push(['server', 'cluster', 'username', 'fingerprint', 'ip', 'connectedAt', 'lastSeenAt']);
    for (const { server, data, ok } of state.cache.users?.health || []) if (ok) for (const peer of data.peersList || []) lines.push([server.name, clusterOf(server), peer.username, peer.fingerprint, peer.ip, peer.connectedAt, peer.lastSeenAt]);
  } else if (which === 'mailboxes') {
    lines.push(['server', 'cluster', 'fingerprint', 'count', 'bytes', 'oldestAt', 'newestAt']);
    for (const { server, data, ok } of state.cache.queues?.boxes || []) if (ok) for (const box of data.mailboxes || []) lines.push([server.name, clusterOf(server), box.fingerprint, box.count, box.bytes, box.oldestAt, box.newestAt]);
  } else if (which === 'traffic') {
    lines.push(['server', 'cluster', 'clientId', 'label', 'msgsIn', 'msgsOut', 'bytesIn', 'bytesOut', 'lastAt']);
    for (const { server, data, ok } of state.cache.traffic || []) if (ok) for (const row of data.clients || []) lines.push([server.name, clusterOf(server), row.clientId, row.label, row.msgsIn, row.msgsOut, row.bytesIn, row.bytesOut, row.lastAt]);
  }
  const csv = lines.map((line) => line.map(csvCell).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  link.download = `${which}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

/* ---- running actions ------------------------------------------------------ */

/* One action on one server, signed here when it must be. */
export async function runOn(act, server, body, extra = {}) {
  const action = ACTIONS[act];
  if (action.download) {
    const answer = await serverDownload(server, action.path, body, extra.filename || `${server}-${act}${act === 'ops-backup-download' ? '' : '.tar.gz'}`);
    return { ok: answer.ok, answer: answer.ok ? { ok: true } : answer };
  }
  const answer = await serverCall(server, 'POST', action.path, body);
  return answer;
}

/* While an action runs, the page's own polling does not redraw under it. */
async function busy(work) {
  state.busy += 1;
  try { return await work(); } finally { state.busy -= 1; }
}

/* An action on a row's server. */
export const runRow = (act, ref) => busy(() => runRowNow(act, ref));
async function runRowNow(act, ref) {
  const row = state.rows.get(ref);
  const action = ACTIONS[act];
  if (!row || !action) return;
  if (action.confirm && !confirm(t(action.confirm))) return;
  policyAsked = null;
  const body = await (BODIES[act] || (() => ({})))(row, ref);
  if (body === null) return;
  const answer = await runOn(act, row.server, body, { filename: row.name });
  if (!(await afterAction(act, row.server, answer))) report([{ server: row.server, answer }]);
  await hooks.reload?.();
}

/* An action on every server shown, one after another. */
export const runGroup = (act, servers, given) => busy(() => runGroupNow(act, servers, given));
async function runGroupNow(act, servers = shownServers().filter((server) => server.reachable).map((server) => server.name), given) {
  const action = ACTIONS[act];
  if (!action || !servers.length) return;
  if (action.confirm && !confirm(`${t(action.confirm)}\n${servers.join(', ')}`)) return;
  const body = given ? given.body : await (GROUP_BODIES[act] || (() => ({})))();
  if (body === null) return;
  const lines = [];
  for (const server of servers) {
    const answer = await runOn(act, server, body);
    lines.push({ server, answer });
    if (!given) report(lines);
    await afterAction(act, server, answer, given || {});
    if (action.oneByOne && !(answer.ok && answer.answer?.ok !== false)) break;
  }
  report(lines);
  await hooks.reload?.();
}

/* The rows ticked in a table, each on its own server: their data taken
   before anything is awaited. */
export const runPicked = (act) => busy(() => runPickedNow(act));
async function runPickedNow(act) {
  const picked = Array.from(document.querySelectorAll('[data-pick]:checked')).map((box) => [box.getAttribute('data-pick'), state.rows.get(box.getAttribute('data-pick'))]).filter(([, row]) => row);
  if (!picked.length) { show(t('nothingPicked')); return; }
  const action = ACTIONS[act];
  if (!confirm(`${t(action.label)} × ${picked.length}?`)) return;
  policyAsked = null;
  const lines = [];
  for (const [ref, row] of picked) {
    const body = await (BODIES[act] || (() => ({})))(row, ref);
    if (!body) continue;
    lines.push({ server: `${row.server} ${row.label || row.fingerprint || ''}`.trim(), answer: await runOn(act, row.server, body) });
  }
  report(lines);
  await hooks.reload?.();
}

/* A form's action. */
export async function runForm(id, box) {
  const fields = Object.fromEntries(Array.from(box.querySelectorAll('[data-field]')).filter((field) => field.type !== 'file').map((field) => [field.getAttribute('data-field'), String(field.value || '').trim()]));
  if (id === 'partner-lookup') { await lookupPartner(fields); hooks.render(); return; }
  const plan = await FORMS[id]?.(fields, box);
  if (!plan) return;
  await runGroup(plan.act, plan.servers, plan);
  if (id === 'change-password') box.querySelectorAll('input').forEach((input) => { input.value = ''; });
}

