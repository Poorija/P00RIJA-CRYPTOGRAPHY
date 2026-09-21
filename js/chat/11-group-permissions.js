/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 11 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   /* What a member of a group may do. The first four are the group's own
*/

/* =====================================================================
   Bringing groups up to what people expect from Telegram
   ---------------------------------------------------------------------
   Audited against Telegram's group feature set. Already present: create,
   rename, photo, description, roles, add, remove, promote, leave, service
   messages, replies, reactions, pins, media of every kind, polls,
   location, contact cards, forwarding, mute, per-group search.

   Missing, and added here:
     - mentions, with an autocomplete and a highlight for the person named
     - permissions: who may write, send media, add members, pin
     - an invite code, so joining does not require the owner to have your
       key already
     - delete the group for everyone, not just for yourself
     - the member count where you actually look for it, in the header
   ===================================================================== */

/* ---------------- permissions -------------------------------------- */
/* What a member of a group may do. The first four are the group's own
   defaults; every one of them can also be turned off for one person without
   changing the group, which is what "mute this member" actually means. */
/* One rule per thing the composer can actually do, so a group can close any of
   them - and so can be closed for one person without changing the group. The
   list follows the composer's own action sheet: if there is a button for it,
   there is a rule for it. */
const SPACE_PERMISSIONS = [
  'sendMessages', 'sendMedia', 'sendFiles', 'sendVoice', 'sendStickers',
  'sendPolls', 'sendLocation', 'sendContacts', 'sendHidden', 'sendTimed',
  'addMembers', 'pinMessages',
];
const SPACE_PERMISSION_LABELS = {
  sendMessages: ['ارسال پیام', 'Send messages'],
  sendMedia: ['عکس و ویدیو از گالری', 'Photos and video'],
  sendFiles: ['ارسال فایل', 'Send files'],
  sendVoice: ['پیام صوتی', 'Voice notes'],
  sendStickers: ['استیکر', 'Stickers'],
  sendPolls: ['نظرسنجی', 'Polls'],
  sendLocation: ['ارسال موقعیت', 'Share location'],
  sendContacts: ['کارت مخاطب', 'Contact cards'],
  sendHidden: ['پیام مخفی', 'Hidden messages'],
  sendTimed: ['پیام خودتخریب', 'Self-destructing messages'],
  addMembers: ['افزودن عضو', 'Add members'],
  pinMessages: ['سنجاق کردن', 'Pin messages'],
};
function spacePermissions(space) {
  const stored = space?.permissions && typeof space.permissions === 'object' ? space.permissions : {};
  /* Default open: a group that silences everyone the moment it is created
     would be a surprise, and Telegram defaults the same way. */
  return SPACE_PERMISSIONS.reduce((acc, key) => {
    acc[key] = stored[key] !== false;
    return acc;
  }, {});
}
/* One person's overrides, on top of the group's defaults. Stored by the same
   stable key the roster uses, so it survives a reconnect the way membership
   does. */
function memberOverrides(space, memberKey) {
  const all = space?.memberPermissions && typeof space.memberPermissions === 'object' ? space.memberPermissions : {};
  return all[memberKey] && typeof all[memberKey] === 'object' ? all[memberKey] : {};
}
/* What this particular member may do: the group's rule unless somebody has
   said otherwise about them specifically. */
function permissionsForMember(space, memberKey) {
  const base = spacePermissions(space);
  const mine = memberOverrides(space, memberKey);
  return SPACE_PERMISSIONS.reduce((acc, key) => {
    acc[key] = mine[key] === undefined ? base[key] : mine[key] !== false;
    return acc;
  }, {});
}
function localMemberOverrideKey(space) {
  const mine = localMembershipKeys();
  const all = space?.memberPermissions && typeof space.memberPermissions === 'object' ? space.memberPermissions : {};
  return Object.keys(all).find((key) => mine.has(key)) || '';
}
function memberMay(space, permission) {
  if (!space || space.type !== 'group') return true;
  if (canManageSpace(space)) return true;
  const key = localMemberOverrideKey(space);
  if (key) return permissionsForMember(space, key)[permission] !== false;
  return spacePermissions(space)[permission] !== false;
}
/* Turning one thing off for one person. Owner and admins only, and never for
   an admin or the owner - a rule you can apply to someone who can lift it is
   not a rule. */
function toggleMemberPermission(memberKey, permission) {
  const space = activeGroupSpace();
  if (!space || !SPACE_PERMISSIONS.includes(permission)) return;
  if (!canManageSpace(space)) {
    notify(t('فقط سازنده یا ادمین می‌تواند دسترسی عضو را عوض کند.', 'Only the owner or an admin can change a member\'s access.'), 'warning');
    return;
  }
  if (spaceRoleOf(space, memberKey) !== 'member') {
    notify(t('برای ادمین‌ها و سازنده محدودیت معنا ندارد.', 'Limits do not apply to admins or the owner.'), 'warning');
    return;
  }
  const current = permissionsForMember(space, memberKey);
  const next = { ...memberOverrides(space, memberKey), [permission]: !current[permission] };
  /* An override that matches the group's own rule is not an override. */
  const base = spacePermissions(space);
  SPACE_PERMISSIONS.forEach((key) => {
    if (next[key] === undefined) return;
    if ((next[key] !== false) === (base[key] !== false)) delete next[key];
  });
  const all = { ...(space.memberPermissions || {}) };
  if (Object.keys(next).length) all[memberKey] = next;
  else delete all[memberKey];
  const name = memberDisplayName(memberKey);
  const label = t(...(SPACE_PERMISSION_LABELS[permission] || [permission, permission]));
  commitSpaceEdit(space, { memberPermissions: all },
    current[permission]
      ? t(`«${label}» برای ${name} بسته شد.`, `"${label}" was closed for ${name}.`)
      : t(`«${label}» برای ${name} باز شد.`, `"${label}" was opened for ${name}.`));
}
/* Clearing a member's exceptions so they follow the group again. Deleting the
   whole entry rather than writing twelve matching values keeps "no override"
   and "an override that happens to agree" from becoming the same thing. */
function resetMemberPermissions(memberKey) {
  const space = activeGroupSpace();
  if (!space || !canManageSpace(space)) return;
  if (!Object.keys(memberOverrides(space, memberKey)).length) {
    notify(t('این عضو همین حالا از قاعدهٔ گروه پیروی می‌کند.', 'This member already follows the group rules.'), 'info');
    return;
  }
  const all = { ...(space.memberPermissions || {}) };
  delete all[memberKey];
  commitSpaceEdit(space, { memberPermissions: all },
    t(`${memberDisplayName(memberKey)} دوباره از قاعدهٔ گروه پیروی می‌کند.`,
      `${memberDisplayName(memberKey)} follows the group rules again.`));
}
function toggleSpacePermission(permission) {
  const space = activeGroupSpace();
  if (!space || localSpaceRole(space) !== 'owner') {
    notify(t('فقط سازندهٔ گروه می‌تواند دسترسی‌ها را عوض کند.', 'Only the group owner can change permissions.'), 'warning');
    return;
  }
  if (!SPACE_PERMISSIONS.includes(permission)) return;
  const current = spacePermissions(space);
  const next = { ...current, [permission]: !current[permission] };
  /* One label table, the same one the dialog reads. The four-entry map that
     used to be here left eight of the twelve rules announcing "undefined". */
  const label = t(...(SPACE_PERMISSION_LABELS[permission] || [permission, permission]));
  commitSpaceEdit(space, { permissions: next },
    next[permission]
      ? t(`«${label}» برای همهٔ اعضا باز شد.`, `"${label}" is now open to all members.`)
      : t(`«${label}» فقط برای ادمین‌ها شد.`, `"${label}" is now admins only.`));
}
/* One gate every send path asks before doing anything. */
function guardGroupSend(kind = 'sendMessages') {
  /* A locked thread is read-only, direct chat or group alike. The composer is
     taken off screen while locked, but every send path — text, file, voice,
     sticker, media — funnels through here too, so a racing re-render or a
     keyboard Enter can never slip a message into a locked conversation. */
  if (typeof activeConversationIsLocked === 'function' && activeConversationIsLocked()) {
    /* The toast borrows the locked thing's own name: "this conversation" over
       a group list reads like the wrong pane is talking. */
    const lockedIsGroup = Boolean(getActiveConversation()?.type === 'group');
    notify(t(lockedIsGroup
      ? 'این گروه قفل است؛ برای ارسال، اول آن را باز کنید.'
      : 'این گفتگو قفل است؛ برای ارسال، اول آن را باز کنید.',
      lockedIsGroup
      ? 'This group is locked; unlock it before sending.'
      : 'This conversation is locked; unlock it before sending.'), 'warning');
    return false;
  }
  const space = activeGroupSpace();
  if (!space) return true;
  /* A dissolved group is readable, not writable: the conversation stays so
     nobody loses what was said, but there is no longer a group to say anything
     to. Leaving the composer live would be a promise the app cannot keep. */
  if (space.dissolved) {
    notify(t('این گروه منحل شده است.', 'This group has been dissolved.'), 'warning');
    return false;
  }
  if (memberMay(space, kind)) return true;
  /* Say which thing is closed, and whether it is closed for the group or for
     this reader in particular - "only admins can post" is misleading when the
     group is open and one person is muted. */
  const label = t(...(SPACE_PERMISSION_LABELS[kind] || ['این کار', 'that']));
  const personal = Boolean(localMemberOverrideKey(space));
  notify(personal
    ? t(`«${label}» برای شما در این گروه بسته است.`, `"${label}" is closed for you in this group.`)
    : t(`در این گروه «${label}» فقط برای ادمین‌هاست.`, `"${label}" is admins only in this group.`), 'warning');
  return false;
}

/* ---------------- mentions ------------------------------------------ */
function mentionCandidates(prefix = '') {
  const space = activeGroupSpace();
  if (!space) return [];
  const needle = String(prefix || '').toLowerCase();
  return spaceMemberRecords(space)
    .filter((row) => !row.isSelf)
    .filter((row) => !needle || row.name.toLowerCase().includes(needle))
    .slice(0, 6);
}
function mentionTokenFor(name) {
  /* Spaces inside a name would break the token, so they collapse. The display
     name is kept intact in the highlight lookup. */
  return '@' + String(name || '').trim().replace(/\s+/g, '_');
}
function currentMentionQuery(composer) {
  const value = composer.value.slice(0, composer.selectionStart ?? composer.value.length);
  const match = value.match(/(?:^|\s)@([^\s@]{0,24})$/);
  return match ? { query: match[1], start: value.length - match[1].length - 1 } : null;
}
function renderMentionPicker() {
  const box = document.getElementById('chatMentionPicker');
  const composer = document.getElementById('chatComposer');
  if (!box || !composer) return;
  const space = activeGroupSpace();
  const state = space ? currentMentionQuery(composer) : null;
  if (!state) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const rows = mentionCandidates(state.query);
  if (!rows.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = rows.map((row, index) => `
    <button type="button" class="chat-mention-row ${index === 0 ? 'is-active' : ''}" data-mention-name="${app().escapeHTML(row.name)}">
      <span class="chat-mention-avatar">${row.avatarData ? `<img src="${row.avatarData}" alt="">` : app().escapeHTML(initials(row.name))}</span>
      <span class="chat-mention-name">${app().escapeHTML(row.name)}</span>
      <span class="chat-mention-role">${app().escapeHTML(row.role === 'owner' ? t('سازنده', 'owner') : (row.role === 'admin' ? t('ادمین', 'admin') : ''))}</span>
    </button>`).join('');
}
function applyMention(name) {
  const composer = document.getElementById('chatComposer');
  if (!composer) return;
  const state = currentMentionQuery(composer);
  if (!state) return;
  const before = composer.value.slice(0, state.start);
  const after = composer.value.slice(composer.selectionStart ?? composer.value.length);
  const token = mentionTokenFor(name) + ' ';
  composer.value = before + token + after;
  const caret = before.length + token.length;
  composer.setSelectionRange(caret, caret);
  composer.focus();
  document.getElementById('chatMentionPicker')?.classList.add('hidden');
  syncComposerHeight(composer);
}
/* Turns @tokens into highlighted spans, and marks the bubble when the token
   names the local user so the thread can be scanned at a glance. */
function decorateMentions(html, entry) {
  if (!html || !html.includes('@')) return html;
  const myToken = mentionTokenFor(chatState.profile.name || '').toLowerCase();
  return html.replace(/@([\p{L}\p{N}_]{1,32})/gu, (match) => {
    const mine = match.toLowerCase() === myToken;
    if (mine) entry.__mentionsMe = true;
    return `<span class="chat-mention ${mine ? 'is-me' : ''}">${match}</span>`;
  });
}
function messageMentionsLocalUser(entry) {
  const token = mentionTokenFor(chatState.profile.name || '').toLowerCase();
  if (!token || token === '@') return false;
  return String(entry?.text || '').toLowerCase().includes(token);
}

/* ---------------- invite codes -------------------------------------- */
/* A group invite has to carry enough for the other side to reconstruct the
   record and reach at least one member, so it is the space plus the inviter's
   own identity. It is a code the user passes along by hand, not a URL: there
   is no server that could resolve a link. */
function buildGroupInvite() {
  const space = activeGroupSpace();
  if (!space) return '';
  if (!memberMay(space, 'addMembers')) {
    notify(t('در این گروه فقط ادمین‌ها می‌توانند دعوت بسازند.', 'Only admins can create invites in this group.'), 'warning');
    return '';
  }
  const payload = {
    v: 1,
    conversationId: space.conversationId,
    name: space.name,
    description: space.description || '',
    avatarData: space.avatarData || '',
    ownerPeerId: space.ownerPeerId || '',
    ownerClientId: space.ownerClientId || '',
    ownerFingerprint: space.ownerFingerprint || '',
    members: normalizeSpaceMembers(space.members),
    admins: normalizeSpaceMembers(space.admins),
    permissions: spacePermissions(space),
    rev: Number(space.rev || 0),
    inviter: identityPayload(),
  };
  return 'poorija-group-v1:' + utf8_to_b64(JSON.stringify(payload));
}
async function redeemGroupInvite(code) {
  const text = String(code || '').trim();
  if (!text.startsWith('poorija-group-v1:')) {
    notify(t('این کد دعوت گروه معتبر نیست.', 'That is not a valid group invite code.'), 'warning');
    return false;
  }
  let payload;
  try {
    payload = JSON.parse(b64_to_utf8(text.slice('poorija-group-v1:'.length)));
  } catch (_error) {
    notify(t('کد دعوت خوانا نیست.', 'The invite code could not be read.'), 'warning');
    return false;
  }
  if (!payload?.conversationId) return false;
  /* Learn the inviter first: without their key there is nobody to sync with,
     and the group would sit there unable to send or receive anything. */
  if (payload.inviter?.fingerprint && payload.inviter.fingerprint !== chatState.identity?.fingerprint) {
    const known = chatState.peers.some((peer) => peer.fingerprint === payload.inviter.fingerprint);
    if (!known) {
      chatState.peers.push(normalizePeerRecord({
        peerId: payload.inviter.peerId || '',
        clientId: payload.inviter.clientId || '',
        username: payload.inviter.username || t('عضو گروه', 'Group member'),
        fingerprint: payload.inviter.fingerprint,
        publicKeyData: payload.inviter.publicKeyData || '',
        status: 'offline',
        manual: true,
      }));
      saveContacts();
    }
  }
  const myKey = chatState.identity?.fingerprint || chatState.peerId || '';
  /* Only the owner broadcasts rosters. A joiner bumping the rev and pushing
     the merged record ranked their copy of the member list — assembled from
     whatever the invite code happened to carry — above the owner's, so the
     owner's next deliberate edit looked older and was merged away instead of
     applied. The joiner keeps the local merge; the owner's sync corrects it. */
  const iAmOwner = Boolean(
    (payload.ownerPeerId && payload.ownerPeerId === chatState.peerId)
    || (payload.ownerFingerprint && payload.ownerFingerprint === chatState.identity?.fingerprint)
  );
  const space = upsertSharedSpace({
    type: 'group',
    conversationId: payload.conversationId,
    name: payload.name || t('گروه', 'Group'),
    description: payload.description || '',
    avatarData: payload.avatarData || '',
    ownerPeerId: payload.ownerPeerId || '',
    ownerClientId: payload.ownerClientId || '',
    ownerFingerprint: payload.ownerFingerprint || '',
    /* Raw, not normalised: normalizeSpaceMembers strips the local user, and
       upsertSharedSpace then sees a roster we are not in and refuses. */
    members: [...(payload.members || []), payload.inviter?.fingerprint, myKey].filter(Boolean),
    admins: payload.admins || [],
    permissions: payload.permissions || {},
    rev: Number(payload.rev || 0) + (iAmOwner ? 1 : 0),
    createdAt: new Date().toISOString(),
  });
  if (!space) {
    notify(t('پیوستن به گروه ناموفق بود.', 'Joining the group failed.'), 'error');
    return false;
  }
  /* Announce ourselves, or the existing members never learn we are here.
     The note is a sentence, not a roster: it cannot override anything. */
  if (iAmOwner) broadcastSpaceRecord(space);
  groupDeliveryMemberKeys(space).forEach((key) => {
    const peer = findPeerByAnyKey(key);
    if (!peer) return;
    relaySessionEvent(peer, {
      type: 'space-note',
      spaceId: space.conversationId,
      text: t(`${chatState.profile.name || 'یک عضو'} با کد دعوت به گروه پیوست.`,
        `${chatState.profile.name || 'Someone'} joined the group with an invite code.`),
      createdAt: new Date().toISOString(),
    });
  });
  chatState.activeConversationId = space.conversationId;
  chatState.activePeerClientId = '';
  setChatView('groups');
  renderPeers();
  renderActivePeer();
  renderMessages();
  notify(t(`به گروه «${space.name}» پیوستید.`, `You joined "${space.name}".`), 'success');
  return true;
}

/* ---------------- delete for everyone -------------------------------- */
async function deleteSpaceForEveryone() {
  const space = activeGroupSpace();
  if (!space) return;
  if (localSpaceRole(space) !== 'owner') {
    notify(t('فقط سازندهٔ گروه می‌تواند گروه را برای همه حذف کند.', 'Only the group owner can delete the group for everyone.'), 'warning');
    return;
  }
  if (!await PoorijaDialogs.confirm(t(
    `گروه «${space.name}» برای همهٔ اعضا حذف شود؟ این کار برگشت‌پذیر نیست.`,
    `Delete "${space.name}" for every member? This cannot be undone.`,
  ))) return;
  /* An empty member list at a higher revision is exactly what handleSpaceRemoval
     reads as "you are no longer in this group", so the same path that removes
     one person removes everyone. */
  const tombstone = { ...space, members: [], admins: [], rev: Number(space.rev || 0) + 1, deleted: true };
  groupDeliveryMemberKeys(space).forEach((key) => {
    const peer = findPeerByAnyKey(key);
    if (!peer) return;
    sendRelayEnvelope(peer, { type: 'space-sync', space: tombstone, createdAt: new Date().toISOString() });
  });
  /* The owner keeps their own copy too. Dissolving ends the group; it does not
     reach into anybody's device and take the conversation away, and that has to
     hold on this side as well, or the person who dissolved it would be the only
     one who loses their history. */
  space.dissolved = true;
  space.rev = Number(tombstone.rev || 0);
  space.updatedAt = new Date().toISOString();
  saveSpaces();
  appendHistory(space.conversationId, {
    id: generateId('sys'),
    direction: 'in',
    type: 'system-note',
    text: t('این گروه منحل شد. گفتگو روی این دستگاه می‌ماند، اما پیام تازه‌ای رد و بدل نمی‌شود.',
      'This group was dissolved. The conversation stays on this device, but nothing more can be sent.'),
    status: 'delivered',
    createdAt: new Date().toISOString(),
  });
  storeHistory({ immediate: true });
  purgeSpaceFromRelay(space);
  closeSpaceInfoPanel();
  renderPeers();
  renderActivePeer();
  renderMessages();
  notify(t('گروه منحل شد. گفتگو روی دستگاه‌ها می‌ماند.', 'The group was dissolved. The conversation stays on each device.'), 'success');
}
