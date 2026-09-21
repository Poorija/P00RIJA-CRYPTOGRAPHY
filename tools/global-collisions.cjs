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

/* Top-level name collisions inside the one global scope the app really has.
 *
 * index.html loads js/app.js and every js/chat/NN-*.js as CLASSIC scripts, so
 * they all declare into the same realm. `function` and `var` silently
 * overwrite each other — last file loaded wins, and the loser's callers get a
 * stranger's implementation. `const`, `let` and `class` are worse: a second
 * declaration is a SyntaxError that kills the whole file.
 *
 * Replaces tools/collisions.cjs, which still reads the pre-split js/chat.js.
 *
 *     node tools/global-collisions.cjs
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* The global-scope payload, in the order index.html loads it. Everything else
   under js/ wraps itself in an IIFE and cannot collide. */
const GLOBAL_SCRIPTS = [...html.matchAll(/<script[^>]+src="(js\/app\.js|js\/chat\/[^"?]+)(?:\?[^"]*)?"/g)]
  .map((m) => m[1]);

const decls = new Map();   // name -> [{ file, line, kind }]
const note = (name, file, line, kind) => {
  if (!decls.has(name)) decls.set(name, []);
  decls.get(name).push({ file, line, kind });
};

for (const rel of GLOBAL_SCRIPTS) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  let ast;
  try {
    ast = parse(src, { sourceType: 'script', errorRecovery: true });
  } catch (error) {
    console.log(`  PARSE FAILED  ${rel}: ${error.message}`);
    continue;
  }
  for (const node of ast.program.body) {
    const line = node.loc.start.line;
    if (node.type === 'FunctionDeclaration' && node.id) note(node.id.name, rel, line, 'function');
    else if (node.type === 'ClassDeclaration' && node.id) note(node.id.name, rel, line, 'class');
    else if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (d.id.type === 'Identifier') note(d.id.name, rel, line, node.kind);
        else if (d.id.type === 'ObjectPattern') {
          for (const p of d.id.properties) if (p.value?.type === 'Identifier') note(p.value.name, rel, line, node.kind);
        } else if (d.id.type === 'ArrayPattern') {
          for (const e of d.id.elements) if (e?.type === 'Identifier') note(e.name, rel, line, node.kind);
        }
      }
    }
  }
}

const collisions = [...decls.entries()].filter(([, v]) => v.length > 1);
const fatal = collisions.filter(([, v]) => v.some((d) => d.kind !== 'function' && d.kind !== 'var'));
const shadowing = collisions.filter(([, v]) => v.every((d) => d.kind === 'function' || d.kind === 'var'));

console.log(`  ${GLOBAL_SCRIPTS.length} global-scope script(s), ${decls.size} top-level name(s)\n`);
console.log(`== fatal: const/let/class declared twice (SyntaxError at load): ${fatal.length} ==`);
for (const [name, v] of fatal) console.log(`  ${name}\n${v.map((d) => `      ${d.kind} ${d.file}:${d.line}`).join('\n')}`);
console.log(`\n== silent overwrite: function/var declared twice (last one loaded wins): ${shadowing.length} ==`);
for (const [name, v] of shadowing) console.log(`  ${name}\n${v.map((d) => `      ${d.kind} ${d.file}:${d.line}`).join('\n')}`);

process.exit(fatal.length || shadowing.length ? 1 : 0);
