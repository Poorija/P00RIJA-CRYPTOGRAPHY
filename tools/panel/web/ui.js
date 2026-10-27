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

export const state = {
  data: null, device: null, tab: 'overview', sections: [], cache: {}, rows: new Map(), busy: 0,
  filter: { cluster: '', hidden: new Set() },
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

export async function api(path, body, { poll = false } = {}) {
  const headers = poll ? { 'X-Panel-Poll': '1' } : {};
  const response = await fetch(path, body === undefined
    ? { credentials: 'same-origin', headers }
    : { method: 'POST', credentials: 'same-origin', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
export async function fanOut(path, { method = 'POST', body = {}, poll = false } = {}) {
  return Promise.all(shownServers().map(async (server) => {
    const answer = server.reachable ? await serverCall(server.name, method, path, method === 'POST' ? body : undefined, { poll }) : { ok: false, reason: 'unreachable' };
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
export function serverTable(results, { extra = [], cells = () => [], actions = () => '' } = {}) {
  const rows = visible(results).map((result) => `<tr data-server-row="${esc(result.server.name)}">${serverCells(result.server)}`
    + `<td>${result.ok ? `<span class="tag good">${esc(t('answered'))}</span>` : `<span class="tag bad">${esc(t(result.reason === 'unreachable' ? 'unreachable' : 'failed'))}</span> <span class="mut">${esc(result.reason)}</span>`}</td>`
    + `${cells(result).map((cell) => `<td>${cell}</td>`).join('')}<td class="row">${actions(result)}</td></tr>`);
  return table(['server', 'cluster', 'state', ...extra, ''], rows);
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
