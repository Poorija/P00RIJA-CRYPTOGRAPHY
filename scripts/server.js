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
const os = require('os');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const express = require('express');
const { ExpressPeerServer } = require('peer');
const webpush = require('web-push');
const { pushKindFor, pushBodyFor, pushTagFor, normalizePushLang, pushSendOptions } = require('./lib/push-wording.js');
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
const OFFLINE_STORE_DIR = process.env.CHAT_OFFLINE_STORE_DIR
  || path.join(path.dirname(OFFLINE_STORE_PATH), 'mailboxes');

const POLICY_STORE_PATH = process.env.CHAT_POLICY_STORE_PATH || path.join(path.dirname(OFFLINE_STORE_PATH), 'server-policy.json');
const SELF_DESTRUCT_STORE_PATH = process.env.CHAT_SELF_DESTRUCT_STORE_PATH || path.join(path.dirname(OFFLINE_STORE_PATH), 'self-destruct-records.json');

/* ------------------------------------------------------------------
 * Store-and-forward retention.
 *
 * Two classes, because they cost the server very different things. Text is a
 * few hundred bytes and is kept until it is delivered, however long that
 * takes — losing someone's message because they were away for a fortnight is
 * not a resource decision anybody would defend. Media is megabytes, so it is
 * held for a week and then dropped, leaving behind only a note saying that
 * something arrived and expired, which is what the recipient is told when they
 * next connect.
 *
 * The relay can only tell the two apart because the sender labels the envelope
 * `class: 'text' | 'media'`. That label, the two fingerprints and the
 * timestamps are the whole of what this feature exposes; the body stays sealed
 * under a key wrapped to the recipient.
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------
 * Capacity profile
 *
 * The ceilings below used to be fixed numbers, which means the same relay is
 * simultaneously too generous on a 1 GB VPS — where a full set of mailboxes
 * would exhaust the machine before any limit was reached — and far too mean on
 * a 64 GB box, where it refuses work the hardware would not notice.
 *
 * So they are derived from what the machine actually has, and clamped at both
 * ends: a floor so a tiny instance still works, and a ceiling so a huge one
 * does not promise more than the process can hold. Every value stays
 * overridable by environment variable, which is what the tests and the
 * deployment tooling use.
 *
 * The numbers come from what was measured on this codebase rather than from a
 * rule of thumb: a connected peer costs a socket, a presence record and a
 * heartbeat, which is small, and 1600 of them made no measurable difference to
 * delivery latency (1 ms p95, unchanged from 25 peers). Sockets are therefore
 * budgeted generously against RAM. Mailboxes are the opposite — they are real
 * bytes on disk and in the JSON store — so those are budgeted tightly.
 * ------------------------------------------------------------------ */
function capacityProfile() {
  const cpuCount = Math.max(1, os.cpus()?.length || 1);
  const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, Math.round(value)));

  /* Tier is only used for reporting and for the coarse decisions below; the
     numbers themselves are continuous, so a machine near a boundary does not
     fall off a cliff. */
  const tier = totalMemMb < 1536 ? 'small'
    : totalMemMb < 6144 ? 'medium'
      : totalMemMb < 24576 ? 'large' : 'xlarge';

  return {
    cpuCount,
    totalMemMb,
    tier,
    /* ~1 socket per 0.35 MB of RAM, floor 500, ceiling 50k. At 1 GB that is
       ~2900; at 64 GB the ceiling bites long before the RAM does. */
    wsMaxTotal: clamp(totalMemMb / 0.35, 500, 50000),
    /* A household behind one NAT is a handful of devices and tabs. It scales
       with the machine so a big relay can host a big office. */
    wsMaxPerIp: clamp(20 + totalMemMb / 256, 20, 400),
    /* Mailbox bytes per recipient. Disk, not RAM, but the store is read into
       memory to be rewritten, so RAM is the honest constraint. */
    mediaQuotaBytes: clamp(totalMemMb * 0.35, 128, 4096) * 1024 * 1024,
    /* Requests a minute per address. More cores means more capacity to absorb
       a burst without it costing anyone else. */
    rateDefault: clamp(150 * cpuCount, 150, 3000),
    rateWrite: clamp(30 * cpuCount, 30, 600),
    /* Text entries per mailbox. Cheap, so this stays generous everywhere. */
    textMailboxLimit: clamp(totalMemMb * 4, 1000, 100000),
  };
}

const CAPACITY = capacityProfile();
/* Identifies this process in a pool. Behind a load balancer it is the only way
   to tell which instance answered.
   Deliberately NOT the hostname: this appears in a public health response, and
   an internal machine name is free reconnaissance for anyone mapping the
   deployment. A random handle distinguishes instances just as well. */
const INSTANCE_ID = process.env.CHAT_INSTANCE_ID
  || `relay-${crypto.randomBytes(4).toString('hex')}`;
let shuttingDown = false;

const MEDIA_RETENTION_MS = Number(process.env.CHAT_MEDIA_RETENTION_MS || 7 * 24 * 60 * 60 * 1000);
const MEDIA_QUOTA_BYTES = Number(process.env.CHAT_MEDIA_QUOTA_BYTES || CAPACITY.mediaQuotaBytes);
const EXPIRY_LOG_RETENTION_MS = Number(process.env.CHAT_EXPIRY_LOG_RETENTION_MS || 30 * 24 * 60 * 60 * 1000);
/* A session offer to somebody who is not there is worth holding briefly — long
   enough for them to open the app that evening or the next — but a reservation
   nobody claims is just a stranger's key sitting on a server. */
const SESSION_RESERVATION_MS = Number(process.env.CHAT_SESSION_RESERVATION_MS || 72 * 60 * 60 * 1000);
const RETENTION_SWEEP_MS = Number(process.env.CHAT_RETENTION_SWEEP_MS || 15 * 60 * 1000);
/* Text costs almost nothing, but "unlimited" with no ceiling at all is how a
   relay becomes someone's free storage. This is high enough that a real user
   will never reach it. */
const TEXT_MAILBOX_LIMIT = Number(process.env.CHAT_TEXT_MAILBOX_LIMIT || CAPACITY.textMailboxLimit);
const EXPIRY_LOG_PATH = process.env.CHAT_EXPIRY_LOG_PATH || path.join(path.dirname(OFFLINE_STORE_PATH), 'expiry-log.json');

const TURN_URL = process.env.CHAT_TURN_URL || `turn:${DOMAIN}:3478?transport=udp,turn:${DOMAIN}:3478?transport=tcp,turns:${DOMAIN}:5349?transport=tcp`;
/* No default worth shipping.
 *
 * This fell back to one deployment's own TURN username, so any relay whose
 * .env did not set TURN_USER handed that name out to every client through
 * /turn-config -- a credential half belonging to somebody else, on somebody
 * else's server, offered to everyone who opened the app.
 *
 * Empty is the honest answer for a relay nobody has configured TURN on. The
 * client already refuses a turn: entry that has no username or no credential
 * and says so, which is better than a name that will fail authentication
 * somewhere the failure reads as "calls do not work". */
const TURN_USERNAME = process.env.CHAT_TURN_USERNAME || process.env.TURN_USER || '';
const TURN_CREDENTIAL = process.env.CHAT_TURN_CREDENTIAL || process.env.TURN_PASSWORD || '';
const PRESENCE_TTL_MS = Number(process.env.CHAT_PRESENCE_TTL_MS || 90000);
/* Two different questions, and answering the second with the first is what
   makes a backgrounded phone look reachable when it is not.
     - is the SOCKET alive?  lastSeenAt, refreshed by the TCP pong, which the
       browser's network stack answers from inside the OS even while the
       page's JavaScript is frozen. Right for connection cleanup.
     - is the APP awake?     lastActiveAt, refreshed only by a frame the page
       itself sent. The client heartbeats every 10s, so a frozen tab stops
       within one interval. This is the one that decides whether a message can
       be delivered live or has to wake the device.
   Two and a half missed heartbeats: long enough that a slow network is not
   mistaken for a frozen app, short enough that the person who backgrounded
   their phone still gets the next message as a notification. */
const APP_AWAKE_TTL_MS = Number(process.env.CHAT_APP_AWAKE_TTL_MS || 25000);
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
    writeJsonAtomic(CONFIG_PATH, { monitorPassword: MONITOR_PASSWORD });
  } catch (error) {
    console.error('Failed to save server config:', error);
  }
}

loadServerConfig();

/* Everything this relay keeps on disk is either a secret or somebody's queued
   ciphertext, and none of it should be world-readable. New files are created
   0600 by writeJsonAtomic, but a relay upgraded in place still has the 0644
   files an older build wrote — including server-config.json, which holds the
   monitor password in the clear. One pass at startup brings them into line.
   Failures are ignored on purpose: a filesystem without Unix modes (a bind
   mount from Windows, some container overlays) is not a reason to refuse to
   start. */
function hardenStateFilePermissions(directory, depth = 0) {
  if (depth > 2) return;
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_error) { return; }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    try {
      if (entry.isDirectory()) {
        fs.chmodSync(full, 0o700);
        hardenStateFilePermissions(full, depth + 1);
      } else if (entry.isFile()) {
        fs.chmodSync(full, 0o600);
      }
    } catch (_error) { /* no modes here, or not ours to change */ }
  }
}
try {
  fs.mkdirSync(path.dirname(OFFLINE_STORE_PATH), { recursive: true });
  fs.chmodSync(path.dirname(OFFLINE_STORE_PATH), 0o700);
  hardenStateFilePermissions(path.dirname(OFFLINE_STORE_PATH));
} catch (_error) { /* see above */ }

/* The monitor is the control panel for this server: it reads the mailbox
 * counters, changes retention, disconnects clients and rotates its own
 * password. Starting it behind a compiled-in "admin123456" whenever the
 * environment forgot to set one is a door that opens by default on a service
 * whose whole job is to be reachable from the internet — and a warning printed
 * to a log nobody reads is not a lock.
 *
 * ALLOW_INSECURE_DEFAULTS was already declared for exactly this and then never
 * consulted, so the fallback applied unconditionally. It is consulted now:
 * without a real password this refuses to start, and the escape hatch has to be
 * asked for out loud.
 */
if (!MONITOR_PASSWORD || MONITOR_PASSWORD.length < 12) {
  if (ALLOW_INSECURE_DEFAULTS) {
    console.warn('WARNING: MONITOR_PASSWORD is short or unset and ALLOW_INSECURE_DEFAULTS=1.');
    console.warn('WARNING: falling back to "admin123456". Do not do this on a reachable host.');
    if (!MONITOR_PASSWORD) MONITOR_PASSWORD = 'admin123456';
  } else {
    console.error('MONITOR_PASSWORD is missing or shorter than 12 characters.');
    console.error('The monitor controls this relay, so it will not start without one.');
    console.error('Set MONITOR_PASSWORD in .env, or set ALLOW_INSECURE_DEFAULTS=1 to accept the risk.');
    process.exit(1);
  }
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
const TRUSTED_PROXY_HOPS = Math.max(0, Number(process.env.CHAT_TRUSTED_PROXIES ?? 1) || 0);
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
app.use('/fonts', express.static(path.join(__dirname, '..', 'fonts')));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
/* ------------------------------------------------------------------
 * Ceilings
 *
 * 50mb applied to every route, authenticated or not, so an anonymous caller
 * could make the process buffer and parse fifty megabytes of JSON as often as
 * it liked. Nothing this server accepts over HTTP is remotely that large —
 * the big payloads travel over the WebSocket, which has its own accounting.
 * The self-destruct record endpoint is the only one that carries real
 * ciphertext, and it gets its own, larger, ceiling.
 * ------------------------------------------------------------------ */
const JSON_BODY_LIMIT = process.env.CHAT_JSON_BODY_LIMIT || '256kb';
const JSON_BODY_LIMIT_RECORDS = process.env.CHAT_JSON_RECORD_LIMIT || '8mb';
app.use('/self-destruct/records', express.json({ limit: JSON_BODY_LIMIT_RECORDS }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));

/* Express advertises itself in a header on every response, which tells an
   attacker which CVE list to read first. */
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'interest-cohort=(), browsing-topics=()');
  /* Only over TLS: sending HSTS from a plain-http LAN deployment would pin
     browsers to https for a host that does not speak it. */
  if (req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

/* ------------------------------------------------------------------
 * Rate limiting
 *
 * A fixed-window counter per address. Deliberately dependency-free and
 * in-memory: this is a single-process relay, and the point is to blunt a
 * flood from one source, not to be a WAF. Behind a proxy it relies on
 * `trust proxy` being set, which it is.
 *
 * The buckets are separate because the traffic is: a browser polls health
 * often and legitimately, while eight login attempts a minute from one
 * address is already someone guessing.
 * ------------------------------------------------------------------ */
const RATE_LIMIT_WINDOW_MS = Number(process.env.CHAT_RATE_WINDOW_MS || 60_000);
const RATE_LIMITS = {
  default: Number(process.env.CHAT_RATE_DEFAULT || CAPACITY.rateDefault),
  /* Login is not scaled with the hardware: ten guesses a minute is the right
     answer on any machine, and a faster server should not make guessing
     faster. */
  login: Number(process.env.CHAT_RATE_LOGIN || 10),
  write: Number(process.env.CHAT_RATE_WRITE || CAPACITY.rateWrite),
};
const rateBuckets = new Map();

function rateKey(req) {
  /* Never requestIp(): a bucket an attacker can rename is not a bucket. */
  return securityKey(req);
}

function rateLimit(bucketName) {
  const ceiling = RATE_LIMITS[bucketName] ?? RATE_LIMITS.default;
  return (req, res, next) => {
    /* A CORS preflight is not a request for anything: it carries no
       credentials, performs no work, and the browser sends it on its own
       before the call the caller actually made. Counting it charged every
       cross-origin client twice and halved its real allowance.
       Worse, these middlewares run BEFORE the CORS handler below, so a
       preflight rejected here goes back without Access-Control-Allow-Origin
       and the browser cannot read the 429 at all — the desktop monitor showed
       "Failed to fetch" with nothing to explain it, which is how this was
       found. */
    if (req.method === 'OPTIONS') return next();
    const key = `${bucketName}:${rateKey(req)}`;
    const now = Date.now();
    let entry = rateBuckets.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      rateBuckets.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, ceiling - entry.count);
    res.setHeader('X-RateLimit-Limit', String(ceiling));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > ceiling) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ ok: false, reason: 'rate-limited' });
    }
    return next();
  };
}

/* Unbounded growth here would be its own denial of service. */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateBuckets) {
    if (entry.resetAt <= now) rateBuckets.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS).unref?.();

app.use('/admin/login', rateLimit('login'));
app.use('/admin', rateLimit('write'));
app.use('/push', rateLimit('write'));
app.use('/self-destruct', rateLimit('write'));
app.use(rateLimit('default'));
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
/* A VAPID pair identifies this server to the browser vendors' push services.
   Generating one per process meant every restart silently invalidated every
   subscription anyone had made — the endpoint stays valid, the signature no
   longer matches it, and the user is left with a switch that says "on" and a
   device that never rings again. Env wins; otherwise a pair is generated ONCE
   and kept beside the other server state.
   The salt below is what keeps chat fingerprints out of the file at rest: the
   subscription store is indexed by a hash of the fingerprint, so lifting the
   file does not hand anyone a list of who talks to whom. */
const VAPID_STORE_PATH = process.env.CHAT_VAPID_STORE_PATH || path.join(defaultDataDir, 'vapid.json');
function loadOrCreateVapid() {
  if (configuredVapid.publicKey && configuredVapid.privateKey) {
    return { ...configuredVapid, source: 'env', salt: process.env.CHAT_PUSH_SALT || '' };
  }
  try {
    if (fs.existsSync(VAPID_STORE_PATH)) {
      const saved = JSON.parse(fs.readFileSync(VAPID_STORE_PATH, 'utf8'));
      if (saved?.publicKey && saved?.privateKey) return { ...saved, source: 'file' };
    }
  } catch (error) {
    console.warn('Could not read the stored VAPID pair; generating a new one:', error?.message || error);
  }
  const generated = webpush.generateVAPIDKeys();
  const record = { ...generated, salt: crypto.randomBytes(32).toString('hex'), createdAt: new Date().toISOString() };
  try {
    fs.mkdirSync(path.dirname(VAPID_STORE_PATH), { recursive: true });
    fs.writeFileSync(VAPID_STORE_PATH, JSON.stringify(record, null, 2), { mode: 0o600 });
  } catch (error) {
    console.warn('Could not persist the VAPID pair; it will change on restart:', error?.message || error);
  }
  return { ...record, source: 'generated' };
}
const vapidKeys = loadOrCreateVapid();
const PUSH_INDEX_SALT = vapidKeys.salt || process.env.CHAT_PUSH_SALT || 'poorija-push-index';
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@poorija.local';

webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);
if (vapidKeys.source === 'generated') {
  console.warn(`VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY were not provided; generated a pair and stored it at ${VAPID_STORE_PATH}.`);
}

/* Push subscriptions are indexed by this, never by the fingerprint itself. */
function pushIndexKey(fingerprint) {
  return crypto.createHmac('sha256', PUSH_INDEX_SALT).update(String(fingerprint || '')).digest('hex');
}
/* What the user is allowed to choose in Settings, and what the server will
   accept — a client asking for ten years does not get ten years. */
const PUSH_TTL_CHOICES = [30, 60, 90, 120, 180];

/* Not everything a client relays is worth keeping, and far less of it is worth
   waking a phone for.
   Typing indicators are the case that made this obvious: they are sent every
   few seconds while someone composes, they were marked persist like everything
   else, and so each one queued a row AND fired a push. Writing one long message
   rang the other person's phone over and over — and when they came back they
   collected a pile of "was typing" envelopes that had stopped being true
   minutes earlier.
   Ephemeral: meaningless once the moment passes. Never stored, never pushed.
   Pushable: something a person would want to be told about. */
const EPHEMERAL_PAYLOADS = new Set([
  'typing', 'receipt', 'ping', 'pong', 'relay-ack', 'call-reaction', 'call-busy',
]);
const PUSHABLE_PAYLOADS = new Set([
  'text', 'rich', 'file-start', 'reaction', 'group', 'space-message', 'space-note',
  'system-note', 'call-invite', 'gcall-invite', 'call-missed', 'call-cancel',
]);
function normalizePushTtlDays(value) {
  const days = Number(value);
  return PUSH_TTL_CHOICES.includes(days) ? days : PUSH_TTL_CHOICES[0];
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
  try {
    const msg = args.map(arg => {
      try {
        return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
      } catch (e) {
        return '[Unserializable]';
      }
    }).join(' ');
    serverLogs.push({ type, msg, ts: new Date().toISOString() });
    if (serverLogs.length > 200) serverLogs.shift();
  } catch (err) {
    // Fail silently to avoid infinite recursion
  }
}

console.log = (...args) => { originalLog(...args); addLog('info', args); };
console.warn = (...args) => { originalWarn(...args); addLog('warn', args); };
console.error = (...args) => { originalError(...args); addLog('error', args); };

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

/* ------------------------------------------------------------------
 * Monitor sessions
 *
 * The old scheme made the token `base64("admin:" + password)`, which is not a
 * session at all — it is the password in a thin disguise. Anyone who reached
 * the cookie (a proxy log, a backup, a stolen laptop) read the password
 * straight out of it, and because the same value was ALSO returned in the
 * login response body, page JavaScript could read what HttpOnly was supposed
 * to protect. It could additionally be passed as ?auth=..., which puts a
 * credential into access logs, browser history and Referer headers.
 *
 * A session is now a random 32-byte handle that means nothing on its own and
 * is only good while the server remembers it.
 * ------------------------------------------------------------------ */
const MONITOR_SESSION_TTL_MS = Number(process.env.MONITOR_SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const monitorSessions = new Map();

function issueMonitorSession(req) {
  const token = crypto.randomBytes(32).toString('base64url');
  monitorSessions.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + MONITOR_SESSION_TTL_MS,
    ip: monitorLoginKey(req),
  });
  return token;
}

function monitorSessionValid(token) {
  if (!token) return false;
  const session = monitorSessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    monitorSessions.delete(token);
    return false;
  }
  return true;
}

function revokeMonitorSession(token) {
  if (token) monitorSessions.delete(token);
}

/* Every session dies when the password changes: a rotated password that leaves
   old sessions logged in has not really been rotated. */
function revokeAllMonitorSessions() {
  monitorSessions.clear();
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of monitorSessions) {
    if (session.expiresAt <= now) monitorSessions.delete(token);
  }
}, 10 * 60 * 1000).unref?.();

/* String === on a secret returns at the first differing byte, which is a
   timing signal. Compare digests so the work is the same either way, whatever
   the lengths are. */
function secretsMatch(candidate, expected) {
  const a = crypto.createHash('sha256').update(String(candidate ?? '')).digest();
  const b = crypto.createHash('sha256').update(String(expected ?? '')).digest();
  return crypto.timingSafeEqual(a, b);
}

function monitorCookieFlags(req) {
  /* Secure would make the cookie unusable over a plain-http LAN deployment,
     which is a supported way to run this, so it is set when the request that
     is establishing the session actually arrived over TLS. */
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return `Path=/; Max-Age=${Math.floor(MONITOR_SESSION_TTL_MS / 1000)}; SameSite=Strict; HttpOnly${secure ? '; Secure' : ''}`;
}

function clearMonitorAuthCookie(res) {
  res.setHeader('Set-Cookie', [
    'monitor_token_v2=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly',
    'monitor_token_v2=; Path=/Monitor_Server; Max-Age=0; SameSite=Strict; HttpOnly',
  ]);
}

/* No query-string credentials. A password in a URL is a password in the
   access log, in the browser's history, and in the Referer header of the next
   outbound request the page makes. */
function monitorTokenFromRequest(req) {
  const cookie = readCookie(req, 'monitor_token_v2');
  if (cookie) return cookie;
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return '';
}

function getMonitorAuth(req) {
  return monitorTokenFromRequest(req);
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
  const token = monitorTokenFromRequest(req);
  if (monitorSessionValid(token)) return true;
  /* HTTP Basic stays supported for scripted access, but the password is
     compared in constant time rather than with ===. */
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Basic ')) {
    const decoded = decodeMonitorAuth(header);
    return Boolean(decoded && decoded.user === 'admin' && secretsMatch(decoded.pass, MONITOR_PASSWORD));
  }
  return false;
}

function monitorLoginKey(req) {
  /* The three-strike ladder hangs off this. See securityKey(). */
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
    const raw = Array.isArray(val) ? val[0] : String(val);
    const normalized = raw.replace(/\s+/g, '');
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) && normalized.length % 4 === 0) {
      try {
        return Buffer.from(normalized, 'base64').toString('utf8');
      } catch (_error) {}
    }
    // Fallback for older formats or plain strings.
    try { return decodeURIComponent(raw); } catch (e2) { return raw; }
  };
  return {
    fingerprint: sanitizeFingerprint(decodeHeader(req.headers['x-p00rija-fingerprint'] || req.query?.fingerprint)),
    peerId: String(decodeHeader(req.headers['x-p00rija-peer-id'] || req.query?.peerId || '')).slice(0, 160),
    clientId: String(decodeHeader(req.headers['x-p00rija-client-id'] || req.query?.clientId || '')).slice(0, 80),
    username: String(decodeHeader(req.headers['x-p00rija-username'] || '')).slice(0, 80),
    ip: requestIp(req),
  };
}

function sendRestrictionResponse(req, res) {
  const restriction = getRestrictionForIdentity(requestIdentity(req));
  if (!restriction) return false;
  const policy = restriction.policy || {};
  let untilText = '';
  if (policy.expiresAt) {
    const d = new Date(policy.expiresAt);
    untilText = ' تا ' + d.toLocaleString('fa-IR') + ' (' + d.toLocaleString('en-US') + ')';
  }
  const suspendedText = `شما موقتاً تعلیق شده اید.${untilText}`;
  const kickedText = policy.permanent
    ? 'دسترسی شما در سیستم محدود شده است، لطفاً برای رفع محدودیت با ادمین سرور و یا پشتیبانی تماس بگیرید.'
    : `اتصال شما با این سرور${untilText} محدود شده است، لطفاً با ادمین تماس بگیرید.`;
  res.status(403).json({
    ok: false,
    restricted: true,
    restrictionType: restriction.type,
    permanent: Boolean(restriction.policy?.permanent),
    until: restriction.policy?.expiresAt || null,
    message: restriction.type === 'kicked' ? kickedText : suspendedText,
  });
  return true;
}

/* ---------------------------------------------------------------------------
 * What the relay knows and the monitor could not see.
 *
 * /healthz reported usage without ever reporting a ceiling — "412 peers" and
 * "1 204 queued" with nothing to compare them against — and it reported
 * nothing at all about the one thing an operator most needs to know: the relay
 * DISCARDS messages. Media ages out after a week, a mailbox over its quota
 * drops its oldest media, and a text tail past the limit is trimmed. Every one
 * of those is written to expiryLog, and none of it reached a screen. A message
 * that never arrived looked identical to one that was never sent.
 *
 * COST. This walks every mailbox, and /healthz is polled every few seconds, so
 * doing it per request would make the monitor the heaviest client on the
 * relay. Two things keep it cheap:
 *   - the result is cached for ten seconds, which is below any refresh
 *     interval the monitor offers, so a faster poll costs nothing extra;
 *   - only media envelopes are measured with envelopeBytes (a JSON.stringify
 *     each), because only media is subject to the byte quota. Text is counted,
 *     not weighed. On a queue of any size that is the difference between a few
 *     hundred stringifications and all of them.
 * ------------------------------------------------------------------------- */
const RELAY_INSIGHT_TTL_MS = 10_000;
const RELAY_INSIGHT_TOP = 8;

/* Only the mailbox walk is cached, because only the mailbox walk is expensive.
 *
 * Caching the whole block was wrong in a way that showed up immediately: a
 * monitor refreshing every two seconds got a live `peers` count next to a
 * `sockets` figure up to ten seconds old, so one screen disagreed with itself
 * — during a load test it read 75 peers and 25 sockets, and the 25 was this
 * cache, not the relay. Sockets, throttling and push counts are all reads of
 * small maps; they cost nothing and are now always current. */
let mailboxCache = { at: 0, value: null };

function mailboxSummary() {
  const now = Date.now();
  if (mailboxCache.value && now - mailboxCache.at < RELAY_INSIGHT_TTL_MS) {
    return mailboxCache.value;
  }

  let envelopes = 0;
  let textEnvelopes = 0;
  let mediaEnvelopes = 0;
  let mediaBytes = 0;
  let oldestQueuedAt = 0;
  const perBox = [];

  for (const [fingerprint, items] of offlineBoxes.entries()) {
    let boxMedia = 0;
    let boxMediaCount = 0;
    let boxOldest = 0;
    for (const item of items) {
      envelopes += 1;
      const queued = queuedAtMs(item);
      if (queued && (!boxOldest || queued < boxOldest)) boxOldest = queued;
      if (envelopeClass(item) === 'media') {
        mediaEnvelopes += 1;
        boxMediaCount += 1;
        boxMedia += envelopeBytes(item);
      } else {
        textEnvelopes += 1;
      }
    }
    mediaBytes += boxMedia;
    if (boxOldest && (!oldestQueuedAt || boxOldest < oldestQueuedAt)) oldestQueuedAt = boxOldest;
    perBox.push({
      /* Truncated on purpose. A fingerprint identifies a person, and the
         monitor is a screen somebody may be looking at over your shoulder;
         eight characters is enough to match against a peer row. */
      fingerprint: String(fingerprint || '').slice(0, 8),
      envelopes: items.length,
      media: boxMediaCount,
      mediaBytes: boxMedia,
      quotaPercent: MEDIA_QUOTA_BYTES > 0 ? Math.round((boxMedia / MEDIA_QUOTA_BYTES) * 100) : 0,
      oldestQueuedAt: boxOldest ? new Date(boxOldest).toISOString() : null,
    });
  }
  perBox.sort((a, b) => b.mediaBytes - a.mediaBytes || b.envelopes - a.envelopes);

  const value = {
    count: offlineBoxes.size,
    envelopes,
    textEnvelopes,
    mediaEnvelopes,
    mediaBytes,
    quotaPercent: MEDIA_QUOTA_BYTES > 0 ? Math.round((mediaBytes / MEDIA_QUOTA_BYTES) * 100) : 0,
    oldestQueuedAt: oldestQueuedAt ? new Date(oldestQueuedAt).toISOString() : null,
    fullest: perBox.slice(0, RELAY_INSIGHT_TOP),
    walkedAt: new Date(now).toISOString(),
  };
  mailboxCache = { at: now, value };
  return value;
}

/* Invalidated rather than waited out, so a monitor watching someone's queue
   drain does not keep showing the old figure for another ten seconds. */
function forgetMailboxSummary() {
  mailboxCache = { at: 0, value: null };
}

function relayInsight() {
  const now = Date.now();
  const boxes = mailboxSummary();

  const dayAgo = now - 86400000;
  const byReason = {};
  let expiredLast24h = 0;
  for (const entry of expiryLog) {
    byReason[entry.reason] = (byReason[entry.reason] || 0) + 1;
    const at = Date.parse(entry.expiredAt || '');
    if (Number.isFinite(at) && at >= dayAgo) expiredLast24h += 1;
  }

  let pushEndpoints = 0;
  let pushExpiringSoon = 0;
  const weekAhead = now + 7 * 86400000;
  for (const items of pushSubscriptions.values()) {
    for (const item of items) {
      pushEndpoints += 1;
      const at = Date.parse(item?.expiresAt || '');
      if (Number.isFinite(at) && at <= weekAhead) pushExpiringSoon += 1;
    }
  }

  /* Who is currently being throttled, and who is close to it. A stress test
     that produces a wall of 429s is indistinguishable from a broken relay
     without this. */
  const throttled = [];
  let activeBuckets = 0;
  for (const [key, entry] of rateBuckets) {
    if (entry.resetAt <= now) continue;
    activeBuckets += 1;
    const bucket = key.slice(0, key.indexOf(':'));
    const ceiling = RATE_LIMITS[bucket] ?? RATE_LIMITS.default;
    if (entry.count >= ceiling * 0.8) {
      throttled.push({
        bucket,
        client: key.slice(key.indexOf(':') + 1),
        count: entry.count,
        ceiling,
        over: entry.count > ceiling,
        resetsInMs: Math.max(0, entry.resetAt - now),
      });
    }
  }
  throttled.sort((a, b) => b.count - a.count);

  const sockets = [];
  let socketTotal = 0;
  for (const [address, count] of wsPerAddress) {
    socketTotal += count;
    sockets.push({ address, count });
  }
  sockets.sort((a, b) => b.count - a.count);

  let selfDestruct = { records: 0, opened: 0 };
  try {
    const records = Array.from(selfDestructRecords.values());
    selfDestruct = {
      records: records.length,
      opened: records.reduce((sum, record) => sum + Number(record?.opens || 0), 0),
    };
  } catch (error) { /* the store may not be loaded yet */ }

  return {
    instanceId: INSTANCE_ID,
    /* Every number above has a ceiling somewhere in this file. Sending them
       together is what turns a reading into a judgement. */
    limits: {
      tier: CAPACITY.tier,
      cpuCount: CAPACITY.cpuCount,
      totalMemMb: CAPACITY.totalMemMb,
      /* The values actually enforced, not the ones the hardware profile
         suggested. CHAT_WS_MAX_TOTAL and CHAT_WS_MAX_PER_IP override the
         profile, and reporting the profile instead meant the monitor printed a
         ceiling nobody was being held to — a per-address cap of 276 while the
         relay was letting 20 000 through. A limit displayed wrongly is worse
         than one not displayed at all: it gets believed. */
      wsMaxTotal: WS_MAX_TOTAL,
      wsMaxPerIp: WS_MAX_PER_IP,
      textMailboxLimit: TEXT_MAILBOX_LIMIT,
      mediaQuotaBytes: MEDIA_QUOTA_BYTES,
      mediaRetentionMs: MEDIA_RETENTION_MS,
      rateWindowMs: RATE_LIMIT_WINDOW_MS,
      rateLimits: { ...RATE_LIMITS },
    },
    mailboxes: boxes,
    /* The headline this whole block exists for. */
    discarded: {
      total: expiryLog.length,
      last24h: expiredLast24h,
      byReason,
      recent: expiryLog.slice(-20).reverse().map((entry) => ({
        to: String(entry.fingerprint || '').slice(0, 8),
        from: String(entry.from || '').slice(0, 8),
        class: entry.class,
        reason: entry.reason,
        queuedAt: entry.queuedAt,
        expiredAt: entry.expiredAt,
      })),
    },
    push: {
      subscribers: pushSubscriptions.size,
      endpoints: pushEndpoints,
      expiringSoon: pushExpiringSoon,
    },
    throttle: {
      activeBuckets,
      windowMs: RATE_LIMIT_WINDOW_MS,
      nearOrOverLimit: throttled.slice(0, RELAY_INSIGHT_TOP),
    },
    sockets: {
      total: socketTotal,
      addresses: wsPerAddress.size,
      busiest: sockets.slice(0, RELAY_INSIGHT_TOP),
      refused: {
        total: socketRefusals.total,
        perIp: socketRefusals.perIp,
        capacity: socketRefusals.capacity,
        lastAt: socketRefusals.lastAt,
        addresses: Array.from(socketRefusals.addresses.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, RELAY_INSIGHT_TOP)
          .map(([address, count]) => ({ address, count })),
      },
    },
    selfDestruct,
    computedAt: new Date(now).toISOString(),
  };
}

/* The certificate is read from disk, so it is cached harder than the rest: a
   file that changes twice a year does not need looking at every ten seconds,
   and a relay whose certificate has lapsed is simply unreachable, which is the
   one failure the monitor cannot report because it cannot connect either. */
let certCache = { at: 0, value: null };
function certSummary() {
  const now = Date.now();
  if (certCache.value && now - certCache.at < 300_000) return certCache.value;
  let value = { ok: false, daysLeft: null, validTo: null, subject: '' };
  try {
    const certPath = process.env.CHAT_TLS_CERT_PATH || '/etc/certs/cert.pem';
    const cert = new crypto.X509Certificate(fs.readFileSync(certPath));
    const msLeft = new Date(cert.validTo).getTime() - now;
    value = {
      ok: msLeft > 0,
      daysLeft: Math.floor(msLeft / 86400000),
      validTo: cert.validTo,
      subject: cert.subject,
    };
  } catch (error) {
    value.error = String((error && error.message) || error);
  }
  certCache = { at: now, value };
  return value;
}

app.get('/healthz', authMiddleware, (_req, res) => {
  pruneExpiredPolicies();
  const mem = process.memoryUsage();
  const cpus = os.cpus();
  
  // Basic CPU load calculation (1-min load avg relative to CPU cores)
  const cpuCount = cpus.length;
  const loadAvg = os.loadavg();
  const cpuLoadPercent = Math.min(100, Math.round((loadAvg[0] / cpuCount) * 100));

  const now = Date.now();
  const livePeers = Array.from(presence.values()).filter((p) =>
    p.ws?.readyState === WebSocket.OPEN
    && now - (p.lastSeenAt || 0) <= PRESENCE_TTL_MS
    && hasUsableIdentity(p)
    && !getRestrictionForIdentity(p)
  );
  const peersDetails = livePeers.map(p => ({
    clientId: p.clientId,
    username: p.username || p.peerId || p.fingerprint || 'بدون نام',
    ip: p.ip,
    connectedAt: p.connectedAt,
    lastSeenAt: p.lastSeenAt,
    peerId: p.peerId,
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
    peers: livePeers.length,
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
    kickedUsers: listActiveKickBans(),
    relay: relayInsight(),
    cert: certSummary()
  });
});

app.post('/admin/login', (req, res) => {
  setNoStoreHeaders(res);
  const lock = getMonitorLockState(req);
  if (lock.locked) {
    return res.status(423).json({ ok: false, reason: 'locked', remainingMs: lock.remainingMs });
  }

  const { password } = req.body || {};
  if (secretsMatch(password, MONITOR_PASSWORD)) {
    monitorLoginFailures.delete(monitorLoginKey(req));
    const token = issueMonitorSession(req);
    res.setHeader('Set-Cookie', `monitor_token_v2=${token}; ${monitorCookieFlags(req)}`);

    /* The token is not in the body by default: the web monitor is served from
       this origin, the browser attaches the HttpOnly cookie by itself, and
       handing page script a copy would undo HttpOnly for no gain.
     *
     * A client that has no cookie jar with this origin must ask for it. The
     * desktop monitor is exactly that: it runs from tauri://localhost, sends
     * `mode: 'cors'` without credentials, and so never receives the cookie at
     * all. It had been written to read `payload.token` from this response,
     * which stopped existing when sessions became opaque handles — so it set
     * no Authorization header, every call came back 401, and the app was
     * unusable against any relay.
     *
     * monitorTokenFromRequest already accepts `Authorization: Bearer <token>`,
     * which is plainly what that support was for. Returning the handle only
     * when it is asked for gives that client its half without weakening the
     * browser's: this response is reached only by someone who just presented
     * the correct password, so a token here tells an attacker nothing they
     * could not have obtained by logging in themselves. */
    const wantsBearer = req.body?.bearer === true || req.body?.mode === 'bearer';
    return res.json({
      ok: true,
      redirect: '/Monitor_Server',
      ...(wantsBearer ? { token, tokenType: 'Bearer' } : {}),
    });
  }

  const failure = recordMonitorLoginFailure(req);
  res.status(failure.locked ? 423 : 401).json({
    ok: false,
    reason: failure.locked ? 'locked' : 'invalid',
    attemptsRemaining: Math.max(0, MONITOR_LOCK_MAX_ATTEMPTS - failure.attempts),
    remainingMs: failure.lockUntil ? failure.lockUntil - Date.now() : 0,
  });
});

app.post('/admin/logout', (req, res) => {
  setNoStoreHeaders(res);
  revokeMonitorSession(monitorTokenFromRequest(req));
  clearMonitorAuthCookie(res);
  res.json({ ok: true });
});

app.post('/admin/kick-peer', authMiddleware, (req, res) => {
  const { clientId } = req.body;
  const permanent = req.body?.permanent !== undefined ? Boolean(req.body.permanent) : true;
  const durationMinutes = permanent ? 0 : sanitizePolicyDurationMinutes(req.body?.durationMinutes, 60);
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
    return res.json({ ok: true, key, expiresAt, durationMinutes, permanent });
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
  res.json({ ok: true, key, policy, expiresAt: policy.expiresAt, durationMinutes, durationMs });
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
  const { oldPassword, newPassword } = req.body || {};

  /* The old password is required, not merely checked when supplied. The guard
     used to read `if (oldPassword && ...)`, so omitting the field skipped the
     comparison altogether — a stolen session cookie was enough to take the
     account over without ever learning the password. */
  if (!secretsMatch(oldPassword, MONITOR_PASSWORD)) {
    return res.status(403).json({ ok: false, reason: 'Old password incorrect' });
  }

  /* Twelve, matching what the installer insists on. Six let the wizard's own
     rule be undone from the dashboard a minute after setup. */
  if (!newPassword || String(newPassword).length < 12) {
    return res.status(400).json({ ok: false, reason: 'Password must be at least 12 characters' });
  }
  if (/[\s$]/.test(String(newPassword))) {
    return res.status(400).json({ ok: false, reason: 'Password must not contain spaces or $' });
  }

  MONITOR_PASSWORD = newPassword;
  saveServerConfig();
  /* Every existing session dies with the old password. A rotation that leaves
     the previous sessions signed in has not rotated anything. */
  revokeAllMonitorSessions();
  clearMonitorAuthCookie(res);
  console.log('[Admin] Monitor password changed; all sessions revoked.');
  res.json({ ok: true, reauth: true });
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
        .monitor-lang-toggle { position: fixed; top: 16px; inset-inline-end: 16px; z-index: 20; display: flex; gap: 6px; padding: 6px; border-radius: 999px; background: rgba(15,23,42,.72); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(16px); }
        .monitor-lang-toggle button { min-width: 42px; padding: 6px 10px; border-radius: 999px; color: #94a3b8; font-weight: 900; font-size: 12px; }
        .monitor-lang-toggle button.active { background: #0ea5e9; color: white; }
        @keyframes float { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-10px) scale(1.02); } }
        .animate-float { animation: float 5s ease-in-out infinite; }
    </style>
</head>
<body class="flex items-center justify-center min-h-screen p-4">
    <div class="monitor-lang-toggle" aria-label="Language">
        <button type="button" id="monitorLoginLangFa" onclick="setMonitorLoginLanguage('fa')">FA</button>
        <button type="button" id="monitorLoginLangEn" onclick="setMonitorLoginLanguage('en')">EN</button>
    </div>
    <div class="glow top-[-15%] left-[-15%]"></div>
    <div class="glow bottom-[-15%] right-[-15%]"></div>
    
    <div class="glass p-10 w-full max-w-md mx-4 shadow-2xl animate-float border-sky-500/20">
        <div class="text-center mb-10">
            <div class="inline-flex items-center justify-center w-24 h-24 bg-sky-500/10 rounded-3xl mb-6 border border-sky-500/30 shadow-[0_0_50px_rgba(14,165,233,0.2)]">
                <i class="fas fa-server text-5xl text-sky-400"></i>
            </div>
            <h1 class="text-3xl font-black tracking-tight text-white mb-2" data-login-i18n="title">داشبورد مدیریت</h1>
            <p class="text-slate-400 font-bold opacity-80">P00RIJA Cryptography Relay Server</p>
        </div>

        <div class="space-y-6">
            <div>
                <label class="block text-xs font-black text-slate-400 mb-3 mr-1 uppercase tracking-widest" data-login-i18n="password">گذرواژه مدیریت</label>
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
                <span data-login-i18n="login">ورود ایمن به سامانه</span>
                <i class="fas fa-arrow-left"></i>
            </button>
            
            <div id="error" class="hidden text-rose-400 text-center text-sm font-bold bg-rose-500/10 py-3 rounded-xl border border-rose-500/20">
                <span data-login-i18n="wrong">گذرواژه اشتباه است. مجدداً تلاش کنید.</span>
            </div>
            <div id="lockNotice" class="hidden text-amber-300 text-center text-sm font-bold bg-amber-500/10 py-3 rounded-xl border border-amber-500/20"></div>
        </div>

        <div class="mt-10 pt-8 border-t border-slate-700/50 text-center">
            <span class="text-[10px] text-slate-500 uppercase tracking-[0.3em] font-black">Protected by P00RIJA Suite</span>
        </div>
    </div>

    <script>
        const monitorLoginTranslations = {
            fa: {
                title: 'داشبورد مدیریت',
                password: 'گذرواژه مدیریت',
                login: 'ورود ایمن به سامانه',
                wrong: 'گذرواژه اشتباه است. مجدداً تلاش کنید.',
                wrongWithRemaining: 'گذرواژه اشتباه است. تعداد تلاش باقی‌مانده: ',
                locked: 'به علت ۳ تلاش ناموفق، ورود تا ',
                lockedSuffix: ' قفل شد.',
            },
            en: {
                title: 'Management Dashboard',
                password: 'Admin Password',
                login: 'Secure Login',
                wrong: 'The password is incorrect. Please try again.',
                wrongWithRemaining: 'The password is incorrect. Attempts remaining: ',
                locked: 'Login is locked for ',
                lockedSuffix: ' after 3 failed attempts.',
            }
        };
        function monitorLoginLanguage() {
            return localStorage.getItem('monitor_language_v1') || 'fa';
        }
        function loginT(key) {
            const lang = monitorLoginLanguage();
            return monitorLoginTranslations[lang]?.[key] || monitorLoginTranslations.fa[key] || key;
        }
        function setMonitorLoginLanguage(lang) {
            localStorage.setItem('monitor_language_v1', lang === 'en' ? 'en' : 'fa');
            applyMonitorLoginLanguage();
        }
        function applyMonitorLoginLanguage() {
            const lang = monitorLoginLanguage();
            document.documentElement.lang = lang;
            document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
            document.querySelectorAll('[data-login-i18n]').forEach((el) => {
                el.textContent = loginT(el.dataset.loginI18n);
            });
            document.getElementById('monitorLoginLangFa')?.classList.toggle('active', lang === 'fa');
            document.getElementById('monitorLoginLangEn')?.classList.toggle('active', lang === 'en');
        }
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
        /* Kept only so any old call site is harmless. Page script must not be
           able to mint a session cookie — the server sets an HttpOnly one at
           login, and a script-written cookie of the same name would shadow it
           with a value that is not a session at all. */
        function setAuthCookie() { /* the server owns this cookie now */ }
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
                notice.textContent = loginT('locked') + formatLock(remaining) + loginT('lockedSuffix');
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
                if (r.ok && data.ok) {
                    /* No token to keep: the session is an HttpOnly cookie the
                       server just set, which the browser attaches by itself and
                       page script cannot read. Copying it into localStorage was
                       exactly what made HttpOnly meaningless. */
                    window.location.replace(data.redirect || '/Monitor_Server');
                } else if (r.status === 423) {
                    clearAuthState();
                    document.getElementById('error').classList.add('hidden');
                    showLock(data.remainingMs || 600000);
                } else {
                    clearAuthState();
                    const remaining = Number(data.attemptsRemaining || 0);
                    const error = document.getElementById('error');
                    error.textContent = remaining > 0
                        ? loginT('wrongWithRemaining') + remaining
                        : loginT('wrong');
                    error.classList.remove('hidden');
                }
            });
        }
        applyMonitorLoginLanguage();
        document.getElementById('passInput').onkeypress = (e) => { if(e.key === 'Enter') doLogin(); };
        /* Ask whether the cookie we may already be holding is still good. */
        fetch('/healthz', { cache: 'no-store', credentials: 'same-origin' }).then(r => {
            if (r.ok) window.location.replace('/Monitor_Server');
        }).catch(() => { /* not signed in; the form stands */ });
    </script>
</body>
</html>
    `);
  }

  /* This used to re-check the caller here with
     `decodeMonitorAuth(getMonitorAuth(req))`, and that check could never pass.
     getMonitorAuth returns the opaque session handle introduced when sessions
     stopped being the password in disguise; decodeMonitorAuth still expected
     the old "Basic <base64 user:pass>" string, so it returned null for a cookie
     login AND for HTTP Basic, and every authenticated request to the dashboard
     came back 401 "Invalid credentials". /healthz accepted the very same
     credentials, which is what made it look like a password problem.

     isValidMonitorAuth above is the check — it understands both a live session
     and Basic — and it has already run into `authenticated`. Asking a second
     time with a decoder that no longer matches the token format was not
     defence in depth, it was the reason the dashboard was unreachable. */
  if (!authenticated) {
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
        html { font-size: var(--monitor-font-size, 16px); }
        body { 
            background: var(--monitor-bg, #020617); 
            color: var(--monitor-text, #f8fafc); 
            font-family: var(--monitor-font, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
            font-size: 1rem;
            min-height: 100vh;
            background-image: 
                radial-gradient(at 0% 0%, var(--monitor-glow-a, rgba(14, 165, 233, 0.15)) 0px, transparent 50%),
                radial-gradient(at 100% 100%, var(--monitor-glow-b, rgba(99, 102, 241, 0.15)) 0px, transparent 50%);
            overflow-x: hidden;
        }
        .glass { 
            background: var(--monitor-card, rgba(15, 23, 42, 0.6)); 
            backdrop-filter: blur(20px);
            border: 1px solid var(--monitor-border, rgba(255, 255, 255, 0.08));
            border-radius: 24px;
        }
        @font-face { font-family: Vazirmatn; src: url('/fonts/Vazirmatn/Vazirmatn-VariableFont_wght.ttf'); font-display: swap; }
        @font-face { font-family: BYekan; src: url('/fonts/BYekan.ttf'); font-display: swap; }
        @font-face { font-family: Parastoo; src: url('/fonts/Parastoo/Parastoo-VariableFont_wght.ttf'); font-display: swap; }
        @font-face { font-family: Rubik; src: url('/fonts/Rubik/Rubik-VariableFont_wght.ttf'); font-display: swap; }
        @font-face { font-family: Inter; src: url('/fonts/Inter-Regular.ttf'); font-display: swap; }
        @font-face { font-family: Roboto; src: url('/fonts/Roboto/Roboto-Regular.ttf'); font-display: swap; }
        @font-face { font-family: CascadiaCode; src: url('/fonts/Cascadia_Code/CascadiaCode-VariableFont_wght.ttf'); font-display: swap; }
        body.monitor-theme-dark { --monitor-bg: #020617; --monitor-text: #f8fafc; --monitor-card: rgba(15,23,42,.62); --monitor-border: rgba(255,255,255,.08); --monitor-accent: #38bdf8; --monitor-glow-a: rgba(14,165,233,.15); --monitor-glow-b: rgba(99,102,241,.15); }
        body.monitor-theme-midnight { --monitor-bg: #080b1a; --monitor-text: #eef2ff; --monitor-card: rgba(17,24,39,.72); --monitor-border: rgba(129,140,248,.18); --monitor-accent: #818cf8; --monitor-glow-a: rgba(79,70,229,.18); --monitor-glow-b: rgba(14,165,233,.12); }
        body.monitor-theme-nord { --monitor-bg: #2e3440; --monitor-text: #eceff4; --monitor-card: rgba(59,66,82,.7); --monitor-border: rgba(136,192,208,.22); --monitor-accent: #88c0d0; --monitor-glow-a: rgba(136,192,208,.12); --monitor-glow-b: rgba(129,161,193,.12); }
        body.monitor-theme-dracula { --monitor-bg: #282a36; --monitor-text: #f8f8f2; --monitor-card: rgba(68,71,90,.72); --monitor-border: rgba(255,121,198,.18); --monitor-accent: #ff79c6; --monitor-glow-a: rgba(189,147,249,.12); --monitor-glow-b: rgba(255,121,198,.12); }
        body.monitor-theme-linen { --monitor-bg: #f5efe6; --monitor-text: #1f2937; --monitor-card: rgba(255,251,245,.78); --monitor-border: rgba(120,113,108,.22); --monitor-accent: #0f766e; --monitor-glow-a: rgba(15,118,110,.1); --monitor-glow-b: rgba(180,83,9,.08); }
        body.monitor-theme-linen .text-white { color: #1f2937 !important; }
        body.monitor-theme-linen .text-slate-400, body.monitor-theme-linen .text-slate-500 { color: #64748b !important; }
        .monitor-control {
            background: rgba(15, 23, 42, 0.65);
            border: 1px solid var(--monitor-border, rgba(255,255,255,.08));
            color: var(--monitor-accent, #38bdf8);
            border-radius: 12px;
            padding: 8px 10px;
            outline: none;
            font-weight: 800;
            min-width: 118px;
        }
        body.monitor-theme-linen .monitor-control { background: rgba(255,255,255,.72); color: #0f766e; }
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
        .monitor-chart-card {
            height: 314px;
            min-height: 314px;
            max-height: 314px;
            overflow: hidden;
        }
        .monitor-chart-frame {
            height: 250px;
            min-height: 250px;
            max-height: 250px;
            overflow: hidden;
            contain: size layout paint;
        }
        .monitor-chart-frame canvas {
            width: 100% !important;
            height: 100% !important;
            display: block;
        }
        .monitor-select,
        .monitor-select option {
            background-color: #0f172a;
            color: #f8fafc;
        }
        .monitor-select:focus {
            background-color: #111827;
        }
        body.monitor-theme-linen .monitor-select,
        body.monitor-theme-linen .monitor-select option {
            background-color: #fff7ed;
            color: #1f2937;
        }
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
                <div class="flex flex-wrap items-center gap-2 glass px-4 py-3 text-xs font-black">
                    <select id="monitorLanguageSelect" class="monitor-control" title="زبان / Language" onchange="setMonitorLanguage(this.value)">
                        <option value="fa">فارسی</option>
                        <option value="en">English</option>
                    </select>
                    <select id="monitorFontSelect" class="monitor-control" title="فونت" onchange="applyMonitorAppearance()">
                        <option value="Vazirmatn">Vazirmatn</option>
                        <option value="BYekan">B Yekan</option>
                        <option value="Parastoo">Parastoo</option>
                        <option value="Rubik">Rubik</option>
                        <option value="Inter">Inter</option>
                        <option value="Roboto">Roboto</option>
                        <option value="CascadiaCode">Cascadia Code</option>
                    </select>
                    <select id="monitorFontSizeSelect" class="monitor-control" title="اندازه نوشتار" onchange="applyMonitorAppearance()">
                        <option value="14px">کوچک</option>
                        <option value="16px">متوسط</option>
                        <option value="18px">بزرگ</option>
                    </select>
                    <select id="monitorThemeSelect" class="monitor-control" title="تم" onchange="applyMonitorAppearance()">
                        <option value="dark">Dark</option>
                        <option value="midnight">Midnight</option>
                        <option value="nord">Nord</option>
                        <option value="dracula">Dracula</option>
                        <option value="linen">Linen</option>
                    </select>
                </div>
                <div class="flex items-center gap-3 glass px-5 py-3 text-sm font-black">
                    <span class="text-slate-500">به‌روزرسانی:</span>
                    <select id="refreshInterval" class="bg-transparent border-none outline-none text-sky-400 cursor-pointer font-bold">
                        <option value="1000">۱ ثانیه</option>
                        <option value="2000" selected>۲ ثانیه</option>
                        <option value="5000">۵ ثانیه</option>
                        <option value="10000">۱۰ ثانیه</option>
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
            <div class="glass p-8 lg:col-span-1 monitor-chart-card">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">کاربران در حالت تعلیق</h3>
                    <span class="text-[10px] text-amber-400 font-black px-2 py-1 bg-amber-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="monitor-chart-frame">
                    <canvas id="suspendedChart"></canvas>
                </div>
            </div>
            <div class="glass p-8 lg:col-span-1 monitor-chart-card">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">بار پردازشی (CPU)</h3>
                    <span class="text-[10px] text-indigo-400 font-black px-2 py-1 bg-indigo-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="monitor-chart-frame">
                    <canvas id="cpuChart"></canvas>
                </div>
            </div>
            <div class="glass p-8 lg:col-span-1 monitor-chart-card">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">تحلیل حافظه (RAM)</h3>
                    <span class="text-[10px] text-sky-400 font-black px-2 py-1 bg-sky-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="monitor-chart-frame">
                    <canvas id="memoryChart"></canvas>
                </div>
            </div>
        </div>

        <!-- New Row of Charts -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div class="glass p-8 monitor-chart-card">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">پردازش پیام‌ها</h3>
                    <span class="text-[10px] text-amber-400 font-black px-2 py-1 bg-amber-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="monitor-chart-frame">
                    <canvas id="throughputChart"></canvas>
                </div>
            </div>
            <div class="glass p-8 monitor-chart-card">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">ترافیک شبکه (I/O)</h3>
                    <span class="text-[10px] text-sky-400 font-black px-2 py-1 bg-sky-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="monitor-chart-frame">
                    <canvas id="networkChart"></canvas>
                </div>
            </div>
        </div>

        <!-- System Health and Queue Charts -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div class="glass p-8 monitor-chart-card">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">صف پیام‌های آنلاین</h3>
                    <span class="text-[10px] text-rose-400 font-black px-2 py-1 bg-rose-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="monitor-chart-frame">
                    <canvas id="queueChart"></canvas>
                </div>
            </div>
            <div class="glass p-8 monitor-chart-card">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-black text-white">مصرف فضای ذخیره‌سازی</h3>
                    <span class="text-[10px] text-emerald-400 font-black px-2 py-1 bg-emerald-500/10 rounded-lg">LIVE</span>
                </div>
                <div class="monitor-chart-frame">
                    <canvas id="storageChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Relay Health: capacity against its ceiling, and what was discarded -->
        <div class="glass p-8 mb-8">
            <div class="flex justify-between items-center mb-6">
                <h3 class="text-xl font-black text-white flex items-center gap-3">
                    <i class="fas fa-heart-pulse text-rose-500"></i>
                    سلامت رله
                </h3>
                <span id="relayInstance" class="text-[10px] text-slate-500 font-mono"></span>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div>
                    <p class="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-3">ظرفیت</p>
                    <ul id="relayLimits" class="space-y-1 text-xs"></ul>
                </div>
                <div>
                    <p class="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-3">صندوق‌های پرتر</p>
                    <ul id="relayMailboxes" class="space-y-1 text-xs"></ul>
                </div>
                <div>
                    <p class="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-3">محدودشده‌ها</p>
                    <ul id="relayThrottle" class="space-y-1 text-xs"></ul>
                </div>
            </div>
            <div class="mt-8 pt-6 border-t border-slate-800">
                <div class="flex justify-between items-center mb-4">
                    <h4 class="text-sm font-black text-white flex items-center gap-2">
                        <i class="fas fa-trash-can text-amber-500"></i>
                        آنچه رله دور ریخت
                    </h4>
                    <span id="relayDiscardSummary" class="text-[10px] text-slate-400 font-bold"></span>
                </div>
                <div class="overflow-x-auto max-h-64 custom-scrollbar">
                    <table class="w-full text-right">
                        <thead class="text-[9px] text-slate-500 uppercase tracking-widest">
                            <tr>
                                <th class="pb-2">برای</th><th class="pb-2">از</th><th class="pb-2">نوع</th>
                                <th class="pb-2">دلیل</th><th class="pb-2">در صف از</th><th class="pb-2">حذف در</th>
                            </tr>
                        </thead>
                        <tbody id="relayDiscardBody" class="text-[10px] font-mono"></tbody>
                    </table>
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
                        <select id="broadcastTarget" class="monitor-select w-full bg-slate-800/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-sky-500 transition-all font-bold text-white text-sm">
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
        const monitorTextFa = {
            dashboardSubtitle: 'سامانه متمرکز پایش و کنترل زیرساخت‌های رمزنگاری',
            documentTitle: 'P00RIJÃ Signal Monitor | داشبورد حرفه‌ای مدیریت',
            persian: 'فارسی',
            english: 'English',
            fontTitle: 'فونت',
            fontSizeTitle: 'اندازه نوشتار',
            themeTitle: 'تم',
            small: 'کوچک',
            medium: 'متوسط',
            large: 'بزرگ',
            refresh: 'به‌روزرسانی:',
            oneSecond: '۱ ثانیه',
            twoSeconds: '۲ ثانیه',
            fiveSeconds: '۵ ثانیه',
            security: 'امنیت',
            optimizeRam: 'بهینه‌ساز RAM',
            clearConnections: 'پاکسازی اتصالات',
            logout: 'خروج',
            operational: 'عملیاتی',
            disconnected: 'قطع اتصال',
            connectedUsers: 'کاربران متصل',
            cpuLoad: 'بار سیستم (CPU)',
            memoryRam: 'حافظه (RAM)',
            storageDisk: 'ذخیره‌سازی (Disk)',
            networkPing: 'تأخیر شبکه (Ping)',
            managementConnectionStability: 'پایداری اتصال مدیریت',
            memoryAnalysis: 'تحلیل حافظه (RAM)',
            cpuProcessingLoad: 'بار پردازشی (CPU)',
            suspendedUsers: 'کاربران در حالت تعلیق',
            networkTraffic: 'ترافیک شبکه (I/O)',
            messageThroughput: 'پردازش پیام‌ها',
            storageUsage: 'مصرف فضای ذخیره‌سازی',
            offlineQueue: 'صف پیام‌های آفلاین',
            clearAllQueue: 'پاکسازی کل صف',
            clearErrorQueue: 'پاکسازی پیام‌های خطادار',
            username: 'نام کاربری',
            details: 'مشخصات',
            ipAddress: 'آدرس IP',
            duration: 'مدت',
            actions: 'عملیات',
            broadcastTitle: 'ارسال اعلان سیستمی (Broadcast)',
            allConnectedUsers: 'همه کاربران متصل',
            broadcastPlaceholder: 'متن پیام برای تمام کاربران...',
            send: 'ارسال',
            chooseFile: 'انتخاب فایل یا صدا...',
            liveLogs: 'گزارشات زنده',
            page: 'صفحه',
            pageOf: 'از',
            downloadFile: 'دریافت فایل',
            clear: 'پاکسازی',
            user: 'کاربر',
            fingerprintIp: 'اثر انگشت / IP',
            suspensionTime: 'زمان تعلیق',
            kickedUsers: 'کاربران اخراج شده',
            kickDuration: 'مدت اخراج',
            hostOs: 'سیستم عامل میزبان',
            nodeEnvironment: 'محیط Node.js',
            uptime: 'مدت زمان فعالیت (Uptime)',
            operationalPorts: 'پورت‌های عملیاتی',
            turnStatus: 'وضعیت TURN Relay',
            connectedDomain: 'دامنه متصل',
            totalMemory: 'حافظه کل سیستم',
            lastFetch: 'آخرین واکشی اطلاعات',
            synchronized: 'SYNCHRONIZED',
            securitySettings: 'تنظیمات امنیتی',
            changeAdminPassword: 'تغییر رمز عبور مدیریت سامانه',
            currentPassword: 'رمز عبور فعلی',
            newPassword: 'رمز عبور جدید',
            confirmNewPassword: 'تکرار رمز عبور جدید',
            minSixChars: 'حداقل ۶ کاراکتر',
            updatePassword: 'بروزرسانی گذرواژه',
            cancel: 'انصراف',
            setTime: 'تنظیم زمان',
            day: 'روز',
            hour: 'ساعت',
            minute: 'دقیقه',
            second: 'ثانیه',
            permanentKick: 'کاربر به صورت نامحدود از چت‌ها اخراج شود',
            applyChanges: 'اعمال تغییرات',
            noFingerprint: 'بدون اثر انگشت',
            from: 'از',
            suspend: 'تعلیق',
            kick: 'اخراج',
            usersUnit: 'کاربر',
            unknownUser: 'کاربر ناشناس',
            unknownIp: 'IP نامشخص',
            until: 'تا ',
            noEndTime: 'بدون زمان پایان',
            resume: 'رفع تعلیق',
            unkick: 'رفع اخراج',
            noSuspendedUsers: 'هیچ کاربری در حالت تعلیق نیست.',
            noKickedUsers: 'هیچ کاربری در لیست اخراجی نیست.',
            unlimited: 'بدون محدودیت',
            active: 'عملیاتی ✅',
            inactive: 'غیرفعال ❌',
            confirmClearOffline: 'آیا مایل به پاکسازی کل صف پیام‌های آفلاین هستید؟',
            offlineCleared: 'صف پیام‌های آفلاین با موفقیت پاکسازی شد.',
            confirmClearErrors: 'آیا مایل به پاکسازی پیام‌های دلیور نشده و یا خطادار هستید؟',
            errorsCleared: 'پیام‌های خطادار با موفقیت پاکسازی شدند.',
            serverError: 'خطا در ارتباط با سرور',
            confirmOptimizeRam: 'آیا مایل به آزادسازی حافظه RAM سیستم هستید؟',
            optimizedPrefix: 'بهینه‌سازی انجام شد. حدود ',
            optimizedSuffix: ' مگابایت حافظه آزاد شد.',
            sentPrefix: 'اعلان برای ',
            sentSuffix: ' کاربر ارسال شد',
            errorPrefix: 'خطا: ',
            sendFailed: 'ارسال ناموفق بود',
            sendError: 'خطا در ارسال اعلان',
            minTime: 'حداقل زمان باید بیشتر از صفر باشد.',
            suspendUser: 'تعلیق کاربر',
            confirmPermanentKick: 'این کاربر به صورت نامحدود از چت خارج و به لیست اخراجی‌ها اضافه شود؟',
            confirmKickPrefix: 'این کاربر برای ',
            confirmKickSuffix: ' از چت خارج و تا پایان این زمان امکان اتصال نداشته باشد؟',
            kickFailed: 'اخراج ناموفق بود',
            kickError: 'خطا در اخراج کاربر',
            confirmSuspendPrefix: 'این کاربر برای ',
            confirmSuspendSuffix: ' به حالت تعلیق برود و هیچ فعالیتی در سرور نداشته باشد؟',
            suspendFailed: 'تعلیق ناموفق بود',
            suspendError: 'خطا در تعلیق کاربر',
            confirmResume: 'این کاربر از حالت تعلیق خارج شود؟',
            resumeError: 'خطا در رفع تعلیق',
            confirmUnkick: 'این کاربر از لیست اخراجی خارج شود؟',
            unkickError: 'خطا در رفع اخراج',
            confirmLogout: 'آیا قصد خروج از داشبورد را دارید؟',
            confirmClearMemory: 'آیا مایل به بهینه‌سازی حافظه و پاکسازی اتصالات منقضی شده هستید؟',
            clearedConnectionsPrefix: 'بهینه‌سازی انجام شد: ',
            clearedConnectionsSuffix: ' اتصال منقضی حذف شد.',
            enterCurrentPassword: 'رمز عبور فعلی را وارد کنید',
            newPasswordShort: 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد',
            passwordMismatch: 'رمز عبور جدید و تاییدیه آن مطابقت ندارند',
            passwordChanged: 'رمز عبور با موفقیت تغییر کرد. لطفاً مجدداً وارد شوید.',
            passwordChangeFailed: 'تغییر رمز عبور با خطا مواجه شد',
            serverErrorShort: 'خطا در سرور',
            daysUnit: ' روز',
            hoursUnit: ' ساعت',
            minutesUnit: ' دقیقه',
            secondsUnit: ' ثانیه',
            and: ' و ',
        };
        const monitorTextEn = {
            dashboardSubtitle: 'Central monitoring and control for cryptography infrastructure',
            documentTitle: 'P00RIJÃ Signal Monitor | Professional Management Dashboard',
            persian: 'Persian',
            english: 'English',
            fontTitle: 'Font',
            fontSizeTitle: 'Text size',
            themeTitle: 'Theme',
            small: 'Small',
            medium: 'Medium',
            large: 'Large',
            refresh: 'Refresh:',
            oneSecond: '1 second',
            twoSeconds: '2 seconds',
            fiveSeconds: '5 seconds',
            security: 'Security',
            optimizeRam: 'Optimize RAM',
            clearConnections: 'Clear Connections',
            logout: 'Logout',
            operational: 'Operational',
            disconnected: 'Disconnected',
            connectedUsers: 'Connected Users',
            cpuLoad: 'System Load (CPU)',
            memoryRam: 'Memory (RAM)',
            storageDisk: 'Storage (Disk)',
            networkPing: 'Network Latency (Ping)',
            managementConnectionStability: 'Management connection stability',
            memoryAnalysis: 'Memory Analysis (RAM)',
            cpuProcessingLoad: 'Processing Load (CPU)',
            suspendedUsers: 'Suspended Users',
            networkTraffic: 'Network Traffic (I/O)',
            messageThroughput: 'Message Throughput',
            storageUsage: 'Storage Usage',
            offlineQueue: 'Offline Message Queue',
            clearAllQueue: 'Clear Full Queue',
            clearErrorQueue: 'Clear Error Messages',
            username: 'Username',
            details: 'Details',
            ipAddress: 'IP Address',
            duration: 'Duration',
            actions: 'Actions',
            broadcastTitle: 'System Broadcast',
            allConnectedUsers: 'All connected users',
            broadcastPlaceholder: 'Message text for all users...',
            send: 'Send',
            chooseFile: 'Choose file or audio...',
            liveLogs: 'Live Logs',
            page: 'Page',
            pageOf: 'of',
            downloadFile: 'Download File',
            clear: 'Clear',
            user: 'User',
            fingerprintIp: 'Fingerprint / IP',
            suspensionTime: 'Suspension Time',
            kickedUsers: 'Kicked Users',
            kickDuration: 'Kick Duration',
            hostOs: 'Host Operating System',
            nodeEnvironment: 'Node.js Environment',
            uptime: 'Uptime',
            operationalPorts: 'Operational Ports',
            turnStatus: 'TURN Relay Status',
            connectedDomain: 'Connected Domain',
            totalMemory: 'Total System Memory',
            lastFetch: 'Last Data Fetch',
            synchronized: 'SYNCHRONIZED',
            securitySettings: 'Security Settings',
            changeAdminPassword: 'Change dashboard admin password',
            currentPassword: 'Current Password',
            newPassword: 'New Password',
            confirmNewPassword: 'Confirm New Password',
            minSixChars: 'At least 6 characters',
            updatePassword: 'Update Password',
            cancel: 'Cancel',
            setTime: 'Set Time',
            day: 'Day',
            hour: 'Hour',
            minute: 'Minute',
            second: 'Second',
            permanentKick: 'Kick this user from chats permanently',
            applyChanges: 'Apply Changes',
            noFingerprint: 'No fingerprint',
            from: 'From ',
            suspend: 'Suspend',
            kick: 'Kick',
            usersUnit: 'users',
            unknownUser: 'Unknown user',
            unknownIp: 'Unknown IP',
            until: 'Until ',
            noEndTime: 'No end time',
            resume: 'Resume',
            unkick: 'Remove Kick',
            noSuspendedUsers: 'No users are currently suspended.',
            noKickedUsers: 'No users are currently kicked.',
            unlimited: 'Unlimited',
            active: 'Operational ✅',
            inactive: 'Inactive ❌',
            confirmClearOffline: 'Clear the full offline message queue?',
            offlineCleared: 'The offline message queue was cleared successfully.',
            confirmClearErrors: 'Clear undelivered or errored messages?',
            errorsCleared: 'Errored messages were cleared successfully.',
            serverError: 'Server connection error',
            confirmOptimizeRam: 'Free system RAM now?',
            optimizedPrefix: 'Optimization completed. About ',
            optimizedSuffix: ' MB of memory was freed.',
            sentPrefix: 'Broadcast sent to ',
            sentSuffix: ' users',
            errorPrefix: 'Error: ',
            sendFailed: 'Sending failed',
            sendError: 'Broadcast send error',
            minTime: 'Duration must be greater than zero.',
            suspendUser: 'Suspend User',
            confirmPermanentKick: 'Kick this user from chat permanently and add them to the kicked list?',
            confirmKickPrefix: 'Kick this user for ',
            confirmKickSuffix: ' and block reconnection until that time expires?',
            kickFailed: 'Kick failed',
            kickError: 'Could not kick user',
            confirmSuspendPrefix: 'Suspend this user for ',
            confirmSuspendSuffix: ' and block all server activity?',
            suspendFailed: 'Suspension failed',
            suspendError: 'Could not suspend user',
            confirmResume: 'Resume this suspended user?',
            resumeError: 'Could not resume user',
            confirmUnkick: 'Remove this user from the kicked list?',
            unkickError: 'Could not remove kick',
            confirmLogout: 'Logout from the dashboard?',
            confirmClearMemory: 'Optimize memory and clear expired connections?',
            clearedConnectionsPrefix: 'Optimization completed: ',
            clearedConnectionsSuffix: ' expired connections were removed.',
            enterCurrentPassword: 'Enter the current password',
            newPasswordShort: 'The new password must be at least 6 characters',
            passwordMismatch: 'The new password and confirmation do not match',
            passwordChanged: 'Password changed successfully. Please log in again.',
            passwordChangeFailed: 'Password change failed',
            serverErrorShort: 'Server error',
            daysUnit: ' day',
            hoursUnit: ' hour',
            minutesUnit: ' minute',
            secondsUnit: ' second',
            and: ' and ',
        };
        const monitorTextKeyByFa = Object.fromEntries(Object.entries(monitorTextFa).map(([key, value]) => [value, key]));
        const monitorTextKeyByEn = Object.fromEntries(Object.entries(monitorTextEn).map(([key, value]) => [value, key]));
        function monitorLanguage() {
            return localStorage.getItem('monitor_language_v1') || 'fa';
        }
        function mt(key) {
            const lang = monitorLanguage();
            return (lang === 'en' ? monitorTextEn : monitorTextFa)[key] || monitorTextFa[key] || key;
        }
        function setMonitorLanguage(lang) {
            localStorage.setItem('monitor_language_v1', lang === 'en' ? 'en' : 'fa');
            applyMonitorLanguage();
            updateStats();
        }
        function translateMonitorTextNode(node) {
            const raw = node.nodeValue || '';
            const trimmed = raw.trim();
            if (!trimmed) return;
            const key = monitorTextKeyByFa[trimmed] || monitorTextKeyByEn[trimmed];
            if (!key) return;
            node.nodeValue = raw.replace(trimmed, mt(key));
        }
        function translateMonitorStaticText(root = document.body) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    const parent = node.parentElement;
                    if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            nodes.forEach(translateMonitorTextNode);
            document.querySelectorAll('[placeholder]').forEach((el) => {
                const key = monitorTextKeyByFa[el.getAttribute('placeholder')] || monitorTextKeyByEn[el.getAttribute('placeholder')];
                if (key) el.setAttribute('placeholder', mt(key));
            });
            document.querySelectorAll('[title]').forEach((el) => {
                const key = monitorTextKeyByFa[el.getAttribute('title')] || monitorTextKeyByEn[el.getAttribute('title')];
                if (key) el.setAttribute('title', mt(key));
            });
        }
        function applyMonitorLanguage() {
            const lang = monitorLanguage();
            document.documentElement.lang = lang;
            document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
            document.body.dir = lang === 'fa' ? 'rtl' : 'ltr';
            document.title = mt('documentTitle');
            const select = document.getElementById('monitorLanguageSelect');
            if (select) select.value = lang;
            translateMonitorStaticText();
            updateFileLabel();
        }

        /* The session cookie travels on its own for same-origin requests, so
           there is no Authorization header to build any more — and nothing in
           page storage for a cross-site script to steal. */
        function monitorAuthHeaders(includeJson = false) {
            return includeJson ? { 'Content-Type': 'application/json' } : {};
        }

        function applyMonitorAppearance() {
            const font = document.getElementById('monitorFontSelect')?.value || 'Vazirmatn';
            const size = document.getElementById('monitorFontSizeSelect')?.value || '16px';
            const theme = document.getElementById('monitorThemeSelect')?.value || 'dark';
            const zoom = size === '14px' ? '0.92' : (size === '18px' ? '1.08' : '1');
            document.body.classList.remove('monitor-theme-dark', 'monitor-theme-midnight', 'monitor-theme-nord', 'monitor-theme-dracula', 'monitor-theme-linen');
            document.body.classList.add('monitor-theme-' + theme);
            document.documentElement.style.setProperty('--monitor-font', font + ', system-ui, sans-serif');
            document.documentElement.style.setProperty('--monitor-font-size', size);
            document.body.style.zoom = zoom;
            localStorage.setItem('monitor_appearance_v1', JSON.stringify({ font, size, theme }));
        }

        function loadMonitorAppearance() {
            let saved = {};
            try { saved = JSON.parse(localStorage.getItem('monitor_appearance_v1') || '{}'); } catch (_error) {}
            const font = document.getElementById('monitorFontSelect');
            const size = document.getElementById('monitorFontSizeSelect');
            const theme = document.getElementById('monitorThemeSelect');
            if (font && saved.font) font.value = saved.font;
            if (size && saved.size) size.value = saved.size;
            if (theme && saved.theme) theme.value = saved.theme;
            applyMonitorAppearance();
        }

        function formatUptime(seconds) {
            const d = Math.floor(seconds / (3600*24));
            const h = Math.floor(seconds % (3600*24) / 3600);
            const m = Math.floor(seconds % 3600 / 60);
            const s = Math.floor(seconds % 60);
            return \`\${d > 0 ? d + 'd ' : ''}\${h.toString().padStart(2, '0')}:\${m.toString().padStart(2, '0')}:\${s.toString().padStart(2, '0')}\`;
        }

        /* throttle.client is derived from req.ip, which behind a proxy comes from
           a header a client can set. Everything rendered below therefore goes
           through here, even though most of it is the relay's own vocabulary. */
        function escHtml(value) {
            return String(value === undefined || value === null ? '' : value)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function relayTime(value) {
            const at = Date.parse(value || '');
            if (!Number.isFinite(at)) return '-';
            const locale = monitorLanguage() === 'fa' ? 'fa-IR' : 'en-US';
            return new Date(at).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }

        /* The relay throws messages away on purpose: media ages out after a
           week, a mailbox over quota loses its oldest, a text tail past the
           limit is trimmed. None of that used to reach a screen, so a message
           that never arrived was indistinguishable from one never sent. */
        function renderRelayHealth(relay, cert) {
            const instance = document.getElementById('relayInstance');
            const limitsEl = document.getElementById('relayLimits');
            const boxesEl = document.getElementById('relayMailboxes');
            const throttleEl = document.getElementById('relayThrottle');
            const summaryEl = document.getElementById('relayDiscardSummary');
            const bodyEl = document.getElementById('relayDiscardBody');
            if (!limitsEl) return;

            if (!relay) {
                instance.textContent = 'این نسخهٔ سرور این گزارش را نمی‌دهد';
                limitsEl.innerHTML = boxesEl.innerHTML = throttleEl.innerHTML = '';
                summaryEl.textContent = '-';
                bodyEl.innerHTML = '';
                return;
            }

            const limits = relay.limits || {};
            const boxes = relay.mailboxes || {};
            const discarded = relay.discarded || {};
            const throttle = relay.throttle || {};
            const sockets = relay.sockets || {};
            const row = (label, value, warn) => '<li class="flex justify-between gap-3 border-b border-slate-800/60 py-1">'
                + '<span class="text-slate-500">' + escHtml(label) + '</span>'
                + '<strong class="' + (warn ? 'text-amber-400' : 'text-white') + ' tabular-nums whitespace-nowrap">'
                + escHtml(value) + '</strong></li>';

            instance.textContent = relay.instanceId || '';

            /* Every reading is printed against its ceiling. A count on its own
               is not information: 412 peers is calm on one machine and the
               edge of capacity on another. */
            limitsEl.innerHTML = [
                row('رده', (limits.tier || '-') + ' · ' + (limits.cpuCount || 0) + ' هسته · ' + (limits.totalMemMb || 0) + ' MB'),
                row('سوکت‌ها', (sockets.total || 0) + ' از ' + (limits.wsMaxTotal || 0),
                    (sockets.total || 0) > (limits.wsMaxTotal || Infinity) * 0.8),
                row('سقف هر آی‌پی', String(limits.wsMaxPerIp || 0)),
                row('اتصال‌های ردشده', (sockets.refused && sockets.refused.total || 0) + ' ('
                    + (sockets.refused && sockets.refused.perIp || 0) + ' سقف آی‌پی، '
                    + (sockets.refused && sockets.refused.capacity || 0) + ' ظرفیت)',
                    (sockets.refused && sockets.refused.total || 0) > 0),
                row('صف متن', (boxes.textEnvelopes || 0) + ' از ' + (limits.textMailboxLimit || 0),
                    (boxes.textEnvelopes || 0) > (limits.textMailboxLimit || Infinity) * 0.8),
                row('سهمیهٔ رسانه', formatBytes(boxes.mediaBytes || 0) + ' از ' + formatBytes(limits.mediaQuotaBytes || 0)
                    + ' (' + (boxes.quotaPercent || 0) + '%)', (boxes.quotaPercent || 0) >= 80),
                row('نگهداری رسانه', Math.round((limits.mediaRetentionMs || 0) / 86400000) + ' روز'),
                row('اشتراک اعلان', (relay.push && relay.push.endpoints || 0) + ' روی ' + (relay.push && relay.push.subscribers || 0) + ' کاربر'),
                row('گواهی TLS', cert && Number.isFinite(cert.daysLeft) ? cert.daysLeft + ' روز مانده' : 'نامعلوم',
                    Boolean(cert && Number.isFinite(cert.daysLeft) && cert.daysLeft < 21)),
            ].join('');

            const fullest = Array.isArray(boxes.fullest) ? boxes.fullest : [];
            boxesEl.innerHTML = fullest.length
                ? fullest.map(box => row(box.fingerprint + '… (' + box.envelopes + ')',
                    formatBytes(box.mediaBytes || 0) + ' · ' + (box.quotaPercent || 0) + '%',
                    (box.quotaPercent || 0) >= 80)).join('')
                : row('هیچ صندوقی در صف نیست', '-');

            /* Addresses that were turned away belong next to the ones being
               throttled: both are people who could not do what they tried. */
            const turnedAway = (sockets.refused && sockets.refused.addresses) || [];
            const near = Array.isArray(throttle.nearOrOverLimit) ? throttle.nearOrOverLimit : [];
            throttleEl.innerHTML = turnedAway.map(item =>
                row('ردشده · ' + item.address, item.count + ' بار', true)).join('') + (near.length
                ? near.map(item => row(item.bucket + ' · ' + item.client,
                    item.count + '/' + item.ceiling + (item.over ? ' ⛔' : ''), true)).join('')
                : (turnedAway.length ? '' : row('هیچ‌کس نزدیک سقف نیست', (throttle.activeBuckets || 0) + ' فعال')));

            const reasons = Object.keys(discarded.byReason || {})
                .map(name => name + ': ' + discarded.byReason[name]).join(' · ');
            summaryEl.textContent = discarded.total
                ? (discarded.last24h || 0) + ' در ۲۴ ساعت، ' + discarded.total + ' روی هم' + (reasons ? ' — ' + reasons : '')
                : 'هیچ پیامی دور ریخته نشده';

            const recent = Array.isArray(discarded.recent) ? discarded.recent : [];
            bodyEl.innerHTML = recent.length
                ? recent.map(item => '<tr class="border-t border-slate-800/60">'
                    + '<td class="py-1 text-slate-300">' + escHtml(item.to) + '…</td>'
                    + '<td class="py-1 text-slate-500">' + escHtml(item.from) + '…</td>'
                    + '<td class="py-1">' + escHtml(item.class) + '</td>'
                    + '<td class="py-1 text-amber-400">' + escHtml(item.reason) + '</td>'
                    + '<td class="py-1 text-slate-500">' + escHtml(relayTime(item.queuedAt)) + '</td>'
                    + '<td class="py-1 text-slate-500">' + escHtml(relayTime(item.expiredAt)) + '</td>'
                    + '</tr>').join('')
                : '<tr><td colspan="6" class="py-3 text-slate-600">چیزی دور ریخته نشده است.</td></tr>';
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
            document.getElementById('fileLabel').textContent = file ? file.name : mt('chooseFile');
        }

        function clearFile() {
            document.getElementById('broadcastFile').value = '';
            updateFileLabel();
        }

        async function clearOfflineQueue() {
            if (!confirm(mt('confirmClearOffline'))) return;
            try {
                const res = await fetch('/admin/clear-offline', {
                    method: 'POST',
                    headers: monitorAuthHeaders()
                });
                if (res.ok) {
                    alert(mt('offlineCleared'));
                    updateStats();
                }
            } catch (err) { alert(mt('serverError')); }
        }

        async function clearErrorQueue() {
            if (!confirm(mt('confirmClearErrors'))) return;
            try {
                const res = await fetch('/admin/clear-offline', {
                    method: 'POST',
                    headers: monitorAuthHeaders()
                });
                if (res.ok) {
                    alert(mt('errorsCleared'));
                    updateStats();
                }
            } catch (err) { alert(mt('serverError')); }
        }

        async function optimizeRAM() {
            if (!confirm(mt('confirmOptimizeRam'))) return;
            try {
                const res = await fetch('/admin/optimize-ram', {
                    method: 'POST',
                    headers: monitorAuthHeaders()
                });
                const data = await res.json();
                if (data.ok) {
                    alert(mt('optimizedPrefix') + data.saved + mt('optimizedSuffix'));
                }
                updateStats();
            } catch (err) { alert(mt('serverError')); }
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
                    headers: monitorAuthHeaders(true),
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
                    alert(mt('sentPrefix') + data.sentTo + mt('sentSuffix'));
                    document.getElementById('broadcastMsg').value = '';
                    clearFile();
                } else {
                    alert(mt('errorPrefix') + (data.reason || mt('sendFailed')));
                }
            } catch (err) { alert(mt('sendError')); }
        }

        let activePolicyResolve = null;
        function closePolicyModal(result = null) {
            document.getElementById('policyModal').classList.add('hidden');
            const resolve = activePolicyResolve;
            activePolicyResolve = null;
            if (resolve) resolve(result);
        }

        function askPolicyDurationModal(actionLabel, allowPermanent) {
            return new Promise((resolve) => {
                if (activePolicyResolve) activePolicyResolve(null);
                activePolicyResolve = resolve;
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
                        closePolicyModal({ permanent: true, minutes: 0, ms: 0 });
                        return;
                    }

                    const d = parseInt(document.getElementById('policyDays').value || 0, 10);
                    const h = parseInt(document.getElementById('policyHours').value || 0, 10);
                    const m = parseInt(document.getElementById('policyMinutes').value || 0, 10);
                    const s = parseInt(document.getElementById('policySeconds').value || 0, 10);

                    const totalMs = (((d * 24 + h) * 60 + m) * 60 + s) * 1000;

                    if (totalMs <= 0) {
                        alert(mt('minTime'));
                        return;
                    }
                    closePolicyModal({ permanent: false, minutes: Math.max(1, Math.ceil(totalMs / 60000)), ms: totalMs });
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
            if (d) parts.push(d + mt('daysUnit'));
            if (h) parts.push(h + mt('hoursUnit'));
            if (m) parts.push(m + mt('minutesUnit'));
            if (s) parts.push(s + mt('secondsUnit'));
            return parts.join(mt('and')) || ('1' + mt('secondsUnit'));
        }

        async function kickPeer(clientId) {
            const duration = await askPolicyDurationModal(mt('kick'), true);
            if (!duration) return;
            if (duration.permanent) {
                if (!confirm(mt('confirmPermanentKick'))) return;
            } else {
                const durationLabel = formatPolicyDuration(duration.ms);
                if (!confirm(mt('confirmKickPrefix') + durationLabel + mt('confirmKickSuffix'))) return;
            }
            try {
                const res = await fetch('/admin/kick-peer', {
                    method: 'POST',
                    headers: monitorAuthHeaders(true),
                    body: JSON.stringify({
                        clientId,
                        permanent: Boolean(duration.permanent),
                        durationMinutes: duration.minutes,
                        durationMs: duration.ms
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    updateStats();
                    setTimeout(updateStats, 1200);
                } else {
                    alert(mt('errorPrefix') + (data.reason || mt('kickFailed')));
                }
            } catch (err) { alert(mt('kickError')); }
        }

        async function suspendPeer(clientId) {
            const duration = await askPolicyDurationModal(mt('suspendUser'), false);
            if (!duration) return;
            const durationLabel = formatPolicyDuration(duration.ms);
            if (!confirm(mt('confirmSuspendPrefix') + durationLabel + mt('confirmSuspendSuffix'))) return;
            try {
                const res = await fetch('/admin/suspend-peer', {
                    method: 'POST',
                    headers: monitorAuthHeaders(true),
                    body: JSON.stringify({ clientId, durationMinutes: duration.minutes, durationMs: duration.ms })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    updateStats();
                    setTimeout(updateStats, 1200);
                }
                else alert(mt('errorPrefix') + (data.reason || mt('suspendFailed')));
            } catch (err) { alert(mt('suspendError')); }
        }

        async function resumePeer(key) {
            if (!confirm(mt('confirmResume'))) return;
            try {
                const res = await fetch('/admin/resume-peer', {
                    method: 'POST',
                    headers: monitorAuthHeaders(true),
                    body: JSON.stringify({ key })
                });
                if (res.ok) updateStats();
            } catch (err) { alert(mt('resumeError')); }
        }

        async function unkickPeer(key) {
            if (!confirm(mt('confirmUnkick'))) return;
            try {
                const res = await fetch('/admin/unkick-peer', {
                    method: 'POST',
                    headers: monitorAuthHeaders(true),
                    body: JSON.stringify({ key })
                });
                if (res.ok) updateStats();
            } catch (err) { alert(mt('unkickError')); }
        }

        function logout() {
            if(!confirm(mt('confirmLogout'))) return;
            fetch('/admin/logout', {
                method: 'POST',
                headers: monitorAuthHeaders(),
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
                const res = await fetch('/healthz?_t=' + Date.now(), {
                    headers: monitorAuthHeaders()
                });
                const ping = Date.now() - startTime;
                if (res.status === 401) { window.location.reload(); return; }
                const data = await res.json();
                
                // Update Numeric Stats
                document.getElementById('statPeers').textContent = data.peers;
                document.getElementById('statMemory').textContent = data.memory.heapUsed + ' MB';
                document.getElementById('statCpu').textContent = data.cpuLoad + ' %';
                document.getElementById('statPing').innerHTML = ping + ' <span class="text-sm">ms</span>';
                const locale = monitorLanguage() === 'fa' ? 'fa-IR' : 'en-US';
                document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString(locale);
                
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
                document.getElementById('sysTurn').textContent = data.turnEnabled ? mt('active') : mt('inactive');
                renderRelayHealth(data.relay, data.cert);
                document.getElementById('sysTurn').className = data.turnEnabled ? 'font-black text-emerald-400' : 'font-black text-rose-400';

                // Peer List Table
                const tableBody = document.getElementById('peerTableBody');
                const targetSelect = document.getElementById('broadcastTarget');
                const previousTarget = targetSelect.value;
                targetSelect.innerHTML = '<option value="">' + mt('allConnectedUsers') + '</option>' + data.peersList.map(peer => {
                    const value = encodeURIComponent(JSON.stringify({ clientId: peer.clientId, fingerprint: peer.fingerprint || '' }));
                    return \`<option value="\${value}">\${peer.username} - \${peer.ip.replace('::ffff:', '')}</option>\`;
                }).join('');
                if ([...targetSelect.options].some(option => option.value === previousTarget)) {
                    targetSelect.value = previousTarget;
                }

                tableBody.innerHTML = data.peersList.map(peer => {
                    const identityPayload = encodeURIComponent(JSON.stringify({
                        username: peer.username || '',
                        clientId: peer.clientId || '',
                        peerId: peer.peerId || '',
                        fingerprint: peer.fingerprint || '',
                        ip: peer.ip || ''
                    }));
                    return \`
                    <tr class="peer-row border-b border-white/5 transition-colors">
                        <td class="py-4 pr-4">
                            <div class="font-black text-white">\${peer.username}</div>
                            <button onclick="showPeerIdentity('\${identityPayload}')" class="mt-2 text-[10px] text-sky-400 hover:text-sky-300 font-black px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/10 transition-all">\${mt('details')}</button>
                        </td>
                        <td class="py-4 font-mono text-xs text-slate-400">\${peer.ip.replace('::ffff:', '')}</td>
                        <td class="py-4 text-slate-400">
                             <div class="text-xs font-bold">\${formatUptime(Math.floor((Date.now() - peer.connectedAt)/1000))}</div>
                             <div class="text-[9px] text-slate-600">\${mt('from')}\${new Date(peer.connectedAt).toLocaleTimeString(locale)}</div>
                        </td>
                        <td class="py-4 text-left pl-4">
                            <div class="flex justify-end gap-3">
                                <button onclick="suspendPeer('\${peer.clientId}')" class="text-amber-400 hover:text-amber-300 font-bold transition-colors">\${mt('suspend')}</button>
                                <button onclick="kickPeer('\${peer.clientId}')" class="text-rose-500 hover:text-rose-400 font-bold transition-colors">\${mt('kick')}</button>
                            </div>
                        </td>
                    </tr>
                \`;
                }).join('');

                const suspended = data.suspendedUsers || [];
                document.getElementById('suspendedCount').textContent = suspended.length + ' ' + mt('usersUnit');
                document.getElementById('suspendedTableBody').innerHTML = suspended.length ? suspended.map(user => \`
                    <tr class="border-b border-white/5">
                        <td class="py-4 pr-4">
                            <div class="font-black text-white">\${user.username || mt('unknownUser')}</div>
                            <div class="text-[9px] text-slate-500 font-mono truncate max-w-[180px]">\${user.peerId || user.clientId || user.key}</div>
                        </td>
                        <td class="py-4 text-slate-400">
                            <div class="font-mono text-[10px] truncate max-w-[220px]">\${user.fingerprint || mt('noFingerprint')}</div>
                            <div class="text-[9px] text-slate-600">\${user.ip || mt('unknownIp')}</div>
                        </td>
                        <td class="py-4 text-slate-400">
                            <div>\${user.createdAt ? new Date(user.createdAt).toLocaleString(locale) : '--'}</div>
                            <div class="text-[9px] text-amber-300 mt-1">\${user.expiresAt ? mt('until') + new Date(user.expiresAt).toLocaleString(locale) : mt('noEndTime')}</div>
                        </td>
                        <td class="py-4 text-left pl-4">
                            <button onclick="resumePeer('\${user.key}')" class="text-emerald-400 hover:text-emerald-300 font-bold transition-colors">\${mt('resume')}</button>
                        </td>
                    </tr>
                \`).join('') : '<tr><td colspan="4" class="py-8 text-center text-slate-500 font-bold">' + mt('noSuspendedUsers') + '</td></tr>';

                const kicked = data.kickedUsers || [];
                document.getElementById('kickedCount').textContent = kicked.length + ' ' + mt('usersUnit');
                document.getElementById('kickedTableBody').innerHTML = kicked.length ? kicked.map(user => \`
                    <tr class="border-b border-white/5">
                        <td class="py-4 pr-4">
                            <div class="font-black text-white">\${user.username || mt('unknownUser')}</div>
                            <div class="text-[9px] text-slate-500 font-mono truncate max-w-[180px]">\${user.peerId || user.clientId || user.key}</div>
                        </td>
                        <td class="py-4 text-slate-400">
                            <div class="font-mono text-[10px] truncate max-w-[220px]">\${user.fingerprint || mt('noFingerprint')}</div>
                            <div class="text-[9px] text-slate-600">\${user.ip || mt('unknownIp')}</div>
                        </td>
                        <td class="py-4 text-slate-400">
                            <div>\${user.createdAt ? new Date(user.createdAt).toLocaleString(locale) : '--'}</div>
                            <div class="text-[9px] text-rose-300 mt-1">\${user.permanent ? mt('unlimited') : (user.expiresAt ? mt('until') + new Date(user.expiresAt).toLocaleString(locale) : '--')}</div>
                        </td>
                        <td class="py-4 text-left pl-4">
                            <button onclick="unkickPeer('\${user.key}')" class="text-emerald-400 hover:text-emerald-300 font-bold transition-colors">\${mt('unkick')}</button>
                        </td>
                    </tr>
                \`).join('') : '<tr><td colspan="4" class="py-8 text-center text-slate-500 font-bold">' + mt('noKickedUsers') + '</td></tr>';

                // Logs
                const logContainer = document.getElementById('logContainer');
                const totalLogs = data.logs.length;
                const totalPages = Math.ceil(totalLogs / logsPerPage) || 1;
                if (logPage > totalPages) logPage = totalPages;
                
                document.getElementById('logPageIndicator').textContent = mt('page') + ' ' + logPage + ' ' + mt('pageOf') + ' ' + totalPages;
                document.getElementById('prevLogBtn').disabled = logPage <= 1;
                document.getElementById('nextLogBtn').disabled = logPage >= totalPages;

                const start = (logPage - 1) * logsPerPage;
                const end = start + logsPerPage;
                const paginatedLogs = data.logs.slice(start, end);

                const atBottom = logContainer.scrollHeight - logContainer.scrollTop <= logContainer.clientHeight + 50;
                logContainer.innerHTML = paginatedLogs.map(log => \`
                    <div class="log-entry log-\${log.type} p-2 rounded-r flex gap-3">
                        <span class="text-slate-600 font-bold">\${new Date(log.ts).toLocaleTimeString(locale)}</span>
                        <span class="text-slate-300">\${log.msg}</span>
                    </div>
                \`).join('');
                if(atBottom && logPage === totalPages) logContainer.scrollTop = logContainer.scrollHeight;

                // Update Charts
                const time = new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                
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
                
                document.getElementById('statusIndicator').innerHTML = '<span class="w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-[0_0_15px_rgba(34,197,94,0.8)]"></span> ' + mt('operational');
            } catch (err) {
                console.error(err);
                document.getElementById('statusIndicator').innerHTML = '<span class="w-3 h-3 bg-red-500 rounded-full"></span> ' + mt('disconnected');
            }
        }

        function setupAutoRefresh() {
            if (refreshTimer) clearInterval(refreshTimer);
            const interval = parseInt(document.getElementById('refreshInterval').value);
            refreshTimer = setInterval(updateStats, interval);
        }

        function showPeerIdentity(encoded) {
            try {
                const peer = JSON.parse(decodeURIComponent(encoded));
                alert([
                    mt('username') + ': ' + (peer.username || '--'),
                    'Client ID: ' + (peer.clientId || '--'),
                    'Peer ID: ' + (peer.peerId || '--'),
                    'Fingerprint: ' + (peer.fingerprint || mt('noFingerprint')),
                    'IP: ' + String(peer.ip || '--').replace('::ffff:', '')
                ].join('\\n\\n'));
            } catch (_error) {
                alert(mt('noFingerprint'));
            }
        }

        async function clearMemory() {
            if (!confirm(mt('confirmClearMemory'))) return;
            try {
                const res = await fetch('/admin/clear-memory', {
                    method: 'POST',
                    headers: monitorAuthHeaders()
                });
                const data = await res.json();
                if (data.ok) {
                    alert(mt('clearedConnectionsPrefix') + data.clearedPresence + mt('clearedConnectionsSuffix'));
                }
                updateStats();
            } catch (err) { alert(mt('serverError')); }
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
            
            if (!oldPass) { alert(mt('enterCurrentPassword')); return; }
            if (newPass.length < 6) { alert(mt('newPasswordShort')); return; }
            if (newPass !== confirmPass) { alert(mt('passwordMismatch')); return; }

            try {
                const res = await fetch('/admin/change-password', {
                    method: 'POST',
                    headers: monitorAuthHeaders(true),
                    body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
                });
                if (res.ok) {
                    alert(mt('passwordChanged'));
                    localStorage.removeItem('monitor_token_v2');
                    window.location.reload();
                } else {
                    const data = await res.json();
                    alert(mt('errorPrefix') + (data.reason || mt('passwordChangeFailed')));
                }
            } catch (err) { alert(mt('serverErrorShort')); }
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

        loadMonitorAppearance();
        applyMonitorLanguage();
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
    /* What this instance sized itself to, and how full it is. A load balancer
       reads `saturation` to decide where to send the next peer; an operator
       reads `tier` to understand why the ceilings are what they are. Nothing
       secret is here — the numbers describe capacity, not configuration. */
    capacity: {
      tier: CAPACITY.tier,
      cpus: CAPACITY.cpuCount,
      memoryMb: CAPACITY.totalMemMb,
      sockets: { inUse: wsTotal, max: WS_MAX_TOTAL, maxPerAddress: WS_MAX_PER_IP },
      saturation: WS_MAX_TOTAL > 0 ? Number((wsTotal / WS_MAX_TOTAL).toFixed(3)) : 0,
    },
    instance: INSTANCE_ID,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/* ------------------------------------------------------------------
 * Load-balancer probes
 *
 * /ready is the one a balancer should poll: it answers 503 once this instance
 * is full or is shutting down, which is how a pool stops sending new peers to
 * a node that cannot take them instead of failing their connections. /live
 * only says the process is running, which is what a supervisor wants — a full
 * instance must not be restarted, it is working perfectly.
 * ------------------------------------------------------------------ */
app.get('/ready', (_req, res) => {
  const saturation = WS_MAX_TOTAL > 0 ? wsTotal / WS_MAX_TOTAL : 0;
  const ready = !shuttingDown && saturation < 0.95;
  res.status(ready ? 200 : 503).json({
    ready,
    instance: INSTANCE_ID,
    draining: shuttingDown,
    sockets: wsTotal,
    max: WS_MAX_TOTAL,
    saturation: Number(saturation.toFixed(3)),
  });
});

app.get('/live', (_req, res) => {
  res.json({ live: true, instance: INSTANCE_ID, uptimeSeconds: Math.round(process.uptime()) });
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

app.get('/cert-status', (_req, res) => {
  const certPath = process.env.CHAT_TLS_CERT_PATH || '/etc/certs/cert.pem';
  try {
    const pem = fs.readFileSync(certPath);
    const cert = new crypto.X509Certificate(pem);
    const msLeft = new Date(cert.validTo).getTime() - Date.now();
    res.json({
      ok: msLeft > 0,
      subject: cert.subject,
      issuer: cert.issuer,
      validFrom: cert.validFrom,
      validTo: cert.validTo,
      daysLeft: Math.floor(msLeft / 86400000),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String((error && error.message) || error) });
  }
});

app.get('/push/vapid-public-key', (_req, res) => {
  res.json({
    enabled: true,
    publicKey: vapidKeys.publicKey,
  });
});



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

  /* The caller says how long it wants to stay reachable; the sweep drops the
     record when that runs out, so a device that stops asking stops being
     stored rather than sitting in the file forever. */
  const ttlDays = normalizePushTtlDays(req.body?.ttlDays);
  const deviceId = String(req.body?.deviceId || '').slice(0, 128);
  const key = pushIndexKey(fingerprint);
  const subscriptions = pushSubscriptions.get(key) || [];
  /* One row per device. Filtering on the endpoint alone was not enough: a
     device that re-subscribes is issued a NEW endpoint, so the old row stayed
     and the next message woke that phone once per row. */
  const next = subscriptions.filter((item) => item.endpoint !== subscription.endpoint
    && !(deviceId && item.deviceId === deviceId)
    /* Rows written before devices identified themselves cannot be matched, so
       a device re-registering with an id clears them out. Any real device that
       still has one re-registers on its next launch — the client subscribes
       again on every hello — and gets a row back immediately. */
    && !(deviceId && !item.deviceId));
  next.push({
    ...subscription,
    /* The body's language is the device's, stated at subscribe time. */
    lang: normalizePushLang(req.body?.lang || subscription.lang),
    ttlDays,
    ...(deviceId ? { deviceId } : {}),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
  });
  pushSubscriptions.set(key, next.slice(-5));
  savePushSubscriptions();
  res.json({ ok: true, count: pushSubscriptions.get(key).length, ttlDays });
});

app.post('/push/unsubscribe', (req, res) => {
  const fingerprint = sanitizeFingerprint(req.body?.fingerprint);
  const endpoint = String(req.body?.endpoint || '').slice(0, 2048);
  if (!fingerprint || !endpoint) {
    res.status(400).json({ ok: false, reason: 'invalid-unsubscribe' });
    return;
  }

  const key = pushIndexKey(fingerprint);
  const subscriptions = pushSubscriptions.get(key) || [];
  const next = subscriptions.filter((item) => item.endpoint !== endpoint);
  if (next.length) {
    pushSubscriptions.set(key, next);
  } else {
    pushSubscriptions.delete(key);
  }
  savePushSubscriptions();
  res.json({ ok: true });
});

/* Admission by invitation: who is on the list, who goes on it, who comes off,
   and whether the door is closed at all. */
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

const upgradeListenersBeforePeer = new Set(server.listeners('upgrade'));
// A TCP connection that dies without a close frame -- phone suspends, carrier
// NAT entry expires, Wi-Fi drops mid-packet -- stays "open" on both ends
// forever. Protocol-level ping/pong is the only thing that detects it, and
// detecting it quickly is what frees the peer id so a returning client can
// reclaim its own id instead of being told it is taken.
function attachSocketKeepAlive(wss, label, intervalMs = 15000) {
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        console.log(`[${label}] Terminating unresponsive socket.`);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch (_error) { /* socket already gone */ }
    }
  }, intervalMs);
  timer.unref?.();
  wss.on('close', () => clearInterval(timer));
  return wss;
}

const peerServer = ExpressPeerServer(server, {
  path: '/peerjs',
  proxied: true,
  allow_discovery: true,
  key: 'peerjs',
  // alive_timeout is driven by application-level HEARTBEAT messages, which a
  // backgrounded browser tab stops sending because its timers are frozen. The
  // 90s default therefore evicted every phone that spent a minute and a half
  // in someone's pocket. Ping/pong above reaps genuinely dead sockets within
  // ~30s, so this window only needs to cover frozen-but-connected clients.
  alive_timeout: 600000,
  expire_timeout: 10000,
  // Peer signalling frames are small; capping them costs nothing and stops a
  // single peer from buffering an unbounded frame in this process.
  createWebSocketServer: (options) => attachSocketKeepAlive(
    new WebSocketServer({ ...options, maxPayload: 12 * 1024 * 1024 }),
    'PeerJS',
  ),
});
app.use(peerServer);
const peerUpgradeListeners = server.listeners('upgrade')
  .filter((listener) => !upgradeListenersBeforePeer.has(listener));
for (const listener of peerUpgradeListeners) {
  server.off('upgrade', listener);
}

/* ------------------------------------------------------------------
 * Socket accounting
 *
 * Nothing counted sockets, so one machine could hold as many as it could open
 * — measured at 120 of 120 accepted from a single address, and there was no
 * reason it would have stopped there. Each socket costs a file descriptor, a
 * presence entry and a heartbeat, so this is the cheapest denial of service
 * available against this server.
 *
 * A household behind one NAT is several devices and several tabs, so the
 * per-address ceiling is generous; it exists to stop a flood, not to ration
 * ordinary use.
 * ------------------------------------------------------------------ */
const WS_MAX_TOTAL = Number(process.env.CHAT_WS_MAX_TOTAL || CAPACITY.wsMaxTotal);
const WS_MAX_PER_IP = Number(process.env.CHAT_WS_MAX_PER_IP || CAPACITY.wsMaxPerIp);
const wsPerAddress = new Map();
let wsTotal = 0;

function socketAddress(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || request.socket?.remoteAddress || 'unknown';
}

function rejectUpgrade(socket, status, reason) {
  try {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  } catch (_error) { /* the peer may already be gone */ }
  try { socket.destroy(); } catch (_error) { /* noop */ }
}

function trackSocket(ws, address) {
  wsTotal += 1;
  wsPerAddress.set(address, (wsPerAddress.get(address) || 0) + 1);
  const release = () => {
    if (ws.__poorijaReleased) return;
    ws.__poorijaReleased = true;
    wsTotal = Math.max(0, wsTotal - 1);
    const left = (wsPerAddress.get(address) || 1) - 1;
    if (left <= 0) wsPerAddress.delete(address);
    else wsPerAddress.set(address, left);
  };
  ws.once('close', release);
  ws.once('error', release);
}

/* Turned-away connections, counted.
 *
 * These refusals were invisible: the socket is rejected before any handler
 * runs, nothing is logged, and the browser reports the same "connection
 * failed" it would show for a server that is switched off. An operator had no
 * way to tell "nobody can reach me" from "some people are being turned away".
 *
 * It is not hypothetical. The per-address cap is
 * `clamp(20 + totalMemMb / 256, 20, 400)`, which is 35 on a 4 GB relay, and
 * mobile carriers put thousands of subscribers behind one address — under
 * CGNAT the thirty-sixth person on that network is refused and told nothing.
 * Whether 35 is the right number is a judgement about the deployment, and
 * CHAT_WS_MAX_PER_IP exists to change it; being able to SEE it happen is not a
 * judgement, it is the difference between a diagnosable problem and a mystery. */
const socketRefusals = { total: 0, perIp: 0, capacity: 0, lastAt: null, addresses: new Map() };

function noteRefusal(address, kind) {
  socketRefusals.total += 1;
  socketRefusals[kind] += 1;
  socketRefusals.lastAt = new Date().toISOString();
  socketRefusals.addresses.set(address, (socketRefusals.addresses.get(address) || 0) + 1);
  /* Bounded: one entry per address that has ever been refused would itself be
     a way to grow the process without limit. */
  if (socketRefusals.addresses.size > 200) {
    const oldest = socketRefusals.addresses.keys().next().value;
    socketRefusals.addresses.delete(oldest);
  }
}

function socketBudgetRefused(request, socket) {
  const address = socketAddress(request);
  if (wsTotal >= WS_MAX_TOTAL) {
    noteRefusal(address, 'capacity');
    rejectUpgrade(socket, 503, 'Service Unavailable');
    return true;
  }
  if ((wsPerAddress.get(address) || 0) >= WS_MAX_PER_IP) {
    noteRefusal(address, 'perIp');
    rejectUpgrade(socket, 429, 'Too Many Requests');
    return true;
  }
  return false;
}

function handlePresenceUpgrade(request, socket, head) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const restriction = getRestrictionForIdentity(upgradeRequestIdentity(request, url));
  if (restriction) {
    rejectRestrictedUpgrade(socket, restriction);
    return;
  }
  if (socketBudgetRefused(request, socket)) return;
  const address = socketAddress(request);
  wsServer.handleUpgrade(request, socket, head, (ws) => {
    trackSocket(ws, address);
    wsServer.emit('connection', ws, request);
  });
}

// Manual upgrade handler to resolve path conflicts between wsServer and PeerJS
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (pathname === '/chat-signal') {
    handlePresenceUpgrade(request, socket, head);
    return;
  }
  if (pathname === '/peerjs/peerjs' || pathname.startsWith('/peerjs/peerjs/')) {
    const restriction = getRestrictionForIdentity(upgradeRequestIdentity(request, url));
    if (restriction) {
      rejectRestrictedUpgrade(socket, restriction);
      return;
    }
    if (socketBudgetRefused(request, socket)) return;
    for (const listener of peerUpgradeListeners) {
      listener.call(server, request, socket, head);
    }
    return;
  }
  socket.destroy();
});

presenceServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname !== '/chat-signal') {
    socket.destroy();
    return;
  }
  handlePresenceUpgrade(request, socket, head);
});

  const offlineBoxes = loadOfflineBoxes();
/* Retention has to run on a clock as well as on use: a mailbox nobody writes
   to and nobody collects would otherwise keep week-old media forever. */
setInterval(() => {
  try {
    sweepRetention();
  } catch (error) {
    console.error('[Retention] sweep failed:', error);
  }
}, RETENTION_SWEEP_MS).unref?.();
  const pushSubscriptions = loadPushSubscriptions();
  const selfDestructRecords = loadSelfDestructRecords();
  const policyStore = loadPolicyStore();
  const suspendedUsers = new Map(Object.entries(policyStore.suspendedUsers || {}));
  const kickedUsers = new Map(Object.entries(policyStore.kickedUsers || {}));
/* Admission by invitation rather than by exception.
 *
 * The key is the identity fingerprint, which is derived from the public key.
 * Generating a new key therefore produces a new fingerprint and a stranger
 * again -- which is the point: rotating a key must not be a way around the
 * door, and on a deny list it always is. */
const allowedUsers = new Map(Object.entries(policyStore.allowedUsers || {}));
/* Off means the relay is open, which is what it has always been and what an
   existing install keeps after an upgrade. Turning it on is a decision. */
let allowlistEnabled = Boolean(policyStore.allowlistEnabled);

/* One file per mailbox, not one file for the whole server.
 *
 * Every queued message used to rewrite the entire store. That is fine at a few
 * megabytes and quadratic after that: the cost of storing message N is the
 * size of messages 1..N-1, so a relay that has been busy for a while spends
 * seconds of synchronous I/O on every single delivery and never recovers. A
 * test relay here reached 328 MB and 3,496 envelopes, at which point a file
 * transfer that normally takes three minutes could not finish in ten.
 *
 * Sharding by recipient makes a write cost that recipient's own queue, which
 * is bounded by their quota. The whole store is never rewritten again.
 *
 * The legacy single file is imported once on boot and kept, renamed, so the
 * upgrade is reversible. */
function mailboxPath(fingerprint) {
  return path.join(OFFLINE_STORE_DIR, `${fingerprint}.json`);
}

function importLegacyOfflineStore() {
  if (!fs.existsSync(OFFLINE_STORE_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(OFFLINE_STORE_PATH, 'utf8'));
    const boxes = new Map(Object.entries(raw || {}).map(([fingerprint, items]) => [
      sanitizeFingerprint(fingerprint),
      Array.isArray(items) ? items : [],
    ]).filter(([fingerprint, items]) => fingerprint && items.length));
    fs.mkdirSync(OFFLINE_STORE_DIR, { recursive: true });
    boxes.forEach((items, fingerprint) => writeJsonAtomic(mailboxPath(fingerprint), items));
    /* Renamed rather than deleted: if this upgrade turns out to be wrong, the
       old store is still sitting there whole. */
    fs.renameSync(OFFLINE_STORE_PATH, `${OFFLINE_STORE_PATH}.migrated`);
    console.log(`[Store] imported ${boxes.size} mailbox(es) from the single-file store.`);
    return boxes;
  } catch (error) {
    console.error('Failed to import the legacy offline store:', error);
    return null;
  }
}

function loadOfflineBoxes() {
  try {
    const imported = importLegacyOfflineStore();
    if (imported) return imported;
    if (!fs.existsSync(OFFLINE_STORE_DIR)) return new Map();
    const boxes = new Map();
    fs.readdirSync(OFFLINE_STORE_DIR).forEach((name) => {
      if (!name.endsWith('.json')) return;
      const fingerprint = sanitizeFingerprint(name.slice(0, -5));
      if (!fingerprint) return;
      try {
        const items = JSON.parse(fs.readFileSync(path.join(OFFLINE_STORE_DIR, name), 'utf8'));
        if (Array.isArray(items) && items.length) boxes.set(fingerprint, items);
      } catch (error) {
        /* One unreadable mailbox must not cost every other mailbox. */
        console.error(`Failed to read mailbox ${name}:`, error.message);
      }
    });
    return boxes;
  } catch (error) {
    console.error('Failed to load offline boxes:', error);
    return new Map();
  }
}

/* ------------------------------------------------------------------
 * Retention
 * ------------------------------------------------------------------ */
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
    writeJsonAtomic(EXPIRY_LOG_PATH, expiryLog);
  } catch (error) {
    console.error('Failed to save the expiry log:', error);
  }
}

/* What the sweep needs to know about an envelope, worked out once and kept
   against the envelope itself, so it is dropped when the envelope is and
   reaches neither the store nor the recipient.

   The sweep runs every time mail lands, and it re-derived all three facts for
   every envelope already waiting: sizing one means stringifying it, and the
   sort that orders them calls queuedAtMs twice per comparison. A file arrives
   as one envelope per chunk into one mailbox, so chunk N paid for the N-1
   before it and a transfer cost the square of its own size in JSON and date
   parsing. Measured over a 30 MB file, the last chunks landed several times
   slower than the first; a 200 MB one crawled. Deriving each fact once turns
   that back into a walk of numbers. */
const envelopeFacts = new WeakMap();

function envelopeFactsFor(item) {
  const cached = item && typeof item === 'object' ? envelopeFacts.get(item) : null;
  if (cached) return cached;

  const declared = String(item?.payload?.class || '').toLowerCase();
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
  } catch (error) {
    bytes = 0;
  }
  const parsed = Date.parse(item?.queuedAt || '');

  const facts = {
    kind: declared === 'media' ? 'media' : 'text',
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

/* Records that something arrived and did not survive long enough to be
   collected, so the recipient can be told rather than left wondering. The note
   deliberately carries no message id and nothing from the body — only that
   there was one, from whom, and when. */
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
}

/* Runs on a timer and on every enqueue. Text is only ever trimmed at the
   ceiling; media goes when it is a week old or when the mailbox is over
   quota, oldest first. */
/* `only` scopes the walk to one recipient's mailbox.
 *
 * Measured on a relay holding 297 mailboxes and 468 MB: one unscoped sweep
 * takes 171 ms, because it JSON.stringifies every media envelope on the server
 * to weigh it against the quota. That ran synchronously on every `hello` and
 * on every queued message, so the cost of one delivery was the size of
 * everyone else's mail — the same quadratic shape this file already fixed once
 * for disk I/O, reintroduced for CPU. At that size the event loop stalls for a
 * sixth of a second every time somebody connects, and it only grows.
 *
 * Queueing a message can only push something out of THAT recipient's mailbox,
 * and a `hello` only needs that peer's queue expired before it is handed over.
 * Neither needs to look at anyone else's. The timer still does the full walk,
 * which is what catches mail belonging to people who never come back. */
function sweepRetention(only = null) {
  const now = Date.now();
  let changed = false;
  /* Which mailboxes the sweep actually touched, so a caller can write those
     rather than all of them. */
  const touched = new Set();

  /* Push subscriptions expire on the window the user chose in Settings. The
     store used to keep them until a vendor said 410, which meant a device that
     was never used again stayed on file indefinitely. */
  let pushChanged = false;
  for (const [key, items] of pushSubscriptions.entries()) {
    const live = items.filter((item) => !item.expiresAt || Date.parse(item.expiresAt) > now);
    if (live.length === items.length) continue;
    pushChanged = true;
    if (live.length) pushSubscriptions.set(key, live);
    else pushSubscriptions.delete(key);
  }
  if (pushChanged) savePushSubscriptions();

  const boxes = only
    ? (offlineBoxes.has(only) ? [[only, offlineBoxes.get(only)]] : [])
    : offlineBoxes.entries();
  for (const [fingerprint, items] of boxes) {
    /* Mail landing is the ordinary case, and ordinarily it evicts nothing:
       the box is inside both caps, everything in it is younger than its
       retention, and no reservation has gone stale. Settle that first, with
       nothing but arithmetic over the cached facts, and leave without copying
       the array or sorting it. A file arriving as thousands of chunks runs
       this path thousands of times. */
    let standingMedia = 0;
    let standingText = 0;
    let mustSweep = false;
    for (const item of items) {
      const facts = envelopeFactsFor(item);
      const age = now - facts.at;
      if (facts.kind === 'media') {
        if (age > MEDIA_RETENTION_MS) { mustSweep = true; break; }
        standingMedia += facts.bytes;
        if (standingMedia > MEDIA_QUOTA_BYTES) { mustSweep = true; break; }
      } else {
        standingText += 1;
      }
      if (item?.payload?.type === 'session-offer' && age > SESSION_RESERVATION_MS) {
        mustSweep = true;
        break;
      }
    }
    if (!mustSweep && standingText <= TEXT_MAILBOX_LIMIT) continue;

    const keep = [];
    let mediaBytes = 0;

    // Newest first so the quota drops the oldest media, not the newest.
    const ordered = [...items].sort((a, b) => queuedAtMs(b) - queuedAtMs(a));
    for (const item of ordered) {
      const kind = envelopeClass(item);
      const age = now - queuedAtMs(item);

      if (kind === 'media') {
        if (age > MEDIA_RETENTION_MS) {
          noteExpired(fingerprint, item, 'retention');
          changed = true;
          continue;
        }
        const size = envelopeBytes(item);
        if (mediaBytes + size > MEDIA_QUOTA_BYTES) {
          noteExpired(fingerprint, item, 'quota');
          changed = true;
          continue;
        }
        mediaBytes += size;
      }

      if (item?.payload?.type === 'session-offer'
        && age > SESSION_RESERVATION_MS) {
        // An unclaimed reservation is a stranger's key sitting on a server.
        changed = true;
        continue;
      }

      keep.push(item);
    }

    // Back into arrival order, and cap the text tail.
    keep.sort((a, b) => queuedAtMs(a) - queuedAtMs(b));
    const texts = keep.filter((item) => envelopeClass(item) === 'text');
    if (texts.length > TEXT_MAILBOX_LIMIT) {
      const drop = new Set(texts.slice(0, texts.length - TEXT_MAILBOX_LIMIT));
      for (const item of drop) noteExpired(fingerprint, item, 'mailbox-full');
      changed = true;
      for (let i = keep.length - 1; i >= 0; i -= 1) {
        if (drop.has(keep[i])) keep.splice(i, 1);
      }
    }

    if (keep.length !== items.length) { changed = true; touched.add(fingerprint); }
    if (keep.length) offlineBoxes.set(fingerprint, keep);
    else offlineBoxes.delete(fingerprint);
  }

  const logCutoff = now - EXPIRY_LOG_RETENTION_MS;
  const prunedLog = expiryLog.filter((entry) => {
    const at = Date.parse(entry.expiredAt || '');
    return !Number.isFinite(at) || at >= logCutoff;
  });
  if (prunedLog.length !== expiryLog.length) {
    expiryLog = prunedLog;
    saveExpiryLog();
  } else if (changed) {
    saveExpiryLog();
  }

  /* Only what the sweep actually changed gets written - it usually touches a
     handful of mailboxes, and writing all of them would put the cost this
     change removed straight back. */
  touched.forEach((fingerprint) => saveOfflineBox(fingerprint));
  sweepRetention.changed = changed;
  return [...touched];
}

/* ------------------------------------------------------------------
 * Durable writes
 *
 * Every store used to be written straight over itself with writeFileSync. A
 * crash, an OOM kill or a power cut anywhere inside that call leaves a
 * truncated file — and for offline-messages.json, which routinely reaches
 * tens of megabytes, that is every queued message for every user gone, with
 * the next boot finding a JSON parse error where the mailboxes used to be.
 *
 * Write to a sibling temp file, flush it to the platter, then rename. rename
 * within a directory is atomic on POSIX and on NTFS: a reader sees either the
 * whole old file or the whole new one, never a half-written one.
 *
 * Pretty-printing is also gone. Nothing reads these by eye, and `null, 2` on a
 * 59 MB store costs both the time to produce roughly twice the bytes and the
 * disk to hold them.
 * ------------------------------------------------------------------ */
function writeJsonAtomic(targetPath, value) {
  const directory = path.dirname(targetPath);
  fs.mkdirSync(directory, { recursive: true });
  const temp = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.tmp`);
  let handle = null;
  try {
    /* 0600, not the default 0644. What goes through here is the monitor's own
       password and the mailbox of queued envelopes; neither is something every
       account on the host, or every layer of a shared image, should be able to
       read. The mode is set on the temp file because rename() carries it. */
    handle = fs.openSync(temp, 'w', 0o600);
    fs.writeFileSync(handle, JSON.stringify(value));
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.renameSync(temp, targetPath);
  } catch (error) {
    if (handle !== null) { try { fs.closeSync(handle); } catch (_e) { /* noop */ } }
    try { fs.unlinkSync(temp); } catch (_e) { /* nothing to clean up */ }
    throw error;
  }
}

/* Write one mailbox. This is what nearly every call site actually wants: a
   message arrives for one person, or one person's queue is acknowledged. */
function saveOfflineBoxNow(fingerprint) {
  const clean = sanitizeFingerprint(fingerprint);
  if (!clean) return;
  try {
    fs.mkdirSync(OFFLINE_STORE_DIR, { recursive: true });
    const items = offlineBoxes.get(clean);
    if (items && items.length) {
      const started = Date.now();
      writeJsonAtomic(mailboxPath(clean), items);
      lastMailboxWriteMs = Date.now() - started;
    } else if (fs.existsSync(mailboxPath(clean))) {
      fs.unlinkSync(mailboxPath(clean));
    }
  } catch (error) {
    console.error(`Failed to save mailbox ${clean}:`, error);
  }
}

/* A mailbox is written whole, and it was written on every message that landed
   in it. A file arrives as one envelope per chunk, so chunk N rewrote the N-1
   already there: a 30 MB file cost about ten gigabytes of disk writes and took
   seventeen seconds to queue, and a 200 MB one was measured in hundreds of
   gigabytes. Nothing failed; it was simply slower the longer it ran.

   A trailing debounce collapses the burst into one write, and the wait grows
   with the box: a rewrite costs time in proportion to what is being written,
   so a fixed wait spends an ever larger share of the clock persisting. Waiting
   a multiple of however long the last write actually took holds that share
   roughly constant and needs no guess at the size. It is capped, because what
   a crash costs is the wait -- and the sweeps and the shutdown path both call
   saveOfflineBoxes(), which flushes everything pending along with the rest. */
const MAILBOX_SAVE_MIN_MS = 250;
const MAILBOX_SAVE_MAX_MS = 4000;
const MAILBOX_SAVE_FACTOR = 4;

let lastMailboxWriteMs = 0;
const pendingMailboxSaves = new Map();

function mailboxSaveDelay() {
  const proportional = lastMailboxWriteMs * MAILBOX_SAVE_FACTOR;
  return Math.min(MAILBOX_SAVE_MAX_MS, Math.max(MAILBOX_SAVE_MIN_MS, proportional));
}

function saveOfflineBox(fingerprint) {
  const clean = sanitizeFingerprint(fingerprint);
  if (!clean) return;
  if (pendingMailboxSaves.has(clean)) return;
  pendingMailboxSaves.set(clean, setTimeout(() => {
    pendingMailboxSaves.delete(clean);
    saveOfflineBoxNow(clean);
  }, mailboxSaveDelay()));
}

/* Writes anything still waiting on its debounce. Called before a full save and
   on the way out, so nothing is lost to a timer that never fired. */
function flushPendingMailboxSaves() {
  for (const [clean, timer] of pendingMailboxSaves) {
    clearTimeout(timer);
    saveOfflineBoxNow(clean);
  }
  pendingMailboxSaves.clear();
}

/* Every mailbox. Only the sweeps and shutdown need this, and they run on a
   timer or once, not per message. */
function saveOfflineBoxes() {
  /* Whatever is mid-debounce is about to be written anyway; clearing the
     timers here stops one firing after a shutdown has already saved. */
  for (const timer of pendingMailboxSaves.values()) clearTimeout(timer);
  pendingMailboxSaves.clear();
  try {
    fs.mkdirSync(OFFLINE_STORE_DIR, { recursive: true });
    const live = new Set();
    offlineBoxes.forEach((items, fingerprint) => {
      if (!items || !items.length) return;
      live.add(`${fingerprint}.json`);
      writeJsonAtomic(mailboxPath(fingerprint), items);
    });
    /* A mailbox that emptied has to lose its file, or it comes back on boot. */
    fs.readdirSync(OFFLINE_STORE_DIR).forEach((name) => {
      if (!name.endsWith('.json') || live.has(name)) return;
      try { fs.unlinkSync(path.join(OFFLINE_STORE_DIR, name)); } catch (_e) { /* already gone */ }
    });
  } catch (error) {
    console.error('Failed to save offline boxes:', error);
  }
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
    writeJsonAtomic(SELF_DESTRUCT_STORE_PATH, Object.fromEntries(selfDestructRecords));
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
    const upTtlDays = PUSH_TTL_CHOICES.includes(Number(value.ttlDays)) ? Number(value.ttlDays) : null;
    const upDeviceId = typeof value.deviceId === 'string' ? value.deviceId.slice(0, 128) : '';
    const upExpiresAt = typeof value.expiresAt === 'string' && !Number.isNaN(Date.parse(value.expiresAt))
      ? value.expiresAt
      : null;
    return {
      type: 'unifiedpush',
      endpoint,
      expirationTime: null,
      lang: normalizePushLang(value.lang),
      ...(upTtlDays ? { ttlDays: upTtlDays } : {}),
      ...(upExpiresAt ? { expiresAt: upExpiresAt } : {}),
      ...(upDeviceId ? { deviceId: upDeviceId } : {}),
      ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    };
  }

  const p256dh = String(value.keys?.p256dh || '').slice(0, 512);
  const auth = String(value.keys?.auth || '').slice(0, 512);
  if (!p256dh || !auth) return null;
  /* The expiry has to survive a reload. It did not: this function is what the
     loader maps every stored row through, and it used to drop ttlDays and
     expiresAt, so a restart turned every subscription into one that never
     expired and the sweep could never collect it. */
  const ttlDays = PUSH_TTL_CHOICES.includes(Number(value.ttlDays)) ? Number(value.ttlDays) : null;
  const deviceId = typeof value.deviceId === 'string' ? value.deviceId.slice(0, 128) : '';
  /* Which language this device reads. Two values, both harmless: it says
     nothing about who the person is that the relay does not already have. */
  const lang = normalizePushLang(value.lang);
  const expiresAt = typeof value.expiresAt === 'string' && !Number.isNaN(Date.parse(value.expiresAt))
    ? value.expiresAt
    : null;
  return {
    endpoint,
    expirationTime: value.expirationTime || null,
    keys: { p256dh, auth },
    lang,
    ...(ttlDays ? { ttlDays } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(deviceId ? { deviceId } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
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
    fs.mkdirSync(path.dirname(PUSH_STORE_PATH), { recursive: true });
    writeJsonAtomic(PUSH_STORE_PATH, Object.fromEntries(pushSubscriptions));
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
    writeJsonAtomic(POLICY_STORE_PATH, {
      suspendedUsers: Object.fromEntries(suspendedUsers),
      kickedUsers: Object.fromEntries(kickedUsers),
      allowedUsers: Object.fromEntries(allowedUsers),
      allowlistEnabled,
    });
  } catch (error) {
    console.error('Failed to save server policy store:', error);
  }
}

function identityKey(identity) {
  const fingerprint = sanitizeFingerprint(identity?.fingerprint);
  if (fingerprint) return fingerprint;
  const peerId = String(identity?.peerId || '').trim();
  if (peerId) return peerId;
  const ip = normalizeIpValue(identity?.ip || '');
  const username = String(identity?.username || '').trim().toLowerCase();
  if (ip && isPublicIp(ip) && username) return `ip:${ip}:${username}`;
  return '';
}

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

function upgradeRequestIdentity(request, url = null) {
  const parsed = url || new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  return {
    peerId: String(parsed.searchParams.get('id') || parsed.searchParams.get('peerId') || '').slice(0, 160),
    fingerprint: sanitizeFingerprint(parsed.searchParams.get('fingerprint') || request.headers['x-p00rija-fingerprint']),
    clientId: String(parsed.searchParams.get('clientId') || '').slice(0, 80),
    username: String(parsed.searchParams.get('username') || '').slice(0, 80),
    ip: requestIp(request),
  };
}

function rejectRestrictedUpgrade(socket, restriction) {
  try {
    const code = restriction?.type === 'suspended' ? 4403 : 4401;
    const body = JSON.stringify({
      ok: false,
      restricted: true,
      restrictionType: restriction?.type || 'restricted',
      code,
    });
    socket.write([
      'HTTP/1.1 403 Forbidden',
      'Connection: close',
      'Content-Type: application/json; charset=utf-8',
      `Content-Length: ${Buffer.byteLength(body)}`,
      '',
      body,
    ].join('\r\n'));
  } catch (_error) {
    // Best-effort upgrade rejection.
  } finally {
    socket.destroy();
  }
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

function hasUsableIdentity(identity = {}) {
  const snapshot = identitySnapshot(identity);
  if (snapshot.fingerprint || snapshot.peerId) return true;
  return Boolean(snapshot.username && snapshot.ip && isPublicIp(snapshot.ip));
}

function identityMatchesPolicy(identity, policy) {
  const current = identitySnapshot(identity);
  
  // 1. Strong matches (Fingerprint or PeerID)
  if (policy.fingerprint && current.fingerprint && policy.fingerprint === current.fingerprint) return true;
  if (policy.peerId && current.peerId && policy.peerId === current.peerId) return true;
  
  // 2. IP-based matching is allowed only for real public IP + explicit username.
  if (policy.ip && current.ip && policy.ip === current.ip && isPublicIp(policy.ip) && isPublicIp(current.ip)) {
    const pUser = String(policy.username || '').trim().toLowerCase();
    const cUser = String(current.username || '').trim().toLowerCase();
    if (pUser && cUser && pUser === cUser) return true;
  }
  
  return false;
}

function resolvePolicyKey(store, body = {}) {
  const directKey = String(body?.key || '').trim();
  if (directKey && store.has(directKey)) return directKey;
  const identity = {
    fingerprint: body?.fingerprint,
    peerId: body?.peerId,
    clientId: body?.clientId,
    username: body?.username,
    ip: body?.ip,
  };
  for (const [key, policy] of store.entries()) {
    if (identityMatchesPolicy(identity, policy)) return key;
  }
  return '';
}

function sanitizePolicyDurationMinutes(value, fallback) {
  const minutes = Number(value || fallback);
  if (!Number.isFinite(minutes)) return fallback;
  return Math.max(1, Math.min(60 * 24 * 30, Math.round(minutes)));
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
  let untilText = '';
  if (policy.expiresAt) {
    const d = new Date(policy.expiresAt);
    untilText = ' تا ' + d.toLocaleString('fa-IR') + ' (' + d.toLocaleString('en-US') + ')';
  }
  const suspendedText = `شما موقتاً تعلیق شده اید.${untilText}`;
  const kickedText = policy.permanent
    ? 'دسترسی شما در سیستم محدود شده است، لطفاً برای رفع محدودیت با ادمین سرور و یا پشتیبانی تماس بگیرید.'
    : `اتصال شما از سرور قطع شد و${untilText} امکان اتصال مجدد ندارید.`;
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
}

function disconnectRestrictedPeer(record, restriction) {
  sendPolicyNotice(record, restriction);
  setTimeout(() => {
    try {
      if (record.ws?.readyState === WebSocket.OPEN) {
        record.ws.close(
          restriction?.type === 'suspended' ? 4403 : 4401,
          restriction?.type || 'restricted'
        );
      }
    } catch (_error) {}
  }, 750);
  setTimeout(() => {
    try {
      if (record.ws && record.ws.readyState !== WebSocket.CLOSED) {
        record.ws.terminate();
      }
    } catch (_error) {}
    presence.delete(record.clientId);
    broadcastPeers();
  }, 1500);
}

async function sendPushNotification(toFingerprint, kind = 'chat') {
  const fingerprint = sanitizeFingerprint(toFingerprint);
  const key = pushIndexKey(fingerprint);
  const now = Date.now();
  /* An expired record is not delivered to and not kept: the moment the user's
     own window runs out, the row goes. */
  const stored = pushSubscriptions.get(key) || [];
  const subscriptions = stored.filter((item) => !item.expiresAt || Date.parse(item.expiresAt) > now);
  if (subscriptions.length !== stored.length) {
    if (subscriptions.length) pushSubscriptions.set(key, subscriptions);
    else pushSubscriptions.delete(key);
    savePushSubscriptions();
  }
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

  /* Three fixed lines, chosen by what happened — never by who or what was
     said. A call is worth telling apart from a message: one you might answer,
     the other you read later. */
  /* Voice and video are worth telling apart — one you might step outside to
     take. The mode travels with call signalling already; nothing about who or
     what was said is added here. */
  /* Built per row rather than once: each device says which language it reads
     when it subscribes, and one person's phone should not be handed another
     person's language because they share a fingerprint across devices. */
  const payloadFor = (subscription) => JSON.stringify({
    title: 'P00RIJA Cryptography',
    body: pushBodyFor(kind, subscription.lang),
    /* The service worker adds "N unread" when several arrive behind one row,
       and it has no way to read the app's language setting from where it runs.
       The row already records which language this device asked for, so the
       answer travels with the body it belongs to. */
    lang: normalizePushLang(subscription.lang),
    /* Calls and messages stack separately, so a missed call is not swallowed
       by the message it arrives beside. */
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
    pushSubscriptions.set(key, remaining);
  } else {
    pushSubscriptions.delete(key);
  }
  /* WRITE IT DOWN. Dropping a dead endpoint only from memory meant the next
     restart read it back off disk and the relay went on pushing to an
     endpoint the vendor had already told it was gone — forever, because the
     answer never changed and the lesson was never kept. Every other prune in
     this file persists; these two did not. */
  if (pruned || !remaining.length) savePushSubscriptions();
}

async function sendAdminPushNotification(toFingerprint, body, kind = 'admin-policy') {
  const fingerprint = sanitizeFingerprint(toFingerprint);
  const key = pushIndexKey(fingerprint);
  const now = Date.now();
  const stored = pushSubscriptions.get(key) || [];
  const subscriptions = stored.filter((item) => !item.expiresAt || Date.parse(item.expiresAt) > now);
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
        pruned = true;
      } else {
        console.error('Failed to send admin web push:', error?.statusCode || error?.message || error);
        remaining.push(subscription);
      }
    }
  }));

  if (remaining.length) {
    pushSubscriptions.set(key, remaining);
  } else {
    pushSubscriptions.delete(key);
  }
  /* See sendPushNotification: a prune that is not written down is undone by
     the next restart. */
  if (pruned || !remaining.length) savePushSubscriptions();
}

const presence = new Map();

/* Can a message reach this person's eyes right now? Not "is there a socket" —
   an iOS web app in the background holds its socket open and reads nothing. */
function isAppAwake(record) {
  if (!record || record.away) return false;
  return Date.now() - (record.lastActiveAt || 0) <= APP_AWAKE_TTL_MS;
}

function snapshotPeers() {
  const now = Date.now();
  return Array.from(presence.values())
    .filter((client) => client.peerId)
    .filter((client) => client.ws?.readyState === WebSocket.OPEN)
    .filter((client) => now - (client.lastSeenAt || 0) <= PRESENCE_TTL_MS)
    .filter((client) => !getRestrictionForIdentity(client))
    .map((client) => ({
      clientId: client.clientId,
      username: client.username || client.peerId || client.fingerprint || '',
      peerId: client.peerId,
      publicKeyData: client.publicKeyData || '',
      fingerprint: client.fingerprint || '',
      avatarData: client.avatarData || '',
      /* Whatever they wrote about what they are doing. Short, free text, and
         no more sensitive than the display name beside it — but it has to
         travel with the presence record or the other side never sees it. */
      mood: client.mood || '',
      prekeyId: client.prekeyId || '',
      prekeyPublic: client.prekeyPublic || '',
      prekeyExpiresAt: client.prekeyExpiresAt || '',
      /* Registered but frozen is not online. Saying otherwise tells the person
         writing that their message has been seen when it has not even been
         read off the wire. */
      status: isAppAwake(client) ? 'online' : 'away',
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

function openPresenceRecord(clientId = '') {
  const record = presence.get(String(clientId || ''));
  return record?.ws?.readyState === WebSocket.OPEN ? record : null;
}

function findOpenPresenceByFingerprint(fingerprint = '') {
  if (!fingerprint) return null;
  /* Only a socket that proved the identity behind the fingerprint may be
     routed to by it — otherwise mail lands on whoever claimed the name. A
     reconnect leaves two sockets holding the same fingerprint for a moment,
     so the most recently active one wins rather than the first found. */
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
   mailbox would be a burst of hundreds of megabytes into a socket that cannot
   refuse it; one at a time would cost a round trip per envelope. */
const MAIL_WINDOW = 50;

/* Sends whatever the window has room for, skipping what this connection has
   already been handed.

   It used to slice the first MAIL_WINDOW off the queue each time, which was
   wrong in both directions. The same envelopes went out again on every
   top-up, so a recipient collecting a file received most of it several times
   over. And the top-up only ran on an ACK that actually removed something --
   the app acknowledges each envelope as it handles it, duplicates included,
   and an ACK for an envelope already gone changed nothing, so it triggered
   nothing. Once the recipient had acknowledged everything it held, neither
   side had a reason to speak next. Delivery stopped dead around MAIL_WINDOW
   envelopes whatever the size of the mailbox, and only a reconnection moved
   it on. A conversation rarely has fifty waiting, so this only ever showed on
   files -- which advanced a few megabytes per reconnect and read as a slow
   network.

   Tracking what this connection has been sent fixes both. The set belongs to
   the connection, not to the mailbox, so a reconnection re-sends anything
   that was in flight when the socket went -- which is what makes an
   unacknowledged envelope safe to drop. */
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
  // Scoped to this peer: nobody else's mail is about to be handed over
  // here, and walking all of it blocked the relay for 171 ms per connect.
  sweepRetention(record.fingerprint);

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

function closeDuplicatePresenceRecords(record) {
  for (const [clientId, existing] of presence.entries()) {
    if (clientId === record.clientId) continue;
    const sameFingerprint = record.fingerprint && existing.fingerprint === record.fingerprint;
    const samePeerId = record.peerId && existing.peerId === record.peerId;
    if (!sameFingerprint && !samePeerId) continue;
    console.log(`[Presence] Replacing duplicate connection ${clientId} for ${record.username || record.peerId}`);
    presence.delete(clientId);
    try {
      existing.ws?.close(4000, 'duplicate-presence');
    } catch (_error) {
      try { existing.ws?.terminate(); } catch (_terminateError) {}
    }
  }
}

// Ensure data directory exists
try {
  fs.mkdirSync(path.dirname(PUSH_STORE_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(OFFLINE_STORE_PATH), { recursive: true });
} catch (_e) {}

/* Same ceiling as the relay frames: a hello carries an avatar but nothing
   near this size, and an unbounded frame is buffered before it is parsed. */
const wsServer = attachSocketKeepAlive(
  new WebSocketServer({ noServer: true, maxPayload: 12 * 1024 * 1024 }),
  'Presence',
);

wsServer.on('connection', (ws, req) => {
  const clientId = crypto.randomUUID();
  const ip = requestIp(req);
  const upgradeIdentity = upgradeRequestIdentity(req);

  console.log(`[Presence] New connection from ${ip}, clientId: ${clientId}`);

  const record = {
    clientId,
    ws,
    ip,
    username: upgradeIdentity.username || '',
    peerId: upgradeIdentity.peerId || '',
    publicKeyData: '',
    fingerprint: upgradeIdentity.fingerprint || '',
    /* Flipped only by a proven id-challenge answer (or the escape hatch). */
    identityVerified: false,
    avatarData: '',
    mood: '',
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
  safeSend(ws, { type: 'welcome', clientId });

  // Browsers answer ping frames from inside the network stack, even while the
  // page's JavaScript is frozen. Counting that as activity keeps a backgrounded
  // phone registered instead of dropping it and forcing a reconnect on return.
  ws.on('pong', () => { touchPresence(record); });

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
    /* A frame the page composed and sent: proof the JavaScript is running,
       which the pong above is not. */
    record.lastActiveAt = Date.now();
    if (message.type !== 'presence-state') record.away = false;

    if (message.type === 'hello') {
      record.username = String(message.username || '').slice(0, 80);
      record.peerId = String(message.peerId || '').slice(0, 160);
      record.publicKeyData = String(message.publicKeyData || '');
      record.fingerprint = sanitizeFingerprint(message.fingerprint);
      record.avatarData = String(message.avatarData || '').slice(0, 2000000);
      record.mood = String(message.mood || '').slice(0, 40);
      /* The prekey is a public value and the relay only forwards it. It is
         what lets somebody write to this device while it is offline without
         falling back to the never-changing identity key. */
      record.prekeyId = String(message.prekeyId || '').slice(0, 64);
      record.prekeyPublic = String(message.prekeyPublic || '').slice(0, 512);
      record.prekeyExpiresAt = String(message.prekeyExpiresAt || '').slice(0, 40);
      record.updatedAt = new Date().toISOString();
      if (!hasUsableIdentity(record)) {
        console.warn(`[Presence] Rejecting unidentified peer from ${record.ip}`);
        safeSend(ws, { type: 'error', reason: 'identity-required' });
        try { ws.close(4400, 'identity-required'); } catch (_error) {}
        presence.delete(clientId);
        broadcastPeers();
        return;
      }
      
      const restriction = getRestrictionForIdentity(record);
      if (restriction) {
        console.log(`[Presence] Restricted peer rejected after hello: ${record.username} (${restriction.type})`);
        disconnectRestrictedPeer(record, restriction);
        return;
      }

      closeDuplicatePresenceRecords(record);
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
          saveOfflineBox(record.fingerprint);
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
      const target = openPresenceRecord(message.toClientId) || findOpenPresenceByFingerprint(toFingerprint);
      
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
        /* Whatever the client asked for, an ephemeral signal is not stored and
           does not ring anyone. Old builds mark everything persist. */
        /* Judged by what the envelope carries, not by the word on the outside.
           Every sealed envelope arrives as 'offline-chat', so reading only the
           outer name let a delivery receipt or a typing flag be stored like a
           message and ring a phone like one. The client marks the inner name;
           this is the server half, so an out-of-date client cannot fill a
           mailbox with them either. */
        const innerType = String(message.payload?.inner || '');
        if (EPHEMERAL_PAYLOADS.has(payloadType) || EPHEMERAL_PAYLOADS.has(innerType)) {
          safeSend(ws, { type: 'error', reason: 'target-offline', toClientId: message.toClientId || '', tag });
          return;
        }
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
          /* The old cap was a flat 200 items per mailbox, which a single
             chunked file would blow through on its own — evicting other
             people's messages to make room for pieces of itself. Retention is
             now decided by class: text is kept, media ages out, and the quota
             is measured in bytes rather than in items. */
          offlineBoxes.set(toFingerprint, queued);
          /* The sweep can touch anybody's queue, so it says what it changed and
             those get written; this delivery only changed one mailbox. */
          saveOfflineBox(toFingerprint);
          /* The sweep writes whatever it changes, including this box if the
             quota just pushed something out of it. Scoped to the recipient:
             queueing for one person cannot push anything out of anyone else's
             mailbox, so weighing the whole server was pure cost. */
          sweepRetention(toFingerprint);
          /* The sweep may have emptied the box entirely, so the count reads
             what is left rather than assuming the queue survived it. */
          const remaining = offlineBoxes.get(toFingerprint);
          safeSend(ws, { type: 'queued', toFingerprint, count: remaining ? remaining.length : 0, tag });
          /* A real chat message travels as a sealed 'offline-chat' envelope, so
             the type the relay can see is the envelope's, not the message's —
             gating on the inner names meant no queued message ever rang a
             device. The envelope says whether it is worth waking someone for;
             everything else falls back to the list of plain types. */
          const wakes = payloadType === 'offline-chat'
            ? message.payload?.notify !== false
            : PUSHABLE_PAYLOADS.has(payloadType);
          if (wakes) {
            /* A sealed envelope hides what it is, so a group call to a sleeping
               phone used to ring as "chat update". The sender marks the outside
               of the envelope with the call verb and, for a group, the word
               "group" - never its name, the caller, or anything said. The rule
               itself lives in scripts/lib/push-wording.js so it can be read and
               tested without starting a server. */
            const kind = pushKindFor(payloadType, message.payload || {});
            sendPushNotification(toFingerprint, kind).catch((error) => console.error(error));
          }
          return;
        }
        console.warn(`[Relay] Target not found for ${payloadType} to ${message.toClientId || toFingerprint}`);
        safeSend(ws, { type: 'error', reason: 'target-offline', toClientId: message.toClientId || '', tag });
        return;
      }

      /* Store-and-forward is not only for offline targets. A "connected"
         client can be a locked app whose webview is suspended: the socket
         accepts the frame and nothing reads it, and a message forwarded only
         live into that socket was lost — no queue entry, no error, and a
         sender stuck watching an hourglass. Persistent envelopes are now
         queued for connected recipients too. The client de-duplicates by
         message id and acks the redelivered copy, so a healthy live path
         costs one extra frame per message and an unhealthy one costs nothing
         at all. */
      if (message.persist && toFingerprint) {
        const queuedLive = offlineBoxes.get(toFingerprint) || [];
        queuedLive.push({
          type: 'relay',
          relayId: crypto.randomUUID(),
          fromClientId: clientId,
          fromFingerprint: record.fingerprint,
          payload: message.payload || null,
          queuedAt: new Date().toISOString(),
        });
        offlineBoxes.set(toFingerprint, queuedLive);
        saveOfflineBox(toFingerprint);
        sweepRetention(toFingerprint);
        const remainingLive = offlineBoxes.get(toFingerprint);
        safeSend(ws, { type: 'queued', toFingerprint, count: remainingLive ? remainingLive.length : 0, tag });
      }

      /* The socket is registered, so this message takes the live path. That
         is not the same as the person seeing it: an iOS web app in the
         background keeps its socket and reads nothing off it, and until now
         that case got the live frame and no notification — the sender saw
         them as online and the phone stayed silent, which is the one
         combination that loses a message without anybody being told.
         A push is sent as well when the app is not awake. The live frame
         still goes out because it costs nothing and the client de-duplicates
         by message id, so if the app IS awake and the heartbeat merely
         lapsed, the worst case is one notification for a message already on
         screen — which the service worker suppresses anyway when a window is
         in front of the user. */
      if (!isAppAwake(target) && toFingerprint) {
        const wakes = payloadType === 'offline-chat'
          ? message.payload?.notify !== false
          : PUSHABLE_PAYLOADS.has(payloadType);
        if (wakes) {
          const kind = pushKindFor(payloadType, message.payload || {});
          sendPushNotification(toFingerprint, kind).catch((error) => console.error(error));
        }
      }
      safeSend(target.ws, {
        type: 'relay',
        fromClientId: clientId,
        fromFingerprint: record.fingerprint,
        payload: message.payload || null,
      });
      return;
    }

    /* Emergency wipe, asked for from the device that owns the mailbox.
       The socket is the proof: it is the same binding every other relay
       operation trusts, and the record it carries is the one being emptied.
       Everything keyed to this identity goes — queued envelopes, push
       subscriptions, self-destruct records — and the reply is sent before the
       socket is dropped so the client knows it happened. */
    /* A dissolved group. The relay never held the group itself - it forwards
       sealed envelopes and cannot read one - so what it can do is drop
       everything still queued that belongs to that conversation, from every
       mailbox, so nothing addressed to a group that no longer exists is left
       waiting for somebody to come back and collect it.
       The conversation id is the sender's own; it identifies a thread, not a
       person, and the relay already sees the addressing of every envelope. */
    if (message.type === 'purge-space') {
      const conversationId = String(message.conversationId || '').slice(0, 200);
      let removed = 0;
      if (conversationId) {
        const touched = [];
        for (const [box, queue] of offlineBoxes.entries()) {
          const kept = (queue || []).filter((item) => item?.payload?.spaceId !== conversationId
            && item?.payload?.space?.conversationId !== conversationId);
          if (kept.length !== queue.length) {
            removed += queue.length - kept.length;
            touched.push(box);
            if (kept.length) offlineBoxes.set(box, kept);
            else offlineBoxes.delete(box);
          }
        }
        /* A group's members, not everybody on the relay. */
        touched.forEach((box) => saveOfflineBox(box));
      }
      console.log(`[Purge] dissolved group: ${removed} queued envelope(s) dropped`);
      safeSend(ws, { type: 'purged', removed, scope: 'space' });
      return;
    }
    if (message.type === 'purge-me') {
      const target = record.fingerprint || '';
      let removed = 0;
      if (target) {
        removed += (offlineBoxes.get(target) || []).length;
        offlineBoxes.delete(target);
        saveOfflineBox(target);
        const pushKey = pushIndexKey(target);
        if (pushSubscriptions.has(pushKey)) {
          pushSubscriptions.delete(pushKey);
          savePushSubscriptions();
        }
        /* Self-destruct records are deliberately not linked to an identity —
           they carry a payload id and nothing else — so there is no "mine" to
           purge here. They expire on their own limits, which is the guarantee
           they were built to make. */
      }
      console.log(`[Purge] emergency wipe for ${target || 'unknown'}: ${removed} queued envelope(s) dropped`);
      safeSend(ws, { type: 'purged', removed });
      return;
    }
    if (message.type === 'ping') {
      safeSend(ws, { type: 'pong', timestamp: Date.now() });
      return;
    }
    /* The page says it is going away before the platform freezes it. iOS
       fires visibilitychange and pagehide while there is still a moment to
       send, so this arrives ahead of the heartbeat lapsing and the very next
       message is pushed rather than dropped into a socket nobody is reading.
       The heartbeat rule below still stands on its own for the case where the
       freeze wins the race. */
    if (message.type === 'presence-state') {
      record.away = message.state === 'away';
      broadcastPeers();
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Poorija chat signal server listening on http://${HOST}:${PORT}`);
  console.log(`Monitoring Dashboard available at http://${HOST}:${PORT}/Monitor_Server`);
});

presenceServer.listen(PRESENCE_PORT, HOST, () => {
  console.log(`Poorija chat presence socket listening on ws://${HOST}:${PRESENCE_PORT}/chat-signal`);
});

/* ------------------------------------------------------------------
 * Graceful shutdown
 *
 * Without this, a redeploy or a rolling restart kills the process mid-write:
 * the offline mailbox file is read, modified and rewritten in one go, so a
 * SIGTERM landing between the read and the write loses whatever was queued.
 * Peers also just lose their socket with no reason given and reconnect in a
 * thundering herd.
 *
 * The sequence matters. Stop reporting ready first, so a load balancer takes
 * this instance out of the pool while it can still serve what it already has.
 * Then tell the connected peers to reconnect — with a jittered delay, so five
 * thousand of them do not all come back in the same second. Only then close.
 * ------------------------------------------------------------------ */
const SHUTDOWN_GRACE_MS = Number(process.env.CHAT_SHUTDOWN_GRACE_MS || 8000);

function beginShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] ${signal} received — draining ${presence.size} peer(s).`);

  server.close();
  presenceServer.close();

  let told = 0;
  for (const record of presence.values()) {
    if (record.ws?.readyState !== WebSocket.OPEN) continue;
    try {
      record.ws.send(JSON.stringify({
        type: 'server-draining',
        instance: INSTANCE_ID,
        /* The client is asked to come back after its own random delay rather
           than immediately: a synchronised reconnect from every peer at once
           is a self-inflicted denial of service on the instance that replaces
           this one. */
        reconnectAfterMs: 500 + Math.floor(Math.random() * 4000),
      }));
      told += 1;
    } catch (_error) { /* the socket is going away anyway */ }
  }
  console.log(`[Shutdown] told ${told} peer(s) to reconnect.`);

  /* Flush anything still owed to disk before the process goes. */
  try {
    if (typeof saveOfflineBoxes === 'function') saveOfflineBoxes();
  } catch (error) {
    console.error('[Shutdown] could not flush the offline store:', error.message);
  }

  const closeAll = setTimeout(() => {
    for (const record of presence.values()) {
      try { record.ws?.close(1001, 'server-restarting'); } catch (_error) { /* noop */ }
    }
    console.log('[Shutdown] done.');
    process.exit(0);
  }, SHUTDOWN_GRACE_MS);
  /* Deliberately NOT unref'd. Unreffing it means the process is free to exit
     the moment nothing else holds the loop open — which is exactly the abrupt
     death this whole function exists to avoid. */
  void closeAll;
}

process.on('SIGTERM', () => beginShutdown('SIGTERM'));
process.on('SIGINT', () => beginShutdown('SIGINT'));

/* A crash that takes the mailboxes with it is worse than a crash. */
process.on('uncaughtException', (error) => {
  console.error('[Fatal] uncaught exception:', error);
  try {
    if (typeof saveOfflineBoxes === 'function') saveOfflineBoxes();
  } catch (_error) { /* nothing more to try */ }
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] unhandled rejection:', reason);
});
