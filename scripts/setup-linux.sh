#!/usr/bin/env bash
# Native/build setup for Linux workstations: Debian/Ubuntu, RHEL/Fedora, and Arch.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/setup-common.sh
. "$SCRIPT_DIR/lib/setup-common.sh"

if [[ "$(uname -s)" != "Linux" ]]; then
  die "This script is for Linux. Use setup-macos.sh or setup-windows.ps1 on other platforms."
fi

family="$(detect_linux_family)"
log_step "Detected Linux family: $family"
check_linux_updates "$family"

case "$family" in
  debian)
    packages=(
      ca-certificates curl openssl build-essential pkg-config
      libssl-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev
      librsvg2-dev patchelf nodejs npm cargo rustc
      docker.io docker-compose-plugin whiptail
    )
    ;;
  redhat)
    packages=(
      ca-certificates curl openssl gcc gcc-c++ make pkgconf-pkg-config
      openssl-devel webkit2gtk4.1-devel libappindicator-gtk3-devel
      librsvg2-devel patchelf nodejs npm cargo rust
      docker docker-compose-plugin newt
    )
    ;;
  arch)
    packages=(
      ca-certificates curl openssl base-devel pkgconf
      webkit2gtk-4.1 libayatana-appindicator librsvg patchelf
      nodejs npm cargo rust docker docker-compose whiptail
    )
    ;;
  *)
    die "Unsupported Linux distribution. Supported families: Debian/Ubuntu, RHEL/Fedora, Arch."
    ;;
esac

install_linux_packages "$family" "${packages[@]}"
start_docker_if_possible

assert_commands curl openssl node npm cargo rustc
assert_pkg_config webkit2gtk-4.1
assert_docker_compose

run_npm_bootstrap

log_ok "Linux native/build setup is ready."
printf "${DIM}Useful commands:${NC}\n"
printf "  npm run native:build:linux\n"
printf "  npm run setup:server:linux\n"
