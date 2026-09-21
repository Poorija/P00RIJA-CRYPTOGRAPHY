/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/*
 * Builds the web payload that gets embedded in the native bundle.
 *
 * The Tauri runtime is not a browser tab: there is no service worker, no
 * install prompt, and no manifest. Rather than teach every call site about
 * that, this script copies the app into dist/tauri and removes the browser-only
 * seams there, so js/ stays identical between the web build and the native one.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'tauri');

// Every desktop/mobile/npm build must embed the same release as the web app.
execFileSync(process.execPath, [path.join(root, 'tools', 'check-versions.cjs')], { stdio: 'inherit' });

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

/* Public relay origins that ship with the build.
 *
 * Without these a freshly installed native app has nowhere to connect: the
 * webview's own origin is not a server, so the app came up with an empty
 * server box and looked broken. .env is still read and wins, but it is not
 * present in a clean checkout — which is exactly the case that has to work. */
function relayHintsFromDefaults() {
  try {
    const raw = fs.readFileSync(path.join(root, 'config', 'relay-defaults.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.origins) ? parsed.origins.filter(Boolean) : [];
  } catch (_error) {
    return [];
  }
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
  relayHintsFromDefaults().forEach((origin) => hints.add(origin));
  return Array.from(hints).filter((origin) => !isDocumentationPlaceholder(origin));
}

/* The .env next to a checkout is usually the unfilled template — DOMAIN is
 * still "chat.example.com" and EXTERNAL_IP still a TEST-NET address. The hint
 * list is ordered, and the first entry is what a fresh install pre-fills its
 * server box with, so shipping those put a placeholder that can never answer
 * ahead of the real relay: every fresh native install started "broken" until
 * the user noticed. Documentation values are reserved on purpose; a real
 * domain or IP can never collide with them. */
function isDocumentationPlaceholder(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_error) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  /* RFC 2606/6761 reserved names, plus the example TLD family. */
  if (/(^|\.)(example|invalid|test)$/.test(host)) return true;
  if (/(^|\.)example\.(com|net|org|edu)$/.test(host)) return true;
  /* RFC 5737 documentation ranges: 192.0.2.x, 198.51.100.x, 203.0.113.x. */
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match) {
    const [a, b] = [Number(match[1]), Number(match[2])];
    if (a === 192 && b === 0 && Number(match[3]) === 2) return true;
    if (a === 198 && b === 51 && Number(match[3]) === 100) return true;
    if (a === 203 && b === 0 && Number(match[3]) === 113) return true;
  }
  return false;
}

/* Files without which the bundle would build but not run. Checked up front so
   a missing asset is a build error rather than a blank window. */
const REQUIRED = [
  'index.html',
  'js/app.js',
  'js/crypto-core.js',
  'js/vault-profiles.js',
  'js/stego.js',
  'js/desktop-bridge.js',
  'js/ssh-keys.js',
  'css/styles.css'
];

/* What goes into the shipped bundle.
 *
 * `data` used to be on this list and had no business being there. It is the
 * RELAY's runtime state — .gitignore has always excluded it — and Tauri
 * compiles frontendDist straight into the binary, so every native build was
 * embedding the builder's own relay directory: 832 MB of queued message
 * ciphertext, the push subscription list, and data/chat-signal/vapid.json,
 * which is the Web Push PRIVATE KEY. Anyone holding a copy of the app could
 * have pulled that key out and sent notifications as the server.
 *
 * Nothing in the client payload or in src-tauri reads data/; it was a mistake
 * with a very large blast radius. The binary went from 627 MB to what a Tauri
 * app should weigh once it was removed. */
const entries = [
  'index.html',
  'monitor-client.html',
  'manifest.webmanifest',
  'assets',
  'css',
  'fonts',
  'js',
  'vendor'
];

/* A bundle is written once and copied everywhere, so anything secret that
   reaches it reaches every user. Refuse rather than warn. */
const NEVER_BUNDLE = [
  /(^|\/)data(\/|$)/,        /* relay state, including the push keypair */
  /(^|\/)certs?(\/|$)/,      /* TLS private keys */
  /(^|\/)\.env/,             /* the monitor password and TURN secret */
  /(^|\/)node_modules(\/|$)/,
  /\.pem$/, /\.key$/, /vapid/i
];
for (const entry of entries) {
  for (const pattern of NEVER_BUNDLE) {
    if (pattern.test(entry)) {
      throw new Error(`Refusing to bundle "${entry}": it matches ${pattern}.`);
    }
  }
}

const missing = REQUIRED.filter((entry) => !fs.existsSync(path.join(root, entry)));
if (missing.length) {
  throw new Error(`Cannot prepare the native bundle, missing: ${missing.join(', ')}`);
}

/* The chat module is a set of ordered scripts, not one file.
 *
 * This list used to name js/chat.js, and when that file was split into
 * js/chat/NN-*.js the guard did exactly what it was written to do: it refused
 * to build. Which was right — but it meant every native build (macOS, Windows,
 * Linux, Android, iOS) failed at prepare while the web build was fine, so
 * nothing noticed until someone tried to build a desktop app.
 *
 * Counting the parts and comparing them against index.html is a stronger check
 * than naming one file ever was: a part added to the directory but not to the
 * page, or the reverse, is a bundle that loads without error and is missing
 * whole features. That is worth failing the build over. */
const chatDir = path.join(root, 'js', 'chat');
if (!fs.existsSync(chatDir)) {
  throw new Error('Cannot prepare the native bundle: js/chat/ is missing.');
}
const chatParts = fs.readdirSync(chatDir).filter((f) => /^\d+-.*\.js$/.test(f)).sort();
if (!chatParts.length) {
  throw new Error('Cannot prepare the native bundle: js/chat/ holds no parts.');
}
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const referenced = (indexHtml.match(/js\/chat\/\d+-[^"?]+\.js/g) || [])
  .map((src) => src.split('/').pop());
const onDiskNotOnPage = chatParts.filter((f) => !referenced.includes(f));
const onPageNotOnDisk = referenced.filter((f) => !chatParts.includes(f));
if (onDiskNotOnPage.length || onPageNotOnDisk.length) {
  throw new Error(
    'Cannot prepare the native bundle: js/chat/ and index.html disagree.\n' +
    (onDiskNotOnPage.length ? `  on disk but not loaded: ${onDiskNotOnPage.join(', ')}\n` : '') +
    (onPageNotOnDisk.length ? `  loaded but not on disk: ${onPageNotOnDisk.join(', ')}\n` : '')
  );
}
console.log(`  chat module: ${chatParts.length} parts, all referenced by index.html`);

/* Checked again on the way out. The list above is what this script intends to
   copy; this is what actually landed, which is the thing that ships. */
function auditBundle(dir) {
  const offenders = [];
  const walk = (current, rel) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (NEVER_BUNDLE.some((pattern) => pattern.test(relPath))) {
        offenders.push(relPath);
        continue;
      }
      if (fs.statSync(full).isDirectory()) walk(full, relPath);
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return offenders;
}

/* Two builds cannot share dist/tauri.
 *
 * `frontendDist` is one fixed path, and the first thing this script does is
 * delete it. Start a macOS build and a Linux container build at the same time
 * and the second one's prepare removes the assets the first one's compiler is
 * still reading — the failure surfaces as
 * "failed to read asset .../fonts/…/Something.ttf", which points at a font and
 * not at the actual cause.
 *
 * A lock file turns that into a refusal with an explanation. It carries the
 * owning pid so a lock left behind by a killed build can be spotted and is
 * cleared automatically when that process is gone. */
const lockFile = path.join(root, 'dist', '.prepare.lock');
fs.mkdirSync(path.dirname(lockFile), { recursive: true });

const lockOwner = `${os.hostname()}:${process.pid}`;

function ownerIsGone(owner) {
  const [host, pid] = String(owner).split(':');
  // A container build sees a different pid namespace, so a pid from another
  // host says nothing about whether that build is still going. Only a stale
  // lock from *this* machine can be judged, and cleared.
  if (host !== os.hostname()) return false;
  try {
    process.kill(Number(pid), 0);
    return false;
  } catch (error) {
    return error.code !== 'EPERM';
  }
}

if (fs.existsSync(lockFile)) {
  const holder = fs.readFileSync(lockFile, 'utf8').trim();
  if (holder && holder !== lockOwner && !ownerIsGone(holder)) {
    throw new Error(
      `Another native build (${holder}) is using dist/tauri. ` +
      'Builds share one frontendDist directory and cannot run at the same time — ' +
      `wait for it to finish, or delete ${path.relative(root, lockFile)} if that build is gone.`
    );
  }
  fs.rmSync(lockFile, { force: true });
}
fs.writeFileSync(lockFile, lockOwner);
process.on('exit', () => {
  try {
    if (fs.readFileSync(lockFile, 'utf8').trim() === lockOwner) {
      fs.rmSync(lockFile, { force: true });
    }
  } catch (error) { /* already gone */ }
});

// Native rm -rf on POSIX: fs.rmSync trips over ENOTEMPTY when a previous
// build left read-only files behind.
try {
  if (process.platform === 'win32') {
    fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } else {
    try {
      execSync(`rm -rf "${outDir}"`);
    } catch (error) {
      execSync(`chmod -R +w "${outDir}" 2>/dev/null || true`);
      execSync(`rm -rf "${outDir}"`);
    }
  }
} catch (error) {
  console.warn(`Warning: could not fully remove ${outDir}, continuing anyway.`);
}
fs.mkdirSync(outDir, { recursive: true });

/* Everything under these directories is embedded in the binary verbatim, so a
   stray editor backup next to app.js does not just sit there — it ships. One
   pass of edits left 1.1 MB of .bak files inside every bundle. */
const EXCLUDED = /(?:^|[\\/])(?:\.DS_Store|Thumbs\.db|\.git|node_modules)$|\.(?:bak|orig|rej|swp|swo|tmp)$|~$/i;

for (const entry of entries) {
  const source = path.join(root, entry);
  const target = path.join(outDir, entry);
  if (!fs.existsSync(source)) continue;
  fs.cpSync(source, target, {
    recursive: true,
    filter: (file) => !EXCLUDED.test(file)
  });
}

/* ------------------------------------------------------------------
 * index.html — strip the PWA seams.
 *
 * The old version rewrote a hard-coded `serviceWorker.register(...)` string
 * that had since moved into js/app.js and changed its ?v= tag, so the pattern
 * silently stopped matching and the worker registered inside the native shell.
 * Removing the API instead of the call site cannot drift: every registration
 * path in the app is already guarded by `'serviceWorker' in navigator`.
 * ------------------------------------------------------------------ */
const copiedIndex = path.join(outDir, 'index.html');
let html = fs.readFileSync(copiedIndex, 'utf8');

const beforeManifest = html;
html = html.replace(/[ \t]*<link[^>]+rel=["']manifest["'][^>]*>\r?\n?/gi, '');
if (html === beforeManifest) {
  console.warn('Warning: no <link rel="manifest"> found in index.html.');
}

const NATIVE_BOOTSTRAP = `<script>
/* Injected by scripts/prepare-tauri-web.js — native shell only. */
(function () {
  window.__POORIJA_NATIVE_SHELL__ = true;
  try {
    /* serviceWorker lives on Navigator.prototype as a configurable accessor.
       Deleting it there is what makes \`'serviceWorker' in navigator\` false;
       assigning undefined on the instance would leave the \`in\` check true and
       every guard in app.js would walk straight into a TypeError. */
    if ('serviceWorker' in navigator) {
      delete Navigator.prototype.serviceWorker;
    }
  } catch (error) {
    /* Nothing to undo — the guards fall back to the no-worker path. */
  }
  try {
    /* No worker means no push subscription; without this the settings pane
       offers a Web Push toggle that can never succeed. */
    delete window.PushManager;
  } catch (error) { /* non-configurable on this engine */ }
})();
</script>
`;

/* Looks for the ASSIGNMENT, not the name.
 *
 * This used to test for /__POORIJA_NATIVE_SHELL__/ anywhere in the file, as a
 * guard against injecting twice. index.html READS that global — one line
 * deciding whether a mobile shell is in play — and that read satisfied the
 * test, so the bootstrap was never injected at all. Every native build
 * therefore shipped with the flag unset and Navigator.prototype.serviceWorker
 * still in place, and the app registered a service worker that deliberately is
 * not copied here: a 404 and a thrown script on every start, on all five
 * platforms. tests/e2e/native-shell.mjs is what noticed. */
if (!/__POORIJA_NATIVE_SHELL__\s*=\s*true/.test(html)) {
  const headIndex = html.search(/<head[^>]*>/i);
  if (headIndex === -1) {
    throw new Error('index.html has no <head> to inject the native bootstrap into.');
  }
  const insertAt = html.indexOf('>', headIndex) + 1;
  html = `${html.slice(0, insertAt)}\n${NATIVE_BOOTSTRAP}${html.slice(insertAt)}`;
}

fs.writeFileSync(copiedIndex, html);

/* sw.js is deliberately not copied: nothing can register it, and shipping a
   cache layer that never runs only invites confusion when debugging. */
const strayWorker = path.join(outDir, 'sw.js');
if (fs.existsSync(strayWorker)) fs.rmSync(strayWorker);

/* Opt-in diagnostic harness. The native webview has no console anyone can
   read, so this is how you find out what the real document sees. Off unless
   POORIJA_NATIVE_PROBE is set, and never present in a normal bundle. */
if (process.env.POORIJA_NATIVE_PROBE) {
  const probeSource = path.join(root, 'tests', 'e2e', 'native-probe.js');
  if (!fs.existsSync(probeSource)) {
    throw new Error('POORIJA_NATIVE_PROBE is set but tests/e2e/native-probe.js is missing.');
  }
  fs.copyFileSync(probeSource, path.join(outDir, 'js', 'native-probe.js'));
  const probeTag = '<script src="js/native-probe.js"></script>\n';
  const bodyEnd = html.lastIndexOf('</body>');
  html = bodyEnd === -1 ? html + probeTag : html.slice(0, bodyEnd) + probeTag + html.slice(bodyEnd);
  fs.writeFileSync(copiedIndex, html);
  console.log('Native diagnostic probe injected (POORIJA_NATIVE_PROBE).');
}

const relayHintsFile = path.join(outDir, 'js', 'relay-hints.js');
const relayHints = relayHintsFromEnv();
fs.writeFileSync(
  relayHintsFile,
  `(function () {\n  window.__POORIJA_RELAY_HINTS__ = ${JSON.stringify(relayHints, null, 2)};\n})();\n`
);

const strays = fs.readdirSync(path.join(outDir, 'js')).filter((name) => EXCLUDED.test(name));
if (strays.length) {
  throw new Error(`Backup files reached the bundle: ${strays.join(', ')}`);
}

const verify = fs.readFileSync(copiedIndex, 'utf8');
if (/rel=["']manifest["']/i.test(verify)) {
  throw new Error('The PWA manifest link survived the rewrite.');
}
if (!/__POORIJA_NATIVE_SHELL__/.test(verify)) {
  throw new Error('The native bootstrap was not injected.');
}

/* The last word on what ships. If anything secret made it into the output —
   by a new entry, a stray copy, or a symlink — the build stops here rather
   than producing an installer that carries it. */
const leaked = auditBundle(outDir);
if (leaked.length) {
  throw new Error(
    'Refusing to ship this bundle; it contains files that must never leave ' +
    'the machine that built it:\n  ' + leaked.slice(0, 10).join('\n  '));
}

const bundleBytes = (function measure(dir) {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    total += stat.isDirectory() ? measure(full) : stat.size;
  }
  return total;
})(outDir);
const bundleMb = Math.round(bundleBytes / 1048576);

/* Tauri compiles this whole tree into the binary, so the number below is
   roughly what every installer will weigh. It sat at 874 MB while data/ was
   being copied in; a ceiling turns that class of mistake into a build failure
   instead of a download nobody looks at twice. */
const BUNDLE_CEILING_MB = 120;
if (bundleMb > BUNDLE_CEILING_MB) {
  throw new Error(
    `The prepared bundle is ${bundleMb} MB, over the ${BUNDLE_CEILING_MB} MB ceiling. ` +
    'Tauri embeds all of it in the binary, so something large has been added ' +
    'that probably should not ship. Check dist/tauri with du -sh *.');
}

console.log(`  bundle: ${bundleMb} MB, nothing sensitive in it`);
console.log(`Prepared Tauri web assets in ${path.relative(root, outDir)} (${relayHints.length} relay hint(s))`);
