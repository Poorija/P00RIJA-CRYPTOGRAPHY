#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Updates a server install to the latest published release.
#
#   bash scripts/update-server.sh            # check, show, ask, then update
#   bash scripts/update-server.sh --check    # say what is available and stop
#   bash scripts/update-server.sh --yes      # no prompt, for a cron entry
#   bash scripts/update-server.sh --help
#
# WHAT IT NEVER TOUCHES
#
# .env, certs/, data/ and anything else the install created are left exactly
# where they are. The release tarball is unpacked over the code and nothing
# else, because the code is the only part of an install that came from this
# repository. A configuration file replaced by an upgrade is the fastest way
# to take a working server down, and it is the mistake people find at 3am.
#
# A snapshot is taken first through scripts/server-backup.sh, so a bad upgrade
# is one restore away rather than a reinstall.

set -uo pipefail

REPO="Poorija/P00RIJA-Cryptography"
API="https://api.github.com/repos/$REPO/releases/latest"

INFO='\033[1;34m'; OK='\033[1;32m'; WARN='\033[1;33m'; ERR='\033[1;31m'; DIM='\033[2m'; NC='\033[0m'
say()  { printf "${INFO}▶ %s${NC}\n" "$1"; }
good() { printf "${OK}✓ %s${NC}\n" "$1"; }
warn() { printf "${WARN}! %s${NC}\n" "$1"; }
fail() { printf "${ERR}✗ %s${NC}\n" "$1" >&2; }
dim()  { printf "${DIM}  %s${NC}\n" "$1"; }

ASSUME_YES=0
CHECK_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --yes|-y)   ASSUME_YES=1 ;;
        --check)    CHECK_ONLY=1 ;;
        --help|-h)
            sed -n '10,27p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) fail "Unknown option: $arg"; exit 2 ;;
    esac
done

# The install is wherever this script lives, one level up -- the same shape the
# deploy script leaves behind.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT" || { fail "Cannot enter $ROOT"; exit 1; }

for tool in curl tar; do
    command -v "$tool" >/dev/null 2>&1 || { fail "$tool is required and not installed."; exit 1; }
done

# ---------------------------------------------------------------------------
# What is installed, and what is published
# ---------------------------------------------------------------------------
if [ ! -f package.json ]; then
    fail "No package.json in $ROOT — this does not look like an install."
    exit 1
fi
LOCAL_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)"
[ -n "$LOCAL_VERSION" ] || { fail "Could not read the installed version."; exit 1; }

say "Asking GitHub what the latest release is"
RELEASE_JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API" 2>/dev/null)"
if [ -z "$RELEASE_JSON" ]; then
    fail "GitHub could not be reached, or the repository has no releases yet."
    exit 1
fi

json_field() { printf '%s' "$RELEASE_JSON" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1; }
REMOTE_TAG="$(json_field tag_name)"
REMOTE_VERSION="${REMOTE_TAG#v}"
TARBALL="$(json_field tarball_url)"
[ -n "$REMOTE_VERSION" ] || { fail "The latest release carries no tag."; exit 1; }

# Numeric, field by field. Comparing these as strings reports 2.9.0 as newer
# than 2.35.0, which is how an updater talks somebody into a downgrade.
newer_than() {
    local a b i x y
    IFS=. read -r -a a <<< "${1#v}"
    IFS=. read -r -a b <<< "${2#v}"
    for i in 0 1 2; do
        x="${a[i]:-0}"; y="${b[i]:-0}"
        x="${x%%[^0-9]*}"; y="${y%%[^0-9]*}"
        [ "${x:-0}" -gt "${y:-0}" ] && return 0
        [ "${x:-0}" -lt "${y:-0}" ] && return 1
    done
    return 1
}

echo
printf "  installed   %s\n" "$LOCAL_VERSION"
printf "  published   %s\n" "$REMOTE_VERSION"
echo

if ! newer_than "$REMOTE_VERSION" "$LOCAL_VERSION"; then
    good "Already up to date."
    exit 0
fi

# ---------------------------------------------------------------------------
# What changed
# ---------------------------------------------------------------------------
say "What this release says"
printf '%s' "$RELEASE_JSON" \
    | tr ',' '\n' \
    | sed -n 's/.*"body"[[:space:]]*:[[:space:]]*"\(.*\)/\1/p' \
    | head -1 \
    | sed 's/\\r//g; s/\\n/\n/g; s/\\"/"/g; s/"$//' \
    | head -40 \
    | sed 's/^/  /'
echo

[ "$CHECK_ONLY" -eq 1 ] && { warn "Check only — nothing was changed."; exit 0; }

if [ "$ASSUME_YES" -ne 1 ]; then
    printf "Update this server to %s? [y/N] " "$REMOTE_VERSION"
    read -r answer </dev/tty
    case "$answer" in
        y|Y|yes|YES) ;;
        *) warn "Left alone."; exit 0 ;;
    esac
fi

# ---------------------------------------------------------------------------
# Snapshot, fetch, unpack, restart
# ---------------------------------------------------------------------------
if [ -x scripts/server-backup.sh ] || [ -f scripts/server-backup.sh ]; then
    say "Taking a snapshot first"
    bash scripts/server-backup.sh "before update to $REMOTE_VERSION" >/dev/null 2>&1 \
        && good "Snapshot taken" \
        || warn "Snapshot failed — continuing, but a rollback will be manual"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say "Downloading $REMOTE_VERSION"
if ! curl -fsSL "$TARBALL" -o "$WORK/release.tar.gz"; then
    fail "The download failed. Nothing was changed."
    exit 1
fi
tar -xzf "$WORK/release.tar.gz" -C "$WORK" || { fail "The archive would not unpack. Nothing was changed."; exit 1; }
SRC="$(find "$WORK" -maxdepth 1 -type d -name "${REPO#*/}-*" | head -1)"
[ -n "$SRC" ] || SRC="$(find "$WORK" -maxdepth 1 -mindepth 1 -type d | head -1)"
[ -d "$SRC" ] || { fail "The archive had no source directory. Nothing was changed."; exit 1; }

# Everything the install owns rather than the repository. Copying the release
# over these is how a working server loses its certificates and its identity.
say "Replacing the code, keeping this server's own files"
KEEP=(.env certs data Export node_modules .git logs backups)
for item in "${KEEP[@]}"; do
    [ -e "$ROOT/$item" ] && dim "keeping $item"
done

RSYNC_EXCLUDES=()
for item in "${KEEP[@]}"; do RSYNC_EXCLUDES+=(--exclude "$item"); done

if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$SRC"/ "$ROOT"/ || { fail "The copy failed. Restore the snapshot."; exit 1; }
else
    # No rsync: copy over the top instead. Nothing is deleted, which leaves
    # files a release removed still sitting there -- said plainly rather than
    # pretended away.
    warn "rsync is not installed; copying without removing files this release dropped"
    ( cd "$SRC" && tar -cf - . ) | ( cd "$ROOT" && tar -xf - ) \
        || { fail "The copy failed. Restore the snapshot."; exit 1; }
fi
good "Code replaced"

if command -v docker >/dev/null 2>&1 && [ -f config/docker-compose.yaml ]; then
    say "Rebuilding and restarting the services"
    if docker compose -f config/docker-compose.yaml up -d --build; then
        good "Services are up on $REMOTE_VERSION"
    else
        fail "The services did not come back. Restore with:"
        dim "bash scripts/server-backup.sh --list"
        exit 1
    fi
else
    warn "Docker or config/docker-compose.yaml is missing — restart the services yourself."
fi

echo
good "Updated $LOCAL_VERSION → $REMOTE_VERSION"
