//! Consumer of the ADR 0155 account-profile contract. The version stays opaque:
//! the host derives it, the client only echoes the exact value it last observed.

use crate::{Result, RuntimeError, validate_id};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const ACCOUNT_PROFILE_PATH: &[&str] = &["api", "auth", "profile"];
pub(crate) const ACCOUNT_PROFILE_LIMIT: usize = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccountProfileSnapshot {
    pub user_id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub ambulatory_name: Option<String>,
    pub profile_version: String,
    pub archive_generation: String,
}

impl AccountProfileSnapshot {
    fn validate(&self, expected_user_id: &str, expected_generation: &str) -> Result<()> {
        if self.user_id != expected_user_id
            || validate_id(&self.user_id).is_err()
            || self.username.trim().is_empty()
            || self.username.chars().count() > 256
            || !valid_name(self.display_name.as_deref())
            || !valid_name(self.ambulatory_name.as_deref())
            || !valid_opaque(&self.profile_version)
            || validate_id(&self.archive_generation).is_err()
        {
            return Err(RuntimeError::InvalidResponse);
        }
        // A snapshot from another archive must never become a save base or a
        // confirmation, even though its generation is a well-formed id.
        if self.archive_generation != expected_generation {
            return Err(RuntimeError::ArchiveReplaced);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccountProfileRead {
    pub user_id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub ambulatory_name: Option<String>,
    pub profile_version: String,
    pub archive_generation: String,
}

impl AccountProfileRead {
    pub fn snapshot(&self) -> AccountProfileSnapshot {
        AccountProfileSnapshot {
            user_id: self.user_id.clone(),
            username: self.username.clone(),
            display_name: self.display_name.clone(),
            ambulatory_name: self.ambulatory_name.clone(),
            profile_version: self.profile_version.clone(),
            archive_generation: self.archive_generation.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AccountProfileUpdateOutcome {
    Saved {
        changed: bool,
        profile: AccountProfileSnapshot,
    },
    /// The host returned the current profile with the new version. Nothing was
    /// written; a second PUT requires the operator's explicit gesture.
    VersionConflict { current: AccountProfileSnapshot },
}

/// The only accepted update body: exactly the three ADR 0155 keys. Serialized
/// `None` stays an explicit `null`, never an omitted key.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfileUpdate {
    expected_version: String,
    display_name: Option<String>,
    ambulatory_name: Option<String>,
}

impl AccountProfileUpdate {
    pub fn new(
        snapshot: &AccountProfileSnapshot,
        display_name: Option<&str>,
        ambulatory_name: Option<&str>,
    ) -> Result<Self> {
        if !valid_opaque(&snapshot.profile_version) {
            return Err(RuntimeError::InvalidInput);
        }
        Ok(Self {
            expected_version: snapshot.profile_version.clone(),
            display_name: normalize_name(display_name)?,
            ambulatory_name: normalize_name(ambulatory_name)?,
        })
    }
    pub(crate) fn wire(&self) -> Value {
        // The struct has no flattened or optional-by-default field, so the
        // serialized object is exactly expectedVersion/displayName/ambulatoryName.
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadWire {
    operation: String,
    contract_version: u32,
    user_id: String,
    username: String,
    display_name: Option<String>,
    ambulatory_name: Option<String>,
    profile_version: String,
    archive_generation: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SnapshotWire {
    user_id: String,
    username: String,
    display_name: Option<String>,
    ambulatory_name: Option<String>,
    profile_version: String,
    archive_generation: String,
}

impl SnapshotWire {
    fn into_snapshot(
        self,
        expected_user_id: &str,
        expected_generation: &str,
    ) -> Result<AccountProfileSnapshot> {
        let snapshot = AccountProfileSnapshot {
            user_id: self.user_id,
            username: self.username,
            display_name: self.display_name,
            ambulatory_name: self.ambulatory_name,
            profile_version: self.profile_version,
            archive_generation: self.archive_generation,
        };
        snapshot.validate(expected_user_id, expected_generation)?;
        Ok(snapshot)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateWire {
    changed: bool,
    user_id: String,
    username: String,
    display_name: Option<String>,
    ambulatory_name: Option<String>,
    profile_version: String,
    archive_generation: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConflictWire {
    user_id: String,
    username: String,
    display_name: Option<String>,
    ambulatory_name: Option<String>,
    profile_version: String,
    archive_generation: String,
    code: String,
    #[serde(rename = "error")]
    _error: String,
}

pub(crate) fn parse_read(
    value: Value,
    expected_user_id: &str,
    expected_generation: &str,
) -> Result<AccountProfileRead> {
    let wire: ReadWire =
        serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
    if wire.operation != "account-profile.read.v1" || wire.contract_version != 1 {
        return Err(RuntimeError::InvalidResponse);
    }
    let snapshot = SnapshotWire {
        user_id: wire.user_id,
        username: wire.username,
        display_name: wire.display_name,
        ambulatory_name: wire.ambulatory_name,
        profile_version: wire.profile_version,
        archive_generation: wire.archive_generation,
    }
    .into_snapshot(expected_user_id, expected_generation)?;
    Ok(AccountProfileRead {
        user_id: snapshot.user_id,
        username: snapshot.username,
        display_name: snapshot.display_name,
        ambulatory_name: snapshot.ambulatory_name,
        profile_version: snapshot.profile_version,
        archive_generation: snapshot.archive_generation,
    })
}

pub(crate) fn parse_update(
    value: Value,
    expected_user_id: &str,
    expected_generation: &str,
) -> Result<AccountProfileUpdateOutcome> {
    let wire: UpdateWire =
        serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
    let snapshot = SnapshotWire {
        user_id: wire.user_id,
        username: wire.username,
        display_name: wire.display_name,
        ambulatory_name: wire.ambulatory_name,
        profile_version: wire.profile_version,
        archive_generation: wire.archive_generation,
    }
    .into_snapshot(expected_user_id, expected_generation)?;
    Ok(AccountProfileUpdateOutcome::Saved {
        changed: wire.changed,
        profile: snapshot,
    })
}

pub(crate) fn parse_conflict(
    value: Value,
    expected_user_id: &str,
    expected_generation: &str,
) -> Result<AccountProfileSnapshot> {
    let wire: ConflictWire =
        serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
    if wire.code != "PROFILE_VERSION_CONFLICT" {
        return Err(RuntimeError::InvalidResponse);
    }
    SnapshotWire {
        user_id: wire.user_id,
        username: wire.username,
        display_name: wire.display_name,
        ambulatory_name: wire.ambulatory_name,
        profile_version: wire.profile_version,
        archive_generation: wire.archive_generation,
    }
    .into_snapshot(expected_user_id, expected_generation)
}

/// Matches the host schema: trim, then empty becomes an explicit null. The
/// 200-character bound counts UTF-16 code units, like the web schema.
fn normalize_name(value: Option<&str>) -> Result<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.encode_utf16().count() > 200 {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(Some(value.to_owned()))
}

fn valid_name(value: Option<&str>) -> bool {
    value.is_none_or(|value| value.encode_utf16().count() <= 200)
}

fn valid_opaque(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const GENERATION: &str = "synthetic-generation";

    fn read_wire() -> Value {
        json!({
            "operation": "account-profile.read.v1",
            "contractVersion": 1,
            "userId": "synthetic-user",
            "username": "synthetic",
            "displayName": "Dott.ssa Sintetica",
            "ambulatoryName": null,
            "profileVersion": "p1:synthetic",
            "archiveGeneration": "synthetic-generation"
        })
    }

    fn update_wire() -> Value {
        json!({
            "changed": true,
            "userId": "synthetic-user",
            "username": "synthetic",
            "displayName": "Dott. Sintetico",
            "ambulatoryName": "Studio Sintetico",
            "profileVersion": "p1:updated",
            "archiveGeneration": "synthetic-generation"
        })
    }

    fn conflict_wire() -> Value {
        json!({
            "userId": "synthetic-user",
            "username": "synthetic",
            "displayName": "Altro client",
            "ambulatoryName": "Altro studio",
            "profileVersion": "p1:other",
            "archiveGeneration": "synthetic-generation",
            "code": "PROFILE_VERSION_CONFLICT",
            "error": "Il profilo è cambiato su un altro client. Rileggi e riprova."
        })
    }

    #[test]
    fn profile_read_is_strict_and_bound_to_the_session_user() {
        let read = parse_read(read_wire(), "synthetic-user", GENERATION).unwrap();
        assert_eq!(read.display_name.as_deref(), Some("Dott.ssa Sintetica"));
        assert!(read.ambulatory_name.is_none());
        assert_eq!(read.profile_version, "p1:synthetic");

        for (pointer, replacement) in [
            ("/operation", json!("account-profile.write.v1")),
            ("/contractVersion", json!(2)),
            ("/userId", json!("another-user")),
            ("/extra", json!("not in the contract")),
            ("/displayName", json!("x".repeat(201))),
            ("/username", json!("")),
            ("/profileVersion", json!("")),
        ] {
            let mut invalid = read_wire();
            if pointer == "/extra" {
                invalid["extra"] = replacement;
            } else {
                *invalid.pointer_mut(pointer).unwrap() = replacement;
            }
            assert!(
                matches!(
                    parse_read(invalid, "synthetic-user", GENERATION),
                    Err(RuntimeError::InvalidResponse)
                ),
                "{pointer}"
            );
        }
        assert!(matches!(
            parse_read(read_wire(), "another-user", GENERATION),
            Err(RuntimeError::InvalidResponse)
        ));
    }

    #[test]
    fn profile_update_sends_exactly_three_keys_with_trimmed_optional_names() {
        let snapshot = parse_read(read_wire(), "synthetic-user", GENERATION)
            .unwrap()
            .snapshot();
        let body = AccountProfileUpdate::new(&snapshot, Some("  Dott. Sintetico  "), Some("   "))
            .unwrap()
            .wire();
        assert_eq!(body.as_object().unwrap().len(), 3);
        assert_eq!(body["expectedVersion"], "p1:synthetic");
        assert_eq!(body["displayName"], "Dott. Sintetico");
        assert_eq!(body["ambulatoryName"], Value::Null);
        assert!(body.get("id").is_none() && body.get("userId").is_none());
        assert!(
            AccountProfileUpdate::new(&snapshot, Some(&"x".repeat(201)), None).is_err(),
            "the host rejects names above 200 UTF-16 units"
        );
        assert!(AccountProfileUpdate::new(&snapshot, Some(&"😀".repeat(101)), None).is_err());
        // 100 emoji are 200 UTF-16 code units: still accepted.
        assert!(AccountProfileUpdate::new(&snapshot, Some(&"😀".repeat(100)), None).is_ok());
    }

    #[test]
    fn profile_write_parses_only_the_conditional_contract() {
        let outcome = parse_update(update_wire(), "synthetic-user", GENERATION).unwrap();
        let AccountProfileUpdateOutcome::Saved { changed, profile } = outcome else {
            panic!("expected a saved profile");
        };
        assert!(changed);
        assert_eq!(profile.display_name.as_deref(), Some("Dott. Sintetico"));
        assert_eq!(profile.profile_version, "p1:updated");

        let current = parse_conflict(conflict_wire(), "synthetic-user", GENERATION).unwrap();
        assert_eq!(current.display_name.as_deref(), Some("Altro client"));
        assert_eq!(current.profile_version, "p1:other");

        for (pointer, replacement) in [
            ("/changed", json!("true")),
            ("/userId", json!("another-user")),
            ("/extra", json!(1)),
            ("/displayName", json!("x".repeat(201))),
        ] {
            let mut invalid = update_wire();
            if pointer == "/extra" {
                invalid["extra"] = replacement;
            } else {
                *invalid.pointer_mut(pointer).unwrap() = replacement;
            }
            assert!(
                matches!(
                    parse_update(invalid, "synthetic-user", GENERATION),
                    Err(RuntimeError::InvalidResponse)
                ),
                "{pointer}"
            );
        }
        for (pointer, replacement) in [
            ("/code", json!("ARCHIVE_REPLACED")),
            ("/userId", json!("another-user")),
            ("/extra", json!(1)),
        ] {
            let mut invalid = conflict_wire();
            if pointer == "/extra" {
                invalid["extra"] = replacement;
            } else {
                *invalid.pointer_mut(pointer).unwrap() = replacement;
            }
            assert!(
                matches!(
                    parse_conflict(invalid, "synthetic-user", GENERATION),
                    Err(RuntimeError::InvalidResponse)
                ),
                "{pointer}"
            );
        }
    }

    #[test]
    fn profile_read_from_another_archive_is_replaced_not_exposed() {
        let mut other = read_wire();
        other["archiveGeneration"] = json!("another-generation");
        assert!(matches!(
            parse_read(other, "synthetic-user", GENERATION),
            Err(RuntimeError::ArchiveReplaced)
        ));

        // A malformed generation is still a malformed response, not a
        // replacement.
        let mut malformed = read_wire();
        malformed["archiveGeneration"] = json!("");
        assert!(matches!(
            parse_read(malformed, "synthetic-user", GENERATION),
            Err(RuntimeError::InvalidResponse)
        ));
    }

    #[test]
    fn profile_write_and_conflict_from_another_archive_are_replaced() {
        let mut update = update_wire();
        update["archiveGeneration"] = json!("another-generation");
        assert!(matches!(
            parse_update(update, "synthetic-user", GENERATION),
            Err(RuntimeError::ArchiveReplaced)
        ));

        let mut conflict = conflict_wire();
        conflict["archiveGeneration"] = json!("another-generation");
        assert!(matches!(
            parse_conflict(conflict, "synthetic-user", GENERATION),
            Err(RuntimeError::ArchiveReplaced)
        ));

        // The session's own archive keeps the unchanged behaviour.
        let AccountProfileUpdateOutcome::Saved { changed, profile } =
            parse_update(update_wire(), "synthetic-user", GENERATION).unwrap()
        else {
            panic!("expected the confirmed save");
        };
        assert!(changed);
        assert_eq!(profile.archive_generation, GENERATION);
        let current = parse_conflict(conflict_wire(), "synthetic-user", GENERATION).unwrap();
        assert_eq!(current.archive_generation, GENERATION);
    }
}
