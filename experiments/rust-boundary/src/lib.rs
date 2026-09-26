/* @Codex */
#![forbid(unsafe_code)]
use serde_json::{Map, Value};

pub const MAX_FRAME_BYTES: usize = 4096;
const IPC_SCHEMA: &str = "mediflow.portable-supervisor.web-ipc.v1";
const CAPTURE_SCHEMA: &str = "mediflow.portable-supervisor.web-capture.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodecError {
    FrameInvalid,
    FrameTooLarge,
}

impl CodecError {
    pub fn code(self) -> &'static str {
        match self {
            Self::FrameInvalid => "frame_invalid",
            Self::FrameTooLarge => "frame_too_large",
        }
    }
}

fn invalid<T>() -> Result<T, CodecError> { Err(CodecError::FrameInvalid) }
fn object(value: &Value) -> Result<&Map<String, Value>, CodecError> {
    value.as_object().ok_or(CodecError::FrameInvalid)
}
fn exact(map: &Map<String, Value>, keys: &[&str]) -> Result<(), CodecError> {
    if map.len() == keys.len() && keys.iter().all(|key| map.contains_key(*key)) { Ok(()) } else { invalid() }
}
fn string<'a>(map: &'a Map<String, Value>, key: &str) -> Result<&'a str, CodecError> {
    map.get(key).and_then(Value::as_str).ok_or(CodecError::FrameInvalid)
}
fn number(map: &Map<String, Value>, key: &str, min: u64) -> Result<u64, CodecError> {
    let n = map.get(key).and_then(Value::as_u64).ok_or(CodecError::FrameInvalid)?;
    if (min..=9_007_199_254_740_991).contains(&n) { Ok(n) } else { invalid() }
}
fn quoted(value: &str) -> String { serde_json::to_string(value).expect("string serialization") }
fn prefixed_hex(value: &str, prefix: &str, hex_len: usize) -> bool {
    value.strip_prefix(prefix).is_some_and(|tail| tail.len() == hex_len && tail.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)))
}
fn host_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=128).contains(&bytes.len())
        && bytes[0].is_ascii_alphanumeric()
        && bytes[1..].iter().all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(c))
}
fn req(map: &Map<String, Value>) -> Result<String, CodecError> {
    let value = string(map, "requestRef")?;
    if prefixed_hex(value, "pswr_", 32) { Ok(quoted(value)) } else { invalid() }
}
fn challenge(map: &Map<String, Value>) -> Result<String, CodecError> {
    let value = string(map, "challenge")?;
    if prefixed_hex(value, "pswc_", 64) { Ok(quoted(value)) } else { invalid() }
}
fn capture(value: &Value) -> Result<String, CodecError> {
    let map = object(value)?;
    exact(map, &["schemaVersion", "userRef", "parentRef", "patientId", "ambulatoryId", "selectionEpoch", "expectedPatientVersion", "expiresAt"])?;
    if string(map, "schemaVersion")? != CAPTURE_SCHEMA { return invalid(); }
    let user = string(map, "userRef")?;
    let parent = string(map, "parentRef")?;
    let patient = string(map, "patientId")?;
    let ambulatory = string(map, "ambulatoryId")?;
    if !prefixed_hex(user, "user.", 64) || !prefixed_hex(parent, "parent.", 64)
        || !host_id(patient) || !host_id(ambulatory) { return invalid(); }
    let epoch = number(map, "selectionEpoch", 0)?;
    let version = number(map, "expectedPatientVersion", 1)?;
    let expires = number(map, "expiresAt", 1)?;
    Ok(format!("{{\"schemaVersion\":{},\"userRef\":{},\"parentRef\":{},\"patientId\":{},\"ambulatoryId\":{},\"selectionEpoch\":{},\"expectedPatientVersion\":{},\"expiresAt\":{}}}",
        quoted(CAPTURE_SCHEMA), quoted(user), quoted(parent), quoted(patient), quoted(ambulatory), epoch, version, expires))
}
fn member<'a>(value: &'a Value, options: &[&str]) -> Result<&'a str, CodecError> {
    let s = value.as_str().ok_or(CodecError::FrameInvalid)?;
    if options.contains(&s) { Ok(s) } else { invalid() }
}
fn canonical(value: &Value) -> Result<String, CodecError> {
    let map = object(value)?;
    if string(map, "schemaVersion")? != IPC_SCHEMA { return invalid(); }
    let method = string(map, "method")?;
    let common = format!("\"schemaVersion\":{},\"method\":{},\"requestRef\":{}", quoted(IPC_SCHEMA), quoted(method), req(map)?);
    let rest = match method {
        "prepare" => { exact(map, &["schemaVersion", "method", "requestRef"])?; String::new() }
        "activate" => {
            exact(map, &["schemaVersion", "method", "requestRef", "challenge", "capture"])?;
            format!(",\"challenge\":{},\"capture\":{}", challenge(map)?, capture(map.get("capture").ok_or(CodecError::FrameInvalid)?)?)
        }
        "revoke_all" => {
            exact(map, &["schemaVersion", "method", "requestRef", "reason"])?;
            let reason = member(map.get("reason").ok_or(CodecError::FrameInvalid)?,
                &["logout", "application_lock", "reselection", "expiry", "web_disconnect", "mcp_disconnect", "restart", "explicit"])?;
            format!(",\"reason\":{}", quoted(reason))
        }
        "ack" => {
            let outcome = string(map, "outcome")?;
            match outcome {
                "prepared" => {
                    exact(map, &["schemaVersion", "method", "requestRef", "outcome", "challenge", "expiresAt"])?;
                    format!(",\"outcome\":\"prepared\",\"challenge\":{},\"expiresAt\":{}", challenge(map)?, number(map, "expiresAt", 1)?)
                }
                "activated" => {
                    exact(map, &["schemaVersion", "method", "requestRef", "outcome", "expiresAt"])?;
                    format!(",\"outcome\":\"activated\",\"expiresAt\":{}", number(map, "expiresAt", 1)?)
                }
                "revoked" => { exact(map, &["schemaVersion", "method", "requestRef", "outcome"])?; ",\"outcome\":\"revoked\"".to_owned() }
                "denied" => {
                    exact(map, &["schemaVersion", "method", "requestRef", "outcome", "denialCode"])?;
                    let code = member(map.get("denialCode").ok_or(CodecError::FrameInvalid)?,
                        &["protocol_invalid", "frame_too_large", "replayed", "challenge_invalid", "challenge_expired", "context_invalid", "context_stale", "already_bound", "host_unavailable", "activation_failed", "revoke_failed", "timeout"])?;
                    format!(",\"outcome\":\"denied\",\"denialCode\":{}", quoted(code))
                }
                _ => return invalid(),
            }
        }
        _ => return invalid(),
    };
    Ok(format!("{{{}{}}}", common, rest))
}

pub fn decode(frame: &[u8]) -> Result<String, CodecError> {
    if frame.len() > MAX_FRAME_BYTES { return Err(CodecError::FrameTooLarge); }
    let source = std::str::from_utf8(frame).map_err(|_| CodecError::FrameInvalid)?;
    let value: Value = serde_json::from_str(source).map_err(|_| CodecError::FrameInvalid)?;
    let output = canonical(&value)?;
    if output == source { Ok(output) } else { invalid() }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SCHEMA: &str = "mediflow.portable-supervisor.web-ipc.v1";
    const REQUEST: &str = "pswr_11111111111111111111111111111111";
    fn prepare() -> String { format!("{{\"schemaVersion\":\"{SCHEMA}\",\"method\":\"prepare\",\"requestRef\":\"{REQUEST}\"}}") }
    #[test]
    fn seven_frames_and_safe_integer_boundary() {
        let base = format!("\"schemaVersion\":\"{SCHEMA}\",\"method\":");
        let request = format!("\"requestRef\":\"{REQUEST}\"");
        let challenge = format!("pswc_{}", "2".repeat(64));
        let capture = format!("{{\"schemaVersion\":\"{CAPTURE_SCHEMA}\",\"userRef\":\"user.{}\",\"parentRef\":\"parent.{}\",\"patientId\":\"patient.synthetic.01\",\"ambulatoryId\":\"ambulatory.synthetic.01\",\"selectionEpoch\":0,\"expectedPatientVersion\":1,\"expiresAt\":9007199254740991}}", "3".repeat(64), "4".repeat(64));
        let frames = [prepare(), format!("{{{base}\"activate\",{request},\"challenge\":\"{challenge}\",\"capture\":{capture}}}"),
            format!("{{{base}\"revoke_all\",{request},\"reason\":\"logout\"}}"),
            format!("{{{base}\"ack\",{request},\"outcome\":\"prepared\",\"challenge\":\"{challenge}\",\"expiresAt\":1}}"),
            format!("{{{base}\"ack\",{request},\"outcome\":\"activated\",\"expiresAt\":9007199254740991}}"),
            format!("{{{base}\"ack\",{request},\"outcome\":\"revoked\"}}"),
            format!("{{{base}\"ack\",{request},\"outcome\":\"denied\",\"denialCode\":\"timeout\"}}")];
        for frame in frames { assert_eq!(decode(frame.as_bytes()), Ok(frame)); }
        let over = format!("{{{base}\"ack\",{request},\"outcome\":\"activated\",\"expiresAt\":9007199254740992}}");
        assert_eq!(decode(over.as_bytes()), Err(CodecError::FrameInvalid));
    }
    #[test]
    fn rejects_noncanonical_forms_and_bad_bytes() {
        let valid = prepare();
        let cases = [format!(" {valid}"), valid.replace("\"schemaVersion\"", "\"method\":\"prepare\",\"schemaVersion\""),
            valid.replace("\"method\":\"prepare\"", "\"method\":\"prepare\",\"method\":\"prepare\""),
            valid.replace("\"prepare\"", "\"pre\\u0070are\""), valid.replace("\"prepare\"", "\"bad\""),
            valid.replace("\"requestRef\"", "\"other\""), valid.replace("\"prepare\"", "\"prepare\",\"extra\":1")];
        for case in cases { assert_eq!(decode(case.as_bytes()), Err(CodecError::FrameInvalid), "{case}"); }
        assert_eq!(decode(&[0xff]), Err(CodecError::FrameInvalid));
        assert_eq!(decode(&vec![b'x'; 4097]), Err(CodecError::FrameTooLarge));
    }
}
