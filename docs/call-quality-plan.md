# Call quality — what is left to do

وضعیت: پیاده‌شده، تست میان‌پلتفرمی باقی مانده · Status: implemented, cross-platform testing outstanding

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

## What shipped since (2.44.0-chat-v69)

Both remaining items are implemented. What is NOT done is the part this
document was most insistent about, so it is stated first.

**The tuning is still untested on real links.** Every threshold and every rung
below was reasoned, not measured between two devices on different networks.
This document said a simulated network "will produce a ladder that looks right
and behaves wrong", and that caution has not been discharged — it has only been
narrowed, because the ladder now adapts rather than sitting at one setting.

**Item 2 — the adaptive ladder.** Three grades with hysteresis: a step down
takes effect on the sample that sees it, a step up needs three consecutive
healthy samples. `degradationPreference` follows `contentHint` as planned —
`maintain-resolution` for a shared screen, `maintain-framerate` under strain,
`balanced` when there is room. WebKit builds that accept the bitrate cap but
not the hint fall back to the cap alone rather than losing both.

The rungs as built, which are ceilings rather than operating points — the
measured `availableOutgoingBitrate` takes precedence wherever there is one:

| Grade | Condition | Video | Audio |
|---|---|---|---|
| good | RTT < 250ms, loss < 2%, est. > 1 Mbit/s | 4 Mbit/s | 128 kbit/s |
| strained | RTT 250–500ms, loss 2–8%, est. 0.3–1 Mbit/s | 600 kbit/s | 48 kbit/s |
| bad | RTT > 500ms, loss > 8%, est. < 300 kbit/s | 180 kbit/s | 24 kbit/s |

One departure from the plan above, which said audio is "untouched" at every
grade. Audio is capped too, but from below rather than above: it takes at most
15% of the estimate against video's 75%, and never less than 24 kbit/s
whatever the estimate says. The intent is the plan's — the call is the voice —
but leaving audio genuinely uncapped meant the two streams could bid past the
estimate between them on a link that was already failing, which is the moment
the plan exists to survive.

The capture request moved with it: 1280x720 with no frame rate named became
1920x1080 at 30, as `ideal` rather than a requirement. Left unsaid, some
engines settle on 15.

**Item 4 — codec preferences and Opus.** The fmtp line now carries
`useinbandfec=1` and `maxaveragebitrate=128000`, added to whatever the engine
already wrote and never overwriting a value it chose for itself. `stereo=0` is
deliberately NOT set: the plan asked for it, but an engine that has not
mentioned stereo is already mono, and writing the key would be this code
overruling an encoder about its own default for no gain.

The codec ordering the plan describes was already in place; what is new is the
fmtp tuning beside it.

`tests/e2e/callcodec.mjs` takes the transform out of the source and exercises
it on the shapes engines actually emit — a line already carrying parameters, a
payload type with no fmtp line at all, a video section that must be left alone,
and running twice, since both sides of a call apply it and a renegotiation
applies it again. That is a unit test of a string transform. It is not the
cross-platform test this document asks for, and it does not stand in for one.

**Still outstanding:** macOS↔Android, iOS↔Windows and the rest of the pairs, on
real links. Until then the risk the plan named for item 4 stands.

---

## Order

Item 2 first. It is the one that changes whether calls survive, its effect is
measurable from inside the app, and it carries no risk of breaking a call that
currently works — the worst case is a picture that steps down when it need not
have.

Item 4 after, and only with a real device on each platform to test against.
