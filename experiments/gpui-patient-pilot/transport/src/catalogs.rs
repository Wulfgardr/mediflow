//! Read-only projections of the home-base reference catalogs. Labels, codes,
//! nullable values and provenance are preserved exactly as returned by the host.

use crate::{Result, RuntimeError, RuntimeSession, session::CatalogRoute};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DrugCatalogItem {
    pub aic: String,
    pub name: String,
    pub active_principle: Option<String>,
    pub company: Option<String>,
    pub packaging: Option<String>,
    pub class: Option<String>,
    pub price: Option<f64>,
    pub atc: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExemptionCatalogItem {
    pub code: String,
    pub description: String,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub source: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub is_pharma: Option<bool>,
    pub is_specialist: Option<bool>,
    pub is_national: Option<bool>,
    pub updated_at: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Hash)]
pub enum TerminologySystem {
    #[serde(rename = "AIC")]
    Aic,
    #[serde(rename = "ATC")]
    Atc,
    #[serde(rename = "ICD-11")]
    Icd11,
    #[serde(rename = "LOINC")]
    Loinc,
    #[serde(rename = "UCUM")]
    Ucum,
    #[serde(rename = "SNOMED-CT")]
    SnomedCt,
    #[serde(rename = "CND")]
    Cnd,
}

impl TerminologySystem {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Aic => "AIC",
            Self::Atc => "ATC",
            Self::Icd11 => "ICD-11",
            Self::Loinc => "LOINC",
            Self::Ucum => "UCUM",
            Self::SnomedCt => "SNOMED-CT",
            Self::Cnd => "CND",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminologyItem {
    pub system: TerminologySystem,
    pub code: String,
    pub display: String,
    pub display_it: Option<String>,
    pub default_unit: Option<String>,
    pub version: Option<String>,
    pub source: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TerminologyRegistryStatus {
    Active,
    Planned,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminologyRegistryEntry {
    pub system: TerminologySystem,
    pub display: String,
    pub version: Option<String>,
    pub source: String,
    pub status: TerminologyRegistryStatus,
    pub updated_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
struct CatalogCount {
    count: u64,
}

fn validate_limit(limit: u16, maximum: u16) -> Result<()> {
    if limit == 0 || limit > maximum {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(())
}

fn bounded<T>(rows: Vec<T>, maximum: usize) -> Result<Vec<T>> {
    if rows.len() > maximum {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(rows)
}

fn validate_code(code: &str) -> Result<()> {
    if code.trim_matches(crate::js_whitespace).is_empty() || code.chars().any(char::is_control) {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(())
}

fn bulk_exemption_codes(codes: &[&str]) -> Result<String> {
    if codes.is_empty() || codes.len() > 200 {
        return Err(RuntimeError::InvalidInput);
    }
    for code in codes {
        validate_code(code)?;
        // Comma is the existing endpoint's list delimiter. Refuse an ambiguous
        // individual code instead of silently asking for a different code set.
        if code.contains(',') {
            return Err(RuntimeError::InvalidInput);
        }
    }
    Ok(codes.join(","))
}

impl RuntimeSession {
    /// The catalog is global reference data; the session still proves its
    /// current operator/device and exact admitted scope on every request.
    pub fn search_drugs(
        &self,
        scope: &str,
        query: &str,
        limit: u16,
    ) -> Result<Vec<DrugCatalogItem>> {
        validate_limit(limit, 50)?;
        let count = limit.to_string();
        bounded(
            self.read_catalog(
                scope,
                CatalogRoute::Drugs,
                &[("q", query), ("limit", &count)],
            )?,
            usize::from(limit),
        )
    }

    pub fn drug_count(&self, scope: &str) -> Result<u64> {
        self.read_catalog::<CatalogCount>(scope, CatalogRoute::Drugs, &[("count", "1")])
            .map(|result| result.count)
    }

    pub fn search_exemptions(
        &self,
        scope: &str,
        query: &str,
        limit: u16,
    ) -> Result<Vec<ExemptionCatalogItem>> {
        validate_limit(limit, 200)?;
        let count = limit.to_string();
        bounded(
            self.read_catalog(
                scope,
                CatalogRoute::Exemptions,
                &[("q", query), ("limit", &count)],
            )?,
            usize::from(limit),
        )
    }

    pub fn exemptions_by_codes(
        &self,
        scope: &str,
        codes: &[&str],
    ) -> Result<Vec<ExemptionCatalogItem>> {
        let query = bulk_exemption_codes(codes)?;
        bounded(
            self.read_catalog(scope, CatalogRoute::Exemptions, &[("codes", &query)])?,
            codes.len(),
        )
    }

    pub fn exemption_count(&self, scope: &str) -> Result<u64> {
        self.read_catalog::<CatalogCount>(scope, CatalogRoute::Exemptions, &[("count", "1")])
            .map(|result| result.count)
    }

    pub fn terminology_systems(&self, scope: &str) -> Result<Vec<TerminologyRegistryEntry>> {
        self.read_catalog(scope, CatalogRoute::TerminologySystems, &[])
    }

    /// This existing route currently searches ATC, LOINC and UCUM. Registry
    /// presence alone is not evidence that this route searches another system.
    /// The dedicated WHO ICD-11 service has a separate response contract.
    pub fn search_terminology(
        &self,
        scope: &str,
        system: TerminologySystem,
        query: &str,
        limit: u16,
    ) -> Result<Vec<TerminologyItem>> {
        validate_limit(limit, 200)?;
        let count = limit.to_string();
        let rows: Vec<TerminologyItem> = self.read_catalog(
            scope,
            CatalogRoute::TerminologySearch,
            &[("system", system.as_str()), ("q", query), ("limit", &count)],
        )?;
        if rows.iter().any(|row| row.system != system) {
            return Err(RuntimeError::InvalidResponse);
        }
        bounded(rows, usize::from(limit))
    }

    /// A 404 remains RuntimeError::Missing; a service failure never becomes an
    /// empty successful result or a locally inferred terminology label.
    pub fn resolve_terminology(
        &self,
        scope: &str,
        system: TerminologySystem,
        code: &str,
    ) -> Result<TerminologyItem> {
        validate_code(code)?;
        let result: TerminologyItem = self.read_catalog(
            scope,
            CatalogRoute::TerminologyResolve,
            &[("system", system.as_str()), ("code", code)],
        )?;
        // The host resolves these code systems case-insensitively and returns
        // its canonical spelling. Verify identity without rewriting that value.
        if result.system != system
            || !result
                .code
                .eq_ignore_ascii_case(code.trim_matches(crate::js_whitespace))
        {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn catalog_dtos_preserve_identifiers_labels_and_nullable_flags() {
        let drug: DrugCatalogItem = serde_json::from_value(json!({
            "aic":"000123456", "name":" Nome sintetico — città ",
            "activePrinciple":"Principio sintetico", "company":null, "packaging":"Unità 🩺",
            "class":"A", "price":12.34, "atc":null
        }))
        .unwrap();
        assert_eq!(drug.aic, "000123456");
        assert_eq!(drug.name, " Nome sintetico — città ");
        assert_eq!(drug.packaging.as_deref(), Some("Unità 🩺"));
        assert_eq!(drug.price, Some(12.34));
        assert_eq!(drug.company, None);
        let exemption: ExemptionCatalogItem = serde_json::from_value(json!({
            "code":"E01", "description":"Descrizione sintetica", "type":null, "source":"test",
            "startDate":null, "endDate":null, "isPharma":null, "isSpecialist":false,
            "isNational":true, "updatedAt":null
        }))
        .unwrap();
        assert_eq!(exemption.is_pharma, None);
        assert_eq!(exemption.is_specialist, Some(false));
        assert_eq!(exemption.is_national, Some(true));
        assert_eq!(exemption.source.as_deref(), Some("test"));
    }

    #[test]
    fn terminology_preserves_provenance_and_does_not_invent_missing_translation() {
        let item: TerminologyItem = serde_json::from_value(json!({
            "system":"UCUM", "code":"mm[Hg]", "display":"millimeter of mercury",
            "displayIt":"Millimetro di mercurio", "defaultUnit":null,
            "version":"2.1", "source":"host-static-catalog"
        }))
        .unwrap();
        assert_eq!(item.system, TerminologySystem::Ucum);
        assert_eq!(item.code, "mm[Hg]");
        assert_eq!(item.display, "millimeter of mercury");
        assert_eq!(item.display_it.as_deref(), Some("Millimetro di mercurio"));
        assert_eq!(item.version.as_deref(), Some("2.1"));
        assert_eq!(item.source, "host-static-catalog");
        let untranslated: TerminologyItem = serde_json::from_value(json!({
            "system":"ATC", "code":"TEST", "display":"Exact source label", "source":"test"
        }))
        .unwrap();
        assert_eq!(untranslated.display_it, None);
        assert_eq!(untranslated.version, None);
        assert!(
            serde_json::from_value::<TerminologyItem>(json!({
                "system":"LOINC", "code":8480, "display":"Bad code type", "source":"test"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminologyRegistryEntry>(json!({
                "system":"LOINC", "display":"LOINC", "source":"test", "status":"ready"
            }))
            .is_err()
        );
    }

    #[test]
    fn catalog_bounds_reject_truncation_and_ambiguous_bulk_codes() {
        assert_eq!(validate_limit(0, 50), Err(RuntimeError::InvalidInput));
        assert_eq!(validate_limit(51, 50), Err(RuntimeError::InvalidInput));
        assert_eq!(validate_limit(50, 50), Ok(()));
        assert_eq!(bounded(vec![1, 2], 1), Err(RuntimeError::InvalidResponse));
        assert_eq!(bulk_exemption_codes(&[]), Err(RuntimeError::InvalidInput));
        assert_eq!(
            bulk_exemption_codes(&["E01,E02"]),
            Err(RuntimeError::InvalidInput)
        );
        assert_eq!(
            bulk_exemption_codes(&["E01"; 201]),
            Err(RuntimeError::InvalidInput)
        );
        assert_eq!(validate_code("\u{feff}"), Err(RuntimeError::InvalidInput));
        assert_eq!(
            bulk_exemption_codes(&["e01", "E02"]),
            Ok("e01,E02".to_owned())
        );
        assert!(serde_json::from_value::<CatalogCount>(json!({"count":-1})).is_err());
        assert!(serde_json::from_value::<CatalogCount>(json!({"count":"1"})).is_err());
    }
}
