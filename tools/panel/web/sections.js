/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The monitoring sections of the web panel: each section of a relay's own
 * dashboard, for every server shown, in tables with the server and its
 * cluster on each row. Each section reads (load) and draws (render), split
 * into sub-tabs, and each long list can be grouped (by server, cluster,
 * region, or what that list has: a mailbox's size, an event's kind, a link's
 * state) and searched. The buttons on a row act on that row's server, the
 * buttons above a table on every server shown. How each action builds its
 * request is in BODIES, GROUP_BODIES and FORMS. */
import {
  state, t, esc, num, fmtBytes, fmtTime, serverCall, serverDownload, fanOut, shownServers, clusterOf, byCluster, api,
  rowRef, serverCells, button, groupButton, table, serverTable, card, show, explain, report, allServers, hooks, regionText, csvCell, visible,
  subtabs, groupPicker, viewPicker, groupLabel, groupItems, grouped, searchBox, saveFile, fmtNum, tag, kpi, forgetReads,
} from './ui.js';
import { ACTIONS } from './actions.js';
import { barChart, donut, colorOf, sparkline } from './charts.js';
import { loadMetrics, chartsFor, RANGES } from './overview.js';
import { reports } from './reports.js';

const okResults = (results) => visible(results).filter((result) => result.ok);
const relayName = (id) => {
  const family = [...(state.cache.relays?.transit || []), ...(state.cache.users?.transit || [])].find((result) => result.data?.directory)?.data.directory;
  return (family?.relays || []).find((relay) => String(relay.id).startsWith(String(id).slice(0, 16)))?.name || '';
};
const pick = (ref) => `<input type="checkbox" data-pick="${esc(ref)}">`;
const serverOptions = () => shownServers().map((server) => `<option value="${esc(server.name)}">${esc(server.name)} · ${esc(clusterOf(server))}</option>`).join('');
const serverOf = (name) => allServers().find((server) => server.name === name);
/* The key a row is grouped by, for the modes every list has. */
const byMode = (mode, server) => groupLabel(server, mode);
const kpis = (list) => `<div class="kpis">${list.join('')}</div>`;
const sizeBucket = (bytes) => (num(bytes) < 100 * 1024 ? t('sizeSmall') : num(bytes) < 5 * 1024 * 1024 ? t('sizeMedium') : t('sizeLarge'));
const ageBucket = (when) => {
  const age = Date.now() - new Date(when || 0).getTime();
  if (!Number.isFinite(age) || age < 0) return t('ageUnknown');
  if (age < 3600000) return t('ageHour');
  if (age < 86400000) return t('ageDay');
  if (age < 7 * 86400000) return t('ageWeek');
  return t('ageOlder');
};

/* ---- message queues ------------------------------------------------------- */

const queues = {
  id: 'queues', title: 'queues',
  async load(poll) {
    const [boxes, expiry] = await Promise.all([fanOut('/Monitor_Server/queues', { poll }), fanOut('/Monitor_Server/expiry-log', { poll })]);
    state.cache.queues = { ...state.cache.queues, boxes, expiry };
  },
  render() {
    const { boxes = [], expiry = [], mailbox } = state.cache.queues || {};
    const mailboxes = okResults(boxes).flatMap(({ server, data }) => (data.mailboxes || []).map((box) => ({ server, box })));
    const entries = okResults(expiry).flatMap(({ server, data }) => (data.entries || []).slice(0, 500).map((entry) => {
      const row = Array.isArray(entry) ? entry : [entry.at || entry.time || '', entry.reason || entry.kind || '', entry.fingerprint || entry.to || '', entry.bytes || 0];
      return { server, at: row[0], reason: String(row[1] || '—'), fingerprint: String(row[2] || ''), bytes: num(row[3]) };
    }));
    const tabs = subtabs('queues', [['summary', 'queueSummary'], ['servers', 'queuesByServer'], ['mailboxes', 'mailboxes', mailboxes.length], ['expiry', 'expiryLog', entries.length]]);
    let body = '';
    if (tabs.current === 'summary') {
      const totals = okResults(boxes).map(({ server, data }) => ({ server, queued: num(data.totals?.queued), bytes: num(data.totals?.bytes), held: num(data.heldForConnected), transit: num(data.transitWaiting) }));
      const reasons = groupItems(entries, (entry) => entry.reason);
      body = kpis([
        kpi('queued', fmtNum(totals.reduce((sum, row) => sum + row.queued, 0)), fmtBytes(totals.reduce((sum, row) => sum + row.bytes, 0))),
        kpi('mailboxes', fmtNum(mailboxes.length)),
        kpi('held', fmtNum(totals.reduce((sum, row) => sum + row.held, 0))),
        kpi('transitWaiting', fmtNum(totals.reduce((sum, row) => sum + row.transit, 0))),
        kpi('expiryLog', fmtNum(entries.length)),
      ]) + `<div class="charts">${barChart({ title: t('queuedByServer'), items: totals.map((row) => ({ label: row.server.name, values: [row.queued] })), keys: [{ label: t('queued'), color: colorOf(0) }] })}
        ${donut({ title: t('queuedByCluster'), items: byCluster(totals.map((row) => row.server)).map(([cluster, members], index) => ({ label: cluster, value: members.reduce((sum, member) => sum + (totals.find((row) => row.server === member)?.queued || 0), 0), color: colorOf(index) })) })}
        ${donut({ title: t('expiryByReason'), items: reasons.map(([reason, list], index) => ({ label: reason, value: list.length, color: colorOf(index) })) })}
        ${donut({ title: t('mailboxesBySize'), items: groupItems(mailboxes, ({ box }) => sizeBucket(box.bytes)).map(([label, list], index) => ({ label, value: list.length, color: colorOf(index + 3) })) })}</div>`;
    } else if (tabs.current === 'servers') {
      body = serverTable(boxes, {
        extra: ['queued', 'bytes', 'held', 'transitWaiting'],
        cells: ({ data }) => [num(data.totals?.queued), esc(fmtBytes(data.totals?.bytes)), num(data.heldForConnected), num(data.transitWaiting)],
      });
    } else if (tabs.current === 'mailboxes') {
      const mode = groupPicker('queues:boxGroup', ['server', 'cluster', 'region', 'size', 'age', 'none'], 'server');
      const keyOf = ({ server, box }) => (mode.current === 'size' ? sizeBucket(box.bytes) : mode.current === 'age' ? ageBucket(box.oldestAt) : byMode(mode.current, server));
      const rowsOf = (list) => table(['', 'server', 'cluster', 'fingerprint', 'count', 'bytes', 'oldest', 'newest', ''], list.map(({ server, box }) => {
        const ref = rowRef({ server: server.name, fingerprint: String(box.fingerprint || '') });
        return `<tr><td>${pick(ref)}</td>${serverCells(server)}<td><button class="link mono" data-open-mailbox="${esc(ref)}">${esc(box.fingerprint)}</button></td>`
          + `<td>${num(box.count)}</td><td>${esc(fmtBytes(box.bytes))}</td><td>${esc(fmtTime(box.oldestAt))}</td><td>${esc(fmtTime(box.newestAt))}</td><td>${button('queue-drop', ref, { cls: 'bad' })}</td></tr>`;
      }));
      body = `<div class="toolbar">${mode.html}${searchBox('mailboxes')}<button data-pick-run="queue-drop" class="bad">${esc(t('dropPicked'))}</button><button data-export="mailboxes">CSV</button></div>
        <div data-searchable="mailboxes">${grouped('mailboxes', groupItems(mailboxes, keyOf), rowsOf, { summary: (list) => esc(`${list.reduce((sum, { box }) => sum + num(box.count), 0)} ${t('messages')} · ${fmtBytes(list.reduce((sum, { box }) => sum + num(box.bytes), 0))}`) })}</div>`;
      if (mailbox) {
        body += card('mailbox', table(['index', 'id', 'from', 'type', 'size', 'queuedAt', ''], (mailbox.items || []).map((item) => {
          const ref = rowRef({ server: mailbox.server, fingerprint: mailbox.fingerprint, index: num(item.index) });
          return `<tr><td>${num(item.index)}</td><td class="mono">${esc(item.id)}</td><td class="mono">${esc(item.from)}</td><td>${tag(item.type, 'mut')}</td><td>${esc(fmtBytes(item.size))}</td><td>${esc(fmtTime(item.queuedAt))}</td><td>${button('queue-drop-item', ref, { cls: 'bad' })}</td></tr>`;
        })), `<span class="mut">${esc(mailbox.server)} · <span class="mono">${esc(mailbox.fingerprint)}</span></span>`);
      }
    } else {
      const mode = groupPicker('queues:expiryGroup', ['reason', 'server', 'cluster', 'none'], 'reason');
      const keyOf = (entry) => (mode.current === 'reason' ? entry.reason : byMode(mode.current, entry.server));
      const rowsOf = (list) => table(['server', 'cluster', 'at', 'reason', 'fingerprint', 'KB'], list.map((entry) => `<tr>${serverCells(entry.server)}<td>${esc(fmtTime(entry.at))}</td><td>${tag(entry.reason, 'mut')}</td><td class="mono">${esc(entry.fingerprint.slice(0, 16))}</td><td>${Math.round(entry.bytes / 1024)}</td></tr>`));
      body = `<div class="toolbar">${mode.html}${searchBox('expiry')}<button data-export="expiry">CSV</button></div>
        <div class="chips-row">${groupItems(entries, (entry) => entry.reason).map(([reason, list]) => `<span class="chip">${esc(reason)} <strong>${list.length}</strong></span>`).join('')}</div>
        <div data-searchable="expiry">${grouped('expiry', groupItems(entries, keyOf), rowsOf, { summary: (list) => esc(fmtBytes(list.reduce((sum, entry) => sum + entry.bytes, 0))) })}</div>`;
    }
    return card('queues', tabs.html + body, `${groupButton('queue-flush')}${groupButton('clear-offline', { cls: 'bad' })}`);
  },
};

/* ---- users ---------------------------------------------------------------- */

/* Who sends what to where: a scope (every server, a cluster, one server,
   or a hand-picked few), then the message. */
function messageCenter() {
  const clusters = [...new Set(shownServers().map(clusterOf))];
  return `<div class="grid" data-form="announce">
      <div class="row wrap"><span class="mut">${esc(t('sendTo'))}</span>
        <label class="check"><input type="radio" name="msgScope" data-field="scope" value="all" checked> ${esc(t('scopeAll'))}</label>
        <label class="check"><input type="radio" name="msgScope" data-field="scope" value="cluster"> ${esc(t('scopeCluster'))}</label>
        <select data-field="cluster">${clusters.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select>
        <label class="check"><input type="radio" name="msgScope" data-field="scope" value="server"> ${esc(t('scopeServer'))}</label>
        <select data-field="server">${serverOptions()}</select>
        <label class="check"><input type="radio" name="msgScope" data-field="scope" value="picked"> ${esc(t('scopePicked'))}</label></div>
      <div class="checks">${shownServers().map((server) => `<label class="check"><input type="checkbox" data-msg-server="${esc(server.name)}"> ${esc(server.name)} <span class="mut">${esc(clusterOf(server))}</span></label>`).join('')}</div>
      <input data-field="title" placeholder="${esc(t('msgTitle'))}">
      <textarea data-field="message" rows="3" placeholder="${esc(t('msgText'))}"></textarea>
      <input data-field="targets" class="mono" placeholder="${esc(t('msgTargets'))}">
      <div class="row"><select data-field="kind"><option value="">${esc(t('noAttachment'))}</option><option value="image">image</option><option value="file">file</option><option value="audio">audio</option><option value="sticker">sticker</option></select><input type="file" data-field="file"></div>
      <div class="row"><button data-form-run="announce" class="acc">${esc(t('announceShown'))}</button><button data-form-run="broadcast">${esc(t('broadcastShown'))}</button><span class="mut">${esc(t('announceHint'))}</span></div>
    </div>`;
}

const users = {
  id: 'users', title: 'users',
  async load(poll) {
    const [health, allow, transit] = await Promise.all([fanOut('/healthz', { method: 'GET', poll }), fanOut('/admin/allowlist', { method: 'GET', poll }), fanOut('/Monitor_Server/transit', { poll })]);
    state.cache.users = { health, allow, transit };
  },
  render() {
    const { health = [], allow = [], transit = [] } = state.cache.users || {};
    const allowOf = (name) => allow.find((result) => result.server.name === name)?.data || {};
    const online = okResults(health).flatMap(({ server, data }) => (data.peersList || []).map((peer) => ({ server, peer })));
    const restrictedOf = (field) => okResults(health).flatMap(({ server, data }) => (data[field] || []).map((entry) => ({ server, key: String(entry.fingerprint || entry.clientId || entry.key || '') })));
    const suspended = restrictedOf('suspendedUsers');
    const kicked = restrictedOf('kickedUsers');
    const allowRows = okResults(allow).flatMap(({ server, data }) => (data.allowedUsers || []).map((entry) => ({ server, fingerprint: String(entry.fingerprint || entry), label: entry.label || '' })));
    const tabs = subtabs('users', [['online', 'onlineUsers', online.length], ['byRelay', 'usersByRelay'], ['pairs', 'relayPairs'], ['restricted', 'restricted', suspended.length + kicked.length], ['allowlist', 'allowlist', allowRows.length], ['messages', 'messageCenter']]);
    const userRow = ({ server, peer }) => {
      const label = String(peer.username || peer.peerId || '');
      const ref = rowRef({ server: server.name, clientId: String(peer.clientId || ''), fingerprint: String(peer.fingerprint || ''), label });
      return `<tr data-label="${esc(label)}"><td>${pick(ref)}</td>${serverCells(server)}<td>${esc(label)}</td><td class="mono">${esc(String(peer.fingerprint || peer.clientId || '').slice(0, 12))}</td>`
        + `<td class="mono">${esc(peer.ip)}</td><td>${esc(fmtTime(peer.connectedAt))}</td><td>${esc(fmtTime(peer.lastSeenAt))}</td>`
        + `<td>${typeof peer.crossRelayMinutes === 'number' ? tag(`${t('crossRelay')} · ${num(peer.crossRelayMinutes)}′`, 'warn') : ''}</td>`
        + `<td class="row">${button('suspend-peer', ref)}${button('kick-peer', ref, { cls: 'bad' })}</td></tr>`;
    };
    const userTable = (list) => table(['', 'server', 'cluster', 'name', 'fingerprint', 'ip', 'since', 'lastSeen', '', ''], list.map(userRow));
    let body = '';
    if (tabs.current === 'online') {
      const mode = groupPicker('users:group', ['server', 'cluster', 'region', 'none'], 'server');
      body = serverTable(health, {
        extra: ['online', 'suspended', 'kicked', 'allowlist'],
        cells: ({ server, data }) => [num(data.peers), num((data.suspendedUsers || []).length), num((data.kickedUsers || []).length), allowOf(server.name).allowlistEnabled ? tag('ON', 'warn') : tag('OFF')],
        actions: ({ server }) => button('allowlist-mode', rowRef({ server: server.name })),
      }) + `<div class="toolbar">${mode.html}${searchBox('users')}<button data-pick-run="suspend-peer">${esc(t('suspendPicked'))}</button><button data-pick-run="kick-peer" class="bad">${esc(t('kickPicked'))}</button><button data-export="users">CSV</button></div>
        <div data-searchable="users">${grouped('users', groupItems(online, ({ server }) => byMode(mode.current, server)), userTable)}</div>`;
    } else if (tabs.current === 'byRelay') {
      /* Each relay with the people on it now, and how many crossed to another relay lately. */
      body = `<div class="toolbar">${searchBox('byrelay')}</div><div class="relay-cards" data-searchable="byrelay">${visible(health).map(({ server, ok, data }) => {
        const mine = online.filter((entry) => entry.server === server);
        const crossing = mine.filter(({ peer }) => typeof peer.crossRelayMinutes === 'number').length;
        return `<details class="grp" data-grp="${esc(`byrelay:${server.name}`)}"${state.folded.has(`byrelay:${server.name}`) ? '' : ' open'}><summary><strong>${esc(server.name)}</strong> <span class="mut">${esc(clusterOf(server))} · ${esc(regionText(server.region))}</span>
          <span class="count">${ok ? mine.length : '—'}</span> ${crossing ? tag(`${t('crossRelay')} ${crossing}`, 'warn') : ''} ${ok ? '' : tag(t('unreachable'), 'bad')}</summary>
          ${ok ? userTable(mine) : `<p class="mut">${esc(t('unreachable'))}</p>`}${ok ? `<p class="mut small">${esc(t('calls'))}: ${num(data.activeCalls)} · ${esc(t('suspended'))}: ${num((data.suspendedUsers || []).length)}</p>` : ''}</details>`;
      }).join('')}</div>`;
    } else if (tabs.current === 'pairs') {
      /* Relays talking to each other: every link a server holds, both ends,
         what it carried, and the people on each end who used a link lately. */
      const pairs = new Map();
      for (const { server, data } of okResults(transit)) {
        for (const peer of data.peers || []) {
          const other = relayName(peer.fullId || peer.id) || String(peer.id).slice(0, 12);
          const key = [server.name, other].sort().join(' ⇄ ');
          const entry = pairs.get(key) || { key, ends: new Set(), linked: false, carried: 0, bytes: 0, kinds: new Set() };
          entry.ends.add(server.name);
          entry.ends.add(other);
          entry.linked = entry.linked || Boolean(peer.linked);
          entry.carried += num(peer.traffic?.carried);
          entry.bytes += num(peer.traffic?.bytes);
          entry.kinds.add(peer.kind || peer.role || 'family');
          pairs.set(key, entry);
        }
      }
      const crossers = (name) => online.filter(({ server, peer }) => server.name === name && typeof peer.crossRelayMinutes === 'number').length;
      const list = [...pairs.values()].sort((a, b) => Number(b.linked) - Number(a.linked) || b.carried - a.carried);
      const matrixNames = [...new Set(list.flatMap((entry) => [...entry.ends]))];
      const cell = (a, b) => {
        if (a === b) return '<td class="mut">·</td>';
        const entry = pairs.get([a, b].sort().join(' ⇄ '));
        return entry ? `<td>${entry.linked ? tag('●', 'good') : tag('○', 'bad')} <span class="mut small">${fmtNum(entry.carried)}</span></td>` : '<td class="mut">—</td>';
      };
      body = `<p class="mut">${esc(t('pairsHint'))}</p><div class="scroll"><table class="matrix"><thead><tr><th></th>${matrixNames.map((name) => `<th>${esc(name)}</th>`).join('')}</tr></thead><tbody>${matrixNames.map((a) => `<tr><th>${esc(a)}</th>${matrixNames.map((b) => cell(a, b)).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="toolbar">${searchBox('pairs')}</div><div data-searchable="pairs">${table(['pair', 'state', 'kind', 'carried', 'bytes', 'crossingUsers'], list.map((entry) => `<tr><td><strong>${esc(entry.key)}</strong></td><td>${entry.linked ? tag(t('linked'), 'good') : tag(t('down'), 'bad')}</td><td>${[...entry.kinds].map((kind) => tag(kind, 'mut')).join(' ')}</td><td>${fmtNum(entry.carried)}</td><td>${esc(fmtBytes(entry.bytes))}</td><td>${[...entry.ends].map((name) => (serverOf(name) ? `${esc(name)}: ${crossers(name)}` : '')).filter(Boolean).join(' · ')}</td></tr>`))}</div>`;
    } else if (tabs.current === 'restricted') {
      const rowsOf = (act) => (list) => table(['server', 'cluster', 'fingerprint', ''], list.map(({ server, key }) => `<tr>${serverCells(server)}<td class="mono">${esc(key.slice(0, 16))}</td><td>${button(act, rowRef({ server: server.name, fingerprint: key }))}</td></tr>`));
      body = `<h3>${esc(t('suspended'))}</h3>${grouped('suspended', groupItems(suspended, ({ server }) => server.name), rowsOf('resume-peer'))}<h3>${esc(t('kicked'))}</h3>${grouped('kicked', groupItems(kicked, ({ server }) => server.name), rowsOf('unkick-peer'))}`;
    } else if (tabs.current === 'allowlist') {
      body = `<div class="toolbar">${searchBox('allow')}</div><div data-searchable="allow">${grouped('allow', groupItems(allowRows, ({ server }) => server.name), (list) => table(['server', 'cluster', 'fingerprint', 'label', ''], list.map(({ server, fingerprint, label }) => `<tr>${serverCells(server)}<td class="mono">${esc(fingerprint.slice(0, 24))}</td><td>${esc(label)}</td><td>${button('allowlist-remove', rowRef({ server: server.name, fingerprint }), { cls: 'bad' })}</td></tr>`)))}</div>
        <div class="row" data-form="allowlist-add"><input data-field="fingerprint" class="mono wide" placeholder="${esc(t('fingerprint'))}"><input data-field="label" placeholder="${esc(t('label'))}"><button data-form-run="allowlist-add" class="acc">${esc(t('allowlistAddShown'))}</button></div>`;
    } else {
      body = messageCenter();
    }
    return card('users', tabs.html + body);
  },
};

/* ---- relays: links, the family, gateways ---------------------------------- */

const relays = {
  id: 'relays', title: 'relays',
  async load(poll) {
    const [transit, partners] = await Promise.all([fanOut('/Monitor_Server/transit', { poll }), fanOut('/Monitor_Server/partners', { poll })]);
    state.cache.relays = { ...state.cache.relays, transit, partners };
  },
  render() {
    const { transit = [], partners = [] } = state.cache.relays || {};
    const partnersOf = (name) => partners.find((result) => result.server.name === name)?.data || {};
    const family = okResults(transit).find((result) => result.data.directory)?.data.directory;
    const links = okResults(transit).flatMap(({ server, data }) => (data.peers || []).map((peer) => ({ server, peer, name: relayName(peer.fullId || peer.id) || '—' })));
    const up = links.filter(({ peer }) => peer.linked).length;
    const tabs = subtabs('relays', [['summary', 'relaysSummary'], ['links', 'links', `${up}/${links.length}`], ['family', 'familyRelays', (family?.relays || []).length], ['gateways', 'gateways']]);
    let body = '';
    if (tabs.current === 'summary') {
      body = kpis([kpi('linksUp', `${up}/${links.length}`, '', up === links.length ? 'good' : 'warn'), kpi('familyRelays', fmtNum((family?.relays || []).length)), kpi('familyListSerial', family ? `#${num(family.serial)}` : '—')])
        + serverTable(transit, {
          extra: ['links', 'family', 'carryBetween'],
          cells: ({ server, data }) => [`${num(data.status?.up)}/${num(data.status?.allowed)}`, data.directory ? `${esc(data.directory.operator?.name)} #${num(data.directory.serial)}` : '—', partnersOf(server.name).self?.carryBetween ? tag('ON', 'good') : tag('OFF')],
          actions: ({ server }) => button('partner-carry', rowRef({ server: server.name, on: !partnersOf(server.name).self?.carryBetween })),
        })
        + `<div class="charts">${barChart({ title: t('linksByServer'), items: okResults(transit).map(({ server, data }) => ({ label: server.name, values: [num(data.status?.up), Math.max(0, num(data.status?.allowed) - num(data.status?.up))] })), keys: [{ label: t('linked'), color: '#34d399' }, { label: t('down'), color: '#f87171' }] })}
          ${barChart({ title: t('carriedByLink'), items: links.map(({ server, peer, name }) => ({ label: `${server.name} → ${name}`, values: [num(peer.traffic?.carried)] })).sort((a, b) => b.values[0] - a.values[0]), keys: [{ label: t('carried'), color: colorOf(4) }] })}</div>`;
    } else if (tabs.current === 'links') {
      const mode = groupPicker('relays:linkGroup', ['server', 'cluster', 'state', 'kind', 'peer', 'none'], 'server');
      const keyOf = ({ server, peer, name }) => (mode.current === 'state' ? t(peer.linked ? 'linked' : 'down') : mode.current === 'kind' ? String(peer.kind || peer.role || 'family') : mode.current === 'peer' ? name : byMode(mode.current, server));
      const rowsOf = (list) => table(['server', 'cluster', 'name', 'id', 'origin', 'state', 'kind', 'carried', 'bytes', ''], list.map(({ server, peer, name }) => {
        const ref = rowRef({ server: server.name, id: String(peer.fullId || peer.id) });
        return `<tr>${serverCells(server)}<td>${esc(name)}</td><td class="mono">${esc(String(peer.id).slice(0, 16))}</td><td class="mono">${esc(peer.origin || '—')}</td>`
          + `<td>${peer.linked ? tag(t('linked'), 'good') : tag(t('down'), 'bad')}</td><td>${tag(peer.kind || peer.role || '', 'mut')}</td><td>${num(peer.traffic?.carried)}</td><td>${esc(fmtBytes(peer.traffic?.bytes))}</td>`
          + `<td>${button('transit-remove', ref, { cls: 'bad' })}</td></tr>`;
      }));
      body = `<div class="toolbar">${mode.html}${searchBox('links')}<button data-export="links">CSV</button></div>
        <div data-searchable="links">${grouped('links', groupItems(links, keyOf), rowsOf, { summary: (list) => esc(`${list.filter(({ peer }) => peer.linked).length}/${list.length} ${t('linked')}`) })}</div>
        <div class="row" data-form="transit-add"><select data-field="server">${serverOptions()}</select><input data-field="id" class="mono wide" placeholder="64-hex relay id"><input data-field="origin" class="mono" placeholder="https://relay.example.com:8585"><button data-form-run="transit-add" class="acc">${esc(t('transitAdd'))}</button></div>`;
    } else if (tabs.current === 'family') {
      /* Every relay of the signed list, and which of our servers holds a link to it now. */
      const holders = okResults(transit);
      body = `<p class="mut">${esc(t('familyRelaysHint'))}</p>${table(['name', 'id', 'region', 'cluster', 'gateway', 'insideAddresses', ...holders.map(({ server }) => server.name)], (family?.relays || []).map((relay) => `<tr><td><strong>${esc(relay.name || '—')}</strong></td><td class="mono">${esc(String(relay.id).slice(0, 16))}</td><td>${esc(regionText(relay.region))}</td><td>${esc(relay.cluster || '—')}</td><td>${relay.gateway ? num(relay.gateway) : '—'}</td><td class="mono">${esc((relay.inside || []).join(' ') || '—')}</td>`
        + holders.map(({ data }) => {
          const mine = (data.directory?.relays || []).find((entry) => entry.id === relay.id);
          return `<td>${mine?.self ? tag(t('self'), 'mut') : mine?.linked ? tag('●', 'good') : tag('○', 'bad')}</td>`;
        }).join('') + '</tr>'))}`;
    } else {
      const chosen = {};
      for (const result of okResults(partners)) for (const gateway of result.data.self?.gateways || []) chosen[gateway.id] = gateway.priority;
      const priorityOf = (relay) => chosen[String(relay.id).slice(0, 16)] ?? relay.gateway ?? 0;
      const gatewayRows = (family?.relays || []).map((relay) => `<tr><td>${esc(relay.name || '—')}</td><td class="mono">${esc(String(relay.id).slice(0, 16))}</td>`
        + `<td>${esc(regionText(relay.region))}</td><td>${esc(relay.cluster || '—')}</td><td><select data-gw-id="${esc(relay.id)}" data-gw-region="${esc(relay.region || '')}">`
        + [0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}"${n === num(priorityOf(relay)) ? ' selected' : ''}>${n || '—'}</option>`).join('') + '</select></td></tr>');
      body = `${table(['name', 'id', 'region', 'cluster', 'priority'], gatewayRows)}<p class="mut">${esc(t('gwHint'))}</p><div class="row">${groupButton('gateways', { cls: 'acc' })}${groupButton('gateways-reset')}</div>`;
    }
    return card('relays', tabs.html + body);
  },
};

/* ---- partners: other operators' families ---------------------------------- */

const STATE_KEY = { requested: 'stRequested', incoming: 'stIncoming', approved: 'stApproved', rejected: 'stRejected', removed: 'stRemoved' };
/* Every partner once, however many of our servers know it: the family
   shares its partners, so what one server says holds for all. */
export function partnerList(results) {
  const byId = new Map();
  for (const { server, data } of okResults(results)) {
    for (const entry of data.partners || []) {
      const id = String(entry.operatorId || '');
      if (!id) continue;
      const known = byId.get(id) || { operatorId: id, name: String(entry.name || ''), state: String(entry.state || ''), gateways: [], path: '', servers: [] };
      known.servers.push({ server, state: String(entry.state || '') });
      if (!known.gateways.length) known.gateways = entry.gateways || [];
      if (!known.path) known.path = String(entry.path || '');
      byId.set(id, known);
    }
  }
  return [...byId.values()];
}

const partners = {
  id: 'partners', title: 'partners',
  async load(poll) {
    const [results, notes] = await Promise.all([fanOut('/Monitor_Server/partners', { poll }), api('/api/partner-notes', undefined, { poll })]);
    state.cache.partners = { ...state.cache.partners, results, notes: notes.notes || {} };
  },
  render() {
    const { results = [], notes = {}, found } = state.cache.partners || {};
    const list = partnerList(results);
    const reachable = okResults(results)[0]?.server;
    const tabs = subtabs('partners', [['list', 'partnersList', list.length], ['add', 'partnerAdd'], ['ours', 'partnerOurSide']]);
    let body = '';
    if (tabs.current === 'list') {
      const mode = groupPicker('partners:group', ['state', 'none'], 'state');
      const keyOf = (entry) => (mode.current === 'state' ? t(STATE_KEY[entry.state] || 'unknown') : t('everything'));
      const cardOf = (entry) => {
        const note = notes[entry.operatorId.slice(0, 16)] || {};
        const ref = reachable ? rowRef({ server: reachable.name, operatorId: entry.operatorId }) : '';
        const acts = !ref ? '' : entry.state === 'incoming' ? button('partner-approve', ref, { cls: 'acc' }) + button('partner-reject', ref, { cls: 'bad' })
          : entry.state === 'approved' || entry.state === 'requested' ? button('partner-remove', ref, { cls: 'bad' })
            : entry.state === 'rejected' || entry.state === 'removed' ? button('partner-approve', ref) : '';
        return `<div class="card partner-card"><div class="row spread"><h3>${esc(note.label || entry.name || '—')}${note.label && entry.name ? ` <span class="mut small">(${esc(entry.name)})</span>` : ''}</h3>
            ${tag(t(STATE_KEY[entry.state] || 'unknown'), entry.state === 'incoming' ? 'warn' : entry.state === 'approved' ? 'good' : 'mut')}</div>
          <div class="kv"><span>${esc(t('operatorId'))}</span><span class="mono">${esc(entry.operatorId.slice(0, 16))}</span>
            <span>${esc(t('gateways'))}</span><span>${(entry.gateways || []).map((gateway) => `${esc(gateway.name || gateway.id)} #${num(gateway.priority)} ${gateway.linked ? tag(t('linked'), 'good') : tag(t('down'), 'bad')}`).join('<br>') || '—'}</span>
            <span>${esc(t('path'))}</span><span>${esc(entry.path === 'direct' ? t('pathDirect') : entry.path.startsWith('via:') ? `${t('pathVia')} ${entry.path.slice(4)}` : '—')}</span>
            <span>${esc(t('seenBy'))}</span><span>${entry.servers.map(({ server, state: s }) => `${esc(server.name)} ${tag(t(STATE_KEY[s] || 'unknown'), 'mut')}`).join(' ')}</span>
            ${note.contact ? `<span>${esc(t('contact'))}</span><span>${esc(note.contact)}</span>` : ''}
            ${note.tags ? `<span>${esc(t('tags'))}</span><span>${note.tags.split(/[,،]\s*/).filter(Boolean).map((text) => tag(text)).join(' ')}</span>` : ''}
            ${note.notes ? `<span>${esc(t('notes'))}</span><span>${esc(note.notes)}</span>` : ''}</div>
          <div class="row">${acts}<button data-partner-edit="${esc(entry.operatorId)}"><i class="fa-solid fa-pen"></i> ${esc(t('edit'))}</button></div></div>`;
      };
      body = `<div class="charts">${donut({ title: t('partnersByState'), items: groupItems(list, (entry) => t(STATE_KEY[entry.state] || 'unknown')).map(([label, items], index) => ({ label, value: items.length, color: colorOf(index + 2) })) })}</div>
        <div class="toolbar">${mode.html}${searchBox('partners')}</div><div data-searchable="partners">${grouped('partners', groupItems(list, keyOf), (items) => `<div class="cards">${items.map(cardOf).join('')}</div>`)}</div>
        ${list.length ? '' : `<p class="mut">${esc(t('noPartners'))}</p>`}`;
    } else if (tabs.current === 'add') {
      body = `<p class="mut">${esc(t('partnerAddHint'))}</p><div class="row" data-form="partner-lookup"><select data-field="server">${serverOptions()}</select><input data-field="origin" class="mono wide" placeholder="https://relay.example.com:8585"><button data-form-run="partner-lookup">${esc(t('lookup'))}</button></div>
        ${found ? `<div class="card"><div class="kv"><span>${esc(t('name'))}</span><span>${esc(found.name || '—')}</span><span>${esc(t('operatorId'))}</span><span class="mono">${esc(String(found.id).slice(0, 16))}</span><span>${esc(t('foundRelays'))}</span><span>${num(found.relays)}</span></div>
          <div class="row">${button('partner-request', rowRef(found), { cls: 'acc' })}</div></div>` : ''}`;
    } else {
      body = serverTable(results, {
        extra: ['family', 'gateway', 'carryBetween', 'gateways'],
        cells: ({ data }) => [esc(data.self?.name || '—'), data.self?.gateway ? tag(t('yes'), 'good') : tag(t('no'), 'mut'), data.self?.carryBetween ? tag('ON', 'good') : tag('OFF'),
          (data.self?.gateways || []).map((gateway) => `${esc(gateway.name || gateway.id)} #${num(gateway.priority)}`).join('، ') || '—'],
        actions: ({ server, data }) => button('partner-carry', rowRef({ server: server.name, on: !data.self?.carryBetween })),
      }) + `<p class="mut">${esc(t('carryHint'))}</p>`;
    }
    return card('partners', tabs.html + body);
  },
};

/* ---- traffic -------------------------------------------------------------- */

const traffic = {
  id: 'traffic', title: 'traffic',
  async load(poll) {
    const [results] = await Promise.all([fanOut('/Monitor_Server/traffic', { poll }), loadMetrics(poll)]);
    state.cache.traffic = results;
  },
  render() {
    const results = state.cache.traffic || [];
    const ok = okResults(results);
    const total = (key) => ok.reduce((sum, { data }) => sum + num(data.totals?.[key]), 0);
    const tabs = subtabs('traffic', [['charts', 'trafficCharts'], ['servers', 'byServer'], ['clusters', 'byCluster'], ['users', 'topUsers'], ['relays', 'relayTraffic']]);
    let body = '';
    if (tabs.current === 'charts') {
      const mode = groupPicker('traffic:group', ['server', 'cluster', 'region', 'none'], 'cluster');
      const range = viewPicker('metrics:range', RANGES, '1h', 'range');
      const groups = mode.current === 'none' ? [[t('everything'), shownServers()]] : groupItems(shownServers(), (server) => groupLabel(server, mode.current));
      body = kpis([kpi('msgsIn', fmtNum(total('msgsIn'))), kpi('msgsOut', fmtNum(total('msgsOut'))), kpi('bytesIn', fmtBytes(total('bytesIn'))), kpi('bytesOut', fmtBytes(total('bytesOut'))), kpi('relayed', fmtNum(total('relays')))])
        + `<div class="toolbar">${mode.html}${range.html}</div><div id="liveTraffic">${grouped('traffic-charts', groups, (members) => chartsFor(members, 'traffic', { single: mode.current === 'server' }))}</div>
        <h3>${esc(t('shares'))}</h3><div class="charts">
          ${barChart({ title: t('msgsByServer'), items: ok.map(({ server, data }) => ({ label: server.name, values: [num(data.totals?.msgsIn), num(data.totals?.msgsOut)] })), keys: [{ label: t('msgsIn'), color: colorOf(0) }, { label: t('msgsOut'), color: colorOf(1) }] })}
          ${barChart({ title: t('bytesByServer'), unit: 'B', items: ok.map(({ server, data }) => ({ label: server.name, values: [num(data.totals?.bytesIn), num(data.totals?.bytesOut)] })), keys: [{ label: t('bytesIn'), color: colorOf(2) }, { label: t('bytesOut'), color: colorOf(3) }] })}
          ${donut({ title: t('bytesByCluster'), unit: 'B', items: byCluster(ok.map(({ server }) => server)).map(([cluster, members], index) => ({ label: cluster, value: members.reduce((sum, member) => sum + num(ok.find((result) => result.server === member)?.data.totals?.bytesIn) + num(ok.find((result) => result.server === member)?.data.totals?.bytesOut), 0), color: colorOf(index) })) })}
          ${donut({ title: t('bytesByRegion'), unit: 'B', items: groupItems(ok, ({ server }) => regionText(server.region)).map(([region, list], index) => ({ label: region, value: list.reduce((sum, { data }) => sum + num(data.totals?.bytesIn) + num(data.totals?.bytesOut), 0), color: colorOf(index + 5) })) })}
        </div>`;
    } else if (tabs.current === 'servers') {
      body = `<div class="toolbar"><button data-export="traffic">CSV</button></div>${serverTable(results, { extra: ['msgsIn', 'msgsOut', 'bytesIn', 'bytesOut', 'relayed', 'trend'], cells: ({ server, data }) => [num(data.totals?.msgsIn), num(data.totals?.msgsOut), esc(fmtBytes(data.totals?.bytesIn)), esc(fmtBytes(data.totals?.bytesOut)), num(data.totals?.relays),
        sparkline(((state.cache.metrics?.servers || []).find((entry) => entry.name === server.name)?.points || []).slice(-40).map((point) => num(point.msgsInRate) + num(point.msgsOutRate)))] })}`;
    } else if (tabs.current === 'clusters') {
      const rows = byCluster(ok.map((result) => result.server)).map(([cluster, members]) => {
        const sum = (key) => members.reduce((value, member) => value + num(ok.find((result) => result.server === member)?.data.totals?.[key]), 0);
        return { cluster, members, msgsIn: sum('msgsIn'), msgsOut: sum('msgsOut'), bytesIn: sum('bytesIn'), bytesOut: sum('bytesOut'), relays: sum('relays') };
      });
      body = table(['cluster', 'servers', 'msgsIn', 'msgsOut', 'bytesIn', 'bytesOut', 'relayed'], rows.map((row) => `<tr class="group"><td>${esc(row.cluster)}</td><td>${row.members.length}</td><td>${row.msgsIn}</td><td>${row.msgsOut}</td><td>${esc(fmtBytes(row.bytesIn))}</td><td>${esc(fmtBytes(row.bytesOut))}</td><td>${row.relays}</td></tr>`))
        + `<div class="charts">${barChart({ title: t('msgsByCluster'), items: rows.map((row) => ({ label: row.cluster, values: [row.msgsIn, row.msgsOut] })), keys: [{ label: t('msgsIn'), color: colorOf(0) }, { label: t('msgsOut'), color: colorOf(1) }] })}
          ${barChart({ title: t('bytesByCluster'), unit: 'B', items: rows.map((row) => ({ label: row.cluster, values: [row.bytesIn, row.bytesOut] })), keys: [{ label: t('bytesIn'), color: colorOf(2) }, { label: t('bytesOut'), color: colorOf(3) }] })}</div>`;
    } else if (tabs.current === 'users') {
      const clients = ok.flatMap(({ server, data }) => (data.clients || []).map((row) => ({ server, row })));
      const mode = groupPicker('traffic:userGroup', ['server', 'cluster', 'none'], 'server');
      body = barChart({ title: t('topUsersBytes'), unit: 'B', items: clients.map(({ server, row }) => ({ label: `${row.label || row.clientId} · ${server.name}`, values: [num(row.bytesIn), num(row.bytesOut)] })).sort((a, b) => (b.values[0] + b.values[1]) - (a.values[0] + a.values[1])), keys: [{ label: t('bytesIn'), color: colorOf(2) }, { label: t('bytesOut'), color: colorOf(3) }] })
        + `<div class="toolbar">${mode.html}${searchBox('topusers')}<button data-export="traffic">CSV</button></div><div data-searchable="topusers">${grouped('topusers', groupItems(clients, ({ server }) => byMode(mode.current, server)), (list) => table(['server', 'cluster', 'name', 'id', 'msgsIn', 'msgsOut', 'bytes', 'lastAt'], list.map(({ server, row }) => `<tr>${serverCells(server)}<td>${esc(row.label || '—')}</td><td class="mono">${esc(row.clientId)}</td><td>${num(row.msgsIn)}</td><td>${num(row.msgsOut)}</td><td>${esc(fmtBytes(num(row.bytesIn) + num(row.bytesOut)))}</td><td>${esc(fmtTime(row.lastAt))}</td></tr>`)))}</div>`;
    } else {
      const rows = ok.flatMap(({ server, data }) => (data.relays || []).map((row) => ({ server, row, name: relayName(row.relayId) || '—' })));
      const mode = groupPicker('traffic:relayGroup', ['server', 'peer', 'cluster', 'none'], 'server');
      body = barChart({ title: t('relayTraffic'), unit: 'B', items: rows.map(({ server, row, name }) => ({ label: `${server.name} → ${name}`, values: [num(row.bytes)] })).sort((a, b) => b.values[0] - a.values[0]), keys: [{ label: t('bytes'), color: colorOf(4) }] })
        + `<div class="toolbar">${mode.html}</div>${grouped('relaytraffic', groupItems(rows, ({ server, name }) => (mode.current === 'peer' ? name : byMode(mode.current, server))), (list) => table(['server', 'cluster', 'name', 'id', 'carried', 'bytes', 'lastAt'], list.map(({ server, row, name }) => `<tr>${serverCells(server)}<td>${esc(name)}</td><td class="mono">${esc(row.relayId)}</td><td>${num(row.carried)}</td><td>${esc(fmtBytes(row.bytes))}</td><td>${esc(fmtTime(row.lastAt))}</td></tr>`)))}`;
    }
    return card('traffic', tabs.html + body);
  },
};

export const SECTIONS = [queues, users, relays, partners, traffic, reports];

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
  'ops-stack-restart': () => ({}),
  'ops-backup-create': () => ({}),
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

/* The servers a message goes to, from the scope chosen. */
function messageServers(fields, box) {
  const reachable = shownServers().filter((server) => server.reachable);
  if (fields.scope === 'cluster') return reachable.filter((server) => clusterOf(server) === fields.cluster).map((server) => server.name);
  if (fields.scope === 'server') return reachable.filter((server) => server.name === fields.server).map((server) => server.name);
  if (fields.scope === 'picked') {
    const chosen = [...box.querySelectorAll('[data-msg-server]:checked')].map((input) => input.getAttribute('data-msg-server'));
    return reachable.filter((server) => chosen.includes(server.name)).map((server) => server.name);
  }
  return reachable.map((server) => server.name);
}

/* A form: which action, with what body, on which servers (null cancels). */
export const FORMS = {
  'allowlist-add': async (fields) => (fields.fingerprint ? { act: 'allowlist-add', body: { fingerprint: fields.fingerprint, label: fields.label } } : null),
  announce: async (fields, box) => {
    if (!fields.message && !fields.kind) return null;
    const servers = messageServers(fields, box);
    if (!servers.length) { show(t('nothingPicked')); return null; }
    const body = { message: fields.message, title: fields.title };
    if (fields.targets) body.targets = fields.targets.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const file = box.querySelector('[data-field="file"]')?.files?.[0];
    if (fields.kind && file) {
      if (file.size > 2 * 1024 * 1024) { show(t('attachmentTooLarge')); return null; }
      body.attachment = { kind: fields.kind, name: file.name, mimeType: file.type || 'application/octet-stream', dataUrl: await fileAsDataUrl(file) };
    }
    return { act: 'announce', body, servers };
  },
  broadcast: async (fields, box) => {
    if (!fields.message) return null;
    const servers = messageServers(fields, box);
    if (!servers.length) { show(t('nothingPicked')); return null; }
    return { act: 'broadcast', body: { message: fields.message }, servers };
  },
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
  const where = state.tab === 'network' ? 'relays' : 'partners';
  if (!answer.ok || !data.ok) { show(explain(data.reason ? data : answer)); state.cache[where] = { ...state.cache[where], found: null }; return; }
  state.cache[where] = { ...state.cache[where], found: { server: fields.server, origin: fields.origin, id: data.operator?.id, name: data.operator?.name, relays: data.relays } };
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
  } else if (which === 'expiry') {
    lines.push(['server', 'cluster', 'at', 'reason', 'fingerprint', 'bytes']);
    for (const { server, data, ok } of state.cache.queues?.expiry || []) if (ok) for (const entry of data.entries || []) {
      const row = Array.isArray(entry) ? entry : [entry.at || entry.time || '', entry.reason || entry.kind || '', entry.fingerprint || entry.to || '', entry.bytes || 0];
      lines.push([server.name, clusterOf(server), ...row]);
    }
  } else if (which === 'traffic') {
    lines.push(['server', 'cluster', 'clientId', 'label', 'msgsIn', 'msgsOut', 'bytesIn', 'bytesOut', 'lastAt']);
    for (const { server, data, ok } of state.cache.traffic || []) if (ok) for (const row of data.clients || []) lines.push([server.name, clusterOf(server), row.clientId, row.label, row.msgsIn, row.msgsOut, row.bytesIn, row.bytesOut, row.lastAt]);
  } else if (which === 'links') {
    lines.push(['server', 'cluster', 'peer', 'id', 'origin', 'linked', 'kind', 'carried', 'bytes']);
    for (const { server, data, ok } of state.cache.relays?.transit || []) if (ok) for (const peer of data.peers || []) lines.push([server.name, clusterOf(server), relayName(peer.fullId || peer.id), peer.fullId || peer.id, peer.origin, peer.linked ? 'yes' : 'no', peer.kind || peer.role || '', peer.traffic?.carried, peer.traffic?.bytes]);
  }
  saveFile(`${which}.csv`, `﻿${lines.map((line) => line.map(csvCell).join(',')).join('\n')}`, 'text/csv;charset=utf-8');
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
  forgetReads();
  await hooks.reload?.();
}

/* An action on every server shown (or those given), one after another. */
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
  forgetReads();
  await hooks.reload?.();
}

/* The rows ticked in a table, each on its own server: their data taken
   before anything is awaited. */
export const runPicked = (act) => busy(() => runPickedNow(act));
async function runPickedNow(act) {
  const picked = Array.from(document.querySelectorAll('[data-pick]:checked')).filter((box) => !box.closest('tr')?.hidden).map((box) => [box.getAttribute('data-pick'), state.rows.get(box.getAttribute('data-pick'))]).filter(([, row]) => row);
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
  forgetReads();
  await hooks.reload?.();
}

/* A form's action. */
export async function runForm(id, box) {
  const fields = Object.fromEntries(Array.from(box.querySelectorAll('[data-field]')).filter((field) => field.type !== 'file' && !(field.type === 'radio' && !field.checked)).map((field) => [field.getAttribute('data-field'), String(field.value || '').trim()]));
  if (id === 'partner-lookup') { await lookupPartner(fields); hooks.render(); return; }
  const plan = await FORMS[id]?.(fields, box);
  if (!plan) return;
  await runGroup(plan.act, plan.servers, plan);
  if (id === 'change-password') box.querySelectorAll('input').forEach((input) => { input.value = ''; });
}
