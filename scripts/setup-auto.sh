#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# P00RIJA Cryptography Unified Setup Entry Point
# This script detects the OS and ensures all prerequisites are met.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Colors for terminal output
INFO='\033[1;34m'
SUCCESS='\033[1;32m'
WARN='\033[1;33m'
ERROR='\033[1;31m'
NC='\033[0m'

log_step() { printf "${INFO}▶ %s${NC}\n" "$1"; }
log_ok() { printf "${SUCCESS}✓ %s${NC}\n" "$1"; }
log_warn() { printf "${WARN}⚠ %s${NC}\n" "$1"; }
die() { printf "${ERROR}✗ %s${NC}\n" "$1" >&2; exit 1; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

detect_os() {
    case "$(uname -s)" in
        Linux*)  echo "linux" ;;
        Darwin*) echo "macos" ;;
        CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
        *)       echo "unknown" ;;
    esac
}

OS=$(detect_os)
log_step "Detected Operating System: $OS"

case "$OS" in
    linux)
        # Ensure whiptail is available first for other scripts
        if ! has_cmd whiptail; then
            log_warn "whiptail is missing. It is required for the graphical setup wizards."
            # We need to source common to get family and install_linux_packages
            . "$ROOT/scripts/lib/setup-common.sh"
            family="$(detect_linux_family)"
            case "$family" in
                debian) pkg="whiptail" ;;
                redhat) pkg="newt" ;;
                arch) pkg="whiptail" ;;
                *) pkg="" ;;
            esac
            if [[ -n "$pkg" ]]; then
                if [[ "${ASSUME_YES:-0}" == "1" ]] || read -p "Install $pkg now? [y/N] " -n 1 -r && [[ $REPLY =~ ^[Yy]$ ]]; then
                    echo
                    install_linux_packages "$family" "$pkg"
                else
                    echo
                    log_warn "Skipping whiptail installation. Graphical wizards might fail."
                fi
            fi
        fi
        bash "$ROOT/scripts/setup-linux.sh"
        ;;
    macos)
        bash "$ROOT/scripts/setup-macos.sh"
        ;;
    windows)
        powershell -ExecutionPolicy Bypass -File "$ROOT/scripts/setup-windows.ps1"
        ;;
    *)
        die "Unsupported operating system: $(uname -s)"
        ;;
esac

log_ok "System check and prerequisite installation completed."
echo
echo -e "${INFO}You can now run:${NC}"
echo -e "  - ${SUCCESS}npm run setup${NC} (for Docker/Server deployment)"
echo -e "  - ${SUCCESS}npm run native:build:wizard${NC} (for building native apps)"
