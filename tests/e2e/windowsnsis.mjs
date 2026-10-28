/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The Windows installer is made by Debian's NSIS in the builder image
 * (config/Dockerfile.builder-windows), from Tauri's installer template. Every
 * header that template includes has to be there, and the Restart Manager
 * macros it calls have to compile: Tauri's CLI includes Win\RestartManager.nsh
 * since 2.12, and Debian bookworm's NSIS 3.08 has none, so the build stopped
 * at makensis after the whole compile.
 *
 *   node tests/e2e/windowsnsis.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const PLATFORM = os.arch() === 'arm64' ? 'linux/arm64' : 'linux/amd64';
const IMAGE = `poorija-windows-builder:${PLATFORM.replace('/', '-')}`;

/* The headers Tauri's template includes: from the last installer.nsi a build
   wrote, when there is one, else the ones Tauri 2.12's template names. The
   template's own files (utils.nsh, FileAssociation.nsh) sit beside it. */
const generated = ['x86_64-pc-windows-msvc/release/nsis/x64', 'aarch64-pc-windows-msvc/release/nsis/arm64']
  .map((dir) => path.join(ROOT, 'src-tauri/target', dir, 'installer.nsi'))
  .filter((file) => fs.existsSync(file))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const OWN = new Set(['utils.nsh', 'FileAssociation.nsh']);
const headers = generated
  ? [...fs.readFileSync(generated, 'utf8').matchAll(/^!include\s+"?([^"\s]+)"?/gm)].map((match) => match[1]).filter((name) => !OWN.has(name) && !/^\$\{/.test(name))
  : ['MUI2.nsh', 'FileFunc.nsh', 'x64.nsh', 'WordFunc.nsh', 'Win\\COM.nsh', 'Win\\Propkey.nsh', 'Win\\RestartManager.nsh', 'StrFunc.nsh'];

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'poorija-nsis-')));
try {
  const built = spawnSync('docker', ['build', '-q', '--platform', PLATFORM, '-t', IMAGE, '-f', 'config/Dockerfile.builder-windows', '.'], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
  check('the builder image builds', built.status === 0, `${built.stderr || ''}`.trim().split('\n').slice(-3).join(' | '));

  fs.writeFileSync(path.join(work, 'stub.nsi'), [
    'Unicode true',
    'OutFile "/stub/stub.exe"',
    ...headers.map((name) => `!include "${name}"`),
    'Section',
    // What Tauri's utils.nsh calls to close a running copy before it replaces it.
    '  !insertmacro RestartManager_StartSession $R0',
    '  !insertmacro RestartManager_RegisterFile $R0 "$INSTDIR\\app.exe"',
    '  !insertmacro RestartManager_EndSession $R0',
    'SectionEnd',
    '',
  ].join('\n'));
  const made = spawnSync('docker', ['run', '--rm', '--platform', PLATFORM, '-v', `${work}:/stub`, IMAGE, 'makensis -V2 /stub/stub.nsi'], { encoding: 'utf8', timeout: 300000 });
  const said = `${made.stdout}${made.stderr}`;
  check(`its NSIS has every header Tauri's template includes (${headers.length}${generated ? ', from the last build' : ''})`, made.status === 0 || !/could not find/.test(said), (said.match(/.*could not find.*/g) || []).join(' | '));
  check('and compiles the Restart Manager macros the installer calls', made.status === 0 && fs.existsSync(path.join(work, 'stub.exe')), said.trim().split('\n').slice(-3).join(' | '));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
