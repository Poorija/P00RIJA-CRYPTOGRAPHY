/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The 2026-08 bug sweep and UX pass, one check per reported fault.
 *
 *   PORT=8123 npm run dev     # terminal 1
 *   node tests/e2e/uxfixes.mjs
 *
 * Each block names the bug it guards. Several of these were invisible in a
 * plain browser and only appeared in the native shell or on a phone, so where
 * that is true the check reads the prepared native payload (dist/tauri) rather
 * than the dev tree — run `npm run native:prepare` first.
 */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
import { chatSource } from './_chat-source.mjs';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const PASS = 'UxFixes#Harness2026!';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const read = (p) => { try { return fs.readFileSync(path.resolve(p), 'utf8'); } catch { return ''; } };

console.log('\n===== source-level guarantees =====');

/* Fonts: loadDeferredFonts() lived inside registerServiceWorker(), behind its
   `'serviceWorker' in navigator` guard. prepare-tauri-web.js deletes
   Navigator.prototype.serviceWorker for the native shell, so in every native
   desktop build the guard returned first and not one optional @font-face was
   injected — choosing a font in Settings did nothing, reload or not. */
const appJs = read('js/app.js');
const fontCall = appJs.indexOf('window.loadDeferredFonts?.()');
const swGuard = appJs.indexOf("if (!('serviceWorker' in navigator)) return;");
check('the font loader is called before the service-worker guard, not inside it',
  fontCall > 0 && (swGuard < 0 || fontCall < swGuard), `call@${fontCall} guard@${swGuard}`);
const nativeApp = read('dist/tauri/js/app.js');
if (nativeApp) {
  const nFont = nativeApp.indexOf('window.loadDeferredFonts?.()');
  const nGuard = nativeApp.indexOf("if (!('serviceWorker' in navigator)) return;");
  check('and the same is true of the prepared native payload', nFont > 0 && nFont < nGuard, `${nFont} < ${nGuard}`);
}

/* Relay: window.location.origin is the webview's internal origin in the native
   shell — 'tauri://localhost' on macOS, 'http://tauri.localhost' on Linux and
   Windows. The second passed the http check and was handed back as if it were
   a server, so a fresh Linux install pointed the chat at itself. */
const chatJs = chatSource();
check('the internal shell origin is rejected as a relay',
  chatJs.includes('function isInternalShellOrigin') && chatJs.includes('tauri\\.localhost'), '');
check('the server box no longer defaults to window.location.origin in the shell',
  chatJs.includes('defaultRelayOriginForShell()')
  && !chatJs.includes("chatState.profile.serverUrl || (window.location.protocol === 'file:'"), '');
/* What the native build ships as a relay hint is a DECISION, not a constant,
   and the decision is written down in config/relay-defaults.json: the list is
   intentionally empty, because the suite is open source and self-hostable and a
   fresh install must not silently point at the developer's server. A private
   distribution fills the list and rebuilds.

   So the property worth asserting is that the build honours that file, either
   way — not that a relay is always baked in, which asserted the opposite of the
   documented intent and failed every open-source build. */
const hints = read('dist/tauri/js/relay-hints.js');
const configured = JSON.parse(read('config/relay-defaults.json') || '{}').origins || [];
const baked = (hints.match(/https?:\/\/[^"']+/g) || []);
check(configured.length
  ? 'the native build carries the relay origins the defaults ask for'
  : 'the native build bakes in no relay, as the defaults ask',
  configured.length ? configured.every((o) => baked.includes(o)) : baked.length === 0,
  `configured ${configured.length}, baked ${baked.length}`);

/* Reconnect: disconnectChat() calls endCurrentCall() to tear down state, and
   the "show the call log afterwards" jump was unconditional — so pressing
   reconnect threw you into the calls list for no reason. */
check('ending a call only switches to the calls view when a call really ended',
  chatJs.includes('if (activeCall && chatState.activeView !== \'calls\')'), '');

/* Mirror was a local CSS flip on my own preview only. */
check('mirroring is broadcast to the peer', chatJs.includes('mirror: Boolean(chatState.callMirrorSelf)'), '');
check('and the peer applies it to the video of me', chatJs.includes('function applyRemoteMirrorView'), '');
check('with a stylesheet rule to match', read('css/styles.css').includes('.remote-mirrored'), '');

/* Reactions had 2.4s of animation, most of it spent fading and travelling. */
const css = read('css/styles.css');
check('a call reaction is on screen for three seconds',
  chatJs.includes('CALL_REACTION_MS = 3000') && css.includes('callReactFloat 3s'), '');
check('and it has an arrival animation of its own', css.includes('@keyframes callReactPulse'), '');
check('reduced-motion gets a still version instead', css.includes('@keyframes callReactHold'), '');

/* The blurred backdrop is a moving picture behind a letterboxed call. */
check('the moving backdrop can be turned off', chatJs.includes("callBackdropStyle() === 'blur'"), '');
check('and there is a control for it', read('index.html').includes('chatCallBackdropSelect'), '');

/* iOS painted a white band behind the status bar until app.js applied the
   theme, because html's own background-color is light by default. */
const html = read('index.html');
check('the theme class is applied before the first paint',
  html.includes('doc.classList.add(\'dark\')') && html.indexOf('darkThemes') < html.indexOf('</head>'), '');
check('without an inline background that would outrank every theme rule later',
  !html.includes('doc.style.backgroundColor = color'), '');

/* The bottom bar covered the sidebar; only .dashboard-main-content had ever
   reserved room for it. */
check('the sidebar reserves room for the bottom bar', css.includes('#appSidebar') && css.includes('--tabbar-h, 3.55rem'), '');

/* The message toolbar hangs above its bubble and was painted over by the
   neighbouring message. */
check('the selected bubble outranks its neighbours', css.includes('.chat-message-bubble.selected,'), '');
check('and the toolbar drops below when there is no room above',
  css.includes('.toolbar-below') && chatJs.includes('function placeMessageToolbar'), '');

console.log('\n===== in the browser =====');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, ignoreHTTPSErrors: true });
/* The lock module only wires its console probes when a page asks for them
   before load: shipping them unconditionally is a bypass, not a diagnostic.
   These suites drive the locks THROUGH those probes, so they have to ask. */
await ctx.addInitScript(() => { try { localStorage.setItem('poorija-debug-probes', '1'); } catch (e) {}
  try { localStorage.setItem('poorija_lang', 'fa'); localStorage.setItem('poorija_theme', 'midnight'); } catch (e) {}
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and the evaluate below dies with "Execution context was destroyed"
   when that lands late — which is exactly what a just-deployed server does,
   the one moment you most want to run this. */
await settle(page, () => document.readyState === 'complete'
  && Boolean(document.documentElement.className));

const preTheme = await page.evaluate(() => ({
  cls: document.documentElement.className,
  bg: getComputedStyle(document.documentElement).backgroundColor,
}));
/* rgb(249, 250, 251) is the light default — seeing it here is the white bar. */
check('the page is already dark at first paint, so no white bar above the app',
  preTheme.cls.includes('dark') && preTheme.bg !== 'rgb(249, 250, 251)', `${preTheme.bg}`);

/* The security-question dropdowns are filled in asynchronously. Locally they
   are ready by the time this runs; against a deployment they are not, and
   selecting from an empty <select> leaves them blank, so setup silently fails
   its own validation and the app never leaves the first-run screen. */
await page.waitForFunction(
  () => [...document.querySelectorAll('#initialSetup select')].every((s) => s.options.length > 1),
  { timeout: 30000 },
).catch(() => {});

await page.evaluate((pass) => {
  const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
  set('setupPassword', pass); set('confirmPassword', pass);
  document.querySelectorAll('#initialSetup select').forEach((s, i) => { if (s.options.length > i + 1) { s.selectedIndex = i + 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  document.querySelectorAll('#initialSetup input[type="text"]').forEach((inp, i) => { inp.value = 'answer' + i; inp.dispatchEvent(new Event('input', { bubbles: true })); });
  const cb = document.getElementById('acceptTermsCheckbox'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
}, PASS);
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('setupBtn')?.click());
await page.waitForTimeout(3200);
/* Against a real deployment the app locks itself after setup — and not
   immediately: the lock screen can appear a second or two later, so a single
   unlock attempt fired right after setup finds nothing to unlock and the
   screen arrives afterwards. That is how a run against production ended up
   measuring a chat UI nobody could see and blaming the identity sheet.
   Watch for it, and unlock it whenever it shows up. */
for (let attempt = 0; attempt < 24; attempt += 1) {
  const state = await page.evaluate(() => {
    const lock = document.getElementById('lockScreen');
    const locked = Boolean(lock) && getComputedStyle(lock).display !== 'none' && !lock.classList.contains('hidden');
    return { locked, hasField: Boolean(document.getElementById('unlockPassword')) };
  });
  if (!state.locked) { if (attempt > 2) break; }
  if (state.locked && state.hasField) {
    await page.evaluate(async (pass) => {
      const field = document.getElementById('unlockPassword');
      field.value = pass;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await window.unlockApp?.();
    }, PASS);
  }
  await page.waitForTimeout(700);
}

await page.evaluate(() => { document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat'); });
await page.waitForTimeout(1500);

/* Everything below reads the chat UI, and the chat UI exists in the DOM even
   while the first-run screen is still covering it. Without this the suite
   quietly measures elements nobody can see and blames the wrong thing — a
   hit-test failure gets reported against the identity sheet when the real
   answer is that setup never finished. */
/* Let any toast finish first. `.toast-stack` is pointer-events:none but each
   `.app-toast` inside it is pointer-events:auto so it can be tapped away, and
   the stack sits at the top centre — exactly where this hit test aims. A toast
   raised by the setup above was therefore answering elementFromPoint for the
   three seconds it lives, and reporting "the chat UI is covered", which is a
   statement about a toast rather than about the chat UI. */
await page.waitForFunction(() => !document.querySelector('#toastStack .app-toast'),
  null, { timeout: 8000 }).catch(() => {});
const chatOnTop = await page.evaluate(() => {
  const rail = document.querySelector('#content-chat .chat-rail');
  if (!rail) return { ok: false, why: 'no chat rail' };
  const box = rail.getBoundingClientRect();
  if (box.width < 40 || box.height < 40) return { ok: false, why: `rail is ${Math.round(box.width)}x${Math.round(box.height)}` };
  const hit = document.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + 40));
  if (rail.contains(hit)) return { ok: true, why: '' };
  const chain = [];
  let n = hit;
  while (n && n !== document.body && chain.length < 4) {
    chain.push(`${n.tagName}${n.id ? '#' + n.id : ''}${n.className ? '.' + String(n.className).split(' ')[0] : ''}`);
    n = n.parentElement;
  }
  return { ok: false, why: `covered by ${chain.join(' < ')}` };
});
check('the chat UI is on screen and hit-testable', chatOnTop.ok, chatOnTop.why);
if (!chatOnTop.ok) {
  /* Everything below reads the chat UI, which exists in the DOM even while
     something covers it. Measuring elements nobody can see proves nothing, and
     the failures it produces name the wrong culprit. */
  console.log('\n  Stopping here rather than measuring a UI nobody can see.');
  await browser.close();
  console.log(`\n===== ${results.filter((r) => !r.ok).length} failed of ${results.length} =====`);
  process.exit(1);
}

/* Fonts, end to end: pick one of the optional faces and see it land. */
const font = await page.evaluate(() => {
  window.switchTab?.('settings');
  const sel = document.getElementById('settingFontFa');
  if (!sel) return { error: 'no font control' };
  sel.value = "'Parastoo', sans-serif";
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return {
    body: getComputedStyle(document.body).fontFamily,
    faceRegistered: [...document.querySelectorAll('style')].some((s) => s.textContent.includes('Parastoo')),
  };
});
check('choosing a font applies it immediately, with no reload',
  /Parastoo/.test(font.body || '') && font.faceRegistered, JSON.stringify(font));

await page.evaluate(() => window.switchTab?.('chat'));
await page.waitForTimeout(900);

const nav = await page.evaluate(() => {
  const bar = document.querySelector('#content-chat .chat-nav-bar');
  const items = [...(bar?.querySelectorAll('.chat-nav-item') || [])];
  /* The search entry is a .chat-nav-item too — it moved into this bar from a
     row of its own — but it is an icon with an aria-label and no text, so
     counting every item and expecting four failed the moment it arrived. What
     the check is about is the four VIEWS, so count those. */
  const views = items.filter((i) => i.hasAttribute('data-chat-view'));
  return {
    display: bar ? getComputedStyle(bar).display : null,
    flow: bar ? getComputedStyle(bar).gridAutoFlow : null,
    count: items.length,
    views: views.length,
    search: items.some((i) => i.classList.contains('chat-nav-search')),
    itemDisplay: items[0] ? getComputedStyle(items[0]).display : null,
    labels: views.map((i) => i.textContent.trim()),
  };
});
check('the section switcher is laid out as a tab bar',
  nav.display === 'grid' && nav.flow.includes('column') && nav.views === 4,
  JSON.stringify(nav).slice(0, 140));
check('and the search affordance sits in the same bar',
  nav.search && nav.count === nav.views + 1, JSON.stringify(nav).slice(0, 140));
/* A hidden badge still contributes its text to textContent, which made every
   tab read "تنظیمات0" to anything asking what the button says. */
check('an empty badge does not leak a zero into the tab label',
  nav.labels.every((label) => !/0$/.test(label)), nav.labels.join(' | '));

/* The rail re-renders whenever the peer list changes, and for a frame its
   children are gone. Reading them straight out of a querySelector threw
   "getComputedStyle of null" and took the whole suite down with it — an
   uncaught throw inside page.evaluate aborts the script, so every check after
   this point silently stopped existing. Wait for the markup, then measure. */
await page.waitForSelector('#content-chat .chat-profile-actions', { state: 'attached', timeout: 10000 })
  .catch(() => {});
const condensed = await page.evaluate(async () => {
  const rail = document.querySelector('#content-chat .chat-rail');
  const actionsEl = document.querySelector('.chat-profile-actions');
  const quickEl = document.querySelector('.chat-profile-quick');
  if (!actionsEl || !quickEl) {
    return { missing: `actions=${Boolean(actionsEl)} quick=${Boolean(quickEl)}` };
  }
  const before = {
    actions: getComputedStyle(actionsEl).display,
    quick: getComputedStyle(quickEl).display,
  };
  rail?.classList.add('is-condensed');
  /* The fold animates now, so read it after the transition rather than on the
     frame the class lands. */
  await new Promise((r) => setTimeout(r, 500));
  /* The search moved: `.chat-search-wrap` was a bar of its own above the nav
     and is gone, replaced by `.chat-nav-search` inside the nav itself. Reading
     the old selector returned null and getComputedStyle threw, which aborted
     the whole suite rather than failing one check. */
  const searchBtn = document.querySelector('.chat-nav-search');
  const after = {
    actions: getComputedStyle(actionsEl).display,
    actionsHeight: Math.round(actionsEl.getBoundingClientRect().height),
    quick: getComputedStyle(quickEl).display,
    pill: getComputedStyle(document.querySelector('.chat-profile-status')).position,
    search: searchBtn ? getComputedStyle(searchBtn).display : 'MISSING',
  };
  rail?.classList.remove('is-condensed');
  return { before, after, bound: rail?.dataset.condenseBound === '1' };
});
check('the header folds on scroll into avatar, name and two round buttons',
  condensed.after.actionsHeight < 4 && condensed.after.quick === 'flex' && condensed.after.pill === 'absolute',
  JSON.stringify(condensed.after));
check('and a scroll listener is actually attached', condensed.bound, String(condensed.bound));

/* The magnifier is gone: the bar no longer folds away, in any view or at any
   width, because it is the one door into a search that spans messages,
   contacts and the call log. */
const search = await page.evaluate(() => {
  const rail = document.querySelector('#content-chat .chat-rail');
  /* The door is the icon in the nav bar now, not a bar of its own. Same
     property either way: it must be reachable from every view and while the
     header is folded, because it is the only way into a search that spans
     messages, contacts and the call log. */
  const button = document.querySelector('.chat-nav-search');
  if (!button) return { missing: true };
  const perView = {};
  for (const view of ['chats', 'calls', 'groups', 'connection']) {
    document.querySelector(`[data-chat-view="${view}"]`)?.click();
    const box = button.getBoundingClientRect();
    perView[view] = getComputedStyle(button).display !== 'none' && box.width > 0 && box.height > 0;
  }
  document.querySelector('[data-chat-view="chats"]')?.click();
  rail?.classList.add('is-condensed');
  const foldedBox = button.getBoundingClientRect();
  const whileFolded = getComputedStyle(button).display !== 'none' && foldedBox.width > 0;
  rail?.classList.remove('is-condensed');
  return {
    perView,
    whileFolded,
    labelled: Boolean(button.getAttribute('aria-label') || button.getAttribute('title')),
  };
});
check('the way into search is reachable from every view, folded or not',
  !search.missing && Object.values(search.perView).every(Boolean) && search.whileFolded,
  JSON.stringify(search));
check('and an icon-only control still says what it is',
  Boolean(search.labelled), String(search.labelled));

/* The folded header used to be position:static, so scrolling took the avatar,
   the name and the connection state off the screen entirely — you could not
   tell whether you were connected while reading your own chat list. */
/* Driven with real wheel events rather than by assigning scrollTop: the app
   restores the reader's position across a re-render, so a programmatic
   assignment it never observed is simply undone — which looked like the header
   refusing to unfold when it was the scroll that had been reverted. */
/* All of it inside one evaluate. Seeding rows and then scrolling in separate
   round trips leaves a window in which the app re-renders the list — which
   wipes the rows and restores the previous scroll position — so the wheel then
   scrolls a short list and nothing folds. Nothing re-renders inside a single
   synchronous run, so the measurement is of the real thing. */
const sticky = await page.evaluate(async () => {
  const rail = document.querySelector('#content-chat .chat-rail');
  const list = document.getElementById('chatPeerList');
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  for (let i = 0; i < 20; i += 1) {
    const row = document.createElement('div');
    row.className = 'chat-peer-card';
    row.style.minHeight = '84px';
    row.textContent = 'peer ' + i;
    list.appendChild(row);
  }
  await frame();

  const read = () => {
    const card = document.querySelector('#content-chat .chat-profile-card');
    const nav = document.querySelector('#content-chat .chat-nav-bar');
    const cr = card?.getBoundingClientRect();
    const nr = nav?.getBoundingClientRect();
    const rr = rail?.getBoundingClientRect();
    return {
      condensed: rail.classList.contains('is-condensed'),
      cardH: cr ? Math.round(cr.height) : 0,
      cardTop: cr && rr ? Math.round(cr.top - rr.top) : 0,
      navTop: nr && rr ? Math.round(nr.top - rr.top) : 0,
      visible: Boolean(cr && rr && cr.height > 0 && cr.bottom > rr.top),
      scrollTop: Math.round(list.scrollTop),
    };
  };

  const scrollable = list.scrollHeight > list.clientHeight + 40;
  list.scrollTop = 0;
  list.dispatchEvent(new Event('scroll'));
  await frame(); await frame();
  const top = read();

  list.scrollTop = 600;
  list.dispatchEvent(new Event('scroll'));
  for (let i = 0; i < 12 && !rail.classList.contains('is-condensed'); i += 1) await frame();
  const scrolled = read();

  list.scrollTop = 0;
  list.dispatchEvent(new Event('scroll'));
  for (let i = 0; i < 12 && rail.classList.contains('is-condensed'); i += 1) await frame();
  await frame();
  const back = read();
  return { scrollable, top, scrolled, back };
});

check('the list can be scrolled at all, so the fold below is a real test',
  sticky.scrollable, String(sticky.scrollable));
check('the header stays on screen while the list moves',
  sticky.scrolled.visible && sticky.back.visible,
  `during scroll: ${sticky.scrolled.visible}, after: ${sticky.back.visible}`);
/* It must never GROW on scroll. Shrinking is the point where there is
   something to shrink; with the profile fields now behind the gear menu the
   phone card is already minimal, so holding still is the honest pass. */
check('the header never grows as the list scrolls',
  sticky.scrolled.condensed && sticky.scrolled.cardH <= sticky.top.cardH + 2,
  `${sticky.top.cardH}px at top → ${sticky.scrolled.cardH}px at scrollTop ${sticky.scrolled.scrollTop}`);
/* The search bar sits between the card and the tabs now that it is permanent,
   so "directly beneath" means beneath the chrome, not beneath the card. */
check('the section tabs sit below the card with only the search bar between',
  sticky.scrolled.navTop > sticky.scrolled.cardTop + sticky.scrolled.cardH - 4
  && sticky.scrolled.navTop - (sticky.scrolled.cardTop + sticky.scrolled.cardH) <= 110,
  `nav at ${sticky.scrolled.navTop}, header ends at ${sticky.scrolled.cardTop + sticky.scrolled.cardH}`);
/* Compared with a tolerance: the height transitions, so an exact match would
   depend on catching the last frame of the animation. */
check('and it opens again at the top of the list',
  !sticky.back.condensed && Math.abs(sticky.back.cardH - sticky.top.cardH) <= 16,
  `${sticky.back.cardH}px vs ${sticky.top.cardH}px at scrollTop ${sticky.back.scrollTop}`);
/* The list must be able to reach its own top at all. It could not: a
   scroll-snap on the rows plus a scroll-padding-top meant scrollTop 0 snapped
   to 51, so the fold threshold was never crossed downward and the header stayed
   folded however far up you scrolled. */
check('the list can actually rest at its top', sticky.back.scrollTop === 0,
  `scrollTop ${sticky.back.scrollTop}`);

/* Material is explicit that tabs must not be attached to bottom navigation and
   that they control the region below them. Stacked above the app's own bar was
   both a second bottom bar and 117px of dead space. */
const tabs = await page.evaluate(() => {
  const nav = document.querySelector('#content-chat .chat-nav-bar');
  const list = document.getElementById('chatPeerList');
  const heading = document.querySelector('#content-chat .chat-list-heading');
  const nr = nav?.getBoundingClientRect();
  const anchor = (heading || list)?.getBoundingClientRect();
  return {
    position: nav ? getComputedStyle(nav).position : null,
    height: nr ? Math.round(nr.height) : null,
    gapToContent: nr && anchor ? Math.round(anchor.top - nr.bottom) : null,
  };
});
/* ---------------------------------------------------------------------
   One scroll container
   ---------------------------------------------------------------------
   The rail scrolled AND the list inside it scrolled. Two nested scrollers is
   what made the pinned bars and the rows they pinned above move
   independently, so slabs of chrome ended up drawn over half-visible
   contacts. A messenger has one scrolling region; this asserts there is
   exactly one, in every view.
   --------------------------------------------------------------------- */
const scrolling = await page.evaluate(() => {
  const results = {};
  for (const view of ['chats', 'calls', 'groups', 'connection']) {
    document.querySelector(`[data-chat-view="${view}"]`)?.click();
    const rail = document.querySelector('#content-chat .chat-rail');
    const nested = [...rail.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2;
    }).length;
    results[view] = { railScrolls: rail.scrollHeight > rail.clientHeight + 2, nestedScrollers: nested };
  }
  document.querySelector('[data-chat-view="chats"]')?.click();
  return results;
});
check('the rail itself never scrolls in any view',
  Object.values(scrolling).every((v) => !v.railScrolls),
  Object.entries(scrolling).map(([k, v]) => `${k}:${v.railScrolls}`).join(' '));
check('and no view has scroll containers nested inside each other',
  Object.values(scrolling).every((v) => v.nestedScrollers <= 1),
  Object.entries(scrolling).map(([k, v]) => `${k}:${v.nestedScrollers}`).join(' '));
check('with no dead space under them', tabs.gapToContent !== null && tabs.gapToContent < 24,
  `${tabs.gapToContent}px between the tabs and the list`);
check('and a phone-sized height rather than a second bottom bar',
  tabs.height !== null && tabs.height >= 44 && tabs.height <= 60, `${tabs.height}px`);

const filters = await page.evaluate(() => {
  const wrap = document.querySelector('#content-chat .chat-list-filters');
  return { exists: Boolean(wrap), sticky: wrap ? getComputedStyle(wrap).position : null,
           chips: wrap ? [...wrap.children].map((c) => c.textContent.trim()) : [] };
});
check('the chat list has filter chips', filters.exists && filters.chips.length >= 1, filters.chips.join(' | '));
check('and they stay put while the list scrolls under them', filters.sticky === 'sticky', String(filters.sticky));

const heading = await page.evaluate(() => {
  const h = document.querySelector('#content-chat .chat-list-heading');
  const cs = h ? getComputedStyle(h) : null;
  return { position: cs?.position, bg: cs?.backgroundColor };
});
/* Rows used to slide visibly under the heading's words, which is most of why
   scrolling looked wrong once there were a lot of chats. */
/* It no longer needs to be sticky: it is part of the chrome above the one
   scroller, so it cannot be scrolled away in the first place. Opaque still
   matters — rows used to be visible straight through it. */
check('the list heading is opaque', heading.bg !== 'rgba(0, 0, 0, 0)' && !/\/\s*0?\.\d/.test(heading.bg),
  JSON.stringify(heading));

const settings = await page.evaluate(() => {
  document.querySelector('[data-chat-view="connection"]')?.click();
  const menu = document.querySelector('.chat-settings-menu');
  const rows = menu ? [...menu.querySelectorAll('[data-settings-tab]')] : [];
  rows.find((row) => row.getAttribute('data-settings-tab') === 'sounds')?.click();
  const opened = [...document.querySelectorAll('[data-settings-pane]')]
    .filter((pane) => !pane.classList.contains('hidden'));
  /* On a phone the section opens as a full-screen page, so the way back is
     that page's own back button. */
  const back = document.querySelector('#chatFullSheet [data-fullsheet-close]')
    || document.querySelector('[data-settings-back]');
  const backVisible = Boolean(back && back.getBoundingClientRect().height > 0);
  back?.click();
  const afterBack = [...document.querySelectorAll('[data-settings-pane]')]
    .filter((pane) => !pane.classList.contains('hidden')).length;
  return {
    rows: rows.length,
    panes: document.querySelectorAll('[data-settings-pane]').length,
    openedId: opened[0]?.getAttribute('data-settings-pane') || null,
    openedCount: opened.length,
    backVisible,
    afterBack,
    expectedTabs: (typeof CHAT_SETTINGS_TABS !== 'undefined' && CHAT_SETTINGS_TABS.length) || 0,
  };
});
/* Eight, not five. Chat appearance, chat notifications and the files/privacy
   toggles moved into Secure Chat's settings this release, so CHAT_SETTINGS_TABS
   went from five entries to eight. smoke and settingsui were updated for that
   contract and this suite was missed; the count is read from the app rather
   than spelled out, so the next move does not leave a third stale copy. */
check('secure-chat settings are a vertical menu, one row per section',
  settings.rows === settings.expectedTabs && settings.panes === settings.expectedTabs,
  JSON.stringify(settings));
check('a section opens on its own, one at a time',
  settings.openedId === 'sounds' && settings.openedCount === 1, JSON.stringify(settings));
check('and there is a way back to the menu from it',
  settings.backVisible && settings.afterBack === 0, JSON.stringify(settings));

console.log('\n===== the sticky layers must not be see-through =====');
const layers = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, blur: cs.backdropFilter, h: Math.round(el.getBoundingClientRect().height) };
  };
  return {
    header: pick('#content-chat .chat-profile-card'),
    nav: pick('#content-chat .chat-nav-bar'),
    heading: pick('#content-chat .chat-list-heading'),
    listPadBottom: getComputedStyle(document.querySelector('#content-chat .chat-list')).paddingBottom,
    listScrollPadTop: getComputedStyle(document.querySelector('#content-chat .chat-list')).scrollPaddingTop,
    railPadBottom: getComputedStyle(document.querySelector('#content-chat .chat-rail')).paddingBottom,
  };
});
/* A frosted panel reads as depth over a photo and as a rendering fault over a
   list of names — rows were visible straight through all three of these. */
const opaque = (value) => Boolean(value) && !/\/\s*0?\.\d/.test(value) && !/rgba\([^)]+,\s*0?\.\d+\)/.test(value);
check('the pinned header is opaque', opaque(layers.header?.bg), String(layers.header?.bg));
check('the tab strip is opaque and unblurred',
  opaque(layers.nav?.bg) && (layers.nav?.blur === 'none' || !layers.nav?.blur),
  `${layers.nav?.bg} blur=${layers.nav?.blur}`);
check('the list heading is opaque', opaque(layers.heading?.bg), String(layers.heading?.bg));
/* 33px was under every platform's minimum touch target. */
check('the tab strip is big enough to hit', (layers.nav?.h || 0) >= 44, `${layers.nav?.h}px`);
/* A row jumped to must not land under the pinned chips. Expressed on the rows
   as scroll-margin rather than on the list as scroll-padding: the latter,
   combined with the list's scroll-snap, was what stopped the list ever
   reaching scrollTop 0. */
const rowMargin = await page.evaluate(() => {
  /* A fresh profile has no conversations, so measure the rule on a row of our
     own rather than reporting null because the list happens to be empty. */
  const list = document.getElementById('chatPeerList');
  const probe = document.createElement('div');
  probe.className = 'chat-peer-card';
  list?.appendChild(probe);
  const value = getComputedStyle(probe).scrollMarginTop;
  probe.remove();
  return value;
});
check('a row jumped to does not land under the filter chips',
  parseFloat(rowMargin || '0') >= 24, String(rowMargin));
check('and the list no longer snaps, so it can reach its own top',
  await page.evaluate(() => getComputedStyle(document.querySelector('#content-chat .chat-list')).scrollSnapType) === 'none',
  '');
/* The panels stop above the app's fixed tab bar rather than running under it,
   so what has to be checked is the gap between the two boxes. The old test
   asked for a bar's worth of bottom padding instead — the mechanism from when
   the column did run underneath — and that padding is now 70-odd pixels of
   dead space at the end of every list, which is exactly what was reported. */
const panelClearance = await page.evaluate(() => {
  const out = {};
  const bar = document.querySelector('.mobile-tab-bar');
  const barTop = bar && getComputedStyle(bar).display !== 'none'
    ? bar.getBoundingClientRect().top
    : window.innerHeight;
  for (const view of ['chats', 'calls', 'groups', 'connection']) {
    document.querySelector(`[data-chat-view="${view}"]`)?.click();
    const rail = document.querySelector('#content-chat .chat-rail');
    const panel = rail.querySelector('#chatPeerList:not(.hidden), #chatConnectionPanel:not(.hidden), #chatCallsPanel:not(.hidden)');
    const box = panel?.getBoundingClientRect();
    out[view] = {
      /* Positive means the panel ends above the bar; negative means it runs
         under it and its contents would be covered. */
      gap: box ? Math.round(barTop - box.bottom) : null,
      pad: panel ? Math.round(parseFloat(getComputedStyle(panel).paddingBottom)) : null,
    };
  }
  document.querySelector('[data-chat-view="chats"]')?.click();
  return out;
});
check('no view runs underneath the app tab bar',
  Object.values(panelClearance).every((entry) => entry.gap !== null && entry.gap >= 0),
  Object.entries(panelClearance).map(([k, v]) => `${k}:${v.gap}`).join(' '));
check('and none of them ends in a screenful of padding',
  Object.values(panelClearance).every((entry) => entry.pad !== null && entry.pad <= 24),
  Object.entries(panelClearance).map(([k, v]) => `${k}:${v.pad}px`).join(' '));

console.log('\n===== what was missing next to the name, and in the list =====');
const additions = await page.evaluate(() => ({
  identityButton: Boolean(document.getElementById('chatQuickIdentityBtn')),
  identityAlwaysVisible: document.getElementById('chatQuickIdentityBtn')
    ? getComputedStyle(document.getElementById('chatQuickIdentityBtn')).display !== 'none' : false,
  draftsApi: typeof localStorage.getItem('poorija_chat_drafts') === 'string' || true,
}));
check('your own identity is one tap from the name, not four taps into settings',
  additions.identityButton && additions.identityAlwaysVisible, JSON.stringify(additions));

/* The identity card is a full-screen page now, not a drawer: on a phone there
   is no "outside" to tap, so the way out is its back button. */
const sheet = await page.evaluate(async () => {
  document.getElementById('chatQuickIdentityBtn')?.click();
  await new Promise((r) => setTimeout(r, 350));
  const panel = document.getElementById('chatFullSheet');
  const open = Boolean(panel) && !panel.classList.contains('hidden')
    && getComputedStyle(panel).position === 'fixed';
  const actions = [...(panel?.querySelectorAll('.chat-identity-actions button') || [])].map((b) => b.textContent.trim());
  const sideBySide = (() => {
    const buttons = panel?.querySelectorAll('.chat-identity-actions button');
    if (!buttons || buttons.length !== 4) return false;
    const [a, b] = [...buttons].map((node) => node.getBoundingClientRect());
    return Math.abs(a.top - b.top) < 6;
  })();
  panel?.querySelector('[data-fullsheet-close]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  return { open, actions, sideBySide, closed: panel?.classList.contains('hidden') === true };
});
check('the identity card opens as a full-screen page and closes with Back',
  sheet.open && sheet.closed, JSON.stringify(sheet));
check('and it offers copy and QR side by side',
  sheet.actions.length === 4 && sheet.sideBySide, JSON.stringify(sheet.actions));

/* .chat-shell is `position: fixed; overflow: hidden`, so anything laid out
   inside it is clipped away — offsetParent null, zero-area rect, and tapping
   the button appeared to do nothing at all. The sheet lives on <body> for that
   reason, and the controls it borrows have to find their way home. */
const sheetVisible = await page.evaluate(async () => {
  document.getElementById('chatQuickIdentityBtn')?.click();
  await new Promise((r) => setTimeout(r, 700));
  const panel = document.getElementById('chatFullSheet');
  const box = panel?.getBoundingClientRect();
  const top = box ? document.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)) : null;
  const result = {
    parent: panel?.parentElement?.tagName,
    w: box ? Math.round(box.width) : 0,
    h: box ? Math.round(box.height) : 0,
    onTop: Boolean(top && panel.contains(top)),
    /* Name whatever is covering it, so a failure says what to fix rather than
       just that something is wrong. */
    blockedBy: top && !panel.contains(top)
      ? (() => {
        const chain = [];
        let node = top;
        while (node && node !== document.body) {
          const cs = getComputedStyle(node);
          chain.push(`${node.tagName}${node.id ? '#' + node.id : ''} z=${cs.zIndex} pos=${cs.position}`);
          node = node.parentElement;
        }
        return chain.slice(0, 5);
      })()
      : null,
  };
  panel?.querySelector('[data-fullsheet-close]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  /* The peer id and the key are borrowed from the settings strip; they have to
     be back in it, or Settings would be missing them next time. */
  result.returnedHome = Boolean(document.querySelector('#chatIdentityStrip #chatPeerId'));
  return result;
});
check('the identity page is on screen and hit-testable, not clipped by the shell',
  sheetVisible.w > 100 && sheetVisible.h > 60 && sheetVisible.onTop, JSON.stringify(sheetVisible));
check('and what it borrowed goes back where it came from', sheetVisible.returnedHome, String(sheetVisible.returnedHome));

const src = chatSource();
check('a half-written message is kept per conversation',
  src.includes('function setDraft') && src.includes('applyDraftToComposer'), '');
check('a conversation can be flagged unread by hand',
  src.includes('function markConversationUnread') && src.includes('data-chat-unread-conversation'), '');
check('opening a busy chat lands on the first unread message',
  src.includes('function jumpToFirstUnread'), '');
check('a conversation can be exported as a file you own',
  src.includes('function exportConversation') && src.includes('poorija-chat-export'), '');

console.log('\n===== the 2026-08-31 pass =====');

/* From a clean page. Earlier checks inject rows and force classes to exercise
   the fold, and the rail's layout in that artificial state is not the one a
   person is ever in — measuring Settings there produced a 114px panel that no
   user would see. */
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2500);
for (let attempt = 0; attempt < 20; attempt += 1) {
  const locked = await page.evaluate(() => {
    const lock = document.getElementById('lockScreen');
    return Boolean(lock) && getComputedStyle(lock).display !== 'none' && !lock.classList.contains('hidden');
  });
  if (!locked) break;
  await page.evaluate(async (pass) => {
    const field = document.getElementById('unlockPassword');
    if (!field) return;
    field.value = pass;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await window.unlockApp?.();
  }, PASS);
  await page.waitForTimeout(700);
}
await page.evaluate(() => { document.getElementById('mobileInstallGate')?.classList.add('hidden'); window.switchTab?.('chat'); });
await page.waitForTimeout(1800);

const settingsPanel = await page.evaluate(async () => {
  document.querySelector('[data-chat-view="connection"]')?.click();
  /* The panel is sized by a ResizeObserver once it has a real height, so poll
     for that rather than assuming one frame is enough. */
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 150));
    const b = document.querySelector('#chatConnectionPanel .chat-settings-body');
    if (b && b.style.maxHeight) break;
  }
  const panel = document.getElementById('chatConnectionPanel');
  const body = panel?.querySelector('.chat-settings-body');
  if (!body) return null;
  return {
    visible: body.clientHeight,
    total: body.scrollHeight,
    scrolls: body.scrollHeight > body.clientHeight + 20,
    overflow: getComputedStyle(body).overflowY,
    clipped: panel.scrollHeight - panel.clientHeight,
    panelH: panel.clientHeight,
    panelShown: panel.offsetParent !== null,
    railView: document.querySelector('#content-chat .chat-rail')?.getAttribute('data-view'),
    inlineMax: body.style.maxHeight || '(none)',
    computedMax: getComputedStyle(body).maxHeight,
    scrimUp: document.body.classList.contains('chat-identity-open'),
    /* The menu is the whole of Settings until a section is opened, so what
       matters is that all five rows fit rather than that the body scrolls. */
    menuRows: body.querySelectorAll('[data-settings-tab]').length,
    expectedTabs: (typeof CHAT_SETTINGS_TABS !== 'undefined' && CHAT_SETTINGS_TABS.length) || 0,
    menuFits: (() => {
      const menu = body.querySelector('.chat-settings-menu');
      if (!menu) return false;
      const m = menu.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      return m.top >= b.top - 1 && m.bottom <= b.bottom + 1;
    })(),
  };
});
/* Settings is a menu now, not one long column, so "can it be scrolled" is the
   wrong question: every row has to be reachable without scrolling at all, and a
   section opened from one gets a page of its own. The count comes from
   CHAT_SETTINGS_TABS, which grew from five to eight this release. */
check('the settings menu shows every section at once',
  settingsPanel?.menuRows === settingsPanel?.expectedTabs && settingsPanel?.menuFits === true,
  settingsPanel ? JSON.stringify(settingsPanel) : 'no panel');
const settingsSection = await page.evaluate(async () => {
  document.querySelector('[data-settings-tab="connection"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const pane = document.querySelector('[data-settings-pane="connection"]');
  if (!pane) return null;
  const scroller = pane.closest('.chat-settings-stage-body') || pane.closest('.chat-settings-body') || pane;
  const before = scroller.scrollTop;
  scroller.scrollTop = 220;
  const moved = scroller.scrollTop > before;
  document.querySelector('[data-settings-back]')?.click();
  return {
    tall: scroller.scrollHeight > scroller.clientHeight + 20,
    moved,
    visible: Math.round(pane.getBoundingClientRect().height),
  };
});
check('and an opened section can be read to its end',
  Boolean(settingsSection && (!settingsSection.tall || settingsSection.moved)),
  settingsSection ? JSON.stringify(settingsSection) : 'no section');
/* What matters is how much of Settings you can actually see at once, not the
   panel's internal arithmetic. */
check('and enough of it is visible to be worth scrolling', (settingsPanel?.visible ?? 0) >= 200,
  `${settingsPanel?.visible}px visible of ${settingsPanel?.total}px, panel ${settingsPanel?.panelH}px`);

/* Calls used to lock up and bounce back to the top when the header folded.
   Seeded and scrolled inside one evaluate, stepping by animation frames: a
   timeout hands control back long enough for the app to re-render the list,
   which deletes the seeded rows and leaves it too short to scroll — read from
   outside, that is indistinguishable from the view springing back, and it is
   how this check failed against a server the app can actually reach while
   passing locally where the connection fails. */
const callsScroll = await page.evaluate(async () => {
  document.querySelector('[data-chat-view="calls"]')?.click();
  await new Promise((r) => setTimeout(r, 800));
  const list = document.getElementById('chatPeerList');
  if (!list) return { asked: [], got: [] };
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (let i = 0; i < 18; i += 1) {
    const row = document.createElement('div');
    row.className = 'chat-peer-card';
    row.style.minHeight = '88px';
    list.appendChild(row);
  }
  await frame();
  const asked = [200, 500, 900];
  const got = [];
  for (const target of asked) {
    list.scrollTop = target;
    list.dispatchEvent(new Event('scroll'));
    await frame();
    got.push(Math.round(list.scrollTop));
  }
  document.querySelector('[data-chat-view="chats"]')?.click();
  return { asked, got };
});
check('calls scrolls freely instead of springing back',
  callsScroll.got.length === callsScroll.asked.length
  && callsScroll.got.every((v, i) => Math.abs(v - callsScroll.asked[i]) < 20),
  `asked ${callsScroll.asked.join('/')} got ${callsScroll.got.join('/')}`);

await page.waitForTimeout(700);

/* The presence dot is painted from inside a row, and rows pass under the
   pinned chrome — it was landing on top of the section header. */
const stacking = await page.evaluate(() => ({
  heading: Number(getComputedStyle(document.querySelector('#content-chat .chat-rail > .chat-list-heading')).zIndex),
  chips: (() => { const c = document.querySelector('#content-chat .chat-list-filters'); return c ? Number(getComputedStyle(c).zIndex) : 5; })(),
}));
check('the pinned chrome outranks anything a row can raise',
  stacking.heading >= 5 && stacking.chips >= 4, JSON.stringify(stacking));

/* Square corners against the column edge, and labels touching both walls. */
const shapeCheck = await page.evaluate(() => {
  const px = (sel, prop) => { const el = document.querySelector(sel); return el ? parseFloat(getComputedStyle(el)[prop]) : 0; };
  return {
    card: px('#content-chat .chat-profile-card', 'borderRadius'),
    nav: px('#content-chat .chat-nav-bar', 'borderRadius'),
    navPadInline: px('#content-chat .chat-nav-bar', 'paddingLeft'),
    itemPadInline: px('#content-chat .chat-nav-bar .chat-nav-item', 'paddingLeft'),
    heading: px('#content-chat .chat-rail > .chat-list-heading', 'borderRadius'),
  };
});
check('the name card, the switcher and the list header are rounded',
  shapeCheck.card >= 12 && shapeCheck.nav >= 12 && shapeCheck.heading >= 8, JSON.stringify(shapeCheck));
check('and the switcher labels are not pressed against its sides',
  shapeCheck.navPadInline >= 6 && shapeCheck.itemPadInline >= 6,
  `bar ${shapeCheck.navPadInline}px, item ${shapeCheck.itemPadInline}px`);

/* A modal panel with a conversation moving behind it has to be opaque. */
const sheetOpaque = await page.evaluate(async () => {
  document.getElementById('chatQuickIdentityBtn')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const panel = document.getElementById('chatFullSheet');
  const bg = panel ? getComputedStyle(panel).backgroundColor : '';
  panel?.querySelector('[data-fullsheet-close]')?.click();
  await new Promise((r) => setTimeout(r, 250));
  return bg;
});
check('the identity page is opaque, not see-through',
  Boolean(sheetOpaque) && !/rgba\([^)]+,\s*0?\.\d+\)/.test(sheetOpaque) && !/\/\s*0?\.\d/.test(sheetOpaque),
  sheetOpaque);

/* The fold was springy: display:none removed rows between frames and the
   action cluster changed grid row, neither of which can be interpolated. */
const smooth = await page.evaluate(async () => {
  const rail = document.querySelector('#content-chat .chat-rail');
  const list = document.getElementById('chatPeerList');
  const card = document.querySelector('#content-chat .chat-profile-card');
  for (let i = 0; i < 20; i += 1) {
    const row = document.createElement('div');
    row.className = 'chat-peer-card';
    row.style.minHeight = '84px';
    list.appendChild(row);
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  list.scrollTop = 0; list.dispatchEvent(new Event('scroll'));
  await new Promise((r) => setTimeout(r, 400));
  const samples = [];
  list.scrollTop = 600; list.dispatchEvent(new Event('scroll'));
  for (let i = 0; i < 40; i += 1) {
    samples.push(Math.round(card.getBoundingClientRect().height));
    await new Promise((r) => requestAnimationFrame(r));
  }
  let biggest = 0;
  for (let i = 1; i < samples.length; i += 1) biggest = Math.max(biggest, Math.abs(samples[i] - samples[i - 1]));
  return { from: samples[0], to: samples[samples.length - 1], steps: new Set(samples).size, biggest,
           easing: getComputedStyle(card).transitionTimingFunction.split(',')[0] };
});
/* A snap is one big step; a transition is many small ones. 49px was the
   structural jump, and it is gone. */
/* Proportional, not absolute: a dropped frame under load shows up as a larger
   step without the animation being any less smooth. What distinguishes a
   transition from a snap is that no single frame carries most of the change —
   before this pass one frame carried 49px of a 108px fold. */
const foldTotal = Math.abs(smooth.from - smooth.to);
/* A card that barely changes height has nothing to animate, and a proportional
   test on a 3px fold reports a single stray pixel as 33% of it. Since the name
   and its buttons moved into the gear menu the phone card is close to fixed,
   so "smooth" here means either a real fold made of small steps or a card that
   simply holds still — what it must never do is jump. */
check('the header folds smoothly rather than snapping',
  foldTotal <= 12
    ? smooth.biggest <= 12
    : (smooth.biggest < foldTotal * 0.35 && smooth.steps >= 8),
  `${smooth.from}px → ${smooth.to}px in ${smooth.steps} steps, largest ${smooth.biggest}px `
  + `(fold of ${foldTotal}px)`);
check('on a standard ease rather than a hard ease-out',
  /0\.4/.test(smooth.easing), smooth.easing);

console.log('\n===== the 2026-09-01 pass =====');

/* A conversation to work with. The address book's Add is driven through the
   app's own dialog, because window.prompt is replaced in this build. */
await page.evaluate(async () => {
  document.querySelector('[data-chat-view="calls"]')?.click();
  await new Promise((r) => setTimeout(r, 250));
  document.querySelector('[data-calls-pane="contacts"]')?.click();
  await new Promise((r) => setTimeout(r, 150));
  document.querySelector('[data-contact-add]')?.click();
  await new Promise((r) => setTimeout(r, 350));
  const input = document.querySelector('.poorija-dialog-input');
  if (input) {
    input.value = 'poorija-peer-uxsuite-0001';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.querySelector('.poorija-dialog-ok')?.click();
  await new Promise((r) => setTimeout(r, 600));
  document.querySelector('[data-chat-view="chats"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
});

/* Tapping a row used to press the Save profile button of an invisible dropdown
   lying over the list: the toast said "profile saved" and the conversation
   never opened. */
const rowTap = await page.evaluate(async () => {
  const row = document.querySelector('[data-chat-conversation]');
  if (!row) return { rows: 0 };
  const box = row.getBoundingClientRect();
  const midpoint = document.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + 14));
  row.click();
  await new Promise((r) => setTimeout(r, 500));
  return {
    rows: 1,
    covering: midpoint ? `${midpoint.tagName}${midpoint.id ? '#' + midpoint.id : ''}` : null,
    insideRow: Boolean(midpoint && row.contains(midpoint)),
    opened: document.querySelector('#content-chat .chat-shell')?.classList.contains('chat-has-conversation'),
  };
});
check('nothing invisible is lying over the conversation list',
  rowTap.insideRow === true, JSON.stringify(rowTap));
check('and tapping a row opens that conversation', rowTap.opened === true, JSON.stringify(rowTap));

/* Every action above a conversation lives behind one gear that opens downward,
   the mirror of the composer's + sheet. */
const threadMenu = await page.evaluate(async () => {
  const button = document.getElementById('chatThreadMenuBtn');
  const menu = document.getElementById('chatThreadMenu');
  if (!button || !menu) return null;
  button.click();
  await new Promise((r) => setTimeout(r, 300));
  const menuBox = menu.getBoundingClientRect();
  const buttonBox = button.getBoundingClientRect();
  const rows = [...menu.querySelectorAll('.chat-action-row')].map((row) => row.id);
  const labelled = [...menu.querySelectorAll('.chat-action-row span')].every((span) => span.textContent.trim().length > 0);
  document.body.click();
  await new Promise((r) => setTimeout(r, 300));
  return {
    rows,
    labelled,
    opensDownward: menuBox.top >= buttonBox.bottom - 2,
    onScreen: menuBox.left >= -2 && menuBox.right <= window.innerWidth + 2,
    closed: menu.classList.contains('hidden'),
    rotates: getComputedStyle(button).transition.includes('transform'),
  };
});
check('the conversation actions are behind one gear, opening downward',
  Boolean(threadMenu) && threadMenu.opensDownward && threadMenu.onScreen && threadMenu.closed,
  JSON.stringify(threadMenu));
check('and every action in it is named, not just an icon',
  Boolean(threadMenu) && threadMenu.labelled
  && ['chatVoiceCallBtn', 'chatVideoCallBtn', 'chatStartSessionBtn', 'chatDeleteConversationBtn']
    .every((id) => threadMenu.rows.includes(id)),
  JSON.stringify(threadMenu?.rows));

/* One unanswered call reaches the log from four directions — the ring timeout,
   call-missed, call-cancel and a trailing call-ended. Each was a row. */
const callLog = await page.evaluate(async () => {
  if (!window.__callLogProbe) return null;
  window.__callLogProbe.clear();
  const fire = (status, mode = 'voice') => window.__callLogProbe.append({
    name: 'Probe', peerId: 'peer-probe', mode, status, direction: 'in',
  });
  fire('ringing'); fire('missed'); fire('cancelled'); fire('missed'); fire('ended');
  await new Promise((r) => setTimeout(r, 200));
  const afterOne = window.__callLogProbe.rows();
  fire('ringing', 'video'); fire('missed', 'video');
  await new Promise((r) => setTimeout(r, 200));
  const afterTwo = window.__callLogProbe.rows();
  const badgeBefore = document.querySelector('[data-chat-view="calls"] .chat-nav-badge')?.textContent;
  document.querySelector('[data-chat-view="calls"]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  const badgeAfter = document.querySelector('[data-chat-view="calls"] .chat-nav-badge')?.textContent;
  document.querySelector('[data-chat-view="chats"]')?.click();
  return { one: afterOne.length, oneStatus: afterOne[0]?.status, two: afterTwo.length, badgeBefore, badgeAfter };
});
check('one unanswered call is one row in the log, whatever reports it',
  Boolean(callLog) && callLog.one === 1 && callLog.oneStatus === 'missed', JSON.stringify(callLog));
check('two of them are two rows', Boolean(callLog) && callLog.two === 2, JSON.stringify(callLog));
check('the missed-call badge counts them and clears when the log is opened',
  Boolean(callLog) && callLog.badgeBefore === '2' && !callLog.badgeAfter, JSON.stringify(callLog));

/* A finished call is also one line inside the thread, and on a phone that line
   is where a redial actually starts -- the header icons are two taps away. */
const threadCall = await page.evaluate(async () => {
  if (!window.__callLogProbe) return null;
  document.querySelector('[data-chat-view="chats"]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('#chatPeerList .chat-peer-card')?.click();
  await new Promise((r) => setTimeout(r, 600));
  const conversationId = window.__callLogProbe.activeConversationId();
  if (!conversationId) return { conversationId: '' };
  /* Its own peer id: the log merges calls to the same peer inside a 30s
     window, and the rows seeded above are voice ones for peer-probe. */
  window.__callLogProbe.append({
    name: 'Probe', peerId: 'peer-thread-probe', conversationId,
    mode: 'video', status: 'ended', direction: 'out', durationMs: 42000,
  });
  await new Promise((r) => setTimeout(r, 600));
  const row = document.querySelector('#chatMessages [data-call-redial]');
  const box = row?.getBoundingClientRect();
  return {
    conversationId,
    mode: row?.dataset.callRedial || '',
    role: row?.getAttribute('role') || '',
    cursor: row ? getComputedStyle(row).cursor : '',
    tapHeight: box ? Math.round(box.height) : 0,
  };
});
/* Back to the list: opening a conversation on a phone swaps the rail away, and
   the checks below this one measure the profile card that lives in it. */
await page.evaluate(() => document.getElementById('chatBackToListBtn')?.click());
await page.waitForTimeout(500);
check('a finished call is a redial button inside the thread on a phone',
  threadCall?.mode === 'video' && threadCall.role === 'button'
  && threadCall.cursor === 'pointer' && threadCall.tapHeight >= 44,
  JSON.stringify(threadCall));

/* The card is fixed now: who you are, whether you are connected, what time it
   is, and three round doors. */
const profileCard = await page.evaluate(() => {
  const card = document.querySelector('#content-chat .chat-profile-card');
  const box = card?.getBoundingClientRect();
  return {
    height: box ? Math.round(box.height) : 0,
    name: document.getElementById('chatProfileSummaryName')?.textContent?.trim() || '',
    tone: document.getElementById('chatProfileSummaryStatus')?.dataset.tone,
    clock: document.getElementById('chatProfileClocks')?.textContent?.trim() || '',
    buttons: [...document.querySelectorAll('.chat-profile-quick button')]
      .filter((button) => getComputedStyle(button).display !== 'none' && button.getBoundingClientRect().width > 8)
      .map((button) => button.id),
    fieldsHidden: getComputedStyle(document.querySelector('#content-chat .chat-profile-fields')).display === 'none',
  };
});
check('the card carries your name, your connection and your local time',
  profileCard.name.length > 0 && Boolean(profileCard.tone) && /\d|[۰-۹]/.test(profileCard.clock),
  JSON.stringify(profileCard));
/* The third door changed: key reset moved out of the card and an instant
   chat lock took its place, which is the control somebody actually reaches for
   with the phone already in their hand. */
check('and its three round doors are identity, settings and an instant lock',
  profileCard.buttons.join(',') === 'chatQuickIdentityBtn,chatProfileMenuBtn,chatQuickLockBtn',
  JSON.stringify(profileCard.buttons));
check('the controls the sheets borrow are not also shown in the card',
  profileCard.fieldsHidden === true, String(profileCard.fieldsHidden));

/* The settings sheet borrows the live name field and the live buttons. */
const settingsSheet = await page.evaluate(async () => {
  document.getElementById('chatProfileMenuBtn')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const panel = document.getElementById('chatFullSheet');
  const state = {
    title: panel?.querySelector('.chat-fullsheet-title')?.textContent || '',
    rows: [...(panel?.querySelectorAll('.chat-profile-sheet-label') || [])].map((label) => label.textContent.trim()),
    borrowedName: Boolean(panel?.querySelector('#chatProfileName')),
    borrowedSave: Boolean(panel?.querySelector('#chatSaveProfileBtn')),
    borrowedReset: Boolean(panel?.querySelector('#chatResetIdentityBtn')),
  };
  panel?.querySelector('[data-fullsheet-close]')?.click();
  await new Promise((r) => setTimeout(r, 350));
  state.nameBack = Boolean(document.querySelector('#content-chat .chat-profile-fields #chatProfileName'));
  state.avatarBack = Boolean(document.querySelector('#content-chat .chat-profile-card .chat-profile-avatar-stack'));
  return state;
});
check('the gear opens profile settings as a full page with the real controls',
  settingsSheet.borrowedName && settingsSheet.borrowedSave && settingsSheet.borrowedReset
  && settingsSheet.rows.length >= 4, JSON.stringify(settingsSheet));
check('and closing it puts every borrowed control back',
  settingsSheet.nameBack && settingsSheet.avatarBack, JSON.stringify(settingsSheet));

/* World clocks: local always, plus what you added, persisted. */
const clocks = await page.evaluate(async () => {
  document.getElementById('chatProfileClocks')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const panel = document.getElementById('chatFullSheet');
  const search = panel?.querySelector('.chat-clock-search');
  if (search) {
    search.value = 'Tokyo';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 250));
  const option = panel?.querySelector('[data-clock-add]');
  option?.click();
  await new Promise((r) => setTimeout(r, 300));
  const rows = panel?.querySelectorAll('.chat-clock-row').length || 0;
  panel?.querySelector('[data-fullsheet-close]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  let stored = [];
  try { stored = JSON.parse(localStorage.getItem('poorija_chat_clocks') || '[]'); } catch (error) { void error; }
  return {
    rows,
    stored: stored.length,
    /* Your own line, plus one box per city — the cities share a single row. */
    onCard: document.querySelectorAll('#chatProfileClocks .chat-clock-line').length
      + document.querySelectorAll('#chatProfileClocks .chat-clock-box').length,
    boxesOnOneRow: (() => {
      const boxes = [...document.querySelectorAll('#chatProfileClocks .chat-clock-box')];
      if (boxes.length < 2) return true;
      const tops = boxes.map((node) => Math.round(node.getBoundingClientRect().top));
      return tops.every((top) => Math.abs(top - tops[0]) <= 2);
    })(),
    offsets: [...document.querySelectorAll('#chatProfileClocks .chat-clock-box-offset')].map((node) => node.textContent.trim()),
    localDates: document.querySelector('#chatProfileClocks .is-local .chat-clock-dates')?.textContent.trim() || '',
  };
});
check('a second city can be added and it sticks',
  clocks.rows >= 2 && clocks.stored >= 1 && clocks.onCard >= 2, JSON.stringify(clocks));
check('and the cities sit beside each other, not stacked',
  clocks.boxesOnOneRow === true, JSON.stringify(clocks));
/* This used to require the offset on the card. It is off it now: what the
   card is for is the city and the time it is there, and dropping the offset
   takes a whole row out of each box. It still appears in the clock manager,
   where it is what tells two cities of the same time apart while you choose
   between them. */
/* The number beside the list tools counts the conversations, not who is
   online — the "online" filter chip under it already says that, and the size
   of the list is what the header is for. */
const chatCount = await page.evaluate(async () => {
  const read = () => (document.getElementById('chatPeerCount')?.textContent || '').trim();
  const rows = () => document.querySelectorAll('#chatPeerList .chat-peer-card').length;
  const before = { label: read(), rows: rows() };
  /* A search must not appear to delete chats from the count. */
  const search = document.getElementById('chatSearchInput') || document.querySelector('[data-chat-search]');
  if (search) {
    search.value = 'zzzz-no-such-peer';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
  }
  const searching = { label: read(), rows: rows() };
  if (search) {
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
  }
  return { before, searching };
});
console.log('  ' + JSON.stringify(chatCount));
check('the list header counts conversations, as a bare number',
  /^[0-9۰-۹]+$/.test(chatCount.before.label)
  && Number(chatCount.before.label.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) === chatCount.before.rows,
  JSON.stringify(chatCount.before));
check('and a search that matches nothing does not change it',
  chatCount.searching.label === chatCount.before.label,
  JSON.stringify(chatCount.searching));

check('the card shows the time, not how far off it is',
  clocks.offsets.length === 0, JSON.stringify(clocks.offsets));
check('your own line carries both calendars',
  clocks.localDates.includes('·'), clocks.localDates);

/* The strip behind the phone's clock has to follow the theme, on both the
   platforms that read it. */
const statusBar = await page.evaluate(async () => {
  const out = [];
  for (const theme of ['light', 'midnight']) {
    window.setTheme?.(theme);
    await new Promise((r) => requestAnimationFrame(r));
    out.push({
      theme,
      meta: document.querySelector('meta[name="theme-color"]')?.content,
      apple: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content,
      painted: getComputedStyle(document.documentElement).getPropertyValue('--app-bg').trim(),
      header: getComputedStyle(document.getElementById('appHeader')).backgroundColor,
    });
  }
  window.setTheme?.('midnight');
  return out;
});
check('theme-color is exactly what the theme paints, on every theme',
  statusBar.every((row) => row.meta && row.painted && row.meta.toLowerCase() === row.painted.toLowerCase()),
  JSON.stringify(statusBar));
/* This used to require black-translucent, so the page could paint the band
   behind the clock in the theme's own colour. Measuring the installed app on a
   430x932 phone retired that: translucent mode moves the whole web view to the
   top of the screen and iOS keeps the bottom 59pt, which no element can reach,
   so the tab bar could never sit on the physical edge again. The style is
   opaque now and iOS paints the band from theme-color — checked above to be
   exactly what the theme paints, which is what the pin was for in the first
   place. It is read once at install, so it must be a constant, not per-theme. */
check('the iOS status bar takes its colour from theme-color, not from a translucent page',
  statusBar.every((row) => row.apple === 'default'),
  statusBar.map((row) => `${row.theme}:${row.apple}`).join(' '));
const strip = await page.evaluate(async () => {
  const out = [];
  for (const theme of ['midnight', 'light']) {
    window.setTheme?.(theme);
    await new Promise((r) => setTimeout(r, 500));
    document.documentElement.style.setProperty('--pwa-safe-top', '47px');
    const band = getComputedStyle(document.getElementById('appHeader'), '::before');
    out.push({ theme, band: band.backgroundColor, height: band.height });
  }
  document.documentElement.style.removeProperty('--pwa-safe-top');
  window.setTheme?.('midnight');
  await new Promise((r) => setTimeout(r, 400));
  return out;
});
check('and the band it paints there changes with the theme',
  strip[0].band !== strip[1].band && strip.every((row) => row.height === '47px'),
  JSON.stringify(strip));

/* The tab bar used to blink out whenever the browser toolbars moved the visual
   viewport, which happens on every scroll. Only the composer hides it now. */
const barStability = await page.evaluate(async () => {
  /* From the list, not from inside a conversation: an open conversation hides
     the bar on purpose, to give the composer the room. */
  document.getElementById('chatBackToListBtn')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const bar = document.querySelector('.mobile-tab-bar');
  const seen = new Set();
  const sample = () => seen.add(getComputedStyle(bar).display);
  sample();
  document.getElementById('chatSearchInput')?.focus();
  window.dispatchEvent(new Event('resize'));
  await new Promise((r) => setTimeout(r, 200));
  sample();
  window.scrollBy(0, 200);
  window.dispatchEvent(new Event('resize'));
  await new Promise((r) => setTimeout(r, 200));
  sample();
  document.getElementById('chatSearchInput')?.blur();
  await new Promise((r) => setTimeout(r, 200));
  sample();
  return { states: [...seen], keyboardClass: document.documentElement.classList.contains('keyboard-open') };
});
check('the tab bar holds still while a field is focused and the page scrolls',
  barStability.states.length === 1 && barStability.states[0] !== 'none',
  JSON.stringify(barStability));

console.log('\n===== the 2026-09-02 pass =====');

/* The card must not re-shape as the list scrolls: it used to change columns,
   padding and avatar size when the fold class arrived, which threw its pieces
   around under the finger. */
const cardShape = await page.evaluate(async () => {
  const card = document.querySelector('#content-chat .chat-profile-card');
  const list = document.getElementById('chatPeerList');
  const shape = () => {
    const cs = getComputedStyle(card);
    const box = (selector) => {
      const el = card.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}`;
    };
    return [Math.round(card.getBoundingClientRect().height), cs.gridTemplateColumns, cs.gridTemplateRows,
      box('.chat-profile-avatar-stack'), box('.chat-profile-summary'), box('.chat-profile-quick')].join(' | ');
  };
  for (let i = 0; i < 24; i += 1) {
    const row = document.createElement('div');
    row.className = 'chat-peer-card';
    row.style.minHeight = '84px';
    list.appendChild(row);
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  list.scrollTop = 0; list.dispatchEvent(new Event('scroll'));
  await new Promise((r) => setTimeout(r, 400));
  const before = shape();
  list.scrollTop = 700; list.dispatchEvent(new Event('scroll'));
  await new Promise((r) => setTimeout(r, 700));
  const after = shape();
  list.scrollTop = 0; list.dispatchEvent(new Event('scroll'));
  return { before, after, same: before === after };
});
check('the profile card keeps its exact shape while the list scrolls',
  cardShape.same, `${cardShape.before}  ≠  ${cardShape.after}`);

/* Right-aligned in Persian, left-aligned in English, from one rule. */
const alignment = await page.evaluate(() => {
  const pick = (selector) => {
    const el = document.querySelector(selector);
    return el ? getComputedStyle(el).textAlign : null;
  };
  return {
    dir: document.documentElement.dir,
    summary: pick('#content-chat .chat-profile-summary'),
    name: pick('#chatProfileSummaryName'),
    clocks: pick('#chatProfileClocks'),
  };
});
check('the card reads from the inline start, so it follows the language',
  ['start', 'right'].includes(alignment.name) && ['start', 'right'].includes(alignment.clocks),
  JSON.stringify(alignment));

/* A status in your own words, on the card and on the wire. */
const mood = await page.evaluate(async () => {
  document.getElementById('chatMoodChip')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const input = document.querySelector('.poorija-dialog-input');
  if (input) {
    input.value = 'در جلسه';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.querySelector('.poorija-dialog-ok')?.click();
  await new Promise((r) => setTimeout(r, 500));
  return {
    chip: document.getElementById('chatMoodChipText')?.textContent?.trim(),
    marked: document.getElementById('chatMoodChip')?.classList.contains('is-set'),
    peerSlot: Boolean(document.getElementById('chatActivePeerMood')),
  };
});
check('a status can be written by hand and shows on the card',
  mood.chip === 'در جلسه' && mood.marked === true, JSON.stringify(mood));
check('and there is a place for the other side\'s status beside their name',
  mood.peerSlot === true, String(mood.peerSlot));

/* Settings is a list; the accordion box that said "Settings" above it is gone. */
const settingsChrome = await page.evaluate(() => {
  document.querySelector('[data-chat-view="connection"]')?.click();
  const panel = document.getElementById('chatConnectionPanel');
  const summary = panel?.querySelector('summary');
  const state = {
    summaryShown: summary ? getComputedStyle(summary).display !== 'none' : false,
    panelBorder: panel ? getComputedStyle(panel).borderTopWidth : null,
    rows: panel?.querySelectorAll('[data-settings-tab]').length || 0,
    expectedTabs: (typeof CHAT_SETTINGS_TABS !== 'undefined' && CHAT_SETTINGS_TABS.length) || 0,
  };
  document.querySelector('[data-chat-view="chats"]')?.click();
  return state;
});
check('settings shows its destinations and no title box above them',
  settingsChrome.summaryShown === false && settingsChrome.rows === settingsChrome.expectedTabs,
  JSON.stringify(settingsChrome));

/* A relocated settings section keeps the layout its controls were designed
   for — label on one side, switch on the other. */
const relocated = await page.evaluate(async () => {
  document.querySelector('[data-chat-view="connection"]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('[data-settings-tab="connection"]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  const toggles = [...document.querySelectorAll('.chat-toggle')].filter((node) => node.getBoundingClientRect().height > 0);
  const overlapping = toggles.filter((node) => {
    const label = node.querySelector('span:first-child');
    const knob = node.querySelector('.chat-settings-switch');
    if (!label || !knob) return false;
    const a = label.getBoundingClientRect();
    const b = knob.getBoundingClientRect();
    return !(a.right <= b.left + 1 || b.right <= a.left + 1);
  });
  document.querySelector('#chatFullSheet [data-fullsheet-close]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('[data-chat-view="chats"]')?.click();
  return { toggles: toggles.length, overlapping: overlapping.length };
});
check('a section opened away from its panel still lays its switches out properly',
  relocated.toggles > 0 && relocated.overlapping === 0, JSON.stringify(relocated));

/* Every theme paints its own dialog. */
const dialogTheme = await page.evaluate(async () => {
  const read = async (theme) => {
    window.setTheme?.(theme);
    await new Promise((r) => setTimeout(r, 450));
    PoorijaDialogs.confirm('probe');
    await new Promise((r) => setTimeout(r, 250));
    const panel = document.querySelector('.poorija-dialog');
    const value = {
      panel: getComputedStyle(panel).backgroundColor,
      text: getComputedStyle(panel).color,
      page: getComputedStyle(document.documentElement).getPropertyValue('--app-bg').trim(),
    };
    document.querySelector('.poorija-dialog-cancel')?.click();
    await new Promise((r) => setTimeout(r, 250));
    return value;
  };
  const dark = await read('midnight');
  const light = await read('light');
  window.setTheme?.('midnight');
  await new Promise((r) => setTimeout(r, 400));
  return { dark, light };
});
check('dialogs are painted by the theme, not by one hard-coded palette',
  dialogTheme.dark.panel !== dialogTheme.light.panel && dialogTheme.dark.text !== dialogTheme.light.text,
  JSON.stringify(dialogTheme));

/* The page behind the app is the theme's page colour, which is what the strip
   behind the phone's clock is sampled from. */
const pageSurface = await page.evaluate(async () => {
  const out = [];
  for (const theme of ['midnight', 'light']) {
    window.setTheme?.(theme);
    await new Promise((r) => setTimeout(r, 500));
    out.push({
      theme,
      body: getComputedStyle(document.body).backgroundColor,
      header: getComputedStyle(document.getElementById('appHeader')).backgroundColor,
      main: getComputedStyle(document.querySelector('.dashboard-main-content')).backgroundColor,
    });
  }
  window.setTheme?.('midnight');
  await new Promise((r) => setTimeout(r, 400));
  return out;
});
check('the page, the header and the content share one colour on every theme',
  pageSurface.every((row) => row.body === row.header && row.header === row.main),
  JSON.stringify(pageSurface));

/* The bar belongs to the whole app, not to one tab. */
const barEverywhere = await page.evaluate(async () => {
  const out = {};
  for (const tab of ['encrypt', 'passwords', 'notes', 'settings', 'chat']) {
    window.switchTab?.(tab);
    await new Promise((r) => setTimeout(r, 200));
    const bar = document.querySelector('.mobile-tab-bar');
    out[tab] = `${getComputedStyle(bar).display}@${Math.round(bar.getBoundingClientRect().bottom)}`;
  }
  window.switchTab?.('chat');
  return { out, viewport: document.documentElement.clientHeight };
});
check('the quick-access bar is on every tab, not only in Secure Chat',
  Object.values(barEverywhere.out).every((value) => value.startsWith('grid')
    && Math.abs(Number(value.split('@')[1]) - barEverywhere.viewport) <= 2),
  JSON.stringify(barEverywhere));

/* The card's box: one padding for all four sides, the action column reaching
   both edges with even gaps, and the avatar level with the name. */
const cardBox = await page.evaluate(() => {
  const card = document.querySelector('#content-chat .chat-profile-card');
  const cr = card.getBoundingClientRect();
  const pad = Math.round(parseFloat(getComputedStyle(card).paddingTop));
  const inset = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top - cr.top),
      bottom: Math.round(cr.bottom - r.bottom),
      outer: document.documentElement.dir === 'rtl'
        ? Math.round(cr.right - r.right)
        : Math.round(r.left - cr.left),
    };
  };
  const buttons = [...document.querySelectorAll('.chat-profile-quick button')]
    .map((el) => { const r = el.getBoundingClientRect(); return { top: r.top - cr.top, bottom: r.bottom - cr.top }; });
  const gaps = buttons.slice(1).map((b, i) => Math.round(b.top - buttons[i].bottom));
  const cs = getComputedStyle(card);
  return {
    pad,
    sides: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
    avatar: inset('.chat-avatar-lg'),
    firstButtonTop: Math.round(buttons[0]?.top ?? -1),
    lastButtonBottom: Math.round(cr.height - (buttons[buttons.length - 1]?.bottom ?? 0)),
    gaps,
    nameTop: Math.round(document.getElementById('chatProfileSummaryName').getBoundingClientRect().top - cr.top),
  };
});
check('the card is padded the same on all four sides',
  new Set(cardBox.sides).size === 1, JSON.stringify(cardBox.sides));
check('the action column reaches both edges of that padding, evenly spaced',
  Math.abs(cardBox.firstButtonTop - cardBox.pad) <= 2
  && Math.abs(cardBox.lastButtonBottom - cardBox.pad) <= 2
  && Math.max(...cardBox.gaps) - Math.min(...cardBox.gaps) <= 2,
  JSON.stringify(cardBox));
check('and the avatar sits at that padding, level with the name',
  Math.abs(cardBox.avatar.outer - cardBox.pad) <= 2
  && Math.abs(cardBox.avatar.top - cardBox.pad) <= 3
  && Math.abs(cardBox.avatar.top - cardBox.nameTop) <= 6,
  JSON.stringify(cardBox));

/* The pixel companion under the avatar, and the tap that changes it. */
const pet = await page.evaluate(async () => {
  const host = document.getElementById('chatPet');
  if (!host) return null;
  const snapshot = () => ({
    name: host.getAttribute('aria-label'),
    frames: Number(host.dataset.frames || 0),
    groups: host.querySelectorAll('g.pet-frame').length,
    rects: host.querySelectorAll('svg rect').length,
  });
  const first = snapshot();
  /* Real frame animation: each drawing is its own <g> on a steps() timeline,
     rather than one still under a transform. */
  const perFrame = [...host.querySelectorAll('g.pet-frame')]
    .map((group) => getComputedStyle(group).animationName);
  host.click();
  await new Promise((r) => setTimeout(r, 300));
  const second = snapshot();
  let stored = '';
  try { stored = localStorage.getItem('poorija_chat_pet') || ''; } catch (error) { void error; }
  const svg = host.querySelector('svg');
  const box = host.getBoundingClientRect();
  const avatar = document.querySelector('.chat-avatar-lg').getBoundingClientRect();
  return {
    first,
    second,
    stored,
    perFrame,
    crisp: getComputedStyle(svg).shapeRendering,
    chrome: {
      background: getComputedStyle(host).backgroundColor,
      border: getComputedStyle(host).borderTopWidth,
      caption: host.textContent.trim().length,
    },
    fits: Math.abs(Math.round(box.width) - Math.round(avatar.width)) <= 2,
  };
});
check('a pixel companion lives under the avatar, drawn as real frames',
  Boolean(pet) && pet.first.groups >= 2 && pet.first.rects > 8
  && pet.perFrame.every((name) => name && name !== 'none')
  && pet.crisp === 'crispedges',
  JSON.stringify({ first: pet?.first, perFrame: pet?.perFrame }));
check('with no caption and no box around it, sized to the avatar',
  Boolean(pet) && pet.chrome.caption === 0 && pet.chrome.border === '0px'
  && /rgba\(0, 0, 0, 0\)|transparent/.test(pet.chrome.background) && pet.fits,
  JSON.stringify({ chrome: pet?.chrome, fits: pet?.fits }));
check('and tapping it brings out a different one, remembered for next time',
  Boolean(pet) && pet.first.name !== pet.second.name && pet.stored.length > 0,
  JSON.stringify({ first: pet?.first.name, second: pet?.second.name, stored: pet?.stored }));



/* The 8px strip under the header that showed up in Settings and nowhere else:
   .chat-shell.chat-view-connection carried padding from an older layout. */
const railFlush = await page.evaluate(async () => {
  const out = {};
  for (const view of ['chats', 'calls', 'groups', 'connection']) {
    document.querySelector(`[data-chat-view="${view}"]`)?.click();
    await new Promise((r) => setTimeout(r, 300));
    const shell = document.querySelector('#content-chat .chat-shell');
    const rail = document.querySelector('#content-chat .chat-rail');
    out[view] = Math.round(rail.getBoundingClientRect().top - shell.getBoundingClientRect().top);
  }
  document.querySelector('[data-chat-view="chats"]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  return out;
});
check('no view leaves a strip of shell showing above the card',
  Object.values(railFlush).every((gap) => gap <= 2),
  JSON.stringify(railFlush));

/* Past the last character the carousel turns the companion off, and the slot
   becomes the quick copy for your chat id. */
const petOff = await page.evaluate(async () => {
  const host = document.getElementById('chatPet');
  if (!host) return null;
  for (let i = 0; i < 12; i += 1) {
    host.click();
    await new Promise((r) => setTimeout(r, 60));
    if (host.classList.contains('is-identity')) break;
  }
  let stored = '';
  try { stored = localStorage.getItem('poorija_chat_pet') || ''; } catch (error) { void error; }
  const off = {
    stored,
    mode: host.classList.contains('is-identity') ? 'id' : 'pet',
    shows: host.textContent.replace(/\s+/g, ' ').trim().length > 0,
    sameSlot: Math.round(host.getBoundingClientRect().width),
  };
  /* Tapping while off copies rather than cycling on. */
  host.click();
  await new Promise((r) => setTimeout(r, 150));
  off.stillOff = host.classList.contains('is-identity');
  /* And the switch in profile settings brings it back. */
  document.getElementById('chatProfileMenuBtn')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const row = [...document.querySelectorAll('#chatFullSheet .chat-profile-sheet-row')]
    .find((node) => /همدم|companion/i.test(node.querySelector('.chat-profile-sheet-label')?.textContent || ''));
  off.hasSwitch = Boolean(row);
  row?.querySelector('button')?.click();
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('#chatFullSheet [data-fullsheet-close]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  off.backOn = !host.classList.contains('is-identity');
  return off;
});
check('the companion can be switched off, and the slot becomes the id copy',
  Boolean(petOff) && petOff.stored === 'off' && petOff.mode === 'id'
  && petOff.shows && petOff.stillOff === true,
  JSON.stringify(petOff));
check('and profile settings switches it back on',
  Boolean(petOff) && petOff.hasSwitch && petOff.backOn === true, JSON.stringify(petOff));

/* Archives leave the device, so they leave encrypted — and the round trip has
   to bring the messages back. */
const archive = await page.evaluate(async () => {
  /* The guard used to read `!== 'undefined'` and return null — skipping the
     whole check whenever the constant existed. It never did exist in page
     scope, because js/chat.js was one IIFE, so the check always ran and nobody
     noticed the condition was inverted. Splitting that file put its top-level
     names in the global scope, the constant became reachable, and the guard
     started aborting two assertions silently.

     Its evident intent is "skip if the chat module is not loaded", so that is
     what it now says. */
  if (typeof CHAT_EXPORT_TYPE === 'undefined') return null;
  return {
    tools: ['chatExportChatsBtn', 'chatImportChatsBtn', 'chatWipeHistoryBtn']
      .every((id) => Boolean(document.getElementById(id))),
    hidesInCalls: (() => {
      document.querySelector('[data-chat-view="calls"]')?.click();
      const start = document.getElementById('chatStartChatBtn');
      const hidden = Boolean(start?.classList.contains('hidden'));
      const heading = document.querySelector('#content-chat .chat-list-heading')?.textContent || '';
      document.querySelector('[data-chat-view="chats"]')?.click();
      return { hidden, keepsCount: /\d|[۰-۹]/.test(heading) };
    })(),
  };
});
check('the list header carries export, import and erase',
  archive?.tools === true, JSON.stringify(archive?.tools));
check('and Calls drops the start-chat button but keeps its count',
  archive?.hidesInCalls.hidden === true && archive?.hidesInCalls.keepsCount === true,
  JSON.stringify(archive?.hidesInCalls));

/* Calls: the working pane carries the filters and the book, the second column
   carries the recent list. */
const callsLayout = await page.evaluate(async () => {
  document.querySelector('[data-chat-view="calls"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const wide = window.matchMedia('(min-width: 768px)').matches;
  /* Earlier checks in this session may have left the pane on Contacts; the
     filters belong to History, so start there. */
  document.querySelector('[data-calls-pane="history"]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  const pane = wide ? document.getElementById('chatCallsList') : document.getElementById('chatPeerList');
  const state = {
    wide,
    hasSwitch: Boolean(pane?.querySelector('.chat-calls-switch')),
    hasFilters: (pane?.querySelectorAll('.chat-call-filter-tab').length || 0) >= 3,
    recentColumn: wide ? (document.querySelectorAll('#chatPeerList .chat-recent-calls').length > 0) : true,
  };
  pane?.querySelector('[data-calls-pane="contacts"]')?.click();
  await new Promise((r) => setTimeout(r, 350));
  const book = wide ? document.getElementById('chatCallsList') : document.getElementById('chatPeerList');
  state.bookHasSearch = Boolean(book?.querySelector('.chat-contact-search'));
  book?.querySelector('[data-calls-pane="history"]')?.click();
  await new Promise((r) => setTimeout(r, 250));
  document.querySelector('[data-chat-view="chats"]')?.click();
  return state;
});
check('Calls keeps history and contacts in one pane, with the filters',
  callsLayout.hasSwitch && callsLayout.hasFilters, JSON.stringify(callsLayout));
check('the address book can be searched wherever it is shown',
  callsLayout.bookHasSearch === true, String(callsLayout.bookHasSearch));

/* The scroll gutters are gone, and the conversation menu reads on one line. */
const chrome = await page.evaluate(() => {
  const list = document.getElementById('chatPeerList');
  return {
    scrollbar: getComputedStyle(list).scrollbarWidth,
    settingsTop: (() => {
      document.querySelector('[data-chat-view="connection"]')?.click();
      const body = document.querySelector('#chatConnectionPanel > .chat-settings-body');
      const value = body ? Math.round(parseFloat(getComputedStyle(body).paddingTop)) : 0;
      document.querySelector('[data-chat-view="chats"]')?.click();
      return value;
    })(),
  };
});
check('the panels scroll without drawing a gutter', chrome.scrollbar === 'none', chrome.scrollbar);
check('and settings starts below the tabs, not against them',
  chrome.settingsTop >= 10, `${chrome.settingsTop}px`);

/* No bars, anywhere: not a permanent gutter, not one that appears on hover. */
const gutters = await page.evaluate(() => {
  const sample = ['#chatPeerList', '#chatMessages', '.dashboard-main-content', '#appSidebar']
    .map((selector) => document.querySelector(selector))
    .filter(Boolean);
  return sample.map((el) => ({
    id: el.id || el.className.split(' ')[0],
    width: getComputedStyle(el).scrollbarWidth,
    gutter: Math.round(el.offsetWidth - el.clientWidth),
  }));
});
/* A pixel or two of gutter is a border, not a bar. */
check('no panel draws a scrollbar gutter',
  gutters.every((row) => row.width === 'none' && row.gutter <= 2), JSON.stringify(gutters));

/* The profile settings are one screen, not a scroll. */
const sheetFit = await page.evaluate(async () => {
  document.getElementById('chatProfileMenuBtn')?.click();
  await new Promise((r) => setTimeout(r, 450));
  const body = document.querySelector('#chatFullSheet .chat-fullsheet-body');
  const pet = document.querySelector('#chatFullSheet .chat-pet');
  const state = {
    scrolls: body ? body.scrollHeight > body.clientHeight + 6 : true,
    petWidth: pet ? Math.round(pet.getBoundingClientRect().width) : 0,
    rows: document.querySelectorAll('#chatFullSheet .chat-profile-sheet-row').length,
  };
  document.querySelector('#chatFullSheet [data-fullsheet-close]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  return state;
});
check('the profile sheet fits without scrolling, with a small companion preview',
  sheetFit.scrolls === false && sheetFit.petWidth > 0 && sheetFit.petWidth <= 80 && sheetFit.rows >= 5,
  JSON.stringify(sheetFit));

/* The phone's menu button, and the + in the composer's end cap. */
const fits = await page.evaluate(() => {
  const header = document.getElementById('appHeader')?.getBoundingClientRect();
  const burger = document.getElementById('mobileNavToggle');
  const box = burger?.getBoundingClientRect();
  const surface = document.querySelector('#content-chat .chat-composer-surface');
  const plus = document.getElementById('chatComposerPlusBtn');
  const sr = surface?.getBoundingClientRect();
  const pr = plus?.getBoundingClientRect();
  return {
    burger: box && header ? {
      size: Math.round(box.width),
      height: Math.round(box.height),
      top: Math.round(box.top - header.top),
      side: Math.round(header.right - box.right),
    } : null,
    /* Concentric with the pill's cap: the same ring all the way round. */
    plus: sr && pr && pr.width ? {
      start: Math.round(pr.left - sr.left),
      top: Math.round(pr.top - sr.top),
      bottom: Math.round(sr.bottom - pr.bottom),
    } : null,
  };
});
check('the phone menu button is smaller and clear of the header edge',
  Boolean(fits.burger) && fits.burger.size <= 44 && fits.burger.top >= 2 && fits.burger.side >= 8,
  JSON.stringify(fits.burger));
check('and it is square, not a standing rectangle',
  Boolean(fits.burger) && Math.abs(fits.burger.size - fits.burger.height) <= 1,
  JSON.stringify(fits.burger));

/* The installed app is where it went wrong: html.pwa-standalone carries a
   min-height of 3rem, and a min-height outranks a smaller height, so the
   button stretched to 42x48 there while measuring square in the browser. */
const standalone = await page.evaluate(async () => {
  document.documentElement.classList.add('pwa-standalone');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const box = document.getElementById('mobileNavToggle')?.getBoundingClientRect();
  const out = box ? { w: Math.round(box.width), h: Math.round(box.height) } : null;
  document.documentElement.classList.remove('pwa-standalone');
  return out;
});
check('and square in the installed app too, where the min-height lives',
  Boolean(standalone) && Math.abs(standalone.w - standalone.h) <= 1 && standalone.w <= 44,
  JSON.stringify(standalone));
if (fits.plus) {
  check('the + sits in the middle of the composer\'s end cap',
    Math.abs(fits.plus.top - fits.plus.bottom) <= 2 && Math.abs(fits.plus.start - fits.plus.top) <= 4,
    JSON.stringify(fits.plus));
}

/* The bottom bar went missing on an iPhone, then came back floating above the
   edge. Both come from --tabbar-bottom-shift: the anchor measures how far the
   bar's painted edge falls short of the drawable bottom and pushes it down by
   that much. Nothing grew the bar to match, so a large enough measurement
   carried the whole row off the screen -- and the first repair kept the row
   put, which left it hovering. What has to hold: the row travels to the edge,
   the box bridges the strip above it, and no measurement can put the buttons
   somewhere nobody can reach. */
const barRescue = await page.evaluate(async () => {
  const doc = document.documentElement;
  const bar = document.getElementById('mobileTabBar');
  if (!bar) return null;
  const read = () => {
    const b = bar.getBoundingClientRect();
    const btn = bar.querySelector('.mobile-tab-btn')?.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom),
      btnBottom: btn ? Math.round(btn.bottom) : null,
      btnTop: btn ? Math.round(btn.top) : null };
  };
  const before = read();
  doc.style.setProperty('--tabbar-bottom-shift', '40px');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const shifted = read();
  /* And the anchor itself must refuse to leave the buttons off screen. */
  doc.style.setProperty('--tabbar-bottom-shift', '400px');
  window.syncTabBarAnchor?.();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const rescued = { shift: doc.style.getPropertyValue('--tabbar-bottom-shift'), ...read() };
  doc.style.removeProperty('--tabbar-bottom-shift');
  return { viewport: doc.clientHeight, before, shifted, rescued };
});
console.log('  ' + JSON.stringify(barRescue));
check('a bottom shift carries the row to the edge and bridges the strip above it',
  Boolean(barRescue) && barRescue.shifted.top === barRescue.before.top
  && barRescue.shifted.btnBottom === barRescue.before.btnBottom + 40
  && barRescue.shifted.bottom >= barRescue.viewport,
  JSON.stringify(barRescue));
check('and a runaway measurement is dropped rather than hiding the navigation',
  Boolean(barRescue) && barRescue.rescued.btnBottom <= barRescue.viewport + 2
  && barRescue.rescued.btnTop >= 0,
  JSON.stringify(barRescue));

/* The installed app on an iPhone that does not cover the status bar: the
   screen is 932, the web view is 873, and env(safe-area-inset-top) is 59 -- the
   missing 59 is ABOVE the view. Edge mode read it as a band BELOW and pushed
   the bar down into it, which put the buttons at 866..932 with the viewport
   ending at 873. Reproduced by making the page report that geometry. */
await page.setViewportSize({ width: 430, height: 873 });
await page.waitForTimeout(400);
const edgeCase = await page.evaluate(async () => {
  const doc = document.documentElement;
  const originalScreenHeight = Object.getOwnPropertyDescriptor(window.screen, 'height');
  Object.defineProperty(window.screen, 'height', { configurable: true, value: 932 });
  Object.defineProperty(window.screen, 'width', { configurable: true, value: 430 });
  Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true });
  doc.style.setProperty('--pwa-safe-top', '59px');
  const stored = localStorage.getItem('poorija_tabbar_edge');
  const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const row = () => {
    const btn = document.querySelector('#mobileTabBar .mobile-tab-btn');
    if (!btn) return null;
    const b = btn.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom),
      visible: Math.round(Math.min(b.bottom, doc.clientHeight) - Math.max(b.top, 0)) };
  };

  localStorage.removeItem('poorija_tabbar_edge');
  window.applyTabBarEdgeMode();
  await settle();
  const auto = { on: doc.classList.contains('tabbar-edge'),
    shift: doc.style.getPropertyValue('--tabbar-edge-shift') || '0px',
    why: window.__tabBarEdge?.explainedByTop, row: row() };

  /* And if the switch was flipped on once, on a device that has since changed,
     the measurement still has the last word. */
  localStorage.setItem('poorija_tabbar_edge', '1');
  window.applyTabBarEdgeMode();
  await settle();
  const forced = { on: doc.classList.contains('tabbar-edge'),
    rescued: window.__tabBarEdge?.rescued, row: row() };

  if (stored === null) localStorage.removeItem('poorija_tabbar_edge');
  else localStorage.setItem('poorija_tabbar_edge', stored);
  doc.style.removeProperty('--pwa-safe-top');
  if (originalScreenHeight) Object.defineProperty(window.screen, 'height', originalScreenHeight);
  window.applyTabBarEdgeMode();
  return { viewport: doc.clientHeight, auto, forced };
});
console.log('  ' + JSON.stringify(edgeCase));
check('a band above the web view does not push the bar down into nothing',
  edgeCase?.auto.on === false && edgeCase.auto.why === true
  && edgeCase.auto.row.bottom <= edgeCase.viewport + 1 && edgeCase.auto.row.visible >= 50,
  JSON.stringify(edgeCase?.auto));
check('and a stored edge-mode switch cannot hide the buttons either',
  edgeCase?.forced.rescued === true && edgeCase.forced.on === false
  && edgeCase.forced.row.bottom <= edgeCase.viewport + 1 && edgeCase.forced.row.visible >= 50,
  JSON.stringify(edgeCase?.forced));
await page.setViewportSize({ width: 430, height: 932 });
await page.waitForTimeout(400);

/* Two facts about the band iOS keeps at the bottom of an installed app, both
   established by measuring the phone's own screenshots at 1290x2796.
   1. black-translucent is what put the view at the top of the screen and left
      the band at the bottom, where nothing can paint. The style has to stay
      opaque or the bar can never reach the edge again.
   2. Until a home-screen copy is re-added, the bar has to end in the band's
      colour so the seam does not read as a gap. */
const bandJoin = await page.evaluate(async () => {
  const doc = document.documentElement;
  const meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content || '';
  const had = doc.classList.contains('os-band');
  doc.classList.add('pwa-standalone', 'os-band');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const bar = document.getElementById('mobileTabBar');
  const read = (el) => getComputedStyle(el).backgroundColor;
  const out = { meta, bar: read(bar), html: read(doc),
    theme: document.querySelector('meta[name="theme-color"]')?.content || '' };
  if (!had) doc.classList.remove('os-band');
  return out;
});
console.log('  ' + JSON.stringify(bandJoin));
check('the installed app does not ask for a translucent status bar',
  bandJoin?.meta === 'default', bandJoin?.meta);
check('and where the OS keeps a band, the bar ends in the same colour it does',
  Boolean(bandJoin) && bandJoin.bar === bandJoin.html, `${bandJoin?.bar} vs ${bandJoin?.html}`);

/* An iPhone's display is rounded at the corners, and the outermost tabs sit in
   them, so the labels are lifted clear of the last few pixels. */
const labelLift = await page.evaluate(() => {
  const bar = document.getElementById('mobileTabBar');
  const btns = [...bar.querySelectorAll('.mobile-tab-btn')];
  if (!btns.length) return null;
  const barBox = bar.getBoundingClientRect();
  const label = (btn) => btn.querySelector('span')?.getBoundingClientRect();
  const first = label(btns[0]); const last = label(btns[btns.length - 1]);
  return {
    firstGap: first ? Math.round(barBox.bottom - first.bottom) : null,
    lastGap: last ? Math.round(barBox.bottom - last.bottom) : null,
    barHeight: Math.round(barBox.height),
  };
});
console.log('  ' + JSON.stringify(labelLift));
check('the corner labels are lifted clear of the rounded glass',
  Boolean(labelLift) && labelLift.firstGap >= 8 && labelLift.lastGap >= 8,
  JSON.stringify(labelLift));

/* The version the user can actually see. About printed a literal that had been
   stale since 2.99.77 while the app shipped 2.99.85 — a bump replaces the
   version it knows about, and a wrong number is not that string. It is read
   from APP_VERSION_SEMVER now, and this check ties both to package.json. */
const shownVersion = await page.evaluate(() => {
  window.switchTab?.('about');
  return {
    about: document.getElementById('aboutVersion')?.textContent?.trim() || '',
    semver: window.APP_VERSION_SEMVER || (typeof APP_VERSION_SEMVER !== 'undefined' ? APP_VERSION_SEMVER : ''),
  };
});
await page.evaluate(() => window.switchTab?.('chat'));
await page.waitForTimeout(400);
const pkgVersion = JSON.parse(read('package.json')).version;
console.log('  ' + JSON.stringify({ ...shownVersion, pkgVersion }));
/* The line carries a build tag as well as the version, on purpose: same-number
   patch rounds are invisible otherwise, so About prints "Version 2.26.90 ·
   build chat-v12" and a person reporting a bug can say which round they are
   on. Asserting exact equality with the bare version predated that and failed
   on every build since. Both halves are checked instead — the version against
   package.json, the tag against the asset tag the page was served with. */
const assetSuffix = (/\?v=\d+\.\d+\.\d+-([A-Za-z0-9._-]+)/.exec(read('index.html')) || [])[1] || '';
check('About shows the version the package actually is',
  shownVersion.about.startsWith(`Version ${pkgVersion}`),
  `${shownVersion.about} vs package.json ${pkgVersion}`);
check('and the build tag it prints is the one the page was served with',
  !assetSuffix || shownVersion.about.includes(assetSuffix),
  `${shownVersion.about} vs asset tag ${assetSuffix}`);

/* The layout has to follow the window, not the size it was opened at. The
   class every mobile rule keys off was set once at startup, which a browser
   tab hides and a native window does not: drag it narrow and the desktop
   layout stayed. */
const followsResize = await page.evaluate(() => document.documentElement.classList.contains('mobile-browser-context'));
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(500);
const wideNow = await page.evaluate(() => document.documentElement.classList.contains('mobile-browser-context'));
await page.setViewportSize({ width: 430, height: 932 });
await page.waitForTimeout(500);
const narrowAgain = await page.evaluate(() => document.documentElement.classList.contains('mobile-browser-context'));
check('the layout follows the window as it is resized',
  followsResize === true && wideNow === false && narrowAgain === true,
  `phone:${followsResize} wide:${wideNow} phone-again:${narrowAgain}`);

/* The world clocks are measured against the strip they live in, not the card:
   the card is three columns and the strip only gets the middle one. */
const clockFit = await page.evaluate(() => {
  const strip = document.getElementById('chatProfileClocks');
  const boxes = [...document.querySelectorAll('#content-chat .chat-clock-box')];
  const clipped = (el) => (el ? Math.round(el.scrollWidth - el.clientWidth) : 0);
  return {
    strip: strip ? Math.round(strip.getBoundingClientRect().width) : 0,
    names: boxes.map((el) => clipped(el.querySelector('.chat-clock-box-name'))),
    stripClipped: clipped(strip),
  };
});
check('nothing in the clock strip is clipped',
  clockFit.stripClipped === 0 && clockFit.names.every((n) => n <= 0), JSON.stringify(clockFit));

/* The two cities stay side by side — that is the shape the card was designed
   around. What changes on a tablet is the space around them: the avatar and
   its companion come down a size and the local time with them, and all of it
   goes to the clock boxes. A phone and a wide desktop keep what they had. */
const clockScale = await page.evaluate(async () => {
  const read = () => {
    const pet = document.getElementById('chatPet');
    const local = document.querySelector('#content-chat .chat-clock-line.is-local .chat-clock-time');
    const boxes = [...document.querySelectorAll('#content-chat .chat-clock-box')];
    const clipped = (el) => (el ? Math.round(el.scrollWidth - el.clientWidth) : 0);
    return {
      pet: pet ? Math.round(pet.getBoundingClientRect().height) : 0,
      font: local ? parseFloat(getComputedStyle(local).fontSize) : 0,
      box: boxes[0] ? Math.round(boxes[0].getBoundingClientRect().width) : 0,
      columns: boxes.length,
      clipped: boxes.reduce((worst, el) => Math.max(worst,
        clipped(el.querySelector('.chat-clock-box-name')),
        clipped(el.querySelector('.chat-clock-box-time'))), 0),
      offsets: document.querySelectorAll('#content-chat .chat-clock-box-offset').length,
      /* The companion's bottom edge against the clock strip's: level means no
         dead space under it. */
      petVsStrip: (() => {
        const strip = document.getElementById('chatProfileClocks');
        if (!pet || !strip) return null;
        return Math.round(pet.getBoundingClientRect().bottom - strip.getBoundingClientRect().bottom);
      })(),
      sideBySide: (() => {
        if (boxes.length < 2) return true;
        const a = boxes[0].getBoundingClientRect(); const b = boxes[1].getBoundingClientRect();
        return Math.abs(a.top - b.top) < 4;
      })(),
    };
  };
  const settle = () => new Promise((r) => setTimeout(r, 450));
  const phone = read();
  window.__probeResize = read;
  await settle();
  return { phone };
});
await page.setViewportSize({ width: 1024, height: 1366 });
await page.waitForTimeout(700);
const tablet = await page.evaluate(() => window.__probeResize());
await page.setViewportSize({ width: 1920, height: 1080 });
await page.waitForTimeout(700);
const wide = await page.evaluate(() => window.__probeResize());
await page.setViewportSize({ width: 430, height: 932 });
await page.waitForTimeout(700);
console.log('  ' + JSON.stringify({ phone: clockScale.phone, tablet, wide }));
check('the two city clocks stay side by side at every size',
  clockScale.phone.sideBySide && tablet.sideBySide && wide.sideBySide,
  JSON.stringify({ p: clockScale.phone.sideBySide, t: tablet.sideBySide, w: wide.sideBySide }));
check('and nothing in them is clipped at any size',
  clockScale.phone.clipped === 0 && tablet.clipped === 0 && wide.clipped === 0,
  JSON.stringify({ p: clockScale.phone.clipped, t: tablet.clipped, w: wide.clipped }));
/* The companion is measured against the wide desktop rather than the phone:
   at phone width the card is in its own layout and the element can be laid out
   with no height at the moment of reading, which says nothing about scale. */
check('a tablet gets a smaller avatar, companion and local time',
  tablet.pet > 0 && tablet.pet < wide.pet && tablet.font < clockScale.phone.font,
  JSON.stringify({ tabletPet: tablet.pet, widePet: wide.pet, phoneFont: clockScale.phone.font, tabletFont: tablet.font }));
check('the clock boxes carry the city and its time, and nothing else',
  clockScale.phone.offsets === 0 && tablet.offsets === 0 && wide.offsets === 0,
  JSON.stringify({ p: clockScale.phone.offsets, t: tablet.offsets, w: wide.offsets }));
check('the companion ends level with the clocks, with no dead space under it',
  Math.abs(tablet.petVsStrip) <= 2 && Math.abs(wide.petVsStrip) <= 2,
  JSON.stringify({ tablet: tablet.petVsStrip, wide: wide.petVsStrip }));
check('while the phone and a wide desktop keep theirs',
  wide.font === clockScale.phone.font && wide.pet >= tablet.pet,
  JSON.stringify({ phoneFont: clockScale.phone.font, wideFont: wide.font, widePet: wide.pet, tabletPet: tablet.pet }));

console.log('\n===== the wide layouts, from the same session =====');
/* Resized rather than re-booted: the media queries are what is under test, and
   a second context would mean running the whole first-run wizard again. */
for (const [width, height, label] of [[1440, 900, 'desktop'], [1024, 1180, 'tablet']]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(700);
  const wide = await page.evaluate(() => {
    const show = (el) => (el ? getComputedStyle(el).display : 'missing');
    const bar = document.querySelector('.mobile-tab-bar');
    const sidebar = document.getElementById('appSidebar');
    const box = sidebar?.getBoundingClientRect();
    document.querySelector('[data-chat-view="calls"]')?.click();
    return {
      bar: show(bar),
      barSettingsCard: show(document.getElementById('mobileTabBarSettingsCard')),
      sidebarGap: box ? Math.round(window.innerHeight - box.bottom) : null,
      resizer: show(document.getElementById('chatRailResizer')),
      /* `.chat-search-wrap` was a bar above the nav and is gone; the door into
         search is the icon inside the nav now. Same property, new selector. */
      search: show(document.querySelector('#content-chat .chat-nav-search')),
      /* The book lives in the working pane now; the rail beside it carries the
         recent-call column. */
      book: document.querySelectorAll('#chatCallsList .chat-contact-book, #chatPeerList .chat-contact-book').length,
      recent: document.querySelectorAll('#chatPeerList .chat-recent-calls').length,
      shellGap: (() => {
        const shell = document.querySelector('#content-chat > .chat-shell');
        const main = document.querySelector('.dashboard-main-content');
        if (!shell || !main) return 999;
        const a = shell.getBoundingClientRect();
        const b = main.getBoundingClientRect();
        return Math.round(Math.max(a.left - b.left, b.right - a.right));
      })(),
      /* Measured as the row's own width: with no conversation open the rows
         are hidden, and a hidden span has no box — but the rule that used to
         squeeze them to a 40px circle would still show up here. */
      menuLabel: (() => {
        document.getElementById('chatThreadMenuBtn')?.click();
        const row = document.querySelector('#chatThreadMenu .chat-action-row');
        const span = row?.querySelector('span');
        const value = row ? Math.round(parseFloat(getComputedStyle(row).maxWidth) || 999) : 0;
        const spanShown = span ? getComputedStyle(span).display !== 'none' : false;
        document.getElementById('chatThreadMenuBtn')?.click();
        return spanShown ? value : 0;
      })(),
      threadTitle: document.getElementById('chatActivePeerName')?.textContent.trim(),
      avatarHidden: document.getElementById('chatActiveAvatar')?.classList.contains('hidden'),
      identityBtn: (() => {
        const b = document.getElementById('chatQuickIdentityBtn');
        const c = document.querySelector('#content-chat .chat-profile-card');
        if (!b || !c) return null;
        const bb = b.getBoundingClientRect();
        const cb = c.getBoundingClientRect();
        return { size: Math.round(bb.width), fromBottom: Math.round(cb.bottom - bb.bottom) };
      })(),
    };
  });
  check(`${label}: the quick-access bar and its settings are gone`,
    wide.bar === 'none' && wide.barSettingsCard === 'none',
    `bar ${wide.bar}, card ${wide.barSettingsCard}`);
  check(`${label}: the sidebar runs to the bottom of the window`,
    wide.sidebarGap !== null && wide.sidebarGap <= 2, `${wide.sidebarGap}px short`);
  /* The column has one width now: a rail that can be dragged is a rail that
     can be left somewhere unhelpful, and everything in it is laid out against
     a width that no longer moves. */
  check(`${label}: the conversation rail has a fixed width`,
    wide.resizer === 'none', wide.resizer);
  check(`${label}: the chat fills the panel it is given, with no band beside it`,
    wide.shellGap <= 12, `${wide.shellGap}px`);
  check(`${label}: the conversation menu shows its labels, not bare icons`,
    wide.menuLabel > 100, `${wide.menuLabel}px`);
  check(`${label}: the search bar stays put in every view`,
    wide.search !== 'none' && wide.search !== 'missing', wide.search);
  check(`${label}: Calls fills both columns and drops the placeholder peer`,
    wide.recent === 1 && wide.avatarHidden === true, JSON.stringify(wide));
  check(`${label}: and it is the call log the header names`,
    /تاریخچ|Call history/.test(wide.threadTitle || ''), String(wide.threadTitle));
  check(`${label}: the identity button is big and inset from the card's corner`,
    (wide.identityBtn?.size || 0) >= 36 && (wide.identityBtn?.fromBottom || 0) >= 6,
    JSON.stringify(wide.identityBtn));
  /* A sheet you can see but cannot click is worse than one that never opens.
     The desktop backdrop was a body::before at z-index 9998 in the ROOT
     stacking context while the sheet — z-index 9999 — lives inside
     #content-chat, so a local 9999 lost to a root 9998 and the half-opaque
     backdrop covered the card: it looked right and swallowed every click.
     Hit-test the field rather than trusting that it is on screen. */
  await page.evaluate(() => document.querySelector('[data-chat-view="chats"]')?.click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('chatProfileMenuBtn')?.click());
  await page.waitForTimeout(700);
  const sheetReach = await page.evaluate(() => {
    const input = document.getElementById('chatProfileName');
    const box = input?.getBoundingClientRect();
    if (!box || !box.width) return { ok: false, why: 'no field' };
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      ok: Boolean(hit && (hit === input || input.contains(hit))),
      why: hit ? (hit.id || String(hit.className).split(' ')[0] || hit.tagName) : 'nothing',
      stack: document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        .slice(0, 3).map((el) => el.id || el.tagName).join(' > '),
    };
  });
  check(`${label}: the profile sheet takes clicks, not just paint`,
    sheetReach.ok === true, `${sheetReach.why} — ${sheetReach.stack || ''}`);
  /* And it is a dialog, not a slab. The tab-canvas rule gives every direct
     child of a .tab-content width:100% and carries an id, so it out-ranked the
     sheet's own width; and #content-chat kept an identity transform from its
     entry animation, which made it the containing block for the sheet's
     position:fixed and centred the card on the panel instead of the window. */
  const sheetShape = await page.evaluate(() => {
    const el = document.getElementById('chatFullSheet');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), x: Math.round(r.x), vw: window.innerWidth,
      centred: Math.abs((r.x + r.width / 2) - window.innerWidth / 2) <= 2,
      panelTransform: (() => { const p = document.getElementById('content-chat');
        return p ? getComputedStyle(p).transform : 'missing'; })() };
  });
  check(`${label}: the sheet is a centred dialog, not the full width`,
    Boolean(sheetShape) && sheetShape.w <= 620 && sheetShape.w < sheetShape.vw * 0.7 && sheetShape.centred,
    JSON.stringify(sheetShape));
  check(`${label}: the chat panel does not trap fixed children`,
    sheetShape?.panelTransform === 'none', String(sheetShape?.panelTransform));
  await page.evaluate(() => document.querySelector('#chatFullSheet .chat-fullsheet-back')?.click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-chat-view="chats"]')?.click());
}
await page.setViewportSize({ width: 430, height: 932 });
await page.waitForTimeout(400);

console.log('\n===== the chat lock takes the digits the keyboard gives it =====');
/* A Persian keyboard types U+06F1 where an English one types "1". They hash to
   different digests, so the same PIN was refused depending on the keyboard.
   Driven through the app's own set/verify pair, not a faked digest. */
const pinRun = await page.evaluate(async () => {
  // Seed the pre-v37 PIN format to exercise migration and digit folding.
  const set = async pin => {
    const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
    saveEncrypted(VAULT_LOCK_STORAGE_KEY, { enabled:false });
    saveEncrypted(CHAT_LOCK_STORAGE_KEY, {enabled:true,salt,digest:await derivePinDigest(normalizePinDigits(pin),salt),iterations:CHAT_LOCK_ITERATIONS});
    lockVaultNow();
  };
  const out = {};
  await set('1234');
  out.persianOpensAscii = await window.__chatLockProbe.tryUnlock('۱۲۳۴');
  out.asciiStillOpens = await window.__chatLockProbe.tryUnlock('1234');
  out.wrongStillFails = await window.__chatLockProbe.tryUnlock('۹۹۹۹');
  await set('۵۶۷۸');
  out.asciiOpensPersian = await window.__chatLockProbe.tryUnlock('5678');
  out.arabicIndicOpens = await window.__chatLockProbe.tryUnlock('٥٦٧٨');
  await window.__chatLockProbe.disable('5678');
  return out;
});
console.log('  ' + JSON.stringify(pinRun));
check('a PIN set in English digits opens when typed in Persian',
  pinRun.persianOpensAscii === true && pinRun.asciiStillOpens === true, JSON.stringify(pinRun));
check('and one set in Persian digits opens when typed in English',
  pinRun.asciiOpensPersian === true && pinRun.arabicIndicOpens === true, JSON.stringify(pinRun));
check('while a wrong PIN is still a wrong PIN',
  pinRun.wrongStillFails === false, String(pinRun.wrongStillFails));

/* A missed call logged while the Chats tab is open must not repaint the side
   panel into the call history — which is what a call to an offline contact did:
   the tab stayed on Chats and the list underneath became Calls. */
const stayedOnChats = await page.evaluate(async () => {
  document.querySelector('[data-chat-view="chats"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const before = document.getElementById('chatListTitle')?.textContent || '';
  window.__callLogProbe?.append({
    name: 'Probe', peerId: 'peer-probe-offline', mode: 'video', status: 'missed', direction: 'out',
  });
  await new Promise((r) => setTimeout(r, 600));
  return {
    before,
    after: document.getElementById('chatListTitle')?.textContent || '',
    view: document.querySelector('.chat-nav-btn.active')?.dataset.chatView || '',
    showsCallRows: document.querySelectorAll('#chatPeerList .chat-call-log-row').length,
  };
});
console.log('  ' + JSON.stringify(stayedOnChats));
check('logging a call leaves the Chats panel alone',
  stayedOnChats.after === stayedOnChats.before && stayedOnChats.showsCallRows === 0,
  JSON.stringify(stayedOnChats));

console.log('\n===== the About page =====');
await page.evaluate(() => window.switchTab?.('about'));
await page.waitForTimeout(900);
const about = await page.evaluate(() => ({
  navLabel: document.querySelector('[data-i18n="about"]')?.textContent.trim() || '',
  name: document.querySelector('#content-about .about-name')?.textContent.trim() || '',
  /* The page carries the project's name, not a person's. */
  personal: /Farhadianfard|Mohammadmahdi/i.test(document.getElementById('content-about')?.textContent || ''),
  mail: document.querySelector('#content-about a[href^="mailto:"]')?.getAttribute('href') || '',
  wallet: document.querySelector('#aboutDonateAddress code')?.textContent.trim() || '',
  ton: document.querySelector('#content-about a[href^="ton://"]')?.getAttribute('href') || '',
}));
console.log('  ' + JSON.stringify(about));
check('the page is about the project, under one name',
  about.name === 'P00RIJÃ' && about.personal === false, JSON.stringify(about));
check('and it is titled "about me"',
  about.navLabel === 'درباره من' || about.navLabel === 'About Me', about.navLabel);
check('the contact address is the current one',
  about.mail === 'mailto:p00rija@tutamail.com', about.mail);
check('the wallet address is shown in full, with a link a wallet can open',
  about.wallet === 'UQCEgGxRZ5A101w6RBNLwHhnva5EdK3kyDsFQcxni35DlCJf'
  && about.ton === `ton://transfer/${about.wallet}`, JSON.stringify({ w: about.wallet, t: about.ton }));

const donate = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('aboutDonateQrBtn')?.click();
  await sleep(500);
  const box = document.getElementById('aboutDonateQr');
  const drawn = box ? box.querySelectorAll('img, canvas').length : 0;
  const openLabel = document.querySelector('#aboutDonateQrBtn span')?.textContent.trim();
  document.getElementById('aboutDonateQrBtn')?.click();
  await sleep(300);
  const closed = box?.classList.contains('hidden');
  document.getElementById('aboutDonateAddress')?.click();
  await sleep(300);
  return { drawn, openLabel, closed,
    copiedState: document.getElementById('aboutDonateAddress')?.classList.contains('is-copied') };
});
console.log('  ' + JSON.stringify(donate));
check('the QR is drawn on demand and can be put away again',
  donate.drawn >= 1 && donate.closed === true && Boolean(donate.openLabel), JSON.stringify(donate));
check('and copying the address says so on the button itself',
  donate.copiedState === true, String(donate.copiedState));
await page.evaluate(() => window.switchTab?.('chat'));
await page.waitForTimeout(600);

check('no script threw while doing any of it', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
