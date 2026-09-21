#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Server deployment setup for Linux servers: Debian/Ubuntu, RHEL/Fedora, and Arch.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/setup-common.sh
. "$SCRIPT_DIR/lib/setup-common.sh"

if [[ "$(uname -s)" != "Linux" ]]; then
  die "This server setup script is for Linux only."
fi

family="$(detect_linux_family)"
log_step "Detected Linux server family: $family"
check_linux_updates "$family"

case "$family" in
  debian)
    packages=(
      ca-certificates curl openssl whiptail dnsutils iputils-ping
      docker.io docker-compose-plugin
    )
    ;;
  redhat)
    packages=(
      ca-certificates curl openssl newt bind-utils iputils
      docker docker-compose-plugin
    )
    ;;
  arch)
    packages=(
      ca-certificates curl openssl whiptail bind iputils
      docker docker-compose
    )
    ;;
  *)
    die "Unsupported Linux distribution. Supported families: Debian/Ubuntu, RHEL/Fedora, Arch."
    ;;
esac

install_linux_packages "$family" "${packages[@]}"
start_docker_if_possible

assert_commands curl openssl awk mktemp whiptail docker
assert_docker_compose

log_ok "Server requirements are ready."
log_step "Starting the P00RIJA server deployment wizard"
exec bash "$ROOT/scripts/setup.sh" "$@"
