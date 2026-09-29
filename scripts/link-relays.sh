#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Linking two relays that are already running.
#
#   bash scripts/link-relays.sh <first> <second>      # names from deploy.conf
#   bash scripts/link-relays.sh --status              # what is linked to what
#   bash scripts/link-relays.sh --unlink <a> <b>
#
# WHY THIS EXISTS
# ---------------
# Linking two relays is four steps done in the right order on two machines:
# fetch each relay's identity, write the other's id into its .env, restart the
# relay so it reads the variable, and then check the link actually came up. Done
# by hand it is a sequence of ssh commands with a hex string pasted between them,
# and getting one character wrong produces a relay that quietly carries for
# nobody. It was done by hand three times while this was being built, which is
# three times too many.
#
# It is deliberately NOT part of an install. A relay that carries for somebody
# is a decision about who you carry for, and it belongs to a moment when the
# operator is thinking about that question rather than answering an installer.
#
# WHAT IT DOES NOT DO
# -------------------
# It does not turn verification off. When one side's certificate cannot be
# verified by the other, it links them the asymmetric way instead: the side that
# CAN verify does the dialling, the other gets a bare id and only answers. One
# established link carries both directions, so that is enough, and nothing
# anywhere has to trust a certificate it cannot check.

set -uo pipefail

INFO='\033[1;34m'; OK='\033[1;32m'; WARN='\033[1;33m'; ERR='\033[1;31m'; DIM='\033[2m'; NC='\033[0m'
log()  { printf "${INFO}▶ %s${NC}\n" "$1"; }
ok()   { printf "${OK}✓ %s${NC}\n" "$1"; }
warn() { printf "${WARN}! %s${NC}\n" "$1"; }
fail() { printf "${ERR}✖ %s${NC}\n" "$1"; }
dim()  { printf "${DIM}%s${NC}\n" "$1"; }

CONFIG_FILE="${POORIJA_DEPLOY_CONF:-${XDG_CONFIG_HOME:-$HOME/.config}/p00rija-cryptography/deploy.conf}"

usage() {
    sed -n '11,17p' "$0" | sed 's/^# \{0,1\}//'
    echo
    echo "Servers come from $CONFIG_FILE, the same file scripts/deploy.sh uses."
}

MODE="link"
ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --status) MODE="status" ;;
        --unlink) MODE="unlink" ;;
        --help|-h) usage; exit 0 ;;
        -*) fail "Unknown option: $1"; echo; usage; exit 2 ;;
        *) ARGS+=("$1") ;;
    esac
    shift
done

if [ ! -r "$CONFIG_FILE" ]; then
    fail "No deployment settings at $CONFIG_FILE"
    echo "  Run: bash scripts/deploy.sh --reconfigure"
    exit 1
fi
# shellcheck disable=SC1090
. "$CONFIG_FILE"

server_field() {
    # server_field <name> <FIELD>
    local upper
    upper="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -c '[:alnum:]' '_')"
    eval "printf '%s' \"\${${upper}_$2:-}\""
}

ssh_to() {
    # ssh_to <name> <command...>
    local name="$1"; shift
    local host user port key
    host="$(server_field "$name" SSH_HOST)"
    user="$(server_field "$name" SSH_USER)"
    port="$(server_field "$name" SSH_PORT)"
    key="$(server_field "$name" SSH_KEY)"
    [ -n "$host" ] || { fail "No server called '$name' in $CONFIG_FILE"; return 1; }
    local opts=(-p "${port:-22}" -o BatchMode=yes -o ConnectTimeout=15
        -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
    [ -n "$key" ] && opts+=(-i "$key" -o IdentitiesOnly=yes)
    ssh "${opts[@]}" "$user@$host" "$@"
}

relay_identity() {
    # The id is the SHA-256 of the key in the same answer, so it is a name the
    # relay cannot lie about. Read over the public URL rather than from the
    # container, because the public URL is what the other relay will dial.
    curl -sk --max-time 20 "$(server_field "$1" PUBLIC_URL)/relay-identity" \
        | sed -n 's/.*"id":"\([a-f0-9]*\)".*/\1/p'
}

transit_of() {
    curl -sk --max-time 20 "$(server_field "$1" PUBLIC_URL)/chat-health" \
        | sed -n 's/.*"transit":{\([^}]*\)}.*/\1/p'
}

# Whether the certificate at a public URL verifies without --insecure. This is
# the whole of the asymmetric decision below.
cert_verifies() {
    curl -s --max-time 20 -o /dev/null "$(server_field "$1" PUBLIC_URL)/chat-health" 2>/dev/null
}

set_peers() {
    # set_peers <name> <value>  — rewrites the one line and restarts the relay.
    local name="$1" value="$2" dir
    dir="$(server_field "$name" REMOTE_DIR)"
    ssh_to "$name" "bash -s" <<REMOTE
set -e
cd '$dir'
cp .env ".env.bak-\$(date -u +%Y%m%d-%H%M%S)"
sed -i '/^CHAT_TRANSIT_PEERS=/d' .env
printf 'CHAT_TRANSIT_PEERS=%s\n' '$value' >> .env
PROJECT="\$(docker inspect Poorija-Cryptography_ChatSignal \
    --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || echo config)"
docker compose -p "\$PROJECT" --env-file .env -f config/docker-compose.yaml up -d chat-signal >/dev/null 2>&1
REMOTE
}

if [ "$MODE" = "status" ]; then
    for name in ${SERVERS:-}; do
        printf "  %-6s %-34s %s\n" "$name" "$(server_field "$name" PUBLIC_URL)" "$(transit_of "$name")"
    done
    exit 0
fi

A="${ARGS[0]:-}"; B="${ARGS[1]:-}"
if [ -z "$A" ] || [ -z "$B" ]; then
    fail "Two server names are needed."
    echo "  Known: ${SERVERS:-none}"
    echo
    usage
    exit 2
fi

if [ "$MODE" = "unlink" ]; then
    log "Unlinking $A and $B"
    set_peers "$A" "" && ok "$A carries for nobody"
    set_peers "$B" "" && ok "$B carries for nobody"
    exit 0
fi

log "Reading both relay identities"
ID_A="$(relay_identity "$A")"
ID_B="$(relay_identity "$B")"
[ ${#ID_A} -eq 64 ] || { fail "$A did not return a relay identity"; exit 1; }
[ ${#ID_B} -eq 64 ] || { fail "$B did not return a relay identity"; exit 1; }
[ "$ID_A" != "$ID_B" ] && ok "two different relays: ${ID_A:0:12}… and ${ID_B:0:12}…" \
    || { fail "Both names point at the same relay."; exit 1; }

# Who dials whom. A relay can only dial an address whose certificate it can
# verify, and turning that off is not on the table, so the side with the
# verifiable certificate is the one that gets dialled.
A_OK=0; B_OK=0
cert_verifies "$A" && A_OK=1
cert_verifies "$B" && B_OK=1

URL_A="$(server_field "$A" PUBLIC_URL)"
URL_B="$(server_field "$B" PUBLIC_URL)"

if [ "$A_OK" -eq 1 ] && [ "$B_OK" -eq 1 ]; then
    log "Both certificates verify — each may dial the other"
    set_peers "$A" "$ID_B@$URL_B"
    set_peers "$B" "$ID_A@$URL_A"
elif [ "$A_OK" -eq 1 ]; then
    warn "$B's certificate does not verify from here; $B will dial and $A will answer"
    set_peers "$A" "$ID_B"
    set_peers "$B" "$ID_A@$URL_A"
elif [ "$B_OK" -eq 1 ]; then
    warn "$A's certificate does not verify from here; $A will dial and $B will answer"
    set_peers "$A" "$ID_B@$URL_B"
    set_peers "$B" "$ID_A"
else
    fail "Neither certificate verifies, so neither relay can dial the other safely."
    echo "  Install real certificates first — see scripts/prepare-relay-host.sh."
    echo "  CHAT_TRANSIT_INSECURE_TLS exists for a staging box and is not set here."
    exit 1
fi
ok "both .env files updated and both relays restarted"

# A restart drops every link the relay held, and the other side re-dials on a
# backoff that starts at a second. Waiting is the difference between reporting
# what is true and reporting what happened to be true at the instant we looked.
log "Waiting for the link to come up"
for _ in $(seq 1 18); do
    sleep 5
    TA="$(transit_of "$A")"; TB="$(transit_of "$B")"
    case "$TA$TB" in
        *'"up":0'*) continue ;;
        *) break ;;
    esac
done
printf "  %-6s %s\n" "$A" "$TA"
printf "  %-6s %s\n" "$B" "$TB"
case "$TA$TB" in
    *'"up":0'*|'') fail "The link did not come up. Check that each relay can reach the other's $PUBLIC_URL."; exit 1 ;;
esac
ok "$A and $B are linked"
dim "  People on one can now write to, and call, people on the other."
dim "  Check it any time with: bash scripts/link-relays.sh --status"
