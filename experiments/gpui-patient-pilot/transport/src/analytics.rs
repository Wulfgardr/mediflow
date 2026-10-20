//! Population demographics read: the host computes the projection and the
//! client only verifies and presents it. No age, bucket or aggregate is
//! calculated here, and diagnostic counts are deliberately absent.

use crate::{Result, RuntimeError};
use serde::Deserialize;
use serde_json::Value;

pub const POPULATION_DEMOGRAPHICS_OPERATION: &str = "population-demographics.read.v1";
pub const POPULATION_DEMOGRAPHICS_CAPABILITY: &str = "network.replica.readonly-patients";
pub const POPULATION_DEMOGRAPHICS_MAX_BYTES: usize = 4096;
pub(crate) const DEMOGRAPHICS_PATH: &[&str] =
    &["api", "v1", "network", "analytics", "demographics"];

/// The only presentation parameters accepted by the host. Bounds are
/// normalized before they become the exact query values.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DemographicsRequest {
    min_age: u8,
    max_age: u8,
    time_zone: String,
}

impl DemographicsRequest {
    pub fn new(min_age: u8, max_age: u8, time_zone: &str) -> Result<Self> {
        if min_age > 120 || max_age > 120 || !valid_time_zone(time_zone) {
            return Err(RuntimeError::InvalidInput);
        }
        Ok(Self {
            min_age: min_age.min(max_age),
            max_age: min_age.max(max_age),
            time_zone: time_zone.to_owned(),
        })
    }

    pub fn min_age(&self) -> u8 {
        self.min_age
    }

    pub fn max_age(&self) -> u8 {
        self.max_age
    }

    pub fn time_zone(&self) -> &str {
        &self.time_zone
    }
}

fn valid_time_zone(value: &str) -> bool {
    if value.is_empty() || value.len() > 100 {
        return false;
    }
    let mut bytes = value.bytes();
    if !bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic()) {
        return false;
    }
    let mut after_slash = false;
    for byte in bytes {
        match byte {
            b'/' if after_slash => return false,
            b'/' => after_slash = true,
            b if b.is_ascii_alphanumeric() || matches!(b, b'_' | b'+' | b'-') => {
                after_slash = false;
            }
            _ => return false,
        }
    }
    !after_slash
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemographicsScope {
    ambulatory_id: String,
    archive_generation: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgeDistribution {
    #[serde(rename = "0-18")]
    pub up_to_18: u64,
    #[serde(rename = "19-64")]
    pub from_19_to_64: u64,
    #[serde(rename = "65-80")]
    pub from_65_to_80: u64,
    #[serde(rename = "80+")]
    pub over_80: u64,
}

impl AgeDistribution {
    pub fn rows(&self) -> [(&'static str, u64); 4] {
        [
            ("0-18", self.up_to_18),
            ("19-64", self.from_19_to_64),
            ("65-80", self.from_65_to_80),
            ("80+", self.over_80),
        ]
    }

    fn sum(&self) -> Option<u64> {
        self.up_to_18
            .checked_add(self.from_19_to_64)?
            .checked_add(self.from_65_to_80)?
            .checked_add(self.over_80)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemographicsStats {
    pub total_in_range: u64,
    pub with_birth_date: u64,
    pub without_birth_date: u64,
    pub adi_count: u64,
    pub age_dist: AgeDistribution,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PopulationDemographics {
    operation: String,
    contract_version: u8,
    scope: DemographicsScope,
    pub age_range: [u8; 2],
    pub time_zone: String,
    pub observed_at: String,
    pub stats: DemographicsStats,
}

/// Accepts the host projection only when every closed-contract assertion holds.
/// The counters stay host values: this parser compares them, it never derives
/// them from a patient list. The time zone is a presentation parameter that the
/// host reports canonicalized (`Etc/UTC` becomes `UTC`), so only its IANA shape
/// is asserted; the response value is what the view presents.
pub(crate) fn parse_demographics(
    value: Value,
    scope: &str,
    archive_generation: &str,
    request: &DemographicsRequest,
) -> Result<PopulationDemographics> {
    let result: PopulationDemographics =
        serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
    let stats = &result.stats;
    let coherent = result.operation == POPULATION_DEMOGRAPHICS_OPERATION
        && result.contract_version == 1
        && result.scope.ambulatory_id == scope
        && result.scope.archive_generation == archive_generation
        && result.age_range == [request.min_age, request.max_age]
        && valid_time_zone(&result.time_zone)
        && stats.age_dist.sum() == Some(stats.total_in_range)
        && stats.total_in_range <= stats.with_birth_date
        && stats.adi_count <= stats.total_in_range
        && chrono::DateTime::parse_from_rfc3339(&result.observed_at).is_ok();
    if !coherent {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_wire() -> Value {
        json!({
            "operation": POPULATION_DEMOGRAPHICS_OPERATION,
            "contractVersion": 1,
            "scope": {"ambulatoryId": "scope-a", "archiveGeneration": "synthetic-generation"},
            "ageRange": [0, 120],
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

    fn request() -> DemographicsRequest {
        DemographicsRequest::new(0, 120, "Europe/Rome").unwrap()
    }

    fn parse(value: Value) -> Result<PopulationDemographics> {
        parse_demographics(value, "scope-a", "synthetic-generation", &request())
    }

    #[test]
    fn accepts_the_exact_host_projection_without_recomputing_it() {
        let result = parse(valid_wire()).unwrap();
        assert_eq!(result.age_range, [0, 120]);
        assert_eq!(result.time_zone, "Europe/Rome");
        assert_eq!(result.stats.total_in_range, 7);
        assert_eq!(result.stats.with_birth_date, 9);
        assert_eq!(result.stats.without_birth_date, 2);
        assert_eq!(result.stats.adi_count, 3);
        assert_eq!(
            result.stats.age_dist.rows(),
            [("0-18", 1), ("19-64", 2), ("65-80", 3), ("80+", 1)]
        );
    }

    #[test]
    fn rejects_every_closed_contract_violation() {
        type Mutation = Box<dyn Fn(&mut Value)>;
        let cases: Vec<(&str, Mutation)> = vec![
            (
                "operation",
                Box::new(|v| v["operation"] = json!("patient-analytics.read.v1")),
            ),
            (
                "contractVersion",
                Box::new(|v| v["contractVersion"] = json!(2)),
            ),
            (
                "different scope",
                Box::new(|v| v["scope"]["ambulatoryId"] = json!("scope-b")),
            ),
            (
                "different archive",
                Box::new(|v| v["scope"]["archiveGeneration"] = json!("other-generation")),
            ),
            (
                "different ageRange",
                Box::new(|v| v["ageRange"] = json!([0, 80])),
            ),
            (
                "incoherent ageDist sum",
                Box::new(|v| v["stats"]["ageDist"]["80+"] = json!(2)),
            ),
            (
                "total above born",
                Box::new(|v| v["stats"]["withBirthDate"] = json!(6)),
            ),
            (
                "overflowing ageDist",
                Box::new(|v| {
                    v["stats"]["ageDist"]["0-18"] = json!(u64::MAX);
                    v["stats"]["ageDist"]["19-64"] = json!(u64::MAX);
                }),
            ),
            (
                "adi above total",
                Box::new(|v| v["stats"]["adiCount"] = json!(8)),
            ),
            (
                "negative counter",
                Box::new(|v| v["stats"]["totalInRange"] = json!(-1)),
            ),
            (
                "fractional counter",
                Box::new(|v| v["stats"]["adiCount"] = json!(1.5)),
            ),
            (
                "extra top-level field",
                Box::new(|v| v["withDiagnoses"] = json!(0)),
            ),
            (
                "extra stats field",
                Box::new(|v| v["stats"]["topDiagnoses"] = json!([])),
            ),
            (
                "extra bucket",
                Box::new(|v| v["stats"]["ageDist"]["120+"] = json!(0)),
            ),
            (
                "missing stats",
                Box::new(|v| {
                    v.as_object_mut().unwrap().remove("stats");
                }),
            ),
            (
                "invalid observedAt",
                Box::new(|v| v["observedAt"] = json!("ieri")),
            ),
            (
                "ageRange out of byte",
                Box::new(|v| v["ageRange"] = json!([0, 300])),
            ),
        ];
        for (label, mutate) in cases {
            let mut value = valid_wire();
            mutate(&mut value);
            assert_eq!(parse(value), Err(RuntimeError::InvalidResponse), "{label}");
        }
    }

    #[test]
    fn request_normalizes_bounds_and_accepts_only_iana_shaped_zones() {
        let reversed = DemographicsRequest::new(80, 20, "Europe/Rome").unwrap();
        assert_eq!((reversed.min_age(), reversed.max_age()), (20, 80));
        assert!(DemographicsRequest::new(121, 0, "UTC").is_err());
        assert!(DemographicsRequest::new(0, 120, "UTC").is_ok());
        for zone in [
            "Europe/Rome",
            "America/Argentina/Buenos_Aires",
            "America/Port-au-Prince",
            "Etc/GMT+5",
            "America/Indiana/Indianapolis",
        ] {
            assert!(DemographicsRequest::new(0, 120, zone).is_ok(), "{zone}");
        }
        for zone in [
            "",
            "/Rome",
            "Europe/",
            "Europe//Rome",
            "Europe/Rome ",
            " Europe/Rome",
            "+01:00",
            "Europe/Rome/",
            "Europe/Rom\u{e0}",
        ] {
            assert!(DemographicsRequest::new(0, 120, zone).is_err(), "{zone}");
        }
        let long = format!("A{}", "a".repeat(100));
        assert_eq!(long.len(), 101);
        assert!(DemographicsRequest::new(0, 120, &long).is_err());
        let longest = format!("A{}", "a".repeat(99));
        assert_eq!(longest.len(), 100);
        assert!(DemographicsRequest::new(0, 120, &longest).is_ok());
    }

    #[test]
    fn parser_compares_normalized_bounds_sent_on_the_wire() {
        let request = DemographicsRequest::new(80, 20, "Europe/Rome").unwrap();
        let mut value = valid_wire();
        value["ageRange"] = json!([20, 80]);
        assert!(parse_demographics(value, "scope-a", "synthetic-generation", &request).is_ok());
    }

    #[test]
    fn accepts_the_host_canonical_alias_of_the_requested_time_zone() {
        for (requested, reported) in [("Etc/UTC", "UTC"), ("Asia/Kolkata", "Asia/Calcutta")] {
            let request = DemographicsRequest::new(0, 120, requested).unwrap();
            let mut value = valid_wire();
            value["timeZone"] = json!(reported);
            let result =
                parse_demographics(value, "scope-a", "synthetic-generation", &request).unwrap();
            assert_eq!(result.time_zone, reported, "{requested}");
        }
    }

    #[test]
    fn rejects_a_reported_time_zone_that_is_not_iana_shaped() {
        for reported in [
            json!(""),
            json!("../etc"),
            json!(-42),
            json!("A".repeat(101)),
        ] {
            let mut value = valid_wire();
            value["timeZone"] = reported.clone();
            assert_eq!(
                parse(value),
                Err(RuntimeError::InvalidResponse),
                "{reported}"
            );
        }
    }
}
