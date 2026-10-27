#!/bin/sh
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# Licensed under the GNU Affero General Public License, version 3 only.
#
# The control panel image's start (config/Dockerfile.control-panel). It runs
# as root only long enough to hand the panel's own user a copy of the SSH
# keys it was given read-only (ssh will not use a key another user owns),
# then runs the panel, or setup-login, as that user.
set -eu
if [ -d /ssh-src ]; then
  mkdir -p /home/node/.ssh
  cp -R /ssh-src/. /home/node/.ssh/ 2>/dev/null || true
  chown -R node:node /home/node/.ssh
  chmod 700 /home/node/.ssh
  find /home/node/.ssh -type f -exec chmod 600 {} +
fi
# A state folder bind-mounted from the host may not take a chown; it then
# needs to be writable as it is.
chown node:node /state 2>/dev/null || true
case "${1:-serve}" in
  serve) exec su-exec node node /app/tools/panel/server.mjs ;;
  setup-login) shift; exec su-exec node node /app/tools/panel/setup-login.mjs "$@" ;;
  *) exec su-exec node "$@" ;;
esac
