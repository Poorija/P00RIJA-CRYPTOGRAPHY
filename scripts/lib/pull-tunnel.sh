#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.

# The tunnel a server pulls `deploy.sh --prebuilt` images through, and what an
# earlier one left behind. Sourced by scripts/deploy.sh; the functions marked
# "on the server" are sent to the server inside the pull script (declare -f),
# so they are written for bash 3.2 (macOS) as well as for the servers' bash.
#
# The server pulls from the registry on this computer's 127.0.0.1 through
# `ssh -R`: a port on the server's 127.0.0.1 that leads back here. When the
# link dies in the middle of a pull, ssh here gives up after a minute
# (ServerAlive), but the server's sshd does not know yet: it keeps that
# session, its `bash -s` and the port for as long as TCP takes to give up on a
# peer that is gone. With one fixed port (5055) the next deploy then failed at
# once — "remote port forwarding failed for listen port 5055" — until someone
# killed the stale session by hand (the Iran relay, 2026-11-09).
#
# So every pull takes a port of its own on the server, picked at random, and
# another if something there holds it; and every pull first ends this
# account's earlier pulls whose tunnel no longer answers. Docker pulls from
# any port on 127.0.0.1 over plain HTTP without being told to (127.0.0.0/8 is
# always an insecure registry to it), so the servers need no settings.

# What the pull's own command line says, `bash -s poorija-prebuilt-pull
# <port>`: how a later pull tells an earlier one, and its port, from anything
# else this account runs.
PULL_MARK="poorija-prebuilt-pull"

# The server's end of the tunnel: 20000 to 60000. RANDOM alone stops at
# 32767, so two of them make the number.
pull_tunnel_port() {
    printf '%s\n' "$(( 20000 + (RANDOM * 32768 + RANDOM) % 40001 ))"
}

# On the server: does the tunnel on this port still reach a registry? A dead
# link still accepts the connection (sshd listens for a client that is gone)
# but nothing ever answers, so the answer is waited for, not the connection.
pull_tunnel_answers() {
    (
        exec 3<>"/dev/tcp/127.0.0.1/$1" || exit 1
        printf 'GET /v2/ HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n' >&3
        IFS= read -r -t "${PULL_PROBE_SECONDS:-8}" line <&3 || exit 1
        case "$line" in HTTP/*) exit 0 ;; esac
        exit 1
    ) 2>/dev/null
}

# On the server: "ppid uid comm" of a process, from the listing the sweep
# took ($pull_procs).
_pull_proc() {
    local p pp u c
    while read -r p pp u c; do
        if [ "$p" = "$1" ]; then printf '%s %s %s\n' "$pp" "$u" "$c"; return 0; fi
    done <<< "$pull_procs"
    return 1
}

# On the server, at the start of a pull: end this account's earlier pulls
# whose tunnel is dead, and nothing else. A process is ended only when ALL of
# these hold:
#   - its command line is exactly `bash -s poorija-prebuilt-pull <port>`;
#   - it runs as this account, and is not this pull (pid, or port $1);
#   - above it, through at most a few shells of this account (the login
#     shell is fish on some servers), is an ssh session of this account —
#     sshd or sshd-session — that runs a command, not a terminal
#     (`<account>@notty`);
#   - its port no longer answers as a registry.
# Then that pull and its ssh session are ended: the session is what holds
# the port. Another account's processes, a terminal someone is logged in on,
# containers and every other tunnel on the server are never touched.
pull_sweep_stale() {
    local own="${1:-}" me who pull_procs pull_args pid args port info ppid uid comm
    local cur pp u c n session sargs ended=" " probed=" " stale=" "
    me="$(id -u)"; who="$(id -un)"
    pull_procs="$(ps -A -o pid= -o ppid= -o uid= -o comm= 2>/dev/null)" || return 0
    pull_args="$(ps -A -o pid= -o args= 2>/dev/null)" || return 0
    while read -r pid args; do
        case "$args" in "bash -s $PULL_MARK "*) ;; *) continue ;; esac
        port="${args#bash -s $PULL_MARK }"
        case "$port" in ''|*[!0-9]*) continue ;; esac
        [ "$pid" = "$$" ] && continue
        [ "$port" = "$own" ] && continue
        info="$(_pull_proc "$pid")" || continue
        read -r ppid uid comm <<< "$info"
        [ "$uid" = "$me" ] || continue
        session=""; cur="$ppid"; n=0
        while [ "$n" -lt 4 ] && [ "${cur:-0}" -gt 1 ]; do
            info="$(_pull_proc "$cur")" || break
            read -r pp u c <<< "$info"
            [ "$u" = "$me" ] || break
            # "sshd-session", or a path to it, or (where ps shows the
            # title as the name) "sshd-session: <account>@notty".
            c="${c%%:*}"; c="${c##*/}"
            case "$c" in
                sshd|sshd-session) session="$cur"; break ;;
                bash|fish|sh|dash|zsh) cur="$pp"; n=$((n + 1)) ;;
                *) break ;;
            esac
        done
        [ -n "$session" ] || continue
        sargs="$(while read -r p a; do [ "$p" = "$session" ] && { printf '%s' "$a"; break; }; done <<< "$pull_args")"
        case "$sargs" in *"$who@notty"*) ;; *) continue ;; esac
        # One look per port: the same pull can show up as several
        # processes (its subshells carry its command line too).
        case "$probed" in *" $port "*) ;; *)
            probed="$probed$port "
            pull_tunnel_answers "$port" || stale="$stale$port " ;;
        esac
        case "$stale" in *" $port "*) ;; *) continue ;; esac
        kill "$pid" 2>/dev/null
        case "$ended" in *" $session "*) continue ;; esac
        ended="$ended$session "
        kill "$session" 2>/dev/null \
            && echo "ended an earlier pull of this account that was left on this server (its port $port no longer answered; ssh session $session)"
    done <<< "$pull_args"
    return 0
}

# On the server: the names a pull gives the images while it moves them,
# 127.0.0.1:<port>/<image>, that an interrupted pull left behind. Only those
# names are removed — never an image, never a container's — and only for the
# images this pull brings.
pull_untag_leftovers() {
    local ref
    docker image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
        | grep -E '^127\.0\.0\.1:[0-9]+/(poorija-crypto|poorija-chat-signal|poorija-cert-renewer|coturn/coturn|alpine):' \
        | while read -r ref; do docker rmi "$ref" >/dev/null 2>&1 || true; done
    return 0
}
