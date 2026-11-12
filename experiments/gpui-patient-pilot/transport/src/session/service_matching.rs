use super::*;
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMatchItem {
    pub id: String,
    pub patient_id: String,
    pub prescription_id: String,
    pub service_name: String,
    pub status: String,
    pub match_status: String,
    pub version: u64,
    pub code_system: Option<String>,
    pub service_code: Option<String>,
    pub catalog_entry_id: Option<String>,
    pub catalog_display_name: Option<String>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMatchCatalogEntry {
    pub id: String,
    pub code_system: String,
    pub service_code: String,
    pub display_name: String,
    pub active: bool,
}
pub struct ServiceMatchingRead {
    items: Vec<ServiceMatchItem>,
    catalog: Vec<ServiceMatchCatalogEntry>,
    intent: ProfileQueryIntent,
    epoch: u64,
    scope: String,
    patient: String,
}
impl ServiceMatchingRead {
    pub fn items(&self) -> &[ServiceMatchItem] {
        &self.items
    }
    pub fn catalog(&self) -> &[ServiceMatchCatalogEntry] {
        &self.catalog
    }
}

pub struct PreparedServiceMatch {
    item: ServiceMatchItem,
    entry: ServiceMatchCatalogEntry,
    intent: ProfileQueryIntent,
    epoch: u64,
    scope: String,
    patient: String,
    consumed: AtomicBool,
}
#[derive(Clone)]
pub struct ServiceMatchReceipt {
    pub operation: &'static str,
    pub outcome: &'static str,
    pub item_id: String,
    pub service_name: String,
    pub service_code: String,
    pub display_name: String,
    pub version: u64,
    pub read_at: String,
    intent: ProfileQueryIntent,
    scope: String,
    patient: String,
}
impl PreparedServiceMatch {
    pub fn item(&self) -> &ServiceMatchItem {
        &self.item
    }
    pub fn entry(&self) -> &ServiceMatchCatalogEntry {
        &self.entry
    }
}
impl RuntimeSession {
    fn service_match_items(
        &self,
        scope: &str,
        patient: &str,
        intent: &ProfileQueryIntent,
    ) -> Result<Vec<ServiceMatchItem>> {
        self.profile_target_matches(intent, scope, patient)?;
        let epoch = self.inner.read_epoch.load(Ordering::Acquire);
        let value = self.request_with_profile_intent(
            Method::GET,
            &["api", "v1", "network", "service-prescription-items"],
            &[("patientId", patient)],
            Some(scope),
            None,
            false,
            JSON_LIMIT,
            Some(intent),
        )?;
        let mut rows: Vec<Value> = decode(value)?;
        if rows.len() > 1024 {
            return Err(RuntimeError::TooLarge);
        }
        let mut items = vec![];
        let mut ids = HashSet::new();
        for row in &mut rows {
            if !self
                .decrypt_fields(
                    row,
                    &[
                        ("serviceName", true, false),
                        ("catalogDisplayName", false, false),
                    ],
                )?
                .is_empty()
            {
                return Err(RuntimeError::LockedField);
            }
            let item: ServiceMatchItem = decode(row.clone())?;
            validate_id(&item.id)?;
            validate_id(&item.prescription_id)?;
            validate_version(item.version)?;
            if item.patient_id != patient
                || item.service_name.trim().is_empty()
                || !ids.insert(item.id.clone())
            {
                return Err(RuntimeError::InvalidResponse);
            }
            items.push(item);
        }
        self.check_profile_intent(intent, epoch)?;
        Ok(items)
    }
    pub fn read_service_matching(
        &self,
        scope: &str,
        patient: &str,
        query: &str,
        intent: &ProfileQueryIntent,
    ) -> Result<ServiceMatchingRead> {
        if query.len() > 80 || query.chars().any(char::is_control) {
            return Err(RuntimeError::InvalidInput);
        }
        self.profile_target_matches(intent, scope, patient)?;
        let epoch = self.inner.read_epoch.load(Ordering::Acquire);
        let items = self.service_match_items(scope, patient, intent)?;
        let value = self.request_with_profile_intent(
            Method::GET,
            &["api", "v1", "network", "service-catalog"],
            &[("q", query.trim()), ("limit", "100")],
            Some(scope),
            None,
            false,
            JSON_LIMIT,
            Some(intent),
        )?;
        let catalog: Vec<ServiceMatchCatalogEntry> = decode(value)?;
        if catalog.len() > 100 {
            return Err(RuntimeError::TooLarge);
        }
        let mut ids = HashSet::new();
        for entry in &catalog {
            validate_id(&entry.id)?;
            if entry.code_system.trim().is_empty()
                || entry.service_code.trim().is_empty()
                || entry.display_name.trim().is_empty()
                || !ids.insert(entry.id.clone())
            {
                return Err(RuntimeError::InvalidResponse);
            }
        }
        self.check_profile_intent(intent, epoch)?;
        Ok(ServiceMatchingRead {
            items,
            catalog: catalog.into_iter().filter(|entry| entry.active).collect(),
            intent: intent.clone(),
            epoch,
            scope: scope.into(),
            patient: patient.into(),
        })
    }
    pub fn service_match_receipt_is_current(&self, receipt: &ServiceMatchReceipt) -> bool {
        self.profile_target_matches(&receipt.intent, &receipt.scope, &receipt.patient)
            .is_ok()
            && self.profile_intent_guard(&receipt.intent).is_ok()
    }
    pub fn service_matching_is_current(&self, read: &ServiceMatchingRead) -> bool {
        self.profile_target_matches(&read.intent, &read.scope, &read.patient)
            .is_ok()
            && self.check_profile_intent(&read.intent, read.epoch).is_ok()
    }
    pub fn prepare_service_match(
        &self,
        read: &ServiceMatchingRead,
        item: usize,
        entry: usize,
    ) -> Result<PreparedServiceMatch> {
        if !self.service_matching_is_current(read) {
            return Err(RuntimeError::ReadRequired);
        }
        let item = read.items.get(item).ok_or(RuntimeError::InvalidInput)?;
        if item.version == MAX_SAFE_VERSION {
            return Err(RuntimeError::InvalidResponse);
        }
        let entry = read.catalog.get(entry).ok_or(RuntimeError::InvalidInput)?;
        Ok(PreparedServiceMatch {
            item: item.clone(),
            entry: entry.clone(),
            intent: read.intent.clone(),
            epoch: read.epoch,
            scope: read.scope.clone(),
            patient: read.patient.clone(),
            consumed: AtomicBool::new(false),
        })
    }
    pub fn confirm_service_match(
        &self,
        prepared: &PreparedServiceMatch,
    ) -> Result<ServiceMatchReceipt> {
        self.profile_target_matches(&prepared.intent, &prepared.scope, &prepared.patient)?;
        self.check_profile_intent(&prepared.intent, prepared.epoch)?;
        if prepared.consumed.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let guard = self.begin_write()?;
        let body = self.seal_fields(
            json!({"version":prepared.item.version,"codeSystem":prepared.entry.code_system,
            "serviceCode":prepared.entry.service_code,"catalogEntryId":prepared.entry.id,
            "catalogDisplayName":prepared.entry.display_name,"matchStatus":"manual"}),
            &["catalogDisplayName"],
        )?;
        self.update_with_profile_intent(
            &prepared.scope,
            &[
                "api",
                "v1",
                "network",
                "service-prescription-items",
                &prepared.item.id,
            ],
            body,
            Some(&prepared.intent),
        )?;
        drop(guard);
        let rows = self
            .service_match_items(&prepared.scope, &prepared.patient, &prepared.intent)
            .map_err(|_| RuntimeError::Indeterminate)?;
        let item = rows
            .iter()
            .find(|row| row.id == prepared.item.id)
            .ok_or(RuntimeError::Indeterminate)?;
        if item.version != prepared.item.version + 1
            || item.match_status != "manual"
            || item.service_code.as_deref() != Some(&prepared.entry.service_code)
            || item.code_system.as_deref() != Some(&prepared.entry.code_system)
            || item.catalog_entry_id.as_deref() != Some(&prepared.entry.id)
            || item.catalog_display_name.as_deref() != Some(&prepared.entry.display_name)
        {
            return Err(RuntimeError::Indeterminate);
        }
        Ok(ServiceMatchReceipt {
            operation: "service-prescription-item.match.v1",
            outcome: "applied",
            item_id: item.id.clone(),
            service_name: item.service_name.clone(),
            service_code: prepared.entry.service_code.clone(),
            display_name: prepared.entry.display_name.clone(),
            version: item.version,
            read_at: chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
                .to_rfc3339(),
            intent: prepared.intent.clone(),
            scope: prepared.scope.clone(),
            patient: prepared.patient.clone(),
        })
    }
}
