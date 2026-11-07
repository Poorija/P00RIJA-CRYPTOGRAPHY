/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Telling the operator, somewhere other than the server, that it is running
 * out of something.
 *
 * The relay already refuses new sockets before files or memory run out, and
 * the dashboard shows the numbers — to whoever happens to be looking. Nobody
 * is, at three in the morning, when the disk fills and mailbox writes start to
 * fail. So once a minute the relay reads what it can about the machine and
 * sends a Telegram message when something crosses a line:
 *
 *   - the disk its data lives on, and the machine's memory;
 *   - its own memory against its container's ceiling, and its open files;
 *   - TURN: how many of coturn's relay ports are taken, whether coturn is
 *     running at all, and (when the link speed is given) the bandwidth;
 *   - a linked relay that has been unreachable for ten minutes — a relay that
 *     has died cannot say so itself.
 *
 * A relay with no way to Telegram (the one in Iran) hands its messages over
 * the transit link it already has, which is authenticated and encrypted, and
 * the relay at the other end sends them on.
 *
 * One message when a problem starts, another if it gets worse, a reminder
 * every few hours while it lasts, and one when it is over — never one a
 * minute. The chat relay and coturn share the host network, so /proc/net here
 * is the machine's own.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const { textFor } = require('./telegram-text.js');

const GiB = 1024 ** 3;
const LEVELS = { warn: 1, critical: 2 };

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && String(process.env[name] ?? '').trim() !== '' ? value : fallback;
}

/* What the operator can tune, read once at start. */
function alertThresholds() {
  return {
    diskFreePct: numberEnv('CHAT_ALERT_DISK_FREE_PCT', 10),
    diskFreeBytes: numberEnv('CHAT_ALERT_DISK_FREE_GB', 2) * GiB,
    memoryFreePct: numberEnv('CHAT_ALERT_MEMORY_FREE_PCT', 10),
    relayMemoryPct: numberEnv('CHAT_ALERT_RELAY_MEMORY_PCT', 75),
    filesPct: numberEnv('CHAT_ALERT_FILES_PCT', 80),
    turnPct: numberEnv('CHAT_ALERT_TURN_PCT', 80),
    linkMbps: numberEnv('CHAT_ALERT_LINK_MBPS', 0),
    linkPct: numberEnv('CHAT_ALERT_LINK_PCT', 80),
    peerDownMs: numberEnv('CHAT_ALERT_PEER_DOWN_MINUTES', 10) * 60000,
  };
}

const formatBytes = (bytes) => (bytes >= GiB ? `${(bytes / GiB).toFixed(1)} GB` : `${Math.round(bytes / 1048576)} MB`);
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/* ---- readings ------------------------------------------------------------ */

function readMeminfo(text = null) {
  try {
    const source = text ?? fs.readFileSync('/proc/meminfo', 'utf8');
    const kb = (key) => Number((new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(source) || [])[1] || 0) * 1024;
    const total = kb('MemTotal');
    return total ? { total, available: kb('MemAvailable') } : null;
  } catch (_error) {
    return null;
  }
}

/* UDP sockets bound inside coturn's relay range: one per allocation. */
function countPortsInRange(texts, min, max) {
  let count = 0;
  for (const text of texts) {
    for (const line of String(text || '').split('\n').slice(1)) {
      const local = line.trim().split(/\s+/)[1];
      if (!local || !local.includes(':')) continue;
      const port = parseInt(local.split(':').pop(), 16);
      if (port >= min && port <= max) count += 1;
    }
  }
  return count;
}
function turnPortsInUse(min, max) {
  const texts = [];
  for (const file of ['/proc/net/udp', '/proc/net/udp6']) {
    try { texts.push(fs.readFileSync(file, 'utf8')); } catch (_error) { /* not Linux, or no IPv6 */ }
  }
  return texts.length ? countPortsInRange(texts, min, max) : null;
}

/* Bytes in and out of the machine's real interfaces: loopback and Docker's
   bridges and veth pairs would count the same traffic twice. */
function networkBytes(text = null) {
  try {
    const source = text ?? fs.readFileSync('/proc/net/dev', 'utf8');
    let total = 0;
    for (const line of source.split('\n').slice(2)) {
      const [name, rest] = line.split(':');
      if (!rest) continue;
      if (/^(lo|docker|br-|veth|virbr|tun|wg)/.test(name.trim())) continue;
      const fields = rest.trim().split(/\s+/).map(Number);
      total += (fields[0] || 0) + (fields[8] || 0);
    }
    return total;
  } catch (_error) {
    return null;
  }
}

/* ---- what is wrong ------------------------------------------------------- */

/* Readings in, problems out: { key, level, text } each, in the operator's
   language (Persian unless the panel chose another) — they read them on a
   phone. `keys` turns a kind of alert off: { bandwidth: false } and the
   bandwidth is never reported. */
function evaluate(reading, limits, lang = 'fa', keys = {}) {
  const say = textFor(lang).alert;
  const found = [];
  const add = (key, level, kind, params = {}) => {
    if (keys[kind] === false) return;
    found.push({ key, level, text: say[kind](params) });
  };
  const { disk, memory, relay, files, turn, network, peersDown } = reading;
  if (disk && disk.total) {
    const freePct = (disk.free / disk.total) * 100;
    if (freePct < limits.diskFreePct || disk.free < limits.diskFreeBytes) {
      const critical = freePct < limits.diskFreePct / 2 || disk.free < limits.diskFreeBytes / 2;
      add('disk', critical ? 'critical' : 'warn', 'disk', { free: formatBytes(disk.free), total: formatBytes(disk.total), pct: Math.round(freePct) });
    }
  }
  if (memory && memory.total) {
    const freePct = (memory.available / memory.total) * 100;
    if (freePct < limits.memoryFreePct) {
      add('memory', freePct < limits.memoryFreePct / 2 ? 'critical' : 'warn', 'memory', { free: formatBytes(memory.available), total: formatBytes(memory.total), pct: Math.round(freePct) });
    }
  }
  if (relay && relay.limit && percent(relay.rss, relay.limit) >= limits.relayMemoryPct) {
    add('relay-memory', 'warn', 'relay-memory', { pct: percent(relay.rss, relay.limit), used: formatBytes(relay.rss), limit: formatBytes(relay.limit) });
  }
  if (files && files.limit && percent(files.open, files.limit) >= limits.filesPct) {
    add('files', 'warn', 'files', { pct: percent(files.open, files.limit), open: files.open, limit: files.limit });
  }
  if (turn) {
    if (turn.running === false) add('turn-down', 'critical', 'turn-down');
    if (Number.isFinite(turn.used) && turn.size > 0 && percent(turn.used, turn.size) >= limits.turnPct) {
      const pct = percent(turn.used, turn.size);
      add('turn-ports', pct >= 95 ? 'critical' : 'warn', 'turn-ports', { used: turn.used, size: turn.size, pct });
    }
  }
  if (network && limits.linkMbps > 0 && Number.isFinite(network.mbps) && network.mbps >= (limits.linkMbps * limits.linkPct) / 100) {
    add('bandwidth', network.mbps >= limits.linkMbps * 0.95 ? 'critical' : 'warn', 'bandwidth', { mbps: Math.round(network.mbps), pct: percent(network.mbps, limits.linkMbps), link: limits.linkMbps });
  }
  for (const peer of peersDown || []) {
    const who = `${peer.name ? (lang === 'fa' ? `«${peer.name}» ` : `“${peer.name}” `) : ''}(${peer.id.slice(0, 12)})`;
    const minutes = Math.round(peer.forMs / 60000);
    /* Reached through another member of the family: nothing is cut off, but
       the direct path is closed and the operator should know it. */
    if (peer.via) {
      add(`peer-via:${peer.id}`, 'warn', 'peer-via', { who, minutes, via: peer.via });
      continue;
    }
    add(`peer:${peer.id}`, 'critical', 'peer', { who, minutes });
  }
  return found;
}

/* The limits evaluate() works to, from the panel's thresholds
   (scripts/lib/telegram-settings.js): gigabytes and minutes as they are
   typed, bytes and milliseconds as they are measured. */
function limitsFrom(thresholds) {
  return {
    diskFreePct: thresholds.diskFreePct,
    diskFreeBytes: thresholds.diskFreeGb * GiB,
    memoryFreePct: thresholds.memoryFreePct,
    relayMemoryPct: thresholds.relayMemoryPct,
    filesPct: thresholds.filesPct,
    turnPct: thresholds.turnPct,
    linkMbps: thresholds.linkMbps,
    linkPct: thresholds.linkPct,
    peerDownMs: thresholds.peerDownMinutes * 60000,
  };
}

/* ---- when to say so ------------------------------------------------------ */

/* Problems in, messages out ({ key, level, text }; level "ok" when one is
   over). A problem is announced when it starts or gets worse, reminded about
   every remindMs while it lasts, and announced over once it has been absent
   for two checks in a row — one reading under the line on a disk hovering at
   it would otherwise be a message a minute. */
function createAlertState({ label, remindMs = 6 * 3600000, now = Date.now }) {
  const remindAfter = () => (typeof remindMs === 'function' ? remindMs() : remindMs);
  const active = new Map();
  return {
    update(found) {
      const messages = [];
      const seen = new Set();
      for (const problem of found) {
        seen.add(problem.key);
        const previous = active.get(problem.key);
        const worse = previous && LEVELS[problem.level] > LEVELS[previous.level];
        const due = previous && now() - previous.notifiedAt >= remindAfter();
        if (!previous || worse || due) {
          messages.push({ key: problem.key, level: problem.level, text: problem.text, reminder: Boolean(due && !worse) });
          active.set(problem.key, { ...problem, since: previous?.since || now(), notifiedAt: now(), clear: 0 });
        } else {
          active.set(problem.key, { ...previous, text: problem.text, clear: 0 });
        }
      }
      for (const [key, previous] of active) {
        if (seen.has(key)) continue;
        previous.clear += 1;
        if (previous.clear < 2) continue;
        active.delete(key);
        messages.push({ key, level: 'ok', text: previous.text });
      }
      return messages;
    },
    active: () => Array.from(active.values()).map(({ key, level, text, since }) => ({ key, level, text, since })),
  };
}

/* ---- Telegram ------------------------------------------------------------ */

function apiBase() {
  return String(process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
}
/* One Bot API method: { status, json }, status 0 when Telegram could not be
   reached. Never throws. */
function telegramCall(token, method, payload = {}, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const target = new URL(`${apiBase()}/bot${token}/${method}`);
    const client = target.protocol === 'http:' ? http : https;
    const request = client.request(target, {
      method: 'POST',
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => { if (chunks.length < 4096) chunks.push(chunk); });
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_error) { /* not JSON */ }
        resolve({ status: response.statusCode, json });
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => resolve({ status: 0, json: null }));
    request.end(body);
  });
}
/* A message to the operator's chat: Telegram's HTML when asked for, and the
   same words without markup if Telegram refuses the HTML. `extra` carries
   what the operator's settings add (silent, a forum topic, buttons); a topic
   Telegram does not know is dropped rather than the message. */
async function sendTelegram(token, chatId, text, { html = false, extra = {} } = {}) {
  let more = { ...extra };
  const send = (payload) => telegramCall(token, 'sendMessage', { chat_id: chatId, disable_web_page_preview: true, ...more, ...payload });
  const body = html ? { text: String(text).slice(0, 4000), parse_mode: 'HTML' } : { text: String(text).slice(0, 4000) };
  let answer = await send(body);
  if (answer.status === 400 && more.message_thread_id && /thread/i.test(String(answer.json?.description || ''))) {
    const { message_thread_id: _dropped, ...rest } = more;
    more = rest;
    answer = await send(body);
  }
  if (html && answer.status === 400) {
    const plain = String(text).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    answer = await send({ text: plain.slice(0, 4000) });
  }
  return answer.status >= 200 && answer.status < 300;
}

module.exports = {
  alertThresholds,
  readMeminfo,
  countPortsInRange,
  turnPortsInUse,
  networkBytes,
  evaluate,
  limitsFrom,
  createAlertState,
  telegramCall,
  sendTelegram,
};
