<img src="assets/pwa-icons/icon-192.png" alt="P00RIJÃ Cryptography" width="72" align="right">

# P00RIJA Cryptography Linux Server Package

This package contains the Linux server deployment for P00RIJA Cryptography v2.44.6, including the web app, Chat Signal relay, Monitor_Server, coturn, offline encrypted queues, server policies, and server-synced self-destruct message counters.

## Fresh Install

```bash
cp .env.example .env
nano .env
npm run setup:server:linux
```

Or run the interactive Docker/server wizard directly:

```bash
npm run setup
```

## Update Existing Server Without Data Loss

Extract the new package over the existing install folder, or replace the application files while keeping `.env`, `certs/`, and `data/`. Then run:

```bash
bash scripts/setup.sh --update-server
```

If the new package was extracted into a separate folder, run the updater from the new package and pass the existing install folder:

```bash
bash scripts/setup.sh --update-server /path/to/existing/P00RIJA-CRYPTOGRAPHY
```

The updater will copy the new application files into that installed folder, keep the persistent paths in place, and then rebuild/recreate containers there.

The update mode preserves:

- `.env`
- `certs/`
- Docker volumes
- `data/chat-signal/offline-messages.json`
- `data/chat-signal/server-policy.json`
- `data/chat-signal/server-config.json`
- `data/chat-signal/self-destruct-records.json`

Before rebuilding containers, the updater writes a timestamped backup under `backups/`.

## Manual Docker Start

```bash
docker compose --env-file .env -f config/docker-compose.yaml up -d --build
```

## Important URLs

- Main app: `https://DOMAIN:8585`
- Monitor dashboard: `https://DOMAIN:8585/Monitor_Server`
- Health: `https://DOMAIN:8585/chat-health`
- TURN config: `https://DOMAIN:8585/turn-config`
- Self-destruct record create: `POST https://DOMAIN:8585/self-destruct/records`
- Self-destruct open counter: `POST https://DOMAIN:8585/self-destruct/records/:id/open`

The server never receives message plaintext or decrypt keys. It stores only message control metadata: expiry duration, max views, open count, first-open timestamp, and record id.
