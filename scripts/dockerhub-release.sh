#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.
# ---------------------------------------------------------------------------
# Builds the four images published on Docker Hub, and refuses to publish one
# that carries a private string (docs/DOCKER.md):
#
#   poorija/p00rija-panel         config/Dockerfile.control-panel
#   poorija/p00rija-app           config/Dockerfile
#   poorija/p00rija-relay         config/Dockerfile.chat-signal
#   poorija/p00rija-cert-renewer  config/Dockerfile.cert-renewer
#
# each tagged with the version in package.json and with latest.
#
#   bash scripts/dockerhub-release.sh            build for this machine into the local engine
#   bash scripts/dockerhub-release.sh --push     build linux/amd64 + linux/arm64 and push
#                                                 (after `docker login`)
#   bash scripts/dockerhub-release.sh --scan-only IMAGE...   only the leak check
#
# The leak check reads every layer of every image — `docker push` sends them
# all, so a file written in one layer and deleted in the next still ships —
# and looks for the strings that must never leave this machine. They come from
# files that are never committed: every host, IP and user in
# ~/.config/p00rija-cryptography/deploy.conf, and the first column of
# tools/private-strings.txt (POORIJA_PRIVATE_STRINGS points elsewhere). Any hit
# stops the run before anything is pushed and names the file it was found in.
#
# Options:
#   --load | --push         local build (default) or publish
#   --prefix P              repository prefix (default poorija/)
#   --only a,b              some of: panel,app,relay,cert-renewer
#   --scan-only IMAGE...    check these images (or OCI tars) and stop
#   --private-file FILE     more strings to look for, one per line
# ---------------------------------------------------------------------------
set -euo pipefail
# Bash reads a script as it runs it, and builds take long enough for the file
# to change under it. So all of it is one block, read whole before anything runs.
{

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
say()  { printf '%s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }
usage() { sed -n '/^# Builds the four images/,/^# ------/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//; /^-----/d'; }

MODE=load PREFIX=poorija/ ONLY="panel,app,relay,cert-renewer"
SCAN_ONLY=() EXTRA_FILES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --load) MODE=load ;;
    --push) MODE=push ;;
    --prefix) PREFIX="${2:?--prefix needs a value}"; shift ;;
    --only) ONLY="${2:?--only needs a list}"; shift ;;
    --private-file) EXTRA_FILES+=("${2:?--private-file needs a file}"); shift ;;
    --scan-only) MODE=scan; shift; while [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; do SCAN_ONLY+=("$1"); shift; done; continue ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/p00rija-release.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ---- the strings that must not ship ---------------------------------------------------
PATTERNS="$WORK/patterns.txt"
: > "$PATTERNS"
DEPLOY_CONF="$HOME/.config/p00rija-cryptography/deploy.conf"
if [ -f "$DEPLOY_CONF" ]; then
  sed -n -E "s/^[A-Z0-9_]*_(SSH_HOST|PUBLIC_URL|INSIDE|SSH_USER)=['\"]?([^'\"]*)['\"]?.*/\2/p" "$DEPLOY_CONF" \
    | tr ',' '\n' | sed -E 's#^[a-z]+://##; s#[:/].*$##' | grep . | sort -u > "$WORK/hosts.txt" || true
  cat "$WORK/hosts.txt" >> "$PATTERNS"
  # And what those names resolve to: a published IP is as identifying as a name.
  while read -r host; do
    printf '%s' "$host" | grep -Eq '^[0-9.]+$' && continue
    if command -v dig >/dev/null 2>&1; then dig +short +time=2 +tries=1 "$host" A 2>/dev/null | grep -E '^[0-9.]+$' || true; fi
  done < "$WORK/hosts.txt" >> "$PATTERNS"
fi
PRIVATE_STRINGS="${POORIJA_PRIVATE_STRINGS:-$ROOT/tools/private-strings.txt}"
for file in "$PRIVATE_STRINGS" ${EXTRA_FILES[@]+"${EXTRA_FILES[@]}"}; do
  [ -f "$file" ] || continue
  # One string per line; anything after a tab is the export's replacement.
  sed -e 's/\t.*$//' -e '/^#/d' "$file" >> "$PATTERNS"
done
# Short or empty lines would match half of any filesystem.
awk 'length($0) >= 4' "$PATTERNS" | sort -u > "$PATTERNS.clean"; mv "$PATTERNS.clean" "$PATTERNS"

# scan IMAGE-or-TAR: 0 clean, 3 leak (each hit printed as "LEAK: <image> <path>")
scan() {
  local target="$1" dir="$WORK/scan" tarfile hits status=0
  if [ ! -s "$PATTERNS" ]; then
    warn "the leak check had nothing to look for (no deploy.conf and no private strings here): $target not checked"
    return 0
  fi
  rm -rf "$dir"; mkdir -p "$dir/outer" "$dir/layers"
  if [ -f "$target" ]; then tarfile="$target"
  else tarfile="$dir/image.tar"; docker save "$target" -o "$tarfile" || die "could not save $target"; fi
  tar -xf "$tarfile" -C "$dir/outer"
  # Every layer: legacy */layer.tar or OCI blobs, gzip or not. A file that is
  # not a tar (a config, a manifest) is searched as it is.
  local n=0 blob
  while IFS= read -r blob; do
    n=$((n + 1)); mkdir -p "$dir/layers/$n"
    # A non-tar blob is the image config (it holds the build history, every
    # RUN line included) or a manifest: searched as it is, named by its digest.
    tar -xf "$blob" -C "$dir/layers/$n" 2>/dev/null || cp "$blob" "$dir/layers/$n/config-$(basename "$blob" | cut -c1-12).json"
  done < <(find "$dir/outer" -type f \( -name 'layer.tar' -o -path '*/blobs/*' \))
  hits="$(grep -rlF -f "$PATTERNS" "$dir/layers" 2>/dev/null | sed "s#^$dir/layers/[0-9]*/##" | sort -u || true)"
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits" | while IFS= read -r file; do printf 'LEAK: %s %s\n' "$target" "$file"; done
    status=3
  else
    say "✓ $target: no private string in its $n layers, config and manifests"
  fi
  rm -rf "$dir"
  return $status
}

if [ "$MODE" = scan ]; then
  [ ${#SCAN_ONLY[@]} -gt 0 ] || die "--scan-only needs at least one image"
  rc=0
  for image in "${SCAN_ONLY[@]}"; do scan "$image" || rc=$?; done
  exit $rc
fi

# ---- building -------------------------------------------------------------------------
VERSION="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
[ -n "$VERSION" ] || die "no version in package.json"
dockerfile_of() {
  case "$1" in
    panel) echo config/Dockerfile.control-panel ;;
    app) echo config/Dockerfile ;;
    relay) echo config/Dockerfile.chat-signal ;;
    cert-renewer) echo config/Dockerfile.cert-renewer ;;
    *) die "unknown image: $1 (panel, app, relay or cert-renewer)" ;;
  esac
}
native="linux/$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')"
BUILDER=p00rija-multi
if [ "$MODE" = push ]; then
  # A multi-platform image needs a docker-container builder; made once, kept.
  docker buildx inspect "$BUILDER" >/dev/null 2>&1 || docker buildx create --name "$BUILDER" --driver docker-container >/dev/null
fi

IFS=',' read -r -a NAMES <<< "$ONLY"
for name in "${NAMES[@]}"; do
  file="$(dockerfile_of "$name")"
  repo="${PREFIX}p00rija-$name"
  tags=(-t "$repo:$VERSION" -t "$repo:latest")
  if [ "$MODE" = load ]; then
    say "▶ $repo:$VERSION ($native)"
    docker buildx build --load --platform "$native" --provenance=false --sbom=false -f "$ROOT/$file" "${tags[@]}" "$ROOT"
    scan "$repo:$VERSION" || die "$repo carries a private string (above); nothing was published"
  else
    say "▶ $repo:$VERSION (linux/amd64, linux/arm64)"
    # Exactly what will be pushed, both platforms, checked first; the push
    # that follows is the same build from the same builder's cache.
    docker buildx build --builder "$BUILDER" --platform linux/amd64,linux/arm64 --provenance=false --sbom=false \
      -f "$ROOT/$file" --output "type=oci,dest=$WORK/$name.tar" "$ROOT"
    scan "$WORK/$name.tar" || die "$repo carries a private string (above); nothing was pushed"
    rm -f "$WORK/$name.tar"
    docker buildx build --builder "$BUILDER" --platform linux/amd64,linux/arm64 --provenance=false --sbom=false \
      -f "$ROOT/$file" "${tags[@]}" --push "$ROOT"
    say "✓ pushed $repo:$VERSION and :latest"
  fi
done

say ""
if [ "$MODE" = load ]; then
  say "Built locally. To publish:  docker login  &&  bash scripts/dockerhub-release.sh --push"
fi
say "The Docker Hub page text (paste into each repository's description): docker/README.dockerhub.md"
exit
}
