/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Which file of a GitHub release a native build offers when a newer version
 * is out (js/update-check.js): exactly the kind that is installed — the
 * Apple Silicon build for an Apple Silicon install, not the universal one;
 * the universal one for a universal install; the Windows installer for the
 * machine's own architecture; on Linux the .deb, .rpm, AppImage, pacman
 * package or tarball by how it was installed. The shell says what it is
 * (desktop_platform_info: os, arch, bundle, universal); the webview's user
 * agent, which calls an Apple Silicon Mac Intel, is only the last resort.
 *
 *   node tests/e2e/updatepick.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/* The files of the 2.98.85 release, as GitHub lists them. */
const NAMES = [
  'p00rija-cryptography-2.98.85-aarch64.pkg.tar.zst', 'p00rija-cryptography-2.98.85-linux-aarch64.tar.gz', 'p00rija-cryptography-2.98.85-linux-x86_64.tar.gz',
  'p00rija-cryptography-2.98.85-source.tar.gz', 'P00RIJA-Cryptography-2.98.85-universal.apk', 'p00rija-cryptography-2.98.85-x86_64.pkg.tar.zst',
  'P00RIJA.Cryptography-2.98.85.aarch64.rpm', 'P00RIJA.Cryptography-2.98.85.x86_64.rpm', 'P00RIJA.Cryptography_2.98.85_aarch64.AppImage',
  'P00RIJA.Cryptography_2.98.85_aarch64.dmg', 'P00RIJA.Cryptography_2.98.85_amd64.AppImage', 'P00RIJA.Cryptography_2.98.85_amd64.deb',
  'P00RIJA.Cryptography_2.98.85_arm64-setup.exe', 'P00RIJA.Cryptography_2.98.85_arm64.deb', 'P00RIJA.Cryptography_2.98.85_universal.dmg',
  'P00RIJA.Cryptography_2.98.85_x64-setup.exe', 'SHA256SUMS.txt',
];
const ASSETS = NAMES.map((name) => ({ name, browser_download_url: `https://github.com/x/y/releases/download/2.98.85/${name}` }));
const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
};
function load(ua) {
  const window = { navigator: { userAgent: ua } };
  const context = vm.createContext({ window, navigator: window.navigator, localStorage: { getItem: () => null, setItem: () => {} }, fetch: async () => ({ ok: false }), console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/update-check.js'), 'utf8'), context);
  return window.PoorijaUpdate;
}
const pick = (ua, info) => load(ua).pickAsset(ASSETS, info)?.name || null;

check('an Apple Silicon install gets the Apple Silicon build, not the universal one', pick(UA.mac, { os: 'macos', arch: 'aarch64', bundle: 'app', universal: false }) === 'P00RIJA.Cryptography_2.98.85_aarch64.dmg', pick(UA.mac, { os: 'macos', arch: 'aarch64', bundle: 'app', universal: false }));
check('a universal install gets the universal build', pick(UA.mac, { os: 'macos', arch: 'aarch64', bundle: 'app', universal: true }) === 'P00RIJA.Cryptography_2.98.85_universal.dmg');
check('an Intel Mac, with no Intel build of its own, gets the universal one', pick(UA.mac, { os: 'macos', arch: 'x86_64', bundle: 'app', universal: false }) === 'P00RIJA.Cryptography_2.98.85_universal.dmg');
check('Windows on Intel gets the x64 installer', pick(UA.win, { os: 'windows', arch: 'x86_64', bundle: 'nsis' }) === 'P00RIJA.Cryptography_2.98.85_x64-setup.exe');
check('Windows on ARM gets the arm64 installer, though its webview says x64', pick(UA.win, { os: 'windows', arch: 'aarch64', bundle: 'nsis' }) === 'P00RIJA.Cryptography_2.98.85_arm64-setup.exe');
check('a .deb install on Intel gets the amd64 .deb', pick(UA.linux, { os: 'linux', arch: 'x86_64', bundle: 'deb' }) === 'P00RIJA.Cryptography_2.98.85_amd64.deb');
check('and on ARM the arm64 .deb', pick(UA.linux, { os: 'linux', arch: 'aarch64', bundle: 'deb' }) === 'P00RIJA.Cryptography_2.98.85_arm64.deb');
check('an .rpm install gets the .rpm of its architecture', pick(UA.linux, { os: 'linux', arch: 'aarch64', bundle: 'rpm' }) === 'P00RIJA.Cryptography-2.98.85.aarch64.rpm'
  && pick(UA.linux, { os: 'linux', arch: 'x86_64', bundle: 'rpm' }) === 'P00RIJA.Cryptography-2.98.85.x86_64.rpm');
check('an AppImage gets the AppImage', pick(UA.linux, { os: 'linux', arch: 'x86_64', bundle: 'appimage' }) === 'P00RIJA.Cryptography_2.98.85_amd64.AppImage'
  && pick(UA.linux, { os: 'linux', arch: 'aarch64', bundle: 'appimage' }) === 'P00RIJA.Cryptography_2.98.85_aarch64.AppImage');
check('an Arch Linux install gets the pacman package', pick(UA.linux, { os: 'linux', arch: 'x86_64', bundle: null, distro: 'arch' }) === 'p00rija-cryptography-2.98.85-x86_64.pkg.tar.zst');
check('any other Linux install, the tarball', pick(UA.linux, { os: 'linux', arch: 'aarch64', bundle: null, distro: 'gentoo' }) === 'p00rija-cryptography-2.98.85-linux-aarch64.tar.gz');
check('Android gets the APK', pick(UA.android, { os: 'android', arch: 'aarch64' }) === 'P00RIJA-Cryptography-2.98.85-universal.apk');
check('without the shell’s word a Mac falls back to the universal build', pick(UA.mac, null) === 'P00RIJA.Cryptography_2.98.85_universal.dmg');
check('and a release without this machine’s file offers none', load(UA.mac).pickAsset(ASSETS.filter((asset) => !/dmg$/.test(asset.name)), { os: 'macos', arch: 'aarch64', bundle: 'app' }) === null);
check('the checksums file is found for the download to be checked against', load(UA.mac).sumsAsset?.(ASSETS)?.name === 'SHA256SUMS.txt');
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
