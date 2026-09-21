# Native desktop builds — macOS and Linux

The desktop client is a **Tauri 2.11** shell around the same web app the
browser build serves. Nothing is rewritten for the desktop: `index.html`,
`js/` and `css/` are identical between the two, and `scripts/prepare-tauri-web.js`
removes the browser-only seams on the way into the bundle.

## Why Tauri and not Electron

| | Tauri 2 | Electron |
|---|---|---|
| Engine | The OS webview — WKWebView on macOS, WebKitGTK on Linux | A bundled Chromium |
| Installer | 19 MB `.dmg` measured on this tree | ~90–150 MB before compression |
| Idle memory | ~110 MB resident, measured | 250–400 MB typical |
| Native side | Rust, no runtime | Node.js, shipped with the app |
| Update surface | The OS patches the engine | You ship every Chromium CVE fix yourself |

For this application in particular, the last row decides it. A suite whose
whole claim is that plaintext never leaves the device should not also be
responsible for shipping browser-engine security patches. Tauri hands that job
to the operating system.

The cost is real and worth stating: two engines instead of one, so anything
touching the DOM has to be verified on WebKit rather than only on Chromium.
`tests/e2e/native-shell.mjs` exists because of that.

A truly native rewrite — SwiftUI on macOS, GTK on Linux — was never a
candidate. `js/chat.js` alone is 15,000 lines of transport, crypto and call UI.

---

## Prerequisites

### macOS
Xcode Command Line Tools are enough — the full Xcode app is not needed.

```sh
xcode-select --install
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm install
```

### Linux (building on Linux)
```sh
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
    libayatana-appindicator3-dev librsvg2-dev patchelf rpm cmake
npm install
```

`cmake` is not optional: `aws-lc-sys`, the crypto provider rustls pulls in
through `reqwest`, builds C sources with it, and the failure message when it is
missing names neither cmake nor aws-lc.

### Linux (building from macOS or Windows)
Docker only. See below.

---

## macOS

```sh
npm run native:build:mac:arm64      # Apple Silicon
npm run native:build:mac:x86_64     # Intel
npm run native:build:mac:universal  # both in one bundle
```

These call `scripts/build-macos.sh`, which builds, signs, and then verifies
what it produced.

Artifacts:

```
src-tauri/target/<triple>/release/bundle/macos/P00RIJA Cryptography.app
src-tauri/target/<triple>/release/bundle/dmg/P00RIJA Cryptography_<version>_<arch>.dmg
```

### If the build stops on a crate you never touched

Xcode 27's linker sometimes lays a dylib's Mach-O string pool on a 4-byte
boundary. dyld requires 8 and refuses to load the file. rustc loads proc-macro
dylibs in order to expand macros, so that refusal is reported as a compile
error in whichever crate used the macro, which is never the crate at fault and
never contains anything to fix:

```
error: could not compile `tauri` (lib) due to 2 previous errors
```

`[profile.release.build-override]` in `src-tauri/Cargo.toml` keeps host tooling
off the settings that produced those layouts here, so you are unlikely to meet
this at all. If another crate lands on the same boundary anyway,
`scripts/build-macos.sh` prints the offending files when the build fails:
delete the dylibs it names and build again, and they relink with a different
layout.

`-ld_classic`, which older advice reaches for, was removed in Xcode 27. Passing
it now only produces a warning saying it is ignored.

### Signing

Tauri only runs `codesign` when `APPLE_SIGNING_IDENTITY` is set. Without it the
bundle keeps the linker's automatic ad-hoc signature, which carries **no
entitlements** and seals **no resources** — `codesign -d --entitlements :-`
comes back empty even though `tauri.conf.json` names an entitlements file.

`scripts/build-macos.sh` defaults the identity to `-` so a local build is at
least properly sealed and carries its entitlements. For distribution:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
npm run native:build:mac:universal
```

The script prints the resulting signature and entitlements either way; check
that `Sealed Resources` is not `none` and that the five entitlements are listed.

---

## Linux

On a Linux host:

```sh
npm run native:build:linux:x86_64
npm run native:build:linux:arm64
```

From macOS or Windows, through the container builder:

```sh
npm run native:build:linux:docker          # x86_64
npm run native:build:linux:docker:arm64    # ARM64
```

Artifacts, per architecture:

```
src-tauri/target/<triple>/release/bundle/deb/*.deb
src-tauri/target/<triple>/release/bundle/rpm/*.rpm
src-tauri/target/<triple>/release/bundle/appimage/*.AppImage
src-tauri/target/<triple>/release/bundle/*.pkg.tar.zst     # Arch
```

The builder image is Ubuntu 22.04 on purpose: it is the oldest base carrying
WebKitGTK 4.1, and the build host's glibc becomes the floor for every package
it produces.

On Apple Silicon an `x86_64` container build runs under emulation and takes
considerably longer than the native `arm64` one. The script warns when it
detects that combination.

---

## One build at a time

`frontendDist` is a single fixed path, and `npm run native:prepare` starts by
deleting it. Two builds at once — a macOS build and a Linux container build,
say — means the second one's prepare removes the assets the first one's
compiler is still reading. It surfaces as:

```
error: failed to read asset .../dist/tauri/fonts/…/Something.ttf
       because No such file or directory (os error 2)
```

which names a font and says nothing about the actual cause. `prepare-tauri-web.js`
now takes `dist/.prepare.lock` and refuses with an explanation instead. The
lock records host and pid, so a container build cannot be mistaken for a stale
one by the host, and vice versa. If a build was killed and the lock survived,
delete the file.

---

## Windows

Unchanged, and must be built on Windows with the MSVC toolchain and WebView2:

```powershell
npm run native:build:windows:x86_64
npm run native:build:windows:arm64
```

---

## The build wizard

```sh
npm run native:build:wizard
```

Uses `whiptail` when it is installed and a plain numbered menu when it is not,
so it works on macOS, which has no whiptail. It refuses host/target
combinations that cannot work (macOS bundles off a Linux box, and so on) rather
than failing halfway through a build.

---

## What the native shell adds

Everything below is Rust in `src-tauri/src/lib.rs`, reached from JavaScript
through `js/desktop-bridge.js`. None of it talks to a server.

| Area | Commands | Notes |
|---|---|---|
| Notifications | `tauri-plugin-notification` | Permission is requested once at startup rather than mid-call |
| Background / tray | `desktop_get_shell_settings`, `desktop_set_shell_settings`, `desktop_show_window`, `desktop_hide_window`, `desktop_quit` | Closing hides to the tray by default; Settings → Desktop behaviour switches it to a real quit |
| Login items | same settings command | LaunchAgent on macOS, `~/.config/autostart` on Linux |
| On-system vault | `desktop_write_app_file`, `desktop_read_app_file`, `desktop_list_app_files`, `desktop_delete_app_file` | Argon2id-sealed by the webview *before* it reaches Rust |
| `~/.ssh` | `desktop_ssh_dir_path`, `desktop_ssh_list_entries`, `desktop_ssh_read_file`, `desktop_ssh_write_file`, `desktop_ssh_delete_file`, `desktop_ssh_append_authorized_key` | Private keys created `0600`, the directory `0700` |
| Secure deletion | `desktop_shred_file` | Three passes, then rename, then unlink |
| Quick unlock | `desktop_auth_status`, `desktop_store_quick_unlock`, `desktop_unlock_with_biometric`, `desktop_clear_quick_unlock` | Keychain / Secret Service, gated behind Touch ID, Windows Hello, or fprintd/polkit |
| Relay discovery | `desktop_probe_relay_origin` | The one outbound request, and it carries no user data |
| Badge | `desktop_set_badge_count` | `navigator.setAppBadge` does nothing in either webview |

### Known limitations

- **File associations are macOS and Windows only.** `.poorija`, `.poorija-backup`
  and `.poorija-share` are registered in `Info.plist` and in the Windows
  installer, but the generated Linux `.desktop` entry carries no `MimeType=`
  and no shared-mime-info XML ships with the packages, so double-clicking one
  of those files on Linux will not open the app.
- **Calls do not work in the Linux native build, and cannot be switched on.**
  The WebKitGTK that distributions ship has no WebRTC backend compiled in, so
  `RTCPeerConnection` is undefined. The `enable-webrtc` setting exists, is
  writable, sets successfully — and changes nothing, which is what makes this
  worth writing down. Measured on Ubuntu 22.04 (WebKitGTK 2.50.4) and Fedora 41
  with a probe that starts a real engine and asks it; the evidence, the trap and
  the reproduction are in `docs/linux-webrtc.md`. The calls pane hands the
  user's relay address to the system browser instead, which carries full
  libwebrtc. macOS and Windows are unaffected.
- **The AppImage is large** — about 112 MB against 19 MB for the `.deb` —
  because `bundleMediaFramework` pulls GStreamer in. Media playback needs it and
  an AppImage cannot rely on the host having it; it is not what would make calls
  work, per the bullet above. The `.deb` and `.rpm` declare it as a dependency
  instead, which is why they are a sixth of the size.
- **Ad-hoc signing is not distribution.** A downloaded ad-hoc-signed `.dmg` is
  quarantined by Gatekeeper. Notarization needs a paid Apple Developer account.

### Two platform behaviours worth knowing

**App Nap (macOS).** An application whose windows are all hidden gets its
timers coalesced and its callbacks deferred — measured on this app, past a
minute. That is precisely the state "keep running in the tray" puts it in, so
`Info.plist` sets `NSAppSleepDisabled`. It costs battery; the alternative is a
chat client that stops delivering while it is in the tray.

**Tray clicks (Linux).** The AppIndicator protocol has no click event at all,
so on Linux the menu opens on the primary button. On macOS and Windows the
left click shows the window and the right click opens the menu.

---

## Tests

```sh
npm run test:rust            # the Rust unit tests
npm run native:prepare
npm run test:native          # the bundle payload under the production CSP
npm run test:native:webkit   # the same, on the engine macOS and Linux use
                             # (needs `npx playwright install webkit` once)
npm run test:smoke           # PKG_URL=http://localhost:8123 for a static server
npm run test:all
```

There is a stronger check than any of these, and it is the one to reach for
when the native window misbehaves: build with the diagnostic probe and read
what the real WKWebView or WebKitGTK document reports.

```sh
POORIJA_NATIVE_PROBE=1 npx tauri build --debug --bundles app --target aarch64-apple-darwin
NSAppSleepDisabled=1 "src-tauri/target/aarch64-apple-darwin/debug/bundle/macos/P00RIJA Cryptography.app/Contents/MacOS/p00rija-cryptography"
```

It prints secure-context and WebCrypto availability, whether inline handlers
fire, and a round trip through the real IPC commands. `NSAppSleepDisabled=1`
matters: a window that is not frontmost has its timers coalesced and the later
reports never arrive. The probe is injected only when that environment variable
is set and is never in a normal bundle.

`test:native` is the one that exists because of a specific failure. Tauri
injects a nonce into `script-src` and hashes each inline `<script>`, and per
the CSP spec a nonce or hash in a directive makes the browser **ignore
`'unsafe-inline'` in that same directive**. This UI is built on 192 inline
`onclick` and 70 inline `onchange` attributes, so the app loaded, defined every
global, and responded to nothing at all. `dangerousDisableAssetCspModification`
in `tauri.conf.json` is what keeps the policy we actually wrote; the test
reproduces Tauri's modification and clicks a real inline handler, so removing
that setting fails the suite instead of shipping a dead window.
