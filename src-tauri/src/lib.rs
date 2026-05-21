use std::{
    fs::{self, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use keyring_core::Entry;
use serde::Serialize;
use serde_json::Value;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, WindowEvent,
};

const KEYRING_SERVICE: &str = "com.p00rija.cryptography";
const KEYRING_ACCOUNT: &str = "desktop-quick-unlock";
const RELAY_PROBE_TIMEOUT: Duration = Duration::from_millis(1800);

#[derive(Debug, thiserror::Error)]
enum NativeError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
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
struct DesktopAuthStatus {
    supported: bool,
    enabled: bool,
    platform: String,
}

#[derive(Serialize)]
struct ShredResult {
    removed: bool,
    bytes: u64,
}

#[derive(Serialize)]
struct RelayProbeResult {
    origin: String,
    health: Value,
    #[serde(rename = "turnConfig")]
    turn_config: Option<Value>,
}

fn keyring_entry() -> Result<Entry, NativeError> {
    keyring::use_native_store(true).map_err(|error| NativeError::Message(error.to_string()))?;
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| NativeError::Message(error.to_string()))
}

fn keyring_supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_biometric_supported() && keyring_entry().is_ok()
    }
    #[cfg(target_os = "windows")]
    {
        keyring_entry().is_ok()
    }
    #[cfg(target_os = "linux")]
    {
        linux_biometric_supported() && keyring_entry().is_ok()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        keyring_entry().is_ok()
    }
}

fn quick_unlock_enabled() -> bool {
    keyring_entry()
        .and_then(|entry| {
            entry
                .get_password()
                .map(|_| ())
                .map_err(|error| NativeError::Message(error.to_string()))
        })
        .is_ok()
}

fn platform_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos-keychain"
    } else if cfg!(target_os = "windows") {
        "windows-credential-vault"
    } else if cfg!(target_os = "linux") {
        "linux-secret-service"
    } else {
        "desktop-secure-store"
    }
}

#[tauri::command]
fn desktop_auth_status() -> DesktopAuthStatus {
    DesktopAuthStatus {
        supported: keyring_supported(),
        enabled: quick_unlock_enabled(),
        platform: platform_label().to_string(),
    }
}

#[tauri::command]
fn desktop_store_quick_unlock(master_password: String) -> Result<(), NativeError> {
    if master_password.is_empty() {
        return Err(NativeError::Message("master password is empty".into()));
    }
    let entry = keyring_entry()?;
    entry
        .set_password(&master_password)
        .map_err(|error| NativeError::Message(error.to_string()))
}

#[tauri::command]
fn desktop_unlock_with_biometric() -> Result<String, NativeError> {
    require_biometric_authentication()?;
    let entry = keyring_entry()?;
    entry
        .get_password()
        .map_err(|error| NativeError::Message(error.to_string()))
}

#[tauri::command]
fn desktop_clear_quick_unlock() -> Result<(), NativeError> {
    let entry = keyring_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(error) if error.to_string().to_lowercase().contains("no entry") => Ok(()),
        Err(error) => Err(NativeError::Message(error.to_string())),
    }
}

#[tauri::command]
fn desktop_shred_file(path: String, remove_after_shred: bool) -> Result<ShredResult, NativeError> {
    let path = PathBuf::from(path);
    validate_shred_target(&path)?;
    let metadata = fs::metadata(&path)?;
    if !metadata.is_file() {
        return Err(NativeError::Message("target is not a file".into()));
    }

    let len = metadata.len();
    let mut file = OpenOptions::new().read(true).write(true).open(&path)?;
    overwrite_file(&mut file, len, ShredPass::Random)?;
    overwrite_file(&mut file, len, ShredPass::Byte(0x00))?;
    overwrite_file(&mut file, len, ShredPass::Byte(0xff))?;
    file.set_len(0)?;
    file.sync_all()?;
    drop(file);

    if remove_after_shred {
        fs::remove_file(&path)?;
    }

    Ok(ShredResult {
        removed: remove_after_shred,
        bytes: len,
    })
}

#[tauri::command]
fn desktop_probe_relay_origin(origin: String) -> Result<Option<RelayProbeResult>, NativeError> {
    let origin = normalize_relay_origin(&origin)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(RELAY_PROBE_TIMEOUT)
        .build()
        .map_err(|error| NativeError::Message(error.to_string()))?;

    let health_url = url::Url::parse(&origin)
        .and_then(|url| url.join("/chat-health"))
        .map_err(|error| NativeError::Message(error.to_string()))?;
    let health_response = match client
        .get(health_url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
    {
        Ok(response) if response.status().is_success() => response,
        Ok(_) | Err(_) => return Ok(None),
    };
    let health: Value = match health_response.json() {
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
        .map_err(|error| NativeError::Message(error.to_string()))?;
    let turn_config = match client
        .get(turn_url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
    {
        Ok(response) if response.status().is_success() => response.json().ok(),
        _ => None,
    };

    Ok(Some(RelayProbeResult {
        origin,
        health,
        turn_config,
    }))
}

#[tauri::command]
fn set_window_icon<R: Runtime>(app: AppHandle<R>, profile: String) -> Result<(), NativeError> {
    let _profile = profile;
    let icon = Image::from_bytes(include_bytes!("../../assets/icon-app.png"))
        .map_err(|error| NativeError::Message(error.to_string()))?;
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_icon(icon)
            .map_err(|error| NativeError::Message(error.to_string()))?;
    }
    Ok(())
}

fn normalize_relay_origin(raw_origin: &str) -> Result<String, NativeError> {
    let trimmed = raw_origin.trim();
    if trimmed.is_empty() {
        return Err(NativeError::Message("relay origin is empty".into()));
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
    let parsed = url::Url::parse(&with_scheme)
        .map_err(|error| NativeError::Message(error.to_string()))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed.origin().ascii_serialization()),
        _ => Err(NativeError::Message("relay origin must use http or https".into())),
    }
}

#[cfg(target_os = "macos")]
fn macos_biometric_supported() -> bool {
    use objc2_local_authentication::{LAContext, LAPolicy};

    let context = unsafe { LAContext::new() };
    unsafe {
        context
            .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
            .is_ok()
    }
}

#[cfg(target_os = "macos")]
fn require_biometric_authentication() -> Result<(), NativeError> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::sync::mpsc;

    let context = unsafe { LAContext::new() };
    unsafe {
        context
            .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
            .map_err(|error| NativeError::Message(format!("Touch ID is not available: {error}")))?;
    }

    let reason = NSString::from_str("unlock P00RIJA Cryptography");
    let (sender, receiver) = mpsc::channel();
    let reply = RcBlock::new(move |success: Bool, _error: *mut NSError| {
        let _ = sender.send(success.as_bool());
    });

    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            &reason,
            &reply,
        );
    }

    match receiver.recv_timeout(Duration::from_secs(60)) {
        Ok(true) => Ok(()),
        Ok(false) => Err(NativeError::Message("Touch ID authentication failed or was cancelled".into())),
        Err(_) => Err(NativeError::Message("Touch ID authentication timed out".into())),
    }
}

#[cfg(target_os = "windows")]
fn require_biometric_authentication() -> Result<(), NativeError> {
    use robius_authentication::{
        AndroidText, BiometricStrength, Context, PolicyBuilder, Text, WindowsText,
    };

    let policy = PolicyBuilder::new()
        .biometrics(Some(BiometricStrength::Strong))
        .password(true)
        .build()
        .ok_or_else(|| NativeError::Message("Windows Hello policy is not available".into()))?;
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
        .map_err(|error| NativeError::Message(format!("Windows Hello authentication failed: {error:?}")))
}

#[cfg(target_os = "linux")]
fn linux_biometric_supported() -> bool {
    linux_command_exists("fprintd-verify") || linux_command_exists("pkexec")
}

#[cfg(target_os = "linux")]
fn require_biometric_authentication() -> Result<(), NativeError> {
    if linux_command_exists("fprintd-verify") {
        let user = std::env::var("USER").unwrap_or_default();
        let mut command = std::process::Command::new("fprintd-verify");
        if !user.is_empty() {
            command.arg(user);
        }
        match command.status() {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => {
                return Err(NativeError::Message(format!(
                    "fingerprint verification failed with status {status}"
                )))
            }
            Err(error) => {
                return Err(NativeError::Message(format!(
                    "fingerprint verification could not start: {error}"
                )))
            }
        }
    }

    if linux_command_exists("pkexec") {
        let status = std::process::Command::new("pkexec")
            .arg("/usr/bin/true")
            .status()
            .map_err(|error| NativeError::Message(format!("Polkit authentication failed to start: {error}")))?;
        if status.success() {
            return Ok(());
        }
        return Err(NativeError::Message(format!(
            "Polkit authentication failed with status {status}"
        )));
    }

    Err(NativeError::Message(
        "Linux biometric authentication requires fprintd or a Polkit/PAM agent".into(),
    ))
}

#[cfg(target_os = "linux")]
fn linux_command_exists(command: &str) -> bool {
    std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {command} >/dev/null 2>&1"))
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn require_biometric_authentication() -> Result<(), NativeError> {
    Ok(())
}

enum ShredPass {
    Random,
    Byte(u8),
}

fn validate_shred_target(path: &Path) -> Result<(), NativeError> {
    if path.as_os_str().is_empty() {
        return Err(NativeError::Message("empty path".into()));
    }
    if path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::CurDir
        )
    }) {
        return Err(NativeError::Message("relative path traversal is not allowed".into()));
    }
    Ok(())
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
                    .map_err(|error| NativeError::Message(error.to_string()))?;
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

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show P00RIJA Cryptography", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = app.default_window_icon().cloned();

    let mut builder = TrayIconBuilder::new()
        .tooltip("P00RIJA Cryptography")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
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

    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            desktop_auth_status,
            desktop_store_quick_unlock,
            desktop_unlock_with_biometric,
            desktop_clear_quick_unlock,
            desktop_probe_relay_origin,
            desktop_shred_file,
            set_window_icon
        ])
        .setup(|app| {
            create_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running P00RIJA Cryptography");
}
