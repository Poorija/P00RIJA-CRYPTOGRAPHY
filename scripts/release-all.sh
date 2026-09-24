#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Build every platform, collect them into Export/, and verify what came out.
#
#   bash scripts/release-all.sh                 # everything
#   bash scripts/release-all.sh --skip-mobile   # desktop only
#   bash scripts/release-all.sh --resume        # skip whatever already looks built
#
# One command, start to finish, unattended. It takes roughly 45–90 minutes on
# this machine — most of it Rust compiling twice for Linux and twice more for
# Windows inside Docker.
#
# SEQUENTIAL ON PURPOSE. Every Tauri build reads dist/tauri, and
# prepare-tauri-web.js begins by deleting that directory. Two builds at once
# means one of them reads a tree that is being rewritten underneath it, which
# surfaces as "failed to read asset .../vendor/jszip/jszip.min.js" some minutes
# in. Do not add `&`.
#
# Every step writes to release-logs/<step>.log and the summary at the end says
# which steps produced an artifact. A failed step does not stop the rest: a
# missing Windows toolchain should not cost you the Linux packages. The exit
# code is non-zero if anything failed, and verify-artifacts at the end is the
# thing that decides whether the build is real.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_MOBILE=0
RESUME=0
for arg in "$@"; do
    case "$arg" in
        --skip-mobile) SKIP_MOBILE=1 ;;
        --resume) RESUME=1 ;;
        -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

LOGS="$ROOT/release-logs"
mkdir -p "$LOGS"
INFO='\033[1;34m'; OK='\033[1;32m'; WARN='\033[1;33m'; ERR='\033[1;31m'; DIM='\033[2m'; NC='\033[0m'
FAILED=()
SKIPPED=()
STARTED_AT=$(date +%s)

say()  { printf "${INFO}▶ %s${NC}\n" "$*"; }
good() { printf "${OK}✓ %s${NC}\n" "$*"; }
warn() { printf "${WARN}! %s${NC}\n" "$*"; }
bad()  { printf "${ERR}✗ %s${NC}\n" "$*"; }

elapsed() {
    local secs=$(( $(date +%s) - $1 ))
    printf '%dm%02ds' $(( secs / 60 )) $(( secs % 60 ))
}

# step <name> <command...>
# Runs one build, logs it, times it, and never aborts the run.
step() {
    local name="$1"; shift
    local log="$LOGS/$name.log"
    local began=$(date +%s)
    printf "${INFO}▶ %-26s${NC}" "$name"
    if "$@" > "$log" 2>&1; then
        printf "${OK}done${NC}  ${DIM}%s${NC}\n" "$(elapsed "$began")"
    else
        printf "${ERR}FAILED${NC} ${DIM}%s — see release-logs/%s.log${NC}\n" "$(elapsed "$began")" "$name"
        FAILED+=("$name")
        # The last few lines are almost always the reason.
        tail -5 "$log" | sed 's/^/      /'
    fi
}

# Skips a step whose artifact is already on disk, for --resume after a crash.
have() {
    [ "$RESUME" -eq 1 ] || return 1
    compgen -G "$1" > /dev/null 2>&1 || return 1
    SKIPPED+=("$2")
    printf "${DIM}· %-26s already built${NC}\n" "$2"
    return 0
}

echo
say "P00RIJA Cryptography — full release build"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
TAG=$(grep -o 'chat-v[0-9]*' index.html | head -1)
echo "  version $VERSION · asset tag $TAG · logs in release-logs/"
echo

# ---------------------------------------------------------------------------
# 0. Refuse to build something inconsistent.
# ---------------------------------------------------------------------------
say "Checking the tree before building anything"
if ! node tools/check-versions.cjs > "$LOGS/00-check-versions.log" 2>&1; then
    bad "version declarations disagree — nothing was built"
    tail -12 "$LOGS/00-check-versions.log" | sed 's/^/      /'
    echo
    echo "  Fix the versions first: every declaration has to say the same thing,"
    echo "  or the packages will disagree with each other about what they are."
    exit 1
fi
good "$(tail -1 "$LOGS/00-check-versions.log" | sed 's/^ *//')"

# The service worker names every asset it precaches, so a script added to
# index.html and not to sw.js is absent offline after each version bump --
# which is the one condition this app exists to work in, and the one a build
# machine with a network never reproduces.
if ! node tools/check-assets.cjs > "$LOGS/00-check-assets.log" 2>&1; then
    bad "the service worker's asset lists do not match index.html — nothing was built"
    tail -14 "$LOGS/00-check-assets.log" | sed 's/^/      /'
    exit 1
fi
good "$(grep -m1 'every script' "$LOGS/00-check-assets.log" | sed 's/^ *//')"

# Two relays live here and only one of them is deployed. Everything added
# after 2.26.95 went into the other, and no suite noticed because every suite
# spawned the other one too -- so a release shipped a phone an Express 404
# page where it expected JSON. A route in one and not in the other stops this.
if ! node tools/check-relay-parity.cjs > "$LOGS/00-check-relay-parity.log" 2>&1; then
    bad "the two relays do not answer the same calls — nothing was built"
    tail -16 "$LOGS/00-check-relay-parity.log" | sed 's/^/      /'
    exit 1
fi
good "$(grep -m1 'both relays' "$LOGS/00-check-relay-parity.log" | sed 's/^ *//')"

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    warn "the working tree has uncommitted changes — they WILL go into these packages"
fi

# ---------------------------------------------------------------------------
# 1. The web payload every native build embeds. Once, before anything else.
# ---------------------------------------------------------------------------
say "Preparing the web payload"
if ! node scripts/prepare-tauri-web.js > "$LOGS/01-prepare.log" 2>&1; then
    bad "could not prepare dist/tauri — nothing else can be built"
    tail -8 "$LOGS/01-prepare.log" | sed 's/^/      /'
    exit 1
fi
good "dist/tauri is $(grep -o 'chat-v[0-9]*' dist/tauri/index.html | head -1)"
echo

# ---------------------------------------------------------------------------
# 2. Desktop.
# ---------------------------------------------------------------------------
say "Desktop"
have "src-tauri/target/universal-apple-darwin/release/bundle/dmg/*$VERSION*.dmg" "macos-universal" \
    || step "macos-universal" bash scripts/build-macos.sh universal
have "src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*$VERSION*.dmg" "macos-arm64" \
    || step "macos-arm64" bash scripts/build-macos.sh arm64
have "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*$VERSION*.exe" "windows-x64" \
    || step "windows-x64" bash scripts/build-windows-docker.sh x86_64
have "src-tauri/target/aarch64-pc-windows-msvc/release/bundle/nsis/*$VERSION*.exe" "windows-arm64" \
    || step "windows-arm64" bash scripts/build-windows-docker.sh arm64
have "src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/*$VERSION*.deb" "linux-x86_64" \
    || step "linux-x86_64" bash scripts/build-native-docker.sh 'npm run native:build:linux:x86_64'
have "src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/deb/*$VERSION*.deb" "linux-arm64" \
    || step "linux-arm64" bash scripts/build-native-docker.sh 'npm run native:build:linux:arm64'
step "linux-portable-x86_64" bash scripts/package-linux-portable.sh x86_64
step "linux-portable-arm64"  bash scripts/package-linux-portable.sh aarch64
echo

# ---------------------------------------------------------------------------
# 3. Mobile.
# ---------------------------------------------------------------------------
if [ "$SKIP_MOBILE" -eq 0 ]; then
    say "Mobile"
    step "android" bash scripts/build-android.sh

    # `tauri ios build` renames its output into place and fails with
    # "Directory not empty (os error 66)" if the previous .app is still there,
    # which then silently ships the OLD build because the zip step finds it.
    rm -rf "src-tauri/gen/apple/build/arm64-sim/P00RIJA Cryptography.app"
    step "ios-simulator" bash -c 'source scripts/mobile-env.sh >/dev/null && npx tauri ios build --target aarch64-sim'
    echo
else
    warn "mobile skipped (--skip-mobile)"
    echo
fi

# ---------------------------------------------------------------------------
# 4. The npm package, built from the same dist/tauri the natives embed.
# ---------------------------------------------------------------------------
say "Package and collect"
step "npm-package" bash scripts/build-npm-package.sh
step "export"      bash scripts/export-artifacts.sh
echo

# ---------------------------------------------------------------------------
# 5. Verification. This is the step that decides whether the build is real.
# ---------------------------------------------------------------------------
say "Verifying"
if bash scripts/verify-artifacts.sh > "$LOGS/99-verify.log" 2>&1; then
    good "$(grep -oE '[0-9]+ checks passed' "$LOGS/99-verify.log" | tail -1)"
else
    bad "verification failed — see release-logs/99-verify.log"
    grep -E 'DIFF|FAIL|MISSING|stale' "$LOGS/99-verify.log" | head -10 | sed 's/^/      /'
    FAILED+=("verify")
fi

if [ -f Export/SHA256SUMS.txt ]; then
    sums_ok=$( (cd Export && shasum -a 256 -c SHA256SUMS.txt 2>/dev/null | grep -c ': OK') )
    sums_bad=$( (cd Export && shasum -a 256 -c SHA256SUMS.txt 2>&1 | grep -c 'FAILED') )
    if [ "$sums_bad" -eq 0 ]; then
        good "$sums_ok checksums verified"
    else
        bad "$sums_bad checksum(s) do not match"
        FAILED+=("checksums")
    fi
fi
echo

# ---------------------------------------------------------------------------
# Summary.
# ---------------------------------------------------------------------------
say "Export/"
if [ -d Export ]; then
    find Export -type f \( -name '*.dmg' -o -name '*.exe' -o -name '*.deb' -o -name '*.rpm' \
        -o -name '*.AppImage' -o -name '*.zst' -o -name '*.apk' -o -name '*.aab' \
        -o -name '*.zip' -o -name '*.tar.gz' \) -exec ls -lh {} \; 2>/dev/null \
        | awk '{printf "  %-8s %s\n", $5, $NF}' | sed "s|Export/||" | sort -k2
    echo "  ───"
    echo "  $(find Export -type f | wc -l | tr -d ' ') files, $(du -sh Export 2>/dev/null | cut -f1) total"
fi
echo

printf "${DIM}took %s${NC}\n" "$(elapsed "$STARTED_AT")"
if [ ${#SKIPPED[@]} -gt 0 ]; then
    printf "${DIM}resumed past: %s${NC}\n" "${SKIPPED[*]}"
fi
if [ ${#FAILED[@]} -gt 0 ]; then
    bad "${#FAILED[@]} step(s) failed: ${FAILED[*]}"
    echo "  Each one's output is in release-logs/. Re-run with --resume to keep"
    echo "  what already built and retry only what did not."
    exit 1
fi
good "every platform built, collected and verified"
