/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Server operations: backups, updates and the work done on the servers
 * themselves, in one section (what were the Machine, System and Install
 * sections). Its sub-tabs:
 *
 *   servers      every server's machine at a glance, its logs, and the
 *                actions on all of them at once
 *   backups      made, downloaded, restored and deleted, grouped by server
 *   updates      from this computer (a build of Build & package, a folder,
 *                an archive, an image archive) or from GitHub, sent in a
 *                chain at the quietest hour (updates.js), and GitHub's own
 *                apply and roll back
 *   containers   memory and processor of every container, grouped by server,
 *                cluster or container, with their ceilings
 *   images       the images on each server, Docker Hub checks, clean-up
 *   install      a server made ready (Docker and the rest, through mirrors
 *                inside Iran), the install command for a new one
 *   system       the relays' system facts, the dashboard password, this panel */
import {
  state, t, esc, num, pct, fmtBytes, fmtTime, api, fanOut, shownServers, clusterOf, regionText, visible, rowRef, serverCells, button, groupButton, table, serverTable, card, show, hooks,
  subtabs, groupPicker, groupLabel, groupItems, grouped, searchBox, tag, kpi, fmtNum, allServers,
} from './ui.js';
import { loadPanelSystem, renderPanelSystem, openDialog, watchJob } from './admin.js';
import { loadUpdates, renderUpdates } from './updates.js';
import { barChart, colorOf } from './charts.js';

const okResults = (results) => visible(results).filter((result) => result.ok);
const serverOptions = () => shownServers().map((server) => `<option value="${esc(server.name)}">${esc(server.name)} · ${esc(clusterOf(server))}</option>`).join('');
const short = (name) => String(name || '').replace('Poorija-Cryptography_', '');
const codeField = (id) => `<input id="${id}" class="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="${esc(t('codePh'))}">`;

export const ops = {
  id: 'ops', title: 'ops',
  async load(poll) {
    const tab = state.view['ops:tab'] || 'servers';
    const want = {
      servers: ['backups', 'memory', 'disk', 'github', 'health'], backups: ['backups'], updates: ['github'], containers: ['memory'], images: ['images', 'disk'], install: [], system: ['health'],
    }[tab] || [];
    const reads = {
      backups: () => fanOut('/Monitor_Server/ops-backup-list', { poll }), memory: () => fanOut('/Monitor_Server/ops-memory', { poll }), disk: () => fanOut('/Monitor_Server/ops-disk', { poll }),
      images: () => fanOut('/Monitor_Server/ops-images', { poll }), github: () => fanOut('/Monitor_Server/ops-github-check', { poll }), health: () => fanOut('/healthz', { method: 'GET', poll }),
    };
    const got = await Promise.all(want.map((key) => reads[key]()));
    state.cache.machine = { ...(state.cache.machine || {}), ...Object.fromEntries(want.map((key, index) => [key, got[index]])) };
    if (tab === 'updates' && !poll) await loadUpdates();
    if (tab === 'system') await loadPanelSystem();
    if (tab === 'install' && !state.cache.serversConfig) state.cache.serversConfig = await api('/api/servers-config');
  },
  render() {
    const machine = state.cache.machine || {};
    const { backups = [], memory = [], disk = [], images = [], github = [], health = [] } = machine;
    const of = (list, name) => list.find((result) => result.server.name === name)?.data || {};
    const backupCount = okResults(backups).reduce((sum, { data }) => sum + (data.backups || []).length, 0);
    const containerCount = okResults(memory).reduce((sum, { data }) => sum + (data.containers || []).length, 0);
    const tabs = subtabs('ops', [['servers', 'opsServers'], ['backups', 'backups', backups.length ? backupCount : null], ['updates', 'updTitle'], ['containers', 'containers', memory.length ? containerCount : null], ['images', 'imagesCleanup'], ['install', 'installPrereqs'], ['system', 'system']]);
    let body = '';
    if (tabs.current === 'servers') {
      const healthy = okResults(health);
      body = `<div class="row">${groupButton('ops-backup-create', { cls: 'acc' })}${groupButton('ops-stack-restart', { cls: 'bad' })}${groupButton('optimize-ram')}${groupButton('clear-memory', { cls: 'bad' })}${groupButton('alert-test')}</div>`
        + (healthy.length ? `<div class="charts">${barChart({ title: t('cpuByServer'), unit: '%', items: healthy.map(({ server, data }) => ({ label: server.name, values: [num(data.cpuLoad)] })), keys: [{ label: t('cpu'), color: colorOf(0) }] })}
          ${barChart({ title: t('ramByServer'), unit: 'MB', items: healthy.map(({ server, data }) => ({ label: server.name, values: [num(data.containerMem?.usageMb || data.memory?.rss)] })), keys: [{ label: t('ram'), color: colorOf(1) }] })}
          ${barChart({ title: t('diskByServer'), unit: '%', items: healthy.map(({ server, data }) => ({ label: server.name, values: [data.storage?.total ? Math.round(((num(data.storage.total) - num(data.storage.free)) / num(data.storage.total)) * 100) : 0] })), keys: [{ label: t('disk'), color: colorOf(3) }] })}</div>` : '')
        + serverTable(health.length ? health : backups, {
          extra: ['version', 'host', 'uptime', 'backups', 'ram', 'disk', 'running', 'latest'],
          cells: ({ server, data }) => {
            const d = of(disk, server.name).disk || {};
            const g = of(github, server.name);
            return [esc(server.version || '—'), esc(data.hostname || '—'), data.uptime ? `${Math.round(num(data.uptime) / 3600)} h` : '—', num((of(backups, server.name).backups || []).length), `${num(of(memory, server.name).host?.totalMb)} MB`,
              pct(num(d.total) - num(d.free), num(d.total)), esc(g.running?.version || '—'), `${esc(g.latest?.tag || '—')}${g.updateAvailable ? ` ${tag(t('updateAvailable'), 'warn')}` : ''}`];
          },
          actions: ({ server }) => `<button data-logs="${esc(rowRef({ server: server.name }))}">${esc(t('logs'))}</button>${button('ops-stack-restart', rowRef({ server: server.name }), { cls: 'bad', label: 'stackRestart' })}`,
        });
    } else if (tabs.current === 'backups') {
      const rows = okResults(backups).flatMap(({ server, data }) => (data.backups || []).map((row) => ({ server, row })));
      const mode = groupPicker('ops:backupGroup', ['server', 'cluster', 'none'], 'server');
      body = `<div class="toolbar">${mode.html}${searchBox('backups')}${groupButton('ops-backup-create', { cls: 'acc' })}</div>`
        + `<div data-searchable="backups">${grouped('backups', groupItems(rows, ({ server }) => groupLabel(server, mode.current)), (list) => table(['server', 'cluster', 'name', 'size', ''], list.map(({ server, row }) => {
          const ref = rowRef({ server: server.name, name: String(row.name || '') });
          return `<tr>${serverCells(server)}<td class="mono">${esc(row.name)}</td><td>${esc(row.size)}</td><td class="row">${button('ops-backup-download', ref)}${button('ops-backup-restore', ref, { cls: 'bad' })}${button('ops-backup-delete', ref, { cls: 'bad' })}</td></tr>`;
        })))}</div>`;
    } else if (tabs.current === 'updates') {
      body = `<div class="row"><button data-tab="build"><i class="fa-solid fa-box-open"></i> ${esc(t('build'))}</button><span class="mut">${esc(t('opsLocalHint'))}</span></div>`
        + renderUpdates()
        + card('ghTitle', `<p class="mut">${esc(t('ghHint'))}</p>${serverTable(github, {
          extra: ['running', 'latest'],
          cells: ({ data }) => [esc(data.running?.version || '—'), `${esc(data.latest?.tag || '—')}${data.updateAvailable ? ` ${tag(t('updateAvailable'), 'warn')}` : ''}`],
          actions: ({ server }) => button('ops-github-rollback', rowRef({ server: server.name }), { cls: 'bad' }),
        })}`, groupButton('ops-github-apply'));
    } else if (tabs.current === 'containers') {
      const rows = okResults(memory).flatMap(({ server, data }) => (data.containers || []).map((row) => ({ server, row })));
      const mode = groupPicker('ops:containerGroup', ['server', 'cluster', 'container', 'region', 'none'], 'server');
      const keyOf = ({ server, row }) => (mode.current === 'container' ? short(row.name) : groupLabel(server, mode.current));
      const rowsOf = (list) => table(['server', 'cluster', 'container', 'ram', 'cpu', 'ramMb', 'cpuPct', ''], list.map(({ server, row }) => {
        const ref = rowRef({ server: server.name, container: String(row.name || '') });
        const suggested = Math.max(128, Math.ceil((num(row.usageMb) * 2) / 64) * 64);
        return `<tr>${serverCells(server)}<td class="mono">${esc(short(row.name))}</td><td>${row.limitMb ? `${num(row.usageMb)} / ${num(row.limitMb)} MB ${tag(pct(num(row.usageMb), num(row.limitMb)), num(row.usageMb) / num(row.limitMb) > 0.85 ? 'bad' : 'mut')}` : `${num(row.usageMb)} MB / ${esc(t('unlimited'))}`}</td>`
          + `<td>${row.cpuPct != null ? `${num(row.cpuPct)}%` : '—'}</td><td><input type="number" min="0" max="16384" step="64" value="${suggested}" data-ram="${esc(ref)}" class="narrow"></td>`
          + `<td><input type="number" min="0" max="800" step="25" value="100" data-cpu="${esc(ref)}" class="narrow"></td><td>${button('ops-memory-set', ref, { cls: 'acc' })}</td></tr>`;
      }));
      const byContainer = groupItems(rows, ({ row }) => short(row.name));
      body = `<div class="kpis">${kpi('containers', fmtNum(rows.length))}${kpi('ram', `${fmtNum(rows.reduce((sum, { row }) => sum + num(row.usageMb), 0))} MB`)}${kpi('cpuTotal', `${fmtNum(rows.reduce((sum, { row }) => sum + num(row.cpuPct), 0))}%`)}</div>
        <div class="charts">${barChart({ title: t('ramByContainer'), unit: 'MB', items: byContainer.map(([name, list]) => ({ label: name, values: [list.reduce((sum, { row }) => sum + num(row.usageMb), 0)] })).sort((a, b) => b.values[0] - a.values[0]), keys: [{ label: t('ram'), color: colorOf(0) }] })}
          ${barChart({ title: t('ramByServer'), unit: 'MB', items: groupItems(rows, ({ server }) => server.name).map(([name, list]) => ({ label: name, values: [list.reduce((sum, { row }) => sum + num(row.usageMb), 0)] })), keys: [{ label: t('ram'), color: colorOf(1) }] })}</div>
        <div class="toolbar">${mode.html}${searchBox('containers')}</div>
        <div data-searchable="containers">${grouped('containers', groupItems(rows, keyOf), rowsOf, { summary: (list) => esc(`${fmtNum(list.reduce((sum, { row }) => sum + num(row.usageMb), 0))} MB · ${fmtNum(list.reduce((sum, { row }) => sum + num(row.cpuPct), 0))}%`) })}</div><p class="mut">${esc(t('ramHint'))}</p>`;
    } else if (tabs.current === 'images') {
      const imageRows = okResults(images).flatMap(({ server, data }) => (data.images || []).map((image) => ({ server, image })));
      const cleanup = okResults(disk).flatMap(({ server, data }) => [
        ...(data.cleanup?.staleSelfImages || []).map((image) => ({ server, kind: 'stale', image })),
        ...(data.cleanup?.danglingImages || []).map((image) => ({ server, kind: 'dangling', image })),
      ]);
      const mode = groupPicker('ops:imageGroup', ['server', 'repository', 'cluster', 'none'], 'server');
      body = serverTable(images, { extra: ['images'], cells: ({ data }) => [num((data.images || []).length)], actions: ({ server }) => { const ref = rowRef({ server: server.name }); return button('ops-image-export', ref) + button('ops-bundle', ref); } })
        + `<div class="toolbar">${mode.html}${searchBox('images')}</div><div data-searchable="images">${grouped('images', groupItems(imageRows, ({ server, image }) => (mode.current === 'repository' ? String(image.repository) : groupLabel(server, mode.current))), (list) => table(['server', 'cluster', 'repository', 'tag', 'id', 'size', 'created', ''], list.map(({ server, image }) => {
          const reference = `${image.repository}:${image.tag}`;
          const watched = /^(node|docker|coturn\/coturn|nginx|certbot\/certbot)/.test(String(image.repository));
          const ref = rowRef({ server: server.name, reference });
          return `<tr>${serverCells(server)}<td class="mono">${esc(image.repository)}</td><td>${esc(image.tag)}</td><td class="mono">${esc(String(image.id).slice(0, 19))}</td><td>${esc(fmtBytes(image.size))}</td><td>${esc(fmtTime(image.created))}</td>`
            + `<td class="row">${watched ? button('ops-image-check', ref) + button('ops-image-update', ref) : ''}</td></tr>`;
        })))}</div>`
        + card('cleanup', grouped('cleanup', groupItems(cleanup, ({ server }) => server.name), (list) => table(['server', 'cluster', 'kind', 'image', 'size', ''], list.map(({ server, kind, image }) => `<tr>${serverCells(server)}<td>${tag(t(kind), 'mut')}</td><td class="mono">${esc(String(image.ref).slice(0, 48))}</td><td>${esc(fmtBytes(image.size))}</td><td>${button('ops-cleanup-image', rowRef({ server: server.name, ref: String(image.ref || '') }), { cls: 'bad' })}</td></tr>`))), groupButton('ops-cleanup-temps'));
    } else if (tabs.current === 'install') {
      const config = state.cache.serversConfig || {};
      const prereqs = state.cache.prereqs || {};
      const rows = (config.servers || []).map(({ name, fields }) => {
        const facts = prereqs[name];
        const live = allServers().find((server) => server.name === name);
        const factCell = !facts ? `<span class="mut">${esc(t('notChecked'))}</span>` : facts.error ? tag(facts.error, 'bad')
          : `${facts.docker ? tag(`Docker ${facts.docker}`, 'good') : tag(t('dockerMissing'), 'bad')} ${facts.compose ? tag(`compose ${facts.compose}`, 'good') : tag(t('composeMissing'), 'warn')} <span class="mut small">${esc(facts.os || '')} · ${esc(facts.arch || '')} · root: ${esc(facts.root || '?')}</span>`;
        return `<tr><td><strong>${esc(name)}</strong></td><td>${esc(regionText(fields.REGION))}</td><td>${live?.reachable ? tag(t('reachable'), 'good') : tag(t('notConnected'), 'warn')}</td><td>${factCell}</td>
          <td class="actions"><button data-prereq-check="${esc(name)}">${esc(t('checkPrereqs'))}</button><button class="acc" data-prereq-run="${esc(name)}">${esc(t('installPrereqs'))}</button><button data-srv-install="${esc(name)}">${esc(t('install'))}</button></td></tr>`;
      }).join('');
      body = `<p class="mut">${esc(t('prereqHint'))}</p><div class="scroll"><table><thead><tr>${['server', 'region', 'state', 'prerequisites', ''].map((key) => `<th>${key ? esc(t(key)) : ''}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="5" class="mut">${esc(t('noServers'))}</td></tr>`}</tbody></table></div>`
        + card('bootstrap', `<p class="mut">${esc(t('bootstrapHint'))}</p>${serverTable(shownServers().map((server) => ({ server, ok: server.reachable, data: {}, reason: server.reachable ? '' : 'unreachable' })), {
          extra: ['address'], cells: ({ server }) => [`<span class="mono">${esc(server.publicUrl || '—')}</span>`],
          actions: ({ server }) => button('bootstrap-token', rowRef({ server: server.name })),
        })}`);
    } else {
      body = serverTable(health, {
        extra: ['host', 'node', 'uptime', 'turn', 'relayId', 'cpus'],
        cells: ({ data }) => [esc(data.hostname || '—'), esc(data.nodeVersion || '—'), `${Math.round(num(data.uptime) / 60)} min`, data.turnEnabled || (data.turnUrls || []).length ? tag('on', 'good') : tag('off', 'bad'), `<span class="mono">${esc(String(data.relayId || '').slice(0, 16))}</span>`, `${num(data.cpus)} · ${esc(data.cpuModel || '')}`],
        actions: ({ server }) => `<button data-logs="${esc(rowRef({ server: server.name }))}">${esc(t('logs'))}</button>`,
      }) + card('changePassword', `<div class="row" data-form="change-password"><select data-field="server">${serverOptions()}</select>
        <input type="password" data-field="oldPassword" autocomplete="off" placeholder="${esc(t('oldPassword'))}"><input type="password" data-field="newPassword" autocomplete="new-password" placeholder="${esc(t('newPassword'))}">
        <input type="password" data-field="newPassword2" autocomplete="new-password" placeholder="${esc(t('newPassword2'))}"><button data-form-run="change-password" class="acc">${esc(t('changePassword'))}</button></div>`)
        + renderPanelSystem();
    }
    return card('ops', tabs.html + body);
  },
};

/* The prerequisite buttons of the install tab. */
export async function opsClick(target) {
  const check = target.closest('[data-prereq-check]');
  if (check) {
    const name = check.getAttribute('data-prereq-check');
    check.disabled = true;
    const answer = await api('/api/servers/check', { name });
    state.cache.prereqs = { ...(state.cache.prereqs || {}), [name]: answer.ok ? answer.facts : { error: t(answer.reason || 'failed') } };
    hooks.render();
    return true;
  }
  const run = target.closest('[data-prereq-run]');
  if (run) {
    const name = run.getAttribute('data-prereq-run');
    openDialog(`<h2>${esc(t('installPrereqs'))} — ${esc(name)}</h2><p class="mut">${esc(t('prereqRunHint'))}</p>
      <div class="row"><input id="prereqSudoPass" type="password" autocomplete="off" placeholder="${esc(t('sudoPasswordPh'))}">${codeField('prereqCode')}<button class="acc" id="prereqGo" data-name="${esc(name)}">${esc(t('installPrereqs'))}</button></div><div id="prereqError" class="bad-text"></div>`);
    return true;
  }
  if (target.closest('#prereqGo')) {
    const name = target.closest('#prereqGo').getAttribute('data-name');
    const answer = await api('/api/servers/prepare', { name, code: String(document.getElementById('prereqCode')?.value || '').trim(), sudoPassword: document.getElementById('prereqSudoPass')?.value || '' });
    if (document.getElementById('prereqSudoPass')) document.getElementById('prereqSudoPass').value = '';
    if (!answer.ok) { document.getElementById('prereqError').textContent = t(answer.reason || 'failed'); return true; }
    await watchJob(answer.job, `${t('installPrereqs')} — ${name}`);
    const facts = await api('/api/servers/check', { name });
    state.cache.prereqs = { ...(state.cache.prereqs || {}), [name]: facts.ok ? facts.facts : { error: t(facts.reason || 'failed') } };
    return true;
  }
  return false;
}
