/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The layout the standalone relay has inside its image, reproduced so a suite
 * can run it straight out of the repository.
 *
 * standalone-relay/server.js requires its shared modules from ./lib, and the
 * image gets them by copying the whole of scripts/lib in. The directory is
 * therefore a build artifact and is not in the repository — which is fine
 * until a suite recreates it by NAME, one file at a time. Then the day a
 * second shared module appears, every one of those suites starts a relay that
 * dies on `Cannot find module './lib/...'`, and the failure has nothing to do
 * with what the suite was testing.
 *
 * This mirrors the directory, the same way the Dockerfile does. One call, and
 * a new shared module needs no edit anywhere.
 */
import { readdirSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = join(ROOT, 'scripts', 'lib');
const TARGET = join(ROOT, 'standalone-relay', 'lib');

/** Copies scripts/lib into place and hands back the undo for it. Files that
    were already there are left alone on cleanup: a developer's checkout may
    keep the directory on purpose, and a suite should not delete it. */
export function mirrorRelayLib() {
  const created = [];
  const directoryWasMissing = !existsSync(TARGET);
  mkdirSync(TARGET, { recursive: true });
  for (const name of readdirSync(SOURCE).filter((entry) => entry.endsWith('.js'))) {
    const target = join(TARGET, name);
    if (existsSync(target)) continue;
    copyFileSync(join(SOURCE, name), target);
    created.push(target);
  }
  return function restore() {
    for (const file of created) rmSync(file, { force: true });
    if (directoryWasMissing) rmSync(TARGET, { recursive: true, force: true });
  };
}
