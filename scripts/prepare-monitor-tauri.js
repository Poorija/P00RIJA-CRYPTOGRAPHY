/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'tauri-monitor');

const entries = [
  'assets',
  'css',
  'data',
  'fonts',
  'js',
  'vendor'
];

// Use native rm -rf for maximum robustness on macOS/Linux to avoid ENOTEMPTY issues
try {
  if (process.platform === 'win32') {
    fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } else {
    try {
      execSync(`rm -rf "${outDir}"`);
    } catch (e) {
      // If rm fails, try to fix permissions and try again
      execSync(`chmod -R +w "${outDir}" 2>/dev/null || true`);
      execSync(`rm -rf "${outDir}"`);
    }
  }
} catch (e) {
  console.warn(`Warning: Could not fully remove ${outDir}. Attempting to continue anyway...`);
}
fs.mkdirSync(outDir, { recursive: true });

for (const entry of entries) {
  const source = path.join(root, entry);
  const target = path.join(outDir, entry);
  if (!fs.existsSync(source)) continue;
  fs.cpSync(source, target, {
    recursive: true,
    filter: (file) => !file.endsWith('.DS_Store')
  });
}

const monitorSource = path.join(root, 'monitor-client.html');
const monitorTarget = path.join(outDir, 'index.html');
if (!fs.existsSync(monitorSource)) {
  throw new Error('monitor-client.html is missing');
}
fs.copyFileSync(monitorSource, monitorTarget);

console.log(`Prepared Tauri monitor assets in ${path.relative(root, outDir)}`);
