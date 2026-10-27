/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The central panel's page, in Chromium and WebKit: the branded login with
 * the version, Vazirmatn for Persian and Inter for English, the server chips
 * that follow deploy.conf without a reload, every section of the sidebar in
 * both languages without an error, the theme switch, the authenticator's QR
 * in the account, the server form refusing a bad name, and no sideways
 * scrolling on a phone or a desktop.
 *
 *   node tests/e2e/panelui.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { startPanel, sleep, ROOT, PASSWORD, DEPLOY_CONF } from './_panel-run.mjs';

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const SECTIONS = ['overview', 'network', 'servers', 'clusters', 'family', 'account', 'system', 'log', 'queues', 'users', 'keys'];

for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  console.log(`\n== ${engineName}`);
  const panel = await startPanel();
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));
    await page.goto(`http://127.0.0.1:${panel.port}/`);
    await page.waitForFunction(() => document.fonts.status === 'loaded' && document.getElementById('appVersion')?.textContent.trim(), null, { timeout: 15000 }).catch(() => {});
    const login = await page.evaluate(() => ({
      logo: document.getElementById('loginLogo')?.naturalWidth || 0,
      name: document.getElementById('loginName')?.textContent || '',
      version: document.getElementById('appVersion')?.textContent.trim() || '',
      font: getComputedStyle(document.body).fontFamily,
      vazir: document.fonts.check('16px Vazirmatn'),
    }));
    check('the login shows the logo and the name', login.logo > 0 && /P00RIJ/.test(login.name), JSON.stringify(login));
    check('and the version at the foot', login.version.replace(/^v/, '') === VERSION, login.version);
    check('Persian is set in Vazirmatn', /^"?Vazirmatn/.test(login.font) && login.vazir, login.font);
    await page.click('#loginView [data-lang-toggle]');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.evaluate(() => document.fonts.ready);
    const english = await page.evaluate(() => ({ font: getComputedStyle(document.body).fontFamily, inter: document.fonts.check('16px Inter') }));
    check('English is set in Inter', /^"?Inter/.test(english.font) && english.inter, english.font);
    await page.click('#loginView [data-lang-toggle]');

    await page.fill('#loginUser', 'op');
    await page.fill('#loginPassword', PASSWORD);
    await page.fill('#loginCode', panel.code());
    await page.click('#loginButton');
    await page.waitForSelector('#appView:not([hidden])', { timeout: 10000 });
    const chips = await page.$$eval('#serverChips [data-chip]', (nodes) => nodes.map((node) => node.getAttribute('data-chip')));
    check('a chip for every server, at the top', chips.join() === 'a', chips.join());
    fs.writeFileSync(path.join(panel.dirs.config, 'deploy.conf'), `${DEPLOY_CONF}B_SSH_HOST='b.example'\n`.replace("SERVERS='a'", "SERVERS='a b'"));
    const appeared = await page.waitForSelector('#serverChips [data-chip="b"]', { timeout: 9000 }).then(() => true, () => false);
    check('a server added to deploy.conf gets its chip without a reload', appeared);

    for (const lang of ['fa', 'en']) {
      if (lang === 'en') await page.click('#appView [data-lang-toggle]');
      const broken = [];
      for (const id of SECTIONS) {
        const before = errors.length;
        const button = await page.$(`#sidebar [data-section="${id}"]`);
        if (!button) { broken.push(`${id}: no button`); continue; }
        await button.click();
        await page.waitForFunction(() => !document.querySelector('#sections')?.textContent.includes('…loading'), null, { timeout: 8000 }).catch(() => {});
        await sleep(250);
        const shown = await page.evaluate(() => document.getElementById('sections')?.textContent.trim().length || 0);
        if (errors.length > before || !shown) broken.push(`${id}: ${errors.slice(before).join(' | ') || 'empty'}`);
      }
      check(`every section opens, in ${lang}`, broken.length === 0, broken.join('; ').slice(0, 300));
    }
    await page.click('#appView [data-lang-toggle]');

    const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.click('#themeToggle');
    const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
    check('the theme switches between dark and light', themeBefore && themeAfter && themeBefore !== themeAfter, `${themeBefore} → ${themeAfter}`);

    await page.click('#sidebar [data-section="account"]');
    await page.waitForSelector('#totpPassword', { timeout: 8000 });
    await page.fill('#totpPassword', PASSWORD);
    await page.fill('#totpCode', panel.code());
    await page.click('#totpBegin');
    const qr = await page.waitForSelector('#totpQr svg', { timeout: 8000 }).then(() => true, () => false);
    check('a new authenticator shows its QR code in the page', qr, qr ? '' : await page.evaluate(() => document.getElementById('results')?.textContent.slice(0, 200)));

    await page.click('#sidebar [data-section="servers"]');
    await page.waitForSelector('#addServer', { timeout: 8000 });
    await page.click('#addServer');
    await page.fill('#serverName', 'Bad-Name');
    await page.fill('#serverHost', 'c.example');
    await page.click('#saveServer');
    const formError = await page.evaluate(() => document.getElementById('serverFormError')?.textContent.trim() || '');
    check('the server form refuses a bad name before sending anything', Boolean(formError) && !/^C_/m.test(fs.readFileSync(path.join(panel.dirs.config, 'deploy.conf'), 'utf8')), formError);

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 860 });
      await page.click('#sidebar [data-section="overview"]').catch(() => {});
      await sleep(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`no sideways scrolling at ${width}px`, overflow <= 1, `${overflow}px`);
    }
    check('no page error along the way', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (error) {
    check('the suite ran to the end', false, error?.stack?.split('\n').slice(0, 4).join(' ') || String(error));
  } finally {
    await browser.close();
    await panel.cleanup();
  }
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
