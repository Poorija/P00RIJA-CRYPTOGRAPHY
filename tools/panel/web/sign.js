/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* This browser's signing key, and the signatures it makes for the relays
 * (docs/CONTROL-PANEL.md, "Keys in the browser").
 *
 * The key is made here with WebCrypto, its private half not extractable,
 * and kept in this browser's IndexedDB: the panel's host never holds it. The
 * page builds the text a relay verifies itself, from the action it is about
 * to send, so what is signed is what the admin asked for. It is the same text
 * scripts/lib/operator-signature.js builds; the suite checks that byte for
 * byte. Runs in a browser and, for the suite, in Node.
 */

const enc = new TextEncoder();
const hex = (bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
const base64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const sha256Hex = async (text) => hex(await crypto.subtle.digest('SHA-256', typeof text === 'string' ? enc.encode(text) : text));

/* Sorted keys, no spaces: scripts/lib/relay-directory.js canonicalJson. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/* Lower case, single slashes, no slash at the end: the one spelling a relay
   signs paths in. */
export function normalizePath(path) {
  const cleaned = String(path || '').toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return cleaned || '/';
}

export async function requestText({ method, path, body, relay, at, nonce }) {
  return canonicalJson({
    v: 1,
    method: String(method || '').toUpperCase(),
    path: normalizePath(path),
    body: await sha256Hex(canonicalJson(body ?? {})),
    at,
    nonce,
    relay,
  });
}

export const spkiOf = async (publicKey) => base64(await crypto.subtle.exportKey('spki', publicKey));
export const keyIdOf = async (publicKey) => sha256Hex(await crypto.subtle.exportKey('spki', publicKey));

/* `v1.<keyId>.<at>.<nonce>.<signature>`; WebCrypto gives the raw 64-byte
   r||s, which relays take beside DER. */
export async function signHeader({ method, path, body, relay }, { privateKey, keyId }) {
  const at = Date.now();
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const text = await requestText({ method, path, body, relay, at, nonce });
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(text));
  return `v1.${keyId}.${at}.${nonce}.${base64(signature)}`;
}

/* ---- the key, kept in this browser ---------------------------------------- */

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

/* This browser's key, or null when it has none yet. */
export async function deviceKey() {
  const db = await openDb();
  const saved = await inStore(db, 'readonly', (store) => store.get('device'));
  db.close();
  if (!saved?.privateKey || !saved?.publicKey) return null;
  return { ...saved, keyId: await keyIdOf(saved.publicKey), spki: await spkiOf(saved.publicKey) };
}

/* A new key for this browser, replacing any it had. CryptoKey objects are
   stored as they are; the private half never leaves WebCrypto. */
export async function makeDeviceKey(name) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const record = { name: String(name || 'browser').slice(0, 64), privateKey: pair.privateKey, publicKey: pair.publicKey, createdAt: new Date().toISOString() };
  const db = await openDb();
  await inStore(db, 'readwrite', (store) => store.put(record, 'device'));
  db.close();
  return { ...record, keyId: await keyIdOf(pair.publicKey), spki: await spkiOf(pair.publicKey) };
}

export async function forgetDeviceKey() {
  const db = await openDb();
  await inStore(db, 'readwrite', (store) => store.delete('device'));
  db.close();
}
