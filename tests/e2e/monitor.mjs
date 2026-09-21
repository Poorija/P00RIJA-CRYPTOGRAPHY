/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The server monitor, both of it.
 *
 *   node tests/e2e/monitor.mjs
 *
 * There are two monitors and one API. `/Monitor_Server` is served inline by the
 * relay; `monitor-client.html` is packaged as a desktop app. Both read the same
 * /healthz, so this drives a real relay once and then checks each front end
 * against it.
 *
 * The relay is started on its own ports with its own data directory and a
 * password set here, so nothing in this file touches the production server or
 * reads any secret belonging to it.
 *
 * The interesting part is the discards. The relay throws messages away by
 * design — media older than a week, media over the mailbox quota, a text tail
 * past the limit — and until now none of that reached a screen: a message that
 * never arrived looked exactly like one that was never sent. So the fixture
 * below queues envelopes that MUST be dropped, and the tests assert that both
 * monitors say so, by reason, in a table.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = 'monitor-suite-pw-123456';
const PORT = 9310;
const PRESENCE_PORT = 9311;
const STATIC = process.env.PKG_URL || 'http://localhost:8123';
const RELAY = `http://127.0.0.1:${PORT}`;
const AUTH = 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-monitor-'));
const storePath = path.join(dir, 'offline-messages.json');

/* Two recipients so the "fullest mailboxes" list has something to sort. */
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

const envelope = (kind, ageDays, filler = 64) => ({
  type: 'relay',
  relayId: `${kind}-${ageDays}-${Math.random().toString(36).slice(2, 8)}`,
  fromClientId: 'sender-client',
  fromFingerprint: 'c'.repeat(64),
  payload: {
    type: 'offline-chat',
    class: kind,
    seal: 'x'.repeat(256),
    message: { type: kind === 'media' ? 'file-start' : 'text', payload: { cipher: 'y'.repeat(filler) } },
  },
  queuedAt: new Date(Date.now() - ageDays * DAY).toISOString(),
});

fs.writeFileSync(storePath, JSON.stringify({
  [ALICE]: [
    envelope('text', 30),          /* ancient text: must survive */
    envelope('text', 0),
    envelope('media', 9),          /* past the seven-day line: retention drops it */
    envelope('media', 8),          /* likewise */
    envelope('media', 0, 40000),   /* recent and large: quota decides */
    envelope('media', 1, 40000),
  ],
  [BOB]: [
    envelope('text', 0),
    envelope('media', 12),         /* another retention drop, for a second mailbox */
  ],
}, null, 2));

/* A quota small enough that two 40 KB envelopes cannot both fit, so the quota
   rule fires as well as the retention rule and `byReason` has two entries. */
const relay = spawn(process.execPath, ['scripts/server.js'], {
  /* fileURLToPath, not URL.pathname: this repository's path contains spaces, and
     pathname hands back the percent-encoded form, which is a directory that
     does not exist. spawn then reports ENOENT against the interpreter, which
     reads as "node is missing" and is not. */
  cwd: path.resolve(fileURLToPath(new URL('../..', import.meta.url))),
  env: {
    ...process.env,
    MONITOR_PASSWORD: PASSWORD,
    CHAT_SIGNAL_PORT: String(PORT),
    CHAT_PRESENCE_PORT: String(PRESENCE_PORT),
    CHAT_OFFLINE_STORE_PATH: storePath,
    CHAT_PUSH_STORE_PATH: path.join(dir, 'push-subscriptions.json'),
    CHAT_MEDIA_QUOTA_BYTES: '50000',
    CHAT_RETENTION_SWEEP_MS: '1000',
    /* Tripped deliberately at the end of the run. Twelve keeps that cheap.
       The `login` bucket is deliberately NOT used for this: three wrong
       passwords lock the admin account for ten minutes, so flooding it would
       lock every test after it out of both monitors. */
    CHAT_RATE_WRITE: '12',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const relayLog = [];
relay.stdout.on('data', (chunk) => relayLog.push(String(chunk)));
relay.stderr.on('data', (chunk) => relayLog.push(String(chunk)));

async function waitForRelay() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${RELAY}/chat-health`);
      if (response.ok) return true;
    } catch (error) { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const up = await waitForRelay();
if (!up) {
  console.log(relayLog.join('').slice(-1500));
  console.error('the relay never started');
  relay.kill();
  process.exit(1);
}

const health = async () => (await fetch(`${RELAY}/healthz`, { headers: { Authorization: AUTH } })).json();

/* The sweep runs on a one-second timer here, so give it one. */
await new Promise((resolve) => setTimeout(resolve, 2000));

let browser;
try {
  /* ===== the API the monitors read ===================================== */

  console.log('\n===== what /healthz now reports =====');

  const data = await health();
  check('the relay block is present at all', Boolean(data.relay),
    Object.keys(data).slice(-6).join(' '));

  const limits = data.relay?.limits || {};
  console.log(`  tier ${limits.tier}, ${limits.cpuCount} cores, sockets ceiling ${limits.wsMaxTotal}`);
  check('every reading now has a ceiling to be read against',
    Number.isFinite(limits.wsMaxTotal) && Number.isFinite(limits.textMailboxLimit)
    && Number.isFinite(limits.mediaQuotaBytes) && Boolean(limits.rateLimits?.write),
    JSON.stringify(limits).slice(0, 140));

  const boxes = data.relay?.mailboxes || {};
  console.log(`  mailboxes: ${JSON.stringify(boxes).slice(0, 200)}`);
  check('the mailboxes are counted, weighed and ranked',
    boxes.count === 2 && boxes.envelopes > 0 && boxes.fullest?.length === 2,
    `count ${boxes.count}, envelopes ${boxes.envelopes}, ranked ${boxes.fullest?.length}`);
  check('the fullest mailbox is listed first',
    (boxes.fullest?.[0]?.mediaBytes ?? 0) >= (boxes.fullest?.[1]?.mediaBytes ?? 0),
    boxes.fullest?.map((box) => `${box.fingerprint}:${box.mediaBytes}`).join(' '));
  check('a fingerprint is truncated, not printed in full',
    boxes.fullest?.every((box) => box.fingerprint.length <= 8),
    boxes.fullest?.[0]?.fingerprint);

  const discarded = data.relay?.discarded || {};
  console.log(`  discarded: total ${discarded.total}, reasons ${JSON.stringify(discarded.byReason)}`);
  check('THE MESSAGES THE RELAY THREW AWAY ARE REPORTED',
    discarded.total > 0, `${discarded.total}`);
  check('and each one says why', Object.keys(discarded.byReason || {}).length > 0,
    JSON.stringify(discarded.byReason));
  check('retention and quota are both distinguishable',
    Boolean(discarded.byReason?.retention) && Boolean(discarded.byReason?.quota),
    JSON.stringify(discarded.byReason));
  check('the recent list carries who, what and when',
    discarded.recent?.length > 0
    && discarded.recent.every((row) => row.reason && row.class && row.expiredAt),
    JSON.stringify(discarded.recent?.[0] || {}).slice(0, 150));
  check('a discard is counted in the last 24 hours',
    discarded.last24h > 0, `${discarded.last24h}`);

  check('refused connections are counted, not silently dropped',
    Boolean(data.relay?.sockets?.refused)
    && typeof data.relay.sockets.refused.perIp === 'number'
    && Array.isArray(data.relay.sockets.refused.addresses),
    JSON.stringify(data.relay?.sockets?.refused));

  check('push, sockets, throttling and self-destruct are all reported',
    Boolean(data.relay?.push) && Boolean(data.relay?.sockets)
    && Boolean(data.relay?.throttle) && Boolean(data.relay?.selfDestruct),
    JSON.stringify({ push: data.relay?.push, sockets: data.relay?.sockets?.total }));
  check('the certificate is summarised, or the reason it cannot be',
    Boolean(data.cert) && ('daysLeft' in data.cert),
    JSON.stringify(data.cert).slice(0, 120));

  /* The block is cached; two calls a second apart must not disagree, and the
     cache must not be so long that a monitor shows stale numbers. */
  const again = await health();
  check('the cached block is stable between polls',
    again.relay?.computedAt === data.relay?.computedAt
    || again.relay?.discarded?.total === data.relay?.discarded?.total,
    `${data.relay?.computedAt} vs ${again.relay?.computedAt}`);

  /* ===== the inline web monitor ======================================== */

  console.log('\n===== the web monitor at /Monitor_Server =====');

  browser = await chromium.launch();
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 160)));

  await page.goto(`${RELAY}/Monitor_Server`, { waitUntil: 'load' });
  check('the login screen is served', await page.locator('#passInput').count() === 1);

  await page.fill('#passInput', PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#relayLimits', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(
    () => (document.getElementById('relayLimits')?.children.length || 0) > 0,
    null, { timeout: 20000 }).catch(() => {});

  const web = await page.evaluate(() => ({
    limits: document.getElementById('relayLimits')?.children.length || 0,
    mailboxes: document.getElementById('relayMailboxes')?.children.length || 0,
    throttle: document.getElementById('relayThrottle')?.children.length || 0,
    discardRows: document.getElementById('relayDiscardBody')?.querySelectorAll('tr').length || 0,
    summary: document.getElementById('relayDiscardSummary')?.textContent || '',
    instance: document.getElementById('relayInstance')?.textContent || '',
    limitsText: document.getElementById('relayLimits')?.textContent || '',
  }));
  console.log(`  ${JSON.stringify({ ...web, limitsText: web.limitsText.slice(0, 90) })}`);
  check('the web monitor logs in and paints the relay panel',
    web.limits > 0 && web.mailboxes > 0 && web.throttle > 0,
    `${web.limits}/${web.mailboxes}/${web.throttle}`);
  check('it shows usage against the ceiling, not a bare number',
    web.limitsText.includes('از'), web.limitsText.slice(0, 80));
  check('the discard table has the dropped messages in it',
    web.discardRows > 0 && !web.summary.includes('هیچ پیامی'),
    `${web.discardRows} rows — ${web.summary.slice(0, 70)}`);
  check('the instance id is shown', web.instance.length > 0, web.instance);

  /* The values must be the relay's, not placeholders that happen to render. */
  const agrees = await page.evaluate(() => {
    const text = document.getElementById('relayDiscardSummary')?.textContent || '';
    return text.match(/(\d+)\s*روی هم/)?.[1] || '';
  });
  check('the number on screen is the number the relay reported',
    Number(agrees) === discarded.total, `screen ${agrees} vs api ${discarded.total}`);

  check('no script threw while rendering it', pageErrors.length === 0,
    pageErrors.slice(0, 2).join(' | '));

  /* ===== the desktop monitor ============================================ */

  console.log('\n===== the desktop monitor client =====');

  const desktop = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  const desktopErrors = [];
  desktop.on('pageerror', (error) => desktopErrors.push(error.message.slice(0, 160)));
  const served = await desktop.goto(`${STATIC}/monitor-client.html`, { waitUntil: 'load' })
    .then((response) => response?.ok())
    .catch(() => false);

  if (!served) {
    check('the desktop monitor page is reachable for testing', false,
      `${STATIC}/monitor-client.html — start "PORT=8123 npm run dev"`);
  } else {
    await desktop.fill('#serverUrlInput', RELAY);
    await desktop.fill('#passwordInput', PASSWORD);
    await desktop.click('#loginButton');
    await desktop.waitForFunction(
      () => (document.getElementById('relayLimits')?.children.length || 0) > 0,
      null, { timeout: 20000 }).catch(() => {});

    const client = await desktop.evaluate(() => ({
      dashboardShown: !document.getElementById('dashboard')?.classList.contains('hidden'),
      limits: document.getElementById('relayLimits')?.children.length || 0,
      mailboxes: document.getElementById('relayMailboxes')?.children.length || 0,
      discardRows: document.getElementById('relayDiscardTable')?.querySelectorAll('tr').length || 0,
      summary: document.getElementById('relayDiscardSummary')?.textContent || '',
      metricDiscarded: document.getElementById('metricDiscarded')?.textContent || '',
      metricQuota: document.getElementById('metricQuota')?.textContent || '',
      status: document.getElementById('statusText')?.textContent || '',
    }));
    console.log(`  ${JSON.stringify(client)}`);
    check('the desktop client reaches a plain-http relay across origins',
      client.dashboardShown, client.status.slice(0, 80));
    check('and paints the same relay panel',
      client.limits > 0 && client.mailboxes > 0, `${client.limits}/${client.mailboxes}`);
    check('with the discards listed',
      client.discardRows > 0 && !client.summary.includes('هیچ پیامی'),
      `${client.discardRows} rows`);
    check('and the two new metric cards filled in',
      client.metricDiscarded !== '' && client.metricDiscarded !== '0'
      && client.metricQuota.endsWith('%'),
      `${client.metricDiscarded} / ${client.metricQuota}`);
    check('no script threw in the desktop client', desktopErrors.length === 0,
      desktopErrors.slice(0, 2).join(' | '));
  }

  /* ===== a monitor pointed at an older relay ============================ */

  console.log('\n===== an older relay, with no relay block =====');

  const fallback = await page.evaluate(() => {
    renderRelayHealth(undefined, undefined);
    return {
      instance: document.getElementById('relayInstance')?.textContent || '',
      limits: document.getElementById('relayLimits')?.children.length || 0,
      summary: document.getElementById('relayDiscardSummary')?.textContent || '',
    };
  });
  check('it says the server cannot report this, rather than showing zeros',
    fallback.instance.includes('نمی‌دهد') && fallback.limits === 0,
    JSON.stringify(fallback));

  /* ===== the controls still work ======================================== */

  console.log('\n===== the admin controls =====');

  const wrongPassword = await fetch(`${RELAY}/admin/change-password`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword: 'wrong', newPassword: 'something-else-123456' }),
  }).then((response) => response.json()).catch(() => ({}));
  check('changing the password requires the old one', wrongPassword.ok === false,
    JSON.stringify(wrongPassword).slice(0, 90));

  const broadcast = await fetch(`${RELAY}/admin/broadcast`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'monitor suite' }),
  }).then((response) => response.json()).catch(() => ({}));
  check('a broadcast is accepted with nobody connected', broadcast.ok === true,
    JSON.stringify(broadcast).slice(0, 90));

  const cleared = await fetch(`${RELAY}/admin/clear-offline`, {
    method: 'POST', headers: { Authorization: AUTH },
  }).then((response) => response.json()).catch(() => ({}));
  await new Promise((resolve) => setTimeout(resolve, 11000));
  const afterClear = await health();
  check('clearing the queue empties it, and the panel follows',
    cleared.ok === true && afterClear.relay?.mailboxes?.count === 0
    && afterClear.relay?.mailboxes?.envelopes === 0,
    `cleared ${cleared.cleared}, now ${afterClear.relay?.mailboxes?.count} boxes`);
  check('the discard record survives the queue being cleared',
    afterClear.relay?.discarded?.total >= discarded.total,
    `${afterClear.relay?.discarded?.total} vs ${discarded.total}`);

  /* ===== rate limiting shows up while it is happening =================== */

  console.log('\n===== throttling is visible while it happens =====');

  /* Last, and with valid credentials. An earlier draft flooded /admin/login
     with wrong passwords, which tripped the three-strike lock and left every
     later test staring at a login screen — and, because these middlewares run
     before the CORS handler, the rejected preflight reached the desktop client
     as an unexplained "Failed to fetch". Both are fixed; this now trips the
     `write` bucket with real requests, which is what an overloaded relay
     actually looks like. */
  for (let attempt = 0; attempt < 16; attempt++) {
    await fetch(`${RELAY}/admin/broadcast`, {
      method: 'POST',
      headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `flood ${attempt}` }),
    }).catch(() => {});
  }
  /* The insight is cached for ten seconds; wait it out rather than assert
     against a snapshot taken before the flood happened. */
  await new Promise((resolve) => setTimeout(resolve, 11000));
  const throttled = (await health()).relay?.throttle || {};
  console.log(`  ${JSON.stringify(throttled).slice(0, 240)}`);
  check('a client being rate limited is named, with its ceiling',
    throttled.nearOrOverLimit?.some((row) => row.bucket === 'write' && row.over),
    JSON.stringify(throttled.nearOrOverLimit || []).slice(0, 180));

  /* The bug that made the desktop monitor unreachable: a preflight counted
     against the bucket, then rejected without CORS headers. */
  const preflight = await fetch(`${RELAY}/admin/broadcast`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:8123', 'Access-Control-Request-Method': 'POST' },
  });
  check('a CORS preflight is answered even while that bucket is over its limit',
    preflight.status === 204 && Boolean(preflight.headers.get('access-control-allow-origin')),
    `${preflight.status}, allow-origin ${preflight.headers.get('access-control-allow-origin')}`);

  const unauthorised = await fetch(`${RELAY}/healthz`).then((response) => response.status);
  check('/healthz still refuses an unauthenticated caller', unauthorised === 401,
    String(unauthorised));
} finally {
  await browser?.close();
  relay.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* gone */ }
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('failed:');
  failed.forEach((result) => console.log(`  - ${result.name}`));
  process.exit(1);
}
