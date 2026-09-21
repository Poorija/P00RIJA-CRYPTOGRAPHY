#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Builds the Linux client inside a container, so a macOS or Windows machine can
# produce .deb / .rpm / .AppImage without a Linux box.
#
#   bash scripts/build-native-docker.sh                                  # x86_64 client
#   bash scripts/build-native-docker.sh 'npm run native:build:linux:arm64'
#
# On Apple Silicon an x86_64 build runs under emulation and takes a long time;
# an arm64 build is native and is the one to use for a quick check.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INFO='\033[1;34m'
SUCCESS='\033[1;32m'
WARN='\033[1;33m'
ERROR='\033[1;31m'
NC='\033[0m'

log_step() { printf "${INFO}▶ %s${NC}\n" "$1"; }
log_ok()   { printf "${SUCCESS}✓ %s${NC}\n" "$1"; }
log_warn() { printf "${WARN}! %s${NC}\n" "$1"; }
log_err()  { printf "${ERROR}✖ %s${NC}\n" "$1"; }

if ! command -v docker >/dev/null 2>&1; then
    log_err "Docker is not installed or not in PATH."
    exit 1
fi
if ! docker info >/dev/null 2>&1; then
    log_err "Docker is installed but the daemon is not running."
    exit 1
fi

DOCKERFILE="config/Dockerfile.builder-linux"
IMAGE_BASE="poorija-tauri-builder"
BUILD_CMD="${1:-npm run native:build:linux:x86_64}"

# Which product is being built decides where the artifacts land and what the
# binary is called.
PRODUCT="native"
case "$BUILD_CMD" in
    *monitor*) PRODUCT="monitor" ;;
esac

DOCKER_PLATFORM="linux/amd64"
ARCH_SUFFIX="amd64"
RUST_TARGET="x86_64-unknown-linux-gnu"
ARCH_NAME="x86_64"
case "$BUILD_CMD" in
    *arm64*|*aarch64*)
        DOCKER_PLATFORM="linux/arm64"
        ARCH_SUFFIX="arm64"
        RUST_TARGET="aarch64-unknown-linux-gnu"
        ARCH_NAME="aarch64"
        ;;
esac
IMAGE_NAME="$IMAGE_BASE:$ARCH_SUFFIX"

# Version comes from the config that the bundle itself is stamped with. It used
# to be hard-coded as 2.99.0 here, so every Arch package claimed a version the
# rest of the release did not have.
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version" 2>/dev/null)"
if [ -z "$VERSION" ]; then
    log_err "Could not read the version out of src-tauri/tauri.conf.json."
    exit 1
fi

HOST_ARCH="$(uname -m)"
if { [ "$ARCH_SUFFIX" = "amd64" ] && [ "$HOST_ARCH" = "arm64" ]; } ||
   { [ "$ARCH_SUFFIX" = "arm64" ] && [ "$HOST_ARCH" = "x86_64" ]; }; then
    log_warn "Building $ARCH_SUFFIX on a $HOST_ARCH host runs under emulation — expect this to take a while."
fi

log_step "Preparing the builder image ($IMAGE_NAME) for $DOCKER_PLATFORM"
if ! docker build --platform "$DOCKER_PLATFORM" -t "$IMAGE_NAME" -f "$DOCKERFILE" .; then
    log_err "Building the builder image failed."
    exit 1
fi

# node_modules gets a container-local volume. The project directory itself is
# bind-mounted, so an `npm install` inside the container would otherwise write
# Linux platform binaries straight into the tree the host builds from.
log_step "Running in the container: $BUILD_CMD"
docker run --rm \
    --privileged \
    --platform "$DOCKER_PLATFORM" \
    -v "$ROOT:/app" \
    -v "poorija_cargo_registry_$ARCH_SUFFIX:/root/.cargo/registry" \
    -v "poorija_npm_cache_$ARCH_SUFFIX:/root/.npm" \
    -v "poorija_node_modules_$ARCH_SUFFIX:/app/node_modules" \
    -e "CI=true" \
    -e "APPIMAGE_EXTRACT_AND_RUN=1" \
    -e "NO_STRIP=1" \
    "$IMAGE_NAME" \
    "set -e; npm install --no-audit --no-fund; $BUILD_CMD"
status=$?

# `set -e` used to abort this script the moment the container returned
# non-zero, so the reporting below never ran and a failed build looked silent.
if [ "$status" -ne 0 ]; then
    log_err "The container build failed with status $status."
    exit "$status"
fi

BUNDLE_DIR="src-tauri/target/$RUST_TARGET/release/bundle"
if [ ! -d "$BUNDLE_DIR" ]; then
    log_err "No bundle directory at $BUNDLE_DIR — the build produced nothing."
    exit 1
fi

log_step "Building the Arch package"
if [ "$PRODUCT" = "monitor" ]; then
    BIN_NAME="P00RIJA Server Monitor"
    PKG_NAME="p00rija-server-monitor"
    PKG_DESC="P00RIJA Server Monitor native client"
else
    BIN_NAME="p00rija-cryptography"
    PKG_NAME="p00rija-cryptography"
    PKG_DESC="P00RIJA Cryptography native client"
fi

BIN_PATH="src-tauri/target/$RUST_TARGET/release/$BIN_NAME"
if [ ! -f "$BIN_PATH" ]; then
    log_warn "No binary at $BIN_PATH — skipping the Arch package."
else
    PKG_DIR="$BUNDLE_DIR/arch"
    rm -rf "$PKG_DIR"
    mkdir -p "$PKG_DIR/usr/bin"
    cp "$BIN_PATH" "$PKG_DIR/usr/bin/$PKG_NAME"
    # The package used to be the binary and nothing else, so on Arch the app
    # installed but never appeared in the application menu and had no icon.
    # Tauri already writes a .desktop entry and the icon set for the .deb and
    # leaves the tree unpacked beside it — take them from there rather than
    # keeping a second copy in the repository that could drift.
    DEB_DATA="$(find "$BUNDLE_DIR/deb" -maxdepth 2 -type d -name data 2>/dev/null | head -1)"
    if [ -n "$DEB_DATA" ] && [ -d "$DEB_DATA/usr/share" ]; then
        mkdir -p "$PKG_DIR/usr/share"
        cp -R "$DEB_DATA/usr/share/." "$PKG_DIR/usr/share/"
        log_ok "Arch package carries the desktop entry and icons"
    else
        log_warn "No unpacked .deb tree found — the Arch package will be binary-only."
    fi
    {
        echo "pkgname = $PKG_NAME"
        echo "pkgver = $VERSION"
        echo "pkgrel = 1"
        echo "pkgdesc = $PKG_DESC"
        echo "url = https://github.com/Poorija/P00RIJA-CRYPTOGRAPHY"
        echo "arch = $ARCH_NAME"
        echo "license = GPL3"
        echo "depend = webkit2gtk-4.1"
        echo "depend = libayatana-appindicator"
        echo "depend = gtk3"
    } > "$PKG_DIR/.PKGINFO"
    ( cd "$PKG_DIR" && tar --zstd -cf "../$PKG_NAME-$VERSION-1-$ARCH_NAME.pkg.tar.zst" .PKGINFO usr )
    log_ok "Arch package: $BUNDLE_DIR/$PKG_NAME-$VERSION-1-$ARCH_NAME.pkg.tar.zst"
fi

echo
log_step "Artifacts"
found=0
for pattern in "$BUNDLE_DIR/deb/"*.deb "$BUNDLE_DIR/rpm/"*.rpm "$BUNDLE_DIR/appimage/"*.AppImage "$BUNDLE_DIR/"*.pkg.tar.zst; do
    [ -e "$pattern" ] || continue
    found=1
    printf "  %-14s %s\n" "$(du -h "$pattern" | cut -f1)" "$pattern"
done
if [ "$found" -eq 0 ]; then
    log_err "The build reported success but produced no packages."
    exit 1
fi
log_ok "Linux build finished for $ARCH_NAME."
