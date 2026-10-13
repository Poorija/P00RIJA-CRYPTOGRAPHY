#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# Finding the certificate in a folder someone already has — 3X-UI's
# /root/cert/<domain>/, certbot's live/<name>/, acme.sh's own — so the stack
# can serve it in place instead of keeping a copy of its own. Sourced by
# scripts/setup.sh.
#
# The folder is often root's and the installing account often is not, so a
# file it cannot read is read through `sudo -n` when that needs no password,
# or through a throwaway container — the account that runs this stack has
# docker, and docker reads what root reads. Nothing is copied anywhere but a
# private temporary directory, which is removed before the function returns.

# cert_peek <file> <copy to>: a readable copy of a file this account may not
# be able to read.
cert_peek() {
    local file="$1" out="$2"
    if [[ -r "$file" ]]; then
        cat "$file" > "$out" 2>/dev/null && return 0
    fi
    if sudo -n true 2>/dev/null; then
        sudo -n cat "$file" > "$out" 2>/dev/null && return 0
    fi
    if command -v docker >/dev/null 2>&1; then
        docker run --rm --network none -v "$(dirname "$file")":/c:ro alpine:3 \
            cat "/c/$(basename "$file")" > "$out" 2>/dev/null && return 0
    fi
    return 1
}

# cert_list <folder>: the names of the files in it, one per line.
cert_list() {
    local dir="$1"
    if [[ -r "$dir" && -x "$dir" ]]; then
        (cd "$dir" && for f in *; do if [[ -f "$f" ]]; then printf '%s\n' "$f"; fi; done)
        return 0
    fi
    if sudo -n true 2>/dev/null; then
        sudo -n find "$dir" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null && return 0
    fi
    if command -v docker >/dev/null 2>&1; then
        docker run --rm --network none -v "$dir":/c:ro alpine:3 \
            find /c -maxdepth 1 -type f -exec basename {} \; 2>/dev/null && return 0
    fi
    return 1
}

# cert_folder_exists <folder>: true for a folder, even one this account
# cannot look inside.
cert_folder_exists() {
    local dir="$1"
    [[ -d "$dir" ]] && return 0
    sudo -n test -d "$dir" 2>/dev/null && return 0
    command -v docker >/dev/null 2>&1 \
        && docker run --rm --network none -v "$(dirname "$dir")":/p:ro alpine:3 test -d "/p/$(basename "$dir")" 2>/dev/null
}

_cert_pubkey_digest() {
    openssl x509 -noout -pubkey -in "$1" 2>/dev/null | openssl sha256 2>/dev/null | awk '{ print $NF }'
}

_key_pubkey_digest() {
    openssl pkey -pubout -in "$1" 2>/dev/null | openssl sha256 2>/dev/null | awk '{ print $NF }'
}

# cert_find_pair <folder> [host]
#
# Finds the certificate and the key in the folder that belong together. The
# usual names come first (fullchain.pem + privkey.pem, then cert.pem +
# key.pem), then every other certificate-looking file against every key-
# looking one; a match is decided by the public key, never by the name, and
# of two matching certificates the one carrying more of its chain wins.
#
# Sets CERT_PAIR_CERT and CERT_PAIR_KEY (file names inside the folder),
# CERT_PAIR_SUBJECT, CERT_PAIR_ISSUER, CERT_PAIR_END, CERT_PAIR_DAYS,
# CERT_PAIR_SELF_SIGNED (yes/no) and, when a host is given, CERT_PAIR_COVERS
# (yes/no). On failure returns 1 with CERT_PAIR_REASON.
cert_find_pair() {
    local dir="${1%/}" host="${2:-}"
    CERT_PAIR_CERT="" CERT_PAIR_KEY="" CERT_PAIR_REASON="" CERT_PAIR_COVERS=""
    CERT_PAIR_SUBJECT="" CERT_PAIR_ISSUER="" CERT_PAIR_END="" CERT_PAIR_DAYS="" CERT_PAIR_SELF_SIGNED=""

    if ! cert_folder_exists "$dir"; then
        CERT_PAIR_REASON="There is no folder at $dir."
        return 1
    fi
    local names
    names="$(cert_list "$dir")" || { CERT_PAIR_REASON="The folder $dir cannot be read, even through sudo or docker."; return 1; }

    local work
    work="$(mktemp -d)"
    chmod 700 "$work"

    local certs=() keys=() name
    while IFS= read -r name; do
        [[ -n "$name" ]] || continue
        case "$name" in
            *.csr|*.csr.conf|*.conf|*.removed|*.bak|*.md|README*) continue ;;
        esac
        cert_peek "$dir/$name" "$work/f" || continue
        if grep -q -- '-----BEGIN CERTIFICATE-----' "$work/f"; then
            certs+=("$name")
        elif grep -q -E -- '-----BEGIN (EC |RSA |ENCRYPTED )?PRIVATE KEY-----' "$work/f"; then
            keys+=("$name")
        fi
    done <<< "$names"

    if [[ ${#certs[@]} -eq 0 || ${#keys[@]} -eq 0 ]]; then
        rm -rf "$work"
        CERT_PAIR_REASON="No certificate and private key were found in $dir (looked at: $(printf '%s ' $names))."
        return 1
    fi

    # The usual names first, so a folder holding both fullchain.pem and
    # cert.pem (certbot's live/) is served with its chain.
    local ordered=() preferred
    for preferred in fullchain.pem fullchain.cer cert.pem certificate.crt; do
        for name in "${certs[@]}"; do [[ "$name" == "$preferred" ]] && ordered+=("$name"); done
    done
    for name in "${certs[@]}"; do
        [[ " ${ordered[*]} " == *" $name "* ]] || ordered+=("$name")
    done

    local best_cert="" best_key="" best_chain=0 cert key digest chain
    for cert in "${ordered[@]}"; do
        cert_peek "$dir/$cert" "$work/c" || continue
        digest="$(_cert_pubkey_digest "$work/c")"
        [[ -n "$digest" ]] || continue
        chain="$(grep -c -- '-----BEGIN CERTIFICATE-----' "$work/c")"
        for key in "${keys[@]}"; do
            cert_peek "$dir/$key" "$work/k" || continue
            if [[ "$(_key_pubkey_digest "$work/k")" == "$digest" ]]; then
                if [[ -z "$best_cert" || "$chain" -gt "$best_chain" ]]; then
                    best_cert="$cert" best_key="$key" best_chain="$chain"
                fi
                break
            fi
        done
    done

    if [[ -z "$best_cert" ]]; then
        rm -rf "$work"
        CERT_PAIR_REASON="$dir holds a certificate and a key, but no key belongs to any certificate there (a renewal that replaced one and not the other leaves exactly this)."
        return 1
    fi

    cert_peek "$dir/$best_cert" "$work/c"
    CERT_PAIR_CERT="$best_cert"
    CERT_PAIR_KEY="$best_key"
    CERT_PAIR_SUBJECT="$(openssl x509 -noout -subject -in "$work/c" 2>/dev/null | sed 's/^subject= *//')"
    CERT_PAIR_ISSUER="$(openssl x509 -noout -issuer -in "$work/c" 2>/dev/null | sed 's/^issuer= *//')"
    CERT_PAIR_END="$(openssl x509 -noout -enddate -in "$work/c" 2>/dev/null | cut -d= -f2)"
    CERT_PAIR_SELF_SIGNED=no
    [[ "$CERT_PAIR_SUBJECT" == "$CERT_PAIR_ISSUER" ]] && CERT_PAIR_SELF_SIGNED=yes
    local end_epoch
    end_epoch="$(date -u -d "$CERT_PAIR_END" +%s 2>/dev/null \
        || date -u -D "%b %d %H:%M:%S %Y" -d "${CERT_PAIR_END% GMT}" +%s 2>/dev/null \
        || date -u -j -f "%b %e %H:%M:%S %Y %Z" "$CERT_PAIR_END" +%s 2>/dev/null || true)"
    if [[ -n "$end_epoch" ]]; then
        CERT_PAIR_DAYS="$(( (end_epoch - $(date -u +%s)) / 86400 ))"
    else
        CERT_PAIR_DAYS="?"
    fi
    openssl x509 -checkend 0 -noout -in "$work/c" >/dev/null 2>&1 || CERT_PAIR_DAYS="expired"
    if [[ -n "$host" ]]; then
        CERT_PAIR_COVERS=no
        if [[ "$host" =~ ^[0-9.]+$ || "$host" == *:* ]]; then
            openssl x509 -noout -checkip "$host" -in "$work/c" 2>/dev/null | grep -q 'does match' && CERT_PAIR_COVERS=yes
        else
            openssl x509 -noout -checkhost "$host" -in "$work/c" 2>/dev/null | grep -q 'does match' && CERT_PAIR_COVERS=yes
        fi
    fi
    rm -rf "$work"
    return 0
}

# True for an address or name Let's Encrypt can reach and certify: not
# localhost, not a private or link-local address.
cert_publicly_certifiable() {
    local host="$1"
    if [[ "$host" == *:* ]]; then
        case "$host" in ::1|fe80:*|fc*|fd*) return 1 ;; esac
        return 0
    fi
    if [[ "$host" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
        case "$host" in
            127.*|10.*|192.168.*|169.254.*|0.*) return 1 ;;
            172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 1 ;;
            100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 1 ;;
        esac
        return 0
    fi
    case "$host" in
        ""|localhost|*.localhost|*.local|*.lan|*.home|*.internal|*.test) return 1 ;;
        *.*) return 0 ;;
    esac
    return 1
}
