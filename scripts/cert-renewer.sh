#!/bin/sh
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# P00RIJA Cryptography — the certificate keeper.
#
# One folder holds the certificate this server serves (CERTS_DIR on the host,
# /deploy-certs in here), and every part of the stack reads it in place:
# nginx, the TURN server, the relay's own status page. Another program on the
# same machine can share the folder — 3X-UI reads /root/cert/<domain>/ — so
# one certificate serves them all and a renewal is one event, not two that
# drift apart. How the folder is kept depends on CERT_MODE:
#
#   letsencrypt  this container issues the certificate — for a domain, or for
#                a public IP address on Let's Encrypt's short-lived profile —
#                renews it when RENEW_BEFORE_DAYS are left, writes it into the
#                folder and restarts whatever holds the old one in memory,
#                3X-UI included when it reads the same folder;
#   existing     the folder belongs to someone else, who renews it. This
#                container only watches it: it restarts the stack when the
#                files change and says so when the expiry comes near;
#   self-signed  for localhost, a LAN, or an address with no public name: a
#                certificate is made here for every address the machine has,
#                and made again before it runs out.
#
# Left empty, the mode follows DOMAIN: a name means letsencrypt; localhost or
# an address means self-signed — what this stack did before the mode existed.
#
# Port 80 is often taken (by 3X-UI, caddy, or the nexus portal). When it is,
# the script pauses the holder for the handful of seconds certbot needs to
# answer the ACME challenge, then brings it straight back.
#
#   cert-renewer.sh              the loop the container runs
#   cert-renewer.sh --once       one pass, as the loop would make it, then exit
#   cert-renewer.sh --renew-now  renew (or remake) now, whatever the date
#   cert-renewer.sh --status     what the folder holds, and whether it is sound
set -u

CERT_MODE="${CERT_MODE:-}"
DOMAIN="${DOMAIN:-}"
EXTERNAL_IP="${EXTERNAL_IP:-}"
# More names or addresses for a self-signed certificate, comma separated
# ("lan.example,192.168.1.20" or "DNS:x,IP:y").
CERT_SANS="${CERT_SANS:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
LETSENCRYPT_DIR="${LETSENCRYPT_DIR:-/etc/letsencrypt}"
DEPLOY_DIR="${CERT_DEPLOY_DIR:-/deploy-certs}"
# The names inside the folder. 3X-UI and certbot say fullchain.pem and
# privkey.pem; a folder this stack made on its own says cert.pem and key.pem.
CERT_FILE="${CERT_FILE:-cert.pem}"
KEY_FILE="${KEY_FILE:-key.pem}"
# The folder as the host names it — how 3X-UI's settings and acme.sh refer to
# it — and the two files nginx and coturn were actually handed.
CERTS_DIR_ON_HOST="${CERTS_DIR_ON_HOST:-}"
SSL_CERT_PATH_ON_HOST="${SSL_CERT_PATH_ON_HOST:-}"
SSL_KEY_PATH_ON_HOST="${SSL_KEY_PATH_ON_HOST:-}"
DEPLOY_CERT="$DEPLOY_DIR/$CERT_FILE"
DEPLOY_KEY="$DEPLOY_DIR/$KEY_FILE"
CERT_NAME="$DOMAIN"
LIVE_CERT="$LETSENCRYPT_DIR/live/$CERT_NAME/fullchain.pem"
LIVE_KEY="$LETSENCRYPT_DIR/live/$CERT_NAME/privkey.pem"
# Renewed when ten days are left. Ten days of six-hourly attempts is forty
# chances for a renewal that hits a busy port 80 or a slow ACME server, and a
# certificate is never replaced earlier than it needs to be.
RENEW_BEFORE_DAYS="${RENEW_BEFORE_DAYS:-10}"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-21600}"
APP_CONTAINER="${APP_CONTAINER:-Poorija-Cryptography_App}"
COTURN_CONTAINER="${COTURN_CONTAINER:-Poorija-Cryptography_Coturn}"
RENEWER_CONTAINER="${RENEWER_CONTAINER:-Poorija-Cryptography_CertRenewer}"
COTURN_KEY_UID="${COTURN_KEY_UID:-65534}"
# The fingerprint last seen in the folder. A file rather than a variable so
# `docker exec … --renew-now` and the loop agree on what they have seen.
SEEN_FILE="${SEEN_FILE:-/tmp/cert-renewer.seen}"
FORCE=0

log() { echo "[cert-renewer][$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

is_ip() {
  case "$1" in *:*) return 0 ;; esac
  printf '%s' "$1" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
}

# Let's Encrypt certifies only addresses the internet can reach it from.
is_private_ip() {
  case "$1" in
    127.*|10.*|192.168.*|169.254.*|0.*|::1|fe80:*|fc*|fd*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
    100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 0 ;;
  esac
  return 1
}

# ---- reading a certificate ------------------------------------------------

cert_end() { openssl x509 -enddate -noout -in "$1" 2>/dev/null | cut -d= -f2; }
cert_start() { openssl x509 -startdate -noout -in "$1" 2>/dev/null | cut -d= -f2; }

# Seconds since the epoch for an openssl date, "Jan  2 23:16:54 2027 GMT";
# empty when no date parser here understands it.
#
# The image's `date` is busybox, whose -d does not read openssl's format —
# every check once came out as an epoch of 0, a negative day count, and
# "certificate missing or unreadable" every six hours on both production
# servers, for a certificate that was fine. busybox needs the format spelled
# out with -D; GNU date and BSD date are tried too so the script still runs
# outside the image.
to_epoch() {
  [ -n "$1" ] || { echo ""; return; }
  bare=$(printf '%s' "$1" | sed 's/ GMT$//')
  date -u -D "%b %d %H:%M:%S %Y" -d "$bare" +%s 2>/dev/null \
    || date -u -d "$1" +%s 2>/dev/null \
    || date -u -j -f "%b %e %H:%M:%S %Y %Z" "$1" +%s 2>/dev/null \
    || echo ""
}

days_left() {
  end=$(to_epoch "$(cert_end "$1")")
  [ -n "$end" ] || { echo "?"; return; }
  echo $(( (end - $(date -u +%s)) / 86400 ))
}

# How long before its expiry a certificate is renewed: RENEW_BEFORE_DAYS,
# except for one whose whole life is shorter than three times that — Let's
# Encrypt's six-day certificates for IP addresses — which is renewed with a
# third of its life left. Ten days before the end of a six-day certificate is
# before it began.
renew_window_seconds() {
  window=$((RENEW_BEFORE_DAYS * 86400))
  start=$(to_epoch "$(cert_start "$1")")
  end=$(to_epoch "$(cert_end "$1")")
  if [ -n "$start" ] && [ -n "$end" ] && [ $((end - start)) -lt $((window * 3)) ]; then
    window=$(( (end - start) / 3 ))
  fi
  echo "$window"
}

# True when the certificate is missing, unreadable, or inside its renewal
# window. `openssl -checkend` answers without any date arithmetic, so a date
# no parser understands still gets the right answer for the default window.
due() {
  [ -f "$1" ] || return 0
  ! openssl x509 -checkend "$(renew_window_seconds "$1")" -noout -in "$1" >/dev/null 2>&1
}

# The certificate and the key belong together. A folder holding a new
# certificate beside an old key — what 3X-UI was left with on one server,
# which then served its panel over plain http and its inbound with no
# certificate at all — is broken, however valid each file is on its own.
pair_ok() {
  [ -s "$1" ] && [ -s "$2" ] || return 1
  from_cert=$(openssl x509 -noout -pubkey -in "$1" 2>/dev/null | openssl sha256 2>/dev/null)
  from_key=$(openssl pkey -pubout -in "$2" 2>/dev/null | openssl sha256 2>/dev/null)
  [ -n "$from_cert" ] && [ "$from_cert" = "$from_key" ]
}

fingerprint() { openssl x509 -noout -fingerprint -sha256 -in "$1" 2>/dev/null | cut -d= -f2; }

is_self_signed() {
  subject=$(openssl x509 -noout -subject -in "$1" 2>/dev/null | sed 's/^subject= *//')
  issuer=$(openssl x509 -noout -issuer -in "$1" 2>/dev/null | sed 's/^issuer= *//')
  [ -n "$subject" ] && [ "$subject" = "$issuer" ]
}

# True when $1 runs out later than $2.
expires_later() {
  a=$(to_epoch "$(cert_end "$1")")
  b=$(to_epoch "$(cert_end "$2")")
  [ -n "$a" ] && [ -n "$b" ] && [ "$a" -gt "$b" ]
}

remember_seen() { fingerprint "$DEPLOY_CERT" > "$SEEN_FILE" 2>/dev/null || true; }

# ---- the host: 3X-UI and its acme.sh ---------------------------------------

# A host path safe to hand to a shell on the host: absolute, and nothing in it
# a shell would read as anything but a path.
host_dir_usable() {
  printf '%s' "$CERTS_DIR_ON_HOST" | grep -Eq '^/[A-Za-z0-9._/@+-]+$'
}

# Runs a command on the host itself — its files, its services — from a
# throwaway container that enters the host's namespaces. The docker socket
# this container holds is already root on the host; this is that same reach,
# used for the two things that live outside any container: 3X-UI's service
# and its acme.sh.
on_host() {
  command -v docker >/dev/null 2>&1 || return 1
  image=$(docker inspect -f '{{.Image}}' "$RENEWER_CONTAINER" 2>/dev/null) || return 1
  docker run --rm --privileged --pid=host --network none --entrypoint nsenter "$image" \
    -t 1 -m -u -i -n -- /bin/sh -c "$1"
}

# 3X-UI and its xray read their certificate once, at start. When they read it
# from this folder they are restarted with the stack, the same as acme.sh's
# own reload command did — and only then, so an unrelated 3X-UI on the same
# machine is never touched.
restart_xui_if_sharing() {
  host_dir_usable || return 0
  on_host "command -v systemctl >/dev/null 2>&1 && systemctl cat x-ui >/dev/null 2>&1 || exit 3
grep -aqF '$CERTS_DIR_ON_HOST/' /etc/x-ui/x-ui.db /etc/x-ui/x-ui.db-wal 2>/dev/null || exit 4
systemctl restart x-ui" >/dev/null 2>&1
  case $? in
    0) log "restarted 3X-UI (x-ui), which reads this certificate too" ;;
    3|4) : ;;
    *) log "WARNING: could not restart 3X-UI; run on the host: systemctl restart x-ui" ;;
  esac
}

# A second ACME client renewing into the same folder — 3X-UI installs acme.sh
# for exactly this folder — would put a second certificate and a second key
# there on its own schedule, and on one server it left a new certificate
# beside an old key. In letsencrypt mode this container renews the folder, so
# the other client's entry for it is set aside the way `acme.sh --remove` does
# it: the .conf renamed to .conf.removed. Nothing is deleted; renaming it back
# undoes it.
retire_other_acme_clients() {
  host_dir_usable || return 0
  retired=$(on_host "for conf in /root/.acme.sh/*/*.conf; do
  [ -f \"\$conf\" ] || continue
  case \"\$conf\" in *.csr.conf) continue ;; esac
  grep -qF \"'$CERTS_DIR_ON_HOST/\" \"\$conf\" || continue
  mv \"\$conf\" \"\$conf.removed\" && echo \"\$conf\"
done" 2>/dev/null)
  for conf in $retired; do
    log "acme.sh was renewing into this folder too; set aside $conf (rename it back to undo)"
  done
}

# ---- writing the folder ----------------------------------------------------

# Puts a certificate and its key into the folder: new files beside the old,
# then renamed over them, so a reader never sees half of one. The key goes to
# the TURN server's user, read-only: coturn drops to that user before it reads
# the key, and root — nginx's master, 3X-UI — reads it regardless.
install_pair() {
  if ! cp "$1" "$DEPLOY_CERT.new" || ! cp "$2" "$DEPLOY_KEY.new"; then
    rm -f "$DEPLOY_CERT.new" "$DEPLOY_KEY.new"
    log "ERROR: could not write into the certificate folder"
    return 1
  fi
  chown "$COTURN_KEY_UID:$COTURN_KEY_UID" "$DEPLOY_KEY.new" 2>/dev/null
  chmod 400 "$DEPLOY_KEY.new"
  chmod 644 "$DEPLOY_CERT.new"
  mv -f "$DEPLOY_KEY.new" "$DEPLOY_KEY" && mv -f "$DEPLOY_CERT.new" "$DEPLOY_CERT" || return 1
  remember_seen
  return 0
}

# Everything that read the old certificate at start: nginx and coturn, and
# 3X-UI when it shares the folder.
restart_readers() {
  if command -v docker >/dev/null 2>&1; then
    docker restart "$APP_CONTAINER" "$COTURN_CONTAINER" >/dev/null 2>&1 \
      && log "restarted $APP_CONTAINER and $COTURN_CONTAINER" \
      || log "WARNING: could not restart $APP_CONTAINER and $COTURN_CONTAINER"
  fi
  [ "${1:-}" = "with-xui" ] && restart_xui_if_sharing
  return 0
}

# coturn runs as nobody and reads its private key once, at start. A key that
# is root-owned 0400 — what a certificate issued or copied as root leaves
# behind — costs the server its TURNS listener with nothing but a warning in
# coturn's log. Checked on every pass; coturn is restarted only when something
# actually had to change.
#
# A key someone else owns (CERT_MODE=existing) is handed to coturn's user only
# when root owns it: root reads it either way, so nothing that read it before
# loses it. A key owned by some other account is left alone, and said so.
ensure_coturn_key_readable() {
  [ -f "$DEPLOY_KEY" ] || return 0
  owner=$(stat -c '%u' "$DEPLOY_KEY" 2>/dev/null || echo "")
  mode=$(stat -c '%a' "$DEPLOY_KEY" 2>/dev/null || echo "")
  [ "$owner" = "$COTURN_KEY_UID" ] && [ "$mode" = "400" ] && return 0
  if [ "$CERT_MODE" = existing ] && [ "$owner" != "0" ]; then
    log "WARNING: the key belongs to uid $owner; TURN over TLS (5349) needs it readable by uid $COTURN_KEY_UID"
    return 0
  fi
  if chown "$COTURN_KEY_UID:$COTURN_KEY_UID" "$DEPLOY_KEY" && chmod 400 "$DEPLOY_KEY"; then
    log "repaired coturn key ownership (was uid ${owner:-?} mode ${mode:-?})"
    if command -v docker >/dev/null 2>&1; then
      docker restart "$COTURN_CONTAINER" >/dev/null 2>&1 \
        && log "restarted $COTURN_CONTAINER so it reads the key" \
        || log "WARNING: could not restart $COTURN_CONTAINER"
    fi
  else
    log "WARNING: could not repair coturn key ownership at $DEPLOY_KEY"
  fi
}

# Something other than this script changed the folder — the program that
# owns it renewed, or a person copied a certificate in. What read the old one
# at start is restarted so it serves the new one.
notice_outside_change() {
  now=$(fingerprint "$DEPLOY_CERT")
  before=$(cat "$SEEN_FILE" 2>/dev/null || echo "")
  [ -n "$now" ] || return 0
  if [ -n "$before" ] && [ "$now" != "$before" ] && pair_ok "$DEPLOY_CERT" "$DEPLOY_KEY"; then
    log "the certificate in the folder changed — restarting what reads it"
    remember_seen
    restart_readers
    return 0
  fi
  [ -n "$before" ] || remember_seen
}

# ---- Let's Encrypt ---------------------------------------------------------

# Who is holding a port — answers a container name, a PID, or empty.
#
# `docker inspect` prints "HostPort": "80" with a space and `docker port`
# prints "80/tcp -> 0.0.0.0:80" with nothing after the number; the patterns
# here once expected neither, so a container publishing port 80 was never
# found, and a renewal that needed the challenge would have failed on the
# port. It only ever worked because Let's Encrypt reused an earlier
# authorization.
port_holder() {
  port="$1"
  if command -v docker >/dev/null 2>&1; then
    for c in $(docker ps --format '{{.Names}}' 2>/dev/null); do
      if docker port "$c" 2>/dev/null | grep -Eq ":$port\$" \
         || docker inspect "$c" 2>/dev/null | grep -Eq "\"HostPort\": *\"$port\""; then
        echo "container:$c"
        return
      fi
    done
  fi
  # A host process (the renewer shares the host network, so netstat sees it)
  pid=$(netstat -tlnp 2>/dev/null | grep ":$port " | grep -o 'pid:[0-9]*' | head -1 | cut -d: -f2)
  [ -n "$pid" ] && echo "pid:$pid" && return
  echo ""
}

pause_port_holder() {
  case "$1" in
    container:*) docker stop -t 3 "${1#container:}" >/dev/null 2>&1 && log "stopped ${1#container:}" ;;
    pid:*) kill -STOP "${1#pid:}" 2>/dev/null && log "STOPped pid ${1#pid:}" ;;
  esac
}

resume_port_holder() {
  case "$1" in
    container:*) docker start "${1#container:}" >/dev/null 2>&1 && log "restarted ${1#container:}" ;;
    pid:*) kill -CONT "${1#pid:}" 2>/dev/null && log "CONTinued pid ${1#pid:}" ;;
  esac
}

certbot_account() {
  if [ -n "$CERTBOT_EMAIL" ]; then
    echo "--non-interactive --agree-tos -m $CERTBOT_EMAIL"
  else
    echo "--non-interactive --agree-tos --register-unsafely-without-email"
  fi
}

# certbot on port 80; if something holds the port, it is paused for the
# challenge and brought straight back.
certbot_with_port_dance() {
  holder=$(port_holder 80)
  if [ -z "$holder" ]; then
    # shellcheck disable=SC2046,SC2086
    certbot $1 $(certbot_account)
    return $?
  fi
  log "port 80 held by $holder — pausing for the ACME challenge"
  pause_port_holder "$holder"
  sleep 1
  # shellcheck disable=SC2046,SC2086
  certbot $1 $(certbot_account)
  status=$?
  resume_port_holder "$holder"
  return $status
}

# A name is asked for as a name. An address is asked for on the short-lived
# profile, the only one Let's Encrypt issues addresses under (six days).
le_identifier() {
  if is_ip "$DOMAIN"; then
    echo "--ip-address $DOMAIN --required-profile shortlived"
  else
    echo "-d $DOMAIN"
  fi
}

# certbot keeps its own threshold in the renewal file (30 days unless told
# otherwise), and a `certbot renew` from anywhere else on the machine — a cron
# job another project installed — consults it. It is set to this script's
# window, so nothing renews this lineage before it is due. Not for a
# six-day certificate, whose window this script works out from its life.
align_certbot_window() {
  is_ip "$DOMAIN" && return 0
  conf="$LETSENCRYPT_DIR/renewal/$CERT_NAME.conf"
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

pass_letsencrypt() {
  ensure_coturn_key_readable
  if [ ! -f "$LETSENCRYPT_DIR/renewal/$CERT_NAME.conf" ]; then
    log "no Let's Encrypt certificate for $CERT_NAME yet — requesting one"
    certbot_with_port_dance "certonly --standalone --http-01-address 0.0.0.0 --keep-until-expiring --cert-name $CERT_NAME $(le_identifier) --key-type ecdsa --elliptic-curve secp256r1" || {
      log "ERROR: certbot could not get a certificate for $DOMAIN (port 80 must reach this machine); trying again next pass"
      return 1
    }
    align_certbot_window
  elif [ "$FORCE" = 1 ] || due "$LIVE_CERT"; then
    log "certificate for $CERT_NAME: $(days_left "$LIVE_CERT")d left — renewing"
    certbot_with_port_dance "renew --cert-name $CERT_NAME --force-renewal" || {
      log "ERROR: certbot could not renew $CERT_NAME; trying again next pass"
      return 1
    }
  fi
  pair_ok "$LIVE_CERT" "$LIVE_KEY" || { log "ERROR: certbot's files for $CERT_NAME are missing or do not match"; return 1; }

  # What the folder serves: Let's Encrypt's current certificate, unless the
  # folder already holds it — or holds a sound certificate from a CA that
  # runs out later, which somebody put there on purpose.
  if pair_ok "$DEPLOY_CERT" "$DEPLOY_KEY"; then
    if [ "$(fingerprint "$DEPLOY_CERT")" = "$(fingerprint "$LIVE_CERT")" ]; then
      log "certificate healthy — $(days_left "$DEPLOY_CERT")d remaining (renewed ${RENEW_BEFORE_DAYS}d before expiry)"
      return 0
    fi
    if ! is_self_signed "$DEPLOY_CERT" && expires_later "$DEPLOY_CERT" "$LIVE_CERT"; then
      log "the folder holds a later certificate than Let's Encrypt's; kept — $(days_left "$DEPLOY_CERT")d remaining"
      return 0
    fi
  else
    log "the folder's certificate and key are missing or do not belong together — replacing them"
  fi
  install_pair "$LIVE_CERT" "$LIVE_KEY" || return 1
  log "deployed the certificate for $CERT_NAME into the folder ($(days_left "$DEPLOY_CERT")d remaining)"
  restart_readers with-xui
}

# ---- someone else's certificate --------------------------------------------

pass_existing() {
  if ! pair_ok "$DEPLOY_CERT" "$DEPLOY_KEY"; then
    log "WARNING: $CERT_FILE and $KEY_FILE in the certificate folder are missing or do not belong together"
    return 1
  fi
  ensure_coturn_key_readable
  if due "$DEPLOY_CERT"; then
    log "WARNING: the certificate expires in $(days_left "$DEPLOY_CERT")d; whoever owns the folder renews it (CERT_MODE=existing), not this stack"
  else
    log "certificate healthy — $(days_left "$DEPLOY_CERT")d remaining (renewed by the folder's owner)"
  fi
}

# ---- self-signed -----------------------------------------------------------

# Every name and address the certificate should answer for: localhost, the
# configured name and address, whatever CERT_SANS adds, and every IPv4
# address this machine has — the renewer shares the host's network, so a LAN
# address is one a phone on the same Wi-Fi will type.
self_signed_names() {
  {
    echo "DNS:localhost"
    echo "IP:127.0.0.1"
    for value in "$DOMAIN" "$EXTERNAL_IP" $(printf '%s' "$CERT_SANS" | tr ',' ' '); do
      case "$value" in
        ""|0.0.0.0) ;;
        DNS:*|IP:*) echo "$value" ;;
        *) if is_ip "$value"; then echo "IP:$value"; else echo "DNS:$value"; fi ;;
      esac
    done
    ip -o -4 addr show 2>/dev/null | awk '{ split($4, a, "/"); print "IP:" a[1] }'
  } | awk 'NF && !seen[$0]++ { out = out (out == "" ? "" : ",") $0 } END { print out }'
}

make_self_signed() {
  cn="$DOMAIN"
  [ -n "$cn" ] || cn=localhost
  work=$(mktemp -d)
  if ! openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -days 825 \
      -subj "/CN=$cn/O=P00RIJA Cryptography" \
      -addext "subjectAltName=$(self_signed_names)" \
      -addext "basicConstraints=critical,CA:FALSE" \
      -addext "keyUsage=critical,digitalSignature" \
      -addext "extendedKeyUsage=serverAuth" \
      -keyout "$work/key.pem" -out "$work/cert.pem" >/dev/null 2>&1; then
    rm -rf "$work"
    log "ERROR: openssl could not make a self-signed certificate"
    return 1
  fi
  install_pair "$work/cert.pem" "$work/key.pem"
  status=$?
  rm -rf "$work"
  [ $status -eq 0 ] && log "made a self-signed certificate for $(self_signed_names)"
  return $status
}

pass_self_signed() {
  # A CA's certificate copied in by hand is not this script's to replace.
  if pair_ok "$DEPLOY_CERT" "$DEPLOY_KEY" && ! is_self_signed "$DEPLOY_CERT"; then
    pass_existing
    return $?
  fi
  if [ "$FORCE" = 1 ] || ! pair_ok "$DEPLOY_CERT" "$DEPLOY_KEY" || due "$DEPLOY_CERT"; then
    make_self_signed || return 1
    restart_readers
    return 0
  fi
  ensure_coturn_key_readable
  log "self-signed certificate healthy — $(days_left "$DEPLOY_CERT")d remaining"
}

# ---- the loop --------------------------------------------------------------

resolve_mode() {
  if [ -z "$CERT_MODE" ]; then
    if [ -z "$DOMAIN" ] || [ "$DOMAIN" = localhost ] || is_ip "$DOMAIN"; then
      CERT_MODE=self-signed
    else
      CERT_MODE=letsencrypt
    fi
  fi
  case "$CERT_MODE" in
    letsencrypt|existing|self-signed) ;;
    *) log "FATAL: CERT_MODE must be letsencrypt, existing or self-signed (it is \"$CERT_MODE\")"; exit 1 ;;
  esac
  if [ "$CERT_MODE" = letsencrypt ]; then
    if [ -z "$DOMAIN" ] || [ "$DOMAIN" = localhost ] || { is_ip "$DOMAIN" && is_private_ip "$DOMAIN"; }; then
      log "Let's Encrypt cannot certify \"${DOMAIN:-nothing}\" — it is not reachable from the internet; keeping a self-signed certificate instead"
      CERT_MODE=self-signed
    fi
  fi
  # The files nginx and coturn were handed must be the ones in the folder,
  # or a renewal here is one they never see.
  if [ -n "$SSL_CERT_PATH_ON_HOST" ] && [ -n "$CERTS_DIR_ON_HOST" ] \
     && [ "$SSL_CERT_PATH_ON_HOST" != "$CERTS_DIR_ON_HOST/$CERT_FILE" ]; then
    log "WARNING: SSL_CERT_PATH ($SSL_CERT_PATH_ON_HOST) is not CERTS_DIR/CERT_FILE ($CERTS_DIR_ON_HOST/$CERT_FILE); nginx and coturn read a different file than the one kept here"
  fi
  if [ -n "$SSL_KEY_PATH_ON_HOST" ] && [ -n "$CERTS_DIR_ON_HOST" ] \
     && [ "$SSL_KEY_PATH_ON_HOST" != "$CERTS_DIR_ON_HOST/$KEY_FILE" ]; then
    log "WARNING: SSL_KEY_PATH ($SSL_KEY_PATH_ON_HOST) is not CERTS_DIR/KEY_FILE ($CERTS_DIR_ON_HOST/$KEY_FILE)"
  fi
}

run_pass() {
  notice_outside_change
  case "$CERT_MODE" in
    letsencrypt) pass_letsencrypt ;;
    existing) pass_existing ;;
    self-signed) pass_self_signed ;;
  esac
}

show_status() {
  echo "mode:        $CERT_MODE"
  echo "folder:      ${CERTS_DIR_ON_HOST:-$DEPLOY_DIR}  ($CERT_FILE, $KEY_FILE)"
  if [ -f "$DEPLOY_CERT" ]; then
    echo "subject:     $(openssl x509 -noout -subject -in "$DEPLOY_CERT" 2>/dev/null | sed 's/^subject= *//')"
    echo "issuer:      $(openssl x509 -noout -issuer -in "$DEPLOY_CERT" 2>/dev/null | sed 's/^issuer= *//')"
    echo "expires:     $(cert_end "$DEPLOY_CERT")  ($(days_left "$DEPLOY_CERT")d)"
    echo "renewed at:  $(( $(renew_window_seconds "$DEPLOY_CERT") / 3600 ))h before expiry"
    echo "fingerprint: $(fingerprint "$DEPLOY_CERT")"
  else
    echo "certificate: missing"
  fi
  if pair_ok "$DEPLOY_CERT" "$DEPLOY_KEY"; then echo "key:         matches the certificate"; else echo "key:         MISSING OR DOES NOT MATCH"; fi
}

# Sourced by the tests for its functions alone.
[ "${CERT_RENEWER_LIBRARY:-}" = 1 ] && return 0 2>/dev/null

resolve_mode
case "${1:-}" in
  --status) show_status; exit 0 ;;
  --once) run_pass; exit $? ;;
  --renew-now)
    FORCE=1
    [ "$CERT_MODE" = letsencrypt ] && retire_other_acme_clients
    run_pass
    exit $? ;;
  "") ;;
  *) echo "usage: cert-renewer.sh [--status | --once | --renew-now]" >&2; exit 2 ;;
esac

if [ "$CERT_MODE" = letsencrypt ]; then
  align_certbot_window
  retire_other_acme_clients
fi
log "keeping ${CERTS_DIR_ON_HOST:-$DEPLOY_DIR} ($CERT_FILE, $KEY_FILE) — mode $CERT_MODE, checked every $((CHECK_INTERVAL_SECONDS / 3600))h, renewed ${RENEW_BEFORE_DAYS}d before expiry"

while true; do
  run_pass || true
  sleep "$CHECK_INTERVAL_SECONDS"
done
