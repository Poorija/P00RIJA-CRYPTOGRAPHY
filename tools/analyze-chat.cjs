/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

const parser = require('@babel/parser');
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const ast = parser.parse(src, { sourceType: 'script', errorRecovery: false });

// find the IIFE body
let body = null;
for (const st of ast.program.body) {
  if (st.type === 'ExpressionStatement' && st.expression.type === 'CallExpression') {
    const c = st.expression.callee;
    if (c.type === 'FunctionExpression' || c.type === 'ArrowFunctionExpression') { body = c.body.body; break; }
  }
}
if (!body) { console.log('NO IIFE FOUND'); process.exit(1); }
console.log('top-level statements inside the IIFE:', body.length);

const names = (node) => {
  const out = [];
  const fromPattern = (p) => {
    if (!p) return;
    if (p.type === 'Identifier') out.push(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach(pr => fromPattern(pr.value || pr.argument));
    else if (p.type === 'ArrayPattern') p.elements.forEach(fromPattern);
    else if (p.type === 'AssignmentPattern') fromPattern(p.left);
    else if (p.type === 'RestElement') fromPattern(p.argument);
  };
  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') { if (node.id) out.push(node.id.name); }
  else if (node.type === 'VariableDeclaration') node.declarations.forEach(d => fromPattern(d.id));
  return out;
};

const decls = [];
let kinds = {};
for (const st of body) {
  const ns = names(st);
  const kind = st.type === 'VariableDeclaration' ? st.kind : st.type;
  kinds[kind] = (kinds[kind]||0)+1;
  if (ns.length) decls.push({ kind, names: ns, start: st.start, end: st.end, line: st.loc.start.line });
}
console.log('statement kinds:', JSON.stringify(kinds));
console.log('declaring statements:', decls.length, ' names:', decls.reduce((a,d)=>a+d.names.length,0));

const mutable = decls.filter(d => d.kind === 'let' || d.kind === 'var');
console.log('\nmutable top-level bindings:', mutable.length);
console.log(mutable.map(d=>`${d.names.join(',')}@${d.line}`).join('  '));

fs.writeFileSync('tools/.chat-decls.json', JSON.stringify({decls, bodyStart: body[0].start, bodyEnd: body[body.length-1].end}, null, 1));
