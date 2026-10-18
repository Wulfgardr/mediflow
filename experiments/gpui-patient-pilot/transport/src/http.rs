use crate::{
    Result, RuntimeError, RuntimeSession, RuntimeUser, crypto, tls, validate_id,
    validate_pairing_id, validate_scope_id,
};
use reqwest::{
    Method, Url,
    blocking::Client,
    header::{COOKIE, HeaderMap, HeaderValue, SET_COOKIE},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{io::Read, net::IpAddr, time::Duration};
use zeroize::Zeroizing;

pub(crate) const JSON_LIMIT: usize = 8 * 1024 * 1024;
pub(crate) const DOCUMENT_LIMIT: usize = 24 * 1024 * 1024;
const AUTH_LIMIT: usize = 64 * 1024;

#[derive(Clone)]
pub struct RuntimeConfig {
    /// HTTPS origin, or an explicitly entered literal loopback HTTP origin.
    pub base_url: String,
    /// SHA-256 of the exact home-base certificate DER, supplied out of band.
    pub tls_pin_sha256: Option<String>,
}

/// Pairing is a device credential. It cannot provide an operator session by itself.
pub struct PairingCredentials {
    pub(crate) id: String,
    pub(crate) token: Zeroizing<String>,
}
impl PairingCredentials {
    pub fn new(id: impl Into<String>, token: impl Into<String>) -> Result<Self> {
        let id = id.into();
        let token = Zeroizing::new(token.into());
        validate_pairing_id(&id)?;
        if !(32..=512).contains(&token.len())
            || !token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'=' | b'+' | b'/'))
        {
            return Err(RuntimeError::InvalidInput);
        }
        Ok(Self { id, token })
    }
}

#[derive(Clone)]
pub struct RuntimeClient {
    http: Client,
    origin: Url,
    base_url: String,
}

pub(crate) struct RawResponse {
    pub headers: HeaderMap,
    pub body: Zeroizing<Vec<u8>>,
}

impl RuntimeClient {
    pub fn new(config: RuntimeConfig) -> Result<Self> {
        let origin = validate_origin(&config.base_url)?;
        if origin.scheme() != "https" && config.tls_pin_sha256.is_some() {
            return Err(RuntimeError::InvalidInput);
        }
        let mut builder = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .retry(reqwest::retry::never())
            .user_agent(concat!("MediFlow-Rust/", env!("CARGO_PKG_VERSION")));
        if let Some(pin) = config.tls_pin_sha256 {
            builder = builder.use_preconfigured_tls(tls::config(&pin)?);
        }
        let http = builder.build().map_err(|_| RuntimeError::Transport)?;
        Ok(Self {
            base_url: origin.as_str().trim_end_matches('/').to_owned(),
            origin,
            http,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Unlocks v3 locally. Only the domain-separated verifier crosses the wire.
    pub fn login(
        &self,
        pairing: PairingCredentials,
        username: &str,
        passphrase: &str,
    ) -> Result<RuntimeSession> {
        let username = username.trim();
        if username.is_empty() || username.len() > 256 {
            return Err(RuntimeError::InvalidInput);
        }
        let check = self.raw(
            Method::GET,
            &["api", "auth", "check"],
            &[],
            None,
            &pairing,
            None,
            None,
            false,
            AUTH_LIMIT,
        )?;
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Check {
            status: String,
            is_setup: bool,
            archive_generation: Option<String>,
            unlock: Option<Unlock>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Unlock {
            credential: String,
            kdf_version: Option<u64>,
            salt: Option<String>,
        }
        let check: Check =
            serde_json::from_slice(&check.body).map_err(|_| RuntimeError::InvalidResponse)?;
        if check.status != "ok" || !check.is_setup {
            return Err(RuntimeError::Authentication);
        }
        let generation = check
            .archive_generation
            .filter(|v| !v.is_empty() && v.len() <= 256)
            .ok_or(RuntimeError::InvalidResponse)?;
        let unlock = check.unlock.ok_or(RuntimeError::UnsupportedUnlock)?;
        if unlock.credential != "passphrase" || unlock.kdf_version != Some(3) {
            return Err(RuntimeError::UnsupportedUnlock);
        }
        let salt = unlock.salt.ok_or(RuntimeError::InvalidResponse)?;
        let material = crypto::derive_v3(passphrase, &salt)?;
        #[derive(Serialize)]
        struct Login<'a> {
            username: &'a str,
            verifier: &'a str,
        }
        let body = Zeroizing::new(
            serde_json::to_vec(&Login {
                username,
                verifier: &material.verifier,
            })
            .map_err(|_| RuntimeError::InvalidInput)?,
        );
        let response = self.raw(
            Method::POST,
            &["api", "auth", "native", "login"],
            &[],
            None,
            &pairing,
            None,
            Some(&body),
            false,
            AUTH_LIMIT,
        )?;
        let cookie = session_cookie(&response.headers)?;
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct LoginResponse {
            success: bool,
            #[serde(flatten)]
            user: RuntimeUser,
            salt: String,
            encrypted_master_key: String,
        }
        let admitted = (|| {
            let login: LoginResponse = serde_json::from_slice(&response.body)
                .map_err(|_| RuntimeError::InvalidResponse)?;
            if !login.success
                || login.user.archive_generation != generation
                || login.salt != salt
                || login.user.username != username
            {
                return Err(RuntimeError::InvalidResponse);
            }
            validate_id(&login.user.id).map_err(|_| RuntimeError::InvalidResponse)?;
            let master = crypto::unwrap_v3(&login.encrypted_master_key, &material.kek)?;
            Ok((login.user, master))
        })();
        match admitted {
            Ok((user, master)) => {
                let session = RuntimeSession::new(self.clone(), user, pairing, cookie, master);
                if let Err(error) = session.refresh_capabilities() {
                    let _ = session.logout();
                    return Err(error);
                }
                Ok(session)
            }
            Err(error) => {
                // A minted owner must be retired if its archive/key cannot be accepted.
                let _ = self.raw(
                    Method::POST,
                    &["api", "auth", "native", "logout"],
                    &[],
                    None,
                    &pairing,
                    Some(&cookie),
                    None,
                    false,
                    AUTH_LIMIT,
                );
                Err(error)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn json(
        &self,
        method: Method,
        path: &[&str],
        query: &[(&str, &str)],
        scope: Option<&str>,
        pairing: &PairingCredentials,
        cookie: &str,
        body: Option<&Value>,
        mutation: bool,
        limit: usize,
    ) -> Result<Value> {
        let encoded = body
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|_| RuntimeError::InvalidInput)?
            .map(Zeroizing::new);
        if encoded.as_ref().is_some_and(|v| v.len() > limit) {
            return Err(RuntimeError::TooLarge);
        }
        let response = self.raw(
            method,
            path,
            query,
            scope,
            pairing,
            Some(cookie),
            encoded.as_deref().map(Vec::as_slice),
            mutation,
            limit,
        )?;
        if response.body.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&response.body).map_err(|_| {
            if mutation {
                RuntimeError::Indeterminate
            } else {
                RuntimeError::InvalidResponse
            }
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn raw(
        &self,
        method: Method,
        path: &[&str],
        query: &[(&str, &str)],
        scope: Option<&str>,
        pairing: &PairingCredentials,
        cookie: Option<&str>,
        body: Option<&[u8]>,
        mutation: bool,
        limit: usize,
    ) -> Result<RawResponse> {
        let url = self.endpoint(path, query)?;
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-mediflow-paired-client-id",
            sensitive_header(&pairing.id)?,
        );
        headers.insert(
            "x-mediflow-paired-client-token",
            sensitive_header(&pairing.token)?,
        );
        headers.insert(
            "x-mediflow-source-surface",
            HeaderValue::from_static("native"),
        );
        headers.insert("cache-control", HeaderValue::from_static("no-store"));
        headers.insert("accept", HeaderValue::from_static("application/json"));
        if let Some(scope) = scope {
            validate_scope_id(scope)?;
            headers.insert(
                "x-mediflow-expected-ambulatory-id",
                sensitive_header(&encode_cookie_value(scope))?,
            );
        }
        if let Some(cookie) = cookie {
            let cookie = cookie_header(cookie, scope)?;
            headers.insert(COOKIE, sensitive_header(&cookie)?);
        }
        let mut request = self.http.request(method, url).headers(headers);
        if let Some(body) = body {
            request = request
                .header("content-type", "application/json")
                .body(body.to_owned());
        }
        let response = request.send().map_err(|_| uncertain(mutation))?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(classify_status(status, mutation));
        }
        if response
            .content_length()
            .is_some_and(|size| size > limit as u64)
        {
            return Err(if mutation {
                RuntimeError::Indeterminate
            } else {
                RuntimeError::TooLarge
            });
        }
        let headers = response.headers().clone();
        let mut body = Zeroizing::new(Vec::new());
        response
            .take(limit as u64 + 1)
            .read_to_end(&mut body)
            .map_err(|_| uncertain(mutation))?;
        if body.len() > limit {
            return Err(if mutation {
                RuntimeError::Indeterminate
            } else {
                RuntimeError::TooLarge
            });
        }
        Ok(RawResponse { headers, body })
    }

    fn endpoint(&self, path: &[&str], query: &[(&str, &str)]) -> Result<Url> {
        for segment in path {
            validate_id(segment)?;
        }
        let mut url = self.origin.clone();
        url.path_segments_mut()
            .map_err(|_| RuntimeError::InvalidInput)?
            .clear()
            .extend(path.iter().copied());
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query.iter().copied());
        }
        Ok(url)
    }
}

fn sensitive_header(value: &str) -> Result<HeaderValue> {
    let mut header = HeaderValue::from_str(value).map_err(|_| RuntimeError::InvalidInput)?;
    header.set_sensitive(true);
    Ok(header)
}

pub(crate) fn cookie_header(cookie: &str, scope: Option<&str>) -> Result<Zeroizing<String>> {
    if cookie.len() != 64 || !cookie.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(RuntimeError::InvalidInput);
    }
    let mut result = Zeroizing::new(format!("mediflow_session={cookie}"));
    if let Some(scope) = scope {
        validate_scope_id(scope)?;
        result.push_str("; ambulatory_id=");
        result.push_str(&encode_cookie_value(scope));
    }
    Ok(result)
}

/// Exact encodeURIComponent byte set, consumed by Next RequestCookies through
/// decodeURIComponent. Encode delimiters and '%' once; preserve the opaque ID.
fn encode_cookie_value(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 15) as usize] as char);
        }
    }
    encoded
}

fn session_cookie(headers: &HeaderMap) -> Result<Zeroizing<String>> {
    let mut found = None;
    for header in headers.get_all(SET_COOKIE) {
        let header = header.to_str().map_err(|_| RuntimeError::InvalidResponse)?;
        if let Some(cookie) = header
            .split(';')
            .next()
            .and_then(|part| part.strip_prefix("mediflow_session="))
        {
            if found.is_some()
                || cookie.len() != 64
                || !cookie.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err(RuntimeError::InvalidResponse);
            }
            found = Some(Zeroizing::new(cookie.to_owned()));
        }
    }
    found.ok_or(RuntimeError::InvalidResponse)
}

fn validate_origin(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| RuntimeError::InvalidInput)?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(RuntimeError::InvalidInput);
    }
    match url.scheme() {
        "https" if url.host().is_some() => Ok(url),
        "http" => {
            let literal_loopback = url
                .host_str()
                .and_then(|host| {
                    host.trim_start_matches('[')
                        .trim_end_matches(']')
                        .parse::<IpAddr>()
                        .ok()
                })
                .is_some_and(|ip| ip.is_loopback());
            if literal_loopback {
                Ok(url)
            } else {
                Err(RuntimeError::InvalidInput)
            }
        }
        _ => Err(RuntimeError::InvalidInput),
    }
}

fn uncertain(mutation: bool) -> RuntimeError {
    if mutation {
        RuntimeError::Indeterminate
    } else {
        RuntimeError::Transport
    }
}
fn classify_status(status: u16, mutation: bool) -> RuntimeError {
    match status {
        401 => RuntimeError::Authentication,
        403 => RuntimeError::Forbidden,
        404 => RuntimeError::Missing,
        409 => RuntimeError::Conflict,
        400..=499 => RuntimeError::Rejected(status),
        _ if mutation => RuntimeError::Indeterminate,
        _ => RuntimeError::Transport,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_explicit_loopback_may_use_http_and_credentials_are_origin_bound() {
        for origin in [
            "http://127.0.0.1:43181",
            "http://[::1]:43181",
            "https://homebase.example:8443",
        ] {
            assert!(validate_origin(origin).is_ok());
        }
        for origin in [
            "http://localhost:43181",
            "http://192.168.1.2",
            "https://user:secret@example.com",
            "https://example.com/api",
            "https://example.com/?x=1",
            "https://example.com/#key",
        ] {
            assert!(validate_origin(origin).is_err());
        }
        assert_eq!(
            cookie_header(&"a".repeat(64), Some("x; other=value"))
                .unwrap()
                .as_str(),
            format!(
                "mediflow_session={}; ambulatory_id=x%3B%20other%3Dvalue",
                "a".repeat(64)
            )
        );
        assert!(cookie_header(&"a".repeat(64), Some("x\r\ninjected: value")).is_err());
    }
    #[test]
    fn write_failures_do_not_claim_rejection_when_effects_are_unknown() {
        assert!(classify_status(503, true).is_indeterminate());
        assert!(classify_status(302, true).is_indeterminate());
        assert!(classify_status(409, true).is_conflict());
        assert!(classify_status(401, true).is_auth_failure());
        assert_eq!(classify_status(403, true), RuntimeError::Forbidden);
        assert_eq!(uncertain(false), RuntimeError::Transport);
    }

    #[test]
    fn opaque_cookie_ids_match_node_and_next_golden_without_injection() {
        let fixture: Value =
            serde_json::from_str(include_str!("../tests/opaque-id-vectors.json")).unwrap();
        for vector in fixture["vectors"].as_array().unwrap() {
            let id = vector["id"].as_str().unwrap();
            assert!(validate_scope_id(id).is_ok());
            assert_eq!(encode_cookie_value(id), vector["cookie"].as_str().unwrap());
            let cookie = cookie_header(&"a".repeat(64), Some(id)).unwrap();
            assert_eq!(
                cookie.split(';').count(),
                2,
                "opaque scope must not inject another cookie"
            );
            assert!(cookie.ends_with(vector["cookie"].as_str().unwrap()));
        }
        assert!(validate_pairing_id("client.synthetic-a").is_ok());
        for bad in [
            "",
            "device with space",
            "device\r\ninjected: x",
            "dispositivo-🩺",
        ] {
            assert!(validate_pairing_id(bad).is_err());
        }
        for bad in ["", " ", "\u{feff}", "scope\nnext", "scope\0next"] {
            assert!(validate_scope_id(bad).is_err());
        }
    }

    #[test]
    fn opaque_resource_ids_keep_spaces_unicode_and_literal_percent_in_one_segment() {
        let client = RuntimeClient::new(RuntimeConfig {
            base_url: "http://127.0.0.1:43181".into(),
            tls_pin_sha256: None,
        })
        .unwrap();
        for (id, expected) in [
            ("checkup.v1", "checkup.v1"),
            (" opaque-web ", "%20opaque-web%20"),
            (
                "controllo città 🩺",
                "controllo%20citt%C3%A0%20%F0%9F%A9%BA",
            ),
            ("record/../second", "record%2F..%2Fsecond"),
            ("record%2Fid", "record%252Fid"),
            ("query?fragment#", "query%3Ffragment%23"),
        ] {
            let url = client
                .endpoint(
                    &[
                        "api",
                        "v1",
                        "network",
                        "patients",
                        "patient.v1",
                        "checkups",
                        id,
                    ],
                    &[],
                )
                .unwrap();
            assert_eq!(
                url.path(),
                format!("/api/v1/network/patients/patient.v1/checkups/{expected}")
            );
            assert_eq!(url.path_segments().unwrap().count(), 7);
            assert!(url.query().is_none() && url.fragment().is_none());
        }
        for bad in [".", "..", "row\nother", "row\0other"] {
            assert!(client.endpoint(&["patients", bad], &[]).is_err());
        }
    }

    #[test]
    fn query_values_cannot_inject_another_parameter_fragment_or_path() {
        let client = RuntimeClient::new(RuntimeConfig {
            base_url: "http://127.0.0.1:43181".into(),
            tls_pin_sha256: None,
        })
        .unwrap();
        let query = "Città 🩺 &limit=500#fragment/?q=%2F + literal";
        let url = client
            .endpoint(
                &["api", "v1", "network", "drugs"],
                &[("q", query), ("limit", "30")],
            )
            .unwrap();
        assert_eq!(url.path(), "/api/v1/network/drugs");
        assert!(url.fragment().is_none());
        assert_eq!(
            url.query_pairs().collect::<Vec<_>>(),
            [("q".into(), query.into()), ("limit".into(), "30".into())]
        );
    }
}
