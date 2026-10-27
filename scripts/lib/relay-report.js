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

/* "3 روز و 4 ساعت", "5 ساعت و 12 دقیقه", "7 دقیقه" */
function duration(seconds) {
  const s = Math.max(0, Math.floor(finite(seconds) || 0));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days) return `${days} روز${hours ? ` و ${hours} ساعت` : ''}`;
  if (hours) return `${hours} ساعت${minutes ? ` و ${minutes} دقیقه` : ''}`;
  return `${minutes} دقیقه`;
}

/* The moment, in Tehran's calendar and time, and in UTC. */
function when(at = Date.now()) {
  const date = new Date(finite(at) || Date.now());
  let tehran = '';
  try {
    tehran = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  } catch (_error) { tehran = ''; }
  const utc = `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return tehran ? `${tehran.replace(/,\s*/, ' ساعت ')} به وقت تهران · ${utc}` : utc;
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

const nameOf = (identity) => identity.label || identity.host || (identity.relayId ? identity.relayId.slice(0, 12) : 'رله');

function identityLines(identity, provenId) {
  const [flag, region] = REGIONS[identity.region] || ['🖧', ''];
  const id = (HEX64.test(String(provenId || '')) ? provenId : identity.relayId || '').slice(0, 12);
  const place = [region, identity.cluster ? `خوشهٔ <b>${escapeHtml(identity.cluster)}</b>` : '', identity.gateway ? `Gateway <b>${identity.gateway}</b>` : ''].filter(Boolean).join(' · ');
  return [
    `🖥 <b>${escapeHtml(nameOf(identity))}</b>${identity.host ? ` — <code>${escapeHtml(identity.host)}</code>` : ''}`,
    place ? `${flag} ${place}` : '',
    `🏷 نسخهٔ <code>${escapeHtml(identity.version || '—')}</code>${identity.build ? ` (${escapeHtml(identity.build)})` : ''}${id ? ` · 🆔 <code>${escapeHtml(id)}</code>` : ''}`,
  ].filter(Boolean);
}

function snapshotLines(s) {
  const lines = [];
  if (s.users !== null || s.queued !== null) {
    lines.push(`👥 کاربران آنلاین: <b>${s.users ?? '—'}</b> · 📨 صف آفلاین: <b>${s.queued ?? '—'}</b>${s.mailboxes ? ` در ${s.mailboxes} صندوق` : ''}`);
  }
  const memory = s.memory && s.memory.total ? `حافظهٔ سرور: <b>${bytes(s.memory.used)} / ${bytes(s.memory.total)}</b> (${percent(s.memory.used, s.memory.total)}٪)` : '';
  if (s.cpu !== null || memory) lines.push(`🧠 ${s.cpu !== null ? `پردازنده: <b>${Math.round(s.cpu)}٪</b>` : ''}${s.cpu !== null && memory ? ' · ' : ''}${memory}`);
  if (s.relay && s.relay.rss) lines.push(`🧩 حافظهٔ رله: <b>${bytes(s.relay.rss)}</b>${s.relay.limit ? ` از ${bytes(s.relay.limit)} (${percent(s.relay.rss, s.relay.limit)}٪)` : ''}`);
  if (s.disk && s.disk.total) lines.push(`💽 دیسک: <b>${bytes(s.disk.used)} / ${bytes(s.disk.total)}</b> (${percent(s.disk.used, s.disk.total)}٪)`);
  if (s.links && s.links.allowed !== null) lines.push(`🔗 لینک رله‌ها: <b>${s.links.up ?? 0} / ${s.links.allowed}</b>${s.links.hybrid ? ` · post-quantum <b>${s.links.hybrid}</b>` : ''}`);
  if (s.turn) lines.push(`📞 TURN: <b>${s.turn.running === false ? 'خاموش' : s.turn.running ? 'روشن' : 'نامعلوم'}</b>${s.turn.used !== null && s.turn.size ? ` · ${s.turn.used} / ${s.turn.size} پورت` : ''}`);
  if (s.uptime !== null) lines.push(`⏱ رله روشن از: <b>${duration(s.uptime)}</b>${s.hostUptime !== null ? ` · سرور از ${duration(s.hostUptime)}` : ''}`);
  return lines;
}

/* One event, about one server. */
function renderCard({ level = 'info', title = '', body = '', identity = {}, snapshot = null, at = Date.now(), provenId = '' } = {}) {
  const kind = LEVELS[level] || LEVELS.info;
  const lines = [
    `<b>${kind.icon} ${kind.fa} · ${escapeHtml(nameOf(identity))}</b>`,
    RULE,
    ...identityLines(identity, provenId),
  ];
  if (title || body) {
    lines.push('');
    if (title) lines.push(`📝 <b>${escapeHtml(title)}</b>`);
    if (body) lines.push(escapeHtml(body));
  }
  const state = snapshot ? snapshotLines(snapshot) : [];
  if (state.length) lines.push('', '📊 <b>وضعیت همین لحظه</b>', ...state);
  lines.push(RULE, `🕒 ${escapeHtml(when(at))}`);
  return lines.join('\n').slice(0, 4000);
}

/* Every server: the ones that answered with their state, the ones that did
   not by name. entries: [{ report (cleaned), provenId, answered }] */
function renderFleet({ entries = [], at = Date.now(), title = 'وضعیت سرورها' } = {}) {
  const answered = entries.filter((entry) => entry.answered).length;
  const groups = new Map();
  for (const entry of entries) {
    const identity = entry.report.identity;
    const cluster = identity.cluster || (REGIONS[identity.region] || ['', 'بی‌خوشه'])[1];
    if (!groups.has(cluster)) groups.set(cluster, []);
    groups.get(cluster).push(entry);
  }
  const lines = [`<b>📡 ${escapeHtml(title)}</b> · ${entries.length} سرور · ${answered} پاسخ داد`, RULE];
  for (const [cluster, members] of groups) {
    const flag = (REGIONS[members[0].report.identity.region] || ['🖧'])[0];
    const up = (entry) => entry.report.snapshot.links;
    const allLinked = members.every((entry) => entry.answered && up(entry) && up(entry).up === up(entry).allowed);
    lines.push(`<b>${flag} خوشهٔ ${escapeHtml(cluster)}</b>${allLinked ? ' · همهٔ لینک‌ها برقرار ✅' : ''}`);
    for (const entry of members) {
      const { identity, snapshot, problems } = entry.report;
      const name = `<b>${escapeHtml(nameOf(identity))}</b>${identity.host ? ` · <code>${escapeHtml(identity.host)}</code>` : ''}`;
      if (!entry.answered) {
        lines.push(`⛔️ ${name} · پاسخ نداد`);
        continue;
      }
      const worst = problems.some((problem) => problem.level === 'critical') ? '🔴' : problems.length ? '🟡' : '🟢';
      const facts = [
        identity.version ? `<code>${escapeHtml(identity.version)}</code>` : '',
        snapshot.users !== null ? `👥 ${snapshot.users}` : '',
        snapshot.links ? `🔗 ${snapshot.links.up ?? 0}/${snapshot.links.allowed ?? 0}` : '',
        snapshot.cpu !== null ? `🧠 ${Math.round(snapshot.cpu)}٪` : '',
        snapshot.memory && snapshot.memory.total ? `🧮 ${percent(snapshot.memory.used, snapshot.memory.total)}٪` : '',
        snapshot.disk && snapshot.disk.total ? `💽 ${percent(snapshot.disk.used, snapshot.disk.total)}٪` : '',
        snapshot.turn ? `📞 ${snapshot.turn.running === false ? 'خاموش' : 'روشن'}` : '',
        snapshot.uptime !== null ? `⏱ ${duration(snapshot.uptime)}` : '',
      ].filter(Boolean).join(' · ');
      lines.push(`${worst} ${name}`, `      ${facts}`);
      for (const problem of problems.slice(0, 2)) lines.push(`      ${problem.level === 'critical' ? '🚨' : '⚠️'} ${escapeHtml(problem.text)}`);
    }
    lines.push('');
  }
  lines.push(RULE, `🕒 ${escapeHtml(when(at))}`);
  return lines.join('\n').slice(0, 4000);
}

/* Every server by name and place: what /servers answers. */
function renderServers({ entries = [], at = Date.now() } = {}) {
  const lines = [`<b>🗂 سرورهای این خانواده</b> · ${entries.length} سرور`, RULE];
  entries.forEach((entry, index) => {
    if (index) lines.push('');
    lines.push(...identityLines(entry.report.identity, entry.provenId).map((line, at_) => (at_ ? `   ${line}` : `${entry.answered ? '🟢' : '⛔️'} ${line.replace(/^🖥 /, '')}`)));
  });
  lines.push(RULE, `🕒 ${escapeHtml(when(at))}`);
  return lines.join('\n').slice(0, 4000);
}

/* What the bot does, for /help and /start. */
function renderHelp({ label = '' } = {}) {
  return [
    '<b>🤖 ربات پایش سرورهای P00RIJA</b>',
    RULE,
    label ? `این ربات از <b>${escapeHtml(label)}</b> پیام می‌فرستد و هشدار همهٔ سرورهای خانواده را می‌رساند.` : '',
    '',
    '<b>/status</b> — وضعیت همهٔ سرورها، همین لحظه',
    '<b>/servers</b> — فهرست سرورها با نام، نشانی، خوشه و نسخه',
    '<b>/help</b> — همین راهنما',
    '',
    'هشدارها خودشان می‌آیند: دیسک، حافظه، TURN، قطع لینک رله‌ها، کارهای حساس، شراکت‌ها، و راه‌اندازی هر سرور. هر روز هم یک گزارش از همه.',
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
}

/* The same card without markup, for a Telegram that refused the HTML. */
const plainText = (html) => String(html).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

module.exports = { LEVELS, escapeHtml, duration, when, cleanReport, renderCard, renderFleet, renderServers, renderHelp, plainText };
