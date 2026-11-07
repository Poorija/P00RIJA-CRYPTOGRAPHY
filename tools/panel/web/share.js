/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Admins, and the panel's settings sent from one admin to another.
 *
 * Each admin has two keys in their own browser, neither of which ever leaves
 * it: the signing key the family list names (sign.js), and a box key
 * (ECDH P-256) that others seal settings to. An admin shares the public half
 * of their box key — a short line of text — out of band, and checks its
 * fingerprint with whoever adds it.
 *
 * A share is sealed here, in the sender's browser, with BOTH the recipient's
 * box key and a complex password, and signed with the sender's signing key:
 *
 *   ecdh   = ECDH(fresh key of this share, recipient's box key)
 *   pw     = PBKDF2-SHA-256(password, salt, 600 000 rounds)
 *   key    = HKDF-SHA-256(ecdh || pw, salt, "p00rija-share-v1|<to>|<from>")
 *   sealed = AES-256-GCM(key, iv, bundle), the header as associated data
 *   sig    = ECDSA-P-256(sender's signing key, everything above)
 *
 * Opening one needs the recipient's own browser (its box key) and the
 * password, and is refused unless the sender's signing key is an admin the
 * family list names. What is in a share is chosen by the sender and never
 * includes the operator key, SSH keys, dashboard passwords, the Telegram
 * token or any login: the panel's server list, mirrors, notes on partners,
 * the network's layout, the page's own choices, and the Telegram settings
 * without their token. Applying one asks for an authenticator code. */
import { canonicalJson, keyIdOf, spkiOf } from './sign.js';
import { state, t, esc, api, card, show, hooks, fmtTime, saveFile, subtabs, tag, kpi, deviceListed, setView, serverCall } from './ui.js';
import { editDirectory } from './graph.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text) => Uint8Array.from(atob(String(text || '')), (char) => char.charCodeAt(0));
const hex = (bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));
export const ITERATIONS = 600000;
const BOX_PREFIX = 'p00rija-box:v1:';

/* ---- the box key, kept in this browser ------------------------------------ */

const DB = 'poorija-control-panel';
const STORE = 'keys';
const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const inStore = (db, mode, work) => new Promise((resolve, reject) => {
  const tx = db.transaction(STORE, mode);
  const request = work(tx.objectStore(STORE));
  tx.oncomplete = () => resolve(request?.result);
  tx.onerror = () => reject(tx.error);
});

/* The public half as a line to hand over, and its fingerprint to read aloud. */
export async function boxLine(publicKey) {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return { line: `${BOX_PREFIX}${b64(spki)}`, fingerprint: (await sha256Hex(spki)).slice(0, 32) };
}
export async function parseBoxLine(line) {
  const text = String(line || '').trim();
  if (!text.startsWith(BOX_PREFIX)) throw new Error('bad-box-key');
  const spki = unb64(text.slice(BOX_PREFIX.length));
  const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  return { key, fingerprint: (await sha256Hex(spki)).slice(0, 32), line: text };
}

export async function boxKey() {
  const db = await openDb();
  const saved = await inStore(db, 'readonly', (store) => store.get('box'));
  db.close();
  if (!saved?.privateKey || !saved?.publicKey) return null;
  return { ...saved, ...(await boxLine(saved.publicKey)) };
}
export async function makeBoxKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const record = { privateKey: pair.privateKey, publicKey: pair.publicKey, createdAt: new Date().toISOString() };
  const db = await openDb();
  await inStore(db, 'readwrite', (store) => store.put(record, 'box'));
  db.close();
  return { ...record, ...(await boxLine(pair.publicKey)) };
}
export async function forgetBoxKey() {
  const db = await openDb();
  await inStore(db, 'readwrite', (store) => store.delete('box'));
  db.close();
}

/* ---- the password ---------------------------------------------------------- */

/* Complex enough to stand on its own if the file is lost: long, of every
   kind of character, not one repeated, not a word from the panel itself. */
export function passwordProblems(password, words = []) {
  const text = String(password || '');
  const problems = [];
  if (text.length < 16) problems.push('pwShort');
  if (!/[a-z]/.test(text)) problems.push('pwLower');
  if (!/[A-Z]/.test(text)) problems.push('pwUpper');
  if (!/[0-9]/.test(text)) problems.push('pwDigit');
  if (!/[^A-Za-z0-9]/.test(text)) problems.push('pwSymbol');
  if (/(.)\1{3,}/.test(text) || new Set(text).size < Math.min(10, text.length)) problems.push('pwRepeat');
  const lower = text.toLowerCase();
  if (['p00rija', 'poorija', 'password', 'qwerty', '123456', ...words.map((word) => String(word || '').toLowerCase()).filter((word) => word.length >= 4)].some((word) => lower.includes(word))) problems.push('pwWord');
  return problems;
}
export function passwordBits(password) {
  const text = String(password || '');
  const pool = (/[a-z]/.test(text) ? 26 : 0) + (/[A-Z]/.test(text) ? 26 : 0) + (/[0-9]/.test(text) ? 10 : 0) + (/[^A-Za-z0-9]/.test(text) ? 33 : 0);
  return Math.round(text.length * Math.log2(Math.max(pool, 1)));
}
export function makePassword(length = 24) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?'];
  const all = sets.join('');
  const pick = (from) => from[crypto.getRandomValues(new Uint32Array(1))[0] % from.length];
  const chars = [...sets.map(pick), ...Array.from({ length: length - sets.length }, () => pick(all))];
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const other = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [chars[index], chars[other]] = [chars[other], chars[index]];
  }
  return chars.join('');
}

/* ---- sealing and opening ---------------------------------------------------- */

async function shareKey({ privateKey, publicKey, password, salt, to, from, iterations }) {
  const ecdh = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const pw = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  const ikm = new Uint8Array(64);
  ikm.set(new Uint8Array(ecdh), 0);
  ikm.set(new Uint8Array(pw), 32);
  const hkdf = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(`p00rija-share-v1|${to}|${from}`) }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const headerOf = (envelope) => { const { ct: _ct, sig: _sig, ...header } = envelope; return header; };

export async function sealShare({ bundle, recipientLine, password, signer, iterations = ITERATIONS }) {
  const recipient = await parseBoxLine(recipientLine);
  const fresh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    v: 1, kind: 'p00rija-panel-share', createdAt: new Date().toISOString(),
    from: { name: String(signer.name || '').slice(0, 64), keyId: signer.keyId, spki: signer.spki },
    to: { fingerprint: recipient.fingerprint },
    epk: b64(await crypto.subtle.exportKey('spki', fresh.publicKey)), salt: b64(salt), iterations, iv: b64(iv),
  };
  const key = await shareKey({ privateKey: fresh.privateKey, publicKey: recipient.key, password, salt, to: recipient.fingerprint, from: signer.keyId, iterations });
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(canonicalJson(header)) }, key, enc.encode(JSON.stringify(bundle)));
  const envelope = { ...header, ct: b64(ct) };
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer.privateKey, enc.encode(canonicalJson(envelope)));
  return { ...envelope, sig: b64(sig) };
}

/* Checked in this order: its shape, that it is for this browser, that the
   sender's key signed it and is an admin of this family, then the password. */
export async function openShare({ envelope, password, box, admins }) {
  if (!envelope || envelope.v !== 1 || envelope.kind !== 'p00rija-panel-share') throw new Error('shareBadFile');
  if (!Number.isSafeInteger(envelope.iterations) || envelope.iterations < 100000 || envelope.iterations > 5000000) throw new Error('shareBadFile');
  if (!box) throw new Error('shareNoBox');
  if (envelope.to?.fingerprint !== box.fingerprint) throw new Error('shareNotForYou');
  let senderKey;
  try { senderKey = await crypto.subtle.importKey('spki', unb64(envelope.from?.spki), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']); } catch (_error) { throw new Error('shareBadSignature'); }
  if (await keyIdOf(senderKey) !== envelope.from.keyId) throw new Error('shareBadSignature');
  const { sig, ...signed } = envelope;
  const holds = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, senderKey, unb64(sig), enc.encode(canonicalJson(signed)));
  if (!holds) throw new Error('shareBadSignature');
  const admin = (admins || []).find((entry) => entry.id === envelope.from.keyId);
  if (!admin) throw new Error('shareNotAdmin');
  const epk = await crypto.subtle.importKey('spki', unb64(envelope.epk), { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const key = await shareKey({ privateKey: box.privateKey, publicKey: epk, password, salt: unb64(envelope.salt), to: box.fingerprint, from: envelope.from.keyId, iterations: envelope.iterations });
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv), additionalData: enc.encode(canonicalJson(headerOf(envelope))) }, key, unb64(envelope.ct));
  } catch (_error) { throw new Error('shareBadPassword'); }
  return { bundle: JSON.parse(dec.decode(plain)), sender: { name: admin.name, keyId: envelope.from.keyId }, createdAt: envelope.createdAt };
}

/* ---- what a share holds -------------------------------------------------------- */

export const PARTS = ['servers', 'mirrors', 'partnerNotes', 'layout', 'view', 'telegram'];
async function gatherBundle(parts) {
  const bundle = { v: 1, parts: {} };
  if (parts.includes('servers')) bundle.parts.servers = ((await api('/api/servers-config')).servers || []).map(({ name, fields }) => ({ name, fields: { ...fields, SSH_KEY: String(fields.SSH_KEY || '').split('/').pop() } }));
  if (parts.includes('mirrors')) bundle.parts.mirrors = (await api('/api/servers/mirrors')).mirrors || [];
  if (parts.includes('partnerNotes')) bundle.parts.partnerNotes = (await api('/api/partner-notes')).notes || {};
  if (parts.includes('layout')) bundle.parts.layout = (await api('/api/graph')).layout || {};
  if (parts.includes('view')) bundle.parts.view = JSON.parse(JSON.stringify(state.view));
  if (parts.includes('telegram')) {
    const results = state.cache.telegram?.results || [];
    bundle.parts.telegram = Object.fromEntries(results.filter((result) => result.ok && result.data.settings).map((result) => {
      const { token: _token, muteUntil: _mute, ...settings } = result.data.settings;
      return [result.server.name, settings];
    }));
  }
  return bundle;
}

/* ---- the section ------------------------------------------------------------- */

export const admins = {
  id: 'admins', title: 'admins',
  async load() {
    const [family, book] = await Promise.all([api('/api/family'), api('/api/admin-book')]);
    let box = null;
    try { box = await boxKey(); } catch (_error) { box = null; }
    state.cache.admins = { ...(state.cache.admins || {}), family, book: book.book || [], box };
  },
  render() {
    const cache = state.cache.admins || {};
    const fam = cache.family || {};
    const list = fam.admins || [];
    const book = cache.book || [];
    const box = cache.box;
    const canEdit = Boolean(fam.canEdit && deviceListed());
    const tabs = subtabs('admins', [['list', 'adminsList', list.length], ['keys', 'adminsMyKeys'], ['send', 'shareSend'], ['receive', 'shareReceive']]);
    let body = '';
    if (tabs.current === 'list') {
      const boxOf = (keyId, name) => book.find((entry) => entry.keyId === keyId || (!entry.keyId && entry.name === name));
      body = `<div class="kpis">${kpi('adminsList', String(list.length))}${kpi('withBoxKey', String(book.filter((entry) => entry.box).length))}</div>
        <div class="scroll"><table><thead><tr><th>${esc(t('name'))}</th><th>${esc(t('keyId'))}</th><th>${esc(t('boxKey'))}</th><th></th></tr></thead><tbody>${list.map((admin) => {
          const entry = boxOf(admin.id, admin.name);
          return `<tr><td><strong>${esc(admin.name)}</strong> ${state.device?.keyId === admin.id ? tag(t('thisBrowser'), 'good') : ''}</td><td class="mono">${esc(admin.id.slice(0, 16))}…</td>
            <td>${entry?.box ? `${tag(t('present'), 'good')} <span class="mono small">${esc(entry.fingerprint || '')}</span>` : tag(t('absent'), 'mut')}</td>
            <td class="actions"><button data-book-edit="${esc(admin.id)}" data-book-name="${esc(admin.name)}">${esc(t('setBoxKey'))}</button>${canEdit && state.device?.keyId !== admin.id ? `<button class="bad" data-admin-drop="${esc(admin.name)}">${esc(t('remove'))}</button>` : ''}</td></tr>`;
        }).join('') || `<tr><td colspan="4" class="mut">${esc(t('noAdmins'))}</td></tr>`}</tbody></table></div>
        ${canEdit ? `<h3>${esc(t('addAdmin'))}</h3><div class="form-grid"><label><span>${esc(t('name'))}</span><input id="newAdminName" maxlength="64"></label>
          <label class="wide"><span>${esc(t('publicKeyPh'))}</span><input id="newAdminKey" class="mono"></label>
          <label class="wide"><span>${esc(t('boxKeyOptional'))}</span><input id="newAdminBox" class="mono" placeholder="${BOX_PREFIX}…"></label>
          <div class="wide row"><button class="acc" id="newAdminAdd">${esc(t('addAdmin'))}</button></div></div><p class="mut">${esc(t('addAdminHelp'))}</p>`
    : `<p class="warn-text">${esc(t(fam.canEdit ? 'signNeeded' : 'noOperatorKeyHere'))}</p>`}`;
    } else if (tabs.current === 'keys') {
      body = `<h3>${esc(t('signingKey'))}</h3>${state.device ? `<div class="kv"><span>${esc(t('name'))}</span><span>${esc(state.device.name)}</span><span>${esc(t('keyId'))}</span><span class="mono">${esc(state.device.keyId)}</span><span>${esc(t('publicKeyPh'))}</span><span class="mono small">${esc(state.device.spki)}</span></div>
          <p>${deviceListed() ? tag(t('deviceListed'), 'good') : tag(t('deviceUnlisted'), 'warn')}</p>` : `<p class="mut">${esc(t('makeKeyFirst'))}</p><button data-tab="keys">${esc(t('keys'))}</button>`}
        <h3>${esc(t('boxKey'))}</h3><p class="mut">${esc(t('boxKeyHelp'))}</p>
        ${box ? `<div class="kv"><span>${esc(t('fingerprint'))}</span><span class="mono">${esc(box.fingerprint.replace(/(.{4})/g, '$1 ').trim())}</span><span>${esc(t('made'))}</span><span>${esc(fmtTime(box.createdAt))}</span></div>
          <textarea class="mono" rows="3" readonly id="myBoxLine">${esc(box.line)}</textarea><div class="row"><button id="copyBox"><i class="fa-solid fa-copy"></i> ${esc(t('copy'))}</button><button class="bad" id="forgetBox">${esc(t('forgetBoxKey'))}</button></div>`
    : `<button class="acc" id="makeBox"><i class="fa-solid fa-key"></i> ${esc(t('makeBoxKey'))}</button>`}`;
    } else if (tabs.current === 'send') {
      const recipients = book.filter((entry) => entry.box);
      body = `<p class="mut">${esc(t('shareSendHelp'))}</p>${!state.device ? `<p class="warn-text">${esc(t('makeKeyFirst'))}</p>` : ''}
        <div class="form-grid"><label class="wide"><span>${esc(t('shareTo'))}</span><select id="shareTo">${recipients.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.name)} · ${esc(entry.fingerprint || '')}</option>`).join('') || `<option value="">${esc(t('noRecipients'))}</option>`}</select></label>
          <div class="wide checks">${PARTS.map((part) => `<label class="check"><input type="checkbox" data-share-part="${part}"${['servers', 'mirrors', 'partnerNotes', 'layout'].includes(part) ? ' checked' : ''}> ${esc(t(`part_${part}`))}</label>`).join('')}</div>
          <label><span>${esc(t('sharePassword'))}</span><input id="sharePassword" type="password" autocomplete="new-password" spellcheck="false"></label>
          <label><span>${esc(t('newPassword2'))}</span><input id="sharePassword2" type="password" autocomplete="new-password" spellcheck="false"></label>
          <div class="wide row"><button type="button" id="shareGenerate"><i class="fa-solid fa-dice"></i> ${esc(t('generatePassword'))}</button><span id="shareStrength" class="mut small"></span></div>
          <div class="wide row"><button class="acc" id="shareSeal"${state.device && recipients.length ? '' : ' disabled'}><i class="fa-solid fa-lock"></i> ${esc(t('shareSeal'))}</button></div></div>
        <p class="mut small">${esc(t('shareNever'))}</p>`;
    } else {
      const opened = cache.opened;
      body = `<p class="mut">${esc(t('shareReceiveHelp'))}</p>${!box ? `<p class="warn-text">${esc(t('shareNoBox'))}</p>` : ''}
        <div class="form-grid"><label class="wide"><span>${esc(t('shareFile'))}</span><input id="shareFile" type="file" accept=".p00rija-share,application/json"></label>
          <label><span>${esc(t('sharePassword'))}</span><input id="openPassword" type="password" autocomplete="off" spellcheck="false"></label>
          <div class="wide row"><button class="acc" id="shareOpen"${box ? '' : ' disabled'}><i class="fa-solid fa-lock-open"></i> ${esc(t('shareOpen'))}</button></div></div>
        ${opened ? `<section class="card"><h3>${esc(t('shareFrom'))} ${esc(opened.sender.name)} <span class="mut small">${esc(fmtTime(opened.createdAt))}</span></h3>
          <div class="checks">${PARTS.filter((part) => opened.bundle.parts?.[part] !== undefined).map((part) => {
            const value = opened.bundle.parts[part];
            const count = Array.isArray(value) ? value.length : Object.keys(value || {}).length;
            return `<label class="check"><input type="checkbox" data-apply-part="${part}" checked> ${esc(t(`part_${part}`))} <span class="count">${count}</span></label>`;
          }).join('')}</div>
          ${opened.bundle.parts?.servers ? serverChanges(opened.bundle.parts.servers, cache.here || []) : ''}
          <div class="row"><input id="applyCode" class="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="${esc(t('codePh'))}"><button class="acc" id="shareApply">${esc(t('shareApply'))}</button><button id="shareDiscard">${esc(t('cancel'))}</button></div></section>` : ''}`;
    }
    return card('admins', tabs.html + body);
  },
};

/* Each server the share names: new here, the same, or what would change —
   field by field — with a box to tick before an existing one is replaced. */
function serverChanges(incoming, here) {
  const mine = Object.fromEntries(here.map((server) => [server.name, server.fields || {}]));
  return `<div class="scroll"><table><thead><tr><th>${esc(t('server'))}</th><th>${esc(t('state'))}</th><th>${esc(t('changes'))}</th></tr></thead><tbody>${incoming.map((server) => {
    const old = mine[server.name];
    if (!old) return `<tr><td><strong>${esc(server.name)}</strong></td><td>${tag(t('newHere'), 'good')}</td><td class="mono small">${esc(Object.entries(server.fields || {}).filter(([key]) => key !== 'SSH_KEY').map(([key, value]) => `${key}=${value}`).join(' '))}</td></tr>`;
    const diff = Object.keys({ ...old, ...(server.fields || {}) }).filter((key) => key !== 'SSH_KEY' && String(old[key] ?? '') !== String(server.fields?.[key] ?? ''));
    return `<tr><td><strong>${esc(server.name)}</strong></td><td>${diff.length ? `<label class="check"><input type="checkbox" data-replace-server="${esc(server.name)}"> ${esc(t('replaceIt'))}</label>` : tag(t('same'), 'mut')}</td>
      <td class="mono small">${diff.map((key) => `${esc(key)}: ${esc(old[key] ?? '—')} → <strong>${esc(server.fields?.[key] ?? '—')}</strong>`).join('<br>') || '—'}</td></tr>`;
  }).join('')}</tbody></table></div><p class="mut small">${esc(t('replaceHelp'))}</p>`;
}

const field = (id) => String(document.getElementById(id)?.value || '').trim();
const reasonOf = (error) => t(String(error?.message || error)) || String(error);

export async function sharesClick(target) {
  const attr = (name) => target.closest(`[${name}]`)?.getAttribute(name);
  const cache = state.cache.admins || {};
  if (target.closest('#makeBox')) { cache.box = await makeBoxKey(); hooks.render(); return true; }
  if (target.closest('#forgetBox')) {
    if (!window.confirm(t('confirmForgetBox'))) return true;
    await forgetBoxKey();
    cache.box = null;
    hooks.render();
    return true;
  }
  if (target.closest('#copyBox')) {
    try { await navigator.clipboard.writeText(cache.box?.line || ''); show(t('copied')); } catch (_error) { document.getElementById('myBoxLine')?.select(); }
    return true;
  }
  if (attr('data-book-edit')) {
    const keyId = attr('data-book-edit');
    const name = target.closest('[data-book-edit]').getAttribute('data-book-name');
    const line = window.prompt(`${t('setBoxKey')} — ${name}`, (cache.book || []).find((entry) => entry.keyId === keyId)?.box || '');
    if (line === null) return true;
    if (line.trim()) {
      let parsed;
      try { parsed = await parseBoxLine(line); } catch (_error) { show(t('bad-box-key')); return true; }
      if (!window.confirm(`${t('confirmFingerprint')}\n${parsed.fingerprint.replace(/(.{4})/g, '$1 ').trim()}`)) return true;
      const answer = await api('/api/admin-book', { entry: { keyId, name, box: parsed.line, fingerprint: parsed.fingerprint } });
      show(answer.ok ? t('saved') : t(answer.reason || 'failed'));
    } else {
      await api('/api/admin-book', { remove: keyId });
    }
    await admins.load();
    hooks.render();
    return true;
  }
  if (attr('data-admin-drop')) {
    const name = attr('data-admin-drop');
    if (!window.confirm(`${t('confirmRemoveAdmin')} (${name})`)) return true;
    await editDirectory([{ op: 'admin-remove', name }]);
    await admins.load();
    hooks.render();
    return true;
  }
  if (target.closest('#newAdminAdd')) {
    const name = field('newAdminName');
    const key = field('newAdminKey');
    const boxText = field('newAdminBox');
    let parsed = null;
    if (boxText) { try { parsed = await parseBoxLine(boxText); } catch (_error) { show(t('bad-box-key')); return true; } }
    if (!name || !key) { show(t('nothingPicked')); return true; }
    await editDirectory([{ op: 'admin-add', name, key }]);
    if (parsed) {
      let keyId = '';
      try { keyId = await keyIdOf(await crypto.subtle.importKey('spki', unb64(key), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])); } catch (_error) { keyId = ''; }
      await api('/api/admin-book', { entry: { keyId, name, box: parsed.line, fingerprint: parsed.fingerprint } });
    }
    await admins.load();
    hooks.render();
    return true;
  }
  if (target.closest('#shareGenerate')) {
    const password = makePassword(24);
    for (const id of ['sharePassword', 'sharePassword2']) { const box = document.getElementById(id); if (box) { box.value = password; box.type = 'text'; } }
    strength();
    return true;
  }
  if (target.closest('#shareSeal')) {
    const recipient = (cache.book || []).find((entry) => entry.id === field('shareTo'));
    const password = document.getElementById('sharePassword')?.value || '';
    if (!recipient?.box || !state.device) { show(t('noRecipients')); return true; }
    if (password !== (document.getElementById('sharePassword2')?.value || '')) { show(t('passwordsDiffer')); return true; }
    const problems = passwordProblems(password, [recipient.name, state.device.name]);
    if (problems.length) { show(problems.map((key) => t(key)).join(' · ')); return true; }
    const parts = [...document.querySelectorAll('[data-share-part]:checked')].map((box) => box.getAttribute('data-share-part'));
    if (!parts.length) { show(t('nothingPicked')); return true; }
    show(t('sealing'));
    const envelope = await sealShare({ bundle: await gatherBundle(parts), recipientLine: recipient.box, password, signer: state.device });
    saveFile(`p00rija-settings-for-${String(recipient.name).replace(/[^A-Za-z0-9_-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.p00rija-share`, JSON.stringify(envelope, null, 2), 'application/json');
    for (const id of ['sharePassword', 'sharePassword2']) { const box = document.getElementById(id); if (box) { box.value = ''; box.type = 'password'; } }
    await api('/api/share-note', { to: recipient.name, parts });
    show(`${t('shareSealed')} ${recipient.name}. ${t('shareSealedHelp')}`);
    return true;
  }
  if (target.closest('#shareOpen')) {
    const file = document.getElementById('shareFile')?.files?.[0];
    if (!file) { show(t('nothingPicked')); return true; }
    let envelope;
    try { envelope = JSON.parse(await file.text()); } catch (_error) { show(t('shareBadFile')); return true; }
    show(t('opening'));
    try {
      const opened = await openShare({ envelope, password: document.getElementById('openPassword')?.value || '', box: cache.box, admins: state.data?.admins || [] });
      cache.opened = opened;
      cache.here = (await api('/api/servers-config')).servers || [];
      if (document.getElementById('openPassword')) document.getElementById('openPassword').value = '';
      show(`${t('shareOpened')} ${opened.sender.name}`);
      hooks.render();
    } catch (error) { show(reasonOf(error)); }
    return true;
  }
  if (target.closest('#shareDiscard')) { cache.opened = null; hooks.render(); return true; }
  if (target.closest('#shareApply')) {
    const opened = cache.opened;
    if (!opened) return true;
    const parts = [...document.querySelectorAll('[data-apply-part]:checked')].map((box) => box.getAttribute('data-apply-part'));
    if (!parts.length || !window.confirm(`${t('confirmApplyShare')} ${opened.sender.name}: ${parts.map((part) => t(`part_${part}`)).join('، ')}`)) return true;
    const serverParts = Object.fromEntries(parts.filter((part) => ['servers', 'mirrors', 'partnerNotes', 'layout'].includes(part)).map((part) => [part, opened.bundle.parts[part]]));
    const lines = [];
    if (Object.keys(serverParts).length) {
      /* Servers already here and unchanged are left out; changed ones only if ticked. */
      if (serverParts.servers) {
        const mine = new Map((cache.here || []).map((server) => [server.name, server.fields || {}]));
        const ticked = new Set([...document.querySelectorAll('[data-replace-server]:checked')].map((box) => box.getAttribute('data-replace-server')));
        serverParts.servers = serverParts.servers.filter((server) => !mine.has(server.name) || ticked.has(server.name));
        if (!serverParts.servers.length) delete serverParts.servers;
      }
      const replace = [...document.querySelectorAll('[data-replace-server]:checked')].map((box) => box.getAttribute('data-replace-server'));
      const answer = Object.keys(serverParts).length ? await api('/api/import', { code: field('applyCode'), from: opened.sender.name, parts: serverParts, replace }) : { ok: true, applied: {} };
      lines.push(answer.ok ? `${t('applied')}: ${Object.entries(answer.applied || {}).map(([part, count]) => `${t(`part_${part}`)} ${count}`).join(' · ')}` : `${t('failed')}: ${t(answer.reason || 'failed')}${answer.detail ? ` (${answer.detail})` : ''}`);
      if (!answer.ok) { show(lines.join('\n')); return true; }
    }
    if (parts.includes('view')) {
      for (const [key, value] of Object.entries(opened.bundle.parts.view || {})) if (/^[A-Za-z0-9:_-]{1,60}$/.test(key) && ['string', 'number', 'boolean'].includes(typeof value)) setView(key, value);
      lines.push(`${t('part_view')}: ${t('applied')}`);
    }
    if (parts.includes('telegram')) {
      /* Each server of the same name here takes its settings, signed by this
         browser like any change to the bot; never a token. */
      for (const [name, settings] of Object.entries(opened.bundle.parts.telegram || {})) {
        if (!(state.data?.servers || []).some((server) => server.name === name && server.reachable)) { lines.push(`${name}: ${t('notHere')}`); continue; }
        const { token: _token, ...clean } = settings || {};
        const answer = await serverCall(name, 'POST', '/Monitor_Server/telegram', { settings: clean });
        lines.push(`${name}: ${answer.ok && answer.answer?.ok ? t('applied') : `${t('failed')} ${answer.answer?.reason || answer.reason || ''}`}`);
      }
    }
    cache.opened = null;
    show(lines.join('\n'));
    await hooks.reload?.();
    return true;
  }
  return false;
}

/* The password's strength, as it is typed. */
export function strength() {
  const box = document.getElementById('sharePassword');
  const out = document.getElementById('shareStrength');
  if (!box || !out) return;
  const problems = passwordProblems(box.value);
  out.textContent = box.value ? `${passwordBits(box.value)} bits · ${problems.length ? problems.map((key) => t(key)).join('، ') : t('pwGood')}` : '';
  out.className = `small ${problems.length ? 'bad-text' : 'good'}`;
}
