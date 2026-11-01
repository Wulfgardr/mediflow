use super::*;
use std::time::{Duration, Instant};

pub struct DocumentInsightsArchive {
    owner: Weak<()>,
    scope: String,
    patient: String,
    version: u64,
    rows: Vec<Value>,
    expires: Instant,
}
impl DocumentInsightsArchive {
    pub fn rows(&self) -> &[Value] {
        &self.rows
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
    next: Vec<Value>,
    submitted: AtomicBool,
}
impl PreparedInsightsRemoval {
    pub fn patient_id(&self) -> &str {
        &self.archive.patient
    }
    pub fn ambulatory_id(&self) -> &str {
        &self.archive.scope
    }
    pub fn removed(&self) -> impl Iterator<Item = &Value> {
        self.archive
            .rows
            .iter()
            .filter(|row| !self.next.iter().any(|kept| kept["id"] == row["id"]))
    }
}

fn archive_rows(value: &Value) -> Result<Vec<Value>> {
    let rows = match value.get("documentInsights") {
        Some(Value::Null) => return Ok(vec![]),
        Some(Value::Array(rows)) => rows.clone(),
        _ => return Err(RuntimeError::InvalidResponse),
    };
    if rows.len() > 500 {
        return Err(RuntimeError::TooLarge);
    }
    let mut seen = std::collections::HashSet::new();
    for row in &rows {
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
        let mut value = self.request(Method::GET, &["api", "patients", patient], None, false)?;
        if value["id"] != patient
            || value["ambulatoryId"] != scope
            || !value.get("deletedAt").is_some_and(Value::is_null)
        {
            return Err(RuntimeError::Missing);
        }
        let version = value["version"]
            .as_u64()
            .filter(|v| (1..=crate::MAX_SAFE_VERSION).contains(v))
            .ok_or(RuntimeError::InvalidResponse)?;
        self.native.open_document_insights(&mut value)?;
        let rows = archive_rows(&value)?;
        self.headers()?;
        Ok(DocumentInsightsArchive {
            owner: Arc::downgrade(&self.owner),
            scope: scope.into(),
            patient: patient.into(),
            version,
            rows,
            expires: Instant::now() + Duration::from_secs(300),
        })
    }

    pub fn prepare_insights_removal(
        &self,
        archive: Arc<DocumentInsightsArchive>,
        id: Option<&str>,
    ) -> Result<PreparedInsightsRemoval> {
        self.headers()?;
        if !archive.owner.ptr_eq(&Arc::downgrade(&self.owner)) || archive.expires <= Instant::now()
        {
            return Err(RuntimeError::ReadRequired);
        }
        if archive.rows.is_empty()
            || id.is_some_and(|id| !archive.rows.iter().any(|row| row["id"] == id))
        {
            return Err(RuntimeError::Missing);
        }
        let next = match id {
            Some(id) => archive
                .rows
                .iter()
                .filter(|row| row["id"] != id)
                .cloned()
                .collect(),
            None => vec![],
        };
        Ok(PreparedInsightsRemoval {
            archive,
            next,
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
        {
            return Err(RuntimeError::ReadRequired);
        }
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let current =
            self.read_document_insights(&command.archive.scope, &command.archive.patient)?;
        if current.version != command.archive.version || current.rows != command.archive.rows {
            return Err(RuntimeError::Conflict);
        }
        if command.archive.expires <= Instant::now() {
            return Err(RuntimeError::ReadRequired);
        }
        let mut body = self.native.seal_document_insights(&command.next)?;
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
            Ok(current) => Ok((current.version > command.archive.version
                && current.rows == command.next)
                .then_some(current)),
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
            archive_rows(&json!({"documentInsights":[good.clone(),{"summary":"missing id"}]}))
                .is_err()
        );
        assert!(archive_rows(&json!({"documentInsights":vec![good;501]})).is_err());
        assert!(archive_rows(&json!({"documentInsights":"not an array"})).is_err());
        assert!(archive_rows(&json!({"documentInsights":[{"id":"one","summary":"text","fileName":"synthetic","extractedData":{"medications":[17]}}]})).is_err());
        assert!(
            archive_rows(&json!({"documentInsights":null}))
                .unwrap()
                .is_empty()
        );
    }
}
