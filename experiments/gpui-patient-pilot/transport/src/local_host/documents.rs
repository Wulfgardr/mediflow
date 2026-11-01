use super::*;
use std::time::{Duration, Instant};

use std::ops::{Deref, DerefMut};
use std::sync::MutexGuard;
use zeroize::Zeroize;

// No Clone: all archive/command handles share this revocable plaintext owner.
pub(crate) fn wipe_value(value: &mut Value) {
    match value {
        Value::String(text) => text.zeroize(),
        Value::Array(rows) => rows.iter_mut().for_each(wipe_value),
        Value::Object(map) => {
            for (mut key, mut value) in std::mem::take(map) {
                key.zeroize();
                wipe_value(&mut value);
            }
        }
        _ => {}
    }
    *value = Value::Null;
}
pub(crate) struct InsightsValue(pub Value);
impl Deref for InsightsValue {
    type Target = Value;
    fn deref(&self) -> &Value {
        &self.0
    }
}
impl DerefMut for InsightsValue {
    fn deref_mut(&mut self) -> &mut Value {
        &mut self.0
    }
}
impl Drop for InsightsValue {
    fn drop(&mut self) {
        wipe_value(&mut self.0);
    }
}
struct InsightsRows(Vec<Value>);
impl Drop for InsightsRows {
    fn drop(&mut self) {
        self.0.iter_mut().for_each(wipe_value);
    }
}
pub(crate) struct DocumentInsightsData {
    rows: Mutex<InsightsRows>,
    texts: Mutex<Vec<Weak<Mutex<Zeroizing<String>>>>>,
    retired: AtomicBool,
}
impl DocumentInsightsData {
    pub(crate) fn revoke(&self) {
        self.retired.store(true, Ordering::Release);
        let mut rows = self.rows.lock().unwrap_or_else(|e| e.into_inner());
        rows.0.iter_mut().for_each(wipe_value);
        rows.0.clear();
        let mut texts = self.texts.lock().unwrap_or_else(|e| e.into_inner());
        for text in texts.drain(..).filter_map(|w| w.upgrade()) {
            text.lock().unwrap_or_else(|e| e.into_inner()).zeroize();
        }
    }
}
impl Drop for DocumentInsightsData {
    fn drop(&mut self) {
        self.revoke();
    }
}
pub struct DocumentInsightsRows<'a>(MutexGuard<'a, InsightsRows>);
impl Deref for DocumentInsightsRows<'_> {
    type Target = [Value];
    fn deref(&self) -> &[Value] {
        &self.0.0
    }
}
pub struct DocumentInsightsText(Arc<Mutex<Zeroizing<String>>>);
impl DocumentInsightsText {
    pub fn with_text<T>(&self, read: impl FnOnce(&str) -> T) -> T {
        read(&self.0.lock().unwrap_or_else(|e| e.into_inner()))
    }
}
pub struct DocumentInsightsArchive {
    owner: Weak<()>,
    scope: String,
    patient: String,
    version: u64,
    data: Arc<DocumentInsightsData>,
    expires: Instant,
}
impl DocumentInsightsArchive {
    pub fn rows(&self) -> DocumentInsightsRows<'_> {
        DocumentInsightsRows(self.data.rows.lock().unwrap_or_else(|e| e.into_inner()))
    }
    pub fn retire(&self) {
        self.data.revoke();
    }
    pub fn is_retired(&self) -> bool {
        self.data.retired.load(Ordering::Acquire)
    }
    pub fn protect_text(&self, mut text: Zeroizing<String>) -> DocumentInsightsText {
        let mut texts = self.data.texts.lock().unwrap_or_else(|e| e.into_inner());
        if self.is_retired() {
            text.zeroize();
        }
        let text = Arc::new(Mutex::new(text));
        texts.retain(|w| w.strong_count() != 0);
        texts.push(Arc::downgrade(&text));
        DocumentInsightsText(text)
    }
    pub fn patient_id(&self) -> &str {
        &self.patient
    }
    pub fn version(&self) -> u64 {
        self.version
    }
}
pub struct PreparedInsightsRemoval {
    archive: Arc<DocumentInsightsArchive>,
    // Only row positions, never another decrypted archive.
    kept: Vec<usize>,
    submitted: AtomicBool,
}
impl PreparedInsightsRemoval {
    pub fn patient_id(&self) -> &str {
        &self.archive.patient
    }
    pub fn ambulatory_id(&self) -> &str {
        &self.archive.scope
    }
    pub fn retire(&self) {
        self.archive.retire();
    }
    pub fn with_removed<T>(&self, read: impl FnOnce(&[&Value]) -> T) -> T {
        let rows = self.archive.rows();
        let removed: Vec<_> = rows
            .iter()
            .enumerate()
            .filter(|(i, _)| !self.kept.contains(i))
            .map(|(_, r)| r)
            .collect();
        read(&removed)
    }
}

fn archive_rows(value: &mut Value) -> Result<InsightsRows> {
    let field = value
        .get_mut("documentInsights")
        .ok_or(RuntimeError::InvalidResponse)?;
    let rows = match std::mem::take(field) {
        Value::Null => InsightsRows(vec![]),
        Value::Array(rows) => InsightsRows(rows),
        value => {
            drop(InsightsValue(value));
            return Err(RuntimeError::InvalidResponse);
        }
    };
    if rows.0.len() > 500 {
        return Err(RuntimeError::TooLarge);
    }
    let mut seen = std::collections::HashSet::new();
    for row in &rows.0 {
        let id = row["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 200)
            .ok_or(RuntimeError::InvalidResponse)?;
        validate_id(id).map_err(|_| RuntimeError::InvalidResponse)?;
        if let Some(data) = row.get("extractedData").filter(|v| !v.is_null()) {
            if !data.is_object() {
                return Err(RuntimeError::InvalidResponse);
            }
            for key in ["diagnosis", "medications", "diagnoses", "labs"] {
                if let Some(field) = data.get(key).filter(|v| !v.is_null()) {
                    let valid = match key {
                        "diagnosis" => field.is_string(),
                        "medications" => field
                            .as_array()
                            .is_some_and(|v| v.iter().all(Value::is_string)),
                        "diagnoses" => field.as_array().is_some_and(|v| {
                            v.iter().all(|d| {
                                ["system", "code", "description"]
                                    .iter()
                                    .all(|key| d[*key].is_string())
                            })
                        }),
                        "labs" => field
                            .as_object()
                            .is_some_and(|v| v.values().all(Value::is_string)),
                        _ => false,
                    };
                    if !valid {
                        return Err(RuntimeError::InvalidResponse);
                    }
                }
            }
        }
        if !seen.insert(id)
            || !row["summary"].is_string()
            || !row["fileName"].is_string()
            || (!row["rawMarkdown"].is_null() && !row["rawMarkdown"].is_string())
        {
            return Err(RuntimeError::InvalidResponse);
        }
    }
    Ok(rows)
}

impl LocalHostAccess {
    pub fn read_document_insights(
        &self,
        scope: &str,
        patient: &str,
    ) -> Result<DocumentInsightsArchive> {
        validate_id(scope)?;
        validate_id(patient)?;
        let epoch = self.native.document_archive_epoch();
        self.native.check_document_membership(scope, patient)?;
        let mut value =
            InsightsValue(self.request(Method::GET, &["api", "patients", patient], None, false)?);
        if value["id"] != patient || !value.get("deletedAt").is_some_and(Value::is_null) {
            return Err(RuntimeError::Missing);
        }
        let version = value["version"]
            .as_u64()
            .filter(|v| (1..=crate::MAX_SAFE_VERSION).contains(v))
            .ok_or(RuntimeError::InvalidResponse)?;
        self.native.open_document_insights(&mut value)?;
        let rows = archive_rows(&mut value)?;
        let data = Arc::new(DocumentInsightsData {
            rows: Mutex::new(rows),
            texts: Mutex::new(vec![]),
            retired: AtomicBool::new(false),
        });
        self.native.track_document_archive(&data, epoch)?;
        let mut archives = self
            .document_archives
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        archives.retain(|w| w.strong_count() != 0);
        archives.push(Arc::downgrade(&data));
        self.headers()?;
        Ok(DocumentInsightsArchive {
            owner: Arc::downgrade(&self.owner),
            scope: scope.into(),
            patient: patient.into(),
            version,
            data,
            expires: Instant::now() + Duration::from_secs(300),
        })
    }

    pub fn prepare_insights_removal(
        &self,
        archive: Arc<DocumentInsightsArchive>,
        id: Option<&str>,
    ) -> Result<PreparedInsightsRemoval> {
        self.headers()?;
        if !archive.owner.ptr_eq(&Arc::downgrade(&self.owner))
            || archive.expires <= Instant::now()
            || archive.is_retired()
        {
            return Err(RuntimeError::ReadRequired);
        }
        let rows = archive.rows();
        if archive.is_retired() {
            return Err(RuntimeError::ReadRequired);
        }
        if rows.is_empty() || id.is_some_and(|id| !rows.iter().any(|row| row["id"] == id)) {
            return Err(RuntimeError::Missing);
        }
        let kept = rows
            .iter()
            .enumerate()
            .filter(|(_, row)| id.is_some_and(|id| row["id"] != id))
            .map(|(index, _)| index)
            .collect();
        drop(rows);
        Ok(PreparedInsightsRemoval {
            archive,
            kept,
            submitted: AtomicBool::new(false),
        })
    }

    pub fn remove_document_insights(
        &self,
        command: &PreparedInsightsRemoval,
    ) -> Result<Option<DocumentInsightsArchive>> {
        self.headers()?;
        if !command.archive.owner.ptr_eq(&Arc::downgrade(&self.owner))
            || command.archive.expires <= Instant::now()
            || command.archive.is_retired()
        {
            return Err(RuntimeError::ReadRequired);
        }
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let current =
            self.read_document_insights(&command.archive.scope, &command.archive.patient)?;
        if current.version != command.archive.version || *current.rows() != *command.archive.rows()
        {
            return Err(RuntimeError::Conflict);
        }
        if command.archive.expires <= Instant::now() {
            return Err(RuntimeError::ReadRequired);
        }
        if command.archive.is_retired() {
            return Err(RuntimeError::ReadRequired);
        }
        let rows = command.archive.rows();
        let kept: Vec<_> = command.kept.iter().map(|&i| &rows[i]).collect();
        let mut body = self.native.seal_document_insights(&kept)?;
        drop(kept);
        drop(rows);
        body["version"] = json!(command.archive.version);
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| RuntimeError::InvalidInput)?
            .as_secs();
        body["updatedAt"] = json!(
            chrono::DateTime::from_timestamp(
                seconds.try_into().map_err(|_| RuntimeError::InvalidInput)?,
                0
            )
            .ok_or(RuntimeError::InvalidInput)?
            .to_rfc3339()
        );
        if command.archive.is_retired() {
            return Err(RuntimeError::ReadRequired);
        }
        let response = self.request(
            Method::PUT,
            &["api", "patients", &command.archive.patient],
            Some(&body),
            true,
        )?;
        if response["success"] != true {
            return Err(RuntimeError::Indeterminate);
        }
        self.verify_insights_removal(command)
    }

    pub fn verify_insights_removal(
        &self,
        command: &PreparedInsightsRemoval,
    ) -> Result<Option<DocumentInsightsArchive>> {
        self.headers()?;
        if !command.archive.owner.ptr_eq(&Arc::downgrade(&self.owner))
            || !command.submitted.load(Ordering::Acquire)
        {
            return Err(RuntimeError::ReadRequired);
        }
        match self.read_document_insights(&command.archive.scope, &command.archive.patient) {
            Ok(current) => {
                if command.archive.is_retired() {
                    return Err(RuntimeError::ReadRequired);
                }
                let rows = command.archive.rows();
                let kept: Vec<_> = command.kept.iter().map(|&i| &rows[i]).collect();
                let matches =
                    current.version > command.archive.version && current.rows().iter().eq(kept);
                Ok(matches.then_some(current))
            }
            Err(error) if error.retires_session() => Err(error),
            Err(_) => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_shape_is_bounded_and_never_filters_a_malformed_row() {
        let good = json!({"id":"one","summary":"exact","fileName":"synthetic"});
        assert!(
            archive_rows(&mut json!({"documentInsights":[good.clone(),{"summary":"missing id"}]}))
                .is_err()
        );
        assert!(archive_rows(&mut json!({"documentInsights":vec![good;501]})).is_err());
        assert!(archive_rows(&mut json!({"documentInsights":"not an array"})).is_err());
        assert!(archive_rows(&mut json!({"documentInsights":[{"id":"one","summary":"text","fileName":"synthetic","extractedData":{"medications":[17]}}]})).is_err());
        assert!(
            archive_rows(&mut json!({"documentInsights":null}))
                .unwrap()
                .0
                .is_empty()
        );
    }
}
