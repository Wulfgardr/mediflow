use super::*;
use serde_json::Value;

const SOURCE_SCHEMA: &str = "mediflow.document_parse_evidence_artifact.v1";
const DISPLAY_CHARS: usize = 12_000;
const PDF_FIDELITY_NOTICE: &str = "Alcuni caratteri possono mancare o differire: per un valore clinico controlla il documento originale.";

pub(super) struct DocumentOriginal {
    pub(super) id: String,
    state: ReadLoad<Result<documents::OriginalPreview, String>>,
    page: usize,
    context: RequestContext,
}

impl Drop for DocumentOriginal {
    fn drop(&mut self) {
        self.context.cancel();
    }
}

impl ClinicalApp {
    pub(super) fn toggle_document_original(&mut self, id: &str, cx: &mut Context<Self>) {
        if self.form.is_some()
            || self.document_operation != DocumentOperation::Idle
            || self.local_host.has_work()
        {
            return;
        }
        if self
            .patient
            .document_original
            .as_ref()
            .is_some_and(|view| view.id == id)
        {
            self.patient.document_original = None;
            cx.notify();
            return;
        }
        if !self.patient.attachments.ready().is_some_and(|rows| {
            rows.iter().any(|row| {
                row.id == id && Some(row.patient_id.as_str()) == self.selected_id.as_deref()
            })
        }) {
            return;
        }
        let (Some(session), Some(scope), Some(patient)) = (
            self.session.clone(),
            self.scope.clone(),
            self.selected_id.clone(),
        ) else {
            return;
        };
        let id = id.to_owned();
        let context = RequestContext::default();
        self.patient.document_original = Some(DocumentOriginal {
            id: id.clone(),
            state: ReadLoad::loading(),
            page: 0,
            context: context.clone(),
        });
        let requested = id.clone();
        let work_context = context.clone();
        let expiry_context = context.clone();
        let expiry_id = id.clone();
        self.run(
            move || {
                let row = session.read_attachment(&scope, &patient, &requested)?;
                Ok(documents::original_preview_with_context(
                    &row,
                    &work_context,
                ))
            },
            move |this, result, _| {
                if context.check().is_ok()
                    && let Some(view) = &mut this.patient.document_original
                    && view.id == id
                {
                    view.state = ReadLoad::from_result(result);
                }
            },
            cx,
        );
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(documents::pdf::VIEW_LIFETIME).await;
            let _ = this.update(cx, |this, cx| {
                if expiry_context.check().is_ok() && this.patient.document_original.as_ref().is_some_and(|view| view.id == expiry_id) {
                    if let Some(view) = &mut this.patient.document_original {
                        view.context.cancel();
                        view.state = ReadLoad::Ready(Err("L’anteprima è scaduta. Chiudi e apri di nuovo l’originale per continuare la lettura.".into()));
                    }
                    cx.notify();
                }
            });
        }).detach();
        cx.notify();
    }

    fn turn_document_original(&mut self, page: usize, cx: &mut Context<Self>) {
        let Some(original) = &mut self.patient.document_original else {
            return;
        };
        match &original.state {
            ReadLoad::Ready(Ok(documents::OriginalPreview::Text(text)))
                if documents::text_window(text, page).is_some() =>
            {
                original.page = page;
            }
            ReadLoad::Ready(Ok(documents::OriginalPreview::Pdf(pdf))) if page < pdf.pages => {
                let source = pdf.source.clone();
                let context = original.context.clone();
                let work_context = context.clone();
                let id = original.id.clone();
                original.page = page;
                original.state = ReadLoad::loading();
                self.run(
                    move || {
                        Ok(documents::pdf::render(source, page + 1, &work_context)
                            .map(documents::OriginalPreview::Pdf)
                            .map_err(documents::pdf::Error::message))
                    },
                    move |this, result, _| {
                        if context.check().is_ok()
                            && let Some(original) = &mut this.patient.document_original
                            && original.id == id
                            && original.page == page
                        {
                            original.state = ReadLoad::from_result(result);
                        }
                    },
                    cx,
                );
            }
            _ => return,
        }
        cx.notify();
    }

    fn document_original_controls(&self, page: usize, count: usize, cx: &Context<Self>) -> Div {
        div().flex().flex_wrap().gap(px(8.)).children(
            [
                (
                    "document-original-previous",
                    "Pagina precedente",
                    page.checked_sub(1),
                ),
                (
                    "document-original-next",
                    "Pagina successiva",
                    (page + 1 < count).then_some(page + 1),
                ),
            ]
            .into_iter()
            .map(|(id, label, target)| {
                button(id, label, self.theme, false, target.is_some()).when_some(
                    target,
                    |el, page| {
                        el.on_click(
                            cx.listener(move |this, _, _, cx| {
                                this.turn_document_original(page, cx)
                            }),
                        )
                    },
                )
            }),
        )
    }

    fn document_original_save(&self, id: &str, cx: &Context<Self>) -> gpui::AnyElement {
        let theme = self.theme;
        let id = id.to_owned();
        let can_save = self
            .session
            .as_ref()
            .is_some_and(|session| !session.is_locked())
            && self.document_operation == DocumentOperation::Idle
            && self.form.is_none()
            && !self.local_host.has_work()
            && !self
                .copy_state
                .is_some_and(documents::CopyState::is_writing)
            && self.patient.attachments.ready().is_some_and(|rows| {
                rows.iter().any(|row| {
                    row.id == id
                        && Some(row.patient_id.as_str()) == self.selected_id.as_deref()
                        && documents::original_readable(row)
                })
            });
        let save = button(
            "document-original-save",
            "Salva l'originale…",
            theme,
            false,
            can_save,
        )
        .when(can_save, |el| {
            el.on_click(cx.listener(move |this, _, _, cx| this.download_document(&id, cx)))
        });
        #[cfg(test)]
        let save = rendered_command::observe(save);
        save.into_any_element()
    }

    pub(super) fn document_original_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut view = div()
            .min_w_0()
            .max_w_full()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(section("document-original-heading", "Originale", theme));
        let Some(original) = &self.patient.document_original else {
            return view;
        };
        match &original.state {
            ReadLoad::Ready(Ok(documents::OriginalPreview::Text(text))) => {
                let (text, count) =
                    documents::text_window(text, original.page).expect("valid original page");
                view = view
                    .child(text_line(
                        "document-original-text".into(),
                        text.into(),
                        theme,
                    ))
                    .child(text!(format!("Pagina {} di {count}", original.page + 1)))
                    .child(self.document_original_controls(original.page, count, cx));
            }
            ReadLoad::Ready(Ok(documents::OriginalPreview::Pdf(pdf))) => {
                view = view
                    .child(
                        gpui::img(pdf.image.clone())
                            .w_full()
                            .max_h(px(640.))
                            .object_fit(gpui::ObjectFit::Contain),
                    )
                    .child(text!(format!(
                        "Pagina {} di {}",
                        original.page + 1,
                        pdf.pages
                    )))
                    .child(self.document_original_controls(original.page, pdf.pages, cx));
                let warning = notice(
                    "document-pdf-fidelity-notice",
                    PDF_FIDELITY_NOTICE,
                    theme,
                    false,
                )
                .flex_1();
                #[cfg(test)]
                let warning = rendered_command::observe(warning);
                view = view.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(px(12.))
                        .child(warning)
                        .child(self.document_original_save(&original.id, cx)),
                );
            }
            ReadLoad::Ready(Ok(documents::OriginalPreview::Image(image))) => {
                view = view.child(
                    gpui::img(image.clone())
                        .w_full()
                        .max_h(px(640.))
                        .object_fit(gpui::ObjectFit::Contain),
                );
            }
            ReadLoad::Ready(Err(message)) => {
                let warning = notice(
                    "document-original-unavailable",
                    message.clone(),
                    theme,
                    true,
                );
                #[cfg(test)]
                let warning = rendered_command::observe(warning);
                let save = self.document_original_save(&original.id, cx);
                view = view.child(warning).child(save)
            }
            ReadLoad::Failed(error) => {
                view = view.child(notice(
                    "document-original-error",
                    ui_error(*error),
                    theme,
                    true,
                ))
            }
            _ => {
                view = view.child(notice(
                    "document-original-loading",
                    "Caricamento anteprima…",
                    theme,
                    false,
                ))
            }
        }
        view
    }
}

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
    Text {
        title: &'static str,
        content: String,
        metadata: Vec<String>,
    },
    Unreadable(&'static str, Vec<String>),
}

fn presentation(attachment: &Attachment) -> Vec<DetailBlock> {
    let saved_summary = summary(attachment);
    let saved_source = source(attachment);
    let provenance = vec![
        match &saved_source {
            Source::Present(saved)
                if saved.attachment_id_present && !saved.file_name.trim().is_empty() =>
            {
                format!("Fonte: {}", saved.file_name)
            }
            Source::Present(saved) if saved.attachment_id_present => {
                "Fonte: questo documento (nome non disponibile)".into()
            }
            Source::Missing | Source::Present(_) => "Origine non indicata".into(),
            Source::Unreadable => "Fonte salvata, non leggibile con la chiave attuale".into(),
            Source::Invalid => "Fonte salvata, non leggibile".into(),
            Source::Unsupported => {
                "Fonte salvata in un formato più recente: non verificabile".into()
            }
            Source::DifferentAttachment => "Fonte di un altro allegato: non mostrata".into(),
        },
        "Corrispondenza con l'originale attuale non verificata".into(),
    ];
    let mut blocks = vec![];
    match saved_summary {
        SavedText::Present(text) => blocks.push(DetailBlock::Text {
            title: "SINTESI SALVATA",
            content: text.into(),
            metadata: provenance,
        }),
        SavedText::Missing => blocks.push(DetailBlock::Text {
            title: "SINTESI SALVATA",
            content: "Nessuna sintesi salvata disponibile.".into(),
            metadata: provenance,
        }),
        SavedText::Unreadable => {
            blocks.push(DetailBlock::Unreadable("SINTESI SALVATA", provenance))
        }
    }
    match saved_source {
        Source::Present(saved) if saved.attachment_id_present => blocks.push(DetailBlock::Text {
            title: "ESTRATTO SALVATO",
            metadata: vec![],
            content: if saved.excerpt.trim().is_empty() {
                "Nessun estratto salvato disponibile.".into()
            } else {
                saved.excerpt
            },
        }),
        Source::Unreadable => blocks.push(DetailBlock::Unreadable("FONTE SALVATA", vec![])),
        Source::Invalid | Source::Unsupported => blocks.push(DetailBlock::Text {
            title: "FONTE SALVATA",
            metadata: vec![],
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
        metadata: vec![],
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
        .type_role(theme, crate::theme::TextRole::Meta)
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
        if self.document_operation != DocumentOperation::Idle
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
        let (title, content, mut metadata) = match block {
            DetailBlock::Text {
                title,
                content,
                metadata,
            } => (title, Some(content), metadata),
            DetailBlock::Unreadable(title, metadata) => (title, None, metadata),
        };
        if let Some(content) = &content
            && let Some(label) = shortening(content, title == "ESTRATTO SALVATO")
        {
            metadata.push(label);
        }
        let mut elements = vec![section(
            SharedString::from(format!("{id}-heading")),
            title,
            theme,
        )];
        elements.extend(
            metadata
                .into_iter()
                .enumerate()
                .map(|(index, label)| meta_line(format!("{id}-meta-{index}"), label, theme)),
        );
        elements.push(match content {
            Some(content) => {
                text_line(format!("{id}-text"), visible_text(&content).0.into(), theme)
            }
            None => self.unreadable_field(
                if title == "SINTESI SALVATA" {
                    "clinical-document-summary-unreadable"
                } else {
                    "clinical-document-source-unreadable"
                },
                cx,
            ),
        });
        elements
    }

    pub(super) fn document_details_view(&self, attachment: &Attachment, cx: &Context<Self>) -> Div {
        let id = format!("clinical-workspace-document-source-{}", attachment.id);
        div()
            .min_w_0()
            .max_w_full()
            .flex()
            .flex_col()
            .gap(px(16.))
            .py(px(12.))
            .children(
                presentation(attachment)
                    .into_iter()
                    .enumerate()
                    .map(|(index, block)| {
                        div()
                            .min_w_0()
                            .max_w_full()
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .children(self.document_detail_elements(
                                &format!("{id}-{index}"),
                                block,
                                cx,
                            ))
                    }),
            )
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
        let mut invalid = attachment();
        invalid.parse_evidence_artifact_snapshot = Some("{".into());
        let mut unsupported = attachment();
        let mut newer = saved_source();
        newer["schemaVersion"] = json!("mediflow.document_parse_evidence_artifact.v2");
        unsupported.parse_evidence_artifact_snapshot = Some(newer.to_string());
        let unnamed = ["", "   "].map(|file_name| {
            let mut row = attachment();
            let mut saved = saved_source();
            saved["source"]["fileName"] = json!(file_name);
            row.parse_evidence_artifact_snapshot = Some(saved.to_string());
            Fixture {
                attachment: row,
                expected: vec![
                    "SINTESI SALVATA".into(),
                    "Fonte: questo documento (nome non disponibile)".into(),
                    "Corrispondenza con l'originale attuale non verificata".into(),
                    "Sintesi città 🩺".into(),
                    "ESTRATTO SALVATO".into(),
                    "Estratto sintetico: valore <5; città 🩺".into(),
                    "ELABORAZIONE PRECEDENTE".into(),
                    "Stato non disponibile\nAggiornamento registrato: Non disponibile".into(),
                ],
            }
        });
        let mut fixtures = vec![
            Fixture { attachment: coherent, expected: vec![
                "SINTESI SALVATA".into(), "Fonte: Fonte città 🩺.txt".into(),
                "Corrispondenza con l'originale attuale non verificata".into(),
                "Sintesi città 🩺".into(),
                "ESTRATTO SALVATO".into(), "Estratto sintetico: valore <5; città 🩺".into(),
                "ELABORAZIONE PRECEDENTE".into(),
                "OCR completato\nAggiornamento registrato: Non disponibile\nTesto da OCR precedente".into(),
            ] },
            Fixture { attachment: absent, expected: vec![
                "SINTESI SALVATA".into(), "Origine non indicata".into(),
                "Corrispondenza con l'originale attuale non verificata".into(),
                "Sintesi città 🩺".into(),
                "ELABORAZIONE PRECEDENTE".into(),
                "Stato non disponibile\nAggiornamento registrato: Non disponibile".into(),
            ] },
            Fixture { attachment: other, expected: vec![
                "SINTESI SALVATA".into(), "Fonte di un altro allegato: non mostrata".into(),
                "Corrispondenza con l'originale attuale non verificata".into(),
                "Sintesi città 🩺".into(),
                "ELABORAZIONE PRECEDENTE".into(),
                "Stato non disponibile\nAggiornamento registrato: Non disponibile".into(),
            ] },
            Fixture { attachment: unreadable, expected: vec![
                "SINTESI SALVATA".into(),
                "Fonte salvata, non leggibile con la chiave attuale".into(),
                "Corrispondenza con l'originale attuale non verificata".into(),
                "◆ Questo dato non si può leggere con la chiave attuale. Non è vuoto.".into(),
                "FONTE SALVATA".into(),
                "◆ Questo dato non si può leggere con la chiave attuale. Non è vuoto.".into(),
                "ELABORAZIONE PRECEDENTE".into(),
                "Stato non disponibile\nAggiornamento registrato: Non disponibile".into(),
            ] },
            Fixture { attachment: invalid, expected: vec![
                "SINTESI SALVATA".into(), "Fonte salvata, non leggibile".into(),
                "Corrispondenza con l'originale attuale non verificata".into(),
                "Sintesi città 🩺".into(),
                "FONTE SALVATA".into(),
                "La fonte salvata non può essere interpretata. Consulta l'originale.".into(),
                "ELABORAZIONE PRECEDENTE".into(),
                "Stato non disponibile\nAggiornamento registrato: Non disponibile".into(),
            ] },
            Fixture { attachment: unsupported, expected: vec![
                "SINTESI SALVATA".into(),
                "Fonte salvata in un formato più recente: non verificabile".into(),
                "Corrispondenza con l'originale attuale non verificata".into(),
                "Sintesi città 🩺".into(),
                "FONTE SALVATA".into(),
                "La fonte salvata non può essere interpretata. Consulta l'originale.".into(),
                "ELABORAZIONE PRECEDENTE".into(),
                "Stato non disponibile\nAggiornamento registrato: Non disponibile".into(),
            ] },
            Fixture { attachment: long, expected: vec![
                "SINTESI SALVATA".into(), "Fonte: Fonte città 🩺.txt".into(),
                "Corrispondenza con l'originale attuale non verificata".into(),
                "Sintesi città 🩺".into(),
                "ESTRATTO SALVATO".into(),
                "Estratto abbreviato: 12000 di 12001 caratteri".into(), "🩺".repeat(12_000),
                "ELABORAZIONE PRECEDENTE".into(),
                "Stato non disponibile\nAggiornamento registrato: Non disponibile".into(),
            ] },
        ];
        fixtures.extend(unnamed);
        fixtures
    }

    #[gpui::test]
    fn document_renderings_keep_provenance_separate_without_commands_or_requests(
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
                    app.patient.attachments = ReadLoad::Ready(vec![attachment.clone()]);
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
                    assert!(!labels.iter().any(|label| matches!(
                        label.as_str(),
                        "Sintesi salvata" | "Testo salvato"
                    ) || label.starts_with("Salvata il")));
                    assert_eq!(labels, expected);
                    if !matches!(
                        source(&attachment),
                        Source::Missing
                            | Source::Present(SavedSource {
                                attachment_id_present: false,
                                ..
                            })
                    ) {
                        assert!(!labels.iter().any(|label| label == "Origine non indicata"));
                    }
                    assert!(app.form.is_none());
                    assert!(app.document_operation == DocumentOperation::Idle);
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
                    crate::test_loopback::accept(&listener).unwrap_err().kind(),
                    std::io::ErrorKind::WouldBlock
                );
            }
        }
    }

    fn assert_linked_source_without_name(file_name: &str) {
        let mut row = attachment();
        let mut saved = saved_source();
        saved["source"]["fileName"] = json!(file_name);
        row.parse_evidence_artifact_snapshot = Some(saved.to_string());
        let blocks = presentation(&row);
        assert!(matches!(
            &blocks[0],
            DetailBlock::Text { content, metadata, .. }
                if content == "Sintesi città 🩺"
                    && metadata[0] == "Fonte: questo documento (nome non disponibile)"
        ));
        assert!(blocks.iter().any(|block| matches!(
            block,
            DetailBlock::Text { title: "ESTRATTO SALVATO", content, .. }
                if content == "Estratto sintetico: valore <5; città 🩺"
        )));
        for attachment_id in [None, Some("other-synthetic-document")] {
            if let Some(id) = attachment_id {
                saved["source"]["attachmentId"] = json!(id);
            } else {
                saved["source"]
                    .as_object_mut()
                    .unwrap()
                    .remove("attachmentId");
            }
            row.parse_evidence_artifact_snapshot = Some(saved.to_string());
            let blocks = presentation(&row);
            let expected = if attachment_id.is_some() {
                "Fonte di un altro allegato: non mostrata"
            } else {
                "Origine non indicata"
            };
            assert!(matches!(
                &blocks[0], DetailBlock::Text { metadata, .. } if metadata[0] == expected
            ));
            assert!(!blocks.iter().any(|block| matches!(
                block,
                DetailBlock::Text {
                    title: "ESTRATTO SALVATO",
                    ..
                }
            )));
        }
        row.parse_evidence_artifact_snapshot = None;
        assert!(matches!(
            &presentation(&row)[0],
            DetailBlock::Text { metadata, .. } if metadata[0] == "Origine non indicata"
        ));
    }

    #[test]
    fn linked_source_with_empty_name_keeps_provenance_and_excerpt() {
        assert_linked_source_without_name("");
    }

    #[test]
    fn linked_source_with_whitespace_name_keeps_provenance_and_excerpt() {
        assert_linked_source_without_name("   ");
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
        assert!(
            matches!(&blocks[0], DetailBlock::Text { metadata, .. } if metadata[0] == "Origine non indicata")
        );
        assert!(!blocks.iter().any(|block| matches!(
            block,
            DetailBlock::Text {
                title: "ESTRATTO SALVATO",
                ..
            }
        )));
    }

    #[gpui::test]
    fn original_reads_explicitly_and_late_reads_cannot_reopen_the_view(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        let route = "GET /api/v1/network/patients/patient-a/attachments/synthetic-document";
        let mut row = attachment();
        row.patient_id = "patient-a".into();
        let wire = json!({"id":"synthetic-document","patientId":"patient-a","name":"Originale.txt","path":"originale.txt","type":"text/plain","size":5,"data":"data:text/plain;base64,cHJvdmE="});
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.selected_id = Some("patient-a".into());
            app.patient.attachments = ReadLoad::Ready(vec![row]);
        });
        assert!(
            !host
                .routes()
                .iter()
                .any(|request| request.starts_with(route))
        );
        host.plan(route).send((200, wire.clone())).unwrap();
        cx.update_window_entity(&view, |app, window, cx| {
            let focus = cx.focus_handle();
            window.focus(&focus, cx);
            app.toggle_document_original("synthetic-document", cx);
            assert!(focus.is_focused(window));
            let previous = app
                .patient
                .document_original
                .as_ref()
                .unwrap()
                .context
                .clone();
            assert!(matches!(
                app.patient.document_original.as_ref().unwrap().state,
                ReadLoad::Loading { .. }
            ));
            app.toggle_document_original("synthetic-document", cx);
            assert!(previous.check().is_err());
            assert!(focus.is_focused(window));
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.patient.document_original.is_none())
        });
        host.plan(route).send((200, wire)).unwrap();
        view.update(cx, |app, cx| {
            app.toggle_document_original("synthetic-document", cx)
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            let original = app.patient.document_original.as_ref().unwrap();
            assert!(
                matches!(&original.state, ReadLoad::Ready(Ok(documents::OriginalPreview::Text(text))) if text.as_str() == "prova")
            );
            let context = original.context.clone();
            app.section_selected(PatientSection::Diary, cx);
            assert!(app.patient.document_original.is_none());
            assert!(context.check().is_err());
            app.toggle_document_original("missing", cx);
            assert!(app.patient.document_original.is_none());
            app.disconnect(cx);
        });
        assert!(host.routes().iter().all(|request| {
            !request.starts_with("POST /api/v1/network/patients/patient-a/attachments")
        }));
    }

    #[gpui::test]
    fn image_original_uses_the_attachment_read_and_is_released_on_navigation(
        cx: &mut gpui::TestAppContext,
    ) {
        use base64::Engine;
        let mut encoded = std::io::Cursor::new(Vec::new());
        image::RgbaImage::from_pixel(2, 3, image::Rgba([10, 20, 30, 255]))
            .write_to(&mut encoded, image::ImageFormat::Png)
            .unwrap();
        let bytes = encoded.into_inner();
        let host = notes_recovery_tests::Host::new();
        let wire = json!({"id":"synthetic-document","patientId":"patient-a","name":"Originale.png","path":"originale.png","type":"image/png","size":bytes.len(),"data":format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes))});
        let row: Attachment = serde_json::from_value(wire.clone()).unwrap();
        host.plan("GET /api/v1/network/patients/patient-a/attachments/synthetic-document")
            .send((200, wire))
            .unwrap();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.selected_id = Some("patient-a".into());
            app.patient.attachments = ReadLoad::Ready(vec![row]);
            app.toggle_document_original("synthetic-document", cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            let original = app.patient.document_original.as_ref().unwrap();
            let ReadLoad::Ready(Ok(documents::OriginalPreview::Image(image))) = &original.state
            else {
                panic!("image expected")
            };
            assert_eq!(image.as_bytes(0).unwrap(), [30, 20, 10, 255].repeat(6));
            let context = original.context.clone();
            app.section_selected(PatientSection::Diary, cx);
            assert!(app.patient.document_original.is_none());
            assert!(context.check().is_err());
            app.disconnect(cx);
        });
        let routes = host.routes();
        assert_eq!(
            routes
                .iter()
                .filter(|route| route.starts_with(
                    "GET /api/v1/network/patients/patient-a/attachments/synthetic-document"
                ))
                .count(),
            1
        );
        assert!(routes.iter().all(|route| {
            !route.starts_with("POST /api/v1/network/patients/patient-a/attachments")
        }));
    }

    #[gpui::test]
    fn original_lifetime_retires_bytes_and_pending_work_in_its_own_panel(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        let wire = json!({"id":"synthetic-document","patientId":"patient-a","name":"Originale.txt","path":"originale.txt","type":"text/plain","size":5,"data":"data:text/plain;base64,cHJvdmE="});
        let row: Attachment = serde_json::from_value(wire.clone()).unwrap();
        host.plan("GET /api/v1/network/patients/patient-a/attachments/synthetic-document")
            .send((200, wire))
            .unwrap();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.selected_id = Some("patient-a".into());
            app.patient.attachments = ReadLoad::Ready(vec![row]);
            app.toggle_document_original("synthetic-document", cx);
        });
        cx.run_until_parked();
        let context = view.read_with(cx, |app, _| {
            let original = app.patient.document_original.as_ref().unwrap();
            assert!(matches!(&original.state, ReadLoad::Ready(Ok(documents::OriginalPreview::Text(text))) if text.as_str() == "prova"));
            original.context.clone()
        });
        cx.cx
            .executor()
            .advance_clock(documents::pdf::VIEW_LIFETIME + std::time::Duration::from_secs(1));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(context.check().is_err());
            assert!(matches!(&app.patient.document_original.as_ref().unwrap().state, ReadLoad::Ready(Err(text)) if text.contains("scaduta")));
            app.disconnect(cx);
        });
    }

    #[gpui::test]
    fn original_missing_or_foreign_source_never_becomes_a_readable_document(
        cx: &mut gpui::TestAppContext,
    ) {
        for (status, wire) in [
            (404, json!({"error":"Not found"})),
            (
                200,
                json!({"id":"synthetic-document","patientId":"foreign-patient","name":"Originale.txt","path":"originale.txt","type":"text/plain","size":5,"data":"data:text/plain;base64,cHJvdmE="}),
            ),
        ] {
            let host = notes_recovery_tests::Host::new();
            let mut row = attachment();
            row.patient_id = "patient-a".into();
            let (view, cx) =
                cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
            host.plan("GET /api/v1/network/patients/patient-a/attachments/synthetic-document")
                .send((status, wire))
                .unwrap();
            view.update(cx, |app, cx| {
                app.session = Some(host.session.clone());
                app.scope = Some("scope-a".into());
                app.selected_id = Some("patient-a".into());
                app.patient.attachments = ReadLoad::Ready(vec![row]);
                app.toggle_document_original("synthetic-document", cx);
            });
            cx.run_until_parked();
            view.update(cx, |app, cx| {
                assert!(
                    !app.patient
                        .document_original
                        .as_ref()
                        .is_some_and(|original| matches!(original.state, ReadLoad::Ready(Ok(_))))
                );
                app.disconnect(cx);
                assert!(app.patient.document_original.is_none());
            });
        }
    }

    #[gpui::test]
    fn document_panel_uses_loaded_rows_and_retires_on_context_changes(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.selected_id = Some("synthetic-patient".into());
            app.patient.attachments = ReadLoad::Ready(vec![attachment()]);
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
            app.patient.attachments = ReadLoad::Ready(vec![attachment()]);
            app.toggle_document_details("synthetic-document", cx);
            app.run(
                || Ok(vec![attachment()]),
                |app, result, _| app.patient.attachments = ReadLoad::from_result(result),
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
    #[gpui::test]
    fn refused_preview_explains_the_reason_and_keeps_the_original_copy_action(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        struct RefusedPreviewFixture {
            app: Entity<ClinicalApp>,
        }
        impl Render for RefusedPreviewFixture {
            fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
                self.app
                    .update(cx, |app, cx| app.document_original_view(cx))
            }
        }
        let (root, cx) = cx.add_window_view(|window, cx| RefusedPreviewFixture {
            app: cx.new(|cx| ClinicalApp::new(String::new(), window, cx)),
        });
        let view = root.read_with(cx, |root, _| root.app.clone());
        for dark in [false, true] {
            for (error, page) in [
                documents::pdf::Error::FontEncoding,
                documents::pdf::Error::ImageMask,
                documents::pdf::Error::Annotations,
                documents::pdf::Error::ImageLimit,
            ]
            .into_iter()
            .map(|error| (Some(error), 0))
            .chain([(None, 0), (None, 1)])
            {
                let reason = error
                    .map(|error| error.message())
                    .unwrap_or_else(|| PDF_FIDELITY_NOTICE.into());
                view.update(cx, |app, _| {
                    app.theme = Theme::for_dark(dark);
                    app.session = Some(host.session.clone());
                    app.selected_id = Some("synthetic-patient".into());
                    app.patient.attachments = ReadLoad::Ready(vec![attachment()]);
                    app.patient.document_original = Some(DocumentOriginal {
                        id: "synthetic-document".into(),
                        state: ReadLoad::Ready(match error {
                            Some(_) => Err(reason.clone()),
                            None => Ok(documents::OriginalPreview::Pdf(documents::pdf::Preview {
                                source: std::sync::Arc::new(zeroize::Zeroizing::new(Vec::new())),
                                image: std::sync::Arc::new(gpui::RenderImage::new([
                                    image::Frame::new(image::RgbaImage::new(2, 2)),
                                ])),
                                pages: 2,
                            })),
                        }),
                        page,
                        context: RequestContext::default(),
                    });
                });
                cx.update(|window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                });
                let warning = rendered_command::node(if error.is_some() {
                    "document-original-unavailable"
                } else {
                    "document-pdf-fidelity-notice"
                })
                .0;
                assert_eq!(
                    warning.role(),
                    if error.is_some() {
                        Role::Alert
                    } else {
                        Role::Status
                    }
                );
                assert_eq!(warning.label(), Some(reason.as_str()));
                let save = rendered_command::node("document-original-save").0;
                assert_eq!(save.label(), Some("Salva l'originale…"));
                assert!(save.supports_action(gpui::accesskit::Action::Click));
                view.update(cx, |app, _| app.selected_id = Some("other-patient".into()));
                cx.update(|window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                });
                assert!(
                    !rendered_command::node("document-original-save")
                        .0
                        .supports_action(gpui::accesskit::Action::Click)
                );
            }
        }
        host.session.lock();
        view.update(cx, |app, _| {
            app.selected_id = Some("synthetic-patient".into())
        });
        cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
        });
        assert!(
            !rendered_command::node("document-original-save")
                .0
                .supports_action(gpui::accesskit::Action::Click)
        );
        assert!(
            !host
                .routes()
                .iter()
                .any(|route| route.contains("/attachments"))
        );
    }
}
