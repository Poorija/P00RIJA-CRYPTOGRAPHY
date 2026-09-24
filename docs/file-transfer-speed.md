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

## The relay path, which none of the above measured

هر عددی که تا این‌جا آمد از مسیر P2P است. مسیر رله — همان که وقتی گیرنده آفلاین
است یا NAT اجازهٔ اتصال مستقیم نمی‌دهد استفاده می‌شود — جداگانه اندازه گرفته شد
و دو نقص داشت که هیچ‌کدام در جدول‌های بالا دیده نمی‌شدند.

Everything above is the peer-to-peer path. The relay path — the one used when
the recipient is absent, or when NAT will not allow a direct connection — was
measured separately and had two defects, neither of which any table above would
have shown. The conclusion "the app is not the part that is slow" was true of
the data channel and false of the relay.

### 1. The retention sweep was quadratic in the mailbox

`sweepRetention()` runs every time mail lands, and it derived each waiting
envelope's size by stringifying its payload. A file arrives as one envelope per
chunk into one mailbox, so chunk N re-measured the N-1 already there.

480 chunks of 64 KB — a 30 MB file — into one mailbox, per-chunk round trip:

| | first 60 chunks | last 60 chunks | spread | overall |
|---|---|---|---|---|
| before | 1.80 ms | 9.77 ms | 5.4x | 11.7 MB/s |
| after | 1.00 ms | 0.77 ms | 0.8x | 73.4 MB/s |

The shape is the diagnosis: a fixed per-message cost draws a flat line, and
this one climbed linearly, which is what work proportional to the mailbox looks
like. Summed, a straight line is a parabola.

At 200 MB the same code took **143 seconds**; it takes **3.1** now. That is
also the answer to "the app disconnects from the relay during a heavy send":
an idle bystander never dropped even against the old code, worst response gap
433 ms. What dropped was the transfer's own watchdog, `TRANSFER_STALL_TIMEOUT_MS`
at 60 seconds, against a transfer that needed 143.

Two smaller costs on the same path: the store was written out pretty-printed,
which only ever indented the braces around single-line base64 bodies, and it
was rewritten on a fixed 300 ms debounce however large it had grown. The wait
now scales with how long the previous write took.

### 2. Delivery deadlocked at the window

Worse than slow, and invisible for the same reason. The relay hands a returning
recipient a window of envelopes and tops it up as they are acknowledged. The
top-up sliced the front of the queue instead of tracking what had been sent, so
it re-sent what the recipient already held; and it ran only on an ACK that
removed something. The app acknowledges every envelope it handles, duplicates
included, and an ACK for an envelope already gone changed nothing — so once the
recipient had acknowledged everything it held, neither side had a reason to
speak next.

3200 chunks queued for an absent recipient, acknowledged one at a time as the
app does:

| | delivered | duplicate traffic |
|---|---|---|
| before | 53 of 3200, then silence | 4.4x |
| after | 3200 of 3200 | 1.0x |

A conversation rarely has fifty messages waiting, so this only ever showed on
files — which advanced a few megabytes per reconnection and read as a slow
network.

### What this says about the P2P conclusions above

Nothing. They were measured on the data channel and they still hold: the
transport is the wall there, chunk size is inside the noise, and several
channels share one congestion window. What is now recorded is that the relay
path has its own economics and had never been measured, which is the gap this
document was one reader away from hiding.

Both are regression-tested rather than left as one-off scripts, because unlike
the engine measurements above these assert this app's own behaviour:
`tests/e2e/relaythroughput.mjs` asserts the shape of the curve rather than any
throughput number, and `tests/e2e/maildelivery.mjs` asserts that everything
queued arrives exactly once. Both fail against the previous code.

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
