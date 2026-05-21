# Native Desktop Builds

This project ships a Tauri 2.11.1 native shell around the offline web app.

## Graphical Build Wizard

For a user-friendly interface to build the native client or monitor server for any supported platform and architecture, including automatic cross-compilation checks:

```sh
npm run native:build:wizard
```

## Cross-Compilation & Rust Targets

If you are building for a different architecture or platform than your host, you must first add the required Rust target using `rustup`.

### Linux Targets
- **x86_64:** `rustup target add x86_64-unknown-linux-gnu`
- **ARM64:** `rustup target add aarch64-unknown-linux-gnu`

### macOS Targets
- **Apple Silicon:** `rustup target add aarch64-apple-darwin`
- **Intel Mac:** `rustup target add x86_64-apple-darwin`

### Windows Targets
- **x86_64:** `rustup target add x86_64-pc-windows-msvc`
- **ARM64:** `rustup target add aarch64-pc-windows-msvc`

> **Note:** Cross-compiling between different operating systems (e.g., Linux to Windows) requires additional toolchains like `MinGW` or `Zig`. It is recommended to build for each OS on its native environment when possible.

## Local macOS Builds
...

```sh
npm install
npm run native:build:mac:arm64     # Apple Silicon
npm run native:build:mac:x86_64    # Intel
npm run native:build:mac:universal # Universal binary
```

Generated artifacts:

- `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/P00RIJA Cryptography.app`
- `src-tauri/target/x86_64-apple-darwin/release/bundle/macos/P00RIJA Cryptography.app`
- `src-tauri/target/universal-apple-darwin/release/bundle/macos/P00RIJA Cryptography.app`

## Windows Builds

Run on Windows with Visual Studio Build Tools and WebView2:

```powershell
npm install
npm run native:build:windows:x86_64 # Standard PC
npm run native:build:windows:arm64  # ARM Windows
```

Generated bundle targets:

- NSIS installer
- MSI installer

## Linux Builds

Run on a Debian/Ubuntu builder with WebKitGTK 4.1, AppIndicator, rpm, and AppImage tooling:

```sh
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf rpm
npm install
npm run native:build:linux:x86_64 # Standard PC
npm run native:build:linux:arm64  # ARM (e.g. Raspberry Pi)
```

Generated bundle targets:

- `.deb` for Debian/Ubuntu based systems
- `.rpm` for RedHat/Fedora based systems
- `.AppImage` for portable Linux use

## Monitor Server Native Builds

The monitor server can also be built as a native application for various platforms:

```sh
npm run monitor:build:linux:x86_64
npm run monitor:build:mac:universal
npm run monitor:build:windows:x86_64
```

## Arch Package

Run on Arch Linux after installing `base-devel`, `webkit2gtk-4.1`, `gtk3`, `libayatana-appindicator`, `librsvg`, `nodejs`, `npm`, and `rust`:

```sh
npm install
npm run native:prepare
cargo build --manifest-path src-tauri/Cargo.toml --release
cd packaging/arch
makepkg -f
```

The `PKGBUILD` packages the native Linux binary, desktop file, and icon into a pacman package.

## Native Integration Notes

- **Cross-Compilation:** If you are building for a different architecture than your host (e.g., building x86_64 Linux on an ARM64 Linux machine), you must first add the Rust target: `rustup target add x86_64-unknown-linux-gnu`.
- Close hides the main window and keeps the app alive in the system tray until the user chooses Quit.
- Notifications use `tauri-plugin-notification`.
- Native open/save dialogs use `tauri-plugin-dialog`.
- File-system access is scoped through Tauri capabilities, while secure file shredding is handled by a Rust command after explicit user file selection.
- Desktop quick unlock stores the secret in the OS secure store: macOS Keychain, Windows Credential Manager, or Linux Secret Service.
- Camera and microphone prompts are provided by the platform webview; macOS usage strings and entitlements are included for notarized builds.
