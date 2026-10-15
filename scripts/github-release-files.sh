#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# The files a GitHub release is made of, in one folder, with the checksum list
# a person who downloads them can actually check against.
#
#   bash scripts/github-release-files.sh                    # this tree's version
#   bash scripts/github-release-files.sh 2.98.43            # another version in Export/
#   bash scripts/github-release-files.sh --allow-missing    # a partial build is not an error
#
# Run at the end of release-all.sh; on its own for packages built already.
#
# Export/SHA256SUMS.txt is the manifest of Export/ itself and cannot be the
# release's: its lines carry folders ("./macOS/…") that a download never has,
# names with spaces that GitHub turns into dots on upload ("P00RIJA
# Cryptography_…" becomes "P00RIJA.Cryptography_…"), and files that are not
# released at all (the .aab, the notes, COMMIT.txt). Checked against a
# Downloads folder it matched nothing, so it was never uploaded, and the
# release had no checksums while INSTALL.md told people to verify against them.
#
# Export/GitHub/ holds exactly what is uploaded — every installer and package,
# named as GitHub will name it — and SHA256SUMS.txt beside them, so after a
# download this works as it reads:
#
#   shasum -a 256 -c SHA256SUMS.txt --ignore-missing
#
# The files are hard links to the ones in Export/ (a copy where a link cannot
# be made), so the folder costs no space. It is rebuilt from scratch every run.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION=""
ALLOW_MISSING=0
for arg in "$@"; do
    case "$arg" in
        --allow-missing) ALLOW_MISSING=1 ;;
        -*) echo "usage: $0 [version] [--allow-missing]" >&2; exit 2 ;;
        *) VERSION="$arg" ;;
    esac
done
[ -n "$VERSION" ] || VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
EXPORT="Export"
OUT="$EXPORT/GitHub"
INFO='\033[1;34m'; SUCCESS='\033[1;32m'; WARN='\033[1;33m'; ERROR='\033[1;31m'; DIM='\033[2m'; NC='\033[0m'

if [ ! -d "$EXPORT" ]; then
    printf "${ERROR}No %s/ — run scripts/export-artifacts.sh (or release-all.sh) first.${NC}\n" "$EXPORT" >&2
    exit 1
fi

# What a release is made of, by where export-artifacts.sh puts it. One line per
# kind; a kind that matches nothing is named at the end as missing.
KINDS=(
    "macOS (Apple silicon)|macOS|*_${VERSION}_aarch64.dmg"
    "macOS (universal)|macOS|*_${VERSION}_universal.dmg"
    "Windows (x64)|Windows|*_${VERSION}_x64-setup.exe"
    "Windows (ARM)|Windows|*_${VERSION}_arm64-setup.exe"
    "Android|Android|*-${VERSION}-universal.apk"
    "Debian (x86-64)|Linux/Debian|*_${VERSION}_amd64.deb"
    "Debian (ARM)|Linux/Debian|*_${VERSION}_arm64.deb"
    "Red Hat (x86-64)|Linux/RedHat|*-${VERSION}-1.x86_64.rpm"
    "Red Hat (ARM)|Linux/RedHat|*-${VERSION}-1.aarch64.rpm"
    "AppImage (x86-64)|Linux/AppImage|*_${VERSION}_amd64.AppImage"
    "AppImage (ARM)|Linux/AppImage|*_${VERSION}_aarch64.AppImage"
    "Arch (x86-64)|Linux/Arch|*-${VERSION}-1-x86_64.pkg.tar.zst"
    "Arch (ARM)|Linux/Arch|*-${VERSION}-1-aarch64.pkg.tar.zst"
    "Portable Linux (x86-64)|Linux/Portable|*-${VERSION}-linux-x86_64.tar.gz"
    "Portable Linux (ARM)|Linux/Portable|*-${VERSION}-linux-aarch64.tar.gz"
    "Source|Source|*-${VERSION}-source.tar.gz"
)

# GitHub's own renaming of an uploaded asset: a space becomes a dot. Every
# other character these names use (letters, digits, . _ -) is kept as it is.
github_name() {
    printf '%s' "$1" | tr ' ' '.'
}

# Built beside the old one and swapped in only when it is complete: a run
# that finds nothing must not take away the folder a previous run made.
STAGE="$OUT.new"
rm -rf "$STAGE"
mkdir -p "$STAGE"

missing=()
names=()
for kind in "${KINDS[@]}"; do
    label="${kind%%|*}"
    rest="${kind#*|}"
    dir="${rest%%|*}"
    pattern="${rest#*|}"
    found=""
    while IFS= read -r -d '' file; do
        found="$file"
        break
    done < <(find "$EXPORT/$dir" -maxdepth 1 -type f -name "$pattern" -print0 2>/dev/null)
    if [ -z "$found" ]; then
        missing+=("$label  ($dir/$pattern)")
        continue
    fi
    name="$(github_name "$(basename "$found")")"
    ln -f "$found" "$STAGE/$name" 2>/dev/null || cp -p "$found" "$STAGE/$name"
    names+=("$name")
done

if [ "${#names[@]}" -eq 0 ]; then
    printf "${ERROR}Nothing for %s in %s/ — has this version been built and exported?${NC}\n" "$VERSION" "$EXPORT" >&2
    rm -rf "$STAGE"
    exit 1
fi

# Sorted by name, two spaces between hash and name: the format shasum -c reads
# and the one sha256sum -c reads too.
( cd "$STAGE" && printf '%s\0' "${names[@]}" | sort -z | xargs -0 shasum -a 256 > SHA256SUMS.txt )

# Checked here, the way somebody who downloaded them will check them.
if ! ( cd "$STAGE" && shasum -a 256 -c SHA256SUMS.txt > /dev/null 2>&1 ); then
    printf "${ERROR}SHA256SUMS.txt does not verify against the files beside it.${NC}\n" >&2
    rm -rf "$STAGE"
    exit 1
fi
rm -rf "$OUT"
mv "$STAGE" "$OUT"

printf "${INFO}%s release files for %s in %s/${NC}\n" "${#names[@]}" "$VERSION" "$OUT"
( cd "$OUT" && ls -lh -- "${names[@]}" | awk '{ name = $9; for (i = 10; i <= NF; i++) name = name " " $i; printf "  %-7s %s\n", $5, name }' )
printf "${SUCCESS}  SHA256SUMS.txt — %s lines, verified${NC}\n" "$(wc -l < "$OUT/SHA256SUMS.txt" | tr -d ' ')"
if [ "${#missing[@]}" -gt 0 ]; then
    printf "${WARN}Not in %s/ (not built, or not exported):${NC}\n" "$EXPORT"
    for item in "${missing[@]}"; do printf "${DIM}  %s${NC}\n" "$item"; done
    [ "$ALLOW_MISSING" -eq 1 ] || exit 2
fi
printf "${DIM}Upload everything in %s/ to the release, SHA256SUMS.txt included.${NC}\n" "$OUT"
