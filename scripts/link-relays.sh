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
    #
    # But the id is also the allowlist entry that admits a transit link, and
    # reading it with -k means whoever answers the URL writes that entry — a
    # name on the network path (a hijacked route, hostile Wi-Fi) substitutes
    # its own self-consistent identity and the answering relay trusts it
    # forever after. So the id is cross-checked against the server's own
    # relay-identity.json over SSH, on the machine itself, and anything that
    # disagrees stops the link before it starts. Where the certificate
    # verifies, the fetch drops -k as well.
    local via_ssh via_url
    via_url="$(curl -sk --max-time 20 "$(server_field "$1" PUBLIC_URL)/relay-identity" \
        | sed -n 's/.*"id":"\([a-f0-9]*\)".*/\1/p')"
    via_ssh="$(ssh_to "$1" "sed -n 's/.*\"id\":\"\\\\([a-f0-9]*\\\\)\".*/\\\\1/p' \
        \"\$(ls -1 '$(server_field "$1" REMOTE_DIR)'/data/chat-signal/relay-identity.json \
              '$(server_field "$1" REMOTE_DIR)'/standalone-relay/data/relay-identity.json 2>/dev/null | head -1)\" 2>/dev/null" 2>/dev/null || true)"
    if [ -n "$via_ssh" ] && [ "$via_ssh" != "$via_url" ]; then
        fail "$1's identity over HTTPS ($via_url) is not the one on its own disk ($via_ssh)."
        echo "  Something is answering its public URL that is not the relay. Nothing was linked."
        return 1
    fi
    printf '%s' "$via_url"
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

merge_peer() {
    # merge_peer <existing-value> <new-entry> — adds or replaces one id's
    # entry and keeps every other relay already linked. The old behaviour
    # replaced the whole line, so linking a third relay silently unlinked the
    # second, and "A carries for nobody" was only ever true by wipe.
    local existing="$1" new="$2" kept out
    [ -n "$existing" ] || { printf '%s' "$2"; return; }
    out="$new"
    kept=0
    local IFS=','
    for entry in $existing; do
        [ -n "$entry" ] || continue
        case "$entry" in
            "${new%%@*}"|"${new%%@*}@"*) continue ;;  # the id being replaced
        esac
        out="$out,$entry"
        kept=1
    done
    printf '%s' "$out"
}

drop_peer() {
    # drop_peer <existing-value> <id> — removes one relay from the list and
    # leaves the rest of the mesh standing.
    local existing="$1" drop="$2" out="" entry
    local IFS=','
    for entry in $existing; do
        [ -n "$entry" ] || continue
        case "$entry" in
            "$drop"|"$drop@"*) continue ;;
        esac
        out="${out:+$out,}$entry"
    done
    printf '%s' "$out"
}

set_peers() {
    # set_peers <name> <value> — sets CHAT_TRANSIT_PEERS to exactly <value>.
    local name="$1" value="$2" dir
    dir="$(server_field "$name" REMOTE_DIR)"
    ssh_to "$name" "bash -s" <<REMOTE
set -e
cd '$dir'
cp .env ".env.bak-\$(date -u +%Y%m%d-%H%M%S)"
# The backups hold TURN and monitor passwords; the relays that made them are
# restarted below, and the copies are for exactly one bad edit. Keep five.
ls -1t .env.bak-* 2>/dev/null | tail -n +6 | xargs -r rm -f
sed -i '/^CHAT_TRANSIT_PEERS=/d' .env
printf 'CHAT_TRANSIT_PEERS=%s\n' '$value' >> .env
chmod 600 .env
PROJECT="\$(docker inspect Poorija-Cryptography_ChatSignal \
    --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || echo config)"
docker compose -p "\$PROJECT" --env-file .env -f config/docker-compose.yaml up -d chat-signal >/dev/null 2>&1
REMOTE
}

peers_of() {
    # The current CHAT_TRANSIT_PEERS on a server, or empty.
    ssh_to "$1" "sed -n 's/^CHAT_TRANSIT_PEERS=//p' '$(server_field "$1" REMOTE_DIR)/.env'" 2>/dev/null || true
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
    # Removing one link must not cut the others: a mesh of three used to lose
    # its second relay the day the third was unlinked, because "unlink" read
    # the whole line off both .env files.
    log "Reading both relay identities"
    ID_A="$(relay_identity "$A")" || exit 1
    ID_B="$(relay_identity "$B")" || exit 1
    [ ${#ID_A} -eq 64 ] || { fail "$A did not return a relay identity"; exit 1; }
    [ ${#ID_B} -eq 64 ] || { fail "$B did not return a relay identity"; exit 1; }
    log "Unlinking $A and $B, leaving any other linked relays in place"
    set_peers "$A" "$(drop_peer "$(peers_of "$A")" "$ID_B")" && ok "$A no longer carries for $B"
    set_peers "$B" "$(drop_peer "$(peers_of "$B")" "$ID_A")" && ok "$B no longer carries for $A"
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
    set_peers "$A" "$(merge_peer "$(peers_of "$A")" "$ID_B@$URL_B")"
    set_peers "$B" "$(merge_peer "$(peers_of "$B")" "$ID_A@$URL_A")"
elif [ "$A_OK" -eq 1 ]; then
    warn "$B's certificate does not verify from here; $B will dial and $A will answer"
    set_peers "$A" "$(merge_peer "$(peers_of "$A")" "$ID_B")"
    set_peers "$B" "$(merge_peer "$(peers_of "$B")" "$ID_A@$URL_A")"
elif [ "$B_OK" -eq 1 ]; then
    warn "$A's certificate does not verify from here; $A will dial and $B will answer"
    set_peers "$A" "$(merge_peer "$(peers_of "$A")" "$ID_B@$URL_B")"
    set_peers "$B" "$(merge_peer "$(peers_of "$B")" "$ID_A")"
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
