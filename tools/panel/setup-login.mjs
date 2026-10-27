#!/usr/bin/env node
/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Makes the web panel's login (docs/CONTROL-PANEL.md, "Logging in"): a name,
 * a password, and a secret for an authenticator app, which this prints once.
 *
 *   node tools/panel/setup-login.mjs            # a new login, replacing any
 *   node tools/panel/setup-login.mjs --new-code # same name and password, a new app secret
 *
 * In the image: docker compose -f config/control-panel.compose.yaml run --rm -it control-panel setup-login
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { configDir } from '../relay-directory.mjs';
import { makeLogin, base32Encode, otpauthUri } from './login.mjs';
import { qrTerminal } from './qr.mjs';
import crypto from 'node:crypto';

const say = (line) => process.stdout.write(`${line}\n`);

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (text) => { if (text.includes(question)) rl.output.write(text); };
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}

async function main(argv) {
  const dir = process.env.POORIJA_PANEL_STATE_DIR || configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'control-panel-login.json');
  if (!process.stdin.isTTY) throw new Error('run this in a terminal (with docker: run --rm -it)');
  let record;
  if (argv.includes('--new-code')) {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
    record = { ...record, totp: base32Encode(crypto.randomBytes(20)), lastStep: 0 };
  } else {
    if (fs.existsSync(file) && !/^y/i.test(await ask(`A login already exists at ${file}. Replace it? (y/N) `))) return;
    const username = (await ask('Name: ')).trim();
    const password = await ask('Password (at least 12 characters): ', true);
    if (await ask('The same password again: ', true) !== password) throw new Error('the two passwords differ');
    record = makeLogin({ username, password });
  }
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  say(`login written: ${file}`);
  say('Scan this with your authenticator app (it is shown only now):');
  say('');
  /* Dark on light, set here, so the code reads the same on a dark terminal
     and a light one. */
  for (const line of qrTerminal(otpauthUri(record)).split('\n')) say(`  \x1b[30;47m${line}\x1b[0m`);
  say('');
  say('Or type the secret, or open the link on the phone:');
  say(`  secret: ${record.totp.replace(/(.{4})/g, '$1 ').trim()}`);
  say(`  link:   ${otpauthUri(record)}`);
  say('Then log in with the name, the password and the six-digit code the app shows.');
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
