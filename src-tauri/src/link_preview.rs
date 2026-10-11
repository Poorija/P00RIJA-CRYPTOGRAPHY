// P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
// Copyright (C) 2026 Poorija <p00rija@tutamail.com>
// https://github.com/Poorija/P00RIJA-Cryptography
//
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE for the full text. Section 13 matters here: run a modified
// version as a network service and its users are entitled to your source.

//! A link preview, fetched by the sender's own device.
//!
//! The person who pastes a link is the one who asked for it, so their device
//! fetches the page — never the recipient's, who only receives the title,
//! the description and a small picture inside the encrypted message and
//! never contacts the site at all. Off unless the person turns it on.
//!
//! What the fetch refuses, because a pasted link is still text from wherever
//! it was copied:
//!
//! * anything but http and https;
//! * a host that resolves to this machine, the local network or any other
//!   non-public address — and the address that was checked is the one
//!   connected to, so a name cannot resolve once to a public address and
//!   again to a private one;
//! * more than three redirects, each checked like the first;
//! * more than 512 KB of page or 1 MB of picture, and anything slower than
//!   eight seconds.
//!
//! It goes through the app's proxy when one is set, like everything else the
//! shell sends.

use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

use serde::Serialize;

const MAX_PAGE_BYTES: usize = 512 * 1024;
const MAX_IMAGE_BYTES: usize = 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const FETCH_TIMEOUT: Duration = Duration::from_secs(8);
/* An ordinary browser's, so a preview fetch does not announce which app sent it. */
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub url: String,
    pub title: String,
    pub description: String,
    pub site_name: String,
    pub image_data: String,
    pub image_mime: String,
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.is_documentation()
                || a == 0
                || (a == 100 && (64..=127).contains(&b)) // carrier-grade NAT
                || (a == 198 && (b == 18 || b == 19)) // benchmarking
                || (a == 192 && b == 0 && v4.octets()[2] == 0) // IETF protocol assignments
                || (a == 192 && b == 88 && v4.octets()[2] == 99) // 6to4 relay anycast
                || a >= 224) // multicast and reserved
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(mapped));
            }
            let segments = v6.segments();
            let first = segments[0];
            /* Prefixes that carry an IPv4 address inside them: whatever they
               carry is judged as that address. 6to4 holds it in bits 16-47;
               NAT64 (64:ff9b::/96) and the deprecated IPv4-compatible form
               hold it in the last 32 bits. */
            let tail_v4 = std::net::Ipv4Addr::new(
                (segments[6] >> 8) as u8, segments[6] as u8, (segments[7] >> 8) as u8, segments[7] as u8);
            if first == 0x2002 {
                let embedded = std::net::Ipv4Addr::new(
                    (segments[1] >> 8) as u8, segments[1] as u8, (segments[2] >> 8) as u8, segments[2] as u8);
                return is_public_ip(IpAddr::V4(embedded));
            }
            if (first == 0x0064 && segments[1] == 0xff9b) || segments[..6].iter().all(|segment| *segment == 0) {
                return is_public_ip(IpAddr::V4(tail_v4));
            }
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (first & 0xfe00) == 0xfc00 // unique local
                || (first & 0xffc0) == 0xfe80 // link local
                || (first & 0xffc0) == 0xfec0 // site local (deprecated)
                || (first == 0x0100 && segments[1..4].iter().all(|segment| *segment == 0)) // discard
                || (first == 0x2001 && segments[1] == 0x0000) // Teredo
                || (first == 0x2001 && segments[1] == 0x0db8)) // documentation
        }
    }
}

/// The first public address the URL's host resolves to, or an error when it
/// resolves only to addresses this fetch will not touch.
async fn public_address(url: &url::Url) -> Result<SocketAddr, String> {
    let host = url.host_str().ok_or("the link has no host")?.to_string();
    let port = url.port_or_known_default().ok_or("the link has no port")?;
    let lookup = tauri::async_runtime::spawn_blocking(move || {
        (host.as_str(), port)
            .to_socket_addrs()
            .map(|addresses| addresses.collect::<Vec<_>>())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| format!("the host could not be resolved: {error}"))?;
    lookup
        .into_iter()
        .find(|address| is_public_ip(address.ip()))
        .ok_or_else(|| "the link points at a private or local address".to_string())
}

fn refuse_local_name(url: &url::Url) -> Result<(), String> {
    match url.host() {
        Some(url::Host::Ipv4(ip)) if !is_public_ip(IpAddr::V4(ip)) => Err("the link points at a private or local address".into()),
        Some(url::Host::Ipv6(ip)) if !is_public_ip(IpAddr::V6(ip)) => Err("the link points at a private or local address".into()),
        Some(url::Host::Domain(name)) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            let local = name == "localhost"
                || [".localhost", ".local", ".internal", ".lan", ".home.arpa"].iter().any(|suffix| name.ends_with(suffix))
                || !name.contains('.');
            if local { Err("the link points at a local name".into()) } else { Ok(()) }
        }
        _ => Ok(()),
    }
}

fn checked_link(raw: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw.trim()).map_err(|error| error.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http and https links get a preview".into());
    }
    if parsed.host_str().unwrap_or_default().is_empty() {
        return Err("the link has no host".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("a link carrying a password gets no preview".into());
    }
    /* Web ports only: a preview is a web page, and a fetch to any other port
       is a request to some other kind of service. */
    if !matches!(parsed.port_or_known_default(), Some(80 | 443 | 8080 | 8443)) {
        return Err("only links on web ports get a preview".into());
    }
    Ok(parsed)
}

fn client_for(url: &url::Url, address: Option<SocketAddr>, proxy: Option<&url::Url>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT);
    if let Some(proxy) = proxy {
        let target = crate::reqwest_proxy_target(proxy);
        builder = builder.proxy(reqwest::Proxy::all(target).map_err(|error| error.to_string())?);
    } else if let (Some(address), Some(host)) = (address, url.host_str()) {
        /* Connect to exactly the address that was checked. */
        builder = builder.resolve(host, address);
    }
    builder.build().map_err(|error| error.to_string())
}

/// GET with the checks above on every hop. Returns the final URL, the
/// content type and at most `limit` bytes of body.
async fn fetch_checked(
    start: url::Url,
    limit: usize,
    proxy: Option<&url::Url>,
) -> Result<(url::Url, String, Vec<u8>), String> {
    let mut current = start;
    for _ in 0..=MAX_REDIRECTS {
        /* Behind a proxy the name is resolved there (no DNS leaves this
           machine), so what can be checked here is the name itself: a
           literal private address or a local name is refused either way. */
        let address = if proxy.is_some() {
            refuse_local_name(&current)?;
            None
        } else {
            Some(public_address(&current).await?)
        };
        let client = client_for(&current, address, proxy)?;
        let mut response = client
            .get(current.clone())
            .header(reqwest::header::ACCEPT, "text/html,image/*;q=0.9,*/*;q=0.5")
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or("a redirect without a destination")?;
            current = checked_link(current.join(location).map_err(|error| error.to_string())?.as_str())?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("the site answered {}", response.status()));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
            let room = limit.saturating_sub(body.len());
            body.extend_from_slice(&chunk[..chunk.len().min(room)]);
            if body.len() >= limit {
                break;
            }
        }
        return Ok((current, content_type, body));
    }
    Err("too many redirects".into())
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        if let Some(end) = tail.find(';').filter(|end| *end <= 10) {
            let entity = &tail[1..end];
            let decoded = match entity {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" | "#39" => Some('\''),
                "nbsp" => Some(' '),
                _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                    u32::from_str_radix(&entity[2..], 16).ok().and_then(char::from_u32)
                }
                _ if entity.starts_with('#') => entity[1..].parse::<u32>().ok().and_then(char::from_u32),
                _ => None,
            };
            if let Some(character) = decoded {
                out.push(character);
                rest = &tail[end + 1..];
                continue;
            }
        }
        out.push('&');
        rest = &tail[1..];
    }
    out.push_str(rest);
    out
}

fn clean_text(text: &str, max_chars: usize) -> String {
    let decoded = decode_entities(text);
    let collapsed = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().filter(|c| !c.is_control()).take(max_chars).collect()
}

/// The value of `attribute` in one tag's text, quoted either way.
fn attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut search = 0;
    while let Some(found) = lower[search..].find(name) {
        let at = search + found;
        search = at + name.len();
        let before = lower[..at].chars().last();
        if before.is_some_and(|c| c.is_ascii_alphanumeric() || c == '-' || c == ':') {
            continue;
        }
        let after = lower[search..].trim_start();
        if !after.starts_with('=') {
            continue;
        }
        let value_start = tag.len() - after.len() + 1;
        let value = tag[value_start..].trim_start();
        let quote = value.chars().next()?;
        if quote == '"' || quote == '\'' {
            let inner = &value[1..];
            return inner.find(quote).map(|end| inner[..end].to_string());
        }
        return Some(value.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or_default().to_string());
    }
    None
}

/// The meta tags and the title a page offers about itself.
fn read_page(html: &str) -> (String, String, String, String) {
    let mut title = String::new();
    let mut description = String::new();
    let mut site = String::new();
    let mut image = String::new();
    let lower = html.to_ascii_lowercase();
    let mut search = 0;
    while let Some(found) = lower[search..].find("<meta") {
        let at = search + found;
        let end = lower[at..].find('>').map(|end| at + end).unwrap_or(lower.len());
        let tag = &html[at..end];
        search = end;
        let key = attribute(tag, "property").or_else(|| attribute(tag, "name")).unwrap_or_default().to_ascii_lowercase();
        let Some(content) = attribute(tag, "content") else { continue };
        match key.as_str() {
            "og:title" => title = content,
            "twitter:title" if title.is_empty() => title = content,
            "og:description" => description = content,
            "twitter:description" | "description" if description.is_empty() => description = content,
            "og:site_name" => site = content,
            "og:image" | "og:image:url" | "og:image:secure_url" if image.is_empty() => image = content,
            "twitter:image" | "twitter:image:src" if image.is_empty() => image = content,
            _ => {}
        }
    }
    if title.is_empty() {
        if let Some(start) = lower.find("<title") {
            if let Some(open_end) = lower[start..].find('>') {
                let text_start = start + open_end + 1;
                if let Some(close) = lower[text_start..].find("</title") {
                    title = html[text_start..text_start + close].to_string();
                }
            }
        }
    }
    (title, description, site, image)
}

fn image_mime(content_type: &str) -> Option<&'static str> {
    let essence = content_type.split(';').next().unwrap_or_default().trim();
    match essence {
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/webp" => Some("image/webp"),
        "image/gif" => Some("image/gif"),
        _ => None,
    }
}

pub async fn preview(raw: &str, proxy: Option<url::Url>, encode: fn(&[u8]) -> String) -> Result<Option<LinkPreview>, String> {
    /* Behind a proxy a name is resolved at the proxy, and this end cannot see
       what it resolves to without asking a DNS server outside the proxy —
       which is the very leak the proxy exists to prevent. A name that turns
       out to point into the local network could then be fetched through a
       proxy that sends private addresses direct, and its page title would
       ride out in the message. So behind a proxy there are no previews. */
    if proxy.is_some() {
        return Err("link previews are off while a proxy is set".into());
    }
    let start = checked_link(raw)?;
    let start_host = start.host_str().map(str::to_string);
    let (final_url, content_type, body) = fetch_checked(start, MAX_PAGE_BYTES, proxy.as_ref()).await?;
    if !content_type.contains("text/html") && !content_type.contains("application/xhtml") {
        return Ok(None);
    }
    let html = String::from_utf8_lossy(&body);
    let (title, description, site, image) = read_page(&html);
    /* A link that redirects to another site gets no preview: the card would
       show one site under a link to another. */
    if final_url.host_str() != start_host.as_deref() {
        return Ok(None);
    }
    let mut result = LinkPreview {
        url: final_url.to_string(),
        title: clean_text(&title, 200),
        description: clean_text(&description, 300),
        site_name: clean_text(&site, 80),
        ..Default::default()
    };
    if result.title.is_empty() && result.description.is_empty() {
        return Ok(None);
    }
    if !image.is_empty() {
        if let Ok(image_url) = final_url.join(decode_entities(image.trim()).as_str()).map_err(|error| error.to_string()).and_then(|url| checked_link(url.as_str())) {
            if let Ok((_, image_type, bytes)) = fetch_checked(image_url, MAX_IMAGE_BYTES + 1, proxy.as_ref()).await {
                if let Some(mime) = image_mime(&image_type) {
                    if !bytes.is_empty() && bytes.len() <= MAX_IMAGE_BYTES {
                        result.image_data = encode(&bytes);
                        result.image_mime = mime.to_string();
                    }
                }
            }
        }
    }
    Ok(Some(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_and_local_addresses_are_refused() {
        for address in ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.5", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:192.168.1.1",
            "2002:c0a8:0101::1", "64:ff9b::10.0.0.1", "::192.168.1.1", "fec0::1", "2001::1", "100::1"] {
            assert!(!is_public_ip(address.parse().unwrap()), "{address} should be refused");
        }
        for address in ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"] {
            assert!(is_public_ip(address.parse().unwrap()), "{address} should be allowed");
        }
    }

    #[test]
    fn local_names_are_refused_even_behind_a_proxy() {
        for link in ["http://localhost:8080/", "http://printer.local/", "http://router/", "http://10.0.0.1/", "http://[::1]/", "http://intranet.internal/"] {
            assert!(refuse_local_name(&url::Url::parse(link).unwrap()).is_err(), "{link} should be refused");
        }
        assert!(refuse_local_name(&url::Url::parse("https://example.com/").unwrap()).is_ok());
    }

    #[test]
    fn only_plain_web_links_qualify() {
        assert!(checked_link("https://example.com/a").is_ok());
        assert!(checked_link("file:///etc/passwd").is_err());
        assert!(checked_link("javascript:alert(1)").is_err());
        assert!(checked_link("https://user:pass@example.com").is_err());
        assert!(checked_link("http://example.com:25/").is_err());
        assert!(checked_link("https://example.com:8443/x").is_ok());
    }

    #[test]
    fn meta_tags_are_read_and_entities_decoded() {
        let html = r#"<html><head><title>Fallback</title>
            <meta property="og:title" content="Caf&eacute; &amp; More">
            <meta name='description' content='A &quot;quoted&quot; line'>
            <meta property="og:image" content="/img/card.png">
            <meta property="og:site_name" content="Example"></head></html>"#;
        let (title, description, site, image) = read_page(html);
        assert_eq!(clean_text(&title, 200), "Caf&eacute; & More");
        assert_eq!(clean_text(&description, 300), "A \"quoted\" line");
        assert_eq!(site, "Example");
        assert_eq!(image, "/img/card.png");
        let (fallback, ..) = read_page("<title>  Just\n a   title </title>");
        assert_eq!(clean_text(&fallback, 200), "Just a title");
    }
}
