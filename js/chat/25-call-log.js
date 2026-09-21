/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 25 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Call history — a log you can actually manage
*/

/* =====================================================================
   Call history — a log you can actually manage
   ---------------------------------------------------------------------
   The log kept the last eighty calls and offered exactly one action:
   redial. There was no way to drop a single missed call, let alone one
   conversation's worth, and no way to empty it at all — the only route
   to a clean log was to place eighty more calls and push the old ones
   off the end.

   Now: delete one, delete a whole peer's run, delete everything in the
   section you are looking at, delete anything older than a month, or
   delete the lot. Plus a select mode for the cases none of those fit.
   ===================================================================== */
const CALL_FILTERS = [
  { id: 'all', fa: 'همه', en: 'All', predicate: () => true },
  { id: 'incoming', fa: 'ورودی', en: 'Incoming', predicate: (call) => call.direction === 'in' && !isMissedCallStatus(call.status) },
  { id: 'outgoing', fa: 'خروجی', en: 'Outgoing', predicate: (call) => call.direction === 'out' && !isMissedCallStatus(call.status) },
  { id: 'missed', fa: 'بی‌پاسخ', en: 'Missed', predicate: (call) => isMissedCallStatus(call.status) },
];

function activeCallFilter() {
  return CALL_FILTERS.find((filter) => filter.id === chatState.callFilter) || CALL_FILTERS[0];
}
function callGroupKey(call) {
  return call.peerId || call.name || 'unknown';
}
/* What the user is actually looking at: the section, narrowed by the search
   box. Every bulk action works on exactly this set, which is the only way
   "clear this section" can mean what it says. */
function visibleCallRecords() {
  const needle = (chatState.callSearch || '').trim().toLowerCase();
  return chatState.calls
    .filter(activeCallFilter().predicate)
    .filter((call) => !needle
      || String(call.name || '').toLowerCase().includes(needle)
      || String(call.peerId || '').toLowerCase().includes(needle));
}

function deleteCallRecords(ids) {
  const doomed = new Set(ids.filter(Boolean));
  if (!doomed.size) return 0;
  const before = chatState.calls.length;
  chatState.calls = chatState.calls.filter((call) => !doomed.has(call.id));
  const removed = before - chatState.calls.length;
  if (!removed) return 0;
  doomed.forEach((id) => chatState.callSelection.delete(id));
  saveCalls();
  renderCalls();
  return removed;
}

async function confirmAndDeleteCalls(ids, question) {
  const list = ids.filter(Boolean);
  if (!list.length) return;
  if (!await PoorijaDialogs.confirm(question)) return;
  const removed = deleteCallRecords(list);
  notify(t(`${removed} تماس از تاریخچه حذف شد.`, `${removed} calls removed from the log.`), 'success');
}

function deleteCallGroup(key) {
  const ids = visibleCallRecords().filter((call) => callGroupKey(call) === key).map((call) => call.id);
  const name = chatState.calls.find((call) => callGroupKey(call) === key)?.name || key;
  confirmAndDeleteCalls(ids, t(
    `${ids.length} تماس با «${name}» در این بخش حذف شود؟`,
    `Delete ${ids.length} calls with "${name}" in this section?`,
  ));
}

function clearCallSection() {
  const ids = visibleCallRecords().map((call) => call.id);
  const label = t(activeCallFilter().fa, activeCallFilter().en);
  confirmAndDeleteCalls(ids, t(
    `همهٔ ${ids.length} تماس بخش «${label}» حذف شود؟`,
    `Delete all ${ids.length} calls in "${label}"?`,
  ));
}

function clearAllCalls() {
  confirmAndDeleteCalls(chatState.calls.map((call) => call.id), t(
    `کل تاریخچهٔ تماس‌ها (${chatState.calls.length} مورد) پاک شود؟ این کار برگشت‌پذیر نیست.`,
    `Erase the whole call log (${chatState.calls.length} entries)? This cannot be undone.`,
  ));
}

function pruneOldCalls(days = 30) {
  const cutoff = Date.now() - (days * 86400000);
  const ids = chatState.calls
    .filter((call) => (Date.parse(call.createdAt || '') || 0) < cutoff)
    .map((call) => call.id);
  if (!ids.length) {
    notify(t(`تماسی قدیمی‌تر از ${days} روز نیست.`, `Nothing older than ${days} days.`), 'info');
    return;
  }
  confirmAndDeleteCalls(ids, t(
    `${ids.length} تماس قدیمی‌تر از ${days} روز حذف شود؟`,
    `Delete ${ids.length} calls older than ${days} days?`,
  ));
}

function setCallSelectMode(on) {
  chatState.callSelectMode = Boolean(on);
  if (!chatState.callSelectMode) chatState.callSelection.clear();
  renderCalls();
}
function toggleCallSelected(id) {
  if (chatState.callSelection.has(id)) chatState.callSelection.delete(id);
  else chatState.callSelection.add(id);
  renderCalls();
}
function toggleCallGroupSelected(key) {
  const ids = visibleCallRecords().filter((call) => callGroupKey(call) === key).map((call) => call.id);
  const allOn = ids.every((id) => chatState.callSelection.has(id));
  ids.forEach((id) => {
    if (allOn) chatState.callSelection.delete(id);
    else chatState.callSelection.add(id);
  });
  renderCalls();
}
function toggleAllCallsSelected() {
  const ids = visibleCallRecords().map((call) => call.id);
  const allOn = ids.length > 0 && ids.every((id) => chatState.callSelection.has(id));
  if (allOn) ids.forEach((id) => chatState.callSelection.delete(id));
  else ids.forEach((id) => chatState.callSelection.add(id));
  renderCalls();
}
function deleteSelectedCalls() {
  const ids = [...chatState.callSelection];
  confirmAndDeleteCalls(ids, t(
    `${ids.length} تماس انتخاب‌شده حذف شود؟`,
    `Delete ${ids.length} selected calls?`,
  ));
  if (!chatState.callSelection.size) setCallSelectMode(false);
}
