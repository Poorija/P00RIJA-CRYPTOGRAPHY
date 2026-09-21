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
#   bash scripts/deploy.sh                 # copy, rebuild, verify
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
  --check         Only report what the server is serving. Changes nothing.
  --dry-run       Show what rsync would copy. Changes nothing.
  --skip-bump     Skip the version bump on the server; for a change that
                  touched only the server config.
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
WANT_RECONFIGURE=0
for arg in "$@"; do
    case "$arg" in
        --check) MODE="check" ;;
        --dry-run) MODE="dry-run" ;;
        --skip-bump) SKIP_BUMP="--skip-bump" ;;
        --reconfigure|--configure) WANT_RECONFIGURE=1 ;;
        --edit) MODE="edit" ;;
        --where|--config) MODE="where" ;;
        --help|-h) usage; exit 0 ;;
        *) fail "Unknown option: $arg"; echo; usage; exit 2 ;;
    esac
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
load_config

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

if [ -z "$HOST" ]; then
    fail "No server configured."
    echo "  bash scripts/deploy.sh --reconfigure"
    exit 2
fi

SSH_OPTS=(-p "$PORT" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
[ -n "$KEY" ] && [ -f "$KEY" ] && SSH_OPTS+=(-i "$KEY" -o IdentitiesOnly=yes)
remote() { ssh "${SSH_OPTS[@]}" "$USER_NAME@$HOST" "$@"; }

# ---------------------------------------------------------- what is live now
live_check() {
    local tag dialogs sealing health status=0
    tag="$(curl -sk --max-time 20 "$PUBLIC_URL/index.html" | grep -oE '\?v=[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9._-]+' | head -1 | sed 's/^?v=//')"
    printf "  %-34s %s\n" "asset tag being served" "${tag:-<unreachable>}"

    dialogs="$(curl -sk --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/js/dialogs.js")"
    printf "  %-34s %s\n" "js/dialogs.js" "$dialogs"
    [ "$dialogs" = "200" ] || status=1

    # js/chat.js was split into js/chat/NN-*.js. Checking one part would prove
    # very little, so this checks that every part the tree expects is actually
    # being served — a partial upload of an ordered script set produces a page
    # that loads without error and is missing whole features.
    local want got missing
    want="$(ls js/chat/*.js 2>/dev/null | wc -l | tr -d ' ')"
    got=0; missing=""
    for part in js/chat/*.js; do
        [ -e "$part" ] || continue
        if [ "$(curl -sk --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/$part")" = "200" ]; then
            got=$((got + 1))
        else
            missing="$missing $(basename "$part")"
        fi
    done
    printf "  %-34s %s\n" "chat parts served" "$got/$want"
    [ -n "$missing" ] && printf "  %-34s %s\n" "missing" "$missing"
    [ "$got" = "$want" ] && [ "$want" -gt 0 ] || status=1

    sealing="$(curl -sk --max-time 40 "$PUBLIC_URL/js/chat/28-offline-envelopes.js" | grep -c 'sealSessionKeyFor')"
    printf "  %-34s %s\n" "offline sealing present" "$sealing"
    [ "${sealing:-0}" -gt 0 ] || status=1

    # Each is a distinct file, so a partial copy shows up here instead of at a
    # user's lock screen.
    local vault stego core link
    vault="$(curl -sk --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/js/vault-profiles.js")"
    stego="$(curl -sk --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/js/stego.js")"
    core="$(curl -sk --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/js/crypto-core.js")"
    link="$(curl -sk --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/js/local-link.js")"
    printf "  %-34s %s %s %s %s\n" "vault / stego / core / link" "$vault" "$stego" "$core" "$link"
    [ "$vault" = "200" ] && [ "$stego" = "200" ] && [ "$core" = "200" ] && [ "$link" = "200" ] || status=1

    # The offline pane is the one feature meant to keep working when this very
    # server is unreachable, so a deploy that silently dropped it would only be
    # discovered on the day it was needed.
    local offlinepane
    offlinepane="$(curl -sk --max-time 40 "$PUBLIC_URL/index.html" | grep -c 'content-locallink')"
    printf "  %-34s %s\n" "local link pane present" "$offlinepane"
    [ "${offlinepane:-0}" -gt 0 ] || status=1

    # CryptoJS is gone from the tree; make sure it is gone from the server too.
    # rsync --delete should handle it, but "should" is what a check is for.
    local leftover
    leftover="$(curl -sk --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/vendor/crypto-js/crypto-js.min.js")"
    printf "  %-34s %s\n" "crypto-js removed (want 404)" "$leftover"
    [ "$leftover" = "404" ] || status=1

    health="$(curl -sk --max-time 15 "$PUBLIC_URL/chat-health")"
    if echo "$health" | grep -q '"ok":true'; then
        printf "  %-34s %s\n" "relay /chat-health" "ok"
    else
        printf "  %-34s %s\n" "relay /chat-health" "FAILED"
        status=1
    fi

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
for tool in audit-dom audit-i18n audit-handlers; do
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
SYNC_DIRS=(js css assets fonts vendor scripts config tests)
SYNC_FILES=(index.html sw.js manifest.webmanifest monitor-client.html package.json)

RSYNC_BASE=(-az --human-readable --exclude '.DS_Store' --exclude '*.bak'
            --exclude 'e2e/screenshots' --exclude 'e2e/tmp' -e "ssh ${SSH_OPTS[*]}")
[ "$MODE" = "dry-run" ] && RSYNC_BASE+=(--dry-run --itemize-changes)

# ------------------------------------------------------------- snapshot first
#
# rsync --delete is about to run against a live install. Taking a snapshot
# first costs a few seconds and turns "the deployment broke something" from a
# problem into a one-line rollback.
log "Snapshotting the server before overwriting it"
scp "${SSH_OPTS[@]}" scripts/server-backup.sh "$USER_NAME@$HOST:$REMOTE_DIR/scripts/server-backup.sh" >/dev/null 2>&1
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
remote "cd '$REMOTE_DIR' && bash scripts/sync-to-server.sh $SKIP_BUMP" 2>&1 | sed 's/^/  /'
deploy_status=${PIPESTATUS[0]}

echo
log "Checking what $PUBLIC_URL serves now"
if live_check && [ "$deploy_status" -eq 0 ]; then
    echo
    ok "Deployed. PWA users get offline delivery on their next load."
    exit 0
fi
echo
fail "The deployment did not fully verify — see above."
exit 1
