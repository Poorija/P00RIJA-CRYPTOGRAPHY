#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Collects everything that was built into Export/, one directory per platform.
#
#   bash scripts/export-artifacts.sh
#
# Copies rather than moves, so a re-run after rebuilding one platform refreshes
# just that platform and leaves the rest alone. Whatever has not been built yet
# is skipped and named in the summary, so a partial export is obvious rather
# than looking complete.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
EXPORT="Export"
DESKTOP_ONLY=0
case "${1:-}" in
    --desktop-only) DESKTOP_ONLY=1 ;;
    "") ;;
    *) echo "usage: $0 [--desktop-only]" >&2; exit 2 ;;
esac
INFO='\033[1;34m'; SUCCESS='\033[1;32m'; DIM='\033[2m'; NC='\033[0m'

copied=0
missing=()

# Builds from earlier versions go before this one is collected.
#
# Export/ is what somebody hands to another person, and a directory holding
# 2.99.90 beside 2.100.14 does not say which is which — it says "pick one".
# Worse, SHA256SUMS.txt then lists both and stops being a manifest of a
# release. Only installers are swept: the READMEs and the mobile build notes
# have no version in their names and are rewritten every run anyway.
sweep_old() {
    [ -d "$EXPORT" ] || return 0
    local removed=0
    local roots=("$EXPORT")
    if [ "$DESKTOP_ONLY" -eq 1 ]; then
        roots=("$EXPORT/macOS" "$EXPORT/Windows" "$EXPORT/Linux")
    fi
    while IFS= read -r -d '' old_file; do
        case "$old_file" in
            *"$VERSION"*) continue ;;
        esac
        rm -f "$old_file"
        removed=$((removed + 1))
    done < <(find "${roots[@]}" -type f \
        \( -name '*.dmg' -o -name '*.exe' -o -name '*.deb' -o -name '*.rpm' \
           -o -name '*.AppImage' -o -name '*.pkg.tar.zst' -o -name '*.tar.gz' \
           -o -name '*.apk' -o -name '*.aab' -o -name '*.zip' \) -print0)
    [ "$removed" -gt 0 ] && printf "${DIM}  cleared %d installer(s) from earlier versions${NC}\n" "$removed"
    return 0
}
if [ "$DESKTOP_ONLY" -eq 0 ]; then sweep_old; fi

take() {
    local dest="$1"; shift
    for src in "$@"; do
        if [ -e "$src" ]; then
            mkdir -p "$EXPORT/$dest"
            cp -f "$src" "$EXPORT/$dest/"
            printf "  %-7s %-22s %s\n" "$(du -h "$src" | cut -f1)" "$dest" "$(basename "$src")"
            copied=$((copied + 1))
        else
            missing+=("$dest/$(basename "$src")")
        fi
    done
}

printf "${INFO}Collecting build %s into %s/${NC}\n\n" "$VERSION" "$EXPORT"

T=src-tauri/target

take "macOS"            "$T/universal-apple-darwin/release/bundle/dmg/P00RIJA Cryptography_${VERSION}_universal.dmg" \
                        "$T/aarch64-apple-darwin/release/bundle/dmg/P00RIJA Cryptography_${VERSION}_aarch64.dmg"

take "Windows"          "$T/x86_64-pc-windows-msvc/release/bundle/nsis/P00RIJA Cryptography_${VERSION}_x64-setup.exe" \
                        "$T/aarch64-pc-windows-msvc/release/bundle/nsis/P00RIJA Cryptography_${VERSION}_arm64-setup.exe"

take "Linux/Debian"     "$T/x86_64-unknown-linux-gnu/release/bundle/deb/P00RIJA Cryptography_${VERSION}_amd64.deb" \
                        "$T/aarch64-unknown-linux-gnu/release/bundle/deb/P00RIJA Cryptography_${VERSION}_arm64.deb"

take "Linux/RedHat"     "$T/x86_64-unknown-linux-gnu/release/bundle/rpm/P00RIJA Cryptography-${VERSION}-1.x86_64.rpm" \
                        "$T/aarch64-unknown-linux-gnu/release/bundle/rpm/P00RIJA Cryptography-${VERSION}-1.aarch64.rpm"

# Tauri emits the Arch package alongside the rpm.
#
# It is not selectable by name — `--bundles` accepts only deb, rpm and appimage
# and refuses `pacman` outright — but asking for rpm produces a .pkg.tar.zst in
# the bundle root as well. That is why this line looks for it there rather than
# in a pacman/ subdirectory, and why nothing in package.json mentions it.
take "Linux/Arch"       "$T/x86_64-unknown-linux-gnu/release/bundle/p00rija-cryptography-${VERSION}-1-x86_64.pkg.tar.zst" \
                        "$T/aarch64-unknown-linux-gnu/release/bundle/p00rija-cryptography-${VERSION}-1-aarch64.pkg.tar.zst"

take "Linux/AppImage"   "$T/x86_64-unknown-linux-gnu/release/bundle/appimage/P00RIJA Cryptography_${VERSION}_amd64.AppImage" \
                        "$T/aarch64-unknown-linux-gnu/release/bundle/appimage/P00RIJA Cryptography_${VERSION}_aarch64.AppImage"

take "Linux/Portable"   "$T/x86_64-unknown-linux-gnu/release/bundle/portable/p00rija-cryptography-${VERSION}-linux-x86_64.tar.gz" \
                        "$T/aarch64-unknown-linux-gnu/release/bundle/portable/p00rija-cryptography-${VERSION}-linux-aarch64.tar.gz"

if [ "$DESKTOP_ONLY" -eq 0 ]; then
take "Android"          "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk" \
                        "src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab"
# Whether that APK holds one architecture or all four depends on how it was
# built (`--target aarch64` versus not), so the name it gets here is decided by
# what is actually inside it rather than by which command ran last.
if [ -f "$EXPORT/Android/app-universal-release.apk" ]; then
    abis="$(unzip -l "$EXPORT/Android/app-universal-release.apk" 2>/dev/null | awk '/lib\//{print $4}' | cut -d/ -f2 | sort -u | wc -l | tr -d ' ')"
    if [ "${abis:-1}" -gt 1 ]; then
        keep="P00RIJA-Cryptography-${VERSION}-universal.apk"
        drop="P00RIJA-Cryptography-${VERSION}-arm64.apk"
    else
        keep="P00RIJA-Cryptography-${VERSION}-arm64.apk"
        drop="P00RIJA-Cryptography-${VERSION}-universal.apk"
    fi
    mv -f "$EXPORT/Android/app-universal-release.apk" "$EXPORT/Android/$keep"
    # The two names come from the same build slot, so only one of them can be
    # current. An earlier run under the other name is left behind by the move
    # and then sits in Export/ looking like a deliverable while carrying older
    # code — which is exactly what happened once. Take it out.
    if [ -f "$EXPORT/Android/$drop" ]; then
        rm -f "$EXPORT/Android/$drop"
        printf "  %-6s %-22s %s\n" "drop" "Android" "$drop (stale — this build produced $keep)"
    fi
fi

# The simulator build is the only iOS artifact that exists without a signing
# identity, and it is a directory, so it goes in as an archive.
IOS_APP="src-tauri/gen/apple/build/arm64-sim/P00RIJA Cryptography.app"
if [ -d "$IOS_APP" ]; then
    mkdir -p "$EXPORT/iOS"
    ( cd "$(dirname "$IOS_APP")" && zip -qry "$ROOT/$EXPORT/iOS/P00RIJA-Cryptography-${VERSION}-iOS-Simulator.app.zip" "$(basename "$IOS_APP")" )
    printf "  %-7s %-22s %s\n" \
        "$(du -h "$EXPORT/iOS/P00RIJA-Cryptography-${VERSION}-iOS-Simulator.app.zip" | cut -f1)" \
        "iOS" "P00RIJA-Cryptography-${VERSION}-iOS-Simulator.app.zip"
    copied=$((copied + 1))
else
    missing+=("iOS/simulator build")
fi

# Rename the Android outputs to something a person can identify on a phone.
[ -f "$EXPORT/Android/app-universal-release.aab" ] && \
    mv -f "$EXPORT/Android/app-universal-release.aab" "$EXPORT/Android/P00RIJA-Cryptography-${VERSION}.aab"

fi # mobile exports

# The source, as git has it.
#
# Every binary above is unsigned or ad-hoc signed, which means nobody
# downloading one can check what went into it. The archive is the answer to
# that: it is `git archive` of the exact commit the binaries were built from,
# so anyone can read the source, rebuild it, and compare.
#
# git archive rather than `tar` of the directory, deliberately — it emits only
# what is COMMITTED, so node_modules, dist/, Export/, and the three things that
# must never leave this machine (.env, certs/, data/ with the Web Push private
# key in it) cannot end up inside it by accident. A tar of the working tree
# would depend on remembering every exclusion, and a forgotten one ships a key.
if [ "$DESKTOP_ONLY" -eq 0 ]; then
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 && git -C "$ROOT" rev-parse HEAD >/dev/null 2>&1; then
    mkdir -p "$EXPORT/Source"
    src_archive="$EXPORT/Source/p00rija-cryptography-${VERSION}-source.tar.gz"
    commit="$(git -C "$ROOT" rev-parse --short HEAD)"
    if git -C "$ROOT" archive --format=tar --prefix="p00rija-cryptography-${VERSION}/" HEAD         | gzip -9 > "$src_archive" 2>/dev/null; then
        # The commit it came from, next to it — a tarball with no provenance is
        # just a folder.
        printf '%s\n' "$commit" > "$EXPORT/Source/COMMIT.txt"
        # A dirty tree means the archive is NOT what was built. Say so here
        # rather than letting somebody find out by diffing.
        if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then
            printf 'NOTE: the working tree had uncommitted changes when this was exported,\nso the binaries may not match this source exactly.\n' \
                >> "$EXPORT/Source/COMMIT.txt"
        fi
        printf "  %-7s %-22s %s\n" "$(du -h "$src_archive" | cut -f1)" "Source" "$(basename "$src_archive") @ $commit"
        copied=$((copied + 1))
    else
        missing+=("Source/source archive")
    fi
else
    missing+=("Source/source archive (no commit to archive)")
fi

fi # source export

if [ "$DESKTOP_ONLY" -eq 1 ]; then
    if [ "${#missing[@]}" -gt 0 ]; then
        printf 'Desktop export is incomplete; old installers were preserved.\n' >&2
        printf '  %s\n' "${missing[@]}" >&2
        exit 1
    fi
    sweep_old
fi

# Checksums, so a file that arrives corrupted after a transfer can be told
# apart from one that was built wrong.
# Finder writes .DS_Store into any directory it is shown, and it was ending up
# both in Export/ and in the manifest — a checksum line for a file that is not
# part of the release and changes every time the folder is opened.
find "$EXPORT" -name '.DS_Store' -delete 2>/dev/null
( cd "$EXPORT" && find . -type f ! -name SHA256SUMS.txt ! -name '.DS_Store' -print0 \
    | sort -z | xargs -0 shasum -a 256 > SHA256SUMS.txt )

echo
if [ "${#missing[@]}" -gt 0 ]; then
    printf "${DIM}Not built yet:${NC}\n"
    for m in "${missing[@]}"; do printf "${DIM}  %s${NC}\n" "$m"; done
    echo
fi
printf "${SUCCESS}%d files in %s/ — %s total${NC}\n" "$copied" "$EXPORT" "$(du -sh "$EXPORT" | cut -f1)"
