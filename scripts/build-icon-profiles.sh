#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Renders the desktop icon profiles from SVG to the PNGs the Rust side embeds.
#
#   bash scripts/build-icon-profiles.sh
#
# The PNGs are committed so a build machine needs no rasteriser. Run this after
# editing anything in assets/desktop-icons/, and commit what it produces.
#
# WHY THEY EXIST
# --------------
# The settings panel offers seven icon profiles, four of which are deliberately
# unremarkable — a folder, a notes app, a terminal, a settings panel. Their
# whole purpose is that a glance at somebody's taskbar does not say "encryption
# app". Before this, the Rust side knew about three profiles and pointed two of
# them at the app's ordinary icons, so all four low-attention profiles silently
# fell back to the default and the feature did nothing.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v magick >/dev/null 2>&1; then
    echo "ImageMagick is needed: brew install imagemagick" >&2
    exit 1
fi

mkdir -p src-tauri/icons/profiles
for svg in assets/desktop-icons/*.svg; do
    name="$(basename "$svg" .svg)"
    magick -background none -density 512 "$svg" -resize 256x256 \
        "src-tauri/icons/profiles/$name.png"
    printf '  %-20s %s\n' "$name" "$(identify -format '%wx%h' "src-tauri/icons/profiles/$name.png")"
done
echo "Rendered $(ls -1 src-tauri/icons/profiles/*.png | wc -l | tr -d ' ') icon profiles."
