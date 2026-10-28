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
# and where your deploy.conf and SSH keys are. deploy.conf is looked for in
# ~/.config/p00rija-cryptography (POORIJA_CONFIG_DIR and XDG_CONFIG_HOME move
# that, as for the other tools); one in the folder you run it from, or beside
# this script, is asked about at a terminal and used only if you type yes. The
# keys: the folder in ~/.ssh that deploy.conf names them in. Its own checkout
# it finds where this file really is, through any symlink, so it runs the
# same from any folder. The answers are kept in
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
#   --config-dir DIR    where deploy.conf is (looked for as above)
#   --ssh-dir DIR       the SSH keys deploy.conf names (their folder in ~/.ssh, else ~/.ssh)
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
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
SETTINGS="${POORIJA_PANEL_SETTINGS:-$CONFIG_HOME/p00rija-cryptography/panel.env}"
# Where this file really is, whatever folder it is run from: a symlink (one in
# PATH, say) is followed to the file it names. Piped into bash there is no file
# at all, and so no checkout either.
CALLED="${BASH_SOURCE[0]:-}"
SELF="$CALLED"
while [ -n "$SELF" ] && [ -L "$SELF" ]; do
  link="$(readlink "$SELF")"
  case "$link" in /*) SELF="$link" ;; *) SELF="$(dirname "$SELF")/$link" ;; esac
done
HERE="" ROOT=""
if [ -n "$SELF" ] && [ -f "$SELF" ]; then
  HERE="$(CDPATH='' cd -- "$(dirname -- "$SELF")" && pwd)"
  ROOT="$(CDPATH='' cd -- "$HERE/.." && pwd)"
fi
IN_CHECKOUT=0
[ -n "$ROOT" ] && [ -f "$ROOT/config/Dockerfile.control-panel" ] && [ -f "$ROOT/package.json" ] && IN_CHECKOUT=1
# The hints it prints name it the way it was called, so they can be pasted.
if [ -n "$CALLED" ] && [ -f "$CALLED" ]; then INVOKE="bash $(printf '%q' "$CALLED")"; else INVOKE="bash panel.sh"; fi

say()  { printf '%s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

usage() {
  local line
  if [ -n "$SELF" ] && [ -r "$SELF" ]; then
    sed -n '/^# The central panel in a container/,/^# ------/p' "$SELF" | sed 's/^# \{0,1\}//; /^-----/d' |
      while IFS= read -r line; do
        # Cut and joined, not ${//}: bash 5.2 reads & in a replacement as the match.
        case "$line" in *"bash scripts/panel.sh"*) line="${line%%bash scripts/panel.sh*}$INVOKE${line#*bash scripts/panel.sh}" ;; esac
        printf '%s\n' "$line"
      done
  else
    # Piped into bash: no file to read these notes from.
    cat <<'EOF'
The central panel in a container (docs/CONTROL-PANEL.md, docs/DOCKER.md).
Keep the script to run it again:
  curl -fsSLO https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/panel.sh

  bash panel.sh [start] | stop | status | logs | update | login [--new-code]
  bash panel.sh doctor | backup [FILE] | restore FILE | uninstall [--purge]

Options: --port N  --bind ADDR  --host NAME  --autostart yes|no
         --config-dir DIR  --ssh-dir DIR  --tls-cert FILE  --tls-key FILE
         --write  --build | --pull  --yes  --reconfigure  --no-open  --dry-run
EOF
  fi
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
PANEL_CONFIG_DIR="" PANEL_SSH_DIR="" PANEL_WRITE=no PANEL_IMAGE=""
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

# ---- where deploy.conf and the keys are ------------------------------------------
# Looked for, never assumed. deploy.conf: --config-dir, then POORIJA_CONFIG_DIR,
# then the saved answer, then the usual folder. One found in the folder it is
# run from, or beside this script, names the servers the panel connects to, so
# it is only offered, at a terminal, and used on a yes typed there — never by
# default, on --yes, or down a pipe. Like the panel, the launcher reads
# deploy.conf as data and never runs it. The keys: --ssh-dir, then the saved answer,
# then the narrowest folder in ~/.ssh holding every key deploy.conf names, then
# ~/.ssh itself: a folder anywhere else reaches the container only by --ssh-dir.
is_deploy_conf() { # a deploy.conf of ours, not of something else
  [ -f "$1/deploy.conf" ] && grep -Eq '^[[:space:]]*(export[[:space:]]+)?SERVERS=' "$1/deploy.conf" 2>/dev/null
}
found_config_dir() { # a deploy.conf where it is run, or beside it: offered, never taken unasked
  local dir
  for dir in "$PWD" "$HERE"; do
    if [ -n "$dir" ] && is_deploy_conf "$dir"; then whole_path "$dir"; return 0; fi
  done
}
conf_clean() { # a value as deploy.conf spells it: quotes and a trailing comment off, ~ and $HOME this computer's home
  local value="$1"
  value="${value%%[[:space:]]#*}"; value="${value%"${value##*[![:space:]]}"}"
  value="${value#[\"\']}"; value="${value%[\"\']}"
  case "$value" in "~/"*) value="$HOME/${value#\~/}" ;; '$HOME/'*) value="$HOME/${value#\$HOME/}" ;; '${HOME}/'*) value="$HOME/${value#\$\{HOME\}/}" ;; esac
  printf '%s' "$value"
}
conf_keys() { # every SSH key deploy.conf names, one a line — read as data, never run
  local file="$1/deploy.conf" key
  [ -f "$file" ] || return 0
  sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}[A-Za-z0-9_]*_SSH_KEY=//p' "$file" |
    while IFS= read -r key; do
      key="$(conf_clean "$key")"
      if [ -n "$key" ]; then printf '%s\n' "$key"; fi
    done
}
find_ssh_dir() { # the narrowest folder in ~/.ssh holding every key deploy.conf names
  local dir="" key
  while IFS= read -r key; do
    case "$key" in /*) ;; *) continue ;; esac
    if [ -z "$dir" ]; then dir="$(dirname "$key")"; continue; fi
    while [ "$dir" != / ] && [ "${key#"$dir"/}" = "$key" ]; do dir="$(dirname "$dir")"; done
  done <<EOF
$(conf_keys "$1")
EOF
  # deploy.conf may have come from anywhere: it never picks a folder outside
  # ~/.ssh to hand the container (the home folder, say). That takes --ssh-dir.
  case "$dir" in "$HOME/.ssh"|"$HOME/.ssh/"*) ;; *) dir="$HOME/.ssh" ;; esac
  printf '%s' "$dir"
}
whole_path() { # ~ and a relative path made whole, against the folder it is run from: Docker takes anything else for a volume's name
  local p="$1" parent
  case "$p" in '') return 0 ;; '~') p="$HOME" ;; '~/'*) p="$HOME/${p#\~/}" ;; esac
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  if [ -d "$p" ]; then
    p="$(CDPATH='' cd -- "$p" && pwd)"
  elif [ -d "$(dirname -- "$p")" ]; then
    parent="$(CDPATH='' cd -- "$(dirname -- "$p")" && pwd)"; p="${parent%/}/$(basename -- "$p")"
  fi
  while [ "$p" != / ] && [ "${p%/}" != "$p" ]; do p="${p%/}"; done
  printf '%s' "$p"
}
[ -n "${POORIJA_CONFIG_DIR:-}" ] && PANEL_CONFIG_DIR="$POORIJA_CONFIG_DIR"
[ -n "$F_CONFIG" ] && PANEL_CONFIG_DIR="$F_CONFIG"
CONFIG_CHOSEN=1
[ -n "$PANEL_CONFIG_DIR" ] || { PANEL_CONFIG_DIR="$CONFIG_HOME/p00rija-cryptography"; CONFIG_CHOSEN=0; }
SSH_CHOSEN=0
[ -n "$PANEL_SSH_DIR" ] && SSH_CHOSEN=1
[ -n "$F_SSH" ] && PANEL_SSH_DIR="$F_SSH" && SSH_CHOSEN=1
PANEL_CONFIG_DIR="$(whole_path "$PANEL_CONFIG_DIR")"
[ "$SSH_CHOSEN" = 1 ] || PANEL_SSH_DIR="$(find_ssh_dir "$PANEL_CONFIG_DIR")"
PANEL_SSH_DIR="$(whole_path "$PANEL_SSH_DIR")"
FOUND_CONFIG=""
[ "$CONFIG_CHOSEN" = 1 ] || FOUND_CONFIG="$(found_config_dir)"
[ "$FOUND_CONFIG" != "$PANEL_CONFIG_DIR" ] || FOUND_CONFIG=""

FOUND_ASKED=0
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
    if [ -z "$F_CONFIG" ]; then
      # Its own question, no by default, and only at a terminal: an Enter, or
      # a line down a pipe, never takes a deploy.conf found where this runs.
      local use_found=no
      if [ -n "$FOUND_CONFIG" ] && [ -t 0 ]; then
        ask_yes_no use_found "Use the deploy.conf found in $FOUND_CONFIG? It names the servers the panel connects to (yes/no)"
        FOUND_ASKED=1
      fi
      if [ "$use_found" = yes ]; then PANEL_CONFIG_DIR="$FOUND_CONFIG"; else ask PANEL_CONFIG_DIR "Folder with deploy.conf"; fi
    fi
    PANEL_CONFIG_DIR="$(whole_path "$PANEL_CONFIG_DIR")"
    [ "$SSH_CHOSEN" = 1 ] || PANEL_SSH_DIR="$(find_ssh_dir "$PANEL_CONFIG_DIR")"
    [ -z "$F_SSH" ] && ask PANEL_SSH_DIR "Folder with the SSH keys"
    if [ -z "$F_WRITE" ]; then
      # The panel adds and removes servers in deploy.conf, and signs the family
      # list where operator-key.json is: offered always, yes by default there.
      [ "$HAVE_SETTINGS" = 0 ] && [ -f "$PANEL_CONFIG_DIR/operator-key.json" ] && PANEL_WRITE=yes
      ask_yes_no PANEL_WRITE "Let the panel edit deploy.conf and sign the family list? (yes/no)"
    fi
  fi
  if [ -n "$FOUND_CONFIG" ] && [ "$FOUND_ASKED" = 0 ] && [ "$(whole_path "$PANEL_CONFIG_DIR")" != "$FOUND_CONFIG" ]; then
    warn "A deploy.conf is in $FOUND_CONFIG; one found where this runs is used only on a yes typed at a terminal. Pass --config-dir $FOUND_CONFIG to use it."
  fi
  PANEL_CONFIG_DIR="$(whole_path "$PANEL_CONFIG_DIR")" PANEL_SSH_DIR="$(whole_path "$PANEL_SSH_DIR")"
  PANEL_TLS_CERT="$(whole_path "$PANEL_TLS_CERT")" PANEL_TLS_KEY="$(whole_path "$PANEL_TLS_KEY")"
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
  [ -t 0 ] || die "The panel has no login yet. Run this same command in a terminal, so you can type your own name and password: $INVOKE"
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
  say "▶ deploy.conf from $PANEL_CONFIG_DIR, SSH keys from $PANEL_SSH_DIR"
  is_deploy_conf "$PANEL_CONFIG_DIR" || warn "There is no deploy.conf in $PANEL_CONFIG_DIR yet: the panel starts with no servers. Pass --config-dir FOLDER, or add them in the page (--write)."
  local key outside=""
  while IFS= read -r key; do
    case "$key" in "$PANEL_SSH_DIR"/*|'') ;; *) outside="$outside $key" ;; esac
  done <<EOF
$(conf_keys "$PANEL_CONFIG_DIR")
EOF
  [ -z "$outside" ] || warn "deploy.conf names keys outside $PANEL_SSH_DIR:$outside — the panel sees only that folder, so it looks for them there by name. Pass --ssh-dir FOLDER if they are elsewhere."
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
conf_get() { # conf_get VAR — from deploy.conf, read as data as the panel reads it, never run
  local file="$PANEL_CONFIG_DIR/deploy.conf"
  case "$1" in ''|*[!A-Za-z0-9_]*) return 0 ;; esac
  [ -f "$file" ] || return 0
  conf_clean "$(sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}$1=//p" "$file" | tail -n 1)"
}
conf_value() { # conf_value NAME KEY
  conf_get "$(printf %s "$1" | tr a-z A-Z | tr -c 'A-Z0-9' _)_$2"
}
doctor() {
  local failed=0 servers name host user port key jump
  mark() { if [ "$1" = 0 ]; then say "✓ $2"; else say "✗ $2"; failed=1; fi; }
  if [ "$DRY" = 1 ]; then
    say "check docker"; say "check config"
    servers="$(conf_get SERVERS)"
    for name in $servers; do say "check key $name"; say "check ssh $name"; done
    say "check port $PANEL_PORT"
    [ -n "$PANEL_TLS_CERT" ] && say "check tls"
    return 0
  fi
  docker info >/dev/null 2>&1; mark $? "Docker is running"
  [ -f "$PANEL_CONFIG_DIR/deploy.conf" ]; mark $? "deploy.conf at $PANEL_CONFIG_DIR"
  servers="$(conf_get SERVERS)"
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
backup_dir() { # the folder it is run from, but never inside the checkout: the file holds the login's secrets
  local here root
  here="$(pwd -P)"
  if [ "$IN_CHECKOUT" = 1 ]; then
    root="$(CDPATH='' cd -- "$ROOT" && pwd -P)"
    if [ "$here" = "$root" ] || [ "${here#"$root"/}" != "$here" ]; then printf '%s' "$HOME"; return 0; fi
  fi
  printf '%s' "$PWD"
}
backup_state() {
  local file="${FILE_ARG:-$(backup_dir)/p00rija-panel-backup-$(date +%Y%m%d-%H%M%S).tar.gz}" image
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
  [ -n "$FILE_ARG" ] || die "restore needs the backup file: $INVOKE restore FILE"
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
    say "Restart the panel to use the new login:  $INVOKE" ;;
esac
exit
}
