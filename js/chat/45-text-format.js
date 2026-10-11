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

/* Wraps the selection (or the caret) in a marker pair. The composer is a
   textarea, so this is string surgery plus an input event — the draft store
   and the height sync both listen for that. */
function wrapComposerSelection(marker) {
  const box = document.getElementById('chatComposer');
  if (!box) return;
  const start = box.selectionStart ?? box.value.length;
  const end = box.selectionEnd ?? start;
  const value = box.value;
  const selected = value.slice(start, end);
  const already = selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2;
  const replacement = already ? selected.slice(marker.length, selected.length - marker.length) : `${marker}${selected}${marker}`;
  box.value = value.slice(0, start) + replacement + value.slice(end);
  if (selected) {
    box.selectionStart = start;
    box.selectionEnd = start + replacement.length;
  } else {
    box.selectionStart = box.selectionEnd = start + marker.length;
  }
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.focus();
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
  wrapComposerSelection(marker);
});

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
