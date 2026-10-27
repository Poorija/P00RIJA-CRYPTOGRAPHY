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
  state, hooks, t, $, esc, num, pct, api, serverNamed, deviceListed, show, explain, clusterOf, byCluster, allServers, shownServers,
} from './ui.js';
import { SECTIONS, runRow, runGroup, runPicked, runForm, openMailbox, showLogs, exportCsv } from './sections.js';
import { network, networkClick, wireGatewayDrag } from './graph.js';

/* ---- the overview and the key --------------------------------------------- */

function serverCard(server) {
  const status = !server.reachable ? `<span class="tag bad">${esc(t('unreachable'))}</span>`
    : `${server.locked ? `<span class="tag good">${esc(t('locked'))}</span>` : `<span class="tag">${esc(t('unlocked'))}</span>`}${server.passwordOk ? '' : ` <span class="tag warn">${esc(t('passwordNeeded'))}</span>`}`;
  /* /healthz gives the processor as a percent and memory in MB: the
     container's use against its limit when it has one, the process's
     otherwise. */
  const memory = server.containerMem ? `${num(server.containerMem.usageMb)}${server.containerMem.limitMb ? ` / ${num(server.containerMem.limitMb)}` : ''} MB`
    : server.memory?.rss ? `${num(server.memory.rss)} MB` : '—';
  const disk = server.storage ? pct(num(server.storage.total) - num(server.storage.free), num(server.storage.total)) : '—';
  const links = server.links ? `${num(server.links.up)}/${num(server.links.allowed)}` : '—';
  const family = server.family ? `${esc(server.family.name)} #${num(server.family.serial)}` : '—';
  const load = Array.isArray(server.cpu) ? `${Math.round(num(server.cpu[0]))}%` : '—';
  return `<div class="card" data-server-card="${esc(server.name)}"><div class="row spread"><h3>${esc(server.name)}</h3>${status}</div>
    <div class="kv">
      <span>${esc(t('version'))}</span><span class="mono">${esc(server.version || '—')}</span>
      <span>${esc(t('cpu'))}</span><span class="mono">${esc(load)}</span>
      <span>${esc(t('memory'))}</span><span>${esc(memory)}</span>
      <span>${esc(t('disk'))}</span><span>${esc(disk)}</span>
      <span>${esc(t('online'))}</span><span>${num(server.peers)}</span>
      <span>${esc(t('links'))}</span><span>${esc(links)}</span>
      <span>${esc(t('family'))}</span><span>${family}</span>
      <span>${esc(t('gateway'))}</span><span>${server.gateway ? num(server.gateway) : '—'}</span>
    </div>
    <div class="row">
      <button data-lock="${esc(server.name)}" data-on="${server.locked ? '0' : '1'}"${server.locked ? '' : ' class="acc"'}>${esc(t(server.locked ? 'lockOff' : 'lockOn'))}</button>
      ${server.passwordOk || !server.reachable ? '' : `<input type="password" data-password="${esc(server.name)}" placeholder="${esc(t('passwordNeeded'))}">`}
    </div></div>`;
}

function renderOverview() {
  return byCluster(shownServers()).map(([cluster, servers]) => {
    const up = servers.filter((server) => server.reachable).length;
    const online = servers.reduce((total, server) => total + num(server.peers), 0);
    return `<section class="card"><div class="row spread"><strong>${esc(t('cluster'))}: ${esc(cluster)}</strong>
      <span class="mut">${esc(t('servers'))} ${up}/${servers.length} · ${esc(t('online'))} ${online}</span></div>
      <div class="cards">${servers.map(serverCard).join('')}</div></section>`;
  }).join('');
}

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

state.sections.push({ id: 'overview', title: 'overview', render: renderOverview }, network, ...SECTIONS, { id: 'keys', title: 'keys', render: renderKeys });

/* ---- the page ------------------------------------------------------------- */

function applyLang() {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'fa' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((node) => { node.textContent = t(node.getAttribute('data-t')); });
  document.querySelectorAll('[data-ph]').forEach((node) => { node.placeholder = t(node.getAttribute('data-ph')); });
  document.querySelectorAll('[data-lang-toggle]').forEach((node) => { node.textContent = state.lang === 'fa' ? 'EN' : 'فا'; });
}

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
  $('tabs').innerHTML = state.sections.map((section) => `<button data-tab="${esc(section.id)}" aria-selected="${section.id === state.tab}">${esc(t(section.title))}</button>`).join('');
  renderFilter();
  state.rows.clear();
  const section = current();
  const ready = !section.load || state.loaded.has(section.id);
  $('sections').innerHTML = ready ? section.render() : `<section class="card mut">${esc(t('loading'))}</section>`;
  if (ready) section.mount?.();
}
hooks.render = render;
state.loaded = new Set();

/* The section shown, read again; the page's own polling marks itself so it
   does not keep the session alive. */
async function reload({ poll = false } = {}) {
  const section = current();
  if (section.load) {
    await section.load(poll);
    state.loaded.add(section.id);
  }
  render();
}
hooks.reload = () => refresh().then(() => reload());

async function refresh({ poll = false } = {}) {
  const data = await api('/api/servers', undefined, { poll });
  if (data.httpStatus !== 200) return;
  state.data = data;
}

function showLogin(message) {
  state.data = null;
  $('appView').hidden = true;
  $('loginView').hidden = false;
  $('loginError').textContent = message || '';
}
hooks.loggedOut = () => showLogin(t('sessionEnded'));

async function showApp() {
  $('loginView').hidden = true;
  $('appView').hidden = false;
  try { state.device = await deviceKey(); } catch (_error) { state.device = null; }
  await refresh();
  render();
}

async function openTab(id) {
  state.tab = id;
  render();
  await reload();
}

document.addEventListener('click', async (event) => {
  const target = event.target;
  if (target.closest('[data-lang-toggle]')) {
    state.lang = state.lang === 'fa' ? 'en' : 'fa';
    try { localStorage.setItem('panel_lang', state.lang); } catch (_error) { /* a private window */ }
    applyLang();
    if (state.data) render();
    return;
  }
  const tab = target.closest('[data-tab]');
  if (tab) { await openTab(tab.getAttribute('data-tab')); return; }
  if (target.closest('#refreshButton')) { await refresh(); await reload(); return; }
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
api('/api/session', undefined, { poll: true }).then((answer) => (answer.httpStatus === 200 ? showApp() : showLogin('')));
setInterval(async () => {
  if (!state.data || document.hidden || state.busy) return;
  await refresh({ poll: true });
  /* Typing into a form is not interrupted by a redraw. */
  if (state.busy || document.activeElement?.closest?.('[data-form], [data-ram], [data-cpu], select[data-gw-id]')) return;
  await reload({ poll: true });
}, 20000);
