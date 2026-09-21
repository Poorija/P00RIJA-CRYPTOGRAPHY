/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 8 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   The full search surface: an engine, a popup, a preview, and a jump.
*/

/* ---------------- 1. the engine -----------------------------------------
 *
 * The old search lowercased the whole query and ran one .includes() over
 * each message — three separate failure modes, each of which users met:
 * a phrase with an extra space found nothing; Persian text typed with the
 * Arabic ي/ك found nothing against Persian ی/ک; and any ZWNJ (the half-space
 * U+200C that Persian compound words are full of) made the whole query miss.
 *
 * The engine now normalizes both sides (character folds, digit folds, ZWNJ
 * out, whitespace collapsed), splits the query into tokens, and requires
 * every token to be present — AND across words, substring inside a word —
 * then scores: token coverage, a bonus when the whole phrase appears, and a
 * bonus for title matches. Highlighting walks the ORIGINAL text with a
 * normalized index map, so the <mark> lands on the real characters even
 * though the match was made on folded ones. */
const FSEARCH_CHAR_FOLDS = { 'ي': 'ی', 'ك': 'ک', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ی', 'ۀ': 'ه', 'ﺁ': 'ا' };
const FSEARCH_DIGIT_FOLDS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
function fsearchNormalize(text) {
let out = '';
const raw = String(text || '').toLowerCase();
for (const ch of raw) {
if (ch === '\u200c' || ch === '\u200f' || ch === '\u200e' || ch === 'ـ') continue;
if (FSEARCH_CHAR_FOLDS[ch]) { out += FSEARCH_CHAR_FOLDS[ch]; continue; }
if (FSEARCH_DIGIT_FOLDS[ch]) { out += FSEARCH_DIGIT_FOLDS[ch]; continue; }
out += ch;
}
return out.replace(/[\s\u00a0]+/g, ' ').trim();
}
function fsearchTokens(query) {
return fsearchNormalize(query).split(' ').filter(Boolean);
}
/* haystack must already be normalized; every token AND-substring. */
function fsearchMatchScore(haystack, tokens, phrase) {
if (!haystack || !tokens.length) return 0;
let score = 0;
for (const token of tokens) {
if (!haystack.includes(token)) return 0;
score += token.length >= 3 ? 3 : 1;
}
if (phrase && phrase.length > 2 && haystack.includes(phrase)) score += 6;
return score;
}
/* Walk the original text; mark every span whose normalized form contains a
   token. Returns escaped HTML — safe to inject. */
function fsearchHighlight(text, tokens, radius = 64) {
const raw = String(text || '').replace(/\s+/g, ' ').trim();
if (!raw) return '';
const marks = [];
let norm = '';
const map = [];
for (let i = 0; i < raw.length; i++) {
const folded = fsearchNormalize(raw[i]);
if (!folded) continue;
for (let k = 0; k < folded.length; k++) { norm += folded[k]; map.push(i); }
}
if (tokens.length) {
for (let start = 0; start < norm.length; start++) {
for (const token of tokens) {
if (norm.startsWith(token, start)) {
marks.push([map[start], map[start + token.length - 1] + 1]);
start += token.length - 1;
break;
}
}
}
}
if (!marks.length) {
const esc = app().escapeHTML(raw);
return esc.length > radius * 2 ? `${esc.slice(0, radius * 2)}…` : esc;
}
/* Snippet window around the first mark, then wrap every mark inside it. */
const from = Math.max(0, marks[0][0] - radius);
const to = Math.min(raw.length, marks[marks.length - 1][1] + radius);
let html = '';
let cursor = from;
for (const [a, b] of marks) {
if (b <= from || a >= to) continue;
const s = Math.max(a, from);
const e = Math.min(b, to);
if (s > cursor) html += app().escapeHTML(raw.slice(cursor, s));
html += `<mark>${app().escapeHTML(raw.slice(s, e))}</mark>`;
cursor = e;
}
if (cursor < to) html += app().escapeHTML(raw.slice(cursor, to));
return `${from > 0 ? '…' : ''}${html}${to < raw.length ? '…' : ''}`;
}
const FSEARCH_MEDIA_TYPES = new Set(['file', 'voice', 'sticker', 'rich', 'image', 'video']);
function fsearchEntryIsMedia(entry) {
return FSEARCH_MEDIA_TYPES.has(String(entry?.type || ''));
}
function fsearchEntryLabel(entry) {
if (entry?.type === 'voice') return t('پیام صوتی', 'Voice message');
if (entry?.type === 'file') return entry.name || t('فایل', 'File');
if (entry?.type === 'sticker') return t('استیکر', 'Sticker');
if (entry?.type === 'rich') return richEntryLabel(entry);
if (entry?.type === 'call-log') return callHistoryText(entry);
return entry?.text || '';
}
/* ---------------- 2. the query ---------------------------------------- */
const FSEARCH_STATE = {
open: false,
/* A search session lives until its ✕ is pressed. A jump hides the popup but
   keeps the session — coming back to the chat list reopens it with the same
   results, because the person is usually mid-way through a list of hits.
   Only closeFullSearch() — the ✕, the backdrop, Escape — ends it, wipes the
   query and filters, clears the thread's search mode and puts every chat,
   call and group back on the screen. */
live: false,
/* True between "a jump hid the popup" and the next open/close — the
   setChatView hook must reopen the results when the user COMES BACK to
   chats, but must not fight the jump that just hid them. */
hiddenByJump: false,
/* Held only across the jump's own setChatView, so the reopen hook can
   tell the jump's navigation apart from the user coming back later. */
jumpNavigating: false,
query: '',
kind: 'all',      // all | messages | media | contacts | calls
direction: 'all', // all | in | out   (messages only)
dateRange: 'all', // all | today | 7d | 30d
sort: 'relevance',// relevance | newest | oldest | conversation
chatKey: '',      // '' = every conversation; set = scoped to that one chat
selected: -1,
results: [],
};
function fsearchDateOk(createdAt) {
if (FSEARCH_STATE.dateRange === 'all') return true;
const ts = Date.parse(createdAt || '');
if (!ts) return FSEARCH_STATE.dateRange === 'all';
const days = FSEARCH_STATE.dateRange === 'today' ? 1 : FSEARCH_STATE.dateRange === '7d' ? 7 : 30;
return Date.now() - ts <= days * 86400000;
}
function runChatSearch(query = FSEARCH_STATE.query) {
const tokens = fsearchTokens(query);
const phrase = fsearchNormalize(query);
const wants = (kind) => FSEARCH_STATE.kind === 'all' || FSEARCH_STATE.kind === kind;
const hits = [];
const seenConversation = new Set();
if ((wants('messages') || wants('media')) && tokens.length) {
allConversationRecords().forEach((record) => {
const key = getConversationKey(record);
/* A locked conversation is closed to every reader, search included:
   quoting its lines into the results panel is exactly what the PIN is
   there to prevent. Contacts and the call log below still answer. */
if (typeof conversationLocked === 'function' && conversationLocked(key)) return;
if (FSEARCH_STATE.chatKey && key !== FSEARCH_STATE.chatKey) return;
const title = record.username || record.name || record.peerId || key;
const titleNorm = fsearchNormalize(title);
const history = chatState.history[key] || [];
/* A conversation whose very name matches is a result of its own — the
   thing the person is usually after when they type a name. */
if (wants('messages') && !FSEARCH_STATE.chatKey) {
const tScore = fsearchMatchScore(titleNorm, tokens, phrase);
if (tScore && !seenConversation.has(key)) {
seenConversation.add(key);
hits.push({ kind: 'conversation', conversationKey: key, conversationTitle: title, isGroup: record.type === 'group', score: tScore + 5, createdAt: history.at(-1)?.createdAt || '', snippetRaw: t(`${history.length} پیام`, `${history.length} messages`) });
}
}
history.forEach((entry) => {
if (entry.direction !== 'in' && entry.direction !== 'out') return;
if (isMessageHidden(entry)) return;
const isMedia = fsearchEntryIsMedia(entry);
if (FSEARCH_STATE.kind === 'messages' && isMedia) return;
if (FSEARCH_STATE.kind === 'media' && !isMedia) return;
if (FSEARCH_STATE.direction !== 'all' && entry.direction !== FSEARCH_STATE.direction) return;
if (!fsearchDateOk(entry.createdAt)) return;
const label = fsearchEntryLabel(entry);
const haystack = fsearchNormalize([label, entry.name, entry.type === 'text' ? '' : entry.text].filter(Boolean).join(' '));
const score = fsearchMatchScore(haystack, tokens, phrase);
if (!score) return;
hits.push({
kind: 'message',
conversationKey: key,
conversationTitle: title,
isGroup: record.type === 'group',
entryId: entry.id,
createdAt: entry.createdAt,
direction: entry.direction,
type: entry.type,
snippetRaw: label,
score,
});
});
});
}
if (wants('contacts') && tokens.length && !FSEARCH_STATE.chatKey) {
contactBookRecords().forEach((peer) => {
const title = peer.name || peer.username || peer.peerId;
const haystack = fsearchNormalize([peer.name, peer.username, peer.peerId, peer.fingerprint].filter(Boolean).join(' '));
const score = fsearchMatchScore(haystack, tokens, phrase);
if (!score || !fsearchDateOk(peer.lastSeenAt)) return;
hits.push({ kind: 'contact', conversationKey: getConversationKey(peer), conversationTitle: title, peerId: peer.peerId, createdAt: peer.lastSeenAt || '', snippetRaw: `${title} · ${peer.peerId}`, score });
});
}
if (wants('calls') && tokens.length && !FSEARCH_STATE.chatKey) {
(chatState.calls || []).forEach((call) => {
const title = call.name || call.peerId || '';
const modeLabel = call.mode === 'video' ? t('تماس تصویری', 'Video call') : t('تماس صوتی', 'Voice call');
const haystack = fsearchNormalize([title, call.peerId, formatCallStatus(call.status), modeLabel].join(' '));
const score = fsearchMatchScore(haystack, tokens, phrase);
if (!score || !fsearchDateOk(call.createdAt)) return;
hits.push({ kind: 'call', conversationKey: `call:${call.id}`, conversationTitle: title || t('تماس', 'Call'), callId: call.id, createdAt: call.createdAt, snippetRaw: `${modeLabel} · ${formatCallStatus(call.status)}${call.durationMs ? ` · ${formatDuration(call.durationMs)}` : ''}`, score });
});
}
/* Sorts. Relevance is the score; the dated sorts are what they say; the
   conversation sort groups by chat and orders the chats by their newest
   hit, which reads like Telegram's grouped results. */
if (FSEARCH_STATE.sort === 'newest') hits.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
else if (FSEARCH_STATE.sort === 'oldest') hits.sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
else if (FSEARCH_STATE.sort === 'conversation') {
const newest = new Map();
hits.forEach((hit) => {
const k = hit.conversationKey;
if (!newest.has(k) || Date.parse(hit.createdAt || 0) > newest.get(k)) newest.set(k, Date.parse(hit.createdAt || 0));
});
hits.sort((a, b) => (newest.get(b.conversationKey) || 0) - (newest.get(a.conversationKey) || 0) || String(a.conversationTitle).localeCompare(String(b.conversationTitle)));
} else hits.sort((a, b) => b.score - a.score || Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
return hits.slice(0, 200);
}
/* ---------------- 3. the popup ----------------------------------------- */
function fsearchOverlayNode() {
let node = document.getElementById('chatSearchOverlay');
if (node) return node;
node = document.createElement('div');
node.id = 'chatSearchOverlay';
node.className = 'chat-fsearch hidden';
node.innerHTML = `
<div class="chat-fsearch-backdrop" data-fsearch-close></div>
<div class="chat-fsearch-panel" role="dialog" aria-modal="true" aria-label="${app().escapeHTML(t('جستجو در همه‌جا', 'Search everywhere'))}">
  <div class="chat-fsearch-head">
    <i class="fas fa-magnifying-glass"></i>
    <input id="chatFsearchInput" type="search" autocomplete="off" spellcheck="false"
      placeholder="${app().escapeHTML(t('جستجو در چت‌ها، پیام‌ها، فایل‌ها، مخاطبین و تماس‌ها…', 'Search chats, messages, files, contacts and calls…'))}">
    <button type="button" class="chat-fsearch-close" data-fsearch-close aria-label="${app().escapeHTML(t('بستن', 'Close'))}"><i class="fas fa-xmark"></i></button>
  </div>
  <div class="chat-fsearch-toolbar">
    <div class="chat-fsearch-chips" id="chatFsearchKinds"></div>
    <div class="chat-fsearch-row">
      <div class="chat-fsearch-chips" id="chatFsearchDirs"></div>
      <select id="chatFsearchDate" class="chat-fsearch-select"></select>
      <select id="chatFsearchSort" class="chat-fsearch-select"></select>
      <select id="chatFsearchChat" class="chat-fsearch-select"></select>
    </div>
  </div>
  <div class="chat-fsearch-body">
    <div class="chat-fsearch-results" id="chatFsearchResults"></div>
    <div class="chat-fsearch-preview" id="chatFsearchPreview"></div>
  </div>
</div>`;
document.body.appendChild(node);
node.addEventListener('click', (event) => {
if (event.target.closest('[data-fsearch-close]')) { closeFullSearch(); return; }
const jump = event.target.closest('[data-fsearch-jump]');
if (jump) { fsearchJumpFromIndex(Number(jump.getAttribute('data-fsearch-jump'))); return; }
const hit = event.target.closest('[data-fsearch-idx]');
if (hit) { fsearchSelect(Number(hit.getAttribute('data-fsearch-idx'))); return; }
const chip = event.target.closest('[data-fsearch-chip]');
if (chip) {
const group = chip.getAttribute('data-fsearch-chip');
const value = chip.getAttribute('data-fsearch-value');
if (group === 'kind') FSEARCH_STATE.kind = value;
if (group === 'dir') FSEARCH_STATE.direction = value;
FSEARCH_STATE.selected = -1;
fsearchRefresh();
}
});
node.addEventListener('change', (event) => {
if (event.target.id === 'chatFsearchDate') { FSEARCH_STATE.dateRange = event.target.value; fsearchRefresh(); }
if (event.target.id === 'chatFsearchSort') { FSEARCH_STATE.sort = event.target.value; fsearchRefresh(); }
if (event.target.id === 'chatFsearchChat') { FSEARCH_STATE.chatKey = event.target.value; fsearchRefresh(); }
});
const input = node.querySelector('#chatFsearchInput');
let timer = 0;
input?.addEventListener('input', () => {
window.clearTimeout(timer);
timer = window.setTimeout(() => { FSEARCH_STATE.query = input.value; FSEARCH_STATE.selected = -1; fsearchRefresh(); }, 160);
});
input?.addEventListener('keydown', (event) => {
if (event.key === 'Enter' && FSEARCH_STATE.results.length) fsearchJumpFromIndex(0);
});
return node;
}
const FSEARCH_KIND_CHIPS = [
{ id: 'all', fa: 'همه', en: 'All', icon: 'fa-globe' },
{ id: 'messages', fa: 'پیام‌ها', en: 'Messages', icon: 'fa-comment-dots' },
{ id: 'media', fa: 'فایل و رسانه', en: 'Files & media', icon: 'fa-photo-film' },
{ id: 'contacts', fa: 'مخاطبین', en: 'Contacts', icon: 'fa-address-book' },
{ id: 'calls', fa: 'تماس‌ها', en: 'Calls', icon: 'fa-phone' },
];
const FSEARCH_DIR_CHIPS = [
{ id: 'all', fa: 'دو طرف', en: 'Both' },
{ id: 'in', fa: 'دریافتی', en: 'Received' },
{ id: 'out', fa: 'ارسالی', en: 'Sent' },
];
const FSEARCH_DATE_OPTIONS = [
{ id: 'all', fa: 'هر زمان', en: 'Any time' },
{ id: 'today', fa: 'امروز', en: 'Today' },
{ id: '7d', fa: '۷ روز اخیر', en: 'Last 7 days' },
{ id: '30d', fa: '۳۰ روز اخیر', en: 'Last 30 days' },
];
const FSEARCH_SORT_OPTIONS = [
{ id: 'relevance', fa: 'مرتبط‌ترین', en: 'Most relevant' },
{ id: 'newest', fa: 'جدیدترین', en: 'Newest' },
{ id: 'oldest', fa: 'قدیمی‌ترین', en: 'Oldest' },
{ id: 'conversation', fa: 'بر اساس گفتگو', en: 'By conversation' },
];
function fsearchChip(group, chip, active) {
return `<button type="button" class="chat-fsearch-chip${active ? ' is-active' : ''}" data-fsearch-chip="${group}" data-fsearch-value="${chip.id}">
${chip.icon ? `<i class="fas ${chip.icon}"></i>` : ''}<span>${app().escapeHTML(t(chip.fa, chip.en))}</span></button>`;
}
function fsearchRefresh() {
const node = fsearchOverlayNode();
const results = runChatSearch();
FSEARCH_STATE.results = results;
node.querySelector('#chatFsearchKinds').innerHTML = FSEARCH_KIND_CHIPS.map((chip) => fsearchChip('kind', chip, FSEARCH_STATE.kind === chip.id)).join('');
const dirWrap = node.querySelector('#chatFsearchDirs');
dirWrap.innerHTML = FSEARCH_DIR_CHIPS.map((chip) => fsearchChip('dir', chip, FSEARCH_STATE.direction === chip.id)).join('');
dirWrap.classList.toggle('hidden', !(FSEARCH_STATE.kind === 'all' || FSEARCH_STATE.kind === 'messages' || FSEARCH_STATE.kind === 'media'));
const dateSel = node.querySelector('#chatFsearchDate');
dateSel.innerHTML = FSEARCH_DATE_OPTIONS.map((option) => `<option value="${option.id}"${FSEARCH_STATE.dateRange === option.id ? ' selected' : ''}>${app().escapeHTML(t(option.fa, option.en))}</option>`).join('');
const sortSel = node.querySelector('#chatFsearchSort');
sortSel.innerHTML = FSEARCH_SORT_OPTIONS.map((option) => `<option value="${option.id}"${FSEARCH_STATE.sort === option.id ? ' selected' : ''}>${app().escapeHTML(t(option.fa, option.en))}</option>`).join('');
/* The conversation picker lists every searchable chat with its hit count,
   so "only in this one" is one tap instead of a guess. */
const chatSel = node.querySelector('#chatFsearchChat');
const counts = new Map();
results.forEach((hit) => counts.set(hit.conversationKey, (counts.get(hit.conversationKey) || 0) + 1));
const chatOptions = [`<option value="">${app().escapeHTML(t('همهٔ گفتگوها', 'All conversations'))}</option>`];
allConversationRecords().forEach((record) => {
const key = getConversationKey(record);
if (typeof conversationLocked === 'function' && conversationLocked(key)) return;
const title = record.username || record.name || record.peerId || key;
const n = counts.get(key);
chatOptions.push(`<option value="${app().escapeHTML(key)}"${FSEARCH_STATE.chatKey === key ? ' selected' : ''}>${app().escapeHTML(title)}${n ? ` (${n})` : ''}</option>`);
});
chatSel.innerHTML = chatOptions.join('');
const panel = node.querySelector('#chatFsearchResults');
const tokens = fsearchTokens(FSEARCH_STATE.query);
if (!tokens.length) {
panel.innerHTML = `<div class="chat-fsearch-hint"><i class="fas fa-keyboard"></i><p>${app().escapeHTML(t('حداقل یک کلمه بنویسید؛ جستجو پیام‌ها، فایل‌ها، نام مخاطبین و تماس‌ها را با هم می‌گردد.', 'Type at least one word; messages, files, contact names and calls are all searched together.'))}</p></div>`;
} else if (!results.length) {
panel.innerHTML = `<div class="chat-fsearch-hint"><i class="fas fa-face-frown"></i><p>${app().escapeHTML(t(`چیزی برای «${FSEARCH_STATE.query.trim()}» پیدا نشد. فیلترها را بردارید یا املای دیگری امتحان کنید.`, `Nothing found for "${FSEARCH_STATE.query.trim()}". Try clearing the filters or another spelling.`))}</p></div>`;
} else {
const icons = { message: 'fa-comment-dots', conversation: 'fa-comments', contact: 'fa-address-book', call: 'phone fa-phone' };
panel.innerHTML = `
<div class="chat-fsearch-count">${app().escapeHTML(t(`${results.length} نتیجه`, `${results.length} results`))}</div>
${results.map((hit, idx) => `
<button type="button" class="chat-fsearch-hit" data-fsearch-idx="${idx}">
  <span class="chat-fsearch-hit-kind"><i class="fas ${icons[hit.kind] || 'fa-comment-dots'}${hit.kind === 'conversation' ? '' : ''}"></i></span>
  <span class="chat-fsearch-hit-main">
    <span class="chat-fsearch-hit-title">${app().escapeHTML(hit.conversationTitle)}${hit.direction ? ` · ${app().escapeHTML(hit.direction === 'out' ? t('ارسالی', 'sent') : t('دریافتی', 'received'))}` : ''}</span>
    <span class="chat-fsearch-hit-snippet">${fsearchHighlight(hit.snippetRaw, tokens, 48)}</span>
  </span>
  <span class="chat-fsearch-hit-when">${hit.createdAt ? formatTime(hit.createdAt) : ''}</span>
</button>`).join('')}`;
}
fsearchRenderPreview();
}
function fsearchSelect(idx) {
FSEARCH_STATE.selected = idx;
fsearchOverlayNode().querySelectorAll('.chat-fsearch-hit').forEach((el) => {
el.classList.toggle('is-selected', Number(el.getAttribute('data-fsearch-idx')) === idx);
});
fsearchRenderPreview();
}
function fsearchRenderPreview() {
const pane = fsearchOverlayNode().querySelector('#chatFsearchPreview');
const idx = FSEARCH_STATE.selected;
const hit = FSEARCH_STATE.results[idx];
if (!pane || !hit) {
pane.classList.remove('has-content');
pane.innerHTML = `<div class="chat-fsearch-preview-empty">${app().escapeHTML(t('نتیجه‌ای را برای پیش‌نمایش انتخاب کنید.', 'Select a result to preview it.'))}</div>`;
return;
}
pane.classList.add('has-content');
const tokens = fsearchTokens(FSEARCH_STATE.query);
const kindLabel = hit.kind === 'message' ? t('پیام', 'Message') : hit.kind === 'conversation' ? t('گفتگو', 'Conversation') : hit.kind === 'contact' ? t('مخاطب', 'Contact') : t('تماس', 'Call');
let contextHtml = '';
if (hit.kind === 'message') {
/* One neighbour on each side: enough to know what conversation the line
   belongs in, not so much that the preview becomes the thread. */
const history = (chatState.history[hit.conversationKey] || []).filter((entry) => entry.direction === 'in' || entry.direction === 'out');
const at = history.findIndex((entry) => entry.id === hit.entryId);
const neighbours = [history[at - 1], history[at + 1]].filter(Boolean).filter((entry) => !isMessageHidden(entry));
contextHtml = neighbours.map((entry) => `
<div class="chat-fsearch-ctx is-${entry.direction}">
<span class="chat-fsearch-ctx-who">${app().escapeHTML(entry.direction === 'out' ? t('شما', 'You') : hit.conversationTitle)}</span>
<span class="chat-fsearch-ctx-text">${fsearchHighlight(fsearchEntryLabel(entry), [], 60)}</span>
</div>`).join('');
}
const jumpLabel = hit.kind === 'conversation' || hit.kind === 'message'
? t('رفتن به گفتگو', 'Go to conversation')
: hit.kind === 'contact' ? t('نمایش مخاطب', 'Show contact') : t('نمایش در تماس‌ها', 'Show in calls');
pane.innerHTML = `
<header class="chat-fsearch-preview-head">
<span class="chat-fsearch-preview-kind">${app().escapeHTML(kindLabel)}</span>
<strong>${app().escapeHTML(hit.conversationTitle)}</strong>
<time>${hit.createdAt ? formatTime(hit.createdAt) : ''}</time>
</header>
<div class="chat-fsearch-preview-bubble is-${hit.direction || 'in'}">
${fsearchHighlight(hit.snippetRaw, tokens, 400)}
</div>
${contextHtml ? `<div class="chat-fsearch-preview-ctx">${contextHtml}</div>` : ''}
<button type="button" class="chat-fsearch-jump" data-fsearch-jump="${idx}">
<i class="fas fa-arrow-right-to-bracket"></i><span>${app().escapeHTML(jumpLabel)}</span>
</button>`;
}
/* ---------------- 4. open / close -------------------------------------- */
function fsearchSyncLoupe() {
document.getElementById('chatSearchOpenBtn')?.classList.toggle('is-live', FSEARCH_STATE.live);
}
function openFullSearch(prefill = '') {
if (!vaultLockState().unlocked) { syncVaultLockUi(); return; }
const node = fsearchOverlayNode();
FSEARCH_STATE.open = true;
FSEARCH_STATE.live = true;
FSEARCH_STATE.hiddenByJump = false;
if (typeof prefill === 'string' && prefill.trim()) FSEARCH_STATE.query = prefill;
node.classList.remove('hidden');
document.documentElement.classList.add('chat-fsearch-open');
const input = node.querySelector('#chatFsearchInput');
input.value = FSEARCH_STATE.query;
fsearchRefresh();
fsearchSyncLoupe();
window.requestAnimationFrame(() => { input.focus(); input.select?.(); });
}
/* Scoped search: the thread menu's loupe. One conversation, nothing else —
   the chat picker is preselected to it and the contacts/calls sections do
   not run while a scope is set. Closing the popup clears the scope like it
   clears everything else. */
function openFullSearchInChat(conversationKey) {
FSEARCH_STATE.chatKey = String(conversationKey || '');
FSEARCH_STATE.selected = -1;
openFullSearch();
}
function closeFullSearch() {
const node = document.getElementById('chatSearchOverlay');
if (node) node.classList.add('hidden');
document.documentElement.classList.remove('chat-fsearch-open');
FSEARCH_STATE.open = false;
FSEARCH_STATE.live = false;
FSEARCH_STATE.hiddenByJump = false;
FSEARCH_STATE.query = '';
FSEARCH_STATE.kind = 'all';
FSEARCH_STATE.direction = 'all';
FSEARCH_STATE.dateRange = 'all';
FSEARCH_STATE.sort = 'relevance';
FSEARCH_STATE.chatKey = '';
FSEARCH_STATE.selected = -1;
FSEARCH_STATE.results = [];
fsearchSyncLoupe();
/* The one-swipe reset: whatever the jump left in search mode goes, and
   every chat, call and group is on the screen again exactly as the main
   page shows them. */
if (chatState.searchQuery) {
chatState.searchQuery = '';
try { renderPeers(); renderActivePeer(); renderMessages(); } catch (_error) { /* pane not built */ }
}
}
/* ---------------- 5. the jump -------------------------------------------
 *
 * Landing on the bubble is two problems: the thread only renders its newest
 * 80 messages, and the eye needs to find one bubble in a wall of them. The
 * first is solved with the machinery the in-thread search already uses — a
 * non-empty chatState.searchQuery makes renderMessages draw the whole
 * history — so the jump seeds it with the message's own exact text. The
 * second is the Telegram treatment: scroll the bubble to the centre and
 * draw a fading ring around it that outlives the scroll. */
function fsearchJumpFromIndex(idx) {
const hit = FSEARCH_STATE.results[idx];
if (!hit) return;
/* Hide, not close: the session stays live, so returning to the chat list
   reopens this same set of results. The ✕ is what ends a search. */
const node = document.getElementById('chatSearchOverlay');
if (node) node.classList.add('hidden');
document.documentElement.classList.remove('chat-fsearch-open');
FSEARCH_STATE.open = false;
FSEARCH_STATE.hiddenByJump = true;
if (hit.kind === 'contact') {
openContactConversation(hit.peerId);
return;
}
if (hit.kind === 'call') {
chatState.contactSearch = hit.conversationTitle || '';
setChatView('calls');
renderCalls();
return;
}
const record = allConversationRecords().find((item) => getConversationKey(item) === hit.conversationKey);
if (!record) return;
chatState.activeConversationId = hit.conversationKey;
chatState.activePeerClientId = record.clientId || '';
FSEARCH_STATE.jumpNavigating = true;
try {
setChatView(record.type === 'group' ? 'groups' : 'chats');
} finally {
FSEARCH_STATE.jumpNavigating = false;
}
renderPeers();
renderActivePeer();
if (hit.kind === 'message') {
const target = (chatState.history[hit.conversationKey] || []).find((entry) => entry.id === hit.entryId);
chatState.searchQuery = String(target?.text || fsearchEntryLabel(target) || '').trim().slice(0, 120);
} else {
chatState.searchQuery = '';
}
renderMessages();
window.setTimeout(() => {
const node = document.querySelector(`#chatMessages [data-id="${CSS.escape(hit.entryId || '')}"]`);
if (!node) return;
node.scrollIntoView({ block: 'center', behavior: 'smooth' });
node.classList.add('fsearch-ring');
window.setTimeout(() => node.classList.remove('fsearch-ring'), 3200);
}, 260);
}
/* Kept for the parts that still call it (deep links, tools). */
function globalSearch(query) {
const tokens = fsearchTokens(query);
if (!tokens.length) return [];
return runChatSearch(query);
}
function jumpToSearchHit(conversationKey, entryId) {
fsearchJumpFromIndex(FSEARCH_STATE.results.findIndex((hit) => hit.conversationKey === conversationKey && hit.entryId === entryId));
}

/* ---------------- 6. safety numbers -------------------------------------
   Two fingerprints hashed together give both sides the same short code.
   Reading five words aloud is something people will actually do; reading
   64 hex characters is not — and an unverified key is the one thing
   end-to-end encryption cannot protect you from. */
const SAFETY_WORDS = [
'آهو', 'باران', 'پرنده', 'ترانه', 'جنگل', 'چشمه', 'خورشید', 'دریا',
'رنگین', 'زیتون', 'ژاله', 'ستاره', 'شبنم', 'صنوبر', 'طوفان', 'عقاب',
'غنچه', 'فانوس', 'قایق', 'کوهسار', 'گندم', 'لاله', 'مهتاب', 'نسیم',
'واحه', 'هلال', 'یاقوت', 'ابریشم', 'بلور', 'پونه', 'تندر', 'جویبار',
];
async function safetyNumber(localFp, remoteFp) {
if (!localFp || !remoteFp) return null;
/* Sorted, so both devices hash the same string and land on the same code. */
const material = [String(localFp), String(remoteFp)].sort().join('|');
const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material)));
/* One BigInt over the whole digest, not six independent 16-bit draws: a
   16-bit bucket never reaches 100000, so no group could ever start with
   7, 8 or 9 — a visible bias for two people comparing the number aloud.
   Reading the digest as a single decimal and slicing it keeps every digit
   reachable and the total at thirty. */
const decimal = BigInt(`0x${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`)
.toString().padStart(30, '0');
const digits = [];
for (let i = 0; i < 30; i += 5) {
digits.push(decimal.slice(i, i + 5));
}
const words = [];
for (let i = 0; i < 5; i++) words.push(SAFETY_WORDS[digest[20 + i] % SAFETY_WORDS.length]);
return { digits, words };
}
