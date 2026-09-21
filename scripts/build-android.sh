#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Builds the Android client.
#
#   bash scripts/build-android.sh              # signed release APK + AAB
#   bash scripts/build-android.sh debug        # debug APK, installable immediately
#
# No Google account and no Play Console are needed for either: Android installs
# an APK signed with your own key. The $25 Play Console fee only applies to
# publishing on the store.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=/dev/null
source scripts/mobile-env.sh >/dev/null

INFO='\033[1;34m'; SUCCESS='\033[1;32m'; WARN='\033[1;33m'; ERROR='\033[1;31m'; NC='\033[0m'
log()  { printf "${INFO}▶ %s${NC}\n" "$1"; }
ok()   { printf "${SUCCESS}✓ %s${NC}\n" "$1"; }
warn() { printf "${WARN}! %s${NC}\n" "$1"; }
fail() { printf "${ERROR}✖ %s${NC}\n" "$1"; }

MODE="${1:-release}"

if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "$ANDROID_HOME" ]; then
    fail "No Android SDK found. Install it with:  brew install --cask android-commandlinetools android-ndk"
    exit 1
fi
if [ -z "${NDK_HOME:-}" ] || [ ! -d "$NDK_HOME" ]; then
    fail "No Android NDK found. Install it with:  brew install --cask android-ndk"
    exit 1
fi

if [ ! -d src-tauri/gen/android ]; then
    log "Generating the Android project"
    npx tauri android init || exit 1
fi

KEYSTORE_PROPS="${P00RIJA_ANDROID_KEYSTORE_PROPERTIES:-$HOME/.p00rija-android-signing/keystore.properties}"
if [ "$MODE" = "release" ] && [ ! -f "$KEYSTORE_PROPS" ]; then
    warn "No signing keystore at $KEYSTORE_PROPS — the APK will come out unsigned"
    warn "and Android will refuse to install it. Create one with:"
    echo "    bash scripts/android-keystore.sh"
fi

if [ "$MODE" = "debug" ]; then
    log "Building the debug APK"
    npx tauri android build --debug --apk || exit 1
    OUT="src-tauri/gen/android/app/build/outputs/apk/universal/debug"
else
    log "Building the release APK and AAB"
    npx tauri android build --apk --aab || exit 1
    OUT="src-tauri/gen/android/app/build/outputs"
fi

echo
log "Artifacts"
found=0
while IFS= read -r f; do
    [ -n "$f" ] || continue
    found=1
    printf "  %-8s %s\n" "$(du -h "$f" | cut -f1)" "$f"
done < <(find "$OUT" -type f \( -name "*.apk" -o -name "*.aab" \) 2>/dev/null)
[ "$found" -eq 0 ] && { fail "Nothing was produced."; exit 1; }

APK="$(find "$OUT" -name "*.apk" -type f 2>/dev/null | head -1)"
if [ -n "$APK" ] && [ -x "$ANDROID_HOME/build-tools/36.0.0/apksigner" ]; then
    echo
    log "Signature"
    "$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs "$APK" 2>&1 \
        | grep -E "Signer #1 certificate DN|DOES NOT VERIFY" | sed 's/^/  /' || true
fi

echo
echo "To install over USB:  adb install -r \"$APK\""
ok "Android build finished."
