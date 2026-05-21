#!/usr/bin/env bash
# P00RIJA Standalone Relay Setup
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

INFO='\033[1;34m'
SUCCESS='\033[1;32m'
WARN='\033[1;33m'
ERROR='\033[1;31m'
NC='\033[0m'

echo -e "${INFO}Starting Standalone Relay Setup...${NC}"

# Domain and IP
read -p "Enter Domain (e.g. relay.example.com) [localhost]: " DOMAIN
DOMAIN=${DOMAIN:-localhost}

read -p "Enter Public IP (Leave empty to auto-detect): " EXT_IP
if [[ -z "$EXT_IP" ]]; then
    echo "Auto-detecting public IP..."
    EXT_IP=$(curl -s --connect-timeout 5 https://api.ipify.org || \
             curl -s --connect-timeout 5 https://ifconfig.me || \
             curl -s --connect-timeout 5 https://icanhazip.com || \
             echo "127.0.0.1")
    EXT_IP=${EXT_IP:-127.0.0.1}
    echo -e "${INFO}Detected IP: $EXT_IP${NC}"
fi

read -sp "Enter Monitor Dashboard Password (minimum 12 characters): " MONITOR_PASS
echo ""
if [[ ${#MONITOR_PASS} -lt 12 ]]; then
    echo -e "${ERROR}Monitor password must be at least 12 characters.${NC}"
    exit 1
fi
TURN_PASS=$(openssl rand -base64 32 | tr -d '\n')
DISPLAY_HOST="${DOMAIN:-${EXT_IP:-localhost}}"
if [[ "$DISPLAY_HOST" == "localhost" ]]; then
    CHAT_ALLOWED_ORIGINS="http://localhost:9000,http://127.0.0.1:9000,http://localhost:8585,http://127.0.0.1:8585"
elif [[ "$DISPLAY_HOST" == "$EXT_IP" ]]; then
    CHAT_ALLOWED_ORIGINS="http://$EXT_IP:9000,http://$EXT_IP:8585,https://$EXT_IP:8585"
else
    CHAT_ALLOWED_ORIGINS="https://$DISPLAY_HOST,http://$DISPLAY_HOST:9000,https://$DISPLAY_HOST:8585"
fi

# Certs
mkdir -p "$ROOT/certs"
if [[ ! -f "$ROOT/certs/cert.pem" ]]; then
    echo -e "${WARN}No certificates found in certs/. Generating self-signed for now...${NC}"
    openssl req -x509 -nodes -newkey rsa:4096 -days 825 \
        -keyout "$ROOT/certs/key.pem" -out "$ROOT/certs/cert.pem" \
        -subj "/CN=$DOMAIN"
fi

# .env
cat > "$ROOT/.env" <<EOF
DOMAIN=$DOMAIN
EXTERNAL_IP=$EXT_IP
MONITOR_PASSWORD=$MONITOR_PASS
TURN_PASSWORD=$TURN_PASS
SSL_CERT_PATH=./certs/cert.pem
SSL_KEY_PATH=./certs/key.pem
CHAT_ALLOWED_ORIGINS=$CHAT_ALLOWED_ORIGINS
EOF

# Clear old config to ensure new password is used
mkdir -p "$ROOT/data"
rm -f "$ROOT/data/server-config.json"

echo -e "${SUCCESS}Setup complete. Starting Docker...${NC}"
docker compose up -d --build

echo -e "${INFO}Monitor Dashboard: http://$DISPLAY_HOST:9000/Monitor_Server${NC}"
