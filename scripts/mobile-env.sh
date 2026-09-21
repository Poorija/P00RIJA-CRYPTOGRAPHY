#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Shared environment for the Android and iOS builds. Source it, don't run it:
#
#   source scripts/mobile-env.sh
#
# DEVELOPER_DIR rather than `sudo xcode-select -s`: it points the Apple tools
# at the full Xcode for this shell only, which means the iOS build needs no
# administrator password and cannot disturb whatever the machine's global
# developer directory is set to.

if [ -d /Applications/Xcode.app/Contents/Developer ]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
    # DEVELOPER_DIR alone is not enough: the Tauri CLI spawns xcodebuild with
    # an environment of its own, and /usr/bin/xcodebuild is only a shim that
    # consults xcode-select — which on this machine still points at the
    # Command Line Tools. Putting Xcode's real binaries first on PATH means the
    # shim is never reached, and no `sudo xcode-select -s` is required.
    export PATH="/Applications/Xcode.app/Contents/Developer/usr/bin:$PATH"
fi

for candidate in \
    "$HOME/Library/Android/sdk" \
    /opt/homebrew/share/android-commandlinetools \
    /usr/local/share/android-commandlinetools; do
    if [ -d "$candidate" ]; then
        export ANDROID_HOME="$candidate"
        break
    fi
done

# Tauri reads NDK_HOME. Homebrew's android-ndk cask and the SDK manager's
# "side by side" layout put it in different places, so check both.
if [ -z "${NDK_HOME:-}" ]; then
    if [ -d "${ANDROID_HOME:-}/ndk" ] && [ -n "$(ls -1 "${ANDROID_HOME}/ndk" 2>/dev/null | head -1)" ]; then
        export NDK_HOME="${ANDROID_HOME}/ndk/$(ls -1 "${ANDROID_HOME}/ndk" | sort -V | tail -1)"
    elif [ -d /opt/homebrew/share/android-ndk ]; then
        export NDK_HOME=/opt/homebrew/share/android-ndk
    fi
fi

# The Android Gradle Plugin rejects JDK versions it has not been tested with,
# and this machine's default java is newer than any AGP release supports.
if [ -d /Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home ]; then
    export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
elif [ -x /usr/libexec/java_home ]; then
    export JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || /usr/libexec/java_home)"
fi

[ -n "${ANDROID_HOME:-}" ] && export PATH="$ANDROID_HOME/platform-tools:$PATH"
[ -n "${JAVA_HOME:-}" ] && export PATH="$JAVA_HOME/bin:$PATH"

printf 'DEVELOPER_DIR=%s\nANDROID_HOME=%s\nNDK_HOME=%s\nJAVA_HOME=%s\n' \
    "${DEVELOPER_DIR:-unset}" "${ANDROID_HOME:-unset}" "${NDK_HOME:-unset}" "${JAVA_HOME:-unset}"
