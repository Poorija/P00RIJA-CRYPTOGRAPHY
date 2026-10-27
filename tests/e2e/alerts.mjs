/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Alerts to the operator (scripts/lib/relay-alerts.js).
 *
 * First the rules on their own: what counts as a problem, how TURN's ports
 * are counted, which interfaces count as the machine's traffic, and when a
 * message goes out — once when a problem starts, again if it gets worse or
 * lasts, once when it is over.
 *
 * Then two real relays and a fake Telegram: A has the bot and the chat, B has
 * neither (the relay in Iran). B's alerts must reach the chat by way of A,
 * over the transit link, opened with the id the link proved, and both relays
 * announce that they started. A relay not named in CHAT_ALERT_PEERS gets no
 * alerts sent to it and none of its own taken.
 *
 *   node tests/e2e/alerts.mjs
 */
import http from 'node:http';
import { createRequire } from 'node:module';
import { startTwoStacks } from './_two-stacks.mjs';

const require = createRequire(import.meta.url);
const alerts = require('../../scripts/lib/relay-alerts.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const GiB = 1024 ** 3;

section('the rules');
const limits = { ...alerts.alertThresholds(), linkMbps: 1000 };
const keys = (found) => found.map((problem) => `${problem.key}:${problem.level}`).join(' ');
check('a healthy machine raises nothing', alerts.evaluate({
  disk: { free: 20 * GiB, total: 40 * GiB },
  memory: { available: 2 * GiB, total: 4 * GiB },
  relay: { rss: 200 * 1048576, limit: 2 * GiB },
  files: { open: 100, limit: 65536 },
  turn: { used: 10, size: 1001, running: true },
  network: { mbps: 50 },
  peersDown: [],
}, limits).length === 0);
const sick = alerts.evaluate({
  disk: { free: 3 * GiB, total: 40 * GiB },
  memory: { available: 0.15 * GiB, total: 4 * GiB },
  relay: { rss: 1.6 * GiB, limit: 2 * GiB },
  files: { open: 60000, limit: 65536 },
  turn: { used: 900, size: 1001, running: false },
  network: { mbps: 900 },
  peersDown: [{ id: 'f'.repeat(64), forMs: 12 * 60000 }],
}, limits);
check('every kind of trouble is named, with how bad it is', keys(sick) === `disk:warn memory:critical relay-memory:warn files:warn turn-down:critical turn-ports:warn bandwidth:warn peer:${'f'.repeat(64)}:critical`, keys(sick));
check('and said in words the operator reads', /دیسک تقریباً پر است/.test(sick[0].text) && /TURN/.test(sick.find((problem) => problem.key === 'turn-ports').text), sick[0].text);
check('the bandwidth alert stays off without a link speed', !alerts.evaluate({ network: { mbps: 900 } }, { ...limits, linkMbps: 0 }).length);
const around = alerts.evaluate({ peersDown: [{ id: 'e'.repeat(64), forMs: 15 * 60000, name: 'se', via: 'fl' }] }, limits);
check('a member with no link of its own but reached through another is a warning that says through which',
  around.length === 1 && around[0].key === `peer-via:${'e'.repeat(64)}` && around[0].level === 'warn' && /«se»/.test(around[0].text) && /از راه «fl»/.test(around[0].text), JSON.stringify(around));

const udp = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   1: 00000000:C000 00000000:0000 07 00000000:00000000 00:00000000 00000000 65534        0 1 2 3',
  '   2: 00000000:C3D8 00000000:0000 07 00000000:00000000 00:00000000 00000000 65534        0 1 2 3',
  '   3: 00000000:0D96 00000000:0000 07 00000000:00000000 00:00000000 00000000 65534        0 1 2 3',
  '   4: 00000000:C3E9 00000000:0000 07 00000000:00000000 00:00000000 00000000 65534        0 1 2 3',
].join('\n');
check('TURN allocations are the UDP ports inside coturn\'s range', alerts.countPortsInRange([udp], 49152, 50152) === 2, `${alerts.countPortsInRange([udp], 49152, 50152)} of 4 sockets`);
const dev = [
  'Inter-|   Receive                                                |  Transmit',
  ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
  '    lo: 9999999 1 0 0 0 0 0 0 9999999 1 0 0 0 0 0 0',
  '  eth0: 1000 1 0 0 0 0 0 0 2000 1 0 0 0 0 0 0',
  'docker0: 5555 1 0 0 0 0 0 0 5555 1 0 0 0 0 0 0',
  'veth12ab: 7777 1 0 0 0 0 0 0 7777 1 0 0 0 0 0 0',
].join('\n');
check('traffic counts the real interfaces only, not loopback or Docker\'s', alerts.networkBytes(dev) === 3000, String(alerts.networkBytes(dev)));

let clock = 0;
const state = alerts.createAlertState({ label: 'relay', remindMs: 1000, now: () => clock });
const warn = [{ key: 'disk', level: 'warn', text: 'low' }];
const crit = [{ key: 'disk', level: 'critical', text: 'very low' }];
check('a problem is announced when it starts', state.update(warn).length === 1);
check('not again a minute later', state.update(warn).length === 0);
check('again when it gets worse', state.update(crit).length === 1);
clock = 1500;
check('and as a reminder while it lasts', state.update(crit).length === 1);
check('one good reading is not yet the end of it', state.update([]).length === 0);
const over = state.update([]);
check('two are, and that is announced', over.length === 1 && over[0].level === 'ok' && over[0].text === 'very low', JSON.stringify(over[0]));
check('nothing is left active', state.active().length === 0);

section('two relays, one Telegram');
const TOKEN = '123456:alerts-suite-token';
const CHAT = '424242';
const sent = [];
const telegram = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (req.url === `/bot${TOKEN}/sendMessage`) {
      try { sent.push(JSON.parse(body)); } catch (_error) { /* not JSON */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
      return;
    }
    res.writeHead(404).end();
  });
});
await new Promise((resolve) => telegram.listen(0, '127.0.0.1', resolve));

let stacks = null;
const texts = () => sent.map((message) => String(message.text || ''));
const waitFor = async (test, ms = 40000) => {
  for (let waited = 0; waited < ms; waited += 250) {
    if (test()) return true;
    await sleep(250);
  }
  return false;
};
const AUTH = { Authorization: 'Basic ' + Buffer.from('admin:Local-Test-Only-Password-36').toString('base64'), 'Content-Type': 'application/json' };
try {
  stacks = await startTwoStacks({
    envA: {
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_API_BASE: `http://127.0.0.1:${telegram.address().port}`,
      CHAT_ALERT_TELEGRAM_CHAT_ID: CHAT,
      CHAT_ALERT_LABEL: 'relay-a',
      CHAT_ALERT_INTERVAL_MS: '5000',
      CHAT_ALERT_PEERS: (sides) => sides.b.identity.id,
    },
    envB: {
      CHAT_ALERT_LABEL: 'relay-b',
      CHAT_ALERT_PEERS: (sides) => sides.a.identity.id,
      CHAT_ALERT_INTERVAL_MS: '5000',
      /* Any disk at all is "nearly full" by this line. */
      CHAT_ALERT_DISK_FREE_PCT: '100',
    },
  });
  check('the relay with the bot announces its start', await waitFor(() => texts().some((text) => text.startsWith('<b>🔄 راه‌اندازی · relay-a</b>'))), texts().join(' | ').slice(0, 300));
  const fromB = `<code>${stacks.b.identity.id.slice(0, 12)}</code>`;
  check('so does the one without, by way of the other', await waitFor(() => texts().some((text) => text.startsWith('<b>🔄 راه‌اندازی · relay-b</b>'))), texts().join(' | ').slice(0, 300));
  check('carrying the id the link proved, so no relay can pass itself off as another', texts().filter((text) => text.includes('relay-b')).every((text) => text.includes(fromB)), texts().filter((text) => text.includes('relay-b')).join(' | ').slice(0, 300));
  check('a problem on the relay without Telegram reaches the chat', await waitFor(() => texts().some((text) => /^<b>(⚠️ هشدار|🚨 بحرانی) · relay-b<\/b>/.test(text) && text.includes('دیسک تقریباً پر است'))), texts().filter((text) => text.includes('relay-b')).join(' | ').slice(0, 300));
  check('everything goes to that one chat', sent.length > 0 && sent.every((message) => String(message.chat_id) === CHAT), [...new Set(sent.map((message) => message.chat_id))].join(','));
  const diskCards = () => texts().filter((text) => text.includes('relay-b') && text.includes('📝 <b>دیسک')).length;
  const disks = diskCards();
  await sleep(11000);
  check('and a lasting problem is not repeated every check', diskCards() === disks, `${disks} → ${diskCards()}`);

  const before = sent.length;
  const testA = await fetch(`http://127.0.0.1:${stacks.a.signal}/Monitor_Server/alert-test`, { method: 'POST', headers: AUTH, body: '{}' }).then((r) => r.json());
  const testB = await fetch(`http://127.0.0.1:${stacks.b.signal}/Monitor_Server/alert-test`, { method: 'POST', headers: AUTH, body: '{}' }).then((r) => r.json());
  check('the dashboard\'s test message goes out from each', testA.via === 'telegram' && testB.via === 'relay-link' && await waitFor(() => sent.slice(before).filter((message) => /پیام آزمایشی/.test(message.text)).length === 2, 10000), `${JSON.stringify(testA)} ${JSON.stringify(testB)}`);
  const healthB = await fetch(`http://127.0.0.1:${stacks.b.signal}/healthz`, { headers: AUTH }).then((r) => r.json());
  check('and the dashboard can see what is active', (healthB.alerts?.active || []).some((problem) => problem.key === 'disk'), JSON.stringify(healthB.alerts || null).slice(0, 200));
  await stacks.stop();
  stacks = null;

  section('a relay that is not named');
  sent.length = 0;
  stacks = await startTwoStacks({
    envA: {
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_API_BASE: `http://127.0.0.1:${telegram.address().port}`,
      CHAT_ALERT_TELEGRAM_CHAT_ID: CHAT,
      CHAT_ALERT_LABEL: 'relay-a',
      CHAT_ALERT_INTERVAL_MS: '5000',
    },
    envB: {
      CHAT_ALERT_LABEL: 'relay-b',
      CHAT_ALERT_INTERVAL_MS: '5000',
      CHAT_ALERT_PEERS: (sides) => sides.a.identity.id,
      CHAT_ALERT_DISK_FREE_PCT: '100',
    },
  });
  await waitFor(() => texts().some((text) => text.startsWith('<b>🔄 راه‌اندازی · relay-a</b>')));
  await sleep(15000);
  check('its alerts are not taken by a relay that does not name it', !texts().some((text) => text.includes('relay-b')), texts().join(' | ').slice(0, 300));
  const unheard = await fetch(`http://127.0.0.1:${stacks.b.signal}/healthz`, { headers: AUTH }).then((r) => r.json());
  check('and they wait, unacknowledged, instead of being lost', (unheard.alerts?.waiting || 0) >= 1, JSON.stringify(unheard.alerts || null).slice(0, 160));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await stacks?.stop();
  telegram.close();
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n===== ${failed} failed of ${results.length} =====`);
  process.exit(failed ? 1 : 0);
}
