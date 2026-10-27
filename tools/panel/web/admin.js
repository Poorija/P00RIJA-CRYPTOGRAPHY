/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 * Licensed under the GNU Affero General Public License, version 3 only.
 *
 * The admin's own sections: servers (deploy.conf), the family list and the
 * operator key, cluster management, the account, this panel's system card
 * and its log. Every change here asks for a current authenticator code; a
 * change to the family list is signed by this browser's listed key.
 */
import { state, t, $, esc, api, show, explain, hooks, fmtTime } from './ui.js';
import { signHeader } from './sign.js';

const NAME_RULE = /^[a-z][a-z0-9]{0,11}$/;
const tagOf = (text, cls = '') => `<span class="tag ${cls}">${esc(text)}</span>`;
const card = (title, body, extra = '') => `<section class="card"><div class="card-head"><h2>${esc(title)}</h2><div class="row">${extra}</div></div>${body}</section>`;
const codeInput = (id) => `<input id="${id}" class="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="${esc(t('codePh'))}">`;
const value = (id) => String($(id)?.value || '').trim();
const reasonText = (answer) => {
  const reason = answer?.reason || '';
  if (reason === 'code-used') return t('codeUsed');
  if (reason === 'bad-code') return t('badCode');
  if (reason === 'locked') return t('loginLocked');
  if (reason === 'read-only') return t('readOnlyConfig');
  if (reason === 'bad-password') return t('badPassword');
  return explain(answer);
};
const refreshAll = async () => { await hooks.reload?.(); };

/* ---- a dialog, and a job's output in it ----------------------------------- */

export function openDialog(inner) { $('dialogBody').innerHTML = inner; $('dialog').hidden = false; }
export function closeDialog() { $('dialog').hidden = true; $('dialogBody').innerHTML = ''; state.watching = ''; }

export async function watchJob(id, title) {
  openDialog(`<h2>${esc(title)}</h2><pre id="jobLines" class="job"></pre><div id="jobState" class="mut"></div>`);
  state.watching = id;
  while (state.watching === id) {
    const job = await api(`/api/jobs?id=${encodeURIComponent(id)}`, undefined, { poll: true });
    if (!$('jobLines')) return;
    $('jobLines').textContent = (job.lines || []).join('\n');
    $('jobLines').scrollTop = $('jobLines').scrollHeight;
    if (job.done || job.httpStatus !== 200) { $('jobState').textContent = job.code === 0 ? t('jobDone') : `${t('jobFailed')} (${job.code ?? '—'})`; break; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/* ---- servers (deploy.conf) ------------------------------------------------ */

function serverForm(server = { name: '', fields: {} }) {
  const config = state.cache.serversConfig || {};
  const f = server.fields || {};
  const keys = config.keys || [];
  const others = (config.servers || []).filter((other) => other.name !== server.name);
  const opt = (val, label, chosen) => `<option value="${esc(val)}"${val === chosen ? ' selected' : ''}>${esc(label)}</option>`;
  const keyValue = f.SSH_KEY || (keys[0] ? `~/.ssh/${keys[0]}` : '');
  return `<div id="serverForm" class="form-grid" data-editing="${esc(server.name)}">
    <label><span>${esc(t('serverName'))}</span><input id="serverName" value="${esc(server.name)}"${server.name ? ' readonly' : ''} placeholder="ir5"></label>
    <label><span>${esc(t('sshHost'))}</span><input id="serverHost" value="${esc(f.SSH_HOST || '')}" placeholder="203.0.113.10"></label>
    <label><span>${esc(t('sshUser'))}</span><input id="serverUser" value="${esc(f.SSH_USER || '')}" placeholder="root"></label>
    <label><span>${esc(t('sshPort'))}</span><input id="serverPort" value="${esc(f.SSH_PORT || '22')}" inputmode="numeric"></label>
    <label><span>${esc(t('sshKey'))}</span><select id="serverKey">${keys.map((key) => opt(`~/.ssh/${key}`, key, keyValue)).join('')}${keyValue && !keys.some((key) => `~/.ssh/${key}` === keyValue) ? opt(keyValue, keyValue, keyValue) : ''}</select></label>
    <label><span>${esc(t('jump'))}</span><select id="serverJump">${opt('', t('none'), f.JUMP || '')}${others.map((other) => opt(other.name, other.name, f.JUMP || '')).join('')}</select></label>
    <label class="wide"><span>${esc(t('publicUrl'))}</span><input id="serverUrl" value="${esc(f.PUBLIC_URL || '')}" placeholder="https://chat.example.com:8585"></label>
    <label><span>${esc(t('region'))}</span><select id="serverRegion">${opt('', '—', f.REGION || '')}${opt('inside-iran', t('regionInside'), f.REGION || '')}${opt('outside-iran', t('regionOutside'), f.REGION || '')}</select></label>
    <label><span>${esc(t('cluster'))}</span><input id="serverCluster" value="${esc(f.CLUSTER || '')}"></label>
    <label><span>${esc(t('gateway'))}</span><input id="serverGateway" value="${esc(f.GATEWAY || '')}" inputmode="numeric" placeholder="0"></label>
    <label class="wide"><span>${esc(t('insideAddresses'))}</span><input id="serverInside" value="${esc(f.INSIDE || '')}" placeholder="https://10.0.0.5:8585"></label>
    <div class="wide row">
      <button id="testServer">${esc(t('testConnection'))}</button>
      ${codeInput('serverCode')}
      <button id="saveServer" class="acc">${esc(t('save'))}</button>
      <button id="cancelServer" class="link">${esc(t('cancel'))}</button>
    </div>
    <div id="serverTestResult" class="wide mut"></div>
    <div id="serverFormError" class="wide bad-text" role="alert"></div>
  </div>`;
}

const formFields = () => {
  const fields = {
    SSH_HOST: value('serverHost'), SSH_USER: value('serverUser'), SSH_PORT: value('serverPort'), SSH_KEY: value('serverKey'),
    JUMP: value('serverJump'), PUBLIC_URL: value('serverUrl'), REGION: value('serverRegion'), CLUSTER: value('serverCluster'),
    GATEWAY: value('serverGateway'), INSIDE: value('serverInside'),
  };
  for (const key of Object.keys(fields)) if (!fields[key]) delete fields[key];
  return fields;
};

function stateOf(name) {
  const live = (state.data?.servers || []).find((server) => server.name === name);
  if (!live) return tagOf(t('notConnected'), 'warn');
  if (live.reachable) return tagOf(t('reachable'), 'good');
  return `<span class="tag bad" title="${esc(live.problemDetail || '')}">${esc(t(live.problem || 'unreachable'))}</span>`;
}

export const servers = {
  id: 'servers', title: 'servers', icon: 'fa-server',
  async load() { state.cache.serversConfig = await api('/api/servers-config'); },
  render() {
    const config = state.cache.serversConfig || {};
    const rows = (config.servers || []).map(({ name, fields }) => `<tr data-server-row="${esc(name)}">
      <td><strong>${esc(name)}</strong></td>
      <td class="mono">${esc(fields.SSH_USER || '')}@${esc(fields.SSH_HOST || '')}${fields.SSH_PORT && fields.SSH_PORT !== '22' ? `:${esc(fields.SSH_PORT)}` : ''}</td>
      <td class="mono">${esc(String(fields.SSH_KEY || '').split('/').pop())}</td>
      <td>${esc(fields.JUMP || '—')}</td>
      <td class="mono">${esc(fields.PUBLIC_URL || '—')}</td>
      <td>${esc(fields.CLUSTER || '—')}</td>
      <td>${stateOf(name)}</td>
      <td class="actions"><button data-srv-edit="${esc(name)}">${esc(t('edit'))}</button><button data-srv-test="${esc(name)}">${esc(t('test'))}</button>
        <button data-srv-install="${esc(name)}">${esc(t('install'))}</button><button data-srv-deploy="${esc(name)}">deploy.sh</button>
        <button class="bad" data-srv-remove="${esc(name)}">${esc(t('remove'))}</button></td></tr>`).join('');
    const head = ['serverName', 'ssh', 'sshKey', 'jump', 'publicUrl', 'cluster', 'state', ''].map((key) => `<th>${key ? esc(t(key)) : ''}</th>`).join('');
    const note = config.writable ? '' : `<p class="warn-text">${esc(t('readOnlyConfig'))}</p>`;
    return card(t('servers'), `${note}<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="8" class="mut">${esc(t('noServers'))}</td></tr>`}</tbody></table></div>
      <div id="serverFormHost"></div><p class="mut">${esc(t('addServerHelp'))}</p>`,
    config.writable ? `<button id="addServer" class="acc"><i class="fa-solid fa-plus"></i> ${esc(t('addServer'))}</button>` : '');
  },
};

async function testFields(fields, where) {
  where.textContent = t('testing');
  const answer = await api('/api/servers/test', { fields });
  if (!answer.ok) { where.textContent = `${t(answer.problem || answer.reason || 'failed')}${answer.detail ? ` — ${answer.detail}` : ''}`; return; }
  where.textContent = `${t('answered')} · Docker ${answer.docker || t('notInstalled')} · ${answer.installed ? `${t('stackInstalled')} ${answer.version || ''}` : t('stackMissing')}`;
}

/* ---- the family list, the operator key ------------------------------------ */

async function signedPost(body) {
  if (!state.device) return { ok: false, reason: 'no-device' };
  const relay = state.cache.family?.operator?.id;
  const signature = await signHeader({ method: 'POST', path: '/control-panel/directory', body, relay }, state.device);
  return api('/api/directory', { ...body, signature });
}

export const family = {
  id: 'family', title: 'family', icon: 'fa-file-signature',
  async load() { state.cache.family = await api('/api/family'); state.cache.serversConfig = state.cache.serversConfig || await api('/api/servers-config'); },
  render() {
    const fam = state.cache.family || {};
    const op = fam.operator || {};
    const listedHere = state.device && (fam.admins || []).some((admin) => admin.id === state.device.keyId);
    const why = !fam.canEdit ? `<p class="warn-text">${esc(t(fam.reason === 'no-operator-key' ? 'noOperatorKeyHere' : fam.reason === 'read-only' ? 'readOnlyConfig' : 'noDraftHere'))}</p>` : '';
    const opCard = card(t('operatorKey'), op.present
      ? `<div class="kv"><span>${esc(t('name'))}</span><span>${esc(op.name)}</span><span>${esc(t('keyId'))}</span><span class="mono">${esc(op.id)}</span><span>${esc(t('familyListSerial'))}</span><span>${esc(fam.serial)} · ${esc(fmtTime(fam.signedAt))}</span></div>
         <div class="row">${codeInput('opCode')}<input id="opPassword" type="password" autocomplete="current-password" placeholder="${esc(t('password'))}">
         <button id="opExport">${esc(t('exportKey'))}</button><button id="opRotate" class="warn">${esc(t('rotateKey'))}</button><button id="opRemove" class="bad">${esc(t('removeKey'))}</button></div>
         <p class="mut">${esc(t('operatorKeyHelp'))}</p>`
      : `<p>${esc(t('noOperatorKeyHere'))}</p><div class="row"><input id="opName" placeholder="${esc(t('familyName'))}">${codeInput('opCode')}<button id="opCreate" class="acc">${esc(t('createKey'))}</button></div>
         <div class="row"><input id="opFile" type="file" accept="application/json,.json"><button id="opImport">${esc(t('importKey'))}</button></div>`);
    const relays = (fam.relays || []).map((relay) => `<tr><td><strong>${esc(relay.name)}</strong></td><td class="mono">${esc(relay.id.slice(0, 16))}…</td><td class="mono">${esc(relay.origins.join(' '))}</td>
      <td>${esc(relay.region || '—')}</td><td>${esc(relay.cluster || '—')}</td><td>${relay.gateway || '—'}</td><td class="mono">${esc(relay.inside.join(' ') || '—')}</td>
      <td>${fam.canEdit ? `<button class="bad" data-fam-remove="${esc(relay.name)}">${esc(t('remove'))}</button>` : ''}</td></tr>`).join('');
    const notListed = (state.cache.serversConfig?.servers || []).filter((server) => !(fam.relays || []).some((relay) => relay.name === server.name));
    const addable = fam.canEdit && notListed.length ? `<div class="row"><span class="mut">${esc(t('notInFamily'))}</span>${notListed.map((server) => `<button data-fam-add="${esc(server.name)}">+ ${esc(server.name)}</button>`).join('')}</div>` : '';
    const listCard = card(t('familyList'), `<div class="scroll"><table><thead><tr>${['serverName', 'relayId', 'origins', 'region', 'cluster', 'gateway', 'insideAddresses', ''].map((key) => `<th>${key ? esc(t(key)) : ''}</th>`).join('')}</tr></thead><tbody>${relays}</tbody></table></div>${addable}
      <p class="mut">${esc(t('carried'))}: ${(fam.carried || []).map((entry) => `${esc(entry.server)} #${entry.serial || '—'}`).join(' · ')}</p>`);
    const admins = (fam.admins || []).map((admin) => `<li><span>${esc(admin.name)}</span> <span class="mono mut">${esc(admin.id.slice(0, 16))}…</span>${state.device?.keyId === admin.id ? ` ${tagOf(t('thisBrowser'), 'good')}` : ''}
      ${fam.canEdit ? `<button class="bad small-btn" data-admin-remove="${esc(admin.name)}">${esc(t('remove'))}</button>` : ''}</li>`).join('');
    const bootstrap = fam.canEdit && !(fam.admins || []).length && state.device
      ? `<div class="row"><span>${esc(t('firstAdminHelp'))}</span>${codeInput('bootCode')}<button id="bootAdmin" class="acc">${esc(t('listThisBrowser'))}</button></div>` : '';
    const adminCard = card(t('adminKeys'), `<ul class="plain">${admins || `<li class="mut">${esc(t('noAdmins'))}</li>`}</ul>${bootstrap}
      ${fam.canEdit && listedHere ? `<div class="row"><input id="adminName" placeholder="${esc(t('name'))}"><input id="adminKey" class="mono wide" placeholder="${esc(t('publicKeyPh'))}"><button id="adminAdd">${esc(t('addAdmin'))}</button></div>` : ''}
      ${!state.device ? `<p class="mut">${esc(t('makeKeyFirst'))}</p>` : ''}`);
    return why + opCard + listCard + adminCard;
  },
};

/* ---- clusters (inside the existing clusters section) ---------------------- */

export async function loadClusterAdmin() { state.cache.family = await api('/api/family'); }
export function renderClusterAdmin() {
  const fam = state.cache.family || {};
  if (!fam.ok) return '';
  const relays = fam.relays || [];
  const listed = state.device && (fam.admins || []).some((admin) => admin.id === state.device.keyId);
  const canChange = fam.canEdit && listed;
  const clusters = (fam.clusters || []).map((cluster) => `<div class="cluster" data-cluster-card="${esc(cluster.name)}">
    <div class="row spread"><strong><i class="fa-solid fa-layer-group"></i> ${esc(cluster.name)}</strong>
      <span>${cluster.independent ? tagOf(t('independent'), 'good') : tagOf(t('notIndependent'), 'warn')}${cluster.gateways.length ? ` ${tagOf(`${t('gateway')}: ${cluster.gateways.join(', ')}`)}` : ''}</span></div>
    <div class="row">${relays.map((relay) => `<label class="chip"><input type="checkbox" data-member-of="${esc(cluster.name)}" value="${esc(relay.name)}"${relay.cluster === cluster.name ? ' checked' : ''}${canChange ? '' : ' disabled'}>${esc(relay.name)}</label>`).join('')}</div>
    ${canChange ? `<div class="row"><button data-cluster-save="${esc(cluster.name)}" class="acc">${esc(t('saveMembers'))}</button><button data-cluster-rename="${esc(cluster.name)}">${esc(t('rename'))}</button><button class="bad" data-cluster-delete="${esc(cluster.name)}">${esc(t('delete'))}</button></div>` : ''}
    <div class="grid">${relays.filter((relay) => relay.cluster === cluster.name).map((relay) => `<div class="row"><span class="mut">${esc(relay.name)} · ${esc(t('insideAddresses'))}</span>
      <input class="mono wide" data-inside-of="${esc(relay.name)}" value="${esc(relay.inside.join(', '))}"${canChange ? '' : ' disabled'} placeholder="https://10.0.0.5:8585">${canChange ? `<button data-inside-save="${esc(relay.name)}">${esc(t('save'))}</button>` : ''}</div>`).join('')}</div>
  </div>`).join('');
  const create = canChange ? `<div class="cluster new"><strong>${esc(t('newCluster'))}</strong><div class="row"><input id="clusterName" placeholder="${esc(t('clusterNamePh'))}">
    ${relays.map((relay) => `<label class="chip"><input type="checkbox" data-new-member value="${esc(relay.name)}">${esc(relay.name)}</label>`).join('')}<button id="clusterCreate" class="acc">${esc(t('create'))}</button></div></div>` : '';
  const why = !fam.canEdit ? t(fam.reason === 'no-operator-key' ? 'noOperatorKeyHere' : 'readOnlyConfig') : !listed ? t('signNeeded') : '';
  return card(t('manageClusters'), `${why ? `<p class="warn-text">${esc(why)}</p>` : ''}<div class="clusters">${clusters || `<p class="mut">${esc(t('noClusters'))}</p>`}${create}</div>`);
}

/* ---- the account ---------------------------------------------------------- */

export const account = {
  id: 'account', title: 'account', icon: 'fa-user-shield',
  async load() { state.cache.account = await api('/api/account'); },
  render() {
    const acc = state.cache.account || {};
    const sessions = (acc.sessions || []).map((entry) => `<li>${esc(fmtTime(entry.since))} → ${esc(fmtTime(entry.lastSeen))}${entry.current ? ` ${tagOf(t('thisSession'), 'good')}` : ''}</li>`).join('');
    const history = (acc.history || []).slice(0, 30).map((entry) => `<tr><td>${esc(fmtTime(entry.at))}</td><td class="mono">${esc(entry.line)}</td></tr>`).join('');
    return card(t('changeOwnPassword'), `<div class="form-grid">
        <label><span>${esc(t('currentPassword'))}</span><input id="pwCurrent" type="password" autocomplete="current-password"></label>
        <label><span>${esc(t('newPassword'))}</span><input id="pwNext" type="password" autocomplete="new-password"></label>
        <label><span>${esc(t('newPassword2'))}</span><input id="pwNext2" type="password" autocomplete="new-password"></label>
        <label><span>${esc(t('code'))}</span>${codeInput('pwCode')}</label>
        <div class="wide row"><button id="pwSave" class="acc">${esc(t('changePassword'))}</button></div></div>`)
      + card(t('authenticator'), `<p class="mut">${esc(t('authenticatorHelp'))}</p><div class="row">
        <input id="totpPassword" type="password" autocomplete="current-password" placeholder="${esc(t('password'))}">${codeInput('totpCode')}
        <button id="totpBegin" class="acc">${esc(t('newAuthenticator'))}</button></div><div id="totpQr" class="totp"></div>`)
      + card(t('sessions'), `<ul class="plain">${sessions}</ul><div class="row">${codeInput('revokeCode')}<button id="revokeSessions" class="bad">${esc(t('signOutOthers'))}</button></div>`)
      + card(t('signIns'), `<div class="scroll"><table><tbody>${history || `<tr><td class="mut">—</td></tr>`}</tbody></table></div>`);
  },
};

/* ---- this panel (inside the system section) ------------------------------- */

export async function loadPanelSystem() { state.cache.panelSystem = await api('/api/system'); }
export function renderPanelSystem() {
  const sys = state.cache.panelSystem || {};
  if (!sys.ok) return '';
  const minutes = Math.round((sys.uptimeMs || 0) / 60000);
  return card(t('thisPanel'), `<div class="kv">
      <span>${esc(t('version'))}</span><span class="mono">v${esc(sys.version)}</span>
      <span>${esc(t('uptime'))}</span><span>${minutes} min</span>
      <span>${esc(t('configFolder'))}</span><span class="mono">${esc(sys.configDir)} ${sys.writable ? tagOf(t('writable'), 'good') : tagOf(t('readOnly'), 'warn')}</span>
      <span>${esc(t('operatorKey'))}</span><span>${sys.operatorKey ? tagOf(t('present'), 'good') : tagOf(t('absent'), 'warn')}</span>
      <span>${esc(t('servers'))}</span><span>${esc(sys.servers)}</span>
      <span>Node</span><span class="mono">${esc(sys.node)}</span></div>
    <p class="mut">${esc(t('maintainHelp'))}</p><pre>bash scripts/panel.sh update
bash scripts/panel.sh doctor
bash scripts/panel.sh backup</pre>`);
}

/* ---- the log -------------------------------------------------------------- */

export const log = {
  id: 'log', title: 'log', icon: 'fa-scroll',
  async load() { state.cache.log = await api('/api/log'); },
  render() { return card(t('log'), `<pre class="log">${esc((state.cache.log?.lines || []).join('\n'))}</pre>`); },
};

/* ---- clicks ---------------------------------------------------------------- */

const ask = (key) => window.prompt(t(key)) || '';

export async function adminClick(target) {
  const id = target.closest('button, [data-srv-edit], [data-srv-test]')?.id || '';
  const attr = (name) => target.closest(`[${name}]`)?.getAttribute(name);
  if (target.closest('#dialogClose')) { closeDialog(); return true; }
  /* servers */
  if (id === 'addServer') { $('serverFormHost').innerHTML = serverForm(); $('serverName').focus(); return true; }
  if (attr('data-srv-edit')) {
    const server = (state.cache.serversConfig?.servers || []).find((entry) => entry.name === attr('data-srv-edit'));
    if (server) $('serverFormHost').innerHTML = serverForm(server);
    return true;
  }
  if (id === 'cancelServer') { $('serverFormHost').innerHTML = ''; return true; }
  if (id === 'testServer') { await testFields(formFields(), $('serverTestResult')); return true; }
  if (id === 'saveServer') {
    const name = value('serverName');
    const fields = formFields();
    if (!NAME_RULE.test(name)) { $('serverFormError').textContent = t('badServerName'); return true; }
    if (!fields.SSH_HOST) { $('serverFormError').textContent = t('hostNeeded'); return true; }
    const answer = await api('/api/servers/save', { name, fields, code: value('serverCode') });
    if (!answer.ok) { $('serverFormError').textContent = reasonText(answer); return true; }
    show(`${name}: ${t('saved')}`);
    await servers.load();
    await refreshAll();
    return true;
  }
  if (attr('data-srv-test')) {
    const server = (state.cache.serversConfig?.servers || []).find((entry) => entry.name === attr('data-srv-test'));
    const where = { set textContent(text) { show(`${server.name}: ${text}`); } };
    await testFields(server.fields, where);
    return true;
  }
  if (attr('data-srv-remove')) {
    const name = attr('data-srv-remove');
    if (!window.confirm(`${t('confirmRemoveServer')} (${name})`)) return true;
    const answer = await api('/api/servers/remove', { name, code: ask('codePrompt') });
    show(answer.ok ? `${name}: ${t('removed')}` : reasonText(answer));
    await servers.load();
    await refreshAll();
    return true;
  }
  if (attr('data-srv-install')) {
    const name = attr('data-srv-install');
    openDialog(`<h2>${esc(t('installOn'))} ${esc(name)}</h2><p class="mut">${esc(t('installHelp'))}</p><div class="form-grid">
      <label><span>${esc(t('domain'))}</span><input id="installDomain" placeholder="chat.example.com"></label>
      <label><span>${esc(t('email'))}</span><input id="installEmail" placeholder="you@example.com"></label>
      <label><span>${esc(t('registry'))}</span><input id="installRegistry" placeholder="${esc(t('registryPh'))}"></label>
      <label><span>${esc(t('code'))}</span>${codeInput('installCode')}</label>
      <div class="wide row"><button id="installRun" class="acc" data-install-name="${esc(name)}">${esc(t('install'))}</button></div></div><div id="installError" class="bad-text"></div>`);
    return true;
  }
  if (id === 'installRun') {
    const name = target.closest('#installRun').getAttribute('data-install-name');
    const answer = await api('/api/servers/install', { name, domain: value('installDomain'), email: value('installEmail'), registry: value('installRegistry'), code: value('installCode') });
    if (!answer.ok) { $('installError').textContent = reasonText(answer); return true; }
    await watchJob(answer.job, `${t('installOn')} ${name}`);
    return true;
  }
  if (attr('data-srv-deploy')) {
    const answer = await api(`/api/servers/deploy-command?name=${encodeURIComponent(attr('data-srv-deploy'))}`);
    openDialog(`<h2>deploy.sh</h2><p class="mut">${esc(t('deployHelp'))}</p><pre>${esc(answer.command || '')}</pre>`);
    return true;
  }
  /* the family list */
  if (attr('data-fam-remove')) {
    const name = attr('data-fam-remove');
    if (!window.confirm(`${t('confirmRemoveEntry')} (${name})`)) return true;
    show(explain(await signedPost({ edits: [{ op: 'remove', name }] })));
    await family.load(); hooks.render();
    return true;
  }
  if (attr('data-fam-add')) {
    show(explain(await signedPost({ edits: [{ op: 'add', name: attr('data-fam-add') }] })));
    await family.load(); hooks.render();
    return true;
  }
  if (attr('data-admin-remove')) {
    if (!window.confirm(t('confirmRemoveAdmin'))) return true;
    show(explain(await signedPost({ edits: [{ op: 'admin-remove', name: attr('data-admin-remove') }] })));
    await family.load(); hooks.render();
    return true;
  }
  if (id === 'adminAdd') {
    show(explain(await signedPost({ edits: [{ op: 'admin-add', name: value('adminName'), key: value('adminKey') }] })));
    await family.load(); hooks.render();
    return true;
  }
  if (id === 'bootAdmin') {
    const answer = await api('/api/family/bootstrap-admin', { name: state.device.name || 'browser', key: state.device.spki, code: value('bootCode') });
    show(answer.ok ? t('ok') : reasonText(answer));
    await api('/api/family-refresh', {});
    await family.load(); await refreshAll();
    return true;
  }
  if (id === 'opCreate') {
    const answer = await api('/api/operator/create', { name: value('opName') || 'operator', code: value('opCode') });
    show(answer.ok ? `${t('ok')} ${answer.id}` : reasonText(answer));
    await family.load(); hooks.render();
    return true;
  }
  if (id === 'opImport') {
    const file = $('opFile')?.files?.[0];
    if (!file) return true;
    let parsed = null;
    try { parsed = JSON.parse(await file.text()); } catch (_error) { show(t('badKeyFile')); return true; }
    const answer = await api('/api/operator/import', { file: parsed, code: ask('codePrompt') });
    show(answer.ok ? t('ok') : reasonText(answer));
    await family.load(); hooks.render();
    return true;
  }
  if (id === 'opExport') {
    if (!window.confirm(t('confirmExport'))) return true;
    const response = await fetch('/api/operator/export', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: value('opPassword'), code: value('opCode') }) });
    if (!response.ok) { show(reasonText(await response.json().catch(() => ({})))); return true; }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '')?.[1] || 'operator-key.json';
    link.click();
    URL.revokeObjectURL(link.href);
    return true;
  }
  if (id === 'opRemove') {
    if (!window.confirm(t('confirmRemoveKey')) || !window.confirm(t('confirmRemoveKey2'))) return true;
    const answer = await api('/api/operator/remove', { code: value('opCode') });
    show(answer.ok ? t('ok') : reasonText(answer));
    await family.load(); hooks.render();
    return true;
  }
  if (id === 'opRotate') {
    if (!window.confirm(t('confirmRotate')) || !window.confirm(t('confirmRotate2'))) return true;
    const answer = await api('/api/operator/rotate', { password: value('opPassword'), code: value('opCode') });
    if (!answer.ok) { show(reasonText(answer)); return true; }
    await watchJob(answer.job, t('rotateKey'));
    return true;
  }
  /* clusters */
  if (id === 'clusterCreate') {
    const members = [...document.querySelectorAll('[data-new-member]:checked')].map((box) => box.value);
    show(explain(await signedPost({ change: { op: 'members', name: value('clusterName'), servers: members } })));
    await loadClusterAdmin(); await refreshAll();
    return true;
  }
  if (attr('data-cluster-save')) {
    const name = attr('data-cluster-save');
    const members = [...document.querySelectorAll(`[data-member-of="${CSS.escape(name)}"]:checked`)].map((box) => box.value);
    show(explain(await signedPost(members.length ? { change: { op: 'members', name, servers: members } } : { change: { op: 'delete', name } })));
    await loadClusterAdmin(); await refreshAll();
    return true;
  }
  if (attr('data-cluster-rename')) {
    const from = attr('data-cluster-rename');
    const to = (window.prompt(t('clusterNamePh'), from) || '').trim();
    if (!to || to === from) return true;
    show(explain(await signedPost({ change: { op: 'rename', from, to } })));
    await loadClusterAdmin(); await refreshAll();
    return true;
  }
  if (attr('data-cluster-delete')) {
    const name = attr('data-cluster-delete');
    if (!window.confirm(`${t('confirmDeleteCluster')} (${name})`)) return true;
    show(explain(await signedPost({ change: { op: 'delete', name } })));
    await loadClusterAdmin(); await refreshAll();
    return true;
  }
  if (attr('data-inside-save')) {
    const server = attr('data-inside-save');
    const inside = String(document.querySelector(`[data-inside-of="${CSS.escape(server)}"]`)?.value || '').split(/[,\s]+/).filter(Boolean);
    show(explain(await signedPost({ change: { op: 'inside', server, inside } })));
    await loadClusterAdmin(); await refreshAll();
    return true;
  }
  /* the account */
  if (id === 'pwSave') {
    if (value('pwNext') !== value('pwNext2')) { show(t('passwordsDiffer')); return true; }
    const answer = await api('/api/account/password', { current: $('pwCurrent').value, next: $('pwNext').value, code: value('pwCode') });
    show(answer.ok ? t('passwordChanged') : reasonText(answer));
    if (answer.ok) { await account.load(); hooks.render(); }
    return true;
  }
  if (id === 'totpBegin') {
    const answer = await api('/api/account/totp/begin', { password: $('totpPassword').value, code: value('totpCode') });
    if (!answer.ok) { show(reasonText(answer)); return true; }
    /* The QR is the panel's own SVG (tools/panel/qr.mjs), nothing from elsewhere. */
    $('totpQr').innerHTML = `<div class="qr">${answer.svg}</div><div class="grid"><p>${esc(t('scanNew'))}</p>
      <div class="mono">${esc(answer.secret.replace(/(.{4})/g, '$1 ').trim())}</div><div class="mono small">${esc(answer.uri)}</div>
      <div class="row">${codeInput('totpConfirmCode')}<button id="totpConfirm" class="acc">${esc(t('confirmAuthenticator'))}</button></div></div>`;
    return true;
  }
  if (id === 'totpConfirm') {
    const answer = await api('/api/account/totp/confirm', { code: value('totpConfirmCode') });
    show(answer.ok ? t('authenticatorReplaced') : reasonText(answer));
    if (answer.ok) $('totpQr').innerHTML = '';
    return true;
  }
  if (id === 'revokeSessions') {
    const answer = await api('/api/account/sessions/revoke', { code: value('revokeCode') });
    show(answer.ok ? `${t('signedOut')}: ${answer.count}` : reasonText(answer));
    await account.load(); hooks.render();
    return true;
  }
  return false;
}
