/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Build & package (tools/panel/builds.mjs does the work): the app's folder on
 * this computer is named, looked over, and built — in that same folder, into
 * dist/server/<version>/ — as the signed update package with the server
 * images and the archive, the Docker Hub images as an archive, and the push
 * to Docker Hub. What was built is listed by version, each file downloadable
 * and sendable to servers: the update package through the updates (a chain,
 * at the quietest hour), an image archive copied in and loaded. */
import { state, t, esc, api, hooks, fmtTime, fmtBytes, allServers, clusterOf, tag, card } from './ui.js';
import { openDialog, watchJob } from './admin.js';

const value = (id) => String(document.getElementById(id)?.value || '').trim();
const checked = (id) => Boolean(document.getElementById(id)?.checked);
const codeField = (id) => `<label><span>${esc(t('code'))}</span><input id="${id}" class="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="${esc(t('codePh'))}"></label>`;
const KIND_ICON = { update: 'fa-box', images: 'fa-cubes', dockerhub: 'fa-brands fa-docker', archive: 'fa-file-zipper', meta: 'fa-file-lines' };
const REASON = { 'folder-not-shared': 'buildFolderNotShared', 'no-folder': 'buildNoFolder' };

export const build = {
  id: 'build', title: 'build',
  async load() {
    const info = await api('/api/builds');
    state.cache.build = { ...(state.cache.build || {}), info };
    const folder = state.cache.build.folder || info.folder;
    if (folder && !state.cache.build.scan) {
      const scan = await api('/api/builds/scan', { folder });
      state.cache.build = { ...state.cache.build, folder, scan };
    }
  },
  render() {
    const cache = state.cache.build || {};
    const info = cache.info || {};
    const scan = cache.scan;
    const folder = cache.folder || info.folder || '';
    const notes = [
      !info.canBuild ? `<p class="warn-text">${esc(t('updNoDocker'))}</p><pre>bash scripts/panel.sh update --builds yes</pre>` : '',
      !(info.roots || []).length ? `<p class="warn-text">${esc(t('buildNoRoots'))}</p><pre>bash scripts/panel.sh update --builds yes --source /path/to/P00RIJA</pre>` : `<p class="mut">${esc(t('buildRoots'))}: <span class="mono">${(info.roots || []).map(esc).join(' · ')}</span></p>`,
    ].join('');
    const scanned = !scan ? '' : !scan.ok || !scan.tree
      ? `<p class="bad-text">${esc(t(REASON[scan.reason] || 'buildNotTree'))}${scan.problems?.length ? ` — ${esc(scan.problems.join(', '))}` : ''}</p>`
      : `<div class="kv">
          <span>${esc(t('version'))}</span><span class="mono"><strong>${esc(scan.version)}</strong> (${esc(scan.buildTag)})</span>
          <span>${esc(t('commit'))}</span><span class="mono">${esc(scan.commit || '—')} ${scan.branch ? `· ${esc(scan.branch)}` : ''}</span>
          <span>${esc(t('files'))}</span><span>${Object.entries(scan.files || {}).map(([dir, count]) => `${esc(dir)} ${count}`).join(' · ')}</span>
          <span>${esc(t('buildScript'))}</span><span>${scan.script ? tag(t('present'), 'good') : tag(t('absent'), 'bad')}</span>
          <span>${esc(t('buildOut'))}</span><span class="mono">${esc(`${folder}/dist/server/${scan.version}/`)}</span></div>
        ${scan.problems?.length ? `<p class="warn-text">${esc(scan.problems.join(', '))}</p>` : ''}`;
    const options = scan?.tree ? `<h3>${esc(t('buildWhat'))}</h3><div class="checks">
        <label class="check"><input type="checkbox" id="bSigned" checked> ${esc(t('buildSigned'))}</label>
        <label class="check"><input type="checkbox" id="bArchive"> ${esc(t('buildArchive'))}</label>
        <label class="check"><input type="checkbox" id="bImages"> ${esc(t('buildImages'))}</label>
        <label class="check"><input type="checkbox" id="bHub"> ${esc(t('buildHub'))}</label>
        <label class="check"><input type="checkbox" id="bPush"> ${esc(t('buildPush'))}</label></div>
      <p class="mut small">${esc(t('buildWhatHint'))}</p>
      <div class="row">${codeField('bCode').replace('<label>', '<label class="picker">')}<button class="acc" id="bRun"${info.canBuild ? '' : ' disabled'}><i class="fa-solid fa-hammer"></i> ${esc(t('buildRun'))}</button></div>` : '';
    const hub = `<h3><i class="fa-brands fa-docker"></i> Docker Hub</h3>${info.dockerHub ? `<p>${tag(`${t('loggedInAs')} ${info.dockerHub}`, 'good')} <button id="hubLogout" class="link">${esc(t('logout'))}</button></p>`
      : `<p class="mut">${esc(t('hubHint'))}</p><div class="row"><input id="hubUser" autocomplete="username" placeholder="${esc(t('username'))}"><input id="hubToken" type="password" autocomplete="off" placeholder="${esc(t('hubToken'))}"><button id="hubLogin">${esc(t('login'))}</button></div>`}`;
    const builds = (scan?.builds || []).map((entry) => `<details class="grp" data-grp="build:${esc(entry.version)}" open><summary><strong class="mono">${esc(entry.version)}</strong> <span class="mut">${esc(fmtTime(entry.createdAt))} ${entry.commit ? `· ${esc(entry.commit)}` : ''} ${entry.platform ? `· ${esc(entry.platform)}` : ''}</span> <span class="count">${entry.files.length}</span></summary>
      <div class="scroll"><table><thead><tr><th>${esc(t('file'))}</th><th>${esc(t('kind'))}</th><th>${esc(t('updSize'))}</th><th></th></tr></thead><tbody>${entry.files.map((file) => `<tr><td class="mono"><i class="fa-solid ${KIND_ICON[file.kind] || 'fa-file'}"></i> ${esc(file.name)}</td><td>${esc(t(`kind_${file.kind}`))}</td><td>${esc(fmtBytes(file.size))}</td>
        <td class="actions"><a class="btn" href="/api/builds/file?folder=${encodeURIComponent(folder)}&version=${encodeURIComponent(entry.version)}&name=${encodeURIComponent(file.name)}" download><i class="fa-solid fa-download"></i> ${esc(t('updDownload'))}</a>
        ${file.kind === 'update' ? `<button class="acc" data-build-keep="${esc(entry.version)}"><i class="fa-solid fa-paper-plane"></i> ${esc(t('buildToServers'))}</button>` : ''}
        ${file.kind === 'images' || file.kind === 'dockerhub' ? `<button data-build-ship="${esc(file.name)}" data-version="${esc(entry.version)}"><i class="fa-solid fa-truck-fast"></i> ${esc(t('buildShip'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div></details>`).join('');
    return card('build', `<p class="mut">${esc(t('buildHelp'))}</p>${notes}
        <div class="row"><input id="bFolder" class="mono wide" value="${esc(folder)}" placeholder="/Users/you/P00RIJA-Cryptography"><button id="bScan"><i class="fa-solid fa-magnifying-glass"></i> ${esc(t('buildScan'))}</button></div>
        ${scanned}${options}${hub}`)
      + card('buildMade', builds || `<p class="mut">${esc(t('buildNone'))}</p>`);
  },
};

export async function buildClick(target) {
  const attr = (name) => target.closest(`[${name}]`)?.getAttribute(name);
  if (target.closest('#bScan')) {
    const folder = value('bFolder');
    const scan = await api('/api/builds/scan', { folder });
    state.cache.build = { ...(state.cache.build || {}), folder, scan };
    hooks.render();
    return true;
  }
  if (target.closest('#bRun')) {
    const body = { folder: state.cache.build?.folder || value('bFolder'), signed: checked('bSigned'), archive: checked('bArchive'), images: checked('bImages'), dockerhub: checked('bHub'), push: checked('bPush'), code: value('bCode') };
    if (body.push && !window.confirm(t('confirmPush'))) return true;
    const answer = await api('/api/builds/run', body);
    if (!answer.ok) { window.alert(t(REASON[answer.reason] || answer.reason || 'failed')); return true; }
    await watchJob(answer.job, t('buildRun'));
    state.cache.build.scan = await api('/api/builds/scan', { folder: body.folder });
    hooks.render();
    return true;
  }
  if (target.closest('#hubLogin')) {
    const answer = await api('/api/builds/dockerhub-login', { username: value('hubUser'), token: document.getElementById('hubToken')?.value || '' });
    if (document.getElementById('hubToken')) document.getElementById('hubToken').value = '';
    if (!answer.ok) { window.alert(`${t('hubRefused')} ${answer.detail || ''}`); return true; }
    state.cache.build.info = await api('/api/builds');
    hooks.render();
    return true;
  }
  if (target.closest('#hubLogout')) {
    await api('/api/builds/dockerhub-logout', {});
    state.cache.build.info = await api('/api/builds');
    hooks.render();
    return true;
  }
  if (attr('data-build-keep')) {
    /* Into the panel's packages, then the updates' own send dialog. */
    const version = attr('data-build-keep');
    const code = window.prompt(t('codePrompt')) || '';
    if (!code) return true;
    const answer = await api('/api/builds/keep', { folder: state.cache.build?.folder, version, code });
    if (!answer.ok) { window.alert(t(answer.reason || 'failed')); return true; }
    await watchJob(answer.job, `${t('buildToServers')} ${version}`);
    state.view['ops:tab'] = 'updates';
    state.tab = 'ops';
    await hooks.reload?.();
    return true;
  }
  if (attr('data-build-ship')) {
    const name = attr('data-build-ship');
    const version = target.closest('[data-build-ship]').getAttribute('data-version');
    const servers = allServers().map((server) => `<label class="check"><input type="checkbox" data-ship-target="${esc(server.name)}"> ${esc(server.name)} <span class="mut">${esc(clusterOf(server))}</span></label>`).join('');
    openDialog(`<h2>${esc(t('buildShip'))}: <span class="mono">${esc(name)}</span></h2><p class="mut">${esc(t(/-dockerhub-/.test(name) ? 'shipHubHint' : 'shipImagesHint'))}</p>
      <div class="checks">${servers}</div><div class="form-grid">${codeField('shipCode')}<div class="wide row"><button class="acc" id="shipRun" data-name="${esc(name)}" data-version="${esc(version)}">${esc(t('buildShip'))}</button></div></div><div id="shipError" class="bad-text"></div>`);
    return true;
  }
  if (target.closest('#shipRun')) {
    const button = target.closest('#shipRun');
    const servers = [...document.querySelectorAll('[data-ship-target]:checked')].map((box) => box.getAttribute('data-ship-target'));
    if (!servers.length) { document.getElementById('shipError').textContent = t('updNoneChosen'); return true; }
    const answer = await api('/api/builds/ship', { folder: state.cache.build?.folder, name: button.getAttribute('data-name'), version: button.getAttribute('data-version'), servers, code: value('shipCode') });
    if (!answer.ok) { document.getElementById('shipError').textContent = t(answer.reason || 'failed'); return true; }
    await watchJob(answer.job, t('buildShip'));
    return true;
  }
  return false;
}
