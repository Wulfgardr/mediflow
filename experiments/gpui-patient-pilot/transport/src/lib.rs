//! Rust client for the existing paired, operator-authenticated HTTP runtime.
//! No database, server authority, credential persistence, retries or alternate writer.

#![forbid(unsafe_code)]

mod ai_preferences;
mod analytics;
mod catalogs;
mod crypto;
mod dto;
mod error;
mod http;
mod profile_query;
mod scales;
mod session;
mod tls;
mod who;

pub use ai_preferences::*;
pub use analytics::*;
pub use catalogs::*;
pub use dto::*;
pub use error::{Result, RuntimeError};
pub use http::{PairingCredentials, RuntimeClient, RuntimeConfig};
pub use profile_query::{ProfileCurrentness, ProfileProjection};
pub use scales::*;
pub use session::{AiPreferencesContext, ProfileQueryIntent, RuntimeSession};
pub use who::{
    WHO_ATTRIBUTION, WhoEntry, WhoReadiness, WhoReadinessStatus, WhoReceipt, WhoSearchResponse,
    WhoSource, normalize_who_query,
};

pub(crate) const MAX_SAFE_VERSION: u64 = 9_007_199_254_740_991;

pub(crate) fn validate_id(id: &str) -> Result<()> {
    validate_scope_id(id)?;
    // URL path builders normalize these complete segments. Other opaque IDs
    // keep their exact spelling, including spaces, Unicode and literal '%'.
    if matches!(id, "." | "..") {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn validate_scope_id(id: &str) -> Result<()> {
    // The service's opaque IDs are not UUID-only. Match its non-empty trim
    // condition without trimming the value; reject control characters before
    // it can be used in either an HTTP field or a URL.
    if id.trim_matches(js_whitespace).is_empty() || id.chars().any(char::is_control) {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn validate_pairing_id(id: &str) -> Result<()> {
    // Device identifiers are sent as their own HTTP header, not a path/cookie.
    if id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(())
}

fn js_whitespace(character: char) -> bool {
    matches!(character, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

pub(crate) fn validate_version(version: u64) -> Result<()> {
    if version == 0 || version > MAX_SAFE_VERSION {
        Err(RuntimeError::InvalidInput)
    } else {
        Ok(())
    }
}
