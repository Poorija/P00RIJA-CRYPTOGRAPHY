const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'tauri');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        return [key, value];
      })
  );
}

function relayHintsFromEnv() {
  const env = parseEnvFile(path.join(root, '.env'));
  const hints = new Set();
  const append = (value) => {
    if (!value) return;
    String(value)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => hints.add(entry));
  };
  append(env.CHAT_PUBLIC_RELAY_ORIGIN);
  if (env.DOMAIN) {
    hints.add(`https://${env.DOMAIN}:8585`);
    hints.add(`https://${env.DOMAIN}`);
  }
  if (env.EXTERNAL_IP) {
    hints.add(`http://${env.EXTERNAL_IP}:9000`);
    hints.add(`https://${env.EXTERNAL_IP}:8585`);
  }
  return Array.from(hints);
}

const entries = [
  'index.html',
  'monitor-client.html',
  'manifest.webmanifest',
  'sw.js',
  'assets',
  'css',
  'data',
  'fonts',
  'js',
  'vendor'
];

fs.rmSync(outDir, { recursive: true, force: true });
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

const copiedIndex = path.join(outDir, 'index.html');
let html = fs.readFileSync(copiedIndex, 'utf8');
html = html.replace(
  /<link rel="manifest" href="manifest\.webmanifest">\n?/,
  ''
);
html = html.replace(
  /navigator\.serviceWorker\.register\('\.\/sw\.js\?v=2\.99\.0-connection-switch-v8-20260511', \{ scope: '\.\/' \}\)/g,
  "Promise.reject(new Error('service worker disabled in Tauri desktop runtime'))"
);
fs.writeFileSync(copiedIndex, html);

const relayHintsFile = path.join(outDir, 'js', 'relay-hints.js');
const relayHints = relayHintsFromEnv();
fs.writeFileSync(
  relayHintsFile,
  `(function () {\n  window.__POORIJA_RELAY_HINTS__ = ${JSON.stringify(relayHints, null, 2)};\n})();\n`
);

console.log(`Prepared Tauri web assets in ${path.relative(root, outDir)}`);
