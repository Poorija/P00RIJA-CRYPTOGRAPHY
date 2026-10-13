#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# P00RIJA Cryptography Setup Wizard
# This script configures the environment, certificates, and starts Docker containers.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/cert-folder.sh
. "$ROOT/scripts/lib/cert-folder.sh"

COMPOSE_FILE="$ROOT/config/docker-compose.yaml"
ENV_FILE="$ROOT/.env"
BACKTITLE="P00RIJA Cryptography • Setup & Docker Manager"
NONINTERACTIVE_UPDATE=false
if [[ "${1:-}" == "--update-server" || "${1:-}" == "update-server" || "${1:-}" == "--update-server-local" ]]; then
    NONINTERACTIVE_UPDATE=true
fi
# --quick installs a fresh server with no questions asked, which is what a
# one-line install from a README needs: whiptail cannot run inside `curl | bash`
# because stdin is the script itself, so the wizard could never be the entry
# point for an unattended install.
QUICK_INSTALL=false
QUICK_DOMAIN=""
QUICK_EMAIL=""
QUICK_MONITOR_PASS=""
# Empty means "Let's Encrypt for a public domain name, self-signed otherwise".
QUICK_CERT=""
QUICK_CERT_DIR=""
QUICK_START=true
# Relays this one may carry for, as "<id>@<origin>" separated by commas. Empty
# is the default and means this relay carries for nobody, which is the only safe
# default: a relay that carries for anyone who asks is an open relay.
QUICK_PEERS=""
if [[ "${1:-}" == "--quick" || "${1:-}" == "quick" ]]; then
    QUICK_INSTALL=true
    NONINTERACTIVE_UPDATE=true   # same effect: never reach for whiptail
    shift
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --domain)   QUICK_DOMAIN="${2:-}"; shift 2 ;;
            --email)    QUICK_EMAIL="${2:-}"; shift 2 ;;
            --password) QUICK_MONITOR_PASS="${2:-}"; shift 2 ;;
            --letsencrypt) QUICK_CERT="letsencrypt"; shift ;;
            --self-signed) QUICK_CERT="self-signed"; shift ;;
            # A folder that already holds this server's certificate (3X-UI's
            # /root/cert/<domain>/, say): served from there, shared. With
            # --letsencrypt this server also renews it there.
            --cert-dir) QUICK_CERT_DIR="${2:-}"; shift 2 ;;
            --peers)    QUICK_PEERS="${2:-}"; shift 2 ;;
            --no-start) QUICK_START=false; shift ;;
            *) echo "Unknown option for --quick: $1" >&2; exit 2 ;;
        esac
    done
fi

# Ensure whiptail is available
if [[ "$NONINTERACTIVE_UPDATE" != "true" ]] && ! command -v whiptail >/dev/null 2>&1; then
    if [[ "$(uname -s)" == "Linux" ]]; then
        echo "whiptail is missing. It is required for this graphical setup wizard."
        read -p "Would you like to try installing it automatically? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            # Source common to get family and install_linux_packages
            if [[ -f "scripts/lib/setup-common.sh" ]]; then
                . "scripts/lib/setup-common.sh"
                family="$(detect_linux_family)"
                case "$family" in
                    debian) pkg="whiptail" ;;
                    redhat) pkg="newt" ;;
                    arch) pkg="whiptail" ;;
                    *) pkg="" ;;
                esac
                if [[ -n "$pkg" ]]; then
                    install_linux_packages "$family" "$pkg"
                    # Re-check
                    if command -v whiptail >/dev/null 2>&1; then
                        echo "whiptail installed successfully. Resuming..."
                    else
                        echo "Failed to install whiptail."
                        exit 1
                    fi
                else
                    echo "Unknown Linux distribution. Please install whiptail manually."
                    exit 1
                fi
            else
                echo "Could not find setup-common.sh to perform automatic installation."
                exit 1
            fi
        else
            exit 1
        fi
    else
        echo "Error: whiptail is not installed. Please install it for the graphical wizard."
        exit 1
    fi
fi

# What .env says about the certificate. Every part of the stack reads the
# pair in place from CERTS_DIR, and scripts/cert-renewer.sh keeps it there:
# CERT_MODE=letsencrypt issues and renews it, existing follows whoever else
# renews it, self-signed makes it (and makes it again before it runs out).
CERT_MODE="self-signed"
CERTS_DIR_SETTING="$ROOT/certs"
CERT_FILE="cert.pem"
KEY_FILE="key.pem"
CERT_SANS=""
CERTBOT_EMAIL=""

# Colors for terminal output
INFO='\033[1;34m'
SUCCESS='\033[1;32m'
WARN='\033[1;33m'
ERROR='\033[1;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# Helpers
msg_box() {
    whiptail --backtitle "$BACKTITLE" --title "$1" --msgbox "$2" 11 72
}

final_msg_box() {
    whiptail --backtitle "$BACKTITLE" --title "$1" --msgbox "$2" 18 82
}

choice_menu() {
    whiptail --backtitle "$BACKTITLE" --title "$1" --menu "$2" 18 78 7 \
        "1" "Local setup / localhost and LAN" \
        "2" "Server setup / domain name" \
        "3" "Server setup / public IP" \
        "4" "Update installed server / keep all data" \
        "5" "Rebuild containers only / keep current settings" \
        "6" "Factory reset / clear all settings and volumes" \
        3>&1 1>&2 2>&3
}

input_box() {
    whiptail --backtitle "$BACKTITLE" --title "$1" --inputbox "$2" 10 72 "$3" 3>&1 1>&2 2>&3
}

password_box() {
    whiptail --backtitle "$BACKTITLE" --title "$1" --passwordbox "$2" 10 74 3>&1 1>&2 2>&3
}

yes_no() {
    whiptail --backtitle "$BACKTITLE" --title "$1" --yesno "$2" 11 72
}

print_header() {
    printf "\n${BOLD}${INFO}╭──────────────────────────────────────────────╮${NC}\n"
    printf "${BOLD}${INFO}│        P00RIJA Cryptography Setup            │${NC}\n"
    printf "${BOLD}${INFO}╰──────────────────────────────────────────────╯${NC}\n"
}

step_log() {
    printf "${INFO}▶ %s${NC}\n" "$1"
}

ok_log() {
    printf "${SUCCESS}✓ %s${NC}\n" "$1"
}

warn_log() {
    printf "${WARN}⚠ %s${NC}\n" "$1"
}

compose_cmd() {
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

prompt_installed_server_dir() {
    local default_dir="${P00RIJA_INSTALLED_SERVER_DIR:-/opt/p00rija-cryptography}"
    input_box "Installed Server Folder" "No .env file was found in this package folder.\n\nEnter the existing server install folder that already contains .env.\n\nThe updater will copy the new application files there while preserving .env, certs/, data/, backups/, and Docker volumes." "$default_dir"
}

copy_update_files_to_installed_dir() {
    local target_dir="$1"
    target_dir="${target_dir%/}"

    if [[ -z "$target_dir" ]]; then
        if [[ "$NONINTERACTIVE_UPDATE" == "true" ]]; then
            echo "Missing install directory. Usage: bash scripts/setup.sh --update-server /path/to/existing/install" >&2
            return 1
        fi
        msg_box "Missing Install Folder" "Please enter the existing server install folder."
        return 1
    fi

    if [[ ! -d "$target_dir" ]]; then
        if [[ "$NONINTERACTIVE_UPDATE" == "true" ]]; then
            echo "Install directory does not exist: $target_dir" >&2
            return 1
        fi
        msg_box "Install Folder Not Found" "The selected install folder does not exist:\n$target_dir"
        return 1
    fi

    if [[ ! -f "$target_dir/.env" ]]; then
        if [[ "$NONINTERACTIVE_UPDATE" == "true" ]]; then
            echo "No .env was found in install directory: $target_dir" >&2
            echo "Run a fresh setup once there, or choose the folder where the existing server is installed." >&2
            return 1
        fi
        msg_box "Missing Installed Configuration" "No .env file was found in:\n$target_dir\n\nChoose the folder where the current server is already installed, or run Local, Domain, or Public IP setup first."
        return 1
    fi

    local source_real target_real
    source_real="$(cd "$ROOT" && pwd -P)"
    target_real="$(cd "$target_dir" && pwd -P)"
    if [[ "$source_real" == "$target_real" ]]; then
        return 0
    fi

    print_header
    step_log "Copying new application files into the installed server folder..."
    printf "${DIM}Source package: %s${NC}\n" "$source_real"
    printf "${DIM}Installed server: %s${NC}\n" "$target_real"

    mkdir -p "$target_real"
    if command -v rsync >/dev/null 2>&1; then
        rsync -a \
            --exclude='.env' \
            --exclude='certs/' \
            --exclude='data/' \
            --exclude='backups/' \
            --exclude='artifacts/' \
            --exclude='node_modules/' \
            --exclude='dist/' \
            --exclude='Native App/' \
            --exclude='src-tauri/target/' \
            --exclude='.DS_Store' \
            --exclude='.git/' \
            "$source_real/" "$target_real/"
    else
        (
            cd "$source_real"
            tar -cf - \
                --exclude='./.env' \
                --exclude='./certs' \
                --exclude='./data' \
                --exclude='./backups' \
                --exclude='./artifacts' \
                --exclude='./node_modules' \
                --exclude='./dist' \
                --exclude='./Native App' \
                --exclude='./src-tauri/target' \
                --exclude='./.DS_Store' \
                --exclude='./.git' \
                .
        ) | (
            cd "$target_real"
            tar -xf -
        )
    fi

    ok_log "Application files were copied. Persistent server data was left in place."
    step_log "Continuing update from the installed server folder..."
    exec bash "$target_real/scripts/setup.sh" --update-server-local
}

require_existing_config() {
    if [[ ! -f "$ENV_FILE" ]]; then
        if [[ "$NONINTERACTIVE_UPDATE" == "true" ]]; then
            echo "Missing .env in current folder: $ROOT" >&2
            echo "If this is a newly extracted package, run:" >&2
            echo "  bash scripts/setup.sh --update-server /path/to/existing/install" >&2
            return 1
        fi
        local install_dir
        install_dir="$(prompt_installed_server_dir)" || return 1
        copy_update_files_to_installed_dir "$install_dir"
        return 1
    fi
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        if [[ "$NONINTERACTIVE_UPDATE" == "true" ]]; then
            echo "Missing Docker Compose file: $COMPOSE_FILE" >&2
            return 1
        fi
        msg_box "Missing Docker Compose File" "Docker Compose file was not found:\n$COMPOSE_FILE"
        return 1
    fi
    if ! command -v docker >/dev/null 2>&1; then
        if [[ "$NONINTERACTIVE_UPDATE" == "true" ]]; then
            echo "Docker is not installed or not in PATH." >&2
            return 1
        fi
        msg_box "Docker Not Found" "Docker is not installed or is not available in PATH."
        return 1
    fi
}

backup_server_state() {
    local backup_dir="$ROOT/backups"
    local stamp
    stamp="$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"
    local backup_file="$backup_dir/poorija-server-state-$stamp.tar.gz"

    step_log "Creating backup before update..."
    tar -czf "$backup_file" \
        --exclude='data/chat-signal/*.tmp' \
        --exclude='data/chat-signal/*.lock' \
        .env certs config/nginx.conf data/chat-signal 2>/dev/null || {
        warn_log "Backup completed with missing optional paths. Continuing."
        tar -czf "$backup_file" .env 2>/dev/null || true
    }

    if [[ -f "$backup_file" ]]; then
        ok_log "Backup saved: $backup_file"
    else
        warn_log "Backup file was not created. Check filesystem permissions before exposing this server."
    fi
}

wait_for_chat_health() {
    local origin="$1"
    local attempts="${2:-30}"
    local url="${origin%/}/chat-health"
    local i
    for ((i = 1; i <= attempts; i++)); do
        if curl -kfsS --connect-timeout 3 "$url" >/dev/null 2>&1; then
            ok_log "Server health check passed: $url"
            return 0
        fi
        sleep 2
    done
    warn_log "Health check did not pass yet: $url"
    return 1
}

load_display_values_from_env() {
    DOMAIN="$(awk -F= '$1=="DOMAIN"{print $2; exit}' "$ENV_FILE" 2>/dev/null || true)"
    EXT_IP="$(awk -F= '$1=="EXTERNAL_IP"{print $2; exit}' "$ENV_FILE" 2>/dev/null || true)"
    DOMAIN="${DOMAIN:-localhost}"
    EXT_IP="${EXT_IP:-127.0.0.1}"
    build_display_urls
}

generate_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -base64 32 | tr -d '\n'
        return
    fi
    LC_ALL=C tr -dc 'A-Za-z0-9_@%+=:,.-' </dev/urandom | head -c 48
}

build_display_urls() {
    DISPLAY_HOST="${DOMAIN:-}"
    if [[ -z "$DISPLAY_HOST" || "$DISPLAY_HOST" == "0.0.0.0" ]]; then
        DISPLAY_HOST="${EXT_IP:-localhost}"
    fi
    if [[ -z "$DISPLAY_HOST" ]]; then
        DISPLAY_HOST="localhost"
    fi
    APP_URL="https://$DISPLAY_HOST:${APP_PORT:-8585}"
    MONITOR_URL="$APP_URL/Monitor_Server"
}

validate_env_value() {
    local label="$1"
    local value="$2"
    if [[ "$value" =~ [[:space:]] ]]; then
        msg_box "Invalid $label" "$label must not contain spaces, tabs, or newlines because it is written to Docker .env."
        return 1
    fi
    if [[ "$value" == *'$'* ]]; then
        msg_box "Invalid $label" "$label must not contain the dollar sign ($) because Docker Compose treats it as interpolation syntax."
        return 1
    fi
    return 0
}

write_env_file() {
    local port="${APP_PORT:-8585}"
    # coturn's command line and chat-signal's CHAT_TURN_USERNAME both interpolate
    # TURN_USER, and docker-compose.yaml demands it with :?. This function never
    # wrote it, so a fresh install produced an .env that could not start the
    # stack at all -- "required variable TURN_USER is missing a value" -- and the
    # only installs that worked were ones whose .env predated the requirement.
    # A name, not a secret: TURN_PASSWORD is the secret, and a fixed username
    # would still be a username every deployment shared.
    local turn_user="${TURN_USER:-relay-$(openssl rand -hex 4)}"
    local allowed_origins="https://$DOMAIN:$port,https://$DOMAIN"
    if [[ "$DOMAIN" == "localhost" ]]; then
        allowed_origins="https://localhost:$port,http://localhost:$port,https://127.0.0.1:$port,http://127.0.0.1:$port"
    elif [[ "$DOMAIN" == "$EXT_IP" ]]; then
        allowed_origins="https://$EXT_IP:$port,http://$EXT_IP:$port"
    fi

    # Owner-only from the first write: this file holds the monitor and TURN
    # passwords, and the default umask made it readable by every other
    # account on the host.
    umask 077
    cat > "$ROOT/.env" <<EOF
DOMAIN=$DOMAIN
EXTERNAL_IP=$EXT_IP
APP_PORT=${APP_PORT:-8585}
# The certificate: one folder, read in place by nginx, the TURN server and the
# relay, and kept by the cert-renewer container. See scripts/cert-renewer.sh.
CERT_MODE=$CERT_MODE
CERTS_DIR=$CERTS_DIR_SETTING
CERT_FILE=$CERT_FILE
KEY_FILE=$KEY_FILE
SSL_CERT_PATH=$CERTS_DIR_SETTING/$CERT_FILE
SSL_KEY_PATH=$CERTS_DIR_SETTING/$KEY_FILE
CERT_SANS=$CERT_SANS
CERTBOT_EMAIL=$CERTBOT_EMAIL
MONITOR_PASSWORD=$MONITOR_PASS
TURN_USER=$turn_user
TURN_PASSWORD=$TURN_PASS
TURN_SECRET=${TURN_SECRET:-$(openssl rand -hex 32)}
CHAT_ALLOWED_ORIGINS=$allowed_origins
# The relays this one links to, as "<id>@<origin>", comma separated. Empty means
# transit is off and /relay-link is refused outright -- a relay with no peers
# configured cannot be talked into carrying anything. See docs/RELAY-NETWORK.md,
# or let scripts/link-relays.sh fill this in for two servers that are already up.
CHAT_TRANSIT_PEERS=${QUICK_PEERS:-${CHAT_TRANSIT_PEERS:-}}
EOF
    chmod 600 "$ROOT/.env"
    umask 022
}

# config/nginx.conf used to be rewritten in place here -- server_name and the
# CSP's connect-src origins patched with sed and awk during an install. Both are
# gone: the file is a template now, and APP_DOMAIN / APP_ORIGIN / APP_ORIGIN_WS
# are filled in when the container starts, from the DOMAIN and APP_PORT that
# write_env_file puts in .env. An in-place rewrite only ever held until the next
# deployment rsynced config/ over it, which is why a second server kept coming
# up under the first one's name.

resolve_domain_ip() {
    local domain="$1"
    local resolved=""
    
    if command -v dig >/dev/null 2>&1; then
        resolved=$(dig +short "$domain" | tail -n1)
    fi
    
    # getent does not exist on macOS, and the error it printed there was the
    # only sign that resolution had failed — after which the caller quietly used
    # the installing machine's own public IP for somebody else's domain.
    if [[ -z "$resolved" ]] && command -v getent >/dev/null 2>&1; then
        resolved=$(getent hosts "$domain" | awk '{ print $1 }' | head -n1)
    fi

    if [[ -z "$resolved" ]] && command -v host >/dev/null 2>&1; then
        resolved=$(host -t A "$domain" 2>/dev/null | awk '/has address/ { print $NF; exit }')
    fi

    if [[ -z "$resolved" ]] && command -v nslookup >/dev/null 2>&1; then
        resolved=$(nslookup "$domain" 2>/dev/null | awk '/^Address: /{ print $2; exit }')
    fi

    if [[ -z "$resolved" ]] && command -v python3 >/dev/null 2>&1; then
        resolved=$(python3 -c "import socket,sys
try: print(socket.gethostbyname(sys.argv[1]))
except Exception: pass" "$domain" 2>/dev/null)
    fi
    
    if [[ -z "$resolved" ]] && command -v ping >/dev/null 2>&1; then
        resolved=$(ping -c1 "$domain" 2>/dev/null | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
    fi
    
    echo "$resolved"
}

get_public_ip() {
    local ip=""
    # Try multiple services for robustness
    ip=$(curl -s --connect-timeout 5 https://api.ipify.org || echo "")
    [[ -z "$ip" ]] && ip=$(curl -s --connect-timeout 5 https://ifconfig.me || echo "")
    [[ -z "$ip" ]] && ip=$(curl -s --connect-timeout 5 https://icanhazip.com || echo "")
    [[ -z "$ip" ]] && ip=$(curl -s --connect-timeout 5 https://ipecho.net/plain || echo "")
    echo "$ip"
}

detect_ips() {
    local ips=""
    if command -v hostname >/dev/null 2>&1; then
        ips=$(hostname -I 2>/dev/null || echo "")
    fi
    
    if [[ -z "$ips" ]] && command -v ip >/dev/null 2>&1; then
        ips=$(ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '127.0.0.1' | tr '\n' ' ')
    fi
    
    if [[ -z "$ips" ]]; then
        echo "127.0.0.1"
    else
        echo "$ips"
    fi
}

# Every name and address a self-signed certificate should answer for:
# localhost, the host itself, the public address, and each address this
# machine has on its networks — a phone on the same Wi-Fi types one of those.
default_sans() {
    local host="$1" ip
    {
        echo "DNS:localhost"
        echo "IP:127.0.0.1"
        if [[ -n "$host" && "$host" != "localhost" ]]; then
            if [[ "$host" =~ ^[0-9.]+$ || "$host" == *:* ]]; then echo "IP:$host"; else echo "DNS:$host"; fi
        fi
        [[ -n "${EXT_IP:-}" && "$EXT_IP" != "0.0.0.0" ]] && echo "IP:$EXT_IP"
        for ip in $(detect_ips); do echo "IP:$ip"; done
    } | awk 'NF && !seen[$0]++ { out = out (out == "" ? "" : ",") $0 } END { print out }'
}

# A self-signed certificate in the stack's own folder. Also the placeholder a
# Let's Encrypt install starts with: the containers need a certificate to
# start, and the renewer replaces this one on its first pass.
generate_self_signed() {
    local cn="$1"
    local sans="$2"
    local cert_dir="$ROOT/certs"
    mkdir -p "$cert_dir"
    openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
        -days 825 \
        -subj "/CN=$cn/O=P00RIJA Cryptography" \
        -addext "subjectAltName=$sans" \
        -addext "basicConstraints=critical,CA:FALSE" \
        -addext "keyUsage=critical,digitalSignature" \
        -addext "extendedKeyUsage=serverAuth" \
        -keyout "$cert_dir/key.pem" \
        -out "$cert_dir/cert.pem" >/dev/null 2>&1
    chmod 644 "$cert_dir/cert.pem"
    chmod 600 "$cert_dir/key.pem"
    CERTS_DIR_SETTING="$cert_dir"
    CERT_FILE="cert.pem"
    KEY_FILE="key.pem"
}

ask_certbot_email() {
    local email
    email=$(input_box "Let's Encrypt" "An email for expiry notices from Let's Encrypt (optional; leave empty for none):" "${CERTBOT_EMAIL:-}") || email=""
    if [[ -n "$email" ]] && ! validate_env_value "Email" "$email"; then
        email=""
    fi
    CERTBOT_EMAIL="$email"
}

# Let's Encrypt for a name or a public address: the renewer asks for it when
# the stack starts, and until it arrives a self-signed placeholder is served.
use_letsencrypt() {
    local host="$1"
    CERT_MODE="letsencrypt"
    ask_certbot_email
    generate_self_signed "$host" "$(default_sans "$host")"
}

# The certificate this server already has — 3X-UI's, certbot's, a CA's — is
# served from where it is, not copied: whatever renews it there renews it for
# this stack too, and the stack restarts when it changes. Returns 2 when the
# person backs out, 1 to ask again.
use_existing_cert_folder() {
    local host="$1" suggested="" dir
    if [[ -n "$host" && "$host" != "localhost" ]] && cert_folder_exists "/root/cert/$host"; then
        suggested="/root/cert/$host"
    fi
    dir=$(input_box "Existing Certificate" "The folder holding the certificate and its private key.\n3X-UI keeps one in /root/cert/<domain>/. Cancel to choose another way." "$suggested") || return 2
    [[ -n "$dir" ]] || return 2
    dir="${dir%/}"
    if [[ -f "$dir" ]] || { [[ "$dir" == *.pem || "$dir" == *.crt || "$dir" == *.cer ]] && ! cert_folder_exists "$dir"; }; then
        dir="$(dirname "$dir")"
    fi
    if [[ "$dir" != /* || "$dir" =~ [[:space:]] || "$dir" == *'$'* ]]; then
        msg_box "Folder" "Give the folder as an absolute path, without spaces or a dollar sign."
        return 1
    fi
    if ! cert_find_pair "$dir" "$host"; then
        whiptail --backtitle "$BACKTITLE" --title "No Certificate Found" --msgbox "$CERT_PAIR_REASON" 14 78
        return 1
    fi
    local note=""
    [[ "$CERT_PAIR_COVERS" == "no" ]] && note="$note\n\nWARNING: it does not name $host; browsers will refuse it there."
    [[ "$CERT_PAIR_DAYS" == "expired" ]] && note="$note\n\nWARNING: it has expired."
    whiptail --backtitle "$BACKTITLE" --title "Certificate Found" --yesno "Folder:       $dir\nCertificate:  $CERT_PAIR_CERT\nKey:          $CERT_PAIR_KEY\nFor:          $CERT_PAIR_SUBJECT\nIssued by:    $CERT_PAIR_ISSUER\nExpires:      $CERT_PAIR_END ($CERT_PAIR_DAYS days)$note\n\nServe this certificate from this folder?" 20 80 || return 1
    CERTS_DIR_SETTING="$dir"
    CERT_FILE="$CERT_PAIR_CERT"
    KEY_FILE="$CERT_PAIR_KEY"
    CERT_MODE="existing"
    if cert_publicly_certifiable "$host"; then
        local who
        who=$(whiptail --backtitle "$BACKTITLE" --title "Who Renews It" --menu "Who keeps this certificate renewed?" 15 80 2 \
            "1" "This server: Let's Encrypt, 10 days before expiry, in this folder" \
            "2" "Another program already does; follow its renewals" \
            3>&1 1>&2 2>&3) || who="2"
        if [[ "$who" == "1" ]]; then
            CERT_MODE="letsencrypt"
            ask_certbot_email
            whiptail --backtitle "$BACKTITLE" --title "One Certificate, One Owner" --msgbox "This server now renews the certificate in $dir, ten days before it expires, and restarts what reads it — 3X-UI too, when 3X-UI reads this folder.\n\nIf acme.sh (3X-UI's own renewer) also renews into this folder, its entry is set aside — renamed to .conf.removed, nothing deleted — so the folder has one owner and one key." 15 80
        fi
    fi
    return 0
}

# Asks whether a certificate already exists and, if so, where. True when one
# was taken.
offer_existing_cert() {
    local host="$1" question="$2" rc
    yes_no "SSL Certificate" "$question" || return 1
    while true; do
        rc=0
        use_existing_cert_folder "$host" || rc=$?
        [[ $rc -eq 0 ]] && return 0
        [[ $rc -eq 2 ]] && return 1
    done
}

factory_reset() {
    if ! whiptail --backtitle "$BACKTITLE" --title "FACTORY RESET" --yesno "WARNING: This will perform the following actions:\n\n1. Stop and remove all Docker containers and volumes.\n2. Delete the .env file.\n3. Clear all certificates in the certs/ directory.\n\nAre you sure you want to proceed?" 16 72; then
        return
    fi

    CONFIRM=$(input_box "Confirmation Required" "To confirm deletion of ALL settings, please type 'RESET' (all caps) below:" "")
    
    if [[ "$CONFIRM" != "RESET" ]]; then
        msg_box "Cancelled" "Reset aborted. You must type 'RESET' exactly to proceed."
        return
    fi

    print_header
    warn_log "Performing factory reset..."
    
    if command -v docker >/dev/null 2>&1; then
        step_log "Stopping Docker containers and removing volumes..."
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down -v --remove-orphans || true
    fi

    step_log "Cleaning up configuration files..."
    rm -f "$ROOT/.env"
    mkdir -p "$ROOT/certs"
    rm -f "$ROOT/certs"/*.pem

    msg_box "Reset Successful" "All settings and certificates have been cleared.\nThe project is now in its default state."
    exit 0
}

rebuild_containers_only() {
    require_existing_config || return
    load_display_values_from_env

    if ! yes_no "Rebuild Containers Only" "This will:\n\n- Stop and remove only the Docker containers.\n- Rebuild images from the current project files.\n- Start the containers again.\n\nIt will NOT remove volumes, .env, certificates, chat data, or server policies.\n\nContinue?"; then
        return
    fi

    print_header
    step_log "Using existing configuration: $ENV_FILE"
    step_log "Stopping and removing containers (volumes are kept)..."
    compose_cmd down --remove-orphans

    step_log "Rebuilding images from current application files..."
    compose_cmd build

    step_log "Starting fresh containers..."
    compose_cmd up -d --force-recreate

    ok_log "Container-only rebuild completed."
    printf "${DIM}Application:     %s${NC}\n" "$APP_URL"
    printf "${DIM}Monitor Server: %s${NC}\n" "$MONITOR_URL"
    final_msg_box "Rebuild Complete" "Containers were removed and rebuilt from the current files.\n\nSettings, certificates, Docker volumes, chat data, offline messages, and server policies were preserved.\n\nApplication Server:\n$APP_URL\n\nMonitor Server:\n$MONITOR_URL"
    exit 0
}

update_installed_server() {
    local assume_yes="${1:-false}"
    local install_dir="${2:-${P00RIJA_INSTALLED_SERVER_DIR:-}}"
    if [[ ! -f "$ENV_FILE" && -n "$install_dir" ]]; then
        copy_update_files_to_installed_dir "$install_dir"
        return
    fi
    require_existing_config || return
    load_display_values_from_env

    if [[ "$assume_yes" != "true" ]]; then
        if ! yes_no "Update Installed Server" "This will update a server that is already installed here.\n\nIt WILL keep:\n- .env\n- SSL certificates\n- data/chat-signal offline messages\n- server policies\n- self-destruct sync records\n- Docker volumes\n\nIt WILL rebuild containers from the current files and recreate them.\n\nContinue?"; then
            return
        fi
    fi

    print_header
    step_log "Updating installed server without deleting persistent data..."
    backup_server_state

    step_log "Stopping containers without removing volumes..."
    compose_cmd down --remove-orphans || true

    step_log "Rebuilding images with latest local files..."
    compose_cmd build --pull

    step_log "Starting updated containers..."
    compose_cmd up -d --force-recreate

    wait_for_chat_health "$APP_URL" 20 || true

    ok_log "Server update completed without deleting persistent data."
    printf "${DIM}Application:     %s${NC}\n" "$APP_URL"
    printf "${DIM}Monitor Server: %s${NC}\n" "$MONITOR_URL"
    if [[ "$assume_yes" == "true" ]]; then
        printf "${SUCCESS}Update complete. Persistent data was preserved. Backup directory: %s/backups${NC}\n" "$ROOT"
    else
        final_msg_box "Update Complete" "Server update completed.\n\nPreserved:\n.env, certificates, Docker volumes, chat data, offline messages, server policies, and self-destruct sync records.\n\nA backup was written under backups/.\n\nApplication Server:\n$APP_URL\n\nMonitor Server:\n$MONITOR_URL"
    fi
    exit 0
}

main() {
    if [[ "${1:-}" == "--update-server" || "${1:-}" == "update-server" ]]; then
        update_installed_server true "${2:-}"
    fi
    if [[ "${1:-}" == "--update-server-local" ]]; then
        update_installed_server true
    fi

    if [[ "$QUICK_INSTALL" == "true" ]]; then
        quick_install
        exit $?
    fi

    whiptail --backtitle "$BACKTITLE" --title "P00RIJA Setup" --msgbox "Welcome to the P00RIJA Cryptography Setup Wizard.\n\nUse this panel to configure a fresh deployment, update an existing server without data loss, rebuild containers with your latest code changes, or reset the environment." 13 76

    ENV_CHOICE=$(choice_menu "Deployment Manager" "Choose an action:")

    DOMAIN="localhost"
    EXT_IP="127.0.0.1"

    # The public port for the web app and relay: 8585 by default, ask anyway —
    # a host that already owns the port (or a firewall with other plans) gets a
    # say before the first container starts.
    while true; do
        APP_PORT=$(input_box "Application Port" "Port for the web app and relay (default 8585):" "8585")
        if [[ "$APP_PORT" =~ ^[0-9]+$ ]] && [ "$APP_PORT" -ge 1 ] && [ "$APP_PORT" -le 65535 ]; then
            break
        fi
        msg_box "Invalid Port" "Enter a number between 1 and 65535."
    done

    case "$ENV_CHOICE" in
        "1") # Local
            DOMAIN="localhost"
            EXT_IP="127.0.0.1"
            if ! offer_existing_cert "localhost" "Do you already have an SSL certificate and key for this machine?"; then
                msg_box "Local Setup" "Generating a self-signed certificate for localhost and every address this machine has on its networks. It is made again automatically before it runs out."
                CERT_MODE="self-signed"
                generate_self_signed "localhost" "$(default_sans localhost)"
            fi
            ;;
        "2") # Domain
            DOMAIN=$(input_box "Domain Setup" "Enter your domain name (e.g., example.com):" "example.com")
            
            echo -e "${INFO}Resolving IP for $DOMAIN...${NC}"
            EXT_IP=$(resolve_domain_ip "$DOMAIN")
            
            if [[ -z "$EXT_IP" ]]; then
                EXT_IP=$(input_box "IP Verification" "Could not automatically resolve IP for $DOMAIN. Please enter your server's public IP address:" "1.2.3.4")
            else
                if ! whiptail --title "IP Verification" --yesno "Automatically resolved IP for $DOMAIN as: $EXT_IP\n\nIs this correct?" 10 60; then
                    EXT_IP=$(input_box "IP Setup" "Enter the correct public IP address:" "$EXT_IP")
                fi
            fi
            
            if ! offer_existing_cert "$DOMAIN" "Do you already have a certificate for $DOMAIN?\n\n3X-UI, for one, keeps it in /root/cert/$DOMAIN/. It is served from where it is, so both use the same one."; then
                CERT_METHOD=$(whiptail --backtitle "$BACKTITLE" --title "SSL Certificate" --menu "How should $DOMAIN get its certificate?" 15 80 2 \
                    "1" "Let's Encrypt: free, trusted, renewed 10 days before expiry" \
                    "2" "Self-signed: browsers warn once" \
                    3>&1 1>&2 2>&3) || CERT_METHOD="2"
                if [[ "$CERT_METHOD" == "1" ]]; then
                    use_letsencrypt "$DOMAIN"
                else
                    CERT_MODE="self-signed"
                    generate_self_signed "$DOMAIN" "$(default_sans "$DOMAIN")"
                fi
            fi
            ;;
        "3") # Public IP
            echo -e "${INFO}Detecting Public IP...${NC}"
            DETECTED_IP=$(get_public_ip)
            if [[ -n "$DETECTED_IP" ]]; then
                if whiptail --title "IP Detection" --yesno "Detected your public IP as: $DETECTED_IP\n\nUse this IP?" 10 60; then
                    EXT_IP="$DETECTED_IP"
                else
                    EXT_IP=$(input_box "IP Setup" "Enter your public IP address:" "$DETECTED_IP")
                fi
            else
                EXT_IP=$(input_box "IP Setup" "Enter your public IP address:" "1.2.3.4")
            fi
            DOMAIN="$EXT_IP"
            if ! offer_existing_cert "$EXT_IP" "Do you already have a certificate for $EXT_IP?"; then
                CERT_METHOD="2"
                if cert_publicly_certifiable "$EXT_IP"; then
                    CERT_METHOD=$(whiptail --backtitle "$BACKTITLE" --title "SSL Certificate" --menu "How should $EXT_IP get its certificate?" 16 80 2 \
                        "1" "Let's Encrypt for the address: 6-day certificates, renewed for you" \
                        "2" "Self-signed: browsers warn once" \
                        3>&1 1>&2 2>&3) || CERT_METHOD="2"
                fi
                if [[ "$CERT_METHOD" == "1" ]]; then
                    msg_box "Let's Encrypt for an Address" "Let's Encrypt certifies an IP address for six days at a time; the renewer renews it with two days left. Port 80 on $EXT_IP must reach this server for that."
                    use_letsencrypt "$EXT_IP"
                else
                    CERT_MODE="self-signed"
                    generate_self_signed "$EXT_IP" "$(default_sans "$EXT_IP")"
                fi
            fi
            ;;
        "4") # Update installed server
            update_installed_server
            exit 0
            ;;
        "5") # Rebuild containers only
            rebuild_containers_only
            exit 0
            ;;
        "6") # Factory Reset
            factory_reset
            exit 0
            ;;
        *)
            echo "Setup cancelled."
            exit 0
            ;;
    esac

    MONITOR_PASS=$(password_box "Security Setup" "Enter a strong password for the Monitoring Dashboard (minimum 12 characters, no spaces, no dollar sign):")
    if [[ ${#MONITOR_PASS} -lt 12 ]]; then
        msg_box "Weak Password" "Monitoring Dashboard password must be at least 12 characters. Setup cancelled."
        exit 1
    fi
    validate_env_value "Monitoring password" "$MONITOR_PASS" || exit 1
    TURN_PASS=$(generate_secret)
    validate_env_value "TURN password" "$TURN_PASS" || exit 1

    write_env_file

    build_display_urls

    msg_box "Configuration Complete" "Environment: $DOMAIN\nIP: $EXT_IP\n\nApplication:\n$APP_URL\n\nMonitor Server:\n$MONITOR_URL\n\nConfiguration has been saved to .env."

    if yes_no "Deploy" "Would you like to build and start the Docker containers now?" ; then
        print_header
        step_log "Building and starting containers..."
        compose_cmd down || true
        compose_cmd up -d --build
        ok_log "Deployment successful."
        echo -e "${INFO}Application: $APP_URL${NC}"
        echo -e "${INFO}Monitor Server: $MONITOR_URL${NC}"
        final_msg_box "Success" "Deployment successful.\n\nApplication Server:\n$APP_URL\n\nMonitor Server:\n$MONITOR_URL\n\nKeep these URLs for the client app relay/TURN settings and server monitoring."
    else
        echo -e "${INFO}Setup finished. You can start the application later using 'docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d'${NC}"
        echo -e "${INFO}Application: $APP_URL${NC}"
        echo -e "${INFO}Monitor Server: $MONITOR_URL${NC}"
        final_msg_box "Setup Complete" "Setup finished.\n\nApplication Server:\n$APP_URL\n\nMonitor Server:\n$MONITOR_URL\n\nStart later with:\ndocker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d"
    fi
}

# ---------------------------------------------------------------------------
# Unattended install
#
# Reuses the wizard's own functions rather than reimplementing them, so the two
# paths cannot drift: same .env writer, same certificate generator, same compose
# invocation, same health wait.
# ---------------------------------------------------------------------------
quick_install() {
    print_header
    step_log "Unattended install"

    if [[ -n "$QUICK_DOMAIN" ]]; then
        DOMAIN="$QUICK_DOMAIN"
        EXT_IP="$(resolve_domain_ip "$DOMAIN" || true)"
        if [[ -z "$EXT_IP" ]]; then
            # Falling back to this machine's public address is a guess, and a
            # confident wrong EXTERNAL_IP is worse than an obvious one: it ends
            # up in .env, in the certificate SANs and in the URLs printed at the
            # end. Say so rather than pretending the lookup worked.
            EXT_IP="$(get_public_ip || true)"
            if [[ -n "$EXT_IP" ]]; then
                warn_log "$DOMAIN did not resolve. Using this machine's public address ($EXT_IP)."
                warn_log "If that is wrong, fix EXTERNAL_IP in .env and re-run with --quick."
            fi
        fi
        [[ -z "$EXT_IP" ]] && EXT_IP="127.0.0.1"
    else
        DOMAIN="localhost"
        EXT_IP="127.0.0.1"
    fi
    ok_log "Host: $DOMAIN  ($EXT_IP)"

    # A password nobody chose is better than a default everybody knows. It is
    # printed once at the end and written only to .env.
    if [[ -z "$QUICK_MONITOR_PASS" ]]; then
        QUICK_MONITOR_PASS="$(generate_secret)"
        warn_log "No --password given; one was generated and is shown at the end."
    fi
    if [[ ${#QUICK_MONITOR_PASS} -lt 12 ]]; then
        echo "The monitor password must be at least 12 characters." >&2
        exit 1
    fi
    validate_env_value "Monitoring password" "$QUICK_MONITOR_PASS" || exit 1
    MONITOR_PASS="$QUICK_MONITOR_PASS"
    TURN_PASS="$(generate_secret)"
    validate_env_value "TURN password" "$TURN_PASS" || exit 1

    # Let's Encrypt for anything it can certify — a public name or a public
    # address — unless --self-signed says otherwise; self-signed for the rest.
    local want="$QUICK_CERT"
    if [[ -z "$want" ]]; then
        want="self-signed"
        cert_publicly_certifiable "$DOMAIN" && want="letsencrypt"
    fi
    if [[ "$want" == "letsencrypt" ]] && ! cert_publicly_certifiable "$DOMAIN"; then
        echo "Let's Encrypt cannot certify $DOMAIN: it is not a public name or address." >&2
        exit 1
    fi
    CERTBOT_EMAIL="$QUICK_EMAIL"
    validate_env_value "Email" "$CERTBOT_EMAIL" || exit 1
    if [[ -n "$QUICK_CERT_DIR" ]]; then
        if ! cert_find_pair "${QUICK_CERT_DIR%/}" "$DOMAIN"; then
            echo "$CERT_PAIR_REASON" >&2
            exit 1
        fi
        CERTS_DIR_SETTING="${QUICK_CERT_DIR%/}"
        CERT_FILE="$CERT_PAIR_CERT"
        KEY_FILE="$CERT_PAIR_KEY"
        # Renewed here only when asked to; otherwise its owner renews it.
        CERT_MODE="existing"
        [[ "$QUICK_CERT" == "letsencrypt" ]] && CERT_MODE="letsencrypt"
        ok_log "Serving $CERT_FILE from $CERTS_DIR_SETTING ($CERT_MODE; expires $CERT_PAIR_END)"
        [[ "$CERT_PAIR_COVERS" == "no" ]] && warn_log "That certificate does not name $DOMAIN."
    elif [[ -s "$ROOT/certs/cert.pem" && -s "$ROOT/certs/key.pem" ]]; then
        ok_log "Existing certificate kept."
        CERT_MODE="$want"
    elif [[ "$want" == "letsencrypt" ]]; then
        step_log "Let's Encrypt: the renewer asks for $DOMAIN's certificate as the stack starts"
        CERT_MODE="letsencrypt"
        generate_self_signed "$DOMAIN" "$(default_sans "$DOMAIN")"
    else
        step_log "Generating a self-signed certificate"
        CERT_MODE="self-signed"
        generate_self_signed "$DOMAIN" "$(default_sans "$DOMAIN")"
    fi
    validate_env_value "Certificate folder" "$CERTS_DIR_SETTING" || exit 1

    write_env_file
    build_display_urls
    ok_log "Wrote .env; nginx reads the domain from it at start-up"

    if [[ "$QUICK_START" != "true" ]]; then
        ok_log "Configured but not started (--no-start)."
        echo "Start it with: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d --build"
        return 0
    fi

    step_log "Building and starting the containers"
    compose_cmd down || true
    compose_cmd up -d --build || { echo "The containers failed to start." >&2; return 1; }

    if wait_for_chat_health; then
        ok_log "The relay answered its health check."
    else
        warn_log "The containers are up but the relay has not answered yet; check 'docker compose logs'."
    fi

    printf '\n'
    ok_log "Installed."
    if [[ -z "${QUICK_PEERS:-}" ]]; then
        echo
        echo "  This relay carries for nobody, which is the default. To let it carry"
        echo "  for another deployment of this application, once both are running:"
        echo "      bash scripts/link-relays.sh <this one> <the other>"
        echo "  People on either one can then write to and call people on the other."
    fi
    echo "  Application    : $APP_URL"
    echo "  Monitor        : $MONITOR_URL"
    # Not echoed: terminal scrollback, CI logs and screen shares all read it,
    # and .env holds the only copy the operator actually needs. The quick
    # mode already knows what it typed; interactive mode chose it.
    echo "  Monitor password: in .env (chmod 600) — shown nowhere else."
    echo
    echo "  Keep .env private. It is the only copy of the password."
    return 0
}

main "$@"
