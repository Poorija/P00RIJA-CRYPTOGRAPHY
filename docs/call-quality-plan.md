# Call quality — what is left to do

وضعیت: برنامه‌ریزی‌شده، پیاده نشده · Status: planned, not implemented

این سند دو کار باقی‌ماندهٔ بهبود کیفیت تماس را نگه می‌دارد، با اندازه‌گیری‌هایی
که تصمیم‌ها بر پایهٔ آن‌ها گرفته شد. دو کار دیگر از همان بررسی در
`2.26.95-chat-v34` انجام شدند و اینجا فقط برای اینکه معلوم باشد چه چیزی
باقی مانده، خلاصه شده‌اند.

The two remaining items from the connection audit, with the measurements the
decisions rest on. Two others from the same audit shipped in
`2.26.95-chat-v34` and are summarised here only so the boundary is clear.

---

## What already shipped (2.26.95-chat-v34)

**The connection is configured rather than inherited.** `peerOptions()` passed
`iceServers` and nothing else, so `bundlePolicy`, `rtcpMuxPolicy` and
`iceCandidatePoolSize` took the engine default. It now sets `max-bundle`,
`require` and a pool of 2.

Measured: on Chromium the offer SDP is byte-identical before and after, because
its defaults already did this. On WebKit — macOS and iOS — the applied
configuration moves from `balanced` with a candidate pool of **zero** to
`max-bundle` with a pool of 2, and the offer carries three candidates where it
carried two. A pool of zero means candidate gathering starts when the call is
already being placed.

**Tracks say what they are.** `contentHint` was unset on every track, so the
encoder guessed between a face and text. Camera is `motion`, shared screen is
`detail`, audio is `speech`. All five call media paths route through one helper.

`tests/e2e/calltuning.mjs` holds both, asserted against a real
`RTCPeerConnection`'s own `getConfiguration()`.

---

## Item 2 — react to the quality the app already measures

**The gap.** `startCallQualityMonitor()` reads RTT, jitter and packet loss every
few seconds, in **both** directions — the outbound side comes from
`remote-inbound-rtp`, which is the far end's own report arriving inside our
`getStats()`. It grades each leg, lights a badge, fills a card.

Then it does nothing. The call is not changed in any way.

```
setParameters            0 occurrences in the tree
maxBitrate               0
degradationPreference    0
scaleResolutionDownBy    0
```

So the app knows the link is failing and rides it into a dropped call.

**What to build.**

A controller that takes the readings the monitor already produces and moves the
sender's parameters:

```js
const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
const params = sender.getParameters();
params.encodings[0].maxBitrate = target;          // bits per second
params.encodings[0].scaleResolutionDownBy = scale; // 1, 2, 4
params.degradationPreference = 'maintain-framerate';
await sender.setParameters(params);
```

Suggested ladder, to be tuned against real measurements rather than adopted as
written:

| Grade | Condition | Video | Audio |
|---|---|---|---|
| good | loss < 2%, RTT < 200ms | full: no cap | untouched |
| ok | loss 2–5% or RTT 200–400ms | 600 kbps, `scaleResolutionDownBy: 2` | untouched |
| bad | loss > 5% or RTT > 400ms | 250 kbps, `scaleResolutionDownBy: 4` | untouched |
| critical | loss > 15% for two consecutive samples | video sender disabled, call continues as audio | untouched |

Three things this has to get right, and they are where the work is:

1. **Hysteresis.** Grading each sample on its own makes the ladder oscillate and
   the picture pulse. Require N consecutive samples before stepping down and
   more before stepping back up.
2. **Audio is never sacrificed.** A call is the voice. Video degrades to
   nothing before the audio encoding is touched.
3. **`degradationPreference` follows `contentHint`.** `maintain-framerate` for a
   camera, `maintain-resolution` for a shared screen — the same reasoning that
   picked the hints in v34, applied to the other end of the pipe.

**Effect.** This is the item with the most bearing on whether a call survives a
bad minute rather than ending. Everything above it makes connecting faster;
this one makes staying connected possible.

**Estimate.** Half a day to write, and the tuning is the rest: the ladder above
is a starting point and the thresholds need measuring on a real link between two
real devices. It cannot be tuned from a headless runner — a simulated network
will produce a ladder that looks right and behaves wrong.

**Testable.** `setParameters` is observable through `getParameters()`, so a suite
can drive synthetic readings into the controller and assert the encoding that
comes out, without placing a call.

---

## Item 4 — codec preferences

**The gap.** `setCodecPreferences` appears zero times. Whatever the browser
offers, in whatever order it offers it, is what gets negotiated — and the order
is not the same on Chromium and WebKit, so two of this app's own platforms can
settle on different codecs for the same call.

**What to build.**

```js
const { codecs } = RTCRtpReceiver.getCapabilities('video');
const preferred = [
  ...codecs.filter((c) => c.mimeType === 'video/VP8'),
  ...codecs.filter((c) => c.mimeType === 'video/H264'),
  ...codecs.filter((c) => !/VP8|H264/.test(c.mimeType)),
];
transceiver.setCodecPreferences(preferred);
```

For audio, prefer Opus and set `stereo=0; useinbandfec=1` in the fmtp line: a
call is one voice, stereo doubles the bitrate for nothing, and in-band FEC is
what carries speech through packet loss.

**Why it is last.** It has the highest chance of a side effect. Forcing a codec
that one side encodes only in software turns a working call into a hot phone,
and a preference list that excludes what the far end has leaves the call with no
common codec at all. Any change here needs testing across every pair — macOS to
Android, iOS to Windows, and so on — not just the pair in front of whoever wrote
it.

**Estimate.** Half a day to write, and the cross-platform testing is the real
cost.

---

## Order

Item 2 first. It is the one that changes whether calls survive, its effect is
measurable from inside the app, and it carries no risk of breaking a call that
currently works — the worst case is a picture that steps down when it need not
have.

Item 4 after, and only with a real device on each platform to test against.
