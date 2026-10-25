/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Partners: families run by different operators that agreed to link
 * (docs/RELAY-NETWORK.md, "Linking with other operators").
 *
 * Two families meet only at their gateways, the relays each family names for
 * it, and only after the admin of the family that was asked approved. This
 * file decides the questions that come up on the way, and nothing here
 * touches the network:
 *
 *   - whether a join request really comes from a relay of the family it
 *     names, is meant for this operator, and is fresh;
 *   - how the relays of one family agree on what they share (partners, the
 *     gateways the admin chose): the later change wins;
 *   - which gateway carries now: one whose link has stood for a while before
 *     one that just came back, then the lower number;
 *   - whether a relay may carry on a frame that is not sealed to it.
 *
 * Signatures are P-256 ECDSA over the canonical JSON the relay directory
 * already uses, made with a relay's own identity key.
 */
'use strict';

const crypto = require('crypto');
const net = require('net');
const { canonicalJson, verifyDirectory } = require('./relay-directory.js');
const { relayIdFor } = require('./relay-identity.js');
/* The same judgement link previews make of an address: every range that is
   not global unicast, including those that carry a private IPv4 inside. */
const { isPublicAddress, isLocalName } = require('./link-preview.js');

const HEX64 = /^[a-f0-9]{64}$/;
const STATES = new Set(['requested', 'incoming', 'approved', 'rejected', 'removed']);
const REQUEST_WINDOW_MS = 10 * 60 * 1000;
/* Counted on arrival. The longest path the rules allow is four forwards: a
   member to its gateway, that gateway to a partner's, through a common
   partner to the far family's gateway, and on to the relay it is for. */
const HOP_LIMIT = 5;
/* A change stamped further ahead than this is refused: a stamp far in the
   future would win against every later change, for good. */
const MAX_SKEW_MS = 5 * 60 * 1000;
const MAX_GATEWAYS = 64;

function sign(fields, privateKey) {
  return crypto.sign('sha256', Buffer.from(canonicalJson(fields), 'utf8'), privateKey).toString('base64');
}

function signatureHolds(fields, keyBase64, sig) {
  try {
    const publicKey = crypto.createPublicKey({ key: Buffer.from(keyBase64, 'base64'), format: 'der', type: 'spki' });
    return crypto.verify('sha256', Buffer.from(canonicalJson(fields), 'utf8'), publicKey, Buffer.from(sig, 'base64'));
  } catch (_error) {
    return false;
  }
}

/* ---- join requests ------------------------------------------------------ */

/* What the sending relay's signature covers. The directory is not in it: it
   carries its own operator's signature, and the operator id and serial
   named here tie the request to that one directory. The contact address is:
   it is shown to the admin who decides, and must be the sender's word. */
const requestFields = (request) => ({
  v: 1,
  from: request.from,
  to: request.to,
  at: request.at,
  nonce: request.nonce,
  contact: request.contact === undefined ? '' : request.contact,
  operator: request.directory?.body?.operator?.id,
  serial: request.directory?.body?.serial,
});

function signJoinRequest({ directory, from, key, to, at, nonce, contact = '' }, relayPrivateKey) {
  const request = { v: 1, directory, from, key, to, at, nonce, contact };
  return { ...request, sig: sign(requestFields(request), relayPrivateKey) };
}

function wellFormedRequest(request) {
  if (!request || typeof request !== 'object' || request.v !== 1) return false;
  if (!HEX64.test(String(request.from || '')) || !HEX64.test(String(request.to || ''))) return false;
  if (typeof request.key !== 'string' || !request.key || typeof request.sig !== 'string' || !request.sig) return false;
  if (!Number.isSafeInteger(request.at) || !/^[a-f0-9]{32}$/.test(String(request.nonce || ''))) return false;
  if (request.contact !== undefined && (typeof request.contact !== 'string' || request.contact.length > 512)) return false;
  return Boolean(request.directory && typeof request.directory === 'object');
}

/* In this order: shape, the family's own signature, membership, the
   sender's key and signature, whom it is for, age, and whether the family
   has a gateway to link through. A request is believed about its family
   only once that family's operator key has vouched for the directory. */
function verifyJoinRequest(request, { selfOperatorId, now = Date.now(), nonceSeen = () => false } = {}) {
  if (!wellFormedRequest(request)) return { ok: false, reason: 'malformed' };
  const directory = request.directory;
  const operatorKey = String(directory?.body?.operator?.key || '');
  const verdict = verifyDirectory(directory, { operatorKey, selfId: request.from });
  if (!verdict.ok && verdict.reason !== 'not-a-member') return { ok: false, reason: 'bad-directory' };
  if (!verdict.ok) return { ok: false, reason: 'not-a-member' };
  if (relayIdFor(request.key) !== request.from) return { ok: false, reason: 'key-mismatch' };
  if (!signatureHolds(requestFields(request), request.key, request.sig)) return { ok: false, reason: 'bad-signature' };
  if (request.to !== selfOperatorId) return { ok: false, reason: 'wrong-operator' };
  if (Math.abs(now - request.at) > REQUEST_WINDOW_MS) return { ok: false, reason: 'stale' };
  if (nonceSeen(request.nonce)) return { ok: false, reason: 'replayed' };
  if (!directory.body.relays.some((relay) => Number(relay.gateway) > 0)) return { ok: false, reason: 'no-gateway' };
  return {
    ok: true,
    operatorId: directory.body.operator.id,
    operatorKey,
    name: String(directory.body.operator.name || ''),
    directory,
  };
}

/* ---- what a family shares ----------------------------------------------- */

const newer = (incoming, held) => !held
  || incoming.updatedAt > held.updatedAt
  || (incoming.updatedAt === held.updatedAt && String(incoming.updatedBy) > String(held.updatedBy));

/* Partner entries, one per operator id. Every relay of the family may change
   one (a dashboard button, a request arriving), so each change carries its
   time and the relay that made it, and the later one wins everywhere. The
   partner's directory is the exception: the higher serial is kept whichever
   entry wins, so two relays changing the same entry at once can never roll
   it back to one that still names a relay revoked since. */
function mergePartners(held = {}, incoming = [], { now = Date.now() } = {}) {
  const next = { ...held };
  const changed = [];
  for (const entry of Array.isArray(incoming) ? incoming : []) {
    if (!entry || !HEX64.test(String(entry.operatorId || '')) || !STATES.has(entry.state)) continue;
    if (!Number.isFinite(entry.updatedAt) || typeof entry.updatedBy !== 'string' || entry.updatedAt > now + MAX_SKEW_MS) continue;
    const previous = next[entry.operatorId];
    if (!newer(entry, previous)) continue;
    const keepOld = (previous?.directory?.body?.serial || 0) > (entry.directory?.body?.serial || 0);
    next[entry.operatorId] = keepOld ? { ...entry, directory: previous.directory } : entry;
    changed.push(entry.operatorId);
  }
  return { held: next, changed };
}

/* A gateway choice made in the dashboard, as the family shares it: null
   gateways mean "back to the directory". */
function validOverride(override, { now = Date.now() } = {}) {
  if (!override || !Number.isFinite(override.updatedAt) || typeof override.updatedBy !== 'string') return false;
  if (override.updatedAt > now + MAX_SKEW_MS) return false;
  if (override.gateways === null) return true;
  return Array.isArray(override.gateways) && override.gateways.length <= MAX_GATEWAYS && override.gateways.every((gateway) => (
    HEX64.test(String(gateway?.id || '')) && Number.isInteger(gateway.priority) && gateway.priority >= 1 && gateway.priority <= 99
  ));
}

/* The family's gateways in order. The directory's numbers until the admin
   chooses in the dashboard; after that the dashboard's choice, limited to
   relays the directory names. */
function gatewaySet(directoryBody, override = null) {
  const relays = new Map((directoryBody?.relays || []).map((relay) => [relay.id, relay]));
  const chosen = Array.isArray(override?.gateways)
    ? override.gateways.map((gateway) => ({ id: String(gateway?.id || ''), priority: Math.floor(Number(gateway?.priority) || 0) }))
    : Array.from(relays.values(), (relay) => ({ id: relay.id, priority: Math.floor(Number(relay.gateway) || 0) }));
  const seen = new Set();
  return chosen
    .filter(({ id, priority }) => priority > 0 && relays.has(id) && !seen.has(id) && seen.add(id))
    .map(({ id, priority }) => ({ id, priority, origins: (relays.get(id).origins || []).map(String) }))
    .sort((left, right) => left.priority - right.priority || (left.id < right.id ? -1 : 1));
}

/* ---- which gateway carries ------------------------------------------------ */

/* A link that has stood for stableMs beats one that just came back, so a
   gateway that flaps does not pull traffic to and fro; then the lower
   number. With nothing settled, the lower number of what is up. */
function chooseGateway(candidates = [], { now = Date.now(), stableMs = 60000 } = {}) {
  const up = candidates.filter((candidate) => candidate?.upSince);
  if (!up.length) return null;
  const settled = up.filter((candidate) => now - candidate.upSince >= stableMs);
  const pool = settled.length ? settled : up;
  pool.sort((left, right) => left.priority - right.priority || (left.id < right.id ? -1 : 1));
  return pool[0].id;
}

/* ---- carrying a frame on ------------------------------------------------- */

/* A frame not sealed to this relay goes on only:
 *   (a) from this relay's own family, at a gateway, to a partner;
 *   (b) from a partner's gateway, to this relay's own family, and no further;
 *   (c) from one partner to another through this family, when this family
 *       carries between its partners and each of the two named the other as
 *       a partner. Without that, this family would be a back door into a
 *       family that never approved the sender.
 */
function forwardRule({ from, fromOperator = '', selfGateway, target = {}, hop = 0, carryBetween = false, partnerNames = () => new Set() } = {}) {
  /* Only a missing count means "first hop" (a relay before partners sent
     none). Anything else that is not a whole number from 0 up is refused: a
     negative one would never reach the limit, and a loop with it never ends. */
  if (!Number.isSafeInteger(hop) || hop < 0 || hop >= HOP_LIMIT) return { action: 'reject', reason: 'hop-limit' };
  if (from === 'family') {
    if (target.family === 'partner' && selfGateway && target.operator) return { action: 'partner', operator: target.operator };
    return { action: 'reject', reason: 'not-carried' };
  }
  if (from === 'partner') {
    if (target.family === 'self') return { action: 'family' };
    if (target.family === 'partner' && selfGateway && carryBetween && target.operator && target.operator !== fromOperator
      && partnerNames(fromOperator).has(target.operator) && partnerNames(target.operator).has(fromOperator)) {
      return { action: 'partner', operator: target.operator };
    }
    return { action: 'reject', reason: 'not-carried' };
  }
  return { action: 'reject', reason: 'not-carried' };
}

/* ---- telling partners which gateways ------------------------------------- */

const noticeFields = (notice) => ({ v: 1, operatorId: notice.operatorId, gateways: notice.gateways, updatedAt: notice.updatedAt, by: notice.by });

function signGatewayNotice({ operatorId, gateways, updatedAt }, { id, key }, relayPrivateKey) {
  const notice = {
    v: 1,
    operatorId,
    gateways: (gateways || []).map((gateway) => ({ id: gateway.id, priority: gateway.priority })),
    updatedAt,
    by: id,
    key,
  };
  return { ...notice, sig: sign(noticeFields(notice), relayPrivateKey) };
}

/* A partner believes a family's gateway set from any relay that family's
   operator signed into its directory, and only a newer one than it holds. */
function verifyGatewayNotice(notice, { directoryBody, heldAt = 0, now = Date.now() } = {}) {
  if (!notice || notice.v !== 1 || !Array.isArray(notice.gateways) || !Number.isFinite(notice.updatedAt)
    || !HEX64.test(String(notice.by || '')) || typeof notice.key !== 'string' || typeof notice.sig !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  const members = new Set((directoryBody?.relays || []).map((relay) => relay.id));
  const seen = new Set();
  const listed = notice.gateways.length <= MAX_GATEWAYS && notice.gateways.every((gateway) => {
    const id = String(gateway?.id || '');
    const fine = members.has(id) && !seen.has(id) && Number.isInteger(gateway?.priority) && gateway.priority >= 1 && gateway.priority <= 99;
    seen.add(id);
    return fine;
  });
  if (!listed) return { ok: false, reason: 'malformed' };
  if (notice.operatorId !== directoryBody?.operator?.id) return { ok: false, reason: 'wrong-operator' };
  if (!(directoryBody.relays || []).some((relay) => relay.id === notice.by)) return { ok: false, reason: 'not-a-member' };
  if (relayIdFor(notice.key) !== notice.by) return { ok: false, reason: 'key-mismatch' };
  if (!signatureHolds(noticeFields(notice), notice.key, notice.sig)) return { ok: false, reason: 'bad-signature' };
  if (notice.updatedAt > now + MAX_SKEW_MS) return { ok: false, reason: 'future' };
  if (notice.updatedAt <= heldAt) return { ok: false, reason: 'stale' };
  return { ok: true, set: { gateways: notice.gateways.map((gateway) => ({ id: gateway.id, priority: gateway.priority })), updatedAt: notice.updatedAt } };
}

/* ---- telling partners whom we link with ------------------------------------ */

const MAX_LISTED = 256;
const listFields = (list) => ({ v: 1, kind: 'partner-list', operatorId: list.operatorId, operators: list.operators, carries: list.carries, updatedAt: list.updatedAt, by: list.by });

/* Which operators a family links with, and whether it carries between them,
   signed by the relay saying it. A common partner passes the far family's
   list on unchanged; nobody on the way can add itself to it. */
function signPartnerList({ operatorId, operators, carries, updatedAt }, { id, key }, relayPrivateKey) {
  const list = { v: 1, operatorId, operators: Array.from(operators || []), carries: carries === true, updatedAt, by: id, key };
  return { ...list, sig: sign(listFields(list), relayPrivateKey) };
}
function verifyPartnerList(list, { directoryBody, heldAt = 0, now = Date.now(), maxAgeMs = Infinity } = {}) {
  if (!list || list.v !== 1 || !Array.isArray(list.operators) || list.operators.length > MAX_LISTED || typeof list.carries !== 'boolean'
    || !list.operators.every((id) => HEX64.test(String(id))) || !Number.isFinite(list.updatedAt)
    || !HEX64.test(String(list.by || '')) || typeof list.key !== 'string' || typeof list.sig !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  if (list.operatorId !== directoryBody?.operator?.id) return { ok: false, reason: 'wrong-operator' };
  if (!(directoryBody.relays || []).some((relay) => relay.id === list.by)) return { ok: false, reason: 'not-a-member' };
  if (relayIdFor(list.key) !== list.by) return { ok: false, reason: 'key-mismatch' };
  if (!signatureHolds(listFields(list), list.key, list.sig)) return { ok: false, reason: 'bad-signature' };
  if (list.updatedAt > now + MAX_SKEW_MS) return { ok: false, reason: 'future' };
  if (list.updatedAt <= heldAt || now - list.updatedAt > maxAgeMs) return { ok: false, reason: 'stale' };
  return { ok: true, list: { operators: new Set(list.operators), carries: list.carries, updatedAt: list.updatedAt } };
}

/* A partner list held from earlier counts only while it is fresh (families
   say theirs again every few minutes) and only while the relay that said it
   is still in that family's directory; otherwise it is as good as missing.
   Fresh is measured from the time it was signed: an old list handed over
   again is still old. */
function freshList(held, { now = Date.now(), maxAgeMs, directoryBody } = {}) {
  if (!held || !(now - (held.updatedAt || 0) <= maxAgeMs)) return null;
  if (!(directoryBody?.relays || []).some((relay) => relay.id === held.by)) return null;
  return held;
}

/* Through a common partner only with consent all round: it carries between
   its partners and names the far family, and the far family's own signed
   list names it. A partner's word about itself alone could pull another
   family's traffic to a place it was never meant to go. */
function commonPartnerOk({ through, target, throughList, targetList }) {
  return Boolean(throughList?.carries && throughList.operators?.has(target) && targetList?.operators?.has(through));
}

/* A partner's gateways that a change dropped stay usable for a while, so
   the two families keep a way to each other. The window opens with the
   first change and is never pushed back by later ones: a partner changing
   its gateways over and over cannot keep old ones in use. */
function retainGateways(held, dropped, { now = Date.now(), handoffMs = 120000 } = {}) {
  if (held && held.until > now) return { until: held.until, ids: new Set([...held.ids, ...dropped]) };
  return { until: now + handoffMs, ids: new Set(dropped) };
}

/* ---- where a partner may be reached ---------------------------------------- */

/* Addresses a partner's directory must not send this relay to: its own
   machine, the private networks around it, link-local (where cloud metadata
   lives). A partner is another operator, and following its directory to one
   of these would be fetching inside our network on its behalf. */
function privateHost(host) {
  const name = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!name) return true;
  if (net.isIP(name)) return !isPublicAddress(name);
  return isLocalName(name);
}

/* The lookup a relay link dials with. A host a partner's directory named is
   resolved here once, refused when any answer is private, and the address
   that was checked is the one handed back for the connection, so a name
   cannot answer one thing to the check and another to the dial. */
function guardedLookup({ resolve, isPartnerHost, allowPrivate = false }) {
  return (hostname, options, callback) => {
    Promise.resolve(resolve(hostname)).then((answers) => {
      const list = Array.isArray(answers) ? answers : [];
      if (!list.length) return callback(Object.assign(new Error('no address'), { code: 'ENOTFOUND' }));
      if (!allowPrivate && isPartnerHost(hostname) && list.some((answer) => privateHost(answer.address))) {
        return callback(Object.assign(new Error('a partner host that resolves to a private address'), { code: 'EPRIVATE' }));
      }
      if (options && options.all) return callback(null, list.map((answer) => ({ address: answer.address, family: answer.family })));
      return callback(null, list[0].address, list[0].family);
    }, (error) => callback(error));
  };
}
function safePartnerOrigin(value, { allowPrivate = false } = {}) {
  try {
    const url = new URL(String(value || '').trim());
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return '';
    if (!allowPrivate && privateHost(url.hostname)) return '';
    return url.origin;
  } catch (_error) { return ''; }
}

module.exports = {
  HOP_LIMIT,
  validOverride,
  retainGateways,
  privateHost,
  guardedLookup,
  safePartnerOrigin,
  signPartnerList,
  verifyPartnerList,
  commonPartnerOk,
  freshList,
  signJoinRequest,
  verifyJoinRequest,
  mergePartners,
  gatewaySet,
  chooseGateway,
  forwardRule,
  signGatewayNotice,
  verifyGatewayNotice,
};
