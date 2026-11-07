/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What the web panel's page and its sections share: the language, talking
 * to the panel and through it to each server, signing, the servers shown,
 * and the tables. Everything a server sends is escaped (esc) or made a
 * number (num) before it reaches the page. */
import { signHeader, normalizePath } from './sign.js';
import { T } from './strings.js';
import { ACTIONS } from './actions.js';

/* What each section shows of itself (its sub-tab, how its lists are grouped,
   what is searched for, which groups are folded): the admin's own choice,
   kept in this browser. */
const savedView = (() => { try { return JSON.parse(localStorage.getItem('panel_view') || '{}') || {}; } catch (_error) { return {}; } })();
export const state = {
  data: null, device: null, tab: 'overview', sections: [], cache: {}, rows: new Map(), busy: 0,
  filter: { cluster: '', hidden: new Set() },
  view: savedView.view && typeof savedView.view === 'object' ? savedView.view : {},
  folded: new Set(Array.isArray(savedView.folded) ? savedView.folded.slice(0, 500) : []),
  lang: (() => { try { return localStorage.getItem('panel_lang') || 'fa'; } catch (_error) { return 'fa'; } })(),
};
export const hooks = { render: () => {} };

export const t = (key) => (T[state.lang] && T[state.lang][key]) || T.fa[key] || key;
export const $ = (id) => document.getElementById(id);
export const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
export const pct = (used, total) => (total ? `${Math.round((used / total) * 100)}%` : '—');
export function fmtBytes(value) {
  let bytes = num(value);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unit = 0;
  while (bytes >= 1024 && unit < units.length - 1) { bytes /= 1024; unit += 1; }
  return `${bytes.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
export function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(state.lang === 'fa' ? 'fa-IR' : 'en-GB');
}

/* ---- talking to the panel ------------------------------------------------- */

/* Requests in flight (the thin bar at the top), and whether the panel
   answers at all (the banner that says the connection is lost). */
let inflight = 0;
const busyBar = (delta) => {
  inflight = Math.max(0, inflight + delta);
  document.documentElement.classList.toggle('loading', inflight > 0);
};
export async function api(path, body, { poll = false } = {}) {
  const headers = poll ? { 'X-Panel-Poll': '1' } : {};
  busyBar(1);
  let response;
  try {
    response = await fetch(path, body === undefined
      ? { credentials: 'same-origin', headers }
      : { method: 'POST', credentials: 'same-origin', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (_error) {
    hooks.offline?.(true);
    return { ok: false, reason: 'panel-unreachable', httpStatus: 0 };
  } finally {
    busyBar(-1);
  }
  hooks.offline?.(false);
  const answer = await response.json().catch(() => ({ ok: false }));
  if (response.status === 401 && path !== '/api/login') hooks.loggedOut?.();
  return { ...answer, httpStatus: response.status };
}

const dangerous = () => new Set((state.data?.dangerous || []).map(normalizePath));
export const isDangerous = (path) => dangerous().has(normalizePath(String(path).split('?')[0]));
export const serverNamed = (name) => (state.data?.servers || []).find((server) => server.name === name);
export const deviceListed = () => Boolean(state.device && (state.data?.admins || []).some((admin) => admin.id === state.device.keyId));

/* The signature a dangerous call carries: made here, with this browser's
   key, when the key is listed; an unlocked server takes the call unsigned,
   as its own dashboard does. */
async function signatureFor(server, method, path, body) {
  if (method !== 'POST' || !isDangerous(path)) return { signature: '' };
  if (deviceListed() && server.signFor) {
    return { signature: await signHeader({ method, path: path.split('?')[0], body: body ?? {}, relay: server.signFor }, state.device) };
  }
  if (server.locked) return { refused: { ok: false, reason: server.signFor ? 'signature-needed' : 'identity-unsure' } };
  return { signature: '' };
}

/* One call on one server's dashboard: { ok, status, answer }. */
export async function serverCall(name, method, path, body, { poll = false } = {}) {
  const server = serverNamed(name);
  if (!server) return { ok: false, reason: 'no-such-server' };
  const { signature, refused } = await signatureFor(server, method, path, body);
  if (refused) return refused;
  return api('/api/call', { server: name, method, path, body: method === 'POST' ? (body ?? {}) : undefined, signature }, { poll });
}

/* A file from a server (a backup, the image, the bundle), saved by the browser. */
export async function serverDownload(name, path, body, filename) {
  const server = serverNamed(name);
  if (!server) return { ok: false, reason: 'no-such-server' };
  const { signature, refused } = await signatureFor(server, 'POST', path, body);
  if (refused) return refused;
  const response = await fetch('/api/download', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server: name, path, body: body ?? {}, signature }),
  });
  if (!response.ok) return { ok: false, reason: (await response.json().catch(() => ({}))).reason || `http-${response.status}` };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(await response.blob());
  link.download = filename || 'download';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  return { ok: true };
}

/* ---- the servers shown ---------------------------------------------------- */

/* A server's cluster: the one the family directory gives it, or by region. */
export const clusterOf = (server) => server?.cluster || (server?.region === 'inside-iran' ? t('clusterIran') : server?.region ? t('clusterOutside') : t('noCluster'));
export function byCluster(servers) {
  const groups = new Map();
  for (const server of servers) {
    const name = clusterOf(server);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(server);
  }
  return [...groups.entries()];
}
export const allServers = () => state.data?.servers || [];
export const regionText = (region) => (region === 'inside-iran' ? t('insideIran') : region === 'outside-iran' ? t('outsideIran') : region || '—');
export const shownServers = () => allServers().filter((server) => (!state.filter.cluster || clusterOf(server) === state.filter.cluster) && !state.filter.hidden.has(server.name));
/* Results read before the servers shown changed are drawn only for the
   servers shown now, so a table never shows a server that is filtered out. */
export const visible = (results) => (results || []).filter((result) => shownServers().some((server) => server.name === result.server.name));

/* The same read on every server shown, at once. */
export async function fanOut(path, options = {}) {
  return fanOutOn(shownServers(), path, options);
}
/* The same read on the servers given. A read a few seconds old is taken
   again rather than asked for again, and one already on its way is shared:
   sections that read the same routes (the users, the relays and the
   clusters all read the links) cost one request between them, and switching
   between sections is immediate. Only reads: an action is never cached. */
const readCache = new Map();
export const READ_TTL_MS = 6000;
export function forgetReads() { readCache.clear(); }
export async function fanOutOn(list, path, { method = 'POST', body = {}, poll = false, fresh = false } = {}) {
  return Promise.all(list.map(async (server) => {
    const key = `${server.name} ${method} ${path} ${JSON.stringify(body)}`;
    const cached = readCache.get(key);
    let answer;
    if (!server.reachable) answer = { ok: false, reason: 'unreachable' };
    else if (!fresh && cached && Date.now() - cached.at < READ_TTL_MS) answer = await cached.promise;
    else {
      const promise = serverCall(server.name, method, path, method === 'POST' ? body : undefined, { poll });
      readCache.set(key, { at: Date.now(), promise });
      answer = await promise;
      if (!answer.ok) readCache.delete(key);
    }
    return { server, ok: Boolean(answer.ok), status: answer.status, data: answer.answer || {}, reason: answer.reason || answer.answer?.reason || '' };
  }));
}

/* ---- tables --------------------------------------------------------------- */

/* A row's data, for the buttons on it: kept here, never in an attribute.
   Handles only ever count up, so one from before a redraw finds nothing
   rather than another row. */
let rowSeq = 0;
export function rowRef(data) {
  rowSeq += 1;
  const id = `r${rowSeq}`;
  state.rows.set(id, data);
  return id;
}

/* A CSV cell. One a spreadsheet would take for a formula (a user can name
   themselves "=HYPERLINK(…)") is written as text. */
export function csvCell(value) {
  const text = String(value ?? '');
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}
export const serverCells = (server) => `<td><strong>${esc(server.name)}</strong></td><td>${esc(clusterOf(server))}</td>`;
export function button(act, ref, { cls = '', label } = {}) {
  const action = ACTIONS[act];
  return `<button data-act="${esc(act)}" data-row="${esc(ref)}"${cls ? ` class="${esc(cls)}"` : ''}>${esc(t(label || action?.label || act))}</button>`;
}
export function groupButton(act, { cls = '' } = {}) {
  return `<button data-group="${esc(act)}"${cls ? ` class="${esc(cls)}"` : ''}>${esc(t(ACTIONS[act].label))}</button>`;
}
export function table(headers, rows, { empty = true } = {}) {
  const body = rows.join('') || (empty ? `<tr><td colspan="${headers.length}" class="mut">${esc(t('empty'))}</td></tr>` : '');
  return `<div class="scroll"><table><thead><tr>${headers.map((head) => `<th>${esc(t(head))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}
/* The first table of every section: each server shown, how its read went,
   and the section's actions for that one server. */
export function serverTable(results, { extra = [], cells = () => [], actions = () => '', group = true } = {}) {
  /* Each server on its own row, under its cluster or its region, as the
     admin chose for every such table (the choice is one, for all of them). */
  const mode = group ? viewOf('tables:group', 'none') : 'none';
  const row = (result) => `<tr data-server-row="${esc(result.server.name)}">${serverCells(result.server)}`
    + `<td>${result.ok ? `<span class="tag good">${esc(t('answered'))}</span>` : `<span class="tag bad">${esc(t(result.reason === 'unreachable' ? 'unreachable' : 'failed'))}</span> <span class="mut">${esc(result.reason)}</span>`}</td>`
    + `${cells(result).map((cell) => `<td>${cell}</td>`).join('')}<td class="row">${actions(result)}</td></tr>`;
  const list = visible(results);
  const width = extra.length + 4;
  const rows = mode === 'none' ? list.map(row) : groupItems(list, (result) => groupLabel(result.server, mode)).flatMap(([label, members]) => [
    `<tr class="group"><td colspan="${width}">${esc(label)} <span class="count">${members.length}</span> <span class="mut small">${members.filter((result) => result.ok).length} ${esc(t('answered'))}</span></td></tr>`, ...members.map(row)]);
  const picker = group ? `<div class="table-tools"><label class="picker"><span class="mut">${esc(t('rowsBy'))}</span> <select data-view="tables:group">${['none', 'cluster', 'region'].map((value) => `<option value="${value}"${value === mode ? ' selected' : ''}>${esc(t(`rows_${value}`))}</option>`).join('')}</select></label></div>` : '';
  return picker + table(['server', 'cluster', 'state', ...extra, ''], rows);
}
export const card = (title, body, tools = '') => `<section class="card"><div class="row spread"><strong>${esc(t(title))}</strong><div class="row">${tools}</div></div>${body}</section>`;

/* ---- results -------------------------------------------------------------- */

export function show(value) { $('results').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
export function explain(answer) {
  const reason = answer?.reason || answer?.answer?.reason || '';
  if (reason === 'signature-needed' || reason === 'operator-signature-required') return t('signNeeded');
  if (reason === 'identity-unsure' || reason === 'identity-mismatch' || reason === 'operator-unconfirmed') return t('identityUnsure');
  if (reason === 'ssh-only') return t('sshOnly');
  return reason || (answer?.ok ? t('ok') : t('failed'));
}
/* One line per server: "r1: ok — …" */
export function report(lines) {
  show(lines.map(({ server, answer }) => {
    const ok = Boolean(answer?.ok) && answer?.answer?.ok !== false;
    const detail = ok ? summarize(answer?.answer) : explain(answer?.answer?.reason ? answer.answer : answer);
    return `${server}: ${ok ? 'ok' : 'error'}${detail ? ` — ${detail}` : ''}`;
  }).join('\n'));
}
function summarize(answer) {
  if (!answer || typeof answer !== 'object') return '';
  const keep = Object.entries(answer).filter(([key, value]) => key !== 'ok' && (typeof value !== 'object' || value === null)).slice(0, 6);
  return keep.map(([key, value]) => `${key}: ${String(value).slice(0, 80)}`).join(', ');
}

/* ---- sub-tabs, grouping, searching ---------------------------------------- */

function saveView() {
  try { localStorage.setItem('panel_view', JSON.stringify({ view: state.view, folded: [...state.folded].slice(-500) })); } catch (_error) { /* a private window */ }
}
export const viewOf = (key, fallback) => (state.view[key] !== undefined ? state.view[key] : fallback);
export function setView(key, value) { state.view[key] = value; saveView(); }
export function setFolded(key, folded) { if (folded) state.folded.add(key); else state.folded.delete(key); saveView(); }

/* A row of sub-tabs: items are [key, label, count?]. The one shown is
   returned with the HTML, so a section draws only that part. */
export function subtabs(section, items) {
  const keys = items.map(([key]) => key);
  let current = viewOf(`${section}:tab`, keys[0]);
  if (!keys.includes(current)) current = keys[0];
  const html = `<nav class="subtabs" role="tablist">${items.map(([key, label, count]) => `<button role="tab" data-subtab="${esc(section)}" data-subtab-key="${esc(key)}" aria-selected="${key === current}">${esc(t(label))}${count !== undefined && count !== null ? ` <span class="count">${esc(count)}</span>` : ''}</button>`).join('')}</nav>`;
  return { html, current };
}

/* How a list is grouped: by server, cluster, region, or not at all (and
   whatever else a section adds, such as the container). */
export const GROUPINGS = ['server', 'cluster', 'region', 'none'];
export function groupPicker(key, modes = GROUPINGS, fallback = modes[0]) {
  const current = modes.includes(viewOf(key, fallback)) ? viewOf(key, fallback) : fallback;
  return {
    current,
    html: `<label class="picker"><i class="fa-solid fa-layer-group"></i> <span class="mut">${esc(t('groupBy'))}</span> <select data-view="${esc(key)}">${modes.map((mode) => `<option value="${esc(mode)}"${mode === current ? ' selected' : ''}>${esc(t(`by_${mode}`))}</option>`).join('')}</select></label>`,
  };
}
/* A picker of any kind of value, kept like the grouping. */
export function viewPicker(key, options, fallback, label = '') {
  const values = options.map(([value]) => value);
  const current = values.includes(viewOf(key, fallback)) ? viewOf(key, fallback) : fallback;
  return {
    current,
    html: `<label class="picker">${label ? `<span class="mut">${esc(t(label))}</span> ` : ''}<select data-view="${esc(key)}">${options.map(([value, text]) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(t(text))}</option>`).join('')}</select></label>`,
  };
}
export function groupLabel(server, mode) {
  if (!server) return t('noServer');
  if (mode === 'cluster') return clusterOf(server);
  if (mode === 'region') return regionText(server.region);
  if (mode === 'server') return server.name;
  return t('everything');
}
/* Items into groups, in the order first met (servers' order), as [label, items]. */
export function groupItems(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = String(keyOf(item) ?? '—');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()];
}
/* Each group folded or open (the admin's choice is kept), its count beside its name. */
export function grouped(id, groups, render, { summary = () => '' } = {}) {
  if (!groups.length) return `<p class="mut">${esc(t('empty'))}</p>`;
  if (groups.length === 1 && groups[0][0] === t('everything')) return render(groups[0][1], groups[0][0]);
  return groups.map(([label, items]) => {
    const key = `${id}:${label}`;
    return `<details class="grp" data-grp="${esc(key)}"${state.folded.has(key) ? '' : ' open'}><summary><strong>${esc(label)}</strong> <span class="count">${items.length}</span> <span class="mut">${summary(items, label)}</span></summary>${render(items, label)}</details>`;
  }).join('');
}
/* A search box over the tables marked with the same id; what is typed is
   kept, and applied again after every redraw. */
export function searchBox(id) {
  return `<label class="picker search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" data-search="${esc(id)}" value="${esc(viewOf(`search:${id}`, ''))}" placeholder="${esc(t('search'))}"></label>`;
}
export function applySearch(root = document) {
  for (const box of root.querySelectorAll('[data-search]')) {
    const id = box.getAttribute('data-search');
    const words = String(box.value || '').trim().toLowerCase();
    for (const area of root.querySelectorAll(`[data-searchable="${CSS.escape(id)}"]`)) {
      for (const row of area.querySelectorAll('tbody tr:not(.group)')) row.hidden = Boolean(words) && !row.textContent.toLowerCase().includes(words);
      for (const group of area.querySelectorAll('details.grp')) {
        const rows = [...group.querySelectorAll('tbody tr:not(.group)')];
        group.hidden = Boolean(words) && rows.length > 0 && rows.every((row) => row.hidden);
      }
    }
  }
}

/* A file made in the page, saved by the browser. */
export function saveFile(name, content, type = 'text/plain;charset=utf-8') {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}
export function fmtNum(value) {
  const n = num(value);
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
export const tag = (text, cls = '') => `<span class="tag ${esc(cls)}">${esc(text)}</span>`;
export const kpi = (label, value, sub = '', cls = '') => `<div class="kpi ${esc(cls)}"><span class="mut">${esc(t(label))}</span><strong>${esc(value)}</strong>${sub ? `<span class="mut small">${esc(sub)}</span>` : ''}</div>`;
