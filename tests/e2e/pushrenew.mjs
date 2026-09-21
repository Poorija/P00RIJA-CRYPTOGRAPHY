/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A switch that says "on" has to mean the phone will ring.
 *
 * Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
 *
 *   PORT=8123 npm run dev         # terminal 1
 *   PKG_URL=http://localhost:8123 node tests/e2e/pushrenew.mjs
 *
 * registerWebPushSubscription() was reachable from exactly two places: the
 * background-notifications switch, and the retention dropdown beside it. Nothing
 * ran it when the app started. A push endpoint does not last forever — the
 * browser rotates it, and the relay drops it for good on a 404/410 — so once it
 * went, it stayed gone: the relay had no row to push to, and Settings went on
 * showing a switch in the "on" position with nothing behind it. The only way
 * back was to turn it off and on again, which nobody can be expected to guess.
 *
 * This drives the real page against a stubbed PushManager, because no headless
 * browser has a push service and the question here is not whether a real vendor
 * accepts a subscription — it is whether the app notices that its own has gone
 * and says something true about it. */
import { chromium } from 'playwright';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['notifications'] });
const page = await context.newPage();

/* The stub stands in for the engine: it records what the app asked for, and can
   be told that the subscription has vanished — which is the case under test. */
await page.addInitScript(() => {
  window.__push = { subscribeCalls: 0, posted: [], present: true, allowSubscribe: true };
  const makeSub = () => ({
    endpoint: `https://stub.push.test/send/${Math.random().toString(36).slice(2)}`,
    options: { applicationServerKey: new Uint8Array([4, 1, 2, 3]).buffer },
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'x', auth: 'y' } }; },
    unsubscribe: async () => { window.__push.present = false; return true; },
  });
  let current = makeSub();
  const manager = {
    getSubscription: async () => (window.__push.present ? current : null),
    subscribe: async () => {
      window.__push.subscribeCalls += 1;
      if (!window.__push.allowSubscribe) {
        const error = new Error('no transient activation');
        error.name = 'NotAllowedError';
        throw error;
      }
      window.__push.present = true;
      current = makeSub();
      return current;
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ pushManager: manager }),
      getRegistration: async () => ({ pushManager: manager }),
      register: async () => ({ pushManager: manager }),
      addEventListener() {}, removeEventListener() {},
      controller: null,
    },
  });
  /* Headless Chromium reports Notification.permission as "default" even with
     the context permission granted, and the reconcile refuses to prompt — by
     design. Without this the permission gate fires first and every assertion
     below passes for the wrong reason. */
  try {
    Object.defineProperty(window.Notification, 'permission', {
      configurable: true, get: () => 'granted',
    });
  } catch (_error) { /* engine would not allow it; the check below will say so */ }
  if (!('PushManager' in window)) window.PushManager = function PushManager() {};
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input?.url || input || '');
    if (url.includes('/push/vapid-public-key')) {
      return new Response(JSON.stringify({ enabled: true, publicKey: 'BAECAw' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/push/subscribe')) {
      window.__push.posted.push({ at: Date.now(), body: init?.body ? String(init.body).slice(0, 80) : '' });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/push/unsubscribe')) return new Response('{}', { status: 200 });
    return realFetch(input, init);
  };
});

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

/* After load, not before: the app defines PoorijaChat itself, so an init-script
   stub is overwritten by the real one. The relay files a subscription under the
   chat identity, and a reconcile without one returns early and tests nothing. */
await page.evaluate(() => {
  window.PoorijaChat = { ...(window.PoorijaChat || {}), identityFingerprint: () => 'a'.repeat(64) };
});

const api = await page.evaluate(() => ({
  reconcile: typeof window.reconcileWebPushSubscription === 'function',
  register: typeof window.registerWebPushSubscription === 'function'
    || typeof registerWebPushSubscription === 'function',
  sync: typeof window.syncPushSettingsUi === 'function',
  permission: Notification.permission,
  identity: Boolean(window.PoorijaChat?.identityFingerprint?.()),
}));
check('the app exposes a reconcile entry point', api.reconcile,
  'nothing ran registerWebPushSubscription outside the two Settings controls');
check('and the settings panel can still be re-rendered', api.sync);
check('the permission gate is not what these assertions are measuring',
  api.permission === 'granted' && api.identity === true,
  `Notification.permission: ${api.permission}, identity: ${api.identity}`);

if (!api.reconcile) {
  console.log(`\n===== ${results.filter((ok) => !ok).length} failed of ${results.length} =====`);
  await browser.close();
  process.exit(1);
}

/* Push switched on and a subscription the browser still holds: the ordinary
   case after a restart. The relay may have pruned its row, so the app has to
   hand it over again — and can, without a tap, because subscribe() is not
   involved when an existing subscription is reused. */
const afterRestart = await page.evaluate(async () => {
  state.settings.notifications = true;
  state.settings.push = { ...state.settings.push, enabled: true };
  window.__push.present = true;
  window.__push.posted.length = 0;
  window.__push.subscribeCalls = 0;
  const outcome = await window.reconcileWebPushSubscription({ reason: 'test-restart' });
  return { outcome, posted: window.__push.posted.length, subscribeCalls: window.__push.subscribeCalls };
});
check('a restart re-registers the subscription with the relay', afterRestart.posted > 0,
  `${afterRestart.posted} POST(s) to /push/subscribe`);
check('and does it without asking the engine for a new one',
  afterRestart.subscribeCalls === 0,
  `${afterRestart.subscribeCalls} subscribe() call(s); a re-subscribe needs a tap on WebKit`);

/* The endpoint is gone and the engine will not hand over a new one without a
   tap — exactly what a background start looks like on iOS. */
const gone = await page.evaluate(async () => {
  window.__push.present = false;
  window.__push.allowSubscribe = false;
  window.__push.posted.length = 0;
  const outcome = await window.reconcileWebPushSubscription({ reason: 'test-lost', force: true });
  window.syncPushSettingsUi();
  const toggle = document.getElementById('pushBackgroundToggle');
  const status = document.getElementById('pushStatusHint');
  return {
    outcome,
    checked: Boolean(toggle?.checked),
    hint: String(status?.textContent || ''),
    stored: Boolean(state.settings.push?.enabled),
  };
});
check('a lost subscription is reported rather than swallowed', gone.outcome?.ok === false,
  `outcome: ${JSON.stringify(gone.outcome)}`);
check('THE SWITCH STOPS CLAIMING IT IS ON — the bug this suite exists for',
  gone.checked === false,
  `switch reads ${gone.checked ? 'on' : 'off'} while the relay has nothing to push to`);
check('and the hint says what to do about it', /./.test(gone.hint) && gone.hint.length > 8,
  gone.hint.slice(0, 80));

/* A later session where the engine will cooperate: the app recovers on its
   own rather than waiting for the person to toggle the switch twice. Each
   scenario above stands for a separate start, so it passes `force` — the
   debounce exists to stop repeats WITHIN one session, which is what the last
   assertion measures. */
const recovered = await page.evaluate(async () => {
  window.__push.allowSubscribe = true;
  window.__push.posted.length = 0;
  state.settings.push = { ...state.settings.push, enabled: true };
  const outcome = await window.reconcileWebPushSubscription({ reason: 'test-recover', force: true });
  window.syncPushSettingsUi();
  return {
    outcome,
    posted: window.__push.posted.length,
    checked: Boolean(document.getElementById('pushBackgroundToggle')?.checked),
  };
});
check('it recovers once the engine will hand over a subscription', recovered.posted > 0,
  `${recovered.posted} POST(s)`);
check('and the switch reads on again', recovered.checked === true);

/* Reconciling must not become a heartbeat: the relay does not need telling
   every time a tab is focused. */
const throttled = await page.evaluate(async () => {
  window.__push.posted.length = 0;
  for (let i = 0; i < 5; i += 1) await window.reconcileWebPushSubscription({ reason: 'test-spam' });
  return window.__push.posted.length;
});
check('repeated calls in quick succession do not hammer the relay', throttled <= 1,
  `${throttled} POST(s) across five calls`);

await browser.close();
const bad = results.filter((ok) => !ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
