/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 24 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   The settings section, and the group panels
*/

/* =====================================================================
   The settings section, and the group panels
   ---------------------------------------------------------------------
   Everything the chat could be configured with lived in one scrolling
   column: relay, TURN, diagnostics, ringtones, the lock, the vault. So
   "connection settings" meant "all settings", and finding the lock meant
   scrolling past two servers and four toggles.

   The panels are moved rather than rebuilt, so every id, every listener
   and every render target stays exactly where the rest of the file
   expects it.
   ===================================================================== */
const CHAT_SETTINGS_TAB_KEY = 'poorija_chat_settings_tab';
/* Ordered by how often somebody opens them, not by how the code grew.
   Appearance and Notifications are first because they are what people come
   here to change; Connection & TURN is a thing you set once and forget, and it
   had become the drawer everything else fell into — the appearance controls,
   the file-privacy toggles and the forward-secrecy note all lived there for no
   better reason than that the builder below sweeps leftovers into it. */
const CHAT_SETTINGS_TABS = [
  { id: 'appearance', fa: 'ظاهر چت', en: 'Chat appearance', icon: 'fa-palette' },
  { id: 'notifications', fa: 'اعلان‌های چت', en: 'Chat notifications', icon: 'fa-bell' },
  { id: 'sounds', fa: 'صداها', en: 'Sounds', icon: 'fa-music' },
  { id: 'privacy', fa: 'فایل‌ها و حریم خصوصی', en: 'Files & privacy', icon: 'fa-shield-halved' },
  { id: 'connection', fa: 'اتصال و TURN', en: 'Connection & TURN', icon: 'fa-network-wired' },
  { id: 'lock', fa: 'قفل چت', en: 'Chat lock', icon: 'fa-lock' },
  { id: 'storage', fa: 'حافظهٔ رمزنگاری‌شده', en: 'Encrypted vault', icon: 'fa-database' },
  { id: 'tools', fa: 'ابزارها', en: 'Tools', icon: 'fa-stethoscope' },
];

/* Filled by a function rather than inline, so it can be filled AGAIN.
 *
 * Built inline, its t() calls resolved once — on the first build — and the card
 * then kept that language for the life of the page. The rows around it come
 * from index.html with data-i18n on them and updateLanguage() rewrites those,
 * so Tools ended up showing an English menu above Persian cards.
 *
 * Rewriting innerHTML drops the listeners with the nodes they were on, so the
 * three buttons are bound here too, every time. */
function fillArchiveCard(card) {
  if (!card) return;
  card.innerHTML = `
<h4>${app().escapeHTML(t('درون‌ریزی و برون‌ریزی گفتگوها', 'Import and export conversations'))}</h4>
<p class="chat-help-note">${app().escapeHTML(t(
  'خروجی یک فایل JSON رمزنگاری‌شده است؛ رمزش را خودتان می‌گذارید و بدون آن باز نمی‌شود.',
  'The export is an encrypted JSON file. You set its password, and without it the file cannot be opened.'))}</p>
<div class="chat-settings-action-grid">
  <button type="button" class="chat-soft-btn" data-archive-export><i class="fas fa-file-export"></i><span>${app().escapeHTML(t('برون‌ریزی', 'Export'))}</span></button>
  <button type="button" class="chat-soft-btn" data-archive-import><i class="fas fa-file-import"></i><span>${app().escapeHTML(t('درون‌ریزی', 'Import'))}</span></button>
  <button type="button" class="chat-soft-btn chat-danger-soft-btn" data-archive-wipe><i class="fas fa-eraser"></i><span>${app().escapeHTML(t('پاک‌سازی تاریخچه', 'Clear history'))}</span></button>
</div>`;
  card.querySelector('[data-archive-export]').addEventListener('click', () => openExportPicker());
  card.querySelector('[data-archive-import]').addEventListener('click', () => pickArchiveFile());
  card.querySelector('[data-archive-wipe]').addEventListener('click', () => clearAllChatHistory());
}

/* Everything in the settings section that JavaScript wrote, said again in the
   language now in force. The panes themselves are not rebuilt — they hold live
   controls, ids and render targets the rest of the file addresses. */
function relabelChatSettingsCards() {
  fillArchiveCard(document.getElementById('chatArchiveCard'));
  if (typeof refreshChatToolsLanguage === 'function') refreshChatToolsLanguage();
  const stage = document.querySelector('#chatSettingsStage .chat-settings-stage-title');
  if (stage && chatState.settingsPane) stage.textContent = settingsPaneTitle(chatState.settingsPane);
}

function buildChatSettingsTabs() {
  const body = document.querySelector('#chatConnectionPanel .chat-settings-body');
  if (!body || body.dataset.tabbed) return;
  body.dataset.tabbed = '1';
  const original = [...body.children];
  /* A vertical menu, not a tab strip: five destinations, each opening as its
     own page — full screen on a phone with a way back, and in the facing panel
     on a desktop, where there is a second column to open into. Five labels
     never fitted across a rail anyway; they wrapped or truncated. */
  const bar = document.createElement('nav');
  bar.className = 'chat-settings-menu';
  bar.setAttribute('aria-label', t('بخش‌های تنظیمات چت امن', 'Secure chat settings sections'));
  bar.innerHTML = CHAT_SETTINGS_TABS.map((tab) => `
    <button type="button" data-settings-tab="${tab.id}">
      <i class="fas ${tab.icon} chat-settings-menu-icon"></i>
      <span class="chat-settings-menu-label">${app().escapeHTML(t(tab.fa, tab.en))}</span>
      <i class="fas fa-chevron-left chat-settings-menu-chevron" aria-hidden="true"></i>
    </button>`).join('');
  body.appendChild(bar);

  /* Not an accordion any more: Settings is a list of destinations, and a list
     that can fold shut is one more state than it needs. The <details> stays in
     the markup — a great deal of CSS and JS addresses it by id — but it is
     pinned open and its summary is hidden on phones. */
  const panel = document.getElementById('chatConnectionPanel');
  if (panel) {
    panel.open = true;
    panel.dataset.flat = '1';
    panel.addEventListener('toggle', () => { if (!panel.open) panel.open = true; });
  }

  const panes = {};
  CHAT_SETTINGS_TABS.forEach((tab) => {
    const pane = document.createElement('div');
    pane.className = 'chat-settings-tabpanel hidden';
    pane.setAttribute('data-settings-pane', tab.id);
    body.appendChild(pane);
    panes[tab.id] = pane;
  });
  const move = (node, id) => { if (node && panes[id]) panes[id].appendChild(node); };
  move(document.getElementById('chatDiagCard'), 'tools');
  /* The same three actions as the list header, in the section people go to
     when they are looking for them by name rather than by icon. */
  const archiveCard = document.createElement('div');
  archiveCard.id = 'chatArchiveCard';
  archiveCard.className = 'chat-archive-card';
  fillArchiveCard(archiveCard);
  panes.tools.appendChild(archiveCard);
  body.querySelectorAll(':scope > .chat-ringtone-row').forEach((row) => move(row, 'sounds'));
  move(document.getElementById('chatLockToggle')?.closest('.chat-storage-card'), 'lock');
  move(document.getElementById('chatStorageCard'), 'storage');
  move(document.getElementById('chatAppearanceCard'), 'appearance');
  /* What a file gives away and how long a message stays openable are one
     subject, and none of it is about the relay address. The two toggles bring
     the paragraphs that explain them; a switch whose explanation stayed three
     screens away is a switch nobody can decide about. */
  move(document.getElementById('chatStripMetadataToggle')?.closest('.chat-toggle'), 'privacy');
  move(document.getElementById('chatConvertHeicToggle')?.closest('.chat-toggle'), 'privacy');
  /* Not `:scope >`: these paragraphs sit inside the toggle block rather than
     directly under the body, so a direct-child selector matched nothing and
     they were swept into Connection with the rest of the leftovers, away from
     the two switches they explain. */
  ['convertHeicHint', 'stripMetadataHint'].forEach((key) => {
    move(body.querySelector(`[data-i18n="${key}"]`), 'privacy');
  });
  move(document.getElementById('chatForwardSecrecyCard'), 'privacy');
  /* Background push is the only part of the app's Notifications card that is
     about chat, so Secure Chat adopts that element and leaves the rest — the
     "show notifications" switch governs every toast the app raises, not only
     the ones a message causes, and belongs where the app's own settings are.
     Adopted rather than copied: the ids, the onchange handlers and the state
     sync in js/app.js all address these controls, and a second copy would be
     a second switch reporting the same thing differently. */
  move(document.getElementById('chatPushSettingsCard'), 'notifications');
  /* Whatever is left is connection: relay, TURN, the toggles and the buttons. */
  original.forEach((node) => { if (node.parentElement === body) panes.connection.appendChild(node); });
  bar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-tab]');
    if (button) setChatSettingsTab(button.getAttribute('data-settings-tab'));
  });
  openDefaultSettingsPane();
}

/* A phone opens on the menu — the section it would open takes the whole screen
   and the menu is what tells you where you are. A wide window has a second
   panel that would otherwise sit empty next to the list, so it opens the
   section that was last read. */
function openDefaultSettingsPane() {
  if (!window.matchMedia('(min-width: 768px)').matches) {
    closeChatSettingsPane();
    return;
  }
  let remembered = 'connection';
  try { remembered = localStorage.getItem(CHAT_SETTINGS_TAB_KEY) || 'connection'; } catch (_error) { /* private mode */ }
  setChatSettingsTab(remembered);
}

/* Where an opened section is shown. On a wide window that is the panel the
   rail faces, so settings get the same room a conversation gets; on a phone
   there is only one column, so the section takes it over and the menu waits
   behind the back button. */
const settingsPaneHomes = new Map();

function settingsStage() {
  const thread = document.querySelector('#content-chat .chat-thread');
  if (!thread) return null;
  let stage = document.getElementById('chatSettingsStage');
  if (stage) return stage;
  stage = document.createElement('section');
  stage.id = 'chatSettingsStage';
  stage.className = 'chat-settings-stage hidden';
  stage.innerHTML = `
<header class="chat-settings-stage-head">
  <button type="button" class="chat-settings-back" data-settings-back>
    <i class="fas fa-arrow-right"></i><span>${app().escapeHTML(t('تنظیمات', 'Settings'))}</span>
  </button>
  <h3 class="chat-settings-stage-title"></h3>
</header>
<div class="chat-settings-stage-body"></div>`;
  thread.appendChild(stage);
  return stage;
}

function settingsPaneTitle(id) {
  const tab = CHAT_SETTINGS_TABS.find((entry) => entry.id === id);
  return tab ? t(tab.fa, tab.en) : t('تنظیمات', 'Settings');
}

function setChatSettingsTab(id) {
  const wanted = CHAT_SETTINGS_TABS.some((tab) => tab.id === id) ? id : 'connection';
  const pane = document.querySelector(`#chatConnectionPanel [data-settings-pane="${wanted}"]`)
    || document.querySelector(`#chatSettingsStage [data-settings-pane="${wanted}"]`);
  if (!pane) return;
  chatState.settingsPane = wanted;

  const panel = document.getElementById('chatConnectionPanel');
  const stage = settingsStage();
  const wide = window.matchMedia('(min-width: 768px)').matches;

  document.querySelectorAll('[data-settings-pane]').forEach((node) => {
    node.classList.toggle('hidden', node !== pane);
  });
  document.querySelectorAll('#chatConnectionPanel [data-settings-tab]').forEach((button) => {
    button.classList.toggle('is-on', button.getAttribute('data-settings-tab') === wanted);
  });

  if (wide && stage) {
    if (!settingsPaneHomes.has(wanted)) {
      settingsPaneHomes.set(wanted, { parent: pane.parentElement, next: pane.nextSibling });
    }
    stage.querySelector('.chat-settings-stage-body')?.appendChild(pane);
    stage.querySelector('.chat-settings-stage-title').textContent = settingsPaneTitle(wanted);
    stage.classList.remove('hidden');
    /* On a wide window the menu stays visible in the rail with the open row
       marked, the way a master/detail list behaves. */
    panel?.classList.remove('pane-open');
  } else {
    /* A phone opens the section the way every phone app does: its own page,
       over the menu, with one way back. The pane itself is carried in — the
       same element the desktop stage borrows — so the controls inside it are
       the live ones either way. */
    stage?.classList.add('hidden');
    panel?.classList.remove('pane-open');
    openFullSheet({
      title: settingsPaneTitle(wanted),
      build: (body, adopt) => { adopt(pane, body); },
      onClose: () => {
        chatState.settingsPane = null;
        document.querySelectorAll('#chatConnectionPanel [data-settings-tab]')
          .forEach((button) => button.classList.remove('is-on'));
        pane.classList.add('hidden');
        window.requestAnimationFrame(() => syncRailChrome());
      },
    });
  }

  try { localStorage.setItem(CHAT_SETTINGS_TAB_KEY, wanted); } catch (_error) { /* private mode */ }
  if (wanted === 'storage') {
    renderStorageCard();
    if (!document.getElementById('chatFileManager')?.classList.contains('hidden')) renderFileManager();
  }
  applyCallsThreadHeader();
  /* Opening a section changes how tall the body wants to be. */
  window.requestAnimationFrame(() => syncRailChrome());
}

function restoreSettingsPane(id) {
  const home = settingsPaneHomes.get(id);
  const pane = document.querySelector(`[data-settings-pane="${id}"]`);
  if (home && pane) restoreNode(pane, home.parent, home.next);
  settingsPaneHomes.delete(id);
}

function closeChatSettingsPane() {
  chatState.settingsPane = null;
  /* On a phone the section is inside the sheet, and closing that is what puts
     the pane back where it belongs. */
  if (document.querySelector('#chatFullSheet [data-settings-pane]')) closeFullSheet();
  CHAT_SETTINGS_TABS.forEach((tab) => restoreSettingsPane(tab.id));
  document.querySelectorAll('[data-settings-pane]').forEach((pane) => pane.classList.add('hidden'));
  document.querySelectorAll('#chatConnectionPanel [data-settings-tab]').forEach((button) => button.classList.remove('is-on'));
  document.getElementById('chatSettingsStage')?.classList.add('hidden');
  document.getElementById('chatConnectionPanel')?.classList.remove('pane-open');
  applyCallsThreadHeader();
  window.requestAnimationFrame(() => syncRailChrome());
}

/* Back, from either place it can be pressed. */
document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-settings-back]')) return;
  closeChatSettingsPane();
});

/* A section opened on a desktop lives in the facing panel and a section opened
   on a phone lives in the rail, so a window crossing the breakpoint has to be
   re-staged rather than left half in each. Widening with nothing open fills the
   panel that just appeared. */
let settingsRestageTimer = 0;
window.addEventListener('resize', () => {
  /* Debounced: a resize fires on every frame of a window drag, and each call
     moves DOM nodes between the rail and the stage. */
  window.clearTimeout(settingsRestageTimer);
  settingsRestageTimer = window.setTimeout(() => {
    if (chatState.activeView !== 'connection') return;
    if (chatState.settingsPane) setChatSettingsTab(chatState.settingsPane);
    else openDefaultSettingsPane();
  }, 150);
});

/* The group composer and the member manager sit above the group list. With a
   dozen groups the list was a two-row window at the bottom of the column, so
   both now fold away and the list gets the height back. */
function makeCollapsible(element, faTitle, enTitle, { startOpen = false } = {}) {
  if (!element || element.dataset.collapsible) return;
  element.dataset.collapsible = '1';
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-collapse';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'chat-collapse-head';
  head.innerHTML = `<i class="fas fa-chevron-down"></i><span>${app().escapeHTML(t(faTitle, enTitle))}</span>`;
  element.parentNode.insertBefore(wrapper, element);
  wrapper.appendChild(head);
  wrapper.appendChild(element);
  wrapper.classList.toggle('is-open', startOpen);
  head.addEventListener('click', () => wrapper.classList.toggle('is-open'));
}

function buildChatGroupCollapsibles() {
  /* The composer moved into a dialog of its own, so there is no longer a fold
     above the list for it to live in. */
  makeCollapsible(document.getElementById('chatSpaceMembersPanel'), 'اعضای این گروه', 'Members of this group');
}

function renderPeers() {
bindRailCondense();
  bindChatRailResizer();
  bindProfileCard();
  bindThreadMenu();
renderChatNavBadges();
const list = document.getElementById('chatPeerList');
const count = document.getElementById('chatPeerCount');
if (!list || !count) return;
renderSpaceMemberPickers();
renderSpaceMemberManager();
const heading = document.querySelector('.chat-list-heading');
if (chatState.activeView === 'connection') {
/* Nothing to list in the settings view. A heading with a "start chat" button
   sitting over a paragraph explaining where the settings are was noise about
   the panel directly above it. */
heading?.classList.add('hidden');
list.classList.add('hidden');
list.innerHTML = '';
return;
}
heading?.classList.remove('hidden');
list.classList.remove('hidden');
const showArchived = Boolean(chatState.showArchived);
const allPeers = allConversationRecords()
.filter((peer) => peer.type !== 'group')
.filter((peer) => shouldShowConversation(peer))
.filter((peer) => Boolean(peer.archived) === showArchived);
allPeers.sort((left, right) => {
const leftPinned = left.pinned ? 1 : 0;
const rightPinned = right.pinned ? 1 : 0;
if (leftPinned !== rightPinned) return rightPinned - leftPinned;
if (leftPinned && rightPinned) return (left.pinOrder || 0) - (right.pinOrder || 0);
const leftOnline = left.status === 'online' ? 1 : 0;
const rightOnline = right.status === 'online' ? 1 : 0;
if (leftOnline !== rightOnline) return rightOnline - leftOnline;
const leftStamp = new Date((conversationHistory(left).slice(-1)[0]?.createdAt || conversationHistory(left).slice(-1)[0]?.timestamp) || left.lastSeenAt || 0).getTime();
const rightStamp = new Date((conversationHistory(right).slice(-1)[0]?.createdAt || conversationHistory(right).slice(-1)[0]?.timestamp) || right.lastSeenAt || 0).getTime();
return rightStamp - leftStamp;
});
const onlinePeers = allPeers.filter((peer) => peer.status === 'online');
if ((chatState.activePeerClientId || chatState.activeConversationId) && !activePeer() && chatState.activeView === 'chats') {
// Only forget a conversation that nothing can vouch for any more. Clearing on
// the first failed lookup meant a single render with an incomplete record list
// wiped the selection, which left the composer permanently disabled.
const stillKnown = Boolean(chatState.activeConversationId
&& (chatState.history[chatState.activeConversationId] || []).length);
if (!stillKnown) {
chatState.activePeerClientId = '';
chatState.activeConversationId = '';
}
}
/* No auto-seeding on wide layouts anymore: the chats pane opens empty with
   "after you pick a conversation, its history shows here", and the person
   chooses. A pane that silently selected the newest chat answered a question
   nobody asked and leaked which conversation was last active. */
let records = allPeers;
let title = t('چت‌ها', 'Chats');
if (chatState.activeView === 'groups') {
records = chatState.spaces.groups;
title = t('گروه‌ها', 'Groups');
} else if (chatState.activeView === 'calls') {
renderCalls();
return;
}
/* chatState.searchQuery no longer narrows this list. It is the search popup's
   landing mechanism — it makes the jumped-to thread render its full history
   with matches marked — and it used to leak into the list here, so after a
   search jump "back" showed one chat and nothing else until a full restart.
   The list is the list; narrowing lives in the popup and its chat picker. */
document.getElementById('chatListTitle').textContent = title;
/* How many conversations this list holds — allPeers, before the search
   filter, so typing in the box does not appear to delete chats. It used to
   report how many people were online, which the "online" filter chip under it
   already says; what is worth a number here is the size of the list itself. */
count.textContent = chatState.activeView === 'chats'
? String(allPeers.length)
: String(records.length);
/* Telegram's folders, reduced to the four that earn their place without any
   setup: everything, the ones waiting for a reply, the ones kept at the top,
   and the people who are here now. With a few dozen conversations the list was
   a long scroll with no way to narrow it — which is also most of why scrolling
   felt bad once the list grew. */
records = applyChatListFilter(records);
const filterChips = chatState.activeView === 'chats' ? chatListFilterChipsHtml(records) : '';
/* The archive lives in the filter row now, so there is no shelf to draw. */
const archiveShelf = '';
const bindArchiveShelf = () => {
list.querySelector('[data-chat-archive-shelf]')?.addEventListener('click', () => toggleArchivedView());
list.querySelectorAll('[data-chat-list-filter]').forEach((chip) => {
chip.addEventListener('click', () => setChatListFilter(chip.getAttribute('data-chat-list-filter')));
});
};
if (!records.length) {
list.innerHTML = filterChips + archiveShelf + `<div class="chat-empty-state">${showArchived ? t('آرشیو خالی است.', 'The archive is empty.') : t('هنوز موردی وجود ندارد.', 'Nothing here yet.')}</div>`;
bindArchiveShelf();
return;
}
list.innerHTML = filterChips + archiveShelf + records.map((record) => {
const key = getConversationKey(record);
const history = conversationHistory(record);
const last = history[history.length - 1];
const displayName = record.username || record.name || record.clientId || key;
const active = key === chatState.activeConversationId || record.clientId === chatState.activePeerClientId;
const isSecure = Boolean(record.type || chatState.sessions.get(record.peerId)?.cryptoKey || chatState.sessionKeys[record.peerId] || chatState.sessionKeys[record.fingerprint]);
const isGroup = record.type === 'group';
const presence = isGroup ? groupPresence(record) : null;
/* For a person "online" is a fact about them; for a group it is a summary of
   the people in it, and the dot follows the same three-way reading the badge
   does: everybody here, somebody here, nobody here. */
const online = isGroup ? Boolean(presence?.some) : record.status === 'online';
const presenceClass = isGroup
  ? (presence?.dissolved ? 'dissolved' : (presence?.all ? 'online' : (presence?.some ? 'partial' : 'offline')))
  : (online ? 'online' : 'offline');
const isSystem = record.system === true;
const pendingDraft = draftFor(key);
const previewLine = pendingDraft
|| last?.text
|| (last?.type === 'sticker' || last?.type === 'rich' ? mediaEntryLabel(last) : '')
|| last?.name
|| (record.type === 'group' ? t('گروه محلی', 'Local group') : '')
|| (isGroup ? '' : (online ? t('متصل', 'Connected') : t('عدم اتصال', 'Offline')));
/* A locked thread must not put its last line in the list - that is most of
   what somebody glancing at the phone would read. */
const hasLock = conversationHasLock(key);
const isLocked = conversationLocked(key);
const unreadCount = unreadConversationCount(key);
const pinned = Boolean(record.pinned);
const muted = Boolean(record.muted);
const archived = Boolean(record.archived);
const blocked = Boolean(record.blocked);
/* Avatars arrive through presence and contact cards from people never
   verified; sanitizeAvatarData admits only raster data: URLs, so nothing
   else can reach an src attribute in this list. */
const avatarSrc = sanitizeAvatarData(record.avatarData);
const avatarContent = isSystem
? '<i class="fas fa-bullhorn text-lg"></i>'
: (avatarSrc ? `<img src="${avatarSrc}" alt="">` : app().escapeHTML(initials(displayName)));
return `
<div role="button" tabindex="0" data-chat-conversation="${app().escapeHTML(key)}" data-chat-peer="${app().escapeHTML(record.clientId || '')}" class="chat-peer-card w-full text-right ${active ? 'active' : ''} ${pinned ? 'is-pinned' : ''} ${blocked ? 'is-blocked' : ''}">
<div class="flex items-center gap-3 min-w-0">
<div class="chat-avatar chat-peer-avatar ${presenceClass}">
${avatarContent}
${unreadCount ? `<span class="chat-unread-badge">${Math.min(99, unreadCount)}</span>` : ''}
</div>
<div class="min-w-0 flex-1">
<div class="flex items-center justify-between gap-2 min-w-0">
<div class="flex items-center gap-2 min-w-0">
<span class="chat-peer-presence-dot ${presenceClass}" aria-hidden="true"></span>
<div class="font-semibold text-white truncate">${app().escapeHTML(displayName)}</div>
${isSecure ? '<span class="text-emerald-300 text-xs"><i class="fas fa-shield-halved"></i></span>' : ''}
${pinned ? '<span class="text-amber-300 text-xs"><i class="fas fa-thumbtack"></i></span>' : ''}
${muted ? '<span class="text-slate-400 text-xs" title="' + app().escapeHTML(t('بی‌صدا', 'Muted')) + '"><i class="fas fa-bell-slash"></i></span>' : ''}
${blocked ? '<span class="text-rose-400 text-xs" title="' + app().escapeHTML(t('مسدود', 'Blocked')) + '"><i class="fas fa-ban"></i></span>' : ''}
</div>
${isGroup
? (presence.dissolved
  ? `<span class="chat-peer-status-badge dissolved">${t('منحل شده', 'Dissolved')}</span>`
  : `<span class="chat-peer-status-badge chat-group-count ${presenceClass}" title="${app().escapeHTML(t(`${presence.online} نفر از ${presence.total} عضو آنلاین‌اند`, `${presence.online} of ${presence.total} members are online`))}"><span class="chat-group-count-here">${presence.online}</span><span class="chat-group-count-sep">/</span><span class="chat-group-count-all">${presence.total}</span></span>`)
: `<span class="chat-peer-status-badge ${online ? 'online' : 'offline'}">${online ? t('متصل', 'Connected') : t('عدم اتصال', 'Offline')}</span>`}
</div>
<div class="flex items-center justify-between gap-3 min-w-0 mt-1">
<div class="text-xs text-slate-400 truncate">${isLocked
? `<span class="chat-locked-preview"><i class="fas fa-lock"></i> ${app().escapeHTML(t('قفل است', 'Locked'))}</span>`
: `${pendingDraft ? `<span class="chat-draft-tag">${app().escapeHTML(t('پیش‌نویس', 'Draft'))}</span> ` : ''}${app().escapeHTML(previewLine)}`}</div>
<span class="text-[11px] text-slate-500 shrink-0">${last ? formatTime(last.createdAt) : (record.lastSeenAt ? formatTime(record.lastSeenAt) : '')}</span>
</div>
<div class="chat-pin-actions">
<button type="button" data-chat-pin-conversation="${app().escapeHTML(key)}" title="${pinned ? t('برداشتن پین', 'Unpin') : t('پین کردن', 'Pin')}"><i class="fas fa-thumbtack"></i></button>
${pinned ? `<button type="button" data-chat-pin-move="${app().escapeHTML(key)}" data-chat-pin-direction="-1" title="${t('بالا', 'Move up')}"><i class="fas fa-chevron-up"></i></button><button type="button" data-chat-pin-move="${app().escapeHTML(key)}" data-chat-pin-direction="1" title="${t('پایین', 'Move down')}"><i class="fas fa-chevron-down"></i></button>` : ''}
<button type="button" data-chat-mute-conversation="${app().escapeHTML(key)}" class="${muted ? 'is-on' : ''}" title="${muted ? t('صدادار کردن', 'Unmute') : t('بی‌صدا کردن', 'Mute')}"><i class="fas ${muted ? 'fa-bell-slash' : 'fa-bell'}"></i></button>
<button type="button" data-chat-archive-conversation="${app().escapeHTML(key)}" class="${archived ? 'is-on' : ''}" title="${archived ? t('خروج از آرشیو', 'Unarchive') : t('آرشیو', 'Archive')}"><i class="fas fa-box-archive"></i></button>
<button type="button" data-chat-unread-conversation="${app().escapeHTML(key)}" class="${chatState.manualUnread?.[key] ? 'is-on' : ''}" title="${chatState.manualUnread?.[key] ? t('علامت خوانده‌شده', 'Mark as read') : t('علامت نخوانده', 'Mark as unread')}"><i class="fas ${chatState.manualUnread?.[key] ? 'fa-envelope-open' : 'fa-envelope'}"></i></button>
<button type="button" data-chat-export-conversation="${app().escapeHTML(key)}" title="${t('برون‌ریزی گفتگو', 'Export conversation')}"><i class="fas fa-file-arrow-down"></i></button>
<button type="button" data-chat-lock-conversation="${app().escapeHTML(key)}" class="${hasLock ? 'is-on' : ''}" title="${hasLock ? t('برداشتن قفل این گفتگو', 'Remove this conversation\'s lock') : t('قفل کردن این گفتگو', 'Lock this conversation')}"><i class="fas ${hasLock ? 'fa-lock' : 'fa-unlock'}"></i></button>
<button type="button" data-chat-block-conversation="${app().escapeHTML(key)}" class="${blocked ? 'is-danger' : ''}" title="${blocked ? t('رفع مسدودی', 'Unblock') : t('مسدود کردن', 'Block')}"><i class="fas ${blocked ? 'fa-user-slash' : 'fa-ban'}"></i></button>
</div>
</div>
</div>
</div>
`;
}).join('');
bindArchiveShelf();
list.querySelectorAll('[data-chat-conversation]').forEach((button) => {
button.addEventListener('click', (event) => {
if (event.target.closest('[data-chat-pin-conversation], [data-chat-pin-move], [data-chat-mute-conversation], [data-chat-archive-conversation], [data-chat-block-conversation], [data-chat-unread-conversation], [data-chat-export-conversation], [data-chat-lock-conversation]')) return;
/* Save whatever is in the box for the chat we are leaving before the id
   changes, or it would be filed under the conversation being opened. */
const previousConversationId = chatState.activeConversationId;
setDraft(chatState.activeConversationId, document.getElementById('chatComposer')?.value || '');
chatState.activePeerClientId = button.getAttribute('data-chat-peer');
chatState.activeConversationId = button.getAttribute('data-chat-conversation');
/* Composer state is per-conversation, and three pieces of it used to follow
   the reader into the thread they just opened: the self-destruct timer (so a
   message set to burn in one chat burned in another), a half-finished edit
   (whose pending text then landed in the new thread), and a multi-select.
   Each is restored from or cleared for the conversation actually opened. */
const openedRecord = conversationRecordById(chatState.activeConversationId);
chatState.timerSeconds = Number(openedRecord?.timerSeconds || 0);
if (typeof syncTimerUi === 'function') syncTimerUi();
if (previousConversationId !== chatState.activeConversationId) {
if (chatState.editingMessageId && typeof clearMessageContext === 'function') clearMessageContext();
if (chatState.selectedMessages?.size && typeof exitSelectionMode === 'function') exitSelectionMode();
}
const hadUnread = firstUnreadEntryId(chatState.activeConversationId);
clearManualUnread(chatState.activeConversationId);
markConversationRead(chatState.activeConversationId);
applyDraftToComposer(chatState.activeConversationId);
updateChatShellMode();
renderPeers();
renderActivePeer();
if (hadUnread) jumpToFirstUnread(chatState.activeConversationId);
});
button.addEventListener('keydown', (event) => {
if (event.key !== 'Enter' && event.key !== ' ') return;
event.preventDefault();
button.click();
});
});
list.querySelectorAll('[data-chat-unread-conversation]').forEach((button) => {
button.addEventListener('click', (event) => {
event.stopPropagation();
const key = button.dataset.chatUnreadConversation;
if (chatState.manualUnread?.[key]) { clearManualUnread(key); renderPeers(); renderChatNavBadges(); }
else markConversationUnread(key);
});
});
list.querySelectorAll('[data-chat-export-conversation]').forEach((button) => {
button.addEventListener('click', (event) => {
event.stopPropagation();
exportConversation(button.dataset.chatExportConversation);
});
});
list.querySelectorAll('[data-chat-pin-conversation]').forEach((button) => {
button.addEventListener('click', (event) => {
event.stopPropagation();
toggleConversationPin(button.dataset.chatPinConversation);
});
});
list.querySelectorAll('[data-chat-pin-move]').forEach((button) => {
button.addEventListener('click', (event) => {
event.stopPropagation();
movePinnedConversation(button.dataset.chatPinMove, Number(button.dataset.chatPinDirection || 0));
});
});
list.querySelectorAll('[data-chat-mute-conversation]').forEach((button) => {
button.addEventListener('click', (event) => {
event.stopPropagation();
toggleConversationMute(button.dataset.chatMuteConversation);
});
});
list.querySelectorAll('[data-chat-archive-conversation]').forEach((button) => {
button.addEventListener('click', (event) => {
event.stopPropagation();
toggleConversationArchive(button.dataset.chatArchiveConversation);
});
});
list.querySelectorAll('[data-chat-lock-conversation]').forEach((button) => {
button.addEventListener('click', async (event) => {
event.stopPropagation();
const key = button.dataset.chatLockConversation;
if (conversationHasLock(key)) await removeConversationLock(key);
else await askForConversationLock(key);
});
});
list.querySelectorAll('[data-chat-block-conversation]').forEach((button) => {
button.addEventListener('click', async (event) => {
event.stopPropagation();
const key = button.dataset.chatBlockConversation;
const record = conversationRecordById(key);
/* Blocking is the one destructive-feeling action here, so it asks first. */
if (record && !record.blocked && !await PoorijaDialogs.confirm(t('این مخاطب مسدود شود؟ پیام و تماس او دیگر دریافت نمی‌شود.', 'Block this contact? Their messages and calls will no longer be received.'))) return;
toggleConversationBlock(key);
});
});
}
async function copyChatFullIdentity() {
await ensureIdentity();
if (!chatState.profile.stablePeerId) {
chatState.profile.stablePeerId = generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-');
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
}
const text = identityText();
navigator.clipboard.writeText(text).then(() => {
notify(t('هویت شما کپی شد', 'Full identity copied to clipboard'), 'success');
}).catch(() => {
notify(t('خطا در کپی', 'Copy failed'), 'error');
});
}
window.copyChatFullIdentity = copyChatFullIdentity;
/* How dense the code is, in the number that decides whether a camera can read
   it. "It will not scan" is otherwise an argument nobody can settle. */
function renderIdentityQrMeta(info) {
const meta = document.getElementById('chatIdentityQrMeta');
if (!meta || !info) return;
const busy = info.modules >= 105;
meta.textContent = busy
? t(`${info.modules} ماژول — چگال است؛ گوشی را نزدیک‌تر بگیرید یا «بزرگ و پرنور» را بزنید.`,
    `${info.modules} modules — dense; hold the phone closer or use "Big and bright".`)
: t(`${info.modules} ماژول — به‌راحتی خوانده می‌شود.`,
    `${info.modules} modules — reads easily.`);
meta.classList.toggle('is-busy', busy);
}

/* Wired ONCE, and re-pointed at the current card on every open.
 *
 * This used to call addEventListener on every open, and the modal is reused
 * rather than rebuilt — so the second open left two listeners on the bright
 * button, the third left three, and one press produced that many stacked
 * overlays, each having captured a different card from a different open. That
 * is the whole of "I have to press the close cross several times" and "the
 * code looks different every time": several codes really were stacked, and
 * before the fix above each carried its own timestamp.
 *
 * The content lives in a variable the handlers read at click time, so there is
 * one listener for the life of the modal and it always shows what is on
 * screen now. */
let identityQrContent = '';

function wireIdentityQrControls(content) {
const kit = window.PoorijaQR;
if (!kit) return;
identityQrContent = content;
const presetSelect = document.getElementById('chatQrPreset');
const levelSelect = document.getElementById('chatQrLevel');
const boost = document.getElementById('chatQrBoostBtn');
const settings = kit.readSettings();
const fa = window.PoorijaApp?.state?.language === 'fa';
const alreadyWired = boost?.dataset.qrWired === '1';

if (presetSelect && !presetSelect.options.length) {
Object.entries(kit.PRESETS).forEach(([id, preset]) => {
const option = document.createElement('option');
option.value = id;
option.textContent = fa ? preset.fa : preset.en;
presetSelect.appendChild(option);
});
}
if (presetSelect) presetSelect.value = settings.preset;
if (levelSelect) levelSelect.value = settings.level;

if (alreadyWired) return;

const redraw = () => {
const box = document.getElementById('chatIdentityQrBox');
if (!box) return;
renderIdentityQrMeta(kit.render(box, identityQrContent, { px: 280 }));
};
presetSelect?.addEventListener('change', () => { kit.writeSettings({ preset: presetSelect.value }); redraw(); });
levelSelect?.addEventListener('change', () => { kit.writeSettings({ level: levelSelect.value }); redraw(); });
boost?.addEventListener('click', () => kit.present(identityQrContent, {
title: t('کارت شناسایی چت', 'Chat identity card'),
note: t('صفحه روشن می‌ماند تا دوربین کارش را بکند.', 'The screen is kept awake while the camera works.'),
}));
if (boost) boost.dataset.qrWired = '1';
}

function ensureIdentityQrModal() {
let modal = document.getElementById('chatIdentityQrModal');
if (modal) return modal;
modal = document.createElement('div');
modal.id = 'chatIdentityQrModal';
modal.className = 'chat-modal hidden';
modal.innerHTML = `
<div class="chat-modal-card">
<button type="button" class="chat-modal-close" data-chat-modal-close><i class="fas fa-xmark"></i></button>
<h3>${t('QR Code هویت چت', 'Chat identity QR code')}</h3>
<div id="chatIdentityQrBox" class="chat-qr-box"></div>
<p id="chatIdentityQrMeta" class="chat-qr-meta"></p>
<div class="chat-qr-controls">
<label class="chat-qr-field"><span>${t('رنگ', 'Palette')}</span><select id="chatQrPreset"></select></label>
<label class="chat-qr-field"><span>${t('تحمل خطا', 'Error tolerance')}</span><select id="chatQrLevel">
<option value="L">${t('کمینه — کمترین چگالی', 'Low — least dense')}</option>
<option value="M">${t('متوسط — پیشنهادی', 'Medium — recommended')}</option>
<option value="Q">${t('بالا — چگال‌تر', 'High — denser')}</option>
</select></label>
<button type="button" id="chatQrBoostBtn" class="chat-soft-btn"><i class="fas fa-sun"></i><span>${t('بزرگ و پرنور', 'Big and bright')}</span></button>
</div>
<p class="chat-help-note">${t('با کلیک روی QR، محتوای کامل آن در کلیپ‌بورد کپی می‌شود.', 'Click the QR to copy its full content.')}</p>
</div>`;
document.body.appendChild(modal);
modal.querySelector('[data-chat-modal-close]')?.addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', (event) => {
if (event.target === modal) modal.classList.add('hidden');
});
return modal;
}
async function showChatIdentityQr() {
try {
await ensureIdentity();
const modal = ensureIdentityQrModal();
const box = modal.querySelector('#chatIdentityQrBox');
/* The camera-sized card for the code; identityText() stays what gets copied. */
const content = typeof identityQrText === 'function' ? identityQrText() : identityText();
modal.classList.remove('hidden');
box.innerHTML = '';
try {
/* Through the shared kit rather than a bare QRCode call: it carries the
   quiet zone the specification requires (this was drawn hard against the
   edge of its container, which some readers will not even attempt), the
   palette the reader chose, and it reports the module count so the panel
   can say how dense the code is instead of leaving that to be guessed. */
if (window.PoorijaQR) {
const info = window.PoorijaQR.render(box, content, { px: 280 });
renderIdentityQrMeta(info);
} else if (typeof QRCode !== 'undefined') {
new QRCode(box, { text: content, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
} else {
box.textContent = content;
}
} catch (err) {
console.error('QR Generation failed:', err);
box.textContent = content;
}
wireIdentityQrControls(content);
box.onclick = () => navigator.clipboard.writeText(content)
.then(() => notify(t('محتوای QR کپی شد', 'QR content copied'), 'success'))
.catch(() => notify(t('کپی QR ناموفق بود', 'Could not copy QR content'), 'error'));
} catch (error) {
console.error('Fatal showChatIdentityQr:', error);
notify(t('خطا در نمایش QR: ', 'Error showing QR: ') + (error.message || 'Unknown'), 'error');
}
}
function addIdentityAsConversation(identity, { startSession = true } = {}) {
if (!identity?.peerId && !identity?.fingerprint) {
notify(t('هویت چت معتبر نیست.', 'Invalid chat identity.'), 'warning');
return null;
}
const record = mergePeerRecord({
clientId: identity.peerId || identity.fingerprint,
peerId: identity.peerId || identity.fingerprint,
username: identity.name || identity.peerId || t('کاربر', 'User'),
name: identity.name || '',
fingerprint: identity.fingerprint || '',
publicKeyData: identity.publicKeyData || '',
avatarData: identity.avatarData || '',
manual: true,
status: 'offline',
}, { online: false });
if (!record) return null;
record.manual = true;
saveContacts();
chatState.activePeerClientId = record.clientId;
chatState.activeConversationId = getConversationKey(record);
setChatView('chats');
renderPeers();
renderActivePeer();
if (startSession) {
connectChatTransport()
.then(() => {
/* startSecureSession opens a PeerJS data channel, which needs someone on
   the other end. Adding a contact who is not online used to end there —
   nothing was left behind, so they never learned anyone had reached for
   them. Reserving the session on the relay instead leaves an offer they
   collect on their next connect; the relay drops it after 72 hours so an
   unclaimed one does not sit there indefinitely. */
if (record.status === 'offline') return reserveOfflineSession(record);
return startSecureSession(record, { silent: false });
})
.catch(console.error);
}
if (chatState.ws && chatState.ws.readyState === 1) {
chatState.ws.send(JSON.stringify({ type: 'get-peers' }));
}
return record;
}
/* Leaves an introduction with the relay for somebody who is not there.
   It carries only what a QR code or a pasted identity already carries — name,
   peer id, fingerprint, public key — so the relay learns nothing it could not
   read off the envelope addressing anyway. */
function reserveOfflineSession(record) {
if (!record) return false;
const sent = sendRelayEnvelope(record, {
type: 'session-offer',
fromPeerId: chatState.peerId,
fromFingerprint: chatState.identity?.fingerprint || '',
identity: identityPayload(),
createdAt: new Date().toISOString(),
});
if (sent) {
notify(t(
'این مخاطب آنلاین نیست. درخواست سشن تا ۷۲ ساعت روی رله می‌ماند و به‌محض آنلاین شدن او برقرار می‌شود.',
'That contact is offline. The session request stays on the relay for 72 hours and is set up the moment they connect.',
), 'info');
}
return sent;
}
function ensureStartChatModal() {
let modal = document.getElementById('chatStartChatModal');
if (modal) return modal;
modal = document.createElement('div');
modal.id = 'chatStartChatModal';
modal.className = 'chat-modal hidden';
modal.innerHTML = `
<div class="chat-modal-card">
<button type="button" class="chat-modal-close" data-chat-modal-close><i class="fas fa-xmark"></i></button>
<h3>${t('شروع چت', 'Start chat')}</h3>
<div class="chat-start-actions">
<button type="button" data-chat-start-manual class="chat-primary-btn"><i class="fas fa-keyboard"></i><span>${t('دستی', 'Manual')}</span></button>
<button type="button" data-chat-start-camera class="chat-soft-btn"><i class="fas fa-camera"></i><span>${t('اسکن با دوربین', 'Scan with camera')}</span></button>
<button type="button" data-chat-start-auto class="chat-soft-btn"><i class="fas fa-clipboard"></i><span>${t('از کلیپ‌بورد', 'From clipboard')}</span></button>
</div>
<div data-chat-manual-form class="chat-manual-form hidden">
<input data-chat-manual-peer type="text" placeholder="${t('شناسه PEER', 'Peer ID')}">
<input data-chat-manual-key type="text" placeholder="${t('کلید امنیتی', 'Security key')}">
<textarea data-chat-manual-json rows="3" placeholder="${t('یا هویت کامل/JSON را اینجا بگذارید', 'Or paste full identity/JSON here')}"></textarea>
<button type="button" data-chat-manual-submit class="chat-primary-btn">${t('ساخت سشن', 'Create session')}</button>
</div>
<video data-chat-qr-video class="chat-qr-video hidden" autoplay playsinline muted></video>
<div class="chat-qr-fallback">
<button type="button" data-chat-qr-switch class="chat-soft-btn hidden" title="${t('دوربین بعدی', 'Next camera')}"><i class="fas fa-camera-rotate"></i><span>${t('دوربین بعدی', 'Next camera')}</span></button>
<button type="button" data-chat-qr-torch class="chat-soft-btn hidden" title="${t('چراغ دوربین', 'Camera light')}"><i class="fas fa-bolt"></i><span>${t('چراغ', 'Light')}</span></button>
<button type="button" data-chat-qr-file-btn class="chat-soft-btn"><i class="fas fa-image"></i><span>${t('اسکن از تصویر ذخیره‌شده', 'Scan saved image')}</span></button>
<input data-chat-qr-file type="file" accept="image/*,.heic,.heif" class="hidden">
</div>
</div>`;
document.body.appendChild(modal);
modal.querySelector('[data-chat-modal-close]')?.addEventListener('click', () => closeStartChatModal());
modal.addEventListener('click', (event) => {
if (event.target === modal) closeStartChatModal();
});
modal.querySelector('[data-chat-start-manual]')?.addEventListener('click', () => {
modal.querySelector('[data-chat-manual-form]')?.classList.toggle('hidden');
});
/* Two buttons, not one that changes meaning with the window width.
 *
 * This used to be a single control reading "Scan QR Code" below 1024px and
 * "Auto from clipboard" above it, so a tablet in landscape — which is over
 * 1024px and certainly has a camera — could not scan at all, and a desktop
 * with a webcam was never offered the option. Screen width is not a statement
 * about whether a camera exists. The camera button is shown when the API is
 * there and hidden when it is not, which is the actual question. */
const cameraBtn = modal.querySelector('[data-chat-start-camera]');
if (cameraBtn && !navigator.mediaDevices?.getUserMedia) cameraBtn.classList.add('hidden');
cameraBtn?.addEventListener('click', () => scanChatIdentityQr());
modal.querySelector('[data-chat-start-auto]')?.addEventListener('click', () => {
importChatIdentityFromClipboard();
});
modal.querySelector('[data-chat-qr-switch]')?.addEventListener('click', async () => {
const scanner = chatState.qrScanner;
const cameras = scanner?.cameras || [];
if (cameras.length < 2) return;
scanner.cameraIndex = (scanner.cameraIndex + 1) % cameras.length;
await scanChatIdentityQr(cameras[scanner.cameraIndex].deviceId);
});
modal.querySelector('[data-chat-manual-submit]')?.addEventListener('click', () => {
const raw = modal.querySelector('[data-chat-manual-json]')?.value || '';
const parsed = parseIdentityText(raw) || {
peerId: modal.querySelector('[data-chat-manual-peer]')?.value.trim(),
fingerprint: modal.querySelector('[data-chat-manual-key]')?.value.trim(),
name: '',
};
if (addIdentityAsConversation(parsed)) closeStartChatModal();
});
modal.querySelector('[data-chat-qr-torch]')?.addEventListener('click', () => toggleQrTorch());
modal.querySelector('[data-chat-qr-file-btn]')?.addEventListener('click', () => modal.querySelector('[data-chat-qr-file]')?.click());
modal.querySelector('[data-chat-qr-file]')?.addEventListener('change', async (event) => {
const file = event.target.files?.[0];
event.target.value = '';
if (file) await scanQrImageFile(file);
});
return modal;
}
function closeStartChatModal() {
const modal = document.getElementById('chatStartChatModal');
stopQrScanner();
modal?.classList.add('hidden');
}
function openStartChatModal() {
ensureStartChatModal().classList.remove('hidden');
}
async function importChatIdentityFromClipboard() {
try {
let text = '';
if (navigator.clipboard?.readText) {
text = await navigator.clipboard.readText();
} else {
text = await PoorijaDialogs.prompt(t('هویت کامل یا JSON را وارد کنید', 'Paste the full identity or JSON')) || '';
}
const parsed = parseIdentityText(text);
if (!parsed) {
notify(t('هویت معتبری در کلیپ‌بورد پیدا نشد.', 'No valid identity was found in clipboard.'), 'warning');
return;
}
if (addIdentityAsConversation(parsed)) closeStartChatModal();
} catch (error) {
const fallback = await PoorijaDialogs.prompt(t('خواندن کلیپ‌بورد ناموفق بود. هویت کامل را دستی وارد کنید:', 'Clipboard access failed. Paste the full identity manually:')) || '';
const parsed = parseIdentityText(fallback);
if (parsed && addIdentityAsConversation(parsed)) closeStartChatModal();
else notify(t('خواندن کلیپ‌بورد ناموفق بود.', 'Could not read clipboard.'), 'error');
}
}
async function handleScannedIdentity(rawValue) {
const parsed = parseIdentityText(rawValue);
if (!parsed) return false;
stopQrScanner();
if (addIdentityAsConversation(parsed)) closeStartChatModal();
return true;
}
function stopQrScanner() {
const scanner = chatState.qrScanner;
if (!scanner) return;
if (scanner.timer) clearInterval(scanner.timer);
if (scanner.animationFrame) cancelAnimationFrame(scanner.animationFrame);
scanner.stream?.getTracks?.().forEach((track) => track.stop());
const torchBtn = document.querySelector('[data-chat-qr-torch]');
if (torchBtn) torchBtn.classList.add('hidden');
chatState.qrScanner = null;
}

/* ---- QR decoding -----------------------------------------------------------
   jsQR only ever sees the pixels we hand it, so the hit rate is decided here
   rather than inside the library. A phone photo arrives at ten megapixels with
   the code occupying a small part of the frame, which is precisely the case
   jsQR handles worst, and the previous code passed the raw frame straight
   through at one fixed polarity. Each pass below is a different (crop, scale)
   guess; both polarities are tried for every one, cheapest pass first, and the
   search stops at the first hit. */
function decodeQrFromImageData(imageData) {
if (!window.jsQR || !imageData) return '';
for (const inversionAttempts of ['dontInvert', 'onlyInvert']) {
try {
const code = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts });
if (code?.data) return code.data;
} catch (_error) { /* jsQR throws on degenerate dimensions */ }
}
return '';
}

function qrImageDataFromSource(source, sourceWidth, sourceHeight, { crop = 1, maxSide = 1024 } = {}) {
if (!sourceWidth || !sourceHeight) return null;
const sw = Math.round(sourceWidth * crop);
const sh = Math.round(sourceHeight * crop);
if (sw < 24 || sh < 24) return null;
const sx = Math.round((sourceWidth - sw) / 2);
const sy = Math.round((sourceHeight - sh) / 2);
const scale = Math.min(1, maxSide / Math.max(sw, sh));
const dw = Math.max(24, Math.round(sw * scale));
const dh = Math.max(24, Math.round(sh * scale));
if (!chatState.qrCanvas) chatState.qrCanvas = document.createElement('canvas');
const canvas = chatState.qrCanvas;
canvas.width = dw;
canvas.height = dh;
const ctx = canvas.getContext('2d', { willReadFrequently: true });
if (!ctx) return null;
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';
try {
ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
return ctx.getImageData(0, 0, dw, dh);
} catch (_error) {
return null;
}
}

async function decodeQrWithNativeDetector(source) {
if (!('BarcodeDetector' in window)) return '';
try {
if (!chatState.qrDetector) chatState.qrDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
const codes = await chatState.qrDetector.detect(source);
return codes?.[0]?.rawValue || '';
} catch (_error) {
return '';
}
}

async function decodeQrFromSource(source, width, height, passes) {
const native = await decodeQrWithNativeDetector(source);
if (native) return native;
for (const pass of passes) {
const value = decodeQrFromImageData(qrImageDataFromSource(source, width, height, pass));
if (value) return value;
}
return '';
}

/* Live frames: cheap passes only, so the scan rate stays high enough for the
   camera to feel responsive. A centre crop is included because people aim the
   code at the middle of the viewfinder. */
const QR_LIVE_PASSES = [
{ crop: 1, maxSide: 640 },
{ crop: 0.62, maxSide: 480 },
];
/* Stored images: the code may be anywhere and any size, so spend more. */
const QR_FILE_PASSES = [
{ crop: 1, maxSide: 1024 },
{ crop: 1, maxSide: 1600 },
{ crop: 1, maxSide: 640 },
{ crop: 0.6, maxSide: 900 },
{ crop: 0.4, maxSide: 700 },
{ crop: 0.75, maxSide: 1400 },
];

async function applyQrCameraTuning(track) {
if (!track?.getCapabilities) return { torch: false };
let capabilities = {};
try { capabilities = track.getCapabilities() || {}; } catch (_error) { capabilities = {}; }
const advanced = [];
if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
advanced.push({ focusMode: 'continuous' });
}
/* A little optical zoom makes a small code fill more of the sensor, which is
   the single biggest factor in whether it decodes at all. */
if (capabilities.zoom && typeof capabilities.zoom.min === 'number') {
const target = Math.min(capabilities.zoom.max ?? capabilities.zoom.min, Math.max(capabilities.zoom.min, 1.6));
if (target > capabilities.zoom.min) advanced.push({ zoom: target });
}
if (advanced.length) {
try { await track.applyConstraints({ advanced }); } catch (_error) { /* best effort */ }
}
return { torch: Boolean(capabilities.torch) };
}

async function toggleQrTorch() {
const scanner = chatState.qrScanner;
const track = scanner?.stream?.getVideoTracks?.()[0];
if (!track) return;
const next = !scanner.torchOn;
try {
await track.applyConstraints({ advanced: [{ torch: next }] });
scanner.torchOn = next;
const btn = document.querySelector('[data-chat-qr-torch]');
if (btn) btn.classList.toggle('is-active', next);
} catch (_error) {
notify(t('چراغ دوربین در دسترس نیست.', 'Camera torch is not available.'), 'warning');
}
}

async function scanChatIdentityQr(deviceId = null) {
if (!navigator.mediaDevices?.getUserMedia) {
notify(t('دسترسی دوربین در این محیط پشتیبانی نمی‌شود؛ از ورود دستی یا تصویر ذخیره‌شده استفاده کنید.', 'Camera access is not available here; use manual entry or a saved image.'), 'warning');
return;
}
const modal = ensureStartChatModal();
const video = modal.querySelector('[data-chat-qr-video]');
try {
stopQrScanner();
/* Ask for a sharp, reasonably large frame: at the default capture size the
   code's modules are often too few pixels across to survive decoding. */
const stream = await navigator.mediaDevices.getUserMedia({
video: deviceId
? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
: {
/* `ideal`, never `exact`: a laptop has only a front camera and an
   exact rear-facing constraint fails outright rather than falling back. */
facingMode: { ideal: 'environment' },
width: { ideal: 1920 },
height: { ideal: 1080 },
frameRate: { ideal: 30 },
},
audio: false,
});
video.srcObject = stream;
video.classList.remove('hidden');
await video.play();
const track = stream.getVideoTracks?.()[0];
const { torch } = await applyQrCameraTuning(track);
const torchBtn = modal.querySelector('[data-chat-qr-torch]');
if (torchBtn) torchBtn.classList.toggle('hidden', !torch);
const keptCameras = chatState.qrScanner?.cameras || [];
const keptIndex = chatState.qrScanner?.cameraIndex || 0;
chatState.qrScanner = { stream, torchOn: false, cameras: keptCameras, cameraIndex: keptIndex };

/* A laptop usually has one camera and a tablet has two, but neither is a
   safe assumption — ask, and only offer the control if there is somewhere to
   switch to. Labels are empty until permission is granted, which is why this
   happens after getUserMedia rather than before. */
try {
const devices = await navigator.mediaDevices.enumerateDevices();
const cameras = devices.filter((device) => device.kind === 'videoinput');
chatState.qrScanner.cameras = cameras;
if (deviceId) {
const found = cameras.findIndex((camera) => camera.deviceId === deviceId);
chatState.qrScanner.cameraIndex = found >= 0 ? found : keptIndex;
}
const switchBtn = modal.querySelector('[data-chat-qr-switch]');
if (switchBtn) switchBtn.classList.toggle('hidden', cameras.length < 2);
} catch (_error) { /* enumeration refused; the single camera still works */ }

let busy = false;
const scanFrame = async () => {
const scanner = chatState.qrScanner;
if (!scanner) return;
if (busy || video.readyState < 2 || !video.videoWidth) {
scanner.animationFrame = requestAnimationFrame(scanFrame);
return;
}
busy = true;
try {
const value = await decodeQrFromSource(video, video.videoWidth, video.videoHeight, QR_LIVE_PASSES);
if (value && await handleScannedIdentity(value)) return;
} catch (_error) { /* keep scanning */ }
busy = false;
if (chatState.qrScanner) chatState.qrScanner.animationFrame = requestAnimationFrame(scanFrame);
};
chatState.qrScanner.animationFrame = requestAnimationFrame(scanFrame);
} catch (error) {
notify(t('فعال‌سازی دوربین برای اسکن QR ناموفق بود.', 'Could not start camera for QR scanning.'), 'error');
}
}

async function loadQrImageSource(file) {
/* createImageBitmap applies the EXIF orientation and decodes off the main
   thread; the <img> path is the fallback for engines without it. */
if (typeof createImageBitmap === 'function') {
try {
const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
if (bitmap?.width && bitmap?.height) return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
} catch (_error) { /* fall through */ }
}
const url = URL.createObjectURL(file);
try {
const image = await new Promise((resolve, reject) => {
const element = new Image();
element.onload = () => resolve(element);
element.onerror = () => reject(new Error('decode-failed'));
element.src = url;
});
const width = image.naturalWidth || image.width;
const height = image.naturalHeight || image.height;
if (!width || !height) throw new Error('empty-image');
return { source: image, width, height, release: () => URL.revokeObjectURL(url) };
} catch (error) {
URL.revokeObjectURL(url);
throw error;
}
}

async function scanQrImageFile(file) {
if (!file) return;
/* iOS hands over HEIC with an empty or unexpected type string, so a strict
   image/* test silently dropped perfectly good photos before anything was
   even attempted. */
const looksLikeImage = (file.type || '').startsWith('image/')
|| /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(file.name || '');
if (!looksLikeImage) {
notify(t('این فایل تصویر نیست.', 'That file is not an image.'), 'warning');
return;
}
if (!window.jsQR && !('BarcodeDetector' in window)) {
notify(t('اسکنر QR محلی بارگذاری نشده است.', 'Local QR scanner is not loaded.'), 'warning');
return;
}
let handle = null;
try {
handle = await loadQrImageSource(file);
} catch (_error) {
notify(t('خواندن تصویر QR ناموفق بود. اگر عکس HEIC است، آن را به JPEG تبدیل کنید.', 'Could not read the QR image. If it is a HEIC photo, convert it to JPEG first.'), 'error');
return;
}
try {
const value = await decodeQrFromSource(handle.source, handle.width, handle.height, QR_FILE_PASSES);
if (!value) {
notify(t('در این تصویر QR معتبر پیدا نشد. تصویر را بزرگ‌تر و بدون بریدگی امتحان کنید.', 'No QR code was found in this image. Try a larger, uncropped picture.'), 'warning');
return;
}
if (!await handleScannedIdentity(value)) {
/* A code was read but it is not one of ours — say so, instead of the old
   message that blamed the picture. */
notify(t('QR خوانده شد ولی هویت این برنامه نبود.', 'A QR code was read, but it is not a valid identity for this app.'), 'warning');
}
} finally {
handle.release?.();
}
}

/* ------------------------------------------------------------------ */
/* Chat appearance: the three tick colours, and profiles that set them */
/* ------------------------------------------------------------------ */

/* Why this exists at all: the read tick takes its colour from the theme, which
   is measured to clear 3:1 against that theme's own bubble. That is the right
   default and it is still only a default — on some themes the three states sit
   close enough together that a particular pair of eyes cannot separate them,
   and three states nobody can tell apart are worth no more than one. So the
   person reading the screen gets to decide, and is shown the contrast their
   choice actually achieves rather than being left to guess.

   Kept in plain localStorage rather than the encrypted store on purpose: it is
   a colour preference, it has to be applied before the vault is open (the lock
   screen shows no ticks, but the chat behind it renders as soon as it is), and
   nothing about it is worth a key. */
const CHAT_APPEARANCE_KEY = 'poorija_chat_appearance';
const CHAT_TICK_STATES = ['sent', 'delivered', 'seen'];

/* A profile sets all three at once. `null` means "whatever the theme says",
   which is what keeps the default honest: choosing the first profile is not a
   disguised set of hard-coded colours, it genuinely hands the decision back to
   the theme. */
const CHAT_APPEARANCE_PROFILES = [
  {
    id: 'theme',
    fa: 'رنگ‌های تم (پیش‌فرض)',
    en: 'Theme colours (default)',
    noteFa: 'هر تم رنگ خودش را برای تیک خوانده‌شده دارد که روی حباب همان تم اندازه‌گیری شده است.',
    noteEn: "Each theme brings its own read-tick colour, measured against that theme's own bubble.",
    colors: null,
  },
  {
    id: 'contrast',
    fa: 'کنتراست بالا',
    en: 'High contrast',
    noteFa: 'سه رنگ که روی هر تمی از هم جدا می‌مانند: خاکستری روشن، سفید، و سبز پررنگ.',
    noteEn: 'Three colours that stay apart on any theme: dim grey, white, then a strong green.',
    colors: { sent: '#cbd5e1', delivered: '#ffffff', seen: '#4ade80' },
  },
  {
    id: 'classic',
    fa: 'کلاسیک آبی',
    en: 'Classic blue',
    noteFa: 'همان چیزی که بیشتر پیام‌رسان‌ها نشان می‌دهند: خاکستری تا خوانده شود، بعد آبی.',
    noteEn: 'What most messengers show: grey until it is read, then blue.',
    colors: { sent: '#cbd5e1', delivered: '#e2e8f0', seen: '#38bdf8' },
  },
  {
    id: 'amber',
    fa: 'کهربایی',
    en: 'Amber',
    noteFa: 'برای تم‌های تیره، جایی که رنگ سرد روی حباب آبی گم می‌شود.',
    noteEn: 'For dark themes, where a cool colour is lost against a blue bubble.',
    colors: { sent: '#d6d3d1', delivered: '#fafaf9', seen: '#fbbf24' },
  },
  {
    id: 'mono',
    fa: 'تک‌رنگ',
    en: 'Monochrome',
    noteFa: 'بدون رنگ: سه حالت فقط با روشنایی از هم جدا می‌شوند.',
    noteEn: 'No colour at all: the three states differ by brightness only.',
    colors: { sent: '#94a3b8', delivered: '#cbd5e1', seen: '#ffffff' },
  },
];

/* Chat themes are not app themes. The app theme decides the whole interface;
   this decides the thread — the two bubbles and what sits behind them — so
   somebody can keep the app dark and still read their messages on parchment.
   `null` for a value means "leave the app theme's own token alone", which is
   what keeps the first entry honest. */
/* Each theme carries the text colour that can be READ on its own bubbles, not
   just the bubbles. Without it a light bubble kept the app theme's light text
   — on parchment the incoming messages were near-white on cream and could not
   be read at all, which the live preview showed the moment it existed. The
   values are measured: the worst pairing of the five is 4.8:1, against the
   4.5:1 body-text bar. */
const CHAT_THEMES = [
  {
    id: 'theme', fa: 'پیروی از تم برنامه', en: 'Follow the app theme',
    noteFa: 'حباب‌ها و پس‌زمینه همان چیزی می‌مانند که تم برنامه انتخاب کرده.',
    noteEn: 'Bubbles and background stay whatever the app theme chose.',
    bubbleMe: null, bubbleThem: null, background: null,
  },
  {
    id: 'midnight', fa: 'نیمه‌شب', en: 'Midnight',
    noteFa: 'آبی عمیق روی مشکی، برای خواندن در تاریکی.',
    noteEn: 'Deep blue on near-black, for reading in the dark.',
    bubbleMe: '#1d4ed8', bubbleThem: '#1e293b',
    textMe: '#f8fafc', textThem: '#f8fafc',
    background: 'linear-gradient(180deg, #0b1220, #020617)',
  },
  {
    id: 'parchment', fa: 'کاغذ', en: 'Parchment',
    noteFa: 'روشن و گرم؛ برای خواندن طولانی در روز.',
    noteEn: 'Light and warm, for long reading in daylight.',
    bubbleMe: '#b45309', bubbleThem: '#fef3c7',
    textMe: '#f8fafc', textThem: '#020617',
    background: 'linear-gradient(180deg, #fffbeb, #fde68a)',
  },
  {
    id: 'forest', fa: 'جنگل', en: 'Forest',
    noteFa: 'سبز آرام با کنتراست ملایم.',
    noteEn: 'Quiet greens with a gentle contrast.',
    bubbleMe: '#047857', bubbleThem: '#1c2b26',
    textMe: '#f8fafc', textThem: '#f8fafc',
    background: 'linear-gradient(180deg, #0b1f18, #04110c)',
  },
  {
    id: 'rose', fa: 'گل‌سرخ', en: 'Rose',
    noteFa: 'صورتی و بنفش، روشن.',
    noteEn: 'Pink and violet, light.',
    bubbleMe: '#be185d', bubbleThem: '#fce7f3',
    textMe: '#f8fafc', textThem: '#020617',
    background: 'linear-gradient(180deg, #fff1f2, #fbcfe8)',
  },
  {
    id: 'slate', fa: 'خاکستری', en: 'Slate',
    noteFa: 'بدون رنگ‌آمیزی؛ فقط خاکستری و کنتراست.',
    noteEn: 'No colouring at all: grey and contrast.',
    bubbleMe: '#475569', bubbleThem: '#1e293b',
    textMe: '#f8fafc', textThem: '#f8fafc',
    background: 'linear-gradient(180deg, #0f172a, #020617)',
  },
];

/* Backgrounds that need no files: a gradient is a string, it themes instantly,
   it costs nothing to store and it cannot fail to decode. An uploaded picture
   is the seventh option and lives in IndexedDB beside the stickers. */
const CHAT_BACKGROUNDS = [
  { id: '', fa: 'بدون تصویر', en: 'None', css: '' },
  { id: 'dusk', fa: 'غروب', en: 'Dusk', css: 'linear-gradient(160deg, #1e3a8a, #312e81 55%, #4c1d95)' },
  { id: 'ink', fa: 'مرکب', en: 'Ink', css: 'linear-gradient(160deg, #0f172a, #020617)' },
  { id: 'sand', fa: 'شن', en: 'Sand', css: 'linear-gradient(160deg, #fef3c7, #fcd34d 60%, #d97706)' },
  { id: 'mint', fa: 'نعنا', en: 'Mint', css: 'linear-gradient(160deg, #ecfeff, #a5f3fc 55%, #0e7490)' },
  { id: 'plum', fa: 'آلو', en: 'Plum', css: 'linear-gradient(160deg, #4a044e, #831843 60%, #1e1b4b)' },
  { id: 'grid', fa: 'شبکه', en: 'Grid',
    css: 'linear-gradient(rgba(148,163,184,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.10) 1px, transparent 1px)' },
];

function chatAppearanceDefaults() {
  return { profile: 'theme', colors: {}, chatTheme: 'theme', bubble: {}, background: '', zoom: 100, blur: 0 };
}
function loadChatAppearance() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_APPEARANCE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return chatAppearanceDefaults();
    const colors = {};
    CHAT_TICK_STATES.forEach((state) => {
      const value = raw.colors?.[state];
      if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) colors[state] = value.toLowerCase();
    });
    const profile = CHAT_APPEARANCE_PROFILES.some((item) => item.id === raw.profile) ? raw.profile : 'theme';
    const chatTheme = CHAT_THEMES.some((item) => item.id === raw.chatTheme) ? raw.chatTheme : 'theme';
    const bubble = {};
    ['me', 'them'].forEach((side) => {
      const value = raw.bubble?.[side];
      if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) bubble[side] = value.toLowerCase();
    });
    const clamp = (value, low, high, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
    };
    if (raw.bubble?.alpha !== undefined) bubble.alpha = clamp(raw.bubble.alpha, 35, 100, 100);
    if (raw.bubble?.radius !== undefined) bubble.radius = clamp(raw.bubble.radius, 2, 26, 14);
    const known = CHAT_BACKGROUNDS.some((item) => item.id === raw.background);
    const background = known || raw.background === 'custom' ? raw.background : '';
    return {
      profile, colors, chatTheme, bubble, background,
      zoom: clamp(raw.zoom, 85, 140, 100),
      blur: clamp(raw.blur, 0, 24, 0),
    };
  } catch (error) {
    return chatAppearanceDefaults();
  }
}
function saveChatAppearance(value) {
  try { localStorage.setItem(CHAT_APPEARANCE_KEY, JSON.stringify(value)); } catch (error) { /* storage full */ }
}

/* The colours a given setting resolves to: the profile first, then whatever
   the user overrode on top of it. An empty object means the theme decides and
   nothing is written onto <html> at all. */
function resolvedTickColors(setting) {
  const profile = CHAT_APPEARANCE_PROFILES.find((item) => item.id === setting.profile);
  const base = profile?.colors ? { ...profile.colors } : {};
  return { ...base, ...setting.colors };
}

/* Written as inline custom properties on <html>, which is where the themes put
   theirs, so a user colour beats the theme without either one knowing about
   the other. Removing the property — not setting it to some "default" colour —
   is what hands a state back to the theme. */
/* The uploaded background. Kept in IndexedDB rather than localStorage because
   localStorage is a few megabytes shared with everything else the profile
   stores, and a photograph from a phone will not fit beside it. */
const CHAT_BG_DB = 'poorija-chat-appearance';
const CHAT_BG_STORE = 'backgrounds';
function chatBgDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CHAT_BG_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CHAT_BG_STORE)) {
        request.result.createObjectStore(CHAT_BG_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
/* Keyed by profile, so a duress profile does not open onto the real one's
   wallpaper — the same reason the rest of this preference is namespaced. */
function chatBgKey() {
  return `bg:${appState()?.activeProfile || 'default'}`;
}
async function readChatBackgroundBlob() {
  try {
    const db = await chatBgDb();
    return await new Promise((resolve) => {
      const request = db.transaction(CHAT_BG_STORE, 'readonly').objectStore(CHAT_BG_STORE).get(chatBgKey());
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch (error) {
    return null;
  }
}
async function writeChatBackgroundBlob(blob) {
  const db = await chatBgDb();
  await new Promise((resolve, reject) => {
    const store = db.transaction(CHAT_BG_STORE, 'readwrite').objectStore(CHAT_BG_STORE);
    const request = blob ? store.put(blob, chatBgKey()) : store.delete(chatBgKey());
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
let chatBackgroundUrl = '';
async function paintCustomChatBackground() {
  const root = document.documentElement;
  if (chatBackgroundUrl) { URL.revokeObjectURL(chatBackgroundUrl); chatBackgroundUrl = ''; }
  const blob = await readChatBackgroundBlob();
  if (!blob) { root.style.removeProperty('--chat-thread-image'); return; }
  chatBackgroundUrl = URL.createObjectURL(blob);
  root.style.setProperty('--chat-thread-image', `url("${chatBackgroundUrl}")`);
}

/* Near-black or near-white, whichever can be read on the colour given. The
   same question the themes answer for their own accents, asked at the moment
   somebody picks a bubble colour of their own. */
function readableOn(colour) {
  const channels = (hexFromCss(colour).match(/[0-9a-f]{2}/gi) || []).map((part) => parseInt(part, 16));
  if (channels.length < 3) return '#f8fafc';
  const luminance = channels
    .map((channel) => { const x = channel / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.38 ? '#020617' : '#f8fafc';
}

function applyChatAppearance(setting = loadChatAppearance()) {
  const root = document.documentElement;
  const colors = resolvedTickColors(setting);
  CHAT_TICK_STATES.forEach((state) => {
    const property = `--chat-${state}-tick`;
    if (colors[state]) root.style.setProperty(property, colors[state]);
    else root.style.removeProperty(property);
  });
  /* Tells the stylesheet to stop dimming sent and delivered: a colour someone
     chose deliberately should be shown at the strength they chose it. */
  if (Object.keys(colors).length) root.setAttribute('data-tick-colors', 'custom');
  else root.removeAttribute('data-tick-colors');

  /* The chat theme first, then anything the user set on top of it — same order
     as the ticks, so a picked colour is never undone by the preset it was
     picked on top of. Removing a property rather than writing a default is
     what hands a decision back to the app theme. */
  const chatTheme = CHAT_THEMES.find((item) => item.id === setting.chatTheme);
  const bubbleMe = setting.bubble?.me || chatTheme?.bubbleMe || '';
  const bubbleThem = setting.bubble?.them || chatTheme?.bubbleThem || '';
  const setOrClear = (property, value) => {
    if (value) root.style.setProperty(property, value);
    else root.style.removeProperty(property);
  };
  setOrClear('--chat-bubble-me', bubbleMe);
  setOrClear('--chat-bubble-them', bubbleThem);
  /* The text that has to sit on them. A bubble colour without its text colour
     is how a light bubble ends up carrying the app theme's light text. When
     the user has picked their own bubble colour the theme's text no longer
     belongs to it, so the choice is made here from the colour they picked. */
  setOrClear('--chat-text-me', setting.bubble?.me
    ? readableOn(setting.bubble.me) : (chatTheme?.textMe || ''));
  setOrClear('--chat-text-them', setting.bubble?.them
    ? readableOn(setting.bubble.them) : (chatTheme?.textThem || ''));
  setOrClear('--chat-bubble-alpha', setting.bubble?.alpha !== undefined ? String(setting.bubble.alpha) : '');
  setOrClear('--chat-bubble-radius', setting.bubble?.radius !== undefined ? `${setting.bubble.radius}px` : '');
  setOrClear('--chat-zoom', setting.zoom && setting.zoom !== 100 ? String(setting.zoom / 100) : '');
  setOrClear('--chat-bg-blur', setting.blur ? `${setting.blur}px` : '');

  const preset = CHAT_BACKGROUNDS.find((item) => item.id === setting.background);
  if (setting.background === 'custom') {
    paintCustomChatBackground();
    root.style.removeProperty('--chat-thread-bg');
  } else {
    if (chatBackgroundUrl) { URL.revokeObjectURL(chatBackgroundUrl); chatBackgroundUrl = ''; }
    root.style.removeProperty('--chat-thread-image');
    /* A gradient preset replaces the thread's background outright; the theme's
       own value is what comes back when the preset is "none". */
    setOrClear('--chat-thread-bg', preset?.css || chatTheme?.background || '');
  }
}

/* What the chosen colour actually achieves against the bubble it sits on.
   Measured rather than asserted: the bubble is themed too, so the only honest
   answer comes from reading both computed colours at the time of asking. */
function tickContrastReport() {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const read = (value) => {
    probe.style.color = '';
    probe.style.color = value;
    const text = getComputedStyle(probe).color.trim();
    const numbers = (text.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    const scale = /^color\(/.test(text) ? 255 : 1;
    return numbers.slice(0, 3).map((channel) => Math.min(255, Math.max(0, channel * scale)));
  };
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((channel) => {
      const x = channel / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  try {
    const bubble = read('var(--chat-bubble-me, #2563eb)');
    return CHAT_TICK_STATES.map((state) => ({
      state,
      ratio: ratio(read(`var(--chat-${state}-tick, var(--chat-text-me, #ffffff))`), bubble),
    }));
  } catch (error) {
    return [];
  } finally {
    probe.remove();
  }
}

function paintTickContrast() {
  const out = document.getElementById('chatTickContrast');
  if (!out) return;
  const report = tickContrastReport();
  if (!report.length) { out.textContent = ''; return; }
  const worst = report.reduce((low, item) => (item.ratio < low.ratio ? item : low));
  const label = { sent: t('ارسال', 'sent'), delivered: t('رسیده', 'delivered'), seen: t('خوانده', 'read') }[worst.state];
  const value = worst.ratio.toFixed(2);
  out.textContent = t(`کمترین کنتراست: ${label} ${value}:۱`, `Lowest contrast: ${label} ${value}:1`);
  out.classList.toggle('is-weak', worst.ratio < 3);
}

/* The pickers need a concrete colour to show even when the theme is deciding,
   so they are seeded with whatever is on screen right now. */
function currentTickColor(state) {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  probe.style.color = `var(--chat-${state}-tick, var(--chat-text-me, #ffffff))`;
  document.body.appendChild(probe);
  const text = getComputedStyle(probe).color.trim();
  probe.remove();
  const numbers = (text.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
  const scale = /^color\(/.test(text) ? 255 : 1;
  const [r, g, b] = numbers.slice(0, 3).map((channel) => Math.round(Math.min(255, Math.max(0, channel * scale))));
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function renderChatAppearanceSettings() {
  const select = document.getElementById('chatAppearanceProfile');
  if (!select) return;
  const setting = loadChatAppearance();
  renderChatThemePicker(setting);
  renderChatBubbleControls(setting);
  renderChatBackgroundPicker(setting);
  select.innerHTML = CHAT_APPEARANCE_PROFILES
    .map((item) => `<option value="${item.id}">${app().escapeHTML(t(item.fa, item.en))}</option>`).join('');
  select.value = setting.profile;
  const note = document.getElementById('chatAppearanceProfileNote');
  const chosen = CHAT_APPEARANCE_PROFILES.find((item) => item.id === setting.profile);
  if (note) note.textContent = chosen ? t(chosen.noteFa, chosen.noteEn) : '';
  CHAT_TICK_STATES.forEach((state) => {
    const input = document.getElementById(`chatTick${state[0].toUpperCase()}${state.slice(1)}Color`);
    if (input) input.value = currentTickColor(state);
  });
  paintTickContrast();
}



/* What just changed, said out loud.
 *
 * A preview that only redraws leaves the user to spot the difference, and some
 * of these differences are small on purpose — five per cent of opacity, two
 * pixels of corner. Naming the thing that moved is what turns "something
 * happened" into "I changed the corner rounding", and it is also what a screen
 * reader gets, which is why the element is a live region rather than a label.
 *
 * One timer, restarted on every change, so dragging a slider does not queue up
 * forty announcements that then take forty seconds to drain. */
let previewNoteTimer = null;
function announcePreviewChange(text) {
  const out = document.getElementById('chatPreviewChanged');
  if (!out) return;
  out.textContent = text;
  out.classList.add('is-on');
  clearTimeout(previewNoteTimer);
  previewNoteTimer = setTimeout(() => out.classList.remove('is-on'), 2200);
}

function renderChatThemePicker(setting) {
  const select = document.getElementById('chatChatTheme');
  if (!select) return;
  select.innerHTML = CHAT_THEMES
    .map((item) => `<option value="${item.id}">${app().escapeHTML(t(item.fa, item.en))}</option>`).join('');
  select.value = setting.chatTheme;
  const note = document.getElementById('chatChatThemeNote');
  const chosen = CHAT_THEMES.find((item) => item.id === setting.chatTheme);
  if (note) note.textContent = chosen ? t(chosen.noteFa, chosen.noteEn) : '';
}

/* The sliders show the value that is IN FORCE, which for an untouched setting
   is the theme's, not a hard-coded 100 — otherwise the number under the thumb
   disagrees with the screen until the first drag. */
function renderChatBubbleControls(setting) {
  const readToken = (name, fallback) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  };
  const mine = document.getElementById('chatBubbleMineColor');
  const theirs = document.getElementById('chatBubbleTheirsColor');
  if (mine) mine.value = hexFromCss(readToken('--chat-bubble-me', '#0ea5e9'));
  if (theirs) theirs.value = hexFromCss(readToken('--chat-bubble-them', '#1e293b'));
  const pair = [
    ['chatBubbleAlpha', 'chatBubbleAlphaOut', setting.bubble?.alpha ?? 100, '%'],
    ['chatBubbleRadius', 'chatBubbleRadiusOut', setting.bubble?.radius ?? 14, 'px'],
    ['chatZoom', 'chatZoomOut', setting.zoom ?? 100, '%'],
    ['chatBackgroundBlur', 'chatBackgroundBlurOut', setting.blur ?? 0, 'px'],
  ];
  pair.forEach(([inputId, outputId, value, unit]) => {
    const input = document.getElementById(inputId);
    const output = document.getElementById(outputId);
    if (input) input.value = String(value);
    if (output) output.textContent = `${value}${unit}`;
  });
}

function renderChatBackgroundPicker(setting) {
  const grid = document.getElementById('chatBackgroundGrid');
  if (!grid) return;
  const swatch = (id, label, style, active) => `<button type="button"
    class="chat-bg-swatch ${active ? 'is-on' : ''}" data-chat-bg="${id}"
    title="${app().escapeHTML(label)}" aria-label="${app().escapeHTML(label)}"
    style="${style}"><span>${app().escapeHTML(label)}</span></button>`;
  grid.innerHTML = CHAT_BACKGROUNDS
    .map((item) => swatch(item.id, t(item.fa, item.en),
      item.css ? `background-image:${item.css};background-size:cover` : '',
      setting.background === item.id))
    .join('')
    + swatch('custom', t('تصویر من', 'My picture'),
      'background-image:var(--chat-thread-image, none);background-size:cover',
      setting.background === 'custom');
  document.getElementById('chatBackgroundClearBtn')
    ?.classList.toggle('hidden', setting.background !== 'custom');
}

/* A colour input takes #rrggbb and nothing else, and a token can hold rgba(),
   a gradient or a colour-mix. Canvas is not used here: it is colour-managed in
   some builds and hands back values several percent off. */
function hexFromCss(value) {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  probe.style.color = '';
  probe.style.color = value;
  document.body.appendChild(probe);
  const text = getComputedStyle(probe).color.trim();
  probe.remove();
  const numbers = (text.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
  if (numbers.length < 3) return '#000000';
  const scale = /^color\(/.test(text) ? 255 : 1;
  const [r, g, b] = numbers.slice(0, 3)
    .map((channel) => Math.round(Math.min(255, Math.max(0, channel * scale))));
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function wireChatAppearanceExtras() {
  const themeSelect = document.getElementById('chatChatTheme');
  if (!themeSelect || themeSelect.dataset.wired) return;
  themeSelect.dataset.wired = '1';
  const commit = (mutate) => {
    const setting = loadChatAppearance();
    mutate(setting);
    saveChatAppearance(setting);
    applyChatAppearance(setting);
    paintTickContrast();
  };
  themeSelect.addEventListener('change', () => {
    /* A chat theme sets both bubbles, so the per-bubble overrides go with it —
       the same rule the tick profiles follow, for the same reason. */
    commit((setting) => { setting.chatTheme = themeSelect.value; setting.bubble = {}; });
    renderChatAppearanceSettings();
    const chosen = CHAT_THEMES.find((item) => item.id === themeSelect.value);
    announcePreviewChange(t(`تم چت: ${chosen ? chosen.fa : ''}`, `Chat theme: ${chosen ? chosen.en : ''}`));
  });
  [['chatBubbleMineColor', 'me'], ['chatBubbleTheirsColor', 'them']].forEach(([id, side]) => {
    document.getElementById(id)?.addEventListener('input', (event) => {
      commit((setting) => { setting.bubble[side] = event.target.value.toLowerCase(); });
      announcePreviewChange(side === 'me'
        ? t('رنگ حباب خودتان', 'Your bubble colour')
        : t('رنگ حباب طرف مقابل', 'Their bubble colour'));
    });
  });
  const slider = (id, outputId, unit, label, apply) => {
    const input = document.getElementById(id);
    const output = document.getElementById(outputId);
    input?.addEventListener('input', () => {
      const value = Number(input.value);
      if (output) output.textContent = `${value}${unit}`;
      commit((setting) => apply(setting, value));
      announcePreviewChange(`${label()} — ${value}${unit}`);
    });
  };
  slider('chatBubbleAlpha', 'chatBubbleAlphaOut', '%',
    () => t('شفافیت حباب', 'Bubble opacity'), (setting, value) => { setting.bubble.alpha = value; });
  slider('chatBubbleRadius', 'chatBubbleRadiusOut', 'px',
    () => t('گردی گوشه‌ها', 'Corner rounding'), (setting, value) => { setting.bubble.radius = value; });
  slider('chatZoom', 'chatZoomOut', '%',
    () => t('بزرگ‌نمایی متن', 'Text size'), (setting, value) => { setting.zoom = value; });
  slider('chatBackgroundBlur', 'chatBackgroundBlurOut', 'px',
    () => t('محو کردن پس‌زمینه', 'Background blur'), (setting, value) => { setting.blur = value; });

  document.getElementById('chatBackgroundGrid')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-chat-bg]');
    if (!button) return;
    const id = button.getAttribute('data-chat-bg');
    if (id === 'custom') {
      readChatBackgroundBlob().then((blob) => {
        if (!blob) { document.getElementById('chatBackgroundFileInput')?.click(); return; }
        commit((setting) => { setting.background = 'custom'; });
        renderChatBackgroundPicker(loadChatAppearance());
      });
      return;
    }
    commit((setting) => { setting.background = id; });
    renderChatBackgroundPicker(loadChatAppearance());
    const preset = CHAT_BACKGROUNDS.find((item) => item.id === id);
    announcePreviewChange(t(`پس‌زمینه: ${preset ? preset.fa : ''}`, `Background: ${preset ? preset.en : ''}`));
  });
  document.getElementById('chatBackgroundUploadBtn')?.addEventListener('click', () => {
    document.getElementById('chatBackgroundFileInput')?.click();
  });
  document.getElementById('chatBackgroundFileInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    /* Eight megabytes of wallpaper is not a wallpaper, it is a mistake; the
       thread would stall decoding it on every open. */
    if (file.size > 8 * 1024 * 1024) {
      notify(t('تصویر باید کمتر از ۸ مگابایت باشد.', 'The picture has to be under 8 MB.'), 'warning');
      return;
    }
    try {
      await writeChatBackgroundBlob(file);
      commit((setting) => { setting.background = 'custom'; });
      renderChatBackgroundPicker(loadChatAppearance());
      announcePreviewChange(t('پس‌زمینهٔ دلخواه', 'Your own background'));
      notify(t('پس‌زمینه تنظیم شد.', 'Background set.'), 'success');
    } catch (error) {
      notify(t('ذخیرهٔ تصویر ناموفق بود.', 'The picture could not be saved.'), 'error');
    }
  });
  document.getElementById('chatBackgroundClearBtn')?.addEventListener('click', async () => {
    await writeChatBackgroundBlob(null).catch(() => {});
    commit((setting) => { setting.background = ''; });
    renderChatAppearanceSettings();
  });
  document.getElementById('chatAppearanceResetBtn')?.addEventListener('click', async () => {
    await writeChatBackgroundBlob(null).catch(() => {});
    const next = chatAppearanceDefaults();
    saveChatAppearance(next);
    applyChatAppearance(next);
    renderChatAppearanceSettings();
    if (typeof renderMessages === 'function') renderMessages();
    notify(t('ظاهر چت بازنشانی شد.', 'Chat appearance is back to the theme.'), 'success');
  });
}

function wireChatAppearanceSettings() {
  const select = document.getElementById('chatAppearanceProfile');
  if (!select || select.dataset.wired) return;
  select.dataset.wired = '1';
  select.addEventListener('change', () => {
    /* Picking a profile is picking all three again, so the per-state
       overrides go: leaving them would make the profile a lie. */
    const next = { ...loadChatAppearance(), profile: select.value, colors: {} };
    saveChatAppearance(next);
    applyChatAppearance(next);
    renderChatAppearanceSettings();
    const chosen = CHAT_APPEARANCE_PROFILES.find((item) => item.id === select.value);
    announcePreviewChange(t(`پروفایل تیک: ${chosen ? chosen.fa : ''}`, `Tick profile: ${chosen ? chosen.en : ''}`));
  });
  CHAT_TICK_STATES.forEach((state) => {
    const input = document.getElementById(`chatTick${state[0].toUpperCase()}${state.slice(1)}Color`);
    if (!input) return;
    input.addEventListener('input', () => {
      const setting = loadChatAppearance();
      setting.colors[state] = input.value.toLowerCase();
      saveChatAppearance(setting);
      applyChatAppearance(setting);
      paintTickContrast();
      announcePreviewChange({
        sent: t('رنگ تیک ارسال‌شده', 'Sent tick colour'),
        delivered: t('رنگ تیک رسیده', 'Delivered tick colour'),
        seen: t('رنگ تیک خوانده‌شده', 'Read tick colour'),
      }[state]);
      if (typeof renderMessages === 'function') renderMessages();
    });
  });
  wireChatAppearanceExtras();
  document.getElementById('chatTickResetBtn')?.addEventListener('click', () => {
    const next = chatAppearanceDefaults();
    saveChatAppearance(next);
    applyChatAppearance(next);
    renderChatAppearanceSettings();
    if (typeof renderMessages === 'function') renderMessages();
    notify(t('رنگ تیک‌ها به تم برگشت.', 'Tick colours are back to the theme.'), 'success');
  });
}

/* localStorage in this app is namespaced per profile, so this preference is
   really stored as poorija_p_<profile>_chat_appearance and cannot be read back
   until a profile has been adopted. That is the right shape — a duress profile
   should not inherit the real one's appearance — but it means applying it at
   DOMContentLoaded reads an empty box and silently does nothing, which is what
   made a chosen colour vanish on reload. Unlock is the first moment the answer
   exists, and it is also before any thread is painted. */
document.addEventListener('DOMContentLoaded', () => {
  wireChatAppearanceSettings();
});
window.addEventListener('poorija:unlock', () => {
  applyChatAppearance();
  wireChatAppearanceSettings();
  renderChatAppearanceSettings();
});
/* The theme decides two of the three, so a theme change moves the numbers the
   contrast readout is reporting and the colours the pickers are showing. */
window.addEventListener('poorija:theme-changed', () => renderChatAppearanceSettings());
