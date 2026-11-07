/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What the panel's long jobs share: a command run with its output read a
 * line at a time (updates.mjs, builds.mjs, provision.mjs). */
import { spawn } from 'node:child_process';

/* A command, its output a line at a time. stdin may be a file to stream in. */
export function run(argv, { line = () => {}, input = null, stdout = null, cwd, env, quiet = false } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    } catch (error) {
      line(error.message);
      resolve(127);
      return;
    }
    let partial = '';
    const take = (chunk) => {
      if (quiet) return;
      partial += String(chunk).replace(/\r/g, '\n');
      const parts = partial.split('\n');
      partial = parts.pop();
      for (const part of parts) if (part.trim()) line(part.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''));
    };
    if (stdout) child.stdout.pipe(stdout);
    else child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (error) => { line(error.message); });
    child.on('close', (code) => { if (partial.trim() && !quiet) line(partial); resolve(code ?? 1); });
    if (input) {
      input.on('error', () => child.stdin.destroy());
      input.pipe(child.stdin);
      child.stdin.on('error', () => {});
    }
  });
}

