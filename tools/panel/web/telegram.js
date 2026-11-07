/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The Telegram bot, managed from the panel: every server's settings
 * (scripts/lib/telegram-settings.js keeps and checks them on the relay),
 * read and written through /Monitor_Server/telegram. The token is shown
 * masked and is sent only when the operator types a new one; it belongs on
 * the server outside Iran alone, which sends for the family, and every
 * other server hands its alerts to it over the relay link.
 *
 * A preview is the relay's own drawing of a card, shown here with only the
 * markup Telegram itself allows (bold, italic, struck, underlined, code, a
 * spoiler, a quote and a folded quote), everything else as text, drawn the
 * way Telegram draws it: a quote as a tinted box with rounded corners, the
 * whole card right to left or left to right as its direction marks say. */

import { state, t, $, esc, num, fmtTime, serverCall, fanOut, shownServers, clusterOf, card, show, explain, hooks } from './ui.js';

/* The panel's own lists of what a setting may be: what a server answers is
   matched against them, never drawn from as it comes. */
const CATEGORY_ORDER = ['critical', 'warn', 'resolved', 'reminder', 'peer', 'start', 'security', 'partner', 'update', 'test', 'report'];
const ALERT_KEYS = ['disk', 'memory', 'relay-memory', 'files', 'turn-down', 'turn-ports', 'bandwidth', 'peer', 'peer-via'];
const COMMANDS = ['status', 'servers', 'alerts', 'updates', 'version', 'mute', 'unmute', 'help'];
const TOPICS = ['alerts', 'reports', 'security', 'updates', 'other'];
const LANGUAGES = ['fa', 'en'];
const THRESHOLDS = [
  ['diskFreePct', '%', 0, 99], ['diskFreeGb', 'GB', 0, 10000], ['memoryFreePct', '%', 0, 99], ['relayMemoryPct', '%', 1, 100], ['filesPct', '%', 1, 100],
  ['turnPct', '%', 1, 100], ['linkMbps', 'Mbit/s', 0, 100000], ['linkPct', '%', 1, 100], ['peerDownMinutes', 'min', 1, 1440],
];
const ZONES = ['Asia/Tehran', 'UTC', 'Europe/Helsinki', 'Europe/Stockholm', 'Europe/Berlin', 'Europe/London', 'America/Toronto', 'America/New_York', 'Asia/Dubai', 'Asia/Istanbul'];
const groupBy = (items, keyOf) => { const map = new Map(); for (const item of items) { const key = keyOf(item); if (!map.has(key)) map.set(key, []); map.get(key).push(item); } return [...map.entries()]; };
const tag = (text, cls = '') => `<span class="tag ${esc(cls)}">${esc(text)}</span>`;
const checked = (on) => (on ? ' checked' : '');
const value = (id) => String($(id)?.value ?? '').trim();
const isOn = (id) => Boolean($(id)?.checked);

/* What Telegram would show, and nothing that could run: escaped whole, then
   only <b> and <code> let back in. */
export function cardPreview(html) {
  return esc(String(html || ''))
    .replace(/&lt;(\/?)(b|i|s|u|code|pre)&gt;/g, '<$1$2>')
    .replace(/&lt;tg-spoiler&gt;/g, '<span class="tg-spoiler">').replace(/&lt;\/tg-spoiler&gt;/g, '</span>')
    .replace(/&lt;blockquote expandable&gt;/g, '<blockquote class="tgq fold">').replace(/&lt;blockquote&gt;/g, '<blockquote class="tgq">').replace(/&lt;\/blockquote&gt;/g, '</blockquote>')
    .replace(/\n/g, '<br>');
}
/* Which way a card reads: its first direction mark. */
const directionOf = (html) => (String(html || '').startsWith('\u200F') ? 'rtl' : String(html || '').startsWith('\u200E') ? 'ltr' : 'auto');
export const STYLES = ['classic', 'boxed', 'compact', 'minimal', 'detailed', 'custom'];
const SEPARATORS = ['heavy', 'light', 'double', 'dots', 'none'];
const galleryHtml = (cards) => `<div class="tg-gallery">${cards.map(([style, html]) => `<div class="tg-gallery-item">${bubble(html, t(`tgStyle_${style}`))}<button data-tg-use-style="${esc(style)}">${esc(t('tgUseStyle'))}</button></div>`).join('')}</div>`;
const bubble = (html, caption = '') => `<figure class="tg-bubble-wrap">${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}<div class="tg-preview tg-bubble" dir="${directionOf(html)}">${cardPreview(html)}</div></figure>`;

export async function loadTelegram(poll) {
  const results = await fanOut('/Monitor_Server/telegram', { method: 'GET', poll });
  const before = state.cache.telegram || {};
  const reachable = results.filter((result) => result.ok && result.data.settings);
  const editing = reachable.some((result) => result.server.name === before.editing) ? before.editing
    : (reachable.find((result) => result.data.sends) || reachable[0])?.server.name || '';
  state.cache.telegram = { ...before, results, editing };
}

const viaTag = (data) => (data.sends ? tag(t('tgSends'), 'good') : data.via === 'relay-link' ? tag(t('tgForwards'), 'mut') : tag(t('tgNowhere'), 'bad'));

function statusTable(results) {
  const ordered = [];
  for (const [cluster, members] of groupBy(results, (result) => clusterOf(result.server))) ordered.push({ head: cluster, count: members.length }, ...members);
  const rows = ordered.map((entry) => {
    if (entry.head !== undefined) return `<tr class="group"><td colspan="10">${esc(entry.head)} <span class="count">${entry.count}</span></td></tr>`;
    const { server, ok, data, reason } = entry;
    if (!ok || !data.settings) {
      return `<tr><td><strong>${esc(server.name)}</strong></td><td>${esc(clusterOf(server))}</td><td colspan="7" class="mut">${esc(reason === 'unreachable' ? t('unreachable') : t('tgOld'))}</td><td></td></tr>`;
    }
    const s = data.settings;
    const token = s.token.set ? `${tag(t('tgTokenSet'), 'good')} <span class="mono">${esc(s.token.hint)}</span>` : tag(t('tgNoToken'), 'mut');
    const muted = s.muteUntil > Date.now() ? tag(`${t('tgMutedUntil')} ${fmtTime(s.muteUntil)}`, 'warn') : '';
    return `<tr><td><strong>${esc(server.name)}</strong></td><td>${esc(clusterOf(server))}</td><td>${viaTag(data)} ${s.enabled ? '' : tag(t('tgOff'), 'bad')} ${muted}</td>
      <td>${token}</td><td class="mono">${esc(s.chatId || '—')}</td><td>${esc(s.language)}</td><td>${num(data.waiting)}${data.held ? ` (${num(data.held)} ${esc(t('tgHeld'))})` : ''}</td>
      <td>${(data.active || []).length ? tag(String(data.active.length), (data.active || []).some((problem) => problem.level === 'critical') ? 'bad' : 'warn') : tag('0', 'good')}</td>
      <td class="mono">${esc(data.label || '')}</td>
      <td class="actions"><button data-tg-edit="${esc(server.name)}"${state.cache.telegram?.editing === server.name ? ' class="acc"' : ''}>${esc(t('edit'))}</button><button data-tg-test="${esc(server.name)}">${esc(t('test'))}</button></td></tr>`;
  }).join('');
  const head = ['server', 'cluster', 'tgRole', 'tgToken', 'tgChat', 'tgLanguage', 'tgWaiting', 'tgActive', 'tgLabel', ''].map((key) => `<th>${key ? esc(t(key)) : ''}</th>`).join('');
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div><p class="mut">${esc(t('tgRoleHelp'))}</p>`;
}

function settingsForm(server, data) {
  const s = data.settings;
  const offered = (list, known) => known.filter((name) => (Array.isArray(list) ? list : known).includes(name));
  const choices = {
    languages: offered(data.choices?.languages, LANGUAGES), categories: offered(data.choices?.categories, CATEGORY_ORDER),
    alertKeys: offered(data.choices?.alertKeys, ALERT_KEYS), commands: offered(data.choices?.commands, COMMANDS), topics: offered(data.choices?.topics, TOPICS),
  };
  const field = (key, input, cls = '') => `<label class="${cls}"><span>${esc(t(key))}</span>${input}</label>`;
  const chats = (data.chats || []).map((chat) => `<button class="chip" data-tg-chat="${esc(chat.id)}" title="${esc(chat.type)}">${esc(chat.title || chat.username || chat.id)} · <span class="mono">${esc(chat.id)}</span></button>`).join('');
  const bot = `<h3>${esc(t('tgBot'))}</h3><div class="form-grid">
    ${field('tgEnabled', `<span class="row"><input type="checkbox" id="tgEnabled"${checked(s.enabled)}> ${esc(t('tgEnabledHelp'))}</span>`, 'wide')}
    ${field('tgToken', `<input id="tgToken" type="password" autocomplete="off" placeholder="${esc(s.token.set ? `${s.token.hint} (${t(`tgSource_${s.token.source}`)})` : t('tgTokenPh'))}">`)}
    ${field('tgTokenRemove', `<span class="row"><input type="checkbox" id="tgTokenRemove"${s.token.set ? '' : ' disabled'}> ${esc(t('tgTokenRemoveHelp'))}</span>`)}
    ${field('tgChat', `<input id="tgChatId" value="${esc(s.chatId)}" placeholder="-1001234567890 / @channel" dir="ltr">`)}
    ${field('tgLabel', `<input id="tgLabelField" value="${esc(s.label)}" maxlength="60" placeholder="${esc(data.label || '')}">`)}
    ${field('tgLanguage', `<select id="tgLanguageField">${choices.languages.map((lang) => `<option value="${lang}"${lang === s.language ? ' selected' : ''}>${esc(t(`tgLang_${lang}`))}</option>`).join('')}</select>`)}
    ${field('tgZone', `<input id="tgZone" value="${esc(s.timezone)}" list="tgZones" dir="ltr"><datalist id="tgZones">${ZONES.map((zone) => `<option value="${zone}">`).join('')}</datalist>`)}
    ${field('tgAdmins', `<input id="tgAdmins" value="${esc((s.admins || []).join(', '))}" placeholder="${esc(t('tgAdminsPh'))}" dir="ltr">`, 'wide')}
    </div><p class="warn-text">${esc(t('tgTokenWarn'))}</p>${chats ? `<p class="mut">${esc(t('tgChatsSeen'))}</p><div class="row wrap">${chats}</div>` : `<p class="mut">${esc(t('tgChatsHelp'))}</p>`}`;
  const categoryRows = choices.categories.map((category) => {
    const flags = s.categories[category] || { on: true, silent: false };
    return `<tr><td>${esc(t(`tgCat_${category}`))}</td><td><input type="checkbox" data-tg-cat-on="${category}"${checked(flags.on)}${category === 'test' ? ' disabled' : ''}></td>
      <td><input type="checkbox" data-tg-cat-silent="${category}"${checked(flags.silent)}${category === 'critical' ? ' disabled' : ''}></td><td class="mut">${esc(t(`tgCatHelp_${category}`))}</td></tr>`;
  }).join('');
  const categories = `<h3>${esc(t('tgCategories'))}</h3><div class="scroll"><table><thead><tr><th>${esc(t('tgCategory'))}</th><th>${esc(t('tgSend'))}</th><th>${esc(t('tgSilent'))}</th><th></th></tr></thead><tbody>${categoryRows}</tbody></table></div>`;
  const keys = choices.alertKeys.map((key) => `<label class="check"><input type="checkbox" data-tg-key="${key}"${checked(s.alertKeys[key] !== false)}> ${esc(t(`tgKey_${key}`))}</label>`).join('');
  const thresholds = THRESHOLDS.map(([key, unit, min, max]) => field(`tgTh_${key}`, `<span class="row"><input type="number" data-tg-th="${key}" value="${esc(s.thresholds[key])}" min="${min}" max="${max}" step="any" dir="ltr"> <span class="mut">${unit}</span></span>`)).join('');
  const alerts = `<h3>${esc(t('tgAlerts'))}</h3><div class="checks">${keys}</div><div class="form-grid">${thresholds}
    ${field('tgCheckSeconds', `<span class="row"><input type="number" id="tgCheckSeconds" value="${esc(s.checkSeconds)}" min="5" max="3600" dir="ltr"> <span class="mut">s</span></span>`)}
    ${field('tgRemindHours', `<span class="row"><input type="number" id="tgRemindHours" value="${esc(s.remindHours)}" min="0.25" max="168" step="0.25" dir="ltr"> <span class="mut">h</span></span>`)}
    ${field('tgMinGap', `<span class="row"><input type="number" id="tgMinGap" value="${esc(s.minGapSeconds)}" min="0" max="3600" dir="ltr"> <span class="mut">s</span></span>`)}
    </div><p class="mut">${esc(t('tgThresholdHelp'))}</p>`;
  const muted = s.muteUntil > Date.now();
  const quiet = `<h3>${esc(t('tgQuiet'))}</h3><div class="form-grid">
    ${field('tgQuietOn', `<span class="row"><input type="checkbox" id="tgQuietOn"${checked(s.quiet.on)}> ${esc(t('tgQuietOnHelp'))}</span>`, 'wide')}
    ${field('tgFrom', `<input type="time" id="tgQuietFrom" value="${esc(s.quiet.from)}" dir="ltr">`)}${field('tgTo', `<input type="time" id="tgQuietTo" value="${esc(s.quiet.to)}" dir="ltr">`)}
    ${field('tgQuietMode', `<select id="tgQuietMode"><option value="silent"${s.quiet.mode === 'silent' ? ' selected' : ''}>${esc(t('tgQuietSilent'))}</option><option value="hold"${s.quiet.mode === 'hold' ? ' selected' : ''}>${esc(t('tgQuietHold'))}</option></select>`)}
    ${field('tgCriticalPasses', `<span class="row"><input type="checkbox" id="tgCriticalPasses"${checked(s.quiet.criticalPasses)}> ${esc(t('tgCriticalPassesHelp'))}</span>`)}
    </div><div class="row wrap"><span>${muted ? tag(`${t('tgMutedUntil')} ${fmtTime(s.muteUntil)}`, 'warn') : tag(t('tgNotMuted'), 'good')}</span>
    <button data-tg-mute="3600">${esc(t('tgMute1h'))}</button><button data-tg-mute="28800">${esc(t('tgMute8h'))}</button><button data-tg-mute="86400">${esc(t('tgMute1d'))}</button>${muted ? `<button data-tg-mute="0">${esc(t('tgUnmute'))}</button>` : ''}</div>`;
  const report = `<h3>${esc(t('tgReport'))}</h3><div class="form-grid">
    ${field('tgReportOn', `<span class="row"><input type="checkbox" id="tgReportOn"${checked(s.report.on)}> ${esc(t('tgReportOnHelp'))}</span>`)}
    ${field('tgReportAt', `<input type="time" id="tgReportAt" value="${esc(s.report.at)}" dir="ltr">`)}</div>`;
  const commands = `<h3>${esc(t('tgCommands'))}</h3><div class="checks">${choices.commands.map((command) => `<label class="check"><input type="checkbox" data-tg-cmd="${command}"${checked(s.commands[command])}> <span class="mono">/${command}</span> <span class="mut">${esc(t(`tgCmd_${command}`))}</span></label>`).join('')}
    <label class="check"><input type="checkbox" id="tgButtons"${checked(s.buttons)}> ${esc(t('tgButtons'))}</label></div>`;
  const topics = `<h3>${esc(t('tgTopics'))}</h3><p class="mut">${esc(t('tgTopicsHelp'))}</p><div class="form-grid">${choices.topics.map((topic) => field(`tgTopic_${topic}`, `<input data-tg-topic="${topic}" value="${esc(s.topics[topic] || '')}" inputmode="numeric" placeholder="—" dir="ltr">`)).join('')}</div>`;
  const preview = state.cache.telegram?.preview;
  const tpl = { style: 'classic', separator: 'heavy', direction: 'auto', icons: true, quote: 'none', custom: '', ...s.templates };
  const opt = (list, chosen, prefix) => list.map((item) => `<option value="${item}"${item === chosen ? ' selected' : ''}>${esc(t(`${prefix}${item}`))}</option>`).join('');
  const gallery = state.cache.telegram?.gallery;
  const designs = knowsDesigns(data);
  const template = `<h3>${esc(t('tgTemplate'))}</h3><p class="mut">${esc(t(designs ? 'tgDesignHelp' : 'tgDesignNeedsUpdate'))}</p><div class="form-grid">
    ${designs ? `${field('tgStyle', `<select id="tgStyle">${opt(STYLES, tpl.style, 'tgStyle_')}</select>`)}
    ${field('tgSeparator', `<select id="tgSeparator">${opt(SEPARATORS, tpl.separator, 'tgSep_')}</select>`)}
    ${field('tgDirection', `<select id="tgDirection">${opt(['auto', 'rtl', 'ltr'], tpl.direction, 'tgDir_')}</select>`)}
    ${field('tgQuote', `<select id="tgQuote">${opt(['none', 'quote', 'expandable'], tpl.quote, 'tgQuote_')}</select>`)}
    ${field('tgIcons', `<span class="row"><input type="checkbox" id="tgIcons"${checked(tpl.icons)}> ${esc(t('tgIconsHelp'))}</span>`)}
    <label class="wide" id="tgCustomRow"${tpl.style === 'custom' ? '' : ' hidden'}><span>${esc(t('tgCustom'))}</span><textarea id="tgCustom" rows="6" maxlength="1500" dir="auto" placeholder="**{icon} {kind}** · {server}&#10;> {title}&#10;> {body}&#10;>> {snapshot}&#10;{time}">${esc(tpl.custom)}</textarea>
      <span class="mut small">${esc(t('tgCustomHelp'))}</span></label>` : ''}
    ${field('tgFooter', `<input id="tgFooter" value="${esc(s.templates.footer)}" maxlength="300" placeholder="P00RIJA · {server}">`, 'wide')}
    ${field('tgShowIdentity', `<span class="row"><input type="checkbox" id="tgShowIdentity"${checked(s.templates.showIdentity)}> ${esc(t('tgShowIdentityHelp'))}</span>`)}
    ${field('tgShowSnapshot', `<span class="row"><input type="checkbox" id="tgShowSnapshot"${checked(s.templates.showSnapshot)}> ${esc(t('tgShowSnapshotHelp'))}</span>`)}
    </div><p class="mut">${esc(t('tgFooterHelp'))}</p>
    <div class="row wrap"><select id="tgPreviewCategory">${CATEGORY_ORDER.map((category) => `<option value="${category}"${preview?.category === category ? ' selected' : ''}>${esc(t(`tgCat_${category}`))}</option>`).join('')}</select>
    <button id="tgPreview">${esc(t('tgPreview'))}</button>${designs ? `<button id="tgGallery"><i class="fa-solid fa-table-cells-large"></i> ${esc(t('tgGallery'))}</button>` : ''}</div>
    <div id="tgGalleryBox">${gallery && gallery.server === server.name ? galleryHtml(gallery.cards) : ''}</div>
    ${preview && preview.server === server.name ? `${bubble(preview.html)}<p class="mut">${esc(preview.delivery ? (preview.delivery.send ? (preview.delivery.silent ? t('tgWouldSilent') : t('tgWouldSound')) : preview.delivery.hold ? t('tgWouldHold') : t('tgWouldSkip')) : '')}</p>` : ''}`;
  const tools = `<div class="row wrap"><button id="tgSave" class="acc">${esc(t('save'))}</button><button id="tgSaveAll">${esc(t('tgSaveAll'))}</button>
    <button id="tgLogButton">${esc(t('tgLog'))}</button><button id="tgReset" class="bad">${esc(t('tgReset'))}</button></div><div id="tgState" class="mut"></div>`;
  return `<div data-tg-form="${esc(server.name)}">${bot}${categories}${alerts}${quiet}${report}${commands}${topics}${template}${tools}</div>`;
}

function logTable() {
  const log = state.cache.telegram?.log;
  if (!log || log.server !== state.cache.telegram.editing) return '';
  const rows = (log.sent || []).map((entry) => `<tr><td>${esc(fmtTime(entry.at))}</td><td>${esc(t(`tgCat_${entry.category}`))}</td><td>${esc(entry.title || '')}</td>
    <td>${entry.skipped ? tag(t(`tgSkip_${entry.skipped}`), 'mut') : entry.ok ? tag(entry.silent ? t('tgSentSilent') : t('tgSent'), 'good') : tag(t('tgFailed'), 'bad')}</td></tr>`).join('');
  return card('tgLog', `<div class="scroll"><table><thead><tr><th>${esc(t('tgAt'))}</th><th>${esc(t('tgCategory'))}</th><th>${esc(t('tgTitle'))}</th><th>${esc(t('state'))}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4" class="mut">${esc(t('tgNothingSent'))}</td></tr>`}</tbody></table></div>`);
}

export function renderTelegram() {
  const cache = state.cache.telegram || {};
  const results = (cache.results || []).filter((result) => shownServers().some((server) => server.name === result.server.name));
  const editing = results.find((result) => result.server.name === cache.editing && result.ok && result.data.settings);
  /* The server that holds the token sends for everyone: with its bot off,
     no server's card reaches Telegram, though its own test used to. */
  const holdersOff = results.filter((result) => result.ok && result.data.settings && result.data.settings.token?.set && !result.data.settings.enabled);
  const banner = holdersOff.length ? `<section class="card banner bad-banner"><strong><i class="fa-solid fa-triangle-exclamation"></i> ${esc(t('tgHolderOff'))}</strong> <span>${holdersOff.map((result) => esc(result.server.name)).join('، ')}</span><p class="mut">${esc(t('tgHolderOffHelp'))}</p></section>` : '';
  const servers = banner + card('telegram', statusTable(results));
  const form = editing ? card('tgSettings', `<p class="mut">${esc(t('tgEditing'))} <strong>${esc(editing.server.name)}</strong></p>${settingsForm(editing.server, editing.data)}`)
    : card('tgSettings', `<p class="mut">${esc(t('tgNoServer'))}</p>`);
  return servers + form + logTable();
}

/* The card's design, as the form has it. An older relay, which knows only
   the footer and the two switches, is sent only those. */
function formTemplates() {
  const base = { footer: value('tgFooter'), showIdentity: isOn('tgShowIdentity'), showSnapshot: isOn('tgShowSnapshot') };
  if (!$('tgStyle')) return base;
  return { ...base, style: value('tgStyle'), separator: value('tgSeparator'), direction: value('tgDirection'), quote: value('tgQuote'), icons: isOn('tgIcons'), custom: String($('tgCustom')?.value || '') };
}
const knowsDesigns = (data) => Boolean(data?.settings?.templates && 'style' in data.settings.templates);

/* Everything in the form, as the relay takes it (telegram-settings.js). */
function formSettings() {
  const pick = (attribute, read) => Object.fromEntries([...document.querySelectorAll(`[${attribute}]`)].map((element) => [element.getAttribute(attribute), read(element)]));
  const categories = {};
  for (const [name, on] of Object.entries(pick('data-tg-cat-on', (box) => box.checked))) categories[name] = { on };
  for (const [name, silent] of Object.entries(pick('data-tg-cat-silent', (box) => box.checked))) categories[name] = { ...(categories[name] || {}), silent };
  const thresholds = pick('data-tg-th', (input) => Number(input.value));
  const admins = value('tgAdmins').split(/[\s,،]+/).filter(Boolean);
  return {
    enabled: isOn('tgEnabled'), language: value('tgLanguageField'), label: value('tgLabelField'), chatId: value('tgChatId'), timezone: value('tgZone') || 'Asia/Tehran', admins,
    categories, alertKeys: pick('data-tg-key', (box) => box.checked), thresholds,
    checkSeconds: Math.round(num(value('tgCheckSeconds'))), remindHours: num(value('tgRemindHours')), minGapSeconds: Math.round(num(value('tgMinGap'))),
    quiet: { on: isOn('tgQuietOn'), from: value('tgQuietFrom'), to: value('tgQuietTo'), mode: value('tgQuietMode'), criticalPasses: isOn('tgCriticalPasses') },
    report: { on: isOn('tgReportOn'), at: value('tgReportAt') },
    commands: pick('data-tg-cmd', (box) => box.checked), buttons: isOn('tgButtons'),
    topics: pick('data-tg-topic', (input) => String(input.value).trim()),
    templates: formTemplates(),
  };
}

const say = (text) => { if ($('tgState')) $('tgState').textContent = text; };
const reasonText = (answer) => {
  const reason = answer?.answer?.reason || answer?.reason || '';
  return reason && t(`tgBad_${reason.split('.')[0]}`) !== `tgBad_${reason.split('.')[0]}` ? `${t(`tgBad_${reason.split('.')[0]}`)} (${reason})` : explain(answer);
};

async function save(names, settings, token) {
  const results = [];
  for (const name of names) {
    const body = { settings: names.length > 1 ? { ...settings, label: undefined } : { ...settings } };
    if (body.settings.label === undefined) delete body.settings.label;
    const known = (state.cache.telegram.results || []).find((result) => result.server.name === name)?.data;
    if (!knowsDesigns(known)) body.settings.templates = { footer: settings.templates.footer, showIdentity: settings.templates.showIdentity, showSnapshot: settings.templates.showSnapshot };
    if (token !== undefined && name === state.cache.telegram.editing) body.token = token;
    const answer = await serverCall(name, 'POST', '/Monitor_Server/telegram', body);
    results.push({ name, ok: Boolean(answer.ok && answer.answer?.ok), why: answer.ok && answer.answer?.ok ? '' : reasonText(answer) });
  }
  return results;
}

export async function telegramClick(target) {
  if (state.tab !== 'telegram') return false;
  const attr = (name) => target.closest(`[${name}]`)?.getAttribute(name);
  const editing = state.cache.telegram?.editing;
  if (attr('data-tg-edit')) {
    state.cache.telegram.editing = attr('data-tg-edit');
    state.cache.telegram.preview = null;
    hooks.render();
    return true;
  }
  if (attr('data-tg-test')) {
    const name = attr('data-tg-test');
    const answer = await serverCall(name, 'POST', '/Monitor_Server/alert-test', {});
    if (!answer.answer?.ok) {
      show(`${name}: ${t('tgTestFailed')} — ${answer.answer?.reason === 'bot-off' ? t('tgTestBotOff') : explain(answer)}`);
      return true;
    }
    if (answer.answer.via !== 'relay-link') { show(`${name}: ${t('tgTestSent')} (${answer.answer.via})`); return true; }
    /* Handed to the server with the token: what that server then did with it. */
    show(`${name}: ${t('tgTestHanded')}`);
    const holders = (state.cache.telegram.results || []).filter((result) => result.ok && result.data.sends).map((result) => result.server.name);
    const since = Date.now() - 2000;
    let verdict = '';
    for (let tries = 0; tries < 8 && !verdict; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      for (const holder of holders) {
        const log = await serverCall(holder, 'GET', '/Monitor_Server/telegram/log');
        const entry = (log.answer?.sent || []).find((item) => item.at >= since && item.category === 'test');
        if (entry) verdict = entry.skipped ? `${holder}: ${t(`tgSkip_${entry.skipped}`)}` : entry.ok ? `${holder}: ${t('tgSent')}` : `${holder}: ${t('tgFailed')}`;
      }
    }
    show(`${name}: ${verdict ? `${t('tgTestThrough')} ${verdict}` : t('tgTestNoTrace')}`);
    return true;
  }
  if (target.closest('#tgGallery')) {
    const forms = formTemplates();
    const cards = [];
    for (const style of STYLES) {
      const answer = await serverCall(editing, 'POST', '/Monitor_Server/telegram/preview', { category: value('tgPreviewCategory') || 'warn', settings: { language: value('tgLanguageField'), templates: { ...forms, style, custom: style === 'custom' && !forms.custom.trim() ? '**{icon} {kind}** · {server}\n> {title}\n> {body}\n>> {snapshot}\n__{time}__' : forms.custom } } });
      if (answer.answer?.ok) cards.push([style, answer.answer.html]);
    }
    /* Drawn in place: the form keeps whatever is being edited in it. */
    state.cache.telegram.gallery = { server: editing, cards };
    if ($('tgGalleryBox')) $('tgGalleryBox').innerHTML = galleryHtml(cards); else hooks.render();
    return true;
  }
  if (attr('data-tg-use-style')) {
    if ($('tgStyle')) { $('tgStyle').value = attr('data-tg-use-style'); if ($('tgCustomRow')) $('tgCustomRow').hidden = $('tgStyle').value !== 'custom'; }
    $('tgStyle')?.scrollIntoView({ block: 'center' });
    return true;
  }
  if (attr('data-tg-chat')) {
    $('tgChatId').value = attr('data-tg-chat');
    return true;
  }
  if (attr('data-tg-mute') !== undefined && attr('data-tg-mute') !== null) {
    const seconds = num(attr('data-tg-mute'));
    const answer = await serverCall(editing, 'POST', '/Monitor_Server/telegram', { settings: { muteUntil: seconds ? Date.now() + seconds * 1000 : 0 } });
    if (!answer.answer?.ok) { say(reasonText(answer)); return true; }
    await loadTelegram();
    hooks.render();
    return true;
  }
  if (target.closest('#tgSave') || target.closest('#tgSaveAll')) {
    const all = Boolean(target.closest('#tgSaveAll'));
    const settings = formSettings();
    const typed = value('tgToken');
    const token = isOn('tgTokenRemove') ? '' : typed || undefined;
    if (token && !window.confirm(t('tgTokenConfirm'))) return true;
    const names = all ? (state.cache.telegram.results || []).filter((result) => result.ok && result.data.settings).map((result) => result.server.name) : [editing];
    if (all && !window.confirm(`${t('tgSaveAllConfirm')} (${names.join(', ')})`)) return true;
    say(t('tgSaving'));
    const results = await save(names, settings, token);
    const failed = results.filter((result) => !result.ok);
    if (failed.length) { say(failed.map((result) => `${result.name}: ${result.why}`).join(' · ')); return true; }
    await loadTelegram();
    hooks.render();
    say(t('saved'));
    return true;
  }
  if (target.closest('#tgReset')) {
    if (!window.confirm(t('tgResetConfirm'))) return true;
    const answer = await serverCall(editing, 'POST', '/Monitor_Server/telegram', { reset: true });
    if (!answer.answer?.ok) { say(reasonText(answer)); return true; }
    await loadTelegram();
    hooks.render();
    return true;
  }
  if (target.closest('#tgPreview')) {
    const category = value('tgPreviewCategory') || 'warn';
    const known = (state.cache.telegram.results || []).find((result) => result.server.name === editing)?.data;
    const answer = await serverCall(editing, 'POST', '/Monitor_Server/telegram/preview', knowsDesigns(known) ? { category, settings: { language: value('tgLanguageField'), templates: formTemplates() } } : { category });
    if (!answer.answer?.ok) { say(explain(answer)); return true; }
    state.cache.telegram.preview = { server: editing, category, html: answer.answer.html, delivery: answer.answer.delivery };
    const box = document.querySelector('.tg-preview');
    if (box) { box.innerHTML = cardPreview(answer.answer.html); return true; }
    hooks.render();
    return true;
  }
  if (target.closest('#tgLogButton')) {
    const answer = await serverCall(editing, 'GET', '/Monitor_Server/telegram/log');
    state.cache.telegram.log = { server: editing, sent: answer.answer?.sent || [] };
    hooks.render();
    return true;
  }
  return false;
}

/* The custom template's box shows only for the custom design. */
export function telegramChange(event) {
  if (event.target.id !== 'tgStyle') return false;
  if ($('tgCustomRow')) $('tgCustomRow').hidden = event.target.value !== 'custom';
  return true;
}

export const telegramSection = { id: 'telegram', title: 'telegram', load: loadTelegram, render: renderTelegram };
