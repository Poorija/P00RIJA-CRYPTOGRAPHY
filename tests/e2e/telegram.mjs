/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What the operator reads in Telegram (scripts/lib/relay-report.js).
 *
 * "cards" draws them on their own: every server named in full, the state of
 * the moment, values from servers escaped, a relayed card carrying the id the
 * link proved, and the summary of every server.
 * "relay" runs three relays of one family and a fake Telegram: the one with
 * the bot sends its own cards and the others', answers /status, /servers and
 * /help from the operator's chat and from nowhere else, sets its commands,
 * and sends the daily summary at its hour.
 *
 *   node tests/e2e/telegram.mjs            # every section
 *   node tests/e2e/telegram.mjs cards      # one of them
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import { createFleet, waitUntil, sleep, short } from './_relay-fleet.mjs';

const require = createRequire(import.meta.url);
const ONLY = new Set(process.argv.slice(2));
const wants = (name) => !ONLY.size || ONLY.has(name);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const GiB = 1024 ** 3;

try {
  if (wants('cards')) {
    section('cards');
    const report = require('../../scripts/lib/relay-report.js');
    const relayId = 'a'.repeat(64);
    const raw = {
      level: 'warn', title: 'دیسک تقریباً پر است', body: '3.1 GB آزاد از 48 GB (6٪).', at: Date.UTC(2026, 9, 26, 15, 0),
      identity: { label: 'رلهٔ IR3', host: 'ir.example.ir', region: 'inside-iran', cluster: 'Iran', gateway: 2, relayId, version: '2.98.81', build: 'chat-v174' },
      snapshot: {
        users: 12, queued: 3, mailboxes: 2, cpu: 23.4, memory: { used: 1.2 * GiB, total: 2 * GiB }, relay: { rss: 0.3 * GiB, limit: 2 * GiB },
        disk: { used: 19 * GiB, total: 48 * GiB }, links: { up: 6, allowed: 6, hybrid: 6 }, turn: { running: true, used: 4, size: 1001 }, uptime: 3 * 86400 + 4 * 3600, hostUptime: 40 * 86400,
      },
    };
    const card = report.renderCard(report.cleanReport(raw));
    const has = (piece) => card.includes(piece);
    check('a card opens with how serious it is and which server', card.startsWith('<b>⚠️ هشدار · رلهٔ IR3</b>'), card.split('\n')[0]);
    check('it names the server in full: name, address, where, cluster, gateway place, version, build and id',
      has('<b>رلهٔ IR3</b> — <code>ir.example.ir</code>') && has('🇮🇷 داخل ایران') && has('خوشهٔ <b>Iran</b>') && has('Gateway <b>2</b>')
        && has('<code>2.98.81</code> (chat-v174)') && has(`<code>${relayId.slice(0, 12)}</code>`));
    check('it says what happened', has('📝 <b>دیسک تقریباً پر است</b>') && has('3.1 GB آزاد از 48 GB'));
    check('and how the server is at that moment: users, queue, processor, memory, disk, links, TURN and uptime',
      has('📊 <b>وضعیت همین لحظه</b>') && has('کاربران آنلاین: <b>12</b>') && has('صف آفلاین: <b>3</b> در 2 صندوق') && has('پردازنده: <b>23٪</b>')
        && has('1.2 GB / 2.0 GB</b> (60٪)') && has('19.0 GB / 48.0 GB</b> (40٪)') && has('<b>6 / 6</b> · post-quantum <b>6</b>') && has('TURN: <b>روشن</b> · 4 / 1001 پورت')
        && has('<b>3 روز و 4 ساعت</b>') && has('سرور از 40 روز'), card);
    check('and when, in Tehran’s calendar and in UTC', has('۱۴۰۵/۰۸/۰۴ ساعت ۱۸:۳۰ به وقت تهران · 2026-10-26 15:00 UTC'), card.split('\n').at(-1));
    const hostile = report.renderCard(report.cleanReport({ ...raw, title: '<a href="https://evil.example">tap</a>', identity: { ...raw.identity, label: '<b>fake</b> & co', host: 'x.ir"><script>' } }));
    check('whatever a server sends is escaped, never markup', !hostile.includes('<a href') && hostile.includes('&lt;a href=') && hostile.includes('&lt;b&gt;fake&lt;/b&gt; &amp; co') && !hostile.includes('<script>'), hostile.slice(0, 200));
    const relayed = report.renderCard({ ...report.cleanReport({ ...raw, identity: { ...raw.identity, relayId: 'b'.repeat(64) } }), provenId: 'c'.repeat(64) });
    check('a relayed card carries the id its link proved, not the one it claims', relayed.includes(`<code>${'c'.repeat(12)}</code>`) && !relayed.includes('b'.repeat(12)));
    const cleaned = report.cleanReport({ level: 'nonsense', identity: { relayId: 'not-hex', version: '1.0<script>' }, snapshot: { users: 'many', links: { up: 2, allowed: 'x' } }, extra: 'dropped' });
    check('a report is cut down to what is drawn', cleaned.level === 'peer' && cleaned.identity.relayId === '' && cleaned.identity.version === '1.0script' && cleaned.snapshot.users === null && cleaned.snapshot.links.allowed === null && !('extra' in cleaned), JSON.stringify(cleaned).slice(0, 200));
    const fleet = report.renderFleet({
      at: raw.at,
      entries: [
        { answered: true, report: report.cleanReport(raw) },
        { answered: true, report: report.cleanReport({ ...raw, problems: [], identity: { ...raw.identity, label: 'رلهٔ IR', host: 'ir.example.ca' } }) },
        { answered: false, report: report.cleanReport({ identity: { label: 'رلهٔ IR4', region: 'inside-iran', cluster: 'Iran' } }) },
        { answered: true, report: report.cleanReport({ ...raw, problems: [{ level: 'critical', text: 'سرویس TURN اجرا نمی‌شود.' }], identity: { label: 'رلهٔ FL', host: 'fl.example', region: 'outside-iran', cluster: 'Outside' } }) },
      ],
    });
    check('the summary counts the servers and who answered', fleet.startsWith('<b>📡 وضعیت سرورها</b> · 4 سرور · 3 پاسخ داد'), fleet.split('\n')[0]);
    check('it groups them by cluster', fleet.includes('<b>🇮🇷 خوشهٔ Iran</b>') && fleet.includes('<b>🌍 خوشهٔ Outside</b>'));
    check('each server one line of its state, and a server that did not answer by name',
      /🟢 <b>رلهٔ IR<\/b> · <code>ir\.example\.ca<\/code>/.test(fleet) && fleet.includes('👥 12 · 🔗 6/6 · 🧠 23٪ · 🧮 60٪ · 💽 40٪ · 📞 روشن') && fleet.includes('⛔️ <b>رلهٔ IR4</b> · پاسخ نداد'), fleet);
    check('and its problems, the worst coloured red', fleet.includes('🔴 <b>رلهٔ FL</b>') && fleet.includes('🚨 سرویس TURN اجرا نمی‌شود.'));
    check('a card without markup reads the same', report.plainText('<b>a &amp; b</b> &lt;c&gt;') === 'a & b <c>');
  }

  if (wants('relay')) {
    section('relay: three relays, one bot');
    const dir = require('../../scripts/lib/relay-directory.js');
    const TOKEN = '123456:telegram-suite-token';
    const CHAT = '424242';
    const sent = [];
    const calls = [];
    const updates = [];
    let updateId = 1000;
    const telegram = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        let json = {};
        try { json = body ? JSON.parse(body) : {}; } catch (_error) { /* not JSON */ }
        const method = String(req.url || '').replace(`/bot${TOKEN}/`, '').split('?')[0];
        calls.push({ method, json });
        const answer = (result) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })); };
        if (!String(req.url).startsWith(`/bot${TOKEN}/`)) { res.writeHead(404).end(); return; }
        if (method === 'sendMessage') { sent.push(json); return answer({ message_id: sent.length }); }
        if (method === 'getWebhookInfo') return answer({ url: '' });
        if (method === 'setMyCommands') return answer(true);
        if (method === 'getUpdates') {
          const offset = Number(json.offset || 0);
          const ready = updates.filter((update) => update.update_id >= offset && offset !== -1);
          if (offset === -1) return answer(updates.slice(-1));
          if (ready.length) return answer(ready);
          await sleep(Math.min(1500, Number(json.timeout || 0) * 1000));
          return answer(updates.filter((update) => update.update_id >= offset));
        }
        return answer(true);
      });
    });
    await new Promise((resolve) => telegram.listen(0, '127.0.0.1', resolve));
    const operator = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const operatorKey = operator.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const tehranNow = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const fleet = await createFleet(['ta', 'tb', 'tc'], {
      env: {
        ta: () => ({
          CHAT_OPERATOR_KEY: operatorKey, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: `http://127.0.0.1:${telegram.address().port}`, CHAT_ALERT_TELEGRAM_CHAT_ID: CHAT,
          CHAT_ALERT_LABEL: 'relay-a', CHAT_ALERT_INTERVAL_MS: '5000', DOMAIN: 'a.example', CHAT_STATUS_REPORT_AT: tehranNow, CHAT_STATUS_REPORT_CHECK_MS: '3000',
        }),
        tb: () => ({ CHAT_OPERATOR_KEY: operatorKey, CHAT_ALERT_LABEL: 'relay-b', CHAT_ALERT_INTERVAL_MS: '5000', CHAT_ALERT_DISK_FREE_PCT: '100', DOMAIN: 'b.example' }),
        tc: () => ({ CHAT_OPERATOR_KEY: operatorKey, CHAT_ALERT_LABEL: 'relay-c', CHAT_ALERT_INTERVAL_MS: '5000', DOMAIN: 'c.example' }),
      },
    });
    const { ta, tb, tc } = fleet.relays;
    try {
      await fleet.startAll();
      const doc = dir.signDirectory({
        v: 1, operator: { id: dir.operatorIdFor(operatorKey), key: operatorKey, name: 'Bot Ops' }, serial: 1, issuedAt: new Date().toISOString(),
        relays: [
          { id: ta.id, name: 'ta', origins: [ta.origin], region: 'outside-iran', gateway: 1, cluster: 'Outside' },
          { id: tb.id, name: 'tb', origins: [tb.origin], region: 'inside-iran', gateway: 0, cluster: 'Iran' },
          { id: tc.id, name: 'tc', origins: [tc.origin], region: 'inside-iran', gateway: 0, cluster: 'Iran' },
        ],
        revoked: [],
      }, operator.privateKey);
      for (const name of ['ta', 'tb', 'tc']) await fleet.post(name, '/Monitor_Server/directory', doc);
      await waitUntil(async () => (await fleet.linked('ta')).size === 2, 30000);
      const texts = () => sent.map((message) => String(message.text || ''));
      check('the bot’s relay sends its own start as a card, in Telegram’s HTML', await waitUntil(() => sent.some((message) => message.parse_mode === 'HTML' && String(message.text).startsWith('<b>🔄 راه‌اندازی · relay-a</b>')), 30000), texts().join(' | ').slice(0, 300));
      const startA = texts().find((text) => text.startsWith('<b>🔄 راه‌اندازی · relay-a</b>')) || '';
      check('naming it in full and with its state of the moment', startA.includes('<code>a.example</code>') && startA.includes('خوشهٔ <b>Outside</b>') && startA.includes('📊 <b>وضعیت همین لحظه</b>') && startA.includes('👥 کاربران آنلاین'), startA);
      check('the others’ cards reach the chat through it, with the ids their links proved', await waitUntil(() => texts().some((text) => text.startsWith('<b>🔄 راه‌اندازی · relay-b</b>') && text.includes(`<code>${short(tb.id).slice(0, 12)}</code>`)), 40000), texts().filter((text) => text.includes('relay-b')).join(' | ').slice(0, 300));
      const startB = texts().find((text) => text.startsWith('<b>🔄 راه‌اندازی · relay-b</b>')) || '';
      check('and with their own state of the moment', startB.includes('🇮🇷 داخل ایران') && startB.includes('خوشهٔ <b>Iran</b>') && startB.includes('📊 <b>وضعیت همین لحظه</b>'), startB);
      check('a problem on one without the bot arrives as a card', await waitUntil(() => texts().some((text) => /^<b>(⚠️ هشدار|🚨 بحرانی) · relay-b<\/b>/.test(text) && text.includes('دیسک تقریباً پر است')), 40000));
      check('its commands are set', calls.some((call) => call.method === 'setMyCommands' && (call.json.commands || []).map((command) => command.command).join() === 'status,servers,help'), JSON.stringify(calls.filter((call) => call.method === 'setMyCommands').map((call) => call.json)).slice(0, 200));

      const from = (chatId, text) => { updateId += 1; updates.push({ update_id: updateId, message: { message_id: updateId, chat: { id: Number(chatId) }, from: { id: Number(chatId) }, text } }); };
      await sleep(2000);
      const before = sent.length;
      from(CHAT, '/status');
      check('/status from the operator’s chat answers with every server', await waitUntil(() => sent.slice(before).some((message) => String(message.chat_id) === CHAT && String(message.text).startsWith('<b>📡 وضعیت سرورها</b> · 3 سرور · 3 پاسخ داد')), 20000), texts().slice(before).join(' | ').slice(0, 400));
      const summary = texts().slice(before).find((text) => text.startsWith('<b>📡 وضعیت سرورها</b>')) || '';
      check('grouped by cluster, each with its state', summary.includes('خوشهٔ Iran') && summary.includes('خوشهٔ Outside') && summary.includes('<b>relay-a</b>') && summary.includes('<b>relay-b</b>') && summary.includes('<b>relay-c</b>') && /🔗 2\/2/.test(summary), summary);
      check('and the one with a problem marked', /🟡 <b>relay-b<\/b>|🔴 <b>relay-b<\/b>/.test(summary));
      const beforeStranger = sent.length;
      from('999', '/status');
      await sleep(4000);
      check('a command from anybody else’s chat is not answered', !sent.slice(beforeStranger).some((message) => String(message.chat_id) === '999'), JSON.stringify(sent.slice(beforeStranger).map((message) => message.chat_id)));
      const beforeServers = sent.length;
      from(CHAT, '/servers');
      check('/servers lists every server with its full name', await waitUntil(() => sent.slice(beforeServers).some((message) => String(message.text).includes('<code>b.example</code>') && String(message.text).includes('<code>c.example</code>')), 20000), texts().slice(beforeServers).join(' | ').slice(0, 300));
      const beforeHelp = sent.length;
      from(CHAT, '/help');
      check('/help says what it can do', await waitUntil(() => sent.slice(beforeHelp).some((message) => String(message.text).includes('/status') && String(message.text).includes('/servers')), 20000));
      const daily = () => texts().filter((text) => text.startsWith('<b>📡 گزارش روزانهٔ سرورها</b>')).length;
      const dailyCame = await waitUntil(() => daily() >= 1, 30000);
      await sleep(7000);
      check('the daily summary goes out at its hour, once', dailyCame && daily() === 1, `${daily()} sent; set for ${tehranNow}`);
      check('everything went to the operator’s chat alone', sent.every((message) => String(message.chat_id) === CHAT), [...new Set(sent.map((message) => message.chat_id))].join(','));
    } finally {
      await fleet.stopAll();
      telegram.close();
    }
  }
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n===== ${failed} failed of ${results.length} =====`);
  process.exit(failed ? 1 : 0);
}
