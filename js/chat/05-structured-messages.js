/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 5 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Structured messages — polls, location, contact cards
*/

/* =====================================================================
   Structured messages — polls, location, contact cards
   ---------------------------------------------------------------------
   One wire type carries all three. `rich` is an ordinary encrypted
   message whose plaintext is JSON with a `kind` field, so it inherits
   the session key, the delivery receipts, the offline relay envelope and
   the self-destruct timer without any of that being reimplemented three
   times. Votes travel the same way rather than as plaintext session
   events: a ballot is content, not metadata, and the relay must not be
   able to read it when the peer is offline.
   ===================================================================== */
const RICH_KINDS = new Set(['poll', 'location', 'contact']);
const POLL_MAX_OPTIONS = 10;
const POLL_MIN_OPTIONS = 2;

function richPayloadOf(entry) {
  if (!entry?.rich) return null;
  return typeof entry.rich === 'string' ? safeJsonParse(entry.rich) : entry.rich;
}
function safeJsonParse(text) {
  try { return JSON.parse(text); } catch (_error) { return null; }
}

/* Sends one structured message down the same path a text message takes. */
async function sendRichMessage(kind, data) {
  if (!RICH_KINDS.has(kind)) return;
  if (!guardGroupSend('sendMessages')) return;
  const conversation = getActiveConversation();
  const peer = activePeer();
  if (!conversation) {
    notify(t('اول یک گفتگو را باز کنید.', 'Open a conversation first.'), 'warning');
    return;
  }
  const messageId = generateId(kind);
  const createdAt = new Date().toISOString();
  const timerSeconds = Number(chatState.timerSeconds || 0);
  const rich = { kind, ...data, id: messageId };
  const entry = {
    id: messageId,
    direction: 'out',
    type: 'rich',
    rich,
    status: 'queued',
    createdAt,
    expiresAt: '',
    timerSeconds,
    senderName: chatState.profile.name || t('شما', 'You'),
    senderPeerId: chatState.peerId || '',
    senderFingerprint: chatState.identity?.fingerprint || '',
  };

  if (conversation.type === 'group') {
    const members = groupDeliveryMemberKeys(conversation);
/* groupDeliveryMemberKeys resolves every member to whatever key the peer is
   reachable by right now — usually a peerId, which changes between sessions.
   Writing that back into space.members replaced the stable fingerprint roster
   the group was created with, so after the first message the member list was
   full of volatile ids: removals matched nothing and a reconnected peer looked
   like a stranger. The delivery list is derived; it must not be persisted. */
    /* No write-back. groupDeliveryMemberKeys resolves each member to whatever key
       they are reachable by right now — usually a peerId, which changes between
       sessions. Persisting that replaced the stable fingerprint roster the group
       was created with, so removals matched nothing and a reconnected peer looked
       like a stranger. The delivery list is derived; it stays derived. */

    appendHistory(conversation.conversationId, entry);
    let delivered = 0;
    for (const memberId of members) {
      const member = findPeerByAnyKey(memberId);
      if (!member || isSelfPeerRecord(member)) continue;
      let memberSession = await ensureStoredSession(member);
      if (!memberSession?.cryptoKey) {
        /* `member.status === 'online'` used to guard this, so an offline
           member was skipped entirely and no copy was ever queued for them —
           they came back to a group conversation with holes in it.
           ensureDirectSession now mints an offline key when the member is
           away, and the envelope carries it sealed. */
        memberSession = await ensureDirectSession(member, { silent: true });
      }
      if (!memberSession?.cryptoKey) continue;
      const payload = await encryptForSession(memberSession, new TextEncoder().encode(JSON.stringify(rich)));
      const outbound = {
        type: 'rich', id: messageId, createdAt, timerSeconds, payload,
        spaceId: conversation.conversationId, spaceType: 'group', spaceName: conversation.name,
        /* The stored roster, not the derived delivery list. Shipping delivery keys
           here let peer ids leak into everyone's member list via upsertSharedSpace,
           which then merged them back to the owner — so a removed member reappeared
           under a second identity and could never be taken out. */
        members: normalizeSpaceMembers(conversation.members), senderName: entry.senderName, senderPeerId: entry.senderPeerId,
        senderFingerprint: entry.senderFingerprint,
      };
      if (memberSession.connection?.open) {
        if (safeConnectionSend(memberSession.connection, outbound, 'rich')) delivered += 1;
      } else if (await sendSealedRelay(member, memberSession, outbound, { createdAt, scope: 'group' })) {
        delivered += 1;
      }
    }
    markMessageStatus(conversation.conversationId, messageId, delivered ? 'sent' : 'queued');
    renderMessages();
    return;
  }

  if (!peer || isSelfPeerRecord(peer)) return;
  appendHistory(getConversationKey(peer), entry);
  let session = activeSession();
  if (!session?.cryptoKey) session = await ensureDirectSession(peer);
  if (!session?.cryptoKey) {
    markMessageStatus(getConversationKey(peer), messageId, 'failed');
    notify(t('سشن امن هنوز آماده نیست.', 'The secure session is not ready yet.'), 'warning');
    return;
  }
  const body = JSON.stringify(rich);
  /* Refuse loudly rather than hand the data channel something it will drop in
     silence. Everything that can legitimately be this big goes down the
     chunked file path instead. */
  if (body.length > RICH_MESSAGE_MAX_BYTES) {
    markMessageStatus(getConversationKey(peer), messageId, 'failed');
    notify(t('این پیام برای ارسال بیش از حد بزرگ است.', 'That message is too large to send.'), 'warning');
    renderMessages();
    return;
  }
  const payload = await encryptForSession(session, new TextEncoder().encode(body));
  const outbound = { type: 'rich', id: messageId, createdAt, timerSeconds, payload };
  const conversationKey = getConversationKey(peer);
  if (session.connection?.open) {
    /* safeConnectionSend returns false when the channel throws. Marking "sent"
       regardless is what made a failed card look delivered and then sit there. */
    const ok = safeConnectionSend(session.connection, outbound, 'rich');
    if (ok) {
      markMessageStatus(conversationKey, messageId, 'sent');
    } else {
      const relayed = await sendSealedRelay(peer, session, outbound, { createdAt });
      markMessageStatus(conversationKey, messageId, relayed ? 'queued' : 'failed');
      if (!relayed) notify(t('ارسال ناموفق بود.', 'Sending failed.'), 'warning');
    }
  } else {
    const relayed = await sendSealedRelay(peer, session, outbound, { createdAt });
    markMessageStatus(conversationKey, messageId, relayed ? 'queued' : 'failed');
    if (!relayed) notify(t('ارسال ناموفق بود.', 'Sending failed.'), 'warning');
  }
  renderMessages();
}

/* ---------------- polls ------------------------------------------- */
function pollVoterId() {
  return chatState.identity?.fingerprint || chatState.peerId || 'self';
}
function normalizePollVotes(rich) {
  if (!rich.votes || typeof rich.votes !== 'object') rich.votes = {};
  return rich.votes;
}
function pollTally(rich) {
  const votes = normalizePollVotes(rich);
  const counts = new Array(rich.options.length).fill(0);
  let voters = 0;
  Object.values(votes).forEach((choices) => {
    const list = Array.isArray(choices) ? choices : [choices];
    if (!list.length) return;
    voters += 1;
    list.forEach((index) => {
      if (Number.isInteger(index) && index >= 0 && index < counts.length) counts[index] += 1;
    });
  });
  return { counts, voters };
}

async function castPollVote(entryId, optionIndex) {
  const conversationId = chatState.activeConversationId;
  const entry = (chatState.history[conversationId] || []).find((item) => item.id === entryId);
  const rich = richPayloadOf(entry);
  if (!rich || rich.kind !== 'poll') return;
  if (rich.closed) return;
  const votes = normalizePollVotes(rich);
  const me = pollVoterId();
  const current = Array.isArray(votes[me]) ? votes[me].slice() : [];
  if (rich.multi) {
    const at = current.indexOf(optionIndex);
    if (at >= 0) current.splice(at, 1);
    else current.push(optionIndex);
    votes[me] = current;
  } else {
    /* Single-choice: tapping the option you already picked clears it, which is
       what every poll UI does and saves an explicit "retract" control. */
    votes[me] = current.length === 1 && current[0] === optionIndex ? [] : [optionIndex];
  }
  entry.rich = rich;
  storeHistory();
  renderMessages();
  /* Tell the other side. Everyone keeps their own tally from the votes they
     have seen, so a missed vote self-heals the next time one arrives. */
  const target = activePeer();
  if (!target) return;
  const session = chatState.sessions.get(target.peerId);
  if (!session?.cryptoKey) return;
  const body = { kind: 'poll-vote', pollId: entryId, voter: me, choices: votes[me] };
  const payload = await encryptForSession(session, new TextEncoder().encode(JSON.stringify(body)));
  const outbound = { type: 'rich', id: generateId('vote'), createdAt: new Date().toISOString(), payload };
  if (session.connection?.open) safeConnectionSend(session.connection, outbound, 'poll-vote');
  else await sendSealedRelay(target, session, outbound, { createdAt: outbound.createdAt });
}

function applyIncomingVote(conversationId, body) {
  const entry = (chatState.history[conversationId] || []).find((item) => item.id === body.pollId);
  const rich = richPayloadOf(entry);
  if (!rich || rich.kind !== 'poll') return false;
  const votes = normalizePollVotes(rich);
  votes[body.voter] = Array.isArray(body.choices) ? body.choices : [];
  entry.rich = rich;
  storeHistory();
  renderMessages();
  return true;
}

function togglePollClosed(entryId) {
  const conversationId = chatState.activeConversationId;
  const entry = (chatState.history[conversationId] || []).find((item) => item.id === entryId);
  const rich = richPayloadOf(entry);
  if (!rich || rich.kind !== 'poll' || entry.direction !== 'out') return;
  rich.closed = !rich.closed;
  entry.rich = rich;
  storeHistory();
  renderMessages();
}

/* ---------------- location ----------------------------------------- */
/* No map tiles are fetched. A tile request would tell a third party where the
   user is at the moment they share it, which is exactly the thing being
   protected. The card draws its own marker and offers links the user has to
   click, so leaving the app is always a deliberate act. */
function shareCurrentLocation() {
  if (!navigator.geolocation) {
    notify(t('این دستگاه موقعیت‌یابی ندارد.', 'This device has no geolocation.'), 'warning');
    return;
  }
  notify(t('در حال گرفتن موقعیت…', 'Getting your location…'), 'info');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      sendRichMessage('location', {
        lat: Number(latitude.toFixed(6)),
        lng: Number(longitude.toFixed(6)),
        accuracy: Math.round(accuracy || 0),
        at: new Date().toISOString(),
      }).catch((error) => {
        console.error('[Location] send failed', error);
        notify(t('ارسال موقعیت ناموفق بود.', 'Sending the location failed.'), 'error');
      });
    },
    (error) => {
      const reason = error.code === error.PERMISSION_DENIED
        ? t('اجازهٔ دسترسی به موقعیت داده نشد.', 'Location permission was denied.')
        : t('موقعیت در دسترس نیست.', 'Location is unavailable.');
      notify(reason, 'warning');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
}

/* ---------------- contact cards ------------------------------------ */
/* A profile avatar can be a five-megabyte data URL. A contact card carrying
   one becomes a single multi-megabyte message on a data channel that expects
   kilobytes: it neither arrives nor errors, it just sits at "queued". A card
   needs a thumbnail, so make one. */
const CONTACT_CARD_AVATAR_PX = 96;
const RICH_MESSAGE_MAX_BYTES = 40 * 1024;

async function thumbnailDataUrl(dataUrl, size = CONTACT_CARD_AVATAR_PX) {
  if (!dataUrl || typeof createImageBitmap !== 'function') return '';
  try {
    const blob = await (await fetch(dataUrl)).blob();
    if (blob.size <= 12 * 1024) return dataUrl;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    canvas.getContext('2d').drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    bitmap.close?.();
    return canvas.toDataURL('image/webp', 0.8);
  } catch (_error) {
    return '';
  }
}

function shareableContacts() {
  const activeKey = getConversationKey(getActiveConversation());
  return allConversationRecords()
    .filter((record) => !record.type && !isSelfPeerRecord(record) && record.fingerprint)
    .filter((record) => getConversationKey(record) !== activeKey)
    .map((record) => ({
      key: getConversationKey(record),
      name: record.username || record.name || record.peerId,
      fingerprint: record.fingerprint,
      peerId: record.peerId,
      publicKeyData: record.publicKeyData || '',
      avatarData: record.avatarData || '',
    }));
}

async function openConversationWithFingerprint(fingerprint) {
  const record = chatState.peers.find((peer) => peer.fingerprint === fingerprint);
  if (!record) return false;
  chatState.activePeerClientId = record.clientId || '';
  chatState.activeConversationId = getConversationKey(record);
  setChatView('chats');
  renderPeers();
  renderActivePeer();
  renderMessages();
  return true;
}

async function adoptSharedContact(entryId, { openChat = false } = {}) {
  const conversationId = chatState.activeConversationId;
  const entry = (chatState.history[conversationId] || []).find((item) => item.id === entryId);
  const rich = richPayloadOf(entry);
  if (!rich || rich.kind !== 'contact') return;
  if (!rich.fingerprint || !rich.publicKeyData) {
    notify(t('این کارت کلید عمومی ندارد و قابل افزودن نیست.', 'This card carries no public key, so it cannot be added.'), 'warning');
    return;
  }
  if (rich.fingerprint === chatState.identity?.fingerprint) {
    notify(t('این کارت خود شماست.', 'That card is you.'), 'info');
    return;
  }
  const existing = chatState.peers.find((peer) => peer.fingerprint === rich.fingerprint);
  if (existing) {
    if (openChat) {
      await openConversationWithFingerprint(rich.fingerprint);
      return;
    }
    notify(t('این مخاطب از قبل در لیست شماست.', 'That contact is already in your list.'), 'info');
    return;
  }
  chatState.peers.push(normalizePeerRecord({
    peerId: rich.peerId,
    clientId: '',
    username: rich.name,
    fingerprint: rich.fingerprint,
    publicKeyData: rich.publicKeyData,
    avatarData: rich.avatarData || '',
    status: 'offline',
    /* Same flag "Start chat" sets. Without it shouldShowConversation hides a
       contact that has no history and no key yet, so tapping Add would look
       like it did nothing at all. */
    manual: true,
  }));
  saveContacts();
  renderPeers();
  renderMessages();
  notify(t(`«${rich.name}» به مخاطبین اضافه شد.`, `"${rich.name}" was added to your contacts.`), 'success');
  if (openChat) await openConversationWithFingerprint(rich.fingerprint);
}
