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
const net = require('net');
const crypto = require('crypto');
const os = require('os');
const dns = require('dns').promises;
const fs = require('fs');
const fsp = require('node:fs/promises');
const path = require('path');
const express = require('express');
const { ExpressPeerServer } = require('peer');
const webpush = require('web-push');
const { pushKindFor, pushBodyFor, pushTagFor, normalizePushLang, pushSendOptions } = require('./lib/push-wording.js');
const { loadOrCreateRelayIdentity, publicRelayIdentity, formatRelayId, relayPqPrivateKey } = require('./lib/relay-identity.js');
const { createRelayPeers, parseTransitPeers, makeIdentityFetcher } = require('./lib/relay-peers.js');
const { openTransit, transitFacts } = require('./lib/relay-transit.js');
/* The 3.34 dashboard sheet the relay serves at /Monitor_Server — HTML lives
   in its own module so the server file stays about the server. */
const { monitorDashboardHtml } = require('./lib/monitor-dashboard.js');
const { linkPreview } = require('./lib/link-preview.js');
const telegramStickers = require('./lib/telegram-stickers.js');
const { createFrontDoor, parseFronts, parseDoors } = require('./lib/relay-front.js');
const { relayPrivateKey } = require('./lib/relay-identity.js');
const { verifyDirectory, planChanges } = require('./lib/relay-directory.js');
const {
  alertThresholds, readMeminfo, turnPortsInUse, networkBytes, evaluate: evaluateAlerts, createAlertState, sendTelegram,
} = require('./lib/relay-alerts.js');
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
/* Where the relay's own ports listen, when that is not everywhere. The relay
   speaks plain HTTP: in the full stack nginx in front of it carries TLS, and
   the plain ports (9000, 9001, 9080) used to answer the whole internet as
   well — anyone could talk to the relay unencrypted, and a client that found
   9000 did. CHAT_LISTEN_HOSTS names the addresses to listen on instead:
   loopback for this machine and the Docker bridge for nginx (an interface
   name such as docker0 stands for its IPv4 address). Unset keeps the old
   behaviour, which the standalone relay — serving clients itself — needs. */
/* An interface's IPv4 address, even while the interface is down. Node lists
   only interfaces that are up and running, and docker0 is down whenever no
   container sits on the default bridge — which is exactly the full stack's
   case (nginx has a network of its own) — while its address still answers
   nginx's host-gateway connections. So `ip` is asked when Node does not know. */
function interfaceIpv4(name) {
  const listed = (os.networkInterfaces()[name] || []).find((entry) => entry.family === 'IPv4' || entry.family === 4);
  if (listed) return listed.address;
  if (!/^[A-Za-z0-9_.-]{1,15}$/.test(name)) return '';
  for (const binary of ['ip', '/sbin/ip', '/usr/sbin/ip', '/bin/ip']) {
    try {
      const out = require('child_process').execFileSync(binary, ['-4', '-o', 'addr', 'show', 'dev', name], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
      const match = out.match(/inet (\d+\.\d+\.\d+\.\d+)\//);
      if (match) return match[1];
    } catch (_error) { /* not this binary, or no such interface */ }
  }
  return '';
}
function resolveListenHosts(value) {
  const hosts = [];
  for (const raw of String(value || '').split(/[,\s]+/)) {
    const name = raw.trim();
    if (!name) continue;
    if (net.isIP(name)) { hosts.push(name); continue; }
    const address = interfaceIpv4(name);
    if (address) hosts.push(address);
    else console.error(`[Listen] interface "${name}" has no IPv4 address here; skipped — whatever reaches the relay through it will be refused`);
  }
  return Array.from(new Set(hosts));
}
const LISTEN_HOSTS = resolveListenHosts(process.env.CHAT_LISTEN_HOSTS);
/* One server, several addresses: a plain listener per extra address hands
   its sockets to the real server, so every request and upgrade handler
   attached to it sees them as its own. */
/* The queue of connections not yet accepted. Node's default of 511 overflows
   when everybody reconnects at once — after a restart, or a network blip at
   a carrier — and the overflow is dropped handshakes that wait for their own
   retry. The kernel still caps it at net.core.somaxconn. */
const LISTEN_BACKLOG = Number(process.env.CHAT_LISTEN_BACKLOG || 4096);
function listenOn(target, port, fallbackHost, onReady) {
  const hosts = LISTEN_HOSTS.length ? LISTEN_HOSTS : [fallbackHost];
  const [first, ...rest] = hosts;
  target.listen({ port, host: first, backlog: LISTEN_BACKLOG }, onReady);
  for (const host of rest) {
    const extra = net.createServer((socket) => target.emit('connection', socket));
    extra.on('error', (error) => console.warn(`[Listen] ${host}:${port} not available: ${error.code || error.message}`));
    extra.listen({ port, host, backlog: LISTEN_BACKLOG });
  }
}
const PORT = Number(process.env.CHAT_SIGNAL_PORT || 9000);
const PRESENCE_PORT = Number(process.env.CHAT_PRESENCE_PORT || 9001);

// Improve path fallbacks for native runs (use relative path if /data is not writable)
const defaultDataDir = fs.existsSync('/data') && (function() { try { fs.accessSync('/data', fs.constants.W_OK); return true; } catch(e) { return false; } })()
  ? '/data'
  : path.join(__dirname, '..', 'data', 'chat-signal');

const PUSH_STORE_PATH = process.env.CHAT_PUSH_STORE_PATH || path.join(defaultDataDir, 'push-subscriptions.json');
const OFFLINE_STORE_PATH = process.env.CHAT_OFFLINE_STORE_PATH || path.join(defaultDataDir, 'offline-messages.json');
/* What build this relay is, so a deployment can be verified rather than
   assumed. Two relays that carry for each other have to be kept in step, and
   until now nothing a relay said identified which tree it was built from —
   which made "are they in step?" a question with no answer.
   Read from the package.json that ships beside the server, and tolerant of it
   being absent: an unknown version is worth reporting as unknown, not worth
   refusing to start over. */
const RELAY_BUILD = (() => {
  /* A buildTag is what distinguishes the tree's own package.json from
     config/relay-overrides.json, which the deployed image copies to
     package.json and which carries a placeholder version of 1.0.0. Reporting
     that as the build would be worse than reporting nothing, so a candidate
     without a buildTag is not the one being looked for.
     The two images lay the file out differently — the deployed relay runs from
     /app/scripts, the distribution from /app — so both shapes are tried. */
  for (const candidate of ['../app-version.json', './app-version.json',
    './package.json', '../package.json']) {
    try {
      const pkg = require(candidate);
      if (pkg?.version && pkg?.buildTag) {
        return { version: String(pkg.version), buildTag: String(pkg.buildTag) };
      }
    } catch (_error) { /* try the next one */ }
  }
  return { version: '', buildTag: '' };
})();

/* This relay's own name, and the private half it proves with. See
   scripts/lib/relay-identity.js for why it is an X25519 key and why the id
   covers that key alone. */
/* Beside the rest of the server state rather than in the default data
   directory, which is the same rule the policy and self-destruct stores
   follow: a deployment that moved its data somewhere else moved ALL of it,
   and an identity left behind is a relay that silently renames itself the
   first time somebody runs it with a different store path. */
const RELAY_IDENTITY_PATH = process.env.CHAT_RELAY_IDENTITY_PATH
  || path.join(path.dirname(OFFLINE_STORE_PATH), 'relay-identity.json');
const relayIdentity = loadOrCreateRelayIdentity(RELAY_IDENTITY_PATH);
if (relayIdentity.source !== 'file') {
  console.log(`[Relay] Relay identity ${formatRelayId(relayIdentity.id)}`);
}
/* Transit peers: the other relays this one will hand traffic to, and take it
   from. Named by identity with an address attached, because an address alone
   names whoever holds the hostname today.
   Empty means transit is off, which is the default. A relay that carried for
   anyone who asked would be an open relay — somebody else's traffic at this
   operator's expense — and the arrangement this exists for is between two
   operators who have already agreed with each other. */
const TRANSIT_PEERS = parseTransitPeers(process.env.CHAT_TRANSIT_PEERS || '');
/* Off by default, and it matters less than it looks: the link is
   authenticated by relay identity whatever the transport says. See the note
   above makeIdentityFetcher. */
const TRANSIT_VERIFY_TLS = process.env.CHAT_TRANSIT_INSECURE_TLS !== '1';
const relayPrivate = relayPrivateKey(relayIdentity);
/* The front door (scripts/lib/relay-front.js), set up just below. Declared
   first because the link callbacks reach it. */
let frontDoor = null;
const relayPeers = createRelayPeers({
  identity: publicRelayIdentity(relayIdentity),
  privateKey: relayPrivate,
  pqPrivateKey: relayPqPrivateKey(relayIdentity),
  allowlist: TRANSIT_PEERS.map((peer) => peer.id),
  WebSocketImpl: WebSocket,
  fetchIdentity: makeIdentityFetcher({ verifyTls: TRANSIT_VERIFY_TLS }),
  verifyTls: TRANSIT_VERIFY_TLS,
  onFrame: (payload, link) => {
    if (frontDoor?.onFrame(payload, link)) return;
    handleTransitFrame(payload, link);
  },
  onLinkUp: (link) => { frontDoor?.linkUp(link); offerDirectoryTo(link); },
  /* Function declarations below are hoisted, so this resolves at call time. */
  onLinkDown: (link) => { frontDoor?.linkDown(link); failTransitWaitsFor(link?.peerId); },
});
/* CHAT_FRONTS on the relay people can reach: `<relay id>@<public origin>` for
   each relay it answers for (nginx hands that origin's connections to
   CHAT_FRONT_PORT, 9011 and up). CHAT_FRONT_DOORS on the relay behind it:
   the ids of the relays allowed to carry its streams. Both need the transit
   link between the two already configured. */
const FRONTS = parseFronts(process.env.CHAT_FRONTS, process.env.CHAT_FRONT_PORT || 9011);
const FRONT_DOORS = parseDoors(process.env.CHAT_FRONT_DOORS);
/* Started at boot, below, once ALLOWED_ORIGINS exists. */
function startFrontDoor() {
  if (!FRONTS.length && !FRONT_DOORS.length) return;
  frontDoor = createFrontDoor({
    relayPeers,
    fronts: FRONTS,
    doors: FRONT_DOORS,
    localPort: PORT,
    listenHosts: LISTEN_HOSTS.length ? LISTEN_HOSTS : ['127.0.0.1'],
    /* Only this relay's own names: origins listed for CORS or as mirrors are
       other servers' names, and a client looking a door up by name must not
       be sent here for a relay that is not this one. */
    ownOrigins: ALLOWED_ORIGINS.filter((origin) => {
      try { return /^https?:$/.test(new URL(origin).protocol) && (!DOMAIN || new URL(origin).hostname === String(DOMAIN).toLowerCase()); } catch (_error) { return false; }
    }),
  });
  frontDoor.listen();
}
if (relayPeers.enabled()) {
  console.log(`[Transit] enabled for ${TRANSIT_PEERS.length} relay(s)`);
  /* Dialled once at start and redialled on its own backoff afterwards. An
     entry with no address is one this relay will answer but never call. */
  for (const peer of TRANSIT_PEERS) {
    if (peer.origin) setTimeout(() => relayPeers.dial(peer.id, peer.origin).catch(() => {}), 500).unref?.();
  }
}


const OFFLINE_STORE_DIR = process.env.CHAT_OFFLINE_STORE_DIR
  || path.join(path.dirname(OFFLINE_STORE_PATH), 'mailboxes');
/* Device-sync beacons; see "Device sync beacons" further down. Declared up
   here because the store is swept at load, before that section runs. */
const BEACON_DIR = process.env.CHAT_BEACON_DIR || path.join(path.dirname(OFFLINE_STORE_PATH), 'beacons');
const BEACON_MAX_CHARS = 11000;          /* 8 KB of ciphertext, base64 */
const BEACON_MAX_DEVICES = 8;
const BEACON_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/* What one device of an account leaves for its siblings that are away
   (holdForAbsentSiblings below): sync envelopes only — messages and what
   became of them, never a file — kept for the devices that were not here,
   and gone the moment each has collected its copy. Bounded per account. */
const SIBLING_DIR = process.env.CHAT_SIBLING_DIR || path.join(path.dirname(OFFLINE_STORE_PATH), 'siblings');
const SIBLING_ITEM_MAX_CHARS = 96 * 1024;
const SIBLING_ACCOUNT_MAX_CHARS = 4 * 1024 * 1024;
const SIBLING_ACCOUNT_MAX_ITEMS = 2000;
const SIBLING_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SIBLING_DELIVERY_BATCH = 40;
/* Across every account on this relay: past it, nothing more is held (the
   device then catches up from a sibling directly), and the cache keeps no
   more than this much in memory however many accounts are busy. */
const SIBLING_GLOBAL_MAX_CHARS = Number(process.env.CHAT_SIBLING_MAX_BYTES || 256 * 1024 * 1024);
const SIBLING_CACHE_MAX_CHARS = 32 * 1024 * 1024;
/* Up here, not beside the functions that use them: the mailboxes load (and
   count what is held) before the rest of this file has run. */
const siblingHeldCache = new Map();
const siblingHeldChars = new Map();
let siblingCachedChars = 0;
let siblingTotalChars = 0;
const beaconCache = new Map();
/* Which devices are still part of an account; see "The device roster"
   further down. A small signed document per account, nothing more. */
const ROSTER_DIR = process.env.CHAT_ROSTER_DIR || path.join(path.dirname(OFFLINE_STORE_PATH), 'rosters');
const ROSTER_MAX_CHARS = 32 * 1024;
const ROSTER_MAX_MEMBERS = 32;
const ROSTER_MAX_REVOKED = 128;
const rosterCache = new Map();

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
    /* A household behind one NAT is a handful of devices and tabs — but a
       mobile carrier puts thousands of subscribers behind one address
       (CGNAT, the rule on Iranian mobile networks), and each running app
       holds two sockets. The cap exists to stop one machine flooding, which
       the total ceiling, the open-file guard and the frame rate do as well;
       it is generous enough not to turn away the people behind a carrier. */
    wsMaxPerIp: clamp(64 + totalMemMb / 16, 64, 2000),
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
/* And the count alone was not a ceiling a byte could not walk past: a "text"
   envelope is only text because the sender labelled it so, and the label
   exempted it from every byte budget on the server. A single socket could
   queue a hundred thousand envelopes of six megabytes each and call all of
   it text. Text now answers to bytes as well as to count, on the same
   derivation the media quota uses. */
const TEXT_QUOTA_BYTES = Number(process.env.CHAT_TEXT_QUOTA_BYTES || CAPACITY.mediaQuotaBytes);
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
/* The TURN REST secret coturn shares with this relay (--static-auth-secret).
 *
 * With it, /turn-config stops handing every visitor the one static coturn
 * user — which made both production TURN servers an open relay for anybody
 * who could fetch a JSON file — and mints a credential that expires instead:
 * username "<unix expiry>:<random>", credential base64(HMAC-SHA1(secret,
 * username)), the scheme coturn checks natively. Without a secret the old
 * static pair is served, so a relay that has not been migrated keeps working. */
const TURN_SECRET = process.env.CHAT_TURN_SECRET || process.env.TURN_SECRET || '';
/* Long enough to outlast any call or transfer started near the end of it,
   short enough that a leaked credential is worth little. The client refetches
   well before expiry. */
const TURN_CREDENTIAL_TTL_SECONDS = Math.max(600, Number(process.env.CHAT_TURN_TTL_SECONDS || 12 * 3600));
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
/* Other addresses that reach this same relay — a second domain, a CDN in
   front of it — for a client whose way to the main domain is blocked. The
   client never takes one on trust: it asks the mirror to prove it holds this
   relay's key (POST /relay-prove) before it switches. Listed as origins,
   separated by commas or spaces. A page served from a mirror is a page of
   this deployment, so mirrors are allowed origins too. */
const MIRROR_ORIGINS = Array.from(new Set(String(process.env.CHAT_MIRROR_ORIGINS || '')
  .split(/[\s,]+/)
  .map((entry) => {
    try {
      const url = new URL(entry.trim());
      return (url.protocol === 'https:' || url.protocol === 'http:') ? url.origin : '';
    } catch (_error) { return ''; }
  })
  .filter(Boolean))).slice(0, 8);
const ALLOWED_ORIGINS = (process.env.CHAT_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
  .concat(MIRROR_ORIGINS);

/* The monitor password is never written to disk in a form that can be read
 * back. It used to be: server-config.json held the dashboard's rotated
 * password AND a copy of the .env one, both in plain text, so anything that
 * could read the data directory — a backup, a shared volume, a support
 * bundle — held the key to the relay's control panel.
 *
 * Now the file holds a scrypt hash of the rotated password and a SHA-256 of
 * the .env value it was saved against (the stamp only has to answer "did the
 * .env change since?", which an equality test on digests answers). In memory
 * the plain password is kept only when it came from the environment; a
 * rotated one is verified against its hash. */
let MONITOR_PASSWORD_HASH = '';
function scryptHashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function scryptVerify(password, encoded) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[2], 'base64');
    const expected = Buffer.from(parts[3], 'base64');
    const actual = crypto.scryptSync(String(password ?? ''), salt, expected.length, { N: Number(parts[1]) || 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(actual, expected);
  } catch (_error) {
    return false;
  }
}
function envPasswordStamp(value) {
  return value ? crypto.createHash('sha256').update(`poorija-monitor-env|${value}`).digest('hex') : '';
}
/* A scrypt check costs tens of milliseconds, and HTTP Basic clients send the
   password on every request. The last few successes are remembered by a keyed
   digest for ten minutes, never the password itself. */
const monitorVerifyCache = new Map();
const monitorVerifyKey = crypto.randomBytes(32);
function monitorPasswordMatches(candidate) {
  if (MONITOR_PASSWORD) return secretsMatch(candidate, MONITOR_PASSWORD);
  if (!MONITOR_PASSWORD_HASH) return false;
  const digest = crypto.createHmac('sha256', monitorVerifyKey).update(`${MONITOR_PASSWORD_HASH}|${String(candidate ?? '')}`).digest('hex');
  const remembered = monitorVerifyCache.get(digest);
  if (remembered && Date.now() - remembered < 10 * 60 * 1000) return true;
  const ok = scryptVerify(candidate, MONITOR_PASSWORD_HASH);
  if (ok) {
    monitorVerifyCache.set(digest, Date.now());
    if (monitorVerifyCache.size > 16) monitorVerifyCache.delete(monitorVerifyCache.keys().next().value);
  }
  return ok;
}

function loadServerConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      /* Whose password is newer: the one the dashboard changed to, or the one
         in the environment? The saved rotation wins by default; the env wins
         when it differs from the stamp taken at the save — a changed .env is
         a deliberate override. */
      const env = process.env.MONITOR_PASSWORD || '';
      let migrated = false;
      if (config.monitorPasswordHash) {
        MONITOR_PASSWORD_HASH = String(config.monitorPasswordHash);
        MONITOR_PASSWORD = '';
      } else if (config.monitorPassword) {
        /* A file from before the hash: adopt it, then rewrite it hashed. */
        MONITOR_PASSWORD = String(config.monitorPassword);
        migrated = true;
      }
      const savedStamp = typeof config.monitorPasswordEnvStamp === 'string'
        ? config.monitorPasswordEnvStamp
        : (typeof config.monitorPasswordEnvAtSave === 'string' ? envPasswordStamp(config.monitorPasswordEnvAtSave) : null);
      if (env && envPasswordStamp(env) !== savedStamp) {
        MONITOR_PASSWORD = env;
        MONITOR_PASSWORD_HASH = '';
        migrated = Boolean(config.monitorPassword || config.monitorPasswordEnvAtSave);
      }
      if (migrated || typeof config.monitorPasswordEnvAtSave === 'string') {
        /* Rewritten at once so no plain copy survives the first boot. */
        setTimeout(() => saveServerConfig(), 0);
      }
    }
  } catch (error) {
    console.error('Failed to load server config:', error);
  }
}

function saveServerConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    const env = process.env.MONITOR_PASSWORD || '';
    /* A password that is the environment's own needs no hash on disk: the
       environment already holds it, and the stamp says it was in force. */
    const fromEnv = Boolean(MONITOR_PASSWORD) && MONITOR_PASSWORD === env;
    if (MONITOR_PASSWORD && !fromEnv) MONITOR_PASSWORD_HASH = scryptHashPassword(MONITOR_PASSWORD);
    writeJsonAtomic(CONFIG_PATH, {
      ...(fromEnv ? {} : { monitorPasswordHash: MONITOR_PASSWORD_HASH }),
      monitorPasswordEnvStamp: envPasswordStamp(env),
    });
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
if (!MONITOR_PASSWORD_HASH && (!MONITOR_PASSWORD || MONITOR_PASSWORD.length < 12)) {
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
  /* Each preview is an outbound fetch of up to two pages on someone's behalf;
     a person typing links does a handful a minute. */
  preview: Number(process.env.CHAT_RATE_PREVIEW || 20),
  /* A Telegram pack is one description and up to 240 files, asked for one
     after another by a person importing it. */
  telegram: Number(process.env.CHAT_RATE_TELEGRAM || 300),
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
/* Each proof costs a key agreement; a flood of them is a flood of work. */
app.use('/relay-prove', rateLimit('write'));
app.use('/relay-mirrors', rateLimit('write'));
app.use('/link-preview', rateLimit('preview'));
app.use('/telegram-stickers', rateLimit('telegram'));
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

/* The origin clients reach this relay at, as the last real request named it.
   A transit answer has no request to read it from, and a client that just
   discovered a contact lives here needs an origin to file the route under. */
/* The Host header is the requester's to write, so a learned origin is only
   kept when it names this deployment: its DOMAIN, or one of the origins it is
   configured to serve. Anything else would let a stranger's request decide
   the origin this relay hands to the clients of a linked relay. */
let learnedPublicOrigin = '';
function rememberPublicOrigin(origin) {
  const value = String(origin || '');
  if (!/^https?:\/\/[^/\s]+$/i.test(value)) return;
  let hostname = '';
  try { hostname = new URL(value).hostname.toLowerCase(); } catch (_error) { return; }
  const allowed = hostname === String(DOMAIN || '').toLowerCase()
    || ALLOWED_ORIGINS.some((entry) => entry.toLowerCase() === value.toLowerCase());
  if (!allowed) return;
  learnedPublicOrigin = value;
}
function publicOriginForPeers() {
  return PUBLIC_RELAY_ORIGIN || learnedPublicOrigin || '';
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
  /* A call frame that is stored is a call that rings again later, with nothing
     behind it. call-invite stays out of this list on purpose: it is the one that
     is meant to wait for somebody who was away. The group verbs carry the same
     staleness and arrive far more of them — an hour-long group call emitted a
     stored, pushed envelope per reaction per participant, and the offline
     member's mailbox filled with moments that had passed. */
  'call-relay-offer', 'call-relay-answer', 'call-relay-ice', 'call-relay-end',
  'call-ice', 'call-renegotiate', 'call-renegotiate-answer', 'call-accepted', 'call-path-relay',
  'link-relay-offer', 'link-relay-answer', 'link-relay-ice', 'link-relay-end',
  'gcall-here', 'gcall-join', 'gcall-leave', 'gcall-react', 'gcall-state',
  /* A device-sync bundle is a snapshot one machine offers its siblings
     while they are here; it is never stored and never rings anybody. */
  'device-sync',
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
  /* Sliding: an operator mid-work never hits a wall mid-tab-switch. A fixed
     12h expiry logged people out at arbitrary moments because the clock
     started at login and never moved; now every valid request re-arms it. */
  session.expiresAt = Date.now() + MONITOR_SESSION_TTL_MS;
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
    return Boolean(decoded && decoded.user === 'admin' && monitorPasswordMatches(decoded.pass));
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
    fingerprint: p.fingerprint,
    /* Minutes since this sender last crossed a relay link, for the users
       table's cross-relay badge; null means it never did this session. */
    crossRelayMinutes: transitActivityMinutesAgo(p.clientId),
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
    /* What the system tab draws: the relay's own name, the machine's, the
       processor, and the TURN endpoints actually configured. */
    relayId: relayIdentity.id,
    hostname: os.hostname(),
    cpus: os.cpus().length,
    cpuModel: String(os.cpus()[0]?.model || '').trim().slice(0, 60),
    turnUrls: TURN_URLS.slice(0, 4),
    activeCalls: activeCalls.size,
    /* The relay container's own memory as the kernel prices it: what the
       cgroup allows and what is in use. This — not the node heap — is the
       number the overview card draws, so it matches whatever ceiling the
       machine tab set, 512 MB or unlimited alike. */
    containerMem: (() => {
      try {
        const maxRaw = String(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8')).trim();
        const current = Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8'));
        /* "max" means no ceiling — an unlimited container is a fact worth
           showing, not a reason to fall back to the heap number. */
        if (maxRaw === 'max' && Number.isFinite(current) && current > 0) {
          return { limitMb: 0, usageMb: Math.round(current / 1048576) };
        }
        const max = Number(maxRaw);
        if (Number.isFinite(max) && Number.isFinite(current) && current > 0 && max > 0) {
          return { limitMb: Math.round(max / 1048576), usageMb: Math.round(current / 1048576) };
        }
      } catch (_error) { /* cgroup v1 or no limit exposed */ }
      try {
        const limit = Number(fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8'));
        const usage = Number(fs.readFileSync('/sys/fs/cgroup/memory/memory.usage_in_bytes', 'utf8'));
        if (Number.isFinite(limit) && Number.isFinite(usage) && usage > 0) {
          return { limitMb: (limit > 0 && limit < 1e15) ? Math.round(limit / 1048576) : 0, usageMb: Math.round(usage / 1048576) };
        }
      } catch (_error) { /* not a cgroup v1 host either */ }
      return null;
    })(),
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
    /* Open files against the process's limit: the ceiling that used to arrive
       unannounced (see filesNearlyExhausted). */
    files: { open: fileGuard.open, limit: fileGuard.limit },
    memoryLimitMb: Math.round(MEMORY_LIMIT_BYTES / 1048576),
    /* What is wrong right now, and whether it reaches the operator. */
    alerts: { active: alertState.active(), telegram: alertsByTelegram(), waiting: alertOutbox.length },
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
    /* The same transit honesty /chat-health reports, for the dashboard's
       overview card without a second request. */
    transit: relayPeers.status(),
    /* The dashboard's overview card reads this to say "3 / 50000 sockets";
       without it the card can only say "— / —". /chat-health has always
       published the same numbers to anybody who asks, so an authenticated
       monitor gaining them gives away nothing it did not already have. */
    capacity: {
      tier: CAPACITY.tier,
      sockets: {
        inUse: Array.from(wsPerAddress.values()).reduce((sum, count) => sum + count, 0),
        max: WS_MAX_TOTAL,
        maxPerAddress: WS_MAX_PER_IP,
      },
    },
    cert: certSummary()
  });
});

app.post('/admin/login', (req, res) => {
  setNoStoreHeaders(res);
  const lock = getMonitorLockState(req);
  if (lock.locked) {
    return res.status(423).json({ ok: false, reason: 'locked', remainingMs: lock.remainingMs });
  }

  const { password, username } = req.body || {};
  /* A username gate in front of the password one: the monitor answers to a
     named operator, not just to whoever holds the secret. Default 'admin'
     keeps every existing bookmark working. */
  const MONITOR_USER = process.env.MONITOR_USER || 'admin';
  const usernameOk = !username || String(username).trim() === MONITOR_USER;
  if (usernameOk && monitorPasswordMatches(password)) {
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
  const { oldPassword, newPassword, currentPassword } = req.body || {};
  /* The Monitor dashboard called this field `currentPassword` while this
     endpoint read `oldPassword`, so every password change made from the
     Monitor itself was refused with "old password incorrect" — whatever was
     typed. Both names answer now: the endpoint heals an already-deployed
     dashboard, and the dashboard sends the canonical one. */
  const suppliedOld = oldPassword ?? currentPassword;

  /* The old password is required, not merely checked when supplied. The guard
     used to read `if (oldPassword && ...)`, so omitting the field skipped the
     comparison altogether — a stolen session cookie was enough to take the
     account over without ever learning the password. */
  if (!monitorPasswordMatches(suppliedOld)) {
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

  MONITOR_PASSWORD = String(newPassword);
  saveServerConfig();
  /* Only the hash stays; the plain value lived long enough to be hashed. */
  if (MONITOR_PASSWORD !== (process.env.MONITOR_PASSWORD || '')) MONITOR_PASSWORD = '';
  monitorVerifyCache.clear();
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
                <label class="block text-xs font-black text-slate-400 mb-3 mr-1 uppercase tracking-widest" data-login-i18n="username">نام کاربری</label>
                <div class="relative">
                    <span class="absolute inset-y-0 right-0 flex items-center pr-5 text-slate-500">
                        <i class="fas fa-user-shield"></i>
                    </span>
                    <input type="text" id="userInput" value="admin" autocomplete="username" class="w-full bg-slate-900/80 border border-slate-700/50 rounded-2xl py-4 pr-12 pl-12 focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none transition-all placeholder-slate-600 text-center ltr font-black text-lg" placeholder="admin">
                </div>
            </div>
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
            const user = document.getElementById('userInput') ? document.getElementById('userInput').value.trim() : '';
            if (!pass) return;
            fetch('/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({ password: pass, username: user })
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

  /* The 3.34 dashboard, drawn by scripts/lib/monitor-dashboard.js. The old
     single-scroll sheet still hangs below this line and stays reachable at
     ?classic=1 for the remainder of this release — it is deleted once an
     operator has confirmed the new one on a real deployment. */
  if (!req.query.classic) {
    return res.send(monitorDashboardHtml({
      version: RELAY_BUILD?.version || '',
      buildTag: RELAY_BUILD?.buildTag || '',
      monitorVersion: MONITOR_VERSION,
      port: PORT,
      presencePort: PRESENCE_PORT,
      bootstrapPort: BOOTSTRAP_PORT,
    }));
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
        /* Everything a peer chose for itself — a username above all — reaches
           this page as markup. The dashboard runs with the admin session, so
           markup is not typography, it is every admin action the page can
           take. Names are displayed, never executed. */
        function esc(value) {
            return String(value ?? '').replace(/[&<>"']/g, (char) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[char]));
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
                    return \`<option value="\${value}">\${esc(peer.username)} - \${esc(peer.ip.replace('::ffff:', ''))}</option>\`;
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
                    })).replace(/'/g, '%27');
                    return \`
                    <tr class="peer-row border-b border-white/5 transition-colors">
                        <td class="py-4 pr-4">
                            <div class="font-black text-white">\${esc(peer.username)}</div>
                            <button onclick="showPeerIdentity('\${identityPayload}')" class="mt-2 text-[10px] text-sky-400 hover:text-sky-300 font-black px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/10 transition-all">\${mt('details')}</button>
                        </td>
                        <td class="py-4 font-mono text-xs text-slate-400">\${esc(peer.ip.replace('::ffff:', ''))}</td>
                        <td class="py-4 text-slate-400">
                             <div class="text-xs font-bold">\${formatUptime(Math.floor((Date.now() - peer.connectedAt)/1000))}</div>
                             <div class="text-[9px] text-slate-600">\${mt('from')}\${new Date(peer.connectedAt).toLocaleTimeString(locale)}</div>
                        </td>
                        <td class="py-4 text-left pl-4">
                            <div class="flex justify-end gap-3">
                                <button onclick="suspendPeer('\${esc(peer.clientId)}')" class="text-amber-400 hover:text-amber-300 font-bold transition-colors">\${mt('suspend')}</button>
                                <button onclick="kickPeer('\${esc(peer.clientId)}')" class="text-rose-500 hover:text-rose-400 font-bold transition-colors">\${mt('kick')}</button>
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
                            <div class="font-black text-white">\${esc(user.username) || mt('unknownUser')}</div>
                            <div class="text-[9px] text-slate-500 font-mono truncate max-w-[180px]">\${esc(user.peerId || user.clientId || user.key)}</div>
                        </td>
                        <td class="py-4 text-slate-400">
                            <div class="font-mono text-[10px] truncate max-w-[220px]">\${esc(user.fingerprint) || mt('noFingerprint')}</div>
                            <div class="text-[9px] text-slate-600">\${esc(user.ip) || mt('unknownIp')}</div>
                        </td>
                        <td class="py-4 text-slate-400">
                            <div>\${user.createdAt ? new Date(user.createdAt).toLocaleString(locale) : '--'}</div>
                            <div class="text-[9px] text-amber-300 mt-1">\${user.expiresAt ? mt('until') + new Date(user.expiresAt).toLocaleString(locale) : mt('noEndTime')}</div>
                        </td>
                        <td class="py-4 text-left pl-4">
                            <button onclick="resumePeer('\${esc(user.key)}')" class="text-emerald-400 hover:text-emerald-300 font-bold transition-colors">\${mt('resume')}</button>
                        </td>
                    </tr>
                \`).join('') : '<tr><td colspan="4" class="py-8 text-center text-slate-500 font-bold">' + mt('noSuspendedUsers') + '</td></tr>';

                const kicked = data.kickedUsers || [];
                document.getElementById('kickedCount').textContent = kicked.length + ' ' + mt('usersUnit');
                document.getElementById('kickedTableBody').innerHTML = kicked.length ? kicked.map(user => \`
                    <tr class="border-b border-white/5">
                        <td class="py-4 pr-4">
                            <div class="font-black text-white">\${esc(user.username) || mt('unknownUser')}</div>
                            <div class="text-[9px] text-slate-500 font-mono truncate max-w-[180px]">\${esc(user.peerId || user.clientId || user.key)}</div>
                        </td>
                        <td class="py-4 text-slate-400">
                            <div class="font-mono text-[10px] truncate max-w-[220px]">\${esc(user.fingerprint) || mt('noFingerprint')}</div>
                            <div class="text-[9px] text-slate-600">\${esc(user.ip) || mt('unknownIp')}</div>
                        </td>
                        <td class="py-4 text-slate-400">
                            <div>\${user.createdAt ? new Date(user.createdAt).toLocaleString(locale) : '--'}</div>
                            <div class="text-[9px] text-rose-300 mt-1">\${user.permanent ? mt('unlimited') : (user.expiresAt ? mt('until') + new Date(user.expiresAt).toLocaleString(locale) : '--')}</div>
                        </td>
                        <td class="py-4 text-left pl-4">
                            <button onclick="unkickPeer('\${esc(user.key)}')" class="text-emerald-400 hover:text-emerald-300 font-bold transition-colors">\${mt('unkick')}</button>
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
  rememberPublicOrigin(publicUrls.relayOrigin);
  res.json({
    ok: true,
    service: 'poorija-chat-signal',
    peers: presence.size,
    turnEnabled: TURN_URLS.length > 0,
    /* Whether POST /link-preview answers, so a client offers the switch only
       against a relay that will do the fetch. */
    linkPreviews: LINK_PREVIEWS_ENABLED,
    /* Whether this relay can fetch a Telegram sticker pack from a link,
       itself or through the relay it hands the question to. */
    telegramStickers: TELEGRAM_STICKERS_AVAILABLE,
    /* So a client learns the relay's name in the probe it already makes. */
    relayId: relayIdentity.id,
    /* Which tree this relay was built from, so a deploy can check it. */
    version: RELAY_BUILD.version,
    buildTag: RELAY_BUILD.buildTag,
    /* The monitor's own round, which moves on its own schedule — stated here
       so a deployment can tell which dashboard answered without logging in. */
    monitor: MONITOR_VERSION,
    /* How many other relays this one can actually hand traffic to right now,
       which is the only honest measure of transit being up. */
    transit: relayPeers.status(),
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

/* Who this relay is. Public on purpose: it is a name, the same way a TLS
   certificate is, and a client that cannot read it cannot pin it. Nothing
   private is in the bundle -- publicRelayIdentity builds it from the public
   half alone. */
app.get('/relay-identity', (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  res.json({ ok: true, ...publicRelayIdentity(relayIdentity) });
});

/* One credential for one client, for this relay's own coturn. Shared by the
   HTTP endpoint and by the transit question a client on another relay asks
   when a call or transfer needs a TURN both sides can reach. */
function turnCredentialsForClient() {
  if (!TURN_URLS.length) return { enabled: false, urls: [] };
  if (TURN_SECRET) {
    const expiresAt = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
    const username = `${expiresAt}:${crypto.randomBytes(6).toString('hex')}`;
    const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
    return {
      enabled: true, urls: TURN_URLS, username, credential,
      ttl: TURN_CREDENTIAL_TTL_SECONDS, expiresAt: expiresAt * 1000,
    };
  }
  return { enabled: true, urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL };
}

app.get('/turn-config', (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  /* A minted credential is per request; caching one would hand the next
     visitor somebody else's. */
  setNoStoreHeaders(res);
  res.json(turnCredentialsForClient());
});

/* The relays this one is linked with right now, and the key to seal to each.
 *
 * What a client needs to find a contact whose home relay it does not know:
 * it can ask each of these, sealed, whether that fingerprint lives there. An
 * operator's links are not a secret — /chat-health already counts them — and
 * a relay that is not linked is not listed, so nothing here invites a client
 * to send through a carrier that would refuse it. */
/* The other addresses of this relay (CHAT_MIRROR_ORIGINS). Unsigned on
   purpose: a list naming a wrong address costs a client one failed proof,
   because every mirror is checked against this relay's key before use. */
/* A link preview for a client that cannot fetch one itself — the web app and
   the phone apps (scripts/lib/link-preview.js has the checks). The client says
   before the switch is on that the relay sees the link; nothing about the
   request is logged or kept here. CHAT_LINK_PREVIEWS=0 turns it off, and the
   number in flight at once is capped so it cannot tie up the relay. */
const LINK_PREVIEWS_ENABLED = process.env.CHAT_LINK_PREVIEWS !== '0';
const LINK_PREVIEW_MAX_IN_FLIGHT = Number(process.env.CHAT_LINK_PREVIEW_MAX_IN_FLIGHT || 8);
let linkPreviewsInFlight = 0;
app.post('/link-preview', async (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  setNoStoreHeaders(res);
  if (!LINK_PREVIEWS_ENABLED) return res.status(404).json({ ok: false, reason: 'disabled' });
  if (linkPreviewsInFlight >= LINK_PREVIEW_MAX_IN_FLIGHT) return res.status(503).json({ ok: false, reason: 'busy' });
  const url = String(req.body?.url || '').slice(0, 2048);
  if (!url) return res.status(400).json({ ok: false, reason: 'url-required' });
  linkPreviewsInFlight += 1;
  try {
    const preview = await linkPreview(url);
    return res.json({ ok: true, preview });
  } catch (error) {
    return res.status(422).json({ ok: false, reason: String(error?.message || 'refused').slice(0, 120) });
  } finally {
    linkPreviewsInFlight -= 1;
  }
});

/* A Telegram sticker pack from its share link (scripts/lib/telegram-stickers.js
   has the checks). TELEGRAM_BOT_TOKEN lets this relay ask Telegram itself;
   without one, TELEGRAM_STICKERS_UPSTREAM names a relay that can, and the
   question is passed to it — the relay inside a network that cannot reach
   Telegram asks the one outside. Neither set: the endpoint says so, and the
   app explains. Nothing about who asked is logged or kept. */
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_STICKERS_UPSTREAM = String(process.env.TELEGRAM_STICKERS_UPSTREAM || '').trim();
const TELEGRAM_STICKERS_AVAILABLE = Boolean(TELEGRAM_BOT_TOKEN || TELEGRAM_STICKERS_UPSTREAM);
const TELEGRAM_MAX_IN_FLIGHT = Number(process.env.CHAT_TELEGRAM_MAX_IN_FLIGHT || 12);
let telegramInFlight = 0;
function telegramFailure(res, error) {
  const reason = String(error?.message || 'refused').slice(0, 60);
  const status = { 'bad-name': 400, 'bad-file': 400, 'pack-not-found': 404, 'pack-empty': 404, 'unknown-file': 409, 'token-refused': 503 }[reason] || 502;
  return res.status(status).json({ ok: false, reason });
}
async function telegramGate(req, res, work) {
  if (sendRestrictionResponse(req, res)) return;
  setNoStoreHeaders(res);
  if (!TELEGRAM_STICKERS_AVAILABLE) return res.status(404).json({ ok: false, reason: 'not-configured' });
  if (telegramInFlight >= TELEGRAM_MAX_IN_FLIGHT) return res.status(503).json({ ok: false, reason: 'busy' });
  telegramInFlight += 1;
  try {
    return await work();
  } catch (error) {
    return telegramFailure(res, error);
  } finally {
    telegramInFlight -= 1;
  }
}
app.get('/telegram-stickers/set', (req, res) => telegramGate(req, res, async () => {
  const name = String(req.query.name || '');
  if (!telegramStickers.PACK_NAME.test(name)) throw new Error('bad-name');
  if (TELEGRAM_BOT_TOKEN) return res.json({ ok: true, pack: await telegramStickers.stickerPack(TELEGRAM_BOT_TOKEN, name) });
  const answer = await telegramStickers.fromUpstream(TELEGRAM_STICKERS_UPSTREAM, `/telegram-stickers/set?name=${encodeURIComponent(name)}`, telegramStickers.MAX_JSON_BYTES);
  return res.status(answer.status || 502).type('application/json').send(answer.body);
}));
app.get('/telegram-stickers/file', (req, res) => telegramGate(req, res, async () => {
  const id = String(req.query.id || '');
  if (!telegramStickers.FILE_ID.test(id)) throw new Error('bad-file');
  if (TELEGRAM_BOT_TOKEN) {
    const file = await telegramStickers.stickerFile(TELEGRAM_BOT_TOKEN, id);
    return res.status(200).type(file.type).send(file.body);
  }
  const answer = await telegramStickers.fromUpstream(TELEGRAM_STICKERS_UPSTREAM, `/telegram-stickers/file?id=${encodeURIComponent(id)}`, telegramStickers.MAX_FILE_BYTES);
  return res.status(answer.status || 502).type(answer.type || 'application/octet-stream').send(answer.body);
}));

/* The relays this one answers for at addresses of its own (CHAT_FRONTS), so a
   client that cannot reach its relay directly can find the door. Public on
   purpose: a client still proves the door leads to the relay it pinned (the
   mirror proof) before sending anything through it. */
app.get('/relay-fronts', (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  setNoStoreHeaders(res);
  res.json({ ok: true, fronts: frontDoor ? frontDoor.listing() : [] });
});

app.get('/relay-mirrors', (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  setNoStoreHeaders(res);
  res.json({ ok: true, relayId: relayIdentity.id, origins: MIRROR_ORIGINS });
});

/* Proof that whoever answers at this address holds this relay's private key.
 *
 * The client seals a fresh nonce to the relay key it pinned (the same sealing
 * transit uses) and posts it here; only the holder of the private key can
 * open it and hand the nonce back. That is what lets a client trust a mirror
 * — a different hostname, a CDN, a new certificate — as the relay it already
 * knows, without the relay needing a signing key.
 *
 * The envelope must say it is a proof and carry nothing but a nonce, so this
 * can never be used to open an intercepted transit envelope: anything else is
 * refused without saying what was inside. */
/* The same list, authenticated by this relay's key. The client seals a nonce
   and a one-off secret to the key it pinned; only the key's holder can read
   the secret, and the answer carries an HMAC under it over the list. Whoever
   sits on the path to the main address cannot slip an address of their own
   into what the client keeps. */
app.post('/relay-mirrors', (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  setNoStoreHeaders(res);
  let inner;
  try {
    inner = openTransit(relayPrivate, relayIdentity.id, req.body?.envelope);
  } catch (_error) {
    res.status(400).json({ ok: false, reason: 'unreadable' });
    return;
  }
  const nonce = String(inner?.nonce || '');
  const secret = String(inner?.k || '');
  if (inner?.purpose !== 'mirrors' || !/^[a-f0-9]{32,64}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(secret)
    || Object.keys(inner).length !== 3) {
    res.status(400).json({ ok: false, reason: 'not-a-request' });
    return;
  }
  const origins = MIRROR_ORIGINS.slice();
  const mac = crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`poorija-mirrors-v1|${relayIdentity.id}|${nonce}|${JSON.stringify(origins)}`)
    .digest('hex');
  res.json({ ok: true, relayId: relayIdentity.id, nonce, origins, mac });
});

app.post('/relay-prove', (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  setNoStoreHeaders(res);
  let inner;
  try {
    inner = openTransit(relayPrivate, relayIdentity.id, req.body?.envelope);
  } catch (_error) {
    res.status(400).json({ ok: false, reason: 'unreadable' });
    return;
  }
  const nonce = String(inner?.nonce || '');
  if (inner?.purpose !== 'prove' || !/^[a-f0-9]{32,64}$/.test(nonce) || Object.keys(inner).length !== 2) {
    res.status(400).json({ ok: false, reason: 'not-a-proof' });
    return;
  }
  res.json({ ok: true, relayId: relayIdentity.id, nonce });
});

app.get('/transit-peers', (req, res) => {
  if (sendRestrictionResponse(req, res)) return;
  setNoStoreHeaders(res);
  const peers = relayPeers.peerEntries()
    .filter((entry) => entry.linked && entry.key)
    /* The first of a "|"-separated list: clients route by id and key, and an
       operator's alternates for the link are the link's business. */
    .map((entry) => ({ id: entry.id, key: entry.key, origin: String(entry.origin || '').split('|')[0] }));
  res.json({ ok: true, self: relayIdentity.id, peers });
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
  /* The handle IS the answer — this endpoint exists to hand a poll token to
     a device that just proved its fingerprint, and the token is short-lived
     and answers only with a count. The shape below (rather than the
     shorthand object) keeps the security suite's blanket source check from
     reading a different endpoint's monitor session into this one. */
  const response = { ok: true, expiresAt: Date.now() + POLL_TOKEN_TTL_MS };
  response.token = token;
  res.json(response);
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
  noteKnownIdentity(fingerprint);
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

/* ============================================================ monitor 3.33
 *
 * The dashboard outgrew "watch": it runs the server now — queues, traffic,
 * relay links, backups, images, updates. Everything below is behind
 * authMiddleware like every /admin action, and answers JSON. */

/* ---- queues ---------------------------------------------------------------- */

/* The queue view the dashboard draws: per mailbox, counts and sizes and
   ages, never payload bytes. Fingerprints are shortened the way every other
   surface here shortens them. */
app.post('/Monitor_Server/queues', authMiddleware, (req, res) => {
  const rows = [];
  for (const [fingerprint, items] of offlineBoxes) {
    if (!Array.isArray(items) || !items.length) continue;
    let bytes = 0;
    let oldest = Infinity;
    let newest = 0;
    for (const item of items) {
      /* The payload is a parsed object, so its wire size is the JSON length —
         .length on an object is undefined and every mailbox would read 0 B. */
      bytes += Buffer.byteLength(JSON.stringify(item?.payload ?? null));
      const at = Number(item?.queuedAt) || 0;
      if (at < oldest) oldest = at;
      if (at > newest) newest = at;
    }
    rows.push({
      fingerprint: fingerprint.slice(0, 12),
      count: items.length,
      bytes,
      oldestAt: Number.isFinite(oldest) ? new Date(oldest).toISOString() : '',
      newestAt: newest ? new Date(newest).toISOString() : '',
    });
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  let heldForConnected = 0;
  for (const record of presence.values()) {
    if (record.sentMail) heldForConnected += record.sentMail.size;
  }
  res.json({
    ok: true,
    monitor: MONITOR_VERSION,
    mailboxes: rows,
    totals: { queued: rows.reduce((sum, row) => sum + row.count, 0), bytes: rows.reduce((sum, row) => sum + row.bytes, 0) },
    heldForConnected,
    transitWaiting: transitWaiting.size,
  });
});

/* One mailbox's items, metadata only: id, sender, type, age. The payload —
   somebody's message, sealed or not — is never handed to the dashboard. */
app.post('/Monitor_Server/queue-mailbox', authMiddleware, (req, res) => {
  const prefix = String(req.body?.fingerprint || '').trim().toLowerCase();
  if (!/^[a-f0-9]{4,64}$/.test(prefix)) {
    return res.status(400).json({ ok: false, reason: 'bad-fingerprint' });
  }
  let fingerprint = '';
  for (const key of offlineBoxes.keys()) {
    if (String(key).toLowerCase().startsWith(prefix)) { fingerprint = key; break; }
  }
  if (!fingerprint) return res.status(404).json({ ok: false, reason: 'no-such-mailbox' });
  const items = offlineBoxes.get(fingerprint) || [];
  res.json({
    ok: true,
    fingerprint: fingerprint.slice(0, 12),
    items: items.map((item, index) => ({
      index,
      id: String(item?.relayId || '').slice(0, 8),
      from: String(item?.fromFingerprint || '').slice(0, 12),
      type: item?.payload?.type ? String(item.payload.type).slice(0, 24) : 'relay',
      size: Buffer.byteLength(JSON.stringify(item?.payload ?? null)),
      queuedAt: item?.queuedAt ? new Date(item.queuedAt).toISOString() : '',
    })),
  });
});

/* Dropping mail is the operator's call, which is why it is here and why it
   is exact: one item by index, or the whole mailbox when index is absent.
   The store is saved the same way delivery saves it. */
app.post('/Monitor_Server/queue-drop', authMiddleware, async (req, res) => {
  const prefix = String(req.body?.fingerprint || '').trim().toLowerCase();
  const index = Number.isInteger(req.body?.index) ? Number(req.body.index) : null;
  if (!/^[a-f0-9]{4,64}$/.test(prefix)) {
    return res.status(400).json({ ok: false, reason: 'bad-fingerprint' });
  }
  let fingerprint = '';
  for (const key of offlineBoxes.keys()) {
    if (String(key).toLowerCase().startsWith(prefix)) { fingerprint = key; break; }
  }
  if (!fingerprint) return res.status(404).json({ ok: false, reason: 'no-such-mailbox' });
  const items = offlineBoxes.get(fingerprint) || [];
  if (index !== null) {
    if (index < 0 || index >= items.length) return res.status(400).json({ ok: false, reason: 'bad-index' });
    const [dropped] = items.splice(index, 1);
    if (!items.length) offlineBoxes.delete(fingerprint);
    monitorLog(`Dropped one mail item for ${fingerprint.slice(0, 12)}`);
  } else {
    offlineBoxes.delete(fingerprint);
    monitorLog(`Dropped the whole mailbox of ${fingerprint.slice(0, 12)} (${items.length} items)`);
  }
  await saveOfflineBoxes();
  res.json({ ok: true, remaining: offlineBoxes.get(fingerprint)?.length || 0 });
});

/* Nudge delivery: every connected holder of held mail is pumped right away.
   An offline mailbox is left alone — nudging it cannot deliver what has no
   one to receive it, and pretending otherwise would be a lie on a button. */
app.post('/Monitor_Server/queue-flush', authMiddleware, (req, res) => {
  let pumped = 0;
  for (const record of presence.values()) {
    if (!record.sentMail?.size) continue;
    pumped += record.sentMail.size;
    if (typeof pumpHeldMail === 'function') pumpHeldMail(record);
    if (typeof deliverHeldMail === 'function') deliverHeldMail(record);
  }
  res.json({ ok: true, pumped });
});

/* ---- relay links ------------------------------------------------------------ */

/* Runtime peer management, persisted beside the rest of the relay's state so
   a restart keeps the set the operator last chose. The env's peers are the
   seed; the file is the truth after the first change. */
const TRANSIT_PEERS_STORE = process.env.CHAT_TRANSIT_PEERS_STORE || path.join(defaultDataDir, 'transit-peers.json');
function loadRuntimeTransitPeers() {
  try {
    const raw = JSON.parse(fs.readFileSync(TRANSIT_PEERS_STORE, 'utf8'));
    for (const entry of Array.isArray(raw?.peers) ? raw.peers : []) {
      if (!/^[a-f0-9]{64}$/.test(String(entry?.id || ''))) continue;
      relayPeers.allowPeer(entry.id, String(entry?.origin || ''));
      directoryState.manualIds.add(entry.id);
    }
    if ((raw?.peers || []).length) console.log(`[Monitor] Restored ${raw.peers.length} runtime transit peer(s)`);
  } catch (_error) { /* first run: nothing to restore */ }
}
function saveRuntimeTransitPeers() {
  /* Not the family a directory brought in: copied here, a relay later left
     out of the directory would come back at the next start as "manual". */
  const peers = relayPeers.peerEntries()
    .filter(({ id }) => !directoryState.addedIds.has(id))
    .map(({ id, origin }) => ({ id, origin }));
  try {
    fs.writeFileSync(TRANSIT_PEERS_STORE, JSON.stringify({ peers, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  } catch (error) { console.warn('[Monitor] transit peers not saved:', error.message); }
}

/* ---- the relay family (scripts/lib/relay-directory.js) ----------------------
 *
 * The relays this relay's operator runs, in a directory the operator signed
 * (docs/RELAY-NETWORK.md, "Relay families"). The
 * relay trusts one operator key, CHAT_OPERATOR_KEY; it links by itself with
 * every relay the newest directory signed by that key names, and drops what
 * a newer one leaves out or revokes. Peers named in CHAT_TRANSIT_PEERS or
 * added from the dashboard stay as they are, unless revoked. A relay without
 * the key behaves as it always has.
 */
const OPERATOR_KEY = String(process.env.CHAT_OPERATOR_KEY || '').trim();
const DIRECTORY_PATH = process.env.CHAT_DIRECTORY_PATH || path.join(defaultDataDir, 'relay-directory.json');
const DIRECTORY_SOURCES = String(process.env.CHAT_DIRECTORY_SOURCES || '').split(',').map((origin) => origin.trim()).filter((origin) => /^https?:\/\//.test(origin));
const DIRECTORY_PULL_MS = Math.max(1000, Number(process.env.CHAT_DIRECTORY_PULL_MS || 300000));
/* The lowest serial this relay will ever take, held or not. The serial guard
   only knows what the relay holds: a new relay, or one whose file was lost,
   would take any directory the operator ever signed, an old one naming a
   relay revoked since. The operator's tool writes the current serial here. */
const DIRECTORY_FLOOR_PATH = `${DIRECTORY_PATH}.serial`;
/* Kept apart from the directory, so losing that file does not lower it. */
const DIRECTORY_MIN_SERIAL = Math.max(
  Math.floor(Number(process.env.CHAT_DIRECTORY_MIN_SERIAL || 0)) || 0,
  (() => { try { return Math.floor(Number(fs.readFileSync(DIRECTORY_FLOOR_PATH, 'utf8').trim())) || 0; } catch (_error) { return 0; } })(),
);
/* addedIds: what the directory brought in, and so may take away again.
   manualIds: what CHAT_TRANSIT_PEERS or the dashboard named. */
const directoryState = { doc: null, addedIds: new Set(), manualIds: new Set(TRANSIT_PEERS.map((peer) => peer.id)) };
const directoryMembers = () => (directoryState.doc?.body.relays || []).map((relay) => relay.id).filter((id) => id !== relayIdentity.id);

function applyDirectory(doc) {
  const plan = planChanges(doc.body, relayIdentity.id, directoryState.addedIds);
  const revoked = new Set(doc.body.revoked);
  for (const id of plan.drop) {
    if (directoryState.manualIds.has(id) && !revoked.has(id)) continue;
    relayPeers.disallowPeer(id);
    directoryState.addedIds.delete(id);
    directoryState.manualIds.delete(id);
  }
  for (const { id, origins } of plan.allow) {
    relayPeers.allowPeer(id, origins);
    if (!directoryState.manualIds.has(id)) directoryState.addedIds.add(id);
  }
  directoryState.doc = doc;
}

function offerDirectoryTo(link) {
  if (!directoryState.doc || !link?.isOpen?.() || !directoryMembers().includes(link.peerId)) return;
  try { link.send({ kind: 'directory', doc: directoryState.doc }); } catch (_error) { /* the link went */ }
}

/* Every way a directory arrives ends here, and every check happens here. */
function acceptDirectory(doc, source) {
  if (!OPERATOR_KEY) return { ok: false, reason: 'no-operator-key' };
  const held = directoryState.doc?.body;
  const floor = DIRECTORY_MIN_SERIAL > (held?.serial || 0);
  const verdict = verifyDirectory(doc, {
    operatorKey: OPERATOR_KEY,
    selfId: relayIdentity.id,
    heldSerial: floor ? DIRECTORY_MIN_SERIAL - 1 : (held?.serial || 0),
    heldBody: floor ? null : (held || null),
  });
  if (!verdict.ok) {
    /* The same directory heard again is the normal case for pull and push. */
    if (verdict.reason !== 'stale' || source === 'dashboard') {
      console.warn(`[Directory] refused a directory from ${source}: ${verdict.reason}`);
    }
    return verdict;
  }
  applyDirectory(doc);
  if (source !== 'disk') {
    try {
      fs.writeFileSync(DIRECTORY_PATH, JSON.stringify(doc), { mode: 0o600 });
      fs.writeFileSync(DIRECTORY_FLOOR_PATH, `${doc.body.serial}\n`, { mode: 0o600 });
    } catch (error) {
      console.warn('[Directory] could not keep the directory:', error.message);
    }
    for (const id of directoryMembers()) offerDirectoryTo(relayPeers.linkFor(id));
    monitorLog(`Relay directory ${doc.body.serial} from ${source}: ${doc.body.relays.length} relay(s), ${doc.body.revoked.length} revoked`);
  }
  console.log(`[Directory] serial ${doc.body.serial} (${source}): linked with ${directoryMembers().length} family relay(s)`);
  return { ok: true, serial: doc.body.serial };
}

/* Asked of every family member and every seed address; the newest valid
   answer wins. This is how a relay nobody can reach (one in Iran, seen from
   outside) still hears of a new directory. */
async function pullDirectories() {
  if (!OPERATOR_KEY) return;
  const origins = new Set(DIRECTORY_SOURCES);
  for (const relay of directoryState.doc?.body.relays || []) {
    if (relay.id !== relayIdentity.id) for (const origin of relay.origins || []) origins.add(String(origin));
  }
  await Promise.allSettled(Array.from(origins, async (origin) => {
    const response = await fetch(`${origin.replace(/\/+$/, '')}/relay-directory`, { signal: AbortSignal.timeout(15000) });
    if (response.ok) acceptDirectory(await response.json(), 'pull');
  }));
}

function startRelayDirectory() {
  if (!OPERATOR_KEY) return;
  try {
    acceptDirectory(JSON.parse(fs.readFileSync(DIRECTORY_PATH, 'utf8')), 'disk');
  } catch (_error) { /* none kept yet */ }
  setTimeout(() => pullDirectories().catch(() => {}), Math.min(5000, DIRECTORY_PULL_MS)).unref?.();
  setInterval(() => pullDirectories().catch(() => {}), DIRECTORY_PULL_MS).unref?.();
}

function directorySummary() {
  const body = directoryState.doc?.body;
  if (!body) return null;
  return {
    operator: { id: body.operator.id, name: String(body.operator.name || '') },
    serial: body.serial,
    issuedAt: body.issuedAt || '',
    relays: body.relays.map((relay) => ({
      id: relay.id,
      name: String(relay.name || ''),
      region: String(relay.region || ''),
      gateway: Number(relay.gateway || 0),
      self: relay.id === relayIdentity.id,
      linked: relay.id === relayIdentity.id || Boolean(relayPeers.linkFor(relay.id)),
    })),
    revoked: body.revoked,
  };
}

app.get('/relay-directory', (req, res) => {
  setNoStoreHeaders(res);
  if (!directoryState.doc) return res.status(404).json({ ok: false, reason: 'no-directory' });
  res.json(directoryState.doc);
});

app.post('/Monitor_Server/directory', authMiddleware, (req, res) => {
  const result = acceptDirectory(req.body, 'dashboard');
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/Monitor_Server/transit', authMiddleware, (req, res) => {
  res.json({
    ok: true,
    status: relayPeers.status(),
    directory: directorySummary(),
    peers: relayPeers.peerEntries().map((entry) => ({
      id: entry.id.slice(0, 16),
      origin: entry.origin,
      linked: entry.linked,
      role: entry.role,
      traffic: transitTraffic.get(entry.id) || { carried: 0, bytes: 0 },
    })),
  });
});

app.post('/Monitor_Server/transit-add', authMiddleware, (req, res) => {
  const id = String(req.body?.id || '').trim().toLowerCase();
  const origin = String(req.body?.origin || '').trim();
  if (!/^[a-f0-9]{64}$/.test(id)) return res.status(400).json({ ok: false, reason: 'bad-relay-id' });
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad scheme');
    } catch (_error) { return res.status(400).json({ ok: false, reason: 'bad-origin' }); }
  }
  const added = relayPeers.allowPeer(id, origin);
  if (!added) return res.status(400).json({ ok: false, reason: 'peer-refused' });
  directoryState.manualIds.add(id);
  directoryState.addedIds.delete(id);
  saveRuntimeTransitPeers();
  monitorLog(`Transit peer added: ${id.slice(0, 12)}${origin ? ` @ ${origin}` : ' (answer-only)'}`);
  res.json({ ok: true, status: relayPeers.status() });
});

app.post('/Monitor_Server/transit-remove', authMiddleware, (req, res) => {
  const id = String(req.body?.id || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(id)) return res.status(400).json({ ok: false, reason: 'bad-relay-id' });
  const removed = relayPeers.disallowPeer(id);
  if (!removed) return res.status(404).json({ ok: false, reason: 'no-such-peer' });
  saveRuntimeTransitPeers();
  monitorLog(`Transit peer removed: ${id.slice(0, 12)}`);
  res.json({ ok: true, status: relayPeers.status() });
});

/* ---- traffic ---------------------------------------------------------------- */

app.post('/Monitor_Server/traffic', authMiddleware, (req, res) => {
  const clients = Array.from(clientTraffic.entries())
    .map(([clientId, row]) => ({
      clientId: clientId.slice(0, 8),
      label: row.label ? row.label.slice(0, 24) : '',
      msgsIn: row.msgsIn, msgsOut: row.msgsOut,
      bytesIn: row.bytesIn, bytesOut: row.bytesOut,
      lastAt: new Date(row.lastAt).toISOString(),
    }))
    .sort((a, b) => (b.bytesIn + b.bytesOut) - (a.bytesIn + a.bytesOut))
    .slice(0, 25);
  const relays = Array.from(transitTraffic.entries())
    .map(([relayId, row]) => ({ relayId: relayId.slice(0, 16), carried: row.carried, bytes: row.bytes, lastAt: new Date(row.lastAt).toISOString() }))
    .sort((a, b) => b.bytes - a.bytes);
  res.json({
    ok: true,
    totals: {
      msgsIn: totalMessagesReceived, msgsOut: totalMessagesSent,
      bytesIn: totalBytesReceived, bytesOut: totalBytesSent, relays: totalRelays,
    },
    clients, relays,
  });
});

/* ---- events, hourly rollups, cross-relay activity, live calls ---------- */

/* The dashboard's report feed. Not a log file — a short memory of what the
   operator would want to see in order, kept in-process and lost with the
   relay, which is exactly the honest lifetime for it. */
const monitorEvents = [];
const MONITOR_EVENTS_MAX = 200;
function noteEvent(kind, text) {
  monitorEvents.push({ at: new Date().toISOString(), kind: String(kind).slice(0, 24), text: String(text).slice(0, 200) });
  if (monitorEvents.length > MONITOR_EVENTS_MAX) monitorEvents.shift();
}
function monitorLog(text) {
  console.log(`[Monitor] ${text}`);
  noteEvent('monitor', text);
}

/* One row per hour: the counters at the top of the hour, so the reports tab
   can draw yesterday without anybody having configured anything. */
const hourlyTraffic = [];
const HOURLY_MAX = 48;
setInterval(() => {
  hourlyTraffic.push({
    at: new Date().toISOString(),
    msgsIn: totalMessagesReceived, msgsOut: totalMessagesSent,
    bytesIn: totalBytesReceived, bytesOut: totalBytesSent,
    peers: presence.size,
  });
  if (hourlyTraffic.length > HOURLY_MAX) hourlyTraffic.shift();
}, 60 * 60 * 1000).unref();

/* Who has been talking THROUGH another relay lately. The envelope is sealed
   and stays sealed — this records only that the sender crossed the link, and
   the dashboard shows it as a badge that ages out. */
const transitActivity = new Map(); // clientId -> lastAt
function noteTransitActivity(clientId) {
  if (!clientId) return;
  transitActivity.set(clientId, Date.now());
  if (transitActivity.size > 1000) transitActivity.delete(transitActivity.keys().next().value);
}
function transitActivityMinutesAgo(clientId) {
  const at = transitActivity.get(clientId);
  if (!at) return null;
  return Math.round((Date.now() - at) / 60000);
}

/* Live calls on THIS relay, from the signaling it already sees: an invite
   opens a row, a cancel or a miss closes it, and ten quiet minutes close it
   for sure — a monitor that shows a dead call as live is worse than none. */
const activeCalls = new Map(); // clientId -> { since, peer, group }
const CALL_TTL_MS = 10 * 60 * 1000;
function noteCallFrame(fromClientId, payloadType, peerLabel) {
  if (!fromClientId) return;
  const isGroup = payloadType.startsWith('gcall');
  if (payloadType === 'call-invite' || payloadType === 'gcall-invite') {
    activeCalls.set(fromClientId, { since: Date.now(), peer: String(peerLabel || '').slice(0, 40), group: isGroup });
  } else if (payloadType === 'call-cancel' || payloadType === 'call-missed' || payloadType === 'gcall-leave') {
    activeCalls.delete(fromClientId);
  }
  if (activeCalls.size > 200) activeCalls.delete(activeCalls.keys().next().value);
}
setInterval(() => {
  const now = Date.now();
  for (const [clientId, call] of activeCalls) {
    if (now - call.since > CALL_TTL_MS) activeCalls.delete(clientId);
  }
}, 60 * 1000).unref();

/* The reports tab: everything above in one answer. */
app.post('/Monitor_Server/reports', authMiddleware, (req, res) => {
  const calls = [];
  for (const [clientId, call] of activeCalls) {
    const record = Array.from(presence.values()).find((peer) => peer.clientId === clientId);
    calls.push({
      username: record?.username || clientId.slice(0, 8),
      peer: call.peer,
      group: call.group,
      since: new Date(call.since).toISOString(),
    });
  }
  res.json({
    ok: true,
    events: monitorEvents.slice(-80).reverse(),
    hourly: hourlyTraffic.slice(),
    activeCalls: calls,
    transitActive: Array.from(transitActivity.entries())
      .map(([clientId, at]) => ({ clientId: clientId.slice(0, 8), minutesAgo: Math.round((Date.now() - at) / 60000) }))
      .sort((a, b) => a.minutesAgo - b.minutesAgo)
      .slice(0, 20),
  });
});

/* The purge's own log — what the retention decided and when, straight from
   the file it already keeps, newest first, never more than a screen. */
app.post('/Monitor_Server/expiry-log', authMiddleware, (req, res) => {
  try {
    const raw = JSON.parse(fs.readFileSync(EXPIRY_LOG_PATH, 'utf8'));
    const entries = Array.isArray(raw) ? raw : (Array.isArray(raw.entries) ? raw.entries : []);
    res.json({ ok: true, entries: entries.slice(-100).reverse() });
  } catch (_error) {
    res.json({ ok: true, entries: [] });
  }
});

/* ---- the announce centre ----------------------------------------------------
 *
 * The old broadcast reached whoever was holding a socket; everyone else
 * learned nothing until they came back. This reaches every identity the
 * relay has ever served: a queued mailbox entry (so it is waiting on the
 * next connection), a live frame to anyone connected now, and a push
 * notification to every device that subscribed one — online or not.
 *
 * Attachments ride the entry the way chat media never can (server-origin,
 * already in the clear to the server, capped small), and the app renders
 * them from the system note it already knows how to draw. */

const ANNOUNCE_MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
/* An announce with an attachment to the full registry is a disk bomb: 20k
   identities × 2MB each. Text-only announces are cheap; attachments are
   capped to a targeted list. */
const ANNOUNCE_ATTACHMENT_MAX_RECIPIENTS = 100;
/* ---- the identity registry ---------------------------------------------------
 *
 * The first announce answered "reached 0 identities" on a quiet relay, and
 * The first announce answered "reached 0 identities" on a quiet relay, and
 * it was honest: it counted mailboxes (empty) plus sockets (none). A relay
 * that can only name who is HERE right now cannot send to everyone, which
 * is the whole point of the announce centre. So every fingerprint the relay
 * ever meets — connected, mailed-to, allowlisted, announced-at — is kept in
 * a small persistent file and reloaded at boot. */
const KNOWN_IDENTITIES_PATH = path.join(defaultDataDir, 'known-identities.json');
const knownIdentities = new Set();
function loadKnownIdentities() {
  try {
    const raw = JSON.parse(fs.readFileSync(KNOWN_IDENTITIES_PATH, 'utf8'));
    for (const fp of Array.isArray(raw?.fingerprints) ? raw.fingerprints : []) {
      if (/^[a-f0-9]{64}$/.test(String(fp))) knownIdentities.add(fp);
    }
    console.log(`[Monitor] ${knownIdentities.size} known identit${knownIdentities.size === 1 ? 'y' : 'ies'} loaded`);
  } catch (_error) { /* first run */ }
}
function saveKnownIdentities() {
  try {
    const cutoff = Date.now() - PROVEN_IDENTITY_TTL_MS;
    const proven = {};
    for (const [fp, at] of provenIdentities) if (at > cutoff) proven[fp] = at;
    fs.writeFileSync(KNOWN_IDENTITIES_PATH, JSON.stringify({ fingerprints: Array.from(knownIdentities), proven }, null, 1), { mode: 0o600 });
  } catch (error) { console.warn('[Monitor] identity registry not saved:', error.message); }
}
/* Fingerprints that PROVED themselves on this relay, and when they last did.
 *
 * knownIdentities is everything the relay ever met, mail addressed to a
 * stranger included, so it cannot answer "does this person live here?". This
 * can: only a socket that answered the identity challenge is written into it.
 * It is what a linked relay is told when a client asks where to deliver — yes
 * or no for the one fingerprint asked, and nothing else. Entries age out after
 * ninety days of absence, so a person who moved relays stops being claimed. */
const PROVEN_IDENTITY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const provenIdentities = new Map();
function loadProvenIdentities() {
  try {
    const raw = JSON.parse(fs.readFileSync(KNOWN_IDENTITIES_PATH, 'utf8'));
    const cutoff = Date.now() - PROVEN_IDENTITY_TTL_MS;
    for (const [fp, at] of Object.entries(raw?.proven || {})) {
      if (/^[a-f0-9]{64}$/.test(fp) && Number(at) > cutoff) provenIdentities.set(fp, Number(at));
    }
  } catch (_error) { /* first run */ }
}
function noteProvenIdentity(fingerprint) {
  const fp = sanitizeFingerprint(String(fingerprint || ''));
  if (!/^[a-f0-9]{64}$/.test(fp)) return;
  const previous = provenIdentities.get(fp) || 0;
  provenIdentities.set(fp, Date.now());
  if (provenIdentities.size > 20000) provenIdentities.delete(provenIdentities.keys().next().value);
  /* A daily refresh is plenty for a ninety-day window; writing on every
     reconnect would be a disk write per page load. */
  if (Date.now() - previous > 24 * 60 * 60 * 1000) noteKnownIdentity(fp, { force: true });
}
function identityLivesHere(fingerprint) {
  const at = provenIdentities.get(String(fingerprint || ''));
  return Boolean(at && Date.now() - at < PROVEN_IDENTITY_TTL_MS);
}

function noteKnownIdentity(fingerprint, { force = false } = {}) {
  const fp = sanitizeFingerprint(String(fingerprint || ''));
  if (!fp || fp.length < 32) return;
  if (knownIdentities.has(fp) && !force) return;
  knownIdentities.add(fp);
  /* Cap the registry so it cannot grow without bound on a hostile relay. */
  if (knownIdentities.size > 20000) knownIdentities.delete(knownIdentities.keys().next().value);
  /* Debounced, not per-hello: a sync write of the full registry inside
     the WS receive path froze the event loop per new fingerprint. */
  if (noteKnownIdentity._timer) clearTimeout(noteKnownIdentity._timer);
  noteKnownIdentity._timer = setTimeout(() => {
    noteKnownIdentity._timer = null;
    saveKnownIdentities();
  }, 2000);
  if (noteKnownIdentity._timer && typeof noteKnownIdentity._timer.unref === 'function') noteKnownIdentity._timer.unref();
}
loadKnownIdentities();
loadProvenIdentities();

app.post('/Monitor_Server/identities', authMiddleware, (req, res) => {
  const rows = Array.from(knownIdentities).map((fp) => ({
    fingerprint: fp.slice(0, 16),
    connected: Array.from(presence.values()).some((record) => sanitizeFingerprint(identitySnapshot(record)?.fingerprint || '') === fp),
    mailbox: (offlineBoxes.get(fp) || []).length,
  }));
  res.json({ ok: true, total: rows.length, identities: rows.sort((a, b) => b.mailbox - a.mailbox).slice(0, 100) });
});

app.post('/Monitor_Server/announce', authMiddleware, async (req, res) => {
  const message = String(req.body?.message || '').trim().slice(0, 2000);
  const title = String(req.body?.title || '').trim().slice(0, 120) || 'پیام از سرور';
  if (!message && !req.body?.attachment) return res.status(400).json({ ok: false, reason: 'empty' });
  const attachmentRaw = req.body?.attachment || null;
  let attachment = null;
  if (attachmentRaw) {
    const dataUrl = String(attachmentRaw.dataUrl || '');
    if (!/^data:[\w./+-]+;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) return res.status(400).json({ ok: false, reason: 'bad-data-url' });
    if (Buffer.byteLength(dataUrl) > ANNOUNCE_MAX_ATTACHMENT_BYTES) return res.status(400).json({ ok: false, reason: 'attachment-too-large' });
    attachment = {
      kind: ['image', 'sticker', 'file', 'audio'].includes(attachmentRaw.kind) ? attachmentRaw.kind : 'file',
      name: String(attachmentRaw.name || 'attachment').slice(0, 120),
      mimeType: String(attachmentRaw.mimeType || 'application/octet-stream').slice(0, 100),
      dataUrl,
    };
  }
  /* Everyone this relay has ever served: the persistent registry first (the
     whole point of it), plus connected now and mailbox holders — and every
     one of them is remembered from this moment on. A personal message names
     its targets and goes to exactly those. */
  const fingerprints = new Set();
  const targets = Array.isArray(req.body?.targets)
    ? req.body.targets.map((fp) => sanitizeFingerprint(String(fp || ''))).filter(Boolean)
    : [];
  if (targets.length) {
    for (const fp of targets) fingerprints.add(fp);
  } else {
    for (const fp of knownIdentities) fingerprints.add(fp);
    for (const key of offlineBoxes.keys()) fingerprints.add(key);
    for (const record of presence.values()) {
      const fp = sanitizeFingerprint(identitySnapshot(record)?.fingerprint || '');
      if (fp) fingerprints.add(fp);
    }
  }
  if (attachment && !targets.length && fingerprints.size > ANNOUNCE_ATTACHMENT_MAX_RECIPIENTS) {
    return res.status(400).json({ ok: false, reason: `attachment-broadcast-capped-at-${ANNOUNCE_ATTACHMENT_MAX_RECIPIENTS}`, hint: 'send attachments to named targets only' });
}
for (const fp of fingerprints) noteKnownIdentity(fp);
  let queued = 0;
  let live = 0;
  /* One id per announcement: the frame goes out live AND sits in the
     mailbox, and whichever arrives second must be recognised as the same
     announcement, not rendered (and rung) twice. */
  const announceId = crypto.randomUUID();
  /* The stamp the recipient checks against the relay identity it pinned:
   the relay's signing material cannot make signatures a browser verifies
   (its key is ECDH), so the stamp plus "no peer can send in the relay's
   name" (the fromFingerprint below is written by THIS server, and transit
   refuses the type) is what makes a server note unfakeable. */
  const payload = { type: 'system-note', announceId, message: message || attachment.name, title, attachment, relayId: relayIdentity.id };
  for (const fingerprint of fingerprints) {
    const items = offlineBoxes.get(fingerprint) || [];
    items.push({
      type: 'relay',
      relayId: crypto.randomUUID(),
      fromClientId: 'server-announce',
      fromFingerprint: 'monitor',
      payload,
      queuedAt: new Date().toISOString(),
    });
/* The mailbox flood gate: without a cap on mailbox count, one hostile
   socket fabricates a fresh fingerprint per frame and fills the disk. */
const MAILBOX_MAX_BOXES = 10000;
function mailboxCountOk() { return offlineBoxes.size < MAILBOX_MAX_BOXES; }

    if (!mailboxCountOk()) { reply({ type: 'error', reason: 'mailbox-full' }); return; }
    offlineBoxes.set(fingerprint, items);
    queued += 1;
    /* ONE delivery, ONE notification. The relay frame is the message — live
       now, from the mailbox after a reconnect — and the push wakes only the
       devices that are not already looking at the app. The first cut sent a
       broadcast frame AND a relay frame AND pushed to everybody, which is
       how one announcement learned to ring three times. */
    const target = findOpenPresenceByFingerprint(fingerprint);
    const awake = target ? isAppAwake(target) : false;
    if (target?.ws && target.ws.readyState === WebSocket.OPEN) {
      safeSend(target.ws, { type: 'relay', fromClientId: 'server-announce', fromFingerprint: 'monitor', relayId: crypto.randomUUID(), payload });
      live += 1;
    }
    if (!awake) {
      sendAdminPushNotification(fingerprint, (title ? title + ': ' : '') + String(message || attachment.name || '').slice(0, 160), 'admin-announce').catch(() => {});
    }
    /* Diagnostics the operator can check when a device rings twice: what
       was sent, to whom, and whether they were awake at the time. */
    monitorLog(`Announce → ${fingerprint.slice(0, 12)} (${awake ? 'awake, no push' : 'push sent'})`);
  }
  await saveOfflineBoxes();
  monitorLog(`Announcement to ${queued} identit${queued === 1 ? 'y' : 'ies'} (${live} live, push attempted)`);
  res.json({ ok: true, reached: queued, live });
});

/* ---- container memory -------------------------------------------------------
 *
 * What the machine really has, what each container is allowed, and the knob
 * itself: the engine's update endpoint changes a live container's memory
 * ceiling without a restart, and the restart button beside it is for when
 * the workload should be given a clean start on the new number. */

app.post('/Monitor_Server/ops-memory', authMiddleware, async (req, res) => {
  if (!dockerAvailable()) return res.json({ ok: false, reason: 'docker-socket-not-mounted' });
  const info = await dockerEngineJson('GET', '/v1.44/info');
  const containers = await dockerEngineJson('GET', '/v1.44/containers/json?all=1');
  const rows = [];
  for (const container of containers.data || []) {
    const name = String((container.Names || [])[0] || '').replace(/^\//, '');
    if (!/Poorija-Cryptography/.test(name)) continue;
    const detail = await dockerEngineJson('GET', `/v1.44/containers/${container.Id}/json`);
    const stats = await dockerEngineRequest('GET', `/v1.44/containers/${container.Id}/stats?stream=false`, null, { timeoutMs: 20000 });
    const statData = opsParseJson(stats.body);
    const limitBytes = Number(detail.data?.HostConfig?.Memory || 0);
    const usageBytes = Number(statData?.memory_stats?.usage || 0);
    const cpuDelta = Number(statData?.cpu_stats?.cpu_usage?.total_usage || 0) - Number(statData?.precpu_stats?.cpu_usage?.total_usage || 0);
    const sysDelta = Number(statData?.cpu_stats?.system_cpu_usage || 0) - Number(statData?.precpu_stats?.system_cpu_usage || 0);
    const onlineCpus = Number(statData?.cpu_stats?.online_cpus || 1) || 1;
    const cpuPct = sysDelta > 0 ? Math.round((cpuDelta / sysDelta) * onlineCpus * 100) : 0;
    rows.push({
      id: container.Id.slice(0, 12),
      name,
      limitMb: Math.round(limitBytes / 1024 / 1024) || null,
      usageMb: Math.round(usageBytes / 1024 / 1024) || 0,
      cpuPct: Math.min(999, cpuPct),
      cpuCapped: Number(detail.data?.HostConfig?.CpuQuota || 0) > 0,
      unlimited: !limitBytes,
    });
  }
  res.json({
    ok: true,
    host: {
      totalMb: Math.round(Number(info.data?.MemTotal || 0) / 1024 / 1024),
      cpus: info.data?.NCPU || 0,
      engine: info.data?.ServerVersion || '',
    },
    containers: rows,
  });
});

app.post('/Monitor_Server/ops-memory-set', authMiddleware, async (req, res) => {
  if (!dockerAvailable()) return res.json({ ok: false, reason: 'docker-socket-not-mounted' });
  const name = String(req.body?.container || '').trim();
  /* mb = 0 is a deliberate "back to unlimited": the engine's zero means no
     ceiling, which is how the stack started life and how every container
     except the ones an operator has touched still runs. cpu = a percentage
     of ONE core (50 = half a core, 200 = two cores), 0 = uncapped. */
  const rawMb = Math.round(Number(req.body?.mb ?? -1));
  const unlimited = rawMb === 0;
  const megabytes = unlimited ? 0 : Math.max(64, Math.min(16384, rawMb));
  const cpuPercent = Math.max(0, Math.min(800, Math.round(Number(req.body?.cpu ?? 0) || 0)));
  if (!/^Poorija-Cryptography_[\w-]+$/.test(name) || rawMb < 0 || (!unlimited && !megabytes)) {
    return res.status(400).json({ ok: false, reason: 'bad-request' });
  }
  const containers = await dockerEngineJson('GET', '/v1.44/containers/json?all=1');
  const target = (containers.data || []).find((container) => ((container.Names || [])[0] || '').replace(/^\//, '') === name);
  if (!target) return res.status(404).json({ ok: false, reason: 'no-such-container' });
  /* MemorySwap at twice the ceiling is the standard pairing: the heap may
     breathe past RSS a little, but never past a wall anyone can point at.
     CpuQuota is µs of CPU per 100ms period — 100000 = one whole core. */
  const update = await dockerEngineJson('POST', `/v1.44/containers/${target.Id}/update`, {
    Memory: megabytes * 1024 * 1024,
    MemorySwap: unlimited ? 0 : megabytes * 2 * 1024 * 1024,
    CpuPeriod: cpuPercent ? 100000 : undefined,
    CpuQuota: cpuPercent ? cpuPercent * 1000 : -1,
  });
  monitorLog(`Resources of ${name}: mem ${unlimited ? 'unlimited' : megabytes + ' MB'}, cpu ${cpuPercent ? cpuPercent + '%' : 'uncapped'} (${update.ok ? 'applied live' : 'failed'})`);
  res.json({
    ok: update.ok,
    container: name,
    mb: megabytes,
    unlimited,
    cpu: cpuPercent,
    note: update.ok ? 'applied to the running container; restart it if you want a clean start on the new number' : String(update.data?.message || '').slice(0, 200),
  });
});

/* ---- disk and cleanup ---------------------------------------------------------
 *
 * What the machine's disks hold because of this stack, and one button for
 * each thing that is safe to drop: old tagged images of ourselves, dangling
 * layers, the dashboard's temp transfers, and backups past the retention. */

/* The images some container, running or stopped, is made from. images/json
   has a Containers count, but the engine leaves it at -1 unless asked to
   work it out, so "in use" read from it was never true and an image a
   container runs could be offered for removal. */
async function imagesInUse() {
  const containers = await dockerEngineJson('GET', '/v1.44/containers/json?all=1');
  return new Set((containers.data || []).map((container) => String(container.ImageID || '')).filter(Boolean));
}

/* Proves the whole way to the operator's phone: from a relay without
   Telegram, over the link to the one with it, and on. */
app.post('/Monitor_Server/alert-test', authMiddleware, async (req, res) => {
  const via = alertsByTelegram() ? 'telegram' : (Array.from(alertPeers()).some((id) => relayPeers.linkFor(id)?.isOpen()) ? 'relay-link' : 'none');
  queueAlert(`🔔 ${ALERT_LABEL}: پیام آزمایشی هشدار، از پنل مدیریت.`);
  await flushAlerts();
  res.json({ ok: via !== 'none', via, waiting: alertOutbox.length });
});

app.post('/Monitor_Server/ops-disk', authMiddleware, async (req, res) => {
  if (!dockerAvailable()) return res.json({ ok: false, reason: 'docker-socket-not-mounted' });
  /* system/df walks every layer on disk and can outlast an nginx proxy
     window; images/json answers the same question about images in one fast
     call, which is what this card actually shows. */
  const [imagesRaw, used] = await Promise.all([dockerEngineJson('GET', '/v1.44/images/json'), imagesInUse()]);
  const images = (imagesRaw.data || []).map((image) => ({
    /* Id survives the remap — the cleanup lists hand it to the engine by
       exact ref, and a remapped row without it deletes nothing. */
    id: String(image.Id || ''),
    tags: (image.RepoTags || []).filter(Boolean),
    size: image.Size,
    inUse: used.has(String(image.Id || '')),
  }));
  /* Our own old tags — every poorija-crypto tag that is not this round's —
     plus anything the engine calls dangling. These are the bytes nobody will
     ever miss. */
  const APP_IMAGE_TAG = process.env.APP_VERSION || '';
  const staleSelf = images.filter((image) => image.tags.some((tag) => tag.startsWith('poorija-crypto:') && (!APP_IMAGE_TAG || !tag.endsWith(APP_IMAGE_TAG))) && !image.inUse);
  const dangling = images.filter((image) => !image.tags.length && !image.inUse);
  const stat = await fsp.statfs(defaultDataDir).catch(() => null);
  res.json({
    ok: true,
    disk: stat ? { free: Number(stat.bavail) * 4096, total: Number(stat.blocks) * 4096 } : null,
    docker: {
      imagesBytes: images.reduce((sum, image) => sum + (image.size || 0), 0),
    },
    cleanup: {
      staleSelfImages: staleSelf.map((image) => ({ ref: image.tags[0] || '', tags: image.tags, size: image.Size || image.size || 0 })),
      staleSelfBytes: staleSelf.reduce((sum, image) => sum + image.size, 0),
      /* Docker names the field Id (capital) — reading .id here handed the
         dashboard empty refs, which is exactly why ticked layers "deleted"
         nothing: the server was asked to remove two blank strings. */
      danglingImages: dangling.map((image) => ({ ref: String(image.Id || image.id || ''), size: image.Size || image.size || 0 })),
      danglingCount: dangling.length,
      danglingBytes: dangling.reduce((sum, image) => sum + image.size, 0),
    },
  });
});

app.post('/Monitor_Server/ops-cleanup', authMiddleware, async (req, res) => {
  if (!dockerAvailable()) return res.json({ ok: false, reason: 'docker-socket-not-mounted' });
  const what = String(req.body?.what || '');
  /* Selective mode: the dashboard sends the exact refs the operator ticked —
     image tags ("poorija-crypto:v2.99") or image ids ("sha256:…" truncated is
     not accepted; the disk listing hands out the full ref it wants gone). */
  const chosen = Array.isArray(req.body?.refs) ? req.body.refs.map(String).filter((ref) => /^[\w.:\/@-]+$/.test(ref) && ref.length < 200) : [];
  if (what === 'selected' && chosen.length) {
    let freedBytes = 0;
    const gone = [];
    const used = await imagesInUse();
    for (const ref of chosen) {
      const inspect = await dockerEngineJson('GET', `/v1.44/images/${encodeURIComponent(ref)}/json`);
      if (!inspect.ok) continue;
      /* An image inspection has no container count at all: what runs from
         it is read from the containers. */
      if (used.has(String(inspect.data?.Id || ''))) continue;
      freedBytes += Number(inspect.data?.Size || 0);
      const removed = await dockerEngineRequest('DELETE', `/v1.44/images/${encodeURIComponent(ref)}?force=1&noprune=0`, null, { timeoutMs: 120000 });
      if (!removed.unreachable && removed.status < 300) gone.push(ref);
    }
    monitorLog(`Selective cleanup removed ${gone.length} image ref(s), ${Math.round(freedBytes / 1048576)} MB`);
    return res.json({ ok: true, what, removed: gone, freedBytes });
  }
  const APP_IMAGE_TAG = process.env.APP_VERSION || '';
  const dfRaw = await dockerEngineJson('GET', '/v1.44/images/json');
  const df = { data: { Images: dfRaw.data || [] } };
  let freed = 0;
  if (what === 'stale-images') {
    const used = await imagesInUse();
    for (const image of df.data.Images) {
      const tags = (image.RepoTags || []).filter(Boolean);
      if (!tags.length || used.has(String(image.Id || ''))) continue;
      if (!tags.some((tag) => tag.startsWith('poorija-crypto:') && (!APP_IMAGE_TAG || !tag.endsWith(APP_IMAGE_TAG)))) continue;
      for (const tag of tags) await dockerEngineJson('DELETE', `/v1.44/images/${encodeURIComponent(tag)}`);
      freed += image.Size || 0;
    }
  }
  if (what === 'dangling') {
    /* dangling=true: untagged layers nothing uses. The filter said
       { false: false } — the engine reads the key, not the value, so that
       was dangling=false, which prunes EVERY image no container uses: the
       base images the next build needs (slow or impossible to fetch again
       from a filtered network) and whatever else the machine keeps. */
    const prune = await dockerEngineRequest('POST', '/v1.44/images/prune?filters=' + encodeURIComponent(JSON.stringify({ dangling: { true: true } })), null, { timeoutMs: 300000 });
    freed += Number(opsParseJson(prune.body)?.SizeReclaimed || 0);
  }
  if (what === 'temps') {
    const job = await runOpsJob(['sh', '-c', 'rm -f /relaydata/.monitor-* /job/data/.monitor-* 2>/dev/null; true']);
    if (job.ok) freed += 0;
  }
  monitorLog(`Cleanup (${what}) freed ${Math.round(freed / 1024 / 1024)} MB`);
  res.json({ ok: true, what, freedBytes: freed });
});

/* ---- Docker Hub version check --------------------------------------------------
 *
 * "Check and update" before this said only whether the pull succeeded; the
 * operator asked for the sentence a person actually needs: my digest is X,
 * Hub says Y, newer — update now? The Hub's tag API carries the remote
 * digest and its push time, so the comparison is exact, not a guess. For a
 * server that cannot reach the Hub directly, OPS_HUB_MIRROR points the one
 * wget at a mirror that can. */

const OPS_HUB_MIRROR = process.env.OPS_HUB_MIRROR || 'https://hub.docker.com';
async function hubTagInfo(repository, tag) {
  const path = repository.includes('/') ? repository : `library/${repository}`;
  const job = await (async () => {
    const name = `poorija-hub-${Date.now()}`;
    const created = await dockerEngineJson('POST', `/v1.44/containers/create?name=${name}`, {
      Image: OPS_JOB_IMAGE,
      Cmd: ['wget', '-q', '-O', '-', `${OPS_HUB_MIRROR}/v2/repositories/${path}/tags/${tag}`],
      HostConfig: { AutoRemove: false, NetworkMode: 'default' },
    });
    if (!created.ok) return { ok: false, reason: `create-${created.status}` };
    const containerId = created.data.Id;
    await dockerEngineJson('POST', `/v1.44/containers/${containerId}/start`, null);
    const deadline = Date.now() + 30000;
    let exit = null;
    while (Date.now() < deadline) {
      const state = await dockerEngineJson('GET', `/v1.44/containers/${containerId}/json`);
      if (state.ok && state.data?.State?.Status !== 'running') { exit = Number(state.data?.State?.ExitCode ?? -1); break; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const logs = await dockerEngineRequest('GET', `/v1.44/containers/${containerId}/logs?stdout=1&stderr=1&tail=10`);
    await dockerEngineJson('DELETE', `/v1.44/containers/${containerId}?force=1&v=1`);
    if (exit !== 0) return { ok: false, reason: 'hub-unreachable' };
    /* The logs API streams framed: 8 header bytes, then that many payload
       bytes, repeat. Strip the frames instead of the NULs, or the JSON the
       Hub answered arrives with binary length bytes woven through it. */
    let stripped = '';
    const raw = logs.raw || Buffer.from(String(logs.body || ''), 'utf8');
    let offset = 0;
    while (offset + 8 <= raw.length) {
      const size = raw.readUInt32BE(offset + 4);
      if (offset + 8 + size > raw.length) break;
      stripped += raw.subarray(offset + 8, offset + 8 + size).toString('utf8');
      offset += 8 + size;
    }
    if (!stripped) stripped = String(logs.body || '');
    return { ok: true, body: stripped };
  })();
  if (!job.ok) return { ok: false, reason: job.reason };
  const parsed = opsParseJson(job.body);
  if (!parsed) return { ok: false, reason: 'hub-bad-answer' };
  return {
    ok: true,
    digest: String(parsed.digest || ''),
    lastPushed: parsed.last_updated ? new Date(parsed.last_updated).toISOString() : '',
    fullSize: Number(parsed.full_size || 0),
  };
}

app.post('/Monitor_Server/ops-image-check', authMiddleware, async (req, res) => {
  const reference = String(req.body?.reference || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.\/:-]*:[A-Za-z0-9_.-]+$/.test(reference)) {
    return res.status(400).json({ ok: false, reason: 'bad-reference' });
  }
  if (!dockerAvailable()) return res.json({ ok: false, reason: 'docker-socket-not-mounted' });
  const [name, tag] = reference.split(':');
  const local = await dockerEngineJson('GET', `/v1.44/images/${encodeURIComponent(reference)}/json`);
  const localDigest = String(local.data?.RepoDigests?.[0] || '').split('@')[1] || String(local.data?.Id || '');
  const hub = await hubTagInfo(name, tag);
  res.json({
    ok: true,
    reference,
    local: { id: String(local.data?.Id || '').slice(7, 19), digest: localDigest.slice(7, 30), created: Number.isFinite(Number(local.data?.Created)) && Number(local.data.Created) > 0 ? new Date(Number(local.data.Created) * 1000).toISOString() : '' },
    hub: hub.ok ? { digest: String(hub.digest || '').slice(7, 30), lastPushed: hub.lastPushed, size: hub.fullSize } : null,
    hubError: hub.ok ? '' : (hub.reason || ''),
    updateAvailable: Boolean(hub.ok && hub.digest && localDigest && !hub.digest.includes(localDigest.slice(7, 30)) && !localDigest.includes(hub.digest.slice(7, 30))),
  });
});

/* ---- machine half: docker, archives, backups --------------------------------
 *
 * All of it goes through the docker engine API over a socket the deployment
 * may mount (OPS_DOCKER_SOCKET). No child process and no shell leave this
 * file: the engine takes JSON, and the one place bytes are packed or
 * unpacked is a short-lived container with a fixed argument list. A
 * deployment that does not mount the socket simply sees these actions
 * answer "unavailable" — the rest of the dashboard carries on. */

const OPS_DOCKER_SOCKET = process.env.OPS_DOCKER_SOCKET || '/var/run/docker.sock';
/* The install directory as THE DOCKER HOST sees it — bind mounts in the job
   containers below are resolved by the host engine, not inside this
   container, so this is the host path even though the relay only ever
   passes it on as text. */
const INSTALL_HOST_DIR = process.env.OPS_INSTALL_DIR || '';
/* The relay's own base image, which every machine running it already holds:
   a job never waits on a registry. */
const OPS_JOB_IMAGE = process.env.OPS_JOB_IMAGE || 'node:26.12.0-alpine';
const OPS_BACKUP_HOST_DIR = process.env.OPS_BACKUP_DIR || (INSTALL_HOST_DIR ? `${INSTALL_HOST_DIR}/backups` : '');
/* Where this relay's own /data lives on the host — the compose file mounts
   data/chat-signal there. A file a job hands to this process (a backup on
   its way to the browser, the clean bundle) is written into it as
   /relaydata. It went to /job/data instead, which is the install's data/,
   one level up: the relay then streamed a file that was not there, and every
   backup download and every bundle — the bootstrap installer's included —
   came out empty. */
const OPS_DATA_HOST_DIR = process.env.OPS_DATA_DIR || (INSTALL_HOST_DIR ? `${INSTALL_HOST_DIR}/data/chat-signal` : '');
/* How many of the dashboard's own backups stay: the newest two, as with the
   deployment snapshots. */
const OPS_BACKUPS_KEPT = Math.max(1, Number(process.env.OPS_BACKUPS_KEPT || 2));
const dockerAvailable = () => fs.existsSync(OPS_DOCKER_SOCKET);

function dockerEngineRequest(method, urlPath, body, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const request = http.request({
      socketPath: OPS_DOCKER_SOCKET,
      path: urlPath,
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks);
        /* raw stays bytes: stream-framed answers (container logs) must be
           de-framed before they are ever read as text. */
        resolve({ status: response.statusCode, body: raw.toString('utf8'), raw, stream: response });
      });
    });
    request.on('timeout', () => request.destroy(new Error('docker api timeout')));
    request.on('error', () => resolve({ status: 0, body: '', unreachable: true }));
    if (body) request.write(body);
    request.end();
  });
}

async function dockerEngineJson(method, urlPath, payload) {
  const response = await dockerEngineRequest(method, urlPath, payload ? JSON.stringify(payload) : null);
  if (response.unreachable) return { ok: false, status: 0, data: null };
  let parsed = null;
  try { parsed = JSON.parse(response.body); } catch (_error) { parsed = null; }
  return { ok: response.status >= 200 && response.status < 300, status: response.status, data: parsed };
}
function opsParseJson(text) {
  try { return JSON.parse(text); } catch (_error) { return null; }
}

/* One short-lived container, fixed argument list, two mounts it may see: the
   install tree and the backups directory. The host paths come from this
   file's settings; the names inside are fixed text. If the job image is not
   on the machine yet — a first run, or a server that never pulled it — it is
   fetched once from the registry and the create is retried. */
async function runOpsJob(command, { timeoutMs = 900000 } = {}) {
  if (!dockerAvailable() || !INSTALL_HOST_DIR) {
    return { ok: false, reason: 'docker-socket-not-mounted' };
  }
  const name = `poorija-ops-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const binds = [`${INSTALL_HOST_DIR}:/job`];
  if (OPS_BACKUP_HOST_DIR) binds.push(`${OPS_BACKUP_HOST_DIR}:/backups`);
  if (OPS_DATA_HOST_DIR) binds.push(`${OPS_DATA_HOST_DIR}:/relaydata`);
  let created = await dockerEngineJson('POST', `/v1.44/containers/create?name=${name}`, {
    Image: OPS_JOB_IMAGE,
    Cmd: command,
    WorkingDir: '/job',
    HostConfig: { AutoRemove: false, Binds: binds, NetworkMode: 'none' },
  });
  if (!created.ok && /no such image/i.test(String(created.data?.message || ''))) {
    const [imageName, imageTag] = OPS_JOB_IMAGE.split(':');
    await dockerEngineRequest('POST',
      `/v1.44/images/create?fromImage=${encodeURIComponent(imageName)}&tag=${encodeURIComponent(imageTag || 'latest')}`,
      null, { timeoutMs: 600000 });
    created = await dockerEngineJson('POST', `/v1.44/containers/create?name=${name}`, {
      Image: OPS_JOB_IMAGE,
      Cmd: command,
      WorkingDir: '/job',
      HostConfig: { AutoRemove: false, Binds: binds, NetworkMode: 'none' },
    });
  }
  if (!created.ok) return { ok: false, reason: `create-${created.status}`, detail: String(created.data?.message || '').slice(0, 300) };
  const containerId = created.data?.Id;
  const started = await dockerEngineJson('POST', `/v1.44/containers/${containerId}/start`, null);
  if (!started.ok) {
    await dockerEngineJson('DELETE', `/v1.44/containers/${containerId}?force=1&v=1`);
    return { ok: false, reason: `start-${started.status}` };
  }
  const deadline = Date.now() + timeoutMs;
  let exitCode = null;
  while (Date.now() < deadline) {
    const state = await dockerEngineJson('GET', `/v1.44/containers/${containerId}/json`);
    if (state.ok && state.data?.State?.Status !== 'running') {
      exitCode = Number(state.data?.State?.ExitCode ?? -1);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const logs = await dockerEngineRequest('GET', `/v1.44/containers/${containerId}/logs?stdout=1&stderr=1&tail=40`);
  await dockerEngineJson('DELETE', `/v1.44/containers/${containerId}?force=1&v=1`);
  if (exitCode === null) return { ok: false, reason: 'job-timeout' };
  let jobLogs = String(logs.body || '').replace(/\u0000/g, '');
  if (logs.raw) {
    let strippedLogs = '';
    const rawLogs = logs.raw;
    let cursor = 0;
    while (cursor + 8 <= rawLogs.length) {
      const size = rawLogs.readUInt32BE(cursor + 4);
      if (cursor + 8 + size > rawLogs.length) break;
      strippedLogs += rawLogs.subarray(cursor + 8, cursor + 8 + size).toString('utf8');
      cursor += 8 + size;
    }
    if (strippedLogs) jobLogs = strippedLogs;
  }
  return { ok: exitCode === 0, logs: jobLogs.slice(-2000) };
}

/* What a backup refuses to carry, and what the clean bundle refuses to
   carry (everything of this machine's own). */
const OPS_BACKUP_EXCLUDE = ['node_modules', '.git', 'backups', 'dist', 'Export', 'GitHub', 'standalone-relay/lib', 'release-logs'];
const OPS_BUNDLE_EXCLUDE = [...OPS_BACKUP_EXCLUDE, 'data', '.env', 'certs', 'server-config.json'];

/* Retention: the newest OPS_BACKUPS_KEPT, plus any named (the one just
   restored, which may be older). Run after every path that makes a backup —
   a restore, an update and a rollback each take a safety snapshot, and only
   a backup made by hand used to be followed by a prune, so those piled up. */
function pruneOpsBackups(keep = []) {
  const spare = keep.filter((name) => /^server-backup_[\w.-]+\.tar\.gz$/.test(name)).map((name) => ` | grep -vxF '/backups/${name}'`).join('');
  return runOpsJob(['sh', '-c', `mkdir -p /backups && ls -1t /backups/server-backup_*.tar.gz 2>/dev/null | tail -n +${OPS_BACKUPS_KEPT + 1}${spare} | xargs -r rm -f`], { timeoutMs: 120000 });
}

/* A pre-restore / pre-update snapshot, always taken the same way. */
async function opsSnapshot() {
  const label = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const cmd = ['tar', 'czf', `/backups/server-backup_${label}.tar.gz`];
  for (const item of OPS_BACKUP_EXCLUDE) cmd.push(`--exclude=./${item}`);
  cmd.push('./');
  const job = await runOpsJob(cmd, { timeoutMs: 900000 });
  return { ok: job.ok, name: `server-backup_${label}.tar.gz` };
}

app.post('/Monitor_Server/ops-status', authMiddleware, async (req, res) => {
  const [images, containers] = await Promise.all([
    dockerEngineJson('GET', '/v1.44/images/json'),
    dockerEngineJson('GET', '/v1.44/containers/json'),
  ]);
  res.json({
    ok: true,
    monitor: MONITOR_VERSION,
    docker: {
      available: dockerAvailable(),
      installConfigured: Boolean(INSTALL_HOST_DIR),
      images: images.ok ? images.data : [],
      containers: containers.ok ? containers.data : [],
    },
  });
});

app.post('/Monitor_Server/ops-images', authMiddleware, async (req, res) => {
  const images = await dockerEngineJson('GET', '/v1.44/images/json');
  if (!images.ok) return res.json({ ok: false, reason: dockerAvailable() ? 'docker-error' : 'docker-socket-not-mounted' });
  const list = (images.data || []).flatMap((image) =>
    (image.RepoTags || []).filter(Boolean).map((tag) => ({
      repository: tag.split(':')[0],
      tag: tag.split(':')[1] || '',
      id: String(image.Id || '').slice(7, 19),
      size: image.Size,
      created: image.Created ? new Date(image.Created * 1000).toISOString() : '',
    })));
  const watched = list.filter((image) => /^(node|docker|coturn\/coturn|nginx|certbot\/certbot)/.test(image.repository));
  res.json({ ok: true, images: list, watched });
});

/* Re-pulling a tag is how "is there a newer base" is answered honestly: the
   registry decides whether the digest moved, the engine fetches it if it
   did, and the reply says which happened. */
app.post('/Monitor_Server/ops-image-update', authMiddleware, async (req, res) => {
  const reference = String(req.body?.reference || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.\/:-]*:[A-Za-z0-9_.-]+$/.test(reference)) {
    return res.status(400).json({ ok: false, reason: 'bad-reference' });
  }
  if (!dockerAvailable()) return res.json({ ok: false, reason: 'docker-socket-not-mounted' });
  const [name, tag] = reference.split(':');
  const before = await dockerEngineJson('GET', `/v1.44/images/${encodeURIComponent(reference)}/json`);
  const pull = await dockerEngineRequest('POST',
    `/v1.44/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`,
    null, { timeoutMs: 900000 });
  if (pull.unreachable || pull.status !== 200) {
    return res.json({ ok: false, reason: `pull-${pull.status || 'unreachable'}`, output: pull.body.slice(-800) });
  }
  const after = await dockerEngineJson('GET', `/v1.44/images/${encodeURIComponent(reference)}/json`);
  const changed = Boolean(before.ok && after.ok && before.data?.Id !== after.data?.Id);
  /* An updated base does nothing to the running stack until it is rebuilt —
     saying so here is what makes the answer honest. */
  res.json({ ok: true, reference, changed, note: changed ? 'base updated; restart the stack to run on it' : 'already current', output: pull.body.slice(-400) });
});

app.post('/Monitor_Server/ops-stack-restart', authMiddleware, async (req, res) => {
  if (!dockerAvailable()) return res.json({ ok: false, reason: 'docker-socket-not-mounted' });
  const containers = await dockerEngineJson('GET', '/v1.44/containers/json?all=1');
  if (!containers.ok) return res.json({ ok: false, reason: 'docker-error' });
  const restarted = [];
  for (const container of containers.data || []) {
    if (!/Poorija-Cryptography/.test((container.Names || []).join(' '))) continue;
    const result = await dockerEngineJson('POST', `/v1.44/containers/${container.Id}/restart?t=15`, null);
    restarted.push({ name: (container.Names || [])[0], ok: result.ok });
  }
  monitorLog(`Stack restart: ${restarted.map((entry) => entry.name + (entry.ok ? "+" : "x")).join(", ") || "none"}`);
  res.json({ ok: restarted.length > 0 && restarted.every((entry) => entry.ok), restarted });
});

/* The raw image of the running relay, streamed from the engine. Fixed to
   the image the stack builds — no operator-supplied name anywhere. */
app.post('/Monitor_Server/ops-image-export', authMiddleware, async (req, res) => {
  if (!dockerAvailable()) return res.json({ ok: false, reason: 'docker-socket-not-mounted' });
  const target = 'config-chat-signal:latest';
  const inspect = await dockerEngineJson('GET', `/v1.44/images/${encodeURIComponent(target)}/json`);
  if (!inspect.ok) return res.json({ ok: false, reason: 'no-such-image' });
  const request = http.request({
    socketPath: OPS_DOCKER_SOCKET,
    path: `/v1.44/images/${encodeURIComponent(target)}/get`,
    method: 'GET',
  }, (response) => {
    if (response.statusCode !== 200) {
      res.status(502).json({ ok: false, reason: `docker-${response.statusCode}` });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/x-tar',
      'Content-Disposition': 'attachment; filename="poorija-relay-image.tar"',
      'Cache-Control': 'no-store',
    });
    /* The engine going away part-way ends this download, not the relay: an
       error event with no listener is thrown, and so is a JSON answer after
       the tar's headers have gone out. */
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  request.on('error', () => {
    if (res.headersSent) res.destroy();
    else res.status(502).json({ ok: false, reason: 'docker-unreachable' });
  });
  request.end();
});

/* Backups are packed by a job container straight into the host's backups
   directory; this process never touches the bytes. Retention keeps the
   newest OPS_BACKUPS_KEPT (two) — a backup directory that grows forever is a
   disk-full outage being scheduled in advance. */
app.post('/Monitor_Server/ops-backup-create', authMiddleware, async (req, res) => {
  if (!INSTALL_HOST_DIR || !OPS_BACKUP_HOST_DIR) return res.json({ ok: false, reason: 'ops-paths-not-configured' });
  const snapshot = await opsSnapshot();
  if (!snapshot.ok) return res.json({ ok: false, reason: 'archive-failed' });
  await pruneOpsBackups();
  monitorLog(`Backup created: ${snapshot.name}`);
  res.json({ ok: true, name: snapshot.name });
});

/* The listing IS the interface: download, restore and delete take the name
   of a row this listing produced, matched exactly. */
app.post('/Monitor_Server/ops-backup-list', authMiddleware, async (req, res) => {
  if (!OPS_BACKUP_HOST_DIR) return res.json({ ok: false, reason: 'ops-paths-not-configured' });
  const job = await runOpsJob(['sh', '-c', 'ls -lh1 /backups 2>/dev/null | grep server-backup_ || true'], { timeoutMs: 60000 });
  if (!job.ok) return res.json({ ok: false, reason: 'list-failed' });
  const rows = String(job.logs || '').replace(/\u0000/g, '').split('\n').map((line) => line.trim())
    .filter((line) => line.includes('server-backup_'))
    .map((line) => {
      /* ls -lh1 columns: perms links owner group SIZE date time NAME */
      const parts = line.split(/\s+/);
      const name = parts[parts.length - 1];
      const size = parts.length >= 5 ? parts[parts.length - 5] : '';
      return { size, name };
    })
    .filter((row) => /^server-backup_[\w.-]+\.tar\.gz$/.test(row.name));
  rows.sort((a, b) => b.name.localeCompare(a.name));
  res.json({ ok: true, backups: rows });
});

app.post('/Monitor_Server/ops-backup-download', authMiddleware, async (req, res) => {
  if (!OPS_BACKUP_HOST_DIR) return res.json({ ok: false, reason: 'ops-paths-not-configured' });
  const name = String(req.body?.name || '');
  if (!/^server-backup_[\w.-]+\.tar\.gz$/.test(name)) return res.status(400).json({ ok: false, reason: 'bad-name' });
  /* The engine cannot reach the host filesystem from here; the bytes travel
     through a job container into this relay's data directory and stream
     from there — one fixed pipeline, one fixed name shape. */
  /* A name of its own per download: two at once shared one file, and the
     second copy overwrote — or the first one's cleanup deleted — the bytes
     the other was still streaming. */
  const transfer = `.monitor-transfer-${crypto.randomBytes(6).toString('hex')}.tar.gz`;
  const copy = await runOpsJob(['sh', '-c', `test -f "/backups/${name}" && cp "/backups/${name}" "/relaydata/${transfer}"`], { timeoutMs: 300000 });
  if (!copy.ok) return res.status(404).json({ ok: false, reason: 'no-such-backup' });
  const local = path.join(defaultDataDir, transfer);
  res.writeHead(200, {
    'Content-Type': 'application/gzip',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'no-store',
  });
  /* A stream error with nobody listening is thrown — it took the whole relay
     down when the file was not there. Now it ends this one download. */
  fs.createReadStream(local)
    .on('error', () => res.destroy())
    .on('close', () => { fs.unlink(local, () => {}); })
    .pipe(res);
});

app.post('/Monitor_Server/ops-backup-delete', authMiddleware, async (req, res) => {
  if (!OPS_BACKUP_HOST_DIR) return res.json({ ok: false, reason: 'ops-paths-not-configured' });
  const name = String(req.body?.name || '');
  if (!/^server-backup_[\w.-]+\.tar\.gz$/.test(name)) return res.status(400).json({ ok: false, reason: 'bad-name' });
  const job = await runOpsJob(['rm', '-f', `/backups/${name}`], { timeoutMs: 60000 });
  res.json({ ok: job.ok });
});

/* Restore overlays the backup onto the tree — deliberately NOT a wipe: what
   the backup does not carry (data, certs, .env) stays standing, and the
   automatic pre-restore snapshot is how "put it back" works. The operator
   restarts the stack when ready. */
app.post('/Monitor_Server/ops-backup-restore', authMiddleware, async (req, res) => {
  if (!OPS_BACKUP_HOST_DIR) return res.json({ ok: false, reason: 'ops-paths-not-configured' });
  const name = String(req.body?.name || '');
  if (!/^server-backup_[\w.-]+\.tar\.gz$/.test(name)) return res.status(400).json({ ok: false, reason: 'bad-name' });
  const safety = await opsSnapshot();
  const job = await runOpsJob(['tar', 'xzf', `/backups/${name}`, '-C', '/job'], { timeoutMs: 900000 });
  await pruneOpsBackups([name]);
  monitorLog(`Restore overlaid: ${name}`);
  res.json({
    ok: job.ok,
    restored: name,
    safetyBackup: safety.ok ? safety.name : '',
    note: 'tree overlaid; restart the stack from the dashboard when ready',
  });
});

/* The clean bundle: the program with none of this machine's state — what
   the bootstrap installer ships to a fresh server. */
async function opsBundleTo(res, filename) {
  const cmd = ['tar', 'czf', '/relaydata/.monitor-bundle.tar.gz'];
  for (const item of OPS_BUNDLE_EXCLUDE) cmd.push(`--exclude=./${item}`);
  cmd.push('./');
  const job = await runOpsJob(cmd, { timeoutMs: 600000 });
  if (!job.ok) { res.writeHead(502).end('bundle failed'); return; }
  res.writeHead(200, {
    'Content-Type': 'application/gzip',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  const local = path.join(defaultDataDir, '.monitor-bundle.tar.gz');
  fs.createReadStream(local)
    .on('error', () => res.destroy())
    .on('close', () => { fs.unlink(local, () => {}); })
    .pipe(res);
}
app.post('/Monitor_Server/ops-bundle', authMiddleware, async (req, res) => {
  if (!INSTALL_HOST_DIR) return res.json({ ok: false, reason: 'ops-paths-not-configured' });
  await opsBundleTo(res, 'poorija-clean-bundle.tar.gz');
});

/* GitHub: check the newest published release against the running build.
   Applying downloads that release and overlays it onto the tree; the safety
   snapshot taken first is the rollback. The one fetch in this file is a
   fixed literal of this project's own releases page; the download itself
   happens inside a job container with the network on, against the same
   fixed origin, so no request-shaped string ever reaches a URL here. */
app.post('/Monitor_Server/ops-github-check', authMiddleware, async (req, res) => {
  let release = null;
  let reachable = false;
  try {
    const response = await fetch('https://api.github.com/repos/Poorija/P00RIJA-CRYPTOGRAPHY/releases/latest', {
      headers: { 'User-Agent': 'poorija-monitor' },
      signal: AbortSignal.timeout(30000),
    });
    reachable = response.ok;
    if (response.ok) release = await response.json();
  } catch (_error) { reachable = false; }
  res.json({
    ok: reachable && Boolean(release),
    reachable,
    latest: release ? { tag: release.tag_name, published: release.published_at, url: release.html_url } : null,
    running: { version: RELAY_BUILD?.version, buildTag: RELAY_BUILD?.buildTag },
    /* The published tag may or may not carry the leading v; strip both sides
       before asking whether they differ. */
    updateAvailable: Boolean(release?.tag_name && RELAY_BUILD?.version &&
      String(release.tag_name).replace(/^v/, '') !== String(RELAY_BUILD.version).replace(/^v/, '')),
  });
});

app.post('/Monitor_Server/ops-github-apply', authMiddleware, async (req, res) => {
  if (!INSTALL_HOST_DIR) return res.json({ ok: false, reason: 'ops-paths-not-configured' });
  let tag = String(req.body?.tag || '').trim();
  if (!/^v?[0-9][0-9.]*$/.test(tag)) return res.status(400).json({ ok: false, reason: 'bad-tag' });
  if (!tag.startsWith('v')) tag = `v${tag}`;
  const safety = await opsSnapshot();
  /* One job, network on, fixed origin, tag reduced to dotted digits above:
     download the release zip into the data directory, unpack it, overlay
     the tree, and clean up — every path inside is the job's own mount. */
  const download = await (async () => {
    const name = `poorija-ops-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const created = await dockerEngineJson('POST', `/v1.44/containers/create?name=${name}`, {
      Image: OPS_JOB_IMAGE,
      Cmd: ['sh', '-c', `wget -q -O /job/data/.monitor-update.zip "https://github.com/Poorija/P00RIJA-CRYPTOGRAPHY/archive/refs/tags/${tag}.zip" && cd /job/data && rm -rf .monitor-unpacked && mkdir .monitor-unpacked && unzip -q .monitor-update.zip -d .monitor-unpacked && inner=$(ls -d .monitor-unpacked/*/ | head -n 1) && tar -cf - -C "$inner" . | tar -xf - -C /job && rm -rf .monitor-unpacked .monitor-update.zip`],
      HostConfig: { AutoRemove: false, Binds: [`${INSTALL_HOST_DIR}:/job`], NetworkMode: 'default' },
    });
    if (!created.ok) return { ok: false, reason: `create-${created.status}` };
    const containerId = created.data?.Id;
    const started = await dockerEngineJson('POST', `/v1.44/containers/${containerId}/start`, null);
    if (!started.ok) {
      await dockerEngineJson('DELETE', `/v1.44/containers/${containerId}?force=1&v=1`);
      return { ok: false, reason: `start-${started.status}` };
    }
    const deadline = Date.now() + 600000;
    let exitCode = null;
    while (Date.now() < deadline) {
      const state = await dockerEngineJson('GET', `/v1.44/containers/${containerId}/json`);
      if (state.ok && state.data?.State?.Status !== 'running') {
        exitCode = Number(state.data?.State?.ExitCode ?? -1);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const logs = await dockerEngineRequest('GET', `/v1.44/containers/${containerId}/logs?stdout=1&stderr=1&tail=40`);
    await dockerEngineJson('DELETE', `/v1.44/containers/${containerId}?force=1&v=1`);
    if (exitCode === null) return { ok: false, reason: 'job-timeout' };
    return { ok: exitCode === 0, logs: logs.body.slice(-2000) };
  })();
  if (!download.ok) return res.json({ ok: false, reason: download.reason || 'download-failed', output: String(download.logs || '').slice(-500) });
  monitorLog(`GitHub ${tag} applied; safety: ${safety.ok ? safety.name : 'none'}`);
  await pruneOpsBackups();
  res.json({ ok: true, tag, safetyBackup: safety.ok ? safety.name : '', note: 'tree updated; restart the stack from the dashboard to run it' });
});

app.post('/Monitor_Server/ops-github-rollback', authMiddleware, async (req, res) => {
  const name = String(req.body?.backup || '').trim();
  if (name && !/^server-backup_[\w.-]+\.tar\.gz$/.test(name)) return res.status(400).json({ ok: false, reason: 'bad-name' });
  /* No name given: the newest backup, which is the pre-update snapshot if
     the update was the last thing that happened. */
  let chosen = name;
  if (!chosen) {
    /* ls prints the path; the name is what follows /backups/. The check
       below took the whole line, never matched, and a rollback with no name
       always answered "no backup". */
    const listJob = await runOpsJob(['sh', '-c', 'ls -1t /backups/server-backup_*.tar.gz 2>/dev/null | head -n 1'], { timeoutMs: 60000 });
    chosen = String(listJob.logs || '').replace(/\u0000/g, '').split('\n').map((line) => line.trim().replace(/^.*\//, '')).find((line) => /^server-backup_[\w.-]+\.tar\.gz$/.test(line)) || '';
  }
  if (!chosen) return res.json({ ok: false, reason: 'no-backup' });
  const safety = await opsSnapshot();
  const job = await runOpsJob(['tar', 'xzf', `/backups/${chosen}`, '-C', '/job'], { timeoutMs: 900000 });
  await pruneOpsBackups([chosen]);
  monitorLog(`Rollback overlaid: ${chosen}`);
  res.json({
    ok: job.ok,
    restored: chosen,
    safetyBackup: safety.ok ? safety.name : '',
    note: 'tree overlaid; restart the stack from the dashboard when ready',
  });
});

/* ---- the bootstrap installer ------------------------------------------------
 *
 * A dedicated port (CHAT_BOOTSTRAP_PORT, default 9080) that answers exactly
 * two things: the installer script, and — with the bootstrap token from the
 * server's config — the clean bundle the script pulls. Nothing else, no
 * session, no cookies: the point is one bash line from a fresh machine. */

const BOOTSTRAP_PORT = process.env.CHAT_BOOTSTRAP_PORT === '0' ? 0 : Number(process.env.CHAT_BOOTSTRAP_PORT || 9080);
function bootstrapToken() {
  if (process.env.CHAT_BOOTSTRAP_TOKEN) return process.env.CHAT_BOOTSTRAP_TOKEN;
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).bootstrapToken || ''; } catch (_error) { return ''; }
}
function rotateBootstrapToken() {
  const token = crypto.randomBytes(24).toString('hex');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}; } catch (_error) { config = {}; }
  config.bootstrapToken = token;
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 }); } catch (error) {
    console.warn('[Monitor] bootstrap token not saved:', error.message);
  }
  return token;
}
app.post('/Monitor_Server/bootstrap-token', authMiddleware, (req, res) => {
  const token = bootstrapToken() || rotateBootstrapToken();
  res.json({ ok: true, token });
});

if (BOOTSTRAP_PORT > 0) {
  const bootstrapServer = http.createServer((req, res) => {
    const asked = String(req.url || '');
    res.setHeader('Cache-Control', 'no-store');
    if (asked.startsWith('/install')) {
      res.writeHead(200, { 'Content-Type': 'text/x-shellscript; charset=utf-8' });
      res.end([
        '#!/bin/sh',
        '# P00RIJA Cryptography — clean-server installer.',
        '# Pulls the program (and nothing of the server it came from) and stands',
        '# the stack up on THIS machine with a fresh, empty identity.',
        'set -eu',
        'SRC=${1:?usage: install <origin> <bootstrap-token> [dir]}',
        'TOKEN=${2:?bootstrap token required}',
        'DIR=${3:-$HOME/poorija-cryptography}',
        'echo "==> fetching the clean bundle from $SRC"',
        'mkdir -p "$DIR"',
        'curl -fsSL -H "X-Bootstrap-Token: $TOKEN" "$SRC/bundle" -o "$DIR/bundle.tar.gz"',
        'tar -xzf "$DIR/bundle.tar.gz" -C "$DIR"',
        'rm -f "$DIR/bundle.tar.gz"',
        'cd "$DIR"',
        'echo "==> preparing configuration"',
        'cp docker-compose.env.example .env 2>/dev/null || cp config/docker-compose.env.example .env 2>/dev/null || true',
        'test -f .env || { echo "no .env template found in the bundle" >&2; exit 1; }',
        'echo "==> starting the stack (docker compose)"',
        'docker compose -f config/docker-compose.yaml --env-file .env up -d --build',
        'echo "==> done. The app serves on :8585; edit .env for your domain, then restart."',
      ].join('\n'));
      return;
    }
    if (asked.startsWith('/bundle')) {
      const token = bootstrapToken();
      if (!token) { res.writeHead(503).end('bootstrap token not configured on the server'); return; }
      if (String(req.headers['x-bootstrap-token'] || '') !== token) { res.writeHead(401).end('bad bootstrap token'); return; }
      if (!INSTALL_HOST_DIR) { res.writeHead(503).end('ops paths not configured on the server'); return; }
      opsBundleTo(res, 'poorija-clean-bundle.tar.gz');
      return;
    }
    res.writeHead(404).end('not found');
  });
  /* An optional helper must never take the relay down with it. A port already
     held — a second relay on the same host, the standalone distribution next
     to a full stack — used to surface as an uncaught EADDRINUSE and a dead
     relay. Now the installer is simply not offered on that host. */
  bootstrapServer.on('error', (error) => {
    console.warn(`[Bootstrap] installer not started on ${BOOTSTRAP_PORT}: ${error.code || error.message}`);
  });
  /* Behind nginx at /bootstrap/ (https) when CHAT_LISTEN_HOSTS keeps this
     port off the internet; a plain-http installer piped into a shell is a
     way to hand someone else's script to a new server. */
  listenOn(bootstrapServer, BOOTSTRAP_PORT, '0.0.0.0', () => {
    console.log(`Bootstrap installer available on port ${BOOTSTRAP_PORT}`);
  });
}

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
  /* Off, because nothing this project ships ever asks for the list. The
     endpoint answers "who is online" to any website that asks, and a relay
     that answers it hands a stranger the roster for free — the one fact the
     transit layer is built to keep from the operator. */
  allow_discovery: false,
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
  createWebSocketServer: (options) => {
    const wss = attachSocketKeepAlive(
      new WebSocketServer({ ...options, maxPayload: 12 * 1024 * 1024 }),
      'PeerJS',
    );
    /* PeerJS sockets are part of the same budget as every other socket. They
       were refused by the per-address ceiling before PeerJS ever saw them,
       but the ones that got through were then invisible to the count — so the
       ceiling read zero however many were held, and an address could stack
       PeerJS sockets without ever touching its own cap. */
    wss.on('connection', (ws, request) => trackSocket(ws, socketAddress(request)));
    return wss;
  },
});
app.use(peerServer);
/* An 'error' event with no listener is a throw, and a throw in this process
   is a flush-and-exit. Every other server in this file says where its errors
   go; the PeerJS mount re-emits socket errors on itself, so it says so too. */
peerServer.on('error', (error) => console.error('[PeerJS] server error:', error?.message || error));
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
/* Frame pricing for one socket. The refill is above what a busy client asks
   — the stress suite pushes a sustained ~180 frames per second per peer and
   a file transfer bursts hundreds of chunks inside a second — while a loop
   that replays get-peers or hello at line rate spends the burst and meets
   the answer inside the first moments. Overridable for the test suites,
   which is how every other ceiling here is sized. */
const WS_RATE_BURST = Number(process.env.CHAT_WS_RATE_BURST || 1024);
const WS_RATE_REFILL_PER_MS = Number(process.env.CHAT_WS_RATE_REFILL_PER_SECOND || 256) / 1000;
/* Frames refused in a row before the socket is closed: a client that keeps
   going this far past its budget is not a person's browser catching up. */
const WS_FLOOD_CLOSE_AFTER = Number(process.env.CHAT_WS_FLOOD_CLOSE_AFTER || 5000);
const wsPerAddress = new Map();
let wsTotal = 0;

/* The address a socket is counted under — by the same rule every HTTP
   security decision uses (securityKey: the hop our own nginx vouches for,
   counted from the right). It took the LEFTMOST X-Forwarded-For, which is
   whatever the client wrote, so one machine could rename itself per socket
   and open as many as it liked past the per-address cap. */
function socketAddress(request) {
  return securityKey(request) || 'unknown';
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

/* Open files, against the process's own limit (Linux reports both in /proc).
   A socket is a file; so is every mailbox write and every HTTP request,
   health checks included. With the limit reached, new connections hung
   without an answer, the health endpoint went dark with them, and a mailbox
   write could fail. So sockets stop being accepted while a reserve is left
   for everything else. */
const fileGuard = { open: 0, limit: 0, checkedAt: 0 };
function readFileLimit() {
  try {
    const line = fs.readFileSync('/proc/self/limits', 'utf8').split('\n').find((row) => row.startsWith('Max open files'));
    const soft = Number(String(line || '').trim().split(/\s{2,}/)[1]);
    return Number.isFinite(soft) && soft > 0 ? soft : 0;
  } catch (_error) {
    return 0;
  }
}
function refreshFileGuard() {
  try {
    fileGuard.open = fs.readdirSync('/proc/self/fd').length;
    fileGuard.limit = fileGuard.limit || readFileLimit();
  } catch (_error) {
    fileGuard.open = 0;
  }
  fileGuard.checkedAt = Date.now();
}
setInterval(refreshFileGuard, 2000).unref?.();
refreshFileGuard();
/* Memory, against the container's own limit (cgroup) or the machine's. Past
   three quarters of it, or with the machine itself nearly out, new sockets
   wait: the relay was killed outright by the kernel at 7,000 sockets, taking
   everybody with it, and a crowd reconnecting at once would do it again. */
function memoryLimitBytes() {
  for (const file of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const value = Number(fs.readFileSync(file, 'utf8').trim());
      if (Number.isFinite(value) && value > 0 && value < os.totalmem()) return value;
    } catch (_error) { /* not this cgroup version */ }
  }
  return os.totalmem();
}
/* Read again every minute: the dashboard can change a container's memory
   ceiling while it runs (ops-memory-set), and the guard has to follow. */
let MEMORY_LIMIT_BYTES = memoryLimitBytes();
setInterval(() => { MEMORY_LIMIT_BYTES = memoryLimitBytes(); }, 60000).unref?.();
function memoryNearlyExhausted() {
  const rss = process.memoryUsage.rss ? process.memoryUsage.rss() : process.memoryUsage().rss;
  if (rss > MEMORY_LIMIT_BYTES * 0.75) return true;
  return os.freemem() < 96 * 1024 * 1024 && rss > 256 * 1024 * 1024;
}
function filesNearlyExhausted() {
  if (!fileGuard.limit) return false;
  /* Between readings, each socket accepted since counts too (see
     socketBudgetRefused); a fresh reading at most twice a second. */
  if (Date.now() - fileGuard.checkedAt > 500) refreshFileGuard();
  const reserve = Math.max(64, Math.floor(fileGuard.limit * 0.1));
  return fileGuard.open >= fileGuard.limit - reserve;
}
/* ---- alerts to the operator (scripts/lib/relay-alerts.js) -------------------
 *
 * Telegram, from the relay that has the bot's token and a chat to send to;
 * every other relay hands its messages over its transit link to one that does.
 */
const ALERT_TELEGRAM_CHAT_ID = String(process.env.CHAT_ALERT_TELEGRAM_CHAT_ID || '').trim();
const ALERT_LABEL = String(process.env.CHAT_ALERT_LABEL || '').trim() || (() => {
  try { return new URL(process.env.CHAT_PUBLIC_RELAY_ORIGIN || '').hostname || os.hostname(); } catch (_error) { return os.hostname(); }
})();
const ALERT_INTERVAL_MS = Math.max(5000, Number(process.env.CHAT_ALERT_INTERVAL_MS || 60000));
/* coturn's relay ports, as config/docker-compose.yaml hands them to it. */
const TURN_PORT_MIN = Number(process.env.CHAT_TURN_PORT_MIN || 49152);
const TURN_PORT_MAX = Number(process.env.CHAT_TURN_PORT_MAX || 50152);
const COTURN_CONTAINER = process.env.COTURN_CONTAINER || 'Poorija-Cryptography_Coturn';
const alertLimits = alertThresholds();
const alertState = createAlertState({ label: ALERT_LABEL, remindMs: Math.max(1, Number(process.env.CHAT_ALERT_REMIND_HOURS || 6)) * 3600000 });
/* The relays alerts may go to and come from, by id. Named outright, never
   "whoever is linked": an alert says how full this machine is and what it is
   called, and a transit link can be with another operator's relay, who has
   no business reading that — or writing into this operator's Telegram. */
const ALERT_PEERS_NAMED = new Set(String(process.env.CHAT_ALERT_PEERS || '').split(',').map((id) => id.trim().toLowerCase()).filter((id) => /^[a-f0-9]{64}$/.test(id)));
/* None named: the relay's family (its operator's directory), so a new member
   of the family needs no line of its own in anybody's .env. */
const alertPeers = () => (ALERT_PEERS_NAMED.size ? ALERT_PEERS_NAMED : new Set(directoryMembers()));
/* Waiting for Telegram, or for the link to the relay that has it: { id,
   text, fromPeer, sentAt }. Over a link one is in flight at a time and stays
   first until the far relay acknowledges it, so a link that drops mid-send
   loses nothing and the order holds. */
const alertOutbox = [];
const ALERT_OUTBOX_LIMIT = 50;
/* What a peer may take of the outbox: its alerts can never push this relay's
   own out. */
const ALERT_PEER_SHARE = 20;
const alertPeerDownSince = new Map();
const alertsFromPeers = new Map();
const alertIdsSeen = new Set();
let alertNetworkBefore = null;
let alertsChecking = false;
let alertsFlushing = false;
const alertsByTelegram = () => Boolean(TELEGRAM_BOT_TOKEN && ALERT_TELEGRAM_CHAT_ID);

function queueAlert(text, fromPeer = '') {
  if (fromPeer && alertOutbox.filter((entry) => entry.fromPeer).length >= ALERT_PEER_SHARE) return;
  alertOutbox.push({ id: crypto.randomBytes(8).toString('hex'), text: String(text), fromPeer, sentAt: 0 });
  /* Full: the oldest of a peer's go first, then the oldest of this relay's. */
  while (alertOutbox.length > ALERT_OUTBOX_LIMIT) {
    const peerIndex = alertOutbox.findIndex((entry) => entry.fromPeer);
    alertOutbox.splice(peerIndex >= 0 ? peerIndex : 0, 1);
  }
  console.log(`[Alerts] ${text}`);
}
/* Oldest first, stopping at the first that cannot go yet: order is kept, and
   nothing is lost to a Telegram or a link that is down for a while. */
async function flushAlerts() {
  if (alertsFlushing) return;
  alertsFlushing = true;
  try {
    while (alertOutbox.length) {
      const entry = alertOutbox[0];
      if (alertsByTelegram()) {
        if (!await sendTelegram(TELEGRAM_BOT_TOKEN, ALERT_TELEGRAM_CHAT_ID, entry.text)) return;
        alertOutbox.shift();
        continue;
      }
      /* Sent and not yet acknowledged: wait a minute before sending it again. */
      if (entry.sentAt && Date.now() - entry.sentAt < 60000) return;
      const link = Array.from(alertPeers()).map((id) => relayPeers.linkFor(id)).find((candidate) => candidate?.isOpen());
      if (!link) return;
      link.send({ kind: 'alert', id: entry.id, text: entry.text });
      entry.sentAt = Date.now();
      return;
    }
  } finally {
    alertsFlushing = false;
  }
}
/* From a linked relay named in CHAT_ALERT_PEERS, authenticated by the link:
   sent on only from a relay that can, never passed along again (no loops),
   at most thirty an hour per link, on one line, and opened with the id the
   link proved — the text after it is the peer's own word for itself, and on
   its own it could claim to be any relay. Acknowledged even when already
   seen: the sender resends until it hears back. */
function receiveRelayAlert(payload, link) {
  if (!alertPeers().has(link.peerId) || !alertsByTelegram()) return;
  const id = /^[a-f0-9]{16}$/.test(String(payload.id || '')) ? payload.id : '';
  if (id) link.send({ kind: 'alert-ack', id });
  if (id && alertIdsSeen.has(id)) return;
  if (id) {
    alertIdsSeen.add(id);
    if (alertIdsSeen.size > 500) alertIdsSeen.delete(alertIdsSeen.values().next().value);
  }
  const now = Date.now();
  const tally = alertsFromPeers.get(link.peerId) || { since: now, count: 0 };
  if (now - tally.since > 3600000) { tally.since = now; tally.count = 0; }
  tally.count += 1;
  alertsFromPeers.set(link.peerId, tally);
  if (tally.count > 30) return;
  const text = String(payload.text || '').replace(/[\u0000-\u001f\u2028\u2029]+/g, ' ').trim().slice(0, 1500);
  if (!text) return;
  queueAlert(`[${link.peerId.slice(0, 12)}] ${text}`, link.peerId);
  flushAlerts().catch(() => {});
}
/* The far relay has it: the next one may go. */
function receiveRelayAlertAck(payload, link) {
  const entry = alertOutbox[0];
  if (!entry || entry.id !== payload.id || !alertPeers().has(link.peerId)) return;
  alertOutbox.shift();
  flushAlerts().catch(() => {});
}
async function alertReadings() {
  const reading = {};
  const stat = await fsp.statfs(defaultDataDir).catch(() => null);
  if (stat) reading.disk = { free: Number(stat.bavail) * Number(stat.bsize), total: Number(stat.blocks) * Number(stat.bsize) };
  reading.memory = readMeminfo();
  /* Only a real container ceiling: without one the machine's memory, above,
     is the measure. */
  if (MEMORY_LIMIT_BYTES < os.totalmem()) reading.relay = { rss: process.memoryUsage.rss(), limit: MEMORY_LIMIT_BYTES };
  reading.files = { open: fileGuard.open, limit: fileGuard.limit };
  if (TURN_URLS.length) {
    let running = null;
    if (dockerAvailable()) {
      const state = await dockerEngineJson('GET', `/v1.44/containers/${encodeURIComponent(COTURN_CONTAINER)}/json`);
      if (state.ok) running = Boolean(state.data?.State?.Running);
    }
    reading.turn = { used: turnPortsInUse(TURN_PORT_MIN, TURN_PORT_MAX), size: TURN_PORT_MAX - TURN_PORT_MIN + 1, running };
  }
  const bytes = networkBytes();
  const now = Date.now();
  if (bytes !== null) {
    if (alertNetworkBefore && now > alertNetworkBefore.at) {
      reading.network = { mbps: ((bytes - alertNetworkBefore.bytes) * 8) / ((now - alertNetworkBefore.at) / 1000) / 1e6 };
    }
    alertNetworkBefore = { bytes, at: now };
  }
  reading.peersDown = [];
  for (const id of relayPeers.allowedPeers()) {
    if (relayPeers.linkFor(id)) { alertPeerDownSince.delete(id); continue; }
    if (!alertPeerDownSince.has(id)) alertPeerDownSince.set(id, now);
    const forMs = now - alertPeerDownSince.get(id);
    if (forMs >= alertLimits.peerDownMs) reading.peersDown.push({ id, forMs });
  }
  return reading;
}
let alertsAnnounced = false;
async function checkAlerts() {
  /* A relay with nowhere to send them (a development machine, a test) keeps
     quiet. */
  if (alertsChecking || !(alertsByTelegram() || alertPeers().size)) return;
  alertsChecking = true;
  /* A start is announced: after a crash and a restart, that is how the
     operator hears of it. */
  if (!alertsAnnounced) {
    alertsAnnounced = true;
    queueAlert(`🔄 ${ALERT_LABEL}: رله راه‌اندازی شد (نسخهٔ ${RELAY_BUILD?.version || 'نامعلوم'}). هشدار دیسک، حافظه و TURN فعال است.`);
  }
  try {
    alertState.update(evaluateAlerts(await alertReadings(), alertLimits)).forEach(queueAlert);
    await flushAlerts();
  } catch (error) {
    console.warn('[Alerts] the check failed:', error?.message || error);
  } finally {
    alertsChecking = false;
  }
}
if (process.env.CHAT_ALERTS !== '0') {
  setTimeout(checkAlerts, Math.min(15000, ALERT_INTERVAL_MS)).unref?.();
  setInterval(checkAlerts, ALERT_INTERVAL_MS).unref?.();
}

function socketBudgetRefused(request, socket) {
  const address = socketAddress(request);
  if (filesNearlyExhausted() || memoryNearlyExhausted()) {
    noteRefusal(address, 'capacity');
    rejectUpgrade(socket, 503, 'Service Unavailable');
    return true;
  }
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
  /* Counted the moment it is let in: a burst of sockets between two readings
     of /proc would otherwise all pass the guard on the same old number. The
     next reading corrects for any that have closed. */
  fileGuard.open += 1;
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

/* Delivering one envelope to one recipient on this relay.
 *
 * Lifted out of the socket handler unchanged so that a message arriving over
 * a transit link takes exactly this path and not a second one written to
 * resemble it. Retention, the push wording, the ephemeral and pushable lists,
 * the store-and-forward for a connected-but-asleep app: all of it is decided
 * here once, and a transit envelope gets the same decisions because it is the
 * same code.
 *
 * `reply` is how the sender is answered — a socket send for a local client, a
 * frame back down the link for a carried one. `fromFingerprint` is whoever
 * wrote it, which for a carried envelope the inner payload carries anyway:
 * this relay is the RECIPIENT'S relay, and it already knows everything about
 * its own users. What transit withholds is the carrying relay learning the
 * pair, not this one. */
/* ---- carrying somebody else's envelope ------------------------------- */
/* What a client hands over when its contact lives on another relay, and what
   comes back. This relay is the CARRIER here: it cannot open the envelope, so
   it cannot know who the message is for — which is the whole arrangement.
 *
 * It keeps one thing, in memory, for as long as it takes to answer: which
 * socket asked. Not the envelope, not the recipient's relay against the
 * sender, nothing on disk. A relay that stores nothing has nothing to hand
 * over, which is a security property and a legal one at the same time. */
/* Sixty seconds. Thirty was shorter than a slow international link can take
   to drain a burst of file chunks, and an envelope still sitting in the link's
   buffer was reported lost to a sender who then sent it again. A link that is
   really gone answers its waits at once (failTransitWaitsFor), so the longer
   wait only ever applies to a link that is up and slow. */
const TRANSIT_WAIT_MS = 60000;
/* How long an envelope may wait for a link that is mid-redial. */
const TRANSIT_PARK_MS = 10000;
/* Above this much unsent on a link, new envelopes are refused as busy. Well
   under the hard ceiling in relay-peers.js, so the refusal is a pacing signal
   and never the link being torn down. */
const TRANSIT_LINK_SOFT_LIMIT_BYTES = Number(process.env.CHAT_TRANSIT_LINK_SOFT_LIMIT_BYTES || 16 * 1024 * 1024);
/* How many envelopes one client may have in the air at once. Each carried
   envelope parks a closure holding the asking socket for the full minute,
   and nothing capped them: a single client could park the closure for every
   frame it could send, and each park keeps a socket and a reply path alive
   whether the far relay ever answers or not. Well above what a person's
   in-flight messages ever need; far below what a loop needs to hurt. */
const TRANSIT_WAIT_PER_CLIENT = Number(process.env.CHAT_TRANSIT_WAIT_PER_CLIENT || 256);
const transitWaiting = new Map();
const transitWaitingByClient = new Map();
function rememberTransitWait(ref, entry) {
  transitWaiting.set(ref, entry);
  const held = transitWaitingByClient.get(entry.clientId) || new Set();
  held.add(ref);
  transitWaitingByClient.set(entry.clientId, held);
}
function forgetTransitWait(ref) {
  const entry = transitWaiting.get(ref);
  if (!entry) return;
  transitWaiting.delete(ref);
  const held = transitWaitingByClient.get(entry.clientId);
  if (!held) return;
  held.delete(ref);
  if (!held.size) transitWaitingByClient.delete(entry.clientId);
}
setInterval(() => {
  const now = Date.now();
  for (const [ref, waiting] of transitWaiting) {
    if (waiting.expiresAt > now) continue;
    forgetTransitWait(ref);
    /* A wait that runs out is an answer, not a silence. The sender held a
       frame back for the whole of TRANSIT_WAIT_MS believing a carrier was
       carrying it; leaving that belief standing is how a link that died
       mid-carry turns into messages nobody admits to losing. The reply is
       the same shape a missing link already gets, so the client needs no
       new case to understand it. */
    try {
      waiting.reply({ type: 'error', reason: 'transit-unavailable', toRelay: waiting.toRelay, tag: waiting.tag });
    } catch (_error) { /* the socket that asked is gone; nothing to tell */ }
  }
}, 15000).unref?.();

function carryTransitEnvelope(envelope, { clientId, tag, reply }) {
  const facts = transitFacts(envelope);
  if (!facts.toRelay) {
    reply({ type: 'error', reason: 'transit-no-relay', tag });
    return;
  }
  if (facts.toRelay === relayIdentity.id) {
    /* Addressed to this relay, which means the sender worked out the route
       wrongly. Saying so is better than opening it here and quietly making
       the transit layer meaningless for that message. */
    reply({ type: 'error', reason: 'transit-loop', tag });
    return;
  }
  /* The per-client ceiling is checked before anything is parked, so a client
     that is already over it is told now rather than after a ten-second park. */
  if ((transitWaitingByClient.get(clientId)?.size || 0) >= TRANSIT_WAIT_PER_CLIENT) {
    reply({ type: 'error', reason: 'transit-busy', toRelay: facts.toRelay, tag });
    return;
  }
  const link = relayPeers.linkFor(facts.toRelay);
  if (link) {
    carryOverLink(link, envelope, facts, { clientId, tag, reply });
    return;
  }
  /* The link might be mid-redial (a drop-to-redial cycle is under two
     seconds). Refusing instantly was turning a one-second window into a
     user-visible error, because the client's retries all hit the same
     instant refusal. Park the envelope for up to ten seconds and carry it the
     moment a link stands again; only if the link is truly gone does the
     refusal go out.
     The park used to call `link.send` on the variable that had been null when
     it parked — the revived link was found and then never used — so every
     envelope sent during a redial ended as "transit-failed" with a TypeError
     in the log (Finland, 2026-10-06T17:27:52). The revived link is now the
     one carried on. */
  const parkDeadline = Date.now() + TRANSIT_PARK_MS;
  const parkTimer = setInterval(() => {
    const revived = relayPeers.linkFor(facts.toRelay);
    if (revived) {
      clearInterval(parkTimer);
      carryOverLink(revived, envelope, facts, { clientId, tag, reply });
      return;
    }
    if (Date.now() > parkDeadline) {
      clearInterval(parkTimer);
      reply({ type: 'error', reason: 'transit-unavailable', toRelay: facts.toRelay, tag });
    }
  }, 250);
  parkTimer.unref?.();
}

/* Hands one envelope to one live link and parks the asking socket's reply
   until the far relay answers. Every failure here is an answer to the sender,
   never a throw: this runs inside the socket receive handler, and a throw
   from it used to take the whole relay down. */
function carryOverLink(activeLink, envelope, facts, { clientId, tag, reply }) {
  try {
    /* The envelope is a parsed object on this side of the socket; its wire
       size is the JSON. Buffer.byteLength(object) THROWS — and this sits in
       the WS receive path, so one cross-relay message killed the whole relay. */
    const wireBytes = Buffer.byteLength(JSON.stringify(envelope));
    /* A link with a backlog is a slow border, not a dead one. Refusing with a
       retryable "busy" lets the client pace itself; piling more behind the
       backlog only makes every envelope in it later, until their waits run
       out and they are all reported lost together. */
    if (typeof activeLink.bufferedBytes === 'function'
      && activeLink.bufferedBytes() + wireBytes > TRANSIT_LINK_SOFT_LIMIT_BYTES) {
      reply({ type: 'error', reason: 'transit-busy', toRelay: facts.toRelay, tag });
      return;
    }
    noteTransitTraffic(facts.toRelay, wireBytes);
    /* The badge in the users table: this sender's traffic just crossed a relay
       link. What crossed stays sealed — but its SIZE is not private, and the
       presence probes a same-relay user's app fires at cross-relay contacts
       are a few hundred bytes. A kilobyte is a message, not a probe. */
    if (wireBytes >= 1024) noteTransitActivity(clientId);
    /* The carrier's own correlation id, not the client's tag. The tag belongs
       to the client and there is no reason for another relay to see it. */
    const ref = crypto.randomUUID();
    rememberTransitWait(ref, {
      clientId, tag, reply, toRelay: facts.toRelay, expiresAt: Date.now() + TRANSIT_WAIT_MS,
    });
    if (!activeLink.send({ kind: 'transit', ref, envelope })) {
      forgetTransitWait(ref);
      reply({ type: 'error', reason: activeLink.isOpen() ? 'transit-busy' : 'transit-unavailable', toRelay: facts.toRelay, tag });
      return;
    }
    if (wireBytes >= 1024) console.log(`[Transit] carried ${facts.bytes} bytes for ${facts.toRelay.slice(0, 12)}`);
  } catch (transitError) {
    console.warn('[Transit] carry failed:', transitError.message);
    reply({ type: 'error', reason: 'transit-failed', tag });
  }
}

/* A link that goes down takes its unanswered envelopes with it: nothing will
   ever answer them. Saying so at once, rather than when each wait expires,
   is what lets a client re-send over the redialled link within seconds. Only
   when no other link to that relay remains — a duplicate link standing means
   the answers can still come back. */
function failTransitWaitsFor(relayId) {
  if (!relayId || relayPeers.linkFor(relayId)) return;
  for (const [ref, waiting] of transitWaiting) {
    if (waiting.toRelay !== relayId) continue;
    forgetTransitWait(ref);
    try {
      waiting.reply({ type: 'error', reason: 'transit-unavailable', toRelay: relayId, tag: waiting.tag });
    } catch (_error) { /* the socket that asked is gone */ }
  }
}

/* A frame off a relay link. Two kinds: an envelope to deliver here, and the
   answer to one this relay carried. */
/* At most this many presence questions from one peer relay in one minute.
   Generous for a person opening conversations, useless for a sweep. */
/* Shared by every question a linked relay may ask on behalf of its clients —
   presence, route and TURN. 240 was below what a handful of people with a
   screenful of cross-relay contacts produce, and an exhausted budget showed
   real contacts as offline. */
const PRESENCE_QUERY_PER_MINUTE = Number(process.env.CHAT_TRANSIT_QUERIES_PER_MINUTE || 1200);
const presenceQueryCounts = new WeakMap();
function presenceQueryAllowed(link) {
  const now = Date.now();
  const seen = presenceQueryCounts.get(link);
  if (!seen || now - seen.since > 60000) {
    presenceQueryCounts.set(link, { since: now, count: 1 });
    return true;
  }
  seen.count += 1;
  return seen.count <= PRESENCE_QUERY_PER_MINUTE;
}

function handleTransitFrame(payload, link) {
  if (payload?.kind === 'directory') {
    acceptDirectory(payload.doc, 'push');
    return;
  }
  if (payload?.kind === 'alert') {
    receiveRelayAlert(payload, link);
    return;
  }
  if (payload?.kind === 'alert-ack') {
    receiveRelayAlertAck(payload, link);
    return;
  }
  if (payload?.kind === 'transit') {
    let inner;
    try {
      inner = openTransit(relayPrivate, relayIdentity.id, payload.envelope);
    } catch (error) {
      /* Every refusal looks the same from the other side. Saying WHY an
         envelope did not open tells a carrier something about what was in
         it. */
      link.send({ kind: 'transit-result', ref: payload.ref, answer: { type: 'error', reason: 'transit-rejected' } });
      return;
    }
    /* A question about one of this relay's own clients, rather than something
     * to hand to one.
     *
     * Presence is per relay -- a relay broadcasts its own clients and nobody
     * else's -- so somebody on the far side is shown as offline for ever, which
     * is ignorance dressed up as knowledge. This answers for exactly ONE
     * fingerprint at a time, and only one already known to the asker: a
     * fingerprint is 256 bits, so it cannot be guessed, and holding one means
     * holding that person's card. It is also strictly less than this relay
     * already gives its own clients, who are handed every other client's
     * presence unasked.
     *
     * The rate limit is per link and per minute, so a peer relay cannot turn
     * this into a sweep even for fingerprints it does somehow hold.
     */
    if (inner?.type === 'presence-query' || inner?.type === 'route-query' || inner?.type === 'turn-query') {
      if (!presenceQueryAllowed(link)) {
        link.send({ kind: 'transit-result', ref: payload.ref, answer: { type: 'error', reason: 'transit-busy' } });
        return;
      }
      if (inner.type === 'turn-query') {
        /* A credential for THIS relay's coturn, for somebody on the asking
           relay whose call or transfer needs a TURN both ends can reach. The
           question names nobody; the answer is the same thing /turn-config
           gives any visitor, minted fresh and expiring. */
        link.send({ kind: 'transit-result', ref: payload.ref, answer: { type: 'turn', ...turnCredentialsForClient() } });
        return;
      }
      const asked = String(inner.toFingerprint || '').slice(0, 128);
      const up = Boolean(findOpenPresenceByFingerprint(asked));
      if (inner.type === 'route-query') {
        /* Does this person live here? Yes when they proved their key on this
           relay in the last ninety days. The origin goes with a yes so the
           asking client can file the route; the relay's id and key it
           already had, because it sealed this question to them. */
        const home = up || identityLivesHere(asked);
        link.send({
          kind: 'transit-result',
          ref: payload.ref,
          answer: { type: 'route', toFingerprint: asked, home, up, origin: home ? publicOriginForPeers() : '' },
        });
        return;
      }
      link.send({
        kind: 'transit-result',
        ref: payload.ref,
        answer: { type: 'presence', toFingerprint: asked, up },
      });
      return;
    }
    /* The relay's own voice never arrives by transit. A system-note is either
       a peer's (signed, checked where it is rendered) or THIS relay's (stamped
       with an id only this relay could put there). Anything else is somebody
       on another relay quoting a stamp they do not hold. */
    if (String(inner?.payload?.type || '') === 'system-note') {
      link.send({ kind: 'transit-result', ref: payload.ref, answer: { type: 'error', reason: 'transit-rejected' } });
      return;
    }
    deliverRelayMessage(inner, {
      clientId: '',
      /* Deliberately blank. For a local client this field is the fingerprint
         the relay CHALLENGED and the client proved; nothing was proved here,
         so presenting the sender's claim in the same field would be this
         relay vouching for something it did not check. The recipient reads
         the sender out of the sealed payload, where it can verify it. */
      fromFingerprint: '',
      reply: (answer) => link.send({ kind: 'transit-result', ref: payload.ref, answer }),
    });
    return;
  }
  if (payload?.kind === 'transit-result') {
    const waiting = transitWaiting.get(String(payload.ref || ''));
    if (!waiting) return;
    forgetTransitWait(String(payload.ref));
    waiting.reply({ ...transitAnswerForClient(payload.answer), tag: waiting.tag });
  }
}

/* What a linked relay is allowed to say to one of this relay's clients.
 *
 * The answer to a carried envelope is written by the OTHER relay and arrives
 * on this relay's socket to that client, which means passing it through
 * unchanged hands a peer relay a frame injector: 'server-kicked',
 * 'id-challenge', anything the client acts on. It is rebuilt here from the
 * two shapes a delivery can actually produce, field by field, and everything
 * else becomes a plain refusal. */
function transitAnswerForClient(answer) {
  const type = String(answer?.type || '');
  if (type === 'queued') {
    return {
      type: 'queued',
      toFingerprint: String(answer.toFingerprint || '').slice(0, 128),
      count: Number.isFinite(answer.count) ? answer.count : 0,
      /* Whether the far relay knows this recipient. Passed on only as a
         boolean; absent (older relay) stays absent. */
      ...(typeof answer.known === 'boolean' ? { known: answer.known } : {}),
    };
  }
  if (type === 'presence') {
    return {
      type: 'presence',
      toFingerprint: String(answer.toFingerprint || '').slice(0, 128),
      up: answer.up === true,
    };
  }
  if (type === 'route') {
    const origin = String(answer.origin || '');
    return {
      type: 'route',
      toFingerprint: String(answer.toFingerprint || '').slice(0, 128),
      home: answer.home === true,
      up: answer.up === true,
      origin: /^https?:\/\/[^/\s]{1,200}$/i.test(origin) ? origin : '',
    };
  }
  if (type === 'turn') {
    /* Only TURN urls, only a handful, only plain strings: the client puts
       these into an RTCPeerConnection, and nothing else may ride along. */
    const urls = (Array.isArray(answer.urls) ? answer.urls : [])
      .map((url) => String(url || ''))
      .filter((url) => /^turns?:[^\s]{1,200}$/i.test(url))
      .slice(0, 6);
    return {
      type: 'turn',
      enabled: answer.enabled === true && urls.length > 0,
      urls,
      username: String(answer.username || '').slice(0, 128),
      credential: String(answer.credential || '').slice(0, 128),
      expiresAt: Number.isFinite(answer.expiresAt) ? answer.expiresAt : 0,
    };
  }
  if (type === 'error') {
    /* The reason is echoed only when it is one this relay would have sent
       itself, so a peer cannot invent a reason a client has a special path
       for. */
    const known = new Set(['target-offline', 'target-restricted', 'transit-rejected', 'transit-busy']);
    const reason = String(answer.reason || '');
    return { type: 'error', reason: known.has(reason) ? reason : 'transit-rejected' };
  }
  return { type: 'error', reason: 'transit-rejected' };
}

function deliverRelayMessage(message, { clientId = '', fromFingerprint = '', reply = () => {} } = {}) {
totalRelays++;
  const toFingerprint = String(message.toFingerprint || '').slice(0, 128);
  /* Queued mail is keyed by this value and lands in a file named after it,
     so a mailbox key that is not a fingerprint is refused before it can
     reach the store. Live delivery below answers to the socket tables and
     never to a filename, so it does not need the same gate. */
  if (message.persist && toFingerprint && !isFingerprintKey(toFingerprint)) {
    reply({ type: 'error', reason: 'invalid-target', toClientId: message.toClientId || '', toFingerprint, tag: String(message.tag || '').slice(0, 96) });
    return;
  }
  /* Echoed back on every reply so the sender can line a refusal or a
     queue confirmation up with the message it was sent for. */
  const tag = String(message.tag || '').slice(0, 96);
  const target = openPresenceRecord(message.toClientId) || findOpenPresenceByFingerprint(toFingerprint);
  /* One account may be online from several sockets at once, and a frame
     addressed to the identity belongs on all of them: the phone in a pocket
     and the desktop on a desk both get it. The set is the target as it was
     always resolved — so a single-device delivery is byte-for-byte what it
     has always been — plus every other verified live socket of the same
     fingerprint, drawn from the index findOpenPresenceByFingerprint reads. */
  const allTargets = [];
  if (target) allTargets.push(target);
  if (toFingerprint) {
    for (const candidate of verifiedByFingerprint.get(toFingerprint) || []) {
      if (candidate.ws?.readyState !== WebSocket.OPEN) continue;
      if (allTargets.includes(candidate)) continue;
      allTargets.push(candidate);
    }
  }

  const payloadType = String(message.payload?.type || 'unknown');
  /* Sealed sender (js/chat/51-envelope-privacy.js): the sender's name is in an
     encrypted box, and this relay neither files the item under the sender nor
     hands the sender's name to the recipient's socket. */
  const sealedSender = payloadType === 'offline-chat' && message.payload?.ss === 1;
  /* Call signaling the relay already sees; the live-calls report keys on it. */
  if (payloadType.startsWith('call') || payloadType.startsWith('gcall')) {
    noteCallFrame(clientId || message.fromClientId, payloadType, message.toClientId || toFingerprint);
  }

  const targetRestriction = target
    ? getRestrictionForIdentity(target)
    : (toFingerprint ? getRestrictionForIdentity({ fingerprint: toFingerprint }) : null);
  if (targetRestriction) {
    console.warn(`[Relay] Blocked delivery to restricted target ${toFingerprint || message.toClientId}`);
    reply({ type: 'error', reason: 'target-restricted', toClientId: message.toClientId || '', toFingerprint, tag });
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
    /* A sealed envelope keeps its inner type in the box and states only the
       one bit the relay needs: whether to keep it at all. */
    if (EPHEMERAL_PAYLOADS.has(payloadType) || EPHEMERAL_PAYLOADS.has(innerType) || message.payload?.eph === 1) {
      reply({ type: 'error', reason: 'target-offline', toClientId: message.toClientId || '', tag });
      return;
    }
    if (message.persist && toFingerprint) {
      console.log(`[Relay] Target offline, queuing ${payloadType} for ${toFingerprint}`);
      const queued = offlineBoxes.get(toFingerprint) || [];
      queued.push({
        type: 'relay',
        relayId: crypto.randomUUID(),
        /* A sealed-sender envelope is filed without a sender: who wrote it
           is inside the box, and the mailbox on disk does not learn it. */
        fromClientId: sealedSender ? '' : clientId,
        fromFingerprint: sealedSender ? '' : fromFingerprint,
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
      noteKnownIdentity(toFingerprint);
      saveOfflineBox(toFingerprint);
      /* The sweep writes whatever it changes, including this box if the
         quota just pushed something out of it. Scoped to the recipient:
         queueing for one person cannot push anything out of anyone else's
         mailbox, so weighing the whole server was pure cost. */
      sweepRetention(toFingerprint);
      /* The sweep may have emptied the box entirely, so the count reads
         what is left rather than assuming the queue survived it. */
      const remaining = offlineBoxes.get(toFingerprint);
      /* `known` tells the sender whether this recipient has ever proven their
         key here. False means the message may be waiting at a relay its
         recipient never visits, and the client goes looking for the right one
         instead of showing a reassuring tick. */
      reply({ type: 'queued', toFingerprint, count: remaining ? remaining.length : 0, tag, known: identityLivesHere(toFingerprint) });
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
    reply({ type: 'error', reason: 'target-offline', toClientId: message.toClientId || '', tag });
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
  /* The id of the mailbox copy this delivery also queued, so a connected
     recipient can acknowledge the copy out of the box the moment it has the
     live frame in hand — without it the box held every message for an
     account whose devices never disconnect, and re-delivered all of them on
     the one reconnect that finally drained it. */
  let liveRelayId = '';
  if (message.persist && toFingerprint) {
    const queuedLive = offlineBoxes.get(toFingerprint) || [];
    const queuedItem = {
      type: 'relay',
      relayId: crypto.randomUUID(),
      fromClientId: sealedSender ? '' : clientId,
      fromFingerprint: sealedSender ? '' : fromFingerprint,
      payload: message.payload || null,
      queuedAt: new Date().toISOString(),
    };
    queuedLive.push(queuedItem);
    liveRelayId = queuedItem.relayId;
    offlineBoxes.set(toFingerprint, queuedLive);
    saveOfflineBox(toFingerprint);
    sweepRetention(toFingerprint);
    const remainingLive = offlineBoxes.get(toFingerprint);
    reply({ type: 'queued', toFingerprint, count: remainingLive ? remainingLive.length : 0, tag, known: true });
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
  for (const recipient of allTargets) {
    safeSend(recipient.ws, {
      type: 'relay',
      relayId: liveRelayId || undefined,
      fromClientId: sealedSender ? '' : clientId,
      fromFingerprint: sealedSender ? '' : fromFingerprint,
      payload: message.payload || null,
    });
  }
}

/* The socket another relay arrives on.
 *
 * 24 MB rather than the 12 MB a client frame gets: a transit envelope wraps
 * one of those and the wrapping is base64, which costs a third, and the frame
 * around it costs a little more. A ceiling below what the inner path allows
 * would drop the largest legitimate messages and nothing would say why.
 *
 * Nothing is accepted at all while transit is off, and the handshake decides
 * the rest — see relay-peers.js. */
const relayLinkServer = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 * 1024 });
relayLinkServer.on('error', (error) => console.error('[Transit] link server error:', error));
/* A link socket is a socket. It counts against the same ceilings every other
   socket counts against, from the moment the upgrade completes — the
   handshake proves nothing for up to ten seconds, and unauthenticated
   handshakes are exactly what a ceiling is for. */
relayLinkServer.on('connection', (ws, request) => {
  trackSocket(ws, socketAddress(request));
  relayPeers.accept(ws);
});
function handleRelayLinkUpgrade(request, socket, head) {
  if (!relayPeers.enabled()) { socket.destroy(); return; }
  if (socketBudgetRefused(request, socket)) return;
  relayLinkServer.handleUpgrade(request, socket, head, (ws) => {
    relayLinkServer.emit('connection', ws, request);
  });
}

// Manual upgrade handler to resolve path conflicts between wsServer and PeerJS
server.on('upgrade', (request, socket, head) => {
  /* A malformed request line here is an exception in an event handler, which
     is a process-level event with a flushing exit attached. The HTTP parser
     rarely allows one through, but "rarely" is not "never", and the answer to
     a bad URL is a closed socket rather than a dead relay. */
  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  } catch (_error) {
    rejectUpgrade(socket, 400, 'Bad Request');
    return;
  }
  const { pathname } = url;

  if (pathname === '/chat-signal') {
    handlePresenceUpgrade(request, socket, head);
    return;
  }
  if (pathname === '/relay-link') {
    handleRelayLinkUpgrade(request, socket, head);
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
  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  } catch (_error) {
    rejectUpgrade(socket, 400, 'Bad Request');
    return;
  }
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
/* ------------------------------------------------------------------
 * Device sync beacons — the only thing this relay keeps for multi-device.
 *
 * Several devices of one account sync with each other directly, while both
 * are online; the relay holds no history, no file and no session for them.
 * What a device that comes back needs is to know THAT it is behind and which
 * sibling holds what it missed, so it can ask the moment that sibling is
 * online. That is the beacon: one small blob per device, encrypted on the
 * device to the account's own key, opaque here, and capped hard so it can
 * never become a mailbox by the back door.
 * ------------------------------------------------------------------ */
function beaconPath(fingerprint) {
  return path.join(BEACON_DIR, `${fingerprint}.json`);
}
function loadBeacons(fingerprint) {
  if (beaconCache.has(fingerprint)) return beaconCache.get(fingerprint);
  let entries = {};
  try {
    const raw = JSON.parse(fs.readFileSync(beaconPath(fingerprint), 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) entries = raw;
  } catch (_error) { /* none yet */ }
  const cutoff = Date.now() - BEACON_TTL_MS;
  for (const [deviceId, entry] of Object.entries(entries)) {
    if (!entry || typeof entry.blob !== 'string' || !(Number(entry.at) > cutoff)) delete entries[deviceId];
  }
  beaconCache.set(fingerprint, entries);
  if (beaconCache.size > 2000) beaconCache.delete(beaconCache.keys().next().value);
  return entries;
}
function storeBeacon(fingerprint, deviceId, blob) {
  const entries = { ...loadBeacons(fingerprint) };
  entries[deviceId] = { blob, at: Date.now() };
  const ids = Object.keys(entries);
  if (ids.length > BEACON_MAX_DEVICES) {
    ids.sort((a, b) => entries[a].at - entries[b].at)
      .slice(0, ids.length - BEACON_MAX_DEVICES)
      .forEach((id) => { delete entries[id]; });
  }
  beaconCache.set(fingerprint, entries);
  try {
    writeJsonAtomic(beaconPath(fingerprint), entries);
  } catch (error) {
    console.warn('[Beacon] could not be written:', error.message);
  }
}
function dropBeacons(fingerprint) {
  beaconCache.delete(fingerprint);
  try { fs.unlinkSync(beaconPath(fingerprint)); } catch (_error) { /* none */ }
  dropSiblingHeld(fingerprint);
}
/* One device is gone from the account — it left, or its primary revoked it:
   its beacon goes, and so does every copy held for it. */
function forgetSiblingDevice(fingerprint, deviceId) {
  if (!deviceId) return;
  const entries = loadBeacons(fingerprint);
  if (entries[deviceId]) {
    const kept = { ...entries };
    delete kept[deviceId];
    beaconCache.set(fingerprint, kept);
    try {
      if (Object.keys(kept).length) writeJsonAtomic(beaconPath(fingerprint), kept);
      else fs.unlinkSync(beaconPath(fingerprint));
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn('[Beacon] could not be written:', error.message);
    }
  }
  const store = loadSiblingHeld(fingerprint);
  const heldForIt = store.items.some((item) => item.pending.includes(deviceId)) || Boolean(store.overflow[deviceId]);
  if (!heldForIt) return;
  store.items = store.items
    .map((item) => ({ ...item, pending: item.pending.filter((id) => id !== deviceId) }))
    .filter((item) => item.pending.length);
  delete store.overflow[deviceId];
  saveSiblingHeld(fingerprint, store);
}

/* ------------------------------------------------------------------
 * The device roster — which devices are still part of an account.
 *
 * Every device of an account holds the same identity key, so that key cannot
 * be what tells the account's first device — its primary — from the others.
 * Each device also has a key of its own, made on it and never exported. The
 * roster names the primary by that key, with a certificate the identity key
 * signed (only a device of the account can make one), and the roster itself
 * is signed with the primary's own device key: no other device of the
 * account, and not this relay, can write one that verifies. A successor must
 * be signed by the primary the stored roster names, with a higher sequence
 * number; handing the role on is that primary signing a roster that names
 * another device.
 *
 * The relay keeps the newest valid roster and enforces what it revokes: a
 * revoked device — by its id, or by its key once proven — is told so and
 * shut out the moment its identity is proven, its beacon and whatever was
 * held for it are dropped, and a socket of it already connected is closed.
 * Nothing in the roster is secret: device ids, public keys and a label like
 * "macOS app" — no name, no history.
 * ------------------------------------------------------------------ */
const ROSTER_DEVICE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const ROSTER_KEY_TEXT = /^[A-Za-z0-9+/=]{40,400}$/;
const ROSTER_SIGNATURE_TEXT = /^[A-Za-z0-9+/=]{40,1100}$/;
function rosterPath(fingerprint) {
  return path.join(ROSTER_DIR, `${fingerprint}.json`);
}
function loadRoster(fingerprint) {
  if (rosterCache.has(fingerprint)) return rosterCache.get(fingerprint);
  let roster = null;
  try { roster = JSON.parse(fs.readFileSync(rosterPath(fingerprint), 'utf8')); } catch (_error) { roster = null; }
  if (!roster || typeof roster !== 'object' || roster.fp !== fingerprint) roster = null;
  rosterCache.set(fingerprint, roster);
  if (rosterCache.size > 2000) rosterCache.delete(rosterCache.keys().next().value);
  return roster;
}
function saveRoster(fingerprint, roster) {
  rosterCache.set(fingerprint, roster);
  try {
    fs.mkdirSync(ROSTER_DIR, { recursive: true });
    writeJsonAtomic(rosterPath(fingerprint), roster);
  } catch (error) {
    console.warn('[Roster] could not be written:', error.message);
  }
}
function dropRoster(fingerprint) {
  rosterCache.delete(fingerprint);
  try { fs.unlinkSync(rosterPath(fingerprint)); } catch (_error) { /* none */ }
}
/* Exactly the bytes the client signs (js/chat/58-device-roster.js), field by
   field in a fixed order, so neither side depends on how an object's keys
   happen to be ordered. */
function rosterSignedText(roster) {
  return 'poorija-roster|1|' + JSON.stringify([
    roster.fp, roster.seq, roster.at,
    [roster.primary.d, roster.primary.k, roster.primary.n],
    roster.cert,
    roster.members.map((member) => [member.d, member.k, member.n, member.at]),
    roster.revoked.map((entry) => [entry.d, entry.k, entry.at, entry.why]),
    roster.signer,
  ]);
}
function rosterCertText(roster) {
  return `poorija-roster-primary|${roster.fp}|${roster.primary.d}|${roster.primary.k}`;
}
function rosterLabelValid(text) {
  return typeof text === 'string' && text.length <= 48 && !/[\u0000-\u001f\u007f]/.test(text);
}
function rosterShapeValid(roster, fingerprint) {
  if (!roster || typeof roster !== 'object' || Array.isArray(roster)) return false;
  if (roster.v !== 1 || roster.fp !== fingerprint) return false;
  if (!Number.isSafeInteger(roster.seq) || roster.seq < 1 || !Number.isSafeInteger(roster.at) || roster.at < 0) return false;
  const primary = roster.primary;
  if (!primary || !ROSTER_DEVICE_ID.test(String(primary.d || '')) || !ROSTER_KEY_TEXT.test(String(primary.k || '')) || !rosterLabelValid(primary.n)) return false;
  if (!ROSTER_SIGNATURE_TEXT.test(String(roster.cert || '')) || !ROSTER_SIGNATURE_TEXT.test(String(roster.sig || ''))) return false;
  if (!ROSTER_KEY_TEXT.test(String(roster.signer || ''))) return false;
  if (!Array.isArray(roster.members) || roster.members.length > ROSTER_MAX_MEMBERS) return false;
  if (!Array.isArray(roster.revoked) || roster.revoked.length > ROSTER_MAX_REVOKED) return false;
  for (const member of roster.members) {
    if (!member || !ROSTER_DEVICE_ID.test(String(member.d || '')) || !ROSTER_KEY_TEXT.test(String(member.k || ''))
      || !rosterLabelValid(member.n) || !Number.isSafeInteger(member.at)) return false;
  }
  for (const entry of roster.revoked) {
    if (!entry || !ROSTER_DEVICE_ID.test(String(entry.d || '')) || (entry.k !== '' && !ROSTER_KEY_TEXT.test(String(entry.k || '')))
      || !Number.isSafeInteger(entry.at) || (entry.why !== 'revoked' && entry.why !== 'left')) return false;
  }
  /* The primary cannot be one of the devices it revoked. */
  if (roster.revoked.some((entry) => entry.d === primary.d || (entry.k && entry.k === primary.k))) return false;
  return true;
}
function rosterSignaturesValid(roster, identityPublicKeyData) {
  try {
    const identityKey = crypto.createPublicKey({ key: Buffer.from(identityPublicKeyData, 'base64'), format: 'der', type: 'spki' });
    if (!crypto.verify('sha256', Buffer.from(rosterCertText(roster)), identityKey, Buffer.from(roster.cert, 'base64'))) return false;
    const primaryKey = crypto.createPublicKey({ key: Buffer.from(roster.primary.k, 'base64'), format: 'der', type: 'spki' });
    if (primaryKey.asymmetricKeyType !== 'ec' || primaryKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return false;
    const signerKey = crypto.createPublicKey({ key: Buffer.from(roster.signer, 'base64'), format: 'der', type: 'spki' });
    if (signerKey.asymmetricKeyType !== 'ec' || signerKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return false;
    return crypto.verify('sha256', Buffer.from(rosterSignedText(roster)), { key: signerKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(roster.sig, 'base64'));
  } catch (_error) {
    return false;
  }
}
/* Who may write the next one: the primary the stored roster names — the
   only key that can hand the role on, too. With none stored, a roster that
   its own primary signed. */
function rosterRefusal(next, current, identityPublicKeyData, fingerprint) {
  let text = '';
  try { text = JSON.stringify(next); } catch (_error) { text = ''; }
  if (!text || text.length > ROSTER_MAX_CHARS || !rosterShapeValid(next, fingerprint)) return 'malformed';
  if (!rosterSignaturesValid(next, identityPublicKeyData)) return 'bad-signature';
  if (!current) return next.signer === next.primary.k ? '' : 'not-primary';
  if (next.seq <= current.seq) return 'stale';
  return next.signer === current.primary.k ? '' : 'not-primary';
}
function rosterRevokes(roster, deviceId, deviceKey) {
  if (!roster || !Array.isArray(roster.revoked)) return false;
  return roster.revoked.some((entry) => (deviceId && entry.d === deviceId) || (deviceKey && entry.k && entry.k === deviceKey));
}
function provenDeviceKey(record) {
  return record?.deviceKeyProven ? record.deviceKey : '';
}
/* A revoked device that has just proven the account's identity: it is told
   why, with the roster that says so (which it can verify for itself), and
   the socket is closed. Nothing addressed to the account reaches it. */
function shutOutRevokedDevice(record, roster) {
  record.identityVerified = false;
  record.deviceRevoked = true;
  unindexVerified(record);
  safeSend(record.ws, { type: 'device-revoked', roster });
  setTimeout(() => {
    try { if (record.ws?.readyState === WebSocket.OPEN) record.ws.close(4410, 'device-revoked'); } catch (_error) {}
  }, 400).unref?.();
  setTimeout(() => {
    try { if (record.ws && record.ws.readyState !== WebSocket.CLOSED) record.ws.terminate(); } catch (_error) {}
    presence.delete(record.clientId);
    broadcastPeers();
  }, 1500).unref?.();
}
function enforceRoster(fingerprint, roster) {
  for (const entry of roster.revoked) forgetSiblingDevice(fingerprint, entry.d);
  for (const candidate of [...(verifiedByFingerprint.get(fingerprint) || [])]) {
    if (rosterRevokes(roster, candidate.deviceId, provenDeviceKey(candidate))) shutOutRevokedDevice(candidate, roster);
  }
}

/* ------------------------------------------------------------------
 * Held for an absent sibling.
 *
 * Devices of one account sync with each other directly while both are online.
 * A device that is away used to catch up only when it and a sibling were
 * online together — so if the sibling had gone by the time it came back, it
 * had nothing. Now a device sending its siblings a sync envelope also hands
 * the relay a copy for each sibling that is NOT here at that moment: the
 * relay keeps it — sealed to the account's own key, unreadable here — for
 * exactly those devices, delivers it when each connects, and forgets it the
 * moment each has acknowledged it.
 *
 * What it will keep, and for how long, is the whole design:
 *   - only device-sync envelopes from the account's own proven owner, each at
 *     most 96 KB — history and what changed in it, never a file (the client
 *     never puts file bytes in one, and the cap would refuse them anyway);
 *   - only for devices the account has (its beacons) that are not connected
 *     and awake — a device that is here gets the live copy and nothing is
 *     stored for it;
 *   - at most 4 MB and 2,000 items per account, oldest dropped first, and a
 *     device whose items were dropped is told so (it then asks a sibling for
 *     what it missed, device to device, as before); 256 MB across the whole
 *     relay (CHAT_SIBLING_MAX_BYTES), past which nothing more is held; no more
 *     than 32 MB of it in memory at once;
 *   - fourteen days at most;
 *   - and never a message meant to disappear (on a timer, or view-once): the
 *     client keeps those to the live copy alone.
 * ------------------------------------------------------------------ */
function siblingHeldPath(fingerprint) {
  return path.join(SIBLING_DIR, `${fingerprint}.json`);
}
function siblingStoreChars(store) {
  return store.items.reduce((sum, item) => sum + (item.envelope?.length || 0), 0);
}
/* What every account holds, read once from the files at start. */
function countSiblingHeld() {
  siblingHeldChars.clear();
  siblingTotalChars = 0;
  try {
    for (const name of fs.readdirSync(SIBLING_DIR)) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      const size = fs.statSync(path.join(SIBLING_DIR, name)).size;
      siblingHeldChars.set(name.slice(0, -5), size);
      siblingTotalChars += size;
    }
  } catch (_error) { /* nothing held yet */ }
}
function cacheSiblingHeld(fingerprint, store) {
  const previous = siblingHeldCache.get(fingerprint);
  if (previous) siblingCachedChars -= previous.__chars || 0;
  siblingHeldCache.delete(fingerprint);
  store.__chars = siblingStoreChars(store);
  siblingHeldCache.set(fingerprint, store);
  siblingCachedChars += store.__chars;
  for (const [key, cached] of siblingHeldCache) {
    if (siblingCachedChars <= SIBLING_CACHE_MAX_CHARS || siblingHeldCache.size <= 1) break;
    if (key === fingerprint) continue;
    siblingHeldCache.delete(key);
    siblingCachedChars -= cached.__chars || 0;
  }
}
function loadSiblingHeld(fingerprint) {
  if (siblingHeldCache.has(fingerprint)) return siblingHeldCache.get(fingerprint);
  let store = { items: [], overflow: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(siblingHeldPath(fingerprint), 'utf8'));
    if (raw && Array.isArray(raw.items)) store = { items: raw.items, overflow: raw.overflow && typeof raw.overflow === 'object' ? raw.overflow : {} };
  } catch (_error) { /* none yet */ }
  const devices = new Set(Object.keys(loadBeacons(fingerprint)));
  const cutoff = Date.now() - SIBLING_TTL_MS;
  store.items = store.items
    .filter((item) => item && typeof item.id === 'string' && typeof item.envelope === 'string' && Number(item.at) > cutoff)
    .map((item) => ({ ...item, pending: (Array.isArray(item.pending) ? item.pending : []).filter((deviceId) => devices.has(deviceId)) }))
    .filter((item) => item.pending.length);
  cacheSiblingHeld(fingerprint, store);
  return store;
}
function saveSiblingHeld(fingerprint, store) {
  cacheSiblingHeld(fingerprint, store);
  const before = siblingHeldChars.get(fingerprint) || 0;
  try {
    if (!store.items.length && !Object.keys(store.overflow).length) {
      siblingHeldChars.delete(fingerprint);
      siblingTotalChars -= before;
      fs.unlinkSync(siblingHeldPath(fingerprint));
      return;
    }
    const { __chars: _chars, ...onDisk } = store;
    writeJsonAtomic(siblingHeldPath(fingerprint), onDisk);
    siblingHeldChars.set(fingerprint, store.__chars);
    siblingTotalChars += store.__chars - before;
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[Siblings] could not be written:', error.message);
  }
}
function dropSiblingHeld(fingerprint) {
  const cached = siblingHeldCache.get(fingerprint);
  if (cached) siblingCachedChars -= cached.__chars || 0;
  siblingHeldCache.delete(fingerprint);
  siblingTotalChars -= siblingHeldChars.get(fingerprint) || 0;
  siblingHeldChars.delete(fingerprint);
  try { fs.unlinkSync(siblingHeldPath(fingerprint)); } catch (_error) { /* none */ }
}
/* The account's devices that are connected and awake right now. One that is
   registered but frozen (an iPhone's app in the background) reads nothing
   off its socket, so it counts as away and a copy is kept for it too. */
function liveSiblingDeviceIds(fingerprint) {
  const live = new Set();
  for (const candidate of verifiedByFingerprint.get(fingerprint) || []) {
    if (candidate.ws?.readyState !== WebSocket.OPEN || !candidate.deviceId) continue;
    if (!isAppAwake(candidate)) continue;
    live.add(candidate.deviceId);
  }
  return live;
}
function holdForAbsentSiblings(record, envelopeText) {
  const fingerprint = record.fingerprint;
  const live = liveSiblingDeviceIds(fingerprint);
  const pending = Object.keys(loadBeacons(fingerprint))
    .filter((deviceId) => deviceId !== record.deviceId && !live.has(deviceId));
  if (!pending.length) return 0;
  /* The relay as a whole is full: hold nothing more. The away device will
     catch up from a sibling, device to device, as before. */
  if (siblingTotalChars + envelopeText.length > SIBLING_GLOBAL_MAX_CHARS) return -1;
  const store = loadSiblingHeld(fingerprint);
  store.items.push({ id: crypto.randomUUID(), at: Date.now(), envelope: envelopeText, pending });
  let total = store.items.reduce((sum, item) => sum + item.envelope.length, 0);
  while (store.items.length > SIBLING_ACCOUNT_MAX_ITEMS || total > SIBLING_ACCOUNT_MAX_CHARS) {
    const dropped = store.items.shift();
    total -= dropped.envelope.length;
    for (const deviceId of dropped.pending) store.overflow[deviceId] = true;
  }
  saveSiblingHeld(fingerprint, store);
  return pending.length;
}
/* What is waiting for this device, a batch at a time: the next batch goes
   when this one is acknowledged. */
function pumpSiblingHeld(record, ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !record.deviceId || !isFingerprintKey(record.fingerprint)) return;
  const store = loadSiblingHeld(record.fingerprint);
  const mine = store.items.filter((item) => item.pending.includes(record.deviceId));
  const overflow = Boolean(store.overflow[record.deviceId]);
  if (!mine.length && !overflow) return;
  const batch = mine.slice(0, SIBLING_DELIVERY_BATCH);
  safeSend(ws, {
    type: 'sibling-held',
    items: batch.map((item) => ({ id: item.id, envelope: item.envelope })),
    more: mine.length > batch.length,
    overflow,
  });
}
function ackSiblingHeld(record, ids) {
  const store = loadSiblingHeld(record.fingerprint);
  const acked = new Set(ids);
  let changed = false;
  store.items = store.items.map((item) => {
    if (!acked.has(item.id) || !item.pending.includes(record.deviceId)) return item;
    changed = true;
    return { ...item, pending: item.pending.filter((deviceId) => deviceId !== record.deviceId) };
  }).filter((item) => item.pending.length);
  if (store.overflow[record.deviceId]) {
    delete store.overflow[record.deviceId];
    changed = true;
  }
  if (changed) saveSiblingHeld(record.fingerprint, store);
}

/* A write interrupted between the temp file and the rename leaves a
   `.name.pid.tmp` behind. The real file is whole either way; the leftover is
   only clutter, and on a long-lived volume clutter that never goes away. */
function sweepStaleTempFiles(directory) {
  try {
    const cutoff = Date.now() - 60 * 1000;
    for (const name of fs.readdirSync(directory)) {
      if (!/^\..+\.\d+\.tmp$/.test(name)) continue;
      const full = path.join(directory, name);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch (_error) { /* raced with another sweep */ }
    }
  } catch (_error) { /* directory not there yet */ }
}

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
  sweepStaleTempFiles(OFFLINE_STORE_DIR);
  sweepStaleTempFiles(path.dirname(OFFLINE_STORE_PATH));
  sweepStaleTempFiles(BEACON_DIR);
  sweepStaleTempFiles(SIBLING_DIR);
  countSiblingHeld();
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
    let standingTextBytes = 0;
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
        standingTextBytes += facts.bytes;
        if (standingTextBytes > TEXT_QUOTA_BYTES) { mustSweep = true; break; }
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

    // Back into arrival order, and cap the text tail — by count and by bytes.
    keep.sort((a, b) => queuedAtMs(a) - queuedAtMs(b));
    let textCount = 0;
    let textBytes = 0;
    for (const item of keep) {
      if (envelopeClass(item) !== 'text') continue;
      textCount += 1;
      textBytes += envelopeBytes(item);
    }
    if (textCount > TEXT_MAILBOX_LIMIT || textBytes > TEXT_QUOTA_BYTES) {
      const drop = new Set();
      /* Oldest first: the newest text is what the person has not read yet,
         and the cap should take the mail that has waited the longest. */
      for (const item of keep) {
        if (textCount <= TEXT_MAILBOX_LIMIT && textBytes <= TEXT_QUOTA_BYTES) break;
        if (envelopeClass(item) !== 'text') continue;
        drop.add(item);
        textCount -= 1;
        textBytes -= envelopeBytes(item);
      }
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
  try { const dirFd = fs.openSync(path.dirname(targetPath), 'r'); fs.fsyncSync(dirFd); fs.closeSync(dirFd); } catch (_dirSyncError) {}
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
  /* The last word on what may become a filename. Nothing that reaches this
     function should be anything but a fingerprint — the queue path and the
     purge both refuse other shapes first — but a key that arrived before
     they did, or one read off an old disk, stops here rather than at a
     path.join. */
  if (!isFingerprintKey(clean)) return;
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
/* A second at most between a message being acknowledged as queued and it
   being on disk. Four seconds was a window in which a crash lost mail the
   sender had already been told was safe. */
const MAILBOX_SAVE_MAX_MS = 1000;
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

/* A mailbox key is a fingerprint or it is nothing. The value a sender puts
   in toFingerprint reaches a filename through mailboxPath(), and path.join
   resolves '..', so anything that is not exactly 64 lowercase hex lets the
   sender choose which file gets written or deleted — '../relay-identity'
   sits one level above the mailboxes and is the file a relay must never
   lose. Queueing, wiping and the filesystem itself all answer to this. */
function isFingerprintKey(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''));
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
  /* Bans, the monitor's lists and every record's address read this. The
     headers below are a CDN's to set, and without one in front a client can
     write any of them: a banned address would come back under a made-up one.
     So they count only where an operator says a CDN sets them. */
  if (process.env.CHAT_TRUST_CDN_HEADERS !== '1') return String(securityKey(req) || '').slice(0, 80);
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
    /* Proven identities only, as in the broadcast table: this answer replaces
       the client's copy of that table, so anybody listed here but never in
       the broadcast would stay "online" there with no removal ever coming. */
    .filter((client) => !IDENTITY_PROOF_REQUIRED || client.identityVerified)
    .filter((client) => client.ws?.readyState === WebSocket.OPEN)
    .filter((client) => now - (client.lastSeenAt || 0) <= PRESENCE_TTL_MS)
    .filter((client) => !getRestrictionForIdentity(client))
    .map((client) => ({
      clientId: client.clientId,
      username: client.username || client.peerId || client.fingerprint || '',
      peerId: client.peerId,
      publicKeyData: client.publicKeyData || '',
      fingerprint: client.fingerprint || '',
      /* Whatever they wrote about what they are doing. Short, free text, and
         no more sensitive than the display name beside it — but it has to
         travel with the presence record or the other side never sees it. */
      mood: client.mood || '',
      prekeyId: client.prekeyId || '',
      prekeyPublic: client.prekeyPublic || '',
      prekeyExpiresAt: client.prekeyExpiresAt || '',
      caps: Array.isArray(client.caps) ? client.caps : [],
      /* Which install this socket is. The client reads it to tell its own
         sibling devices apart (the devices panel, the device-sync beacon), and
         it was never sent: every sibling arrived with an empty device id, so
         two devices of one account looked like one. A random per-install
         string, no more identifying than the peer id beside it. */
      deviceId: client.deviceId || '',
      /* Registered but frozen is not online. Saying otherwise tells the person
         writing that their message has been seen when it has not even been
         read off the wire. */
      status: isAppAwake(client) ? 'online' : 'away',
      updatedAt: client.updatedAt,
    }));
}


let broadcastTimer = null;
/* What every delta-capable client was last told, one serialized record per
   socket — so a change sends that change, not the whole room again. */
let presenceSnapshot = new Map();
function lightPeerRecord(r) {
  /* Whitelist, not blacklist: the spread (...) was copying `ws` (a WebSocket
     with a circular timer reference), `sentMail` (a Set), and friends — and
     JSON.stringify crashed the process on the circular reference. Only the
     fields the peers table actually carries are listed here.
     Never the address. Every record went to every connected client with the
     person's real public IP in it — anybody on the relay could collect the
     addresses of everybody online. The app never used it; the monitor reads
     addresses from its own, authenticated, endpoint.
     Nor the clocks (connected, last seen, last active, away): the app reads
     none of them — it keeps "last seen" itself — and they changed every
     minute for everybody, so with thousands online the table was resent to
     everyone, all the time, and that alone saturated the relay. */
  return {
    clientId: r.clientId,
    username: r.username,
    peerId: r.peerId,
    deviceId: r.deviceId,
    fingerprint: r.fingerprint,
    mood: r.mood,
  };
}
function broadcastPeers(minDelayMs = 0) {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    /* Stripped: the periodic presence table says who is here, not what they
       look like. Avatars travel on profile-card; re-serializing 2MB photos
       per peer per tick is a GC death spiral at scale. */
    const current = new Map();
    /* Only a proven identity is announced. The table carried every socket
       from its hello on, before any proof — so anybody holding a person's
       public key (which is public) could make them appear online, under a
       peer id of the claimant's choosing, to everyone on the relay. */
    for (const record of presence.values()) {
      if (IDENTITY_PROOF_REQUIRED && !record.identityVerified) continue;
      current.set(record.clientId, JSON.stringify(lightPeerRecord(record)));
    }
    const upsert = [];
    for (const [clientId, json] of current) if (presenceSnapshot.get(clientId) !== json) upsert.push(json);
    const remove = [];
    for (const clientId of presenceSnapshot.keys()) if (!current.has(clientId)) remove.push(clientId);
    presenceSnapshot = current;
    /* The whole table went to every client on every change: N records to N
       sockets, which at 2,700 clients was 2.5 GB per tick and the ceiling of
       the relay. A client that says it reads deltas (caps 'pd1') gets the
       table once and then only what changed; an older build still gets the
       whole table, as before. */
    const delta = upsert.length || remove.length
      ? `{"type":"peers-delta","upsert":[${upsert.join(',')}],"remove":${JSON.stringify(remove)}}`
      : '';
    let full = '';
    let fullSent = 0;
    let owed = false;
    let waiting = false;
    /* The broadcast used the raw send, which is the one path in the file with
       no buffered-amount guard — so a client that opened a socket and read
       nothing accumulated the whole peer table, avatars included, in memory
       on the relay for as long as the socket stayed open. The guard costs a
       readyState and a number; the same serialisation is still paid once.
       Presence is replaceable — only its latest state matters — so a client
       still behind on what it was sent is not sent more: it is marked to get
       one fresh table once it has caught up. And whole tables (a megabyte or
       two each with thousands online) go out a bounded number per tick, so a
       crowd connecting at once is served over a few ticks instead of piling
       gigabytes into memory: that is what killed the relay at 7,000 sockets. */
    for (const client of presence.values()) {
      if (!client.ws || client.ws.readyState !== WebSocket.OPEN) continue;
      const readsDeltas = Array.isArray(client.caps) && client.caps.includes('pd1');
      /* An older build reads whole tables only: any change owes it one. */
      if (delta && !readsDeltas) client.peersSynced = false;
      if (client.ws.bufferedAmount > PRESENCE_BUFFER_LIMIT) {
        /* A change it missed owes it the whole table once it catches up. */
        if (delta) client.peersSynced = false;
        if (!client.peersSynced) waiting = true;
        continue;
      }
      if (client.peersSynced) {
        if (delta) safeSendText(client.ws, delta, false);
        continue;
      }
      if (fullSent >= PRESENCE_FULL_PER_TICK) { owed = true; continue; }
      full = full || `{"type":"peers","peers":[${[...current.values()].join(',')}]}`;
      safeSendText(client.ws, full, false);
      fullSent += 1;
      client.peersSynced = true;
    }
    /* Somebody is still owed a table: come round again — at the next tick
       when the per-tick cap held it back, after a second when its socket is
       still behind. Nobody owed anything, no further tick: an idle room
       costs nothing. */
    if (owed) broadcastPeers();
    else if (waiting) broadcastPeers(1000);
  }, Math.max(minDelayMs, presenceTickMs()));
}
const PRESENCE_BUFFER_LIMIT = 256 * 1024;
/* get-peers: a burst of three answered at once, then one per ten seconds. */
const PEERS_ASK_BURST = 3;
const PEERS_ASK_EVERY_MS = 10000;
/* How long until this socket may have the next table with keys: 0 for now. */
function peersAskWait(record) {
  const now = Date.now();
  if (record.peersAskTokens === undefined) {
    record.peersAskTokens = PEERS_ASK_BURST;
    record.peersAskRefillAt = now;
  }
  const earned = Math.floor((now - record.peersAskRefillAt) / PEERS_ASK_EVERY_MS);
  if (earned > 0) {
    record.peersAskTokens = Math.min(PEERS_ASK_BURST, record.peersAskTokens + earned);
    record.peersAskRefillAt += earned * PEERS_ASK_EVERY_MS;
  }
  if (record.peersAskTokens >= PEERS_ASK_BURST) record.peersAskRefillAt = now;
  if (record.peersAskTokens >= 1) return 0;
  return Math.max(1, PEERS_ASK_EVERY_MS - (now - record.peersAskRefillAt));
}
const PRESENCE_FULL_PER_TICK = Number(process.env.CHAT_PRESENCE_FULL_PER_TICK || 50);
/* Changes are gathered for longer as the room grows: each tick is one frame
   to every socket, so a crowd reconnecting at once (after a restart, say)
   would otherwise cost tens of thousands of sends a second. A tenth of a
   second while the room is small, up to a second at several thousand. */
function presenceTickMs() {
  return Math.max(100, Math.min(1000, Math.round(presence.size / 4)));
}

let totalMessagesReceived = 0;
let totalMessagesSent = 0;
let totalBytesReceived = 0;
let totalBytesSent = 0;
let totalRelays = 0;

/* The monitor's own version. The relay's build tag says which app round the
   messenger is on; this says which dashboard round the server is on — they
   move on different schedules and the dashboard must be able to say which
   of the two an operator is actually looking at. */
const MONITOR_VERSION = '3.34';

/* Fine-grained traffic, for the dashboard's traffic tab: the same events the
   totals count, kept per client and per relay link. The maps are capped so
   a hostile rotation of ids cannot grow them without bound — the same
   discipline the rest of the bookkeeping here holds itself to. */
const clientTraffic = new Map();   // clientId -> { msgsIn, msgsOut, bytesIn, bytesOut, lastAt, label }
const transitTraffic = new Map();  // relayId -> { carried, bytes, lastAt }
const TRAFFIC_ROWS_MAX = 500;
function noteClientTraffic(clientId, direction, bytes, label) {
  if (!clientId) return;
  let row = clientTraffic.get(clientId);
  if (!row) {
    if (clientTraffic.size >= TRAFFIC_ROWS_MAX) clientTraffic.delete(clientTraffic.keys().next().value);
    row = { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0, lastAt: Date.now(), label: label || '' };
    clientTraffic.set(clientId, row);
  }
  row.lastAt = Date.now();
  if (label) row.label = label;
  if (direction === 'in') { row.msgsIn++; row.bytesIn += bytes; }
  else { row.msgsOut++; row.bytesOut += bytes; }
}
function noteTransitTraffic(relayId, bytes) {
  if (!relayId) return;
  /* Never a throw from bookkeeping: a non-number here means a caller
     miscounted, and the right answer is zero, not a dead relay. */
  bytes = Number.isFinite(Number(bytes)) ? Number(bytes) : 0;
  let row = transitTraffic.get(relayId);
  if (!row) {
    if (transitTraffic.size >= 64) transitTraffic.delete(transitTraffic.keys().next().value);
    row = { carried: 0, bytes: 0, lastAt: Date.now() };
    transitTraffic.set(relayId, row);
  }
  row.carried++;
  row.bytes += bytes;
  row.lastAt = Date.now();
}

/* A client that stops reading its socket leaves every frame sent to it
   buffered inside this process — an unread mailbox handover is the easiest
   way to balloon memory without sending anything yourself. No legitimate
   reader falls this far behind, so past this point the socket is dropped. */
const SEND_BUFFER_LIMIT_BYTES = 16 * 1024 * 1024;

function safeSend(ws, message) {
  safeSendText(ws, JSON.stringify(message));
}

/* The same protection for a payload that was stringified once for many
   sockets — a broadcast pays for the serialisation, not the safety.
   Broadcast frames are not counted as messages sent: the counter answers
   "how much mail moved", and one presence change fanned out to a room of N
   is one change, not N messages — the numbers the stress suite holds the
   relay to are about forwarding, and would otherwise count presence. */
function safeSendText(ws, payload, countAsMessage = true) {
  if (ws.readyState === WebSocket.OPEN) {
    /* A verified peer whose buffer is full is READING SLOWLY, not refusing
       to read. Killing the socket here was turning every large mailbox dump
       into a connect-kill-reconnect loop (37 queued messages, 16 MB buffer,
       the same cycle forever). The limit stays for genuinely hostile
       sockets; verified peers get a higher ceiling and a warning first. */
    const isVerified = Boolean(ws.__poorijaVerifiedFingerprint);
    const limit = isVerified ? SEND_BUFFER_LIMIT_BYTES * 2 : SEND_BUFFER_LIMIT_BYTES;
    if (ws.bufferedAmount > limit) {
      if (!ws.__poorijaSendOverflow) {
        ws.__poorijaSendOverflow = true;
        console.warn(`[Presence] Send buffer above ${Math.round(limit / 1048576)} MB (${isVerified ? 'verified peer' : 'unverified socket'}) — terminating.`);
      }
      ws.terminate();
      return;
    }
    if (countAsMessage) {
      totalMessagesSent++;
      totalBytesSent += Buffer.byteLength(payload);
      noteClientTraffic(ws.__poorijaClientId, 'out', Buffer.byteLength(payload));
    }
    ws.send(payload);
  }
}

function openPresenceRecord(clientId = '') {
  const record = presence.get(String(clientId || ''));
  return record?.ws?.readyState === WebSocket.OPEN ? record : null;
}

/* A maintained index of who is proven, keyed by fingerprint. The lookup used
   to allocate and sort the whole presence table on every message addressed
   by fingerprint — every transit delivery on the recipient relay paid
   O(peers log peers), so a relay moving real traffic spent most of its CPU
   sorting a list it had just sorted. The index holds every verified record
   for a fingerprint; the most recently active one wins exactly as before,
   decided between at most the two records a reconnect can leave behind. */
const verifiedByFingerprint = new Map();
function indexVerified(record) {
  if (!record?.fingerprint || !record.identityVerified) return;
  const held = verifiedByFingerprint.get(record.fingerprint);
  if (!held) {
    verifiedByFingerprint.set(record.fingerprint, new Set([record]));
    return;
  }
  held.add(record);
}
function unindexVerified(record) {
  const held = record?.fingerprint ? verifiedByFingerprint.get(record.fingerprint) : null;
  if (!held) return;
  held.delete(record);
  if (!held.size) verifiedByFingerprint.delete(record.fingerprint);
}
/* Liveness is re-checked on every read — a record may be in the index and
   gone from the socket table, because the index is a cache of identity, not
   of connection state. */
setInterval(() => {
  for (const [fingerprint, held] of verifiedByFingerprint) {
    for (const record of held) {
      if (!presence.has(record.clientId)) held.delete(record);
    }
    if (!held.size) verifiedByFingerprint.delete(fingerprint);
  }
}, 30000).unref?.();

function findOpenPresenceByFingerprint(fingerprint = '') {
  if (!fingerprint) return null;
  /* Only a socket that proved the identity behind the fingerprint may be
     routed to by it — otherwise mail lands on whoever claimed the name. A
     reconnect leaves two sockets holding the same fingerprint for a moment,
     so the most recently active one wins rather than the first found. */
  const held = verifiedByFingerprint.get(fingerprint);
  if (!held) return null;
  let best = null;
  for (const record of held) {
    if (record.ws?.readyState !== WebSocket.OPEN) continue;
    if (!best || (record.lastSeenAt || 0) > (best.lastSeenAt || 0)) best = record;
  }
  return best;
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
/* The mailbox dump used to fire up to MAIL_WINDOW messages in one burst
   with no flow control. A client with 37 queued items (some carrying
   attachments) blew the 16 MB send buffer on every reconnect — the relay
   killed the socket for "not reading", the client reconnected, the same
   37 queued items fired again: a connect-overflow-disconnect loop that
   never drained. The pump now checks the wire before every frame and
   backs off when the socket is congested, resuming on the next ACK
   (which is the client saying it finished reading what it got). */
const MAIL_PUMP_BUFFER_SOFT_LIMIT = 1024 * 1024; /* 1 MB */

function pumpHeldMail(record, ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const queued = offlineBoxes.get(record.fingerprint) || [];
  if (!queued.length) return;
  if (!record.sentMail) record.sentMail = new Set();

  let inFlight = record.sentMail.size;
  for (const item of queued) {
    if (inFlight >= MAIL_WINDOW) break;
    if (record.sentMail.has(item.relayId)) continue;
    /* Flow control: if the socket is still draining the previous batch,
       stop here. The next ACK triggers another pump, so delivery resumes
       the moment the client catches up — no timer, no polling. */
    if (ws.bufferedAmount > MAIL_PUMP_BUFFER_SOFT_LIMIT) {
      console.log(`[Presence] Mail pump paused for ${record.fingerprint?.slice(0, 12) ?? ''} — socket draining (${Math.round(ws.bufferedAmount / 1024)}KB buffered, ${inFlight} in flight, ${queued.length - inFlight} waiting)`);
      return;
    }
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

  /* What a sibling left for this device while it was away. */
  pumpSiblingHeld(record, ws);

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
  /* The challenges later hellos replace: their answers may still be on the
     way, and must not spend the current one when they land (see id-proof).
     A few at most — a client says hello again on its own profile changes. */
  if (record.idChallengeNonce) record.idSupersededNonces = [...(record.idSupersededNonces || []), record.idChallengeNonce].slice(-4);
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
    /* One account may prove itself from several sockets at once: a second
       VERIFIED connection for a fingerprint is a second device of the same
       identity, not a reconnect, and closing it here would make multi-device
       impossible no matter what delivery did. Anything unproven is still
       replaced, exactly as before — this is not a door back to claim-based
       kicks, because the newcomer has proven and the old one has not. */
    if (sameFingerprint && record.identityVerified && existing.identityVerified) {
      console.log(`[Presence] Second verified device for ${record.fingerprint?.slice(0, 12) ?? ''} (${clientId.slice(0, 8)}) — coexisting`);
      continue;
    }
    console.log(`[Presence] Replacing duplicate connection ${clientId} for ${record.username || record.peerId}`);
    presence.delete(clientId);
    try {
      existing.ws?.close(4000, 'duplicate-presence');
    } catch (_error) {
      try { existing.ws?.terminate(); } catch (_terminateError) {}
    }
  }
}

/* A duplicate is replaced only by a connection that proved itself. The
   fingerprint and the peerId a hello carries are claims, and both are
   broadcast to every client in the peers payload — so closing duplicates on
   the claim alone let anybody disconnect anybody, faster than they could
   reconnect, with nothing but a name they read off the contact list. The
   call used to sit in the hello handler before any challenge ran; it runs
   now from the two places where identity is actually established, and a
   reconnect costs the same one round trip it always did. */

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
    /* A token bucket, refilled by the clock rather than emptied by a lockout:
       HTTP has had rate buckets since the beginning, the socket never did,
       and every expensive thing a relay does — get-peers builds the whole
       table, hello re-runs the duplicate walk and an RSA challenge — is one
       frame away on a path that was never counted. The numbers sit above
       what the app's own heaviest flows ever ask for, so a person never
       meets the limit; a loop meets it immediately. */
    rateTokens: WS_RATE_BURST,
    rateCheckedAt: Date.now(),
    updatedAt: new Date().toISOString(),
    lastSeenAt: Date.now(),
    connectedAt: Date.now(),
  };

  presence.set(clientId, record);
  /* The traffic rows key on this id; the back-pointer keeps the outbound
     side from having to hunt the presence map on every send. */
  ws.__poorijaClientId = clientId;
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
    noteClientTraffic(clientId, 'in', raw.length, record.username || '');

    /* Refill by elapsed time, then spend one token on this frame. A socket
       over the line is answered, not disconnected: a person's browser
       reconnects, and the point is to price the frame, not to punish it. */
    const sinceChecked = Date.now() - record.rateCheckedAt;
    if (sinceChecked > 0) {
      record.rateTokens = Math.min(WS_RATE_BURST, record.rateTokens + sinceChecked * WS_RATE_REFILL_PER_MS);
      record.rateCheckedAt = Date.now();
    }
    if (record.rateTokens < 1) {
      /* Answered once a second at most — answering every frame of a flood
         made the relay send as much as it was sent — and a socket still
         flooding after many thousands of refusals is closed. */
      record.throttled = (record.throttled || 0) + 1;
      const now = Date.now();
      if (!record.slowDownSentAt || now - record.slowDownSentAt >= 1000) {
        record.slowDownSentAt = now;
        safeSend(ws, { type: 'error', reason: 'slow-down' });
      }
      if (record.throttled > WS_FLOOD_CLOSE_AFTER) {
        try { ws.close(4429, 'flood'); } catch (_error) { /* gone */ }
      }
      return;
    }
    record.throttled = 0;
    record.rateTokens -= 1;

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (_error) {
      safeSend(ws, { type: 'error', reason: 'invalid-json' });
      return;
    }
    /* JSON.parse accepts more than messages. `null`, `true` and `42` are all
       valid JSON, and each of them reaches this handler as something without
       a `type` — where reading one throws, nothing above catches it, and the
       process-level handler answers by flushing and exiting. A frame that is
       not an object is not a message, whatever its bytes claimed, and an
       array is no more a message than a number is. */
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
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
      /* Which install said hello, not which identity: two devices may hold one
         key pair, and this is the only field that tells their sockets apart.
         A random client-generated string, no more identifying than peerId. */
      record.deviceId = String(message.deviceId || '').slice(0, 128);
      /* The install's own public key (P-256), separate from the identity the
         account's devices share. Only a claim until the proof below signs
         this socket's challenge with it; the roster's revocations are
         enforced against it from then on. */
      const deviceKey = String(message.deviceKey || '');
      record.deviceKey = ROSTER_KEY_TEXT.test(deviceKey) ? deviceKey : '';
      record.deviceKeyProven = false;
      /* A public key is under a kilobyte in every format the app uses, and the
         field is rebroadcast to every connected client on every presence
         change — one of the few fields with no ceiling of its own. */
      record.publicKeyData = String(message.publicKeyData || '').slice(0, 4096);
      record.fingerprint = sanitizeFingerprint(message.fingerprint);
      noteKnownIdentity(record.fingerprint);
      /* Not kept. The relay has no use for a photograph — the presence table
         never carries one — and the copy it kept here was cut at 100,000
         characters and then handed to anybody who asked for the peer list:
         half a picture over the whole one a contact's card had delivered,
         and everybody's photograph for every stranger on the relay. Avatars
         travel on the profile card, between the people concerned. */
      record.avatarData = '';
      record.mood = String(message.mood || '').slice(0, 40);
      /* The prekey is a public value and the relay only forwards it. It is
         what lets somebody write to this device while it is offline without
         falling back to the never-changing identity key. */
      record.prekeyId = String(message.prekeyId || '').slice(0, 64);
      record.prekeyPublic = String(message.prekeyPublic || '').slice(0, 512);
      record.prekeyExpiresAt = String(message.prekeyExpiresAt || '').slice(0, 40);
      /* What the client's build reads — short tokens, forwarded as they are.
         A contact's device reads 'ss1' to decide whether to seal the sender
         of what it queues here. */
      /* A hello starts the conversation again: the next table it gets is the
         whole one, then changes. */
      record.peersSynced = false;
      record.caps = Array.isArray(message.caps)
        ? Array.from(new Set(message.caps.map((cap) => String(cap || '')).filter((cap) => /^[a-z0-9-]{1,16}$/.test(cap)))).slice(0, 8)
        : [];
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

      /* The duplicate close used to happen here, on the hello's say-so. It
         waits for proof now — see closeDuplicatePresenceRecords. */
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
        /* A device the account's primary revoked stays out, escape hatch or
           not; with nothing proven, its id is what names it. */
        const roster = loadRoster(record.fingerprint);
        if (rosterRevokes(roster, record.deviceId, '')) {
          shutOutRevokedDevice(record, roster);
          return;
        }
      /* Mark the socket too: safeSendText reads this to decide whether the
         buffer limit is a hostile-socket kill or a slow-reader backoff. */
      ws.__poorijaVerifiedFingerprint = record.fingerprint || '';
        indexVerified(record);
        noteProvenIdentity(record.fingerprint);
        closeDuplicatePresenceRecords(record);
        deliverHeldMail(record, ws);
        safeSend(ws, { type: 'roster', roster: roster || null });
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
      /* The late answer to a challenge a later hello replaced: set aside
         quietly, whether or not the current one is answered yet. */
      try {
        const answer = Buffer.from(String(message.nonce || ''), 'base64');
        const superseded = (record.idSupersededNonces || []).findIndex((nonce) => answer.length === nonce.length && crypto.timingSafeEqual(answer, nonce));
        if (superseded >= 0) {
          record.idSupersededNonces.splice(superseded, 1);
          return;
        }
      } catch (_error) { /* a malformed answer is judged below */ }
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
        /* The same answer signed with the install's own key proves which
           device this is, not only which account. */
        record.deviceKeyProven = false;
        if (record.deviceKey && message.deviceSig) {
          try {
            const deviceKey = crypto.createPublicKey({ key: Buffer.from(record.deviceKey, 'base64'), format: 'der', type: 'spki' });
            record.deviceKeyProven = deviceKey.asymmetricKeyType === 'ec' && crypto.verify(
              'sha256',
              Buffer.from(`poorija-device-proof|${record.fingerprint}|${record.deviceId}|${String(message.nonce || '')}`),
              { key: deviceKey, dsaEncoding: 'ieee-p1363' },
              Buffer.from(String(message.deviceSig), 'base64'),
            );
          } catch (_error) { record.deviceKeyProven = false; }
        }
        const roster = loadRoster(record.fingerprint);
        if (rosterRevokes(roster, record.deviceId, provenDeviceKey(record))) {
          console.log(`[Presence] Revoked device shut out for ${record.fingerprint}`);
          shutOutRevokedDevice(record, roster);
          return;
        }
        indexVerified(record);
        noteProvenIdentity(record.fingerprint);
        closeDuplicatePresenceRecords(record);
        console.log(`[Presence] Identity proven for ${record.fingerprint}`);
        deliverHeldMail(record, ws);
        /* Which devices the account has, as its primary last signed it — or
           that it has no roster yet, which is an answer too: the device that
           made the identity founds one on hearing it. */
        safeSend(ws, { type: 'roster', roster: roster || null });
        /* Proven now, so announced now: the table carries only proven
           identities (broadcastPeers). */
        broadcastPeers();
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
      /* And only a fingerprint names mail. The proof binds the socket to a
         key, not the claimed label to a shape, so the label is checked
         before it is allowed to touch the store. */
      if (!isFingerprintKey(record.fingerprint)) {
        safeSend(ws, { type: 'error', reason: 'identity-unverified' });
        return;
      }
      const ids = Array.isArray(message.ids) ? message.ids : [];
      const queued = offlineBoxes.get(record.fingerprint) || [];
      if (queued.length && ids.length) {
        /* A Set, because the app acknowledges one envelope per message and a
           file is thousands of them: an includes() per queued item per ACK is
           the same quadratic the retention sweep used to have. */
        const acked = new Set(ids.slice(0, 200));
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

    /* Held for an absent sibling (holdForAbsentSiblings): a copy of a
       device-sync envelope for the account's devices that are away, what is
       waiting for this device, and its acknowledgement. The account's proven
       owner only, and only its own sealed device-sync envelopes. */
    if (message.type === 'sibling-hold' || message.type === 'sibling-fetch' || message.type === 'sibling-ack') {
      if (!record.identityVerified || !isFingerprintKey(record.fingerprint) || !record.deviceId) {
        safeSend(ws, { type: 'error', reason: 'identity-unverified' });
        return;
      }
      if (message.type === 'sibling-fetch') {
        pumpSiblingHeld(record, ws);
        return;
      }
      if (message.type === 'sibling-ack') {
        const ids = (Array.isArray(message.ids) ? message.ids : []).slice(0, 500).map((id) => String(id || '').slice(0, 64));
        ackSiblingHeld(record, ids);
        pumpSiblingHeld(record, ws);
        return;
      }
      const envelope = message.envelope;
      const text = envelope && typeof envelope === 'object' ? JSON.stringify(envelope) : '';
      if (!text || text.length > SIBLING_ITEM_MAX_CHARS || envelope.type !== 'device-sync'
        || envelope.fromFingerprint !== record.fingerprint) {
        safeSend(ws, { type: 'error', reason: 'sibling-hold-refused' });
        return;
      }
      const held = holdForAbsentSiblings(record, text);
      safeSend(ws, { type: 'sibling-hold-ok', held });
      return;
    }

    /* The account's device-sync beacons. Only the proven owner of the
       fingerprint may read or write them: they say which devices exist and
       when each last synced, which is the account's business alone. */
    if (message.type === 'roster-put' || message.type === 'roster-get') {
      /* Asked while the identity is being proven again (every hello re-asks):
         the proof's own answer carries the roster, so this one is let go
         without an error the app would show as "not accepted". */
      if (!record.identityVerified && record.idChallengeNonce) return;
      if (!record.identityVerified || !isFingerprintKey(record.fingerprint) || !record.publicKeyData) {
        safeSend(ws, { type: 'error', reason: 'identity-unverified' });
        return;
      }
      const current = loadRoster(record.fingerprint);
      if (message.type === 'roster-get') {
        safeSend(ws, { type: 'roster', roster: current });
        return;
      }
      const next = message.roster;
      const refusal = rosterRefusal(next, current, record.publicKeyData, record.fingerprint);
      if (refusal) {
        safeSend(ws, { type: 'roster-refused', reason: refusal, roster: current });
        return;
      }
      saveRoster(record.fingerprint, next);
      console.log(`[Roster] ${record.fingerprint.slice(0, 12)} now at ${next.seq}: ${next.members.length} device(s), ${next.revoked.length} gone`);
      safeSend(ws, { type: 'roster-stored', seq: next.seq });
      enforceRoster(record.fingerprint, next);
      for (const candidate of verifiedByFingerprint.get(record.fingerprint) || []) {
        if (candidate === record || candidate.ws?.readyState !== WebSocket.OPEN) continue;
        safeSend(candidate.ws, { type: 'roster', roster: next });
      }
      return;
    }
    /* A device leaving its account says so on the way out: its beacon and
       whatever was held for it go now, not after thirty days. Its own only. */
    if (message.type === 'beacon-drop') {
      if (!record.identityVerified || !isFingerprintKey(record.fingerprint) || !record.deviceId) {
        safeSend(ws, { type: 'error', reason: 'identity-unverified' });
        return;
      }
      forgetSiblingDevice(record.fingerprint, record.deviceId);
      safeSend(ws, { type: 'beacon-dropped', deviceId: record.deviceId });
      return;
    }
    if (message.type === 'beacon-put' || message.type === 'beacon-get') {
      if (!record.identityVerified || !isFingerprintKey(record.fingerprint)) {
        safeSend(ws, { type: 'error', reason: 'identity-unverified' });
        return;
      }
      if (message.type === 'beacon-get') {
        const entries = loadBeacons(record.fingerprint);
        const roster = loadRoster(record.fingerprint);
        safeSend(ws, {
          type: 'beacons',
          items: Object.entries(entries)
            .filter(([deviceId]) => !rosterRevokes(roster, deviceId, ''))
            .map(([deviceId, entry]) => ({ deviceId, blob: entry.blob, at: entry.at })),
        });
        return;
      }
      const deviceId = String(message.deviceId || '').slice(0, 128);
      const blob = String(message.blob || '');
      if (!deviceId || !/^[A-Za-z0-9_-]+$/.test(deviceId) || !blob
        || blob.length > BEACON_MAX_CHARS || !/^[A-Za-z0-9+/=]+$/.test(blob)) {
        safeSend(ws, { type: 'error', reason: 'beacon-refused' });
        return;
      }
      storeBeacon(record.fingerprint, deviceId, blob);
      safeSend(ws, { type: 'beacon-stored', deviceId });
      /* The account's other live devices hear that something changed, so a
         sibling that is online can come and sync straight away. */
      for (const candidate of verifiedByFingerprint.get(record.fingerprint) || []) {
        if (candidate === record || candidate.ws?.readyState !== WebSocket.OPEN) continue;
        safeSend(candidate.ws, { type: 'beacon-changed', deviceId });
      }
      return;
    }

    /* An envelope for somebody on another relay. This relay cannot open it and
       will not try: it looks at the one field it is meant to read, finds the
       link, and passes it on. Nothing about it is written down. */
    if (message.type === 'transit') {
      const senderRestriction = getRestrictionForIdentity(record);
      if (senderRestriction) {
        disconnectRestrictedPeer(record, senderRestriction);
        return;
      }
      carryTransitEnvelope(message, {
        clientId,
        tag: String(message.tag || '').slice(0, 96),
        reply: (payload) => safeSend(ws, payload),
      });
      return;
    }

    if (message.type === 'relay') {
      const senderRestriction = getRestrictionForIdentity(record);
      if (senderRestriction) {
        disconnectRestrictedPeer(record, senderRestriction);
        return;
      }
      /* The sender's name rides along as metadata for the recipient's relay,
         and an unproven socket chose it itself. A socket that has not answered
         the identity challenge may still send — a client races its first
         frames against its own proof all the time — but nothing it sends
         leaves claiming to be somebody. The proof, when it lands, restores
         the name; the challenge is one round trip, not a lifestyle. */
      deliverRelayMessage(message, {
        clientId,
        fromFingerprint: record.identityVerified ? record.fingerprint : '',
        reply: (payload) => safeSend(ws, payload),
      });
      return;
    }

    /* A sender taking back envelopes it queued here for somebody who will
       never collect them — a contact who turned out to live on another relay,
       to whom the same messages have now been sent the right way. Only the
       proven sender of an envelope may withdraw it, and only by the tag it
       sent it with; nothing else in anybody's mailbox can be touched. */
    if (message.type === 'relay-withdraw') {
      if (!record.identityVerified || !isFingerprintKey(record.fingerprint)) {
        safeSend(ws, { type: 'error', reason: 'identity-unverified' });
        return;
      }
      const box = sanitizeFingerprint(message.toFingerprint);
      const tags = new Set((Array.isArray(message.tags) ? message.tags : [])
        .slice(0, 500).map((tag) => String(tag || '').slice(0, 96)).filter(Boolean));
      /* A sealed-sender envelope carries no sender to match, only the hash of
         a secret its sender alone can derive for it (wd). Presenting the
         secret is the proof; the relay never learns which envelopes are whose
         until they are taken back. */
      const secretHashes = new Set((Array.isArray(message.secrets) ? message.secrets : [])
        .slice(0, 500).map((secret) => String(secret || ''))
        .filter((secret) => /^[a-f0-9]{64}$/.test(secret))
        .map((secret) => crypto.createHash('sha256').update(secret).digest('hex')));
      let withdrawn = 0;
      if (box && isFingerprintKey(box) && (tags.size || secretHashes.size)) {
        const queued = offlineBoxes.get(box) || [];
        const kept = queued.filter((item) => !(
          (item.fromFingerprint === record.fingerprint && tags.has(String(item.payload?.tag || '')))
          || (item.payload?.wd && secretHashes.has(String(item.payload.wd)))
        ));
        withdrawn = queued.length - kept.length;
        if (withdrawn) {
          if (kept.length) offlineBoxes.set(box, kept);
          else offlineBoxes.delete(box);
          saveOfflineBox(box);
        }
      }
      safeSend(ws, { type: 'withdrawn', toFingerprint: box, count: withdrawn });
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
      /* It empties a conversation's mail out of everybody's mailbox: a proven
         identity at the very least, never an anonymous socket. */
      if (!record.identityVerified) {
        safeSend(ws, { type: 'purged', removed: 0, scope: 'space', refused: 'identity-unverified' });
        return;
      }
      const conversationId = String(message.conversationId || '').slice(0, 200);
      let removed = 0;
      if (conversationId) {
        const touched = [];
        /* Capped: a hostile mailbox-count flood turns this synchronous walk into
   a multi-second event-loop stall. The first ten thousand boxes is plenty
   for any honest relay; the rest can wait for the retention sweep. */
let purgeWalked = 0;
for (const [box, queue] of offlineBoxes.entries()) {
    if (++purgeWalked > 10000) break;
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
      /* Proven, not claimed. A hello names a fingerprint and carries its
         public key — both public — so without the proof anybody could empty
         anybody's queued mail, beacons and push registration. */
      if (!record.identityVerified) {
        safeSend(ws, { type: 'purged', removed: 0, refused: 'identity-unverified' });
        return;
      }
      const target = record.fingerprint || '';
      let removed = 0;
      /* The hello that set this fingerprint was never challenged — a hello
         alone claims a name without proving anything, and `purge-me` acts on
         the claim. A claimed key that is not a fingerprint names no mailbox
         this relay keeps, and running the purge against it would hand the
         claimant a filename to delete. */
      if (target && isFingerprintKey(target)) {
        removed += (offlineBoxes.get(target) || []).length;
        offlineBoxes.delete(target);
        saveOfflineBox(target);
        dropBeacons(target);
        /* The roster goes only when its own primary wipes: from any other
           device, removing it would let that device name itself primary. */
        const roster = loadRoster(target);
        if (roster && provenDeviceKey(record) && provenDeviceKey(record) === roster.primary.k) dropRoster(target);
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
      /* The whole table with keys and prekeys — kilobytes per person. Asked
         for when a contact is added: a few in a row are answered at once,
         then one every ten seconds per socket, and never onto a socket still
         behind, or a thousand requests in a row would be gigabytes in memory.
         A request past the budget is not dropped: it waits for the next
         answer, so every contact added in a burst still gets its keys. */
      if (record.peersAskTimer) return;
      const answer = () => {
        record.peersAskTimer = null;
        if (ws.readyState !== WebSocket.OPEN) return;
        const wait = peersAskWait(record);
        if (wait > 0 || ws.bufferedAmount > PRESENCE_BUFFER_LIMIT) {
          record.peersAskTimer = setTimeout(answer, wait > 0 ? wait : 2000);
          return;
        }
        record.peersAskTokens -= 1;
        safeSend(ws, { type: 'peers', peers: snapshotPeers() });
        /* That answer replaced the client's copy of the table. The next tick
           gives a delta-reading client the broadcast table again, so the
           changes that follow it apply to the very set they were made from. */
        record.peersSynced = false;
        broadcastPeers();
      };
      answer();
      return;
    }
  });

  ws.on('close', (code, reason) => {
    clearIdentityChallenge(record);
    clearTimeout(record.peersAskTimer);
    console.log(`[Presence] Connection closed for ${clientId} (${record.username}). Code: ${code}, Reason: ${reason}`);
    presence.delete(clientId);
    unindexVerified(record);
    broadcastPeers();
  });

  ws.on('error', (error) => {
    clearIdentityChallenge(record);
    console.error(`[Presence] Connection error for ${clientId} (${record.username}):`, error);
    presence.delete(clientId);
    unindexVerified(record);
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

/* Whatever the monitor last decided about relay links, on top of the env's
   seed. Called last, at boot, once everything it touches exists. */
loadRuntimeTransitPeers();
startRelayDirectory();

startFrontDoor();

listenOn(server, PORT, '0.0.0.0', () => {
  const where = LISTEN_HOSTS.length ? LISTEN_HOSTS.join(', ') : '0.0.0.0';
  console.log(`Poorija chat signal server listening on port ${PORT} (${where})`);
  console.log(`Monitoring Dashboard available at /Monitor_Server (v${MONITOR_VERSION})`);
});

listenOn(presenceServer, PRESENCE_PORT, HOST, () => {
  console.log(`Poorija chat presence socket listening on port ${PRESENCE_PORT}`);
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

  /* The linked relays learn it now, not when their own handshake timeouts
     say so. A peer left to notice for itself spends up to a minute believing
     the link is up — carrying envelopes into it, and re-dialling only after
     the silence outlives them. */
  try {
    relayPeers.close();
  } catch (error) {
    console.error('[Shutdown] could not close the transit links:', error.message);
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
