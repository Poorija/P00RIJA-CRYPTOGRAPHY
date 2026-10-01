#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Puts the publish-safe export into the local GitHub Desktop clone and commits
# it there, so the only thing left to do is press Push in GitHub Desktop.
#
#   bash scripts/sync-github-desktop.sh
#   bash scripts/sync-github-desktop.sh ~/Documents/GitHub/OTHER-CLONE
#   POORIJA_GITHUB_DESKTOP_DIR=... bash scripts/sync-github-desktop.sh
#
# What it does, in order:
#   1. rebuilds GitHub/ with build-github-folder.sh — the export is taken
#      from git, so anything uncommitted is not included; commit first;
#   2. checks the destination clone is clean and refuses otherwise: a clone
#      carrying edits of its own is a question only a person can answer, and
#      rsync --delete is not where guesses about it belong;
#   3. mirrors the export over the clone (deleting files the export dropped,
#      never touching .git);
#   4. commits everything as one release commit, authored p00rija.
#
# It never pushes. Pushing is the one step that publishes, and it stays a
# button a person presses on purpose.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INFO='\033[1;34m'; OK='\033[1;32m'; WARN='\033[1;33m'; ERR='\033[1;31m'; DIM='\033[2m'; NC='\033[0m'
log()  { printf "${INFO}▶ %s${NC}\n" "$1"; }
ok()   { printf "${OK}✓ %s${NC}\n" "$1"; }
warn() { printf "${WARN}! %s${NC}\n" "$1"; }
fail() { printf "${ERR}✖ %s${NC}\n" "$1"; }
dim()  { printf "${DIM}%s${NC}\n" "$1"; }

DEST="${POORIJA_GITHUB_DESKTOP_DIR:-${1:-$HOME/Documents/GitHub/P00RIJA-CRYPTOGRAPHY}}"

command -v git >/dev/null 2>&1 || { fail "git is required."; exit 1; }
command -v rsync >/dev/null 2>&1 || { fail "rsync is required."; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { fail "Not a git repository."; exit 1; }

# --------------------------------------------------------------- 1. the export
log "Rebuilding the publish-safe export"
bash "$ROOT/scripts/build-github-folder.sh"
# The builder prints its own verdict; anything it exported is what lands on
# GitHub, so its scrub failing is this script failing too.
EXPORT="$ROOT/GitHub"
[ -d "$EXPORT" ] || { fail "The export was not created."; exit 1; }

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$EXPORT/package.json" | head -1)"
[ -n "$VERSION" ] || { fail "Could not read the version from the export."; exit 1; }

# ------------------------------------------------------- 2. the destination clone
log "Checking the GitHub Desktop clone at $DEST"
if [ ! -d "$DEST/.git" ]; then
    fail "$DEST is not a git clone."
    echo
    echo "  Pass the clone's path as the first argument, or set"
    echo "  POORIJA_GITHUB_DESKTOP_DIR. It has to be the clone GitHub Desktop"
    echo "  syncs — the one whose Push button you press."
    exit 1
fi
if ! git -C "$DEST" diff --quiet || ! git -C "$DEST" diff --cached --quiet; then
    fail "The clone has changes of its own (modified or staged)."
    echo
    echo "  This script mirrors the export over the clone with --delete; doing"
    echo "  that over uncommitted edits would throw them away without asking."
    echo "  Commit or stash them in the clone first, then run this again."
    exit 1
fi
UNTRACKED="$(git -C "$DEST" status --porcelain | grep '^??' | grep -v '\.DS_Store' || true)"
if [ -n "$UNTRACKED" ]; then
    fail "The clone has untracked files of its own:"
    printf '%s\n' "$UNTRACKED" | sed 's/^/      /'
    echo
    echo "  --delete would remove them. Move them out (or commit them) first."
    exit 1
fi
ok "clone is clean and ready"

# ------------------------------------------------------------------ 3. the mirror
log "Mirroring the export into the clone"
# --delete: the export is the whole truth about what belongs on GitHub, and a
#   file this round dropped would otherwise live on there forever.
# .git excluded for obvious reasons; .DS_Store because Finder leaves them
#   behind and they are not anybody's work.
rsync -a --delete --exclude='.git' --exclude='.DS_Store' "$EXPORT"/ "$DEST"/

# ------------------------------------------------------------------- 4. the commit
log "Committing in the clone"
if git -C "$DEST" diff --quiet && git -C "$DEST" diff --cached --quiet; then
    ok "The clone already matches the export — nothing to commit."
else
    git -C "$DEST" add -A
    git -C "$DEST" -c user.name='p00rija' -c user.email='p00rija@tutamail.com' \
        commit -m "P00RIJA Cryptography $VERSION"
    ok "Committed as P00RIJA Cryptography $VERSION"
fi

echo
ok "The clone is one Push away from GitHub:"
dim "  open GitHub Desktop → $DEST → Push origin"
