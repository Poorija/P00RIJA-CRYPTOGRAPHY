/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The standalone relay is the deployed relay.
 *
 * This file used to be a second, hand-maintained copy of scripts/server.js.
 * The two carried the same version number and had quietly come apart: the
 * copy had no per-device delivery, no expiry on a transit wait, no per-client
 * ceiling on parked envelopes and no check that a mailbox key is a fingerprint
 * before it becomes a file name — every fix that went into the deployed relay
 * after the split had to be remembered twice, and was not. Somebody installing
 * the distribution got an older, weaker program under a newer label.
 *
 * So there is one program now. In the image it sits at ./scripts/server.js
 * (see Dockerfile.relay); run from a checkout it is ../scripts/server.js. */
const fs = require('fs');
const path = require('path');

const candidates = [
  path.join(__dirname, 'scripts', 'server.js'),
  path.join(__dirname, '..', 'scripts', 'server.js'),
];
const target = candidates.find((file) => fs.existsSync(file));
if (!target) {
  console.error('The relay program (scripts/server.js) is missing next to this launcher.');
  process.exit(1);
}
require(target);
