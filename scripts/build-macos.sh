#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Builds, signs and verifies the macOS client.
#
#   bash scripts/build-macos.sh arm64|x86_64|universal
#
# Signing: Tauri only runs codesign when APPLE_SIGNING_IDENTITY is set, and
# without it the bundle keeps the linker's automatic ad-hoc signature — which
# carries no entitlements and seals no resources. Defaulting the identity to
# "-" gives a properly sealed ad-hoc bundle for local use; export a real
# Developer ID before releasing and this script uses that instead, adding the
# hardened runtime and a secure timestamp.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARCH="${1:-arm64}"
case "$ARCH" in
    arm64)     RUST_TARGET="aarch64-apple-darwin" ;;
    x86_64)    RUST_TARGET="x86_64-apple-darwin" ;;
    universal) RUST_TARGET="universal-apple-darwin" ;;
    *) echo "usage: $0 arm64|x86_64|universal" >&2; exit 2 ;;
esac

if [ "$(uname -s)" != "Darwin" ]; then
    echo "macOS bundles need Apple tooling; this host is $(uname -s)." >&2
    exit 1
fi

ADHOC=0
if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
    export APPLE_SIGNING_IDENTITY="-"
    ADHOC=1
    echo "No APPLE_SIGNING_IDENTITY set — signing ad-hoc for local use."
else
    echo "Signing with: $APPLE_SIGNING_IDENTITY"
fi

npx tauri build --target "$RUST_TARGET" --bundles app,dmg
status=$?
if [ "$status" -ne 0 ]; then
    # Xcode 27's linker sometimes lays a dylib's Mach-O string pool on a 4-byte
    # boundary. dyld requires 8 and refuses to load the file. rustc loads
    # proc-macro dylibs in order to expand macros, so that refusal is reported
    # as a compile error in whichever crate used the macro, which points at the
    # wrong file entirely. Name the real culprit before giving up.
    misaligned=""
    for dylib in "src-tauri/target/release/deps"/*.dylib \
                 "src-tauri/target/$RUST_TARGET/release/deps"/*.dylib; do
        [ -f "$dylib" ] || continue
        stroff="$(otool -l "$dylib" 2>/dev/null | awk '/stroff/ { print $2; exit }')"
        [ -n "$stroff" ] || continue
        if [ "$((stroff % 8))" -ne 0 ]; then
            misaligned="$misaligned  $dylib"$'\n'
        fi
    done
    if [ -n "$misaligned" ]; then
        echo >&2
        echo "These dylibs have a mis-aligned LINKEDIT string pool, so dyld cannot" >&2
        echo "load them. That is a defect in Apple's linker, not in this code:" >&2
        printf '%s' "$misaligned" >&2
        echo "Delete them and build again — they relink with a different layout." >&2
    fi
    echo "Build failed with status $status." >&2
    exit "$status"
fi

APP="src-tauri/target/$RUST_TARGET/release/bundle/macos/P00RIJA Cryptography.app"
if [ ! -d "$APP" ]; then
    echo "Expected bundle is missing: $APP" >&2
    exit 1
fi

echo
echo "== signature =="
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | sed 's/^/  /'
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E "Signature|Identifier|TeamIdentifier|Sealed" | sed 's/^/  /'

echo
echo "== entitlements =="
if codesign -d --entitlements :- "$APP" 2>/dev/null | grep -q "com.apple.security"; then
    codesign -d --entitlements :- "$APP" 2>/dev/null | grep -oE "com\.apple\.security[a-z.\-]*" | sed 's/^/  /'
else
    echo "  none found — the bundle would rely on Info.plist usage strings alone."
fi

# bundle_dmg.sh leaves its read-write scratch image behind — in bundle/macos/,
# next to the .app rather than beside the finished .dmg — and it is more than
# twice the size of the disk image it was built from.
find "src-tauri/target/$RUST_TARGET/release/bundle" -maxdepth 2 -name 'rw.*.dmg' -delete 2>/dev/null

echo
echo "== artifacts =="
ls -la "src-tauri/target/$RUST_TARGET/release/bundle/macos/" | sed 's/^/  /'
ls -la "src-tauri/target/$RUST_TARGET/release/bundle/dmg/"*.dmg 2>/dev/null | sed 's/^/  /'

if [ "$ADHOC" -eq 1 ]; then
    echo
    echo "Ad-hoc signed: fine on this Mac, but Gatekeeper will quarantine it after"
    echo "a download. For distribution set APPLE_SIGNING_IDENTITY (Developer ID"
    echo "Application: …) plus APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID and"
    echo "notarize the resulting .dmg."
fi
