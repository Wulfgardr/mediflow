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

#[derive(Debug, PartialEq)]
enum DetailBlock {
    Meta(String),
    Text {
        title: &'static str,
        content: String,
    },
    Unreadable(&'static str),
}

fn presentation(attachment: &Attachment) -> Vec<DetailBlock> {
    let saved_summary = summary(attachment);
    let saved_source = source(attachment);
    let mut blocks = vec![
        DetailBlock::Meta(if matches!(saved_summary, SavedText::Present(_)) {
            "Sintesi salvata".into()
        } else {
            "Testo salvato".into()
        }),
        DetailBlock::Meta(match &saved_source {
            Source::Present(saved)
                if saved.attachment_id_present && !saved.file_name.trim().is_empty() =>
            {
                format!("Fonte: {}", saved.file_name)
            }
            Source::DifferentAttachment => "Fonte di un altro allegato: non mostrata".into(),
            _ => "Origine non indicata".into(),
        }),
        DetailBlock::Meta("Corrispondenza con l'originale attuale non verificata".into()),
    ];
    match saved_summary {
        SavedText::Present(text) => blocks.push(DetailBlock::Text {
            title: "SINTESI SALVATA",
            content: text.into(),
        }),
        SavedText::Missing => blocks.push(DetailBlock::Text {
            title: "SINTESI SALVATA",
            content: "Nessuna sintesi salvata disponibile.".into(),
        }),
        SavedText::Unreadable => blocks.push(DetailBlock::Unreadable("SINTESI SALVATA")),
    }
    match saved_source {
        Source::Present(saved) if saved.attachment_id_present => blocks.push(DetailBlock::Text {
            title: "ESTRATTO SALVATO",
            content: if saved.excerpt.trim().is_empty() {
                "Nessun estratto salvato disponibile.".into()
            } else {
                saved.excerpt
            },
        }),
        Source::Unreadable => blocks.push(DetailBlock::Unreadable("FONTE SALVATA")),
        Source::Invalid | Source::Unsupported => blocks.push(DetailBlock::Text {
            title: "FONTE SALVATA",
            content: "La fonte salvata non può essere interpretata. Consulta l'originale.".into(),
        }),
        _ => {}
    }
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
        .unwrap_or_else(|| "Non disponibile".into());
    let mut ocr = format!(
        "{}\nAggiornamento registrato: {updated}",
        ocr_status(attachment.ocr_queue_state.as_deref())
    );
    if attachment.ocr_queue_state.as_deref() == Some("ocr_done") {
        ocr.push_str("\nTesto da OCR precedente");
    }
    if let Some(reason) = ocr_reason(attachment.ocr_queue_reason.as_deref()) {
        ocr.push_str(&format!("\nMotivo: {reason}"));
    }
    blocks.push(DetailBlock::Text {
        title: "ELABORAZIONE PRECEDENTE",
        content: ocr,
    });
    blocks
}

fn meta_line(id: String, content: String, theme: Theme) -> Stateful<Div> {
    div()
        .id(SharedString::from(id))
        .role(Role::Paragraph)
        .aria_label(content.clone())
        .min_w_0()
        .max_w_full()
        .whitespace_normal()
        .type_role(theme, TypeRole::Meta)
        .text_color(theme.secondary)
        .child(text!(content))
}

fn shortening(content: &str, excerpt: bool) -> Option<String> {
    let (_, shortened) = visible_text(content);
    shortened.then(|| {
        format!(
            "{} abbreviato: {DISPLAY_CHARS} di {} caratteri",
            if excerpt { "Estratto" } else { "Testo" },
            content.chars().count()
        )
    })
}

fn text_line(id: String, content: String, theme: Theme) -> Stateful<Div> {
    div()
        .id(SharedString::from(id))
        .role(Role::Paragraph)
        .aria_label(content.clone())
        .min_w_0()
        .max_w_full()
        .whitespace_normal()
        .text_color(theme.ink)
        .child(text!(content))
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

    fn document_detail_elements(
        &self,
        id: &str,
        block: DetailBlock,
        cx: &Context<Self>,
    ) -> Vec<Stateful<Div>> {
        let theme = self.theme;
        match block {
            DetailBlock::Meta(content) => vec![meta_line(id.into(), content, theme)],
            DetailBlock::Text { title, content } => {
                let (visible, _) = visible_text(&content);
                let mut elements = vec![
                    section(SharedString::from(format!("{id}-heading")), title, theme),
                    text_line(format!("{id}-text"), visible.into(), theme),
                ];
                if let Some(label) = shortening(&content, title == "ESTRATTO SALVATO") {
                    elements.push(meta_line(format!("{id}-shortened"), label, theme));
                }
                elements
            }
            DetailBlock::Unreadable(title) => vec![
                section(SharedString::from(format!("{id}-heading")), title, theme),
                self.unreadable_field(
                    if title == "SINTESI SALVATA" {
                        "clinical-document-summary-unreadable"
                    } else {
                        "clinical-document-source-unreadable"
                    },
                    cx,
                ),
            ],
        }
    }

    pub(super) fn document_details_view(&self, attachment: &Attachment, cx: &Context<Self>) -> Div {
        let id = format!("clinical-workspace-document-source-{}", attachment.id);
        let mut blocks = presentation(attachment).into_iter();
        let header = div()
            .min_w_0()
            .max_w_full()
            .flex()
            .flex_col()
            .gap(px(4.))
            .children(
                blocks
                    .by_ref()
                    .take(3)
                    .enumerate()
                    .flat_map(|(index, block)| {
                        self.document_detail_elements(
                            &format!("{id}-provenance-{index}"),
                            block,
                            cx,
                        )
                    }),
            );
        div()
            .min_w_0()
            .max_w_full()
            .flex()
            .flex_col()
            .gap(px(16.))
            .py(px(12.))
            .child(header)
            .children(blocks.enumerate().map(|(index, block)| {
                div()
                    .min_w_0()
                    .max_w_full()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .children(self.document_detail_elements(&format!("{id}-{index}"), block, cx))
            }))
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

    struct Fixture {
        attachment: Attachment,
        expected: Vec<String>,
    }

    fn fixtures() -> Vec<Fixture> {
        let mut coherent = attachment();
        coherent.created_at = Some("2026-10-19T10:00:00Z".into());
        coherent.parse_evidence_artifact_snapshot = Some(saved_source().to_string());
        coherent.ocr_queue_state = Some("ocr_done".into());
        let absent = attachment();
        let mut other = attachment();
        let mut wrong = saved_source();
        wrong["source"]["attachmentId"] = json!("other-synthetic-document");
        other.parse_evidence_artifact_snapshot = Some(wrong.to_string());
        let mut unreadable = attachment();
        unreadable.locked_fields = vec![
            "summarySnapshot".into(),
            "parseEvidenceArtifactSnapshot".into(),
        ];
        let mut long = attachment();
        let mut long_source = saved_source();
        long_source["parseBundle"]["rawMarkdownExcerpt"] = json!("🩺".repeat(12_001));
        long.parse_evidence_artifact_snapshot = Some(long_source.to_string());
        vec![
            Fixture { attachment: coherent, expected: vec![
                "Sintesi salvata".into(), "Fonte: Fonte città 🩺.txt".into(),
                "Corrispondenza con l'originale attuale non verificata".into(),
                "SINTESI SALVATA".into(), "Sintesi città 🩺".into(),
                "ESTRATTO SALVATO".into(), "Estratto sintetico: valore <5; città 🩺".into(),
                "ELABORAZIONE PRECEDENTE".into(),
                "OCR completato\nAggiornamento registrato: Non disponibile\nTesto da OCR precedente".into(),
            ] },
            Fixture { attachment: absent, expected: vec![
                "Sintesi salvata".into(), "Origine non indicata".into(),
                "Corrispondenza con l'originale attuale non verificata".into(),
                "SINTESI SALVATA".into(), "Sintesi città 🩺".into(),
                "ELABORAZIONE PRECEDENTE".into(),
                "Stato non disponibile\nAggiornamento registrato: Non disponibile".into(),
            ] },
            Fixture { attachment: other, expected: vec![
                "Sintesi salvata".into(), "Fonte di un altro allegato: non mostrata".into(),
                "Corrispondenza con l'originale attuale non verificata".into(),
                "SINTESI SALVATA".into(), "Sintesi città 🩺".into(),
                "ELABORAZIONE PRECEDENTE".into(),
                "Stato non disponibile\nAggiornamento registrato: Non disponibile".into(),
            ] },
            Fixture { attachment: unreadable, expected: vec![
                "Testo salvato".into(), "Origine non indicata".into(),
                "Corrispondenza con l'originale attuale non verificata".into(),
                "SINTESI SALVATA".into(),
                "◆ Questo dato non si può leggere con la chiave attuale. Non è vuoto.".into(),
                "FONTE SALVATA".into(),
                "◆ Questo dato non si può leggere con la chiave attuale. Non è vuoto.".into(),
                "ELABORAZIONE PRECEDENTE".into(),
                "Stato non disponibile\nAggiornamento registrato: Non disponibile".into(),
            ] },
            Fixture { attachment: long, expected: vec![
                "Sintesi salvata".into(), "Fonte: Fonte città 🩺.txt".into(),
                "Corrispondenza con l'originale attuale non verificata".into(),
                "SINTESI SALVATA".into(), "Sintesi città 🩺".into(),
                "ESTRATTO SALVATO".into(), "🩺".repeat(12_000),
                "Estratto abbreviato: 12000 di 12001 caratteri".into(),
                "ELABORAZIONE PRECEDENTE".into(),
                "Stato non disponibile\nAggiornamento registrato: Non disponibile".into(),
            ] },
        ]
    }

    #[gpui::test]
    fn five_document_renderings_keep_provenance_separate_without_commands_or_requests(
        cx: &mut gpui::TestAppContext,
    ) {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(endpoint, window, cx));
        for dark in [false, true] {
            for Fixture {
                attachment,
                expected,
            } in fixtures()
            {
                view.update(cx, |app, cx| {
                    app.theme = Theme::for_dark(dark);
                    app.selected_id = Some("synthetic-patient".into());
                    app.patient.attachments = Load::Ready(vec![attachment.clone()]);
                    app.toggle_document_details("synthetic-document", cx);
                    assert_eq!(
                        app.patient.document_details_id.as_deref(),
                        Some("synthetic-document")
                    );
                    let mut labels = vec![];
                    for (index, block) in presentation(&attachment).into_iter().enumerate() {
                        for mut element in
                            app.document_detail_elements(&format!("fixture-{index}"), block, cx)
                        {
                            let role = Element::a11y_role(&element).unwrap();
                            assert!(matches!(
                                role,
                                Role::Paragraph | Role::Heading | Role::Status | Role::Alert
                            ));
                            let mut node = gpui::accesskit::Node::new(role);
                            Element::write_a11y_info(&element, &mut node);
                            assert!(!node.supports_action(gpui::accesskit::Action::Click));
                            labels.push(node.label().unwrap().to_owned());
                            assert_ne!(element.text_style().color, Some(app.theme.pencil));
                        }
                    }
                    assert_eq!(labels, expected);
                    assert!(app.form.is_none());
                    assert!(!app.document_busy);
                });
                cx.draw(
                    gpui::Point::default(),
                    gpui::size(px(390.), px(1200.)),
                    |_, cx| view.update(cx, |app, cx| app.document_details_view(&attachment, cx)),
                );
                cx.run_until_parked();
                view.update(cx, |app, cx| {
                    app.toggle_document_details("synthetic-document", cx);
                    assert!(app.patient.document_details_id.is_none());
                    assert!(app.form.is_none());
                });
                assert_eq!(
                    listener.accept().unwrap_err().kind(),
                    std::io::ErrorKind::WouldBlock
                );
            }
        }
    }

    #[test]
    fn unlinked_source_is_not_attributed_to_the_open_document() {
        let mut row = attachment();
        let mut legacy = saved_source();
        legacy["source"]
            .as_object_mut()
            .unwrap()
            .remove("attachmentId");
        row.parse_evidence_artifact_snapshot = Some(legacy.to_string());
        let blocks = presentation(&row);
        assert_eq!(blocks[1], DetailBlock::Meta("Origine non indicata".into()));
        assert!(!blocks.iter().any(|block| matches!(
            block,
            DetailBlock::Text {
                title: "ESTRATTO SALVATO",
                ..
            }
        )));
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
