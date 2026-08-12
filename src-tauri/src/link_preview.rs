use crate::error::{AppError, AppResult};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use image::io::Reader as ImageReader;
use scraper::{Html, Selector};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{self, Cursor, Read};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use url::{Host, Url};

const MAX_URL_LENGTH: usize = 4096;
const MAX_HTML_BYTES: u64 = 768 * 1024;
const MAX_IMAGE_BYTES: u64 = 1536 * 1024;
const MAX_FAVICON_BYTES: u64 = 192 * 1024;
const MAX_REDIRECTS: usize = 4;
const MAX_IMAGE_DIMENSION: u32 = 8192;
const MAX_IMAGE_PIXELS: u64 = 25_000_000;
const MAX_CONCURRENT_PREVIEWS: usize = 4;
const PREVIEW_DEADLINE: Duration = Duration::from_secs(10);

static ACTIVE_PREVIEWS: AtomicUsize = AtomicUsize::new(0);

const BLOCKED_HOSTNAMES: &[&str] = &["localhost", "localhost.localdomain"];
const BLOCKED_HOSTNAME_SUFFIXES: &[&str] = &[
    ".localhost",
    ".local",
    ".internal",
    ".lan",
    ".home",
    ".home.arpa",
    ".onion",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreviewMetadata {
    pub url: String,
    pub hostname: String,
    pub title: String,
    pub description: Option<String>,
    pub image_data_url: Option<String>,
    pub favicon_data_url: Option<String>,
}

#[derive(Debug, Default, PartialEq)]
struct PageMetadata {
    title: Option<String>,
    description: Option<String>,
    image_url: Option<String>,
    favicon_url: Option<String>,
}

#[derive(Debug)]
struct FetchedResource {
    final_url: Url,
    content_type: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Copy)]
struct PublicResolver;

struct PreviewRequestGuard;

impl PreviewRequestGuard {
    fn acquire() -> AppResult<Self> {
        ACTIVE_PREVIEWS
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                (active < MAX_CONCURRENT_PREVIEWS).then_some(active + 1)
            })
            .map_err(|_| AppError::msg("Too many link previews are already loading"))?;
        Ok(Self)
    }
}

impl Drop for PreviewRequestGuard {
    fn drop(&mut self) {
        ACTIVE_PREVIEWS.fetch_sub(1, Ordering::AcqRel);
    }
}

impl ureq::Resolver for PublicResolver {
    fn resolve(&self, netloc: &str) -> io::Result<Vec<SocketAddr>> {
        let addresses: Vec<SocketAddr> = netloc.to_socket_addrs()?.collect();
        if addresses.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "host did not resolve",
            ));
        }
        if addresses.iter().any(|address| !is_public_ip(address.ip())) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "link previews cannot access local or private network addresses",
            ));
        }
        Ok(addresses)
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _d] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 88 && c == 99)
        || (a == 192 && b == 168)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4() {
        return is_public_ipv4(mapped);
    }
    let first = ip.segments()[0];
    // Be deliberately conservative: public IPv6 unicast currently lives in
    // 2000::/3. This excludes loopback, link-local, ULA, multicast, and other
    // special-purpose ranges without relying on platform-specific classifiers.
    (first & 0xe000) == 0x2000 && ip.segments()[0..2] != [0x2001, 0x0db8]
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    }
}

fn validate_public_https_url(raw: &str) -> AppResult<Url> {
    if raw.is_empty()
        || raw.len() > MAX_URL_LENGTH
        || raw.trim() != raw
        || raw.chars().any(|ch| ch.is_control())
    {
        return Err(AppError::msg("Invalid preview URL"));
    }

    let mut url = Url::parse(raw).map_err(|_| AppError::msg("Invalid preview URL"))?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(AppError::msg(
            "Link previews require a public HTTPS URL without credentials or a custom port",
        ));
    }

    let hostname = match url.host() {
        Some(Host::Domain(hostname)) => hostname.trim_end_matches('.').to_ascii_lowercase(),
        _ => return Err(AppError::msg("Link previews require a public hostname")),
    };
    if !hostname.contains('.')
        || BLOCKED_HOSTNAMES.contains(&hostname.as_str())
        || BLOCKED_HOSTNAME_SUFFIXES
            .iter()
            .any(|suffix| hostname.ends_with(suffix))
    {
        return Err(AppError::msg(
            "Link previews cannot access local or private hosts",
        ));
    }

    url.set_fragment(None);
    Ok(url)
}

fn preview_agent() -> ureq::Agent {
    ureq::builder()
        .redirects(0)
        .try_proxy_from_env(false)
        .resolver(PublicResolver)
        .timeout_connect(Duration::from_secs(4))
        .timeout_read(Duration::from_secs(6))
        .timeout_write(Duration::from_secs(4))
        .max_idle_connections(0)
        .user_agent("Mozilla/5.0 (compatible; ChikkuParserLinkPreview/1.0)")
        .build()
}

fn response_from_call(result: Result<ureq::Response, ureq::Error>) -> AppResult<ureq::Response> {
    match result {
        Ok(response) => Ok(response),
        Err(ureq::Error::Status(_, response)) => Ok(response),
        Err(error) => Err(AppError::msg(format!("Preview request failed: {error}"))),
    }
}

fn fetch_resource(
    agent: &ureq::Agent,
    initial_url: Url,
    max_bytes: u64,
    accept: &str,
    deadline: Instant,
    allow_truncated: bool,
) -> AppResult<FetchedResource> {
    let mut current = initial_url;
    for redirect_count in 0..=MAX_REDIRECTS {
        current = validate_public_https_url(current.as_str())?;
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .filter(|duration| !duration.is_zero())
            .ok_or_else(|| AppError::msg("Preview request timed out"))?;
        let response = response_from_call(
            agent
                .get(current.as_str())
                .timeout(remaining)
                .set("Accept", accept)
                .set("Accept-Language", "en-US,en;q=0.8")
                .call(),
        )?;
        let status = response.status();

        if (300..400).contains(&status) {
            if redirect_count == MAX_REDIRECTS {
                return Err(AppError::msg("Preview request redirected too many times"));
            }
            let location = response
                .header("Location")
                .ok_or_else(|| AppError::msg("Preview redirect did not include a destination"))?;
            current = current
                .join(location)
                .map_err(|_| AppError::msg("Preview redirect URL was invalid"))?;
            continue;
        }
        if !(200..300).contains(&status) {
            return Err(AppError::msg(format!(
                "Preview request returned HTTP {status}"
            )));
        }

        if response
            .header("Content-Length")
            .and_then(|value| value.parse::<u64>().ok())
            .is_some_and(|length| length > max_bytes)
            && !allow_truncated
        {
            return Err(AppError::msg("Preview response was too large"));
        }

        let content_type = response
            .header("Content-Type")
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(max_bytes + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > max_bytes {
            if allow_truncated {
                bytes.truncate(max_bytes as usize);
            } else {
                return Err(AppError::msg("Preview response was too large"));
            }
        }
        return Ok(FetchedResource {
            final_url: current,
            content_type,
            bytes,
        });
    }
    Err(AppError::msg("Preview request redirected too many times"))
}

fn clean_text(value: &str, max_chars: usize) -> Option<String> {
    let cleaned = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        return None;
    }
    Some(cleaned.chars().take(max_chars).collect())
}

fn parse_page_metadata(html: &str) -> PageMetadata {
    let document = Html::parse_document(html);
    let meta_selector = Selector::parse("meta").expect("static meta selector");
    let title_selector = Selector::parse("title").expect("static title selector");
    let icon_selector = Selector::parse("link[rel]").expect("static icon selector");
    let mut values: HashMap<String, String> = HashMap::new();

    for element in document.select(&meta_selector) {
        let attrs = element.value();
        let key = attrs
            .attr("property")
            .or_else(|| attrs.attr("name"))
            .or_else(|| attrs.attr("itemprop"))
            .map(str::trim)
            .map(str::to_ascii_lowercase);
        let content = attrs
            .attr("content")
            .and_then(|value| clean_text(value, 2048));
        if let (Some(key), Some(content)) = (key, content) {
            values.entry(key).or_insert(content);
        }
    }

    let first_value = |keys: &[&str], max_chars: usize| {
        keys.iter()
            .find_map(|key| values.get(*key))
            .and_then(|value| clean_text(value, max_chars))
    };
    let document_title = document
        .select(&title_selector)
        .next()
        .and_then(|element| clean_text(&element.text().collect::<String>(), 220));
    let favicon_url = document.select(&icon_selector).find_map(|element| {
        let attrs = element.value();
        let is_icon = attrs
            .attr("rel")
            .map(|rel| {
                rel.split_whitespace()
                    .any(|token| token.eq_ignore_ascii_case("icon"))
            })
            .unwrap_or(false);
        is_icon
            .then(|| attrs.attr("href"))
            .flatten()
            .map(str::to_string)
    });

    PageMetadata {
        title: first_value(&["og:title", "twitter:title"], 220).or(document_title),
        description: first_value(
            &["og:description", "twitter:description", "description"],
            420,
        ),
        image_url: first_value(
            &[
                "og:image:secure_url",
                "og:image",
                "twitter:image:src",
                "twitter:image",
            ],
            MAX_URL_LENGTH,
        ),
        favicon_url,
    }
}

fn is_supported_image_type(content_type: &str) -> bool {
    matches!(
        content_type,
        "image/gif"
            | "image/jpeg"
            | "image/jpg"
            | "image/png"
            | "image/webp"
            | "image/x-icon"
            | "image/vnd.microsoft.icon"
    )
}

fn resolve_public_asset_url(page_url: &Url, candidate: &str) -> AppResult<Url> {
    let mut url = page_url
        .join(candidate)
        .map_err(|_| AppError::msg("Preview asset URL was invalid"))?;
    // Some otherwise-HTTPS pages publish legacy http:// Open Graph asset URLs.
    // Upgrade those in place; previews never make a plaintext HTTP request.
    if url.scheme() == "http" {
        url.set_scheme("https")
            .map_err(|_| AppError::msg("Preview asset URL was invalid"))?;
    }
    validate_public_https_url(url.as_str())
}

fn fetch_image_data_url(
    agent: &ureq::Agent,
    page_url: &Url,
    candidate: &str,
    max_bytes: u64,
    max_pixels: u64,
    deadline: Instant,
) -> Option<String> {
    let url = resolve_public_asset_url(page_url, candidate).ok()?;
    let resource = fetch_resource(agent, url, max_bytes, "image/*", deadline, false).ok()?;
    if !is_supported_image_type(&resource.content_type) {
        return None;
    }

    let reader = ImageReader::new(Cursor::new(&resource.bytes))
        .with_guessed_format()
        .ok()?;
    let (width, height) = reader.into_dimensions().ok()?;
    if width == 0
        || height == 0
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || u64::from(width) * u64::from(height) > max_pixels
    {
        return None;
    }

    Some(format!(
        "data:{};base64,{}",
        resource.content_type,
        BASE64_STANDARD.encode(resource.bytes)
    ))
}

fn fetch_link_preview_inner(raw_url: &str) -> AppResult<LinkPreviewMetadata> {
    let _request_guard = PreviewRequestGuard::acquire()?;
    let deadline = Instant::now() + PREVIEW_DEADLINE;
    let url = validate_public_https_url(raw_url)?;
    let agent = preview_agent();
    let page = fetch_resource(
        &agent,
        url,
        MAX_HTML_BYTES,
        "text/html,application/xhtml+xml;q=0.9",
        deadline,
        true,
    )?;
    if page.content_type != "text/html" && page.content_type != "application/xhtml+xml" {
        return Err(AppError::msg("This URL did not return an HTML page"));
    }
    let html = String::from_utf8_lossy(&page.bytes);
    let metadata = parse_page_metadata(&html);
    let hostname = page
        .final_url
        .host_str()
        .unwrap_or_default()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    let title = metadata.title.unwrap_or_else(|| hostname.clone());
    let image_data_url = metadata.image_url.as_deref().and_then(|candidate| {
        fetch_image_data_url(
            &agent,
            &page.final_url,
            candidate,
            MAX_IMAGE_BYTES,
            MAX_IMAGE_PIXELS,
            deadline,
        )
    });
    let favicon_candidate = metadata.favicon_url.as_deref().unwrap_or("/favicon.ico");
    let favicon_data_url = fetch_image_data_url(
        &agent,
        &page.final_url,
        favicon_candidate,
        MAX_FAVICON_BYTES,
        1_048_576,
        deadline,
    );

    Ok(LinkPreviewMetadata {
        url: page.final_url.to_string(),
        hostname,
        title,
        description: metadata.description,
        image_data_url,
        favicon_data_url,
    })
}

#[tauri::command]
pub async fn fetch_link_preview(url: String) -> AppResult<LinkPreviewMetadata> {
    tauri::async_runtime::spawn_blocking(move || fetch_link_preview_inner(&url))
        .await
        .map_err(|_| AppError::msg("Preview worker stopped unexpectedly"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_only_public_https_hostnames() {
        assert!(validate_public_https_url("https://example.com/path?q=1#section").is_ok());
        for value in [
            "http://example.com",
            "https://localhost/admin",
            "https://service.internal/admin",
            "https://127.0.0.1/admin",
            "https://user:secret@example.com/admin",
            "https://example.com:444/admin",
        ] {
            assert!(validate_public_https_url(value).is_err(), "{value}");
        }
    }

    #[test]
    fn rejects_special_use_ip_ranges() {
        for value in [
            "0.0.0.0",
            "10.1.2.3",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.169.254",
            "172.31.255.255",
            "192.168.1.1",
            "198.51.100.9",
            "203.0.113.10",
            "224.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
        ] {
            assert!(!is_public_ip(value.parse().unwrap()), "{value}");
        }
        for value in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(is_public_ip(value.parse().unwrap()), "{value}");
        }
    }

    #[test]
    fn extracts_rich_link_metadata_without_page_content() {
        let metadata = parse_page_metadata(
            r#"<!doctype html><html><head>
                <title>Fallback title</title>
                <meta property="og:title" content="  Product &amp; bundle  ">
                <meta name="description" content="A useful product for testing previews.">
                <meta property="og:image" content="/images/product.jpg">
                <link rel="shortcut icon" href="/favicon.ico">
              </head><body><script>alert('not included')</script></body></html>"#,
        );
        assert_eq!(metadata.title.as_deref(), Some("Product & bundle"));
        assert_eq!(
            metadata.description.as_deref(),
            Some("A useful product for testing previews.")
        );
        assert_eq!(metadata.image_url.as_deref(), Some("/images/product.jpg"));
        assert_eq!(metadata.favicon_url.as_deref(), Some("/favicon.ico"));
    }

    #[test]
    fn upgrades_legacy_asset_urls_without_allowing_plaintext_fetches() {
        let page = Url::parse("https://shop.example.com/products/1").unwrap();
        assert_eq!(
            resolve_public_asset_url(&page, "http://cdn.example.com/image.jpg")
                .unwrap()
                .as_str(),
            "https://cdn.example.com/image.jpg"
        );
        assert!(resolve_public_asset_url(&page, "http://localhost/image.jpg").is_err());
        assert!(resolve_public_asset_url(&page, "data:image/png;base64,AAAA").is_err());
    }
}
