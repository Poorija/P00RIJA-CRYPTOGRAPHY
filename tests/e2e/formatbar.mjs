/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The formatting bar, on a phone first and then on a desktop.
 *
 *   - it appears while text is selected, once the selection stops moving,
 *     floating above the input without moving it, and high enough that the
 *     phone's own edit menu fits between them when it opens above the
 *     selection (it opens below just as often, which is why the bar is not
 *     under the input);
 *   - a tap formats the selection without taking the keyboard away, a second
 *     tap takes the format off, formats stack in an order that renders, and
 *     the phone's own undo still works;
 *   - lines are formatted one by one and code over lines becomes a block;
 *   - what is sent arrives formatted, and the bar goes away with the text;
 *   - on a desktop the same buttons name their shortcuts, and the shortcuts
 *     toggle exactly as the buttons do.
 */
import { openApp, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PHONE = {
  viewport: { width: 360, height: 780 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

const barShown = (page) => page.evaluate(() => !document.getElementById('chatFormatBar')?.classList.contains('hidden'));
const composer = (page) => page.evaluate(() => {
  const box = document.getElementById('chatComposer');
  return { value: box.value, selected: box.value.slice(box.selectionStart, box.selectionEnd), focused: document.activeElement === box };
});
const pressed = (page) => page.evaluate(() => [...document.querySelectorAll('#chatFormatBar [aria-pressed="true"]')].map((b) => b.dataset.format).sort().join(' '));
const write = (page, text) => page.evaluate((value) => {
  const box = document.getElementById('chatComposer');
  box.focus();
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
}, text);
const select = (page, word) => page.evaluate((w) => {
  const box = document.getElementById('chatComposer');
  const at = box.value.indexOf(w);
  box.focus();
  box.setSelectionRange(at, at + w.length);
}, word);
const tap = (page, marker) => page.locator(`#chatFormatBar [data-format="${marker}"]`).tap();

const stacks = await startTwoStacks();
try {
  section('on a phone');
  const P = await openApp('PHONE', { origin: stacks.a.url, relay: stacks.a.url, context: PHONE });
  await P.evaluate(() => openSavedMessages());
  await sleep(600);
  await write(P, 'Hello there friend');
  check('no bar while nothing is selected', (await barShown(P)) === false);
  const inputBefore = await P.evaluate(() => JSON.stringify(document.querySelector('.chat-composer-surface').getBoundingClientRect()));

  /* A finger still down on the input is a selection still being made. */
  await P.evaluate(() => {
    const box = document.getElementById('chatComposer');
    box.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    box.setSelectionRange(6, 11);
  });
  await sleep(700);
  check('no bar while the finger is still selecting', (await barShown(P)) === false);
  await P.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })));
  check('the bar appears once the selection is made', await waitFor(P, () => !document.getElementById('chatFormatBar').classList.contains('hidden'), { timeoutMs: 3000 }));

  const geometry = () => P.evaluate(() => {
    const bar = document.getElementById('chatFormatBar').getBoundingClientRect();
    const input = document.querySelector('.chat-composer-surface').getBoundingClientRect();
    const pane = document.getElementById('chatMessages').getBoundingClientRect();
    const line = selectionLineTop(document.getElementById('chatComposer'));
    return {
      barTop: Math.round(bar.top), barBottom: Math.round(bar.bottom), inputTop: Math.round(input.top), line: Math.round(line), paneTop: Math.round(pane.top),
      inside: bar.left >= 0 && bar.right <= window.innerWidth, scroll: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  let place = await geometry();
  check('showing it does not move the input', inputBefore === await P.evaluate(() => JSON.stringify(document.querySelector('.chat-composer-surface').getBoundingClientRect())));
  check('it floats above the input, so a system menu opening below the selection cannot reach it', place.barBottom <= place.inputTop, JSON.stringify(place));
  check('with room above the selected line for a system menu opening there (60px on an iPhone)', place.line - place.barBottom >= 70, JSON.stringify(place));
  check('and stays inside the messages area', place.barTop >= place.paneTop, JSON.stringify(place));
  check('and fits a narrow phone without scrolling sideways', place.inside && place.scroll, JSON.stringify(place));
  const oneLineGap = place.inputTop - place.barBottom;
  const sizes = await P.evaluate(() => [...document.querySelectorAll('#chatFormatBar [data-format]')].map((b) => Math.round(Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
  check('every button is big enough for a thumb', sizes.every((s) => s >= 36), sizes.join(','));
  const touchTitle = await P.evaluate(() => document.querySelector('#chatFormatBar [data-format="*"]').title);
  check('on a touch screen no keyboard shortcut is advertised', !/Ctrl|⌘/.test(touchTitle), touchTitle);

  await tap(P, '*');
  let state = await composer(P);
  check('a tap makes the word bold', state.value === 'Hello *there* friend', state.value);
  check('the keyboard stays: the input keeps focus', state.focused);
  check('the bare word stays selected, ready for another format', state.selected === 'there', state.selected);
  check('Bold shows as on', (await pressed(P)) === '*', await pressed(P));

  await tap(P, '_');
  state = await composer(P);
  check('italic stacks inside the bold, in the order that renders', state.value === 'Hello *_there_* friend', state.value);
  check('both show as on', (await pressed(P)) === '* _', await pressed(P));

  await tap(P, '*');
  state = await composer(P);
  check('a second tap on Bold takes only the bold off', state.value === 'Hello _there_ friend', state.value);

  await tap(P, 'clear');
  state = await composer(P);
  check('Clear takes every format off', state.value === 'Hello there friend', state.value);
  check('and has nothing left to clear', await P.evaluate(() => document.querySelector('#chatFormatBar [data-format="clear"]').disabled));

  await tap(P, '||');
  const undone = await P.evaluate(() => {
    const before = document.getElementById('chatComposer').value;
    document.execCommand('undo');
    return { before, after: document.getElementById('chatComposer').value };
  });
  check('the phone\'s own undo puts a format back', undone.before === 'Hello ||there|| friend' && undone.after === 'Hello there friend', JSON.stringify(undone));

  await select(P, 'her');
  await waitFor(P, () => !document.getElementById('chatFormatBar').classList.contains('hidden'), { timeoutMs: 3000 });
  await tap(P, '*');
  state = await composer(P);
  check('part of a word is made bold as the whole word, the only way it renders', state.value === 'Hello *there* friend', state.value);

  await write(P, 'first line\nsecond line\nthird line');
  await P.evaluate(() => document.getElementById('chatComposer').setSelectionRange(23, 28));
  await waitFor(P, () => !document.getElementById('chatFormatBar').classList.contains('hidden'), { timeoutMs: 3000 });
  place = await geometry();
  check('when the selected line is low in a tall input, the menu opens inside the input and the bar comes down to it', place.inputTop - place.barBottom < oneLineGap / 2 && place.line - place.barBottom >= 70, JSON.stringify(place));
  await write(P, 'first line\nsecond line');
  await P.evaluate(() => document.getElementById('chatComposer').setSelectionRange(0, 22));
  await waitFor(P, () => !document.getElementById('chatFormatBar').classList.contains('hidden'), { timeoutMs: 3000 });
  await tap(P, '~');
  state = await composer(P);
  check('across lines each line is formatted on its own', state.value === '~first line~\n~second line~', JSON.stringify(state.value));
  await tap(P, '~');
  await P.evaluate(() => document.getElementById('chatComposer').setSelectionRange(0, 22));
  await tap(P, '`');
  state = await composer(P);
  check('and code across lines becomes one block', state.value === '```\nfirst line\nsecond line\n```', JSON.stringify(state.value));

  await write(P, 'meet at noon');
  await select(P, 'noon');
  await waitFor(P, () => !document.getElementById('chatFormatBar').classList.contains('hidden'), { timeoutMs: 3000 });
  await P.evaluate(() => document.getElementById('chatComposer').setSelectionRange(3, 3));
  await sleep(150);
  check('putting the caret down hides the bar at once', (await barShown(P)) === false);

  await select(P, 'noon');
  await waitFor(P, () => !document.getElementById('chatFormatBar').classList.contains('hidden'), { timeoutMs: 3000 });
  await tap(P, '*');
  await P.locator('#chatSendMessageBtn').tap();
  const sent = await waitFor(P, () => /meet at <strong>noon<\/strong>/.test(document.getElementById('chatMessages').innerHTML), { timeoutMs: 8000 });
  check('what is sent arrives formatted', sent);
  check('and the bar goes away with the text', await waitFor(P, () => document.getElementById('chatFormatBar').classList.contains('hidden') && !document.getElementById('chatComposer').value, { timeoutMs: 3000 }));

  await write(P, 'leaving now');
  await select(P, 'now');
  await waitFor(P, () => !document.getElementById('chatFormatBar').classList.contains('hidden'), { timeoutMs: 3000 });
  await P.evaluate(() => document.getElementById('chatComposer').blur());
  check('leaving the input hides the bar', await waitFor(P, () => document.getElementById('chatFormatBar').classList.contains('hidden'), { timeoutMs: 2000 }));

  await P.evaluate(() => { if (document.documentElement.lang !== 'fa') switchLanguage(); });
  await sleep(500);
  await write(P, 'سلام دوست من');
  await select(P, 'دوست');
  await waitFor(P, () => !document.getElementById('chatFormatBar').classList.contains('hidden'), { timeoutMs: 3000 });
  const fa = await P.evaluate(() => ({ bar: document.getElementById('chatFormatBar').getAttribute('aria-label'), bold: document.querySelector('#chatFormatBar [data-format="*"]').getAttribute('aria-label') }));
  check('in Persian the bar speaks Persian', fa.bar === 'قالب‌بندی متن' && fa.bold === 'پررنگ', JSON.stringify(fa));
  await tap(P, '*');
  state = await composer(P);
  check('and a Persian word is formatted like any other', state.value === 'سلام *دوست* من', state.value);
  check('no page errors on the phone', !(P.__errors || []).length, (P.__errors || []).join(' | '));

  section('on a desktop');
  const D = await openApp('DESK', { origin: stacks.a.url, relay: stacks.a.url });
  await D.evaluate(() => openSavedMessages());
  await sleep(600);
  await write(D, 'ship it today');
  await select(D, 'it');
  check('the bar comes up for a mouse selection too', await waitFor(D, () => !document.getElementById('chatFormatBar').classList.contains('hidden'), { timeoutMs: 3000 }));
  const deskPlace = await D.evaluate(() => {
    const bar = document.getElementById('chatFormatBar').getBoundingClientRect();
    const input = document.querySelector('.chat-composer-surface').getBoundingClientRect();
    return Math.round(input.top - bar.bottom);
  });
  check('with a mouse there is no system menu to clear, and the bar sits just above the input', deskPlace >= 4 && deskPlace <= 12, String(deskPlace));
  const deskTitle = await D.evaluate(() => document.querySelector('#chatFormatBar [data-format="*"]').title);
  check('and each button names its shortcut', /Bold \((Ctrl\+B|⌘B)\)/.test(deskTitle), deskTitle);
  await D.keyboard.press('Control+b');
  state = await composer(D);
  check('Ctrl+B makes the selection bold', state.value === 'ship *it* today', state.value);
  await D.keyboard.press('Control+b');
  state = await composer(D);
  check('and a second Ctrl+B takes it off, just like the button', state.value === 'ship it today', state.value);
  await D.locator('#chatFormatBar [data-format="||"]').click();
  state = await composer(D);
  check('a click on a button works the same as a tap', state.value === 'ship ||it|| today' && state.focused, JSON.stringify(state));
  await D.evaluate(() => { const box = document.getElementById('chatComposer'); box.setSelectionRange(box.value.length, box.value.length); });
  await D.keyboard.press('Control+i');
  const caret = await D.evaluate(() => { const box = document.getElementById('chatComposer'); return { value: box.value, at: box.selectionStart, end: box.selectionEnd }; });
  check('with only a caret, a shortcut puts down an empty pair to type into', caret.value === 'ship ||it|| today__' && caret.at === 18 && caret.end === 18, JSON.stringify(caret));
  check('no page errors on the desktop', !(D.__errors || []).length, (D.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
