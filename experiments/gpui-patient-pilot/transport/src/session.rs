use crate::{
    account_profile::{
        ACCOUNT_PROFILE_LIMIT, ACCOUNT_PROFILE_PATH, AccountProfileRead, AccountProfileSnapshot,
        AccountProfileUpdate, AccountProfileUpdateOutcome,
        parse_conflict as parse_account_profile_conflict, parse_read as parse_account_profile_read,
        parse_update as parse_account_profile_update,
    },
    ai_preferences::{
        AI_PREFERENCES_LIMIT, AI_PREFERENCES_PATH, AI_PREVIEW_PATH, parse_preferences,
        parse_preferences_preview,
    },
    analytics::{
        DEMOGRAPHICS_PATH, POPULATION_DEMOGRAPHICS_CAPABILITY, POPULATION_DEMOGRAPHICS_MAX_BYTES,
        parse_demographics,
    },
    crypto::{self, MasterKey},
    http::{DOCUMENT_LIMIT, JSON_LIMIT},
    profile_query::{ProfileLease, display_profile, parse_profile_response},
    scales::{
        SCALE_CATALOG_LIMIT, SCALE_PREPARATION_LIMIT, SCALE_REQUEST_LIMIT,
        parse_catalog as parse_scale_catalog, parse_preparation as parse_scale_preparation,
    },
    *,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use reqwest::Method;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::time::Instant;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use zeroize::Zeroizing;

/// An opaque shared session. Clones share lock, key custody and duplicate-send gate.
#[derive(Clone)]
pub struct RuntimeSession {
    inner: Arc<SessionInner>,
    context: RequestContext,
}
struct SessionInner {
    client: RuntimeClient,
    user: RuntimeUser,
    closed: AtomicBool,
    retirement: Mutex<Option<RuntimeError>>,
    writing: AtomicBool,
    read_epoch: AtomicU64,
    secrets: Mutex<SessionSecrets>,
    reads: Mutex<HashMap<ReadKey, ReadReceipt>>,
    profile_reads: Mutex<HashMap<ReadKey, ProfileLease>>,
    profile_selection: Mutex<Option<Arc<ProfileSelection>>>,
    scopes: Mutex<HashSet<String>>,
    capabilities: Mutex<HashSet<String>>,
}
struct SessionSecrets {
    pairing: Option<PairingCredentials>,
    cookie: Option<Zeroizing<String>>,
    master: Option<MasterKey>,
}
#[derive(Hash, PartialEq, Eq)]
struct ReadKey {
    scope: String,
    patient: String,
    domain: String,
    id: String,
}
struct ProfileSelection {
    target: Mutex<ProfileSelectionTarget>,
    host_epoch: AtomicU64,
}
enum ProfileSelectionTarget {
    Patient { scope: String, patient: String },
    Creating { scope: String },
}
#[derive(Clone)]
struct ProfileReadBinding {
    selection: Weak<ProfileSelection>,
    selection_epoch: u64,
    deadline: Instant,
}
struct ReadReceipt {
    profile: Option<ProfileReadBinding>,
    version: u64,
    locked: Vec<String>,
}
struct ReadResponse {
    value: Value,
    epoch: u64,
}
#[derive(Clone)]
pub struct ProfileQueryIntent {
    owner: Weak<SessionInner>,
    active: Arc<Mutex<bool>>,
    context: RequestContext,
    selection: Option<Arc<ProfileSelection>>,
    // Only a patient write captures this consumed preread; read intents do not.
    write_binding: Option<ProfileReadBinding>,
}
impl ProfileQueryIntent {
    pub fn cancel(&self) {
        self.context.cancel();
        if let Ok(mut active) = self.active.lock() {
            *active = false;
        }
    }
}

/// A local cancellation fence for one settings context, bound to this exact
/// session. It conveys no host permission and never contains a grant.
#[derive(Clone)]
pub struct AiPreferencesContext {
    owner: Weak<SessionInner>,
    active: Arc<AtomicBool>,
    context: RequestContext,
}
impl AiPreferencesContext {
    pub fn cancel(&self) {
        self.context.cancel();
        self.active.store(false, Ordering::Release);
    }
}

struct WriteGuard<'a>(&'a AtomicBool);
impl Drop for WriteGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Private closed routing for the typed, read-only catalog API. These values
/// cannot select another origin, HTTP method, clinical route or credential.
pub(crate) enum CatalogRoute {
    Drugs,
    Exemptions,
    TerminologySystems,
    TerminologySearch,
    TerminologyResolve,
    WhoReadiness,
    WhoSearch,
}
impl CatalogRoute {
    fn path(&self) -> &'static [&'static str] {
        match self {
            Self::Drugs => &["api", "v1", "network", "drugs"],
            Self::Exemptions => &["api", "v1", "network", "exemptions"],
            Self::TerminologySystems => &["api", "v1", "network", "terminology", "systems"],
            Self::TerminologySearch => &["api", "v1", "network", "terminology", "search"],
            Self::TerminologyResolve => &["api", "v1", "network", "terminology", "resolve"],
            Self::WhoReadiness => crate::who::READINESS_PATH,
            Self::WhoSearch => &["api", "v1", "network", "terminology", "who", "search"],
        }
    }
    fn allows_query(&self, key: &str) -> bool {
        match self {
            Self::Drugs => matches!(key, "q" | "limit" | "count"),
            Self::Exemptions => matches!(key, "q" | "limit" | "count" | "codes"),
            Self::TerminologySystems => false,
            Self::TerminologySearch => matches!(key, "q" | "system" | "limit"),
            Self::TerminologyResolve => matches!(key, "system" | "code"),
            Self::WhoReadiness => false,
            Self::WhoSearch => key == "q",
        }
    }
    fn response_limit(&self) -> usize {
        match self {
            Self::WhoReadiness | Self::WhoSearch => crate::who::WHO_LIMIT,
            _ => JSON_LIMIT,
        }
    }
}

impl RuntimeSession {
    pub(crate) fn new(
        client: RuntimeClient,
        user: RuntimeUser,
        pairing: PairingCredentials,
        cookie: Zeroizing<String>,
        master: MasterKey,
    ) -> Self {
        let context = client.request_context();
        Self {
            inner: Arc::new(SessionInner {
                client,
                user,
                closed: AtomicBool::new(false),
                retirement: Mutex::new(None),
                writing: AtomicBool::new(false),
                read_epoch: AtomicU64::new(0),
                secrets: Mutex::new(SessionSecrets {
                    pairing: Some(pairing),
                    cookie: Some(cookie),
                    master: Some(master),
                }),
                reads: Mutex::new(HashMap::new()),
                profile_reads: Mutex::new(HashMap::new()),
                profile_selection: Mutex::new(None),
                scopes: Mutex::new(HashSet::new()),
                capabilities: Mutex::new(HashSet::new()),
            }),
            context,
        }
    }
    fn retire_result<T>(&self, result: Result<T>) -> Result<T> {
        if let Err(error) = &result
            && error.retires_session()
        {
            self.retire(*error);
        }
        result
    }

    pub fn request_context(&self) -> RequestContext {
        self.context.clone()
    }

    pub fn renew_requests(&mut self) {
        self.context = self.context.next_selection();
    }

    pub fn user(&self) -> &RuntimeUser {
        &self.inner.user
    }
    pub fn base_url(&self) -> &str {
        self.inner.client.base_url()
    }
    pub fn is_locked(&self) -> bool {
        self.inner.closed.load(Ordering::Acquire)
    }

    /// Discovery is a display hint from the server's paired-grant projection.
    /// Every operation still passes current server admission; this grants nothing.
    pub fn can_write(&self, capability: &str) -> bool {
        !self.is_locked()
            && self
                .inner
                .capabilities
                .lock()
                .is_ok_and(|capabilities| capabilities.contains(capability))
    }
    /// Discovery hint for offering the complete Scale action. The host still
    /// admits every current write and read; this does not grant either capability.
    pub fn can_record_scale(&self) -> bool {
        self.can_write("network.replica.write-clinical-diary")
            && self.can_write("network.replica.readonly-clinical-diary")
    }
    pub fn refresh_capabilities(&self) -> Result<()> {
        let response =
            self.read_json(None, &["api", "v1", "network", "capabilities"], JSON_LIMIT)?;
        crate::ports::negotiate_host_ports(&response.value["hostPorts"])?;
        let version = response.value["protocolVersion"]
            .as_str()
            .ok_or(RuntimeError::InvalidResponse)?;
        let parts: Vec<_> = version.split('.').collect();
        if parts.len() != 3
            || parts[0] != "1"
            || parts[1].parse::<u64>().ok().is_none_or(|minor| minor < 13)
            || parts[2].parse::<u64>().is_err()
        {
            return Err(RuntimeError::UnsupportedProtocol);
        }
        if response.value["operatingMode"] != "network-home-base" {
            return Err(RuntimeError::Forbidden);
        }
        let values = response.value["capabilities"]
            .as_array()
            .ok_or(RuntimeError::InvalidResponse)?;
        let mut granted = HashSet::new();
        for capability in values {
            let key = capability["key"]
                .as_str()
                .ok_or(RuntimeError::InvalidResponse)?;
            if capability["requiresPairing"] == true
                && capability["status"] == "available"
                && (key.starts_with("network.replica.write-")
                    || key == "network.replica.readonly-clinical-diary"
                    || key == POPULATION_DEMOGRAPHICS_CAPABILITY
                    || key == "network.ambulatories.write")
            {
                granted.insert(key.to_owned());
            }
        }
        self.check_read_epoch(response.epoch)?;
        *self
            .inner
            .capabilities
            .lock()
            .map_err(|_| RuntimeError::Locked)? = granted;
        Ok(())
    }

    pub fn retirement_error(&self) -> Option<RuntimeError> {
        self.inner.retirement.lock().ok().and_then(|reason| *reason)
    }

    /// Immediately fences all clones and discards the unlock key. Already sent
    /// writes still require server reconciliation; lock does not undo a commit.
    /// The opaque cookie/device secret remain only for bounded remote logout.
    pub fn lock(&self) {
        self.retire(RuntimeError::Locked);
    }

    fn retire(&self, error: RuntimeError) {
        if let Ok(mut reason) = self.inner.retirement.lock()
            && (reason.is_none() || error == RuntimeError::ArchiveReplaced)
        {
            *reason = Some(error);
        }
        self.inner.closed.store(true, Ordering::Release);
        self.context.revoke();
        if let Ok(mut secrets) = self.inner.secrets.lock() {
            secrets.master.take();
        }
        self.clear_profile_selection();
        if let Ok(mut reads) = self.inner.reads.lock() {
            reads.clear();
        }
        if let Ok(mut profiles) = self.inner.profile_reads.lock() {
            profiles.clear();
        }
        if let Ok(mut scopes) = self.inner.scopes.lock() {
            scopes.clear();
        }
        if let Ok(mut capabilities) = self.inner.capabilities.lock() {
            capabilities.clear();
        }
    }

    /// Local lock always completes, including when server retirement is unknown.
    pub fn logout(&self) -> Result<()> {
        self.lock();
        let (pairing, cookie) = {
            let mut secrets = self
                .inner
                .secrets
                .lock()
                .map_err(|_| RuntimeError::Locked)?;
            (secrets.pairing.take(), secrets.cookie.take())
        };
        match (pairing, cookie) {
            (Some(pairing), Some(cookie)) => self
                .inner
                .client
                .with_request_context(RequestContext::default())
                .raw(
                    Method::POST,
                    &["api", "auth", "native", "logout"],
                    &[],
                    None,
                    &pairing,
                    Some(&cookie),
                    None,
                    true,
                    JSON_LIMIT,
                    Some(&self.inner.user.archive_generation),
                )
                .map(|_| ()),
            _ => Ok(()),
        }
    }

    fn credentials(&self) -> Result<(PairingCredentials, Zeroizing<String>)> {
        let secrets = self
            .inner
            .secrets
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        self.ensure_open()?;
        let pairing = secrets.pairing.as_ref().ok_or(RuntimeError::Locked)?;
        let credentials = (
            PairingCredentials {
                id: pairing.id.clone(),
                token: Zeroizing::new(pairing.token.to_string()),
            },
            Zeroizing::new(
                secrets
                    .cookie
                    .as_ref()
                    .ok_or(RuntimeError::Locked)?
                    .to_string(),
            ),
        );
        drop(secrets);
        self.ensure_open()?;
        Ok(credentials)
    }

    fn ensure_open(&self) -> Result<()> {
        self.context.check()?;
        if self.is_locked() {
            Err(RuntimeError::Locked)
        } else {
            Ok(())
        }
    }
    #[allow(clippy::too_many_arguments)]
    fn request(
        &self,
        method: Method,
        path: &[&str],
        query: &[(&str, &str)],
        scope: Option<&str>,
        body: Option<&Value>,
        mutation: bool,
        limit: usize,
    ) -> Result<Value> {
        self.request_with_profile_intent(method, path, query, scope, body, mutation, limit, None)
    }

    #[allow(clippy::too_many_arguments)]
    fn request_with_profile_intent(
        &self,
        method: Method,
        path: &[&str],
        query: &[(&str, &str)],
        scope: Option<&str>,
        body: Option<&Value>,
        mutation: bool,
        limit: usize,
        intent: Option<&ProfileQueryIntent>,
    ) -> Result<Value> {
        self.ensure_open()?;
        let context = intent
            .map(|intent| &intent.context)
            .unwrap_or(&self.context);
        context.check()?;
        if let Some(intent) = intent {
            drop(self.profile_intent_guard(intent)?);
        }
        if let Some(scope) = scope {
            validate_scope_id(scope)?;
        }
        let (pairing, cookie) = self.credentials()?;
        if let Some(scope) = scope {
            if !self
                .inner
                .scopes
                .lock()
                .map_err(|_| RuntimeError::Locked)?
                .contains(scope)
            {
                return Err(RuntimeError::Forbidden);
            }
            // Negotiate the per-request scope assertion before accessing data.
            // An older host may ignore the header, so identity equality alone
            // cannot admit a subsequent scoped operation.
            let identity = self
                .inner
                .client
                .with_request_context(context.clone())
                .json(
                    Method::GET,
                    &["api", "v1", "network", "identity"],
                    &[],
                    Some(scope),
                    &pairing,
                    &cookie,
                    None,
                    false,
                    JSON_LIMIT,
                    Some(&self.inner.user.archive_generation),
                );
            if let Err(error) = identity.as_ref()
                && error.retires_session()
            {
                self.retire(*error);
            }
            let identity = identity?;
            require_bound_scope_identity(&identity, scope, &self.inner.user.id)?;
            self.ensure_open()?;
        }
        if let Some(intent) = intent {
            drop(self.profile_intent_guard(intent)?);
            if let Some(binding) = &intent.write_binding {
                // Identity negotiation may outlive the consumed preread. Recheck
                // its original deadline and host epoch immediately before PUT.
                self.check_profile_write_binding(binding)?;
            }
        }
        let result = self
            .inner
            .client
            .with_request_context(context.clone())
            .json(
                method,
                path,
                query,
                scope,
                &pairing,
                &cookie,
                body,
                mutation,
                limit,
                Some(&self.inner.user.archive_generation),
            );
        if self.is_locked() {
            return Err(if mutation {
                RuntimeError::Indeterminate
            } else {
                RuntimeError::Locked
            });
        }
        if let Err(error) = result.as_ref()
            && error.retires_session()
        {
            self.retire(*error);
            // Host authentication failure must retire every presentation, even
            // when locking has also cancelled the associated profile intent.
            return result;
        }
        if let Some(intent) = intent
            && self.profile_intent_guard(intent).is_err()
        {
            return Err(if mutation {
                RuntimeError::Indeterminate
            } else {
                RuntimeError::ReadRequired
            });
        }
        result
    }

    fn read_json(&self, scope: Option<&str>, path: &[&str], limit: usize) -> Result<ReadResponse> {
        self.read_json_query(scope, path, &[], limit)
    }
    fn read_json_query(
        &self,
        scope: Option<&str>,
        path: &[&str],
        query: &[(&str, &str)],
        limit: usize,
    ) -> Result<ReadResponse> {
        let epoch = self.inner.read_epoch.load(Ordering::Acquire);
        self.check_read_epoch(epoch)?;
        let value = self.request(Method::GET, path, query, scope, None, false, limit)?;
        self.check_read_epoch(epoch)?;
        Ok(ReadResponse { value, epoch })
    }

    pub(crate) fn read_catalog<T: DeserializeOwned>(
        &self,
        scope: &str,
        route: CatalogRoute,
        query: &[(&str, &str)],
    ) -> Result<T> {
        if query.iter().any(|(key, _)| !route.allows_query(key)) {
            return Err(RuntimeError::InvalidInput);
        }
        let response =
            self.read_json_query(Some(scope), route.path(), query, route.response_limit())?;
        let value = decode(response.value)?;
        self.check_read_epoch(response.epoch)?;
        Ok(value)
    }
    fn check_read_epoch(&self, epoch: u64) -> Result<()> {
        self.ensure_open()?;
        if self.inner.read_epoch.load(Ordering::Acquire) != epoch
            || self.inner.writing.load(Ordering::Acquire)
        {
            return Err(RuntimeError::ReadRequired);
        }
        Ok(())
    }

    /// Host configuration via the existing paired discovery route. No patient
    /// query, configuration grant, inference request or writer receipt is used.
    pub fn read_ai_runtime_status(&self) -> Result<AiRuntimeStatus> {
        let response = self.read_json(None, &["api", "v1", "network", "ai-runtime"], 32 * 1024)?;
        let status = parse_ai_runtime_status(response.value)?;
        self.check_read_epoch(response.epoch)?;
        Ok(status)
    }

    pub fn ai_preferences_context(&self) -> AiPreferencesContext {
        AiPreferencesContext {
            owner: Arc::downgrade(&self.inner),
            active: Arc::new(AtomicBool::new(true)),
            context: self.context.child(),
        }
    }
    fn check_ai_preferences_context(&self, context: &AiPreferencesContext) -> Result<()> {
        self.ensure_open()?;
        if !context.owner.ptr_eq(&Arc::downgrade(&self.inner))
            || !context.active.load(Ordering::Acquire)
        {
            return Err(RuntimeError::ReadRequired);
        }
        // A display hint cannot grant this operation. The named host route
        // rechecks the current role, pairing, session and explicit grant.
        if self.user().role != "admin" {
            return Err(RuntimeError::Forbidden);
        }
        Ok(())
    }
    fn request_ai_preferences(
        &self,
        context: &AiPreferencesContext,
        method: Method,
        path: &[&str],
        body: Option<&Value>,
        mutation: bool,
    ) -> Result<Value> {
        self.check_ai_preferences_context(context)?;
        let contextual = Self {
            inner: self.inner.clone(),
            context: context.context.clone(),
        };
        let result = contextual.request(
            method,
            path,
            &[],
            None,
            body,
            mutation,
            AI_PREFERENCES_LIMIT,
        );
        // request() retires a session rejected by the host. Preserve that
        // signal so the window clears its context and returns to login.
        if result.as_ref().is_err_and(|error| error.retires_session()) {
            return result;
        }
        if self.check_ai_preferences_context(context).is_err() {
            return Err(if mutation {
                RuntimeError::Indeterminate
            } else if self.is_locked() {
                RuntimeError::Locked
            } else {
                RuntimeError::ReadRequired
            });
        }
        result
    }
    pub fn read_ai_preferences(
        &self,
        context: &AiPreferencesContext,
    ) -> Result<AiFunctionPreferences> {
        let epoch = self.inner.read_epoch.load(Ordering::Acquire);
        self.check_read_epoch(epoch)?;
        let result = parse_preferences(self.request_ai_preferences(
            context,
            Method::GET,
            AI_PREFERENCES_PATH,
            None,
            false,
        )?)?;
        self.check_read_epoch(epoch)?;
        Ok(result)
    }
    pub fn preview_ai_preferences(
        &self,
        context: &AiPreferencesContext,
        command: &AiPreferencesCommand,
    ) -> Result<AiPreferencesPreview> {
        let epoch = self.inner.read_epoch.load(Ordering::Acquire);
        self.check_read_epoch(epoch)?;
        let value = self.request_ai_preferences(
            context,
            Method::POST,
            AI_PREVIEW_PATH,
            Some(&command.wire()?),
            false,
        )?;
        let result = parse_preferences_preview(value, command)?;
        self.check_read_epoch(epoch)?;
        Ok(result)
    }
    /// A separate user confirmation sends the exact preview command once, then
    /// rereads the existing host route. No retry, clinical writer or inference.
    pub fn apply_ai_preferences(
        &self,
        context: &AiPreferencesContext,
        preview: &AiPreferencesPreview,
    ) -> Result<AiPreferencesReadback> {
        self.check_ai_preferences_context(context)?;
        let _guard = self.begin_write()?;
        let applied = self.request_ai_preferences(
            context,
            Method::POST,
            AI_PREFERENCES_PATH,
            Some(&preview.command().wire()?),
            true,
        )?;
        let applied = parse_preferences(applied).map_err(|_| RuntimeError::Indeterminate)?;
        // In particular, do not start another request after lock/navigation.
        self.check_ai_preferences_context(context)
            .map_err(|_| RuntimeError::Indeterminate)?;
        let observed =
            self.request_ai_preferences(context, Method::GET, AI_PREFERENCES_PATH, None, false)?;
        let observed = parse_preferences(observed).map_err(|_| RuntimeError::Indeterminate)?;
        Ok(AiPreferencesReadback {
            matches_confirmation: applied == preview.proposed && observed == applied,
            observed,
        })
    }

    /// ADR 0155 read. The response is closed to the eight documented fields and
    /// its subject must be this exact session user.
    pub fn read_account_profile(&self) -> Result<AccountProfileRead> {
        let epoch = self.inner.read_epoch.load(Ordering::Acquire);
        self.check_read_epoch(epoch)?;
        let response = self.read_json(None, ACCOUNT_PROFILE_PATH, ACCOUNT_PROFILE_LIMIT)?;
        let profile = self.retire_result(parse_account_profile_read(
            response.value,
            &self.inner.user.id,
            &self.inner.user.archive_generation,
        ))?;
        self.check_read_epoch(response.epoch)?;
        Ok(profile)
    }

    /// ADR 0155 conditional update. The body is built only by the closed command
    /// type, so the retired version-less PUT is unreachable. A 409 conflict
    /// returns the host's current values without any retry; an archive
    /// replacement stays a distinct error.
    pub fn update_account_profile(
        &self,
        snapshot: &AccountProfileSnapshot,
        display_name: Option<&str>,
        ambulatory_name: Option<&str>,
    ) -> Result<AccountProfileUpdateOutcome> {
        self.ensure_open()?;
        let body = AccountProfileUpdate::new(snapshot, display_name, ambulatory_name)?;
        let encoded = serde_json::to_vec(&body.wire()).map_err(|_| RuntimeError::InvalidInput)?;
        let _guard = self.begin_write()?;
        let (pairing, cookie) = self.credentials()?;
        let result = self
            .inner
            .client
            .with_request_context(self.context.clone())
            .raw(
                Method::PUT,
                ACCOUNT_PROFILE_PATH,
                &[],
                None,
                &pairing,
                Some(&cookie),
                Some(&encoded),
                true,
                ACCOUNT_PROFILE_LIMIT,
                Some(&self.inner.user.archive_generation),
            );
        if self.is_locked() {
            return Err(RuntimeError::Indeterminate);
        }
        let response = match result {
            Ok(response) => response,
            Err(error) if error.retires_session() => {
                self.retire(error);
                return Err(error);
            }
            Err(error) => return Err(error),
        };
        let value: Value =
            serde_json::from_slice(&response.body).map_err(|_| RuntimeError::Indeterminate)?;
        self.retire_result(match response.status {
            200..=299 => parse_account_profile_update(
                value,
                &self.inner.user.id,
                &self.inner.user.archive_generation,
            )
            .map_err(|error| match error {
                // A snapshot from another archive is never a confirmed save,
                // but it must stay distinguishable from an unknown outcome.
                RuntimeError::ArchiveReplaced => RuntimeError::ArchiveReplaced,
                _ => RuntimeError::Indeterminate,
            }),
            409 => parse_account_profile_conflict(
                value,
                &self.inner.user.id,
                &self.inner.user.archive_generation,
            )
            .map(|current| AccountProfileUpdateOutcome::VersionConflict { current })
            .map_err(|error| match error {
                RuntimeError::ArchiveReplaced => RuntimeError::ArchiveReplaced,
                _ => RuntimeError::Indeterminate,
            }),
            _ => Err(RuntimeError::Indeterminate),
        })
    }

    pub fn list_ambulatories(&self) -> Result<Vec<Ambulatory>> {
        let response =
            self.read_json(None, &["api", "v1", "network", "ambulatories"], JSON_LIMIT)?;
        let rows: Vec<Ambulatory> = decode(response.value)?;
        for row in &rows {
            validate_scope_id(&row.id).map_err(|_| RuntimeError::InvalidResponse)?;
            valid_wire_version(row.version)?;
        }
        self.check_read_epoch(response.epoch)?;
        *self.inner.scopes.lock().map_err(|_| RuntimeError::Locked)? =
            rows.iter().map(|row| row.id.clone()).collect();
        Ok(rows)
    }

    pub fn list_patients(&self, scope: &str, archived: bool) -> Result<Vec<PatientSummary>> {
        let response = self.read_json(
            Some(scope),
            &["api", "v1", "network", "patients"],
            JSON_LIMIT,
        )?;
        let mut rows: Vec<PatientSummary> = decode(response.value)?;
        for row in &rows {
            valid_wire_id(&row.id)?;
            valid_wire_version(row.version)?;
        }
        rows.retain(|row| row.deleted_at.is_none() && row.is_archived == archived);
        self.check_read_epoch(response.epoch)?;
        Ok(rows)
    }

    fn select_profile_target(&self, target: ProfileSelectionTarget) -> Result<()> {
        self.ensure_open()?;
        let mut current = self
            .inner
            .profile_selection
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        self.ensure_open()?;
        self.inner
            .reads
            .lock()
            .map_err(|_| RuntimeError::Locked)?
            .retain(|key, _| key.domain != "patients");
        self.inner
            .profile_reads
            .lock()
            .map_err(|_| RuntimeError::Locked)?
            .clear();
        *current = Some(Arc::new(ProfileSelection {
            target: Mutex::new(target),
            host_epoch: AtomicU64::new(0),
        }));
        Ok(())
    }

    pub fn select_profile_patient(&self, scope: &str, patient: &str) -> Result<()> {
        validate_scope_id(scope)?;
        validate_id(patient)?;
        self.select_profile_target(ProfileSelectionTarget::Patient {
            scope: scope.to_owned(),
            patient: patient.to_owned(),
        })
    }

    pub fn begin_profile_creation(&self, scope: &str) -> Result<()> {
        validate_scope_id(scope)?;
        self.select_profile_target(ProfileSelectionTarget::Creating {
            scope: scope.to_owned(),
        })
    }

    pub fn clear_profile_selection(&self) {
        if let Ok(mut current) = self.inner.profile_selection.lock() {
            current.take();
            if let Ok(mut reads) = self.inner.reads.lock() {
                reads.retain(|key, _| key.domain != "patients");
            }
            if let Ok(mut profiles) = self.inner.profile_reads.lock() {
                profiles.clear();
            }
        }
    }

    pub fn bind_created_profile(
        &self,
        scope: &str,
        patient: &str,
        intent: &ProfileQueryIntent,
    ) -> Result<()> {
        validate_scope_id(scope)?;
        validate_id(patient)?;
        let _intent = self.profile_intent_guard(intent)?;
        let current = self
            .inner
            .profile_selection
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        let selected = current.as_ref().ok_or(RuntimeError::ReadRequired)?;
        if intent
            .selection
            .as_ref()
            .is_none_or(|selection| !Arc::ptr_eq(selection, selected))
        {
            return Err(RuntimeError::ReadRequired);
        }
        let mut target = selected.target.lock().map_err(|_| RuntimeError::Locked)?;
        if !matches!(&*target, ProfileSelectionTarget::Creating { scope: expected } if expected == scope)
        {
            return Err(RuntimeError::ReadRequired);
        }
        *target = ProfileSelectionTarget::Patient {
            scope: scope.to_owned(),
            patient: patient.to_owned(),
        };
        Ok(())
    }

    fn profile_target_matches(
        &self,
        intent: &ProfileQueryIntent,
        scope: &str,
        patient: &str,
    ) -> Result<()> {
        let current = self
            .inner
            .profile_selection
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        let selected = current.as_ref().ok_or(RuntimeError::ReadRequired)?;
        if intent
            .selection
            .as_ref()
            .is_none_or(|selection| !Arc::ptr_eq(selection, selected))
        {
            return Err(RuntimeError::ReadRequired);
        }
        let target = selected.target.lock().map_err(|_| RuntimeError::Locked)?;
        if !matches!(&*target, ProfileSelectionTarget::Patient { scope: expected_scope, patient: expected_patient }
            if expected_scope == scope && expected_patient == patient)
        {
            return Err(RuntimeError::ReadRequired);
        }
        Ok(())
    }

    pub fn profile_query_intent(&self) -> ProfileQueryIntent {
        ProfileQueryIntent {
            owner: Arc::downgrade(&self.inner),
            active: Arc::new(Mutex::new(true)),
            context: self.context.child(),
            selection: self
                .inner
                .profile_selection
                .lock()
                .ok()
                .and_then(|current| current.clone()),
            write_binding: None,
        }
    }

    fn profile_write_intent(
        &self,
        scope: &str,
        patient: &str,
        version: u64,
        fields: &[&str],
    ) -> Result<ProfileQueryIntent> {
        let mut intent = self.profile_query_intent();
        self.require_read(scope, patient, "patients", patient, version, fields)?;
        let reads = self.inner.reads.lock().map_err(|_| RuntimeError::Locked)?;
        let receipt = reads
            .get(&read_key(scope, patient, "patients", patient))
            .filter(|receipt| receipt.version == version)
            .ok_or(RuntimeError::ReadRequired)?;
        intent.write_binding = Some(receipt.profile.clone().ok_or(RuntimeError::ReadRequired)?);
        Ok(intent)
    }

    fn check_profile_write_binding(&self, binding: &ProfileReadBinding) -> Result<()> {
        let current = self
            .inner
            .profile_selection
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        let selected = current.as_ref().ok_or(RuntimeError::ReadRequired)?;
        if binding
            .selection
            .upgrade()
            .is_none_or(|owner| !Arc::ptr_eq(&owner, selected))
            || binding.selection_epoch != selected.host_epoch.load(Ordering::Acquire)
            || Instant::now() >= binding.deadline
        {
            return Err(RuntimeError::ReadRequired);
        }
        Ok(())
    }

    fn profile_intent_guard<'a>(
        &self,
        intent: &'a ProfileQueryIntent,
    ) -> Result<std::sync::MutexGuard<'a, bool>> {
        self.ensure_open()?;
        if intent
            .owner
            .upgrade()
            .is_none_or(|owner| !Arc::ptr_eq(&owner, &self.inner))
        {
            return Err(RuntimeError::ReadRequired);
        }
        let guard = intent
            .active
            .lock()
            .map_err(|_| RuntimeError::ReadRequired)?;
        if !*guard {
            return Err(RuntimeError::ReadRequired);
        }
        let current = self
            .inner
            .profile_selection
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        if current.as_ref().is_none_or(|current| {
            intent
                .selection
                .as_ref()
                .is_none_or(|selected| !Arc::ptr_eq(current, selected))
        }) {
            return Err(RuntimeError::ReadRequired);
        }
        Ok(guard)
    }

    fn check_profile_intent(&self, intent: &ProfileQueryIntent, epoch: u64) -> Result<()> {
        drop(self.profile_intent_guard(intent)?);
        self.check_read_epoch(epoch)
    }

    pub fn open_patient_profile(
        &self,
        scope: &str,
        patient_id: &str,
        intent: &ProfileQueryIntent,
    ) -> Result<PatientDetail> {
        validate_id(patient_id)?;
        let epoch = self.inner.read_epoch.load(Ordering::Acquire);
        self.check_profile_intent(intent, epoch)?;
        self.profile_target_matches(intent, scope, patient_id)?;
        let value = self.request_with_profile_intent(
            Method::GET,
            &["api", "v1", "network", "patient-profile", "selection-epoch"],
            &[],
            Some(scope),
            None,
            false,
            JSON_LIMIT,
            Some(intent),
        )?;
        self.check_profile_intent(intent, epoch)?;
        let object = value.as_object().ok_or(RuntimeError::InvalidResponse)?;
        let selection_epoch = value["selectionEpoch"]
            .as_u64()
            .filter(|number| *number <= MAX_SAFE_VERSION)
            .ok_or(RuntimeError::InvalidResponse)?;
        if object.len() != 2 || value["contractVersion"] != 1 {
            return Err(RuntimeError::InvalidResponse);
        }
        let body = json!({"kind":"open","contractVersion":1,"projection":"profile","expectedSelectionEpoch":selection_epoch});
        self.consume_profile_query(
            scope,
            patient_id,
            intent,
            epoch,
            body,
            None,
            Some(selection_epoch),
        )
    }

    pub fn read_patient_profile(
        &self,
        scope: &str,
        patient_id: &str,
        intent: &ProfileQueryIntent,
    ) -> Result<PatientDetail> {
        validate_id(patient_id)?;
        let epoch = self.inner.read_epoch.load(Ordering::Acquire);
        self.check_profile_intent(intent, epoch)?;
        self.profile_target_matches(intent, scope, patient_id)?;
        let key = read_key(scope, patient_id, "patients", patient_id);
        let lease = self
            .inner
            .profile_reads
            .lock()
            .map_err(|_| RuntimeError::Locked)?
            .get(&key)
            .cloned()
            .ok_or(RuntimeError::ReadRequired)?;
        if Instant::now() >= lease.deadline {
            return Err(RuntimeError::ReadRequired);
        }
        let body = json!({"kind":"read","contractVersion":1,"projection":"profile",
            "handle":lease.handle.as_str(),"expectedRevision":lease.currentness.revision});
        self.consume_profile_query(scope, patient_id, intent, epoch, body, Some(lease), None)
    }

    #[allow(clippy::too_many_arguments)]
    fn consume_profile_query(
        &self,
        scope: &str,
        patient_id: &str,
        intent: &ProfileQueryIntent,
        epoch: u64,
        body: Value,
        previous: Option<ProfileLease>,
        expected_selection_epoch: Option<u64>,
    ) -> Result<PatientDetail> {
        self.check_profile_intent(intent, epoch)?;
        {
            let _intent = self.profile_intent_guard(intent)?;
            self.forget(scope, patient_id, "patients", patient_id)?;
            self.inner
                .profile_reads
                .lock()
                .map_err(|_| RuntimeError::Locked)?
                .remove(&read_key(scope, patient_id, "patients", patient_id));
        }
        let started = Instant::now();
        let result = self
            .request_with_profile_intent(
                Method::POST,
                &[
                    "api",
                    "v1",
                    "network",
                    "patients",
                    patient_id,
                    "profile-query",
                ],
                &[],
                Some(scope),
                Some(&body),
                false,
                32 * 1024,
                Some(intent),
            )
            .map_err(|error| {
                if error == RuntimeError::TooLarge || error == RuntimeError::Rejected(413) {
                    RuntimeError::ProfileTooLarge
                } else {
                    error
                }
            });
        if result.as_ref().is_err_and(|error| error.retires_session()) {
            return result.map(|_| unreachable!());
        }
        self.check_profile_intent(intent, epoch)?;
        let key = read_key(scope, patient_id, "patients", patient_id);
        let value = match result {
            Ok(value) => value,
            Err(error) => {
                self.inner
                    .profile_reads
                    .lock()
                    .map_err(|_| RuntimeError::Locked)?
                    .remove(&key);
                self.forget(scope, patient_id, "patients", patient_id)?;
                return Err(error);
            }
        };
        let response = parse_profile_response(value, started)?;
        if response.projection != ProfileProjection::Profile
            || expected_selection_epoch
                .is_some_and(|expected| response.lease.currentness.selection_epoch < expected)
            || previous.as_ref().is_some_and(|old| {
                old.handle.as_str() != response.lease.handle.as_str()
                    || old.currentness.selection_epoch != response.lease.currentness.selection_epoch
                    || old.currentness.revision != response.lease.currentness.revision
            })
        {
            return Err(RuntimeError::InvalidResponse);
        }
        self.check_profile_intent(intent, epoch)?;
        let mut fields = response.fields;
        let locked = self.decrypt_fields(&mut fields, PATIENT_FIELDS)?;
        let row = display_profile(
            fields,
            patient_id,
            response.lease.currentness,
            locked.clone(),
        )?;
        self.remember_profile(epoch, scope, patient_id, intent, response.lease, locked)?;
        Ok(row)
    }

    fn remember_profile(
        &self,
        epoch: u64,
        scope: &str,
        patient: &str,
        intent: &ProfileQueryIntent,
        lease: ProfileLease,
        locked: Vec<String>,
    ) -> Result<()> {
        let _intent = self.profile_intent_guard(intent)?;
        let current = self
            .inner
            .profile_selection
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        let selected = current.as_ref().ok_or(RuntimeError::ReadRequired)?;
        if intent
            .selection
            .as_ref()
            .is_none_or(|selection| !Arc::ptr_eq(selection, selected))
        {
            return Err(RuntimeError::ReadRequired);
        }
        let target = selected.target.lock().map_err(|_| RuntimeError::Locked)?;
        if !matches!(&*target, ProfileSelectionTarget::Patient { scope: expected_scope, patient: expected_patient }
            if expected_scope == scope && expected_patient == patient)
        {
            return Err(RuntimeError::ReadRequired);
        }
        if Instant::now() >= lease.deadline
            || lease.currentness.selection_epoch < selected.host_epoch.load(Ordering::Acquire)
        {
            return Err(RuntimeError::ReadRequired);
        }
        let key = read_key(scope, patient, "patients", patient);
        let mut reads = self.inner.reads.lock().map_err(|_| RuntimeError::Locked)?;
        self.check_read_epoch(epoch)?;
        if reads
            .get(&key)
            .is_some_and(|old| old.version > lease.currentness.revision)
        {
            return Err(RuntimeError::ReadRequired);
        }
        let mut profiles = self
            .inner
            .profile_reads
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        self.check_read_epoch(epoch)?;
        if reads.len() >= 2048 {
            reads.clear();
        }
        if profiles.len() >= 2048 {
            profiles.clear();
        }
        selected
            .host_epoch
            .store(lease.currentness.selection_epoch, Ordering::Release);
        reads.insert(
            read_key(scope, patient, "patients", patient),
            ReadReceipt {
                version: lease.currentness.revision,
                locked,
                profile: Some(ProfileReadBinding {
                    selection: Arc::downgrade(selected),
                    selection_epoch: lease.currentness.selection_epoch,
                    deadline: lease.deadline,
                }),
            },
        );
        profiles.insert(key, lease);
        Ok(())
    }

    /// Compatibility display only; this GET never installs a profile write receipt.
    pub fn read_patient_legacy(&self, scope: &str, patient_id: &str) -> Result<PatientDetail> {
        validate_id(patient_id)?;
        let response = self.read_json(
            Some(scope),
            &["api", "v1", "network", "patients", patient_id],
            JSON_LIMIT,
        )?;
        let mut value = response.value;
        let locked = self.decrypt_fields(&mut value, PATIENT_FIELDS)?;
        let mut row: PatientDetail = decode(value)?;
        if row.id != patient_id {
            return Err(RuntimeError::InvalidResponse);
        }
        valid_wire_version(row.version)?;
        if row.deleted_at.is_some() {
            return Err(RuntimeError::Missing);
        }
        row.locked_fields = locked.clone();
        self.check_read_epoch(response.epoch)?;
        self.ensure_open()?;
        Ok(row)
    }

    /// Register ordinary patient fields through the current paired writer.
    /// The returned version-1 acknowledgment still requires an explicit read.
    pub fn create_patient(
        &self,
        scope: &str,
        draft: &PatientCreateDraft,
    ) -> Result<CreatedResource> {
        for value in [&draft.first_name, &draft.last_name, &draft.tax_code] {
            validate_patient_name(value)?;
        }
        if let Some(date) = &draft.birth_date {
            parse_contract_date(date)?;
        }
        let _guard = self.begin_write()?;
        let body = self.seal_fields(
            serde_json::to_value(draft).map_err(|_| RuntimeError::InvalidInput)?,
            PATIENT_PROFILE_SEALED,
        )?;
        let created = self.create(
            scope,
            &["api", "v1", "network", "patients"],
            body,
            JSON_LIMIT,
        )?;
        if created.version != Some(1) {
            return Err(RuntimeError::Indeterminate);
        }
        Ok(created)
    }

    /// Apply only the ordinary registration fields explicitly present in this
    /// patch. In particular, this never sends archive state or an implied null
    /// for an unavailable field. Every update consumes the exact preread once.
    pub fn update_patient_profile(
        &self,
        scope: &str,
        patient_id: &str,
        version: u64,
        patch: &PatientProfilePatch,
    ) -> Result<()> {
        for value in [&patch.first_name, &patch.last_name, &patch.tax_code]
            .into_iter()
            .flatten()
        {
            validate_patient_name(value)?;
        }
        if let NullableStringPatch::Set(date) = &patch.birth_date {
            parse_contract_date(date)?;
        }
        let body = serde_json::to_value(patch).map_err(|_| RuntimeError::InvalidInput)?;
        if body.as_object().is_none_or(|fields| fields.is_empty()) {
            return Err(RuntimeError::InvalidInput);
        }
        let changed_sensitive: Vec<_> = PATIENT_PROFILE_SEALED
            .iter()
            .copied()
            .filter(|field| body.get(*field).is_some())
            .collect();
        let _guard = self.begin_write()?;
        let intent = self.profile_write_intent(scope, patient_id, version, &changed_sensitive)?;
        let mut body = self.seal_fields(body, &changed_sensitive)?;
        body["version"] = json!(version);
        self.forget(scope, patient_id, "patients", patient_id)?;
        self.update_with_profile_intent(
            scope,
            &["api", "v1", "network", "patients", patient_id],
            body,
            Some(&intent),
        )
    }

    pub fn update_patient_notes(
        &self,
        scope: &str,
        patient_id: &str,
        version: u64,
        notes: &str,
    ) -> Result<()> {
        let _guard = self.begin_write()?;
        let intent = self.profile_write_intent(scope, patient_id, version, &["notes"])?;
        let body = self.seal_fields(json!({ "version": version, "notes": notes }), &["notes"])?;
        self.forget(scope, patient_id, "patients", patient_id)?;
        self.update_with_profile_intent(
            scope,
            &["api", "v1", "network", "patients", patient_id],
            body,
            Some(&intent),
        )
    }

    pub fn list_entries(&self, scope: &str, patient_id: &str) -> Result<Vec<Entry>> {
        self.list_clinical(
            scope,
            patient_id,
            "entries",
            ENTRY_FIELDS,
            |row: &mut Entry, locked| {
                row.locked_fields = locked;
                (
                    &row.id,
                    &row.patient_id,
                    row.version,
                    row.deleted_at.is_some(),
                )
            },
        )
    }

    /// The existing ambulatory feed returns at most 50 rows by default, newest
    /// first. Tombstones are filtered after that server limit, without fan-out.
    pub fn list_global_entries(&self, scope: &str) -> Result<Vec<Entry>> {
        self.list_global_entries_with_filter(scope, &GlobalEntryFilter::default())
    }

    pub fn list_global_entries_with_filter(
        &self,
        scope: &str,
        filter: &GlobalEntryFilter,
    ) -> Result<Vec<Entry>> {
        let mut query = aggregate_query(&filter.date_from, &filter.date_to, filter.limit, 100)?;
        if let Some(kind) = &filter.entry_type {
            if kind.trim_matches(crate::js_whitespace).is_empty()
                || kind.chars().any(char::is_control)
            {
                return Err(RuntimeError::InvalidInput);
            }
            query.push(("type", kind.clone()));
        }
        let pairs: Vec<_> = query
            .iter()
            .map(|(key, value)| (*key, value.as_str()))
            .collect();
        let response = self.read_json_query(
            Some(scope),
            &["api", "v1", "network", "entries"],
            &pairs,
            JSON_LIMIT,
        )?;
        self.decode_clinical_list(
            response,
            scope,
            None,
            "entries",
            ENTRY_FIELDS,
            |row: &mut Entry, locked| {
                row.locked_fields = locked;
                (
                    &row.id,
                    &row.patient_id,
                    row.version,
                    row.deleted_at.is_some(),
                )
            },
        )
    }
    pub fn read_entry(&self, scope: &str, patient_id: &str, id: &str) -> Result<Entry> {
        self.read_clinical(
            scope,
            patient_id,
            "entries",
            id,
            ENTRY_FIELDS,
            |row: &mut Entry, locked| {
                row.locked_fields = locked;
                (
                    &row.id,
                    &row.patient_id,
                    row.version,
                    row.deleted_at.is_some(),
                )
            },
        )
    }
    pub fn create_entry(
        &self,
        scope: &str,
        patient_id: &str,
        draft: &EntryDraft,
    ) -> Result<CreatedResource> {
        self.create_clinical(scope, patient_id, "entries", draft, &["title", "content"])
    }

    pub fn read_scale_catalog(&self, scope: &str) -> Result<ScaleCatalog> {
        let response = self.read_json(
            Some(scope),
            &["api", "v1", "network", "scales"],
            SCALE_CATALOG_LIMIT,
        )?;
        let catalog = parse_scale_catalog(response.value)?;
        self.check_read_epoch(response.epoch)?;
        Ok(catalog)
    }

    /// Reads only the host-owned demographic projection. The caller supplies
    /// presentation parameters; scope, archive generation and statistics stay
    /// host assertions.
    pub fn read_population_demographics(
        &self,
        scope: &str,
        request: &DemographicsRequest,
    ) -> Result<PopulationDemographics> {
        let min_age = request.min_age().to_string();
        let max_age = request.max_age().to_string();
        let response = self.read_json_query(
            Some(scope),
            DEMOGRAPHICS_PATH,
            &[
                ("minAge", min_age.as_str()),
                ("maxAge", max_age.as_str()),
                ("timeZone", request.time_zone()),
            ],
            POPULATION_DEMOGRAPHICS_MAX_BYTES,
        )?;
        let demographics = parse_demographics(
            response.value,
            scope,
            &self.inner.user.archive_generation,
            request,
        )?;
        self.check_read_epoch(response.epoch)?;
        Ok(demographics)
    }

    /// Refresh the real profile selection before asking the host to calculate.
    /// The caller supplies neither an epoch nor a score, interpretation or grant.
    pub fn prepare_scale(
        &self,
        scope: &str,
        patient_id: &str,
        intent: &ProfileQueryIntent,
        request: &ScalePreparationRequest,
    ) -> Result<PreparedScale> {
        validate_id(patient_id)?;
        if patient_id.len() > 160 || patient_id.trim() != patient_id {
            return Err(RuntimeError::InvalidInput);
        }
        let patient = self.open_patient_profile(scope, patient_id, intent)?;
        if patient.is_archived || patient.deleted_at.is_some() {
            return Err(RuntimeError::Forbidden);
        }
        if patient.version != request.patient_version {
            return Err(RuntimeError::Conflict);
        }
        let epoch = self.inner.read_epoch.load(Ordering::Acquire);
        self.check_profile_intent(intent, epoch)?;
        let context = self.scale_profile_context(scope, patient_id, intent)?;
        let body = json!({"contractVersion":1, "scaleId":request.scale_id, "answers":request.answers,
            "expectedCatalogRevision":request.catalog.catalog_revision(), "expectedPatientVersion":context.patient_version,
            "expectedSelectionEpoch":context.selection_epoch});
        if serde_json::to_vec(&body)
            .map_err(|_| RuntimeError::InvalidInput)?
            .len()
            > SCALE_REQUEST_LIMIT
        {
            return Err(RuntimeError::TooLarge);
        }
        let value = self.request_with_profile_intent(
            Method::POST,
            &[
                "api", "v1", "network", "patients", patient_id, "scales", "prepare",
            ],
            &[],
            Some(scope),
            Some(&body),
            false,
            SCALE_PREPARATION_LIMIT,
            Some(intent),
        )?;
        self.check_profile_intent(intent, epoch)?;
        if self.scale_profile_context(scope, patient_id, intent)? != context {
            return Err(RuntimeError::ReadRequired);
        }
        parse_scale_preparation(value, request, &context, intent.clone())
    }

    fn scale_profile_context(
        &self,
        scope: &str,
        patient: &str,
        intent: &ProfileQueryIntent,
    ) -> Result<ScalePreparationContext> {
        drop(self.profile_intent_guard(intent)?);
        self.profile_target_matches(intent, scope, patient)?;
        let profiles = self
            .inner
            .profile_reads
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        let lease = profiles
            .get(&read_key(scope, patient, "patients", patient))
            .ok_or(RuntimeError::ReadRequired)?;
        if Instant::now() >= lease.deadline
            || intent.selection.as_ref().is_none_or(|selection| {
                selection.host_epoch.load(Ordering::Acquire) != lease.currentness.selection_epoch
            })
        {
            return Err(RuntimeError::ReadRequired);
        }
        Ok(ScalePreparationContext {
            patient_id: patient.into(),
            ambulatory_id: scope.into(),
            patient_version: lease.currentness.revision,
            selection_epoch: lease.currentness.selection_epoch,
        })
    }

    /// Local sealing only, called at the explicit confirmation gesture. Retain
    /// the returned attempt before sending anything and reuse it for any retry.
    pub fn seal_scale_entry(
        &self,
        prepared: &PreparedScale,
        date: &str,
        setting: Option<&str>,
    ) -> Result<ScaleEntryAttempt> {
        let context = prepared.context();
        if self.scale_profile_context(
            &context.ambulatory_id,
            &context.patient_id,
            &prepared.intent,
        )? != *context
        {
            return Err(RuntimeError::ReadRequired);
        }
        let date = parse_contract_date(date)?
            .with_timezone(&chrono::Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        if setting.is_some_and(|value| {
            value.trim().is_empty() || value.len() > 160 || value.chars().any(char::is_control)
        }) {
            return Err(RuntimeError::InvalidInput);
        }
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|_| RuntimeError::Crypto)?;
        let id = format!(
            "scale-{}",
            random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        );
        let body = self.seal_fields(
            json!({"id":id, "type":"scale", "title":prepared.submission().title,
            "content":prepared.submission().content, "metadata":prepared.submission().metadata,
            "date":date, "setting":setting}),
            &["title", "content", "metadata"],
        )?;
        Ok(ScaleEntryAttempt {
            prepared: prepared.clone(),
            body,
            id,
            date,
            setting: setting.map(str::to_owned),
        })
    }

    /// The ordinary diary create/read path, with a fixed already sealed body.
    /// This has no clinical writer or inference endpoint of its own.
    pub fn create_scale_entry(&self, attempt: &ScaleEntryAttempt) -> Result<ScaleEntryReadback> {
        let context = attempt.prepared.context();
        let mut intent = attempt.prepared.intent.clone();
        let patient =
            self.read_patient_profile(&context.ambulatory_id, &context.patient_id, &intent)?;
        if patient.is_archived || patient.deleted_at.is_some() {
            return Err(RuntimeError::Forbidden);
        }
        if self.scale_profile_context(&context.ambulatory_id, &context.patient_id, &intent)?
            != *context
        {
            return Err(RuntimeError::Conflict);
        }
        // Reuse the consumed profile binding, including the final pre-send
        // deadline/selection check after the scoped identity negotiation.
        self.require_read(
            &context.ambulatory_id,
            &context.patient_id,
            "patients",
            &context.patient_id,
            context.patient_version,
            &[],
        )?;
        intent.write_binding = self
            .inner
            .reads
            .lock()
            .map_err(|_| RuntimeError::Locked)?
            .get(&read_key(
                &context.ambulatory_id,
                &context.patient_id,
                "patients",
                &context.patient_id,
            ))
            .and_then(|receipt| receipt.profile.clone());
        if intent.write_binding.is_none() {
            return Err(RuntimeError::ReadRequired);
        }
        {
            let _guard = self.begin_write()?;
            let created = self.create_with_profile_intent(
                &context.ambulatory_id,
                &[
                    "api",
                    "v1",
                    "network",
                    "patients",
                    &context.patient_id,
                    "entries",
                ],
                attempt.body.clone(),
                JSON_LIMIT,
                Some(&intent),
            )?;
            if created.id != attempt.id || created.version != Some(1) {
                return Err(RuntimeError::Indeterminate);
            }
        }
        self.read_scale_entry(attempt)
    }

    /// Reconciliation never sends a mutation. A missing/different row is not a
    /// verified save and cannot cause a new identity or an automatic retry.
    pub fn read_scale_entry(&self, attempt: &ScaleEntryAttempt) -> Result<ScaleEntryReadback> {
        let context = attempt.prepared.context();
        let intent = &attempt.prepared.intent;
        drop(self.profile_intent_guard(intent)?);
        self.profile_target_matches(intent, &context.ambulatory_id, &context.patient_id)?;
        let patient =
            self.read_patient_profile(&context.ambulatory_id, &context.patient_id, intent)?;
        if patient.is_archived || patient.deleted_at.is_some() {
            return Err(RuntimeError::Forbidden);
        }
        if self.scale_profile_context(&context.ambulatory_id, &context.patient_id, intent)?
            != *context
        {
            return Err(RuntimeError::Conflict);
        }
        let row = self.read_clinical_with_profile_intent(
            &context.ambulatory_id,
            &context.patient_id,
            "entries",
            &attempt.id,
            ENTRY_FIELDS,
            |row: &mut Entry, locked| {
                row.locked_fields = locked;
                (
                    &row.id,
                    &row.patient_id,
                    row.version,
                    row.deleted_at.is_some(),
                )
            },
            Some(intent),
        );
        match row {
            Ok(row) if attempt.matches(&row) => Ok(ScaleEntryReadback::Verified(row)),
            Ok(row) => Ok(ScaleEntryReadback::Different(row)),
            Err(RuntimeError::Missing) => Ok(ScaleEntryReadback::NotFound),
            Err(error) => Err(error),
        }
    }
    pub fn update_entry(
        &self,
        scope: &str,
        patient_id: &str,
        id: &str,
        version: u64,
        draft: &EntryDraft,
    ) -> Result<()> {
        self.update_clinical(
            scope,
            patient_id,
            "entries",
            id,
            version,
            draft,
            &["title", "content"],
        )
    }

    pub fn list_therapies(&self, scope: &str, patient_id: &str) -> Result<Vec<Therapy>> {
        self.list_clinical(
            scope,
            patient_id,
            "therapies",
            THERAPY_FIELDS,
            |row: &mut Therapy, locked| {
                row.locked_fields = locked;
                (
                    &row.id,
                    &row.patient_id,
                    row.version,
                    row.deleted_at.is_some(),
                )
            },
        )
    }
    pub fn read_therapy(&self, scope: &str, patient_id: &str, id: &str) -> Result<Therapy> {
        self.read_clinical(
            scope,
            patient_id,
            "therapies",
            id,
            THERAPY_FIELDS,
            |row: &mut Therapy, locked| {
                row.locked_fields = locked;
                (
                    &row.id,
                    &row.patient_id,
                    row.version,
                    row.deleted_at.is_some(),
                )
            },
        )
    }
    pub fn create_therapy(
        &self,
        scope: &str,
        patient_id: &str,
        draft: &TherapyDraft,
    ) -> Result<CreatedResource> {
        self.create_clinical(scope, patient_id, "therapies", draft, &["motivation"])
    }
    pub fn update_therapy(
        &self,
        scope: &str,
        patient_id: &str,
        id: &str,
        version: u64,
        draft: &TherapyDraft,
    ) -> Result<()> {
        self.update_clinical(
            scope,
            patient_id,
            "therapies",
            id,
            version,
            draft,
            &["motivation"],
        )
    }

    pub fn list_observations(&self, scope: &str, patient_id: &str) -> Result<Vec<Observation>> {
        self.list_clinical(
            scope,
            patient_id,
            "observations",
            OBSERVATION_FIELDS,
            |row: &mut Observation, locked| {
                row.locked_fields = locked;
                (
                    &row.id,
                    &row.patient_id,
                    row.version,
                    row.deleted_at.is_some(),
                )
            },
        )
    }
    pub fn read_observation(&self, scope: &str, patient_id: &str, id: &str) -> Result<Observation> {
        self.read_clinical(
            scope,
            patient_id,
            "observations",
            id,
            OBSERVATION_FIELDS,
            |row: &mut Observation, locked| {
                row.locked_fields = locked;
                (
                    &row.id,
                    &row.patient_id,
                    row.version,
                    row.deleted_at.is_some(),
                )
            },
        )
    }
    pub fn create_observation(
        &self,
        scope: &str,
        patient_id: &str,
        draft: &ObservationDraft,
    ) -> Result<CreatedResource> {
        self.create_clinical(scope, patient_id, "observations", draft, &["notes"])
    }
    pub fn update_observation(
        &self,
        scope: &str,
        patient_id: &str,
        id: &str,
        version: u64,
        draft: &ObservationDraft,
    ) -> Result<()> {
        self.update_clinical(
            scope,
            patient_id,
            "observations",
            id,
            version,
            draft,
            &["notes"],
        )
    }

    pub fn list_checkups(&self, scope: &str, patient_id: &str) -> Result<Vec<Checkup>> {
        self.list_clinical(
            scope,
            patient_id,
            "checkups",
            CHECKUP_FIELDS,
            |row: &mut Checkup, locked| {
                row.locked_fields = locked;
                (
                    &row.id,
                    &row.patient_id,
                    row.version,
                    row.deleted_at.is_some(),
                )
            },
        )
    }

    /// The existing ambulatory agenda returns at most 200 rows by default,
    /// earliest first. Tombstones are filtered after that server limit.
    pub fn list_agenda(&self, scope: &str) -> Result<Vec<Checkup>> {
        self.list_agenda_with_filter(scope, &AgendaFilter::default())
    }

    pub fn list_agenda_with_filter(
        &self,
        scope: &str,
        filter: &AgendaFilter,
    ) -> Result<Vec<Checkup>> {
        let mut query = aggregate_query(&filter.date_from, &filter.date_to, filter.limit, 500)?;
        for status in &filter.statuses {
            query.push((
                "status",
                match status {
                    CheckupStatus::Pending => "pending",
                    CheckupStatus::Completed => "completed",
                    CheckupStatus::Cancelled => "cancelled",
                }
                .to_owned(),
            ));
        }
        let pairs: Vec<_> = query
            .iter()
            .map(|(key, value)| (*key, value.as_str()))
            .collect();
        let response = self.read_json_query(
            Some(scope),
            &["api", "v1", "network", "checkups"],
            &pairs,
            JSON_LIMIT,
        )?;
        self.decode_clinical_list(
            response,
            scope,
            None,
            "checkups",
            CHECKUP_FIELDS,
            |row: &mut Checkup, locked| {
                row.locked_fields = locked;
                (
                    &row.id,
                    &row.patient_id,
                    row.version,
                    row.deleted_at.is_some(),
                )
            },
        )
    }
    pub fn read_checkup(&self, scope: &str, patient_id: &str, id: &str) -> Result<Checkup> {
        self.read_clinical(
            scope,
            patient_id,
            "checkups",
            id,
            CHECKUP_FIELDS,
            |row: &mut Checkup, locked| {
                row.locked_fields = locked;
                (
                    &row.id,
                    &row.patient_id,
                    row.version,
                    row.deleted_at.is_some(),
                )
            },
        )
    }
    pub fn create_checkup(
        &self,
        scope: &str,
        patient_id: &str,
        draft: &CheckupDraft,
    ) -> Result<CreatedResource> {
        self.create_clinical(scope, patient_id, "checkups", draft, &["notes"])
    }
    pub fn update_checkup(
        &self,
        scope: &str,
        patient_id: &str,
        id: &str,
        version: u64,
        draft: &CheckupDraft,
    ) -> Result<()> {
        self.update_clinical(
            scope,
            patient_id,
            "checkups",
            id,
            version,
            draft,
            &["notes"],
        )
    }

    pub fn list_attachments(&self, scope: &str, patient_id: &str) -> Result<Vec<Attachment>> {
        validate_id(patient_id)?;
        let response = self.read_json(
            Some(scope),
            &[
                "api",
                "v1",
                "network",
                "patients",
                patient_id,
                "attachments",
            ],
            JSON_LIMIT,
        )?;
        let values: Vec<Value> = decode(response.value)?;
        let rows = values
            .into_iter()
            .map(|value| {
                // AttachmentSummary omits the payload key entirely. Check the
                // wire object before decrypting: a null or unreadable payload
                // must not become indistinguishable from an omitted one.
                if value
                    .as_object()
                    .is_some_and(|row| row.contains_key("data"))
                {
                    return Err(RuntimeError::InvalidResponse);
                }
                self.attachment(value, patient_id, None)
            })
            .collect::<Result<Vec<_>>>()?;
        self.check_read_epoch(response.epoch)?;
        Ok(rows)
    }
    pub fn read_attachment(&self, scope: &str, patient_id: &str, id: &str) -> Result<Attachment> {
        validate_id(patient_id)?;
        validate_id(id)?;
        let response = self.read_json(
            Some(scope),
            &[
                "api",
                "v1",
                "network",
                "patients",
                patient_id,
                "attachments",
                id,
            ],
            DOCUMENT_LIMIT,
        )?;
        let row = self.attachment(response.value, patient_id, Some(id))?;
        self.check_read_epoch(response.epoch)?;
        Ok(row)
    }
    fn attachment(
        &self,
        mut value: Value,
        patient_id: &str,
        id: Option<&str>,
    ) -> Result<Attachment> {
        let locked = self.decrypt_fields(&mut value, ATTACHMENT_FIELDS)?;
        let mut row: Attachment = decode(value)?;
        valid_wire_id(&row.id)?;
        if row.patient_id != patient_id
            || id.is_some_and(|id| id != row.id)
            || row.size > MAX_SAFE_VERSION
        {
            return Err(RuntimeError::InvalidResponse);
        }
        row.locked_fields = locked;
        self.ensure_open()?;
        Ok(row)
    }

    /// Caller selects the document bytes explicitly. No disk path is opened here.
    /// The current paired contract creates documents; it does not authorize delete.
    pub fn create_attachment(
        &self,
        scope: &str,
        patient_id: &str,
        name: &str,
        mime_type: &str,
        bytes: &[u8],
    ) -> Result<CreatedResource> {
        validate_id(patient_id)?;
        if name.trim().is_empty()
            || name.len() > 1024
            || mime_type.len() > 128
            || mime_type.is_empty()
            || !mime_type
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'+' | b'.'))
        {
            return Err(RuntimeError::InvalidInput);
        }
        if bytes.len() > 10 * 1024 * 1024 {
            return Err(RuntimeError::TooLarge);
        }
        let _guard = self.begin_write()?;
        let data = Zeroizing::new(format!("data:{mime_type};base64,{}", BASE64.encode(bytes)));
        let body = self.seal_fields(json!({ "name": name, "path": name, "type": mime_type, "size": bytes.len(), "data": data.as_str() }), &["name", "path", "data"])?;
        self.create(
            scope,
            &[
                "api",
                "v1",
                "network",
                "patients",
                patient_id,
                "attachments",
            ],
            body,
            DOCUMENT_LIMIT,
        )
    }

    fn begin_write(&self) -> Result<WriteGuard<'_>> {
        self.ensure_open()?;
        self.inner
            .writing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| RuntimeError::Busy)?;
        let guard = WriteGuard(&self.inner.writing);
        self.inner
            .read_epoch
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |epoch| {
                epoch.checked_add(1)
            })
            .map_err(|_| RuntimeError::Locked)?;
        Ok(guard)
    }
    fn seal_fields(&self, mut value: Value, fields: &[&str]) -> Result<Value> {
        self.ensure_open()?;
        let secrets = self
            .inner
            .secrets
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        let master = secrets.master.as_ref().ok_or(RuntimeError::Locked)?;
        let object = value.as_object_mut().ok_or(RuntimeError::InvalidInput)?;
        for field in fields {
            if let Some(value) = object.get_mut(*field)
                && !value.is_null()
            {
                *value = Value::String(crypto::seal(value, master)?);
            }
        }
        self.ensure_open()?;
        Ok(value)
    }
    fn decrypt_fields(&self, value: &mut Value, fields: &[Field]) -> Result<Vec<String>> {
        self.ensure_open()?;
        let secrets = self
            .inner
            .secrets
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        let master = secrets.master.as_ref().ok_or(RuntimeError::Locked)?;
        let object = value.as_object_mut().ok_or(RuntimeError::InvalidResponse)?;
        let mut locked = Vec::new();
        for &(field, required, structured) in fields {
            if let Some(value) = object.get_mut(field) {
                match crypto::display_field(value, master, structured) {
                    Ok(decoded) if !required || decoded.is_string() => *value = decoded,
                    _ => {
                        locked.push(field.to_owned());
                        *value = if required {
                            Value::String(String::new())
                        } else {
                            Value::Null
                        };
                    }
                }
            }
        }
        self.ensure_open()?;
        Ok(locked)
    }
    #[allow(clippy::too_many_arguments)]
    fn remember(
        &self,
        epoch: u64,
        scope: &str,
        patient: &str,
        domain: &str,
        id: &str,
        version: u64,
        locked: Vec<String>,
    ) -> Result<()> {
        if domain == "patients" {
            return Err(RuntimeError::ReadRequired);
        }
        let mut reads = self.inner.reads.lock().map_err(|_| RuntimeError::Locked)?;
        self.check_read_epoch(epoch)?;
        if reads.len() >= 2048 {
            reads.clear();
        }
        let key = read_key(scope, patient, domain, id);
        // A late older read cannot replace a newer known version or unlock it.
        if reads
            .get(&key)
            .is_none_or(|previous| previous.version <= version)
        {
            reads.insert(
                key,
                ReadReceipt {
                    profile: None,
                    version,
                    locked,
                },
            );
        }
        Ok(())
    }
    fn require_read(
        &self,
        scope: &str,
        patient: &str,
        domain: &str,
        id: &str,
        version: u64,
        fields: &[&str],
    ) -> Result<()> {
        validate_scope_id(scope)?;
        validate_id(patient)?;
        validate_id(id)?;
        validate_version(version)?;
        let selection = if domain == "patients" {
            Some(
                self.inner
                    .profile_selection
                    .lock()
                    .map_err(|_| RuntimeError::Locked)?,
            )
        } else {
            None
        };
        let reads = self.inner.reads.lock().map_err(|_| RuntimeError::Locked)?;
        let receipt = reads
            .get(&read_key(scope, patient, domain, id))
            .ok_or(RuntimeError::ReadRequired)?;
        if receipt.version != version {
            return Err(RuntimeError::ReadRequired);
        }
        if let Some(selection) = selection.as_ref() {
            let selected = selection.as_ref().ok_or(RuntimeError::ReadRequired)?;
            let binding = receipt.profile.as_ref().ok_or(RuntimeError::ReadRequired)?;
            if binding
                .selection
                .upgrade()
                .is_none_or(|owner| !Arc::ptr_eq(&owner, selected))
                || binding.selection_epoch != selected.host_epoch.load(Ordering::Acquire)
                || Instant::now() >= binding.deadline
            {
                return Err(RuntimeError::ReadRequired);
            }
            let target = selected.target.lock().map_err(|_| RuntimeError::Locked)?;
            if !matches!(&*target, ProfileSelectionTarget::Patient { scope: expected_scope, patient: expected_patient }
                if expected_scope == scope && expected_patient == patient && id == patient)
            {
                return Err(RuntimeError::ReadRequired);
            }
            let profiles = self
                .inner
                .profile_reads
                .lock()
                .map_err(|_| RuntimeError::Locked)?;
            let lease = profiles
                .get(&read_key(scope, patient, domain, id))
                .ok_or(RuntimeError::ReadRequired)?;
            if lease.currentness.selection_epoch != binding.selection_epoch
                || lease.currentness.revision != version
                || Instant::now() >= lease.deadline
            {
                return Err(RuntimeError::ReadRequired);
            }
        }
        if receipt
            .locked
            .iter()
            .any(|field| fields.contains(&field.as_str()))
        {
            return Err(RuntimeError::LockedField);
        }
        Ok(())
    }
    fn forget(&self, scope: &str, patient: &str, domain: &str, id: &str) -> Result<()> {
        self.inner
            .reads
            .lock()
            .map_err(|_| RuntimeError::Locked)?
            .remove(&read_key(scope, patient, domain, id));
        Ok(())
    }

    fn list_clinical<T: DeserializeOwned, F>(
        &self,
        scope: &str,
        patient: &str,
        domain: &str,
        fields: &[Field],
        bind: F,
    ) -> Result<Vec<T>>
    where
        F: Fn(&mut T, Vec<String>) -> (&str, &str, u64, bool),
    {
        validate_id(patient)?;
        let response = self.read_json(
            Some(scope),
            &["api", "v1", "network", "patients", patient, domain],
            JSON_LIMIT,
        )?;
        self.decode_clinical_list(response, scope, Some(patient), domain, fields, bind)
    }

    fn decode_clinical_list<T: DeserializeOwned, F>(
        &self,
        response: ReadResponse,
        scope: &str,
        patient: Option<&str>,
        domain: &str,
        fields: &[Field],
        bind: F,
    ) -> Result<Vec<T>>
    where
        F: Fn(&mut T, Vec<String>) -> (&str, &str, u64, bool),
    {
        let values: Vec<Value> = decode(response.value)?;
        let mut rows = Vec::with_capacity(values.len());
        for mut value in values {
            let locked = self.decrypt_fields(&mut value, fields)?;
            let mut row: T = decode(value)?;
            let (id, parent, version, deleted) = bind(&mut row, locked.clone());
            valid_wire_id(id)?;
            valid_wire_id(parent)?;
            valid_wire_version(version)?;
            if patient.is_some_and(|expected| parent != expected) {
                return Err(RuntimeError::InvalidResponse);
            }
            if !deleted {
                self.remember(response.epoch, scope, parent, domain, id, version, locked)?;
                rows.push(row);
            }
        }
        self.check_read_epoch(response.epoch)?;
        Ok(rows)
    }
    fn read_clinical<T: DeserializeOwned, F>(
        &self,
        scope: &str,
        patient: &str,
        domain: &str,
        id: &str,
        fields: &[Field],
        bind: F,
    ) -> Result<T>
    where
        F: Fn(&mut T, Vec<String>) -> (&str, &str, u64, bool),
    {
        self.read_clinical_with_profile_intent(scope, patient, domain, id, fields, bind, None)
    }
    #[allow(clippy::too_many_arguments)]
    fn read_clinical_with_profile_intent<T: DeserializeOwned, F>(
        &self,
        scope: &str,
        patient: &str,
        domain: &str,
        id: &str,
        fields: &[Field],
        bind: F,
        intent: Option<&ProfileQueryIntent>,
    ) -> Result<T>
    where
        F: Fn(&mut T, Vec<String>) -> (&str, &str, u64, bool),
    {
        validate_id(patient)?;
        validate_id(id)?;
        let epoch = self.inner.read_epoch.load(Ordering::Acquire);
        self.check_read_epoch(epoch)?;
        let mut value = self.request_with_profile_intent(
            Method::GET,
            &["api", "v1", "network", "patients", patient, domain, id],
            &[],
            Some(scope),
            None,
            false,
            JSON_LIMIT,
            intent,
        )?;
        self.check_read_epoch(epoch)?;
        let locked = self.decrypt_fields(&mut value, fields)?;
        let mut row: T = decode(value)?;
        let (returned_id, parent, version, deleted) = bind(&mut row, locked.clone());
        if returned_id != id || parent != patient {
            return Err(RuntimeError::InvalidResponse);
        }
        valid_wire_version(version)?;
        if deleted {
            return Err(RuntimeError::Missing);
        }
        self.remember(epoch, scope, patient, domain, id, version, locked)?;
        if let Some(intent) = intent {
            self.check_profile_intent(intent, epoch)?;
        }
        self.ensure_open()?;
        Ok(row)
    }
    fn create_clinical<T: Serialize>(
        &self,
        scope: &str,
        patient: &str,
        domain: &str,
        draft: &T,
        encrypted: &[&str],
    ) -> Result<CreatedResource> {
        validate_id(patient)?;
        let _guard = self.begin_write()?;
        let body = self.seal_fields(
            serde_json::to_value(draft).map_err(|_| RuntimeError::InvalidInput)?,
            encrypted,
        )?;
        self.create(
            scope,
            &["api", "v1", "network", "patients", patient, domain],
            body,
            JSON_LIMIT,
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn update_clinical<T: Serialize>(
        &self,
        scope: &str,
        patient: &str,
        domain: &str,
        id: &str,
        version: u64,
        draft: &T,
        encrypted: &[&str],
    ) -> Result<()> {
        let _guard = self.begin_write()?;
        self.require_read(scope, patient, domain, id, version, encrypted)?;
        let mut body = self.seal_fields(
            serde_json::to_value(draft).map_err(|_| RuntimeError::InvalidInput)?,
            encrypted,
        )?;
        body["version"] = json!(version);
        self.forget(scope, patient, domain, id)?;
        self.update(
            scope,
            &["api", "v1", "network", "patients", patient, domain, id],
            body,
        )
    }
    fn create(
        &self,
        scope: &str,
        path: &[&str],
        body: Value,
        limit: usize,
    ) -> Result<CreatedResource> {
        self.create_with_profile_intent(scope, path, body, limit, None)
    }
    fn create_with_profile_intent(
        &self,
        scope: &str,
        path: &[&str],
        body: Value,
        limit: usize,
        intent: Option<&ProfileQueryIntent>,
    ) -> Result<CreatedResource> {
        let response = self.request_with_profile_intent(
            Method::POST,
            path,
            &[],
            Some(scope),
            Some(&body),
            true,
            limit,
            intent,
        )?;
        let created: CreatedResource =
            serde_json::from_value(response).map_err(|_| RuntimeError::Indeterminate)?;
        if validate_id(&created.id).is_err()
            || created
                .version
                .is_some_and(|version| validate_version(version).is_err())
        {
            return Err(RuntimeError::Indeterminate);
        }
        Ok(created)
    }
    fn update(&self, scope: &str, path: &[&str], body: Value) -> Result<()> {
        self.update_with_profile_intent(scope, path, body, None)
    }
    fn update_with_profile_intent(
        &self,
        scope: &str,
        path: &[&str],
        body: Value,
        intent: Option<&ProfileQueryIntent>,
    ) -> Result<()> {
        let response = self.request_with_profile_intent(
            Method::PUT,
            path,
            &[],
            Some(scope),
            Some(&body),
            true,
            JSON_LIMIT,
            intent,
        )?;
        if response.get("success").and_then(Value::as_bool) != Some(true) {
            return Err(RuntimeError::Indeterminate);
        }
        Ok(())
    }
}

type Field = (&'static str, bool, bool); // wire name, required, accepts structured JSON

fn parse_ai_runtime_status(value: Value) -> Result<AiRuntimeStatus> {
    // Do not render an unknown contract, or one claiming execution authority,
    // as the status-only projection this client actually understands.
    for (pointer, expected) in [
        ("/plane", json!("ai-plane-separate-from-data-plane")),
        ("/localRuntime/provider", json!("ollama")),
        ("/localRuntime/targetPolicy", json!("loopback-only")),
        ("/centralRuntime/accessMode", json!("status-only")),
        ("/centralRuntime/executionAuthorized", json!(false)),
        ("/centralRuntime/requiresPairing", json!(true)),
        ("/centralRuntime/executionTarget", json!("paired-home-base")),
        (
            "/fabric/schemaVersion",
            json!("mediflow.ai.network-fabric-status.v1"),
        ),
        ("/fabric/contractVersion", json!("mediflow.ai.fabric.v1")),
        ("/fabric/access", json!("status_only")),
        ("/fabric/pairedExecution", json!("not_authorized")),
        ("/fabric/egressGateOpen", json!(false)),
        ("/fabric/readinessNote", json!("available_unqualified")),
        ("/fabric/fallback", json!("denied_by_contract")),
        (
            "/fallbackPolicy",
            json!("ai-unavailable-no-automatic-fallback"),
        ),
        (
            "/rolloutGate",
            json!("lane-benchmarks-and-rollout-governance-required"),
        ),
    ] {
        if value.pointer(pointer) != Some(&expected) {
            return Err(RuntimeError::InvalidResponse);
        }
    }
    decode(value)
}

const PATIENT_PROFILE_SEALED: &[&str] = &["address", "phone", "caregiver"];
const PATIENT_FIELDS: &[Field] = &[
    ("address", false, false),
    ("phone", false, false),
    ("caregiver", false, true),
    ("exemptions", false, true),
    ("diagnoses", false, true),
    ("notes", false, false),
    ("statusReason", false, false),
    ("archiveReason", false, false),
    ("archiveNote", false, false),
];
const ENTRY_FIELDS: &[Field] = &[
    ("title", true, false),
    ("content", true, false),
    ("metadata", false, true),
    ("attachments", false, true),
    ("deletionReason", false, false),
];
const THERAPY_FIELDS: &[Field] = &[
    ("motivation", false, false),
    ("deletionReason", false, false),
];
const OBSERVATION_FIELDS: &[Field] = &[("notes", false, false), ("deletionReason", false, false)];
const CHECKUP_FIELDS: &[Field] = &[("notes", false, false), ("deletionReason", false, false)];
const ATTACHMENT_FIELDS: &[Field] = &[
    ("name", true, false),
    ("path", true, false),
    ("data", false, false),
    ("summarySnapshot", false, false),
    ("parseEvidenceArtifactSnapshot", false, false),
];

fn read_key(scope: &str, patient: &str, domain: &str, id: &str) -> ReadKey {
    ReadKey {
        scope: scope.into(),
        patient: patient.into(),
        domain: domain.into(),
        id: id.into(),
    }
}

fn validate_patient_name(value: &str) -> Result<()> {
    if value.trim_matches(crate::js_whitespace).is_empty() {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(())
}

fn parse_contract_date(value: &str) -> Result<chrono::DateTime<chrono::FixedOffset>> {
    use chrono::Timelike as _;
    let date =
        chrono::DateTime::parse_from_rfc3339(value).map_err(|_| RuntimeError::InvalidInput)?;
    // JavaScript Date does not accept leap seconds or values beyond TimeClip.
    if date.nanosecond() >= 1_000_000_000
        || date.timestamp_millis().unsigned_abs() > 8_640_000_000_000_000
    {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(date)
}

fn aggregate_query(
    date_from: &Option<String>,
    date_to: &Option<String>,
    limit: Option<u16>,
    max_limit: u16,
) -> Result<Vec<(&'static str, String)>> {
    let from = date_from.as_deref().map(parse_contract_date).transpose()?;
    let to = date_to.as_deref().map(parse_contract_date).transpose()?;
    if from.zip(to).is_some_and(|(from, to)| from > to)
        || limit.is_some_and(|limit| limit == 0 || limit > max_limit)
    {
        return Err(RuntimeError::InvalidInput);
    }
    let mut query = Vec::new();
    if let Some(from) = date_from {
        query.push(("dateFrom", from.clone()));
    }
    if let Some(to) = date_to {
        query.push(("dateTo", to.clone()));
    }
    if let Some(limit) = limit {
        query.push(("limit", limit.to_string()));
    }
    Ok(query)
}

fn decode<T: DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)
}
fn valid_wire_id(id: &str) -> Result<()> {
    validate_id(id).map_err(|_| RuntimeError::InvalidResponse)
}
fn valid_wire_version(version: u64) -> Result<()> {
    validate_version(version).map_err(|_| RuntimeError::InvalidResponse)
}

fn require_bound_scope_identity(identity: &Value, scope: &str, user_id: &str) -> Result<()> {
    if identity["scope"]["requestBinding"] != "expected-ambulatory-id-v1" {
        return Err(RuntimeError::UnsupportedProtocol);
    }
    if identity["scope"]["effectiveAmbulatoryId"].as_str() != Some(scope)
        || identity["operator"]["userId"].as_str() != Some(user_id)
        || identity["operator"]["authChannel"] != "native"
    {
        return Err(RuntimeError::Forbidden);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
        thread,
        time::Duration,
    };
    impl RuntimeSession {
        #[allow(clippy::too_many_arguments)]
        fn fixture_read(
            &self,
            epoch: u64,
            scope: &str,
            patient: &str,
            domain: &str,
            id: &str,
            version: u64,
            locked: Vec<String>,
        ) -> Result<()> {
            if domain != "patients" {
                return self.remember(epoch, scope, patient, domain, id, version, locked);
            }
            self.check_read_epoch(epoch)?;
            let pending = self.profile_query_intent();
            if self
                .profile_target_matches(&pending, scope, patient)
                .is_err()
            {
                self.select_profile_patient(scope, patient)?;
            }
            let intent = self.profile_query_intent();
            self.remember_profile(
                epoch,
                scope,
                patient,
                &intent,
                ProfileLease {
                    handle: Zeroizing::new(format!("pph_{}", "a".repeat(64))),
                    currentness: ProfileCurrentness {
                        revision: version,
                        selection_epoch: 3,
                        observed_at: 1000,
                        expires_at: 61000,
                    },
                    deadline: Instant::now() + Duration::from_secs(60),
                },
                locked,
            )
        }
    }

    fn session() -> RuntimeSession {
        session_at("http://127.0.0.1:43181")
    }
    fn session_at(base_url: &str) -> RuntimeSession {
        RuntimeSession::new(
            RuntimeClient::new(RuntimeConfig {
                base_url: base_url.into(),
                tls_pin_sha256: None,
            })
            .unwrap(),
            RuntimeUser {
                id: "synthetic-user".into(),
                username: "synthetic".into(),
                display_name: None,
                role: "admin".into(),
                archive_generation: "synthetic-generation".into(),
            },
            PairingCredentials::new("synthetic-device", "x".repeat(64)).unwrap(),
            Zeroizing::new("a".repeat(64)),
            Zeroizing::new([7; 32]),
        )
    }

    #[test]
    fn host_ports_reject_incompatible_revision_and_scope() {
        for contract in [
            json!({"revision": 99, "writer": "host", "ports": []}),
            json!({"revision": 1, "writer": "host", "ports": [
                {"id":"clinical", "revision":1, "scope":"operator", "authority":"paired-operator", "state":"available"}
            ]}),
            Value::Null,
        ] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                assert!(read_request(&mut stream).starts_with("GET /api/v1/network/capabilities "));
                send_reply(
                    &mut stream,
                    &json!({
                        "protocolVersion":"1.14.0", "operatingMode":"network-home-base",
                        "capabilities":[], "hostPorts":contract
                    })
                    .to_string(),
                );
            });
            let result = session.refresh_capabilities();
            server.join().unwrap();
            assert_eq!(result, Err(RuntimeError::UnsupportedProtocol));
        }
    }

    #[test]
    fn lock_cancels_pending_headers_and_body_before_server_release() {
        for body_started in [false, true] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
            let reader = session.clone();
            let (seen_tx, seen_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let (closed_tx, closed_rx) = mpsc::channel();
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                read_request(&mut stream);
                if body_started {
                    stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10000\r\nConnection: close\r\n\r\n{").unwrap();
                }
                seen_tx.send(()).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                closed_tx.send(stream.read(&mut [0])).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            });
            let (done_tx, done_rx) = mpsc::channel();
            let worker = thread::spawn(move || {
                done_tx
                    .send(reader.read_ai_runtime_status().map(|_| ()))
                    .unwrap();
            });
            seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            session.lock();
            let prompt = done_rx.recv_timeout(Duration::from_secs(1));
            let shutdown = closed_rx.recv_timeout(Duration::from_secs(2));
            release_tx.send(()).unwrap();
            worker.join().unwrap();
            server.join().unwrap();
            assert!(
                matches!(shutdown, Ok(Ok(0)))
                    || matches!(shutdown, Ok(Err(ref error)) if error.kind() == std::io::ErrorKind::ConnectionReset),
                "socket did not close: {shutdown:?}"
            );
            assert!(
                matches!(prompt, Ok(Err(RuntimeError::Locked))),
                "pending body={body_started}: {prompt:?}"
            );
        }
    }

    #[test]
    fn selection_change_cancels_pending_ports_and_preserves_the_new_context() {
        for mutation in [false, true] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let mut session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
            let old = session.clone();
            let (seen_tx, seen_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                assert!(request.starts_with(if mutation {
                    "PUT /api/auth/profile "
                } else {
                    "GET /api/v1/network/ai-runtime "
                }));
                seen_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                drop(stream);
                let (mut fresh, _) = listener.accept().unwrap();
                assert!(read_request(&mut fresh).starts_with("GET /api/v1/network/ai-runtime "));
                send_reply(&mut fresh, &ai_status_wire().to_string());
                listener.set_nonblocking(true).unwrap();
                assert!(
                    listener.accept().is_err(),
                    "cancellation must never retry a mutation"
                );
            });
            let (done_tx, done_rx) = mpsc::channel();
            let worker = thread::spawn(move || {
                let result = if mutation {
                    old.request(
                        Method::PUT,
                        ACCOUNT_PROFILE_PATH,
                        &[],
                        None,
                        Some(&json!({"synthetic":true})),
                        true,
                        ACCOUNT_PROFILE_LIMIT,
                    )
                    .map(|_| ())
                } else {
                    old.read_ai_runtime_status().map(|_| ())
                };
                done_tx.send(result).unwrap();
            });
            seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            session.renew_requests();
            let prompt = done_rx.recv_timeout(Duration::from_secs(1));
            release_tx.send(()).unwrap();
            assert!(session.read_ai_runtime_status().is_ok());
            worker.join().unwrap();
            server.join().unwrap();
            assert_eq!(
                prompt.unwrap(),
                Err(if mutation {
                    RuntimeError::Indeterminate
                } else {
                    RuntimeError::ReadRequired
                })
            );
            assert!(!session.is_locked());
        }
    }

    #[test]
    fn archive_replacement_revokes_other_pending_requests() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
        let reader = session.clone();
        let (seen_tx, seen_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut pending, _) = listener.accept().unwrap();
            read_request(&mut pending);
            seen_tx.send(()).unwrap();
            let (mut replaced, _) = listener.accept().unwrap();
            read_request(&mut replaced);
            let body = r#"{"code":"ARCHIVE_REPLACED"}"#;
            write!(
                replaced,
                "HTTP/1.1 409 Conflict\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        });
        let (done_tx, done_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            done_tx
                .send(reader.read_ai_runtime_status().map(|_| ()))
                .unwrap();
        });
        seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let replaced = session.read_ai_runtime_status().map(|_| ());
        let prompt = done_rx.recv_timeout(Duration::from_secs(1));
        release_tx.send(()).unwrap();
        worker.join().unwrap();
        server.join().unwrap();
        assert_eq!(replaced, Err(RuntimeError::ArchiveReplaced));
        assert!(
            session.is_locked(),
            "replacement must retire all session authority"
        );
        assert!(
            matches!(prompt, Ok(Err(RuntimeError::Locked))),
            "{prompt:?}"
        );
    }

    fn ai_status_wire() -> Value {
        json!({
            "plane":"ai-plane-separate-from-data-plane", "mode":"centralized-available",
            "localRuntime": { "provider":"ollama", "state":"configured", "targetPolicy":"loopback-only",
                "hardwareProfile":"unknown", "clinicalModel":"synthetic-model", "reasoningModel":null, "ocrModel":null },
            "centralRuntime": { "state":"available", "capabilityStatus":"available", "requiresPairing":true,
                "executionTarget":"paired-home-base", "accessMode":"status-only", "executionAuthorized":false },
            "fabric": { "schemaVersion":"mediflow.ai.network-fabric-status.v1", "contractVersion":"mediflow.ai.fabric.v1",
                "access":"status_only", "pairedExecution":"not_authorized", "egressGateOpen":false,
                "readinessNote":"available_unqualified", "fallback":"denied_by_contract",
                "venues": { "local_process":"configured", "home_base":"host_configured", "on_device":"not_implemented", "cloud":"egress_profile_closed" } },
            "fallbackPolicy":"ai-unavailable-no-automatic-fallback", "rolloutGate":"lane-benchmarks-and-rollout-governance-required",
            "surfaces":["patient-insight","smart-import","document-synthesis","treatment-reasoning"],
            "killSwitches": { "patientInsight":"enabled", "smartImport":"disabled", "documentSynthesis":"enabled", "treatmentReasoning":"disabled" },
            "guardrails":[]
        })
    }

    #[test]
    fn ai_preferences_use_paired_preview_then_exact_confirmation_and_readback() {
        use crate::ai_preferences::tests::{preferences_wire, preview_wire};
        for changed_after_save in [false, true] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
            let context = session.ai_preferences_context();
            let (seen_tx, seen_rx) = mpsc::channel();
            let server = thread::spawn(move || {
                let mut preview_body = Value::Null;
                let mut proposed = preferences_wire();
                proposed["revision"] = json!(format!("sha256_{}", "d".repeat(64)));
                for row in proposed["functions"].as_array_mut().unwrap() {
                    row["enabled"] = json!(false);
                }
                for (index, expected) in [
                    "GET /api/v1/network/ai/functions ",
                    "POST /api/v1/network/ai/functions/preview ",
                    "POST /api/v1/network/ai/functions ",
                    "GET /api/v1/network/ai/functions ",
                ]
                .into_iter()
                .enumerate()
                {
                    let (mut stream, _) = listener.accept().unwrap();
                    let request = read_request(&mut stream);
                    assert!(request.starts_with(expected));
                    for header in [
                        "x-mediflow-paired-client-id: synthetic-device",
                        "x-mediflow-paired-client-token:",
                        "cookie:",
                        "x-mediflow-source-surface: native",
                        "x-mediflow-archive-generation: synthetic-generation",
                    ] {
                        assert!(request.contains(header), "{header}");
                    }
                    assert!(
                        !request.contains("authorization:")
                            && !request.contains("expected-ambulatory-id:")
                    );
                    let body = match index {
                        0 => preferences_wire(),
                        1 => {
                            preview_body =
                                serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1)
                                    .unwrap();
                            json!({"schemaVersion":"mediflow.function-preferences-preview.v1", "command":preview_body,
                                "proposed":proposed, "writesPerformed":0})
                        }
                        2 => {
                            let posted: Value =
                                serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1)
                                    .unwrap();
                            assert_eq!(posted, preview_body);
                            assert_eq!(posted["presetId"], "all_off");
                            proposed.clone()
                        }
                        _ => {
                            if changed_after_save {
                                proposed["revision"] = json!(format!("sha256_{}", "f".repeat(64)));
                            }
                            proposed.clone()
                        }
                    };
                    seen_tx.send(index).unwrap();
                    send_reply(&mut stream, &body.to_string());
                }
            });
            let snapshot = session.read_ai_preferences(&context).unwrap();
            let command = AiPreferencesCommand::new(
                &snapshot,
                AiPreferenceChange::Preset {
                    preset_id: AiPreferencePreset::AllOff,
                },
            )
            .unwrap();
            let preview = session.preview_ai_preferences(&context, &command).unwrap();
            assert_eq!(seen_rx.try_iter().collect::<Vec<_>>(), [0, 1]);
            assert_eq!(
                preview.proposed,
                parse_preferences(preview_wire(&command)["proposed"].clone()).unwrap()
            );
            // Preview alone sent no configuration POST. Confirmation is separate.
            let readback = session.apply_ai_preferences(&context, &preview).unwrap();
            assert_eq!(readback.matches_confirmation, !changed_after_save);
            assert!(readback.observed.functions.iter().all(|row| !row.enabled));
            assert_eq!(seen_rx.try_iter().collect::<Vec<_>>(), [2, 3]);
            server.join().unwrap();
            assert!(
                session.inner.reads.lock().unwrap().is_empty(),
                "no clinical write receipt"
            );
        }
    }

    #[test]
    fn ai_preferences_denial_conflict_and_lost_response_never_retry_or_claim_readback() {
        use crate::ai_preferences::tests::{preferences_wire, preview_wire};
        for (status, expected) in [
            (401, RuntimeError::Authentication),
            (403, RuntimeError::Forbidden),
            (409, RuntimeError::Conflict),
            (503, RuntimeError::Indeterminate),
            (0, RuntimeError::Indeterminate),
        ] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
            let context = session.ai_preferences_context();
            let command = AiPreferencesCommand::new(
                &parse_preferences(preferences_wire()).unwrap(),
                AiPreferenceChange::Preset {
                    preset_id: AiPreferencePreset::AllOff,
                },
            )
            .unwrap();
            let preview = parse_preferences_preview(preview_wire(&command), &command).unwrap();
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                assert!(
                    read_request(&mut stream).starts_with("POST /api/v1/network/ai/functions ")
                );
                if status != 0 {
                    write!(
                        stream,
                        "HTTP/1.1 {status} Test\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    )
                    .unwrap();
                }
                listener
            });
            assert!(
                matches!(session.apply_ai_preferences(&context, &preview), Err(error) if error == expected)
            );
            assert_eq!(session.is_locked(), expected.is_auth_failure());
            let listener = server.join().unwrap();
            listener.set_nonblocking(true).unwrap();
            assert!(
                matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
            );
        }
    }

    #[test]
    fn ai_preferences_context_role_and_lock_fence_precede_any_request() {
        use crate::ai_preferences::tests::{preferences_wire, preview_wire};
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
        let context = session.ai_preferences_context();
        let command = AiPreferencesCommand::new(
            &parse_preferences(preferences_wire()).unwrap(),
            AiPreferenceChange::Preset {
                preset_id: AiPreferencePreset::AllOff,
            },
        )
        .unwrap();
        let preview = parse_preferences_preview(preview_wire(&command), &command).unwrap();
        let foreign = session_at(&format!("http://{}", listener.local_addr().unwrap()));
        assert!(matches!(
            foreign.read_ai_preferences(&context),
            Err(RuntimeError::ReadRequired)
        ));
        context.cancel();
        assert!(matches!(
            session.read_ai_preferences(&context),
            Err(RuntimeError::ReadRequired)
        ));
        assert!(matches!(
            session.preview_ai_preferences(&context, &command),
            Err(RuntimeError::ReadRequired)
        ));
        assert!(matches!(
            session.apply_ai_preferences(&context, &preview),
            Err(RuntimeError::ReadRequired)
        ));
        let mut non_admin = session_at(&format!("http://{}", listener.local_addr().unwrap()));
        Arc::get_mut(&mut non_admin.inner).unwrap().user.role = "user".into();
        assert!(matches!(
            non_admin.read_ai_preferences(&non_admin.ai_preferences_context()),
            Err(RuntimeError::Forbidden)
        ));
        let context = session.ai_preferences_context();
        session.lock();
        assert!(matches!(
            session.apply_ai_preferences(&context, &preview),
            Err(RuntimeError::Locked)
        ));
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    }

    fn account_profile_snapshot() -> AccountProfileSnapshot {
        AccountProfileSnapshot {
            user_id: "synthetic-user".into(),
            username: "synthetic".into(),
            display_name: Some("Dott.ssa Sintetica".into()),
            ambulatory_name: None,
            profile_version: "p1:synthetic".into(),
            archive_generation: "synthetic-generation".into(),
        }
    }
    fn account_profile_read_wire() -> Value {
        json!({
            "operation": "account-profile.read.v1", "contractVersion": 1,
            "userId": "synthetic-user", "username": "synthetic",
            "displayName": "Dott.ssa Sintetica", "ambulatoryName": null,
            "profileVersion": "p1:synthetic", "archiveGeneration": "synthetic-generation"
        })
    }
    fn account_profile_update_wire(changed: bool) -> Value {
        json!({
            "changed": changed,
            "userId": "synthetic-user", "username": "synthetic",
            "displayName": "Dott. Sintetico", "ambulatoryName": null,
            "profileVersion": "p1:updated", "archiveGeneration": "synthetic-generation"
        })
    }
    fn profile_server(
        status: u16,
        body: Value,
    ) -> (
        String,
        mpsc::Receiver<String>,
        thread::JoinHandle<TcpListener>,
    ) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (seen_tx, seen_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_request(&mut stream);
            let body = body.to_string();
            write!(
                stream,
                "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            let _ = seen_tx.send(request);
            listener
        });
        (url, seen_rx, worker)
    }

    #[test]
    fn account_profile_read_and_update_send_only_the_closed_conditional_contract() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (seen_tx, seen_rx) = mpsc::channel();
        let expected_body = account_profile_update_wire(true);
        let read_body = account_profile_read_wire();
        let server = thread::spawn(move || {
            for (index, response) in [read_body, expected_body].into_iter().enumerate() {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                seen_tx.send((index, request)).unwrap();
                let body = response.to_string();
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
            listener
        });
        let session = session_at(&url);
        let read = session.read_account_profile().unwrap();
        assert_eq!(read.display_name.as_deref(), Some("Dott.ssa Sintetica"));
        let outcome = session
            .update_account_profile(&read.snapshot(), Some("  Dott. Sintetico  "), Some("   "))
            .unwrap();
        let AccountProfileUpdateOutcome::Saved { changed, profile } = outcome else {
            panic!("expected the confirmed save");
        };
        assert!(changed);
        assert_eq!(profile.ambulatory_name, None);
        assert_eq!(profile.profile_version, "p1:updated");

        let (index, request) = seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(index, 0);
        assert!(request.starts_with("GET /api/auth/profile "));
        for header in [
            "x-mediflow-paired-client-id: synthetic-device",
            "x-mediflow-paired-client-token:",
            "cookie:",
            "x-mediflow-source-surface: native",
            "x-mediflow-archive-generation: synthetic-generation",
        ] {
            assert!(request.contains(header), "{header}");
        }
        let (index, request) = seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(index, 1);
        assert!(request.starts_with("PUT /api/auth/profile "));
        assert!(request.contains("x-mediflow-archive-generation: synthetic-generation"));
        let posted: Value =
            serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(posted.as_object().unwrap().len(), 3);
        assert_eq!(posted["expectedVersion"], "p1:synthetic");
        assert_eq!(posted["displayName"], "Dott. Sintetico");
        assert_eq!(posted["ambulatoryName"], Value::Null);
        assert!(posted.get("id").is_none() && posted.get("userId").is_none());
        server.join().unwrap();
    }

    #[test]
    fn account_profile_conflict_archive_replacement_and_rejection_stay_distinct() {
        let conflict = json!({
            "userId": "synthetic-user", "username": "synthetic",
            "displayName": "Altro client", "ambulatoryName": "Altro studio",
            "profileVersion": "p1:other", "archiveGeneration": "synthetic-generation",
            "code": "PROFILE_VERSION_CONFLICT", "error": "Il profilo è cambiato."
        });
        let (url, seen, server) = profile_server(409, conflict);
        let session = session_at(&url);
        let outcome = session
            .update_account_profile(&account_profile_snapshot(), Some("Bozza"), None)
            .unwrap();
        let AccountProfileUpdateOutcome::VersionConflict { current } = outcome else {
            panic!("expected the conflict state");
        };
        assert_eq!(current.profile_version, "p1:other");
        assert_eq!(current.display_name.as_deref(), Some("Altro client"));
        let request = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(request.starts_with("PUT /api/auth/profile "));
        let listener = server.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock),
            "a conflict must never trigger an automatic retry"
        );

        let (url, _, server) =
            profile_server(409, json!({"error":"archivio","code":"ARCHIVE_REPLACED"}));
        let session = session_at(&url);
        assert_eq!(
            session.update_account_profile(&account_profile_snapshot(), Some("Bozza"), None),
            Err(RuntimeError::ArchiveReplaced)
        );
        let listener = server.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );

        let (url, _, server) = profile_server(400, json!({"error":"Payload non valido"}));
        let session = session_at(&url);
        assert_eq!(
            session.update_account_profile(&account_profile_snapshot(), Some("Bozza"), None),
            Err(RuntimeError::Rejected(400))
        );
        server.join().unwrap();

        let (url, _, server) = profile_server(401, json!({"error":"Unauthorized"}));
        let session = session_at(&url);
        assert_eq!(
            session.update_account_profile(&account_profile_snapshot(), Some("Bozza"), None),
            Err(RuntimeError::Authentication)
        );
        assert!(session.is_locked());
        server.join().unwrap();
    }

    #[test]
    fn account_profile_read_requires_the_session_subject_and_no_archive_substitution() {
        let mut wire = account_profile_read_wire();
        wire["userId"] = json!("another-user");
        let (url, _, server) = profile_server(200, wire);
        let session = session_at(&url);
        assert_eq!(
            session.read_account_profile(),
            Err(RuntimeError::InvalidResponse)
        );
        server.join().unwrap();

        let (url, _, server) =
            profile_server(409, json!({"error":"archivio","code":"ARCHIVE_REPLACED"}));
        let session = session_at(&url);
        assert_eq!(
            session.read_account_profile(),
            Err(RuntimeError::ArchiveReplaced)
        );
        server.join().unwrap();
    }

    #[test]
    fn account_profile_responses_from_another_archive_are_never_adopted() {
        let mut read = account_profile_read_wire();
        read["archiveGeneration"] = json!("another-generation");
        let (url, _, server) = profile_server(200, read);
        let session = session_at(&url);
        assert_eq!(
            session.read_account_profile(),
            Err(RuntimeError::ArchiveReplaced)
        );
        server.join().unwrap();

        let mut update = account_profile_update_wire(true);
        update["archiveGeneration"] = json!("another-generation");
        let (url, _, server) = profile_server(200, update);
        let session = session_at(&url);
        assert_eq!(
            session.update_account_profile(&account_profile_snapshot(), Some("Bozza"), None),
            Err(RuntimeError::ArchiveReplaced)
        );
        let listener = server.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock),
            "a foreign-archive confirmation must not be retried"
        );

        let conflict = json!({
            "userId": "synthetic-user", "username": "synthetic",
            "displayName": "Altro client", "ambulatoryName": "Altro studio",
            "profileVersion": "p1:other", "archiveGeneration": "another-generation",
            "code": "PROFILE_VERSION_CONFLICT", "error": "Il profilo è cambiato."
        });
        let (url, _, server) = profile_server(409, conflict);
        let session = session_at(&url);
        assert_eq!(
            session.update_account_profile(&account_profile_snapshot(), Some("Bozza"), None),
            Err(RuntimeError::ArchiveReplaced)
        );
        server.join().unwrap();
    }

    #[test]
    fn ai_preferences_retirement_during_apply_suppresses_followup_read() {
        use crate::ai_preferences::tests::{preferences_wire, preview_wire};
        for lock in [false, true] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
            let context = session.ai_preferences_context();
            let command = AiPreferencesCommand::new(
                &parse_preferences(preferences_wire()).unwrap(),
                AiPreferenceChange::Preset {
                    preset_id: AiPreferencePreset::AllOff,
                },
            )
            .unwrap();
            let preview = parse_preferences_preview(preview_wire(&command), &command).unwrap();
            let proposed = serde_json::to_string(&preview.proposed).unwrap();
            let (seen_tx, seen_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                assert!(
                    read_request(&mut stream).starts_with("POST /api/v1/network/ai/functions ")
                );
                seen_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                send_reply(&mut stream, &proposed);
                listener
            });
            let writer = session.clone();
            let request_context = context.clone();
            let worker =
                thread::spawn(move || writer.apply_ai_preferences(&request_context, &preview));
            seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            if lock {
                session.lock();
            } else {
                context.cancel();
            }
            release_tx.send(()).unwrap();
            assert!(matches!(
                worker.join().unwrap(),
                Err(RuntimeError::Indeterminate)
            ));
            let listener = server.join().unwrap();
            listener.set_nonblocking(true).unwrap();
            assert!(
                matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
            );
        }
    }

    #[test]
    fn ai_runtime_status_preserves_disabled_and_missing_values_and_rejects_new_authority() {
        let mut wire = ai_status_wire();
        let configured = parse_ai_runtime_status(wire.clone()).unwrap();
        assert!(configured.kill_switches.patient_insight == AiFunctionSwitch::Enabled);
        assert!(configured.kill_switches.smart_import == AiFunctionSwitch::Disabled);
        assert_eq!(
            configured.local_runtime.clinical_model.as_deref(),
            Some("synthetic-model")
        );
        assert!(configured.local_runtime.reasoning_model.is_none());
        for (local, central) in [("misconfigured", "unavailable"), ("configured", "disabled")] {
            wire["localRuntime"]["state"] = json!(local);
            wire["centralRuntime"]["state"] = json!(central);
            let status = parse_ai_runtime_status(wire.clone()).unwrap();
            assert!(
                (status.local_runtime.state == AiLocalState::Configured) == (local == "configured")
            );
            assert!(
                (status.central_runtime.state == AiCentralState::Disabled)
                    == (central == "disabled")
            );
        }
        for (pointer, replacement) in [
            ("/centralRuntime/executionAuthorized", json!(true)),
            ("/centralRuntime/accessMode", json!("execute")),
            ("/fabric/schemaVersion", json!("unknown")),
            ("/fabric/pairedExecution", json!("authorized")),
            ("/fabric/egressGateOpen", json!(true)),
            ("/fabric/readinessNote", json!("qualified")),
            ("/fabric/fallback", json!("automatic")),
            ("/killSwitches/patientInsight", Value::Null),
            ("/killSwitches/smartImport", json!("unknown")),
            ("/localRuntime/state", json!("running")),
            ("/centralRuntime/state", json!("ready-for-inference")),
        ] {
            let mut changed = ai_status_wire();
            *changed.pointer_mut(pointer).unwrap() = replacement;
            assert!(
                matches!(
                    parse_ai_runtime_status(changed),
                    Err(RuntimeError::InvalidResponse)
                ),
                "{pointer}"
            );
        }
        wire["killSwitches"]
            .as_object_mut()
            .unwrap()
            .remove("treatmentReasoning");
        assert!(matches!(
            parse_ai_runtime_status(wire),
            Err(RuntimeError::InvalidResponse)
        ));
    }

    #[test]
    fn ai_runtime_status_uses_only_paired_discovery_and_drops_a_response_after_lock() {
        for lock_during_read in [false, true] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
            let reader = session.clone();
            let (seen_tx, seen_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                assert!(request.starts_with("GET /api/v1/network/ai-runtime "));
                assert!(request.contains("\r\nx-mediflow-paired-client-id: synthetic-device\r\n"));
                assert!(request.contains("\r\ncookie: "));
                assert!(
                    !request.contains("authorization:")
                        && !request.contains("expected-ambulatory-id:")
                );
                seen_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                send_reply(&mut stream, &ai_status_wire().to_string());
            });
            let (done_tx, done_rx) = mpsc::channel();
            let worker = thread::spawn(move || {
                let result = reader.read_ai_runtime_status();
                done_tx.send(()).unwrap();
                result
            });
            seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            if lock_during_read {
                session.lock();
            }
            let completed_before_release =
                !lock_during_read || done_rx.recv_timeout(Duration::from_secs(1)).is_ok();
            release_tx.send(()).unwrap();
            let result = worker.join().unwrap();
            server.join().unwrap();
            assert!(completed_before_release);
            if lock_during_read {
                assert!(matches!(result, Err(RuntimeError::Locked)));
            } else {
                assert!(result.unwrap().central_runtime.state == AiCentralState::Available);
            }
            assert!(session.inner.reads.lock().unwrap().is_empty());
            assert!(session.inner.profile_reads.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn scoped_operations_require_host_support_and_exact_native_identity() {
        let identity = json!({
            "scope": {"effectiveAmbulatoryId": "scope-a", "requestBinding": "expected-ambulatory-id-v1"},
            "operator": {"userId": "synthetic-user", "authChannel": "native"}
        });
        assert_eq!(
            require_bound_scope_identity(&identity, "scope-a", "synthetic-user"),
            Ok(())
        );
        for unsupported in [Value::Null, json!(false), json!("unknown-v2")] {
            let mut old_host = identity.clone();
            old_host["scope"]["requestBinding"] = unsupported;
            assert_eq!(
                require_bound_scope_identity(&old_host, "scope-a", "synthetic-user"),
                Err(RuntimeError::UnsupportedProtocol)
            );
        }
        let mut old_host = identity.clone();
        old_host["scope"]
            .as_object_mut()
            .unwrap()
            .remove("requestBinding");
        assert_eq!(
            require_bound_scope_identity(&old_host, "scope-a", "synthetic-user"),
            Err(RuntimeError::UnsupportedProtocol)
        );
        for (group, field, value) in [
            ("scope", "effectiveAmbulatoryId", "scope-default"),
            ("operator", "userId", "different-user"),
            ("operator", "authChannel", "web"),
        ] {
            let mut mismatched = identity.clone();
            mismatched[group][field] = json!(value);
            assert_eq!(
                require_bound_scope_identity(&mismatched, "scope-a", "synthetic-user"),
                Err(RuntimeError::Forbidden)
            );
        }
    }

    #[test]
    fn read_binding_separates_session_patient_scope_version_and_locked_field() {
        let first = session();
        let second = session();
        first
            .fixture_read(
                0,
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                2,
                vec!["address".into()],
            )
            .unwrap();
        assert!(
            first
                .require_read(
                    "scope-a",
                    "patient-a",
                    "patients",
                    "patient-a",
                    2,
                    &["notes"]
                )
                .is_ok()
        );
        assert_eq!(
            first.require_read(
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                2,
                &["address"]
            ),
            Err(RuntimeError::LockedField)
        );
        for (scope, patient, version) in [
            ("scope-b", "patient-a", 2),
            ("scope-a", "patient-b", 2),
            ("scope-a", "patient-a", 1),
        ] {
            assert_eq!(
                first.require_read(scope, patient, "patients", patient, version, &["notes"]),
                Err(RuntimeError::ReadRequired)
            );
        }
        assert_eq!(
            second.require_read(
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                2,
                &["notes"]
            ),
            Err(RuntimeError::ReadRequired)
        );
        assert_eq!(
            first.fixture_read(
                0,
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                1,
                vec![]
            ),
            Err(RuntimeError::ReadRequired)
        );
        assert!(
            first
                .require_read(
                    "scope-a",
                    "patient-a",
                    "patients",
                    "patient-a",
                    2,
                    &["notes"]
                )
                .is_ok()
        );
    }
    #[test]
    fn clone_lock_wipes_key_and_duplicate_gate_is_shared() {
        let session = session();
        let clone = session.clone();
        let guard = session.begin_write().unwrap();
        assert!(matches!(clone.begin_write(), Err(RuntimeError::Busy)));
        drop(guard);
        clone.lock();
        assert!(session.is_locked());
        assert!(session.inner.secrets.lock().unwrap().master.is_none());
        assert!(matches!(session.begin_write(), Err(RuntimeError::Locked)));
    }
    #[test]
    fn bad_ciphertext_is_locked_and_nullable_notes_remain_distinct_from_empty() {
        let session = session();
        let mut value = json!({"notes":"ENC:broken:data", "address":null});
        assert_eq!(
            session.decrypt_fields(&mut value, PATIENT_FIELDS).unwrap(),
            vec!["notes"]
        );
        assert!(value["notes"].is_null());
        assert!(value["address"].is_null());
        let mut sealed = session
            .seal_fields(json!({"notes":"", "address":null}), &["notes", "address"])
            .unwrap();
        assert!(sealed["notes"].as_str().unwrap().starts_with("ENC:"));
        assert!(
            session
                .decrypt_fields(&mut sealed, PATIENT_FIELDS)
                .unwrap()
                .is_empty()
        );
        assert_eq!(sealed["notes"], "");
        assert!(sealed["address"].is_null());
    }
    #[test]
    fn versions_follow_positive_javascript_safe_integer_contract() {
        assert!(validate_version(0).is_err());
        assert!(validate_version(1).is_ok());
        assert!(validate_version(MAX_SAFE_VERSION).is_ok());
        assert!(validate_version(MAX_SAFE_VERSION + 1).is_err());
        // MAX is a valid observation; the existing writer decides exhaustion.
        assert!(
            decode::<PatientSummary>(
                json!({"id":"p", "firstName":"A", "lastName":"B", "taxCode":"C", "version":1.5})
            )
            .is_err()
        );
    }

    #[test]
    fn aggregate_filters_reject_invalid_dates_ranges_limits_and_empty_types() {
        for invalid in [
            "2026-02-30T00:00:00Z",
            "2026-10-17",
            "2016-12-31T23:59:60Z",
            "",
            "2026-10-17T00:00:00Z&limit=500",
        ] {
            assert_eq!(
                aggregate_query(&Some(invalid.into()), &None, None, 100),
                Err(RuntimeError::InvalidInput)
            );
        }
        assert_eq!(
            aggregate_query(
                &Some("2026-10-18T00:00:00Z".into()),
                &Some("2026-10-17T00:00:00Z".into()),
                None,
                100
            ),
            Err(RuntimeError::InvalidInput)
        );
        for limit in [0, 101] {
            assert_eq!(
                aggregate_query(&None, &None, Some(limit), 100),
                Err(RuntimeError::InvalidInput)
            );
        }
        assert!(
            aggregate_query(
                &Some("2026-10-17T02:00:00+02:00".into()),
                &Some("2026-10-17T00:00:00Z".into()),
                Some(100),
                100
            )
            .is_ok()
        );
        let session = session();
        for kind in ["", " \u{feff}", "note\nother"] {
            assert!(matches!(
                session.list_global_entries_with_filter(
                    "scope-a",
                    &GlobalEntryFilter {
                        entry_type: Some(kind.into()),
                        ..Default::default()
                    }
                ),
                Err(RuntimeError::InvalidInput)
            ));
        }
    }

    #[test]
    fn catalog_route_query_and_lock_stay_inside_the_existing_session_gate() {
        let session = session();
        assert_eq!(
            session.read_catalog::<Value>(
                "scope-a",
                CatalogRoute::Drugs,
                &[("url", "http://other")]
            ),
            Err(RuntimeError::InvalidInput)
        );
        assert_eq!(
            session.read_catalog::<Value>("scope-a", CatalogRoute::Drugs, &[("q", "synthetic")]),
            Err(RuntimeError::Forbidden)
        );
        session.lock();
        assert_eq!(
            session.read_catalog::<Value>("scope-a", CatalogRoute::Drugs, &[("q", "synthetic")]),
            Err(RuntimeError::Locked)
        );
    }

    #[test]
    fn late_read_cannot_reinstall_the_consumed_write_prerequisite() {
        let session = session();
        session
            .fixture_read(
                0,
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                1,
                vec![],
            )
            .unwrap();
        let guard = session.begin_write().unwrap();
        session
            .forget("scope-a", "patient-a", "patients", "patient-a")
            .unwrap();
        assert_eq!(session.check_read_epoch(0), Err(RuntimeError::ReadRequired));
        drop(guard);
        assert_eq!(
            session.fixture_read(
                0,
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                1,
                vec![]
            ),
            Err(RuntimeError::ReadRequired)
        );
        assert_eq!(
            session.require_read(
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                1,
                &["notes"]
            ),
            Err(RuntimeError::ReadRequired)
        );
        session
            .fixture_read(
                1,
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                2,
                vec![],
            )
            .unwrap();
        assert!(
            session
                .require_read(
                    "scope-a",
                    "patient-a",
                    "patients",
                    "patient-a",
                    2,
                    &["notes"]
                )
                .is_ok()
        );
    }

    /// Transport fault fixture only. Production login has no constructor for
    /// these synthetic credentials and never accepts this stub as an issuer.
    fn delayed_server(
        reply: Option<&str>,
    ) -> (
        String,
        mpsc::Receiver<String>,
        mpsc::Sender<()>,
        thread::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (seen_tx, seen_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let reply = reply.map(str::to_owned);
        let worker = thread::spawn(move || {
            // The first ordinary request verifies the explicit scope against
            // the real identity response shape, before the gated request.
            let (mut identity, _) = listener.accept().unwrap();
            let first = read_request(&mut identity);
            assert!(first.starts_with("GET /api/v1/network/identity "));
            assert!(first.contains("\r\nx-mediflow-expected-ambulatory-id: scope-a\r\n"));
            send_reply(
                &mut identity,
                r#"{"scope":{"effectiveAmbulatoryId":"scope-a","requestBinding":"expected-ambulatory-id-v1"},"operator":{"userId":"synthetic-user","authChannel":"native"}}"#,
            );
            drop(identity);
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_request(&mut stream);
            assert!(request.contains("\r\nx-mediflow-expected-ambulatory-id: scope-a\r\n"));
            seen_tx.send(request).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            if let Some(reply) = reply {
                send_reply(&mut stream, &reply);
            }
        });
        (url, seen_rx, release_tx, worker)
    }
    fn read_request(stream: &mut std::net::TcpStream) -> String {
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
        let headers = String::from_utf8(headers).unwrap();
        let length = headers
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(|size| size.trim().parse::<usize>().unwrap())
            })
            .unwrap_or(0);
        assert!(length < 8192);
        let mut body = vec![0; length];
        stream.read_exact(&mut body).unwrap();
        headers + &String::from_utf8(body).unwrap()
    }
    fn send_reply(stream: &mut std::net::TcpStream, body: &str) {
        send_status_reply(stream, 200, body);
    }
    fn send_status_reply(stream: &mut std::net::TcpStream, status: u16, body: &str) {
        let result = write!(
            stream,
            "HTTP/1.1 {status} Synthetic\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        if let Err(error) = result {
            assert!(
                matches!(
                    error.kind(),
                    std::io::ErrorKind::BrokenPipe
                        | std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::ConnectionAborted
                ),
                "unexpected fixture response error: {error}"
            );
        }
    }
    fn admit_fixture_read(session: &RuntimeSession) {
        session
            .inner
            .scopes
            .lock()
            .unwrap()
            .insert("scope-a".into());
        session
            .fixture_read(
                0,
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                1,
                vec![],
            )
            .unwrap();
    }

    #[test]
    fn one_inflight_write_blocks_duplicate_and_late_ack_after_lock_is_unknown() {
        let (url, seen, release, server) = delayed_server(Some(r#"{"success":true}"#));
        let session = session_at(&url);
        admit_fixture_read(&session);
        let clone = session.clone();
        let worker = thread::spawn(move || {
            clone.update_patient_notes("scope-a", "patient-a", 1, "synthetic edit")
        });
        let request = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(request.starts_with("PUT /api/v1/network/patients/patient-a "));
        assert!(request.contains("\"notes\":\"ENC:"));
        assert!(!request.contains("synthetic edit"));
        assert_eq!(
            session.update_patient_notes("scope-a", "patient-a", 1, "duplicate"),
            Err(RuntimeError::Busy)
        );
        session.lock();
        release.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), Err(RuntimeError::Indeterminate));
        server.join().unwrap();
        assert!(session.inner.secrets.lock().unwrap().master.is_none());
    }

    #[test]
    fn late_read_after_lock_never_delivers_clinical_data() {
        let (url, seen, release, server) = delayed_server(Some("{}"));
        let session = session_at(&url);
        admit_fixture_read(&session);
        let clone = session.clone();
        let worker = thread::spawn(move || clone.read_patient_legacy("scope-a", "patient-a"));
        assert!(
            seen.recv_timeout(Duration::from_secs(5))
                .unwrap()
                .starts_with("GET /api/v1/network/patients/patient-a ")
        );
        session.lock();
        release.send(()).unwrap();
        assert!(matches!(worker.join().unwrap(), Err(RuntimeError::Locked)));
        server.join().unwrap();
    }

    fn who_readiness_fixture(status: &str) -> Value {
        json!({"schemaVersion":"mediflow.reference-data.icd11-who-readiness.v2",
            "status":status,"releaseId":"2026-01","language":"en","deployment":"local",
            "bindingId":"who.icd11.v2.2026-01.mms.en.local.v1",
            "imageDigest":format!("sha256:{}", "a".repeat(64)),
            "datasetSnapshotId":format!("sha256:{}", "b".repeat(64)),
            "lastLiveObservedAt":if status == "available" {Some("2026-10-19T00:00:00.000Z")} else {None},
            "lastResultSource":null})
    }

    #[test]
    fn who_readiness_http_keeps_scope_auth_status_and_byte_limit() {
        for (status, body, oversized, expected) in [
            (
                503,
                who_readiness_fixture("configured"),
                false,
                Ok(WhoReadinessStatus::Configured),
            ),
            (
                200,
                who_readiness_fixture("available"),
                false,
                Ok(WhoReadinessStatus::Available),
            ),
            (
                200,
                who_readiness_fixture("configured"),
                false,
                Err(RuntimeError::InvalidResponse),
            ),
            (
                503,
                json!({"status":"configured"}),
                false,
                Err(RuntimeError::InvalidResponse),
            ),
            (
                401,
                json!({"error":"Unauthorized"}),
                false,
                Err(RuntimeError::Authentication),
            ),
            (
                503,
                who_readiness_fixture("configured"),
                true,
                Err(RuntimeError::TooLarge),
            ),
        ] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
            admit_fixture_read(&session);
            let server = thread::spawn(move || {
                let (mut identity, _) = listener.accept().unwrap();
                assert!(read_request(&mut identity).starts_with("GET /api/v1/network/identity "));
                send_reply(
                    &mut identity,
                    r#"{"scope":{"effectiveAmbulatoryId":"scope-a","requestBinding":"expected-ambulatory-id-v1"},"operator":{"userId":"synthetic-user","authChannel":"native"}}"#,
                );
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                assert!(
                    request
                        .starts_with("GET /api/v1/network/terminology/who/readiness HTTP/1.1\r\n")
                );
                assert!(request.contains("\r\nx-mediflow-expected-ambulatory-id: scope-a\r\n"));
                assert!(request.contains("\r\nx-mediflow-paired-client-id: synthetic-device\r\n"));
                assert!(request.contains("\r\nx-mediflow-source-surface: native\r\n"));
                let body = body.to_string();
                let length = if oversized { 65_537 } else { body.len() };
                write!(stream, "HTTP/1.1 {status} Synthetic\r\nContent-Type: application/json\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n{body}").unwrap();
            });
            assert_eq!(
                session
                    .read_who_readiness("scope-a")
                    .map(|value| value.status),
                expected
            );
            if status == 401 {
                assert!(session.is_locked());
            }
            server.join().unwrap();
        }
    }

    #[test]
    fn who_delivery_after_lock_and_unadmitted_scope_are_rejected() {
        let body = who_readiness_fixture("available").to_string();
        let (url, seen, release, server) = delayed_server(Some(&body));
        let session = session_at(&url);
        assert_eq!(
            session.search_who("scope-a", "synthetic"),
            Err(RuntimeError::Forbidden)
        );
        admit_fixture_read(&session);
        let clone = session.clone();
        let worker = thread::spawn(move || clone.read_who_readiness("scope-a"));
        assert!(
            seen.recv_timeout(Duration::from_secs(5))
                .unwrap()
                .starts_with("GET /api/v1/network/terminology/who/readiness ")
        );
        session.lock();
        release.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), Err(RuntimeError::Locked));
        assert_eq!(
            session.search_who("scope-a", "synthetic"),
            Err(RuntimeError::Locked)
        );
        server.join().unwrap();
    }

    #[test]
    fn attachment_list_requires_payload_key_omission_before_decrypting() {
        let encoder = session();
        let summary = encoder
            .seal_fields(
                json!({"id":"document.a", "patientId":"patient-a",
                    "name":"Documento città 🩺", "path":"documento.txt",
                    "type":"text/plain", "size":4,
                    "summarySnapshot":"Sintesi salvata: città 🩺",
                    "parseEvidenceArtifactSnapshot":"{\"schemaVersion\":\"synthetic\"}",
                    "ocrQueueUpdatedAt":"2026-10-19T08:30:00Z"}),
                &[
                    "name",
                    "path",
                    "summarySnapshot",
                    "parseEvidenceArtifactSnapshot",
                ],
            )
            .unwrap();
        let sealed_payload = encoder
            .seal_fields(json!({"data":"data:text/plain;base64,dGVzdA=="}), &["data"])
            .unwrap();
        for payload in [
            None,
            Some(Value::Null),
            Some(json!("ENC:broken:data")),
            Some(sealed_payload["data"].clone()),
        ] {
            let mut row = summary.clone();
            let omitted = payload.is_none();
            if let Some(payload) = payload {
                row["data"] = payload;
            }
            let body = json!([row]).to_string();
            let (url, seen, release, server) = delayed_server(Some(&body));
            let session = session_at(&url);
            admit_fixture_read(&session);
            let worker = thread::spawn(move || session.list_attachments("scope-a", "patient-a"));
            assert!(
                seen.recv_timeout(Duration::from_secs(5))
                    .unwrap()
                    .starts_with("GET /api/v1/network/patients/patient-a/attachments ")
            );
            release.send(()).unwrap();
            let result = worker.join().unwrap();
            server.join().unwrap();
            if omitted {
                let rows = result.unwrap();
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].name, "Documento città 🩺");
                assert_eq!(
                    rows[0].summary_snapshot.as_deref(),
                    Some("Sintesi salvata: città 🩺")
                );
                assert_eq!(
                    rows[0].parse_evidence_artifact_snapshot.as_deref(),
                    Some("{\"schemaVersion\":\"synthetic\"}")
                );
                assert_eq!(
                    rows[0].ocr_queue_updated_at.as_deref(),
                    Some("2026-10-19T08:30:00Z")
                );
                assert!(rows[0].data.is_none());
                assert!(rows[0].locked_fields.is_empty());
            } else {
                assert!(matches!(result, Err(RuntimeError::InvalidResponse)));
            }
        }
    }

    #[test]
    fn unreadable_document_snapshots_are_distinct_from_missing_snapshots() {
        let session = session();
        let base = json!({"id":"document.a", "patientId":"patient-a",
            "name":"Documento sintetico", "path":"documento.txt", "type":"text/plain", "size":4});
        let absent = session.attachment(base.clone(), "patient-a", None).unwrap();
        assert!(absent.summary_snapshot.is_none());
        assert!(absent.parse_evidence_artifact_snapshot.is_none());
        assert!(absent.locked_fields.is_empty());
        for invalid in [json!("ENC:broken:data"), json!({"unexpected":"object"})] {
            let mut row = base.clone();
            row["summarySnapshot"] = invalid.clone();
            row["parseEvidenceArtifactSnapshot"] = invalid;
            let attachment = session.attachment(row, "patient-a", None).unwrap();
            assert!(attachment.summary_snapshot.is_none());
            assert!(attachment.parse_evidence_artifact_snapshot.is_none());
            assert_eq!(
                attachment.locked_fields,
                ["summarySnapshot", "parseEvidenceArtifactSnapshot"]
            );
            assert_eq!(attachment.name, "Documento sintetico");
        }
    }

    #[test]
    fn patient_profile_patch_distinguishes_absence_clear_and_value_and_requires_matching_read() {
        let patch: PatientProfilePatch = serde_json::from_value(json!({
            "phone":null, "caregiver":"", "firstName":" Èva "
        }))
        .unwrap();
        assert!(patch.address.is_unchanged());
        assert!(matches!(patch.phone, NullableStringPatch::Clear));
        assert!(matches!(&patch.caregiver, NullableStringPatch::Set(value) if value.is_empty()));
        assert_eq!(
            serde_json::to_value(&patch).unwrap(),
            json!({"phone":null, "caregiver":"", "firstName":" Èva "})
        );
        for field in [
            "isArchived",
            "archiveReason",
            "notes",
            "ambulatoryId",
            "aiSummary",
        ] {
            let mut value = json!({});
            value[field] = Value::Null;
            assert!(serde_json::from_value::<PatientProfilePatch>(value).is_err());
        }
        let session = session();
        session
            .fixture_read(
                0,
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                7,
                vec!["address".into()],
            )
            .unwrap();
        let locked = PatientProfilePatch {
            address: NullableStringPatch::Clear,
            ..Default::default()
        };
        assert_eq!(
            session.update_patient_profile("scope-a", "patient-a", 7, &locked),
            Err(RuntimeError::LockedField)
        );
        for (scope, patient, version, expected) in [
            ("scope-b", "patient-a", 7, RuntimeError::ReadRequired),
            ("scope-a", "patient-b", 7, RuntimeError::ReadRequired),
            ("scope-a", "patient-a", 6, RuntimeError::ReadRequired),
            ("scope-a", "patient-a", 0, RuntimeError::InvalidInput),
        ] {
            assert_eq!(
                session.update_patient_profile(scope, patient, version, &patch),
                Err(expected)
            );
        }
        for invalid in [
            PatientProfilePatch::default(),
            PatientProfilePatch {
                first_name: Some(" \u{feff}".into()),
                ..Default::default()
            },
            PatientProfilePatch {
                birth_date: NullableStringPatch::Set("2026-02-30T00:00:00.000Z".into()),
                ..Default::default()
            },
        ] {
            assert_eq!(
                session.update_patient_profile("scope-a", "patient-a", 7, &invalid),
                Err(RuntimeError::InvalidInput)
            );
        }
        session.lock();
        assert_eq!(
            session.update_patient_profile("scope-a", "patient-a", 7, &patch),
            Err(RuntimeError::Locked)
        );
    }

    #[test]
    fn sparse_patient_update_seals_only_changed_fields_and_never_replays_unknown_writes() {
        for reply in [Some(r#"{"success":true}"#), None] {
            let (url, seen, release, server) = delayed_server(reply);
            let session = session_at(&url);
            admit_fixture_read(&session);
            session
                .fixture_read(
                    0,
                    "scope-a",
                    "patient-a",
                    "patients",
                    "patient-a",
                    7,
                    vec!["address".into()],
                )
                .unwrap();
            let patch = PatientProfilePatch {
                last_name: Some("Città 🩺".into()),
                phone: NullableStringPatch::Clear,
                caregiver: NullableStringPatch::Set("Contatto sintetico è 🩺".into()),
                ..Default::default()
            };
            let submitted = patch.clone();
            let clone = session.clone();
            let worker = thread::spawn(move || {
                clone.update_patient_profile("scope-a", "patient-a", 7, &submitted)
            });
            let request = seen.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(request.starts_with("PUT /api/v1/network/patients/patient-a "));
            assert!(!request.contains("Contatto sintetico"));
            let mut body: Value =
                serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
            assert!(body["caregiver"].as_str().unwrap().starts_with("ENC:"));
            assert!(
                session
                    .decrypt_fields(&mut body, PATIENT_FIELDS)
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(
                body,
                json!({"version":7,"lastName":"Città 🩺","phone":null,
                    "caregiver":"Contatto sintetico è 🩺"})
            );
            assert_eq!(
                session.update_patient_notes("scope-a", "patient-a", 7, "duplicate"),
                Err(RuntimeError::Busy)
            );
            release.send(()).unwrap();
            assert_eq!(
                worker.join().unwrap(),
                if reply.is_some() {
                    Ok(())
                } else {
                    Err(RuntimeError::Indeterminate)
                }
            );
            server.join().unwrap();
            assert_eq!(
                session.update_patient_profile("scope-a", "patient-a", 7, &patch),
                Err(RuntimeError::ReadRequired)
            );
        }
    }

    #[test]
    fn patient_creation_seals_optional_fields_and_requires_a_version_one_ack() {
        let draft = PatientCreateDraft {
            first_name: " Èva ".into(),
            last_name: "Città 🩺".into(),
            tax_code: "SYNTHETIC-CODE".into(),
            birth_date: Some("2000-02-29T00:00:00.000Z".into()),
            address: Some("Indirizzo sintetico".into()),
            phone: Some(String::new()),
            caregiver: None,
            is_adi: true,
        };
        for ack in [
            json!({"id":"new patient.🩺", "version":1}),
            json!({"id":"new patient.🩺"}),
            json!({"id":"new patient.🩺", "version":2}),
        ] {
            let reply = ack.to_string();
            let (url, seen, release, server) = delayed_server(Some(&reply));
            let session = session_at(&url);
            admit_fixture_read(&session);
            let submitted = draft.clone();
            let clone = session.clone();
            let worker = thread::spawn(move || clone.create_patient("scope-a", &submitted));
            let request = seen.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(request.starts_with("POST /api/v1/network/patients "));
            assert!(!request.contains("Indirizzo sintetico"));
            let mut body: Value =
                serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
            assert!(body["address"].as_str().unwrap().starts_with("ENC:"));
            assert!(body["phone"].as_str().unwrap().starts_with("ENC:"));
            assert!(
                session
                    .decrypt_fields(&mut body, PATIENT_FIELDS)
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(body, serde_json::to_value(&draft).unwrap());
            release.send(()).unwrap();
            let result = worker.join().unwrap();
            server.join().unwrap();
            if ack["version"] == 1 {
                let created = result.unwrap();
                assert_eq!(created.id, "new patient.🩺");
                assert_eq!(created.version, Some(1));
                // A creation acknowledgment does not manufacture a preread.
                assert_eq!(
                    session.require_read(
                        "scope-a",
                        &created.id,
                        "patients",
                        &created.id,
                        1,
                        &["phone"]
                    ),
                    Err(RuntimeError::ReadRequired)
                );
            } else {
                assert!(matches!(result, Err(RuntimeError::Indeterminate)));
            }
        }
    }

    #[test]
    fn dropped_write_response_is_unknown_and_cannot_be_replayed_without_read() {
        let (url, seen, release, server) = delayed_server(None);
        let session = session_at(&url);
        admit_fixture_read(&session);
        let clone = session.clone();
        let worker = thread::spawn(move || {
            clone.update_patient_notes("scope-a", "patient-a", 1, "synthetic edit")
        });
        seen.recv_timeout(Duration::from_secs(5)).unwrap();
        release.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), Err(RuntimeError::Indeterminate));
        server.join().unwrap();
        assert_eq!(
            session.update_patient_notes("scope-a", "patient-a", 1, "retry"),
            Err(RuntimeError::ReadRequired)
        );
        assert!(!session.is_locked());
    }

    #[test]
    fn global_diary_decrypts_in_server_order_and_binds_each_parent_without_fanout() {
        let encoder = session();
        let entry = |id: &str, patient: &str, version: u64| {
            encoder.seal_fields(
                json!({"id":id,"patientId":patient,"version":version,"type":"note",
                    "title":"Città 🩺","content":"<p>Nota sintetica</p>","date":"2026-10-17T12:00:00.000Z"}),
                &["title", "content"],
            ).unwrap()
        };
        let first = entry("entry.z", "patient b", 3);
        let mut removed = entry("entry.deleted", "patient b", 2);
        removed["deletedAt"] = json!("2026-10-17T13:00:00.000Z");
        let mut last = entry("entry.a", "paziente 🩺", 1);
        last["content"] = json!("ENC:broken:data");
        let body = json!([first, removed, last]).to_string();
        let (url, seen, release, server) = delayed_server(Some(&body));
        let session = session_at(&url);
        admit_fixture_read(&session);
        let clone = session.clone();
        let worker = thread::spawn(move || clone.list_global_entries("scope-a"));
        assert!(
            seen.recv_timeout(Duration::from_secs(5))
                .unwrap()
                .starts_with("GET /api/v1/network/entries ")
        );
        release.send(()).unwrap();
        let rows = worker.join().unwrap().unwrap();
        server.join().unwrap();
        assert_eq!(
            rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
            ["entry.z", "entry.a"]
        );
        assert_eq!(rows[0].title, "Città 🩺");
        assert_eq!(rows[0].content, "<p>Nota sintetica</p>");
        assert_eq!(rows[1].locked_fields, ["content"]);
        assert!(
            session
                .require_read(
                    "scope-a",
                    "patient b",
                    "entries",
                    "entry.z",
                    3,
                    &["content"]
                )
                .is_ok()
        );
        assert_eq!(
            session.require_read(
                "scope-a",
                "paziente 🩺",
                "entries",
                "entry.z",
                3,
                &["content"]
            ),
            Err(RuntimeError::ReadRequired)
        );
        assert_eq!(
            session.require_read(
                "scope-a",
                "patient b",
                "entries",
                "entry.deleted",
                2,
                &["content"]
            ),
            Err(RuntimeError::ReadRequired)
        );
        assert_eq!(
            session.require_read(
                "scope-a",
                "paziente 🩺",
                "entries",
                "entry.a",
                1,
                &["content"]
            ),
            Err(RuntimeError::LockedField)
        );
    }

    #[test]
    fn agenda_uses_existing_global_route_and_preserves_decrypted_checkup_parent() {
        let encoder = session();
        let checkup = encoder.seal_fields(
            json!({"id":" controllo città ","patientId":"patient-b","version":4,
                "title":"Controllo","notes":"Nota sintetica 🩺","status":"pending","date":"2026-10-18T12:00:00.000Z"}),
            &["notes"],
        ).unwrap();
        let body = json!([checkup]).to_string();
        let (url, seen, release, server) = delayed_server(Some(&body));
        let session = session_at(&url);
        admit_fixture_read(&session);
        let clone = session.clone();
        let worker = thread::spawn(move || clone.list_agenda("scope-a"));
        assert!(
            seen.recv_timeout(Duration::from_secs(5))
                .unwrap()
                .starts_with("GET /api/v1/network/checkups ")
        );
        release.send(()).unwrap();
        let rows = worker.join().unwrap().unwrap();
        server.join().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, " controllo città ");
        assert_eq!(rows[0].notes.as_deref(), Some("Nota sintetica 🩺"));
        assert!(
            session
                .require_read(
                    "scope-a",
                    "patient-b",
                    "checkups",
                    &rows[0].id,
                    4,
                    &["notes"]
                )
                .is_ok()
        );
        assert_eq!(
            session.require_read(
                "scope-a",
                "patient-a",
                "checkups",
                &rows[0].id,
                4,
                &["notes"]
            ),
            Err(RuntimeError::ReadRequired)
        );
    }
    fn profile_wire(session: &RuntimeSession) -> Value {
        let fields = session.seal_fields(json!({"firstName":"Amina","lastName":"Sintetica","taxCode":"SYNTHETIC",
            "birthDate":null,"address":null,"phone":null,"caregiver":null,"diagnoses":null,"exemptions":null,
            "notes":"synthetic notes","isAdi":false,"isArchived":false,"statusReason":null,"archiveReason":null,"archiveNote":null}), &["notes"]).unwrap();
        json!({"schemaVersion":"mediflow.patient.profile-view.v1","operationId":"patient-profile.read.v1","contractVersion":1,
            "handle":format!("pph_{}", "a".repeat(64)),"projection":"profile",
            "currentness":{"revision":7,"selectionEpoch":3,"observedAt":1000,"expiresAt":61000},"profile":fields})
    }

    type ProfileScript = (
        RuntimeSession,
        Arc<Mutex<Vec<String>>>,
        mpsc::Receiver<usize>,
        mpsc::Sender<()>,
        thread::JoinHandle<()>,
    );
    fn profile_script(steps: Vec<(&str, u16, String)>, pause_last: bool) -> ProfileScript {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let session = session_at(&url);
        session
            .select_profile_patient("scope-a", "patient-a")
            .unwrap();
        session
            .inner
            .scopes
            .lock()
            .unwrap()
            .insert("scope-a".into());
        let steps: Vec<_> = steps
            .into_iter()
            .map(|(prefix, status, body)| (prefix.to_owned(), status, body))
            .collect();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let (seen_tx, seen_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            let mut index = 0;
            while index < steps.len() {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                assert!(request.contains("\r\nx-mediflow-expected-ambulatory-id: scope-a\r\n"));
                assert!(
                    request.contains("\r\nx-mediflow-archive-generation: synthetic-generation\r\n")
                );
                captured.lock().unwrap().push(request.clone());
                if request.starts_with("GET /api/v1/network/identity ") {
                    send_reply(
                        &mut stream,
                        r#"{"scope":{"effectiveAmbulatoryId":"scope-a","requestBinding":"expected-ambulatory-id-v1"},"operator":{"userId":"synthetic-user","authChannel":"native"}}"#,
                    );
                    continue;
                }
                let (prefix, status, body) = &steps[index];
                assert!(request.starts_with(prefix), "unexpected route");
                let _ = seen_tx.send(index);
                if pause_last && index + 1 == steps.len() {
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                }
                send_status_reply(&mut stream, *status, body);
                index += 1;
            }
        });
        (session, requests, seen_rx, release_tx, worker)
    }
    const EPOCH_GET: &str = "GET /api/v1/network/patient-profile/selection-epoch ";
    const PROFILE_POST: &str = "POST /api/v1/network/patients/patient-a/profile-query ";
    fn epoch_wire() -> String {
        json!({"contractVersion":1,"selectionEpoch":2}).to_string()
    }

    const SCALE_CATALOG_GET: &str = "GET /api/v1/network/scales ";
    const SCALE_PREPARE_POST: &str = "POST /api/v1/network/patients/patient-a/scales/prepare ";
    const SCALE_ENTRY_POST: &str = "POST /api/v1/network/patients/patient-a/entries ";
    const SCALE_ENTRY_GET: &str = "GET /api/v1/network/patients/patient-a/entries/scale-";

    fn scale_preparation_wire() -> Value {
        json!({"contractVersion":1, "preparationVersion":crate::scales::SCALE_PREPARATION_VERSION,
            "catalogRevision":format!("sha256:{}", "a".repeat(64)), "status":"draft",
            "context":{"patientId":"patient-a", "ambulatoryId":"scope-a", "patientVersion":7, "selectionEpoch":3},
            "submission":{"title":"Strumento sintetico adl", "content":"Contenuto canonico sintetico restituito dall'host.",
                "metadata":{"title":"Strumento sintetico adl", "scaleId":"adl", "score":97,
                    "interpretation":"Interpretazione sintetica restituita dall'host, senza calcolo Rust.",
                    "interpretationVersion":"synthetic-interpretation-v1", "answers":{"synthetic-choice":1}}}})
    }

    fn scale_preparation_steps(reply: Value) -> Vec<(&'static str, u16, Value)> {
        vec![
            (SCALE_CATALOG_GET, 200, crate::scales::synthetic_catalog()),
            (EPOCH_GET, 200, serde_json::from_str(&epoch_wire()).unwrap()),
            (PROFILE_POST, 200, profile_wire(&session())),
            (SCALE_PREPARE_POST, 200, reply),
        ]
    }

    // Real bounded HTTP, profile-query and encryption. "$created" and "$entry"
    // echo the actual caller's random ID/ciphertext; "$drop" loses the reply.
    fn scale_script(steps: Vec<(&'static str, u16, Value)>, pause_last: bool) -> ProfileScript {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
        session
            .select_profile_patient("scope-a", "patient-a")
            .unwrap();
        session
            .inner
            .scopes
            .lock()
            .unwrap()
            .insert("scope-a".into());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let (seen_tx, seen_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            let mut index = 0;
            let mut entry_body = Value::Null;
            while index < steps.len() {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                assert!(request.contains("\r\nx-mediflow-expected-ambulatory-id: scope-a\r\n"));
                assert!(
                    request.contains("\r\nx-mediflow-archive-generation: synthetic-generation\r\n")
                );
                captured.lock().unwrap().push(request.clone());
                if request.starts_with("GET /api/v1/network/identity ")
                    && steps[index].0 != "GET /api/v1/network/identity "
                {
                    send_reply(
                        &mut stream,
                        r#"{"scope":{"effectiveAmbulatoryId":"scope-a","requestBinding":"expected-ambulatory-id-v1"},"operator":{"userId":"synthetic-user","authChannel":"native"}}"#,
                    );
                    continue;
                }
                let (prefix, status, value) = &steps[index];
                assert!(
                    request.starts_with(prefix),
                    "unexpected scale fixture route"
                );
                if request.starts_with(SCALE_ENTRY_POST) {
                    entry_body = scale_request_body(&request);
                }
                let _ = seen_tx.send(index);
                if pause_last && index + 1 == steps.len() {
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                }
                let body = match value.as_str() {
                    Some("$drop") => {
                        index += 1;
                        continue;
                    }
                    Some("$created") => json!({"id":entry_body["id"], "version":1}),
                    Some("$entry") | Some("$different-metadata") => {
                        let mut row = entry_body.clone();
                        row["patientId"] = json!("patient-a");
                        row["version"] = json!(1);
                        if value == "$different-metadata" {
                            row["metadata"] = json!("{\"score\":98}");
                        }
                        row
                    }
                    _ => value.clone(),
                }
                .to_string();
                send_status_reply(&mut stream, *status, &body);
                index += 1;
            }
        });
        (session, requests, seen_rx, release_tx, worker)
    }
    fn scale_request_body(request: &str) -> Value {
        serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap()
    }
    fn prepare_synthetic_scale(session: &RuntimeSession) -> PreparedScale {
        let catalog = session.read_scale_catalog("scope-a").unwrap();
        let request = ScalePreparationRequest::new(
            &catalog,
            ScaleId::Adl,
            serde_json::from_value(json!({"synthetic-choice":1})).unwrap(),
            7,
        )
        .unwrap();
        session
            .prepare_scale(
                "scope-a",
                "patient-a",
                &session.profile_query_intent(),
                &request,
            )
            .unwrap()
    }

    #[test]
    fn scale_prepare_review_and_diary_readback_use_host_epoch_and_canonical_encrypted_submission() {
        let mut steps = scale_preparation_steps(scale_preparation_wire());
        steps.extend([
            (PROFILE_POST, 200, profile_wire(&session())),
            (SCALE_ENTRY_POST, 201, json!("$created")),
            (PROFILE_POST, 200, profile_wire(&session())),
            (SCALE_ENTRY_GET, 200, json!("$entry")),
        ]);
        let (session, requests, _, _, server) = scale_script(steps, false);
        let prepared = prepare_synthetic_scale(&session);
        assert_eq!(prepared.context().selection_epoch, 3);
        assert_eq!(prepared.submission().metadata.score.as_u64(), Some(97)); // choice 1 is never scored by Rust.
        assert!(
            !requests
                .lock()
                .unwrap()
                .iter()
                .any(|request| request.starts_with(SCALE_ENTRY_POST))
        );
        let attempt = session
            .seal_scale_entry(&prepared, "2026-10-19T09:00:00+02:00", Some("ambulatory"))
            .unwrap();
        assert_eq!(attempt.date(), "2026-10-19T07:00:00.000Z");
        assert!(
            !requests
                .lock()
                .unwrap()
                .iter()
                .any(|request| request.starts_with(SCALE_ENTRY_POST))
        );
        let ScaleEntryReadback::Verified(row) = session.create_scale_entry(&attempt).unwrap()
        else {
            panic!("full readback required")
        };
        assert_eq!(row.content, prepared.submission().content);
        assert_eq!(
            serde_json::from_str::<Value>(row.metadata.as_deref().unwrap()).unwrap(),
            serde_json::to_value(&prepared.submission().metadata).unwrap()
        );
        server.join().unwrap();
        let requests = requests.lock().unwrap();
        let prepare = scale_request_body(
            requests
                .iter()
                .find(|request| request.starts_with(SCALE_PREPARE_POST))
                .unwrap(),
        );
        assert_eq!(
            prepare,
            json!({"contractVersion":1, "scaleId":"adl", "answers":{"synthetic-choice":1},
            "expectedCatalogRevision":format!("sha256:{}", "a".repeat(64)), "expectedPatientVersion":7, "expectedSelectionEpoch":3})
        );
        let write = requests
            .iter()
            .find(|request| request.starts_with(SCALE_ENTRY_POST))
            .unwrap();
        let body = scale_request_body(write);
        assert_eq!(body.as_object().unwrap().len(), 7);
        assert_eq!(body["id"], attempt.id());
        assert_eq!(body["type"], "scale");
        for field in ["title", "content", "metadata"] {
            assert!(body[field].as_str().unwrap().starts_with("ENC:"));
        }
        assert!(!write.contains("Strumento sintetico"));
        assert!(!write.contains("Interpretazione sintetica"));
        assert!(
            !requests
                .iter()
                .any(|request| request.starts_with("GET /api/v1/network/patients/patient-a "))
        );
    }

    #[test]
    fn scale_unknown_write_retries_only_the_retained_id_date_setting_and_cipherbytes() {
        let mut steps = scale_preparation_steps(scale_preparation_wire());
        steps.extend([
            (PROFILE_POST, 200, profile_wire(&session())),
            (SCALE_ENTRY_POST, 201, json!("$drop")),
            (PROFILE_POST, 200, profile_wire(&session())),
            (SCALE_ENTRY_POST, 200, json!("$created")),
            (PROFILE_POST, 200, profile_wire(&session())),
            (SCALE_ENTRY_GET, 200, json!("$entry")),
        ]);
        let (session, requests, _, _, server) = scale_script(steps, false);
        let prepared = prepare_synthetic_scale(&session);
        let attempt = session
            .seal_scale_entry(&prepared, "2026-10-19T07:00:00Z", Some("ambulatory"))
            .unwrap();
        assert!(matches!(
            session.create_scale_entry(&attempt),
            Err(RuntimeError::Indeterminate)
        ));
        assert_eq!(
            requests
                .lock()
                .unwrap()
                .iter()
                .filter(|request| request.starts_with(SCALE_ENTRY_POST))
                .count(),
            1
        );
        // An explicit later invocation is the retry. There is no automatic send.
        assert!(matches!(
            session.create_scale_entry(&attempt),
            Ok(ScaleEntryReadback::Verified(_))
        ));
        server.join().unwrap();
        let requests = requests.lock().unwrap();
        let writes: Vec<_> = requests
            .iter()
            .filter(|request| request.starts_with(SCALE_ENTRY_POST))
            .map(|request| request.split_once("\r\n\r\n").unwrap().1)
            .collect();
        assert_eq!(writes.len(), 2);
        assert_eq!(writes[0], writes[1]);
    }

    #[test]
    fn scale_readback_never_substitutes_ack_for_metadata_identity_or_version_verification() {
        let mut steps = scale_preparation_steps(scale_preparation_wire());
        steps.extend([
            (PROFILE_POST, 200, profile_wire(&session())),
            (SCALE_ENTRY_POST, 201, json!("$created")),
            (PROFILE_POST, 200, profile_wire(&session())),
            (SCALE_ENTRY_GET, 200, json!("$different-metadata")),
            (PROFILE_POST, 200, profile_wire(&session())),
            (SCALE_ENTRY_GET, 404, json!({})),
            (PROFILE_POST, 200, profile_wire(&session())),
            (SCALE_ENTRY_GET, 503, json!({})),
            (PROFILE_POST, 200, profile_wire(&session())),
            (SCALE_ENTRY_GET, 200, json!("$entry")),
        ]);
        let (session, _, _, _, server) = scale_script(steps, false);
        let prepared = prepare_synthetic_scale(&session);
        let attempt = session
            .seal_scale_entry(&prepared, "2026-10-19T07:00:00Z", Some("ambulatory"))
            .unwrap();
        assert!(matches!(
            session.create_scale_entry(&attempt),
            Ok(ScaleEntryReadback::Different(_))
        ));
        assert!(matches!(
            session.read_scale_entry(&attempt),
            Ok(ScaleEntryReadback::NotFound)
        ));
        assert!(matches!(
            session.read_scale_entry(&attempt),
            Err(RuntimeError::Transport)
        ));
        let ScaleEntryReadback::Verified(row) = session.read_scale_entry(&attempt).unwrap() else {
            panic!("canonical reread")
        };
        for field in [
            "id",
            "patientId",
            "type",
            "title",
            "content",
            "metadata",
            "date",
            "setting",
            "version",
            "attachments",
            "deletedAt",
        ] {
            let mut changed = row.clone();
            match field {
                "id" => changed.id.push('x'),
                "patientId" => changed.patient_id.push('x'),
                "type" => changed.entry_type = "note".into(),
                "title" => changed.title.push('x'),
                "content" => changed.content.push('x'),
                "metadata" => changed.metadata = Some("{}".into()),
                "date" => changed.date = "2026-10-20T07:00:00.000Z".into(),
                "setting" => changed.setting = None,
                "version" => changed.version = 2,
                "attachments" => changed.attachments = Some("[]".into()),
                "deletedAt" => changed.deleted_at = Some("2026-10-19T07:01:00Z".into()),
                _ => unreachable!(),
            }
            assert!(!attempt.matches(&changed), "unverified {field}");
        }
        let mut locked = row;
        locked.locked_fields.push("metadata".into());
        assert!(!attempt.matches(&locked));
        server.join().unwrap();
    }

    #[test]
    fn scale_preparation_rejects_a_different_host_context_without_a_diary_write() {
        for (pointer, value) in [
            ("/context/patientId", json!("patient-b")),
            ("/context/ambulatoryId", json!("scope-b")),
            ("/context/patientVersion", json!(8)),
            ("/context/selectionEpoch", json!(4)),
            ("/submission/metadata/answers/synthetic-choice", json!(0)),
            (
                "/catalogRevision",
                json!(format!("sha256:{}", "b".repeat(64))),
            ),
        ] {
            let mut wire = scale_preparation_wire();
            *wire.pointer_mut(pointer).unwrap() = value;
            let (session, requests, _, _, server) =
                scale_script(scale_preparation_steps(wire), false);
            let catalog = session.read_scale_catalog("scope-a").unwrap();
            let request = ScalePreparationRequest::new(
                &catalog,
                ScaleId::Adl,
                serde_json::from_value(json!({"synthetic-choice":1})).unwrap(),
                7,
            )
            .unwrap();
            assert!(matches!(
                session.prepare_scale(
                    "scope-a",
                    "patient-a",
                    &session.profile_query_intent(),
                    &request
                ),
                Err(RuntimeError::InvalidResponse)
            ));
            server.join().unwrap();
            assert!(
                !requests
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|request| request.starts_with(SCALE_ENTRY_POST))
            );
        }
    }

    #[test]
    fn scale_selection_retirement_blocks_confirm_and_late_preparation() {
        let (session, requests, _, _, server) =
            scale_script(scale_preparation_steps(scale_preparation_wire()), false);
        let prepared = prepare_synthetic_scale(&session);
        let attempt = session
            .seal_scale_entry(&prepared, "2026-10-19T07:00:00Z", None)
            .unwrap();
        server.join().unwrap();
        session
            .select_profile_patient("scope-a", "patient-b")
            .unwrap();
        assert!(matches!(
            session.create_scale_entry(&attempt),
            Err(RuntimeError::ReadRequired)
        ));
        assert!(matches!(
            session.read_scale_entry(&attempt),
            Err(RuntimeError::ReadRequired)
        ));
        assert!(
            !requests
                .lock()
                .unwrap()
                .iter()
                .any(|request| request.starts_with(SCALE_ENTRY_POST))
        );

        let (session, _, seen, release, server) =
            scale_script(scale_preparation_steps(scale_preparation_wire()), true);
        let catalog = session.read_scale_catalog("scope-a").unwrap();
        let request = ScalePreparationRequest::new(
            &catalog,
            ScaleId::Adl,
            serde_json::from_value(json!({"synthetic-choice":1})).unwrap(),
            7,
        )
        .unwrap();
        let intent = session.profile_query_intent();
        let pending = intent.clone();
        let worker_session = session.clone();
        let (done_tx, done_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            let result = worker_session.prepare_scale("scope-a", "patient-a", &pending, &request);
            done_tx.send(()).unwrap();
            result
        });
        while seen.recv_timeout(Duration::from_secs(5)).unwrap() != 3 {}
        intent.cancel();
        let completed_before_release = done_rx.recv_timeout(Duration::from_secs(1));
        release.send(()).unwrap();
        assert!(matches!(
            worker.join().unwrap(),
            Err(RuntimeError::ReadRequired)
        ));
        server.join().unwrap();
        assert!(completed_before_release.is_ok());
    }

    #[test]
    fn scale_host_401_with_profile_intent_stays_authentication_and_local_cancel_stays_unknown() {
        for (status, cancel) in [(401, false), (201, true)] {
            let mut steps = scale_preparation_steps(scale_preparation_wire());
            steps.extend([
                (PROFILE_POST, 200, profile_wire(&session())),
                (SCALE_ENTRY_POST, status, json!("$created")),
            ]);
            let (session, _, seen, release, server) = scale_script(steps, true);
            let prepared = prepare_synthetic_scale(&session);
            let attempt = session
                .seal_scale_entry(&prepared, "2026-10-19T07:00:00Z", None)
                .unwrap();
            let worker_session = session.clone();
            let (done_tx, done_rx) = mpsc::channel();
            let worker = thread::spawn(move || {
                let result = worker_session.create_scale_entry(&attempt);
                done_tx.send(()).unwrap();
                result
            });
            while seen.recv_timeout(Duration::from_secs(5)).unwrap() != 5 {}
            if cancel {
                prepared.intent.cancel();
            }
            let completed_before_release =
                !cancel || done_rx.recv_timeout(Duration::from_secs(1)).is_ok();
            release.send(()).unwrap();
            if cancel {
                assert!(matches!(
                    worker.join().unwrap(),
                    Err(RuntimeError::Indeterminate)
                ));
                assert!(!session.is_locked());
            } else {
                assert!(matches!(
                    worker.join().unwrap(),
                    Err(RuntimeError::Authentication)
                ));
                assert!(session.is_locked());
            }
            server.join().unwrap();
            assert!(completed_before_release);
        }
    }

    #[test]
    fn scoped_profile_open_read_and_existing_put_use_one_exact_projection_without_legacy_get() {
        let wire = profile_wire(&session()).to_string();
        let mut fresh = profile_wire(&session());
        fresh["handle"] = json!(format!("pph_{}", "b".repeat(64)));
        fresh["currentness"]["revision"] = json!(8);
        fresh["currentness"]["selectionEpoch"] = json!(4);
        fresh["profile"]["notes"] = json!("new synthetic notes");
        let (session, requests, _, _, server) = profile_script(
            vec![
                (EPOCH_GET, 200, epoch_wire()),
                (PROFILE_POST, 200, wire.clone()),
                (PROFILE_POST, 200, wire),
                (
                    "PUT /api/v1/network/patients/patient-a ",
                    200,
                    "{\"success\":true}".into(),
                ),
                (
                    EPOCH_GET,
                    200,
                    json!({"contractVersion":1,"selectionEpoch":3}).to_string(),
                ),
                (PROFILE_POST, 200, fresh.to_string()),
            ],
            false,
        );
        let intent = session.profile_query_intent();
        let first = session
            .open_patient_profile("scope-a", "patient-a", &intent)
            .unwrap();
        assert_eq!(first.notes.as_deref(), Some("synthetic notes"));
        assert_eq!(first.id, "patient-a");
        assert_eq!(first.version, 7);
        assert!(first.ambulatory_id.is_none());
        assert!(first.locked_fields.is_empty());
        let row = session
            .read_patient_profile("scope-a", "patient-a", &intent)
            .unwrap();
        assert_eq!(row.version, 7);
        session
            .update_patient_notes("scope-a", "patient-a", 7, "new synthetic notes")
            .unwrap();
        let readback = session
            .open_patient_profile("scope-a", "patient-a", &intent)
            .unwrap();
        assert_eq!(readback.version, 8);
        assert_eq!(readback.notes.as_deref(), Some("new synthetic notes"));
        server.join().unwrap();
        let requests = requests.lock().unwrap();
        let posts: Vec<Value> = requests
            .iter()
            .filter(|r| r.starts_with(PROFILE_POST))
            .map(|r| serde_json::from_str(r.split("\r\n\r\n").nth(1).unwrap()).unwrap())
            .collect();
        assert_eq!(
            posts[0],
            json!({"kind":"open","contractVersion":1,"projection":"profile","expectedSelectionEpoch":2})
        );
        assert_eq!(
            posts[1],
            json!({"kind":"read","contractVersion":1,"projection":"profile","handle":format!("pph_{}","a".repeat(64)),"expectedRevision":7})
        );
        let put = requests.iter().find(|r| r.starts_with("PUT ")).unwrap();
        assert!(!put.contains("pph_"));
        assert!(!put.contains("new synthetic notes"));
        assert!(put.contains("ENC:"));
        assert!(
            !requests
                .iter()
                .any(|r| r.starts_with("GET /api/v1/network/patients/patient-a "))
        );
    }

    #[test]
    fn cancelled_epoch_response_cannot_start_open_or_register_a_receipt() {
        let (url, seen, release, server) =
            delayed_server(Some(r#"{"contractVersion":1,"selectionEpoch":2}"#));
        let session = session_at(&url);
        session
            .inner
            .scopes
            .lock()
            .unwrap()
            .insert("scope-a".into());
        if session.inner.profile_selection.lock().unwrap().is_none() {
            session
                .select_profile_patient("scope-a", "patient-a")
                .unwrap();
        }
        let intent = session.profile_query_intent();
        let pending = intent.clone();
        let clone = session.clone();
        let worker =
            thread::spawn(move || clone.open_patient_profile("scope-a", "patient-a", &pending));
        assert!(
            seen.recv_timeout(Duration::from_secs(5))
                .unwrap()
                .starts_with(EPOCH_GET)
        );
        intent.cancel();
        release.send(()).unwrap();
        assert!(matches!(
            worker.join().unwrap(),
            Err(RuntimeError::ReadRequired)
        ));
        server.join().unwrap();
        assert!(session.inner.reads.lock().unwrap().is_empty());
        assert!(session.inner.profile_reads.lock().unwrap().is_empty());
    }

    #[test]
    fn superseded_or_locked_profile_response_never_arms_the_write_receipt() {
        for lock in [false, true] {
            let wire = profile_wire(&session()).to_string();
            let (session, _, seen, release, server) = profile_script(
                vec![(EPOCH_GET, 200, epoch_wire()), (PROFILE_POST, 200, wire)],
                true,
            );
            let intent = session.profile_query_intent();
            let pending = intent.clone();
            let clone = session.clone();
            let worker =
                thread::spawn(move || clone.open_patient_profile("scope-a", "patient-a", &pending));
            assert_eq!(seen.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
            assert_eq!(seen.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
            if lock {
                session.lock();
            } else {
                intent.cancel();
            }
            release.send(()).unwrap();
            let result = worker.join().unwrap();
            assert!(
                matches!(result, Err(RuntimeError::Locked)) && lock
                    || matches!(result, Err(RuntimeError::ReadRequired)) && !lock
            );
            server.join().unwrap();
            assert!(session.inner.reads.lock().unwrap().is_empty());
            assert!(session.inner.profile_reads.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn invalid_handle_read_is_not_silently_reopened_and_retires_the_local_write_gate() {
        let wire = profile_wire(&session()).to_string();
        let (session, requests, _, _, server) = profile_script(
            vec![
                (EPOCH_GET, 200, epoch_wire()),
                (PROFILE_POST, 200, wire),
                (PROFILE_POST, 410, "{\"code\":\"handle_expired\"}".into()),
            ],
            false,
        );
        let intent = session.profile_query_intent();
        session
            .open_patient_profile("scope-a", "patient-a", &intent)
            .unwrap();
        assert!(matches!(
            session.read_patient_profile("scope-a", "patient-a", &intent),
            Err(RuntimeError::Rejected(410))
        ));
        server.join().unwrap();
        assert_eq!(
            requests
                .lock()
                .unwrap()
                .iter()
                .filter(|r| r.starts_with(EPOCH_GET))
                .count(),
            1
        );
        assert!(session.inner.profile_reads.lock().unwrap().is_empty());
        assert_eq!(
            session.require_read(
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                7,
                &["notes"]
            ),
            Err(RuntimeError::ReadRequired)
        );
    }

    #[test]
    fn local_expiry_or_a_different_session_cannot_reuse_profile_receipts() {
        let wire = profile_wire(&session()).to_string();
        let (session, _, _, _, server) = profile_script(
            vec![(EPOCH_GET, 200, epoch_wire()), (PROFILE_POST, 200, wire)],
            false,
        );
        let intent = session.profile_query_intent();
        session
            .open_patient_profile("scope-a", "patient-a", &intent)
            .unwrap();
        server.join().unwrap();
        let key = read_key("scope-a", "patient-a", "patients", "patient-a");
        session
            .inner
            .profile_reads
            .lock()
            .unwrap()
            .get_mut(&key)
            .unwrap()
            .deadline = Instant::now() - Duration::from_secs(1);
        session
            .inner
            .reads
            .lock()
            .unwrap()
            .get_mut(&key)
            .unwrap()
            .profile
            .as_mut()
            .unwrap()
            .deadline = Instant::now() - Duration::from_secs(1);
        assert!(matches!(
            session.read_patient_profile("scope-a", "patient-a", &intent),
            Err(RuntimeError::ReadRequired)
        ));
        assert_eq!(
            session.require_read(
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                7,
                &["notes"]
            ),
            Err(RuntimeError::ReadRequired)
        );
        assert!(matches!(
            session.read_patient_profile("scope-b", "patient-a", &intent),
            Err(RuntimeError::ReadRequired)
        ));
        assert!(matches!(
            session.read_patient_profile("scope-a", "patient-b", &intent),
            Err(RuntimeError::ReadRequired)
        ));
        assert!(matches!(
            session_at("http://127.0.0.1:1").open_patient_profile("scope-a", "patient-a", &intent),
            Err(RuntimeError::ReadRequired)
        ));
    }

    #[test]
    fn profile_output_budget_rejects_http_413_and_oversized_json_without_a_legacy_retry() {
        for status in [200, 413] {
            let mut wire = profile_wire(&session());
            wire["profile"]["notes"] = json!("🩺".repeat(9000));
            let (session, requests, _, _, server) = profile_script(
                vec![
                    (EPOCH_GET, 200, epoch_wire()),
                    (PROFILE_POST, status, wire.to_string()),
                ],
                false,
            );
            let intent = session.profile_query_intent();
            assert!(matches!(
                session.open_patient_profile("scope-a", "patient-a", &intent),
                Err(RuntimeError::ProfileTooLarge)
            ));
            server.join().unwrap();
            assert!(session.inner.reads.lock().unwrap().is_empty());
            assert_eq!(
                requests
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|r| !r.starts_with("GET /api/v1/network/identity "))
                    .count(),
                2
            );
        }
        assert!(
            RuntimeError::ProfileTooLarge
                .to_string()
                .contains("limite di lettura di questo pilota")
        );
    }

    #[test]
    fn cancellation_during_the_scope_identity_check_prevents_the_profile_post() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
        session
            .inner
            .scopes
            .lock()
            .unwrap()
            .insert("scope-a".into());
        let (seen_tx, seen_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let server = thread::spawn(move || {
            for (index, prefix) in [
                "GET /api/v1/network/identity ",
                EPOCH_GET,
                "GET /api/v1/network/identity ",
            ]
            .into_iter()
            .enumerate()
            {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                assert!(request.starts_with(prefix));
                if index == 2 {
                    seen_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                }
                let body = if index == 1 {
                    epoch_wire()
                } else {
                    r#"{"scope":{"effectiveAmbulatoryId":"scope-a","requestBinding":"expected-ambulatory-id-v1"},"operator":{"userId":"synthetic-user","authChannel":"native"}}"#.to_owned()
                };
                send_reply(&mut stream, &body);
            }
        });
        if session.inner.profile_selection.lock().unwrap().is_none() {
            session
                .select_profile_patient("scope-a", "patient-a")
                .unwrap();
        }
        let intent = session.profile_query_intent();
        let pending = intent.clone();
        let clone = session.clone();
        let worker =
            thread::spawn(move || clone.open_patient_profile("scope-a", "patient-a", &pending));
        seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        intent.cancel();
        release_tx.send(()).unwrap();
        assert!(matches!(
            worker.join().unwrap(),
            Err(RuntimeError::ReadRequired)
        ));
        server.join().unwrap();
        assert!(session.inner.reads.lock().unwrap().is_empty());
        assert!(session.inner.profile_reads.lock().unwrap().is_empty());
    }
    #[test]
    fn completed_profile_legacy_read_keeps_enc_display_but_cannot_arm_a_scoped_write() {
        let mut row = profile_wire(&session())["profile"].clone();
        row["id"] = json!("patient-a");
        row["version"] = json!(7);
        let (session, _, _, _, server) = profile_script(
            vec![(
                "GET /api/v1/network/patients/patient-a ",
                200,
                row.to_string(),
            )],
            false,
        );
        let result = session.read_patient_legacy("scope-a", "patient-a").unwrap();
        assert_eq!(result.notes.as_deref(), Some("synthetic notes"));
        assert_eq!(result.id, "patient-a");
        server.join().unwrap();
        assert_eq!(
            session.require_read(
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                7,
                &["notes"]
            ),
            Err(RuntimeError::ReadRequired)
        );
    }

    #[test]
    fn completed_profile_receipt_is_retired_after_opening_another_patient() {
        let a = profile_wire(&session()).to_string();
        let mut b = profile_wire(&session());
        b["handle"] = json!(format!("pph_{}", "b".repeat(64)));
        b["currentness"]["selectionEpoch"] = json!(4);
        let (session, _, _, _, server) = profile_script(
            vec![
                (EPOCH_GET, 200, epoch_wire()),
                (PROFILE_POST, 200, a),
                (EPOCH_GET, 200, epoch_wire()),
                (
                    "POST /api/v1/network/patients/patient-b/profile-query ",
                    200,
                    b.to_string(),
                ),
            ],
            false,
        );
        let first = session.profile_query_intent();
        session
            .open_patient_profile("scope-a", "patient-a", &first)
            .unwrap();
        first.cancel();
        assert_eq!(
            session.require_read(
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                7,
                &["notes"]
            ),
            Ok(())
        );
        session
            .select_profile_patient("scope-a", "patient-b")
            .unwrap();
        let second = session.profile_query_intent();
        session
            .open_patient_profile("scope-a", "patient-b", &second)
            .unwrap();
        server.join().unwrap();
        assert_eq!(
            session.require_read(
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                7,
                &["notes"]
            ),
            Err(RuntimeError::ReadRequired)
        );
        assert_eq!(
            session.update_patient_notes("scope-a", "patient-a", 7, "must never be sent"),
            Err(RuntimeError::ReadRequired)
        );
    }

    #[test]
    fn clearing_or_changing_scope_retires_the_completed_profile_selection_not_just_its_request() {
        let wire = profile_wire(&session()).to_string();
        let (session, _, _, _, server) = profile_script(
            vec![(EPOCH_GET, 200, epoch_wire()), (PROFILE_POST, 200, wire)],
            false,
        );
        let request = session.profile_query_intent();
        session
            .open_patient_profile("scope-a", "patient-a", &request)
            .unwrap();
        server.join().unwrap();
        request.cancel();
        assert_eq!(
            session.require_read(
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                7,
                &["notes"]
            ),
            Ok(())
        );
        let refresh = session.profile_query_intent();
        assert!(session.profile_intent_guard(&refresh).is_ok());
        session.clear_profile_selection();
        assert_eq!(
            session.update_patient_notes("scope-a", "patient-a", 7, "no HTTP"),
            Err(RuntimeError::ReadRequired)
        );
        assert!(session.profile_intent_guard(&refresh).is_err());
        session
            .select_profile_patient("scope-a", "patient-a")
            .unwrap();
        assert_eq!(
            session.require_read(
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                7,
                &["notes"]
            ),
            Err(RuntimeError::ReadRequired)
        );
        session
            .select_profile_patient("scope-b", "patient-a")
            .unwrap();
        assert_eq!(
            session.update_patient_notes("scope-a", "patient-a", 7, "no HTTP"),
            Err(RuntimeError::ReadRequired)
        );
        assert!(session.inner.reads.lock().unwrap().is_empty());
        assert!(session.inner.profile_reads.lock().unwrap().is_empty());
    }

    #[test]
    fn creation_can_bind_its_new_patient_only_while_that_creation_selection_is_current() {
        let session = session();
        session.begin_profile_creation("scope-a").unwrap();
        let stale = session.profile_query_intent();
        session
            .select_profile_patient("scope-a", "patient-b")
            .unwrap();
        assert_eq!(
            session.bind_created_profile("scope-a", "created-a", &stale),
            Err(RuntimeError::ReadRequired)
        );
        session.begin_profile_creation("scope-a").unwrap();
        let active = session.profile_query_intent();
        assert_eq!(
            session.bind_created_profile("scope-b", "created-a", &active),
            Err(RuntimeError::ReadRequired)
        );
        session
            .bind_created_profile("scope-a", "created-a", &active)
            .unwrap();
        assert!(
            session
                .profile_target_matches(&active, "scope-a", "created-a")
                .is_ok()
        );
        assert_eq!(
            session.bind_created_profile("scope-a", "created-b", &active),
            Err(RuntimeError::ReadRequired)
        );
        assert_eq!(
            session.require_read(
                "scope-a",
                "created-a",
                "patients",
                "created-a",
                1,
                &["notes"]
            ),
            Err(RuntimeError::ReadRequired)
        );
        session.begin_profile_creation("scope-a").unwrap();
        let cancelled = session.profile_query_intent();
        cancelled.cancel();
        assert_eq!(
            session.bind_created_profile("scope-a", "created-c", &cancelled),
            Err(RuntimeError::ReadRequired)
        );
    }

    #[test]
    fn generic_read_receipts_cannot_be_used_as_unbounded_profile_receipts() {
        let session = session();
        session
            .select_profile_patient("scope-a", "patient-a")
            .unwrap();
        assert_eq!(
            session.remember(
                0,
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                7,
                vec![]
            ),
            Err(RuntimeError::ReadRequired)
        );
        assert_eq!(
            session.update_patient_notes("scope-a", "patient-a", 7, "no HTTP"),
            Err(RuntimeError::ReadRequired)
        );
    }
    #[test]
    fn profile_receipt_expiring_during_scope_identity_prevents_any_patient_put() {
        for profile_patch in [false, true] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
            admit_fixture_read(&session);
            let deadline = Instant::now() + Duration::from_millis(150);
            let key = read_key("scope-a", "patient-a", "patients", "patient-a");
            session
                .inner
                .reads
                .lock()
                .unwrap()
                .get_mut(&key)
                .unwrap()
                .profile
                .as_mut()
                .unwrap()
                .deadline = deadline;
            session
                .inner
                .profile_reads
                .lock()
                .unwrap()
                .get_mut(&key)
                .unwrap()
                .deadline = deadline;
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                assert!(read_request(&mut stream).starts_with("GET /api/v1/network/identity "));
                thread::sleep(
                    deadline.saturating_duration_since(Instant::now()) + Duration::from_millis(10),
                );
                send_reply(
                    &mut stream,
                    r#"{"scope":{"effectiveAmbulatoryId":"scope-a","requestBinding":"expected-ambulatory-id-v1"},"operator":{"userId":"synthetic-user","authChannel":"native"}}"#,
                );
                listener.set_nonblocking(true).unwrap();
                let until = Instant::now() + Duration::from_millis(150);
                loop {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            let request = read_request(&mut stream);
                            send_reply(&mut stream, r#"{"success":true}"#);
                            return Some(request);
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            if Instant::now() >= until {
                                return None;
                            }
                            thread::sleep(Duration::from_millis(2));
                        }
                        Err(error) => panic!("unexpected accept error: {error}"),
                    }
                }
            });
            let result = if profile_patch {
                session.update_patient_profile(
                    "scope-a",
                    "patient-a",
                    1,
                    &PatientProfilePatch {
                        first_name: Some("Synthetic".into()),
                        ..Default::default()
                    },
                )
            } else {
                session.update_patient_notes("scope-a", "patient-a", 1, "must not be sent")
            };
            let sent = server.join().unwrap();
            assert_eq!(result, Err(RuntimeError::ReadRequired));
            assert!(
                sent.is_none(),
                "expired receipt must send zero PUT requests"
            );
        }
    }

    #[test]
    fn selection_change_during_write_scope_check_prevents_the_profile_put() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
        admit_fixture_read(&session);
        let (seen_tx, seen_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            assert!(read_request(&mut stream).starts_with("GET /api/v1/network/identity "));
            seen_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            send_reply(
                &mut stream,
                r#"{"scope":{"effectiveAmbulatoryId":"scope-a","requestBinding":"expected-ambulatory-id-v1"},"operator":{"userId":"synthetic-user","authChannel":"native"}}"#,
            );
        });
        let clone = session.clone();
        let worker = thread::spawn(move || {
            clone.update_patient_notes("scope-a", "patient-a", 1, "must not be sent")
        });
        seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        session
            .select_profile_patient("scope-a", "patient-b")
            .unwrap();
        release_tx.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), Err(RuntimeError::ReadRequired));
        server.join().unwrap();
    }

    fn demographics_wire() -> Value {
        json!({
            "operation": POPULATION_DEMOGRAPHICS_OPERATION,
            "contractVersion": 1,
            "scope": {"ambulatoryId": "scope-a", "archiveGeneration": "synthetic-generation"},
            "ageRange": [20, 80],
            "timeZone": "Europe/Rome",
            "observedAt": "2026-10-20T08:30:00.000Z",
            "stats": {
                "totalInRange": 7,
                "withBirthDate": 9,
                "withoutBirthDate": 2,
                "adiCount": 3,
                "ageDist": {"0-18": 1, "19-64": 2, "65-80": 3, "80+": 1}
            }
        })
    }

    /// The ordinary scoped request negotiates identity first; only the second
    /// request is the operation under test.
    fn scoped_response_server(
        status: u16,
        body: &str,
    ) -> (String, mpsc::Receiver<String>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (seen_tx, seen_rx) = mpsc::channel();
        let body = body.to_owned();
        let worker = thread::spawn(move || {
            let (mut identity, _) = listener.accept().unwrap();
            let request = read_request(&mut identity);
            assert!(request.starts_with("GET /api/v1/network/identity "));
            assert!(request.contains("\r\nx-mediflow-expected-ambulatory-id: scope-a\r\n"));
            send_reply(
                &mut identity,
                r#"{"scope":{"effectiveAmbulatoryId":"scope-a","requestBinding":"expected-ambulatory-id-v1"},"operator":{"userId":"synthetic-user","authChannel":"native"}}"#,
            );
            drop(identity);
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_request(&mut stream);
            seen_tx.send(request).unwrap();
            write!(
                stream,
                "HTTP/1.1 {status} Synthetic\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });
        (url, seen_rx, worker)
    }

    fn admitted_session(base_url: &str) -> RuntimeSession {
        let session = session_at(base_url);
        session
            .inner
            .scopes
            .lock()
            .unwrap()
            .insert("scope-a".into());
        session
    }

    fn assert_scoped_archive_conflict(
        operation: fn(&RuntimeSession) -> Result<()>,
        expected_request: &str,
    ) {
        for (code, expected) in [
            ("ARCHIVE_REPLACED", RuntimeError::ArchiveReplaced),
            ("VERSION_CONFLICT", RuntimeError::Conflict),
        ] {
            let body = json!({"code": code, "error": "synthetic private detail"}).to_string();
            let (url, seen, worker) = scoped_response_server(409, &body);
            let session = session_at(&url);
            admit_fixture_read(&session);
            let result = operation(&session);
            let request = seen.recv_timeout(Duration::from_secs(5)).unwrap();
            worker.join().unwrap();
            assert!(request.starts_with(expected_request), "{request}");
            assert!(request.contains("x-mediflow-archive-generation: synthetic-generation"));
            assert_eq!(result, Err(expected), "{code}");
        }
    }

    #[test]
    fn archive_replaced_survives_patient_profile_read() {
        assert_scoped_archive_conflict(
            |session| {
                session
                    .read_patient_profile("scope-a", "patient-a", &session.profile_query_intent())
                    .map(|_| ())
            },
            "POST /api/v1/network/patients/patient-a/profile-query ",
        );
    }

    #[test]
    fn archive_replaced_survives_patient_notes_update() {
        assert_scoped_archive_conflict(
            |session| session.update_patient_notes("scope-a", "patient-a", 1, "Synthetic notes"),
            "PUT /api/v1/network/patients/patient-a ",
        );
    }

    #[test]
    fn archive_replaced_survives_entry_creation() {
        assert_scoped_archive_conflict(
            |session| {
                session
                    .create_entry(
                        "scope-a",
                        "patient-a",
                        &EntryDraft {
                            entry_type: "note".into(),
                            title: "Synthetic entry".into(),
                            content: "Synthetic content".into(),
                            date: "2026-10-21".into(),
                            setting: None,
                        },
                    )
                    .map(|_| ())
            },
            "POST /api/v1/network/patients/patient-a/entries ",
        );
    }

    #[test]
    fn population_demographics_sends_exactly_three_parameters_and_both_scope_assertions() {
        let (url, seen, worker) = scoped_response_server(200, &demographics_wire().to_string());
        let session = admitted_session(&url);
        let request = DemographicsRequest::new(80, 20, "Europe/Rome").unwrap();
        let result = session
            .read_population_demographics("scope-a", &request)
            .unwrap();
        let seen = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        worker.join().unwrap();
        assert_eq!(
            seen.lines().next().unwrap(),
            "GET /api/v1/network/analytics/demographics?minAge=20&maxAge=80&timeZone=Europe%2FRome HTTP/1.1"
        );
        assert!(seen.contains("\r\nx-mediflow-expected-ambulatory-id: scope-a\r\n"));
        assert!(seen.contains("\r\nx-mediflow-archive-generation: synthetic-generation\r\n"));
        assert!(seen.contains("\r\ncache-control: no-store\r\n"));
        assert_eq!(result.age_range, [20, 80]);
        assert_eq!(result.stats.total_in_range, 7);
        assert_eq!(result.stats.age_dist.from_65_to_80, 3);
    }

    #[test]
    fn population_demographics_keeps_denied_conflicts_and_oversize_distinct() {
        let request = DemographicsRequest::new(0, 120, "Europe/Rome").unwrap();
        let cases = [
            (
                403,
                r#"{"error":"no","code":"ANALYTICS_SCOPE_UNAVAILABLE"}"#,
                RuntimeError::Forbidden,
            ),
            (
                409,
                r#"{"error":"annullata","code":"ANALYTICS_CANCELLED"}"#,
                RuntimeError::AnalyticsCancelled,
            ),
            (
                409,
                r#"{"error":"archivio","code":"ARCHIVE_REPLACED"}"#,
                RuntimeError::ArchiveReplaced,
            ),
            (
                413,
                r#"{"error":"grande","code":"ANALYTICS_OUTPUT_TOO_LARGE"}"#,
                RuntimeError::Rejected(413),
            ),
        ];
        for (status, body, expected) in cases {
            let (url, seen, worker) = scoped_response_server(status, body);
            let session = admitted_session(&url);
            let result = session.read_population_demographics("scope-a", &request);
            seen.recv_timeout(Duration::from_secs(5)).unwrap();
            worker.join().unwrap();
            assert_eq!(result, Err(expected), "status {status}");
        }
    }

    #[test]
    fn population_demographics_rejects_an_echoed_range_that_was_not_requested() {
        let mut body = demographics_wire();
        body["ageRange"] = json!([0, 120]);
        let (url, seen, worker) = scoped_response_server(200, &body.to_string());
        let session = admitted_session(&url);
        let result = session.read_population_demographics(
            "scope-a",
            &DemographicsRequest::new(20, 80, "Europe/Rome").unwrap(),
        );
        seen.recv_timeout(Duration::from_secs(5)).unwrap();
        worker.join().unwrap();
        assert_eq!(result, Err(RuntimeError::InvalidResponse));
    }
}
