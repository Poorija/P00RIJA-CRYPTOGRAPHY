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
   Smart relay choice: the best home relay of the family, measured from here
   ============================================================================

   The app measures the relays of its operator's signed family from the
   person's own device — how fast each answers, how steadily, how quickly it
   sends a block of bytes, and how full it says it is — and keeps the person's
   home on the best one that is not full. A new account picks its best home at
   once. An existing one moves only when another relay has been clearly better
   on several days, or when home is very full, and never twice within a month.
   The move is the signed home move of guest mode: the mailbox is handed over,
   contacts learn the new address by themselves, other devices follow.

   The person chooses: Automatic (default — the app moves by itself and says so
   afterwards), Suggest (it offers the move with its reasons), or Off (nothing,
   after a warning). With one relay in the family none of this shows.
   ============================================================================ */

const CHOICE_DEFAULTS = {
  sampleGapMs: 300,
  sampleTimeoutMs: 4000,
  backgroundMs: 6 * 60 * 60 * 1000,
  minGapMs: 60 * 60 * 1000,
  speedEveryMs: 24 * 60 * 60 * 1000,
  dayMs: 24 * 60 * 60 * 1000,
  moveGapMs: 30 * 24 * 60 * 60 * 1000,
  remindMs: 7 * 24 * 60 * 60 * 1000,
  declineMs: 30 * 24 * 60 * 60 * 1000,
  tickMs: 60 * 1000,
};
const CHOICE_SAMPLES = 5;
const CHOICE_KEEP = 12;
const CHOICE_SPEED_BYTES = 262144;
const CHOICE_WEIGHTS = { stability: 0.5, latency: 0.3, speed: 0.2 };
const CHOICE_FULL = 0.8;
const CHOICE_BUSY = 0.6;
const CHOICE_HOME_FULL = 0.85;
const CHOICE_BETTER = 1.3;
const CHOICE_BETTER_DAYS = 3;
const CHOICE_NEW_BETTER = 1.15;

function relayChoiceTiming(name) {
  const override = Number(window.__POORIJA_CHOICE_TIMINGS__?.[name]);
  return Number.isFinite(override) && override > 0 ? override : CHOICE_DEFAULTS[name];
}

const choiceMedian = (values) => {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return NaN;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
};

/* Scores from kept measurements. Steadiness counts most, then how fast a relay
   answers (with how much that varies), then how fast it sends; a relay that is
   80% full is not chosen at all, and one 60–80% full counts for less. */
function scoreRelays(measurements, { homeId = '', homeDropsPerDay = 0 } = {}) {
  const facts = {};
  for (const [id, samples] of Object.entries(measurements || {})) {
    const kept = (Array.isArray(samples) ? samples : []).slice(-CHOICE_KEEP);
    if (!kept.length) continue;
    const answered = kept.filter((sample) => Number(sample.ok) > 0);
    let stability = kept.reduce((sum, sample) => sum + Math.max(0, Math.min(1, Number(sample.ok) || 0)), 0) / kept.length;
    if (id === homeId && homeDropsPerDay > 0) stability *= Math.max(0.5, 1 - homeDropsPerDay / 10);
    const latency = choiceMedian(answered.map((sample) => Number(sample.latency)));
    const spread = choiceMedian(answered.map((sample) => Number(sample.spread)));
    const kbps = choiceMedian(kept.map((sample) => (sample.kbps == null ? NaN : Number(sample.kbps))));
    const saturation = Number(kept[kept.length - 1].load) || 0;
    facts[id] = { stability, latency, spread, kbps, saturation };
  }
  const raw = (fact) => (Number.isFinite(fact.latency) ? 1 / (fact.latency + (Number.isFinite(fact.spread) ? fact.spread : 0) + 1) : 0);
  const bestRaw = Math.max(0, ...Object.values(facts).map(raw));
  const bestKbps = Math.max(0, ...Object.values(facts).map((fact) => (Number.isFinite(fact.kbps) ? fact.kbps : 0)));
  const scores = {};
  for (const [id, fact] of Object.entries(facts)) {
    const latencyScore = bestRaw > 0 ? raw(fact) / bestRaw : 0;
    const speed = Number.isFinite(fact.kbps) && bestKbps > 0 ? fact.kbps / bestKbps : 1;
    let score = CHOICE_WEIGHTS.stability * fact.stability + CHOICE_WEIGHTS.latency * latencyScore + CHOICE_WEIGHTS.speed * speed;
    if (fact.saturation >= CHOICE_BUSY && fact.saturation < CHOICE_FULL) score *= 1 - (fact.saturation - CHOICE_BUSY) * 2;
    scores[id] = {
      score, saturation: fact.saturation, latency: fact.latency, stability: fact.stability,
      speed: Number.isFinite(fact.kbps) ? fact.kbps : null, excluded: fact.saturation >= CHOICE_FULL,
    };
  }
  return scores;
}

/* Whether to move, and where. `history` holds each day's scores
   ({ [day]: { [id]: score } }); `latestSaturation` each relay's latest load
   readings, oldest first. */
function moveDecision(history, latestSaturation, { homeId, newAccount = false, lastMoveAt = 0, now = Date.now() } = {}) {
  if (!homeId) return null;
  if (lastMoveAt && now - lastMoveAt < relayChoiceTiming('moveGapMs')) return null;
  const loadOf = (id) => {
    const list = latestSaturation?.[id] || [];
    return list.length ? Number(list[list.length - 1]) || 0 : 0;
  };
  const days = Object.keys(history || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!days.length) return null;
  const latest = history[String(days[days.length - 1])] || {};
  const candidates = Object.keys(latest).filter((id) => id !== homeId && loadOf(id) < CHOICE_FULL);
  const byLatest = (a, b) => (latest[b] || 0) - (latest[a] || 0);
  if (newAccount) {
    const best = candidates.sort(byLatest)[0];
    if (best && (latest[homeId] || 0) > 0 && latest[best] >= latest[homeId] * CHOICE_NEW_BETTER) return { to: best, reason: 'new' };
    if (best && !(latest[homeId] > 0)) return { to: best, reason: 'new' };
    return null;
  }
  const lasting = candidates.filter((id) => days.filter((day) => {
    const scores = history[String(day)] || {};
    return scores[homeId] > 0 && scores[id] >= scores[homeId] * CHOICE_BETTER;
  }).length >= CHOICE_BETTER_DAYS).sort(byLatest);
  if (lasting.length) return { to: lasting[0], reason: 'better' };
  const homeLoads = (latestSaturation?.[homeId] || []).slice(-3);
  if (homeLoads.length === 3 && homeLoads.every((value) => Number(value) >= CHOICE_HOME_FULL)) {
    const quiet = candidates.filter((id) => loadOf(id) < CHOICE_BUSY).sort(byLatest)[0];
    if (quiet) return { to: quiet, reason: 'full' };
  }
  return null;
}

/* ---- measuring ---------------------------------------------------------------- */

const relayChoiceState = { running: false, lastWs: null, wasUp: false, promptOpen: false };

/* The family's relays that can be measured: listed, not revoked, with an
   address usable from here (https; plain http only on this machine). */
function choiceRelays() {
  const directory = typeof guestDirectory === 'function' ? guestDirectory() : null;
  if (!directory) return [];
  const revoked = new Set(directory.revoked || []);
  return (directory.relays || []).filter((relay) => relay?.id && !revoked.has(relay.id)
    && (relay.origins || []).some((origin) => typeof guestOriginUsable === 'function' && guestOriginUsable(origin)));
}

/* Two relays or more, and a home this device has pinned. */
function relayChoiceAvailable() {
  const homeId = relayPinFor(configuredRelayOrigin())?.id || '';
  const relays = choiceRelays();
  return Boolean(homeId) && relays.length >= 2 && relays.some((relay) => relay.id === homeId);
}

const choiceSleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

/* Five small requests: how fast, how much that varies, how many answered, and
   how full the relay says it is. */
async function lightSample(origin) {
  const times = [];
  let answered = 0;
  let load = 0;
  for (let n = 0; n < CHOICE_SAMPLES; n += 1) {
    const started = performance.now();
    const response = await fetchRelayJson(new URL('/chat-health', origin), relayChoiceTiming('sampleTimeoutMs'));
    if (response?.ok) {
      try {
        const body = await response.json();
        load = Math.max(0, Math.min(1, Number(body?.capacity?.saturation) || 0));
        answered += 1;
        times.push(performance.now() - started);
      } catch (_error) { /* not counted */ }
    }
    if (n < CHOICE_SAMPLES - 1) await choiceSleep(relayChoiceTiming('sampleGapMs'));
  }
  return {
    latency: times.length ? choiceMedian(times) : null,
    spread: times.length ? Math.max(...times) - Math.min(...times) : null,
    ok: answered / CHOICE_SAMPLES,
    load,
  };
}

/* One block of bytes, timed. */
async function speedSample(origin) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20000);
  try {
    const started = performance.now();
    const response = await fetch(new URL(`/relay-speed?bytes=${CHOICE_SPEED_BYTES}`, origin), { cache: 'no-store', mode: 'cors', signal: controller.signal });
    if (!response.ok) return null;
    const bytes = (await response.arrayBuffer()).byteLength;
    const seconds = Math.max(0.001, (performance.now() - started) / 1000);
    return Math.round((bytes * 8) / 1000 / seconds);
  } catch (_error) {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/* Measures every relay of the family from this device and keeps the result.
   Nothing is measured offline or during a guest stay, nor a relay that does
   not prove the key the list names; and when nothing at all answered, nothing
   is kept — that is this device's network, not the relays. */
async function measureRelays({ withSpeed = false } = {}) {
  if (relayChoiceState.running || !relayChoiceAvailable() || navigator.onLine === false) return {};
  if (typeof guestStayActive === 'function' && guestStayActive()) return {};
  relayChoiceState.running = true;
  try {
    const configured = configuredRelayOrigin();
    const homePin = relayPinFor(configured);
    const home = typeof guestHomeEntry === 'function' ? guestHomeEntry() : null;
    const speedAt = chatState.profile.relaySpeedAt || {};
    const now = Date.now();
    const found = await Promise.all(choiceRelays().map(async (relay) => {
      let origin = '';
      if (relay.id === homePin?.id) {
        origin = (await proveRelayAt(configured, homePin)) ? configured : '';
      } else {
        const proven = typeof probeGuestCandidate === 'function' ? await probeGuestCandidate(relay, home) : null;
        origin = proven?.origin || '';
      }
      if (!origin) return null;
      const sample = await lightSample(origin);
      const speedDue = withSpeed || now - (Number(speedAt[relay.id]) || 0) >= relayChoiceTiming('speedEveryMs');
      const kbps = speedDue && sample.ok > 0 ? await speedSample(origin) : null;
      return { id: relay.id, origin, sample: { at: Date.now(), ...sample, kbps } };
    }));
    const measured = found.filter(Boolean);
    if (!measured.length || measured.every((entry) => entry.sample.ok === 0) || navigator.onLine === false) return {};
    const scores = { ...(chatState.profile.relayScores || {}) };
    const out = {};
    for (const { id, sample } of measured) {
      scores[id] = [...(scores[id] || []), sample].slice(-CHOICE_KEEP);
      if (sample.kbps != null) speedAt[id] = sample.at;
      out[id] = sample;
    }
    chatState.profile.relayScores = scores;
    chatState.profile.relaySpeedAt = speedAt;
    chatState.profile.relayChoiceMeasuredAt = Date.now();
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
    if (typeof renderRelayChoice === 'function') renderRelayChoice();
    return out;
  } finally {
    relayChoiceState.running = false;
  }
}

/* Home's own connection: each time a socket that was up is gone, a drop. */
function countHomeDrops() {
  const up = Boolean(chatState.connected && chatState.ws?.readyState === WebSocket.OPEN);
  const guest = typeof guestStayActive === 'function' && guestStayActive();
  if (relayChoiceState.wasUp && !guest && !chatState.manualOffline && (!up || chatState.ws !== relayChoiceState.lastWs)) {
    const since = Date.now() - 3 * relayChoiceTiming('dayMs');
    chatState.profile.relayDrops = [...(chatState.profile.relayDrops || []).filter((at) => at > since), Date.now()].slice(-200);
  }
  relayChoiceState.wasUp = up;
  relayChoiceState.lastWs = chatState.ws;
}

function relayChoiceMode() {
  const mode = chatState.profile?.relayChoice;
  return mode === 'suggest' || mode === 'off' ? mode : 'auto';
}

async function relayChoiceTick() {
  countHomeDrops();
  if (!relayChoiceState.running) renderRelayChoice();
  if (typeof isUnlocked === 'function' && !isUnlocked()) return;
  if (relayChoiceMode() === 'off' || !relayChoiceAvailable()) return;
  if (chatState.manualOffline || chatState.profile?.chatEnabled === false || navigator.onLine === false) return;
  if (!(chatState.connected && chatState.ws?.readyState === WebSocket.OPEN)) return;
  if (typeof guestStayActive === 'function' && guestStayActive()) return;
  const last = Number(chatState.profile.relayChoiceMeasuredAt) || 0;
  const now = Date.now();
  if (now - last < Math.max(relayChoiceTiming('minGapMs'), relayChoiceTiming('backgroundMs'))) return;
  await measureRelays();
  if (typeof maybeMoveHome === 'function') await maybeMoveHome();
}

/* ---- deciding and moving ------------------------------------------------------ */

/* No contact and nothing said yet: nothing to hand over, so the best home is
   taken at once. */
function isNewAccount() {
  const contacts = (chatState.peers || []).filter((peer) => !peer.type && (typeof isStoredContact === 'function' ? isStoredContact(peer) : true));
  const said = Object.values(chatState.history || {}).some((list) => Array.isArray(list) && list.length > 0);
  return contacts.length === 0 && !said;
}

/* The kept measurements as each day's scores, and each relay's latest loads. */
function choiceHistory(homeId) {
  const dayMs = relayChoiceTiming('dayMs');
  const scores = chatState.profile.relayScores || {};
  const since = Date.now() - 3 * dayMs;
  const dropsPerDay = (chatState.profile.relayDrops || []).filter((at) => at > since).length / 3;
  const byDay = {};
  for (const [id, samples] of Object.entries(scores)) {
    for (const sample of samples || []) {
      const day = String(Math.floor(Number(sample.at) / dayMs));
      ((byDay[day] = byDay[day] || {})[id] = byDay[day][id] || []).push(sample);
    }
  }
  const history = {};
  for (const [day, measurements] of Object.entries(byDay)) {
    const dayScores = scoreRelays(measurements, { homeId, homeDropsPerDay: dropsPerDay });
    history[day] = Object.fromEntries(Object.entries(dayScores).map(([id, value]) => [id, value.score]));
  }
  const saturation = Object.fromEntries(Object.entries(scores).map(([id, samples]) => [id, (samples || []).map((sample) => Number(sample.load) || 0)]));
  return { history, saturation, latest: scoreRelays(scores, { homeId, homeDropsPerDay: dropsPerDay }) };
}

function choiceRelayName(id) {
  return typeof familyRelayLabel === 'function' ? familyRelayLabel(id) : String(id || '').slice(0, 12);
}

function choiceNumbers(fact) {
  if (!fact) return '—';
  const latency = Number.isFinite(fact.latency) ? `${Math.round(fact.latency)} ms` : '—';
  const steady = `${Math.round((fact.stability || 0) * 100)}%`;
  const speed = fact.speed ? (fact.speed >= 1000 ? `${(fact.speed / 1000).toFixed(1)} Mb/s` : `${fact.speed} kb/s`) : '—';
  const load = `${Math.round((fact.saturation || 0) * 100)}%`;
  return t(`پاسخ ${latency}، پایداری ${steady}، سرعت ${speed}، پر بودن ${load}`, `answers in ${latency}, steady ${steady}, speed ${speed}, ${load} full`);
}

async function maybeMoveHome() {
  if (!relayChoiceAvailable() || relayChoiceMode() === 'off') return;
  if (relayChoiceState.promptOpen || chatState.pendingDirectMove) return;
  if (chatState.profile.activeGuest || (typeof guestStayActive === 'function' && guestStayActive())) return;
  const homeId = relayPinFor(configuredRelayOrigin())?.id || '';
  const { history, saturation, latest } = choiceHistory(homeId);
  const newAccount = isNewAccount();
  const decision = moveDecision(history, saturation, { homeId, newAccount, lastMoveAt: Number(chatState.profile.lastHomeMoveAt) || 0, now: Date.now() });
  if (!decision) return;
  if (relayChoiceMode() === 'suggest' && !newAccount) {
    const offer = chatState.profile.relayChoiceOffer || (chatState.profile.relayChoiceOffer = { nextAt: 0 });
    if (offer.nextAt && Date.now() < offer.nextAt) return;
    if (typeof PoorijaDialogs === 'undefined' || typeof PoorijaDialogs.choose !== 'function') return;
    const homeName = choiceRelayName(homeId);
    const name = choiceRelayName(decision.to);
    const why = decision.reason === 'full'
      ? t(`رلهٔ خانهٔ شما ${homeName} تقریباً پر است.`, `Your home relay ${homeName} is nearly full.`)
      : t(`رلهٔ ${name} چند روز است که از اینترنت شما بهتر از رلهٔ خانه‌تان ${homeName} کار می‌کند.`, `For several days relay ${name} has worked better from your internet than your home relay ${homeName}.`);
    const text = [
      why,
      `${homeName}: ${choiceNumbers(latest[homeId])}`,
      `${name}: ${choiceNumbers(latest[decision.to])}`,
      t(`با انتقال، ${name} خانهٔ شما می‌شود، صندوقتان به آن سپرده می‌شود و مخاطبانتان نشانی تازه را خودشان یاد می‌گیرند. کلیدها، هویت و گفتگوها عوض نمی‌شوند.`,
        `Moving makes ${name} your home; your mailbox is handed to it, and your contacts learn the new address by themselves. Your keys, identity and conversations do not change.`),
    ].join('\n');
    relayChoiceState.promptOpen = true;
    let answer = null;
    try {
      answer = await PoorijaDialogs.choose(text, [
        { value: 'move', label: t(`انتقال به ${name}`, `Move to ${name}`) },
        { value: 'later', label: t('بعداً یادآوری کن', 'Remind me later') },
        { value: 'no', label: t('نه، خانه‌ام بماند', 'No, keep my home') },
      ], { cancelLabel: t('بعداً یادآوری کن', 'Remind me later') });
    } finally {
      relayChoiceState.promptOpen = false;
    }
    if (relayChoiceMode() === 'off') return;
    if (answer !== 'move') {
      offer.nextAt = Date.now() + relayChoiceTiming(answer === 'no' ? 'declineMs' : 'remindMs');
      saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
      return;
    }
  }
  await moveHomeDirect(decision.to, { reason: decision.reason });
}

/* Straight to the better relay, with the signed move in the hello. The
   configured address changes only once that relay says it took it; refused, or
   no answer within half a minute, the app goes back home unchanged. */
async function moveHomeDirect(targetId, { reason = 'manual' } = {}) {
  if (chatState.pendingDirectMove) return false;
  const configured = configuredRelayOrigin();
  const homeId = relayPinFor(configured)?.id || '';
  const relay = choiceRelays().find((entry) => entry.id === targetId);
  if (!relay || !homeId || relay.id === homeId) return false;
  const home = typeof guestHomeEntry === 'function' ? guestHomeEntry() : null;
  const proven = typeof probeGuestCandidate === 'function' ? await probeGuestCandidate(relay, home) : null;
  if (!proven) return false;
  let signed;
  try {
    signed = await signGuestStatement({ v: 1, type: 'home-move', fp: chatState.identity?.fingerprint || '', from: homeId, to: relay.id, at: Date.now() });
  } catch (_error) { return false; }
  recordRelayPin(proven.origin, proven.identity);
  const settled = new Promise((resolve) => {
    chatState.pendingDirectMove = { to: relay.id, origin: proven.origin, name: relay.name || new URL(proven.origin).host, signed, reason, resolve };
  });
  reconnectRelayTransport();
  const timer = window.setTimeout(() => {
    if (chatState.pendingDirectMove?.to === relay.id) settleDirectMove(false);
  }, 30000);
  const result = await settled;
  window.clearTimeout(timer);
  return result;
}

function settleDirectMove(ok) {
  const pending = chatState.pendingDirectMove;
  if (!pending) return;
  chatState.pendingDirectMove = null;
  if (ok) {
    chatState.profile.serverUrl = pending.origin;
    chatState.profile.activeGuest = null;
    chatState.profile.activeMirror = null;
    chatState.profile.lastHomeMoveAt = Date.now();
    chatState.profile.relayChoiceOffer = { nextAt: 0 };
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
    const field = document.getElementById('chatServerUrl');
    if (field) field.value = pending.origin;
    notify(t(`خانهٔ شما به رلهٔ ${pending.name} منتقل شد: از اینترنت شما سریع‌تر و پایدارتر است. از تنظیمات قابل تغییر است.`,
      `Moved home to relay ${pending.name}: faster and steadier from your internet. Change in Settings.`), 'success');
  } else {
    notify(t('انتقال به رلهٔ بهتر انجام نشد؛ خانهٔ شما همان ماند.', 'The move to a better relay did not go through; your home stays as it was.'), 'warning');
  }
  if (typeof renderRelayChoice === 'function') renderRelayChoice();
  if (typeof renderRelayFamily === 'function') renderRelayFamily();
  reconnectRelayTransport(200);
  pending.resolve?.(ok);
}

function handleDirectMoveFrame(message) {
  const pending = chatState.pendingDirectMove;
  if (!pending) return false;
  if (message.type === 'home-move-ok' && message.to === pending.to) { settleDirectMove(true); return true; }
  if (message.type === 'home-move-refused') { settleDirectMove(false); return true; }
  return false;
}

function relayChoiceHelloFields() {
  const pending = chatState.pendingDirectMove;
  return pending ? { homeMove: { statement: pending.signed.statement, sig: pending.signed.sig } } : {};
}

/* ---- the card in Connection and TURN ------------------------------------------- */

function choiceEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function renderRelayChoice() {
  const node = document.getElementById('chatRelayChoice');
  if (!node) return;
  if (!relayChoiceAvailable()) {
    node.classList.add('hidden');
    node.innerHTML = '';
    return;
  }
  node.classList.remove('hidden');
  node.dir = typeof language === 'function' && language() === 'fa' ? 'rtl' : 'ltr';
  const mode = relayChoiceMode();
  const homeId = relayPinFor(configuredRelayOrigin())?.id || '';
  const { latest } = choiceHistory(homeId);
  const notes = {
    auto: t('برنامه بهترین سرور را انتخاب می‌کند و خانهٔ شما را خودش منتقل می‌کند؛ از شما سؤال نمی‌شود.', 'The app picks the best relay and moves your home by itself; you are not asked.'),
    suggest: t('برنامه سرورها را می‌سنجد و اگر سرور بهتری بود، با دلیل پیشنهاد می‌دهد؛ انتخاب با شماست.', 'The app measures the relays and, when one is better, suggests it with the reasons; you decide.'),
    off: t('خاموش: نه سنجشی انجام می‌شود و نه پیشنهادی.', 'Off: no measuring and no suggestions.'),
  };
  const option = (value, fa, en) => `<label class="chat-relay-choice-mode"><input type="radio" name="chatRelayChoiceMode" value="${value}"${mode === value ? ' checked' : ''}> <span>${choiceEsc(t(fa, en))}</span></label>`;
  const rows = choiceRelays().map((relay) => {
    const home = relay.id === homeId;
    const fact = latest[relay.id];
    const full = Boolean(fact?.excluded);
    const move = !home && fact && !full
      ? ` <button type="button" class="chat-soft-btn" data-relay-move="${choiceEsc(relay.id)}">${choiceEsc(t('انتقال به اینجا', 'Move here'))}</button>` : '';
    return `<li data-relay-choice-row class="${home ? 'is-home' : ''}"><strong>${choiceEsc(choiceRelayName(relay.id))}</strong>`
      + `${home ? ` · <span class="chat-relay-family-home">${choiceEsc(t('خانه', 'home'))}</span>` : ''}`
      + ` · ${choiceEsc(fact ? choiceNumbers(fact) : t('هنوز سنجیده نشده', 'not measured yet'))}${full ? ` · ${choiceEsc(t('پر', 'full'))}` : ''}${move}</li>`;
  }).join('');
  const when = (at) => (at ? new Date(at).toLocaleString(typeof language === 'function' && language() === 'fa' ? 'fa-IR' : 'en-GB') : '—');
  node.innerHTML = `<span class="chat-relay-identity-title">${choiceEsc(t('بهترین سرور', 'Best relay'))}</span>`
    + `<div class="chat-relay-choice-modes" role="radiogroup">${option('auto', 'خودکار', 'Automatic')}${option('suggest', 'فقط پیشنهاد', 'Suggest only')}${option('off', 'خاموش', 'Off')}</div>`
    + `<p class="chat-settings-hint" data-relay-choice-note>${choiceEsc(notes[mode])}</p>`
    + `<ul class="chat-relay-family-list">${rows}</ul>`
    + `<p class="chat-settings-hint">${choiceEsc(t('آخرین سنجش', 'Last measured'))}: ${choiceEsc(when(Number(chatState.profile.relayChoiceMeasuredAt) || 0))} · ${choiceEsc(t('آخرین انتقال', 'Last move'))}: ${choiceEsc(when(Number(chatState.profile.lastHomeMoveAt) || 0))}</p>`
    + `<button type="button" class="chat-soft-btn" data-relay-choice-measure>${choiceEsc(t('الان بسنج', 'Measure now'))}</button>`;
}

document.addEventListener('change', async (event) => {
  const box = event.target?.closest?.('#chatRelayChoice input[name="chatRelayChoiceMode"]');
  if (!box) return;
  const wanted = box.value === 'suggest' || box.value === 'off' ? box.value : 'auto';
  if (wanted === 'off') {
    const ok = typeof PoorijaDialogs !== 'undefined' && await PoorijaDialogs.confirm(
      t('بدون این قابلیت برنامه دنبال سرور سریع‌تر و پایدارتر نمی‌گردد و کیفیت و پایداری اتصال ممکن است آسیب ببیند. خاموش شود؟',
        'Without it the app does not look for a faster or steadier relay, and connection quality and stability may suffer. Turn it off?'),
      { danger: true, okLabel: t('خاموش شود', 'Turn it off') },
    ).catch(() => false);
    if (!ok) { renderRelayChoice(); return; }
  }
  chatState.profile.relayChoice = wanted;
  saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  renderRelayChoice();
});

document.addEventListener('click', async (event) => {
  const measure = event.target?.closest?.('[data-relay-choice-measure]');
  if (measure) {
    measure.disabled = true;
    measure.textContent = t('در حال سنجش…', 'Measuring…');
    try { await measureRelays({ withSpeed: true }); } finally { renderRelayChoice(); }
    return;
  }
  const move = event.target?.closest?.('[data-relay-move]');
  if (move) {
    const id = move.getAttribute('data-relay-move');
    const ok = typeof PoorijaDialogs !== 'undefined' && await PoorijaDialogs.confirm(
      t(`خانهٔ شما به رلهٔ ${choiceRelayName(id)} منتقل شود؟ صندوق پیام‌ها به آن سپرده می‌شود و مخاطبانتان نشانی تازه را خودشان یاد می‌گیرند.`,
        `Move your home to relay ${choiceRelayName(id)}? Your mailbox is handed to it, and your contacts learn the new address by themselves.`),
      { okLabel: t('منتقل شود', 'Move') },
    ).catch(() => false);
    if (ok) await moveHomeDirect(id, { reason: 'manual' });
  }
});

window.addEventListener('poorija:language-changed', () => renderRelayChoice());

window.setInterval(() => { relayChoiceTick().catch((error) => console.warn('[Relay choice]', error?.message || error)); }, relayChoiceTiming('tickMs'));
