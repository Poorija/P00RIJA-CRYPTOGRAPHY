/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Connection quality, without leaving the call.
 *
 *   npm run relay
 *   PORT=8123 npm run dev
 *   node tests/e2e/callquality.mjs
 *
 * The reported problem: during a call, seeing the connection quality meant
 * minimising the call, going to Secure Chat → Settings → Tools, choosing the
 * peer, and reading a table. By then the moment you wanted to measure is over,
 * and on a phone the call is no longer on screen at all.
 *
 * There was a quality indicator in the call header already, but it was a
 * `<span>` whose entire detail was a `title` tooltip — nothing a touchscreen
 * can show — carrying three colours and no numbers. The numbers were computed
 * every five seconds and thrown away.
 *
 * So the test that matters is not "does the panel render". It is: can you read
 * the numbers WHILE the call is on screen and still be in the call afterwards.
 * Every assertion below checks the call is still up and still the active tab.
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
/* Reachable FROM THE PAGE, not just from here: an https page cannot fetch
   http://localhost:9000 or open a ws:// socket to it — the browser blocks it as
   mixed content and the suite reads that as a relay that is down. When the app
   is served over https the relay defaults to that same origin, which is the
   container serving both halves. The env var still wins. */
const RELAY = process.env.RELAY_URL
  || (/^https:/i.test(BASE_URL) ? String(BASE_URL).replace(/\/+$/, '') : 'http://localhost:9000');
const PASS = 'Harness#Pass2026!';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

async function app(tag, width, height, mobile = false) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width, height },
    permissions: ['microphone', 'camera'],
    isMobile: mobile,
    hasTouch: mobile,
  });
  await context.addInitScript(() => {
    try { localStorage.setItem('poorija_lang', 'fa'); } catch (error) { /* private mode */ }
    window.__clip = [];
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`   ${tag}!! ${error.message.slice(0, 140)}`));
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  /* A first load registers the service worker, which reloads the page out from
     under the next evaluate. Settle before touching anything. */
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    if (typeof continueInBrowserExperience === 'function') continueInBrowserExperience();
  });
  await page.waitForTimeout(600);
  await page.evaluate((pass) => {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('setupPassword', pass);
    set('confirmPassword', pass);
    document.querySelectorAll('#initialSetup select').forEach((select, index) => {
      if (select.options.length > index + 1) {
        select.selectedIndex = index + 1;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    document.querySelectorAll('#initialSetup input[type="text"]').forEach((input, index) => {
      input.value = 'answer' + index;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const terms = document.getElementById('acceptTermsCheckbox');
    if (terms && !terms.checked) { terms.checked = true; terms.dispatchEvent(new Event('change', { bubbles: true })); }
  }, PASS);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('setupBtn')?.click());
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (text) => { window.__clip.push(text); return write(text).catch(() => {}); };
    document.getElementById('mobileInstallGate')?.classList.add('hidden');
    window.switchTab?.('chat');
  });
  await page.waitForTimeout(700);
  await page.evaluate((relay) => {
    const url = document.getElementById('chatServerUrl');
    if (url) {
      url.value = relay;
      url.dispatchEvent(new Event('input', { bubbles: true }));
      url.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.getElementById('chatConnectBtn')?.click();
  }, RELAY);
  await page.waitForTimeout(6500);
  return page;
}

/* `chatState` is declared `const` at the top level of a classic script, which
   puts it in the shared global LEXICAL environment — reachable by name from
   any other classic script, but NOT a property of `window`. So
   `window.chatState` is undefined and reads through it silently return nothing;
   an earlier version of this file did that and reported a perfectly healthy
   call as never having connected. eval() reaches the binding by name, which is
   what the rest of the suite does too. */
const peek = (page, expression) => page.evaluate((source) => {
  try { return eval(source); } catch (error) { return null; }
}, expression);

/* Everything the panel is supposed to answer, plus the two facts that make the
   answer worth anything: the call is still running and still on screen. */
const inspect = (page) => page.evaluate(() => {
  const card = document.getElementById('chatCallQualityCard');
  const badge = document.getElementById('chatCallQualityBadge');
  const overlay = document.getElementById('chatFloatingCall');
  const rows = Array.from(card?.querySelectorAll('.chat-call-quality-row') || []);
  return {
    stillInCall: Boolean(overlay) && !overlay.classList.contains('hidden'),
    stillOnChatTab: window.PoorijaApp?.state?.activeTab === 'chat',
    badgeIsButton: badge?.tagName === 'BUTTON',
    /* The pill carries one segment per direction: what this device receives,
       and what the other side receives from us. */
    mineText: document.getElementById('chatCallQualityMineValue')?.textContent || '',
    theirsText: document.getElementById('chatCallQualityTheirsValue')?.textContent || '',
    mineClass: document.getElementById('chatCallQualityMine')?.className || '',
    theirsClass: document.getElementById('chatCallQualityTheirs')?.className || '',
    whoLabels: Array.from(document.querySelectorAll('#chatCallQualityBadge .chat-call-quality-who'))
      .map((el) => el.textContent),
    badgeClass: badge?.className || '',
    expanded: badge?.getAttribute('aria-expanded'),
    cardOpen: Boolean(card) && !card.classList.contains('hidden'),
    rows: rows.length,
    rowClasses: rows.map((row) => row.className),
    labels: Array.from(card?.querySelectorAll('.chat-call-quality-stat span') || [])
      .map((el) => el.textContent),
    values: Array.from(card?.querySelectorAll('.chat-call-quality-stat strong') || [])
      .map((el) => el.textContent),
    verdicts: Array.from(card?.querySelectorAll('.chat-call-quality-verdict') || [])
      .map((el) => el.textContent),
    readings: (() => { try { return (eval('chatState').callQualityReadings || []).length; }
                       catch (error) { return 0; } })(),
    readingsHasMine: (() => { try { return (eval('chatState').callQualityReadings || []).some((r) => r.mine); }
                              catch (error) { return false; } })(),
  };
});

let A;
let B;
try {
  A = await app('A', 1440, 900);
  B = await app('B', 390, 844, true);

  const idA = await A.evaluate(async () => { await window.copyChatFullIdentity(); return window.__clip.at(-1); });
  await B.evaluate(async (identity) => {
    document.getElementById('chatStartChatBtn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    document.querySelector('[data-chat-manual-json]').value = identity;
    document.querySelector('[data-chat-manual-submit]')?.click();
  }, idA);
  await B.waitForTimeout(2500);
  await B.evaluate(() => document.querySelector('#chatPeerList .chat-peer-card')?.click());
  await B.waitForTimeout(4000);
  await B.fill('#chatComposer', 'pairing');
  await B.click('#chatSendMessageBtn');
  await A.waitForTimeout(4500);
  await A.evaluate(() => document.querySelector('#chatPeerList .chat-peer-card')?.click());
  await A.waitForTimeout(2500);

  /* ===== the control, before anything is opened ======================== */

  console.log('\n===== the indicator itself =====');

  const beforeCall = await A.evaluate(() => ({
    isButton: document.getElementById('chatCallQualityBadge')?.tagName === 'BUTTON',
    hasCard: Boolean(document.getElementById('chatCallQualityCard')),
    controls: document.getElementById('chatCallQualityBadge')?.getAttribute('aria-controls'),
  }));
  check('the quality indicator is something you can press, not a tooltip',
    beforeCall.isButton && beforeCall.controls === 'chatCallQualityCard',
    JSON.stringify(beforeCall));
  check('and it has a panel to open', beforeCall.hasCard);

  /* ===== a real call ==================================================== */

  console.log('\n===== during an audio call =====');

  /* Audio, deliberately. The old monitor summed only `kind === "video"`
     inbound streams, so a voice call always reported 0% loss — a call breaking
     up looked perfect, which is worse than reporting nothing. */
  await A.evaluate(() => document.getElementById('chatVoiceCallBtn')?.click());
  await B.waitForTimeout(3000);

  /* Which control appears depends on where the callee is in the interface — a
     sheet on the chat screen, a modal elsewhere — and how quickly the invite
     arrives depends on the relay. Poll for whichever becomes visible rather
     than assuming one of them and racing the other. offsetParent is the part
     that matters: both exist in the DOM at all times. */
  const accepted = await (async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const via = await B.evaluate(() => {
        const visible = (el) => el && !el.classList.contains('hidden') && el.offsetParent !== null;
        const sheet = document.getElementById('chatAcceptCallBtn');
        const modal = document.getElementById('chatModalAcceptBtn');
        if (visible(sheet)) { sheet.click(); return 'sheet'; }
        if (visible(modal)) { modal.click(); return 'modal'; }
        return '';
      });
      if (via) return via;
      await B.waitForTimeout(500);
    }
    return '';
  })();
  console.log(`  B accepted via: ${accepted || 'nothing appeared'}`);

  /* Long enough for the first getStats sample to land and for RTP to flow. */
  await A.waitForTimeout(9000);

  if (process.env.CQ_DEBUG) {
    for (const [tag, page] of [['A', A], ['B', B]]) {
      const state = await page.evaluate(() => {
        let cs = null;
        try { cs = eval('chatState'); } catch (error) { cs = null; }
        return {
          currentCall: Boolean(cs?.currentCall),
          pc: cs?.currentCall?.peerConnection?.connectionState ?? null,
          ice: cs?.currentCall?.peerConnection?.iceConnectionState ?? null,
          answeredAt: cs?.currentCallAnsweredAt || 0,
          mode: cs?.currentCallMode,
          readings: (cs?.callQualityReadings || []).length,
          overlay: !document.getElementById('chatFloatingCall')?.classList.contains('hidden'),
          status: document.getElementById('chatFloatingCallStatus')?.textContent,
        };
      });
      console.log(`  [${tag}] ${JSON.stringify(state)}`);
    }
  }

  const connected = await A.evaluate(() => {
    let cs = null;
    try { cs = eval('chatState'); } catch (error) { cs = null; }
    return {
      overlay: !document.getElementById('chatFloatingCall')?.classList.contains('hidden'),
      connection: cs?.currentCall?.peerConnection?.connectionState || null,
      readings: (cs?.callQualityReadings || []).length,
    };
  });
  console.log(`  ${JSON.stringify(connected)}`);
  check('the call is up and the monitor has taken a reading',
    connected.overlay && connected.readings > 0, JSON.stringify(connected));

  if (connected.readings > 0) {
    const badgeOnly = await inspect(A);
    check('the round trip is legible on the badge without opening anything',
      /^\d+ms$/.test(badgeOnly.theirsText) || /^\d+ms$/.test(badgeOnly.mineText),
      `pill reads theirs="${badgeOnly.theirsText}" mine="${badgeOnly.mineText}"`);
    check('the pill has both directions labelled',
      badgeOnly.whoLabels.length === 2 && badgeOnly.whoLabels.every((label) => label.length > 0),
      JSON.stringify(badgeOnly.whoLabels));
    check('each direction carries its own verdict colour',
      /\b(good|ok|bad)\b/.test(badgeOnly.theirsClass)
      && (!badgeOnly.readingsHasMine || /\b(good|ok|bad)\b/.test(badgeOnly.mineClass)),
      `${badgeOnly.mineClass} / ${badgeOnly.theirsClass}`);
    const pillBox = await A.evaluate(() => {
      const badge = document.getElementById('chatCallQualityBadge');
      if (!badge) return { ok: false, why: 'no badge' };
      const rect = badge.getBoundingClientRect();
      const style = getComputedStyle(badge);
      const ok = rect.height > 0 && Math.round(rect.width) > Math.round(rect.height) + 8
        && parseFloat(style.borderRadius) >= rect.height / 2 - 1;
      return { ok, w: Math.round(rect.width), h: Math.round(rect.height), r: style.borderRadius, display: style.display };
    });
    console.log('  pill ' + JSON.stringify(pillBox));
    check('the pill is a rounded rectangle, not a circle', pillBox.ok === true, JSON.stringify(pillBox));
    check('nothing is open yet', badgeOnly.cardOpen === false && badgeOnly.expanded === 'false',
      `${badgeOnly.cardOpen} / ${badgeOnly.expanded}`);

    /* ===== the whole point ============================================= */

    console.log('\n===== opening it without leaving the call =====');

    await A.evaluate(() => document.getElementById('chatCallQualityBadge')?.click());
    await A.waitForTimeout(400);
    const open = await inspect(A);
    console.log(`  ${JSON.stringify({ rows: open.rows, values: open.values, verdicts: open.verdicts })}`);

    check('THE CALL IS STILL ON SCREEN while the numbers are being read',
      open.stillInCall && open.stillOnChatTab,
      `overlay ${open.stillInCall}, tab ${open.stillOnChatTab}`);
    check('the panel opened', open.cardOpen && open.expanded === 'true',
      `${open.cardOpen} / ${open.expanded}`);
    check('it shows one row per connection, plus the outbound "you" row when reported',
      open.rows >= connected.readings,
      `${open.rows} rows for ${connected.readings} readings`);
    check('with round trip, loss and jitter, not just a colour',
      open.values.length >= 4 && open.values.some((value) => /ms$/.test(value))
      && open.values.some((value) => /%$/.test(value)),
      JSON.stringify(open.values));
    check('and a verdict in words', open.verdicts.length > 0 && open.verdicts[0].trim().length > 0,
      JSON.stringify(open.verdicts));
    check('the row is colour-coded by that verdict',
      open.rowClasses.every((name) => /is-(good|ok|bad|unknown)/.test(name)),
      JSON.stringify(open.rowClasses));

    /* Removing `hidden` proves the class changed, not that anyone can see the
       result. The call overlay styles itself through a block of
       `html body #chatFloatingCall:is(#chatFloatingCall) … !important` rules,
       so an ordinary selector loses to it and the panel can end up unstyled,
       zero-height, or outside the window while every class assertion above
       still passes. This measures the pixels. */
    const box = await A.evaluate(() => {
      const card = document.getElementById('chatCallQualityCard');
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      return {
        w: Math.round(rect.width), h: Math.round(rect.height),
        top: Math.round(rect.top), left: Math.round(rect.left),
        right: Math.round(rect.right), bottom: Math.round(rect.bottom),
        viewport: { w: window.innerWidth, h: window.innerHeight },
        display: style.display,
        opacity: Number(style.opacity),
        position: style.position,
        zIndex: style.zIndex,
      };
    });
    console.log(`  panel box ${JSON.stringify(box)}`);
    check('the panel is genuinely on screen, not merely un-hidden',
      Boolean(box) && box.w > 200 && box.h > 60 && box.display !== 'none' && box.opacity > 0.5,
      JSON.stringify(box));
    check('and it fits inside the window',
      Boolean(box) && box.top >= 0 && box.left >= 0
      && box.right <= box.viewport.w + 1 && box.bottom <= box.viewport.h + 1,
      JSON.stringify(box));
    check('it sits above the video rather than behind it',
      Boolean(box) && box.position === 'absolute' && Number(box.zIndex) >= 30,
      `${box?.position}, z-index ${box?.zIndex}`);

    /* The header hides itself after a few idle seconds. A panel that stayed
       behind would cover the call with no control left to dismiss it. */
    /* Two things fight this measurement and both had to be handled.
       The opacity is transitioned over 0.28s while pointer-events is not, so
       reading in the same frame shows the panel unclickable but still opaque.
       And the app takes `chrome-hidden` straight back off whenever it notes
       activity, so a class set here can be gone before the transition ends —
       which is what made an earlier version fail against CSS that was correct.
       So: hold the class on, and report whether it survived. */
    const withChromeHidden = await A.evaluate(async () => {
      const overlay = document.getElementById('chatFloatingCall');
      const card = document.getElementById('chatCallQualityCard');
      const hold = setInterval(() => overlay?.classList.add('chrome-hidden'), 50);
      overlay?.classList.add('chrome-hidden');
      await new Promise((resolve) => setTimeout(resolve, 700));
      const style = getComputedStyle(card);
      const result = {
        opacity: Number(style.opacity),
        pointerEvents: style.pointerEvents,
        classHeld: overlay?.classList.contains('chrome-hidden'),
      };
      clearInterval(hold);
      overlay?.classList.remove('chrome-hidden');
      return result;
    });
    check('it fades away with the rest of the call chrome',
      withChromeHidden.classHeld && withChromeHidden.opacity < 0.5
      && withChromeHidden.pointerEvents === 'none',
      JSON.stringify(withChromeHidden));

    /* The bug the audio call was chosen to catch. */
    const audio = await A.evaluate(() => {
      let cs = null;
      try { cs = eval('chatState'); } catch (error) { cs = null; }
      const reading = (cs?.callQualityReadings || [])[0];
      return reading ? { kinds: reading.kinds, packets: reading.packets, loss: reading.lossPercent } : null;
    });
    console.log(`  streams measured: ${JSON.stringify(audio)}`);
    check('an audio-only call is actually measured, not silently read as perfect',
      Boolean(audio) && audio.kinds.includes('audio') && audio.packets > 0,
      JSON.stringify(audio));

    /* ===== it updates while you watch =================================== */

    const first = await A.evaluate(() =>
      document.querySelector('.chat-call-quality-stat strong')?.textContent);
    await A.waitForTimeout(5000);
    const second = await A.evaluate(() => {
      let cs = null;
      try { cs = eval('chatState'); } catch (error) { cs = null; }
      return {
        value: document.querySelector('.chat-call-quality-stat strong')?.textContent,
        stillOpen: !document.getElementById('chatCallQualityCard')?.classList.contains('hidden'),
        packets: (cs?.callQualityReadings || [])[0]?.packets || 0,
      };
    });
    check('the panel stays open and keeps sampling',
      second.stillOpen && second.packets > 0,
      `${first} then ${second.value}, ${second.packets} packets`);

    /* ===== the two panels share a corner =============================== */

    console.log('\n===== it does not fight the verify card =====');

    await A.evaluate(() => document.getElementById('chatCallVerifyStrip')?.click());
    await A.waitForTimeout(400);
    const swapped = await A.evaluate(() => ({
      quality: !document.getElementById('chatCallQualityCard')?.classList.contains('hidden'),
      verify: !document.getElementById('chatCallVerifyCard')?.classList.contains('hidden'),
      qualityExpanded: document.getElementById('chatCallQualityBadge')?.getAttribute('aria-expanded'),
    }));
    check('opening the safety card puts the quality panel away',
      swapped.quality === false && swapped.qualityExpanded === 'false',
      JSON.stringify(swapped));

    /* ===== closing ===================================================== */

    await A.evaluate(() => document.getElementById('chatCallQualityBadge')?.click());
    await A.waitForTimeout(300);
    await A.evaluate(() => document.querySelector('[data-quality-close]')?.click());
    await A.waitForTimeout(300);
    const closed = await inspect(A);
    check('the close button closes it and the call carries on',
      closed.cardOpen === false && closed.expanded === 'false' && closed.stillInCall,
      JSON.stringify({ open: closed.cardOpen, inCall: closed.stillInCall }));

    /* ===== one implementation, not two ================================= */

    console.log('\n===== the old route agrees with the new one =====');

    const both = await A.evaluate(async () => {
      let cs = null;
      try { cs = eval('chatState'); } catch (error) { cs = null; }
      const viaTools = await window.chatToolsCallQuality?.();
      const viaCall = cs?.callQualityReadings || [];
      return {
        tools: viaTools?.length ?? null,
        call: viaCall.length,
        sameShape: Boolean(viaTools?.[0]) && Boolean(viaCall[0])
          && Object.keys(viaTools[0]).sort().join() === Object.keys(viaCall[0]).sort().join(),
      };
    });
    console.log(`  ${JSON.stringify(both)}`);
    check('Settings → Tools and the in-call panel measure the same thing',
      both.tools === both.call && both.sameShape, JSON.stringify(both));
  } else {
    ['the round trip is legible on the badge without opening anything',
      'THE CALL IS STILL ON SCREEN while the numbers are being read',
      'an audio-only call is actually measured, not silently read as perfect',
      'Settings → Tools and the in-call panel measure the same thing',
    ].forEach((name) => check(name, false, 'the call never connected'));
  }

  /* ===== after the call ================================================ */

  console.log('\n===== after hanging up =====');

  await A.evaluate(() => (document.getElementById('chatEndCallControlBtn')
    || document.getElementById('chatFloatingEndCallBtn'))?.click());
  await A.waitForTimeout(2000);
  const after = await A.evaluate(() => {
    let cs = null;
    try { cs = eval('chatState'); } catch (error) { cs = null; }
    return {
      timer: cs?.callQualityTimer ?? null,
      readings: (cs?.callQualityReadings || []).length,
      badge: document.getElementById('chatCallQualityValue')?.textContent || '',
    };
  });
  /* Falsy rather than strictly null: the property does not exist until a call
     has run, and "never started" is as stopped as "stopped". */
  check('the sampling timer stops when the call does',
    !after.timer && after.readings === 0, JSON.stringify(after));
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('failed:');
  failed.forEach((result) => console.log(`  - ${result.name}`));
  process.exit(1);
}
