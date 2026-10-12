/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Link previews fetched by the relay, for the web app and the phone apps.
 *
 *   - the fetcher refuses what a pasted link must not reach: other schemes,
 *     passwords, odd ports, loopback, the local network, cloud metadata,
 *     IPv4 hidden inside IPv6, local names, and a public name that resolves
 *     to 127.0.0.1;
 *   - against a page it may fetch, the relay returns the title, the text and
 *     the picture, follows a redirect on the same site, and gives no card for
 *     a redirect to another site, for a non-page, or for a page too slow;
 *   - the relay says it does previews, and the web app then offers the
 *     switch — with a hint that says the relay sees the link — and a message
 *     sent with a link carries a card.
 */
import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { openApp, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const require = createRequire(import.meta.url);
/* Loaded before the test switch below is set, so the guards are the real ones. */
const { checkedLink, isPublicAddress, linkPreview, readPage } = require('../../scripts/lib/link-preview.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);
const refuses = (raw) => { try { checkedLink(raw); return false; } catch (_error) { return true; } };

section('every settings switch is one kind of switch');
{
  /* A switch row takes the on-colour from syncChatToggleStates' list; a
     switch left out of it moves only its knob, which is how the link preview
     switch shipped. Every chat switch in the page must be on the list. */
  const page = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('../../js/chat/17-file-manager.js', import.meta.url), 'utf8');
  const listed = new Set([...script.slice(script.indexOf('const toggleMeta'), script.indexOf('Object.entries(toggleMeta)'))
    .matchAll(/^\s*(\w+):\s*\[/gm)].map((m) => m[1]));
  const switches = [...page.matchAll(/<label[^>]*class="[^"]*\bchat-toggle\b[^"]*"[^>]*>([\s\S]*?)<\/label>/g)]
    .flatMap((m) => [...m[1].matchAll(/<input[^>]*\bid="([^"]+)"[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*\bid="([^"]+)"/g)].map((i) => i[1] || i[2]));
  const left = switches.filter((id) => !listed.has(id));
  check('every chat switch gets the same on-colour as the rest', switches.length > 5 && left.length === 0, left.join(' ') || `${switches.length} switches`);
}

section('what a pasted link may not reach');
const refused = [
  'file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)', 'https://user:pass@example.com/',
  'https://example.com:22/', 'http://127.0.0.1/', 'http://10.1.2.3/', 'http://192.168.1.1/', 'http://172.20.0.1/',
  'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://[::1]/',
  'http://[::ffff:127.0.0.1]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/', 'http://[fd00::1]/',
  'http://[fe80::1]/', 'http://localhost/', 'http://printer.local/', 'http://db.internal/', 'http://intranet/',
];
const leaked = refused.filter((raw) => !refuses(raw));
check('every one of them is refused', leaked.length === 0, leaked.join(' '));
check('an ordinary web address is allowed, on the web ports', !refuses('https://example.com/a?b=1') && !refuses('http://93.184.216.34:8080/'));
check('public and private addresses are told apart', isPublicAddress('8.8.8.8') && isPublicAddress('2606:4700::1111')
  && !isPublicAddress('100.64.1.1') && !isPublicAddress('fd12::1') && !isPublicAddress('::ffff:10.0.0.1'));
let rebound = 'fetched';
try { await linkPreview('http://localtest.me/'); } catch (error) { rebound = error.message; }
check('a public name that resolves to 127.0.0.1 is refused at the address', rebound !== 'fetched', rebound);
const parsed = readPage('<html><head><title>Fallback</title><meta property="og:title" content="A &amp; B"><meta name="description" content=\'Line one\'><meta property="og:image" content="/pic.png"></head></html>');
check('a page describes itself through its meta tags', parsed.title === 'A &amp; B' && parsed.description === 'Line one' && parsed.image === '/pic.png', JSON.stringify(parsed));

/* From here on the relays may fetch from this machine, as a test needs. */
process.env.CHAT_LINK_PREVIEW_ALLOW_PRIVATE = '1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDIwMDAwAAAj7AP+2kOmFgAAAABJRU5ErkJggg==', 'base64');
const site = http.createServer((req, res) => {
  if (req.url === '/page') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><head><title>T</title><meta property="og:title" content="A good story"><meta property="og:description" content="Told well &amp; briefly"><meta property="og:site_name" content="Example"><meta property="og:image" content="/pic.png"></head><body>x</body></html>');
  } else if (req.url === '/pic.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
  } else if (req.url === '/redir-same') {
    res.writeHead(302, { location: '/page' });
    res.end();
  } else if (req.url === '/redir-other') {
    res.writeHead(302, { location: `http://localhost:${site.address().port}/page` });
    res.end();
  } else if (req.url === '/json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"title":"no"}');
  } else if (req.url === '/slow') {
    /* Never answers. */
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${site.address().port}`;

const stacks = await startTwoStacks();
const ask = async (url) => {
  const started = Date.now();
  const response = await fetch(`${stacks.a.url}/link-preview`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
  });
  return { status: response.status, body: await response.json().catch(() => null), ms: Date.now() - started };
};
try {
  section('the relay fetching a page');
  const health = await (await fetch(`${stacks.a.url}/chat-health`)).json();
  check('the relay says it does previews', health.linkPreviews === true);
  const page = await ask(`${base}/page`);
  const preview = page.body?.preview;
  check('it returns the title, the text and the site', page.status === 200 && preview?.title === 'A good story'
    && preview?.description === 'Told well & briefly' && preview?.siteName === 'Example', JSON.stringify(page.body).slice(0, 200));
  check('and the picture, as it was served', preview?.imageMime === 'image/png' && Buffer.from(preview?.imageData || '', 'base64').equals(PNG));
  const same = await ask(`${base}/redir-same`);
  check('a redirect on the same site is followed', same.body?.preview?.url === `${base}/page`, JSON.stringify(same.body).slice(0, 160));
  const other = await ask(`${base}/redir-other`);
  check('a redirect to another site gives no card', other.status === 200 && other.body?.preview === null, JSON.stringify(other.body));
  const json = await ask(`${base}/json`);
  check('something that is not a page gives no card', json.status === 200 && json.body?.preview === null);
  const slow = await ask(`${base}/slow`);
  check('a page that never answers is given up on in time', slow.status === 422 && slow.ms < 12000, `${slow.status} after ${slow.ms} ms`);
  const bad = await ask('file:///etc/passwd');
  check('and a link it may not fetch is refused with a reason', bad.status === 422 && Boolean(bad.body?.reason), JSON.stringify(bad.body));

  section('the web app');
  const P = await openApp('WEB', { origin: stacks.a.url, relay: stacks.a.url });
  check('the switch is offered in a browser, against a relay that does previews',
    await waitFor(P, () => !document.getElementById('chatLinkPreviewsRow')?.classList.contains('hidden'), { timeoutMs: 15000 }));
  const hint = await P.evaluate(() => document.getElementById('chatLinkPreviewsHint')?.textContent || '');
  check('and its hint says the relay sees the link', /relay sees the link/i.test(hint), hint.slice(0, 120));
  await P.evaluate(() => {
    const toggle = document.getElementById('chatLinkPreviews');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    openSavedMessages();
  });
  check('it turns on', await P.evaluate(() => linkPreviewsEnabled()));
  const row = await P.evaluate(() => {
    const own = document.getElementById('chatLinkPreviewsRow');
    const other = document.getElementById('chatSendReceipts')?.closest('.chat-toggle');
    const look = (el) => { const cs = getComputedStyle(el); return `${cs.backgroundColor}|${cs.borderColor}`; };
    return { active: own.classList.contains('is-active'), same: look(own) === look(other), state: own.dataset.state };
  });
  check('and its row takes the on-colour, the same as the read-receipts row', row.active && row.same && row.state === 'on', JSON.stringify(row));
  await P.evaluate((link) => {
    const box = document.getElementById('chatComposer');
    box.value = `read this ${link}`;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }, `${base}/page`);
  check('typing a link shows its preview above the composer',
    await waitFor(P, () => /A good story/.test(document.getElementById('chatLinkPreviewChip')?.textContent || ''), { timeoutMs: 15000 }));
  await P.evaluate(() => document.getElementById('chatSendMessageBtn').click());
  check('and the message carries the card',
    await waitFor(P, () => [...document.querySelectorAll('#chatMessages .chat-link-preview')].some((card) => /A good story/.test(card.textContent)), { timeoutMs: 10000 }));
  check('no page errors', !(P.__errors || []).length, (P.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
  site.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
