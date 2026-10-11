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
   Member cards: every member of a group able to reach every other.
   ============================================================================

   A group has no server; a group message is one sealed send per member. To
   seal to a member a device needs that member's public key, and to deliver it
   across relays it needs their home relay. The roster carried neither — only
   the members' fingerprints — and on one relay that went unnoticed, because
   the relay's presence list hands every online client's key to everyone. On
   two relays nobody on the far side is ever in that list, so a member who was
   not somebody's direct contact was skipped by the fan-out without a word:
   in a group spanning Finland and Iran only the people who had swapped cards
   with each other heard each other.

   So a roster now travels with a card per member — name, peer id,
   fingerprint, public key, home relay — and a device that meets a card for a
   fellow member it does not know keeps a quiet record of them (groupMember):
   enough to seal a group message, a call leg or a reply to, and not shown as
   a conversation until there is one.

   A card proves nothing about its home relay (that is filed at the bottom of
   the trust ladder and never displaces a route a card from the person
   themselves established), but its KEY proves itself: a card is only taken
   when sha256(publicKey) is the fingerprint it claims, which is the same rule
   the relay applies to every hello. Somebody forging a card for a fingerprint
   cannot attach a key of their own to it.
   ============================================================================ */

const MEMBER_CARDS_MAX = 64;

/* This device's own card, in the same shape as everybody else's. */
function myMemberCard() {
  const identity = typeof identityPayload === 'function' ? identityPayload() : null;
  if (!identity?.fingerprint || !identity.publicKeyData) return null;
  return {
    name: identity.name || '',
    peerId: identity.peerId || '',
    fingerprint: identity.fingerprint,
    publicKeyData: identity.publicKeyData,
    homeRelay: identity.homeRelay || null,
  };
}

/* A card for one roster key, when this device knows enough to vouch for the
   key: a record with the public key on it. */
function memberCardForKey(key) {
  const peer = findPeerByAnyKey(key);
  if (!peer || peer.type || !peer.fingerprint || !peer.publicKeyData) return null;
  if (isSelfPeerRecord(peer)) return null;
  /* The pinned key, never a pending one: a card must not spread a key change
     nobody here has accepted. */
  const publicKeyData = peer.trustedKey || peer.publicKeyData;
  return {
    name: peer.username || peer.name || '',
    peerId: peer.peerId || '',
    fingerprint: peer.trustedFingerprint || peer.fingerprint,
    publicKeyData,
    homeRelay: typeof routableHomeRelay === 'function' ? routableHomeRelay(peer) : null,
  };
}

/* Cards for everybody in the group this device can vouch for, itself first. */
function memberCardsFor(space, { onlyKeys = null } = {}) {
  if (!space) return [];
  const cards = [];
  const seen = new Set();
  const own = myMemberCard();
  if (own) { cards.push(own); seen.add(own.fingerprint); }
  const keys = onlyKeys || [
    ...normalizeSpaceMembers(space.members),
    space.ownerFingerprint, space.ownerPeerId,
  ];
  for (const key of keys) {
    if (cards.length >= MEMBER_CARDS_MAX) break;
    const card = memberCardForKey(key);
    if (!card || seen.has(card.fingerprint)) continue;
    seen.add(card.fingerprint);
    cards.push(card);
  }
  return cards;
}

async function cardKeyMatchesFingerprint(card) {
  if (!/^[a-f0-9]{64}$/i.test(String(card?.fingerprint || ''))) return false;
  const key = String(card?.publicKeyData || '');
  if (!/^[A-Za-z0-9+/=]{64,2048}$/.test(key)) return false;
  try {
    const digest = await crypto.subtle.digest('SHA-256', base64ToBytes(key));
    const hex = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return hex === String(card.fingerprint).toLowerCase();
  } catch (_error) {
    return false;
  }
}

/* Takes what it can vouch for from a list of cards. Returns the records that
   became reachable (new, or newly holding a key or a route), so a caller can
   send them whatever they were skipped for. */
async function ingestMemberCards(cards, space) {
  if (!Array.isArray(cards) || !cards.length) return [];
  const mine = chatState.identity?.fingerprint || '';
  const reachable = [];
  let changed = false;
  for (const raw of cards.slice(0, MEMBER_CARDS_MAX)) {
    const card = {
      name: String(raw?.name || '').slice(0, 80),
      peerId: String(raw?.peerId || '').slice(0, 160),
      fingerprint: String(raw?.fingerprint || '').toLowerCase(),
      publicKeyData: String(raw?.publicKeyData || ''),
      homeRelay: raw?.homeRelay && typeof raw.homeRelay === 'object' ? raw.homeRelay : null,
    };
    if (!card.fingerprint || card.fingerprint === mine) continue;
    if (!await cardKeyMatchesFingerprint(card)) continue;
    const offeredRoute = card.homeRelay ? { ...card.homeRelay, source: 'presence' } : null;
    const existing = (chatState.peers || []).find((peer) => !peer.type && (peer.fingerprint === card.fingerprint
      || peer.trustedFingerprint === card.fingerprint));
    if (existing) {
      const hadKey = Boolean(existing.publicKeyData);
      const hadRoute = typeof routableHomeRelay === 'function' && Boolean(routableHomeRelay(existing));
      /* Written field by field rather than through mergePeerRecord: a card
         may fill what is missing, never replace what is there — the pinned
         key above all. */
      if (!existing.publicKeyData) {
        existing.publicKeyData = card.publicKeyData;
        existing.trustedKey = existing.trustedKey || card.publicKeyData;
        existing.trustedFingerprint = existing.trustedFingerprint || card.fingerprint;
        existing.trustedAt = existing.trustedAt || new Date().toISOString();
        changed = true;
      }
      if (!existing.peerId && card.peerId) { existing.peerId = card.peerId; changed = true; }
      if (offeredRoute) {
        const next = betterHomeRelay(existing.homeRelay, offeredRoute);
        if (next && JSON.stringify(next) !== JSON.stringify(normalizeHomeRelay(existing.homeRelay))) {
          existing.homeRelay = next;
          changed = true;
        }
      }
      const nowRoute = typeof routableHomeRelay === 'function' && Boolean(routableHomeRelay(existing));
      if ((!hadKey && existing.publicKeyData) || (!hadRoute && nowRoute)) reachable.push(existing);
      continue;
    }
    if (!card.peerId) card.peerId = card.fingerprint;
    const record = normalizePeerRecord({
      peerId: card.peerId,
      clientId: card.peerId,
      username: card.name || t('عضو گروه', 'Group member'),
      name: card.name || '',
      fingerprint: card.fingerprint,
      publicKeyData: card.publicKeyData,
      homeRelay: offeredRoute,
      homeRelaySource: 'presence',
      status: 'offline',
      groupMember: true,
    });
    record.trustedKey = card.publicKeyData;
    record.trustedFingerprint = card.fingerprint;
    record.trustedAt = new Date().toISOString();
    chatState.peers.push(record);
    reachable.push(record);
    changed = true;
  }
  if (changed) {
    saveContacts();
    renderPeers();
  }
  /* Whatever this device skipped them for — a group message sent while their
     card was missing — goes now. */
  for (const record of reachable) noteMemberReachable(record, space);
  return reachable;
}

/* Group messages the fan-out had to skip a member for, re-sent once that
   member can be reached. The entries carry who they missed (skippedMembers),
   so this is exact rather than a guess. */
function noteMemberReachable(record, space) {
  if (!record?.fingerprint) return;
  const spaces = space ? [space] : (chatState.spaces?.groups || []);
  window.setTimeout(async () => {
    for (const group of spaces) {
      const entries = (chatState.history[group.conversationId] || []).filter((entry) => entry.direction === 'out'
        && entry.type === 'text'
        && Array.isArray(entry.skippedMembers)
        && entry.skippedMembers.some((key) => key === record.fingerprint || key === record.peerId));
      if (!entries.length) continue;
      let session = await ensureStoredSession(record);
      if (!session?.cryptoKey) session = await ensureDirectSession(record, { silent: true });
      if (!session?.cryptoKey) continue;
      for (const entry of entries) {
        const outbound = await groupTextOutboundFor(group, entry, session);
        if (await sendSealedRelay(record, session, outbound, { createdAt: outbound.createdAt, scope: 'group' })) {
          entry.skippedMembers = entry.skippedMembers.filter((key) => key !== record.fingerprint && key !== record.peerId);
          if (!entry.skippedMembers.length) delete entry.skippedMembers;
        }
      }
      storeHistory();
    }
    /* And any parked or unacknowledged mail to them, now that a route may
       exist where none did. */
    if (transitRouteFor(record) && typeof resendParkedMessages === 'function') {
      resendParkedMessages(record).catch(() => {});
    }
  }, 200);
}

/* ---- asking for cards ---------------------------------------------------- */

const memberCardRequests = new Map();
const MEMBER_CARD_REQUEST_COOLDOWN_MS = 5 * 60 * 1000;

/* The fan-out met roster keys it cannot resolve. Whoever can be reached —
   the owner first — is asked for the cards, sealed like any message. */
async function requestMemberCards(space, missingKeys) {
  if (!space?.conversationId || !missingKeys?.length) return;
  const last = memberCardRequests.get(space.conversationId) || 0;
  if (Date.now() - last < MEMBER_CARD_REQUEST_COOLDOWN_MS) return;
  memberCardRequests.set(space.conversationId, Date.now());
  const targets = [];
  const owner = findPeerByAnyKey(space.ownerFingerprint) || findPeerByAnyKey(space.ownerPeerId);
  if (owner && !isSelfPeerRecord(owner)) targets.push(owner);
  for (const key of groupDeliveryMemberKeys(space)) {
    if (targets.length >= 4) break;
    const peer = findPeerByAnyKey(key);
    if (peer && peer.publicKeyData && !targets.includes(peer)) targets.push(peer);
  }
  for (const peer of targets) {
    let session = await ensureStoredSession(peer);
    if (!session?.cryptoKey) session = await ensureDirectSession(peer, { silent: true });
    if (!session?.cryptoKey) continue;
    await sendSealedRelay(peer, session, {
      type: 'member-cards-request',
      id: generateId('mcr'),
      spaceId: space.conversationId,
      keys: missingKeys.slice(0, MEMBER_CARDS_MAX).map((key) => String(key).slice(0, 160)),
      createdAt: new Date().toISOString(),
    }, { createdAt: new Date().toISOString(), scope: 'group', notify: false });
  }
}

/* Both halves arrive through handleSessionMessage, sealed and authenticated
   by the session. Only a member of a group this device is in is answered,
   and only with cards of that group's own members. */
async function handleMemberCardsMessage(session, message) {
  const space = (chatState.spaces?.groups || []).find((group) => group.conversationId === message.spaceId);
  if (!space) return true;
  const sender = findPeerBySession(session);
  const senderKeys = [sender?.fingerprint, sender?.peerId, session?.remoteFingerprint].filter(Boolean);
  const roster = new Set([...normalizeSpaceMembers(space.members), space.ownerFingerprint, space.ownerPeerId].filter(Boolean));
  if (!senderKeys.some((key) => roster.has(key))) return true;
  if (message.type === 'member-cards-request') {
    const asked = (Array.isArray(message.keys) ? message.keys : []).map(String).filter((key) => roster.has(key));
    const cards = memberCardsFor(space, { onlyKeys: asked.length ? asked : null });
    if (!sender || !cards.length) return true;
    await sendSealedRelay(sender, session, {
      type: 'member-cards',
      id: generateId('mc'),
      spaceId: space.conversationId,
      cards,
      createdAt: new Date().toISOString(),
    }, { createdAt: new Date().toISOString(), scope: 'group', notify: false });
    return true;
  }
  if (message.type === 'member-cards') {
    const wanted = (Array.isArray(message.cards) ? message.cards : [])
      .filter((card) => roster.has(String(card?.fingerprint || '')) || roster.has(String(card?.peerId || '')));
    await ingestMemberCards(wanted, space);
    return true;
  }
  return false;
}

/* An owner's existing groups predate member cards. Once per session, a little
   after start, the owner sends each group's record — cards included — to its
   members, so a group made before this change heals without anybody doing
   anything. */
let memberCardsHealedThisSession = false;
function healGroupsWithMemberCards() {
  if (memberCardsHealedThisSession) return;
  memberCardsHealedThisSession = true;
  window.setTimeout(() => {
    for (const space of chatState.spaces?.groups || []) {
      if (space.dissolved || space.deleted) continue;
      if (typeof localSpaceRole === 'function' && localSpaceRole(space) !== 'owner') continue;
      if (typeof broadcastSpaceRecord === 'function') broadcastSpaceRecord(space);
    }
  }, 8000);
}

window.memberCardsFor = memberCardsFor;
window.ingestMemberCards = ingestMemberCards;
