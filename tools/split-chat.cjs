/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Splits js/chat.js into ordered classic scripts under js/chat/.
 *
 * Why classic scripts and not ES modules: chat.js is one 22k-line IIFE holding
 * 973 top-level names, and exactly ONE of them (downloadBlob) collides with any
 * other script the page loads. That measurement is what makes this safe —
 * dropping the IIFE puts those names in the shared global scope, which is where
 * they would have to end up anyway, and `defer` already guarantees the load
 * order the file's own top-to-bottom structure depends on.
 *
 * The ES-module alternative would mean deriving an import graph across 973
 * bindings and 1037 statements, and would introduce temporal-dead-zone hazards
 * between const initialisers that this approach cannot have. Same benefit,
 * far less risk.
 *
 * Boundaries come from the section banners the file already carries: they are
 * the author's own decomposition, so the split follows the code's structure
 * rather than imposing one. A section longer than MAX_LINES is cut again at the
 * next top-level statement.
 */
const parser = require('@babel/parser');
const fs = require('fs');
const path = require('path');

const SRC = 'js/chat.js';
const OUT = 'js/chat';
const MAX_LINES = 1500;

const source = fs.readFileSync(SRC, 'utf8');
const lines = source.split('\n');

/* ---- the one collision ---------------------------------------------------- */
const renamed = source.replace(/\bdownloadBlob\b/g, 'chatDownloadBlob');
if (renamed === source) throw new Error('expected downloadBlob to be present');

const ast = parser.parse(renamed, { sourceType: 'script', errorRecovery: false });
let iife = null;
for (const st of ast.program.body) {
  if (st.type === 'ExpressionStatement' && st.expression.type === 'CallExpression') {
    const c = st.expression.callee;
    if (c.type === 'FunctionExpression' || c.type === 'ArrowFunctionExpression') { iife = c; break; }
  }
}
if (!iife) throw new Error('no IIFE found');
const body = iife.body.body;

/* ---- where the sections start ---------------------------------------------- */
const banners = [];
lines.forEach((l, i) => {
  const major = /^\/\* ={10,}/.test(l);
  const minor = /^\/\* -{10,}/.test(l);
  if (major || minor) {
    let title = '';
    for (let j = i + 1; j < i + 4 && j < lines.length; j++) {
      const t = (lines[j] || '').replace(/^\s*\*?\s*/, '').trim();
      if (t && !/^[-=*]+$/.test(t)) { title = t; break; }
    }
    banners.push({ line: i + 1, title, major });
  }
});

/* The banner text is prose, not a filename. Map the ones we know to short
   names and fall back to a slug for anything added later. */
const NAMES = [
  [/file transfer sizing|^constants/i, 'constants'],
  [/sticker/i, 'stickers'],
  [/media vault/i, 'media-vault'],
  [/call screen behaviour/i, 'call-screen'],
  [/two pictures are fitted/i, 'call-layout'],
  [/structured messages/i, 'structured-messages'],
  [/group management/i, 'groups'],
  [/chat lock, global search/i, 'lock-search-verify'],
  [/swipe to reply/i, 'selection'],
  [/bringing groups up/i, 'group-extras'],
  [/group calls .* mesh/i, 'group-call-mesh'],
  [/presenting, pinning/i, 'group-call-stage'],
  [/who is talking/i, 'group-call-roster'],
  [/stage is patched/i, 'group-call-render'],
  [/local file manager/i, 'file-manager'],
  [/forward secrecy/i, 'forward-secrecy'],
  [/one call, one row/i, 'call-rows'],
  [/chat list filters/i, 'chat-list-filters'],
  [/drafts/i, 'drafts'],
  [/taking your chats out/i, 'export-import'],
  [/settings section/i, 'settings-panels'],
  [/call history/i, 'call-log'],
  [/address book/i, 'contacts'],
  [/reader.s place/i, 'message-render'],
  [/offline envelopes/i, 'offline-envelopes'],
  [/relay is allowed to see/i, 'relay-privacy'],
  [/streaming file transfer/i, 'file-transfer'],
  [/rail header folds/i, 'rail-header'],
  [/^\*?\s*streaming file transfer/i, 'file-transfer'],
  [/^\*?\s*offline envelopes/i, 'offline-envelopes'],
  [/relay is allowed/i, 'relay-privacy'],
  [/handlegroupcallsignal/i, 'group-call-signalling'],
  [/one password for everything/i, 'conversation-lock'],
  [/globalsearch/i, 'global-search'],
  [/member of a group may do/i, 'group-permissions'],
  [/full-screen sheets/i, 'sheets-profile-clocks']
];
/* How far each banner is from the next one. A minor divider that opens five
   thousand lines is a section heading whatever it looks like, so span decides
   as much as style does. */
banners.forEach((b, i) => {
  b.span = (i + 1 < banners.length ? banners[i + 1].line : lines.length) - b.line;
});

const slug = (t, fallback) => {
  for (const [re, name] of NAMES) if (re.test(t || '')) return name;
  const s = (t || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 3).join('-');
  return s && s.length > 2 ? s : fallback;
};

/* ---- assign statements to modules ------------------------------------------ */
const modules = [];
let current = null;
let bannerIdx = 0;

const startModule = (title, startLine) => {
  current = { title, startLine, statements: [], from: null, to: null };
  modules.push(current);
};
startModule('constants', 1);

for (const st of body) {
  const line = st.loc.start.line;
  /* A banner at or before this statement opens a new module. */
  let opened = false;
  while (bannerIdx < banners.length && banners[bannerIdx].line <= line) {
    const b = banners[bannerIdx++];
    /* A major banner always opens a module. A minor one only does so once the
       current module has already grown past MIN_SPLIT — otherwise every little
       `---- reactions ----` divider would produce a thirty-line file. */
    const MIN_SPLIT = 400;
    const worth = b.major
      || b.span > MIN_SPLIT
      || (line - current.startLine) > MIN_SPLIT;
    if (!opened && worth && current.statements.length > 0) { startModule(b.title, b.line); opened = true; }
    else if (!current.title || current.statements.length === 0) current.title = current.title === 'constants' && current.statements.length === 0 ? current.title : b.title;
  }
  /* Or the current module has grown past the ceiling. */
  if (!opened && current.statements.length &&
      (line - current.startLine) > MAX_LINES) {
    startModule(current.title, line);
  }
  current.statements.push(st);
}

/* ---- source ranges, comments included -------------------------------------- */
/* A statement's leading comments are part of it here: this codebase explains
   itself in the comment above the function, and a split that stranded those
   comments in the previous file would destroy most of the value of reading it. */
function statementStart(st) {
  const lead = st.leadingComments;
  if (lead && lead.length) return lead[0].start;
  return st.start;
}

for (const m of modules) {
  m.from = statementStart(m.statements[0]);
  m.to = m.statements[m.statements.length - 1].end;
}
/* Close each module's range at the next module's start so nothing is dropped. */
for (let i = 0; i < modules.length - 1; i++) modules[i].to = modules[i + 1].from;
modules[modules.length - 1].to = iife.body.end - 1;   /* before the closing } */
modules[0].from = iife.body.start + 1;                /* after the opening { */

/* ---- emit ------------------------------------------------------------------ */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const used = new Set();
const files = [];
modules.forEach((m, i) => {
  let name = slug(m.title, 'part');
  let base = name, n = 2;
  while (used.has(name)) name = `${base}-${n++}`;
  used.add(name);
  const file = `${String(i + 1).padStart(2, '0')}-${name}.js`;
  const text = renamed.slice(m.from, m.to).replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
  const header =
`/* Part ${i + 1} of ${modules.length} of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   ${m.title}
*/

`;
  fs.writeFileSync(path.join(OUT, file), header + text);
  files.push({ file, lines: text.split('\n').length, statements: m.statements.length, title: m.title });
});

/* ---- prove nothing was lost ------------------------------------------------ */
const rebuilt = files.map(f =>
  fs.readFileSync(path.join(OUT, f.file), 'utf8').replace(/^\/\* Part [\s\S]*?\*\/\n\n/, '')
).join('\n');
const original = renamed.slice(iife.body.start + 1, iife.body.end - 1);
const norm = (s) => s.replace(/\s+/g, ' ').trim();
if (norm(rebuilt) !== norm(original)) {
  const a = norm(rebuilt), b = norm(original);
  let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++;
  throw new Error(`content changed at offset ${k}\n  got: ${a.slice(k-80, k+120)}\n want: ${b.slice(k-80, k+120)}`);
}

console.log(`${files.length} modules, ${files.reduce((a,f)=>a+f.lines,0)} lines total`);
files.forEach(f => console.log(`  ${f.file.padEnd(34)} ${String(f.lines).padStart(5)} lines  ${String(f.statements).padStart(4)} stmts  ${f.title.slice(0,46)}`));
fs.writeFileSync('tools/.chat-modules.json', JSON.stringify(files.map(f=>f.file), null, 1));
