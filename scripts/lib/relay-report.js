/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What the operator reads in Telegram (docs/MONITOR-SERVER.md, "Alerts in
 * Telegram"): one card per event, naming the server it is about in full —
 * its name and address, where it is, its cluster and gateway place, its
 * version and its relay id — with the state of that server at the moment
 * the card is sent; and a summary of every server, on request (/status) and
 * once a day.
 *
 * Telegram's HTML, with every value that came from a server escaped: a card
 * relayed for another server is drawn here from fields, never from markup
 * that server wrote, and the relay id on it is the one its link proved.
 * Nothing here touches the network.
 */
'use strict';

const { textFor } = require('./telegram-text.js');

const RULE = '━━━━━━━━━━━━━━━━━━';
const LEVELS = {
  start: { icon: '🔄', fa: 'راه‌اندازی' },
  info: { icon: 'ℹ️', fa: 'گزارش' },
  test: { icon: '🔔', fa: 'آزمایش هشدار' },
  security: { icon: '🔐', fa: 'کار حساس' },
  warn: { icon: '⚠️', fa: 'هشدار' },
  critical: { icon: '🚨', fa: 'بحرانی' },
  ok: { icon: '✅', fa: 'برطرف شد' },
  partner: { icon: '🤝', fa: 'شراکت' },
  peer: { icon: '📨', fa: 'پیام رله' },
  update: { icon: '⬆️', fa: 'به‌روزرسانی' },
};
const REGIONS = { 'inside-iran': ['🇮🇷', 'داخل ایران'], 'outside-iran': ['🌍', 'خارج از ایران'] };
const HEX64 = /^[a-f0-9]{64}$/;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u2028\u2029]+/g, ' ').trim().slice(0, max);

function bytes(value) {
  const n = finite(value);
  if (n === null) return '—';
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(1)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}
const percent = (part, whole) => (finite(whole) > 0 && finite(part) !== null ? Math.round((finite(part) / finite(whole)) * 100) : null);

/* "3 روز و 4 ساعت", "5 ساعت و 12 دقیقه", "7 دقیقه" — or in English. */
function duration(seconds, lang = 'fa') {
  const s = Math.max(0, Math.floor(finite(seconds) || 0));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const words = textFor(lang).duration;
  if (days) return words.days(days, hours);
  if (hours) return words.hours(hours, minutes);
  return words.minutes(minutes);
}

/* The moment, in the operator's zone and calendar (Tehran's and the Persian
   calendar unless they chose otherwise), and in UTC. */
function when(at = Date.now(), lang = 'fa', timezone = 'Asia/Tehran') {
  const date = new Date(finite(at) || Date.now());
  let local = '';
  try {
    local = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  } catch (_error) { local = ''; }
  const utc = `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  if (!local) return utc;
  if (lang === 'fa') {
    const place = timezone === 'Asia/Tehran' ? 'تهران' : timezone;
    return `${local.replace(/,\s*/, ' ساعت ')} به وقت ${place} · ${utc}`;
  }
  return `${local.replace(/,\s*/, ' ')} (${timezone}) · ${utc}`;
}

/* ---- what a server is and how it is --------------------------------------- */

/* A report a server sends over its link, cut down to the fields and sizes
   drawn here; anything else is dropped. */
function cleanReport(raw = {}) {
  const identity = raw.identity || {};
  const snapshot = raw.snapshot || {};
  const pair = (value, keys) => (value && typeof value === 'object' ? Object.fromEntries(keys.map((key) => [key, finite(value[key])])) : null);
  return {
    level: LEVELS[raw.level] ? raw.level : 'peer',
    /* Which of the operator's categories it falls in (telegram-settings.js),
       so the relay with the bot can let it through, quietly or not at all. */
    category: /^(warn|critical|resolved|reminder|start|security|partner|update|test|peer|report)$/.test(String(raw.category || '')) ? raw.category : '',
    title: text(raw.title, 200),
    body: text(raw.body, 1500),
    at: finite(raw.at) || Date.now(),
    identity: {
      label: text(identity.label, 60),
      host: text(identity.host, 100).replace(/[^A-Za-z0-9.:-]/g, ''),
      region: REGIONS[identity.region] ? identity.region : '',
      cluster: text(identity.cluster, 40),
      gateway: Math.max(0, Math.min(99, Math.floor(finite(identity.gateway) || 0))),
      relayId: HEX64.test(String(identity.relayId || '')) ? identity.relayId : '',
      version: text(identity.version, 24).replace(/[^0-9A-Za-z.+-]/g, ''),
      build: text(identity.build, 24).replace(/[^0-9A-Za-z.+-]/g, ''),
    },
    snapshot: {
      users: finite(snapshot.users),
      queued: finite(snapshot.queued),
      mailboxes: finite(snapshot.mailboxes),
      cpu: finite(snapshot.cpu),
      memory: pair(snapshot.memory, ['used', 'total']),
      relay: pair(snapshot.relay, ['rss', 'limit']),
      disk: pair(snapshot.disk, ['used', 'total']),
      links: pair(snapshot.links, ['up', 'allowed', 'hybrid']),
      turn: snapshot.turn && typeof snapshot.turn === 'object' ? { running: snapshot.turn.running === true ? true : snapshot.turn.running === false ? false : null, used: finite(snapshot.turn.used), size: finite(snapshot.turn.size) } : null,
      uptime: finite(snapshot.uptime),
      hostUptime: finite(snapshot.hostUptime),
    },
    problems: (Array.isArray(raw.problems) ? raw.problems : []).slice(0, 8).map((problem) => ({ level: problem?.level === 'critical' ? 'critical' : 'warn', text: text(problem?.text, 300) })).filter((problem) => problem.text),
  };
}

const nameOf = (identity, lang = 'fa') => identity.label || identity.host || (identity.relayId ? identity.relayId.slice(0, 12) : textFor(lang).card.relay);
const pct = (lang) => (lang === 'fa' ? '٪' : '%');

function identityLines(identity, provenId, lang = 'fa') {
  const T = textFor(lang);
  const flag = (REGIONS[identity.region] || ['🖧'])[0];
  const region = REGIONS[identity.region] ? T.regions[identity.region] : '';
  const id = (HEX64.test(String(provenId || '')) ? provenId : identity.relayId || '').slice(0, 12);
  const place = [region, identity.cluster ? `${T.card.cluster} <b>${escapeHtml(identity.cluster)}</b>` : '', identity.gateway ? `Gateway <b>${identity.gateway}</b>` : ''].filter(Boolean).join(' · ');
  return [
    `🖥 <b>${escapeHtml(nameOf(identity, lang))}</b>${identity.host ? ` — <code>${escapeHtml(identity.host)}</code>` : ''}`,
    place ? `${flag} ${place}` : '',
    `🏷 ${T.card.version} <code>${escapeHtml(identity.version || '—')}</code>${identity.build ? ` (${escapeHtml(identity.build)})` : ''}${id ? ` · 🆔 <code>${escapeHtml(id)}</code>` : ''}`,
  ].filter(Boolean);
}

function snapshotLines(s, lang = 'fa') {
  const C = textFor(lang).card;
  const p = pct(lang);
  const lines = [];
  if (s.users !== null || s.queued !== null) {
    lines.push(`👥 ${C.users}: <b>${s.users ?? '—'}</b> · 📨 ${C.queue}: <b>${s.queued ?? '—'}</b>${s.mailboxes ? C.inBoxes(s.mailboxes) : ''}`);
  }
  const memory = s.memory && s.memory.total ? `${C.serverMemory}: <b>${bytes(s.memory.used)} / ${bytes(s.memory.total)}</b> (${percent(s.memory.used, s.memory.total)}${p})` : '';
  if (s.cpu !== null || memory) lines.push(`🧠 ${s.cpu !== null ? `${C.cpu}: <b>${Math.round(s.cpu)}${p}</b>` : ''}${s.cpu !== null && memory ? ' · ' : ''}${memory}`);
  if (s.relay && s.relay.rss) lines.push(`🧩 ${C.relayMemory}: <b>${bytes(s.relay.rss)}</b>${s.relay.limit ? ` ${C.of} ${bytes(s.relay.limit)} (${percent(s.relay.rss, s.relay.limit)}${p})` : ''}`);
  if (s.disk && s.disk.total) lines.push(`💽 ${C.disk}: <b>${bytes(s.disk.used)} / ${bytes(s.disk.total)}</b> (${percent(s.disk.used, s.disk.total)}${p})`);
  if (s.links && s.links.allowed !== null) lines.push(`🔗 ${C.links}: <b>${s.links.up ?? 0} / ${s.links.allowed}</b>${s.links.hybrid ? ` · post-quantum <b>${s.links.hybrid}</b>` : ''}`);
  if (s.turn) lines.push(`📞 TURN: <b>${s.turn.running === false ? C.turnOff : s.turn.running ? C.turnOn : C.turnUnknown}</b>${s.turn.used !== null && s.turn.size ? ` · ${s.turn.used} / ${s.turn.size} ${C.ports}` : ''}`);
  if (s.uptime !== null) lines.push(`⏱ ${C.relayUp}: <b>${duration(s.uptime, lang)}</b>${s.hostUptime !== null ? ` · ${C.serverUp} ${duration(s.hostUptime, lang)}` : ''}`);
  return lines;
}

/* The operator's footer line, its placeholders filled and every value
   escaped: what the panel typed is text, never markup. */
function footerLine(template, values) {
  return escapeHtml(String(template || '').replace(/\{(server|host|level|time)\}/g, (_match, key) => String(values[key] ?? '')).slice(0, 300));
}

/* ---- the card's design ------------------------------------------------------
   Telegram draws a bot's message itself: no colours, corners or transparency
   can be set by a bot. What a card can use is Telegram's own HTML — bold,
   italic, code, spoilers, and a quote, which Telegram draws as a tinted box
   with a coloured edge and rounded corners (and can fold, "expandable"). The
   designs below are made of those. Every line starts with a direction mark,
   so a Persian card reads right to left and an English one left to right in
   every Telegram, whatever a line begins with (an address, a number). */
const STYLES = ['classic', 'boxed', 'compact', 'minimal', 'detailed', 'custom'];
const SEPARATORS = { heavy: '━━━━━━━━━━━━━━━━━━', light: '──────────────────', double: '══════════════════', dots: '• • • • • • • • • •', none: '' };
const MAX_CARD = 3900;
const RLM = '‏';
const LRM = '‎';
/* An emoji (or a flag) at a line's start, after an opening <b> if there is one. */
const LEADING_ICON = /^((?:<b>)?)(?:(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic})[️‍\p{Extended_Pictographic}]*\s*)+/u;

/* The operator's own design: their text escaped, a few marks turned into
   Telegram's markup (**bold**, __italic__, ~~struck~~, `code`, ||spoiler||,
   a line starting "> " quoted, ">> " quoted and folded), then the
   placeholders filled with parts already safe. */
function customCard(template, parts) {
  const quoteKind = (line) => (line.startsWith('&gt;&gt; ') ? 'fold' : line.startsWith('&gt; ') ? 'quote' : '');
  const lines = escapeHtml(String(template || '')).split('\n').map((line) => line
    .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+?)__/g, '<i>$1</i>').replace(/~~([^~\n]+?)~~/g, '<s>$1</s>')
    .replace(/`([^`\n]+?)`/g, '<code>$1</code>').replace(/\|\|([^|\n]+?)\|\|/g, '<tg-spoiler>$1</tg-spoiler>'));
  const out = [];
  let open = '';
  for (const line of lines) {
    const kind = quoteKind(line);
    if (kind !== open) {
      if (open) out.push('</blockquote>');
      if (kind) out.push(kind === 'fold' ? '<blockquote expandable>' : '<blockquote>');
      open = kind;
    }
    out.push(kind === 'fold' ? line.slice(9) : kind === 'quote' ? line.slice(5) : line);
  }
  if (open) out.push('</blockquote>');
  return out.join('\n').replace(/\{([a-z]+)\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(parts, key) ? parts[key] : match))
    .replace(/<blockquote( expandable)?>\n/g, '<blockquote$1>').replace(/\n<\/blockquote>/g, '</blockquote>');
}

/* One event, about one server; in the operator's language and design, with
   their footer and as much of the server and its state as they chose. */
function renderCard({
  level = 'info', title = '', body = '', identity = {}, snapshot = null, at = Date.now(), provenId = '', lang = 'fa', timezone = 'Asia/Tehran',
  footer = '', showIdentity = true, showSnapshot = true, style = 'classic', separator = 'heavy', direction = 'auto', icons = true, quote = 'none', custom = '',
} = {}) {
  const T = textFor(lang);
  const kind = LEVELS[level] || LEVELS.info;
  const label = lang === 'fa' ? kind.fa : (T.kinds[level] || T.kinds.info);
  const design = STYLES.includes(style) ? style : 'classic';
  const rule = SEPARATORS[separator] ?? SEPARATORS.heavy;
  const rtl = direction === 'rtl' || (direction !== 'ltr' && lang === 'fa');
  const time = when(at, lang, timezone);
  const server = nameOf(identity, lang);
  const draw = (bodyText) => {
    const message = [title ? `📝 <b>${escapeHtml(title)}</b>` : '', bodyText ? escapeHtml(bodyText) : ''].filter(Boolean);
    const identityPart = showIdentity || design === 'detailed' ? identityLines(identity, provenId, lang) : [];
    const state = snapshot && (showSnapshot || design === 'detailed') ? snapshotLines(snapshot, lang) : [];
    const foot = footer ? footerLine(footer, { server, host: identity.host || '', level: label, time }) : '';
    const header = `<b>${kind.icon} ${label} · ${escapeHtml(server)}</b>`;
    const wrap = (lines, how) => (!lines.length ? [] : how === 'expandable' ? [`<blockquote expandable>${lines.join('\n')}</blockquote>`] : how === 'quote' ? [`<blockquote>${lines.join('\n')}</blockquote>`] : lines);
    let lines;
    if (design === 'custom' && String(custom || '').trim()) {
      const s_ = snapshot || {};
      const p = pct(lang);
      lines = customCard(custom, {
        icon: kind.icon, kind: escapeHtml(label), server: escapeHtml(server), host: escapeHtml(identity.host || ''), title: escapeHtml(title), body: escapeHtml(bodyText || ''),
        message: message.join('\n'), identity: identityPart.join('\n'), snapshot: state.join('\n'), time: escapeHtml(time), version: escapeHtml(identity.version || ''),
        cluster: escapeHtml(identity.cluster || ''), region: escapeHtml(REGIONS[identity.region] ? T.regions[identity.region] : ''), rule,
        users: s_.users ?? '—', queue: s_.queued ?? '—', cpu: s_.cpu != null ? `${Math.round(s_.cpu)}${p}` : '—',
        memory: s_.memory && s_.memory.total ? `${percent(s_.memory.used, s_.memory.total)}${p}` : '—', disk: s_.disk && s_.disk.total ? `${percent(s_.disk.used, s_.disk.total)}${p}` : '—',
        links: s_.links ? `${s_.links.up ?? 0}/${s_.links.allowed ?? 0}` : '—', footer: foot,
      }).split('\n');
    } else if (design === 'compact') {
      const s_ = snapshot || {};
      const p = pct(lang);
      const facts = state.length ? [s_.users != null ? `👥 ${s_.users}` : '', s_.cpu != null ? `🧠 ${Math.round(s_.cpu)}${p}` : '', s_.disk && s_.disk.total ? `💽 ${percent(s_.disk.used, s_.disk.total)}${p}` : '', s_.links ? `🔗 ${s_.links.up ?? 0}/${s_.links.allowed ?? 0}` : ''].filter(Boolean).join(' · ') : '';
      lines = [header, [title ? `<b>${escapeHtml(title)}</b>` : '', bodyText ? escapeHtml(bodyText) : ''].filter(Boolean).join(' — '), facts, `🕒 ${escapeHtml(time)}${foot ? ` · ${foot}` : ''}`];
    } else if (design === 'minimal') {
      lines = [`${kind.icon} <b>${escapeHtml(server)}</b>${title ? ` · ${escapeHtml(title)}` : ''}`, bodyText ? escapeHtml(bodyText) : '', `<i>${escapeHtml(time)}</i>`, foot];
    } else if (design === 'boxed') {
      lines = [header, ...wrap([...identityPart, ...(identityPart.length && message.length ? [''] : []), ...message], 'quote'),
        ...(state.length ? [`📊 <b>${T.card.stateOfMoment}</b>`, ...wrap(state, quote === 'none' ? 'expandable' : quote)] : []), `🕒 ${escapeHtml(time)}`, foot];
    } else {
      lines = [header, rule, ...identityPart];
      if (message.length) lines.push('', ...message);
      if (state.length) lines.push('', `📊 <b>${T.card.stateOfMoment}</b>`, ...wrap(state, quote));
      lines.push(rule, `🕒 ${escapeHtml(time)}`, foot);
    }
    const mark = rtl ? RLM : LRM;
    return lines.filter((line) => line !== undefined && line !== null).join('\n').split('\n')
      .map((line) => {
        const open = /^<blockquote(?: expandable)?>/.exec(line)?.[0] || '';
        let rest = line.slice(open.length);
        if (!icons) rest = rest.replace(LEADING_ICON, '$1');
        return rest || open ? `${open}${rest && !rest.startsWith('</blockquote>') ? mark : ''}${rest}` : '';
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };
  /* Never cut through markup: a card too long for Telegram shortens its
     message, then drops the server's state, then the message itself. */
  let bodyText = String(body || '');
  let html = draw(bodyText);
  while (html.length > MAX_CARD && bodyText.length > 40) {
    bodyText = `${bodyText.slice(0, Math.max(40, bodyText.length - (html.length - MAX_CARD) - 20))}…`;
    html = draw(bodyText);
  }
  if (html.length > MAX_CARD) html = renderCard({ level, title, body: bodyText, identity, at, provenId, lang, timezone, footer, showIdentity, showSnapshot: false, style: design === 'custom' ? 'classic' : design, separator, direction, icons, quote });
  return html.length > MAX_CARD ? `<b>${kind.icon} ${label} · ${escapeHtml(server.slice(0, 60))}</b>\n${escapeHtml(String(title).slice(0, 200))}` : html;
}

/* Whole lines kept while they fit: a long list loses its last servers, never
   half a tag (Telegram refuses a card with broken markup). */
function fitLines(lines, lang = 'fa', max = MAX_CARD) {
  const out = [];
  let size = 0;
  const mark = lang === 'fa' ? RLM : LRM;
  for (const raw of lines) {
    const line = raw ? `${mark}${raw}` : raw;
    if (size + line.length + 1 > max - 2) { out.push('…'); break; }
    out.push(line);
    size += line.length + 1;
  }
  return out.join('\n');
}

/* Every server: the ones that answered with their state, the ones that did
   not by name. entries: [{ report (cleaned), provenId, answered }] */
function renderFleet({ entries = [], at = Date.now(), title = '', lang = 'fa', timezone = 'Asia/Tehran' } = {}) {
  const T = textFor(lang);
  const p = pct(lang);
  const answered = entries.filter((entry) => entry.answered).length;
  const groups = new Map();
  for (const entry of entries) {
    const identity = entry.report.identity;
    const cluster = identity.cluster || (REGIONS[identity.region] ? T.regions[identity.region] : T.regions.none);
    if (!groups.has(cluster)) groups.set(cluster, []);
    groups.get(cluster).push(entry);
  }
  const lines = [`<b>📡 ${escapeHtml(title || T.fleet.title)}</b>${T.fleet.counts(entries.length, answered)}`, RULE];
  for (const [cluster, members] of groups) {
    const flag = (REGIONS[members[0].report.identity.region] || ['🖧'])[0];
    const up = (entry) => entry.report.snapshot.links;
    const allLinked = members.every((entry) => entry.answered && up(entry) && up(entry).up === up(entry).allowed);
    lines.push(`<b>${flag} ${T.fleet.cluster} ${escapeHtml(cluster)}</b>${allLinked ? T.fleet.allLinked : ''}`);
    for (const entry of members) {
      const { identity, snapshot, problems } = entry.report;
      const name = `<b>${escapeHtml(nameOf(identity, lang))}</b>${identity.host ? ` · <code>${escapeHtml(identity.host)}</code>` : ''}`;
      if (!entry.answered) {
        lines.push(`⛔️ ${name} · ${T.fleet.noAnswer}`);
        continue;
      }
      const worst = problems.some((problem) => problem.level === 'critical') ? '🔴' : problems.length ? '🟡' : '🟢';
      const facts = [
        identity.version ? `<code>${escapeHtml(identity.version)}</code>` : '',
        snapshot.users !== null ? `👥 ${snapshot.users}` : '',
        snapshot.links ? `🔗 ${snapshot.links.up ?? 0}/${snapshot.links.allowed ?? 0}` : '',
        snapshot.cpu !== null ? `🧠 ${Math.round(snapshot.cpu)}${p}` : '',
        snapshot.memory && snapshot.memory.total ? `🧮 ${percent(snapshot.memory.used, snapshot.memory.total)}${p}` : '',
        snapshot.disk && snapshot.disk.total ? `💽 ${percent(snapshot.disk.used, snapshot.disk.total)}${p}` : '',
        snapshot.turn ? `📞 ${snapshot.turn.running === false ? T.card.turnOff : T.card.turnOn}` : '',
        snapshot.uptime !== null ? `⏱ ${duration(snapshot.uptime, lang)}` : '',
      ].filter(Boolean).join(' · ');
      lines.push(`${worst} ${name}`, `      ${facts}`);
      for (const problem of problems.slice(0, 2)) lines.push(`      ${problem.level === 'critical' ? '🚨' : '⚠️'} ${escapeHtml(problem.text)}`);
    }
    lines.push('');
  }
  lines.push(RULE, `🕒 ${escapeHtml(when(at, lang, timezone))}`);
  return fitLines(lines, lang);
}

/* Every server by name and place: what /servers answers. */
function renderServers({ entries = [], at = Date.now(), lang = 'fa', timezone = 'Asia/Tehran' } = {}) {
  const T = textFor(lang);
  const lines = [`<b>🗂 ${T.fleet.serversTitle}</b>${T.fleet.serversCount(entries.length)}`, RULE];
  entries.forEach((entry, index) => {
    if (index) lines.push('');
    lines.push(...identityLines(entry.report.identity, entry.provenId, lang).map((line, at_) => (at_ ? `   ${line}` : `${entry.answered ? '🟢' : '⛔️'} ${line.replace(/^🖥 /, '')}`)));
  });
  lines.push(RULE, `🕒 ${escapeHtml(when(at, lang, timezone))}`);
  return fitLines(lines, lang);
}

/* What the bot does, for /help and /start: the commands it has on. */
function renderHelp({ label = '', lang = 'fa', commands = ['status', 'servers', 'help'] } = {}) {
  const T = textFor(lang);
  return [
    `<b>🤖 ${T.help.title}</b>`,
    RULE,
    label ? T.help.from(escapeHtml(label)) : '',
    '',
    ...commands.filter((command) => T.commands[command]).map((command) => `<b>/${command}</b> — ${command === 'help' && lang === 'fa' ? 'همین راهنما' : T.commands[command]}`),
    '',
    T.help.tail,
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
}

/* The same card without markup, for a Telegram that refused the HTML. */
const plainText = (html) => String(html).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

module.exports = { LEVELS, STYLES, SEPARATORS, escapeHtml, duration, when, cleanReport, renderCard, renderFleet, renderServers, renderHelp, plainText };
