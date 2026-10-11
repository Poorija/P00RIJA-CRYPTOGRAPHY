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
   Scheduled messages: written now, sent at a time the sender picks.
   ============================================================================

   Entirely on this device. A server that held a message until a given time
   would be a server holding a message — which is exactly what this design
   refuses everywhere else — so the scheduled text waits in this device's own
   encrypted history, marked 'scheduled', and is encrypted and sent through
   the ordinary send path (deliverTextEntry) when its time comes.

   The cost of that is said in the interface rather than hidden: the app has
   to be running for the message to go. If it is closed at the chosen time,
   the message goes the next time it opens and the relay is reachable.

   Only the device that scheduled a message sends it. The entry still reaches
   the account's other devices — as history does — and they show it as
   scheduled on another device, but they never send a second copy.
   ============================================================================ */

const SCHEDULE_TICK_MS = 15000;
const SCHEDULE_MIN_LEAD_MS = 60 * 1000;
const SCHEDULE_MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

function scheduledEntries() {
  const out = [];
  for (const [key, entries] of Object.entries(chatState.history || {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry?.status === 'scheduled' && entry.direction === 'out') out.push({ key, entry });
    }
  }
  return out;
}
function scheduledHere(entry) {
  return Boolean(entry?.scheduledBy) && entry.scheduledBy === getDeviceId();
}

function formatScheduleMoment(value) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  const today = new Date();
  const sameDay = at.toDateString() === today.toDateString();
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const date = at.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${date} ${time}`;
}

/* ---- choosing the time ---------------------------------------------------- */

function quickScheduleChoices(now = new Date()) {
  const choices = [];
  const add = (label, at) => {
    if (at.getTime() - now.getTime() >= SCHEDULE_MIN_LEAD_MS) choices.push({ label, at });
  };
  add(t('۳۰ دقیقهٔ دیگر', 'In 30 minutes'), new Date(now.getTime() + 30 * 60 * 1000));
  add(t('یک ساعت دیگر', 'In 1 hour'), new Date(now.getTime() + 60 * 60 * 1000));
  const evening = new Date(now); evening.setHours(21, 0, 0, 0);
  add(t('امشب ساعت ۲۱', 'Tonight at 21:00'), evening);
  const morning = new Date(now); morning.setDate(morning.getDate() + 1); morning.setHours(9, 0, 0, 0);
  add(t('فردا ساعت ۹', 'Tomorrow at 09:00'), morning);
  return choices;
}
function localDateTimeValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function closeScheduleModal() {
  document.getElementById('chatScheduleModal')?.remove();
}
function openScheduleModal() {
  const conversation = getActiveConversation();
  const composer = document.getElementById('chatComposer');
  const text = String(composer?.value || '').trim();
  if (!conversation) {
    notify(t('اول یک گفتگو را باز کنید.', 'Open a conversation first.'), 'warning');
    return;
  }
  if (conversation.type === 'saved' || conversation.system || conversation.clientId === 'system') {
    notify(t('زمان‌بندی برای این گفتگو در دسترس نیست.', 'Scheduling is not available in this conversation.'), 'warning');
    return;
  }
  if (!text) {
    notify(t('اول متن پیام را بنویسید، بعد زمان ارسال را انتخاب کنید.', 'Write the message first, then choose when to send it.'), 'info');
    composer?.focus();
    return;
  }
  if (chatState.editingMessageId) {
    notify(t('در حال ویرایش یک پیام هستید.', 'You are editing a message.'), 'warning');
    return;
  }
  if (Number(chatState.timerSeconds || 0) > 0) {
    notify(t('پیام خودتخریب را نمی‌شود زمان‌بندی کرد؛ اول تایمر را خاموش کنید.', 'A self-destruct message cannot be scheduled; turn the timer off first.'), 'warning');
    return;
  }
  closeScheduleModal();
  const now = new Date();
  const modal = document.createElement('div');
  modal.id = 'chatScheduleModal';
  modal.className = 'chat-schedule-modal';
  const quick = quickScheduleChoices(now);
  const initial = quick[1]?.at || new Date(now.getTime() + 60 * 60 * 1000);
  modal.innerHTML = `
    <div class="chat-schedule-backdrop" data-schedule-close></div>
    <section class="chat-schedule-card" role="dialog" aria-modal="true" aria-labelledby="chatScheduleTitle">
      <header>
        <h4 id="chatScheduleTitle">${app().escapeHTML(t('زمان‌بندی ارسال', 'Schedule message'))}</h4>
        <button type="button" data-schedule-close aria-label="${app().escapeHTML(t('بستن', 'Close'))}"><i class="fas fa-xmark"></i></button>
      </header>
      <p class="chat-schedule-preview"></p>
      <div class="chat-schedule-quick">
        ${quick.map((choice, index) => `<button type="button" data-schedule-quick="${index}">${app().escapeHTML(choice.label)}</button>`).join('')}
      </div>
      <label class="chat-schedule-custom">
        <span>${app().escapeHTML(t('یا تاریخ و ساعت دلخواه', 'Or a date and time'))}</span>
        <input type="datetime-local" id="chatScheduleAt" value="${localDateTimeValue(initial)}" min="${localDateTimeValue(new Date(now.getTime() + SCHEDULE_MIN_LEAD_MS))}">
      </label>
      <p class="chat-schedule-note">${app().escapeHTML(t(
        'پیام روی همین دستگاه می‌ماند و سر وقت از همین دستگاه فرستاده می‌شود. اگر برنامه آن موقع بسته باشد، با باز شدن بعدی فرستاده می‌شود.',
        'The message waits on this device and is sent from it at that time. If the app is closed then, it is sent the next time it opens.',
      ))}</p>
      <footer>
        <button type="button" class="chat-soft-btn" data-schedule-close>${app().escapeHTML(t('انصراف', 'Cancel'))}</button>
        <button type="button" class="chat-schedule-confirm" data-schedule-confirm>${app().escapeHTML(t('زمان‌بندی', 'Schedule'))}</button>
      </footer>
    </section>`;
  modal.querySelector('.chat-schedule-preview').textContent = typeof plainMessageText === 'function' ? plainMessageText(text).slice(0, 160) : text.slice(0, 160);
  document.body.appendChild(modal);
  const input = modal.querySelector('#chatScheduleAt');
  modal.querySelectorAll('[data-schedule-close]').forEach((node) => node.addEventListener('click', closeScheduleModal));
  modal.querySelectorAll('[data-schedule-quick]').forEach((button) => {
    button.addEventListener('click', () => {
      const choice = quick[Number(button.dataset.scheduleQuick)];
      if (choice) scheduleComposerMessage(choice.at);
    });
  });
  modal.querySelector('[data-schedule-confirm]')?.addEventListener('click', () => {
    const at = new Date(input?.value || '');
    scheduleComposerMessage(at);
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeScheduleModal();
  });
  input?.focus();
}

/* ---- writing it ----------------------------------------------------------- */

function scheduleComposerMessage(at) {
  const when = at instanceof Date ? at : new Date(at);
  const lead = when.getTime() - Date.now();
  if (Number.isNaN(when.getTime()) || lead < SCHEDULE_MIN_LEAD_MS - 5000) {
    notify(t('زمان باید دست‌کم یک دقیقه بعد از حالا باشد.', 'The time must be at least a minute from now.'), 'warning');
    return false;
  }
  if (lead > SCHEDULE_MAX_AHEAD_MS) {
    notify(t('حداکثر تا یک سال بعد را می‌شود زمان‌بندی کرد.', 'Messages can be scheduled up to a year ahead.'), 'warning');
    return false;
  }
  const conversation = getActiveConversation();
  const composer = document.getElementById('chatComposer');
  const text = String(composer?.value || '').trim();
  if (!conversation || !text) return false;
  const key = getConversationKey(conversation);
  const entry = {
    id: generateId('msg'),
    direction: 'out',
    type: 'text',
    text,
    status: 'scheduled',
    scheduledAt: when.toISOString(),
    scheduledBy: getDeviceId(),
    expiresAt: '',
    timerSeconds: 0,
    hidden: typeof isHiddenComposeActive === 'function' ? isHiddenComposeActive() : false,
    replyToId: chatState.replyToId || '',
    createdAt: new Date().toISOString(),
  };
  const preview = typeof takeComposerPreview === 'function' ? takeComposerPreview(text) : null;
  if (preview) entry.preview = preview;
  if (conversation.type === 'group') {
    entry.senderName = chatState.profile.name || t('شما', 'You');
    entry.senderPeerId = chatState.peerId || '';
    entry.senderFingerprint = chatState.identity?.fingerprint || '';
  }
  chatState.hiddenNext = false;
  if (typeof syncHiddenToggleUi === 'function') syncHiddenToggleUi();
  appendHistory(key, entry);
  composer.value = '';
  if (typeof setDraft === 'function') setDraft(key, '');
  if (typeof syncComposerHeight === 'function') syncComposerHeight(composer);
  if (typeof clearMessageContext === 'function') clearMessageContext();
  closeScheduleModal();
  notify(t(`برای ${formatScheduleMoment(entry.scheduledAt)} زمان‌بندی شد.`, `Scheduled for ${formatScheduleMoment(entry.scheduledAt)}.`), 'success');
  armScheduleTimer();
  return entry;
}

/* ---- sending it ----------------------------------------------------------- */

function relayReachableForSchedule() {
  return Boolean(chatState.connected && chatState.ws?.readyState === WebSocket.OPEN);
}

/* The message goes to the end of the thread with the time it actually left:
   the recipient reads it as sent then, and so should the sender. */
async function dispatchScheduledEntry(key, entry, { force = false } = {}) {
  if (!entry || entry.status !== 'scheduled') return false;
  if (!scheduledHere(entry)) return false;
  if (!force && Date.parse(entry.scheduledAt || 0) > Date.now()) return false;
  const conversation = typeof conversationRecordById === 'function' ? conversationRecordById(key) : null;
  if (!conversation) return false;
  if (conversation.blocked) return false;
  /* A verified contact whose key changed waits, scheduled, until the new key
     is checked — the same rule a message typed now meets. */
  if (typeof refuseIfVerifiedKeyChanged === 'function' && refuseIfVerifiedKeyChanged(conversation, { quiet: true })) return false;
  if (!relayReachableForSchedule() && !chatState.sessions.get(conversation.peerId)?.connection?.open) return false;
  const list = chatState.history[key] || [];
  const index = list.indexOf(entry);
  if (index >= 0) { list.splice(index, 1); list.push(entry); }
  entry.status = 'queued';
  entry.sentLaterAt = new Date().toISOString();
  entry.createdAt = entry.sentLaterAt;
  storeHistory();
  renderMessages();
  renderPeers();
  try {
    await deliverTextEntry(conversation, entry, { interactive: false });
  } catch (error) {
    console.warn('[Schedule] the scheduled message could not be sent:', error);
    markMessageStatus(key, entry.id, 'failed');
  }
  if (typeof mirrorToSiblings === 'function') mirrorToSiblings(key, entry);
  return true;
}

let scheduleDispatchRunning = false;
async function dispatchDueScheduled() {
  if (scheduleDispatchRunning) return;
  if (typeof isUnlocked === 'function' && !isUnlocked()) return;
  scheduleDispatchRunning = true;
  try {
    const now = Date.now();
    const due = scheduledEntries()
      .filter(({ entry }) => scheduledHere(entry) && Date.parse(entry.scheduledAt || 0) <= now)
      .sort((a, b) => Date.parse(a.entry.scheduledAt || 0) - Date.parse(b.entry.scheduledAt || 0));
    let sent = 0;
    for (const { key, entry } of due) {
      if (await dispatchScheduledEntry(key, entry)) sent += 1;
    }
    if (sent && document.visibilityState === 'visible') {
      notify(sent === 1
        ? t('پیام زمان‌بندی‌شده فرستاده شد.', 'A scheduled message was sent.')
        : t(`${sent} پیام زمان‌بندی‌شده فرستاده شد.`, `${sent} scheduled messages were sent.`), 'info');
    }
  } finally {
    scheduleDispatchRunning = false;
  }
}

/* A tick every few seconds is cheap, but a message due in four seconds
   should not wait fifteen: the timer is also armed for the next due entry. */
let scheduleTimer = null;
function armScheduleTimer() {
  if (scheduleTimer) window.clearTimeout(scheduleTimer);
  const next = scheduledEntries()
    .filter(({ entry }) => scheduledHere(entry))
    .map(({ entry }) => Date.parse(entry.scheduledAt || 0))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  if (!next) { scheduleTimer = null; return; }
  const wait = Math.max(500, Math.min(SCHEDULE_TICK_MS, next - Date.now() + 200));
  scheduleTimer = window.setTimeout(() => {
    scheduleTimer = null;
    dispatchDueScheduled().catch(() => {}).finally(armScheduleTimer);
  }, wait);
}

function cancelScheduledEntry(key, entryId) {
  const list = chatState.history[key] || [];
  const index = list.findIndex((item) => item.id === entryId);
  if (index < 0 || list[index].status !== 'scheduled') return false;
  const [removed] = list.splice(index, 1);
  storeHistory({ immediate: true });
  renderMessages();
  renderPeers();
  armScheduleTimer();
  const composer = document.getElementById('chatComposer');
  if (composer && !composer.value.trim() && removed?.text && chatState.activeConversationId === key) {
    composer.value = removed.text;
    composer.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return true;
}

async function manageScheduledEntry(entryId) {
  const key = chatState.activeConversationId;
  const entry = (chatState.history[key] || []).find((item) => item.id === entryId);
  if (!entry || entry.status !== 'scheduled') return;
  if (!scheduledHere(entry)) {
    await PoorijaDialogs.alert(t(
      `این پیام روی دستگاه دیگر شما برای ${formatScheduleMoment(entry.scheduledAt)} زمان‌بندی شده و همان دستگاه آن را می‌فرستد.`,
      `This message is scheduled on your other device for ${formatScheduleMoment(entry.scheduledAt)}, and that device sends it.`,
    ));
    return;
  }
  const choice = await PoorijaDialogs.choose(
    t(`زمان‌بندی‌شده برای ${formatScheduleMoment(entry.scheduledAt)}`, `Scheduled for ${formatScheduleMoment(entry.scheduledAt)}`),
    [
      { value: 'now', label: t('همین حالا بفرست', 'Send now') },
      { value: 'cancel', label: t('لغو و برگرداندن متن به کادر پیام', 'Cancel and put the text back in the composer') },
    ],
    { cancelLabel: t('بستن', 'Close') },
  );
  if (choice === 'now') {
    if (!await dispatchScheduledEntry(key, entry, { force: true })) {
      notify(t('الان اتصال برقرار نیست؛ پیام سر وقت یا با برقراری اتصال فرستاده می‌شود.', 'There is no connection right now; the message goes at its time or once connected.'), 'warning');
    }
  } else if (choice === 'cancel') {
    cancelScheduledEntry(key, entryId);
  }
}

/* The chip in a scheduled message's footer (drawn by 27-message-render.js). */
function scheduledChipHtml(entry) {
  if (entry?.status !== 'scheduled' || !entry.scheduledAt) return '';
  const elsewhere = !scheduledHere(entry);
  const label = formatScheduleMoment(entry.scheduledAt);
  const title = elsewhere
    ? t('روی دستگاه دیگر شما زمان‌بندی شده', 'Scheduled on your other device')
    : t('زمان‌بندی‌شده — برای ارسال فوری یا لغو بزنید', 'Scheduled — tap to send now or cancel');
  return `<button type="button" class="chat-scheduled-chip ${elsewhere ? 'is-elsewhere' : ''}" data-chat-scheduled="${app().escapeHTML(entry.id)}" title="${app().escapeHTML(title)}"><i class="fas fa-clock"></i> ${app().escapeHTML(label)}</button>`;
}

document.getElementById('chatMessages')?.addEventListener('click', (event) => {
  const chip = event.target.closest?.('[data-chat-scheduled]');
  if (!chip) return;
  event.preventDefault();
  event.stopPropagation();
  manageScheduledEntry(chip.dataset.chatScheduled || '').catch(console.error);
}, true);
document.getElementById('chatScheduleBtn')?.addEventListener('click', () => openScheduleModal());
/* Right-click (or a long press, which browsers report the same way) on the
   send button is the shortcut every other messenger uses. */
document.getElementById('chatSendMessageBtn')?.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  openScheduleModal();
});

window.setInterval(() => { dispatchDueScheduled().catch(() => {}); }, SCHEDULE_TICK_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') dispatchDueScheduled().catch(() => {});
});
window.addEventListener('online', () => { window.setTimeout(() => dispatchDueScheduled().catch(() => {}), 3000); });
window.setTimeout(armScheduleTimer, 5000);

window.openScheduleModal = openScheduleModal;
window.scheduleComposerMessage = scheduleComposerMessage;
window.dispatchDueScheduled = dispatchDueScheduled;
