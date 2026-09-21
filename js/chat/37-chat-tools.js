/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 37 of the Secure Chat module — the Tools pane in chat settings.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Four tools, each answering a question the app could not answer before.

     WHICH RELAY WORKS   A domain that carries this app is a domain that gets
                         blocked. Anyone who expects that keeps mirrors, and
                         then needs to know which of them is reachable right
                         now, and how slow it is. Guessing by trying to connect
                         and waiting for a timeout is how people give up.

     START THE SESSION   Session keys are negotiated once and reused. When one
                         goes wrong — a device restored from a backup, a peer
                         who reinstalled — every message afterwards fails to
                         decrypt with no way out from the interface. Dropping
                         the key makes the next message negotiate fresh ones,
                         which is also forward secrecy on demand.

     WHAT IS STILL OUT   "Sent" and "delivered" are different things, and the
                         difference matters most exactly when the network is
                         bad. This lists what has left this device and not been
                         acknowledged, and how long ago.

     HOW IS THIS CALL    "Is it the app or is it my internet" is unanswerable
                         from the inside, and for people on a throttled link it
                         is the first question. Round-trip time, loss, jitter
                         and bitrate, read from the peer connection itself.
*/

const CHAT_TOOLS_PROBE_TIMEOUT_MS = 6000;

/* ---- which relay works ---------------------------------------------------- */

/* Every origin this installation knows about: what the user has configured,
   what shipped in the build, and whatever the app is using right now. */
function chatToolsRelayCandidates() {
  const found = new Set();
  const add = (value) => {
    const origin = normalizeRelayOrigin(String(value || ''), '');
    if (origin) found.add(origin);
  };
  add(document.getElementById('chatServerUrl')?.value);
  add(chatState.profile?.serverUrl);
  (window.__POORIJA_DEFAULT_RELAY_ORIGINS__ || []).forEach(add);
  try { (relayHintsFromDefaults?.() || []).forEach(add); } catch (error) { /* not built in */ }
  return [...found];
}

/* One origin, one verdict. Deliberately uses /chat-health rather than the
   socket: a relay that answers HTTP but cannot take a WebSocket is a different
   failure, and saying "reachable" for it would be a lie — so the check also
   reports whether the health payload is the shape this app expects. */
async function chatToolsProbeRelay(origin) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TOOLS_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${origin}/chat-health`, {
      signal: controller.signal, cache: 'no-store', mode: 'cors'
    });
    const ms = Math.round(performance.now() - started);
    if (!response.ok) return { origin, ok: false, ms, why: `HTTP ${response.status}` };
    const body = await response.json().catch(() => null);
    if (!body || body.ok !== true) {
      return { origin, ok: false, ms, why: t('پاسخ داد ولی رلهٔ این برنامه نیست', 'answered, but is not this app\'s relay') };
    }
    return {
      origin, ok: true, ms,
      peers: Number(body.peers) || 0,
      turn: Boolean(body.turnEnabled),
      saturation: body.capacity?.saturation ?? null
    };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    return {
      origin, ok: false, ms,
      why: error.name === 'AbortError'
        ? t('پاسخی نداد', 'no answer')
        : t('در دسترس نبود', 'unreachable')
    };
  } finally { clearTimeout(timer); }
}

async function chatToolsCheckRelays() {
  const box = document.getElementById('chatToolsRelayResult');
  const origins = chatToolsRelayCandidates();
  if (!box) return;
  if (!origins.length) {
    box.innerHTML = `<p class="chat-help-note">${app().escapeHTML(
      t('نشانی رله‌ای برای آزمودن پیدا نشد.', 'No relay address to test.'))}</p>`;
    return;
  }
  box.innerHTML = `<p class="chat-help-note">${app().escapeHTML(
    t(`در حال آزمودن ${origins.length} نشانی…`, `Testing ${origins.length} addresses…`))}</p>`;

  /* All at once: testing them one after another means waiting out every
     timeout in turn, which is the slowest possible answer to "which one is
     up". */
  const rows = await Promise.all(origins.map(chatToolsProbeRelay));
  rows.sort((a, b) => Number(b.ok) - Number(a.ok) || a.ms - b.ms);

  const current = normalizeRelayOrigin(chatState.profile?.serverUrl || '', '');
  box.innerHTML = rows.map((row) => {
    const isCurrent = row.origin === current;
    const detail = row.ok
      ? t(`${row.ms} میلی‌ثانیه · ${row.peers} کاربر آنلاین${row.turn ? ' · TURN دارد' : ''}`,
          `${row.ms} ms · ${row.peers} online${row.turn ? ' · TURN available' : ''}`)
      : `${row.why} (${row.ms} ms)`;
    return `
      <div class="chat-tools-relay-row ${row.ok ? 'is-up' : 'is-down'}">
        <i class="fas ${row.ok ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
        <div class="chat-tools-relay-body">
          <div class="chat-tools-relay-origin" dir="ltr">${app().escapeHTML(row.origin)}${
            isCurrent ? ` <span class="chat-tools-relay-badge">${app().escapeHTML(t('در حال استفاده', 'in use'))}</span>` : ''}</div>
          <div class="chat-tools-relay-detail">${app().escapeHTML(detail)}</div>
        </div>
        ${row.ok && !isCurrent
          ? `<button type="button" class="chat-tools-relay-use" data-chat-use-relay="${app().escapeHTML(row.origin)}">${
              app().escapeHTML(t('استفاده', 'Use'))}</button>`
          : ''}
      </div>`;
  }).join('');
}

/* ---- start the session again --------------------------------------------- */

/* Drops every stored session key for one peer. Nothing is lost: the keys are
   ephemeral by design and the next message negotiates new ones. What this
   fixes is a session that has gone one-way — the other side reinstalled, or a
   backup was restored over a newer state — where every message afterwards
   fails to decrypt and the interface offers no way out. */
function chatToolsResetSession(conversationKey) {
  const peer = findPeerByAnyKey(conversationKey);
  if (!peer) {
    notify(t('این مخاطب پیدا نشد.', 'That contact was not found.'), 'warning');
    return false;
  }
  let dropped = 0;
  for (const alias of [peer.peerId, peer.fingerprint, peer.clientId, peer.conversationId]) {
    if (alias && chatState.sessionKeys?.[alias]) {
      delete chatState.sessionKeys[alias];
      dropped += 1;
    }
  }
  saveEncrypted(CHAT_SESSION_KEYS_STORAGE_KEY, chatState.sessionKeys);
  notify(dropped
    ? t('کلید نشست پاک شد. پیام بعدی کلید تازه می‌سازد.',
        'The session key was cleared. The next message will negotiate a new one.')
    : t('کلید نشستی برای این مخاطب نبود.', 'There was no session key for that contact.'),
    dropped ? 'success' : 'info');
  renderChatSettingsTools();
  return dropped > 0;
}

/* ---- what has not been acknowledged -------------------------------------- */

/* "Sent" means it left this device. "Delivered" means the other side said so.
   The gap between them is the thing worth looking at when the link is bad, and
   nothing in the interface showed it. */
function chatToolsUndelivered() {
  const now = Date.now();
  const rows = [];
  for (const [conversationId, entries] of Object.entries(chatState.history || {})) {
    for (const entry of entries || []) {
      if (entry.direction !== 'out') continue;
      if (entry.status === 'delivered' || entry.status === 'read' || entry.status === 'failed') continue;
      const at = Date.parse(entry.createdAt || '') || 0;
      rows.push({
        conversationId,
        who: memberDisplayName(conversationId) || conversationId.slice(0, 10),
        kind: entry.type || 'text',
        status: entry.status || 'pending',
        ageMinutes: at ? Math.round((now - at) / 60000) : null
      });
    }
  }
  return rows.sort((a, b) => (b.ageMinutes ?? 0) - (a.ageMinutes ?? 0));
}

function chatToolsRenderUndelivered() {
  const box = document.getElementById('chatToolsQueueResult');
  if (!box) return;
  const rows = chatToolsUndelivered();
  if (!rows.length) {
    box.innerHTML = `<p class="chat-help-note">${app().escapeHTML(
      t('همه‌چیز تحویل داده شده.', 'Everything has been acknowledged.'))}</p>`;
    return;
  }
  box.innerHTML = `
    <p class="chat-help-note">${app().escapeHTML(t(
      `${rows.length} پیام از این دستگاه خارج شده ولی هنوز تأیید دریافت نگرفته.`,
      `${rows.length} messages have left this device without an acknowledgement.`))}</p>
    ${rows.slice(0, 25).map((row) => `
      <div class="chat-tools-queue-row">
        <span class="chat-tools-queue-who">${app().escapeHTML(row.who)}</span>
        <span class="chat-tools-queue-kind">${app().escapeHTML(row.kind)}</span>
        <span class="chat-tools-queue-age">${app().escapeHTML(row.ageMinutes === null
          ? '—'
          : t(`${row.ageMinutes} دقیقه پیش`, `${row.ageMinutes} min ago`))}</span>
      </div>`).join('')}`;
}

/* ---- how is this call ----------------------------------------------------- */

/* Read from the peer connection, not guessed from how it feels. getStats
   returns cumulative counters, so loss has to be worked out as a fraction of
   what was expected rather than reported raw. */
/* The in-call panel and this pane ask the same question of the same
   connections, so they share one implementation. This used to be a second copy
   with its own slightly different rules — it counted audio, the call monitor
   counted only video — which meant the two screens could disagree about the
   same call, and there was no way to tell which was right. */
async function chatToolsCallQuality() {
  if (typeof collectCallQuality !== 'function') return null;
  const readings = await collectCallQuality();
  return readings.length ? readings : null;
}

async function chatToolsRenderQuality() {
  const box = document.getElementById('chatToolsQualityResult');
  if (!box) return;
  const readings = await chatToolsCallQuality();
  if (!readings || !readings.length) {
    box.innerHTML = `<p class="chat-help-note">${app().escapeHTML(
      t('تماسی در جریان نیست. این بخش هنگام تماس عدد نشان می‌دهد.',
        'No call is running. This shows numbers while one is.'))}</p>`;
    return;
  }
  /* A judgement, not only numbers: the point is to answer "is it me or the
     app", and a table of milliseconds does not answer that for most people. */
  const verdict = (r) => {
    if (r.rtt == null) return t('در حال برقراری', 'connecting');
    if (r.rtt < 150 && r.lossPercent < 2) return t('خوب', 'good');
    if (r.rtt < 400 && r.lossPercent < 8) return t('قابل‌قبول', 'usable');
    return t('ضعیف — مشکل از شبکه است، نه برنامه', 'poor — this is the network, not the app');
  };
  box.innerHTML = readings.map((r) => `
    <div class="chat-tools-quality-row">
      <div class="chat-tools-quality-verdict">${app().escapeHTML(verdict(r))}</div>
      <div class="chat-tools-quality-detail" dir="ltr">${app().escapeHTML(
        `RTT ${r.rtt ?? '—'} ms · loss ${r.lossPercent}% · jitter ${r.jitter ?? '—'} ms · ${r.packets} pkts`)}</div>
    </div>`).join('');
}

/* ---- the pane ------------------------------------------------------------- */

/* The markup on its own, so it can be produced again.
 *
 * It used to be built inline behind `if (card) return card`, which meant every
 * t() in it was resolved once, on the first visit to Tools, and kept whatever
 * language was on at that moment. The panes either side of it come from
 * index.html carrying data-i18n, so updateLanguage() rewrote those — which is
 * how the section ended up half English and half Persian in the same view,
 * with the menu and the static rows translated and everything built here not.
 *
 * Anything built by JavaScript has to be REBUILDABLE, not just built. */
function chatToolsCardHtml() {
  return `
<h4>${app().escapeHTML(t('کدام رله در دسترس است', 'Which relay is reachable'))}</h4>
<p class="chat-help-note">${app().escapeHTML(t(
  'هر نشانی که این برنامه را می‌رساند ممکن است مسدود شود. این بخش همهٔ نشانی‌هایی را که می‌شناسد هم‌زمان می‌آزماید و می‌گوید کدام جواب می‌دهد و چقدر کند است.',
  'Any address that serves this app can be blocked. This tests every address it knows about at once and says which answers, and how slowly.'))}</p>
<button type="button" id="chatToolsRelayBtn" class="chat-settings-action"><i class="fas fa-tower-broadcast"></i> ${
  app().escapeHTML(t('آزمودن رله‌ها', 'Test the relays'))}</button>
<div id="chatToolsRelayResult" class="chat-tools-result"></div>

<h4 class="chat-tools-heading">${app().escapeHTML(t('شروع دوبارهٔ نشست', 'Start the session again'))}</h4>
<p class="chat-help-note">${app().escapeHTML(t(
  'اگر پیام‌های یک مخاطب باز نمی‌شوند — مثلاً پس از نصب دوبارهٔ برنامه روی دستگاه او — کلید نشست را پاک کنید تا پیام بعدی کلید تازه بسازد. چیزی از دست نمی‌رود.',
  'If a contact\'s messages stop opening — after they reinstalled, say — clear the session key so the next message negotiates a fresh one. Nothing is lost.'))}</p>
<div class="chat-tools-row">
  <select id="chatToolsPeerSelect" class="chat-tools-select"></select>
  <button type="button" id="chatToolsResetSessionBtn" class="chat-settings-action"><i class="fas fa-rotate"></i> ${
    app().escapeHTML(t('پاک کردن کلید نشست', 'Clear the session key'))}</button>
</div>

<h4 class="chat-tools-heading">${app().escapeHTML(t('چه چیزی هنوز تأیید نشده', 'What has not been acknowledged'))}</h4>
<p class="chat-help-note">${app().escapeHTML(t(
  '«ارسال شد» یعنی از این دستگاه بیرون رفت؛ «تحویل شد» یعنی طرف مقابل گفت رسید. فاصلهٔ این دو، همان چیزی است که وقتی شبکه بد است باید دید.',
  '"Sent" means it left this device; "delivered" means the other side said so. The gap between them is what matters when the link is bad.'))}</p>
<button type="button" id="chatToolsQueueBtn" class="chat-settings-action"><i class="fas fa-list-check"></i> ${
  app().escapeHTML(t('نمایش صف', 'Show the queue'))}</button>
<div id="chatToolsQueueResult" class="chat-tools-result"></div>

<h4 class="chat-tools-heading">${app().escapeHTML(t('کیفیت تماس', 'Call quality'))}</h4>
<p class="chat-help-note">${app().escapeHTML(t(
  '«مشکل از برنامه است یا از اینترنت من؟» — این بخش از خود اتصال می‌خواند و جواب می‌دهد.',
  '"Is it the app or is it my connection?" — this reads the connection itself and answers.'))}</p>
<button type="button" id="chatToolsQualityBtn" class="chat-settings-action"><i class="fas fa-gauge-high"></i> ${
  app().escapeHTML(t('اندازه‌گیری', 'Measure'))}</button>
<div id="chatToolsQualityResult" class="chat-tools-result"></div>`;
}

function chatToolsCard() {
  let card = document.getElementById('chatToolsExtraCard');
  if (!card) {
    card = document.createElement('div');
    card.id = 'chatToolsExtraCard';
    card.className = 'chat-archive-card';
  }
  card.innerHTML = chatToolsCardHtml();
  return card;
}

/* Bindings for controls INSIDE the card, kept apart from the ones outside it.
   Rewriting innerHTML throws away every listener attached to what it replaced,
   so these have to be redone each time the card is refilled; the ones in
   mountChatToolsPane address elements that survive, and must not be added
   twice. */
function bindChatToolsCard() {
  const peerSelect = document.getElementById('chatToolsPeerSelect');
  peerSelect?.addEventListener('focus', renderChatSettingsTools);
  peerSelect?.addEventListener('mousedown', renderChatSettingsTools);
  document.getElementById('chatToolsRelayBtn')?.addEventListener('click', chatToolsCheckRelays);
  document.getElementById('chatToolsQueueBtn')?.addEventListener('click', chatToolsRenderUndelivered);
  document.getElementById('chatToolsQualityBtn')?.addEventListener('click', chatToolsRenderQuality);
  document.getElementById('chatToolsResetSessionBtn')?.addEventListener('click', () => {
    const key = document.getElementById('chatToolsPeerSelect')?.value;
    if (key) chatToolsResetSession(key);
  });
  document.getElementById('chatToolsRelayResult')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-chat-use-relay]');
    if (!button) return;
    const origin = button.getAttribute('data-chat-use-relay');
    const field = document.getElementById('chatServerUrl');
    if (field) {
      field.value = origin;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.getElementById('chatConnectBtn')?.click();
    notify(t(`به ${origin} وصل می‌شود…`, `Connecting to ${origin}…`), 'info');
  });
}

/* Called when the language changes. The result boxes are cleared along with
   everything else, which is correct: a relay table or a queue listing rendered
   in the old language would be the same stale-string problem one level down. */
function refreshChatToolsLanguage() {
  const card = document.getElementById('chatToolsExtraCard');
  if (!card) return;
  card.innerHTML = chatToolsCardHtml();
  bindChatToolsCard();
  renderChatSettingsTools();
}

/* Re-filled every time it could be looked at, not once at mount.

   The first version populated the dropdown when the card was built. Contacts
   arrive from the relay a moment later, so anyone who opened Tools before the
   roster landed got an empty list that never refilled — the reset was
   permanently unusable for them. A control that depends on data arriving over
   a network has to be able to change its mind. */
function renderChatSettingsTools() {
  const select = document.getElementById('chatToolsPeerSelect');
  if (!select) return;
  const peers = (chatState.peers || []).filter((peer) => peer.peerId && !peer.type);
  const previous = select.value;
  select.innerHTML = peers.length
    ? peers.map((peer) => `<option value="${app().escapeHTML(getConversationKey(peer))}">${
        app().escapeHTML(peer.username || peer.name || peer.peerId.slice(0, 12))}</option>`).join('')
    : `<option value="">${app().escapeHTML(t('مخاطبی نیست', 'no contacts'))}</option>`;
  if (previous) select.value = previous;
}

function mountChatToolsPane() {
  const pane = document.querySelector('[data-settings-pane="tools"]');
  if (!pane || document.getElementById('chatToolsExtraCard')) return;
  pane.appendChild(chatToolsCard());
  renderChatSettingsTools();
  bindChatToolsCard();

  /* Outside the card, so it survives a refill and is bound once. Refill the
     moment the user reaches for it, whatever happened before. */
  document.querySelector('[data-settings-tab="tools"]')
    ?.addEventListener('click', () => setTimeout(renderChatSettingsTools, 120));
}

/* The settings body is built lazily, so wait for it rather than assuming. */
window.addEventListener('poorija:tab-switched', (event) => {
  if (event.detail?.tabName === 'chat') setTimeout(mountChatToolsPane, 900);
});
window.addEventListener('poorija:unlock', () => setTimeout(mountChatToolsPane, 1400));
setTimeout(mountChatToolsPane, 2500);

/* The roster changes on its own — someone comes online, a contact is added.
   renderPeers() is the app's own signal that it did, so follow it rather than
   polling. */
if (typeof renderPeers === 'function' && !renderPeers.__toolsHooked) {
  const original = renderPeers;
  // eslint-disable-next-line no-func-assign
  renderPeers = function hookedRenderPeers(...args) {
    const out = original.apply(this, args);
    try { renderChatSettingsTools(); } catch (error) { /* card not mounted yet */ }
    return out;
  };
  renderPeers.__toolsHooked = true;
}

window.__chatToolsProbe = {
  candidates: chatToolsRelayCandidates,
  undelivered: chatToolsUndelivered,
  resetSession: chatToolsResetSession,
  mount: mountChatToolsPane,
  refresh: renderChatSettingsTools
};
