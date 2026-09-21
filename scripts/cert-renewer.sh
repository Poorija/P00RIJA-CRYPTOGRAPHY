#!/bin/sh
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# P00RIJA Cryptography — automatic TLS certificate manager.
# Runs inside the cert-renewer container: issues the certificate on first boot
# (when absent), renews it before expiry, deploys it to the shared certs dir
# with the permissions coturn needs, and restarts the App/Coturn containers.
set -u

DOMAIN="${DOMAIN:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
LETSENCRYPT_DIR="${LETSENCRYPT_DIR:-/etc/letsencrypt}"
DEPLOY_DIR="${CERT_DEPLOY_DIR:-/deploy-certs}"
LIVE_CERT="$LETSENCRYPT_DIR/live/$DOMAIN/fullchain.pem"
LIVE_KEY="$LETSENCRYPT_DIR/live/$DOMAIN/privkey.pem"
RENEW_BEFORE_DAYS="${RENEW_BEFORE_DAYS:-30}"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-21600}" # every 6 hours
APP_CONTAINER="${APP_CONTAINER:-Poorija-Cryptography_App}"
COTURN_CONTAINER="${COTURN_CONTAINER:-Poorija-Cryptography_Coturn}"
COTURN_KEY_UID="${COTURN_KEY_UID:-65534}"

log() { echo "[cert-renewer][$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

certbot_common="--non-interactive --agree-tos --keep-until-expiring"
if [ -n "$CERTBOT_EMAIL" ]; then
  certbot_common="$certbot_common -m $CERTBOT_EMAIL"
else
  certbot_common="$certbot_common --register-unsafely-without-email"
fi

days_left() {
  [ -f "$LIVE_CERT" ] || { echo "-1"; return; }
  end=$(openssl x509 -enddate -noout -in "$LIVE_CERT" 2>/dev/null | cut -d= -f2)
  [ -n "$end" ] || { echo "-1"; return; }
  end_epoch=$(date -u -d "$end" +%s 2>/dev/null || date -u -j -f "%b %e %H:%M:%S %Y %Z" "$end" +%s 2>/dev/null || echo 0)
  now_epoch=$(date -u +%s)
  echo $(( (end_epoch - now_epoch) / 86400 ))
}

deploy_certs() {
  if [ ! -f "$LIVE_CERT" ] || [ ! -f "$LIVE_KEY" ]; then
    log "ERROR: renewed certificate files not found at $LIVE_CERT"
    return 1
  fi
  cp "$LIVE_CERT" "$DEPLOY_DIR/cert.pem.new" || return 1
  cp "$LIVE_KEY" "$DEPLOY_DIR/key.pem.new" || return 1
  # coturn runs as nobody:nogroup and cannot read root-owned 600 keys
  chown "$COTURN_KEY_UID:$COTURN_KEY_UID" "$DEPLOY_DIR/key.pem.new"
  chmod 400 "$DEPLOY_DIR/key.pem.new"
  chmod 644 "$DEPLOY_DIR/cert.pem.new"
  mv "$DEPLOY_DIR/cert.pem.new" "$DEPLOY_DIR/cert.pem"
  mv "$DEPLOY_DIR/key.pem.new" "$DEPLOY_DIR/key.pem"
  log "deployed certificate to $DEPLOY_DIR"
  if command -v docker >/dev/null 2>&1; then
    docker restart "$APP_CONTAINER" "$COTURN_CONTAINER" \
      && log "restarted $APP_CONTAINER and $COTURN_CONTAINER" \
      || log "WARNING: failed to restart containers (docker socket unavailable?)"
  else
    log "WARNING: docker CLI unavailable; restart App/Coturn manually"
  fi
  return 0
}

issue_or_renew() {
  if [ ! -f "$LETSENCRYPT_DIR/renewal/$DOMAIN.conf" ]; then
    log "no certificate for $DOMAIN found — issuing a new one (HTTP-01 on port 80)"
    certbot certonly --standalone --http-01-address 0.0.0.0 \
      -d "$DOMAIN" --key-type ecdsa --elliptic-curve secp256r1 \
      $certbot_common && deploy_certs
    return $?
  fi
  log "renewing certificate for $DOMAIN (standalone HTTP-01)"
  certbot renew --standalone --http-01-address 0.0.0.0 \
    --key-type ecdsa --elliptic-curve secp256r1 \
    $certbot_common
  status=$?
  if [ "$status" -ne 0 ]; then
    log "ERROR: certbot renew exited with $status"
    return "$status"
  fi
  before_hash="${issue_or_renew_before:-}"
  after_hash=$(md5sum "$LIVE_CERT" 2>/dev/null | cut -d' ' -f1)
  if [ -n "$before_hash" ] && [ "$before_hash" = "$after_hash" ]; then
    log "certificate unchanged — nothing to deploy"
    return 0
  fi
  deploy_certs
}

if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "localhost" ]; then
  log "FATAL: DOMAIN is not configured; set DOMAIN in .env"
  exit 1
fi

log "manager started for $DOMAIN (checks every $((CHECK_INTERVAL_SECONDS / 3600))h, renews ${RENEW_BEFORE_DAYS}d before expiry)"

while true; do
  remaining=$(days_left)
  issue_or_renew_before=$(md5sum "$LIVE_CERT" 2>/dev/null | cut -d' ' -f1)
  if [ "$remaining" -lt 0 ]; then
    log "certificate missing or unreadable"
    issue_or_renew || true
  elif [ "$remaining" -le "$RENEW_BEFORE_DAYS" ]; then
    log "certificate expires in ${remaining}d (<= ${RENEW_BEFORE_DAYS}d threshold)"
    issue_or_renew || true
  else
    log "certificate healthy — ${remaining}d remaining"
  fi
  sleep "$CHECK_INTERVAL_SECONDS"
done
