/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The overview: the whole family at a glance, live. Tiles with the numbers
 * that matter now, then graphs of every server over time (tools/panel/
 * metrics.mjs keeps them), grouped as the admin chooses — one server at a
 * time, by cluster, by region, or all together — in categories: resources,
 * traffic, users, the network and its queues. Below, a card for each server,
 * grouped the same way. The graphs are read again every few seconds while
 * the overview is open, without redrawing anything else. */
import {
  state, t, esc, num, pct, api, shownServers, clusterOf, regionText, groupLabel, groupItems, grouped, groupPicker, viewPicker, kpi, fmtNum, fmtBytes,
} from './ui.js';
import { lineChart, colorOf, fmtValue } from './charts.js';

/* What each category draws: one chart per entry. `keys` are summed into one
   line per server when servers are drawn together, and drawn as their own
   lines for one server; `additive` adds a total line to a group. */
export const CATEGORIES = {
  resources: [
    { id: 'cpu', label: 'cpu', keys: ['cpu'], unit: '%', max: 100 },
    { id: 'mem', label: 'memory', keys: ['memMb'], unit: 'MB' },
    { id: 'memPct', label: 'memoryPct', keys: ['memPct'], unit: '%', max: 100 },
    { id: 'disk', label: 'disk', keys: ['diskPct'], unit: '%', max: 100 },
  ],
  traffic: [
    { id: 'msgs', label: 'msgsPerMin', keys: ['msgsInRate', 'msgsOutRate'], names: ['msgsIn', 'msgsOut'], unit: '/min', additive: true },
    { id: 'bytes', label: 'bandwidth', keys: ['bytesInRate', 'bytesOutRate'], names: ['bytesIn', 'bytesOut'], unit: 'B/s', additive: true },
    { id: 'relayed', label: 'relayedPerMin', keys: ['relayedRate'], unit: '/min', additive: true },
  ],
  users: [
    { id: 'peers', label: 'online', keys: ['peers'], additive: true },
    { id: 'calls', label: 'activeCalls', keys: ['calls'], additive: true },
  ],
  network: [
    { id: 'links', label: 'linksUp', keys: ['linksUp'], additive: true },
    { id: 'queued', label: 'queued', keys: ['queued'], additive: true },
    { id: 'queuedBytes', label: 'queuedBytes', keys: ['queuedBytes'], unit: 'B', additive: true },
    { id: 'up', label: 'availability', keys: ['up'], unit: '%', max: 100, scale: 100 },
  ],
};
export const REFRESH = [['1', 'every1s'], ['3', 'every3s'], ['5', 'every5s'], ['10', 'every10s'], ['30', 'every30s'], ['60', 'every60s']];
export const refreshSeconds = () => Math.max(1, Number(state.view['overview:refresh'] || 5));
export const RANGES = [['15m', 'range15m'], ['1h', 'range1h'], ['2h', 'range2h'], ['6h', 'range6h'], ['24h', 'range24h'], ['7d', 'range7d']];

export async function loadMetrics(poll = false) {
  const range = state.view['metrics:range'] || '1h';
  /* The panel reads the servers at the pace the overview refreshes at. */
  const pace = refreshSeconds() * 1000;
  const answer = await api(`/api/metrics?range=${encodeURIComponent(range)}&pace=${pace}&points=360`, undefined, { poll });
  if (answer.httpStatus === 200) { state.cache.metrics = answer; state.cache.metricsAt = Date.now(); }
}

const seriesOf = (name) => (state.cache.metrics?.servers || []).find((entry) => entry.name === name)?.points || [];
const valueOf = (point, keys, scale = 1) => keys.reduce((sum, key) => sum + num(point[key]), 0) * scale;
const latest = (name) => seriesOf(name).slice(-1)[0] || null;

/* Charts for one metric in one group of servers. */
export function metricChart(metric, servers, { single = false } = {}) {
  const metrics = state.cache.metrics || {};
  const scale = metric.scale || 1;
  let series;
  if (single && servers.length === 1 && metric.keys.length > 1) {
    series = metric.keys.map((key, index) => ({ label: t(metric.names?.[index] || key), color: colorOf(index), points: seriesOf(servers[0].name).map((point) => [point.t, num(point[key]) * scale]) }));
  } else {
    series = servers.map((server, index) => ({ label: server.name, color: colorOf(allIndex(server.name, index)), points: seriesOf(server.name).map((point) => [point.t, valueOf(point, metric.keys, scale)]) }));
    if (metric.additive && servers.length > 1) {
      const times = new Map();
      for (const entry of series) for (const [at, value] of entry.points) times.set(at, (times.get(at) || 0) + value);
      series.push({ label: t('total'), color: '#e2e8f0', dashed: true, points: [...times.entries()].sort((a, b) => a[0] - b[0]) });
    }
  }
  return lineChart({ title: t(metric.label), series, unit: metric.unit || '', max: metric.max ?? null, from: metrics.from, to: metrics.to, empty: t('noReadings') });
}
/* A server keeps its colour whatever group it is drawn in. */
const allIndex = (name, fallback) => {
  const index = shownServers().findIndex((server) => server.name === name);
  return index >= 0 ? index : fallback;
};

export function chartsFor(servers, category, { single = false } = {}) {
  const cats = category === 'all' ? Object.keys(CATEGORIES) : [category];
  return cats.map((cat) => `${category === 'all' ? `<h3>${esc(t(`cat_${cat}`))}</h3>` : ''}<div class="charts">${CATEGORIES[cat].map((metric) => metricChart(metric, servers, { single })).join('')}</div>`).join('');
}

/* The tiles: what is true now, over the servers shown. */
function tiles() {
  const servers = shownServers();
  const now = servers.map((server) => latest(server.name)).filter(Boolean);
  const up = servers.filter((server) => server.reachable).length;
  const sum = (key) => now.reduce((total, point) => total + num(point[key]), 0);
  const cpu = now.filter((point) => point.up).map((point) => num(point.cpu));
  return `<div class="kpis">${[
    kpi('servers', `${up}/${servers.length}`, '', up === servers.length ? 'good' : 'warn'),
    kpi('online', fmtNum(servers.reduce((total, server) => total + num(server.peers), 0))),
    kpi('activeCalls', fmtNum(sum('calls'))),
    kpi('linksUp', `${fmtNum(sum('linksUp'))}/${fmtNum(sum('linksAllowed'))}`),
    kpi('msgsPerMin', fmtNum(sum('msgsInRate') + sum('msgsOutRate'))),
    kpi('bandwidth', `${fmtBytes(sum('bytesInRate') + sum('bytesOutRate'))}/s`),
    kpi('queued', fmtNum(sum('queued')), fmtBytes(sum('queuedBytes'))),
    kpi('cpuAvg', cpu.length ? `${Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length)}%` : '—'),
  ].join('')}</div>`;
}

/* The graphs, grouped; drawn again on their own every few seconds. */
export function liveCharts() {
  const focused = shownServers().find((server) => server.name === state.view['overview:focus']);
  if (focused) return focusCharts(focused);
  const mode = state.view['overview:group'] || 'cluster';
  const category = state.view['overview:cat'] || 'resources';
  const servers = shownServers();
  if (!state.cache.metrics) return `<p class="mut">${esc(t('loading'))}</p>`;
  const groups = mode === 'none' ? [[t('everything'), servers]] : groupItems(servers, (server) => groupLabel(server, mode));
  return tiles() + grouped('overview-charts', groups, (members) => chartsFor(members, category, { single: mode === 'server' }), {
    summary: (members) => esc(`${members.filter((server) => server.reachable).length}/${members.length} ${t('reachable')}`),
  });
}

export function serverCard(server) {
  const problem = server.problem && server.problem !== 'unreachable' ? server.problem : 'unreachable';
  const status = !server.reachable ? `<span class="tag bad" title="${esc(server.problemDetail || '')}">${esc(t(problem))}</span>`
    : `${server.locked ? `<span class="tag good">${esc(t('locked'))}</span>` : `<span class="tag">${esc(t('unlocked'))}</span>`}${server.passwordOk ? '' : ` <span class="tag warn">${esc(t('passwordNeeded'))}</span>`}`;
  const memory = server.containerMem ? `${num(server.containerMem.usageMb)}${server.containerMem.limitMb ? ` / ${num(server.containerMem.limitMb)}` : ''} MB`
    : server.memory?.rss ? `${num(server.memory.rss)} MB` : '—';
  const disk = server.storage ? pct(num(server.storage.total) - num(server.storage.free), num(server.storage.total)) : '—';
  const links = server.links ? `${num(server.links.up)}/${num(server.links.allowed)}` : '—';
  const family = server.family ? `${esc(server.family.name)} #${num(server.family.serial)}` : '—';
  const load = Array.isArray(server.cpu) ? `${Math.round(num(server.cpu[0]))}%` : '—';
  const point = latest(server.name);
  return `<div class="card" data-server-card="${esc(server.name)}"><div class="row spread"><h3>${esc(server.name)}</h3>${status}</div>
    <div class="kv">
      <span>${esc(t('version'))}</span><span class="mono">${esc(server.version || '—')}</span>
      <span>${esc(t('cluster'))}</span><span>${esc(clusterOf(server))} · ${esc(regionText(server.region))}</span>
      <span>${esc(t('cpu'))}</span><span class="mono">${esc(load)}</span>
      <span>${esc(t('memory'))}</span><span>${esc(memory)}</span>
      <span>${esc(t('disk'))}</span><span>${esc(disk)}</span>
      <span>${esc(t('online'))}</span><span>${num(server.peers)}</span>
      <span>${esc(t('links'))}</span><span>${esc(links)}</span>
      <span>${esc(t('msgsPerMin'))}</span><span>${point ? esc(fmtValue(num(point.msgsInRate) + num(point.msgsOutRate), '/min')) : '—'}</span>
      <span>${esc(t('family'))}</span><span>${family}</span>
      <span>${esc(t('gateway'))}</span><span>${server.gateway ? num(server.gateway) : '—'}</span>
    </div>
    <div class="row">
      <button data-lock="${esc(server.name)}" data-on="${server.locked ? '0' : '1'}"${server.locked ? '' : ' class="acc"'}>${esc(t(server.locked ? 'lockOff' : 'lockOn'))}</button>
      ${server.passwordOk || !server.reachable ? '' : `<input type="password" data-password="${esc(server.name)}" placeholder="${esc(t('passwordNeeded'))}">`}
      ${server.reachable ? '' : `<button data-reconnect="${esc(server.name)}">${esc(t('reconnect'))}</button>`}
    </div>${!server.reachable && server.problemDetail ? `<div class="mut mono small">${esc(server.problemDetail)}</div>` : ''}</div>`;
}

/* One server on its own: every category of its graphs, its card, its numbers. */
function focusView(focus, refresh) {
  const server = shownServers().find((entry) => entry.name === focus.current);
  if (!server) return '';
  const range = viewPicker('metrics:range', RANGES, '1h', 'range');
  const point = latest(server.name) || {};
  return `<section class="card"><div class="card-head"><h2><i class="fa-solid fa-server"></i> ${esc(server.name)} <span class="live-dot"></span></h2><div class="row">${focus.html}${range.html}${refresh.html}</div></div>
      <div id="liveCharts">${focusCharts(server, point)}</div></section>
    <section class="card"><div class="cards">${serverCard(server)}</div></section>`;
}
function focusCharts(server, point = latest(server.name) || {}) {
  return `<div class="kpis">${[
    kpi('cpu', `${Math.round(num(point.cpu))}%`), kpi('memory', `${fmtNum(point.memMb)} MB`, point.memLimitMb ? `/ ${fmtNum(point.memLimitMb)} MB` : ''), kpi('disk', `${Math.round(num(point.diskPct))}%`),
    kpi('online', fmtNum(point.peers)), kpi('activeCalls', fmtNum(point.calls)), kpi('msgsPerMin', fmtNum(num(point.msgsInRate) + num(point.msgsOutRate))),
    kpi('bandwidth', `${fmtBytes(num(point.bytesInRate) + num(point.bytesOutRate))}/s`), kpi('linksUp', `${fmtNum(point.linksUp)}/${fmtNum(point.linksAllowed)}`), kpi('queued', fmtNum(point.queued)),
  ].join('')}</div>${chartsFor([server], 'all', { single: true })}`;
}

export const overview = {
  id: 'overview', title: 'overview',
  /* Drawn at once; the graphs fill in when their readings arrive. */
  mount() {
    if (state.cache.metrics && Date.now() - (state.cache.metricsAt || 0) < 10000) return;
    loadMetrics().then(() => {
      const box = document.getElementById('liveCharts');
      if (box && state.tab === 'overview') box.innerHTML = liveCharts();
    });
  },
  render() {
    const group = groupPicker('overview:group', ['server', 'cluster', 'region', 'none'], 'cluster');
    const refresh = viewPicker('overview:refresh', REFRESH, '5', 'refreshRate');
    const focus = viewPicker('overview:focus', [['', 'allServers'], ...shownServers().map((server) => [server.name, server.name])], '', 'focusServer');
    if (focus.current) return focusView(focus, refresh);
    const category = viewPicker('overview:cat', [['resources', 'cat_resources'], ['traffic', 'cat_traffic'], ['users', 'cat_users'], ['network', 'cat_network'], ['all', 'cat_all']], 'resources', 'category');
    const range = viewPicker('metrics:range', RANGES, '1h', 'range');
    const cardsMode = state.view['overview:group'] || 'cluster';
    const servers = shownServers();
    const cardGroups = cardsMode === 'none' || cardsMode === 'server' ? [[t('everything'), servers]] : groupItems(servers, (server) => groupLabel(server, cardsMode));
    return `<section class="card"><div class="card-head"><h2><i class="fa-solid fa-chart-line"></i> ${esc(t('liveGraphs'))} <span class="live-dot" title="live"></span></h2>
        <div class="row">${focus.html}${group.html}${category.html}${range.html}${refresh.html}</div></div>
        <div id="liveCharts">${liveCharts()}</div></section>
      <section class="card"><div class="card-head"><h2>${esc(t('servers'))}</h2></div>
        ${grouped('overview-cards', cardGroups, (members) => `<div class="cards">${members.map(serverCard).join('')}</div>`, {
    summary: (members) => esc(`${t('online')} ${members.reduce((total, server) => total + num(server.peers), 0)}`),
  })}</section>`;
  },
};
