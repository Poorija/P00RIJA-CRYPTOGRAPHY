#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Rebuilds and restarts the server stack so PWA users get the current tree.
#
#   bash scripts/sync-to-server.sh                 # rebuild, restart, verify
#   bash scripts/sync-to-server.sh --check         # verify only, change nothing
#   bash scripts/sync-to-server.sh --skip-bump     # when the tag is already right
#
# Two containers matter. `poorija-cryptography` is the nginx that serves the web
# app, so it is what a PWA user actually loads. `chat-signal` is the relay in
# scripts/server.js, which holds the offline mailboxes.
#
# `data/` is a bind mount and is never touched: queued messages, the expiry log
# and the policy store all survive a rebuild.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INFO='\033[1;34m'; OK='\033[1;32m'; WARN='\033[1;33m'; ERR='\033[1;31m'; NC='\033[0m'
log()  { printf "${INFO}▶ %s${NC}\n" "$1"; }
ok()   { printf "${OK}✓ %s${NC}\n" "$1"; }
warn() { printf "${WARN}! %s${NC}\n" "$1"; }
fail() { printf "${ERR}✖ %s${NC}\n" "$1"; }

COMPOSE="config/docker-compose.yaml"
ENV_FILE="${POORIJA_ENV_FILE:-$ROOT/.env}"
# Compose derives the project directory from the compose file, so with the
# YAML in config/ it looks for config/.env and finds nothing — the build then
# fails with "required variable DOMAIN is missing a value" even though .env is
# sitting in the root. scripts/setup.sh has always passed --env-file for this
# reason; every compose call here does the same.
# Pin the project name. Compose derives it from the project directory, so
# moving that from config/ to the repo root would silently rename the project
# from "config" to "pkg" — and rather than updating the running stack, compose
# would stand a second one up beside it and fight it for the ports. The name
# comes from the containers that are already running.
PROJECT_NAME="${POORIJA_COMPOSE_PROJECT:-$(docker inspect Poorija-Cryptography_ChatSignal \
    --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null | tr -d '\r')}"
[ -n "$PROJECT_NAME" ] || PROJECT_NAME="config"
# --project-directory is deliberately NOT set. The build contexts in the YAML
# are written relative to config/ (`context: ../`), and repointing the project
# directory at the repo root re-resolves them from the wrong place — compose
# then fails with "lstat /home/youruser/work/config: no such file or directory".
# Leaving it default keeps the contexts correct and makes the project name come
# out as "config" on its own, which is what the running stack already uses.
COMPOSE_CMD=(docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE")
APP_CONTAINER="Poorija-Cryptography_App"
RELAY_CONTAINER="Poorija-Cryptography_ChatSignal"
CHECK_ONLY=0
SKIP_BUMP=0
for arg in "$@"; do
    case "$arg" in
        --check) CHECK_ONLY=1 ;;
        --skip-bump) SKIP_BUMP=1 ;;
        *) fail "Unknown option: $arg"; exit 2 ;;
    esac
done

command -v docker >/dev/null 2>&1 || { fail "Docker is not installed."; exit 1; }
docker info >/dev/null 2>&1 || { fail "The Docker daemon is not running."; exit 1; }
if [ ! -f "$ENV_FILE" ]; then
    fail "No .env at $ENV_FILE — compose needs DOMAIN, TURN_PASSWORD and MONITOR_PASSWORD."
    echo "  Point at another one with:  POORIJA_ENV_FILE=/path/to/.env"
    [ "$CHECK_ONLY" -eq 1 ] || exit 1
fi

# ---------------------------------------------------------------- version tag
#
# Every asset in index.html carries ?v=<tag> and sw.js pins CACHE_NAME to the
# same string. Ship new files under an old tag and the installed service worker
# keeps serving the previous bundle — the update appears to have done nothing,
# and the next hour goes into debugging a build that is not running.
CURRENT_TAG="$(grep -oE '\?v=[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9._-]+' index.html | head -1 | sed 's/^?v=//')"
if [ -z "$CURRENT_TAG" ]; then
    fail "Could not read the asset version tag out of index.html."
    exit 1
fi
log "Asset tag in the tree: $CURRENT_TAG"

for f in sw.js js/app.js; do
    if ! grep -q "$CURRENT_TAG" "$f"; then
        fail "$f does not carry $CURRENT_TAG — index.html, sw.js and js/app.js must agree."
        echo "    Fix with:  sed -i '' \"s/<old-tag>/$CURRENT_TAG/g\" index.html sw.js js/app.js"
        exit 1
    fi
done
ok "index.html, sw.js and js/app.js all carry the same tag"

DEPLOYED_TAG=""
if docker ps --format '{{.Names}}' | grep -Fxq "$APP_CONTAINER"; then
    DEPLOYED_TAG="$(docker exec "$APP_CONTAINER" sh -c \
        "grep -oE '\?v=[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9._-]+' /usr/share/nginx/html/index.html | head -1" 2>/dev/null \
        | sed 's/^?v=//' | tr -d '\r')"
    [ -n "$DEPLOYED_TAG" ] && log "Asset tag on the server: $DEPLOYED_TAG"
fi

if [ "$SKIP_BUMP" -eq 0 ] && [ -n "$DEPLOYED_TAG" ] && [ "$DEPLOYED_TAG" = "$CURRENT_TAG" ]; then
    warn "The server already serves $CURRENT_TAG."
    warn "Installed PWAs cache by that string, so they will not pick up new files."
    warn "Bump it first, or pass --skip-bump if you are certain nothing web-facing changed:"
    echo "    sed -i '' \"s/$CURRENT_TAG/<new-tag>/g\" index.html sw.js js/app.js"
    [ "$CHECK_ONLY" -eq 1 ] || exit 1
fi

# ------------------------------------------------------------------ verify fn
verify_assets() {
    local mismatched=0 checked=0
    docker ps --format '{{.Names}}' | grep -Fxq "$APP_CONTAINER" || { warn "$APP_CONTAINER is not running."; return 1; }
    while IFS= read -r f; do
        [ -f "$f" ] || continue
        checked=$((checked + 1))
        local here there
        here="$(md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1)"
        there="$(docker exec "$APP_CONTAINER" md5sum "/usr/share/nginx/html/$f" 2>/dev/null | cut -d' ' -f1)"
        if [ "$here" != "$there" ]; then
            printf "  ${ERR}DIFF${NC}  %s\n" "$f"
            mismatched=$((mismatched + 1))
        fi
    done < <(printf '%s\n' index.html sw.js manifest.webmanifest css/styles.css js/app.js js/chat.js js/dialogs.js js/desktop-bridge.js js/ssh-keys.js js/backup.js js/advanced-crypto.js js/crypto-config.js)
    if [ "$mismatched" -eq 0 ]; then
        ok "all $checked web assets match the working tree"
        return 0
    fi
    fail "$mismatched of $checked assets differ from the working tree"
    return 1
}

verify_relay() {
    local out
    out="$(docker exec "$RELAY_CONTAINER" node -e "
      const fs=require('fs');
      const src=fs.readFileSync('/app/scripts/server.js','utf8');
      process.stdout.write(JSON.stringify({
        retention: src.includes('MEDIA_RETENTION_MS'),
        quota: src.includes('MEDIA_QUOTA_BYTES'),
        expiry: src.includes('expired-notice'),
        /* A queued chat message travels as a sealed 'offline-chat' envelope.
           Gating the push on the inner type names meant nothing ever rang a
           device, and a deploy that quietly ships that again is worse than one
           that fails loudly. */
        push: src.includes(\"payloadType === 'offline-chat'\"),
        prekeys: src.includes('prekeyPublic'),
        purge: src.includes('purge-me'),
      }));" 2>/dev/null)"
    if [ -z "$out" ]; then
        fail "Could not read scripts/server.js inside $RELAY_CONTAINER."
        return 1
    fi
    if echo "$out" | grep -q '"retention":true' \
        && echo "$out" | grep -q '"quota":true' \
        && echo "$out" | grep -q '"expiry":true' \
        && echo "$out" | grep -q '"push":true' \
        && echo "$out" | grep -q '"prekeys":true' \
        && echo "$out" | grep -q '"purge":true'; then
        ok "the relay carries store-and-forward, push, prekeys and the purge"
        return 0
    fi
    fail "the relay does not carry the retention changes: $out"
    return 1
}

verify_health() {
    local body
    body="$(docker exec "$RELAY_CONTAINER" node -e "
      fetch('http://127.0.0.1:9000/chat-health').then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>process.exit(1));" 2>/dev/null)"
    if echo "$body" | grep -q '"ok":true'; then
        ok "the relay answers /chat-health"
        return 0
    fi
    fail "the relay is not answering /chat-health: ${body:-<no response>}"
    return 1
}

if [ "$CHECK_ONLY" -eq 1 ]; then
    log "Checking only — nothing will be changed"
    status=0
    verify_assets || status=1
    verify_relay || status=1
    verify_health || status=1
    exit "$status"
fi

# --------------------------------------------------------------------- deploy
log "Compose project: $PROJECT_NAME"

# Resolve the file before building anything: a missing variable or an
# unreachable build context shows up here in a second, rather than part-way
# through a several-minute image build.
if ! "${COMPOSE_CMD[@]}" config --quiet 2>/tmp/poorija-compose-config.err; then
    fail "The compose file does not resolve:"
    sed 's/^/    /' /tmp/poorija-compose-config.err | head -8
    exit 1
fi
ok "compose file resolves"

log "Building images (no cache)"
"${COMPOSE_CMD[@]}" build --no-cache poorija-cryptography chat-signal || {
    fail "The image build failed; the running stack was left alone."
    exit 1
}

log "Restarting the stack"
"${COMPOSE_CMD[@]}" up -d poorija-cryptography chat-signal || {
    fail "Bringing the stack up failed."
    exit 1
}

# The nginx config is baked into the image by COPY, not bind-mounted, so a
# rebuild that quietly reuses an old layer leaves the running container serving
# the previous routing while every other check passes. That happened once: the
# host file had the new location blocks, the freshly built image did not, and
# the deployment reported success. Compare what is inside the container with
# what was just shipped, and say so if they differ.
APP_CONTAINER="${APP_CONTAINER:-Poorija-Cryptography_App}"
if docker exec "$APP_CONTAINER" test -f /etc/nginx/conf.d/default.conf 2>/dev/null; then
    shipped_sum="$(sha256sum config/nginx.conf 2>/dev/null | cut -d' ' -f1)"
    running_sum="$(docker exec "$APP_CONTAINER" sha256sum /etc/nginx/conf.d/default.conf 2>/dev/null | cut -d' ' -f1)"
    if [ -n "$shipped_sum" ] && [ "$shipped_sum" != "$running_sum" ]; then
        warn "The running container's nginx config is not the one just shipped."
        echo "        Forcing a clean rebuild of the web image."
        "${COMPOSE_CMD[@]}" build --no-cache --pull poorija-cryptography \
            && "${COMPOSE_CMD[@]}" up -d --force-recreate poorija-cryptography
        sleep 3
        running_sum="$(docker exec "$APP_CONTAINER" sha256sum /etc/nginx/conf.d/default.conf 2>/dev/null | cut -d' ' -f1)"
        if [ "$shipped_sum" != "$running_sum" ]; then
            fail "The container still is not serving the shipped nginx config."
            exit 1
        fi
        ok "Rebuilt; the container now serves the shipped config."
    fi
fi

log "Waiting for the relay to come back"
for _ in $(seq 1 30); do
    if docker exec "$RELAY_CONTAINER" node -e "fetch('http://127.0.0.1:9000/chat-health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))" 2>/dev/null; then
        break
    fi
    sleep 2
done

echo
log "Verifying what is actually being served"
status=0
verify_assets || status=1
verify_relay || status=1
verify_health || status=1

echo
if [ "$status" -eq 0 ]; then
    ok "Server is serving $CURRENT_TAG. Offline delivery is live for PWA users."
    echo "  Queued messages and the expiry log in data/ were left untouched."
else
    fail "Deployment finished but verification failed — see above."
fi
exit "$status"
