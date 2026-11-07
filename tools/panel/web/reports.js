/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Reports: each server at the level of detail asked for (brief, standard,
 * detailed), live calls, the servers' own events, this panel's events (its
 * audit log), and exports of any of it — for every server shown, one
 * cluster, or one server — as CSV, TSV, JSON, an Excel workbook (one sheet
 * per table), a printable HTML report or Markdown. Everything is made here in
 * the page from what the servers answered; nothing is sent anywhere. */
import {
  state, t, esc, num, fmtBytes, fmtTime, api, fanOutOn, shownServers, clusterOf, regionText, visible, serverTable, serverCells, table, card, show,
  subtabs, groupPicker, viewPicker, groupLabel, groupItems, grouped, searchBox, saveFile, csvCell, tag, kpi, fmtNum,
} from './ui.js';
import { sparkline, barChart, colorOf } from './charts.js';

const okResults = (results) => visible(results).filter((result) => result.ok);
const LEVELS = [['brief', 'levelBrief'], ['standard', 'levelStandard'], ['detailed', 'levelDetailed']];
const levelRank = (level) => ({ brief: 1, standard: 2, detailed: 3 }[level] || 2);

/* ---- what can be exported ----------------------------------------------------
   Each table: what it reads (each read once, whatever tables need it), and
   its columns, each with the lowest level it appears at. */
const col = (key, level, value) => ({ key, level, value });
const n = (value) => num(value);
export const DATASETS = {
  servers: {
    label: 'reportServers', reads: ['/healthz', '/Monitor_Server/transit', '/Monitor_Server/queues', '/Monitor_Server/traffic'],
    rows: (got, servers) => servers.map((server) => ({ server, health: got['/healthz'][server.name], transit: got['/Monitor_Server/transit'][server.name], queues: got['/Monitor_Server/queues'][server.name], traffic: got['/Monitor_Server/traffic'][server.name] })),
    columns: [
      col('server', 1, (row) => row.server.name), col('cluster', 1, (row) => clusterOf(row.server)), col('region', 2, (row) => regionText(row.server.region)),
      col('state', 1, (row) => (row.health ? 'up' : 'down')), col('version', 1, (row) => row.server.version || ''), col('online', 1, (row) => n(row.health?.peers)),
      col('activeCalls', 2, (row) => n(row.health?.activeCalls)), col('cpu', 2, (row) => n(row.health?.cpuLoad)), col('memoryMb', 2, (row) => n(row.health?.containerMem?.usageMb || row.health?.memory?.rss)),
      col('memoryLimitMb', 3, (row) => n(row.health?.containerMem?.limitMb)), col('diskFreeMb', 3, (row) => n(row.health?.storage?.free)), col('diskTotalMb', 3, (row) => n(row.health?.storage?.total)),
      col('linksUp', 2, (row) => n(row.transit?.status?.up)), col('linksAllowed', 3, (row) => n(row.transit?.status?.allowed)), col('queued', 2, (row) => n(row.queues?.totals?.queued)),
      col('queuedBytes', 3, (row) => n(row.queues?.totals?.bytes)), col('msgsIn', 2, (row) => n(row.traffic?.totals?.msgsIn)), col('msgsOut', 2, (row) => n(row.traffic?.totals?.msgsOut)),
      col('bytesIn', 3, (row) => n(row.traffic?.totals?.bytesIn)), col('bytesOut', 3, (row) => n(row.traffic?.totals?.bytesOut)), col('host', 3, (row) => row.health?.hostname || ''),
      col('relayId', 3, (row) => String(row.health?.relayId || '')), col('uptimeMin', 3, (row) => Math.round(n(row.health?.uptime) / 60)),
    ],
  },
  users: {
    label: 'onlineUsers', reads: ['/healthz'],
    rows: (got, servers) => servers.flatMap((server) => (got['/healthz'][server.name]?.peersList || []).map((peer) => ({ server, peer }))),
    columns: [col('server', 1, (row) => row.server.name), col('cluster', 2, (row) => clusterOf(row.server)), col('name', 1, (row) => row.peer.username || ''), col('fingerprint', 1, (row) => row.peer.fingerprint || ''),
      col('ip', 3, (row) => row.peer.ip || ''), col('since', 2, (row) => row.peer.connectedAt || ''), col('lastSeen', 2, (row) => row.peer.lastSeenAt || ''), col('crossRelay', 3, (row) => (typeof row.peer.crossRelayMinutes === 'number' ? row.peer.crossRelayMinutes : ''))],
  },
  mailboxes: {
    label: 'mailboxes', reads: ['/Monitor_Server/queues'],
    rows: (got, servers) => servers.flatMap((server) => (got['/Monitor_Server/queues'][server.name]?.mailboxes || []).map((box) => ({ server, box }))),
    columns: [col('server', 1, (row) => row.server.name), col('cluster', 2, (row) => clusterOf(row.server)), col('fingerprint', 1, (row) => row.box.fingerprint), col('count', 1, (row) => n(row.box.count)),
      col('bytes', 1, (row) => n(row.box.bytes)), col('oldest', 2, (row) => row.box.oldestAt || ''), col('newest', 3, (row) => row.box.newestAt || '')],
  },
  expiry: {
    label: 'expiryLog', reads: ['/Monitor_Server/expiry-log'],
    rows: (got, servers) => servers.flatMap((server) => (got['/Monitor_Server/expiry-log'][server.name]?.entries || []).map((entry) => ({ server, row: Array.isArray(entry) ? entry : [entry.at || entry.time || '', entry.reason || entry.kind || '', entry.fingerprint || entry.to || '', entry.bytes || 0] }))),
    columns: [col('server', 1, (row) => row.server.name), col('cluster', 2, (row) => clusterOf(row.server)), col('at', 1, (row) => row.row[0]), col('reason', 1, (row) => row.row[1]), col('fingerprint', 2, (row) => row.row[2]), col('bytes', 3, (row) => n(row.row[3]))],
  },
  traffic: {
    label: 'topUsers', reads: ['/Monitor_Server/traffic'],
    rows: (got, servers) => servers.flatMap((server) => (got['/Monitor_Server/traffic'][server.name]?.clients || []).map((client) => ({ server, client }))),
    columns: [col('server', 1, (row) => row.server.name), col('cluster', 2, (row) => clusterOf(row.server)), col('name', 1, (row) => row.client.label || ''), col('id', 2, (row) => row.client.clientId),
      col('msgsIn', 1, (row) => n(row.client.msgsIn)), col('msgsOut', 1, (row) => n(row.client.msgsOut)), col('bytesIn', 2, (row) => n(row.client.bytesIn)), col('bytesOut', 2, (row) => n(row.client.bytesOut)), col('lastAt', 3, (row) => row.client.lastAt || '')],
  },
  relayTraffic: {
    label: 'relayTraffic', reads: ['/Monitor_Server/traffic'],
    rows: (got, servers) => servers.flatMap((server) => (got['/Monitor_Server/traffic'][server.name]?.relays || []).map((relay) => ({ server, relay }))),
    columns: [col('server', 1, (row) => row.server.name), col('cluster', 2, (row) => clusterOf(row.server)), col('id', 1, (row) => row.relay.relayId), col('carried', 1, (row) => n(row.relay.carried)), col('bytes', 1, (row) => n(row.relay.bytes)), col('lastAt', 2, (row) => row.relay.lastAt || '')],
  },
  links: {
    label: 'links', reads: ['/Monitor_Server/transit'],
    rows: (got, servers) => servers.flatMap((server) => (got['/Monitor_Server/transit'][server.name]?.peers || []).map((peer) => ({ server, peer }))),
    columns: [col('server', 1, (row) => row.server.name), col('cluster', 2, (row) => clusterOf(row.server)), col('id', 1, (row) => String(row.peer.fullId || row.peer.id)), col('origin', 2, (row) => row.peer.origin || ''),
      col('state', 1, (row) => (row.peer.linked ? 'linked' : 'down')), col('kind', 2, (row) => row.peer.kind || row.peer.role || ''), col('carried', 2, (row) => n(row.peer.traffic?.carried)), col('bytes', 3, (row) => n(row.peer.traffic?.bytes))],
  },
  partners: {
    label: 'partners', reads: ['/Monitor_Server/partners'],
    rows: (got, servers) => servers.flatMap((server) => (got['/Monitor_Server/partners'][server.name]?.partners || []).map((entry) => ({ server, entry }))),
    columns: [col('server', 2, (row) => row.server.name), col('name', 1, (row) => row.entry.name || ''), col('operatorId', 1, (row) => row.entry.operatorId || ''), col('state', 1, (row) => row.entry.state || ''), col('path', 3, (row) => row.entry.path || '')],
  },
  calls: {
    label: 'liveCalls', reads: ['/Monitor_Server/reports'],
    rows: (got, servers) => servers.flatMap((server) => (got['/Monitor_Server/reports'][server.name]?.activeCalls || []).map((call) => ({ server, call }))),
    columns: [col('server', 1, (row) => row.server.name), col('cluster', 2, (row) => clusterOf(row.server)), col('name', 1, (row) => row.call.username || ''), col('peer', 2, (row) => row.call.peer || ''), col('kind', 1, (row) => (row.call.group ? 'group' : '1:1')), col('since', 1, (row) => row.call.since || '')],
  },
  events: {
    label: 'serverEvents', reads: ['/Monitor_Server/reports'],
    rows: (got, servers) => servers.flatMap((server) => (got['/Monitor_Server/reports'][server.name]?.events || []).map((event) => ({ server, event }))).sort((a, b) => String(b.event.at).localeCompare(String(a.event.at))),
    columns: [col('server', 1, (row) => row.server.name), col('cluster', 3, (row) => clusterOf(row.server)), col('at', 1, (row) => row.event.at || ''), col('kind', 1, (row) => row.event.kind || ''), col('text', 1, (row) => row.event.text || '')],
  },
  containers: {
    label: 'containers', reads: ['/Monitor_Server/ops-memory'],
    rows: (got, servers) => servers.flatMap((server) => (got['/Monitor_Server/ops-memory'][server.name]?.containers || []).map((container) => ({ server, container }))),
    columns: [col('server', 1, (row) => row.server.name), col('cluster', 2, (row) => clusterOf(row.server)), col('container', 1, (row) => row.container.name || ''), col('ramMb', 1, (row) => n(row.container.usageMb)), col('limitMb', 2, (row) => n(row.container.limitMb)), col('cpuPct', 1, (row) => n(row.container.cpuPct))],
  },
  backups: {
    label: 'backups', reads: ['/Monitor_Server/ops-backup-list'],
    rows: (got, servers) => servers.flatMap((server) => (got['/Monitor_Server/ops-backup-list'][server.name]?.backups || []).map((backup) => ({ server, backup }))),
    columns: [col('server', 1, (row) => row.server.name), col('name', 1, (row) => row.backup.name || ''), col('size', 1, (row) => row.backup.size || '')],
  },
  panelEvents: {
    label: 'panelEvents', reads: [], panel: true,
    rows: (got) => (got.panelLog || []).map((line) => ({ line })),
    columns: [col('at', 1, (row) => String(row.line).slice(0, 24).trim()), col('text', 1, (row) => String(row.line).slice(24).trim() || row.line)],
  },
  metrics: {
    label: 'graphReadings', reads: [], metrics: true,
    rows: (got, servers) => servers.flatMap((server) => ((got.metrics?.servers || []).find((entry) => entry.name === server.name)?.points || []).map((point) => ({ server, point }))),
    columns: [col('server', 1, (row) => row.server.name), col('at', 1, (row) => new Date(row.point.t).toISOString()), col('up', 2, (row) => n(row.point.up)), col('cpu', 1, (row) => n(row.point.cpu)), col('memoryMb', 1, (row) => n(row.point.memMb)),
      col('disk', 2, (row) => n(row.point.diskPct)), col('online', 1, (row) => n(row.point.peers)), col('activeCalls', 2, (row) => n(row.point.calls)), col('msgsPerMin', 1, (row) => num(row.point.msgsInRate) + num(row.point.msgsOutRate)),
      col('bandwidth', 2, (row) => num(row.point.bytesInRate) + num(row.point.bytesOutRate)), col('linksUp', 3, (row) => n(row.point.linksUp)), col('queued', 3, (row) => n(row.point.queued))],
  },
};
export const FORMATS = [['csv', 'CSV'], ['tsv', 'TSV'], ['json', 'JSON'], ['xls', 'Excel (.xls)'], ['html', 'HTML'], ['md', 'Markdown']];

/* The rows of each table chosen, at the level chosen: { id: { title, headers, rows } }. */
export function buildTables(ids, got, servers, level) {
  const rank = levelRank(level);
  const out = {};
  for (const id of ids) {
    const set = DATASETS[id];
    if (!set) continue;
    const columns = set.columns.filter((column) => column.level <= rank);
    out[id] = { title: t(set.label), headers: columns.map((column) => column.key), labels: columns.map((column) => t(column.key)), rows: set.rows(got, servers).map((row) => columns.map((column) => column.value(row))) };
  }
  return out;
}

const xmlText = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
const mdCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/* The files a format makes from the tables: [{ name, content, type }]. */
export function renderExport(format, tables, { title, scope, level, at = new Date() }) {
  const stamp = at.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const base = `p00rija-report-${stamp}`;
  const entries = Object.entries(tables);
  if (format === 'csv' || format === 'tsv') {
    const sep = format === 'csv' ? ',' : '\t';
    const cell = format === 'csv' ? csvCell : (value) => String(value ?? '').replace(/[\t\n\r]/g, ' ').replace(/^([=+\-@])/, "'$1");
    return entries.map(([id, table_]) => ({ name: `${base}-${id}.${format}`, type: `text/${format === 'csv' ? 'csv' : 'tab-separated-values'};charset=utf-8`, content: `﻿${[table_.headers, ...table_.rows].map((row) => row.map(cell).join(sep)).join('\n')}` }));
  }
  if (format === 'json') {
    return [{ name: `${base}.json`, type: 'application/json', content: JSON.stringify({ title, scope, level, generatedAt: at.toISOString(), tables: Object.fromEntries(entries.map(([id, table_]) => [id, table_.rows.map((row) => Object.fromEntries(table_.headers.map((head, index) => [head, row[index]])))])) }, null, 2) }];
  }
  if (format === 'xls') {
    /* SpreadsheetML: Excel and LibreOffice open it as a workbook, one sheet per table. */
    const sheets = entries.map(([id, table_]) => `<Worksheet ss:Name="${xmlText(id.slice(0, 31))}"><Table>${[table_.labels, ...table_.rows].map((row, index) => `<Row>${row.map((value) => `<Cell${index === 0 ? ' ss:StyleID="h"' : ''}><Data ss:Type="${typeof value === 'number' && index > 0 ? 'Number' : 'String'}">${xmlText(value)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet>`).join('');
    return [{ name: `${base}.xls`, type: 'application/vnd.ms-excel', content: `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles>${sheets}</Workbook>` }];
  }
  if (format === 'md') {
    const body = entries.map(([, table_]) => `## ${table_.title}\n\n| ${table_.labels.map(mdCell).join(' | ')} |\n| ${table_.labels.map(() => '---').join(' | ')} |\n${table_.rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`).join('\n')}\n`).join('\n');
    return [{ name: `${base}.md`, type: 'text/markdown;charset=utf-8', content: `# ${title}\n\n${scope} · ${t(`level${level.charAt(0).toUpperCase()}${level.slice(1)}`)} · ${at.toISOString()}\n\n${body}` }];
  }
  const rtl = state.lang === 'fa';
  const body = entries.map(([, table_]) => `<h2>${esc(table_.title)} <small>(${table_.rows.length})</small></h2><table><thead><tr>${table_.labels.map((label) => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${table_.rows.map((row) => `<tr>${row.map((value) => `<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('');
  return [{ name: `${base}.html`, type: 'text/html;charset=utf-8', content: `<!doctype html><html lang="${state.lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:13px/1.5 system-ui,sans-serif;margin:24px;color:#13203b}h1{font-size:20px}h2{font-size:15px;margin-top:24px}table{border-collapse:collapse;width:100%;margin-top:6px}th,td{border:1px solid #dfe5f0;padding:4px 6px;text-align:start}th{background:#eef3fb}small{color:#5d6a85}@media print{h2{break-before:auto}tr{break-inside:avoid}}</style></head><body><h1>${esc(title)}</h1><p>${esc(scope)} · ${esc(at.toLocaleString(rtl ? 'fa-IR' : 'en-GB'))}</p>${body}</body></html>` }];
}

/* What the chosen tables need, read once from each server in scope. */
export async function gather(ids, servers) {
  const reads = [...new Set(ids.flatMap((id) => DATASETS[id]?.reads || []))];
  const got = {};
  await Promise.all(reads.map(async (path) => {
    const results = await fanOutOn(servers, path, path === '/healthz' ? { method: 'GET' } : {});
    got[path] = Object.fromEntries(results.filter((result) => result.ok).map((result) => [result.server.name, result.data]));
  }));
  if (ids.some((id) => DATASETS[id]?.panel)) got.panelLog = (await api('/api/log')).lines || [];
  if (ids.some((id) => DATASETS[id]?.metrics)) got.metrics = await api(`/api/metrics?range=${encodeURIComponent(state.view['reports:range'] || '24h')}`);
  return got;
}

/* The Export button. */
export async function runExport(box) {
  const ids = [...box.querySelectorAll('[data-export-set]:checked')].map((input) => input.getAttribute('data-export-set'));
  if (!ids.length) { show(t('nothingPicked')); return; }
  const scope = box.querySelector('[data-export-scope]')?.value || 'all';
  const format = box.querySelector('[data-export-format]')?.value || 'csv';
  const level = box.querySelector('[data-export-level]')?.value || 'standard';
  const servers = scope === 'all' ? shownServers() : scope.startsWith('cluster:') ? shownServers().filter((server) => clusterOf(server) === scope.slice(8)) : shownServers().filter((server) => server.name === scope.slice(7));
  show(t('gathering'));
  const tables = buildTables(ids, await gather(ids, servers.filter((server) => server.reachable)), servers, level);
  const scopeText = scope === 'all' ? t('scopeAll') : scope.slice(scope.indexOf(':') + 1);
  const files = renderExport(format, tables, { title: `P00RIJA · ${t('reports')}`, scope: scopeText, level });
  for (const file of files) saveFile(file.name, file.content, file.type);
  show(`${t('exported')}: ${files.map((file) => file.name).join(', ')} · ${Object.values(tables).reduce((sum, table_) => sum + table_.rows.length, 0)} ${t('rows')}`);
}

export const reports = {
  id: 'reports', title: 'reports',
  async load(poll) {
    const [results, log, health] = await Promise.all([fanOutOn(shownServers(), '/Monitor_Server/reports', { poll }), api('/api/log', undefined, { poll }), fanOutOn(shownServers(), '/healthz', { method: 'GET', poll })]);
    state.cache.reports = results;
    state.cache.reportHealth = health;
    state.cache.log = log;
  },
  render() {
    const results = state.cache.reports || [];
    const health = state.cache.reportHealth || [];
    const calls = okResults(results).flatMap(({ server, data }) => (data.activeCalls || []).map((call) => ({ server, call })));
    const events = okResults(results).flatMap(({ server, data }) => (data.events || []).map((event) => ({ server, event }))).sort((a, b) => String(b.event.at).localeCompare(String(a.event.at)));
    const panelLines = state.cache.log?.lines || [];
    const tabs = subtabs('reports', [['summary', 'reportSummary'], ['calls', 'liveCalls', calls.length], ['events', 'serverEvents', events.length], ['panel', 'panelEvents', panelLines.length], ['export', 'exportCenter']]);
    let body = '';
    if (tabs.current === 'summary') {
      const level = viewPicker('reports:level', LEVELS, 'standard', 'level');
      const rank = levelRank(level.current);
      const healthOf = (name) => health.find((result) => result.server.name === name)?.data || {};
      const lastHour = (data) => { const last = (data.hourly || []).slice(-2); return last.length === 2 ? num(last[1].msgsIn) - num(last[0].msgsIn) : 0; };
      const extra = ['activeCalls', 'transitActive', 'lastHour', ...(rank >= 2 ? ['online', 'cpu', 'memory', 'disk'] : []), ...(rank >= 3 ? ['hourly', 'eventKinds', 'host', 'uptime'] : [])];
      body = `<div class="toolbar">${level.html}</div>` + serverTable(results, {
        extra,
        cells: ({ server, data }) => {
          const h = healthOf(server.name);
          const cells = [num((data.activeCalls || []).length), num((data.transitActive || []).length), lastHour(data)];
          if (rank >= 2) cells.push(num(h.peers), `${num(h.cpuLoad)}%`, `${num(h.containerMem?.usageMb || h.memory?.rss)} MB`, h.storage?.total ? `${Math.round(((num(h.storage.total) - num(h.storage.free)) / num(h.storage.total)) * 100)}%` : '—');
          if (rank >= 3) {
            cells.push(sparkline((data.hourly || []).slice(-24).map((hour, index, list) => (index ? Math.max(0, num(hour.msgsIn) - num(list[index - 1].msgsIn)) : 0))),
              groupItems(data.events || [], (event) => event.kind).map(([kind, list]) => `${esc(kind)} ${list.length}`).join(' · ') || '—', esc(h.hostname || '—'), `${Math.round(num(h.uptime) / 60)} min`);
          }
          return cells;
        },
      }) + `<div class="charts">${barChart({ title: t('eventsByServer'), items: okResults(results).map(({ server, data }) => ({ label: server.name, values: [(data.events || []).length] })), keys: [{ label: t('serverEvents'), color: colorOf(6) }] })}</div>`;
    } else if (tabs.current === 'calls') {
      const mode = groupPicker('reports:callGroup', ['server', 'cluster', 'kind', 'none'], 'server');
      body = `<div class="toolbar">${mode.html}</div>${grouped('calls', groupItems(calls, ({ server, call }) => (mode.current === 'kind' ? (call.group ? 'group' : '1:1') : groupLabel(server, mode.current))), (list) => table(['server', 'cluster', 'name', 'peer', 'kind', 'since'], list.map(({ server, call }) => `<tr>${serverCells(server)}<td>${esc(call.username)}</td><td class="mono">${esc(call.peer)}</td><td>${tag(call.group ? 'group' : '1:1', call.group ? 'warn' : 'good')}</td><td>${esc(fmtTime(call.since))}</td></tr>`)))}`;
    } else if (tabs.current === 'events') {
      const mode = groupPicker('reports:eventGroup', ['kind', 'server', 'cluster', 'day', 'none'], 'kind');
      const keyOf = ({ server, event }) => (mode.current === 'kind' ? String(event.kind || '—') : mode.current === 'day' ? String(event.at || '').slice(0, 10) : groupLabel(server, mode.current));
      body = `<div class="toolbar">${mode.html}${searchBox('events')}</div><div class="chips-row">${groupItems(events, ({ event }) => event.kind).map(([kind, list]) => `<span class="chip">${esc(kind)} <strong>${list.length}</strong></span>`).join('')}</div>
        <div data-searchable="events">${grouped('events', groupItems(events.slice(0, 1000), keyOf), (list) => table(['server', 'cluster', 'at', 'kind', 'text'], list.map(({ server, event }) => `<tr>${serverCells(server)}<td>${esc(fmtTime(event.at))}</td><td>${tag(event.kind, 'mut')}</td><td>${esc(event.text)}</td></tr>`)))}</div>`;
    } else if (tabs.current === 'panel') {
      /* This panel's own log, newest first: who signed in, what was changed. */
      const mode = groupPicker('reports:panelGroup', ['day', 'kind', 'none'], 'day');
      const kindOf = (line) => (/sign|login|logged/i.test(line) ? t('evSignIn') : /install|deploy|update|build|prerequisit/i.test(line) ? t('evDeploy') : /family|operator|cluster|directory/i.test(line) ? t('evFamily') : /server|deploy\.conf/i.test(line) ? t('evServers') : t('evOther'));
      const keyOf = (line) => (mode.current === 'day' ? String(line).slice(0, 10) : mode.current === 'kind' ? kindOf(line) : t('everything'));
      body = `<div class="toolbar">${mode.html}${searchBox('panellog')}<button data-panel-log-export>CSV</button></div><div data-searchable="panellog">${grouped('panellog', groupItems(panelLines, keyOf), (list) => table(['at', 'text'], list.map((line) => `<tr><td class="mono">${esc(String(line).slice(0, 24))}</td><td class="mono">${esc(String(line).slice(24) || line)}</td></tr>`)))}</div>`;
    } else {
      const clusters = [...new Set(shownServers().map(clusterOf))];
      const range = viewPicker('reports:range', [['1h', 'range1h'], ['6h', 'range6h'], ['24h', 'range24h'], ['7d', 'range7d']], '24h', 'graphRange');
      body = `<div class="grid" data-export-form>
        <p class="mut">${esc(t('exportHint'))}</p>
        <div class="checks">${Object.entries(DATASETS).map(([id, set]) => `<label class="check"><input type="checkbox" data-export-set="${esc(id)}"${['servers', 'users', 'traffic'].includes(id) ? ' checked' : ''}> ${esc(t(set.label))}</label>`).join('')}</div>
        <div class="row wrap">
          <label class="picker"><span class="mut">${esc(t('scope'))}</span> <select data-export-scope><option value="all">${esc(t('scopeAll'))}</option>${clusters.map((name) => `<option value="cluster:${esc(name)}">${esc(t('cluster'))}: ${esc(name)}</option>`).join('')}${shownServers().map((server) => `<option value="server:${esc(server.name)}">${esc(t('server'))}: ${esc(server.name)}</option>`).join('')}</select></label>
          <label class="picker"><span class="mut">${esc(t('level'))}</span> <select data-export-level>${LEVELS.map(([value, label]) => `<option value="${value}"${value === 'standard' ? ' selected' : ''}>${esc(t(label))}</option>`).join('')}</select></label>
          <label class="picker"><span class="mut">${esc(t('format'))}</span> <select data-export-format>${FORMATS.map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('')}</select></label>
          ${range.html}
          <button class="acc" data-export-run><i class="fa-solid fa-file-export"></i> ${esc(t('exportNow'))}</button>
        </div></div>`;
    }
    return card('reports', tabs.html + body);
  },
};

/* The panel log as CSV. */
export function exportPanelLog() {
  const lines = state.cache.log?.lines || [];
  saveFile('panel-events.csv', `﻿${[['at', 'text'], ...lines.map((line) => [String(line).slice(0, 24).trim(), String(line).slice(24).trim()])].map((row) => row.map(csvCell).join(',')).join('\n')}`, 'text/csv;charset=utf-8');
}
