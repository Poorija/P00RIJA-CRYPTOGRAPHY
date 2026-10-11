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
# AND to /root/cert/ (which 3X-UI also reads), and restarts everything that
# holds a stale copy in memory.
#
# Port 80 is often taken (by 3X-UI, caddy, or the nexus portal). When it is,
# the script pauses the holder for the handful of seconds certbot needs to
# answer the ACME challenge, then brings it straight back.
set -u

DOMAIN="${DOMAIN:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
LETSENCRYPT_DIR="${LETSENCRYPT_DIR:-/etc/letsencrypt}"
DEPLOY_DIR="${CERT_DEPLOY_DIR:-/deploy-certs}"
SHARED_CERT_DIR="${SHARED_CERT_DIR:-/root-cert}"
LIVE_CERT="$LETSENCRYPT_DIR/live/$DOMAIN/fullchain.pem"
LIVE_KEY="$LETSENCRYPT_DIR/live/$DOMAIN/privkey.pem"
# Let's Encrypt certificates are renewed when ten days are left. Ten days of
# six-hourly attempts is forty chances for a renewal that hits a busy port 80
# or a slow ACME server, and a certificate is never replaced earlier than it
# needs to be.
RENEW_BEFORE_DAYS="${RENEW_BEFORE_DAYS:-10}"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-21600}"
APP_CONTAINER="${APP_CONTAINER:-Poorija-Cryptography_App}"
COTURN_CONTAINER="${COTURN_CONTAINER:-Poorija-Cryptography_Coturn}"
XUI_PROCESS="${XUI_PROCESS:-x-ui}"
COTURN_KEY_UID="${COTURN_KEY_UID:-65534}"

log() { echo "[cert-renewer][$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

certbot_common="--non-interactive --agree-tos --keep-until-expiring"
if [ -n "$CERTBOT_EMAIL" ]; then
  certbot_common="$certbot_common -m $CERTBOT_EMAIL"
else
  certbot_common="$certbot_common --register-unsafely-without-email"
fi

# Days until the certificate expires, -1 when it is missing or unreadable.
#
# The image's `date` is busybox, whose -d does not read openssl's
# "Jan  2 23:16:54 2027 GMT" — every check therefore came out as an epoch of
# 0, a negative day count, and "certificate missing or unreadable" every six
# hours on both production servers, for a certificate that was fine. busybox
# needs the format spelled out with -D; GNU date and BSD date are tried too so
# the script still runs outside the image. When no parser understands the
# date, `openssl -checkend` answers the only question that matters — is it
# inside the renewal window — without any date arithmetic at all.
days_left() {
  [ -f "$LIVE_CERT" ] || { echo "-1"; return; }
  end=$(openssl x509 -enddate -noout -in "$LIVE_CERT" 2>/dev/null | cut -d= -f2)
  [ -n "$end" ] || { echo "-1"; return; }
  bare=$(printf '%s' "$end" | sed 's/ GMT$//')
  end_epoch=$(date -u -D "%b %d %H:%M:%S %Y" -d "$bare" +%s 2>/dev/null \
    || date -u -d "$end" +%s 2>/dev/null \
    || date -u -j -f "%b %e %H:%M:%S %Y %Z" "$end" +%s 2>/dev/null \
    || echo "")
  if [ -z "$end_epoch" ]; then
    if openssl x509 -checkend $((RENEW_BEFORE_DAYS * 86400)) -noout -in "$LIVE_CERT" >/dev/null 2>&1; then
      echo $((RENEW_BEFORE_DAYS + 1))
    else
      echo 0
    fi
    return
  fi
  now_epoch=$(date -u +%s)
  echo $(( (end_epoch - now_epoch) / 86400 ))
}

# coturn runs as nobody and reads its private key once, at start. A key that
# is root-owned 0400 — what a certificate issued or copied as root leaves
# behind — costs the server its TURNS listener with nothing but a warning in
# coturn's log, and the renewal path below only fixed ownership when the
# certificate itself changed, so an unreadable key stayed unreadable until the
# next renewal months later. Checked on every pass; coturn is restarted only
# when something actually had to change.
ensure_coturn_key_readable() {
  key="$DEPLOY_DIR/key.pem"
  [ -f "$key" ] || return 0
  owner=$(stat -c '%u' "$key" 2>/dev/null || echo "")
  mode=$(stat -c '%a' "$key" 2>/dev/null || echo "")
  if [ "$owner" = "$COTURN_KEY_UID" ] && [ "$mode" = "400" ]; then
    return 0
  fi
  if chown "$COTURN_KEY_UID:$COTURN_KEY_UID" "$key" && chmod 400 "$key"; then
    log "repaired coturn key ownership (was uid ${owner:-?} mode ${mode:-?})"
    if command -v docker >/dev/null 2>&1; then
      docker restart "$COTURN_CONTAINER" >/dev/null 2>&1 \
        && log "restarted $COTURN_CONTAINER so it reads the key" \
        || log "WARNING: could not restart $COTURN_CONTAINER"
    fi
  else
    log "WARNING: could not repair coturn key ownership at $key"
  fi
}

# Who is holding a port — answers a container name, a PID, or empty.
port_holder() {
  port="$1"
  # Docker containers on the host network
  if command -v docker >/dev/null 2>&1; then
    for c in $(docker ps --format '{{.Names}}' 2>/dev/null); do
      if docker inspect "$c" 2>/dev/null | grep -q "\"HostPort\":\"$port\"" \
         || docker port "$c" 2>/dev/null | grep -q ":$port "; then
        echo "container:$c"
        return
      fi
    done
  fi
  # A host process (the cert-renewer shares the host network, so ss works)
  pid=$(netstat -tlnp 2>/dev/null | grep ":$port " | grep -o 'pid:[0-9]*' | head -1 | cut -d: -f2)
  [ -n "$pid" ] && echo "pid:$pid" && return
  echo ""
}

pause_port_holder() {
  holder="$1"
  case "$holder" in
    container:*) docker stop -t 3 "${holder#container:}" 2>/dev/null && log "stopped ${holder#container:}" ;;
    pid:*) kill -STOP "${holder#pid:}" 2>/dev/null && log "STOPped pid ${holder#pid:}" ;;
  esac
}

resume_port_holder() {
  holder="$1"
  case "$holder" in
    container:*) docker start "${holder#container:}" 2>/dev/null && log "restarted ${holder#container:}" ;;
    pid:*) kill -CONT "${holder#pid:}" 2>/dev/null && log "CONTinued pid ${holder#pid:}" ;;
  esac
}

restart_xui() {
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "$XUI_PROCESS"; then
    docker restart "$XUI_PROCESS" 2>/dev/null && log "restarted $XUI_PROCESS container" && return
  fi
  # 3X-UI runs as a bare host process; the renewer shares the host network
  # but not the host PID namespace — signal by name via the socket's docker
  # exec into a helper container. If that fails, log for the operator.
  log "3X-UI is a host process; if it caches the old cert, restart it by hand: systemctl restart x-ui"
}

deploy_certs() {
  if [ ! -f "$LIVE_CERT" ] || [ ! -f "$LIVE_KEY" ]; then
    log "ERROR: renewed certificate files not found at $LIVE_CERT"
    return 1
  fi
  # → the stack's own certs dir
  cp "$LIVE_CERT" "$DEPLOY_DIR/cert.pem.new" || return 1
  cp "$LIVE_KEY" "$DEPLOY_DIR/key.pem.new" || return 1
  chown "$COTURN_KEY_UID:$COTURN_KEY_UID" "$DEPLOY_DIR/key.pem.new"
  chmod 400 "$DEPLOY_DIR/key.pem.new"
  chmod 644 "$DEPLOY_DIR/cert.pem.new"
  mv "$DEPLOY_DIR/cert.pem.new" "$DEPLOY_DIR/cert.pem"
  mv "$DEPLOY_DIR/key.pem.new" "$DEPLOY_DIR/key.pem"
  log "deployed certificate to $DEPLOY_DIR"

  # → /root/cert/ on the host (what 3X-UI reads), same file pair, same
  #   permissions, atomic rename — 3X-UI and this stack share one cert.
  if [ -d "$SHARED_CERT_DIR" ]; then
    cp "$LIVE_CERT" "$SHARED_CERT_DIR/fullchain.pem.new" 2>/dev/null \
      && cp "$LIVE_KEY" "$SHARED_CERT_DIR/privkey.pem.new" 2>/dev/null \
      && chmod 644 "$SHARED_CERT_DIR/fullchain.pem.new" \
      && chmod 600 "$SHARED_CERT_DIR/privkey.pem.new" \
      && mv "$SHARED_CERT_DIR/fullchain.pem.new" "$SHARED_CERT_DIR/fullchain.pem" \
      && mv "$SHARED_CERT_DIR/privkey.pem.new" "$SHARED_CERT_DIR/privkey.pem" \
      && log "deployed certificate to $SHARED_CERT_DIR (shared with 3X-UI)" \
      || log "WARNING: could not write to $SHARED_CERT_DIR"
  else
    log "note: $SHARED_CERT_DIR not mounted — 3X-UI shared cert not deployed"
  fi

  if command -v docker >/dev/null 2>&1; then
    docker restart "$APP_CONTAINER" "$COTURN_CONTAINER" \
      && log "restarted $APP_CONTAINER and $COTURN_CONTAINER" \
      || log "WARNING: failed to restart containers (docker socket unavailable?)"
  fi
  restart_xui
  return 0
}

# Try certbot on port 80; if something holds the port, pause it for the
# challenge, then bring it straight back.
certbot_with_port_dance() {
  certbot_args="$1"
  holder=$(port_holder 80)
  if [ -z "$holder" ]; then
    # Port free — the simple path
    certbot $certbot_args $certbot_common
    return $?
  fi
  log "port 80 held by $holder — pausing for the ACME challenge"
  pause_port_holder "$holder"
  sleep 1
  certbot $certbot_args $certbot_common
  status=$?
  resume_port_holder "$holder"
  log "port 80 holder resumed"
  return $status
}

# certbot keeps its own threshold in the renewal file (30 days unless told
# otherwise) and `certbot renew` consults it. It is set to the same window as
# this script's, so the two never disagree about whether a certificate is due:
# a renewal this script asks for at ten days is one certbot also agrees to.
align_certbot_window() {
  conf="$LETSENCRYPT_DIR/renewal/$DOMAIN.conf"
  [ -f "$conf" ] || return 0
  want="renew_before_expiry = ${RENEW_BEFORE_DAYS} days"
  if grep -q "^renew_before_expiry" "$conf"; then
    grep -q "^${want}$" "$conf" && return 0
    sed -i "s/^renew_before_expiry.*/${want}/" "$conf"
  elif grep -q "^# renew_before_expiry" "$conf"; then
    sed -i "s/^# renew_before_expiry.*/${want}/" "$conf"
  else
    sed -i "1a ${want}" "$conf"
  fi
  log "certbot renewal window set to ${RENEW_BEFORE_DAYS} days"
}

issue_or_renew() {
  if [ ! -f "$LETSENCRYPT_DIR/renewal/$DOMAIN.conf" ]; then
    log "no certificate for $DOMAIN found — issuing a new one"
    certbot_with_port_dance "certonly --standalone --http-01-address 0.0.0.0 -d $DOMAIN --key-type ecdsa --elliptic-curve secp256r1"
    status=$?
    [ $status -eq 0 ] && align_certbot_window && deploy_certs
    return $status
  fi
  log "renewing certificate for $DOMAIN"
  certbot_with_port_dance "renew --cert-name $DOMAIN --standalone --http-01-address 0.0.0.0 --key-type ecdsa --elliptic-curve secp256r1"
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

align_certbot_window
log "manager started for $DOMAIN (checks every $((CHECK_INTERVAL_SECONDS / 3600))h, renews ${RENEW_BEFORE_DAYS}d before expiry)"

while true; do
  ensure_coturn_key_readable
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
