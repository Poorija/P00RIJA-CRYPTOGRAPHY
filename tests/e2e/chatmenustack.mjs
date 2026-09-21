/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The thread menu opens over the conversation, not under it.
 *
 * Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
 *
 *   PORT=8123 npm run dev         # terminal 1
 *   PKG_URL=http://localhost:8123 node tests/e2e/chatmenustack.mjs
 *
 * Choosing a chat background used to put the header's dropdown UNDERNEATH the
 * messages: the background layer was introduced with
 *
 *     .chat-thread > * { position: relative; z-index: 1 !important }
 *
 * to lift the content off it, and that flattened the header, the message panel
 * and the composer onto one level. Siblings sharing a z-index paint in DOM
 * order, so the message panel — which comes after the header — painted over
 * it, and the !important overrode the z-index: 12 the header carries for
 * precisely this reason. Stickers and text sat on top of an open menu.
 *
 * Asserted through elementFromPoint rather than by reading z-index values,
 * because what matters is which element the browser would actually hand a
 * click to. Every background preset is checked, and the no-background case
 * too, so a fix for one styling path cannot quietly break another. */
import { chromium } from 'playwright';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

const browser = await chromium.launch();
/* ignoreHTTPSErrors because the runner's default origin is the container on
   https://localhost:8585, whose certificate is self-signed. Without it the
   stylesheet simply never arrives and every assertion below reports on an
   unstyled page. */
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

/* A blank document carrying the real stylesheet, rather than the running app.
   The bug is a CSS stacking contract and nothing else, and the live app puts a
   lock screen over everything until somebody signs in — so a fixture built
   inside it measures the lock screen's buttons instead of the thread. This
   asserts the rules themselves, on the same DOM shape index.html uses. */
/* Served from the app's own origin through a route, not page.setContent: the
   stylesheet is fetched relative to the document, and the app's own JS must
   not run — it puts a lock screen over everything until somebody signs in. */
const FIXTURE_URL = `${BASE_URL}/__chatmenustack__.html`;
await page.route(FIXTURE_URL, (route) => route.fulfill({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body: `<!doctype html><html><head><meta charset="utf-8">
  <link rel="stylesheet" href="/css/styles.css">
</head><body style="margin:0">
  <div id="mainApp"><div id="content-chat" data-chat-active-view="chats">
    <div class="chat-thread" id="probeThread" style="height:760px">
      <div class="chat-thread-header" id="probeHeader">
        <div class="chat-thread-menu-wrap">
          <button type="button" class="chat-thread-menu-btn">menu</button>
          <div class="chat-actions-sheet chat-thread-menu" id="probeMenu"
               style="position:absolute;top:100%;inset-inline-start:0;width:260px;height:320px"></div>
        </div>
      </div>
      <div class="chat-messages-panel" id="probePanel" style="height:600px">
        <div id="probeSticker" style="height:420px"></div>
      </div>
      <!-- Siblings of the conversation, not children of it: the calls panel and
           the settings stage are appended straight onto .chat-thread, so the
           wallpaper layer sits behind them too unless they are lifted. -->
      <div class="chat-calls-panel" id="probeCalls" style="height:200px"><span id="probeCallsText">calls</span></div>
      <div class="chat-settings-stage" id="probeSettings" style="height:200px"><span id="probeSettingsText">settings</span></div>
      <div class="chat-composer-bar" id="probeComposer"></div>
    </div>
  </div></div>
</body></html>`,
}));
await page.goto(FIXTURE_URL, { waitUntil: 'load' });
await page.waitForTimeout(400);

const built = await page.evaluate(() => {
  const box = document.getElementById('probeMenu').getBoundingClientRect();
  const sheets = [...document.styleSheets].filter((sheet) => {
    try { return sheet.cssRules.length > 0; } catch (_error) { return false; }
  }).length;
  return {
    ok: box.width > 0 && box.height > 0 && sheets > 0,
    why: `menu ${Math.round(box.width)}x${Math.round(box.height)}, ${sheets} stylesheet(s) loaded`,
  };
});
check('the probe thread is on the page with the real stylesheet', built.ok, built.why);
if (!built.ok) {
  console.log('\n===== 1 failed of 1 =====');
  await browser.close();
  process.exit(1);
}

/* Where the menu overlaps the message panel: the one point that tells the two
   apart. */
const topmostOverMenu = async () => page.evaluate(async () => {
  const menu = document.getElementById('probeMenu');
  /* .chat-thread carries its own position, so the fixture lands wherever the
     real layout puts it — well below the fold. elementFromPoint answers about
     the VIEWPORT and returns null for anything outside it, which would read as
     "nothing is on top" and pass this suite while the bug was live. */
  menu.scrollIntoView({ block: 'center' });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const box = menu.getBoundingClientRect();
  const x = Math.round(box.left + box.width / 2);
  const y = Math.round(box.bottom - 12);
  const onScreen = y > 0 && y < window.innerHeight && x > 0 && x < window.innerWidth;
  const hit = onScreen ? document.elementFromPoint(x, y) : null;
  return {
    onScreen,
    id: hit?.id || hit?.className || '(nothing)',
    insideMenu: onScreen && (menu === hit || Boolean(hit && menu.contains(hit))),
  };
});

const setBackground = (value, image) => page.evaluate(([bg, img]) => {
  if (bg === null) {
    document.documentElement.style.removeProperty('--chat-thread-bg');
    document.documentElement.style.removeProperty('--chat-thread-image');
    return;
  }
  document.documentElement.style.setProperty('--chat-thread-bg', bg);
  if (img) document.documentElement.style.setProperty('--chat-thread-image', img);
  else document.documentElement.style.removeProperty('--chat-thread-image');
}, [value, image]);

console.log('\n===== with no chat background chosen =====');
await setBackground(null);
await page.waitForTimeout(150);
let hit = await topmostOverMenu();
check('the menu is what a click would reach', hit.insideMenu, `topmost: ${hit.id}${hit.onScreen ? '' : ' (probe point off-screen)'}`);

console.log('\n===== with a background colour =====');
await setBackground('#123456');
await page.waitForTimeout(150);
hit = await topmostOverMenu();
check('THE MENU IS STILL ON TOP — the bug this suite exists for', hit.insideMenu,
  `topmost: ${hit.id}${hit.onScreen ? '' : ' (probe point off-screen)'}; before the fix the message panel painted over the header`);

console.log('\n===== with a gradient preset =====');
await setBackground('linear-gradient(180deg, #7c3aed, #db2777)');
await page.waitForTimeout(150);
hit = await topmostOverMenu();
check('a gradient preset does not bury it either', hit.insideMenu, `topmost: ${hit.id}${hit.onScreen ? '' : ' (probe point off-screen)'}`);

console.log('\n===== with an uploaded picture and blur =====');
await setBackground('#000000', 'url("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")');
await page.evaluate(() => document.documentElement.style.setProperty('--chat-bg-blur', '12px'));
await page.waitForTimeout(150);
hit = await topmostOverMenu();
check('a blurred picture does not bury it either', hit.insideMenu, `topmost: ${hit.id}${hit.onScreen ? '' : ' (probe point off-screen)'}`);

/* The background must still be BEHIND the conversation, or this would pass by
   painting nothing at all.
   Asked of a PLAIN, unpositioned element rather than of the z-index, because
   the z-index is the implementation and this is the behaviour. It is also the
   half that is easy to break while fixing the other: lifting the background
   off the menu by raising it covers the messages instead, which is what the
   blanket rule was there to stop, and the QR dialog's canvas came back
   unreadable the one time that trade was made the wrong way round. */
const overPlainContent = await page.evaluate(async () => {
  const sticker = document.getElementById('probeSticker');
  sticker.scrollIntoView({ block: 'center' });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const box = sticker.getBoundingClientRect();
  const x = Math.round(box.left + box.width / 2);
  const y = Math.round(box.top + box.height / 2);
  const hit = document.elementFromPoint(x, y);
  return { id: hit?.id || hit?.className || '(nothing)', isContent: hit === sticker || Boolean(sticker.contains(hit)) };
});
check('and does not cover ordinary message content either',
  overPlainContent.isContent, `topmost over a plain message: ${overPlainContent.id}`);

/* The wallpaper belongs behind the conversation and nowhere else. The calls
   panel and the settings stage share the stage with it, and with the layer
   painted over them a chat background bled across the whole of Secure Chat —
   settings panes, call history, every label on them.

   Sampled as PIXELS, not with elementFromPoint. A ::before is not an element
   and is never returned by hit-testing, so the obvious probe reports the pane
   sitting innocently on top while the wallpaper is painted straight over it.
   That mistake made an earlier version of this suite pass against the exact
   build the bug was reported from. */
const SENTINEL = 'rgb(255, 0, 255)';
await page.evaluate((colour) => {
  document.documentElement.style.setProperty('--chat-thread-bg', colour);
  document.documentElement.style.removeProperty('--chat-thread-image');
  document.documentElement.style.setProperty('--chat-bg-blur', '0px');
}, SENTINEL);
await page.waitForTimeout(200);

const sampleCentre = async (id) => {
  const box = await page.evaluate(async (elementId) => {
    const pane = document.getElementById(elementId);
    pane.scrollIntoView({ block: 'center' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = pane.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, id);
  const shot = await page.screenshot({ clip: { x: box.x - 2, y: box.y - 2, width: 4, height: 4 } });
  /* A 4x4 PNG: read the first pixel out of the IDAT rather than pulling in a
     decoder, by asking the page to draw it back onto a canvas. */
  return page.evaluate(async (base64) => {
    const image = new Image();
    await new Promise((resolve) => { image.onload = resolve; image.src = `data:image/png;base64,${base64}`; });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const [r, g, b] = context.getImageData(2, 2, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  }, shot.toString('base64'));
};

for (const [name, id] of [['the calls panel', 'probeCalls'], ['the settings stage', 'probeSettings']]) {
  const pixel = await sampleCentre(id);
  check(`${name} is not painted over by the chat wallpaper`,
    pixel !== SENTINEL, `centre pixel ${pixel}${pixel === SENTINEL ? ' — the wallpaper is on top of it' : ''}`);
}

/* The wallpaper belongs to an OPEN conversation. .chat-thread-empty is the
   class the app puts on the thread while nothing is selected — the "choose a
   conversation" screen — and a wallpaper there was the report that followed
   the one about settings. */
await page.evaluate(() => {
  document.getElementById('probeThread').classList.add('chat-thread-empty');
});
await page.waitForTimeout(150);
const emptyPixel = await sampleCentre('probeSticker');
check('no wallpaper while nothing is selected', emptyPixel !== SENTINEL,
  `centre pixel ${emptyPixel}${emptyPixel === SENTINEL ? ' — wallpaper on the empty state' : ''}`);
await page.evaluate(() => {
  document.getElementById('probeThread').classList.remove('chat-thread-empty');
});
await page.waitForTimeout(150);

/* And the conversation itself still shows it, or this would pass by painting
   the wallpaper nowhere at all. */
const threadPixel = await sampleCentre('probeSticker');
check('the conversation still shows the wallpaper behind it',
  threadPixel === SENTINEL, `centre pixel ${threadPixel}`);

/* A settings pane does not fill the stage, so lifting it over the wallpaper
   left the wallpaper showing all around it — the whole of Secure Chat tinted.
   The layer must not exist outside the conversation views at all. */
for (const view of ['calls', 'connection', 'settings']) {
  /* The app hides the conversation when one of these views is up, which is what
     leaves bare stage around the pane — and bare stage is exactly where the
     wallpaper showed. Sampling the middle of the pane proves nothing: the pane
     paints its own surface either way, which is how an earlier version of this
     assertion passed against the build the bug was reported from. */
  const bare = await page.evaluate(async (name) => {
    document.getElementById('content-chat').setAttribute('data-chat-active-view', name);
    document.getElementById('probePanel').style.display = 'none';
    document.getElementById('probeCalls').style.display = 'none';
    const settings = document.getElementById('probeSettings');
    settings.style.height = '80px';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const thread = document.getElementById('probeThread').getBoundingClientRect();
    const pane = settings.getBoundingClientRect();
    /* A point inside the stage, below the pane and above the composer: stage
       that nothing covers. */
    return { x: Math.round(thread.left + thread.width / 2), y: Math.round(pane.bottom + 40) };
  }, view);
  const shot = await page.screenshot({ clip: { x: bare.x - 2, y: bare.y - 2, width: 4, height: 4 } });
  const pixel = await page.evaluate(async (base64) => {
    const image = new Image();
    await new Promise((resolve) => { image.onload = resolve; image.src = `data:image/png;base64,${base64}`; });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const [r, g, b] = context.getImageData(2, 2, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  }, shot.toString('base64'));
  check(`no wallpaper on bare stage in the "${view}" view`, pixel !== SENTINEL,
    `pixel beside the pane: ${pixel}${pixel === SENTINEL ? ' — wallpaper outside a conversation' : ''}`);
}
await page.evaluate(() => {
  document.getElementById('probePanel').style.display = '';
  document.getElementById('probeCalls').style.display = '';
  document.getElementById('probeSettings').style.height = '200px';
});
await page.evaluate(() => {
  document.getElementById('content-chat').setAttribute('data-chat-active-view', 'chats');
});
await page.waitForTimeout(120);

/* The phone's own navigation is not part of the chat. --mobile-page-bg used to
   be derived from --chat-thread-bg, so choosing a chat background repainted the
   quick-access bar at the bottom of the app with it. */
const mobileBar = await page.evaluate((colour) => {
  document.documentElement.classList.add('mobile-browser-context');
  const read = getComputedStyle(document.documentElement).getPropertyValue('--mobile-page-bg').trim();
  document.documentElement.classList.remove('mobile-browser-context');
  return { read, sentinel: colour };
}, SENTINEL);
check('the mobile quick-access bar does not follow the chat wallpaper',
  mobileBar.read !== mobileBar.sentinel && !mobileBar.read.includes('255, 0, 255'),
  `--mobile-page-bg resolves to ${mobileBar.read || '(empty)'}`);

const layer = await page.evaluate(() => {
  const thread = document.getElementById('probeThread');
  const before = getComputedStyle(thread, '::before');
  return { z: before.zIndex, content: before.content, isolation: getComputedStyle(thread).isolation };
});
check('the background layer is actually painted', layer.content !== 'none', `content: ${layer.content}`);
check('and stays inside the thread rather than slipping behind the app',
  layer.isolation === 'isolate', `isolation: ${layer.isolation}`);

/* The header keeps the z-index it declares for itself. */
const headerZ = await page.evaluate(() =>
  getComputedStyle(document.getElementById('probeHeader')).zIndex);
check('the header keeps its own stacking order, not a flattened one',
  headerZ !== '1', `header z-index: ${headerZ}`);

await browser.close();
const bad = results.filter((ok) => !ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
