/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* An update package, as the central panel builds it and every server checks
 * it before it keeps or applies anything.
 *
 * It is a plain tar, so any tar can look inside it:
 *   manifest.json   what it is: the version, and each member's size and hash
 *   manifest.sig    the operator key's signature over the manifest
 *   source.tar.gz   the tree a deploy copies (scripts, config, the web app)
 *   images.tar.gz   the images, built once on the operator's computer
 *
 * A package is only ever as trusted as the operator key. Servers pass it to
 * one another, so a package one of them was handed by somebody else must be
 * caught here: the signature is checked against the operator key the server
 * already trusts (CHAT_OPERATOR_KEY), and every member against the hash the
 * signed manifest gives for it. Nothing in a package is run before that. */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { canonicalJson } = require('./relay-directory.js');

const MEMBERS = ['source.tar.gz', 'images.tar.gz'];
/* Every member a package may have, in this order. tar extracts the LAST
   member of a name, so a second one, an unknown one, a link or an extended
   header is a package read one way here and another way by tar: refused. */
const ALLOWED = ['manifest.json', 'manifest.sig', ...MEMBERS];
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const BLOCK = 512;

function compareVersions(a, b) {
  const left = String(a || '').split('.').map((part) => parseInt(part, 10) || 0);
  const right = String(b || '').split('.').map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/* ---- tar, the small part of it a package needs ----------------------------- */

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function header(name, size) {
  const block = Buffer.alloc(BLOCK, 0);
  block.write(name, 0, 100, 'utf8');
  block.write(octal(0o644, 8), 100, 8, 'ascii');
  block.write(octal(0, 8), 108, 8, 'ascii');
  block.write(octal(0, 8), 116, 8, 'ascii');
  block.write(octal(size, 12), 124, 12, 'ascii');
  block.write(octal(Math.floor(Date.now() / 1000), 12), 136, 12, 'ascii');
  block.write('        ', 148, 8, 'ascii');
  block.write('0', 156, 1, 'ascii');
  block.write('ustar\u000000', 257, 8, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return block;
}

/* Writes the tar: the manifest, its signature, then each member copied in
   pieces, so an image file of hundreds of megabytes never sits in memory. */
function writePackage(file, { manifest, sig, members }) {
  const fd = fs.openSync(`${file}.part`, 'w', 0o644);
  try {
    const put = (name, data) => {
      fs.writeSync(fd, header(name, data.length));
      fs.writeSync(fd, data);
      const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
      if (pad) fs.writeSync(fd, Buffer.alloc(pad, 0));
    };
    put('manifest.json', Buffer.from(canonicalJson(manifest), 'utf8'));
    put('manifest.sig', Buffer.from(String(sig), 'utf8'));
    for (const name of MEMBERS) {
      const source = members[name];
      const size = fs.statSync(source).size;
      fs.writeSync(fd, header(name, size));
      const input = fs.openSync(source, 'r');
      const chunk = Buffer.alloc(1 << 20);
      let done = 0;
      while (done < size) {
        const read = fs.readSync(input, chunk, 0, Math.min(chunk.length, size - done), done);
        if (!read) throw new Error(`${source} ended early`);
        fs.writeSync(fd, chunk, 0, read);
        done += read;
      }
      fs.closeSync(input);
      const pad = (BLOCK - (size % BLOCK)) % BLOCK;
      if (pad) fs.writeSync(fd, Buffer.alloc(pad, 0));
    }
    fs.writeSync(fd, Buffer.alloc(BLOCK * 2, 0));
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(`${file}.part`, file);
}

/* The members of a tar and where each one's bytes are. Throws on anything
   that is not a whole, well-formed tar: a bad checksum, a member running
   past the end of the file. */
function readTarIndex(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const total = fs.fstatSync(fd).size;
    const members = [];
    const block = Buffer.alloc(BLOCK);
    let at = 0;
    while (at + BLOCK <= total) {
      fs.readSync(fd, block, 0, BLOCK, at);
      if (block.every((byte) => byte === 0)) return members;
      const stored = parseInt(block.toString('ascii', 148, 156).replace(/[\0 ]/g, ''), 8);
      let sum = 0;
      for (let i = 0; i < BLOCK; i += 1) sum += (i >= 148 && i < 156) ? 32 : block[i];
      if (!Number.isFinite(stored) || stored !== sum) throw new Error('not a tar (bad header checksum)');
      const name = block.toString('utf8', 0, 100).replace(/\0.*$/s, '');
      const prefix = block.toString('utf8', 345, 500).replace(/\0.*$/s, '');
      const size = parseInt(block.toString('ascii', 124, 136).replace(/[\0 ]/g, ''), 8) || 0;
      const type = block.toString('ascii', 156, 157);
      const offset = at + BLOCK;
      if (offset + size > total) throw new Error(`${name} runs past the end of the file`);
      members.push({ name: prefix ? `${prefix}/${name}` : name, offset, size, type: type === '\0' ? '0' : type });
      at = offset + Math.ceil(size / BLOCK) * BLOCK;
    }
    throw new Error('the tar has no end');
  } finally {
    fs.closeSync(fd);
  }
}

function readMember(file, member, limit = 1 << 20) {
  if (member.size > limit) throw new Error(`${member.name} is larger than expected`);
  const fd = fs.openSync(file, 'r');
  try {
    const data = Buffer.alloc(member.size);
    fs.readSync(fd, data, 0, member.size, member.offset);
    return data;
  } finally {
    fs.closeSync(fd);
  }
}

function hashRange(file, offset, size) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(1 << 20);
    let done = 0;
    while (done < size) {
      const read = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - done), offset + done);
      if (!read) throw new Error('the file ended early');
      hash.update(chunk.subarray(0, read));
      done += read;
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function memberStream(file, member) {
  if (!member.size) return require('stream').Readable.from([]);
  return fs.createReadStream(file, { start: member.offset, end: member.offset + member.size - 1 });
}

/* ---- the manifest ---------------------------------------------------------- */

function buildManifest({ version, buildTag, source, members, images, createdAt = new Date().toISOString() }) {
  const listed = {};
  for (const name of MEMBERS) {
    const size = fs.statSync(members[name]).size;
    listed[name] = { size, sha256: hashRange(members[name], 0, size) };
  }
  return { v: 1, product: 'p00rija-cryptography', version, buildTag, source, createdAt, members: listed, images };
}

function signManifest(manifest, privateKeyPem) {
  return crypto.sign('sha256', Buffer.from(canonicalJson(manifest), 'utf8'), privateKeyPem).toString('base64');
}

function wellFormed(manifest) {
  if (!manifest || typeof manifest !== 'object' || manifest.v !== 1 || manifest.product !== 'p00rija-cryptography') return false;
  if (!VERSION.test(String(manifest.version || '')) || !/^[0-9A-Za-z.-]{1,60}$/.test(String(manifest.buildTag || ''))) return false;
  if (!manifest.members || typeof manifest.members !== 'object') return false;
  if (Object.keys(manifest.members).sort().join() !== [...MEMBERS].sort().join()) return false;
  if (!MEMBERS.every((name) => Number.isSafeInteger(manifest.members[name]?.size) && manifest.members[name].size >= 0
    && /^[0-9a-f]{64}$/.test(String(manifest.members[name]?.sha256 || '')))) return false;
  return Array.isArray(manifest.images) && manifest.images.length >= 1 && manifest.images.length <= 8
    && manifest.images.every((image) => typeof image === 'string' && /^[a-z0-9][a-z0-9./:_-]{0,159}$/.test(image));
}

/* {ok, manifest} or {ok:false, reason}: bad-package, bad-manifest,
   bad-signature, member-missing, member-hash. */
function verifyPackage(file, operatorKeySpki) {
  let index;
  try { index = readTarIndex(file); } catch (error) { return { ok: false, reason: 'bad-package', detail: error.message }; }
  if (index.length !== ALLOWED.length || index.some((member, i) => member.name !== ALLOWED[i] || member.type !== '0')) {
    return { ok: false, reason: 'bad-package', detail: `members: ${index.map((member) => `${member.name}(${member.type})`).join(' ')}` };
  }
  const named = (name) => index.find((member) => member.name === name);
  let manifest;
  let sig;
  try {
    manifest = JSON.parse(readMember(file, named('manifest.json'), 64 * 1024).toString('utf8'));
    sig = readMember(file, named('manifest.sig'), 4096).toString('utf8').trim();
  } catch (error) {
    return { ok: false, reason: 'bad-manifest', detail: error.message };
  }
  if (!wellFormed(manifest)) return { ok: false, reason: 'bad-manifest' };
  let signed = false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(String(operatorKeySpki || ''), 'base64'), format: 'der', type: 'spki' });
    signed = crypto.verify('sha256', Buffer.from(canonicalJson(manifest), 'utf8'), key, Buffer.from(sig, 'base64'));
  } catch (_error) {
    signed = false;
  }
  if (!signed) return { ok: false, reason: 'bad-signature' };
  for (const name of MEMBERS) {
    const member = named(name);
    if (!member) return { ok: false, reason: 'member-missing', detail: name };
    const want = manifest.members[name];
    if (member.size !== want.size || hashRange(file, member.offset, member.size) !== want.sha256) {
      return { ok: false, reason: 'member-hash', detail: name };
    }
  }
  return { ok: true, manifest };
}

module.exports = {
  MEMBERS, compareVersions, writePackage, readTarIndex, readMember, memberStream,
  buildManifest, signManifest, verifyPackage, hashRange,
};
