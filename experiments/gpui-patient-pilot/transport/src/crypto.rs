//! Wire compatibility with lib/security/security.ts and unlock-credential.ts.
use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use hkdf::Hkdf;
use pbkdf2::pbkdf2_hmac;
use serde_json::Value;
use sha2::Sha256;
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use crate::{Result, RuntimeError};

pub(crate) type MasterKey = Zeroizing<[u8; 32]>;
pub(crate) struct UnlockMaterial {
    pub kek: MasterKey,
    pub verifier: Zeroizing<String>,
}

pub(crate) fn normalize_passphrase(passphrase: &str) -> Result<Zeroizing<String>> {
    if passphrase.len() > 4096 {
        return Err(RuntimeError::InvalidInput);
    }
    let normalized = Zeroizing::new(passphrase.nfkc().collect::<String>());
    if !(15..=128).contains(&normalized.chars().count()) {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(normalized)
}

pub(crate) fn derive_v3(passphrase: &str, salt: &str) -> Result<UnlockMaterial> {
    let normalized = normalize_passphrase(passphrase)?;
    if salt.len() > 344 {
        return Err(RuntimeError::InvalidResponse);
    }
    let salt = Zeroizing::new(
        BASE64
            .decode(salt)
            .map_err(|_| RuntimeError::InvalidResponse)?,
    );
    if !(16..=256).contains(&salt.len()) {
        return Err(RuntimeError::InvalidResponse);
    }
    let mut root = Zeroizing::new([0u8; 32]);
    pbkdf2_hmac::<Sha256>(normalized.as_bytes(), &salt, 2_000_000, root.as_mut());
    let hkdf = Hkdf::<Sha256>::new(Some(&[]), root.as_ref());
    let mut kek = Zeroizing::new([0u8; 32]);
    let mut verifier = Zeroizing::new([0u8; 32]);
    hkdf.expand(b"mediflow.unlock.kek.v3", kek.as_mut())
        .map_err(|_| RuntimeError::Crypto)?;
    hkdf.expand(b"mediflow.unlock.verifier.v3", verifier.as_mut())
        .map_err(|_| RuntimeError::Crypto)?;
    Ok(UnlockMaterial {
        kek,
        verifier: Zeroizing::new(BASE64.encode(verifier.as_ref())),
    })
}

pub(crate) fn unwrap_v3(wrapped: &str, kek: &MasterKey) -> Result<MasterKey> {
    let wrapped = wrapped
        .strip_prefix("v3:")
        .ok_or(RuntimeError::InvalidResponse)?;
    if wrapped.len() != 80 {
        return Err(RuntimeError::InvalidResponse);
    }
    let bytes = Zeroizing::new(BASE64.decode(wrapped).map_err(|_| RuntimeError::Crypto)?);
    if bytes.len() != 60 {
        return Err(RuntimeError::Crypto);
    }
    let cipher = Aes256Gcm::new_from_slice(kek.as_ref()).map_err(|_| RuntimeError::Crypto)?;
    let raw = Zeroizing::new(
        cipher
            .decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..])
            .map_err(|_| RuntimeError::Crypto)?,
    );
    let mut key = Zeroizing::new([0u8; 32]);
    if raw.len() != key.len() {
        return Err(RuntimeError::Crypto);
    }
    key.copy_from_slice(&raw);
    Ok(key)
}

pub(crate) fn seal(value: &Value, master: &MasterKey) -> Result<String> {
    let mut iv = [0u8; 12];
    getrandom::fill(&mut iv).map_err(|_| RuntimeError::Crypto)?;
    seal_with_iv(value, master, &iv)
}

fn seal_with_iv(value: &Value, master: &MasterKey, iv: &[u8; 12]) -> Result<String> {
    let plaintext = Zeroizing::new(serde_json::to_vec(value).map_err(|_| RuntimeError::Crypto)?);
    let cipher = Aes256Gcm::new_from_slice(master.as_ref()).map_err(|_| RuntimeError::Crypto)?;
    let sealed = cipher
        .encrypt(Nonce::from_slice(iv), plaintext.as_slice())
        .map_err(|_| RuntimeError::Crypto)?;
    Ok(format!(
        "ENC:{}:{}",
        BASE64.encode(iv),
        BASE64.encode(sealed)
    ))
}

pub(crate) fn open(value: &str, master: &MasterKey) -> Result<Value> {
    if value.len() > 24 * 1024 * 1024 {
        return Err(RuntimeError::TooLarge);
    }
    let mut parts = value.split(':');
    if parts.next() != Some("ENC") {
        return Err(RuntimeError::Crypto);
    }
    let iv = BASE64
        .decode(parts.next().ok_or(RuntimeError::Crypto)?)
        .map_err(|_| RuntimeError::Crypto)?;
    let ciphertext = BASE64
        .decode(parts.next().ok_or(RuntimeError::Crypto)?)
        .map_err(|_| RuntimeError::Crypto)?;
    if parts.next().is_some() || iv.len() != 12 || ciphertext.len() < 16 {
        return Err(RuntimeError::Crypto);
    }
    let cipher = Aes256Gcm::new_from_slice(master.as_ref()).map_err(|_| RuntimeError::Crypto)?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(Nonce::from_slice(&iv), ciphertext.as_slice())
            .map_err(|_| RuntimeError::Crypto)?,
    );
    serde_json::from_slice(&plaintext).map_err(|_| RuntimeError::Crypto)
}

/// Legacy plaintext is displayable; ENC data must authenticate and JSON-decode.
/// Structured fields are rendered as JSON, never silently treated as empty.
pub(crate) fn display_field(value: &Value, master: &MasterKey, structured: bool) -> Result<Value> {
    let decoded = match value {
        Value::Null => return Ok(Value::Null),
        Value::String(text) if text.starts_with("ENC:") => open(text, master)?,
        Value::String(_) => return Ok(value.clone()),
        _ => return Err(RuntimeError::Crypto),
    };
    match decoded {
        Value::Null | Value::String(_) => Ok(decoded),
        Value::Array(_) | Value::Object(_) if structured => Ok(Value::String(
            serde_json::to_string(&decoded).map_err(|_| RuntimeError::Crypto)?,
        )),
        _ => Err(RuntimeError::Crypto),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn web_and_swift_field_golden_matches_bytes() {
        let key = Zeroizing::new(std::array::from_fn(|i| i as u8));
        let iv = std::array::from_fn(|i| 100 + i as u8);
        let expected =
            "ENC:ZGVmZ2hpamtsbW5v:akm7ABybIvEEQi6duwEYkmKxcmvpBZ8Xhf/mV+9XRjK5m/MiBpaG3SU=";
        let text = Value::String("Referto: quadro stabile".into());
        assert_eq!(seal_with_iv(&text, &key, &iv).unwrap(), expected);
        assert_eq!(open(expected, &key).unwrap(), text);
        assert!(open(expected, &Zeroizing::new([0; 32])).is_err());
    }
    #[test]
    fn unicode_null_and_reserved_prefix_are_unambiguous() {
        let key = Zeroizing::new([7; 32]);
        for value in [
            Value::Null,
            Value::String("".into()),
            Value::String("ENC:literal:🩺 e\u{301}\n汉字".into()),
        ] {
            let sealed = seal(&value, &key).unwrap();
            assert_eq!(open(&sealed, &key).unwrap(), value);
        }
        assert!(open("ENC:a:b:extra", &key).is_err());
        assert!(open("ENC:corrupt:value", &key).is_err());
        assert!(display_field(&Value::String("ENC:corrupt:value".into()), &key, false).is_err());
    }
    #[test]
    fn v3_normalizes_nfkc_without_trimming_or_scalar_truncation() {
        assert_eq!(
            normalize_passphrase("  ＡＢＣdefghijklmno  ")
                .unwrap()
                .as_str(),
            "  ABCdefghijklmno  "
        );
        assert!(normalize_passphrase(&"🩺".repeat(15)).is_ok());
        assert!(normalize_passphrase(&"🩺".repeat(129)).is_err());
        assert!(normalize_passphrase("1234").is_err());
    }

    #[test]
    fn canonical_native_v3_unlock_and_wrap_golden() {
        // The same pre-existing Node-produced fixture used by the Swift client.
        let vector: Value = serde_json::from_str(include_str!(
            "../../../../native/contracts/crypto-golden-vectors.v3.json"
        ))
        .unwrap();
        let material = derive_v3(
            vector["passphrase"].as_str().unwrap(),
            vector["salt"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(
            material.verifier.as_str(),
            vector["verifier"].as_str().unwrap()
        );
        let master =
            unwrap_v3(vector["wrappedMasterKey"].as_str().unwrap(), &material.kek).unwrap();
        assert_eq!(master.as_ref(), &(1..=32).collect::<Vec<u8>>());
        assert!(
            unwrap_v3(
                vector["wrappedMasterKey"].as_str().unwrap(),
                &Zeroizing::new([0; 32])
            )
            .is_err()
        );
        assert!(unwrap_v3("v2:wrong-version", &material.kek).is_err());
    }

    #[test]
    fn independent_node_unicode_and_structured_fields_decode() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../comparison/crypto-v3-vectors.json")).unwrap();
        for vector in fixture["vectors"].as_array().unwrap() {
            let hex = vector["masterKeyHex"].as_str().unwrap();
            let mut master = Zeroizing::new([0; 32]);
            for (i, value) in master.iter_mut().enumerate() {
                *value = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap();
            }
            for field in vector["sealedFields"].as_array().unwrap() {
                assert_eq!(
                    open(field["envelope"].as_str().unwrap(), &master).unwrap(),
                    field["plaintext"]
                );
            }
        }
    }
}
