#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.
# ---------------------------------------------------------------------------
# Applies an update package (scripts/lib/update-package.js) to this install,
# the way `scripts/deploy.sh --prebuilt` would from the operator's computer:
#
#   bash scripts/apply-update.sh PACKAGE
#
# Run in the install folder, as the account that owns it. The relay starts it
# when its update is due (after checking the operator's signature), and the
# central panel runs it over SSH on a server that has no updater yet.
#
#   1. the package must be byte for byte the one that was checked (its
#      PACKAGE.sha256, written by whoever verified the operator's signature),
#      exactly the four members a package has, newer than what is installed,
#      every member as the manifest names it, the tree of the package's own
#      version; nothing is touched before
#   2. a snapshot of the install (scripts/server-backup.sh), the way back
#   3. the images are loaded
#   4. the new tree replaces the old one, folder by folder, as a deploy copies
#      it (what the new tree no longer has goes); .env and data/ stay as they
#      are. The old tree is copied aside first, for the way back.
#   5. the NEW tree's scripts/sync-to-server.sh --prebuilt restarts the stack
#   6. the relay is watched for UPDATE_HEALTH_WATCH_S seconds (120): through
#      nginx it must answer /chat-health, serve the new version, not restart,
#      and, if it was linked to its family before, be linked again
#
# When 4, 5 or 6 fails, the old tree goes back and the OLD tree's own
# sync-to-server.sh brings the previous version up again (its images are still
# here: every deploy keeps the version before). .env and data/ were never
# touched, so nothing that arrived in between is lost. Nothing is retried.
#
# Exit: 0 updated; 1 refused or failed before anything changed; 3 failed and
# put back, the previous version serving; 4 failed, and putting it back failed
# too. UPDATE_AUTO_REVERT=0 leaves a failure as it is (exit 1), for an
# operator working on the server.
# ---------------------------------------------------------------------------
set -euo pipefail
{

say()  { printf '%s\n' "$*"; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

PACKAGE="${1:-}"
[ -n "$PACKAGE" ] || die "usage: bash scripts/apply-update.sh PACKAGE"
[ -f "$PACKAGE" ] || die "no package at $PACKAGE"
PACKAGE="$(cd "$(dirname "$PACKAGE")" && pwd)/$(basename "$PACKAGE")"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# ---- 1. the package is the one that was checked ------------------------------------
# The signature was checked by the relay (or the panel) that wrote PACKAGE.sha256;
# this file must still be that one. tar reads a package its own way (the last
# member of a name wins), so it must also hold the four members and no others.
[ -f "$PACKAGE.sha256" ] || die "no record that $PACKAGE was checked ($PACKAGE.sha256); nothing was changed"
[ "$(sha "$PACKAGE")" = "$(tr -d ' \n' < "$PACKAGE.sha256" | cut -c1-64)" ] || die "$PACKAGE is not the package that was checked; nothing was changed"
[ "$(tar tf "$PACKAGE" 2>/dev/null | tr '\n' ' ')" = "manifest.json manifest.sig source.tar.gz images.tar.gz " ] \
  || die "$PACKAGE is not an update package (manifest.json, manifest.sig, source.tar.gz and images.tar.gz, once each); nothing was changed"

WORK="$(mktemp -d "$ROOT/.update.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
tar xf "$PACKAGE" -C "$WORK" manifest.json source.tar.gz images.tar.gz 2>/dev/null \
  || die "$PACKAGE is not an update package (a tar with manifest.json, source.tar.gz and images.tar.gz)"
manifest="$(cat "$WORK/manifest.json")"
version="$(printf '%s' "$manifest" | sed -n 's/.*"version":"\([0-9][0-9.]*\)".*/\1/p')"
printf '%s' "$version" | grep -Eqx '[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}' || die "the manifest names no version"
# Never back: an older signed package is still signed, and would bring back
# what a later release fixed.
installed="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" 2>/dev/null | head -1)"
newer() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)" = "$1" ] && [ "$1" != "$2" ]; }
[ -z "$installed" ] || newer "$version" "$installed" || die "$version is not newer than the installed $installed; nothing was changed"
# The operator's signature again, here, against the key this server trusts
# (CHAT_OPERATOR_KEY in .env), wherever this machine has openssl to do it.
operator_key="$(sed -n 's/^CHAT_OPERATOR_KEY=//p' "$ROOT/.env" 2>/dev/null | tail -1 | tr -d "\"' ")"
if [ -n "$operator_key" ] && command -v openssl >/dev/null 2>&1; then
  tar xf "$PACKAGE" -C "$WORK" manifest.sig
  { echo '-----BEGIN PUBLIC KEY-----'; printf '%s\n' "$operator_key" | fold -w 64; echo '-----END PUBLIC KEY-----'; } > "$WORK/operator.pem"
  openssl base64 -d -A -in "$WORK/manifest.sig" -out "$WORK/manifest.sig.der" 2>/dev/null \
    && openssl dgst -sha256 -verify "$WORK/operator.pem" -signature "$WORK/manifest.sig.der" "$WORK/manifest.json" >/dev/null 2>&1 \
    || die "the operator's signature on $PACKAGE does not hold for the key this server trusts; nothing was changed"
fi
for member in source.tar.gz images.tar.gz; do
  want="$(printf '%s' "$manifest" | sed -n "s/.*\"$member\":{\"sha256\":\"\([0-9a-f]\{64\}\)\".*/\1/p")"
  [ -n "$want" ] && [ "$(sha "$WORK/$member")" = "$want" ] \
    || die "$member is not the one the manifest names; nothing was changed"
done
mkdir "$WORK/src"
tar xzf "$WORK/source.tar.gz" -C "$WORK/src" || die "the source in the package does not unpack; nothing was changed"
tree_version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$WORK/src/package.json" 2>/dev/null | head -1)"
[ "$tree_version" = "$version" ] || die "the tree in the package is ${tree_version:-of no version}, not $version; nothing was changed"
[ -f "$WORK/src/scripts/sync-to-server.sh" ] || die "the tree in the package has no scripts/sync-to-server.sh; nothing was changed"
say "▶ Updating to $version"

DIRS="js css assets fonts vendor scripts config tests"
FILES="index.html sw.js manifest.webmanifest monitor-client.html package.json"
WATCH_S="${UPDATE_HEALTH_WATCH_S:-120}"
POLL_S="${UPDATE_HEALTH_POLL_S:-10}"
RELAY_CONTAINER="Poorija-Cryptography_ChatSignal"
port="$(sed -n 's/^APP_PORT=//p' "$ROOT/.env" 2>/dev/null | tail -1 | tr -d "\"' ")"
HEALTH_URL="https://127.0.0.1:${port:-8585}/chat-health"

# The relay as its users reach it: through nginx, from the host.
health_body() {
  curl -sk --max-time 10 "$HEALTH_URL" 2>/dev/null \
    || wget -qO- --no-check-certificate -T 10 "$HEALTH_URL" 2>/dev/null || true
}
# One line of JSON in, one value out (no early-closing pipe for pipefail to trip on).
links_up() { printf '%s\n' "$1" | sed -n 's/.*"transit":{[^}]*"up":\([0-9][0-9]*\).*/\1/p'; }
served_version() { printf '%s\n' "$1" | sed -n 's/.*"version":"\([0-9][0-9.]*\)".*/\1/p'; }
container_mark() { docker inspect -f '{{.RestartCount}} {{.State.StartedAt}}' "$RELAY_CONTAINER" 2>/dev/null || true; }

# Healthy at the end of the watch: answering, the version wanted, the same
# container all along since it first answered, and linked again if it was.
# WHY says what was not.
WHY=""
watch_health() {
  local want="$1" need_links="$2" deadline=$((SECONDS + WATCH_S)) body seen mark baseline="" good=0 linked=0
  [ "$need_links" -ge 1 ] 2>/dev/null || linked=1
  while :; do
    body="$(health_body)"
    seen="$(served_version "$body")"
    if case "$body" in *'"ok":true'*) true ;; *) false ;; esac && [ "$seen" = "$want" ]; then
      mark="$(container_mark)"
      [ -n "$baseline" ] || baseline="$mark"
      if [ "$mark" != "$baseline" ]; then WHY="the relay restarted during the watch ($baseline, then $mark)"; return 1; fi
      [ "$(links_up "$body")" -ge 1 ] 2>/dev/null && linked=1
      good=1
    elif [ -z "$body" ]; then
      good=0; WHY="the relay did not answer $HEALTH_URL"
    else
      good=0; WHY="the relay serves version ${seen:-unknown}, not $want"
    fi
    [ "$SECONDS" -ge "$deadline" ] && break
    sleep "$POLL_S"
  done
  [ "$good" -eq 1 ] || return 1
  [ "$linked" -eq 1 ] || { WHY="the relay had $need_links family link(s) before and none came back"; return 1; }
  return 0
}

# The old tree, back where it was, and the stack up again by its own script.
KEEP="$WORK/previous"
put_back() {
  local dir file
  say "↩ Putting ${installed:-the previous version} back"
  for dir in $DIRS; do
    if [ -d "$KEEP/$dir" ]; then
      rm -rf "${ROOT:?}/$dir" && cp -a "$KEEP/$dir" "$ROOT/$dir" || return 1
    else
      rm -rf "${ROOT:?}/$dir"
    fi
  done
  for file in $FILES; do
    if [ -f "$KEEP/$file" ]; then cp -p "$KEEP/$file" "$ROOT/$file" || return 1; else rm -f "$ROOT/$file"; fi
  done
  bash scripts/sync-to-server.sh --skip-bump --prebuilt || return 1
  [ -z "$installed" ] || watch_health "$installed" 0 || return 1
  return 0
}

# From here on the tree may be changing: a failure goes back.
failed() {
  printf '✗ %s\n' "$*" >&2
  if [ "${UPDATE_AUTO_REVERT:-1}" = "0" ]; then
    printf '✗ UPDATE_AUTO_REVERT=0: left as it is\n' >&2
    exit 1
  fi
  if put_back; then
    say "↩ Back on ${installed:-the previous version}; $version was not kept"
    exit 3
  fi
  printf '✗ putting the previous version back failed too%s; the server needs a hand (bash scripts/server-backup.sh --list)\n' "${WHY:+: $WHY}" >&2
  exit 4
}

# What the relay was before: how many family links it had.
links_before="$(links_up "$(health_body)")"

# ---- 2. the way back -----------------------------------------------------------
# Of this install, wherever it is (the script's default is ~/work/pkg).
POORIJA_SOURCE_DIR="$ROOT" bash scripts/server-backup.sh "before updating to $version" || die "the snapshot failed, so nothing was changed"

# ---- 3. the images -----------------------------------------------------------------
docker load -i "$WORK/images.tar.gz" || die "the images would not load; the tree was not changed"

# ---- 4. the tree, as a deploy copies it -----------------------------------------------
# The old one first, a real copy (what rsync or a script might rewrite in
# place must not change it): a few tens of megabytes, gone with the work.
mkdir -p "$KEEP"
for dir in $DIRS; do
  [ -d "$ROOT/$dir" ] && { cp -a "$ROOT/$dir" "$KEEP/$dir" || die "could not keep a copy of $dir; the tree was not changed"; }
done
for file in $FILES; do
  [ -f "$ROOT/$file" ] && { cp -p "$ROOT/$file" "$KEEP/$file" || die "could not keep a copy of $file; the tree was not changed"; }
done
set +e
for dir in $DIRS; do
  [ -d "$WORK/src/$dir" ] || continue
  mkdir -p "$ROOT/$dir" || failed "could not create $dir"
  if command -v rsync >/dev/null 2>&1; then
    # By content: a file of the same size and time as the old one (tar keeps
    # the package's times) was skipped by rsync's quick check, old bytes and all.
    rsync -a --delete --checksum "$WORK/src/$dir/" "$ROOT/$dir/" || failed "copying $dir failed"
  else
    { rm -rf "${ROOT:?}/$dir" && cp -a "$WORK/src/$dir" "$ROOT/$dir"; } || failed "copying $dir failed"
  fi
done
for file in $FILES; do
  if [ -f "$WORK/src/$file" ]; then cp "$WORK/src/$file" "$ROOT/$file" || failed "copying $file failed"; fi
done

# ---- 5. the stack, by the new tree's own script -------------------------------------
bash scripts/sync-to-server.sh --skip-bump --prebuilt || failed "the new tree's sync-to-server.sh failed"

# ---- 6. the watch -------------------------------------------------------------------
say "▶ Watching the relay for ${WATCH_S}s"
watch_health "$version" "${links_before:-0}" || failed "$WHY"
say "✓ Updated to $version"
exit 0
}
