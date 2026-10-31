use super::*;
use zeroize::Zeroize;

pub const PATIENT_DOCUMENT_MAX_BYTES: usize = 10 * 1024 * 1024;
const STAGE_JSON_LIMIT: usize = 28 * 1024 * 1024;
const PATH: &[&str] = &["api", "auth", "native", "patient-document"];

pub struct PatientDocumentStage {
    pub command_id: String,
    pub view_id: String,
    pub text: Zeroizing<String>,
    pub extraction: Zeroizing<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PatientDocumentOperation {
    Receipt,
    Revoke,
}

pub struct PatientDocumentReadback {
    pub resolution: ChatWriteResolution,
    pub attachment_opened: bool,
}
impl PatientDocumentReadback {
    pub fn complete(&self) -> bool {
        self.resolution == ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied)
            && self.attachment_opened
    }
    pub fn may_forget(&self) -> bool {
        self.complete()
            || self.resolution == ChatWriteResolution::Confirmed(ChatWriteOutcome::Retired)
    }
}

struct PrivateJson(Value);
impl Drop for PrivateJson {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}
fn wipe(value: &mut Value) {
    match value {
        Value::String(text) => text.zeroize(),
        Value::Array(items) => {
            for item in items {
                wipe(item);
            }
        }
        Value::Object(items) => {
            for item in items.values_mut() {
                wipe(item);
            }
        }
        Value::Number(_) => *value = Value::Null,
        _ => {}
    }
}
fn uuid(value: &str) -> Result<()> {
    if value.len() == 36
        && value.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
    {
        Ok(())
    } else {
        Err(RuntimeError::InvalidResponse)
    }
}

impl RuntimeSession {
    pub fn patient_document_session(&self, scope: &str) -> Result<Self> {
        self.ensure_open()?;
        validate_scope_id(scope)?;
        if self.user().role != "admin" {
            return Err(RuntimeError::Forbidden);
        }
        Ok(Self {
            inner: self.inner.clone(),
            context: self.context.child(),
        })
    }
    pub fn patient_document_stage(
        &self,
        scope: &str,
        name: &str,
        bytes: &[u8],
    ) -> Result<PatientDocumentStage> {
        if bytes.len() > PATIENT_DOCUMENT_MAX_BYTES {
            return Err(RuntimeError::TooLarge);
        }
        if !bytes.starts_with(b"%PDF-") || name.trim().is_empty() || name.len() > 1024 {
            return Err(RuntimeError::InvalidInput);
        }
        let _guard = self.begin_write()?;
        #[derive(serde::Serialize)]
        struct Source<'a> {
            name: String,
            path: String,
            data: String,
            #[serde(rename = "fileKey")]
            file_key: &'a [u8],
            original: &'a str,
        }
        #[derive(serde::Serialize)]
        struct Stage<'a> {
            operation: &'a str,
            source: Source<'a>,
        }
        let (data, key, sealed_name, sealed_path) = {
            let secrets = self
                .inner
                .secrets
                .lock()
                .map_err(|_| RuntimeError::Locked)?;
            let master = secrets.master.as_ref().ok_or(RuntimeError::Locked)?;
            let (data, key) = crypto::seal_patient_document(bytes, master)?;
            (
                data,
                key,
                crypto::seal(&json!(name), master)?,
                crypto::seal(&json!(name), master)?,
            )
        };
        let original = Zeroizing::new(BASE64.encode(bytes));
        let body = Stage {
            operation: "stage",
            source: Source {
                name: sealed_name,
                path: sealed_path,
                data,
                file_key: key.as_slice(),
                original: &original,
            },
        };
        let mut result = PrivateJson(self.request_serializable(
            Method::POST,
            PATH,
            &[],
            Some(scope),
            Some(&body),
            true,
            crate::http::JsonLimits {
                request: STAGE_JSON_LIMIT,
                response: JSON_LIMIT,
            },
            None,
        )?);
        let r = &mut result.0;
        if r["identity"] != "ambiguous"
            || r["quality"] != "uncertain"
            || r["candidates"] != json!({})
        {
            return Err(RuntimeError::InvalidResponse);
        }
        let command_id = r["commandId"]
            .as_str()
            .ok_or(RuntimeError::InvalidResponse)?
            .to_owned();
        let view_id = r["viewId"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 256)
            .ok_or(RuntimeError::InvalidResponse)?
            .to_owned();
        uuid(&command_id)?;
        let text = r["text"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or(RuntimeError::InvalidResponse)?
            .to_owned();
        use sha2::{Digest, Sha256};
        let extraction = &r["extraction"];
        if extraction["parser"] != "anydoc-local"
            || extraction["outcome"] != "extracted"
            || extraction["sourceByteLength"].as_u64() != Some(bytes.len() as u64)
            || extraction["sourceSha256"] != format!("{:x}", Sha256::digest(bytes))
        {
            return Err(RuntimeError::InvalidResponse);
        }
        let extraction = if extraction["ocrProvenance"].is_object() {
            "Estrazione locale AnyDoc con OCR locale"
        } else {
            "Estrazione locale AnyDoc da PDF testuale"
        }
        .to_owned();
        self.ensure_open()?;
        Ok(PatientDocumentStage {
            command_id,
            view_id,
            text: Zeroizing::new(text),
            extraction: Zeroizing::new(extraction),
        })
    }
    pub fn patient_document_preview(
        &self,
        scope: &str,
        stage: &PatientDocumentStage,
        fields: &[Zeroizing<String>; 4],
        separate: bool,
    ) -> Result<()> {
        uuid(&stage.command_id)?;
        if fields[..3].iter().any(|s| s.trim().is_empty())
            || fields
                .iter()
                .any(|s| s.len() > 256 || s.chars().any(char::is_control))
        {
            return Err(RuntimeError::InvalidInput);
        }
        let mut review = json!({ "firstName":{"action":"correct", "value":fields[0].trim()}, "lastName":{"action":"correct", "value":fields[1].trim()}, "taxCode":{"action":"correct", "value":fields[2].trim()}, "duplicate": if separate { "create-separate" } else { "none" } });
        if !fields[3].trim().is_empty() {
            review["birthDate"] = json!({"action":"correct", "value":fields[3].trim()});
        }
        let body = PrivateJson(
            json!({"operation":"preview", "commandId":stage.command_id,"viewId":stage.view_id,"review":review}),
        );
        let result = self.request(
            Method::POST,
            PATH,
            &[],
            Some(scope),
            Some(&body.0),
            true,
            JSON_LIMIT,
        )?;
        if result != json!({"commandId":stage.command_id,"status":"preview"}) {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(())
    }
    pub fn patient_document_execute(
        &self,
        scope: &str,
        command_id: &str,
        pin: &str,
        expected: &[u8],
    ) -> Result<PatientDocumentReadback> {
        uuid(command_id)?;
        if !(4..=8).contains(&pin.len()) || !pin.bytes().all(|b| b.is_ascii_digit()) {
            return Err(RuntimeError::InvalidInput);
        }
        let _guard = self.begin_write()?;
        let body = PrivateJson(json!({"operation":"execute", "commandId":command_id,"pin":pin}));
        let receipt = self.request(
            Method::POST,
            PATH,
            &[],
            Some(scope),
            Some(&body.0),
            true,
            JSON_LIMIT,
        )?;
        drop(_guard);
        self.patient_document_open_receipt(scope, receipt, Some(expected))
    }
    pub fn patient_document_recover(
        &self,
        scope: &str,
        command_id: &str,
        operation: PatientDocumentOperation,
    ) -> Result<PatientDocumentReadback> {
        uuid(command_id)?;
        let recovery = Self {
            inner: self.inner.clone(),
            context: self.inner.account_context.child(),
        };
        let receipt = recovery.request(Method::POST, PATH, &[], Some(scope), Some(&json!({"operation": match operation { PatientDocumentOperation::Receipt => "receipt", PatientDocumentOperation::Revoke => "revoke" },"commandId":command_id})), true, JSON_LIMIT)?;
        recovery.patient_document_open_receipt(scope, receipt, None)
    }
    fn patient_document_open_receipt(
        &self,
        scope: &str,
        receipt: Value,
        expected: Option<&[u8]>,
    ) -> Result<PatientDocumentReadback> {
        let object = receipt.as_object().ok_or(RuntimeError::InvalidResponse)?;
        let resolution = match receipt["outcome"].as_str() {
            Some("unknown") if object.len() == 1 => ChatWriteResolution::Uncertain,
            Some("retired") if object.len() == 1 => {
                ChatWriteResolution::Confirmed(ChatWriteOutcome::Retired)
            }
            Some("applied")
                if object.len() == 4
                    && receipt["attachmentReadback"] == "client-verification-required" =>
            {
                ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied)
            }
            _ => return Err(RuntimeError::InvalidResponse),
        };
        let mut result = PatientDocumentReadback {
            resolution,
            attachment_opened: false,
        };
        if resolution == ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied) {
            let patient = receipt["patientId"]
                .as_str()
                .ok_or(RuntimeError::InvalidResponse)?;
            let attachment = receipt["attachmentId"]
                .as_str()
                .ok_or(RuntimeError::InvalidResponse)?;
            uuid(patient)?;
            uuid(attachment)?;
            result.attachment_opened =
                self.read_attachment(scope, patient, attachment)
                    .is_ok_and(|mut row| {
                        let data = Zeroizing::new(row.data.take().unwrap_or_default());
                        row.name.zeroize();
                        row.path.zeroize();
                        if row.mime_type != "application/pdf" || !row.locked_fields.is_empty() {
                            return false;
                        }
                        let Some(encoded) = data.strip_prefix("data:application/pdf;base64,")
                        else {
                            return false;
                        };
                        let Ok(bytes) = BASE64.decode(encoded).map(Zeroizing::new) else {
                            return false;
                        };
                        bytes.starts_with(b"%PDF-")
                            && bytes.len() as u64 == row.size
                            && expected.is_none_or(|original| original == bytes.as_slice())
                    });
            self.ensure_open()?;
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn applied_needs_attachment_opening_and_unknown_never_completes() {
        for resolution in [
            ChatWriteResolution::Uncertain,
            ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied),
            ChatWriteResolution::Confirmed(ChatWriteOutcome::Retired),
        ] {
            let result = PatientDocumentReadback {
                resolution,
                attachment_opened: false,
            };
            assert!(!result.complete());
            assert_eq!(
                result.may_forget(),
                resolution == ChatWriteResolution::Confirmed(ChatWriteOutcome::Retired)
            );
        }
        assert!(
            PatientDocumentReadback {
                resolution: ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied),
                attachment_opened: true
            }
            .complete()
        );
    }
    #[test]
    fn stage_rejects_non_pdf_and_oversize_before_transport() {
        let session = super::super::tests::session_at("http://127.0.0.1:9");
        assert!(matches!(
            session.patient_document_stage("scope-a", "a.pdf", b"text"),
            Err(RuntimeError::InvalidInput)
        ));
        let bytes = vec![0; PATIENT_DOCUMENT_MAX_BYTES + 1];
        assert!(matches!(
            session.patient_document_stage("scope-a", "a.pdf", &bytes),
            Err(RuntimeError::TooLarge)
        ));
    }
    #[test]
    fn private_json_clears_owned_text_and_key() {
        let mut value =
            json!({"original":"synthetic", "key":[1,2,3], "review":{"value":"synthetic"}});
        wipe(&mut value);
        assert_eq!(
            value,
            json!({"original":"", "key":[null,null,null], "review":{"value":""}})
        );
    }
}

#[cfg(test)]
mod readback_tests {
    use super::*;
    use std::{
        io::Write,
        net::TcpListener,
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
    };
    const PATIENT: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ATTACHMENT: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    #[test]
    fn durable_receipt_really_reads_and_opens_exact_attachment_and_retains_unreadable() {
        for (execute, corrupt, mismatch) in [
            (false, false, false),
            (false, true, false),
            (true, false, false),
            (true, false, true),
        ] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let session = super::super::tests::session_at(&format!(
                "http://{}",
                listener.local_addr().unwrap()
            ));
            session
                .inner
                .scopes
                .lock()
                .unwrap()
                .insert("scope-a".into());
            let bytes = b"%PDF-1.7 synthetic";
            let (mut envelope, _) =
                crypto::seal_patient_document(bytes, &Zeroizing::new([7; 32])).unwrap();
            if corrupt {
                let mut parts: Vec<_> = envelope.split(':').map(str::to_owned).collect();
                parts[2] = BASE64.encode([0; 48]);
                envelope = parts.join(":");
            }
            let count = Arc::new(AtomicUsize::new(0));
            let observed = count.clone();
            let worker = std::thread::spawn(move || {
                for index in 0..4 {
                    let (mut stream, _) = crate::test_loopback::accept(&listener).unwrap();
                    let request = super::super::tests::read_request(&mut stream);
                    observed.fetch_add(1, Ordering::SeqCst);
                    let body=if index%2==0 {
                        assert!(request.starts_with("GET /api/v1/network/identity "));
                        json!({"scope":{"effectiveAmbulatoryId":"scope-a","requestBinding":"expected-ambulatory-id-v1"},"operator":{"userId":"synthetic-user","authChannel":"native"}})
                    } else if index==1 {
                        assert!(request.starts_with("POST /api/auth/native/patient-document "));
                        assert!(request.contains(if execute { "\"operation\":\"execute\"" } else { "\"operation\":\"receipt\"" }));
                        json!({"outcome":"applied","patientId":PATIENT,"attachmentId":ATTACHMENT,"attachmentReadback":"client-verification-required"})
                    } else {
                        assert!(request.starts_with(&format!("GET /api/v1/network/patients/{PATIENT}/attachments/{ATTACHMENT} ")));
                        json!({"id":ATTACHMENT,"patientId":PATIENT,"name":"sintetico.pdf","path":"sintetico.pdf","type":"application/pdf","size":bytes.len(),"data":envelope})
                    }.to_string();
                    write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
                }
            });
            let result = if execute {
                session
                    .patient_document_execute(
                        "scope-a",
                        PATIENT,
                        "2468",
                        if mismatch { b"different PDF" } else { bytes },
                    )
                    .unwrap()
            } else {
                session
                    .patient_document_recover("scope-a", PATIENT, PatientDocumentOperation::Receipt)
                    .unwrap()
            };
            assert_eq!(
                result.resolution,
                ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied)
            );
            assert_eq!(
                count.load(Ordering::SeqCst),
                4,
                "receipt must actually read the exact attachment"
            );
            assert_eq!(result.complete(), !corrupt && !mismatch);
            assert_eq!(result.may_forget(), !corrupt && !mismatch);
            worker.join().unwrap();
        }
    }
}

#[cfg(test)]
mod stage_tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::{io::Write, net::TcpListener};
    #[test]
    fn stage_sends_wrapped_pdf_and_explicit_file_key_but_never_master_or_plain_name() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let session =
            super::super::tests::session_at(&format!("http://{}", listener.local_addr().unwrap()));
        session
            .inner
            .scopes
            .lock()
            .unwrap()
            .insert("scope-a".into());
        let bytes = b"%PDF-1.7 synthetic source";
        let worker = std::thread::spawn(move || {
            for index in 0..2 {
                let (mut stream, _) = crate::test_loopback::accept(&listener).unwrap();
                let request = super::super::tests::read_request(&mut stream);
                let response=if index==0 {
                    json!({"scope":{"effectiveAmbulatoryId":"scope-a","requestBinding":"expected-ambulatory-id-v1"},"operator":{"userId":"synthetic-user","authChannel":"native"}})
                } else {
                    assert!(request.starts_with("POST /api/auth/native/patient-document "));
                    assert!(!request.contains("inventato.pdf"));
                    let body:Value=serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
                    assert_eq!(body["operation"],"stage");
                    assert_eq!(body["source"].as_object().unwrap().len(),5);
                    let raw_key:Vec<u8>=serde_json::from_value(body["source"]["fileKey"].clone()).unwrap();
                    assert_eq!(raw_key.len(),32);assert_ne!(raw_key,vec![7;32]);
                    assert_eq!(crypto::open(body["source"]["data"].as_str().unwrap(),&Zeroizing::new([7;32])).unwrap(),json!(format!("data:application/pdf;base64,{}",BASE64.encode(bytes))));
                    assert_eq!(body["source"]["original"],BASE64.encode(bytes));
                    json!({"commandId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","viewId":"synthetic-view","identity":"ambiguous","quality":"uncertain","candidates":{},"text":"Fonte inventata", "extraction":{"parser":"anydoc-local","outcome":"extracted","sourceSha256":format!("{:x}",Sha256::digest(bytes)),"sourceByteLength":bytes.len()}})
                }.to_string();
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();
            }
        });
        let stage = session
            .patient_document_stage("scope-a", "inventato.pdf", bytes)
            .unwrap();
        assert_eq!(stage.text.as_str(), "Fonte inventata");
        assert!(stage.extraction.contains("locale"));
        worker.join().unwrap();
    }
}
