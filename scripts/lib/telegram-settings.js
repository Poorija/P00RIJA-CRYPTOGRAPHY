/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The Telegram bot's settings, changed from the central panel while the relay
 * runs, kept in the relay's data folder (owner-only). .env gives the
 * defaults, as it always did; what the panel set wins.
 *
 *   language      fa or en, for everything the bot says
 *   chatId        where it sends; topics: a forum topic per kind of message
 *   categories    each kind of message on or off, with sound or silent
 *   alertKeys     each alert on or off; thresholds: when it fires
 *   checkSeconds, remindHours, minGapSeconds: how often it looks, how often
 *                 it reminds of what is still wrong, the least time between two messages
 *   quiet         hours when it is silent, or holds messages until they end
 *                 (a critical one may still come through), in `timezone`
 *   report        the daily report, on or off, and its hour
 *   commands      each command on or off; admins: other chats that may use them
 *   buttons       inline buttons on its messages (mute an hour, status)
 *   templates     the card's design (style, separator, direction, icons, quotes, the
 *                 operator's own template), the footer line, and whether a card shows
 *                 the server and its state
 *   muteUntil     a mute, set from the panel or by /mute
 *
 * The token lives in a file of its own beside this one, owner-only, and is
 * never handed out whole: the panel sees whether it is set and its last
 * characters. One removed from the panel stays removed whatever .env says. */

'use strict';

const fs = require('fs');
const { LANGUAGES } = require('./telegram-text.js');

const CATEGORIES = ['warn', 'critical', 'resolved', 'reminder', 'start', 'security', 'partner', 'update', 'test', 'peer', 'report'];
const ALERT_KEYS = ['disk', 'memory', 'relay-memory', 'files', 'turn-down', 'turn-ports', 'bandwidth', 'peer', 'peer-via'];
const STYLES = ['classic', 'boxed', 'compact', 'minimal', 'detailed', 'custom'];
const SEPARATOR_NAMES = ['heavy', 'light', 'double', 'dots', 'none'];
const COMMANDS = ['status', 'servers', 'alerts', 'updates', 'version', 'mute', 'unmute', 'help'];
const TOPICS = ['alerts', 'reports', 'security', 'updates', 'other'];
/* Which forum topic each kind of message goes to. */
const TOPIC_OF = { warn: 'alerts', critical: 'alerts', resolved: 'alerts', reminder: 'alerts', peer: 'alerts', start: 'other', partner: 'other', test: 'other', security: 'security', update: 'updates', report: 'reports' };
const THRESHOLDS = {
  diskFreePct: [10, 0, 99], diskFreeGb: [2, 0, 10000], memoryFreePct: [10, 0, 99], relayMemoryPct: [75, 1, 100], filesPct: [80, 1, 100],
  turnPct: [80, 1, 100], linkMbps: [0, 0, 100000], linkPct: [80, 1, 100], peerDownMinutes: [10, 1, 1440],
};
const TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
const CHAT = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const envNumber = (env, name, fallback) => {
  const value = Number(env[name]);
  return String(env[name] ?? '').trim() !== '' && Number.isFinite(value) ? value : fallback;
};

function defaults(env) {
  const reportAt = String(env.CHAT_STATUS_REPORT_AT ?? '09:00').trim();
  return {
    enabled: env.CHAT_ALERTS !== '0',
    language: LANGUAGES.includes(env.CHAT_TELEGRAM_LANGUAGE) ? env.CHAT_TELEGRAM_LANGUAGE : 'fa',
    label: String(env.CHAT_ALERT_LABEL || '').trim().slice(0, 60),
    chatId: CHAT.test(String(env.CHAT_ALERT_TELEGRAM_CHAT_ID || '').trim()) ? String(env.CHAT_ALERT_TELEGRAM_CHAT_ID).trim() : '',
    topics: Object.fromEntries(TOPICS.map((topic) => [topic, ''])),
    categories: Object.fromEntries(CATEGORIES.map((category) => [category, { on: true, silent: ['resolved', 'reminder', 'start', 'report'].includes(category) }])),
    alertKeys: Object.fromEntries(ALERT_KEYS.map((key) => [key, true])),
    thresholds: {
      diskFreePct: envNumber(env, 'CHAT_ALERT_DISK_FREE_PCT', 10), diskFreeGb: envNumber(env, 'CHAT_ALERT_DISK_FREE_GB', 2),
      memoryFreePct: envNumber(env, 'CHAT_ALERT_MEMORY_FREE_PCT', 10), relayMemoryPct: envNumber(env, 'CHAT_ALERT_RELAY_MEMORY_PCT', 75),
      filesPct: envNumber(env, 'CHAT_ALERT_FILES_PCT', 80), turnPct: envNumber(env, 'CHAT_ALERT_TURN_PCT', 80),
      linkMbps: envNumber(env, 'CHAT_ALERT_LINK_MBPS', 0), linkPct: envNumber(env, 'CHAT_ALERT_LINK_PCT', 80),
      peerDownMinutes: envNumber(env, 'CHAT_ALERT_PEER_DOWN_MINUTES', 10),
    },
    checkSeconds: Math.max(5, Math.round(envNumber(env, 'CHAT_ALERT_INTERVAL_MS', 60000) / 1000)),
    remindHours: Math.max(1, envNumber(env, 'CHAT_ALERT_REMIND_HOURS', 6)),
    minGapSeconds: 0,
    quiet: { on: false, from: '00:00', to: '07:00', mode: 'silent', criticalPasses: true },
    timezone: 'Asia/Tehran',
    report: { on: reportAt !== 'off' && TIME.test(reportAt || '09:00'), at: TIME.test(reportAt) ? reportAt : '09:00' },
    commands: Object.fromEntries(COMMANDS.map((command) => [command, env.CHAT_TELEGRAM_COMMANDS !== '0'])),
    admins: [],
    buttons: true,
    templates: { footer: '', showIdentity: true, showSnapshot: true, style: 'classic', separator: 'heavy', direction: 'auto', icons: true, quote: 'none', custom: '' },
    muteUntil: 0,
  };
}

const validZone = (zone) => {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format(0); return true; } catch (_error) { return false; }
};

/* The settings with `patch` laid over them, or the first thing wrong with it. */
function apply(base, patch) {
  const next = JSON.parse(JSON.stringify(base));
  const fail = (reason) => ({ ok: false, reason });
  const bool = (value) => typeof value === 'boolean';
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) return fail('not-an-object');
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'enabled' || key === 'buttons') { if (!bool(value)) return fail(key); next[key] = value; }
    else if (key === 'language') { if (!LANGUAGES.includes(value)) return fail(key); next.language = value; }
    else if (key === 'label') { if (typeof value !== 'string' || value.length > 60 || /[<>\u0000-\u001f]/.test(value)) return fail(key); next.label = value.trim(); }
    else if (key === 'chatId') { if (typeof value !== 'string' || (value && !CHAT.test(value.trim()))) return fail(key); next.chatId = value.trim(); }
    else if (key === 'topics') {
      if (!value || typeof value !== 'object') return fail(key);
      for (const [topic, id] of Object.entries(value)) { if (!TOPICS.includes(topic) || typeof id !== 'string' || (id && !/^\d{1,12}$/.test(id))) return fail(`topics.${topic}`); next.topics[topic] = id; }
    } else if (key === 'categories') {
      if (!value || typeof value !== 'object') return fail(key);
      for (const [category, flags] of Object.entries(value)) {
        if (!CATEGORIES.includes(category) || !flags || typeof flags !== 'object') return fail(`categories.${category}`);
        for (const [flag, on] of Object.entries(flags)) { if (!['on', 'silent'].includes(flag) || !bool(on)) return fail(`categories.${category}.${flag}`); next.categories[category][flag] = on; }
      }
    } else if (key === 'alertKeys' || key === 'commands') {
      const known = key === 'alertKeys' ? ALERT_KEYS : COMMANDS;
      if (!value || typeof value !== 'object') return fail(key);
      for (const [name, on] of Object.entries(value)) { if (!known.includes(name) || !bool(on)) return fail(`${key}.${name}`); next[key][name] = on; }
    } else if (key === 'thresholds') {
      if (!value || typeof value !== 'object') return fail(key);
      for (const [name, number] of Object.entries(value)) {
        const range = THRESHOLDS[name];
        if (!range || typeof number !== 'number' || !Number.isFinite(number) || number < range[1] || number > range[2]) return fail(`thresholds.${name}`);
        next.thresholds[name] = number;
      }
    } else if (key === 'checkSeconds') { if (!Number.isInteger(value) || value < 5 || value > 3600) return fail(key); next.checkSeconds = value; }
    else if (key === 'remindHours') { if (typeof value !== 'number' || value < 0.25 || value > 168) return fail(key); next.remindHours = value; }
    else if (key === 'minGapSeconds') { if (!Number.isInteger(value) || value < 0 || value > 3600) return fail(key); next.minGapSeconds = value; }
    else if (key === 'quiet') {
      if (!value || typeof value !== 'object') return fail(key);
      for (const [name, field] of Object.entries(value)) {
        if (name === 'on' || name === 'criticalPasses') { if (!bool(field)) return fail(`quiet.${name}`); }
        else if (name === 'from' || name === 'to') { if (!TIME.test(String(field))) return fail(`quiet.${name}`); }
        else if (name === 'mode') { if (!['silent', 'hold'].includes(field)) return fail('quiet.mode'); }
        else return fail(`quiet.${name}`);
        next.quiet[name] = field;
      }
    } else if (key === 'timezone') { if (typeof value !== 'string' || value.length > 60 || !validZone(value)) return fail(key); next.timezone = value; }
    else if (key === 'report') {
      if (!value || typeof value !== 'object') return fail(key);
      for (const [name, field] of Object.entries(value)) {
        if (name === 'on') { if (!bool(field)) return fail('report.on'); }
        else if (name === 'at') { if (!TIME.test(String(field))) return fail('report.at'); }
        else return fail(`report.${name}`);
        next.report[name] = field;
      }
    } else if (key === 'admins') {
      if (!Array.isArray(value) || value.length > 20 || !value.every((id) => typeof id === 'string' && /^-?\d{1,20}$/.test(id))) return fail(key);
      next.admins = [...new Set(value)];
    } else if (key === 'templates') {
      if (!value || typeof value !== 'object') return fail(key);
      for (const [name, field] of Object.entries(value)) {
        if (name === 'footer') { if (typeof field !== 'string' || field.length > 300) return fail('templates.footer'); }
        else if (name === 'showIdentity' || name === 'showSnapshot' || name === 'icons') { if (!bool(field)) return fail(`templates.${name}`); }
        else if (name === 'style') { if (!STYLES.includes(field)) return fail('templates.style'); }
        else if (name === 'separator') { if (!SEPARATOR_NAMES.includes(field)) return fail('templates.separator'); }
        else if (name === 'direction') { if (!['auto', 'rtl', 'ltr'].includes(field)) return fail('templates.direction'); }
        else if (name === 'quote') { if (!['none', 'quote', 'expandable'].includes(field)) return fail('templates.quote'); }
        else if (name === 'custom') { if (typeof field !== 'string' || field.length > 1500) return fail('templates.custom'); }
        else return fail(`templates.${name}`);
        next.templates[name] = field;
      }
    } else if (key === 'muteUntil') { if (!Number.isSafeInteger(value) || value < 0) return fail(key); next.muteUntil = value; }
    else return fail(`unknown:${key}`);
  }
  return { ok: true, settings: next };
}

function createTelegramSettings({ file, tokenFile, env = process.env }) {
  const base = defaults(env);
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_error) { saved = {}; }
  /* Only what the panel changed is kept, laid over the defaults field by
     field: a value the panel never touched still follows .env. Anything kept
     that is no longer valid is left at its default. */
  let settings = base;
  let overrides = {};
  const merge = (into, patch) => {
    for (const [key, value] of Object.entries(patch)) {
      into[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(into[key] && typeof into[key] === 'object' && !Array.isArray(into[key]) ? into[key] : {}, value) : value;
    }
    return into;
  };
  for (const [key, value] of Object.entries(saved && typeof saved === 'object' ? saved : {})) {
    const one = apply(settings, { [key]: value });
    if (one.ok) { settings = one.settings; merge(overrides, { [key]: value }); }
  }
  const write = () => {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(overrides, null, 2), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };

  function token() {
    if (fs.existsSync(tokenFile)) return fs.readFileSync(tokenFile, 'utf8').trim();
    /* .env's is the operator's own, taken as it is written; only one typed
       into the panel is held to the shape of a bot token. */
    return String(env.TELEGRAM_BOT_TOKEN || '').trim().replace(/[^\x21-\x7e]/g, '');
  }

  function setToken(value) {
    const next = String(value || '').trim();
    if (next && !TOKEN.test(next)) return { ok: false, reason: 'token' };
    fs.writeFileSync(`${tokenFile}.tmp`, next, { mode: 0o600 });
    fs.renameSync(`${tokenFile}.tmp`, tokenFile);
    return { ok: true };
  }

  /* The local day and time in the chosen zone. */
  function clock(at = Date.now()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date(at)).map((part) => [part.type, part.value]));
    return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
  }

  function quietNow(at = Date.now()) {
    if (!settings.quiet.on) return false;
    const { time } = clock(at);
    const { from, to } = settings.quiet;
    return from <= to ? time >= from && time < to : time >= from || time < to;
  }

  return {
    get: () => JSON.parse(JSON.stringify(settings)),
    update(patch) {
      const result = apply(settings, patch);
      if (!result.ok) return result;
      settings = result.settings;
      merge(overrides, JSON.parse(JSON.stringify(patch)));
      write();
      return { ok: true };
    },
    /* The settings as a patch would make them, for a preview: nothing saved. */
    tryOn(patch) { const result = apply(settings, patch); return result.ok ? { ok: true, settings: result.settings } : result; },
    token,
    setToken,
    view() {
      const current = token();
      const source = fs.existsSync(tokenFile) ? (current ? 'panel' : '') : (current ? 'env' : '');
      return { ...this.get(), token: { set: Boolean(current), hint: current ? `${current.split(':')[0]}:…${current.slice(-4)}` : '', source } };
    },
    clock,
    quietNow,
    muted: (at = Date.now()) => settings.muteUntil > at,
    mute(at, forMs) { settings.muteUntil = at + Math.max(0, Math.min(7 * 86400000, forMs)); overrides.muteUntil = settings.muteUntil; write(); },
    unmute() { settings.muteUntil = 0; overrides.muteUntil = 0; write(); },
    /* Back to .env for everything; the token is left as it is. */
    reset() { settings = defaults(env); overrides = {}; write(); },
    topicFor: (category) => settings.topics[TOPIC_OF[category] || 'other'] || '',
  };
}

module.exports = { validToken: (value) => TOKEN.test(String(value || '').trim()), createTelegramSettings, STYLES, SEPARATOR_NAMES, CATEGORIES, ALERT_KEYS, COMMANDS, TOPICS, TOPIC_OF, defaults };
