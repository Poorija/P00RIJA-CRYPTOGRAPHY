/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A relay's updates: keeping a package, passing it along the family, and
 * applying it at the right time.
 *
 * KEEPING. Only a package the operator key signed (update-package.js), and
 * only one newer than what runs. It is kept as a file anybody on the machine
 * may read, beside the hash of the whole file: the apply step, run by the
 * install's owner on the host, checks that hash before it unpacks anything.
 *
 * THE CHAIN. Every few minutes the relay asks its family (the relays in the
 * signed directory) what they have. A newer package one of them holds is
 * fetched from it and checked here like any other; the time the operator
 * chose for it, if any, comes along. A relay that cannot reach the panel, or
 * a given member, still gets the package from any member it can reach, and
 * hands it on in turn. A package is handed only to a member of the signed
 * family, who proves it with its relay key: ECDH between the two relays'
 * keys, then an HMAC over the path and the time.
 *
 * THE TIME. The operator's ("schedule"), at once ("now"), or watching: when
 * as few people are on as are usually on at the quietest hours of the last
 * week, or nobody. Whoever is on is told a couple of minutes before; the
 * page shows that the server is updating until it is back.
 *
 * APPLYING is the deployment's to do (launchApply): the relay hands over the
 * checked file and is restarted by what it started. After the restart it
 * reads how it went (result.json). A failure is reported and never retried
 * by itself: the operator decides. */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { verifyPackage, compareVersions, hashRange } = require('./update-package.js');
const { canonicalJson } = require('./relay-directory.js');
const { relayIdFor } = require('./relay-identity.js');

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const AUTH_WINDOW_MS = 5 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const APPLY_TIMEOUT_MS = 40 * 60 * 1000;

/* ---- the family check ------------------------------------------------------ */

function sharedKey(privateKey, publicKeySpki, info) {
  const peer = crypto.createPublicKey({ key: Buffer.from(publicKeySpki, 'base64'), format: 'der', type: 'spki' });
  const secret = crypto.diffieHellman({ privateKey, publicKey: peer });
  return Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.from('p00rija-update'), Buffer.from(info), 32));
}

/* "<requester id>.<its key, base64url>.<time>.<hmac>" */
function makeUpdateAuth({ self, server, path: pathname, now = Date.now() }) {
  const at = String(Math.floor(now / 1000));
  const key = sharedKey(self.privateKey, server.publicKey, `${self.id}>${server.id}`);
  const mac = crypto.createHmac('sha256', key).update(`GET ${pathname} ${at}`).digest('hex');
  return [self.id, Buffer.from(self.publicKey, 'base64').toString('base64url'), at, mac].join('.');
}

function verifyUpdateAuth(header, { self, isMember, path: pathname, now = Date.now() }) {
  const parts = String(header || '').split('.');
  if (parts.length !== 4) return { ok: false, reason: 'no-proof' };
  const [id, keyText, at, mac] = parts;
  if (!/^[0-9a-f]{64}$/.test(id) || !/^[0-9]{1,12}$/.test(at) || !/^[0-9a-f]{64}$/.test(mac)) return { ok: false, reason: 'bad-proof' };
  if (Math.abs(now - Number(at) * 1000) > AUTH_WINDOW_MS) return { ok: false, reason: 'stale' };
  const publicKey = Buffer.from(keyText, 'base64url').toString('base64');
  try {
    if (relayIdFor(publicKey) !== id) return { ok: false, reason: 'key-not-id' };
  } catch (_error) {
    return { ok: false, reason: 'bad-key' };
  }
  if (!isMember(id)) return { ok: false, reason: 'not-family' };
  let want;
  try {
    const key = sharedKey(self.privateKey, publicKey, `${id}>${self.id}`);
    want = crypto.createHmac('sha256', key).update(`GET ${pathname} ${at}`).digest();
  } catch (_error) {
    return { ok: false, reason: 'bad-key' };
  }
  const given = Buffer.from(mac, 'hex');
  return given.length === want.length && crypto.timingSafeEqual(given, want) ? { ok: true, id } : { ok: false, reason: 'bad-proof' };
}

/* ---- the policy ------------------------------------------------------------ */

/* When to apply is the operator's to say. The dashboard of one relay may set
   it for that relay; for it to travel along the family it must carry the
   operator key's signature over the version it is for, or one member could
   tell every other one to restart now. */
const policyText = ({ version, mode, at }) => canonicalJson({ v: 1, version, mode, at: at || null });

function signPolicy({ version, mode, at }, privateKeyPem) {
  return crypto.sign('sha256', Buffer.from(policyText({ version, mode, at }), 'utf8'), privateKeyPem).toString('base64');
}

function policySigned(policy, version, operatorKey) {
  if (!policy?.sig || !VERSION.test(String(version || ''))) return false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(String(operatorKey || ''), 'base64'), format: 'der', type: 'spki' });
    return crypto.verify('sha256', Buffer.from(policyText({ version, mode: policy.mode, at: policy.at }), 'utf8'), key, Buffer.from(String(policy.sig), 'base64'));
  } catch (_error) {
    return false;
  }
}

function cleanPolicy(policy) {
  const mode = ['watch', 'schedule', 'now'].includes(policy?.mode) ? policy.mode : 'watch';
  const sig = typeof policy?.sig === 'string' && /^[A-Za-z0-9+/=]{40,200}$/.test(policy.sig) ? policy.sig : undefined;
  if (mode !== 'schedule') return { mode, at: null, ...(sig ? { sig } : {}) };
  /* The time as it was given, if it is a time: the signature is over it. */
  const at = Number.isFinite(Date.parse(String(policy?.at || ''))) ? String(policy.at) : null;
  return at ? { mode, at, ...(sig ? { sig } : {}) } : { mode: 'watch', at: null };
}

function percentile(values, share) {
  if (!values.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * (sorted.length - 1)))];
}

/* ---- the updates ----------------------------------------------------------- */

function createRelayUpdates({
  dir, operatorKey, currentVersion, self, peers = () => [], isMember = () => false,
  fetchJson, fetchFile, onlineCount = () => 0, notifyClients = () => {}, launchApply,
  now = () => Date.now(), noticeMs = 120000, sampleMs = 5 * 60 * 1000, log = () => {}, onEvent = () => {},
}) {
  /* For the operator's Telegram: each step of an update as it happens. */
  const tell = (event) => { try { onEvent(event); } catch (_error) { /* the listener's own trouble */ } };
  const incomingDir = path.join(dir, 'incoming');
  /* The relay's own working copies: a package is checked as the copy kept
     here, never as the file it was handed, which sits where others on the
     machine may write; and a download goes here under a name nobody can
     guess, opened only if it does not exist yet. */
  const workDir = path.join(dir, 'work');
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(workDir, 0o700); } catch (_error) { /* not ours to change */ }
  const workFile = (suffix) => path.join(workDir, `${crypto.randomBytes(12).toString('hex')}${suffix}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  try { fs.chmodSync(dir, 0o755); } catch (_error) { /* not ours to change */ }
  /* The panel copies a package in over SSH as the install's owner, who may
     not be the user this relay runs as: the sticky bit, as on /tmp. */
  fs.mkdirSync(incomingDir, { recursive: true });
  try { fs.chmodSync(incomingDir, 0o1777); } catch (_error) { /* not ours to change */ }
  const stateFile = path.join(dir, 'state.json');
  const activityFile = path.join(dir, 'activity.json');
  const resultFile = path.join(dir, 'result.json');
  const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return fallback; } };
  let state = {
    staged: null, available: null, policy: { mode: 'watch', at: null }, phase: 'idle',
    notifiedAt: null, applyingSince: null, lastResult: null, checkedPeersAt: null, ...read(stateFile, {}),
  };
  let activity = read(activityFile, []);
  let busy = false;
  const save = () => {
    fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state, null, 2));
    fs.renameSync(`${stateFile}.tmp`, stateFile);
  };
  const fileFor = (version) => path.join(dir, `p00rija-update-${version}.tar`);

  /* What came of an apply, read once after the restart. */
  function settle() {
    const result = read(resultFile, null);
    const running = currentVersion();
    if (state.staged && compareVersions(state.staged.version, running) <= 0) {
      state.lastResult = { ok: true, version: state.staged.version, at: result?.at || new Date(now()).toISOString() };
      tell({ kind: 'done', version: state.staged.version });
      state.staged = null;
      state.phase = 'idle';
      state.notifiedAt = null;
      state.applyingSince = null;
    } else if (state.phase === 'applying' && result && Number(result.code) !== 0 && result.version === state.staged?.version) {
      state.lastResult = { ok: false, version: result.version, code: Number(result.code), at: result.at };
      state.phase = 'failed';
      tell({ kind: 'failed', version: result.version, reason: `exit ${Number(result.code)}` });
    } else if (state.phase === 'applying' && now() - Date.parse(state.applyingSince || 0) > APPLY_TIMEOUT_MS) {
      state.lastResult = { ok: false, version: state.staged?.version, reason: 'timeout', at: new Date(now()).toISOString() };
      state.phase = 'failed';
      tell({ kind: 'failed', version: state.staged?.version, reason: 'timeout' });
    }
    if (result) { try { fs.renameSync(resultFile, `${resultFile}.seen`); } catch (_error) { /* gone */ } }
  }
  settle();
  save();

  async function stage(file, { from = 'panel', policy, trusted = from === 'panel' } = {}) {
    let copy = file;
    if (path.dirname(path.resolve(file)) !== workDir) {
      copy = workFile('.tar');
      try { fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL); } catch (error) { return { ok: false, reason: 'unreadable', detail: error.message }; }
    }
    const verdict = verifyPackage(copy, operatorKey());
    if (!verdict.ok) {
      try { if (copy !== file) fs.unlinkSync(copy); } catch (_error) { /* gone */ }
      log(`update: refused a package from ${from}: ${verdict.reason}`);
      return { ok: false, reason: verdict.reason };
    }
    file = copy;
    const { version } = verdict.manifest;
    const newest = state.staged && compareVersions(state.staged.version, currentVersion()) > 0 ? state.staged.version : currentVersion();
    const drop = () => { try { fs.unlinkSync(file); } catch (_error) { /* gone */ } };
    if (compareVersions(version, currentVersion()) <= 0) { drop(); return { ok: false, reason: 'not-newer', version }; }
    if (state.staged && compareVersions(version, newest) < 0) { drop(); return { ok: false, reason: 'older-than-staged', version }; }
    const target = fileFor(version);
    if (path.resolve(file) !== target) fs.renameSync(file, target);
    fs.chmodSync(target, 0o644);
    const size = fs.statSync(target).size;
    const sha256 = hashRange(target, 0, size);
    fs.writeFileSync(`${target}.sha256`, `${sha256}\n`, { mode: 0o644 });
    /* One package kept: the one staged. */
    for (const name of fs.readdirSync(dir)) {
      if (/^p00rija-update-.*\.tar(\.sha256)?$/.test(name) && !name.startsWith(path.basename(target))) {
        try { fs.unlinkSync(path.join(dir, name)); } catch (_error) { /* gone */ }
      }
    }
    state.staged = { version, file: target, sha256, size, stagedAt: new Date(now()).toISOString(), from, buildTag: verdict.manifest.buildTag };
    state.available = { version, file: target, sha256, size };
    /* The panel's word is taken as given; a peer's only when the operator
       signed it, for this version. Otherwise the relay watches. */
    if (policy) {
      const clean = cleanPolicy(policy);
      if (trusted || policySigned(clean, version, operatorKey())) state.policy = clean;
      else state.policy = { mode: 'watch', at: null };
      if (state.policy.sig && !policySigned(state.policy, version, operatorKey())) delete state.policy.sig;
    } else if (!trusted) {
      state.policy = { mode: 'watch', at: null };
    }
    state.phase = 'staged';
    state.notifiedAt = null;
    state.applyingSince = null;
    save();
    log(`update: ${version} kept (from ${from}), to apply: ${state.policy.mode}${state.policy.at ? ` at ${state.policy.at}` : ''}`);
    tell({ kind: 'staged', version, mode: state.policy.mode, at: state.policy.at });
    return { ok: true, version };
  }

  function status() {
    return {
      current: currentVersion(), phase: state.phase, staged: state.staged && { ...state.staged, file: path.basename(state.staged.file) },
      available: state.available && { version: state.available.version, size: state.available.size, sha256: state.available.sha256 },
      policy: state.policy, notifiedAt: state.notifiedAt, applyingSince: state.applyingSince, lastResult: state.lastResult,
      online: onlineCount(), quietLevel: quietLevel(), checkedPeersAt: state.checkedPeersAt,
    };
  }

  function offer() {
    return {
      id: self.id, publicKey: self.publicKey, version: currentVersion(),
      available: state.available && fs.existsSync(state.available.file) ? { version: state.available.version, size: state.available.size, sha256: state.available.sha256 } : null,
      /* Only a time the operator signed travels. */
      policy: state.staged && state.policy?.sig && policySigned(state.policy, state.staged.version, operatorKey()) ? state.policy : null,
    };
  }

  function packageFile(version) {
    if (!VERSION.test(String(version || '')) || state.available?.version !== version) return null;
    return fs.existsSync(state.available.file) ? state.available.file : null;
  }

  async function setPolicy(policy) {
    state.policy = cleanPolicy(policy);
    if (state.policy.sig && !policySigned(state.policy, state.staged?.version, operatorKey())) delete state.policy.sig;
    if (state.phase === 'failed' && state.staged) state.phase = 'staged';
    state.notifiedAt = null;
    save();
    return { ok: true, policy: state.policy };
  }

  async function cancel() {
    state.staged = null;
    state.phase = 'idle';
    state.notifiedAt = null;
    save();
    return { ok: true };
  }

  /* The chain: the newest signed package any member holds. */
  async function checkPeers() {
    if (busy) return { ok: false, reason: 'busy' };
    busy = true;
    try {
      state.checkedPeersAt = new Date(now()).toISOString();
      const best = { version: state.staged?.version || currentVersion() };
      const offers = [];
      for (const peer of peers()) {
        for (const origin of peer.origins || []) {
          try {
            const answer = await fetchJson(`${origin.replace(/\/+$/, '')}/p00rija-update/offer`);
            const theirs = answer?.json;
            if (!answer?.ok || !theirs || theirs.id !== peer.id || !VERSION.test(String(theirs.available?.version || ''))) continue;
            offers.push({ peer, origin, offer: theirs });
            break;
          } catch (_error) { /* the next origin */ }
        }
      }
      const newer = offers.filter(({ offer: theirs }) => compareVersions(theirs.available.version, best.version) > 0)
        .sort((x, y) => compareVersions(y.offer.available.version, x.offer.available.version));
      for (const { peer, origin, offer: theirs } of newer) {
        const version = theirs.available.version;
        const pathname = `/p00rija-update/package/${version}`;
        const part = workFile('.part');
        state.phase = 'downloading';
        save();
        try {
          const headers = { 'X-P00rija-Update-Auth': makeUpdateAuth({ self, server: { id: theirs.id, publicKey: theirs.publicKey }, path: pathname, now: now() }) };
          const got = await fetchFile(`${origin.replace(/\/+$/, '')}${pathname}`, { headers, to: part });
          if (!got?.ok) { log(`update: ${peer.id.slice(0, 12)} would not hand over ${version} (${got?.status})`); continue; }
          const kept = await stage(part, { from: peer.id.slice(0, 12), policy: theirs.policy || undefined, trusted: false });
          if (kept.ok) return { ok: true, version };
        } catch (error) {
          log(`update: fetching ${version} from ${peer.id.slice(0, 12)} failed: ${error.message}`);
        } finally {
          try { fs.unlinkSync(part); } catch (_error) { /* staged or gone */ }
          if (state.phase === 'downloading') state.phase = state.staged ? 'staged' : 'idle';
          save();
        }
      }
      return { ok: true, version: null };
    } finally {
      busy = false;
    }
  }

  /* ---- the watcher --------------------------------------------------------- */

  function sample() {
    const at = now();
    if (activity.length && at - activity[activity.length - 1].t < sampleMs * 0.9) return;
    activity.push({ t: at, n: onlineCount() });
    activity = activity.filter((entry) => at - entry.t <= WEEK_MS);
    try { fs.writeFileSync(activityFile, JSON.stringify(activity)); } catch (_error) { /* next time */ }
  }

  /* How many are on at the quietest tenth of the last week: at or below it
     is a quiet time. Too little history, and only an empty server is. */
  function quietLevel() {
    if (activity.length < 24) return 0;
    return percentile(activity.map((entry) => entry.n), 0.1);
  }

  function due(at) {
    const policy = state.policy || { mode: 'watch' };
    if (policy.mode === 'now') return true;
    if (policy.mode === 'schedule') return at >= Date.parse(policy.at);
    const users = onlineCount();
    if (users === 0 || users <= quietLevel()) return true;
    /* Never later than two days after it arrived, at a less busy moment. */
    const waited = at - Date.parse(state.staged?.stagedAt || at);
    if (waited > 24 * 3600 * 1000 && users <= percentile(activity.map((entry) => entry.n), 0.5)) return true;
    return waited > 48 * 3600 * 1000;
  }

  async function tick() {
    settle();
    const at = now();
    if (!state.staged || !['staged', 'notifying'].includes(state.phase)) { save(); return status(); }
    if (compareVersions(state.staged.version, currentVersion()) <= 0) { settle(); save(); return status(); }
    if (state.phase === 'staged') {
      if (!due(at)) return status();
      if (onlineCount() > 0) {
        state.phase = 'notifying';
        state.notifiedAt = new Date(at).toISOString();
        save();
        notifyClients({ version: state.staged.version, inSeconds: Math.round(noticeMs / 1000), minutes: 5 });
        log(`update: ${state.staged.version} in ${Math.round(noticeMs / 1000)} s; ${onlineCount()} online were told`);
        tell({ kind: 'notifying', version: state.staged.version, seconds: Math.round(noticeMs / 1000), online: onlineCount() });
        return status();
      }
    } else if (at - Date.parse(state.notifiedAt) < noticeMs) {
      return status();
    }
    state.phase = 'applying';
    state.applyingSince = new Date(at).toISOString();
    try { fs.unlinkSync(resultFile); } catch (_error) { /* none */ }
    save();
    log(`update: applying ${state.staged.version}`);
    tell({ kind: 'applying', version: state.staged.version });
    const started = await launchApply({ file: state.staged.file, version: state.staged.version });
    if (!started?.ok) {
      state.phase = 'failed';
      state.lastResult = { ok: false, version: state.staged.version, reason: started?.reason || 'could-not-start', at: new Date(now()).toISOString() };
      save();
      log(`update: could not start applying ${state.staged.version}: ${state.lastResult.reason}`);
      tell({ kind: 'failed', version: state.staged.version, reason: state.lastResult.reason });
    }
    return status();
  }

  function authorize(header, pathname) {
    return verifyUpdateAuth(header, { self, isMember, path: pathname, now: now() });
  }

  return { incomingDir, stage, status, offer, packageFile, setPolicy, cancel, checkPeers, sample, tick, authorize };
}

module.exports = { createRelayUpdates, makeUpdateAuth, verifyUpdateAuth, cleanPolicy, signPolicy, policySigned };
