/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Clusters: everything that can be done with them. Each cluster at a glance
 * (its servers up, its people, its links inside and to other clusters,
 * whether it stands on its own when the international internet is cut) with
 * actions on all its servers at once; making, filling, renaming, merging and
 * deleting clusters and moving a server between them; every server's inside
 * addresses — for a server outside Iran too, so that it can still be reached
 * by its bare IP address when the names (DNS) are gone; and the gateways.
 * A change to a cluster is a change to the signed family list: signed in this
 * browser, and by the operator key on this computer. */
import {
  state, t, esc, num, api, shownServers, clusterOf, regionText, byCluster, allServers, serverCells, table, card, show, hooks,
  subtabs, tag, kpi, fmtNum, deviceListed,
} from './ui.js';
import { loadClusterAdmin, renderClusterAdmin } from './admin.js';
import { editDirectory } from './graph.js';
import { fanOut } from './ui.js';

const IP = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;
const hostOf = (origin) => { try { return new URL(origin).hostname.replace(/^\[|\]$/g, ''); } catch (_error) { return ''; } };
/* An address that needs no name lookup: an IP literal. */
export const byIp = (origin) => IP.test(hostOf(origin));

/* What a server's inside address would be from deploy.conf: its SSH address
   and the port of its public address. */
export function suggestedInside(fields = {}) {
  const host = String(fields.SSH_HOST || '').trim();
  if (!host) return '';
  let port = '8585';
  try { port = new URL(fields.PUBLIC_URL).port || (new URL(fields.PUBLIC_URL).protocol === 'http:' ? '80' : '443'); } catch (_error) { /* the default */ }
  return `https://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
}

export const clusters = {
  id: 'clusters', title: 'clusters',
  async load(poll) {
    const [transit, health] = await Promise.all([fanOut('/Monitor_Server/transit', { poll }), fanOut('/healthz', { method: 'GET', poll }), loadClusterAdmin()]);
    state.cache.clusters = transit;
    state.cache.clusterHealth = health;
    if (!state.cache.serversConfig) state.cache.serversConfig = await api('/api/servers-config');
  },
  render() {
    const results = state.cache.clusters || [];
    const fam = state.cache.family || {};
    const relays = fam.relays || [];
    const canChange = Boolean(fam.canEdit && deviceListed());
    const servers = allServers();
    const linkedTo = (name) => new Set(((results.find((entry) => entry.server.name === name)?.data.peers) || []).filter((peer) => peer.linked).map((peer) => String(peer.fullId || peer.id).slice(0, 16)));
    const idOf = (server) => String(server.signFor || server.relayId || '').slice(0, 16);
    const groups = byCluster(servers);
    const tabs = subtabs('clusters', [['overview', 'clustersOverview', groups.length], ['manage', 'manageClusters'], ['addresses', 'insideAddresses'], ['gateways', 'gateways'], ['links', 'clusterLinks']]);
    let body = '';
    if (tabs.current === 'overview') {
      body = `<div class="cards">${groups.map(([cluster, members]) => {
        const up = members.filter((server) => server.reachable).length;
        const mates = (server) => members.filter((other) => other !== server && idOf(other));
        const inside = members.reduce((sum, server) => sum + mates(server).filter((mate) => linkedTo(server.name).has(idOf(mate))).length, 0);
        const insideMax = members.reduce((sum, server) => sum + mates(server).length, 0);
        const outside = members.reduce((sum, server) => sum + servers.filter((other) => clusterOf(other) !== cluster && idOf(other) && linkedTo(server.name).has(idOf(other))).length, 0);
        const famCluster = (fam.clusters || []).find((entry) => entry.name === cluster);
        const names = members.map((server) => server.name);
        return `<div class="card cluster-card"><div class="row spread"><h3><i class="fa-solid fa-layer-group"></i> ${esc(cluster)}</h3>
            <span>${famCluster ? (famCluster.independent ? tag(t('independent'), 'good') : tag(t('notIndependent'), 'warn')) : tag(t('byRegion'), 'mut')}</span></div>
          <div class="kpis small">${kpi('servers', `${up}/${members.length}`, '', up === members.length ? 'good' : 'warn')}${kpi('online', fmtNum(members.reduce((sum, server) => sum + num(server.peers), 0)))}${kpi('inCluster', `${inside}/${insideMax}`)}${kpi('otherClusters', fmtNum(outside))}</div>
          <div class="kv"><span>${esc(t('servers'))}</span><span>${members.map((server) => `${server.reachable ? tag(server.name, 'good') : tag(server.name, 'bad')}`).join(' ')}</span>
            <span>${esc(t('region'))}</span><span>${[...new Set(members.map((server) => regionText(server.region)))].map(esc).join('، ')}</span>
            <span>${esc(t('gateway'))}</span><span>${esc(famCluster?.gateways?.join(', ') || '—')}</span></div>
          <div class="row wrap">
            <button data-cluster-show="${esc(cluster)}"><i class="fa-solid fa-filter"></i> ${esc(t('showOnly'))}</button>
            <button data-cluster-group="ops-backup-create" data-servers="${esc(names.join(','))}">${esc(t('backupMake'))}</button>
            <button data-cluster-group="optimize-ram" data-servers="${esc(names.join(','))}">${esc(t('optimizeRam'))}</button>
            <button data-cluster-group="queue-flush" data-servers="${esc(names.join(','))}">${esc(t('flushQueues'))}</button>
            <button data-cluster-group="alert-test" data-servers="${esc(names.join(','))}">${esc(t('alertTest'))}</button>
            <button class="bad" data-cluster-group="ops-stack-restart" data-servers="${esc(names.join(','))}">${esc(t('stackRestart'))}</button></div></div>`;
      }).join('')}</div><p class="mut">${esc(t('clustersHint'))}</p>`;
    } else if (tabs.current === 'manage') {
      const names = (fam.clusters || []).map((entry) => entry.name);
      body = renderClusterAdmin()
        + (canChange && names.length > 1 ? card('mergeClusters', `<div class="row"><select id="mergeFrom">${names.map((name) => `<option>${esc(name)}</option>`).join('')}</select> → <select id="mergeInto">${names.map((name, index) => `<option${index === 1 ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select><button id="mergeRun" class="acc">${esc(t('merge'))}</button></div><p class="mut">${esc(t('mergeHint'))}</p>`) : '')
        + (canChange ? card('moveServer', table(['server', 'cluster', ''], relays.map((relay) => `<tr><td><strong>${esc(relay.name)}</strong></td><td>${esc(relay.cluster || '—')}</td><td class="row"><select data-move-to="${esc(relay.name)}"><option value="">${esc(t('noCluster'))}</option>${names.map((name) => `<option${name === relay.cluster ? ' selected' : ''}>${esc(name)}</option>`).join('')}<option value="__new">${esc(t('newCluster'))}</option></select><button data-move-run="${esc(relay.name)}">${esc(t('moveToCluster'))}</button></td></tr>`))) : '');
    } else if (tabs.current === 'addresses') {
      const fieldsOf = (name) => (state.cache.serversConfig?.servers || []).find((entry) => entry.name === name)?.fields || {};
      body = `<p class="mut">${esc(t('insideHelp'))}</p>${!canChange ? `<p class="warn-text">${esc(t(fam.canEdit ? 'signNeeded' : 'directoryReadOnly'))}</p>` : ''}`
        + table(['server', 'cluster', 'region', 'origins', 'insideAddresses', 'withoutDns', 'takesGuests', ''], relays.map((relay) => {
          const ipReach = [...(relay.origins || []), ...(relay.inside || [])].some(byIp);
          const suggestion = suggestedInside(fieldsOf(relay.name));
          return `<tr><td><strong>${esc(relay.name)}</strong></td><td>${esc(relay.cluster || '—')}</td><td>${esc(regionText(relay.region))}</td><td class="mono small">${esc((relay.origins || []).join(' ') || '—')}</td>
            <td><input class="mono wide" data-inside-of="${esc(relay.name)}" value="${esc((relay.inside || []).join(', '))}" placeholder="${esc(suggestion || 'https://203.0.113.10:8585')}"${canChange ? '' : ' disabled'}></td>
            <td>${ipReach ? tag(t('reachableByIp'), 'good') : tag(t('needsDns'), 'warn')}</td>
            <td><label class="row" title="${esc(t('takesGuestsHint'))}"><input type="checkbox" data-guests-of="${esc(relay.name)}"${relay.guests ? ' checked' : ''}${canChange ? '' : ' disabled'}></label></td>
            <td class="row">${canChange ? `${suggestion ? `<button data-inside-suggest="${esc(relay.name)}" data-value="${esc(suggestion)}" title="${esc(suggestion)}">${esc(t('useSshAddress'))}</button>` : ''}<button data-inside-save="${esc(relay.name)}" class="acc">${esc(t('save'))}</button>` : ''}</td></tr>`;
        }));
    } else if (tabs.current === 'gateways') {
      body = `<p class="mut">${esc(t('clusterGatewayHint'))}</p>` + table(['server', 'cluster', 'region', 'gateway', ''], relays.map((relay) => `<tr><td><strong>${esc(relay.name)}</strong></td><td>${esc(relay.cluster || '—')}</td><td>${esc(regionText(relay.region))}</td>
        <td><select data-gwdir-of="${esc(relay.name)}"${canChange ? '' : ' disabled'}>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}"${n === num(relay.gateway) ? ' selected' : ''}>${n || '—'}</option>`).join('')}</select></td>
        <td>${canChange ? `<button data-gwdir-save="${esc(relay.name)}">${esc(t('save'))}</button>` : ''}</td></tr>`))
        + `<p class="mut">${esc(t('gwOrderHint'))}</p><button data-tab="network">${esc(t('network'))}</button>`;
    } else {
      const rows = groups.flatMap(([cluster, members]) => {
        const mates = (server) => members.filter((other) => other !== server && idOf(other));
        const inside = (server) => mates(server).filter((mate) => linkedTo(server.name).has(idOf(mate))).length;
        const outside = (server) => servers.filter((other) => clusterOf(other) !== cluster && idOf(other) && linkedTo(server.name).has(idOf(other))).length;
        const independent = members.every((server) => inside(server) === mates(server).length);
        const connected = members.some((server) => outside(server) > 0);
        const head = `<tr class="group"><td colspan="7">${esc(cluster)} — ${independent ? tag(t('independent'), 'good') : tag(t('notIndependent'), 'bad')} ${connected ? tag(t('connected'), 'good') : tag(t('isolated'), 'warn')}</td></tr>`;
        return [head, ...members.filter((server) => shownServers().includes(server)).map((server) => {
          const noInside = !(server.inside || []).length;
          const warn = noInside ? tag(t(server.region === 'inside-iran' ? 'noInsideAddress' : 'noIpAddress'), 'warn') : '';
          return `<tr data-server-row="${esc(server.name)}">${serverCells(server)}<td>${esc(regionText(server.region))}</td><td class="mono">${esc((server.inside || []).join(' ') || '—')}</td>`
            + `<td>${inside(server)}/${mates(server).length}</td><td>${outside(server)}</td><td>${warn}</td></tr>`;
        })];
      });
      body = `${table(['server', 'cluster', 'region', 'insideAddresses', 'inCluster', 'otherClusters', ''], rows)}<p class="mut">${esc(t('clustersHint'))}</p>`;
    }
    return card('clusters', tabs.html + body);
  },
};

export async function clustersClick(target, { runGroup }) {
  const attr = (name) => target.closest(`[${name}]`)?.getAttribute(name);
  if (attr('data-cluster-show')) {
    state.filter.cluster = attr('data-cluster-show');
    state.filter.hidden.clear();
    state.tab = 'overview';
    await hooks.reload?.();
    return true;
  }
  if (attr('data-cluster-group')) {
    const element = target.closest('[data-cluster-group]');
    const names = String(element.getAttribute('data-servers') || '').split(',').filter((name) => allServers().find((server) => server.name === name)?.reachable);
    if (!names.length) { show(t('unreachable')); return true; }
    await runGroup(element.getAttribute('data-cluster-group'), names);
    return true;
  }
  if (target.closest('#mergeRun')) {
    const from = document.getElementById('mergeFrom')?.value;
    const into = document.getElementById('mergeInto')?.value;
    if (!from || !into || from === into) return true;
    const members = (state.cache.family?.relays || []).filter((relay) => relay.cluster === from).map((relay) => relay.name);
    if (!window.confirm(`${t('confirmMerge')} ${from} → ${into} (${members.join(', ')})`)) return true;
    await editDirectory(members.map((name) => ({ op: 'cluster', name, cluster: into })));
    await loadClusterAdmin();
    hooks.render();
    return true;
  }
  if (attr('data-move-run')) {
    const name = attr('data-move-run');
    let cluster = document.querySelector(`[data-move-to="${CSS.escape(name)}"]`)?.value ?? '';
    if (cluster === '__new') cluster = (window.prompt(t('newClusterPrompt')) || '').trim();
    if (cluster === null || !window.confirm(`${t('confirmMoveCluster')} ${name} → ${cluster || t('noCluster')}`)) return true;
    await editDirectory([{ op: 'cluster', name, cluster }]);
    await loadClusterAdmin();
    hooks.render();
    return true;
  }
  /* Guest mode: whether this relay takes in people whose home relay is
     unreachable. Signed into the family list like the rest. */
  if (attr('data-guests-of')) {
    const box = target.closest('[data-guests-of]');
    const name = box.getAttribute('data-guests-of');
    const guests = Boolean(box.checked);
    if (!window.confirm(`${t(guests ? 'confirmGuestsOn' : 'confirmGuestsOff')} ${name}`)) { box.checked = !guests; return true; }
    await editDirectory([{ op: 'guests', name, guests }]);
    await loadClusterAdmin();
    hooks.render();
    return true;
  }
  if (attr('data-inside-suggest')) {
    const name = attr('data-inside-suggest');
    const box = document.querySelector(`[data-inside-of="${CSS.escape(name)}"]`);
    const suggestion = target.closest('[data-inside-suggest]').getAttribute('data-value');
    if (box) box.value = [...new Set([...box.value.split(/[,\s]+/).filter(Boolean), suggestion])].join(', ');
    return true;
  }
  if (attr('data-gwdir-save')) {
    const name = attr('data-gwdir-save');
    const gateway = num(document.querySelector(`[data-gwdir-of="${CSS.escape(name)}"]`)?.value);
    const relay = (state.cache.family?.relays || []).find((entry) => entry.name === name);
    if (gateway > 0 && relay?.region === 'inside-iran' && !window.confirm(t('gwInsideIran'))) return true;
    await editDirectory([{ op: 'gateway', name, gateway }]);
    await loadClusterAdmin();
    hooks.render();
    return true;
  }
  return false;
}
