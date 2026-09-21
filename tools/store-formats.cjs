/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* For each poorija_* store the app actually reads, is it written encrypted or
   as plain JSON? The decoy profile has to match, store by store: a decoy whose
   notes are invisible and whose password list throws is not a decoy. */
const fs = require('fs');
const files = ['js/app.js', ...fs.readdirSync('js/chat').filter(f=>f.endsWith('.js')).map(f=>'js/chat/'+f)];
const rows = new Map();
const note = (key, how, where) => {
  if (!rows.has(key)) rows.set(key, new Set());
  rows.get(key).add(how + '  (' + where + ')');
};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  lines.forEach((l, i) => {
    let m = l.match(/localStorage\.setItem\(\s*'(poorija_[a-z_0-9]+)'\s*,\s*([A-Za-z.]+)\(/);
    if (m) note(m[1], m[2] === 'JSON.stringify' ? 'PLAIN JSON' : m[2], f.split('/').pop()+':'+(i+1));
    m = l.match(/saveEncrypted\(\s*([A-Z_]+)\s*,/);
    if (m) note('<'+m[1]+'>', 'encrypted', f.split('/').pop()+':'+(i+1));
  });
}
console.log('key'.padEnd(34), 'written how');
for (const [k, v] of [...rows].sort()) console.log('  ' + k.padEnd(32), [...v].join(' | '));
