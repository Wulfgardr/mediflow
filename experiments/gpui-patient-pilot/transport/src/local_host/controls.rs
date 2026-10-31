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
