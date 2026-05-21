const fs = require('fs');
const path = require('path');

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

const monitorSource = path.join(root, 'monitor-client.html');
const monitorTarget = path.join(outDir, 'index.html');
if (!fs.existsSync(monitorSource)) {
  throw new Error('monitor-client.html is missing');
}
fs.copyFileSync(monitorSource, monitorTarget);

console.log(`Prepared Tauri monitor assets in ${path.relative(root, outDir)}`);
