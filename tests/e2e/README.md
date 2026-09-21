# End-to-end suites

<div dir="rtl">

این تست‌ها مرورگر واقعی را روی برنامهٔ در حال اجرا می‌رانند: دو یا سه پیر همزمان،
رلهٔ واقعی، WebRTC واقعی. هیچ‌کدام snapshot نمی‌گیرند — همه چیز را **اندازه می‌گیرند**
(عرض جعبه، نسبت تصویر، شناسهٔ عنصر ویدیو، بایت روی دیسک) چون هر باگی که تا حالا
به کاربر رسیده، از جایی آمده که فقط اندازه‌گیری آن را نشان می‌داد.

</div>

## Running them

For an isolated local stack (fresh relay stores and automatic shutdown):

```sh
npm run test:local -- release37 release36 callquality
E2E_ENGINE=webkit npm run test:local -- release37
npm run test:local # all suites
```

`release36` covers production vault locking, portable profiles, identity concurrency,
call adaptation/codecs and mobile call-overlay geometry. Set `E2E_SCREENSHOT` to
an absolute PNG path to also capture its mobile layout fixture.

The app has to be up first — the suites talk to a live relay, not a mock.

```bash
docker compose -f config/docker-compose.yaml up -d
npm run test:e2e
```

One suite at a time while you are fixing something:

```bash
node tests/e2e/gcallui.mjs
npm run test:e2e -- calls gcallui
```

Against another machine or port:

```bash
PKG_URL=https://box.local:8585 npm run test:e2e
```

### A self-signed certificate fails suites that are not broken

The local stack serves `https://localhost:8585` with a self-signed certificate.
Playwright's `ignoreHTTPSErrors` covers what the page fetches; it does NOT cover
the service worker script, and it does not cover the relay probe the app makes
before it will call itself connected. On that origin you will see, all from the
one cause:

  - `smoke` and `tabsweep`: "An SSL certificate error occurred when fetching
    the script" written to `console.error`;
  - the send, attach and voice buttons disabled, because the relay probe failed
    and the app says "Relay server is not configured" while its WebSocket is
    open and messages are flowing;
  - `chataudit`'s text section failing every case while its file cases pass over
    the same channel — the button it clicks is the disabled one.

Run those over the plain-HTTP dev server instead, where every one of them passes:

```bash
npm run relay                      # terminal 1
PORT=8123 npm run dev              # terminal 2
PKG_URL=http://localhost:8123 node tests/e2e/smoke.mjs
```

Screenshots land in `tests/e2e/screenshots/` (git-ignored). The whole set takes
about 25 minutes; a single suite is 2–6.

## What each one covers

| suite | checks | what it proves |
|---|---|---|
| `smoke` | 18 | 30 seconds, no peers, no relay: the tree loads, every asset resolves, setup completes, the chat tab is wired. Run this first. |
| `calllayout` | 30 | one-to-one call: cover/contain fitting, self-view aspect, swap, the control pill on an installed iPhone, tap-to-show-controls, the six-emoji key |
| `gcallui` | 42 | group stage: masonry, captions, pinning, presenting (screen + picture), reactions, raised hands, speaking indicator, and that repeated state changes never replace a `<video>` element |
| `gcall` | 18 | the mesh itself: invite, join, three-way audio/video, leave, last-one-out |
| `groups` | 37 | Telegram-parity group features: roles, permissions, mentions, invites, delete-for-everyone |
| `settingsui` | 32 | the settings tabs, pane overflow, the chat-lock rows, the collapsible group panels |
| `filemgr` | 17 | the local file manager: the donut, categories, search, save, delete, survival across a reload |
| `scroll` / `scrollmob` | 20 + 20 | the thread keeps its place across re-renders, desktop and phone |
| `calls` / `callvideo` / `callfix` | 20 + 10 + 27 | placing, answering, the call chrome, every dock control |
| `stickers` | 27 | four import paths, sending, sharing a pack |
| `persist` | 16 | the encrypted media vault survives a reload |
| `batch4` | 24 | polls, location, contact cards |
| `final3` | 25 | Argon2id master password, encrypted vault backup and restore, swipe-to-reply, multi-select |
| `security3` | 16 | chat lock, global search, safety numbers |
| `audit` | 19 | boot, unlock, reconnect, send-after-lock |
| `callreal` | 17 | two peers, real calls: one answered call is exactly one row on each side and in the right section, a declined call likewise, and the four section tabs share one line |
| `calllog` | 25 | the call log: sections, grouping, search, and every deletion path — one call, one run, one section, older-than-30-days, the lot |
| `uifix` | 10 | sticker pack switching, the chat-lock font |
| `locallink` | 38 | two devices, one Wi-Fi, no server: pairing by QR and by clipboard, the safety phrase, a 4 MB file byte-exact, a tampered frame refused, and the proof that no candidate ever leaves the local network |
| `localroom` | 39 | the many-person room: a third person joining costs one pairing, every pair holds its own key and cannot read the others', files with no ceiling, audio and video across the room, the sixteen, every bound (transcript, text length, transfers in flight, sticker URLs), a member who vanishes without a goodbye, and a fresh room that does not inherit the last one |
| `qrkit` | 21 | the QR kit: packing, decoding through both paths, camera switching, and the bright presentation sitting above the dialog that opened it |
| `linkroomfit` | 25 | the room fitted to a phone: a notice that stays above the highest layer the app defines, pickers that take a selection rather than one file, a back button inside its header and a way back in after pressing it, send under the right thumb, names and faces for people and for the room, the list of who is here, and closing the room for everybody |
| `qrscreen` | 42 | every QR the app draws, decoded from a SCREENSHOT of the screen rather than from the buffer behind it, at two phone sizes and a desktop, driven through the app's own buttons. The buffer-reading suites all passed while the bright view's close button sat on top of a finder pattern on a narrow phone — a code perfect in memory and undecodable in a photograph |
| `androidqr` | 7 | the two bugs a phone reported: one element instead of the encoder's canvas-and-image pair, and the bright view carrying the same code as the dialog rather than the previous one |
| `othercodes` | 8 | the two codes nothing else covers — two-factor enrolment and the donation wallet — because both go through the same render() and neither had a suite when it was rewritten |
| `linkroomui` | 26 | the room through its own buttons on a phone: full screen, one composer, all nine composer actions, location and contact cards, hidden and self-destructing messages, and a call answered from BOTH seats — ringing, joining, the call bar, hanging up and declining |
| `qraudit` | 16 | the strict audit: every code the app can draw, at the size and error-correction level of the call site that draws it, read back after distance, soft focus, tilt, low light and glare — plus four deliberately unreadable codes the audit has to catch, because an audit that approves of everything measures nothing |
| `monitor` | 34 | the relay's own dashboard: every auth path, the counters, retention, and disconnecting a client |
| `stress` | 8 | the relay under load from several processes at once |
| `callquality` | 22 | the call-quality panel where it belongs — inside the call, not three taps away in settings |
| `tabsweep` | 13 | every tab opens, has a help entry, and shows no untranslated string |
| `chatticks` | 17 | what happens when a message arrives, between two real peers: one toast per arrival and one entry in the thread, the three tick states (one tick, two ticks, two ticks in colour), a replayed message that must not demote a read one, and the read colour measured against every theme's own bubble at the 3:1 contrast bar |
| `swnotify` | 34 | the service worker's push handler: one notice per message and none at all while the app is on screen, several arrivals counted on one row rather than stacked, calls kept apart from chat, the count in the device's own language, that an engine which ignores the tag (WebKit) counts 1..7 rather than 1,2,4,8,16,32,64, and that the Badging API is called from worker scope on WebKit only |
| `chatappearance` | 61 | Secure Chat's settings sections hold what belongs in them (appearance, chat notifications, files & privacy — and the app's own notification switch stays in the app), plus the whole appearance card: six chat themes, both bubble colours, opacity, corner rounding, magnification, seven background presets and an uploaded picture through IndexedDB, five tick profiles, three tick pickers, the measured contrast, a live preview built from the real thread's own classes that names what just changed, and that a chosen colour survives a reload — which it only does once the profile is unlocked, because the preference lives in that profile's namespace. Every chat theme's bubble text is measured at 4.5:1 against its own bubble, and so is a bubble colour the user picks. The background is checked on the REAL thread as well as the preview: that it lives on ONE layer behind the header, the panel and the composer together, that nothing inside paints a second copy, that the header and composer let it through rather than stopping it, and that the blur slider reaches the layer. The notes in Files & privacy are checked for stacked opacity |
| `controls` | 11 | one look for every switch, checkbox and radio, on all fifteen themes: each kind agrees with itself, all follow the theme's control colour rather than one fixed in the stylesheet, a switch knob looks the same on as off (only the track's colour says which, so the knob never vanishes into an accent-coloured track), every switch in the app makes the same journey including Secure Chat's, and four contrast bars are measured per theme — the control against its surface, the tick inside it, body text and muted text |
| `awaypush` | 13 | a backgrounded phone: an app that stops heartbeating or says it is going away reads as away rather than online, and the next message is BOTH delivered live and pushed — before this, a registered-but-frozen socket got the frame and no notification |
| `calltuning` | 9 | what the connection is told before it carries a call. peerOptions() passed iceServers and nothing else, so bundlePolicy, rtcpMuxPolicy and iceCandidatePoolSize were left at the engine default — on WebKit that is `balanced` with a pool of zero, so candidates were gathered only once a call was already being placed. Tracks carried no contentHint, so the encoder had to guess between a face and text. Asserted against a real RTCPeerConnection's own getConfiguration(), which reports what was applied rather than what was asked for. |
| `callchrome` | 15 | three things about a call that using it made obvious: auto-lock counted a call as idle and tore the media down mid-sentence, `formatDuration` had no ceiling on minutes so ninety minutes read as "90:45", and the call log said how long a call lasted but nothing about what it moved. Drives the guard and the formatters directly rather than placing a call, which a headless run cannot do. |
| `atrest` | 8 | nothing secret is left readable in localStorage. The generated-password list went in through a bare `JSON.stringify` while every chat store around it went through `encryptStorageData`, so anybody with the browser profile directory read it without the master password. Also pins the one deliberate exemption: `poorija_2fa` stays in the clear because `verifySecondFactor()` runs before `adoptProfile()`, and the suite asserts that record carries the second factor and nothing more. Creates a real profile — language screen first, or the question selects hold no options and the setup button never enables. |
| `pushrenew` | 11 | the background-notifications switch means "this will ring", not "somebody turned it on once". registerWebPushSubscription ran from two Settings controls and nowhere else, so once an endpoint was rotated or pruned it stayed gone and the switch went on reading "on" over a relay with nothing to push to. Reconciles on unlock and on returning to the foreground, against a stubbed PushManager; asserts a restart re-registers WITHOUT calling subscribe() (WebKit wants a tap for that), that a lost subscription turns the switch off and says why, and that repeats inside one session do not hammer the relay. |
| `chatmenustack` | 8 | the thread header's dropdown opens OVER the conversation once a chat background is chosen. The background layer arrived with a blanket `.chat-thread > * { z-index: 1 !important }`, which flattened header, message panel and composer onto one level — siblings sharing a z-index paint in DOM order, so stickers and text covered an open menu. Asserted with elementFromPoint, on every preset and on the no-background case. |
| `pushurgency` | 8 | what the relay puts on the wire when it wakes a phone: `Urgency: high` so FCM and APNs deliver through Doze instead of holding the message until the device is picked up, a chat notice that expires in a day rather than the library default of four weeks, and a call notice that expires in minutes. Brings its own relay and a TLS stand-in for the vendor, because web-push always speaks https and this suite has to read the headers, not just count the connection. |
| `bigfile` | 11 | the 4 GB live ceiling has to be one the receiver can reach. Every decrypted chunk was kept as a Uint8Array until the last one arrived, so a file's peak cost was the file — survivable at 500 MB, impossible at 4 GB, because no tab has a 4 GB heap. flushReceivedChunks() moves finished runs into Blobs, whose bytes live in the blob store rather than the heap. Every assertion ends at a SHA-256, not a byte count: a transposed file has the right length far more often than it has the right hash. Also pins that the flush stalls at a gap rather than writing past it, which is what the file-resend path can leave behind. |
| `sendsession` | 18 | "this contact is offline" was the wrong thing to say to somebody whose recipient was online and typing. A direct conversation has two states that looked identical from the composer — the peer is away, and the peer is here but the channel has not been opened — and the second refused any file over MAX_OFFLINE_FILE_BYTES with the wrong reason. The send now offers to create the secure session first. Most of the suite asserts the times it must stay SILENT (open channel, small file, group, a peer genuinely away), because an advisory that appears on every attachment stops being read. |
| `stickerthumbs` | 11 | every pack row in the sticker manager shows a strip of its own stickers, capped with a "+N", and an empty pack shows no strip |

## Writing another one

Copy the top of any suite: `app()` does the whole onboarding (setup wizard,
profile, connect) and hands you a page. `imp()` pastes one peer's identity into
another's manual-add box, which is how two harness peers find each other without
depending on discovery.

Three traps, all of which have cost real time:

- **`isMobile: true` / `hasTouch: true`** makes `checkFirstVisit()` show the PWA
  install gate and return *before* setup runs, so `#mainApp` stays at
  `opacity-0` and every screenshot is a blank dark page. Use a narrow viewport
  instead — the app's own `mobile-browser-context` keys off `innerWidth`, not
  touch. If you genuinely need touch, remove `hidden`/`opacity-0` from
  `#mainApp` and hide `#lockScreen` after `#setupBtn`.
- **The shared relay advertises real devices.** Pick peers by fingerprint, never
  by display name — every harness peer boots with the same default name.
- **Measure with `offsetTop`, not `getBoundingClientRect()`**, anywhere near the
  message thread or a call tile. `.chat-messages-panel` scrolls smoothly and
  bubbles animate in with a transform, so a rect read mid-animation reports a
  position the layout never had.

## One call, one row

`calldup` guards the call log against a completed call being logged twice, the
second time as missed. The second row comes from the other side: a peer that
tears down with its own answered-at clock still zero — the call was up on the
signalling layer but its media `stream` event never fired, which is ordinary on
a relayed or one-way-media link — sends `call-cancel`, and the handler for it
used to write a missed row whatever this side already knew.

Two real browsers cannot produce it. On localhost with fake devices the
`stream` event always fires, so answered-at is never zero and the path is never
taken; a full answered call through `callbasics` stays clean either way. The
suite replays the protocol events through `window.__callLogProbe` instead,
which is what that hook is for, and covers the cases that must keep working: a
genuine missed call, a missed call long after a completed one, a local ring
timeout, and the existing de-duplication of the several notices one unanswered
call produces.

```sh
PKG_URL=http://localhost:8099 node tests/e2e/calldup.mjs
```
