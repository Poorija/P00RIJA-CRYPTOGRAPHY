/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 10 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Swipe to reply, and selecting several messages at once
*/

/* =====================================================================
   Swipe to reply, and selecting several messages at once
   ---------------------------------------------------------------------
   Replying took three taps: open the toolbar, find the arrow, hit it.
   Forwarding more than one message was not possible at all - you did it
   one message at a time, and each one opened its own destination picker.
   ===================================================================== */
/* Pointer capture is best-effort. Calling it for a pointer the browser does not
   consider active throws InvalidStateError, and letting that escape aborts the
   rest of the handler — the swipe armed but the reply never opened. */
function capturePointerSafely(element, pointerId) {
  try { element.setPointerCapture?.(pointerId); } catch (_error) { /* not capturable */ }
}
function releasePointerSafely(element, pointerId) {
  try { element.releasePointerCapture?.(pointerId); } catch (_error) { /* already gone */ }
}
const SWIPE_TRIGGER_PX = 56;
const SWIPE_MAX_PX = 88;

/* Drag a bubble toward the reply direction and let go: the further it goes the
   more the arrow shows, and past the trigger it snaps back and arms the reply.
   Bound per bubble on every render, guarded so a re-render cannot stack them. */
function bindSwipeToReply(panel) {
  const rtl = document.documentElement.dir === 'rtl';
  panel.querySelectorAll('.chat-message-bubble:not([data-swipe-bound])').forEach((bubble) => {
    bubble.dataset.swipeBound = '1';
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let horizontal = null;

    const reset = (animate = true) => {
      bubble.style.transition = animate ? 'transform 0.18s cubic-bezier(0.22, 1, 0.36, 1)' : '';
      bubble.style.setProperty('--swipe-x', '0px');
      bubble.classList.remove('is-swiping', 'is-swipe-armed');
      window.setTimeout(() => { bubble.style.transition = ''; }, 200);
    };

    bubble.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target.closest('button, a, input, textarea, .chat-poll-option, .modern-audio-player')) return;
      if (chatState.selectionMode) return;
      dragging = true;
      horizontal = null;
      startX = event.clientX;
      startY = event.clientY;
    });
    bubble.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (horizontal === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        /* Decide once. Guessing again mid-gesture is what makes a swipe fight
           the scroll. */
        horizontal = Math.abs(dx) > Math.abs(dy) * 1.4;
        if (!horizontal) { dragging = false; return; }
        bubble.classList.add('is-swiping');
        capturePointerSafely(bubble, event.pointerId);
      }
      /* Reply pulls toward the start edge, which is the right in Persian. */
      const travel = rtl ? Math.max(0, dx) : Math.max(0, -dx);
      const clamped = Math.min(SWIPE_MAX_PX, travel);
      bubble.style.setProperty('--swipe-x', `${rtl ? clamped : -clamped}px`);
      bubble.classList.toggle('is-swipe-armed', clamped >= SWIPE_TRIGGER_PX);
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      releasePointerSafely(bubble, event.pointerId);
      const armed = bubble.classList.contains('is-swipe-armed');
      reset();
      if (!armed) return;
      const id = bubble.getAttribute('data-id');
      if (id) {
        handleReplyMessage(id);
        navigator.vibrate?.(12);
      }
    };
    bubble.addEventListener('pointerup', finish);
    bubble.addEventListener('pointercancel', finish);
  });
}

/* ---------------- selecting several messages ----------------------- */
function selectionCount() {
  return chatState.selectedMessages.size;
}
/* The selection bar sits above the thread, so showing or hiding it resizes the
   pane. Do that first and the thread re-renders against the layout it will
   actually end up in, which is what keeps the scroll position exact. */
function enterSelectionMode(firstId) {
  chatState.selectionMode = true;
  chatState.selectedMessages.clear();
  if (firstId) chatState.selectedMessages.add(firstId);
  syncSelectionBar();
  renderMessages();
}
function exitSelectionMode() {
  chatState.selectionMode = false;
  chatState.selectedMessages.clear();
  syncSelectionBar();
  renderMessages();
}
function toggleMessageSelected(id) {
  if (!chatState.selectionMode) return;
  if (chatState.selectedMessages.has(id)) chatState.selectedMessages.delete(id);
  else chatState.selectedMessages.add(id);
  if (!chatState.selectedMessages.size) {
    exitSelectionMode();
    return;
  }
  syncSelectionBar();
  renderMessages();
}
function syncSelectionBar() {
  const bar = document.getElementById('chatSelectionBar');
  if (!bar) return;
  bar.classList.toggle('hidden', !chatState.selectionMode);
  const count = document.getElementById('chatSelectionCount');
  if (count) count.textContent = String(selectionCount());
}
function selectedEntriesInOrder() {
  const history = chatState.history[chatState.activeConversationId] || [];
  return history.filter((entry) => chatState.selectedMessages.has(entry.id));
}

async function forwardSelectionTo(destinationKey) {
  const entries = selectedEntriesInOrder();
  if (!entries.length || !destinationKey) return;
  closeForwardModal();
  const total = entries.length;
  let sent = 0;
  for (const entry of entries) {
    /* Sequential on purpose: each forward re-points the active conversation,
       and racing them would interleave two sends into the wrong threads. */
    // eslint-disable-next-line no-await-in-loop
    await forwardEntryToDestination(entry, destinationKey);
    sent += 1;
    setTransferBanner(t(`هدایت ${sent} از ${total}…`, `Forwarding ${sent} of ${total}…`), (sent / total) * 100);
  }
  clearTransferBanner();
  exitSelectionMode();
  notify(t(`${sent} پیام هدایت شد.`, `${sent} messages forwarded.`), 'success');
}

async function deleteSelection() {
  const entries = selectedEntriesInOrder();
  if (!entries.length) return;
  if (!await PoorijaDialogs.confirm(t(`${entries.length} پیام حذف شود؟`, `Delete ${entries.length} messages?`))) return;
  const conversationId = chatState.activeConversationId;
  const directPeer = activePeer();
  entries.forEach((entry) => {
    deleteMessageEntry(conversationId, entry.id, { broadcast: Boolean(directPeer), peerRecord: directPeer });
  });
  exitSelectionMode();
}

function copySelection() {
  const entries = selectedEntriesInOrder();
  if (!entries.length) return;
  const text = entries
    .map((entry) => entry.text || mediaEntryLabel(entry) || richEntryLabel(entry) || '')
    .filter(Boolean)
    .join('\n');
  if (!text) {
    notify(t('این پیام‌ها متنی برای کپی ندارند.', 'Those messages have no text to copy.'), 'warning');
    return;
  }
  navigator.clipboard?.writeText(text)
    .then(() => notify(t(`${entries.length} پیام کپی شد.`, `${entries.length} messages copied.`), 'success'))
    .catch(() => notify(t('کپی ناموفق بود.', 'Copy failed.'), 'warning'));
}
