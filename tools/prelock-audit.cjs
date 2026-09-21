/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Which poorija_* keys does the app touch while it is still locked?
 *
 * Any key read before unlock and written after it (or the reverse) now lands
 * in two different places, because the storage redirection only points at a
 * profile once one is open. That is a whole class of bug, not one bug, so it
 * is worth enumerating rather than fixing case by case. */
const parser = require('@babel/parser');
const fs = require('fs');

const files = ['js/app.js', ...fs.readdirSync('js/chat').filter(f=>f.endsWith('.js')).map(f=>'js/chat/'+f)];

/* Functions that only ever run before a profile is open. */
const PRE_UNLOCK = new Set([
  'checkFirstVisit','selectLanguage','unlockApp','unlockWithPasskey','showLockTimer',
  'showResetPassword','initSecQuestionsUI','verifySecurityAnswers','legacyVerifyMasterPassword',
  'openVaultForUnlock','loadTheme','applyTheme','syncLockScreenLayout','initTheme',
  'getInstallationSecret','showDesktopBiometricPromptIfNeeded','syncPwaRuntimeState'
]);

const hits = new Map();   // key -> Set of enclosing function names

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = parser.parse(src, { sourceType: 'script', errorRecovery: true });
  const stack = [];
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    const named = (node.type === 'FunctionDeclaration' && node.id) ? node.id.name : null;
    if (named) stack.push(named);

    if (node.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        node.callee.object?.name === 'localStorage' &&
        ['getItem','setItem','removeItem'].includes(node.callee.property?.name)) {
      const arg = node.arguments[0];
      let key = null;
      if (arg?.type === 'StringLiteral') key = arg.value;
      else if (arg?.type === 'Identifier') key = '<' + arg.name + '>';
      if (key && (key.startsWith('poorija_') || key.startsWith('<'))) {
        const fn = stack[stack.length - 1] || '<top level>';
        if (!hits.has(key)) hits.set(key, new Set());
        hits.get(key).add(fn);
      }
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
    if (named) stack.pop();
  };
  walk(ast.program);
}

console.log('=== keys touched from a pre-unlock code path ===');
let risky = 0;
for (const [key, fns] of [...hits].sort()) {
  const pre = [...fns].filter(f => PRE_UNLOCK.has(f) || f === '<top level>');
  if (pre.length) {
    const post = [...fns].filter(f => !PRE_UNLOCK.has(f) && f !== '<top level>');
    const flag = post.length ? '  BOTH SIDES' : '';
    console.log(`  ${key.padEnd(38)} pre: ${pre.join(', ')}${flag}`);
    if (post.length) { console.log(`  ${''.padEnd(38)} post: ${post.slice(0,4).join(', ')}`); risky++; }
  }
}
console.log(`\n  ${risky} key(s) are touched on BOTH sides of unlock — those are the dangerous ones.`);
