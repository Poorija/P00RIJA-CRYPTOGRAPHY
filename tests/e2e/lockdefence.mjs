/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What a lock does when somebody keeps getting it wrong.
 *
 *   PORT=8123 npm run dev ; node tests/e2e/lockdefence.mjs
 *
 * Three tries are free — fingers slip, and a PIN typed on a phone in a pocket
 * is wrong far more often than an attacker is. From the fourth wrong answer on,
 * each one starts a wait, and the waits grow: one minute, three, six, ten. A
 * fifth wait is never served: at that point whatever the lock was guarding is
 * destroyed, because somebody who has sat through twenty minutes of escalating
 * delays to keep guessing is not the person who set the PIN.
 *
 * The two claims that matter most here are the ones a careless implementation
 * gets wrong:
 *
 *   THE COUNTERS SURVIVE A RESTART. A lockout that closing the app clears is
 *   not a lockout, it is a suggestion — and closing the app is the first thing
 *   anybody tries.
 *
 *   THE WIPE IS SCOPED. A group takes the group. A conversation takes that
 *   conversation, its history, its media and ITS SESSION KEY — the one piece
 *   whose survival would let somebody read ciphertext that has already been
 *   sent. Secure Chat takes everything, relay included. Getting this wrong in
 *   either direction is unforgivable: too narrow leaves the thing readable,
 *   too wide destroys data nobody asked to lose.
 */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch();

async function open() {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  /* The lock module only wires its console probes when a page asks for them
     before load: shipping them unconditionally is a bypass, not a diagnostic.
     These suites drive the locks THROUGH those probes, so they have to ask. */
  await context.addInitScript(() => { try { localStorage.setItem('poorija-debug-probes', '1'); } catch (e) {}
    try { localStorage.setItem('poorija_lang', 'fa'); } catch (error) { /* private mode */ }
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`   [page] ${error.message.slice(0, 120)}`));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await settle(page, () => Boolean(window.__convoLockProbe?.wrong));
  return page;
}

try {
  const page = await open();
  check('the lock probe is reachable',
    await page.evaluate(() => typeof window.__convoLockProbe?.wrong === 'function'));

  /* ===== the ladder ====================================================== */

  console.log('\n===== three free tries, then a growing wait =====');

  const ladder = await page.evaluate(() => {
    const probe = window.__convoLockProbe;
    const target = probe.targets.conversation('ladder-test');
    probe.clearLockout(target);
    const steps = [];
    for (let i = 1; i <= 8; i += 1) {
      const outcome = probe.wrong(target);
      steps.push({
        attempt: i,
        blocked: outcome.blocked,
        wipe: outcome.wipe,
        minutes: outcome.remainingMs ? Math.round(outcome.remainingMs / 60000) : 0,
        triesLeft: outcome.triesLeft,
      });
      /* A real caller would be stopped by the wait; this walks past it so the
         whole ladder can be seen in one go. */
      if (outcome.blocked) probe.clearLockout.length, probe.lockoutOf(target);
      if (outcome.blocked) {
        const store = JSON.parse(localStorage.getItem('poorija_chat_lock_attempts') || '{}');
        if (store[target]) { store[target].until = 0; }
        localStorage.setItem('poorija_chat_lock_attempts', JSON.stringify(store));
      }
      if (outcome.wipe) break;
    }
    probe.clearLockout(target);
    return steps;
  });
  ladder.forEach((s) => console.log(`  attempt ${s.attempt}: `
    + (s.wipe ? 'WIPE' : s.blocked ? `${s.minutes} minute wait` : `free, ${s.triesLeft} left`)));

  check('the first three wrong answers only warn',
    ladder.slice(0, 3).every((s) => !s.blocked && !s.wipe),
    JSON.stringify(ladder.slice(0, 3).map((s) => s.triesLeft)));
  check('the fourth starts a one-minute wait',
    ladder[3]?.blocked && ladder[3]?.minutes === 1, JSON.stringify(ladder[3]));
  check('and the waits grow: 1, 3, 6, 10 minutes',
    [1, 3, 6, 10].every((m, i) => ladder[3 + i]?.minutes === m),
    JSON.stringify(ladder.slice(3, 7).map((s) => s.minutes)));
  check('the fifth wait is never served — it wipes instead',
    ladder[7]?.wipe === true, JSON.stringify(ladder[7]));

  /* ===== the wait is actually enforced =================================== */

  console.log('\n===== a wait that is really a wait =====');

  const enforced = await page.evaluate(() => {
    const probe = window.__convoLockProbe;
    const target = probe.targets.conversation('enforced-test');
    probe.clearLockout(target);
    for (let i = 0; i < 4; i += 1) probe.wrong(target);
    return probe.lockoutOf(target);
  });
  check('after the fourth wrong answer the target reports itself blocked',
    enforced.blocked && enforced.remainingMs > 55000, JSON.stringify(enforced));

  /* The claim that separates a lockout from a suggestion. */
  const reloaded = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('poorija_chat_lock_attempts') || '{}');
    return Object.keys(store);
  });
  check('and the counter is written to storage, not just held in memory',
    reloaded.some((key) => key.includes('enforced-test')), JSON.stringify(reloaded));

  await page.reload({ waitUntil: 'load' });
  await settle(page, () => Boolean(window.__convoLockProbe?.wrong));
  const survived = await page.evaluate(() => window.__convoLockProbe
    .lockoutOf(window.__convoLockProbe.targets.conversation('enforced-test')));
  console.log(`  after a reload: ${JSON.stringify(survived)}`);
  check('A RESTART DOES NOT CLEAR THE WAIT',
    survived.blocked && survived.remainingMs > 0, JSON.stringify(survived));

  /* A right answer forgives everything. */
  await page.evaluate(() => window.__convoLockProbe
    .clearLockout(window.__convoLockProbe.targets.conversation('enforced-test')));
  const forgiven = await page.evaluate(() => window.__convoLockProbe
    .lockoutOf(window.__convoLockProbe.targets.conversation('enforced-test')));
  check('and unlocking clears the record completely',
    !forgiven.blocked && forgiven.wrong === 0, JSON.stringify(forgiven));

  /* ===== the wipe, and how far it reaches =============================== */

  console.log('\n===== what a wipe destroys, and what it leaves alone =====');

  const scoped = await page.evaluate(async () => {
    const probe = window.__convoLockProbe;
    /* Two conversations and a group, so "it wiped the right one" can be told
       apart from "it wiped everything". */
    probe.seedConversation('doomed-convo', 'peer-doomed', 'fp-doomed');
    probe.seedConversation('innocent-convo', 'peer-innocent', 'fp-innocent');
    probe.seedGroup('doomed-group');
    const before = {
      doomed: probe.traces('doomed-convo', 'peer-doomed', 'fp-doomed'),
      innocent: probe.traces('innocent-convo', 'peer-innocent', 'fp-innocent'),
      group: probe.traces('doomed-group', '', ''),
    };
    await probe.wipeTarget(probe.targets.conversation('doomed-convo'));
    const afterConvo = {
      doomed: probe.traces('doomed-convo', 'peer-doomed', 'fp-doomed'),
      innocent: probe.traces('innocent-convo', 'peer-innocent', 'fp-innocent'),
      group: probe.traces('doomed-group', '', ''),
    };
    await probe.wipeTarget(probe.targets.group('doomed-group'));
    const afterGroup = {
      innocent: probe.traces('innocent-convo', 'peer-innocent', 'fp-innocent'),
      group: probe.traces('doomed-group', '', ''),
    };
    return { before, afterConvo, afterGroup };
  });
  console.log(`  seeded:      ${JSON.stringify(scoped.before.doomed)}`);
  console.log(`  after wipe:  ${JSON.stringify(scoped.afterConvo.doomed)}`);
  console.log(`  bystander:   ${JSON.stringify(scoped.afterConvo.innocent)}`);

  check('the seeded conversation really was there first',
    scoped.before.doomed.history && scoped.before.doomed.peer && scoped.before.doomed.sessionKey,
    JSON.stringify(scoped.before.doomed));
  check('wiping a conversation takes its history',
    !scoped.afterConvo.doomed.history);
  check('takes it out of the contacts list',
    !scoped.afterConvo.doomed.peer);
  check('AND TAKES ITS SESSION KEY, so the ciphertext already sent stays shut',
    !scoped.afterConvo.doomed.sessionKey);
  check('while the conversation next to it is untouched',
    scoped.afterConvo.innocent.history && scoped.afterConvo.innocent.peer
    && scoped.afterConvo.innocent.sessionKey,
    JSON.stringify(scoped.afterConvo.innocent));
  check('and so is the group',
    scoped.afterConvo.group.group, JSON.stringify(scoped.afterConvo.group));

  check('wiping a group removes the group',
    !scoped.afterGroup.group.group && !scoped.afterGroup.group.history,
    JSON.stringify(scoped.afterGroup.group));
  check('and still leaves the unrelated conversation alone',
    scoped.afterGroup.innocent.history && scoped.afterGroup.innocent.peer,
    JSON.stringify(scoped.afterGroup.innocent));

  /* ===== every lock counts separately =================================== */

  console.log('\n===== one target\'s mistakes are not another\'s =====');

  const separate = await page.evaluate(() => {
    const probe = window.__convoLockProbe;
    const a = probe.targets.conversation('counts-a');
    const b = probe.targets.conversation('counts-b');
    const chat = probe.targets.secureChat;
    [a, b, chat].forEach((key) => probe.clearLockout(key));
    for (let i = 0; i < 3; i += 1) probe.wrong(a);
    return { a: probe.lockoutOf(a), b: probe.lockoutOf(b), chat: probe.lockoutOf(chat) };
  });
  check('wrong answers on one conversation do not count against another',
    separate.a.wrong === 3 && separate.b.wrong === 0 && separate.chat.wrong === 0,
    JSON.stringify({ a: separate.a.wrong, b: separate.b.wrong, chat: separate.chat.wrong }));

  /* ===== biometrics are an option, not a replacement ==================== */

  console.log('\n===== the fingerprint is an option =====');

  const bio = await page.evaluate(() => {
    const probe = window.__convoLockProbe;
    const target = probe.targets.conversation('bio-test');
    const before = probe.biometricOn(target);
    probe.setBiometric(target, true);
    const on = probe.biometricOn(target);
    probe.setBiometric(target, false);
    return { before, on, off: probe.biometricOn(target) };
  });
  check('it is off until somebody turns it on, and can be turned off again',
    !bio.before && bio.on && !bio.off, JSON.stringify(bio));
  /* ===== the fingerprint actually opening something ===================== */

  console.log('\n===== the biometric path =====');

  /* The button existed and did nothing, in both runtimes, for two separate
     reasons — and both were swallowed by a catch that returned false.
   *
     ON THE DESKTOP there is no WebAuthn at all: the shell answers through its
     own bridge to the operating system. Asking navigator.credentials there
     throws immediately.
   *
     IN A BROWSER the assertion was requested with no allowCredentials, which
     asks for a DISCOVERABLE credential. This app's passkey is not registered
     as one, so the browser had nothing to offer and threw NotAllowedError.
   *
     Both are checked here by standing in for the platform, because a real
     fingerprint cannot be given to a headless browser — what is asserted is
     that each runtime is asked the right question. */
  const paths = await page.evaluate(async () => {
    const probe = window.__convoLockProbe;
    const app = window.PoorijaApp;
    const seen = { desktopAsked: false, allowCredentials: null, realDesktop: null };

    /* The desktop shell. */
    const wasDesktop = app.isDesktopAppRuntime;
    const wasInvoke = app.invokeDesktopCommand;
    app.isDesktopAppRuntime = () => true;
    app.state.desktopAuth = { enabled: true, supported: true, checked: true };
    app.invokeDesktopCommand = async (command) => { seen.desktopAsked = command; return 'ok'; };
    seen.realDesktop = await probe.bioUnlock();
    app.isDesktopAppRuntime = wasDesktop;
    app.invokeDesktopCommand = wasInvoke;

    /* And the browser. */
    const wasGet = navigator.credentials.get;
    const wasRecord = app.getPasskeyRecord;
    /* A headless browser has no platform authenticator, so the availability
       check refuses before any assertion is attempted — which is correct of it
       and useless here. Standing in for the sensor is the only way to reach the
       code under test. */
    const wasPlatform = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
    app.getPasskeyRecord = () => ({ credentialId: 'AAAA', strategy: 'prf' });
    navigator.credentials.get = async (options) => {
      seen.allowCredentials = (options?.publicKey?.allowCredentials || []).length;
      return { id: 'AAAA' };
    };
    seen.availableInBrowser = await probe.bioAvailable();
    const web = await probe.bioUnlock();
    navigator.credentials.get = wasGet;
    app.getPasskeyRecord = wasRecord;
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = wasPlatform;
    return { ...seen, web };
  });
  console.log(`  ${JSON.stringify(paths)}`);
  check('on the desktop shell it asks the operating system, not WebAuthn',
    paths.desktopAsked === 'desktop_unlock_with_biometric' && paths.realDesktop === true,
    JSON.stringify(paths));
  check('and in a browser it names the registered credential rather than hoping',
    paths.allowCredentials === 1 && paths.web === true, JSON.stringify(paths));

  /* ===== the popups, and the panel beside them ========================== */

  console.log('\n===== the desktop treatment =====');

  const wide = await browser.newContext({ ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 } });
  const desktop = await wide.newPage();
  await desktop.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await settle(desktop, () => typeof window.PoorijaDialogs?.confirm === 'function');

  /* Every confirm, prompt and alert in the app is drawn into this one backdrop
     — the delete confirmations, the PIN prompts, the warning before a wipe —
     so it is the most-used popup there is, and it was the one the desktop blur
     had been written without. */
  const blurred = await desktop.evaluate(async () => {
    window.PoorijaDialogs.confirm('measuring the backdrop');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const back = document.querySelector('.poorija-dialog-backdrop');
    const style = back ? getComputedStyle(back) : null;
    const filter = style ? (style.backdropFilter || style.webkitBackdropFilter || 'none') : 'none';
    document.querySelector('.poorija-dialog-backdrop button')?.click();
    return { present: Boolean(back), filter };
  });
  console.log(`  ${JSON.stringify(blurred)}`);
  check('the shared dialog backdrop blurs the page behind it on desktop',
    blurred.present && /blur\(\d/.test(blurred.filter), JSON.stringify(blurred));

  /* The two dialogs that were reported as not blurring. Both DID carry a
     backdrop-filter; both sat under a scrim at 78% opacity, and a blur behind
     something that nearly opaque cannot be seen — the filter ran, the pixels
     were blurred, and the result was hidden by the very layer that asked for
     it. So what is asserted is both halves: the filter is there AND the scrim
     is thin enough to see through. */
  const modals = await desktop.evaluate(async () => {
    /* Opened for real. A rule that is never matched by anything on the page
       reads as "absent" and would have passed a laxer check by accident. */
    if (typeof window.showChatIdentityQr === 'function') {
      await window.showChatIdentityQr();
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const read = (selector, pseudo) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const style = getComputedStyle(el, pseudo || undefined);
      const filter = style.backdropFilter || style.webkitBackdropFilter || 'none';
      const alpha = (style.backgroundColor.match(/[\d.]+\)$/) || ['1)'])[0];
      return { filter, alpha: parseFloat(alpha) };
    };
    return {
      identity: read('.chat-modal'),
      settings: read('.chat-settings-card.is-open', '::before')
        || read('.chat-settings-card', '::before'),
    };
  });
  console.log(`  ${JSON.stringify(modals)}`);
  check('the identity card blurs the page AND lets the blur show through',
    modals.identity && /blur\(\d/.test(modals.identity.filter)
    && modals.identity.alpha <= 0.55,
    JSON.stringify(modals.identity));
  check('and so does the chat settings sheet',
    modals.settings && /blur\(\d/.test(modals.settings.filter)
    && modals.settings.alpha <= 0.55,
    JSON.stringify(modals.settings));

  /* The two ways through a lock sit beside each other, not stacked.
     Asserted by comparing their boxes rather than by reading the stylesheet: a
     flex rule that is written but overridden looks identical in the source. */
  const sideBySide = await desktop.evaluate(async () => {
    /* The gate lives inside .chat-shell, which is itself inside a tab that is
       display:none until Secure Chat is open — so un-hiding the gate alone
       leaves every box at zero and "same row" is trivially true of two points
       at the origin. The tab has to be on screen for the measurement to mean
       anything. */
    window.switchTab?.('chat');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const gate = document.getElementById('chatLockGate');
    if (gate) gate.classList.remove('hidden');
    const bio = document.getElementById('chatLockBioBtn');
    if (bio) bio.classList.remove('hidden');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const unlock = document.getElementById('chatLockUnlockBtn');
    if (!unlock || !bio) return null;
    const a = unlock.getBoundingClientRect();
    const b = bio.getBoundingClientRect();
    return {
      /* Same row: their vertical centres line up. Stacked buttons differ by a
         whole button height. */
      rowGap: Math.round(Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2)),
      apart: Math.round(Math.abs(a.left - b.left)),
      buttonWidth: Math.round(a.width),
      rowWidth: Math.round((unlock.parentElement || unlock).getBoundingClientRect().width),
      label: bio.textContent.trim(),
    };
  });
  console.log(`  ${JSON.stringify(sideBySide)}`);
  /* Sized to their words, not to the panel. `flex: 1 1 9rem` made each button
     grow to fill half of whatever it was in — on a wide thread pane that is a
     pair of buttons the width of the page carrying two short labels. */
  check('and neither button is stretched across the panel',
    sideBySide && sideBySide.buttonWidth > 40 && sideBySide.buttonWidth < 260,
    JSON.stringify(sideBySide));

  check('the PIN and the biometric button share a row',
    sideBySide && sideBySide.rowGap <= 4 && sideBySide.apart > 40,
    JSON.stringify(sideBySide));
  check('and the button says biometric, not fingerprint',
    sideBySide && /بایومتریک|Biometric/.test(sideBySide.label),
    sideBySide ? sideBySide.label : 'absent');

  await wide.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('failed:');
  failed.forEach((r) => console.log(`  - ${r.name}`));
  process.exit(1);
}
