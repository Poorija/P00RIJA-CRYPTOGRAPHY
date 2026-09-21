#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Builds the "generic Linux binary" tarball from an existing Tauri Linux build.
#
#   bash scripts/package-linux-portable.sh x86_64|arm64
#
# The .deb, .rpm and pacman packages each carry a distro's own dependency
# metadata; the AppImage carries its dependencies inside it. This is the fourth
# option people expect: the plain binary plus its desktop entry and icons, with
# an installer that drops them into ~/.local so it needs no root. It relies on
# the host having WebKitGTK 4.1, which the install script checks for rather
# than letting the app fail with a linker error at first launch.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARCH="${1:-x86_64}"
case "$ARCH" in
    x86_64) RUST_TARGET="x86_64-unknown-linux-gnu" ;;
    arm64|aarch64) RUST_TARGET="aarch64-unknown-linux-gnu"; ARCH="aarch64" ;;
    *) echo "usage: $0 x86_64|arm64" >&2; exit 2 ;;
esac

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
BIN="src-tauri/target/$RUST_TARGET/release/p00rija-cryptography"
if [ ! -f "$BIN" ]; then
    echo "No Linux binary at $BIN — run the Linux build for $ARCH first." >&2
    exit 1
fi

NAME="p00rija-cryptography-$VERSION-linux-$ARCH"
OUT="src-tauri/target/$RUST_TARGET/release/bundle/portable"
STAGE="$OUT/$NAME"
rm -rf "$STAGE"
mkdir -p "$STAGE/bin" "$STAGE/share/icons" "$STAGE/share/applications"

cp "$BIN" "$STAGE/bin/p00rija-cryptography"
chmod +x "$STAGE/bin/p00rija-cryptography"

for size in 32x32 128x128 256x256@2; do
    src="src-tauri/target/$RUST_TARGET/release/bundle/deb/data/usr/share/icons/hicolor/$size/apps/p00rija-cryptography.png"
    [ -f "$src" ] && cp "$src" "$STAGE/share/icons/p00rija-cryptography-$size.png"
done
cp src-tauri/icons/128x128.png "$STAGE/share/icons/p00rija-cryptography.png" 2>/dev/null || true

cat > "$STAGE/share/applications/p00rija-cryptography.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=P00RIJA Cryptography
Comment=Native client-side encryption suite
Exec=p00rija-cryptography
Icon=p00rija-cryptography
Terminal=false
Categories=Utility;Security;
StartupWMClass=p00rija-cryptography
DESKTOP

cat > "$STAGE/install.sh" <<'INSTALL'
#!/usr/bin/env sh
# Installs into ~/.local, so no root and nothing outside your home directory.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX="${PREFIX:-$HOME/.local}"

missing=""
for lib in libwebkit2gtk-4.1.so.0 libgtk-3.so.0; do
    if ! (ldconfig -p 2>/dev/null | grep -q "$lib"); then
        missing="$missing $lib"
    fi
done
if [ -n "$missing" ]; then
    echo "Missing system libraries:$missing"
    echo
    echo "  Debian/Ubuntu : sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1"
    echo "  Fedora/RHEL   : sudo dnf install webkit2gtk4.1 gtk3 libappindicator-gtk3"
    echo "  Arch          : sudo pacman -S webkit2gtk-4.1 gtk3 libayatana-appindicator"
    echo
    echo "Install those first — the app cannot start without them."
    exit 1
fi

mkdir -p "$PREFIX/bin" "$PREFIX/share/applications" "$PREFIX/share/icons/hicolor/128x128/apps"
cp "$HERE/bin/p00rija-cryptography" "$PREFIX/bin/"
chmod +x "$PREFIX/bin/p00rija-cryptography"
cp "$HERE/share/applications/p00rija-cryptography.desktop" "$PREFIX/share/applications/"
[ -f "$HERE/share/icons/p00rija-cryptography.png" ] && \
    cp "$HERE/share/icons/p00rija-cryptography.png" "$PREFIX/share/icons/hicolor/128x128/apps/"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$PREFIX/share/applications" 2>/dev/null || true

echo "Installed to $PREFIX/bin/p00rija-cryptography"
case ":$PATH:" in
    *":$PREFIX/bin:"*) ;;
    *) echo "Note: $PREFIX/bin is not on your PATH." ;;
esac
INSTALL
chmod +x "$STAGE/install.sh"

cat > "$STAGE/uninstall.sh" <<'UNINSTALL'
#!/usr/bin/env sh
set -eu
PREFIX="${PREFIX:-$HOME/.local}"
rm -f "$PREFIX/bin/p00rija-cryptography"
rm -f "$PREFIX/share/applications/p00rija-cryptography.desktop"
rm -f "$PREFIX/share/icons/hicolor/128x128/apps/p00rija-cryptography.png"
echo "Removed. Your data in ~/.local/share/com.p00rija.cryptography was left alone."
UNINSTALL
chmod +x "$STAGE/uninstall.sh"

cat > "$STAGE/README.txt" <<README
P00RIJA Cryptography $VERSION — portable Linux build ($ARCH)

  ./install.sh          install into ~/.local (no root)
  ./bin/p00rija-cryptography    or just run it from here

Needs WebKitGTK 4.1 and GTK 3 on the system; install.sh checks and tells you
the package names for your distro. For the tray icon on GNOME you also need
the "AppIndicator and KStatusNotifierItem Support" extension — without it the
app quits when you close the window instead of hiding.

Everything the app stores lives in ~/.local/share/com.p00rija.cryptography.
README

tar -C "$OUT" -czf "$OUT/$NAME.tar.gz" "$NAME"
rm -rf "$STAGE"
echo "Portable tarball: $OUT/$NAME.tar.gz  ($(du -h "$OUT/$NAME.tar.gz" | cut -f1))"
