// P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
// Copyright (C) 2026 Poorija <p00rija@tutamail.com>
// https://github.com/Poorija/P00RIJA-Cryptography
//
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE for the full text. Section 13 matters here: run a modified
// version as a network service and its users are entitled to your source.

//! Native desktop shell for P00RIJA Cryptography.
//!
//! Everything the suite does with user data happens on this machine. The shell
//! adds the four things a browser tab cannot do: OS notifications, a tray icon
//! that keeps the app alive after the window is closed, unrestricted access to
//! `~/.ssh` and to arbitrary files for secure deletion, and an on-disk copy of
//! the (already encrypted) vault next to the application itself.
//!
//! The only network traffic originating in this file is the relay probe, which
//! asks a candidate origin whether it speaks the chat-signal protocol.

use std::{
    fs::{self, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
};
#[cfg(desktop)]
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

/* The desktop half of this shell — tray, login items, a window that can be
   hidden, the OS keychain, ~/.ssh — has no counterpart on a phone. Rather
   than split the file, each of those is compiled only for desktop and the
   command that fronts it returns a plain "not available" on mobile, so the
   IPC surface stays identical and the frontend needs no platform branches. */
#[cfg(desktop)]
use keyring::Entry;
#[cfg(desktop)]
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    WindowEvent,
};
#[cfg(desktop)]
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/* Where the master password lives on a phone. The desktop's keyring has no
   mobile equivalent as a crate, so each platform's own guarded store is
   reached directly -- see the module for what guards what. */
#[cfg(mobile)]
mod mobile_secure_store;

/* Waking the phone without FCM. Android only in practice, but the module
   compiles everywhere so the commands can be registered unconditionally and
   answer honestly rather than not existing. */
mod mobile_unifiedpush;

#[cfg(mobile)]
fn desktop_only<T>(what: &str) -> Result<T, NativeError> {
    Err(NativeError::Message(format!(
        "{what} is a desktop-only feature and is not available on this platform"
    )))
}

#[cfg(desktop)]
const KEYRING_SERVICE: &str = "com.p00rija.cryptography";
#[cfg(desktop)]
const KEYRING_ACCOUNT: &str = "desktop-quick-unlock";
#[cfg(desktop)]
const RELAY_PROBE_TIMEOUT: Duration = Duration::from_millis(1800);
const SETTINGS_FILE: &str = "shell-settings.json";
const VAULT_DIR: &str = "vault";
const MAX_APP_FILE_BYTES: usize = 256 * 1024 * 1024;

/// Whether a tray icon actually exists.
///
/// On Linux the tray is an AppIndicator, and stock GNOME does not implement
/// the protocol without the AppIndicator extension installed — the icon simply
/// never appears. Hiding the window to a tray that is not there leaves the user
/// with a running process and no way back to it, so this is checked before
/// deciding what "close" means.
#[cfg(desktop)]
struct TrayState {
    available: bool,
}

#[derive(Debug, thiserror::Error)]
enum NativeError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl NativeError {
    fn msg(text: impl Into<String>) -> Self {
        NativeError::Message(text.into())
    }
}

impl serde::Serialize for NativeError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAuthStatus {
    supported: bool,
    enabled: bool,
    platform: String,
    /// True when the platform can actually challenge the user (Touch ID,
    /// Windows Hello, fprintd/polkit). False means the secure store exists but
    /// nothing would stand between an unlocked session and the master password,
    /// so quick unlock stays off.
    biometric: bool,
}

#[derive(Serialize)]
struct ShredResult {
    removed: bool,
    bytes: u64,
    passes: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RelayProbeResult {
    origin: String,
    health: Value,
    turn_config: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SshEntry {
    name: String,
    is_dir: bool,
    size: u64,
    modified_secs: u64,
    /// Unix permission bits (`0o600` etc). Zero where the platform has none —
    /// the UI uses it to warn about world-readable private keys.
    mode: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppFileEntry {
    name: String,
    size: u64,
    modified_secs: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopPlatformInfo {
    os: String,
    arch: String,
    app_version: String,
    data_dir: String,
    vault_dir: String,
    ssh_dir: String,
    tray: bool,
}

/// Shell behaviour the user controls from Settings. Persisted next to the
/// vault so it survives reinstalls of the web assets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellSettings {
    /// "tray" keeps the app running after the window is closed (default),
    /// "quit" exits for real.
    #[serde(default = "default_close_behavior")]
    close_behavior: String,
    /// Start hidden in the tray when launched at login.
    #[serde(default)]
    start_minimized: bool,
    /// Register the app with the OS login-items mechanism.
    #[serde(default)]
    autostart: bool,
}

fn default_close_behavior() -> String {
    "tray".to_string()
}

impl Default for ShellSettings {
    fn default() -> Self {
        Self {
            close_behavior: default_close_behavior(),
            start_minimized: false,
            autostart: false,
        }
    }
}

impl ShellSettings {
    fn normalized(mut self) -> Self {
        if self.close_behavior != "quit" {
            self.close_behavior = default_close_behavior();
        }
        self
    }
}

// ==================== paths ====================

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, NativeError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| NativeError::msg(format!("app data dir unavailable: {error}")))?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// The on-system database directory: `~/Library/Application Support/…/vault`
/// on macOS, `~/.local/share/…/vault` on Linux.
fn vault_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, NativeError> {
    let dir = app_data_dir(app)?.join(VAULT_DIR);
    fs::create_dir_all(&dir)?;
    restrict_dir_permissions(&dir);
    Ok(dir)
}

fn app_settings_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, NativeError> {
    Ok(app_data_dir(app)?.join(SETTINGS_FILE))
}

#[cfg(desktop)]
fn ssh_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, NativeError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|error| NativeError::msg(format!("home dir unavailable: {error}")))?;
    Ok(home.join(".ssh"))
}

#[cfg(desktop)]
fn ensure_ssh_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, NativeError> {
    let dir = ssh_dir(app)?;
    fs::create_dir_all(&dir)?;
    restrict_dir_permissions(&dir);
    Ok(dir)
}

/// `0o700` where the platform has Unix modes. OpenSSH refuses to use a
/// group- or world-writable `~/.ssh`, so this is correctness, not paranoia.
fn restrict_dir_permissions(dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
    }
}

// ==================== settings ====================

fn read_shell_settings<R: Runtime>(app: &AppHandle<R>) -> ShellSettings {
    app_settings_file(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<ShellSettings>(&raw).ok())
        .unwrap_or_default()
        .normalized()
}

fn write_shell_settings<R: Runtime>(
    app: &AppHandle<R>,
    settings: &ShellSettings,
) -> Result<(), NativeError> {
    let path = app_settings_file(app)?;
    let body = serde_json::to_string_pretty(settings)
        .map_err(|error| NativeError::msg(error.to_string()))?;
    write_file_atomic(&path, body.as_bytes(), 0o600)
}

#[tauri::command]
fn desktop_get_shell_settings<R: Runtime>(app: AppHandle<R>) -> ShellSettings {
    #[allow(unused_mut)]
    let mut settings = read_shell_settings(&app);
    // The OS is the source of truth for login items — the user may have
    // removed it from System Settings behind our back.
    #[cfg(desktop)]
    if let Ok(enabled) = app.autolaunch().is_enabled() {
        settings.autostart = enabled;
    }
    settings
}

#[tauri::command]
fn desktop_set_shell_settings<R: Runtime>(
    app: AppHandle<R>,
    settings: ShellSettings,
) -> Result<ShellSettings, NativeError> {
    let settings = settings.normalized();
    apply_autostart(&app, settings.autostart)?;
    write_shell_settings(&app, &settings)?;
    Ok(settings)
}

#[cfg(mobile)]
fn apply_autostart<R: Runtime>(_app: &AppHandle<R>, _enabled: bool) -> Result<(), NativeError> {
    // A phone has no login items; the OS decides what runs.
    Ok(())
}

#[cfg(desktop)]
fn apply_autostart<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), NativeError> {
    let manager = app.autolaunch();
    let already = manager.is_enabled().unwrap_or(false);
    if already == enabled {
        return Ok(());
    }
    let outcome = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    outcome.map_err(|error| NativeError::msg(format!("could not update login items: {error}")))
}

#[tauri::command]
fn desktop_get_close_behavior<R: Runtime>(app: AppHandle<R>) -> String {
    read_shell_settings(&app).close_behavior
}

#[tauri::command]
fn desktop_set_close_behavior<R: Runtime>(
    app: AppHandle<R>,
    mode: String,
) -> Result<(), NativeError> {
    if mode != "tray" && mode != "quit" {
        return Err(NativeError::msg("close behavior must be 'tray' or 'quit'"));
    }
    let mut settings = read_shell_settings(&app);
    settings.close_behavior = mode;
    write_shell_settings(&app, &settings)
}

// ==================== window / shell ====================

fn tray_available<R: Runtime>(app: &AppHandle<R>) -> bool {
    #[cfg(desktop)]
    {
        app.try_state::<TrayState>()
            .map(|state| state.available)
            .unwrap_or(false)
    }
    #[cfg(mobile)]
    {
        let _ = app;
        false
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    #[cfg(mobile)]
    let _ = app;
}

#[tauri::command]
fn desktop_show_window<R: Runtime>(app: AppHandle<R>) {
    show_main_window(&app);
}

#[tauri::command]
fn desktop_hide_window<R: Runtime>(app: AppHandle<R>) {
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    #[cfg(mobile)]
    let _ = app;
}

#[tauri::command]
fn desktop_quit<R: Runtime>(app: AppHandle<R>) {
    app.exit(0);
}

/// Unread badge on the Dock (macOS) / launcher (Linux). `None` or `0` clears it.
#[tauri::command]
fn desktop_set_badge_count<R: Runtime>(
    app: AppHandle<R>,
    count: Option<i64>,
) -> Result<(), NativeError> {
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        let value = count.filter(|number| *number > 0);
        window
            .set_badge_count(value)
            .map_err(|error| NativeError::msg(error.to_string()))?;
    }
    // On mobile the badge belongs to the notification, not to a window.
    #[cfg(mobile)]
    let _ = (app, count);
    Ok(())
}

/// A console for a window that has none.
///
/// The native webview prints nowhere a developer can see: WKWebView and
/// WebKitGTK both drop `console.log`, and a release build has no inspector.
/// Diagnosing a blank or unresponsive window therefore means guessing, which
/// is how a CSP problem that killed every inline handler took a whole session
/// to find. This forwards a line from the page to the process's stderr in
/// debug builds and does nothing in release, so the harness in
/// `tests/e2e/native-probe.js` can report what the real document sees.
/// Hands an http(s) link to the system browser.
///
/// Every external link in the UI carries `target="_blank"`, and Tauri denies
/// new windows by default — so in the native shell "Open in maps" and the
/// licence link did nothing at all when clicked. Letting the link navigate the
/// webview instead would be worse: it would replace the app with a web page in
/// a window that has no back button and no way home.
#[tauri::command]
fn desktop_open_external(url: String) -> Result<(), NativeError> {
    let parsed = url::Url::parse(&url).map_err(|error| NativeError::msg(error.to_string()))?;
    // Only ever hand the shell an http(s) URL. Anything else — file:, smb:,
    // a custom scheme registered by some other app — is a way to make this
    // command do something the page should not be able to ask for.
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(NativeError::msg("only http and https links can be opened"));
    }
    open_external_url(parsed.as_str())
}

#[cfg(mobile)]
fn open_external_url(url: &str) -> Result<(), NativeError> {
    // Mobile webviews hand an unhandled navigation to the OS themselves, so
    // the link opens in the default browser without help from here.
    let _ = url;
    Err(NativeError::msg(
        "links open through the system browser on this platform",
    ))
}

#[cfg(desktop)]
fn open_external_url(url: &str) -> Result<(), NativeError> {
    // Passed as a single argument, never through a shell: a URL is untrusted
    // text that arrived from a chat message.
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler").arg(url);
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = url;
        return Err(NativeError::msg("opening links is unsupported on this platform"));
    }

    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    {
        command
            .spawn()
            .map(|_| ())
            .map_err(|error| NativeError::msg(format!("could not open the link: {error}")))
    }
}

#[tauri::command]
fn desktop_debug_log(note: String) {
    if cfg!(debug_assertions) {
        eprintln!("[poorija] {note}");
    }
}

#[tauri::command]
fn desktop_platform_info<R: Runtime>(app: AppHandle<R>) -> Result<DesktopPlatformInfo, NativeError> {
    Ok(DesktopPlatformInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_version: app.package_info().version.to_string(),
        data_dir: app_data_dir(&app)?.to_string_lossy().into_owned(),
        vault_dir: vault_dir(&app)?.to_string_lossy().into_owned(),
        #[cfg(desktop)]
        ssh_dir: ssh_dir(&app)?.to_string_lossy().into_owned(),
        #[cfg(mobile)]
        ssh_dir: String::new(),
        tray: tray_available(&app),
    })
}

// ==================== on-system encrypted vault copy ====================

#[tauri::command]
fn desktop_app_data_dir<R: Runtime>(app: AppHandle<R>) -> Result<String, NativeError> {
    Ok(app_data_dir(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn desktop_vault_dir<R: Runtime>(app: AppHandle<R>) -> Result<String, NativeError> {
    Ok(vault_dir(&app)?.to_string_lossy().into_owned())
}

/// Writes an opaque, already-encrypted payload (base64) into the vault
/// directory under a sanitized single-segment name. The shell never sees
/// plaintext: encryption happens in the webview before this is called.
#[tauri::command]
fn desktop_write_app_file<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    data_b64: String,
) -> Result<String, NativeError> {
    let file_name = sanitize_file_name(&name)?;
    let bytes = base64_decode(&data_b64)?;
    if bytes.len() > MAX_APP_FILE_BYTES {
        return Err(NativeError::msg("payload exceeds the 256 MB vault file limit"));
    }
    let path = vault_dir(&app)?.join(&file_name);
    write_file_atomic(&path, &bytes, 0o600)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn desktop_read_app_file<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<Option<String>, NativeError> {
    let file_name = sanitize_file_name(&name)?;
    let path = vault_dir(&app)?.join(&file_name);
    match fs::read(&path) {
        Ok(bytes) => Ok(Some(base64_encode(&bytes))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
fn desktop_list_app_files<R: Runtime>(app: AppHandle<R>) -> Result<Vec<AppFileEntry>, NativeError> {
    let dir = vault_dir(&app)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if !metadata.is_file() {
            continue;
        }
        entries.push(AppFileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            size: metadata.len(),
            modified_secs: modified_secs(&metadata),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// Removes a vault file, overwriting it first — the same treatment the file
/// shredder gives user files, because this one holds the vault.
#[tauri::command]
fn desktop_delete_app_file<R: Runtime>(app: AppHandle<R>, name: String) -> Result<bool, NativeError> {
    let file_name = sanitize_file_name(&name)?;
    let path = vault_dir(&app)?.join(&file_name);
    if !path.exists() {
        return Ok(false);
    }
    // Propagate rather than swallow: this is the command the UI calls when the
    // user asks for the on-disk vault copy to be destroyed, and reporting
    // success over a file that is still there is the worst possible answer.
    shred_path(&path, true)?;
    Ok(true)
}

// ==================== ~/.ssh ====================

/// Full, direct `~/.ssh` access for the native SSH key manager — the browser
/// File System Access API does not exist in WKWebView or WebKitGTK, so the
/// native runtime reaches the real directory through Rust instead.
#[tauri::command]
fn desktop_ssh_dir_path<R: Runtime>(app: AppHandle<R>) -> Result<String, NativeError> {
    #[cfg(mobile)]
    {
        // Neither platform gives an app a view of ~/.ssh; there is no such
        // directory inside the sandbox to point at.
        let _ = &app;
        desktop_only("SSH key access")
    }
    #[cfg(desktop)]
    {
        Ok(ssh_dir(&app)?.to_string_lossy().into_owned())
    }
}

#[tauri::command]
fn desktop_ssh_list_entries<R: Runtime>(
    app: AppHandle<R>,
    subpath: Option<String>,
) -> Result<Vec<SshEntry>, NativeError> {
    #[cfg(mobile)]
    {
        let _ = (&app, &subpath);
        return Ok(Vec::new());
    }
    #[cfg(desktop)]
    {
    let ssh_root = ssh_dir(&app)?;
    /* A subpath must stay inside ~/.ssh: reject absolute paths and `..` up
       front, then canonicalize and re-check — a symlinked folder cannot walk
       the listing out of the directory either way. */
    let dir = match subpath.as_deref().map(str::trim).filter(|part| !part.is_empty()) {
        Some(relative) => {
            let relative_path = Path::new(relative);
            if relative_path.is_absolute()
                || relative_path
                    .components()
                    .any(|component| matches!(component, Component::ParentDir | Component::CurDir | Component::RootDir))
            {
                return Err(NativeError::msg("invalid folder path"));
            }
            let candidate = ssh_root.join(relative_path);
            let canonical_root = fs::canonicalize(&ssh_root)?;
            let canonical_dir = match fs::canonicalize(&candidate) {
                Ok(path) => path,
                Err(_) => return Err(NativeError::msg("folder not found")),
            };
            if !canonical_dir.starts_with(&canonical_root) {
                return Err(NativeError::msg("folder path escapes ~/.ssh"));
            }
            canonical_dir
        }
        None => ssh_root.clone(),
    };
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        entries.push(SshEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified_secs: modified_secs(&metadata),
            mode: unix_mode(&metadata),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
    }
}

#[tauri::command]
fn desktop_ssh_read_file<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    subpath: Option<String>,
) -> Result<String, NativeError> {
    #[cfg(mobile)]
    {
        let _ = (&app, &name, &subpath);
        desktop_only("SSH key access")
    }
    #[cfg(desktop)]
    {
        let file_name = sanitize_file_name(&name)?;
        let dir = match subpath.as_deref().map(str::trim).filter(|part| !part.is_empty()) {
            Some(relative) => {
                let relative_path = Path::new(relative);
                if relative_path.is_absolute()
                    || relative_path
                        .components()
                        .any(|component| matches!(component, Component::ParentDir | Component::CurDir | Component::RootDir))
                {
                    return Err(NativeError::msg("invalid folder path"));
                }
                let ssh_root = ssh_dir(&app)?;
                let candidate = ssh_root.join(relative_path);
                let canonical_root = fs::canonicalize(&ssh_root)?;
                let canonical_dir = fs::canonicalize(&candidate)
                    .map_err(|error| NativeError::msg(format!("folder not found: {error}")))?;
                if !canonical_dir.starts_with(&canonical_root) {
                    return Err(NativeError::msg("folder path escapes ~/.ssh"));
                }
                canonical_dir
            }
            None => ssh_dir(&app)?,
        };
        let path = dir.join(&file_name);
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            return Err(NativeError::msg("refusing to follow a symlink inside ~/.ssh"));
        }
        if !metadata.is_file() {
            return Err(NativeError::msg("not a file in ~/.ssh"));
        }
        // known_hosts can carry non-UTF-8 bytes; a lossy read beats failing
        // the whole directory scan over one odd line.
        Ok(String::from_utf8_lossy(&fs::read(&path)?).into_owned())
    }
}

/// `private = true` (the default) writes `0600`; public material gets `0644`.
#[tauri::command]
fn desktop_ssh_write_file<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    contents: String,
    private: Option<bool>,
) -> Result<String, NativeError> {
    #[cfg(mobile)]
    {
        let _ = (&app, &name, &contents, &private);
        return desktop_only("SSH key access");
    }
    #[cfg(desktop)]
    {
    let file_name = sanitize_file_name(&name)?;
    let dir = ensure_ssh_dir(&app)?;
    let path = dir.join(&file_name);
    if path.exists() && fs::symlink_metadata(&path)?.file_type().is_symlink() {
        return Err(NativeError::msg("refusing to overwrite a symlink inside ~/.ssh"));
    }
    let mode = if private.unwrap_or(true) { 0o600 } else { 0o644 };
    write_file_atomic(&path, contents.as_bytes(), mode)?;
    Ok(path.to_string_lossy().into_owned())
    }
}

#[tauri::command]
fn desktop_ssh_delete_file<R: Runtime>(app: AppHandle<R>, name: String) -> Result<bool, NativeError> {
    #[cfg(mobile)]
    {
        let _ = (&app, &name);
        return desktop_only("SSH key access");
    }
    #[cfg(desktop)]
    {
    let file_name = sanitize_file_name(&name)?;
    let path = ssh_dir(&app)?.join(&file_name);
    if !path.exists() {
        return Ok(false);
    }
    if fs::symlink_metadata(&path)?.file_type().is_symlink() {
        return Err(NativeError::msg("refusing to delete a symlink inside ~/.ssh"));
    }
    // Private key material: overwrite before unlinking.
    shred_path(&path, true)?;
    Ok(true)
    }
}

/// Appends one public-key line to `~/.ssh/authorized_keys`, skipping it when
/// it is already there. Done in Rust so the read-modify-write cannot
/// interleave with another writer through two separate JS round trips.
#[tauri::command]
fn desktop_ssh_append_authorized_key<R: Runtime>(
    app: AppHandle<R>,
    line: String,
) -> Result<bool, NativeError> {
    #[cfg(mobile)]
    {
        let _ = (&app, &line);
        return desktop_only("SSH key access");
    }
    #[cfg(desktop)]
    {
    let candidate = line.trim().to_string();
    if candidate.is_empty() {
        return Err(NativeError::msg("public key line is empty"));
    }
    if candidate.contains('\n') || candidate.contains('\r') {
        return Err(NativeError::msg("public key line must be a single line"));
    }
    let dir = ensure_ssh_dir(&app)?;
    let path = dir.join("authorized_keys");
    let existing = match fs::read(&path) {
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.into()),
    };
    if existing
        .lines()
        .any(|entry| entry.trim() == candidate)
    {
        return Ok(false);
    }
    let mut next = existing.trim_end().to_string();
    if !next.is_empty() {
        next.push('\n');
    }
    next.push_str(&candidate);
    next.push('\n');
    write_file_atomic(&path, next.as_bytes(), 0o600)?;
    Ok(true)
    }
}

// ==================== secure store / quick unlock ====================

/// keyring 4.x initialises the platform store lazily on the first `Entry::new`
/// (Keychain on macOS, Secret Service over D-Bus on Linux). `store_status()`
/// reports what that initialisation did, which is the difference between "no
/// keyring daemon on this box" and "nothing stored yet".
#[cfg(desktop)]
fn keyring_entry() -> Result<Entry, NativeError> {
    if let Err(error) = Entry::store_status() {
        return Err(NativeError::msg(format!(
            "secure store unavailable: {error}"
        )));
    }
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| NativeError::msg(error.to_string()))
}

fn keyring_available() -> bool {
    #[cfg(desktop)]
    {
        keyring_entry().is_ok()
    }
    /* The phones have no keyring crate, but they do have the thing a keyring
       is: a store the operating system guards. Android keeps the key inside
       the Keystore, iOS keeps the item in the Keychain, and neither hands it
       back without a face or a finger. See mobile_secure_store. */
    #[cfg(mobile)]
    {
        mobile_secure_store::state().available
    }
}

fn biometric_available() -> bool {
    /* Face ID, Touch ID and the Android prompt are reached through
       tauri-plugin-biometric, which answers from the webview rather than from
       here -- its status call is asynchronous and platform-specific, and this
       function is neither. Saying yes is therefore a statement about the
       build, not about the handset: the plugin is compiled in, so the front
       end has something to ask. Whether THIS phone has a face or a finger
       enrolled is settled by the plugin's own status call before any button
       is shown, which is the only place that can know. */
    #[cfg(mobile)]
    {
        true
    }
    #[cfg(all(desktop, target_os = "macos"))]
    {
        macos_local_auth_supported()
    }
    #[cfg(all(desktop, target_os = "windows"))]
    {
        true
    }
    #[cfg(all(desktop, target_os = "linux"))]
    {
        linux_biometric_supported()
    }
    #[cfg(all(desktop, not(any(target_os = "macos", target_os = "windows", target_os = "linux"))))]
    {
        false
    }
}

fn quick_unlock_enabled() -> bool {
    #[cfg(mobile)]
    {
        mobile_secure_store::state().has_secret
    }
    #[cfg(desktop)]
    keyring_entry()
        .and_then(|entry| {
            entry
                .get_password()
                .map(|_| ())
                .map_err(|error| NativeError::msg(error.to_string()))
        })
        .is_ok()
}

fn platform_label() -> &'static str {
    // The phones first: macOS and iOS both have a Keychain, but they are not
    // the same store and the front end shows this string to the person.
    if cfg!(target_os = "android") {
        "android-keystore"
    } else if cfg!(target_os = "ios") {
        "ios-keychain"
    } else if cfg!(target_os = "macos") {
        "macos-keychain"
    } else if cfg!(target_os = "windows") {
        "windows-credential-vault"
    } else if cfg!(target_os = "linux") {
        "linux-secret-service"
    } else {
        "desktop-secure-store"
    }
}


/* ---- UnifiedPush ------------------------------------------------------- */

#[tauri::command]
fn unifiedpush_status() -> mobile_unifiedpush::UnifiedPushStatus {
    mobile_unifiedpush::status()
}

/// Asks a distributor for an endpoint. The endpoint itself arrives later, as
/// a broadcast, so the caller polls the status rather than waiting here.
#[tauri::command]
fn unifiedpush_register(distributor: String) -> Result<bool, NativeError> {
    mobile_unifiedpush::register(&distributor)
}

#[tauri::command]
fn unifiedpush_unregister() -> Result<(), NativeError> {
    mobile_unifiedpush::unregister()
}

/// Arms the fifteen-minute fallback poll for a phone with no distributor.
#[tauri::command]
fn unifiedpush_poll_enable(origin: String, token: String) -> Result<(), NativeError> {
    mobile_unifiedpush::poll_enable(&origin, &token)
}

#[tauri::command]
fn unifiedpush_poll_disable() -> Result<(), NativeError> {
    mobile_unifiedpush::poll_disable()
}

#[tauri::command]
fn desktop_auth_status() -> DesktopAuthStatus {
    let biometric = biometric_available();
    DesktopAuthStatus {
        supported: biometric && keyring_available(),
        enabled: quick_unlock_enabled(),
        platform: platform_label().to_string(),
        biometric,
    }
}

#[tauri::command]
fn desktop_store_quick_unlock(master_password: String) -> Result<(), NativeError> {
    #[cfg(mobile)]
    {
        if master_password.is_empty() {
            return Err(NativeError::msg("master password is empty"));
        }
        /* No biometric challenge before writing, and that is on purpose: the
           person has just typed the master password, which is a stronger proof
           than a fingerprint. The challenge belongs on the way out, and the
           platform puts it there -- an Android key that refuses to decrypt and
           a Keychain item that refuses to be read. */
        return mobile_secure_store::store(&master_password).map_err(NativeError::msg);
    }
    #[cfg(desktop)]
    {
    if master_password.is_empty() {
        return Err(NativeError::msg("master password is empty"));
    }
    // Never arm quick unlock on a machine that cannot challenge the user
    // first — the stored secret would otherwise be one click away.
    if !biometric_available() {
        return Err(NativeError::msg(
            "this machine has no biometric or system authentication available",
        ));
    }
    let entry = keyring_entry()?;
    entry
        .set_password(&master_password)
        .map_err(|error| NativeError::msg(error.to_string()))
    }
}

#[tauri::command]
fn desktop_unlock_with_biometric() -> Result<String, NativeError> {
    #[cfg(mobile)]
    {
        /* The front end has just satisfied the platform's biometric prompt
           through tauri-plugin-biometric; on Android that opens the Keystore
           key's authentication window, and on iOS the Keychain raises its own
           prompt as the item is read. Either way the refusal below is the
           operating system's answer, not a judgement made here. */
        return mobile_secure_store::retrieve()
            .ok_or_else(|| NativeError::msg("the device did not release the stored password"));
    }
    #[cfg(desktop)]
    {
        require_biometric_authentication()?;
        let entry = keyring_entry()?;
        entry
            .get_password()
            .map_err(|error| NativeError::msg(error.to_string()))
    }
}

#[tauri::command]
fn desktop_clear_quick_unlock() -> Result<(), NativeError> {
    #[cfg(mobile)]
    {
        /* Forgetting takes no biometric challenge. Turning the feature off has
           to work for somebody whose finger the sensor no longer recognises --
           that is one of the reasons to turn it off -- and nothing is
           disclosed by deleting. */
        mobile_secure_store::clear();
        return Ok(());
    }
    #[cfg(desktop)]
    {
        let entry = keyring_entry()?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(error) if error.to_string().to_lowercase().contains("no entry") => Ok(()),
            Err(error) => Err(NativeError::msg(error.to_string())),
        }
    }
}

// ==================== secure deletion ====================

/// Paths the shredder refuses outright. Everything else — the home directory,
/// external volumes, `/opt`, `/srv`, scratch space — is fair game, because
/// "full access for shredding" is the point of the feature. These roots are
/// excluded only because overwriting them breaks the running OS rather than
/// destroying a user's file.
#[cfg(all(desktop, target_os = "macos"))]
const PROTECTED_ROOTS: &[&str] = &[
    "/System", "/bin", "/sbin", "/dev", "/cores", "/usr/bin", "/usr/sbin", "/usr/lib",
    "/usr/libexec", "/usr/share", "/private/var/db", "/Library/Apple",
    // /etc and /private/etc are the same directory once canonicalized, and
    // /Library carries system-wide configuration the OS needs to boot into a
    // usable state. Both were missing, so `/etc/passwd` was shreddable.
    "/etc", "/private/etc", "/Library",
];
#[cfg(all(desktop, target_os = "linux"))]
const PROTECTED_ROOTS: &[&str] = &[
    "/proc", "/sys", "/dev", "/boot", "/bin", "/sbin", "/etc", "/lib", "/lib32", "/lib64",
    "/libx32", "/usr/bin", "/usr/sbin", "/usr/lib", "/usr/lib32", "/usr/lib64", "/usr/libexec",
    "/usr/share",
];
#[cfg(all(desktop, target_os = "windows"))]
const PROTECTED_ROOTS: &[&str] = &["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)"];
#[cfg(all(desktop, not(any(target_os = "macos", target_os = "linux", target_os = "windows"))))]
const PROTECTED_ROOTS: &[&str] = &[];

enum ShredPass {
    Random,
    Byte(u8),
}

#[tauri::command]
fn desktop_shred_file(path: String, remove_after_shred: bool) -> Result<ShredResult, NativeError> {
    #[cfg(mobile)]
    {
        // A sandboxed app cannot reach the file the picker handed it as a
        // path, and on flash storage an overwrite would not erase it anyway.
        let _ = (&path, remove_after_shred);
        return desktop_only("secure file deletion");
    }
    #[cfg(desktop)]
    {
    let target = validate_shred_target(Path::new(&path))?;
    let bytes = shred_path(&target, remove_after_shred)?;
    Ok(ShredResult {
        removed: remove_after_shred,
        bytes,
        passes: 3,
    })
    }
}

/// Three passes — random, `0x00`, `0xff` — then truncate, rename, unlink.
///
/// On a copy-on-write or wear-levelled filesystem (APFS, btrfs, any SSD) the
/// overwrite lands on fresh blocks and the originals may survive until the
/// controller reuses them. This is the strongest thing a userspace process can
/// do; full-disk encryption is what actually guarantees erasure.
fn shred_path(path: &Path, remove: bool) -> Result<u64, NativeError> {
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(NativeError::msg("target is not a file"));
    }
    let len = metadata.len();

    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    overwrite_file(&mut file, len, ShredPass::Random)?;
    overwrite_file(&mut file, len, ShredPass::Byte(0x00))?;
    overwrite_file(&mut file, len, ShredPass::Byte(0xff))?;
    file.set_len(0)?;
    file.sync_all()?;
    drop(file);

    if remove {
        // Scrub the directory entry too: the name of a shredded file is
        // often as telling as its contents.
        let scrubbed = path
            .parent()
            .map(|parent| parent.join(format!("{}.tmp", random_hex(16))));
        let final_path = match scrubbed {
            Some(candidate) if fs::rename(path, &candidate).is_ok() => candidate,
            _ => path.to_path_buf(),
        };
        fs::remove_file(&final_path)?;
    }

    Ok(len)
}

#[cfg(desktop)]
fn validate_shred_target(path: &Path) -> Result<PathBuf, NativeError> {
    if path.as_os_str().is_empty() {
        return Err(NativeError::msg("empty path"));
    }
    if !path.is_absolute() {
        return Err(NativeError::msg("shred target must be an absolute path"));
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(NativeError::msg("relative path traversal is not allowed"));
    }

    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        // Shredding through a symlink would destroy whatever it points at,
        // which is never what the person picking a file meant.
        return Err(NativeError::msg("refusing to shred a symbolic link"));
    }
    if !metadata.is_file() {
        return Err(NativeError::msg("target is not a regular file"));
    }

    let parent = path
        .parent()
        .ok_or_else(|| NativeError::msg("shred target has no parent directory"))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| NativeError::msg("shred target has no file name"))?;
    // Resolve the directory, not the file: `/tmp` is a symlink to
    // `/private/tmp` on macOS, and a denylist that ignored that would be
    // trivially bypassable.
    let resolved = fs::canonicalize(parent)?.join(file_name);

    for root in PROTECTED_ROOTS {
        if resolved.starts_with(root) {
            return Err(NativeError::msg(format!(
                "{} is inside a protected system location and cannot be shredded",
                resolved.display()
            )));
        }
    }

    Ok(resolved)
}

fn overwrite_file(file: &mut fs::File, len: u64, pass: ShredPass) -> Result<(), NativeError> {
    const CHUNK_SIZE: usize = 1024 * 1024;
    let mut remaining = len;
    let mut buffer = vec![0u8; CHUNK_SIZE];
    file.seek(SeekFrom::Start(0))?;

    while remaining > 0 {
        let write_len = remaining.min(CHUNK_SIZE as u64) as usize;
        match pass {
            ShredPass::Random => {
                getrandom::fill(&mut buffer[..write_len])
                    .map_err(|error| NativeError::msg(error.to_string()))?;
            }
            ShredPass::Byte(byte) => buffer[..write_len].fill(byte),
        }
        file.write_all(&buffer[..write_len])?;
        remaining -= write_len as u64;
    }
    file.flush()?;
    file.sync_data()?;
    Ok(())
}

// ==================== relay discovery ====================

/// Asks a candidate origin whether it is a P00RIJA relay. This is the one
/// outbound request the shell makes, and it carries no user data.
#[cfg(mobile)]
#[tauri::command]
async fn desktop_probe_relay_origin(
    origin: String,
) -> Result<Option<RelayProbeResult>, NativeError> {
    // The webview's own fetch reaches the relay directly on mobile: there is
    // no custom-scheme mixed-content rule to work around, so probeRelayOrigin()
    // in chat.js never needs this fallback here.
    let _ = normalize_relay_origin(&origin)?;
    Ok(None)
}

#[cfg(desktop)]
#[tauri::command]
async fn desktop_probe_relay_origin(
    origin: String,
) -> Result<Option<RelayProbeResult>, NativeError> {
    let origin = normalize_relay_origin(&origin)?;
    // Async client on purpose: `reqwest::blocking` builds its own runtime and
    // panics when constructed inside the one Tauri commands already run on.
    let client = reqwest::Client::builder()
        .timeout(RELAY_PROBE_TIMEOUT)
        .build()
        .map_err(|error| NativeError::msg(error.to_string()))?;

    let health_url = url::Url::parse(&origin)
        .and_then(|url| url.join("/chat-health"))
        .map_err(|error| NativeError::msg(error.to_string()))?;
    let health_response = match client
        .get(health_url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response,
        Ok(_) | Err(_) => return Ok(None),
    };
    let health: Value = match health_response.json().await {
        Ok(payload) => payload,
        Err(_) => return Ok(None),
    };
    let service = health
        .get("service")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let healthy = health.get("ok").and_then(Value::as_bool).unwrap_or(false);
    if !healthy || !service.contains("poorija-chat-signal") {
        return Ok(None);
    }

    let turn_url = url::Url::parse(&origin)
        .and_then(|url| url.join("/turn-config"))
        .map_err(|error| NativeError::msg(error.to_string()))?;
    let turn_config = match client
        .get(turn_url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response.json().await.ok(),
        _ => None,
    };

    Ok(Some(RelayProbeResult {
        origin,
        health,
        turn_config,
    }))
}

fn normalize_relay_origin(raw_origin: &str) -> Result<String, NativeError> {
    let trimmed = raw_origin.trim();
    if trimmed.is_empty() {
        return Err(NativeError::msg("relay origin is empty"));
    }
    // Anything that names a scheme has to name one we speak. Without this the
    // fallback below reads "ws://relay:9000" as the host "ws" and hands back
    // "https://ws" — a valid-looking origin pointing nowhere.
    if let Some(index) = trimmed.find("://") {
        let scheme = trimmed[..index].to_ascii_lowercase();
        if scheme != "http" && scheme != "https" {
            return Err(NativeError::msg("relay origin must use http or https"));
        }
    }
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        let hostish = trimmed
            .split(['/', '?', '#'])
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        let host = if hostish.starts_with('[') {
            hostish
                .trim_start_matches('[')
                .split(']')
                .next()
                .unwrap_or_default()
                .to_string()
        } else {
            hostish.split(':').next().unwrap_or_default().to_string()
        };
        let local = matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1" | "0.0.0.0")
            || host.ends_with(".localhost");
        let scheme = if local { "http" } else { "https" };
        format!("{scheme}://{trimmed}")
    };
    let parsed =
        url::Url::parse(&with_scheme).map_err(|error| NativeError::msg(error.to_string()))?;
    if parsed.host().is_none() {
        return Err(NativeError::msg("relay origin has no host"));
    }
    match parsed.scheme() {
        "http" | "https" => Ok(parsed.origin().ascii_serialization()),
        _ => Err(NativeError::msg("relay origin must use http or https")),
    }
}

// ==================== window icon ====================

/// Window icon per appearance profile.
///
/// On Linux and Windows this changes the window and taskbar icon immediately.
/// On macOS a window has no icon of its own — the Dock shows the bundle's —
/// so the Dock tile is set instead, which is the equivalent thing a person
/// actually sees there.
#[tauri::command]
fn set_window_icon<R: Runtime>(app: AppHandle<R>, profile: String) -> Result<(), NativeError> {
    #[cfg(mobile)]
    {
        // The launcher icon is fixed at install time on both mobile platforms.
        let _ = (app, profile);
        return Ok(());
    }
    #[cfg(desktop)]
    {
    // Every profile the settings panel offers, each with its own artwork.
    //
    // This used to name three profiles and point two of them at the app's
    // ordinary icons, so switching changed nothing anybody could see. The four
    // low-attention profiles — folder, notes, terminal, settings — fell through
    // to the default, which defeats the entire point of them: their whole
    // purpose is that a glance at the dock does not say "encryption app".
    //
    // The PNGs are rendered from assets/desktop-icons/*.svg by
    // scripts/build-icon-profiles.sh and committed, so this compiles without a
    // rasteriser on the build machine.
    let bytes: &[u8] = match profile.as_str() {
        "poorija-midnight" => include_bytes!("../icons/profiles/poorija-midnight.png"),
        "poorija-linen" => include_bytes!("../icons/profiles/poorija-linen.png"),
        "system-folder" => include_bytes!("../icons/profiles/system-folder.png"),
        "system-notes" => include_bytes!("../icons/profiles/system-notes.png"),
        "system-terminal" => include_bytes!("../icons/profiles/system-terminal.png"),
        "system-settings" => include_bytes!("../icons/profiles/system-settings.png"),
        _ => include_bytes!("../icons/profiles/poorija-default.png"),
    };
    let icon = Image::from_bytes(bytes).map_err(|error| NativeError::msg(error.to_string()))?;
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_icon(icon.clone())
            .map_err(|error| NativeError::msg(error.to_string()))?;
    }
    // The tray icon follows the profile too.
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_icon(Some(icon)).ok();
    }
    // And on macOS the part a person actually looks at: the Dock tile. The
    // comment that used to live here said Tauri exposes no way to replace a
    // running app's Dock tile — true of Tauri, false of macOS, which has a
    // public setter (NSApplication.setApplicationIconImage). objc2 is already
    // a dependency, so a raw message send on the main thread closes the gap
    // without adding one.
    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread(move || {
            set_dock_icon_macos(bytes);
        })
        .map_err(|error| NativeError::msg(error.to_string()))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = bytes; // consumed by the Dock above, macOS only
    }
    Ok(())
    }
}

/* The Dock tile, the one macOS way there is to set it. Everything is a plain
   message send against the ObjC runtime: sharedApplication → NSData with the
   PNG bytes → NSImage initWithData → setApplicationIconImage. All of it must
   run on the main thread, which the caller arranges. Raw pointers rather than
   Retained: these are one-shot untyped messages and the ownership story is
   three lines — alloc/init leaves one +1 on the image, which the release at
   the end balances; dataWithBytes returns an autoreleased object the pool
   collects. */
#[cfg(all(desktop, target_os = "macos"))]
fn set_dock_icon_macos(png: &'static [u8]) {
    use objc2::{class, msg_send, runtime::AnyObject};
    unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if app.is_null() {
            return;
        }
        let data: *mut AnyObject =
            msg_send![class!(NSData), dataWithBytes: png.as_ptr(), length: png.len()];
        if data.is_null() {
            return;
        }
        let allocated: *mut AnyObject = msg_send![class!(NSImage), alloc];
        if allocated.is_null() {
            return;
        }
        let image: *mut AnyObject = msg_send![allocated, initWithData: data];
        if image.is_null() {
            return;
        }
        let _: () = msg_send![app, setApplicationIconImage: image];
        let _: () = msg_send![allocated, release];
    }
}

// ==================== platform authentication ====================

#[cfg(all(desktop, target_os = "macos"))]
fn macos_local_auth_supported() -> bool {
    use objc2_local_authentication::{LAContext, LAPolicy};

    let context = unsafe { LAContext::new() };
    unsafe {
        context
            .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication)
            .is_ok()
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn require_biometric_authentication() -> Result<(), NativeError> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::sync::mpsc;

    let context = unsafe { LAContext::new() };
    // DeviceOwnerAuthentication = Touch ID *or* the account password, so Macs
    // without a Touch Bar / Touch ID sensor still get a real challenge instead
    // of the feature silently disappearing.
    unsafe {
        context
            .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication)
            .map_err(|error| {
                NativeError::msg(format!("system authentication is not available: {error}"))
            })?;
    }

    let reason = NSString::from_str("unlock P00RIJA Cryptography");
    let (sender, receiver) = mpsc::channel();
    let reply = RcBlock::new(move |success: Bool, _error: *mut NSError| {
        let _ = sender.send(success.as_bool());
    });

    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthentication,
            &reason,
            &reply,
        );
    }

    match receiver.recv_timeout(Duration::from_secs(60)) {
        Ok(true) => Ok(()),
        Ok(false) => Err(NativeError::msg(
            "Touch ID authentication failed or was cancelled",
        )),
        Err(_) => Err(NativeError::msg("Touch ID authentication timed out")),
    }
}

#[cfg(all(desktop, target_os = "windows"))]
fn require_biometric_authentication() -> Result<(), NativeError> {
    use robius_authentication::{
        AndroidText, BiometricStrength, Context, PolicyBuilder, Text, WindowsText,
    };

    let policy = PolicyBuilder::new()
        .biometrics(Some(BiometricStrength::Strong))
        .password(true)
        .build()
        .ok_or_else(|| NativeError::msg("Windows Hello policy is not available"))?;
    let text = Text {
        android: AndroidText {
            title: "P00RIJA Cryptography",
            subtitle: None,
            description: Some("Unlock secure storage"),
        },
        apple: "unlock P00RIJA Cryptography",
        windows: WindowsText::new_truncated(
            "P00RIJA Cryptography",
            "Confirm with Windows Hello to unlock quick access",
        ),
    };

    Context::new(())
        .blocking_authenticate(text, &policy)
        .map_err(|error| {
            NativeError::msg(format!("Windows Hello authentication failed: {error:?}"))
        })
}

/// The only directories a program allowed to *stand in for a fingerprint* may
/// be loaded from. All four are root-owned on every distribution; none of them
/// is on a normal user's writable path.
#[cfg(all(desktop, target_os = "linux"))]
const LINUX_AUTH_BIN_DIRS: [&str; 4] = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

/// Resolve an authentication helper to an absolute path inside one of those
/// directories, or not at all.
///
/// This used to be a `$PATH` lookup followed by `Command::new("fprintd-verify")`,
/// which resolves through `$PATH` a second time at exec. Anything that could
/// prepend a directory to this process's `PATH` — a `.desktop` file, a shell
/// profile, the wrapper script inside an AppImage — could therefore drop in its
/// own `fprintd-verify`, exit 0, and `desktop_unlock_with_biometric` would hand
/// back the master password having authenticated nobody. An absolute path from
/// a fixed list is not something an environment variable can redirect.
#[cfg(all(desktop, target_os = "linux"))]
fn linux_auth_binary(command: &str) -> Option<std::path::PathBuf> {
    LINUX_AUTH_BIN_DIRS
        .iter()
        .map(|dir| std::path::Path::new(dir).join(command))
        .find(|candidate| candidate.is_file())
}

#[cfg(all(desktop, target_os = "linux"))]
fn linux_biometric_supported() -> bool {
    linux_auth_binary("fprintd-verify").is_some() || linux_auth_binary("pkexec").is_some()
}

#[cfg(all(desktop, target_os = "linux"))]
fn require_biometric_authentication() -> Result<(), NativeError> {
    if let Some(binary) = linux_auth_binary("fprintd-verify") {
        /* No username argument. It used to pass $USER, which is an environment
           variable: setting it to another account's name asked fprintd to
           verify SOMEBODY ELSE's finger and accepted that as this user's
           unlock. With no argument fprintd verifies the calling uid, which is
           the only account whose vault is on this machine anyway. */
        match std::process::Command::new(&binary).status() {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => {
                return Err(NativeError::msg(format!(
                    "fingerprint verification failed with status {status}"
                )))
            }
            Err(error) => {
                return Err(NativeError::msg(format!(
                    "fingerprint verification could not start: {error}"
                )))
            }
        }
    }

    if let Some(binary) = linux_auth_binary("pkexec") {
        // /bin/true by absolute path for the same reason pkexec itself is.
        let helper = linux_auth_binary("true")
            .ok_or_else(|| NativeError::msg("Polkit authentication needs /usr/bin/true"))?;
        let status = std::process::Command::new(&binary)
            .arg(&helper)
            .status()
            .map_err(|error| {
                NativeError::msg(format!("Polkit authentication failed to start: {error}"))
            })?;
        if status.success() {
            return Ok(());
        }
        return Err(NativeError::msg(format!(
            "Polkit authentication failed with status {status}"
        )));
    }

    Err(NativeError::msg(
        "Linux authentication requires fprintd or a Polkit/PAM agent",
    ))
}

/* Linux is the one desktop webview that refuses to decide permissions itself:
   WebKitGTK emits `permission-request` and denies outright when no handler
   answers — so every getUserMedia() call dies silently and with it all calls
   and voice messages. macOS (WKWebView) and Windows (WebView2) either decide
   through their own OS prompts or default to allowing the first-party page,
   which is why the same app works there with no shell-side code. wry never
   connects the signal, so the shell does. The only origin this window ever
   loads is the app itself, so a request reaching this handler is one the
   user's own click started. */
#[cfg(all(desktop, target_os = "linux"))]
fn grant_webkit_permission_requests<R: Runtime>(app: &AppHandle<R>) {
    use webkit2gtk::{PermissionRequestExt, WebViewExt};

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.with_webview(|webview| {
            webview
                .inner()
                .connect_permission_request(|_view, request| {
                    /* Only the two WebKitGTK will not decide for itself, and
                       only those two.

                       `request.allow()` for everything also handed out
                       notifications, device enumeration, pointer lock and
                       media-key access with no prompt and no record — none of
                       which is what this handler exists for, and all of which
                       the macOS and Windows webviews still gate. Camera,
                       microphone and location are features this app ships and
                       the user reaches by their own click in this window, so
                       those are granted; everything else falls through to
                       WebKitGTK's own default, which is to deny. */
                    use webkit2gtk::glib::prelude::*;
                    use webkit2gtk::{GeolocationPermissionRequest, UserMediaPermissionRequest};
                    let wanted = request
                        .dynamic_cast_ref::<UserMediaPermissionRequest>()
                        .is_some()
                        || request
                            .dynamic_cast_ref::<GeolocationPermissionRequest>()
                            .is_some();
                    if wanted {
                        request.allow();
                        // The request is decided; no further handler should run.
                        return true;
                    }
                    false
                });
        });
    }
}

#[cfg(all(desktop, not(any(target_os = "macos", target_os = "windows", target_os = "linux"))))]
fn require_biometric_authentication() -> Result<(), NativeError> {
    Err(NativeError::msg(
        "this platform has no system authentication backend",
    ))
}

// ==================== small helpers ====================

fn modified_secs(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(desktop)]
fn unix_mode(metadata: &fs::Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        metadata.mode() & 0o777
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        0
    }
}

fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    if getrandom::fill(&mut buffer).is_err() {
        // Only ever used to pick a throwaway filename; a time-based fallback
        // is fine and keeps shredding from failing on an entropy hiccup.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        return format!("{nanos:032x}");
    }
    buffer.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Write via a sibling temp file and rename, so a crash mid-write leaves the
/// previous version intact rather than a truncated one.
fn write_file_atomic(path: &Path, bytes: &[u8], mode: u32) -> Result<(), NativeError> {
    let parent = path
        .parent()
        .ok_or_else(|| NativeError::msg("target has no parent directory"))?;
    fs::create_dir_all(parent)?;
    let temp = parent.join(format!(".{}.tmp", random_hex(12)));

    {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(mode);
        }
        #[cfg(not(unix))]
        {
            let _ = mode;
        }
        let mut file = options.open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }

    // rename() replaces the destination atomically on both macOS and Linux.
    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
    }
    Ok(())
}

fn sanitize_file_name(name: &str) -> Result<String, NativeError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(NativeError::msg("file name is empty"));
    }
    if trimmed.len() > 255 {
        return Err(NativeError::msg("file name is too long"));
    }
    if trimmed.contains(['/', '\\', ':', '\0']) {
        return Err(NativeError::msg(
            "file name must be a single path segment without separators",
        ));
    }
    // Belt and braces: whatever the string looks like, the platform must also
    // read it as exactly one ordinary component.
    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(part)), None) if part.to_string_lossy() == trimmed => {
            Ok(trimmed.to_string())
        }
        _ => Err(NativeError::msg(
            "file name must be a single path segment without separators",
        )),
    }
}

const B64_TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = u32::from(chunk[0]);
        let b1 = u32::from(*chunk.get(1).unwrap_or(&0));
        let b2 = u32::from(*chunk.get(2).unwrap_or(&0));
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64_TABLE[(triple >> 18) as usize & 63] as char);
        out.push(B64_TABLE[(triple >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64_TABLE[(triple >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64_TABLE[triple as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Standard base64, strict about padding.
///
/// The previous decoder only recognised `=` in the last position, so every
/// payload whose length was 1 mod 3 — one third of them — came back as
/// "invalid base64" and the vault snapshot never wrote.
fn base64_decode(input: &str) -> Result<Vec<u8>, NativeError> {
    let filtered: Vec<u8> = input
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect();
    if filtered.is_empty() || filtered.len() % 4 != 0 {
        return Err(NativeError::msg("invalid base64 payload"));
    }

    let quads = filtered.len() / 4;
    let mut out = Vec::with_capacity(quads * 3);
    for (index, chunk) in filtered.chunks(4).enumerate() {
        let is_last = index + 1 == quads;
        let pad = chunk.iter().filter(|byte| **byte == b'=').count();
        let padding_is_legal = pad == 0
            || (is_last && pad <= 2 && chunk[3] == b'=' && (pad == 1 || chunk[2] == b'='));
        if !padding_is_legal {
            return Err(NativeError::msg("invalid base64 padding"));
        }

        let mut values = [0u8; 4];
        for (position, byte) in chunk.iter().enumerate() {
            values[position] = if *byte == b'=' {
                0
            } else {
                base64_value(*byte)
                    .ok_or_else(|| NativeError::msg("invalid base64 payload"))?
            };
        }
        let triple = (u32::from(values[0]) << 18)
            | (u32::from(values[1]) << 12)
            | (u32::from(values[2]) << 6)
            | u32::from(values[3]);

        out.push((triple >> 16) as u8);
        if pad < 2 {
            out.push((triple >> 8) as u8);
        }
        if pad < 1 {
            out.push(triple as u8);
        }
    }
    Ok(out)
}

// ==================== tray ====================

/// macOS menu-bar icons are template images: only the alpha channel is used,
/// and the system tints them for the current appearance. Flattening the colour
/// to black is what turns the app icon into one.
#[cfg(all(desktop, target_os = "macos"))]
fn template_icon(icon: &Image<'_>) -> Image<'static> {
    let mut rgba = icon.rgba().to_vec();
    for pixel in rgba.chunks_exact_mut(4) {
        pixel[0] = 0;
        pixel[1] = 0;
        pixel[2] = 0;
    }
    Image::new_owned(rgba, icon.width(), icon.height())
}

#[cfg(desktop)]
fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "tray-show", "Show P00RIJA Cryptography", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "tray-hide", "Hide Window", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit P00RIJA Cryptography", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("P00RIJA Cryptography")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show" => show_main_window(app),
            "tray-hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    // The Linux AppIndicator protocol has no click event at all — the menu is
    // the only way in, so it has to open on the primary button.
    #[cfg(target_os = "linux")]
    {
        builder = builder.show_menu_on_left_click(true);
    }
    #[cfg(not(target_os = "linux"))]
    {
        builder = builder.show_menu_on_left_click(false);
    }

    if let Some(icon) = app.default_window_icon().cloned() {
        #[cfg(target_os = "macos")]
        {
            builder = builder.icon(template_icon(&icon)).icon_as_template(true);
        }
        #[cfg(not(target_os = "macos"))]
        {
            builder = builder.icon(icon);
        }
    }

    builder.build(app)?;
    Ok(())
}

// ==================== entry point ====================

/// The entry point for every platform.
///
/// `mobile_entry_point` is what Android's and iOS's generated shells call into;
/// on desktop `main.rs` calls this directly and the attribute expands to
/// nothing.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        /* WebKitGTK's DMABUF renderer is the well-known source of the lag,
         * stutter and flicker reported on Tauri apps across Linux drivers —
         * the plain compositor path is smooth and visually identical. This
         * must be set before the webview (and its network process) spawns. */
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            // Must be first: a second launch has to reach the running instance
            // before anything else initialises.
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                show_main_window(app);
            }))
            .plugin(tauri_plugin_autostart::init(
                MacosLauncher::LaunchAgent,
                Some(vec!["--minimized"]),
            ));
    }

    /* Face ID, Touch ID and the Android prompt. Mobile only: the desktop
       answers the same question through the operating system directly, and
       the crate does not exist for those targets. */
    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_biometric::init());
    }

    let app = builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            unifiedpush_status,
            unifiedpush_register,
            unifiedpush_unregister,
            unifiedpush_poll_enable,
            unifiedpush_poll_disable,
            desktop_auth_status,
            desktop_store_quick_unlock,
            desktop_unlock_with_biometric,
            desktop_clear_quick_unlock,
            desktop_probe_relay_origin,
            desktop_shred_file,
            set_window_icon,
            desktop_get_close_behavior,
            desktop_set_close_behavior,
            desktop_get_shell_settings,
            desktop_set_shell_settings,
            desktop_show_window,
            desktop_hide_window,
            desktop_quit,
            desktop_set_badge_count,
            desktop_platform_info,
            desktop_debug_log,
            desktop_open_external,
            desktop_app_data_dir,
            desktop_vault_dir,
            desktop_write_app_file,
            desktop_read_app_file,
            desktop_list_app_files,
            desktop_delete_app_file,
            desktop_ssh_dir_path,
            desktop_ssh_list_entries,
            desktop_ssh_read_file,
            desktop_ssh_write_file,
            desktop_ssh_delete_file,
            desktop_ssh_append_authorized_key
        ])
        .setup(|app| {
            #[allow(unused_variables)]
            let handle = app.handle().clone();

            // A tray that cannot be created is not a reason to refuse to
            // start — it is a reason to keep the close button meaning "quit",
            // which is what the window-event handler below does with this.
            #[cfg(desktop)]
            {
            let tray_available = match create_tray(&handle) {
                Ok(()) => true,
                Err(error) => {
                    eprintln!(
                        "P00RIJA: no system tray ({error}). Closing the window will quit; \
                         on GNOME this usually means the AppIndicator extension is missing."
                    );
                    false
                }
            };
            handle.manage(TrayState { available: tray_available });

            let settings = read_shell_settings(&handle);
            // The OS registration is the thing that actually runs at login;
            // re-assert it so a stale login item cannot outlive the setting.
            if let Err(error) = apply_autostart(&handle, settings.autostart) {
                eprintln!("autostart: {error}");
            }

            // Before anything else can ask for the microphone or camera: on
            // Linux an unanswered permission request is a denied one, so this
            // has to be in place from the very first frame.
            #[cfg(target_os = "linux")]
            grant_webkit_permission_requests(&handle);

            // The window is created hidden (tauri.conf.json) so "start
            // minimized" never flashes a window before hiding it again.
            let launched_at_login = std::env::args()
                .any(|arg| arg == "--minimized" || arg == "--hidden" || arg == "--autostart");
            if let Some(window) = handle.get_webview_window("main") {
                if settings.start_minimized && launched_at_login {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                // User-selectable close behaviour: "tray" (default) keeps the
                // app alive in the background with its tray icon; "quit" exits.
                // With no tray there is nothing to restore the window from, so
                // hiding it would strand the user with an invisible process.
                let app = window.app_handle();
                let keep_running =
                    read_shell_settings(app).close_behavior != "quit" && tray_available(app);
                if keep_running {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    app.exit(0);
                }
            }
            }
            #[cfg(mobile)]
            let _ = (window, event);
        })
        .build(tauri::generate_context!())
        .expect("error while building P00RIJA Cryptography");

    app.run(|_app_handle, _event| {
        // Clicking the Dock icon of an app whose only window is hidden fires
        // Reopen and nothing else — without this the app looks dead.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            show_main_window(_app_handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trips_every_padding_length() {
        for len in 0..32usize {
            let data: Vec<u8> = (0..len).map(|index| (index * 7 + 3) as u8).collect();
            let encoded = base64_encode(&data);
            if data.is_empty() {
                assert!(encoded.is_empty());
                continue;
            }
            let decoded = base64_decode(&encoded).expect("decode");
            assert_eq!(decoded, data, "round trip failed for length {len}");
        }
    }

    #[test]
    fn base64_rejects_misplaced_padding() {
        assert!(base64_decode("QQ=A").is_err());
        assert!(base64_decode("=QQQ").is_err());
        assert!(base64_decode("QQ==QQ==").is_err());
        assert!(base64_decode("QUJD!").is_err());
        assert!(base64_decode("QUJ").is_err());
    }

    #[test]
    fn sanitize_rejects_separators_and_traversal() {
        assert!(sanitize_file_name("id_ed25519").is_ok());
        assert!(sanitize_file_name("vault.snapshot.enc").is_ok());
        assert!(sanitize_file_name("nested/name").is_err());
        assert!(sanitize_file_name("nested\\name").is_err());
        assert!(sanitize_file_name("..").is_err());
        assert!(sanitize_file_name(".").is_err());
        assert!(sanitize_file_name("../../etc/passwd").is_err());
        assert!(sanitize_file_name("C:name").is_err());
        assert!(sanitize_file_name("   ").is_err());
    }

    #[test]
    fn relay_origin_normalizes_scheme_and_host() {
        assert_eq!(
            normalize_relay_origin("localhost:9000").unwrap(),
            "http://localhost:9000"
        );
        assert_eq!(
            normalize_relay_origin("example.org").unwrap(),
            "https://example.org"
        );
        assert_eq!(
            normalize_relay_origin("https://example.org:8585/path").unwrap(),
            "https://example.org:8585"
        );
        assert!(normalize_relay_origin("ftp://example.org").is_err());
        assert!(normalize_relay_origin("ws://relay:9000").is_err());
        assert!(normalize_relay_origin("wss://relay.example.org").is_err());
        assert!(normalize_relay_origin("file:///etc/passwd").is_err());
        assert!(normalize_relay_origin("   ").is_err());
    }

    #[test]
    fn shred_refuses_relative_and_missing_paths() {
        assert!(validate_shred_target(Path::new("relative/file")).is_err());
        assert!(validate_shred_target(Path::new("")).is_err());
    }
}
