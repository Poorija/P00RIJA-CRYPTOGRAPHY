/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Server updates, in the System section (tools/panel/updates.mjs does the
 * work). A release comes from a folder of the tree, an archive of it or a
 * package made before, or from GitHub; the panel builds a package the
 * operator key signs; it goes to the servers chosen, to be applied now, at a
 * set time, or when the fewest people are on, and travels on along the family.
 *
 * A folder is sent as a tar made here, of the parts of the tree a deploy and
 * the image builds use: never node_modules, never the whole folder. */

import { state, t, $, esc, api, hooks, fmtTime, fmtBytes } from './ui.js';
import { openDialog, watchJob } from './admin.js';

const card = (title, body, extra = '') => `<section class="card"><div class="card-head"><h2>${esc(title)}</h2><div class="row">${extra}</div></div>${body}</section>`;
const tag = (text, cls = '') => `<span class="tag ${cls}">${esc(text)}</span>`;
const value = (id) => String($(id)?.value || '').trim();
const ask = (key) => window.prompt(t(key)) || '';
const KEEP_DIRS = ['js', 'css', 'assets', 'fonts', 'vendor', 'scripts', 'config', 'tests'];
const KEEP_FILES = ['index.html', 'sw.js', 'manifest.webmanifest', 'monitor-client.html', 'package.json'];

/* ---- a tar, made in the page ----------------------------------------------- */

function tarHeader(name, size, mtime) {
  const block = new Uint8Array(512);
  const put = (text, at, width) => { const bytes = new TextEncoder().encode(text); block.set(bytes.subarray(0, width), at); };
  const octal = (number, width) => `${number.toString(8).padStart(width - 1, '0')}\0`;
  let prefix = '';
  let short = name;
  if (new TextEncoder().encode(name).length > 100) {
    const cut = name.lastIndexOf('/', 154);
    prefix = name.slice(0, cut);
    short = name.slice(cut + 1);
  }
  put(short, 0, 100);
  put(octal(0o644, 8), 100, 8); put(octal(0, 8), 108, 8); put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12); put(octal(Math.floor(mtime / 1000), 12), 136, 12);
  put('        ', 148, 8); put('0', 156, 1); put('ustar\u000000', 257, 8); put(prefix, 345, 155);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return block;
}

function treeTar(files) {
  const parts = [];
  let count = 0;
  for (const file of files) {
    const relative = String(file.webkitRelativePath || file.name).split('/').slice(1).join('/');
    const top = relative.split('/')[0];
    if (!relative || relative.split('/').includes('node_modules') || /(^|\/)\.DS_Store$/.test(relative)) continue;
    if (!KEEP_DIRS.includes(top) && !KEEP_FILES.includes(relative)) continue;
    parts.push(tarHeader(relative, file.size, file.lastModified || Date.now()), file);
    const pad = (512 - (file.size % 512)) % 512;
    if (pad) parts.push(new Uint8Array(pad));
    count += 1;
  }
  parts.push(new Uint8Array(1024));
  return { blob: new Blob(parts, { type: 'application/octet-stream' }), count };
}

async function upload(kind, name, blob) {
  const response = await fetch(`/api/updates/upload?kind=${kind}&name=${encodeURIComponent(name)}`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: blob,
  });
  return response.json().catch(() => ({ ok: false, reason: String(response.status) }));
}

/* ---- the section ------------------------------------------------------------ */

export async function loadUpdates() {
  const [info, servers] = await Promise.all([api('/api/updates'), api('/api/updates/servers')]);
  state.cache.updates = { ...(state.cache.updates || {}), info, servers: servers.servers || [] };
}

const whenText = (policy) => {
  if (!policy) return '—';
  if (policy.mode === 'now') return t('updNow');
  if (policy.mode === 'schedule') return `${t('updAt')} ${fmtTime(policy.at)}`;
  return t('updWatch');
};
const phaseText = (phase) => t(`updPhase_${phase || 'idle'}`);

export function renderUpdates() {
  const cache = state.cache.updates || {};
  const info = cache.info || {};
  if (!info.ok) return '';
  const notes = [
    !info.canBuild ? `<p class="warn-text">${esc(t('updNoDocker'))}</p><pre>bash scripts/panel.sh update --builds yes</pre>` : '',
    !info.operatorKey ? `<p class="warn-text">${esc(t('updNoKey'))}</p>` : '',
  ].join('');
  const picked = cache.picked ? `<p class="mut">${esc(t('updPicked'))}: <strong>${esc(cache.picked.name)}</strong> (${esc(fmtBytes(cache.picked.size))})</p>` : '';
  const github = cache.github ? `<p class="mut">GitHub: <strong>${esc(cache.github.version)}</strong> <a href="${esc(cache.github.page)}" target="_blank" rel="noopener">${esc(t('updPage'))}</a></p>` : '';
  const source = `<p class="mut">${esc(t('updHelp'))}</p>${notes}
    <div class="row wrap">
      <label class="btn"><i class="fa-solid fa-folder-open"></i> ${esc(t('updFolder'))}<input id="updFolder" type="file" webkitdirectory directory multiple hidden></label>
      <label class="btn"><i class="fa-solid fa-file-zipper"></i> ${esc(t('updArchive'))}<input id="updArchive" type="file" accept=".tar,.gz,.tgz,.zip" hidden></label>
      <button id="updGithub"><i class="fa-brands fa-github"></i> ${esc(t('updGithub'))}</button>
    </div>${picked}${github}
    <div class="row wrap">
      <select id="updFrom">${cache.picked ? `<option value="upload">${esc(t('updFromUpload'))}</option>` : ''}${cache.github ? `<option value="github">${esc(t('updFromGithub'))}</option>` : ''}</select>
      <button id="updBuild" class="acc"${cache.picked || cache.github ? '' : ' disabled'}><i class="fa-solid fa-box"></i> ${esc(t('updBuild'))}</button>
    </div><div id="updState" class="mut"></div>`;
  const rows = (info.packages || []).map((entry) => `<tr><td class="mono"><strong>${esc(entry.version)}</strong></td><td>${esc(fmtBytes(entry.size))}</td><td>${esc(fmtTime(entry.createdAt))}</td><td>${esc(t(`updSource_${entry.source}`) || entry.source)}</td>
      <td class="actions"><a class="btn" href="/api/updates/package?version=${encodeURIComponent(entry.version)}" download><i class="fa-solid fa-download"></i> ${esc(t('updDownload'))}</a>
      <button class="acc" data-upd-send="${esc(entry.version)}"><i class="fa-solid fa-paper-plane"></i> ${esc(t('updSend'))}</button></td></tr>`).join('');
  const packages = `<div class="scroll"><table><thead><tr><th>${esc(t('version'))}</th><th>${esc(t('updSize'))}</th><th>${esc(t('updMade'))}</th><th>${esc(t('updSource'))}</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="mut">${esc(t('updNoPackages'))}</td></tr>`}</tbody></table></div>`;
  const servers = (cache.servers || []).map((row) => {
    const status = row.status || {};
    const last = status.lastResult ? (status.lastResult.ok ? tag(`${t('updDone')} ${status.lastResult.version}`, 'good') : tag(`${t('updFailed')} ${status.lastResult.version || ''}`, 'bad')) : '';
    const updater = row.updater ? tag(t('updHasUpdater'), 'good') : row.reason === 'unreachable' ? tag(t('unreachable'), 'bad') : tag(t('updNoUpdater'), 'warn');
    const actions = row.updater && status.staged ? `<button data-upd-when="${esc(row.name)}" data-upd-staged="${esc(status.staged.version)}">${esc(t('updWhen'))}</button><button class="bad" data-upd-cancel="${esc(row.name)}">${esc(t('updCancel'))}</button>` : '';
    return `<tr><td><strong>${esc(row.name)}</strong></td><td class="mono">${esc(status.current || '—')}</td><td>${updater}</td><td class="mono">${esc(status.staged?.version || '—')}</td>
      <td>${esc(row.updater ? phaseText(status.phase) : '—')}</td><td>${esc(status.staged ? whenText(status.policy) : '—')}</td><td>${esc(row.updater ? String(status.online ?? '—') : '—')}</td><td>${last}</td><td class="actions">${actions}</td></tr>`;
  }).join('');
  const table = `<div class="scroll"><table><thead><tr>${['server', 'version', 'updUpdater', 'updStaged', 'updPhase', 'updWhenCol', 'updOnline', 'updLast', ''].map((key) => `<th>${key ? esc(t(key)) : ''}</th>`).join('')}</tr></thead><tbody>${servers}</tbody></table></div>
    <p class="mut">${esc(t('updChainHelp'))}</p>`;
  return card(t('updTitle'), `${source}<h3>${esc(t('updPackages'))}</h3>${packages}<h3>${esc(t('updServers'))}</h3>${table}`);
}

function whenFields(prefix) {
  return `<label class="wide"><span>${esc(t('updWhen'))}</span><select id="${prefix}Mode">
      <option value="watch" selected>${esc(t('updWatch'))}</option><option value="schedule">${esc(t('updSchedule'))}</option><option value="now">${esc(t('updNow'))}</option></select></label>
    <label id="${prefix}AtRow" hidden><span>${esc(t('updAt'))}</span><input id="${prefix}At" type="datetime-local"></label>`;
}
const whenValue = (prefix) => {
  const mode = value(`${prefix}Mode`) || 'watch';
  const at = value(`${prefix}At`);
  return mode === 'schedule' ? { mode, at: at ? new Date(at).toISOString() : '' } : { mode };
};
const codeField = (id) => `<label><span>${esc(t('code'))}</span><input id="${id}" class="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="${esc(t('codePh'))}"></label>`;

export async function updatesChange(event) {
  const target = event.target;
  if (target.id === 'updFolder' || target.id === 'updArchive') {
    const files = [...(target.files || [])];
    if (!files.length) return true;
    $('updState').textContent = t('updUploading');
    let answer;
    if (target.id === 'updFolder') {
      const { blob, count } = treeTar(files);
      if (!count) { $('updState').textContent = t('updEmptyFolder'); return true; }
      answer = await upload('folder', `${files[0].webkitRelativePath.split('/')[0] || 'tree'}.tar`, blob);
      if (answer.ok) state.cache.updates.picked = { id: answer.id, name: `${files[0].webkitRelativePath.split('/')[0]} (${count} ${t('updFiles')})`, size: answer.size };
    } else {
      answer = await upload('archive', files[0].name, files[0]);
      if (answer.ok) state.cache.updates.picked = { id: answer.id, name: files[0].name, size: answer.size };
    }
    if (!answer.ok) { $('updState').textContent = `${t('updUploadFailed')}: ${answer.reason || ''}`; return true; }
    hooks.render();
    return true;
  }
  if (/^(upd|updW)Mode$/.test(target.id)) {
    const prefix = target.id.replace(/Mode$/, '');
    if ($(`${prefix}AtRow`)) $(`${prefix}AtRow`).hidden = target.value !== 'schedule';
    return true;
  }
  return false;
}

export async function updatesClick(target) {
  const attr = (name) => target.closest(`[${name}]`)?.getAttribute(name);
  if (target.closest('#updGithub')) {
    $('updState').textContent = t('updChecking');
    const answer = await api('/api/updates/github', {});
    if (!answer.ok) { $('updState').textContent = `${t('updGithubFailed')}: ${answer.detail || answer.reason || ''}`; return true; }
    state.cache.updates.github = answer;
    hooks.render();
    return true;
  }
  if (target.closest('#updBuild')) {
    const from = value('updFrom') || 'upload';
    const code = ask('codePrompt');
    if (!code) return true;
    const body = from === 'github' ? { github: true, code } : { upload: state.cache.updates.picked?.id, code };
    const answer = await api('/api/updates/build', body);
    if (!answer.ok) { $('updState').textContent = answer.reason || t('jobFailed'); return true; }
    await watchJob(answer.job, t('updBuild'));
    await loadUpdates();
    hooks.render();
    return true;
  }
  if (attr('data-upd-send')) {
    const version = attr('data-upd-send');
    const servers = (state.cache.updates?.servers || []).map((row) => `<label class="check"><input type="checkbox" data-upd-target="${esc(row.name)}" ${row.reason === 'unreachable' ? '' : 'checked'}> ${esc(row.name)} ${row.updater ? '' : `<span class="mut">(${esc(t('updNoUpdaterShort'))})</span>`}</label>`).join('');
    openDialog(`<h2>${esc(t('updSend'))} ${esc(version)}</h2><p class="mut">${esc(t('updSendHelp'))}</p>
      <div class="checks">${servers}</div><div class="form-grid">${whenFields('upd')}${codeField('updCode')}
      <div class="wide row"><button id="updSendRun" class="acc" data-version="${esc(version)}">${esc(t('updSend'))}</button></div></div><div id="updSendError" class="bad-text"></div>`);
    return true;
  }
  if (target.closest('#updSendRun')) {
    const version = target.closest('#updSendRun').getAttribute('data-version');
    const chosen = [...document.querySelectorAll('[data-upd-target]')].filter((box) => box.checked).map((box) => box.getAttribute('data-upd-target'));
    const policy = whenValue('upd');
    if (!chosen.length) { $('updSendError').textContent = t('updNoneChosen'); return true; }
    if (policy.mode === 'schedule' && !policy.at) { $('updSendError').textContent = t('updNoTime'); return true; }
    const answer = await api('/api/updates/send', { version, servers: chosen, policy, code: value('updCode') });
    if (!answer.ok) { $('updSendError').textContent = answer.reason || t('jobFailed'); return true; }
    await watchJob(answer.job, `${t('updSend')} ${version}`);
    await loadUpdates();
    hooks.render();
    return true;
  }
  if (attr('data-upd-when')) {
    const name = attr('data-upd-when');
    /* The version is chosen from this panel's own packages; what the server
       reports holding is shown, and only preselects one of them. */
    const staged = target.closest('[data-upd-when]').getAttribute('data-upd-staged') || '';
    const versions = (state.cache.updates?.info?.packages || []).map((entry) => entry.version);
    openDialog(`<h2>${esc(t('updWhen'))} — ${esc(name)}</h2><p class="mut">${esc(t('updStaged'))}: <span class="mono">${esc(staged)}</span></p><div class="form-grid">
      <label><span>${esc(t('version'))}</span><select id="updWVersion">${versions.map((version) => `<option value="${esc(version)}"${version === staged ? ' selected' : ''}>${esc(version)}</option>`).join('')}</select></label>
      ${whenFields('updW')}${codeField('updWCode')}
      <div class="wide row"><button id="updWhenRun" class="acc" data-server="${esc(name)}">${esc(t('save'))}</button></div></div><div id="updWhenError" class="bad-text"></div>`);
    return true;
  }
  if (target.closest('#updWhenRun')) {
    const name = target.closest('#updWhenRun').getAttribute('data-server');
    const policy = whenValue('updW');
    if (policy.mode === 'schedule' && !policy.at) { $('updWhenError').textContent = t('updNoTime'); return true; }
    const version = value('updWVersion');
    const answer = await api('/api/updates/policy', { servers: [name], version, policy, code: value('updWCode') });
    if (!answer.ok || answer.results?.some((entry) => !entry.ok)) { $('updWhenError').textContent = answer.reason || answer.results?.map((entry) => entry.reason).join(' ') || t('jobFailed'); return true; }
    $('dialog').hidden = true;
    await loadUpdates();
    hooks.render();
    return true;
  }
  if (attr('data-upd-cancel')) {
    const name = attr('data-upd-cancel');
    if (!window.confirm(`${t('updCancelConfirm')} (${name})`)) return true;
    const code = ask('codePrompt');
    if (!code) return true;
    await api('/api/updates/cancel', { servers: [name], code });
    await loadUpdates();
    hooks.render();
    return true;
  }
  return false;
}
