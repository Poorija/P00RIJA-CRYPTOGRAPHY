#!/usr/bin/env bash
# P00RIJA Cryptography Native Build Wizard
# This script provides a graphical interface for building native applications
# with cross-compilation support and target validation.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKTITLE="P00RIJA Cryptography • Native Build Wizard"

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
NC='\033[0m'

msg_box() {
    whiptail --backtitle "$BACKTITLE" --title "$1" --msgbox "$2" 12 72
}

choice_menu() {
    local title="$1"
    local prompt="$2"
    shift 2
    whiptail --backtitle "$BACKTITLE" --title "$title" --menu "$prompt" 18 78 10 "$@" 3>&1 1>&2 2>&3
}

yes_no() {
    whiptail --backtitle "$BACKTITLE" --title "$1" --yesno "$2" 11 72
}

check_rust_target() {
    local target="$1"
    if ! rustup target list --installed | grep -q "$target"; then
        if yes_no "Missing Rust Target" "The required Rust target '$target' is not installed.\n\nWould you like to install it now using:\nrustup target add $target"; then
            printf "${INFO}▶ Installing Rust target: %s...${NC}\n" "$target"
            rustup target add "$target"
            return 0
        else
            return 1
        fi
    fi
    return 0
}

main() {
    # 1. Select Build Target (Client or Server/Monitor)
    TARGET_TYPE=$(choice_menu "Build Target" "Choose what you want to build:" \
        "native" "P00RIJA Cryptography Client" \
        "monitor" "P00RIJA Monitor Server")

    [ -z "$TARGET_TYPE" ] && exit 0

    # 2. Select Operating System
    OS_TYPE=$(choice_menu "Operating System" "Choose the target operating system:" \
        "linux" "Linux (Debian, RPM, AppImage)" \
        "mac" "macOS (App, DMG)" \
        "windows" "Windows (NSIS, MSI)")

    [ -z "$OS_TYPE" ] && exit 0

    # 3. Select Architecture
    RUST_TARGET=""
    case "$OS_TYPE" in
        "linux")
            ARCH=$(choice_menu "Architecture" "Choose the target architecture for Linux:" \
                "x86_64" "Intel/AMD 64-bit (Standard PC)" \
                "arm64" "ARM 64-bit (Raspberry Pi, Cloud ARM)" \
                "default" "Host Default (Current System)")
            [ "$ARCH" == "x86_64" ] && RUST_TARGET="x86_64-unknown-linux-gnu"
            [ "$ARCH" == "arm64" ] && RUST_TARGET="aarch64-unknown-linux-gnu"
            ;;
        "mac")
            ARCH=$(choice_menu "Architecture" "Choose the target architecture for macOS:" \
                "arm64" "Apple Silicon (M1, M2, M3)" \
                "x86_64" "Intel Mac" \
                "universal" "Universal (Intel + Apple Silicon)" \
                "default" "Host Default (Current System)")
            [ "$ARCH" == "arm64" ] && RUST_TARGET="aarch64-apple-darwin"
            [ "$ARCH" == "x86_64" ] && RUST_TARGET="x86_64-apple-darwin"
            [ "$ARCH" == "universal" ] && RUST_TARGET="universal-apple-darwin" # Handled specially by Tauri
            ;;
        "windows")
            ARCH=$(choice_menu "Architecture" "Choose the target architecture for Windows:" \
                "x86_64" "Intel/AMD 64-bit (Standard PC)" \
                "arm64" "ARM 64-bit (Surface Pro X, etc.)" \
                "default" "Host Default (Current System)")
            [ "$ARCH" == "x86_64" ] && RUST_TARGET="x86_64-pc-windows-msvc"
            [ "$ARCH" == "arm64" ] && RUST_TARGET="aarch64-pc-windows-msvc"
            ;;
    esac

    [ -z "$ARCH" ] && exit 0

    # Check Rust Target if specific one was selected (and not universal/default)
    if [ -n "$RUST_TARGET" ] && [ "$RUST_TARGET" != "universal-apple-darwin" ]; then
        if ! check_rust_target "$RUST_TARGET"; then
            msg_box "Build Cancelled" "The required Rust target is missing. Please install it manually and try again."
            exit 1
        fi
    elif [ "$RUST_TARGET" == "universal-apple-darwin" ]; then
        if ! check_rust_target "aarch64-apple-darwin" || ! check_rust_target "x86_64-apple-darwin"; then
             msg_box "Build Cancelled" "Universal builds require both ARM64 and x86_64 macOS targets."
             exit 1
        fi
    fi

    # Construct the npm script name
    if [ "$ARCH" == "default" ]; then
        BUILD_SCRIPT="$TARGET_TYPE:build:$OS_TYPE"
    else
        BUILD_SCRIPT="$TARGET_TYPE:build:$OS_TYPE:$ARCH"
    fi

    # Final Confirmation
    if yes_no "Confirm Build" "Target Script: npm run $BUILD_SCRIPT\nOS: $OS_TYPE\nArch: $ARCH\n\nMake sure all native SDKs (WebKitGTK, Xcode, or MSVC) are installed.\n\nProceed?"; then
        clear
        printf "${INFO}▶ Preparing build: npm run %s:prepare...${NC}\n" "$TARGET_TYPE"
        npm run "$TARGET_TYPE:prepare"
        
        printf "${INFO}▶ Starting build: npm run %s...${NC}\n" "$BUILD_SCRIPT"
        if npm run "$BUILD_SCRIPT"; then
            printf "\n${SUCCESS}✓ Build process finished successfully.${NC}\n"
            msg_box "Build Complete" "The build has finished. Check 'src-tauri/target/' for artifacts."
        else
            printf "\n${ERROR}✖ Build process failed.${NC}\n"
            msg_box "Build Failed" "The build process returned an error. Check the terminal output for details."
        fi
    else
        echo "Build cancelled."
    fi
}

main "$@"
