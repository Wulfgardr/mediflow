use super::*;
use crate::crypto;
use zeroize::Zeroize;

pub struct PreparedPassphraseChange {
    owner: Weak<()>,
    bundle: crypto::PassphraseBundle,
    current_verifier: Zeroizing<String>,
    previous_salt: String,
    submitted: AtomicBool,
}
impl PreparedPassphraseChange {
    pub fn recovery_kit(&self) -> &[u8] {
        self.bundle.kit.as_bytes()
    }
    pub fn recovery_key(&self) -> &str {
        &self.bundle.recovery_key
    }
}
impl LocalHostAccess {
    pub fn prepare_passphrase_change(
        &self,
        current: &str,
        new: &str,
        confirm: &str,
    ) -> Result<PreparedPassphraseChange> {
        self.headers()?;
        if crypto::normalize_passphrase(new)? != crypto::normalize_passphrase(confirm)? {
            return Err(RuntimeError::InvalidInput);
        }
        let checked = self.request(Method::GET, &["api", "auth", "check"], None, false)?;
        if checked["status"] != "ok"
            || checked["isSetup"] != true
            || checked["archiveGeneration"] != self.generation
            || checked["unlock"]["credential"] != "passphrase"
            || checked["unlock"]["kdfVersion"] != 3
        {
            return Err(RuntimeError::UnsupportedUnlock);
        }
        let material = crypto::derive_v3(
            current,
            checked["unlock"]["salt"]
                .as_str()
                .ok_or(RuntimeError::InvalidResponse)?,
        )?;
        let bundle = self.native.prepare_passphrase_bundle(new)?;
        self.headers()?;
        Ok(PreparedPassphraseChange {
            owner: Arc::downgrade(&self.owner),
            bundle,
            current_verifier: material.verifier,
            previous_salt: checked["unlock"]["salt"]
                .as_str()
                .ok_or(RuntimeError::InvalidResponse)?
                .to_owned(),
            submitted: AtomicBool::new(false),
        })
    }
    pub fn change_passphrase(&self, command: &PreparedPassphraseChange) -> Result<()> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let mut body: Value =
            serde_json::from_str(&command.bundle.credentials).map_err(|_| RuntimeError::Crypto)?;
        body["currentVerifier"] = Value::String(command.current_verifier.to_string());
        let result = self.request(
            Method::POST,
            &["api", "auth", "passphrase", "change"],
            Some(&body),
            true,
        );
        if let Some(value) = body.as_object_mut() {
            for field in ["currentVerifier", "verifier"] {
                if let Some(Value::String(secret)) = value.get_mut(field) {
                    secret.zeroize();
                }
            }
            if let Some(Value::String(secret)) = value
                .get_mut("recovery")
                .and_then(|v| v.get_mut("verifier"))
            {
                secret.zeroize();
            }
        }
        let verified = if matches!(&result, Ok(value) if value["success"] == true) {
            self.request(Method::GET, &["api", "auth", "check"], None, false)
                .is_ok_and(|checked| {
                    checked["status"] == "ok"
                        && checked["isSetup"] == true
                        && checked["archiveGeneration"] == self.generation
                        && checked["unlock"]["credential"] == "passphrase"
                        && checked["unlock"]["kdfVersion"] == 3
                        && checked["unlock"]["salt"] == body["salt"]
                        && checked["unlock"]["salt"] != command.previous_salt
                })
        } else {
            false
        };
        self.native.lock();
        match result {
            Ok(value) if value["success"] == true => {
                self.closed.store(true, Ordering::Release);
                self.retired.store(true, Ordering::Release);
                if let Ok(marker) = self.retirement_marker.lock()
                    && let Some(marker) = marker.as_ref()
                {
                    self.notice.confirm(marker);
                }
                if verified {
                    Ok(())
                } else {
                    Err(RuntimeError::Indeterminate)
                }
            }
            Ok(_) => Err(RuntimeError::Indeterminate),
            Err(error) => Err(error),
        }
    }
}
