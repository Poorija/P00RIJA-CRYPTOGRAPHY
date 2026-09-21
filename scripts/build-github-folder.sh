#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Builds GitHub/ — the copy of this project that is safe to publish.
#
#   bash scripts/build-github-folder.sh
#   bash scripts/build-github-folder.sh --zip     # also write GitHub.zip beside it
#   bash scripts/build-github-folder.sh --help
#
# It takes the file list from git rather than from the filesystem, so anything
# .gitignore excludes is excluded here by construction rather than by a list
# somebody has to remember to update: .env, certs/, data/ (the relay's real
# mailboxes), node_modules/, dist/, Export/ and npm-package/app/ cannot end up
# in it even if they are sitting in the working tree.
#
# Then it scrubs. A public repository should not carry one deployment's host
# name, account or paths, and this project's history mentions them in a handful
# of docs, one nginx config and two end-to-end fixtures. The strings to replace
# are NOT in this file — they live in tools/private-strings.txt, which is
# gitignored, so this script can itself be published without being the leak it
# exists to prevent.
#
# Finally it verifies: if any pattern still appears in the output, the build
# fails and names the files. A scrub that silently did nothing is worse than no
# scrub, because it is trusted.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INFO='\033[1;34m'; OK='\033[1;32m'; WARN='\033[1;33m'; ERR='\033[1;31m'; DIM='\033[2m'; NC='\033[0m'
log()  { printf "${INFO}▶ %s${NC}\n" "$1"; }
ok()   { printf "${OK}✓ %s${NC}\n" "$1"; }
warn() { printf "${WARN}! %s${NC}\n" "$1"; }
fail() { printf "${ERR}✖ %s${NC}\n" "$1"; }
dim()  { printf "${DIM}%s${NC}\n" "$1"; }

OUT="GitHub"
PATTERNS="tools/private-strings.txt"
WANT_ZIP=0

for arg in "$@"; do
    case "$arg" in
        --zip) WANT_ZIP=1 ;;
        --help|-h)
            sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) fail "Unknown option: $arg"; exit 2 ;;
    esac
done

command -v git >/dev/null 2>&1 || { fail "git is required."; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { fail "Not a git repository."; exit 1; }

# A dirty tree means the folder would not match any commit, which makes the
# provenance line below a lie. Say so rather than letting somebody find out.
DIRTY=""
[ -n "$(git status --porcelain)" ] && DIRTY="yes"

log "Exporting the tracked tree"
rm -rf "$OUT"
mkdir -p "$OUT"
if ! git archive --format=tar HEAD | (cd "$OUT" && tar -xf -); then
    fail "git archive failed."
    exit 1
fi
FILES="$(find "$OUT" -type f | wc -l | tr -d ' ')"
TRACKED="$(git ls-files | wc -l | tr -d ' ')"
printf "  %-34s %s\n" "files exported" "$FILES"
[ "$FILES" = "$TRACKED" ] || warn "git tracks $TRACKED files but $FILES were written"

# The maintainer's own deployment script never ships; scripts/deploy.sh is the
# one that does, and it asks each user for their own server.
if [ -f "$OUT/scripts/deploy-remote.sh" ]; then
    rm -f "$OUT/scripts/deploy-remote.sh"
    dim "  removed scripts/deploy-remote.sh (personal)"
fi

# Finder writes .DS_Store into any directory somebody opens, which includes
# this one between a build and a publish. git archive cannot produce them, so
# they are not an export bug — they appear afterwards, which is exactly why
# they are swept here rather than trusted not to exist. They carry icon
# positions and window geometry and belong in nobody's repository.
CRUFT="$(find "$OUT" -name '.DS_Store' -o -name '._*' -o -name 'Thumbs.db' | wc -l | tr -d ' ')"
if [ "$CRUFT" != "0" ]; then
    find "$OUT" \( -name '.DS_Store' -o -name '._*' -o -name 'Thumbs.db' \) -delete
    dim "  removed $CRUFT filesystem cruft file(s)"
fi

# --------------------------------------------------------------------- scrub
if [ ! -f "$PATTERNS" ]; then
    warn "No $PATTERNS — nothing was scrubbed."
    dim "  Create it if this tree mentions a real host, account or path:"
    dim "      <literal to find><TAB><replacement>   one per line"
else
    log "Scrubbing deployment-specific strings"
    replaced=0
    while IFS=$'\t' read -r needle replacement; do
        case "$needle" in ''|'#'*) continue ;; esac
        [ -z "$needle" ] && continue
        hits="$(grep -rlF -- "$needle" "$OUT" 2>/dev/null | wc -l | tr -d ' ')"
        [ "$hits" = "0" ] && continue
        # -i '' is the BSD/macOS form; GNU sed wants -i with no argument.
        if sed --version >/dev/null 2>&1; then
            grep -rlF -- "$needle" "$OUT" 2>/dev/null | while read -r f; do
                sed -i "s|$(printf '%s' "$needle" | sed 's/[.[\*^$\/|]/\\&/g')|$replacement|g" "$f"
            done
        else
            grep -rlF -- "$needle" "$OUT" 2>/dev/null | while read -r f; do
                sed -i '' "s|$(printf '%s' "$needle" | sed 's/[.[\*^$\/|]/\\&/g')|$replacement|g" "$f"
            done
        fi
        printf "  %-34s %s file(s) → %s\n" "$needle" "$hits" "$replacement"
        replaced=$((replaced + 1))
    done < "$PATTERNS"
    [ "$replaced" -eq 0 ] && dim "  nothing matched"
fi

# ------------------------------------------------------------------- verify
log "Verifying nothing personal survived"
leaks=0
if [ -f "$PATTERNS" ]; then
    while IFS=$'\t' read -r needle _; do
        case "$needle" in ''|'#'*) continue ;; esac
        found="$(grep -rlF -- "$needle" "$OUT" 2>/dev/null)"
        if [ -n "$found" ]; then
            fail "still present: $needle"
            printf '%s\n' "$found" | sed 's/^/      /'
            leaks=1
        fi
    done < "$PATTERNS"
fi
# Strings that must not appear in a published tree — stray trailers, machine
# addresses, anything an editor leaves behind. The patterns live in
# tools/forbidden-strings.txt, which is gitignored for the same reason the
# scrub list is: a check written as a literal in a published file is the thing
# it is checking for.
FORBIDDEN="tools/forbidden-strings.txt"
if [ -f "$FORBIDDEN" ]; then
    while IFS= read -r ghost; do
        case "$ghost" in ''|'#'*) continue ;; esac
        found="$(grep -rlIiF -- "$ghost" "$OUT" 2>/dev/null)"
        if [ -n "$found" ]; then
            fail "must not be published: $ghost"
            printf '%s\n' "$found" | sed 's/^/      /'
            leaks=1
        fi
    done < "$FORBIDDEN"
fi

# The categories that must never be in a published tree, whatever the patterns
# file says. These are checked by name because their absence is the point.
# Paths that must never be published. The editor/agent workspace directories
# are listed in tools/forbidden-paths.txt alongside them, gitignored for the
# same reason as the patterns above.
for forbidden in .env certs data node_modules dist Export npm-package/app .git scripts/deploy-remote.sh .DS_Store $(cat tools/forbidden-paths.txt 2>/dev/null); do
    if [ -e "$OUT/$forbidden" ]; then
        fail "must not be published: $forbidden"
        leaks=1
    fi
done
if [ "$leaks" -ne 0 ]; then
    fail "GitHub/ was built but is NOT safe to publish. Fix the above and re-run."
    exit 1
fi
ok "no deployment details, secrets, certificates or build output"

# ------------------------------------------------------------------ provenance
COMMIT="$(git rev-parse --short HEAD)"
TAG="$(grep -oE '\?v=[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9._-]+' index.html 2>/dev/null | head -1 | sed 's/^?v=//')"
{
    printf 'Built from commit %s\n' "$COMMIT"
    [ -n "$TAG" ] && printf 'Asset tag %s\n' "$TAG"
    [ -n "$DIRTY" ] && printf 'NOTE: the working tree had uncommitted changes, so this folder\nmatches the commit above plus whatever was uncommitted.\n'
} > "$OUT.provenance.txt"

if [ "$WANT_ZIP" -eq 1 ]; then
    log "Zipping"
    rm -f GitHub.zip
    ( cd "$OUT" && zip -qry ../GitHub.zip . )
    ok "GitHub.zip ($(du -h GitHub.zip | cut -f1))"
fi

echo
ok "GitHub/ is ready — $FILES files, commit $COMMIT${TAG:+, $TAG}"
[ -n "$DIRTY" ] && warn "the working tree has uncommitted changes; commit them and re-run for a clean match"
dim "  Open it in GitHub Desktop, or drag it onto github.com."
exit 0
