# Capacity, clustering and redundancy

Everything here is measured on this codebase rather than estimated. Reproduce
it with `npm run test:perf`.

## What one process actually does

Measured on a 10-core / 64 GB machine, relay on loopback, one message relayed
between two peers while the room is full:

| connected peers | join time | relay p50 | relay p95 | delivered |
|---|---|---|---|---|
| 25 | 12 ms | 0 ms | 1 ms | 40/40 |
| 100 | 13 ms | 0 ms | 1 ms | 40/40 |
| 400 | 13 ms | 0 ms | 1 ms | 40/40 |
| 800 | 12 ms | 0 ms | 1 ms | 40/40 |
| 1600 | 14 ms | 0 ms | 1 ms | 40/40 |

Latency is flat from 25 peers to 1600. That is the important shape: the relay
is not doing work proportional to the size of the room for each message. It
looks up one recipient in a Map and writes to one socket.

The reason it stays flat is that **the relay is not in the media path**. Two
peers who are both online exchange messages, files and calls over a WebRTC
data channel directly; the relay only introduces them. It carries real traffic
only for people who are offline, and then only until they collect it.

So the practical ceiling for a single instance is set by file descriptors and
RAM, not by CPU. A 4 GB VPS will hold roughly eleven thousand sockets before
the configured ceiling stops it.

## Adapting to the hardware

The ceilings are derived at boot from `os.cpus()` and `os.totalmem()` rather
than hard-coded, because a fixed number is simultaneously too generous on a
1 GB VPS and too mean on a 64 GB server. `/chat-health` reports what the
instance chose:

```json
"capacity": {
  "tier": "xlarge", "cpus": 10, "memoryMb": 65536,
  "sockets": { "inUse": 0, "max": 50000, "maxPerAddress": 276 },
  "saturation": 0
}
```

| machine | tier | sockets | per address | media quota | requests/min |
|---|---|---|---|---|---|
| 1 GB / 1 core | small | 2,926 | 24 | 358 MB | 150 |
| 4 GB / 2 cores | medium | 11,703 | 36 | 1,434 MB | 300 |
| 16 GB / 8 cores | large | 46,811 | 84 | 4,096 MB | 1,200 |
| 64 GB / 16 cores | xlarge | 50,000 | 276 | 4,096 MB | 2,400 |

Every one is overridable — `CHAT_WS_MAX_TOTAL`, `CHAT_WS_MAX_PER_IP`,
`CHAT_MEDIA_QUOTA_BYTES`, `CHAT_RATE_DEFAULT`, `CHAT_RATE_WRITE`,
`CHAT_TEXT_MAILBOX_LIMIT` — which is how the test suites constrain an instance
to look like a small VPS.

The login limit is deliberately **not** scaled: ten guesses a minute is the
right answer on any machine, and a faster server should not make guessing
faster.

## Why this is a single process today

Node `cluster` would give the box its other cores. It would also break the
application, because four things are held in process memory and every worker
would have its own copy:

| state | what breaks with two workers |
|---|---|
| `presence` (the peer Map) | peers on worker A cannot see or reach peers on worker B — the contact list is half empty and half the calls never connect |
| `offlineBoxes` → `offline-messages.json` | two workers rewrite the same file; the last writer wins and the other's queued messages are gone |
| PeerJS's own client registry | the same split, for the signalling that sets up every call |
| `rateBuckets`, `monitorSessions`, `kickedUsers` | limits and bans apply per worker, so N workers means N times the allowance and a kicked user reconnects until they land on a worker that has not heard |

None of that is hard to fix; it is just not free. And the measurement above says
it buys nothing yet: one process at 1600 peers is still answering in a
millisecond, and the work per message is a Map lookup, which more cores do not
speed up.

**The honest recommendation is to scale this vertically until the numbers say
otherwise, and to watch `saturation` in `/chat-health` for when that is.**

## When you do need more than one

The order to do it in, cheapest first:

**1. Split the roles.** The relay, the TURN server and the static web app are
already separate containers. TURN is the one that actually carries bytes for
users behind symmetric NAT — move it to its own host first. It is stateless
and load balances trivially.

**2. Shard by conversation, with sticky routing.** Put a load balancer in front
with a hash on the peer fingerprint so both ends of a conversation always land
on the same instance. This works without any shared state and gets you N
instances, at the cost that people on different shards cannot see each other's
presence. Acceptable for tenanted deployments — one company per shard — and
not acceptable for one public pool.

**3. Add a backplane.** For a single logical pool, `presence` and the mailboxes
have to move out of process memory:

- `presence` and `rateBuckets` → Redis, with pub/sub for the presence fan-out
- `offlineBoxes` → Redis or Postgres, keyed by recipient fingerprint (already
  the natural key; the JSON file is a Map with exactly that shape)
- `monitorSessions` → Redis with the same TTL
- PeerJS → its own Redis adapter, or a dedicated signalling instance

The mailbox is the only part that needs care, because it is the durable one.
Everything else can be lost on a restart without a user noticing.

## What is already in place for a pool

These landed with the security and performance pass and are what a load
balancer and an orchestrator need:

- **`GET /ready`** — 200 while this instance can take more peers, 503 once it
  is 95% full or draining. This is the probe a balancer should poll: it stops
  new peers being sent to an instance that cannot take them, instead of letting
  their connections fail.
- **`GET /live`** — says only that the process is running. This is what a
  supervisor should poll. A *full* instance must not be restarted; it is
  working perfectly.
- **`instance`** in every health response — a random handle, deliberately not
  the hostname, so you can tell which instance answered without publishing your
  internal machine names.
- **Graceful drain on SIGTERM** — stops reporting ready, tells every connected
  peer to reconnect after its own jittered delay, flushes the mailboxes to
  disk, then closes. Without the jitter, every peer reconnects in the same
  second and the instance replacing this one takes the whole herd at once.
- **Atomic store writes** — every store is written to a temp file, fsynced and
  renamed. A crash or an OOM kill during a write used to truncate
  `offline-messages.json`, which at 59 MB meant every queued message for every
  user, and the next boot finding a parse error where the mailboxes had been.

## Redundancy

**What is already durable.** Message contents are end-to-end encrypted and the
authoritative copy lives on the participants' devices, in their own encrypted
vaults. The relay holds only what has not been collected yet. Losing the relay
entirely costs the queue, not the history.

**What to back up.** `data/` (the mailboxes and the expiry log), `.env` (the
monitor and TURN passwords — the only copy) and `certs/`. Nothing else on the
server is irreplaceable; the rest is a git checkout.

**What a backup cannot give you.** The users' keys. They exist only on their
devices. That is the design, and it means a restored relay is a working relay
with an empty queue, not a recovered conversation history.

**A second instance for failover** works today without any shared state,
provided only one is live at a time: they share nothing but `data/`, so an
active/passive pair behind a health check will fail over cleanly as long as
`data/` is on shared storage or replicated. Active/active needs the backplane
above.

## Running the measurements

```bash
npm run relay                       # terminal 1
npm run test:perf                   # the ladder above
PERF_PEERS=100,1000,5000 npm run test:perf
npm run test:security               # 23 probes against a running relay
RELAY_URL=https://your-host:8585 npm run test:security
```

`test:security` reads the instance's advertised capacity and sizes its probes
against it, so it proves the ceilings on the machine it is pointed at rather
than against numbers baked into the test.
