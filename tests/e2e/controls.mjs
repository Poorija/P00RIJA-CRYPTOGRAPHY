/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* One look for every control, on every theme, and legible on all of them.
 *
 * Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
 *
 *   node tests/e2e/controls.mjs
 *
 * There were seven answers to "is this on?" in one settings screen: the
 * iOS-style switch, four different Tailwind colour recipes on plain
 * checkboxes, and bare inputs taking whatever the browser gave them. The cause
 * was not carelessness at the call sites — a blanket
 * `input { background: var(--app-input-bg) !important }` meant for text fields
 * was painting every checkbox, radio, slider and colour well, so each call
 * site had been given its own colour to work around it.
 *
 * Two things are measured here, per theme, for all fifteen:
 *   - every control of a kind agrees with every other control of that kind,
 *     and follows --app-accent rather than a colour fixed in the stylesheet;
 *   - what it is drawn on can be read: the control against its surface, and
 *     the app's text against its background, at the 3:1 the WCAG non-text bar
 *     asks for and 4.5:1 for body text. */
import { openApp, browser } from './_chat-harness.mjs';

const THEMES = ['light', 'dark', 'pastel', 'midnight', 'neon', 'dracula', 'nord', 'solarized',
  'cyberpunk', 'ocean', 'forest', 'aurora', 'sunset', 'linen', 'obsidian'];
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const A = await openApp('CONTROLS');
/* Every settings surface opened first, so the controls inside them are laid
   out and styled rather than measured while still display:none. */
await A.evaluate(async () => {
  window.switchTab('settings');
  await new Promise((r) => setTimeout(r, 900));
  window.switchTab('chat');
  await new Promise((r) => setTimeout(r, 700));
  document.querySelector('[data-chat-view="connection"]')?.click();
  await new Promise((r) => setTimeout(r, 700));
});

const survey = await A.evaluate(async (themes) => {
  /* Transitions off: a colour caught mid-interpolation computes to an oklab()
     triple that is not what the theme declares. */
  const freeze = document.createElement('style');
  /* The switch track declares its transition with !important, so a freeze
     without one loses to it and every reading lands mid-interpolation — which
     computes to an oklab() triple, not to the colour the theme declares. */
  freeze.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; transition-duration: 0s !important; }';
  document.head.appendChild(freeze);

  /* Settings shows one pane at a time, and a control inside a display:none
     subtree does not get its color-mix() resolved — getComputedStyle hands
     back the unresolved function, which parses as nonsense. Every pane is
     shown for the duration of the measurement so each control is answering
     about the colour a user would actually see. */
  const hiddenPanes = [...document.querySelectorAll('[data-settings-pane].hidden')];
  hiddenPanes.forEach((pane) => pane.classList.remove('hidden'));

  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const rgb = (value) => {
    const text = String(value).trim();
    if (!text || text === 'transparent' || text === 'rgba(0, 0, 0, 0)') return null;
    probe.style.color = '';
    probe.style.color = text;
    const computed = getComputedStyle(probe).color.trim();
    /* Anything that is not rgb() or color(srgb …) is reported as itself rather
       than guessed at: an oklab() triple read on an rgb scale silently clamps
       to 1,0,0 and looks like a real difference between controls. */
    if (!/^(rgba?\(|color\()/.test(computed)) return { raw: computed };
    const numbers = (computed.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    if (numbers.length < 3) return null;
    const scale = /^color\(/.test(computed) ? 255 : 1;
    return numbers.slice(0, 3).map((c) => Math.min(255, Math.max(0, c * scale)));
  };
  const lum = (c) => {
    const [r, g, b] = c.map((channel) => {
      const x = channel / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    if (!a || !b) return null;
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
  };
  const key = (c) => {
    if (!c) return 'none';
    if (c.raw) return c.raw.slice(0, 44);
    return c.map(Math.round).join(',');
  };

  const out = [];
  for (const name of themes) {
    window.setTheme(name);
    await new Promise((r) => setTimeout(r, 200));
    const root = getComputedStyle(document.documentElement);
    const accent = rgb(root.getPropertyValue('--app-accent'));
    const surface = rgb(root.getPropertyValue('--app-surface')) || rgb(root.getPropertyValue('--app-bg'));
    const bg = rgb(root.getPropertyValue('--app-bg'));
    const text = rgb(root.getPropertyValue('--app-text'));
    const muted = rgb(root.getPropertyValue('--app-text-muted'));
    const onAccent = rgb(root.getPropertyValue('--app-on-accent')) || [255, 255, 255];
    const control = rgb(root.getPropertyValue('--app-control-accent')) || accent;

    const switchOn = new Set();
    const knobs = new Set();
    const tracks = new Set();
    const trackOwners = new Map();
    const boxOn = new Set();
    const radioOn = new Set();
    document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((el) => {
      /* Measured whether or not the pane it lives in is the open one: the
         question is what colour this control WOULD be, and a settings screen
         shows one pane at a time. Controls the app never renders at all are
         still excluded — there is nothing to be consistent with. */
      if (!el.isConnected) return;
      /* A disabled control is SUPPOSED to look different — background push is
         held shut until the user consents — so it is not a counter-example to
         "every switch looks the same". */
      if (el.disabled) return;
      const was = el.checked;
      const isSwitch = el.classList.contains('toggle-checkbox');
      /* Read twice. Setting .checked fires no event, but the settings panes
         re-render on their own and a node captured before one of those passes
         is detached by the time it is measured, which computes to the UA
         defaults rather than to anything the stylesheet said. The second read
         is of whatever is at that id NOW. */
      /* For a switch the colour that follows the theme is the TRACK's: the
         knob's ring deliberately stays the same neutral in both states, so
         reading the ring would now be reading the one part that must NOT
         change. The track is found by class rather than as the next sibling,
         because not every switch in this app is wrapped the same way. */
      const trackOf = (node) => node.parentElement?.querySelector('.toggle-label')
        || (node.nextElementSibling?.classList?.contains('toggle-label') ? node.nextElementSibling : null);
      const readOn = (node) => {
        node.checked = true;
        void document.documentElement.offsetWidth;
        const track = trackOf(node);
        const value = isSwitch
          ? key(rgb(track ? getComputedStyle(track).backgroundColor : getComputedStyle(node).borderColor))
          : key(rgb(getComputedStyle(node).backgroundColor));
        node.checked = was;
        return value;
      };
      if (isSwitch) [el, trackOf(el)].forEach((node) => node?.style.setProperty('transition', 'none', 'important'));
      let on = readOn(el);
      const fresh = el.id ? document.getElementById(el.id) : null;
      if (fresh && fresh !== el) on = readOn(fresh);
      /* A switch's KNOB must look the same whether it is on or off — only the
         track's colour and the knob's position say which. It used to take the
         accent when switched on, which put an accent ring on an accent track
         and left a pale blob that did not read as a switch at all. */
      if (isSwitch) {
        /* A style flush between setting the state and reading it. Without one
           a switch can be read while its track is still interpolating, and an
           interpolated colour computes to an oklab() triple rather than to the
           rgb() the theme declares — which is a measurement artefact, not a
           difference between switches. */
        /* An inline !important, not a <style>. The freeze rule uses the
           universal selector, and Secure Chat declares its track transition
           !important at a far higher specificity — with both important,
           specificity decides and the freeze lost, so every chat switch was
           read mid-interpolation and computed to an oklab() triple. An inline
           declaration outranks any stylesheet rule. */
        const track0 = trackOf(el);
        [el, track0].forEach((node) => node?.style.setProperty('transition', 'none', 'important'));
        const settle = () => { void document.documentElement.offsetWidth; };
        el.checked = false; settle();
        const offStyle = getComputedStyle(el);
        knobs.add(`${key(rgb(offStyle.borderColor))}/${key(rgb(offStyle.backgroundColor))}`);
        el.checked = true; settle();
        const onStyle = getComputedStyle(el);
        knobs.add(`${key(rgb(onStyle.borderColor))}/${key(rgb(onStyle.backgroundColor))}`);
        const track = trackOf(el);
        if (track) {
          el.checked = false; settle();
          const offTrack = key(rgb(getComputedStyle(track).backgroundColor));
          el.checked = true; settle();
          const onTrack = key(rgb(getComputedStyle(track).backgroundColor));
          /* The journey, without the id: what is compared is off -> on, and
             naming the switch inside the compared string would make every one
             of them unique by construction. The ids go in the failure message
             instead, where they are useful. */
          tracks.add(`${offTrack} -> ${onTrack}`);
          trackOwners.set(`${offTrack} -> ${onTrack}`,
            [...(trackOwners.get(`${offTrack} -> ${onTrack}`) || []), el.id || '(none)']);
        }
      }
      el.checked = was;
      if (isSwitch) switchOn.add(on);
      else if (el.type === 'radio') radioOn.add(on);
      else boxOn.add(on);
    });
    out.push({
      name,
      accent: key(rgb(root.getPropertyValue('--app-control-accent')) || accent),
      switches: [...switchOn],
      knobs: [...knobs],
      tracks: [...tracks],
      trackOwners: Object.fromEntries([...trackOwners].map(([k, v]) => [k, v.slice(0, 4)])),
      boxes: [...boxOn],
      radios: [...radioOn],
      controlOnSurface: ratio(control, surface),
      tickOnControl: ratio(onAccent, control),
      textOnBg: ratio(text, bg),
      mutedOnBg: ratio(muted, bg),
    });
  }
  window.setTheme('dark');
  hiddenPanes.forEach((pane) => pane.classList.add('hidden'));
  freeze.remove();
  probe.remove();
  return out;
}, THEMES);

console.log('\n===== one accent, fifteen themes =====');
console.log('  theme      accent           switch           checkbox         radio');
survey.forEach((row) => console.log(
  `  ${row.name.padEnd(10)} ${row.accent.padEnd(16)} ${row.switches.join(' / ').padEnd(28)} ${(row.boxes[0] || '-').padEnd(16)} ${row.radios[0] || '-'}`));

check('a switch knob looks the same on as off — only the track says which',
  survey.every((row) => row.knobs.length === 1),
  survey.filter((row) => row.knobs.length !== 1).map((row) => `${row.name}: ${row.knobs.join(' vs ')}`).join(' | ') || 'unchanged on every theme');
check('and every switch in the app makes the same journey, Secure Chat included',
  survey.every((row) => row.tracks.length === 1),
  survey.filter((row) => row.tracks.length !== 1)
    .map((row) => `${row.name}: ` + row.tracks.map((t) => `${t} [${(row.trackOwners[t] || []).join(', ')}]`).join(' vs '))
    .join(' || ') || `one journey on every theme: ${survey[0].tracks[0]}`);
check('every switch on a theme is the same colour as every other switch',
  survey.every((row) => row.switches.length === 1),
  survey.filter((row) => row.switches.length !== 1).map((row) => `${row.name}:${row.switches.length}`).join(', ') || 'one each');
check('every checkbox likewise', survey.every((row) => row.boxes.length === 1),
  survey.filter((row) => row.boxes.length !== 1).map((row) => `${row.name}:${row.boxes.join('/')}`).join(', ') || 'one each');
check('every radio likewise', survey.every((row) => row.radios.length <= 1),
  survey.filter((row) => row.radios.length > 1).map((row) => row.name).join(', ') || 'one each');
check('and all three are the theme control colour, not one fixed in the stylesheet',
  survey.every((row) => [row.switches[0], row.boxes[0], row.radios[0]]
    .filter(Boolean).every((value) => value === row.accent)),
  survey.filter((row) => [row.switches[0], row.boxes[0], row.radios[0]]
    .filter(Boolean).some((value) => value !== row.accent)).map((row) => row.name).join(', ') || 'all follow it');
check('the accent actually differs between themes, so it IS following them',
  new Set(survey.map((row) => row.accent)).size >= 8,
  `${new Set(survey.map((row) => row.accent)).size} distinct accents across 15 themes`);

console.log('\n===== and every theme is readable =====');
console.log('  theme      control/surface  tick/control  text/bg   muted/bg');
survey.forEach((row) => console.log(
  `  ${row.name.padEnd(10)} ${String(row.controlOnSurface).padStart(10)}     ${String(row.tickOnControl).padStart(8)}  ${String(row.textOnBg).padStart(8)}  ${String(row.mutedOnBg).padStart(8)}`));

const worst = (field) => Math.min(...survey.map((row) => row[field] ?? Infinity));
const failing = (field, bar) => survey.filter((row) => (row[field] ?? 0) < bar).map((row) => `${row.name} ${row[field]}`);
check('a switched-on control stands out from what it sits on (>= 3:1)',
  failing('controlOnSurface', 3).length === 0,
  failing('controlOnSurface', 3).join(', ') || `worst ${worst('controlOnSurface')}`);
check('the tick inside it can be seen against it (>= 3:1)',
  failing('tickOnControl', 3).length === 0,
  failing('tickOnControl', 3).join(', ') || `worst ${worst('tickOnControl')}`);
check('body text is readable on the background (>= 4.5:1)',
  failing('textOnBg', 4.5).length === 0,
  failing('textOnBg', 4.5).join(', ') || `worst ${worst('textOnBg')}`);
check('and so is the muted text beside it (>= 3:1)',
  failing('mutedOnBg', 3).length === 0,
  failing('mutedOnBg', 3).join(', ') || `worst ${worst('mutedOnBg')}`);

const failed = results.filter((r) => !r).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
await browser.close();
process.exit(failed ? 1 : 0);
