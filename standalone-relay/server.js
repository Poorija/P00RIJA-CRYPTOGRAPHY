/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

const http = require('http');
const crypto = require('crypto');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const express = require('express');
const { ExpressPeerServer } = require('peer');
const webpush = require('web-push');
/* One place decides what a background notification says. The copy that used to
   sit in this file knew only 'call-invite' versus everything else, in English
   — while scripts/server.js had grown group, voice-or-video and, now, Persian.
   Dockerfile.relay copies the module in beside this server. */
const { pushBodyFor, pushTagFor, normalizePushLang, pushSendOptions } = require('./lib/push-wording.js');
const { WebSocketServer, WebSocket } = require('ws');

// Simple .env loader for native runs
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  });
}

const DOMAIN = process.env.DOMAIN || 'localhost';
const HOST = process.env.CHAT_SIGNAL_HOST || '0.0.0.0';
const PORT = Number(process.env.CHAT_SIGNAL_PORT || 9000);
const PRESENCE_PORT = Number(process.env.CHAT_PRESENCE_PORT || 9001);

// Improve path fallbacks for native runs (use relative path if /data is not writable)
const defaultDataDir = fs.existsSync('/data') && (function() { try { fs.accessSync('/data', fs.constants.W_OK); return true; } catch(e) { return false; } })()
  ? '/data'
  : path.join(__dirname, '..', 'data', 'chat-signal');

const PUSH_STORE_PATH = process.env.CHAT_PUSH_STORE_PATH || path.join(defaultDataDir, 'push-subscriptions.json');
const OFFLINE_STORE_PATH = process.env.CHAT_OFFLINE_STORE_PATH || path.join(defaultDataDir, 'offline-messages.json');
const POLICY_STORE_PATH = process.env.CHAT_POLICY_STORE_PATH || path.join(path.dirname(OFFLINE_STORE_PATH), 'server-policy.json');
const SELF_DESTRUCT_STORE_PATH = process.env.CHAT_SELF_DESTRUCT_STORE_PATH || path.join(path.dirname(OFFLINE_STORE_PATH), 'self-destruct-records.json');

const TURN_URL = process.env.CHAT_TURN_URL || `turn:${DOMAIN}:3478?transport=udp,turn:${DOMAIN}:3478?transport=tcp,turns:${DOMAIN}:5349?transport=tcp`;
const TURN_USERNAME = process.env.CHAT_TURN_USERNAME || process.env.TURN_USER || 'poorija';
const TURN_CREDENTIAL = process.env.CHAT_TURN_CREDENTIAL || process.env.TURN_PASSWORD || '';
const PRESENCE_TTL_MS = Number(process.env.CHAT_PRESENCE_TTL_MS || 90000);
/* A fingerprint arrived as a claim and nothing else, so hello now has to prove
   possession of the identity key behind it before mail is handed over. This
   switch is the escape hatch for a deployment that cannot answer challenges. */
const IDENTITY_PROOF_REQUIRED = process.env.CHAT_IDENTITY_PROOF_REQUIRED !== '0';
const PUBLIC_RELAY_ORIGIN = process.env.CHAT_PUBLIC_RELAY_ORIGIN || '';
const PUBLIC_PRESENCE_URL = process.env.CHAT_PUBLIC_PRESENCE_URL || '';

const CONFIG_PATH = path.join(path.dirname(OFFLINE_STORE_PATH), 'server-config.json');
let MONITOR_PASSWORD = process.env.MONITOR_PASSWORD || '';
const ALLOW_INSECURE_DEFAULTS = process.env.ALLOW_INSECURE_DEFAULTS === '1';
const ALLOWED_ORIGINS = (process.env.CHAT_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function loadServerConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (config.monitorPassword) {
        MONITOR_PASSWORD = config.monitorPassword;
      }
    }
  } catch (error) {
    console.error('Failed to load server config:', error);
  }
  // Environment variable ALWAYS takes priority over config file
  if (process.env.MONITOR_PASSWORD) {
    MONITOR_PASSWORD = process.env.MONITOR_PASSWORD;
  }
}

function saveServerConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    /* 0600: this file holds the monitor's password in the clear, and the
       default 0644 hands it to every other account on the host. */
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ monitorPassword: MONITOR_PASSWORD }, null, 2), { mode: 0o600 });
    try { fs.chmodSync(CONFIG_PATH, 0o600); } catch (_error) { /* pre-existing file on a filesystem without modes */ }
  } catch (error) {
    console.error('Failed to save server config:', error);
  }
}

loadServerConfig();

if (!ALLOW_INSECURE_DEFAULTS && (!MONITOR_PASSWORD || MONITOR_PASSWORD.length < 12)) {
  throw new Error('MONITOR_PASSWORD must be set to a strong non-default value with at least 12 characters. Set ALLOW_INSECURE_DEFAULTS=1 only for isolated local development.');
}

const app = express();
const server = http.createServer(app);
const presenceServer = http.createServer();
/* Socket-level failures (reset peers, TLS handshakes that die mid-frame)
   surface as 'error' events on the server object, and an unhandled one takes
   the process down — the per-socket handlers below never see them. */
server.on('error', (error) => console.error('[HTTP] Signal server error:', error));
presenceServer.on('error', (error) => console.error('[HTTP] Presence server error:', error));

/* How many reverse proxies actually stand in front of this process.
 *
 * `trust proxy: true` trusted the WHOLE X-Forwarded-For chain, which means it
 * trusted whatever the client wrote there: req.ip became the leftmost entry,
 * and the leftmost entry is the attacker's to choose. Every defence keyed on
 * it — the three-strike monitor lockout, every rate-limit bucket — was
 * therefore one header away from being switched off. Proved with twelve
 * /admin/login guesses that never once tripped the lockout because each
 * carried a different X-Forwarded-For.
 *
 * A COUNT instead of `true` makes Express walk in from the right and stop
 * after the hops we actually deploy, so the value it lands on is the one our
 * own nginx wrote. Set CHAT_TRUSTED_PROXIES to the real number if a CDN or a
 * second load balancer is added; 0 means this process is directly exposed. */
/* Zero by default HERE, where the main relay defaults to one. This process is
   deployed by its own docker-compose with `network_mode: host` and no reverse
   proxy at all, so there is no hop whose X-Forwarded-For could be believed —
   and believing one would hand an attacker on the same host or LAN a fresh
   rate-limit bucket per request. An operator who does put a proxy in front
   sets CHAT_TRUSTED_PROXIES to the number of hops. */
const TRUSTED_PROXY_HOPS = Math.max(0, Number(process.env.CHAT_TRUSTED_PROXIES ?? 0) || 0);
app.set('trust proxy', TRUSTED_PROXY_HOPS);

/* The address a security decision is allowed to use.
 *
 * requestIp() below stays as it is and stays where it is: the monitor shows
 * operators who is connected, and for THAT a CDN header is better information
 * than a proxy's address. But it consults cf-connecting-ip, true-client-ip,
 * x-real-ip and x-client-ip — four headers nginx neither sets nor strips — so
 * it must never decide whether somebody is rate-limited or locked out.
 *
 * This one consults nothing a client can write. Express has already applied
 * the hop count above; if the chain is shorter than the hop count (a request
 * that did not come through our proxy at all) req.ip falls back to the socket,
 * which is exactly right. */
function securityKey(req) {
  const direct = normalizeIpValue(req?.socket?.remoteAddress || '');
  /* No proxy in front: the socket is the only honest answer and every header
     is noise. Operators who expose this process directly set
     CHAT_TRUSTED_PROXIES=0 and nothing below can be talked into anything. */
  if (TRUSTED_PROXY_HOPS === 0) return String(direct || 'unknown');
  /* A request that reached this process from a public address did not come
     through our own reverse proxy, whatever its headers claim. */
  if (direct && isPublicIp(direct)) return String(direct);

  /* Behind the proxy, count from the RIGHT and never from the left.
   *
   * nginx writes `X-Forwarded-For: <whatever the client sent>, <the address
   * nginx saw>` — so the rightmost entry is the only one our own
   * infrastructure vouches for, and everything to its left is the client's to
   * invent. req.ip is not used here: Express walks in from the socket, which
   * lands on an attacker-supplied entry the moment the real chain is shorter
   * than expected, and that is precisely the bypass this replaces. */
  const chain = String(req?.headers?.['x-forwarded-for'] || '')
    .split(',').map((part) => normalizeIpValue(part.trim())).filter(Boolean);
  if (chain.length < TRUSTED_PROXY_HOPS) return String(direct || 'unknown');
  return String(chain[chain.length - TRUSTED_PROXY_HOPS] || direct || 'unknown');
}

app.use('/vendor', express.static(path.join(__dirname, 'vendor')));
app.use('/vendor', express.static(path.join(__dirname, '..', 'vendor')));
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const sameOrigin = !origin;
  const isPrivateIp = (origin) => {
    if (!origin || origin === 'null') return true;
    try {
      const url = new URL(origin);
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0' || hostname.endsWith('.localhost')) return true;
      const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (match) {
        const [first, second] = [Number(match[1]), Number(match[2])];
        return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
      }
      return false;
    } catch (e) { return false; }
  };
  const allowedLocal = isPrivateIp(origin);
  const allowedTauri = /^https?:\/\/tauri\.localhost(?::\d+)?$/i.test(origin || '') || /^tauri:\/\//i.test(origin || '');
  const allowedConfigured = origin && ALLOWED_ORIGINS.includes(origin);
  if (sameOrigin || allowedLocal || allowedTauri || allowedConfigured) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-P00RIJA-Fingerprint, X-P00RIJA-Peer-Id, X-P00RIJA-Client-Id, X-P00RIJA-Username');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

function normalizeTurnUrls(value = '') {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,\n\r]+/);
  return raw
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

const TURN_URLS = normalizeTurnUrls(TURN_URL);

function forwardedProtocol(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (forwarded) return forwarded;
  return req.protocol === 'https' ? 'https' : 'http';
}

function hostWithPort(host = '', port = '') {
  if (!host) return `localhost:${port}`;
  if (!port) return host;
  if (host.startsWith('[')) {
    return host.replace(/\](?::\d+)?$/, `]:${port}`);
  }
  return host.replace(/:\d+$/, '') + `:${port}`;
}

function publicRelayUrls(req) {
  const host = req.get('host') || `${req.hostname}:${PORT}`;
  const protocol = forwardedProtocol(req);
  const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
  const hasForwardedProxy = Boolean(req.headers['x-forwarded-proto'] || req.headers['x-forwarded-host']);
  const hostPort = host.match(/:(\d+)$/)?.[1] || '';
  const directSignalPort = !hasForwardedProxy && (!hostPort || hostPort === String(PORT));
  const relayOrigin = PUBLIC_RELAY_ORIGIN || `${protocol}://${host}`;
  const presenceHost = directSignalPort ? hostWithPort(host, PRESENCE_PORT) : host;
  const presenceUrl = PUBLIC_PRESENCE_URL || `${wsProtocol}://${presenceHost}/chat-signal`;
  return { relayOrigin, presenceUrl };
}

const authMiddleware = (req, res, next) => {
  setNoStoreHeaders(res);
  if (isValidMonitorAuth(req)) {
    return next();
  }

  res.status(401).json({ ok: false, reason: 'Invalid credentials' });
};

const configuredVapid = {
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || '',
};
const vapidKeys = configuredVapid.publicKey && configuredVapid.privateKey
  ? configuredVapid
  : webpush.generateVAPIDKeys();
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@poorija.local';

webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);
if (!configuredVapid.publicKey || !configuredVapid.privateKey) {
  console.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY were not provided; using ephemeral keys for this container run.');
}

let serverLogs = [];
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const monitorLoginFailures = new Map();
const MONITOR_LOCK_MAX_ATTEMPTS = 3;
const MONITOR_LOCK_MS = 10 * 60 * 1000;
const POLICY_NOTICE_COOLDOWN_MS = 10 * 60 * 1000;

function addLog(type, args) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  serverLogs.push({ type, msg, ts: new Date().toISOString() });
  if (serverLogs.length > 200) serverLogs.shift();
}

console.log = (...args) => { originalLog(...args); addLog('info', args); };
console.warn = (...args) => { originalWarn(...args); addLog('warn', args); };
console.error = (...args) => { originalError(...args); addLog('error', args); };

/* Ported verbatim from scripts/server.js. The standalone copy called these
   but never carried them, so the first WebSocket connection threw
   "requestIp is not defined" and took the process down. */
function normalizeIpValue(value = '') {
  const clean = String(value || '')
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/^::ffff:/, '')
    .replace(/^\[|\]$/g, '')
    .replace(/^for=/i, '');
  const ipv4WithPort = clean.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return (ipv4WithPort ? ipv4WithPort[1] : clean).slice(0, 80);
}

function isPublicIp(ip = '') {
  const clean = normalizeIpValue(ip);
  const match = clean.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return clean.includes(':') && clean !== '::1' && !clean.toLowerCase().startsWith('fc') && !clean.toLowerCase().startsWith('fd') && !clean.toLowerCase().startsWith('fe80');
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (first === 10 || first === 127 || first === 0) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && second === 168) return false;
  if (first === 169 && second === 254) return false;
  return true;
}

function isContainerOrLoopbackIp(ip = '') {
  const clean = normalizeIpValue(ip);
  if (!clean) return false;
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return true;
  const match = clean.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return first === 172 && second >= 16 && second <= 31;
}

function requestIp(req) {
  const forwardedHeader = String(req?.headers?.['x-forwarded-for'] || '');
  const forwardedDirective = String(req?.headers?.forwarded || '')
    .split(',')
    .map((part) => part.match(/for="?([^;,"]+)/i)?.[1] || '')
    .filter(Boolean);
  const candidates = [
    req?.headers?.['cf-connecting-ip'],
    req?.headers?.['true-client-ip'],
    req?.headers?.['x-real-ip'],
    req?.headers?.['x-client-ip'],
    ...forwardedHeader.split(','),
    ...forwardedDirective,
    req?.ip,
    req?.socket?.remoteAddress,
  ].flat().map(normalizeIpValue).filter(Boolean);
  const publicIp = candidates.find(isPublicIp);
  if (publicIp) return publicIp;
  const nonContainerIp = candidates.find((ip) => !isContainerOrLoopbackIp(ip));
  return (nonContainerIp || '').slice(0, 80);
}

function sanitizePolicyDurationMs(msValue, minutesValue, fallbackMinutes) {
  const maxMs = 60 * 24 * 30 * 60 * 1000;
  const fromMs = Number(msValue);
  if (Number.isFinite(fromMs) && fromMs > 0) {
    return Math.max(1000, Math.min(maxMs, Math.round(fromMs)));
  }
  const minutes = Number(minutesValue || fallbackMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return fallbackMinutes * 60 * 1000;
  }
  return Math.max(1000, Math.min(maxMs, Math.round(minutes * 60 * 1000)));
}

function setNoStoreHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

function readCookie(req, name) {
  if (!req.headers.cookie) return '';
  return req.headers.cookie.split(';').reduce((acc, cookie) => {
    const [key, ...value] = cookie.trim().split('=');
    return key === name ? value.join('=') : acc;
  }, '');
}

function clearMonitorAuthCookie(res) {
  res.setHeader('Set-Cookie', [
    'monitor_token_v2=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly',
    'monitor_token_v2=; Path=/Monitor_Server; Max-Age=0; SameSite=Strict; HttpOnly',
  ]);
}

function getMonitorAuth(req) {
  let authToUse = req.headers.authorization || '';
  if (!authToUse) {
    if (req.query && req.query.auth) {
      authToUse = `Basic ${req.query.auth}`;
    } else {
      const cookie = readCookie(req, 'monitor_token_v2');
      if (cookie) authToUse = `Basic ${cookie}`;
    }
  }
  return authToUse;
}

function decodeMonitorAuth(authToUse) {
  if (!authToUse) return null;
  const parts = authToUse.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Basic') return null;
  try {
    const decoded = Buffer.from(parts[1], 'base64').toString();
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return {
      user: decoded.slice(0, separator),
      pass: decoded.slice(separator + 1),
      token: parts[1],
    };
  } catch (_error) {
    return null;
  }
}

function isValidMonitorAuth(req) {
  const decoded = decodeMonitorAuth(getMonitorAuth(req));
  return Boolean(decoded && decoded.user === 'admin' && decoded.pass === MONITOR_PASSWORD);
}

function monitorLoginKey(req) {
  /* The three-strike ladder hangs off this, so it reads only what a client
     cannot write. See securityKey(). */
  return securityKey(req);
}

function getMonitorLockState(req) {
  const key = monitorLoginKey(req);
  const state = monitorLoginFailures.get(key);
  if (!state) return { locked: false, remainingMs: 0, attempts: 0 };
  if (state.lockUntil && Date.now() < state.lockUntil) {
    return { locked: true, remainingMs: state.lockUntil - Date.now(), attempts: state.attempts || 0 };
  }
  if (state.lockUntil && Date.now() >= state.lockUntil) {
    monitorLoginFailures.delete(key);
  }
  return { locked: false, remainingMs: 0, attempts: state?.attempts || 0 };
}

function recordMonitorLoginFailure(req) {
  const key = monitorLoginKey(req);
  const current = monitorLoginFailures.get(key) || { attempts: 0, lockUntil: 0 };
  const attempts = current.attempts + 1;
  const lockUntil = attempts >= MONITOR_LOCK_MAX_ATTEMPTS ? Date.now() + MONITOR_LOCK_MS : 0;
  monitorLoginFailures.set(key, { attempts, lockUntil });
  return { attempts, lockUntil, locked: Boolean(lockUntil) };
}

function requestIdentity(req) {
  const decodeHeader = (val) => {
    if (!val) return '';
    try {
      return decodeURIComponent(escape(atob(val)));
    } catch (e) {
      // Fallback for older formats or plain strings
      try { return decodeURIComponent(val); } catch (e2) { return val; }
    }
  };
  return {
    fingerprint: sanitizeFingerprint(decodeHeader(req.headers['x-p00rija-fingerprint'] || req.query?.fingerprint)),
    peerId: String(decodeHeader(req.headers['x-p00rija-peer-id'] || req.query?.peerId || '')).slice(0, 160),
    clientId: String(decodeHeader(req.headers['x-p00rija-client-id'] || req.query?.clientId || '')).slice(0, 80),
    username: String(decodeHeader(req.headers['x-p00rija-username'] || '')).slice(0, 80),
    ip: String(req.ip || req.socket.remoteAddress || '').replace('::ffff:', '').slice(0, 80),
  };
}

function sendRestrictionResponse(req, res) {
  const restriction = getRestrictionForIdentity(requestIdentity(req));
  if (!restriction) return false;
  const suspendedText = 'اتصال شما با این سرور محدود شده است، لطفاً با ادمین تماس بگیرید.';
  /* Deliberately says the same thing to a stranger as to somebody removed from
     the list. Telling an uninvited caller "you are not on the list" confirms
     the relay is there and that a list exists, which is more than a closed
     door owes anybody. */
  const notAllowedText = 'این سرور فقط کاربران تأییدشده را می‌پذیرد. برای دسترسی با ادمین تماس بگیرید.';
  const kickedText = restriction.policy?.permanent
    ? 'اتصال شما با این سرور محدود شده است، لطفاً با ادمین تماس بگیرید.'
    : `اتصال شما با این سرور تا ${new Date(restriction.policy.expiresAt).toLocaleString('fa-IR')} محدود شده است، لطفاً با ادمین تماس بگیرید.`;
  res.status(403).json({
    ok: false,
    restricted: true,
    restrictionType: restriction.type,
    permanent: Boolean(restriction.policy?.permanent),
    until: restriction.policy?.expiresAt || null,
    message: restriction.type === 'not-allowed' ? notAllowedText
      : restriction.type === 'kicked' ? kickedText : suspendedText,
  });
  return true;
}

app.get('/healthz', authMiddleware, (_req, res) => {
  pruneExpiredPolicies();
  const mem = process.memoryUsage();
  const os = require('os');
  const cpus = os.cpus();
  
  // Basic CPU load calculation (1-min load avg relative to CPU cores)
  const cpuCount = cpus.length;
  const loadAvg = os.loadavg();
  const cpuLoadPercent = Math.min(100, Math.round((loadAvg[0] / cpuCount) * 100));

  const peersDetails = Array.from(presence.values()).map(p => ({
    clientId: p.clientId,
    username: p.username || `Guest ${p.guestId}`,
    ip: p.ip,
    connectedAt: p.connectedAt,
    lastSeenAt: p.lastSeenAt,
    fingerprint: p.fingerprint
  }));

  // Check storage (fallback for older node versions)
  let storage = null;
  try {
    if (fs.statfsSync) {
      const stats = fs.statfsSync('/data');
      storage = {
        total: Math.round((stats.blocks * stats.bsize) / 1024 / 1024),
        free: Math.round((stats.bfree * stats.bsize) / 1024 / 1024)
      };
    }
  } catch (_e) {}

  res.json({
    ok: true,
    service: 'poorija-chat-signal',
    peers: presence.size,
    peersList: peersDetails,
    queuedMessages: Array.from(offlineBoxes.values()).reduce((sum, box) => sum + box.length, 0),
    pushSubscribers: Array.from(pushSubscriptions.values()).reduce((sum, items) => sum + items.length, 0),
    turnEnabled: TURN_URLS.length > 0,
    traffic: {
      msgsIn: totalMessagesReceived,
      msgsOut: totalMessagesSent,
      bytesIn: totalBytesReceived,
      bytesOut: totalBytesSent,
      relays: totalRelays
    },
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
    uptime: Math.round(process.uptime()),
    sysUptime: Math.round(os.uptime()),
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    cpuUsage: process.cpuUsage(),
    cpuLoad: cpuLoadPercent,
    loadAvg: loadAvg,
    totalMem: Math.round(os.totalmem() / 1024 / 1024),
    freeMem: Math.round(os.freemem() / 1024 / 1024),
    activePorts: [PORT, PRESENCE_PORT],
    logs: serverLogs,
    storage: storage,
    suspendedUsers: listSuspensions(),
    kickedUsers: listActiveKickBans()
  });
});

app.post('/admin/login', (req, res) => {
  setNoStoreHeaders(res);
  const lock = getMonitorLockState(req);
  if (lock.locked) {
    return res.status(423).json({ ok: false, reason: 'locked', remainingMs: lock.remainingMs });
  }

  const { password } = req.body || {};
  if (password === MONITOR_PASSWORD) {
    monitorLoginFailures.delete(monitorLoginKey(req));
    const token = Buffer.from(`admin:${password}`).toString('base64');
    res.setHeader('Set-Cookie', `monitor_token_v2=${token}; Path=/; Max-Age=86400; SameSite=Strict; HttpOnly`);
    return res.json({ ok: true, token });
  }

  const failure = recordMonitorLoginFailure(req);
  res.status(failure.locked ? 423 : 401).json({
    ok: false,
    reason: failure.locked ? 'locked' : 'invalid',
    attemptsRemaining: Math.max(0, MONITOR_LOCK_MAX_ATTEMPTS - failure.attempts),
    remainingMs: failure.lockUntil ? failure.lockUntil - Date.now() : 0,
  });
});

app.post('/admin/logout', (_req, res) => {
  setNoStoreHeaders(res);
  clearMonitorAuthCookie(res);
  res.json({ ok: true });
});

app.post('/admin/kick-peer', authMiddleware, (req, res) => {
  const { clientId } = req.body;
  const permanent = Boolean(req.body?.permanent);
  const durationMinutes = permanent ? 0 : sanitizePolicyDurationMinutes(req.body?.durationMinutes, 5);
  const peer = presence.get(clientId);
  if (peer) {
    const snapshot = identitySnapshot(peer);
    const key = identityKey(snapshot);
    const expiresAt = permanent ? null : Date.now() + durationMinutes * 60 * 1000;
    if (key) {
      kickedUsers.set(key, {
        ...snapshot,
        durationMinutes,
        permanent,
        expiresAt,
        createdAt: new Date().toISOString(),
        reason: String(req.body?.reason || 'admin-kick').slice(0, 160),
      });
      savePolicyStore();
    }
    console.log(`[Admin] Kicking peer ${peer.username} (${clientId}) ${permanent ? 'permanently' : `for ${durationMinutes} minutes`}`);
    disconnectRestrictedPeer(peer, {
      type: 'kicked',
      key,
      policy: { expiresAt, permanent },
    });
    return res.json({ ok: true, expiresAt, durationMinutes, permanent });
  }
  res.status(404).json({ ok: false, reason: 'Peer not found' });
});

app.post('/admin/suspend-peer', authMiddleware, (req, res) => {
  const { clientId } = req.body;
  const durationMs = sanitizePolicyDurationMs(req.body?.durationMs, req.body?.durationMinutes, 30);
  const durationMinutes = Math.max(1, Math.ceil(durationMs / 60000));
  const peer = presence.get(clientId);
  if (!peer) return res.status(404).json({ ok: false, reason: 'Peer not found' });

  const snapshot = identitySnapshot(peer);
  const key = identityKey(snapshot);
  if (!key) return res.status(400).json({ ok: false, reason: 'Peer has no stable identity yet' });

  const policy = {
    ...snapshot,
    durationMinutes,
    durationMs,
    expiresAt: Date.now() + durationMs,
    createdAt: new Date().toISOString(),
    reason: String(req.body?.reason || 'admin-suspension').slice(0, 160),
  };
  suspendedUsers.set(key, policy);
  savePolicyStore();
  console.log(`[Admin] Suspended peer ${peer.username} (${clientId})`);
  if (policy.fingerprint) {
    sendAdminPushNotification(
      policy.fingerprint,
      'دسترسی شما در سرور به حالت تعلیق درآمده است. برای رفع تعلیق با ادمین سرور تماس بگیرید.',
      'suspended'
    ).catch((error) => console.error(error));
  }
  disconnectRestrictedPeer(peer, { type: 'suspended', key, policy });
  res.json({ ok: true, key, policy, expiresAt: policy.expiresAt, durationMinutes });
});

app.post('/admin/resume-peer', authMiddleware, (req, res) => {
  const directKey = String(req.body?.key || '').trim();
  let deletedCount = 0;
  
  if (directKey && suspendedUsers.has(directKey)) {
    const basePolicy = suspendedUsers.get(directKey);
    const identity = {
      fingerprint: basePolicy.fingerprint,
      peerId: basePolicy.peerId,
      username: basePolicy.username,
      ip: basePolicy.ip
    };

    for (const [key, policy] of suspendedUsers.entries()) {
      if (identityMatchesPolicy(identity, policy)) {
        suspendedUsers.delete(key);
        deletedCount++;
      }
    }
  }

  if (deletedCount > 0) {
    savePolicyStore();
    console.log(`[Admin] Resumed user (deleted ${deletedCount} policy entries)`);
    return res.json({ ok: true, deletedCount });
  }
  
  res.status(404).json({ ok: false, reason: 'Suspended user not found' });
});

/* ---- admission by invitation ------------------------------------------
 *
 * Three calls: turn the door on or off, put somebody through it, take them
 * back out. Keyed on the identity fingerprint, so a new key is a new stranger
 * rather than a way around the list.
 */
app.get('/admin/allowlist', authMiddleware, (_req, res) => {
  res.json({
    ok: true,
    enabled: allowlistEnabled,
    users: Array.from(allowedUsers.entries()).map(([fingerprint, entry]) => ({ fingerprint, ...entry })),
  });
});

app.post('/admin/allowlist-mode', authMiddleware, (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  /* Turning the door on with nobody behind it locks the admin out of their own
     relay along with everyone else, and the way back in is a text editor on
     the server. Refuse, and say which call to make first. */
  if (enabled && allowedUsers.size === 0) {
    return res.status(400).json({
      ok: false,
      reason: 'The allowlist is empty. Add at least one fingerprint through /admin/allowlist-add first, or this closes the door on everyone including you.',
    });
  }
  allowlistEnabled = enabled;
  savePolicyStore();
  console.log(`[Admin] Allowlist ${enabled ? 'enabled' : 'disabled'} (${allowedUsers.size} allowed)`);
  res.json({ ok: true, enabled: allowlistEnabled, allowed: allowedUsers.size });
});

app.post('/admin/allowlist-add', authMiddleware, (req, res) => {
  const fingerprint = sanitizeFingerprint(String(req.body?.fingerprint || '').trim());
  if (!fingerprint) return res.status(400).json({ ok: false, reason: 'A fingerprint is required.' });
  allowedUsers.set(fingerprint, {
    label: String(req.body?.label || '').slice(0, 80),
    addedAt: Date.now(),
  });
  savePolicyStore();
  console.log(`[Admin] Allowed ${fingerprint.slice(0, 12)} (${allowedUsers.size} on the list)`);
  res.json({ ok: true, fingerprint, allowed: allowedUsers.size });
});

app.post('/admin/allowlist-remove', authMiddleware, (req, res) => {
  const fingerprint = sanitizeFingerprint(String(req.body?.fingerprint || '').trim());
  if (!allowedUsers.has(fingerprint)) {
    return res.status(404).json({ ok: false, reason: 'That fingerprint is not on the list.' });
  }
  allowedUsers.delete(fingerprint);
  savePolicyStore();
  /* Removing somebody from the list bars their NEXT connection, not the one
     they are holding. Hang that up too, so "revoke" means now rather than
     whenever they next reconnect. */
  let disconnected = 0;
  for (const peer of presence.values()) {
    if (sanitizeFingerprint(identitySnapshot(peer)?.fingerprint || '') !== fingerprint) continue;
    disconnectRestrictedPeer(peer, { type: 'not-allowed', key: fingerprint, policy: { permanent: true } });
    disconnected += 1;
  }
  console.log(`[Admin] Removed ${fingerprint.slice(0, 12)} from the allowlist`);
  res.json({ ok: true, fingerprint, allowed: allowedUsers.size, disconnected });
});

app.post('/admin/unkick-peer', authMiddleware, (req, res) => {
  const directKey = String(req.body?.key || '').trim();
  let deletedCount = 0;
  
  if (directKey && kickedUsers.has(directKey)) {
    const basePolicy = kickedUsers.get(directKey);
    const identity = {
      fingerprint: basePolicy.fingerprint,
      peerId: basePolicy.peerId,
      username: basePolicy.username,
      ip: basePolicy.ip
    };

    for (const [key, policy] of kickedUsers.entries()) {
      if (identityMatchesPolicy(identity, policy)) {
        kickedUsers.delete(key);
        deletedCount++;
      }
    }
  }

  if (deletedCount > 0) {
    savePolicyStore();
    console.log(`[Admin] Removed kicked user (deleted ${deletedCount} policy entries)`);
    return res.json({ ok: true, deletedCount });
  }
  
  res.status(404).json({ ok: false, reason: 'Kicked user not found' });
});

app.post('/admin/broadcast', authMiddleware, (req, res) => {
  const { message, fileData, fileName, kind, targetClientId, targetFingerprint } = req.body;
  if (!message && !fileData) return res.status(400).json({ ok: false, reason: 'Content required' });
  
  console.log(`[Admin] Broadcasting ${kind || 'message'}: ${message || fileName}`);
  const payload = JSON.stringify({
    type: 'system-broadcast',
    message,
    fileData,
    fileName,
    kind: kind || 'text',
    timestamp: Date.now()
  });

  let sentCount = 0;
  const targetFingerprintClean = sanitizeFingerprint(targetFingerprint);
  for (const client of presence.values()) {
    if (targetClientId && client.clientId !== targetClientId) continue;
    if (targetFingerprintClean && client.fingerprint !== targetFingerprintClean) continue;
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
      sentCount++;
    }
  }
  res.json({ ok: true, sentTo: sentCount });
});

app.post('/admin/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  
  if (oldPassword && oldPassword !== MONITOR_PASSWORD) {
    return res.status(403).json({ ok: false, reason: 'Old password incorrect' });
  }

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ ok: false, reason: 'Password too short' });
  }
  
  MONITOR_PASSWORD = newPassword;
  saveServerConfig();
  console.log('[Admin] Monitor password changed and persisted successfully.');
  res.json({ ok: true });
});

app.post('/admin/clear-offline', authMiddleware, (req, res) => {
  const count = offlineBoxes.size;
  offlineBoxes.clear();
  saveOfflineBoxes();
  console.log(`[Admin] Cleared ${count} offline message boxes.`);
  res.json({ ok: true, cleared: count });
});

app.post('/admin/optimize-ram', authMiddleware, (req, res) => {
  const before = process.memoryUsage().heapUsed;
  if (global.gc) {
    global.gc();
  }
  const after = process.memoryUsage().heapUsed;
  console.log(`[Admin] RAM Optimization triggered. Heap: ${Math.round(before/1024/1024)}MB -> ${Math.round(after/1024/1024)}MB`);
  res.json({ ok: true, gcTriggered: Boolean(global.gc), saved: Math.round((before - after)/1024/1024) });
});

app.post('/admin/clear-memory', authMiddleware, (req, res) => {
  // Clear dead presence records and trigger GC if available
  const now = Date.now();
  let cleared = 0;
  for (const [clientId, record] of presence.entries()) {
    const isExpired = now - (record.lastSeenAt || 0) > PRESENCE_TTL_MS;
    const isClosed = !record.ws || record.ws.readyState !== 1; // 1 is WebSocket.OPEN

    if (isExpired || isClosed) {
      console.log(`[Admin] Cleaning up ${clientId} (expired: ${isExpired}, closed: ${isClosed})`);
      try {
        if (record.ws) record.ws.terminate();
      } catch (_e) {}
      presence.delete(clientId);
      cleared++;
    }
  }

  // Also clear any disconnected PeerServer clients if accessible
  // (peerServer doesn't expose a simple clear, but usually cleans itself)

  if (global.gc) {
    global.gc();
  }

  res.json({ ok: true, clearedPresence: cleared, gcTriggered: Boolean(global.gc) });
});

app.get('/Monitor_Server', (req, res) => {
  setNoStoreHeaders(res);
  const authToUse = getMonitorAuth(req);
  const authenticated = isValidMonitorAuth(req);

  if (req.query && req.query.auth && authenticated) {
    res.setHeader('Set-Cookie', `monitor_token_v2=${req.query.auth}; Path=/; Max-Age=86400; SameSite=Strict; HttpOnly`);
    return res.redirect('/Monitor_Server');
  }

  const host = req.get('host') || 'localhost';

  if (!authenticated) {
    clearMonitorAuthCookie(res);
    return res.send(`
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>P00RIJA Monitor - Login</title>
    <script src="/vendor/tailwind/tailwindcdn.js"></script>
    <link href="/vendor/fontawesome/css/all.min.css" rel="stylesheet">
    <style>
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #020617; color: white; }
        .glow { position: absolute; width: 600px; height: 600px; background: radial-gradient(circle, rgba(14, 165, 233, 0.1) 0%, transparent 70%); border-radius: 50%; z-index: -1; }
        .glass { background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); border-radius: 32px; }
        .btn-sky { background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .btn-sky:hover { transform: translateY(-2px); box-shadow: 0 15px 30px -5px rgba(14, 165, 233, 0.4); }
        .ltr { direction: ltr; }
        @keyframes float { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-10px) scale(1.02); } }
        .animate-float { animation: float 5s ease-in-out infinite; }
    </style>
</head>
<body class="flex items-center justify-center min-h-screen p-4">
    <div class="glow top-[-15%] left-[-15%]"></div>
    <div class="glow bottom-[-15%] right-[-15%]"></div>
    
    <div class="glass p-10 w-full max-w-md mx-4 shadow-2xl animate-float border-sky-500/20">
        <div class="text-center mb-10">
            <div class="inline-flex items-center justify-center w-24 h-24 bg-sky-500/10 rounded-3xl mb-6 border border-sky-500/30 shadow-[0_0_50px_rgba(14,165,233,0.2)]">
                <i class="fas fa-server text-5xl text-sky-400"></i>
            </div>
            <h1 class="text-3xl font-black tracking-tight text-white mb-2">داشبورد مدیریت</h1>
            <p class="text-slate-400 font-bold opacity-80">P00RIJA Cryptography Relay Server</p>
        </div>

        <div class="space-y-6">
            <div>
                <label class="block text-xs font-black text-slate-400 mb-3 mr-1 uppercase tracking-widest">گذرواژه مدیریت</label>
                <div class="relative">
                    <span class="absolute inset-y-0 right-0 flex items-center pr-5 text-slate-500">
                        <i class="fas fa-lock"></i>
                    </span>
                    <input type="password" id="passInput" class="w-full bg-slate-900/80 border border-slate-700/50 rounded-2xl py-4 pr-12 pl-12 focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none transition-all placeholder-slate-600 text-center ltr font-black text-lg" placeholder="••••••••">
                    <button onclick="toggleLoginPass()" class="absolute inset-y-0 left-0 flex items-center pl-5 text-slate-500 hover:text-sky-400 transition-colors">
                        <i id="loginPassIcon" class="fas fa-eye"></i>
                    </button>
                </div>
            </div>

            <button onclick="doLogin()" class="w-full btn-sky text-white font-black py-4 rounded-2xl shadow-lg flex items-center justify-center gap-3 text-lg">
                <span>ورود ایمن به سامانه</span>
                <i class="fas fa-arrow-left"></i>
            </button>
            
            <div id="error" class="hidden text-rose-400 text-center text-sm font-bold bg-rose-500/10 py-3 rounded-xl border border-rose-500/20">
                گذرواژه اشتباه است. مجدداً تلاش کنید.
            </div>
            <div id="lockNotice" class="hidden text-amber-300 text-center text-sm font-bold bg-amber-500/10 py-3 rounded-xl border border-amber-500/20"></div>
        </div>

        <div class="mt-10 pt-8 border-t border-slate-700/50 text-center">
            <span class="text-[10px] text-slate-500 uppercase tracking-[0.3em] font-black">Protected by P00RIJA Suite</span>
        </div>
    </div>

    <script>
        function toggleLoginPass() {
            const input = document.getElementById('passInput');
            const icon = document.getElementById('loginPassIcon');
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        }
        function clearAuthState() {
            localStorage.removeItem('monitor_token_v2');
            document.cookie = "monitor_token_v2=; path=/; Max-Age=0; SameSite=Strict";
            document.cookie = "monitor_token_v2=; path=/Monitor_Server; Max-Age=0; SameSite=Strict";
        }
        function setAuthCookie(auth) {
            document.cookie = "monitor_token_v2=" + auth + "; path=/; max-age=86400; SameSite=Strict";
        }
        function formatLock(ms) {
            const total = Math.max(0, Math.ceil(ms / 1000));
            const min = Math.floor(total / 60);
            const sec = String(total % 60).padStart(2, '0');
            return min + ':' + sec;
        }
        function showLock(ms) {
            const notice = document.getElementById('lockNotice');
            const button = document.querySelector('button[onclick="doLogin()"]');
            notice.classList.remove('hidden');
            button.disabled = true;
            button.classList.add('opacity-60', 'cursor-not-allowed');
            const end = Date.now() + ms;
            const tick = () => {
                const remaining = end - Date.now();
                if (remaining <= 0) {
                    notice.classList.add('hidden');
                    button.disabled = false;
                    button.classList.remove('opacity-60', 'cursor-not-allowed');
                    return;
                }
                notice.textContent = 'به علت ۳ تلاش ناموفق، ورود تا ' + formatLock(remaining) + ' قفل شد.';
                setTimeout(tick, 1000);
            };
            tick();
        }
        function doLogin() {
            const pass = document.getElementById('passInput').value;
            if (!pass) return;
            fetch('/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({ password: pass })
            }).then(async r => {
                const data = await r.json().catch(() => ({}));
                if (r.ok && data.token) {
                    localStorage.setItem('monitor_token_v2', data.token);
                    window.location.replace('/Monitor_Server?auth=' + encodeURIComponent(data.token));
                } else if (r.status === 423) {
                    clearAuthState();
                    document.getElementById('error').classList.add('hidden');
                    showLock(data.remainingMs || 600000);
                } else {
                    clearAuthState();
                    const remaining = Number(data.attemptsRemaining || 0);
                    const error = document.getElementById('error');
                    error.textContent = remaining > 0
                        ? 'گذرواژه اشتباه است. تعداد تلاش باقی‌مانده: ' + remaining
                        : 'گذرواژه اشتباه است. مجدداً تلاش کنید.';
                    error.classList.remove('hidden');
                }
            });
        }
        document.getElementById('passInput').onkeypress = (e) => { if(e.key === 'Enter') doLogin(); };
        const saved = localStorage.getItem('monitor_token_v2');
        if(saved) {
             fetch('/healthz', { cache: 'no-store', headers: { 'Authorization': 'Basic ' + saved } }).then(r => {
                if(r.ok) {
                    window.location.replace('/Monitor_Server?auth=' + encodeURIComponent(saved));
                }
                else clearAuthState();
             }).catch(clearAuthState);
        }
    </script>
</body>
</html>
    `);
  }

  const userPass = decodeMonitorAuth(authToUse);
  if (!userPass || userPass.user !== 'admin' || userPass.pass !== MONITOR_PASSWORD) {
    return res.status(401).send('Invalid credentials');
  }

  res.send(`
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>P00RIJÃ Signal Monitor | داشبورد حرفه‌ای مدیریت</title>
    <script src="/vendor/tailwind/tailwindcdn.js"></script>
    <link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css">
    <script>
      window.Chart = window.Chart || class {
        constructor(ctx, config) {
          this.ctx = ctx;
          this.canvas = ctx.canvas;
          this.type = config && config.type || 'line';
          this.data = config && config.data || { labels: [], datasets: [] };
          this.options = config && config.options || {};
          this.update();
        }
        resize() {
          const parent = this.canvas.parentElement;
          const width = Math.max(320, parent ? parent.clientWidth : this.canvas.clientWidth || 320);
          const height = Math.max(180, parent ? parent.clientHeight : this.canvas.clientHeight || 220);
          const ratio = window.devicePixelRatio || 1;
          if (this.canvas.width !== Math.floor(width * ratio) || this.canvas.height !== Math.floor(height * ratio)) {
            this.canvas.width = Math.floor(width * ratio);
            this.canvas.height = Math.floor(height * ratio);
            this.canvas.style.width = width + 'px';
            this.canvas.style.height = height + 'px';
            this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          }
          return { width, height };
        }
        update() {
          const size = this.resize();
          const ctx = this.ctx;
          const width = size.width;
          const height = size.height;
          const pad = { left: 34, right: 12, top: 14, bottom: 24 };
          const plotW = Math.max(1, width - pad.left - pad.right);
          const plotH = Math.max(1, height - pad.top - pad.bottom);
          const labels = this.data.labels || [];
          const datasets = this.data.datasets || [];
          const allValues = datasets.flatMap(function (set) { return (set.data || []).map(Number).filter(Number.isFinite); });
          const suggestedMax = this.options && this.options.scales && this.options.scales.y && this.options.scales.y.suggestedMax || 100;
          const maxValue = Math.max(suggestedMax, 1, allValues.length ? Math.max.apply(null, allValues) : 0);
          ctx.clearRect(0, 0, width, height);
          ctx.fillStyle = 'rgba(15,23,42,0.08)';
          ctx.fillRect(0, 0, width, height);
          ctx.strokeStyle = 'rgba(148,163,184,0.12)';
          ctx.lineWidth = 1;
          ctx.font = '10px system-ui, sans-serif';
          ctx.fillStyle = '#64748b';
          for (let i = 0; i <= 4; i++) {
            const y = pad.top + (plotH * i / 4);
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(width - pad.right, y);
            ctx.stroke();
            const value = Math.round(maxValue - (maxValue * i / 4));
            ctx.fillText(String(value), 4, y + 3);
          }
          datasets.forEach(function (set) {
            const values = (set.data || []).map(Number);
            const color = set.borderColor || '#38bdf8';
            if (values.length < 2) return;
            ctx.beginPath();
            values.forEach(function (value, index) {
              const x = pad.left + (values.length === 1 ? 0 : plotW * index / (values.length - 1));
              const y = pad.top + plotH - ((Number.isFinite(value) ? value : 0) / maxValue) * plotH;
              if (index === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.strokeStyle = color;
            ctx.lineWidth = set.borderWidth || 2;
            ctx.stroke();
            const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
            gradient.addColorStop(0, color + '33');
            gradient.addColorStop(1, color + '00');
            ctx.lineTo(width - pad.right, height - pad.bottom);
            ctx.lineTo(pad.left, height - pad.bottom);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();
          });
          if (labels.length) {
            ctx.fillStyle = '#64748b';
            ctx.fillText(String(labels[0]), pad.left, height - 6);
            ctx.textAlign = 'right';
            ctx.fillText(String(labels[labels.length - 1]), width - pad.right, height - 6);
            ctx.textAlign = 'left';
          }
        }
        destroy() {}
      };
    </script>
    <style>
        body { 
            background: #020617; 
            color: #f8fafc; 
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            min-height: 100vh;
            background-image: 
                radial-gradient(at 0% 0%, rgba(14, 165, 233, 0.15) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(99, 102, 241, 0.15) 0px, transparent 50%);
            overflow-x: hidden;
        }
        .glass { 
            background: rgba(15, 23, 42, 0.6); 
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 24px;
        }
        .stat-card {
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .stat-card:hover {
            transform: translateY(-5px);
            background: rgba(30, 41, 59, 0.7);
            border-color: rgba(56, 189, 248, 0.4);
            box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
        }
        .stat-value { 
            font-size: 2.5rem; 
            font-weight: 900; 
            background: linear-gradient(135deg, #fff 30%, #38bdf8 100%); 
            -webkit-background-clip: text; 
            -webkit-text-fill-color: transparent; 
            letter-spacing: -1px;
        }
        .port-tag {
            background: linear-gradient(90deg, #334155, #1e293b);
            padding: 2px 10px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 11px;
            color: #38bdf8;
            border: 1px solid rgba(56, 189, 248, 0.2);
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #334155; }
        
        .log-entry { border-left: 3px solid transparent; transition: all 0.2s; }
        .log-info { border-left-color: #38bdf8; background: rgba(56, 189, 248, 0.03); }
        .log-warn { border-left-color: #fbbf24; background: rgba(251, 191, 36, 0.03); }
        .log-error { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.03); }

        .peer-row:hover { background: rgba(255,255,255,0.03); }
    </style>
</head>
<body class="p-4 md:p-8">
    <div class="max-w-[1600px] mx-auto">
        <!-- Header -->
        <header class="flex flex-col xl:flex-row justify-between items-center mb-10 gap-8">
            <div class="flex items-center gap-6">
                <div class="w-16 h-16 glass flex items-center justify-center text-sky-400 text-3xl shadow-2xl border-sky-500/30 relative">
                    <i class="fas fa-shield-halved"></i>
                    <span class="absolute -top-1 -right-1 flex h-4 w-4">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-4 w-4 bg-sky-500"></span>
                    </span>
                </div>
                <div>
                    <h1 class="text-4xl font-black text-white tracking-tight">P00RIJÃ <span class="text-sky-400">Signal Monitor</span></h1>
                    <p class="text-slate-400 text-sm font-bold opacity-80 mt-1">سامانه متمرکز پایش و کنترل زیرساخت‌های رمزنگاری</p>
                </div>
            </div>
            
            <div class="flex flex-wrap items-center justify-center gap-4">
                <div class="flex items-center gap-3 glass px-5 py-3 text-sm font-black">
                    <span class="text-slate-500">به‌روزرسانی:</span>
                    <select id="refreshInterval" class="bg-transparent border-none outline-none text-sky-400 cursor-pointer font-bold">
                        <option value="1000">۱ ثانیه</option>
                        <option value="2000" selected>۲ ثانیه</option>
                        <option value="5000">۵ ثانیه</option>
                    </select>
                </div>
                <div class="flex gap-2">
                    <button onclick="togglePasswordModal()" class="glass px-5 py-3 hover:bg-sky-500/10 transition-all font-black text-sm border-sky-500/20 group">
                        <i class="fas fa-lock ml-2 text-sky-400 group-hover:rotate-12 transition-transform"></i>امنیت
                    </button>
                    <button onclick="optimizeRAM()" class="glass px-5 py-3 hover:bg-emerald-500/10 transition-all font-black text-sm border-emerald-500/20 text-emerald-400 group">
                        <i class="fas fa-microchip ml-2 group-hover:scale-125 transition-transform"></i>بهینه‌ساز RAM
                    </button>
                    <button onclick="clearMemory()" class="glass px-5 py-3 hover:bg-amber-500/10 transition-all font-black text-sm border-amber-500/20 text-amber-400 group">
                        <i class="fas fa-bolt ml-2 group-hover:scale-125 transition-transform"></i>پاکسازی اتصالات
                    </button>
                    <button onclick="logout()" class="glass px-5 py-3 hover:bg-rose-500/10 transition-all font-black text-sm border-rose-500/20 text-rose-400 group">
                        <i class="fas fa-power-off ml-2 group-hover:text-rose-500 transition-colors"></i>خروج
                    </button>
                </div>
                <div id="statusIndicator" class="flex items-center gap-3 text-sm font-black glass px-6 py-3 border-green-500/30">
                   <span class="w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-[0_0_15px_rgba(34,197,94,0.8)]"></span> عملیاتی
                </div>
            </div>
        </header>

        <!-- Main Stats Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
            <div class="glass p-6 stat-card relative overflow-hidden">
                <div class="absolute -right-4 -top-4 text-sky-500/5 text-6xl rotate-12"><i class="fas fa-users"></i></div>
                <p class="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-3">کاربران متصل</p>
                <div id="statPeers" class="text-4xl font-black text-white">--</div>
                <div class="flex items-center gap-2 mt-4">
                    <div class="port-tag">PORT: ${PRESENCE_PORT}</div>
                </div>
            </div>
            <div class="glass p-6 stat-card relative overflow-hidden">
                <div class="absolute -right-4 -top-4 text-indigo-500/5 text-6xl rotate-12"><i class="fas fa-microchip"></i></div>
                <p class="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-3">بار سیستم (CPU)</p>
                <div id="statCpu" class="text-4xl font-black text-white">--</div>
                <div class="w-full bg-slate-800/50 h-1.5 rounded-full mt-4 overflow-hidden">
                    <div id="cpuBar" class="bg-gradient-to-r from-sky-500 to-indigo-400 h-full transition-all duration-700" style="width: 0%"></div>
                </div>
            </div>
            <div class="glass p-6 stat-card relative overflow-hidden">
                <div class="absolute -right-4 -top-4 text-indigo-500/5 text-6xl rotate-12"><i class="fas fa-memory"></i></div>
                <p class="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-3">حافظه (RAM)</p>
                <div id="statMemory" class="text-4xl font-black text-white">--</div>
                <div class="w-full bg-slate-800/50 h-1.5 rounded-full mt-4 overflow-hidden">
                    <div id="memoryBar" class="bg-gradient-to-r from-indigo-500 to-sky-400 h-full transition-all duration-700" style="width: 0%"></div>
                </div>
            </div>
            <div class="glass p-6 stat-card relative overflow-hidden">
                <div class="absolute -right-4 -top-4 text-emerald-500/5 text-6xl rotate-12"><i class="fas fa-database"></i></div>
                <p class="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-3">ذخیره‌سازی (Disk)</p>
                <div id="statStorage" class="text-4xl font-black text-white">--</div>
                <div class="w-full bg-slate-800/50 h-1.5 rounded-full mt-4 overflow-hidden">
                    <div id="storageBar" class="bg-gradient-to-r from-emerald-500 to-sky-400 h-full transition-all duration-700" style="width: 0%"></div>
                </div>
            </div>
            <div class="glass p-6 stat-card relative overflow-hidden border-sky-500/10">
                <div class="absolute -right-4 -top-4 text-sky-500/5 text-6xl rotate-12"><i class="fas fa-signal"></i></div>
                <p class="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-3">تأخیر شبکه (Ping)</p>
                <div id="statPing" class="text-4xl font-black text-sky-400 mt-2 tracking-tighter">-- <span class="text-sm">ms</span></div>
                <p class="text-[9px] text-slate-500 mt-5 font-bold">پایداری اتصال مدیریت</p>
            </div>
        </div>

        <!-- Charts Section -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div class="glass p-8 lg:col-span-1">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">تحلیل حافظه (RAM)</h3>
                    <span class="text-[10px] text-sky-400 font-black px-2 py-1 bg-sky-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="h-[250px]">
                    <canvas id="memoryChart"></canvas>
                </div>
            </div>
            <div class="glass p-8 lg:col-span-1">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">بار پردازشی (CPU)</h3>
                    <span class="text-[10px] text-indigo-400 font-black px-2 py-1 bg-indigo-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="h-[250px]">
                    <canvas id="cpuChart"></canvas>
                </div>
            </div>
            <div class="glass p-8 lg:col-span-1">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">کاربران در حالت تعلیق</h3>
                    <span class="text-[10px] text-amber-400 font-black px-2 py-1 bg-amber-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="h-[250px]">
                    <canvas id="suspendedChart"></canvas>
                </div>
            </div>
        </div>

        <!-- New Row of Charts -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div class="glass p-8">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">ترافیک شبکه (I/O)</h3>
                    <span class="text-[10px] text-sky-400 font-black px-2 py-1 bg-sky-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="h-[250px]">
                    <canvas id="networkChart"></canvas>
                </div>
            </div>
            <div class="glass p-8">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">پردازش پیام‌ها</h3>
                    <span class="text-[10px] text-amber-400 font-black px-2 py-1 bg-amber-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="h-[250px]">
                    <canvas id="throughputChart"></canvas>
                </div>
            </div>
        </div>

        <!-- System Health and Queue Charts -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div class="glass p-8">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">مصرف فضای ذخیره‌سازی</h3>
                    <span class="text-[10px] text-emerald-400 font-black px-2 py-1 bg-emerald-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="h-[250px]">
                    <canvas id="storageChart"></canvas>
                </div>
            </div>
            <div class="glass p-8">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">صف پیام‌های آفلاین</h3>
                    <div class="flex gap-2">
                         <button onclick="clearOfflineQueue()" class="text-[10px] text-rose-400 font-black px-2 py-1 bg-rose-500/10 rounded-lg hover:bg-rose-500/20 transition-all">پاکسازی کل صف</button>
                         <button onclick="clearErrorQueue()" class="text-[10px] text-amber-400 font-black px-2 py-1 bg-amber-500/10 rounded-lg hover:bg-amber-500/20 transition-all">پاکسازی پیام‌های خطادار</button>
                         <span class="text-[10px] text-rose-400 font-black px-2 py-1 bg-rose-500/10 rounded-lg">LIVE</span>
                    </div>
                </div>
                <div class="h-[250px]">
                    <canvas id="queueChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Middle Section: Peers and Logs -->
        <div class="grid grid-cols-1 xl:grid-cols-4 gap-6 mb-8">
            <!-- Peers Table -->
            <div class="glass p-8 xl:col-span-2 overflow-hidden flex flex-col">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-xl font-black text-white flex items-center gap-3">
                        <i class="fas fa-network-wired text-sky-500"></i>
                        کاربران متصل
                    </h3>
                </div>
                <div class="overflow-x-auto flex-grow custom-scrollbar">
                    <table class="w-full text-right">
                        <thead>
                            <tr class="text-slate-500 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                                <th class="pb-4 pr-4">نام کاربری</th>
                                <th class="pb-4">آدرس IP</th>
                                <th class="pb-4">مدت</th>
                                <th class="pb-4 text-left pl-4">عملیات</th>
                            </tr>
                        </thead>
                        <tbody id="peerTableBody" class="text-xs">
                            <!-- Peers injected here -->
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Broadcast and Logs -->
            <div class="xl:col-span-2 grid grid-cols-1 gap-6">
                <div class="glass p-8">
                    <h3 class="text-xl font-black text-white mb-6 flex items-center gap-3">
                        <i class="fas fa-bullhorn text-sky-500"></i>
                        ارسال اعلان سیستمی (Broadcast)
                    </h3>
                    <div class="space-y-4">
                        <select id="broadcastTarget" class="w-full bg-slate-800/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-sky-500 transition-all font-bold text-white text-sm">
                            <option value="">همه کاربران متصل</option>
                        </select>
                        <div class="flex gap-4">
                            <input type="text" id="broadcastMsg" class="flex-grow bg-slate-800/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-sky-500 transition-all font-bold text-white text-sm" placeholder="متن پیام برای تمام کاربران...">
                            <button onclick="sendBroadcast()" class="bg-sky-500 hover:bg-sky-600 text-white font-black px-6 py-3 rounded-xl transition-all shadow-lg shadow-sky-500/20">ارسال</button>
                        </div>
                        <div class="flex items-center gap-4">
                            <div class="flex-grow flex items-center gap-2 bg-slate-800/50 border border-white/10 rounded-xl px-4 py-2">
                                <i class="fas fa-paperclip text-slate-500"></i>
                                <input type="file" id="broadcastFile" class="hidden" onchange="updateFileLabel()">
                                <label for="broadcastFile" id="fileLabel" class="text-xs text-slate-400 cursor-pointer hover:text-sky-400 truncate">انتخاب فایل یا صدا...</label>
                            </div>
                            <button onclick="clearFile()" class="text-slate-500 hover:text-rose-500 transition-colors"><i class="fas fa-times"></i></button>
                        </div>
                    </div>
                </div>
                <div class="glass p-8 flex flex-col h-[300px]">
                    <div class="flex justify-between items-center mb-6">
                        <h3 class="text-xl font-black text-white flex items-center gap-3">
                            <i class="fas fa-terminal text-sky-500"></i>
                            گزارشات زنده
                        </h3>
                        <div class="flex items-center gap-4">
                             <div class="flex items-center gap-2 bg-white/5 px-2 py-1 rounded-lg border border-white/5">
                                 <button onclick="prevLogPage()" id="prevLogBtn" class="text-slate-400 hover:text-sky-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                                     <i class="fas fa-chevron-right text-[10px]"></i>
                                 </button>
                                 <span id="logPageIndicator" class="text-[10px] font-black text-white min-w-[60px] text-center">صفحه ۱</span>
                                 <button onclick="nextLogPage()" id="nextLogBtn" class="text-slate-400 hover:text-sky-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                                     <i class="fas fa-chevron-left text-[10px]"></i>
                                 </button>
                             </div>
                             <div class="flex gap-2">
                                 <button onclick="downloadLogs()" class="text-[10px] font-black text-sky-400 hover:text-sky-300 transition-colors">
                                     <i class="fas fa-download ml-1"></i>دریافت فایل
                                 </button>
                                 <button onclick="clearLogs()" class="text-[10px] font-black text-rose-500 hover:text-rose-400 transition-colors">
                                     <i class="fas fa-trash ml-1"></i>پاکسازی
                                 </button>
                             </div>
                        </div>
                    </div>
                    <div id="logContainer" class="flex-grow overflow-y-auto space-y-2 pr-2 text-[10px] font-mono custom-scrollbar">
                        <!-- Logs injected here -->
                    </div>
                </div>
            </div>
        </div>

        <div class="glass p-8 mb-8">
            <div class="flex justify-between items-center mb-6">
                <h3 class="text-xl font-black text-white flex items-center gap-3">
                    <i class="fas fa-user-clock text-amber-500"></i>
                    کاربران در حالت تعلیق
                </h3>
                <span id="suspendedCount" class="text-[10px] text-amber-300 font-black px-3 py-1 bg-amber-500/10 rounded-lg">۰ کاربر</span>
            </div>
            <div class="overflow-x-auto custom-scrollbar">
                <table class="w-full text-right">
                    <thead>
                        <tr class="text-slate-500 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                            <th class="pb-4 pr-4">کاربر</th>
                            <th class="pb-4">اثر انگشت / IP</th>
                            <th class="pb-4">زمان تعلیق</th>
                            <th class="pb-4 text-left pl-4">عملیات</th>
                        </tr>
                    </thead>
                    <tbody id="suspendedTableBody" class="text-xs"></tbody>
                </table>
            </div>
        </div>

        <div class="glass p-8 mb-8">
            <div class="flex justify-between items-center mb-6">
                <h3 class="text-xl font-black text-white flex items-center gap-3">
                    <i class="fas fa-user-slash text-rose-500"></i>
                    کاربران اخراج شده
                </h3>
                <span id="kickedCount" class="text-[10px] text-rose-300 font-black px-3 py-1 bg-rose-500/10 rounded-lg">۰ کاربر</span>
            </div>
            <div class="overflow-x-auto custom-scrollbar">
                <table class="w-full text-right">
                    <thead>
                        <tr class="text-slate-500 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                            <th class="pb-4 pr-4">کاربر</th>
                            <th class="pb-4">اثر انگشت / IP</th>
                            <th class="pb-4">مدت اخراج</th>
                            <th class="pb-4 text-left pl-4">عملیات</th>
                        </tr>
                    </thead>
                    <tbody id="kickedTableBody" class="text-xs"></tbody>
                </table>
            </div>
        </div>

        <!-- System Details Footer -->
        <div class="glass p-8 relative border-white/5 overflow-hidden">
             <div class="absolute -left-20 -bottom-20 w-64 h-64 bg-sky-500/5 rounded-full blur-3xl"></div>
             <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 relative z-10">
                <div class="space-y-4">
                    <div class="flex flex-col">
                        <span class="text-slate-500 text-[10px] font-black mb-1 uppercase tracking-widest">سیستم عامل میزبان</span>
                        <span id="sysPlatform" class="font-black text-white text-sm">--</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-slate-500 text-[10px] font-black mb-1 uppercase tracking-widest">محیط Node.js</span>
                        <span id="sysNode" class="font-black text-sky-400 font-mono text-base">--</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-slate-500 text-[10px] font-black mb-1 uppercase tracking-widest">مدت زمان فعالیت (Uptime)</span>
                        <span id="sysUptimeDisplay" class="font-black text-white text-sm">--</span>
                    </div>
                </div>
                <div class="space-y-4">
                    <div class="flex flex-col">
                        <span class="text-slate-500 text-[10px] font-black mb-1 uppercase tracking-widest">پورت‌های عملیاتی</span>
                        <div class="flex gap-2 mt-1">
                            <span class="port-tag">API: ${PORT}</span>
                            <span class="port-tag">WS: ${PRESENCE_PORT}</span>
                        </div>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-slate-500 text-[10px] font-black mb-1 uppercase tracking-widest">وضعیت TURN Relay</span>
                        <span id="sysTurn" class="font-black text-sm">--</span>
                    </div>
                </div>
                <div class="space-y-4">
                    <div class="flex flex-col">
                        <span class="text-slate-500 text-[10px] font-black mb-1 uppercase tracking-widest">دامنه متصل</span>
                        <span class="font-black text-indigo-400 text-sm truncate">${host}</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-slate-500 text-[10px] font-black mb-1 uppercase tracking-widest">حافظه کل سیستم</span>
                        <span id="sysTotalMem" class="font-black text-white text-sm">--</span>
                    </div>
                </div>
                <div class="flex flex-col items-center justify-center border-r border-white/5 pr-6">
                    <p class="text-[10px] text-slate-500 mb-2 font-black">آخرین واکشی اطلاعات</p>
                    <div id="lastUpdated" class="text-2xl font-black font-mono text-white tracking-tighter">--</div>
                    <div class="text-[9px] text-sky-500 mt-2 font-bold bg-sky-500/10 px-4 py-1.5 rounded-full border border-sky-500/20">SYNCHRONIZED</div>
                </div>
             </div>
        </div>

        <footer class="mt-12 text-center pb-10">
            <div class="w-16 h-1 bg-gradient-to-r from-transparent via-sky-500 to-transparent mx-auto mb-6"></div>
            <p class="text-slate-500 text-[10px] font-black uppercase tracking-[0.4em]">P00RIJÃ Cryptography Signaling Infrastructure</p>
            <p class="text-slate-700 text-[9px] mt-2 font-bold">STABLE RELEASE 3.0 | PROFESSIONAL DASHBOARD</p>
        </footer>
    </div>

    <!-- Password Modal -->
    <div id="passwordModal" class="fixed inset-0 bg-[#020617]/90 backdrop-blur-2xl z-50 hidden flex items-center justify-center p-4">
        <div class="glass max-w-md w-full p-10 shadow-[0_0_100px_rgba(14,165,233,0.1)] scale-95 transition-all duration-300 border-sky-500/20" id="modalContent">
            <div class="w-16 h-16 bg-sky-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-sky-500/20">
                <i class="fas fa-lock text-sky-400 text-2xl"></i>
            </div>
            <h2 class="text-2xl font-black mb-2 text-white text-center">تنظیمات امنیتی</h2>
            <p class="text-slate-500 text-center text-sm mb-8 font-bold">تغییر رمز عبور مدیریت سامانه</p>
            <div class="space-y-5">
                <div class="relative">
                    <label class="block text-[11px] font-black text-slate-400 mb-2 mr-1 uppercase">رمز عبور فعلی</label>
                    <div class="relative">
                        <input type="password" id="oldPassword" class="w-full bg-slate-800/50 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-sky-500 transition-all font-bold text-white shadow-inner ltr" placeholder="••••••••">
                        <button onclick="togglePass('oldPassword')" class="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-sky-400"><i id="eye-oldPassword" class="fas fa-eye"></i></button>
                    </div>
                </div>
                <div class="relative">
                    <label class="block text-[11px] font-black text-slate-400 mb-2 mr-1 uppercase">رمز عبور جدید</label>
                    <div class="relative">
                        <input type="password" id="newPassword" class="w-full bg-slate-800/50 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-sky-500 transition-all font-bold text-white shadow-inner ltr" placeholder="حداقل ۶ کاراکتر">
                        <button onclick="togglePass('newPassword')" class="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-sky-400"><i id="eye-newPassword" class="fas fa-eye"></i></button>
                    </div>
                </div>
                <div class="relative">
                    <label class="block text-[11px] font-black text-slate-400 mb-2 mr-1 uppercase">تکرار رمز عبور جدید</label>
                    <div class="relative">
                        <input type="password" id="confirmPassword" class="w-full bg-slate-800/50 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-sky-500 transition-all font-bold text-white shadow-inner ltr" placeholder="••••••••">
                        <button onclick="togglePass('confirmPassword')" class="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-sky-400"><i id="eye-confirmPassword" class="fas fa-eye"></i></button>
                    </div>
                </div>
                <div class="flex flex-col gap-3 pt-4">
                    <button onclick="changePassword()" class="w-full bg-sky-500 hover:bg-sky-600 text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-sky-500/20 text-lg">بروزرسانی گذرواژه</button>
                    <button onclick="togglePasswordModal()" class="w-full glass hover:bg-white/5 text-white font-black py-4 rounded-2xl transition-all">انصراف</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Policy Modal -->
    <div id="policyModal" class="fixed inset-0 bg-[#020617]/90 backdrop-blur-2xl z-50 hidden flex items-center justify-center p-4">
        <div class="glass max-w-md w-full p-8 shadow-[0_0_100px_rgba(14,165,233,0.1)] scale-95 transition-all duration-300 border-sky-500/20">
            <h2 id="policyModalTitle" class="text-2xl font-black mb-6 text-white text-center">تنظیم زمان</h2>
            <div class="grid grid-cols-4 gap-2 mb-6" dir="ltr">
                <div class="text-center">
                    <input type="number" id="policyDays" min="0" value="0" class="w-full bg-slate-800/50 border border-white/10 rounded-xl px-2 py-3 outline-none focus:border-sky-500 transition-all font-bold text-white shadow-inner text-center text-lg">
                    <label class="block text-[10px] text-slate-400 mt-2 font-black">روز</label>
                </div>
                <div class="text-center">
                    <input type="number" id="policyHours" min="0" value="0" class="w-full bg-slate-800/50 border border-white/10 rounded-xl px-2 py-3 outline-none focus:border-sky-500 transition-all font-bold text-white shadow-inner text-center text-lg">
                    <label class="block text-[10px] text-slate-400 mt-2 font-black">ساعت</label>
                </div>
                <div class="text-center">
                    <input type="number" id="policyMinutes" min="0" value="30" class="w-full bg-slate-800/50 border border-white/10 rounded-xl px-2 py-3 outline-none focus:border-sky-500 transition-all font-bold text-white shadow-inner text-center text-lg">
                    <label class="block text-[10px] text-slate-400 mt-2 font-black">دقیقه</label>
                </div>
                <div class="text-center">
                    <input type="number" id="policySeconds" min="0" value="0" class="w-full bg-slate-800/50 border border-white/10 rounded-xl px-2 py-3 outline-none focus:border-sky-500 transition-all font-bold text-white shadow-inner text-center text-lg">
                    <label class="block text-[10px] text-slate-400 mt-2 font-black">ثانیه</label>
                </div>
            </div>
            
            <div id="policyPermanentWrapper" class="hidden mb-6 flex items-center gap-3 bg-rose-500/10 p-4 rounded-xl border border-rose-500/20">
                <input type="checkbox" id="policyPermanent" class="w-5 h-5 accent-rose-500 bg-slate-800 border-white/10 rounded">
                <label for="policyPermanent" class="text-sm text-rose-400 font-bold select-none cursor-pointer">کاربر به صورت نامحدود از چت‌ها اخراج شود</label>
            </div>

            <div class="flex flex-col gap-3 pt-4">
                <button id="policyModalSubmit" class="w-full bg-sky-500 hover:bg-sky-600 text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-sky-500/20 text-lg">اعمال تغییرات</button>
                <button onclick="closePolicyModal()" class="w-full glass hover:bg-white/5 text-white font-black py-4 rounded-2xl transition-all">انصراف</button>
            </div>
        </div>
    </div>

    <script>
        let memoryChart, cpuChart, relayChart, networkChart, throughputChart, storageChart, queueChart;
        let refreshTimer = null;
        let logPage = 1;
        const logsPerPage = 15;
        const maxDataPoints = 60;
        const history = { 
            memory: [], cpu: [], relay: [], labels: [],
            bytesIn: [], bytesOut: [], msgsIn: [], msgsOut: [],
            storage: [], queue: []
        };
        let lastRelayCount = 0;

        function formatUptime(seconds) {
            const d = Math.floor(seconds / (3600*24));
            const h = Math.floor(seconds % (3600*24) / 3600);
            const m = Math.floor(seconds % 3600 / 60);
            const s = Math.floor(seconds % 60);
            return \`\${d > 0 ? d + 'd ' : ''}\${h.toString().padStart(2, '0')}:\${m.toString().padStart(2, '0')}:\${s.toString().padStart(2, '0')}\`;
        }

        function formatBytes(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }

        function togglePass(id) {
            const input = document.getElementById(id);
            const icon = document.getElementById('eye-' + id);
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        }

        function updateFileLabel() {
            const file = document.getElementById('broadcastFile').files[0];
            document.getElementById('fileLabel').textContent = file ? file.name : 'انتخاب فایل یا صدا...';
        }

        function clearFile() {
            document.getElementById('broadcastFile').value = '';
            updateFileLabel();
        }

        async function clearOfflineQueue() {
            if (!confirm('آیا مایل به پاکسازی کل صف پیام‌های آفلاین هستید؟')) return;
            try {
                const res = await fetch('/admin/clear-offline', {
                    method: 'POST',
                    headers: { 'Authorization': 'Basic ' + localStorage.getItem('monitor_token_v2') }
                });
                if (res.ok) {
                    alert('صف پیام‌های آفلاین با موفقیت پاکسازی شد.');
                    updateStats();
                }
            } catch (err) { alert('خطا در ارتباط با سرور'); }
        }

        async function clearErrorQueue() {
            if (!confirm('آیا مایل به پاکسازی پیام‌های دلیور نشده و یا خطادار هستید؟')) return;
            try {
                const res = await fetch('/admin/clear-offline', {
                    method: 'POST',
                    headers: { 'Authorization': 'Basic ' + localStorage.getItem('monitor_token_v2') }
                });
                if (res.ok) {
                    alert('پیام‌های خطادار با موفقیت پاکسازی شدند.');
                    updateStats();
                }
            } catch (err) { alert('خطا در ارتباط با سرور'); }
        }

        async function optimizeRAM() {
            if (!confirm('آیا مایل به آزادسازی حافظه RAM سیستم هستید؟')) return;
            try {
                const res = await fetch('/admin/optimize-ram', {
                    method: 'POST',
                    headers: { 'Authorization': 'Basic ' + localStorage.getItem('monitor_token_v2') }
                });
                const data = await res.json();
                if (data.ok) {
                    alert(\`بهینه‌سازی انجام شد. حدود \${data.saved} مگابایت حافظه آزاد شد.\`);
                }
                updateStats();
            } catch (err) { alert('خطا در ارتباط با سرور'); }
        }

        async function sendBroadcast() {
            const msg = document.getElementById('broadcastMsg').value;
            const fileInput = document.getElementById('broadcastFile');
            const file = fileInput.files[0];
            const targetValue = document.getElementById('broadcastTarget').value;
            const target = targetValue ? JSON.parse(decodeURIComponent(targetValue)) : {};
            
            if (!msg && !file) return;

            let fileData = null;
            let fileName = null;
            let kind = 'text';

            if (file) {
                kind = file.type.startsWith('audio/') ? 'voice' : 'file';
                fileName = file.name;
                fileData = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.readAsDataURL(file);
                });
            }

            try {
                const res = await fetch('/admin/broadcast', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + localStorage.getItem('monitor_token_v2')
                    },
                    body: JSON.stringify({
                        message: msg,
                        fileData,
                        fileName,
                        kind,
                        targetClientId: target.clientId || '',
                        targetFingerprint: target.fingerprint || ''
                    })
                });
                const data = await res.json();
                if (data.ok) {
                    alert('اعلان برای ' + data.sentTo + ' کاربر ارسال شد');
                    document.getElementById('broadcastMsg').value = '';
                    clearFile();
                } else {
                    alert('خطا: ' + (data.reason || 'ارسال ناموفق بود'));
                }
            } catch (err) { alert('خطا در ارسال اعلان'); }
        }

        function closePolicyModal() {
            document.getElementById('policyModal').classList.add('hidden');
        }

        function askPolicyDurationModal(actionLabel, allowPermanent) {
            return new Promise((resolve) => {
                const modal = document.getElementById('policyModal');
                const submitBtn = document.getElementById('policyModalSubmit');
                
                document.getElementById('policyModalTitle').textContent = actionLabel;
                
                const permWrapper = document.getElementById('policyPermanentWrapper');
                const permCheck = document.getElementById('policyPermanent');
                
                const updateInputs = () => {
                    const disabled = allowPermanent && permCheck.checked;
                    document.getElementById('policyDays').disabled = disabled;
                    document.getElementById('policyHours').disabled = disabled;
                    document.getElementById('policyMinutes').disabled = disabled;
                    document.getElementById('policySeconds').disabled = disabled;
                };

                if (allowPermanent) {
                    permWrapper.classList.remove('hidden');
                    permCheck.checked = false;
                    permCheck.onchange = updateInputs;
                } else {
                    permWrapper.classList.add('hidden');
                    permCheck.checked = false;
                }
                updateInputs();

                document.getElementById('policyDays').value = 0;
                document.getElementById('policyHours').value = 0;
                document.getElementById('policyMinutes').value = 30;
                document.getElementById('policySeconds').value = 0;

                modal.classList.remove('hidden');

                submitBtn.onclick = () => {
                    if (allowPermanent && permCheck.checked) {
                        closePolicyModal();
                        resolve({ permanent: true, minutes: 0, ms: 0 });
                        return;
                    }
                    
                    const d = parseInt(document.getElementById('policyDays').value || 0, 10);
                    const h = parseInt(document.getElementById('policyHours').value || 0, 10);
                    const m = parseInt(document.getElementById('policyMinutes').value || 0, 10);
                    const s = parseInt(document.getElementById('policySeconds').value || 0, 10);
                    
                    const totalMinutes = (d * 24 * 60) + (h * 60) + m + (s / 60);
                    const totalMs = (((d * 24 + h) * 60 + m) * 60 + s) * 1000;
                    
                    if (totalMs <= 0) {
                        alert('حداقل زمان باید بیشتر از صفر باشد.');
                        return;
                    }
                    closePolicyModal();
                    resolve({ permanent: false, minutes: totalMinutes, ms: totalMs });
                };
                
                const oldClose = closePolicyModal;
                window.closePolicyModal = () => {
                    oldClose();
                    resolve(null);
                };
            });
        }

        function formatPolicyDuration(ms) {
            const totalSeconds = Math.max(1, Math.round(Number(ms || 0) / 1000));
            const d = Math.floor(totalSeconds / 86400);
            const h = Math.floor((totalSeconds % 86400) / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = totalSeconds % 60;
            const parts = [];
            if (d) parts.push(d + ' روز');
            if (h) parts.push(h + ' ساعت');
            if (m) parts.push(m + ' دقیقه');
            if (s) parts.push(s + ' ثانیه');
            return parts.join(' و ') || '۱ ثانیه';
        }

        async function kickPeer(clientId) {
            const duration = await askPolicyDurationModal('اخراج کاربر', true);
            if (!duration) return;
            const label = duration.permanent ? 'بدون محدودیت' : Math.round(duration.minutes) + ' دقیقه';
            if (!confirm('کاربر برای ' + label + ' از اتصال به سرور منع شود؟')) return;
            try {
                const res = await fetch('/admin/kick-peer', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + localStorage.getItem('monitor_token_v2')
                    },
                    body: JSON.stringify({ clientId, durationMinutes: duration.minutes, permanent: duration.permanent })
                });
                if (res.ok) updateStats();
            } catch (err) { alert('خطا در قطع اتصال'); }
        }

        async function suspendPeer(clientId) {
            const duration = await askPolicyDurationModal('تعلیق کاربر', false);
            if (!duration) return;
            const durationLabel = formatPolicyDuration(duration.ms);
            if (!confirm('این کاربر برای ' + durationLabel + ' به حالت تعلیق برود و هیچ فعالیتی در سرور نداشته باشد؟')) return;
            try {
                const res = await fetch('/admin/suspend-peer', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + localStorage.getItem('monitor_token_v2')
                    },
                    body: JSON.stringify({ clientId, durationMinutes: duration.minutes, durationMs: duration.ms })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) updateStats();
                else alert('خطا: ' + (data.reason || 'تعلیق ناموفق بود'));
            } catch (err) { alert('خطا در تعلیق کاربر'); }
        }

        async function resumePeer(key) {
            if (!confirm('این کاربر از حالت تعلیق خارج شود؟')) return;
            try {
                const res = await fetch('/admin/resume-peer', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + localStorage.getItem('monitor_token_v2')
                    },
                    body: JSON.stringify({ key })
                });
                if (res.ok) updateStats();
            } catch (err) { alert('خطا در رفع تعلیق'); }
        }

        async function unkickPeer(key) {
            if (!confirm('این کاربر از لیست اخراجی خارج شود؟')) return;
            try {
                const res = await fetch('/admin/unkick-peer', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + localStorage.getItem('monitor_token_v2')
                    },
                    body: JSON.stringify({ key })
                });
                if (res.ok) updateStats();
            } catch (err) { alert('خطا در رفع اخراج'); }
        }

        function logout() {
            if(!confirm('آیا قصد خروج از داشبورد را دارید؟')) return;
            fetch('/admin/logout', {
                method: 'POST',
                headers: { 'Authorization': 'Basic ' + localStorage.getItem('monitor_token_v2') },
                cache: 'no-store'
            }).finally(() => {
                localStorage.removeItem('monitor_token_v2');
                document.cookie = "monitor_token_v2=; path=/; Max-Age=0; SameSite=Strict";
                document.cookie = "monitor_token_v2=; path=/Monitor_Server; Max-Age=0; SameSite=Strict";
                window.location.replace('/Monitor_Server?logged_out=' + Date.now());
            });
        }

        function initCharts() {
            const chartConfig = (id, label, color, type = 'line', suggestedMax = 100) => {
                const ctx = document.getElementById(id).getContext('2d');
                const gradient = ctx.createLinearGradient(0, 0, 0, 250);
                gradient.addColorStop(0, color + '55');
                gradient.addColorStop(1, color + '00');

                return new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [{
                            label: label,
                            data: [],
                            borderColor: color,
                            backgroundColor: gradient,
                            fill: true,
                            tension: 0.4,
                            borderWidth: 2,
                            pointRadius: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { intersect: false, mode: 'index' },
                        scales: {
                            y: { 
                                grid: { color: 'rgba(255,255,255,0.03)' }, 
                                border: { display: false },
                                ticks: { color: '#475569', font: { size: 9, weight: 'bold' } },
                                min: 0,
                                suggestedMax: suggestedMax
                            },
                            x: { 
                                grid: { display: false }, 
                                border: { display: false },
                                ticks: { color: '#475569', font: { size: 9, weight: 'bold' }, maxRotation: 0 } 
                            }
                        },
                        plugins: { legend: { display: false } },
                        animation: { duration: 0 }
                    }
                });
            };

            memoryChart = chartConfig('memoryChart', 'RAM (MB)', '#0ea5e9', 'line', 512);
            cpuChart = chartConfig('cpuChart', 'CPU (%)', '#6366f1', 'line', 100);
            suspendedChart = chartConfig('suspendedChart', 'Suspended Users', '#fbbf24', 'line', 10);
            storageChart = chartConfig('storageChart', 'Storage (%)', '#10b981', 'line', 100);
            queueChart = chartConfig('queueChart', 'Queue', '#f43f5e', 'line', 50);

            const multiChartConfig = (id, datasets) => {
                const ctx = document.getElementById(id).getContext('2d');
                return new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: datasets.map(ds => ({
                            label: ds.label,
                            data: [],
                            borderColor: ds.color,
                            backgroundColor: ds.color + '22',
                            fill: true,
                            tension: 0.4,
                            borderWidth: 2,
                            pointRadius: 0
                        }))
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#475569', font: { size: 9 } } },
                            x: { grid: { display: false }, ticks: { color: '#475569', font: { size: 9 }, maxRotation: 0 } }
                        },
                        plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { size: 10, weight: 'bold' }, boxWidth: 10 } } },
                        animation: { duration: 0 }
                    }
                });
            };

            networkChart = multiChartConfig('networkChart', [
                { label: 'Bytes In', color: '#38bdf8' },
                { label: 'Bytes Out', color: '#818cf8' }
            ]);

            throughputChart = multiChartConfig('throughputChart', [
                { label: 'Msgs In', color: '#34d399' },
                { label: 'Msgs Out', color: '#fbbf24' }
            ]);
        }

        async function updateStats() {
            const startTime = Date.now();
            try {
                const res = await fetch('/healthz?_t=' + Date.now());
                const ping = Date.now() - startTime;
                if (res.status === 401) { window.location.reload(); return; }
                const data = await res.json();
                
                // Update Numeric Stats
                document.getElementById('statPeers').textContent = data.peers;
                document.getElementById('statMemory').textContent = data.memory.heapUsed + ' MB';
                document.getElementById('statCpu').textContent = data.cpuLoad + ' %';
                document.getElementById('statPing').innerHTML = ping + ' <span class="text-sm">ms</span>';
                document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString('fa-IR');
                
                if (data.storage) {
                    const usedPerc = Math.round(((data.storage.total - data.storage.free) / data.storage.total) * 100);
                    document.getElementById('statStorage').textContent = usedPerc + ' %';
                    document.getElementById('storageBar').style.width = usedPerc + '%';
                } else {
                    document.getElementById('statStorage').textContent = '---';
                }

                // Progress Bars
                const memPerc = Math.min(100, Math.round((data.memory.heapUsed / data.memory.heapTotal) * 100));
                document.getElementById('memoryBar').style.width = memPerc + '%';
                document.getElementById('cpuBar').style.width = data.cpuLoad + '%';
                
                // System Info
                document.getElementById('sysPlatform').textContent = data.platform;
                document.getElementById('sysNode').textContent = data.nodeVersion;
                document.getElementById('sysUptimeDisplay').innerHTML = \`
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center gap-2"><span class="text-[9px] text-slate-500 w-10">OS:</span><span class="text-white">\${formatUptime(data.sysUptime)}</span></div>
                        <div class="flex items-center gap-2"><span class="text-[9px] text-sky-500 w-10">APP:</span><span class="text-sky-400">\${formatUptime(data.uptime)}</span></div>
                    </div>
                \`;
                document.getElementById('sysTotalMem').textContent = data.totalMem + ' MB';
                document.getElementById('sysTurn').textContent = data.turnEnabled ? 'عملیاتی ✅' : 'غیرفعال ❌';
                document.getElementById('sysTurn').className = data.turnEnabled ? 'font-black text-emerald-400' : 'font-black text-rose-400';

                // Peer List Table
                const tableBody = document.getElementById('peerTableBody');
                const targetSelect = document.getElementById('broadcastTarget');
                const previousTarget = targetSelect.value;
                targetSelect.innerHTML = '<option value="">همه کاربران متصل</option>' + data.peersList.map(peer => {
                    const value = encodeURIComponent(JSON.stringify({ clientId: peer.clientId, fingerprint: peer.fingerprint || '' }));
                    return \`<option value="\${value}">\${peer.username} - \${peer.ip.replace('::ffff:', '')}</option>\`;
                }).join('');
                if ([...targetSelect.options].some(option => option.value === previousTarget)) {
                    targetSelect.value = previousTarget;
                }

                tableBody.innerHTML = data.peersList.map(peer => \`
                    <tr class="peer-row border-b border-white/5 transition-colors">
                        <td class="py-4 pr-4">
                            <div class="font-black text-white">\${peer.username}</div>
                            <div class="text-[9px] text-slate-500 font-mono truncate max-w-[150px]">\${peer.fingerprint || 'بدون اثر انگشت'}</div>
                        </td>
                        <td class="py-4 font-mono text-xs text-slate-400">\${peer.ip.replace('::ffff:', '')}</td>
                        <td class="py-4 text-slate-400">
                             <div class="text-xs font-bold">\${formatUptime(Math.floor((Date.now() - peer.connectedAt)/1000))}</div>
                             <div class="text-[9px] text-slate-600">از \${new Date(peer.connectedAt).toLocaleTimeString('fa-IR')}</div>
                        </td>
                        <td class="py-4 text-left pl-4">
                            <div class="flex justify-end gap-3">
                                <button onclick="suspendPeer('\${peer.clientId}')" class="text-amber-400 hover:text-amber-300 font-bold transition-colors">تعلیق</button>
                                <button onclick="kickPeer('\${peer.clientId}')" class="text-rose-500 hover:text-rose-400 font-bold transition-colors">اخراج</button>
                            </div>
                        </td>
                    </tr>
                \`).join('');

                const suspended = data.suspendedUsers || [];
                document.getElementById('suspendedCount').textContent = suspended.length + ' کاربر';
                document.getElementById('suspendedTableBody').innerHTML = suspended.length ? suspended.map(user => \`
                    <tr class="border-b border-white/5">
                        <td class="py-4 pr-4">
                            <div class="font-black text-white">\${user.username || 'کاربر ناشناس'}</div>
                            <div class="text-[9px] text-slate-500 font-mono truncate max-w-[180px]">\${user.peerId || user.clientId || user.key}</div>
                        </td>
                        <td class="py-4 text-slate-400">
                            <div class="font-mono text-[10px] truncate max-w-[220px]">\${user.fingerprint || 'بدون اثر انگشت'}</div>
                            <div class="text-[9px] text-slate-600">\${user.ip || 'IP نامشخص'}</div>
                        </td>
                        <td class="py-4 text-slate-400">
                            <div>\${user.createdAt ? new Date(user.createdAt).toLocaleString('fa-IR') : '--'}</div>
                            <div class="text-[9px] text-amber-300 mt-1">\${user.expiresAt ? 'تا ' + new Date(user.expiresAt).toLocaleString('fa-IR') : 'بدون زمان پایان'}</div>
                        </td>
                        <td class="py-4 text-left pl-4">
                            <button onclick="resumePeer('\${user.key}')" class="text-emerald-400 hover:text-emerald-300 font-bold transition-colors">رفع تعلیق</button>
                        </td>
                    </tr>
                \`).join('') : '<tr><td colspan="4" class="py-8 text-center text-slate-500 font-bold">هیچ کاربری در حالت تعلیق نیست.</td></tr>';

                const kicked = data.kickedUsers || [];
                document.getElementById('kickedCount').textContent = kicked.length + ' کاربر';
                document.getElementById('kickedTableBody').innerHTML = kicked.length ? kicked.map(user => \`
                    <tr class="border-b border-white/5">
                        <td class="py-4 pr-4">
                            <div class="font-black text-white">\${user.username || 'کاربر ناشناس'}</div>
                            <div class="text-[9px] text-slate-500 font-mono truncate max-w-[180px]">\${user.peerId || user.clientId || user.key}</div>
                        </td>
                        <td class="py-4 text-slate-400">
                            <div class="font-mono text-[10px] truncate max-w-[220px]">\${user.fingerprint || 'بدون اثر انگشت'}</div>
                            <div class="text-[9px] text-slate-600">\${user.ip || 'IP نامشخص'}</div>
                        </td>
                        <td class="py-4 text-slate-400">
                            <div>\${user.createdAt ? new Date(user.createdAt).toLocaleString('fa-IR') : '--'}</div>
                            <div class="text-[9px] text-rose-300 mt-1">\${user.permanent ? 'بدون محدودیت' : (user.expiresAt ? 'تا ' + new Date(user.expiresAt).toLocaleString('fa-IR') : '--')}</div>
                        </td>
                        <td class="py-4 text-left pl-4">
                            <button onclick="unkickPeer('\${user.key}')" class="text-emerald-400 hover:text-emerald-300 font-bold transition-colors">رفع اخراج</button>
                        </td>
                    </tr>
                \`).join('') : '<tr><td colspan="4" class="py-8 text-center text-slate-500 font-bold">هیچ کاربری در لیست اخراجی نیست.</td></tr>';

                // Logs
                const logContainer = document.getElementById('logContainer');
                const totalLogs = data.logs.length;
                const totalPages = Math.ceil(totalLogs / logsPerPage) || 1;
                if (logPage > totalPages) logPage = totalPages;
                
                document.getElementById('logPageIndicator').textContent = \`صفحه \${logPage} از \${totalPages}\`;
                document.getElementById('prevLogBtn').disabled = logPage <= 1;
                document.getElementById('nextLogBtn').disabled = logPage >= totalPages;

                const start = (logPage - 1) * logsPerPage;
                const end = start + logsPerPage;
                const paginatedLogs = data.logs.slice(start, end);

                const atBottom = logContainer.scrollHeight - logContainer.scrollTop <= logContainer.clientHeight + 50;
                logContainer.innerHTML = paginatedLogs.map(log => \`
                    <div class="log-entry log-\${log.type} p-2 rounded-r flex gap-3">
                        <span class="text-slate-600 font-bold">\${new Date(log.ts).toLocaleTimeString('fa-IR')}</span>
                        <span class="text-slate-300">\${log.msg}</span>
                    </div>
                \`).join('');
                if(atBottom && logPage === totalPages) logContainer.scrollTop = logContainer.scrollHeight;

                // Update Charts
                const time = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                
                let currentRelay = 0;
                if (lastRelayCount > 0) {
                    currentRelay = Math.max(0, data.traffic.relays - lastRelayCount);
                }
                lastRelayCount = data.traffic.relays;

                let currentBytesIn = 0;
                let currentBytesOut = 0;
                if (window.lastBytesIn > 0) currentBytesIn = Math.max(0, data.traffic.bytesIn - window.lastBytesIn);
                if (window.lastBytesOut > 0) currentBytesOut = Math.max(0, data.traffic.bytesOut - window.lastBytesOut);
                window.lastBytesIn = data.traffic.bytesIn;
                window.lastBytesOut = data.traffic.bytesOut;

                let currentMsgsIn = 0;
                let currentMsgsOut = 0;
                if (window.lastMsgsIn > 0) currentMsgsIn = Math.max(0, data.traffic.msgsIn - window.lastMsgsIn);
                if (window.lastMsgsOut > 0) currentMsgsOut = Math.max(0, data.traffic.msgsOut - window.lastMsgsOut);
                window.lastMsgsIn = data.traffic.msgsIn;
                window.lastMsgsOut = data.traffic.msgsOut;

                history.labels.push(time);
                history.memory.push(data.memory.heapUsed);
                history.cpu.push(data.cpuLoad);
                history.relay.push(data.suspendedUsers?.length || 0);
                history.bytesIn.push(currentBytesIn);
                history.bytesOut.push(currentBytesOut);
                history.msgsIn.push(currentMsgsIn);
                history.msgsOut.push(currentMsgsOut);

                const storagePerc = data.storage ? Math.round(((data.storage.total - data.storage.free) / data.storage.total) * 100) : 0;
                history.storage.push(storagePerc);
                history.queue.push(data.queuedMessages || 0);

                if (history.labels.length > maxDataPoints) {
                    history.labels.shift();
                    history.memory.shift();
                    history.cpu.shift();
                    history.relay.shift();
                    history.bytesIn.shift();
                    history.bytesOut.shift();
                    history.msgsIn.shift();
                    history.msgsOut.shift();
                    history.storage.shift();
                    history.queue.shift();
                }

                memoryChart.data.labels = history.labels;
                memoryChart.data.datasets[0].data = history.memory;
                memoryChart.update('none');

                cpuChart.data.labels = history.labels;
                cpuChart.data.datasets[0].data = history.cpu;
                cpuChart.update('none');

                suspendedChart.data.labels = history.labels;
                suspendedChart.data.datasets[0].data = history.relay;
                suspendedChart.update('none');
                networkChart.data.labels = history.labels;
                networkChart.data.datasets[0].data = history.bytesIn;
                networkChart.data.datasets[1].data = history.bytesOut;
                networkChart.update('none');

                throughputChart.data.labels = history.labels;
                throughputChart.data.datasets[0].data = history.msgsIn;
                throughputChart.data.datasets[1].data = history.msgsOut;
                throughputChart.update('none');

                storageChart.data.labels = history.labels;
                storageChart.data.datasets[0].data = history.storage;
                storageChart.update('none');

                queueChart.data.labels = history.labels;
                queueChart.data.datasets[0].data = history.queue;
                queueChart.update('none');
                
                document.getElementById('statusIndicator').innerHTML = '<span class="w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-[0_0_15px_rgba(34,197,94,0.8)]"></span> عملیاتی';
            } catch (err) {
                console.error(err);
                document.getElementById('statusIndicator').innerHTML = '<span class="w-3 h-3 bg-red-500 rounded-full"></span> قطع اتصال';
            }
        }

        function setupAutoRefresh() {
            if (refreshTimer) clearInterval(refreshTimer);
            const interval = parseInt(document.getElementById('refreshInterval').value);
            refreshTimer = setInterval(updateStats, interval);
        }

        async function clearMemory() {
            if (!confirm('آیا مایل به بهینه‌سازی حافظه و پاکسازی اتصالات منقضی شده هستید؟')) return;
            try {
                const res = await fetch('/admin/clear-memory', {
                    method: 'POST',
                    headers: { 'Authorization': 'Basic ' + localStorage.getItem('monitor_token_v2') }
                });
                const data = await res.json();
                if (data.ok) {
                    alert(\`بهینه‌سازی انجام شد: \${data.clearedPresence} اتصال منقضی حذف شد.\`);
                }
                updateStats();
            } catch (err) { alert('خطا در ارتباط با سرور'); }
        }

        function downloadLogs() {
            const logs = document.getElementById('logContainer').innerText;
            const blob = new Blob([logs], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`signal-server-logs-\${new Date().toISOString()}.txt\`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        function prevLogPage() {
            if (logPage > 1) {
                logPage--;
                updateStats();
            }
        }

        function nextLogPage() {
            logPage++;
            updateStats();
        }

        function clearLogs() {
            document.getElementById('logContainer').innerHTML = '';
            logPage = 1;
        }

        async function changePassword() {
            const oldPass = document.getElementById('oldPassword').value;
            const newPass = document.getElementById('newPassword').value;
            const confirmPass = document.getElementById('confirmPassword').value;
            
            if (!oldPass) { alert('رمز عبور فعلی را وارد کنید'); return; }
            if (newPass.length < 6) { alert('رمز عبور جدید باید حداقل ۶ کاراکتر باشد'); return; }
            if (newPass !== confirmPass) { alert('رمز عبور جدید و تاییدیه آن مطابقت ندارند'); return; }

            try {
                const res = await fetch('/admin/change-password', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + localStorage.getItem('monitor_token_v2')
                    },
                    body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
                });
                if (res.ok) {
                    alert('رمز عبور با موفقیت تغییر کرد. لطفاً مجدداً وارد شوید.');
                    localStorage.removeItem('monitor_token_v2');
                    window.location.reload();
                } else {
                    const data = await res.json();
                    alert('خطا: ' + (data.reason || 'تغییر رمز عبور با خطا مواجه شد'));
                }
            } catch (err) { alert('خطا در سرور'); }
        }

        function togglePasswordModal() {
            const modal = document.getElementById('passwordModal');
            const content = document.getElementById('modalContent');
            if (modal.classList.contains('hidden')) {
                modal.classList.remove('hidden');
                setTimeout(() => content.classList.remove('scale-95'), 10);
            } else {
                content.classList.add('scale-95');
                setTimeout(() => modal.classList.add('hidden'), 300);
            }
        }

        document.getElementById('refreshInterval').addEventListener('change', setupAutoRefresh);

        initCharts();
        updateStats();
        setupAutoRefresh();
    </script>
</body>
</html>
  `);
});

app.get('/chat-health', (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  const publicUrls = publicRelayUrls(req);
  res.json({
    ok: true,
    service: 'poorija-chat-signal',
    peers: presence.size,
    turnEnabled: TURN_URLS.length > 0,
    peerOrigin: publicUrls.relayOrigin,
    presenceUrl: publicUrls.presenceUrl,
    timestamp: new Date().toISOString(),
  });
});

app.get('/turn-config', (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  res.json({
    enabled: TURN_URLS.length > 0,
    urls: TURN_URLS,
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  });
});

app.get('/push/vapid-public-key', (_req, res) => {
  res.json({
    enabled: true,
    publicKey: vapidKeys.publicKey,
  });
});

/* ---- proving a subscription belongs to the fingerprint it names ---------
 *
 * /push/subscribe used to take a fingerprint's word for it. Anyone who could
 * reach the relay could register THEIR endpoint against SOMEBODY ELSE'S
 * fingerprint and be told, from then on, every time that person received a
 * message -- who is talking to whom and when, which is the one thing the
 * encryption cannot hide and the whole product is built to withhold. Five such
 * rows also pushed the real device out of a list capped at five, so the victim
 * simply stopped being woken.
 *
 * The socket already answers this question: the relay seals a nonce to the
 * public key whose SHA-256 is the claimed fingerprint, and only the holder of
 * the private key can read it back. Same ceremony here, over two calls.
 */
const PUSH_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const pushChallenges = new Map();

function sweepPushChallenges() {
  const now = Date.now();
  for (const [id, challenge] of pushChallenges.entries()) {
    if (challenge.expiresAt <= now) pushChallenges.delete(id);
  }
}

app.post('/push/challenge', (req, res) => {
  sweepPushChallenges();
  const fingerprint = sanitizeFingerprint(req.body?.fingerprint);
  const publicKeyData = String(req.body?.publicKeyData || '').slice(0, 8192);
  if (!fingerprint || !publicKeyData) {
    return res.status(400).json({ ok: false, reason: 'fingerprint-and-key-required' });
  }
  /* The fingerprint IS the SHA-256 of the SPKI, so a key that hashes to
     anything else is a claim with the wrong proof attached -- exactly the
     check the hello handler makes before it challenges anybody. */
  let digest = '';
  try {
    digest = crypto.createHash('sha256').update(Buffer.from(publicKeyData, 'base64')).digest('hex');
  } catch (_error) { /* undecodable key; the comparison answers it */ }
  if (digest !== fingerprint) {
    return res.status(400).json({ ok: false, reason: 'key-does-not-match-fingerprint' });
  }
  const nonce = crypto.randomBytes(32);
  const body = publicKeyData.replace(/\s+/g, '');
  const pem = `-----BEGIN PUBLIC KEY-----\n${(body.match(/.{1,64}/g) || []).join('\n')}\n-----END PUBLIC KEY-----`;
  let cipher;
  try {
    cipher = crypto.publicEncrypt(
      { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      nonce,
    );
  } catch (error) {
    return res.status(400).json({ ok: false, reason: 'key-unusable' });
  }
  const challengeId = crypto.randomUUID();
  pushChallenges.set(challengeId, { fingerprint, nonce, expiresAt: Date.now() + PUSH_CHALLENGE_TTL_MS });
  res.json({ ok: true, challengeId, cipher: cipher.toString('base64') });
});

/** Spends the challenge either way: a wrong answer must not be guessable twice. */
function pushProofAccepted(fingerprint, challengeId, answerBase64) {
  sweepPushChallenges();
  const challenge = pushChallenges.get(String(challengeId || ''));
  if (!challenge) return false;
  pushChallenges.delete(String(challengeId));
  if (challenge.fingerprint !== fingerprint) return false;
  try {
    const answer = Buffer.from(String(answerBase64 || ''), 'base64');
    return answer.length === challenge.nonce.length && crypto.timingSafeEqual(answer, challenge.nonce);
  } catch (_error) {
    return false;
  }
}

/* ---- polling, for a phone with no distributor ---------------------------
 *
 * UnifiedPush is the good answer: the distributor holds the socket and the
 * phone is woken the moment something arrives. A phone with no distributor
 * installed has nothing holding a socket, so the only thing left is to look
 * every so often -- which Android will not let happen more than once every
 * fifteen minutes, and under Doze rather less than that. It is a worse answer
 * and it is off unless somebody turns it on.
 *
 * It cannot be an open question. "Does this fingerprint have mail waiting" is
 * precisely the metadata the rest of this file works to withhold, and answered
 * to anybody who asks it tells a watcher when a named person is being talked
 * to. So the webview proves the identity once, the relay issues a token bound
 * to that fingerprint, and the token is what the background worker carries --
 * it can ask about one mailbox, its own.
 */
const POLL_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const POLL_TOKEN_STORE_PATH = process.env.CHAT_POLL_TOKEN_STORE_PATH
  || path.join(path.dirname(OFFLINE_STORE_PATH), 'poll-tokens.json');

/* Writes a file only its owner can read.
 *
 * Two files here hold what amount to credentials: the poll tokens, and the
 * push subscriptions -- a UnifiedPush endpoint IS a capability, and anybody
 * holding one can make that phone buzz. Written with the default umask they
 * land 0644, which on a server with more than one account means every other
 * account can read them.
 *
 * Through a temporary file opened 0600 and renamed over the target, because
 * writing in place and fixing the mode afterwards leaves a window where the
 * contents are there and the permissions are not. */
function writePrivateFile(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  const handle = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(handle, contents);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, target);
}

function loadPollTokens() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(POLL_TOKEN_STORE_PATH, 'utf8'))));
  } catch (_error) {
    return new Map();
  }
}
const pollTokens = loadPollTokens();

function savePollTokens() {
  try {
    writePrivateFile(POLL_TOKEN_STORE_PATH, JSON.stringify(Object.fromEntries(pollTokens), null, 2));
  } catch (error) {
    console.error('Failed to save poll tokens:', error);
  }
}

function sweepPollTokens() {
  const now = Date.now();
  let changed = false;
  for (const [token, row] of pollTokens.entries()) {
    if (row.expiresAt <= now) { pollTokens.delete(token); changed = true; }
  }
  if (changed) savePollTokens();
}

/** Issued only to somebody who has just proven the fingerprint. */
app.post('/push/poll-token', (req, res) => {
  sweepPollTokens();
  const fingerprint = sanitizeFingerprint(req.body?.fingerprint);
  if (!fingerprint) return res.status(400).json({ ok: false, reason: 'fingerprint-required' });
  if (!pushProofAccepted(fingerprint, req.body?.challengeId, req.body?.nonce)) {
    return res.status(403).json({ ok: false, reason: 'identity-unproven' });
  }
  // One per fingerprint: re-issuing replaces, so a reinstall does not leave a
  // token nobody holds still answering questions about somebody's mailbox.
  for (const [token, row] of pollTokens.entries()) {
    if (row.fingerprint === fingerprint) pollTokens.delete(token);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  pollTokens.set(token, { fingerprint, issuedAt: Date.now(), expiresAt: Date.now() + POLL_TOKEN_TTL_MS });
  savePollTokens();
  res.json({ ok: true, token, expiresAt: Date.now() + POLL_TOKEN_TTL_MS });
});

/**
 * How much is waiting. A count and nothing else -- no sender, no timestamps,
 * no shape of who has been talking. The holder already knows it is their own
 * mailbox; anybody else holds a token that answers about somebody else's.
 */
app.get('/push/mailbox', (req, res) => {
  sweepPollTokens();
  /* Header only. A query string is written into access logs, proxy logs and
     any Referer this request produces, and a bearer token that reaches a log
     file has been handed to everybody who can read logs. */
  const token = String(req.get('x-p00rija-poll-token') || '');
  const row = token ? pollTokens.get(token) : null;
  if (!row) return res.status(403).json({ ok: false, reason: 'unknown-token' });
  const queued = offlineBoxes.get(row.fingerprint) || [];
  res.json({ ok: true, waiting: queued.length });
});

app.post('/push/poll-token-revoke', (req, res) => {
  const token = String(req.body?.token || '');
  if (pollTokens.delete(token)) savePollTokens();
  res.json({ ok: true });
});

app.post('/push/subscribe', async (req, res) => {
  const fingerprint = sanitizeFingerprint(req.body?.fingerprint);
  const subscription = sanitizeSubscription(req.body?.subscription);

  if (!fingerprint || !subscription) {
    res.status(400).json({ ok: false, reason: 'invalid-subscription' });
    return;
  }

  /* Without this, a subscription is a claim about somebody else's phone. */
  if (!pushProofAccepted(fingerprint, req.body?.challengeId, req.body?.nonce)) {
    console.warn(`[Push] Refused a subscription that did not prove ${fingerprint.slice(0, 12)}`);
    res.status(403).json({ ok: false, reason: 'identity-unproven' });
    return;
  }

  /* A UnifiedPush endpoint is a URL this process will POST to, and this call
     takes no credentials, so the URL is attacker-controlled by design. Judge
     where it points before storing it. A browser's subscription endpoint comes
     from the engine's own push service rather than from the page, so it is not
     the same question. */
  if (subscription.type === 'unifiedpush' && !await pushEndpointIsReachable(subscription.endpoint)) {
    console.warn(`[Push] Refused a UnifiedPush endpoint that does not resolve to a public address: ${subscription.endpoint.slice(0, 80)}`);
    res.status(400).json({ ok: false, reason: 'endpoint-not-public' });
    return;
  }

  const subscriptions = pushSubscriptions.get(fingerprint) || [];
  const next = subscriptions.filter((item) => item.endpoint !== subscription.endpoint);
  next.push({
    ...subscription,
    updatedAt: new Date().toISOString(),
  });
  pushSubscriptions.set(fingerprint, next.slice(-5));
  savePushSubscriptions();
  res.json({ ok: true, count: pushSubscriptions.get(fingerprint).length });
});

app.post('/push/unsubscribe', (req, res) => {
  const fingerprint = sanitizeFingerprint(req.body?.fingerprint);
  const endpoint = String(req.body?.endpoint || '').slice(0, 2048);
  if (!fingerprint || !endpoint) {
    res.status(400).json({ ok: false, reason: 'invalid-unsubscribe' });
    return;
  }

  const subscriptions = pushSubscriptions.get(fingerprint) || [];
  const next = subscriptions.filter((item) => item.endpoint !== endpoint);
  if (next.length) {
    pushSubscriptions.set(fingerprint, next);
  } else {
    pushSubscriptions.delete(fingerprint);
  }
  savePushSubscriptions();
  res.json({ ok: true });
});

app.post('/self-destruct/records', (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  const payloadId = sanitizeSelfDestructId(req.body?.payloadId);
  const timeLimitMs = clampNonNegativeNumber(req.body?.timeLimitMs, 0, 30 * 24 * 60 * 60 * 1000);
  const maxViews = clampNonNegativeNumber(req.body?.maxViews, 0, 100000);
  const createdAtMs = clampNonNegativeNumber(req.body?.createdAt, Date.now(), Date.now() + 5 * 60 * 1000);
  if (!payloadId) {
    res.status(400).json({ ok: false, reason: 'invalid-payload-id' });
    return;
  }
  const id = crypto.randomUUID();
  const record = {
    id,
    payloadId,
    timeLimitMs,
    maxViews,
    opens: 0,
    createdAt: new Date(createdAtMs || Date.now()).toISOString(),
    firstOpenedAt: null,
    updatedAt: new Date().toISOString(),
  };
  selfDestructRecords.set(id, record);
  pruneSelfDestructRecords();
  saveSelfDestructRecords();
  res.json({ ok: true, ...publicSelfDestructRecord(record) });
});

app.get('/self-destruct/records/:id', (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  const id = sanitizeSelfDestructId(req.params.id);
  const record = selfDestructRecords.get(id);
  if (!record) {
    res.status(404).json({ ok: false, reason: 'not-found' });
    return;
  }
  res.json({ ok: true, ...publicSelfDestructRecord(record) });
});

app.post('/self-destruct/records/:id/open', (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  const id = sanitizeSelfDestructId(req.params.id);
  const record = selfDestructRecords.get(id);
  if (!record) {
    res.status(404).json({ ok: false, reason: 'not-found' });
    return;
  }
  const payloadId = sanitizeSelfDestructId(req.body?.payloadId);
  if (record.payloadId && payloadId && record.payloadId !== payloadId) {
    res.status(400).json({ ok: false, reason: 'payload-mismatch' });
    return;
  }
  const status = selfDestructRecordStatus(record);
  if (status.expired) {
    res.status(410).json({ ok: false, reason: 'expired', ...status });
    return;
  }
  if (record.maxViews > 0 && record.opens >= record.maxViews) {
    res.status(410).json({ ok: false, reason: 'view-limit-reached', ...status });
    return;
  }
  if (!record.firstOpenedAt) record.firstOpenedAt = new Date().toISOString();
  record.opens += 1;
  record.updatedAt = new Date().toISOString();
  saveSelfDestructRecords();
  res.json({ ok: true, ...publicSelfDestructRecord(record) });
});

const peerServer = ExpressPeerServer(server, {
  path: '/',
  proxied: true,
  allow_discovery: true,
  key: 'peerjs',
});
app.use('/peerjs', peerServer);

const offlineBoxes = loadOfflineBoxes();
const pushSubscriptions = loadPushSubscriptions();
const selfDestructRecords = loadSelfDestructRecords();
const policyStore = loadPolicyStore();
const suspendedUsers = new Map(Object.entries(policyStore.suspendedUsers || {}));
const kickedUsers = new Map(Object.entries(policyStore.kickedUsers || {}));
/* Admission by invitation.
 *
 * Suspension and kicking are deny lists: everybody is welcome until named.
 * This is the other way round -- nobody is admitted unless the admin has put
 * their fingerprint here first. It exists because a deny list cannot answer
 * "keep strangers out", only "keep that stranger out", and on a private relay
 * the first question is the one that matters.
 *
 * The key is the identity fingerprint, which is derived from the public key.
 * Generating a new key therefore produces a new fingerprint and a stranger
 * again -- which is the point: rotating a key must not be a way around the
 * door, and on a deny list it always is.
 */
const allowedUsers = new Map(Object.entries(policyStore.allowedUsers || {}));
/* Off means the relay is open, which is what it has always been and what an
   existing install keeps after an upgrade. Turning it on is a decision. */
let allowlistEnabled = Boolean(policyStore.allowlistEnabled);

function loadOfflineBoxes() {
  try {
    if (!fs.existsSync(OFFLINE_STORE_PATH)) return new Map();
    const raw = JSON.parse(fs.readFileSync(OFFLINE_STORE_PATH, 'utf8'));
    return new Map(Object.entries(raw || {}).map(([fingerprint, items]) => [
      sanitizeFingerprint(fingerprint),
      Array.isArray(items) ? items : [],
    ]).filter(([fingerprint, items]) => fingerprint && items.length));
  } catch (error) {
    console.error('Failed to load offline boxes:', error);
    return new Map();
  }
}

/* The whole store is one JSON file, so a crash or a power cut inside a plain
   writeFileSync leaves it truncated — every queued message for every user
   gone, with the next boot finding a parse error where the mailboxes were.
   Write the sibling temp file first and rename over the target: rename
   within a directory is atomic, so a reader sees the whole old file or the
   whole new one, never a half-written one. */
function saveOfflineBoxesNow() {
  try {
    fs.mkdirSync(path.dirname(OFFLINE_STORE_PATH), { recursive: true });
    /* Written flat, not indented. The bulk of this file is base64 bodies,
       which are single strings however it is formatted: the indentation only
       ever padded the braces around them, and it was being recomputed over
       the entire store every time a chunk landed. */
    const started = Date.now();
    fs.writeFileSync(`${OFFLINE_STORE_PATH}.tmp`, JSON.stringify(Object.fromEntries(offlineBoxes)));
    fs.renameSync(`${OFFLINE_STORE_PATH}.tmp`, OFFLINE_STORE_PATH);
    lastOfflineSaveMs = Date.now() - started;
  } catch (error) {
    console.error('Failed to save offline boxes:', error);
  }
}

/* Every ACK and every queued message rewrites the entire store, and a burst
   of them rewrote it once per item. A short trailing debounce collapses the
   burst into one write; shutdown flushes whatever is still pending.

   The wait grows with the store. A rewrite costs time in proportion to what
   is being written, so a fixed wait spends an ever larger share of the clock
   persisting: a 200 MB file arriving as chunks pushed the store past a
   quarter of a gigabyte, and at 300 ms it was being written out over and
   over while the rest of the file was still coming in. Waiting a multiple of
   however long the last write actually took holds that share roughly
   constant, and needs no guess at the size -- the previous write reports its
   own cost. What a crash can cost is the wait, so it is capped. */
const SAVE_DEBOUNCE_MIN_MS = 300;
const SAVE_DEBOUNCE_MAX_MS = 5000;
const SAVE_DEBOUNCE_FACTOR = 4;

let saveOfflineBoxesTimer = null;
let lastOfflineSaveMs = 0;

function offlineSaveDelay() {
  const proportional = lastOfflineSaveMs * SAVE_DEBOUNCE_FACTOR;
  return Math.min(SAVE_DEBOUNCE_MAX_MS, Math.max(SAVE_DEBOUNCE_MIN_MS, proportional));
}

function flushOfflineBoxes() {
  if (saveOfflineBoxesTimer) {
    clearTimeout(saveOfflineBoxesTimer);
    saveOfflineBoxesTimer = null;
  }
  saveOfflineBoxesNow();
}

function saveOfflineBoxes() {
  if (saveOfflineBoxesTimer) return;
  saveOfflineBoxesTimer = setTimeout(() => {
    saveOfflineBoxesTimer = null;
    saveOfflineBoxesNow();
  }, offlineSaveDelay());
}

/* ------------------------------------------------------------------
 * Retention and expiry notices
 *
 * Queued envelopes used to live here forever, so a mailbox whose owner never
   returned only ever grew. Age now decides: media (the big half) goes after
   a week, everything else after a month, and what leaves is recorded so the
   recipient can be told rather than left wondering.
 * ------------------------------------------------------------------ */
const MEDIA_RETENTION_MS = Number(process.env.CHAT_MEDIA_RETENTION_MS || 7 * 24 * 60 * 60 * 1000);
const TEXT_RETENTION_MS = Number(process.env.CHAT_TEXT_RETENTION_MS || 30 * 24 * 60 * 60 * 1000);
/* Media is measured in bytes and text in items; both ceilings are far past
   anything a real correspondent reaches, and both exist so the store cannot
   be farmed as free storage. */
/* Big enough to hold one whole offline file and still have room.
 *
 * The client allows a 200 MB file to somebody who is absent, and base64 inside
 * the chunk envelopes makes that about 268 MB on the way in. At the old 256 MB
 * the eviction sweep would start dropping the EARLY chunks of a transfer while
 * its later chunks were still arriving -- the file could never complete, and
 * nothing said why. 512 MB clears one such file with space for the ordinary
 * traffic behind it. */
const MEDIA_MAILBOX_QUOTA_BYTES = Number(process.env.CHAT_MEDIA_QUOTA_BYTES || 512 * 1024 * 1024);
const TEXT_MAILBOX_LIMIT = Number(process.env.CHAT_TEXT_MAILBOX_LIMIT || 200);
const EXPIRY_LOG_PATH = process.env.CHAT_EXPIRY_LOG_PATH || path.join(path.dirname(OFFLINE_STORE_PATH), 'expiry-log.json');
const EXPIRY_LOG_LIMIT = 500;

let expiryLog = loadExpiryLog();

function loadExpiryLog() {
  try {
    if (!fs.existsSync(EXPIRY_LOG_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(EXPIRY_LOG_PATH, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (error) {
    console.error('Failed to load the expiry log:', error);
    return [];
  }
}

function saveExpiryLog() {
  try {
    fs.mkdirSync(path.dirname(EXPIRY_LOG_PATH), { recursive: true });
    fs.writeFileSync(EXPIRY_LOG_PATH, JSON.stringify(expiryLog, null, 2));
  } catch (error) {
    console.error('Failed to save the expiry log:', error);
  }
}

/* What the sweep needs to know about an envelope, worked out once and kept
   against the envelope itself, so it is dropped when the envelope is and
   reaches neither the store nor the recipient.

   The sweep runs every time mail lands, and it used to re-derive all three
   facts for every envelope already waiting. Sizing an envelope means
   stringifying its payload, so a file being queued chunk by chunk paid for
   the square of its own size in JSON: measured over a 30 MB file, the last
   chunks were landing seven times slower than the first, and a 200 MB one
   would have crawled. Deriving each fact once turns that back into a walk of
   numbers. */
const envelopeFacts = new WeakMap();

function envelopeFactsFor(item) {
  const cached = item && typeof item === 'object' ? envelopeFacts.get(item) : null;
  if (cached) return cached;

  const declared = String(item?.payload?.class || '').toLowerCase();
  const type = String(item?.payload?.type || '').toLowerCase();
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(item?.payload || null), 'utf8');
  } catch (_error) {
    bytes = 0;
  }
  const parsed = Date.parse(item?.queuedAt || '');

  const facts = {
    kind: declared === 'media' || type.startsWith('file-') ? 'media' : 'text',
    bytes,
    at: Number.isFinite(parsed) ? parsed : Date.now(),
  };
  if (item && typeof item === 'object') envelopeFacts.set(item, facts);
  return facts;
}

function envelopeClass(item) {
  return envelopeFactsFor(item).kind;
}

function envelopeBytes(item) {
  return envelopeFactsFor(item).bytes;
}

function queuedAtMs(item) {
  return envelopeFactsFor(item).at;
}

/* Records that something waited and did not survive. The note deliberately
   carries no message id and nothing from the body — only that there was one,
   from whom, and when. */
function noteExpired(fingerprint, item, reason) {
  expiryLog.push({
    fingerprint,
    from: item?.fromFingerprint || '',
    class: envelopeClass(item),
    reason,
    queuedAt: item?.queuedAt || new Date().toISOString(),
    expiredAt: new Date().toISOString(),
    delivered: false,
  });
  /* Bounded: an unbounded log would itself be a way to grow on the server. */
  if (expiryLog.length > EXPIRY_LOG_LIMIT) {
    expiryLog = expiryLog.slice(-EXPIRY_LOG_LIMIT);
  }
}

/* Retention by age, then the caps, for one mailbox. Oldest-first throughout:
   age drops the front of the queue, and so does every kind of eviction. */
function sweepMailbox(fingerprint) {
  const items = offlineBoxes.get(fingerprint);
  if (!items || !items.length) return false;
  const now = Date.now();
  let changed = false;

  /* Mail landing is the ordinary case, and ordinarily it evicts nothing: the
     box is inside both caps and everything in it is younger than its
     retention. Settle that first, with nothing but arithmetic over the cached
     facts, and leave without building the wrapper array or sorting it. A file
     arriving as hundreds of chunks runs this path hundreds of times. */
  let standingMedia = 0;
  let standingText = 0;
  let anyExpired = false;
  for (const item of items) {
    const facts = envelopeFactsFor(item);
    if (facts.kind === 'media') standingMedia += facts.bytes;
    else standingText += 1;
    const limit = facts.kind === 'media' ? MEDIA_RETENTION_MS : TEXT_RETENTION_MS;
    if (now - facts.at > limit) {
      anyExpired = true;
      break;
    }
  }
  if (!anyExpired && standingMedia <= MEDIA_MAILBOX_QUOTA_BYTES && standingText <= TEXT_MAILBOX_LIMIT) {
    return false;
  }

  const entries = items.map((item) => ({
    item,
    kind: envelopeClass(item),
    at: queuedAtMs(item),
    bytes: envelopeBytes(item),
  })).sort((a, b) => a.at - b.at);

  const survivors = [];
  let mediaBytes = 0;
  let textCount = 0;
  for (const entry of entries) {
    const limit = entry.kind === 'media' ? MEDIA_RETENTION_MS : TEXT_RETENTION_MS;
    if (now - entry.at > limit) {
      noteExpired(fingerprint, entry.item, 'retention');
      changed = true;
      continue;
    }
    survivors.push(entry);
    if (entry.kind === 'media') mediaBytes += entry.bytes;
    else textCount += 1;
  }

  /* Media is the big half of a mailbox, so it is also the half that leaves
     first when the box is over quota; text only goes at its own ceiling. */
  for (let i = 0; i < survivors.length && mediaBytes > MEDIA_MAILBOX_QUOTA_BYTES; i += 1) {
    if (survivors[i].kind !== 'media') continue;
    noteExpired(fingerprint, survivors[i].item, 'quota');
    mediaBytes -= survivors[i].bytes;
    survivors[i] = null;
    changed = true;
  }
  for (let i = 0; i < survivors.length && textCount > TEXT_MAILBOX_LIMIT; i += 1) {
    if (!survivors[i] || survivors[i].kind !== 'text') continue;
    noteExpired(fingerprint, survivors[i].item, 'mailbox-full');
    textCount -= 1;
    survivors[i] = null;
    changed = true;
  }

  if (!changed) return false;
  const kept = survivors.filter(Boolean).map((entry) => entry.item);
  if (kept.length) offlineBoxes.set(fingerprint, kept);
  else offlineBoxes.delete(fingerprint);
  return true;
}

/* Runs when mail lands and once an hour for the boxes whose owners never
   came back — a queue nobody collects is the only one this sweep is the
   last to see. */
function sweepRetention(only = null) {
  const scope = only ? sanitizeFingerprint(only) : '';
  const fingerprints = scope ? [scope] : Array.from(offlineBoxes.keys());
  let changed = false;
  for (const fingerprint of fingerprints) {
    if (sweepMailbox(fingerprint)) changed = true;
  }
  if (changed) saveExpiryLog();
}

function loadSelfDestructRecords() {
  try {
    if (!fs.existsSync(SELF_DESTRUCT_STORE_PATH)) return new Map();
    const raw = JSON.parse(fs.readFileSync(SELF_DESTRUCT_STORE_PATH, 'utf8'));
    return new Map(Object.entries(raw || {}).map(([id, record]) => [
      sanitizeSelfDestructId(id),
      normalizeSelfDestructRecord(record),
    ]).filter(([id, record]) => id && record));
  } catch (error) {
    console.error('Failed to load self-destruct records:', error);
    return new Map();
  }
}

function saveSelfDestructRecords() {
  try {
    fs.mkdirSync(path.dirname(SELF_DESTRUCT_STORE_PATH), { recursive: true });
    fs.writeFileSync(SELF_DESTRUCT_STORE_PATH, JSON.stringify(Object.fromEntries(selfDestructRecords), null, 2));
  } catch (error) {
    console.error('Failed to save self-destruct records:', error);
  }
}

function sanitizeSelfDestructId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

function clampNonNegativeNumber(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function normalizeSelfDestructRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const id = sanitizeSelfDestructId(record.id);
  const payloadId = sanitizeSelfDestructId(record.payloadId);
  if (!id || !payloadId) return null;
  return {
    id,
    payloadId,
    timeLimitMs: clampNonNegativeNumber(record.timeLimitMs, 0, 30 * 24 * 60 * 60 * 1000),
    maxViews: clampNonNegativeNumber(record.maxViews, 0, 100000),
    opens: clampNonNegativeNumber(record.opens, 0, 100000000),
    createdAt: record.createdAt || new Date().toISOString(),
    firstOpenedAt: record.firstOpenedAt || null,
    updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
  };
}

function selfDestructRecordStatus(record) {
  const now = Date.now();
  const firstOpenedAtMs = record.firstOpenedAt ? Date.parse(record.firstOpenedAt) : 0;
  const expiresAtMs = record.timeLimitMs > 0 && firstOpenedAtMs ? firstOpenedAtMs + record.timeLimitMs : 0;
  const expired = Boolean(expiresAtMs && now >= expiresAtMs);
  const remainingViews = record.maxViews > 0 ? Math.max(0, record.maxViews - record.opens) : 0;
  return {
    expired,
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    remainingViews,
  };
}

function publicSelfDestructRecord(record) {
  return {
    id: record.id,
    timeLimitMs: record.timeLimitMs,
    maxViews: record.maxViews,
    opens: record.opens,
    createdAt: record.createdAt,
    firstOpenedAt: record.firstOpenedAt,
    updatedAt: record.updatedAt,
    ...selfDestructRecordStatus(record),
  };
}

function pruneSelfDestructRecords() {
  const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [id, record] of selfDestructRecords.entries()) {
    const touchedAtMs = Date.parse(record.updatedAt || record.firstOpenedAt || record.createdAt || '');
    if (touchedAtMs && touchedAtMs < cutoff) {
      selfDestructRecords.delete(id);
      changed = true;
    }
  }
  if (changed) saveSelfDestructRecords();
}

function touchPresence(record) {
  record.lastSeenAt = Date.now();
  record.updatedAt = new Date(record.lastSeenAt).toISOString();
}

function sanitizeFingerprint(value) {
  return String(value || '').trim().slice(0, 128);
}

/* ---- where a push endpoint is allowed to point ---------------------------
 *
 * /push/subscribe takes no credentials -- it cannot, because a device has to
 * be able to register before it has anything to authenticate with. That makes
 * the endpoint URL attacker-controlled, and this process will POST to it. Left
 * unchecked, anyone who can reach the relay can aim it at 169.254.169.254 and
 * read cloud credentials through the relay's own network position, or knock on
 * internal services that trusted the perimeter. They can fire it themselves by
 * relaying a persisted message to a fingerprint they just subscribed.
 *
 * So the address is resolved and judged before the row is stored, and again
 * before every send: a name that answered publicly at subscribe time can
 * answer 127.0.0.1 an hour later, which is the whole DNS-rebinding trick.
 * Redirects are refused outright rather than followed and re-checked -- a
 * distributor has no reason to bounce, and "refuse" has no edge cases.
 */
const ALLOW_PRIVATE_PUSH_ENDPOINTS = process.env.CHAT_ALLOW_PRIVATE_PUSH_ENDPOINTS === '1';

function isPrivateAddress(address, family) {
  const value = String(address || '');
  if (family === 6 || value.includes(':')) {
    const lower = value.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    // IPv4 wearing an IPv6 hat: ::ffff:127.0.0.1 reaches loopback just as well.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1], 4);
    const head = parseInt(lower.split(':')[0] || '0', 16);
    if ((head & 0xfe00) === 0xfc00) return true;   // fc00::/7  unique local
    if ((head & 0xffc0) === 0xfe80) return true;   // fe80::/10 link local
    if ((head & 0xff00) === 0xff00) return true;   // ff00::/8  multicast
    return false;
  }
  const parts = value.split('.').map((part) => parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 127) return true;                       // this host, loopback
  if (a === 10) return true;                                   // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true;            // RFC1918
  if (a === 192 && b === 168) return true;                     // RFC1918
  if (a === 169 && b === 254) return true;                     // link local, cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true;           // carrier NAT
  if (a === 192 && b === 0) return true;                       // protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true;        // benchmarking
  if (a >= 224) return true;                                   // multicast and reserved
  return false;
}

/** Resolves the host and answers whether every address it has is public. */
async function pushEndpointIsReachable(endpoint) {
  if (ALLOW_PRIVATE_PUSH_ENDPOINTS) return true;
  let url;
  try { url = new URL(endpoint); } catch (_error) { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  try {
    const addresses = await dns.lookup(url.hostname, { all: true });
    if (!addresses.length) return false;
    // Every answer must be public: one private address among several is still
    // a way in, and which one gets used is not ours to decide.
    return addresses.every(({ address, family }) => !isPrivateAddress(address, family));
  } catch (_error) {
    return false;
  }
}

function sanitizeSubscription(value) {
  if (!value || typeof value !== 'object') return null;
  const endpoint = String(value.endpoint || '').slice(0, 2048);
  if (!endpoint) return null;

  /* Two kinds of row live in this store.
   *
   * A browser's Push API subscription carries the two keys its vendor's
   * service needs to accept an encrypted payload. A UnifiedPush endpoint is
   * just a URL the distributor app on the phone handed out, with nothing to
   * encrypt to -- the distributor is the transport, and it is the person's own
   * choice of transport rather than Google's.
   *
   * The payload is the same either way, and it is the reason a bare URL is
   * acceptable here: it names no sender, carries no message text and says only
   * that something arrived. Anyone who learned the endpoint could make this
   * phone buzz. Nobody could learn anything from it. */
  if (String(value.type || '') === 'unifiedpush') {
    if (!/^https?:\/\//i.test(endpoint)) return null;
    return {
      type: 'unifiedpush',
      endpoint,
      expirationTime: null,
      lang: normalizePushLang(value.lang),
    };
  }

  const p256dh = String(value.keys?.p256dh || '').slice(0, 512);
  const auth = String(value.keys?.auth || '').slice(0, 512);
  if (!p256dh || !auth) return null;
  return {
    type: 'webpush',
    endpoint,
    expirationTime: value.expirationTime || null,
    keys: { p256dh, auth },
    /* Which language to write the notification in. */
    lang: normalizePushLang(value.lang),
  };
}

function loadPushSubscriptions() {
  try {
    if (!fs.existsSync(PUSH_STORE_PATH)) return new Map();
    const raw = JSON.parse(fs.readFileSync(PUSH_STORE_PATH, 'utf8'));
    return new Map(Object.entries(raw || {}).map(([fingerprint, items]) => [
      sanitizeFingerprint(fingerprint),
      Array.isArray(items) ? items.map(sanitizeSubscription).filter(Boolean) : [],
    ]).filter(([fingerprint, items]) => fingerprint && items.length));
  } catch (error) {
    console.error('Failed to load push subscriptions:', error);
    return new Map();
  }
}

function savePushSubscriptions() {
  try {
    /* A UnifiedPush endpoint is itself a capability: anybody holding one can
       make that phone buzz. Owner-only, for the same reason as the tokens. */
    writePrivateFile(PUSH_STORE_PATH, JSON.stringify(Object.fromEntries(pushSubscriptions), null, 2));
  } catch (error) {
    console.error('Failed to save push subscriptions:', error);
  }
}

function loadPolicyStore() {
  try {
    if (!fs.existsSync(POLICY_STORE_PATH)) return { suspendedUsers: {}, kickedUsers: {} };
    const raw = JSON.parse(fs.readFileSync(POLICY_STORE_PATH, 'utf8'));
    return {
      suspendedUsers: raw?.suspendedUsers && typeof raw.suspendedUsers === 'object' ? raw.suspendedUsers : {},
      kickedUsers: raw?.kickedUsers && typeof raw.kickedUsers === 'object' ? raw.kickedUsers : {},
    };
  } catch (error) {
    console.error('Failed to load server policy store:', error);
    return { suspendedUsers: {}, kickedUsers: {} };
  }
}

function savePolicyStore() {
  try {
    fs.mkdirSync(path.dirname(POLICY_STORE_PATH), { recursive: true });
    fs.writeFileSync(POLICY_STORE_PATH, JSON.stringify({
      suspendedUsers: Object.fromEntries(suspendedUsers),
      kickedUsers: Object.fromEntries(kickedUsers),
      allowedUsers: Object.fromEntries(allowedUsers),
      allowlistEnabled,
    }, null, 2));
  } catch (error) {
    console.error('Failed to save server policy store:', error);
  }
}

function identityKey(identity) {
  const fingerprint = sanitizeFingerprint(identity?.fingerprint);
  if (fingerprint) return fingerprint;
  const peerId = String(identity?.peerId || '').trim();
  if (peerId) return peerId;
  
  // Use IP as base for Guests. For multiple guests on same IP, we treat them as one for key stability.
  const ip = String(identity?.ip || '').split(',')[0].trim().replace('::ffff:', '');
  if (ip) {
    const username = String(identity?.username || '').trim().toLowerCase();
    // Treat all Guest IDs as the same 'guest' for the key to ensure stability across refreshes
    const userPart = (username === '' || username.startsWith('guest')) ? 'guest' : username;
    return `ip:${ip}:${userPart}`;
  }
  
  return String(identity?.clientId || '').trim().slice(0, 80);
}

function identitySnapshot(record = {}) {
  return {
    clientId: String(record.clientId || '').slice(0, 80),
    username: String(record.username || '').slice(0, 80),
    peerId: String(record.peerId || '').slice(0, 160),
    fingerprint: sanitizeFingerprint(record.fingerprint),
    ip: String(record.ip || '').split(',')[0].trim().replace('::ffff:', '').slice(0, 80),
  };
}

function identityMatchesPolicy(identity, policy) {
  const current = identitySnapshot(identity);
  
  // 1. Strong matches (Fingerprint or PeerID)
  if (policy.fingerprint && current.fingerprint && policy.fingerprint === current.fingerprint) return true;
  if (policy.peerId && current.peerId && policy.peerId === current.peerId) return true;
  
  // 2. IP-based matching (for guests or missing unique IDs)
  if (policy.ip && current.ip && policy.ip === current.ip) {
    const pUser = String(policy.username || '').trim().toLowerCase();
    const cUser = String(current.username || '').trim().toLowerCase();
    
    // If usernames match exactly, it's a match.
    if (pUser === cUser) return true;
    
    // If both are Guests (even with different numbers/IDs), consider it a match for IP-based ban.
    const pIsGuest = pUser === '' || pUser.startsWith('guest');
    const cIsGuest = cUser === '' || cUser.startsWith('guest');
    if (pIsGuest && cIsGuest) return true;
  }
  
  return false;
}

function sanitizePolicyDurationMinutes(value, fallback) {
  const minutes = Number(value || fallback);
  if (!Number.isFinite(minutes)) return fallback;
  return Math.max(1, Math.min(60 * 24 * 30, Math.round(minutes)));
}

function pruneExpiredPolicies() {
  const now = Date.now();
  let changed = false;
  for (const [key, policy] of suspendedUsers.entries()) {
    if (policy.expiresAt && policy.expiresAt <= now) {
      suspendedUsers.delete(key);
      changed = true;
    }
  }
  for (const [key, policy] of kickedUsers.entries()) {
    if (!policy.permanent && policy.expiresAt && policy.expiresAt <= now) {
      kickedUsers.delete(key);
      changed = true;
    }
  }
  if (changed) savePolicyStore();
}

function getRestrictionForIdentity(identity) {
  pruneExpiredPolicies();
  /* The allowlist is asked first. "Nobody unless invited" outranks "everybody
     except these", and asking it second would admit an uninvited peer for as
     long as it took to walk the deny lists. */
  if (allowlistEnabled) {
    const fingerprint = sanitizeFingerprint(identity?.fingerprint || '');
    if (!fingerprint || !allowedUsers.has(fingerprint)) {
      return { type: 'not-allowed', key: fingerprint || 'unknown', policy: { permanent: true } };
    }
  }
  for (const [key, policy] of suspendedUsers.entries()) {
    if (identityMatchesPolicy(identity, policy)) {
      return { type: 'suspended', key, policy };
    }
  }
  for (const [key, policy] of kickedUsers.entries()) {
    if (identityMatchesPolicy(identity, policy)) {
      return { type: 'kicked', key, policy };
    }
  }
  return null;
}

function listSuspensions() {
  pruneExpiredPolicies();
  return Array.from(suspendedUsers.entries()).map(([key, policy]) => ({ key, ...policy }));
}

function listActiveKickBans() {
  pruneExpiredPolicies();
  return Array.from(kickedUsers.entries()).map(([key, policy]) => ({ key, ...policy }));
}

function sendPolicyNotice(record, restriction) {
  if (!record?.ws || record.ws.readyState !== WebSocket.OPEN || !restriction) return;
  const now = Date.now();
  const policy = restriction.policy || {};
  const suspendedUntil = policy.expiresAt ? ` تا ${new Date(policy.expiresAt).toLocaleString('fa-IR')}` : '';
  const suspendedText = `دسترسی شما در سرور${suspendedUntil} به حالت تعلیق درآمده است. برای رفع تعلیق با ادمین سرور تماس بگیرید.`;
  const kickedText = policy.permanent
    ? 'اتصال شما با این سرور محدود شده است، لطفاً با ادمین تماس بگیرید.'
    : `اتصال شما از سرور قطع شد. امکان اتصال مجدد تا ${new Date(restriction.policy.expiresAt).toLocaleString('fa-IR')} وجود ندارد.`;
  const isNoticeCooldown = Boolean(policy.lastNoticeAt && now - policy.lastNoticeAt < POLICY_NOTICE_COOLDOWN_MS);
  safeSend(record.ws, {
    type: restriction.type === 'suspended' ? 'server-suspended' : 'server-kicked',
    message: restriction.type === 'suspended' ? suspendedText : kickedText,
    until: restriction.policy.expiresAt || null,
    permanent: Boolean(policy.permanent),
    silent: isNoticeCooldown,
    timestamp: Date.now(),
  });
  if (isNoticeCooldown) return;
  policy.lastNoticeAt = now;
  restriction.policy = policy;
  if (restriction.type === 'suspended' && restriction.key && suspendedUsers.has(restriction.key)) {
    suspendedUsers.set(restriction.key, { ...suspendedUsers.get(restriction.key), ...policy });
    savePolicyStore();
  }
  if (restriction.type === 'kicked' && restriction.key && kickedUsers.has(restriction.key)) {
    kickedUsers.set(restriction.key, { ...kickedUsers.get(restriction.key), ...policy });
    savePolicyStore();
  }
  safeSend(record.ws, {
    type: 'system-broadcast',
    kind: 'text',
    message: restriction.type === 'suspended' ? suspendedText : kickedText,
    timestamp: Date.now(),
  });
}

function disconnectRestrictedPeer(record, restriction) {
  sendPolicyNotice(record, restriction);
  setTimeout(() => {
    try {
      record.ws?.terminate();
    } catch (_error) {}
    presence.delete(record.clientId);
    broadcastPeers();
  }, 250);
}

async function sendPushNotification(toFingerprint, kind = 'chat') {
  const fingerprint = sanitizeFingerprint(toFingerprint);
  const subscriptions = pushSubscriptions.get(fingerprint) || [];
  /* Nothing to notify. This used to return in silence, which is how a device
     that had quietly fallen off push came to look exactly like one that had
     just been told: the relay queued the message, delivered it on the next
     connection, and never once said that nobody was woken for it. Say so.
     The index key rather than the fingerprint, because the whole point of
     hashing it is that this file does not hold a list of who talks to whom. */
  if (!subscriptions.length) {
    console.warn(`[Push] No subscription for ${key.slice(0, 12)}; ${kind} was delivered but nobody was woken for it.`);
    return;
  }

  /* Per row: each device said which language it reads when it subscribed. */
  const payloadFor = (subscription) => JSON.stringify({
    title: 'P00RIJA Cryptography',
    body: pushBodyFor(kind, subscription.lang),
    /* The service worker adds "N unread" when several arrive behind one row,
       and it has no way to read the app's language setting from where it runs.
       The row already records which language this device asked for, so the
       answer travels with the body it belongs to. */
    lang: normalizePushLang(subscription.lang),
    tag: pushTagFor(kind),
    url: './index.html#chat',
    data: {
      kind,
      timestamp: Date.now(),
    },
  });

  /* A UnifiedPush endpoint takes a plain POST. There is no vendor service in
     front of it and nothing to encrypt to: the distributor app on the phone
     receives the bytes and raises the notification. The body is the same
     contentless payload the browser path sends, so the distributor learns
     exactly what a push service learns, which is that something arrived. */
  const sendUnifiedPush = async (subscription) => {
    /* Checked again rather than trusted from subscribe time: a name that
       answered publicly an hour ago can answer 127.0.0.1 now, and that gap is
       the whole of DNS rebinding. */
    if (!await pushEndpointIsReachable(subscription.endpoint)) {
      const error = new Error('endpoint no longer resolves to a public address');
      error.statusCode = 410;
      throw error;
    }
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payloadFor(subscription),
      /* Refused rather than followed and re-checked. A distributor has no
         reason to redirect, and a 302 into the private range is the easiest
         way around a check that only looks at the first URL. */
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`UnifiedPush endpoint tried to redirect (${response.status}); refused`);
    }
    if (!response.ok) {
      const error = new Error(`UnifiedPush endpoint answered ${response.status}`);
      /* 404 and 410 mean the same here as they do for a vendor service: that
         endpoint is gone, and keeping it only produces failures forever. */
      error.statusCode = response.status;
      throw error;
    }
  };

  const remaining = [];
  let pruned = false;
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      if (subscription.type === 'unifiedpush') await sendUnifiedPush(subscription);
      else await webpush.sendNotification(subscription, payloadFor(subscription), pushSendOptions(kind));
      remaining.push(subscription);
    } catch (error) {
      if ([404, 410].includes(error?.statusCode)) {
        /* The vendor says this endpoint is gone for good. Dropping it silently
           left the person with a switch reading "on" and a phone that would
           never ring again, with nothing anywhere recording the moment it
           stopped. */
        console.warn(`[Push] ${error.statusCode} from the vendor for ${key.slice(0, 12)}; dropping a dead endpoint. That device gets nothing until it subscribes again.`);
        pruned = true;
      } else {
        console.error('Failed to send web push:', error?.statusCode || error?.message || error);
        remaining.push(subscription);
      }
    }
  }));

  if (remaining.length) {
    pushSubscriptions.set(fingerprint, remaining);
  } else {
    pushSubscriptions.delete(fingerprint);
  }
  /* A prune only in memory is undone by the next restart, and the relay goes
     back to pushing at an endpoint the vendor already called dead. */
  if (pruned || !remaining.length) savePushSubscriptions();
}

async function sendAdminPushNotification(toFingerprint, body, kind = 'admin-policy') {
  const fingerprint = sanitizeFingerprint(toFingerprint);
  const subscriptions = pushSubscriptions.get(fingerprint) || [];
  /* Nothing to notify. This used to return in silence, which is how a device
     that had quietly fallen off push came to look exactly like one that had
     just been told: the relay queued the message, delivered it on the next
     connection, and never once said that nobody was woken for it. Say so.
     The index key rather than the fingerprint, because the whole point of
     hashing it is that this file does not hold a list of who talks to whom. */
  if (!subscriptions.length) {
    console.warn(`[Push] No subscription for ${key.slice(0, 12)}; ${kind} was delivered but nobody was woken for it.`);
    return;
  }

  const payload = JSON.stringify({
    title: 'P00RIJA Cryptography',
    body,
    tag: `poorija-${kind}`,
    url: './index.html#chat',
    data: { kind, timestamp: Date.now() },
  });

  const remaining = [];
  let pruned = false;
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription, payload, pushSendOptions(kind));
      remaining.push(subscription);
    } catch (error) {
      if ([404, 410].includes(error?.statusCode)) {
        /* The vendor says this endpoint is gone for good. Dropping it silently
           left the person with a switch reading "on" and a phone that would
           never ring again, with nothing anywhere recording the moment it
           stopped. */
        console.warn(`[Push] ${error.statusCode} from the vendor for ${key.slice(0, 12)}; dropping a dead endpoint. That device gets nothing until it subscribes again.`);
        pruned = true;
      } else {
        console.error('Failed to send admin web push:', error?.statusCode || error?.message || error);
        remaining.push(subscription);
      }
    }
  }));

  if (remaining.length) {
    pushSubscriptions.set(fingerprint, remaining);
  } else {
    pushSubscriptions.delete(fingerprint);
  }
  /* See sendPushNotification. */
  if (pruned || !remaining.length) savePushSubscriptions();
}

const presence = new Map();
let guestCounter = 0;

function snapshotPeers() {
  return Array.from(presence.values())
    .filter((client) => client.peerId)
    .filter((client) => !getRestrictionForIdentity(client))
    .map((client) => ({
      clientId: client.clientId,
      username: client.username || `User ${client.guestId || ''}`,
      peerId: client.peerId,
      publicKeyData: client.publicKeyData || '',
      fingerprint: client.fingerprint || '',
      avatarData: client.avatarData || '',
      status: 'online',
      updatedAt: client.updatedAt,
    }));
}


let broadcastTimer = null;
function broadcastPeers() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const payload = JSON.stringify({
      type: 'peers',
      peers: snapshotPeers(),
    });

    for (const client of presence.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }, 100);
}

let totalMessagesReceived = 0;
let totalMessagesSent = 0;
let totalBytesReceived = 0;
let totalBytesSent = 0;
let totalRelays = 0;

/* A client that stops reading its socket leaves every frame sent to it
   buffered inside this process — an unread mailbox handover is the easiest
   way to balloon memory without sending anything yourself. No legitimate
   reader falls this far behind, so past this point the socket is dropped. */
const SEND_BUFFER_LIMIT_BYTES = 16 * 1024 * 1024;

function safeSend(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    if (ws.bufferedAmount > SEND_BUFFER_LIMIT_BYTES) {
      if (!ws.__poorijaSendOverflow) {
        ws.__poorijaSendOverflow = true;
        console.warn('[Presence] Send buffer above 16 MB — terminating a socket that never reads.');
      }
      ws.terminate();
      return;
    }
    const payload = JSON.stringify(message);
    totalMessagesSent++;
    totalBytesSent += Buffer.byteLength(payload);
    ws.send(payload);
  }
}

/* Only a socket that proved the identity behind the fingerprint may be
   routed to by it — otherwise mail lands on whoever claimed the name. A
   reconnect leaves two sockets holding the same fingerprint for a moment,
   so the most recently active one wins rather than the first found. */
function findOpenPresenceByFingerprint(fingerprint = '') {
  if (!fingerprint) return null;
  return Array.from(presence.values())
    .filter((client) =>
      client.ws?.readyState === WebSocket.OPEN
      && client.fingerprint
      && client.fingerprint === fingerprint
      && client.identityVerified)
    .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))[0] || null;
}

/* Everything hello used to hand over on the strength of a claim: the mailbox
   sweep, the batched delivery and the expiry notices. It moved behind the
   identity proof and now runs one round trip later, unchanged. */
/* How many envelopes may be with a recipient at once, unacknowledged. A whole
   mailbox at once would be a burst of hundreds of megabytes into a socket that
   cannot refuse it; one at a time would cost a round trip per envelope. */
const MAIL_WINDOW = 50;

/* Sends whatever the window has room for, skipping what this connection has
   already been handed.

   It used to slice the first MAIL_WINDOW off the queue each time, which was
   wrong in both directions. The same envelopes went out again on every top-up,
   so a recipient collecting a file received most of it several times over. And
   the top-up only happened on an ACK that actually removed something -- so
   once the recipient had acknowledged everything it held, no further ACK
   changed anything, nothing triggered the next send, and each side sat waiting
   for the other. Delivery stopped dead after about MAIL_WINDOW envelopes and
   only a reconnection moved it on. Nothing reported this: a file simply
   advanced a few megabytes per reconnect and looked like a slow network.

   Tracking what this connection has been sent fixes both. The set belongs to
   the connection, not to the mailbox, so a reconnection re-sends anything that
   was in flight when the socket went -- which is what makes an unacknowledged
   envelope safe to drop. */
function pumpHeldMail(record, ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const queued = offlineBoxes.get(record.fingerprint) || [];
  if (!queued.length) return;
  if (!record.sentMail) record.sentMail = new Set();

  let inFlight = record.sentMail.size;
  for (const item of queued) {
    if (inFlight >= MAIL_WINDOW) break;
    if (record.sentMail.has(item.relayId)) continue;
    safeSend(ws, item);
    record.sentMail.add(item.relayId);
    inFlight += 1;
  }
}

function deliverHeldMail(record, ws) {
  // Expire before delivering, so nothing stale is handed over and the
  // notices below reflect what actually happened while they were away.
  if (record.fingerprint) sweepRetention(record.fingerprint);

  const queued = offlineBoxes.get(record.fingerprint) || [];
  if (queued.length) {
    console.log(`[Presence] Delivering ${queued.length} queued messages to ${record.fingerprint}`);
    /* A fresh start for this socket: whatever a previous one was sent went
       with it, and anything unacknowledged has to come round again. */
    record.sentMail = new Set();
    pumpHeldMail(record, ws);
  }

  /* Somebody wrote to them and it did not survive the wait. Saying so is
     the difference between a message that was lost and a message the
     recipient never knew existed. */
  const notices = expiryLog.filter((entry) => entry.fingerprint === record.fingerprint && !entry.delivered);
  if (notices.length) {
    console.log(`[Presence] Reporting ${notices.length} expired item(s) to ${record.fingerprint}`);
    safeSend(ws, {
      type: 'expired-notice',
      items: notices.map((entry) => ({
        from: entry.from,
        class: entry.class,
        reason: entry.reason,
        queuedAt: entry.queuedAt,
        expiredAt: entry.expiredAt,
      })),
    });
    notices.forEach((entry) => { entry.delivered = true; });
    saveExpiryLog();
  }
}

/* ------------------------------------------------------------------
 * Identity proof
 *
 * The fingerprint in a hello was self-declared: whoever typed it collected
 * the mail queued for it and could ACK it away. The identity key behind
 * the fingerprint is the only thing that can settle the claim, so hello
 * seals a random nonce with the claimed public key and only the holder of
 * the matching private key can open it and return it.
 * ------------------------------------------------------------------ */
const IDENTITY_CHALLENGE_TIMEOUT_MS = 15 * 1000;

function clearIdentityChallenge(record) {
  if (!record) return;
  if (record.idChallengeTimer) {
    clearTimeout(record.idChallengeTimer);
    record.idChallengeTimer = null;
  }
  record.idChallengeNonce = null;
}

function beginIdentityChallenge(record) {
  clearIdentityChallenge(record);
  record.identityVerified = false;
  const nonce = crypto.randomBytes(32);
  /* The key travels as base64 SPKI; publicEncrypt wants it dressed as a PEM. */
  const body = String(record.publicKeyData || '').replace(/\s+/g, '');
  const pem = `-----BEGIN PUBLIC KEY-----\n${(body.match(/.{1,64}/g) || []).join('\n')}\n-----END PUBLIC KEY-----`;
  try {
    const cipher = crypto.publicEncrypt(
      { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      nonce,
    );
    record.idChallengeNonce = nonce;
    /* No answer inside the window keeps the socket's degraded presence, but
       nothing keyed to the claimed identity answers to it afterwards. */
    record.idChallengeTimer = setTimeout(() => {
      if (record.idChallengeNonce) {
        clearIdentityChallenge(record);
        safeSend(record.ws, { type: 'error', reason: 'identity-unverified' });
      }
    }, IDENTITY_CHALLENGE_TIMEOUT_MS);
    record.idChallengeTimer.unref?.();
    safeSend(record.ws, { type: 'id-challenge', cipher: cipher.toString('base64') });
  } catch (error) {
    /* A key that cannot be used to seal a challenge is not one this relay
       can take a fingerprint's word for. */
    console.warn(`[Presence] Could not challenge ${record.fingerprint}: ${error?.message || error}`);
    safeSend(record.ws, { type: 'error', reason: 'identity-unverified' });
  }
}

/* Same ceiling as the relay frames: a hello carries an avatar but nothing
   near this size, and an unbounded frame is buffered before it is parsed. */
const wsServer = new WebSocketServer({ server: presenceServer, path: '/chat-signal', maxPayload: 12 * 1024 * 1024 });
wsServer.on('error', (error) => console.error('[Presence] WebSocket server error:', error));

// Ensure data directory exists
try {
  fs.mkdirSync(path.dirname(PUSH_STORE_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(OFFLINE_STORE_PATH), { recursive: true });
} catch (_e) {}

wsServer.on('connection', (ws, req) => {
  const clientId = crypto.randomUUID();
  const ip = requestIp(req);
  guestCounter++;
  const guestId = guestCounter;

  console.log(`[Presence] New connection from ${ip}, clientId: ${clientId}`);

  const record = {
    clientId,
    ws,
    guestId,
    ip,
    username: '',
    peerId: '',
    publicKeyData: '',
    fingerprint: '',
    /* Flipped only by a proven id-challenge answer (or the escape hatch). */
    identityVerified: false,
    avatarData: '',
    updatedAt: new Date().toISOString(),
    lastSeenAt: Date.now(),
    connectedAt: Date.now(),
  };

  presence.set(clientId, record);
  const initialRestriction = getRestrictionForIdentity(record);
  if (initialRestriction) {
    disconnectRestrictedPeer(record, initialRestriction);
    return;
  }
  safeSend(ws, { type: 'welcome', clientId, guestId });

  ws.on('message', (raw) => {
    totalMessagesReceived++;
    totalBytesReceived += raw.length;

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (_error) {
      safeSend(ws, { type: 'error', reason: 'invalid-json' });
      return;
    }
    touchPresence(record);

    if (message.type === 'hello') {
      record.username = String(message.username || '').slice(0, 80);
      record.peerId = String(message.peerId || '').slice(0, 160);
      record.publicKeyData = String(message.publicKeyData || '');
      record.fingerprint = sanitizeFingerprint(message.fingerprint);
      record.avatarData = String(message.avatarData || '').slice(0, 2000000);

      const restriction = getRestrictionForIdentity(record);
      if (restriction) {
        console.log(`[Presence] Restricted peer rejected after hello: ${record.username} (${restriction.type})`);
        disconnectRestrictedPeer(record, restriction);
        return;
      }
      console.log(`[Presence] Peer identified: ${record.username} (${record.peerId}) fingerprint: ${record.fingerprint}`);

      /* The key and the fingerprint must describe the same identity before
         anything else is checked: the fingerprint IS sha256 of the SPKI, so
         a key that hashes to something else is a claim with the wrong proof
         attached. */
      if (record.publicKeyData) {
        let claimedKeyDigest = '';
        try {
          claimedKeyDigest = crypto.createHash('sha256')
            .update(Buffer.from(record.publicKeyData, 'base64'))
            .digest('hex');
        } catch (_error) { /* undecodable key; the comparison below answers it */ }
        if (claimedKeyDigest !== record.fingerprint) {
          console.warn(`[Presence] Identity mismatch from ${record.ip}: key does not hash to ${record.fingerprint}`);
          safeSend(ws, { type: 'error', reason: 'identity-mismatch' });
          try { ws.close(4403, 'identity-mismatch'); } catch (_error) {}
          presence.delete(clientId);
          broadcastPeers();
          return;
        }
      }

      if (!IDENTITY_PROOF_REQUIRED) {
        /* Escape hatch: the claim itself counts as the proof, as before. */
        clearIdentityChallenge(record);
        record.identityVerified = true;
        deliverHeldMail(record, ws);
        broadcastPeers();
        return;
      }

      if (record.publicKeyData) {
        /* Mail waits one round trip: only the private key matching the
           claimed fingerprint can open the challenge and echo it back. */
        beginIdentityChallenge(record);
      } else {
        /* Nothing to seal a challenge with means nothing was proven either;
           the fingerprint stays unverified — presence continues, but the
           mailbox and the ACKs do not answer to this socket. */
        clearIdentityChallenge(record);
        record.identityVerified = false;
        safeSend(ws, { type: 'error', reason: 'identity-unverified' });
      }
      broadcastPeers();
      return;
    }

    if (message.type === 'id-proof') {
      if (!record.idChallengeNonce) {
        safeSend(ws, { type: 'error', reason: 'identity-unverified' });
        return;
      }
      let proven = false;
      try {
        const answer = Buffer.from(String(message.nonce || ''), 'base64');
        proven = answer.length === record.idChallengeNonce.length
          && crypto.timingSafeEqual(answer, record.idChallengeNonce);
      } catch (_error) { /* a malformed answer counts as no answer */ }
      if (proven) {
        clearIdentityChallenge(record);
        record.identityVerified = true;
        console.log(`[Presence] Identity proven for ${record.fingerprint}`);
        deliverHeldMail(record, ws);
      } else {
        /* Wrong answer: the nonce is spent so it cannot be guessed at again,
           and the socket stays with its degraded presence until a later
           hello proves otherwise. */
        clearIdentityChallenge(record);
        safeSend(ws, { type: 'error', reason: 'identity-unverified' });
      }
      return;
    }

    if (message.type === 'relay-ack') {
      /* An ACK destroys mail, so only the proven owner of the fingerprint
         may spend one. */
      if (!record.identityVerified) {
        safeSend(ws, { type: 'error', reason: 'identity-unverified' });
        return;
      }
      const ids = Array.isArray(message.ids) ? message.ids : [];
      const queued = offlineBoxes.get(record.fingerprint) || [];
      if (queued.length && ids.length) {
        /* A Set, because the app acknowledges one envelope per message and a
           file is thousands of them: an includes() per queued item per ACK is
           the same quadratic the retention sweep used to have. */
        const acked = new Set(ids);
        const next = queued.filter(msg => !acked.has(msg.relayId));
        if (next.length !== queued.length) {
          console.log(`[Presence] ACK received for ${queued.length - next.length} messages from ${record.fingerprint}`);
          if (next.length) {
            offlineBoxes.set(record.fingerprint, next);
          } else {
            offlineBoxes.delete(record.fingerprint);
          }
          saveOfflineBoxes();
        }
        /* The window reopens by whatever was acknowledged, whether or not it
           was still in the mailbox -- an ACK for something already gone is a
           duplicate, and treating it as nothing to do is what used to leave
           both sides waiting. */
        if (record.sentMail) for (const id of acked) record.sentMail.delete(id);
        pumpHeldMail(record, ws);
      }
      return;
    }

    if (message.type === 'relay') {
      const senderRestriction = getRestrictionForIdentity(record);
      if (senderRestriction) {
        disconnectRestrictedPeer(record, senderRestriction);
        return;
      }
      totalRelays++;
      const toFingerprint = String(message.toFingerprint || '').slice(0, 128);
      /* Echoed back on every reply so the sender can line a refusal or a
         queue confirmation up with the message it was sent for. */
      const tag = String(message.tag || '').slice(0, 96);
      /* clientId routing is positional; fingerprint routing additionally
         requires the target to have proven the identity it claims. */
      const target = presence.get(String(message.toClientId || '')) ||
        findOpenPresenceByFingerprint(toFingerprint);

      const payloadType = String(message.payload?.type || 'unknown');

      const targetRestriction = target
        ? getRestrictionForIdentity(target)
        : (toFingerprint ? getRestrictionForIdentity({ fingerprint: toFingerprint }) : null);
      if (targetRestriction) {
        console.warn(`[Relay] Blocked delivery to restricted target ${toFingerprint || message.toClientId}`);
        safeSend(ws, { type: 'error', reason: 'target-restricted', toClientId: message.toClientId || '', toFingerprint, tag });
        return;
      }

      if (!target) {
        if (message.persist && toFingerprint) {
          console.log(`[Relay] Target offline, queuing ${payloadType} for ${toFingerprint}`);
          const queued = offlineBoxes.get(toFingerprint) || [];
          queued.push({
            type: 'relay',
            relayId: crypto.randomUUID(),
            fromClientId: clientId,
            fromFingerprint: record.fingerprint,
            payload: message.payload || null,
            queuedAt: new Date().toISOString(),
          });
          offlineBoxes.set(toFingerprint, queued);
          /* Retention and the caps decide what stays — media bytes first,
             then the text tail — and the sweep logs anything it drops. */
          sweepRetention(toFingerprint);
          saveOfflineBoxes();
          const remaining = offlineBoxes.get(toFingerprint);
          safeSend(ws, { type: 'queued', toFingerprint, count: remaining ? remaining.length : 0, tag });
          sendPushNotification(toFingerprint, payloadType).catch((error) => console.error(error));
          return;
        }
        console.warn(`[Relay] Target not found for ${payloadType} to ${message.toClientId || toFingerprint}`);
        safeSend(ws, { type: 'error', reason: 'target-offline', toClientId: message.toClientId || '', tag });
        return;
      }

      safeSend(target.ws, {
        type: 'relay',
        fromClientId: clientId,
        fromFingerprint: record.fingerprint,
        payload: message.payload || null,
      });
      return;
    }

    if (message.type === 'ping') {
      safeSend(ws, { type: 'pong', timestamp: Date.now() });
      return;
    }
    if (message.type === 'get-peers') {
      safeSend(ws, { type: 'peers', peers: snapshotPeers() });
      return;
    }
  });

  ws.on('close', (code, reason) => {
    clearIdentityChallenge(record);
    console.log(`[Presence] Connection closed for ${clientId} (${record.username}). Code: ${code}, Reason: ${reason}`);
    presence.delete(clientId);
    broadcastPeers();
  });

  ws.on('error', (error) => {
    clearIdentityChallenge(record);
    console.error(`[Presence] Connection error for ${clientId} (${record.username}):`, error);
    presence.delete(clientId);
    broadcastPeers();
  });
});

setInterval(() => {
  let changed = false;
  const now = Date.now();
  for (const [clientId, record] of presence.entries()) {
    if (record.ws.readyState !== WebSocket.OPEN) {
      console.log(`[Presence] Cleaning up non-open connection for ${clientId}`);
      presence.delete(clientId);
      changed = true;
    } else if (now - (record.lastSeenAt || 0) > PRESENCE_TTL_MS) {
      console.log(`[Presence] Connection timeout for ${clientId} (${record.username}). Last seen: ${now - record.lastSeenAt}ms ago`);
      presence.delete(clientId);
      try {
        record.ws.terminate();
      } catch (_error) {
        // The socket may already be closed.
      }
      changed = true;
    }
  }
  if (changed) broadcastPeers();
}, 30000).unref?.();

setInterval(() => {
  pruneSelfDestructRecords();
}, 6 * 60 * 60 * 1000).unref?.();

/* The hourly walk catches mail belonging to people who never come back to
   collect it; the queue-push sweep only ever sees the box it just filled. */
setInterval(() => {
  sweepRetention();
  saveOfflineBoxes();
}, 60 * 60 * 1000).unref?.();

server.listen(PORT, HOST, () => {
  console.log(`Poorija chat signal server listening on http://${HOST}:${PORT}`);
  console.log(`Monitoring Dashboard available at http://${HOST}:${PORT}/Monitor_Server`);
});

presenceServer.listen(PRESENCE_PORT, HOST, () => {
  console.log(`Poorija chat presence socket listening on ws://${HOST}:${PRESENCE_PORT}/chat-signal`);
});

/* The debounce trades immediacy for fewer writes; a shutdown must not trade
   the mail itself away, so whatever is still pending is flushed first. */
process.on('SIGTERM', () => {
  flushOfflineBoxes();
  process.exit(0);
});
process.on('SIGINT', () => {
  flushOfflineBoxes();
  process.exit(0);
});
