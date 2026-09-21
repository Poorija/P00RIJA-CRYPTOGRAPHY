#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Native/build setup for macOS.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/setup-common.sh
. "$SCRIPT_DIR/lib/setup-common.sh"

if [[ "$(uname -s)" != "Darwin" ]]; then
  die "This script is for macOS. Use setup-linux.sh or setup-windows.ps1 on other platforms."
fi

log_step "Checking macOS system updates"
if internet_available; then
  softwareupdate -l || log_warn "macOS update check failed; continuing with dependency checks."
else
  log_warn "Internet or Apple update servers are not reachable. Skipping update check, but dependency checks will still run."
fi

if ! xcode-select -p >/dev/null 2>&1; then
  log_warn "Xcode Command Line Tools are missing."
  xcode-select --install || true
  die "Install Xcode Command Line Tools, then run this script again."
fi

if ! has_cmd brew; then
  if ! internet_available; then
    die "Homebrew is missing and cannot be installed without internet."
  fi
  if confirm "Homebrew is missing. Install Homebrew now?"; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [[ -x /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew ]]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
  else
    die "Homebrew is required for macOS dependency setup."
  fi
fi

if internet_available; then
  log_step "Updating Homebrew metadata"
  brew update || log_warn "brew update failed; continuing with dependency checks."
else
  log_warn "Homebrew update skipped because internet is unavailable."
fi

# Fix permissions for the dist directory if it exists, as it often causes issues on macOS
if [[ -d "$ROOT/dist" ]]; then
  log_step "Ensuring correct permissions for the build directory"
  if ! [ -w "$ROOT/dist" ]; then
    log_warn "Current user doesn't have write access to $ROOT/dist. Requesting sudo to fix permissions..."
    sudo chown -R "$(id -un):$(id -gn)" "$ROOT/dist" || log_warn "Failed to fix permissions with sudo."
  fi
fi

brew_packages=(node rust pkg-config openssl)
missing_brew=()
for pkg in "${brew_packages[@]}"; do
  brew list "$pkg" >/dev/null 2>&1 || missing_brew+=("$pkg")
done

if [[ "${#missing_brew[@]}" -gt 0 ]]; then
  if ! internet_available; then
    die "Missing Homebrew packages cannot be installed without internet: ${missing_brew[*]}"
  fi
  
  echo -e "${INFO}The following Homebrew packages are missing:${NC}"
  for pkg in "${missing_brew[@]}"; do
    echo -e "  - $pkg"
  done

  if confirm "Install missing Homebrew packages: ${missing_brew[*]}?"; then
    brew install "${missing_brew[@]}"
  else
    die "Required packages were not installed: ${missing_brew[*]}"
  fi
fi

if ! has_cmd docker; then
  if ! internet_available; then
    die "Docker Desktop is missing and cannot be installed without internet."
  fi
  if confirm "Docker Desktop is missing. Install it with Homebrew Cask?"; then
    brew install --cask docker
    log_warn "Open Docker Desktop once and wait until Docker is running, then rerun this script if docker is still unavailable."
  else
    die "Docker Desktop is required for Docker/server workflows."
  fi
fi

assert_commands curl openssl node npm cargo rustc
if has_cmd docker; then
  docker compose version >/dev/null 2>&1 || log_warn "Docker is installed, but 'docker compose' is not ready. Start Docker Desktop and rerun if needed."
fi

run_npm_bootstrap

log_ok "macOS native/build setup is ready."
printf "${DIM}Useful commands:${NC}\n"
printf "  npm run native:build:mac:arm64\n"
printf "  npm run native:build:mac:universal\n"
