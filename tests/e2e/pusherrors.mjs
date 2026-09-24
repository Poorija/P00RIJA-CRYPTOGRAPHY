/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What the user is told when a push call does not get JSON back.
 *
 * Reported from the Android build: turning on notifications produced
 *
 *   SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 *
 * That is Express's own 404 page being handed to response.json(). The relay
 * the phone was pointed at predated /push/challenge, so the route was not
 * there -- and nothing in that sentence says "update the relay", which is the
 * only thing the person could have done about it.
 *
 * Three unrelated problems produced the same message: a relay too old to have
 * the route, a reverse proxy that does not forward /push/, and an address that
 * is not a relay at all. The status and the content type distinguish all three
 * before anything is parsed, so the answer can name which one it was.
 *
 * These are the shapes a relay, a proxy and a webview actually return. The
 * function is pure, so it is taken from the source and called directly.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');

/* Lifts the function out of the bundle by matching its braces. */
function extract(name) {
  const start = source.indexOf(`async function ${name}(`);
  if (start < 0) throw new Error(`${name} is not in js/app.js any more`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (!depth) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} is not closed`);
}

/* The real strings, read from the English dictionary rather than repeated
   here: a test that carries its own copy passes after somebody rewrites the
   message into something that no longer says what to do.

   Scoped to `en`, because `fa` is declared first and a plain search finds it
   -- which is how the first run of this asserted that a Persian sentence
   contained the English word "update". */
const english = source.slice(source.indexOf('\nen: {'));
function phrase(key) {
  const found = new RegExp(`\\n${key}: '((?:[^'\\\\]|\\\\.)*)'`).exec(english);
  if (!found) throw new Error(`${key} is not in the en dictionary`);
  return found[1].replace(/\\'/g, "'");
}

// eslint-disable-next-line no-new-func
const readRelayJson = new Function('getTranslatedText', `return ${extract('readRelayJson')}`)(phrase);

/** A fetch Response, as far as this function looks at one. */
const answer = (status, contentType, body) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: () => contentType },
  json: async () => JSON.parse(body),
});

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

async function rejectsWith(response, fragment, label) {
  let message = '';
  try {
    await readRelayJson(response, 'challenge');
    message = '(it returned instead of throwing)';
  } catch (error) {
    message = String(error.message || error);
  }
  ok(message.includes(fragment), `${label} — "${message}"`);
}

console.log('\nPush error reporting');

/* The reported bug, byte for byte: Express's 404 page for a route a relay
   older than 2.44.0 does not have. */
await rejectsWith(
  answer(404, 'text/html; charset=utf-8',
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n'
    + '<body>\n<pre>Cannot POST /push/challenge</pre>\n</body>\n</html>\n'),
  '2.44.0', 'a relay without the route says which version has it');

await rejectsWith(answer(405, 'text/html', '<html>405 Method Not Allowed</html>'),
  '2.44.0', 'a route that rejects the method reads the same way');

/* The native shell falling back to its own origin: the asset protocol serves
   index.html for anything it does not recognise. */
await rejectsWith(
  answer(200, 'text/html; charset=utf-8', '<!DOCTYPE html>\n<html><head><title>P00RIJA</title>'),
  'relay', 'the app answering itself is named as not being a relay');

await rejectsWith(answer(502, 'text/html', '<html>502 Bad Gateway</html>'),
  '502', 'a gateway error carries its status');

/* A proxy or captive portal writing over the body of something that claims to
   be JSON. Nothing sensible to say except that it could not be read. */
await rejectsWith(answer(200, 'application/json', '<html>captive portal</html>'),
  'read', 'a body that lies about being JSON is reported as unreadable');

/* A relay answering properly must still get through, including when what it
   says is no: the caller reads `reason` and has its own wording for it. */
const refusal = await readRelayJson(
  answer(400, 'application/json; charset=utf-8', '{"ok":false,"reason":"fingerprint-and-key-required"}'),
  'challenge');
ok(refusal?.reason === 'fingerprint-and-key-required',
  "a relay's own refusal reaches the caller instead of being turned into a status");

const accepted = await readRelayJson(
  answer(200, 'application/json', '{"ok":true,"challengeId":"abc"}'), 'challenge');
ok(accepted?.ok === true && accepted?.challengeId === 'abc', 'and so does a relay saying yes');

/* The wording is the whole point of this, so it is checked rather than
   assumed: a message that does not say what to do is the bug coming back. */
ok(/2\.44\.0/.test(phrase('pushRelayTooOld')) && /\b(update|upgrade)\b/i.test(phrase('pushRelayTooOld')),
  'the too-old message names a version AND an action');
ok(/settings/i.test(phrase('pushNotARelay')),
  'the wrong-address message says where to correct it');

console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}\n`);
process.exit(failures ? 1 : 0);
