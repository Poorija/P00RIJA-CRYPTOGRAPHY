/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 21 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Chat list filters
*/

/* ---------------------------------------------------------------------
   Chat list filters
   --------------------------------------------------------------------- */
const CHAT_LIST_FILTERS = [
  { id: 'all', fa: 'همه', en: 'All' },
  { id: 'unread', fa: 'خوانده‌نشده', en: 'Unread' },
  { id: 'pinned', fa: 'سنجاق‌شده', en: 'Pinned' },
  { id: 'online', fa: 'آنلاین', en: 'Online' },
];
function currentChatListFilter() {
  const wanted = chatState.chatListFilter || 'all';
  return CHAT_LIST_FILTERS.some((entry) => entry.id === wanted) ? wanted : 'all';
}
function chatListFilterPredicate(id) {
  if (id === 'unread') return (record) => unreadConversationCount(getConversationKey(record)) > 0;
  if (id === 'pinned') return (record) => Boolean(record.pinned);
  if (id === 'online') return (record) => record.status === 'online';
  return () => true;
}
function applyChatListFilter(records) {
  if (chatState.activeView !== 'chats') return records;
  const id = currentChatListFilter();
  if (id === 'all') return records;
  const filtered = records.filter(chatListFilterPredicate(id));
  /* A filter that empties the list is a dead end with no way back except
     finding the chip again, so an empty result falls back to everything and
     the chip returns to "All" on the next render. */
  if (!filtered.length) {
    chatState.chatListFilter = 'all';
    return records;
  }
  return filtered;
}
function chatListFilterChipsHtml(visibleRecords) {
  const active = currentChatListFilter();
  /* Counts come from the unfiltered set so a chip can say how much it would
     show, not how much is showing. */
  const pool = allConversationRecords()
    .filter((peer) => peer.type !== 'group')
    .filter((peer) => shouldShowConversation(peer))
    .filter((peer) => Boolean(peer.archived) === Boolean(chatState.showArchived));
  const chips = CHAT_LIST_FILTERS.map((entry) => {
    const total = entry.id === 'all' ? pool.length : pool.filter(chatListFilterPredicate(entry.id)).length;
    if (entry.id !== 'all' && !total) return '';
    return `<button type="button" role="tab" aria-selected="${entry.id === active}" data-chat-list-filter="${entry.id}" class="chat-list-filter ${entry.id === active ? 'is-on' : ''}">${app().escapeHTML(t(entry.fa, entry.en))}${total ? `<span>${total > 99 ? '99+' : total}</span>` : ''}</button>`;
  }).join('');
  /* The archive is another way of narrowing the same list, so it belongs in
     the same row as the rest. It had a row of its own above the list, which
     cost a line of height to say what a chip says. */
  const archivedCount = archivedConversationCount();
  const showArchived = Boolean(chatState.showArchived);
  const archiveChip = (archivedCount || showArchived)
    ? `<button type="button" role="tab" aria-selected="${showArchived}" data-chat-archive-shelf class="chat-list-filter chat-list-filter-archive ${showArchived ? 'is-on' : ''}" title="${app().escapeHTML(showArchived ? t('بازگشت به چت‌ها', 'Back to chats') : t('چت‌های آرشیو شده', 'Archived chats'))}"><i class="fas fa-box-archive"></i>${app().escapeHTML(t('آرشیو', 'Archived'))}${archivedCount ? `<span>${archivedCount > 99 ? '99+' : archivedCount}</span>` : ''}</button>`
    : '';
  return `<div class="chat-list-filters" role="tablist">${chips}${archiveChip}</div>`;
}
function setChatListFilter(id) {
  chatState.chatListFilter = CHAT_LIST_FILTERS.some((entry) => entry.id === id) ? id : 'all';
  renderPeers();
}
