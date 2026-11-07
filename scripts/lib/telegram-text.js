/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Everything the Telegram bot says, in Persian and in English: the kind of
 * each card, the alerts and what they mean, the server's state, the summary,
 * the commands, the help, the replies. The operator chooses the language in
 * the central panel (scripts/lib/telegram-settings.js); Persian is the
 * default, word for word what the bot always said. */

'use strict';

const fa = {
  kinds: {
    start: 'راه‌اندازی', info: 'گزارش', test: 'آزمایش هشدار', security: 'کار حساس', warn: 'هشدار', critical: 'بحرانی',
    ok: 'برطرف شد', partner: 'شراکت', peer: 'پیام رله', update: 'به‌روزرسانی', report: 'گزارش روزانه',
  },
  alertTitles: {
    disk: 'دیسک تقریباً پر است', memory: 'حافظهٔ سرور تقریباً پر است', 'relay-memory': 'حافظهٔ رله نزدیک سقف است', files: 'فایل‌های باز نزدیک سقف است',
    'turn-down': 'سرویس TURN اجرا نمی‌شود', 'turn-ports': 'ظرفیت TURN رو به پایان است', bandwidth: 'پهنای باند نزدیک سقف است', peer: 'لینک یک رلهٔ دیگر قطع است',
    'peer-via': 'لینک مستقیم برقرار نیست؛ از راه دیگر', default: 'هشدار',
  },
  resolved: (title) => `برطرف شد: ${title}`,
  stillOn: ' (هنوز ادامه دارد)',
  alert: {
    disk: (p) => `دیسک تقریباً پر است: ${p.free} آزاد از ${p.total} (${p.pct}٪). با پر شدن دیسک، صندوق پیام‌ها نوشته نمی‌شوند.`,
    memory: (p) => `حافظهٔ سرور تقریباً پر است: ${p.free} آزاد از ${p.total} (${p.pct}٪).`,
    'relay-memory': (p) => `حافظهٔ رله به ${p.pct}٪ سقف کانتینرش رسیده (${p.used} از ${p.limit}). اتصال تازه با پاسخ «پر است» رد می‌شود.`,
    files: (p) => `فایل‌های باز رله به ${p.pct}٪ سقف رسیده (${p.open} از ${p.limit}). نزدیک سقف، اتصال تازه رد می‌شود.`,
    'turn-down': () => 'سرویس TURN (coturn) اجرا نمی‌شود. تماس‌هایی که بدون رله وصل نمی‌شوند برقرار نخواهند شد.',
    'turn-ports': (p) => `ظرفیت TURN: ${p.used} از ${p.size} پورت رلهٔ coturn در استفاده است (${p.pct}٪). تماس تازه‌ای که به رله نیاز دارد ممکن است وصل نشود.`,
    bandwidth: (p) => `پهنای باند سرور: ${p.mbps} مگابیت بر ثانیه، ${p.pct}٪ ظرفیت ${p.link} مگابیتی. تماس‌های تصویری از مسیر TURN کیفیت از دست می‌دهند.`,
    'peer-via': (p) => `لینک مستقیم با رلهٔ ${p.who} ${p.minutes} دقیقه است که برقرار نیست؛ پیام‌ها و تماس‌ها از راه «${p.via}» می‌روند.`,
    peer: (p) => `ارتباط با رلهٔ ${p.who} ${p.minutes} دقیقه است که قطع است. پیام‌ها و تماس‌های بین دو رله برقرار نمی‌شوند.`,
  },
  start: { title: 'رله راه‌اندازی شد', body: 'پایش دیسک، حافظه، TURN و لینک رله‌ها روشن است.' },
  test: { title: 'پیام آزمایشی هشدار', body: 'از پنل مدیریت فرستاده شد؛ راه هشدارهای این سرور تا تلگرام برقرار است.' },
  security: { title: 'کار حساس با امضا انجام شد', body: (route, name) => `«${route}» با امضای «${name}».` },
  update: {
    staged: (v) => `نسخهٔ ${v} رسید و امضای اپراتور آن تأیید شد؛ در زمان خودش اعمال می‌شود.`,
    notifying: (v, s) => `به‌روزرسانی به ${v} تا ${s} ثانیهٔ دیگر شروع می‌شود؛ به کاربران آنلاین خبر داده شد.`,
    applying: (v) => `به‌روزرسانی به ${v} شروع شد؛ سرور چند دقیقه در دسترس نیست.`,
    done: (v) => `به‌روزرسانی به ${v} انجام شد.`,
    failed: (v, why) => `به‌روزرسانی به ${v} انجام نشد (${why}). سرور نسخهٔ قبلی را نگه داشته و دوباره خودبه‌خود تلاش نمی‌کند.`,
    titles: { staged: 'نسخهٔ تازه رسید', notifying: 'به‌روزرسانی به‌زودی', applying: 'به‌روزرسانی در حال انجام', done: 'به‌روزرسانی انجام شد', failed: 'به‌روزرسانی ناموفق' },
  },
  card: {
    titleLine: '📝', stateOfMoment: 'وضعیت همین لحظه', relay: 'رله', cluster: 'خوشهٔ', version: 'نسخهٔ',
    users: 'کاربران آنلاین', queue: 'صف آفلاین', inBoxes: (n) => ` در ${n} صندوق`, cpu: 'پردازنده', serverMemory: 'حافظهٔ سرور', relayMemory: 'حافظهٔ رله',
    of: 'از', disk: 'دیسک', links: 'لینک رله‌ها', turnOn: 'روشن', turnOff: 'خاموش', turnUnknown: 'نامعلوم', ports: 'پورت', relayUp: 'رله روشن از', serverUp: 'سرور از',
  },
  regions: { 'inside-iran': 'داخل ایران', 'outside-iran': 'خارج از ایران', none: 'بی‌خوشه' },
  fleet: {
    title: 'وضعیت سرورها', daily: 'گزارش روزانهٔ سرورها', counts: (n, a) => ` · ${n} سرور · ${a} پاسخ داد`, cluster: 'خوشهٔ',
    allLinked: ' · همهٔ لینک‌ها برقرار ✅', noAnswer: 'پاسخ نداد', serversTitle: 'سرورهای این خانواده', serversCount: (n) => ` · ${n} سرور`,
  },
  duration: { days: (d, h) => `${d} روز${h ? ` و ${h} ساعت` : ''}`, hours: (h, m) => `${h} ساعت${m ? ` و ${m} دقیقه` : ''}`, minutes: (m) => `${m} دقیقه` },
  commands: {
    status: 'وضعیت همهٔ سرورها، همین لحظه', servers: 'فهرست سرورها با نام، نشانی، خوشه و نسخه', alerts: 'مشکل‌هایی که همین حالا باز است',
    updates: 'نسخهٔ هر سرور و به‌روزرسانی آماده', version: 'نسخهٔ این رله', mute: 'بی‌صدا کردن پیام‌ها (مثلاً /mute 2h)', unmute: 'برداشتن بی‌صدایی', help: 'راهنمای ربات',
  },
  help: {
    title: 'ربات پایش سرورهای P00RIJA', from: (label) => `این ربات از <b>${label}</b> پیام می‌فرستد و هشدار همهٔ سرورهای خانواده را می‌رساند.`,
    tail: 'هشدارها خودشان می‌آیند: دیسک، حافظه، TURN، قطع لینک رله‌ها، کارهای حساس، شراکت‌ها، و راه‌اندازی هر سرور. هر روز هم یک گزارش از همه.',
  },
  replies: {
    noProblems: '✅ همین حالا مشکلی باز نیست.', problems: 'مشکل‌های باز', muted: (until) => `🔕 پیام‌ها تا ${until} بی‌صدا هستند؛ پیام بحرانی همچنان می‌رسد.`,
    unmuted: '🔔 پیام‌ها دوباره با صدا می‌آیند.', badMute: 'مدت را بنویسید، مثلاً /mute 30m یا /mute 2h (حداکثر ۷ روز).',
    versionOf: (label, v, b) => `🏷 <b>${label}</b>: نسخهٔ <code>${v}</code>${b ? ` (${b})` : ''}`, updatesTitle: 'نسخهٔ سرورها', staged: 'آماده', none: '—',
  },
  buttons: { mute: '🔕 بی‌صدا ۱ ساعت', status: '📡 وضعیت' },
  timeSuffix: ' به وقت ', at: ' ساعت ',
};

const en = {
  kinds: {
    start: 'Started', info: 'Report', test: 'Alert test', security: 'Sensitive action', warn: 'Warning', critical: 'Critical',
    ok: 'Resolved', partner: 'Partnership', peer: 'Relay message', update: 'Update', report: 'Daily report',
  },
  alertTitles: {
    disk: 'The disk is nearly full', memory: 'The server’s memory is nearly full', 'relay-memory': 'The relay’s memory is near its ceiling', files: 'Open files are near the ceiling',
    'turn-down': 'The TURN service is not running', 'turn-ports': 'TURN capacity is running out', bandwidth: 'Bandwidth is near its ceiling', peer: 'The link to another relay is down',
    'peer-via': 'No direct link; going another way', default: 'Alert',
  },
  resolved: (title) => `Resolved: ${title}`,
  stillOn: ' (still going on)',
  alert: {
    disk: (p) => `The disk is nearly full: ${p.free} free of ${p.total} (${p.pct}%). A full disk stops mailboxes being written.`,
    memory: (p) => `The server’s memory is nearly full: ${p.free} free of ${p.total} (${p.pct}%).`,
    'relay-memory': (p) => `The relay’s memory is at ${p.pct}% of its container’s ceiling (${p.used} of ${p.limit}). New connections are turned away as full.`,
    files: (p) => `The relay’s open files are at ${p.pct}% of the ceiling (${p.open} of ${p.limit}). Near it, new connections are turned away.`,
    'turn-down': () => 'The TURN service (coturn) is not running. Calls that cannot connect without a relay will fail.',
    'turn-ports': (p) => `TURN capacity: ${p.used} of ${p.size} coturn relay ports in use (${p.pct}%). A new call that needs the relay may not connect.`,
    bandwidth: (p) => `Server bandwidth: ${p.mbps} Mbit/s, ${p.pct}% of the ${p.link} Mbit/s link. Video calls over TURN lose quality.`,
    'peer-via': (p) => `The direct link to relay ${p.who} has been down for ${p.minutes} minutes; messages and calls go through “${p.via}”.`,
    peer: (p) => `The link to relay ${p.who} has been down for ${p.minutes} minutes. Messages and calls between the two relays do not get through.`,
  },
  start: { title: 'The relay started', body: 'Watching the disk, memory, TURN and the links to the other relays.' },
  test: { title: 'Alert test message', body: 'Sent from the panel; this server’s alerts reach Telegram.' },
  security: { title: 'A sensitive action was signed', body: (route, name) => `“${route}”, signed by “${name}”.` },
  update: {
    staged: (v) => `Version ${v} arrived and the operator’s signature on it holds; it is applied at its time.`,
    notifying: (v, s) => `The update to ${v} starts in ${s} seconds; the users online were told.`,
    applying: (v) => `The update to ${v} has started; the server is away for a few minutes.`,
    done: (v) => `The update to ${v} is done.`,
    failed: (v, why) => `The update to ${v} failed (${why}). The server keeps the previous version and does not retry by itself.`,
    titles: { staged: 'A new version arrived', notifying: 'An update is about to start', applying: 'Updating', done: 'Update done', failed: 'Update failed' },
  },
  card: {
    titleLine: '📝', stateOfMoment: 'State at this moment', relay: 'relay', cluster: 'Cluster', version: 'Version',
    users: 'Users online', queue: 'Offline queue', inBoxes: (n) => ` in ${n} mailboxes`, cpu: 'CPU', serverMemory: 'Server memory', relayMemory: 'Relay memory',
    of: 'of', disk: 'Disk', links: 'Relay links', turnOn: 'on', turnOff: 'off', turnUnknown: 'unknown', ports: 'ports', relayUp: 'Relay up for', serverUp: 'server for',
  },
  regions: { 'inside-iran': 'inside Iran', 'outside-iran': 'outside Iran', none: 'no cluster' },
  fleet: {
    title: 'Server status', daily: 'Daily server report', counts: (n, a) => ` · ${n} servers · ${a} answered`, cluster: 'Cluster',
    allLinked: ' · every link up ✅', noAnswer: 'did not answer', serversTitle: 'This family’s servers', serversCount: (n) => ` · ${n} servers`,
  },
  duration: { days: (d, h) => `${d} day${d === 1 ? '' : 's'}${h ? ` ${h} h` : ''}`, hours: (h, m) => `${h} h${m ? ` ${m} min` : ''}`, minutes: (m) => `${m} min` },
  commands: {
    status: 'Every server’s state, right now', servers: 'The servers by name, address, cluster and version', alerts: 'The problems open right now',
    updates: 'Each server’s version and any update ready', version: 'This relay’s version', mute: 'Silence messages (e.g. /mute 2h)', unmute: 'End the silence', help: 'What the bot does',
  },
  help: {
    title: 'P00RIJA server monitor', from: (label) => `This bot sends from <b>${label}</b> and passes on every server of the family’s alerts.`,
    tail: 'Alerts come by themselves: disk, memory, TURN, relay links down, sensitive actions, partnerships, updates, and each server starting. Every day a report of them all.',
  },
  replies: {
    noProblems: '✅ No problem is open right now.', problems: 'Open problems', muted: (until) => `🔕 Messages are silent until ${until}; a critical one still comes through.`,
    unmuted: '🔔 Messages come with sound again.', badMute: 'Give a length, such as /mute 30m or /mute 2h (7 days at most).',
    versionOf: (label, v, b) => `🏷 <b>${label}</b>: version <code>${v}</code>${b ? ` (${b})` : ''}`, updatesTitle: 'Server versions', staged: 'ready', none: '—',
  },
  buttons: { mute: '🔕 Mute 1 h', status: '📡 Status' },
  timeSuffix: ' ', at: ' ',
};

const CATALOG = { fa, en };
const textFor = (lang) => CATALOG[lang] || fa;

module.exports = { textFor, LANGUAGES: Object.keys(CATALOG) };
