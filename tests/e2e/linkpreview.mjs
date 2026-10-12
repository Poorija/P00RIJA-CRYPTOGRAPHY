/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A sender-made link preview, from the composer to the other side's card.
 *
 * The fetch itself is the desktop shell's (src-tauri/src/link_preview.rs,
 * with its own tests) or the relay's (linkpreviewrelay.mjs); here the preview the composer holds is set directly,
 * which is what the fetch produces, and the rest of the path is real:
 *   - it goes only with a message that still contains its link;
 *   - it arrives encrypted, is checked again on arrival, and is drawn as a
 *     card that links out — the receiver fetches nothing;
 *   - a bad picture or a non-web link is dropped by the checks;
 *   - a message request shows no card;
 *   - in a browser the switch starts off and the relay is the one that
 *     fetches (linkpreviewrelay.mjs covers that fetch).
 */
import { openApp, identity, importIdentity, browser, waitFor } from './_chat-harness.mjs';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const fingerprintOf = (card) => JSON.parse(atob(card.replace('poorija-chat-v1:', ''))).fingerprint;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const openConversation = (page, fp) => page.evaluate(async (key) => {
  const peer = findPeerByAnyKey(key);
  chatState.activeConversationId = getConversationKey(peer);
  chatState.activePeerClientId = peer.clientId || '';
  renderPeers(); renderActivePeer(); renderMessages();
  await new Promise((r) => setTimeout(r, 400));
}, fp);
/* A 2x2 PNG, the shape a re-drawn thumbnail has. */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDIwMDAwAAAj7AP+2kOmFgAAAABJRU5ErkJggg==';

const stacks = await startTwoStacks();
try {
  const SENDER = await openApp('SENDER', { origin: stacks.a.url, relay: stacks.a.url });
  const READER = await openApp('READER', { origin: stacks.a.url, relay: stacks.a.url });
  const cardSender = await identity(SENDER);
  const cardReader = await identity(READER);
  const fpSender = fingerprintOf(cardSender);
  const fpReader = fingerprintOf(cardReader);
  await importIdentity(SENDER, cardReader);
  await importIdentity(READER, cardSender);
  await waitFor(SENDER, (fp) => Boolean(findPeerByAnyKey(fp)?.publicKeyData), { timeoutMs: 30000, arg: fpReader });

  check('in a browser previews are off until turned on, and fetched by the relay', await READER.evaluate(() => linkPreviewMode() === 'relay' && !linkPreviewsEnabled()));

  const checks = await SENDER.evaluate((pixel) => ({
    good: Boolean(sanitizeLinkPreview({ url: 'https://example.com/a', title: 'T', image: pixel })),
    svg: sanitizeLinkPreview({ url: 'https://example.com/a', title: 'T', image: 'data:image/svg+xml;base64,PHN2Zz4=' })?.image,
    js: sanitizeLinkPreview({ url: 'javascript:alert(1)', title: 'T' }),
    quote: sanitizeLinkPreview({ url: 'https://example.com/a', title: 'T', image: 'data:image/png;base64,AAAA" onerror="x' })?.image,
    empty: sanitizeLinkPreview({ url: 'https://example.com/a' }),
  }), PIXEL);
  check('the checks keep a real preview and drop an SVG, a script link, a broken picture and an empty card',
    checks.good && checks.svg === '' && checks.js === null && checks.quote === '' && checks.empty === null, JSON.stringify(checks));

  await openConversation(SENDER, fpReader);
  const dropped = await SENDER.evaluate(() => {
    chatState.composerLinkPreview = { url: 'https://example.com/story', title: 'A story', description: 'About something', siteName: 'Example', image: '', source: 'https://example.com/story' };
    return takeComposerPreview('a message without the link');
  });
  check('a preview whose link was deleted from the text is not sent', dropped === null);

  const text = `read this https://example.com/story ${Date.now()}`;
  await SENDER.evaluate(({ value, pixel }) => {
    chatState.composerLinkPreview = { url: 'https://example.com/story', title: 'A story', description: 'About something', siteName: 'Example', image: pixel, source: 'https://example.com/story' };
    const box = document.getElementById('chatComposer');
    box.value = value;
    document.getElementById('chatSendMessageBtn').click();
  }, { value: text, pixel: PIXEL });
  const arrived = await waitFor(READER, (value) => Object.values(chatState.history).flat().some((e) => e.text === value && e.preview), { timeoutMs: 60000, arg: text });
  check('the preview arrives with its message', arrived === true);
  await openConversation(READER, fpSender);
  const card = await READER.evaluate(() => {
    const link = document.querySelector('#chatMessages a.chat-link-preview');
    return link ? { href: link.getAttribute('href'), rel: link.getAttribute('rel'), title: link.querySelector('strong')?.textContent, img: (link.querySelector('img')?.getAttribute('src') || '').slice(0, 22) } : null;
  });
  check('and is drawn as a card that links out, from the data that came with it', card?.href === 'https://example.com/story' && /noopener/.test(card?.rel || '') && card?.title === 'A story' && card?.img === 'data:image/png;base64,', JSON.stringify(card));
  const fetched = await READER.evaluate(() => performance.getEntriesByType('resource').some((r) => r.name.includes('example.com')));
  check('the reader\'s device never contacted the site', fetched === false);
  const spoof = await READER.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = linkPreviewCardHtml({ text: 'my bank https://bank.example/login', preview: { url: 'https://evil.example/login', title: 'Bank', siteName: 'bank.example' } })
      + linkPreviewCardHtml({ text: 'my bank https://bank.example/login', preview: { url: 'https://bank.example/other', title: 'Bank', siteName: 'Evil' } });
    const cards = [...host.querySelectorAll('a.chat-link-preview')];
    return { count: cards.length, href: cards[0]?.getAttribute('href'), site: cards[0]?.querySelector('.chat-link-preview-site')?.textContent };
  });
  check('a card for a host the text does not show is not drawn, and a drawn one leads to the visible link under its real host',
    spoof.count === 1 && spoof.href === 'https://bank.example/login' && /^bank\.example/.test(spoof.site || ''), JSON.stringify(spoof));

  const STRANGER = await openApp('STRANGER', { origin: stacks.a.url, relay: stacks.a.url });
  await importIdentity(STRANGER, cardReader);
  await waitFor(STRANGER, (fp) => Boolean(findPeerByAnyKey(fp)?.publicKeyData), { timeoutMs: 30000, arg: fpReader });
  const fpStranger = fingerprintOf(await identity(STRANGER));
  await openConversation(STRANGER, fpReader);
  const strangerText = `look https://example.com/bait ${Date.now()}`;
  await STRANGER.evaluate(({ value, pixel }) => {
    chatState.composerLinkPreview = { url: 'https://example.com/bait', title: 'Bait', description: '', siteName: '', image: pixel, source: 'https://example.com/bait' };
    const box = document.getElementById('chatComposer');
    box.value = value;
    document.getElementById('chatSendMessageBtn').click();
  }, { value: strangerText, pixel: PIXEL });
  await waitFor(READER, (value) => Object.values(chatState.history).flat().some((e) => e.text === value), { timeoutMs: 60000, arg: strangerText });
  await openConversation(READER, fpStranger);
  await sleep(500);
  const strangerCard = await READER.evaluate(() => document.querySelectorAll('#chatMessages a.chat-link-preview').length);
  check('a message request shows no card', strangerCard === 0, String(strangerCard));

  check('no page errors', [SENDER, READER, STRANGER].every((p) => !(p.__errors || []).length), [SENDER, READER, STRANGER].flatMap((p) => p.__errors || []).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
