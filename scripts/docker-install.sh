#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.
# ---------------------------------------------------------------------------
# A whole P00RIJA server from ready-made Docker Hub images: nothing to build,
# nothing to clone. All it needs is Docker (docs/DOCKER.md).
#
#   curl -fsSL https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/docker-install.sh | bash
#   curl -fsSL .../docker-install.sh | bash -s -- --domain chat.example.com --email you@example.com
#
# It asks for a domain (Enter uses this server's public IP with a self-signed
# certificate), an email for Let's Encrypt when a domain is given, and the app
# port. Then it writes .env with random TURN secrets, makes the first
# certificate, starts the stack and prints where to open it, with the
# dashboard user (admin) and the password the relay made on its first start.
# Run it again to update: it pulls the new images and keeps .env and data.
#
# Options:
#   --dir DIR          install folder (default /opt/p00rija as root, else ~/p00rija)
#   --domain NAME      the server's domain or IP (default: its public IP)
#   --email ADDRESS    for Let's Encrypt, with a domain
#   --app-port N       the app's HTTPS port (default 8585)
#   --registry HOST    pull through a registry mirror (when Docker Hub is blocked)
#   --version V        image tag to run (default latest)
#   --yes              take every default without asking
#   --dry-run          write the folder, print the docker commands, run none
#
# Reading a script before piping it into a shell is good practice: this one
# installs Docker only if it is missing and you say yes, and touches nothing
# outside its folder.
# ---------------------------------------------------------------------------
set -euo pipefail
# Bash reads a script as it runs it, and this one arrives through a pipe: a
# download cut short would have run its first half. So all of it is one
# block, read whole before anything runs.
{

REPO_RAW="https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"

say()  { printf '%s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }
usage() { sed -n '/^# A whole P00RIJA server/,/^# ------/p' "${BASH_SOURCE[0]:-$0}" 2>/dev/null | sed 's/^# \{0,1\}//; /^-----/d'; }

DIR="" DOMAIN_ARG="" EMAIL_ARG="" PORT_ARG="" REGISTRY="" VERSION="" YES=0 DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:?--dir needs a folder}"; shift ;;
    --domain) DOMAIN_ARG="${2:?--domain needs a name}"; shift ;;
    --email) EMAIL_ARG="${2:?--email needs an address}"; shift ;;
    --app-port) PORT_ARG="${2:?--app-port needs a number}"; shift ;;
    --registry) REGISTRY="${2:?--registry needs a host}"; shift ;;
    --version) VERSION="${2:?--version needs a tag}"; shift ;;
    --yes|-y) YES=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

run() { if [ "$DRY" = 1 ]; then printf '+ %s\n' "$*"; else "$@"; fi; }
# Questions come from the terminal even when the script itself arrives on stdin
# (curl | bash); with no terminal at all, every default is taken.
ask() { # ask VAR "question" default
  local var="$1" question="$2" default="$3" answer=""
  if [ "$YES" = 0 ] && { [ -t 0 ] || { [ -r /dev/tty ] && [ -w /dev/tty ]; }; }; then
    printf '%s [%s]: ' "$question" "$default" >&2
    if [ -t 0 ]; then IFS= read -r answer || true; else IFS= read -r answer < /dev/tty || true; fi
  fi
  printf -v "$var" '%s' "${answer:-$default}"
}
random_hex() { # random_hex BYTES
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"
  else od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; fi
}
is_ip() { printf '%s' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; }

# ---- Docker -------------------------------------------------------------------
if [ "$DRY" = 0 ]; then
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    [ "$(uname -s)" = Linux ] || die "Install Docker (with its compose plugin) first: https://docs.docker.com/get-docker/"
    answer=n
    ask answer "Docker (or its compose plugin) is missing. Install it with Docker's official script, get.docker.com? (y/N)" n
    case "$answer" in y|Y|yes) ;; *) die "Docker is needed. Install it, then run this again." ;; esac
    if [ "$(id -u)" = 0 ]; then curl -fsSL https://get.docker.com | sh
    else curl -fsSL https://get.docker.com | sudo sh; fi
  fi
  docker info >/dev/null 2>&1 || die "Docker is installed but not running (or this user may not use it). Try: sudo systemctl start docker"
fi

# ---- the folder and its .env --------------------------------------------------------
if [ -z "$DIR" ]; then
  if [ "$(id -u)" = 0 ]; then DIR=/opt/p00rija; else DIR="$HOME/p00rija"; fi
fi
mkdir -p "$DIR/data/chat-signal" "$DIR/certs" "$DIR/letsencrypt"
DIR="$(cd "$DIR" && pwd)"
ENV_FILE="$DIR/.env"
COMPOSE_FILE="$DIR/compose.yaml"

env_get() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 || true; }
# A key already in .env is kept as it is (re-runs must not change secrets that
# live calls depend on), unless this run was told a new value explicitly.
env_set() { # env_set KEY VALUE [force]
  local key="$1" value="$2" force="${3:-}"
  if [ -f "$ENV_FILE" ] && grep -q "^$key=" "$ENV_FILE"; then
    [ -n "$force" ] || return 0
    local tmp; tmp="$(mktemp "$DIR/.env.XXXXXX")"
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' "$ENV_FILE" > "$tmp"
    chmod 600 "$tmp"; mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}
( umask 077; touch "$ENV_FILE" ); chmod 600 "$ENV_FILE"

PUBLIC_IP="${P00RIJA_TEST_PUBLIC_IP:-}"
if [ -z "$PUBLIC_IP" ]; then
  PUBLIC_IP="$(curl -fsS4 --max-time 6 https://api.ipify.org 2>/dev/null || curl -fsS4 --max-time 6 https://ifconfig.me 2>/dev/null || true)"
fi
is_ip "$PUBLIC_IP" || PUBLIC_IP="$(env_get EXTERNAL_IP)"
[ -n "$PUBLIC_IP" ] || die "Could not find this server's public IP. Pass it with --domain <ip>."

current_domain="$(env_get DOMAIN)"
DOMAIN="$DOMAIN_ARG"
[ -n "$DOMAIN" ] || ask DOMAIN "Domain of this server (Enter for its IP, $PUBLIC_IP)" "${current_domain:-$PUBLIC_IP}"
EMAIL="$EMAIL_ARG"
if [ -z "$EMAIL" ] && ! is_ip "$DOMAIN" && [ "$DOMAIN" != localhost ]; then
  ask EMAIL "Email for Let's Encrypt (Enter to skip)" "$(env_get CERTBOT_EMAIL)"
fi
APP_PORT="$PORT_ARG"
[ -n "$APP_PORT" ] || ask APP_PORT "HTTPS port of the app" "$(env_get APP_PORT | grep . || echo 8585)"
case "$APP_PORT" in ''|*[!0-9]*) die "the port must be a number (got \"$APP_PORT\")" ;; esac

if [ "$DOMAIN" = localhost ]; then
  origins="https://localhost:$APP_PORT,http://localhost:$APP_PORT,https://127.0.0.1:$APP_PORT,http://127.0.0.1:$APP_PORT"
elif is_ip "$DOMAIN"; then
  origins="https://$DOMAIN:$APP_PORT,http://$DOMAIN:$APP_PORT"
else
  origins="https://$DOMAIN:$APP_PORT,https://$DOMAIN"
fi
force_domain=""; [ -n "$DOMAIN_ARG" ] || [ "$DOMAIN" != "$current_domain" ] && force_domain=1

{
  [ -s "$ENV_FILE" ] || printf '# P00RIJA Cryptography server, written by scripts/docker-install.sh.\n# Safe to edit; run the installer again to apply. Keep it private.\n'
} >> "$ENV_FILE"
env_set DOMAIN "$DOMAIN" "$force_domain"
env_set EXTERNAL_IP "$PUBLIC_IP" force
env_set APP_PORT "$APP_PORT" force
env_set CHAT_ALLOWED_ORIGINS "$origins" "$force_domain"
env_set CERT_MODE ""
env_set CERTBOT_EMAIL "$EMAIL" "${EMAIL_ARG:+1}"
env_set CERTS_DIR "$DIR/certs"
env_set LETSENCRYPT_DIR "$DIR/letsencrypt"
env_set MONITOR_USER admin
env_set TURN_USER "p00rija-$(random_hex 4)"
env_set TURN_PASSWORD "$(random_hex 16)"
env_set TURN_SECRET "$(random_hex 32)"
env_set APP_VERSION "${VERSION:-latest}" "${VERSION:+1}"
if [ -n "$REGISTRY" ]; then
  REGISTRY="${REGISTRY%/}"
  env_set P00RIJA_REGISTRY "$REGISTRY/" force
  env_set P00RIJA_IMAGE_PREFIX "$REGISTRY/poorija/" force
else
  env_set P00RIJA_IMAGE_PREFIX "poorija/"
fi

# ---- the compose file ------------------------------------------------------------------
tag="$(env_get APP_VERSION)"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../docker/compose.yaml" ]; then
  cp "$SCRIPT_DIR/../docker/compose.yaml" "$COMPOSE_FILE"
else
  ref=main; [ -n "$tag" ] && [ "$tag" != latest ] && ref="v$tag"
  curl -fsSL "$REPO_RAW/$ref/docker/compose.yaml" -o "$COMPOSE_FILE.new" || die "Could not download the compose file from GitHub ($ref)."
  mv "$COMPOSE_FILE.new" "$COMPOSE_FILE"
fi

# ---- start ---------------------------------------------------------------------------
compose() { run docker compose -p p00rija -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
say "▶ Pulling the images"
# A pull that fails (Docker Hub unreachable, or no mirror given) is not the end
# when the images are already here: say so, and start what is there. Images
# that are missing make the next step fail with Docker's own message.
compose pull || warn "Could not pull the images; starting the ones already on this machine. Try --registry <mirror> if Docker Hub is blocked here."
say "▶ Making the first certificate"
if ! compose run --rm --no-deps cert-renewer --once; then
  # Let's Encrypt said no (the domain does not point here yet, or port 80 is
  # closed). Start on a self-signed certificate rather than not at all: the
  # renewer keeps asking Let's Encrypt every few hours and puts the real one
  # in place by itself as soon as it is issued.
  warn "Let's Encrypt did not issue a certificate for $(env_get DOMAIN) yet (does the domain point at this server, and is port 80 open?)."
  warn "Starting with a temporary self-signed certificate; it is replaced by itself once Let's Encrypt answers."
  compose run --rm --no-deps -e CERT_MODE=self-signed cert-renewer --once
fi
say "▶ Starting"
compose up -d

if [ "$DRY" = 1 ]; then say "(dry run: nothing was started)"; exit 0; fi
say "▶ Waiting for the relay"
for _ in $(seq 1 60); do
  docker exec Poorija-Cryptography_ChatSignal node -e "fetch('http://127.0.0.1:9000/chat-health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && break
  sleep 2
done
password="$(docker exec Poorija-Cryptography_ChatSignal cat /data/initial-monitor-password 2>/dev/null | tr -d '\r\n' || true)"
domain="$(env_get DOMAIN)"; port="$(env_get APP_PORT)"
say ""
say "✓ P00RIJA Cryptography is running."
say "  App:        https://$domain:$port/"
say "  Dashboard:  https://$domain:$port/Monitor_Server"
say "  User:       $(env_get MONITOR_USER)"
if [ -n "$password" ]; then
  say "  Password:   $password"
  say "  Change it in the dashboard; this one is shown only until you do."
else
  say "  Password:   the one you set in the dashboard (the first one was already changed)"
fi
is_ip "$domain" || [ "$domain" = localhost ] && say "  The certificate is self-signed, so the browser asks you to accept it once."
say "  Files:      $DIR (keep .env and data/ in your backups)"
say "  Update:     run this installer again"
exit
}
