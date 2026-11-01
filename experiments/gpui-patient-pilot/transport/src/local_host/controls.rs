use super::governance::retain_section;
use super::*;

pub struct ControlsSnapshot {
    pub updates: Result<Value>,
    pub revision: Result<Value>,
    pub audit: Result<Value>,
    pub redaction: Result<Value>,
}
fn validate(value: Value, section: &str) -> Result<Value> {
    let valid = match section {
        "update-awareness" => {
            value["currentVersion"].is_string()
                && value["updateAvailable"].is_boolean()
                && value["source"].is_string()
                && value["notes"].is_array()
        }
        "revision" => value.is_object() && value.get("revision").is_some(),
        "audit" => value.as_array().is_some_and(|rows| {
            rows.iter().all(|r| {
                r["eventId"].is_string()
                    && r["eventType"].is_string()
                    && r["occurredAt"].is_string()
                    && r["outcome"].is_string()
            })
        }),
        "redaction" => value["provider"] == "openmed" && value["available"].is_boolean(),
        _ => false,
    };
    if valid {
        Ok(value)
    } else {
        Err(RuntimeError::InvalidResponse)
    }
}
impl LocalHostAccess {
    pub fn read_authentication_health(&self) -> Result<Value> {
        let value = self.request(Method::GET, &["api", "auth", "check"], None, false)?;
        if value["status"].is_string() {
            Ok(value)
        } else {
            Err(RuntimeError::InvalidResponse)
        }
    }
    pub fn read_controls(&self) -> Result<ControlsSnapshot> {
        let read = |section| {
            retain_section(
                self.request(Method::GET, &["api", "system", section], None, false)
                    .and_then(|v| validate(v, section)),
            )
        };
        Ok(ControlsSnapshot {
            updates: read("update-awareness")?,
            revision: read("revision")?,
            audit: read("audit")?,
            redaction: read("redaction")?,
        })
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuditFilter {
    pub event_type: String,
    pub outcome: String,
    pub subject_type: String,
    pub actor_ref: String,
    pub origin: String,
    pub limit: u16,
}
impl Default for AuditFilter {
    fn default() -> Self {
        Self {
            event_type: String::new(),
            outcome: String::new(),
            subject_type: String::new(),
            actor_ref: String::new(),
            origin: "local".into(),
            limit: 50,
        }
    }
}
impl AuditFilter {
    pub fn valid(&self) -> bool {
        let token = |s: &str, max: usize| {
            s.len() <= max
                && s.bytes().all(|b| {
                    b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-')
                })
        };
        token(&self.event_type, 128)
            && token(&self.subject_type, 64)
            && matches!(self.outcome.as_str(), "" | "success" | "failure" | "denied")
            && matches!(self.origin.as_str(), "local" | "imported" | "unattested")
            && (1..=200).contains(&self.limit)
            && self.actor_ref.encode_utf16().count() <= 256
            && self.actor_ref == self.actor_ref.trim()
            && !self.actor_ref.chars().any(char::is_control)
    }
}
impl LocalHostAccess {
    pub fn read_filtered_audit(&self, filter: &AuditFilter) -> Result<Value> {
        if !filter.valid() {
            return Err(RuntimeError::InvalidInput);
        }
        let limit = filter.limit.to_string();
        let mut query = vec![
            ("origin", filter.origin.as_str()),
            ("limit", limit.as_str()),
        ];
        for (key, value) in [
            ("eventType", &filter.event_type),
            ("outcome", &filter.outcome),
            ("subjectType", &filter.subject_type),
            ("actorRef", &filter.actor_ref),
        ] {
            if !value.is_empty() {
                query.push((key, value.as_str()));
            }
        }
        let raw = self.client.filtered_audit_read(&query, self.headers()?)?;
        let value = validate(
            serde_json::from_slice(&raw.body).map_err(|_| RuntimeError::InvalidResponse)?,
            "audit",
        )?;
        let rows = value.as_array().ok_or(RuntimeError::InvalidResponse)?;
        if rows.len() > usize::from(filter.limit)
            || rows.iter().any(|row| {
                [
                    ("eventType", &filter.event_type),
                    ("outcome", &filter.outcome),
                    ("subjectType", &filter.subject_type),
                    ("actorRef", &filter.actor_ref),
                ]
                .iter()
                .any(|(key, expected)| !expected.is_empty() && row[*key] != expected.as_str())
            })
        {
            return Err(RuntimeError::InvalidResponse);
        }
        self.headers()?;
        Ok(value)
    }
    pub fn read_controls_with_audit_filter(
        &self,
        filter: &AuditFilter,
    ) -> Result<ControlsSnapshot> {
        let read = |section| {
            retain_section(
                self.request(Method::GET, &["api", "system", section], None, false)
                    .and_then(|v| validate(v, section)),
            )
        };
        Ok(ControlsSnapshot {
            updates: read("update-awareness")?,
            revision: read("revision")?,
            audit: retain_section(self.read_filtered_audit(filter))?,
            redaction: read("redaction")?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn controls_reject_invalid_success_payloads_and_accept_empty_audit() {
        assert!(validate(json!([]), "audit").is_ok());
        assert!(validate(json!({"available":false,"provider":"openmed"}), "redaction").is_ok());
        for section in ["audit", "redaction", "update-awareness", "revision"] {
            assert!(validate(json!({"error":"unavailable"}), section).is_err());
        }
    }
}
