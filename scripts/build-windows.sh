#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Builds the Windows client from macOS or Linux.
#
#   bash scripts/build-windows.sh x86_64|arm64
#
# Windows normally needs the MSVC toolchain, which only exists on Windows.
# cargo-xwin gets around that by downloading the Windows SDK and CRT headers
# into a project-local cache and driving clang-cl and lld-link from LLVM, so
# the same MSVC target can be built here.
#
# What this cannot produce is the .msi: that one needs WiX, which is a Windows
# program. The NSIS .exe installer is built here instead, and it is the
# installer Tauri recommends anyway.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARCH="${1:-x86_64}"
case "$ARCH" in
    x86_64) RUST_TARGET="x86_64-pc-windows-msvc" ;;
    arm64|aarch64) RUST_TARGET="aarch64-pc-windows-msvc" ;;
    *) echo "usage: $0 x86_64|arm64" >&2; exit 2 ;;
esac

INFO='\033[1;34m'; SUCCESS='\033[1;32m'; ERROR='\033[1;31m'; NC='\033[0m'
log()  { printf "${INFO}▶ %s${NC}\n" "$1"; }
ok()   { printf "${SUCCESS}✓ %s${NC}\n" "$1"; }
fail() { printf "${ERROR}✖ %s${NC}\n" "$1"; }

if [ "$(uname -s)" = "Darwin" ]; then
    # Apple's clang cannot target MSVC. Homebrew's `llvm` formula supplies
    # clang-cl, and `lld` — a separate formula, easy to miss — supplies the
    # lld-link that cargo-xwin actually calls to link a PE binary.
    for prefix in /opt/homebrew/opt/llvm /opt/homebrew/opt/lld /usr/local/opt/llvm /usr/local/opt/lld; do
        [ -d "$prefix/bin" ] && export PATH="$prefix/bin:$PATH"
    done
fi

for tool in cargo-xwin clang-cl lld-link; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        fail "$tool is missing."
        echo
        echo "  brew install llvm lld nsis"
        echo "  cargo install --locked cargo-xwin"
        echo "  rustup target add $RUST_TARGET"
        echo "  export PATH=\"/opt/homebrew/opt/llvm/bin:\$PATH\""
        exit 1
    fi
done

if ! rustup target list --installed | grep -Fxq "$RUST_TARGET"; then
    log "Adding the Rust target $RUST_TARGET"
    rustup target add "$RUST_TARGET" || exit 1
fi

# Homebrew's makensis dies with std::bad_alloc on the solid-LZMA compressor
# Tauri asks for by default. zlib costs perhaps 10 MB of installer size and is
# applied only here, so a build on a real Windows host still gets LZMA.
CROSS_CONFIG='{"bundle":{"windows":{"nsis":{"compression":"zlib"}}}}'

log "Building $RUST_TARGET through cargo-xwin (the Windows SDK downloads on first run)"
npx tauri build --runner cargo-xwin --target "$RUST_TARGET" --bundles nsis --config "$CROSS_CONFIG"
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
[ "$found" -eq 0 ] && { fail "No installer was produced."; exit 1; }

echo
echo "Unsigned. Windows SmartScreen will warn on first run; an Authenticode"
echo "certificate is what removes that, and it is a separate purchase from"
echo "Apple's or Google's programmes."
ok "Windows build finished for $ARCH."
