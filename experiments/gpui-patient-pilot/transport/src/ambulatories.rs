use crate::{Result, RuntimeError, validate_id, validate_scope_id, validate_version};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

pub const AMBULATORY_WRITE_CAPABILITY: &str = "network.ambulatories.write";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AmbulatoryDraft {
    pub name: String,
    pub address: Option<String>,
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub description: Option<String>,
    pub is_default: bool,
}

impl AmbulatoryDraft {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty()
            || self.name.chars().count() > 256
            || self
                .address
                .as_ref()
                .is_some_and(|s| s.chars().count() > 2048)
            || self
                .description
                .as_ref()
                .is_some_and(|s| s.chars().count() > 16384)
            || !matches!(self.kind.as_str(), "live" | "test")
        {
            return Err(RuntimeError::InvalidInput);
        }
        if let Some(parent) = &self.parent_id {
            validate_scope_id(parent)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AmbulatoryMutationReceipt {
    pub id: String,
    pub version: u64,
    pub affected: Vec<(String, u64)>,
}

pub(crate) fn parse_receipt(
    value: Value,
    target: Option<(&str, u64)>,
) -> Result<AmbulatoryMutationReceipt> {
    let invalid = || RuntimeError::Indeterminate;
    let id = target
        .map(|(id, _)| id)
        .or_else(|| value["id"].as_str())
        .ok_or_else(invalid)?;
    validate_id(id).map_err(|_| invalid())?;
    let version = value["version"].as_u64().ok_or_else(invalid)?;
    validate_version(version).map_err(|_| invalid())?;
    if value["success"] != true || version != target.map_or(1, |(_, v)| v + 1) {
        return Err(invalid());
    }
    let rows = value["affectedAmbulatories"]
        .as_array()
        .ok_or_else(invalid)?;
    let mut seen = HashSet::new();
    let mut affected = Vec::new();
    for row in rows {
        let affected_id = row["id"].as_str().ok_or_else(invalid)?;
        let affected_version = row["version"].as_u64().ok_or_else(invalid)?;
        validate_id(affected_id).map_err(|_| invalid())?;
        validate_version(affected_version).map_err(|_| invalid())?;
        if !seen.insert(affected_id.to_owned()) {
            return Err(invalid());
        }
        affected.push((affected_id.to_owned(), affected_version));
    }
    if !affected.iter().any(|(key, v)| key == id && *v == version) {
        return Err(invalid());
    }
    Ok(AmbulatoryMutationReceipt {
        id: id.to_owned(),
        version,
        affected,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn receipt_binds_target_increment_and_every_affected_version() {
        let receipt = json!({"success":true,"version":8,"affectedAmbulatories":[{"id":"a","version":8},{"id":"b","version":3}]});
        assert_eq!(
            parse_receipt(receipt.clone(), Some(("a", 7)))
                .unwrap()
                .affected
                .len(),
            2
        );
        for value in [
            json!({}),
            json!({"success":false}),
            {
                let mut v = receipt.clone();
                v["version"] = json!(9);
                v
            },
            {
                let mut v = receipt.clone();
                v["affectedAmbulatories"][0]["id"] = json!("other");
                v
            },
            {
                let mut v = receipt.clone();
                v["affectedAmbulatories"][1]["id"] = json!("a");
                v
            },
            {
                let mut v = receipt.clone();
                v["affectedAmbulatories"][1]["version"] = json!(0);
                v
            },
        ] {
            assert_eq!(
                parse_receipt(value, Some(("a", 7))),
                Err(RuntimeError::Indeterminate)
            );
        }
    }
}
