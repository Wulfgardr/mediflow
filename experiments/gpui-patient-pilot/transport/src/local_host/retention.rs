use super::*;

/// Conservazione dei dati sanitari (ADR 0178): stesso endpoint e stessi comandi del Web.
pub const RETENTION_HOLD_REASONS: [(&str, &str); 4] = [
    ("litigation", "Contenzioso"),
    ("access_request", "Richiesta dell’interessato o di accesso"),
    ("inspection", "Ispezione o richiesta di un’autorità"),
    ("other", "Altro motivo documentato"),
];

/// Messaggio per un codice di rifiuto del server, come nel pannello Web.
pub fn retention_refusal_message(code: &str) -> &'static str {
    match code {
        "below_minimum" => "La finestra è più breve del minimo del profilo attivo.",
        "conflict" => "I dati sono cambiati nel frattempo. Rileggi e riprova.",
        "legal_hold" => "Il fascicolo è sospeso da un blocco.",
        "not_expired" => "Il fascicolo non risulta più scaduto.",
        "expiry_changed" => "La scadenza è cambiata. Rileggi e verifica di nuovo.",
        "not_found" => "Paziente o documento non trovato.",
        "configuration_error" => "Lo stato della conservazione non è leggibile.",
        _ => "Operazione non riuscita. Rileggi lo stato prima di riprovare.",
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum RetentionOutcome {
    Done(Value),
    Refused(String),
}

fn valid_overview(value: &Value) -> bool {
    match value["status"].as_str() {
        Some("configuration_error") => value["evaluatedAt"].is_u64(),
        Some("ready") => {
            value["windowsRevision"].is_u64()
                && value["holdsRevision"].is_u64()
                && value["windows"].is_object()
                && value["holds"].as_array().is_some_and(|holds| {
                    holds.iter().all(|h| {
                        h["id"].is_string() && h["patientId"].is_string() && h["reason"].is_string()
                    })
                })
                && value["profile"]["terms"].is_object()
                && value["profile"]["label"].is_string()
                && value["sources"].is_array()
                && value["counts"].is_object()
                && value["review"].as_array().is_some_and(|items| {
                    items.iter().all(|i| {
                        i["patientId"].is_string()
                            && i["version"].is_u64()
                            && i["status"].is_string()
                    })
                })
        }
        _ => false,
    }
}

/// Un comando legato alla revisione che chi decide ha visto.
pub struct PreparedRetentionCommand {
    owner: Weak<()>,
    method: Method,
    body: Value,
    summary: String,
    destructive: bool,
    submitted: AtomicBool,
}
impl PreparedRetentionCommand {
    pub fn summary(&self) -> &str {
        &self.summary
    }
    pub fn destructive(&self) -> bool {
        self.destructive
    }
    pub fn body(&self) -> &Value {
        &self.body
    }
}

fn windows_body(overview: &Value, windows: Value) -> Result<Value> {
    let revision = overview["windowsRevision"]
        .as_u64()
        .ok_or(RuntimeError::InvalidInput)?;
    if !windows.is_object() {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(json!({"confirmed":true,"expectedRevision":revision,"windows":windows}))
}
fn hold_body(
    overview: &Value,
    patient_id: &str,
    attachment_id: Option<&str>,
    reason: &str,
) -> Result<Value> {
    let revision = overview["holdsRevision"]
        .as_u64()
        .ok_or(RuntimeError::InvalidInput)?;
    let patient_id = patient_id.trim();
    let attachment_id = attachment_id.map(str::trim).filter(|id| !id.is_empty());
    if patient_id.is_empty()
        || patient_id.len() > 200
        || attachment_id.is_some_and(|id| id.len() > 200)
        || !RETENTION_HOLD_REASONS
            .iter()
            .any(|(code, _)| *code == reason)
    {
        return Err(RuntimeError::InvalidInput);
    }
    let mut body = json!({"action":"hold.place","confirmed":true,"expectedRevision":revision,"patientId":patient_id,"reason":reason});
    if let Some(id) = attachment_id {
        body["attachmentId"] = json!(id);
    }
    Ok(body)
}
fn release_body(overview: &Value, hold_id: &str) -> Result<Value> {
    let revision = overview["holdsRevision"]
        .as_u64()
        .ok_or(RuntimeError::InvalidInput)?;
    if !overview["holds"]
        .as_array()
        .is_some_and(|holds| holds.iter().any(|h| h["id"] == hold_id))
    {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(
        json!({"action":"hold.release","confirmed":true,"expectedRevision":revision,"holdId":hold_id}),
    )
}
fn discard_body(overview: &Value, patient_id: &str) -> Result<Value> {
    let item = overview["review"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|i| i["patientId"] == patient_id && i["status"] == "expired")
        })
        .ok_or(RuntimeError::InvalidInput)?;
    let (Some(version), Some(expires_at)) = (item["version"].as_u64(), item["expiresAt"].as_u64())
    else {
        return Err(RuntimeError::InvalidInput);
    };
    Ok(
        json!({"action":"discard","confirmed":true,"patientId":patient_id,"expectedVersion":version,"expectedExpiresAt":expires_at}),
    )
}

impl LocalHostAccess {
    fn retention_raw(
        &self,
        method: Method,
        body: Option<&Value>,
        mutation: bool,
    ) -> Result<(u16, Value)> {
        let raw = self.client.dedicated_web_raw(
            method,
            &["api", "system", "retention"],
            self.headers()?,
            body,
            mutation,
        )?;
        let value = serde_json::from_slice(&raw.body).map_err(|_| {
            if mutation {
                RuntimeError::Indeterminate
            } else {
                RuntimeError::InvalidResponse
            }
        })?;
        Ok((raw.status, value))
    }
    pub fn read_retention(&self) -> Result<Value> {
        let (status, value) = self.retention_raw(Method::GET, None, false)?;
        if status != 200 || !valid_overview(&value) {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(value)
    }
    fn prepared(
        &self,
        method: Method,
        body: Value,
        summary: String,
        destructive: bool,
    ) -> Result<PreparedRetentionCommand> {
        self.headers()?;
        Ok(PreparedRetentionCommand {
            owner: Arc::downgrade(&self.owner),
            method,
            body,
            summary,
            destructive,
            submitted: AtomicBool::new(false),
        })
    }
    /// `windows`: per categoria `{"kind":"years","years":n}` o `{"kind":"unlimited"}`.
    pub fn prepare_retention_windows(
        &self,
        overview: &Value,
        windows: Value,
    ) -> Result<PreparedRetentionCommand> {
        self.prepared(
            Method::PUT,
            windows_body(overview, windows)?,
            "Salvare le finestre di conservazione? Si applicano a tutti i fascicoli chiusi e possono solo allungare il minimo del profilo.".into(),
            false,
        )
    }
    pub fn prepare_retention_hold(
        &self,
        overview: &Value,
        patient_id: &str,
        attachment_id: Option<&str>,
        reason: &str,
        label: &str,
    ) -> Result<PreparedRetentionCommand> {
        let body = hold_body(overview, patient_id, attachment_id, reason)?;
        let scope = if body["attachmentId"].is_string() {
            "sul documento"
        } else {
            "sul fascicolo"
        };
        self.prepared(Method::POST, body, format!("Registrare un blocco {scope} di {label}? Scarto e cancellazione si fermano finché non lo revochi."), false)
    }
    pub fn prepare_retention_release(
        &self,
        overview: &Value,
        hold_id: &str,
        label: &str,
    ) -> Result<PreparedRetentionCommand> {
        self.prepared(
            Method::POST,
            release_body(overview, hold_id)?,
            format!("Revocare il blocco di {label}? Senza blocco, il fascicolo torna nell’elenco da rivedere se la conservazione è scaduta."),
            false,
        )
    }
    /// Scarto definitivo di un fascicolo scaduto, legato a versione e scadenza viste nella revisione.
    pub fn prepare_retention_discard(
        &self,
        overview: &Value,
        patient_id: &str,
        label: &str,
    ) -> Result<PreparedRetentionCommand> {
        self.prepared(
            Method::POST,
            discard_body(overview, patient_id)?,
            format!("Scartare definitivamente il fascicolo di {label}? Dati clinici e documenti vengono cancellati; resta solo la registrazione dello scarto nell’audit."),
            true,
        )
    }
    pub fn apply_retention_command(
        &self,
        command: &PreparedRetentionCommand,
    ) -> Result<RetentionOutcome> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let (status, value) =
            self.retention_raw(command.method.clone(), Some(&command.body), true)?;
        match status {
            200 => Ok(RetentionOutcome::Done(value)),
            400 | 404 | 409 => Ok(RetentionOutcome::Refused(
                retention_refusal_message(value["code"].as_str().unwrap_or_default()).to_owned(),
            )),
            _ => Err(RuntimeError::Indeterminate),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overview_shape_and_refusal_copy() {
        let ready = json!({"status":"ready","evaluatedAt":1,"windowsRevision":0,"holdsRevision":2,"windows":{},
            "holds":[{"id":"h1","patientId":"p1","reason":"litigation"}],"profile":{"label":"Lombardia","terms":{}},
            "sources":[],"counts":{},"review":[{"patientId":"p1","version":3,"status":"held"}]});
        assert!(valid_overview(&ready));
        assert!(valid_overview(
            &json!({"status":"configuration_error","evaluatedAt":1})
        ));
        let mut broken = ready.clone();
        broken["review"][0]["version"] = json!("3");
        assert!(!valid_overview(&broken));
        assert_eq!(
            retention_refusal_message("legal_hold"),
            "Il fascicolo è sospeso da un blocco."
        );
        assert!(retention_refusal_message("unknown").starts_with("Operazione non riuscita"));
    }

    /// I corpi che GPUI invia, nella sequenza che `lib/retention-gpui-contract.test.ts` fa passare per la route reale.
    #[test]
    fn command_bodies_match_the_contract_fixtures() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/retention");
        let check = |name: &str, body: Value| {
            let file = format!("{dir}/{name}.json");
            let text = format!("{}\n", serde_json::to_string_pretty(&body).unwrap());
            if std::env::var_os("MEDIFLOW_WRITE_FIXTURES").is_some() {
                std::fs::write(&file, &text).unwrap();
            }
            let expected: Value =
                serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
            assert_eq!(expected, body, "{name}");
        };
        // Stato iniziale dell'archivio del test JS: nessun profilo, revisioni a zero.
        let initial = json!({"windowsRevision":0,"holdsRevision":0,"holds":[],"review":[]});
        check(
            "windows",
            windows_body(
                &initial,
                json!({"ambulatory_record":{"kind":"years","years":10}}),
            )
            .unwrap(),
        );
        check(
            "hold-place",
            hold_body(&initial, " retention-expired ", None, "litigation").unwrap(),
        );
        // Dopo le finestre e il blocco: il fascicolo scaduto (chiuso il 1/3/2012, dieci anni) e il blocco registrato.
        let held = json!({"windowsRevision":1,"holdsRevision":1,
            "holds":[{"id":"HOLD-ID","patientId":"retention-expired","reason":"litigation"}],
            "review":[{"patientId":"retention-expired","version":1,"status":"expired","expiresAt":1646092800}]});
        check("hold-release", release_body(&held, "HOLD-ID").unwrap());
        check("discard", discard_body(&held, "retention-expired").unwrap());
        assert!(
            discard_body(
                &json!({"review":[{"patientId":"p","version":1,"status":"held","expiresAt":1}]}),
                "p"
            )
            .is_err(),
            "a held record is never offered for discard"
        );
        assert!(hold_body(&initial, "p", None, "capriccio").is_err());
    }
}
