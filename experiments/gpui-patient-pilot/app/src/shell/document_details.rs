use super::*;
use serde_json::Value;

const SOURCE_SCHEMA: &str = "mediflow.document_parse_evidence_artifact.v1";
const DISPLAY_CHARS: usize = 12_000;

#[derive(Debug, PartialEq)]
enum SavedText<'a> {
    Present(&'a str),
    Missing,
    Unreadable,
}

fn summary(attachment: &Attachment) -> SavedText<'_> {
    if attachment
        .locked_fields
        .iter()
        .any(|field| field == "summarySnapshot")
    {
        SavedText::Unreadable
    } else {
        attachment
            .summary_snapshot
            .as_deref()
            .filter(|text| !text.trim().is_empty())
            .map_or(SavedText::Missing, SavedText::Present)
    }
}

#[derive(Debug, PartialEq)]
struct SavedSource {
    file_name: String,
    document_date: String,
    excerpt: String,
    attachment_id_present: bool,
}

#[derive(Debug, PartialEq)]
enum Source {
    Present(SavedSource),
    Missing,
    Unreadable,
    Invalid,
    Unsupported,
    DifferentAttachment,
}

fn source(attachment: &Attachment) -> Source {
    if attachment
        .locked_fields
        .iter()
        .any(|field| field == "parseEvidenceArtifactSnapshot")
    {
        return Source::Unreadable;
    }
    let Some(snapshot) = attachment
        .parse_evidence_artifact_snapshot
        .as_deref()
        .filter(|text| !text.trim().is_empty())
    else {
        return Source::Missing;
    };
    let Ok(value) = serde_json::from_str::<Value>(snapshot) else {
        return Source::Invalid;
    };
    match value.get("schemaVersion").and_then(Value::as_str) {
        Some(SOURCE_SCHEMA) => {}
        Some(_) => return Source::Unsupported,
        None => return Source::Invalid,
    }
    let Some(source) = value.get("source").and_then(Value::as_object) else {
        return Source::Invalid;
    };
    let attachment_id_present = if let Some(id) = source.get("attachmentId") {
        let Some(id) = id.as_str() else {
            return Source::Invalid;
        };
        if id != attachment.id {
            return Source::DifferentAttachment;
        }
        true
    } else {
        false
    };
    // Decode only saved presentation fields. Validity and application of evidence
    // remain with the host's document authority, whose currentness tuple is absent here.
    let fields = || -> Option<SavedSource> {
        source.get("documentInsightId")?.as_str()?;
        let bundle = value.get("parseBundle")?.as_object()?;
        Some(SavedSource {
            file_name: source.get("fileName")?.as_str()?.to_owned(),
            document_date: source.get("documentDate")?.as_str()?.to_owned(),
            excerpt: bundle.get("rawMarkdownExcerpt")?.as_str()?.to_owned(),
            attachment_id_present,
        })
    };
    fields().map_or(Source::Invalid, Source::Present)
}

fn ocr_status(state: Option<&str>) -> &'static str {
    match state {
        Some("pending") => "In attesa",
        Some("processing") => "In elaborazione",
        Some("ocr_done") => "OCR completato",
        Some("ocr_failed") => "OCR non completato",
        Some("manual_review") => "Revisione manuale richiesta",
        None => "Stato non disponibile",
        Some(_) => "Stato non riconosciuto",
    }
}

fn ocr_reason(reason: Option<&str>) -> Option<&'static str> {
    match reason {
        Some("text_layer_absent") => Some("Testo assente nel documento"),
        Some("text_too_short") => Some("Testo insufficiente"),
        Some("image_or_scan") => Some("Immagine o scansione"),
        Some("corrupted_pdf") => Some("PDF danneggiato"),
        Some("password_protected") => Some("PDF protetto da password"),
        Some("paired_upload") => Some("Documento caricato da un dispositivo collegato"),
        None => None,
        Some(_) => Some("Motivo non riconosciuto"),
    }
}

fn visible_text(text: &str) -> (&str, bool) {
    match text.char_indices().nth(DISPLAY_CHARS) {
        Some((end, _)) => (&text[..end], true),
        None => (text, false),
    }
}

fn text_block(id: &str, title: &str, content: &str, theme: Theme) -> Div {
    let (content, shortened) = visible_text(content);
    div()
        .min_w_0()
        .max_w_full()
        .flex()
        .flex_col()
        .gap(px(8.))
        .child(section(
            SharedString::from(format!("{id}-heading")),
            title.to_owned(),
            theme,
        ))
        .child(
            div()
                .min_w_0()
                .max_w_full()
                .whitespace_normal()
                .child(text!(content.to_owned())),
        )
        .when(shortened, |el| {
            el.child(notice(
                SharedString::from(format!("{id}-shortened")),
                "Testo abbreviato in questa vista. Consulta l'originale per il contenuto completo.",
                theme,
                false,
            ))
        })
}

impl ClinicalApp {
    pub(super) fn toggle_document_details(&mut self, id: &str, cx: &mut Context<Self>) {
        if self.document_busy
            || self.form.is_some()
            || !self.patient.attachments.ready().is_some_and(|rows| {
                rows.iter().any(|row| {
                    row.id == id && self.selected_id.as_deref() == Some(row.patient_id.as_str())
                })
            })
        {
            return;
        }
        self.patient.document_details_id =
            if self.patient.document_details_id.as_deref() == Some(id) {
                None
            } else {
                Some(id.to_owned())
            };
        cx.notify();
    }

    pub(super) fn document_details_view(&self, attachment: &Attachment) -> Div {
        let theme = self.theme;
        let id = format!("clinical-workspace-document-source-{}", attachment.id);
        let summary_block = match summary(attachment) {
            SavedText::Present(text) => {
                text_block(&format!("{id}-summary"), "SINTESI SALVATA", text, theme)
            }
            state => div().child(notice(
                SharedString::from(format!("{id}-summary-state")),
                if state == SavedText::Unreadable {
                    "La sintesi salvata non è leggibile con questo accesso."
                } else {
                    "Nessuna sintesi salvata disponibile."
                },
                theme,
                state == SavedText::Unreadable,
            )),
        };
        let source_block = match source(attachment) {
            Source::Present(saved) => div().min_w_0().max_w_full().flex().flex_col().gap(px(12.))
                .child(text_block(&format!("{id}-file"), "FONTE REGISTRATA", &format!(
                    "Nome: {}\nData del documento: {}",
                    if saved.file_name.trim().is_empty() { "Non riportato" } else { &saved.file_name },
                    display_date(Some(&saved.document_date)),
                ), theme))
                .when(!saved.attachment_id_present, |el| el.child(notice(
                    SharedString::from(format!("{id}-legacy")),
                    "Il collegamento a questo documento non è riportato nella fonte salvata.", theme, false,
                )))
                .child(text_block(&format!("{id}-excerpt"), "ESTRATTO SALVATO",
                    if saved.excerpt.trim().is_empty() { "Nessun estratto salvato disponibile." } else { &saved.excerpt }, theme)),
            state => div().child(notice(SharedString::from(format!("{id}-state")), match state {
                Source::Missing => "Nessuna fonte salvata disponibile.",
                Source::Unreadable => "La fonte salvata non è leggibile con questo accesso.",
                Source::Invalid => "La fonte salvata non può essere interpretata. Consulta l'originale.",
                Source::Unsupported => "Il formato della fonte salvata non è supportato da questa vista. Consulta l'originale.",
                Source::DifferentAttachment => "La fonte salvata indica un altro documento. Il suo contenuto non viene mostrato.",
                Source::Present(_) => unreachable!(),
            }, theme, !matches!(state, Source::Missing))),
        };
        let updated = attachment
            .ocr_queue_updated_at
            .as_deref()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|value| {
                value
                    .with_timezone(&chrono::Local)
                    .format("%d/%m/%Y · %H:%M:%S (ora locale)")
                    .to_string()
            })
            .unwrap_or_else(|| "Non disponibile".to_owned());
        let mut ocr = format!(
            "{}\nAggiornamento registrato: {updated}",
            ocr_status(attachment.ocr_queue_state.as_deref())
        );
        if let Some(reason) = ocr_reason(attachment.ocr_queue_reason.as_deref()) {
            ocr.push_str(&format!("\nMotivo: {reason}"));
        }
        div().min_w_0().max_w_full().flex().flex_col().gap(px(16.)).py(px(12.))
            .child(notice(SharedString::from(format!("{id}-boundary")),
                "I contenuti disponibili sono quelli già salvati nell'archivio. La corrispondenza con l'originale attuale non è verificata.", theme, false))
            .child(summary_block)
            .child(source_block)
            .child(text_block(&format!("{id}-ocr"), "ELABORAZIONE REGISTRATA", &ocr, theme))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn attachment() -> Attachment {
        serde_json::from_value(json!({
            "id":"synthetic-document", "patientId":"synthetic-patient",
            "name":"Documento sintetico.txt", "path":"Documento sintetico.txt",
            "type":"text/plain", "size":4, "summarySnapshot":"Sintesi città 🩺"
        }))
        .unwrap()
    }

    fn saved_source() -> Value {
        json!({"schemaVersion":SOURCE_SCHEMA,
            "source":{"documentInsightId":"synthetic-insight", "attachmentId":"synthetic-document",
                "fileName":"Fonte città 🩺.txt", "documentDate":"2026-10-19"},
            "parseBundle":{"summary":"Altra sintesi nel parsing", "rawMarkdownExcerpt":"Estratto sintetico: valore <5; città 🩺",
                "parserDiagnostics":{"rawTextChars":47,"lineCount":1}},
            "evidenceMemory":{"facts":[]}})
    }

    #[test]
    fn saved_source_preserves_text_and_distinguishes_absence_unreadable_unknown_and_wrong_document()
    {
        let mut row = attachment();
        assert_eq!(summary(&row), SavedText::Present("Sintesi città 🩺"));
        assert_eq!(source(&row), Source::Missing);
        row.locked_fields = vec![
            "summarySnapshot".into(),
            "parseEvidenceArtifactSnapshot".into(),
        ];
        assert_eq!(summary(&row), SavedText::Unreadable);
        assert_eq!(source(&row), Source::Unreadable);
        row.locked_fields.clear();
        row.parse_evidence_artifact_snapshot = Some(saved_source().to_string());
        assert_eq!(
            source(&row),
            Source::Present(SavedSource {
                file_name: "Fonte città 🩺.txt".into(),
                document_date: "2026-10-19".into(),
                excerpt: "Estratto sintetico: valore <5; città 🩺".into(),
                attachment_id_present: true,
            })
        );
        let mut legacy = saved_source();
        legacy["source"]
            .as_object_mut()
            .unwrap()
            .remove("attachmentId");
        row.parse_evidence_artifact_snapshot = Some(legacy.to_string());
        assert!(matches!(
            source(&row),
            Source::Present(SavedSource {
                attachment_id_present: false,
                ..
            })
        ));
        let mut wrong = saved_source();
        wrong["source"]["attachmentId"] = json!("other-synthetic-document");
        row.parse_evidence_artifact_snapshot = Some(wrong.to_string());
        assert_eq!(source(&row), Source::DifferentAttachment);
        for invalid in ["{", "null", "{}", "{\"schemaVersion\":null}"] {
            row.parse_evidence_artifact_snapshot = Some(invalid.into());
            assert_eq!(source(&row), Source::Invalid);
        }
        let mut invalid = saved_source();
        invalid["parseBundle"]["rawMarkdownExcerpt"] = Value::Null;
        row.parse_evidence_artifact_snapshot = Some(invalid.to_string());
        assert_eq!(source(&row), Source::Invalid);
        invalid["schemaVersion"] = json!("mediflow.document_parse_evidence_artifact.v2");
        row.parse_evidence_artifact_snapshot = Some(invalid.to_string());
        assert_eq!(source(&row), Source::Unsupported);
    }

    #[test]
    fn long_unicode_text_is_explicitly_shortened_and_unknown_ocr_is_not_success() {
        let long = "🩺".repeat(DISPLAY_CHARS + 1);
        let (visible, shortened) = visible_text(&long);
        assert!(shortened);
        assert_eq!(visible.chars().count(), DISPLAY_CHARS);
        assert_eq!(visible_text("valore <5"), ("valore <5", false));
        assert_eq!(ocr_status(Some("ocr_done")), "OCR completato");
        assert_eq!(ocr_status(Some("future_success")), "Stato non riconosciuto");
        assert_eq!(ocr_status(None), "Stato non disponibile");
    }

    #[gpui::test]
    fn document_panel_uses_loaded_rows_and_retires_on_context_changes(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.selected_id = Some("synthetic-patient".into());
            app.patient.attachments = Load::Ready(vec![attachment()]);
            app.toggle_document_details("missing", cx);
            assert!(app.patient.document_details_id.is_none());
            app.toggle_document_details("synthetic-document", cx);
            assert_eq!(
                app.patient.document_details_id.as_deref(),
                Some("synthetic-document")
            );
            app.toggle_document_details("synthetic-document", cx);
            assert!(app.patient.document_details_id.is_none());
            app.toggle_document_details("synthetic-document", cx);
            app.next_epoch();
            assert!(app.patient.document_details_id.is_none());
            app.toggle_document_details("synthetic-document", cx);
            app.navigate(Area::Analytics, cx);
            assert!(app.patient.document_details_id.is_none());
            assert!(app.patient.attachments.ready().is_none());
            app.selected_id = Some("synthetic-patient".into());
            app.patient.attachments = Load::Ready(vec![attachment()]);
            app.toggle_document_details("synthetic-document", cx);
            app.run(
                || Ok(vec![attachment()]),
                |app, result, _| app.patient.attachments = Load::from_result(result),
                cx,
            );
            app.disconnect(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.patient.document_details_id.is_none());
            assert!(app.patient.attachments.ready().is_none());
        });
    }
}
