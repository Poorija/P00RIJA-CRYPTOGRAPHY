#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.
# ---------------------------------------------------------------------------
# The central panel in a container on your own computer (docs/CONTROL-PANEL.md,
# docs/DOCKER.md). One command brings Docker up if it is not running, asks a
# few questions the first time, and starts the panel:
#
#   bash scripts/panel.sh                 start (asks the first time)
#   bash scripts/panel.sh --reconfigure   ask again
#   bash scripts/panel.sh stop | status | logs | update | login
#   bash scripts/panel.sh doctor             check Docker, deploy.conf, keys, one SSH login per server
#   bash scripts/panel.sh backup [FILE]      the panel's login, trust and layout to a file
#   bash scripts/panel.sh restore FILE       and back
#   bash scripts/panel.sh uninstall [--purge]   remove it (--purge: its login and settings too)
#
# It asks for the port, the address to listen on (this computer only, or the
# LAN), whether the panel should come back by itself whenever Docker starts,
# and where your deploy.conf and SSH keys are. The answers are kept in
# ~/.config/p00rija-cryptography/panel.env — settings only, never a password.
# The panel's login is made by setup-login inside the container: you type your
# own name and password and scan the code; this script never sees them.
#
# The image is poorija/p00rija-panel from Docker Hub. Run from a checkout of
# the repository whose version is not on Docker Hub yet, or with --build, it
# builds the same image from source instead.
#
# Options:
#   --port N            port on this computer (default 8686)
#   --bind ADDR         127.0.0.1 (default) or a LAN address such as 0.0.0.0
#   --host NAME         the name or IP the panel is opened at, when on the LAN
#   --autostart yes|no  come back whenever Docker starts (default yes)
#   --config-dir DIR    where deploy.conf is (default ~/.config/p00rija-cryptography)
#   --ssh-dir DIR       the SSH keys deploy.conf names (default ~/.ssh)
#   --tls-cert FILE     serve HTTPS with this certificate (and --tls-key FILE);
#                       asked for when the panel listens on the LAN
#   --write             let the panel edit deploy.conf and sign the family list
#   --build | --pull    build from this checkout, or pull from Docker Hub
#   --yes               take the saved answers, or the defaults, without asking
#   --reconfigure       ask every question again
#   --no-open           do not open the browser
#   --dry-run           print the docker commands instead of running them
# ---------------------------------------------------------------------------
set -euo pipefail
# Bash reads a script as it runs it. This one waits a long time for a person
# (the questions, the login), and a file that changed meanwhile (an edit, a
# pull, a sync) was read from the old offset and failed with "unexpected EOF".
# So all of it is one block, read whole before anything runs.
{

NAME=Poorija-Cryptography_ControlPanel
VOLUME=panel-state
REPO_IMAGE=poorija/p00rija-panel
SETTINGS="${POORIJA_PANEL_SETTINGS:-$HOME/.config/p00rija-cryptography/panel.env}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd || true)"
IN_CHECKOUT=0
[ -n "$ROOT" ] && [ -f "$ROOT/config/Dockerfile.control-panel" ] && [ -f "$ROOT/package.json" ] && IN_CHECKOUT=1

say()  { printf '%s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '/^# The central panel in a container/,/^# ------/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//; /^-----/d'
}

# ---- arguments ----------------------------------------------------------------
COMMAND=start
DRY=0 YES=0 RECONFIGURE=0 OPEN=1 SOURCE=""
F_PORT="" F_BIND="" F_HOST="" F_AUTOSTART="" F_CONFIG="" F_SSH="" F_WRITE="" F_TLS_CERT="" F_TLS_KEY=""
LOGIN_ARGS=()
PURGE=0 FILE_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    start|stop|status|logs|update|login|doctor|backup|restore|uninstall) COMMAND="$1"
      case "$1" in backup|restore) if [ $# -gt 1 ] && [ "${2#--}" = "$2" ]; then FILE_ARG="$2"; shift; fi ;; esac ;;
    --purge) PURGE=1 ;;
    --port) F_PORT="${2:?--port needs a number}"; shift ;;
    --bind) F_BIND="${2:?--bind needs an address}"; shift ;;
    --host) F_HOST="${2:?--host needs a name or IP}"; shift ;;
    --autostart) F_AUTOSTART="${2:?--autostart needs yes or no}"; shift ;;
    --config-dir) F_CONFIG="${2:?--config-dir needs a folder}"; shift ;;
    --ssh-dir) F_SSH="${2:?--ssh-dir needs a folder}"; shift ;;
    --write) F_WRITE=yes ;;
    --tls-cert) F_TLS_CERT="${2:?--tls-cert needs a file}"; shift ;;
    --tls-key) F_TLS_KEY="${2:?--tls-key needs a file}"; shift ;;
    --build) SOURCE=build ;;
    --pull) SOURCE=pull ;;
    --yes|-y) YES=1 ;;
    --reconfigure) RECONFIGURE=1 ;;
    --no-open) OPEN=0 ;;
    --dry-run) DRY=1 ;;
    --new-code) LOGIN_ARGS+=(--new-code) ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

# Every docker call goes through here, so --dry-run shows exactly what would run.
run() {
  if [ "$DRY" = 1 ]; then printf '+ %s\n' "$*"; return 0; fi
  "$@"
}

version() {
  if [ "$IN_CHECKOUT" = 1 ]; then
    sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1
  else
    printf 'latest'
  fi
}

# ---- Docker itself ---------------------------------------------------------------
ensure_docker() {
  [ "$DRY" = 1 ] && return 0
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Get it from https://docs.docker.com/get-docker/ (or OrbStack on a Mac), then run this again."
  docker info >/dev/null 2>&1 && return 0
  say "▶ Docker is not running; starting it"
  case "$(uname -s)" in
    Darwin)
      if [ -d /Applications/OrbStack.app ] || [ -d "$HOME/Applications/OrbStack.app" ]; then open -ga OrbStack
      else open -ga Docker 2>/dev/null || die "Open Docker Desktop (or OrbStack) and run this again."; fi ;;
    Linux)
      systemctl start docker 2>/dev/null || sudo -n systemctl start docker 2>/dev/null \
        || die "Docker is not running. Start it with:  sudo systemctl start docker" ;;
  esac
  local waited=0
  until docker info >/dev/null 2>&1; do
    [ $waited -ge 120 ] && die "Docker did not come up within 2 minutes."
    sleep 2; waited=$((waited + 2))
  done
  say "✓ Docker is up"
}

# ---- settings --------------------------------------------------------------------
PANEL_PORT=8686 PANEL_BIND=127.0.0.1 PANEL_HOST="" PANEL_AUTOSTART=yes
PANEL_CONFIG_DIR="$HOME/.config/p00rija-cryptography" PANEL_SSH_DIR="$HOME/.ssh" PANEL_WRITE=no PANEL_IMAGE=""
PANEL_TLS_CERT="" PANEL_TLS_KEY=""
HAVE_SETTINGS=0
if [ -f "$SETTINGS" ]; then
  # Read as data, not sourced: only the known keys, values taken literally.
  while IFS='=' read -r key value; do
    case "$key" in
      PANEL_PORT|PANEL_BIND|PANEL_HOST|PANEL_AUTOSTART|PANEL_CONFIG_DIR|PANEL_SSH_DIR|PANEL_WRITE|PANEL_IMAGE|PANEL_TLS_CERT|PANEL_TLS_KEY)
        printf -v "$key" '%s' "$value" ;;
    esac
  done < "$SETTINGS"
  HAVE_SETTINGS=1
fi

ask() { # ask VAR "question" — Enter keeps the current value
  local var="$1" question="$2" current answer=""
  current="${!var}"
  printf '%s [%s]: ' "$question" "$current" >&2
  IFS= read -r answer || answer=""
  [ -n "$answer" ] && printf -v "$var" '%s' "$answer"
  return 0
}
ask_yes_no() {
  local var="$1" question="$2" answer=""
  printf '%s [%s]: ' "$question" "${!var}" >&2
  IFS= read -r answer || answer=""
  case "$answer" in
    y|Y|yes|YES|Yes|بله) printf -v "$var" yes ;;
    n|N|no|NO|No|نه|خیر) printf -v "$var" no ;;
  esac
  return 0
}

configure() {
  [ -n "$F_PORT" ] && PANEL_PORT="$F_PORT"
  [ -n "$F_BIND" ] && PANEL_BIND="$F_BIND"
  [ -n "$F_HOST" ] && PANEL_HOST="$F_HOST"
  [ -n "$F_AUTOSTART" ] && PANEL_AUTOSTART="$F_AUTOSTART"
  [ -n "$F_CONFIG" ] && PANEL_CONFIG_DIR="$F_CONFIG"
  [ -n "$F_SSH" ] && PANEL_SSH_DIR="$F_SSH"
  [ -n "$F_WRITE" ] && PANEL_WRITE="$F_WRITE"
  [ -n "$F_TLS_CERT" ] && PANEL_TLS_CERT="$F_TLS_CERT"
  [ -n "$F_TLS_KEY" ] && PANEL_TLS_KEY="$F_TLS_KEY"
  if [ "$YES" = 0 ] && { [ "$HAVE_SETTINGS" = 0 ] || [ "$RECONFIGURE" = 1 ]; }; then
    say "The central panel — a few questions (Enter keeps the value in brackets)." >&2
    [ -z "$F_PORT" ] && ask PANEL_PORT "Port on this computer"
    if [ -z "$F_BIND" ]; then
      ask PANEL_BIND "Listen on (127.0.0.1 = this computer only, 0.0.0.0 = the whole LAN)"
    fi
    if [ "$PANEL_BIND" != 127.0.0.1 ] && [ "$PANEL_BIND" != localhost ] && [ -z "$F_HOST" ]; then
      warn "On the LAN anyone who reaches this port sees the login page; the login itself is a password and a TOTP code."
      ask PANEL_HOST "The name or IP you will open it at (for example 192.168.1.5)"
    fi
    if [ "$PANEL_BIND" != 127.0.0.1 ] && [ "$PANEL_BIND" != localhost ] && [ -z "$F_TLS_CERT" ]; then
      ask PANEL_TLS_CERT "TLS certificate file for HTTPS (Enter for none)"
      [ -n "$PANEL_TLS_CERT" ] && ask PANEL_TLS_KEY "Its private key file"
    fi
    [ -z "$F_AUTOSTART" ] && ask_yes_no PANEL_AUTOSTART "Start it by itself whenever Docker starts? (yes/no)"
    [ -z "$F_CONFIG" ] && ask PANEL_CONFIG_DIR "Folder with deploy.conf"
    [ -z "$F_SSH" ] && ask PANEL_SSH_DIR "Folder with the SSH keys"
    if [ -z "$F_WRITE" ]; then
      # The panel adds and removes servers in deploy.conf, and signs the family
      # list where operator-key.json is: offered always, yes by default there.
      [ "$HAVE_SETTINGS" = 0 ] && [ -f "$PANEL_CONFIG_DIR/operator-key.json" ] && PANEL_WRITE=yes
      ask_yes_no PANEL_WRITE "Let the panel edit deploy.conf and sign the family list? (yes/no)"
    fi
  fi
  case "$PANEL_PORT" in ''|*[!0-9]*) die "the port must be a number (got \"$PANEL_PORT\")" ;; esac
  [ "$PANEL_PORT" -ge 1 ] && [ "$PANEL_PORT" -le 65535 ] || die "the port must be 1-65535 (got $PANEL_PORT)"
  case "$PANEL_AUTOSTART" in yes|no) ;; *) die "--autostart takes yes or no (got \"$PANEL_AUTOSTART\")" ;; esac
  if [ -n "$PANEL_TLS_CERT" ] || [ -n "$PANEL_TLS_KEY" ]; then
    [ -f "$PANEL_TLS_CERT" ] || die "the TLS certificate $PANEL_TLS_CERT is not there"
    [ -f "$PANEL_TLS_KEY" ] || die "the TLS key ${PANEL_TLS_KEY:-(none given)} is not there; pass --tls-key FILE"
  fi
  mkdir -p "$PANEL_CONFIG_DIR" "$(dirname "$SETTINGS")"
  { umask 077
    printf 'PANEL_PORT=%s\nPANEL_BIND=%s\nPANEL_HOST=%s\nPANEL_AUTOSTART=%s\nPANEL_CONFIG_DIR=%s\nPANEL_SSH_DIR=%s\nPANEL_WRITE=%s\nPANEL_IMAGE=%s\nPANEL_TLS_CERT=%s\nPANEL_TLS_KEY=%s\n' \
      "$PANEL_PORT" "$PANEL_BIND" "$PANEL_HOST" "$PANEL_AUTOSTART" "$PANEL_CONFIG_DIR" "$PANEL_SSH_DIR" "$PANEL_WRITE" "$PANEL_IMAGE" "$PANEL_TLS_CERT" "$PANEL_TLS_KEY" > "$SETTINGS"; }
}

port_free() { # 0 when nothing but the panel itself listens on the port
  local port="$1"
  # A read-only question, so --dry-run asks it too.
  if command -v docker >/dev/null 2>&1 && docker ps --filter "name=^${NAME}\$" --format '{{.Ports}}' 2>/dev/null | grep -q ":${port}->"; then return 0; fi
  if command -v lsof >/dev/null 2>&1; then
    ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    ! (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null
  fi
}

image_ref() {
  local tag; tag="$(version)"
  printf '%s:%s' "$REPO_IMAGE" "${tag:-latest}"
}

get_image() {
  local image="$1" how="$SOURCE"
  if [ -z "$how" ]; then
    if [ "$IN_CHECKOUT" = 1 ] && { [ "$DRY" = 1 ] || ! docker manifest inspect "$image" >/dev/null 2>&1; }; then how=build; else how=pull; fi
  fi
  if [ "$how" = build ]; then
    [ "$IN_CHECKOUT" = 1 ] || die "--build needs a checkout of the repository; this copy of the script has none beside it"
    say "▶ Building $image from $ROOT"
    run docker build -f "$ROOT/config/Dockerfile.control-panel" -t "$image" "$ROOT"
  else
    say "▶ Pulling $image"
    run docker pull "$image"
  fi
}

ensure_login() {
  local image="$1"
  if [ "$DRY" = 1 ]; then
    run docker run --rm -v "$VOLUME:/state" --entrypoint sh "$image" -c 'test -f /state/control-panel-login.json'
    return 0
  fi
  if docker run --rm -v "$VOLUME:/state" --entrypoint sh "$image" -c 'test -f /state/control-panel-login.json' >/dev/null 2>&1; then
    return 0
  fi
  [ -t 0 ] || die "The panel has no login yet. Run this same command in a terminal, so you can type your own name and password: bash scripts/panel.sh"
  say "▶ The panel has no login yet. Choose your own name and password, then add the secret it prints to an authenticator app (type it in, or open the otpauth link on the phone)."
  docker run --rm -it -v "$VOLUME:/state" "$image" setup-login
}

start() {
  configure
  local image origins url publish restart access scheme=http
  local tls_args=()
  image="${PANEL_IMAGE:-$(image_ref)}"
  port_free "$PANEL_PORT" || die "port $PANEL_PORT is already in use; choose another with --port N"
  ensure_docker
  get_image "$image"
  ensure_login "$image"
  if [ -n "$PANEL_TLS_CERT" ]; then
    scheme=https
    tls_args=(-v "$PANEL_TLS_CERT:/tls/cert.pem:ro" -v "$PANEL_TLS_KEY:/tls/key.pem:ro"
              -e POORIJA_PANEL_TLS_CERT=/tls/cert.pem -e POORIJA_PANEL_TLS_KEY=/tls/key.pem)
  elif [ "$PANEL_BIND" != 127.0.0.1 ] && [ "$PANEL_BIND" != localhost ]; then
    # The login (password and code) and the session cookie would cross the
    # network in the clear. Said plainly, every time it starts that way.
    warn "The panel listens on $PANEL_BIND without TLS: its login and session travel the LAN unencrypted."
    warn "Give it a certificate (--tls-cert FILE --tls-key FILE), or keep it on 127.0.0.1 and reach it through an SSH tunnel."
  fi
  origins="$scheme://127.0.0.1:$PANEL_PORT,$scheme://localhost:$PANEL_PORT"
  url="$scheme://127.0.0.1:$PANEL_PORT/"
  if [ -n "$PANEL_HOST" ] && [ "$PANEL_HOST" != 127.0.0.1 ] && [ "$PANEL_HOST" != localhost ]; then
    origins="$scheme://$PANEL_HOST:$PANEL_PORT,$origins"
    url="$scheme://$PANEL_HOST:$PANEL_PORT/"
  fi
  publish="$PANEL_BIND:$PANEL_PORT:8686"
  restart=no; [ "$PANEL_AUTOSTART" = yes ] && restart=unless-stopped
  access=ro; [ "$PANEL_WRITE" = yes ] && access=rw
  mkdir -p "$PANEL_SSH_DIR" 2>/dev/null || true
  if [ "$DRY" = 1 ]; then run docker rm -f "$NAME"; else docker rm -f "$NAME" >/dev/null 2>&1 || true; fi
  run docker run -d --name "$NAME" --restart "$restart" -p "$publish" \
    -e "POORIJA_PANEL_ORIGINS=$origins" -e "POORIJA_PANEL_HOST_SSH_DIR=$PANEL_SSH_DIR" \
    -v "$PANEL_CONFIG_DIR:/config:$access" -v "$PANEL_SSH_DIR:/ssh-src:ro" -v "$VOLUME:/state" \
    ${tls_args[@]+"${tls_args[@]}"} \
    "$image"
  say "✓ The central panel: $url"
  [ "$restart" = unless-stopped ] && say "  It comes back by itself whenever Docker starts. Change that with --reconfigure."
  if [ "$OPEN" = 1 ] && [ "$(uname -s)" = Darwin ]; then run open "$url"; fi
}

# ---- keeping it -------------------------------------------------------------
conf_value() { # conf_value NAME KEY — from deploy.conf, read by the shell that wrote it
  local file="$PANEL_CONFIG_DIR/deploy.conf" up
  up="$(printf %s "$1" | tr a-z A-Z)"
  [ -f "$file" ] || return 0
  ( set -a; . "$file" >/dev/null 2>&1; eval "printf '%s' \"\${${up}_$2:-}\"" )
}
doctor() {
  local failed=0 servers name host user port key jump
  mark() { if [ "$1" = 0 ]; then say "✓ $2"; else say "✗ $2"; failed=1; fi; }
  if [ "$DRY" = 1 ]; then
    say "check docker"; say "check config"
    servers="$( [ -f "$PANEL_CONFIG_DIR/deploy.conf" ] && ( set -a; . "$PANEL_CONFIG_DIR/deploy.conf" >/dev/null 2>&1; printf '%s' "${SERVERS:-}" ))"
    for name in $servers; do say "check key $name"; say "check ssh $name"; done
    say "check port $PANEL_PORT"
    [ -n "$PANEL_TLS_CERT" ] && say "check tls"
    return 0
  fi
  docker info >/dev/null 2>&1; mark $? "Docker is running"
  [ -f "$PANEL_CONFIG_DIR/deploy.conf" ]; mark $? "deploy.conf at $PANEL_CONFIG_DIR"
  servers="$( [ -f "$PANEL_CONFIG_DIR/deploy.conf" ] && ( set -a; . "$PANEL_CONFIG_DIR/deploy.conf" >/dev/null 2>&1; printf '%s' "${SERVERS:-}" ))"
  for name in $servers; do
    host="$(conf_value "$name" SSH_HOST)"; user="$(conf_value "$name" SSH_USER)"; port="$(conf_value "$name" SSH_PORT)"
    key="$(conf_value "$name" SSH_KEY)"; key="${key/#\~/$HOME}"; jump="$(conf_value "$name" JUMP)"
    if [ -n "$key" ] && [ ! -f "$key" ]; then mark 1 "$name: key $key not found (no login tried)"; continue; fi
    [ -n "$key" ] && mark 0 "$name: key found"
    local args=(-p "${port:-22}" -o BatchMode=yes -o ConnectTimeout=10)
    [ -n "$key" ] && args+=(-i "$key" -o IdentitiesOnly=yes)
    if [ -n "$jump" ]; then
      local jh jp ju jk; jh="$(conf_value "$jump" SSH_HOST)"; jp="$(conf_value "$jump" SSH_PORT)"; ju="$(conf_value "$jump" SSH_USER)"; jk="$(conf_value "$jump" SSH_KEY)"; jk="${jk/#\~/$HOME}"
      args+=(-o "ProxyCommand=ssh -p $(printf '%q' "${jp:-22}") -o BatchMode=yes${jk:+ -i $(printf '%q' "$jk") -o IdentitiesOnly=yes} $(printf '%q' "${ju:-$USER}@$jh") -W %h:%p")
    fi
    # One login, never retried: some servers lock out an address after a few failures.
    ssh "${args[@]}" "${user:-$USER}@$host" true >/dev/null 2>&1; mark $? "$name: SSH login to ${user:-$USER}@$host${jump:+ through $jump}"
  done
  port_free "$PANEL_PORT"; mark $? "port $PANEL_PORT free (or the panel's own)"
  if [ -n "$PANEL_TLS_CERT" ]; then [ -f "$PANEL_TLS_CERT" ] && [ -f "$PANEL_TLS_KEY" ]; mark $? "TLS certificate and key"; fi
  return $failed
}
backup_state() {
  local file="${FILE_ARG:-$HOME/p00rija-panel-backup-$(date +%Y%m%d-%H%M%S).tar.gz}" image
  [ -d "$(dirname "$file")" ] || die "no folder for $file"
  image="${PANEL_IMAGE:-$(image_ref)}"
  ensure_docker
  # Streamed out and written here, owner-only: the file holds the login's hash
  # and the authenticator secret, and a file made inside the container would
  # be root's and readable by everyone.
  if [ "$DRY" = 1 ]; then
    printf '+ (umask 077) docker run --rm -v %s:/state --entrypoint sh %s -c tar czf - -C /state . > %s\n' "$VOLUME" "$image" "$file"
  else
    ( umask 077; docker run --rm -v "$VOLUME:/state" --entrypoint sh "$image" -c 'tar czf - -C /state .' > "$file" ) || die "the backup failed"
    chmod 600 "$file"
  fi
  say "✓ The panel's state (login, trust, layout, sessions, log) is in $file, readable by you only. Keep it private."
}
restore_state() {
  [ -n "$FILE_ARG" ] || die "restore needs the backup file: bash scripts/panel.sh restore FILE"
  [ -f "$FILE_ARG" ] || die "no backup at $FILE_ARG"
  local image
  image="${PANEL_IMAGE:-$(image_ref)}"
  ensure_docker
  run docker stop "$NAME" || true
  if [ "$DRY" = 1 ]; then
    printf '+ docker run --rm -i -v %s:/state --entrypoint sh %s -c tar xzf - -C /state < %s\n' "$VOLUME" "$image" "$FILE_ARG"
  else
    docker run --rm -i -v "$VOLUME:/state" --entrypoint sh "$image" -c 'tar xzf - -C /state && chown -R node:node /state' < "$FILE_ARG" || die "the restore failed"
  fi
  run docker start "$NAME" || true
  say "✓ Restored from $FILE_ARG"
}
uninstall_panel() {
  local image="${PANEL_IMAGE:-$(image_ref)}" answer=""
  ensure_docker
  run docker rm -f "$NAME" || true
  run docker rmi "$image" || true
  if [ "$PURGE" = 1 ]; then
    if [ "$YES" = 0 ]; then
      printf 'Also delete the panel login, its trust and layout (the panel-state volume) and %s? (yes/no) [no]: ' "$SETTINGS" >&2
      IFS= read -r answer || answer=""
      case "$answer" in y|Y|yes|YES|بله) ;; *) say "Kept the login and settings."; return 0 ;; esac
    fi
    run docker volume rm "$VOLUME" || true
    if [ "$DRY" = 1 ]; then printf '+ rm %s\n' "$SETTINGS"; else rm -f "$SETTINGS"; fi
  fi
  say "✓ The panel is uninstalled.$([ "$PURGE" = 1 ] || printf ' Its login and settings are kept; --purge removes them too.')"
}

case "$COMMAND" in
  start) start ;;
  doctor) doctor ;;
  backup) backup_state ;;
  restore) restore_state ;;
  uninstall) uninstall_panel ;;
  update) SOURCE="${SOURCE:-}"; YES=1; start ;;
  stop) run docker stop "$NAME" ;;
  status) run docker ps -a --filter "name=^${NAME}\$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}' ;;
  logs) run docker logs --tail 200 -f "$NAME" ;;
  login)
    ensure_docker
    image="${PANEL_IMAGE:-$(image_ref)}"
    [ "$DRY" = 1 ] || [ -t 0 ] || die "login needs a terminal: you type the name and password yourself"
    run docker run --rm -it -v "$VOLUME:/state" "$image" setup-login ${LOGIN_ARGS[@]+"${LOGIN_ARGS[@]}"}
    say "Restart the panel to use the new login:  bash scripts/panel.sh" ;;
esac
exit
}
