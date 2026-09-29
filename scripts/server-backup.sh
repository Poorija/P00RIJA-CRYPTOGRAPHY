#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Snapshots the running install into a git repository on the same server.
#
#   bash scripts/server-backup.sh "why"      # take a snapshot
#   bash scripts/server-backup.sh --list     # show what snapshots exist
#   bash scripts/server-backup.sh --restore <ref> [path…]
#   bash scripts/server-backup.sh --prune --dry-run   # what pruning would drop
#   bash scripts/server-backup.sh --prune             # drop it
#
# This runs ON THE SERVER. deploy.sh copies it up and calls it before
# it overwrites anything, so every deployment is preceded by a commit you can
# go back to.
#
# WHY GIT AND NOT A TARBALL
# -------------------------
# There were already two tarballs sitting in the home directory from August,
# named after a version, with no record of what was in them or which came
# first. Git gives three things a tarball does not: a diff between any two
# snapshots, storage that costs nothing for the files that did not change
# (fonts alone are 31 MB and change never), and a log that says why.
#
# WHAT IS IN IT, AND THE WARNING THAT GOES WITH THAT
# --------------------------------------------------
# Everything needed to bring the service back: the code, config/, data/ with
# the offline mailboxes, certs/ and .env.
#
# That means THIS REPOSITORY CONTAINS SECRETS — the TLS private key and the
# monitor password. It is created mode 0700 and it must never be pushed to a
# remote, copied to another machine, or archived anywhere less protected than
# the server itself. It is a rollback tool, not an off-site backup.
#
# An off-site backup of the same material would be a good idea, but it needs
# encrypting first, and choosing where it goes is the operator's decision, not
# a script's.

set -uo pipefail

BACKUP_ROOT="${POORIJA_BACKUP_DIR:-$HOME/backups/poorija}"
SOURCE_DIR="${POORIJA_SOURCE_DIR:-$HOME/work/pkg}"

# ------------------------------------------------------------------ retention
#
# Without this the repository grows for ever. On the server this was written
# for it had reached 125 snapshots and 106 MB on a disk with 6 GB free, which
# is the shape of the problem: nothing here was wrong, there was simply no
# point at which anything was ever dropped.
#
# What is kept is expressed in VERSIONS rather than snapshots, because that is
# what somebody rolling back is thinking in. A snapshot is taken per deployment
# AND before every restore, so two deployments of one version leave three
# snapshots between them — counting snapshots would silently keep fewer
# versions than asked for.
#
# KEEP_VERSIONS is how many versions OLDER than the current one stay
# restorable. KEEP_MIN is the floor in snapshots, so a server that has only
# ever served one version still keeps a few points to go back to.
KEEP_VERSIONS="${POORIJA_BACKUP_KEEP_VERSIONS:-2}"
KEEP_MIN="${POORIJA_BACKUP_KEEP_MIN:-3}"

# Walks the history newest first and prints the commit that should become the
# new root — the oldest one worth keeping — or nothing when there is nothing to
# drop. Everything older than it goes.
oldest_to_keep() {
    local seen_versions=0 count=0 current="" version="" commit="" keep=""
    while read -r commit; do
        count=$((count + 1))
        # The version this snapshot served, read out of the snapshot itself
        # rather than from a commit message somebody could have typed.
        version="$(git -C "$BACKUP_ROOT" show "$commit:index.html" 2>/dev/null \
            | grep -oE '\?v=[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9._-]+' | head -1 | sed 's/^?v=//')"
        if [ -z "$current" ]; then
            current="$version"
        elif [ -n "$version" ] && [ "$version" != "$current" ]; then
            current="$version"
            seen_versions=$((seen_versions + 1))
        fi
        keep="$commit"
        # Enough only when BOTH are satisfied: the versions asked for, and the
        # floor in snapshots.
        if [ "$seen_versions" -ge "$KEEP_VERSIONS" ] && [ "$count" -ge "$KEEP_MIN" ]; then
            printf '%s\n' "$keep"
            return 0
        fi
    done < <(git -C "$BACKUP_ROOT" rev-list HEAD)
    return 0
}

# Truncating a git history means giving it a new root. The graft says "this
# commit has no parents", filter-branch bakes that into real objects, and only
# then can gc reclaim anything — the reflog holds on to the old tips until it
# is expired, which is why a plain `gc` after a graft frees nothing at all.
prune_history() {
    local dry_run="$1" base before after dropped
    [ -d "$BACKUP_ROOT/.git" ] || { warn "No backups to prune."; return 0; }

    before="$(git -C "$BACKUP_ROOT" rev-list --count HEAD)"
    base="$(oldest_to_keep)"
    if [ -z "$base" ]; then
        ok "Nothing to prune: $before snapshot(s), all of them inside the retention window."
        return 0
    fi
    dropped="$(git -C "$BACKUP_ROOT" rev-list --count "$base")"
    dropped=$((dropped - 1))
    if [ "$dropped" -le 0 ]; then
        ok "Nothing to prune: $before snapshot(s) within $KEEP_VERSIONS previous version(s)."
        return 0
    fi

    log "Keeping the newest $((before - dropped)) snapshot(s) — $KEEP_VERSIONS previous version(s), floor $KEEP_MIN"
    printf "  new oldest:  %s  %s\n" "$(git -C "$BACKUP_ROOT" log -1 --format=%h "$base")" \
        "$(git -C "$BACKUP_ROOT" log -1 --format=%s "$base")"
    printf "  dropping:    %s older snapshot(s), oldest first\n" "$dropped"
    git -C "$BACKUP_ROOT" log --format='    %h  %ad  %s' --date=format:'%Y-%m-%d %H:%M' \
        "$base" 2>/dev/null | tail -n +2 | tail -5 | sed 's/$/ …/'

    if [ "$dry_run" = "1" ]; then
        printf "  repository size now: %s (nothing was changed)\n" \
            "$(du -sh "$BACKUP_ROOT/.git" 2>/dev/null | cut -f1)"
        return 0
    fi

    git -C "$BACKUP_ROOT" replace --graft "$base" >/dev/null 2>&1 || {
        fail "Could not graft a new root; nothing was changed."; return 1; }
    if ! FILTER_BRANCH_SQUELCH_WARNING=1 \
        git -C "$BACKUP_ROOT" filter-branch -f -- --all >/dev/null 2>&1; then
        git -C "$BACKUP_ROOT" replace -d "$base" >/dev/null 2>&1
        fail "Rewriting the history failed; the graft was removed and nothing was lost."
        return 1
    fi
    git -C "$BACKUP_ROOT" replace -d "$base" >/dev/null 2>&1
    rm -rf "$BACKUP_ROOT/.git/refs/original"
    git -C "$BACKUP_ROOT" reflog expire --expire=now --expire-unreachable=now --all >/dev/null 2>&1
    git -C "$BACKUP_ROOT" gc --prune=now --quiet >/dev/null 2>&1

    after="$(git -C "$BACKUP_ROOT" rev-list --count HEAD)"
    ok "Pruned: $before → $after snapshot(s), repository now $(du -sh "$BACKUP_ROOT/.git" 2>/dev/null | cut -f1)"
}

INFO='\033[1;34m'; OK='\033[1;32m'; WARN='\033[1;33m'; ERR='\033[1;31m'; NC='\033[0m'
log()  { printf "${INFO}▶ %s${NC}\n" "$1"; }
ok()   { printf "${OK}✓ %s${NC}\n" "$1"; }
warn() { printf "${WARN}! %s${NC}\n" "$1"; }
fail() { printf "${ERR}✖ %s${NC}\n" "$1"; }

if ! command -v git >/dev/null 2>&1; then
    fail "git is not installed."
    echo "  sudo apt-get update && sudo apt-get install -y git"
    exit 1
fi

if [ ! -d "$SOURCE_DIR" ]; then
    fail "No install at $SOURCE_DIR"
    exit 1
fi

# -------------------------------------------------------------------- prune
if [ "${1:-}" = "--prune" ]; then
    DRY=0
    [ "${2:-}" = "--dry-run" ] && DRY=1
    prune_history "$DRY"
    exit $?
fi

# --------------------------------------------------------------------- list
if [ "${1:-}" = "--list" ]; then
    if [ ! -d "$BACKUP_ROOT/.git" ]; then
        warn "No backups yet at $BACKUP_ROOT"
        exit 0
    fi
    git -C "$BACKUP_ROOT" log --format='%h  %ad  %s' --date=format:'%Y-%m-%d %H:%M' | head -40
    echo
    printf "  repository size: %s\n" "$(du -sh "$BACKUP_ROOT/.git" 2>/dev/null | cut -f1)"
    exit 0
fi

# ------------------------------------------------------------------ restore
if [ "${1:-}" = "--restore" ]; then
    REF="${2:-}"
    if [ -z "$REF" ]; then
        fail "Which snapshot? Run --list first, then --restore <hash>"
        exit 2
    fi
    shift 2
    if [ ! -d "$BACKUP_ROOT/.git" ]; then fail "No backups to restore from."; exit 1; fi

    # Restoring into a live install is the one operation here that can lose
    # work, so it takes a snapshot of the current state first and says what it
    # is about to do rather than just doing it.
    log "Snapshotting the current state before restoring over it"
    "$0" "before restoring $REF" >/dev/null 2>&1

    PATHS=("$@")
    [ ${#PATHS[@]} -eq 0 ] && PATHS=(js css assets scripts config index.html sw.js manifest.webmanifest)

    log "Restoring ${PATHS[*]} from $REF"
    for p in "${PATHS[@]}"; do
        if git -C "$BACKUP_ROOT" cat-file -e "$REF:$p" 2>/dev/null; then
            rm -rf "${SOURCE_DIR:?}/$p"
            git -C "$BACKUP_ROOT" archive "$REF" -- "$p" | tar -x -C "$SOURCE_DIR"
            printf "  restored %s\n" "$p"
        else
            warn "not in that snapshot: $p"
        fi
    done
    ok "Restored. Rebuild with: cd $SOURCE_DIR && docker compose -f config/docker-compose.yaml up -d --build"
    exit 0
fi

# ------------------------------------------------------------------ snapshot
REASON="${1:-manual snapshot}"

mkdir -p "$BACKUP_ROOT"
chmod 700 "$(dirname "$BACKUP_ROOT")" 2>/dev/null || true
chmod 700 "$BACKUP_ROOT"

if [ ! -d "$BACKUP_ROOT/.git" ]; then
    log "Creating the backup repository at $BACKUP_ROOT"
    git -C "$BACKUP_ROOT" init -q -b main
    git -C "$BACKUP_ROOT" config user.name "P00RIJA server backup"
    git -C "$BACKUP_ROOT" config user.email "backup@localhost"
    # A backup that can be pushed by accident is a secret leak waiting to
    # happen. There is no remote, and this makes adding one deliberate.
    git -C "$BACKUP_ROOT" config remote.pushDefault "no-remote-configured"
    cat > "$BACKUP_ROOT/BACKUP-NOTES.md" <<'DOC'
# Server snapshots

(This file is BACKUP-NOTES.md, not README.md — the install has a README of its
own and rsync copies it in here.)

Every deployment commits here first. `git log` is the list; each message says
what the deployment was.

    bash ~/work/pkg/scripts/server-backup.sh --list
    bash ~/work/pkg/scripts/server-backup.sh --restore <hash>

## This repository holds secrets

`.env` and `certs/key.pem` are in here, because a backup you cannot restore
service from is not a backup. The directory is mode 0700 and has no remote
configured, deliberately.

Do not push it, copy it to another machine, or include it in an archive that
leaves this server unencrypted.
DOC
    ok "repository created (mode 0700, no remote)"
fi

log "Copying the install"
# node_modules and build output are reproducible and enormous; everything else
# goes in, secrets included.
RSYNC_LOG="$(mktemp)"
rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'src-tauri/target' \
    --exclude '*.log' \
    --exclude '.DS_Store' \
    "$SOURCE_DIR/" "$BACKUP_ROOT/" \
    --filter 'protect BACKUP-NOTES.md' >"$RSYNC_LOG" 2>&1
RSYNC_STATUS=$?
tail -3 "$RSYNC_LOG" | sed 's/^/    /'

# ---------------------------------------------------------- the unreadable
#
# The containers run as root and write some of their state as root:root 0600.
# rsync reports those as "Permission denied", exits 23, and — in the first
# version of this script — that message went through a pipe to `tail`, so the
# exit code was the pipe's and the run reported success. The file that was
# actually being skipped was data/chat-signal/vapid.json: the Web Push
# keypair. Losing it silently would have broken the push subscription of every
# installed copy of the app, and the backup would have said it went fine.
#
# Being in the docker group is being root by another route, so the file is
# reachable; it just needs a container to reach it.
#
# DIRECTORIES count, not only files. `-type f` missed the case that matters most:
# on a fresh install the container creates data/chat-signal as root:root 0700, so
# the whole state directory is unreadable, find cannot descend into it to report
# any file inside, and this scan came back empty. The run then fell through to
# the rsync-status branch and failed the entire backup of a server whose state
# was perfectly rescuable. Which is how the second server's first deployment
# ended with no snapshot at all.
#
# An unreadable directory is rescued as a whole tree, because nothing inside it
# can be enumerated from out here; -prune stops find from trying.
UNREADABLE="$(cd "$SOURCE_DIR" && find . -path ./node_modules -prune -o \( ! -readable \) -prune -print 2>/dev/null | sed 's|^\./||')"
RESCUED=""
MISSED=""

if [ -n "$UNREADABLE" ]; then
    warn "$(printf '%s\n' "$UNREADABLE" | wc -l | tr -d ' ') file(s) are not readable by $(whoami)"
    if command -v docker >/dev/null 2>&1 && docker image inspect alpine:latest >/dev/null 2>&1; then
        log "Fetching them through a container"
        while IFS= read -r rel; do
            [ -z "$rel" ] && continue
            mkdir -p "$BACKUP_ROOT/$(dirname "$rel")"
            # -a rather than -p, and -R on the chown, so the same call handles a
            # single 0600 file and a whole root-owned state directory. The
            # trailing /. copies the CONTENTS of a directory into an existing
            # destination of the same name instead of nesting it one deeper.
            if docker run --rm \
                 -v "$SOURCE_DIR:/src:ro" \
                 -v "$BACKUP_ROOT:/dst" \
                 alpine:latest \
                 sh -c "if [ -d '/src/$rel' ]; then mkdir -p '/dst/$rel' && cp -a '/src/$rel/.' '/dst/$rel/'; else cp -p '/src/$rel' '/dst/$rel'; fi && chown -R $(id -u):$(id -g) '/dst/$rel'" >/dev/null 2>&1
            then
                printf "    rescued %s\n" "$rel"
                RESCUED="$RESCUED $rel"
            else
                fail "could not read $rel even through a container"
                MISSED="$MISSED $rel"
            fi
        done <<< "$UNREADABLE"
    else
        MISSED="$UNREADABLE"
        fail "docker is not usable here, so these cannot be backed up:"
        printf '%s\n' "$UNREADABLE" | sed 's/^/      /'
    fi
elif [ "$RSYNC_STATUS" -ne 0 ]; then
    fail "rsync exited $RSYNC_STATUS and it was not a permissions problem:"
    tail -10 "$RSYNC_LOG" | sed 's/^/      /'
    rm -f "$RSYNC_LOG"
    exit 1
fi
rm -f "$RSYNC_LOG"

# A snapshot with a known hole is still worth keeping — but the hole goes in
# the commit message, so `git log` shows it rather than hiding it.
GAPS=""
[ -n "$MISSED" ] && GAPS="NOT BACKED UP:$MISSED"

git -C "$BACKUP_ROOT" add -A >/dev/null 2>&1

if git -C "$BACKUP_ROOT" diff --cached --quiet 2>/dev/null; then
    ok "Nothing has changed since the last snapshot."
    exit 0
fi

CHANGED="$(git -C "$BACKUP_ROOT" diff --cached --numstat | wc -l | tr -d ' ')"
VERSION="$(grep -oE '\?v=[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9._-]+' "$SOURCE_DIR/index.html" 2>/dev/null | head -1 | sed 's/^?v=//')"

git -C "$BACKUP_ROOT" commit -q -m "$REASON" -m "version served: ${VERSION:-unknown}
files changed: $CHANGED
taken: $(date -u +%Y-%m-%dT%H:%M:%SZ)${RESCUED:+
rescued through a container:$RESCUED}${GAPS:+
$GAPS}"

ok "Snapshot taken: $(git -C "$BACKUP_ROOT" rev-parse --short HEAD)  ($CHANGED files changed, version ${VERSION:-unknown})"

# Pruned here rather than left to a cron job or to somebody remembering: the
# only moment the repository is known to be consistent and the only moment
# anybody is looking at its output.
prune_history 0

printf "  repository size: %s\n" "$(du -sh "$BACKUP_ROOT/.git" 2>/dev/null | cut -f1)"
if [ -n "$MISSED" ]; then
    fail "This snapshot is incomplete. Missing:$MISSED"
    exit 1
fi
