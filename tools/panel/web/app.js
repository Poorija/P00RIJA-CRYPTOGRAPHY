/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The web panel's page (tools/panel/web/index.html): the login, the servers
 * shown (by cluster or one by one), the overview, this browser's signing
 * key, and the sections of sections.js. */
import { signHeader, deviceKey, makeDeviceKey, forgetDeviceKey } from './sign.js';
import {
  state, hooks, t, $, esc, api, serverNamed, deviceListed, show, explain, clusterOf, allServers, shownServers, setView, setFolded, applySearch, forgetReads,
} from './ui.js';
import { SECTIONS, runRow, runGroup, runPicked, runForm, openMailbox, showLogs, exportCsv } from './sections.js';
import { network, networkClick, wireGatewayDrag } from './graph.js';
import { servers as serversSection, family as familySection, account as accountSection, adminClick, closeDialog, openDialog } from './admin.js';
import { updatesClick, updatesChange } from './updates.js';
import { telegramSection, telegramClick, telegramChange } from './telegram.js';
import { overview, liveCharts, loadMetrics, refreshSeconds } from './overview.js';
import { clusters, clustersClick } from './clusters.js';
import { ops, opsClick } from './ops.js';
import { build, buildClick } from './build.js';
import { help, about } from './help.js';
import { runExport, exportPanelLog } from './reports.js';
import { wireCharts, forgetCharts } from './charts.js';
import { admins, sharesClick, strength } from './share.js';

/* ---- the overview and the key --------------------------------------------- */

function renderKeys() {
  if (!globalThis.crypto?.subtle) return `<section class="card bad-text">${esc(t('noWebCrypto'))}</section>`;
  if (!state.device) return `<section class="card"><p>${esc(t('deviceNone'))}</p><p class="mut">${esc(t('keyWarning'))}</p><button class="acc" id="makeKey">${esc(t('makeKey'))}</button></section>`;
  const command = `node tools/relay-directory.mjs admin-add ${JSON.stringify(state.device.name || 'browser')} ${state.device.spki}\nnode tools/relay-directory.mjs sign && node tools/relay-directory.mjs publish`;
  return `<section class="card">
    <p><span class="tag ${deviceListed() ? 'good' : 'warn'}">${esc(t(deviceListed() ? 'deviceListed' : 'deviceUnlisted'))}</span></p>
    <div class="kv"><span>${esc(t('name'))}</span><span>${esc(state.device.name)}</span><span>${esc(t('keyId'))}</span><span class="mono">${esc(state.device.keyId)}</span></div>
    <p>${esc(t('keyHelp'))}</p><pre>${esc(command)}</pre>
    <p class="mut">${esc(t('keyWarning'))}</p>
    <div class="row"><button id="checkAgain">${esc(t('checkAgain'))}</button><button class="bad" id="forgetKey">${esc(t('forgetKey'))}</button></div></section>`;
}

state.sections.push(overview, network, ...SECTIONS, clusters, ops, build, { id: 'keys', title: 'keys', render: renderKeys },
  serversSection, familySection, admins, accountSection, telegramSection, help, about);

/* The sidebar: what each section is under, and its icon. */
const GROUPS = [
  ['groupMain', ['overview', 'network']],
  ['groupAdmin', ['servers', 'clusters', 'family', 'admins', 'partners', 'telegram', 'keys', 'account']],
  ['groupMonitor', ['queues', 'users', 'relays', 'traffic', 'reports']],
  ['groupOps', ['build', 'ops']],
  ['groupInfo', ['help', 'about']],
];
const ICONS = {
  overview: 'fa-gauge-high', network: 'fa-diagram-project', servers: 'fa-server', clusters: 'fa-layer-group', family: 'fa-file-signature', keys: 'fa-key',
  account: 'fa-user-shield', queues: 'fa-inbox', users: 'fa-users', relays: 'fa-tower-broadcast', traffic: 'fa-chart-line', machine: 'fa-hard-drive',
  reports: 'fa-file-lines', telegram: 'fa-paper-plane', partners: 'fa-handshake', build: 'fa-box-open', ops: 'fa-screwdriver-wrench',
  help: 'fa-circle-question', about: 'fa-circle-info', admins: 'fa-users-gear',
};
function renderSidebar() {
  const known = new Set(state.sections.map((section) => section.id));
  $('sidebar').innerHTML = GROUPS.map(([group, ids]) => `<div class="side-group"><div>${esc(t(group))}</div>${ids.filter((id) => known.has(id)).map((id) => {
    const section = state.sections.find((candidate) => candidate.id === id);
    return `<button data-tab="${esc(id)}" data-section="${esc(id)}" aria-selected="${id === state.tab}"><i class="fa-solid ${ICONS[id] || 'fa-circle'}"></i><span>${esc(t(section.title))}</span></button>`;
  }).join('')}</div>`).join('');
}

/* The chips at the top: every server, from a light list read every few
   seconds, so one added or removed in deploy.conf shows without a reload. */
function renderChips(list) {
  $('serverChips').innerHTML = (list || []).map((server) => `<span class="srv-chip ${server.reachable ? 'up' : 'down'}" data-chip="${esc(server.name)}" title="${esc(server.problem ? t(server.problem) : server.reachable ? t('reachable') : t('unreachable'))}">${esc(server.name)}</span>`).join('');
}

/* Dark by default; the choice stays in this browser. */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  try { localStorage.setItem('panel_theme', document.documentElement.dataset.theme); } catch (_error) { /* a private window */ }
}
applyTheme((() => { try { return localStorage.getItem('panel_theme') || 'dark'; } catch (_error) { return 'dark'; } })());

/* ---- the page ------------------------------------------------------------- */

function applyLang() {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'fa' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((node) => { node.textContent = t(node.getAttribute('data-t')); });
  document.querySelectorAll('[data-ph]').forEach((node) => { node.placeholder = t(node.getAttribute('data-ph')); });
  document.querySelectorAll('[data-lang-toggle]').forEach((node) => { node.textContent = state.lang === 'fa' ? 'EN' : 'فا'; });
}

/* A section being read for the first time: a spinner, and after a while a
   way out (the CSS shows the button only if it takes long). */
const loadingCard = () => `<section class="card loading-card"><div class="spinner" aria-hidden="true"></div><div><strong>${esc(t('loadingSection'))}</strong><p class="mut">${esc(t('loadingSectionHelp'))}</p>
  <button class="late" id="reloadSection"><i class="fa-solid fa-rotate"></i> ${esc(t('tryAgain'))}</button></div></section>`;

const current = () => state.sections.find((candidate) => candidate.id === state.tab) || state.sections[0];

function renderFilter() {
  const clusters = [...new Set(allServers().map(clusterOf))];
  if (state.filter.cluster && !clusters.includes(state.filter.cluster)) state.filter.cluster = '';
  $('filterCluster').innerHTML = `<option value="">${esc(t('allClusters'))}</option>${clusters.map((name) => `<option value="${esc(name)}"${name === state.filter.cluster ? ' selected' : ''}>${esc(name)}</option>`).join('')}`;
  $('filterServers').innerHTML = allServers().filter((server) => !state.filter.cluster || clusterOf(server) === state.filter.cluster)
    .map((server) => `<label class="chip"><input type="checkbox" data-filter-server="${esc(server.name)}"${state.filter.hidden.has(server.name) ? '' : ' checked'}>${esc(server.name)}</label>`).join('');
}

function render() {
  const data = state.data || {};
  $('userName').textContent = data.user || '';
  $('deviceState').textContent = t(!state.device ? 'deviceNone' : deviceListed() ? 'deviceListed' : 'deviceUnlisted');
  $('deviceState').className = `tag ${deviceListed() ? 'good' : 'warn'}`;
  const operator = data.operator || {};
  $('trustBox').hidden = Boolean(operator.confirmed);
  $('operatorCandidates').textContent = (operator.candidates || []).map((candidate) => `${candidate.name} — ${candidate.id}`).join('\n');
  renderSidebar();
  renderChips(state.chips || data.servers);
  renderFilter();
  state.rows.clear();
  const section = current();
  const ready = !section.load || state.loaded.has(section.id);
  $('sections').innerHTML = ready ? section.render() : loadingCard();
  forgetCharts($('sections'));
  if (ready) { section.mount?.(); applySearch($('sections')); }
}
hooks.render = render;
state.loaded = new Set();

/* The section shown, read again; the page's own polling marks itself so it
   does not keep the session alive. */
/* Someone is typing, or has typed something not yet sent: a redraw now
   would take it away. */
function typing() {
  if (document.activeElement?.closest?.('[data-form], [data-ram], [data-cpu], select[data-gw-id], #sections input:not([data-search]), #sections select:not([data-view]), #sections textarea')) return true;
  return [...document.querySelectorAll('#sections input:not([type="checkbox"]):not([type="radio"]):not([readonly]):not([data-search]):not([type="number"]), #sections textarea')].some((field) => field.value);
}

async function reload({ poll = false, force = false } = {}) {
  const section = current();
  const shownBefore = state.loaded.has(section.id);
  if (section.load) {
    await section.load(poll);
    state.loaded.add(section.id);
  }
  /* A section already on screen keeps what is being typed into it; one shown
     for the first time is drawn with its data. */
  if (force || !shownBefore || !typing()) render();
}
hooks.reload = () => refresh().then(() => reload({ force: true }));

async function refresh({ poll = false } = {}) {
  const data = await api('/api/servers', undefined, { poll });
  if (data.httpStatus !== 200) return;
  state.data = data;
}

function showLogin(message) {
  bootDone();
  state.data = null;
  $('appView').hidden = true;
  $('loginView').hidden = false;
  $('loginError').textContent = message || '';
}
hooks.loggedOut = () => showLogin(t('sessionEnded'));

function bootDone() { $('boot')?.remove(); }

async function showApp() {
  $('loginView').hidden = true;
  $('appView').hidden = false;
  try { state.device = await deviceKey(); } catch (_error) { state.device = null; }
  await refresh();
  bootDone();
  render();
  reload().then(prefetch);
}

/* Every section's data read quietly in the background after login, one at
   a time, so each opens with its data already there (and is read again,
   fresh, when it is opened). */
const PREFETCH = ['network', 'queues', 'users', 'relays', 'partners', 'traffic', 'clusters', 'reports', 'ops', 'telegram'];
async function prefetch() {
  for (const id of PREFETCH) {
    if (!state.data || document.hidden) return;
    const section = state.sections.find((candidate) => candidate.id === id);
    if (!section?.load || state.loaded.has(id) || state.tab === id) continue;
    try { await section.load(true); state.loaded.add(id); } catch (_error) { /* read when opened */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/* The panel itself not answering: said at once, and gone when it answers. */
hooks.offline = (down) => {
  const banner = $('offline');
  if (banner && banner.hidden === !down) return;
  if (banner) banner.hidden = !down;
};

async function openTab(id) {
  state.tab = id;
  document.querySelector('.app')?.classList.remove('menu-open');
  render();
  await reload();
}

document.addEventListener('click', async (event) => {
  const target = event.target;
  if (target.closest('#themeToggle, [data-theme-toggle]')) { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); return; }
  if (target.closest('#menuToggle')) { document.querySelector('.app')?.classList.toggle('menu-open'); return; }
  if (event.target.id === 'dialog') { closeDialog(); return; }
  if (await adminClick(target)) return;
  if (await updatesClick(target)) return;
  if (await telegramClick(target)) return;
  if (await buildClick(target)) return;
  if (await opsClick(target)) return;
  if (await clustersClick(target, { runGroup })) return;
  if (state.tab === 'admins' && await sharesClick(target)) return;
  const sub = target.closest('[data-subtab]');
  if (sub) {
    const section = sub.getAttribute('data-subtab');
    setView(`${section}:tab`, sub.getAttribute('data-subtab-key'));
    /* The operations section reads only what its sub-tab shows. */
    if (section === 'ops') await reload({ force: true }); else render();
    return;
  }
  if (target.closest('[data-export-run]')) { await runExport(target.closest('[data-export-form]')); return; }
  if (target.closest('[data-panel-log-export]')) { exportPanelLog(); return; }
  const editPartner = target.closest('[data-partner-edit]');
  if (editPartner) { partnerDialog(editPartner.getAttribute('data-partner-edit')); return; }
  if (target.closest('#partnerSave') || target.closest('#partnerForget')) {
    const id = target.closest('[data-operator]').getAttribute('data-operator');
    const forget = Boolean(target.closest('#partnerForget'));
    const value = (field) => String($(field)?.value || '');
    const answer = await api('/api/partner-notes', forget ? { operatorId: id, remove: true } : { operatorId: id, label: value('pnLabel'), contact: value('pnContact'), tags: value('pnTags'), notes: value('pnNotes') });
    if (answer.ok) { state.cache.partners = { ...state.cache.partners, notes: answer.notes }; closeDialog(); render(); } else show(t(answer.reason || 'failed'));
    return;
  }
  if (target.closest('[data-lang-toggle]')) {
    state.lang = state.lang === 'fa' ? 'en' : 'fa';
    try { localStorage.setItem('panel_lang', state.lang); } catch (_error) { /* a private window */ }
    applyLang();
    if (state.data) render();
    return;
  }
  const tab = target.closest('[data-tab]');
  if (tab) { await openTab(tab.getAttribute('data-tab')); return; }
  if (target.closest('#refreshButton') || target.closest('#reloadSection')) { forgetReads(); await refresh(); await reload({ force: true }); return; }
  if (state.tab === 'network' && await networkClick(target)) return;
  const act = target.closest('[data-act]');
  if (act) { await runRow(act.getAttribute('data-act'), act.getAttribute('data-row')); return; }
  const group = target.closest('[data-group]');
  if (group) { await runGroup(group.getAttribute('data-group')); return; }
  const picked = target.closest('[data-pick-run]');
  if (picked) { await runPicked(picked.getAttribute('data-pick-run')); return; }
  const form = target.closest('[data-form-run]');
  if (form) { await runForm(form.getAttribute('data-form-run'), form.closest('[data-form]')); return; }
  const mailbox = target.closest('[data-open-mailbox]');
  if (mailbox) { await openMailbox(state.rows.get(mailbox.getAttribute('data-open-mailbox'))); render(); return; }
  const logs = target.closest('[data-logs]');
  if (logs) { await showLogs(state.rows.get(logs.getAttribute('data-logs'))); return; }
  const csv = target.closest('[data-export]');
  if (csv) { exportCsv(csv.getAttribute('data-export')); return; }
  if (target.closest('#makeKey')) {
    const name = (prompt(t('keyNamePrompt')) || '').trim();
    if (!name) return;
    state.device = await makeDeviceKey(name);
    render();
    return;
  }
  if (target.closest('#checkAgain')) {
    await api('/api/family-refresh', {});
    await refresh();
    render();
    return;
  }
  if (target.closest('#forgetKey')) {
    if (!confirm(t('confirmForget'))) return;
    await forgetDeviceKey();
    state.device = null;
    render();
    return;
  }
  const again = target.closest('[data-reconnect]');
  if (again) {
    again.disabled = true;
    show(explain(await api('/api/reconnect', { server: again.getAttribute('data-reconnect') })));
    await refresh();
    render();
    return;
  }
  const lock = target.closest('[data-lock]');
  if (lock) {
    const server = serverNamed(lock.getAttribute('data-lock'));
    const on = lock.getAttribute('data-on') === '1';
    if (!server || !confirm(t(on ? 'confirmLock' : 'confirmUnlock'))) return;
    if (!deviceListed() || !server.signFor) { show(explain({ reason: server.signFor ? 'signature-needed' : 'identity-unsure' })); return; }
    const body = { server: server.name, on };
    const signature = await signHeader({ method: 'POST', path: '/control-panel/lock', body, relay: server.signFor }, state.device);
    show(explain(await api('/api/lock', { ...body, signature })));
    setTimeout(() => refresh().then(render), 4000);
  }
});

document.addEventListener('change', async (event) => {
  if (await updatesChange(event)) return;
  if (telegramChange(event)) return;
  const view = event.target.closest('select[data-view]');
  if (view) {
    const key = view.getAttribute('data-view');
    setView(key, view.value);
    if (['metrics:range', 'overview:refresh', 'overview:focus'].includes(key)) await loadMetrics();
    if (key === 'overview:refresh') restartLive();
    render();
    return;
  }
  const check = event.target.closest('[data-view-check]');
  if (check) { setView(check.getAttribute('data-view-check'), check.checked); render(); return; }
  const box = event.target.closest('[data-password]');
  if (box) {
    await api('/api/password', { server: box.getAttribute('data-password'), password: box.value });
    box.value = '';
    await refresh();
    render();
    return;
  }
  if (event.target.id === 'filterCluster') {
    state.filter.cluster = event.target.value;
    state.filter.hidden.clear();
    await reload();
    return;
  }
  const only = event.target.closest('[data-filter-server]');
  if (only) {
    const name = only.getAttribute('data-filter-server');
    if (only.checked) state.filter.hidden.delete(name); else state.filter.hidden.add(name);
    await reload();
  }
});

/* The admin's own notes on a partner: kept on this panel, never sent to a server. */
function partnerDialog(id) {
  const note = state.cache.partners?.notes?.[String(id).slice(0, 16)] || {};
  openDialog(`<h2>${esc(t('partnerNotes'))}</h2><p class="mut mono">${esc(String(id).slice(0, 16))}</p><div class="form-grid" data-operator="${esc(id)}">
    <label><span>${esc(t('label'))}</span><input id="pnLabel" maxlength="60" value="${esc(note.label || '')}"></label>
    <label><span>${esc(t('contact'))}</span><input id="pnContact" maxlength="120" value="${esc(note.contact || '')}"></label>
    <label class="wide"><span>${esc(t('tags'))}</span><input id="pnTags" maxlength="120" value="${esc(note.tags || '')}"></label>
    <label class="wide"><span>${esc(t('notes'))}</span><textarea id="pnNotes" rows="4" maxlength="1000">${esc(note.notes || '')}</textarea></label>
    <div class="wide row"><button id="partnerSave" class="acc">${esc(t('save'))}</button><button id="partnerForget" class="bad">${esc(t('forgetNotes'))}</button></div></div><p class="mut small">${esc(t('partnerNotesHint'))}</p>`);
}

document.addEventListener('input', (event) => {
  if (event.target.id === 'sharePassword') { strength(); return; }
  const box = event.target.closest?.('[data-search]');
  if (!box) return;
  setView(`search:${box.getAttribute('data-search')}`, box.value);
  applySearch($('sections'));
});
/* A group folded or opened stays so, in this browser. */
document.addEventListener('toggle', (event) => {
  const group = event.target;
  if (group?.matches?.('details[data-grp]')) setFolded(group.getAttribute('data-grp'), !group.open);
}, true);
wireCharts(document.body);

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const answer = await api('/api/login', { username: $('loginUser').value.trim(), password: $('loginPassword').value, code: $('loginCode').value.trim() });
  $('loginPassword').value = '';
  $('loginCode').value = '';
  if (answer.ok) return showApp();
  $('loginError').textContent = t(answer.reason === 'locked' ? 'loginLocked' : 'loginFailed');
});
$('logoutButton').addEventListener('click', async () => { await api('/api/logout', {}); showLogin(''); });
$('trustButton').addEventListener('click', async () => {
  const answer = await api('/api/trust', { operatorId: $('operatorId').value.trim() });
  show(answer.ok ? t('ok') : t('trustRefused'));
  if (answer.ok) $('operatorId').value = '';
  await refresh();
  render();
});

wireGatewayDrag(document);
applyLang();
/* The version, at the foot of the login and of the app. */
api('/api/version', undefined, { poll: true }).then((answer) => {
  for (const id of ['appVersion', 'footVersion']) if ($(id)) $(id).textContent = answer.version || '';
});
setInterval(async () => {
  if (!state.data || document.hidden) return;
  const answer = await api('/api/chips', undefined, { poll: true });
  if (answer.httpStatus !== 200) return;
  const names = (list) => (list || []).map((server) => server.name).join(',');
  const changed = names(answer.servers) !== names(state.chips || state.data.servers);
  state.chips = answer.servers;
  renderChips(state.chips);
  /* A server came or went: the rest of the page follows. */
  if (changed && !state.busy) { await refresh({ poll: true }); renderFilter(); }
}, 4000);
api('/api/session', undefined, { poll: true }).then((answer) => (answer.httpStatus === 200 ? showApp() : showLogin('')));
setInterval(async () => {
  if (!state.data || document.hidden || state.busy) return;
  await refresh({ poll: true });
  /* Typing into a form is not interrupted by a redraw, nor is anything
     half-filled lost to one; the admin's own sections are not redrawn by
     themselves at all. */
  if (state.busy || typing() || ['servers', 'family', 'account', 'telegram', 'build', 'help', 'about', 'keys', 'admins'].includes(state.tab) || !$('dialog').hidden) return;
  await reload({ poll: true });
}, 20000);
/* The live graphs: read again at the rate the overview asks for (1 s to
   1 min) while they are on screen, and only they are drawn again. */
let liveTimer = null;
async function liveTick() {
  try {
    const onTraffic = state.tab === 'traffic' && (state.view['traffic:tab'] || 'charts') === 'charts';
    if (state.data && !document.hidden && !state.busy && $('dialog').hidden && (state.tab === 'overview' || onTraffic)) {
      await loadMetrics(true);
      if (state.tab === 'overview' && $('liveCharts')) { $('liveCharts').innerHTML = liveCharts(); forgetCharts($('sections')); }
      else if (onTraffic && !typing()) render();
    }
  } finally {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(liveTick, refreshSeconds() * 1000);
  }
}
liveTimer = setTimeout(liveTick, 5000);
/* A new rate takes effect at once, not after the old one's wait. */
function restartLive() { clearTimeout(liveTimer); liveTimer = setTimeout(liveTick, refreshSeconds() * 1000); }
