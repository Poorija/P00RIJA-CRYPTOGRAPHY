#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Builds the Windows client in a container, from any host.
#
#   bash scripts/build-windows-docker.sh x86_64|arm64
#
# See config/Dockerfile.builder-windows for why NSIS runs in Debian rather than
# on a Mac.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INFO='\033[1;34m'; SUCCESS='\033[1;32m'; ERROR='\033[1;31m'; NC='\033[0m'
log()  { printf "${INFO}▶ %s${NC}\n" "$1"; }
ok()   { printf "${SUCCESS}✓ %s${NC}\n" "$1"; }
fail() { printf "${ERROR}✖ %s${NC}\n" "$1"; }

ARCH="${1:-x86_64}"
case "$ARCH" in
    x86_64) RUST_TARGET="x86_64-pc-windows-msvc"; NSIS_ARCH="x64" ;;
    arm64|aarch64) RUST_TARGET="aarch64-pc-windows-msvc"; NSIS_ARCH="arm64" ;;
    *) echo "usage: $0 x86_64|arm64" >&2; exit 2 ;;
esac

if ! docker info >/dev/null 2>&1; then
    fail "Docker is not running."
    exit 1
fi

# The container only cross-compiles, so it may as well run at the host's own
# architecture rather than under emulation.
HOST_PLATFORM="linux/amd64"
[ "$(uname -m)" = "arm64" ] && HOST_PLATFORM="linux/arm64"

IMAGE="poorija-windows-builder:$(echo "$HOST_PLATFORM" | tr '/' '-')"

log "Preparing the builder image ($IMAGE)"
docker build --platform "$HOST_PLATFORM" -t "$IMAGE" -f config/Dockerfile.builder-windows . || {
    fail "Building the builder image failed."
    exit 1
}

log "Cross-compiling $RUST_TARGET"
docker run --rm \
    --platform "$HOST_PLATFORM" \
    -v "$ROOT:/app" \
    -v "poorija_win_cargo_registry:/root/.cargo/registry" \
    -v "poorija_win_xwin_cache:/root/.cache/cargo-xwin" \
    -v "poorija_win_node_modules:/app/node_modules" \
    -e "CI=true" \
    "$IMAGE" \
    "set -e; npm install --no-audit --no-fund; \
     npx tauri build --runner cargo-xwin --target $RUST_TARGET --bundles nsis"
status=$?
if [ "$status" -ne 0 ]; then
    fail "The Windows build failed with status $status."
    exit "$status"
fi

BUNDLE="src-tauri/target/$RUST_TARGET/release/bundle"
echo
log "Artifacts"
found=0
for f in "$BUNDLE/nsis/"*.exe "src-tauri/target/$RUST_TARGET/release/p00rija-cryptography.exe"; do
    [ -e "$f" ] || continue
    found=1
    printf "  %-8s %s\n" "$(du -h "$f" | cut -f1)" "$f"
done
if [ "$found" -eq 0 ]; then
    fail "No installer was produced."
    exit 1
fi

echo
echo "Unsigned: Windows SmartScreen will warn on first run until the installer"
echo "carries an Authenticode signature, which is a separate purchase from"
echo "Apple's and Google's programmes."
ok "Windows build finished for $ARCH ($NSIS_ARCH)."
