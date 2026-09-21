#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# ---------------------------------------------------------------------------
# P00RIJA Cryptography — one-line server install.
#
#   curl -fsSL https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/quick-install.sh | bash
#   curl -fsSL .../quick-install.sh | bash -s -- --domain chat.example.com --letsencrypt --email you@example.com
#
# Clones (or updates) the repository, checks the prerequisites, and hands over
# to scripts/setup.sh --quick, which does the actual work. Everything here is
# about getting to that point safely from a bare machine.
#
# Piping a script from the internet into a shell deserves the caution it gets:
# read this file first, or clone the repository and run scripts/setup.sh
# yourself. Nothing below needs to be run as root except the package install,
# and it asks sudo for exactly that.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="${POORIJA_REPO:-https://github.com/Poorija/P00RIJA-CRYPTOGRAPHY.git}"
BRANCH="${POORIJA_BRANCH:-main}"
TARGET="${POORIJA_DIR:-$HOME/p00rija-cryptography}"

INFO='\033[1;34m'; OK='\033[1;32m'; WARN='\033[1;33m'; ERR='\033[1;31m'; NC='\033[0m'
step() { printf "${INFO}▶ %s${NC}\n" "$1"; }
ok()   { printf "${OK}✓ %s${NC}\n" "$1"; }
warn() { printf "${WARN}⚠ %s${NC}\n" "$1"; }
die()  { printf "${ERR}✗ %s${NC}\n" "$1" >&2; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }

case "$(uname -s)" in
    Linux)  ;;
    Darwin) warn "macOS hosts a server fine for testing, but the deployment targets Linux." ;;
    *) die "Unsupported host: $(uname -s). Install on Linux, or use the desktop app instead." ;;
esac

# ---- prerequisites --------------------------------------------------------
step "Checking prerequisites"
missing=()
has git || missing+=(git)
has openssl || missing+=(openssl)
has curl || missing+=(curl)
if ! has docker; then
    missing+=(docker)
fi

if [ ${#missing[@]} -gt 0 ]; then
    warn "Missing: ${missing[*]}"
    if has apt-get; then
        step "Installing them with apt"
        sudo apt-get update -qq
        sudo apt-get install -y git openssl curl ca-certificates
        if ! has docker; then
            # Docker's own convenience script, not a distro package: the
            # versions in Debian and Ubuntu are usually too old for the
            # compose plugin this project needs.
            step "Installing Docker Engine"
            curl -fsSL https://get.docker.com | sudo sh
            sudo usermod -aG docker "$USER" || true
            warn "You were added to the 'docker' group — log out and back in if the next step says permission denied."
        fi
    elif has dnf; then
        sudo dnf install -y git openssl curl ca-certificates
        has docker || { curl -fsSL https://get.docker.com | sudo sh; sudo usermod -aG docker "$USER" || true; }
        sudo systemctl enable --now docker || true
    elif has pacman; then
        sudo pacman -Sy --noconfirm git openssl curl docker docker-compose
        sudo systemctl enable --now docker || true
    else
        die "Install these first, then run this again: ${missing[*]}"
    fi
fi

docker compose version >/dev/null 2>&1 || docker-compose version >/dev/null 2>&1 \
    || die "Docker Compose is not available. Install the compose plugin and try again."
docker info >/dev/null 2>&1 || die "Docker is installed but not reachable. Start it (sudo systemctl start docker) or re-login for the group change to apply."
ok "Prerequisites are in place"

# ---- source ---------------------------------------------------------------
if [ -d "$TARGET/.git" ]; then
    step "Updating the existing checkout at $TARGET"
    git -C "$TARGET" fetch --depth 1 origin "$BRANCH"
    git -C "$TARGET" reset --hard "origin/$BRANCH"
else
    [ -e "$TARGET" ] && die "$TARGET exists and is not a git checkout. Move it, or set POORIJA_DIR."
    step "Cloning into $TARGET"
    git clone --depth 1 --branch "$BRANCH" "$REPO" "$TARGET"
fi
ok "Source ready"

cd "$TARGET"
chmod +x scripts/*.sh 2>/dev/null || true

# ---- hand over ------------------------------------------------------------
step "Running the unattended installer"
exec bash scripts/setup.sh --quick "$@"
