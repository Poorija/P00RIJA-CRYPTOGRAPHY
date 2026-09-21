/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What arrives on a phone when a message does.
 *
 * Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
 *
 *   node tests/e2e/swnotify.mjs
 *
 * The real sw.js is loaded and its real push handler is called. Only the
 * browser facilities underneath it are substituted — the notification list,
 * the window list and the badging API — for the same reason push.mjs
 * substitutes the vendor: headless Chromium has no notification presenter, so
 * Notification.permission is 'denied' there and showNotification always
 * throws. Everything between the push payload and those three calls is the
 * shipped code.
 *
 * What it is here to hold:
 *   - a message that arrives while the app is on screen raises NO system
 *     banner, because the page already showed its own toast with the sender
 *     and the text. Two notices for one message is what the user reported.
 *   - a message that arrives while it is not raises exactly one, and several
 *     of them stay one row that counts what is behind it rather than a stack
 *     of identical lines.
 *   - the count is spoken in the language the device subscribed with.
 *   - calls keep their own row, so a missed call is not swallowed by chat.
 *   - the icon's counter follows the rows, and reading the chat clears both. */
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SW = fileURLToPath(new URL('../../sw.js', import.meta.url));
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

function loadWorker({ tagReplaces = true, engine = 'chromium' } = {}) {
  const handlers = new Map();
  const shown = [];          // the notification list the OS would be holding
  /* What the worker TELLS the page the counter should read. It must never call
     the Badging API itself — see the note in sw.js — so what is recorded here
     is the message, and a test that finds setAppBadge called instead of posted
     is the regression this exists to catch. */
  const badge = { value: null, posted: [] };
  const painted = [];       // Badging API calls the worker made itself

  let windows = [];

  const self = {
    location: new URL('https://example.test/index.html'),
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    skipWaiting() {},
    clients: {
      matchAll: async () => windows.map((w) => ({
        ...w,
        postMessage(message) {
          if (message?.type !== 'poorija-badge') return;
          badge.value = message.count;
          badge.posted.push(message.count);
        },
      })),
    },
    registration: {
      async showNotification(title, options) {
        /* On Chromium a tag replaces the row already carrying it. On WebKit it
           does not, and the rows stack — which is the engine this whole file
           exists to survive, so it is a mode rather than an assumption. */
        const row = { title, ...options, close() { const i = shown.indexOf(row); if (i >= 0) shown.splice(i, 1); } };
        const at = tagReplaces ? shown.findIndex((n) => n.tag === options.tag) : -1;
        if (at >= 0) shown.splice(at, 1, row); else shown.push(row);
      },
      async getNotifications(filter = {}) {
        return filter.tag ? shown.filter((n) => n.tag === filter.tag) : [...shown];
      },
    },
    navigator: {
      /* Both are present on every engine — that is the trap the worker has to
         avoid — so the stub always offers them and records who called. */
      userAgent: engine === 'webkit'
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      async setAppBadge(value) { painted.push(value); },
      async clearAppBadge() { painted.push('clear'); },
    },
    caches: { open: async () => ({ addAll: async () => {}, put: async () => {}, match: async () => undefined }), keys: async () => [], delete: async () => true },
  };
  const sandbox = { self, caches: self.caches, fetch: async () => { throw new Error('offline'); }, URL, console, setTimeout, clearTimeout, Promise, Response: class {}, Request: class {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SW, 'utf8'), sandbox, { filename: 'sw.js' });

  const fire = async (type, event) => {
    const waits = [];
    const payload = { ...event, waitUntil: (p) => waits.push(p) };
    for (const fn of handlers.get(type) || []) fn(payload);
    await Promise.all(waits);
  };
  return {
    shown, badge, painted,
    setWindows: (list) => { windows = list; },
    push: (payload) => fire('push', { data: { json: () => payload, text: () => JSON.stringify(payload) } }),
    pushRaw: (text) => fire('push', { data: { json: () => { throw new SyntaxError('not json'); }, text: () => text } }),
    message: (data) => fire('message', { data }),
    closeNotice: (index) => { shown[index].close(); return fire('notificationclose', { notification: shown[index] }); },
  };
}

const CHAT = { title: 'P00RIJA Cryptography', body: 'Encrypted chat update received.', tag: 'poorija-chat', lang: 'en', url: './index.html#chat', data: { kind: 'chat' } };
const ON_SCREEN = [{ visibilityState: 'visible', focused: true, url: 'https://example.test/index.html' }];
const BEHIND = [{ visibilityState: 'hidden', focused: false, url: 'https://example.test/index.html' }];

console.log('\n===== a message that lands while the app is on screen =====');
{
  const w = loadWorker();
  w.setWindows(ON_SCREEN);
  await w.push(CHAT);
  check('raises no system banner — the page already announced it', w.shown.length === 0,
    `${w.shown.length} shown`);
  check('and tells the window the counter is empty', w.badge.value === 0, String(w.badge.value));
}

console.log('\n===== a message that lands while it is not =====');
{
  const w = loadWorker();
  w.setWindows(BEHIND);
  await w.push(CHAT);
  check('raises exactly one', w.shown.length === 1, `${w.shown.length} shown`);
  check('with the relay\'s own wording and nothing added for a single one',
    w.shown[0]?.body === CHAT.body, w.shown[0]?.body);
  check('it alerts rather than updating in silence', w.shown[0]?.renotify === true, String(w.shown[0]?.renotify));
  check('and the icon counter reads one', w.badge.value === 1, String(w.badge.value));

  await w.push(CHAT);
  await w.push(CHAT);
  check('three messages stay one row, not three identical ones', w.shown.length === 1, `${w.shown.length} rows`);
  check('that row knows all three are behind it', w.shown[0]?.data?.count === 3, `count=${w.shown[0]?.data?.count}`);
  check('and says so', /3 unread/i.test(w.shown[0]?.body || ''), w.shown[0]?.body);
  check('the icon counter reads three', w.badge.value === 3, String(w.badge.value));
}

console.log('\n===== a window that is open but not in front is not on screen =====');
{
  const w = loadWorker();
  w.setWindows([{ visibilityState: 'visible', focused: false, url: 'https://example.test/index.html' }]);
  await w.push(CHAT);
  check('a visible but unfocused window still gets the banner', w.shown.length === 1,
    'another app is in front of it — the toast underneath is not being read');
}

console.log('\n===== a call keeps its own row =====');
{
  const w = loadWorker();
  w.setWindows(BEHIND);
  await w.push(CHAT);
  await w.push({ ...CHAT, body: 'Incoming encrypted call.', tag: 'poorija-call', data: { kind: 'call-invite' } });
  check('a missed call is not swallowed by the message beside it', w.shown.length === 2,
    w.shown.map((n) => n.tag).join(', '));
  check('and the counter adds both up', w.badge.value === 2, String(w.badge.value));
}

console.log('\n===== the count is spoken in the device\'s own language =====');
{
  const w = loadWorker();
  w.setWindows(BEHIND);
  await w.push({ ...CHAT, lang: 'fa', body: 'پیام رمزنگاری‌شدهٔ تازه رسید.' });
  await w.push({ ...CHAT, lang: 'fa', body: 'پیام رمزنگاری‌شدهٔ تازه رسید.' });
  check('Persian devices are counted in Persian', /خوانده‌نشده/.test(w.shown[0]?.body || ''), w.shown[0]?.body);
  const e = loadWorker();
  e.setWindows(BEHIND);
  await e.push(CHAT); await e.push(CHAT);
  check('English devices in English', /unread/i.test(e.shown[0]?.body || ''), e.shown[0]?.body);
}

console.log('\n===== the counter never outlives what it is counting =====');
{
  const w = loadWorker();
  w.setWindows(BEHIND);
  await w.push(CHAT);
  await w.push(CHAT);
  check('two are waiting', w.badge.value === 2, String(w.badge.value));
  await w.closeNotice(0);
  check('swiping the row away empties the counter', w.badge.value === 0, String(w.badge.value));

  const r = loadWorker();
  r.setWindows(BEHIND);
  await r.push(CHAT);
  await r.push(CHAT);
  await r.message({ type: 'poorija-clear-notifications' });
  check('reading the chat dismisses the rows', r.shown.length === 0, `${r.shown.length} left`);
  check('and clears the counter with them', r.badge.value === 0, String(r.badge.value));
  check('an unrelated message to the worker is left alone', await r.message({ type: 'SKIP_WAITING' }) === undefined);
}

console.log('\n===== a payload the worker cannot read does not take it down =====');
{
  const w = loadWorker();
  w.setWindows(BEHIND);
  let threw = null;
  try { await w.pushRaw('not json at all'); } catch (error) { threw = error; }
  check('an unparseable body falls back to its text and still raises a row',
    !threw && w.shown.length === 1, threw ? String(threw) : `body="${w.shown[0]?.body}"`);
  const e = loadWorker();
  e.setWindows(BEHIND);
  await e.push({ ...CHAT, body: undefined });
  check('and a payload with no body at all raises one too', e.shown.length === 1,
    `body="${e.shown[0]?.body}"`);
}

console.log('\n===== an engine that ignores the tag does not double the count =====');
{
  /* The bug a phone photographed: 1, 2, 4, 8, 16, 32, 64. iOS does not replace
     a tagged notification, so every row stayed on screen, and each row holds
     the running total — adding them up gave 2^n. */
  for (const tagReplaces of [true, false]) {
    const w = loadWorker({ tagReplaces });
    w.setWindows(BEHIND);
    const counts = [];
    for (let i = 0; i < 7; i += 1) {
      await w.push(CHAT);
      counts.push(w.shown.map((n) => n.data?.count).filter((n) => n !== undefined).pop());
    }
    const where = tagReplaces ? 'when the tag replaces (Chromium)' : 'when the tag is ignored (WebKit)';
    check(`seven messages count 1..7 ${where}`,
      counts.join(',') === '1,2,3,4,5,6,7', counts.join(','));
    check(`and seven arrivals leave one row ${where}`, w.shown.length === 1,
      `${w.shown.length} rows`);
    check(`the counter agrees ${where}`, w.badge.value === 7, String(w.badge.value));
  }
}

console.log('\n===== on Chromium the worker never paints the badge itself =====');
{
  /* setAppBadge and clearAppBadge both exist in service-worker scope and pass
     a typeof check, and calling either one from there kills the renderer — the
     window vanishes and the unlocked vault goes with it. The worker reports a
     number and the page paints it. */
  const w = loadWorker();
  w.setWindows(BEHIND);
  await w.push(CHAT);
  await w.push(CHAT);
  await w.closeNotice(0);
  await w.message({ type: 'poorija-clear-notifications' });
  await w.message({ type: 'poorija-badge-query' });
  check('not one call to the Badging API across every path', w.painted.length === 0,
    w.painted.join(', ') || 'none');
  check('the count is posted to the window instead', w.badge.posted.length >= 4,
    w.badge.posted.join(' -> '));
  check('and a window opening cold can ask for it', w.badge.posted.at(-1) === 0,
    String(w.badge.posted.at(-1)));
}

console.log('\n===== on WebKit it has to, because nothing else can =====');
{
  /* An iOS web app on the Home Screen has no page running when it is closed,
     so the icon's bubble has nobody to paint it but the worker. */
  const w = loadWorker({ engine: 'webkit', tagReplaces: false });
  w.setWindows([]);                       // the app is shut: no window at all
  await w.push(CHAT);
  await w.push(CHAT);
  await w.push(CHAT);
  check('the worker badges the icon when no window exists', w.painted.at(-1) === 3,
    w.painted.join(' -> ') || 'nothing painted');
  await w.message({ type: 'poorija-clear-notifications' });
  check('and clears it when the chat is read', w.painted.at(-1) === 'clear',
    w.painted.join(' -> '));
  const chromium = loadWorker({ engine: 'chromium', tagReplaces: false });
  chromium.setWindows([]);
  await chromium.push(CHAT);
  check('Chromium with no window still paints nothing', chromium.painted.length === 0,
    chromium.painted.join(', ') || 'none');
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
