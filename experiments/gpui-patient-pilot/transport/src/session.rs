use crate::{
    crypto::{self, MasterKey},
    http::{DOCUMENT_LIMIT, JSON_LIMIT},
    *,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use reqwest::Method;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use zeroize::Zeroizing;

/// An opaque shared session. Clones share lock, key custody and duplicate-send gate.
#[derive(Clone)]
pub struct RuntimeSession {
    inner: Arc<SessionInner>,
}
struct SessionInner {
    client: RuntimeClient,
    user: RuntimeUser,
    closed: AtomicBool,
    writing: AtomicBool,
    read_epoch: AtomicU64,
    secrets: Mutex<SessionSecrets>,
    reads: Mutex<HashMap<ReadKey, ReadReceipt>>,
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
struct ReadReceipt {
    version: u64,
    locked: Vec<String>,
}
struct ReadResponse {
    value: Value,
    epoch: u64,
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
}
impl CatalogRoute {
    fn path(&self) -> &'static [&'static str] {
        match self {
            Self::Drugs => &["api", "v1", "network", "drugs"],
            Self::Exemptions => &["api", "v1", "network", "exemptions"],
            Self::TerminologySystems => &["api", "v1", "network", "terminology", "systems"],
            Self::TerminologySearch => &["api", "v1", "network", "terminology", "search"],
            Self::TerminologyResolve => &["api", "v1", "network", "terminology", "resolve"],
        }
    }
    fn allows_query(&self, key: &str) -> bool {
        match self {
            Self::Drugs => matches!(key, "q" | "limit" | "count"),
            Self::Exemptions => matches!(key, "q" | "limit" | "count" | "codes"),
            Self::TerminologySystems => false,
            Self::TerminologySearch => matches!(key, "q" | "system" | "limit"),
            Self::TerminologyResolve => matches!(key, "system" | "code"),
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
        Self {
            inner: Arc::new(SessionInner {
                client,
                user,
                closed: AtomicBool::new(false),
                writing: AtomicBool::new(false),
                read_epoch: AtomicU64::new(0),
                secrets: Mutex::new(SessionSecrets {
                    pairing: Some(pairing),
                    cookie: Some(cookie),
                    master: Some(master),
                }),
                reads: Mutex::new(HashMap::new()),
                scopes: Mutex::new(HashSet::new()),
                capabilities: Mutex::new(HashSet::new()),
            }),
        }
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
    pub fn refresh_capabilities(&self) -> Result<()> {
        let response =
            self.read_json(None, &["api", "v1", "network", "capabilities"], JSON_LIMIT)?;
        let version = response.value["protocolVersion"]
            .as_str()
            .ok_or(RuntimeError::InvalidResponse)?;
        let parts: Vec<_> = version.split('.').collect();
        if parts.len() != 3
            || parts[0] != "1"
            || parts[1].parse::<u64>().ok().is_none_or(|minor| minor < 12)
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

    /// Immediately fences all clones and discards the unlock key. Already sent
    /// writes still require server reconciliation; lock does not undo a commit.
    /// The opaque cookie/device secret remain only for bounded remote logout.
    pub fn lock(&self) {
        self.inner.closed.store(true, Ordering::Release);
        if let Ok(mut secrets) = self.inner.secrets.lock() {
            secrets.master.take();
        }
        if let Ok(mut reads) = self.inner.reads.lock() {
            reads.clear();
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
                )
                .map(|_| ()),
            _ => Ok(()),
        }
    }

    fn ensure_open(&self) -> Result<()> {
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
        self.ensure_open()?;
        if let Some(scope) = scope {
            validate_scope_id(scope)?;
        }
        let (pairing, cookie) = {
            let secrets = self
                .inner
                .secrets
                .lock()
                .map_err(|_| RuntimeError::Locked)?;
            self.ensure_open()?;
            let pairing = secrets.pairing.as_ref().ok_or(RuntimeError::Locked)?;
            (
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
            )
        };
        self.ensure_open()?;
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
            // The existing server falls back to the node default for an unknown
            // cookie scope. A requested different scope must never accept that.
            let identity = self.inner.client.json(
                Method::GET,
                &["api", "v1", "network", "identity"],
                &[],
                Some(scope),
                &pairing,
                &cookie,
                None,
                false,
                JSON_LIMIT,
            );
            if identity
                .as_ref()
                .is_err_and(|error| error.is_auth_failure())
            {
                self.lock();
            }
            let identity = identity?;
            if identity["scope"]["effectiveAmbulatoryId"].as_str() != Some(scope)
                || identity["operator"]["userId"].as_str() != Some(&self.inner.user.id)
                || identity["operator"]["authChannel"] != "native"
            {
                return Err(RuntimeError::Forbidden);
            }
            self.ensure_open()?;
        }
        let result = self.inner.client.json(
            method, path, query, scope, &pairing, &cookie, body, mutation, limit,
        );
        if self.is_locked() {
            return Err(if mutation {
                RuntimeError::Indeterminate
            } else {
                RuntimeError::Locked
            });
        }
        if result.as_ref().is_err_and(|error| error.is_auth_failure()) {
            self.lock();
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
        let response = self.read_json_query(Some(scope), route.path(), query, JSON_LIMIT)?;
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

    pub fn read_patient(&self, scope: &str, patient_id: &str) -> Result<PatientDetail> {
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
        self.remember(
            response.epoch,
            scope,
            patient_id,
            "patients",
            &row.id,
            row.version,
            locked,
        )?;
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
        self.require_read(
            scope,
            patient_id,
            "patients",
            patient_id,
            version,
            &changed_sensitive,
        )?;
        let mut body = self.seal_fields(body, &changed_sensitive)?;
        body["version"] = json!(version);
        self.forget(scope, patient_id, "patients", patient_id)?;
        self.update(
            scope,
            &["api", "v1", "network", "patients", patient_id],
            body,
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
        self.require_read(
            scope,
            patient_id,
            "patients",
            patient_id,
            version,
            &["notes"],
        )?;
        let body = self.seal_fields(json!({ "version": version, "notes": notes }), &["notes"])?;
        self.forget(scope, patient_id, "patients", patient_id)?;
        self.update(
            scope,
            &["api", "v1", "network", "patients", patient_id],
            body,
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
            reads.insert(key, ReadReceipt { version, locked });
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
        let reads = self.inner.reads.lock().map_err(|_| RuntimeError::Locked)?;
        let receipt = reads
            .get(&read_key(scope, patient, domain, id))
            .ok_or(RuntimeError::ReadRequired)?;
        if receipt.version != version {
            return Err(RuntimeError::ReadRequired);
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
        validate_id(patient)?;
        validate_id(id)?;
        let response = self.read_json(
            Some(scope),
            &["api", "v1", "network", "patients", patient, domain, id],
            JSON_LIMIT,
        )?;
        let mut value = response.value;
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
        self.remember(response.epoch, scope, patient, domain, id, version, locked)?;
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
        let response = self.request(
            Method::POST,
            path,
            &[],
            Some(scope),
            Some(&body),
            true,
            limit,
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
        let response = self.request(
            Method::PUT,
            path,
            &[],
            Some(scope),
            Some(&body),
            true,
            JSON_LIMIT,
        )?;
        if response.get("success").and_then(Value::as_bool) != Some(true) {
            return Err(RuntimeError::Indeterminate);
        }
        Ok(())
    }
}

type Field = (&'static str, bool, bool); // wire name, required, accepts structured JSON
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
    fn read_binding_separates_session_patient_scope_version_and_locked_field() {
        let first = session();
        let second = session();
        first
            .remember(
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
        first
            .remember(
                0,
                "scope-a",
                "patient-a",
                "patients",
                "patient-a",
                1,
                vec![],
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
            .remember(
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
            session.remember(
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
            .remember(
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
            send_reply(
                &mut identity,
                r#"{"scope":{"effectiveAmbulatoryId":"scope-a"},"operator":{"userId":"synthetic-user","authChannel":"native"}}"#,
            );
            drop(identity);
            let (mut stream, _) = listener.accept().unwrap();
            seen_tx.send(read_request(&mut stream)).unwrap();
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
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
    }
    fn admit_fixture_read(session: &RuntimeSession) {
        session
            .inner
            .scopes
            .lock()
            .unwrap()
            .insert("scope-a".into());
        session
            .remember(
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
        let worker = thread::spawn(move || clone.read_patient("scope-a", "patient-a"));
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

    #[test]
    fn attachment_list_requires_payload_key_omission_before_decrypting() {
        let encoder = session();
        let summary = encoder
            .seal_fields(
                json!({"id":"document.a", "patientId":"patient-a",
                    "name":"Documento città 🩺", "path":"documento.txt",
                    "type":"text/plain", "size":4}),
                &["name", "path"],
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
                assert!(rows[0].data.is_none());
                assert!(rows[0].locked_fields.is_empty());
            } else {
                assert!(matches!(result, Err(RuntimeError::InvalidResponse)));
            }
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
            .remember(
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
                .remember(
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
}
