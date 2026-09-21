/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 27 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Keeping the reader's place across a re-render
*/

/* =====================================================================
   Keeping the reader's place across a re-render
   ---------------------------------------------------------------------
   renderMessages() rebuilds the whole thread and used to finish with
   scrollTop = scrollHeight, so anything that triggered a re-render -
   selecting a message, a reaction landing, media finishing its decrypt -
   threw the reader back down to the newest message. The thread should
   only jump to the bottom when there is a reason to: a different
   conversation, or a new message arriving while the reader was already
   down there.
   ===================================================================== */
const THREAD_BOTTOM_SLACK_PX = 80;

/* The topmost bubble still on screen, plus how far below the pane's top edge
   it sits. Anchoring on a real message survives bubbles being appended,
   trimmed off the top of the render window, or changing height as media
   loads - none of which a raw scrollTop would survive.
   Measured with offsetTop rather than getBoundingClientRect: bubbles animate
   in with a transform, and a rect read while that animation is still running
   would drag the thread along by however far it had left to travel. */
function captureThreadAnchor(panel) {
const top = panel.scrollTop;
const bubbles = panel.querySelectorAll('.chat-message-bubble[data-id]');
for (const bubble of bubbles) {
if (bubble.offsetTop + bubble.offsetHeight > top + 4) {
return { id: bubble.getAttribute('data-id'), offset: bubble.offsetTop - top };
}
}
return null;
}

function restoreThreadAnchor(panel, anchor) {
if (!anchor || !anchor.id) return false;
const node = panel.querySelector(`.chat-message-bubble[data-id="${CSS.escape(anchor.id)}"]`);
if (!node) return false;
const target = Math.max(0, node.offsetTop - anchor.offset);
if (Math.abs(target - panel.scrollTop) > 0.5) scrollThreadTo(panel, target);
return true;
}

/* The panel asks for scroll-behavior: smooth, which is wrong for every move this
   file makes. Putting the reader back where they were has to be invisible, and
   gliding to the newest message loses races: the glide takes about a second, a
   delivery receipt re-renders the thread halfway through, and the anchor logic
   then politely freezes the view wherever the animation had got to. */
function scrollThreadTo(panel, top) {
const previous = panel.style.scrollBehavior;
panel.style.scrollBehavior = 'auto';
panel.scrollTop = top;
panel.style.scrollBehavior = previous;
}

function renderMessages() {
pruneExpiredHistory();
const peer = getActiveConversation();
const directPeer = activePeer();
const panel = document.getElementById('chatMessages');
if (!panel) return;
/* The key-change alert is the panel's first child (it is sticky-pinned to the
   top of the scroller — see index.html). renderMessages rewrites the panel
   wholesale below, so the alert is lifted out first and put back after every
   write, early return included: its buttons keep their listeners because the
   element is moved, never destroyed. */
const keyAlertElement = document.getElementById('chatKeyAlert');
if (keyAlertElement && keyAlertElement.parentNode === panel) keyAlertElement.remove();
const restoreKeyAlert = () => {
if (keyAlertElement && !keyAlertElement.parentNode) panel.prepend(keyAlertElement);
};
if (isUnlocked() && unreadableChatStores.has(chatStorageAddress(CHAT_HISTORY_STORAGE_KEY))) {
panel.innerHTML = `<div class="chat-empty-state">${t('تاریخچه قابل خواندن نیست؛ داده‌های ذخیره‌شده حفظ شده‌اند. برنامه را دوباره باز کنید.', 'History could not be read; stored data was preserved. Reopen the app.')}</div>`;
restoreKeyAlert();
return;
}
if (!peer) {
chatState.threadRender = { conversationId: '', newestId: '' };
renderPinnedPanel(null, '', []);
panel.innerHTML = `<div class="chat-empty-state">${
chatState.activeView === 'groups'
? t('بعد از انتخاب یک گروه، تاریخچه همین‌جا نمایش داده می‌شود.', 'After you pick a group, its history shows here.')
: t('بعد از انتخاب یک گفتگو، تاریخچه همین‌جا نشان داده می‌شود.', 'Pick a conversation to view history here.')
}</div>`;
restoreKeyAlert();
return;
}
const conversationKey = getConversationKey(peer);
hydrateConversationMedia(conversationKey).catch((error) => console.warn('[Media] hydrate failed', error));
if (isConversationCurrentlyVisible(conversationKey)) {
markConversationRead(conversationKey);
}
/* A locked thread draws nothing of itself - not a preview, not the last
   line, not a count. The messages are on this device either way; what a lock
   buys is that they are not on the screen. */
if (conversationLocked(conversationKey)) {
  chatState.threadRender = { conversationId: conversationKey, newestId: '' };
  /* Asked after the card exists, because whether a fingerprint can be offered
     is a question about the device, not about the markup. */
  setTimeout(() => { try { syncLockBiometricButtons(); } catch (error) { /* not ready */ } }, 0);
  const minutes = Number(convoLocks()[conversationKey]?.autoLockMinutes || 0);
  panel.innerHTML = `
    <div class="chat-locked-thread">
      <i class="fas fa-lock"></i>
      <p>${app().escapeHTML(t('این گفتگو قفل است.', 'This conversation is locked.'))}</p>
      <div class="chat-lock-actions">
        <button type="button" data-unlock-conversation="${app().escapeHTML(conversationKey)}" class="chat-soft-btn">
          <i class="fas fa-unlock"></i> ${app().escapeHTML(t('باز کردن', 'Unlock'))}
        </button>
        <!-- Beside it, not below it: two ways through the same door. Shown only
             where the device actually has a platform authenticator; the class is
             removed by the check that runs after this renders. -->
        <button type="button" data-unlock-biometric="${app().escapeHTML(conversationKey)}" class="chat-soft-btn chat-lock-bio hidden">
          <i class="fas fa-fingerprint"></i> ${app().escapeHTML(t('بایومتریک', 'Biometric'))}
        </button>
      </div>
      <small>${app().escapeHTML(minutes > 0
        ? t(`پس از ${minutes} دقیقه بی‌استفاده ماندن دوباره قفل می‌شود.`, `It re-locks after ${minutes} minute(s) without use.`)
        : t('تا وقتی برنامه باز است باز می‌ماند.', 'It stays open while the app is.'))}</small>
      <small class="chat-locked-note">${app().escapeHTML(t(
        'این پیام‌ها همین حالا روی این دستگاه رمزگذاری شده‌اند. این رمز رمزنگاری تازه‌ای اضافه نمی‌کند — گفتگو را روی دستگاهی که باز است پنهان می‌کند.',
        'These messages are already encrypted on this device. This PIN adds no encryption - it hides the conversation on a device that is already unlocked.'))}</small>
    </div>`;
  restoreKeyAlert();
  return;
}
/* Reading it counts as using it, so a long conversation is not locked out
   from under the person reading it. */
touchConversationLock(conversationKey);
const history = (chatState.history[conversationKey] || []).filter((entry) => {
if (!entry.expiresAt) return true;
const expiry = Date.parse(entry.expiresAt);
return !isNaN(expiry) && expiry > Date.now();
});
renderPinnedPanel(peer, conversationKey, history);
if (!history.length) {
chatState.threadRender = { conversationId: conversationKey, newestId: '' };
panel.innerHTML = `<div class="chat-empty-state">${t('هنوز پیامی ردوبدل نشده است.', 'No messages exchanged yet.')}</div>`;
restoreKeyAlert();
return;
}
const myReactorId = currentReactorId();
const activeSearchQuery = chatState.searchQuery.trim().toLowerCase();
const renderHistory = activeSearchQuery ? history : history.slice(-CHAT_RENDER_WINDOW_SIZE);
const hiddenCount = Math.max(0, history.length - renderHistory.length);
const historyById = new Map(history.map((entry) => [entry.id, entry]));
const bubbleClass = (entry) => [
'chat-message-bubble',
/* Re-applied on every render from state, so a redraw does not close the
   toolbar somebody is in the middle of using. */
chatState.activeMessageId === entry.id ? 'selected' : '',
(!previousIds || !previousIds.has(entry.id)) ? 'is-fresh' : '',
(entry.direction === 'in' && messageMentionsLocalUser(entry)) ? 'mentions-me' : '',
entry.direction === 'out' ? 'me' : 'them',
entry.pinned ? 'pinned' : '',
entry.expiresAt ? 'expiring' : '',
entry.hidden ? 'hidden-message' : '',
isMessageHidden(entry) ? 'is-masked' : '',
messageMatchesSearch(entry, activeSearchQuery) ? 'search-hit' : '',
].filter(Boolean).join(' ');
const maskedBody = (id) => `<div class="chat-hidden-mask" data-chat-reveal="${app().escapeHTML(id)}" role="button" tabindex="0">
<i class="fas fa-eye-slash"></i>
<span>${app().escapeHTML(t('پیام مخفی — برای دیدن بزنید یا بکشید', 'Hidden message — tap or swipe to reveal'))}</span>
</div>`;
const olderNotice = hiddenCount
? `<div class="chat-history-window-note">${t(`${hiddenCount} پیام قدیمی‌تر برای سرعت بیشتر فعلاً رندر نشده است. برای پیدا کردن پیام‌های قدیمی از جستجو استفاده کنید.`, `${hiddenCount} older messages are not rendered for speed. Use search to find older messages.`)}</div>`
: '';
/* Work out where the thread should end up before the old DOM - and with it
   the reader's scroll position - is thrown away. */
const lastRender = chatState.threadRender || { conversationId: '', newestId: '' };
const newestEntry = history[history.length - 1];
const conversationChanged = lastRender.conversationId !== conversationKey;
const threadGrew = !conversationChanged && Boolean(lastRender.newestId) && lastRender.newestId !== newestEntry.id;
const wasAtBottom = (panel.scrollHeight - panel.scrollTop - panel.clientHeight) <= THREAD_BOTTOM_SLACK_PX;
const threadAnchor = conversationChanged ? null : captureThreadAnchor(panel);
const openingThread = conversationChanged || !lastRender.newestId;
/* Your own message always pulls the view down; someone else's only when you
   were already looking at the newest one. */
const stickToBottom = openingThread
|| (threadGrew && (wasAtBottom || newestEntry.direction === 'out'));
/* Only genuinely new bubbles get the entry animation. The thread is rebuilt
   wholesale on every render, so without this every message replayed its
   fade-and-rise each time anything changed - selecting one message made all
   of them twitch. */
const previousIds = conversationChanged ? null : lastRender.ids || null;
chatState.threadRender = { conversationId: conversationKey, newestId: newestEntry.id, ids: new Set(renderHistory.map((entry) => entry.id)) };
/* Message ids arrive from peers and used to reach this innerHTML raw — an id
   like `"><img src=x onerror=…>` executed as markup. Every attribute below
   goes through the escaper; ingest-side validation (sanitizeRemoteId) keeps
   the stored ids clean, this keeps the template safe even if one slips in.
   Escaping is transparent to dataset/getAttribute reads, so handlers still
   see the raw id. */
const eid = (value) => app().escapeHTML(String(value ?? ''));
panel.innerHTML = olderNotice + renderHistory.map((entry) => {const canReactToEntry = entry.direction !== 'out';
const meta = `
<div class="chat-message-meta" style="display: flex !important; opacity: 1 !important; visibility: visible !important;">
<span>${formatTime(entry.createdAt)}</span>
${entry.expiresAt ? `<span class="chat-timer-countdown bg-brand-500/10 text-brand-500 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1" data-expires="${app().escapeHTML(entry.expiresAt)}"><i class="fas fa-stopwatch animate-pulse"></i> ${formatCountdown(entry.expiresAt)}</span>` : (entry.timerSeconds ? `<span class="chat-timer-countdown bg-brand-500/10 text-brand-500 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1"><i class="fas fa-stopwatch"></i> ${entry.timerSeconds}s</span>` : '')}
${entry.direction === 'out' ? (() => {
const meta = statusMeta(entry.status);
return `<span data-chat-message-status="${eid(entry.id)}" class="chat-msg-status ${meta.cls}" title="${app().escapeHTML(meta.title)}">${meta.label}</span>`;
})() : ''}
</div>`;
const reactionSummary = summarizeMessageReactions(entry);
const myReaction = normalizeMessageReactions(entry)[myReactorId] || '';
const pickerOpen = chatState.activeReactionMessageId === entry.id;
const reactionSummaryHtml = reactionSummary.length
? `<div class="chat-reaction-summary">
${reactionSummary.map(({ emoji, count }) => `
<button type="button" ${canReactToEntry ? `data-chat-reaction-choice="${eid(entry.id)}" data-reaction="${app().escapeHTML(emoji)}"` : ''} class="chat-reaction-chip ${myReaction === emoji ? 'active' : ''}">
<span>${app().escapeHTML(emoji)}</span>
${count > 1 ? `<span class="chat-reaction-count">${count}</span>` : ''}
</button>
`).join('')}
</div>`
: '';
const deleteButton = `<button type="button" data-chat-delete-message="${eid(entry.id)}" class="chat-message-delete" title="${app().escapeHTML(t('حذف پیام', 'Delete message'))}">
<i class="fas fa-trash"></i>
</button>`;
const editButton = (entry.direction === 'out' && entry.type === 'text') ? `
<button type="button" data-chat-edit-message="${eid(entry.id)}" class="chat-message-icon-btn" title="${app().escapeHTML(t('ویرایش', 'Edit'))}">
<i class="fas fa-pen"></i>
</button>` : '';
const senderLabel = messageSenderLabel(entry, peer);
const senderHtml = senderLabel
? `<div class="chat-message-sender">${messageSenderAvatar(entry, peer)}<span>${app().escapeHTML(senderLabel)}</span></div>`
: '';
const replyPreview = entry.replyToId ? (() => {
const replied = historyById.get(entry.replyToId);
if (!replied) return '';
const replyName = replied.direction === 'out'
? t('خودتان', 'You')
: (messageSenderLabel(replied, peer) || peer.username || peer.name || t('کاربر', 'User'));
return `
<div class="chat-reply-preview" data-chat-jump-to="${eid(replied.id)}" role="button" tabindex="0">
<span class="reply-name">${app().escapeHTML(replyName)}</span>
<span class="reply-text">${app().escapeHTML(replied.text || mediaEntryLabel(replied) || t('فایل', 'File'))}</span>
</div>
`;
})() : '';
const reactionToolbar = `
<div class="chat-message-toolbar ${entry.direction === 'out' ? 'own-actions' : 'peer-actions'}">
${canReactToEntry ? `<button type="button" data-chat-toggle-reaction="${eid(entry.id)}" class="chat-message-icon-btn ${pickerOpen ? 'active' : ''}" title="${app().escapeHTML(t('ری‌اکشن', 'React'))}">
<i class="far fa-face-smile"></i>
</button>` : ''}
<button type="button" data-chat-reply-message="${eid(entry.id)}" class="chat-message-icon-btn" title="${app().escapeHTML(t('پاسخ', 'Reply'))}">
<i class="fas fa-reply"></i>
</button>
${editButton}
<button type="button" data-chat-copy-message="${eid(entry.id)}" class="chat-message-icon-btn" title="${app().escapeHTML(t('کپی', 'Copy'))}">
<i class="far fa-copy"></i>
</button>
<button type="button" data-chat-pin-message="${eid(entry.id)}" class="chat-message-icon-btn" title="${app().escapeHTML(t('سنجاق کردن', 'Pin'))}">
<i class="fas fa-thumbtack"></i>
</button>
<button type="button" data-chat-forward-message="${eid(entry.id)}" class="chat-message-icon-btn" title="${app().escapeHTML(t('هدایت', 'Forward'))}">
<i class="fas fa-share"></i>
</button>
${deleteButton}
</div>
${reactionSummaryHtml}
`;
if (entry.type === 'voice') {
const playerHtml = entry.downloadUrl ? `
<div class="modern-audio-player" data-audio-url="${app().escapeHTML(safeMediaUrl(entry.downloadUrl))}" data-audio-id="${eid(entry.id)}">
<button class="audio-play-btn" title="${t('پخش', 'Play')}">
<i class="fas fa-play"></i>
</button>
<div class="audio-progress-wrap">
<div class="audio-wave-container">
${(voiceWaveCache.get(entry.id) || seededVoiceWave(entry.id)).map((level) => `<div class="audio-wave-bar" style="--bar-height: ${Math.round(level * 100)}%"></div>`).join('')}
</div>
<div class="audio-time-row">
<span class="audio-current-time">0:00</span>
<span class="audio-duration">--:--</span>
</div>
</div>
<button class="audio-speed-btn">1x</button>
</div>
` : missingMediaHtml(t('این پیام صوتی روی این دستگاه ذخیره نشده است.', 'This voice message is not stored on this device.'));
return `
<div class="${bubbleClass(entry)}" data-id="${eid(entry.id)}">
${senderHtml}
${replyPreview}
<div class="chat-voice-message">
<div class="font-bold text-xs mb-1 opacity-70" dir="${language() === 'fa' ? 'rtl' : 'ltr'}">${t('پیام صوتی رمزنگاری‌شده', 'Encrypted voice message')}</div>
${playerHtml}
</div>
${reactionToolbar}
${meta}
</div>
`;
}
if (entry.type === 'file' && entry.viewOnce) {
const consumed = isMediaConsumed(entry);
const outgoing = entry.direction === 'out';
return `
<div class="${bubbleClass(entry)} view-once ${consumed ? 'is-consumed' : ''}" data-id="${eid(entry.id)}">
${senderHtml}
<div class="chat-view-once">
<i class="fas ${consumed ? 'fa-eye-slash' : 'fa-fire'}"></i>
<div class="min-w-0">
<div class="chat-view-once-title">${app().escapeHTML(consumed
? t('رسانهٔ یک‌بارمصرف — باز شده', 'View-once media — opened')
: t('رسانهٔ یک‌بارمصرف', 'View-once media'))}</div>
<div class="chat-view-once-note">${app().escapeHTML(consumed
? t('دیگر در دسترس نیست.', 'No longer available.')
: (outgoing ? t('گیرنده فقط یک بار می‌تواند آن را باز کند.', 'The recipient can open it once.') : t('فقط یک بار باز می‌شود.', 'Opens only once.')))}</div>
</div>
${(!consumed && entry.downloadUrl && !outgoing) ? `<button type="button" data-chat-view-once="${eid(entry.id)}" class="chat-view-once-btn">${app().escapeHTML(t('باز کردن', 'Open'))}</button>` : ''}
</div>
${meta}
</div>
`;
}
if (entry.type === 'rich') {
const rich = richPayloadOf(entry);
if (!rich) return '';
const mine = entry.direction === 'out';
if (rich.kind === 'poll') {
const { counts, voters } = pollTally(rich);
const me = pollVoterId();
const myChoices = Array.isArray(rich.votes?.[me]) ? rich.votes[me] : [];
const total = Math.max(1, Math.max(...counts, 1));
return `
<div class="${bubbleClass(entry)} chat-poll-bubble" data-id="${eid(entry.id)}">
${senderHtml}
<div class="chat-poll">
<div class="chat-poll-head">
<i class="fas fa-square-poll-vertical"></i>
<div class="min-w-0">
<div class="chat-poll-question">${app().escapeHTML(rich.question || '')}</div>
<div class="chat-poll-meta">${app().escapeHTML(rich.multi ? t('چند گزینه‌ای', 'Multiple choice') : t('تک گزینه‌ای', 'Single choice'))}${rich.closed ? ` · ${app().escapeHTML(t('بسته شد', 'Closed'))}` : ''}</div>
</div>
</div>
<div class="chat-poll-options">
${rich.options.map((option, index) => {
const count = counts[index] || 0;
const picked = myChoices.includes(index);
const share = voters ? Math.round((count / voters) * 100) : 0;
return `
<button type="button" class="chat-poll-option ${picked ? 'is-picked' : ''}" ${rich.closed ? 'disabled' : ''} data-chat-poll-vote="${eid(entry.id)}" data-poll-option="${index}">
<span class="chat-poll-bar" style="--poll-share: ${Math.round((count / total) * 100)}%"></span>
<span class="chat-poll-mark"><i class="fas ${picked ? (rich.multi ? 'fa-square-check' : 'fa-circle-check') : (rich.multi ? 'fa-square' : 'fa-circle')}"></i></span>
<span class="chat-poll-label">${app().escapeHTML(option)}</span>
<span class="chat-poll-count">${count}${voters ? ` · ${share}%` : ''}</span>
</button>`;
}).join('')}
</div>
<div class="chat-poll-foot">
<span>${voters} ${app().escapeHTML(t('رأی', voters === 1 ? 'vote' : 'votes'))}</span>
${mine ? `<button type="button" data-chat-poll-close="${eid(entry.id)}" class="chat-poll-close-btn">${app().escapeHTML(rich.closed ? t('بازکردن', 'Reopen') : t('بستن نظرسنجی', 'Close poll'))}</button>` : ''}
</div>
</div>
${reactionToolbar}
${meta}
</div>`;
}
if (rich.kind === 'location') {
/* Coordinates are peer-controlled and used to reach this href raw. Coerce to
   finite numbers first; a garbage lat/lng renders as an inert card instead of
   an injected URL. */
const lat = Number(rich.lat);
const lng = Number(rich.lng);
const coordsOk = Number.isFinite(lat) && Number.isFinite(lng);
const accuracy = Math.max(0, Math.round(Number(rich.accuracy) || 0));
const maps = coordsOk ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}` : '';
return `
<div class="${bubbleClass(entry)} chat-location-bubble" data-id="${eid(entry.id)}">
${senderHtml}
<div class="chat-location">
<div class="chat-location-map" aria-hidden="true">
<span class="chat-location-grid"></span>
<span class="chat-location-pin"><i class="fas fa-location-dot"></i></span>
<span class="chat-location-halo" style="--halo: ${Math.min(70, Math.max(18, Math.round(accuracy / 4)))}px"></span>
</div>
<div class="chat-location-body">
<div class="chat-location-title"><i class="fas fa-location-dot"></i> ${app().escapeHTML(t('موقعیت مکانی', 'Location'))}</div>
<div class="chat-location-coords" dir="ltr">${coordsOk ? `${lat}, ${lng}` : '—'}</div>
<div class="chat-location-accuracy">${app().escapeHTML(t(`دقت حدود ${accuracy} متر`, `Accurate to about ${accuracy} m`))}</div>
<div class="chat-location-actions">
${coordsOk ? `<a href="${maps}" target="_blank" rel="noopener noreferrer" class="chat-location-btn"><i class="fas fa-map"></i> ${app().escapeHTML(t('باز کردن در نقشه', 'Open in maps'))}</a>` : ''}
${coordsOk ? `<button type="button" data-chat-copy-coords="${app().escapeHTML(`${lat},${lng}`)}" class="chat-location-btn is-soft"><i class="fas fa-copy"></i> ${app().escapeHTML(t('کپی مختصات', 'Copy coordinates'))}</button>` : ''}
</div>
</div>
</div>
${reactionToolbar}
${meta}
</div>`;
}
if (rich.kind === 'contact') {
const known = chatState.peers.some((peerRecord) => peerRecord.fingerprint === rich.fingerprint);
const isSelf = rich.fingerprint === chatState.identity?.fingerprint;
const cardAvatar = sanitizeAvatarData(rich.avatarData);
return `
<div class="${bubbleClass(entry)} chat-contactcard-bubble" data-id="${eid(entry.id)}">
${senderHtml}
<div class="chat-contactcard ${(!mine && !isSelf) ? 'is-tappable' : ''}" ${(!mine && !isSelf) ? `data-chat-open-contact="${eid(entry.id)}"` : ''}>
<div class="chat-contactcard-avatar">${cardAvatar
? `<img src="${cardAvatar}" alt="">`
: app().escapeHTML(initials(rich.name || '?'))}</div>
<div class="chat-contactcard-body">
<div class="chat-contactcard-name">${app().escapeHTML(rich.name || '')}</div>
<div class="chat-contactcard-fp" dir="ltr">${app().escapeHTML(shortSecurityValue(rich.fingerprint, 10, 8))}</div>
</div>
${mine || isSelf
? `<span class="chat-contactcard-sent">${app().escapeHTML(mine ? t('ارسال شد', 'Shared') : t('خودتان', 'You'))}</span>`
: (known
? `<span class="chat-contactcard-sent"><i class="fas fa-check"></i> ${app().escapeHTML(t('در مخاطبین', 'In contacts'))}</span>`
: `<button type="button" class="chat-contactcard-btn" data-chat-adopt-contact="${eid(entry.id)}">${app().escapeHTML(t('افزودن', 'Add'))}</button>`)}
</div>
${reactionToolbar}
${meta}
</div>`;
}
return '';
}
if (entry.type === 'stickerpack') {
const mine = entry.direction === 'out';
const already = Boolean(entry.packAdopted) || chatState.stickerPacks.some((pack) => pack.title === entry.packTitle && pack.source === 'shared');
return `
<div class="${bubbleClass(entry)} chat-packcard-bubble" data-id="${eid(entry.id)}">
${senderHtml}
${replyPreview}
<div class="chat-packcard">
<div class="chat-packcard-icon"><i class="fas fa-icons"></i></div>
<div class="chat-packcard-body">
<div class="chat-packcard-title">${app().escapeHTML(entry.packTitle || entry.name || t('پک استیکر', 'Sticker pack'))}</div>
<div class="chat-packcard-note">${entry.packCount ? `${entry.packCount} ${app().escapeHTML(t('استیکر', 'stickers'))} · ` : ''}${app().formatBytes?.(entry.size) || `${entry.size} B`}</div>
</div>
${mine
? `<span class="chat-packcard-sent">${app().escapeHTML(t('ارسال شد', 'Shared'))}</span>`
: (already
? `<span class="chat-packcard-sent"><i class="fas fa-check"></i> ${app().escapeHTML(t('اضافه شد', 'Added'))}</span>`
: `<button type="button" class="chat-packcard-btn" data-chat-adopt-pack="${eid(entry.id)}">${app().escapeHTML(t('افزودن', 'Add'))}</button>`)}
</div>
${reactionToolbar}
${meta}
</div>
`;
}
if (entry.type === 'sticker') {
/* A sticker is the message, not an attachment inside one: no card, no file
   name, no download button — just the artwork on a transparent bubble, the
   way every other messenger draws it. */
const stickerKind = entry.stickerKind || stickerKindForName(entry.name || '', entry.mime || '');
return `
<div class="${bubbleClass(entry)} chat-sticker-bubble" data-id="${eid(entry.id)}">
${senderHtml}
${replyPreview}
<div class="chat-sticker-body">${entry.downloadUrl
? stickerMediaHtml(safeMediaUrl(entry.downloadUrl) || 'about:blank', stickerKind, 'chat-sticker-media')
: missingMediaHtml(t('استیکر روی این دستگاه ذخیره نشده است.', 'Sticker is not stored on this device.'))}</div>
${reactionToolbar}
${meta}
</div>
`;
}
if (entry.type === 'file') {
return `
<div class="${bubbleClass(entry)}" data-id="${eid(entry.id)}">
${senderHtml}
${replyPreview}
<div class="flex items-start gap-3">
<div class="w-10 h-10 rounded-xl bg-sky-500/20 text-brand-400 flex items-center justify-center shrink-0">
<i class="fas fa-file-shield text-xl"></i>
</div>
<div class="min-w-0">
<div class="font-bold text-sm truncate mb-0.5">${app().escapeHTML(entry.name || 'file.bin')}</div>
<div class="text-[11px] opacity-60">${app().formatBytes?.(entry.size) || entry.size + ' B'}</div>
${(() => {
if (!entry.downloadUrl) return missingMediaHtml(t('این فایل روی این دستگاه ذخیره نشده است.', 'This file is not stored on this device.'));
// A self-destruct file is meant to disappear; handing over a Download link
// would let the recipient keep it forever and make the timer meaningless.
// Show a preview that cannot be saved, dragged, long-pressed or selected.
if (Number(entry.timerSeconds || 0) > 0) {
const isImage = /^image\//i.test(entry.mime || '') || /\.(png|jpe?g|gif|webp|heic|avif)$/i.test(entry.name || '');
const burnSrc = safeMediaUrl(entry.downloadUrl);
return `
<div class="chat-burn-wrap">
${(isImage && burnSrc)
? `<img class="chat-burn-media" src="${burnSrc}" alt="" draggable="false">`
: `<div class="chat-burn-media chat-burn-generic"><i class="fas fa-file-shield"></i></div>`}
<div class="chat-burn-note"><i class="fas fa-fire"></i> ${app().escapeHTML(t('فایل خودتخریب — فقط پیش‌نمایش، قابل ذخیره نیست', 'Self-destruct file — preview only, cannot be saved'))}</div>
</div>`;
}
/* The download URL can originate off the wire (system broadcasts, imports);
   only https/blob links may become an href. */
const downloadHref = safeMediaUrl(entry.downloadUrl);
return downloadHref
? `<a href="${app().escapeHTML(downloadHref)}" download="${app().escapeHTML(entry.name || 'file.bin')}" data-chat-download-message="${eid(entry.id)}" class="inline-flex mt-2 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-bold hover:bg-brand-600 transition-colors">${t('دریافت فایل', 'Download')}</a>`
: missingMediaHtml(t('این فایل روی این دستگاه ذخیره نشده است.', 'This file is not stored on this device.'));
})()}
</div>
</div>
${reactionToolbar}
${meta}
</div>
`;
}
if (entry.type === 'system-note') {
return `
<div class="chat-system-note ${entry.noteKind === 'key-change' ? 'is-key-change' : ''}" data-id="${eid(entry.id)}">
<span>${app().escapeHTML(entry.text || '')}</span>
</div>`;
}
if (entry.type === 'call-log') {
const icon = entry.mode === 'video' ? 'fa-video' : 'fa-phone';
const missed = isMissedCallStatus(entry.status);
return `
<div class="chat-call-message ${missed ? 'missed' : ''} ${messageMatchesSearch(entry, activeSearchQuery) ? 'search-hit' : ''}" data-id="${eid(entry.id)}" data-call-redial="${entry.mode === 'video' ? 'video' : 'voice'}" role="button" tabindex="0" title="${t('تماس دوباره', 'Call back')}">
<span class="chat-call-message-icon"><i class="fas ${icon}"></i></span>
<div class="min-w-0">
<div class="chat-call-message-title">${app().escapeHTML(callHistoryText(entry))}</div>
<div class="chat-call-message-meta">${formatTime(entry.createdAt)}${entry.durationMs ? ` · ${formatDuration(entry.durationMs)}` : ''}</div>
</div>
<span class="chat-call-message-redial" aria-hidden="true"><i class="fas ${icon}"></i></span>
</div>
`;
}
if (isMessageHidden(entry)) {
return `
<div class="${bubbleClass(entry)}" data-id="${eid(entry.id)}" data-hidden-masked="true">
${senderHtml}
${maskedBody(entry.id)}
${meta}
</div>
`;
}
return `
<div class="${bubbleClass(entry)}" data-id="${eid(entry.id)}">
${senderHtml}
${replyPreview}
<div class="chat-message-text text-sm whitespace-pre-wrap" dir="${detectComposerDirection(entry.text)}">${decorateMentions(app().escapeHTML(entry.text || ''), entry)} ${entry.edited ? `<span class="text-[10px] opacity-40 italic ml-1">(${t('ویرایش شده', 'edited')})</span>` : ''}</div>
${reactionToolbar}
${meta}
</div>
`;
}).join('');
restoreKeyAlert();
// Re-bind Audio Player events
panel.querySelectorAll('.modern-audio-player').forEach(container => {
const url = container.dataset.audioUrl;
const id = container.dataset.audioId;
const playBtn = container.querySelector('.audio-play-btn');
const speedBtn = container.querySelector('.audio-speed-btn');
const currentTimeEl = container.querySelector('.audio-current-time');
const durationEl = container.querySelector('.audio-duration');
const waveBars = container.querySelectorAll('.audio-wave-bar');
const waveWrap = container.querySelector('.audio-wave-container');
// `entry` here used to resolve to whatever outer variable happened to carry
// that name — the map's parameter is long out of scope by this point — so the
// duration fallback was reading a different message's length. Look it up.
const voiceEntry = voiceEntryById(id);
// Paint the real envelope as soon as it decodes, without a re-render.
if (!voiceWaveCache.has(id)) {
computeVoiceWave(voiceEntry).then((peaks) => {
if (!peaks) return;
waveBars.forEach((bar, index) => {
if (peaks[index] != null) bar.style.setProperty('--bar-height', `${Math.round(peaks[index] * 100)}%`);
});
}).catch(() => { /* stand-in shape stays */ });
}
let player = audioPlayers.get(id);
if (!player) {
player = {
audio: new Audio(url),
playbackRate: 1.0,
isPlaying: false
};
audioPlayers.set(id, player);
}
const audio = player.audio;
// MediaRecorder blobs frequently report Infinity until fully buffered, so the
// length we recorded is the more reliable number of the two.
const trackDuration = () => {
if (audio.duration && audio.duration !== Infinity && !isNaN(audio.duration)) return audio.duration;
return voiceEntry?.durationMs ? voiceEntry.durationMs / 1000 : NaN;
};
const updateUI = () => {
const duration = trackDuration();
const current = audio.currentTime;
if (isNaN(duration)) {
// Still show the length we know about rather than a dash.
if (voiceEntry?.durationMs) durationEl.textContent = formatAudioTime(voiceEntry.durationMs / 1000);
return;
}
const activeIndex = Math.floor((current / duration) * waveBars.length);
waveBars.forEach((bar, idx) => {
bar.classList.toggle('active', idx <= activeIndex);
});
currentTimeEl.textContent = formatAudioTime(current);
durationEl.textContent = formatAudioTime(duration);
};
audio.ontimeupdate = updateUI;
audio.onloadedmetadata = updateUI;
audio.onended = () => {
player.isPlaying = false;
playBtn.innerHTML = '<i class="fas fa-play"></i>';
waveBars.forEach(bar => bar.classList.remove('active'));
};
playBtn.onclick = () => {
if (player.isPlaying) {
audio.pause();
player.isPlaying = false;
playBtn.innerHTML = '<i class="fas fa-play"></i>';
} else {
// Pause others
audioPlayers.forEach((p, k) => {
if (k !== id && p.isPlaying) {
p.audio.pause();
p.isPlaying = false;
const otherBtn = panel.querySelector(`[data-audio-id="${CSS.escape(k)}"] .audio-play-btn`);
if (otherBtn) otherBtn.innerHTML = '<i class="fas fa-play"></i>';
}
});
audio.play();
player.isPlaying = true;
playBtn.innerHTML = '<i class="fas fa-pause"></i>';
}
};
speedBtn.onclick = () => {
const rates = [1.0, 1.5, 2.0, 0.5];
const currentIndex = rates.indexOf(player.playbackRate);
player.playbackRate = rates[(currentIndex + 1) % rates.length];
audio.playbackRate = player.playbackRate;
speedBtn.textContent = player.playbackRate + 'x';
};
// Scrub by click or drag, and mirror the axis in a right-to-left layout.
const seekTo = (clientX) => {
const rect = waveWrap.getBoundingClientRect();
const duration = trackDuration();
if (!rect.width || isNaN(duration)) return;
let ratio = (clientX - rect.left) / rect.width;
if (getComputedStyle(waveWrap).direction === 'rtl') ratio = 1 - ratio;
audio.currentTime = Math.max(0, Math.min(duration, ratio * duration));
updateUI();
};
waveWrap.onpointerdown = (event) => {
event.preventDefault();
waveWrap.setPointerCapture?.(event.pointerId);
waveWrap.dataset.scrubbing = '1';
seekTo(event.clientX);
};
waveWrap.onpointermove = (event) => {
if (waveWrap.dataset.scrubbing !== '1') return;
seekTo(event.clientX);
};
const endScrub = (event) => {
if (waveWrap.dataset.scrubbing !== '1') return;
delete waveWrap.dataset.scrubbing;
waveWrap.releasePointerCapture?.(event.pointerId);
};
waveWrap.onpointerup = endScrub;
waveWrap.onpointercancel = endScrub;
});
// Deterministic stand-in until the real peaks are decoded. Seeded by the
// message id so the same message always draws the same shape — the old
// Math.random() heights reshuffled on every single re-render.
function seededVoiceWave(seed, count = VOICE_WAVE_BARS) {
let h = 2166136261;
const text = String(seed || 'voice');
for (let i = 0; i < text.length; i += 1) {
h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
}
const out = [];
for (let i = 0; i < count; i += 1) {
h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
out.push(0.22 + ((h >>> 9) % 1000) / 1000 * 0.68);
}
return out;
}
// Real peak envelope, decoded once per message and cached.
async function computeVoiceWave(entry) {
if (!entry?.id || !entry.downloadUrl) return null;
if (voiceWaveCache.has(entry.id)) return voiceWaveCache.get(entry.id);
const AudioCtx = window.AudioContext || window.webkitAudioContext;
if (!AudioCtx) return null;
try {
const response = await fetch(entry.downloadUrl);
const bytes = await response.arrayBuffer();
const context = new AudioCtx();
const decoded = await context.decodeAudioData(bytes);
const samples = decoded.getChannelData(0);
const bucket = Math.max(1, Math.floor(samples.length / VOICE_WAVE_BARS));
const peaks = [];
for (let i = 0; i < VOICE_WAVE_BARS; i += 1) {
let peak = 0;
for (let j = 0; j < bucket; j += 1) {
const value = Math.abs(samples[i * bucket + j] || 0);
if (value > peak) peak = value;
}
peaks.push(peak);
}
context.close?.();
const loudest = Math.max(...peaks, 0.0001);
const shaped = peaks.map((peak) => 0.16 + (peak / loudest) * 0.84);
voiceWaveCache.set(entry.id, shaped);
return shaped;
} catch (_error) {
// Encrypted blob, unsupported codec, revoked URL — the seeded shape stands in.
return null;
}
}
function voiceEntryById(messageId) {
const peer = getActiveConversation();
if (!peer) return null;
const key = getConversationKey(peer);
return (chatState.history[key] || []).find((item) => item.id === messageId) || null;
}
function formatAudioTime(seconds) {
if (isNaN(seconds)) return '0:00';
const mins = Math.floor(seconds / 60);
const secs = Math.floor(seconds % 60);
return `${mins}:${secs.toString().padStart(2, '0')}`;
}
// Incremental renders reuse DOM nodes. Replace their owned handlers instead
// of accumulating listeners that toggle twice or send a repeated action.
panel.querySelectorAll('[data-chat-toggle-reaction]').forEach((button) => {
button.onclick = (event) => {
event.preventDefault();
event.stopPropagation();
const entryId = button.getAttribute('data-chat-toggle-reaction') || '';
chatState.activeReactionMessageId = chatState.activeReactionMessageId === entryId ? '' : entryId;
/* The toolbar the picker hangs off has to still be there after this redraw.
   Without it the click opened the picker and closed the thing holding it in
   the same frame, which looked exactly like the button doing nothing. */
chatState.activeMessageId = entryId;
renderMessages();
/* Opened after the redraw, against the bubble that now exists. Rendering it
   inside the bubble is what produced the ghosts: a fixed-position element
   painted over the page and outlived the node it belonged to. */
if (chatState.activeReactionMessageId === entryId) openReactionPopup(entryId);
else closeReactionPopup();
};
});
/* Delegated from the popup itself rather than bound to each button.
   The popup's contents are written when it opens, which is AFTER this wiring
   runs — so listeners attached here found nothing to attach to and every emoji
   in it was inert. One listener on the container survives every rebuild. */
/* What reactions are actually recorded against a conversation's messages.
   Reading the rendered text cannot tell a reaction chip from a message that
   happens to contain the same emoji; this reads the record. */
window.__reactionProbe = (conversationId) => (chatState.history[conversationId] || [])
  .map((entry) => ({ id: entry.id, reactions: normalizeMessageReactions(entry) }))
  .filter((row) => Object.keys(row.reactions).length);

const reactionPopupHost = reactionPopupNode();
/* Versioned, not a boolean.
   A plain "wired" flag means a popup that already exists never picks up
   listeners added later — which is exactly what happened when the custom-emoji
   handlers were added after the click handler: the element was already marked
   and the new listeners were never bound. Bumping this number rewires it. */
if (reactionPopupHost.dataset.wired !== '2') {
reactionPopupHost.dataset.wired = '2';
reactionPopupHost.addEventListener('click', (event) => {
const chosen = event.target.closest('[data-chat-reaction-choice]');
if (!chosen) return;
event.preventDefault();
event.stopPropagation();
const id = chosen.getAttribute('data-chat-reaction-choice');
const emoji = chosen.getAttribute('data-reaction') || '';
applyReactionFromPicker(id, emoji);
});
/* The custom field, delegated for the same reason as the buttons: it does not
   exist when this runs. Enter and blur both commit, because a phone keyboard's
   "done" is a blur and its return key is Enter. */
reactionPopupHost.addEventListener('keydown', (event) => {
const input = event.target.closest?.('[data-chat-reaction-custom]');
if (!input || event.key !== 'Enter') return;
event.preventDefault();
applyCustomReaction(input);
});
reactionPopupHost.addEventListener('change', (event) => {
const input = event.target.closest?.('[data-chat-reaction-custom]');
if (input) applyCustomReaction(input);
});
}
const reactionRoots = [panel];
reactionRoots.forEach((root) => root.querySelectorAll('[data-chat-reaction-choice]').forEach((button) => {
button.onclick = (event) => {
event.preventDefault();
event.stopPropagation();
const entryId = button.getAttribute('data-chat-reaction-choice');
const reaction = button.getAttribute('data-reaction') || '';
const entry = (chatState.history[conversationKey] || []).find((item) => item.id === entryId);
if (!entry || entry.direction === 'out') return;
const currentReaction = normalizeMessageReactions(entry)[myReactorId] || '';
const nextReaction = currentReaction === reaction ? '' : reaction;
if (nextReaction) spawnReactionAnimation(nextReaction, entryId);
applyMessageReaction(entry, nextReaction, myReactorId);
chatState.activeReactionMessageId = '';
if (peer && !peer.type && directPeer) {
relaySessionEvent(directPeer, {
type: 'reaction',
messageId: entryId,
reaction: nextReaction,
reactorId: myReactorId,
clientId: chatState.clientId || '',
peerId: chatState.peerId || '',
fingerprint: chatState.identity?.fingerprint || '',
createdAt: new Date().toISOString(),
});
}
closeReactionPopup();
storeHistory();
renderPeers();
renderMessages();
};
}));
reactionRoots.forEach((root) => root.querySelectorAll('[data-chat-reaction-custom]').forEach((input) => {
const commitReaction = (event) => {
const entryId = input.getAttribute('data-chat-reaction-custom') || '';
const entry = (chatState.history[conversationKey] || []).find((item) => item.id === entryId);
const reaction = String(input.value || '').trim();
if (!entry || entry.direction === 'out' || !reaction) return;
const nextReaction = Array.from(reaction)[0] || '';
applyMessageReaction(entry, nextReaction, myReactorId);
chatState.activeReactionMessageId = '';
if (peer && !peer.type && directPeer) {
relaySessionEvent(directPeer, {
type: 'reaction',
messageId: entryId,
reaction: nextReaction,
reactorId: myReactorId,
clientId: chatState.clientId || '',
peerId: chatState.peerId || '',
fingerprint: chatState.identity?.fingerprint || '',
createdAt: new Date().toISOString(),
});
}
storeHistory();
renderPeers();
renderMessages();
};
input.onkeydown = (event) => {
if (event.key === 'Enter') {
event.preventDefault();
commitReaction(event);
}
};
input.onchange = commitReaction;
input.onclick = (event) => event.stopPropagation();
}));
/* The open toolbar is re-placed after the rebuild, not just re-classed: its
   position is measured from the bubble, and the bubble it was measured against
   no longer exists. */
if (chatState.activeMessageId) {
const open = panel.querySelector(`.chat-message-bubble[data-id="${CSS.escape(chatState.activeMessageId)}"]`);
if (open) {
placeMessageToolbar(open);
if (chatState.activeReactionMessageId === chatState.activeMessageId) {
openReactionPopup(chatState.activeMessageId);
}
}
else {
/* The message went — deleted, burned, or filtered out of view. Nothing to
   keep a toolbar or a picker open against. */
chatState.activeMessageId = '';
chatState.activeReactionMessageId = '';
}
}
panel.querySelectorAll('.chat-message-bubble').forEach((bubble) => {
bubble.onclick = () => {
const id = bubble.dataset.id || '';
const opening = chatState.activeMessageId !== id;
chatState.activeMessageId = opening ? id : '';
/* Closing a message's toolbar closes its picker with it: a picker floating
   over a message whose toolbar has gone belongs to nothing. */
if (!opening) chatState.activeReactionMessageId = '';
panel.querySelectorAll('.chat-message-bubble').forEach((b) => {
b.classList.toggle('selected', b === bubble && opening);
if (b !== bubble) b.classList.remove('toolbar-below');
});
if (opening) placeMessageToolbar(bubble);
else closeReactionPopup();
};
const entryId = bubble.dataset.id;
const entry = historyById.get(entryId);
/* "Opened" is a promise about the user's eyes. When the tab is hidden the
   message was rendered, not read — leave the status alone so the guarded
   flushSeenReceipts pass (which checks visibility and burst-limits) is the
   one that sends it, instead of firing one receipt per hidden render. */
if (entryId && entry && entry.direction === 'in' && entry.status !== 'opened' && directPeer && !document.hidden) {
sendRelayEnvelope(directPeer, {
type: 'receipt',
messageId: entryId,
status: 'opened',
createdAt: new Date().toISOString(),
});
entry.status = 'opened';
storeHistory();
}
bindSwipeReply(bubble, entryId, panel);
});
panel.querySelectorAll('[data-chat-jump-to]').forEach((preview) => {
preview.onclick = (event) => {
event.stopPropagation();
/* dataset gives back the unescaped id; CSS.escape makes it a safe selector. */
const target = panel.querySelector(`.chat-message-bubble[data-id="${CSS.escape(preview.dataset.chatJumpTo || '')}"]`);
target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};
});
panel.querySelectorAll('[data-chat-reveal]').forEach((mask) => {
mask.onclick = (event) => {
event.preventDefault();
event.stopPropagation();
revealHiddenMessage(mask.getAttribute('data-chat-reveal'));
};
});
try {
flushSeenReceipts();
} catch (error) {
// Receipts are housekeeping; they must never take the thread down with them.
console.warn('[Chat] Read receipt pass failed:', error);
}
panel.querySelectorAll('[data-chat-view-once]').forEach((button) => {
button.onclick = (event) => {
event.stopPropagation();
openViewOnceMedia(button.dataset.chatViewOnce);
};
});
panel.querySelectorAll('[data-chat-poll-vote]').forEach((button) => {
button.onclick = (event) => {
event.stopPropagation();
castPollVote(button.getAttribute('data-chat-poll-vote'), Number(button.getAttribute('data-poll-option'))).catch(console.error);
};
});
panel.querySelectorAll('[data-chat-poll-close]').forEach((button) => {
button.onclick = (event) => {
event.stopPropagation();
togglePollClosed(button.getAttribute('data-chat-poll-close'));
};
});
panel.querySelectorAll('[data-chat-copy-coords]').forEach((button) => {
button.onclick = (event) => {
event.stopPropagation();
navigator.clipboard?.writeText(button.getAttribute('data-chat-copy-coords') || '')
.then(() => notify(t('مختصات کپی شد.', 'Coordinates copied.'), 'success'))
.catch(() => notify(t('کپی ناموفق بود.', 'Copy failed.'), 'warning'));
};
});
panel.querySelectorAll('[data-chat-adopt-contact]').forEach((button) => {
button.onclick = async (event) => {
event.stopPropagation();
button.disabled = true;
await adoptSharedContact(button.getAttribute('data-chat-adopt-contact'), { openChat: true });
};
});
panel.querySelectorAll('[data-chat-open-contact]').forEach((card) => {
card.onclick = async (event) => {
/* Tapping anywhere on the card does the obvious thing: add them if they are
   new, then open the conversation. The Add button stays for clarity. */
if (event.target.closest('[data-chat-adopt-contact]')) return;
if (chatState.selectionMode) return;
await adoptSharedContact(card.getAttribute('data-chat-open-contact'), { openChat: true });
};
});
panel.querySelectorAll('[data-chat-adopt-pack]').forEach((button) => {
button.onclick = async (event) => {
event.stopPropagation();
const entry = (chatState.history[conversationKey] || []).find((item) => item.id === button.dataset.chatAdoptPack);
button.disabled = true;
await adoptSharedStickerPack(entry);
};
});
panel.querySelectorAll('[data-chat-delete-message]').forEach((button) => {
button.onclick = () => {
const entryId = button.getAttribute('data-chat-delete-message');
if (!entryId) return;
chatState.activeReactionMessageId = '';
deleteMessageEntry(conversationKey, entryId, { broadcast: Boolean(!peer.type), peerRecord: directPeer });
};
});
panel.querySelectorAll('[data-chat-copy-message]').forEach((button) => {
button.onclick = async () => {
const entry = historyById.get(button.getAttribute('data-chat-copy-message'));
if (!entry?.text) return;
await navigator.clipboard?.writeText(entry.text).catch(() => {});
notify(t('پیام کپی شد.', 'Message copied.'), 'success');
};
});
panel.querySelectorAll('[data-chat-reply-message]').forEach((button) => {
button.onclick = () => {
handleReplyMessage(button.getAttribute('data-chat-reply-message'));
};
});
panel.querySelectorAll('[data-chat-pin-message], [data-chat-forward-message]').forEach((button) => {
button.onclick = (event) => {
event.preventDefault();
event.stopPropagation();
const pinId = button.getAttribute('data-chat-pin-message');
const forwardId = button.getAttribute('data-chat-forward-message');
if (pinId) handlePinMessage(pinId);
if (forwardId) handleForwardMessage(forwardId);
};
});
panel.querySelectorAll('[data-chat-download-message]').forEach((link) => {
link.onclick = () => {
const entryId = link.getAttribute('data-chat-download-message') || '';
const entry = (chatState.history[conversationKey] || []).find((item) => item.id === entryId);
if (entry) {
entry.status = 'opened';
storeHistory();
renderMessages();
}
if (entryId && peer && !peer.type && directPeer) {
relaySessionEvent(directPeer, {
type: 'receipt',
messageId: entryId,
status: 'opened',
createdAt: new Date().toISOString(),
});
}
};
});
bindSwipeToReply(panel);
if (chatState.selectionMode) {
panel.querySelectorAll('.chat-message-bubble').forEach((bubble) => {
const id = bubble.getAttribute('data-id');
bubble.classList.add('is-selectable');
bubble.classList.toggle('is-selected', chatState.selectedMessages.has(id));
});
}
panel.querySelectorAll('.chat-message-bubble').forEach((bubble) => {
const id = bubble.getAttribute('data-id');
if (!id || bubble.dataset.selectBound) return;
bubble.dataset.selectBound = '1';
/* A long press is how every messenger starts a multi-select; a plain tap
   only means "toggle" once that mode is already on. */
let holdTimer = 0;
const startHold = () => {
holdTimer = window.setTimeout(() => {
if (chatState.selectionMode) return;
enterSelectionMode(id);
navigator.vibrate?.(18);
}, 520);
};
const cancelHold = () => window.clearTimeout(holdTimer);
bubble.addEventListener('pointerdown', startHold);
['pointerup', 'pointercancel', 'pointerleave', 'pointermove'].forEach((name) => bubble.addEventListener(name, cancelHold));
bubble.addEventListener('click', (event) => {
if (!chatState.selectionMode) return;
if (event.target.closest('button, a, input, textarea')) return;
event.preventDefault();
event.stopPropagation();
toggleMessageSelected(id);
});
});
hydrateLottieNodes(panel);
positionMessageOverlays(panel);
const searchTarget = activeSearchQuery ? panel.querySelector('.search-hit') : null;
if (searchTarget) {
searchTarget.scrollIntoView({ block: 'center', behavior: 'smooth' });
searchTarget.classList.add('selected');
} else if (stickToBottom || !restoreThreadAnchor(panel, threadAnchor)) {
scrollThreadTo(panel, panel.scrollHeight);
}
}
function positionMessageOverlays(panel = document.getElementById('chatMessages')) {
if (!panel) return;
requestAnimationFrame(() => {
const panelRect = panel.getBoundingClientRect();
panel.querySelectorAll('.chat-message-bubble').forEach((bubble) => {
const rect = bubble.getBoundingClientRect();
const openDown = (rect.top - panelRect.top) < 145;
const openUp = (panelRect.bottom - rect.bottom) < 170;
bubble.querySelectorAll('.chat-message-toolbar').forEach((overlay) => {
overlay.classList.toggle('open-down', openDown && !openUp);
overlay.classList.toggle('open-up', openUp || !openDown);
});
const picker = bubble.querySelector('.chat-reaction-picker');
if (picker) {
const pickerWidth = Math.min(picker.offsetWidth || 360, window.innerWidth - 16);
const pickerHeight = picker.offsetHeight || 190;
const gap = 8;
const roomAbove = rect.top;
const roomBelow = window.innerHeight - rect.bottom;
let top = roomAbove > pickerHeight + gap || roomAbove > roomBelow
? rect.top - pickerHeight - gap
: rect.bottom + gap;
top = Math.max(8, Math.min(top, window.innerHeight - pickerHeight - 8));
let left = bubble.classList.contains('me') ? rect.right - pickerWidth : rect.left;
left = Math.max(8, Math.min(left, window.innerWidth - pickerWidth - 8));
picker.style.setProperty('position', 'fixed', 'important');
picker.style.setProperty('z-index', '120000', 'important');
picker.style.setProperty('top', `${Math.round(top)}px`, 'important');
picker.style.setProperty('left', `${Math.round(left)}px`, 'important');
picker.style.setProperty('right', 'auto', 'important');
picker.style.setProperty('bottom', 'auto', 'important');
picker.style.setProperty('max-width', `${Math.round(pickerWidth)}px`, 'important');
picker.classList.remove('open-up', 'open-down');
}
});
});
}
/* ---- Hidden messages -------------------------------------------------------
   A message the sender marks as hidden arrives masked: the recipient sees a
   placeholder and swipes it to reveal. Reveal state deliberately lives in
   memory only — reloading the app, or leaving and re-entering the chat, hides
   it again, which is the whole point of the feature.

   The flag rides alongside timerSeconds and replyToId in the message envelope,
   i.e. it is metadata rather than ciphertext. That matches how this protocol
   already carries per-message metadata; it means an observer of the transport
   can tell that A message is hidden, never what it says. */
function revealedMessageSet() {
if (!chatState.revealedMessages) chatState.revealedMessages = new Set();
return chatState.revealedMessages;
}
function isMessageHidden(entry) {
return Boolean(entry?.hidden) && !revealedMessageSet().has(entry.id);
}
function revealHiddenMessage(entryId) {
if (!entryId) return false;
const set = revealedMessageSet();
if (set.has(entryId)) return false;
set.add(entryId);
renderMessages();
return true;
}
/* ---- View-once media -------------------------------------------------------
   The same private-send toggle that hides a text message marks an attachment
   as view-once. Opening it consumes it: the object URL is revoked and the
   entry is flagged, so the media cannot be reopened from history and is not
   recoverable after a reload either (blob URLs never survive one). */
function isMediaConsumed(entry) {
return Boolean(entry?.viewOnce && entry?.viewOnceConsumed);
}
function consumeViewOnceMedia(entryId) {
const conversationId = chatState.activeConversationId;
const history = chatState.history[conversationId] || [];
const entry = history.find((item) => item.id === entryId);
if (!entry || !entry.viewOnce || entry.viewOnceConsumed) return null;
const url = entry.downloadUrl || '';
entry.viewOnceConsumed = true;
entry.viewOnceOpenedAt = new Date().toISOString();
entry.downloadUrl = '';
dropMessageMedia(entryId, { revokeUrl: false });
storeHistory();
renderMessages();
/* Give the browser a moment to finish opening the media before the URL is
   pulled out from under it. */
if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 60000);
return url;
}
function openViewOnceMedia(entryId) {
const conversationId = chatState.activeConversationId;
const entry = (chatState.history[conversationId] || []).find((item) => item.id === entryId);
const url = consumeViewOnceMedia(entryId);
if (!url) {
notify(t('این رسانه قبلاً باز شده و دیگر در دسترس نیست.', 'This media was already opened and is no longer available.'), 'warning');
return;
}
/* A blob: URL inherits the app's origin, so an SVG or HTML payload opened in
   a tab would run script with full access. Only provably inert media types
   are opened as documents; everything else is handed over as a download. */
if (isInlineSafeMediaType(entry?.mime)) {
window.open(url, '_blank', 'noopener');
} else {
const anchor = document.createElement('a');
anchor.href = url;
anchor.download = entry?.name || 'file.bin';
anchor.rel = 'noopener';
document.body.appendChild(anchor);
anchor.click();
anchor.remove();
}
notify(t('رسانهٔ یک‌بارمصرف باز شد؛ دیگر قابل باز کردن نیست.', 'View-once media opened; it cannot be opened again.'), 'info');
}

function isHiddenComposeActive() {
return Boolean(chatState.hiddenNext);
}
function syncHiddenToggleUi() {
const btn = document.getElementById('chatHiddenToggleBtn');
if (!btn) return;
const on = isHiddenComposeActive();
btn.classList.toggle('is-active', on);
btn.setAttribute('aria-pressed', on ? 'true' : 'false');
btn.title = on
? t('پیام مخفی: روشن', 'Hidden message: on')
: t('پیام مخفی', 'Hidden message');
const icon = btn.querySelector('i');
if (icon) {
/* Keep the solid glyph in both states — swapping to the regular weight made
   the button look empty rather than "off" — and carry the state on a class
   so the icon colours with the button. */
icon.className = 'fas fa-eye-slash';
icon.classList.toggle('is-active', on);
}
}
function toggleHiddenCompose() {
chatState.hiddenNext = !chatState.hiddenNext;
syncHiddenToggleUi();
notify(chatState.hiddenNext
? t('پیام بعدی مخفی ارسال می‌شود؛ گیرنده باید روی آن بکشد تا ببیند.', 'The next message will be sent hidden; the recipient swipes it to reveal.')
: t('حالت پیام مخفی خاموش شد.', 'Hidden message mode is off.'), 'info');
}

function bindSwipeReply(bubble, entryId, panel) {
if (!bubble || !entryId || bubble.dataset.swipeReplyBound === 'true') return;
bubble.dataset.swipeReplyBound = 'true';
let startX = 0;
let startY = 0;
let tracking = false;
bubble.addEventListener('pointerdown', (event) => {
if (!isCompactChatLayout() || event.pointerType === 'mouse') return;
startX = event.clientX;
startY = event.clientY;
tracking = true;
});
bubble.addEventListener('pointerup', (event) => {
if (!tracking) return;
tracking = false;
const dx = event.clientX - startX;
const dy = Math.abs(event.clientY - startY);
if (dy < 28 && Math.abs(dx) > 44) {
event.preventDefault();
event.stopPropagation();
/* Smart swipe: on a still-masked message the gesture reveals it, everywhere
   else it keeps its original meaning of "reply". One gesture, no new
   affordance to learn, and no ambiguity — a bubble is either masked or not. */
if (bubble.dataset.hiddenMasked === 'true') {
revealHiddenMessage(entryId);
return;
}
handleReplyMessage(entryId);
panel?.querySelectorAll('.chat-message-bubble').forEach((item) => item.classList.remove('selected'));
}
});
bubble.addEventListener('pointercancel', () => {
tracking = false;
});
}
function relabelThreadMenu(record) {
const isGroup = Boolean(record && record.type === 'group');
/* [button id, conversation wording, group wording] — the span carries the
   visible label, the title mirrors it for the hover/tooltip reader. */
const rows = [
['chatVoiceCallBtn', t('تماس صوتی', 'Voice call'), t('تماس صوتی گروهی', 'Group voice call')],
['chatVideoCallBtn', t('تماس تصویری', 'Video call'), t('تماس تصویری گروهی', 'Group video call')],
['chatLockNowBtn', t('قفل کردن گفتگو', 'Lock conversation'), t('قفل کردن گروه', 'Lock group')],
['chatSearchInChatBtn', t('جستجو در این گفتگو', 'Search in this chat'), t('جستجو در گروه', 'Search in group')],
['chatDeleteConversationBtn', t('حذف گفتگو', 'Delete conversation'), t('حذف تاریخچه گروه', 'Delete group history')],
];
rows.forEach(([id, plain, group]) => {
const button = document.getElementById(id);
if (!button) return;
const label = isGroup ? group : plain;
const span = button.querySelector('span');
if (span) span.textContent = label;
button.title = label;
});
}
function renderActivePeer() {
updateChatShellMode();
const peer = getActiveConversation();
/* The thread menu speaks with the voice of whatever is open: a group gets
   group calls, a group lock, search in the group and group-history delete;
   a conversation keeps the one-to-one wording. Called on every render, so a
   language switch re-renders and re-labels for free. */
relabelThreadMenu(peer);
/* The instant-lock button tracks the whole Secure Chat tab, not the thread —
   and this render is what the lock itself calls, with the conversation closed,
   so the sync has to run before the no-peer branch returns. Inlined rather
   than calling out to another part: the button must track the lock on every
   path that lands here, with nothing optional in between. */
const quickLockButton = document.getElementById('chatQuickLockBtn');
if (quickLockButton) {
const chatScreenLocked = typeof chatLockEnabled === 'function' && chatLockEnabled() && !chatState.chatUnlocked;
const quickLockIcon = quickLockButton.querySelector('i');
quickLockButton.classList.toggle('is-locked', chatScreenLocked);
quickLockButton.classList.toggle('is-unlocked', !chatScreenLocked);
if (quickLockIcon) quickLockIcon.className = `fas ${chatScreenLocked ? 'fa-lock' : 'fa-lock-open'}`;
quickLockButton.title = chatScreenLocked
? t('چت امن قفل است', 'Secure chat is locked')
: t('قفل فوری چت امن', 'Lock the secure chat now');
}
/* The info button is the only way into group management, so it has to follow
   the selection rather than sit there permanently. */
const spaceInfoBtn = document.getElementById('chatSpaceInfoBtn');
const verifyBtn = document.getElementById('chatVerifyKeyBtn');
verifyBtn?.classList.toggle('hidden', !directPeerFingerprintForBadge());
verifyBtn?.classList.toggle('is-verified', isPeerVerified(directPeerFingerprintForBadge()));
/* A group has no single session to create - each member has their own - so
   the button did nothing there and said nothing about it. Hidden rather than
   left as a control that quietly fails. activePeer() is not the test: it
   returns the group's own record for a group, so it is never null there. */
const directOpen = Boolean(peer) && peer.type !== 'group';
document.getElementById('chatStartSessionBtn')?.classList.toggle('hidden', !directOpen);
spaceInfoBtn?.classList.toggle('hidden', peer?.type !== 'group');
if (peer?.type !== 'group') closeSpaceInfoPanel();
else renderSpaceInfoPanel();
/* The meta line under the name is written in several branches below, so the
   group roster count has to be applied after all of them, not before. */
queueMicrotask(() => {
const current = getActiveConversation();
if (current?.type !== 'group') return;
const rows = spaceMemberRecords(current);
const online = rows.filter((row) => row.online).length;
const metaEl = document.getElementById('chatActivePeerMeta');
if (metaEl) {
metaEl.textContent = t(
`${rows.length} عضو · ${online} آنلاین`,
`${rows.length} members · ${online} online`,
);
/* Any path that rewrites the header — the periodic peer refresh included —
   has to leave the Calls view's own header standing. */
applyCallsThreadHeader();
}
});
const directPeer = activePeer();
const session = activeSession();
const thread = document.querySelector('.chat-thread');
const composerBar = document.querySelector('.chat-composer-bar');
const securityDrawer = document.querySelector('.chat-security-drawer');
const peerName = document.getElementById('chatActivePeerName');
const peerMeta = document.getElementById('chatActivePeerMeta');
const banner = document.getElementById('chatSessionBanner');
const remoteFingerprint = document.getElementById('chatRemoteFingerprint');
const keyMode = document.getElementById('chatSecurityKeyMode');
const connectBtn = document.getElementById('chatStartSessionBtn');
const deleteConversationBtn = document.getElementById('chatDeleteConversationBtn');
const sendBtn = document.getElementById('chatSendMessageBtn');
const sendFileBtn = document.getElementById('chatSendFileBtn');
const voiceMessageBtn = document.getElementById('chatVoiceMessageBtn');
const voiceBtn = document.getElementById('chatVoiceCallBtn');
const videoBtn = document.getElementById('chatVideoCallBtn');
if (!peer) {
/* The empty pane speaks with the voice of the list beside it: a group list
   says "pick a group" and shows no chat avatar or user wording; the chats
   list waits for a conversation. The calls view paints its own header on
   top of this via applyCallsThreadHeader below. */
const isGroupsView = chatState.activeView === 'groups';
peerName.textContent = isGroupsView
? t('یک گروه را انتخاب کنید', 'Select a group')
: chatState.activeView === 'chats'
? t('یک گفتگو را انتخاب کنید', 'Select a conversation')
: peerName.textContent;
peerMeta.textContent = hasActiveServerRestriction()
? restrictionText()
: isGroupsView
? t('بعد از انتخاب یک گروه، تاریخچه همین‌جا نمایش داده می‌شود.', 'After you pick a group, its history shows here.')
: t('برای شروع چت از دکمه شروع چت استفاده کنید.', 'Use Start chat to add a peer.');
/* Nothing is selected: an avatar belonging to nobody must not sit in the
   header — the groups pane especially must read as empty, not as "some
   user". */
document.getElementById('chatActiveAvatar')?.classList.add('hidden');
banner.classList.add('hidden');
composerBar?.classList.add('hidden');
securityDrawer?.classList.add('hidden');
thread?.classList.add('chat-thread-empty');
remoteFingerprint.textContent = '-';
keyMode.textContent = t('منتظر سشن', 'Waiting for session');
connectBtn.disabled = true;
deleteConversationBtn?.classList.add('hidden');
if (deleteConversationBtn) deleteConversationBtn.disabled = true;
/* No conversation open means nothing for the menu to act on. Left enabled, it
   kept whatever state the last conversation gave it. */
const idleMenuBtn = document.getElementById('chatThreadMenuBtn');
if (idleMenuBtn) {
idleMenuBtn.disabled = true;
idleMenuBtn.setAttribute('aria-expanded', 'false');
}
document.getElementById('chatThreadMenu')?.classList.add('hidden');
const idleLockBtn = document.getElementById('chatLockNowBtn');
if (idleLockBtn) idleLockBtn.disabled = true;
sendBtn.disabled = true;
sendFileBtn.disabled = true;
if (voiceMessageBtn) voiceMessageBtn.disabled = true;
voiceBtn.disabled = true;
videoBtn.disabled = true;
renderMessages();
/* This branch returns before the tail of the function, and it is the one the
   Calls view always takes — there is no peer to render. */
applyCallsThreadHeader();
return;
}
const displayName = peer.username || peer.name || peer.peerId;
const isTyping = chatState.typingTimers.has(getConversationKey(peer));
const busy = isCallBusy();
const hasRelay = Boolean(chatState.connected && chatState.ws?.readyState === WebSocket.OPEN);
/* A locked conversation is read-only: the composer, its attachment strip and
   every entry to a picker go away until the thread is unlocked again. Typing
   into a hidden box is impossible, and guardGroupSend() backs this up for
   anything that could still race a re-render. */
const activeThreadLocked = conversationLocked(getConversationKey(peer));
composerBar?.classList.toggle('hidden', chatState.activeView === 'calls' || chatState.activeView === 'connection' || activeThreadLocked);
if (activeThreadLocked) {
securityDrawer?.classList.add('hidden');
[sendBtn, sendFileBtn, voiceMessageBtn].forEach((button) => { if (button) button.disabled = true; });
if (chatState.selectionMode) exitSelectionMode();
}
// Last line of defence: whatever happened during a recording, an idle composer
// must never be left hidden. Every render checks and repairs it.
const capturing = chatState.mediaRecorder
&& (chatState.mediaRecorder.state === 'recording' || chatState.mediaRecorder.state === 'paused');
if (!capturing) {
document.querySelector('.chat-composer-surface')?.classList.remove('hidden');
document.getElementById('chatRecordingOverlay')?.classList.add('hidden');
document.getElementById('chatSendMessageBtn')?.classList.remove('hidden');
}
securityDrawer?.classList.remove('hidden');
thread?.classList.remove('chat-thread-empty');
peerName.textContent = displayName;
/* The key-change alert rides with the conversation it belongs to. Placed
   before the branches below, because every one of them ends in a return. */
const keyAlert = document.getElementById('chatKeyAlert');
if (keyAlert) keyAlert.classList.toggle('hidden', !(peer && !peer.type && peer.keyChangedAt));
if (peer.clientId === 'system') {
composerBar?.classList.add('hidden');
securityDrawer?.classList.add('hidden');
peerMeta.textContent = t('پیام‌های ارسالی از مدیریت سیستم', 'Broadcast messages from system administrator');
peerMeta.classList.remove('animate-pulse', 'text-sky-500');
const activeAvatar = document.getElementById('chatActiveAvatar');
if (activeAvatar) {
activeAvatar.innerHTML = `<i class="fas fa-bullhorn text-xl"></i>`;
activeAvatar.className = 'chat-avatar chat-active-avatar online';
}
banner.classList.add('hidden');
renderMessages();
return;
}
if (isTyping) {
peerMeta.textContent = t('در حال نوشتن...', 'Typing...');
peerMeta.classList.add('animate-pulse', 'text-sky-500');
} else {
peerMeta.classList.remove('animate-pulse', 'text-sky-500');
/* Their own words come first when they have set any — that is the line you
   look at to decide whether to call someone. */
const mood = String(peer.mood || '').trim();
if (peer.type) {
peerMeta.textContent = `${peer.type} • ${t('فضای امن محلی', 'Local secure space')}`;
} else {
/* Their own words keep the pill the chip used to have. As plain text the
   status read as the opening clause of the sentence after it; the bubble is
   what makes it legible as a status without repeating it twice on screen. */
const rest = `${peer.status === 'online' ? t('آنلاین', 'Online') : t('آفلاین', 'Offline')} • ${t('چت رمزنگاری‌شده', 'Encrypted chat')}`;
peerMeta.innerHTML = `${mood ? `<span class="chat-meta-mood">${app().escapeHTML(mood)}</span>` : ''}${app().escapeHTML(rest)}`;
}
}
/* And as a chip beside the name, where it is unmissable. */
const nameChip = document.getElementById('chatActivePeerMood');
if (nameChip) {
const mood = String(peer.mood || '').trim();
nameChip.textContent = mood;
nameChip.classList.toggle('hidden', !mood);
}
const activeAvatar = document.getElementById('chatActiveAvatar');
if (activeAvatar) {
/* Un-hidden on purpose: the empty-pane branch hides it (nothing is selected,
   nobody's face belongs there), and this render is the only place that can
   put it back. */
activeAvatar.classList.remove('hidden');
activeAvatar.innerHTML = peer.avatarData ? `<img src="${peer.avatarData}" alt="">` : app().escapeHTML(initials(displayName));
/* The dot under the avatar, right side — the same reading the list row
   gives: a person is online or offline; a group is a summary of its people
   (everybody / somebody / nobody / dissolved), through the same
   groupPresence() the badge uses. */
if (peer.type === 'group') {
const presence = (typeof groupPresence === 'function') ? groupPresence(peer) : null;
const presenceClass = presence?.dissolved ? 'dissolved'
: presence?.all ? 'online'
: presence?.some ? 'partial' : 'offline';
activeAvatar.className = `chat-avatar ${presenceClass}`;
} else {
activeAvatar.className = `chat-avatar ${peer.status === 'online' ? 'online' : 'offline'}`;
}
}
remoteFingerprint.textContent = shortSecurityValue(peer.fingerprint || peer.conversationId || '-');
remoteFingerprint.title = peer.fingerprint || peer.conversationId || '-';
keyMode.textContent = sessionSecurityText(session);
connectBtn.disabled = Boolean(peer.type) || !chatState.connected || !chatState.peer;
deleteConversationBtn?.classList.remove('hidden');
if (deleteConversationBtn) deleteConversationBtn.disabled = false;
/* "Lock this chat" is only meaningful once there is a PIN to lock it with, so
   it is offered greyed out rather than hidden: a hidden control teaches
   nobody that the feature exists. */
/* A locked conversation's menu is not a menu.
 *
 * Everything in it acts on the conversation — call it, verify its key, delete
 * it — and all of that was still reachable while the thread sat behind its own
 * lock. A lock that only hides the messages while leaving every action against
 * them one tap away is decoration. The button is disabled and the sheet is
 * shut, so a menu that happens to be open when the timer fires closes itself. */
const threadMenuBtn = document.getElementById('chatThreadMenuBtn');
const threadMenu = document.getElementById('chatThreadMenu');
const lockedNow = conversationLocked(peer.conversationId || getConversationKey(peer));
if (threadMenuBtn) {
threadMenuBtn.disabled = lockedNow;
threadMenuBtn.setAttribute('aria-expanded', 'false');
}
if (threadMenu && lockedNow) threadMenu.classList.add('hidden');

const lockNowBtn = document.getElementById('chatLockNowBtn');
if (lockNowBtn) {
/* `peer` is what this scope calls the open conversation. Writing
   `conversation` here threw a ReferenceError on every render — and because
   this runs inside renderActivePeer(), it took the whole message pane down
   with it, not just the button. */
const key = peer.conversationId || getConversationKey(peer);
const ready = conversationHasLock(key) && !conversationLocked(key);
lockNowBtn.disabled = !ready;
lockNowBtn.title = conversationHasLock(key)
? t('قفل کردن چت', 'Lock this chat')
: t('اول برای این گفتگو رمز بگذارید.', 'Set a PIN for this conversation first.');
}
/* activeThreadLocked (computed above) keeps these shut on a locked thread
   even though the relay is up — being connected is not being allowed. */
sendBtn.disabled = activeThreadLocked || Boolean(!peer.type && (!hasRelay || !chatState.peer));
sendFileBtn.disabled = activeThreadLocked || Boolean(!peer.type && (!hasRelay || !chatState.peer));
if (voiceMessageBtn) voiceMessageBtn.disabled = activeThreadLocked || Boolean(!peer.type && (!hasRelay || !chatState.peer));
/* `Boolean(peer.type)` disabled calling for every space, which was right while
   a group call did not exist. Groups can be called now; other space types
   still cannot. */
const spaceBlocksCalls = Boolean(peer.type) && peer.type !== 'group';
voiceBtn.disabled = busy || spaceBlocksCalls || !hasRelay || !chatState.peer;
videoBtn.disabled = busy || spaceBlocksCalls || !hasRelay || !chatState.peer || !chatState.profile.allowVideo;
document.getElementById('chatSecureBadge')?.classList.toggle('hidden', !(peer.type || session?.cryptoKey));
/* Our own key change, not yet accepted over there: say that, not a generic
   session status. This is the state the renegotiation loop used to paper over
   with a toast per failed message. */
const waitingOnKeyAccept = Boolean(directPeer?.peerId && !peer.type && chatState.awaitingKeyAccept?.has(directPeer.peerId));
if (waitingOnKeyAccept) {
banner.textContent = t('کلید چت شما عوض شده و طرف مقابل هنوز آن را تأیید نکرده است — تا پذیرش او، سشن امن زنده برقرار نمی‌شود و پس از پذیرش خودکار ادامه می‌یابد.', 'Your chat key changed and the other side has not accepted it yet — the live secure session waits for their approval and resumes automatically once given.');
banner.classList.remove('hidden');
} else if (session?.cryptoKey) {
banner.textContent = t('سشن رمزنگاری فعال است و پیام‌ها روی AES-GCM رمز می‌شوند.', 'An encrypted session is active and messages are protected with AES-GCM.');
banner.classList.remove('hidden');
} else if (peer.type) {
banner.textContent = t('گروه محلی ساخته شد. برای اعضای آنلاین با سشن امن، پیام ارسال می‌شود.', 'Local group is ready. Messages are sent to online members with secure sessions.');
banner.classList.remove('hidden');
} else {
banner.textContent = '';
banner.classList.add('hidden');
}
scheduleSessionWarmup(directPeer);
renderMessages();
}
function scheduleSessionWarmup(peerRecord, delayMs = 250) {
if (!peerRecord || peerRecord.type || isSelfPeerRecord(peerRecord)) return;
if (peerRecord.status !== 'online' || !chatState.connected || !chatState.peer) return;
const existing = chatState.sessions.get(peerRecord.peerId);
if (existing?.cryptoKey || existing?.connection?.open) return;
if (chatState.sessionWarmupTimers.has(peerRecord.peerId) || chatState.sessionWarmupInFlight.has(peerRecord.peerId)) return;
const timer = setTimeout(async () => {
chatState.sessionWarmupTimers.delete(peerRecord.peerId);
if (chatState.sessionWarmupInFlight.has(peerRecord.peerId)) return;
chatState.sessionWarmupInFlight.add(peerRecord.peerId);
try {
await ensureDirectSession(peerRecord, { silent: true });
} catch (error) {
console.warn('Secure chat session warmup failed:', error);
} finally {
chatState.sessionWarmupInFlight.delete(peerRecord.peerId);
}
}, delayMs);
chatState.sessionWarmupTimers.set(peerRecord.peerId, timer);
}
function appendHistory(conversationId, entry) {
if (!chatState.history[conversationId]) {
chatState.history[conversationId] = [];
}
const incoming = entry?.direction === 'in';
const visibleNow = incoming && isConversationCurrentlyVisible(conversationId);
if (incoming) {
entry.unread = !visibleNow;
}
if (entry?.id) {
const duplicate = chatState.history[conversationId].find((item) => item.id === entry.id);
if (duplicate) {
const nextEntry = { ...entry };
if (duplicate.direction === 'out' && entry.direction === 'in') {
nextEntry.direction = 'out';
}
/* A duplicate usually means the sender retried after a lost receipt. The
   copy in hand is the OLDER version of the truth: it must not roll back an
   applied edit, revive text the user already replaced, or demote a status
   the conversation has moved past (which would re-arm receipt sending). */
if (duplicate.edited && !nextEntry.edited) nextEntry.text = duplicate.text;
nextEntry.status = chatStatusRank(duplicate.status) >= chatStatusRank(nextEntry.status)
? duplicate.status
: nextEntry.status;
Object.assign(duplicate, {
...nextEntry,
unread: incoming ? !visibleNow : duplicate.unread,
reactions: duplicate.reactions || entry.reactions,
downloadUrl: duplicate.downloadUrl || entry.downloadUrl,
});
storeHistory();
renderPeers();
renderMessages();
return duplicate;
}
}
chatState.history[conversationId].push(entry);
/* A hard 300-entry cap deleted the oldest messages outright while the
   on-screen note told the user to "use search" — for data that no longer
   existed. 2000 keeps the store bounded (the blob is size-capped by the
   quota error path) while the render window, not the store, limits what is
   drawn. */
chatState.history[conversationId] = chatState.history[conversationId].slice(-2000);
storeHistory();
/* The first message is the moment a passing presence record becomes someone
   worth keeping. saveContacts() is the only thing that writes the book, and
   nothing else calls it on this path, so without this the person you are
   talking to is gone after a reload. Once per conversation, not per message. */
if (chatState.history[conversationId].length === 1) saveContacts();
renderPeers();
renderMessages();
if (entry.direction === 'in') {
const conversationRecord = conversationRecordById(conversationId);
const muted = Boolean(conversationRecord?.muted);
if (!muted) playSound('message');
if (!visibleNow && !muted) {
const sender = conversationRecord;
const senderName = sender?.username || sender?.name || entry.senderName || t('کاربر P00RIJA', 'P00RIJA User');
const unreadCount = unreadConversationCount(conversationId);
const label = notificationMessageLabel(entry).slice(0, 80) || t('پیام جدید', 'New message');
/* What the three lock levels may show about this arrival:
   - app locked (vault shut, lock screen up): the screen shows nothing and
     the key to the content is the sender's business — the desktop shell
     gets a bare "new message" line, nothing else, anywhere;
   - Secure Chat tab locked: the user asked for the badge and nothing else —
     no preview anywhere, the unread counter below is the whole notice;
   - only this conversation locked: the sender's name may show, the text may
     not — the thread is sealed precisely so its words stay off screens the
     owner has not opened. */
const appLocked = Boolean(appState()?.isLocked);
const chatScreenLocked = typeof chatLockEnabled === 'function' && chatLockEnabled() && !chatState.chatUnlocked;
const conversationLockedNow = typeof conversationLocked === 'function' && conversationLocked(conversationId);
if (appLocked) {
if (typeof sendDesktopSystemNotification === 'function') {
sendDesktopSystemNotification(t('پیام جدید در چت امن', 'New message in Secure Chat'), 'info');
}
} else if (!chatScreenLocked) {
const text = conversationLockedNow
? `${senderName}: ${t('پیام جدید', 'New message')}`
: `${senderName}: ${label}`;
app().showNotification?.(text, 'info');
}
window.dispatchEvent(new CustomEvent('poorija:chat-unread', {
detail: {
count: 1,
peerId: conversationId,
conversationId,
conversationUnread: unreadCount
}
}));
}
}
}
