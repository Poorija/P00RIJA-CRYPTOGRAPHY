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
QUICK_CERT="self-signed"
QUICK_START=true
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
    local allowed_origins="https://$DOMAIN:$port,https://$DOMAIN"
    if [[ "$DOMAIN" == "localhost" ]]; then
        allowed_origins="https://localhost:$port,http://localhost:$port,https://127.0.0.1:$port,http://127.0.0.1:$port"
    elif [[ "$DOMAIN" == "$EXT_IP" ]]; then
        allowed_origins="https://$EXT_IP:$port,http://$EXT_IP:$port"
    fi

    cat > "$ROOT/.env" <<EOF
DOMAIN=$DOMAIN
EXTERNAL_IP=$EXT_IP
APP_PORT=${APP_PORT:-8585}
SSL_CERT_PATH=$ROOT/certs/cert.pem
SSL_KEY_PATH=$ROOT/certs/key.pem
MONITOR_PASSWORD=$MONITOR_PASS
TURN_PASSWORD=$TURN_PASS
CHAT_ALLOWED_ORIGINS=$allowed_origins
EOF
}

set_nginx_server_name() {
    local server_name="$1"
    local nginx_conf="$ROOT/config/nginx.conf"
    local tmp_conf

    if [[ ! -f "$nginx_conf" ]]; then
        warn_log "Nginx config not found: $nginx_conf"
        return 0
    fi

    tmp_conf="$(mktemp)"
    awk -v name="$server_name" '
        /^[[:space:]]*server_name[[:space:]]+/ {
            sub(/server_name[[:space:]][^;]*;/, "server_name " name ";")
        }
        { print }
    ' "$nginx_conf" > "$tmp_conf"
    cat "$tmp_conf" > "$nginx_conf"
    rm -f "$tmp_conf"
}

# The CSP's connect-src names this deployment's own origins. A self-hosted
# install has a different domain, so the committed policy has to be rewritten
# the same way server_name is — otherwise every self-hoster would ship a policy
# pointing at chat.example.com and their own relay would be blocked.
set_nginx_csp_origins() {
    local server_name="$1"
    local port="${2:-8585}"
    local nginx_conf="$ROOT/config/nginx.conf"

    [[ -f "$nginx_conf" ]] || return 0
    # An IP address or "localhost" gets the same treatment; what matters is that
    # the origins in the policy are the ones the browser will actually talk to.
    local tmp_conf
    tmp_conf="$(mktemp)"
    sed -E "s#https://[^ ]+:[0-9]+ wss://[^ ]+:[0-9]+#https://${server_name}:${port} wss://${server_name}:${port}#" \
        "$nginx_conf" > "$tmp_conf"
    cat "$tmp_conf" > "$nginx_conf"
    rm -f "$tmp_conf"
}

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

generate_self_signed() {
    local cn="$1"
    local sans="$2"
    local cert_dir="$ROOT/certs"
    mkdir -p "$cert_dir"
    
    local tmp_conf
    tmp_conf="$(mktemp)"

    cat > "$tmp_conf" <<EOF
[req]
default_bits = 4096
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = $cn
O = P00RIJA Cryptography

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = $sans
EOF

    openssl req -x509 -nodes -newkey rsa:4096 \
        -days 825 \
        -keyout "$cert_dir/key.pem" \
        -out "$cert_dir/cert.pem" \
        -config "$tmp_conf"
    
    rm -f "$tmp_conf"
    chmod 644 "$cert_dir/cert.pem"
    chmod 600 "$cert_dir/key.pem"
}

handle_existing_certs() {
    local input_path
    local cert_file=""
    local key_file=""
    
    input_path=$(input_box "SSL Configuration" "Enter the path to your certificate file OR the directory containing them:" "")
    
    if [[ -z "$input_path" ]]; then
        return 1
    fi

    if [[ -d "$input_path" ]]; then
        # It's a directory, try to auto-detect
        for f in "fullchain.pem" "cert.pem" "ssl.crt" "server.crt"; do
            if [[ -f "$input_path/$f" ]]; then
                cert_file="$input_path/$f"
                break
            fi
        done
        for f in "privkey.pem" "key.pem" "ssl.key" "server.key"; do
            if [[ -f "$input_path/$f" ]]; then
                key_file="$input_path/$f"
                break
            fi
        done
        
        if [[ -n "$cert_file" && -n "$key_file" ]]; then
            msg_box "Auto-Detected" "Found certificates in directory:\nCert: $(basename "$cert_file")\nKey: $(basename "$key_file")"
        else
            msg_box "Error" "Could not auto-detect both certificate and key in: $input_path\nLooking for fullchain.pem/cert.pem and privkey.pem/key.pem"
            return 1
        fi
    elif [[ -f "$input_path" ]]; then
        cert_file="$input_path"
        key_file=$(input_box "Private Key" "Enter the path to your private key file:" "$(dirname "$cert_file")/privkey.pem")
        if [[ ! -f "$key_file" ]]; then
            msg_box "Error" "Key file not found at: $key_file"
            return 1
        fi
    else
        msg_box "Error" "Path not found: $input_path"
        return 1
    fi
    
    mkdir -p "$ROOT/certs"
    cp "$cert_file" "$ROOT/certs/cert.pem"
    cp "$key_file" "$ROOT/certs/key.pem"
    chmod 644 "$ROOT/certs/cert.pem"
    chmod 600 "$ROOT/certs/key.pem"
    return 0
}

factory_reset() {
    if ! whiptail --backtitle "$BACKTITLE" --title "FACTORY RESET" --yesno "WARNING: This will perform the following actions:\n\n1. Stop and remove all Docker containers and volumes.\n2. Delete the .env file.\n3. Clear all certificates in the certs/ directory.\n4. Reset config/nginx.conf server_name to the default wildcard (_).\n\nAre you sure you want to proceed?" 16 72; then
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
    
    set_nginx_server_name "_"

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
            if yes_no "SSL Certificate" "Do you already have an SSL certificate and key for this setup?" ; then
                while ! handle_existing_certs; do :; done
            else
                msg_box "Local Setup" "Generating self-signed certificates for local access."
                IPS=$(detect_ips)
                SANS="DNS:localhost,IP:127.0.0.1"
                for ip in $IPS; do
                    SANS="$SANS,IP:$ip"
                done
                generate_self_signed "localhost" "$SANS"
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
            
            CERT_METHOD=$(whiptail --title "SSL Certificate" --menu "How would you like to handle SSL for $DOMAIN?" 15 60 3 \
                "1" "Use existing certificates (folder or file)" \
                "2" "Get new certificate with Let's Encrypt" \
                "3" "Generate self-signed certificate" \
                3>&1 1>&2 2>&3)

            case "$CERT_METHOD" in
                "1")
                    while ! handle_existing_certs; do :; done
                    ;;
                "2")
                    EMAIL=$(input_box "Let's Encrypt" "Enter your email for Let's Encrypt:" "admin@$DOMAIN")
                    echo -e "${INFO}Running Certbot...${NC}"
                    if command -v certbot >/dev/null 2>&1; then
                        certbot certonly --standalone --agree-tos --non-interactive -m "$EMAIL" -d "$DOMAIN" --cert-name "poorija-$DOMAIN"
                        CERT_PATH="/etc/letsencrypt/live/poorija-$DOMAIN/fullchain.pem"
                        KEY_PATH="/etc/letsencrypt/live/poorija-$DOMAIN/privkey.pem"
                        mkdir -p "$ROOT/certs"
                        cp "$CERT_PATH" "$ROOT/certs/cert.pem"
                        cp "$KEY_PATH" "$ROOT/certs/key.pem"
                        chmod 644 "$ROOT/certs/cert.pem"
                        chmod 600 "$ROOT/certs/key.pem"
                    else
                        msg_box "Error" "Certbot not found. Please install certbot or use self-signed certificates."
                        exit 1
                    fi
                    ;;
                "3")
                    msg_box "Self-Signed Domain" "Generating self-signed certificate for $DOMAIN"
                    generate_self_signed "$DOMAIN" "DNS:$DOMAIN,IP:$EXT_IP"
                    ;;
            esac
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
            if yes_no "SSL Certificate" "Do you already have an SSL certificate and key for this IP?" ; then
                while ! handle_existing_certs; do :; done
            else
                msg_box "IP Setup" "Generating self-signed certificate for IP: $EXT_IP"
                generate_self_signed "$EXT_IP" "IP:$EXT_IP"
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

    # The port matters as much as the domain: an origin is scheme + host +
    # PORT, so a deployment on anything other than 8585 was handed a policy
    # naming a port it does not listen on, and the browser then blocked the
    # relay this very function exists to keep reachable. APP_PORT is what the
    # installer asked for.
    set_nginx_csp_origins "$DOMAIN" "${APP_PORT:-8585}"
    set_nginx_server_name "$DOMAIN"

    build_display_urls

    msg_box "Configuration Complete" "Environment: $DOMAIN\nIP: $EXT_IP\n\nApplication:\n$APP_URL\n\nMonitor Server:\n$MONITOR_URL\n\nConfiguration has been saved to .env and config/nginx.conf."

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
# paths cannot drift: same .env writer, same certificate generator, same nginx
# rewrite, same compose invocation, same health wait.
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

    if [[ -s "$ROOT/certs/cert.pem" && -s "$ROOT/certs/key.pem" ]]; then
        ok_log "Existing certificate kept."
    elif [[ "$QUICK_CERT" == "letsencrypt" ]]; then
        [[ -z "$QUICK_EMAIL" ]] && { echo "--letsencrypt needs --email." >&2; exit 1; }
        command -v certbot >/dev/null 2>&1 || { echo "certbot is not installed." >&2; exit 1; }
        step_log "Requesting a certificate for $DOMAIN"
        certbot certonly --standalone --agree-tos --non-interactive -m "$QUICK_EMAIL" -d "$DOMAIN" --cert-name "poorija-$DOMAIN"
        mkdir -p "$ROOT/certs"
        cp "/etc/letsencrypt/live/poorija-$DOMAIN/fullchain.pem" "$ROOT/certs/cert.pem"
        cp "/etc/letsencrypt/live/poorija-$DOMAIN/privkey.pem" "$ROOT/certs/key.pem"
        chmod 644 "$ROOT/certs/cert.pem"; chmod 600 "$ROOT/certs/key.pem"
    else
        step_log "Generating a self-signed certificate"
        local sans="DNS:$DOMAIN"
        [[ "$DOMAIN" == "localhost" ]] && sans="DNS:localhost,IP:127.0.0.1"
        [[ "$DOMAIN" == "$EXT_IP" ]] && sans="IP:$EXT_IP"
        [[ "$DOMAIN" != "localhost" && "$DOMAIN" != "$EXT_IP" ]] && sans="DNS:$DOMAIN,IP:$EXT_IP"
        generate_self_signed "$DOMAIN" "$sans"
    fi

    write_env_file
    set_nginx_server_name "$DOMAIN"
    build_display_urls
    ok_log "Wrote .env and config/nginx.conf"

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
    echo "  Application    : $APP_URL"
    echo "  Monitor        : $MONITOR_URL"
    echo "  Monitor password: $MONITOR_PASS"
    echo
    echo "  The password is also in .env. Keep that file private — it is the only copy."
    return 0
}

main "$@"
