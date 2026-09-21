/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Authenticated load-test clients. The small RSA key is a fixture to keep key
   generation outside the load measurement inexpensive; application keys stay 3072-bit. */
import crypto from 'node:crypto';
export function relayTestIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return { privateKey, publicKeyData: spki.toString('base64'), fingerprint: crypto.createHash('sha256').update(spki).digest('hex') };
}
export function answerRelayChallenge(message, identity, socket) {
  if (message.type !== 'id-challenge') return false;
  const nonce = crypto.privateDecrypt({ key: identity.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash:'sha256' }, Buffer.from(message.cipher, 'base64'));
  socket.send(JSON.stringify({ type:'id-proof', nonce: nonce.toString('base64') }));
  return true;
}
