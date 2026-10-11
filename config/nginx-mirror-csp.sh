#!/bin/sh
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# The relay's other addresses (CHAT_MIRROR_ORIGINS), written into the page's
# connect-src before nginx renders its template. Without this an installed
# app served from the main domain could not open a socket to a mirror — the
# one moment a mirror exists for is the moment the main domain is blocked.
# Each https origin is listed with its wss twin, because connect-src has to
# name the socket too. Runs from /docker-entrypoint.d before the envsubst
# step (15 < 20), and replaces the placeholder with nothing when there are no
# mirrors.
#
# The shipped template is left exactly as COPY put it — the deploy compares
# its checksum with the repository's — and the edited copy goes to the
# directory the envsubst step is pointed at (NGINX_ENVSUBST_TEMPLATE_DIR).
set -eu
source=/etc/nginx/templates/default.conf.template
target_dir="${NGINX_ENVSUBST_TEMPLATE_DIR:-/etc/nginx/rendered-templates}"
[ -f "$source" ] || exit 0
mkdir -p "$target_dir"
template="$target_dir/default.conf.template"
cp "$source" "$template"
list=""
for origin in $(printf '%s' "${APP_MIRROR_ORIGINS:-}" | tr ',' ' '); do
  case "$origin" in
    https://*) list="$list $origin wss://${origin#https://}" ;;
    http://*) list="$list $origin ws://${origin#http://}" ;;
  esac
done
# Only origin characters survive into the policy.
list=$(printf '%s' "$list" | tr -cd 'A-Za-z0-9.:/ -')
sed -i "s|__MIRROR_CONNECT__|${list}|" "$template"
