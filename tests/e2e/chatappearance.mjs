/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The chat appearance card: profiles, the three tick colours, and the contrast
 * each choice actually achieves.
 *
 * Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
 *
 *   node tests/e2e/chatappearance.mjs
 *
 * The read tick takes its colour from the theme, measured to clear 3:1 against
 * that theme's own bubble. That is a good default and still only a default:
 * three states are worth no more than one if the person reading them cannot
 * tell them apart, so the colours are theirs to set.
 *
 * The persistence half is the part worth guarding. This preference is stored
 * through the app's per-profile localStorage namespacing, which means it is
 * really poorija_p_<profile>_chat_appearance and cannot be read back until a
 * profile has been adopted. Applying it any earlier reads an empty box and
 * quietly does nothing, which is exactly how a chosen colour disappeared on
 * reload while it was being written. */
import { openApp, browser } from './_chat-harness.mjs';
const A = await openApp('APPEARANCE');
const results = [];
const check = (n, ok, d='') => { results.push(ok); console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };


console.log('\n===== every section holds what belongs in it =====');
/* Connection & TURN had become the drawer everything fell into, because the
   builder sweeps whatever it has not been told about into that pane. */
const placed = await A.evaluate(async () => {
  window.switchTab('chat');
  await new Promise((r) => setTimeout(r, 800));
  document.querySelector('[data-chat-view="connection"]')?.click();
  await new Promise((r) => setTimeout(r, 800));
  const paneOf = (id) => document.getElementById(id)
    ?.closest('[data-settings-pane]')?.getAttribute('data-settings-pane') || '(nowhere)';
  return {
    menu: [...document.querySelectorAll('[data-settings-tab]')].map((b) => b.getAttribute('data-settings-tab')),
    appearance: paneOf('chatAppearanceCard'),
    push: paneOf('chatPushSettingsCard'),
    strip: paneOf('chatStripMetadataToggle'),
    heic: paneOf('chatConvertHeicToggle'),
    forwardSecrecy: paneOf('chatForwardSecrecyCard'),
    relay: paneOf('chatServerUrl'),
    hints: ['convertHeicHint', 'stripMetadataHint']
      .map((key) => document.querySelector(`[data-i18n="${key}"]`)
        ?.closest('[data-settings-pane]')?.getAttribute('data-settings-pane') || '(nowhere)'),
    /* The app's own notification switch governs every toast the app raises,
       not only the ones a message causes, so it must NOT have travelled. */
    appNotifications: document.getElementById('notificationsToggle')?.closest('[data-settings-pane]')
      ? 'moved into chat' : 'still in app settings',
  };
});
console.log('  ' + JSON.stringify(placed));
check('the menu offers all eight sections', placed.menu.length === 8, placed.menu.join(', '));
check('appearance is its own section, not part of Connection', placed.appearance === 'appearance', placed.appearance);
check('chat background push moved into Chat notifications', placed.push === 'notifications', placed.push);
check('the metadata and HEIC switches moved to Files & privacy',
  placed.strip === 'privacy' && placed.heic === 'privacy', `${placed.strip} / ${placed.heic}`);
check('and they took the paragraphs that explain them',
  placed.hints.every((pane) => pane === 'privacy'), placed.hints.join(', '));
check('forward secrecy sits with them', placed.forwardSecrecy === 'privacy', placed.forwardSecrecy);
check('Connection & TURN keeps only the relay', placed.relay === 'connection', placed.relay);
check("the app's own notifications switch did NOT move",
  placed.appNotifications === 'still in app settings', placed.appNotifications);

console.log('\n===== the card is on screen and wired =====');
const present = await A.evaluate(() => {
  document.getElementById('chatConnectionPanel')?.classList.remove('hidden');
  return {
    card: Boolean(document.getElementById('chatAppearanceCard')),
    profiles: [...document.querySelectorAll('#chatAppearanceProfile option')].map(o => o.value),
    pickers: ['chatTickSentColor','chatTickDeliveredColor','chatTickSeenColor'].map(id => document.getElementById(id)?.value),
    preview: document.querySelectorAll('#chatLivePreview .chat-msg-status').length,
    contrast: document.getElementById('chatTickContrast')?.textContent,
  };
});
console.log('  ' + JSON.stringify(present));
check('the appearance card exists', present.card);
check('five profiles are offered', present.profiles.length === 5, present.profiles.join(', '));
check('all three pickers are seeded with a real colour',
  present.pickers.every(v => /^#[0-9a-f]{6}$/i.test(v || '')), present.pickers.join(' '));
check('the preview shows all three states', present.preview === 3, String(present.preview));
check('and the contrast of the worst one is reported', /\d\.\d\d/.test(present.contrast || ''), present.contrast);

console.log('\n===== choosing a profile repaints the ticks =====');
const byProfile = await A.evaluate(async () => {
  const select = document.getElementById('chatAppearanceProfile');
  const read = () => [...document.querySelectorAll('#chatLivePreview .chat-msg-status')]
    .map(el => getComputedStyle(el).color);
  const readRendered = () => [...document.querySelectorAll('#chatLivePreview .chat-msg-status')]
    .map(el => { const cs = getComputedStyle(el); return `${cs.color}@${Number(cs.opacity).toFixed(2)}`; });
  const out = [];
  for (const id of ['theme','contrast','classic','amber','mono']) {
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 260));
    out.push({ id, colors: read(), rendered: readRendered(), contrast: document.getElementById('chatTickContrast')?.textContent });
  }
  return out;
});
byProfile.forEach(p => console.log(`  ${p.id.padEnd(9)} ${p.rendered.join('  ')}`));
check('each profile paints a different set', new Set(byProfile.map(p => p.colors.join())).size === 5,
  `${new Set(byProfile.map(p => p.colors.join())).size} distinct of 5`);
/* On the theme profile sent and delivered share the bubble's own text colour
   and are told apart by opacity and glyph count, which is the design; the
   other profiles give each state its own hue. So the thing that has to be true
   everywhere is that no two states RENDER alike, colour and opacity together. */
check('no two states render alike within a profile',
  byProfile.every(p => new Set(p.rendered).size === 3),
  byProfile.filter(p => new Set(p.rendered).size !== 3).map(p => p.id).join(', ') || 'all distinct');

console.log('\n===== a colour the user picks wins, and survives a reload =====');
await A.evaluate(async () => {
  const input = document.getElementById('chatTickSeenColor');
  input.value = '#ff2d55';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
});
const picked = await A.evaluate(() => getComputedStyle(
  document.querySelector('#chatLivePreview .chat-msg-status.is-seen')).color);
check('the picked colour is what is painted', picked === 'rgb(255, 45, 85)', picked);
/* Reloaded AND unlocked: the preference lives in the profile's own namespace,
   so a reload that stops at the lock screen cannot be expected to show it —
   there is no profile yet to read it from. */
await A.reload({ waitUntil: 'load' });
await A.waitForTimeout(3000);
const atLockScreen = await A.evaluate(() => ({
  root: document.documentElement.style.getPropertyValue('--chat-seen-tick').trim(),
  locked: Boolean(document.getElementById('unlockPassword')),
}));
check('nothing is applied while the vault is still shut', atLockScreen.root === '' && atLockScreen.locked,
  JSON.stringify(atLockScreen));
await A.evaluate((pass) => {
  const el = document.getElementById('unlockPassword');
  if (el) { el.value = pass; el.dispatchEvent(new Event('input', { bubbles: true })); }
}, 'Transfer#Harness2026!');
await A.evaluate(() => window.unlockApp?.());
await A.waitForTimeout(3500);
const afterUnlock = await A.evaluate(() => ({
  root: document.documentElement.style.getPropertyValue('--chat-seen-tick').trim(),
  attr: document.documentElement.getAttribute('data-tick-colors'),
  picker: document.getElementById('chatTickSeenColor')?.value,
}));
check('and it comes back the moment the profile is unlocked', afterUnlock.root === '#ff2d55',
  JSON.stringify(afterUnlock));
check('the picker shows it too', afterUnlock.picker === '#ff2d55', afterUnlock.picker);

console.log('\n===== reset hands the colours back to the theme =====');
const reset = await A.evaluate(async () => {
  document.getElementById('chatConnectionPanel')?.classList.remove('hidden');
  document.getElementById('chatTickResetBtn').click();
  await new Promise(r => setTimeout(r, 300));
  return {
    inline: document.documentElement.style.getPropertyValue('--chat-seen-tick').trim(),
    attr: document.documentElement.getAttribute('data-tick-colors'),
    painted: getComputedStyle(document.querySelector('#chatLivePreview .chat-msg-status.is-seen')).color,
  };
});
console.log('  ' + JSON.stringify(reset));
check('no inline override is left on the root', reset.inline === '', reset.inline || '(empty)');
check('and the theme colour is painted again', reset.painted !== 'rgb(255, 45, 85)', reset.painted);

await A.evaluate(async () => {
  document.querySelector('[data-settings-tab="appearance"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
});
console.log('\n===== every control on the expanded card is present =====');
const expanded = await A.evaluate(() => ({
  themes: [...document.querySelectorAll('#chatChatTheme option')].map(o => o.value),
  sliders: ['chatBubbleAlpha','chatBubbleRadius','chatZoom'].map(id => document.getElementById(id)?.value),
  swatches: [...document.querySelectorAll('[data-chat-bg]')].map(b => b.getAttribute('data-chat-bg')),
  bubblePickers: ['chatBubbleMineColor','chatBubbleTheirsColor'].map(id => document.getElementById(id)?.value),
}));
console.log('  ' + JSON.stringify(expanded));
check('six chat themes', expanded.themes.length === 6, expanded.themes.join(', '));
check('three sliders start at a real value', expanded.sliders.every(v => Number(v) > 0), expanded.sliders.join(' '));
check('eight backgrounds including the custom one', expanded.swatches.length === 8, expanded.swatches.join(', '));
check('both bubble pickers seeded from the live tokens',
  expanded.bubblePickers.every(v => /^#[0-9a-f]{6}$/i.test(v || '')), expanded.bubblePickers.join(' '));

console.log('\n===== a chat theme repaints the thread =====');
const chatThemed = await A.evaluate(async () => {
  const select = document.getElementById('chatChatTheme');
  const out = [];
  for (const id of ['theme','midnight','parchment','forest','rose','slate']) {
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    /* Two different questions. getComputedStyle answers "what colour is in
       force", which for the first entry is the app theme's own and always
       non-empty; the inline style answers "did this write an override", which
       is what "follow the app theme" has to leave empty. */
    const root = getComputedStyle(document.documentElement);
    out.push({ id,
      me: root.getPropertyValue('--chat-bubble-me').trim(),
      inline: document.documentElement.style.getPropertyValue('--chat-bubble-me').trim(),
      bg: root.getPropertyValue('--chat-thread-bg').trim().slice(0, 42) });
  }
  return out;
});
chatThemed.forEach(o => console.log(`  ${o.id.padEnd(10)} bubble=${o.me.padEnd(9)} bg=${o.bg}`));
check('each theme sets its own bubble', new Set(chatThemed.map(o => o.me)).size === 6,
  `${new Set(chatThemed.map(o => o.me)).size} distinct`);
check('and "follow the app theme" writes no override at all',
  chatThemed[0].inline === '', chatThemed[0].inline || '(cleared)');
check('while every other theme does', chatThemed.slice(1).every(o => o.inline !== ''),
  chatThemed.slice(1).map(o => o.inline).join(' '));

console.log('\n===== the sliders reach the bubble =====');
const sliders = await A.evaluate(async () => {
  const set = (id, value) => { const el = document.getElementById(id); el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('chatBubbleAlpha', 60); set('chatBubbleRadius', 4); set('chatZoom', 130);
  await new Promise(r => setTimeout(r, 350));
  const root = getComputedStyle(document.documentElement);
  return {
    alpha: root.getPropertyValue('--chat-bubble-alpha').trim(),
    radius: root.getPropertyValue('--chat-bubble-radius').trim(),
    zoom: root.getPropertyValue('--chat-zoom').trim(),
    outs: ['chatBubbleAlphaOut','chatBubbleRadiusOut','chatZoomOut'].map(id => document.getElementById(id).textContent),
  };
});
console.log('  ' + JSON.stringify(sliders));
check('opacity, rounding and magnification all land on the root',
  sliders.alpha === '60' && sliders.radius === '4px' && sliders.zoom === '1.3', JSON.stringify(sliders));
check('and the readouts agree', sliders.outs.join(' ') === '60% 4px 130%', sliders.outs.join(' '));

console.log('\n===== a background preset, and a picture of your own =====');
const background = await A.evaluate(async () => {
  document.querySelector('[data-chat-bg="dusk"]').click();
  await new Promise(r => setTimeout(r, 300));
  const afterPreset = getComputedStyle(document.documentElement).getPropertyValue('--chat-thread-bg').trim();
  /* A real PNG through the real input, so the IndexedDB round trip is what is
     being measured and not a stubbed one. */
  const canvas = document.createElement('canvas');
  canvas.width = 8; canvas.height = 8;
  canvas.getContext('2d').fillRect(0, 0, 8, 8);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const input = document.getElementById('chatBackgroundFileInput');
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], 'wall.png', { type: 'image/png' }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 900));
  return {
    afterPreset,
    image: getComputedStyle(document.documentElement).getPropertyValue('--chat-thread-image').trim().slice(0, 12),
    stored: JSON.parse(localStorage.getItem('poorija_chat_appearance') || '{}').background,
    clearShown: !document.getElementById('chatBackgroundClearBtn').classList.contains('hidden'),
  };
});
console.log('  ' + JSON.stringify(background));
check('a preset paints the thread', background.afterPreset.startsWith('linear-gradient'), background.afterPreset.slice(0, 30));
check('an uploaded picture becomes the background', background.image.startsWith('url('), background.image);
check('and is remembered as the choice', background.stored === 'custom', String(background.stored));
check('the remove button appears once there is one', background.clearShown === true, String(background.clearShown));

console.log('\n===== reset puts everything back =====');
const wholeReset = await A.evaluate(async () => {
  document.getElementById('chatAppearanceResetBtn').click();
  await new Promise(r => setTimeout(r, 700));
  const root = document.documentElement.style;
  return ['--chat-bubble-me','--chat-bubble-alpha','--chat-bubble-radius','--chat-zoom','--chat-thread-image','--chat-thread-bg']
    .map(name => `${name}=${root.getPropertyValue(name) || '(cleared)'}`);
});
console.log('  ' + wholeReset.join('  '));
check('no inline appearance override survives', wholeReset.every(entry => entry.endsWith('(cleared)')), wholeReset.join(' '));



console.log('\n===== the live preview shows what the controls do =====');
/* A swatch cannot show a corner radius against its neighbour, or text at a
   size, or a bubble over a background. The preview is built from the same
   .chat-message-bubble and .chat-msg-status the real thread uses, so what is
   checked here is that it really does inherit the thread's styling rather than
   carrying a copy that can drift. */
const preview = await A.evaluate(async () => {
  const read = () => {
    const thread = document.querySelector('#chatLivePreview .chat-live-preview-thread');
    const mine = document.querySelector('#chatLivePreview .chat-message-bubble.me');
    const theirs = document.querySelector('#chatLivePreview .chat-message-bubble.them');
    const seen = document.querySelector('#chatLivePreview .chat-msg-status.is-seen');
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const layer = thread ? getComputedStyle(thread, '::before') : null;
    return {
      bubbles: document.querySelectorAll('#chatLivePreview .chat-message-bubble').length,
      ticks: [...document.querySelectorAll('#chatLivePreview .chat-msg-status')]
        .map((el) => [...el.classList].find((c) => c.startsWith('is-'))),
      mineBg: cs(mine)?.backgroundColor,
      theirsBg: cs(theirs)?.backgroundColor,
      /* A gradient preset and an uploaded picture both live in
         background-image, so "is there an image" cannot tell them apart —
         the value itself is what changed. */
      threadBg: `${layer?.backgroundImage} | ${layer?.backgroundColor}`,
      radius: cs(mine)?.borderRadius,
      fontSize: cs(mine)?.fontSize,
      seenColour: cs(seen)?.color,
    };
  };
  const before = read();
  const set = (id, value) => {
    const el = document.getElementById(id);
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const select = document.getElementById('chatChatTheme');
  select.value = 'parchment';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 260));
  const afterTheme = read();
  set('chatBubbleRadius', 3);
  set('chatZoom', 140);
  await new Promise((r) => setTimeout(r, 260));
  const afterSliders = read();
  const note = document.getElementById('chatPreviewChanged');
  const announced = { text: note?.textContent, shown: note?.classList.contains('is-on') };
  document.querySelector('[data-chat-bg="ink"]').click();
  await new Promise((r) => setTimeout(r, 260));
  const afterBackground = read();
  return { before, afterTheme, afterSliders, afterBackground, announced };
});
console.log('  before    ' + JSON.stringify(preview.before));
console.log('  theme     ' + JSON.stringify(preview.afterTheme));
console.log('  sliders   ' + JSON.stringify(preview.afterSliders));
console.log('  announced ' + JSON.stringify(preview.announced));
check('the preview is a conversation, not a row of swatches',
  preview.before.bubbles === 5, `${preview.before.bubbles} bubbles`);
/* The preview once carried .chat-thread so it would inherit the thread's
   styling for free. It also inherited the chat SHELL's layout, which assumes
   exactly one .chat-thread, and every settings pane collapsed: nothing in
   Settings could be opened. It styles itself from the same tokens instead. */
const threads = await A.evaluate(() => ({
  all: document.querySelectorAll('.chat-thread').length,
  inPreview: document.querySelectorAll('#chatLivePreview .chat-thread').length,
}));
check('and it does not pretend to BE the thread', threads.inPreview === 0,
  JSON.stringify(threads));
check('and it shows all three tick states',
  ['is-sent', 'is-delivered', 'is-seen'].every((c) => preview.before.ticks.includes(c)),
  preview.before.ticks.join(', '));
check('a chat theme repaints both bubbles in it',
  preview.afterTheme.mineBg !== preview.before.mineBg
  && preview.afterTheme.theirsBg !== preview.before.theirsBg,
  `${preview.before.mineBg} -> ${preview.afterTheme.mineBg}`);
check('and the background behind them',
  preview.afterTheme.threadBg !== preview.before.threadBg,
  `${preview.before.threadBg} -> ${preview.afterTheme.threadBg}`);
check('the corner slider reaches the preview',
  preview.afterSliders.radius !== preview.afterTheme.radius,
  `${preview.afterTheme.radius} -> ${preview.afterSliders.radius}`);
check('so does magnification',
  parseFloat(preview.afterSliders.fontSize) > parseFloat(preview.afterTheme.fontSize),
  `${preview.afterTheme.fontSize} -> ${preview.afterSliders.fontSize}`);
check('a background preset lands behind the bubbles',
  preview.afterBackground.threadBg !== preview.afterSliders.threadBg,
  `${preview.afterSliders.threadBg} -> ${preview.afterBackground.threadBg}`);
check('and the preview NAMES what just changed rather than leaving it to be spotted',
  Boolean(preview.announced.text) && preview.announced.shown === true,
  JSON.stringify(preview.announced));

/* Changing the tick profile used to build a fresh settings object and drop the
   chat theme, bubble, background and zoom with it. */
console.log('\n===== one control does not undo another =====');
const kept = await A.evaluate(async () => {
  const select = document.getElementById('chatChatTheme');
  select.value = 'forest';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const zoom = document.getElementById('chatZoom');
  zoom.value = '120';
  zoom.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const before = { ...JSON.parse(localStorage.getItem('poorija_chat_appearance') || '{}') };
  const profile = document.getElementById('chatAppearanceProfile');
  profile.value = 'contrast';
  profile.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  const after = { ...JSON.parse(localStorage.getItem('poorija_chat_appearance') || '{}') };
  return { before, after };
});
console.log('  ' + JSON.stringify(kept));
check('picking a tick profile keeps the chat theme', kept.after.chatTheme === 'forest', kept.after.chatTheme);
check('and keeps the magnification', kept.after.zoom === 120, String(kept.after.zoom));


console.log('\n===== every chat theme can be read =====');
/* The live preview showed this the moment it existed: a chat theme set both
   bubble colours and neither text colour, so on parchment the incoming
   messages were near-white on cream. A bubble colour without its text colour
   is only half a theme. */
const legible = await A.evaluate(async (themes) => {
  const freeze = document.createElement('style');
  freeze.textContent = '*, *::before, *::after { transition: none !important; }';
  document.head.appendChild(freeze);
  const px = (value) => {
    const text = String(value).trim();
    const numbers = (text.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    const scale = /^color\(/.test(text) ? 255 : 1;
    return numbers.slice(0, 3).map((c) => Math.min(255, Math.max(0, c * scale)));
  };
  const lum = (c) => c.map((ch) => { const x = ch / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)); };
  const select = document.getElementById('chatChatTheme');
  const out = [];
  for (const id of themes) {
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 220));
    const mine = document.querySelector('#chatLivePreview .chat-message-bubble.me');
    const theirs = document.querySelector('#chatLivePreview .chat-message-bubble.them');
    const cs = (el) => getComputedStyle(el);
    out.push({
      id,
      mine: ratio(px(cs(mine).color), px(cs(mine).backgroundColor)),
      theirs: ratio(px(cs(theirs).color), px(cs(theirs).backgroundColor)),
    });
  }
  select.value = 'theme';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  freeze.remove();
  return out;
}, ['theme', 'midnight', 'parchment', 'forest', 'rose', 'slate']);
legible.forEach((row) => console.log(`  ${row.id.padEnd(10)} mine ${String(row.mine).padStart(6)}:1   theirs ${String(row.theirs).padStart(6)}:1`));
check('text on your own bubble is readable on every chat theme (>= 4.5:1)',
  legible.every((row) => row.mine >= 4.5),
  legible.filter((row) => row.mine < 4.5).map((row) => `${row.id} ${row.mine}`).join(', ') || `worst ${Math.min(...legible.map((r) => r.mine))}`);
check('and so is text on theirs',
  legible.every((row) => row.theirs >= 4.5),
  legible.filter((row) => row.theirs < 4.5).map((row) => `${row.id} ${row.theirs}`).join(', ') || `worst ${Math.min(...legible.map((r) => r.theirs))}`);

/* And a colour the user picks themselves, which no table can precompute. */
const pickedBubble = await A.evaluate(async () => {
  /* color(srgb r g b) counts 0..1 and rgb() counts 0..255. Reading the first
     with the second's scale turns a near-black on yellow into 1.04:1, which is
     the parser being wrong rather than the app. */
  const px = (v) => {
    const text = String(v).trim();
    const numbers = (text.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    const scale = /^color\(/.test(text) ? 255 : 1;
    return numbers.slice(0, 3).map((c) => Math.min(255, Math.max(0, c * scale)));
  };
  const lum = (c) => c.map((ch) => { const x = ch / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)); };
  const out = [];
  for (const colour of ['#fef08a', '#1e1b4b', '#ffffff', '#000000']) {
    const input = document.getElementById('chatBubbleMineColor');
    input.value = colour;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 220));
    const bubble = document.querySelector('#chatLivePreview .chat-message-bubble.me');
    const cs = getComputedStyle(bubble);
    out.push({ colour, ratio: ratio(px(cs.color), px(cs.backgroundColor)) });
  }
  return out;
});
pickedBubble.forEach((row) => console.log(`  picked ${row.colour}  ${row.ratio}:1`));
check('a bubble colour the user picks gets text that can be read on it',
  pickedBubble.every((row) => row.ratio >= 4.5),
  pickedBubble.filter((row) => row.ratio < 4.5).map((row) => `${row.colour} ${row.ratio}`).join(', ') || `worst ${Math.min(...pickedBubble.map((r) => r.ratio))}`);


console.log('\n===== the background reaches the REAL thread, not only the preview =====');
/* It did not. `#content-chat .chat-thread` was painted with var(--app-bg) at
   !important and then had background-image: none forced on top, so a chat
   background chosen in Settings changed the preview and nothing else. */
const realThread = await A.evaluate(async () => {
  /* The background moved onto .chat-thread::before — one layer behind the
     header, the panel and the composer together — so that is where it is read
     from now. The panel is read through the same layer: it is what sits behind
     the bubbles. */
  const read = () => {
    const el = document.querySelector('#content-chat .chat-thread');
    /* The wallpaper only exists while a conversation is OPEN —
       .chat-thread-empty is how the app marks the "choose a conversation"
       screen, and painting a background there was a bug of its own. A harness
       profile has no peer to open, so the class is dropped the way opening one
       would drop it; without this the layer is correctly absent and every
       assertion below reads "none". */
    el?.classList.remove('chat-thread-empty');
    const layer = el ? getComputedStyle(el, '::before') : null;
    return {
      thread: `${layer?.backgroundImage} | ${layer?.backgroundColor}`,
      panel: `${layer?.backgroundImage}`,
    };
  };
  document.querySelector('[data-chat-view="chats"]')?.click();
  await new Promise((r) => setTimeout(r, 600));
  const before = read();
  document.querySelector('[data-chat-view="connection"]')?.click();
  await new Promise((r) => setTimeout(r, 600));
  document.querySelector('[data-settings-tab="appearance"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  document.querySelector('[data-chat-bg="plum"]').click();
  await new Promise((r) => setTimeout(r, 400));
  document.querySelector('[data-chat-view="chats"]')?.click();
  await new Promise((r) => setTimeout(r, 600));
  const afterPreset = read();
  document.querySelector('[data-chat-view="connection"]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  document.querySelector('[data-settings-tab="appearance"]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  /* The preset is cleared first: a background chosen explicitly is meant to
     win over the one a theme brings, so leaving it on would be testing that
     precedence rather than the theme. */
  document.querySelector('[data-chat-bg=""]').click();
  await new Promise((r) => setTimeout(r, 300));
  const select = document.getElementById('chatChatTheme');
  select.value = 'parchment';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('[data-chat-view="chats"]')?.click();
  await new Promise((r) => setTimeout(r, 600));
  return { before, afterPreset, afterTheme: read() };
});
console.log('  before  ' + JSON.stringify(realThread.before));
console.log('  preset  ' + JSON.stringify(realThread.afterPreset));
console.log('  theme   ' + JSON.stringify(realThread.afterTheme));
check('a background preset paints the real thread',
  realThread.afterPreset.thread !== realThread.before.thread,
  `${realThread.before.thread.slice(0, 26)} -> ${realThread.afterPreset.thread.slice(0, 40)}`);
check('and it is the layer the bubbles sit on',
  realThread.afterPreset.panel !== realThread.before.panel,
  realThread.afterPreset.panel.slice(0, 44));
check('a chat theme paints it as well',
  realThread.afterTheme.thread !== realThread.afterPreset.thread,
  realThread.afterTheme.thread.slice(0, 44));

console.log('\n===== the notes in Files & privacy are not washed out =====');
/* opacity: 0.6 on a note whose colour is already the muted grey, with
   .chat-storage-note-quiet multiplying another 0.72 on top — about 0.43 of an
   already-dim colour. Both are set by colour now, and measured. */
const notes = await A.evaluate(async () => {
  document.querySelector('[data-chat-view="connection"]')?.click();
  await new Promise((r) => setTimeout(r, 600));
  document.querySelector('[data-settings-tab="privacy"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  /* Through a probe element, because a token holds whatever the theme wrote —
     often a hex string like #0f172a, on which a decimal regex finds 0, 17 and
     2 and reports a contrast of 1.19:1 for text that is perfectly readable. */
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden';
  document.body.appendChild(probe);
  const px = (v) => {
    probe.style.color = '';
    probe.style.color = String(v).trim();
    const t = getComputedStyle(probe).color.trim();
    const n = (t.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    const s = /^color\(/.test(t) ? 255 : 1;
    return n.slice(0, 3).map((c) => Math.min(255, Math.max(0, c * s)));
  };
  const lum = (c) => c.map((ch) => { const x = ch / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)); };
  const bg = px(getComputedStyle(document.documentElement).getPropertyValue('--app-bg'));
  const measure = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return { sel, missing: true };
    const cs = getComputedStyle(el);
    return { sel, opacity: Number(cs.opacity), contrast: ratio(px(cs.color), bg) };
  };
  const measured = [
    measure('#chatForwardSecrecyCard .chat-storage-note'),
    measure('[data-settings-pane="privacy"] .chat-storage-note-quiet'),
  ].filter((row) => !row.missing);
  probe.remove();
  return measured;
});
notes.forEach((row) => console.log(`  ${row.sel.slice(0, 48).padEnd(50)} opacity=${row.opacity}  contrast=${row.contrast}:1`));
check('no note is dimmed by stacked opacity', notes.every((row) => row.opacity === 1),
  notes.map((row) => row.opacity).join(', '));
check('and each is readable on the background (>= 3:1)', notes.every((row) => row.contrast >= 3),
  notes.map((row) => `${row.contrast}`).join(', '));


console.log('\n===== the background is ONE piece, and it covers everything =====');
/* It used to be painted on .chat-thread and .chat-messages-panel both, with
   the header keeping its own --chat-header-bg on top of that, so the same
   picture was drawn twice and the header read as a separate strip above the
   conversation. .chat-thread already contains the header, the panel AND the
   composer, so one layer behind it covers the screen from the top of the
   header to under the send button. */
const oneLayer = await A.evaluate(async () => {
  document.querySelector('[data-chat-view="connection"]')?.click();
  await new Promise((r) => setTimeout(r, 600));
  document.querySelector('[data-settings-tab="appearance"]')?.click();
  await new Promise((r) => setTimeout(r, 350));
  document.querySelector('[data-chat-bg="grid"]').click();
  await new Promise((r) => setTimeout(r, 300));
  const blur = document.getElementById('chatBackgroundBlur');
  blur.value = '16';
  blur.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 350));
  document.querySelector('[data-chat-view="chats"]')?.click();
  await new Promise((r) => setTimeout(r, 700));
  document.querySelector('#chatPeerList .chat-peer-card, [data-conversation-key]')?.click();
  await new Promise((r) => setTimeout(r, 800));
  /* The wallpaper only exists while a conversation is OPEN — .chat-thread-empty
     is how the app marks the "choose a conversation" screen, and painting a
     background there was a bug in its own right. A fresh harness profile has no
     peer to click, so the class is dropped the way opening one would drop it;
     otherwise this measures a thread that is correctly bare. */
  document.querySelector('#content-chat .chat-thread')?.classList.remove('chat-thread-empty');
  await new Promise((r) => setTimeout(r, 200));
  const thread = document.querySelector('#content-chat .chat-thread');
  if (!thread) return { error: 'no thread on screen' };
  const layer = getComputedStyle(thread, '::before');
  const paints = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { image: cs.backgroundImage !== 'none', alpha: cs.backgroundColor };
  };
  return {
    layerImage: layer.backgroundImage !== 'none',
    layerFilter: layer.filter,
    layerInset: layer.inset,
    thread: paints('#content-chat .chat-thread'),
    panel: paints('#content-chat .chat-messages-panel'),
    header: paints('#content-chat .chat-thread-header'),
    composer: paints('#content-chat .chat-composer-bar'),
    blurToken: document.documentElement.style.getPropertyValue('--chat-bg-blur'),
  };
});
console.log('  ' + JSON.stringify(oneLayer));
check('the background lives on ONE layer behind the whole thread',
  oneLayer.layerImage === true, String(oneLayer.layerImage));
check('and nothing inside paints a second copy of it',
  [oneLayer.thread, oneLayer.panel, oneLayer.header, oneLayer.composer]
    .filter(Boolean).every((part) => part.image === false),
  JSON.stringify([oneLayer.thread, oneLayer.panel, oneLayer.header, oneLayer.composer].map((p) => p && p.image)));
/* Translucent, so the one layer is visibly continuous behind the header and
   the composer rather than stopping at their edges. */
const translucent = (value) => /rgba|color\(/.test(String(value)) && !/\/\s*1\)/.test(String(value));
check('the header lets it through rather than stopping it',
  translucent(oneLayer.header?.alpha), oneLayer.header?.alpha);
check('and so does the composer, so it reaches under the send button',
  translucent(oneLayer.composer?.alpha), oneLayer.composer?.alpha);
check('the blur slider reaches the layer', /blur\(16px\)/.test(oneLayer.layerFilter || ''),
  oneLayer.layerFilter);
check('and the layer is inset by twice the blur, so no soft edge shows',
  oneLayer.layerInset === '-32px', oneLayer.layerInset);

const noBlur = await A.evaluate(async () => {
  const blur = document.getElementById('chatBackgroundBlur');
  if (!blur) {
    document.querySelector('[data-chat-view="connection"]')?.click();
    await new Promise((r) => setTimeout(r, 600));
    document.querySelector('[data-settings-tab="appearance"]')?.click();
    await new Promise((r) => setTimeout(r, 350));
  }
  const slider = document.getElementById('chatBackgroundBlur');
  slider.value = '0';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 350));
  return {
    token: document.documentElement.style.getPropertyValue('--chat-bg-blur'),
    previewFilter: getComputedStyle(
      document.querySelector('#chatLivePreview .chat-live-preview-thread'), '::before').filter,
  };
});
console.log('  ' + JSON.stringify(noBlur));
check('setting the blur back to zero removes it entirely',
  noBlur.token === '' && /none|blur\(0px\)/.test(noBlur.previewFilter), JSON.stringify(noBlur));

const failed = results.filter(r => !r).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
await browser.close();
process.exit(failed ? 1 : 0);
