/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 26 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Address book
*/

/* ============================================================================
   Address book
   ----------------------------------------------------------------------------
   The Calls view used to render the same call log twice — once into the rail
   and once into the thread panel — so a desktop window showed two copies of
   the filters, the search box and the empty state, and the thread still wore
   the "pick someone to chat with" placeholder above it. The two columns now
   have one job each: the thread shows the log, the rail is the address book.

   The book has no store of its own. chatState.peers is already the persisted
   contact list (saveContacts writes it encrypted), and anything added from a
   contact card goes through addIdentityAsConversation into the same array, so
   the book shows those the moment they arrive.
   ========================================================================== */
/* What a call moved, in each direction, for the rows that list it. Arrows
   rather than words so the pair reads at a glance and needs no translating,
   wrapped the way formatBytes wraps its own output so a Latin size does not
   flip inside a Persian line. Absent on calls logged before the counters
   existed and on ones that never connected, so it says nothing then. */
function formatCallTraffic(call) {
  const down = Number(call?.bytesIn || 0);
  const up = Number(call?.bytesOut || 0);
  if (!down && !up) return '';
  return `\u2066\u2193 ${app().formatBytes(down)} \u2191 ${app().formatBytes(up)}\u2069`;
}

function contactBookRecords() {
  const query = String(chatState.contactSearch || '').trim().toLowerCase();
  const records = (chatState.peers || []).filter((peer) => (
    peer.peerId && !isSelfPeerRecord(peer) && peer.type !== 'group' && peer.type !== 'space'
    && isStoredContact(peer)
  ));
  const matched = query
    ? records.filter((peer) => [peer.name, peer.username, peer.peerId, peer.fingerprint]
      .some((field) => String(field || '').toLowerCase().includes(query)))
    : records;
  return matched.slice().sort((a, b) => {
    const onlineGap = (b.status === 'online' ? 1 : 0) - (a.status === 'online' ? 1 : 0);
    if (onlineGap) return onlineGap;
    return String(a.name || a.username || '').localeCompare(String(b.name || b.username || ''), undefined, { sensitivity: 'base' });
  });
}

function contactShareText(peer = {}) {
  return 'poorija-chat-v1:' + utf8_to_b64(JSON.stringify({
    type: 'poorija-chat-identity',
    name: peer.name || peer.username || '',
    peerId: peer.peerId || '',
    fingerprint: peer.fingerprint || '',
    publicKeyData: peer.publicKeyData || '',
  }));
}

function renderAddressBook() {
  const records = contactBookRecords();
  const esc = (value) => app().escapeHTML(String(value ?? ''));

  const rows = records.length ? records.map((peer) => {
    const name = peer.name || peer.username || peer.peerId;
    const online = peer.status === 'online';
    const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
    const avatar = peer.avatarData
      ? `<img class="chat-contact-avatar" src="${esc(peer.avatarData)}" alt="">`
      : `<span class="chat-contact-avatar">${esc(initial)}</span>`;
    return `
<div class="chat-contact-row ${online ? 'is-online' : ''}" data-contact-id="${esc(peer.peerId)}">
  <div class="chat-contact-main" role="button" tabindex="0" data-contact-open="${esc(peer.peerId)}">
    <span class="chat-contact-avatar-wrap">${avatar}<i class="chat-contact-dot" aria-hidden="true"></i></span>
    <span class="chat-contact-copy">
      <strong>${esc(name)}</strong>
      <small>${esc(peer.peerId)}</small>
    </span>
  </div>
  <div class="chat-contact-actions">
    <button type="button" data-contact-call="${esc(peer.peerId)}" data-contact-mode="voice" title="${esc(t('تماس صوتی', 'Voice call'))}"><i class="fas fa-phone"></i></button>
    <button type="button" data-contact-call="${esc(peer.peerId)}" data-contact-mode="video" title="${esc(t('تماس تصویری', 'Video call'))}"><i class="fas fa-video"></i></button>
    <button type="button" data-contact-open="${esc(peer.peerId)}" title="${esc(t('گفتگو', 'Chat'))}"><i class="fas fa-comment"></i></button>
    <button type="button" data-contact-details="${esc(peer.peerId)}" title="${esc(t('جزئیات', 'Details'))}"><i class="fas fa-circle-info"></i></button>
  </div>
  <div class="chat-contact-details hidden" data-contact-details-for="${esc(peer.peerId)}">
    <dl>
      <div><dt>${esc(t('شناسه', 'ID'))}</dt><dd>${esc(peer.peerId)}</dd></div>
      <div><dt>${esc(t('اثر انگشت کلید', 'Key fingerprint'))}</dt><dd>${esc(peer.fingerprint || t('نامشخص', 'unknown'))}</dd></div>
      <div><dt>${esc(t('وضعیت', 'Status'))}</dt><dd>${esc(online ? t('آنلاین', 'Online') : t('آفلاین', 'Offline'))}</dd></div>
      <div><dt>${esc(t('آخرین بازدید', 'Last seen'))}</dt><dd>${esc(peer.lastSeenAt ? formatTime(peer.lastSeenAt) : t('ثبت نشده', 'not recorded'))}</dd></div>
    </dl>
    <div class="chat-contact-detail-actions">
      <button type="button" data-contact-copy="${esc(peer.peerId)}"><i class="fas fa-copy"></i><span>${esc(t('کپی شناسه', 'Copy ID'))}</span></button>
      <button type="button" data-contact-share="${esc(peer.peerId)}"><i class="fas fa-share-nodes"></i><span>${esc(t('هم‌رسانی مخاطب', 'Share contact'))}</span></button>
      <button type="button" class="is-danger" data-contact-remove="${esc(peer.peerId)}"><i class="fas fa-user-minus"></i><span>${esc(t('حذف مخاطب', 'Remove'))}</span></button>
    </div>
  </div>
</div>`;
  }).join('') : `<div class="chat-empty-state">${esc(chatState.contactSearch
    ? t('مخاطبی با این جستجو پیدا نشد.', 'No contact matches that search.')
    : t('هنوز مخاطبی ثبت نشده است. با «افزودن» یک شناسه یا کارت مخاطب وارد کنید.', 'No contacts yet. Use Add to paste an id or a contact card.'))}</div>`;

  /* The relay tells every client who else is online, and the address book
     used to repeat that here as an "online on the relay" section with one-tap
     adopt buttons. It is gone: a list of everybody currently connected is a
     directory of strangers, which is the exact thing this app's privacy
     stance says it does not keep. Someone new enters this device's life
     through an explicit act — a shared contact card, a pasted id, a
     conversation — never through a broadcast list. */

  return `
<div class="chat-contact-book">
  <div class="chat-contact-head">
    <div class="chat-contact-title">
      <i class="fas fa-address-book"></i>
      <span>${esc(t('دفترچه مخاطبین', 'Address book'))}</span>
      <strong>${records.length}</strong>
    </div>
    <button type="button" class="chat-contact-add" data-contact-add><i class="fas fa-user-plus"></i><span>${esc(t('افزودن', 'Add'))}</span></button>
  </div>
  <input type="search" class="chat-contact-search" data-contact-search value="${esc(chatState.contactSearch || '')}"
    placeholder="${esc(t('جستجوی نام یا شناسه', 'Search name or id'))}">
  <div class="chat-contact-rows">${rows}</div>
</div>`;
}

function contactByPeerId(peerId) {
  return (chatState.peers || []).find((peer) => peer.peerId === peerId) || null;
}

function openContactConversation(peerId) {
  const peer = contactByPeerId(peerId);
  if (!peer) return;
  const previousConversationId = chatState.activeConversationId;
  setDraft(chatState.activeConversationId, document.getElementById('chatComposer')?.value || '');
  chatState.activePeerClientId = peer.clientId || peer.peerId;
  chatState.activeConversationId = getConversationKey(peer);
  /* Same hand-over hygiene as the chat-list switch: the self-destruct timer,
     a half-finished edit and a multi-select all belong to the conversation
     being left, not the one being opened. */
  chatState.timerSeconds = Number(peer.timerSeconds || 0);
  if (typeof syncTimerUi === 'function') syncTimerUi();
  if (previousConversationId !== chatState.activeConversationId) {
    if (chatState.editingMessageId && typeof clearMessageContext === 'function') clearMessageContext();
    if (chatState.selectedMessages?.size && typeof exitSelectionMode === 'function') exitSelectionMode();
  }
  clearManualUnread(chatState.activeConversationId);
  markConversationRead(chatState.activeConversationId);
  applyDraftToComposer(chatState.activeConversationId);
  setChatView('chats');
  updateChatShellMode();
  renderPeers();
  renderActivePeer();
}

/* PoorijaDialogs, not window.confirm: wry implements none of WKWebView's
   dialog delegates, so inside the native shell the browser's confirm returns
   false without drawing anything and the removal would silently never happen. */
/* Moving someone from the online list into the book: the record is already in
   memory, it only has to be marked as the user's own to survive a reload. */
function adoptDiscoveredPeer(peerId) {
  const peer = contactByPeerId(peerId);
  if (!peer) return;
  peer.manual = true;
  saveContacts();
  renderPeers();
  notify(t('به دفترچه مخاطبین اضافه شد.', 'Added to the address book.'), 'success');
}

/* Trust tombstones. Deleting a contact used to delete the pinned key with
   it, so anyone who knew the peerId could re-appear under the same name with
   a brand-new key and be trusted on first sight — the exact thing the
   key-change warning exists to prevent. A tombstone remembers the key that
   WAS trusted; mergePeerRecord consults it before pinting anything new. */
function loadRevokedTrust() {
  try {
    const list = JSON.parse(localStorage.getItem('poorija_revoked_trust') || '[]');
    return Array.isArray(list) ? list : [];
  } catch (_error) {
    return [];
  }
}
function saveRevokedTrust(list) {
  try {
    localStorage.setItem('poorija_revoked_trust', JSON.stringify(list.slice(-200)));
  } catch (_error) { /* quota — the pinning check degrades to first-sight */ }
}
function revokeTrustedKey(record) {
  if (!record) return;
  const list = loadRevokedTrust().filter((item) => item.peerId !== record.peerId);
  list.push({
    peerId: record.peerId || '',
    clientId: record.clientId || '',
    fingerprint: record.fingerprint || '',
    trustedKey: record.trustedKey || record.publicKeyData || '',
    at: Date.now(),
  });
  saveRevokedTrust(list);
}
function clearRevokedTrustFor(record) {
  if (!record?.peerId) return;
  const list = loadRevokedTrust().filter((item) => item.peerId !== record.peerId);
  saveRevokedTrust(list);
}

async function removeContactRecord(peerId) {
  const peer = contactByPeerId(peerId);
  if (!peer) return;
  const name = peer.name || peer.username || peer.peerId;
  const ok = await PoorijaDialogs.confirm(t(
    `«${name}» از دفترچه مخاطبین حذف شود؟ تاریخچهٔ گفتگو دست‌نخورده می‌ماند.`,
    `Remove "${name}" from the address book? The conversation history is left alone.`));
  if (!ok) return;
  revokeTrustedKey(peer);
  chatState.peers = (chatState.peers || []).filter((record) => record.peerId !== peerId);
  saveContacts();
  renderPeers();
  notify(t('مخاطب حذف شد.', 'Contact removed.'), 'success');
}

/* The same contact, in whichever shape the other end can read.
 *
 * A card is what this app understands and imports in one paste; JSON is for a
 * script or another tool; plain text is for somebody who is going to read it
 * with their eyes. Sharing one shape and hoping was the old behaviour. */
function contactShareShapes(peer) {
  const card = contactShareText(peer);
  const json = JSON.stringify({
    name: peer.username || peer.name || '',
    peerId: peer.peerId || '',
    fingerprint: peer.fingerprint || '',
    publicKeyData: peer.publicKeyData || '',
  }, null, 2);
  const plain = [
    `${t('نام', 'Name')}: ${peer.username || peer.name || '-'}`,
    `${t('شناسه', 'Peer id')}: ${peer.peerId || '-'}`,
    `${t('اثرانگشت', 'Fingerprint')}: ${peer.fingerprint || '-'}`,
  ].join('\n');
  return { card, json, plain };
}
async function shareContactRecord(peerId) {
  const peer = contactByPeerId(peerId);
  if (!peer) return;
  const shapes = contactShareShapes(peer);
  const choice = await PoorijaDialogs.choose(
    t('کارت مخاطب در چه قالبی فرستاده شود؟', 'In what form should this contact go?'),
    [
      { value: 'card', label: t('کارت مخاطب — برای همین برنامه', 'Contact card - for this app') },
      { value: 'json', label: t('JSON — برای ابزار دیگر', 'JSON - for another tool') },
      { value: 'plain', label: t('متن ساده — برای خواندن', 'Plain text - to read') },
    ],
    { okLabel: t('انصراف', 'Cancel') },
  );
  if (!choice) return;
  const text = shapes[choice] || shapes.card;
  const title = t('کارت مخاطب P00RIJA', 'P00RIJA contact card');
  /* navigator.share is the right affordance on a phone and simply absent on
     most desktops, so the clipboard is the fallback rather than the error. */
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    notify(t('کارت مخاطب در کلیپ‌بورد کپی شد.', 'Contact card copied to the clipboard.'), 'success');
  } catch (error) {
    void error;
    notify(t('کپی کارت مخاطب ناموفق بود.', 'Could not copy the contact card.'), 'error');
  }
}

async function addContactFromPrompt() {
  const raw = await PoorijaDialogs.prompt(t('شناسه کاربر یا کارت مخاطب (poorija-chat-v1:…) را وارد کنید:',
    'Paste a user id or a contact card (poorija-chat-v1:…):'));
  if (!raw || !raw.trim()) return;
  const parsed = parseIdentityText(raw.trim());
  if (parsed?.peerId) {
    addIdentityAsConversation(parsed, { startSession: false });
    notify(t('مخاطب افزوده شد.', 'Contact added.'), 'success');
    renderPeers();
    return;
  }
  const peerId = raw.trim();
  if (contactByPeerId(peerId)) {
    notify(t('این مخاطب از قبل در دفترچه هست.', 'That contact is already in the book.'), 'info');
    return;
  }
  const record = mergePeerRecord({
    clientId: peerId,
    peerId,
    username: peerId,
    name: '',
    manual: true,
    status: 'offline',
  }, { online: false });
  if (!record) {
    notify(t('شناسه معتبر نیست.', 'That id is not valid.'), 'warning');
    return;
  }
  record.manual = true;
  saveContacts();
  renderPeers();
  notify(t('مخاطب افزوده شد.', 'Contact added.'), 'success');
}

/* One delegated listener for the whole book, bound once — same reason the call
   log has one: re-binding per render is how a click fires four times. */
function bindAddressBook() {
  if (document.body.dataset.contactBookBound) return;
  document.body.dataset.contactBookBound = '1';

  document.addEventListener('click', (event) => {
    const call = event.target.closest('[data-contact-call]');
    if (call) {
      redialCall(call.getAttribute('data-contact-call'), call.getAttribute('data-contact-mode'));
      return;
    }
    const details = event.target.closest('[data-contact-details]');
    if (details) {
      const id = details.getAttribute('data-contact-details');
      document.querySelectorAll(`[data-contact-details-for="${CSS.escape(id)}"]`)
        .forEach((panel) => panel.classList.toggle('hidden'));
      return;
    }
    const copy = event.target.closest('[data-contact-copy]');
    if (copy) {
      navigator.clipboard.writeText(copy.getAttribute('data-contact-copy') || '')
        .then(() => notify(t('شناسه کپی شد.', 'Id copied.'), 'success'))
        .catch(() => notify(t('کپی ناموفق بود.', 'Copy failed.'), 'error'));
      return;
    }
    const share = event.target.closest('[data-contact-share]');
    if (share) { shareContactRecord(share.getAttribute('data-contact-share')); return; }
    const remove = event.target.closest('[data-contact-remove]');
    if (remove) { removeContactRecord(remove.getAttribute('data-contact-remove')); return; }
    const adopt = event.target.closest('[data-contact-adopt]');
    if (adopt) { adoptDiscoveredPeer(adopt.getAttribute('data-contact-adopt')); return; }
    if (event.target.closest('[data-contact-add]')) { addContactFromPrompt(); return; }
    const pane = event.target.closest('[data-calls-pane]');
    if (pane) {
      chatState.callsShowContacts = pane.getAttribute('data-calls-pane') === 'contacts';
      renderCalls();
      return;
    }
    const open = event.target.closest('[data-contact-open]');
    if (open) { openContactConversation(open.getAttribute('data-contact-open')); }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const open = event.target.closest?.('[data-contact-open]');
    if (!open) return;
    event.preventDefault();
    openContactConversation(open.getAttribute('data-contact-open'));
  });

  /* The search box is re-created on every render, so its value is kept in
     state and the listener is delegated like everything else. */
  document.addEventListener('input', (event) => {
    const box = event.target.closest?.('[data-contact-search]');
    if (!box) return;
    chatState.contactSearch = box.value;
    const rows = document.querySelector('.chat-contact-rows');
    if (!rows) return;
    /* Only the rows are replaced: rewriting the whole book would take the
       focus and the caret out of the box being typed into. */
    const fragment = document.createElement('div');
    fragment.innerHTML = renderAddressBook();
    rows.innerHTML = fragment.querySelector('.chat-contact-rows')?.innerHTML || '';
    const count = document.querySelector('.chat-contact-title strong');
    const freshCount = fragment.querySelector('.chat-contact-title strong');
    if (count && freshCount) count.textContent = freshCount.textContent;
  });
}

/* The thread header belongs to a conversation. In the Calls view there is no
   conversation, so it used to sit there advertising a peer nobody had picked —
   an avatar with a placeholder initial and "choose a user to start". Here it
   becomes the log's own header instead, and the buttons that need a peer step
   aside. */
function applyCallsThreadHeader() {
  const shell = document.querySelector('#content-chat .chat-shell');
  const view = chatState.activeView;
  const owned = view === 'calls' || view === 'connection';
  /* Not data-chat-view: that attribute already marks the rail's nav buttons,
     and the shell comes first in the document, so a querySelector looking for
     the Settings button matched the entire chat panel instead. */
  if (shell) shell.dataset.shellView = view || 'chats';
  if (!owned) return;
  const avatar = document.getElementById('chatActiveAvatar');
  const title = document.getElementById('chatActivePeerName');
  const meta = document.getElementById('chatActivePeerMeta');
  const total = (chatState.calls || []).length;
  const missed = (chatState.calls || []).filter((call) => isMissedCallStatus(call.status)).length;
  if (avatar) avatar.classList.add('hidden');
  if (view === 'connection') {
    if (title) title.textContent = t('تنظیمات چت امن', 'Secure chat settings');
    if (meta) {
      meta.textContent = chatState.settingsPane
        ? settingsPaneTitle(chatState.settingsPane)
        : t('یک بخش را از فهرست کنار انتخاب کنید.', 'Pick a section from the list beside this.');
    }
  } else {
  if (title) title.textContent = t('تاریخچهٔ تماس‌ها', 'Call history');
  if (meta) {
    meta.textContent = total
      ? t(`${total} تماس ثبت‌شده${missed ? ` · ${missed} بی‌پاسخ` : ''}`,
        `${total} logged${missed ? ` · ${missed} missed` : ''}`)
      : t('هنوز تماسی ثبت نشده است.', 'No calls logged yet.');
  }
  }
  /* The action buttons are hidden by CSS while this view owns the header, not
     by adding `hidden` to each of them: that class is also how renderActivePeer
     records which actions a conversation actually has, so setting it here left
     them hidden after the user came back to Chats — the thread header showed
     nothing but the delete button until something re-rendered it. */
}

/* The heading row above the list belongs to Chats: its button starts one.
   Calls keeps the row — the word and the count are useful — and loses the
   button, which had nothing to do there. */
function syncCallsHeading() {
  const startBtn = document.getElementById('chatStartChatBtn');
  if (!startBtn) return;
  startBtn.classList.toggle('hidden', chatState.activeView === 'calls');
  /* The same button, asked to mean the right thing in each list. "Start a
     chat" above a list of groups offered to do something the list had nothing
     to do with, and making a group lived in a fold above it instead. */
  const groups = chatState.activeView === 'groups';
  const label = startBtn.querySelector('span');
  if (label) label.textContent = groups ? t('گروه جدید', 'New group') : t('شروع چت', 'Start a chat');
  startBtn.dataset.action = groups ? 'new-group' : 'start-chat';
}

function renderCalls() {
  /* Painting is for the calls view only. appendCall() ends here so the log and
     the badges stay current, and that is what put the call history into the
     side panel while the Chats tab was still the active one: a missed call to
     somebody offline logs a row, and the row repainted the whole list.
     The badge below is the part that has to run either way. */
  if (chatState.activeView !== 'calls') {
    renderChatNavBadges();
    syncCallsHeading();
    return;
  }
  const list = document.getElementById('chatPeerList');
  const callsPanelList = document.getElementById('chatCallsList');
  const callsFilterTabs = document.getElementById('chatCallsFilterTabs');
  const count = document.getElementById('chatPeerCount');
  const title = document.getElementById('chatListTitle');
  if (title) title.textContent = t('تماس‌ها', 'Calls');
  if (!CALL_FILTERS.some((filter) => filter.id === chatState.callFilter)) chatState.callFilter = 'all';
  const selecting = chatState.callSelectMode;

  const tabHtml = CALL_FILTERS.map((filter) => {
    const filterCount = chatState.calls.filter(filter.predicate).length;
    return `
<button type="button" class="chat-call-filter-tab ${filter.id === chatState.callFilter ? 'active' : ''}" data-chat-call-filter="${filter.id}">
<span>${app().escapeHTML(t(filter.fa, filter.en))}</span>
<strong>${filterCount}</strong>
</button>`;
  }).join('');
  /* The standalone tab strip in the markup is a second copy of the filters the
     working pane draws for itself; it is emptied and hidden rather than kept
     in step. */
  if (callsFilterTabs) callsFilterTabs.innerHTML = '';

  const visible = visibleCallRecords();
  if (count) count.textContent = String(visible.length);
  const selectedHere = visible.filter((call) => chatState.callSelection.has(call.id)).length;

  /* Rendered rather than written into the markup once, because this list is
     drawn into two places - the rail on a phone, the facing panel on a desktop
     - and a static copy lived in the panel only. That is why starting a group
     call was a desktop-only thing. Addressed by data attribute, not id: the
     same markup exists twice on a wide screen. */
  const adhocBar = `
<div class="chat-adhoc-call-bar">
  <button type="button" class="chat-soft-btn" data-adhoc-call="voice">
    <i class="fas fa-phone"></i><span>${app().escapeHTML(t('تماس گروهی صوتی', 'Group voice call'))}</span>
  </button>
  <button type="button" class="chat-soft-btn" data-adhoc-call="video">
    <i class="fas fa-video"></i><span>${app().escapeHTML(t('تماس گروهی تصویری', 'Group video call'))}</span>
  </button>
</div>`;

  const toolbar = adhocBar + `
<div class="chat-call-tools">
  <div class="chat-call-tools-row">
    <input type="search" class="chat-call-search" data-chat-call-search value="${app().escapeHTML(chatState.callSearch || '')}"
      placeholder="${app().escapeHTML(t('جستجوی نام یا شناسه', 'Search name or id'))}">
    <button type="button" class="chat-call-tool ${selecting ? 'is-on' : ''}" data-chat-call-select-mode="${selecting ? 'off' : 'on'}"
      title="${app().escapeHTML(t('انتخاب چندتایی', 'Select several'))}"><i class="fas fa-list-check"></i></button>
    <button type="button" class="chat-call-tool" data-chat-call-menu
      title="${app().escapeHTML(t('پاک‌سازی', 'Clean up'))}"><i class="fas fa-trash-can"></i></button>
  </div>
  <div class="chat-call-menu hidden" data-chat-call-menu-panel>
    <button type="button" data-chat-call-clear="section"><i class="fas fa-broom"></i><span>${app().escapeHTML(t(`پاک‌سازی بخش «${t(activeCallFilter().fa, activeCallFilter().en)}» (${visible.length})`, `Clear "${t(activeCallFilter().fa, activeCallFilter().en)}" (${visible.length})`))}</span></button>
    <button type="button" data-chat-call-clear="old"><i class="fas fa-clock-rotate-left"></i><span>${app().escapeHTML(t('پاک‌سازی قدیمی‌تر از ۳۰ روز', 'Clear older than 30 days'))}</span></button>
    <button type="button" class="is-danger" data-chat-call-clear="all"><i class="fas fa-fire"></i><span>${app().escapeHTML(t(`پاک‌سازی کل تاریخچه (${chatState.calls.length})`, `Erase the whole log (${chatState.calls.length})`))}</span></button>
  </div>
  ${selecting ? `
  <div class="chat-call-selectbar">
    <button type="button" data-chat-call-select-all><i class="fas fa-check-double"></i><span>${app().escapeHTML(t('انتخاب همه', 'Select all'))}</span></button>
    <span class="chat-call-selectcount">${app().escapeHTML(t(`${chatState.callSelection.size} انتخاب‌شده`, `${chatState.callSelection.size} selected`))}</span>
    <button type="button" class="is-danger" data-chat-call-delete-selected ${chatState.callSelection.size ? '' : 'disabled'}><i class="fas fa-trash"></i><span>${app().escapeHTML(t('حذف', 'Delete'))}</span></button>
    <button type="button" data-chat-call-select-mode="off"><i class="fas fa-xmark"></i></button>
  </div>` : ''}
</div>`;

  const groups = new Map();
  visible.forEach((call) => {
    const key = callGroupKey(call);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(call);
  });

  const rows = groups.size
    ? Array.from(groups.entries()).map(([key, items]) => {
      const latest = items[0];
      const missedCount = items.filter((call) => isMissedCallStatus(call.status)).length;
      const modeLabel = latest.mode === 'video' ? t('تصویری', 'Video') : t('صوتی', 'Voice');
      const groupSelected = items.every((call) => chatState.callSelection.has(call.id));
      /* Closed until asked. Opening every run that contained a missed call
         meant a log with a few missed calls arrived fully unfolded, which is
         the whole column spent on one contact. The count on the summary row
         already says how much is inside. */
      return `
<details class="chat-call-accordion">
<summary class="chat-peer-card chat-call-summary ${isMissedCallStatus(latest.status) ? 'missed' : ''}">
${selecting ? `<button type="button" class="chat-call-check ${groupSelected ? 'is-on' : ''}" data-chat-call-group-select="${app().escapeHTML(key)}" title="${app().escapeHTML(t('انتخاب این گفتگو', 'Select this run'))}"><i class="fas ${groupSelected ? 'fa-square-check' : 'fa-square'}"></i></button>` : ''}
<div class="min-w-0">
<div class="font-semibold text-white truncate">${app().escapeHTML(latest.name || latest.peerId || '-')}</div>
<div class="text-xs mt-1 ${isMissedCallStatus(latest.status) ? 'text-rose-300' : 'text-slate-400'}">
${app().escapeHTML(modeLabel)} · ${app().escapeHTML(formatCallStatus(latest.status))}
${missedCount ? ` · ${app().escapeHTML(t(`${missedCount} بی‌پاسخ`, `${missedCount} missed`))}` : ''}
</div>
</div>
<div class="chat-call-summary-meta">
<span class="text-xs text-slate-500">${formatTime(latest.createdAt)}</span>
<span class="chat-call-count">${items.length}</span>
<button type="button" class="chat-call-row-del" data-chat-call-group-delete="${app().escapeHTML(key)}" title="${app().escapeHTML(t('حذف این گفتگو از تاریخچه', 'Delete this run from the log'))}"><i class="fas fa-trash"></i></button>
</div>
</summary>
<div class="chat-call-accordion-body">
${items.map((call) => `
<div class="chat-call-log-row ${isMissedCallStatus(call.status) ? 'missed' : ''} ${chatState.callSelection.has(call.id) ? 'is-selected' : ''}">
${selecting ? `<button type="button" class="chat-call-check ${chatState.callSelection.has(call.id) ? 'is-on' : ''}" data-chat-call-select="${app().escapeHTML(call.id)}"><i class="fas ${chatState.callSelection.has(call.id) ? 'fa-square-check' : 'fa-square'}"></i></button>` : ''}
<div class="min-w-0">
<div class="text-sm text-white truncate">${app().escapeHTML(call.mode === 'video' ? t('تماس تصویری', 'Video call') : t('تماس صوتی', 'Voice call'))}</div>
<div class="text-xs ${isMissedCallStatus(call.status) ? 'text-rose-300' : 'text-slate-400'}">${app().escapeHTML(formatCallStatus(call.status))}${call.durationMs ? ` · ${formatDuration(call.durationMs)}` : ''}${formatCallTraffic(call) ? ` · ${formatCallTraffic(call)}` : ''}</div>
</div>
<button type="button" class="chat-call-redial-btn" data-chat-redial-peer="${app().escapeHTML(call.peerId || '')}" data-chat-redial-mode="${call.mode === 'video' ? 'video' : 'voice'}" title="${t('تماس مجدد', 'Redial')}"><i class="fas fa-phone"></i></button>
<button type="button" class="chat-call-row-del" data-chat-call-delete="${app().escapeHTML(call.id)}" title="${app().escapeHTML(t('حذف این تماس', 'Delete this call'))}"><i class="fas fa-trash"></i></button>
<span class="text-xs text-slate-500">${formatTime(call.createdAt)}</span>
</div>`).join('')}
</div>
</details>`;
    }).join('')
    : `<div class="chat-empty-state">${app().escapeHTML(chatState.callSearch
      ? t('چیزی با این جستجو پیدا نشد.', 'Nothing matches that search.')
      : t('در این بخش هنوز تماسی ثبت نشده است.', 'No calls in this section yet.'))}</div>`;

  bindAddressBook();
  if (callsViewVisible()) markCallsRead();

  /* One arrangement, two widths. The working pane — history with its filters,
     or the address book with its search — is the big panel: the thread on a
     desktop, the rail on a phone. The rail on a desktop is the recent-call
     list, which is what a second column is good for. */
  const twoColumn = window.matchMedia('(min-width: 768px)').matches;
  const paneSwitch = `
<div class="chat-calls-switch">
  <button type="button" class="${chatState.callsShowContacts ? '' : 'is-on'}" data-calls-pane="history"><i class="fas fa-clock-rotate-left"></i><span>${app().escapeHTML(t('تاریخچه', 'History'))}</span></button>
  <button type="button" class="${chatState.callsShowContacts ? 'is-on' : ''}" data-calls-pane="contacts"><i class="fas fa-address-book"></i><span>${app().escapeHTML(t('مخاطبین', 'Contacts'))}</span></button>
</div>`;
  const historyPane = `
<div class="chat-call-filter-tabs">${tabHtml}</div>
${toolbar}
<div class="chat-calls-list-container">${rows}</div>`;
  const workingPane = paneSwitch + (chatState.callsShowContacts ? renderAddressBook() : historyPane);

  /* The working pane moves between the two columns with the layout. Marking
     whichever element holds it means anything looking for the filters, the
     toolbar or a row has one selector to use instead of guessing the width.
     An attribute rather than a wrapper: a new node here would break the
     direct-child rules the two panes are laid out with. */
  const holdsWork = (node, yes) => {
    if (!node) return;
    if (yes) node.setAttribute('data-calls-work', '');
    else node.removeAttribute('data-calls-work');
  };
  if (twoColumn) {
    if (list) list.innerHTML = renderRecentCallsColumn();
    if (callsPanelList) callsPanelList.innerHTML = workingPane;
  } else {
    if (list) list.innerHTML = workingPane;
    if (callsPanelList) callsPanelList.innerHTML = '';
  }
  holdsWork(list, !twoColumn);
  holdsWork(callsPanelList, twoColumn);
  applyCallsThreadHeader();
  syncCallsHeading();
  if (selectedHere && !selecting) chatState.callSelection.clear();
}

/* The rail beside the log: every call, newest first, no filters and no
   grouping — a glance at what has happened rather than a place to work. */
function renderRecentCallsColumn() {
  const esc = (value) => app().escapeHTML(String(value ?? ''));
  const calls = (chatState.calls || []).slice(0, 60);
  if (!calls.length) {
    return `<div class="chat-recent-calls"><div class="chat-empty-state">${esc(t('هنوز تماسی ثبت نشده است.', 'No calls logged yet.'))}</div></div>`;
  }
  /* Selection lives in chatState.callSelection, which the working pane reads
     too - so ticking a call here shows up there and the two columns cannot
     disagree. This column used to be a glance and nothing more, which meant
     the only way to tidy the log was to cross the screen. */
  const selecting = Boolean(chatState.callSelectMode);
  const chosen = chatState.callSelection.size;
  return `
<div class="chat-recent-calls ${selecting ? 'is-selecting' : ''}">
  <div class="chat-recent-calls-head">
    <i class="fas fa-clock-rotate-left"></i>
    <span>${esc(t('تماس‌های اخیر', 'Recent calls'))}</span>
    <strong>${calls.length}</strong>
    <button type="button" class="chat-recent-call-tool ${selecting ? 'is-on' : ''}" data-chat-call-select-mode="${selecting ? 'off' : 'on'}" title="${esc(t('انتخاب چندتایی', 'Select several'))}"><i class="fas fa-list-check"></i></button>
  </div>
  ${selecting ? `
  <div class="chat-recent-calls-bar">
    <button type="button" data-chat-call-select-all><i class="fas fa-check-double"></i> ${esc(t('همه', 'All'))}</button>
    <span>${esc(t(`${chosen} انتخاب‌شده`, `${chosen} selected`))}</span>
    <button type="button" class="is-danger" data-chat-call-delete-selected ${chosen ? '' : 'disabled'}><i class="fas fa-trash"></i> ${esc(t('حذف', 'Delete'))}</button>
  </div>` : ''}
  ${calls.map((call) => {
    const missed = isMissedCallStatus(call.status);
    const name = call.name || call.peerId || t('ناشناس', 'Unknown');
    const picked = chatState.callSelection.has(call.id);
    return `
<div class="chat-recent-call ${missed ? 'is-missed' : ''} ${picked ? 'is-selected' : ''}">
  ${selecting ? `<button type="button" class="chat-recent-call-check ${picked ? 'is-on' : ''}" data-chat-call-select="${esc(call.id)}"><i class="fas ${picked ? 'fa-square-check' : 'fa-square'}"></i></button>` : `<i class="fas ${call.mode === 'video' ? 'fa-video' : 'fa-phone'}"></i>`}
  <span class="chat-recent-call-body">
    <b>${esc(name)}</b>
    <small>${esc(formatCallStatus(call.status))}${call.durationMs ? ` · ${esc(formatDuration(call.durationMs))}` : ''}${formatCallTraffic(call) ? ` · ${formatCallTraffic(call)}` : ''}</small>
  </span>
  <span class="chat-recent-call-when">${esc(formatTime(call.createdAt))}</span>
  <button type="button" class="chat-recent-call-dial" data-chat-redial-peer="${esc(call.peerId || '')}" data-chat-redial-mode="${call.mode === 'video' ? 'video' : 'voice'}" title="${esc(t('تماس مجدد', 'Redial'))}"><i class="fas fa-phone"></i></button>
  <button type="button" class="chat-recent-call-del" data-chat-call-delete-one="${esc(call.id)}" title="${esc(t('حذف این تماس', 'Delete this call'))}"><i class="fas fa-trash"></i></button>
</div>`;
  }).join('')}
</div>`;
}

/* One delegated listener for the whole log, bound once. Re-binding per render
   is how a click ends up firing four times. */
function bindCallLogActions() {
  if (document.body.dataset.callLogBound) return;
  document.body.dataset.callLogBound = '1';
  document.addEventListener('click', (event) => {
    const filter = event.target.closest('[data-chat-call-filter]');
    if (filter) {
      chatState.callFilter = filter.getAttribute('data-chat-call-filter') || 'all';
      renderCalls();
      return;
    }
    const mode = event.target.closest('[data-chat-call-select-mode]');
    if (mode) {
      setCallSelectMode(mode.getAttribute('data-chat-call-select-mode') === 'on');
      return;
    }
    const menu = event.target.closest('[data-chat-call-menu]');
    if (menu) {
      const panel = menu.closest('.chat-call-tools')?.querySelector('[data-chat-call-menu-panel]');
      panel?.classList.toggle('hidden');
      return;
    }
    const clear = event.target.closest('[data-chat-call-clear]');
    if (clear) {
      const which = clear.getAttribute('data-chat-call-clear');
      if (which === 'section') clearCallSection();
      else if (which === 'old') pruneOldCalls(30);
      else clearAllCalls();
      return;
    }
    if (event.target.closest('[data-chat-call-select-all]')) { toggleAllCallsSelected(); return; }
    if (event.target.closest('[data-chat-call-delete-selected]')) { deleteSelectedCalls(); return; }
    const pick = event.target.closest('[data-chat-call-select]');
    if (pick) {
      event.preventDefault();
      toggleCallSelected(pick.getAttribute('data-chat-call-select'));
      return;
    }
    const groupPick = event.target.closest('[data-chat-call-group-select]');
    if (groupPick) {
      /* Inside a <summary>: without this the accordion opens instead. */
      event.preventDefault();
      toggleCallGroupSelected(groupPick.getAttribute('data-chat-call-group-select'));
      return;
    }
    const oneDelete = event.target.closest('[data-chat-call-delete-one]');
    if (oneDelete) {
      event.preventDefault();
      event.stopPropagation();
      const id = oneDelete.getAttribute('data-chat-call-delete-one');
      chatState.calls = (chatState.calls || []).filter((call) => call.id !== id);
      chatState.callSelection.delete(id);
      saveCalls();
      renderCalls();
      return;
    }
    const groupDelete = event.target.closest('[data-chat-call-group-delete]');
    if (groupDelete) {
      event.preventDefault();
      deleteCallGroup(groupDelete.getAttribute('data-chat-call-group-delete'));
      return;
    }
    const rowDelete = event.target.closest('[data-chat-call-delete]');
    if (rowDelete) {
      event.preventDefault();
      confirmAndDeleteCalls([rowDelete.getAttribute('data-chat-call-delete')],
        t('این تماس از تاریخچه حذف شود؟', 'Delete this call from the log?'));
      return;
    }
    /* Any click outside the menu closes it. */
    if (!event.target.closest('[data-chat-call-menu-panel]')) {
      document.querySelectorAll('[data-chat-call-menu-panel]').forEach((panel) => panel.classList.add('hidden'));
    }
  });
  let searchTimer = 0;
  document.addEventListener('input', (event) => {
    const box = event.target.closest('[data-chat-call-search]');
    if (!box) return;
    window.clearTimeout(searchTimer);
    const value = box.value || '';
    searchTimer = window.setTimeout(() => {
      chatState.callSearch = value;
      renderCalls();
      /* Re-rendering steals the caret from the box being typed in. */
      const again = document.querySelector('[data-chat-call-search]');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }, 220);
  });
}

function ensurePinnedPanel() {
let panel = document.getElementById('chatPinnedPanel');
const messages = document.getElementById('chatMessages');
if (!panel && messages) {
panel = document.createElement('div');
panel.id = 'chatPinnedPanel';
panel.className = 'chat-pinned-panel hidden';
messages.before(panel);
}
return panel;
}
function renderPinnedPanel(peer, conversationKey, history = []) {
const panel = ensurePinnedPanel();
if (!panel) return;
const pinned = history.filter((entry) => entry.pinned).slice(-3).reverse();
if (!peer || !conversationKey || !pinned.length) {
panel.classList.add('hidden');
panel.innerHTML = '';
return;
}
panel.classList.remove('hidden');
panel.innerHTML = `
<div class="chat-pinned-title">
<i class="fas fa-thumbtack"></i>
<span>${t('پیام‌های سنجاق‌شده', 'Pinned messages')}</span>
</div>
<div class="chat-pinned-items">
${pinned.map((entry) => {
/* Call logs are asked first: they have no text of their own to fall back
   to, and any they carry is a leftover from before this was derived. */
const label = (entry.type === 'call-log' ? callHistoryText(entry) : '')
|| entry.text
|| entry.name
|| mediaEntryLabel(entry)
|| t('پیوست', 'Attachment');
return `
<button type="button" class="chat-pinned-item" data-chat-jump-message="${entry.id}">
<span>${app().escapeHTML(String(label).slice(0, 90))}</span>
</button>
`;
}).join('')}
</div>
`;
panel.querySelectorAll('[data-chat-jump-message]').forEach((button) => {
button.addEventListener('click', () => {
const target = document.querySelector(`[data-id="${button.getAttribute('data-chat-jump-message')}"]`);
target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
target?.classList.add('selected');
});
});
}
/* The toolbar normally hangs above its bubble. For the first message in a
   thread, or one scrolled up against the header, there is no room there and it
   came out clipped — so measure and drop it underneath instead. Measured after
   the class lands, because it has no box until it is displayed. */
/* The reaction picker, as one popup for the whole page.
 *
 * It used to be rendered inside each message bubble. Three problems came from
 * that and all three were the same problem:
 *
 *   GHOSTS. The picker is position:fixed, so it paints over everything —
 *   including after its own bubble has been replaced by an incremental
 *   re-render. Pickers from messages further up stayed on the screen.
 *
 *   CLIPPING. Its height was whatever the emoji needed, and nothing measured
 *   the space actually available. The last row fell off the bottom.
 *
 *   NOTHING DISMISSED IT. There was no single element to close, so a tap
 *   anywhere else left it open.
 *
 * One element on the body, positioned against the message that asked for it
 * and sized to the room that is left, has none of those. It cannot be
 * orphaned because there is only ever one; it cannot be clipped because its
 * height is computed from the gap it has to fit into; and closing it is one
 * call from anywhere.
 */
/* Putting a reaction on a message, from wherever it was chosen.
 *
 * The popup and the chips under a message both end here. Two copies of this —
 * one bound per button in the panel and one in the popup — is how they would
 * drift, and the half that nobody exercised would be the half that broke.
 */
/* A custom emoji, typed into the popup's own field.
 *
 * The field is written when the popup opens, which is after the panel's wiring
 * has run — so a listener bound to it at render time attached to nothing, and
 * every custom emoji was silently dropped. Delegated from the container, like
 * the buttons beside it. */
function applyCustomReaction(input) {
  const entryId = input.getAttribute('data-chat-reaction-custom') || '';
  const typed = String(input.value || '').trim();
  if (!entryId || !typed) return;
  /* One character, taken as a grapheme: an emoji with a skin tone or a zero
     width joiner is several code units and slicing it by length produces half
     a character that renders as a box. */
  const first = Array.from(typed)[0] || '';
  if (!first) return;
  input.value = '';
  applyReactionFromPicker(entryId, first);
}

function applyReactionFromPicker(entryId, emoji) {
  const conversation = getActiveConversation();
  const key = getConversationKey(conversation);
  const entry = (chatState.history[key] || []).find((item) => item.id === entryId);
  if (!entry || entry.direction === 'out') { closeReactionPopup(); return; }

  const reactorId = currentReactorId();
  const current = normalizeMessageReactions(entry)[reactorId] || '';
  const next = current === emoji ? '' : emoji;
  if (next) spawnReactionAnimation(next, entryId);
  applyMessageReaction(entry, next, reactorId);

  const peer = conversation;
  const directPeer = peer && !peer.type ? peer : null;
  if (directPeer) {
    relaySessionEvent(directPeer, {
      type: 'reaction',
      messageId: entryId,
      reaction: next,
      reactorId,
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
}

const REACTION_POPUP_ID = 'chatReactionPopup';

function reactionPopupNode() {
  let node = document.getElementById(REACTION_POPUP_ID);
  if (!node) {
    node = document.createElement('div');
    node.id = REACTION_POPUP_ID;
    node.className = 'chat-reaction-picker hidden';
    node.setAttribute('role', 'dialog');
    document.body.appendChild(node);
  }
  /* Last child of the body, so document order cannot put a later overlay in
     front of it. */
  if (node.nextSibling) document.body.appendChild(node);
  return node;
}

function closeReactionPopup() {
  document.getElementById(REACTION_POPUP_ID)?.classList.add('hidden');
  if (chatState.activeReactionMessageId) {
    chatState.activeReactionMessageId = '';
  }
}

function openReactionPopup(entryId) {
  const bubble = document.querySelector(
    `#chatMessages .chat-message-bubble[data-id="${CSS.escape(entryId)}"]`);
  if (!bubble) { closeReactionPopup(); return; }
  const entry = (chatState.history[getConversationKey(getActiveConversation())] || [])
    .find((item) => item.id === entryId);
  if (!entry) { closeReactionPopup(); return; }

  const mine = normalizeMessageReactions(entry)[currentReactorId()] || '';
  const node = reactionPopupNode();
  node.innerHTML = `
${CHAT_REACTION_GROUPS.map((group) => `
<div class="chat-reaction-group">
<span>${language() === 'fa' ? group.labelFa : group.labelEn}</span>
<div>
${group.emojis.map((emoji) => `
<button type="button" data-chat-reaction-choice="${app().escapeHTML(entryId)}" data-reaction="${emoji}" class="${mine === emoji ? 'active' : ''}">
${emoji}
</button>`).join('')}
</div>
</div>`).join('')}
<input type="text" inputmode="text" autocomplete="off" maxlength="8" class="chat-reaction-custom-input" data-chat-reaction-custom="${app().escapeHTML(entryId)}" placeholder="${app().escapeHTML(t('ایموجی...', 'Emoji...'))}">`;
  node.classList.remove('hidden');
  placeReactionPopup(bubble, node);
}

/* Where it goes, and how tall it is allowed to be.
 *
 * The height is decided before the position, because the two are the same
 * question: a picker that will not fit above the message has to be shorter or
 * go below it, and one that fits neither way has to be shorter still. Deciding
 * position first and letting the content overflow is what cut the last row off.
 */
function placeReactionPopup(bubble, node) {
  const margin = 10;
  const anchor = bubble.getBoundingClientRect();
  const above = anchor.top - margin * 2;
  const below = window.innerHeight - anchor.bottom - margin * 2;
  const room = Math.max(above, below);

  node.style.setProperty('max-height', `${Math.max(140, Math.min(320, room))}px`, 'important');
  node.style.setProperty('visibility', 'hidden', 'important');
  node.style.setProperty('top', '0px', 'important');
  node.style.setProperty('left', '0px', 'important');

  requestAnimationFrame(() => {
    const box = node.getBoundingClientRect();
    const height = box.height;
    const width = box.width;

    let top = above >= height ? anchor.top - height - margin : anchor.bottom + margin;
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));

    let left = anchor.left + (anchor.width - width) / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

    node.style.setProperty('top', `${Math.round(top)}px`, 'important');
    node.style.setProperty('left', `${Math.round(left)}px`, 'important');
    node.style.setProperty('right', 'auto', 'important');
    node.style.setProperty('bottom', 'auto', 'important');
    node.style.setProperty('transform', 'none', 'important');
    node.style.setProperty('visibility', 'visible', 'important');
  });
}

/* Anything that is not the picker closes it: a tap on the conversation, a
   scroll, a resize, Escape. Bound once, on the document, because the picker
   itself is rebuilt and a listener on it would not survive. */
if (!window.__reactionPopupBound) {
  window.__reactionPopupBound = true;
  document.addEventListener('pointerdown', (event) => {
    const node = document.getElementById(REACTION_POPUP_ID);
    const pickerOpen = node && !node.classList.contains('hidden');
    const insidePicker = pickerOpen && node.contains(event.target);
    /* The button that opens the picker must not count as an outside press, or
       the gesture that opens it closes it again. */
    const onToggle = Boolean(event.target.closest?.('[data-chat-toggle-reaction]'));
    /* Nor the toolbar itself, nor the message it belongs to: those have their
       own handlers and this must not fire first and take the target away. */
    const insideToolbar = Boolean(event.target.closest?.('.chat-message-toolbar'));
    const onOwnBubble = Boolean(event.target.closest?.('.chat-message-bubble.selected'));
    if (insidePicker || onToggle || insideToolbar || onOwnBubble) return;

    /* Anywhere else puts BOTH away. The toolbar used to need a second tap on
       the same message, which is a rule nobody guesses and which leaves it on
       screen while somebody is looking at something else. */
    const somethingOpen = pickerOpen || Boolean(chatState.activeMessageId);
    if (!somethingOpen) return;
    closeReactionPopup();
    chatState.activeMessageId = '';
    try { renderMessages(); } catch (error) { /* not mounted */ }
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const node = document.getElementById(REACTION_POPUP_ID);
    const open = (node && !node.classList.contains('hidden')) || chatState.activeMessageId;
    if (!open) return;
    closeReactionPopup();
    chatState.activeMessageId = '';
    try { renderMessages(); } catch (error) { /* not mounted */ }
  });
  /* A resize re-places the popup; it does not close it.
   *
   * Closing on resize was right for a window being dragged and catastrophic on
   * a phone: tapping the custom-emoji field raises the keyboard, the keyboard
   * IS a resize, and the popup shut itself the instant the field was touched.
   * The field was unusable and looked like it was rejecting what was typed.
   * Moving it is the correct response to the window changing shape anyway. */
  window.addEventListener('resize', () => {
    const node = document.getElementById(REACTION_POPUP_ID);
    if (!node || node.classList.contains('hidden')) return;
    const owner = node.querySelector('[data-chat-reaction-choice]')
      ?.getAttribute('data-chat-reaction-choice') || '';
    const bubble = owner && document.querySelector(
      `#chatMessages .chat-message-bubble[data-id="${CSS.escape(owner)}"]`);
    if (bubble) placeReactionPopup(bubble, node);
    else closeReactionPopup();
  });
  /* Scrolling the thread moves the message out from under the popup, so the
     popup goes — unless the custom field is being typed into, because on a
     phone the keyboard scrolls the thread as it opens. */
  document.getElementById('chatMessages')?.addEventListener('scroll', () => {
    const node = document.getElementById(REACTION_POPUP_ID);
    if (!node || node.classList.contains('hidden')) return;
    if (node.contains(document.activeElement)) return;
    closeReactionPopup();
  }, { passive: true });
}

function placeMessageToolbar(bubble) {
  if (!bubble?.classList.contains('selected')) return;
  bubble.classList.remove('toolbar-below');
  const toolbar = bubble.querySelector('.chat-message-toolbar');
  const panel = document.getElementById('chatMessages');
  if (!toolbar || !panel) return;
  requestAnimationFrame(() => {
    const bar = toolbar.getBoundingClientRect();
    if (!bar.height) return;
    if (bar.top < panel.getBoundingClientRect().top + 4) bubble.classList.add('toolbar-below');
  });
}
