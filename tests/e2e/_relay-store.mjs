/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Reading the relay's mailboxes from a test.

   The relay keeps one file per recipient under a `mailboxes/` directory rather
   than one file for the whole server - a write then costs one person's queue
   instead of every queued message on the relay. Several suites read that store
   directly as evidence, so they read it through here and there is one place to
   change if the layout moves again.

   The single-file form is still understood, because a store written by an
   older relay is imported on first boot and a fixture may still be staged in
   that shape. */
import fs from 'fs';
import path from 'path';

export function mailboxDirFor(storePath) {
  return path.join(path.dirname(storePath), 'mailboxes');
}

/* Every mailbox, as { fingerprint: [envelope, ...] }. */
export function readMailboxes(storePath) {
  const dir = mailboxDirFor(storePath);
  if (fs.existsSync(dir)) {
    const out = {};
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const items = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (Array.isArray(items) && items.length) out[name.slice(0, -5)] = items;
      } catch (_error) { /* an unreadable mailbox reads as absent */ }
    }
    return out;
  }
  try { return JSON.parse(fs.readFileSync(storePath, 'utf8')) || {}; } catch (_error) { return {}; }
}

/* Replace the whole store. Used to stage a fixture or to clear one out. */
export function writeMailboxes(storePath, boxes) {
  const dir = mailboxDirFor(storePath);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.json')) fs.unlinkSync(path.join(dir, name));
  }
  for (const [fingerprint, items] of Object.entries(boxes || {})) {
    if (!Array.isArray(items) || !items.length) continue;
    fs.writeFileSync(path.join(dir, `${fingerprint}.json`), JSON.stringify(items));
  }
}

export function countEnvelopes(storePath) {
  return Object.values(readMailboxes(storePath)).reduce((sum, items) => sum + items.length, 0);
}
