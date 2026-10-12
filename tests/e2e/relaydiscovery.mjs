/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* «کشف محلی» — finding a relay.
 *
 *   - an internet relay is only ever tried over https, whatever the page's
 *     own scheme: the native shells load from tauri:// or http://, and that
 *     used to turn an https relay into its plain port (Android) or into the
 *     shell's own origin (macOS);
 *   - plain http is tried on this machine and the local network only, and an
 *     address saved under a relay's plain port counts as one to move off;
 *   - the shell's own origin is never a candidate;
 *   - candidates are probed together, so a relay whose TLS is filtered costs
 *     one timeout rather than one per guess, and the earliest answering
 *     candidate still wins;
 *   - discovery finds a relay that answers, and says so.
 */
import net from 'node:net';
import { openApp, browser } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);

/* Accepts and never answers: what a relay whose TLS is filtered looks like
   from the client — the connection is up, and nothing ever comes back. */
const sockets = new Set();
const silent = net.createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
/* localhost, which the test page's CSP lets it connect to on any port. */
const hang = `http://localhost:${silent.address().port}`;

const stacks = await startTwoStacks();
try {
  const P = await openApp('FINDER', { origin: stacks.a.url, relay: stacks.a.url });
  const candidatesFor = (serverUrl, hints = []) => P.evaluate(({ url, list }) => {
    const saved = chatState.profile.serverUrl;
    const savedHints = window.__POORIJA_RELAY_HINTS__;
    chatState.profile.serverUrl = url;
    window.__POORIJA_RELAY_HINTS__ = list;
    const out = localDiscoveryCandidates(true);
    chatState.profile.serverUrl = saved;
    window.__POORIJA_RELAY_HINTS__ = savedHints;
    return out;
  }, { url: serverUrl, list: hints });

  section('which addresses are tried');
  const remote = (await candidatesFor('https://relay.example.ir:8585')).filter((c) => c.includes('relay.example.ir'));
  check('an internet relay is tried over https only, on its port and 443',
    JSON.stringify(remote) === JSON.stringify(['https://relay.example.ir:8585', 'https://relay.example.ir']), JSON.stringify(remote));
  const plain = (await candidatesFor('http://relay.example.ir:9000')).filter((c) => c.includes('relay.example.ir'));
  check('an address saved under the plain port is tried as https instead — never as http',
    plain.length > 0 && plain.every((c) => c.startsWith('https://')) && plain.includes('https://relay.example.ir:8585'), JSON.stringify(plain));
  const lan = (await candidatesFor('http://192.168.1.5:9000')).filter((c) => c.includes('192.168.1.5'));
  check('on the local network plain http is allowed, and the saved address comes first',
    lan[0] === 'http://192.168.1.5:9000' && lan.some((c) => c.startsWith('https://192.168.1.5')), JSON.stringify(lan));
  const shells = await candidatesFor('', ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']);
  check('the native shell\'s own origin is never a candidate', !shells.some((c) => /tauri/i.test(c)), JSON.stringify(shells));
  const flags = await P.evaluate(() => [
    isPlaintextPublicRelay('http://relay.example.ir:9000'),
    isPlaintextPublicRelay('http://127.0.0.1:9000'),
    isPlaintextPublicRelay('http://10.0.0.2:9000'),
    isPlaintextPublicRelay('https://relay.example.ir:8585'),
  ]);
  check('a plain-http internet relay is recognised as one to move off; a local one is not',
    JSON.stringify(flags) === JSON.stringify([true, false, false, false]), JSON.stringify(flags));

  section('probing');
  const timed = await P.evaluate(async ({ a, b, silentOrigin }) => {
    const dead = new Array(5).fill(silentOrigin);
    const started = performance.now();
    const found = await firstAnsweringRelay([...dead, b, a]);
    return { origin: found?.origin || '', ms: Math.round(performance.now() - started) };
  }, { a: stacks.a.url, b: stacks.b.url, silentOrigin: hang });
  check('five silent candidates cost one timeout, not five', timed.ms >= 3500 && timed.ms < 9000, `${timed.ms} ms`);
  check('and of two relays that answer, the earlier candidate wins', timed.origin === new URL(stacks.b.url).origin, timed.origin);
  const none = await P.evaluate((origin) => firstAnsweringRelay([origin]), hang);
  check('nothing answering is nothing found', none === null);

  section('the button');
  const found = await P.evaluate(async (relay) => {
    chatState.profile.serverUrl = 'https://relay-that-does-not-exist.invalid:8585';
    window.__POORIJA_RELAY_HINTS__ = [relay];
    const toasts = [];
    const original = window.PoorijaApp.showNotification;
    window.PoorijaApp.showNotification = (message, type) => { toasts.push(`${type}: ${message}`); };
    const result = await discoverLocalRelayServer({ fullScan: true, silent: false });
    window.PoorijaApp.showNotification = original;
    return { origin: result?.origin || '', saved: chatState.profile.serverUrl, toasts };
  }, stacks.a.url);
  check('discovery finds the relay that answers and keeps it', found.origin === new URL(stacks.a.url).origin && found.saved === found.origin, JSON.stringify(found));
  check('and says where it found it', found.toasts.some((line) => line.startsWith('success') && line.includes(found.origin)), found.toasts.join(' | '));
  check('no page errors', !(P.__errors || []).length, (P.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
  sockets.forEach((socket) => socket.destroy());
  silent.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
