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
   Which way the media goes: direct when it holds, a relay path when it does
   not, and a TURN both ends can reach for exactly as long as it is needed.
   ============================================================================

   Measured between the Finland and Iran servers on 2026-10-10: a UDP flow
   that a machine inside Iran STARTS towards a foreign address is cut after
   seven to nine packets, while a flow started from outside survives in both
   directions. Two consequences follow, and this file answers both.

   1. A direct path between somebody in Iran and somebody abroad can connect —
      the first packets go through, ICE reports success — and then die a
      second later. ICE alone does not know that, so the call drops or ICE
      restarts onto the same doomed path. Here the selected pair is read on
      every quality sample; a direct path that disconnects or stays bad is
      replaced by an ICE restart with `iceTransportPolicy: 'relay'` on both
      ends, and the contact is remembered (for a day) so the next call starts
      on a relay path instead of rediscovering the failure.

   2. Each client only ever had its own relay's TURN. A relayed candidate on
      the Finland TURN paired with one on the Iran TURN is a server-to-server
      flow the Iranian side starts — the doomed kind — and every attempt of
      that pairing failed. For a connection across relays the contact's relay
      is now asked for a short-lived credential (turn-query) and its TURN is
      added to THIS connection only: both ends can then meet on one TURN, which
      the measurement showed works. The profile keeps the device's own TURN;
      the borrowed one is gone with the call or the transfer.

   ICE still makes the choice among what it is given — host and reflexive
   candidates are preferred by priority, so a working direct path is used
   whenever one exists. What this file adds is the judgement ICE does not
   have: whether the path it chose keeps working.
   ============================================================================ */

const DIRECT_FAILURE_MEMORY_MS = 24 * 60 * 60 * 1000;
const DIRECT_BAD_SAMPLES = 3;

function pathMemory() {
  chatState.prefs = chatState.prefs || {};
  if (!chatState.prefs.pathChoices || typeof chatState.prefs.pathChoices !== 'object') chatState.prefs.pathChoices = {};
  return chatState.prefs.pathChoices;
}

function directRecentlyFailed(fingerprint) {
  const entry = pathMemory()[String(fingerprint || '')];
  return Boolean(entry?.directFailedAt && Date.now() - entry.directFailedAt < DIRECT_FAILURE_MEMORY_MS);
}

function noteDirectPath(fingerprint, worked) {
  if (!fingerprint) return;
  const memory = pathMemory();
  const entry = memory[fingerprint] || {};
  if (worked) {
    /* A direct path that held for a whole call clears the memory of one that
       did not: networks change, and a relay path is the slower choice. */
    delete entry.directFailedAt;
    entry.directWorkedAt = Date.now();
  } else {
    entry.directFailedAt = Date.now();
  }
  memory[fingerprint] = entry;
  const keys = Object.keys(memory);
  if (keys.length > 60) {
    keys.sort((a, b) => (memory[a].directFailedAt || memory[a].directWorkedAt || 0)
      - (memory[b].directFailedAt || memory[b].directWorkedAt || 0))
      .slice(0, keys.length - 60).forEach((key) => { delete memory[key]; });
  }
  if (typeof saveChatPrefs === 'function') saveChatPrefs();
}

/* Whether forcing a relay path can produce any candidate at all: with no TURN
   configured it would leave the connection with nothing to try. */
function configHasTurn(config) {
  return (config?.iceServers || []).some((server) => {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
    return urls.some((url) => /^turns?:/i.test(String(url || ''))) && server.username && server.credential;
  });
}

/* ---- credentials that expire --------------------------------------------- */

/* A relay with TURN REST hands out credentials that expire. They are fetched
   again before they are needed rather than after a call has failed with them:
   ten minutes of margin, and the fetch is one small request. */
let turnRefreshInFlight = null;
async function ensureFreshTurnCredentials() {
  if (typeof turnConfigIsUserOwned === 'function' && turnConfigIsUserOwned()) return;
  const expiresAt = Number(chatState.profile?.turnExpiresAt || 0);
  const missing = !chatState.profile?.turnUsername || !chatState.profile?.turnCredential;
  /* A pair with no expiry is either a relay without TURN REST or a pair
     fetched before the relay moved to it — and after that move the old static
     pair is refused by coturn. Checked again every half hour, so a migrated
     relay's clients pick up working credentials at their next call. */
  const staleStatic = !expiresAt && Date.now() - Number(chatState.profile?.turnCheckedAt || 0) > 30 * 60 * 1000;
  if (!missing && !staleStatic && (!expiresAt || expiresAt - Date.now() > 10 * 60 * 1000)) return;
  if (turnRefreshInFlight) return turnRefreshInFlight;
  turnRefreshInFlight = (async () => {
    try {
      const origin = chatServerOrigin();
      const response = await fetchRelayJson(new URL('/turn-config', origin), 4000);
      if (!response.ok) return;
      const config = await response.json();
      chatState.profile.turnCheckedAt = Date.now();
      if (config?.enabled && adoptRelayTurnConfig(config, origin)) {
        saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
      }
    } catch (_error) { /* the stored credentials are tried as they are */ }
    finally { turnRefreshInFlight = null; }
  })();
  return turnRefreshInFlight;
}

/* ---- the configuration for one connection -------------------------------- */

/* The RTCConfiguration a connection to this contact should start with: this
   device's own TURN and STUN, the contact's relay TURN when the connection
   crosses relays, ordered by what worked before, and relay-only when the
   direct path to this contact failed recently. Never written anywhere but the
   connection it is built for. */
async function buildIceConfigFor(peerRecord, { forceRelay = false } = {}) {
  await ensureFreshTurnCredentials();
  let config;
  try {
    config = { ...peerOptions().config };
  } catch (_error) {
    config = { iceServers: [] };
  }
  const servers = Array.isArray(config.iceServers) ? config.iceServers.slice() : [];
  if (peerRecord && typeof transitRouteFor === 'function' && transitRouteFor(peerRecord)
    && typeof turnServersForContact === 'function') {
    const far = await turnServersForContact(peerRecord).catch(() => null);
    if (far) servers.push(far);
  }
  config.iceServers = typeof orderIceServersFor === 'function'
    ? orderIceServersFor(peerRecord?.fingerprint, servers)
    : servers;
  /* Behind a proxy, media must not take a direct UDP path the proxy cannot
     carry (53-native-proxy.js). */
  const relayOnly = forceRelay || directRecentlyFailed(peerRecord?.fingerprint);
  if (relayOnly && configHasTurn(config)) config.iceTransportPolicy = 'relay';
  /* Behind a proxy it is relay-only whether or not there is a TURN to relay
     through: without one the connection fails, which is better than a
     direct path that shows this device's address (53-native-proxy.js). */
  if (chatState.nativeProxyActive) config.iceTransportPolicy = 'relay';
  return config;
}

/* The PeerJS peer object reads one shared configuration for every call. For a
   same-relay call there is no far TURN to add, but the direct-path memory
   applies all the same. */
function applyPathPolicyToPeerOptions(peerRecord) {
  const config = chatState.peer?.options?.config;
  if (!config) return;
  const relayOnly = (directRecentlyFailed(peerRecord?.fingerprint) && configHasTurn(config))
    || Boolean(chatState.nativeProxyActive);
  if (relayOnly) config.iceTransportPolicy = 'relay';
  else delete config.iceTransportPolicy;
}

/* ---- watching the path a call actually took ------------------------------ */

const callPathState = new WeakMap();

/* Called on every quality sample (see adaptCallRoute). */
function watchCallPath(pc, reading, peerRecord) {
  if (!pc || !reading) return;
  const state = callPathState.get(pc) || { bad: 0, escalated: false, directSince: 0 };
  callPathState.set(pc, state);
  state.route = reading.route || state.route || '';
  if (reading.route !== 'direct') { state.bad = 0; state.directSince = 0; return; }
  if (!state.directSince) state.directSince = Date.now();
  const level = typeof callQualityLevel === 'function' ? callQualityLevel(reading) : 'unknown';
  state.bad = level === 'bad' ? state.bad + 1 : 0;
  /* Half a minute of a good direct path is a direct path that works. */
  if (level === 'good' && Date.now() - state.directSince > 30000 && !state.notedGood) {
    state.notedGood = true;
    noteDirectPath(peerRecord?.fingerprint, true);
  }
  if (state.bad >= DIRECT_BAD_SAMPLES && !state.escalated) {
    escalateCallToRelay(pc, peerRecord, 'the direct path stayed poor');
  }
}

function lastCallRoute(pc) {
  return callPathState.get(pc)?.route || '';
}

/* Moves a call onto a relay path. The caller drives every ICE restart (two
   offers at once would collide), so the callee asks the caller to do it. */
function escalateCallToRelay(pc, peerRecord, reason) {
  if (!pc) return false;
  const state = callPathState.get(pc) || {};
  if (state.escalated) return false;
  let config;
  try { config = pc.getConfiguration(); } catch (_error) { return false; }
  if (!configHasTurn(config)) return false;
  state.escalated = true;
  callPathState.set(pc, state);
  noteDirectPath(peerRecord?.fingerprint, false);
  console.warn(`[Path] moving the call to a relay path: ${reason}`);
  if ((chatState.currentCallDirection || 'out') !== 'out') {
    const target = peerRecord || activeCallPeerRecord?.();
    if (target) {
      sendRelayEnvelope(target, { type: 'call-path-relay', peerId: chatState.peerId, reason: String(reason).slice(0, 80) });
    }
    return true;
  }
  try {
    pc.setConfiguration({ ...config, iceTransportPolicy: 'relay' });
  } catch (error) {
    console.warn('[Path] the relay policy could not be applied:', error?.message || error);
    return false;
  }
  chatState.iceRestartAttempt = Math.max(chatState.iceRestartAttempt || 0, 1);
  if (typeof sendIceRestartOffer === 'function') sendIceRestartOffer(pc, { forceRelay: true });
  if (typeof setCallStatusText === 'function') {
    setCallStatusText(t('مسیر مستقیم ناپایدار بود؛ تماس از مسیر رله ادامه می‌یابد…', 'The direct path was unstable; moving the call to a relay path…'));
  }
  return true;
}

/* The callee asked: the direct path is failing on its side. */
function handleCallPathRelayRequest(payload, message) {
  if (typeof isCallSignalFromActivePeer === 'function' && !isCallSignalFromActivePeer(payload, message)) return;
  const pc = chatState.currentCall?.peerConnection;
  if (!pc || (chatState.currentCallDirection || 'out') !== 'out') return;
  const state = callPathState.get(pc) || {};
  state.escalated = false;
  callPathState.set(pc, state);
  escalateCallToRelay(pc, activeCallPeerRecord?.(), payload?.reason || 'the other side asked');
}

window.buildIceConfigFor = buildIceConfigFor;
window.ensureFreshTurnCredentials = ensureFreshTurnCredentials;
