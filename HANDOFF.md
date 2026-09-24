<div dir="rtl">

<img src="assets/pwa-icons/icon-192.png" alt="P00RIJÃ Cryptography" width="72" align="left">

# راهنمای ادامهٔ توسعه

این سند چیزهایی را می‌گوید که از خواندن کد یا `README.md` در نمی‌آید:
کجای کد چه چیزی است، چرا بعضی جاها عجیب نوشته شده، حلقهٔ توسعه چطور است،
و کدام تله‌ها قبلاً وقت گرفته‌اند. `README.md` نصب و بیلد نیتیو را پوشش می‌دهد؛
اینجا تکرارش نمی‌کنم.

نسخهٔ این پکیج: **2.44.0**

</div>

---

## 1. Getting it running

Three different loops, for three different jobs.

### The edit-and-reload loop — what you want 90% of the time

```bash
npm install
npm run dev          # http://localhost:8080, no caching, no certificates
```

`http://localhost` is a secure context in every current browser, so WebCrypto,
`getUserMedia` and service workers all work. Chat needs the relay as well:

```bash
npm run relay        # scripts/server.js — signalling on 9000, presence on 9001
```

Point the app at it once from **Settings → Connection & TURN → relay URL**
(`http://localhost:9000`), press Connect, and two browser profiles on the same
machine can call each other.

While the relay is not running you will see `GET /chat-health 404` in the
console on every load. That is the app asking its own origin whether a relay
lives there; the static server has none. It is the expected answer, not a
missing file.

What this loop does *not* give you: a second physical device. To that phone your
laptop is a plain-HTTP origin and the browser will refuse the camera. For two
real devices use the Docker stack over HTTPS.

### The full stack

```bash
cp .env.example .env         # then fill DOMAIN, TURN_PASSWORD, MONITOR_PASSWORD
#  see certs/README.md for a self-signed pair
docker compose -f config/docker-compose.yaml up -d --build
```

Four containers: nginx serving the app on `8585`, the chat-signal relay, coturn,
and a certbot renewer. `config/docker-compose.yaml` is the readable description
of all of it.

### Pushing one file into the running container

Rebuilding the image for a CSS tweak takes minutes. This takes a second and is
what the whole of this session used:

```bash
docker cp css/styles.css Poorija-Cryptography_App:/usr/share/nginx/html/css/styles.css
docker cp js/chat.js     Poorija-Cryptography_App:/usr/share/nginx/html/js/chat.js
```

**Bump the version tag whenever you do this.** Every asset in `index.html`
carries `?v=<TAG>` — right now `2.44.0-chat-v69` — and `sw.js` puts the
same string in `CACHE_NAME`. Without a bump the service worker serves the old
file and you debug a build that is not running:

```bash
OLD_TAG=$(grep -o "?v=[^\"']*" index.html | head -1 | cut -c4-)
NEW_TAG="2.44.0-chat-v70"
sed -i "" "s/$OLD_TAG/$NEW_TAG/g" index.html sw.js js/app.js
sed -i "" "s/return '${OLD_TAG#*-}';/return '${NEW_TAG#*-}';/" js/app.js
```

`OLD_TAG` is read out of `index.html` rather than written out, because an example that
spells a real tag gets rewritten by the next bump's own `sed` and stops working.

Then verify what is actually being served — this catches more mistakes than any
other single command:

```bash
for f in index.html sw.js js/chat.js css/styles.css; do
  a=$(md5sum "$f" | cut -d' ' -f1)
  b=$(docker exec Poorija-Cryptography_App md5sum "/usr/share/nginx/html/$f" | cut -d' ' -f1)
  [ "$a" = "$b" ] && echo "MATCH $f" || echo "DIFF  $f"
done
```

---

## 2. The shape of the code

Everything is plain ES2020 in the browser — no bundler, no framework, no build
step for the web app. `index.html` loads eight scripts in order and that is the
application.

| file | lines | what it is |
|---|---|---|
| `js/chat.js` | ~15,100 | the entire secure-chat client: transport, crypto, UI, calls |
| `js/app.js` | ~9,000 | the rest of the suite (encrypt/decrypt/notes/passwords/SSH…), i18n for both languages, theming, tab machinery |
| `css/styles.css` | ~18,200 | every style, in dated layers — see §4 |
| `index.html` | ~3,900 | all markup for every tab, no templating |
| `js/backup.js` | | encrypted whole-vault export/import |
| `js/advanced-crypto.js` | | Shamir secret sharing, Argon2id |
| `js/ssh-keys.js`, `js/crypto-config.js` | | as named |
| `scripts/server.js` | | the relay: PeerJS signalling, presence, offline queue, push, monitor dashboard |
| `src-tauri/src/lib.rs` | ~900 | the native shell: tray, background behaviour, `~/.ssh`, shredding, the on-disk vault, quick unlock |
| `js/desktop-bridge.js` | | the only file that knows about `window.__TAURI__`; everything else asks it |

### Map of `js/chat.js`

It is one IIFE. The big sections carry banner comments; these line numbers are
from this snapshot and will drift, so search the titles rather than the numbers.

| ~line | section |
|---|---|
| 53 | Sticker packs — import, storage, picker, send |
| 66 | Media vault — attachments that survive a reload (IndexedDB + AES-GCM) |
| 383 | Call screen behaviour — FaceTime/Telegram habits (chrome auto-hide, tiles) |
| 459 | How the two pictures are fitted (cover/contain decision, blurred backdrop) |
| 708 | Structured messages — polls, location, contact cards |
| 1057 | Group management |
| 1486 | Chat lock, global search, key verification |
| 1722 | The emoji key — six-symbol call verification |
| 1890 | Swipe to reply, and selecting several messages at once |
| 2063 | Telegram-parity group features (mentions, permissions, invites) |
| 2343 | Group calls — full mesh |
| 2600 | Presenting, pinning and reacting |
| 2894 | Who is talking, and who wants to (level meters, raised hands) |
| 3033 | The stage is patched, never rebuilt ← read this before touching group calls |
| 3984 | The local file manager |
| 7455 | Call history — a log you can actually manage |
| 6717 | The settings section, and the group panels |
| 7587 | Keeping the reader's place across a re-render ← and this before touching the thread |

Two functions are load-bearing far beyond their size:

- **`renderMessages()`** rebuilds the whole thread and is called from ~45 places.
  Everything about scroll position, entry animations and media hydration hangs
  off it.
- **`renderGroupCallStage()`** used to do the same for calls and now deliberately
  does not — see §5.

---

## 3. Architecture, in one page

**Nothing is decrypted anywhere but on the two devices.** The relay sees
envelopes; when a peer is offline it stores those envelopes and forwards them
later, still sealed. That constraint is why several things look harder than they
need to:

- **Transport** is PeerJS/WebRTC data channels, with the relay as fallback. Every
  message goes through `safeConnectionSend()` first and `sendRelayEnvelope()`
  second. Check the return value — ignoring it is how "delivered" once lied.
- **Session keys** are RSA-OAEP-3072 wrapped AES-256-GCM. `chatState.sessions`
  holds them per peer.
- **Groups have no server.** A group is a record every member holds, and a group
  message is N direct sends. `groupDeliveryMemberKeys()` is the list; note that
  `normalizeSpaceMembers()` deliberately strips *you* from it, which is right for
  delivery and wrong for the roster, and has caused two bugs.
- **Group calls are full mesh** — N(N-1)/2 legs, no SFU, because an SFU is a
  server that decrypts media. Practical to about 6–8 people. Glare is avoided by
  a fixed rule: the smaller fingerprint places the call (`shouldPlaceCallTo`).
- **At-rest media** lives in IndexedDB `poorija-media`, encrypted with a key
  derived from the master password; `poorija-stickers` holds packs and sounds.
- **The master password** is Argon2id (PHC string in `poorija_master_hash`), with
  silent migration from the old bare SHA-256.

---

## 4. `css/styles.css`, and why it is 18,000 lines

The file is a stack of dated layers. Each one opens with a banner:

```
/* ============================================================
   v113 — the four call sections sit on one row
   ...what was wrong, measured, and what this layer asserts
   ============================================================ */
```

Layers v94 → v113 are the last year of fixes. **Do not edit an old layer to
change behaviour** — you cannot know what else leans on it. Append a new one.

The rule that makes appending work, learned the hard way:

> A new layer must state the geometry **completely**, and specifically enough to
> win. That means `!important` on every geometric property *and* explicitly
> zeroing `min-width` / `min-height` / `max-width` / `max-height`.

The group-call sliver bug was exactly this: v98 restated width, height, inset and
aspect-ratio for the call tiles but left `min-height: clamp(18rem, 54dvh, 31rem)
!important` from an older layer standing. The moment the remote view became the
small tile, that minimum stretched it into a 104×524 strip.

Specificity in this file runs to two ids plus several classes
(`html body #chatFloatingCall:is(#chatFloatingCall) …`). That is not decoration;
it is what it takes to outrank what came before.

---

## 5. Traps that have already cost time

**Re-rendering media destroys media.** Writing `innerHTML` throws away every
`<video>` and builds new ones. Desktop Chromium survives it; iOS Safari loses the
decoder and the picture simply goes, and Android freezes the local preview while
the far side keeps receiving. The group-call stage is therefore *patched* —
tiles are created once and `srcObject` is assigned only when the stream object
actually changes. Keep it that way.

**A detached `event.target` answers `null` to `closest()`.** If a click handler
re-renders its own container, any handler further up the bubble chain sees a node
that is no longer in the document — and "is this click inside the panel?" comes
back false. Use `event.composedPath()`, which is captured at dispatch. This is
why picking a sticker pack used to close the sticker panel.

**`event.target.value = ''` before reading `.files` empties the FileList.** It is
live. Copy with `Array.from()` first.

**Measure with `offsetTop`, never `getBoundingClientRect()`**, anywhere near the
message thread. `.chat-messages-panel` scrolls smoothly and bubbles animate in
with a transform, so a rect read during the animation reports a position the
layout never had — worth about 7px of drift per render.

**A multicol box with a definite height overflows sideways, not down.** Columns
are for the *content* block; the scrolling must happen on a wrapper around it.
Otherwise tall items fragment and a caption ends up at the top of the next
column, away from its picture.

**Grid auto-placement only moves forward.** If you give one child
`grid-column: 2` and the next `grid-column: 1`, the second lands on the *next
row*. Set `grid-row` too.

**A grid whose only column is `auto` is as wide as its widest child.** One long
TURN address dragged an entire settings pane 442px out of its card. Use
`minmax(0, 1fr)` and let long strings wrap.

**`min-height` beats `height`** no matter how specific the height rule is.

**`position: relative` reads `top`/`left` as offsets from where the element
already sits**, not as a position inside the parent. A block written for
`position: absolute` — `inset: 50% auto auto 50%; transform: translate(-50%,
-50%)` — keeps working until someone switches the element to `relative` and
does not clear the inset; then it lands half a viewport down and across. That
is how the person you were calling ended up in the bottom corner of the screen
while the pulse rings went on beating in the middle. Clear `inset` and
`transform` together with the switch, or do not switch.

**A negative offset that moves a fixed element has to be paid back as size.**
The tab bar is pushed down by `--tabbar-bottom-shift` so its row reaches the
glass on iOS, where a fixed element's `bottom: 0` can resolve above the real
bottom. Moving it alone opens a strip above it and, once the measurement passes
the bar's own height, carries the navigation off the screen entirely — which is
what happened. The bar therefore grows by the shift and pays it back as
`padding-top`: the row travels, the box bridges. Anything that measures itself
and then moves needs a bound that keeps it reachable, and `syncTabBarAnchor`
has one — it re-measures a *button*, not the box, because the box's top edge no
longer moves.

**A wipe that leaves the app running can undo itself.** The emergency wipe
closed the relay socket, which woke the reconnect logic, which called
ensureIdentity(), which read the identity back out of storage that had not been
cleared yet — so the wipe restored what it had just deleted. Stop the machinery
before deleting what it feeds on: shouldReconnect off, timers cleared, and a
chatState.wiped flag that refuses to build another identity for the life of the
page. The same class of mistake made deleteDatabase silently do nothing: an
open connection blocks it, the browser answers "blocked" rather than failing,
and the database is still there afterwards. Close the handles first.

**One exchange per connection, and only one side may start it.** The ephemeral
key exchange was written so both ends offered. Each then derived from the
exchange it had started, both reported a healthy negotiated session, and
neither could read the other. Two more of the same family followed: the
non-owner's "key never arrived" timer fired mid-exchange and minted a key of its
own, and mintSessionKey is reachable from three places, so extra offers made the
far side answer again with a fresh ephemeral and move to a key the first side
had already replaced. Print the key on both ends when a session will not
decrypt; the answer is always in which key each side is holding.

**Sealing the session key to a prekey achieves nothing.** The recipient already
holds that session key on disk and opens the body with it directly, so the
prekey's expiry changes nothing. A queued envelope needs a key that exists
nowhere else — generate one per envelope, seal that, and the window becomes
real.

**A missing band is not necessarily below you.** `applyTabBarEdgeMode()` takes
`screen.height - innerHeight` and pushes the tab bar down by it, on the theory
that the OS is keeping a strip under the window. On an installed iPhone app
that does not cover the status bar the shortfall is the strip *above* it:
932 - 873 = 59, and `env(safe-area-inset-top)` is 59 as well. The web view's
bottom edge is already the screen's bottom edge, so that push moved the buttons
to 866..932 with the viewport ending at 873 — the navigation left the screen.
The rule now: when the shortfall is accounted for by the top inset, do not
engage. And whatever the arithmetic says, the button row is measured after the
shift and the shift is dropped if the row is no longer inside the viewport —
including when a stored preference asked for it. A device that reports
contradictory geometry can be argued with; a bar nobody can reach cannot.

**A helper named `hide…` hides; it does not clear.** `hideIncomingCall()` stops
the ringtone and removes the modal, and three of the four ways a ring can end
cleared `pendingIncomingCall` themselves. The fourth — the caller hanging up
first — called only the hider, so `isCallBusy()` stayed true for the rest of the
session and every later call, placed or received, was refused. There is one
`clearIncomingCall()` now and all four routes go through it.

**A call is one thing that changes state, not a stream of things.** Anything that
logs per lifecycle event will produce a row per event. `appendCall()` keeps one
open row per peer and merges into it; a notice from the far side may only
update, never open (`updateOnly`), and a genuinely standalone entry says so
(`standalone`). Direction is written when the row opens and never rewritten.

**Android freezes the webview in the background, and no amount of resuming
undoes it.** A foreground service keeps the process resident — `oom_score_adj`
50, never reclaimed — but `WryActivity.onPause()` calls `WebView.onPause()` and
a lifecycle observer then calls `Rust.pause()`. Calling `onResume()` and
`resumeTimers()` back, seven times over several seconds, produced zero timer
ticks in a 100-second window on Android 15. The renderer is frozen by the
platform. Anything that has to reach a backgrounded app needs FCM or
UnifiedPush; Web Push is not available because Android's WebView does not
expose the Push API to service workers.

**An offline peer used to make the sender give up, not queue.**
`ensureDirectSession()` returned a session with no `cryptoKey` whenever
`peerRecord.status === 'offline'`, and every send path answered that with
`markMessageStatus(..., 'failed')` and "the secure session is not ready". The
message was never handed to the relay — not delayed, not queued, gone. It
looked intermittent because a pair who had chatted before had a stored key, so
the check passed and delivery worked for them.

The fix is per-envelope sealing, and the shape matters: **do not mint a shared
session key for offline use.** Two peers who write to each other while both are
away would each mint one, each accept the other's, and each then encrypt under
a key the other had just discarded — unreadable in both directions, with no
error anywhere. `sealSessionKeyFor()` wraps the sending session's key to the
recipient's RSA-OAEP-3072 public key and `offlineEnvelope()` carries it, so
each envelope stands alone. `handleOfflineRelayMessage()` swaps the unsealed
key in for exactly one message and puts the session's own key back afterwards.

**`confirm()` is truthy in the native shell, and `prompt()` is null.** wry
implements none of WKWebView's JavaScript dialog delegates, and it does not
fail loudly either. Measured from inside the running app:

```json
{"ctor": "Promise", "truthy": true, "promptType": {"isNull": true}}
```

`window.confirm()` hands back a **Promise**, and a Promise is truthy — so
`if (!confirm('are you sure?')) return;` never returned, and every destructive
confirmation in the suite was silently approved: the file shredder, key
deletion, "reset everything". `window.prompt()` returns `null`, which is why
the chat lock could not be switched on: the PIN came back null and the toggle
flipped itself back off.

`js/dialogs.js` replaces all three with in-page modals that behave the same in
the browser build and the native one, and can mask a PIN — which the real
`window.prompt` never could. They are asynchronous, so call sites `await`
them; a dozen event handlers had to become `async` for that.
`tests/e2e/native-shell.mjs` fails the build if a bare `confirm`, `prompt` or
`alert` call reappears in shipped JS.

**A CSP nonce silently disables `'unsafe-inline'` — and this UI is 262 inline
handlers.** Tauri injects a nonce into `script-src` and a hash for every inline
`<script>`, then appends them to the policy. Per the CSP spec, a directive that
carries a nonce or a hash *ignores* `'unsafe-inline'` — so setting any `csp` in
`tauri.conf.json` kills all 192 `onclick=` and 70 `onchange=` attributes in
`index.html`. The window opens, every script loads, every global is defined,
and nothing responds to a click. `dangerousDisableAssetCspModification:
["script-src", "style-src"]` is what keeps the policy as written.
`tests/e2e/native-shell.mjs` reproduces Tauri's modification and clicks a real
inline handler, which is the only way a test can fail where the app would.

**App Nap freezes a hidden macOS window.** With all windows hidden — the normal
state for "keep running in the tray" — macOS coalesces timers and defers
callbacks; measured here, a `setTimeout(…, 3000)` had not fired a minute later
and IPC replies never arrived. `NSAppSleepDisabled` in `src-tauri/Info.plist`
opts out. If you are debugging the native app and its JavaScript seems dead,
check `ps -o stat` first: `SN` means napping, not broken.

**`cargo build` in `src-tauri/` does not build the app you think.** Without the
Tauri CLI the crate compiles in dev mode, which swaps `frontendDist` for
`devUrl` — the binary then loads `http://localhost:4173`, nothing is serving
it, and the window stays blank. Use `npx tauri build --debug` for a fast bundle
that embeds the real assets.

**`on_page_load` fires `Started` against the outgoing document.** Anything
`eval`-ed there runs in a context that is discarded the instant the new
document commits, so registered timers never fire and every global reads
`undefined`. To probe the real page, put the probe in the frontend.

**RTL:** `inset-inline-end` maps to `left`. Declared after `left`, it silently
wipes it — and the shorthand `inset-inline` wipes both. For anything a drag
writes coordinates into, use physical `left`/`right` only.

**Playwright:** `isMobile: true` / `hasTouch: true` trips the PWA install gate,
`checkFirstVisit()` returns before setup runs, and `#mainApp` stays at
`opacity-0` — every screenshot comes out blank. Use a narrow viewport instead.

---

## 6. Tests

```bash
npm test                     # jest unit tests   (config/jest.config.cjs)
node tests/e2e/smoke.mjs     # 30 seconds: does this tree boot and wire up
npm run test:e2e             # 69 browser suites, run-all discovers them itself
npm run test:files           # file transfer, 36 checks (FT_HUGE=1 adds 450 MB)
npm run test:offline         # delivery to somebody who is not there
npm run test:retention       # what the relay keeps and for how long
```

`test:files`, `test:offline` and `test:retention` also run against a deployed
server, which is worth doing after `npm run deploy:remote`:

```bash
PKG_URL=https://your-host:8585 RELAY_URL=https://your-host:8585 \
REMOTE_STORE_CMD=./read-remote-store.sh \
npm run test:files
```

`REMOTE_STORE_CMD` must print the whole store as one JSON object,
`{ fingerprint: [envelope, …] }`. The relay keeps **one file per recipient**
under `data/mailboxes/` — a write costs one person's queue instead of every
queued message on the server — so `cat offline-messages.json`, which this
document used to suggest, now reads a file that no longer exists. It printed
nothing, the reader turned that into `{}`, and three queueing checks reported
that the relay had queued nothing when it had queued everything correctly. A
failing store command is now an error rather than an empty mailbox, and the
command that works is:

```bash
#!/bin/bash
ssh you@your-host "docker exec Poorija-Cryptography_ChatSignal node -e '
  const fs = require(\"fs\"), d = \"/data/mailboxes\", o = {};
  if (fs.existsSync(d)) for (const n of fs.readdirSync(d))
    if (n.endsWith(\".json\")) o[n.slice(0, -5)] = JSON.parse(fs.readFileSync(d + \"/\" + n, \"utf8\"));
  process.stdout.write(JSON.stringify(o));
'"
```

`smoke.mjs` needs neither a second peer nor the relay, so it is the right first
thing to run after any change — and after unpacking this archive on a new
machine.

The end-to-end suites are the ones that matter here, and `tests/e2e/README.md`
explains what each covers and how to write another. They drive two or three real
browsers against a live relay and assert on **measured** values — box widths,
video element identity, aspect ratios, bytes on disk — because every bug in this
list shipped past something that looked right.

Run one while you work on it:

```bash
node tests/e2e/gcallui.mjs
```

Give the sweep the machine. Every suite drives two or three real browsers, and
running anything else alongside it does not just slow the run — it makes the
timing-sensitive assertions flaky for reasons that have nothing to do with the
code. A sweep run beside four other browser suites took hours and got a third of
the way; alone it does not.

Three worth knowing by name:

```bash
npm run test:localroom       # the many-person room: brokering, per-link keys,
                             # files, calls, the sixteen, and every ceiling
npm run test:qraudit         # every QR the app can draw, read back after a
                             # phone camera has had its way with it
npm run test:qrkit           # the kit itself: packing, decoding, presentation
```

And four static audits, which cost a second each and have each found something
real. `deploy.sh` refuses to deploy if any of them reports a finding:

```bash
node tools/audit-dom.cjs        # ids the markup lost, i18n keys with no entry
node tools/audit-i18n.cjs       # strings that would show Persian to English
node tools/audit-handlers.cjs   # onclick=" " calling nothing, uncached scripts
node tools/check-relay-pins.cjs # the relay image versus this tree
```

---

## 7b. Two behaviour changes worth knowing about

**Public STUN is now conditional.** `stun.l.google.com` and
`global.stun.twilio.com` used to be in `peerOptions()`'s ICE list on every
call, including for someone running their own relay and TURN precisely so that
no third party would see their traffic — and a STUN binding request tells that
third party the device's public address and that a call is starting. The list
is now built the other way round: your own TURN first, the public servers only
when no TURN is configured, because with no STUN at all a call across two NATs
does not connect. `chatState.profile.publicStun` is tri-state — `true` forces
them on, `false` forces them off, `null` (the default) means "decide from
whether a TURN server is set". The toggle is in Connection settings.

If you had no TURN configured, nothing changes. If you did, your calls now stop
touching Google and Twilio, and a call that used to connect through public STUN
alone will now depend on your TURN server actually working.

**External links open in the system browser.** Every external link in the UI
carries `target="_blank"`, and Tauri denies new windows — so in the native
shell "Open in maps" and the licence link did nothing at all. A capture-phase
click handler in `js/desktop-bridge.js` now hands http(s) URLs to
`desktop_open_external`, which validates the scheme and spawns the platform
opener. Letting the link navigate in place was the other option and is worse:
it replaces the app with a web page in a window with no back button.

## 7c. The offline queue

`scripts/server.js` holds one mailbox per recipient fingerprint in
`offline-messages.json`, and `sweepRetention()` decides what stays:

| class | kept | why |
|---|---|---|
| `text` | until collected, capped at 5000 items | a few hundred bytes; losing someone's message because they were away a fortnight is not a resource decision |
| `media` | 7 days, 512 MB per recipient, oldest evicted first | megabytes each |

Anything dropped leaves a row in `expiry-log.json` — recipient, sender, class,
reason, timestamps, nothing from the body — kept 30 days and handed over as an
`expired-notice` frame the next time that recipient connects. The client turns
it into a system line in the thread.

The relay can only tell text from media because the sender labels the envelope
`class`. That label, the two fingerprints and the timestamps are the whole
metadata cost. The body stays sealed.

Retention is swept on a 15-minute timer, on every enqueue, and again just
before delivery, so a recipient is never handed something that should already
have expired.

## 7d. File transfer

Files are sliced, encrypted and sent one chunk at a time. Nothing larger than a
single chunk is ever held in memory, base64-encoded, or turned into a JS string
— and on the receiving side nothing larger than one flush buffer, because
`flushReceivedChunks()` moves each finished run of chunks into a Blob as it
arrives rather than holding the file until the last one lands.

| | |
|---|---|
| chunk | 64 KB (`FILE_CHUNK_BYTES`), its own AES-GCM IV each |
| over a live channel | raw bytes in `bin` — BinaryPack carries a `Uint8Array` intact |
| over the relay | base64 in `chunk`, one sealed envelope per chunk |
| ceiling, peer online | 4 GB (`MAX_FILE_BYTES`) — peer to peer, so the devices bound it, not a server |
| held by the receiver | 4 MB (`TRANSFER_FLUSH_BYTES`) of heap, whatever the file's size |
| ceiling, peer offline | 100 MB (`MAX_OFFLINE_FILE_BYTES`) — one file must not take a recipient's whole 512 MB mailbox |
| kept in the device vault | up to 64 MB (`MEDIA_VAULT_MAX_FILE_BYTES`); above that the message keeps its object URL and offers a download |

`file-start` carries `v: 2`. A transfer without it is read the old way — one IV
for the whole file, base64 sliced into 48 KB text chunks — so anything an older
client already queued on the relay still opens.

Four things here are load-bearing, and each replaced a bug that presented as
"the file is stuck on sending":

- **`awaitChannelDrain()` before every send.** PeerJS gives up quietly twice
  over: past 8 MB unsent it pushes frames into an unbounded array, and if
  `RTCDataChannel.send()` throws it calls `close()` on the connection. Neither
  raises anything the app can see. Staying under 4 MB means neither happens.
  Note that `bufferedamountlow` does not fire on every WebKit build, which is
  both desktop engines here — hence the poll alongside it.
- **`transfer.seen`, a Set of indices.** Counting arrivals meant one
  retransmitted chunk completed a transfer with a hole in it. PeerJS's own
  chunk assembler still has exactly this bug (`n.count === n.total`), which is
  why `tests/e2e/filetransfer.mjs` replays a whole application message rather
  than a single wire frame.
- **A `Blob` built from the decrypted pieces.** `chunks.join('')` crosses V8's
  maximum string length somewhere past 384 MB and throws outright.
- **A repeated `file-start` is ignored.** It used to replace the transfer in
  flight, discarding every chunk already received.

`npm run test:files` covers it: 1 MB, 20 MB and 120 MB peer to peer with a
duplicated message in the middle, the queued path verified by rebuilding the
file from the relay's own mailbox with the recipient's private key, both
ceilings, and the progress read-out. `FT_HUGE=1` adds a 450 MB pass.

## 7e. The room, and the five bugs its review found

None of these failed a test, because no test existed for them yet. They are
here because each is a shape that recurs.

**Two names for one link.** The mesh keys every member on the identifier that
member chose for itself. The handover from `local-link` invented one locally
instead, so the two devices used different names for the same connection; the
roster then told each device to connect to itself, and a room of two reported
three. The identity now travels in the pairing payload — `mesh:` in the offer
and the answer — so both sides agree before the channel opens.

**Inviting hung up.** "Invite one more person" restarts the pairing card, which
resets `local-link`, whose first act was to close its channel — a channel it had
already given to the room. `resetLink` now closes nothing it has handed over.

**A polite departure was handled; an impolite one was not.** `bye` removed the
member and closed the connection. A lid closing only set a state flag, so the
roster kept a member that was gone, still holding its peer connection and its
share of the sixteen. Both paths now end in `dropMember`, and the host tells the
rest of the room.

**The next room inherited the last one.** `begin()` did not clear the
transcript, so pairing again opened on the previous conversation. Nothing had
leaked anywhere — it never leaves the device — but a tool whose promise is that
a room leaves nothing behind should not be the thing holding the last one.

**Numbers from the wire decided allocations.** `file-start` carried a chunk
count that went straight into `Array.from({ length: total })`, so any member
could end another member's tab with one message. Counts now come from the chunks
that arrived; indices outside the transfer are dropped; the transcript, the text
length, and the number of transfers one member can have open are all bounded.

Two more found by reading rather than by testing: `esc()` in `local-room.js`
fell back to the identity function when the main app module had not loaded,
which would have put a peer's message into `innerHTML` raw; and `startCall`
threw out of its `addTrack` loop, leaving `room.call` set and the microphone
live while the room reported that the microphone was unavailable.

---

## 7f. Why a QR can be perfect and still not scan

Four separate answers were wrong before the right one, and every one of them was
found by LOOKING at a picture rather than reasoning about a boolean.

**The buffer is not the screen.** `qrkit` and `qraudit` decode
`canvas.toDataURL()`. A camera does not see a buffer; it sees a rendered page,
after every stylesheet, every resize to fit a container, every device-pixel
scale, and whatever else the page painted on top. `qrscreen.mjs` screenshots the
region a person would point a camera at and decodes that. It is the only suite
that can see any of what follows.

**Rounding the pixel ratio.** `Math.round(2.75)` is 3, so the bitmap came out
bigger than the device pixels it was painted into and the browser scaled it
DOWN — 1421 into 1320 — blurring every module edge. A screenshot still decodes
that, because the screenshot IS the resampled image. Only fractional ratios hit
it: 2.75 on that Android, 3 on that iPhone, 1 on every desktop this was written
on. The kit now fits an integer module size inside the pixels available and sets
the CSS size to bitmap ÷ ratio, so one bitmap pixel is one screen pixel, and
`qrscreen` asserts that number rather than trusting it.

**A close button on a finder pattern.** `.qr-boost-close` was positioned against
the inner box at `inset-inline-end: -0.5rem` — outside the corner on a wide
screen, and on a narrow one, where that box is clamped to the viewport, squarely
on the symbol. In Persian the inline end is the LEFT side, so it landed over the
top-left finder pattern: one of the three squares a reader locks onto before it
can read anything. Pinned to the overlay now, so the gap grows with the screen
instead of shrinking into the code.

**And two that were the harness lying.** On a mobile user agent the app shows
the install gate at z-index 9999 and the language screen before the
registration form, whose button stays disabled until three DIFFERENT security
questions are answered — so a harness that filled the form and pressed the
button changed nothing, and every later measurement photographed the
registration screen. `qrscreen` now simulates an installed PWA
(`navigator.standalone` plus the display-mode query), picks the language before
load, fills what `isSetupFormReady()` actually checks, and asserts the button
became enabled. It also keeps the picture of anything that fails to read, which
is how three of these were found at all.

---

## 8. Where the risk is

Honest assessment, so you know where to tread.

- **`js/chat.js` is one 15,000-line file.** It works and it is heavily commented,
  but any real feature now touches three or four distant sections. If you ever
  split it, the natural seams are the banner comments in §2.
- **`css/styles.css` is append-only by convention.** The convention holds only as
  long as new layers restate geometry completely (§4).
- **Group calls are mesh.** Every participant uploads to every other one. Four
  people on a phone is fine; eight is not. There is no fix that keeps the
  server out of the media path.
- **Mobile screen capture is impossible from a browser**, and no amount of
  permission plumbing changes it. `getDisplayMedia` does not exist in iOS Safari
  or Android Chrome. The picture-presenting path exists because of that.
- **The relay is a single point of availability** (not of confidentiality). If it
  is down, peers who have never met cannot find each other; peers with an open
  data channel keep talking.
