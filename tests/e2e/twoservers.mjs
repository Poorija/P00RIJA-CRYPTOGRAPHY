/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Two independent deployments, one conversation across them.
 *
 * Every other suite opens both browsers on ONE origin, which is exactly the
 * case where nothing has to cross a relay: the two clients share a signalling
 * server, so they reach each other directly and transit is never exercised.
 * This one opens each browser on a DIFFERENT deployment. That changes what is
 * being tested in a way worth spelling out, because it is the part that was
 * previously only asserted about functions:
 *
 *   - the two clients cannot see each other in presence, because a relay only
 *     ever hands out its own clients;
 *   - they cannot reach each other over PeerJS either, because a PeerJS id only
 *     means something on the server that issued it;
 *
 * so a message between them has exactly one road: the sender seals it to the
 * RECIPIENT'S relay, hands it to its own, and the two relays carry it over the
 * link between them. If that road is broken, nothing arrives at all -- which is
 * why this suite is the only honest test of it.
 *
 *   PKG_URL_A / RELAY_URL_A   the first deployment  (defaults to Finland)
 *   PKG_URL_B / RELAY_URL_B   the second deployment (defaults to Iran)
 *
 * It sends real messages between real servers. Nothing here writes to a
 * mailbox it does not then read back, and the two identities are created fresh
 * in throwaway browser profiles, so a run leaves two queued envelopes behind at
 * most and they expire on their own.
 */

import https from 'node:https';
import { openApp, browser, identity, importIdentity, openFirstChat, waitFor } from './_chat-harness.mjs';

/* No default that names anybody's server. Two deployments are a thing only the
   operator has, so the suite is told where they are and says so plainly when it
   is not, rather than shipping one person's hostnames in a public repository. */
const A_APP = process.env.PKG_URL_A || '';
const B_APP = process.env.PKG_URL_B || '';
if (!A_APP || !B_APP) {
  console.log('\n  This suite needs two deployments. Point it at them:\n');
  console.log('      PKG_URL_A=https://first.example.com:8585 \\');
  console.log('      PKG_URL_B=https://second.example.com:8585 \\');
  console.log('        node tests/e2e/twoservers.mjs\n');
  console.log('  RELAY_URL_A and RELAY_URL_B default to the same origins.\n');
  process.exit(2);
}
const A_RELAY = process.env.RELAY_URL_A || A_APP;
const B_RELAY = process.env.RELAY_URL_B || B_APP;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);

/* node:https rather than fetch, and rejectUnauthorized off.
 *
 * Not a shortcut: a deployment that has not had its certificate installed yet
 * is still a deployment worth testing, and Node's fetch has no per-call way to
 * accept one. The browsers above are already opened with ignoreHTTPSErrors for
 * the same reason. What this suite is checking is the road between two relays;
 * whether the operator has finished with certbot is a different question, and
 * failing here would hide every answer to the first one behind the second.
 *
 * The relays' own link does NOT get this treatment -- see
 * CHAT_TRANSIT_INSECURE_TLS in docker-compose.yaml, which stays off. */
const health = (origin) => new Promise((resolve, reject) => {
  const url = new URL('/chat-health', origin);
  const request = https.get({
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname,
    rejectUnauthorized: false,
    timeout: 20000,
  }, (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`${origin} answered ${response.statusCode}: ${body.slice(0, 120)}`)); }
    });
  });
  request.on('timeout', () => request.destroy(new Error(`${origin} did not answer in 20s`)));
  request.on('error', reject);
});

/* What the app itself believes, read out of its own state rather than inferred
   from the interface. The pin is what the client recomputed and stored, so it
   is the answer to "did this client verify the relay it is talking to", not
   "what did the relay claim". */
/* Everything here goes through a FUNCTION, never through window.chatState.
 *
 * chatState is declared `const` at the top level of a classic script, and a
 * top-level const is not a property of window -- only `var` and function
 * declarations are. So window.chatState reads undefined, and a probe written
 * against it reports an app with no contacts and no open conversation while the
 * app in front of it is working normally. That cost two runs of this suite:
 * messages crossed both relays and the checks above them said the contact had
 * never been created. */
const relayFacts = (page) => page.evaluate(() => {
  const origin = window.chatServerOrigin?.() || '';
  const pin = window.relayPinFor?.(origin) || null;
  return {
    origin,
    pinnedId: pin?.id || '',
    peerId: (document.getElementById('chatPeerId')?.textContent || '').trim(),
    myHomeRelayId: window.myHomeRelay?.()?.id || '',
  };
});

/* The home relay this client has recorded FOR A CONTACT, and how much it trusts
   the claim. Anything below `session` is not routable on purpose: a hello is
   not an address. */
/* findPeerByAnyKey is the app's own lookup and it is a function declaration, so
   it is reachable. The fingerprint comes from the card the other side produced,
   which is the only identifier this suite has that both ends agree on. */
const contactRelay = (page, fingerprint) => page.evaluate((needle) => {
  const contact = window.findPeerByAnyKey?.(needle) || null;
  return {
    found: Boolean(contact),
    name: contact?.name || contact?.username || '',
    homeRelayId: contact?.homeRelay?.id || '',
    /* The rank lives INSIDE the relay record, put there by
       normalizeHomeRelay; the record's own homeRelaySource is only the input. */
    homeRelaySource: contact?.homeRelay?.source || contact?.homeRelaySource || '',
    hasKey: Boolean(contact?.homeRelay?.key),
    routable: Boolean(contact && window.routableHomeRelay?.(contact)),
    /* Whether a message to them would take the carrier road at all. This is the
       question the send path asks, so it is the one worth reporting. */
    overTransit: Boolean(contact && window.transitRouteFor?.(contact)),
  };
}, fingerprint);

/* The fingerprint out of an identity card, so the probe above has something to
   look up. */
const fingerprintOf = (card) => {
  const body = String(card || '').split(':').slice(1).join(':');
  try { return JSON.parse(decodeURIComponent(escape(atob(body)))).fingerprint || ''; } catch (_error) { return ''; }
};

/* #chatComposer IS the field, and Enter is what sends. There is no separate
   send button to click; the ids guessed at first do not exist, which made a
   failure to type look like a failure to deliver. */
const sendMessage = async (page, text) => {
  await page.fill('#chatComposer', text);
  await page.press('#chatComposer', 'Enter');
};

const messagesOn = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#chatMessages .chat-message-bubble'))
  .map((node) => (node.textContent || '').trim())
  .filter(Boolean));

try {
  section('two deployments, each answering for itself');
  const [healthA, healthB] = await Promise.all([health(A_APP), health(B_APP)]);
  check('the first deployment answers its health check', healthA.ok === true, `${healthA.version}-${healthA.buildTag}`);
  check('the second deployment answers its health check', healthB.ok === true, `${healthB.version}-${healthB.buildTag}`);
  check('both serve the same build', `${healthA.version}-${healthA.buildTag}` === `${healthB.version}-${healthB.buildTag}`,
    `${healthA.version}-${healthA.buildTag} vs ${healthB.version}-${healthB.buildTag}`);
  check('they are two different relays, not one behind two names',
    Boolean(healthA.relayId) && healthA.relayId !== healthB.relayId,
    `${String(healthA.relayId).slice(0, 12)}… vs ${String(healthB.relayId).slice(0, 12)}…`);
  check('each one runs its own TURN server', healthA.turnEnabled === true && healthB.turnEnabled === true,
    `${healthA.turnEnabled} / ${healthB.turnEnabled}`);
  check('each one has its own presence socket', healthA.presenceUrl !== healthB.presenceUrl,
    `${healthA.presenceUrl} / ${healthB.presenceUrl}`);

  section('the link between them');
  check('the first has transit enabled and a link up', healthA.transit?.enabled === true && healthA.transit?.up >= 1,
    JSON.stringify(healthA.transit));
  check('so does the second', healthB.transit?.enabled === true && healthB.transit?.up >= 1,
    JSON.stringify(healthB.transit));
  check('each allows exactly the other', healthA.transit?.allowed === 1 && healthB.transit?.allowed === 1,
    `${healthA.transit?.allowed} / ${healthB.transit?.allowed}`);

  section('a client on each');
  const a = await openApp('north', { origin: A_APP, relay: A_RELAY });
  const b = await openApp('south', { origin: B_APP, relay: B_RELAY });
  /* The relay pin is fetched asynchronously after the WebSocket connects, and
   * against real servers with real latency the 5.5s inside openApp is not
   * always enough. Without the pin the identity card carries an empty relay,
   * and every check below that depends on routing falls like dominoes. Wait
   * for both to have pinned before reading anything. */
  await waitFor(a, () => Boolean(window.relayPinFor?.(window.chatServerOrigin?.())?.id), { timeoutMs: 45000 });
  await waitFor(b, () => Boolean(window.relayPinFor?.(window.chatServerOrigin?.())?.id), { timeoutMs: 45000 });
  const factsA = await relayFacts(a);
  const factsB = await relayFacts(b);
  check('the first client got a peer id from its own relay', factsA.peerId.length > 8, factsA.peerId.slice(0, 16));
  check('the second client got one from the other relay', factsB.peerId.length > 8, factsB.peerId.slice(0, 16));
  check('the first client pinned the relay it is actually talking to', factsA.pinnedId === healthA.relayId,
    `${factsA.pinnedId.slice(0, 12)}… vs ${String(healthA.relayId).slice(0, 12)}…`);
  check('the second client pinned its own, which is a different one', factsB.pinnedId === healthB.relayId && factsB.pinnedId !== factsA.pinnedId,
    `${factsB.pinnedId.slice(0, 12)}…`);

  section('one of them is given the other\'s card, which is how it really happens');
  /* ONE card, in one direction.
   *
   * Importing both was the comfortable version and it hid the fault that
   * matters: with two cards both sides hold a `card`-ranked home relay, so the
   * return route is never needed and every direction works. In life one person
   * sends their code and the other scans it, and the second person has to learn
   * where to write back from the first message itself.
   *
   * That is the path that was broken. The return route travelled only in the
   * prekey envelope, and the prekey travels with presence -- which a relay
   * broadcasts to its own clients and nobody else's -- so for a cross-relay pair
   * there was never a prekey, never an envelope to carry it, and never a reply. */
  /* BOTH cards are read first, while each page is still idle, and only one of
     them is then imported.
   *
   * identity() drives copyChatFullIdentity through page.evaluate and that has no
   * timeout of its own, so asking for a card on a page that is in the middle of
   * adding a contact -- reserving an offline session, opening a modal -- hangs
   * the suite outright rather than failing it. Reading A's card before anything
   * is imported costs nothing and removes the only unbounded wait here. */
  const cardA = await identity(a);
  const cardB = await identity(b);
  check('an identity card was produced', Boolean(cardA) && Boolean(cardB),
    `${(cardA || '').length} / ${(cardB || '').length} chars`);
  await importIdentity(a, cardB);
  /* Waiting on the contact appearing rather than on a fixed delay. The modal is
     built on open and filled by script; over a link to a remote server that
     takes longer than it does against localhost, and a fixed wait turned "not
     yet" into "never". */
  /* Read from the cards taken above. There is no window-reachable accessor for a
     fingerprint: chatState is a top-level const. */
  const fpA = fingerprintOf(cardA);
  const fpB = fingerprintOf(cardB);
  await waitFor(a, (needle) => Boolean(window.findPeerByAnyKey?.(needle)), { timeoutMs: 30000, arg: fpB });
  await a.waitForTimeout(1500);
  await b.waitForTimeout(1500);

  const seenByA = await contactRelay(a, fpB);
  check('the card became a contact', seenByA?.found === true, JSON.stringify(seenByA));
  check('the one who scanned knows where the other lives', seenByA?.homeRelayId === healthB.relayId,
    `${(seenByA?.homeRelayId || '(none)').slice(0, 12)}… from ${seenByA?.homeRelaySource || '(none)'}`);
  check('and it came with a key, without which nothing can be sealed to it', seenByA?.hasKey === true);
  check('so that route is one the client will actually use', seenByA?.routable === true);
  check('and the send path agrees a message to them needs the carrier', seenByA?.overTransit === true);
  /* The other side knows nothing yet, and should not: nobody gave it a card. */
  const seenByBFirst = await contactRelay(b, fpA);
  check('while the other side has no routable way back yet', seenByBFirst?.routable !== true,
    JSON.stringify(seenByBFirst));

  section('a message with only one road to travel');
  /* Opened by fingerprint rather than by clicking the first card.
   *
   * openFirstChat clicks whatever card is rendered first, and on the side that
   * was never handed a card there may be nothing rendered yet -- the contact
   * arrives with the session offer the relay held, which is a race. The app has
   * its own opener and it is a function declaration, so it is reachable. */
  const openWith = async (page, fingerprint) => {
    await waitFor(page, (needle) => Boolean(window.findPeerByAnyKey?.(needle)), { timeoutMs: 45000, arg: fingerprint });
    await page.evaluate((needle) => window.openConversationWithFingerprint?.(needle), fingerprint);
    await page.waitForSelector('#chatComposer', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(800);
  };
  await openWith(a, fpB);
  await openWith(b, fpA);
  /* Whether the conversation is even open is asked first, and separately.
     "nothing arrived" and "nothing was sent" look identical from the receiving
     end, and they are different faults: one is the road, the other is the
     composer. */
  const composerA = await a.evaluate(() => {
    const field = document.querySelector('#chatComposer');
    const peer = window.activePeer?.() || null;
    return {
      field: Boolean(field),
      usable: Boolean(field) && !field.disabled,
      openWith: peer?.fingerprint ? `${peer.fingerprint.slice(0, 12)}…` : '',
    };
  });
  check('the first client has a conversation open to type into', composerA.field && composerA.usable && Boolean(composerA.openWith),
    JSON.stringify(composerA));

  const beforeB = (await messagesOn(b)).length;
  const marker = `transit-north-${Date.now()}`;
  await sendMessage(a, marker);
  const leftTheSender = await waitFor(a, (needle) => Array.from(document.querySelectorAll('#chatMessages .chat-message-bubble'))
    .some((node) => (node.textContent || '').includes(needle)), { timeoutMs: 20000, arg: marker });
  check('the message appeared on the sender, so it was actually sent', leftTheSender === true);
  const arrivedAtB = await waitFor(b, (needle) => Array.from(document.querySelectorAll('#chatMessages .chat-message-bubble'))
    .some((node) => (node.textContent || '').includes(needle)), { timeoutMs: 60000, arg: marker });
  check('a message from the first deployment reached the second', arrivedAtB === true,
    arrivedAtB ? '' : `bubbles went ${beforeB} -> ${(await messagesOn(b)).length}`);

  /* The first message is what teaches the other side where to write back. */
  const learned = await waitFor(b, (needle) => {
    const contact = window.findPeerByAnyKey?.(needle);
    return Boolean(contact && window.routableHomeRelay?.(contact));
  }, { timeoutMs: 30000, arg: fpA });
  check('receiving it taught the other side where to write back', learned === true,
    JSON.stringify(await contactRelay(b, fpA)));

  const marker2 = `transit-south-${Date.now()}`;
  await sendMessage(b, marker2);
  const arrivedAtA = await waitFor(a, (needle) => Array.from(document.querySelectorAll('#chatMessages .chat-message-bubble'))
    .some((node) => (node.textContent || '').includes(needle)), { timeoutMs: 60000, arg: marker2 });
  check('and the reply came back the other way', arrivedAtA === true);

  section('whether the other side is shown as being there');
  /* Presence is per relay: a relay hands every one of ITS clients to every other
     one and knows nothing about anybody else's. So a contact on the far side was
     shown offline for ever -- not because they were, but because nobody asked.
     The question now goes sealed to THEIR relay, carried by ours, which cannot
     read it, and the far relay answers for that one fingerprint.

     Both clients are open here, so the honest answer is "online"; the check that
     matters is that an answer arrives at all and is written onto the record. */
  /* peerLooksOnline, not `status`. The far relay's answer deliberately does NOT
     go into status: in this application that field means "you can reach them
     from here", and writing a presence answer into it made the app open a direct
     PeerJS channel to an id that only exists on the other server. The dot reads
     the new field; nothing that routes does. */
  const shownOnline = await waitFor(a, (needle) => {
    const contact = window.findPeerByAnyKey?.(needle);
    return Boolean(contact) && window.peerLooksOnline?.(contact) === true;
  }, { timeoutMs: 60000, arg: fpB });
  check('a contact on the other relay is shown as being there', shownOnline === true,
    await a.evaluate((needle) => {
      const contact = window.findPeerByAnyKey?.(needle);
      return contact ? `status=${contact.status} remote=${contact.remotePresence || '-'}` : '(no record)';
    }, fpB));

  /* The status must then STAY. Every peers broadcast from our own relay marks
     everybody it did not mention offline, and it never mentions somebody on
     another relay -- so this used to flip back within a second or two and the
     contact flickered, mostly offline, because the broadcast arrives far more
     often than the question is asked. */
  /* A third client joins the FIRST relay, which makes that relay broadcast its
     peer list to everyone on it -- the real event, not a simulated one. There is
     no way to ask for the list from the page: chatState is a top-level const, so
     its socket is not reachable from outside. */
  const bystander = await openApp('bystander', { origin: A_APP, relay: A_RELAY });
  await a.waitForTimeout(7000);
  const stayedOnline = await a.evaluate((needle) => {
    const contact = window.findPeerByAnyKey?.(needle);
    return contact ? { looks: window.peerLooksOnline?.(contact) === true, remote: contact.remotePresence || '' } : null;
  }, fpB);
  check('and a broadcast from our own relay does not knock it back offline',
    stayedOnline?.looks === true, JSON.stringify(stayedOnline));
  /* The third client has done its job -- it existed to make the first relay
     broadcast -- and a browser left open until the end of the suite competes for
     the machine with the call that follows. */
  await bystander.close();

  /* What a contact on another relay looks like is NOT asserted here, and the
   * reason is worth writing down rather than leaving as a gap.
   *
   * The card that carries a display name, a photograph and a mood to somebody on
   * another relay is sent from saveProfile, and that was verified directly at the
   * call site rather than through the interface: with the page open,
   * announceProfileToFarContacts is a function and the save button calls it
   * exactly once. That the card itself crosses was verified separately -- a card
   * sent from one deployment arrived at the other and merged onto the contact.
   *
   * What could not be driven from here is the CHANGE. #chatDisplayName is built
   * when the chat settings pane is opened and is gone again afterwards, so a test
   * that sets it blind sets an element that is not in the document:
   * buildProfileDraft reads nothing, saveProfile saves the profile it already had,
   * and the announcement that follows carries no change. Three runs reported a
   * red check against working code before that was understood, and switchTab plus
   * a twenty-second wait did not bring the field back.
   *
   * A check that cannot reach the thing it measures is not a check. Reaching it
   * needs the settings pane driven properly, which is its own piece of work; what
   * is not acceptable is a green line that proves nothing. */

  section('the ticks, which route the same way a reply does');
  /* A receipt is a relay envelope like any other, so it takes the same road and
     fails for the same reason a reply fails. Reading them is how "it arrived but
     the sender never knew" is told apart from "it never arrived". */
  const lastTick = (page) => page.evaluate(() => {
    const el = [...document.querySelectorAll('#chatMessages [data-chat-message-status]')].pop();
    return el ? { label: el.textContent.trim(), cls: [...el.classList].filter((c) => c.startsWith('is-')).join(' ') } : null;
  });
  /* is-seen counts, and usually IS what arrives: the other page has the thread
     open, so the read receipt follows the delivery receipt closely enough that
     the delivered state is gone before it can be sampled. The class list is
     is-seen / is-delivered / is-sent / is-relayed / is-queued / is-failed, and
     what is being asked here is whether a receipt crossed two relays at all --
     is-relayed is the state the sender reaches on its own, so it does not. */
  const ticked = await waitFor(a, () => {
    const el = [...document.querySelectorAll('#chatMessages [data-chat-message-status]')].pop();
    return Boolean(el && (el.classList.contains('is-delivered') || el.classList.contains('is-seen')));
  }, { timeoutMs: 60000 });
  check('a receipt came back across the two relays', ticked === true,
    JSON.stringify(await lastTick(a)));

  section('what the sender is left believing');
  const senderState = await a.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll('#chatMessages .chat-message-bubble.me'));
    const last = bubbles.at(-1);
    return {
      bubbles: bubbles.length,
      stuck: bubbles.filter((node) => (node.className || '').includes('sending')).length,
      notes: Array.from(document.querySelectorAll('#chatMessages .chat-system-note')).map((n) => (n.textContent || '').trim()).slice(-3),
      lastClass: last?.className || '',
    };
  });
  check('nothing is left claiming to still be sending', senderState.stuck === 0, `${senderState.stuck} stuck`);
  check('the sender was not told the message failed',
    !senderState.notes.some((note) => /fail|could not|error/i.test(note)),
    senderState.notes.join(' | ') || '(no system notes)');

  section('a call whose two ends are on different relays');
  /* The thing that could not happen before this: chatState.peer.call() addresses
     a PeerJS id, and a PeerJS id only means something on the server that issued
     it. The ring always crossed -- call-invite is a relay envelope -- so the
     failure looked like a call that rang and then gave up. */
  const relayCallReady = await a.evaluate((needle) => {
    const contact = window.findPeerByAnyKey?.(needle) || null;
    return {
      moduleLoaded: typeof window.placeRelayCall === 'function'
        && typeof window.handleRelayCallSignal === 'function',
      wouldUseRelay: Boolean(contact && window.callNeedsRelay?.(contact)),
    };
  }, fpB);
  check('the relay-call path is present in the served build', relayCallReady.moduleLoaded === true,
    JSON.stringify(relayCallReady));
  check('and a call to this contact is one it would take', relayCallReady.wouldUseRelay === true);

  await a.evaluate(() => { window.__relayCallErrors = []; window.addEventListener('error', (e) => window.__relayCallErrors.push(String(e.message))); });
  await a.evaluate(() => window.startCall?.('voice'));
  /* The callee's incoming screen is the honest signal that the offer crossed two
     relays and was read: it is only raised once setRemoteDescription succeeded. */
  const rang = await waitFor(b, () => {
    const visible = (el) => Boolean(el) && el.offsetParent !== null;
    return visible(document.getElementById('chatAcceptCallBtn'))
      || visible(document.getElementById('chatModalAcceptBtn'));
  }, { timeoutMs: 60000 });
  check('the offer crossed both relays and the other side rang', rang === true);

  if (rang) {
    await b.evaluate(() => {
      const button = document.getElementById('chatAcceptCallBtn') || document.getElementById('chatModalAcceptBtn');
      button?.click();
    });
    /* Media arriving is what is asked, not an ICE state.
     *
     * There is no window-reachable handle on the live peer connection -- the call
     * lives in chatState, which is a top-level const -- so the honest signal is
     * the one the user sees: attachRemoteStream puts the remote tracks on
     * #chatRemoteVideo, and the interface only reaches that line from the call's
     * own 'stream' event. A srcObject with a live track means the two browsers
     * negotiated and media is flowing, directly or through one of the two TURN
     * servers; neither relay carries any of it. */
    const gotMedia = await waitFor(a, () => {
      const video = document.getElementById('chatRemoteVideo')
        || document.getElementById('chatFloatingRemoteVideo');
      const tracks = video?.srcObject?.getTracks?.() || [];
      return tracks.some((track) => track.readyState === 'live');
    }, { timeoutMs: 90000 });
    check('and media arrived on the caller from the other deployment', gotMedia === true);
    const mediaOnB = await b.evaluate(() => {
      const video = document.getElementById('chatRemoteVideo')
        || document.getElementById('chatFloatingRemoteVideo');
      return (video?.srcObject?.getTracks?.() || []).map((track) => `${track.kind}:${track.readyState}`);
    });
    check('and on the person who answered', mediaOnB.some((entry) => entry.endsWith(':live')), mediaOnB.join(' '));
    /* Defaults, which is what the hang-up button passes. closePeer:false is the
       OTHER ending -- the one where the far side closed the call and this side is
       only cleaning up -- and on that path the interface deliberately does not
       close the call object, so nothing tells the other end. Passing it here
       tested a hang-up that never happened. */
    await a.evaluate(() => window.endCurrentCall?.());
    await a.waitForTimeout(2000);
    const cleared = await a.evaluate(() => {
      const video = document.getElementById('chatRemoteVideo');
      const tracks = video?.srcObject?.getTracks?.() || [];
      return tracks.every((track) => track.readyState === 'ended') || tracks.length === 0;
    });
    check('hanging up let go of the remote tracks rather than leaking them', cleared === true);
    const otherSideSawIt = await waitFor(b, () => {
      const video = document.getElementById('chatRemoteVideo');
      const tracks = video?.srcObject?.getTracks?.() || [];
      return tracks.every((track) => track.readyState === 'ended') || tracks.length === 0;
    }, { timeoutMs: 30000 });
    check('and the other side was told, rather than waiting for a timeout', otherSideSawIt === true);
  }

  section('no script threw on either side');
  check('the first client logged no page errors', (a.__errors || []).length === 0, (a.__errors || []).join(' | '));
  check('the second client logged no page errors', (b.__errors || []).length === 0, (b.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.message || String(error));
} finally {
  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`\n===== ${failed} failed of ${results.length} =====\n`);
  await browser.close();
  process.exitCode = failed > 0 ? 1 : 0;
}
