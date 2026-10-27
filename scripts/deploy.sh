#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Ships this working tree to YOUR server and rebuilds it there.
#
# The first run asks where your server is and remembers the answers. Every run
# after that just deploys. Nothing about any particular server is baked into
# this file, so it is the same script for everybody who self-hosts.
#
#   bash scripts/deploy.sh                 # copy, rebuild, verify — EVERY server
#   bash scripts/deploy.sh --server ir     # only that one
#   bash scripts/deploy.sh --check         # verify what is live, change nothing
#   bash scripts/deploy.sh --dry-run       # show what would be copied
#   bash scripts/deploy.sh --skip-bump     # server/config-only change
#   bash scripts/deploy.sh --reconfigure   # ask for the server details again
#   bash scripts/deploy.sh --edit          # open the saved settings in $EDITOR
#   bash scripts/deploy.sh --where         # print where the settings are kept
#   bash scripts/deploy.sh --help
#
# Settings live OUTSIDE this repository, in
#   ${XDG_CONFIG_HOME:-~/.config}/p00rija-cryptography/deploy.conf
# with owner-only permissions, so your host name, account and key path are
# never something a `git add .` can pick up by accident.
#
# Environment variables still win over the file, which is what a CI job wants:
#   POORIJA_SSH_HOST   POORIJA_SSH_USER   POORIJA_SSH_PORT
#   POORIJA_SSH_KEY    POORIJA_REMOTE_DIR POORIJA_PUBLIC_URL
#
# Key authentication only, deliberately. A password passed on a command line
# lands in the process table, where every other user on the machine can read it
# while it runs, and in the shell history afterwards. For a server whose whole
# job is running a cryptography suite that is not a reasonable trade.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INFO='\033[1;34m'; OK='\033[1;32m'; WARN='\033[1;33m'; ERR='\033[1;31m'; DIM='\033[2m'; NC='\033[0m'
log()  { printf "${INFO}▶ %s${NC}\n" "$1"; }
ok()   { printf "${OK}✓ %s${NC}\n" "$1"; }
warn() { printf "${WARN}! %s${NC}\n" "$1"; }
fail() { printf "${ERR}✖ %s${NC}\n" "$1"; }
dim()  { printf "${DIM}%s${NC}\n" "$1"; }

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/p00rija-cryptography"
CONFIG_FILE="$CONFIG_DIR/deploy.conf"

usage() {
    cat <<USAGE
Deploy this working tree to your own server.

  bash scripts/deploy.sh [option]

Options
  (none)          Copy the tree, rebuild the containers, verify what is served.
                  With more than one server configured, all of them in turn.
  --server NAME   Only that server, by the name it has in SERVERS.
  --check         Only report what the server is serving. Changes nothing.
  --dry-run       Show what rsync would copy. Changes nothing.
  --skip-bump     Skip the version bump on the server; for a change that
                  touched only the server config.
  --prebuilt      Build every image once, here, for linux/amd64, and have each
                  server pull them (only the layers it lacks) through an SSH
                  tunnel from a registry on 127.0.0.1 here: every server runs
                  the same images, and none has to reach npm or Docker Hub.
                  <NAME>_JUMP='<other server>' in the settings sends a slow
                  server's connections through a faster one.
  --reconfigure   Ask for the server details again and overwrite the saved ones.
  --edit          Open the saved settings in \$EDITOR.
  --where         Print the path of the settings file.
  --help, -h      This text.

First run
  You are asked for the host, the account, the SSH port, the key and the public
  URL, and the answers are written to
      $CONFIG_FILE
  (owner-only, outside the repository). Later runs read them.

What it needs on the server
  An install of this project with config/docker-compose.yaml, its own .env and
  certs/, reachable over SSH with key authentication, and an account that can
  talk to Docker. The script tells you exactly what to run if either is missing.

What it never touches
  data/, certs/ and .env on the server. Those hold the offline mailboxes, the
  TLS material and the secrets, none of which live in this repository.

Environment (wins over the saved settings)
  POORIJA_SSH_HOST   POORIJA_SSH_USER   POORIJA_SSH_PORT
  POORIJA_SSH_KEY    POORIJA_REMOTE_DIR POORIJA_PUBLIC_URL
USAGE
}

MODE="deploy"
SKIP_BUMP=""
PREBUILT=""
WANT_RECONFIGURE=0
ONLY_SERVER=""
# A while loop rather than `for arg in "$@"`, because --server takes a value
# and `shift` inside a for loop does not move what the for loop is walking:
# the value came back round as an option of its own and was rejected as
# unknown.
while [ $# -gt 0 ]; do
    case "$1" in
        --check) MODE="check" ;;
        --dry-run) MODE="dry-run" ;;
        --skip-bump) SKIP_BUMP="--skip-bump" ;;
        --prebuilt) PREBUILT="--prebuilt" ;;
        --reconfigure|--configure) WANT_RECONFIGURE=1 ;;
        --server)
            ONLY_SERVER="${2:-}"
            [ -n "$ONLY_SERVER" ] || { fail "--server needs a name."; exit 2; }
            shift ;;
        --server=*) ONLY_SERVER="${1#*=}" ;;
        --edit) MODE="edit" ;;
        --where|--config) MODE="where" ;;
        --help|-h) usage; exit 0 ;;
        *) fail "Unknown option: $1"; echo; usage; exit 2 ;;
    esac
    shift
done

if [ "$MODE" = "where" ]; then
    printf '%s\n' "$CONFIG_FILE"
    [ -f "$CONFIG_FILE" ] || dim "(not created yet — the first deploy writes it)"
    exit 0
fi

# ------------------------------------------------------------------- settings
#
# Read, then ask for whatever is still missing, then write. Kept as plain
# KEY='value' lines so --edit is an ordinary text edit and a person can see at
# a glance what this script knows about their machine.
load_config() {
    [ -f "$CONFIG_FILE" ] || return 0
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
}

save_config() {
    mkdir -p "$CONFIG_DIR"
    umask 077
    cat > "$CONFIG_FILE" <<CONF
# P00RIJA Cryptography — deployment settings for this machine.
# Written by scripts/deploy.sh. Safe to edit by hand; it is plain shell.
# Deliberately outside the repository: nothing here belongs in a commit.

SSH_HOST='$SSH_HOST'
SSH_USER='$SSH_USER'
SSH_PORT='$SSH_PORT'
# Path to the PRIVATE key. Leave empty to let ssh pick from its own agent/config.
SSH_KEY='$SSH_KEY'
# The install directory on the server. Empty means "find it on each run".
REMOTE_DIR='$REMOTE_DIR'
# What the app is served as, used to verify the deployment afterwards.
PUBLIC_URL='$PUBLIC_URL'
CONF
    # More than one server, written back rather than dropped.
    #
    # This function used to emit only the six single-server keys, so anybody
    # who ran --reconfigure on a two-server setup silently lost the second
    # server and every deployment afterwards went to one of them. A settings
    # file that a settings command can destroy is worse than no settings file.
    if [ -n "${SERVERS:-}" ]; then
        {
            echo
            echo "# Every server this tree deploys to, in the order they are done."
            echo "# The keys for each are prefixed with its name in upper case."
            echo "SERVERS='$SERVERS'"
            for name in $SERVERS; do
                upper="$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]' | tr -c '[:alnum:]' '_')"
                echo
                for field in ROLE SSH_HOST SSH_USER SSH_PORT SSH_KEY REMOTE_DIR PUBLIC_URL; do
                    eval "value=\${${upper}_${field}:-}"
                    printf "%s_%s='%s'\n" "$upper" "$field" "$value"
                done
                # The family's and the deploy's own fields, kept when set: a
                # rewrite used to drop them.
                for field in REGION GATEWAY CLUSTER INSIDE JUMP; do
                    eval "value=\${${upper}_${field}:-}"
                    [ -n "$value" ] && printf "%s_%s='%s'\n" "$upper" "$field" "$value"
                done
            done
        } >> "$CONFIG_FILE"
    fi
    chmod 600 "$CONFIG_FILE"
}

ask() {
    # ask <prompt> <default> <variable name>
    local prompt="$1" fallback="$2" name="$3" answer=""
    if [ -n "$fallback" ]; then
        printf "  %s [%s]: " "$prompt" "$fallback"
    else
        printf "  %s: " "$prompt"
    fi
    IFS= read -r answer || answer=""
    [ -z "$answer" ] && answer="$fallback"
    printf -v "$name" '%s' "$answer"
}

configure() {
    if [ ! -t 0 ]; then
        fail "No saved settings, and nothing to read them from."
        echo "  Run it once in a terminal so it can ask:"
        echo "      bash scripts/deploy.sh --reconfigure"
        echo "  Or pass them in the environment:"
        echo "      POORIJA_SSH_HOST=… POORIJA_SSH_USER=… bash scripts/deploy.sh"
        exit 2
    fi
    echo
    log "Where does this deploy to?"
    dim "  Saved to $CONFIG_FILE — outside the repository, readable only by you."
    echo
    while :; do
        ask "Server host or IP" "$SSH_HOST" SSH_HOST
        [ -n "$SSH_HOST" ] && break
        warn "  A host is required."
    done
    ask "SSH account" "${SSH_USER:-$USER}" SSH_USER
    ask "SSH port" "${SSH_PORT:-22}" SSH_PORT
    ask "Private key (empty = use your ssh agent/config)" "$SSH_KEY" SSH_KEY
    ask "Install directory on the server (empty = find it)" "$REMOTE_DIR" REMOTE_DIR
    ask "Public URL of the app" "${PUBLIC_URL:-https://$SSH_HOST:8585}" PUBLIC_URL
    echo
    save_config
    ok "saved to $CONFIG_FILE"
    echo
}

SSH_HOST=""; SSH_USER=""; SSH_PORT=""; SSH_KEY=""; REMOTE_DIR=""; PUBLIC_URL=""
SERVERS=""
load_config

# ---------------------------------------------------------------- the family
#
# The servers in one settings file are one operator's relays, and they link
# with each other by themselves once they share a signed directory
# (docs/RELAY-NETWORK.md, "Relay families"). The first time, this makes the
# operator key on this machine and says where it is; after that it adds any
# server the directory lacks, signs when the list changed, and hands the
# directory to every server. A single server is a family of one and its own
# gateway, which is what lets it link with other operators' relays later. A
# failure here leaves the deployment itself as it was. POORIJA_DIRECTORY=0
# turns it off.
family_sync() {
    [ "${POORIJA_DIRECTORY:-1}" != "0" ] || return 0
    [ "$MODE" != "check" ] && [ "$MODE" != "dry-run" ] || return 0
    echo
    log "Relay family: the signed directory of these servers"
    if ! command -v node >/dev/null 2>&1; then
        warn "node is not installed here, so the directory was not updated"
    elif POORIJA_CONFIG_DIR="$CONFIG_DIR" node "$(dirname "$0")/../tools/relay-directory.mjs" sync; then
        ok "every server has the family's directory"
    else
        warn "the directory did not reach every server directly; the relays pass it on themselves"
        echo "  To hand it over again: node tools/relay-directory.mjs publish"
    fi
}

# ------------------------------------------------------------- built here once
#
# --prebuilt: the images are built on this machine, for the servers'
# architecture, and pushed to a registry that answers on this machine's
# 127.0.0.1 only. Each server pulls them through a reverse SSH tunnel, which
# brings only the layers it does not hold yet, so every server runs the same
# image digests and a release after the first moves only what changed. The
# registry stays up between deploys for that reason (poorija-deploy-registry).
REGISTRY_PORT="${POORIJA_REGISTRY_PORT:-5055}"
REGISTRY="127.0.0.1:$REGISTRY_PORT"
# What scripts/server-backup.sh runs as alpine:latest, pinned here.
ALPINE_TAG="3.24.3"
coturn_image() { sed -n 's/^ *image: *\(coturn\/coturn:[^ ]*\).*/\1/p' "$(dirname "$0")/../config/docker-compose.yaml" | head -1; }
tree_version() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$(dirname "$0")/../package.json" | head -1; }
prebuilt_build() {
    log "Building the images here, once, for every server (linux/amd64)"
    command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || { fail "--prebuilt needs Docker running on this machine."; return 1; }
    if ! docker ps --format '{{.Names}}' | grep -Fxq poorija-deploy-registry; then
        docker rm -f poorija-deploy-registry >/dev/null 2>&1
        docker run -d --restart unless-stopped --name poorija-deploy-registry -p "$REGISTRY:5000" \
            -v poorija-deploy-registry:/var/lib/registry registry:3.1.2 >/dev/null || { fail "could not start the local registry"; return 1; }
        sleep 2
    fi
    local version root
    version="$(tree_version)"
    root="$(cd "$(dirname "$0")/.." && pwd)"
    for spec in "poorija-crypto config/Dockerfile" "poorija-chat-signal config/Dockerfile.chat-signal" "poorija-cert-renewer config/Dockerfile.cert-renewer"; do
        set -- $spec
        printf "  %s:%s\n" "$1" "$version"
        # Cached on what goes in (files by content, pinned versions), so a
        # release moves only the layers that changed.
        docker buildx build --platform linux/amd64 --pull --provenance=false --sbom=false \
            -f "$root/$2" -t "$REGISTRY/$1:$version" --push "$root" >/tmp/poorija-prebuilt-$1.log 2>&1 \
            || { fail "building $1 failed:"; tail -15 /tmp/poorija-prebuilt-$1.log | sed 's/^/    /'; return 1; }
    done
    for base in "$(coturn_image)" "alpine:$ALPINE_TAG"; do
        printf "  %s\n" "$base"
        printf 'FROM %s\n' "$base" | docker buildx build --platform linux/amd64 --pull --provenance=false --sbom=false \
            -t "$REGISTRY/$base" --push - >/tmp/poorija-prebuilt-base.log 2>&1 \
            || { fail "copying $base failed:"; tail -10 /tmp/poorija-prebuilt-base.log | sed 's/^/    /'; return 1; }
    done
    ok "built and held at $REGISTRY for this run"
}

# --------------------------------------------------------------- more than one
#
# Two servers that are meant to stay in step have to be deployed from one tree
# in one run, or they drift — and drift between two relays that carry for each
# other is the kind that shows up as messages not arriving rather than as an
# error.
#
# This is a dispatcher and nothing more. It re-runs THIS script once per
# server with that server's details in the environment, which the body below
# already reads. The deployment, the snapshot and the verification are the same
# code they have always been; only the number of times they run has changed.
#
# A config with no SERVERS line is a single server and takes the old path
# untouched.
if [ -n "${SERVERS:-}" ] && [ -z "${POORIJA_SERVER_NAME:-}" ]; then
    WANTED="$SERVERS"
    if [ -n "$ONLY_SERVER" ]; then
        case " $SERVERS " in
            *" $ONLY_SERVER "*) WANTED="$ONLY_SERVER" ;;
            *) fail "No server called '$ONLY_SERVER'. Configured: $SERVERS"; exit 2 ;;
        esac
    fi

    # Rebuilt from what was actually understood rather than from "$@", which
    # the parser above has already consumed. --server is not passed on: the
    # child run is one server by construction.
    # Expanded as ${ARGS[@]+"${ARGS[@]}"} below, not "${ARGS[@]}": under
    # `set -u` bash 3.2 — which is what macOS ships — treats an empty array
    # expansion as an unbound variable and dies. A plain deployment passes no
    # extra arguments at all, so the empty case is the common one.
    ARGS=()
    [ "$MODE" = "check" ] && ARGS+=(--check)
    [ "$MODE" = "dry-run" ] && ARGS+=(--dry-run)
    [ -n "$SKIP_BUMP" ] && ARGS+=("$SKIP_BUMP")
    [ -n "$PREBUILT" ] && ARGS+=("$PREBUILT")
    if [ -n "$PREBUILT" ] && [ "$MODE" = "deploy" ]; then
        prebuilt_build || exit 1
        export POORIJA_PREBUILT_DONE=1
        POORIJA_PREBUILT_REPORT="$(mktemp)"
        export POORIJA_PREBUILT_REPORT
    fi

    OVERALL=0
    SERVED=""
    for name in $WANTED; do
        upper="$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]' | tr -c '[:alnum:]' '_')"
        eval "s_host=\${${upper}_SSH_HOST:-}"
        eval "s_user=\${${upper}_SSH_USER:-}"
        eval "s_port=\${${upper}_SSH_PORT:-}"
        eval "s_key=\${${upper}_SSH_KEY:-}"
        eval "s_dir=\${${upper}_REMOTE_DIR:-}"
        eval "s_url=\${${upper}_PUBLIC_URL:-}"
        eval "s_role=\${${upper}_ROLE:-app}"
        eval "s_jump=\${${upper}_JUMP:-}"
        jump=""
        if [ -n "$s_jump" ]; then
            ju="$(printf '%s' "$s_jump" | tr '[:lower:]' '[:upper:]' | tr -c '[:alnum:]' '_')"
            eval "j_host=\${${ju}_SSH_HOST:-}"; eval "j_user=\${${ju}_SSH_USER:-$USER}"; eval "j_port=\${${ju}_SSH_PORT:-22}"; eval "j_key=\${${ju}_SSH_KEY:-}"
            [ -n "$j_host" ] && jump="$j_user@$j_host:$j_port|$j_key"
        fi
        if [ -z "$s_host" ]; then
            fail "SERVERS names '$name' but ${upper}_SSH_HOST is not set in $CONFIG_FILE"
            OVERALL=1
            continue
        fi
        echo
        printf "${INFO}════ %s  (%s) ════${NC}\n" "$name" "$s_host"
        POORIJA_SERVER_NAME="$name" \
        POORIJA_SSH_HOST="$s_host" \
        POORIJA_SSH_USER="${s_user:-$USER}" \
        POORIJA_SSH_PORT="${s_port:-22}" \
        POORIJA_SSH_KEY="$s_key" \
        POORIJA_REMOTE_DIR="$s_dir" \
        POORIJA_PUBLIC_URL="${s_url:-https://$s_host:8585}" \
        POORIJA_ROLE="$s_role" \
        POORIJA_SSH_JUMP="$jump" \
            bash "$0" ${ARGS[@]+"${ARGS[@]}"}
        child=$?
        [ "$child" -eq 0 ] || OVERALL=1
        SERVED="$SERVED $name|$s_role|$child|${s_url:-https://$s_host:8585}"
    done

    # The point of deploying together: afterwards they have to agree. Asked of
    # the servers rather than assumed from the fact that the copies succeeded.
    echo
    log "Are they in step?"
    TREE_TAG="$(grep -oE '\?v=[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9._-]+' index.html | head -1 | sed 's/^?v=//')"
    MISMATCH=0
    TREE_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
    for entry in $SERVED; do
        n="${entry%%|*}"; rest="${entry#*|}"; r="${rest%%|*}"; rest="${rest#*|}"; c="${rest%%|*}"; u="${rest#*|}"
        if [ "$r" = "relay" ]; then
            live="$(curl -sk --retry 1 --retry-delay 1 --max-time 20 "$u/chat-health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
            want="$TREE_VERSION"
        else
            live="$(curl -sk --retry 1 --retry-delay 1 --max-time 20 "$u/index.html" \
                | grep -oE '\?v=[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9._-]+' | head -1 | sed 's/^?v=//')"
            want="$TREE_TAG"
        fi
        if [ "$live" = "$want" ]; then
            printf "  %-14s %-7s %s\n" "$n" "$r" "$live"
        elif [ -z "$live" ] && [ "$c" = "0" ]; then
            # Verified on the server itself; this machine just cannot reach
            # it (TLS into Iran is filtered from outside, for one).
            printf "  %-14s %-7s %s\n" "$n" "$r" "verified on the server (not reachable from here)"
        else
            printf "  %-14s %-7s %s  (tree is %s)\n" "$n" "$r" "${live:-no answer}" "$want"
            MISMATCH=1
        fi
    done
    if [ "$MISMATCH" -eq 0 ] && [ "$OVERALL" -eq 0 ]; then
        ok "every server is serving $TREE_TAG"
    else
        fail "the servers are not all serving the same build"
        OVERALL=1
    fi
    # The images themselves, by digest, as each server reported them.
    if [ -n "${POORIJA_PREBUILT_REPORT:-}" ] && [ -s "$POORIJA_PREBUILT_REPORT" ]; then
        echo
        log "The images each server runs"
        sed 's/^/  /' "$POORIJA_PREBUILT_REPORT"
        if [ "$(cut -d' ' -f2- "$POORIJA_PREBUILT_REPORT" | sort -u | wc -l | tr -d ' ')" = "1" ]; then
            ok "every server runs the same images"
        else
            fail "the servers do not all run the same images"
            OVERALL=1
        fi
        rm -f "$POORIJA_PREBUILT_REPORT"
    fi

    family_sync
    exit $OVERALL
fi

if [ "$MODE" = "edit" ]; then
    [ -f "$CONFIG_FILE" ] || { SSH_USER="${SSH_USER:-$USER}"; SSH_PORT="${SSH_PORT:-22}"; save_config; }
    editor="${VISUAL:-${EDITOR:-}}"
    if [ -z "$editor" ]; then
        for candidate in nano vim vi; do command -v "$candidate" >/dev/null 2>&1 && { editor="$candidate"; break; }; done
    fi
    [ -n "$editor" ] || { fail "No editor found. Set \$EDITOR, or edit $CONFIG_FILE yourself."; exit 1; }
    "$editor" "$CONFIG_FILE"
    exit $?
fi

[ "$WANT_RECONFIGURE" -eq 1 ] && configure
[ -z "${SSH_HOST:-}" ] && [ -z "${POORIJA_SSH_HOST:-}" ] && configure

# The environment is allowed to override the file, for CI and for one-offs.
HOST="${POORIJA_SSH_HOST:-$SSH_HOST}"
USER_NAME="${POORIJA_SSH_USER:-${SSH_USER:-$USER}}"
PORT="${POORIJA_SSH_PORT:-${SSH_PORT:-22}}"
KEY="${POORIJA_SSH_KEY:-${SSH_KEY:-}}"
REMOTE_DIR="${POORIJA_REMOTE_DIR:-${REMOTE_DIR:-}}"
PUBLIC_URL="${POORIJA_PUBLIC_URL:-${PUBLIC_URL:-https://$HOST:8585}}"
# What this server is FOR, which decides what gets copied to it and what is
# rebuilt there. Two servers that carry for each other do not have to be — and
# in the case this was built for should not be — running the same thing:
#
#   app     the full stack. It serves the application as well as relaying, so
#           it also serves the JavaScript that does the encrypting. That is a
#           different class of trust from carrying traffic, and it is the
#           reason the other role exists. See docs/RELAY-NETWORK.md.
#   relay   standalone-relay/ only. Carries traffic and runs a TURN server;
#           serves no application at all.
ROLE="${POORIJA_ROLE:-${ROLE:-app}}"
case "$ROLE" in
    app|relay) ;;
    *) fail "Unknown role '$ROLE'. Use 'app' or 'relay'."; exit 2 ;;
esac

if [ -z "$HOST" ]; then
    fail "No server configured."
    echo "  bash scripts/deploy.sh --reconfigure"
    exit 2
fi

# ServerAlive is the difference between a deployment that fails and one that
# never returns. ConnectTimeout only covers opening the connection; once a
# transfer is under way a connection that dies silently -- which is what a long
# rsync over a path that is being interfered with does -- leaves ssh waiting for
# data that will never come, with no timeout at all. One deployment sat on
# `rsync tests/` for hours with nothing running on the far side.
#
# Four missed probes at fifteen seconds gives a minute of real silence before it
# gives up, which no working link will hit and no dead one will survive.
SSH_OPTS=(-p "$PORT" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new
    -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
[ -n "$KEY" ] && [ -f "$KEY" ] && SSH_OPTS+=(-i "$KEY" -o IdentitiesOnly=yes)
# Through another server, when <NAME>_JUMP names one: a path from here to
# this server can be slow while the one between the two servers is not. The
# hop only forwards the connection; it holds no key for this server.
JUMP_OPTS=()
if [ -n "${POORIJA_SSH_JUMP:-}" ]; then
    jump_target="${POORIJA_SSH_JUMP%%|*}"; jump_key="${POORIJA_SSH_JUMP#*|}"
    jump_port="${jump_target##*:}"; jump_target="${jump_target%:*}"
    JUMP_OPTS=(-o "ProxyCommand=ssh -p $jump_port -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new${jump_key:+ -i $jump_key -o IdentitiesOnly=yes} -W %h:%p $jump_target")
    SSH_OPTS+=("${JUMP_OPTS[@]}")
fi
remote() { ssh "${SSH_OPTS[@]}" "$USER_NAME@$HOST" "$@"; }
# The same options as one string for rsync's -e, an option with spaces in
# single quotes (rsync splits its -e on spaces and honours quotes).
RSYNC_SSH="ssh"
for opt in "${SSH_OPTS[@]}"; do
    case "$opt" in *" "*) RSYNC_SSH="$RSYNC_SSH '$opt'" ;; *) RSYNC_SSH="$RSYNC_SSH $opt" ;; esac
done

# ---------------------------------------------------------- what is live now
# A relay server has no index.html, no js/ and no service worker; checking for
# them there would fail every time and prove nothing. What it does have is a
# health endpoint that now says which build it is, and an identity.
relay_check() {
    local health version tag id want status=0
    health="$(curl -sk --max-time 20 "$PUBLIC_URL/chat-health")"
    if ! printf '%s' "$health" | grep -q '"ok":true'; then
        printf "  %-34s %s\n" "relay /chat-health" "FAILED - no answer"
        return 1
    fi
    version="$(printf '%s' "$health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
    tag="$(printf '%s' "$health" | sed -n 's/.*"buildTag":"\([^"]*\)".*/\1/p')"
    printf "  %-34s %s\n" "relay build" "${version:-unknown}${tag:+ - $tag}"
    want="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
    if [ "$version" = "$want" ]; then
        printf "  %-34s %s\n" "matches this working tree" "yes"
    else
        printf "  %-34s %s\n" "matches this working tree" "no (tree is $want)"
        status=1
    fi
    id="$(curl -sk --max-time 15 "$PUBLIC_URL/relay-identity" | sed -n 's/.*"id":"\([a-f0-9]*\)".*/\1/p')"
    if [ -n "$id" ]; then
        printf "  %-34s %s...\n" "relay identity" "${id:0:12}"
    else
        printf "  %-34s %s\n" "relay identity" "FAILED"
        status=1
    fi
    printf "  %-34s %s\n" "transit between relays" \
        "$(printf '%s' "$health" | sed -n 's/.*"transit":{\([^}]*\)}.*/\1/p')"
    return $status
}

live_check() {
    # Every request here gets one retry: a dropped connection is the network,
    # and this check is about what the server serves. Chat parts retry on
    # their own below and say so, which keeps a flaky link visible.
    [ "$ROLE" = "relay" ] && { relay_check; return $?; }
    local tag dialogs sealing health status=0
    tag="$(curl -sk --retry 1 --retry-delay 1 --max-time 20 "$PUBLIC_URL/index.html" | grep -oE '\?v=[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9._-]+' | head -1 | sed 's/^?v=//')"
    printf "  %-34s %s\n" "asset tag being served" "${tag:-<unreachable>}"
    # Not reachable from this machine at all: the checks below would each wait
    # out their timeout for the same answer. The on-server verification above
    # is what decides; say so and stop.
    if [ -z "$tag" ] && [ -z "$(curl -sk --retry 1 --retry-delay 1 --max-time 10 "$PUBLIC_URL/chat-health")" ]; then
        warn "$PUBLIC_URL does not answer from this machine (TLS to it may be filtered on the way); the checks on the server itself are what count."
        return 2
    fi

    dialogs="$(curl -sk --retry 1 --retry-delay 1 --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/js/dialogs.js")"
    printf "  %-34s %s\n" "js/dialogs.js" "$dialogs"
    [ "$dialogs" = "200" ] || status=1

    # js/chat.js was split into js/chat/NN-*.js. Checking one part would prove
    # very little, so this checks that every part the tree expects is actually
    # being served — a partial upload of an ordered script set produces a page
    # that loads without error and is missing whole features.
    local want got missing
    want="$(ls js/chat/*.js 2>/dev/null | wc -l | tr -d ' ')"
    got=0; missing=""; retried=""
    for part in js/chat/*.js; do
        [ -e "$part" ] || continue
        code="$(curl -sk --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/$part")"
        # No answer at all (000) is the network, not the file: one retry tells
        # a dropped connection from a part that is not there, and the retry is
        # reported, so a flaky link still shows.
        if [ "$code" = "000" ]; then
            code="$(curl -sk --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/$part")"
            retried="$retried $(basename "$part")"
        fi
        if [ "$code" = "200" ]; then
            got=$((got + 1))
        else
            missing="$missing $(basename "$part")"
        fi
    done
    printf "  %-34s %s\n" "chat parts served" "$got/$want"
    [ -n "$missing" ] && printf "  %-34s %s\n" "missing" "$missing"
    [ -n "$retried" ] && printf "  %-34s %s\n" "answered on a second try" "$retried"
    [ "$got" = "$want" ] && [ "$want" -gt 0 ] || status=1

    sealing="$(curl -sk --retry 1 --retry-delay 1 --max-time 40 "$PUBLIC_URL/js/chat/28-offline-envelopes.js" | grep -c 'sealSessionKeyFor')"
    printf "  %-34s %s\n" "offline sealing present" "$sealing"
    [ "${sealing:-0}" -gt 0 ] || status=1

    # Each is a distinct file, so a partial copy shows up here instead of at a
    # user's lock screen.
    local vault stego core link
    vault="$(curl -sk --retry 1 --retry-delay 1 --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/js/vault-profiles.js")"
    stego="$(curl -sk --retry 1 --retry-delay 1 --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/js/stego.js")"
    core="$(curl -sk --retry 1 --retry-delay 1 --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/js/crypto-core.js")"
    link="$(curl -sk --retry 1 --retry-delay 1 --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/js/local-link.js")"
    printf "  %-34s %s %s %s %s\n" "vault / stego / core / link" "$vault" "$stego" "$core" "$link"
    [ "$vault" = "200" ] && [ "$stego" = "200" ] && [ "$core" = "200" ] && [ "$link" = "200" ] || status=1

    # The offline pane is the one feature meant to keep working when this very
    # server is unreachable, so a deploy that silently dropped it would only be
    # discovered on the day it was needed.
    local offlinepane
    offlinepane="$(curl -sk --retry 1 --retry-delay 1 --max-time 40 "$PUBLIC_URL/index.html" | grep -c 'content-locallink')"
    printf "  %-34s %s\n" "local link pane present" "$offlinepane"
    [ "${offlinepane:-0}" -gt 0 ] || status=1

    # CryptoJS is gone from the tree; make sure it is gone from the server too.
    # rsync --delete should handle it, but "should" is what a check is for.
    local leftover
    leftover="$(curl -sk --retry 1 --retry-delay 1 --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/vendor/crypto-js/crypto-js.min.js")"
    printf "  %-34s %s\n" "crypto-js removed (want 404)" "$leftover"
    [ "$leftover" = "404" ] || status=1

    health="$(curl -sk --retry 1 --retry-delay 1 --max-time 15 "$PUBLIC_URL/chat-health")"
    if echo "$health" | grep -q '"ok":true'; then
        printf "  %-34s %s\n" "relay /chat-health" "ok"
    else
        printf "  %-34s %s\n" "relay /chat-health" "FAILED"
        status=1
    fi

    # The relay's own name, and that it is really the hash of the key it
    # publishes. A relay that merely asserts an id has a label; one whose id
    # the client can derive from the key has a name it cannot lie about, and
    # every transit envelope is sealed to that key.
    local identity relay_id relay_key derived
    identity="$(curl -sk --retry 1 --retry-delay 1 --max-time 15 "$PUBLIC_URL/relay-identity")"
    relay_id="$(printf '%s' "$identity" | sed -n 's/.*"id":"\([a-f0-9]*\)".*/\1/p')"
    relay_key="$(printf '%s' "$identity" | sed -n 's/.*"publicKey":"\([^"]*\)".*/\1/p')"
    if [ -n "$relay_id" ] && [ -n "$relay_key" ]; then
        derived="$(printf '%s' "$relay_key" | base64 -d 2>/dev/null | shasum -a 256 2>/dev/null | cut -d' ' -f1)"
        [ -n "$derived" ] || derived="$(printf '%s' "$relay_key" | base64 -d 2>/dev/null | sha256sum | cut -d' ' -f1)"
        if [ "$derived" = "$relay_id" ]; then
            printf "  %-34s %s\n" "relay identity" "${relay_id:0:12}… (id is the hash of its key)"
        else
            printf "  %-34s %s\n" "relay identity" "MISMATCH — the id is not the hash of the published key"
            status=1
        fi
        printf "  %-34s %s\n" "post-quantum key published" \
            "$(printf '%s' "$identity" | grep -q '"pqAlgorithm":"ml-kem-768"' && echo 'ml-kem-768' || echo 'no')"
    else
        printf "  %-34s %s\n" "relay identity" "FAILED — /relay-identity did not answer"
        status=1
    fi

    # Transit between relays, and whether any link is actually up. Off is a
    # valid answer and not a failure: it is the default, and a relay carries
    # for nobody until an operator names who it carries for.
    #
    # Configured-but-not-yet-up is given a moment before it is printed. A
    # deployment restarts the relay, which drops every link it held, and the
    # other end re-dials on a backoff that starts at a second — so asking
    # immediately after a restart reliably reported "up":0 on a link that was
    # about to come back. Printing that on every single deployment is how an
    # operator learns to ignore the line that exists to warn them.
    local transit waited
    transit="$(printf '%s' "$health" | sed -n 's/.*"transit":{\([^}]*\)}.*/\1/p')"
    waited=0
    while [ "$waited" -lt 45 ] \
        && printf '%s' "$transit" | grep -q '"enabled":true' \
        && printf '%s' "$transit" | grep -q '"up":0'; do
        sleep 5
        waited=$((waited + 5))
        transit="$(curl -sk --retry 1 --retry-delay 1 --max-time 20 "$PUBLIC_URL/chat-health" | sed -n 's/.*"transit":{\([^}]*\)}.*/\1/p')"
    done
    if [ -n "$transit" ]; then
        printf "  %-34s %s%s\n" "transit between relays" "$transit" \
            "$([ "$waited" -gt 0 ] && printf '  (settled after %ss)' "$waited")"
        # A link that is configured and still down after the wait is a fault
        # worth failing on: it means the far relay is unreachable or refusing.
        if printf '%s' "$transit" | grep -q '"enabled":true' \
            && printf '%s' "$transit" | grep -q '"up":0'; then
            fail "transit is configured but no link came up within ${waited}s."
            status=1
        fi
    else
        printf "  %-34s %s\n" "transit between relays" "not reported — relay predates it"
        status=1
    fi

    # The carrier flow's own file, which is the one thing a shutdown makes the
    # difference between a working app and a useless one.
    local carrier
    carrier="$(curl -sk --retry 1 --retry-delay 1 --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/js/chat/38-carrier.js")"
    printf "  %-34s %s\n" "carrier flow served" "$carrier"
    [ "$carrier" = "200" ] || status=1

    local expected
    expected="$(grep -oE '\?v=[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9._-]+' index.html | head -1 | sed 's/^?v=//')"
    if [ "$tag" = "$expected" ]; then
        printf "  %-34s %s\n" "matches this working tree" "yes ($expected)"
    else
        printf "  %-34s %s\n" "matches this working tree" "no (tree is $expected)"
        status=1
    fi
    return $status
}

if [ "$MODE" = "check" ]; then
    log "What $PUBLIC_URL is serving right now"
    if live_check; then ok "The server is up to date."; exit 0; fi
    warn "The server is not serving this tree."
    exit 1
fi

# -------------------------------------------------------------- reachability
# The relay image pins its own dependency versions in its Dockerfile rather
# than installing from package.json, so the repository and the running server
# can drift apart in silence. Refusing to deploy is the only place that
# reliably catches it, because it is the only moment the two are supposed to
# agree.
log "Checking the relay image pins match this tree"
if ! node tools/check-relay-pins.cjs; then
    fail "Deployment stopped: the image would run different versions from this tree."
    exit 1
fi

# Several files state the release version and nothing else makes them agree.
log "Checking every file agrees on the version"
if ! node tools/check-versions.cjs; then
    fail "Deployment stopped: the tree does not agree with itself about its version."
    exit 1
fi

# The static audits: a button wired to a function that does not exist, an
# element the markup lost, a string with no Persian, a script the service
# worker forgets to cache so the app stops working offline. All of them are
# cheap to check and none of them fail a browser test loudly — the app just
# quietly does less than it says.
log "Running the static audits"
for tool in audit-dom audit-i18n audit-handlers check-nginx-routes; do
    if ! node "tools/$tool.cjs"; then
        fail "Deployment stopped: tools/$tool.cjs has findings."
        exit 1
    fi
done

log "Checking key-based access to $USER_NAME@$HOST:$PORT"
if ! remote 'echo ok' >/dev/null 2>&1; then
    fail "Cannot log in without a password."
    echo
    echo "  Authorise this machine's key once — you type your own password,"
    echo "  it is never handled by anything else:"
    echo
    if [ -n "$KEY" ]; then
        echo "      ssh-copy-id -i $KEY.pub -p $PORT $USER_NAME@$HOST"
        echo
        echo "  If ssh-copy-id is not installed:"
        echo
        echo "      cat $KEY.pub | ssh -p $PORT $USER_NAME@$HOST \\"
        echo "        'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'"
    else
        echo "      ssh-copy-id -p $PORT $USER_NAME@$HOST"
        echo
        echo "  No key path is configured, so ssh used your agent and default"
        echo "  identities. Point at one explicitly if you would rather:"
        echo "      bash scripts/deploy.sh --edit"
    fi
    echo
    echo "  Then run this script again."
    exit 1
fi
ok "key authentication works"

# ------------------------------------------------------------ find the install
if [ -z "$REMOTE_DIR" ]; then
    log "Looking for the install directory"
    # This used to be `find … | head -1` in the original of this script, and
    # that single `head -1` caused a deployment to be rsync'd, with --delete,
    # into a backup directory. The backup contained config/docker-compose.yaml
    # too, matched the search, sorted first, and was chosen without a word.
    #
    # So: prune anything that looks like a backup, require the directory to
    # carry the things only a live install has, and REFUSE when more than one
    # candidate survives. Guessing quietly between two answers is the bug.
    CANDIDATES="$(ssh "${SSH_OPTS[@]}" "$USER_NAME@$HOST" 'bash -s' <<'FINDER' 2>/dev/null | tr -d '\r' | grep -v '^$'
find "$HOME" /opt /srv -maxdepth 6 \
    \( -name backups -o -name .git -o -name node_modules \) -prune -o \
    -name docker-compose.yaml -path "*/config/*" -print 2>/dev/null \
  | xargs -r -n1 dirname | xargs -r -n1 dirname \
  | while read -r d; do
        # A live install has secrets and certificates beside the code and is
        # not itself under version control. A snapshot is its mirror image.
        [ -d "$d/.git" ] && continue
        [ -f "$d/.env" ] || [ -d "$d/certs" ] || continue
        echo "$d"
    done
FINDER
)"

    COUNT="$(printf '%s\n' "$CANDIDATES" | grep -c . || true)"
    if [ "$COUNT" -gt 1 ]; then
        fail "More than one install directory matches, so this will not guess:"
        printf '%s\n' "$CANDIDATES" | sed 's/^/      /'
        echo
        echo "  Say which one, and it will be remembered:"
        echo "      bash scripts/deploy.sh --edit        # set REMOTE_DIR"
        echo "      POORIJA_REMOTE_DIR=<path> bash scripts/deploy.sh   # just this once"
        exit 1
    fi
    REMOTE_DIR="$(printf '%s\n' "$CANDIDATES" | head -1)"
fi
if [ -z "$REMOTE_DIR" ]; then
    fail "Could not find a live install on the server."
    echo "  Looked for a directory with config/docker-compose.yaml that also has"
    echo "  .env or certs/ and is not a git repository."
    echo "  Set it yourself:  bash scripts/deploy.sh --edit"
    exit 1
fi

# Whatever chose it — discovery or the settings — say no to a backup. Deleting
# a snapshot with the thing it is a snapshot of is not recoverable twice.
case "$REMOTE_DIR" in
    *backups*|*backup*)
        fail "Refusing to deploy into what looks like a backup: $REMOTE_DIR"
        exit 1 ;;
esac
if remote "[ -d '$REMOTE_DIR/.git' ]"; then
    fail "Refusing to deploy into a git repository: $REMOTE_DIR"
    echo "  A live install is not version controlled; a backup snapshot is."
    echo "  This path is almost certainly the snapshot."
    exit 1
fi
ok "install directory: $REMOTE_DIR"

# ------------------------------------------------------------------ what ships
#
# Directories are synced one at a time, each with --delete scoped to itself, so
# a file removed from the project also goes on the server without --delete
# being loose across the whole install. Handing rsync several sources and one
# destination with --delete does the opposite of what it looks like: a dry run
# of exactly that wanted to remove assets/, README.md, LICENSE and .env.example
# from a running install.
#
# data/, certs/ and .env are never touched — they hold the offline mailboxes,
# the TLS material and the secrets, none of which live in this repository.
if [ "$ROLE" = "relay" ]; then
    # Everything the relay's own image is built from and nothing else. The
    # Dockerfile's build context reaches scripts/lib and vendor, so both have
    # to be there even though nothing serves them.
    SYNC_DIRS=(standalone-relay scripts/lib vendor)
    SYNC_FILES=(package.json)
else
    SYNC_DIRS=(js css assets fonts vendor scripts config tests)
    SYNC_FILES=(index.html sw.js manifest.webmanifest monitor-client.html package.json)
fi

RSYNC_BASE=(-az --human-readable --exclude '.DS_Store' --exclude '*.bak'
            --exclude 'e2e/screenshots' --exclude 'e2e/tmp' -e "$RSYNC_SSH")
[ "$MODE" = "dry-run" ] && RSYNC_BASE+=(--dry-run --itemize-changes)

# ------------------------------------------------------------- snapshot first
#
# rsync --delete is about to run against a live install. Taking a snapshot
# first costs a few seconds and turns "the deployment broke something" from a
# problem into a one-line rollback.
log "Snapshotting the server before overwriting it"
# scp, not ssh: -P is scp's port and -p is its preserve flag, so SSH_OPTS
# (built for ssh, where -p IS the port) cannot be passed straight through —
# handed over as-is, the port became a nonexistent source file and the
# upload failed inside its own redirection, leaving whatever copy the server
# already held to run as today's snapshot. The port is lifted out and only
# the options scp understands make the trip.
SCP_PORT=""
if printf '%s\n' "${SSH_OPTS[@]}" | grep -q '^-p$'; then
    SCP_PORT="$(printf '%s\n' "${SSH_OPTS[@]}" | awk 'prev=="-p"{print; exit} {prev=$0}')"
fi
# A server deployed to for the first time has no scripts/ yet: the tree is
# copied after the snapshot, and scp does not make the directory it writes
# into, so the very first deploy of a new server stopped right here.
remote "mkdir -p '$REMOTE_DIR/scripts'" >/dev/null 2>&1
scp -P "$PORT" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
    $( [ -n "$KEY" ] && [ -f "$KEY" ] && printf -- '-i %s -o IdentitiesOnly=yes ' "$KEY" ) \
    ${JUMP_OPTS[@]+"${JUMP_OPTS[@]}"} \
    scripts/server-backup.sh "$USER_NAME@$HOST:$REMOTE_DIR/scripts/server-backup.sh"
if [ $? -ne 0 ]; then
    fail "Could not upload scripts/server-backup.sh to the server."
    echo "  Without it there is no snapshot, and without a snapshot this stops."
    exit 1
fi
BACKUP_LABEL="before deploying $(grep -oE '\?v=[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9._-]+' index.html | head -1 | sed 's/^?v=//')"
if remote "bash '$REMOTE_DIR/scripts/server-backup.sh' '$BACKUP_LABEL'" 2>&1 | sed 's/^/  /'; then
    ok "snapshot taken — roll back with: scripts/server-backup.sh --restore <hash>"
else
    fail "The snapshot failed, so nothing has been overwritten."
    echo "  Fix that first: a deployment without a way back is not one worth making."
    echo "  Look at it on the server:  bash $REMOTE_DIR/scripts/server-backup.sh --list"
    exit 1
fi

log "Copying the tree to $REMOTE_DIR"
copy_failed=0

for dir in "${SYNC_DIRS[@]}"; do
    [ -d "$dir" ] || continue
    printf "  %s/\n" "$dir"
    rsync "${RSYNC_BASE[@]}" --delete "$dir/" "$USER_NAME@$HOST:$REMOTE_DIR/$dir/" 2>&1 \
        | grep -vE '^(sending|sent |total size)' | sed 's/^/    /' | head -12
    [ "${PIPESTATUS[0]}" -eq 0 ] || copy_failed=1
done

printf "  top-level files\n"
rsync "${RSYNC_BASE[@]}" "${SYNC_FILES[@]}" "$USER_NAME@$HOST:$REMOTE_DIR/" 2>&1 \
    | grep -vE '^(sending|sent |total size)' | sed 's/^/    /' | head -12
[ "${PIPESTATUS[0]}" -eq 0 ] || copy_failed=1

if [ "$copy_failed" -ne 0 ]; then
    fail "Copying failed."
    exit 1
fi

if [ "$MODE" = "dry-run" ]; then
    ok "Dry run only — nothing on the server was changed."
    exit 0
fi
ok "files copied"

# --------------------------------------------------------------- rebuild there
log "Rebuilding the containers on the server (this takes a few minutes)"
# Docker needs either group membership or sudo. Neither is something this
# script should paper over with a password on a command line, so it says
# plainly what is missing and stops rather than half-deploying.
if ! remote 'docker ps >/dev/null 2>&1'; then
    echo
    fail "The files are on the server, but Docker is not reachable as $USER_NAME."
    echo
    echo "  The files are already in place at $REMOTE_DIR — nothing is half-done,"
    echo "  the running containers simply still hold the old build."
    echo
    echo "  Either add the account to the docker group once, and this script can"
    echo "  finish on its own from now on:"
    echo
    echo "      ssh -p $PORT $USER_NAME@$HOST 'sudo usermod -aG docker $USER_NAME'"
    echo "      # then log out and back in once for the group to take effect"
    echo
    echo "  Or finish this deployment by hand, on the server:"
    echo
    echo "      cd $REMOTE_DIR && sudo bash scripts/sync-to-server.sh"
    echo
    echo "  Either way, check the result from here afterwards:"
    echo "      bash scripts/deploy.sh --check"
    exit 1
fi
# The images built here, pulled through a reverse tunnel to the registry on
# this machine's 127.0.0.1: only the layers this server lacks travel.
prebuilt_pull() {
    local version coturn
    version="$(tree_version)"; coturn="$(coturn_image)"
    log "Pulling the images built here (only the layers this server lacks)"
    ssh "${SSH_OPTS[@]}" -o ExitOnForwardFailure=yes -R "$REGISTRY:$REGISTRY" "$USER_NAME@$HOST" 'bash -s' <<PULL 2>&1 | sed 's/^/  /'
set -e
R="$REGISTRY"
for ref in poorija-crypto:$version poorija-chat-signal:$version poorija-cert-renewer:$version $coturn alpine:$ALPINE_TAG; do
    docker pull -q "\$R/\$ref" >/dev/null
    docker tag "\$R/\$ref" "\$ref"
    docker rmi "\$R/\$ref" >/dev/null
    printf '%-40s %s\n' "\$ref" "\$(docker image inspect --format '{{.Id}}' "\$ref" | cut -c8-19)"
done
docker tag "alpine:$ALPINE_TAG" alpine:latest
PULL
    return "${PIPESTATUS[0]}"
}
if [ "$ROLE" = "relay" ]; then
    # The relay's own compose file, from its own directory: its build context
    # is the parent, which is why the whole tree is not needed here but the
    # parent path is.
    remote "cd '$REMOTE_DIR/standalone-relay' && docker compose up -d --build" 2>&1 | sed 's/^/  /'
elif [ -n "$PREBUILT" ]; then
    if [ -z "${POORIJA_PREBUILT_DONE:-}" ]; then prebuilt_build || exit 1; fi
    prebuilt_pull || { fail "The images did not reach the server; the running stack was left alone."; exit 1; }
    remote "cd '$REMOTE_DIR' && bash scripts/sync-to-server.sh $SKIP_BUMP --prebuilt" 2>&1 | sed 's/^/  /'
else
    remote "cd '$REMOTE_DIR' && bash scripts/sync-to-server.sh $SKIP_BUMP" 2>&1 | sed 's/^/  /'
fi
deploy_status=${PIPESTATUS[0]}
if [ -n "$PREBUILT" ] && [ "$ROLE" = "app" ] && [ -n "${POORIJA_PREBUILT_REPORT:-}" ]; then
    version="$(tree_version)"
    ids="$(remote 'bash -s' 2>/dev/null <<IDS | tr '\n' ' ' | sed 's/ *$//'
for ref in poorija-crypto:$version poorija-chat-signal:$version poorija-cert-renewer:$version; do docker image inspect --format '{{.Id}}' "\$ref" | cut -c8-19; done
IDS
)"
    printf '%s %s\n' "${POORIJA_SERVER_NAME:-server}" "$ids" >> "$POORIJA_PREBUILT_REPORT"
fi

echo
log "Checking what $PUBLIC_URL serves now"
live_check
live_status=$?
# A single server, deployed on its own (not as one of SERVERS): a family of
# one. A standalone relay keeps its own compose file and is left out.
single_family() {
    [ -z "${POORIJA_SERVER_NAME:-}" ] && [ -z "${SERVERS:-}" ] && [ "$ROLE" != "relay" ] && family_sync
    return 0
}
if [ "$live_status" -eq 0 ] && [ "$deploy_status" -eq 0 ]; then
    echo
    ok "Deployed. PWA users get offline delivery on their next load."
    single_family
    exit 0
fi
if [ "$live_status" -eq 2 ] && [ "$deploy_status" -eq 0 ]; then
    echo
    ok "Deployed and verified on the server."
    single_family
    exit 0
fi
echo
fail "The deployment did not fully verify — see above."
exit 1
