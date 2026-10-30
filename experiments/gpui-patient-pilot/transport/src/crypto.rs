//! Wire compatibility with lib/security/security.ts and unlock-credential.ts.
use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
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

pub(crate) struct PassphraseBundle {
    pub credentials: Zeroizing<String>,
    pub kit: Zeroizing<String>,
    pub recovery_key: Zeroizing<String>,
}

fn random_salt() -> Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| RuntimeError::Crypto)?;
    Ok(BASE64.encode(bytes))
}

pub(crate) fn wrap_key(master: &MasterKey, kek: &MasterKey, prefix: &str) -> Result<String> {
    let mut iv = [0u8; 12];
    getrandom::fill(&mut iv).map_err(|_| RuntimeError::Crypto)?;
    wrap_key_with_iv(master, kek, prefix, &iv)
}
fn wrap_key_with_iv(
    master: &MasterKey,
    kek: &MasterKey,
    prefix: &str,
    iv: &[u8; 12],
) -> Result<String> {
    let cipher = Aes256Gcm::new_from_slice(kek.as_ref()).map_err(|_| RuntimeError::Crypto)?;
    let sealed = cipher
        .encrypt(Nonce::from_slice(iv), master.as_ref())
        .map_err(|_| RuntimeError::Crypto)?;
    let mut bytes = iv.to_vec();
    bytes.extend(sealed);
    Ok(format!("{prefix}{}", BASE64.encode(bytes)))
}

fn format_recovery_key(entropy: &[u8; 20]) -> Zeroizing<String> {
    let alphabet = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let mut recovery_key = Zeroizing::new(String::new());
    for index in 0..32 {
        if index > 0 && index % 4 == 0 {
            recovery_key.push('-');
        }
        let bit = index * 5;
        let mut value = 0usize;
        for offset in 0..5 {
            value = (value << 1)
                | usize::from((entropy[(bit + offset) / 8] >> (7 - (bit + offset) % 8)) & 1);
        }
        recovery_key.push(alphabet[value] as char);
    }
    recovery_key
}
fn recovery_material(entropy: &[u8], salt: &str) -> Result<(MasterKey, MasterKey)> {
    let decoded_salt = BASE64.decode(salt).map_err(|_| RuntimeError::Crypto)?;
    let hkdf = Hkdf::<Sha256>::new(Some(&decoded_salt), entropy);
    let mut kek = Zeroizing::new([0u8; 32]);
    let mut verifier = Zeroizing::new([0u8; 32]);
    hkdf.expand(b"mediflow.recovery.kek.v1", kek.as_mut())
        .map_err(|_| RuntimeError::Crypto)?;
    hkdf.expand(b"mediflow.recovery.verifier.v1", verifier.as_mut())
        .map_err(|_| RuntimeError::Crypto)?;
    Ok((kek, verifier))
}

pub(crate) fn passphrase_bundle(
    passphrase: &str,
    username: &str,
    wrap: impl FnOnce(&MasterKey, &MasterKey) -> Result<(String, String)>,
) -> Result<PassphraseBundle> {
    let salt = random_salt()?;
    let material = derive_v3(passphrase, &salt)?;
    let mut entropy = Zeroizing::new([0u8; 20]);
    getrandom::fill(entropy.as_mut()).map_err(|_| RuntimeError::Crypto)?;
    let recovery_key = format_recovery_key(&entropy);
    let recovery_salt = random_salt()?;
    let (kek, verifier) = recovery_material(entropy.as_ref(), &recovery_salt)?;
    let (encrypted, recovery_wrapping) = wrap(&material.kek, &kek)?;
    let credentials = Zeroizing::new(serde_json::json!({
        "encryptedMasterKey": encrypted, "salt": salt, "verifier": &*material.verifier,
        "recovery": {"wrappedMasterKey": recovery_wrapping, "salt": recovery_salt, "verifier": BASE64.encode(verifier.as_ref())}
    }).to_string());
    let kit = Zeroizing::new(
        serde_json::json!({
            "schemaVersion": "mediflow.recovery-kit.v1", "username": username,
            "wrappedMasterKey": recovery_wrapping, "salt": recovery_salt
        })
        .to_string(),
    );
    Ok(PassphraseBundle {
        credentials,
        kit,
        recovery_key,
    })
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
    if value.starts_with("ENC2:") {
        return open_file(value, master);
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

pub(crate) fn is_ciphertext(value: &str) -> bool {
    value.starts_with("ENC:") || value.starts_with("ENC2:")
}

fn open_file(value: &str, master: &MasterKey) -> Result<Value> {
    let parts: Vec<&str> = value.split(':').collect();
    if parts.len() != 5 || parts[0] != "ENC2" {
        return Err(RuntimeError::Crypto);
    }
    let decode = |value: &str| -> Result<Vec<u8>> {
        let bytes = BASE64.decode(value).map_err(|_| RuntimeError::Crypto)?;
        if BASE64.encode(&bytes) != value {
            return Err(RuntimeError::Crypto);
        }
        Ok(bytes)
    };
    let wrap_iv = decode(parts[1])?;
    let wrapped = decode(parts[2])?;
    let iv = decode(parts[3])?;
    let data = decode(parts[4])?;
    if wrap_iv.len() != 12 || wrapped.len() != 48 || iv.len() != 12 || data.len() < 17 {
        return Err(RuntimeError::Crypto);
    }
    let wrapping = Aes256Gcm::new_from_slice(master.as_ref()).map_err(|_| RuntimeError::Crypto)?;
    let key = Zeroizing::new(
        wrapping
            .decrypt(
                Nonce::from_slice(&wrap_iv),
                Payload {
                    msg: &wrapped,
                    aad: b"mediflow.attachment.file-key.v2",
                },
            )
            .map_err(|_| RuntimeError::Crypto)?,
    );
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| RuntimeError::Crypto)?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&iv),
                Payload {
                    msg: &data,
                    aad: b"mediflow.attachment.data.v2",
                },
            )
            .map_err(|_| RuntimeError::Crypto)?,
    );
    Ok(Value::String(format!(
        "data:application/pdf;base64,{}",
        BASE64.encode(&plaintext)
    )))
}

/// Legacy plaintext is displayable; ENC data must authenticate and JSON-decode.
/// Structured fields are rendered as JSON, never silently treated as empty.
pub(crate) fn display_field(value: &Value, master: &MasterKey, structured: bool) -> Result<Value> {
    let decoded = match value {
        Value::Null => return Ok(Value::Null),
        Value::String(text) if is_ciphertext(text) => open(text, master)?,
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
    fn attachment_file_shared_vector_and_false_wrapping() {
        let vector: Value = serde_json::from_str(include_str!(
            "../../../../native/contracts/attachment-file-golden.v2.json"
        ))
        .unwrap();
        let master = Zeroizing::new(
            BASE64
                .decode(vector["masterKey"].as_str().unwrap())
                .unwrap()
                .try_into()
                .unwrap(),
        );
        let data = vector["data"].as_str().unwrap();
        let expected = Value::String(format!(
            "data:application/pdf;base64,{}",
            vector["original"].as_str().unwrap()
        ));
        assert_eq!(open(data, &master).unwrap(), expected);
        assert_eq!(
            display_field(&Value::String(data.into()), &master, false).unwrap(),
            expected
        );
        assert!(open(data, &Zeroizing::new([0; 32])).is_err());
        for index in 1..=4 {
            let mut parts: Vec<String> = data.split(':').map(str::to_string).collect();
            let mut bytes = BASE64.decode(&parts[index]).unwrap();
            bytes[0] ^= 1;
            parts[index] = BASE64.encode(bytes);
            assert!(open(&parts.join(":"), &master).is_err());
        }
    }
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

const RECOVERY_LIMIT: usize = 512 * 1024 * 1024;
fn valid_database(bytes: &[u8]) -> bool {
    (100..=RECOVERY_LIMIT).contains(&bytes.len()) && bytes.starts_with(b"SQLite format 3\0")
}
pub(crate) fn seal_recovery(database: &[u8], master: &MasterKey) -> Result<Zeroizing<Vec<u8>>> {
    let mut header = [0u8; 80];
    header[..8].copy_from_slice(b"MDFREC01");
    getrandom::fill(&mut header[8..20]).map_err(|_| RuntimeError::Crypto)?;
    getrandom::fill(&mut header[68..80]).map_err(|_| RuntimeError::Crypto)?;
    let mut key = Zeroizing::new([0u8; 32]);
    getrandom::fill(key.as_mut()).map_err(|_| RuntimeError::Crypto)?;
    seal_recovery_with(database, master, header, &key)
}
fn seal_recovery_with(
    database: &[u8],
    master: &MasterKey,
    mut header: [u8; 80],
    key: &MasterKey,
) -> Result<Zeroizing<Vec<u8>>> {
    if !valid_database(database) {
        return Err(RuntimeError::InvalidResponse);
    }
    let wrapping = Aes256Gcm::new_from_slice(master.as_ref()).map_err(|_| RuntimeError::Crypto)?;
    let wrapped = wrapping
        .encrypt(
            Nonce::from_slice(&header[8..20]),
            Payload {
                msg: key.as_ref(),
                aad: b"mediflow.recovery-backup.key.v1",
            },
        )
        .map_err(|_| RuntimeError::Crypto)?;
    header[20..68].copy_from_slice(&wrapped);
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| RuntimeError::Crypto)?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&header[68..80]),
            Payload {
                msg: database,
                aad: &header,
            },
        )
        .map_err(|_| RuntimeError::Crypto)?;
    let mut bytes = Zeroizing::new(header.to_vec());
    bytes.extend(ciphertext);
    Ok(bytes)
}
pub(crate) fn verify_recovery(artifact: &[u8], master: &MasterKey) -> Result<()> {
    if !(196..=RECOVERY_LIMIT + 96).contains(&artifact.len()) || !artifact.starts_with(b"MDFREC01")
    {
        return Err(RuntimeError::InvalidInput);
    }
    let wrapping = Aes256Gcm::new_from_slice(master.as_ref()).map_err(|_| RuntimeError::Crypto)?;
    let key = Zeroizing::new(
        wrapping
            .decrypt(
                Nonce::from_slice(&artifact[8..20]),
                Payload {
                    msg: &artifact[20..68],
                    aad: b"mediflow.recovery-backup.key.v1",
                },
            )
            .map_err(|_| RuntimeError::Crypto)?,
    );
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| RuntimeError::Crypto)?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&artifact[68..80]),
                Payload {
                    msg: &artifact[80..],
                    aad: &artifact[..80],
                },
            )
            .map_err(|_| RuntimeError::Crypto)?,
    );
    if !valid_database(&plaintext) {
        return Err(RuntimeError::Crypto);
    }
    Ok(())
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    #[test]
    fn recovery_envelope_matches_web_golden_and_authenticates_both_tags() {
        let golden: Value = serde_json::from_str(include_str!(
            "../../../../native/contracts/recovery-backup-golden.v1.json"
        ))
        .unwrap();
        let decode = |key: &str| BASE64.decode(golden[key].as_str().unwrap()).unwrap();
        let master = Zeroizing::new(decode("masterKey").try_into().unwrap());
        let key = Zeroizing::new(decode("dataKey").try_into().unwrap());
        let database = decode("database");
        let artifact = decode("artifact");
        let header = artifact[..80].try_into().unwrap();
        assert_eq!(
            &*seal_recovery_with(&database, &master, header, &key).unwrap(),
            &artifact
        );
        verify_recovery(&artifact, &master).unwrap();
        for index in [0, 8, 20, 67, 68, 79, 80, artifact.len() - 1] {
            let mut invalid = artifact.clone();
            invalid[index] ^= 1;
            assert!(verify_recovery(&invalid, &master).is_err());
        }
        assert!(verify_recovery(&artifact[..artifact.len() - 1], &master).is_err());
        assert!(verify_recovery(&artifact, &Zeroizing::new([1u8; 32])).is_err());
    }
}

#[cfg(test)]
mod credential_rotation_tests {
    use super::*;
    #[test]
    fn recovery_material_key_and_wrapping_match_independent_node_vector() {
        let value: Value = serde_json::from_str(include_str!(
            "../../comparison/recovery-wrapping-vector.json"
        ))
        .unwrap();
        let decode = |key: &str| BASE64.decode(value[key].as_str().unwrap()).unwrap();
        let entropy: [u8; 20] = decode("entropy").try_into().unwrap();
        assert_eq!(*format_recovery_key(&entropy), value["recoveryKey"]);
        let (kek, verifier) = recovery_material(&entropy, value["salt"].as_str().unwrap()).unwrap();
        assert_eq!(BASE64.encode(kek.as_ref()), value["kek"]);
        assert_eq!(BASE64.encode(verifier.as_ref()), value["verifier"]);
        let master = Zeroizing::new(decode("masterKey").try_into().unwrap());
        let iv = decode("iv").try_into().unwrap();
        assert_eq!(
            wrap_key_with_iv(&master, &kek, "r1:", &iv).unwrap(),
            value["wrapping"]
        );
    }
}
