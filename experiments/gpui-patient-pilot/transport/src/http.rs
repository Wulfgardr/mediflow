use crate::{
    RequestContext, Result, RuntimeError, RuntimeSession, RuntimeUser, crypto, tls, validate_id,
    validate_pairing_id, validate_scope_id,
};
use reqwest::{
    Client, Method, Url,
    header::{COOKIE, HeaderMap, HeaderValue, SET_COOKIE},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{net::IpAddr, sync::OnceLock, time::Duration};
use zeroize::{Zeroize, Zeroizing};

pub(crate) const JSON_LIMIT: usize = 8 * 1024 * 1024;
pub(crate) const DOCUMENT_LIMIT: usize = 24 * 1024 * 1024;
#[derive(Clone, Copy)]
pub(crate) struct JsonLimits {
    pub request: usize,
    pub response: usize,
}
impl From<usize> for JsonLimits {
    fn from(limit: usize) -> Self {
        Self {
            request: limit,
            response: limit,
        }
    }
}
fn encode_private_json<T: Serialize + ?Sized>(
    value: &T,
    limit: usize,
) -> Result<Zeroizing<Vec<u8>>> {
    struct Count {
        len: usize,
        limit: usize,
        too_large: bool,
    }
    impl std::io::Write for Count {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            let Some(len) = self
                .len
                .checked_add(bytes.len())
                .filter(|len| *len <= self.limit)
            else {
                self.too_large = true;
                return Err(std::io::Error::other("JSON limit"));
            };
            self.len = len;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut count = Count {
        len: 0,
        limit,
        too_large: false,
    };
    serde_json::to_writer(&mut count, value).map_err(|_| {
        if count.too_large {
            RuntimeError::TooLarge
        } else {
            RuntimeError::InvalidInput
        }
    })?;
    let mut encoded = Zeroizing::new(vec![0; count.len]);
    let mut remaining = encoded.as_mut_slice();
    serde_json::to_writer(&mut remaining, value).map_err(|_| RuntimeError::InvalidInput)?;
    if !remaining.is_empty() {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(encoded)
}

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
    pub(crate) context: RequestContext,
    origin: Url,
    base_url: String,
}

pub(crate) struct RawResponse {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: Zeroizing<Vec<u8>>,
}

impl RuntimeClient {
    pub fn new(config: RuntimeConfig) -> Result<Self> {
        let origin = validate_origin(&config.base_url)?;
        let loopback = origin.host_str().is_some_and(|host| {
            host == "localhost"
                || host
                    .trim_matches(['[', ']'])
                    .parse::<IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        });
        if !loopback && config.tls_pin_sha256.is_none() {
            return Err(RuntimeError::InvalidInput);
        }
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
            context: RequestContext::default(),
        })
    }

    pub(crate) fn request_context(&self) -> RequestContext {
        self.context.clone()
    }

    pub fn with_request_context(&self, context: RequestContext) -> Self {
        Self {
            context,
            ..self.clone()
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Uses the existing native login contract for passphrase and legacy PIN accounts.
    pub fn login(
        &self,
        pairing: PairingCredentials,
        username: &str,
        passphrase: &str,
    ) -> Result<RuntimeSession> {
        self.login_with_pin_confirmation(pairing, username, passphrase, false)
    }

    pub fn login_with_pin_confirmation(
        &self,
        pairing: PairingCredentials,
        username: &str,
        passphrase: &str,
        pin_confirmed: bool,
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
            None,
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
        let salt = unlock.salt;
        let material = match (unlock.credential.as_str(), unlock.kdf_version) {
            ("passphrase", Some(3)) => Some(crypto::derive_v3(
                passphrase,
                salt.as_deref().ok_or(RuntimeError::InvalidResponse)?,
            )?),
            ("pin", None) => {
                crypto::validate_pin(passphrase)?;
                if crypto::normalize_passphrase(passphrase).is_ok() && !pin_confirmed {
                    return Err(RuntimeError::PinConfirmationRequired);
                }
                None
            }
            _ => return Err(RuntimeError::UnsupportedUnlock),
        };
        #[derive(Serialize)]
        struct Login<'a> {
            username: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            verifier: Option<&'a str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            password: Option<&'a str>,
        }
        let body = Zeroizing::new(
            serde_json::to_vec(&Login {
                username,
                verifier: material.as_ref().map(|material| material.verifier.as_str()),
                password: material.is_none().then_some(passphrase),
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
            None,
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
                || salt.as_ref().is_some_and(|salt| &login.salt != salt)
                || login.user.username != username
            {
                return Err(RuntimeError::InvalidResponse);
            }
            validate_id(&login.user.id).map_err(|_| RuntimeError::InvalidResponse)?;
            let master = match &material {
                Some(material) => crypto::unwrap_v3(&login.encrypted_master_key, &material.kek)?,
                None => crypto::unwrap_pin(&login.encrypted_master_key, passphrase, &login.salt)?,
            };
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
                    None,
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
        limit: impl Into<JsonLimits>,
        archive_generation: Option<&str>,
    ) -> Result<Value> {
        self.json_serializable(
            method,
            path,
            query,
            scope,
            pairing,
            cookie,
            body,
            mutation,
            limit,
            archive_generation,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn json_serializable<T: Serialize + ?Sized>(
        &self,
        method: Method,
        path: &[&str],
        query: &[(&str, &str)],
        scope: Option<&str>,
        pairing: &PairingCredentials,
        cookie: &str,
        body: Option<&T>,
        mutation: bool,
        limit: impl Into<JsonLimits>,
        archive_generation: Option<&str>,
    ) -> Result<Value> {
        let limits = limit.into();
        let encoded = body
            .map(|value| encode_private_json(value, limits.request))
            .transpose()?;
        let response = self.raw(
            method,
            path,
            query,
            scope,
            pairing,
            Some(cookie),
            encoded.as_deref().map(Vec::as_slice),
            mutation,
            limits.response,
            archive_generation,
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
        archive_generation: Option<&str>,
    ) -> Result<RawResponse> {
        http_runtime().block_on(self.context.run(
            async {
                // Only this exact existing read-only contract delivers typed readiness
                // with 503. Keep every other route's HTTP failure semantics unchanged.
                let who_readiness =
                    !mutation && method == Method::GET && path == crate::who::READINESS_PATH;
                let analytics_read = !mutation
                    && method == Method::GET
                    && path == crate::analytics::DEMOGRAPHICS_PATH;
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
                if let Some(generation) = archive_generation {
                    validate_id(generation)?;
                    headers.insert(
                        "x-mediflow-archive-generation",
                        sensitive_header(generation)?,
                    );
                }
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
                        .body(bytes::Bytes::from_owner(Zeroizing::new(body.to_owned())));
                }
                let response = request.send().await.map_err(|_| uncertain(mutation))?;
                let status = response.status().as_u16();
                let account_profile = path == crate::account_profile::ACCOUNT_PROFILE_PATH;
                if !(200..300).contains(&status) && !(who_readiness && status == 503) {
                    if status == 409 {
                        let error_limit = if analytics_read { 1024 } else { limit };
                        let raw = match read_response_body(response, error_limit, mutation).await {
                            Ok(raw) => raw,
                            Err(error) if account_profile => return Err(error),
                            Err(_) => return Err(RuntimeError::Conflict),
                        };
                        return match conflict_code(&raw.body) {
                            ConflictCode::ArchiveReplaced => Err(RuntimeError::ArchiveReplaced),
                            ConflictCode::AnalyticsCancelled if analytics_read => {
                                Err(RuntimeError::AnalyticsCancelled)
                            }
                            ConflictCode::ProfileVersionConflict if account_profile && mutation => {
                                Ok(raw)
                            }
                            _ => Err(RuntimeError::Conflict),
                        };
                    }
                    return Err(classify_status(status, mutation));
                }
                let raw = read_response_body(response, limit, mutation).await?;
                if who_readiness {
                    crate::who::validate_readiness_http(status, &raw.body)?;
                }
                Ok(raw)
            },
            mutation,
        ))
    }

    pub(crate) fn dedicated_web_raw(
        &self,
        method: Method,
        path: &[&str],
        headers: HeaderMap,
        body: Option<&Value>,
        mutation: bool,
    ) -> Result<RawResponse> {
        self.dedicated_web_raw_observing_headers(
            method,
            path,
            headers,
            body,
            mutation,
            &mut |_, _| {},
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn dedicated_web_raw_observing_headers(
        &self,
        method: Method,
        path: &[&str],
        headers: HeaderMap,
        body: Option<&Value>,
        mutation: bool,
        received: &mut impl FnMut(u16, &HeaderMap),
    ) -> Result<RawResponse> {
        if !self.is_local_bootstrap_origin() {
            return Err(RuntimeError::Forbidden);
        }
        let encoded = body
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|_| RuntimeError::InvalidInput)?
            .map(Zeroizing::new);
        let archive = path.starts_with(&["api", "system", "backup-restore"]);
        if encoded.as_ref().is_some_and(|v| {
            v.len()
                > if archive || reference_json_path(path) {
                    JSON_LIMIT
                } else {
                    4096
                }
        }) {
            return Err(RuntimeError::TooLarge);
        }
        http_runtime().block_on(self.context.run(
            async {
                let mut request = self
                    .http
                    .request(method, self.endpoint(path, &[])?)
                    .headers(headers)
                    .header("origin", self.origin.origin().ascii_serialization())
                    .header("sec-fetch-site", "same-origin")
                    .header("content-type", "application/json");
                if let Some(body) = encoded {
                    request = request.body(body.to_vec());
                }
                if matches!(
                    path,
                    ["api", "ai", "local-provider", "onboarding"]
                        | ["api", "icd", "catalog"]
                        | ["api", "drugs", "update"]
                ) {
                    request = request.timeout(Duration::from_secs(70));
                }
                let response = request.send().await.map_err(|_| uncertain(mutation))?;
                received(response.status().as_u16(), response.headers());
                let raw =
                    read_response_body(response, dedicated_web_limit(path, archive), mutation)
                        .await?;
                if (300..400).contains(&raw.status) {
                    return Err(RuntimeError::Rejected(raw.status));
                }
                if !(200..300).contains(&raw.status) {
                    if raw.status == 409
                        && matches!(conflict_code(&raw.body), ConflictCode::ArchiveReplaced)
                    {
                        return Err(RuntimeError::ArchiveReplaced);
                    }
                    if (path == ["api", "ai", "local-provider", "onboarding"]
                        && matches!(raw.status, 409 | 503))
                        || (path == ["api", "drugs", "update"] && raw.status == 409)
                    {
                        return Ok(raw);
                    }
                    return Err(match raw.status {
                        401 => RuntimeError::Rejected(401),
                        403 => RuntimeError::Forbidden,
                        404 => RuntimeError::Missing,
                        409 => RuntimeError::Conflict,
                        n => RuntimeError::Rejected(n),
                    });
                }
                Ok(raw)
            },
            mutation,
        ))
    }

    pub(crate) fn aifa_catalog_raw(
        &self,
        headers: HeaderMap,
        upload: Option<(String, Vec<u8>)>,
    ) -> Result<RawResponse> {
        if !self.is_local_bootstrap_origin() {
            return Err(RuntimeError::Forbidden);
        }
        let mutation = upload.is_some();
        http_runtime().block_on(self.context.run(
            async {
                let mut request = self
                    .http
                    .request(
                        if mutation { Method::POST } else { Method::GET },
                        self.endpoint(
                            &["api", "drugs"],
                            if mutation { &[] } else { &[("count", "1")] },
                        )?,
                    )
                    .headers(headers)
                    .header("origin", self.origin.origin().ascii_serialization())
                    .header("sec-fetch-site", "same-origin");
                if let Some((content_type, bytes)) = upload {
                    if bytes.len() > 101 * 1024 * 1024 {
                        return Err(RuntimeError::TooLarge);
                    }
                    request = request.header("content-type", content_type).body(bytes);
                }
                let response = request.send().await.map_err(|_| uncertain(mutation))?;
                let raw = read_response_body(response, AUTH_LIMIT, mutation).await?;
                if raw.status == 409
                    && matches!(conflict_code(&raw.body), ConflictCode::ArchiveReplaced)
                {
                    return Err(RuntimeError::ArchiveReplaced);
                }
                if raw.status == 409 || (200..300).contains(&raw.status) {
                    return Ok(raw);
                }
                Err(classify_status(raw.status, mutation))
            },
            mutation,
        ))
    }

    pub(crate) fn is_local_bootstrap_origin(&self) -> bool {
        self.origin.host_str().is_some_and(|host| {
            host == "localhost"
                || host
                    .trim_matches(['[', ']'])
                    .parse::<IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        })
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

fn http_runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("HTTP runtime")
    })
}

pub(crate) fn sensitive_header(value: &str) -> Result<HeaderValue> {
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
pub(crate) fn encode_cookie_value(value: &str) -> String {
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

pub(crate) fn session_cookie(headers: &HeaderMap) -> Result<Zeroizing<String>> {
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

async fn read_response_body(
    mut response: reqwest::Response,
    limit: usize,
    mutation: bool,
) -> Result<RawResponse> {
    let status = response.status().as_u16();
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
    while let Some(chunk) = response.chunk().await.map_err(|_| uncertain(mutation))? {
        if chunk.len() > limit.saturating_sub(body.len()) {
            return Err(if mutation {
                RuntimeError::Indeterminate
            } else {
                RuntimeError::TooLarge
            });
        }
        body.extend_from_slice(&chunk);
    }
    if body.len() > limit {
        return Err(if mutation {
            RuntimeError::Indeterminate
        } else {
            RuntimeError::TooLarge
        });
    }
    Ok(RawResponse {
        status,
        headers,
        body,
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ConflictCode {
    ProfileVersionConflict,
    ArchiveReplaced,
    AnalyticsCancelled,
    Other,
}

fn conflict_code(body: &[u8]) -> ConflictCode {
    match serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| value["code"].as_str().map(str::to_owned))
        .as_deref()
    {
        Some("PROFILE_VERSION_CONFLICT") => ConflictCode::ProfileVersionConflict,
        Some("ARCHIVE_REPLACED") => ConflictCode::ArchiveReplaced,
        Some("ANALYTICS_CANCELLED") => ConflictCode::AnalyticsCancelled,
        _ => ConflictCode::Other,
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

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FirstAmbulatoryDraft {
    pub id: String,
    pub name: String,
    pub address: Option<String>,
    pub description: Option<String>,
}
impl FirstAmbulatoryDraft {
    pub fn new(name: String, address: Option<String>, description: Option<String>) -> Result<Self> {
        let draft = Self {
            id: operation_uuid()?,
            name,
            address,
            description,
        };
        draft.validate()?;
        Ok(draft)
    }
    fn validate(&self) -> Result<()> {
        let id = self.id.as_bytes();
        if id.len() != 36
            || ![8, 13, 18, 23].into_iter().all(|i| id[i] == b'-')
            || id[14] != b'4'
            || !matches!(id[19], b'8' | b'9' | b'a' | b'b')
            || !id.iter().enumerate().all(|(i, b)| {
                [8, 13, 18, 23].contains(&i) || b.is_ascii_digit() || (b'a'..=b'f').contains(b)
            })
        {
            return Err(RuntimeError::InvalidInput);
        }
        let text = |v: &str, n| {
            !v.is_empty()
                && v.trim() == v
                && v.encode_utf16().count() <= n
                && !v.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        };
        if !text(&self.name, 200)
            || self.address.as_ref().is_some_and(|v| !text(v, 500))
            || self.description.as_ref().is_some_and(|v| !text(v, 2000))
        {
            return Err(RuntimeError::InvalidInput);
        }
        Ok(())
    }
}

/// A separate, short-lived Web P3 transport. It is never a paired session.
pub struct HostBootstrapSession {
    client: RuntimeClient,
    draft: FirstAmbulatoryDraft,
    generation: String,
    reference: Zeroizing<String>,
    control: Zeroizing<String>,
    cookie: Zeroizing<String>,
    sent: std::sync::atomic::AtomicBool,
}
impl HostBootstrapSession {
    pub(crate) fn authenticate(
        client: RuntimeClient,
        user: &RuntimeUser,
        pairing: &PairingCredentials,
        native_cookie: &str,
        draft: FirstAmbulatoryDraft,
        passphrase: &str,
    ) -> Result<Self> {
        draft.validate()?;
        if !client.is_local_bootstrap_origin() || user.role != "admin" {
            return Err(RuntimeError::Forbidden);
        }
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
            COOKIE,
            sensitive_header(&cookie_header(native_cookie, None)?)?,
        );
        headers.insert(
            "x-mediflow-archive-generation",
            sensitive_header(&user.archive_generation)?,
        );
        let mut value = serde_json::to_value(&draft).map_err(|_| RuntimeError::InvalidInput)?;
        value["operation"] = serde_json::json!("first-ambulatory.create.v1");
        let opened = client.dedicated_web_raw(
            Method::POST,
            &["api", "auth", "ambulatory-bootstrap", "begin"],
            headers,
            Some(&value),
            false,
        )?;
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Open {
            operation: String,
            contract_version: u64,
            reference: String,
            archive_generation: String,
            expires_at: u64,
        }
        let open: Open =
            serde_json::from_slice(&opened.body).map_err(|_| RuntimeError::InvalidResponse)?;
        if open.operation != "first-ambulatory.create.v1"
            || open.contract_version != 1
            || open.archive_generation != user.archive_generation
            || open.reference.len() != 64
            || !open
                .reference
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || open.expires_at == 0
        {
            return Err(RuntimeError::InvalidResponse);
        }
        let control = control_cookie(&opened.headers, "mediflow_auth_control", 32, 256)?;
        let mut host = Self {
            client,
            draft,
            generation: open.archive_generation,
            reference: Zeroizing::new(open.reference),
            control,
            cookie: Zeroizing::new(String::new()),
            sent: std::sync::atomic::AtomicBool::new(false),
        };
        let (cookie, login, _) =
            authenticate_web_p3(&host.client, user, host.headers()?, passphrase, false);
        if let Some(cookie) = cookie {
            host.cookie = cookie;
        }
        if let Err(error) = login {
            let _ = host.retire();
            return Err(error);
        }
        Ok(host)
    }
    fn headers(&self) -> Result<HeaderMap> {
        let mut headers = HeaderMap::new();
        let cookie = Zeroizing::new(if self.cookie.is_empty() {
            format!("mediflow_auth_control={}", *self.control)
        } else {
            format!(
                "mediflow_session={}; mediflow_auth_control={}",
                *self.cookie, *self.control
            )
        });
        headers.insert(COOKIE, sensitive_header(&cookie)?);
        headers.insert(
            "x-mediflow-bootstrap-reference",
            sensitive_header(&self.reference)?,
        );
        headers.insert(
            "x-mediflow-archive-generation",
            sensitive_header(&self.generation)?,
        );
        Ok(headers)
    }
    pub fn commit(&self) -> Result<()> {
        if self.sent.swap(true, std::sync::atomic::Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let raw = self.client.dedicated_web_raw(
            Method::POST,
            &["api", "auth", "ambulatory-bootstrap"],
            self.headers()?,
            Some(&serde_json::json!({"operation":"first-ambulatory.create.v1","confirm":true})),
            true,
        )?;
        let value: Value =
            serde_json::from_slice(&raw.body).map_err(|_| RuntimeError::Indeterminate)?;
        if raw.status != 201
            || value
                != serde_json::json!({"operation":"first-ambulatory.create.v1","contractVersion":1,"archiveGeneration":self.generation,"success":true,"id":self.draft.id,"version":1,"affectedAmbulatories":[{"id":self.draft.id,"version":1}]})
        {
            return Err(RuntimeError::Indeterminate);
        }
        Ok(())
    }
    /// Observed state only; this does not attribute a previous commit to this attempt.
    pub fn readback(&self) -> Result<String> {
        let raw = self.client.dedicated_web_raw(
            Method::GET,
            &["api", "auth", "ambulatory-bootstrap"],
            self.headers()?,
            None,
            false,
        )?;
        let value: Value =
            serde_json::from_slice(&raw.body).map_err(|_| RuntimeError::InvalidResponse)?;
        if value
            != serde_json::json!({"operation":"first-ambulatory.read.v1","contractVersion":1,"archiveGeneration":self.generation,"id":self.draft.id,"name":self.draft.name,"address":self.draft.address,"description":self.draft.description,"parentId":null,"type":"live","isDefault":true,"version":1})
        {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(self.draft.id.clone())
    }
    pub fn cancel_local(&self) {
        self.client.context.cancel();
    }
    pub fn retire(&self) -> Result<()> {
        let raw = self
            .client
            .with_request_context(RequestContext::default())
            .dedicated_web_raw(
                Method::POST,
                &["api", "auth", "ambulatory-bootstrap", "retire"],
                self.headers()?,
                Some(&serde_json::json!({"operation":"first-ambulatory.retire.v1"})),
                false,
            )?;
        if raw.status == 204 && raw.body.is_empty() {
            Ok(())
        } else {
            Err(RuntimeError::InvalidResponse)
        }
    }
}
pub(crate) fn authenticate_web_p3(
    client: &RuntimeClient,
    user: &RuntimeUser,
    headers: HeaderMap,
    passphrase: &str,
    local_client: bool,
) -> (Option<Zeroizing<String>>, Result<()>, bool) {
    let mut cookie = None;
    let mut possibly_issued = false;
    let login = (|| {
        let checked = client.dedicated_web_raw(
            Method::GET,
            &["api", "auth", "check"],
            headers.clone(),
            None,
            false,
        )?;
        let check: Value =
            serde_json::from_slice(&checked.body).map_err(|_| RuntimeError::InvalidResponse)?;
        if check["status"] != "ok"
            || check["isSetup"] != true
            || check["archiveGeneration"] != user.archive_generation
        {
            return Err(RuntimeError::UnsupportedUnlock);
        }
        let material = match check["unlock"]["credential"].as_str() {
            Some("passphrase") if check["unlock"]["kdfVersion"] == 3 => Some(crypto::derive_v3(
                passphrase,
                check["unlock"]["salt"]
                    .as_str()
                    .ok_or(RuntimeError::InvalidResponse)?,
            )?),
            Some("pin") => {
                crypto::validate_pin(passphrase)?;
                if crypto::normalize_passphrase(passphrase).is_ok() {
                    return Err(RuntimeError::LegacyAccessNeedsWeb);
                }
                None
            }
            _ => return Err(RuntimeError::UnsupportedUnlock),
        };
        let mut headers = headers.clone();
        let etag = checked
            .headers
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .ok_or(RuntimeError::InvalidResponse)?;
        if etag.len() < 34
            || etag.len() > 258
            || !etag.starts_with('"')
            || !etag.ends_with('"')
            || !etag[1..etag.len() - 1]
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        {
            return Err(RuntimeError::InvalidResponse);
        }
        headers.insert("if-match", sensitive_header(etag)?);
        headers.insert("idempotency-key", sensitive_header(&operation_uuid()?)?);
        let mut body = match &material {
            Some(material) => json!({"username":user.username,"verifier":&*material.verifier}),
            None => json!({"username":user.username,"password":passphrase}),
        };
        possibly_issued = true;
        let logged = client.dedicated_web_raw_observing_headers(
            Method::POST,
            &if local_client {
                vec!["api", "auth", "local-client", "login"]
            } else {
                vec!["api", "auth", "login"]
            },
            headers,
            Some(&body),
            true,
            &mut |status, headers| {
                cookie = session_cookie(headers).ok();
                possibly_issued = cookie.is_some() || (200..300).contains(&status);
            },
        );
        for field in ["verifier", "password"] {
            if let Some(Value::String(secret)) = body.get_mut(field) {
                secret.zeroize();
            }
        }
        let logged = logged?;
        if cookie.is_none() {
            return Err(RuntimeError::InvalidResponse);
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Login {
            success: bool,
            id: String,
            username: String,
            role: String,
            archive_generation: String,
        }
        let admitted: Login =
            serde_json::from_slice(&logged.body).map_err(|_| RuntimeError::InvalidResponse)?;
        if !admitted.success
            || admitted.id != user.id
            || admitted.username != user.username
            || admitted.role != user.role
            || admitted.archive_generation != user.archive_generation
        {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(())
    })();
    (cookie, login, possibly_issued)
}

pub(crate) fn control_cookie(
    headers: &HeaderMap,
    name: &str,
    min: usize,
    max: usize,
) -> Result<Zeroizing<String>> {
    let mut found = None;
    for value in headers.get_all(SET_COOKIE) {
        let first = value
            .to_str()
            .map_err(|_| RuntimeError::InvalidResponse)?
            .split(';')
            .next()
            .unwrap_or("");
        if let Some((key, value)) = first.split_once('=')
            && key == name
        {
            if found.is_some()
                || value.len() < min
                || value.len() > max
                || !value
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
            {
                return Err(RuntimeError::InvalidResponse);
            }
            found = Some(Zeroizing::new(value.to_owned()));
        }
    }
    found.ok_or(RuntimeError::InvalidResponse)
}
pub(crate) fn operation_uuid() -> Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| RuntimeError::Crypto)?;
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    let hex: String = bytes.iter().map(|v| format!("{v:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}

fn reference_json_path(path: &[&str]) -> bool {
    matches!(
        path,
        [
            "api",
            "exemptions",
            "import",
            "status" | "preview" | "commit"
        ] | [
            "api",
            "prosthetics",
            "catalog",
            "status" | "preview" | "commit" | "sources"
        ] | ["api", "icd", "catalog"]
    )
}

fn dedicated_web_limit(path: &[&str], archive: bool) -> usize {
    match path {
        ["api", "system", "recovery-backup"] => 512 * 1024 * 1024,
        ["api", "system", "backup-scheduler"] => JSON_LIMIT,
        // These reports carry their full Markdown beside the fields the panel reads.
        ["api", "system", "ai-parliament" | "ai-rollout-readiness"] => JSON_LIMIT,
        ["api", "system", "audit" | "update-awareness"] => JSON_LIMIT,
        _ if archive => JSON_LIMIT,
        ["api", "attachments", _] => DOCUMENT_LIMIT,
        _ if reference_json_path(path) => JSON_LIMIT,
        _ => AUTH_LIMIT,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn remote_origin_requires_valid_explicit_pin() {
        for origin in ["https://192.0.2.1:3443", "https://homebase.local:3443"] {
            for pin in [
                None,
                Some("".into()),
                Some("aa".into()),
                Some("z".repeat(64)),
            ] {
                assert!(
                    RuntimeClient::new(RuntimeConfig {
                        base_url: origin.into(),
                        tls_pin_sha256: pin
                    })
                    .is_err()
                );
            }
            assert!(
                RuntimeClient::new(RuntimeConfig {
                    base_url: origin.into(),
                    tls_pin_sha256: Some("a".repeat(64))
                })
                .is_ok()
            );
        }
    }

    #[test]
    fn fixture_accept_discards_only_the_loopback_port_probe() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let send = |chunks: &'static [&'static str]| {
            std::thread::spawn(move || {
                let mut client = std::net::TcpStream::connect(address).unwrap();
                for chunk in chunks {
                    client.write_all(chunk.as_bytes()).unwrap();
                    std::thread::sleep(std::time::Duration::from_millis(30));
                }
                std::thread::sleep(std::time::Duration::from_millis(400));
            })
        };
        // Split on purpose: the first segment alone looks like an ordinary GET.
        let probe = send(&[
            "GET / HTTP/1.1\r\nhost: localhost\r\n",
            "user-agent: node\r\n\r\n",
        ]);
        let tls = send(&["\u{16}", "\u{3}\u{1}"]);
        std::thread::sleep(std::time::Duration::from_millis(150));
        let client = send(&["GET / HTTP/1.1\r\nhost: localhost\r\nuser-agent: reqwest\r\n\r\n"]);
        let (mut kept, _) = crate::test_loopback::accept(&listener).unwrap();
        let mut request = [0; 128];
        let read = kept.read(&mut request).unwrap();
        assert!(String::from_utf8_lossy(&request[..read]).ends_with("reqwest\r\n\r\n"));
        for worker in [probe, tls, client] {
            worker.join().unwrap();
        }
    }

    #[test]
    fn reference_response_budgets_are_explicit_and_do_not_expand_other_routes() {
        for path in [
            vec!["api", "exemptions", "import", "status"],
            vec!["api", "exemptions", "import", "preview"],
            vec!["api", "exemptions", "import", "commit"],
            vec!["api", "prosthetics", "catalog", "status"],
            vec!["api", "prosthetics", "catalog", "preview"],
            vec!["api", "prosthetics", "catalog", "commit"],
            vec!["api", "prosthetics", "catalog", "sources"],
            vec!["api", "icd", "catalog"],
        ] {
            assert_eq!(super::dedicated_web_limit(&path, false), super::JSON_LIMIT);
        }
        assert_eq!(
            super::dedicated_web_limit(&["api", "unrelated"], false),
            super::AUTH_LIMIT
        );
        assert!(!super::reference_json_path(&[
            "api",
            "prosthetics",
            "catalog",
            "unknown"
        ]));
    }

    #[test]
    fn private_json_has_exact_storage_and_preserves_the_budget() {
        let value = serde_json::json!({"source":{"fileKey":[1,2,3],"original":"a\\b\"c"}});
        let expected = serde_json::to_vec(&value).unwrap();
        let body = super::encode_private_json(&value, expected.len()).unwrap();
        assert_eq!(body.as_slice(), expected);
        assert_eq!(body.len(), body.capacity());
        assert_eq!(
            super::encode_private_json(&value, expected.len() - 1).unwrap_err(),
            crate::RuntimeError::TooLarge
        );
    }

    #[test]
    fn private_json_fails_closed_on_partial_or_changing_serialization() {
        struct Changing {
            calls: std::cell::Cell<usize>,
            second: &'static str,
        }
        impl serde::Serialize for Changing {
            fn serialize<S: serde::Serializer>(
                &self,
                serializer: S,
            ) -> std::result::Result<S::Ok, S::Error> {
                let calls = self.calls.get();
                self.calls.set(calls + 1);
                serializer.serialize_str(if calls == 0 { "counted" } else { self.second })
            }
        }
        for second in ["longer than counted", "short"] {
            assert_eq!(
                super::encode_private_json(
                    &Changing {
                        calls: std::cell::Cell::new(0),
                        second
                    },
                    1024
                )
                .unwrap_err(),
                crate::RuntimeError::InvalidInput
            );
        }
        struct Invalid;
        impl serde::Serialize for Invalid {
            fn serialize<S: serde::Serializer>(
                &self,
                _: S,
            ) -> std::result::Result<S::Ok, S::Error> {
                Err(serde::ser::Error::custom("synthetic failure"))
            }
        }
        assert_eq!(
            super::encode_private_json(&Invalid, 1024).unwrap_err(),
            crate::RuntimeError::InvalidInput
        );
    }

    use super::*;
    use std::io::Read;

    fn bootstrap_request(stream: &mut std::net::TcpStream) -> String {
        let mut all = Vec::new();
        let mut byte = [0];
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        while !all.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            all.push(byte[0]);
            assert!(all.len() < 16384);
        }
        let head = String::from_utf8(all.clone()).unwrap();
        let n = head
            .lines()
            .find_map(|v| {
                v.to_ascii_lowercase()
                    .strip_prefix("content-length: ")
                    .and_then(|v| v.trim().parse::<usize>().ok())
            })
            .unwrap_or(0);
        let mut body = vec![0; n];
        stream.read_exact(&mut body).unwrap();
        all.extend(body);
        String::from_utf8(all).unwrap()
    }
    fn bootstrap_reply(stream: &mut std::net::TcpStream, status: u16, body: &Value, headers: &str) {
        use std::io::Write;
        let body = if status == 204 {
            String::new()
        } else {
            body.to_string()
        };
        stream.write_all(format!("HTTP/1.1 {status} Synthetic\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",body.len()).as_bytes()).unwrap();
    }
    fn bootstrap_observation(draft: &FirstAmbulatoryDraft) -> Value {
        serde_json::json!({"operation":"first-ambulatory.read.v1","contractVersion":1,"archiveGeneration":"generation","id":draft.id,"name":draft.name,"address":draft.address,"description":draft.description,"parentId":null,"type":"live","isDefault":true,"version":1})
    }
    fn bootstrap_test_session(url: String, draft: FirstAmbulatoryDraft) -> HostBootstrapSession {
        HostBootstrapSession {
            client: RuntimeClient::new(RuntimeConfig {
                base_url: url,
                tls_pin_sha256: None,
            })
            .unwrap(),
            draft,
            generation: "generation".into(),
            reference: Zeroizing::new("f".repeat(64)),
            control: Zeroizing::new("b".repeat(64)),
            cookie: Zeroizing::new("d".repeat(64)),
            sent: std::sync::atomic::AtomicBool::new(false),
        }
    }
    #[test]
    fn long_pin_is_not_sent_without_its_own_confirmation() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let client = RuntimeClient::new(RuntimeConfig {
            base_url: format!("http://{}", listener.local_addr().unwrap()),
            tls_pin_sha256: None,
        })
        .unwrap();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = crate::test_loopback::accept(&listener).unwrap();
            assert!(bootstrap_request(&mut stream).starts_with("GET /api/auth/check "));
            bootstrap_reply(
                &mut stream,
                200,
                &json!({"status":"ok","isSetup":true,"archiveGeneration":"generation","unlock":{"credential":"pin"}}),
                "",
            );
        });
        assert!(matches!(
            client.login(
                PairingCredentials::new("paired-test", "t".repeat(64)).unwrap(),
                "admin",
                "Long synthetic PIN only"
            ),
            Err(RuntimeError::PinConfirmationRequired)
        ));
        worker.join().unwrap();
    }

    #[test]
    fn legacy_pin_login_uses_existing_route_and_web_wrapping() {
        for version in [1, 2, 3] {
            let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let client = RuntimeClient::new(RuntimeConfig {
                base_url: url,
                tls_pin_sha256: None,
            })
            .unwrap();
            let worker = std::thread::spawn(move || {
                for step in 0..3 {
                    let (mut stream, _) = crate::test_loopback::accept(&listener).unwrap();
                    let request = bootstrap_request(&mut stream);
                    match step {
                        0 => bootstrap_reply(
                            &mut stream,
                            200,
                            &json!({"status":"ok","isSetup":true,"archiveGeneration":"generation","unlock":{"credential":"pin"}}),
                            "",
                        ),
                        1 => {
                            assert!(request.starts_with("POST /api/auth/native/login "));
                            let body: Value =
                                serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap())
                                    .unwrap();
                            assert_eq!(
                                body,
                                json!({"username":"admin","password":if version == 3 {"Long synthetic PIN only"} else {"1357"}})
                            );
                            let vector: Value = serde_json::from_str(if version == 1 {
                                include_str!(
                                    "../../../../native/contracts/crypto-golden-vectors.v1.json"
                                )
                            } else {
                                include_str!(
                                    "../../../../native/contracts/crypto-golden-vectors.v2.json"
                                )
                            })
                            .unwrap();
                            let long_wrapped = json!(
                                "v2:BwcHBwcHBwcHBwcHmEksoiU6l+1xqibGmdLC45Ln/lmw1UmYDQYAbExxdBIv1MP5vGBAsik7bdK6jXce"
                            );
                            let wrapped = if version == 3 {
                                &long_wrapped
                            } else if version == 1 {
                                &vector["vectors"]["wrappedMasterKeyB64"]
                            } else {
                                &vector["vectors"]["wrappedMasterKeyVersioned"]
                            };
                            bootstrap_reply(
                                &mut stream,
                                200,
                                &json!({"success":true,"id":"synthetic-admin","username":"admin","role":"admin","displayName":"Prova","ambulatoryName":"Prova","archiveGeneration":"generation","salt":"AAECAwQFBgcICQoLDA0ODw==","encryptedMasterKey":wrapped}),
                                &format!(
                                    "Set-Cookie: mediflow_session={}; Path=/; HttpOnly\r\n",
                                    "a".repeat(64)
                                ),
                            );
                        }
                        _ => {
                            assert!(request.starts_with("GET /api/v1/network/capabilities "));
                            bootstrap_reply(
                                &mut stream,
                                200,
                                &json!({"protocolVersion":"1.13.0","operatingMode":"network-home-base","capabilities":[],"hostPorts":serde_json::from_str::<Value>(include_str!("../tests/fixtures/host-ports.json")).unwrap()}),
                                "",
                            );
                        }
                    }
                }
            });
            let session = client
                .login_with_pin_confirmation(
                    PairingCredentials::new("paired-test", "t".repeat(64)).unwrap(),
                    "admin",
                    if version == 3 {
                        "Long synthetic PIN only"
                    } else {
                        "1357"
                    },
                    version == 3,
                )
                .unwrap();
            assert_eq!(session.user().username, "admin");
            session.lock();
            worker.join().unwrap();
        }
    }

    #[test]
    fn governance_reports_are_not_held_to_the_authentication_limit() {
        for path in [
            ["api", "system", "ai-parliament"],
            ["api", "system", "ai-rollout-readiness"],
        ] {
            assert_eq!(dedicated_web_limit(&path, false), JSON_LIMIT);
        }
        assert_eq!(
            dedicated_web_limit(&["api", "ai", "fabric", "status"], false),
            AUTH_LIMIT
        );
        assert_eq!(
            dedicated_web_limit(&["api", "attachments", "synthetic"], false),
            DOCUMENT_LIMIT
        );
    }

    #[test]
    fn bootstrap_authentication_has_separate_cookies_exact_origin_and_existing_web_p3_login() {
        use std::{net::TcpListener, thread};
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let client = RuntimeClient::new(RuntimeConfig {
            base_url: url.clone(),
            tls_pin_sha256: None,
        })
        .unwrap();
        let draft = FirstAmbulatoryDraft::new("Sede inventata".into(), None, None).unwrap();
        let sent = draft.clone();
        let worker = thread::spawn(move || {
            for step in 0..4 {
                let (mut stream, _) = crate::test_loopback::accept(&listener).unwrap();
                let request = bootstrap_request(&mut stream);
                let lower = request.to_lowercase();
                assert!(lower.contains(&format!("origin: {url}\r\n")));
                assert!(lower.contains("sec-fetch-site: same-origin"));
                if step == 0 {
                    assert!(request.starts_with("POST /api/auth/ambulatory-bootstrap/begin "));
                    assert!(
                        lower.contains(&format!("cookie: mediflow_session={}", "a".repeat(64)))
                    );
                    assert!(lower.contains("x-mediflow-paired-client-token:"));
                    let body: Value =
                        serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
                    assert_eq!(body["id"], sent.id);
                    bootstrap_reply(
                        &mut stream,
                        200,
                        &serde_json::json!({"operation":"first-ambulatory.create.v1","contractVersion":1,"reference":"f".repeat(64),"archiveGeneration":"generation","expiresAt":1900000000000u64}),
                        &format!(
                            "Set-Cookie: mediflow_auth_control={}; Path=/; HttpOnly\r\nETag: \"{}\"\r\n",
                            "b".repeat(64),
                            "c".repeat(64)
                        ),
                    );
                } else if step == 1 {
                    assert!(request.starts_with("GET /api/auth/check "));
                    assert!(!lower.contains("mediflow_session="));
                    assert!(!lower.contains("x-mediflow-paired-client-token:"));
                    bootstrap_reply(
                        &mut stream,
                        200,
                        &serde_json::json!({"status":"ok","isSetup":true,"archiveGeneration":"generation","unlock":{"credential":"passphrase","kdfVersion":3,"salt":"AwMDAwMDAwMDAwMDAwMDAw=="}}),
                        &format!("ETag: \"{}\"\r\n", "c".repeat(64)),
                    );
                } else if step == 2 {
                    assert!(request.starts_with("POST /api/auth/login "));
                    assert!(!lower.contains("mediflow_session="));
                    assert!(lower.contains("if-match:"));
                    assert!(lower.contains("idempotency-key:"));
                    let body: Value =
                        serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
                    assert_eq!(body.as_object().unwrap().len(), 2);
                    assert!(body["verifier"].as_str().is_some_and(|v| !v.is_empty()));
                    assert!(!request.contains("Synthetic scales fixture passphrase"));
                    bootstrap_reply(
                        &mut stream,
                        200,
                        &serde_json::json!({"success":true,"id":"operator","username":"synthetic","role":"admin","archiveGeneration":"generation"}),
                        &format!(
                            "Set-Cookie: mediflow_session={}; Path=/; HttpOnly\r\n",
                            "d".repeat(64)
                        ),
                    );
                } else {
                    assert!(request.starts_with("POST /api/auth/ambulatory-bootstrap/retire "));
                    assert!(lower.contains(&format!("mediflow_session={}", "d".repeat(64))));
                    assert!(!lower.contains(&format!("mediflow_session={}", "a".repeat(64))));
                    bootstrap_reply(&mut stream, 204, &Value::Null, "");
                }
            }
        });
        let user = RuntimeUser {
            id: "operator".into(),
            username: "synthetic".into(),
            display_name: None,
            role: "admin".into(),
            archive_generation: "generation".into(),
        };
        let flow = HostBootstrapSession::authenticate(
            client,
            &user,
            &PairingCredentials::new("synthetic-device", "x".repeat(64)).unwrap(),
            &"a".repeat(64),
            draft,
            "Synthetic scales fixture passphrase",
        )
        .unwrap();
        flow.cancel_local();
        assert_eq!(flow.retire(), Ok(()));
        worker.join().unwrap();
    }
    #[test]
    fn bootstrap_lost_response_never_resends_and_readback_is_only_observed_state() {
        use std::{net::TcpListener, thread};
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let draft = FirstAmbulatoryDraft::new("Sede inventata".into(), None, None).unwrap();
        let observed = draft.clone();
        let worker = thread::spawn(move || {
            let (mut stream, _) = crate::test_loopback::accept(&listener).unwrap();
            assert!(
                bootstrap_request(&mut stream).starts_with("POST /api/auth/ambulatory-bootstrap ")
            );
            drop(stream);
            let (mut stream, _) = crate::test_loopback::accept(&listener).unwrap();
            assert!(
                bootstrap_request(&mut stream).starts_with("GET /api/auth/ambulatory-bootstrap ")
            );
            bootstrap_reply(&mut stream, 200, &bootstrap_observation(&observed), "");
            listener
        });
        let flow = bootstrap_test_session(url.clone(), draft.clone());
        assert_eq!(flow.commit(), Err(RuntimeError::Indeterminate));
        assert_eq!(flow.commit(), Err(RuntimeError::ReadRequired));
        let fresh = bootstrap_test_session(url, draft.clone());
        assert_eq!(fresh.readback(), Ok(draft.id));
        let listener = worker.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(crate::test_loopback::accept(&listener).is_err());
    }
    #[test]
    fn bootstrap_readback_divergence_and_redirect_never_confirm_or_follow() {
        use std::{net::TcpListener, thread};
        for redirect in [false, true] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let draft = FirstAmbulatoryDraft::new("Sede inventata".into(), None, None).unwrap();
            let observed = draft.clone();
            let worker = thread::spawn(move || {
                let (mut stream, _) = crate::test_loopback::accept(&listener).unwrap();
                bootstrap_request(&mut stream);
                let mut body = bootstrap_observation(&observed);
                body["version"] = serde_json::json!(2);
                bootstrap_reply(
                    &mut stream,
                    if redirect { 302 } else { 200 },
                    &body,
                    "Location: http://127.0.0.1:1/leak\r\n",
                );
            });
            let flow = bootstrap_test_session(url, draft);
            assert_eq!(
                flow.readback(),
                Err(if redirect {
                    RuntimeError::Rejected(302)
                } else {
                    RuntimeError::InvalidResponse
                })
            );
            worker.join().unwrap();
        }
        let remote = RuntimeClient::new(RuntimeConfig {
            base_url: "https://example.invalid".into(),
            tls_pin_sha256: Some("a".repeat(64)),
        })
        .unwrap();
        assert!(!remote.is_local_bootstrap_origin());
        assert_eq!(
            remote
                .dedicated_web_raw(
                    Method::GET,
                    &["api", "auth", "check"],
                    HeaderMap::new(),
                    None,
                    false
                )
                .err(),
            Some(RuntimeError::Forbidden)
        );
    }
    #[test]
    fn bootstrap_cancel_after_dispatch_is_indeterminate_and_cannot_rearm() {
        use std::{
            net::TcpListener,
            sync::{Arc, mpsc},
            thread,
        };
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (started, receive) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = crate::test_loopback::accept(&listener).unwrap();
            bootstrap_request(&mut stream);
            started.send(()).unwrap();
            wait.recv_timeout(Duration::from_secs(5)).unwrap();
        });
        let flow = Arc::new(bootstrap_test_session(
            url,
            FirstAmbulatoryDraft::new("Sede inventata".into(), None, None).unwrap(),
        ));
        let pending = flow.clone();
        let call = thread::spawn(move || pending.commit());
        receive.recv_timeout(Duration::from_secs(5)).unwrap();
        flow.cancel_local();
        assert_eq!(call.join().unwrap(), Err(RuntimeError::Indeterminate));
        assert_eq!(flow.commit(), Err(RuntimeError::ReadRequired));
        release.send(()).unwrap();
        server.join().unwrap();
    }
    fn synthetic_conflict(path: &[&str], mutation: bool, body: &str, framing: &str) -> Result<()> {
        use std::{io::Write, net::TcpListener, thread};
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let client = RuntimeClient::new(RuntimeConfig {
            base_url: format!("http://{}", listener.local_addr().unwrap()),
            tls_pin_sha256: None,
        })
        .unwrap();
        let response = format!("HTTP/1.1 409 Conflict\r\n{framing}Connection: close\r\n\r\n{body}");
        let worker = thread::spawn(move || {
            let (mut stream, _) = crate::test_loopback::accept(&listener).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut headers = Vec::new();
            let mut byte = [0];
            while !headers.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                headers.push(byte[0]);
                assert!(headers.len() < 8192);
            }
            let _ = stream.write_all(response.as_bytes());
            listener
        });
        let result = client.raw(
            if mutation { Method::PUT } else { Method::GET },
            path,
            &[],
            None,
            &PairingCredentials::new("synthetic-device", "x".repeat(64)).unwrap(),
            Some(&"a".repeat(64)),
            None,
            mutation,
            128,
            Some("synthetic-generation"),
        );
        let listener = worker.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            matches!(crate::test_loopback::accept(&listener), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
        result.map(|_| ())
    }

    #[test]
    fn archive_replaced_is_recognized_on_every_route_and_method() {
        for path in [
            &["api", "v1", "network", "patients", "patient-a"][..],
            crate::analytics::DEMOGRAPHICS_PATH,
            crate::account_profile::ACCOUNT_PROFILE_PATH,
        ] {
            for mutation in [false, true] {
                assert_eq!(
                    synthetic_conflict(
                        path,
                        mutation,
                        r#"{"code":"ARCHIVE_REPLACED","error":"private synthetic detail"}"#,
                        ""
                    ),
                    Err(RuntimeError::ArchiveReplaced),
                );
            }
        }
    }

    #[test]
    fn other_conflict_codes_keep_their_route_and_mutation_semantics() {
        for path in [
            &["api", "v1", "network", "patients", "patient-a"][..],
            crate::analytics::DEMOGRAPHICS_PATH,
            crate::account_profile::ACCOUNT_PROFILE_PATH,
        ] {
            for mutation in [false, true] {
                for code in [
                    "VERSION_CONFLICT",
                    "PROFILE_VERSION_CONFLICT",
                    "ANALYTICS_CANCELLED",
                ] {
                    let expected = match code {
                        "PROFILE_VERSION_CONFLICT"
                            if mutation && path == crate::account_profile::ACCOUNT_PROFILE_PATH =>
                        {
                            Ok(())
                        }
                        "ANALYTICS_CANCELLED"
                            if !mutation && path == crate::analytics::DEMOGRAPHICS_PATH =>
                        {
                            Err(RuntimeError::AnalyticsCancelled)
                        }
                        _ => Err(RuntimeError::Conflict),
                    };
                    assert_eq!(
                        synthetic_conflict(path, mutation, &format!(r#"{{"code":"{code}"}}"#), ""),
                        expected,
                    );
                }
            }
        }
    }

    #[test]
    fn malformed_conflict_bodies_never_become_successes() {
        for path in [
            &["api", "v1", "network", "patients", "patient-a"][..],
            crate::analytics::DEMOGRAPHICS_PATH,
            crate::account_profile::ACCOUNT_PROFILE_PATH,
        ] {
            for mutation in [false, true] {
                for body in [
                    "",
                    "not json",
                    r#"{"code":"ARCHIVE_REPLACED""#,
                    r#"{"code":null}"#,
                    r#"{"error":"ARCHIVE_REPLACED"}"#,
                ] {
                    assert_eq!(
                        synthetic_conflict(path, mutation, body, ""),
                        Err(RuntimeError::Conflict)
                    );
                }
            }
        }
    }

    #[test]
    fn unreadable_and_oversized_conflict_bodies_keep_the_existing_fallbacks() {
        for path in [
            &["api", "v1", "network", "patients", "patient-a"][..],
            crate::analytics::DEMOGRAPHICS_PATH,
            crate::account_profile::ACCOUNT_PROFILE_PATH,
        ] {
            for mutation in [false, true] {
                for (body, framing, read_error) in [
                    (
                        r#"{"code":"ARCHIVE_REPLACED"}"#.to_owned(),
                        "Content-Length: 100\r\n",
                        RuntimeError::Transport,
                    ),
                    (
                        String::new(),
                        "Content-Length: 2048\r\n",
                        RuntimeError::TooLarge,
                    ),
                    (
                        format!(
                            r#"{{"code":"ARCHIVE_REPLACED","error":"{}"}}"#,
                            "x".repeat(2048)
                        ),
                        "",
                        RuntimeError::TooLarge,
                    ),
                ] {
                    let expected = if path == crate::account_profile::ACCOUNT_PROFILE_PATH {
                        if mutation {
                            RuntimeError::Indeterminate
                        } else {
                            read_error
                        }
                    } else {
                        RuntimeError::Conflict
                    };
                    assert_eq!(
                        synthetic_conflict(path, mutation, &body, framing),
                        Err(expected)
                    );
                }
            }
        }
    }

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
