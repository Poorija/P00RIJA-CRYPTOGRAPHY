/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The room, fitted to a phone: identity, people, files and the way back.
 *
 *   PORT=8123 npm run dev ; node tests/e2e/linkroomfit.mjs
 *
 * Every check here exists because somebody used the room on a phone and hit
 * the thing it checks. A notice that appeared behind the dialog that caused
 * it. A file picker that took the first of four files and dropped the rest
 * without a word. A back button hanging half off the screen, and no way back
 * in once it was pressed. A pairing card that kept a second, dead composer on
 * screen after the room had taken the channel over. And no way to see who was
 * in the room, remove anybody, or close it.
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
    permissions: ['microphone', 'camera'],
    ...PHONE,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`   [${tag}] ${error.message.slice(0, 130)}`));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await settle(page, () => typeof window.PoorijaLocalLink?.startAsHost === 'function'
    && typeof window.PoorijaLocalMesh?.writeIdentity === 'function');
  return page;
}

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

  /* ===== a notice nobody can see is not a notice ========================= */

  console.log('\n===== notifications, against the highest layer in the app =====');

  const stacking = await A.evaluate(() => {
    /* Something at the top of the app's own range, which is what a confirm
       dialog uses — the exact case where a notice matters most and where it
       used to disappear. */
    const cover = document.createElement('div');
    cover.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000';
    document.body.appendChild(cover);
    window.PoorijaApp.showNotification('a message that has to be seen', 'error');
    const stack = document.getElementById('toastStack');
    const style = stack ? getComputedStyle(stack) : null;
    const box = stack?.getBoundingClientRect();
    const onTop = box
      ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      : null;
    const result = {
      z: style ? Number(style.zIndex) : 0,
      coverZ: 2147483000,
      lastChild: stack === document.body.lastElementChild,
      /* Asked of the page rather than reasoned about: what is actually at the
         point where the notice is drawn? */
      reachesTheEye: Boolean(onTop && stack.contains(onTop)),
      text: stack?.textContent || '',
    };
    cover.remove();
    stack?.remove();
    return result;
  });
  console.log(`  ${JSON.stringify({ z: stacking.z, lastChild: stacking.lastChild })}`);
  check('a notice sits above the highest layer the app defines',
    stacking.z > stacking.coverZ, `${stacking.z} vs ${stacking.coverZ}`);
  check('and is the last thing in the document, so ties go its way',
    stacking.lastChild, String(stacking.lastChild));
  check('the page agrees it is what you would touch',
    stacking.reachesTheEye, String(stacking.reachesTheEye));
  check('and it carries the whole message',
    stacking.text.includes('a message that has to be seen'), stacking.text.slice(0, 40));

  /* ===== the pickers ===================================================== */

  console.log('\n===== choosing more than one file =====');

  const pickers = await A.evaluate(() => ['chatFileInput', 'chatGalleryInput',
    'linkRoomFileInput', 'linkRoomGalleryInput']
    .map((id) => ({ id, multiple: document.getElementById(id)?.multiple })));
  console.log(`  ${JSON.stringify(pickers)}`);
  check('every file picker accepts a selection, not one file',
    pickers.every((p) => p.multiple === true),
    pickers.filter((p) => !p.multiple).map((p) => p.id).join(', ') || 'all four');

  /* ===== the second person's half of the pairing ========================= */

  console.log('\n===== scanning, which is what the OTHER device does =====');

  /* One device shows a code and the other scans it. Everything about the first
     half was checked and the second half was not, so a change to how the
     pairing card steps through itself took the camera out entirely: the stage
     is tagged with the step it belongs to, nothing told renderStep() a scanner
     had started, and on a phone a block whose step is not current is
     display:none. The person pressed "scan their code" and got the screen they
     had started on — and the <video> underneath had no size for frames to be
     read out of, so the camera was running and the decoder saw nothing. */
  const scanning = await B.evaluate(async () => {
    window.PoorijaApp?.switchTab?.('locallink');
    await new Promise((resolve) => setTimeout(resolve, 500));
    document.getElementById('linkScanBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const stage = document.getElementById('linkScanStage');
    const video = document.getElementById('linkVideo');
    const box = video.getBoundingClientRect();
    return {
      step: document.getElementById('content-locallink').dataset.linkStep,
      stageShown: !stage.classList.contains('hidden')
        && getComputedStyle(stage).display !== 'none',
      videoOnScreen: box.width > 40 && box.height > 40,
      /* Frames, not just a running scanner: a video with no layout produces
         none, and a decoder with no frames never reports anything. */
      cameraDelivering: video.videoWidth > 0,
      running: Boolean(window.PoorijaLocalLink.state.scanner),
    };
  });
  console.log(`  ${JSON.stringify(scanning)}`);
  check('pressing scan moves the phone to the camera step',
    scanning.step === 'scan', String(scanning.step));
  check('and the camera is actually on screen',
    scanning.stageShown && scanning.videoOnScreen, JSON.stringify(scanning));
  check('and delivering frames a code could be read out of',
    scanning.cameraDelivering && scanning.running, JSON.stringify(scanning));

  await B.evaluate(() => document.getElementById('linkScanStopBtn').click());
  await B.waitForTimeout(600);
  check('stopping the camera returns to the choices',
    await B.evaluate(() => document.getElementById('content-locallink').dataset.linkStep === 'choose'
      && !window.PoorijaLocalLink.state.scanner));

  /* ===== the room ======================================================== */

  await pair(A, B);
  const paired = await A.evaluate(() => window.PoorijaLocalMesh.snapshot().count);
  check('two phones make a room', paired === 2, String(paired));

  console.log('\n===== the header, on a 390-point screen =====');

  const header = await A.evaluate(() => {
    const head = document.querySelector('#linkRoom .link-room-head');
    const back = document.getElementById('linkRoomBackBtn');
    const headBox = head.getBoundingClientRect();
    const backBox = back.getBoundingClientRect();
    return {
      /* It used to wrap out of the row and hang off the side of the screen. */
      inside: backBox.left >= headBox.left - 1 && backBox.right <= headBox.right + 1
        && backBox.right <= window.innerWidth + 1 && backBox.left >= -1,
      wraps: getComputedStyle(head).flexWrap,
      rows: Math.round(headBox.height),
    };
  });
  console.log(`  ${JSON.stringify(header)}`);
  check('the back button is inside the header, not over its edge',
    header.inside, JSON.stringify(header));

  /* And its icon inside the button. The button set a width and a height and
     never said what to do with its contents, so the glyph sat wherever inline
     layout put it — visibly outside its own circle on the header's last
     button, which is what "the back button is outside the frame" was. */
  const centred = await A.evaluate(() => {
    const button = document.getElementById('linkRoomBackBtn');
    const icon = button.querySelector('i');
    const b = button.getBoundingClientRect();
    const i = icon.getBoundingClientRect();
    return {
      display: getComputedStyle(button).display,
      iconInside: i.left >= b.left - 0.5 && i.right <= b.right + 0.5
        && i.top >= b.top - 0.5 && i.bottom <= b.bottom + 0.5,
      offCentre: Math.round(Math.abs((i.left + i.right) / 2 - (b.left + b.right) / 2)),
    };
  });
  console.log(`  ${JSON.stringify(centred)}`);
  check('and its icon is centred inside it, not hanging off the side',
    centred.iconInside && centred.offCentre <= 1, JSON.stringify(centred));

  /* The header does not move when a keyboard comes up — and what a keyboard
     actually does is the point.
   *
     It does not shrink the window; it covers part of it. A layer sized to the
     window therefore keeps its bottom behind the keys, and iOS scrolls the
     whole document up to bring the caret into view — taking the header with it.
     `position: sticky` cannot help, because nothing here was scrolling. The
     first attempt asserted "the transcript scrolls under a fixed header",
     passed, and fixed nothing on a real phone.
   *
     So this reproduces the mechanism: shrink the visible viewport the way a
     keyboard does, and check the layer ends where the keyboard begins. */
  const pinned = await A.evaluate(async () => {
    const room = document.getElementById('linkRoom');
    const head = document.querySelector('#linkRoom .link-room-head');
    const before = head.getBoundingClientRect().top;
    const full = window.innerHeight;
    const keyboard = 320;

    /* The keyboard is simulated where a keyboard actually shows up: in what
       visualViewport reports. Setting the CSS variable directly does not hold —
       the app re-measures on focus and on resize and writes its own answer over
       the top, which is right of it, and meant the first two attempts at this
       check were measuring a value that had already been replaced. */
    const vv = window.visualViewport;
    const realHeight = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(vv), 'height');
    Object.defineProperty(vv, 'height', { configurable: true, get: () => full - keyboard });
    document.getElementById('linkRoomComposer').focus();
    window.updateViewportHeight?.();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const box = room.getBoundingClientRect();
    const result = {
      headMoved: Math.round(Math.abs(head.getBoundingClientRect().top - before)),
      headOnScreen: head.getBoundingClientRect().top >= -1,
      /* The layer stops above the keyboard rather than running under it, which
         is what leaves iOS nothing to scroll. */
      endsAboveTheKeyboard: Math.round(box.bottom) <= full - keyboard + 2,
      roomHeight: Math.round(box.height),
      visible: full - keyboard,
    };
    if (realHeight) Object.defineProperty(vv, 'height', realHeight);
    window.updateViewportHeight?.();
    return result;
  });
  console.log(`  ${JSON.stringify(pinned)}`);
  check('the header stays exactly where it was when a keyboard opens',
    pinned.headMoved === 0 && pinned.headOnScreen, JSON.stringify(pinned));
  check('and the room ends where the keyboard begins, so nothing scrolls',
    pinned.endsAboveTheKeyboard, JSON.stringify(pinned));

  /* A contact card is a Secure Chat idea. In a room on somebody's Wi-Fi there
     is nobody to introduce: everyone in it is already here. */
  const actions = await A.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('#linkRoomActions .link-action-row')).map((b) => b.id),
    picker: Boolean(document.getElementById('linkContactPicker')),
  }));
  check('the room does not offer a contact card',
    !actions.rows.includes('linkRoomContactBtn') && !actions.picker, JSON.stringify(actions));
  check('and the header cannot wrap onto a second line',
    header.wraps === 'nowrap', header.wraps);

  const order = await A.evaluate(() => {
    const send = document.getElementById('linkRoomSendBtn').getBoundingClientRect();
    const plus = document.getElementById('linkRoomPlusBtn').getBoundingClientRect();
    return { send: Math.round(send.left), plus: Math.round(plus.left), rtl: document.dir || document.documentElement.dir };
  });
  console.log(`  ${JSON.stringify(order)}`);
  /* Right-to-left: send under the right thumb, the occasional button opposite. */
  check('send is on the right and the plus on the left',
    order.send > order.plus, JSON.stringify(order));

  /* Connected means connected. The step line is a one-shot note and nothing
     ever cleared it, so a finished link sat under the word "connecting" while
     the status above it said connected. */
  const settled = await A.evaluate(() => ({
    status: document.getElementById('linkStatus').textContent.trim(),
    className: document.getElementById('linkStatus').className,
    step: document.getElementById('linkStep').textContent.trim(),
  }));
  console.log(`  ${JSON.stringify(settled)}`);
  check('a connected link says connected, and stops saying "connecting"',
    settled.className.includes('is-open') && settled.step === '', JSON.stringify(settled));

  /* ===== back, and back again ============================================ */

  console.log('\n===== putting the room away, and getting it back =====');

  check('back puts the room away', await click(A, 'linkRoomBackBtn'));
  await A.waitForTimeout(600);
  const away = await A.evaluate(() => ({
    roomHidden: document.getElementById('linkRoom').classList.contains('hidden'),
    stillInIt: window.PoorijaLocalMesh.snapshot().count === 2,
    /* The way back. Without it, pressing back stranded people in a room they
       were still in with nothing on screen to return to. */
    returnOffered: !document.getElementById('linkReturnBtn')?.classList.contains('hidden'),
    /* And the pairing card's own composer, which sends into a channel the room
       has taken over — a second message box that looks live and is not. */
    deadComposerHidden: document.getElementById('linkComposerRow')?.classList.contains('hidden'),
  }));
  console.log(`  ${JSON.stringify(away)}`);
  check('the room is put away but not left', away.roomHidden && away.stillInIt, JSON.stringify(away));
  check('THERE IS A WAY BACK INTO IT', away.returnOffered, String(away.returnOffered));
  check('and the pairing card’s dead composer is gone',
    away.deadComposerHidden, String(away.deadComposerHidden));

  check('the way back works', await click(A, 'linkReturnBtn'));
  await A.waitForTimeout(600);
  check('and the room is on screen again',
    !(await A.evaluate(() => document.getElementById('linkRoom').classList.contains('hidden'))));

  /* ===== a name and a face =============================================== */

  console.log('\n===== who you are, and where you are =====');

  const named = await A.evaluate(async () => {
    const kit = window.PoorijaLocalMesh;
    kit.writeIdentity({ name: 'Roya', face: '🦊', roomName: 'کارگاه', roomFace: '☕' });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const state = kit.snapshot();
    return {
      me: state.me.name,
      myFace: state.me.face,
      room: state.name,
      roomFace: state.face,
      headerName: document.getElementById('linkRoomName')?.textContent,
      headerFace: document.getElementById('linkRoomAvatarFace')?.textContent,
    };
  });
  console.log(`  ${JSON.stringify(named)}`);
  check('a person can name themselves in the room',
    named.me === 'Roya' && named.myFace === '🦊', JSON.stringify(named));
  check('and the host can name the room and give it a face',
    named.room === 'کارگاه' && named.roomFace === '☕', JSON.stringify(named));
  check('the header shows both', named.headerName === 'کارگاه' && named.headerFace === '☕',
    `${named.headerName} ${named.headerFace}`);

  const told = await B.evaluate(() => {
    const state = window.PoorijaLocalMesh.snapshot();
    return { room: state.name, face: state.face, host: state.members[0]?.name };
  });
  console.log(`  the other side: ${JSON.stringify(told)}`);
  check('and everybody else is told what the room is called',
    told.room === 'کارگاه' && told.face === '☕', JSON.stringify(told));
  /* A name that only exists on the device that chose it is not a name anybody
     uses. The roster on the other side has to change too. */
  check('and sees the new name of the person who chose one',
    told.host === 'Roya', String(told.host));

  /* ===== who is here, and closing the room =============================== */

  console.log('\n===== the people in the room =====');

  check('the roster opens a list', await click(A, 'linkRoomMembers'));
  await A.waitForTimeout(500);
  const people = await A.evaluate(() => ({
    open: !document.getElementById('linkPeoplePanel').classList.contains('hidden'),
    rows: document.querySelectorAll('#linkPeopleList .link-people-row').length,
    canRemove: document.querySelectorAll('[data-remove-member]').length,
    canDissolve: !document.getElementById('linkDissolveBtn').classList.contains('hidden'),
  }));
  console.log(`  ${JSON.stringify(people)}`);
  check('it lists everybody, including you', people.open && people.rows === 2, JSON.stringify(people));
  check('the host can remove somebody', people.canRemove === 1, `${people.canRemove}`);
  check('and can close the room entirely', people.canDissolve, String(people.canDissolve));

  const guestControls = await B.evaluate(() => {
    document.getElementById('linkRoomMembers').click();
    return {
      canRemove: document.querySelectorAll('[data-remove-member]').length,
      canDissolve: !document.getElementById('linkDissolveBtn').classList.contains('hidden'),
    };
  });
  check('but a guest can do neither — it is the host’s room',
    guestControls.canRemove === 0 && !guestControls.canDissolve, JSON.stringify(guestControls));

  /* Dissolving is the last thing, because it ends the room. */
  await A.evaluate(() => window.PoorijaLocalMesh.dissolveRoom());
  await A.waitForTimeout(2500);
  const after = await Promise.all(pages.map((p) => p.evaluate(() => ({
    active: window.PoorijaLocalMesh.room.active,
    members: window.PoorijaLocalMesh.room.members.size,
  }))));
  console.log(`  ${JSON.stringify(after)}`);
  check('dissolving closes it for EVERYBODY, not just the host',
    after.every((s) => !s.active && s.members === 0), JSON.stringify(after));
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
