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
# A certificate the server already has for the domain, from whichever program
# got it, is served from where it is, as on a server set up by hand, instead of
# a new one: 3X-UI's in /root/cert/<domain>/ is looked at first, then where
# 3X-UI's panel, certbot, acme.sh, Caddy and Hiddify keep theirs. Its owner goes
# on renewing it, or with --letsencrypt this server renews it in that folder
# (not in another program's own store, such as certbot's live/).
#
# Options:
#   --dir DIR          install folder (default /opt/p00rija as root, else ~/p00rija)
#   --domain NAME      the server's domain or IP (default: its public IP)
#   --email ADDRESS    for Let's Encrypt, with a domain
#   --cert-dir DIR     serve the certificate already in DIR, in place
#   --letsencrypt      a certificate found or given is renewed by this server, there
#   --new-cert         use no certificate already on the server; make a new one
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
CERT_DIR_ARG="" RENEW_HERE=0 NEW_CERT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:?--dir needs a folder}"; shift ;;
    --domain) DOMAIN_ARG="${2:?--domain needs a name}"; shift ;;
    --email) EMAIL_ARG="${2:?--email needs an address}"; shift ;;
    --cert-dir) CERT_DIR_ARG="${2:?--cert-dir needs a folder}"; shift ;;
    --letsencrypt) RENEW_HERE=1 ;;
    --new-cert) NEW_CERT=1 ;;
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
case "$CERT_DIR_ARG" in ''|/*) ;; *) die "--cert-dir takes the folder's whole path (got \"$CERT_DIR_ARG\")" ;; esac
[ -z "$CERT_DIR_ARG" ] || printf '%s\n' "$CERT_DIR_ARG" | grep -Eqx '[A-Za-z0-9._/@+-]+' || die "--cert-dir: a folder name of letters, digits and . _ / @ + - only"

# ---- Docker -------------------------------------------------------------------
if [ "$DRY" = 0 ]; then
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    [ "$(uname -s)" = Linux ] || die "Install Docker (with its compose plugin) first: https://docs.docker.com/get-docker/"
    # --yes is the answer too: whoever said yes to everything wants Docker.
    answer=n; [ "$YES" = 1 ] && answer=y
    ask answer "Docker (or its compose plugin) is missing. Install it with Docker's official script, get.docker.com? (y/N)" "$answer"
    case "$answer" in y|Y|yes) ;; *) die "Docker is needed. Install it, then run this again." ;; esac
    if [ "$(id -u)" = 0 ]; then curl -fsSL https://get.docker.com | sh
    else curl -fsSL https://get.docker.com | sudo sh; fi \
      || die "Docker could not be installed from get.docker.com here. The central panel installs it through mirrors, or from files it copies in (Servers → Prerequisites)."
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

# ---- a certificate the server already has -------------------------------------------
# Any program may have got one for the domain: 3X-UI (in /root/cert/<domain>/,
# or wherever its panel's database says), certbot, acme.sh, Caddy, Hiddify.
# Looked at as data, nothing in it run: a folder holding a certificate that
# names the domain and has not expired, and the key that belongs to it. It
# prints "<folder> <certificate> <key> <kind>", the folder as seen under its
# first argument; kind "store" is a program's own store (certbot's live/,
# acme.sh's home, Caddy's, Hiddify's), which that program goes on renewing.
CERT_CHECK='root=$1 name=$2 home=$3; shift 3
covers() {
  for n in $(openssl x509 -noout -text -in "$1" 2>/dev/null | sed -n "/Subject Alternative Name/{n;p;}" | tr "," "\n" | sed -n "s/^ *DNS://p"); do
    case "$n" in "$name") return 0 ;; "*."*) [ "${name#*.}" = "${n#\*.}" ] && return 0 ;; esac
  done
  return 1
}
digest() { openssl "$@" 2>/dev/null | openssl sha256 2>/dev/null | sed "s/.*= *//"; }
try() {
  for cert in fullchain.pem fullchain.cer cert.pem certificate.crt "$name.cer" "$name.crt" "$name.pem"; do
    file="$root$1/$cert"
    [ -f "$file" ] && grep -q "BEGIN CERTIFICATE" "$file" 2>/dev/null || continue
    openssl x509 -checkend 0 -noout -in "$file" >/dev/null 2>&1 && covers "$file" || continue
    want=$(digest x509 -noout -pubkey -in "$file")
    [ -n "$want" ] || continue
    for key in privkey.pem key.pem private.key "$name.key"; do
      [ -f "$root$1/$key" ] && [ "$(digest pkey -pubout -in "$root$1/$key")" = "$want" ] && { echo "$1 $cert $key $2"; exit 0; }
    done
  done
}
if [ $# -gt 0 ]; then
  for dir in "$@"; do try "$dir" folder; done
  exit 1
fi
try "/root/cert/$name" folder
db="$root/etc/x-ui/x-ui.db"
if [ -f "$db" ]; then
  for dir in $(tr -c "A-Za-z0-9._/@+-" "\n" < "$db" | grep -E "^/.+\.(pem|crt|cer|key)\$" | sed "s|/[^/]*\$||" | sort -u); do try "$dir" folder; done
fi
for dir in "/etc/letsencrypt/live/$name" "$home/.acme.sh/${name}_ecc" "$home/.acme.sh/$name" "/root/.acme.sh/${name}_ecc" "/root/.acme.sh/$name" /opt/hiddify-manager/ssl; do
  try "$dir" store
done
for dir in "$root"/var/lib/caddy/.local/share/caddy/certificates/*/"$name" "$root"/root/.local/share/caddy/certificates/*/"$name"; do
  [ -d "$dir" ] && try "${dir#"$root"}" store
done
exit 1'
# P00RIJA_TEST_CERT_ROOT stands for the server's / in the tests.
CERT_ROOT="${P00RIJA_TEST_CERT_ROOT:-}"
find_cert() { # find_cert ROOT [DIR] — "<host folder> <certificate> <key>"
  local root="$1" out image; shift
  if command -v openssl >/dev/null 2>&1 && out="$(LC_ALL=C sh -c "$CERT_CHECK" check "$root" "$DOMAIN" "$HOME" "$@" 2>/dev/null)"; then
    printf '%s%s' "$root" "$out"; return 0
  fi
  # This account often cannot read root's folders, 3X-UI's among them, or has
  # no openssl; docker can, and the renewer's image has it. So the same check
  # runs there, with the host's files mounted read-only and no network.
  [ -z "$CERT_ROOT" ] && command -v docker >/dev/null 2>&1 || return 1
  { [ "$(id -u)" = 0 ] && command -v openssl >/dev/null 2>&1; } && return 1
  image="$(env_get P00RIJA_IMAGE_PREFIX)p00rija-cert-renewer:$(env_get APP_VERSION)"
  out="$(docker run --rm --network none -e LC_ALL=C -v /:/host:ro --entrypoint sh "$image" -c "$CERT_CHECK" check /host "$DOMAIN" "$HOME" "$@" 2>/dev/null)" || return 1
  printf '%s' "$out"
}
set_cert_folder() { # set_cert_folder DIR CERT KEY MODE — this run decided it, so it is written
  env_set CERTS_DIR "$1" force; env_set CERT_FILE "$2" force; env_set KEY_FILE "$3" force; env_set CERT_MODE "$4" force
}

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
if ! compose pull; then
  warn "Could not pull the images; starting the ones already on this machine. Try --registry <mirror> if Docker Hub is blocked here."
  # Ones that are not here either would fail later with Docker's own "no such
  # image"; say now which, where they were looked for, and what to do.
  if [ "$DRY" = 0 ]; then
    prefix="$(env_get P00RIJA_IMAGE_PREFIX)" tag="$(env_get APP_VERSION)" absent=""
    for image in p00rija-app p00rija-relay p00rija-cert-renewer; do
      docker image inspect "$prefix$image:$tag" >/dev/null 2>&1 || absent="$absent $prefix$image:$tag"
    done
    [ -z "$absent" ] || die "These images could not be pulled and are not on this server:$absent
  Published on Docker Hub they are pulled from there, or through the mirror given (--registry); one not published yet is published from a checkout with: bash scripts/dockerhub-release.sh --push
  Or install from a checkout instead, without Docker Hub: bash scripts/deploy.sh --prebuilt --server <name>"
  fi
fi

own_certs="$DIR/certs" found=""
if [ "$NEW_CERT" = 1 ]; then
  set_cert_folder "$own_certs" cert.pem key.pem ""
elif [ -n "$CERT_DIR_ARG" ]; then
  found="$(find_cert "" "${CERT_DIR_ARG%/}")" \
    || die "No certificate for $DOMAIN was found in $CERT_DIR_ARG with the key that belongs to it, unexpired (or the folder cannot be read)."
elif [ -n "$(env_get CERTS_DIR)" ] && [ "$(env_get CERTS_DIR)" != "$own_certs" ] && [ "$DOMAIN" = "$current_domain" ]; then
  : # served from a folder already there since an earlier run, for this domain; kept
elif ! is_ip "$DOMAIN" && [ "$DOMAIN" != localhost ]; then
  found="$(find_cert "$CERT_ROOT")" || found=""
fi
# A new domain with no certificate here: the folder served before was for the
# old one, so it is back to its own folder and a certificate of its own.
if [ -z "$found" ] && [ "$DOMAIN" != "$current_domain" ] && [ "$(env_get CERTS_DIR)" != "$own_certs" ] && [ -z "$CERT_DIR_ARG" ]; then
  set_cert_folder "$own_certs" cert.pem key.pem ""
fi
if [ -n "$found" ]; then
  read -r found_dir found_cert found_key found_kind <<EOF
$found
EOF
  renew=owner
  if [ "$found_kind" = store ]; then
    # certbot's live/, acme.sh's home and the like are that program's own
    # store: written there by anything else, its next renewal breaks.
    renewed_by="the program whose own store it is"
  else
    [ "$RENEW_HERE" = 1 ] && renew=here
    [ "$RENEW_HERE" = 1 ] || ask renew "A certificate for $DOMAIN is already in $found_dir. Who renews it: owner (whoever does now) or here (this server, Let's Encrypt, in that folder)?" owner
    renewed_by="its owner"; [ "$renew" = here ] && renewed_by="this server, in that folder"
  fi
  mode=existing; [ "$renew" = here ] && mode=letsencrypt
  set_cert_folder "$found_dir" "$found_cert" "$found_key" "$mode"
  say "▶ Serving the certificate already in $found_dir ($found_cert, $found_key), renewed by $renewed_by"
fi

say "▶ Making the first certificate"
if [ "$(env_get CERTS_DIR)" != "$own_certs" ]; then
  # A folder something else already serves from is checked, never replaced,
  # here: in letsencrypt mode the renewer takes its renewals over once the
  # stack runs, as on a server set up by hand.
  compose run --rm --no-deps -e CERT_MODE=existing cert-renewer --once \
    || die "The certificate in $(env_get CERTS_DIR) cannot be served: its files are missing, or the key does not belong to it. Run again with --new-cert for a new one."
elif ! compose run --rm --no-deps cert-renewer --once; then
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
