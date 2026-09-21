# File transfer speed — what was measured, and what is left

وضعیت: اندازه‌گیری‌شده · Status: measured

درخواست این بود که انتقال فایل «مولتی کانکشن» شود تا ارسال و دریافت سریع‌تر
باشد. اندازه‌گیری نشان داد چند کانال سود نمی‌دهد، و دلیلش ساختاری است. این سند
عددها را نگه می‌دارد تا این سؤال دوباره از صفر پرسیده نشود، و تنها شرطی را که
اندازه گرفته نشده مشخص می‌کند.

The request was to make file transfer "multi-connection" so uploads and
downloads go faster. Measurement says more channels buy nothing, and the
reason is structural. This records the numbers so the question does not get
re-asked from scratch, and names the one condition that was not measured.

---

## What was measured

Two experiments, both on Chromium, both reproducible from the scripts quoted
below.

### 1. The CPU path — `blob.slice()` → `crypto.subtle.encrypt`

48–64 MB pushed through the same three stages `sendBlobChunks()` runs per
chunk, on a 10-core machine:

| chunk | wall | of which slice | of which encrypt | throughput |
|---|---|---|---|---|
| 16 KB | 799 ms | 733 ms | 65 ms | 80 MB/s |
| 64 KB | 230 ms | 197 ms | 33 ms | **278 MB/s** |
| 128 KB | 142 ms | 113 ms | 28 ms | 451 MB/s |
| 192 KB | 106 ms | 80 ms | 26 ms | 602 MB/s |
| 256 KB | 91 ms | 69 ms | 23 ms | 702 MB/s |

Two things fall out of this immediately:

**Encryption is not the cost.** At the size the app actually uses it is 33 ms
of 230 — about 14%. The rest is the per-call overhead of slicing a Blob and
awaiting its `arrayBuffer()`, which is why bigger chunks look faster: fewer
round trips, not less work.

**Running encryption in parallel makes it slower, not faster.** Four and eight
concurrent `crypto.subtle.encrypt` calls were measured against the serial loop:

| shape | throughput |
|---|---|
| serial, 64 KB | 278 MB/s |
| pipelined (encrypt N+1 while N is in flight), 64 KB | 381 MB/s |
| 2 at once, 64 KB | 346 MB/s |
| 4 at once, 64 KB | 340 MB/s |
| 8 at once, 64 KB | 319 MB/s |

WebCrypto does not get faster by being asked more times at once from one
thread. Concurrency past two is pure overhead.

### 2. The transport — `RTCDataChannel`

48 MB between two real `RTCPeerConnection`s. Run twice: once with both peers in
one page, and once with each peer in its own renderer process, because the
first shape has the sender's loop and the receiver's `onmessage` sharing a
thread and could cap for that reason alone.

Separate processes, which is the honest number:

| message size | channels | throughput |
|---|---|---|
| 15.9 KB | 1 | 8 MB/s |
| 64 KB | 1 | 8 MB/s |
| 256 KB | 1 | 11 MB/s |
| 64 KB | 2 | 8 MB/s |
| 64 KB | **4** | **10 MB/s** |

Same page, for comparison — 14–18 MB/s across every message size from 16 KB to
256 KB and every channel count from 1 to 8, with identical configurations
landing 14 and 18 on different runs. That spread is the noise floor, and every
difference in the table above sits inside it.

---

## Why multi-channel cannot help

Several `RTCDataChannel`s on one `RTCPeerConnection` are not several
connections. They are several streams inside **one SCTP association**, over one
DTLS session, over one ICE candidate pair. One association means one congestion
window and one send path. Splitting a file across N channels divides that
window N ways; it does not create N of them.

The measurement agrees with the theory: 1 channel and 4 channels are the same
number.

## Why the chunk size does not help either

The CPU path runs at 278 MB/s and the transport at 8–11 MB/s. The transport is
**roughly twenty-five times slower**, so the sender is never the thing being
waited on. Raising `FILE_CHUNK_BYTES` from 64 KB to 256 KB would take the CPU
path from 278 to 702 MB/s — from twenty-five times faster than the wire to
seventy times faster than the wire. Nobody would be able to tell.

Worth writing down, because the comment in `01-constants.js` used to claim
otherwise: 64 KB is **not** below PeerJS's own chunker. `chunkedMTU` is 16300
bytes, so each 64 KB chunk is split into five on the wire, each wrapped in its
own BinaryPack envelope, and concatenated back into a fresh `Uint8Array` on the
far side before being re-parsed. That is real waste — and it is waste in the
stage that has twenty-five times more headroom than it needs, so removing it
would change nothing anyone can see. The comment was corrected; the constant
was left alone.

## What the wall actually is

At 8–11 MB/s the ceiling is Chromium's SCTP implementation, not the app. On a
real path between two people it is usually lower still — a typical home upload
is 10–50 Mbit/s, which is 1.2–6 MB/s, comfortably under the stack's own limit.
Either way the app is not the part that is slow.

---

## The one condition not measured

Every number above comes from a path with essentially **zero round-trip time**.
That is exactly the condition under which multiple connections cannot help, and
it is not the condition under which they are normally used.

A congestion-controlled transport delivers roughly `window / RTT`. On a long or
lossy path the window is what binds, and N *independent* associations get N
windows — which is the whole reason a download manager opens several TCP
connections to one server. The equivalent here is not several data channels; it
is several **`RTCPeerConnection`s**, each with its own SCTP association, ICE
negotiation and DTLS handshake.

That is a large change:

- N ICE negotiations and N DTLS handshakes per transfer, each of which can fail
  on its own and each of which has to be torn down.
- Chunks arriving on N associations with no ordering between them, so the
  receiver's reassembly stops being "a run that grows" and becomes a scatter of
  indices — `flushReceivedChunks()` is written for the first shape.
- On a path that goes through TURN, N associations share one relay allocation,
  so the split gains nothing and costs N times the setup.
- It competes with itself for the same physical link, which is fair-share
  behaviour that a user on a shared connection may not want.

**Estimate.** Two to three days to write, and the measurement that would
justify it cannot be done here: it needs two real devices on a real path with
real RTT, the same constraint `call-quality-plan.md` records for the bitrate
ladder. Building it against a loopback would produce something that looks right
and does nothing.

**Recommendation.** Do not build it without that measurement first. The
measurement is cheap — a single transfer between two devices on different
networks, timed — and it decides whether the rest is worth two days.

---

## Reproducing

Both experiments were one-off scripts rather than suites, because they measure
the engine rather than this app's behaviour and would fail on a slower CI box
for reasons that are not defects. The shapes are:

- **CPU:** a Blob of N MB, sliced and AES-GCM encrypted chunk by chunk with
  `performance.now()` around each stage. Must run on a secure origin —
  `crypto.subtle` is `undefined` on `about:blank`, and `getRandomValues` caps
  at 65536 bytes per call.
- **Transport:** two `RTCPeerConnection`s wired to each other, SDP and ICE
  candidates handed across by the test runner, `bufferedAmount` watched against
  the app's own 4 MB / 1 MB watermarks. Put each peer in its own page — one
  page makes the two halves share a thread and depresses every number.

What *is* asserted in the suite is the part that is this app's behaviour:
`tests/e2e/bigfile.mjs` for the receiver's memory shape, and
`tests/e2e/filetransfer.mjs` for whether files arrive intact.
