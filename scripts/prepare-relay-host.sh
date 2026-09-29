#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Prepares a fresh server so scripts/deploy.sh can reach it without a password.
#
#   sudo bash scripts/prepare-relay-host.sh <account> [cert dir] [install dir]
#
# Run it ONCE, on the server, as root. Everything after it is key-based and
# needs no privilege.
#
# It prepares a host for EITHER role. A host that only carries traffic needs the
# same three things as one that serves the whole application; the only
# difference is where the install lives, which is the third argument
# (work/pkg for a full install, work/relay for a bare relay).
#
# WHY THIS IS A SEPARATE SCRIPT
# -----------------------------
# Three things a deployment needs cannot be arranged over an ordinary SSH
# session with a key:
#
#   1. the account has to be in the docker group, or every compose command is
#      "permission denied";
#   2. the TLS certificate is usually under /root or /etc/letsencrypt, where
#      the deploying account cannot read it, and coturn needs to;
#   3. the install directory has to exist and belong to that account.
#
# Each is one line, and each needs root. Putting them in a script the operator
# can read before running beats a chat message with four commands to paste, and
# beats far more the alternative of a deployment script that asks for a
# password — a password on a command line is readable by every other user on
# the machine for as long as it runs.
#
# WHAT IT DOES NOT DO
# -------------------
# It does not install Docker, open ports, or touch the firewall. Those are the
# host's own arrangements and differ per provider; this only bridges the gap
# between "root can do it" and "the deploy key can do it".

set -uo pipefail

INFO='\033[1;34m'; OK='\033[1;32m'; WARN='\033[1;33m'; ERR='\033[1;31m'; NC='\033[0m'
log()  { printf "${INFO}▶ %s${NC}\n" "$1"; }
ok()   { printf "${OK}✓ %s${NC}\n" "$1"; }
warn() { printf "${WARN}! %s${NC}\n" "$1"; }
fail() { printf "${ERR}✖ %s${NC}\n" "$1"; }

ACCOUNT="${1:-}"
CERT_SRC="${2:-}"
# Relative to the account's home. The certificate goes INSIDE the install, at
# certs/cert.pem, because that is where scripts/setup.sh looks and where
# docker-compose.yaml's default SSL_CERT_PATH points -- putting it anywhere else
# means every install needs an SSL_CERT_PATH override in .env to find it.
INSTALL_REL="${3:-work/pkg}"

if [ -z "$ACCOUNT" ]; then
    sed -n '11,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
    fail "This needs root: sudo bash $0 $ACCOUNT ${CERT_SRC:-<cert dir>}"
    exit 1
fi
if ! id "$ACCOUNT" >/dev/null 2>&1; then
    fail "No such account: $ACCOUNT"
    exit 1
fi

HOME_DIR="$(getent passwd "$ACCOUNT" | cut -d: -f6)"
[ -n "$HOME_DIR" ] || { fail "Could not find the home directory of $ACCOUNT"; exit 1; }

# ---------------------------------------------------------------- docker group
log "Docker access for $ACCOUNT"
if ! command -v docker >/dev/null 2>&1; then
    fail "Docker is not installed. Install it first, then run this again."
    echo "  https://docs.docker.com/engine/install/"
    exit 1
fi
if id -nG "$ACCOUNT" | tr ' ' '\n' | grep -qx docker; then
    ok "already in the docker group"
else
    usermod -aG docker "$ACCOUNT"
    ok "added to the docker group"
    # Group membership is read at login, so the session that will deploy has to
    # be a new one. Saying so is the difference between this working and the
    # next deployment failing for a reason nobody can see.
    warn "the next SSH session picks it up — an already-open one will not"
fi

# ----------------------------------------------------------------- certificate
#
# coturn and nginx run in containers as a different user, and both read the
# certificate from a path this account owns. Copied rather than symlinked: a
# symlink into /etc/letsencrypt is a link the container cannot follow.
if [ -n "$CERT_SRC" ]; then
    log "Certificate from $CERT_SRC"
    if [ ! -d "$CERT_SRC" ]; then
        fail "Not a directory: $CERT_SRC"
        exit 1
    fi
    CERT_DST="$HOME_DIR/$INSTALL_REL/certs"
    mkdir -p "$CERT_DST"

    # Whatever the issuer called them. Let's Encrypt writes fullchain.pem and
    # privkey.pem; other issuers use .crt/.key or the domain as the name.
    FOUND_CERT=""
    FOUND_KEY=""
    for candidate in fullchain.pem cert.pem certificate.crt "$(basename "$CERT_SRC").crt" "$(basename "$CERT_SRC").pem"; do
        [ -f "$CERT_SRC/$candidate" ] && { FOUND_CERT="$CERT_SRC/$candidate"; break; }
    done
    for candidate in privkey.pem key.pem private.key "$(basename "$CERT_SRC").key"; do
        [ -f "$CERT_SRC/$candidate" ] && { FOUND_KEY="$CERT_SRC/$candidate"; break; }
    done

    if [ -z "$FOUND_CERT" ] || [ -z "$FOUND_KEY" ]; then
        fail "Could not find a certificate and a key in $CERT_SRC"
        echo "  It contains:"
        ls -1 "$CERT_SRC" | sed 's/^/    /'
        echo "  Copy them yourself as $CERT_DST/cert.pem and $CERT_DST/key.pem,"
        echo "  owned by $ACCOUNT, then run this again without the directory."
        exit 1
    fi

    cp "$FOUND_CERT" "$CERT_DST/cert.pem"
    cp "$FOUND_KEY"  "$CERT_DST/key.pem"
    chown -R "$ACCOUNT:$ACCOUNT" "$CERT_DST"
    chmod 755 "$CERT_DST"
    chmod 644 "$CERT_DST/cert.pem"
    # The private key stays owner-only. The container reads it as root, which
    # can read it regardless; nothing else on the machine needs to.
    chmod 600 "$CERT_DST/key.pem"
    ok "copied to $CERT_DST (cert.pem 644, key.pem 600, owned by $ACCOUNT)"
    printf "    subject: %s\n" "$(openssl x509 -in "$CERT_DST/cert.pem" -noout -subject 2>/dev/null | sed 's/^subject=//')"
    printf "    expires: %s\n" "$(openssl x509 -in "$CERT_DST/cert.pem" -noout -enddate 2>/dev/null | sed 's/^notAfter=//')"

    # A certificate that is renewed in place under /root stops reaching the
    # container the moment it is renewed, and nothing says so until TLS starts
    # failing. Worth one sentence now rather than a puzzle in ninety days.
    warn "renewal does not copy itself: run this again after the certificate is renewed,"
    warn "or point the renewal's deploy hook at $CERT_DST"
else
    warn "no certificate directory given — skipping that step"
    echo "  Pass it as the second argument if this host serves TLS:"
    echo "      sudo bash $0 $ACCOUNT /root/cert/your.domain"
fi

# ------------------------------------------------------------ install location
log "Install directory"
for dir in "$HOME_DIR/$INSTALL_REL" "$HOME_DIR/backups"; do
    mkdir -p "$dir"
    chown -R "$ACCOUNT:$ACCOUNT" "$(dirname "$dir")"
    printf "    %s\n" "$dir"
done
chmod 700 "$HOME_DIR/backups"
ok "ready, owned by $ACCOUNT"

echo
ok "This host is prepared. Nothing else here needs root."
echo "  From your own machine:"
echo "      bash scripts/deploy.sh --server <name>"
