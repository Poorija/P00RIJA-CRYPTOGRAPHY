/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* This computer's admin key: the key the central panel signs dangerous
 * dashboard actions with, once the operator has listed it in the family's
 * directory (tools/relay-directory.mjs admin-add).
 *
 * One per computer, so a lost laptop is dropped alone and the operator key
 * can stay offline. The private half is kept sealed under a passphrase:
 * scrypt turns the passphrase into an AES-256-GCM key, and the file holds
 * only the sealed key, its public half and its name.
 */
import crypto from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function makeAdminKey(name) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return {
    name: String(name || 'admin').slice(0, 64),
    id: crypto.createHash('sha256').update(spki).digest('hex'),
    publicKey: spki.toString('base64'),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

const derive = (passphrase, salt, params) => crypto.scryptSync(String(passphrase), salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT.maxmem });

export function sealAdminKey(key, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derive(passphrase, salt, SCRYPT), iv);
  const ct = Buffer.concat([cipher.update(key.privatePem, 'utf8'), cipher.final()]);
  return {
    v: 1,
    name: key.name,
    id: key.id,
    publicKey: key.publicKey,
    kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
    createdAt: new Date().toISOString(),
  };
}

export function openAdminKey(file, passphrase) {
  let privatePem;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', derive(passphrase, Buffer.from(file.kdf.salt, 'base64'), file.kdf), Buffer.from(file.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
    privatePem = Buffer.concat([decipher.update(Buffer.from(file.ct, 'base64')), decipher.final()]).toString('utf8');
  } catch (_error) {
    throw new Error('wrong passphrase');
  }
  return { name: file.name, id: file.id, publicKey: file.publicKey, privatePem };
}
