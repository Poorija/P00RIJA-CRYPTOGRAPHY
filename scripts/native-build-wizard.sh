#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# P00RIJA Cryptography — native build wizard.
#
# whiptail when it is there, a plain numbered menu when it is not. macOS has no
# whiptail out of the box, which used to make this script refuse to run on the
# one platform its macOS build targets exist for.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKTITLE="P00RIJA Cryptography • Native Build Wizard"

INFO='\033[1;34m'
SUCCESS='\033[1;32m'
WARN='\033[1;33m'
ERROR='\033[1;31m'
NC='\033[0m'

HAVE_WHIPTAIL=0
if command -v whiptail >/dev/null 2>&1; then
    HAVE_WHIPTAIL=1
fi

log_info() { printf "${INFO}▶ %s${NC}\n" "$1"; }
log_ok() { printf "${SUCCESS}✓ %s${NC}\n" "$1"; }
log_warn() { printf "${WARN}! %s${NC}\n" "$1"; }
log_error() { printf "${ERROR}✖ %s${NC}\n" "$1"; }

msg_box() {
    if [ "$HAVE_WHIPTAIL" -eq 1 ]; then
        whiptail --backtitle "$BACKTITLE" --title "$1" --msgbox "$2" 14 76
    else
        printf "\n== %s ==\n%b\n\n" "$1" "$2"
    fi
}

# choice_menu TITLE PROMPT tag1 label1 tag2 label2 ...
# Echoes the chosen tag, or nothing when the user cancels.
choice_menu() {
    local title="$1" prompt="$2"
    shift 2
    if [ "$HAVE_WHIPTAIL" -eq 1 ]; then
        whiptail --backtitle "$BACKTITLE" --title "$title" --menu "$prompt" 20 82 10 "$@" 3>&1 1>&2 2>&3 || true
        return 0
    fi

    local -a tags=() labels=()
    while [ "$#" -gt 1 ]; do
        tags+=("$1")
        labels+=("$2")
        shift 2
    done

    {
        printf "\n== %s ==\n%s\n\n" "$title" "$prompt"
        local index
        for index in "${!tags[@]}"; do
            printf "  %2d) %-22s %s\n" "$((index + 1))" "${tags[$index]}" "${labels[$index]}"
        done
        printf "   q) cancel\n\n"
    } >&2

    local reply
    read -r -p "Choice: " reply >&2 || true
    case "$reply" in
        q|Q|"") return 0 ;;
    esac
    if [[ "$reply" =~ ^[0-9]+$ ]] && [ "$reply" -ge 1 ] && [ "$reply" -le "${#tags[@]}" ]; then
        printf '%s' "${tags[$((reply - 1))]}"
    fi
}

yes_no() {
    if [ "$HAVE_WHIPTAIL" -eq 1 ]; then
        whiptail --backtitle "$BACKTITLE" --title "$1" --yesno "$2" 14 76
        return $?
    fi
    printf "\n== %s ==\n%b\n" "$1" "$2" >&2
    local reply
    read -r -p "Proceed? [y/N] " reply >&2 || true
    [[ "$reply" =~ ^[Yy] ]]
}

# `grep -q` matched substrings, so a check for aarch64-apple-ios was satisfied
# by aarch64-apple-ios-sim. -Fxq compares whole lines.
check_rust_target() {
    local target="$1"
    if rustup target list --installed 2>/dev/null | grep -Fxq "$target"; then
        return 0
    fi
    if yes_no "Missing Rust target" "The Rust target '$target' is not installed.\n\nInstall it now with:\n  rustup target add $target"; then
        log_info "Installing Rust target: $target"
        rustup target add "$target"
        return $?
    fi
    return 1
}

require_host_for() {
    local os_type="$1"
    local host
    host="$(uname -s)"
    case "$os_type" in
        mac)
            if [ "$host" != "Darwin" ]; then
                msg_box "Wrong host" "macOS bundles can only be produced on macOS: the .app, .dmg and code signing all need Apple tooling.\n\nThis host reports: $host"
                return 1
            fi
            ;;
        linux)
            if [ "$host" != "Linux" ]; then
                msg_box "Wrong host" "A local Linux build needs WebKitGTK, which exists only on Linux.\n\nOn this host ($host) choose the Docker option instead — it builds the same .deb, .rpm and AppImage inside a container."
                return 1
            fi
            ;;
        windows)
            case "$host" in
                MINGW*|MSYS*|CYGWIN*) ;;
                *)
                    msg_box "Wrong host" "Windows installers need the MSVC toolchain and WebView2, so they must be built on Windows.\n\nThis host reports: $host"
                    return 1
                    ;;
            esac
            ;;
    esac
    return 0
}

main() {
    local ACTION
    ACTION=$(choice_menu "Native build wizard" "Choose an action:" \
        "build" "Build the native client or the monitor" \
        "check" "System check and prerequisite install")
    [ -z "$ACTION" ] && exit 0

    if [ "$ACTION" == "check" ]; then
        clear
        bash "$ROOT/scripts/setup-auto.sh" || log_warn "The system check reported problems."
        echo
        read -r -p "Press Enter to return to the wizard..." _ || true
        exec bash "$0"
    fi

    local TARGET_TYPE
    TARGET_TYPE=$(choice_menu "Build target" "Choose what to build:" \
        "native" "P00RIJA Cryptography client" \
        "monitor" "P00RIJA Server Monitor" \
        "selfdestruct-server" "Self-destruct sync server (chat signal)")
    [ -z "$TARGET_TYPE" ] && exit 0

    if [ "$TARGET_TYPE" == "selfdestruct-server" ]; then
        local SERVER_MODE
        SERVER_MODE=$(choice_menu "Self-destruct sync server" "Build or start the server behind synced self-destruct limits:" \
            "docker" "Build/start with Docker Compose" \
            "native" "Install Node dependencies and run locally")
        [ -z "$SERVER_MODE" ] && exit 0

        if [ "$SERVER_MODE" == "docker" ]; then
            if yes_no "Confirm server build" "Builds and starts the chat-signal service:\n\n  /self-destruct/records\n  /self-destruct/records/:id/open\n  persistent /data/self-destruct-records.json\n\nRequires MONITOR_PASSWORD and TURN_PASSWORD in .env."; then
                clear
                log_info "Building and starting the self-destruct sync server…"
                docker compose -f "$ROOT/config/docker-compose.yaml" up -d --build chat-signal
                log_ok "The self-destruct endpoints are live on the chat-signal service."
            fi
        else
            if yes_no "Confirm local server" "Installs Node dependencies and runs scripts/server.js locally.\n\nSet MONITOR_PASSWORD and TURN_PASSWORD before exposing this server."; then
                clear
                npm install
                log_info "Starting the local self-destruct sync server…"
                node --expose-gc "$ROOT/scripts/server.js"
            fi
        fi
        exit 0
    fi

    local OS_TYPE
    OS_TYPE=$(choice_menu "Operating system" "Choose the target operating system:" \
        "mac" "macOS — .app and .dmg (needs a Mac host)" \
        "docker" "Linux via Docker — .deb, .rpm, AppImage (any host)" \
        "linux" "Linux locally (needs a Linux host)" \
        "windows" "Windows — NSIS and MSI (needs a Windows host)")
    [ -z "$OS_TYPE" ] && exit 0

    if [ "$OS_TYPE" != "docker" ]; then
        require_host_for "$OS_TYPE" || exit 1
    fi

    local ARCH RUST_TARGET=""
    case "$OS_TYPE" in
        linux|docker)
            ARCH=$(choice_menu "Architecture" "Choose the target architecture for Linux:" \
                "x86_64" "Intel/AMD 64-bit (standard PC)" \
                "arm64" "ARM 64-bit (Raspberry Pi, ARM cloud)" \
                "default" "Host default")
            [ "$ARCH" == "x86_64" ] && RUST_TARGET="x86_64-unknown-linux-gnu"
            [ "$ARCH" == "arm64" ] && RUST_TARGET="aarch64-unknown-linux-gnu"
            ;;
        mac)
            ARCH=$(choice_menu "Architecture" "Choose the target architecture for macOS:" \
                "arm64" "Apple Silicon (M1 and later)" \
                "x86_64" "Intel Mac" \
                "universal" "Universal (Intel + Apple Silicon)" \
                "default" "Host default")
            [ "$ARCH" == "arm64" ] && RUST_TARGET="aarch64-apple-darwin"
            [ "$ARCH" == "x86_64" ] && RUST_TARGET="x86_64-apple-darwin"
            [ "$ARCH" == "universal" ] && RUST_TARGET="universal-apple-darwin"
            ;;
        windows)
            ARCH=$(choice_menu "Architecture" "Choose the target architecture for Windows:" \
                "x86_64" "Intel/AMD 64-bit" \
                "arm64" "ARM 64-bit")
            [ "$ARCH" == "x86_64" ] && RUST_TARGET="x86_64-pc-windows-msvc"
            [ "$ARCH" == "arm64" ] && RUST_TARGET="aarch64-pc-windows-msvc"
            ;;
    esac
    [ -z "${ARCH:-}" ] && exit 0

    # Docker supplies its own toolchain, so a missing host target is irrelevant.
    if [ "$OS_TYPE" != "docker" ]; then
        if [ "$RUST_TARGET" == "universal-apple-darwin" ]; then
            if ! check_rust_target "aarch64-apple-darwin" || ! check_rust_target "x86_64-apple-darwin"; then
                msg_box "Build cancelled" "A universal build needs both the ARM64 and the x86_64 macOS targets."
                exit 1
            fi
        elif [ -n "$RUST_TARGET" ]; then
            if ! check_rust_target "$RUST_TARGET"; then
                msg_box "Build cancelled" "The Rust target is missing. Install it and try again."
                exit 1
            fi
        fi
    fi

    local OS_FOR_SCRIPT="$OS_TYPE"
    [ "$OS_TYPE" == "docker" ] && OS_FOR_SCRIPT="linux"

    local BUILD_SCRIPT
    if [ "$ARCH" == "default" ]; then
        BUILD_SCRIPT="$TARGET_TYPE:build:$OS_FOR_SCRIPT"
    else
        BUILD_SCRIPT="$TARGET_TYPE:build:$OS_FOR_SCRIPT:$ARCH"
    fi

    local METHOD="local system"
    [ "$OS_TYPE" == "docker" ] && METHOD="Docker container"

    if ! yes_no "Confirm build" "Script:  npm run $BUILD_SCRIPT\nOS:      $OS_TYPE\nArch:    $ARCH\nMethod:  $METHOD"; then
        echo "Build cancelled."
        exit 0
    fi

    clear
    local status=0
    if [ "$OS_TYPE" == "docker" ]; then
        log_info "Running the Docker-based Linux build…"
        bash "$ROOT/scripts/build-native-docker.sh" "npm run $BUILD_SCRIPT" || status=$?
    else
        log_info "Running: npm run $BUILD_SCRIPT"
        # tauri build runs the prepare step itself through beforeBuildCommand.
        npm run "$BUILD_SCRIPT" || status=$?
    fi

    # `set -e` used to abort the script here, so the failure branch below was
    # unreachable and every build reported success.
    if [ "$status" -eq 0 ]; then
        log_ok "Build finished."
        msg_box "Build complete" "Artifacts are under:\n  src-tauri/target/${RUST_TARGET:-<host>}/release/bundle/"
    else
        log_error "Build failed with status $status."
        msg_box "Build failed" "The build returned status $status. The terminal output above has the details."
        exit "$status"
    fi
}

main "$@"
