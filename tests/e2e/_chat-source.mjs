/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The Secure Chat source, as one string.

   Several suites grep the chat implementation for a guard, a constant or a
   comment. They used to read js/chat.js; that file is now js/chat/NN-*.js, and
   a readFileSync on the old path throws, which took four suites down at once
   with an error that said nothing about the cause.

   Concatenating the parts in load order reproduces exactly what those greps
   were reading before — the parts share one scope and run in this order, so a
   pattern that spans two of them still matches.

   Underscore-prefixed so tests/e2e/run-all.mjs does not try to run it. */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* fileURLToPath, not URL.pathname: this project's directory name has spaces
   in it and pathname returns them percent-encoded. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = join(ROOT, 'js', 'chat');

export function chatSource() {
  return readdirSync(DIR)
    .filter((f) => /^\d+-.*\.js$/.test(f))
    .sort()
    .map((f) => readFileSync(join(DIR, f), 'utf8'))
    .join('\n');
}

export function chatPartNames() {
  return readdirSync(DIR).filter((f) => /^\d+-.*\.js$/.test(f)).sort();
}
