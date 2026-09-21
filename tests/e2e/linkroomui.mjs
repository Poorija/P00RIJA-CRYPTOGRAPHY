/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The room as a person uses it: on a phone, through its own buttons.
 *
 *   PORT=8123 npm run dev ; node tests/e2e/linkroomui.mjs
 *
 * tests/e2e/localroom.mjs proves the mesh underneath — brokering, keys, files,
 * the sixteen — by calling it directly. Everything in it passed while the room
 * was, on a phone, four things stacked in a scrolling column with two separate
 * composers, and while a call was one-directional: the caller's audio arrived,
 * the other side never entered a call, never captured its own microphone and
 * never sent anything back, so both people reported that calls do not work.
 *
 * A test that calls startCall and then reads the caller's own state cannot see
 * that. This one pairs two devices the way a person does, presses the buttons
 * on the screen, and asks BOTH sides what happened.
 */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

async function open(tag) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['microphone', 'camera', 'geolocation'],
    geolocation: { latitude: 35.7219, longitude: 51.3347 },
    ...PHONE,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`   [${tag}] ${error.message.slice(0, 130)}`));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await settle(page, () => typeof window.PoorijaLocalLink?.startAsHost === 'function'
    && typeof window.PoorijaLocalMesh?.joinCall === 'function');
  return page;
}

/* Paired the way somebody with no camera does it: the code as text, pasted. */
async function pair(a, b) {
  await a.evaluate(() => window.PoorijaLocalLink.startAsHost());
  await a.waitForTimeout(2500);
  const offer = await a.evaluate(() => window.PoorijaLocalLink.state.mineText);
  await b.evaluate((text) => window.PoorijaLocalLink.useTypedCode(text), offer);
  await b.waitForTimeout(2500);
  const answer = await b.evaluate(() => window.PoorijaLocalLink.state.mineText);
  await a.evaluate((text) => window.PoorijaLocalLink.useTypedCode(text), answer);
  await a.waitForTimeout(6000);
}

const click = (page, id) => page.evaluate((target) => {
  const el = document.getElementById(target);
  if (!el) return false;
  el.click();
  return true;
}, id);

let pages = [];
try {
  const [A, B] = pages = await Promise.all([open('A'), open('B')]);
  await pair(A, B);

  const paired = await Promise.all(pages.map((p) => p.evaluate(() => {
    const state = window.PoorijaLocalMesh.snapshot();
    return { count: state.count, open: state.members.filter((m) => m.state === 'open').length };
  })));
  check('two phones pair and both see a room of two',
    paired.every((p) => p.count === 2 && p.open === 1), JSON.stringify(paired));

  /* ===== the room takes the screen ====================================== */

  console.log('\n===== the room, on a 390-point phone =====');

  const layout = await A.evaluate(() => {
    const room = document.getElementById('linkRoom');
    const style = getComputedStyle(room);
    const box = room.getBoundingClientRect();
    const messages = document.getElementById('linkRoomMessages');
    const composer = document.querySelector('.link-room-composer');
    const messageStyle = messages ? getComputedStyle(messages) : null;
    return {
      hidden: room.classList.contains('hidden'),
      position: style.position,
      coversScreen: Math.round(box.width) >= window.innerWidth
        && Math.round(box.height) >= window.innerHeight - 2,
      transcriptScrolls: messageStyle ? messageStyle.overflowY : '',
      /* The composer has to be the last thing on the screen and stay there,
         because a composer that scrolls away mid-sentence is the whole
         complaint about the old layout. */
      composerAtBottom: composer
        ? Math.round(composer.getBoundingClientRect().bottom) >= Math.round(box.bottom) - 2
        : false,
      composers: document.querySelectorAll('#linkRoom .link-composer').length,
    };
  });
  console.log(`  ${JSON.stringify(layout)}`);
  check('the room opens by itself once somebody joins', !layout.hidden, String(layout.hidden));
  check('and takes the whole screen', layout.position === 'fixed' && layout.coversScreen,
    `${layout.position}, covers=${layout.coversScreen}`);
  check('the transcript is the only part that scrolls',
    layout.transcriptScrolls === 'auto' || layout.transcriptScrolls === 'scroll',
    layout.transcriptScrolls);
  check('the composer stays at the bottom', layout.composerAtBottom, String(layout.composerAtBottom));
  check('and there is one composer, not two', layout.composers === 1, `${layout.composers}`);

  /* ===== one plus, nine things ========================================== */

  console.log('\n===== the composer’s actions =====');

  const sheet = await A.evaluate(() => {
    document.getElementById('linkRoomPlusBtn').click();
    const el = document.getElementById('linkRoomActions');
    return {
      open: !el.classList.contains('hidden'),
      rows: Array.from(el.querySelectorAll('.link-action-row')).map((b) => b.id),
    };
  });
  console.log(`  ${JSON.stringify(sheet.rows)}`);
  /* Eight, not nine. The contact card went: everybody a room could introduce
     you to is already in it. */
  const WANTED = ['linkRoomStickerBtn', 'linkRoomPollBtn', 'linkRoomLocationBtn',
    'linkRoomFileBtn', 'linkRoomGalleryBtn', 'linkRoomVoiceBtn',
    'linkRoomHiddenBtn', 'linkRoomTimerBtn'];
  check('one plus button opens one sheet', sheet.open, String(sheet.open));
  check('and it offers the eight that mean something in a room',
    WANTED.every((id) => sheet.rows.includes(id)),
    WANTED.filter((id) => !sheet.rows.includes(id)).join(', ') || 'all nine');

  /* ===== the ones that send something =================================== */

  await A.evaluate(() => document.getElementById('linkRoomLocationBtn').click());
  await A.waitForTimeout(3000);
  const located = await B.evaluate(() => {
    const found = window.PoorijaLocalMesh.room.messages
      .find((m) => m.kind === 'rich' && m.rich?.kind === 'location');
    return found ? { lat: found.rich.lat, lng: found.rich.lng } : null;
  });
  check('a location card arrives with the real coordinates',
    located && Math.abs(located.lat - 35.7219) < 0.01 && Math.abs(located.lng - 51.3347) < 0.01,
    JSON.stringify(located));
  const locationRendered = await B.evaluate(() =>
    document.querySelectorAll('#linkRoomMessages .link-location').length);
  check('and it is drawn as a card, not as JSON', locationRendered === 1, `${locationRendered}`);

  /* Hidden and self-destruct: the two things the composer attaches to text. */
  await A.evaluate(async () => {
    await window.PoorijaLocalMesh.sendText('covered until tapped', { hidden: true });
  });
  await A.waitForTimeout(1200);
  const hidden = await B.evaluate(async () => {
    const el = document.querySelector('#linkRoomMessages .link-hidden');
    if (!el) return null;
    const before = getComputedStyle(el).filter;
    el.click();
    /* The cover fades rather than snapping, so a computed style read in the
       same tick is the value the transition started FROM. Read straight after
       the click this reported the blur it had a moment ago and looked like a
       handler that had not run — the class was already on the element. */
    await new Promise((resolve) => setTimeout(resolve, 400));
    return {
      before,
      after: getComputedStyle(el).filter,
      classes: el.className,
      text: el.textContent,
    };
  });
  check('a hidden message arrives covered',
    hidden && hidden.before !== 'none' && hidden.text === 'covered until tapped',
    JSON.stringify(hidden && { before: hidden.before }));
  check('and uncovers when the reader taps it',
    hidden && hidden.after === 'none',
    hidden ? JSON.stringify({ after: hidden.after, classes: hidden.classes }) : 'no message');

  const burnt = await B.evaluate(async () => {
    const kit = window.PoorijaLocalMesh;
    await kit.sendText('this one goes', { burn: 1 });
    const present = kit.room.messages.some((m) => m.text === 'this one goes');
    await new Promise((resolve) => setTimeout(resolve, 2200));
    return { present, gone: !kit.room.messages.some((m) => m.text === 'this one goes') };
  });
  check('a self-destructing message is there and then is not',
    burnt.present && burnt.gone, JSON.stringify(burnt));

  /* ===== a call, from both seats ======================================== */

  console.log('\n===== a call, asked of both sides =====');

  const started = await A.evaluate(async () => {
    try {
      const call = await window.PoorijaLocalMesh.startCall({ video: false });
      return { ok: Boolean(call) };
    } catch (error) { return { ok: false, error: String(error).slice(0, 90) }; }
  });
  check('A starts a voice call', started.ok, JSON.stringify(started));

  await A.waitForTimeout(3000);
  const ringing = await B.evaluate(() => ({
    state: Boolean(window.PoorijaLocalMesh.room.ringing),
    banner: !document.getElementById('linkCallRing')?.classList.contains('hidden'),
    who: document.getElementById('linkCallRingWho')?.textContent || '',
  }));
  console.log(`  B: ${JSON.stringify(ringing)}`);
  /* The step that was missing entirely. Without it the call was one-way and
     the far side had nothing to answer, nothing to hang up, and no idea it was
     in a call at all. */
  check('B is TOLD there is a call, on screen', ringing.state && ringing.banner,
    JSON.stringify(ringing));
  check('and is told who started it', ringing.who.length > 0, ringing.who);

  check('B can press join', await click(B, 'linkCallJoinBtn'));
  await A.waitForTimeout(8000);

  /* The call screen, which is where a call is meant to be looked at. It used to
     be a strip inside the transcript, and the tile stayed black because a
     stream that arrived before its tile was built was dropped and never
     retried. */
  const screens = await Promise.all(pages.map((p) => p.evaluate(() => {
    const screen = document.getElementById('linkCallScreen');
    const tiles = Array.from(document.querySelectorAll('#linkCallStage [data-tile]'));
    return {
      open: !screen.classList.contains('hidden'),
      fullScreen: getComputedStyle(screen).position === 'fixed',
      tiles: tiles.length,
      /* A tile with a stream on it, which is the thing that was broken. */
      painted: tiles.filter((t) => t.querySelector('video').srcObject).length,
      count: document.getElementById('linkCallStage').dataset.count,
    };
  })));
  console.log(`  screens: ${JSON.stringify(screens)}`);
  check('the call opens on its own full-screen view',
    screens.every((s) => s.open && s.fullScreen), JSON.stringify(screens));
  check('with a tile for each person, yourself included',
    screens.every((s) => s.tiles === 2), JSON.stringify(screens.map((s) => s.tiles)));
  check('AND EVERY TILE HAS ITS STREAM ON IT',
    screens.every((s) => s.painted === 2), JSON.stringify(screens.map((s) => s.painted)));

  /* Stepping away from a call is not leaving it. */
  check('back to the chat leaves the call running',
    await click(A, 'linkCallBackBtn'));
  await A.waitForTimeout(600);
  const stepped = await A.evaluate(() => ({
    screenHidden: document.getElementById('linkCallScreen').classList.contains('hidden'),
    stillInCall: Boolean(window.PoorijaLocalMesh.room.call),
    resumeOffered: !document.getElementById('linkCallResumeBtn').classList.contains('hidden'),
  }));
  console.log(`  ${JSON.stringify(stepped)}`);
  check('and offers the way back into it',
    stepped.screenHidden && stepped.stillInCall && stepped.resumeOffered,
    JSON.stringify(stepped));
  check('which works', await click(A, 'linkCallResumeBtn'));
  await A.waitForTimeout(500);
  check('and puts the call back on screen',
    !(await A.evaluate(() => document.getElementById('linkCallScreen').classList.contains('hidden'))));

  const both = await Promise.all(pages.map((p) => p.evaluate(() => {
    const kit = window.PoorijaLocalMesh;
    return {
      inCall: Boolean(kit.room.call),
      hearing: Array.from(kit.room.members.values())
        .filter((m) => m.stream && m.stream.getAudioTracks().length > 0).length,
      bar: !document.getElementById('linkCallBar')?.classList.contains('hidden'),
      ringGone: document.getElementById('linkCallRing')?.classList.contains('hidden'),
    };
  })));
  console.log(`  A: ${JSON.stringify(both[0])}\n  B: ${JSON.stringify(both[1])}`);
  check('BOTH SIDES ARE IN THE CALL', both.every((s) => s.inCall), JSON.stringify(both.map((s) => s.inCall)));
  check('and each one can hear the other',
    both.every((s) => s.hearing >= 1), JSON.stringify(both.map((s) => s.hearing)));
  check('the ring is replaced by a call bar with a way out',
    both.every((s) => s.bar) && both[1].ringGone, JSON.stringify(both.map((s) => s.bar)));

  check('hanging up works from the bar', await click(A, 'linkCallEndBtn'));
  await A.waitForTimeout(2500);
  const after = await Promise.all(pages.map((p) => p.evaluate(() => ({
    call: Boolean(window.PoorijaLocalMesh.room.call),
    /* The call screen, not the strip that used to sit in the transcript. */
    screen: !document.getElementById('linkCallScreen').classList.contains('hidden'),
    resume: !document.getElementById('linkCallResumeBtn').classList.contains('hidden'),
  }))));
  check('and the caller is out of the call, with nothing left offering it back',
    !after[0].call && !after[0].screen && !after[0].resume, JSON.stringify(after[0]));

  /* ===== the shape of a crowded call ==================================== */

  console.log('\n===== how a call arranges itself =====');

  /* The grid follows the number of people, and beyond four the extras go to a
     strip along the bottom — a fifth tile in a four-up grid makes all five too
     small to recognise anybody in. Checked by filling the roster rather than
     opening seven browsers, because the rule is about the layout. */
  const shapes = await A.evaluate(async () => {
    const kit = window.PoorijaLocalMesh;
    const room = window.PoorijaLocalRoom;
    const saved = new Map(kit.room.members);
    const savedCall = kit.room.call;
    /* A call has to be running for the stage to draw anything — by this point
       in the suite the earlier one has been hung up. The layout is a property
       of the renderer given a call and a roster, so a stub call is exactly the
       right amount of call to have. */
    kit.room.call = { video: true, stream: new MediaStream(), startedAt: Date.now() };
    const seen = [];
    for (const total of [1, 2, 4, 7]) {
      kit.room.members.clear();
      for (let i = 0; i < total - 1; i += 1) {
        kit.room.members.set('seat-' + i, {
          id: 'seat-' + i, name: 'Person ' + i, state: 'open', incoming: new Map(),
        });
      }
      room.renderCall();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const stage = document.getElementById('linkCallStage');
      const strip = document.getElementById('linkCallStrip');
      seen.push({
        people: total,
        inGrid: stage.querySelectorAll('[data-tile]').length,
        gridCount: stage.dataset.count,
        columns: getComputedStyle(stage).gridTemplateColumns.split(' ').length,
        inStrip: strip.querySelectorAll('[data-tile]').length,
        stripShown: !strip.classList.contains('hidden'),
      });
    }
    kit.room.members.clear();
    saved.forEach((value, key) => kit.room.members.set(key, value));
    kit.room.call = savedCall;
    room.renderCall();
    return seen;
  });
  shapes.forEach((s) => console.log(`  ${JSON.stringify(s)}`));

  const byCount = (n) => shapes.find((s) => s.people === n);
  check('one person fills the screen',
    byCount(1).inGrid === 1 && byCount(1).columns === 1, JSON.stringify(byCount(1)));
  check('two split it', byCount(2).inGrid === 2, JSON.stringify(byCount(2)));
  check('four make a square',
    byCount(4).inGrid === 4 && byCount(4).columns === 2, JSON.stringify(byCount(4)));
  check('and beyond four the rest go to a strip, not into the grid',
    byCount(7).inGrid === 4 && byCount(7).inStrip === 3 && byCount(7).stripShown,
    JSON.stringify(byCount(7)));
  check('a call of four or fewer has no strip at all',
    !byCount(4).stripShown && byCount(4).inStrip === 0, JSON.stringify(byCount(4)));

  /* ===== declining ====================================================== */

  console.log('\n===== declining =====');

  await B.evaluate(async () => { await window.PoorijaLocalMesh.startCall({ video: false }); });
  await A.waitForTimeout(3000);
  check('the other direction rings too',
    await A.evaluate(() => Boolean(window.PoorijaLocalMesh.room.ringing)));
  check('decline is a button', await click(A, 'linkCallDeclineBtn'));
  await A.waitForTimeout(800);
  const declined = await A.evaluate(() => ({
    ringing: Boolean(window.PoorijaLocalMesh.room.ringing),
    banner: !document.getElementById('linkCallRing')?.classList.contains('hidden'),
    call: Boolean(window.PoorijaLocalMesh.room.call),
  }));
  check('declining puts the ring away without joining',
    !declined.ringing && !declined.banner && !declined.call, JSON.stringify(declined));
  await B.evaluate(() => window.PoorijaLocalMesh.endCall());
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
