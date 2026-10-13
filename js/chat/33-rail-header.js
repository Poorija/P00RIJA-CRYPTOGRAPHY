/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 33 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   The rail header folds away as you scroll
*/

/* ---------------------------------------------------------------------
   The rail header folds away as you scroll
   ---------------------------------------------------------------------
   Two thresholds rather than one: it condenses at 48px and only expands
   again below 12px. A single threshold makes the header flap open and shut
   while you drag across it, because condensing removes height and that
   scrolls the list back under the threshold.
   --------------------------------------------------------------------- */
/* 48px was low enough that the list's own restored scroll offset — it reopens
   where you left it, typically ~50px in — folded the header before the user
   had touched anything, so the full profile was never seen. */
/* Nothing stacks any more — the chrome does not scroll, so there are no
   offsets to compute. What is left is sizing: the empty composer wrapper still
   claims a flex gap, and the settings panel needs an explicit height because
   it cannot get one any other way. Module-level rather than a closure so
   setChatView can call it — switching to Settings does not scroll anything,
   so the scroll handler would never have run for it. */
function syncRailChrome() {
  const rail = document.querySelector('#content-chat .chat-rail');
  if (!rail) return;
  const header = rail.querySelector('.chat-profile-card');
  const tabs = rail.querySelector('.chat-nav-bar');
  const headerHeight = header?.offsetHeight || 0;
  rail.style.setProperty('--rail-header-h', `${headerHeight}px`);

  const panels = rail.querySelector('#chatComposerPanels');
  if (panels) {
    /* This latched shut. It decided whether to hide the wrapper by measuring
       its children's height — but once the wrapper itself carried `hidden`,
       every child measured zero, so the next pass saw "nothing visible" and
       kept it hidden for good. In the Groups view that made the create-a-group
       form unreachable: the fold was there, and the panel holding it was gone.
       Ask the children what they are instead of how tall they happen to be
       while their parent is hidden. */
    const hasVisibleChild = Array.from(panels.children)
      .some((child) => !child.classList.contains('hidden'));
    panels.classList.toggle('hidden', !hasVisibleChild);
  }
  const tabsHeight = tabs?.offsetHeight || 0;
  rail.style.setProperty('--rail-chips-top', `${headerHeight + tabsHeight}px`);
  rail.style.setProperty('--rail-heading-top', `${headerHeight + tabsHeight}px`);

  /* Settings is a <details>, and this engine forces display:block on those, so
     it cannot be made a flex column whose body scrolls. A stylesheet rule with
     more classes on <html> also outranks anything reasonable we can write for
     its overflow — measured: the panel computed to overflow hidden with 1149px
     of settings inside a 277px box, so most of the page could not be reached.
     Measuring the space and capping the body is the one approach that does not
     depend on winning either fight. */
  const settings = rail.querySelector('#chatConnectionPanel');
  const settingsBody = settings?.querySelector('.chat-settings-body');
  if (settings && settingsBody && settings.offsetParent !== null) {
    const summary = settings.querySelector(':scope > summary');
    /* Against the panel's own box, not the rail's: the panel is a flex item
       whose height flex has already decided, and a body taller than that is
       clipped by the panel however well it scrolls internally. */
    /* Measured from where the body actually starts, not from the summary's
       height: the panel has other chrome above the body, and subtracting only
       the summary left ~360px of settings hanging past the panel's own box. */
    const bodyOffset = settingsBody.getBoundingClientRect().top - settings.getBoundingClientRect().top;
    const available = settings.clientHeight - bodyOffset - 4;
    /* A different card changes all of the above; the observer on the card
       brings this back round with the new measurements. */
    if (fitSettingsCard(rail, settingsBody, available)) return;
    if (available > 120) {
      settingsBody.style.setProperty('max-height', `${Math.round(available)}px`, 'important');
      settingsBody.style.setProperty('overflow-y', 'auto', 'important');
      /* The app's fixed tab bar covers the foot of the scroller, and the
         stylesheet rule for this loses to one with more classes on <html>. */
      const bar = getComputedStyle(document.documentElement).getPropertyValue('--tabbar-h').trim() || '3.55rem';
      settingsBody.style.setProperty('padding-bottom', `calc(${bar} + 0.75rem)`, 'important');
    }
    void summary;
  }
}

/* How much of the profile card fits above Settings on a phone.
 *
 * The nine sections and the card share the rail, and whether both fit is a
 * measurement, not a screen size: one 932pt phone is 932 tall in the browser
 * and 873 as an installed app under the status bar, and a height threshold hid
 * the card on that phone with room to spare. So the menu is measured against
 * the room the body would have under the full card, then under the one-row
 * card, and the card takes the first that leaves every section in view —
 * "hidden" only when even one row is too much (an iPhone SE).
 *
 * Both card heights are remembered once seen, so the answer does not depend on
 * which state the card happens to be in while it is asked: the decision is
 * the same from every side, and the rail does not flap between two of them.
 * Returns true when it changed the card, so the caller measures again. */
const SETTINGS_CARD_COMPACT_GUESS_PX = 64;
function fitSettingsCard(rail, settingsBody, available) {
  const header = rail.querySelector(':scope > .chat-profile-card');
  const menu = settingsBody.querySelector('.chat-settings-menu');
  const inSettings = rail.getAttribute('data-view') === 'connection';
  const phone = window.matchMedia('(max-width: 767px)').matches;
  if (!inSettings || !phone || !header || !menu) {
    if (rail.dataset.settingsCard) {
      delete rail.dataset.settingsCard;
      return true;
    }
    return false;
  }
  /* A section open on its own page keeps whatever the menu was given, so
     going in and out of one does not move the card. */
  if (menu.offsetParent === null || !menu.offsetHeight) return false;
  const state = rail.dataset.settingsCard || 'full';
  if (header.offsetHeight) {
    if (state === 'full') rail.dataset.cardFullH = String(header.offsetHeight);
    if (state === 'compact') rail.dataset.cardCompactH = String(header.offsetHeight);
  }
  const fullH = Number(rail.dataset.cardFullH) || header.offsetHeight || 0;
  const compactH = Number(rail.dataset.cardCompactH) || SETTINGS_CARD_COMPACT_GUESS_PX;
  const gap = parseFloat(getComputedStyle(rail).rowGap) || 0;
  const cardNow = header.offsetHeight ? header.offsetHeight + gap : 0;
  /* The body's own room with no card at all, and what the menu needs of it. */
  const room = available + cardNow;
  const style = getComputedStyle(settingsBody);
  const measured = menu.offsetHeight + (parseFloat(getComputedStyle(menu).marginTop) || 0)
    + (parseFloat(style.paddingTop) || 0) + 2;
  /* "tight" is the last resort, and the only one that changes the menu: its
     rows get shorter. What the menu needs is therefore remembered from its
     ordinary rows, or being tight would make it look as if it fitted. */
  if (state !== 'tight') rail.dataset.menuNeed = String(measured);
  const need = state === 'tight' ? (Number(rail.dataset.menuNeed) || measured) : measured;
  let next = 'tight';
  if (need <= room - (fullH + gap)) next = 'full';
  else if (need <= room - (compactH + gap)) next = 'compact';
  else if (need <= room) next = 'hidden';
  if (next === state && rail.dataset.settingsCard) return false;
  rail.dataset.settingsCard = next;
  return next !== state;
}

const CHAT_RAIL_WIDTH_KEY = 'poorija_chat_rail_width';
const CHAT_RAIL_MIN_PX = 272;   /* 17rem — the clamp floor in the stylesheet */
const CHAT_RAIL_MAX_PX = 544;   /* 34rem — the clamp ceiling */

function storedRailWidth() {
  try {
    const raw = Number(localStorage.getItem(CHAT_RAIL_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= CHAT_RAIL_MIN_PX && raw <= CHAT_RAIL_MAX_PX) return raw;
  } catch (error) { void error; }
  return 0;
}

function applyRailWidth(px, { persist = true } = {}) {
  const shell = document.querySelector('#content-chat .chat-shell');
  if (!shell) return 0;
  const width = Math.round(Math.min(CHAT_RAIL_MAX_PX, Math.max(CHAT_RAIL_MIN_PX, px)));
  shell.style.setProperty('--chat-rail-width', `${width}px`);
  if (persist) {
    try { localStorage.setItem(CHAT_RAIL_WIDTH_KEY, String(width)); } catch (error) { void error; }
  }
  return width;
}

/* Dragging writes one custom property; the stylesheet owns the clamp, so a
   stored width from a wide monitor cannot squeeze the thread on a laptop. */
function bindChatRailResizer() {
  const handle = document.getElementById('chatRailResizer');
  const shell = document.querySelector('#content-chat .chat-shell');
  if (!handle || !shell || handle.dataset.resizeBound) return;
  handle.dataset.resizeBound = '1';

  const stored = storedRailWidth();
  if (stored) applyRailWidth(stored, { persist: false });

  /* Which side the rail sits on is read off the boxes rather than off dir:
     the shell is forced LTR while the page is RTL, so neither one alone
     answers the question. */
  const railOnRight = () => {
    const rail = document.querySelector('#content-chat .chat-rail');
    const thread = document.querySelector('#content-chat .chat-thread');
    if (!rail || !thread) return true;
    return rail.getBoundingClientRect().left > thread.getBoundingClientRect().left;
  };

  const widthFromPointer = (clientX) => {
    const box = shell.getBoundingClientRect();
    return railOnRight() ? box.right - clientX : clientX - box.left;
  };

  let pointerId = null;
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    handle.dataset.dragging = '1';
    document.documentElement.classList.add('chat-rail-resizing');
    event.preventDefault();
  });

  handle.addEventListener('pointermove', (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    applyRailWidth(widthFromPointer(event.clientX), { persist: false });
  });

  const finish = (event) => {
    if (pointerId === null || (event && event.pointerId !== pointerId)) return;
    try { handle.releasePointerCapture(pointerId); } catch (error) { void error; }
    pointerId = null;
    delete handle.dataset.dragging;
    document.documentElement.classList.remove('chat-rail-resizing');
    const rail = document.querySelector('#content-chat .chat-rail');
    if (rail) applyRailWidth(rail.getBoundingClientRect().width);
    if (typeof syncRailChrome === 'function') syncRailChrome();
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);

  /* Keyboard: the separator is focusable, so arrows resize it in 16px steps
     and Home restores the default. */
  handle.addEventListener('keydown', (event) => {
    const rail = document.querySelector('#content-chat .chat-rail');
    if (!rail) return;
    const current = rail.getBoundingClientRect().width;
    const grow = railOnRight() ? 'ArrowLeft' : 'ArrowRight';
    const shrink = railOnRight() ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === grow) applyRailWidth(current + 16);
    else if (event.key === shrink) applyRailWidth(current - 16);
    else if (event.key === 'Home') {
      shell.style.removeProperty('--chat-rail-width');
      try { localStorage.removeItem(CHAT_RAIL_WIDTH_KEY); } catch (error) { void error; }
    } else return;
    event.preventDefault();
    if (typeof syncRailChrome === 'function') syncRailChrome();
  });

  /* Double-click is the usual "give me the default back" gesture. */
  handle.addEventListener('dblclick', () => {
    shell.style.removeProperty('--chat-rail-width');
    try { localStorage.removeItem(CHAT_RAIL_WIDTH_KEY); } catch (error) { void error; }
    if (typeof syncRailChrome === 'function') syncRailChrome();
  });
}
