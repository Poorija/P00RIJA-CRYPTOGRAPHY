/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* ============================================================================
   Text formatting: bold, italic, strike, code, spoilers and links.
   ============================================================================

   The markers are the ones every messenger people already use has taught
   them, and they travel as plain characters inside the encrypted text:

       *bold*   _italic_   ~strike~   `code`   ```block```   ||spoiler||

   Nothing about the wire changes. An older build shows the markers as they
   were typed, which is exactly what a message with asterisks in it always
   looked like, so there is nothing to negotiate.

   The input here is text that has ALREADY been HTML-escaped. Every marker is
   an ASCII character escapeHTML leaves alone, and every tag this file writes
   is one of a fixed handful with no attributes taken from the message — the
   only value that lands in an attribute is a link, and that only after it
   has been checked to be http(s) and is still in its escaped form.

   Code and links are lifted out first and put back last, so a URL with
   underscores in it is not italicised and a code sample is shown as typed.
   ============================================================================ */

const FORMAT_HOLD = '\u0000';
const FORMAT_LINK = /\bhttps?:\/\/[^\s<>"'\u0000]+/gi;
/* A marker opens only after a boundary and closes only before one, so
   snake_case_names, 2*3*4 and a lone ~ stay what they are. `;` before and
   `&` after are the two ends of an escaped quotation mark (&quot;), which is
   what a quote looks like by the time this code sees it. */
const FORMAT_EDGE_BEFORE = '(^|[\\s([{«;‘“>])';
const FORMAT_EDGE_AFTER = '(?=$|[\\s)\\]}».,;:!?؟،&’”<])';

function formatInlineRule(marker, tag) {
  const m = marker.replace(/[|*~_]/g, (c) => `\\${c}`);
  return {
    pattern: new RegExp(`${FORMAT_EDGE_BEFORE}${m}(?=\\S)([^\\n]*?\\S)${m}${FORMAT_EDGE_AFTER}`, 'g'),
    tag,
  };
}
const FORMAT_INLINE_RULES = [
  formatInlineRule('*', 'strong'),
  formatInlineRule('_', 'em'),
  formatInlineRule('~', 's'),
];

/* Trailing punctuation belongs to the sentence, not the address — and so does
   a closing bracket that nothing in the link opened. */
function trimLinkTail(raw) {
  let link = raw;
  let tail = '';
  for (;;) {
    const last = link.slice(-1);
    if (/[.,;:!?؟،]/.test(last)) {
      tail = last + tail; link = link.slice(0, -1); continue;
    }
    if (last === ')' && (link.match(/\(/g) || []).length < (link.match(/\)/g) || []).length) {
      tail = last + tail; link = link.slice(0, -1); continue;
    }
    /* An escaped entity cut in half is not a link character either. */
    const entity = link.match(/&(?:amp|lt|gt|quot|#39);?$/);
    if (entity && !entity[0].endsWith(';')) {
      tail = entity[0] + tail; link = link.slice(0, -entity[0].length); continue;
    }
    break;
  }
  return { link, tail };
}

function linkHtml(escapedLink) {
  /* The escaped form is what goes into href, and the browser decodes the
     entities when it reads the attribute — so &amp; arrives as &. */
  let label = escapedLink;
  try {
    const decoded = escapedLink.replace(/&amp;/g, '&');
    const parsed = new URL(decoded);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return escapedLink;
  } catch (_error) {
    return escapedLink;
  }
  if (label.length > 80) label = `${label.slice(0, 77)}…`;
  return `<a class="chat-msg-link" href="${escapedLink}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
}

/* `decorate` runs over the formatted html before the held pieces come back —
   where the mention decorator belongs, so an @ inside a link or a code span
   is never turned into a mention. */
function formatMessageHtml(escaped, { decorate = null, links = true } = {}) {
  const source = String(escaped || '');
  if (!source) return '';
  const held = [];
  const hold = (html) => {
    held.push(html);
    return `${FORMAT_HOLD}${held.length - 1}${FORMAT_HOLD}`;
  };
  let html = source.replace(new RegExp(FORMAT_HOLD, 'g'), '');
  html = html.replace(/```\n?([\s\S]+?)\n?```/g, (_m, code) => hold(`<pre class="chat-msg-pre"><code>${code}</code></pre>`));
  html = html.replace(/`([^`\n]+)`/g, (_m, code) => hold(`<code class="chat-msg-code">${code}</code>`));
  if (links) {
    html = html.replace(FORMAT_LINK, (raw) => {
      const { link, tail } = trimLinkTail(raw);
      return hold(linkHtml(link)) + tail;
    });
  }
  html = html.replace(/\|\|(?=\S)([\s\S]*?\S)\|\|/g, (_m, inner) => `<span class="chat-spoiler" role="button" tabindex="0" aria-label="${app().escapeHTML(t('متن پنهان — برای دیدن بزنید', 'Spoiler — tap to reveal'))}">${inner}</span>`);
  for (const rule of FORMAT_INLINE_RULES) {
    html = html.replace(rule.pattern, (_m, before, inner) => `${before}<${rule.tag}>${inner}</${rule.tag}>`);
  }
  if (typeof decorate === 'function') html = decorate(html);
  return html.replace(new RegExp(`${FORMAT_HOLD}(\\d+)${FORMAT_HOLD}`, 'g'), (_m, index) => held[Number(index)] || '');
}

/* The same text without its markers, for every surface that shows a line of
   it outside the thread: the chat list, a notification, a reply quote. A
   spoiler stays hidden there — those are the surfaces somebody else reads
   over a shoulder. */
function plainMessageText(text) {
  let out = String(text || '');
  if (!out) return '';
  out = out.replace(/```\n?([\s\S]+?)\n?```/g, '$1');
  out = out.replace(/`([^`\n]+)`/g, '$1');
  out = out.replace(/\|\|(?=\S)([\s\S]*?\S)\|\|/g, (_m, inner) => '▒'.repeat(Math.min(8, Math.max(3, inner.length))));
  /* Raw text, so a quotation mark is itself here rather than &quot;. */
  const before = FORMAT_EDGE_BEFORE.replace('[', '["\'');
  const after = FORMAT_EDGE_AFTER.replace('[', '["\'');
  for (const marker of ['\\*', '_', '~']) {
    out = out.replace(new RegExp(`${before}${marker}(?=\\S)([^\\n]*?\\S)${marker}${after}`, 'g'), '$1$2');
  }
  return out;
}

/* ---- composing ------------------------------------------------------------ */

/* The order markers nest in, outermost first. The renderer turns *, _ and ~
   into tags in that order, and each needs a word edge outside it, so a bold
   around an italic renders and an italic around a bold does not. Spoilers and
   code need no edge and go innermost. Writing every layer back in this order
   is what lets "bold, then italic" from the bar always come out formatted. */
const FORMAT_NEST_ORDER = ['*', '_', '~', '||', '`'];
/* Longest first, so ``` is never read as three inline code marks. */
const FORMAT_PEEL_ORDER = ['```', '||', '*', '_', '~', '`'];
const FORMAT_BOUNDED = new Set(['*', '_', '~']);
const FORMAT_MARK_CHARS = '*_~|`';
/* The raw-text twins of FORMAT_EDGE_BEFORE/AFTER. Every character escapeHTML
   turns into an entity counts on both sides: the entity ends in `;` and
   starts with `&`, which is what the renderer's edges accept. */
const FORMAT_RAW_BEFORE = /[\s([{«;‘“<>"'&]/;
const FORMAT_RAW_AFTER = /[\s)\]}».,;:!?؟،’”<>"'&]/;
const FORMAT_WORD_STOP = /[\s([{«‘“)\]}».,;:!?؟،’”"'*_~|`]/;

function formatEdgeOk(value, index, before) {
  if (before ? index <= 0 : index >= value.length) return true;
  const ch = value[before ? index - 1 : index];
  return FORMAT_MARK_CHARS.includes(ch) || (before ? FORMAT_RAW_BEFORE : FORMAT_RAW_AFTER).test(ch);
}

/* Would this marker pair, at these positions, render? Only a pair that would
   is treated as formatting — so the underscores in snake_case_name are never
   offered as italics, nor removed as such. */
function formatPairOk(value, open, close, marker) {
  const inner = value.slice(open + marker.length, close);
  if (!inner) return false;
  if (marker === '```') return !inner.includes('```');
  if (marker === '`') return !/[`\n]/.test(inner);
  if (/^\s|\s$/.test(inner)) return false;
  if (marker !== '||' && (inner.includes('\n') || !formatEdgeOk(value, open, true) || !formatEdgeOk(value, close + marker.length, false))) return false;
  /* The renderer closes a pair at the first marker that can close it, so in
     "*one* and *two*" the outer stars are two pairs, not one. */
  for (let i = open + marker.length + 1; i < close; i += 1) {
    if (value.startsWith(marker, i) && /\S/.test(value[i - 1])
      && (marker === '||' || formatEdgeOk(value, i + marker.length, false))) return false;
  }
  return true;
}

/* A code block's fences usually sit on their own lines; the newline next to
   each fence belongs to the fence. `at` is where the fence would start (an
   opening one) or end (a closing one); `outside` reads it from the other
   side of that position. */
function blockFenceLength(value, at, opening, outside) {
  const ahead = opening !== outside;
  const fenced = (text) => (ahead ? value.startsWith(text, at) : at >= text.length && value.slice(at - text.length, at) === text);
  const withBreak = opening ? '```\n' : '\n```';
  if (fenced(withBreak)) return 4;
  return fenced('```') ? 3 : 0;
}

/* The layers of formatting around [start, end): markers the selection itself
   begins and ends with, then markers just outside it. Returns the bare text's
   range, the range including every layer, and the layers found. */
function peelFormatLayers(value, start, end) {
  let s = start;
  let e = end;
  const layers = new Set();
  for (let moved = true; moved;) {
    moved = false;
    const open = blockFenceLength(value, s, true, false);
    const close = open ? blockFenceLength(value, e, false, false) : 0;
    if (open && close && e - s > open + close) {
      layers.add('```'); s += open; e -= close; moved = true; continue;
    }
    for (const m of FORMAT_PEEL_ORDER) {
      if (m === '```') continue;
      const len = m.length;
      if (e - s > len * 2 && value.startsWith(m, s) && value.startsWith(m, e - len) && formatPairOk(value, s, e - len, m)) {
        layers.add(m); s += len; e -= len; moved = true; break;
      }
    }
  }
  let os = start;
  let oe = end;
  for (let moved = true; moved;) {
    moved = false;
    const open = blockFenceLength(value, os, true, true);
    const close = open ? blockFenceLength(value, oe, false, true) : 0;
    if (open && close) {
      layers.add('```'); os -= open; oe += close; moved = true; continue;
    }
    for (const m of FORMAT_PEEL_ORDER) {
      if (m === '```') continue;
      const len = m.length;
      if (os >= len && value.startsWith(m, os - len) && value.startsWith(m, oe) && formatPairOk(value, os - len, oe, m)) {
        layers.add(m); os -= len; oe += len; moved = true; break;
      }
    }
  }
  return { start: s, end: e, outerStart: os, outerEnd: oe, layers };
}

/* The same, looking past a selection that stops inside a word: "ell" in
   *hello* is in a bold word. With `growPlain` an unformatted part of a word
   grows to the whole word too, since *, _ and ~ only render on a word edge
   and "hel" in "hello" can only be made bold as "hello". */
function analyzeFormatSegment(value, start, end, growPlain) {
  const peeled = peelFormatLayers(value, start, end);
  if (peeled.layers.size) return peeled;
  let s = start;
  let e = end;
  while (s > 0 && !FORMAT_WORD_STOP.test(value[s - 1])) s -= 1;
  while (e < value.length && !FORMAT_WORD_STOP.test(value[e])) e += 1;
  if (s === start && e === end) return peeled;
  const grown = peelFormatLayers(value, s, e);
  return grown.layers.size || growPlain ? grown : peeled;
}

/* Removes every rendering pair of one marker from a piece of text, so making
   a range bold that already holds a bold word gives one bold range rather
   than markers that cancel each other out. */
function stripMarkerPairs(text, marker) {
  let out = text;
  if (marker === '```') return out.replace(/```\n?([\s\S]+?)\n?```/g, '$1');
  if (marker === '`') return out.replace(/`([^`\n]+)`/g, '$1');
  if (marker === '||') return out.replace(/\|\|(?=\S)([\s\S]*?\S)\|\|/g, '$1');
  const m = `\\${marker}`;
  const edgeBefore = '(^|[\\s([{«;‘“<>"\'&*_~|`])';
  const edgeAfter = '(?=$|[\\s)\\]}».,;:!?؟،’”<>"\'&*_~|`])';
  const pattern = new RegExp(`${edgeBefore}${m}(?=\\S)([^\\n]*?\\S)${m}${edgeAfter}`, 'g');
  for (let i = 0; i < 4; i += 1) {
    const next = out.replace(pattern, '$1$2');
    if (next === out) break;
    out = next;
  }
  return out;
}
function stripAllFormatting(text) {
  let out = text;
  for (const marker of FORMAT_PEEL_ORDER) out = stripMarkerPairs(out, marker);
  return out;
}

function wrapFormatLayers(inner, layers) {
  let open = '';
  let close = '';
  for (const m of FORMAT_NEST_ORDER) {
    if (layers.has(m)) { open += m; close = m + close; }
  }
  if (layers.has('```')) { open = `\`\`\`\n${open}`; close = `${close}\n\`\`\``; }
  return { text: open + inner + close, innerOffset: open.length };
}

/* The pieces of a selection that formatting applies to: the selection itself
   with its outer spaces trimmed off, or — across lines — each line's own
   trimmed piece, since *, _ and ~ never span a line break. A code block is
   the one format that wants the lines whole. */
function formatSegments(value, start, end, wholeBlock) {
  const trim = (s, e) => {
    while (s < e && /\s/.test(value[s])) s += 1;
    while (e > s && /\s/.test(value[e - 1])) e -= 1;
    return s < e ? [s, e] : null;
  };
  const text = value.slice(start, end);
  if (wholeBlock || !text.includes('\n')) {
    const one = trim(start, end);
    return one ? [one] : [];
  }
  const segments = [];
  let lineStart = start;
  for (const line of text.split('\n')) {
    const piece = trim(lineStart, lineStart + line.length);
    if (piece) segments.push(piece);
    lineStart += line.length + 1;
  }
  return segments;
}

/* What the bar shows: which formats every piece of the selection carries. */
function composerFormatState(value, start, end) {
  const state = { active: new Set(), any: false, multiline: value.slice(start, end).includes('\n') };
  if (start === end) return state;
  const block = peelFormatLayers(value, start, end);
  if (block.layers.has('```')) {
    state.active.add('`');
    state.any = true;
    return state;
  }
  const segments = formatSegments(value, start, end, false).map(([s, e]) => analyzeFormatSegment(value, s, e, false));
  if (!segments.length) return state;
  for (const m of FORMAT_NEST_ORDER) {
    if (segments.every((seg) => seg.layers.has(m))) state.active.add(m);
  }
  state.any = segments.some((seg) => seg.layers.size > 0 || stripAllFormatting(value.slice(seg.start, seg.end)) !== value.slice(seg.start, seg.end));
  return state;
}

/* The edit a format button makes: a single replacement over the whole touched
   range, so one undo puts it back, and the selection to leave behind. Returns
   null when there is nothing to do. */
function composerFormatEdit(value, start, end, marker) {
  if (start === end) {
    if (marker === 'clear') return null;
    return { from: start, to: end, text: marker + marker, selStart: start + marker.length, selEnd: start + marker.length };
  }
  const multiline = value.slice(start, end).includes('\n');
  const effective = marker === '`' && multiline ? '```' : marker;
  if (effective === '```' || (marker === 'clear' && peelFormatLayers(value, start, end).layers.has('```'))) {
    const [s0, e0] = formatSegments(value, start, end, true)[0] || [];
    if (s0 === undefined) return null;
    const seg = peelFormatLayers(value, s0, e0);
    const inner = value.slice(seg.start, seg.end);
    let layers;
    if (marker === 'clear') layers = new Set();
    else if (seg.layers.has('```')) layers = new Set([...seg.layers].filter((m) => m !== '```'));
    else layers = new Set([...seg.layers, '```']);
    const body = marker === 'clear' ? stripAllFormatting(inner) : inner;
    const wrapped = wrapFormatLayers(body, layers);
    return { from: seg.outerStart, to: seg.outerEnd, text: wrapped.text,
      selStart: seg.outerStart + wrapped.innerOffset, selEnd: seg.outerStart + wrapped.innerOffset + body.length };
  }
  const raw = formatSegments(value, start, end, false);
  if (!raw.length) return null;
  let segments = raw.map(([s, e]) => analyzeFormatSegment(value, s, e, false));
  const allHave = marker !== 'clear' && segments.every((seg) => seg.layers.has(marker));
  const adding = marker !== 'clear' && !allHave;
  if (adding && FORMAT_BOUNDED.has(marker)) {
    segments = segments.map((seg, i) => (seg.layers.size ? seg : analyzeFormatSegment(value, raw[i][0], raw[i][1], true)));
  }
  const edits = segments.map((seg) => {
    const inner = value.slice(seg.start, seg.end);
    const layers = new Set(seg.layers);
    let body = inner;
    if (marker === 'clear') { layers.clear(); body = stripAllFormatting(inner); }
    else if (adding) { layers.add(marker); body = stripMarkerPairs(inner, marker); }
    else layers.delete(marker);
    const wrapped = wrapFormatLayers(body, layers);
    return { from: seg.outerStart, to: seg.outerEnd, wrapped, body };
  });
  const from = edits[0].from;
  const to = edits[edits.length - 1].to;
  let text = '';
  let cursor = from;
  for (const edit of edits) {
    text += value.slice(cursor, edit.from) + edit.wrapped.text;
    cursor = edit.to;
  }
  text += value.slice(cursor, to);
  if (text === value.slice(from, to)) return null;
  if (edits.length === 1) {
    const only = edits[0];
    return { from, to, text, selStart: from + only.wrapped.innerOffset, selEnd: from + only.wrapped.innerOffset + only.body.length };
  }
  return { from, to, text, selStart: from, selEnd: from + text.length };
}

/* Puts an edit into the composer through the editing command where there is
   one, so the phone's and the browser's own undo still work and the input
   event fires as if typed; plain assignment is the fallback. */
function applyComposerEdit(box, edit) {
  const expected = box.value.slice(0, edit.from) + edit.text + box.value.slice(edit.to);
  box.focus({ preventScroll: true });
  box.setSelectionRange(edit.from, edit.to);
  let inserted = false;
  try { inserted = document.execCommand('insertText', false, edit.text); } catch (_error) { inserted = false; }
  if (!inserted || box.value !== expected) {
    box.value = expected;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
  box.setSelectionRange(edit.selStart, edit.selEnd);
}

/* Formats the selection, or toggles the format off when every piece of the
   selection already carries it. With only a caret, an empty marker pair is
   put down and the caret goes between its halves. */
function toggleComposerFormat(marker) {
  const box = document.getElementById('chatComposer');
  if (!box || box.disabled || box.readOnly) return false;
  const start = box.selectionStart ?? box.value.length;
  const end = box.selectionEnd ?? start;
  const edit = composerFormatEdit(box.value, start, end, marker);
  if (!edit) return false;
  applyComposerEdit(box, edit);
  syncFormatBar(true);
  return true;
}
/* The name the keyboard shortcuts were wired to before the bar existed. */
function wrapComposerSelection(marker) {
  return toggleComposerFormat(marker);
}

const FORMAT_SHORTCUTS = {
  b: '*', i: '_', 'shift+x': '~', 'shift+m': '`', 'shift+p': '||',
};
document.getElementById('chatComposer')?.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = `${event.shiftKey ? 'shift+' : ''}${String(event.key || '').toLowerCase()}`;
  const marker = FORMAT_SHORTCUTS[key];
  if (!marker) return;
  event.preventDefault();
  toggleComposerFormat(marker);
});

/* ---- the formatting bar ---------------------------------------------------- */

/* A phone has no Ctrl key, so the same markers are a tap away whenever text
   in the composer is selected. Where the bar goes is decided by the phone's
   own copy-and-paste menu, which iOS and Android open just above the
   selection or, when they choose, just below it — never over the selected
   text itself, and never further than its own height away. Measured on an
   iPhone: about 44px of menu plus the selection handle, 60px in all; the
   clearance below adds room for a larger system text size, which makes the
   menu taller. So the bar floats above the input and keeps that much clear
   above the first selected line: a menu that opens above lands in the gap,
   and one that opens below is nowhere near. A bar below the input was covered by the second
   kind; one right on top of the input, by the first. */
const FORMAT_LABELS = {
  '*': ['پررنگ', 'Bold', 'B'],
  _: ['کج', 'Italic', 'I'],
  '~': ['خط‌خورده', 'Strikethrough', 'Shift+X'],
  '`': ['کد', 'Code', 'Shift+M'],
  '||': ['متن پنهان', 'Spoiler', 'Shift+P'],
  clear: ['حذف قالب', 'Clear formatting', ''],
};
const formatBarState = { pointerDown: false, timer: 0, hideTimer: 0, watch: 0, last: null };
const FORMAT_MENU_CLEARANCE = 76;
const FORMAT_BAR_GAP = 8;

function formatShortcutLabel(key) {
  if (!key) return '';
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  return `${mac ? '⌘' : 'Ctrl+'}${key.replace('Shift+', mac ? '⇧' : 'Shift+')}`;
}
function labelFormatBar(bar) {
  const touch = window.matchMedia?.('(pointer: coarse)')?.matches;
  bar.setAttribute('aria-label', t('قالب‌بندی متن', 'Text formatting'));
  bar.querySelectorAll('[data-format]').forEach((button) => {
    const [fa, en, key] = FORMAT_LABELS[button.dataset.format] || [];
    if (!fa) return;
    const name = t(fa, en);
    button.setAttribute('aria-label', name);
    button.title = touch || !key ? name : `${name} (${formatShortcutLabel(key)})`;
  });
}

/* The top of the line the selection starts on, in viewport pixels. A
   textarea does not say where its text is, so a hidden copy with the same
   box and font is laid out up to the selection and measured. */
function selectionLineTop(box) {
  const style = getComputedStyle(box);
  const mirror = document.createElement('div');
  ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'wordSpacing',
    'lineHeight', 'textTransform', 'textIndent', 'direction', 'tabSize'].forEach((prop) => { mirror.style[prop] = style[prop]; });
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', height: 'auto', overflow: 'hidden',
  });
  const start = box.selectionStart ?? 0;
  mirror.textContent = box.value.slice(0, start);
  const mark = document.createElement('span');
  mark.textContent = box.value.slice(start, start + 1) || '.';
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const offset = mark.offsetTop + (parseFloat(style.borderTopWidth) || 0);
  mirror.remove();
  return box.getBoundingClientRect().top + offset - box.scrollTop;
}

/* Places the bar above the input. With a fine pointer there is no system
   menu to clear and the bar sits just above the input. On a touch screen it
   keeps FORMAT_MENU_CLEARANCE clear above the selection's first line — less
   when that line is low in a tall input, since the menu then opens inside the
   input. It never climbs past the top of the messages. The bar is not inside
   the composer (see index.html), so it is positioned from the input's rect
   against its own offset parent; it follows the input on every sync. */
function positionFormatBar(bar, box) {
  const surface = box.closest('.chat-composer-surface') || box;
  const parent = bar.offsetParent;
  if (!parent) return;
  const input = surface.getBoundingClientRect();
  let lift = FORMAT_BAR_GAP;
  if (window.matchMedia?.('(pointer: coarse)')?.matches) {
    lift = Math.max(FORMAT_BAR_GAP, FORMAT_MENU_CLEARANCE - (selectionLineTop(box) - input.top));
  }
  const height = bar.offsetHeight || 48;
  const pane = document.getElementById('chatMessages')?.getBoundingClientRect();
  if (pane && pane.height > 0) {
    lift = Math.max(FORMAT_BAR_GAP, Math.min(lift, input.top - pane.top - height - 4));
  }
  const wide = window.matchMedia?.('(min-width: 768px)')?.matches;
  bar.style.width = wide ? '' : `${Math.round(input.width)}px`;
  const width = wide ? bar.offsetWidth : input.width;
  const rtl = getComputedStyle(surface).direction === 'rtl';
  const origin = parent.getBoundingClientRect();
  const left = (rtl ? input.right - width : input.left) - origin.left - parent.clientLeft + parent.scrollLeft;
  const top = input.top - lift - height - origin.top - parent.clientTop + parent.scrollTop;
  bar.style.left = `${Math.round(left)}px`;
  bar.style.top = `${Math.round(top)}px`;
}

function setFormatBarVisible(bar, show) {
  if (bar.classList.contains('hidden') === !show) return;
  bar.classList.toggle('hidden', !show);
  if (show) {
    labelFormatBar(bar);
    const box = document.getElementById('chatComposer');
    if (box) positionFormatBar(bar, box);
  }
  /* Sending, switching conversation or restoring a draft all rewrite the
     composer without an event the bar hears, so while it is up it checks the
     selection it belongs to is still there. */
  window.clearInterval(formatBarState.watch);
  formatBarState.watch = show ? window.setInterval(() => syncFormatBar(true), 300) : 0;
}

/* `now` skips the settle delay. Showing waits for the selection to stop
   moving — a phone's selection handles move it continuously, and the system
   menu only settles where it will stay once they stop. Hiding, and following
   a selection the bar is already up for, happen at once. */
function syncFormatBar(now = false) {
  const bar = document.getElementById('chatFormatBar');
  const box = document.getElementById('chatComposer');
  if (!bar || !box) return;
  window.clearTimeout(formatBarState.timer);
  const start = box.selectionStart ?? 0;
  const end = box.selectionEnd ?? start;
  const focused = document.activeElement === box;
  const selected = focused && end > start && /\S/.test(box.value.slice(start, end)) && !box.disabled && !box.readOnly;
  if (!selected) {
    setFormatBarVisible(bar, false);
    return;
  }
  formatBarState.last = { start, end, value: box.value };
  const state = composerFormatState(box.value, start, end);
  bar.querySelectorAll('[data-format]').forEach((button) => {
    const marker = button.dataset.format;
    if (marker === 'clear') {
      button.disabled = !state.any;
    } else {
      button.setAttribute('aria-pressed', state.active.has(marker) ? 'true' : 'false');
    }
  });
  if (!bar.classList.contains('hidden')) {
    positionFormatBar(bar, box);
    return;
  }
  if (now) {
    setFormatBarVisible(bar, true);
    return;
  }
  formatBarState.timer = window.setTimeout(() => {
    if (formatBarState.pointerDown) return;
    syncFormatBar(true);
  }, 260);
}

(() => {
  const bar = document.getElementById('chatFormatBar');
  const box = document.getElementById('chatComposer');
  if (!bar || !box) return;
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === box) syncFormatBar();
  });
  box.addEventListener('select', () => syncFormatBar());
  box.addEventListener('input', () => syncFormatBar());
  box.addEventListener('pointerdown', () => { formatBarState.pointerDown = true; });
  const released = () => {
    if (!formatBarState.pointerDown) return;
    formatBarState.pointerDown = false;
    syncFormatBar();
  };
  window.addEventListener('pointerup', released, true);
  window.addEventListener('pointercancel', released, true);
  box.addEventListener('focus', () => window.clearTimeout(formatBarState.hideTimer));
  box.addEventListener('blur', () => {
    window.clearTimeout(formatBarState.hideTimer);
    formatBarState.hideTimer = window.setTimeout(() => {
      if (document.activeElement !== box) setFormatBarVisible(bar, false);
    }, 150);
  });
  /* Cancelling pointer-down keeps focus in the input, so the keys stay up
     and the selection stays — the same courtesy the composer's own buttons
     get from the footer, which the bar is not inside. Should a phone drop the
     selection anyway, the one the bar was showing for is put back before the
     format is applied. */
  bar.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
  });
  bar.addEventListener('mousedown', (event) => event.preventDefault());
  bar.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-format]');
    if (!button || button.disabled) return;
    event.preventDefault();
    const last = formatBarState.last;
    if (last && box.selectionStart === box.selectionEnd && last.value === box.value) {
      box.focus({ preventScroll: true });
      box.setSelectionRange(last.start, last.end);
    }
    toggleComposerFormat(button.dataset.format);
  });
  /* Arrow keys move between the buttons, as in any toolbar. */
  bar.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Escape') return;
    if (event.key === 'Escape') { box.focus(); return; }
    const buttons = [...bar.querySelectorAll('[data-format]:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const rtl = getComputedStyle(bar).direction === 'rtl';
    const step = (event.key === 'ArrowRight') !== rtl ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length].focus();
    event.preventDefault();
  });
})();

/* ---- reading -------------------------------------------------------------- */

function revealSpoiler(node) {
  if (!node || node.classList.contains('is-revealed')) return false;
  node.classList.add('is-revealed');
  node.removeAttribute('role');
  node.removeAttribute('tabindex');
  return true;
}
/* Capture phase: a tap on a spoiler is a reveal, not the start of a swipe
   or a press on the bubble behind it. */
document.getElementById('chatMessages')?.addEventListener('click', (event) => {
  const spoiler = event.target.closest?.('.chat-spoiler');
  if (spoiler && revealSpoiler(spoiler)) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);
document.getElementById('chatMessages')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const spoiler = event.target.closest?.('.chat-spoiler');
  if (spoiler && revealSpoiler(spoiler)) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

window.formatMessageHtml = formatMessageHtml;
window.plainMessageText = plainMessageText;
window.toggleComposerFormat = toggleComposerFormat;
