/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* That what somebody wrote never reaches the system notification surface.
 *
 * Two surfaces, two audiences. A toast is drawn inside a window the person
 * already has open and unlocked. A system notification lands on a lock
 * screen, in a shade the whole room can see, or on a paired watch.
 *
 * showNotification() mirrored every toast to the second one, and every native
 * shell is a desktop runtime -- Android included. So an arriving message
 * raised "Name: <the message>" on the lock screen of every native build,
 * while the same build's PWA showed only that something encrypted had
 * arrived. The PWA has no such mirror: it takes the contentless push from the
 * service worker, which is all the relay can send because the relay holds
 * nothing but a sealed envelope.
 *
 * The relay half is covered by unifiedpush.mjs, which asserts the bytes it
 * POSTs carry no text. This is the other half: the client, which does hold
 * the plaintext and must not put it where a stranger can read it.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');
const render = readFileSync(join(ROOT, 'js', 'chat', '27-message-render.js'), 'utf8');

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

console.log('\nNotification privacy');

/* ---- the mirror can be refused --------------------------------------- */

function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} is gone`);
  /* Counting from the first brace after the name finds the one in the
     parameter list, now that the signature destructures its options --
     which silently returned a function with no closing brace. Walk the
     parameters to their matching paren first, and open the body from there. */
  let parens = 0;
  let cursor = source.indexOf('(', start);
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === '(') parens += 1;
    else if (source[cursor] === ')') {
      parens -= 1;
      if (!parens) break;
    }
  }
  let depth = 0;
  for (let i = source.indexOf('{', cursor); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (!depth) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} is not closed`);
}

const body = extract(app, 'showNotification');
ok(/\{\s*system\s*=\s*true\s*\}\s*=\s*\{\}/.test(body),
  'showNotification takes a system flag');
ok(/if \(system\) void sendDesktopSystemNotification/.test(body),
  'and the system notification is raised only when it is not refused');

/* Run it, rather than trusting the shape. A stub stands in for everything the
   real one touches; what is measured is whether the mirror fired. */
function runToast({ system }) {
  const raised = [];
  const stack = {
    id: '', className: '', parentElement: null, nextSibling: null, children: [],
    appendChild(child) { this.children.push(child); },
    remove() {},
  };
  const element = () => ({
    className: '', style: {}, innerHTML: '', children: [],
    querySelector: () => ({ textContent: '' }),
    remove() {},
  });
  const scope = {
    state: { settings: { notifications: true } },
    document: {
      getElementById: (id) => (id === 'toastStack' ? stack : null),
      createElement: () => element(),
      body: { appendChild() {} },
    },
    setTimeout: () => 0,
    sendDesktopSystemNotification: (text) => { raised.push(text); },
  };
  // eslint-disable-next-line no-new-func
  new Function('state', 'document', 'setTimeout', 'sendDesktopSystemNotification',
    `${body}\nshowNotification('Ada: meet me at six', 'info'${system === undefined ? '' : `, { system: ${system} }`});`)(
    scope.state, scope.document, scope.setTimeout, scope.sendDesktopSystemNotification);
  return raised;
}

ok(runToast({ system: false }).length === 0,
  'a toast that refuses the mirror raises no system notification');
ok(runToast({ system: undefined }).length === 1,
  'and one that says nothing still gets one, so operational notices are unchanged');

/* ---- the arriving-message path refuses it ----------------------------- */

/* The preview is built here; this is the line that must not be mirrored. */
const previewCall = /app\(\)\.showNotification\?\.\(text, 'info'([^)]*)\)/.exec(render);
ok(Boolean(previewCall), 'the arrival path still raises a toast for the preview');
ok(previewCall && /system:\s*false/.test(previewCall[1]),
  'and it refuses the system mirror, so the preview stays inside the app');

/* Something still has to be announced, and it has to say nothing. */
const systemCall = /sendDesktopSystemNotification\(\s*t\(([^)]*)\)/.exec(render);
ok(Boolean(systemCall), 'the arrival path raises its own system notification');
ok(systemCall && !/\$\{/.test(systemCall[1]),
  'whose text is a fixed string — nothing interpolated into it');

/* The sender's name is content too: it says who is talking to whom, which is
   the one thing the encryption cannot hide. */
const mirrored = [...render.matchAll(/sendDesktopSystemNotification\(([^;]*)\);/g)]
  .map((match) => match[1]);
ok(mirrored.every((argument) => !/senderName|label|entry\.|\$\{/.test(argument)),
  'no system notification anywhere in this file carries a name or a preview');

console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}\n`);
process.exit(failures ? 1 : 0);
