#!/usr/bin/env bash

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "setup-common.sh is a helper library and should be sourced, not executed." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

INFO='\033[1;34m'
SUCCESS='\033[1;32m'
WARN='\033[1;33m'
ERROR='\033[1;31m'
DIM='\033[2m'
NC='\033[0m'

ASSUME_YES="${ASSUME_YES:-0}"

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
fi

log_step() {
  printf "${INFO}▶ %s${NC}\n" "$1"
}

log_ok() {
  printf "${SUCCESS}✓ %s${NC}\n" "$1"
}

log_warn() {
  printf "${WARN}⚠ %s${NC}\n" "$1"
}

die() {
  printf "${ERROR}✗ %s${NC}\n" "$1" >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

confirm() {
  local prompt="$1"
  if [[ "$ASSUME_YES" == "1" || "$ASSUME_YES" == "true" ]]; then
    return 0
  fi
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]]
}

internet_available() {
  if has_cmd curl; then
    curl -fsI --connect-timeout 5 --max-time 8 https://registry.npmjs.org/ >/dev/null 2>&1 && return 0
    curl -fsI --connect-timeout 5 --max-time 8 https://github.com/ >/dev/null 2>&1 && return 0
  fi
  if has_cmd ping; then
    ping -c 1 -W 3 1.1.1.1 >/dev/null 2>&1 && return 0
  fi
  return 1
}

detect_linux_family() {
  local id="" like=""
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    id="${ID:-}"
    like="${ID_LIKE:-}"
  fi
  case " $id $like " in
    *" debian "*|*" ubuntu "*) echo "debian" ;;
    *" rhel "*|*" fedora "*|*" centos "*|*" rocky "*|*" almalinux "*) echo "redhat" ;;
    *" arch "*|*" manjaro "*) echo "arch" ;;
    *) echo "unknown" ;;
  esac
}

check_linux_updates() {
  local family="$1"
  log_step "Checking system update metadata"
  if ! internet_available; then
    log_warn "Internet or update servers are not reachable. Skipping update check, but dependency checks will still run."
    return 0
  fi

  case "$family" in
    debian)
      "${SUDO[@]}" apt-get update || log_warn "apt update failed; continuing with dependency checks."
      apt list --upgradable 2>/dev/null | sed -n '1,8p' || true
      ;;
    redhat)
      if has_cmd dnf; then
        "${SUDO[@]}" dnf -q check-update || [[ "$?" == "100" ]] || log_warn "dnf check-update failed; continuing with dependency checks."
      elif has_cmd yum; then
        "${SUDO[@]}" yum -q check-update || [[ "$?" == "100" ]] || log_warn "yum check-update failed; continuing with dependency checks."
      else
        log_warn "No dnf/yum found for update checks."
      fi
      ;;
    arch)
      "${SUDO[@]}" pacman -Sy --noconfirm || log_warn "pacman sync failed; continuing with dependency checks."
      pacman -Qu 2>/dev/null | sed -n '1,8p' || true
      ;;
    *)
      log_warn "Unknown Linux family; skipping package update check."
      ;;
  esac
}

install_linux_packages() {
  local family="$1"
  shift
  local packages=("$@")
  [[ "${#packages[@]}" -gt 0 ]] || return 0

  if ! internet_available; then
    log_warn "Package installation skipped because internet or package repositories are unreachable. Installed requirements will still be verified."
    return 0
  fi
  if ! confirm "Install/check required packages with the system package manager?"; then
    die "Required packages were not installed: ${packages[*]}"
  fi

  case "$family" in
    debian)
      "${SUDO[@]}" apt-get install -y "${packages[@]}"
      ;;
    redhat)
      if has_cmd dnf; then
        "${SUDO[@]}" dnf install -y "${packages[@]}"
      elif has_cmd yum; then
        "${SUDO[@]}" yum install -y "${packages[@]}"
      else
        die "No dnf/yum package manager was found."
      fi
      ;;
    arch)
      "${SUDO[@]}" pacman -S --needed --noconfirm "${packages[@]}"
      ;;
    *)
      die "Unsupported Linux family. Install these packages manually: ${packages[*]}"
      ;;
  esac
}

assert_commands() {
  local missing=()
  for cmd in "$@"; do
    if ! has_cmd "$cmd"; then
      missing+=("$cmd")
    fi
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    die "Required commands are still missing: ${missing[*]}"
  fi
}

assert_pkg_config() {
  assert_commands pkg-config
  local missing=()
  for package in "$@"; do
    if ! pkg-config --exists "$package"; then
      missing+=("$package")
    fi
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    die "Required native libraries are missing according to pkg-config: ${missing[*]}"
  fi
}

assert_docker_compose() {
  assert_commands docker
  if ! docker compose version >/dev/null 2>&1; then
    die "Docker is installed, but 'docker compose' plugin is not available."
  fi
}

start_docker_if_possible() {
  if has_cmd systemctl; then
    "${SUDO[@]}" systemctl enable --now docker >/dev/null 2>&1 || log_warn "Could not start Docker with systemctl. Start Docker manually before deployment."
  fi
}

run_npm_bootstrap() {
  cd "$ROOT"
  assert_commands node npm
  if [[ ! -d node_modules ]]; then
    log_step "Installing npm dependencies"
    npm install
  else
    log_ok "node_modules already exists"
  fi
  log_step "Preparing Tauri web assets"
  npm run native:prepare
}
