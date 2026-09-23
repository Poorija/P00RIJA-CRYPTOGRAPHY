<img src="assets/pwa-icons/icon-192.png" alt="P00RIJÃ Cryptography" width="72" align="right">

# Android and iOS

The mobile clients are the same web app, wrapped by **Tauri 2**, which has
first-class Android and iOS targets since v2.0. `tauri android init` and
`tauri ios init` generate their projects inside `src-tauri/gen/`, and both read
the same `dist/tauri` payload the desktop build embeds.

## Why Tauri and not Capacitor

Capacitor is a good tool and would work. It was not chosen because of what this
repository already is, not because of any deficiency in it:

- The desktop client is already Tauri. Adding Capacitor means a second wrapper,
  a second native project layout, and a second set of build commands for the
  same `index.html`.
- The JavaScript already talks to native code through one seam,
  `js/desktop-bridge.js`. Tauri mobile reuses it as-is; Capacitor would need a
  parallel bridge with a different plugin API.
- The version number, the asset pipeline and `prepare-tauri-web.js` are shared.

Capacitor would be the better answer if this app needed a large catalogue of
native plugins. It needs four things — notifications, biometrics, file access,
camera — and Tauri has all of them.

**One thing Capacitor cannot do that is worth being explicit about: it does not
change the iOS push notification situation.** That restriction belongs to
Apple's account system, not to any framework. See below.

---

## Push notifications: what is actually possible

| | Works without a paid account | How |
|---|---|---|
| Android, app open | ✅ | `tauri-plugin-notification` |
| Android, app closed | ✅ | Firebase Cloud Messaging — free, needs a Firebase project |
| iOS native app | ❌ | APNs requires Apple Developer Program membership, $99/yr |
| **iOS installed PWA** | ✅ | **Web Push with VAPID, iOS 16.4+** |
| Desktop | ✅ | `tauri-plugin-notification` |

The middle row is the one that surprises people. APNs itself is free to send
through, but registering an App ID with the push capability, issuing an APNs
key, and getting the `aps-environment` entitlement into a provisioning profile
are all behind the paid membership. Free provisioning explicitly excludes push.
No framework — Capacitor, Tauri, Flutter, React Native, or hand-written Swift —
can route around an account-level restriction.

The last row is the way out, and this app already has everything it needs for
it. Since iOS 16.4 a web app added to the Home Screen gets the standard W3C
Push API with **VAPID keys** — not an APNs certificate, and no developer
account. `scripts/server.js` already signs pushes with VAPID through the
`web-push` package, `manifest.webmanifest` already declares
`"display": "standalone"`, and `index.html` already carries the
`apple-mobile-web-app-*` tags. An iPhone user opens the relay URL in Safari,
taps Share → Add to Home Screen, and push works from that moment on — with no
seven-day expiry and no cable.

So, without a paid account, **the installed PWA is strictly better on iOS than
any native wrapper**: it is the only one of the two that can deliver a message
when the app is closed.

With a paid account the native app becomes worth building: push through APNs,
no expiry, Face ID through the biometric plugin, and App Store distribution.
The Xcode project for that is already generated and building — see below.

---

## Android

Everything needed is installed on this machine already.

```sh
npm run android:keystore     # once — creates the signing key
npm run android:build        # signed release APK and AAB
npm run android:build:debug  # debug APK
npm run android:dev          # live reload onto a device or emulator
```

Artifacts:

```
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab
```

Install over USB with `adb install -r <apk>`, or copy the APK to the phone and
open it. No Google account is involved; the $25 Play Console fee applies only
to publishing on the store, and the `.aab` is what the store would want.

### The signing key

`scripts/android-keystore.sh` writes a 4096-bit RSA key and a random 40-character
password into `~/.p00rija-android-signing/`, mode 600, outside the repository.

Android identifies an app by its signing key. A phone that has this app
installed will refuse an update signed with a different key — the only way
forward would be a new application id and every user uninstalling by hand.
**Back that directory up somewhere other than this machine.**

### What the manifest declares, and why

`tauri android init` generates a manifest with `INTERNET` and nothing else.
Three things were added to it:

- **`CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`.** Tauri's
  `RustWebChromeClient` already implements `onPermissionRequest`, but it can
  only ask for permissions the manifest declares. Without them `getUserMedia`
  fails with `NotAllowedError` before any prompt appears, and calls do not work
  at all.
- **`android:networkSecurityConfig`.** Release builds set
  `usesCleartextTraffic=false`, which makes a relay at `http://192.168.x.x:9000`
  unreachable — and a self-hosted relay on a LAN has no certificate a phone
  would accept. The config in `res/xml/network_security_config.xml` permits
  cleartext and explains the reasoning: the relay only ever sees envelopes that
  were sealed before they reached the transport, so TLS there would be
  protecting ciphertext. It also trusts user-installed certificates, which is
  the middle ground for someone running their own CA.
- **`supportsRtl`**, because the interface is Persian by default.

### Background operation, and what it actually delivers

Turning on "keep running in the background" starts a foreground service
(`KeepAliveService.kt`) with a permanent, silent notification. Measured on
Android 15:

- **The process stays resident.** `oom_score_adj` drops to 50, so Android does
  not reclaim the app. It reopens instantly with its state intact and collects
  everything the relay queued while it was away.
- **New messages do not arrive while it is backgrounded.** This was tested
  rather than assumed. `WryActivity.onPause()` calls `WebView.onPause()`, and a
  process lifecycle observer calls `Rust.pause()` after it. Calling
  `onResume()` and `resumeTimers()` back — immediately, then seven more times
  over the following seconds — produced **zero** JavaScript timer ticks across
  a 100-second background window. Android freezes the sandboxed renderer, and
  an application cannot ask it not to.

That attempt was removed from `MainActivity.kt` rather than left in as a
hopeful no-op, because retrying something the platform has already refused only
costs battery. The notification says "Kept in memory — open the app to receive
waiting messages", which is what it does.

### Delivering a message to a closed app

Waking a frozen app needs a channel the *system* listens on. Two exist:

| | Needs | Keeps Google out |
|---|---|---|
| **FCM** | A Firebase project and `google-services.json` — free, but yours to create | ❌ |
| **UnifiedPush** | A distributor app on the phone (ntfy, and others) | ✅ |

Both carry only the sealed envelope, exactly as the existing Web Push path
does, so neither sees message content. FCM is the one that works on an
unmodified phone with no extra app installed; UnifiedPush is the one that fits
this suite's premise that nothing but the chosen relay sees any traffic.

Neither is wired up yet: FCM cannot be, without a Firebase project that only
the account holder can create.

Web Push through the service worker — which is what the browser build and the
iOS Home Screen app use — is not an option here. Android's WebView implements
service workers but does not expose the Push API to them; that is a Chrome
feature, not a WebView one.

### What does not exist on Android

`~/.ssh` has no counterpart in an app sandbox, and secure file deletion is
meaningless on a sandboxed flash filesystem. Both commands return a plain
"desktop-only feature" error rather than pretending; the Rust side is compiled
with `#[cfg(desktop)]` guards so the code is not even present in the APK.

---

## iOS

```sh
npm run ios:init     # once
npm run ios:dev      # onto the simulator or a connected device
npm run ios:build    # .ipa, needs a signing team
```

`scripts/mobile-env.sh` exports `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`
rather than asking you to run `sudo xcode-select -s`. It points the Apple
tools at the full Xcode for that shell only, so no administrator password is
needed and the machine's global setting is left alone.

### Without a paid account

- **Simulator:** works, no account, no signing.
- **Your own iPhone:** works through free provisioning — open
  `src-tauri/gen/apple/p00rija-cryptography.xcodeproj` in Xcode, sign in with a
  normal Apple ID under Signing & Capabilities, and run. The app expires after
  **7 days**, you may have **3** such apps at a time, and **push notifications
  are unavailable**.
- **Anyone else's iPhone:** not possible.

### With a paid account ($99/yr)

Set the team and build:

```sh
export APPLE_DEVELOPMENT_TEAM=XXXXXXXXXX
npm run ios:build
```

Then push becomes available, apps stop expiring, and TestFlight and the App
Store open up.

### The recommendation

Until there is a paid account, ship iOS as the installed PWA. It is the only
option of the two that can notify a closed app, it never expires, and it needs
nothing from Apple. Point an iPhone at the relay's HTTPS URL, Share → Add to
Home Screen, and allow notifications when the app asks.

---

## Verifying a build

```sh
npm run verify:artifacts
```

Checks every binary that exists — macOS, Linux, Windows, and the Android
library inside the APK — for the embedded frontend, and fails if a call to
`window.confirm`, `window.prompt` or `window.alert` has crept back into the
bundled JavaScript. Those three are unusable in the native shell: `confirm()`
returns a truthy Promise there, so a stray call reads as "the user said yes".
