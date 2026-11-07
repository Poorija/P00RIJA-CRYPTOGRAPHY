/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The Telegram bot's settings (scripts/lib/telegram-settings.js), which the
 * central panel changes while the relay runs: .env gives the defaults; every
 * value the panel sends is checked and kept; the token is kept in a file of
 * its own, owner-only, and never shown in full; quiet hours and mute are
 * worked out in the operator's time zone; and every message the bot sends is
 * in the language chosen, Persian word for word as before.
 *
 *   node tests/e2e/telegramsettings.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-tgset-'));
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

try {
  const { createTelegramSettings } = require(path.join(ROOT, 'scripts/lib/telegram-settings.js'));
  const { textFor } = require(path.join(ROOT, 'scripts/lib/telegram-text.js'));
  const report = require(path.join(ROOT, 'scripts/lib/relay-report.js'));
  const env = { TELEGRAM_BOT_TOKEN: TOKEN, CHAT_ALERT_TELEGRAM_CHAT_ID: '507', CHAT_ALERT_INTERVAL_MS: '120000', CHAT_ALERT_REMIND_HOURS: '3', CHAT_ALERT_DISK_FREE_PCT: '15', CHAT_STATUS_REPORT_AT: '08:30' };
  const make = () => createTelegramSettings({ file: path.join(work, 'telegram-settings.json'), tokenFile: path.join(work, 'telegram-token'), env });
  const settings = make();
  const first = settings.get();
  check('.env gives the defaults', first.chatId === '507' && first.checkSeconds === 120 && first.remindHours === 3 && first.thresholds.diskFreePct === 15 && first.report.at === '08:30' && first.language === 'fa', JSON.stringify(first).slice(0, 200));
  check('the token from .env is used, and never shown in full', settings.token() === TOKEN && settings.view().token.set && !JSON.stringify(settings.view()).includes(TOKEN) && settings.view().token.source === 'env', JSON.stringify(settings.view().token));

  const changed = settings.update({
    language: 'en', chatId: '-1001234567890', topics: { alerts: '12', reports: '34' }, categories: { reminder: { on: false }, start: { silent: false } },
    alertKeys: { bandwidth: false }, thresholds: { diskFreePct: 20, turnPct: 90 }, checkSeconds: 30, remindHours: 12, minGapSeconds: 5,
    quiet: { on: true, from: '23:30', to: '07:00', mode: 'hold', criticalPasses: true }, timezone: 'Europe/Stockholm',
    report: { on: true, at: '07:45' }, commands: { mute: false }, admins: ['1111', '2222'], buttons: false,
    templates: { footer: 'P00RIJA · {server}', showSnapshot: false },
  });
  const now = settings.get();
  check('the panel’s changes are kept, every field', changed.ok && now.language === 'en' && now.chatId === '-1001234567890' && now.topics.alerts === '12' && now.categories.reminder.on === false
    && now.categories.start.silent === false && now.alertKeys.bandwidth === false && now.thresholds.diskFreePct === 20 && now.thresholds.turnPct === 90 && now.checkSeconds === 30
    && now.quiet.mode === 'hold' && now.timezone === 'Europe/Stockholm' && now.report.at === '07:45' && now.commands.mute === false && now.admins.join() === '1111,2222'
    && now.buttons === false && now.templates.footer === 'P00RIJA · {server}', JSON.stringify(now).slice(0, 300));
  check('and outlive a restart', make().get().language === 'en' && make().get().thresholds.diskFreePct === 20);
  check('with the file readable by the relay alone', (fs.statSync(path.join(work, 'telegram-settings.json')).mode & 0o077) === 0);

  const refused = [
    { chatId: 'not a chat' }, { language: 'xx' }, { checkSeconds: 1 }, { thresholds: { diskFreePct: 150 } }, { quiet: { from: '25:00' } },
    { timezone: 'Mars/Olympus' }, { admins: ['x'] }, { topics: { alerts: 'abc' } }, { templates: { footer: 'x'.repeat(5000) } }, { templates: { style: 'fancy' } }, { templates: { separator: 'wavy' } }, { templates: { direction: 'up' } }, { templates: { custom: 'x'.repeat(2000) } }, { templates: { quote: 'deep' } },
  ].map((patch) => settings.update(patch));
  check('a value out of its range or of the wrong shape is refused, the rest kept', refused.every((answer) => !answer.ok) && settings.get().chatId === '-1001234567890', JSON.stringify(refused.map((answer) => answer.reason)));

  const tokenSet = settings.setToken('987654321:BBHdqTcvCH1vGWJxfSeofSAs0K5PALDsbb');
  check('a token set from the panel replaces the one in .env, kept owner-only', tokenSet.ok && settings.token().startsWith('987654321:') && (fs.statSync(path.join(work, 'telegram-token')).mode & 0o077) === 0 && settings.view().token.source === 'panel');
  check('a token that is not a bot token is refused', !settings.setToken('hello').ok);
  settings.setToken('');
  check('and one removed from the panel stays removed, .env or not', settings.token() === '' && !settings.view().token.set);

  /* Quiet hours and mute, in the operator's own time zone. */
  settings.update({ timezone: 'Asia/Tehran', quiet: { on: true, from: '23:00', to: '07:00' } });
  const at = (iso) => Date.parse(iso);
  check('quiet hours run across midnight in the chosen zone', settings.quietNow(at('2026-11-10T21:00:00Z')) && settings.quietNow(at('2026-11-11T02:00:00Z')) && !settings.quietNow(at('2026-11-10T08:00:00Z')),
    `${settings.quietNow(at('2026-11-10T21:00:00Z'))} ${settings.quietNow(at('2026-11-11T02:00:00Z'))} ${settings.quietNow(at('2026-11-10T08:00:00Z'))}`);
  settings.mute(at('2026-11-10T10:00:00Z'), 2 * 3600000);
  check('a mute lasts as long as it was asked for', settings.muted(at('2026-11-10T11:00:00Z')) && !settings.muted(at('2026-11-10T12:30:00Z')));
  settings.unmute();
  check('and an unmute ends it', !settings.muted(at('2026-11-10T11:00:00Z')));
  check('the daily report’s clock is the chosen zone’s', settings.clock(at('2026-11-10T05:00:00Z')).time === '08:30' && settings.clock(at('2026-11-10T05:00:00Z')).day === '2026-11-10');

  /* Everything the bot says, in the language chosen. */
  const fa = textFor('fa');
  const en = textFor('en');
  check('Persian is what the bot always said', fa.alert.disk({ free: '3.1 GB', total: '48 GB', pct: 6 }) === 'دیسک تقریباً پر است: 3.1 GB آزاد از 48 GB (6٪). با پر شدن دیسک، صندوق پیام‌ها نوشته نمی‌شوند.');
  check('and English says the same', /^The disk is nearly full: 3\.1 GB free of 48 GB \(6%\)/.test(en.alert.disk({ free: '3.1 GB', total: '48 GB', pct: 6 })));
  const keysOf = (value, prefix = '') => (value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => keysOf(inner, `${prefix}${key}.`)) : [prefix]);
  const missing = keysOf(fa).filter((key) => !keysOf(en).includes(key));
  check('every Persian text has its English', missing.length === 0, missing.join(' '));
  const english = report.renderFleet({ entries: [{ answered: true, provenId: 'a'.repeat(64), report: report.cleanReport({ identity: { label: 'fl', host: 'fl.example', region: 'outside-iran', cluster: 'Outside' }, snapshot: { users: 3 } }) }], lang: 'en' });
  check('the summary in English', english.replace(/[\u200E\u200F]/g, '').startsWith('<b>📡 Server status</b> · 1 servers · 1 answered') && english.includes('Cluster Outside'), english.split('\n')[0]);
  const card = report.renderCard({ level: 'warn', title: 'x', body: 'y', identity: { label: 'fl' }, lang: 'en', footer: 'P00RIJA · {server}', showSnapshot: false, snapshot: { users: 2 } });
  check('a card in English, with the operator’s footer and no state when that is off', card.replace(/[\u200E\u200F]/g, '').startsWith('<b>⚠️ Warning · fl</b>') && card.includes('P00RIJA · fl') && !card.includes('Users online'), card);

  /* The card's designs: each draws, every line carries its direction, the
     markup stays whole however long a message is, and the operator's own
     design turns its marks into Telegram's markup and escapes everything else. */
  const sample = { level: 'warn', title: 'دیسک کم است', body: 'فقط ۳ گیگ آزاد است <script>', identity: { label: 'fl', host: 'a.example', region: 'outside-iran', cluster: 'Outside', version: '2.98.89' },
    snapshot: { users: 3, queued: 1, cpu: 12, memory: { used: 1e9, total: 4e9 }, disk: { used: 40e9, total: 48e9 }, links: { up: 5, allowed: 6 }, uptime: 3600 } };
  const balanced = (html) => ['b', 'i', 's', 'code', 'blockquote', 'tg-spoiler'].every((tag) => (html.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length === (html.match(new RegExp(`</${tag}>`, 'g')) || []).length);
  const marked = (html, mark) => html.split('\n').filter((line) => line.replace(/<[^>]+>/g, '').trim()).every((line) => line.replace(/^<blockquote( expandable)?>/, '').startsWith(mark));
  const designs = report.STYLES.map((style) => [style, report.renderCard({ ...sample, style, custom: '**{icon} {kind}** {server}\n> {title} {body}\n>> {snapshot}' })]);
  check('every design draws a whole card, its markup balanced and its message escaped', designs.every(([, html]) => html.length > 50 && balanced(html) && !html.includes('<script>') && html.includes('&lt;script&gt;')), designs.map(([style, html]) => `${style}:${html.length}`).join(' '));
  check('a Persian card reads right to left on every line, an English one left to right', designs.every(([, html]) => marked(html, '‏')) && marked(report.renderCard({ ...sample, lang: 'en', style: 'boxed' }), '‎'));
  check('the direction can be set by hand', marked(report.renderCard({ ...sample, direction: 'ltr' }), '‎'));
  const boxed = report.renderCard({ ...sample, style: 'boxed' });
  check('the boxed design quotes the server and folds its state', /<blockquote>/.test(boxed) && /<blockquote expandable>/.test(boxed));
  const own = report.renderCard({ ...sample, style: 'custom', custom: '**{kind}** __{server}__ `{host}` ||{cpu}|| ~~x~~\n> {title}\n>> {body}\n<b>raw</b> {nothing}' });
  check('the operator’s own design: its marks become markup, its own tags stay text, unknown placeholders stay as written',
    own.includes('<b>هشدار</b>') && own.includes('<i>fl</i>') && own.includes('<code>a.example</code>') && own.includes('<tg-spoiler>12٪</tg-spoiler>') && own.includes('<s>x</s>')
    && own.includes('<blockquote>') && own.includes('<blockquote expandable>') && own.includes('&lt;b&gt;raw&lt;/b&gt;') && own.includes('{nothing}') && balanced(own), own);
  check('icons can be left out', !/⚠️|🖥/.test(report.renderCard({ ...sample, icons: false })));
  const huge = report.renderCard({ ...sample, body: '<b>'.repeat(3000), style: 'boxed' });
  check('a message too long for Telegram is shortened, never cut through markup', huge.length <= 3900 && balanced(huge) && huge.includes('…'), String(huge.length));
  const fleet = report.renderFleet({ entries: Array.from({ length: 90 }, (_v, n) => ({ answered: true, provenId: 'a'.repeat(64), report: report.cleanReport({ identity: { label: `s${n}`, host: `h${n}.example`, cluster: 'c' }, snapshot: { users: 1 } }) })) });
  check('a long summary keeps whole lines and balanced markup', fleet.length <= 3900 && balanced(fleet), String(fleet.length));
  check('a footer cannot carry markup from the panel', !report.renderCard({ level: 'warn', identity: { label: 'fl' }, footer: '<a href="x">y</a>' }).includes('<a href'));
} catch (error) {
  check('the suite ran to the end', false, error?.stack?.split('\n').slice(0, 3).join(' ') || String(error));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
