/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The two codes nothing else covers: two-factor enrolment and the donation
   wallet. Both go through the kit's render(), which was rewritten, and neither
   has a suite of its own — exactly the shape of thing a rewrite breaks quietly. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', e => console.log('  pageerror:', e.message.slice(0, 120)));
await page.goto((process.env.PKG_URL || 'https://localhost:8585') + '/index.html', { waitUntil: 'load' });
await settle(page, () => typeof window.PoorijaQR?.render === 'function');
const out = await page.evaluate(async () => {
  const kit = window.PoorijaQR;
  const results = {};
  for (const [name, text, opts] of [
    ['twoFactor', 'otpauth://totp/P00RIJ%C3%83:User?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=P00RIJ%C3%83',
      { preset: 'classic', level: 'M', px: 280, quiet: 4 }],
    ['wallet', 'ton://transfer/UQCEgGxRZ5A101w6RBNLwHhnva5EdK3kyDsFQcxni35DlCJf',
      { preset: 'classic', px: 220, quiet: 4 }],
  ]) {
    const box = document.createElement('div');
    box.style.cssText = 'width:320px';
    document.body.appendChild(box);
    const info = kit.render(box, text, opts);
    const read = info && await kit.decode(info.canvas, info.canvas.width, info.canvas.height);
    results[name] = {
      drawn: Boolean(info), modules: info?.modules,
      oneElement: box.querySelectorAll('canvas').length === 1 && box.querySelectorAll('img').length === 0,
      exact: read === text,
      crisp: info ? Math.abs(info.cssWidth * info.dpr - info.canvas.width) <= 1 : false,
    };
    box.remove();
  }
  return results;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
for (const [name, r] of Object.entries(out)) {
  check(`${name}: the code is drawn`, r.drawn, `${r.modules} modules`);
  check(`${name}: one element, not the encoder's two`, r.oneElement);
  check(`${name}: it reads back as exactly what it was given`, r.exact);
  check(`${name}: and one bitmap pixel per screen pixel`, r.crisp);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('failed:');
  failed.forEach((r) => console.log(`  - ${r.name}`));
  process.exit(1);
}
