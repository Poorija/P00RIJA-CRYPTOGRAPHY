#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.
# ---------------------------------------------------------------------------
# Builds and packs this folder for the servers, inside this folder: run it in
# a checkout, or let the central panel run it (Build & package), and
# everything lands in dist/server/<version>/ of the same checkout.
#
#   bash scripts/build-server-package.sh                 the archive and the server images
#   bash scripts/build-server-package.sh --all           and the Docker Hub images too
#   bash scripts/build-server-package.sh --scan          only check the folder and say what it is
#
# What it makes (each one chosen with its option; none given means
# --archive --images):
#
#   --archive    p00rija-server-<version>.tar.gz
#                the part of the tree a server runs (what deploy.sh copies)
#   --images     p00rija-images-<version>-<arch>.tar.gz
#                the three images a deploy.sh server runs (poorija-crypto,
#                poorija-chat-signal, poorija-cert-renewer), for --platform;
#                `docker load` on a server takes them without any registry
#   --dockerhub  p00rija-dockerhub-<version>-<arch>.tar.gz
#                the images published on Docker Hub (poorija/p00rija-app,
#                -relay, -cert-renewer, -panel), built with the leak check of
#                scripts/dockerhub-release.sh; a server installed with
#                docker-install.sh loads them and runs without pulling
#   --push       publishes the Docker Hub images (both platforms) after
#                `docker login`, through scripts/dockerhub-release.sh --push
#   --all        --archive --images --dockerhub
#
# Every file gets its line in SHA256SUMS and the whole run in build.json.
#
# Options:
#   --out DIR          another folder (default: dist/server/<version>)
#   --platform P       linux/amd64 (default; what the servers are) or linux/arm64
#   --scan             only the check; prints key=value lines
# ---------------------------------------------------------------------------
set -euo pipefail
{

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
say()  { printf '%s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

OUT="" PLATFORM=linux/amd64 SCAN=0 ARCHIVE=0 IMAGES=0 HUB=0 PUSH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:?--out needs a folder}"; shift ;;
    --platform) PLATFORM="${2:?--platform needs a value}"; shift ;;
    --archive) ARCHIVE=1 ;;
    --images) IMAGES=1 ;;
    --dockerhub) HUB=1 ;;
    --push) PUSH=1 ;;
    --all) ARCHIVE=1 IMAGES=1 HUB=1 ;;
    --scan) SCAN=1 ;;
    -h|--help) sed -n '/^# Builds and packs/,/^# ------/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//; /^-----/d'; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done
[ "$ARCHIVE$IMAGES$HUB$PUSH" = 0000 ] && ARCHIVE=1 IMAGES=1
case "$PLATFORM" in linux/amd64|linux/arm64) ;; *) die "--platform is linux/amd64 or linux/arm64" ;; esac
ARCH="${PLATFORM#linux/}"

# ---- what this folder is ------------------------------------------------------------
[ -f "$ROOT/package.json" ] && [ -f "$ROOT/config/Dockerfile.chat-signal" ] && [ -f "$ROOT/scripts/server.js" ] \
  || die "$ROOT is not a P00RIJA checkout (package.json, config/Dockerfile.chat-signal and scripts/server.js)"
field() { sed -n "s/^[[:space:]]*\"$1\":[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$ROOT/package.json" | head -1; }
VERSION="$(field version)"
BUILD_TAG="$(field buildTag)"; BUILD_TAG="${BUILD_TAG:-$VERSION}"
printf '%s' "$VERSION" | grep -Eq '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$' || die "package.json names no version"
SYNC_DIRS=(js css assets fonts vendor scripts config docker)
SYNC_FILES=(index.html sw.js manifest.webmanifest monitor-client.html package.json LICENSE)
COMMIT="" DIRTY=""
if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || true)"
  [ -z "$(git -C "$ROOT" status --porcelain 2>/dev/null | grep -v '^??' || true)" ] && DIRTY=0 || DIRTY=1
fi
OUT="${OUT:-$ROOT/dist/server/$VERSION}"

if [ "$SCAN" = 1 ]; then
  say "tree=1"
  say "version=$VERSION"
  say "buildTag=$BUILD_TAG"
  say "commit=$COMMIT"
  say "dirty=$DIRTY"
  for dir in "${SYNC_DIRS[@]}"; do
    [ -d "$ROOT/$dir" ] && say "files.$dir=$(find "$ROOT/$dir" -type f -not -path '*/node_modules/*' | wc -l | tr -d ' ')"
  done
  say "docker=$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
  say "out=$OUT"
  exit 0
fi

mkdir -p "$OUT"
say "▶ P00RIJA $VERSION ($BUILD_TAG${COMMIT:+, commit $COMMIT}${DIRTY:+$( [ "$DIRTY" = 1 ] && printf ', with uncommitted changes')}) into $OUT"
MADE=()

# ---- the archive -----------------------------------------------------------------
if [ "$ARCHIVE" = 1 ]; then
  parts=()
  for entry in "${SYNC_DIRS[@]}" "${SYNC_FILES[@]}"; do [ -e "$ROOT/$entry" ] && parts+=("$entry"); done
  file="p00rija-server-$VERSION.tar.gz"
  say "▶ $file"
  COPYFILE_DISABLE=1 tar czf "$OUT/$file.part" --exclude=node_modules --exclude=.DS_Store --exclude='*.log' -C "$ROOT" "${parts[@]}"
  mv "$OUT/$file.part" "$OUT/$file"
  MADE+=("$file")
fi

# ---- images ----------------------------------------------------------------------
need_docker() { docker info >/dev/null 2>&1 || die "Docker does not answer here (in the panel: start it with bash scripts/panel.sh update --builds yes)"; }
save_images() { # save_images FILE IMAGE...
  local file="$1"; shift
  say "▶ $file"
  docker save "$@" | gzip -1 > "$OUT/$file.part"
  mv "$OUT/$file.part" "$OUT/$file"
  MADE+=("$file")
}
if [ "$IMAGES" = 1 ]; then
  need_docker
  images=()
  for pair in "poorija-crypto:config/Dockerfile" "poorija-chat-signal:config/Dockerfile.chat-signal" "poorija-cert-renewer:config/Dockerfile.cert-renewer"; do
    name="${pair%%:*}" dockerfile="${pair#*:}"
    say "▶ $name:$VERSION ($PLATFORM)"
    docker buildx build --platform "$PLATFORM" --pull --provenance=false --sbom=false -f "$ROOT/$dockerfile" -t "$name:$VERSION" --load "$ROOT"
    images+=("$name:$VERSION")
  done
  save_images "p00rija-images-$VERSION-$ARCH.tar.gz" "${images[@]}"
fi
if [ "$HUB" = 1 ]; then
  need_docker
  bash "$ROOT/scripts/dockerhub-release.sh" --load --platform "$PLATFORM"
  save_images "p00rija-dockerhub-$VERSION-$ARCH.tar.gz" "poorija/p00rija-app:$VERSION" "poorija/p00rija-relay:$VERSION" "poorija/p00rija-cert-renewer:$VERSION" "poorija/p00rija-panel:$VERSION"
fi
if [ "$PUSH" = 1 ]; then
  need_docker
  docker info 2>/dev/null | grep -q '^ *Username:' || warn "this Docker is not logged in to Docker Hub; the push will be refused (docker login first)"
  bash "$ROOT/scripts/dockerhub-release.sh" --push
fi

# ---- sums and the record ---------------------------------------------------------
if [ ${#MADE[@]} -gt 0 ]; then
  ( cd "$OUT"
    : > SHA256SUMS.part
    for file in *.tar.gz *.tar; do
      [ -f "$file" ] || continue
      if command -v sha256sum >/dev/null 2>&1; then sha256sum "$file"; else shasum -a 256 "$file"; fi >> SHA256SUMS.part
    done
    mv SHA256SUMS.part SHA256SUMS )
fi
{
  printf '{\n  "version": "%s",\n  "buildTag": "%s",\n  "commit": "%s",\n  "dirty": %s,\n  "platform": "%s",\n  "createdAt": "%s",\n  "made": [' \
    "$VERSION" "$BUILD_TAG" "$COMMIT" "$(case "$DIRTY" in 1) echo true ;; 0) echo false ;; *) echo null ;; esac)" "$PLATFORM" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  first=1
  for file in ${MADE[@]+"${MADE[@]}"}; do [ $first = 1 ] || printf ','; first=0; printf '"%s"' "$file"; done
  printf ']\n}\n'
} > "$OUT/build.json"
for file in ${MADE[@]+"${MADE[@]}"}; do say "✓ $file ($(du -h "$OUT/$file" | cut -f1))"; done
say "✓ $OUT"
exit 0
}
