/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 12 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Group calls — full mesh
*/

/* =====================================================================
   Group calls — full mesh
   ---------------------------------------------------------------------
   Every participant holds a direct media connection to every other one:
   N people means N(N-1)/2 legs. That costs upload bandwidth and caps the
   practical size at a handful of people, and it is still the right shape
   for this app. The alternative is an SFU, which means a media server
   that decrypts and re-encrypts every stream — precisely the thing this
   application exists to avoid. A mesh keeps each leg end-to-end
   encrypted by DTLS-SRTP with nothing in the middle.

   Two peers learning about each other at the same moment would otherwise
   both dial and end up with two connections, so the rule is fixed and
   needs no negotiation: the smaller fingerprint places the call.
   ===================================================================== */
const GROUP_CALL_MAX = 8;

function groupCallActive() {
  return Boolean(chatState.groupCall?.callId);
}
function groupCallParticipantKey(peerRecord) {
  return peerRecord?.fingerprint || peerRecord?.peerId || '';
}
function myCallIdentity() {
  return chatState.identity?.fingerprint || chatState.peerId || '';
}
/* Deterministic and symmetric: both sides compute the same answer, so exactly
   one of them dials. */
function shouldPlaceCallTo(remoteFingerprint) {
  const mine = myCallIdentity();
  if (!mine || !remoteFingerprint) return true;
  return mine < remoteFingerprint;
}

function resetGroupCallState() {
  /* Overwriting the state wholesale used to orphan whatever the previous
     call still held: live mesh legs nobody closes, a camera or screen-share
     whose stop callbacks are dropped on the floor (the indicators stay lit
     with no UI left to stop them). Tear down first, then start clean. */
  const previous = chatState.groupCall;
  if (previous && previous.callId) {
    previous.participants?.forEach((entry) => {
      try { entry?.call?.close?.(); } catch (_error) { /* already gone */ }
      entry?.stream?.getTracks?.().forEach((track) => { try { track.stop(); } catch (_error) {} });
    });
    previous.localStream?.getTracks?.().forEach((track) => { try { track.stop(); } catch (_error) {} });
    try { previous.cameraTrack?.stop?.(); } catch (_error) { /* already gone */ }
    try { previous.presentStop?.(); } catch (_error) { /* already gone */ }
    if (typeof disposeGroupMeterContext === 'function') disposeGroupMeterContext();
  }
  chatState.groupCall = {
    callId: '',
    spaceId: '',
    mode: 'voice',
    startedAt: 0,
    participants: new Map(),
    localStream: null,
    muted: false,
    videoOff: false,
    presenting: '',
    cameraTrack: null,
    presentStop: null,
    pinnedKey: '',
    handRaised: false,
    meter: null,
  };
}

/* How much of a group is actually reachable right now.
 *
 * A group record has no `status` of its own, so the conversation list read it
 * as offline and every group sat there saying "Disconnected" with a red dot -
 * which is not wrong so much as meaningless: a group is not a thing that
 * connects. What a reader wants is how many of the people in it are here. */
function groupPresence(space) {
  const keys = new Set();
  (Array.isArray(space?.members) ? space.members : []).forEach((key) => keys.add(key));
  [space?.ownerFingerprint, space?.ownerPeerId].filter(Boolean).forEach((key) => keys.add(key));
  const mine = localMembershipKeys();
  const others = [...keys].filter((key) => !mine.has(key));
  let online = 0;
  others.forEach((key) => {
    const peer = findPeerByAnyKey(key);
    if (peer && peer.status === 'online') online += 1;
  });
  /* You are in the group and you are reading this, so you count. */
  const total = others.length + 1;
  const here = online + 1;
  return {
    online: here,
    total,
    all: total > 0 && here >= total,
    some: here > 1,
    dissolved: Boolean(space?.dissolved),
  };
}

function groupCallMembers(space) {
  return groupDeliveryMemberKeys(space)
    .map((key) => findPeerByAnyKey(key))
    .filter((peer) => peer && !isSelfPeerRecord(peer));
}

/* Who a call signal goes to. A group supplies its roster; a call put together
   by hand supplies the people directly, and everything downstream is the same
   code either way. */
function callTargets(spaceOrPeers) {
  if (Array.isArray(spaceOrPeers)) {
    return spaceOrPeers.filter((peer) => peer && !isSelfPeerRecord(peer));
  }
  return groupCallMembers(spaceOrPeers);
}
function signalGroupCall(spaceOrPeers, message) {
  callTargets(spaceOrPeers).forEach((peerRecord) => {
    relaySessionEvent(peerRecord, { ...message, createdAt: new Date().toISOString() });
  });
}
/* The people in this call, by fingerprint, so an invitation can say who else
   was asked. Travels inside the encrypted signal, never past the relay in the
   clear. */
/* Who to send a call signal to, whatever kind of call this is.
 *
 * Three separate places looked the group record up by id and gave up when they
 * did not find one - which is every ad-hoc call, so raising a hand, reacting
 * and leaving all silently reached nobody. The roster the call was started
 * with answers the same question and is always there. */
function groupCallAudience() {
  if (!groupCallActive()) return null;
  const space = chatState.spaces.groups.find((item) => item.conversationId === chatState.groupCall.spaceId);
  if (space) return space;
  const fromRoster = (chatState.groupCall.roster || [])
    .map((key) => findPeerByAnyKey(key))
    .filter((peer) => peer && !isSelfPeerRecord(peer));
  if (fromRoster.length) return fromRoster;
  /* Last resort: whoever is actually connected in this call. */
  const live = [];
  chatState.groupCall.participants.forEach((entry) => { if (entry?.peer) live.push(entry.peer); });
  return live.length ? live : null;
}
function callRosterOf(spaceOrPeers) {
  return callTargets(spaceOrPeers)
    .map((peer) => peer.fingerprint || peer.peerId || '')
    .filter(Boolean);
}

/* js/app.js knows how to read a getUserMedia rejection; this is the way in.
   Guarded because the chat modules are also loaded by the native shell tests,
   where app.js may not have finished wiring itself up yet. */
function mediaFailureText(error, want) {
  if (typeof window.describeMediaError === 'function') {
    return window.describeMediaError(error, want);
  }
  return t('دسترسی به میکروفون یا دوربین داده نشد.', 'Microphone or camera access was denied.');
}

async function acquireGroupCallStream(mode) {
  const constraints = mode === 'video'
    ? { audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 } } }
    : { audio: true, video: false };
  return hintTrackContent(await navigator.mediaDevices.getUserMedia(constraints));
}

/* A call among people who are not a group. Everything the call protocol needs
 * is the list of who was asked - members announce themselves and answer each
 * other, so no shared record has to exist first. This is deliberately not a
 * group: nothing is stored, nothing appears in the group list, and when the
 * call ends there is nothing left behind. */
/* The contact picker that stands behind both ways into a group call: starting
 * a fresh one from the Calls tab, and widening a two-person call that is
 * already running. It is the same list of people either way, so it is the same
 * picker - what differs is only what happens when it is confirmed. */
let callPickerIntent = null;

/* Bringing more people into a call that is already up.
 *
 * A two-person call has no roster to extend, so it becomes an ad-hoc group
 * call that includes whoever was already on the line. A group call that is
 * already running just rings the newcomers and tells them who else is there. */
async function addPeopleToLiveCall(people) {
  const extra = (people || []).filter((peer) => peer && !isSelfPeerRecord(peer));
  if (!extra.length) return;
  if (groupCallActive()) {
    const known = new Set(chatState.groupCall.roster || []);
    const roster = [...known, ...extra.map((p) => p.fingerprint || p.peerId).filter(Boolean)];
    chatState.groupCall.roster = roster;
    signalGroupCall(extra, {
      type: 'gcall-invite',
      callId: chatState.groupCall.callId,
      spaceId: chatState.groupCall.spaceId,
      mode: chatState.groupCall.mode,
      roster: [...roster, myCallIdentity()].filter(Boolean),
      title: chatState.groupCall.title || '',
      fromName: chatState.profile.name || t('یک عضو', 'A member'),
      fromFingerprint: myCallIdentity(),
    });
    notify(t(`${extra.length} نفر به تماس دعوت شدند.`, `${extra.length} invited to the call.`), 'success');
    return;
  }
  const onCall = activeCallPeerRecord();
  if (!chatState.currentCall || !onCall || onCall.type) {
    notify(t('تماسی در جریان نیست.', 'There is no call in progress.'), 'warning');
    return;
  }
  const mode = chatState.currentCallMode === 'video' ? 'video' : 'voice';
  /* The person already on the line is not rung again. They are told the call
     they are in has become a group call and they move across on their own;
     ringing them would be the app hanging up on somebody and immediately
     calling them back, which is what it used to look like from their side. */
  const callId = generateId('gcall');
  const roster = [onCall, ...extra].map((peer) => peer.fingerprint || peer.peerId).filter(Boolean);
  const upgradeNotice = {
    type: 'gcall-invite',
    callId,
    spaceId: `adhoc-${callId}`,
    mode,
    roster: [...roster, myCallIdentity()].filter(Boolean),
    title: t('تماس گروهی', 'Group call'),
    upgrade: true,
    fromName: chatState.profile.name || t('یک عضو', 'A member'),
    fromFingerprint: myCallIdentity(),
    createdAt: new Date().toISOString(),
  };
  /* Both routes, on purpose.
   *
   * relaySessionEvent prefers the data channel, and the very next thing this
   * function does is tear that channel down. On a loopback the message is
   * already gone by then; over a real network it is still in a buffer, and the
   * other side simply never hears that the call is growing - their call dies
   * and the group call rings them as if it were a new one. That is exactly
   * what this was reported doing.
   *
   * The relay copy does not depend on the channel that is about to close. A
   * duplicate costs nothing: the receiver ignores an invite once it is already
   * in that call. */
  relaySessionEvent(onCall, upgradeNotice);
  sendRelayEnvelope(onCall, offlineEnvelope(upgradeNotice, { createdAt: upgradeNotice.createdAt }));
  /* And give the channel a beat to flush before anything is closed. */
  await new Promise((resolve) => setTimeout(resolve, 350));
  /* The same microphone cannot feed both stages, so the pair call comes down
     on this side too - but it did not end, it grew. It is neither logged as a
     call that stopped nor announced to the other side as one: they were told a
     moment ago that it became a group call, and "the call ended" arriving
     right behind that is what made this look like a hang-up and a redial. */
  const carriedStream = chatState.localStream;
  endCurrentCall({ logCall: false, notifyPeer: false, keepLocalStream: true });
  chatState.localStream = null;
  await startAdhocGroupCall([onCall, ...extra], mode, {
    callId,
    silentFor: [onCall],
    stream: carriedStream,
  });
}



/* Every key that identifies somebody already in this call, whichever kind of
   call it is. Keys rather than records, because the picker matches on the
   value it put in each checkbox. */
function peopleAlreadyOnTheCall() {
  const keys = new Set();
  const add = (peer) => {
    if (!peer) return;
    [getConversationKey(peer), peer.peerId, peer.clientId, peer.fingerprint]
      .filter(Boolean).forEach((key) => keys.add(key));
  };
  if (groupCallActive()) {
    (chatState.groupCall.roster || []).forEach((key) => {
      keys.add(key);
      add(findPeerByAnyKey(key));
    });
    chatState.groupCall.participants.forEach((entry, key) => { keys.add(key); add(entry?.peer); });
  }
  const onCall = activeCallPeerRecord();
  if (onCall && !onCall.type) add(onCall);
  return [...keys];
}
function renderCallPickerList() {
  const list = document.getElementById('chatCallPickerList');
  if (!list) return;
  const already = new Set(callPickerIntent?.exclude || []);
  const isAlreadyIn = (peer) => [getConversationKey(peer), peer.peerId, peer.clientId, peer.fingerprint]
    .filter(Boolean).some((key) => already.has(key));
  const people = chatState.peers
    .filter((peer) => peer.peerId && !peer.type && !isSelfPeerRecord(peer))
    .filter((peer) => !isAlreadyIn(peer))
    .sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online'));
  if (!people.length) {
    list.innerHTML = `<div class="chat-call-picker-empty">${t('مخاطبی برای افزودن نیست.', 'There is nobody to add.')}</div>`;
    return;
  }
  list.innerHTML = people.map((peer) => `
    <label class="chat-call-picker-row">
      <input type="checkbox" value="${app().escapeHTML(getConversationKey(peer))}">
      <span class="chat-peer-presence-dot ${peer.status === 'online' ? 'online' : 'offline'}"></span>
      <span class="chat-call-picker-name">${app().escapeHTML(peer.username || peer.name || peer.peerId)}</span>
      <span class="chat-call-picker-state">${peer.status === 'online' ? t('آنلاین', 'online') : t('آفلاین', 'offline')}</span>
    </label>`).join('');
  syncCallPickerCount();
}
function syncCallPickerCount() {
  const label = document.getElementById('chatCallPickerCount');
  if (!label) return;
  const n = document.querySelectorAll('#chatCallPickerList input[type="checkbox"]:checked').length;
  label.textContent = n ? t(`${n} نفر انتخاب شد`, `${n} selected`) : t('کسی انتخاب نشده', 'nobody selected');
}
function openCallPicker(intent) {
  callPickerIntent = intent;
  const box = document.getElementById('chatCallPicker');
  const title = document.getElementById('chatCallPickerTitle');
  if (!box) return;
  if (title) title.textContent = intent.title;
  renderCallPickerList();
  box.classList.remove('hidden');
}
function closeCallPicker() {
  callPickerIntent = null;
  document.getElementById('chatCallPicker')?.classList.add('hidden');
}
function selectedCallPeers() {
  return Array.from(document.querySelectorAll('#chatCallPickerList input[type="checkbox"]:checked'))
    .map((box) => findPeerByAnyKey(box.value))
    .filter(Boolean);
}

async function startAdhocGroupCall(peerRecords, mode = 'voice', options = {}) {
  const people = (peerRecords || []).filter((peer) => peer && !isSelfPeerRecord(peer));
  if (!people.length) {
    notify(t('برای تماس گروهی حداقل یک مخاطب انتخاب کنید.', 'Pick at least one contact for a group call.'), 'warning');
    return;
  }
  const names = people.map((peer) => peer.username || peer.name || '').filter(Boolean);
  return startGroupCall(mode, {
    conversationId: options.callId ? `adhoc-${options.callId}` : `adhoc-${generateId('call')}`,
    name: names.slice(0, 3).join('، ') + (names.length > 3 ? ` +${names.length - 3}` : ''),
    adhoc: true,
    people,
    callId: options.callId || '',
    /* Anybody already told about this call - the person a pair call is being
       upgraded from - is not invited a second time. */
    silentFor: options.silentFor || [],
    stream: options.stream || null,
  });
}

async function startGroupCall(mode = 'voice', adhoc = null) {
  const space = adhoc || activeGroupSpace();
  if (!space) return;
  if (groupCallActive()) {
    notify(t('یک تماس گروهی همین حالا در جریان است.', 'A group call is already running.'), 'warning');
    return;
  }
  if (isCallBusy()) {
    notify(t('ابتدا تماس فعلی را تمام کنید.', 'Finish the current call first.'), 'warning');
    return;
  }
  const audience = space.adhoc ? space.people : space;
  const members = callTargets(audience);
  if (!members.length) {
    notify(t('عضو دیگری در این گروه نیست.', 'There is nobody else in this group.'), 'warning');
    return;
  }
  const roster = callRosterOf(audience);
  let stream = space.stream || null;
  /* A stream handed over from a pair call is already open and already has the
     right tracks; asking the device again would be a second acquisition for
     no gain. */
  if (stream && !stream.getTracks().some((track) => track.readyState === 'live')) stream = null;
  try {
    if (!stream) stream = await acquireGroupCallStream(mode);
  } catch (error) {
    /* The reason, not just the fact. A microphone blocked by the macOS
       hardened runtime and a webcam already held by another application both
       used to arrive here as the same sentence about permission. */
    notify(mediaFailureText(error, mode === 'video' ? 'both' : 'audio'), 'warning');
    return;
  }
  resetGroupCallState();
  chatState.groupCall.callId = space.callId || generateId('gcall');
  chatState.groupCall.spaceId = space.conversationId;
  chatState.groupCall.mode = mode;
  chatState.groupCall.startedAt = Date.now();
  chatState.groupCall.localStream = stream;
  chatState.groupCall.roster = roster;
  chatState.groupCall.adhoc = Boolean(space.adhoc);
  chatState.groupCall.title = space.name || '';
  /* The invitation says who else was asked, so somebody who has no record of
     this call can still announce themselves to everybody rather than only to
     whoever rang them. It rides inside the encrypted signal. */
  const alreadyTold = new Set((space.silentFor || [])
    .flatMap((peer) => [peer?.fingerprint, peer?.peerId, peer?.clientId].filter(Boolean)));
  const toInvite = callTargets(audience)
    .filter((peer) => ![peer.fingerprint, peer.peerId, peer.clientId].some((key) => key && alreadyTold.has(key)));
  signalGroupCall(toInvite, {
    type: 'gcall-invite',
    callId: chatState.groupCall.callId,
    spaceId: space.conversationId,
    mode,
    roster: [...roster, myCallIdentity()].filter(Boolean),
    title: space.name || '',
    fromName: chatState.profile.name || t('یک عضو', 'A member'),
    fromFingerprint: myCallIdentity(),
  });
  /* A call that belongs to no group has no thread to write a note into - but
     it still has a caller, who needs the stage the same way anybody else does.
     Returning here instead of skipping just the note left the person who
     started the call holding a live microphone with nothing on screen and no
     button to hang up with. */
  if (!space.adhoc) {
    appendHistory(space.conversationId, {
      id: generateId('sys'),
      direction: 'in',
      type: 'system-note',
      text: t(`${chatState.profile.name || 'شما'} یک تماس گروهی شروع کرد.`, `${chatState.profile.name || 'You'} started a group call.`),
      status: 'delivered',
      createdAt: new Date().toISOString(),
    });
  }
  openGroupCallStage();
  renderGroupCallStage();
  startGroupCallTicker();
  startGroupLevelMeters();
  replayHeldGroupCallSignals();
}

/* Signals that arrive before this device's call is running.
 *
 * Joining a call is not instant: acquiring the microphone can take a second or
 * two, and a getUserMedia prompt can take much longer. Anything that arrives in
 * that window used to be dropped on the floor, because every handler starts
 * with "am I in this call?" and the answer was not yet yes.
 *
 * That is exactly what broke the pair-to-group upgrade. The person already on
 * the line hears about it first and announces themselves immediately; the
 * person who added somebody is still opening their microphone and never hears
 * the announcement. Nothing retries, so those two - the two who were already
 * talking - end up as the only pair in the call who cannot see each other,
 * while both can see the newcomer who joined later and therefore in time.
 *
 * Held briefly and replayed once the call is up. Bounded in both count and
 * age so a device that never joins does not accumulate anything. */
const PENDING_GROUP_SIGNAL_MS = 30000;
const PENDING_GROUP_SIGNAL_MAX = 40;
function holdGroupCallSignal(message) {
  if (!message?.callId) return;
  chatState.pendingGroupSignals = chatState.pendingGroupSignals || [];
  const now = Date.now();
  chatState.pendingGroupSignals = chatState.pendingGroupSignals
    .filter((held) => now - held.at < PENDING_GROUP_SIGNAL_MS)
    .slice(-(PENDING_GROUP_SIGNAL_MAX - 1));
  chatState.pendingGroupSignals.push({ message, at: now });
}
function replayHeldGroupCallSignals() {
  const held = chatState.pendingGroupSignals || [];
  if (!held.length) return;
  chatState.pendingGroupSignals = [];
  const now = Date.now();
  held
    .filter((entry) => now - entry.at < PENDING_GROUP_SIGNAL_MS)
    .filter((entry) => entry.message.callId === chatState.groupCall.callId)
    .forEach((entry) => {
      try { handleGroupCallSignal(entry.message); } catch (error) {
        console.warn('[GroupCall] a held signal could not be replayed', error);
      }
    });
}

async function joinGroupCall(callId, spaceId, mode, roster = []) {
  if (groupCallActive() && chatState.groupCall.callId === callId) return;
  /* The invite handler only ignores invites while a group call is already
     up; a card shown BEFORE a 1:1 call started could still be accepted on
     top of it — two calls, two getUserMedia acquisitions, one currentCall
     fighting one groupCall over the microphone. */
  if (typeof isCallBusy === 'function' && isCallBusy()) {
    notify(t('ابتدا تماس فعلی را تمام کنید.', 'Finish the current call first.'), 'warning');
    return;
  }
  /* GROUP_CALL_MAX was declared and never enforced: a mesh is N² legs and N
     encoders per device, and past 8 it degrades into unusable load with no
     warning to anyone. Refuse the ninth seat outright. */
  const otherSeats = roster.filter((key) => {
    if (!key) return false;
    const peer = findPeerByAnyKey(key);
    return peer ? !isSelfPeerRecord(peer) : true;
  }).length;
  if (otherSeats + 1 > GROUP_CALL_MAX) {
    notify(t(`اتاق پر است (حداکثر ${GROUP_CALL_MAX} نفر).`, `The room is full (max ${GROUP_CALL_MAX}).`), 'warning');
    return;
  }
  /* A call does not have to belong to a group. When it does, the group's own
     roster is used; when it was put together by hand there is no record to
     look up, so the invitation carried the list instead. Requiring a stored
     space here is what made an invitation to an ad-hoc call do nothing at all
     when it was accepted. */
  const space = chatState.spaces.groups.find((item) => item.conversationId === spaceId);
  const announceTo = space || roster
    .map((key) => findPeerByAnyKey(key))
    .filter((peer) => peer && !isSelfPeerRecord(peer));
  if (!space && !announceTo.length) {
    notify(t('این تماس دیگر در دسترس نیست.', 'That call is no longer available.'), 'warning');
    return;
  }
  let stream;
  try {
    stream = await acquireGroupCallStream(mode);
  } catch (error) {
    /* The reason, not just the fact. A microphone blocked by the macOS
       hardened runtime and a webcam already held by another application both
       used to arrive here as the same sentence about permission. */
    notify(mediaFailureText(error, mode === 'video' ? 'both' : 'audio'), 'warning');
    return;
  }
  resetGroupCallState();
  chatState.groupCall.callId = callId;
  chatState.groupCall.spaceId = spaceId;
  chatState.groupCall.mode = mode;
  chatState.groupCall.startedAt = Date.now();
  chatState.groupCall.localStream = stream;
  hideGroupCallInvite();
  /* Announcing the join is what makes the mesh assemble: everyone already in
     the call hears it and either dials us or waits for our dial. */
  chatState.groupCall.roster = roster.slice();
  signalGroupCall(announceTo, {
    type: 'gcall-join',
    callId,
    spaceId,
    mode,
    roster,
    fromName: chatState.profile.name || t('یک عضو', 'A member'),
    fromFingerprint: myCallIdentity(),
  });
  openGroupCallStage();
  renderGroupCallStage();
  startGroupCallTicker();
  startGroupLevelMeters();
  replayHeldGroupCallSignals();
}

/* Places the leg to one peer, if the tie-break says it is our turn. */
function connectGroupCallPeer(peerRecord, name) {
  if (!groupCallActive() || !chatState.peer || !peerRecord?.peerId) return;
  const key = groupCallParticipantKey(peerRecord);
  if (!key || key === myCallIdentity()) return;
  const existing = chatState.groupCall.participants.get(key);
  if (existing?.call) return;
  chatState.groupCall.participants.set(key, {
    key,
    peerId: peerRecord.peerId,
    name: name || peerRecord.username || peerRecord.peerId,
    call: null,
    stream: null,
    muted: false,
    videoOff: false,
  });
  renderGroupCallStage();
  /* A leg that never connects (lost join signal, failed ICE) otherwise sits
     as a permanent "Connecting…" tile with nobody left to clean it up. Give
     it half a minute, then take the seat away. */
  const legKey = key;
  const legTimer = window.setTimeout(() => {
    const entry = chatState.groupCall?.participants?.get(legKey);
    if (entry && !entry.call && !entry.stream) {
      chatState.groupCall.participants.delete(legKey);
      renderGroupCallStage();
    }
  }, 30000);
  const clearLegTimer = () => window.clearTimeout(legTimer);
  const watchLeg = () => {
    const entry = chatState.groupCall?.participants?.get(legKey);
    if (entry?.call || entry?.stream) { clearLegTimer(); return; }
    if (chatState.groupCall?.callId) window.setTimeout(watchLeg, 1000);
  };
  watchLeg();
  if (!shouldPlaceCallTo(peerRecord.fingerprint || peerRecord.peerId)) return;
  try {
    const call = chatState.peer.call(peerRecord.peerId, chatState.groupCall.localStream, {
      sdpTransform: preferCallCodecs,
      metadata: {
        groupCall: chatState.groupCall.callId,
        spaceId: chatState.groupCall.spaceId,
        mode: chatState.groupCall.mode,
        username: chatState.profile.name || '',
      },
    });
    attachGroupCallLeg(key, call);
  } catch (error) {
    console.warn('[Group call] could not dial', peerRecord.peerId, error);
  }
}

function attachGroupCallLeg(key, call) {
  if (!call) return;
  const entry = chatState.groupCall.participants.get(key) || { key, name: call.peer };
  entry.call = call;
  entry.peerId = call.peer;
  chatState.groupCall.participants.set(key, entry);
  call.on('stream', (remoteStream) => {
    const row = chatState.groupCall.participants.get(key);
    if (!row) return;
    row.stream = remoteStream;
    renderGroupCallStage();
  });
  call.on('close', () => dropGroupCallPeer(key));
  call.on('error', () => dropGroupCallPeer(key));
  renderGroupCallStage();
}

function dropGroupCallPeer(key) {
  const entry = chatState.groupCall?.participants?.get(key);
  if (!entry) return;
  try { entry.call?.close?.(); } catch (_error) { /* already closed */ }
  chatState.groupCall.participants.delete(key);
  renderGroupCallStage();
}

function leaveGroupCall({ silent = false } = {}) {
  if (!groupCallActive()) return;
  /* A call put together by hand has no group record, so looking one up found
     nothing and nobody was told the caller had gone. The roster the call was
     started with answers the same question. */
  const audience = groupCallAudience();
  if (audience && !silent) {
    signalGroupCall(audience, {
      type: 'gcall-leave',
      callId: chatState.groupCall.callId,
      fromFingerprint: myCallIdentity(),
      fromName: chatState.profile.name || '',
    });
  }
  try { chatState.groupCall.presentStop?.(); } catch (_error) { /* already gone */ }
  chatState.groupCall.participants.forEach((entry) => {
    try { entry.call?.close?.(); } catch (_error) { /* already closed */ }
  });
  chatState.groupCall.localStream?.getTracks?.().forEach((track) => track.stop());
  chatState.groupCall.cameraTrack?.stop?.();
  stopGroupCallTicker();
  /* Closes meter nodes and the shared AudioContext too — see the roster
     module; stopGroupLevelMeters alone left them all running. */
  if (typeof disposeGroupMeterContext === 'function') disposeGroupMeterContext();
  resetGroupCallState();
  closeGroupCallStage();
}

function toggleGroupCallMute() {
  if (!groupCallActive()) return;
  chatState.groupCall.muted = !chatState.groupCall.muted;
  chatState.groupCall.localStream?.getAudioTracks?.().forEach((track) => {
    track.enabled = !chatState.groupCall.muted;
  });
  broadcastGroupCallState();
  renderGroupCallStage();
}
function toggleGroupCallVideo() {
  if (!groupCallActive()) return;
  chatState.groupCall.videoOff = !chatState.groupCall.videoOff;
  chatState.groupCall.localStream?.getVideoTracks?.().forEach((track) => {
    track.enabled = !chatState.groupCall.videoOff;
  });
  broadcastGroupCallState();
  renderGroupCallStage();
}
