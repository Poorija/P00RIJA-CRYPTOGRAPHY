#!/bin/sh
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# The relay's other addresses (CHAT_MIRROR_ORIGINS) and the relays it fronts
# for (CHAT_FRONTS, below), written into the page's
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
# Front doors (CHAT_FRONTS on this relay, passed in as APP_FRONTS): each
# `<relay id>@<origin>` is a relay behind this one that answers at <origin>.
# The page served here must be allowed to reach that origin, and nginx must
# answer it: the n-th front listens on 8586+n with this server's certificate
# and hands everything to the relay's front port 9011+n
# (scripts/lib/relay-front.js). No fronts, no extra server.
index=0
for entry in $(printf '%s' "${APP_FRONTS:-}" | tr ',' ' '); do
  origin="${entry#*@}"
  case "$origin" in
    https://*) ;;
    *) continue ;;
  esac
  list="$list $origin wss://${origin#https://}"
  listen=$((8586 + index))
  upstream=$((9011 + index))
  index=$((index + 1))
  cat >> "$template" <<FRONT

map \$http_upgrade \$poorija_front_connection_$index {
    default upgrade;
    '' '';
}

server {
    listen $listen ssl;
    listen [::]:$listen ssl;
    server_name _;
    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSLFRONT$index:5m;
    ssl_session_tickets off;
    client_max_body_size 32m;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    location / {
        proxy_pass http://chat-signal:$upstream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$poorija_front_connection_$index;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header CF-Connecting-IP "";
        proxy_set_header True-Client-IP "";
        proxy_set_header X-Client-IP "";
        proxy_set_header Forwarded "";
        proxy_set_header X-Forwarded-Host \$http_host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
FRONT
done
# Only origin characters survive into the policy.
list=$(printf '%s' "$list" | tr -cd 'A-Za-z0-9.:/ -')
sed -i "s|__MIRROR_CONNECT__|${list}|" "$template"
