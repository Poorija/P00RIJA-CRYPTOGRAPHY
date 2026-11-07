// P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
// Copyright (C) 2026 Poorija <p00rija@tutamail.com>
// https://github.com/Poorija/P00RIJA-Cryptography
//
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE for the full text. Section 13 matters here: run a modified
// version as a network service and its users are entitled to your source.

//! A newer release, downloaded by the app itself.
//!
//! The update offer used to hand the file's link to the system browser, which
//! downloads nothing when the browser cannot reach GitHub's file servers — on
//! a network where only the app's own proxy gets through, say. The shell
//! downloads it instead, through the same proxy as everything else it
//! fetches, into the Downloads folder, and checks it against the release's
//! SHA256SUMS before it calls it done. It installs nothing and runs nothing:
//! the person opens the file, as they would have from the browser.
//!
//! Which file is the page's to choose (js/update-check.js), from what this
//! module says the build is: how it was installed (the bundle Tauri marks
//! into the binary), whether the Mac binary is universal, and on Linux the
//! distribution.

use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::Path;

/// True for a universal Mac binary: a fat Mach-O, both architectures in one
/// file, rather than the thin one an Apple Silicon or Intel build is.
pub fn universal_binary() -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let Ok(exe) = std::env::current_exe() else { return false };
    let Ok(mut file) = std::fs::File::open(exe) else { return false };
    let mut magic = [0u8; 4];
    use std::io::Read;
    if file.read_exact(&mut magic).is_err() {
        return false;
    }
    matches!(magic, [0xca, 0xfe, 0xba, 0xbe] | [0xca, 0xfe, 0xba, 0xbf])
}

/// The Linux distribution's id (os-release ID), lowercased; empty elsewhere.
pub fn linux_distro() -> String {
    if !cfg!(target_os = "linux") {
        return String::new();
    }
    let text = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
    distro_from_os_release(&text)
}

pub fn distro_from_os_release(text: &str) -> String {
    text.lines()
        .find_map(|line| line.strip_prefix("ID="))
        .map(|value| value.trim().trim_matches('"').trim_matches('\'').to_lowercase())
        .filter(|value| value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'))
        .unwrap_or_default()
}

/// How this build was installed, as Tauri marked it into the binary.
pub fn bundle() -> Option<String> {
    tauri::utils::platform::bundle_type().map(|kind| format!("{kind:?}").to_lowercase())
}

/// The page names the link, and a page can be made to name anything: so only
/// a file of this project's own releases, nowhere else on GitHub.
const RELEASES: &str = "/poorija/p00rija-cryptography/releases/download/";

/// The release's tag and the file's name, for a link to a file of this
/// project's own releases; None for anything else.
pub fn release_file(url: &str) -> Option<(String, String)> {
    let parsed = url::Url::parse(url).ok()?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("github.com") || parsed.query().is_some() {
        return None;
    }
    let path = parsed.path();
    if !path.to_ascii_lowercase().starts_with(RELEASES) {
        return None;
    }
    let mut rest = path[RELEASES.len()..].split('/');
    let (tag, name) = (rest.next()?, rest.next()?);
    if rest.next().is_some() || tag.is_empty() || !tag.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) || !safe_file_name(name) {
        return None;
    }
    Some((tag.to_string(), name.to_string()))
}

/// Where a release file may be fetched from after GitHub's redirect.
pub fn allowed_redirect(url: &url::Url) -> bool {
    url.scheme() == "https"
        && matches!(url.host_str(), Some("github.com") | Some("objects.githubusercontent.com") | Some("release-assets.githubusercontent.com"))
}

/// A plain file name of an installer or package: it becomes a path in the
/// Downloads folder, and nothing else is ever fetched.
pub fn safe_file_name(name: &str) -> bool {
    const ENDINGS: [&str; 10] = [".dmg", ".exe", ".msi", ".deb", ".rpm", ".AppImage", ".apk", ".pkg.tar.zst", ".tar.gz", ".txt"];
    !name.is_empty()
        && name.len() <= 200
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && ENDINGS.iter().any(|ending| name.ends_with(ending))
}

/// A name in `dir` nothing has yet: name, then name-1, name-2, … before the
/// first dot-ending, so a file already there is never written over.
pub fn unused_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ending) = match name.find('.') {
        Some(at) => (&name[..at], &name[at..]),
        None => (name, ""),
    };
    (1..1000).map(|n| dir.join(format!("{stem}-{n}{ending}"))).find(|path| !path.exists()).unwrap_or(first)
}

/// The hash SHA256SUMS gives for a file ("hash  name" or "hash *name").
pub fn expected_hash(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let file = parts.next()?.trim_start_matches('*');
        (file == name && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit())).then(|| hash.to_lowercase())
    })
}

/// Downloads `url` into `to`, a piece at a time, telling `progress` how far
/// it is; answers the SHA-256 of what was written.
pub async fn download(
    client: &reqwest::Client,
    url: &str,
    to: &Path,
    progress: impl Fn(u64, Option<u64>),
) -> Result<String, String> {
    let mut response = client.get(url).send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("GitHub answered {}", response.status()));
    }
    let total = response.content_length();
    let mut file = std::fs::File::create(to).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut said: u64 = 0;
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        file.write_all(&chunk).map_err(|error| error.to_string())?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        if received - said >= 512 * 1024 || Some(received) == total {
            said = received;
            progress(received, total);
        }
    }
    file.flush().map_err(|error| error.to_string())?;
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_of_this_projects_releases_only() {
        assert_eq!(
            release_file("https://github.com/Poorija/P00RIJA-CRYPTOGRAPHY/releases/download/2.98.85/P00RIJA.Cryptography_2.98.85_aarch64.dmg"),
            Some(("2.98.85".to_string(), "P00RIJA.Cryptography_2.98.85_aarch64.dmg".to_string()))
        );
        assert!(release_file("https://github.com/someone/else/releases/download/1.0/x.dmg").is_none());
        assert!(release_file("http://github.com/Poorija/P00RIJA-Cryptography/releases/download/1.0/x.dmg").is_none());
        assert!(release_file("https://github.com.evil.example/Poorija/P00RIJA-Cryptography/releases/download/1.0/x.dmg").is_none());
        assert!(release_file("https://github.com/Poorija/P00RIJA-Cryptography/releases/download/1.0/x.sh").is_none());
        assert!(release_file("https://github.com/Poorija/P00RIJA-Cryptography/releases/download/1.0/a/x.dmg").is_none());
        assert!(allowed_redirect(&url::Url::parse("https://release-assets.githubusercontent.com/x").unwrap()));
        assert!(!allowed_redirect(&url::Url::parse("https://evil.example/x").unwrap()));
    }

    #[test]
    fn a_plain_installer_name_only() {
        assert!(safe_file_name("P00RIJA.Cryptography_2.98.85_aarch64.dmg"));
        assert!(!safe_file_name("../x.dmg"));
        assert!(!safe_file_name("a/b.dmg"));
        assert!(!safe_file_name(".hidden.dmg"));
        assert!(!safe_file_name("x.command"));
        assert!(!safe_file_name(""));
    }

    #[test]
    fn a_file_already_there_is_never_written_over() {
        let dir = std::env::temp_dir().join(format!("poorija-unused-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unused_path(&dir, "a.tar.gz"), dir.join("a.tar.gz"));
        std::fs::write(dir.join("a.tar.gz"), b"x").unwrap();
        assert_eq!(unused_path(&dir, "a.tar.gz"), dir.join("a-1.tar.gz"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_hash_sha256sums_gives() {
        let hash = "a".repeat(64);
        let sums = format!("{hash}  P00RIJA.Cryptography_2.98.85_aarch64.dmg\n{}  other.dmg\n", "b".repeat(64));
        assert_eq!(expected_hash(&sums, "P00RIJA.Cryptography_2.98.85_aarch64.dmg"), Some(hash.clone()));
        assert_eq!(expected_hash(&format!("{hash} *x.exe"), "x.exe"), Some(hash));
        assert_eq!(expected_hash(&sums, "missing.dmg"), None);
    }

    /* The download itself, from a stand-in server on this machine: every byte
       written, the hash of what was written, and progress told along the way. */
    #[test]
    fn a_download_is_written_whole_and_hashed() {
        use std::io::{Read, Write as _};
        let body: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect();
        let served = body.clone();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request);
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", served.len());
            let _ = stream.write_all(&served);
        });
        let dir = std::env::temp_dir().join(format!("poorija-update-test-{port}"));
        std::fs::create_dir_all(&dir).unwrap();
        let to = dir.join("file.part");
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let told = seen.clone();
        let client = reqwest::Client::new();
        let hash = tauri::async_runtime::block_on(download(&client, &format!("http://127.0.0.1:{port}/x"), &to, move |received, total| {
            told.lock().unwrap().push((received, total));
        }))
        .unwrap();
        let want: String = Sha256::digest(&body).iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(hash, want);
        assert_eq!(std::fs::read(&to).unwrap(), body);
        let progress = seen.lock().unwrap();
        assert!(progress.len() >= 2);
        assert_eq!(progress.last().copied(), Some((3_000_000, Some(3_000_000))));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_distribution_from_os_release() {
        assert_eq!(distro_from_os_release("NAME=\"Arch Linux\"\nID=arch\n"), "arch");
        assert_eq!(distro_from_os_release("ID=\"fedora\"\n"), "fedora");
        assert_eq!(distro_from_os_release("ID=a;b\n"), "");
    }
}
