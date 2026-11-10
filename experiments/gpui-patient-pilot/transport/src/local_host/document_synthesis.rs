//! Sintesi dei documenti (Document Synthesis, G-5b) tramite l'host locale.
//!
//! GPUI segue la stessa sequenza del Web (`createDocumentSynthesisReviewBrowserController`
//! e `createDocumentSynthesisBrowserOrchestrator`): selezione di paziente e
//! ambulatorio sulla sessione Web dell'host, cattura del documento, invio dei byte
//! già decifrati da GPUI all'estrazione locale dell'host, anteprima. Il server
//! resta l'autorità su kill switch, governo, currentness del documento,
//! estrazione, validazione, citazioni e ricevuta. Qui non esiste alcun percorso di
//! scrittura clinica: la selezione è uno stato della sessione, non della scheda.

use super::*;
use regex::Regex;
use std::sync::OnceLock;

pub const DOCUMENT_SYNTHESIS_SELECTION_PATH: &[&str] = &["api", "ai", "smart-import", "selection"];
pub const DOCUMENT_SYNTHESIS_CAPTURE_PATH: &[&str] =
    &["api", "ai", "document-synthesis", "capture"];
pub const DOCUMENT_SYNTHESIS_INGEST_PATH: &[&str] = &["api", "ai", "document-synthesis", "ingest"];
pub const DOCUMENT_SYNTHESIS_PREVIEW_PATH: &[&str] =
    &["api", "ai", "document-synthesis", "preview"];
pub const DOCUMENT_SYNTHESIS_CAPTURE_HEADER: &str = "x-mediflow-document-synthesis-capture";
/// Limite dell'host per i byte di un documento (`ATTACHMENT_EXTRACTION_MAX_SOURCE_BYTES`).
pub const DOCUMENT_SYNTHESIS_MAX_BYTES: usize = 25 * 1024 * 1024;
const WIRE_SCHEMA: &str = "mediflow.document-synthesis.preview-wire.v1";

fn capture_handle(value: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"^dsc_[0-9a-f]{32}$").is_match(value)
}
fn preview_handle(value: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"^dsp_[0-9a-f]{32}$").is_match(value)
}
fn sha256_hex(value: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"^[a-f0-9]{64}$").is_match(value)
}
fn reference(value: &Value, prefix: &str) -> bool {
    value.as_str().is_some_and(|text| {
        text.len() == prefix.len() + 32
            && text.starts_with(prefix)
            && text[prefix.len()..]
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
/// Identificativo accettato dalle route: 1..200 caratteri, nessun carattere di controllo.
fn route_id(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 200
        && !value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}

/// Il documento scelto e i suoi byte, già decifrati da GPUI. I byte non restano
/// in memoria oltre l'invio: si cancellano con `wipe` o quando la richiesta cade.
#[derive(Clone)]
pub struct DocumentSynthesisRequest {
    pub patient_id: String,
    pub ambulatory_id: String,
    pub attachment_id: String,
    pub name: String,
    pub mime_type: String,
    /// Currentness del documento come l'host la dichiara nella riga letta.
    pub currentness: Value,
    bytes: Zeroizing<Vec<u8>>,
}
impl std::fmt::Debug for DocumentSynthesisRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DocumentSynthesisRequest")
            .field("attachment_id", &self.attachment_id)
            .field("byte_length", &self.bytes.len())
            .finish_non_exhaustive()
    }
}
impl DocumentSynthesisRequest {
    /// `row` è la riga dell'elenco dei documenti; `detail` la lettura esplicita da cui
    /// vengono i byte. Le due devono descrivere lo stesso documento, alla stessa
    /// currentness: altrimenti la richiesta non nasce.
    pub fn new(
        patient_id: &str,
        ambulatory_id: &str,
        row: &Attachment,
        detail: &Attachment,
        bytes: Zeroizing<Vec<u8>>,
    ) -> Result<Self> {
        if !route_id(patient_id) || !route_id(ambulatory_id) || !route_id(&row.id) {
            return Err(RuntimeError::InvalidInput);
        }
        if row.patient_id != patient_id
            || detail.id != row.id
            || detail.patient_id != patient_id
            || !valid_currentness(&row.currentness)
            || detail.currentness != row.currentness
        {
            return Err(RuntimeError::ReadRequired);
        }
        if bytes.is_empty() {
            return Err(RuntimeError::InvalidInput);
        }
        if bytes.len() > DOCUMENT_SYNTHESIS_MAX_BYTES {
            return Err(RuntimeError::TooLarge);
        }
        Ok(Self {
            patient_id: patient_id.to_owned(),
            ambulatory_id: ambulatory_id.to_owned(),
            attachment_id: row.id.clone(),
            name: row.name.clone(),
            mime_type: row.mime_type.clone(),
            currentness: row.currentness.clone().unwrap_or(Value::Null),
            bytes,
        })
    }
    pub fn byte_length(&self) -> usize {
        self.bytes.len()
    }
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    /// La riga descrive ancora il documento inviato: stesso paziente, stesso
    /// documento, stessa currentness dichiarata dall'host. Se il documento è stato
    /// sostituito o tolto, una richiesta fatta adesso invierebbe altro.
    pub fn matches(&self, row: &Attachment) -> bool {
        row.id == self.attachment_id
            && row.patient_id == self.patient_id
            && row.currentness.as_ref() == Some(&self.currentness)
    }
    /// Toglie i byte dalla memoria. Il resto serve a riconoscere il documento.
    pub fn wipe(&mut self) {
        // Il vecchio contenitore si azzera quando cade.
        self.bytes = Zeroizing::new(Vec::new());
    }
    /// Corpo della selezione, come `selection.select` del Web.
    pub fn selection_body(&self, expected_epoch: u64) -> Value {
        json!({
            "expectedEpoch": expected_epoch,
            "patientId": self.patient_id,
            "ambulatoryId": self.ambulatory_id,
        })
    }
    /// Corpo della cattura: soltanto l'identificativo del documento.
    pub fn capture_body(&self) -> Value {
        json!({ "attachmentId": self.attachment_id })
    }
}

fn valid_currentness(value: &Option<Value>) -> bool {
    let Some(value) = value else { return false };
    let Some(object) = exact_object(value, &["sourceRef", "revision", "freshnessEpoch"]) else {
        return false;
    };
    object["sourceRef"].as_str().is_some_and(sha256_hex)
        && [&object["revision"], &object["freshnessEpoch"]]
            .iter()
            .all(|n| {
                n.as_u64()
                    .is_some_and(|n| (1..=9_007_199_254_740_991).contains(&n))
            })
}

/// Corpo dell'anteprima: soltanto la maniglia restituita dall'ingest.
pub fn document_synthesis_preview_body(handle: &str) -> Value {
    json!({ "previewHandle": handle })
}

/// Epoca della selezione letta con `GET` (`{"selectionEpoch": n}`).
pub fn parse_selection_epoch(body: &[u8]) -> Result<u64> {
    let value: Value = serde_json::from_slice(body).map_err(|_| RuntimeError::InvalidResponse)?;
    exact_object(&value, &["selectionEpoch"])
        .and_then(|object| object["selectionEpoch"].as_u64())
        .filter(|n| *n <= 9_007_199_254_740_991)
        .ok_or(RuntimeError::InvalidResponse)
}

/// La selezione concessa: riferimenti opachi e un'epoca che segue quella attesa.
pub fn check_selection_lease(body: &[u8], expected_epoch: u64) -> Result<()> {
    let value: Value = serde_json::from_slice(body).map_err(|_| RuntimeError::InvalidResponse)?;
    let lease = exact_object(&value, &["selection"])
        .and_then(|root| {
            exact_object(
                &root["selection"],
                &[
                    "sessionRef",
                    "selectionEpoch",
                    "patientRef",
                    "ambulatoryRef",
                    "leaseRef",
                    "expiresAt",
                ],
            )
        })
        .ok_or(RuntimeError::InvalidResponse)?;
    let valid = reference(&lease["sessionRef"], "ssr_")
        && reference(&lease["patientRef"], "ptr_")
        && reference(&lease["ambulatoryRef"], "abr_")
        && reference(&lease["leaseRef"], "lsr_")
        && lease["expiresAt"]
            .as_u64()
            .is_some_and(|n| n <= 9_007_199_254_740_991)
        && lease["selectionEpoch"].as_u64() == Some(expected_epoch + 1);
    valid.then_some(()).ok_or(RuntimeError::InvalidResponse)
}

/// Un passaggio intermedio (cattura o ingest): una maniglia, oppure un esito finale
/// se l'host ha rifiutato.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DocumentSynthesisStep {
    Handle(String),
    Done(DocumentSynthesisOutcome),
}

/// Risposta di cattura (`key = "captureHandle"`) o di ingest (`"previewHandle"`).
pub fn document_synthesis_step(
    status: u16,
    body: &[u8],
    key: &str,
) -> Result<DocumentSynthesisStep> {
    if status != 200 {
        return Ok(DocumentSynthesisStep::Done(denied(status, body)));
    }
    let value: Value = serde_json::from_slice(body).map_err(|_| RuntimeError::InvalidResponse)?;
    let handle = exact_object(&value, &[key])
        .and_then(|object| object[key].as_str())
        .filter(|handle| match key {
            "captureHandle" => capture_handle(handle),
            "previewHandle" => preview_handle(handle),
            _ => false,
        })
        .ok_or(RuntimeError::InvalidResponse)?;
    Ok(DocumentSynthesisStep::Handle(handle.to_owned()))
}

/// Una citazione restituita dall'host, riscontrata nel testo estratto.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocumentSynthesisCitation {
    pub label: String,
    pub quote: String,
}

/// Una proposta da rivedere: nessuna scrittura, nessuna applicazione.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocumentSynthesisProposal {
    pub summary: String,
    pub quality_level: String,
    pub citations: Vec<DocumentSynthesisCitation>,
    pub provider: String,
    pub model: String,
    pub venue: String,
    pub egress: String,
    pub fallback: String,
    pub output_sha256: String,
    pub model_causality: String,
    pub writes_performed: u64,
}

pub type DocumentSynthesisOutcome = GenerationOutcome<DocumentSynthesisProposal>;

/// Codici che dicono «funzione non disponibile» e non «errore».
const UNAVAILABLE_CODES: [&str; 5] = [
    "lane_disabled",
    "function_disabled",
    "provider_unavailable",
    "unsupported_local_extraction",
    "unsupported",
];

/// Esito di un rifiuto HTTP: un codice, mai testo del server.
fn denied(status: u16, body: &[u8]) -> DocumentSynthesisOutcome {
    let code = denial_code(body);
    let code = match status {
        401 => "session_unavailable".into(),
        403 if code == "function_disabled" => code,
        403 => "fabric_denied".into(),
        _ if code.is_empty() => "operation_unavailable".into(),
        _ => code,
    };
    if UNAVAILABLE_CODES.contains(&code.as_str()) {
        GenerationOutcome::Unavailable(code)
    } else {
        GenerationOutcome::Failed(code)
    }
}

/// Testo per un codice dell'host, sullo stile della scheda Web.
pub fn document_synthesis_message(code: &str) -> &'static str {
    match code {
        "lane_disabled" | "function_disabled" => {
            "La sintesi dei documenti è spenta sull'host. Si riattiva in Impostazioni, Funzioni AI."
        }
        "provider_unavailable" | "unsupported" => {
            "Il modello locale dell'host non è disponibile. Verifica Impostazioni, Modelli locali."
        }
        "unsupported_local_extraction" => {
            "L'host non riesce a estrarre il testo di questo documento. Serve la lettura diretta dell'originale."
        }
        "fabric_denied" => "L'host non ha autorizzato l'esecuzione sul modello locale.",
        "currentness_mismatch" | "selection_changed" => {
            "Il documento o la selezione sono cambiati durante la richiesta. Nessuna proposta creata: riprova."
        }
        "capture_consumed" | "preview_consumed" | "capture_expired" | "preview_expired" => {
            "La richiesta è scaduta sull'host. Nessuna proposta creata: riprova."
        }
        "binding_stale" | "catalog_stale" | "session_stale" | "revision_conflict"
        | "command_conflict" => {
            "La configurazione dei modelli è cambiata durante la richiesta. Riprova."
        }
        "session_unavailable" => {
            "La sessione dell'host locale non è più valida. Riapri l'accesso locale."
        }
        "operation_unavailable" => {
            "L'host non ha prodotto una sintesi: modello locale non pronto, risposta del modello scartata dai controlli o guasto. Nessuna proposta creata."
        }
        "model_response_invalid" => "La risposta del modello non era valida. Riprova.",
        "response_invalid" => {
            "La risposta dell'host non ha superato i controlli di GPUI. Nessuna proposta mostrata."
        }
        _ => "L'host ha rifiutato la richiesta. Nessuna proposta creata.",
    }
}

/// Testo come `text` nel parser Web: 1..max unità UTF-16, nessun carattere di
/// controllo salvo tabulazione, a capo e ritorno.
fn wire_text(value: &Value, max: usize) -> Option<String> {
    let text = value.as_str()?;
    let units = text.encode_utf16().count();
    (units > 0
        && units <= max
        && !text.chars().any(
            |c| matches!(c, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}'),
        ))
    .then(|| text.to_owned())
}

fn digest_bytes(value: &Value) -> bool {
    value.as_array().is_some_and(|items| {
        items.len() == 32 && items.iter().all(|b| b.as_u64().is_some_and(|b| b <= 255))
    })
}

fn safe_integer(value: &Value) -> Option<u64> {
    value.as_u64().filter(|n| *n <= 9_007_199_254_740_991)
}

/// Specchio di `parseDocumentSynthesisPreviewWire`. Una ricevuta remota (canale
/// ChatGPT) non è accettata: GPUI non chiede mai il canale remoto.
pub fn parse_document_synthesis_wire(value: &Value) -> Result<DocumentSynthesisProposal> {
    let invalid = RuntimeError::InvalidResponse;
    let root = exact_object(value, &["schemaVersion", "status", "publication"]).ok_or(invalid)?;
    if root["schemaVersion"] != WIRE_SCHEMA || root["status"] != "available" {
        return Err(invalid);
    }
    let publication = exact_object(
        &root["publication"],
        &["output", "citations", "receipt", "provenance"],
    )
    .ok_or(invalid)?;
    let output = exact_object(
        &publication["output"],
        &["schemaVersion", "task", "summary", "qualityLevel"],
    )
    .ok_or(invalid)?;
    let summary = wire_text(&output["summary"], 700).ok_or(invalid)?;
    let quality = output["qualityLevel"]
        .as_str()
        .filter(|q| matches!(*q, "green" | "yellow" | "red"))
        .ok_or(invalid)?;
    if output["schemaVersion"] != "mediflow.ai.extract.v1" || output["task"] != "document_synthesis"
    {
        return Err(invalid);
    }
    let items = publication["citations"].as_array().ok_or(invalid)?;
    if items.is_empty() || items.len() > 32 {
        return Err(invalid);
    }
    let mut citations = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let item = exact_object(
            item,
            &["label", "quote", "startByte", "endByte", "quoteSha256"],
        )
        .ok_or(invalid)?;
        let label = format!("S{}", index + 1);
        let quote = wire_text(&item["quote"], 12_000).ok_or(invalid)?;
        let start = safe_integer(&item["startByte"]).ok_or(invalid)?;
        let end = safe_integer(&item["endByte"]).ok_or(invalid)?;
        if item["label"] != label.as_str()
            || end <= start
            || !item["quoteSha256"].as_str().is_some_and(sha256_hex)
        {
            return Err(invalid);
        }
        citations.push(DocumentSynthesisCitation { label, quote });
    }
    let receipt = exact_object(
        &publication["receipt"],
        &[
            "schemaVersion",
            "capability",
            "outputSha256",
            "claimCitationsDigestSha256",
            "sourceSetDigestSha256",
            "providerBindingReceipt",
            "reviewOnly",
            "applyPolicy",
            "writesPerformed",
        ],
    )
    .ok_or(invalid)?;
    let output_sha256 = receipt["outputSha256"]
        .as_str()
        .filter(|s| sha256_hex(s))
        .ok_or(invalid)?;
    if receipt["schemaVersion"] != "mediflow.document-synthesis.publication-receipt.v1"
        || receipt["capability"] != "document_synthesis"
        || !digest_bytes(&receipt["claimCitationsDigestSha256"])
        || !digest_bytes(&receipt["sourceSetDigestSha256"])
        || receipt["reviewOnly"] != true
        || receipt["applyPolicy"] != "none"
        || receipt["writesPerformed"] != json!(0)
    {
        return Err(invalid);
    }
    let binding = exact_object(
        &receipt["providerBindingReceipt"],
        &[
            "schemaVersion",
            "capability",
            "registryTask",
            "provider",
            "model",
            "venue",
            "egress",
            "fallback",
            "runtimeReadiness",
        ],
    )
    .ok_or(invalid)?;
    let model = wire_text(&binding["model"], 256).ok_or(invalid)?;
    if binding["schemaVersion"] != "mediflow.document-synthesis.provider-binding.v1"
        || binding["capability"] != "document_synthesis"
        || binding["registryTask"] != "reasoning"
        || binding["provider"] != "ollama"
        || binding["venue"] != "local_process"
        || binding["egress"] != "none"
        || binding["fallback"] != "none"
        || binding["runtimeReadiness"] != "required"
    {
        return Err(invalid);
    }
    let provenance = exact_object(
        &publication["provenance"],
        &[
            "schemaVersion",
            "capability",
            "sourceSetAuthority",
            "inputDigestScope",
            "citationSupport",
            "modelCausality",
            "fabricProvenance",
        ],
    )
    .ok_or(invalid)?;
    if provenance["schemaVersion"] != "mediflow.document-synthesis.publication-provenance.v1"
        || provenance["capability"] != "document_synthesis"
        || provenance["sourceSetAuthority"] != "application_host"
        || provenance["inputDigestScope"] != "ordered_normalized_provider_projection_set"
        || provenance["citationSupport"]
            != "provider_declared_host_membership_and_locator_validated"
        || provenance["modelCausality"] != "not_established"
    {
        return Err(invalid);
    }
    let fabric = exact_object(
        &provenance["fabricProvenance"],
        &[
            "schemaVersion",
            "capability",
            "venue",
            "provider",
            "model",
            "preprocessing",
            "receipt",
        ],
    )
    .ok_or(invalid)?;
    wire_text(&fabric["model"], 256).ok_or(invalid)?;
    if fabric["schemaVersion"] != "mediflow.ai.fabric-provenance.v1"
        || fabric["capability"] != "document_synthesis"
        || fabric["venue"] != "local_process"
        || fabric["provider"] != "ollama"
        || fabric["preprocessing"] != json!(["context_minimization"])
    {
        return Err(invalid);
    }
    let resolution = exact_object(
        &fabric["receipt"],
        &[
            "schemaVersion",
            "capability",
            "class",
            "venue",
            "egressProfile",
            "provider",
            "model",
            "fallbackCount",
        ],
    )
    .or_else(|| {
        exact_object(
            &fabric["receipt"],
            &[
                "schemaVersion",
                "capability",
                "class",
                "venue",
                "egressProfile",
                "provider",
                "model",
                "providerReceipt",
                "fallbackCount",
            ],
        )
    })
    .ok_or(invalid)?;
    let profile =
        exact_object(&resolution["egressProfile"], &["id", "version", "egress"]).ok_or(invalid)?;
    wire_text(&resolution["model"], 256).ok_or(invalid)?;
    if resolution["schemaVersion"] != "mediflow.ai.fabric-resolution.v1"
        || resolution["capability"] != "document_synthesis"
        || resolution["class"] != "generative"
        || resolution["venue"] != "local_process"
        || profile["id"] != "local_only"
        || profile["version"] != "mediflow.ai.egress-profile.v1"
        || profile["egress"] != "none"
        || resolution["provider"] != "ollama"
        || resolution["fallbackCount"] != json!(0)
    {
        return Err(invalid);
    }
    Ok(DocumentSynthesisProposal {
        summary,
        quality_level: quality.to_owned(),
        citations,
        provider: "ollama".into(),
        model,
        venue: "local_process".into(),
        egress: "none".into(),
        fallback: "none".into(),
        output_sha256: output_sha256.to_owned(),
        model_causality: "not_established".into(),
        writes_performed: 0,
    })
}

/// Risposta HTTP dell'anteprima letta come esito.
pub fn document_synthesis_outcome(status: u16, body: &[u8]) -> Result<DocumentSynthesisOutcome> {
    if status != 200 {
        return Ok(denied(status, body));
    }
    let value: Value = serde_json::from_slice(body).map_err(|_| RuntimeError::InvalidResponse)?;
    Ok(GenerationOutcome::Proposal(Box::new(
        parse_document_synthesis_wire(&value)?,
    )))
}

impl LocalHostAccess {
    /// Il kill switch della sintesi come lo legge il Web, prima di ogni richiesta.
    pub fn document_synthesis_enabled(&self) -> Result<bool> {
        Ok(matches!(
            self.setting_value(HostSettingKey::DocumentSynthesis)?
                .as_deref(),
            Some("enabled" | "true" | "1")
        ))
    }
    /// Selezione, cattura, ingest e anteprima: un tentativo per passaggio, annullabile
    /// con `context`. Nessuna scrittura clinica: l'host risponde con `writesPerformed: 0`.
    pub fn preview_document_synthesis(
        &self,
        request: &DocumentSynthesisRequest,
        context: &RequestContext,
    ) -> Result<DocumentSynthesisOutcome> {
        let client = self.client.with_request_context(context.clone());
        let epoch = parse_selection_epoch(
            &client
                .dedicated_web_raw(
                    Method::GET,
                    DOCUMENT_SYNTHESIS_SELECTION_PATH,
                    self.headers()?,
                    None,
                    false,
                )?
                .body,
        )?;
        let lease = client.dedicated_web_raw(
            Method::POST,
            DOCUMENT_SYNTHESIS_SELECTION_PATH,
            self.headers()?,
            Some(&request.selection_body(epoch)),
            false,
        )?;
        check_selection_lease(&lease.body, epoch)?;
        let captured = client.dedicated_web_raw(
            Method::POST,
            DOCUMENT_SYNTHESIS_CAPTURE_PATH,
            self.headers()?,
            Some(&request.capture_body()),
            false,
        )?;
        let capture =
            match document_synthesis_step(captured.status, &captured.body, "captureHandle")? {
                DocumentSynthesisStep::Handle(handle) => handle,
                DocumentSynthesisStep::Done(outcome) => return Ok(outcome),
            };
        let mut headers = self.headers()?;
        headers.insert(
            DOCUMENT_SYNTHESIS_CAPTURE_HEADER,
            crate::http::sensitive_header(&capture)?,
        );
        let ingested = client.document_synthesis_ingest(headers, request.bytes().to_vec())?;
        let preview =
            match document_synthesis_step(ingested.status, &ingested.body, "previewHandle")? {
                DocumentSynthesisStep::Handle(handle) => handle,
                DocumentSynthesisStep::Done(outcome) => return Ok(outcome),
            };
        let raw = client.dedicated_web_raw(
            Method::POST,
            DOCUMENT_SYNTHESIS_PREVIEW_PATH,
            self.headers()?,
            Some(&document_synthesis_preview_body(&preview)),
            false,
        )?;
        document_synthesis_outcome(raw.status, &raw.body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/document_synthesis"
    );
    fn fixture(name: &str) -> Value {
        serde_json::from_str(&std::fs::read_to_string(format!("{FIXTURES}/{name}.json")).unwrap())
            .unwrap()
    }
    fn write_or_compare(name: &str, built: &Value) {
        let file = format!("{FIXTURES}/{name}.json");
        if std::env::var_os("MEDIFLOW_WRITE_FIXTURES").is_some() {
            std::fs::write(
                &file,
                format!("{}\n", serde_json::to_string_pretty(built).unwrap()),
            )
            .unwrap();
        }
        assert_eq!(
            &fixture(name),
            built,
            "{name}: GPUI non invia il corpo del contratto"
        );
    }
    /// Il documento del file `document.json`, come GPUI lo riceve già decifrato.
    pub(crate) fn document() -> (Attachment, Zeroizing<Vec<u8>>) {
        let document = fixture("document");
        let bytes = bytes_of(&document);
        let row: Attachment = serde_json::from_value(json!({
            "currentness": document["currentness"], "id": document["attachmentId"],
            "patientId": document["patientId"], "name": document["name"],
            "type": document["mimeType"], "size": bytes.len(),
            "path": "sintetico", "summarySnapshot": null, "parseEvidenceArtifactSnapshot": null,
            "ocrQueueState": null, "ocrQueueReason": null, "ocrQueueUpdatedAt": null,
            "createdAt": null,
        }))
        .unwrap();
        (row, bytes)
    }
    fn bytes_of(value: &Value) -> Zeroizing<Vec<u8>> {
        use base64::Engine;
        Zeroizing::new(
            base64::engine::general_purpose::STANDARD
                .decode(value["base64"].as_str().unwrap())
                .unwrap(),
        )
    }
    pub(crate) fn request() -> DocumentSynthesisRequest {
        let (row, bytes) = document();
        let document = fixture("document");
        DocumentSynthesisRequest::new(
            document["patientId"].as_str().unwrap(),
            document["ambulatoryId"].as_str().unwrap(),
            &row,
            &row,
            bytes,
        )
        .unwrap()
    }
    fn response(name: &str) -> (u16, Vec<u8>) {
        let value = fixture(name);
        (
            value["status"].as_u64().unwrap() as u16,
            value["body"].to_string().into_bytes(),
        )
    }

    /// I corpi che GPUI invia, uguali ai file che `lib/document-synthesis-gpui-contract.test.ts`
    /// passa agli handler reali, nello stesso ordine del Web.
    #[test]
    fn request_bodies_match_the_contract_fixtures() {
        let request = request();
        let (status, body) = response("response-selection-epoch");
        assert_eq!(status, 200);
        let epoch = parse_selection_epoch(&body).unwrap();
        write_or_compare("request-selection", &request.selection_body(epoch));
        let (_, lease) = response("response-selection");
        check_selection_lease(&lease, epoch).unwrap();
        write_or_compare("request-capture", &request.capture_body());
        let (status, body) = response("response-capture");
        let DocumentSynthesisStep::Handle(capture) =
            document_synthesis_step(status, &body, "captureHandle").unwrap()
        else {
            panic!("la cattura reale restituisce una maniglia");
        };
        assert_eq!(fixture("request-ingest")["captureHandle"], capture.as_str());
        assert_eq!(
            bytes_of(&fixture("request-ingest")).as_slice(),
            request.bytes()
        );
        let (status, body) = response("response-ingest");
        let DocumentSynthesisStep::Handle(preview) =
            document_synthesis_step(status, &body, "previewHandle").unwrap()
        else {
            panic!("l'ingest reale restituisce una maniglia");
        };
        write_or_compare(
            "request-preview",
            &document_synthesis_preview_body(&preview),
        );
    }

    #[test]
    fn real_handler_responses_become_outcomes() {
        let (status, body) = response("response-available");
        let Ok(GenerationOutcome::Proposal(proposal)) = document_synthesis_outcome(status, &body)
        else {
            panic!("la risposta disponibile è una proposta");
        };
        assert_eq!(proposal.writes_performed, 0);
        assert_eq!(proposal.provider, "ollama");
        assert_eq!(proposal.egress, "none");
        assert!(!proposal.citations.is_empty());
        assert_eq!(proposal.citations[0].label, "S1");
        for (name, expected) in [
            (
                "response-function-disabled",
                GenerationOutcome::Unavailable("function_disabled".into()),
            ),
            (
                "response-provider-failed",
                GenerationOutcome::Failed("operation_unavailable".into()),
            ),
            (
                "response-proposal-invalid",
                GenerationOutcome::Failed("model_response_invalid".into()),
            ),
            (
                "response-proposal-truncated",
                GenerationOutcome::Failed("model_response_invalid".into()),
            ),
            (
                "response-preview-stale",
                GenerationOutcome::Failed("currentness_mismatch".into()),
            ),
        ] {
            let (status, body) = response(name);
            assert_eq!(
                document_synthesis_outcome(status, &body),
                Ok(expected),
                "{name}"
            );
        }
        for (name, key, expected) in [
            (
                "response-capture-lane-disabled",
                "captureHandle",
                GenerationOutcome::Unavailable("lane_disabled".into()),
            ),
            (
                "response-capture-unselected",
                "captureHandle",
                GenerationOutcome::Failed("operation_unavailable".into()),
            ),
            (
                "response-ingest-unsupported",
                "previewHandle",
                GenerationOutcome::Unavailable("unsupported_local_extraction".into()),
            ),
        ] {
            let (status, body) = response(name);
            assert_eq!(
                document_synthesis_step(status, &body, key),
                Ok(DocumentSynthesisStep::Done(expected)),
                "{name}"
            );
        }
    }

    /// Controprova: un corpo alterato non è mai una proposta.
    #[test]
    fn altered_responses_are_refused() {
        let base = fixture("response-available")["body"].clone();
        let check = |change: &dyn Fn(&mut Value)| {
            let mut body = base.clone();
            change(&mut body);
            document_synthesis_outcome(200, body.to_string().as_bytes())
        };
        assert!(check(&|_| {}).is_ok());
        for change in [
            &(|b: &mut Value| b["publication"]["receipt"]["writesPerformed"] = json!(1))
                as &dyn Fn(&mut Value),
            &|b| b["publication"]["receipt"]["applyPolicy"] = json!("apply"),
            &|b| b["publication"]["receipt"]["reviewOnly"] = json!(false),
            &|b| b["publication"]["extra"] = json!(true),
            &|b| {
                b["publication"]["receipt"]["providerBindingReceipt"]["egress"] = json!("internet")
            },
            &|b| {
                b["publication"]["receipt"]["providerBindingReceipt"]["provider"] =
                    json!("chatgpt_subscription")
            },
            &|b| {
                b["publication"]["provenance"]["fabricProvenance"]["receipt"]["fallbackCount"] =
                    json!(1)
            },
            &|b| b["publication"]["citations"][0]["label"] = json!("S2"),
            &|b| b["publication"]["citations"] = json!([]),
            &|b| b["publication"]["output"]["summary"] = json!("x".repeat(701)),
            &|b| b["publication"]["output"]["qualityLevel"] = json!("blue"),
            &|b| b["status"] = json!("denied"),
        ] {
            assert_eq!(check(change), Err(RuntimeError::InvalidResponse));
        }
        // Maniglie e selezione alterate.
        assert_eq!(
            document_synthesis_step(200, br#"{"captureHandle":"dsc_x"}"#, "captureHandle"),
            Err(RuntimeError::InvalidResponse)
        );
        assert_eq!(
            document_synthesis_step(
                200,
                br#"{"previewHandle":"dsc_00000000000000000000000000000000"}"#,
                "previewHandle"
            ),
            Err(RuntimeError::InvalidResponse)
        );
        let (_, lease) = response("response-selection");
        let epoch = parse_selection_epoch(&response("response-selection-epoch").1).unwrap();
        assert_eq!(
            check_selection_lease(&lease, epoch + 1),
            Err(RuntimeError::InvalidResponse)
        );
    }

    /// La richiesta nasce solo se elenco e lettura descrivono lo stesso documento.
    #[test]
    fn request_requires_the_same_document_and_currentness() {
        let (row, bytes) = document();
        let document = fixture("document");
        let patient = document["patientId"].as_str().unwrap();
        let scope = document["ambulatoryId"].as_str().unwrap();
        let mut changed = row.clone();
        changed.currentness.as_mut().unwrap()["revision"] = json!(99);
        assert_eq!(
            DocumentSynthesisRequest::new(patient, scope, &row, &changed, bytes.clone())
                .unwrap_err(),
            RuntimeError::ReadRequired
        );
        let mut missing = row.clone();
        missing.currentness = None;
        assert_eq!(
            DocumentSynthesisRequest::new(patient, scope, &missing, &missing, bytes.clone())
                .unwrap_err(),
            RuntimeError::ReadRequired
        );
        assert_eq!(
            DocumentSynthesisRequest::new("altro", scope, &row, &row, bytes.clone()).unwrap_err(),
            RuntimeError::ReadRequired
        );
        assert_eq!(
            DocumentSynthesisRequest::new(patient, scope, &row, &row, Zeroizing::new(vec![]))
                .unwrap_err(),
            RuntimeError::InvalidInput
        );
        let mut request = DocumentSynthesisRequest::new(patient, scope, &row, &row, bytes).unwrap();
        assert!(request.matches(&row));
        assert!(!request.matches(&changed));
        request.wipe();
        assert_eq!(request.byte_length(), 0);
        assert!(
            request.matches(&row),
            "senza byte la richiesta riconosce ancora il documento"
        );
    }
}
