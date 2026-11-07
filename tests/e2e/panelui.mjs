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
import { createRequire } from 'node:module';
import { chromium, webkit } from 'playwright';

const require = createRequire(import.meta.url);
import { startPanel, sleep, ROOT, PASSWORD, DEPLOY_CONF } from './_panel-run.mjs';

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const SECTIONS = ['overview', 'network', 'servers', 'clusters', 'family', 'admins', 'partners', 'account', 'ops', 'build', 'reports', 'queues', 'users', 'relays', 'traffic', 'keys', 'help', 'about'];

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
    check('the loading screen is gone once the panel has started', await page.evaluate(() => !document.getElementById('boot')));
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

    /* Installing on a server offers the certificate already there (3X-UI's
       /root/cert/<domain>/), renewed by this server, as on the others. */
    await page.click('#dialogClose').catch(() => {});
    await page.click('#sidebar [data-section="servers"]');
    await page.waitForSelector('[data-srv-install]', { timeout: 8000 });
    await page.click('[data-srv-install]');
    await page.waitForSelector('#installCert', { timeout: 5000 }).catch(() => {});
    const offered = await page.evaluate(() => ({ cert: document.getElementById('installCert')?.value, folder: Boolean(document.getElementById('installCertDir')), renew: document.getElementById('installRenew')?.value }));
    check('the install dialog uses the certificate already on the server, renewed here, unless told otherwise', offered.cert === 'found' && offered.folder && offered.renew === 'here', JSON.stringify(offered));
    const domainGiven = await page.evaluate(() => document.getElementById('installDomain')?.value || '');
    check('the domain starts as the one in the server’s public address', domainGiven === 'a.example', domainGiven);
    await page.fill('#installDomain', 'chat example.com');
    await page.fill('#installCode', panel.code());
    await page.click('#installRun');
    await page.waitForFunction(() => document.getElementById('installError')?.textContent.trim(), null, { timeout: 5000 }).catch(() => {});
    const said = await page.evaluate(() => document.getElementById('installError')?.textContent.trim() || '');
    check('a refused field is named in words, not as a code', said && !/bad-|options/.test(said), said);
    const words = await page.evaluate(() => document.getElementById('dialogBody')?.innerText || '');
    check('and names no program: any program may have got the certificate', !/3X-UI|acme\.sh|certbot|سرورهای دیگرتان|other servers/i.test(words), (words.match(/.*(3X-UI|acme\.sh|certbot|سرورهای دیگرتان|other servers).*/i) || [''])[0]);
    await page.selectOption('#installCert', 'new');
    const hidden = await page.evaluate(() => ({ folder: document.getElementById('installCertDir')?.closest('label')?.hidden, renew: document.getElementById('installRenew')?.closest('label')?.hidden }));
    check('a new certificate hides the folder and who renews one already there', hidden.folder === true && hidden.renew === true, JSON.stringify(hidden));
    await page.selectOption('#installCert', 'found');
    const shown = await page.evaluate(() => document.getElementById('installCertDir')?.closest('label')?.hidden);
    check('and the certificate already there brings them back', shown === false, String(shown));
    await page.waitForFunction(() => document.querySelectorAll('#installRegistryPick option').length >= 7, null, { timeout: 5000 }).catch(() => {});
    const mirrorPick = await page.evaluate(() => ({ count: document.querySelectorAll('#installRegistryPick option').length, datalist: Boolean(document.querySelector('#dialogBody datalist, #dialogBody [list]')), typedHidden: document.getElementById('installRegistry')?.hidden }));
    await page.selectOption('#installRegistryPick', { index: 1 });
    const chosenMirror = await page.evaluate(() => ({ value: document.getElementById('installRegistry')?.value, pick: document.getElementById('installRegistryPick')?.value }));
    await page.selectOption('#installRegistryPick', '__other');
    const typedShown = await page.evaluate(() => !document.getElementById('installRegistry')?.hidden && document.getElementById('installRegistry')?.value === '');
    const ignored = await page.evaluate(() => [...document.querySelectorAll('#dialogBody input:not([type="checkbox"]):not(.code)')].every((input) => ['off', 'new-password'].includes(input.getAttribute('autocomplete')) && input.hasAttribute('data-1p-ignore') && input.hasAttribute('data-lpignore')));
    check('the registry is a list of its own (no text box a password manager takes for a user name), a mirror picked fills it, and Another… opens a box to type one',
      mirrorPick.count >= 8 && !mirrorPick.datalist && mirrorPick.typedHidden === true && chosenMirror.value && chosenMirror.value === chosenMirror.pick && typedShown && ignored, JSON.stringify({ mirrorPick, chosenMirror, typedShown, ignored }));
    await page.click('#dialogClose').catch(() => {});

    /* Server updates, in Server operations: a folder, an archive or GitHub,
       the packages, and every server's update state. */
    await page.click('#sidebar [data-section="ops"]');
    await page.waitForSelector('[data-subtab="ops"][data-subtab-key="updates"]', { timeout: 8000 }).catch(() => {});
    await page.click('[data-subtab="ops"][data-subtab-key="updates"]');
    await page.waitForSelector('#updGithub', { timeout: 8000 }).catch(() => {});
    const updatesCard = await page.evaluate(() => ({
      folder: document.getElementById('updFolder')?.hasAttribute('webkitdirectory'), archive: Boolean(document.getElementById('updArchive')), github: Boolean(document.getElementById('updGithub')),
      build: document.getElementById('updBuild')?.disabled, rows: document.querySelectorAll('#sections table').length,
    }));
    check('Server operations offers server updates from a folder, an archive or GitHub', updatesCard.folder && updatesCard.archive && updatesCard.github && updatesCard.build === true, JSON.stringify(updatesCard));

    /* The Telegram bot's section, against a stand-in for the server's
       answers: every setting shown, the token never, a card previewed with
       Telegram's markup only, and the whole form sent back as one. */
    const { defaults } = require('../../scripts/lib/telegram-settings.js');
    const botSettings = { ...defaults({ CHAT_ALERT_TELEGRAM_CHAT_ID: '507' }), token: { set: true, hint: '123456:…abcd', source: 'panel' } };
    const posted = [];
    const previews = [];
    await page.route('**/api/servers', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      for (const server of json.servers || []) server.reachable = true;
      await route.fulfill({ response, json });
    });
    await page.route('**/api/call', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const reply = (answer) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 200, answer }) });
      if (body.path === '/Monitor_Server/telegram' && body.method === 'GET') {
        return reply({ ok: true, settings: botSettings, sends: true, via: 'telegram', waiting: 0, held: 0, active: [], label: 'relay-a',
          chats: [{ id: '-100777', type: 'supergroup', title: 'Ops <b>room</b>', username: '' }],
          choices: { categories: ['warn', 'critical', 'resolved', 'reminder', 'start', 'security', 'partner', 'update', 'test', 'peer', 'report'], alertKeys: ['disk', 'memory', 'relay-memory', 'files', 'turn-down', 'turn-ports', 'bandwidth', 'peer', 'peer-via'], commands: ['status', 'servers', 'alerts', 'updates', 'version', 'mute', 'unmute', 'help'], topics: ['alerts', 'reports', 'security', 'updates', 'other'], languages: ['fa', 'en'] } });
      }
      if (body.path === '/Monitor_Server/telegram' && body.method === 'POST') { posted.push(body.body); return reply({ ok: true, settings: botSettings }); }
      if (body.path === '/Monitor_Server/telegram/preview') {
        previews.push(body.body);
        const style = body.body?.settings?.templates?.style || 'classic';
        return reply({ ok: true, html: `\u200F<b>⚠️ هشدار · relay-a</b>\n<code>a.example</code> <img src=x onerror="window.__pwned=1"><a href="https://x">y</a>\n<blockquote expandable>\u200F${style}</blockquote>`, delivery: { send: true, silent: false } });
      }
      return route.continue();
    });
    await page.click('#refreshButton').catch(() => {});
    await sleep(800);
    await page.click('#sidebar [data-section="telegram"]');
    await page.waitForSelector('[data-tg-form]', { timeout: 8000 }).catch(() => {});
    const botForm = await page.evaluate(() => ({
      categories: document.querySelectorAll('[data-tg-cat-on]').length, keys: document.querySelectorAll('[data-tg-key]').length, thresholds: document.querySelectorAll('[data-tg-th]').length,
      commands: document.querySelectorAll('[data-tg-cmd]').length, topics: document.querySelectorAll('[data-tg-topic]').length, chat: document.getElementById('tgChatId')?.value,
      token: document.getElementById('tgToken')?.value, hint: document.getElementById('tgToken')?.placeholder, chips: document.querySelector('[data-tg-chat]')?.textContent || '',
      page: document.getElementById('sections')?.innerHTML.includes('<b>room</b>'),
    }));
    check('the Telegram section shows every setting the bot has', botForm.categories === 11 && botForm.keys === 9 && botForm.thresholds === 9 && botForm.commands === 8 && botForm.topics === 5 && botForm.chat === '507', JSON.stringify(botForm));
    check('the token only as its hint, never in a field', botForm.token === '' && botForm.hint.includes('…abcd'), botForm.hint);
    check('a chat that wrote to the bot is offered, its name as text', botForm.chips.includes('-100777') && !botForm.page, botForm.chips);
    await page.click('#tgPreview');
    await page.waitForSelector('.tg-preview', { timeout: 5000 }).catch(() => {});
    const preview = await page.evaluate(() => ({ bold: document.querySelector('.tg-preview b')?.textContent, code: document.querySelector('.tg-preview code')?.textContent, img: document.querySelectorAll('.tg-preview img, .tg-preview a').length, pwned: window.__pwned === 1 }));
    check('a preview shows Telegram’s bold and code, and nothing that could run', preview.bold === '⚠️ هشدار · relay-a' && preview.code === 'a.example' && preview.img === 0 && !preview.pwned, JSON.stringify(preview));
    const bubble = await page.evaluate(() => ({ dir: document.querySelector('.tg-bubble')?.getAttribute('dir'), quote: document.querySelectorAll('.tg-bubble blockquote.tgq.fold').length }));
    check('the preview reads right to left as the card says, its folding quote drawn as Telegram draws it', bubble.dir === 'rtl' && bubble.quote === 1, JSON.stringify(bubble));
    const designs = await page.evaluate(() => ({ styles: document.querySelectorAll('#tgStyle option').length, separators: document.querySelectorAll('#tgSeparator option').length, custom: document.getElementById('tgCustomRow')?.hidden }));
    check('the card designer offers six designs, five separators, and hides the custom template until it is chosen', designs.styles === 6 && designs.separators === 5 && designs.custom === true, JSON.stringify(designs));
    await page.selectOption('#tgStyle', 'custom');
    check('choosing your own design shows its template box', await page.evaluate(() => document.getElementById('tgCustomRow')?.hidden === false));
    await page.fill('#tgCustom', '**{kind}** {server}\n> {title}');
    await page.click('#tgGallery');
    await page.waitForSelector('.tg-gallery-item', { timeout: 8000 }).catch(() => {});
    const gallery = await page.evaluate(() => ({ items: document.querySelectorAll('.tg-gallery-item').length, rtl: [...document.querySelectorAll('.tg-gallery .tg-bubble')].every((node) => node.getAttribute('dir') === 'rtl') }));
    check('every design is previewed side by side, each drawn by the relay with the form’s own settings', gallery.items === 6 && gallery.rtl && previews.slice(-6).map((entry) => entry.settings?.templates?.style).join() === 'classic,boxed,compact,minimal,detailed,custom' && previews.slice(-1)[0].settings.templates.custom.includes('{kind}'), JSON.stringify(gallery));
    await page.click('[data-tg-use-style="boxed"]');
    await page.click('[data-tg-chat="-100777"]');
    await page.uncheck('[data-tg-key="bandwidth"]');
    await page.fill('[data-tg-th="diskFreePct"]', '20');
    await page.selectOption('#tgLanguageField', 'en');
    await page.check('#tgQuietOn');
    await page.fill('#tgFooter', 'P00RIJA · {server}');
    await page.fill('[data-tg-topic="alerts"]', '12');
    await page.click('#tgSave');
    await sleep(600);
    const sentBack = posted[posted.length - 1] || {};
    check('saving sends the whole form, as the relay takes it, and no token unless one was typed', sentBack.settings?.chatId === '-100777' && sentBack.settings.alertKeys.bandwidth === false && sentBack.settings.thresholds.diskFreePct === 20
      && sentBack.settings.language === 'en' && sentBack.settings.quiet.on === true && sentBack.settings.templates.footer === 'P00RIJA · {server}' && sentBack.settings.topics.alerts === '12' && !('token' in sentBack), JSON.stringify(sentBack).slice(0, 300));
    check('and the card’s design with it', sentBack.settings?.templates?.style === 'boxed' && sentBack.settings.templates.custom.includes('{kind}') && sentBack.settings.templates.separator === 'heavy', JSON.stringify(sentBack.settings?.templates || {}));
    botSettings.enabled = false;
    await page.click('#refreshButton');
    await sleep(900);
    const banner = await page.evaluate(() => document.querySelector('.bad-banner')?.textContent || '');
    check('with the token holder’s bot off, the section says so in plain words', banner.includes('a'), banner.slice(0, 120));
    botSettings.enabled = true;
    await page.setViewportSize({ width: 390, height: 860 });
    await sleep(300);
    const botOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('the Telegram section has no sideways scrolling at 390px', botOverflow <= 1, `${botOverflow}px`);
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.unroute('**/api/call');
    await page.unroute('**/api/servers');

    /* Every section's every sub-tab and every grouping, against stand-in
       answers from a reachable server: drawn without an error, the live
       graphs with values under the pointer, a search that hides rows, a
       message sent to one cluster only, and an export made in the page. */
    const fp = (char) => char.repeat(32);
    const iso = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
    const fake = {
      '/healthz': { ok: true, peers: 2, activeCalls: 1, cpuLoad: 31, hostname: 'host-a', uptime: 7200, relayId: fp('e'), cpus: 2, cpuModel: 'cpu', containerMem: { usageMb: 210, limitMb: 512 }, storage: { total: 1000, free: 400 },
        peersList: [{ clientId: 'c1', username: 'mina', ip: '10.0.0.1', connectedAt: iso(30), lastSeenAt: iso(1), fingerprint: fp('a'), crossRelayMinutes: 3 }, { clientId: 'c2', username: 'reza', ip: '10.0.0.2', connectedAt: iso(20), lastSeenAt: iso(2), fingerprint: fp('b'), crossRelayMinutes: null }],
        suspendedUsers: [{ fingerprint: fp('c') }], kickedUsers: [] },
      '/admin/allowlist': { ok: true, allowlistEnabled: false, allowedUsers: [{ fingerprint: fp('d'), label: 'ops' }] },
      '/Monitor_Server/queues': { ok: true, totals: { queued: 5, bytes: 9000 }, heldForConnected: 1, transitWaiting: 0, mailboxes: [{ fingerprint: fp('a'), count: 3, bytes: 4000, oldestAt: iso(90), newestAt: iso(5) }, { fingerprint: fp('b'), count: 2, bytes: 9000000, oldestAt: iso(3000), newestAt: iso(10) }] },
      '/Monitor_Server/expiry-log': { ok: true, entries: [[iso(10), 'expired', fp('a'), 2048], [iso(20), 'full', fp('b'), 1024]] },
      '/Monitor_Server/transit': { ok: true, status: { up: 1, allowed: 2 }, peers: [{ id: fp('f').slice(0, 16), fullId: fp('f'), origin: 'https://b.example:8585', linked: true, kind: 'family', traffic: { carried: 12, bytes: 3000 } }, { id: fp('9').slice(0, 16), fullId: fp('9'), origin: '', linked: false, kind: 'manual', traffic: { carried: 0, bytes: 0 } }],
        directory: { serial: 4, operator: { name: 'fam' }, relays: [{ id: fp('e'), name: 'a', region: 'outside-iran', cluster: 'west', gateway: 1, inside: [], self: true }, { id: fp('f'), name: 'b', region: 'inside-iran', cluster: 'east', gateway: 0, inside: ['https://10.1.1.1:8585'], linked: true }] } },
      '/Monitor_Server/partners': { ok: true, self: { name: 'fam', gateway: true, carryBetween: false, gateways: [{ id: fp('e').slice(0, 16), name: 'a', priority: 1 }] }, partners: [{ operatorId: fp('7'), name: 'Other', state: 'incoming', gateways: [{ id: fp('6').slice(0, 16), name: 'x', priority: 1, linked: true }], path: 'direct' }] },
      '/Monitor_Server/traffic': { ok: true, totals: { msgsIn: 100, msgsOut: 90, bytesIn: 50000, bytesOut: 40000, relays: 7 }, clients: [{ clientId: 'c1', label: 'mina', msgsIn: 10, msgsOut: 9, bytesIn: 900, bytesOut: 800, lastAt: iso(1) }], relays: [{ relayId: fp('f').slice(0, 16), carried: 12, bytes: 3000, lastAt: iso(2) }] },
      '/Monitor_Server/reports': { ok: true, activeCalls: [{ username: 'mina', peer: 'reza', group: false, since: iso(3) }], transitActive: [], hourly: [{ msgsIn: 10 }, { msgsIn: 25 }], events: [{ at: iso(5), kind: 'link', text: 'b linked' }, { at: iso(50), kind: 'start', text: 'started' }] },
      '/Monitor_Server/ops-backup-list': { ok: true, backups: [{ name: 'backup-1.tar.gz', size: '12M' }] },
      '/Monitor_Server/ops-memory': { ok: true, host: { totalMb: 2048 }, containers: [{ name: 'Poorija-Cryptography_ChatSignal', usageMb: 210, limitMb: 512, cpuPct: 4 }, { name: 'Poorija-Cryptography_Web', usageMb: 40, limitMb: 0, cpuPct: 1 }] },
      '/Monitor_Server/ops-disk': { ok: true, disk: { total: 1000, free: 400 }, cleanup: { staleSelfImages: [{ ref: 'poorija-crypto:2.98.80', size: 1000 }], danglingImages: [] } },
      '/Monitor_Server/ops-images': { ok: true, images: [{ repository: 'poorija-chat-signal', tag: '2.98.88', id: 'sha256:abc', size: 100000, created: iso(100) }, { repository: 'node', tag: '26', id: 'sha256:def', size: 200000, created: iso(1000) }] },
      '/Monitor_Server/ops-github-check': { ok: true, running: { version: '2.98.88' }, latest: { tag: 'v2.98.88' }, updateAvailable: false },
    };
    const sentTo = [];
    await page.route('**/api/servers', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      for (const server of json.servers || []) { server.reachable = true; server.peers = 2; server.cluster = server.name === 'a' ? 'west' : 'east'; server.region = server.name === 'a' ? 'outside-iran' : 'inside-iran'; server.passwordOk = true; }
      await route.fulfill({ response, json });
    });
    const calls = [];
    const metricUrls = [];
    await page.route('**/api/call', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      calls.push(body.path);
      if (body.path === '/Monitor_Server/announce') sentTo.push(body.server);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 200, answer: fake[body.path] || { ok: true } }) });
    });
    await page.route('**/api/metrics**', (route) => {
      metricUrls.push(route.request().url());
      const now = Date.now();
      const points = (offset) => Array.from({ length: 30 }, (_value, index) => ({ t: now - (30 - index) * 20000, up: 1, cpu: 20 + offset + (index % 5), memMb: 200 + index, memLimitMb: 512, memPct: 40, diskPct: 60, peers: 2 + (index % 3), calls: index % 2, linksUp: 1, linksAllowed: 2, queued: 5, queuedBytes: 9000, msgsInRate: 4 + index % 4, msgsOutRate: 3, bytesInRate: 1200, bytesOutRate: 900, relayedRate: 1 }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, range: '1h', step: 20000, from: now - 3600000, to: now, servers: [{ name: 'a', points: points(0) }, { name: 'b', points: points(10) }] }) });
    });
    await page.click('#refreshButton').catch(() => {});
    await sleep(800);
    const tour = [];
    for (const id of ['overview', 'network', 'servers', 'clusters', 'admins', 'partners', 'queues', 'users', 'relays', 'traffic', 'reports', 'ops', 'build', 'telegram', 'help', 'about']) {
      const before = errors.length;
      await page.click(`#sidebar [data-section="${id}"]`);
      await sleep(400);
      const tabs = await page.$$eval('[data-subtab]', (nodes) => nodes.map((node) => node.getAttribute('data-subtab-key')));
      for (const key of tabs.length ? tabs : ['']) {
        if (key) { await page.click(`[data-subtab][data-subtab-key="${key}"]`); await sleep(350); }
        const pickers = await page.$$eval('#sections select[data-view]', (nodes) => nodes.map((node) => ({ key: node.getAttribute('data-view'), values: [...node.options].map((option) => option.value) })));
        for (const picker of pickers) {
          for (const value of picker.values) {
            const select = await page.$(`#sections select[data-view="${picker.key}"]`);
            if (!select) break;
            await select.selectOption(value);
            await sleep(150);
          }
        }
        const shown = await page.evaluate(() => document.getElementById('sections')?.textContent.trim().length || 0);
        if (errors.length > before || !shown) tour.push(`${id}/${key}: ${errors.slice(before).join(' | ') || 'empty'}`);
      }
    }
    check('every sub-tab and every grouping of every section draws, with data', tour.length === 0, tour.join('; ').slice(0, 400));

    await page.click('#sidebar [data-section="overview"]');
    await page.selectOption('select[data-view="overview:focus"]', '');
    await sleep(300);
    await page.selectOption('select[data-view="overview:cat"]', 'all');
    await sleep(300);
    const charts = await page.$$eval('#liveCharts svg[data-chart]', (nodes) => nodes.length);
    const box = await page.$('#liveCharts svg[data-chart]').then((node) => node?.boundingBox());
    if (box) await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await sleep(200);
    const tip = await page.evaluate(() => ({ shown: !document.getElementById('chartTip')?.hidden, text: document.getElementById('chartTip')?.textContent || '' }));
    check('the overview draws live graphs for every category, and reads them out under the pointer', charts >= 13 && tip.shown && /a|b/.test(tip.text), `${charts} charts · ${tip.text.slice(0, 80)}`);
    const styled = await page.evaluate(() => document.querySelectorAll('#sections [style]').length);
    check('no style attribute anywhere in the sections (the page policy forbids them)', styled === 0, String(styled));

    await page.click('#sidebar [data-section="users"]');
    await page.click('[data-subtab="users"][data-subtab-key="online"]');
    await sleep(300);
    await page.fill('[data-search="users"]', 'mina');
    await sleep(150);
    const searched = await page.$$eval('[data-searchable="users"] tbody tr', (rows) => rows.filter((row) => !row.hidden).map((row) => row.dataset.label));
    check('a search hides the rows that do not match (mina is on both stand-in servers, reza on neither row shown)', searched.length === 2 && searched.every((label) => label === 'mina'), searched.join());
    await page.fill('[data-search="users"]', '');
    await page.click('[data-subtab="users"][data-subtab-key="messages"]');
    await sleep(300);
    await page.check('[data-field="scope"][value="cluster"]');
    await page.selectOption('[data-form="announce"] [data-field="cluster"]', 'west');
    await page.fill('[data-form="announce"] [data-field="message"]', 'hello west');
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('[data-form-run="announce"]');
    await sleep(800);
    check('a message to one cluster goes to that cluster’s servers only', sentTo.length === 1 && sentTo[0] === 'a', sentTo.join());

    /* The live graphs at the rate chosen, one server on its own, every server
       table grouped, and a read taken again rather than asked for again. */
    await page.click('#sidebar [data-section="overview"]');
    await sleep(300);
    const refreshOptions = await page.$$eval('select[data-view="overview:refresh"] option', (nodes) => nodes.map((node) => node.value).join());
    metricUrls.length = 0;
    await page.selectOption('select[data-view="overview:refresh"]', '1');
    await sleep(2600);
    check('the live graphs refresh every 1, 3, 5, 10, 30 or 60 seconds, and the panel reads the servers at that pace', refreshOptions === '1,3,5,10,30,60' && metricUrls.filter((url) => url.includes('pace=1000')).length >= 2, `${refreshOptions} · ${metricUrls.slice(-2).join(' ')}`);
    await page.selectOption('select[data-view="overview:refresh"]', '5');
    await page.selectOption('select[data-view="overview:focus"]', 'a');
    await sleep(400);
    const focused = await page.evaluate(() => ({ charts: document.querySelectorAll('#liveCharts svg[data-chart]').length, kpis: document.querySelectorAll('#liveCharts .kpi').length, cards: document.querySelectorAll('[data-server-card]').length }));
    check('one server can be watched on its own, every graph of it with its numbers and its card', focused.charts >= 13 && focused.kpis >= 9 && focused.cards === 1, JSON.stringify(focused));
    await page.selectOption('select[data-view="overview:focus"]', '');
    await page.click('#sidebar [data-section="ops"]');
    await page.click('[data-subtab="ops"][data-subtab-key="servers"]');
    await sleep(400);
    await page.selectOption('select[data-view="tables:group"]', 'cluster');
    await sleep(300);
    const groupedRows = await page.$$eval('#sections tr.group', (rows) => rows.map((row) => row.textContent.trim().split(/\s+/)[0]));
    check('every server table can be grouped by cluster (or region, or not at all)', groupedRows.includes('west') && groupedRows.includes('east'), groupedRows.join());
    await page.selectOption('select[data-view="tables:group"]', 'none');
    calls.length = 0;
    await page.click('#sidebar [data-section="users"]');
    await sleep(500);
    await page.click('#sidebar [data-section="relays"]');
    await sleep(500);
    await page.click('#sidebar [data-section="users"]');
    await sleep(500);
    const healthReads = calls.filter((path) => path === '/healthz').length;
    const transitReads = calls.filter((path) => path === '/Monitor_Server/transit').length;
    check('switching between sections reads each route once in a few seconds, shared between them', healthReads <= 2 && transitReads <= 2, `healthz ${healthReads}, transit ${transitReads}`);

    /* The install dialog asks whether the SSH user has sudo, and tests it. */
    await page.route('**/api/servers/access', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, access: 'sudo-password', user: 'opsuser', dockerGroup: false }) }));
    await page.click('#sidebar [data-section="servers"]');
    await page.waitForSelector('[data-srv-install]', { timeout: 8000 });
    await page.click('[data-srv-install]');
    await page.waitForSelector('#installSudo', { timeout: 5000 }).catch(() => {});
    await page.fill('#installSudoPass', 'p$`x\'"!y');
    await page.fill('#installCode', '123456');
    const accessSent = page.waitForRequest('**/api/servers/access');
    await page.click('#installAccessTest');
    const accessBody = JSON.parse((await accessSent).postData() || '{}');
    await sleep(300);
    const accessShown = await page.evaluate(() => ({ text: document.getElementById('installAccess')?.textContent || '', sudo: document.getElementById('installSudo')?.checked }));
    check('the install dialog tests the SSH user’s sudo with a code, the password passed as typed, and ticks “has sudo” when it works', accessBody.sudoPassword === 'p$`x\'"!y' && accessBody.code === '123456' && accessShown.text.includes('opsuser') && accessShown.sudo === true, JSON.stringify(accessShown));
    await page.click('#dialogClose').catch(() => {});
    await page.unroute('**/api/servers/access');

    /* The connection lost, said at once, and gone when it is back. */
    await page.route('**/api/chips', (route) => route.abort());
    const offlineShown = await page.waitForFunction(() => document.getElementById('offline') && !document.getElementById('offline').hidden, null, { timeout: 9000 }).then(() => true, () => false);
    await page.unroute('**/api/chips');
    const offlineGone = await page.waitForFunction(() => document.getElementById('offline')?.hidden, null, { timeout: 9000 }).then(() => true, () => false);
    check('when the panel stops answering a banner says so, with a reload button, and goes when it answers again', offlineShown && offlineGone && await page.evaluate(() => Boolean(document.querySelector('#offline a[href="/"]'))));

    await page.click('#sidebar [data-section="reports"]');
    await page.click('[data-subtab="reports"][data-subtab-key="export"]');
    await sleep(300);
    await page.selectOption('[data-export-format]', 'xls');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('[data-export-run]')]);
    const saved = download ? fs.readFileSync(await download.path(), 'utf8') : '';
    check('an export makes an Excel workbook in the page, a sheet per table, with the servers’ rows', /<Worksheet ss:Name="servers">/.test(saved) && /<Worksheet ss:Name="users">/.test(saved) && saved.includes('mina'), download?.suggestedFilename() || 'no download');

    /* Settings sent to another admin: sealed with their box key and a
       complex password, signed by the sender; opened only by that box, with
       that password, from a listed admin, and never once changed. */
    const shared = await page.evaluate(async () => {
      const share = await import('/share.js');
      const sign = await import('/sign.js');
      const signer = await sign.makeDeviceKey('sender-admin');
      const other = await sign.makeDeviceKey('not-an-admin');
      const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      const line = await share.boxLine(pair.publicKey);
      const box = { privateKey: pair.privateKey, fingerprint: line.fingerprint };
      const wrongPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      const wrongBox = { privateKey: wrongPair.privateKey, fingerprint: (await share.boxLine(wrongPair.publicKey)).fingerprint };
      const password = share.makePassword(24);
      const bundle = { v: 1, parts: { mirrors: ['mirror.example.com'], partnerNotes: { abcdef0123456789: { label: 'friend' } } } };
      const envelope = await share.sealShare({ bundle, recipientLine: line.line, password, signer });
      const admins = [{ id: signer.keyId, name: 'sender-admin' }];
      const attempt = async (input) => { try { return { ok: true, value: await share.openShare(input) }; } catch (error) { return { ok: false, reason: error.message }; } };
      const opened = await attempt({ envelope, password, box, admins });
      const tampered = { ...envelope, ct: envelope.ct.slice(0, -8) + (envelope.ct.slice(-8, -7) === 'A' ? 'B' : 'A') + envelope.ct.slice(-7) };
      const forged = await share.sealShare({ bundle, recipientLine: line.line, password, signer: other });
      return {
        roundTrip: opened.ok && JSON.stringify(opened.value.bundle) === JSON.stringify(bundle) && opened.value.sender.name === 'sender-admin',
        plaintextHidden: !JSON.stringify(envelope).includes('mirror.example.com') && !JSON.stringify(envelope).includes(password),
        wrongPassword: (await attempt({ envelope, password: `${password}x`, box, admins })).reason,
        tampered: (await attempt({ envelope: tampered, password, box, admins })).reason,
        notForYou: (await attempt({ envelope, password, box: wrongBox, admins })).reason,
        notAdmin: (await attempt({ envelope: forged, password, box, admins })).reason,
        weak: share.passwordProblems('password123').length > 0, strong: share.passwordProblems(password).length === 0,
      };
    });
    check('a share opens in its recipient’s browser with its password, as it was sent, and holds nothing readable', shared.roundTrip && shared.plaintextHidden, JSON.stringify(shared));
    check('and is refused with a wrong password, when changed, in another browser, or from someone who is not an admin',
      shared.wrongPassword === 'shareBadPassword' && shared.tampered === 'shareBadSignature' && shared.notForYou === 'shareNotForYou' && shared.notAdmin === 'shareNotAdmin' && shared.weak && shared.strong, JSON.stringify(shared));
    const imported = await page.evaluate(async (code) => (await fetch('/api/import', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, from: 'sender-admin', parts: { servers: [{ name: 'imp', fields: { SSH_HOST: 'imp.example', SSH_USER: 'root', SSH_KEY: 'id_test' } }], mirrors: ['mirror.example.com', 'bad mirror;rm'], partnerNotes: { abcdef0123456789: { label: 'friend <b>' } } } }) })).json(), panel.code());
    const conf = fs.readFileSync(path.join(panel.dirs.config, 'deploy.conf'), 'utf8');
    check('applying a share takes a code, checks every part again, and writes the servers, mirrors and notes', imported.ok && imported.applied?.servers === 1 && imported.applied?.mirrors === 1 && /IMP_SSH_HOST='?imp\.example/.test(conf) && /IMP_SSH_KEY='?~\/\.ssh\/id_test/.test(conf), JSON.stringify(imported));
    const importAs = (parts, replace) => page.evaluate(async ([code, parts_, replace_]) => (await fetch('/api/import', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, parts: parts_, replace: replace_ }) })).json(), [panel.code(), parts, replace]);
    const silent = await importAs({ servers: [{ name: 'a', fields: { SSH_HOST: 'evil.example', SSH_USER: 'root', SSH_KEY: 'stolen' } }] }, []);
    const noUser = await importAs({ servers: [{ name: 'zz', fields: { SSH_HOST: 'zz.example' } }] }, []);
    const ticked = await importAs({ servers: [{ name: 'a', fields: { SSH_HOST: 'a2.example', SSH_USER: 'root', SSH_KEY: 'other' } }] }, ['a']);
    const after = fs.readFileSync(path.join(panel.dirs.config, 'deploy.conf'), 'utf8');
    check('a server already here is never replaced unless ticked, an entry without an SSH user is refused, and a replaced one keeps this panel’s SSH key',
      silent.ok === false && /already here/.test(silent.detail || '') && noUser.ok === false && ticked.ok === true && /A_SSH_HOST='?a2\.example/.test(after) && !/A_SSH_KEY='?~\/\.ssh\/other/.test(after), JSON.stringify({ silent, noUser, ticked }));
    const noCode = await page.evaluate(async () => (await fetch('/api/import', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '000000', parts: { mirrors: ['x.example.com'] } }) })).json());
    check('and nothing without a right code', noCode.ok === false, JSON.stringify(noCode));

    await page.unroute('**/api/call');
    await page.unroute('**/api/servers');
    await page.unroute('**/api/metrics**');

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
