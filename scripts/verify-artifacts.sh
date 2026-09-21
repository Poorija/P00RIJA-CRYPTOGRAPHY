#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Checks that what was actually built carries the fixes, rather than trusting
# that the build ran after the source changed.
#
#   bash scripts/verify-artifacts.sh
#
# Tauri embeds the frontend compressed, but the asset *keys* stay as plain
# strings in the lookup table, so "/js/dialogs.js" being present in a binary
# proves that binary was built from a tree that had the dialog replacements.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SUCCESS='\033[1;32m'; ERROR='\033[1;31m'; DIM='\033[2m'; NC='\033[0m'
pass=0; fail=0

check_binary() {
    local label="$1" path="$2"
    if [ ! -f "$path" ]; then
        printf "${DIM}  skip   %-26s (not built)${NC}\n" "$label"
        return
    fi
    local missing=""
    # Substring, not whole-line: `strings` runs the asset keys together with
    # whatever bytes sit next to them in the table, so an exact-line match
    # finds nothing even when the key is there. Piping straight from `strings`
    # each time rather than holding the dump in a variable — it is tens of
    # megabytes and a shell variable mangles it.
    # `grep -c`, not `grep -q`: -q exits on the first match and closes the
    # pipe, `strings` dies of SIGPIPE, and `set -o pipefail` then reports the
    # whole pipeline as failed — turning every hit into a miss.
    # js/chat/01-constants.js stands in for the chat module: it is the first
    # part every build loads, and naming the old single js/chat.js here made
    # every installer report as broken.
    for key in "/js/dialogs.js" "/js/desktop-bridge.js" "/js/chat/01-constants.js" "/index.html"; do
        local hits
        hits="$(strings -a "$path" | grep -Fc -- "$key")"
        [ "${hits:-0}" -gt 0 ] || missing="$missing $key"
    done
    if [ -n "$missing" ]; then
        printf "${ERROR}  FAIL   %-26s missing:%s${NC}\n" "$label" "$missing"
        fail=$((fail + 1))
    else
        printf "${SUCCESS}  ok     %-26s %s${NC}\n" "$label" "$(du -h "$path" | cut -f1)"
        pass=$((pass + 1))
    fi
}

echo "Frontend payload embedded in each binary:"
check_binary "macOS arm64"    "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/P00RIJA Cryptography.app/Contents/MacOS/p00rija-cryptography"
check_binary "macOS universal" "src-tauri/target/universal-apple-darwin/release/bundle/macos/P00RIJA Cryptography.app/Contents/MacOS/p00rija-cryptography"
check_binary "Linux x86_64"   "src-tauri/target/x86_64-unknown-linux-gnu/release/p00rija-cryptography"
check_binary "Linux arm64"    "src-tauri/target/aarch64-unknown-linux-gnu/release/p00rija-cryptography"
check_binary "Windows x64"    "src-tauri/target/x86_64-pc-windows-msvc/release/p00rija-cryptography.exe"
check_binary "Windows arm64"  "src-tauri/target/aarch64-pc-windows-msvc/release/p00rija-cryptography.exe"
check_binary "iOS simulator"  "src-tauri/gen/apple/build/arm64-sim/P00RIJA Cryptography.app/P00RIJA Cryptography"

# The mobile payload rides inside the Rust library rather than sitting in the
# package as loose files, exactly as it does on desktop — unzipping the APK and
# looking for js/ finds nothing and proves nothing.
ANDROID_APK="src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
if [ -f "$ANDROID_APK" ]; then
    tmp="$(mktemp -d)"
    if unzip -q -o "$ANDROID_APK" 'lib/arm64-v8a/*' -d "$tmp" 2>/dev/null; then
        check_binary "Android arm64 (in APK)" "$tmp/lib/arm64-v8a/libp00rija_cryptography_lib.so"
    fi
    rm -rf "$tmp"
else
    printf "${DIM}  skip   %-26s (not built)${NC}\n" "Android arm64"
fi

# An artifact older than the code it is supposed to contain is stale, and the
# embedded payload is compressed so it cannot be grepped for the answer. The
# timestamps can answer it: every build re-runs native:prepare, so a bundle
# built after the newest shipped source file necessarily carries that source.
newest_source=0
newest_name=""
for f in index.html sw.js css/styles.css js/*.js; do
    [ -f "$f" ] || continue
    ts="$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null)"
    if [ "${ts:-0}" -gt "$newest_source" ]; then
        newest_source="$ts"
        newest_name="$f"
    fi
done

echo
echo "Built after the last source change (newest: $newest_name):"
check_freshness() {
    local label="$1" artifact="$2"
    if [ ! -e "$artifact" ]; then
        printf "${DIM}  skip   %-26s (not built)${NC}\n" "$label"
        return
    fi
    local ts
    ts="$(stat -f %m "$artifact" 2>/dev/null || stat -c %Y "$artifact" 2>/dev/null)"
    if [ "${ts:-0}" -ge "$newest_source" ]; then
        printf "${SUCCESS}  ok     %-26s${NC}\n" "$label"
        pass=$((pass + 1))
    else
        local behind=$(( (newest_source - ts) / 60 ))
        printf "${ERROR}  STALE  %-26s built %s min before the last source change${NC}\n" "$label" "$behind"
        fail=$((fail + 1))
    fi
}
T=src-tauri/target
check_freshness "macOS arm64"    "$T/aarch64-apple-darwin/release/bundle/dmg"
check_freshness "macOS universal" "$T/universal-apple-darwin/release/bundle/dmg"
check_freshness "Linux x86_64"   "$T/x86_64-unknown-linux-gnu/release/bundle/deb"
check_freshness "Linux arm64"    "$T/aarch64-unknown-linux-gnu/release/bundle/deb"
check_freshness "Windows x64"    "$T/x86_64-pc-windows-msvc/release/bundle/nsis"
check_freshness "Windows arm64"  "$T/aarch64-pc-windows-msvc/release/bundle/nsis"
check_freshness "Android APK"    "src-tauri/gen/android/app/build/outputs/apk/universal/release"
check_freshness "Android AAB"    "src-tauri/gen/android/app/build/outputs/bundle/universalRelease"
check_freshness "iOS simulator"  "src-tauri/gen/apple/build/arm64-sim"

echo
echo "The embedded payload is the current source:"
for f in js/app.js js/dialogs.js js/desktop-bridge.js css/styles.css; do
    if [ "$(md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1)" \
       = "$(md5 -q "dist/tauri/$f" 2>/dev/null || md5sum "dist/tauri/$f" 2>/dev/null | cut -d' ' -f1)" ]; then
        printf "${SUCCESS}  ok     %s${NC}\n" "$f"
        pass=$((pass + 1))
    else
        printf "${ERROR}  DIFF   %s differs from the bundled copy${NC}\n" "$f"
        fail=$((fail + 1))
    fi
done
# index.html is deliberately not compared: prepare-tauri-web.js rewrites it on
# the way in, stripping the PWA manifest link and injecting the native
# bootstrap, so an identical copy would mean the rewrite had stopped happening.

echo
echo "Source payload:"
if [ -f dist/tauri/js/dialogs.js ]; then
    printf "${SUCCESS}  ok     dist/tauri/js/dialogs.js${NC}\n"
    pass=$((pass + 1))
else
    printf "${ERROR}  FAIL   dist/tauri/js/dialogs.js is missing${NC}\n"
    fail=$((fail + 1))
fi

# Where the chat code lives now.
#
# js/chat.js was split into js/chat/NN-*.js, and every check below still looked
# for the single file. `grep -Fq` on a path that does not exist fails silently,
# so twenty-two assertions have been reporting the app's most important
# features as missing ever since — from a build in which all of them are
# present. A check that cannot pass is worse than no check: it trains you to
# read the failures and shrug.
chat_bundle_has() {
    grep -RFq "$1" dist/tauri/js/chat/ 2>/dev/null \
        || grep -Fq "$1" dist/tauri/js/chat.js 2>/dev/null
}

# Offline delivery has to be in the bundle, not just in the tree: without the
# sealing helpers a build silently goes back to refusing every message to a
# contact who is not connected.
for marker in sealSessionKeyFor offlineEnvelope sendSealedRelay; do
    if chat_bundle_has "$marker"; then
        printf "${SUCCESS}  ok     offline sealing: %s${NC}\n" "$marker"
        pass=$((pass + 1))
    else
        printf "${ERROR}  FAIL   offline sealing is missing: %s${NC}\n" "$marker"
        fail=$((fail + 1))
    fi
done

# Streaming file transfer, for the same reason: without these a build goes back
# to buffering the whole file into one base64 string, which throws outright past
# ~384 MB and stalls with no error well below that.
for marker in sendBlobChunks awaitChannelDrain chunkCipherBytes createTransferMeter; do
    if chat_bundle_has "$marker"; then
        printf "${SUCCESS}  ok     streaming transfer: %s${NC}\n" "$marker"
        pass=$((pass + 1))
    else
        printf "${ERROR}  FAIL   streaming transfer is missing: %s${NC}\n" "$marker"
        fail=$((fail + 1))
    fi
done

# The 2026-08 fixes. Each of these was invisible in a browser and only showed
# up in the native shell or on a phone, which is exactly the class of thing that
# silently regresses when the payload is not re-prepared before a build.
for marker in isInternalShellOrigin defaultRelayOriginForShell applyRemoteMirrorView \
              callBackdropStyle placeMessageToolbar bindRailCondense renderChatNavBadges \
              applyChatListFilter; do
    if chat_bundle_has "$marker"; then
        printf "${SUCCESS}  ok     UX pass: %s${NC}\n" "$marker"
        pass=$((pass + 1))
    else
        printf "${ERROR}  FAIL   UX pass is missing: %s${NC}\n" "$marker"
        fail=$((fail + 1))
    fi
done

# The fonts one is positional, not a marker: the call has to sit BEFORE the
# service-worker guard. Inside it, the native shell — which has no service
# worker by design — never registers a single optional @font-face.
if [ -f dist/tauri/js/app.js ]; then
    font_line="$(grep -n 'window.loadDeferredFonts?.()' dist/tauri/js/app.js | head -1 | cut -d: -f1)"
    guard_line="$(grep -n "if (!('serviceWorker' in navigator)) return;" dist/tauri/js/app.js | head -1 | cut -d: -f1)"
    if [ -n "$font_line" ] && { [ -z "$guard_line" ] || [ "$font_line" -lt "$guard_line" ]; }; then
        printf "${SUCCESS}  ok     fonts register without a service worker${NC}\n"
        pass=$((pass + 1))
    else
        printf "${ERROR}  FAIL   the font loader is behind the service-worker guard again${NC}\n"
        fail=$((fail + 1))
    fi
fi

# Since 2.26.66 native installs carry NO default relay by design: chat starts
# off and the first-run question collects an address, a config file or a QR.
# The check therefore only asserts the hint file exists and is well-formed —
# a private distribution may still bake origins, and an empty list is the
# intended public state, not a defect.
if test -f dist/tauri/js/relay-hints.js; then
    printf "${SUCCESS}  ok     relay hint file present (defaults intentionally empty)${NC}\n"
    pass=$((pass + 1))
else
    printf "${ERROR}  FAIL   relay-hints.js is missing from the bundle${NC}\n"
    fail=$((fail + 1))
fi

# The gallery entry is markup, so it is checked in the bundled HTML.
if grep -Fq 'id="chatGalleryInput"' dist/tauri/index.html 2>/dev/null; then
    printf "${SUCCESS}  ok     gallery picker in the bundled markup${NC}\n"
    pass=$((pass + 1))
else
    printf "${ERROR}  FAIL   gallery picker is missing from the bundled markup${NC}\n"
    fail=$((fail + 1))
fi

# The bug this guards against is silent: window.confirm() returns a truthy
# Promise in the native shell, so a stray call reads as "the user said yes".
#
# dialogs.js is excluded because it is the replacement, and desktop-bridge.js
# because its `confirm(text, options) {` is a method on the dialog-plugin
# wrapper, not a call to the browser's.
strays="$(python3 - <<'PYEOF'
import pathlib, re
CALL = re.compile(r'(?<![\w.$])(?:window\.)?(confirm|prompt|alert)\s*\(')
out = []
for name in ["app.js", "chat.js", "ssh-keys.js", "backup.js", "advanced-crypto.js", "crypto-config.js"]:
    path = pathlib.Path("dist/tauri/js") / name
    if not path.exists():
        continue
    for index, line in enumerate(path.read_text().splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith(("*", "//", "/*")) or "PoorijaDialogs" in line:
            continue
        match = CALL.search(line)
        if match:
            out.append(f"{name}:{index}: {match.group(1)}()")
print("\n".join(out[:5]))
PYEOF
)"
if [ -n "$strays" ]; then
    printf "${ERROR}  FAIL   a browser dialog call survived into the bundle:${NC}\n"
    echo "$strays" | sed 's/^/         /'
    fail=$((fail + 1))
else
    printf "${SUCCESS}  ok     no browser dialog calls in the bundled JS${NC}\n"
    pass=$((pass + 1))
fi

echo
if [ "$fail" -eq 0 ]; then
    printf "${SUCCESS}%d checks passed.${NC}\n" "$pass"
else
    printf "${ERROR}%d failed, %d passed.${NC}\n" "$fail" "$pass"
    exit 1
fi
