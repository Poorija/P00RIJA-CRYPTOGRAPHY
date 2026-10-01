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
  'fonts',
  'js',
  'vendor'
];

/* Nothing under the server's state directory may ship inside a binary.
 * data/ holds vapid.json — the Web Push PRIVATE key of whichever relay this
 * checkout happens to have run. The main app's prepare step refuses exactly
 * this, with a post-copy audit of what actually shipped; the monitor build
 * had simply never been given the list. Anyone extracting the assets of a
 * monitor binary built on a relay host would have taken the key that lets
 * them push as that server. */
const NEVER_BUNDLE = ['data', 'certs', 'vapid', 'keystore'];
function bundleFilter(file) {
  const relative = path.relative(root, file);
  const base = path.basename(relative);
  if (NEVER_BUNDLE.some((word) => relative === word || relative.startsWith(word + path.sep)
    || base.includes(word) || base === '.env' || base.endsWith('.pem') || base.endsWith('.key'))) {
    return false;
  }
  return !file.endsWith('.DS_Store');
}

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
    filter: bundleFilter
  });
}

/* The audit of what actually shipped, not what was asked for: a directory
 * copied by a list can grow a secret when nobody is watching the list. */
(function auditShipped() {
  const offenders = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else {
        const rel = path.relative(outDir, full);
        const base = path.basename(rel);
        if (NEVER_BUNDLE.some((word) => rel.startsWith(word + path.sep) || base.includes(word))
          || base === '.env' || base.endsWith('.pem') || base.endsWith('.key')) offenders.push(rel);
      }
    }
  })(outDir);
  if (offenders.length) {
    console.error('Refusing to build: the monitor bundle would ship server secrets:');
    for (const rel of offenders) console.error('  ' + rel);
    process.exit(1);
  }
})();

const monitorSource = path.join(root, 'monitor-client.html');
const monitorTarget = path.join(outDir, 'index.html');
if (!fs.existsSync(monitorSource)) {
  throw new Error('monitor-client.html is missing');
}
fs.copyFileSync(monitorSource, monitorTarget);

console.log(`Prepared Tauri monitor assets in ${path.relative(root, outDir)}`);
