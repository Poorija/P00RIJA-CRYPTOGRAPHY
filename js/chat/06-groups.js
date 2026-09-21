/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 6 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Group management
*/

/* =====================================================================
   Group management
   ---------------------------------------------------------------------
   Creation, distribution and messaging already worked. What was missing
   is everything you do to a group after it exists: rename it, describe
   it, give it a picture, add and remove people, hand out admin, and
   leave.

   Removal is the reason this needs a revision counter. upsertSharedSpace
   MERGES member lists, which is right when two devices learn about the
   same group from different directions — but it means a removal can
   never propagate, because the union always puts the member back. Every
   edit bumps `rev`; a record with a higher rev REPLACES rather than
   merges, so the newest edit wins and removals stick.
   ===================================================================== */
function spaceRoleOf(space, memberKey) {
  if (!space || !memberKey) return 'member';
  const owner = [space.ownerPeerId, space.ownerClientId, space.ownerFingerprint].filter(Boolean);
  if (owner.includes(memberKey)) return 'owner';
  return (Array.isArray(space.admins) ? space.admins : []).includes(memberKey) ? 'admin' : 'member';
}
function localSpaceRole(space) {
  const keys = localMembershipKeys();
  const owner = [space?.ownerPeerId, space?.ownerClientId, space?.ownerFingerprint].filter(Boolean);
  if (owner.some((key) => keys.has(key))) return 'owner';
  const admins = Array.isArray(space?.admins) ? space.admins : [];
  return admins.some((key) => keys.has(key)) ? 'admin' : 'member';
}
function canManageSpace(space) {
  return ['owner', 'admin'].includes(localSpaceRole(space));
}

/* Who may push a space record at somebody else. A space-sync carries the whole
   roster — membership, admins, permissions — so accepting one from an arbitrary
   member lets anyone rewrite the group. The owner's keys are the authority;
   this device is trusted about edits it made itself, and a space nobody has
   seen yet is first sight, which is simply how a group arrives. */
function isSpaceUpdateAuthorized(existingSpace, senderFingerprint, senderPeerId) {
  if (!existingSpace) return true;
  const sender = [senderFingerprint, senderPeerId].filter(Boolean);
  if (!sender.length) return false;
  if (sender.includes(existingSpace.ownerFingerprint) || sender.includes(existingSpace.ownerPeerId)) return true;
  const mine = [chatState.identity?.fingerprint, chatState.peerId].filter(Boolean);
  return sender.some((key) => mine.includes(key));
}

/* A note in the thread, written the same way on every device that hears about
   the change. The id is derived from the group, its revision and the words, so
   a note that arrives twice - a relay retry, or two peers both relaying it -
   is written once. */
function spaceNoteId(space, text) {
  const basis = `${space?.conversationId || ''}|${Number(space?.rev || 0)}|${text}`;
  let hash = 0;
  for (let i = 0; i < basis.length; i += 1) {
    hash = ((hash << 5) - hash + basis.charCodeAt(i)) | 0;
  }
  return `sys-${Math.abs(hash).toString(36)}`;
}
function appendSpaceNote(space, text) {
  if (!space?.conversationId || !text) return;
  const id = spaceNoteId(space, text);
  const seen = chatState.history[space.conversationId] || [];
  if (seen.some((entry) => entry.id === id)) return;
  appendHistory(space.conversationId, {
    id,
    direction: 'in',
    type: 'system-note',
    text,
    createdAt: new Date().toISOString(),
    status: 'delivered',
  });
}

/* Applies an edit locally, bumps the revision and tells everyone. One place,
   so no edit can ever go out without a rev bump and leave peers merging it. */
function commitSpaceEdit(space, patch, systemText = '') {
  if (!space) return;
  Object.assign(space, patch, { rev: Number(space.rev || 0) + 1, updatedAt: new Date().toISOString() });
  saveSpaces();
  if (systemText) appendSpaceNote(space, systemText);
  /* The note goes out with the change. It used to be written only on the
     device that made the edit, so everybody else saw a group silently rename
     itself or change its admins with nothing said - the change arrived, the
     sentence explaining it did not. */
  broadcastSpaceRecord(space, systemText);
  renderPeers();
  renderActivePeer();
  renderMessages();
  renderSpaceInfoPanel();
  /* The rules dialog shows the same state; leaving it stale would make a
     switch look as if it had not moved. */
  if (document.getElementById('chatPermsDialog')) renderPermsDialog();
}

function handleSpaceRemoval(incoming) {
  const existing = chatState.spaces.groups.find((item) => item.conversationId === incoming?.conversationId);
  if (!existing) return false;
  if (Number(incoming.rev || 0) <= Number(existing.rev || 0)) return false;
  /* An empty member list means "everyone belongs" to spaceIncludesLocalUser,
     so a delete-for-everyone tombstone has to say what it is out loud. */
  if (!incoming.deleted && spaceIncludesLocalUser(incoming)) return false;

  if (incoming.deleted) {
    /* Dissolving a group is the owner's decision about the group, not about
       what is on anybody else's device. The conversation and everything said
       in it stay where they are and simply stop being live - deleting a
       member's own copy of their own history would be the app taking something
       from them on somebody else's word. What does go, completely, is the
       relay's side: no queue, no keys, no trace. */
    existing.dissolved = true;
    existing.rev = Number(incoming.rev || 0);
    existing.updatedAt = new Date().toISOString();
    saveSpaces();
    appendHistory(existing.conversationId, {
      id: generateId('sys'),
      direction: 'in',
      type: 'system-note',
      text: t(`این گروه توسط سازنده منحل شد. گفتگو روی این دستگاه می‌ماند، اما پیام تازه‌ای رد و بدل نمی‌شود.`,
        'This group was dissolved by its owner. The conversation stays on this device, but nothing more can be sent.'),
      status: 'delivered',
      createdAt: new Date().toISOString(),
    });
    storeHistory({ immediate: true });
    purgeSpaceFromRelay(existing);
    renderPeers();
    renderActivePeer();
    renderMessages();
    renderSpaceInfoPanel();
    notify(t(`گروه «${existing.name}» منحل شد.`, `"${existing.name}" was dissolved.`), 'warning');
    return true;
  }

  const index = chatState.spaces.groups.indexOf(existing);
  chatState.spaces.groups.splice(index, 1);
  delete chatState.history[existing.conversationId];
  dropConversationMedia(existing.conversationId);
  saveSpaces();
  storeHistory({ immediate: true });
  if (chatState.activeConversationId === existing.conversationId) {
    chatState.activeConversationId = '';
    chatState.activePeerClientId = '';
    closeSpaceInfoPanel();
  }
  renderPeers();
  renderActivePeer();
  renderMessages();
  notify(t(`از گروه «${existing.name}» حذف شدید.`, `You were removed from "${existing.name}".`), 'warning');
  return true;
}

/* Everything this device asked the relay to hold on the group's behalf goes:
   the queue for its members and the session keys the group's traffic used.
   The relay never held the group itself - it only ever forwarded envelopes -
   so this is about leaving nothing addressed to a conversation that is over. */
function purgeSpaceFromRelay(space) {
  if (!space) return;
  const keys = new Set([
    ...(Array.isArray(space.members) ? space.members : []),
    space.ownerFingerprint,
    space.ownerPeerId,
  ].filter(Boolean));
  keys.forEach((key) => {
    const peer = findPeerByAnyKey(key);
    if (!peer || isSelfPeerRecord(peer)) return;
    /* Drops the session key both sides used for this conversation, so what is
       already queued elsewhere cannot be opened with it later. */
    delete chatState.sessionKeys[peer.peerId];
    delete chatState.sessionKeys[peer.fingerprint];
  });
  saveEncrypted(CHAT_SESSION_KEYS_STORAGE_KEY, chatState.sessionKeys);
  if (chatState.ws && chatState.ws.readyState === WebSocket.OPEN) {
    chatState.ws.send(JSON.stringify({ type: 'purge-space', conversationId: space.conversationId }));
  }
}
function directPeerFingerprintForBadge() {
  const peer = activePeer();
  return peer && !peer.type ? (peer.fingerprint || '') : '';
}
function activeGroupSpace() {
  const conversation = getActiveConversation();
  return conversation?.type === 'group' ? conversation : null;
}

async function renameActiveSpace() {
  const space = activeGroupSpace();
  if (!space) return;
  if (!canManageSpace(space)) {
    notify(t('فقط سازنده یا ادمین می‌تواند نام گروه را تغییر دهد.', 'Only the owner or an admin can rename the group.'), 'warning');
    return;
  }
  const next = await PoorijaDialogs.prompt(t('نام تازهٔ گروه:', 'New group name:'), space.name || '');
  const trimmed = String(next || '').trim().slice(0, 60);
  if (!trimmed || trimmed === space.name) return;
  const previous = space.name;
  commitSpaceEdit(space, { name: trimmed },
    t(`نام گروه از «${previous}» به «${trimmed}» تغییر کرد.`, `Group renamed from "${previous}" to "${trimmed}".`));
}

async function editActiveSpaceDescription() {
  const space = activeGroupSpace();
  if (!space) return;
  if (!canManageSpace(space)) {
    notify(t('فقط سازنده یا ادمین می‌تواند توضیحات را تغییر دهد.', 'Only the owner or an admin can edit the description.'), 'warning');
    return;
  }
  const next = await PoorijaDialogs.prompt(t('توضیحات گروه:', 'Group description:'), space.description || '');
  if (next === null) return;
  commitSpaceEdit(space, { description: String(next).trim().slice(0, 240) });
}

async function setActiveSpaceAvatar(file) {
  const space = activeGroupSpace();
  if (!space || !file) return;
  if (!canManageSpace(space)) {
    notify(t('فقط سازنده یا ادمین می‌تواند تصویر گروه را عوض کند.', 'Only the owner or an admin can change the group picture.'), 'warning');
    return;
  }
  if (!/^image\//i.test(file.type)) {
    notify(t('فقط تصویر پشتیبانی می‌شود.', 'Only images are supported.'), 'warning');
    return;
  }
  try {
    /* Shrink before storing: a group picture travels to every member inside
       the space record, so a 4 MB photo would be re-sent on every edit. */
    const bitmap = await createImageBitmap(file);
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    canvas.getContext('2d').drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    bitmap.close?.();
    commitSpaceEdit(space, { avatarData: canvas.toDataURL('image/webp', 0.86) });
    notify(t('تصویر گروه به‌روزرسانی شد.', 'Group picture updated.'), 'success');
  } catch (error) {
    console.error('[Group] avatar failed', error);
    notify(t('تغییر تصویر گروه ناموفق بود.', 'Changing the group picture failed.'), 'error');
  }
}

function spaceMemberRecords(space) {
  /* normalizeSpaceMembers strips the local user, which is exactly right for a
     delivery list and exactly wrong for a roster — it is why the owner could
     not see themselves or their own crown. Build the roster from the raw keys
     and put the local user in explicitly. */
  const keys = Array.from(new Set([
    ...(Array.isArray(space?.members) ? space.members : []),
    space?.ownerPeerId, space?.ownerClientId, space?.ownerFingerprint,
  ].map((key) => String(key || '').trim()).filter(Boolean)));
  const seen = new Set();
  const rows = [];
  const myKeys = localMembershipKeys();
  /* One row for me, from whichever of my keys the group actually knows. */
  const myKeyInSpace = keys.find((key) => myKeys.has(key)) || chatState.identity?.fingerprint || chatState.peerId || '';
  if (myKeyInSpace) {
    seen.add(myKeyInSpace);
    myKeys.forEach((key) => seen.add(key));
    rows.push({
      key: myKeyInSpace,
      name: chatState.profile.name || t('شما', 'You'),
      /* Roster avatars travel inside space records from people this device
         has never verified; sanitizeAvatarData is the gate that admits only
         raster data: URLs, so nothing else ever reaches an src attribute. */
      avatarData: sanitizeAvatarData(chatState.profile.avatarData),
      online: true,
      isSelf: true,
      role: localSpaceRole(space),
    });
  }
  keys.forEach((memberKey) => {
    if (myKeys.has(memberKey)) return;
    const peer = findPeerByAnyKey(memberKey);
    const identity = peer?.fingerprint || peer?.peerId || memberKey;
    if (seen.has(identity) || seen.has(memberKey)) return;
    seen.add(identity);
    seen.add(memberKey);
    rows.push({
      key: memberKey,
      name: peer?.username || peer?.name || memberKey.slice(0, 12),
      avatarData: sanitizeAvatarData(peer?.avatarData || ''),
      online: peer?.status === 'online',
      isSelf: false,
      role: spaceRoleOf(space, memberKey),
    });
  });
  const rank = { owner: 0, admin: 1, member: 2 };
  return rows.sort((a, b) => (rank[a.role] - rank[b.role]) || a.name.localeCompare(b.name));
}

function addMembersToActiveSpace(keys) {
  const space = activeGroupSpace();
  if (!space || !keys.length) return;
  if (!canManageSpace(space)) {
    notify(t('فقط سازنده یا ادمین می‌تواند عضو اضافه کند.', 'Only the owner or an admin can add members.'), 'warning');
    return;
  }
  const members = normalizeSpaceMembers([...(space.members || []), ...keys]);
  const names = keys.map((key) => findPeerByAnyKey(key)?.username || key.slice(0, 10)).join('، ');
  commitSpaceEdit(space, { members },
    t(`${names} به گروه اضافه شد.`, `${names} joined the group.`));
  /* The new member has no copy of the group at all, so push the record to them
     directly rather than waiting for the next presence sweep. */
  keys.forEach((key) => {
    const peer = findPeerByAnyKey(key);
    if (peer) sendRelayEnvelope(peer, { type: 'space-sync', space, createdAt: new Date().toISOString() });
  });
}

async function removeMemberFromActiveSpace(memberKey) {
  const space = activeGroupSpace();
  if (!space) return;
  if (!canManageSpace(space)) {
    notify(t('فقط سازنده یا ادمین می‌تواند عضو حذف کند.', 'Only the owner or an admin can remove members.'), 'warning');
    return;
  }
  if (spaceRoleOf(space, memberKey) === 'owner') {
    notify(t('سازندهٔ گروه را نمی‌توان حذف کرد.', 'The group owner cannot be removed.'), 'warning');
    return;
  }
  const name = findPeerByAnyKey(memberKey)?.username || memberKey.slice(0, 10);
  if (!await PoorijaDialogs.confirm(t(`«${name}» از گروه حذف شود؟`, `Remove "${name}" from the group?`))) return;
  const members = (space.members || []).filter((key) => key !== memberKey);
  const admins = (space.admins || []).filter((key) => key !== memberKey);
  const removed = normalizeSpaceMembers([...(space.removed || []), memberKey]);
  commitSpaceEdit(space, { members, admins, removed },
    t(`«${name}» از گروه حذف شد.`, `"${name}" was removed from the group.`));
  /* Tell the person themselves, or their copy stays and keeps showing the
     group as if nothing happened. */
  const peer = findPeerByAnyKey(memberKey);
  if (peer) {
    sendRelayEnvelope(peer, {
      type: 'space-sync',
      space: { ...space, members, admins, removed },
      createdAt: new Date().toISOString(),
    });
  }
}

function toggleSpaceAdmin(memberKey) {
  const space = activeGroupSpace();
  if (!space) return;
  if (localSpaceRole(space) !== 'owner') {
    notify(t('فقط سازندهٔ گروه می‌تواند ادمین تعیین کند.', 'Only the group owner can assign admins.'), 'warning');
    return;
  }
  const admins = Array.isArray(space.admins) ? space.admins.slice() : [];
  const at = admins.indexOf(memberKey);
  const name = findPeerByAnyKey(memberKey)?.username || memberKey.slice(0, 10);
  if (at >= 0) admins.splice(at, 1);
  else admins.push(memberKey);
  commitSpaceEdit(space, { admins },
    at >= 0 ? t(`«${name}» دیگر ادمین نیست.`, `"${name}" is no longer an admin.`)
            : t(`«${name}» ادمین شد.`, `"${name}" is now an admin.`));
}

async function leaveActiveSpace() {
  const space = activeGroupSpace();
  if (!space) return;
  const owner = localSpaceRole(space) === 'owner';
  const question = owner
    ? t('شما سازندهٔ این گروه هستید. با ترک گروه، گروه از دستگاه شما حذف می‌شود. ادامه می‌دهید؟',
        'You created this group. Leaving removes it from this device. Continue?')
    : t('از این گروه خارج می‌شوید؟', 'Leave this group?');
  if (!await PoorijaDialogs.confirm(question)) return;
  const myKeys = [...localMembershipKeys()];
  const members = (space.members || []).filter((key) => !myKeys.includes(key));
  const admins = (space.admins || []).filter((key) => !myKeys.includes(key));
  const name = chatState.profile.name || t('یک عضو', 'A member');
  /* Announce the departure before deleting the local copy, or nobody hears. */
  const farewell = { ...space, members, admins, rev: Number(space.rev || 0) + 1 };
  broadcastSpaceRecord(farewell);
  /* groupDeliveryMemberKeys, not `members`: the owner is stored in the owner
     fields rather than the member list, so a farewell addressed to `members`
     reached everyone except the one person who always needs to know. */
  groupDeliveryMemberKeys(space).forEach((key) => {
    const peer = findPeerByAnyKey(key);
    if (!peer) return;
    relaySessionEvent(peer, {
      type: 'space-note',
      spaceId: space.conversationId,
      text: t(`${name} گروه را ترک کرد.`, `${name} left the group.`),
      createdAt: new Date().toISOString(),
    });
  });
  /* Leaving is about this device: the group carries on without you, so your
     copy goes. That is the opposite of dissolving, where the group ends and
     the conversation stays. */
  const index = chatState.spaces.groups.findIndex((item) => item.conversationId === space.conversationId);
  if (index >= 0) chatState.spaces.groups.splice(index, 1);
  delete chatState.history[space.conversationId];
  dropConversationMedia(space.conversationId);
  saveSpaces();
  storeHistory({ immediate: true });
  chatState.activeConversationId = '';
  chatState.activePeerClientId = '';
  closeSpaceInfoPanel();
  renderPeers();
  renderActivePeer();
  renderMessages();
  notify(t('از گروه خارج شدید.', 'You left the group.'), 'success');
}

/* ---------------- the info panel ----------------------------------- */
function openSpaceInfoPanel() {
  portalToBody('chatSpaceInfo');
  const space = activeGroupSpace();
  if (!space) return;
  document.getElementById('chatSpaceInfo')?.classList.remove('hidden');
  renderSpaceInfoPanel();
}
function closeSpaceInfoPanel() {
  closePermsDialog();
  document.getElementById('chatSpaceInfo')?.classList.add('hidden');
}
/* The rules dialog. One dialog for both jobs: the group's own rules, and one
   member's exceptions to them. They were two different shapes before - a short
   inline list for the group, a long popover for a member - which is how the
   group list came to be missing eight of the twelve rules without anyone
   noticing. Portalled to the body because .chat-shell clips fixed children,
   which is what kept this out of sight on a desktop. */
let permsDialogFor = null;   /* null = the group itself, otherwise a member key */

function closePermsDialog() {
  permsDialogFor = null;
  document.getElementById('chatPermsDialog')?.remove();
}

function openPermsDialog(memberKey = null) {
  permsDialogFor = memberKey;
  renderPermsDialog();
}

function renderPermsDialog() {
  document.getElementById('chatPermsDialog')?.remove();
  if (permsDialogFor === undefined) return;
  const space = activeGroupSpace();
  if (!space || !canManageSpace(space)) return;
  const memberKey = permsDialogFor;
  const forMember = Boolean(memberKey);
  if (forMember && !spaceMemberRecords(space).some((row) => row.key === memberKey)) return;
  const who = forMember
    ? (spaceMemberRecords(space).find((row) => row.key === memberKey)?.name || '')
    : '';
  const groupRules = spacePermissions(space);
  const host = document.createElement('div');
  host.id = 'chatPermsDialog';
  host.className = 'chat-perms-dialog';
  host.innerHTML = `
    <div class="chat-perms-backdrop" data-perms-close></div>
    <section class="chat-perms-card" role="dialog" aria-modal="true" aria-labelledby="chatPermsTitle">
      <header class="chat-perms-head">
        <h4 id="chatPermsTitle">${app().escapeHTML(forMember
          ? t(`دسترسی ${who}`, `What ${who} may do`)
          : t('اجازه‌های اعضا', 'What members may do'))}</h4>
        <button type="button" data-perms-close aria-label="${app().escapeHTML(t('بستن', 'Close'))}"><i class="fas fa-xmark"></i></button>
      </header>
      <p class="chat-perms-note">${app().escapeHTML(forMember
        ? t('این تنظیم فقط برای همین عضو است و بر قاعدهٔ گروه می‌چربد. برای برگرداندن به قاعدهٔ گروه، «پیروی از گروه» را بزنید.',
            'This applies to this one member and overrides the group rule. "Follow the group" puts them back on it.')
        : t('این قاعده برای همهٔ اعضای عادی است. سازنده و ادمین‌ها همیشه همه‌کار می‌توانند بکنند.',
            'These apply to every ordinary member. The owner and admins may always do everything.'))}</p>
      <div class="chat-perms-list">
        ${SPACE_PERMISSIONS.map((key) => {
          const on = forMember
            ? permissionsForMember(space, memberKey)[key] !== false
            : groupRules[key] !== false;
          const overridden = forMember && memberOverrides(space, memberKey)[key] !== undefined;
          return `
            <label class="chat-perms-row ${overridden ? 'is-override' : ''}">
              <input type="checkbox" ${on ? 'checked' : ''}
                ${forMember
                  ? `data-space-member-perm="${app().escapeHTML(memberKey)}" data-perm="${key}"`
                  : `data-space-perm="${key}"`}>
              <span>${app().escapeHTML(t(...(SPACE_PERMISSION_LABELS[key] || [key, key])))}</span>
              ${overridden ? `<em>${app().escapeHTML(t('فقط برای این عضو', 'this member only'))}</em>` : ''}
            </label>`;
        }).join('')}
      </div>
      <div class="chat-perms-foot">
        ${forMember ? `<button type="button" class="chat-soft-btn" data-perms-reset="${app().escapeHTML(memberKey)}"><i class="fas fa-rotate-left"></i> ${app().escapeHTML(t('پیروی از گروه', 'Follow the group'))}</button>` : ''}
        <button type="button" class="chat-soft-btn" data-perms-close>${app().escapeHTML(t('بستن', 'Close'))}</button>
      </div>
    </section>`;
  document.body.appendChild(host);
}

function renderSpaceInfoPanel() {
  const panel = document.getElementById('chatSpaceInfo');
  if (!panel || panel.classList.contains('hidden')) return;
  const space = activeGroupSpace();
  if (!space) {
    closeSpaceInfoPanel();
    return;
  }
  const members = spaceMemberRecords(space);
  const manage = canManageSpace(space);
  const owner = localSpaceRole(space) === 'owner';
  const roleLabel = (role) => ({
    owner: t('سازنده', 'Owner'),
    admin: t('ادمین', 'Admin'),
    member: t('عضو', 'Member'),
  }[role]);
  const groupRules = spacePermissions(space);
  const allowedCount = SPACE_PERMISSIONS.filter((key) => groupRules[key] !== false).length;
  /* The group picture is a member's edit that reached this record over the
     wire, so it gets the same gate every remote avatar gets before it is
     drawn into an src. */
  const spaceAvatarSrc = sanitizeAvatarData(space.avatarData);
  panel.innerHTML = `
    <div class="chat-space-info-backdrop" data-space-info-close></div>
    <section class="chat-space-info-card" role="dialog" aria-modal="true">
      <header class="chat-space-info-head">
        <button type="button" class="chat-space-avatar ${manage ? 'is-editable' : ''}" ${manage ? 'data-space-avatar' : 'disabled'}>
          ${spaceAvatarSrc ? `<img src="${spaceAvatarSrc}" alt="">` : `<span>${app().escapeHTML(initials(space.name || 'G'))}</span>`}
          ${manage ? '<span class="chat-space-avatar-edit"><i class="fas fa-camera"></i></span>' : ''}
        </button>
        <div class="chat-space-info-title">
          <h4>${app().escapeHTML(space.name || '')}</h4>
          <p>${members.length} ${app().escapeHTML(t('عضو', members.length === 1 ? 'member' : 'members'))}</p>
        </div>
        <button type="button" class="chat-space-info-close" data-space-info-close aria-label="${app().escapeHTML(t('بستن', 'Close'))}"><i class="fas fa-xmark"></i></button>
      </header>

      <div class="chat-space-info-body">
        <div class="chat-space-desc ${manage ? 'is-editable' : ''}" ${manage ? 'data-space-desc' : ''}>
          <span class="chat-space-desc-label">${app().escapeHTML(t('توضیحات', 'Description'))}</span>
          <p>${space.description ? app().escapeHTML(space.description) : `<em>${app().escapeHTML(t('بدون توضیح', 'No description'))}</em>`}</p>
          ${manage ? '<i class="fas fa-pen"></i>' : ''}
        </div>

        ${manage ? `
        <div class="chat-space-actions">
          <button type="button" data-space-rename class="chat-soft-btn"><i class="fas fa-pen-to-square"></i> ${app().escapeHTML(t('تغییر نام', 'Rename'))}</button>
          <button type="button" data-space-add class="chat-soft-btn"><i class="fas fa-user-plus"></i> ${app().escapeHTML(t('افزودن عضو', 'Add members'))}</button>
          <button type="button" data-space-invite class="chat-soft-btn"><i class="fas fa-link"></i> ${app().escapeHTML(t('کد دعوت', 'Invite code'))}</button>
        </div>` : ''}

        ${owner ? `
        <button type="button" class="chat-space-perms-open" data-space-perms-open>
          <i class="fas fa-sliders"></i>
          <span>${app().escapeHTML(t('اجازه‌های اعضا', 'What members may do'))}</span>
          <em>${allowedCount} ${app().escapeHTML(t(`از ${SPACE_PERMISSIONS.length}`, `of ${SPACE_PERMISSIONS.length}`))}</em>
        </button>` : ''}

        <div id="chatSpaceInviteBox" class="chat-space-invite hidden"></div>

        <div id="chatSpaceAddPicker" class="chat-space-add-picker hidden"></div>

        <div class="chat-space-member-head">
          <span>${app().escapeHTML(t('اعضا', 'Members'))}</span>
          <span>${members.filter((row) => row.online).length} ${app().escapeHTML(t('آنلاین', 'online'))}</span>
        </div>
        <div class="chat-space-member-list">
          ${members.map((row) => `
            <div class="chat-space-member ${row.online ? 'is-online' : ''}">
              <span class="chat-space-member-avatar" title="${app().escapeHTML(row.online ? t('آنلاین', 'Online') : t('آفلاین', 'Offline'))}">${row.avatarData ? `<img src="${sanitizeAvatarData(row.avatarData)}" alt="">` : app().escapeHTML(initials(row.name))}</span>
              <span class="chat-space-member-body">
                <span class="chat-space-member-name">${app().escapeHTML(row.name)}${row.isSelf ? ` <em>(${app().escapeHTML(t('شما', 'you'))})</em>` : ''}</span>
                <span class="chat-space-member-role role-${row.role}">${app().escapeHTML(roleLabel(row.role))}</span>
              </span>
              ${(!row.isSelf && manage) ? `
                <span class="chat-space-member-actions">
                  ${row.role === 'member' ? `<button type="button" data-space-member-perms="${app().escapeHTML(row.key)}" title="${app().escapeHTML(t('دسترسی این عضو', 'What this member may do'))}"><i class="fas fa-sliders"></i></button>` : ''}
                  ${owner && row.role !== 'owner' ? `<button type="button" data-space-admin="${app().escapeHTML(row.key)}" title="${app().escapeHTML(row.role === 'admin' ? t('حذف ادمین', 'Demote') : t('ادمین کن', 'Make admin'))}"><i class="fas ${row.role === 'admin' ? 'fa-user-minus' : 'fa-user-shield'}"></i></button>` : ''}
                  ${row.role !== 'owner' ? `<button type="button" class="is-danger" data-space-remove="${app().escapeHTML(row.key)}" title="${app().escapeHTML(t('حذف از گروه', 'Remove'))}"><i class="fas fa-xmark"></i></button>` : ''}
                </span>` : ''}
            </div>`).join('')}
        </div>
      </div>

      <div class="chat-space-info-foot">
        <button type="button" data-space-leave class="chat-space-leave"><i class="fas fa-right-from-bracket"></i> ${app().escapeHTML(t('خروج از گروه', 'Leave group'))}</button>
        ${owner ? `<button type="button" data-space-nuke class="chat-space-leave is-nuke"><i class="fas fa-trash"></i> ${app().escapeHTML(t('انحلال گروه برای همه', 'Dissolve for everyone'))}</button>` : ''}
        ${(!owner && localSpaceRole(space) === 'admin') ? `<button type="button" data-space-ask-nuke class="chat-space-leave"><i class="fas fa-hand"></i> ${app().escapeHTML(t('درخواست انحلال از سازنده', 'Ask the owner to dissolve'))}</button>` : ''}
      </div>
    </section>`;
}

function renderSpaceAddPicker() {
  const target = document.getElementById('chatSpaceAddPicker');
  const space = activeGroupSpace();
  if (!target || !space) return;
  const already = new Set(spaceMemberRecords(space).map((row) => row.key));
  const candidates = allConversationRecords()
    .filter((record) => !record.type && !isSelfPeerRecord(record))
    .filter((record) => ![record.peerId, record.clientId, record.fingerprint].some((key) => key && already.has(key)))
    .filter((record) => !already.has(getConversationKey(record)));
  target.classList.remove('hidden');
  if (!candidates.length) {
    target.innerHTML = `<p class="chat-space-add-empty">${app().escapeHTML(t('همهٔ مخاطبین شما از قبل عضو این گروه هستند.', 'Every one of your contacts is already in this group.'))}</p>`;
    return;
  }
  target.innerHTML = `
    ${candidates.map((record) => `
      <label class="chat-space-add-row">
        <input type="checkbox" value="${app().escapeHTML(getConversationKey(record))}">
        <span>${app().escapeHTML(record.username || record.name || record.peerId)}</span>
      </label>`).join('')}
    <button type="button" data-space-add-confirm class="chat-space-add-confirm">${app().escapeHTML(t('افزودن', 'Add'))}</button>`;
}
