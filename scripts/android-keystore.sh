#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Creates the release signing key, once.
#
# Android identifies an app by its signing key, so a phone that already has
# this app installed will refuse an update signed with a different one. If this
# file is lost, the only way forward is a new application id and every existing
# install having to be removed by hand. Back the directory up somewhere that is
# not this machine.

set -euo pipefail
KEYDIR="${P00RIJA_ANDROID_KEYSTORE_DIR:-$HOME/.p00rija-android-signing}"
KEYSTORE="$KEYDIR/release.keystore"
PROPS="$KEYDIR/keystore.properties"

if [ -f "$KEYSTORE" ]; then
    echo "A keystore already exists at $KEYSTORE — refusing to overwrite it."
    echo "Delete it deliberately if you really mean to start over."
    exit 1
fi

mkdir -p "$KEYDIR"
chmod 700 "$KEYDIR"

# Generated here rather than typed: a 40-character random password is stronger
# than anything memorable, and it never has to be remembered because the build
# reads it from the properties file next to the key.
PASS="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40)"

keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -alias p00rija \
    -keyalg RSA -keysize 4096 \
    -validity 10950 \
    -storepass "$PASS" -keypass "$PASS" \
    -dname "CN=P00RIJA Cryptography, OU=P00RIJA, O=P00RIJA, C=IR"

umask 077
printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=p00rija\nkeyPassword=%s\n' \
    "$KEYSTORE" "$PASS" "$PASS" > "$PROPS"
chmod 600 "$PROPS" "$KEYSTORE"

echo
echo "Key:        $KEYSTORE"
echo "Passwords:  $PROPS  (mode 600)"
echo
keytool -list -v -keystore "$KEYSTORE" -storepass "$PASS" 2>/dev/null | grep -E "SHA256:" | head -1
echo
echo "Back up $KEYDIR. Losing it means never being able to update an installed app."
