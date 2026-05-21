#!/usr/bin/env bash
# P00RIJA Cryptography Setup Wizard
# This script configures the environment, certificates, and starts Docker containers.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="$ROOT/config/docker-compose.yaml"
ENV_FILE="$ROOT/.env"
BACKTITLE="P00RIJA Cryptography • Setup & Docker Manager"

# Ensure whiptail is available
if ! command -v whiptail >/dev/null 2>&1; then
    echo "Error: whiptail is not installed. Please install it for the graphical wizard."
    exit 1
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
        "4" "Rebuild containers only / keep current settings" \
        "5" "Factory reset / clear all settings and volumes" \
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

require_existing_config() {
    if [[ ! -f "$ENV_FILE" ]]; then
        msg_box "Missing Configuration" "No .env file was found.\n\nRun Local, Domain, or Public IP setup once before using the container-only rebuild option."
        return 1
    fi
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        msg_box "Missing Docker Compose File" "Docker Compose file was not found:\n$COMPOSE_FILE"
        return 1
    fi
    if ! command -v docker >/dev/null 2>&1; then
        msg_box "Docker Not Found" "Docker is not installed or is not available in PATH."
        return 1
    fi
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
    APP_URL="https://$DISPLAY_HOST:8585"
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
    local allowed_origins="https://$DOMAIN:8585,https://$DOMAIN"
    if [[ "$DOMAIN" == "localhost" ]]; then
        allowed_origins="https://localhost:8585,http://localhost:8585,https://127.0.0.1:8585,http://127.0.0.1:8585"
    elif [[ "$DOMAIN" == "$EXT_IP" ]]; then
        allowed_origins="https://$EXT_IP:8585,http://$EXT_IP:8585"
    fi

    cat > "$ROOT/.env" <<EOF
DOMAIN=$DOMAIN
EXTERNAL_IP=$EXT_IP
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

resolve_domain_ip() {
    local domain="$1"
    local resolved=""
    
    if command -v dig >/dev/null 2>&1; then
        resolved=$(dig +short "$domain" | tail -n1)
    fi
    
    if [[ -z "$resolved" ]]; then
        resolved=$(getent hosts "$domain" | awk '{ print $1 }' | head -n1)
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

main() {
    whiptail --backtitle "$BACKTITLE" --title "P00RIJA Setup" --msgbox "Welcome to the P00RIJA Cryptography Setup Wizard.\n\nUse this panel to configure a fresh deployment, rebuild containers with your latest code changes, or reset the environment." 12 76

    ENV_CHOICE=$(choice_menu "Deployment Manager" "Choose an action:")

    DOMAIN="localhost"
    EXT_IP="127.0.0.1"

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
        "4") # Rebuild containers only
            rebuild_containers_only
            exit 0
            ;;
        "5") # Factory Reset
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

main "$@"
