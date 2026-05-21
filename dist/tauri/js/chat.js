(function () {
const CHAT_PROFILE_STORAGE_KEY = 'poorija_chat_profile';
const CHAT_IDENTITY_STORAGE_KEY = 'poorija_chat_identity';
const CHAT_HISTORY_STORAGE_KEY = 'poorija_chat_history';
const CHAT_SESSION_KEYS_STORAGE_KEY = 'poorija_chat_session_keys';
const CHAT_SPACES_STORAGE_KEY = 'poorija_chat_spaces';
const CHAT_CALLS_STORAGE_KEY = 'poorija_chat_calls';
const CHAT_CONTACTS_STORAGE_KEY = 'poorija_chat_contacts';
const FILE_CHUNK_SIZE = 48 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PROFILE_AVATAR_BYTES = 5 * 1024 * 1024;
const SESSION_READY_TIMEOUT_MS = 8000;
const CALL_RING_TIMEOUT_MS = 60000;
const CHAT_RENDER_WINDOW_SIZE = 80;
const CHAT_REACTION_GROUPS = [
{ labelFa: 'پرکاربرد', labelEn: 'Frequent', emojis: ['❤️', '👍', '🙏', '😂', '🔥', '😁', '😮', '😢'] },
{ labelFa: 'احساسات', labelEn: 'Mood', emojis: ['😍', '🥰', '🤩', '😎', '🤔', '😐', '😡', '😭'] },
{ labelFa: 'تایید', labelEn: 'Signals', emojis: ['✅', '👏', '🙌', '👌', '🤝', '💯', '⭐', '⚡'] },
];
const CHAT_REACTION_EMOJIS = CHAT_REACTION_GROUPS.flatMap((group) => group.emojis);
const CHAT_RINGTONE_OPTIONS = [
{ id: 'classic', labelFa: 'کلاسیک', labelEn: 'Classic', gap: 1550, tones: [[440, 0, 190], [660, 210, 210], [880, 460, 260]] },
{ id: 'pulse', labelFa: 'پالس آرام', labelEn: 'Soft pulse', gap: 1850, tones: [[523, 0, 260], [523, 340, 260], [784, 720, 320]] },
{ id: 'signal', labelFa: 'سیگنال سریع', labelEn: 'Quick signal', gap: 1200, tones: [[740, 0, 110], [988, 150, 110], [740, 300, 110], [988, 450, 160]] },
{ id: 'soft', labelFa: 'زنگ نرم', labelEn: 'Gentle chime', gap: 2100, tones: [[392, 0, 330], [587, 420, 330], [784, 860, 420]] },
];
const CHAT_MESSAGE_TONE_OPTIONS = [
{ id: 'chime', labelFa: 'چایم کوتاه', labelEn: 'Short chime', tones: [[740, 0, 130], [988, 120, 150]], type: 'sine' },
{ id: 'pop', labelFa: 'پاپ نرم', labelEn: 'Soft pop', tones: [[520, 0, 90], [620, 95, 90]], type: 'triangle' },
{ id: 'ping', labelFa: 'پینگ سریع', labelEn: 'Quick ping', tones: [[1046, 0, 120]], type: 'sine' },
{ id: 'bell', labelFa: 'بل آرام', labelEn: 'Gentle bell', tones: [[659, 0, 180], [880, 190, 210]], type: 'triangle' },
{ id: 'silent', labelFa: 'بی‌صدا', labelEn: 'Silent', tones: [], type: 'sine' },
];
const chatState = {
initialized: false,
profile: {
name: '',
serverUrl: '',
presenceUrl: '',
peerOrigin: '',
autoConnect: true,
allowVideo: true,
autoDiscovery: true,
showSuspensionCountdown: true,
avatarData: '',
stablePeerId: '',
turnUrl: '',
turnUsername: '',
turnCredential: '',
ringtoneId: 'classic',
messageToneId: 'chime',
},
identity: null,
history: {},
sessionKeys: {},
spaces: {
groups: [],
channels: [],
},
calls: [],
peers: [],
activePeerClientId: null,
activeConversationId: '',
activeView: 'chats',
searchQuery: '',
ws: null,
peer: null,
peerTransportOrigin: '',
peerId: '',
clientId: '',
connected: false,
serverReachable: false,
shouldReconnect: false,
reconnectTimer: null,
sessions: new Map(),
incomingFiles: new Map(),
currentCall: null,
currentCallStartedAt: 0,
currentCallAnsweredAt: 0,
currentCallLogged: false,
currentCallDirection: 'out',
outgoingCallTimer: null,
incomingCallTimer: null,
pendingIncomingCall: null,
localStream: null,
remoteStream: null,
mediaRecorder: null,
recordedChunks: [],
voiceRecorderStream: null,
voiceRecorderAudioContext: null,
voiceDraft: null,
voiceDraftUrl: '',
expiryTimer: null,
timerSeconds: 0,
timerPopoverOpen: false,
replyToId: '',
editingMessageId: '',
callFilter: 'incoming',
activeReactionMessageId: '',
activeForwardMessageId: '',
avatarEditor: null,
pendingAvatarData: '',
recordingStartTime: 0,
recordingElapsed: 0,
recordingPaused: false,
recordingInterval: null,
voiceWaveformData: [],
playbackInterval: null,
pendingIncomingInvite: null,
pendingIncomingAccept: false,
currentCallMode: 'voice',
endingCurrentCall: false,
callMuted: false,
callHeld: false,
callSpeakerEnabled: false,
callVideoEnabled: true,
callFacingMode: 'user',
callDisplayMode: 'fullscreen',
callPrimaryVideo: 'remote',
floatingCallPosition: {
x: 24,
y: 24,
},
draggingFloatingCall: false,
floatingDragOffset: null,
portalsMounted: false,
timerPortalMounted: false,
heartbeatTimer: null,
reconnectAttempt: 0,
historySaveTimer: null,
typingTimers: new Map(),
wsMessageQueues: new Map(),
sessionWarmupTimers: new Map(),
sessionWarmupInFlight: new Set(),
serverRestriction: null,
serverRestrictionCountdownTimer: null,
serverRestrictionProbeTimer: null,
lastRestrictionNoticeAt: 0,
lastRestrictionNoticeText: '',
pinnedConversations: [],
qrScanner: null,
screenStream: null,
ringtoneAudioContext: null,
ringtoneInterval: null,
ringtoneStopTimer: null,
ringtonePrimed: false,
};
function app() {
return window.PoorijaApp;
}
function appState() {
return app()?.state;
}
function isUnlocked() {
return Boolean(appState() && !appState().isLocked && appState().masterPassword);
}
function language() {
return appState()?.language || 'fa';
}
function notify(message, type = 'info') {
app()?.showNotification?.(message, type);
}
function t(fa, en) {
return language() === 'fa' ? fa : en;
}
function saveEncrypted(key, value) {
if (!isUnlocked()) return;
const helper = app();
if (!helper) return;
try {
localStorage.setItem(key, helper.encryptStorageData(value));
} catch (error) {
console.error(error);
}
}
function loadEncrypted(key, fallback) {
const helper = app();
const raw = localStorage.getItem(key);
if (!raw || !helper) return fallback;
const decrypted = helper.decryptStorageData(raw);
if (decrypted !== null && decrypted !== undefined) {
return decrypted;
}
try {
return JSON.parse(raw);
} catch (error) {
return fallback;
}
}
function chatServerOrigin() {
const configured = String(chatState.profile.serverUrl || '').trim();
const fallbackOrigin = defaultRelayFallbackOrigin();
if (!configured || configured === 'file://' || configured === 'null') return fallbackOrigin;
return normalizeRelayOrigin(configured, fallbackOrigin);
}
function defaultRelayFallbackOrigin() {
if (window.location.protocol === 'file:' || window.location.protocol === 'tauri:') return 'http://127.0.0.1:9000';
try {
const current = new URL(window.location.origin);
if (current.protocol === 'http:' || current.protocol === 'https:') return current.origin;
} catch (error) {
/* noop */
}
return 'http://127.0.0.1:9000';
}
function isLocalRelayHostname(hostname = '') {
const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host.endsWith('.localhost');
}
function relayHostnameFromInput(value = '') {
const hostish = String(value || '').trim().split(/[/?#]/)[0].toLowerCase();
if (hostish.startsWith('[')) return hostish.slice(1).split(']')[0] || '';
return hostish.split(':')[0] || '';
}
function normalizeRelayOrigin(raw = '', fallbackOrigin = defaultRelayFallbackOrigin()) {
const trimmed = String(raw || '').trim();
if (!trimmed || trimmed === 'file://' || trimmed === 'null') return fallbackOrigin;
try {
const isLocal = isLocalRelayHostname(relayHostnameFromInput(trimmed)) || isPrivateIpv4(relayHostnameFromInput(trimmed));
const withScheme = /^https?:\/\//i.test(trimmed)
? trimmed
: `${isLocal ? 'http' : 'https'}://${trimmed}`;
const parsed = new URL(withScheme);
if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallbackOrigin;
// In PWA/HTTPS contexts, Safari/Chrome may block HTTP requests to local IPs.
// We keep the original protocol if provided, otherwise default based on locality.
return parsed.origin;
} catch (error) {
return fallbackOrigin;
}
}
function relayHintOrigins() {
const values = [];
const append = (value) => {
if (!value) return;
if (Array.isArray(value)) {
value.forEach(append);
return;
}
if (typeof value === 'object') {
append(value.origin || value.url || value.relayOrigin);
return;
}
values.push(String(value));
};
append(window.__POORIJA_RELAY_HINTS__);
append(window.__POORIJA_DEFAULT_RELAY_ORIGINS__);
document.querySelectorAll('meta[name="poorija-relay-origin"]').forEach((meta) => append(meta.getAttribute('content')));
return values;
}
function restrictionText(restriction = chatState.serverRestriction) {
if (!restriction) return '';
if (restriction.type === 'kicked') {
return t('شما محدود شده‌ اید.', 'You are restricted.');
}
const base = t('شما موقتاً تعلیق شده اید.', 'You are temporarily suspended.');
const details = [restrictionLocalUntilText(restriction), restrictionRemainingText(restriction)].filter(Boolean);
return details.length ? `${base} ${details.join(' ')}` : base;
}
function restrictionStatusLabel(restriction = chatState.serverRestriction) {
if (!restriction) return '';
if (restriction.type === 'suspended') return t('تعلیق موقت', 'Temporary suspension');
if (restriction.type === 'kicked') return t('محدود شده', 'Restricted');
return t('محدودیت سرور', 'Server restriction');
}
function notifyRestrictionOnce(message = restrictionText()) {
const text = String(message || restrictionText() || '').trim();
if (!text) return false;
const now = Date.now();
const active = chatState.serverRestriction;
const key = active
? `${active.type || 'restriction'}:${restrictionUntilMs(active) || ''}:${active.permanent ? 'permanent' : 'temporary'}`
: text;
if (chatState.lastRestrictionNoticeKey === key && now - Number(chatState.lastRestrictionNoticeAt || 0) < 5000) {
return false;
}
chatState.lastRestrictionNoticeKey = key;
chatState.lastRestrictionNoticeText = text;
chatState.lastRestrictionNoticeAt = now;
notify(text, 'warning');
return true;
}
function restrictionUntilMs(restriction = chatState.serverRestriction) {
if (!restriction?.until) return 0;
if (typeof restriction.until === 'number') return Number.isFinite(restriction.until) ? restriction.until : 0;
const parsed = Date.parse(restriction.until);
return Number.isFinite(parsed) ? parsed : 0;
}
function restrictionLocalUntilText(restriction = chatState.serverRestriction) {
if (!restriction?.until || restriction.permanent) return '';
const untilMs = restrictionUntilMs(restriction);
if (!Number.isFinite(untilMs) || untilMs <= 0) return '';
const locale = language() === 'fa' ? 'fa-IR' : undefined;
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
let formatted = '';
try {
formatted = new Intl.DateTimeFormat(locale, {
dateStyle: 'medium',
timeStyle: 'short',
timeZone: timezone || undefined,
}).format(new Date(untilMs));
} catch (_) {
formatted = new Date(untilMs).toLocaleString(locale);
}
const suffix = timezone ? ` (${timezone})` : '';
return t(`پایان به وقت شما: ${formatted}${suffix}`, `Ends in your local time: ${formatted}${suffix}`);
}
function restrictionRemainingText(restriction = chatState.serverRestriction) {
if (chatState.profile.showSuspensionCountdown === false) return '';
if (!restriction?.until || restriction.permanent) return '';
const remainingMs = restrictionUntilMs(restriction) - Date.now();
if (!Number.isFinite(remainingMs) || remainingMs <= 0) return t('(زمان تعلیق تمام شده است.)', '(Suspension time has ended.)');
const totalSeconds = Math.ceil(remainingMs / 1000);
const days = Math.floor(totalSeconds / 86400);
const hours = Math.floor((totalSeconds % 86400) / 3600);
const minutes = Math.floor((totalSeconds % 3600) / 60);
const seconds = totalSeconds % 60;
const clock = days > 0
? `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
return t(`زمان باقی‌مانده: ${clock}`, `Remaining: ${clock}`);
}
function clearRestrictionTimers() {
if (chatState.serverRestrictionCountdownTimer) {
clearInterval(chatState.serverRestrictionCountdownTimer);
chatState.serverRestrictionCountdownTimer = null;
}
if (chatState.serverRestrictionProbeTimer) {
clearInterval(chatState.serverRestrictionProbeTimer);
chatState.serverRestrictionProbeTimer = null;
}
}
function renderRestrictionStatus() {
if (!chatState.serverRestriction) return;
const label = restrictionStatusLabel(chatState.serverRestriction);
const detail = restrictionText(chatState.serverRestriction);
setConnectionState(false, label);

// Force status dot to orange for temporary suspension and red for kicked users.
const dot = document.getElementById('chatConnectionDot');
if (dot) {
dot.classList.remove('online');
const suspended = chatState.serverRestriction?.type === 'suspended';
dot.style.background = suspended ? '#f59e0b' : '#ef4444';
dot.style.boxShadow = suspended
? '0 0 0 6px rgba(245, 158, 11, 0.16)'
: '0 0 0 6px rgba(239, 68, 68, 0.14)';
}

const restrictionBanner = document.getElementById('chatRestrictionBanner');
if (restrictionBanner) {
restrictionBanner.textContent = detail;
restrictionBanner.classList.remove('hidden');
}
}
async function probeServerRestrictionLifted({ silent = true, reconnect = true } = {}) {
const restriction = chatState.serverRestriction;
if (!restriction) return false;
try {
const response = await fetch(`${chatServerOrigin()}/chat-health?_t=${Date.now()}`, {
cache: 'no-store',
headers: restrictionHeaders(),
});
if (response.status === 403) {
await restrictedResponseToState(response, { notifyUser: false, restartProbe: false });
return false;
}
if (!response.ok) return false;
setServerRestriction(null);
chatState.shouldReconnect = true;
if (!silent) notify(t('محدودیت سرور برداشته شد. اتصال دوباره برقرار می‌شود.', 'Server restriction was lifted. Reconnecting.'), 'success');
if (reconnect) setTimeout(() => connectChatTransport().catch(console.error), 500);
return true;
} catch (error) {
console.warn('Restriction lift probe failed:', error);
return false;
}
}
function startRestrictionWatchers(restriction) {
clearRestrictionTimers();
renderRestrictionStatus();
chatState.serverRestrictionCountdownTimer = setInterval(() => {
if (!chatState.serverRestriction) {
clearRestrictionTimers();
return;
}
if (!hasActiveServerRestriction()) {
setServerRestriction(null);
if (chatState.profile.autoConnect) connectChatTransport().catch(console.error);
return;
}
renderRestrictionStatus();
}, 1000);
const probeMs = restriction?.permanent ? 15000 : 10000;
chatState.serverRestrictionProbeTimer = setInterval(() => {
probeServerRestrictionLifted({ silent: true }).catch(console.error);
}, probeMs);
}
function hasActiveServerRestriction() {
const restriction = chatState.serverRestriction;
if (!restriction) return false;
const untilMs = restrictionUntilMs(restriction);
if (!restriction.permanent && restriction.until && (!untilMs || Date.now() > untilMs)) {
setServerRestriction(null);
return false;
}
return true;
}
let _serverRestrictionTimer = null;
function setServerRestriction(restriction = null) {
if (_serverRestrictionTimer) {
clearTimeout(_serverRestrictionTimer);
_serverRestrictionTimer = null;
}
chatState.serverRestriction = restriction;
if (restriction) {
if (!restriction.permanent && restriction.until) {
const remaining = restrictionUntilMs(restriction) - Date.now();
if (remaining > 0) {
_serverRestrictionTimer = setTimeout(() => {
setServerRestriction(null);
if (chatState.profile.autoConnect) connectChatTransport();
}, remaining + 1000);
} else {
chatState.serverRestriction = null;
if (chatState.profile.autoConnect) setTimeout(connectChatTransport, 1000);
return;
}
}
chatState.shouldReconnect = false;
clearReconnectTimer();
startRestrictionWatchers(restriction);
} else if (!chatState.connected) {
clearRestrictionTimers();
setConnectionState(false, t('آفلاین', 'Offline'));
} else {
clearRestrictionTimers();
}
renderStaticUi();
renderPeers();
renderActivePeer();
}
function isStaticDevAppOrigin(origin = chatServerOrigin()) {
try {
const candidate = new URL(origin, window.location.origin);
const appOrigin = new URL(window.location.origin);
const devPorts = new Set(['3000', '4173', '4174', '5173', '5174', '8080']);
return candidate.origin === appOrigin.origin
&& devPorts.has(candidate.port || appOrigin.port || '')
&& !chatState.profile.presenceUrl
&& !chatState.profile.peerOrigin;
} catch (_error) {
return false;
}
}
function restrictionHeaders() {
const headers = {
'X-P00RIJA-Fingerprint': chatState.identity?.fingerprint || '',
'X-P00RIJA-Peer-Id': chatState.peerId || chatState.profile.stablePeerId || '',
'X-P00RIJA-Client-Id': chatState.clientId || '',
'X-P00RIJA-Username': chatState.profile.name || '',
};
const encoded = {};
Object.entries(headers).forEach(([key, val]) => {
try {
// Use a safe ASCII-only encoding for headers to avoid browser blocks
encoded[key] = btoa(unescape(encodeURIComponent(String(val))));
} catch (e) {
encoded[key] = '';
}
});
return encoded;
}
async function restrictedResponseToState(response, { notifyUser = true, restartProbe = true } = {}) {
if (!response || response.status !== 403) return false;
const data = await response.json().catch(() => ({}));
if (!data?.restricted) return false;
setServerRestriction({
type: data.restrictionType || 'restricted',
message: data.message || t('اتصال شما با این سرور محدود شده است، لطفاً با ادمین تماس بگیرید.', 'Your connection to this server is restricted. Contact the admin.'),
until: data.until || null,
permanent: Boolean(data.permanent),
});
if (!restartProbe && chatState.serverRestriction) renderRestrictionStatus();
if (notifyUser) notifyRestrictionOnce();
return true;
}
function wsUrl() {
const appendIdentityParams = (rawUrl) => {
try {
const url = new URL(rawUrl, window.location.origin);
const identity = chatState.identity || {};
if (identity.fingerprint) url.searchParams.set('fingerprint', identity.fingerprint);
const peerId = chatState.peerId || chatState.profile.stablePeerId || '';
if (peerId) url.searchParams.set('peerId', peerId);
if (chatState.clientId) url.searchParams.set('clientId', chatState.clientId);
if (chatState.profile.name) url.searchParams.set('username', chatState.profile.name);
return url.toString();
} catch (_error) {
return rawUrl;
}
};
if (chatState.profile.presenceUrl) {
return appendIdentityParams(String(chatState.profile.presenceUrl));
}
const origin = new URL(chatServerOrigin());
const protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
return appendIdentityParams(`${protocol}//${origin.host}/chat-signal`);
}
function peerTransportOrigin() {
const configured = String(chatState.profile.peerOrigin || '').trim();
if (configured) {
try {
return new URL(configured, window.location.origin).origin;
} catch (_error) {
/* noop */
}
}
return chatServerOrigin();
}
function normalizeIceServerUrls(value = '') {
if (Array.isArray(value)) {
return value.map((entry) => String(entry || '').trim()).filter(Boolean);
}
return String(value || '')
.split(/[,\n\r]+/)
.map((entry) => entry.trim())
.filter(Boolean);
}
function formatIceServerUrlsForInput(value = '') {
return normalizeIceServerUrls(value).join(',');
}
function peerOptions() {
const origin = new URL(peerTransportOrigin());
const iceServers = [
{ urls: 'stun:stun.l.google.com:19302' },
{ urls: 'stun:global.stun.twilio.com:3478' },
];
const turnUrls = normalizeIceServerUrls(chatState.profile.turnUrl);
if (turnUrls.length) {
iceServers.push({
urls: turnUrls,
username: chatState.profile.turnUsername || undefined,
credential: chatState.profile.turnCredential || undefined,
});
}
return {
host: origin.hostname,
port: origin.port || (origin.protocol === 'https:' ? '443' : '80'),
path: '/peerjs',
secure: origin.protocol === 'https:',
debug: 1,
config: {
iceServers,
},
};
}
function isPrivateIpv4(hostname) {
const match = String(hostname || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
if (!match) return false;
const [first, second] = [Number(match[1]), Number(match[2])];
return first === 10
|| (first === 172 && second >= 16 && second <= 31)
|| (first === 192 && second === 168);
}
async function fetchRelayJson(url, timeoutMs = 2500) {
const controller = new AbortController();
const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
const isHttpsApp = window.location.protocol === 'https:';
const targetUrl = new URL(url);

// Browsers block HTTP from HTTPS unless the target is a local IP.
if (isHttpsApp && targetUrl.protocol === 'http:' && !isLocalRelayHostname(targetUrl.hostname) && !isPrivateIpv4(targetUrl.hostname)) {
console.log(`[Fetch] Skipping insecure HTTP request from HTTPS origin to avoid block: ${url}`);
return { ok: false, status: 0, statusText: 'Blocked (Mixed Content)' };
}

console.log(`[Fetch] Requesting: ${url}`);
try {
const response = await fetch(url, {
mode: 'cors',
cache: 'no-store',
headers: restrictionHeaders(),
signal: controller.signal,
});
console.log(`[Fetch] Response from ${url}: ${response.status} ${response.statusText}`);
return response;
} catch (error) {
if (error.name === 'AbortError') {
console.log(`[Fetch] Timeout (${timeoutMs}ms) for ${url}`);
} else {
console.log(`[Fetch] Error for ${url}:`, error.message || error);
}
return { ok: false, status: 0, statusText: error.name || 'Error' };
} finally {
clearTimeout(timeout);
}
}
async function probeRelayOrigin(origin) {
const normalizedOrigin = normalizeRelayOrigin(origin);
console.log(`[Discovery] Probing: ${normalizedOrigin}`);
try {
const healthUrl = new URL('/chat-health', normalizedOrigin);
const healthResponse = await fetchRelayJson(healthUrl, 4000);
if (!healthResponse.ok && healthResponse.status === 0) return null; // Blocked or failed
if (await restrictedResponseToState(healthResponse)) {
console.warn(`[Discovery] Access restricted for ${normalizedOrigin}`);
return null;
}
if (!healthResponse.ok) {
console.log(`[Discovery] Health check failed for ${normalizedOrigin} (Status: ${healthResponse.status})`);
return null;
}
const health = await healthResponse.json();
if (!health?.ok || !String(health.service || '').includes('poorija-chat-signal')) {
console.log(`[Discovery] Invalid service at ${normalizedOrigin}`);
return null;
}
console.log(`[Discovery] Found Poorija Relay at ${normalizedOrigin}`);
let turnConfig = null;
try {
const turnUrl = new URL('/turn-config', normalizedOrigin);
const turnResponse = await fetchRelayJson(turnUrl, 4000);
if (turnResponse.ok) {
turnConfig = await turnResponse.json();
console.log(`[Discovery] TURN configuration loaded from ${normalizedOrigin}`);
} else {
console.log(`[Discovery] TURN config endpoint failed for ${normalizedOrigin} (Status: ${turnResponse.status})`);
}
} catch (error) {
console.log(`[Discovery] TURN config fetch failed for ${normalizedOrigin}:`, error.message);
const nativeResult = await probeRelayOriginNatively(normalizedOrigin);
if (nativeResult?.turnConfig) return nativeResult;
}
return { origin: normalizedOrigin, health, turnConfig };
} catch (error) {
console.log(`[Discovery] Probe failed for ${normalizedOrigin}:`, error.message);
return probeRelayOriginNatively(normalizedOrigin);
}
}
function localDiscoveryCandidates(fullScan = false) {
const origins = [];
const fallbackOrigin = defaultRelayFallbackOrigin();
const appProtocol = window.location.protocol;

const seedInputs = [
chatState.profile.serverUrl,
...relayHintOrigins(),
fallbackOrigin,
window.location.origin,
];

const pushOrigin = (host, port, protocol) => {
if (!host || !protocol) return;
const origin = `${protocol}//${host}${port ? `:${port}` : ''}`;
if (!origins.includes(origin)) origins.push(origin);
};

const expandSeed = (rawSeed) => {
const normalized = normalizeRelayOrigin(rawSeed, fallbackOrigin);
let seedOrigin;
try {
seedOrigin = new URL(normalized);
} catch (_error) {
return;
}
const hostname = seedOrigin.hostname;
const isLocal = isLocalRelayHostname(hostname) || isPrivateIpv4(hostname);

// Force HTTPS if app is HTTPS, unless the target is a local IP.
const protocols = [appProtocol];
if (isLocal && appProtocol === 'https:') protocols.push('http:');

const ports = Array.from(new Set([
seedOrigin.port,
'9000',
'8585',
isLocal ? '80' : '',
'443',
])).filter(Boolean);

protocols.forEach((protocol) => {
ports.forEach((port) => {
if (protocol === 'https:' && port === '80') return;
if (protocol === 'http:' && port === '443' && !isLocal) return;
pushOrigin(hostname, port, protocol);
});
});

if (isLocal) {
['127.0.0.1', 'localhost'].forEach((host) => {
protocols.forEach((protocol) => {
ports.forEach((port) => pushOrigin(host, port, protocol));
});
});
}
};

seedInputs.filter(Boolean).forEach(expandSeed);
return origins;
}
async function discoverLocalRelayServer({ fullScan = false, silent = false } = {}) {
if (hasActiveServerRestriction()) {
if (!silent) notifyRestrictionOnce();
return null;
}
const candidates = localDiscoveryCandidates(fullScan);
for (const origin of candidates) {
const result = await probeRelayOrigin(origin);
if (!result) continue;
chatState.profile.serverUrl = result.origin;
chatState.profile.presenceUrl = String(result.health?.presenceUrl || chatState.profile.presenceUrl || '');
chatState.profile.peerOrigin = String(result.health?.peerOrigin || chatState.profile.peerOrigin || result.origin);
if (result.turnConfig?.enabled && result.turnConfig?.urls) {
chatState.profile.turnUrl = formatIceServerUrlsForInput(result.turnConfig.urls || '');
chatState.profile.turnUsername = String(result.turnConfig.username || '');
chatState.profile.turnCredential = String(result.turnConfig.credential || '');
}
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
renderStaticUi();
if (!silent) {
notify(t(`سرور محلی پیدا شد: ${result.origin}`, `Local relay discovered: ${result.origin}`), 'success');
}
return result;
}
if (!silent) {
notify(t('سرور محلی پیدا نشد.', 'No local relay server was discovered.'), 'warning');
}
return null;
}
async function hydrateRelayTurnConfig() {
if (hasActiveServerRestriction()) return;
const needsTurn = !chatState.profile.turnUrl || !chatState.profile.turnUsername || !chatState.profile.turnCredential;
const needsPresence = !chatState.profile.presenceUrl;
const needsPeerOrigin = !chatState.profile.peerOrigin;
if (!needsTurn && !needsPresence && !needsPeerOrigin) return;
if (isStaticDevAppOrigin() && !window.__POORIJA_DESKTOP__) return;
try {
const result = await probeRelayOrigin(chatServerOrigin());
if (result) {
applyRelayDiscoveryResult(result);
}
} catch (error) {
console.warn('Relay config hydration failed:', error);
}
}
function applyRelayDiscoveryResult(result) {
if (!result?.origin || !result?.health) return false;
console.log(`[Discovery] Applying results from ${result.origin}`);
chatState.profile.serverUrl = result.origin;
chatState.profile.presenceUrl = String(result.health?.presenceUrl || chatState.profile.presenceUrl || '');
chatState.profile.peerOrigin = String(result.health?.peerOrigin || chatState.profile.peerOrigin || result.origin);
if (result.turnConfig) {
const turn = result.turnConfig;
if (turn.urls) {
chatState.profile.turnUrl = formatIceServerUrlsForInput(turn.urls || '');
chatState.profile.turnUsername = String(turn.username || '');
chatState.profile.turnCredential = String(turn.credential || '');
console.log('[Discovery] TURN fields populated successfully.');
} else {
console.warn('[Discovery] TURN config received but no URLs found.');
}
} else {
console.warn('[Discovery] No TURN configuration received from relay.');
}
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
renderStaticUi();
return Boolean(chatState.profile.presenceUrl || chatState.profile.peerOrigin);
}
async function ensureRelayTransportReady() {
if (hasActiveServerRestriction()) {
notifyRestrictionOnce();
return false;
}
if (chatState.profile.presenceUrl && chatState.profile.peerOrigin) return true;
if (!isStaticDevAppOrigin() || window.__POORIJA_DESKTOP__) {
const result = await probeRelayOrigin(chatServerOrigin());
if (applyRelayDiscoveryResult(result)) return true;
}
// If configured server fails, try automatic discovery
const discoveryResult = await discoverLocalRelayServer({ fullScan: false, silent: true });
if (discoveryResult) return true;

chatState.shouldReconnect = false;
setConnectionState(false, t('سرور رله تنظیم نشده', 'Relay server is not configured'));
notify(
t('برای چت و تماس، آدرس رله/TURN معتبر وارد کنید یا دکمه کشف محلی را بزنید.', 'Enter a valid relay/TURN server or use local discovery before starting chat/calls.'),
'warning'
);
renderStaticUi();
return false;
}
function registerChatPush(promptForAccess = false) {
const fingerprint = chatState.identity?.fingerprint;
if (!fingerprint) return Promise.resolve({ ok: false, reason: 'missing-fingerprint' });
return app()?.registerWebPushSubscription?.(fingerprint, chatServerOrigin(), promptForAccess)
|| Promise.resolve({ ok: false, reason: 'unsupported' });
}
function identityPayload() {
return {
app: 'P00RIJA Cryptography',
type: 'poorija-chat-identity',
version: 1,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId || chatState.profile.stablePeerId || chatState.clientId || '',
fingerprint: chatState.identity?.fingerprint || '',
publicKeyData: chatState.identity?.publicKeyData || '',
createdAt: new Date().toISOString(),
};
}
function utf8_to_b64(str) {
return window.btoa(unescape(encodeURIComponent(str)));
}
function b64_to_utf8(str) {
return decodeURIComponent(escape(window.atob(str)));
}
function identityText() {
return 'poorija-chat-v1:' + utf8_to_b64(JSON.stringify(identityPayload()));
}
function parseIdentityText(raw = '') {
let text = String(raw || '').trim();
if (!text) return null;
if (text.startsWith('poorija-chat-v1:')) {
try {
text = b64_to_utf8(text.substring(16));
} catch (_e) {}
}
try {
const parsed = JSON.parse(text);
if (parsed?.peerId && (parsed.fingerprint || parsed.publicKeyData)) return parsed;
} catch (_error) {}
const peerMatch = text.match(/Peer:\s*"?([^"\n]+)"?/i) || text.match(/peerId["\s:]+([^",\n]+)/i);
const keyMatch = text.match(/Security Key:\s*"?([^"\n]+)"?/i) || text.match(/fingerprint["\s:]+([^",\n]+)/i);
const nameMatch = text.match(/Name of User:\s*"?([^"\n]+)"?/i) || text.match(/name["\s:]+([^",\n]+)/i);
if (!peerMatch && !keyMatch) return null;
return {
type: 'poorija-chat-identity',
name: nameMatch?.[1]?.trim() || '',
peerId: peerMatch?.[1]?.trim() || '',
fingerprint: keyMatch?.[1]?.trim() || '',
publicKeyData: '',
};
}
function generateId(prefix) {
const random = Math.random().toString(36).slice(2, 10);
return `${prefix}-${Date.now()}-${random}`;
}
function getConversationKey(record) {
if (!record) return '';
if (record.conversationId) return record.conversationId;
return record.fingerprint || record.peerId || record.clientId || '';
}
function isSelfPeerRecord(record) {
if (!record) return false;
return Boolean(
(record.clientId && record.clientId === chatState.clientId)
|| (record.peerId && record.peerId === chatState.peerId)
|| (record.fingerprint && chatState.identity?.fingerprint && record.fingerprint === chatState.identity.fingerprint)
);
}
function getPeerHistoryKey(peerRecord, session = null) {
if (peerRecord) return getConversationKey(peerRecord);
return session?.conversationId || session?.remoteFingerprint || session?.peerId || '';
}
function findPeerByConversationKey(conversationId) {
if (!conversationId) return null;
return chatState.peers.find((peer) => (
getConversationKey(peer) === conversationId
|| peer.peerId === conversationId
|| peer.fingerprint === conversationId
|| peer.clientId === conversationId
)) || null;
}
function buildProfileDraft() {
const defaultServerUrl = window.location.protocol === 'file:' ? 'http://127.0.0.1:9000' : window.location.origin;
return {
name: document.getElementById('chatProfileName')?.value.trim() || chatState.profile.name,
serverUrl: document.getElementById('chatServerUrl')?.value.trim() || chatState.profile.serverUrl || defaultServerUrl,
autoConnect: Boolean(document.getElementById('chatAutoConnect')?.checked),
allowVideo: Boolean(document.getElementById('chatAllowVideo')?.checked),
autoDiscovery: Boolean(document.getElementById('chatAutoDiscovery')?.checked),
showSuspensionCountdown: Boolean(document.getElementById('chatShowSuspensionCountdown')?.checked),
avatarData: chatState.profile.avatarData || '',
presenceUrl: chatState.profile.presenceUrl || '',
peerOrigin: chatState.profile.peerOrigin || '',
stablePeerId: chatState.profile.stablePeerId || generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-'),
turnUrl: document.getElementById('chatTurnUrl')?.value.trim() || '',
turnUsername: document.getElementById('chatTurnUsername')?.value.trim() || '',
turnCredential: document.getElementById('chatTurnCredential')?.value || '',
ringtoneId: document.getElementById('chatRingtoneSelect')?.value || chatState.profile.ringtoneId || 'classic',
messageToneId: document.getElementById('chatMessageToneSelect')?.value || chatState.profile.messageToneId || 'chime',
};
}
function syncProfileDraftFromInputs() {
const draft = buildProfileDraft();
const serverUrlChanged = draft.serverUrl !== chatState.profile.serverUrl;
chatState.profile = {
...chatState.profile,
...draft,
};
if (serverUrlChanged && chatState.profile.serverUrl) {
hydrateRelayTurnConfig().catch(console.error);
}
}
function syncChatToggleStates() {
const toggleMeta = {
chatAutoConnect: ['اتصال خودکار روشن است', 'Auto connect is on', 'اتصال خودکار خاموش است', 'Auto connect is off'],
chatAllowVideo: ['تماس تصویری فعال است', 'Video calls are on', 'تماس تصویری غیرفعال است', 'Video calls are off'],
chatAutoDiscovery: ['دیسکاوری محلی فعال است', 'Local discovery is on', 'دیسکاوری محلی غیرفعال است', 'Local discovery is off'],
chatShowSuspensionCountdown: ['شمارش معکوس تعلیق روشن است', 'Suspension countdown is on', 'شمارش معکوس تعلیق خاموش است', 'Suspension countdown is off'],
};
Object.entries(toggleMeta).forEach(([id, labels]) => {
const input = document.getElementById(id);
const label = input?.closest('.chat-toggle');
if (!input || !label) return;
const checked = Boolean(input.checked);
const title = checked ? t(labels[0], labels[1]) : t(labels[2], labels[3]);
label.classList.toggle('is-active', checked);
label.setAttribute('role', 'switch');
label.setAttribute('aria-checked', checked ? 'true' : 'false');
label.setAttribute('title', title);
label.dataset.state = checked ? 'on' : 'off';
input.setAttribute('aria-checked', checked ? 'true' : 'false');
});
}
function handleConnectionToggleChange(event) {
syncProfileDraftFromInputs();
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
syncChatToggleStates();
refreshCallControls();
renderActivePeer();
if (chatState.serverRestriction) renderRestrictionStatus();
const id = event?.target?.id || '';
if (id === 'chatAutoConnect' && chatState.profile.autoConnect && isUnlocked() && appState()?.activeTab === 'chat' && !chatState.connected) {
connectChatTransport();
}
if (id === 'chatAutoDiscovery' && chatState.profile.autoDiscovery && isUnlocked()) {
discoverLocalRelayServer({ fullScan: false, silent: true })
.then((result) => {
if (result && !chatState.connected) return connectChatTransport();
return null;
})
.catch(console.error);
}
}
function normalizePeerRecord(peer = {}) {
return {
clientId: String(peer.clientId || peer.peerId || ''),
peerId: String(peer.peerId || ''),
username: String(peer.username || peer.name || ''),
name: String(peer.name || peer.username || ''),
publicKeyData: String(peer.publicKeyData || ''),
fingerprint: String(peer.fingerprint || ''),
status: String(peer.status || 'offline'),
avatarData: String(peer.avatarData || ''),
conversationId: peer.conversationId || '',
lastSeenAt: peer.lastSeenAt || '',
type: peer.type || '',
members: Array.isArray(peer.members) ? [...peer.members] : undefined,
ownerFingerprint: String(peer.ownerFingerprint || ''),
manual: Boolean(peer.manual),
pinned: Boolean(peer.pinned),
pinOrder: Number(peer.pinOrder || 0),
};
}
function saveContacts() {
const contacts = chatState.peers
.filter((peer) => peer.peerId && !isSelfPeerRecord(peer))
.map((peer) => normalizePeerRecord(peer));
saveEncrypted(CHAT_CONTACTS_STORAGE_KEY, contacts);
}
function mergePeerRecord(peer = {}, options = {}) {
const normalized = normalizePeerRecord(peer);
if (!normalized.peerId || isSelfPeerRecord(normalized)) return null;
const existing = chatState.peers.find((item) => (
(normalized.peerId && item.peerId === normalized.peerId)
|| (normalized.clientId && item.clientId === normalized.clientId)
|| (normalized.fingerprint && item.fingerprint === normalized.fingerprint)
|| (normalized.conversationId && getConversationKey(item) === normalized.conversationId)
));
const lastSeenAt = options.online ? new Date().toISOString() : (normalized.lastSeenAt || existing?.lastSeenAt || '');
if (existing) {
Object.assign(existing, {
...normalized,
clientId: normalized.clientId || existing.clientId,
publicKeyData: normalized.publicKeyData || existing.publicKeyData,
fingerprint: normalized.fingerprint || existing.fingerprint,
avatarData: normalized.avatarData || existing.avatarData,
username: normalized.username || existing.username,
name: normalized.name || existing.name,
members: normalized.members || existing.members,
manual: existing.manual || normalized.manual,
pinned: existing.pinned || normalized.pinned,
pinOrder: existing.pinOrder || normalized.pinOrder,
status: options.online ? 'online' : (normalized.status || existing.status || 'offline'),
lastSeenAt,
});
return existing;
}
const record = {
...normalized,
status: options.online ? 'online' : normalized.status || 'offline',
lastSeenAt,
};
chatState.peers.push(record);
return record;
}
function findPeerRecordByPeerId(peerId) {
if (!peerId) return null;
return chatState.peers.find((peer) => peer.peerId === peerId) || null;
}
function findPeerBySession(session) {
if (!session) return null;
return chatState.peers.find((peer) => (
peer.peerId === session.peerId ||
peer.fingerprint === session.remoteFingerprint ||
getConversationKey(peer) === session.conversationId
)) || null;
}
function markPeerUnavailable(peerId, message = '') {
if (!peerId) return;
const record = chatState.peers.find((peer) => peer.peerId === peerId);
let changed = false;
if (record && record.status !== 'offline') {
record.status = 'offline';
record.lastSeenAt = new Date().toISOString();
changed = true;
saveContacts();
}
if (changed) {
notify(message || t('این کاربر آفلاین شد، اما گفتگو به‌صورت محلی باقی می‌ماند.', 'This peer went offline, but the local conversation remains available.'), 'warning');
renderPeers();
renderActivePeer();
}
}
function getActiveConversation() {
return activePeer();
}
function localMembershipKeys() {
return new Set([
chatState.clientId,
chatState.peerId,
chatState.identity?.fingerprint,
chatState.profile.stablePeerId,
].filter(Boolean));
}
function spaceIncludesLocalUser(space) {
if (!space?.type) return false;
if (space.ownerPeerId && localMembershipKeys().has(space.ownerPeerId)) return true;
if (space.ownerClientId && localMembershipKeys().has(space.ownerClientId)) return true;
if (space.ownerFingerprint && space.ownerFingerprint === chatState.identity?.fingerprint) return true;
const members = Array.isArray(space.members) ? space.members : [];
if (!members.length) return true;
const mine = localMembershipKeys();
return members.some((member) => mine.has(member));
}
function selectedSpaceMembers(type = 'group') {
if (type !== 'group') return [];
const panel = document.getElementById('chatGroupMembersPanel');
if (!panel) return [];
return Array.from(panel.querySelectorAll('input[type="checkbox"]:checked'))
.map((input) => input.value)
.filter(Boolean);
}
function normalizeSpaceMembers(members = []) {
return Array.from(new Set((Array.isArray(members) ? members : [])
.map((member) => String(member || '').trim())
.filter(Boolean)
.filter((member) => !localMembershipKeys().has(member))));
}
function groupDeliveryMemberKeys(space) {
const fromHistory = (chatState.history[space?.conversationId] || [])
.flatMap((entry) => [entry.senderPeerId, entry.senderFingerprint]);
const candidates = normalizeSpaceMembers([
...(Array.isArray(space?.members) ? space.members : []),
space?.ownerPeerId,
space?.ownerClientId,
space?.ownerFingerprint,
...fromHistory,
]);
const seen = new Set();
return candidates
.map((memberKey) => {
const peer = findPeerByAnyKey(memberKey);
return peer?.peerId || peer?.clientId || peer?.fingerprint || memberKey;
})
.filter((memberKey) => {
if (!memberKey || localMembershipKeys().has(memberKey) || seen.has(memberKey)) return false;
seen.add(memberKey);
return true;
});
}
function findPeerByAnyKey(key) {
if (!key) return null;
return chatState.peers.find((peer) => (
getConversationKey(peer) === key
|| peer.peerId === key
|| peer.clientId === key
|| peer.fingerprint === key
)) || null;
}
function renderSpaceMemberPickers() {
const renderPanel = (id, labelText) => {
const panel = document.getElementById(id);
if (!panel) return;
const peers = chatState.peers
.filter((peer) => peer.peerId && !peer.type && !isSelfPeerRecord(peer))
.sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online'));
if (!peers.length) {
panel.innerHTML = `<div class="chat-member-picker-empty">${t('برای انتخاب عضو، ابتدا کاربر آنلاین یا مخاطب داشته باشید.', 'Add or discover contacts before choosing members.')}</div>`;
return;
}
panel.innerHTML = `
<div class="chat-member-picker-title">${labelText}</div>
${peers.map((peer) => {
const name = peer.username || peer.name || peer.peerId;
return `
<label class="chat-member-option">
<input type="checkbox" value="${app().escapeHTML(getConversationKey(peer))}" ${peer.status === 'online' ? 'checked' : ''}>
<span class="chat-peer-presence-dot ${peer.status === 'online' ? 'online' : 'offline'}"></span>
<span>${app().escapeHTML(name)}</span>
</label>
`;
}).join('')}
`;
};
renderPanel('chatGroupMembersPanel', t('اعضای گروه', 'Group members'));
}
function memberDisplayName(memberKey) {
const peer = findPeerByAnyKey(memberKey);
return peer?.username || peer?.name || peer?.peerId || memberKey;
}
function messageSenderLabel(entry, conversation) {
if (!conversation?.type) return '';
if (entry.senderName) return entry.senderName;
if (entry.direction === 'out') return chatState.profile.name || t('شما', 'You');
return memberDisplayName(entry.senderPeerId || entry.senderFingerprint || '');
}
function renderSpaceMemberManager() {
const panel = document.getElementById('chatSpaceMembersPanel');
if (!panel) return;
const space = getActiveConversation();
const visible = Boolean(space?.type === 'group' && chatState.activeView === 'groups');
panel.classList.toggle('hidden', !visible);
if (!visible) {
panel.innerHTML = '';
return;
}
const peers = chatState.peers
.filter((peer) => peer.peerId && !peer.type && !isSelfPeerRecord(peer))
.sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online'));
const normalizedMembers = normalizeSpaceMembers(space.members);
const members = new Set(normalizedMembers);
const memberPeers = peers.filter((peer) => (
members.has(peer.peerId)
|| members.has(peer.clientId)
|| members.has(peer.fingerprint)
|| members.has(getConversationKey(peer))
));
const avatarMarkup = space.avatarData
? `<img src="${space.avatarData}" alt="">`
: app().escapeHTML(initials(space.name || 'G'));
panel.innerHTML = `
<div class="chat-space-profile-editor">
<button id="chatGroupAvatarBtn" type="button" class="chat-space-avatar-btn" title="${app().escapeHTML(t('تغییر عکس گروه', 'Change group picture'))}">${avatarMarkup}</button>
<input id="chatGroupNameEditInput" class="chat-space-name-input" type="text" value="${app().escapeHTML(space.name || '')}" placeholder="${app().escapeHTML(t('نام گروه', 'Group name'))}">
<button id="chatSaveGroupDetailsBtn" type="button" class="chat-space-save-btn">${t('ذخیره مشخصات', 'Save details')}</button>
</div>
<div class="chat-space-members-head">
<div>
<strong>${app().escapeHTML(space.name || '')}</strong>
<span>${t('اعضای گروه', 'Group members')} · ${members.size}</span>
</div>
<button id="chatSaveSpaceMembersBtn" type="button" class="chat-space-save-btn">${t('ذخیره اعضا', 'Save members')}</button>
</div>
<div class="chat-space-current-members">
${memberPeers.length ? memberPeers.map((peer) => `
<div class="chat-space-current-member">
<span class="chat-peer-presence-dot ${peer.status === 'online' ? 'online' : 'offline'}"></span>
<span>${app().escapeHTML(peer.username || peer.name || peer.peerId)}</span>
<small>${peer.status === 'online' ? t('آنلاین', 'Online') : t('آفلاین', 'Offline')}</small>
</div>
`).join('') : `<div class="chat-member-picker-empty">${t('هنوز عضوی برای این گروه انتخاب نشده است.', 'No members are selected for this group yet.')}</div>`}
</div>
<details class="chat-space-member-accordion" open>
<summary>${t('مدیریت اعضای محلی', 'Manage local members')}</summary>
<div class="chat-space-members-list">
${peers.length ? peers.map((peer) => {
const key = peer.peerId || getConversationKey(peer);
const checked = members.has(key) || members.has(peer.peerId) || members.has(peer.clientId) || members.has(peer.fingerprint) || members.has(getConversationKey(peer));
return `
<label class="chat-member-option">
<input type="checkbox" value="${app().escapeHTML(key)}" ${checked ? 'checked' : ''}>
<span class="chat-peer-presence-dot ${peer.status === 'online' ? 'online' : 'offline'}"></span>
<span>${app().escapeHTML(peer.username || peer.name || peer.peerId)}</span>
<small>${peer.status === 'online' ? t('آنلاین', 'Online') : t('آفلاین', 'Offline')}</small>
</label>
`;
}).join('') : `<div class="chat-member-picker-empty">${t('هنوز مخاطبی برای مدیریت اعضا وجود ندارد.', 'No contacts are available for member management yet.')}</div>`}
</div>
</details>
`;
panel.querySelector('#chatGroupAvatarBtn')?.addEventListener('click', () => {
document.getElementById('chatGroupAvatarInput')?.click();
});
panel.querySelector('#chatSaveGroupDetailsBtn')?.addEventListener('click', () => {
const nextName = panel.querySelector('#chatGroupNameEditInput')?.value.trim();
if (nextName) space.name = nextName;
space.members = normalizeSpaceMembers(space.members);
saveSpaces();
broadcastSpaceRecord(space);
renderPeers();
renderActivePeer();
renderSpaceMemberManager();
notify(t('مشخصات گروه ذخیره شد.', 'Group details saved.'), 'success');
});
panel.querySelector('#chatSaveSpaceMembersBtn')?.addEventListener('click', () => {
space.members = normalizeSpaceMembers(Array.from(panel.querySelectorAll('input[type="checkbox"]:checked'))
.map((input) => input.value)
.filter(Boolean));
saveSpaces();
broadcastSpaceRecord(space);
renderPeers();
renderSpaceMemberManager();
notify(t('اعضای فضا ذخیره شدند.', 'Members saved.'), 'success');
});
}
function notifyTyping() {
const peer = activePeer();
if (!peer || !chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return;
const now = Date.now();
if (chatState.lastTypingSentAt && now - chatState.lastTypingSentAt < 3000) return;
chatState.lastTypingSentAt = now;
sendRelayEnvelope(peer, { type: 'typing' });
}
function handleRemoteTyping(fingerprint) {
const peer = chatState.peers.find((p) => p.fingerprint === fingerprint);
if (!peer) return;
const key = getConversationKey(peer);
if (chatState.typingTimers.has(key)) {
clearTimeout(chatState.typingTimers.get(key));
}
const timer = setTimeout(() => {
chatState.typingTimers.delete(key);
renderActivePeer();
}, 4000);
chatState.typingTimers.set(key, timer);
renderActivePeer();
}
function initials(name) {
const clean = String(name || 'P').trim();
return clean.slice(0, 1).toUpperCase() || 'P';
}
function formatTime(value) {
try {
return new Date(value || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
} catch (_error) {
return '';
}
}
function formatCountdown(expiresAt) {
if (!expiresAt) return '';
const diff = Date.parse(expiresAt) - Date.now();
if (diff <= 0) return '0s';
const totalSeconds = Math.floor(diff / 1000);
if (totalSeconds < 60) return `${totalSeconds}s`;
const minutes = Math.floor(totalSeconds / 60);
const seconds = totalSeconds % 60;
if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, '0')}`;
const hours = Math.floor(minutes / 60);
const remMinutes = minutes % 60;
return `${hours}:${String(remMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
function formatDuration(ms = 0) {
const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
const minutes = Math.floor(totalSeconds / 60);
const seconds = totalSeconds % 60;
return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
function formatTimerLabel(seconds) {
if (!seconds) return t('بدون تایمر', 'No timer');
if (seconds < 60) return t(`${seconds} ثانیه`, `${seconds}s`);
if (seconds < 3600) return t(`${Math.round(seconds / 60)} دقیقه`, `${Math.round(seconds / 60)}m`);
return t(`${Math.round(seconds / 3600)} ساعت`, `${Math.round(seconds / 3600)}h`);
}
function formatTimerBadge(seconds) {
if (!seconds) return '';
if (seconds < 60) return `${seconds}s`;
if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
return `${Math.round(seconds / 3600)}h`;
}
function currentReactorId() {
return chatState.clientId || chatState.peerId || chatState.identity?.fingerprint || 'local-user';
}
function currentReactorCandidates() {
return new Set([
chatState.clientId,
chatState.peerId,
chatState.identity?.fingerprint,
].filter(Boolean));
}
function resolveRemoteReactorId(session, message) {
const localIds = currentReactorCandidates();
const incomingCandidates = [
message?.reactorId,
message?.clientId,
message?.peerId,
message?.fingerprint,
].filter(Boolean);
const incoming = incomingCandidates.find((candidate) => !localIds.has(candidate));
if (incoming) return incoming;
return session?.remoteClientId || session?.peerId || session?.remoteFingerprint || 'remote-user';
}
function normalizeMessageReactions(entry) {
if (!entry) return {};
if (entry.reactions && typeof entry.reactions === 'object' && !Array.isArray(entry.reactions)) {
return { ...entry.reactions };
}
if (entry.reaction) {
return { legacy: entry.reaction };
}
return {};
}
function summarizeMessageReactions(entry) {
const reactions = normalizeMessageReactions(entry);
const tally = new Map();
Object.values(reactions).forEach((emoji) => {
if (!emoji) return;
tally.set(emoji, (tally.get(emoji) || 0) + 1);
});
return Array.from(tally.entries()).map(([emoji, count]) => ({ emoji, count }));
}
function applyMessageReaction(entry, reaction, reactorId = currentReactorId()) {
if (!entry || !reactorId) return;
const reactions = normalizeMessageReactions(entry);
if (!reaction) delete reactions[reactorId];
else reactions[reactorId] = reaction;
entry.reactions = reactions;
delete entry.reaction;
}
function syncTimerUi() {
const badge = document.getElementById('chatTimerBadge');
const toggle = document.getElementById('chatTimerToggleBtn');
const popover = document.getElementById('chatTimerPopover');
const seconds = Number(chatState.timerSeconds || 0);
if (badge) {
badge.textContent = formatTimerBadge(seconds);
badge.classList.toggle('hidden', !seconds);
}
if (toggle) {
toggle.classList.toggle('active', Boolean(seconds));
toggle.setAttribute('title', seconds ? formatTimerLabel(seconds) : t('پیام خودتخریب', 'Self-destruct message'));
}
if (popover) {
popover.classList.toggle('hidden', !chatState.timerPopoverOpen);
popover.querySelectorAll('[data-chat-timer]').forEach((button) => {
button.classList.toggle('active', Number(button.getAttribute('data-chat-timer') || 0) === seconds);
});
if (chatState.timerPopoverOpen) {
positionTimerPopover();
requestAnimationFrame(positionTimerPopover);
window.setTimeout(positionTimerPopover, 0);
}
}
}
function toggleTimerPopover(force) {
chatState.timerPopoverOpen = typeof force === 'boolean' ? force : !chatState.timerPopoverOpen;
syncTimerUi();
}
function setTimerSeconds(seconds) {
chatState.timerSeconds = Number(seconds || 0);
chatState.timerPopoverOpen = false;
syncTimerUi();
}
function detectComposerDirection(value) {
const text = String(value || '').trim();
if (!text) return language() === 'fa' ? 'rtl' : 'ltr';
// Better RTL detection: check the first letter of the text
const rtlChar = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
return rtlChar.test(text.charAt(0)) ? 'rtl' : 'ltr';
}
function positionTimerPopover() {
const popover = document.getElementById('chatTimerPopover');
const toggle = document.getElementById('chatTimerToggleBtn');
if (!popover || !toggle || popover.classList.contains('hidden')) return;
// Modern check for mobile/PWA standalone
const isMobile = document.documentElement.classList.contains('mobile-browser-context') ||
window.matchMedia('(max-width: 767px)').matches;
if (isMobile) {
// Let CSS handle mobile placement, but clear desktop inline overrides first.
['position', 'z-index', 'top', 'right', 'bottom', 'left', 'inset', 'inset-inline-start', 'inset-inline-end'].forEach((property) => {
popover.style.removeProperty(property);
});
return;
}
const toggleRect = toggle.getBoundingClientRect();
const popoverHeight = popover.offsetHeight || 220;
const popoverWidth = popover.offsetWidth || 180;
// Older responsive override blocks use !important, so desktop placement must
// be set with matching priority after every toggle/open.
popover.style.setProperty('position', 'fixed', 'important');
popover.style.setProperty('z-index', '99999', 'important');
popover.style.setProperty('bottom', 'auto', 'important');
popover.style.setProperty('right', 'auto', 'important');
popover.style.setProperty('inset', 'auto', 'important');
popover.style.setProperty('inset-inline-start', 'auto', 'important');
popover.style.setProperty('inset-inline-end', 'auto', 'important');
// Default: Above the toggle
let top = toggleRect.top - popoverHeight - 10;
let left = toggleRect.right - popoverWidth;
// Boundary checks
if (top < 10) {
// Show below if no space above
top = toggleRect.bottom + 10;
}
if (left < 10) left = 10;
if (left + popoverWidth > window.innerWidth - 10) {
left = window.innerWidth - popoverWidth - 10;
}
popover.style.setProperty('left', left + 'px', 'important');
popover.style.setProperty('top', top + 'px', 'important');
}
function statusLabel(status) {
if (status === 'seen') return '✓✓';
if (status === 'opened') return '✓✓';
if (status === 'delivered') return '✓✓';
if (status === 'queued' || status === 'relayed') return '⏱';
if (status === 'failed') return '!';
return '✓';
}
function pruneExpiredHistory() {
const now = Date.now();
let changed = false;
Object.keys(chatState.history).forEach((key) => {
const current = chatState.history[key];
if (!Array.isArray(current)) return;
const next = current.filter((entry) => {
if (!entry || !entry.expiresAt) return true;
const expiry = Date.parse(entry.expiresAt);
return !isNaN(expiry) && expiry > now;
});
if (next.length !== current.length) {
chatState.history[key] = next;
changed = true;
}
});
return changed;
}
function scheduleExpirySweep() {
if (chatState.expiryTimer) {
clearTimeout(chatState.expiryTimer);
chatState.expiryTimer = null;
}
let nextExpiry = Infinity;
Object.values(chatState.history).forEach((items) => {
(items || []).forEach((entry) => {
if (!entry.expiresAt) return;
const stamp = Date.parse(entry.expiresAt);
if (!isNaN(stamp) && stamp > Date.now()) nextExpiry = Math.min(nextExpiry, stamp);
});
});
if (!Number.isFinite(nextExpiry)) return;
chatState.expiryTimer = setTimeout(() => {
if (pruneExpiredHistory()) storeHistory();
renderPeers();
renderMessages();
scheduleExpirySweep();
}, Math.max(250, nextExpiry - Date.now() + 50));
}
function saveSessionKeys() {
saveEncrypted(CHAT_SESSION_KEYS_STORAGE_KEY, chatState.sessionKeys);
}
async function persistSessionKey(session, rawKey) {
const key = session.peerId || session.remoteFingerprint;
if (!key || !rawKey) return;
const record = {
rawKey: app().arrayBufferToBase64(rawKey),
fingerprint: session.remoteFingerprint || '',
conversationId: session.conversationId || '',
updatedAt: new Date().toISOString(),
};
chatState.sessionKeys[key] = record;
if (session.remoteFingerprint) chatState.sessionKeys[session.remoteFingerprint] = record;
if (session.conversationId) chatState.sessionKeys[session.conversationId] = record;
saveSessionKeys();
}
async function hydrateSessionKey(session) {
const stored = chatState.sessionKeys[session.peerId] || chatState.sessionKeys[session.remoteFingerprint] || chatState.sessionKeys[session.conversationId];
if (!stored?.rawKey || session.cryptoKey) return;
session.cryptoKey = await crypto.subtle.importKey(
'raw',
app().base64ToArrayBuffer(stored.rawKey),
{ name: 'AES-GCM' },
true,
['encrypt', 'decrypt']
);
session.keyReady = true;
}
async function sha256Hex(buffer) {
const hash = await crypto.subtle.digest('SHA-256', buffer);
return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function ensureIdentity() {
if (chatState.identity?.publicKeyData && chatState.identity?.privateKeyData) {
return chatState.identity;
}
const stored = loadEncrypted(CHAT_IDENTITY_STORAGE_KEY, null);
if (stored?.publicKeyData && stored?.privateKeyData) {
chatState.identity = stored;
return stored;
}
if (!isUnlocked()) return null;
const keyPair = await crypto.subtle.generateKey({
name: 'RSA-OAEP',
modulusLength: 3072,
publicExponent: new Uint8Array([1, 0, 1]),
hash: 'SHA-256',
}, true, ['encrypt', 'decrypt']);
const exportedPublic = await crypto.subtle.exportKey('spki', keyPair.publicKey);
const exportedPrivate = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
const identity = {
publicKeyData: app().arrayBufferToBase64(exportedPublic),
privateKeyData: app().arrayBufferToBase64(exportedPrivate),
fingerprint: await sha256Hex(exportedPublic),
createdAt: new Date().toISOString(),
};
chatState.identity = identity;
saveEncrypted(CHAT_IDENTITY_STORAGE_KEY, identity);
return identity;
}
async function importIdentityPublicKey(publicKeyData) {
return crypto.subtle.importKey(
'spki',
app().base64ToArrayBuffer(publicKeyData),
{ name: 'RSA-OAEP', hash: 'SHA-256' },
false,
['encrypt']
);
}
async function importIdentityPrivateKey() {
const identity = await ensureIdentity();
return crypto.subtle.importKey(
'pkcs8',
app().base64ToArrayBuffer(identity.privateKeyData),
{ name: 'RSA-OAEP', hash: 'SHA-256' },
false,
['decrypt']
);
}
function activePeer() {
return allConversationRecords().find((peer) => (
peer.clientId === chatState.activePeerClientId ||
getConversationKey(peer) === chatState.activeConversationId
)) || null;
}
function activeSession() {
const peer = activePeer();
if (!peer || peer.clientId === 'system') return null;
return chatState.sessions.get(peer.peerId) || null;
}
function isCompactChatLayout() {
return window.matchMedia?.('(max-width: 1023px)').matches || false;
}
function updateChatShellMode() {
const shell = document.querySelector('.chat-shell');
if (!shell) return;
const hasConversation = Boolean(getActiveConversation());
shell.classList.toggle('chat-has-conversation', hasConversation);
['chats', 'calls', 'groups', 'connection'].forEach((view) => {
shell.classList.toggle(`chat-view-${view}`, chatState.activeView === view);
});
document.documentElement.classList.toggle('chat-screen-active', appState()?.activeTab === 'chat');
document.documentElement.classList.toggle('chat-conversation-active', hasConversation);
}
function conversationHistory(record) {
const key = getConversationKey(record);
return key ? (chatState.history[key] || []) : [];
}
function saveSpaces() {
chatState.spaces.channels = [];
saveEncrypted(CHAT_SPACES_STORAGE_KEY, {
groups: chatState.spaces.groups,
channels: [],
});
}
function upsertSharedSpace(space) {
if (!space?.conversationId || !space?.type) return null;
if (space.type !== 'group') return null;
if (!spaceIncludesLocalUser(space)) return null;
const collection = chatState.spaces.groups;
const members = normalizeSpaceMembers(space.members);
const existing = collection.find((item) => item.conversationId === space.conversationId);
if (existing) {
const mergedMembers = normalizeSpaceMembers([
...normalizeSpaceMembers(existing.members),
...members,
space.ownerPeerId,
space.ownerClientId,
space.ownerFingerprint,
]);
Object.assign(existing, {
...existing,
...space,
type: 'group',
ownerPeerId: space.ownerPeerId || existing.ownerPeerId || '',
ownerClientId: space.ownerClientId || existing.ownerClientId || '',
ownerFingerprint: space.ownerFingerprint || existing.ownerFingerprint || '',
members: mergedMembers.length ? mergedMembers : normalizeSpaceMembers(existing.members),
});
saveSpaces();
return existing;
}
collection.unshift({
...space,
type: 'group',
ownerPeerId: space.ownerPeerId || '',
ownerClientId: space.ownerClientId || '',
ownerFingerprint: space.ownerFingerprint || '',
members,
});
saveSpaces();
return collection[0];
}
function broadcastSpaceRecord(space) {
if (!space) return;
const memberSet = new Set(Array.isArray(space.members) ? space.members : []);
chatState.peers
.filter((peer) => {
if (peer.status !== 'online' || peer.type || isSelfPeerRecord(peer)) return false;
if (!memberSet.size) return true;
return memberSet.has(getConversationKey(peer)) || memberSet.has(peer.peerId) || memberSet.has(peer.clientId) || memberSet.has(peer.fingerprint);
})
.forEach((peer) => {
sendRelayEnvelope(peer, {
type: 'space-sync',
space,
createdAt: new Date().toISOString(),
});
});
}
function saveCalls() {
saveEncrypted(CHAT_CALLS_STORAGE_KEY, chatState.calls.slice(-80));
}
function appendCall(entry) {
const record = {
id: generateId('call'),
createdAt: new Date().toISOString(),
...entry,
};
chatState.calls.unshift(record);
chatState.calls = chatState.calls.slice(0, 80);
saveCalls();
if (entry.logToChat !== false) {
appendCallHistory(record);
}
renderCalls();
}
function formatCallStatus(status) {
switch (status) {
case 'missed':
return t('بی‌پاسخ', 'Missed');
case 'incoming':
return t('ورودی', 'Incoming');
case 'outgoing':
return t('خروجی', 'Outgoing');
case 'answered':
return t('پاسخ داده شد', 'Answered');
case 'ringing':
return t('در حال زنگ', 'Ringing');
case 'failed':
return t('ناموفق', 'Failed');
case 'rejected':
return t('رد شد', 'Rejected');
case 'ended':
return t('پایان‌یافته', 'Ended');
default:
return status || '-';
}
}
function isMissedCallStatus(status) {
return ['missed', 'failed', 'rejected'].includes(String(status || '').toLowerCase());
}
function callHistoryText(entry = {}) {
const modeLabel = entry.mode === 'video' ? t('تماس تصویری', 'Video call') : t('تماس صوتی', 'Voice call');
const status = String(entry.status || '');
if (status === 'ended' || status === 'answered') {
return t(
`${modeLabel} برقرار شد - مدت ${formatDuration(entry.durationMs)}`,
`${modeLabel} connected - ${formatDuration(entry.durationMs)}`
);
}
if (status === 'rejected') return t(`${modeLabel} رد شد`, `${modeLabel} rejected`);
if (status === 'missed') return t(`${modeLabel} بی‌پاسخ`, `${modeLabel} missed`);
if (status === 'outgoing') return t(`${modeLabel} خروجی`, `${modeLabel} outgoing`);
if (status === 'incoming' || status === 'ringing') return t(`${modeLabel} ورودی`, `${modeLabel} incoming`);
return `${modeLabel} - ${formatCallStatus(status)}`;
}
function appendCallHistory(entry = {}) {
const peer = entry.peerId ? findPeerRecordByPeerId(entry.peerId) : null;
const conversationId = entry.conversationId || getConversationKey(peer) || entry.peerId || entry.fingerprint || '';
if (!conversationId) return;
// Use a stable ID for call logs to prevent duplicates (peerId + status + time-truncated)
// We truncate to minute precision to avoid double logs from near-simultaneous end-call events
const timeBucket = Math.floor(Date.parse(entry.createdAt || new Date()) / 60000);
const stableId = entry.historyId || `call-log-${entry.peerId}-${entry.status}-${timeBucket}`;
appendHistory(conversationId, {
id: stableId,
direction: entry.direction || (entry.status === 'incoming' || entry.status === 'ringing' || entry.status === 'missed' ? 'in' : 'out'),
type: 'call-log',
mode: entry.mode || 'voice',
status: entry.status || 'ended',
durationMs: Number(entry.durationMs || 0),
text: callHistoryText(entry),
createdAt: entry.createdAt || new Date().toISOString(),
});
}
function shortSecurityValue(value, lead = 12, tail = 10) {
const text = String(value || '').trim();
if (!text || text === '-') return '-';
if (text.length <= lead + tail + 1) return text;
return `${text.slice(0, lead)}...${text.slice(-tail)}`;
}
function flushHistoryStore() {
if (chatState.historySaveTimer) {
clearTimeout(chatState.historySaveTimer);
chatState.historySaveTimer = null;
}
saveEncrypted(CHAT_HISTORY_STORAGE_KEY, chatState.history);
}
function storeHistory({ immediate = false } = {}) {
pruneExpiredHistory();
if (immediate) {
flushHistoryStore();
} else if (!chatState.historySaveTimer) {
chatState.historySaveTimer = setTimeout(flushHistoryStore, 1500);
}
scheduleExpirySweep();
}
function loadPersistedChatState() {
const savedProfile = loadEncrypted(CHAT_PROFILE_STORAGE_KEY, null);
if (savedProfile) {
chatState.profile = { ...chatState.profile, ...savedProfile };
} else {
chatState.profile.serverUrl = window.location.origin;
chatState.profile.name = language() === 'fa' ? 'کاربر P00RIJA' : 'P00RIJA User';
}
if (!chatState.profile.stablePeerId) {
chatState.profile.stablePeerId = generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-');
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
}
const savedHistory = loadEncrypted(CHAT_HISTORY_STORAGE_KEY, {});
if (savedHistory && typeof savedHistory === 'object') {
Object.keys(savedHistory).forEach((key) => {
if (!Array.isArray(savedHistory[key])) {
savedHistory[key] = [];
}
});
chatState.history = savedHistory;
}
const savedSessionKeys = loadEncrypted(CHAT_SESSION_KEYS_STORAGE_KEY, {});
if (savedSessionKeys && typeof savedSessionKeys === 'object') {
chatState.sessionKeys = savedSessionKeys;
}
const savedSpaces = loadEncrypted(CHAT_SPACES_STORAGE_KEY, null);
if (savedSpaces?.groups || savedSpaces?.channels) {
chatState.spaces = {
groups: Array.isArray(savedSpaces.groups) ? savedSpaces.groups : [],
channels: [],
};
}
const savedCalls = loadEncrypted(CHAT_CALLS_STORAGE_KEY, []);
if (Array.isArray(savedCalls)) {
chatState.calls = savedCalls.slice(-80);
}
const savedContacts = loadEncrypted(CHAT_CONTACTS_STORAGE_KEY, []);
if (Array.isArray(savedContacts) && savedContacts.length) {
chatState.peers = savedContacts
.map((peer) => normalizePeerRecord(peer))
.filter((peer) => peer.peerId && !isSelfPeerRecord(peer))
.map((peer) => ({
...peer,
status: peer.status || 'offline',
}));
}
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
saveEncrypted(CHAT_HISTORY_STORAGE_KEY, chatState.history);
saveEncrypted(CHAT_SESSION_KEYS_STORAGE_KEY, chatState.sessionKeys);
saveEncrypted(CHAT_SPACES_STORAGE_KEY, chatState.spaces);
saveEncrypted(CHAT_CALLS_STORAGE_KEY, chatState.calls.slice(-80));
saveContacts();
}
function saveProfile() {
const profile = buildProfileDraft();
if (chatState.pendingAvatarData) {
profile.avatarData = chatState.pendingAvatarData;
chatState.pendingAvatarData = '';
}
chatState.profile = profile;
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, profile);
renderStaticUi();
broadcastHello();
notify(t('پروفایل چت ذخیره شد', 'Chat profile saved'), 'success');
}
function sessionSecurityText(session) {
if (!session?.cryptoKey) {
return t('منتظر تبادل کلید RSA -> AES-GCM', 'Waiting for RSA -> AES-GCM key exchange');
}
return t('RSA-OAEP-3072 + AES-256-GCM', 'RSA-OAEP-3072 + AES-256-GCM');
}
function setConnectionState(connected, label) {
chatState.connected = connected;
const dot = document.getElementById('chatConnectionDot');
const status = document.getElementById('chatConnectionStatus');
if (dot) {
dot.style.background = '';
dot.style.boxShadow = '';
dot.classList.toggle('online', connected);
}
if (status) {
status.textContent = label || (connected ? t('متصل', 'Connected') : t('عدم اتصال', 'Disconnected'));
status.title = label || '';
}
}
function syncComposerDirection() {
const composer = document.getElementById('chatComposer');
if (!composer) return;
const nextDir = detectComposerDirection(composer.value);
composer.dir = nextDir;
composer.style.textAlign = nextDir === 'rtl' ? 'right' : 'left';
}
function syncComposerViewportFocus(focused = false, isTyping = false) {
const shouldFocus = Boolean(focused && isCompactChatLayout() && appState()?.activeTab === 'chat');
document.documentElement.classList.toggle('chat-composer-focused', shouldFocus);
if (!shouldFocus) return;
const syncFocusLayout = () => {
const panel = document.getElementById('chatMessages');
if (!panel) return;
// If typing, only scroll if we are already near the bottom to avoid jitter
if (isTyping) {
const isNearBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 40;
if (isNearBottom) {
panel.scrollTop = panel.scrollHeight;
}
} else {
panel.scrollTop = panel.scrollHeight;
}
};
// Single sync for typing, multiple for initial focus/resizing
if (isTyping) {
window.requestAnimationFrame(syncFocusLayout);
} else {
window.setTimeout(syncFocusLayout, 40);
window.setTimeout(syncFocusLayout, 150);
window.setTimeout(syncFocusLayout, 300);
}
}
function focusComposerWithoutPageJump(composer = document.getElementById('chatComposer')) {
if (!composer) return;
try {
composer.focus({ preventScroll: true });
} catch (error) {
composer.focus();
}
window.setTimeout(() => {
if (!isCompactChatLayout()) return;
document.documentElement.scrollTop = 0;
document.body.scrollTop = 0;
window.scrollTo(0, 0);
syncComposerViewportFocus(true);
}, 0);
}
function renderStaticUi() {
if (!document.getElementById('content-chat')) return;
document.getElementById('chatProfileName').value = chatState.profile.name || '';
document.getElementById('chatProfileName').placeholder = t('نام نمایشی', 'Display name');
document.getElementById('chatServerUrl').value = chatState.profile.serverUrl || (window.location.protocol === 'file:' ? 'http://127.0.0.1:9000' : window.location.origin);
document.getElementById('chatAutoConnect').checked = Boolean(chatState.profile.autoConnect);
document.getElementById('chatAllowVideo').checked = Boolean(chatState.profile.allowVideo);
document.getElementById('chatAutoDiscovery').checked = Boolean(chatState.profile.autoDiscovery);
document.getElementById('chatShowSuspensionCountdown').checked = chatState.profile.showSuspensionCountdown !== false;
syncChatToggleStates();
document.getElementById('chatTurnUrl').value = chatState.profile.turnUrl || '';
document.getElementById('chatTurnUsername').value = chatState.profile.turnUsername || '';
document.getElementById('chatTurnCredential').value = chatState.profile.turnCredential || '';
document.getElementById('chatSearchInput').placeholder = t('جستجو در چت‌ها و پیام‌ها', 'Search chats and messages');
document.getElementById('chatComposer').placeholder = t('پیام امن شما…', 'Your secure message...');
renderRingtoneSettings();
document.getElementById('chatTimerToggleBtn')?.setAttribute('title', t('پیام خودتخریب', 'Self-destruct message'));
const controlLabels = {
chatStartSessionBtn: t('ساخت سشن امن', 'Create secure session'),
chatVoiceCallBtn: t('تماس صوتی', 'Voice call'),
chatVideoCallBtn: t('تماس تصویری', 'Video call'),
chatEndCallBtn: t('پایان تماس', 'End call'),
chatSendMessageBtn: t('ارسال', 'Send'),
chatSendFileBtn: t('ارسال فایل', 'Send file'),
chatVoiceMessageBtn: t('پیام صوتی', 'Voice message'),
chatMinimizeCallBtn: t('بازگشت به چت / حالت شناور', 'Return to chat / floating mode'),
chatFloatingEndCallBtn: t('پایان تماس', 'End call'),
chatSpeakerToggleBtn: t('اسپیکر', 'Speaker'),
chatHoldToggleBtn: t('هولد', 'Hold'),
chatMuteToggleBtn: t('بی‌صدا', 'Mute'),
chatSwapVideoLayoutBtn: t('جابجایی', 'View'),
chatFlipCameraBtn: t('چرخش', 'Flip'),
chatVideoToggleBtn: t('ویدیو', 'Video'),
chatScreenShareBtn: t('اشتراک صفحه', 'Screen share'),
chatDeleteConversationBtn: t('حذف گفتگو', 'Delete conversation'),
chatEndCallControlBtn: t('پایان', 'End'),
};
Object.entries(controlLabels).forEach(([id, label]) => {
const button = document.getElementById(id);
if (!button) return;
button.setAttribute('title', label);
const textNode = button.querySelector('span');
if (textNode) textNode.textContent = label;
});
const localPeerId = chatState.peerId || chatState.clientId || '-';
const localFingerprint = chatState.identity?.fingerprint || '-';
document.getElementById('chatPeerId').textContent = shortSecurityValue(localPeerId);
document.getElementById('chatPeerId').title = localPeerId;
document.getElementById('chatFingerprint').textContent = shortSecurityValue(localFingerprint);
document.getElementById('chatFingerprint').title = localFingerprint;
document.getElementById('chatServerMeta').textContent = t(
`Signal: ${chatServerOrigin()} | WebSocket: ${wsUrl()}`,
`Signal: ${chatServerOrigin()} | WebSocket: ${wsUrl()}`
);
const restrictionBanner = document.getElementById('chatRestrictionBanner');
if (restrictionBanner) {
restrictionBanner.textContent = restrictionText();
restrictionBanner.classList.toggle('hidden', !hasActiveServerRestriction());
}
const avatarText = document.getElementById('chatProfileAvatarText');
const avatarImage = document.getElementById('chatProfileAvatarImage');
if (avatarText) avatarText.textContent = initials(chatState.profile.name);
if (avatarImage) {
const previewAvatar = chatState.pendingAvatarData || chatState.profile.avatarData || '';
avatarImage.src = previewAvatar;
avatarImage.classList.toggle('hidden', !previewAvatar);
avatarText?.classList.toggle('hidden', Boolean(previewAvatar));
}
const saveAvatarBtn = document.getElementById('chatAvatarSaveBtn');
if (saveAvatarBtn) {
saveAvatarBtn.disabled = !chatState.pendingAvatarData;
}
const showQrBtn = document.getElementById('chatShowIdentityQrBtn');
if (showQrBtn) showQrBtn.disabled = false;
syncComposerDirection();
}
function allConversationRecords() {
const direct = chatState.peers.filter((peer) => peer.peerId && !isSelfPeerRecord(peer));
const result = [
...direct,
...chatState.spaces.groups,
...chatState.spaces.channels,
];
if (chatState.history['system']?.length > 0) {
result.push({
clientId: 'system',
peerId: 'system',
conversationId: 'system',
type: 'system',
username: t('اعلان‌های سیستم', 'System Broadcasts'),
status: 'online',
system: true,
avatarData: '',
lastSeenAt: chatState.history['system'].slice(-1)[0]?.timestamp || 0
});
}
return result;
}
function conversationRecordById(conversationId) {
return allConversationRecords().find((record) => getConversationKey(record) === conversationId) || null;
}
function unreadConversationCount(conversationId) {
return (chatState.history[conversationId] || []).filter((entry) => {
if (!entry.unread || entry.direction !== 'in') return false;
if (entry.type === 'call-log') return isMissedCallStatus(entry.status) || entry.status === 'ringing' || entry.status === 'incoming';
return true;
}).length;
}
function isConversationCurrentlyVisible(conversationId) {
return Boolean(
conversationId
&& conversationId === chatState.activeConversationId
&& !document.hidden
&& appState()?.activeTab === 'chat'
&& !['calls', 'connection'].includes(chatState.activeView)
);
}
function markConversationRead(conversationId) {
const history = chatState.history[conversationId] || [];
let changed = false;
let cleared = 0;
history.forEach((entry) => {
if (entry.unread) {
entry.unread = false;
changed = true;
cleared += 1;
}
});
if (changed) {
storeHistory();
window.dispatchEvent(new CustomEvent('poorija:chat-read', {
detail: { conversationId, count: cleared }
}));
}
return changed;
}
function pinnedRecords() {
return allConversationRecords()
.filter((record) => record.pinned)
.sort((a, b) => (a.pinOrder || 0) - (b.pinOrder || 0))
.slice(0, 5);
}
function shouldShowConversation(record) {
if (!record) return false;
if (record.system || record.type) return true;
const key = getConversationKey(record);
return Boolean(record.manual || record.pinned || conversationHistory(record).length > 0 || chatState.sessionKeys[record.peerId] || chatState.sessionKeys[record.fingerprint] || chatState.activeConversationId === key);
}
function nextPinOrder() {
const max = Math.max(0, ...allConversationRecords().map((record) => Number(record.pinOrder || 0)));
return max + 1;
}
function toggleConversationPin(conversationId) {
const record = conversationRecordById(conversationId);
if (!record) return;
if (!record.pinned && pinnedRecords().length >= 5) {
notify(t('حداکثر ۵ چت را می‌توانید پین کنید.', 'You can pin up to 5 chats.'), 'warning');
return;
}
record.pinned = !record.pinned;
record.pinOrder = record.pinned ? (record.pinOrder || nextPinOrder()) : 0;
saveContacts();
saveSpaces();
renderPeers();
}
function movePinnedConversation(conversationId, direction) {
const pins = pinnedRecords();
const index = pins.findIndex((record) => getConversationKey(record) === conversationId);
const nextIndex = index + direction;
if (index < 0 || nextIndex < 0 || nextIndex >= pins.length) return;
const current = pins[index];
const next = pins[nextIndex];
const temp = current.pinOrder || index + 1;
current.pinOrder = next.pinOrder || nextIndex + 1;
next.pinOrder = temp;
saveContacts();
saveSpaces();
renderPeers();
}
function searchableMessageText(entry = {}) {
return [
entry.text,
entry.name,
entry.type === 'call-log' ? callHistoryText(entry) : '',
entry.type === 'voice' ? t('پیام صوتی', 'Voice message') : '',
entry.type === 'file' ? t('فایل', 'File') : '',
].filter(Boolean).join(' ');
}
function notificationMessageLabel(entry = {}) {
if (entry.type === 'text') return entry.text || t('پیام جدید', 'New message');
if (entry.type === 'voice') return t('پیام صوتی جدید', 'New voice message');
if (entry.type === 'file') return entry.name || t('فایل جدید', 'New file');
if (entry.type === 'call-log') return callHistoryText(entry);
return t('پیام جدید', 'New message');
}
function messageMatchesSearch(entry, query) {
const normalized = String(query || '').trim().toLowerCase();
if (!normalized) return false;
return searchableMessageText(entry).toLowerCase().includes(normalized);
}
function activateFirstSearchResult(query) {
const normalized = String(query || '').trim().toLowerCase();
if (!normalized) return false;
const current = getActiveConversation();
const currentKey = current ? getConversationKey(current) : '';
if ((chatState.history[currentKey] || []).some((entry) => messageMatchesSearch(entry, normalized))) {
return true;
}
const match = allConversationRecords().find((record) => {
const key = getConversationKey(record);
return (chatState.history[key] || []).some((entry) => messageMatchesSearch(entry, normalized));
});
if (!match) return false;
chatState.activeConversationId = getConversationKey(match);
chatState.activePeerClientId = match.type ? '' : (match.clientId || '');
chatState.activeView = match.type === 'group' ? 'groups' : 'chats';
updateChatShellMode();
return true;
}
function renderPeers() {
const list = document.getElementById('chatPeerList');
const count = document.getElementById('chatPeerCount');
if (!list || !count) return;
renderSpaceMemberPickers();
renderSpaceMemberManager();
if (chatState.activeView === 'connection') {
document.getElementById('chatListTitle').textContent = t('اتصال و TURN', 'Connection & TURN');
count.textContent = chatState.connected ? t('متصل', 'Connected') : t('آفلاین', 'Offline');
list.innerHTML = `<div class="chat-empty-state">${t('تنظیمات اتصال، TURN و صدای تماس در تب اتصال قرار دارد.', 'Connection, TURN, and ringtone settings are available in the Connection tab.')}</div>`;
return;
}
const query = chatState.searchQuery.trim().toLowerCase();
const allPeers = allConversationRecords()
.filter((peer) => peer.type !== 'group')
.filter((peer) => shouldShowConversation(peer));
allPeers.sort((left, right) => {
const leftPinned = left.pinned ? 1 : 0;
const rightPinned = right.pinned ? 1 : 0;
if (leftPinned !== rightPinned) return rightPinned - leftPinned;
if (leftPinned && rightPinned) return (left.pinOrder || 0) - (right.pinOrder || 0);
const leftOnline = left.status === 'online' ? 1 : 0;
const rightOnline = right.status === 'online' ? 1 : 0;
if (leftOnline !== rightOnline) return rightOnline - leftOnline;
const leftStamp = new Date((conversationHistory(left).slice(-1)[0]?.createdAt || conversationHistory(left).slice(-1)[0]?.timestamp) || left.lastSeenAt || 0).getTime();
const rightStamp = new Date((conversationHistory(right).slice(-1)[0]?.createdAt || conversationHistory(right).slice(-1)[0]?.timestamp) || right.lastSeenAt || 0).getTime();
return rightStamp - leftStamp;
});
const onlinePeers = allPeers.filter((peer) => peer.status === 'online');
if ((chatState.activePeerClientId || chatState.activeConversationId) && !activePeer() && chatState.activeView === 'chats') {
chatState.activePeerClientId = '';
chatState.activeConversationId = '';
}
if (!isCompactChatLayout() && chatState.activeView === 'chats' && !chatState.activePeerClientId && !chatState.activeConversationId && (onlinePeers.length || allPeers.length)) {
const seedPeer = onlinePeers[0] || allPeers[0];
if (seedPeer) {
chatState.activePeerClientId = seedPeer.clientId;
chatState.activeConversationId = getConversationKey(seedPeer);
}
}
let records = allPeers;
let title = t('چت‌ها', 'Chats');
if (chatState.activeView === 'groups') {
records = chatState.spaces.groups;
title = t('گروه‌ها', 'Groups');
} else if (chatState.activeView === 'calls') {
renderCalls();
return;
}
if (query) {
records = records.filter((record) => {
const haystack = [
record.username,
record.name,
record.peerId,
record.fingerprint,
...conversationHistory(record).map((entry) => entry.text || entry.name || ''),
].join(' ').toLowerCase();
return haystack.includes(query);
});
}
document.getElementById('chatListTitle').textContent = title;
count.textContent = chatState.activeView === 'chats'
? t(`${onlinePeers.length} آنلاین`, `${onlinePeers.length} online`)
: String(records.length);
if (!records.length) {
list.innerHTML = `<div class="chat-empty-state">${query ? t('چیزی پیدا نشد.', 'No results found.') : t('هنوز موردی وجود ندارد.', 'Nothing here yet.')}</div>`;
return;
}
list.innerHTML = records.map((record) => {
const key = getConversationKey(record);
const history = conversationHistory(record);
const last = history[history.length - 1];
const displayName = record.username || record.name || record.clientId || key;
const active = key === chatState.activeConversationId || record.clientId === chatState.activePeerClientId;
const isSecure = Boolean(record.type || chatState.sessions.get(record.peerId)?.cryptoKey || chatState.sessionKeys[record.peerId] || chatState.sessionKeys[record.fingerprint]);
const online = record.status === 'online';
const isSystem = record.system === true;
const previewLine = last?.text
|| last?.name
|| (record.type === 'group' ? t('گروه محلی', 'Local group') : '')
|| (online ? t('متصل', 'Connected') : t('عدم اتصال', 'Offline'));
const unreadCount = unreadConversationCount(key);
const pinned = Boolean(record.pinned);
const avatarContent = isSystem
? '<i class="fas fa-bullhorn text-lg"></i>'
: (record.avatarData ? `<img src="${record.avatarData}" alt="">` : app().escapeHTML(initials(displayName)));
return `
<div role="button" tabindex="0" data-chat-conversation="${app().escapeHTML(key)}" data-chat-peer="${app().escapeHTML(record.clientId || '')}" class="chat-peer-card w-full text-right ${active ? 'active' : ''} ${pinned ? 'is-pinned' : ''}">
<div class="flex items-center gap-3 min-w-0">
<div class="chat-avatar chat-peer-avatar ${online ? 'online' : 'offline'}">
${avatarContent}
${unreadCount ? `<span class="chat-unread-badge">${Math.min(99, unreadCount)}</span>` : ''}
</div>
<div class="min-w-0 flex-1">
<div class="flex items-center justify-between gap-2 min-w-0">
<div class="flex items-center gap-2 min-w-0">
<span class="chat-peer-presence-dot ${online ? 'online' : 'offline'}" aria-hidden="true"></span>
<div class="font-semibold text-white truncate">${app().escapeHTML(displayName)}</div>
${isSecure ? '<span class="text-emerald-300 text-xs"><i class="fas fa-lock"></i></span>' : ''}
${pinned ? '<span class="text-amber-300 text-xs"><i class="fas fa-thumbtack"></i></span>' : ''}
</div>
<span class="chat-peer-status-badge ${online ? 'online' : 'offline'}">${online ? t('متصل', 'Connected') : t('عدم اتصال', 'Offline')}</span>
</div>
<div class="flex items-center justify-between gap-3 min-w-0 mt-1">
<div class="text-xs text-slate-400 truncate">${app().escapeHTML(previewLine)}</div>
<span class="text-[11px] text-slate-500 shrink-0">${last ? formatTime(last.createdAt) : (record.lastSeenAt ? formatTime(record.lastSeenAt) : '')}</span>
</div>
<div class="chat-pin-actions">
<button type="button" data-chat-pin-conversation="${app().escapeHTML(key)}" title="${pinned ? t('برداشتن پین', 'Unpin') : t('پین کردن', 'Pin')}"><i class="fas fa-thumbtack"></i></button>
${pinned ? `<button type="button" data-chat-pin-move="${app().escapeHTML(key)}" data-chat-pin-direction="-1" title="${t('بالا', 'Move up')}"><i class="fas fa-chevron-up"></i></button><button type="button" data-chat-pin-move="${app().escapeHTML(key)}" data-chat-pin-direction="1" title="${t('پایین', 'Move down')}"><i class="fas fa-chevron-down"></i></button>` : ''}
</div>
</div>
</div>
</div>
`;
}).join('');
list.querySelectorAll('[data-chat-conversation]').forEach((button) => {
button.addEventListener('click', (event) => {
if (event.target.closest('[data-chat-pin-conversation], [data-chat-pin-move]')) return;
chatState.activePeerClientId = button.getAttribute('data-chat-peer');
chatState.activeConversationId = button.getAttribute('data-chat-conversation');
markConversationRead(chatState.activeConversationId);
updateChatShellMode();
renderPeers();
renderActivePeer();
});
button.addEventListener('keydown', (event) => {
if (event.key !== 'Enter' && event.key !== ' ') return;
event.preventDefault();
button.click();
});
});
list.querySelectorAll('[data-chat-pin-conversation]').forEach((button) => {
button.addEventListener('click', (event) => {
event.stopPropagation();
toggleConversationPin(button.dataset.chatPinConversation);
});
});
list.querySelectorAll('[data-chat-pin-move]').forEach((button) => {
button.addEventListener('click', (event) => {
event.stopPropagation();
movePinnedConversation(button.dataset.chatPinMove, Number(button.dataset.chatPinDirection || 0));
});
});
}
async function copyChatFullIdentity() {
await ensureIdentity();
if (!chatState.profile.stablePeerId) {
chatState.profile.stablePeerId = generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-');
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
}
const text = identityText();
navigator.clipboard.writeText(text).then(() => {
notify(t('هویت شما کپی شد', 'Full identity copied to clipboard'), 'success');
}).catch(() => {
notify(t('خطا در کپی', 'Copy failed'), 'error');
});
}
window.copyChatFullIdentity = copyChatFullIdentity;
function ensureIdentityQrModal() {
let modal = document.getElementById('chatIdentityQrModal');
if (modal) return modal;
modal = document.createElement('div');
modal.id = 'chatIdentityQrModal';
modal.className = 'chat-modal hidden';
modal.innerHTML = `
<div class="chat-modal-card">
<button type="button" class="chat-modal-close" data-chat-modal-close><i class="fas fa-xmark"></i></button>
<h3>${t('QR Code هویت چت', 'Chat identity QR code')}</h3>
<div id="chatIdentityQrBox" class="chat-qr-box"></div>
<p class="chat-help-note">${t('با کلیک روی QR، محتوای کامل آن در کلیپ‌بورد کپی می‌شود.', 'Click the QR to copy its full content.')}</p>
</div>`;
document.body.appendChild(modal);
modal.querySelector('[data-chat-modal-close]')?.addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', (event) => {
if (event.target === modal) modal.classList.add('hidden');
});
return modal;
}
async function showChatIdentityQr() {
try {
await ensureIdentity();
const modal = ensureIdentityQrModal();
const box = modal.querySelector('#chatIdentityQrBox');
const content = identityText();
modal.classList.remove('hidden');
box.innerHTML = '';
try {
if (typeof QRCode !== 'undefined') {
new QRCode(box, {
text: content,
width: 240,
height: 240,
correctLevel: QRCode.CorrectLevel.L
});
} else {
box.textContent = content;
}
} catch (err) {
console.error('QR Generation failed:', err);
box.textContent = content;
}
box.onclick = () => navigator.clipboard.writeText(content)
.then(() => notify(t('محتوای QR کپی شد', 'QR content copied'), 'success'))
.catch(() => notify(t('کپی QR ناموفق بود', 'Could not copy QR content'), 'error'));
} catch (error) {
console.error('Fatal showChatIdentityQr:', error);
notify(t('خطا در نمایش QR: ', 'Error showing QR: ') + (error.message || 'Unknown'), 'error');
}
}
function addIdentityAsConversation(identity, { startSession = true } = {}) {
if (!identity?.peerId && !identity?.fingerprint) {
notify(t('هویت چت معتبر نیست.', 'Invalid chat identity.'), 'warning');
return null;
}
const record = mergePeerRecord({
clientId: identity.peerId || identity.fingerprint,
peerId: identity.peerId || identity.fingerprint,
username: identity.name || identity.peerId || t('کاربر', 'User'),
name: identity.name || '',
fingerprint: identity.fingerprint || '',
publicKeyData: identity.publicKeyData || '',
avatarData: identity.avatarData || '',
manual: true,
status: 'offline',
}, { online: false });
if (!record) return null;
record.manual = true;
saveContacts();
chatState.activePeerClientId = record.clientId;
chatState.activeConversationId = getConversationKey(record);
setChatView('chats');
renderPeers();
renderActivePeer();
if (startSession) {
connectChatTransport().then(() => startSecureSession(record, { silent: false })).catch(console.error);
}
if (chatState.ws && chatState.ws.readyState === 1) {
chatState.ws.send(JSON.stringify({ type: 'get-peers' }));
}
return record;
}
function ensureStartChatModal() {
let modal = document.getElementById('chatStartChatModal');
if (modal) return modal;
modal = document.createElement('div');
modal.id = 'chatStartChatModal';
modal.className = 'chat-modal hidden';
modal.innerHTML = `
<div class="chat-modal-card">
<button type="button" class="chat-modal-close" data-chat-modal-close><i class="fas fa-xmark"></i></button>
<h3>${t('شروع چت', 'Start chat')}</h3>
<div class="chat-start-actions">
<button type="button" data-chat-start-manual class="chat-primary-btn"><i class="fas fa-keyboard"></i><span>${t('دستی', 'Manual')}</span></button>
<button type="button" data-chat-start-auto class="chat-soft-btn"><i class="fas fa-clipboard"></i><span>${isCompactChatLayout() ? t('اسکن QR Code', 'Scan QR Code') : t('اتوماتیک از کلیپ‌بورد', 'Auto from clipboard')}</span></button>
</div>
<div data-chat-manual-form class="chat-manual-form hidden">
<input data-chat-manual-peer type="text" placeholder="${t('شناسه PEER', 'Peer ID')}">
<input data-chat-manual-key type="text" placeholder="${t('کلید امنیتی', 'Security key')}">
<textarea data-chat-manual-json rows="3" placeholder="${t('یا هویت کامل/JSON را اینجا بگذارید', 'Or paste full identity/JSON here')}"></textarea>
<button type="button" data-chat-manual-submit class="chat-primary-btn">${t('ساخت سشن', 'Create session')}</button>
</div>
<video data-chat-qr-video class="chat-qr-video hidden" autoplay playsinline muted></video>
<div class="chat-qr-fallback">
<button type="button" data-chat-qr-file-btn class="chat-soft-btn"><i class="fas fa-image"></i><span>${t('اسکن از تصویر ذخیره‌شده', 'Scan saved image')}</span></button>
<input data-chat-qr-file type="file" accept="image/*" class="hidden">
</div>
</div>`;
document.body.appendChild(modal);
modal.querySelector('[data-chat-modal-close]')?.addEventListener('click', () => closeStartChatModal());
modal.addEventListener('click', (event) => {
if (event.target === modal) closeStartChatModal();
});
modal.querySelector('[data-chat-start-manual]')?.addEventListener('click', () => {
modal.querySelector('[data-chat-manual-form]')?.classList.toggle('hidden');
});
modal.querySelector('[data-chat-start-auto]')?.addEventListener('click', () => {
if (isCompactChatLayout()) scanChatIdentityQr();
else importChatIdentityFromClipboard();
});
modal.querySelector('[data-chat-manual-submit]')?.addEventListener('click', () => {
const raw = modal.querySelector('[data-chat-manual-json]')?.value || '';
const parsed = parseIdentityText(raw) || {
peerId: modal.querySelector('[data-chat-manual-peer]')?.value.trim(),
fingerprint: modal.querySelector('[data-chat-manual-key]')?.value.trim(),
name: '',
};
if (addIdentityAsConversation(parsed)) closeStartChatModal();
});
modal.querySelector('[data-chat-qr-file-btn]')?.addEventListener('click', () => modal.querySelector('[data-chat-qr-file]')?.click());
modal.querySelector('[data-chat-qr-file]')?.addEventListener('change', async (event) => {
const file = event.target.files?.[0];
event.target.value = '';
if (file) await scanQrImageFile(file);
});
return modal;
}
function closeStartChatModal() {
const modal = document.getElementById('chatStartChatModal');
stopQrScanner();
modal?.classList.add('hidden');
}
function openStartChatModal() {
ensureStartChatModal().classList.remove('hidden');
}
async function importChatIdentityFromClipboard() {
try {
let text = '';
if (navigator.clipboard?.readText) {
text = await navigator.clipboard.readText();
} else {
text = window.prompt(t('هویت کامل یا JSON را وارد کنید', 'Paste the full identity or JSON')) || '';
}
const parsed = parseIdentityText(text);
if (!parsed) {
notify(t('هویت معتبری در کلیپ‌بورد پیدا نشد.', 'No valid identity was found in clipboard.'), 'warning');
return;
}
if (addIdentityAsConversation(parsed)) closeStartChatModal();
} catch (error) {
const fallback = window.prompt(t('خواندن کلیپ‌بورد ناموفق بود. هویت کامل را دستی وارد کنید:', 'Clipboard access failed. Paste the full identity manually:')) || '';
const parsed = parseIdentityText(fallback);
if (parsed && addIdentityAsConversation(parsed)) closeStartChatModal();
else notify(t('خواندن کلیپ‌بورد ناموفق بود.', 'Could not read clipboard.'), 'error');
}
}
async function handleScannedIdentity(rawValue) {
const parsed = parseIdentityText(rawValue);
if (!parsed) return false;
stopQrScanner();
if (addIdentityAsConversation(parsed)) closeStartChatModal();
return true;
}
function stopQrScanner() {
const scanner = chatState.qrScanner;
if (!scanner) return;
if (scanner.timer) clearInterval(scanner.timer);
if (scanner.animationFrame) cancelAnimationFrame(scanner.animationFrame);
scanner.stream?.getTracks?.().forEach((track) => track.stop());
chatState.qrScanner = null;
}
async function scanChatIdentityQr() {
if (!navigator.mediaDevices?.getUserMedia) {
notify(t('دسترسی دوربین در این محیط پشتیبانی نمی‌شود؛ از ورود دستی یا تصویر ذخیره‌شده استفاده کنید.', 'Camera access is not available here; use manual entry or a saved image.'), 'warning');
return;
}
const modal = ensureStartChatModal();
const video = modal.querySelector('[data-chat-qr-video]');
try {
stopQrScanner();
const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
video.srcObject = stream;
video.classList.remove('hidden');
await video.play();
if ('BarcodeDetector' in window) {
const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
const timer = setInterval(async () => {
try {
const codes = await detector.detect(video);
const rawValue = codes[0]?.rawValue || '';
if (rawValue) await handleScannedIdentity(rawValue);
} catch (_error) {}
}, 700);
chatState.qrScanner = { stream, timer };
return;
}
if (!window.jsQR) {
chatState.qrScanner = { stream };
notify(t('اسکنر QR محلی بارگذاری نشده؛ از ورود دستی استفاده کنید.', 'Local QR scanner is not loaded; use manual entry.'), 'warning');
return;
}
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const scanFrame = async () => {
if (!chatState.qrScanner) return;
if (!ctx || video.readyState < 2) {
chatState.qrScanner.animationFrame = requestAnimationFrame(scanFrame);
return;
}
canvas.width = video.videoWidth || 640;
canvas.height = video.videoHeight || 480;
ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const code = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
if (code?.data && await handleScannedIdentity(code.data)) return;
chatState.qrScanner.animationFrame = requestAnimationFrame(scanFrame);
};
chatState.qrScanner = { stream, animationFrame: requestAnimationFrame(scanFrame) };
} catch (error) {
notify(t('فعال‌سازی دوربین برای اسکن QR ناموفق بود.', 'Could not start camera for QR scanning.'), 'error');
}
}
async function scanQrImageFile(file) {
if (!file?.type?.startsWith('image/')) return;
if (!window.jsQR) {
notify(t('اسکنر QR محلی بارگذاری نشده است.', 'Local QR scanner is not loaded.'), 'warning');
return;
}
const image = new Image();
const url = URL.createObjectURL(file);
image.onload = async () => {
try {
const canvas = document.createElement('canvas');
canvas.width = image.naturalWidth || image.width;
canvas.height = image.naturalHeight || image.height;
const ctx = canvas.getContext('2d', { willReadFrequently: true });
ctx.drawImage(image, 0, 0);
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const code = window.jsQR(imageData.data, imageData.width, imageData.height);
if (!code?.data || !await handleScannedIdentity(code.data)) {
notify(t('در این تصویر QR معتبر پیدا نشد.', 'No valid QR code was found in this image.'), 'warning');
}
} finally {
URL.revokeObjectURL(url);
}
};
image.onerror = () => {
URL.revokeObjectURL(url);
notify(t('خواندن تصویر QR ناموفق بود.', 'Could not read the QR image.'), 'error');
};
image.src = url;
}
function renderCalls() {
const list = document.getElementById('chatPeerList');
const callsPanelList = document.getElementById('chatCallsList');
const callsFilterTabs = document.getElementById('chatCallsFilterTabs');
const count = document.getElementById('chatPeerCount');
const title = document.getElementById('chatListTitle');
if (title) title.textContent = t('تماس‌ها', 'Calls');
const filters = [
{ id: 'incoming', label: t('ورودی', 'Incoming'), predicate: (call) => call.direction === 'in' && !isMissedCallStatus(call.status) },
{ id: 'outgoing', label: t('خروجی', 'Outgoing'), predicate: (call) => call.direction === 'out' && !isMissedCallStatus(call.status) },
{ id: 'missed', label: t('بی‌پاسخ', 'Missed'), predicate: (call) => isMissedCallStatus(call.status) },
];
if (!filters.some((filter) => filter.id === chatState.callFilter)) chatState.callFilter = 'incoming';
const activeFilter = filters.find((filter) => filter.id === chatState.callFilter) || filters[0];
const tabHtml = filters.map((filter) => {
const filterCount = chatState.calls.filter(filter.predicate).length;
return `
<button type="button" class="chat-call-filter-tab ${filter.id === chatState.callFilter ? 'active' : ''}" data-chat-call-filter="${filter.id}">
<span>${filter.label}</span>
<strong>${filterCount}</strong>
</button>
`;
}).join('');
if (callsFilterTabs) callsFilterTabs.innerHTML = tabHtml;
const groups = new Map();
const filteredCalls = chatState.calls.filter(activeFilter.predicate);
if (count) count.textContent = String(filteredCalls.length);
filteredCalls.forEach((call) => {
const key = call.peerId || call.name || 'unknown';
if (!groups.has(key)) groups.set(key, []);
groups.get(key).push(call);
});
const rows = groups.size
? Array.from(groups.values()).map((items) => {
const latest = items[0];
const missedCount = items.filter((call) => isMissedCallStatus(call.status)).length;
const modeLabel = latest.mode === 'video' ? t('تصویری', 'Video') : t('صوتی', 'Voice');
return `
<details class="chat-call-accordion"${missedCount ? ' open' : ''}>
<summary class="chat-peer-card chat-call-summary ${isMissedCallStatus(latest.status) ? 'missed' : ''}">
<div class="min-w-0">
<div class="font-semibold text-white truncate">${app().escapeHTML(latest.name || latest.peerId || '-')}</div>
<div class="text-xs mt-1 ${isMissedCallStatus(latest.status) ? 'text-rose-300' : 'text-slate-400'}">
${app().escapeHTML(modeLabel)} · ${app().escapeHTML(formatCallStatus(latest.status))}
${missedCount ? ` · ${app().escapeHTML(t(`${missedCount} بی‌پاسخ`, `${missedCount} missed`))}` : ''}
</div>
</div>
<div class="chat-call-summary-meta">
<span class="text-xs text-slate-500">${formatTime(latest.createdAt)}</span>
<span class="chat-call-count">${items.length}</span>
</div>
</summary>
<div class="chat-call-accordion-body">
${items.map((call) => `
<div class="chat-call-log-row ${isMissedCallStatus(call.status) ? 'missed' : ''}">
<div class="min-w-0">
<div class="text-sm text-white truncate">${app().escapeHTML(call.mode === 'video' ? t('تماس تصویری', 'Video call') : t('تماس صوتی', 'Voice call'))}</div>
<div class="text-xs ${isMissedCallStatus(call.status) ? 'text-rose-300' : 'text-slate-400'}">${app().escapeHTML(formatCallStatus(call.status))}${call.durationMs ? ` · ${formatDuration(call.durationMs)}` : ''}</div>
</div>
<span class="text-xs text-slate-500">${formatTime(call.createdAt)}</span>
</div>
`).join('')}
</div>
</details>
`;
}).join('')
: `<div class="chat-empty-state">${t('در این بخش هنوز تماسی ثبت نشده است.', 'No calls in this section yet.')}</div>`;
if (list) {
list.innerHTML = `
<div class="chat-call-filter-tabs sticky top-0 z-20 bg-[#f9fafb] dark:bg-[#0f172a] p-2 border-b border-gray-200 dark:border-gray-800 shadow-sm">${tabHtml}</div>
<div class="chat-calls-list-container">${rows}</div>
`;
}
if (callsPanelList) callsPanelList.innerHTML = rows;
document.querySelectorAll('[data-chat-call-filter]').forEach((button) => {
button.addEventListener('click', () => {
chatState.callFilter = button.getAttribute('data-chat-call-filter') || 'incoming';
renderCalls();
});
});
}
function ensurePinnedPanel() {
let panel = document.getElementById('chatPinnedPanel');
const messages = document.getElementById('chatMessages');
if (!panel && messages) {
panel = document.createElement('div');
panel.id = 'chatPinnedPanel';
panel.className = 'chat-pinned-panel hidden';
messages.before(panel);
}
return panel;
}
function renderPinnedPanel(peer, conversationKey, history = []) {
const panel = ensurePinnedPanel();
if (!panel) return;
const pinned = history.filter((entry) => entry.pinned).slice(-3).reverse();
if (!peer || !conversationKey || !pinned.length) {
panel.classList.add('hidden');
panel.innerHTML = '';
return;
}
panel.classList.remove('hidden');
panel.innerHTML = `
<div class="chat-pinned-title">
<i class="fas fa-thumbtack"></i>
<span>${t('پیام‌های سنجاق‌شده', 'Pinned messages')}</span>
</div>
<div class="chat-pinned-items">
${pinned.map((entry) => {
const label = entry.text
|| entry.name
|| (entry.type === 'call-log' ? callHistoryText(entry) : '')
|| (entry.type === 'voice' ? t('پیام صوتی', 'Voice message') : t('پیوست', 'Attachment'));
return `
<button type="button" class="chat-pinned-item" data-chat-jump-message="${entry.id}">
<span>${app().escapeHTML(String(label).slice(0, 90))}</span>
</button>
`;
}).join('')}
</div>
`;
panel.querySelectorAll('[data-chat-jump-message]').forEach((button) => {
button.addEventListener('click', () => {
const target = document.querySelector(`[data-id="${button.getAttribute('data-chat-jump-message')}"]`);
target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
target?.classList.add('selected');
});
});
}
function renderMessages() {
pruneExpiredHistory();
const peer = getActiveConversation();
const directPeer = activePeer();
const panel = document.getElementById('chatMessages');
if (!panel) return;
if (!peer) {
renderPinnedPanel(null, '', []);
panel.innerHTML = `<div class="chat-empty-state">${t('بعد از انتخاب یک گفتگو، تاریخچه همین‌جا نشان داده می‌شود.', 'Pick a conversation to view history here.')}</div>`;
return;
}
const conversationKey = getConversationKey(peer);
if (isConversationCurrentlyVisible(conversationKey)) {
markConversationRead(conversationKey);
}
const history = (chatState.history[conversationKey] || []).filter((entry) => {
if (!entry.expiresAt) return true;
const expiry = Date.parse(entry.expiresAt);
return !isNaN(expiry) && expiry > Date.now();
});
renderPinnedPanel(peer, conversationKey, history);
if (!history.length) {
panel.innerHTML = `<div class="chat-empty-state">${t('هنوز پیامی ردوبدل نشده است.', 'No messages exchanged yet.')}</div>`;
return;
}
const myReactorId = currentReactorId();
const activeSearchQuery = chatState.searchQuery.trim().toLowerCase();
const renderHistory = activeSearchQuery ? history : history.slice(-CHAT_RENDER_WINDOW_SIZE);
const hiddenCount = Math.max(0, history.length - renderHistory.length);
const historyById = new Map(history.map((entry) => [entry.id, entry]));
const bubbleClass = (entry) => [
'chat-message-bubble',
entry.direction === 'out' ? 'me' : 'them',
entry.pinned ? 'pinned' : '',
entry.expiresAt ? 'expiring' : '',
messageMatchesSearch(entry, activeSearchQuery) ? 'search-hit' : '',
].filter(Boolean).join(' ');
const olderNotice = hiddenCount
? `<div class="chat-history-window-note">${t(`${hiddenCount} پیام قدیمی‌تر برای سرعت بیشتر فعلاً رندر نشده است. برای پیدا کردن پیام‌های قدیمی از جستجو استفاده کنید.`, `${hiddenCount} older messages are not rendered for speed. Use search to find older messages.`)}</div>`
: '';
panel.innerHTML = olderNotice + renderHistory.map((entry) => {
const canReactToEntry = entry.direction !== 'out';
const meta = `
<div class="chat-message-meta" style="display: flex !important; opacity: 1 !important; visibility: visible !important;">
<span>${formatTime(entry.createdAt)}</span>
${entry.expiresAt ? `<span class="chat-timer-countdown bg-brand-500/10 text-brand-500 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1" data-expires="${entry.expiresAt}"><i class="fas fa-stopwatch animate-pulse"></i> ${formatCountdown(entry.expiresAt)}</span>` : (entry.timerSeconds ? `<span class="chat-timer-countdown bg-brand-500/10 text-brand-500 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1"><i class="fas fa-stopwatch"></i> ${entry.timerSeconds}s</span>` : '')}
${entry.direction === 'out' ? `<span data-chat-message-status="${entry.id}">${statusLabel(entry.status)}</span>` : ''}
</div>`;
const reactionSummary = summarizeMessageReactions(entry);
const myReaction = normalizeMessageReactions(entry)[myReactorId] || '';
const pickerOpen = chatState.activeReactionMessageId === entry.id;
const reactionSummaryHtml = reactionSummary.length
? `<div class="chat-reaction-summary">
${reactionSummary.map(({ emoji, count }) => `
<button type="button" ${canReactToEntry ? `data-chat-reaction-choice="${entry.id}" data-reaction="${emoji}"` : ''} class="chat-reaction-chip ${myReaction === emoji ? 'active' : ''}">
<span>${emoji}</span>
${count > 1 ? `<span class="chat-reaction-count">${count}</span>` : ''}
</button>
`).join('')}
</div>`
: '';
const deleteButton = `<button type="button" data-chat-delete-message="${entry.id}" class="chat-message-delete" title="${app().escapeHTML(t('حذف پیام', 'Delete message'))}">
<i class="fas fa-trash"></i>
</button>`;
const editButton = (entry.direction === 'out' && entry.type === 'text') ? `
<button type="button" data-chat-edit-message="${entry.id}" class="chat-message-icon-btn" title="${app().escapeHTML(t('ویرایش', 'Edit'))}">
<i class="fas fa-pen"></i>
</button>` : '';
const senderLabel = messageSenderLabel(entry, peer);
const senderHtml = senderLabel ? `<div class="chat-message-sender">${app().escapeHTML(senderLabel)}</div>` : '';
const replyPreview = entry.replyToId ? (() => {
const replied = historyById.get(entry.replyToId);
if (!replied) return '';
const replyName = replied.direction === 'out'
? t('خودتان', 'You')
: (messageSenderLabel(replied, peer) || peer.username || peer.name || t('کاربر', 'User'));
return `
<div class="chat-reply-preview" onclick="document.querySelector('[data-id=\'${replied.id}\']')?.scrollIntoView({behavior:'smooth',block:'center'})">
<span class="reply-name">${app().escapeHTML(replyName)}</span>
<span class="reply-text">${app().escapeHTML(replied.text || (replied.type === 'voice' ? t('پیام صوتی', 'Voice message') : t('فایل', 'File')))}</span>
</div>
`;
})() : '';
const reactionToolbar = `
<div class="chat-message-toolbar ${entry.direction === 'out' ? 'own-actions' : 'peer-actions'}">
${canReactToEntry ? `<button type="button" data-chat-toggle-reaction="${entry.id}" class="chat-message-icon-btn ${pickerOpen ? 'active' : ''}" title="${app().escapeHTML(t('ری‌اکشن', 'React'))}">
<i class="far fa-face-smile"></i>
</button>` : ''}
<button type="button" data-chat-reply-message="${entry.id}" class="chat-message-icon-btn" title="${app().escapeHTML(t('پاسخ', 'Reply'))}">
<i class="fas fa-reply"></i>
</button>
${editButton}
<button type="button" data-chat-copy-message="${entry.id}" class="chat-message-icon-btn" title="${app().escapeHTML(t('کپی', 'Copy'))}">
<i class="far fa-copy"></i>
</button>
<button type="button" data-chat-pin-message="${entry.id}" class="chat-message-icon-btn" title="${app().escapeHTML(t('سنجاق کردن', 'Pin'))}">
<i class="fas fa-thumbtack"></i>
</button>
<button type="button" data-chat-forward-message="${entry.id}" class="chat-message-icon-btn" title="${app().escapeHTML(t('هدایت', 'Forward'))}">
<i class="fas fa-share"></i>
</button>
${deleteButton}
</div>
${pickerOpen && canReactToEntry ? `
<div class="chat-reaction-picker">
${CHAT_REACTION_GROUPS.map((group) => `
<div class="chat-reaction-group">
<span>${language() === 'fa' ? group.labelFa : group.labelEn}</span>
<div>
${group.emojis.map((emoji) => `
<button type="button" data-chat-reaction-choice="${entry.id}" data-reaction="${emoji}" class="${myReaction === emoji ? 'active' : ''}">
${emoji}
</button>
`).join('')}
</div>
</div>
`).join('')}
<input type="text" inputmode="text" autocomplete="off" maxlength="8" class="chat-reaction-custom-input" data-chat-reaction-custom="${entry.id}" placeholder="${app().escapeHTML(t('ایموجی...', 'Emoji...'))}">
</div>
` : ''}
${reactionSummaryHtml}
`;
if (entry.type === 'voice') {
const playerHtml = entry.downloadUrl ? `
<div class="modern-audio-player" data-audio-url="${entry.downloadUrl}" data-audio-id="${entry.id}">
<button class="audio-play-btn" title="${t('پخش', 'Play')}">
<i class="fas fa-play"></i>
</button>
<div class="audio-progress-wrap">
<div class="audio-wave-container">
${Array.from({ length: 35 }).map(() => `<div class="audio-wave-bar" style="height: ${Math.random() * 60 + 20}%"></div>`).join('')}
</div>
<div class="audio-time-row">
<span class="audio-current-time">0:00</span>
<span class="audio-duration">--:--</span>
</div>
</div>
<button class="audio-speed-btn">1x</button>
</div>
` : `<div class="text-xs text-slate-400">${t('فایل صوتی در این دستگاه ذخیره نشده است.', 'Voice payload is not stored on this device.')}</div>`;
return `
<div class="${bubbleClass(entry)}" data-id="${entry.id}">
${senderHtml}
${replyPreview}
<div class="chat-voice-message">
<div class="font-bold text-xs mb-1 opacity-70" dir="${language() === 'fa' ? 'rtl' : 'ltr'}">${t('پیام صوتی رمزنگاری‌شده', 'Encrypted voice message')}</div>
${playerHtml}
</div>
${reactionToolbar}
${meta}
</div>
`;
}
if (entry.type === 'file') {
return `
<div class="${bubbleClass(entry)}" data-id="${entry.id}">
${senderHtml}
${replyPreview}
<div class="flex items-start gap-3">
<div class="w-10 h-10 rounded-xl bg-sky-500/20 text-brand-400 flex items-center justify-center shrink-0">
<i class="fas fa-file-shield text-xl"></i>
</div>
<div class="min-w-0">
<div class="font-bold text-sm truncate mb-0.5">${app().escapeHTML(entry.name || 'file.bin')}</div>
<div class="text-[11px] opacity-60">${app().formatBytes?.(entry.size) || entry.size + ' B'}</div>
${entry.downloadUrl ? `<a href="${entry.downloadUrl}" download="${app().escapeHTML(entry.name || 'file.bin')}" data-chat-download-message="${entry.id}" class="inline-flex mt-2 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-bold hover:bg-brand-600 transition-colors">${t('دریافت فایل', 'Download')}</a>` : ''}
</div>
</div>
${reactionToolbar}
${meta}
</div>
`;
}
if (entry.type === 'call-log') {
const icon = entry.mode === 'video' ? 'fa-video' : 'fa-phone';
const missed = isMissedCallStatus(entry.status);
return `
<div class="chat-call-message ${missed ? 'missed' : ''} ${messageMatchesSearch(entry, activeSearchQuery) ? 'search-hit' : ''}" data-id="${entry.id}">
<span class="chat-call-message-icon"><i class="fas ${icon}"></i></span>
<div class="min-w-0">
<div class="chat-call-message-title">${app().escapeHTML(entry.text || callHistoryText(entry))}</div>
<div class="chat-call-message-meta">${formatTime(entry.createdAt)}${entry.durationMs ? ` · ${formatDuration(entry.durationMs)}` : ''}</div>
</div>
</div>
`;
}
return `
<div class="${bubbleClass(entry)}" data-id="${entry.id}">
${senderHtml}
${replyPreview}
<div class="chat-message-text text-sm whitespace-pre-wrap" dir="${detectComposerDirection(entry.text)}">${app().escapeHTML(entry.text || '')} ${entry.edited ? `<span class="text-[10px] opacity-40 italic ml-1">(${t('ویرایش شده', 'edited')})</span>` : ''}</div>
${reactionToolbar}
${meta}
</div>
`;
}).join('');
// Re-bind Audio Player events
panel.querySelectorAll('.modern-audio-player').forEach(container => {
const url = container.dataset.audioUrl;
const id = container.dataset.audioId;
const playBtn = container.querySelector('.audio-play-btn');
const speedBtn = container.querySelector('.audio-speed-btn');
const currentTimeEl = container.querySelector('.audio-current-time');
const durationEl = container.querySelector('.audio-duration');
const waveBars = container.querySelectorAll('.audio-wave-bar');
let player = audioPlayers.get(id);
if (!player) {
player = {
audio: new Audio(url),
playbackRate: 1.0,
isPlaying: false
};
audioPlayers.set(id, player);
}
const audio = player.audio;
const updateUI = () => {
const duration = (audio.duration && audio.duration !== Infinity && !isNaN(audio.duration))
? audio.duration
: (entry.durationMs ? entry.durationMs / 1000 : NaN);
const current = audio.currentTime;
if (isNaN(duration)) return;
const activeIndex = Math.floor((current / duration) * waveBars.length);
waveBars.forEach((bar, idx) => {
bar.classList.toggle('active', idx <= activeIndex);
});
currentTimeEl.textContent = formatAudioTime(current);
durationEl.textContent = formatAudioTime(duration);
};
audio.ontimeupdate = updateUI;
audio.onloadedmetadata = updateUI;
audio.onended = () => {
player.isPlaying = false;
playBtn.innerHTML = '<i class="fas fa-play"></i>';
waveBars.forEach(bar => bar.classList.remove('active'));
};
playBtn.onclick = () => {
if (player.isPlaying) {
audio.pause();
player.isPlaying = false;
playBtn.innerHTML = '<i class="fas fa-play"></i>';
} else {
// Pause others
audioPlayers.forEach((p, k) => {
if (k !== id && p.isPlaying) {
p.audio.pause();
p.isPlaying = false;
const otherBtn = panel.querySelector(`[data-audio-id="${k}"] .audio-play-btn`);
if (otherBtn) otherBtn.innerHTML = '<i class="fas fa-play"></i>';
}
});
audio.play();
player.isPlaying = true;
playBtn.innerHTML = '<i class="fas fa-pause"></i>';
}
};
speedBtn.onclick = () => {
const rates = [1.0, 1.5, 2.0, 0.5];
const currentIndex = rates.indexOf(player.playbackRate);
player.playbackRate = rates[(currentIndex + 1) % rates.length];
audio.playbackRate = player.playbackRate;
speedBtn.textContent = player.playbackRate + 'x';
};
container.querySelector('.audio-wave-container').onclick = (e) => {
const rect = e.currentTarget.getBoundingClientRect();
const x = e.clientX - rect.left;
const pct = x / rect.width;
audio.currentTime = pct * audio.duration;
updateUI();
};
});
function formatAudioTime(seconds) {
if (isNaN(seconds)) return '0:00';
const mins = Math.floor(seconds / 60);
const secs = Math.floor(seconds % 60);
return `${mins}:${secs.toString().padStart(2, '0')}`;
}
panel.querySelectorAll('[data-chat-toggle-reaction]').forEach((button) => {
button.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
const entryId = button.getAttribute('data-chat-toggle-reaction') || '';
chatState.activeReactionMessageId = chatState.activeReactionMessageId === entryId ? '' : entryId;
renderMessages();
});
});
panel.querySelectorAll('[data-chat-reaction-choice]').forEach((button) => {
button.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
const entryId = button.getAttribute('data-chat-reaction-choice');
const reaction = button.getAttribute('data-reaction') || '';
const entry = (chatState.history[conversationKey] || []).find((item) => item.id === entryId);
if (!entry || entry.direction === 'out') return;
const currentReaction = normalizeMessageReactions(entry)[myReactorId] || '';
const nextReaction = currentReaction === reaction ? '' : reaction;
if (nextReaction) spawnReactionAnimation(nextReaction, entryId);
applyMessageReaction(entry, nextReaction, myReactorId);
chatState.activeReactionMessageId = '';
if (peer && !peer.type && directPeer) {
relaySessionEvent(directPeer, {
type: 'reaction',
messageId: entryId,
reaction: nextReaction,
reactorId: myReactorId,
clientId: chatState.clientId || '',
peerId: chatState.peerId || '',
fingerprint: chatState.identity?.fingerprint || '',
createdAt: new Date().toISOString(),
});
}
storeHistory();
renderPeers();
renderMessages();
});
});
panel.querySelectorAll('[data-chat-reaction-custom]').forEach((input) => {
const commitReaction = (event) => {
const entryId = input.getAttribute('data-chat-reaction-custom') || '';
const entry = (chatState.history[conversationKey] || []).find((item) => item.id === entryId);
const reaction = String(input.value || '').trim();
if (!entry || entry.direction === 'out' || !reaction) return;
const nextReaction = Array.from(reaction)[0] || '';
applyMessageReaction(entry, nextReaction, myReactorId);
chatState.activeReactionMessageId = '';
if (peer && !peer.type && directPeer) {
relaySessionEvent(directPeer, {
type: 'reaction',
messageId: entryId,
reaction: nextReaction,
reactorId: myReactorId,
clientId: chatState.clientId || '',
peerId: chatState.peerId || '',
fingerprint: chatState.identity?.fingerprint || '',
createdAt: new Date().toISOString(),
});
}
storeHistory();
renderPeers();
renderMessages();
};
input.addEventListener('keydown', (event) => {
if (event.key === 'Enter') {
event.preventDefault();
commitReaction(event);
}
});
input.addEventListener('change', commitReaction);
input.addEventListener('click', (event) => event.stopPropagation());
});
panel.querySelectorAll('.chat-message-bubble').forEach((bubble) => {
bubble.addEventListener('click', () => {
bubble.classList.toggle('selected');
// Unselect others
panel.querySelectorAll('.chat-message-bubble').forEach((b) => {
if (b !== bubble) b.classList.remove('selected');
});
});
const entryId = bubble.dataset.id;
const entry = historyById.get(entryId);
if (entryId && entry && entry.direction === 'in' && entry.status !== 'opened' && directPeer) {
sendRelayEnvelope(directPeer, {
type: 'receipt',
messageId: entryId,
status: 'opened',
createdAt: new Date().toISOString(),
});
entry.status = 'opened';
storeHistory();
}
bindSwipeReply(bubble, entryId, panel);
});
panel.querySelectorAll('[data-chat-delete-message]').forEach((button) => {
button.addEventListener('click', () => {
const entryId = button.getAttribute('data-chat-delete-message');
if (!entryId) return;
chatState.activeReactionMessageId = '';
deleteMessageEntry(conversationKey, entryId, { broadcast: Boolean(!peer.type), peerRecord: directPeer });
});
});
panel.querySelectorAll('[data-chat-copy-message]').forEach((button) => {
button.addEventListener('click', async () => {
const entry = historyById.get(button.getAttribute('data-chat-copy-message'));
if (!entry?.text) return;
await navigator.clipboard?.writeText(entry.text).catch(() => {});
notify(t('پیام کپی شد.', 'Message copied.'), 'success');
});
});
panel.querySelectorAll('[data-chat-reply-message]').forEach((button) => {
button.addEventListener('click', () => {
handleReplyMessage(button.getAttribute('data-chat-reply-message'));
});
});
panel.querySelectorAll('[data-chat-pin-message], [data-chat-forward-message]').forEach((button) => {
button.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
const pinId = button.getAttribute('data-chat-pin-message');
const forwardId = button.getAttribute('data-chat-forward-message');
if (pinId) handlePinMessage(pinId);
if (forwardId) handleForwardMessage(forwardId);
});
});
panel.querySelectorAll('[data-chat-download-message]').forEach((link) => {
link.addEventListener('click', () => {
const entryId = link.getAttribute('data-chat-download-message') || '';
const entry = (chatState.history[conversationKey] || []).find((item) => item.id === entryId);
if (entry) {
entry.status = 'opened';
storeHistory();
renderMessages();
}
if (entryId && peer && !peer.type && directPeer) {
relaySessionEvent(directPeer, {
type: 'receipt',
messageId: entryId,
status: 'opened',
createdAt: new Date().toISOString(),
});
}
});
});
positionMessageOverlays(panel);
const searchTarget = activeSearchQuery ? panel.querySelector('.search-hit') : null;
if (searchTarget) {
searchTarget.scrollIntoView({ block: 'center', behavior: 'smooth' });
searchTarget.classList.add('selected');
} else {
panel.scrollTop = panel.scrollHeight;
}
}
function positionMessageOverlays(panel = document.getElementById('chatMessages')) {
if (!panel) return;
requestAnimationFrame(() => {
const panelRect = panel.getBoundingClientRect();
panel.querySelectorAll('.chat-message-bubble').forEach((bubble) => {
const rect = bubble.getBoundingClientRect();
const openDown = (rect.top - panelRect.top) < 145;
const openUp = (panelRect.bottom - rect.bottom) < 170;
bubble.querySelectorAll('.chat-message-toolbar').forEach((overlay) => {
overlay.classList.toggle('open-down', openDown && !openUp);
overlay.classList.toggle('open-up', openUp || !openDown);
});
const picker = bubble.querySelector('.chat-reaction-picker');
if (picker) {
const pickerWidth = Math.min(picker.offsetWidth || 360, window.innerWidth - 16);
const pickerHeight = picker.offsetHeight || 190;
const gap = 8;
const roomAbove = rect.top;
const roomBelow = window.innerHeight - rect.bottom;
let top = roomAbove > pickerHeight + gap || roomAbove > roomBelow
? rect.top - pickerHeight - gap
: rect.bottom + gap;
top = Math.max(8, Math.min(top, window.innerHeight - pickerHeight - 8));
let left = bubble.classList.contains('me') ? rect.right - pickerWidth : rect.left;
left = Math.max(8, Math.min(left, window.innerWidth - pickerWidth - 8));
picker.style.setProperty('position', 'fixed', 'important');
picker.style.setProperty('z-index', '120000', 'important');
picker.style.setProperty('top', `${Math.round(top)}px`, 'important');
picker.style.setProperty('left', `${Math.round(left)}px`, 'important');
picker.style.setProperty('right', 'auto', 'important');
picker.style.setProperty('bottom', 'auto', 'important');
picker.style.setProperty('max-width', `${Math.round(pickerWidth)}px`, 'important');
picker.classList.remove('open-up', 'open-down');
}
});
});
}
function bindSwipeReply(bubble, entryId, panel) {
if (!bubble || !entryId || bubble.dataset.swipeReplyBound === 'true') return;
bubble.dataset.swipeReplyBound = 'true';
let startX = 0;
let startY = 0;
let tracking = false;
bubble.addEventListener('pointerdown', (event) => {
if (!isCompactChatLayout() || event.pointerType === 'mouse') return;
startX = event.clientX;
startY = event.clientY;
tracking = true;
});
bubble.addEventListener('pointerup', (event) => {
if (!tracking) return;
tracking = false;
const dx = event.clientX - startX;
const dy = Math.abs(event.clientY - startY);
if (dy < 28 && Math.abs(dx) > 44) {
event.preventDefault();
event.stopPropagation();
handleReplyMessage(entryId);
panel?.querySelectorAll('.chat-message-bubble').forEach((item) => item.classList.remove('selected'));
}
});
bubble.addEventListener('pointercancel', () => {
tracking = false;
});
}
function renderActivePeer() {
updateChatShellMode();
const peer = getActiveConversation();
const directPeer = activePeer();
const session = activeSession();
const thread = document.querySelector('.chat-thread');
const composerBar = document.querySelector('.chat-composer-bar');
const securityDrawer = document.querySelector('.chat-security-drawer');
const peerName = document.getElementById('chatActivePeerName');
const peerMeta = document.getElementById('chatActivePeerMeta');
const banner = document.getElementById('chatSessionBanner');
const remoteFingerprint = document.getElementById('chatRemoteFingerprint');
const keyMode = document.getElementById('chatSecurityKeyMode');
const connectBtn = document.getElementById('chatStartSessionBtn');
const deleteConversationBtn = document.getElementById('chatDeleteConversationBtn');
const sendBtn = document.getElementById('chatSendMessageBtn');
const sendFileBtn = document.getElementById('chatSendFileBtn');
const voiceMessageBtn = document.getElementById('chatVoiceMessageBtn');
const voiceBtn = document.getElementById('chatVoiceCallBtn');
const videoBtn = document.getElementById('chatVideoCallBtn');
if (!peer) {
peerName.textContent = t('یک کاربر را انتخاب کنید', 'Select a peer');
peerMeta.textContent = hasActiveServerRestriction()
? restrictionText()
: t('برای شروع چت از دکمه شروع چت استفاده کنید.', 'Use Start chat to add a peer.');
banner.classList.add('hidden');
composerBar?.classList.add('hidden');
securityDrawer?.classList.add('hidden');
thread?.classList.add('chat-thread-empty');
remoteFingerprint.textContent = '-';
keyMode.textContent = t('منتظر سشن', 'Waiting for session');
connectBtn.disabled = true;
deleteConversationBtn?.classList.add('hidden');
if (deleteConversationBtn) deleteConversationBtn.disabled = true;
sendBtn.disabled = true;
sendFileBtn.disabled = true;
if (voiceMessageBtn) voiceMessageBtn.disabled = true;
voiceBtn.disabled = true;
videoBtn.disabled = true;
renderMessages();
return;
}
const displayName = peer.username || peer.name || peer.peerId;
const isTyping = chatState.typingTimers.has(getConversationKey(peer));
const busy = isCallBusy();
const hasRelay = Boolean(chatState.connected && chatState.ws?.readyState === WebSocket.OPEN);
composerBar?.classList.toggle('hidden', chatState.activeView === 'calls' || chatState.activeView === 'connection');
securityDrawer?.classList.remove('hidden');
thread?.classList.remove('chat-thread-empty');
peerName.textContent = displayName;
if (peer.clientId === 'system') {
composerBar?.classList.add('hidden');
securityDrawer?.classList.add('hidden');
peerMeta.textContent = t('پیام‌های ارسالی از مدیریت سیستم', 'Broadcast messages from system administrator');
peerMeta.classList.remove('animate-pulse', 'text-sky-500');
const activeAvatar = document.getElementById('chatActiveAvatar');
if (activeAvatar) {
activeAvatar.innerHTML = `<i class="fas fa-bullhorn text-xl"></i>`;
activeAvatar.className = 'chat-avatar chat-active-avatar online';
}
banner.classList.add('hidden');
renderMessages();
return;
}
if (isTyping) {
peerMeta.textContent = t('در حال نوشتن...', 'Typing...');
peerMeta.classList.add('animate-pulse', 'text-sky-500');
} else {
peerMeta.classList.remove('animate-pulse', 'text-sky-500');
peerMeta.textContent = peer.type
? `${peer.type} • ${t('فضای امن محلی', 'Local secure space')}`
: `${t('وضعیت', 'Status')}: ${peer.status === 'online' ? t('آنلاین', 'Online') : t('آفلاین', 'Offline')} • ${t('چت رمزنگاری‌شده', 'Encrypted chat')}`;
}
const activeAvatar = document.getElementById('chatActiveAvatar');
if (activeAvatar) {
activeAvatar.innerHTML = peer.avatarData ? `<img src="${peer.avatarData}" alt="">` : app().escapeHTML(initials(displayName));
activeAvatar.classList.toggle('online', peer.status === 'online');
activeAvatar.classList.toggle('offline', peer.status === 'offline');
}
remoteFingerprint.textContent = shortSecurityValue(peer.fingerprint || peer.conversationId || '-');
remoteFingerprint.title = peer.fingerprint || peer.conversationId || '-';
keyMode.textContent = sessionSecurityText(session);
connectBtn.disabled = Boolean(peer.type) || !chatState.connected || !chatState.peer;
deleteConversationBtn?.classList.remove('hidden');
if (deleteConversationBtn) deleteConversationBtn.disabled = false;
sendBtn.disabled = Boolean(!peer.type && (!hasRelay || !chatState.peer));
sendFileBtn.disabled = Boolean(!peer.type && (!hasRelay || !chatState.peer));
if (voiceMessageBtn) voiceMessageBtn.disabled = Boolean(!peer.type && (!hasRelay || !chatState.peer));
voiceBtn.disabled = busy || Boolean(peer.type) || !hasRelay || !chatState.peer;
videoBtn.disabled = busy || Boolean(peer.type) || !hasRelay || !chatState.peer || !chatState.profile.allowVideo;
document.getElementById('chatSecureBadge')?.classList.toggle('hidden', !(peer.type || session?.cryptoKey));
if (session?.cryptoKey) {
banner.textContent = t('سشن رمزنگاری فعال است و پیام‌ها روی AES-GCM رمز می‌شوند.', 'An encrypted session is active and messages are protected with AES-GCM.');
banner.classList.remove('hidden');
} else if (peer.type) {
banner.textContent = t('گروه محلی ساخته شد. برای اعضای آنلاین با سشن امن، پیام ارسال می‌شود.', 'Local group is ready. Messages are sent to online members with secure sessions.');
banner.classList.remove('hidden');
} else {
banner.textContent = '';
banner.classList.add('hidden');
}
scheduleSessionWarmup(directPeer);
renderMessages();
}
function scheduleSessionWarmup(peerRecord, delayMs = 250) {
if (!peerRecord || peerRecord.type || isSelfPeerRecord(peerRecord)) return;
if (peerRecord.status !== 'online' || !chatState.connected || !chatState.peer) return;
const existing = chatState.sessions.get(peerRecord.peerId);
if (existing?.cryptoKey || existing?.connection?.open) return;
if (chatState.sessionWarmupTimers.has(peerRecord.peerId) || chatState.sessionWarmupInFlight.has(peerRecord.peerId)) return;
const timer = setTimeout(async () => {
chatState.sessionWarmupTimers.delete(peerRecord.peerId);
if (chatState.sessionWarmupInFlight.has(peerRecord.peerId)) return;
chatState.sessionWarmupInFlight.add(peerRecord.peerId);
try {
await ensureDirectSession(peerRecord, { silent: true });
} catch (error) {
console.warn('Secure chat session warmup failed:', error);
} finally {
chatState.sessionWarmupInFlight.delete(peerRecord.peerId);
}
}, delayMs);
chatState.sessionWarmupTimers.set(peerRecord.peerId, timer);
}
function appendHistory(conversationId, entry) {
if (!chatState.history[conversationId]) {
chatState.history[conversationId] = [];
}
const incoming = entry?.direction === 'in';
const visibleNow = incoming && isConversationCurrentlyVisible(conversationId);
if (incoming) {
entry.unread = !visibleNow;
}
if (entry?.id) {
const duplicate = chatState.history[conversationId].find((item) => item.id === entry.id);
if (duplicate) {
const nextEntry = { ...entry };
if (duplicate.direction === 'out' && entry.direction === 'in') {
nextEntry.direction = 'out';
}
Object.assign(duplicate, {
...nextEntry,
unread: incoming ? !visibleNow : duplicate.unread,
reactions: duplicate.reactions || entry.reactions,
downloadUrl: duplicate.downloadUrl || entry.downloadUrl,
});
storeHistory();
renderPeers();
renderMessages();
return duplicate;
}
}
chatState.history[conversationId].push(entry);
chatState.history[conversationId] = chatState.history[conversationId].slice(-300);
storeHistory();
renderPeers();
renderMessages();
if (entry.direction === 'in') {
playSound('message');
if (!visibleNow) {
const sender = conversationRecordById(conversationId);
const senderName = sender?.username || sender?.name || entry.senderName || t('کاربر P00RIJA', 'P00RIJA User');
const unreadCount = unreadConversationCount(conversationId);
const label = notificationMessageLabel(entry).slice(0, 80) || t('پیام جدید', 'New message');
app().showNotification?.(`${senderName}: ${label}`, 'info');
window.dispatchEvent(new CustomEvent('poorija:chat-unread', {
detail: {
count: 1,
peerId: conversationId,
conversationId,
conversationUnread: unreadCount
}
}));
}
}
}
async function encryptForSession(session, plainBytes) {
const iv = app().generateSecureRandomBytes(12);
const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session.cryptoKey, plainBytes);
return {
iv: Array.from(iv),
cipher: app().arrayBufferToBase64(cipher),
};
}
async function decryptForSession(session, payload) {
const decrypted = await crypto.subtle.decrypt(
{ name: 'AES-GCM', iv: new Uint8Array(payload.iv || []) },
session.cryptoKey,
app().base64ToArrayBuffer(payload.cipher)
);
return decrypted;
}
function markMessageStatus(conversationId, messageId, status) {
if (!conversationId || !messageId) return;
const entry = (chatState.history[conversationId] || []).find((item) => item.id === messageId);
if (!entry) return;
let needsFullRender = false;
// If message is being delivered and has a timer but no expiry yet, start it now.
if ((status === 'delivered' || status === 'seen' || status === 'sent') && entry.direction === 'out' && entry.timerSeconds > 0 && !entry.expiresAt) {
entry.expiresAt = new Date(Date.now() + entry.timerSeconds * 1000).toISOString();
needsFullRender = true;
}
entry.status = status;
storeHistory();
const statusEl = document.querySelector(`[data-chat-message-status="${CSS.escape(messageId)}"]`);
if (statusEl && getConversationKey(getActiveConversation()) === conversationId && !needsFullRender) {
statusEl.textContent = statusLabel(status);
} else {
renderMessages();
}
renderPeers();
scheduleNextExpiry();
}
function deleteMessageEntry(conversationId, messageId, { broadcast = false, peerRecord = null } = {}) {
if (!conversationId || !messageId) return;
const current = chatState.history[conversationId] || [];
const next = current.filter((item) => item.id !== messageId);
if (next.length === current.length) return;
chatState.history[conversationId] = next;
storeHistory();
renderPeers();
renderMessages();
if (broadcast) {
const targetPeer = peerRecord || findPeerByConversationKey(conversationId) || activePeer();
relaySessionEvent(targetPeer, {
type: 'delete',
messageId,
createdAt: new Date().toISOString(),
});
}
}
function deleteActiveConversation() {
const conversation = getActiveConversation();
if (!conversation) return;
const key = getConversationKey(conversation);
const label = conversation.username || conversation.name || conversation.peerId || key;
const ok = window.confirm?.(t(`گفتگوی «${label}» کامل حذف شود؟`, `Delete the whole "${label}" conversation?`));
if (!ok) return;
if (key) delete chatState.history[key];
if (conversation.type === 'group') {
const index = chatState.spaces.groups.findIndex((space) => space.conversationId === conversation.conversationId);
if (index >= 0) chatState.spaces.groups.splice(index, 1);
saveSpaces();
}
if (!conversation.type) {
const peerKey = conversation.peerId || '';
const fingerprint = conversation.fingerprint || '';
if (peerKey) delete chatState.sessionKeys[peerKey];
if (fingerprint) delete chatState.sessionKeys[fingerprint];
saveEncrypted(CHAT_SESSION_KEYS_STORAGE_KEY, chatState.sessionKeys);
const peerIndex = chatState.peers.findIndex(p => p.peerId === peerKey || p.fingerprint === fingerprint);
if (peerIndex >= 0) chatState.peers.splice(peerIndex, 1);
saveContacts();
}
storeHistory();
chatState.activePeerClientId = '';
chatState.activeConversationId = '';
chatState.activeReactionMessageId = '';
clearMessageContext();
updateChatShellMode();
renderPeers();
renderActivePeer();
notify(t('گفتگو حذف شد.', 'Conversation deleted.'), 'success');
}
function sendDeliveryAck(session, messageId, status) {
if (!session || !messageId) return;
const payload = {
type: 'receipt',
messageId,
status,
createdAt: new Date().toISOString(),
};
if (session.connection?.open) {
safeConnectionSend(session.connection, payload, 'delivery-ack');
return;
}
const peerRecord = findPeerBySession(session);
if (peerRecord) {
relaySessionEvent(peerRecord, payload);
}
}
function safeConnectionSend(connection, payload, context = 'data') {
if (!connection?.open) return false;
try {
connection.send(payload);
return true;
} catch (error) {
console.warn(`Chat ${context} send failed:`, error);
return false;
}
}
function sendRelayEnvelope(peerRecord, payload) {
if (hasActiveServerRestriction()) {
notifyRestrictionOnce();
return false;
}
if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN || !peerRecord) return false;
if (!peerRecord.fingerprint && !peerRecord.clientId) return false;
chatState.ws.send(JSON.stringify({
type: 'relay',
toClientId: peerRecord.clientId || '',
toFingerprint: peerRecord.fingerprint || '',
payload,
persist: true,
}));
return true;
}
function relaySessionEvent(peerRecord, message) {
if (!peerRecord || !message) return false;
const session = chatState.sessions.get(peerRecord.peerId);
if (session?.connection?.open) {
return safeConnectionSend(session.connection, message, 'session-event');
}
return sendRelayEnvelope(peerRecord, {
type: 'offline-chat',
fromPeerId: chatState.peerId,
message,
createdAt: message.createdAt || new Date().toISOString(),
});
}
function waitForSessionReady(peerRecord, timeoutMs = SESSION_READY_TIMEOUT_MS) {
return new Promise((resolve) => {
const startedAt = Date.now();
const tick = () => {
const session = peerRecord ? chatState.sessions.get(peerRecord.peerId) : null;
if (session?.cryptoKey) {
resolve(session);
return;
}
if (Date.now() - startedAt >= timeoutMs) {
resolve(session || null);
return;
}
setTimeout(tick, 150);
};
tick();
});
}
function waitForDirectConnection(peerRecord, timeoutMs = SESSION_READY_TIMEOUT_MS) {
return new Promise((resolve) => {
const startedAt = Date.now();
const tick = () => {
const session = peerRecord ? chatState.sessions.get(peerRecord.peerId) : null;
if (session?.connection?.open) {
resolve(session);
return;
}
if (Date.now() - startedAt >= timeoutMs) {
resolve(session || null);
return;
}
setTimeout(tick, 150);
};
tick();
});
}
async function ensureStoredSession(peerRecord) {
if (!peerRecord?.peerId) return null;
let session = chatState.sessions.get(peerRecord.peerId) || null;
if (!session) {
session = {
peerId: peerRecord.peerId,
remoteClientId: peerRecord.clientId || '',
remoteFingerprint: peerRecord.fingerprint || '',
remotePublicKeyData: peerRecord.publicKeyData || '',
conversationId: getConversationKey(peerRecord),
connection: null,
};
chatState.sessions.set(peerRecord.peerId, session);
} else {
session.remoteClientId = peerRecord.clientId || session.remoteClientId || '';
session.remoteFingerprint = peerRecord.fingerprint || session.remoteFingerprint || '';
session.remotePublicKeyData = peerRecord.publicKeyData || session.remotePublicKeyData || '';
session.conversationId = getConversationKey(peerRecord) || session.conversationId || '';
}
await hydrateSessionKey(session);
return session;
}
async function ensureDirectSession(peerRecord, { silent = false } = {}) {
if (!peerRecord) return null;
let session = await ensureStoredSession(peerRecord);
if (session?.cryptoKey) return session;
if (peerRecord.status === 'offline') {
return session;
}
if (!chatState.peer || !chatState.connected) {
await connectChatTransport();
}
session = await ensureStoredSession(peerRecord);
if (session?.cryptoKey) return session;
await startSecureSession(peerRecord, { silent });
session = await waitForSessionReady(peerRecord);
return session;
}
async function handleOfflineRelayMessage(message) {
const payload = message.payload || {};
try {
const fromId = payload.fromPeerId || message.fromFingerprint || message.fromClientId;
let session = chatState.sessions.get(fromId);
if (!session) {
session = {
peerId: fromId,
remoteFingerprint: message.fromFingerprint || '',
};
chatState.sessions.set(fromId, session);
}
const innerMessage = payload.message;
if (!innerMessage) return;
const innerType = innerMessage.type;
const requiresCrypto = ['text', 'space-message', 'file', 'voice', 'edit', 'file-start', 'file-chunk'].includes(innerType);
await hydrateSessionKey(session);
// De-duplication check: only for types that create new history entries.
// We don't want to skip receipts, reactions, or edits which refer to existing IDs.
const historyKey = getPeerHistoryKey(findPeerBySession(session), session);
const isHistoryType = ['text', 'space-message', 'voice', 'file-start'].includes(innerType);
if (isHistoryType) {
const isDuplicate = (chatState.history[historyKey] || []).some(m => m.id === (innerMessage.id || innerMessage.messageId));
if (isDuplicate) return true;
}
if (requiresCrypto && !session.cryptoKey) {
const peer = findPeerBySession(session);
appendHistory(peer ? getConversationKey(peer) : session.peerId, {
id: generateId('notice'),
direction: 'in',
type: 'text',
text: t('یک پیام آفلاین رسید، اما کلید سشن قبلی برای بازکردن آن موجود نیست.', 'An offline message arrived, but the previous session key is not available.'),
status: 'delivered',
createdAt: payload.createdAt || new Date().toISOString(),
});
return true;
}
await handleSessionMessage(session, innerMessage);
return true;
} catch (error) {
console.error('Failed to process offline relay message:', error);
return false;
}
}
async function ensureSessionKey(session, remotePeerRecord) {
if (session.cryptoKey || !remotePeerRecord?.publicKeyData) return;
session.remoteFingerprint = remotePeerRecord.fingerprint || session.remoteFingerprint || '';
session.remotePublicKeyData = remotePeerRecord.publicKeyData || session.remotePublicKeyData || '';
session.conversationId = getConversationKey(remotePeerRecord) || session.conversationId || session.remoteFingerprint || session.peerId;
const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
const rawKey = await crypto.subtle.exportKey('raw', cryptoKey);
const remotePublicKey = await importIdentityPublicKey(remotePeerRecord.publicKeyData);
const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, remotePublicKey, rawKey);
session.cryptoKey = cryptoKey;
session.keyReady = true;
await persistSessionKey(session, rawKey);
if (session.connection?.open) {
safeConnectionSend(session.connection, {
type: 'chat-key',
wrappedKey: app().arrayBufferToBase64(wrapped),
fingerprint: chatState.identity?.fingerprint || '',
}, 'chat-key');
}
renderActivePeer();
}
async function handleSessionMessage(session, message) {
if (!message) return;
if (message.type === 'ping') {
try {
session.connection?.send({ type: 'pong', timestamp: Date.now() });
} catch (_e) { /* noop */ }
return;
}
if (message.type === 'pong') {
return;
}
if (message.type === 'session-hello') {
session.remoteClientId = message.clientId || session.remoteClientId || '';
session.remoteFingerprint = message.fingerprint || session.remoteFingerprint || '';
session.remotePublicKeyData = message.publicKeyData || session.remotePublicKeyData || '';
const peer = findPeerBySession(session);
if (peer) {
peer.clientId = message.clientId || peer.clientId;
peer.username = message.username || peer.username;
peer.publicKeyData = message.publicKeyData || peer.publicKeyData;
peer.fingerprint = message.fingerprint || peer.fingerprint;
session.conversationId = getConversationKey(peer);
} else if (message.peerId || session.peerId) {
onPeerDiscovered({
clientId: message.clientId || session.remoteClientId || session.peerId,
peerId: message.peerId || session.peerId,
username: message.username || session.peerId,
publicKeyData: message.publicKeyData || '',
fingerprint: message.fingerprint || '',
status: 'online',
});
}
if (session.initiator && !session.cryptoKey && session.connection?.open) {
await ensureSessionKey(session, {
peerId: session.peerId,
clientId: session.remoteClientId,
username: message.username || '',
publicKeyData: session.remotePublicKeyData,
fingerprint: session.remoteFingerprint,
});
}
renderPeers();
renderActivePeer();
return;
}
if (message.type === 'chat-key') {
if (session.cryptoKey) return;
const privateKey = await importIdentityPrivateKey();
const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, app().base64ToArrayBuffer(message.wrappedKey));
session.cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
session.keyReady = true;
await persistSessionKey(session, raw);
renderActivePeer();
renderMessages();
return;
}
if (message.type === 'text') {
const decrypted = await decryptForSession(session, message.payload);
const text = new TextDecoder().decode(decrypted);
const timerSeconds = Number(message.timerSeconds || 0);
const expiresAt = timerSeconds > 0 ? new Date(Date.now() + timerSeconds * 1000).toISOString() : (message.expiresAt || '');
appendHistory(getPeerHistoryKey(findPeerBySession(session), session), {
id: message.id || generateId('msg'),
direction: 'in',
type: 'text',
text,
status: 'delivered',
expiresAt,
timerSeconds,
replyToId: message.replyToId || '',
createdAt: message.createdAt || new Date().toISOString(),
});
sendDeliveryAck(session, message.id, appState()?.activeTab === 'chat' && !document.hidden ? 'seen' : 'delivered');
return;
}
if (message.type === 'space-message') {
const decrypted = await decryptForSession(session, message.payload);
let payload = {};
try {
payload = JSON.parse(new TextDecoder().decode(decrypted));
} catch (error) {
console.warn('Invalid space message payload:', error);
return;
}
const space = upsertSharedSpace({
type: payload.spaceType || 'group',
name: payload.spaceName || t('فضای مشترک', 'Shared space'),
conversationId: payload.spaceId || message.spaceId || generateId('space'),
members: Array.isArray(payload.members) ? payload.members : [],
ownerPeerId: payload.ownerPeerId || '',
ownerClientId: payload.ownerClientId || '',
ownerFingerprint: payload.ownerFingerprint || '',
createdAt: payload.createdAt || message.createdAt || new Date().toISOString(),
});
const conversationId = space?.conversationId || payload.spaceId || message.spaceId;
if (!conversationId) return;
const timerSeconds = Number(payload.timerSeconds || 0);
const expiresAt = timerSeconds > 0 ? new Date(Date.now() + timerSeconds * 1000).toISOString() : (payload.expiresAt || '');
appendHistory(conversationId, {
id: payload.messageId || message.id || generateId('msg'),
direction: 'in',
type: 'text',
text: payload.text || '',
senderName: payload.senderName || '',
senderPeerId: payload.senderPeerId || '',
senderFingerprint: payload.senderFingerprint || '',
status: 'delivered',
expiresAt,
timerSeconds,
replyToId: payload.replyToId || '',
createdAt: payload.createdAt || message.createdAt || new Date().toISOString(),
});
return;
}
if (message.type === 'edit') {
const decrypted = await decryptForSession(session, message.payload);
const text = new TextDecoder().decode(decrypted);
const key = getPeerHistoryKey(findPeerBySession(session), session);
const entry = (chatState.history[key] || []).find((item) => item.id === message.messageId);
if (entry) {
entry.text = text;
entry.edited = true;
storeHistory();
renderPeers();
renderMessages();
}
return;
}
if (message.type === 'pin') {
const key = getPeerHistoryKey(findPeerBySession(session), session);
const entry = (chatState.history[key] || []).find((item) => item.id === message.messageId);
if (entry) {
entry.pinned = Boolean(message.pinned);
storeHistory();
renderMessages();
}
return;
}
if (message.type === 'receipt') {
markMessageStatus(getPeerHistoryKey(findPeerBySession(session), session), message.messageId, message.status || 'delivered');
return;
}
if (message.type === 'reaction') {
const key = getPeerHistoryKey(findPeerBySession(session), session);
const entry = (chatState.history[key] || []).find((item) => item.id === message.messageId);
if (entry) {
if (message.reaction) spawnReactionAnimation(message.reaction, message.messageId);
applyMessageReaction(entry, message.reaction || '', resolveRemoteReactorId(session, message));
storeHistory();
renderPeers();
renderMessages();
}
return;
}
if (message.type === 'delete') {
deleteMessageEntry(getPeerHistoryKey(findPeerBySession(session), session), message.messageId);
return;
}
if (message.type === 'file-start') {
const timerSeconds = Number(message.timerSeconds || 0);
const expiresAt = timerSeconds > 0 ? new Date(Date.now() + timerSeconds * 1000).toISOString() : (message.expiresAt || '');
chatState.incomingFiles.set(message.transferId, {
meta: { ...message, expiresAt, timerSeconds },
chunks: new Array(message.totalChunks).fill(''),
received: 0,
session,
});
return;
}
if (message.type === 'file-chunk') {
const transfer = chatState.incomingFiles.get(message.transferId);
if (!transfer) return;
transfer.chunks[message.index] = message.chunk;
transfer.received += 1;
if (transfer.received >= transfer.meta.totalChunks) {
const payload = {
iv: transfer.meta.iv,
cipher: transfer.chunks.join(''),
};
const decrypted = await decryptForSession(transfer.session, payload);
const blob = new Blob([decrypted], { type: transfer.meta.mime || 'application/octet-stream' });
const url = URL.createObjectURL(blob);
let historyKey = getPeerHistoryKey(findPeerBySession(session), session);
if (transfer.meta.spaceId) {
const space = upsertSharedSpace({
type: transfer.meta.spaceType || 'group',
name: transfer.meta.spaceName || t('فضای مشترک', 'Shared space'),
conversationId: transfer.meta.spaceId,
members: Array.isArray(transfer.meta.members) ? transfer.meta.members : [],
ownerPeerId: transfer.meta.ownerPeerId || '',
ownerClientId: transfer.meta.ownerClientId || '',
ownerFingerprint: transfer.meta.ownerFingerprint || '',
createdAt: transfer.meta.createdAt || new Date().toISOString(),
});
historyKey = space?.conversationId || transfer.meta.spaceId || historyKey;
}
appendHistory(historyKey, {
id: transfer.meta.messageId || generateId('file'),
direction: 'in',
type: transfer.meta.kind === 'voice' ? 'voice' : 'file',
name: transfer.meta.name,
size: transfer.meta.size,
status: 'delivered',
createdAt: transfer.meta.createdAt || new Date().toISOString(),
downloadUrl: url,
expiresAt: transfer.meta.expiresAt || '',
timerSeconds: transfer.meta.timerSeconds || 0,
senderName: transfer.meta.senderName || '',
senderPeerId: transfer.meta.senderPeerId || '',
senderFingerprint: transfer.meta.senderFingerprint || '',
});
sendDeliveryAck(transfer.session, transfer.meta.messageId, appState()?.activeTab === 'chat' && !document.hidden ? 'seen' : 'delivered');
chatState.incomingFiles.delete(message.transferId);
}
return;
}
if (message.type === 'voice' || message.type === 'file') {
const decrypted = await decryptForSession(session, message.payload);
const blob = new Blob([decrypted], { type: message.mime || 'application/octet-stream' });
const url = URL.createObjectURL(blob);
appendHistory(getPeerHistoryKey(findPeerBySession(session), session), {
id: message.messageId || generateId('file'),
direction: 'in',
type: message.type,
name: message.name,
size: message.size,
durationMs: message.durationMs || 0,
status: 'delivered',
createdAt: message.createdAt || new Date().toISOString(),
downloadUrl: url,
expiresAt: message.expiresAt || '',
});
sendDeliveryAck(session, message.messageId, appState()?.activeTab === 'chat' && !document.hidden ? 'seen' : 'delivered');
return;
}
}
function sessionForPeer(peerRecord, connection) {
const existing = chatState.sessions.get(peerRecord.peerId) || {};
const session = {
...existing,
peerId: peerRecord.peerId,
remoteClientId: peerRecord.clientId,
remoteFingerprint: peerRecord.fingerprint || '',
remotePublicKeyData: peerRecord.publicKeyData || '',
conversationId: getConversationKey(peerRecord),
connection,
};
chatState.sessions.set(peerRecord.peerId, session);
hydrateSessionKey(session).then(() => renderActivePeer()).catch(console.error);
return session;
}
function bindDataConnection(peerRecord, connection, initiator = false) {
const session = sessionForPeer(peerRecord, connection);
session.initiator = initiator;
session.messageQueue = session.messageQueue || Promise.resolve();
connection.on('open', async () => {
safeConnectionSend(connection, {
type: 'session-hello',
clientId: chatState.clientId || chatState.peerId,
peerId: chatState.peerId,
username: chatState.profile.name,
publicKeyData: chatState.identity?.publicKeyData || '',
fingerprint: chatState.identity?.fingerprint || '',
createdAt: new Date().toISOString(),
}, 'session-hello');
if (initiator) {
setTimeout(() => {
const latest = chatState.sessions.get(peerRecord.peerId);
if (latest?.connection?.open && !latest.cryptoKey && peerRecord.publicKeyData) {
ensureSessionKey(latest, peerRecord).catch(console.error);
}
}, 1200);
}
renderActivePeer();
if (!session.silent) {
notify(t('سشن P2P برقرار شد', 'P2P session established'), 'success');
}
session.silent = false;
});
connection.on('data', (message) => {
session.messageQueue = session.messageQueue
.then(() => handleSessionMessage(session, message))
.catch((error) => {
console.error(error);
if (['receipt', 'ping', 'pong'].includes(String(message?.type || ''))) return;
notify(t('پردازش پیام امن ناموفق بود', 'Failed to process secure message'), 'error');
});
});
connection.on('close', () => {
const existing = chatState.sessions.get(peerRecord.peerId);
if (existing) {
existing.connection = null;
}
renderActivePeer();
});
connection.on('error', (error) => {
console.error(error);
markPeerUnavailable(peerRecord.peerId, t('کانال P2P این کاربر قطع شد؛ برای جلوگیری از ارسال اشتباه از فهرست آنلاین حذف شد.', 'The peer channel dropped; the stale peer was removed from the online list.'));
});
return session;
}
function onPeerDiscovered(peer) {
if (isSelfPeerRecord(peer)) {
chatState.peers = chatState.peers.filter((item) => !isSelfPeerRecord(item));
saveContacts();
renderPeers();
renderActivePeer();
return;
}
mergePeerRecord(peer, { online: true });
chatState.peers = chatState.peers.filter((item) => !isSelfPeerRecord(item));
saveContacts();
if (!isCompactChatLayout() && !chatState.activePeerClientId && !chatState.activeConversationId && chatState.peers.some(shouldShowConversation)) {
const visiblePeers = chatState.peers.filter(shouldShowConversation);
const seedPeer = visiblePeers.find((item) => item.status === 'online') || visiblePeers[0];
chatState.activePeerClientId = seedPeer.clientId;
chatState.activeConversationId = getConversationKey(seedPeer);
}
chatState.spaces.groups.forEach((space) => {
sendRelayEnvelope(peer, {
type: 'space-sync',
space,
createdAt: new Date().toISOString(),
});
});
renderPeers();
renderActivePeer();
retryQueuedMessages();
}
function broadcastHello() {
if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN || !chatState.peerId || !chatState.clientId) return;
const identity = chatState.identity;
chatState.ws.send(JSON.stringify({
type: 'hello',
clientId: chatState.clientId,
username: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
publicKeyData: identity?.publicKeyData || '',
fingerprint: identity?.fingerprint || '',
avatarData: chatState.profile.avatarData || '',
}));
registerChatPush(false).catch((error) => console.warn('Web Push registration skipped:', error));
}
function ackRelayMessage(relayId) {
if (!relayId || chatState.ws?.readyState !== WebSocket.OPEN) return;
chatState.ws.send(JSON.stringify({ type: 'relay-ack', ids: [relayId] }));
}
function clearReconnectTimer() {
if (chatState.reconnectTimer) {
clearTimeout(chatState.reconnectTimer);
chatState.reconnectTimer = null;
}
}
function scheduleReconnect() {
clearReconnectTimer();
if (!chatState.shouldReconnect || !isUnlocked()) return;
const delay = Math.min(15000, 1200 * (2 ** chatState.reconnectAttempt));
chatState.reconnectAttempt += 1;
chatState.reconnectTimer = setTimeout(async () => {
chatState.reconnectTimer = null;
try {
if (chatState.peer?.destroyed) {
chatState.peer = null;
await connectChatTransport();
return;
}
connectPresence();
} catch (error) {
console.error(error);
}
}, delay);
}
// Handle mobile background/foreground transitions
document.addEventListener('visibilitychange', () => {
if (document.visibilityState === 'hidden') {
flushHistoryStore();
}
if (document.visibilityState === 'visible') {
if (hasActiveServerRestriction()) {
probeServerRestrictionLifted({ silent: true }).catch(console.error);
return;
}
if (chatState.shouldReconnect && (!chatState.ws || chatState.ws.readyState === WebSocket.CLOSED)) {
console.log('[Presence] App returned to foreground, triggering reconnection...');
// Reset attempt count for faster immediate reconnect on focus
chatState.reconnectAttempt = 0;
clearReconnectTimer();
connectChatTransport().catch(console.error);
}
}
});
window.addEventListener('focus', () => {
if (hasActiveServerRestriction()) {
probeServerRestrictionLifted({ silent: true }).catch(console.error);
}
});
window.addEventListener('online', () => {
if (hasActiveServerRestriction()) {
probeServerRestrictionLifted({ silent: true }).catch(console.error);
}
});
window.addEventListener('pagehide', flushHistoryStore);
function startHeartbeat() {
if (chatState.heartbeatTimer) clearInterval(chatState.heartbeatTimer);
chatState.heartbeatTimer = setInterval(() => {
if (chatState.ws?.readyState === WebSocket.OPEN) {
chatState.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
}
// Also ping active P2P data connections
chatState.sessions.forEach((session) => {
if (session.connection?.open) {
try {
safeConnectionSend(session.connection, { type: 'ping', timestamp: Date.now() }, 'heartbeat');
} catch (_e) { /* noop */ }
}
});
}, 10000);
}
function connectPresence() {
if (chatState.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(chatState.ws.readyState)) {
return;
}
chatState.ws = new WebSocket(wsUrl());
setConnectionState(false, t('در حال اتصال...', 'Connecting...'));
chatState.ws.addEventListener('open', () => {
clearReconnectTimer();
chatState.reconnectAttempt = 0;
chatState.serverReachable = true;
setConnectionState(true, t('متصل به سرور چت', 'Connected to chat server'));
renderStaticUi();
startHeartbeat();
retryQueuedMessages();
});
chatState.ws.addEventListener('message', (event) => {
let message;
try {
message = JSON.parse(event.data);
} catch (error) {
console.warn('Invalid chat signal payload:', error);
return;
}
if (message.type === 'welcome') {
chatState.clientId = message.clientId || '';
renderStaticUi();
broadcastHello();
return;
}
if (message.type === 'peers') {
chatState.peers.forEach((peer) => {
if (!peer.type) peer.status = 'offline';
});
(message.peers || []).forEach((peer) => mergePeerRecord(peer, { online: true }));
chatState.peers = chatState.peers.filter((peer) => !isSelfPeerRecord(peer));
saveContacts();
renderPeers();
renderActivePeer();
// Retry sending queued messages when peers list updates (potential reconnection)
retryQueuedMessages();
return;
}
if (message.type === 'server-suspended' || message.type === 'server-kicked') {
let defaultMsg = '';
if (message.permanent) {
defaultMsg = message.type === 'server-suspended'
? t('شما موقتاً تعلیق شده اید.', 'You are temporarily suspended.')
: t('دسترسی شما در سیستم محدود شده است، لطفاً برای رفع محدودیت با ادمین سرور و یا پشتیبانی تماس بگیرید.', 'Your access is permanently restricted, please contact support.');
} else {
let untilText = '';
if (message.until) {
const d = new Date(message.until);
untilText = ' تا ' + d.toLocaleString('fa-IR') + ' (' + d.toLocaleString('en-US') + ')';
}
defaultMsg = message.type === 'server-suspended'
? t(`شما موقتاً تعلیق شده اید.${untilText}`, `You are temporarily suspended${untilText}.`)
: t(`اتصال شما از سرور قطع شد و${untilText} امکان اتصال ندارید.`, `You were kicked from this server${untilText}.`);
}
setServerRestriction({
type: message.type === 'server-suspended' ? 'suspended' : 'kicked',
message: defaultMsg,
until: message.until || null,
permanent: Boolean(message.permanent),
});
const text = message.type === 'server-suspended' ? restrictionText() : defaultMsg;
if (message.silent) {
try { chatState.ws?.close(); } catch (_error) {}
return;
}
notifyRestrictionOnce(text);
appendHistory('system', {
id: generateId('sys'),
type: 'text',
kind: 'text',
text,
senderName: t('سیستم', 'System'),
direction: 'in',
timestamp: message.timestamp || Date.now(),
createdAt: new Date(message.timestamp || Date.now()).toISOString(),
system: true
});
try { chatState.ws?.close(); } catch (_error) {}
return;
}
if (message.type === 'system-broadcast') {
const conversationId = 'system';
const entry = {
id: generateId('sys'),
type: message.kind === 'voice' ? 'voice' : (message.kind === 'file' ? 'file' : 'text'),
kind: message.kind || 'text',
text: message.message || '',
name: message.fileName || (message.kind === 'voice' ? t('صدای سیستم', 'System Voice') : t('فایل سیستم', 'System File')),
downloadUrl: message.fileData || '',
senderName: t('سیستم', 'System'),
direction: 'in',
timestamp: message.timestamp || Date.now(),
createdAt: new Date(message.timestamp || Date.now()).toISOString(),
system: true
};
appendHistory(conversationId, entry);
return;
}
if (message.type === 'relay') {
const payload = message.payload;
if (!payload) {
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-invite') {
const queuedAt = message.queuedAt ? Date.parse(message.queuedAt) : 0;
if (queuedAt && Date.now() - queuedAt > CALL_RING_TIMEOUT_MS) {
appendCall({
name: payload.name || message.fromClientId,
peerId: payload.peerId || message.fromClientId,
mode: payload.mode || 'voice',
status: 'missed',
direction: 'in',
createdAt: message.queuedAt,
});
ackRelayMessage(message.relayId);
return;
}
const incomingPeerId = payload.peerId || message.fromClientId;
if (chatState.pendingIncomingInvite?.peerId === incomingPeerId ||
chatState.pendingIncomingCall?.peer === incomingPeerId ||
chatState.currentCall?.peer === incomingPeerId) {
return;
}
if (chatState.currentCall || chatState.pendingIncomingCall || chatState.pendingIncomingInvite) {
const busyPeer = findPeerRecordByPeerId(incomingPeerId);
if (busyPeer) {
sendRelayEnvelope(busyPeer, {
type: 'call-busy',
mode: payload.mode || 'voice',
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
});
}
notify(t('در حال حاضر در تماس دیگری هستید و تماس جدید رد شد.', 'You are already in another call, so the new request was rejected.'), 'warning');
return;
}
showIncomingCall(null, {
peerId: incomingPeerId,
mode: payload.mode || 'voice',
name: payload.name || message.fromClientId,
groupId: payload.groupId || null,
});
appendCall({
name: payload.name || message.fromClientId,
peerId: incomingPeerId,
mode: payload.mode,
status: 'ringing',
direction: 'in',
logToChat: false,
});
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-busy') {
const peer = findPeerRecordByPeerId(payload.peerId || message.fromClientId || '');
appendCall({
name: payload.name || peer?.username || message.fromClientId,
peerId: peer?.peerId || payload.peerId || message.fromClientId,
mode: payload.mode || chatState.currentCallMode || 'voice',
status: 'failed',
direction: chatState.currentCallDirection || 'out',
});
notify(t('کاربر مقصد در حال حاضر در تماس دیگری است.', 'The target user is already on another call.'), 'warning');
endCurrentCall({ logCall: false });
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-reject') {
const peer = findPeerRecordByPeerId(payload.peerId || message.fromClientId || '') || activePeer();
appendCall({
name: payload.name || peer?.username || message.fromClientId,
peerId: peer?.peerId || payload.peerId || message.fromClientId,
mode: payload.mode || chatState.currentCallMode || 'voice',
status: 'rejected',
direction: chatState.currentCallDirection || 'out',
});
notify(t('تماس شما رد شد.', 'Your call was rejected.'), 'info');
endCurrentCall({ logCall: false });
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-missed') {
appendCall({
name: payload.name || message.fromClientId,
peerId: payload.peerId || message.fromClientId,
mode: payload.mode || 'voice',
status: 'missed',
direction: 'in',
createdAt: payload.createdAt || message.queuedAt || new Date().toISOString(),
});
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-cancel') {
const peerId = payload.peerId || message.fromClientId;
if (chatState.pendingIncomingCall?.peer === peerId || chatState.pendingIncomingInvite?.peerId === peerId) {
hideIncomingCall();
}
appendCall({
name: payload.name || message.fromClientId,
peerId: payload.peerId || message.fromClientId,
mode: payload.mode || 'voice',
status: 'missed',
direction: 'in',
createdAt: payload.createdAt || new Date().toISOString(),
});
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'call-ended') {
appendCall({
name: payload.name || message.fromClientId,
peerId: payload.peerId || message.fromClientId,
mode: payload.mode || 'voice',
status: 'ended',
direction: 'in',
durationMs: Number(payload.durationMs || 0),
createdAt: payload.createdAt || new Date().toISOString(),
});
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'space-sync' && payload.space) {
upsertSharedSpace(payload.space);
renderPeers();
renderActivePeer();
ackRelayMessage(message.relayId);
return;
}
if (payload.type === 'offline-chat') {
const fromId = message.fromFingerprint || message.fromClientId || 'unknown';
if (!chatState.wsMessageQueues.has(fromId)) {
chatState.wsMessageQueues.set(fromId, Promise.resolve());
}
chatState.wsMessageQueues.set(fromId, chatState.wsMessageQueues.get(fromId).then(async () => {
try {
if (await handleOfflineRelayMessage(message)) {
ackRelayMessage(message.relayId);
}
} catch (error) {
console.error('Failed to process offline relay message in queue:', error);
}
}));
return;
}
if (payload.type === 'typing') {
handleRemoteTyping(message.fromFingerprint);
ackRelayMessage(message.relayId);
return;
}
ackRelayMessage(message.relayId);
}
});
chatState.ws.addEventListener('close', () => {
if (hasActiveServerRestriction()) {
renderRestrictionStatus();
if (chatState.heartbeatTimer) clearInterval(chatState.heartbeatTimer);
return;
}
setConnectionState(false, t('ارتباط با سرور چت قطع شد', 'Chat server disconnected'));
chatState.serverReachable = false;
chatState.peers.forEach((peer) => {
if (!peer.type) peer.status = 'offline';
});
saveContacts();
if (chatState.heartbeatTimer) clearInterval(chatState.heartbeatTimer);
renderPeers();
renderActivePeer();
if (!chatState.shouldReconnect) return;
scheduleReconnect();
});
chatState.ws.addEventListener('error', () => {
if (hasActiveServerRestriction()) {
renderRestrictionStatus();
return;
}
chatState.serverReachable = false;
setConnectionState(false, t('سرور چت در دسترس نیست', 'Chat server is unreachable'));
});
}
async function connectChatTransport() {
if (!isUnlocked()) {
notify(t('برای فعال‌سازی چت ابتدا باید برنامه را باز کنید', 'Unlock the app before enabling chat'), 'warning');
return;
}
await ensureIdentity();
if (hasActiveServerRestriction()) {
const restrictionLifted = await probeServerRestrictionLifted({ silent: true, reconnect: false });
if (!restrictionLifted && hasActiveServerRestriction()) {
notifyRestrictionOnce();
return;
}
}
if (chatState.profile.autoDiscovery) {
await discoverLocalRelayServer({ fullScan: false, silent: true });
}
await hydrateRelayTurnConfig();
if (!await ensureRelayTransportReady()) return;
chatState.shouldReconnect = true;
renderStaticUi();
const nextPeerOrigin = peerTransportOrigin();
const canReusePeer = Boolean(
chatState.peer
&& !chatState.peer.destroyed
&& chatState.peer.open
&& chatState.peerTransportOrigin === nextPeerOrigin
);
if (!canReusePeer && chatState.peer && !chatState.peer.destroyed) {
chatState.peer.destroy();
chatState.peer = null;
chatState.peerId = '';
chatState.sessions.clear();
}
if (canReusePeer) {
connectPresence();
return;
}
const PeerCtor = window.Peer;
if (!PeerCtor) {
notify(t('کتابخانه PeerJS لود نشده است', 'PeerJS client failed to load'), 'error');
return;
}
const stablePeerId = chatState.profile.stablePeerId || generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-');
chatState.profile.stablePeerId = stablePeerId;
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
// Add a small delay to ensure identity and other async states are fully hydrated
if (chatState.reconnectAttempt === 0) {
await new Promise(r => setTimeout(r, 500));
}
const peer = new PeerCtor(stablePeerId, peerOptions());
chatState.peer = peer;
chatState.peerTransportOrigin = nextPeerOrigin;
peer.on('open', (peerId) => {
chatState.reconnectAttempt = 0; // Reset on success
chatState.peerId = peerId;
renderStaticUi();
connectPresence();
broadcastHello();
});
peer.on('connection', (connection) => {
const remotePeer = {
clientId: connection.metadata?.clientId || connection.peer,
peerId: connection.peer,
username: connection.metadata?.username || connection.peer,
publicKeyData: connection.metadata?.publicKeyData || '',
fingerprint: connection.metadata?.fingerprint || '',
status: 'online',
};
onPeerDiscovered(remotePeer);
bindDataConnection(remotePeer, connection, false);
});
peer.on('call', async (call) => {
appendCall({
name: call.metadata?.username || call.peer,
peerId: call.peer,
mode: call.metadata?.mode || 'voice',
status: 'incoming',
direction: 'in',
logToChat: false,
});
showIncomingCall(call);
if (chatState.pendingIncomingAccept) {
acceptIncomingCall().catch(console.error);
}
});
peer.on('error', (error) => {
console.error(error);
const errorText = String(`${error?.type || ''} ${error?.message || error || ''}`);
const missingPeer = errorText.match(/Could not connect to peer\s+([A-Za-z0-9_-]+)/i)?.[1];
if (missingPeer || /peer-unavailable/i.test(errorText)) {
markPeerUnavailable(missingPeer || activePeer()?.peerId || '', t('Peer انتخاب‌شده آنلاین نیست یا دیگر در دسترس نیست؛ فهرست را به‌روزرسانی کردیم.', 'The selected peer is not online or is no longer reachable; the list was refreshed.'));
setConnectionState(Boolean(chatState.ws?.readyState === WebSocket.OPEN), t('متصل به رله؛ Peer مقصد در دسترس نیست', 'Relay connected; target peer is unreachable'));
return;
}
if (errorText.includes('unavailable-id')) {
console.warn('Peer ID already in use, regenerating...');
chatState.profile.stablePeerId = generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-');
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
// Force immediate reconnect with new ID
setTimeout(() => connectChatTransport(), 500);
return;
}
notify(t('اتصال PeerJS با خطا مواجه شد', 'PeerJS connection failed'), 'error');
setConnectionState(Boolean(chatState.ws?.readyState === WebSocket.OPEN), t('رله متصل است؛ لایه P2P خطا دارد', 'Relay connected; P2P layer has an error'));
scheduleReconnect();
});
}
async function startSecureSession(targetPeer = null, { silent = false } = {}) {
if (hasActiveServerRestriction()) {
notifyRestrictionOnce();
return null;
}
const peerRecord = targetPeer || activePeer();
if (!peerRecord || !chatState.peer) return;
const existing = chatState.sessions.get(peerRecord.peerId);
if (existing?.connection?.open) {
if (!existing.cryptoKey) await ensureSessionKey(existing, peerRecord);
renderActivePeer();
return existing;
}
const connection = chatState.peer.connect(peerRecord.peerId, {
reliable: true,
metadata: {
clientId: chatState.clientId || chatState.peerId,
username: chatState.profile.name,
publicKeyData: chatState.identity?.publicKeyData || '',
fingerprint: chatState.identity?.fingerprint || '',
},
});
const session = bindDataConnection(peerRecord, connection, true);
session.silent = Boolean(silent);
return chatState.sessions.get(peerRecord.peerId) || null;
}
async function sendMessage() {
if (chatState.voiceDraft) {
await sendVoiceDraft();
return;
}
const composer = document.getElementById('chatComposer');
const text = composer?.value.trim();
if (!text) return;
if (chatState.editingMessageId) {
await finalizeMessageEdit(chatState.editingMessageId, text);
return;
}
let session = activeSession();
const peer = getActiveConversation();
const directPeer = activePeer();
if (!peer || !composer) return;
const messageId = generateId('msg');
const timerSeconds = Number(chatState.timerSeconds || 0);

if (timerSeconds > 0 && directPeer) {
if (!session?.cryptoKey || directPeer.status !== 'online') {
notify(t('پیام‌های خودتخریب فقط زمانی قابل ارسال هستند که کاربر آنلاین باشد.', 'Self-destruct messages can only be sent when the user is online.'), 'warning');
return;
}
}

const expiresAt = ''; // Start timer only on delivery
const replyToId = chatState.replyToId;
const createdAt = new Date().toISOString();
if (peer.type === 'group') {
const members = groupDeliveryMemberKeys(peer);
peer.members = members;
saveSpaces();
appendHistory(peer.conversationId, {
id: messageId,
direction: 'out',
type: 'text',
text,
senderName: chatState.profile.name || t('شما', 'You'),
senderPeerId: chatState.peerId || '',
senderFingerprint: chatState.identity?.fingerprint || '',
status: 'queued',
expiresAt: '',
timerSeconds,
replyToId,
createdAt,
});
composer.value = '';
syncComposerHeight(composer);
clearMessageContext();
let delivered = 0;
for (const memberId of members) {
const member = findPeerByAnyKey(memberId);
if (!member || isSelfPeerRecord(member)) continue;
let memberSession = await ensureStoredSession(member);
if (!memberSession?.cryptoKey && member.status === 'online') {
memberSession = await ensureDirectSession(member);
}
if (!memberSession?.cryptoKey) continue;
const spacePayload = {
spaceId: peer.conversationId,
spaceType: 'group',
spaceName: peer.name,
members,
ownerPeerId: peer.ownerPeerId || chatState.peerId || '',
ownerClientId: peer.ownerClientId || chatState.clientId || '',
ownerFingerprint: peer.ownerFingerprint || '',
messageId,
text,
senderName: chatState.profile.name || t('شما', 'You'),
senderPeerId: chatState.peerId || '',
senderFingerprint: chatState.identity?.fingerprint || '',
createdAt,
expiresAt: '',
timerSeconds,
replyToId,
};
const payload = await encryptForSession(memberSession, new TextEncoder().encode(JSON.stringify(spacePayload)));
const outbound = { id: messageId, type: 'space-message', createdAt, payload };
if (memberSession.connection?.open) {
safeConnectionSend(memberSession.connection, outbound, 'group-message');
delivered += 1;
} else if (sendRelayEnvelope(member, { type: 'offline-chat', fromPeerId: chatState.peerId, message: outbound, createdAt: outbound.createdAt }, true)) {
delivered += 1;
}
}
markMessageStatus(peer.conversationId, messageId, delivered ? 'sent' : 'queued');
if (!delivered && members.length) {
notify(t('پیام گروه ذخیره شد؛ بعد از آماده شدن سشن اعضا دوباره تلاش کنید.', 'Group message was saved; retry after member sessions are ready.'), 'warning');
}
return;
}
const targetPeer = directPeer || (peer && !peer.type ? peer : null);
if (!targetPeer) return;
if (isSelfPeerRecord(targetPeer)) {
notify(t('ارسال پیام به خود همین سشن مجاز نیست.', 'Sending a message to the current session itself is not allowed.'), 'warning');
return;
}
appendHistory(getConversationKey(targetPeer), {
id: messageId,
direction: 'out',
type: 'text',
text,
status: 'queued',
expiresAt: '',
timerSeconds,
replyToId,
createdAt: new Date().toISOString(),
});
composer.value = '';
syncComposerHeight(composer);
clearMessageContext();
if (!session?.cryptoKey) {
notify(t('در حال ساخت سشن امن برای ارسال پیام...', 'Creating secure session before sending...'), 'info');
session = await ensureDirectSession(targetPeer);
}
if (!session?.cryptoKey) {
markMessageStatus(getConversationKey(targetPeer), messageId, 'failed');
notify(t('سشن امن هنوز آماده نیست. چند ثانیه بعد دوباره ارسال کنید یا اتصال را بررسی کنید.', 'Secure session is not ready yet. Try again in a few seconds or check the connection.'), 'warning');
return;
}
const payload = await encryptForSession(session, new TextEncoder().encode(text));
const outbound = {
type: 'text',
id: messageId,
createdAt: new Date().toISOString(),
expiresAt: '',
timerSeconds,
replyToId,
payload,
};
if (session.connection?.open) {
safeConnectionSend(session.connection, outbound, 'text-message');
markMessageStatus(getConversationKey(targetPeer), messageId, 'sent');
} else {
sendRelayEnvelope(targetPeer, {
type: 'offline-chat',
fromPeerId: chatState.peerId,
message: outbound,
createdAt: outbound.createdAt
});
markMessageStatus(getConversationKey(targetPeer), messageId, 'queued');
}
}
async function sendFile(file) {
return sendEncryptedBlob(file, 'file', 0);
}
async function sendEncryptedBlob(file, kind = 'file', durationMs = 0) {
let session = activeSession();
const conversation = getActiveConversation();
const peer = activePeer();
if (!conversation || !file) return;
if (file.size > MAX_FILE_BYTES) {
notify(t('فعلاً فقط فایل‌های تا 16 مگابایت پشتیبانی می‌شوند', 'Files are currently limited to 16 MB'), 'warning');
return;
}
if (conversation.type === 'group') {
const historyId = generateId(kind === 'voice' ? 'voice' : 'file');
const localUrl = URL.createObjectURL(file);
const timerSeconds = Number(chatState.timerSeconds || 0);

if (timerSeconds > 0 && (!conversation || !conversation.type)) {
const peer = activePeer();
if (!session?.cryptoKey || peer?.status !== 'online') {
notify(t('فایل‌های خودتخریب فقط زمانی قابل ارسال هستند که کاربر آنلاین باشد.', 'Self-destruct files can only be sent when the user is online.'), 'warning');
return;
}
}

const expiresAt = ''; // Start timer only on delivery
const createdAt = new Date().toISOString();
const members = groupDeliveryMemberKeys(conversation);
conversation.members = members;
saveSpaces();
appendHistory(conversation.conversationId, {
id: historyId,
direction: 'out',
type: kind,
name: file.name,
size: file.size,
downloadUrl: localUrl,
durationMs: kind === 'voice' ? durationMs : 0,
senderName: chatState.profile.name || t('شما', 'You'),
senderPeerId: chatState.peerId || '',
senderFingerprint: chatState.identity?.fingerprint || '',
status: 'queued',
createdAt,
expiresAt: '',
timerSeconds,
});
const rawBuffer = await file.arrayBuffer();
let delivered = 0;
for (const memberId of members) {
const member = findPeerByAnyKey(memberId);
if (!member || isSelfPeerRecord(member)) continue;
let memberSession = await ensureStoredSession(member);
if (!memberSession?.cryptoKey && member.status === 'online') {
memberSession = await ensureDirectSession(member);
}
if (!memberSession?.cryptoKey) continue;
const encrypted = await encryptForSession(memberSession, rawBuffer);
const cipherBase64 = encrypted.cipher;
const totalChunks = Math.ceil(cipherBase64.length / FILE_CHUNK_SIZE);
const transferId = generateId('transfer');
const startMessage = {
type: 'file-start',
transferId,
messageId: historyId,
name: file.name,
mime: file.type || 'application/octet-stream',
kind,
size: file.size,
durationMs: kind === 'voice' ? durationMs : 0,
totalChunks,
iv: encrypted.iv,
createdAt,
expiresAt: '',
timerSeconds,
spaceId: conversation.conversationId,
spaceType: 'group',
spaceName: conversation.name,
members,
ownerPeerId: conversation.ownerPeerId || chatState.peerId || '',
ownerClientId: conversation.ownerClientId || chatState.clientId || '',
ownerFingerprint: conversation.ownerFingerprint || '',
senderName: chatState.profile.name || t('شما', 'You'),
senderPeerId: chatState.peerId || '',
senderFingerprint: chatState.identity?.fingerprint || '',
};
const sendWithRetry = (msg) => {
if (memberSession.connection?.open) {
return safeConnectionSend(memberSession.connection, msg, 'group-file');
}
return sendRelayEnvelope(member, {
type: 'offline-chat',
fromPeerId: chatState.peerId,
message: msg,
createdAt: msg.createdAt || createdAt,
}, true);
};
if (sendWithRetry(startMessage)) delivered += 1;
for (let i = 0; i < totalChunks; i++) {
const chunk = cipherBase64.slice(i * FILE_CHUNK_SIZE, (i + 1) * FILE_CHUNK_SIZE);
sendWithRetry({ type: 'file-chunk', transferId, index: i, chunk });
if (i % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 20));
}
}
markMessageStatus(conversation.conversationId, historyId, delivered ? 'sent' : 'queued');
if (!delivered && members.length) {
notify(t('فایل/صوت گروه ذخیره شد؛ برای تحویل، سشن امن اعضا باید آماده باشد.', 'Group file/voice was saved; member secure sessions must be ready for delivery.'), 'warning');
}
return;
}
if (!peer) return;
if (isSelfPeerRecord(peer)) {
notify(t('ارسال فایل یا پیام صوتی به همین سشن محلی مجاز نیست.', 'Sending files or voice messages to the current session itself is not allowed.'), 'warning');
return;
}
const historyId = generateId(kind === 'voice' ? 'voice' : 'file');
const localUrl = URL.createObjectURL(file);
const timerSeconds = Number(chatState.timerSeconds || 0);

if (timerSeconds > 0 && (!conversation || !conversation.type)) {
const peer = activePeer();
if (!session?.cryptoKey || peer?.status !== 'online') {
notify(t('فایل‌های خودتخریب فقط زمانی قابل ارسال هستند که کاربر آنلاین باشد.', 'Self-destruct files can only be sent when the user is online.'), 'warning');
return;
}
}

const expiresAt = ''; // Start timer only on delivery
appendHistory(getConversationKey(peer), {
id: historyId,
direction: 'out',
type: kind,
name: file.name,
size: file.size,
downloadUrl: localUrl,
durationMs: kind === 'voice' ? durationMs : 0,
status: 'queued',
createdAt: new Date().toISOString(),
expiresAt: '',
timerSeconds,
});
if (!session?.cryptoKey) {
session = await ensureDirectSession(peer);
}
if (!session?.cryptoKey) {
markMessageStatus(getConversationKey(peer), historyId, 'failed');
notify(t('برای ارسال فایل/صدا باید سشن امن آماده باشد.', 'A secure session is required before sending files or voice messages.'), 'warning');
return;
}
const encrypted = await encryptForSession(session, await file.arrayBuffer());
const cipherBase64 = encrypted.cipher;
const totalChunks = Math.ceil(cipherBase64.length / FILE_CHUNK_SIZE);
const transferId = generateId('transfer');
const startMessage = {
type: 'file-start',
transferId,
messageId: historyId,
name: file.name,
mime: file.type || 'application/octet-stream',
kind,
size: file.size,
durationMs: kind === 'voice' ? durationMs : 0,
totalChunks,
iv: encrypted.iv,
createdAt: new Date().toISOString(),
expiresAt: '',
timerSeconds,
};
const sendWithRetry = (msg) => {
if (session.connection?.open) {
return safeConnectionSend(session.connection, msg, 'file');
}
return sendRelayEnvelope(peer, { type: 'offline-chat', fromPeerId: chatState.peerId, message: msg, createdAt: msg.createdAt || new Date().toISOString() }, true);
};
sendWithRetry(startMessage);
for (let i = 0; i < totalChunks; i++) {
const chunk = cipherBase64.slice(i * FILE_CHUNK_SIZE, (i + 1) * FILE_CHUNK_SIZE);
const chunkMessage = {
type: 'file-chunk',
transferId,
index: i,
chunk,
};
sendWithRetry(chunkMessage);
// Small delay to prevent flooding
if (i % 5 === 0) await new Promise(r => setTimeout(r, 20));
}
markMessageStatus(getConversationKey(peer), historyId, session.connection?.open ? 'sent' : 'queued');
renderMessages();
}
async function sendFile(file) {
return sendEncryptedBlob(file, 'file', 0);
}
async function playMediaElement(element) {
if (!element) return;
try {
await element.play?.();
} catch (_error) {
/* ignore autoplay failures */
}
}
function streamHasLiveVideo(stream) {
return Boolean(stream?.getVideoTracks?.().some((track) => track.readyState === 'live'));
}
function prepareVideoElement(element, { muted = false } = {}) {
if (!element) return;
element.autoplay = true;
element.setAttribute('autoplay', 'autoplay');
element.playsInline = true;
element.setAttribute('playsinline', 'true');
element.setAttribute('webkit-playsinline', 'true');
element.preload = 'auto';
element.disablePictureInPicture = true;
element.controls = false;
if (muted) {
element.muted = true;
element.defaultMuted = true;
element.setAttribute('muted', 'muted');
}
}
function syncVideoElementFit(element) {
if (!element) return;
const width = Number(element.videoWidth || 0);
const height = Number(element.videoHeight || 0);
const hasDimensions = width > 0 && height > 0;
const orientation = hasDimensions
? (height > width ? 'portrait' : 'landscape')
: 'unknown';
element.classList.toggle('portrait-mode', orientation === 'portrait');
element.classList.toggle('landscape-mode', orientation === 'landscape');
element.dataset.videoOrientation = orientation;
element.style.objectFit = 'contain';
element.style.objectPosition = 'center center';
element.style.transform = 'none';
const stage = element.closest('.chat-remote-stage, .chat-local-stage');
if (stage) {
stage.dataset.videoOrientation = orientation;
if (hasDimensions) {
stage.style.setProperty('--video-aspect', `${width} / ${height}`);
}
}
syncCallStageState();
}
function stopStream(stream) {
if (!stream) return;
stream.getTracks().forEach((track) => {
try {
track.stop();
} catch (_error) {
/* noop */
}
});
}
function clearMediaElement(id) {
const element = document.getElementById(id);
if (!element) return;
element.pause?.();
element.srcObject = null;
element.removeAttribute('src');
}
function activeCallPeerRecord() {
return findPeerRecordByPeerId(chatState.currentCall?.peer || chatState.pendingIncomingCall?.peer || chatState.pendingIncomingInvite?.peerId || '') || activePeer() || null;
}
function syncFloatingCallPeerIdentity() {
const peer = activeCallPeerRecord() || getActiveConversation();
const avatar = document.getElementById('chatFloatingRemoteAvatar');
if (avatar && peer) {
avatar.textContent = initials(peer.username || peer.name || peer.peerId || 'P');
avatar.classList.toggle('has-avatar', Boolean(peer.avatarData));
avatar.innerHTML = peer.avatarData ? `<img src="${peer.avatarData}" alt="">` : app().escapeHTML(initials(peer.username || peer.name || peer.peerId || 'P'));
}
const title = document.getElementById('chatFloatingCallTitle');
const status = document.getElementById('chatFloatingCallStatus');
if (title && peer) {
const modeLabel = chatState.currentCallMode === 'video'
? t('تماس تصویری فعال', 'Video call active')
: t('تماس صوتی فعال', 'Voice call active');
title.textContent = `${modeLabel}`;
title.setAttribute('data-peer-name', peer.username || peer.name || peer.peerId || '');
}
if (status && peer && !chatState.currentCall) {
status.textContent = app().escapeHTML(peer.username || peer.name || peer.peerId || '');
}
}
function mountChatPortals() {
const incomingModal = document.getElementById('chatIncomingCallModal');
const floatingCall = document.getElementById('chatFloatingCall');
const timerPopover = document.getElementById('chatTimerPopover');
const avatarChooser = document.getElementById('chatAvatarChooser');
if (incomingModal && incomingModal.parentElement !== document.body) {
document.body.appendChild(incomingModal);
}
if (floatingCall && floatingCall.parentElement !== document.body) {
document.body.appendChild(floatingCall);
}
if (timerPopover && timerPopover.parentElement !== document.body) {
document.body.appendChild(timerPopover);
}
if (avatarChooser && avatarChooser.parentElement !== document.body) {
document.body.appendChild(avatarChooser);
}
chatState.portalsMounted = true;
chatState.timerPortalMounted = true;
}
function applyFloatingCallPosition() {
const overlay = document.getElementById('chatFloatingCall');
if (!overlay || chatState.callDisplayMode !== 'minimized') return;
overlay.style.left = `${Math.max(12, chatState.floatingCallPosition.x || 24)}px`;
overlay.style.top = `${Math.max(12, chatState.floatingCallPosition.y || 24)}px`;
}
function syncCallChromeState() {
const root = document.documentElement;
const hasCall = Boolean(chatState.currentCall);
const minimized = hasCall && chatState.callDisplayMode === 'minimized';
root.classList.toggle('chat-call-active', hasCall && chatState.callDisplayMode === 'fullscreen');
root.classList.toggle('chat-call-minimized', minimized);
const banner = document.getElementById('chatActiveCallBanner');
if (banner) {
const chatTabActive = appState()?.activeTab === 'chat';
banner.classList.toggle('hidden', !minimized || !chatTabActive);
}
}
function syncCallOverlayBounds() {
const overlay = document.getElementById('chatFloatingCall');
if (!overlay) return;
if (chatState.callDisplayMode === 'minimized' || isCompactChatLayout()) {
overlay.style.left = '';
overlay.style.top = '';
overlay.style.width = '';
overlay.style.height = '';
return;
}
if (window.innerWidth >= 768) {
const headerRect = document.getElementById('appHeader')?.getBoundingClientRect();
const top = Math.max(0, Math.round(headerRect?.bottom || 0));
overlay.style.left = '0px';
overlay.style.top = `${top}px`;
overlay.style.width = `${window.innerWidth}px`;
overlay.style.height = `${Math.max(0, window.innerHeight - top)}px`;
return;
}
const host = (window.innerWidth >= 768
? document.getElementById('content-chat')
: document.querySelector('#content-chat > .chat-shell'))
|| document.querySelector('.chat-shell');
if (!host) return;
const rect = host.getBoundingClientRect();
overlay.style.left = `${Math.round(rect.left)}px`;
overlay.style.top = `${Math.round(rect.top)}px`;
overlay.style.width = `${Math.round(rect.width)}px`;
overlay.style.height = `${Math.round(rect.height)}px`;
}
function setCallDisplayMode(mode = 'fullscreen') {
chatState.callDisplayMode = mode;
const overlay = document.getElementById('chatFloatingCall');
const minimizeBtn = document.getElementById('chatMinimizeCallBtn');
if (!overlay) return;
overlay.dataset.callDisplay = mode;
overlay.classList.toggle('is-minimized', mode === 'minimized');
if (mode === 'minimized') {
applyFloatingCallPosition();
minimizeBtn?.setAttribute('title', t('باز کردن دوباره تماس', 'Restore call'));
minimizeBtn?.querySelector('i')?.classList.replace('fa-arrow-right', 'fa-up-right-and-down-left-from-center');
} else {
overlay.style.left = '';
overlay.style.top = '';
minimizeBtn?.setAttribute('title', t('بازگشت به چت / حالت شناور', 'Return to chat / minimize'));
minimizeBtn?.querySelector('i')?.classList.replace('fa-up-right-and-down-left-from-center', 'fa-arrow-right');
}
syncCallChromeState();
syncCallOverlayBounds();
}
function toggleCallDisplayMode() {
if (!chatState.currentCall) return;
setCallDisplayMode(chatState.callDisplayMode === 'minimized' ? 'fullscreen' : 'minimized');
}
function beginFloatingCallDrag(event) {
if (chatState.callDisplayMode !== 'minimized') return;
const overlay = document.getElementById('chatFloatingCall');
if (!overlay) return;
const rect = overlay.getBoundingClientRect();
chatState.draggingFloatingCall = true;
chatState.floatingDragOffset = {
x: event.clientX - rect.left,
y: event.clientY - rect.top,
};
overlay.classList.add('dragging');
}
function moveFloatingCallDrag(event) {
if (!chatState.draggingFloatingCall) return;
const nextX = event.clientX - (chatState.floatingDragOffset?.x || 0);
const nextY = event.clientY - (chatState.floatingDragOffset?.y || 0);
const overlay = document.getElementById('chatFloatingCall');
if (!overlay) return;
const maxX = Math.max(12, window.innerWidth - overlay.offsetWidth - 12);
const maxY = Math.max(12, window.innerHeight - overlay.offsetHeight - 12);
chatState.floatingCallPosition = {
x: Math.min(maxX, Math.max(12, nextX)),
y: Math.min(maxY, Math.max(12, nextY)),
};
applyFloatingCallPosition();
}
function endFloatingCallDrag() {
chatState.draggingFloatingCall = false;
chatState.floatingDragOffset = null;
document.getElementById('chatFloatingCall')?.classList.remove('dragging');
}
function isCallBusy() {
return Boolean(chatState.currentCall || chatState.pendingIncomingCall || chatState.pendingIncomingInvite);
}
function clearCallTimers() {
if (chatState.outgoingCallTimer) {
clearTimeout(chatState.outgoingCallTimer);
chatState.outgoingCallTimer = null;
}
if (chatState.incomingCallTimer) {
clearTimeout(chatState.incomingCallTimer);
chatState.incomingCallTimer = null;
}
}
async function requestCallMedia(mode, includeAudio = true) {
const wantsVideo = mode === 'video';
const preferredConstraints = {
audio: includeAudio,
video: wantsVideo
? {
facingMode: { ideal: chatState.callFacingMode || 'user' },
width: { ideal: 1280 },
height: { ideal: 720 },
}
: false,
};
try {
return await navigator.mediaDevices.getUserMedia(preferredConstraints);
} catch (error) {
if (!wantsVideo) throw error;
return navigator.mediaDevices.getUserMedia({
audio: includeAudio,
video: true,
});
}
}
function attachLocalStream(stream) {
if (chatState.localStream && chatState.localStream !== stream) {
stopStream(chatState.localStream);
}
chatState.localStream = stream;
const localVideo = document.getElementById('chatLocalVideo');
const floatingLocalVideo = document.getElementById('chatFloatingLocalVideo');
if (localVideo) {
prepareVideoElement(localVideo, { muted: true });
localVideo.srcObject = stream;
localVideo.onloadedmetadata = () => {
playMediaElement(localVideo);
syncVideoElementFit(localVideo);
};
localVideo.onresize = () => syncVideoElementFit(localVideo);
playMediaElement(localVideo);
}
if (floatingLocalVideo) {
prepareVideoElement(floatingLocalVideo, { muted: true });
floatingLocalVideo.srcObject = stream;
floatingLocalVideo.onloadedmetadata = () => {
playMediaElement(floatingLocalVideo);
syncVideoElementFit(floatingLocalVideo);
};
floatingLocalVideo.onresize = () => syncVideoElementFit(floatingLocalVideo);
playMediaElement(floatingLocalVideo);
}
document.querySelector('.chat-local-stage')?.classList.toggle('has-video', streamHasLiveVideo(stream));
syncCallStageState();
}
function attachRemoteStream(stream) {
chatState.remoteStream = stream;
const remoteVideo = document.getElementById('chatRemoteVideo');
const floatingRemoteVideo = document.getElementById('chatFloatingRemoteVideo');
if (remoteVideo) {
prepareVideoElement(remoteVideo);
remoteVideo.srcObject = stream;
remoteVideo.onloadedmetadata = () => {
playMediaElement(remoteVideo);
syncVideoElementFit(remoteVideo);
};
remoteVideo.onresize = () => syncVideoElementFit(remoteVideo);
playMediaElement(remoteVideo);
}
if (floatingRemoteVideo) {
prepareVideoElement(floatingRemoteVideo);
floatingRemoteVideo.srcObject = stream;
floatingRemoteVideo.onloadedmetadata = () => {
playMediaElement(floatingRemoteVideo);
syncVideoElementFit(floatingRemoteVideo);
};
floatingRemoteVideo.onresize = () => syncVideoElementFit(floatingRemoteVideo);
playMediaElement(floatingRemoteVideo);
}
syncCallStageState();
}
function syncCallStageState() {
const windowEl = document.querySelector('#chatFloatingCall .chat-floating-call-window');
if (!windowEl) return;
const localVideoEnabled = streamHasLiveVideo(chatState.localStream);
const remoteVideoEnabled = streamHasLiveVideo(chatState.remoteStream);
windowEl.dataset.callMode = chatState.currentCallMode || 'voice';
if (chatState.currentCallMode === 'video') {
if (!['remote', 'local'].includes(chatState.callPrimaryVideo)) {
chatState.callPrimaryVideo = 'remote';
}
if (remoteVideoEnabled) {
chatState.callPrimaryVideo = chatState.callPrimaryVideo || 'remote';
}
} else {
chatState.callPrimaryVideo = 'remote';
}
windowEl.dataset.callPrimary = chatState.callPrimaryVideo || 'remote';
windowEl.dataset.localVideo = localVideoEnabled ? 'on' : 'off';
windowEl.dataset.remoteVideo = remoteVideoEnabled ? 'on' : 'off';
windowEl.dataset.remoteOrientation = document.getElementById('chatFloatingRemoteVideo')?.dataset.videoOrientation
|| document.getElementById('chatRemoteVideo')?.dataset.videoOrientation
|| 'unknown';
windowEl.dataset.localOrientation = document.getElementById('chatFloatingLocalVideo')?.dataset.videoOrientation
|| document.getElementById('chatLocalVideo')?.dataset.videoOrientation
|| 'unknown';
const avatar = document.getElementById('chatFloatingRemoteAvatar');
if (avatar) {
const showAvatar = chatState.currentCallMode === 'voice' || !remoteVideoEnabled;
avatar.classList.toggle('hidden', !showAvatar);
}
document.querySelector('.chat-local-stage')?.classList.toggle('has-video', localVideoEnabled);
document.querySelector('.chat-local-stage-placeholder')?.classList.toggle('hidden', localVideoEnabled);
}
async function toggleScreenShare() {
if (!chatState.currentCall || chatState.currentCallMode !== 'video') return;
if (chatState.screenStream) {
// Revert to camera
try {
const stream = await requestCallMedia('video');
const videoTrack = stream.getVideoTracks()[0];
const pc = chatState.currentCall.peerConnection;
const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
if (sender && videoTrack) {
await sender.replaceTrack(videoTrack);
chatState.screenStream.getTracks().forEach((t) => t.stop());
chatState.screenStream = null;
attachLocalStream(stream);
}
} catch (err) {
console.error(err);
notify(t('بازگشت به دوربین ممکن نشد', 'Could not revert to camera'), 'error');
}
} else {
// Start screen sharing
try {
const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
const videoTrack = stream.getVideoTracks()[0];
const pc = chatState.currentCall.peerConnection;
const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
if (sender && videoTrack) {
await sender.replaceTrack(videoTrack);
chatState.screenStream = stream;
videoTrack.onended = () => {
if (chatState.screenStream === stream) toggleScreenShare();
};
attachLocalStream(stream);
notify(t('اشتراک‌گذاری صفحه فعال شد', 'Screen sharing active'), 'info');
}
} catch (err) {
console.error(err);
if (err.name !== 'NotAllowedError') {
notify(t('اشتراک‌گذاری صفحه با خطا مواجه شد', 'Screen share failed'), 'error');
}
}
}
refreshCallControls();
}
function spawnReactionAnimation(emoji, messageId) {
const bubble = document.querySelector(`.chat-message-bubble[data-id="${messageId}"]`);
if (!bubble) return;
const anim = document.createElement('div');
anim.className = 'chat-reaction-animation';
anim.textContent = emoji;
// Position near the bubble center
const rect = bubble.getBoundingClientRect();
anim.style.left = (rect.left + rect.width / 2) + 'px';
anim.style.top = rect.top + 'px';
document.body.appendChild(anim);
setTimeout(() => anim.remove(), 1600);
}
function setCallControlState(id, active, disabled = false) {
const button = document.getElementById(id);
if (!button) return;
button.classList.toggle('active', Boolean(active));
button.disabled = Boolean(disabled);
}
function refreshCallControls() {
setCallControlState('chatMuteToggleBtn', chatState.callMuted, !chatState.currentCall);
setCallControlState('chatHoldToggleBtn', chatState.callHeld, !chatState.currentCall);
setCallControlState('chatSpeakerToggleBtn', chatState.callSpeakerEnabled, !chatState.currentCall);
setCallControlState('chatVideoToggleBtn', !chatState.callVideoEnabled, !chatState.currentCall || chatState.currentCallMode !== 'video');
setCallControlState('chatFlipCameraBtn', false, !chatState.currentCall || chatState.currentCallMode !== 'video');
setCallControlState('chatScreenShareBtn', Boolean(chatState.screenStream), !chatState.currentCall || chatState.currentCallMode !== 'video');
setCallControlState('chatEndCallControlBtn', false, !chatState.currentCall);
document.getElementById('chatVideoToggleBtn')?.classList.toggle('hidden', chatState.currentCallMode !== 'video');
document.getElementById('chatFlipCameraBtn')?.classList.toggle('hidden', chatState.currentCallMode !== 'video');
document.getElementById('chatScreenShareBtn')?.classList.toggle('hidden', chatState.currentCallMode !== 'video');
syncCallStageState();
}
function getRingtoneOption(id = chatState.profile.ringtoneId) {
return CHAT_RINGTONE_OPTIONS.find((option) => option.id === id) || CHAT_RINGTONE_OPTIONS[0];
}
function getMessageToneOption(id = chatState.profile.messageToneId) {
return CHAT_MESSAGE_TONE_OPTIONS.find((option) => option.id === id) || CHAT_MESSAGE_TONE_OPTIONS[0];
}
function renderRingtoneSettings() {
const ringtoneSelect = document.getElementById('chatRingtoneSelect');
if (ringtoneSelect) {
const current = getRingtoneOption(chatState.profile.ringtoneId).id;
ringtoneSelect.innerHTML = CHAT_RINGTONE_OPTIONS.map((option) => (
`<option value="${option.id}">${app().escapeHTML(t(option.labelFa, option.labelEn))}</option>`
)).join('');
ringtoneSelect.value = current;
}
const messageSelect = document.getElementById('chatMessageToneSelect');
if (messageSelect) {
const current = getMessageToneOption(chatState.profile.messageToneId).id;
messageSelect.innerHTML = CHAT_MESSAGE_TONE_OPTIONS.map((option) => (
`<option value="${option.id}">${app().escapeHTML(t(option.labelFa, option.labelEn))}</option>`
)).join('');
messageSelect.value = current;
}
}
function ensureRingtoneContext() {
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
if (!AudioContextClass) return null;
if (!chatState.ringtoneAudioContext || chatState.ringtoneAudioContext.state === 'closed') {
chatState.ringtoneAudioContext = new AudioContextClass();
}
return chatState.ringtoneAudioContext;
}
function primeRingtoneAudio() {
const ctx = ensureRingtoneContext();
if (!ctx) return;
ctx.resume?.().catch(() => {});
chatState.ringtonePrimed = true;
}
function playRingtonePattern(id = chatState.profile.ringtoneId) {
const ctx = ensureRingtoneContext();
if (!ctx) return;
ctx.resume?.().catch(() => {});
const option = getRingtoneOption(id);
const masterGain = ctx.createGain();
masterGain.gain.setValueAtTime(0.085, ctx.currentTime);
masterGain.connect(ctx.destination);
option.tones.forEach(([frequency, delayMs, durationMs]) => {
const startAt = ctx.currentTime + (delayMs / 1000);
const endAt = startAt + (durationMs / 1000);
const osc = ctx.createOscillator();
const gain = ctx.createGain();
osc.type = id === 'soft' ? 'triangle' : 'sine';
osc.frequency.setValueAtTime(frequency, startAt);
gain.gain.setValueAtTime(0, startAt);
gain.gain.linearRampToValueAtTime(1, startAt + 0.025);
gain.gain.exponentialRampToValueAtTime(0.001, Math.max(startAt + 0.03, endAt));
osc.connect(gain);
gain.connect(masterGain);
osc.start(startAt);
osc.stop(endAt + 0.02);
});
window.setTimeout(() => masterGain.disconnect(), Math.max(900, option.gap + 120));
}
function startRingtoneLoop() {
if (chatState.ringtoneInterval) return Promise.resolve();
primeRingtoneAudio();
playRingtonePattern();
const option = getRingtoneOption();
chatState.ringtoneInterval = window.setInterval(() => playRingtonePattern(), Math.max(900, option.gap));
return Promise.resolve();
}
function stopRingtoneLoop() {
if (chatState.ringtoneInterval) {
window.clearInterval(chatState.ringtoneInterval);
chatState.ringtoneInterval = null;
}
if (chatState.ringtoneStopTimer) {
window.clearTimeout(chatState.ringtoneStopTimer);
chatState.ringtoneStopTimer = null;
}
}
function testRingtone() {
stopRingtoneLoop();
primeRingtoneAudio();
playRingtonePattern();
chatState.ringtoneStopTimer = window.setTimeout(stopRingtoneLoop, 2300);
}
const sounds = {
// Standard ringing sound (synthesized)
ringing: {
play: function() {
return startRingtoneLoop();
},
pause: function() {
stopRingtoneLoop();
},
stop: function() { this.pause(); },
currentTime: 0
},
message: {
currentTime: 0,
play: () => playMessageChime(),
pause: () => {},
}
};
// Modern Audio Player state and helpers
const audioPlayers = new Map();
function createModernAudioPlayer(url, containerId) {
const player = {
url,
playbackRate: 1.0,
audio: new Audio(url),
};
// Implementation will be handled in renderMessages
return player;
}
function playSound(name) {
try {
const sound = sounds[name];
if (sound) {
sound.currentTime = 0;
const result = sound.play?.();
if (!result?.catch) return;
result.catch(() => {
// Fallback: try playing on next click if blocked by browser
const once = () => {
const retry = sound.play?.();
retry?.catch?.(() => {});
document.removeEventListener('click', once);
};
document.addEventListener('click', once);
});
}
} catch (e) { /* noop */ }
}
function playMessageChime(id = chatState.profile.messageToneId) {
const context = ensureRingtoneContext();
if (!context) return Promise.resolve();
const option = getMessageToneOption(id);
if (!option.tones.length) return Promise.resolve();
context.resume?.().catch(() => {});
const now = context.currentTime;
const masterGain = context.createGain();
masterGain.gain.setValueAtTime(0.085, now);
masterGain.connect(context.destination);
option.tones.forEach(([frequency, delayMs, durationMs]) => {
const startAt = now + (delayMs / 1000);
const endAt = startAt + (durationMs / 1000);
const oscillator = context.createOscillator();
const gain = context.createGain();
oscillator.type = option.type || 'sine';
oscillator.frequency.setValueAtTime(frequency, startAt);
gain.gain.setValueAtTime(0.0001, startAt);
gain.gain.exponentialRampToValueAtTime(1, startAt + 0.018);
gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(startAt + 0.03, endAt));
oscillator.connect(gain);
gain.connect(masterGain);
oscillator.start(startAt);
oscillator.stop(endAt + 0.02);
});
window.setTimeout(() => masterGain.disconnect(), 650);
return Promise.resolve();
}
function testMessageTone() {
primeRingtoneAudio();
return playMessageChime();
}
function stopSound(name) {
try {
const sound = sounds[name];
if (sound) {
sound.pause();
sound.currentTime = 0;
}
} catch (e) { /* noop */ }
}
function showIncomingCall(call, invite = null) {
const incomingPeerId = call?.peer || invite?.peerId || '';
if (chatState.currentCall && incomingPeerId !== chatState.currentCall?.peer) {
const busyPeer = findPeerRecordByPeerId(incomingPeerId);
if (busyPeer) {
sendRelayEnvelope(busyPeer, {
type: 'call-busy',
mode: call?.metadata?.mode || invite?.mode || 'voice',
name: chatState.profile.name,
peerId: chatState.peerId,
});
}
call?.close?.();
return;
}
const mode = call?.metadata?.mode || invite?.mode || 'voice';
const peer = findPeerRecordByPeerId(incomingPeerId);
const name = call?.metadata?.username || invite?.name || peer?.username || incomingPeerId || t('کاربر P00RIJA', 'P00RIJA User');
const avatarData = peer?.avatarData || '';
// Remove existing if any
document.getElementById('chatIncomingCallModal')?.remove();
const modal = document.createElement('div');
modal.id = 'chatIncomingCallModal';
modal.className = 'chat-incoming-call-modal animate-fade-in';
modal.innerHTML = `
<div class="chat-incoming-call-content">
<div class="chat-incoming-call-avatar-hero">
${avatarData ? `<img src="${avatarData}" alt="">` : `<span>${initials(name)}</span>`}
</div>
<div class="text-center mb-8">
<h2 class="text-3xl font-black text-white mb-3">${app().escapeHTML(name)}</h2>
<div class="flex items-center justify-center gap-2 text-brand-400 font-bold tracking-wide">
<i class="fas ${mode === 'video' ? 'fa-video' : 'fa-phone-volume'} animate-pulse"></i>
<span class="uppercase">${mode === 'video' ? t('تماس تصویری ورودی', 'Incoming video call') : t('تماس صوتی ورودی', 'Incoming voice call')}</span>
</div>
</div>
<div class="chat-incoming-call-actions flex items-center justify-center gap-12">
<div class="flex flex-col items-center gap-3">
<button id="chatModalRejectBtn" class="w-20 h-20 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center text-3xl shadow-[0_0_30px_rgba(244,63,94,0.4)] hover:scale-110 active:scale-95 transition-all duration-300">
<i class="fas fa-phone-slash"></i>
</button>
<span class="text-rose-400 text-sm font-bold">${t('رد کردن', 'Reject')}</span>
</div>
<div class="flex flex-col items-center gap-3">
<button id="chatModalAcceptBtn" class="w-20 h-20 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center text-3xl shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:scale-110 active:scale-95 transition-all duration-300">
<i class="fas fa-phone"></i>
</button>
<span class="text-emerald-400 text-sm font-bold">${t('پاسخ دادن', 'Answer')}</span>
</div>
</div>
</div>
`;
document.body.appendChild(modal);
document.getElementById('chatModalRejectBtn')?.addEventListener('click', rejectIncomingCall);
document.getElementById('chatModalAcceptBtn')?.addEventListener('click', acceptIncomingCall);
playSound('ringing');
if (call) chatState.pendingIncomingCall = call;
if (invite) chatState.pendingIncomingInvite = invite;
if (chatState.incomingCallTimer) clearTimeout(chatState.incomingCallTimer);
chatState.incomingCallTimer = setTimeout(() => {
const pendingCall = chatState.pendingIncomingCall;
const pendingInvite = chatState.pendingIncomingInvite;
const missedPeerId = pendingCall?.peer || pendingInvite?.peerId || incomingPeerId;
appendCall({
name,
peerId: missedPeerId,
mode,
status: 'missed',
direction: 'in',
});
pendingCall?.close?.();
chatState.pendingIncomingCall = null;
chatState.pendingIncomingInvite = null;
chatState.pendingIncomingAccept = false;
hideIncomingCall();
}, CALL_RING_TIMEOUT_MS);
syncCallChromeState();
renderActivePeer();
}
function hideIncomingCall() {
stopSound('ringing');
document.getElementById('chatIncomingCallModal')?.remove();
renderActivePeer();
}
async function acceptIncomingCall() {
const call = chatState.pendingIncomingCall;
const invite = chatState.pendingIncomingInvite;
hideIncomingCall();
if (chatState.incomingCallTimer) {
clearTimeout(chatState.incomingCallTimer);
chatState.incomingCallTimer = null;
}
if (!call && invite) {
chatState.pendingIncomingAccept = true;
notify(t('در حال برقراری اتصال امن...', 'Establishing secure connection...'), 'info');
return;
}
if (!call) return;
chatState.pendingIncomingAccept = false;
try {
const wantsVideo = call.metadata?.mode === 'video';
const stream = await requestCallMedia(wantsVideo ? 'video' : 'voice');
attachLocalStream(stream);
call.answer(stream);
appendCall({
name: call.metadata?.username || call.peer,
peerId: call.peer,
mode: wantsVideo ? 'video' : 'voice',
status: 'answered',
logToChat: false,
});
bindMediaCall(call, wantsVideo ? 'video' : 'voice', { answered: true, direction: 'in' });
} catch (error) {
console.error(error);
notify(t('دسترسی به میکروفون/دوربین ممکن نشد', 'Could not access microphone/camera'), 'error');
call.close();
}
}
function rejectIncomingCall() {
const call = chatState.pendingIncomingCall;
const invite = chatState.pendingIncomingInvite;
const peerId = call?.peer || invite?.peerId;
if (peerId) {
const peer = findPeerRecordByPeerId(peerId);
if (peer) {
sendRelayEnvelope(peer, {
type: 'call-reject',
mode: call?.metadata?.mode || invite?.mode || 'voice',
name: chatState.profile.name,
peerId: chatState.peerId,
});
}
}
if (call) {
appendCall({
name: call.metadata?.username || call.peer,
peerId: call.peer,
mode: call.metadata?.mode || 'voice',
status: 'rejected',
direction: 'in',
});
call.close();
} else if (invite) {
appendCall({
name: invite.name || peerId,
peerId,
mode: invite.mode || 'voice',
status: 'rejected',
direction: 'in',
});
}
chatState.pendingIncomingCall = null;
chatState.pendingIncomingInvite = null;
chatState.pendingIncomingAccept = false;
if (chatState.incomingCallTimer) {
clearTimeout(chatState.incomingCallTimer);
chatState.incomingCallTimer = null;
}
hideIncomingCall();
}
function bindMediaCall(call, mode, { answered = false, direction = 'out' } = {}) {
chatState.currentCall = call;
chatState.currentCallMode = mode;
chatState.currentCallStartedAt = Date.now();
chatState.currentCallAnsweredAt = answered ? Date.now() : 0;
chatState.currentCallLogged = false;
chatState.currentCallDirection = direction;
chatState.callDisplayMode = 'fullscreen';
chatState.callPrimaryVideo = 'remote';
chatState.callMuted = false;
chatState.callHeld = false;
chatState.callSpeakerEnabled = false;
chatState.callVideoEnabled = mode === 'video';
syncFloatingCallPeerIdentity();
const callLabel = mode === 'video'
? t('تماس تصویری فعال', 'Video call active')
: t('تماس صوتی فعال', 'Voice call active');
document.getElementById('chatCallStatus').textContent = callLabel;
document.getElementById('chatFloatingCallTitle').textContent = callLabel;
document.getElementById('chatFloatingCallStatus').textContent = answered
? t('اتصال امن برقرار است', 'Secure call is active')
: t('در حال زنگ خوردن...', 'Ringing...');
document.getElementById('chatFloatingCall').classList.remove('hidden');
setCallDisplayMode('fullscreen');
syncCallChromeState();
syncCallOverlayBounds();
document.getElementById('chatEndCallBtn').classList.remove('hidden');
refreshCallControls();
syncCallStageState();
call.on('stream', (stream) => {
chatState.currentCallAnsweredAt = chatState.currentCallAnsweredAt || Date.now();
if (chatState.outgoingCallTimer) {
clearTimeout(chatState.outgoingCallTimer);
chatState.outgoingCallTimer = null;
}
document.getElementById('chatFloatingCallStatus').textContent = t('اتصال امن برقرار است', 'Secure call is active');
attachRemoteStream(stream);
});
call.on('close', () => {
endCurrentCall({ closePeer: false });
});
call.on('error', (error) => {
console.error(error);
endCurrentCall({ closePeer: false });
});
const pc = call.peerConnection;
if (pc) {
pc.addEventListener('iceconnectionstatechange', () => {
const state = pc.iceConnectionState;
document.getElementById('chatFloatingCallStatus').textContent = t(`وضعیت تماس: ${state}`, `Call state: ${state}`);
if (state === 'disconnected') {
notify(t('شبکه لحظه‌ای ناپایدار شد؛ تماس را فوراً قطع نمی‌کنیم.', 'Network is temporarily unstable; keeping the call alive.'), 'info');
}
if (state === 'failed' || state === 'closed') {
endCurrentCall({ closePeer: false });
}
});
}
}
async function startCall(mode) {
if (hasActiveServerRestriction()) {
notifyRestrictionOnce();
return;
}
if (isCallBusy()) {
notify(t('ابتدا تماس فعلی را تمام کنید.', 'Finish the current call first.'), 'warning');
return;
}
const active = getActiveConversation();
if (active?.type === 'group') {
const members = (active.members || []).map(findPeerByAnyKey).filter(Boolean);
const onlineMembers = members.filter((member) => member.status === 'online' && !isSelfPeerRecord(member));
appendCall({
name: active.name,
peerId: active.conversationId,
conversationId: active.conversationId,
mode,
status: onlineMembers.length ? 'outgoing' : 'missed',
direction: 'out',
});
onlineMembers.forEach((member) => {
sendRelayEnvelope(member, {
type: 'call-invite',
mode,
name: `${active.name} • ${chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User')}`,
peerId: chatState.peerId,
groupId: active.conversationId,
});
});
notify(
onlineMembers.length
? t('دعوت تماس گروهی برای اعضای آنلاین ارسال شد. هر عضو با تماس مستقیم امن پاسخ می‌دهد.', 'Group call invites were sent to online members. Each member answers with a secure direct call.')
: t('عضو آنلاینی برای تماس گروهی پیدا نشد.', 'No online group member was found for the call.'),
onlineMembers.length ? 'success' : 'warning'
);
return;
}
const peerRecord = activePeer();
if (!peerRecord || !chatState.peer) {
notify(t('برای تماس ابتدا به سرور چت وصل شوید و یک کاربر را انتخاب کنید.', 'Connect to chat and select a peer before calling.'), 'warning');
return;
}
if (isSelfPeerRecord(peerRecord)) {
notify(t('تماس با همین سشن محلی مجاز نیست.', 'Calling the current session itself is not allowed.'), 'warning');
return;
}
let callInviteSent = false;
try {
if (peerRecord.status !== 'online') {
const queued = sendRelayEnvelope(peerRecord, {
type: 'call-missed',
mode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
createdAt: new Date().toISOString(),
});
appendCall({
name: peerRecord.username || peerRecord.peerId,
peerId: peerRecord.peerId,
mode,
status: 'missed',
direction: chatState.currentCallDirection || 'out',
});
notify(
queued
? t('کاربر آفلاین است؛ تماس به صورت بی‌پاسخ برای او ثبت می‌شود.', 'The user is offline; a missed call will be delivered.')
: t('کاربر آفلاین است و رله در دسترس نیست.', 'The user is offline and the relay is unavailable.'),
queued ? 'info' : 'warning'
);
return;
}
callInviteSent = sendRelayEnvelope(peerRecord, {
type: 'call-invite',
mode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
});
const stream = await requestCallMedia(mode);
attachLocalStream(stream);
syncFloatingCallPeerIdentity();
const call = chatState.peer.call(peerRecord.peerId, stream, {
metadata: {
mode,
username: chatState.profile.name,
peerId: chatState.peerId,
},
});
appendCall({
name: peerRecord.username || peerRecord.peerId,
peerId: peerRecord.peerId,
mode,
status: 'outgoing',
direction: 'out',
logToChat: false,
});
bindMediaCall(call, mode);
if (chatState.outgoingCallTimer) clearTimeout(chatState.outgoingCallTimer);
chatState.outgoingCallTimer = setTimeout(() => {
if (!chatState.currentCall || chatState.currentCallAnsweredAt) return;
sendRelayEnvelope(peerRecord, {
type: 'call-missed',
mode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
createdAt: new Date().toISOString(),
});
appendCall({
name: peerRecord.username || peerRecord.peerId,
peerId: peerRecord.peerId,
mode,
status: 'missed',
direction: 'out',
});
notify(t('تماس پاسخ داده نشد.', 'The call was not answered.'), 'info');
endCurrentCall({ closePeer: true, logCall: false });
}, CALL_RING_TIMEOUT_MS);
} catch (error) {
console.error(error);
if (typeof callInviteSent !== 'undefined' && callInviteSent && peerRecord) {
sendRelayEnvelope(peerRecord, {
type: 'call-cancel',
mode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
createdAt: new Date().toISOString(),
});
}
notify(t('دسترسی به میکروفون/دوربین ناموفق بود', 'Failed to access microphone/camera'), 'error');
}
}
function toggleMuteCall() {
if (!chatState.localStream) return;
chatState.callMuted = !chatState.callMuted;
chatState.localStream.getAudioTracks().forEach((track) => {
track.enabled = !chatState.callMuted;
});
refreshCallControls();
}
function toggleHoldCall() {
if (!chatState.localStream) return;
chatState.callHeld = !chatState.callHeld;
chatState.localStream.getTracks().forEach((track) => {
track.enabled = !chatState.callHeld && (track.kind !== 'audio' || !chatState.callMuted) && (track.kind !== 'video' || chatState.callVideoEnabled);
});
document.getElementById('chatFloatingCallStatus').textContent = chatState.callHeld
? t('تماس روی Hold قرار گرفت', 'Call is on hold')
: t('اتصال امن برقرار است', 'Secure call is active');
refreshCallControls();
}
function toggleSpeakerCall() {
chatState.callSpeakerEnabled = !chatState.callSpeakerEnabled;
const remoteVideo = document.getElementById('chatFloatingRemoteVideo');
if (remoteVideo && typeof remoteVideo.setSinkId === 'function') {
remoteVideo.setSinkId('default').catch(() => {
notify(t('مرورگر اجازه کنترل خروجی صدا را نمی‌دهد.', 'This browser does not allow changing the audio output.'), 'info');
});
}
refreshCallControls();
}
function toggleVideoCall() {
if (!chatState.localStream || chatState.currentCallMode !== 'video') return;
chatState.callVideoEnabled = !chatState.callVideoEnabled;
chatState.localStream.getVideoTracks().forEach((track) => {
track.enabled = chatState.callVideoEnabled && !chatState.callHeld;
});
refreshCallControls();
}
async function flipCameraCall() {
if (!chatState.currentCall || chatState.currentCallMode !== 'video' || !navigator.mediaDevices?.getUserMedia) return;
const nextFacingMode = chatState.callFacingMode === 'user' ? 'environment' : 'user';
try {
const replacement = await navigator.mediaDevices.getUserMedia({
video: { facingMode: { ideal: nextFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
audio: false,
});
const nextTrack = replacement.getVideoTracks()[0];
if (!nextTrack) return;
const sender = chatState.currentCall.peerConnection?.getSenders?.().find((item) => item.track?.kind === 'video');
await sender?.replaceTrack(nextTrack);
const currentVideoTracks = chatState.localStream?.getVideoTracks?.() || [];
currentVideoTracks.forEach((track) => {
chatState.localStream?.removeTrack?.(track);
track.stop();
});
chatState.localStream?.addTrack(nextTrack);
attachLocalStream(chatState.localStream);
chatState.callFacingMode = nextFacingMode;
chatState.callVideoEnabled = true;
refreshCallControls();
syncCallStageState();
} catch (error) {
console.error(error);
notify(t('تعویض دوربین در این دستگاه/مرورگر ممکن نشد.', 'Could not switch cameras on this device/browser.'), 'warning');
}
}
function endCurrentCall({ closePeer = true, logCall = true } = {}) {
stopSound('ringing');
if (chatState.endingCurrentCall) return;
chatState.endingCurrentCall = true;
try {
if (chatState.screenStream) {
chatState.screenStream.getTracks().forEach((t) => t.stop());
chatState.screenStream = null;
}
const activeCall = chatState.currentCall;
const callPeer = activeCall?.peer || '';
const callMode = chatState.currentCallMode || activeCall?.metadata?.mode || 'voice';
const answeredAt = Number(chatState.currentCallAnsweredAt || 0);
const startedAt = Number(chatState.currentCallStartedAt || Date.now());
const durationMs = answeredAt ? Math.max(0, Date.now() - answeredAt) : 0;
chatState.currentCall = null;
clearCallTimers();
if (activeCall) {
activeCall.peerConnection?.getSenders?.().forEach((sender) => {
try {
sender.track?.stop?.();
} catch (_error) {
/* noop */
}
});
if (closePeer) {
try {
activeCall.close();
} catch (_error) {
/* noop */
}
}
}
if (activeCall && logCall && !chatState.currentCallLogged) {
const peer = findPeerRecordByPeerId(callPeer) || activePeer();
const status = answeredAt ? 'ended' : 'missed';
const callDirection = chatState.currentCallDirection || 'out';
// If outgoing call was never answered, send a cancel signal
if (!answeredAt && callDirection === 'out' && peer) {
sendRelayEnvelope(peer, {
type: 'call-cancel',
mode: callMode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
createdAt: new Date().toISOString(),
});
}
appendCall({
name: peer?.username || activeCall.metadata?.username || callPeer,
peerId: peer?.peerId || callPeer,
mode: callMode,
status,
direction: callDirection,
durationMs,
});
if (answeredAt && peer) {
sendRelayEnvelope(peer, {
type: 'call-ended',
mode: callMode,
name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
peerId: chatState.peerId,
durationMs,
createdAt: new Date().toISOString(),
});
}
chatState.currentCallLogged = true;
}
stopStream(chatState.localStream);
stopStream(chatState.remoteStream);
chatState.localStream = null;
chatState.remoteStream = null;
clearMediaElement('chatLocalVideo');
clearMediaElement('chatRemoteVideo');
clearMediaElement('chatFloatingLocalVideo');
clearMediaElement('chatFloatingRemoteVideo');
clearMediaElement('chatIncomingPreviewVideo');
chatState.pendingIncomingCall = null;
chatState.pendingIncomingInvite = null;
chatState.pendingIncomingAccept = false;
chatState.currentCallStartedAt = 0;
chatState.currentCallAnsweredAt = 0;
chatState.currentCallDirection = 'out';
chatState.currentCallMode = 'voice';
chatState.callMuted = false;
chatState.callHeld = false;
chatState.callSpeakerEnabled = false;
chatState.callVideoEnabled = true;
chatState.callFacingMode = 'user';
chatState.callDisplayMode = 'fullscreen';
chatState.callPrimaryVideo = 'remote';
document.getElementById('chatCallStatus').textContent = t('آماده', 'Idle');
document.getElementById('chatEndCallBtn')?.classList.add('hidden');
document.getElementById('chatFloatingCall')?.classList.add('hidden');
document.getElementById('chatFloatingCall')?.style.removeProperty('width');
document.getElementById('chatFloatingCall')?.style.removeProperty('height');
document.getElementById('chatFloatingCall')?.style.removeProperty('left');
document.getElementById('chatFloatingCall')?.style.removeProperty('top');
document.getElementById('chatFloatingRemoteAvatar')?.classList.remove('hidden');
document.querySelector('.chat-local-stage')?.classList.remove('has-video');
hideIncomingCall();
syncCallChromeState();
refreshCallControls();
syncCallStageState();
renderActivePeer();
// Auto-switch back to calls view after ending a call
if (chatState.activeView !== 'calls') {
setChatView('calls');
}
} finally {
chatState.endingCurrentCall = false;
}
}
function disconnectChat() {
chatState.shouldReconnect = false;
clearReconnectTimer();
if (chatState.heartbeatTimer) {
clearInterval(chatState.heartbeatTimer);
chatState.heartbeatTimer = null;
}
chatState.ws?.close();
chatState.ws = null;
chatState.sessions.forEach((session) => session.connection?.close());
chatState.sessions.clear();
if (chatState.peer && !chatState.peer.destroyed) {
chatState.peer.destroy();
}
chatState.peer = null;
chatState.peerTransportOrigin = '';
chatState.peerId = '';
chatState.clientId = '';
chatState.peers.forEach((peer) => {
if (!peer.type) peer.status = 'offline';
});
saveContacts();
endCurrentCall();
setConnectionState(false, t('آفلاین', 'Offline'));
renderStaticUi();
renderPeers();
renderActivePeer();
}
async function rotateIdentity() {
if (!isUnlocked()) return;
if (!window.confirm(t('بازنشانی کلید چت، سشن‌ها و پیام‌های آفلاین قبلی را غیرقابل بازکردن می‌کند. ادامه می‌دهید؟', 'Resetting the chat key can make previous sessions and offline messages unreadable. Continue?'))) {
return;
}
localStorage.removeItem(CHAT_IDENTITY_STORAGE_KEY);
localStorage.removeItem(CHAT_SESSION_KEYS_STORAGE_KEY);
chatState.identity = null;
chatState.sessionKeys = {};
chatState.sessions.clear();
await ensureIdentity();
renderStaticUi();
broadcastHello();
notify(t('کلید هویتی چت بازسازی شد', 'Chat identity key rotated'), 'success');
}
async function retryQueuedMessages() {
if (!chatState.connected || !chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return;
for (const conversationKey in chatState.history) {
const history = chatState.history[conversationKey];
const queuedMessages = history.filter(m => m.direction === 'out' && (m.status === 'queued' || m.status === 'relayed'));
if (!queuedMessages.length) continue;
const peer = findPeerByConversationKey(conversationKey);
if (peer) {
let session = chatState.sessions.get(peer.peerId) || await ensureStoredSession(peer);
for (const msg of queuedMessages) {
// If message is older than 24h, mark as failed instead of retrying forever
if (msg.createdAt && (Date.now() - Date.parse(msg.createdAt) > 86400000)) {
markMessageStatus(conversationKey, msg.id, 'failed');
continue;
}
if (!session?.cryptoKey) {
session = await ensureStoredSession(peer);
}
if (!session?.cryptoKey || msg.type !== 'text') continue;
const payload = await encryptForSession(session, new TextEncoder().encode(msg.text || ''));
const outbound = {
type: 'text',
id: msg.id,
createdAt: msg.createdAt || new Date().toISOString(),
expiresAt: '',
timerSeconds: Number(msg.timerSeconds || 0),
replyToId: msg.replyToId || '',
payload,
};
if (session.connection?.open) {
safeConnectionSend(session.connection, outbound, 'retry-message');
markMessageStatus(conversationKey, msg.id, 'sent');
} else if (sendRelayEnvelope(peer, {
type: 'offline-chat',
fromPeerId: chatState.peerId,
message: outbound,
createdAt: outbound.createdAt,
})) {
markMessageStatus(conversationKey, msg.id, 'relayed');
}
}
}
}
}
function setChatView(view) {
if (view === 'channels') view = 'groups';
chatState.activeView = view;
if (view === 'calls' || view === 'connection') {
chatState.activePeerClientId = '';
chatState.activeConversationId = '';
}
updateChatShellMode();
document.querySelectorAll('[data-chat-view]').forEach((button) => {
button.classList.toggle('active', button.getAttribute('data-chat-view') === view);
});
document.getElementById('chatGroupComposer')?.classList.toggle('hidden', view !== 'groups');
document.getElementById('chatSpaceMembersPanel')?.classList.toggle('hidden', view !== 'groups');
document.getElementById('chatConnectionPanel')?.classList.toggle('hidden', view !== 'connection');
document.getElementById('chatIdentityStrip')?.classList.toggle('hidden', view !== 'connection');
document.getElementById('chatMessages')?.classList.toggle('hidden', view === 'calls' || view === 'connection');
document.getElementById('chatCallsPanel')?.classList.toggle('hidden', view !== 'calls');
document.querySelector('.chat-composer-bar')?.classList.toggle('hidden', view === 'calls' || view === 'connection');
renderPeers();
renderActivePeer();
}
function createSpace(type) {
if (type !== 'group') return;
const input = document.getElementById('chatGroupNameInput');
const name = input?.value.trim();
if (!name) return;
const members = normalizeSpaceMembers(selectedSpaceMembers('group'));
if (!members.length) {
notify(t('برای ساخت گروه حداقل یک عضو انتخاب کنید.', 'Select at least one group member.'), 'warning');
return;
}
const space = {
type: 'group',
name,
conversationId: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
members,
createdAt: new Date().toISOString(),
ownerPeerId: chatState.peerId || '',
ownerClientId: chatState.clientId || '',
ownerFingerprint: chatState.identity?.fingerprint || '',
};
upsertSharedSpace(space);
broadcastSpaceRecord(space);
input.value = '';
chatState.activeConversationId = space.conversationId;
chatState.activePeerClientId = '';
updateChatShellMode();
setChatView('groups');
}
function updateProfileAvatar(file) {
if (!file || !file.type.startsWith('image/')) return;
if (file.size > MAX_PROFILE_AVATAR_BYTES) {
notify(t('تصویر پروفایل باید کمتر از 5 مگابایت باشد', 'Profile image must be under 5 MB'), 'warning');
return;
}
const reader = new FileReader();
reader.onload = () => {
openAvatarEditor(String(reader.result || ''), { prepareOriginalForSave: true });
};
reader.readAsDataURL(file);
}
function setAvatarEditorVisible(visible) {
const chooser = document.getElementById('chatAvatarChooser');
chooser?.classList.toggle('chat-avatar-editing', Boolean(visible));
document.getElementById('chatAvatarEditor')?.classList.toggle('hidden', !visible);
}
function openAvatarEditor(dataUrl, options = {}) {
const image = new Image();
image.onload = () => {
if (options.prepareOriginalForSave) {
setPendingAvatarData(dataUrl);
}
chatState.avatarEditor = {
image,
rotation: 0,
zoom: 1,
offsetX: 0,
offsetY: 0,
scaleX: 1,
scaleY: 1,
filter: 'none',
};
[
['chatAvatarZoomInput', '1'],
['chatAvatarOffsetXInput', '0'],
['chatAvatarOffsetYInput', '0'],
['chatAvatarScaleXInput', '1'],
['chatAvatarScaleYInput', '1'],
['chatAvatarFilterSelect', 'none'],
].forEach(([id, value]) => {
const input = document.getElementById(id);
if (input) input.value = value;
});
setAvatarEditorVisible(true);
drawAvatarEditor();
};
image.onerror = () => notify(t('تصویر انتخابی قابل خواندن نیست.', 'Selected image could not be read.'), 'error');
image.src = dataUrl;
}
function drawAvatarEditor() {
const editor = chatState.avatarEditor;
const canvas = document.getElementById('chatAvatarEditorCanvas');
const ctx = canvas?.getContext('2d');
if (!editor || !canvas || !ctx) return;
const size = canvas.width;
ctx.clearRect(0, 0, size, size);
ctx.save();
ctx.fillStyle = '#020617';
ctx.fillRect(0, 0, size, size);
ctx.translate(size / 2, size / 2);
ctx.rotate((editor.rotation * Math.PI) / 180);
ctx.filter = editor.filter || 'none';
const rotated = Math.abs(editor.rotation % 180) === 90;
const imageWidth = rotated ? editor.image.height : editor.image.width;
const imageHeight = rotated ? editor.image.width : editor.image.height;
const baseScale = size / Math.min(imageWidth, imageHeight);
const scale = baseScale * editor.zoom;
ctx.drawImage(
editor.image,
(-editor.image.width * scale * editor.scaleX / 2) + editor.offsetX,
(-editor.image.height * scale * editor.scaleY / 2) + editor.offsetY,
editor.image.width * scale * editor.scaleX,
editor.image.height * scale * editor.scaleY
);
ctx.restore();
}
function canvasToAvatarDataUrl(canvas) {
try {
return canvas.toDataURL('image/png');
} catch (error) {
console.warn('Avatar canvas export failed:', error);
return '';
}
}
function setPendingAvatarData(avatarData = '') {
chatState.pendingAvatarData = String(avatarData || '');
renderStaticUi();
const saveBtn = document.getElementById('chatAvatarSaveBtn');
if (saveBtn) saveBtn.disabled = !chatState.pendingAvatarData;
if (chatState.pendingAvatarData) {
notify(t('تغییرات آواتار آماده است؛ برای اعمال نهایی ذخیره را بزنید.', 'Avatar changes are ready; press Save to apply them.'), 'info');
}
}
function savePendingAvatar() {
if (!chatState.pendingAvatarData) return;
setProfileAvatarData(chatState.pendingAvatarData);
chatState.pendingAvatarData = '';
renderStaticUi();
toggleAvatarChooser(false);
notify(t('آواتار پروفایل ذخیره شد.', 'Profile avatar saved.'), 'success');
}
function rotateAvatarEditor(delta) {
if (!chatState.avatarEditor) return;
chatState.avatarEditor.rotation = (chatState.avatarEditor.rotation + delta + 360) % 360;
drawAvatarEditor();
}
function setAvatarEditorZoom(value) {
if (!chatState.avatarEditor) return;
chatState.avatarEditor.zoom = Math.max(1, Math.min(2.6, Number(value) || 1));
drawAvatarEditor();
}
function setAvatarEditorAxis(axis, value) {
if (!chatState.avatarEditor) return;
const numeric = Number(value);
if (axis === 'offsetX') chatState.avatarEditor.offsetX = Math.max(-120, Math.min(120, Number.isFinite(numeric) ? numeric : 0));
if (axis === 'offsetY') chatState.avatarEditor.offsetY = Math.max(-120, Math.min(120, Number.isFinite(numeric) ? numeric : 0));
if (axis === 'scaleX') chatState.avatarEditor.scaleX = Math.max(0.65, Math.min(1.8, Number.isFinite(numeric) ? numeric : 1));
if (axis === 'scaleY') chatState.avatarEditor.scaleY = Math.max(0.65, Math.min(1.8, Number.isFinite(numeric) ? numeric : 1));
drawAvatarEditor();
}
function setAvatarEditorFilter(value) {
if (!chatState.avatarEditor) return;
chatState.avatarEditor.filter = String(value || 'none');
drawAvatarEditor();
}
function applyAvatarEditor() {
const canvas = document.getElementById('chatAvatarEditorCanvas');
if (!chatState.avatarEditor || !canvas) return;
drawAvatarEditor();
const dataUrl = canvasToAvatarDataUrl(canvas);
if (!dataUrl) {
notify(t('اعمال کراپ تصویر ناموفق بود.', 'Could not apply the profile image crop.'), 'error');
return;
}
setPendingAvatarData(dataUrl);
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
notify(t('کراپ اعمال شد؛ برای ست شدن روی پروفایل ذخیره را بزنید.', 'Crop applied; press Save to set it on your profile.'), 'success');
}
function cancelAvatarEditor() {
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
}
function setProfileAvatarData(avatarData = '') {
chatState.profile = {
...chatState.profile,
...buildProfileDraft(),
avatarData,
};
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
renderStaticUi();
broadcastHello();
}
function updateGroupAvatar(file) {
const space = getActiveConversation();
if (!space || space.type !== 'group' || !file || !file.type.startsWith('image/')) return;
if (file.size > 2 * 1024 * 1024) {
notify(t('تصویر گروه باید کمتر از 2 مگابایت باشد', 'Group image must be under 2 MB'), 'warning');
return;
}
const reader = new FileReader();
reader.onload = () => {
space.avatarData = String(reader.result || '');
space.members = normalizeSpaceMembers(space.members);
saveSpaces();
broadcastSpaceRecord(space);
renderPeers();
renderActivePeer();
renderSpaceMemberManager();
notify(t('عکس گروه ذخیره شد.', 'Group picture saved.'), 'success');
};
reader.readAsDataURL(file);
}
function toggleAvatarChooser(force) {
mountChatPortals();
const chooser = document.getElementById('chatAvatarChooser');
if (!chooser) return;
const open = typeof force === 'boolean' ? force : chooser.classList.contains('hidden');
chooser.classList.toggle('hidden', !open);
document.documentElement.classList.toggle('chat-avatar-chooser-open', open);
if (!open) {
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
if (chatState.pendingAvatarData) {
chatState.pendingAvatarData = '';
renderStaticUi();
}
}
}
async function selectPresetAvatar(url) {
if (!url) return;
try {
const response = await fetch(url, { cache: 'force-cache' });
if (!response.ok) throw new Error('Avatar preset not found');
const blob = await response.blob();
const reader = new FileReader();
reader.onloadend = () => {
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
setPendingAvatarData(String(reader.result || ''));
};
reader.readAsDataURL(blob);
} catch (error) {
console.warn('Failed to load avatar preset:', error);
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
setPendingAvatarData(url);
}
}
function generatedAvatarData(seed = 'cyan', label = '') {
const palettes = {
cyan: ['#0ea5e9', '#14b8a6'],
violet: ['#7c3aed', '#0ea5e9'],
emerald: ['#059669', '#22c55e'],
amber: ['#f59e0b', '#ef4444'],
rose: ['#e11d48', '#fb7185'],
indigo: ['#4f46e5', '#06b6d4'],
slate: ['#334155', '#64748b'],
teal: ['#0f766e', '#2dd4bf'],
};
const [a, b] = palettes[seed] || palettes.cyan;
const initial = String(label || seed || 'P').trim().slice(0, 1).toUpperCase() || 'P';
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="128" height="128" rx="38" fill="url(#g)"/>
<circle cx="92" cy="34" r="26" fill="rgba(255,255,255,.16)"/>
<circle cx="36" cy="96" r="34" fill="rgba(2,6,23,.18)"/>
<text x="64" y="78" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="48" font-weight="900" fill="white">${app().escapeHTML(initial)}</text>
</svg>
`;
return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}
function supportedAudioMimeType() {
if (!window.MediaRecorder) return '';
const candidates = [
'audio/webm;codecs=opus',
'audio/webm',
'audio/mp4',
'audio/ogg;codecs=opus',
];
return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}
function setRecordingOverlayVisible(visible) {
const overlay = document.getElementById('chatRecordingOverlay');
const surface = document.querySelector('.chat-composer-surface');
const sendBtn = document.getElementById('chatSendMessageBtn');
if (!overlay) return;
overlay.classList.toggle('hidden', !visible);
// Toggle main surface to prevent sholooghi (clutter)
const liveUI = document.getElementById('chatRecordingLive');
if (surface) surface.classList.toggle('hidden', visible);
if (sendBtn) {
// Send button should be visible in preview mode
const isLive = visible && liveUI && !liveUI.classList.contains('hidden');
sendBtn.classList.toggle('hidden', isLive);
}
if (!visible) {
stopRecordingTimer();
stopVoicePlayback();
if (surface) surface.classList.remove('hidden');
if (sendBtn) sendBtn.classList.remove('hidden');
}
}
function startRecordingTimer() {
chatState.recordingStartTime = Date.now();
chatState.recordingPaused = false;
chatState.recordingInterval = setInterval(() => {
if (chatState.mediaRecorder?.state === 'recording' && !chatState.recordingPaused) {
const now = Date.now();
chatState.recordingElapsed += (now - chatState.recordingStartTime);
chatState.recordingStartTime = now;
const seconds = Math.floor(chatState.recordingElapsed / 1000);
const timerEl = document.getElementById('chatRecordingTimer');
if (timerEl) {
const m = Math.floor(seconds / 60).toString().padStart(2, '0');
const s = (seconds % 60).toString().padStart(2, '0');
timerEl.textContent = `${m}:${s}`;
}
}
}, 100);
}
function stopRecordingTimer() {
if (chatState.recordingInterval) {
clearInterval(chatState.recordingInterval);
chatState.recordingInterval = null;
}
chatState.recordingElapsed = 0;
chatState.recordingPaused = false;
const timerEl = document.getElementById('chatRecordingTimer');
if (timerEl) timerEl.textContent = '00:00';
}
function updateVoiceRecordingStatus() {
const pauseBtn = document.getElementById('chatPauseRecordingBtn');
const recorderState = chatState.mediaRecorder?.state || '';
if (pauseBtn) {
pauseBtn.innerHTML = recorderState === 'paused' ? '<i class="fas fa-play"></i>' : '<i class="fas fa-pause"></i>';
pauseBtn.setAttribute('title', recorderState === 'paused' ? t('ادامه ضبط', 'Resume recording') : t('توقف موقت', 'Pause recording'));
}
}
function renderVoicePreviewWaveform(progress = 0) {
const canvas = document.getElementById('chatVoiceWaveform');
if (!canvas || !chatState.voiceWaveformData?.length) return;
const ctx = canvas.getContext('2d');
if (!ctx) return;
ctx.clearRect(0, 0, canvas.width, canvas.height);
const data = chatState.voiceWaveformData;
const bars = 40;
const step = Math.floor(data.length / bars) || 1;
const barWidth = 3;
const barGap = 1;
const amp = canvas.height / 2;
for (let i = 0; i < bars; i++) {
let sum = 0;
let count = 0;
for (let j = 0; j < step; j++) {
const val = data[i * step + j];
if (val !== undefined) {
sum += val;
count++;
}
}
const avg = count > 0 ? sum / count : 0;
const h = Math.max(2, (avg / 255) * canvas.height * 1.2);
const barX = i * (barWidth + barGap);
const isPlayed = (barX / canvas.width) <= progress;
ctx.fillStyle = isPlayed ? '#38bdf8' : 'rgba(125, 211, 252, 0.3)'; // bright blue vs pale sky
ctx.fillRect(barX, amp - h / 2, barWidth, h);
}
}
function startVoicePlayback() {
const audio = document.getElementById('chatVoicePreviewAudio');
const playBtn = document.getElementById('chatVoicePlayBtn');
if (!audio || !playBtn) return;
audio.play().then(() => {
playBtn.innerHTML = '<i class="fas fa-pause"></i>';
chatState.playbackInterval = setInterval(() => {
if (!audio.duration) return;
const progress = audio.currentTime / audio.duration;
const progressPercent = progress * 100;
const progressEl = document.getElementById('chatVoiceProgress');
const timerEl = document.getElementById('chatVoicePreviewTimer');
if (progressEl) progressEl.style.width = `${progressPercent}%`;
renderVoicePreviewWaveform(progress);
if (timerEl) {
const s = Math.floor(audio.currentTime);
const m = Math.floor(s / 60).toString().padStart(2, '0');
const sec = (s % 60).toString().padStart(2, '0');
timerEl.textContent = `${m}:${sec}`;
}
}, 50);
}).catch(console.error);
audio.onended = () => {
stopVoicePlayback();
};
}
function seekVoicePlayback(event) {
const audio = document.getElementById('chatVoicePreviewAudio');
const container = document.getElementById('chatVoiceWaveform')?.parentElement;
if (!audio || !container || !audio.duration) return;
const progressEl = document.getElementById('chatVoiceProgress');
if (progressEl) progressEl.classList.add('seeking');
const rect = container.getBoundingClientRect();
const x = (event.clientX || (event.touches && event.touches[0] ? event.touches[0].clientX : 0)) - rect.left;
const pos = Math.max(0, Math.min(1, x / rect.width));
audio.currentTime = pos * audio.duration;
// Update UI immediately
if (progressEl) progressEl.style.width = `${pos * 100}%`;
renderVoicePreviewWaveform(pos);
}
function stopVoicePlayback() {
const audio = document.getElementById('chatVoicePreviewAudio');
const playBtn = document.getElementById('chatVoicePlayBtn');
if (audio) {
audio.pause();
audio.currentTime = 0;
}
if (playBtn) playBtn.innerHTML = '<i class="fas fa-play"></i>';
if (chatState.playbackInterval) {
clearInterval(chatState.playbackInterval);
chatState.playbackInterval = null;
}
const progressEl = document.getElementById('chatVoiceProgress');
if (progressEl) progressEl.style.width = '0%';
const timerEl = document.getElementById('chatVoicePreviewTimer');
if (timerEl) timerEl.textContent = '00:00';
renderVoicePreviewWaveform(0);
}
function toggleVoicePreviewPlayback() {
const audio = document.getElementById('chatVoicePreviewAudio');
if (!audio) return;
if (audio.paused) {
startVoicePlayback();
} else {
audio.pause();
const playBtn = document.getElementById('chatVoicePlayBtn');
if (playBtn) playBtn.innerHTML = '<i class="fas fa-play"></i>';
if (chatState.playbackInterval) {
clearInterval(chatState.playbackInterval);
chatState.playbackInterval = null;
}
}
}
function clearVoiceDraft() {
if (chatState.voiceDraftUrl) {
URL.revokeObjectURL(chatState.voiceDraftUrl);
}
chatState.voiceDraft = null;
chatState.voiceDraftUrl = '';
chatState.voiceWaveformData = [];
stopVoicePlayback();
const preview = document.getElementById('chatVoicePreview');
const audio = document.getElementById('chatVoicePreviewAudio');
if (audio) audio.removeAttribute('src');
preview?.classList.add('hidden');
if (!chatState.mediaRecorder) setRecordingOverlayVisible(false);
}
function cleanupVoiceRecorder() {
stopStream(chatState.voiceRecorderStream);
chatState.voiceRecorderStream = null;
stopRecordingTimer();
try {
const closePromise = chatState.voiceRecorderAudioContext?.close?.();
closePromise?.catch?.(() => {});
} catch (_error) {
/* noop */
}
chatState.voiceRecorderAudioContext = null;
chatState.mediaRecorder = null;
chatState.recordedChunks = [];
document.getElementById('chatVoiceMessageBtn')?.classList.remove('recording');
const peerMeta = document.getElementById('chatActivePeerMeta');
peerMeta?.classList.remove('animate-pulse', 'text-rose-500');
renderActivePeer();
}
function cancelVoiceRecording() {
if (chatState.mediaRecorder && chatState.mediaRecorder.state !== 'inactive') {
chatState.mediaRecorder.onstop = null;
chatState.mediaRecorder.stop();
}
cleanupVoiceRecorder();
clearVoiceDraft();
}
function pauseOrResumeVoiceRecording() {
const recorder = chatState.mediaRecorder;
if (!recorder) return;
if (recorder.state === 'recording' && typeof recorder.pause === 'function') {
chatState.recordingPaused = true;
recorder.pause();
} else if (recorder.state === 'paused' && typeof recorder.resume === 'function') {
chatState.recordingStartTime = Date.now();
chatState.recordingPaused = false;
recorder.resume();
}
updateVoiceRecordingStatus();
}
function finishVoiceRecording() {
const recorder = chatState.mediaRecorder;
if (!recorder || recorder.state === 'inactive') return;
recorder.stop();
}
async function sendVoiceDraft() {
if (!chatState.voiceDraft) return false;
const draft = chatState.voiceDraft;
const duration = draft.durationMs || 0;
clearVoiceDraft();
await sendEncryptedBlob(draft, 'voice', duration);
return true;
}
async function toggleVoiceRecording() {
const button = document.getElementById('chatVoiceMessageBtn');
if (chatState.mediaRecorder?.state === 'recording') {
pauseOrResumeVoiceRecording();
return;
}
if (chatState.mediaRecorder?.state === 'paused') {
pauseOrResumeVoiceRecording();
return;
}
if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
notify(t('ضبط پیام صوتی در این مرورگر پشتیبانی نمی‌شود.', 'Voice recording is not supported in this browser.'), 'warning');
return;
}
const conversation = getActiveConversation();
if (!conversation) return;
if (!conversation.type) {
const peer = activePeer();
if (!peer) return;
let session = activeSession();
if (!session?.cryptoKey) {
session = await ensureDirectSession(peer);
}
if (!session?.cryptoKey) {
notify(t('برای پیام صوتی ابتدا سشن امن لازم است.', 'A secure session is required before voice messages.'), 'warning');
return;
}
}
try {
document.getElementById('chatComposer')?.blur();
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
clearVoiceDraft();
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
chatState.voiceRecorderStream = stream;
chatState.voiceRecorderAudioContext = audioCtx;
const source = audioCtx.createMediaStreamSource(stream);
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 64;
source.connect(analyser);
const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);
const canvas = document.getElementById('chatRecordingSpectrum');
const ctx = canvas?.getContext('2d');
const overlay = document.getElementById('chatRecordingOverlay');
const preview = document.getElementById('chatVoicePreview');
setRecordingOverlayVisible(true);
preview?.classList.add('hidden');
document.getElementById('chatRecordingLive')?.classList.remove('hidden');
chatState.voiceWaveformData = [];
const draw = () => {
if (!chatState.mediaRecorder || chatState.mediaRecorder.state === 'inactive') return;
requestAnimationFrame(draw);
if (chatState.mediaRecorder.state !== 'recording') return;
analyser.getByteFrequencyData(dataArray);
// Collect waveform
let sum = 0;
for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
chatState.voiceWaveformData.push(sum / bufferLength);
if (ctx) {
ctx.clearRect(0, 0, canvas.width, canvas.height);
const barWidth = (canvas.width / bufferLength) * 1.5;
let x = 0;
for (let i = 0; i < bufferLength; i++) {
const barHeight = (dataArray[i] / 255) * canvas.height;
ctx.fillStyle = `rgb(244, 63, 94)`; // rose-500
ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
x += barWidth + 2;
}
}
};
const mimeType = supportedAudioMimeType();
chatState.recordedChunks = [];
chatState.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
chatState.mediaRecorder.addEventListener('dataavailable', (event) => {
if (event.data?.size) chatState.recordedChunks.push(event.data);
});
chatState.mediaRecorder.addEventListener('stop', () => {
const peerMeta = document.getElementById('chatActivePeerMeta');
if (peerMeta) {
peerMeta.classList.remove('animate-pulse', 'text-rose-500');
}
const blob = new Blob(chatState.recordedChunks, { type: chatState.mediaRecorder?.mimeType || 'audio/webm' });
const finalDuration = chatState.recordingElapsed;
cleanupVoiceRecorder();
if (!blob.size) {
setRecordingOverlayVisible(false);
return;
}
const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
chatState.voiceDraft = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type || 'audio/webm' });
chatState.voiceDraft.durationMs = finalDuration;
chatState.voiceDraftUrl = URL.createObjectURL(blob);
const audio = document.getElementById('chatVoicePreviewAudio');
if (audio) audio.src = chatState.voiceDraftUrl;
document.getElementById('chatVoicePreview')?.classList.remove('hidden');
document.getElementById('chatRecordingLive')?.classList.add('hidden');
renderVoicePreviewWaveform();
setRecordingOverlayVisible(true);
notify(t('ضبط آماده پیش‌نمایش است؛ بعد از گوش‌دادن دکمه ارسال را بزنید.', 'Voice draft is ready; preview it, then press send.'), 'success');
});
chatState.mediaRecorder.start();
startRecordingTimer();
draw();
button?.classList.add('recording');
updateVoiceRecordingStatus();
const peerMeta = document.getElementById('chatActivePeerMeta');
if (peerMeta) {
peerMeta.dataset.originalText = peerMeta.textContent;
peerMeta.textContent = t('در حال ضبط صدا...', 'Recording voice...');
peerMeta.classList.add('animate-pulse', 'text-rose-500');
}
notify(t('ضبط صدا شروع شد؛ می‌توانید توقف موقت، ادامه، پایان یا حذف کنید.', 'Recording started; you can pause, resume, finish, or discard.'), 'info');
} catch (error) {
console.error(error);
notify(t('دسترسی به میکروفون ممکن نشد.', 'Could not access microphone.'), 'error');
}
}
function bindDomEvents() {
if (chatState.initialized) return;
chatState.initialized = true;
mountChatPortals();
document.getElementById('chatSaveProfileBtn')?.addEventListener('click', saveProfile);
document.getElementById('chatBackToListBtn')?.addEventListener('click', () => {
chatState.activePeerClientId = '';
chatState.activeConversationId = '';
updateChatShellMode();
renderPeers();
renderActivePeer();
});
document.getElementById('chatProfileAvatarBtn')?.addEventListener('click', () => toggleAvatarChooser(true));
document.querySelectorAll('[data-chat-avatar-close]').forEach((target) => {
target.addEventListener('click', () => toggleAvatarChooser(false));
});
document.getElementById('chatAvatarDefaultBtn')?.addEventListener('click', () => {
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
setPendingAvatarData(generatedAvatarData('cyan', chatState.profile.name || 'P'));
});
document.getElementById('chatAvatarFileBtn')?.addEventListener('click', () => document.getElementById('chatProfileAvatarInput')?.click());
document.getElementById('chatProfileAvatarInput')?.addEventListener('change', (event) => {
updateProfileAvatar(event.target.files?.[0]);
event.target.value = '';
});
document.getElementById('chatAvatarRotateLeftBtn')?.addEventListener('click', () => rotateAvatarEditor(-90));
document.getElementById('chatAvatarRotateRightBtn')?.addEventListener('click', () => rotateAvatarEditor(90));
document.getElementById('chatAvatarZoomInput')?.addEventListener('input', (event) => setAvatarEditorZoom(event.target.value));
document.getElementById('chatAvatarOffsetXInput')?.addEventListener('input', (event) => setAvatarEditorAxis('offsetX', event.target.value));
document.getElementById('chatAvatarOffsetYInput')?.addEventListener('input', (event) => setAvatarEditorAxis('offsetY', event.target.value));
document.getElementById('chatAvatarScaleXInput')?.addEventListener('input', (event) => setAvatarEditorAxis('scaleX', event.target.value));
document.getElementById('chatAvatarScaleYInput')?.addEventListener('input', (event) => setAvatarEditorAxis('scaleY', event.target.value));
document.getElementById('chatAvatarFilterSelect')?.addEventListener('change', (event) => setAvatarEditorFilter(event.target.value));
document.getElementById('chatAvatarApplyCropBtn')?.addEventListener('click', applyAvatarEditor);
document.getElementById('chatAvatarCancelCropBtn')?.addEventListener('click', cancelAvatarEditor);
document.getElementById('chatAvatarSaveBtn')?.addEventListener('click', savePendingAvatar);
document.getElementById('chatGroupAvatarInput')?.addEventListener('change', (event) => {
updateGroupAvatar(event.target.files?.[0]);
event.target.value = '';
});
['chatProfileName', 'chatServerUrl', 'chatTurnUrl', 'chatTurnUsername', 'chatTurnCredential'].forEach((id) => {
document.getElementById(id)?.addEventListener('input', syncProfileDraftFromInputs);
});
['chatAutoConnect', 'chatAllowVideo', 'chatAutoDiscovery', 'chatShowSuspensionCountdown'].forEach((id) => {
document.getElementById(id)?.addEventListener('change', handleConnectionToggleChange);
});
document.querySelectorAll('[data-chat-view]').forEach((button) => {
button.addEventListener('click', () => setChatView(button.getAttribute('data-chat-view') || 'chats'));
});
document.getElementById('chatSearchInput')?.addEventListener('input', (event) => {
chatState.searchQuery = event.target.value || '';
activateFirstSearchResult(chatState.searchQuery);
renderPeers();
renderMessages();
});
document.getElementById('chatCreateGroupBtn')?.addEventListener('click', () => createSpace('group'));
document.getElementById('chatReconnectBtn')?.addEventListener('click', async () => {
disconnectChat();
await connectChatTransport();
});
document.getElementById('chatConnectBtn')?.addEventListener('click', connectChatTransport);
document.getElementById('chatDiscoverLocalBtn')?.addEventListener('click', async () => {
const result = await discoverLocalRelayServer({ fullScan: true, silent: false });
if (result && !chatState.connected) await connectChatTransport();
});
document.querySelectorAll('.chat-avatar-preset').forEach((btn) => {
btn.addEventListener('click', async () => {
const seed = btn.dataset.avatarSeed;
if (seed) {
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
setPendingAvatarData(generatedAvatarData(seed, btn.textContent || chatState.profile.name));
return;
}
const url = btn.dataset.avatarPreset;
await selectPresetAvatar(url);
});
});
document.getElementById('chatResetIdentityBtn')?.addEventListener('click', rotateIdentity);
document.getElementById('chatShowIdentityQrBtn')?.addEventListener('click', showChatIdentityQr);
document.getElementById('chatStartChatBtn')?.addEventListener('click', openStartChatModal);
document.getElementById('chatStartSessionBtn')?.addEventListener('click', () => startSecureSession());
document.getElementById('chatDeleteConversationBtn')?.addEventListener('click', deleteActiveConversation);
document.getElementById('chatReturnToCallBtn')?.addEventListener('click', () => {
setCallDisplayMode('fullscreen');
});
document.getElementById('chatCancelContextBtn')?.addEventListener('click', clearMessageContext);
document.getElementById('chatMessages')?.addEventListener('click', (event) => {
const replyBtn = event.target.closest('[data-chat-reply-message]');
if (replyBtn) {
handleReplyMessage(replyBtn.dataset.chatReplyMessage);
return;
}
const editBtn = event.target.closest('[data-chat-edit-message]');
if (editBtn) {
handleEditMessage(editBtn.dataset.chatEditMessage);
return;
}
const pinBtn = event.target.closest('[data-chat-pin-message]');
if (pinBtn) {
handlePinMessage(pinBtn.dataset.chatPinMessage);
return;
}
const forwardBtn = event.target.closest('[data-chat-forward-message]');
if (forwardBtn) {
handleForwardMessage(forwardBtn.dataset.chatForwardMessage);
return;
}
});
document.getElementById('chatSendMessageBtn')?.addEventListener('pointerdown', (event) => {
event.preventDefault(); // Keep focus on composer
sendMessage();
});
document.getElementById('chatSendFileBtn')?.addEventListener('click', () => document.getElementById('chatFileInput')?.click());
document.getElementById('chatVoiceMessageBtn')?.addEventListener('click', toggleVoiceRecording);
document.getElementById('chatRingtoneSelect')?.addEventListener('change', (event) => {
chatState.profile = {
...chatState.profile,
...buildProfileDraft(),
ringtoneId: event.target.value || 'classic',
};
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
renderRingtoneSettings();
});
document.getElementById('chatTestRingtoneBtn')?.addEventListener('click', testRingtone);
document.getElementById('chatMessageToneSelect')?.addEventListener('change', (event) => {
chatState.profile = {
...chatState.profile,
...buildProfileDraft(),
messageToneId: event.target.value || 'chime',
};
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
renderRingtoneSettings();
});
document.getElementById('chatTestMessageToneBtn')?.addEventListener('click', testMessageTone);
document.getElementById('chatPauseRecordingBtn')?.addEventListener('click', pauseOrResumeVoiceRecording);
document.getElementById('chatFinishRecordingBtn')?.addEventListener('click', finishVoiceRecording);
document.getElementById('chatCancelRecordingBtn')?.addEventListener('click', cancelVoiceRecording);
document.getElementById('chatDiscardVoiceDraftBtn')?.addEventListener('click', clearVoiceDraft);
document.getElementById('chatVoicePlayBtn')?.addEventListener('click', toggleVoicePreviewPlayback);
const waveformContainer = document.getElementById('chatVoiceWaveform')?.parentElement;
if (waveformContainer) {
const handleSeek = (e) => {
if (e.type.startsWith('touch') || (e.buttons & 1)) {
seekVoicePlayback(e);
}
};
const endSeek = () => {
const progressEl = document.getElementById('chatVoiceProgress');
if (progressEl) progressEl.classList.remove('seeking');
};
waveformContainer.addEventListener('mousedown', seekVoicePlayback);
waveformContainer.addEventListener('mousemove', handleSeek);
waveformContainer.addEventListener('mouseup', endSeek);
waveformContainer.addEventListener('touchstart', seekVoicePlayback, { passive: true });
waveformContainer.addEventListener('touchmove', handleSeek, { passive: true });
waveformContainer.addEventListener('touchend', endSeek, { passive: true });
}
document.getElementById('chatComposer')?.addEventListener('input', (event) => {
syncComposerDirection();
const heightChanged = syncComposerHeight(event.target);
if (heightChanged) {
syncComposerViewportFocus(true, true);
}
notifyTyping();
});
document.getElementById('chatComposer')?.addEventListener('focus', () => {
syncComposerDirection();
if (isCompactChatLayout()) {
document.documentElement.scrollTop = 0;
document.body.scrollTop = 0;
window.scrollTo(0, 0);
}
syncComposerViewportFocus(true);
});
document.getElementById('chatComposer')?.addEventListener('blur', () => {
syncComposerViewportFocus(false);
});
document.getElementById('chatTimerToggleBtn')?.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
toggleTimerPopover();
});
document.querySelectorAll('[data-chat-timer]').forEach((button) => {
button.addEventListener('click', (event) => {
event.preventDefault();
event.stopPropagation();
setTimerSeconds(Number(button.getAttribute('data-chat-timer') || 0));
});
});
document.getElementById('chatFileInput')?.addEventListener('change', async (event) => {
const file = event.target.files?.[0];
if (file) {
await sendFile(file);
}
event.target.value = '';
});
document.getElementById('chatVoiceCallBtn')?.addEventListener('click', () => startCall('voice'));
document.getElementById('chatVideoCallBtn')?.addEventListener('click', () => startCall('video'));
document.getElementById('chatEndCallBtn')?.addEventListener('click', endCurrentCall);
document.getElementById('chatFloatingEndCallBtn')?.addEventListener('click', endCurrentCall);
document.getElementById('chatEndCallControlBtn')?.addEventListener('click', endCurrentCall);
document.getElementById('chatMinimizeCallBtn')?.addEventListener('click', (event) => {
event.stopPropagation();
toggleCallDisplayMode();
});
document.getElementById('chatAcceptCallBtn')?.addEventListener('click', acceptIncomingCall);
document.getElementById('chatRejectCallBtn')?.addEventListener('click', rejectIncomingCall);
document.getElementById('chatMuteToggleBtn')?.addEventListener('click', toggleMuteCall);
document.getElementById('chatHoldToggleBtn')?.addEventListener('click', toggleHoldCall);
document.getElementById('chatSpeakerToggleBtn')?.addEventListener('click', toggleSpeakerCall);
document.getElementById('chatVideoToggleBtn')?.addEventListener('click', toggleVideoCall);
document.getElementById('chatScreenShareBtn')?.addEventListener('click', toggleScreenShare);
document.getElementById('chatFlipCameraBtn')?.addEventListener('click', flipCameraCall);
document.getElementById('chatSwapVideoLayoutBtn')?.addEventListener('click', () => {
chatState.callPrimaryVideo = chatState.callPrimaryVideo === 'remote' ? 'local' : 'remote';
refreshCallControls();
});
document.getElementById('chatComposer')?.addEventListener('keydown', (event) => {
if (event.key === 'Enter' && !event.shiftKey) {
event.preventDefault();
sendMessage();
}
});
document.addEventListener('click', (event) => {
const timerOption = event.target.closest('[data-chat-timer]');
if (timerOption) {
event.preventDefault();
event.stopPropagation();
setTimerSeconds(Number(timerOption.getAttribute('data-chat-timer') || 0));
return;
}
const popover = document.getElementById('chatTimerPopover');
const toggle = document.getElementById('chatTimerToggleBtn');
if (!popover || popover.classList.contains('hidden')) return;
if (popover.contains(event.target) || toggle?.contains(event.target)) return;
toggleTimerPopover(false);
});
document.addEventListener('click', (event) => {
if (event.target.closest('[data-chat-toggle-reaction]') || event.target.closest('[data-chat-reaction-choice]') || event.target.closest('[data-chat-reaction-custom]')) return;
if (chatState.activeReactionMessageId && !event.target.closest('.chat-message-toolbar') && !event.target.closest('.chat-reaction-picker')) {
chatState.activeReactionMessageId = '';
renderMessages();
}
});
['pointerdown', 'touchstart', 'keydown'].forEach((eventName) => {
document.addEventListener(eventName, primeRingtoneAudio, { once: true, passive: true });
});
document.getElementById('chatFloatingCallHeader')?.addEventListener('pointerdown', (event) => {
if (event.target.closest('button')) return;
beginFloatingCallDrag(event);
});
document.getElementById('chatFloatingCall')?.addEventListener('click', (event) => {
if (chatState.callDisplayMode !== 'minimized') return;
if (event.target.closest('button')) return;
setCallDisplayMode('fullscreen');
});
window.addEventListener('pointermove', moveFloatingCallDrag);
window.addEventListener('pointerup', endFloatingCallDrag);
window.addEventListener('pointercancel', endFloatingCallDrag);
window.addEventListener('resize', () => {
if (chatState.timerPopoverOpen) requestAnimationFrame(positionTimerPopover);
syncCallOverlayBounds();
});
window.visualViewport?.addEventListener('resize', () => {
if (chatState.timerPopoverOpen) requestAnimationFrame(positionTimerPopover);
syncComposerViewportFocus(document.activeElement?.id === 'chatComposer');
syncCallOverlayBounds();
});
window.visualViewport?.addEventListener('scroll', () => {
if (chatState.timerPopoverOpen) requestAnimationFrame(positionTimerPopover);
syncComposerViewportFocus(document.activeElement?.id === 'chatComposer');
syncCallOverlayBounds();
});
window.addEventListener('scroll', () => {
if (chatState.timerPopoverOpen) requestAnimationFrame(positionTimerPopover);
syncCallOverlayBounds();
}, true);
window.addEventListener('poorija:tab-switched', async (event) => {
updateChatShellMode();
if (event.detail?.tabName === 'chat') {
renderStaticUi();
renderPeers();
renderActivePeer();
setChatView(chatState.activeView);
if (isUnlocked() && chatState.profile.autoConnect && !chatState.connected) {
await connectChatTransport();
}
}
});
window.addEventListener('poorija:unlock', async () => {
loadPersistedChatState();
await ensureIdentity();
renderStaticUi();
renderPeers();
renderActivePeer();
setChatView(chatState.activeView);
if (chatState.profile.autoConnect) {
await connectChatTransport();
}
});
window.addEventListener('poorija:lock', () => {
disconnectChat();
});
window.addEventListener('poorija:language-changed', () => {
renderStaticUi();
renderPeers();
renderActivePeer();
setChatView(chatState.activeView);
});
window.addEventListener('resize', () => {
if (!isCompactChatLayout() && !chatState.activePeerClientId && !chatState.activeConversationId && chatState.peers.some(shouldShowConversation)) {
const visiblePeers = chatState.peers.filter(shouldShowConversation);
chatState.activePeerClientId = visiblePeers[0].clientId;
chatState.activeConversationId = getConversationKey(visiblePeers[0]);
}
updateChatShellMode();
applyFloatingCallPosition();
syncCallOverlayBounds();
renderPeers();
renderActivePeer();
});
window.addEventListener('poorija:notifications-enabled', () => {
registerChatPush(true).catch((error) => console.warn('Web Push registration failed:', error));
});
}
function syncComposerHeight(el) {
if (!el) return false;
const oldHeight = el.style.height;
el.style.height = 'auto';
const nextHeight = Math.min(150, el.scrollHeight);
el.style.height = nextHeight + 'px';
return oldHeight !== el.style.height;
}
function clearMessageContext() {
chatState.replyToId = '';
chatState.editingMessageId = '';
const ctx = document.getElementById('chatComposerContext');
if (ctx) ctx.classList.add('hidden');
const composer = document.getElementById('chatComposer');
if (composer) {
composer.placeholder = t('پیام امن شما…', 'Your secure message...');
}
}
function handleReplyMessage(messageId) {
const peer = getActiveConversation();
if (!peer) return;
const history = chatState.history[getConversationKey(peer)] || [];
const entry = history.find(m => m.id === messageId);
if (!entry) return;
chatState.replyToId = messageId;
chatState.editingMessageId = '';
const ctx = document.getElementById('chatComposerContext');
const title = document.getElementById('chatContextTitle');
const text = document.getElementById('chatContextText');
const icon = ctx?.querySelector('.chat-context-icon i');
if (ctx && title && text) {
title.textContent = entry.direction === 'out' ? t('پاسخ به خودتان', 'Reply to yourself') : t('پاسخ به', 'Reply to') + ' ' + (peer.username || peer.name || t('کاربر', 'User'));
text.textContent = entry.text || (entry.type === 'voice' ? t('پیام صوتی', 'Voice message') : t('فایل', 'File'));
if (icon) {
icon.className = 'fas fa-reply';
}
ctx.classList.remove('hidden');
}
focusComposerWithoutPageJump();
}
function handleEditMessage(messageId) {
const peer = getActiveConversation();
if (!peer) return;
const history = chatState.history[getConversationKey(peer)] || [];
const entry = history.find(m => m.id === messageId);
if (!entry || entry.direction !== 'out' || entry.type !== 'text') return;
chatState.editingMessageId = messageId;
chatState.replyToId = '';
const ctx = document.getElementById('chatComposerContext');
const title = document.getElementById('chatContextTitle');
const text = document.getElementById('chatContextText');
const icon = ctx?.querySelector('.chat-context-icon i');
if (ctx && title && text) {
title.textContent = t('ویرایش پیام', 'Edit message');
text.textContent = entry.text;
if (icon) {
icon.className = 'fas fa-pen';
}
ctx.classList.remove('hidden');
}
const composer = document.getElementById('chatComposer');
if (composer) {
composer.value = entry.text;
focusComposerWithoutPageJump(composer);
syncComposerHeight(composer);
}
}
async function finalizeMessageEdit(messageId, newText) {
const peer = getActiveConversation();
if (!peer) return;
const key = getConversationKey(peer);
const history = chatState.history[key] || [];
const entry = history.find(m => m.id === messageId);
if (!entry) return;
entry.text = newText;
entry.edited = true;
entry.status = 'queued';
storeHistory();
renderMessages();
clearMessageContext();
const composer = document.getElementById('chatComposer');
if (composer) {
composer.value = '';
composer.style.height = '';
}
const session = await ensureDirectSession(peer);
if (session) {
const payload = await encryptForSession(session, new TextEncoder().encode(newText));
relaySessionEvent(peer, {
type: 'edit',
messageId,
payload,
createdAt: new Date().toISOString()
});
}
}
function handlePinMessage(messageId) {
const peer = getActiveConversation();
if (!peer) return;
const key = getConversationKey(peer);
const history = chatState.history[key] || [];
const entry = history.find((item) => item.id === messageId);
if (!entry) return;
entry.pinned = !entry.pinned;
storeHistory();
renderMessages();
notify(entry.pinned ? t('پیام سنجاق شد.', 'Message pinned.') : t('پیام از سنجاق خارج شد.', 'Message unpinned.'), 'success');
}
function forwardEntryLabel(entry) {
if (!entry) return '';
if (entry.text) return entry.text;
if (entry.name) return entry.name;
if (entry.type === 'voice') return t('پیام صوتی', 'Voice message');
if (entry.type === 'file') return t('فایل', 'File');
if (entry.type === 'call-log') return callHistoryText(entry);
return t('پیام', 'Message');
}
function forwardDestinations() {
const activeKey = getConversationKey(getActiveConversation());
const seen = new Set();
const direct = chatState.peers
.filter((peer) => getConversationKey(peer) && getConversationKey(peer) !== activeKey)
.map((peer) => ({
key: getConversationKey(peer),
icon: 'fa-user-lock',
label: peer.username || peer.name || peer.peerId || t('کاربر', 'User'),
hint: peer.status === 'online' ? t('آنلاین', 'Online') : t('آفلاین', 'Offline'),
}));
const spaces = chatState.spaces.groups
.filter((space) => getConversationKey(space) && getConversationKey(space) !== activeKey)
.map((space) => ({
key: getConversationKey(space),
icon: 'fa-user-group',
label: space.name,
hint: t('گروه', 'Group'),
}));
return [...direct, ...spaces].filter((item) => {
if (!item.key || seen.has(item.key)) return false;
seen.add(item.key);
return true;
});
}
function ensureForwardModal() {
let modal = document.getElementById('chatForwardModal');
if (modal) return modal;
modal = document.createElement('div');
modal.id = 'chatForwardModal';
modal.className = 'chat-forward-modal hidden';
document.body.appendChild(modal);
return modal;
}
function closeForwardModal() {
chatState.activeForwardMessageId = '';
const modal = document.getElementById('chatForwardModal');
modal?.classList.add('hidden');
}
function forwardEntryToDestination(entry, destinationKey) {
const text = forwardEntryLabel(entry).trim();
if (!text || !destinationKey) return;
const now = new Date();
const forwarded = {
id: generateId('msg'),
type: 'text',
text: `${t('هدایت‌شده', 'Forwarded')}: ${text}`,
direction: 'out',
status: 'sent',
createdAt: now.toISOString(),
forwardedFrom: getConversationKey(getActiveConversation()),
};
if (chatState.timerSeconds > 0) {
forwarded.expiresAt = new Date(now.getTime() + chatState.timerSeconds * 1000).toISOString();
}
appendHistory(destinationKey, forwarded);
closeForwardModal();
notify(t('پیام به مقصد انتخاب‌شده هدایت شد.', 'Message forwarded to the selected destination.'), 'success');
}
function openForwardModal(entry) {
const destinations = forwardDestinations();
const composer = document.getElementById('chatComposer');
if (!destinations.length) {
if (composer) {
composer.value = `${t('هدایت‌شده', 'Forwarded')}: ${forwardEntryLabel(entry)}`;
focusComposerWithoutPageJump(composer);
syncComposerDirection();
syncComposerHeight(composer);
}
notify(t('مقصد دیگری پیدا نشد؛ متن در کادر پیام آماده شد.', 'No other destination was found; the text is ready in the composer.'), 'info');
return;
}
const modal = ensureForwardModal();
modal.innerHTML = `
<div class="chat-forward-backdrop" data-chat-forward-close></div>
<section class="chat-forward-card" role="dialog" aria-modal="true">
<div class="chat-forward-head">
<div>
<h4>${t('هدایت پیام', 'Forward message')}</h4>
<p>${app().escapeHTML(forwardEntryLabel(entry)).slice(0, 120)}</p>
</div>
<button type="button" data-chat-forward-close aria-label="${app().escapeHTML(t('بستن', 'Close'))}">
<i class="fas fa-xmark"></i>
</button>
</div>
<div class="chat-forward-list">
${destinations.map((item) => `
<button type="button" data-chat-forward-destination="${app().escapeHTML(item.key)}">
<i class="fas ${item.icon}"></i>
<span>${app().escapeHTML(item.label)}</span>
<small>${app().escapeHTML(item.hint)}</small>
</button>
`).join('')}
</div>
</section>
`;
modal.classList.remove('hidden');
modal.querySelectorAll('[data-chat-forward-close]').forEach((button) => {
button.addEventListener('click', closeForwardModal);
});
modal.querySelectorAll('[data-chat-forward-destination]').forEach((button) => {
button.addEventListener('click', () => forwardEntryToDestination(entry, button.getAttribute('data-chat-forward-destination') || ''));
});
}
function handleForwardMessage(messageId) {
const peer = getActiveConversation();
if (!peer) return;
const history = chatState.history[getConversationKey(peer)] || [];
const entry = history.find((item) => item.id === messageId);
if (!entry) return;
chatState.activeForwardMessageId = messageId;
openForwardModal(entry);
}
async function initChatModule() {
if (!document.getElementById('content-chat')) return;
loadPersistedChatState();
bindDomEvents();
renderStaticUi();
renderPeers();
renderActivePeer();
setChatView(chatState.activeView);
syncTimerUi();
refreshCallControls();
if (isUnlocked()) {
await ensureIdentity();
renderStaticUi();
await hydrateRelayTurnConfig();
if (chatState.profile.autoConnect && appState()?.activeTab === 'chat') {
await connectChatTransport();
}
}
setInterval(() => {
const expired = pruneExpiredHistory();
if (expired) {
storeHistory();
renderPeers();
renderMessages();
} else {
// Update live countdown labels without full re-render if possible
document.querySelectorAll('.chat-timer-countdown').forEach(el => {
const expires = el.dataset.expires;
if (expires) el.innerHTML = `<i class="fas fa-stopwatch animate-pulse"></i> ${formatCountdown(expires)}`;
});
}
}, 1000);
}
let isChatInitialized = false;
async function lazyInitChatModule() {
if (isChatInitialized) return;
isChatInitialized = true;
await initChatModule();
}
window.addEventListener('poorija:unlock', (e) => {
if (e.detail.activeTab === 'chat') lazyInitChatModule();
});
window.addEventListener('poorija:tab-switched', (e) => {
if (e.detail.tabName === 'chat') lazyInitChatModule();
});
// Also try to init on load if already unlocked (rare case)
window.addEventListener('load', () => {
const appState = window.PoorijaApp?.state;
if (appState && !appState.isLocked && appState.activeTab === 'chat') {
lazyInitChatModule();
}
});
})();
