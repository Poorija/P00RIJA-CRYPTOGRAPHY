/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The update checker's two decisions, neither of which is visible until it is
 * wrong in front of a person: which release counts as newer, and which file
 * this machine should be handed.
 *
 * Version comparison is here because the obvious implementation -- comparing
 * the strings -- reports 2.9.0 as newer than 2.35.0 and walks people into a
 * downgrade. Asset selection is here because a release that ships six
 * artefacts has six chances to hand somebody a file their computer cannot
 * open, and an iPhone must be sent to the page rather than to an APK.
 *
 * No network: the GitHub call itself is one fetch with a catch around it, and
 * a test that depends on a rate-limited third party fails for reasons that
 * have nothing to do with this code.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULE = join(ROOT, 'js', 'update-check.js');

let failures = 0;
let checks = 0;

function ok(condition, label) {
  checks += 1;
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
  }
}

/* Node 22 and later ship their own read-only `navigator`, so assigning to it
   silently does nothing and every platform reads as "unknown" -- which looks
   like a broken checker rather than a broken test. Define over it instead. */
let userAgent = '';
Object.defineProperty(globalThis, 'navigator', {
  get: () => ({ userAgent }),
  configurable: true,
});

function load(ua) {
  userAgent = ua;
  delete require.cache[require.resolve(MODULE)];
  globalThis.window = { PoorijaApp: { state: { language: 'en' } } };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  require(MODULE);
  return globalThis.window.PoorijaUpdate;
}

console.log('\nUpdate checker');

// ---- which release counts as newer -------------------------------------
{
  const u = load('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
  ok(u.isNewer('2.35.0', '2.26.95'), 'a newer minor beats a bigger patch number');
  ok(!u.isNewer('2.9.0', '2.35.0'), '2.9.0 is NOT newer than 2.35.0');
  ok(!u.isNewer('2.35.0', '2.35.0'), 'the same version is not an update');
  ok(u.isNewer('v2.36.0', '2.35.0'), 'a leading v is tolerated');
  ok(u.isNewer('2.35.1', '2.35.0'), 'a patch bump counts');
  ok(!u.isNewer('2.34.9', '2.35.0'), 'an older minor never counts');
  ok(!u.isNewer('', '2.35.0'), 'an empty tag is not an update');
}

// ---- which file this machine is handed ----------------------------------
{
  const assets = [
    'P00RIJA-Cryptography-2.35.0-universal.apk',
    'P00RIJA Cryptography_2.35.0_universal.dmg',
    'P00RIJA Cryptography_2.35.0_x64-setup.exe',
    'P00RIJA Cryptography_2.35.0_arm64-setup.exe',
    'Cryptography_2.35.0_amd64.deb',
    'Cryptography_2.35.0_arm64.deb',
  ].map((name) => ({ name, browser_download_url: `https://example.invalid/${name}` }));

  const expect = [
    ['Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36', 'android', /\.apk$/, 'Android is handed the APK'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macos', /universal\.dmg$/, 'macOS is handed the universal disk image'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows', /x64-setup\.exe$/, 'Windows on Intel gets the x64 installer'],
    ['Mozilla/5.0 (Windows NT 10.0; ARM64; aarch64)', 'windows', /arm64-setup\.exe$/, 'Windows on ARM gets the arm64 installer'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'linux', /amd64\.deb$/, 'Linux on Intel gets the amd64 package'],
    ['Mozilla/5.0 (X11; Linux aarch64)', 'linux', /arm64\.deb$/, 'Linux on ARM gets the arm64 package'],
  ];
  for (const [ua, platform, pattern, label] of expect) {
    const u = load(ua);
    ok(u.platform() === platform, `${label} — platform reads as ${platform}`);
    const picked = u.pickAsset(assets);
    ok(picked && pattern.test(picked.name), label);
  }

  const ios = load('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
  ok(ios.platform() === 'ios', 'an iPhone is recognised');
  ok(ios.pickAsset(assets) === null, 'an iPhone is sent to the page, never to a file it cannot install');

  const empty = load('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
  ok(empty.pickAsset([]) === undefined || empty.pickAsset([]) === null,
    'a release with no artefacts hands back nothing rather than a broken link');
}

// ---- the browser build stays out of it ----------------------------------
{
  const u = load('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
  ok(u.eligible() === false, 'the browser build is not eligible: the service worker already updates it');
  globalThis.window.__POORIJA_DESKTOP__ = true;
  ok(u.eligible() === true, 'a native shell is eligible');
}

console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}\n`);
process.exit(failures ? 1 : 0);
