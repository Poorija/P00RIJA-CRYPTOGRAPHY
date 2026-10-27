/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The TURN server the stack ships, started from the image and with the
 * arguments config/docker-compose.yaml gives it, and asked for what a call
 * asks for: a binding, then a relay allocation with the time-limited
 * credentials the relay mints (TURN REST, scripts/server.js
 * turnCredentialsForClient). A new coturn release that took the arguments
 * differently, or refused the credentials, fails here rather than on the
 * first call that needs a relay.
 *
 *   node tests/e2e/turnserver.mjs      (needs Docker)
 */
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const docker = (args) => spawnSync('docker', args, { encoding: 'utf8', timeout: 300000 });

/* ---- a STUN/TURN client, as small as it can be (RFC 5389, 5766) ---------- */

const COOKIE = 0x2112a442;
const ATTR = { USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, REALM: 0x0014, NONCE: 0x0015, XOR_RELAYED: 0x0016, REQUESTED_TRANSPORT: 0x0019, XOR_MAPPED: 0x0020, LIFETIME: 0x000d };
const pad = (buffer) => Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4)]);
const attr = (type, value) => { const head = Buffer.alloc(4); head.writeUInt16BE(type, 0); head.writeUInt16BE(value.length, 2); return pad(Buffer.concat([head, value])); };
function message(type, attrs, key) {
  const tid = crypto.randomBytes(12);
  let body = Buffer.concat(attrs);
  const head = Buffer.alloc(20);
  head.writeUInt16BE(type, 0);
  head.writeUInt32BE(COOKIE, 4);
  tid.copy(head, 8);
  if (key) {
    head.writeUInt16BE(body.length + 24, 2);
    const mac = crypto.createHmac('sha1', key).update(Buffer.concat([head, body])).digest();
    body = Buffer.concat([body, attr(ATTR.MESSAGE_INTEGRITY, mac)]);
  }
  head.writeUInt16BE(body.length, 2);
  return Buffer.concat([head, body]);
}
function parse(buffer) {
  const out = { type: buffer.readUInt16BE(0), attrs: {} };
  let at = 20;
  while (at + 4 <= buffer.length) {
    const type = buffer.readUInt16BE(at);
    const length = buffer.readUInt16BE(at + 2);
    out.attrs[type] = buffer.subarray(at + 4, at + 4 + length);
    at += 4 + length + ((4 - (length % 4)) % 4);
  }
  return out;
}
const xorAddress = (value) => {
  const port = value.readUInt16BE(2) ^ (COOKIE >>> 16);
  const ip = [0, 1, 2, 3].map((i) => value[4 + i] ^ ((COOKIE >>> (24 - 8 * i)) & 255)).join('.');
  return `${ip}:${port}`;
};
function ask(socket, port, packet) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { socket.removeListener('message', onMessage); resolve(null); }, 4000);
    function onMessage(reply) { clearTimeout(timer); socket.removeListener('message', onMessage); resolve(parse(reply)); }
    socket.on('message', onMessage);
    socket.send(packet, port, '127.0.0.1');
  });
}

/* ---- the image and its arguments, from the compose file ------------------ */

const compose = fs.readFileSync(path.join(ROOT, 'config/docker-compose.yaml'), 'utf8');
const image = (/^\s*image:\s*(coturn\/coturn:\S+)/m.exec(compose) || [])[1];
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-turn-'));
const name = `poorija-turn-suite-${process.pid}`;
const secret = crypto.randomBytes(24).toString('hex');
const port = 34000 + (process.pid % 1000);
try {
  check('the compose file names the coturn image', Boolean(image), image);
  /* The certificate coturn is handed in the stack, self-signed here. */
  const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', path.join(home, 'key.pem'), '-out', path.join(home, 'cert.pem')], { encoding: 'utf8' });
  fs.chmodSync(path.join(home, 'key.pem'), 0o644);
  check('a certificate for it', made.status === 0, made.stderr.slice(-200));
  /* The arguments of config/docker-compose.yaml, read from it, with the
     secret set (as the deployments have it) and a test machine's values for
     its variables. --relay-ip is left out: on a bridge network the address
     is the container's, which the compose file's host network does not have. */
  const block = (/\n  coturn:\n([\s\S]*?)\n  [a-z-]+:\n/.exec(compose) || [])[1] || '';
  const values = { DOMAIN: 'localhost', EXTERNAL_IP: '127.0.0.1', TURN_MIN_PORT: '49152', TURN_MAX_PORT: '49160' };
  const fromCompose = Array.from(block.matchAll(/^\s*- (--[a-z-]+(?:=.+?)?)\s*$/gm), (match) => match[1])
    .map((arg) => arg.replace(/\$\{([A-Z_]+)(?::[-?][^}]*)?\}/g, (_all, name) => values[name] ?? ''))
    .filter((arg) => !arg.startsWith('--relay-ip='))
    .map((arg) => arg.replace(/^--max-port=.*/, '--max-port=49160'));
  check('the arguments come from the compose file', fromCompose.includes('--listening-port=3478') && fromCompose.includes('--external-ip=127.0.0.1') && fromCompose.length >= 10, fromCompose.join(' '));
  const started = docker(['run', '-d', '--name', name, '-p', `127.0.0.1:${port}:3478/udp`, '-v', `${home}:/etc/coturn/certs:ro`, image,
    ...fromCompose, '--use-auth-secret', `--static-auth-secret=${secret}`]);
  check('coturn starts from that image with the stack’s arguments', started.status === 0, started.stderr.slice(-300));
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const logs = `${docker(['logs', name]).stdout}${docker(['logs', name]).stderr}`;
  const complaints = logs.split('\n').filter((line) => /Unknown argument|CONFIG ERROR|ERROR:|Cannot find (?!config file)|deprecated/i.test(line));
  check('and takes every one of them, none of them deprecated', complaints.length === 0, complaints.slice(0, 3).join(' | ').slice(0, 300));

  const socket = dgram.createSocket('udp4');
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const binding = await ask(socket, port, message(0x0001, []));
  check('it answers a STUN binding with the address it sees', binding?.type === 0x0101 && Boolean(binding.attrs[ATTR.XOR_MAPPED]), binding ? `0x${binding.type.toString(16)}` : 'no answer');

  const transport = attr(ATTR.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0]));
  const challenge = await ask(socket, port, message(0x0003, [transport]));
  const realm = challenge?.attrs[ATTR.REALM];
  const nonce = challenge?.attrs[ATTR.NONCE];
  check('an allocation without credentials is challenged', challenge?.type === 0x0113 && Boolean(realm) && Boolean(nonce));
  /* What the relay hands a client: "<expiry>:<name>" and the secret's HMAC of it. */
  const username = `${Math.floor(Date.now() / 1000) + 3600}:suite`;
  const password = crypto.createHmac('sha1', secret).update(username).digest('base64');
  const key = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest();
  const allocated = await ask(socket, port, message(0x0003, [transport, attr(ATTR.USERNAME, Buffer.from(username)), attr(ATTR.REALM, realm), attr(ATTR.NONCE, nonce)], key));
  check('with the relay’s time-limited credentials it allocates a relay address', allocated?.type === 0x0103 && Boolean(allocated.attrs[ATTR.XOR_RELAYED]),
    allocated ? `0x${allocated.type.toString(16)} ${allocated.attrs[ATTR.XOR_RELAYED] ? xorAddress(allocated.attrs[ATTR.XOR_RELAYED]) : ''}` : 'no answer');
  const wrong = crypto.createHash('md5').update(`${username}:${realm}:not-the-password`).digest();
  const refused = await ask(socket, port, message(0x0003, [transport, attr(ATTR.USERNAME, Buffer.from(username)), attr(ATTR.REALM, realm), attr(ATTR.NONCE, nonce)], wrong));
  check('and refuses a wrong password', refused?.type === 0x0113, refused ? `0x${refused.type.toString(16)}` : 'no answer');
  socket.close();
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  docker(['rm', '-f', '-v', name]);
  fs.rmSync(home, { recursive: true, force: true });
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n===== ${failed} failed of ${results.length} =====`);
  process.exit(failed ? 1 : 0);
}
