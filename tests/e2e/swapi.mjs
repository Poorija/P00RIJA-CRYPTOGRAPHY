/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The service worker hands out the app's own files, never the relay's answers.
 *
 *   Every suite but this one takes the service worker away (the harness does,
 *   so its reload cannot land in the middle of a setup), which is how this got
 *   past all of them: the worker kept any GET it did not know as a file of the
 *   app, under its path with the query cut off, and answered the next GET to
 *   that path from it. On a phone importing a Telegram pack, the first few
 *   stickers came from the relay and every one after was the same picture
 *   again; a second pack came back as the first, description and all.
 *
 *   With the worker installed and in charge of the page, against a fake
 *   Telegram behind the relay:
 *   - two different packs are described as themselves;
 *   - every file of both arrives as itself, fetched four at a time as the app
 *     does;
 *   - the relay's other GET answers are asked for too, and nothing but the
 *     app's own files ends up in the worker's cache — which still holds them.
 */
import http from 'node:http';
import { chromium } from 'playwright';
import { startTwoStacks } from './_two-stacks.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 260) : ''}`);
};
const TOKEN = '123456:FAKE-token-for-the-suite_abcdefghijklmnop';
/* Two packs of eight, every file different and naming itself in its bytes. */
const packs = {
  PackOne: { title: 'Pack One', ids: Array.from({ length: 8 }, (_, i) => `AAQCAgADpackOneFile${String(i).padStart(10, '0')}`) },
  PackTwo: { title: 'Pack Two', ids: Array.from({ length: 8 }, (_, i) => `AAQCAgADpackTwoFile${String(i).padStart(10, '0')}`) },
};
const telegram = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === `/bot${TOKEN}/getStickerSet`) {
    const name = url.searchParams.get('name');
    const pack = packs[name];
    if (!pack) return send({ ok: false, description: 'Bad Request: STICKERSET_INVALID' });
    return send({ ok: true, result: { name, title: pack.title, stickers: pack.ids.map((id) => ({ file_id: id, emoji: '🙂', is_animated: false, is_video: false })) } });
  }
  if (url.pathname === `/bot${TOKEN}/getFile`) return send({ ok: true, result: { file_path: `stickers/${url.searchParams.get('file_id')}.webp` } });
  const prefix = `/file/bot${TOKEN}/stickers/`;
  if (url.pathname.startsWith(prefix)) {
    /* A little delay, so four requests are really in flight at once. */
    setTimeout(() => { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(`file:${url.pathname.slice(prefix.length).replace(/\.webp$/, '')}`); }, 40);
    return undefined;
  }
  res.writeHead(404); res.end();
  return undefined;
});
await new Promise((resolve) => telegram.listen(0, '127.0.0.1', resolve));

const stacks = await startTwoStacks({ envA: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: `http://127.0.0.1:${telegram.address().port}` } });
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(`${stacks.a.url}/index.html`, { waitUntil: 'load' });
  const ready = await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 20000)),
  ]));
  /* The app reloads itself once when a worker takes over; let that happen,
     then make sure this page is the worker's. */
  await page.waitForTimeout(1500);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(800);
  }
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  check('the service worker is installed and in charge of the page', ready && controlled, JSON.stringify({ ready, controlled }));

  const answers = await page.evaluate(async (expected) => {
    const get = (path) => fetch(path, { cache: 'no-store' });
    const sets = {};
    for (const name of Object.keys(expected)) {
      const body = await (await get(`/telegram-stickers/set?name=${name}`)).json().catch(() => ({}));
      sets[name] = { name: body?.pack?.name, title: body?.pack?.title, files: (body?.pack?.stickers || []).map((s) => s.file) };
    }
    /* Every file of both packs, four in flight at a time. */
    const ids = Object.values(expected).flatMap((pack) => pack.ids);
    const wrong = [];
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next];
        next += 1;
        const text = await (await get(`/telegram-stickers/file?id=${id}`)).text().catch(() => '');
        if (text !== `file:${id}`) wrong.push(`${id.slice(-4)}→${text.slice(-4) || '∅'}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    /* The relay's other GET answers, asked for twice. */
    for (const path of ['/relay-identity', '/relay-fronts', '/transit-peers', '/relay-identity?again=1']) await get(path).catch(() => null);
    const cached = [];
    for (const key of await caches.keys()) {
      for (const request of await (await caches.open(key)).keys()) cached.push(new URL(request.url).pathname);
    }
    return { sets, wrong, files: ids.length, cached };
  }, packs);
  check('two different packs are described as themselves',
    answers.sets.PackOne?.title === 'Pack One' && answers.sets.PackTwo?.title === 'Pack Two'
    && JSON.stringify(answers.sets.PackTwo.files) === JSON.stringify(packs.PackTwo.ids), JSON.stringify(answers.sets));
  check('every file of both packs arrives as itself, four at a time', answers.wrong.length === 0, `${answers.wrong.length} of ${answers.files} wrong: ${answers.wrong.slice(0, 8).join(', ')}`);
  const strays = answers.cached.filter((p) => p !== '/' && !/\.[a-z0-9]+$/i.test(p));
  check('nothing but the app\'s own files is in the worker\'s cache', strays.length === 0, strays.join(', '));
  check('which still holds the app\'s files', ['/index.html', '/js/app.js', '/css/styles.css'].every((p) => answers.cached.includes(p)), `${answers.cached.length} entries`);
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await browser.close();
  await stacks.stop();
  telegram.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
