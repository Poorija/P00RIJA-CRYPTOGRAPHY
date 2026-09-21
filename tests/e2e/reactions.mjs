/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Reacting to a message, on a desktop-sized screen.
 *
 *   PORT=8123 npm run dev ; node tests/e2e/reactions.mjs
 *
 * Two things were reported and they turned out to be one bug.
 *
 * The toolbar appeared on a click and then vanished "after a few seconds", and
 * pressing the emoji button did nothing at all. Both because `selected` was a
 * class on the bubble and nothing else — while renderMessages() rebuilds the
 * whole panel, and is called by the lock ticker, by every arriving receipt, and
 * by the reaction button itself. So the button opened the picker and destroyed
 * the toolbar it hangs off in the same frame.
 *
 * The fix is to keep the open message in state, like the picker already was.
 * What is asserted here is the property that follows: a redraw does not close
 * something somebody is in the middle of using.
 */
import { openApp, browser } from './_chat-harness.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

try {
  const page = await openApp('reactions');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);

  const seen = await page.evaluate(async () => {
    window.switchTab?.('chat');
    await new Promise((r) => setTimeout(r, 600));
    const probe = window.__convoLockProbe;
    const id = 'react-me';
    probe.seedConversation(id, 'peer-react', 'fp-react');
    probe.setActive(id);
    window.renderPeers?.(); window.renderActivePeer?.(); window.renderMessages?.();
    await new Promise((r) => setTimeout(r, 500));

    const out = { bubbles: document.querySelectorAll('#chatMessages .chat-message-bubble').length };
    const bubble = document.querySelector('#chatMessages .chat-message-bubble');
    if (!bubble) return out;

    /* Open the toolbar. */
    bubble.click();
    await new Promise((r) => setTimeout(r, 250));
    out.toolbarOpens = Boolean(document.querySelector('#chatMessages .chat-message-bubble.selected .chat-message-toolbar'));

    /* The thing that used to close it: any redraw at all. */
    window.renderMessages?.();
    await new Promise((r) => setTimeout(r, 250));
    out.survivesRedraw = Boolean(document.querySelector('#chatMessages .chat-message-bubble.selected .chat-message-toolbar'));

    /* Opening the picker triggers its own redraw, which is what made the
       emoji button look dead. */
    document.querySelector('[data-chat-toggle-reaction]')?.click();
    await new Promise((r) => setTimeout(r, 350));
    const picker = document.querySelector('.chat-reaction-picker:not(.hidden)');
    out.pickerOpens = Boolean(picker);
    out.pickerChoices = picker ? picker.querySelectorAll('[data-chat-reaction-choice]').length : 0;
    if (picker) {
      const box = picker.getBoundingClientRect();
      out.pickerOnScreen = box.width > 40 && box.height > 40
        && box.top >= 0 && box.bottom <= window.innerHeight + 1;
    }
    out.toolbarSurvivesPicker = Boolean(document.querySelector('#chatMessages .chat-message-bubble.selected .chat-message-toolbar'));

    /* Where the picker actually landed, relative to the message it belongs to.
       It is position:fixed and its placement came from CSS written for an
       absolutely positioned box — `bottom: calc(100% + 0.35rem)` — which on a
       fixed element resolves against the VIEWPORT. So it appeared at a corner
       of the window with no relation to the message, and for the last message
       in a thread it fell off the bottom of the screen entirely. */
    if (picker) {
      /* The picker is a single popup on the body now, so it has no bubble to
         be inside. The message it belongs to is named on its buttons — which
         is also the only honest way to ask "is this picker the right one". */
      const owner = picker.querySelector('[data-chat-reaction-choice]')
        ?.getAttribute('data-chat-reaction-choice') || '';
      const live = document.querySelector(
        `#chatMessages .chat-message-bubble[data-id="${CSS.escape(owner)}"]`) || bubble;
      const bb = live.getBoundingClientRect();
      const pb = picker.getBoundingClientRect();
      out.near = {
        /* Vertical distance from the message, and how tall the picker is: a
           240px picker on a 900px window genuinely cannot sit 8px from a
           message halfway down the screen AND stay on screen, so the gap is
           read against the picker's own height rather than a flat number. */
        pickerHeight: Math.round(pb.height),
        gap: Math.round(Math.min(Math.abs(bb.top - pb.bottom), Math.abs(pb.top - bb.bottom))),
        overlapsX: pb.left < bb.right && pb.right > bb.left,
        insideWindow: pb.top >= -1 && pb.bottom <= window.innerHeight + 1
          && pb.left >= -1 && pb.right <= window.innerWidth + 1,
      };
    }

    /* And a chosen emoji actually lands on the message. */
    /* From the popup, which is where they live now — a stale one left in the
       panel would be exactly the ghost this change removes. */
    const choice = document.querySelector(
      '.chat-reaction-picker:not(.hidden) [data-chat-reaction-choice]');
    out.emoji = choice ? choice.getAttribute('data-reaction') : '';
    choice?.click();
    await new Promise((r) => setTimeout(r, 500));
    out.chipShown = document.querySelectorAll('.chat-reaction-chip').length;
    out.emojiOnMessage = (document.querySelector('#chatMessages .chat-message-bubble')?.textContent || '')
      .includes(out.emoji);
    out.pickerClosedAfterChoosing = !document.querySelector('.chat-reaction-picker:not(.hidden)');

    /* Only ever ONE picker on the page.
       Rendered inside each bubble it was position:fixed, so it painted over
       everything and outlived the node it belonged to when an incremental
       re-render replaced that node — pickers from messages further up stayed
       on the screen as ghosts. */
    {
      const bubbles = [...document.querySelectorAll('#chatMessages .chat-message-bubble')];
      for (const b of bubbles.slice(0, 3)) {
        b.click();
        await new Promise((r) => setTimeout(r, 150));
        b.querySelector('[data-chat-toggle-reaction]')?.click();
        await new Promise((r) => setTimeout(r, 250));
      }
      out.pickersOnPage = document.querySelectorAll('.chat-reaction-picker').length;
      out.visiblePickers = document.querySelectorAll('.chat-reaction-picker:not(.hidden)').length;
    }

    /* A tap anywhere else puts it away. There used to be no single element to
       close, so it simply stayed. */
    {
      const b = document.querySelector('#chatMessages .chat-message-bubble');
      b?.click();
      await new Promise((r) => setTimeout(r, 150));
      b?.querySelector('[data-chat-toggle-reaction]')?.click();
      await new Promise((r) => setTimeout(r, 300));
      out.openBeforeOutsideTap = Boolean(document.querySelector('.chat-reaction-picker:not(.hidden)'));
      document.getElementById('chatMessages')?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      out.closedByOutsideTap = !document.querySelector('.chat-reaction-picker:not(.hidden)');
    }

    /* The toolbar goes when you press anywhere else, not only when you tap the
       same message a second time — a rule nobody guesses, and one that leaves
       the toolbar on screen while somebody is looking at something else. */
    {
      const b = document.querySelector('#chatMessages .chat-message-bubble');
      b?.click();
      await new Promise((r) => setTimeout(r, 200));
      out.toolbarOpenBeforeTap = Boolean(document.querySelector('#chatMessages .chat-message-bubble.selected'));
      document.getElementById('chatMessages')?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      out.toolbarClosedByOutsideTap = !document.querySelector('#chatMessages .chat-message-bubble.selected');
    }

    /* The custom-emoji field. On a phone, touching it raises the keyboard —
       and a keyboard IS a window resize, which used to close the popup the
       instant the field was touched. The field looked like it was rejecting
       whatever was typed into it. */
    {
      const b = document.querySelector('#chatMessages .chat-message-bubble');
      b?.click();
      await new Promise((r) => setTimeout(r, 200));
      b?.querySelector('[data-chat-toggle-reaction]')?.click();
      await new Promise((r) => setTimeout(r, 300));
      const field = document.querySelector('.chat-reaction-picker:not(.hidden) [data-chat-reaction-custom]');
      out.customFieldThere = Boolean(field);
      if (field) {
        field.focus();
        window.dispatchEvent(new Event('resize'));
        await new Promise((r) => setTimeout(r, 300));
        out.survivesKeyboard = Boolean(document.querySelector('.chat-reaction-picker:not(.hidden)'));
        /* Re-read at the moment of use. The popup is rebuilt each time it
           opens, so a node captured before the last redraw is detached — and a
           keydown dispatched on a detached node reaches no listener at all,
           which looks exactly like the handler being missing. */
        const live = document.querySelector(
          '#chatReactionPopup:not(.hidden) [data-chat-reaction-custom]');
        out.fieldInPopup = Boolean(live);
        if (live) {
          live.value = '🦊';
          live.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
        await new Promise((r) => setTimeout(r, 500));
        /* Read from the message's own reaction record rather than its rendered
           text: the chips render the emoji, but so might the message body, and
           a substring match cannot tell those apart. */
        const probe = window.__convoLockProbe;
        const conv = probe.activeId();
        out.customApplied = JSON.stringify(
          (window.__reactionProbe?.(conv) || [])).includes('🦊');
        out.customDebug = window.__reactionProbe?.(conv) || 'no probe';
      }
    }

    /* The last message in the thread, where there is no room below it — the
     case that used to lose the picker off the bottom of the screen. */
  {
    const bubbles = document.querySelectorAll('#chatMessages .chat-message-bubble');
    const last = bubbles[bubbles.length - 1];
    if (last && last !== bubble) {
      document.querySelector('#chatMessages .chat-message-bubble.selected')?.click();
      await new Promise((r) => setTimeout(r, 200));
      last.scrollIntoView({ block: 'end' });
      last.click();
      await new Promise((r) => setTimeout(r, 250));
      last.querySelector('[data-chat-toggle-reaction]')?.click();
      await new Promise((r) => setTimeout(r, 400));
      const lp = document.querySelector('.chat-reaction-picker:not(.hidden)');
      if (lp) {
        const b = lp.getBoundingClientRect();
        out.lastMessage = {
          insideWindow: b.top >= -1 && b.bottom <= window.innerHeight + 1,
          /* Every row reachable: the box scrolls inside the space it was given
             rather than having its last row cut off by the window. */
          allRowsReachable: lp.scrollHeight <= lp.clientHeight + 1
            || getComputedStyle(lp).overflowY === 'auto',
          top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight,
        };
      } else out.lastMessage = 'no picker';
    } else out.lastMessage = 'only one message';
  }

  /* Clicking the message again puts everything away. */
    document.querySelector('#chatMessages .chat-message-bubble')?.click();
    await new Promise((r) => setTimeout(r, 250));
    out.closesAgain = !document.querySelector('#chatMessages .chat-message-bubble.selected');
    return out;
  });

  console.log(`  ${JSON.stringify(seen)}`);
  check('a message is on screen to react to', seen.bubbles > 0, String(seen.bubbles));
  check('clicking a message opens its toolbar', seen.toolbarOpens);
  check('THE TOOLBAR SURVIVES A REDRAW — it used to vanish after a few seconds',
    seen.survivesRedraw, JSON.stringify(seen.survivesRedraw));
  check('the emoji button opens a picker', seen.pickerOpens && seen.pickerChoices > 0,
    `${seen.pickerChoices} choices`);
  check('AND THE PICKER SURVIVES THE REDRAW ITS OWN BUTTON CAUSES',
    seen.toolbarSurvivesPicker, JSON.stringify(seen.toolbarSurvivesPicker));
  check('the picker is on screen, not clipped or off the edge',
    seen.pickerOnScreen, JSON.stringify(seen.pickerOnScreen));
  /* What "beside its own message" has to mean, given the picker is taller than
     most messages: it shares the message's horizontal band, it is within its
     own height of it vertically, and all of it is on screen. The old placement
     failed every one of those — it landed at a window corner with the message
     nowhere near it. */
  check('AND IT SITS BESIDE ITS OWN MESSAGE, not at a corner of the window',
    seen.near && seen.near.overlapsX && seen.near.insideWindow
    && seen.near.gap <= seen.near.pickerHeight,
    JSON.stringify(seen.near));
  check('choosing an emoji puts it on the message',
    seen.chipShown > 0 && seen.emojiOnMessage, JSON.stringify({ chips: seen.chipShown, on: seen.emojiOnMessage }));
  check('and closes the picker behind it', seen.pickerClosedAfterChoosing);
  check('clicking the message again puts the toolbar away', seen.closesAgain);
  check('the toolbar closes when you press anywhere else',
    seen.toolbarOpenBeforeTap && seen.toolbarClosedByOutsideTap,
    JSON.stringify({ open: seen.toolbarOpenBeforeTap, closed: seen.toolbarClosedByOutsideTap }));
  check('the custom-emoji field survives the keyboard opening',
    seen.customFieldThere && seen.survivesKeyboard,
    JSON.stringify({ field: seen.customFieldThere, survives: seen.survivesKeyboard }));
  check('AND A TYPED EMOJI ACTUALLY LANDS ON THE MESSAGE',
    seen.customApplied, JSON.stringify(seen.customApplied));

  check('there is only ever ONE picker on the page, never a ghost left behind',
    seen.pickersOnPage === 1 && seen.visiblePickers <= 1,
    JSON.stringify({ total: seen.pickersOnPage, visible: seen.visiblePickers }));
  check('and a tap anywhere else closes it',
    seen.openBeforeOutsideTap && seen.closedByOutsideTap,
    JSON.stringify({ open: seen.openBeforeOutsideTap, closed: seen.closedByOutsideTap }));

  if (seen.lastMessage && typeof seen.lastMessage === 'object') {
    check('and on the LAST message it stays on screen instead of falling off the bottom',
      seen.lastMessage.insideWindow, JSON.stringify(seen.lastMessage));
    check('with every row reachable rather than the last one cut off',
      seen.lastMessage.allRowsReachable, JSON.stringify(seen.lastMessage));
  } else {
    console.log(`  (last-message case: ${seen.lastMessage})`);
  }
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
