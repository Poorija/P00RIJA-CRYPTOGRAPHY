#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Builds the npm quick-installer package: npm-package/p00rija-cryptography-<version>.tgz
#
# The web payload is prepared with the same prepare step the native shells use,
# then copied into npm-package/app so `npx p00rija-cryptography --pwa` serves
# exactly what the installers embed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"

log() { printf '\033[1;34m▶ %s\033[0m\n' "$1"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }

log "Preparing the web payload (same prepare the native shells use)"
node scripts/prepare-tauri-web.js

log "Copying the payload into npm-package/app"
rm -rf npm-package/app
mkdir -p npm-package/app
for entry in index.html monitor-client.html manifest.webmanifest assets css fonts js vendor; do
    [ -e "dist/tauri/$entry" ] && cp -R "dist/tauri/$entry" npm-package/app/
done

# The native bootstrap injected into dist/tauri is harmless in a browser tab
# (it only removes the service-worker APIs the launcher never registers), so
# the payload ships as-is.

log "Packing"
( cd npm-package && npm pack --silent )
ok "npm-package/p00rija-cryptography-${VERSION}.tgz is ready"
echo "  publish with:  cd npm-package && npm publish"
