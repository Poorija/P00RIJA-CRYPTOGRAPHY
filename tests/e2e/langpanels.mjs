/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Two things the language sweep never reached, and one drawer that scrolled.
 *
 *   PORT=8123 npm run dev ; node tests/e2e/langpanels.mjs
 *
 * updateLanguage() rewrites elements carrying data-i18n. Everything written by
 * JavaScript is invisible to it, and Secure Chat's settings section is written
 * both ways: the rows come from index.html and DO change, while the
 * import/export card and the whole Tools card are built in JS and did NOT. The
 * result was one screen showing an English menu over Persian cards, which
 * looks like a half-finished translation rather than a caching bug.
 *
 * Fixing it once is not enough, because the natural way to write a card — one
 * template literal, built on first use, kept forever — reintroduces it every
 * time somebody adds a card. So what is asserted is the property, on the whole
 * pane: no Persian anywhere in it while the app is in English.
 *
 * The drawer is a different failure with the same smell of "it works on the
 * desktop". The desktop stylesheet pins the Dashboard Hub and scrolls only the
 * menu; the phone drawer scrolls as one block, so the hub — which carries the
 * install, language and theme buttons — leaves the screen as soon as anyone
 * scrolls the twenty-four tabs.
 */
import { openApp, browser } from './_chat-harness.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const persian = /[؀-ۿ]/;

try {
  const page = await openApp('langpanels');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);

  /* ===== the settings panes ============================================= */

  console.log('\n===== Secure Chat settings, in English =====');

  const panes = await page.evaluate(async () => {
    window.switchTab?.('chat');
    await new Promise((r) => setTimeout(r, 1200));
    /* The Tools card is mounted lazily, on a timer after the tab opens. */
    window.mountChatToolsPane?.();
    await new Promise((r) => setTimeout(r, 300));

    const setLang = async (want) => {
      if (document.documentElement.lang !== want) window.switchLanguage();
      await new Promise((r) => setTimeout(r, 500));
    };

    const read = () => {
      const pane = document.querySelector('[data-settings-pane="tools"]');
      if (!pane) return null;
      return {
        /* Only what a person reads: an aria-label or a title attribute that
           lagged behind would be a separate finding, not this one. */
        text: pane.innerText.replace(/\s+/g, ' ').trim(),
        cards: {
          archive: Boolean(document.getElementById('chatArchiveCard')),
          tools: Boolean(document.getElementById('chatToolsExtraCard')),
        },
      };
    };

    await setLang('fa');
    const fa = read();
    await setLang('en');
    const en = read();
    /* Back again: a relabel that only runs one way passes a test that only
       looks once. */
    await setLang('fa');
    const backToFa = read();

    /* The controls have to still work after the card was rewritten — an
       innerHTML refill throws away every listener on what it replaced. */
    await setLang('en');
    const live = {
      exportBtn: Boolean(document.querySelector('#chatArchiveCard [data-archive-export]')),
      relayBtn: Boolean(document.getElementById('chatToolsRelayBtn')),
      peerSelect: Boolean(document.getElementById('chatToolsPeerSelect')),
    };
    /* Pressing the relay test is the cheapest proof that a listener survived:
       it writes into its own result box straight away. */
    document.getElementById('chatToolsRelayBtn')?.click();
    await new Promise((r) => setTimeout(r, 400));
    live.relayReacted = (document.getElementById('chatToolsRelayResult')?.textContent || '').trim().length > 0;

    return { fa, en, backToFa, live };
  });

  check('the Tools pane exists and both cards are in it',
    Boolean(panes.en) && panes.en.cards.archive && panes.en.cards.tools,
    JSON.stringify(panes.en?.cards));

  const stray = (panes.en?.text || '').split(' ').filter((word) => persian.test(word));
  console.log(`  english pane, persian words left: ${stray.length}`);
  if (stray.length) console.log(`  ${JSON.stringify(stray.slice(0, 12))}`);
  check('nothing in the Tools pane is still Persian while the app is in English',
    stray.length === 0, stray.slice(0, 8).join(' '));

  check('and it is Persian again in Persian',
    persian.test(panes.backToFa?.text || ''), (panes.backToFa?.text || '').slice(0, 60));

  console.log(`  live after relabel: ${JSON.stringify(panes.live)}`);
  check('the buttons survive the rewrite',
    panes.live.exportBtn && panes.live.relayBtn && panes.live.peerSelect,
    JSON.stringify(panes.live));
  check('and their listeners survive it too',
    panes.live.relayReacted, String(panes.live.relayReacted));

  /* ===== the phone drawer =============================================== */

  console.log('\n===== the drawer on a phone =====');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);

  const drawer = await page.evaluate(async () => {
    window.switchTab?.('encrypt');
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('mobileNavToggle')?.click();
    await new Promise((r) => setTimeout(r, 600));

    const aside = document.getElementById('appSidebar');
    const nav = document.getElementById('sidebarNav');
    const intro = aside?.querySelector('.sidebar-intro');
    if (!aside || !nav || !intro) return { opened: false };

    const before = intro.getBoundingClientRect().top;
    /* Scroll the menu the way a thumb would — past the point where the hub
       used to disappear. */
    nav.scrollTop = nav.scrollHeight;
    await new Promise((r) => setTimeout(r, 300));
    const after = intro.getBoundingClientRect().top;

    return {
      opened: aside.classList.contains('open'),
      asideOverflow: getComputedStyle(aside).overflowY,
      navOverflow: getComputedStyle(nav).overflowY,
      /* The menu must actually have somewhere to scroll, or the check above
         proves nothing. */
      navScrollable: nav.scrollHeight - nav.clientHeight,
      navScrolled: nav.scrollTop,
      introMoved: Math.abs(after - before),
      /* And the hub has to be ON screen, not merely unmoved. */
      introVisible: intro.getBoundingClientRect().bottom > 0
        && intro.getBoundingClientRect().top < window.innerHeight,
      langButtonReachable: (() => {
        const button = document.getElementById('sidebarLangBtn');
        if (!button) return false;
        const box = button.getBoundingClientRect();
        return box.width > 0 && box.top >= 0 && box.bottom <= window.innerHeight;
      })(),
      /* How much of the drawer the menu is NOT allowed to use.
         The drawer reserves room for the mobile bottom bar with
         padding-bottom: calc(var(--tabbar-h) + 0.6rem) — 73.7px on a 844px
         phone. That was invisible while the whole drawer scrolled, because it
         sat at the far end of the scroll. Once only the menu scrolls it turns
         into a permanent empty strip under the last tab, which is what was
         reported. The clearance still has to exist; it belongs INSIDE the
         menu's scroll box, where it is scrolled through. */
      deadBandBelowMenu: +(aside.getBoundingClientRect().bottom
        - nav.getBoundingClientRect().bottom).toFixed(1),
      navPadBottom: parseFloat(getComputedStyle(nav).paddingBottom),
      /* And the last tab must actually be reachable at the end of the scroll,
         not left under the bottom bar. */
      /* Hit-tested, not measured against the bar's coordinates. The drawer is
         painted OVER the quick-access bar while it is open — z-index 91010
         against the bar's 60 — so a tab whose box overlaps the bar's box is
         still the thing a finger lands on. Comparing rectangles said the last
         tab was 23px "under the bar" on a 390x844 phone while
         elementFromPoint at its own centre returned the tab itself. */
      lastTabReachable: await (async () => {
        nav.scrollTop = nav.scrollHeight;
        await new Promise((r) => setTimeout(r, 250));
        const tabs = nav.querySelectorAll('button');
        const last = tabs[tabs.length - 1];
        if (!last) return false;
        const box = last.getBoundingClientRect();
        if (box.height < 8) return false;
        const hit = document.elementFromPoint(
          Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2));
        return Boolean(hit) && (hit === last || last.contains(hit));
      })(),
    };
  });
  console.log(`  ${JSON.stringify(drawer)}`);

  check('the drawer opens', drawer.opened === true, JSON.stringify(drawer.opened));
  check('the drawer itself no longer scrolls', drawer.asideOverflow === 'hidden',
    String(drawer.asideOverflow));
  check('the menu scrolls instead', drawer.navOverflow === 'auto' || drawer.navOverflow === 'scroll',
    String(drawer.navOverflow));
  check('and it really had somewhere to scroll to', drawer.navScrollable > 40,
    `${drawer.navScrollable}px of overflow, scrolled ${drawer.navScrolled}`);
  check('the Dashboard Hub does not move when the menu is scrolled',
    drawer.introMoved < 2, `${drawer.introMoved}px`);
  check('and the language button stays reachable', drawer.langButtonReachable,
    String(drawer.langButtonReachable));
  check('no empty strip is left under the menu',
    drawer.deadBandBelowMenu <= 2, `${drawer.deadBandBelowMenu}px`);
  /* This used to demand more than 40px of padding at the end of the menu — the
     clearance the drawer once reserved for the quick-access bar. That
     reservation was deliberately dropped: the drawer covers the bar while it
     is open, so the reservation was a dead band nobody needed, and the gap is
     now the same 24px the menu keeps from the Dashboard Hub above it. The
     number is a decision; what has to stay true is that the list ends in a
     gap rather than flush against the edge, and that the last tab can be
     tapped. Both are checked instead of the number. */
  check('the menu ends in a gap rather than flush against the drawer edge',
    drawer.navPadBottom >= 16, `${drawer.navPadBottom}px of scrolled padding`);
  check('and the last tab is what a finger lands on at the end of the scroll',
    drawer.lastTabReachable, String(drawer.lastTabReachable));
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
