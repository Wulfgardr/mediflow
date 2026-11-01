use super::*;
use mediflow_runtime_client::{DocumentInsightsArchive, LocalHostAccess, PreparedInsightsRemoval};
use serde_json::Value;
use std::sync::Arc;

#[cfg(test)]
macro_rules! text {
    ($($args:tt)*) => { crate::shell::rendered_command::observe_text(gpui::text!($($args)*)) };
}

#[derive(Default)]
enum Operation {
    #[default]
    Idle,
    Review(Arc<PreparedInsightsRemoval>),
    Applying,
    Unconfirmed(Arc<PreparedInsightsRemoval>),
}
pub(super) struct DocumentCuration {
    archive: ReadLoad<Arc<DocumentInsightsArchive>>,
    expanded: Option<String>,
    page: usize,
    operation: Operation,
    focus_review: bool,
    return_focus: Option<FocusHandle>,
}
impl Default for DocumentCuration {
    fn default() -> Self {
        Self {
            archive: ReadLoad::Idle,
            expanded: None,
            page: 0,
            operation: Operation::Idle,
            focus_review: false,
            return_focus: None,
        }
    }
}
impl DocumentCuration {
    pub(super) fn has_work(&self) -> bool {
        !matches!(self.operation, Operation::Idle)
    }
}

fn review_text(row: &Value) -> String {
    let mut output = format!(
        "Sintesi archiviata\n{}",
        row["summary"].as_str().unwrap_or("")
    );
    if let Some(level) = row["quality"]["level"].as_str() {
        let label = match level.trim().to_ascii_lowercase().as_str() {
            "green" => "Buona",
            "yellow" => "Da verificare",
            "red" => "Critica",
            _ => "Non indicata",
        };
        output.push_str(&format!("\n\nQualità del documento: {label}"));
    }
    if let Some(class) = row["routedClass"]["classification"].as_str() {
        let label = match class.trim().to_ascii_lowercase().as_str() {
            "identity_document" => "Documento di identità",
            "medication_prescription" => "Prescrizione farmaco",
            "specialist_service_prescription" => "Impegnativa specialistica",
            "lab_prescription" => "Impegnativa laboratorio",
            "imaging_prescription" => "Impegnativa imaging",
            "screening_prescription_or_invitation" => "Screening/invito",
            "specialist_report" => "Referto specialistico",
            "lab_report" => "Referto di laboratorio",
            "imaging_report" => "Referto imaging",
            "exemption_document" => "Esenzione",
            "prosthetic_prescription" => "Prescrizione protesica",
            "administrative" => "Amministrativo",
            "mute_or_scanned" => "Scansione/muto",
            _ => "Da classificare",
        };
        output.push_str(&format!("\n\nClasse del documento: {label}"));
    }
    if row["routedClass"]["synthesis"]["kind"] == "deterministic" {
        output.push_str("\n\nSintesi senza modello");
        if let Some(reason) = row["routedClass"]["synthesis"]["rationale"].as_str() {
            output.push('\n');
            output.push_str(reason);
        }
    }
    if let Some(codes) = row["autofill"]["appliedDiagnoses"].as_array()
        && !codes.is_empty()
    {
        output.push_str("\n\nDiagnosi aggiunte in precedenza alla scheda\n");
        for code in codes {
            if let Some(text) = code.as_str() {
                output.push_str(text);
                output.push('\n');
            } else {
                output.push_str("Dato storico non leggibile.\n");
            }
        }
    }
    if let Some(data) = row.get("extractedData") {
        for (key, label) in [
            ("diagnosis", "Diagnosi estratta"),
            ("medications", "Terapie estratte"),
            ("diagnoses", "Diagnosi estratte"),
            ("labs", "Risultati estratti"),
        ] {
            if let Some(value) = data.get(key) {
                output.push_str(&format!("\n\n{label}\n"));
                match value {
                    Value::String(text) => output.push_str(text),
                    Value::Array(items) => {
                        for item in items {
                            if let Some(text) = item.as_str() {
                                output.push_str(text);
                            } else {
                                for key in ["system", "code", "description", "evidence"] {
                                    if let Some(text) = item[key].as_str() {
                                        output.push_str(text);
                                        output.push(' ');
                                    }
                                }
                            }
                            output.push('\n');
                        }
                    }
                    Value::Object(items) => {
                        for (name, value) in items {
                            if let Some(text) = value.as_str() {
                                output.push_str(name);
                                output.push_str(": ");
                                output.push_str(text);
                                output.push('\n');
                            }
                        }
                    }
                    _ => output.push_str("Contenuto non leggibile."),
                }
            }
        }
    }
    if let Some(reason) = row["quality"]["reason"].as_str() {
        output.push_str("\n\nQualità del documento\n");
        output.push_str(reason);
    }
    if let Some(text) = row["rawMarkdown"].as_str().filter(|s| !s.is_empty()) {
        output.push_str("\n\nTesto sorgente archiviato\n");
        output.push_str(text);
    } else {
        output.push_str("\n\nTesto sorgente archiviato non disponibile.");
    }
    output
}

impl ClinicalApp {
    pub(super) fn local_work_pending(&self) -> bool {
        self.local_host.has_work() || self.patient.document_curation.has_work()
    }
    fn read_document_archive(&mut self, cx: &mut Context<Self>) {
        if self.local_work_pending()
            || self.form.is_some()
            || self.document_operation != DocumentOperation::Idle
            || matches!(
                self.patient.document_curation.archive,
                ReadLoad::Loading { .. }
            )
        {
            return;
        }
        let (Some(access), Some(scope), Some(patient)) = (
            self.local_host.access(),
            self.scope.clone(),
            self.selected_id.clone(),
        ) else {
            return;
        };
        self.patient.document_curation.archive = ReadLoad::loading();
        self.patient.document_curation.expanded = None;
        self.run(
            move || {
                access
                    .read_document_insights(&scope, &patient)
                    .map(Arc::new)
            },
            |this, result, _| {
                this.patient.document_curation.archive = ReadLoad::from_result(result)
            },
            cx,
        );
    }
    fn review_insights_removal(
        &mut self,
        id: Option<&str>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.local_work_pending() || self.form.is_some() {
            return;
        }
        let (Some(access), Some(archive)) = (
            self.local_host.access(),
            self.patient.document_curation.archive.ready().cloned(),
        ) else {
            return;
        };
        match access.prepare_insights_removal(archive, id) {
            Ok(command) => {
                self.patient.document_curation.operation = Operation::Review(Arc::new(command));
                self.patient.document_curation.return_focus = window.focused(cx);
                self.patient.document_curation.focus_review = true;
                self.message = None;
            }
            Err(error) => self.message = Some((ui_error(error), true)),
        }
        cx.notify();
    }
    fn apply_insights_removal(&mut self, verify: bool, cx: &mut Context<Self>) {
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.run_insights_removal(access, verify, cx);
    }
    fn run_insights_removal(
        &mut self,
        access: Arc<LocalHostAccess>,
        verify: bool,
        cx: &mut Context<Self>,
    ) {
        let command = match &self.patient.document_curation.operation {
            Operation::Review(command) if !verify => command.clone(),
            Operation::Unconfirmed(command) if verify => command.clone(),
            _ => return,
        };
        if self.selected_id.as_deref() != Some(command.patient_id())
            || self.scope.as_deref() != Some(command.ambulatory_id())
        {
            self.patient.document_curation = DocumentCuration::default();
            self.message = Some((
                "Il contesto della scheda è cambiato. Rileggi le sintesi prima di rimuoverle."
                    .into(),
                true,
            ));
            cx.notify();
            return;
        }
        self.patient.document_curation.operation = Operation::Applying;
        let pending = command.clone();
        self.run(move || if verify { access.verify_insights_removal(&command) } else { access.remove_document_insights(&command) }, move |this,result,cx| {
            match result {
                Ok(Some(archive)) => { this.patient.document_curation.archive = ReadLoad::Ready(Arc::new(archive)); this.patient.document_curation.expanded = None; this.patient.document_curation.page = 0; this.patient.document_curation.operation = Operation::Idle; this.focus_after_render = true; this.message = Some(("Rimozione verificata nell’archivio. Gli allegati restano disponibili.".into(),false)); cx.notify(); },
                Err(error) if !verify && !error.is_indeterminate() => { this.patient.document_curation.operation = Operation::Idle; this.focus_after_render = true; this.message = Some((ui_error(error),true)); },
                _ => { this.patient.document_curation.operation = Operation::Unconfirmed(pending); this.patient.document_curation.focus_review = true; this.message = Some(("L’esito della rimozione non è verificato. Controlla l’archivio prima di altre modifiche.".into(),true)); },
            }
        },cx);
    }
    fn close_unverified_archive(&mut self, cx: &mut Context<Self>) {
        if !matches!(
            self.patient.document_curation.operation,
            Operation::Unconfirmed(_)
        ) {
            return;
        }
        self.patient.document_curation = DocumentCuration::default();
        self.focus_after_render = true;
        self.message = Some(("La rimozione precedente non è stata verificata. Rileggi l’archivio prima di preparare altre modifiche.".into(),true));
        cx.notify();
    }
    pub(super) fn prepare_document_curation_render(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if std::mem::take(&mut self.patient.document_curation.focus_review) {
            window.focus(&self.form_actions[0].focus, cx);
            self.form_actions[0].scroll_to(window, cx);
        }
    }
    pub(super) fn cancel_document_curation_review(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !matches!(
            self.patient.document_curation.operation,
            Operation::Review(_)
        ) {
            return false;
        }
        self.patient.document_curation.operation = Operation::Idle;
        if let Some(focus) = self.patient.document_curation.return_focus.take() {
            window.focus(&focus, cx);
        }
        cx.notify();
        true
    }
    pub(super) fn document_curation_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let area = &self.patient.document_curation;
        let can_read = self.local_host.access().is_some()
            && !self.local_work_pending()
            && self.form.is_none()
            && self.document_operation == DocumentOperation::Idle
            && !matches!(area.archive, ReadLoad::Loading { .. });
        let mut view = div().min_w_0().max_w_full().flex().flex_col().gap(px(12.))
            .child(heading("document-curation-heading", "Sintesi archiviate", theme))
            .child(text!("Sintesi salvate in precedenza. Il testo sorgente archiviato può differire dall’originale disponibile oggi. Il modello usato per ciascuna sintesi non è registrato nell’archivio."))
            .child(button("document-curation-read", "Leggi l’archivio delle sintesi", theme, false, can_read)
                .when(can_read, |el| el.on_click(cx.listener(|this,_,_,cx|this.read_document_archive(cx)))))
            .when(self.local_host.access().is_none(), |el|el.child(text!("Per leggere e gestire le sintesi apri prima Gestione locale in Impostazioni → Funzioni AI.")));
        match &area.archive {
            ReadLoad::Loading { .. } => {
                view = view.child(text!("Lettura delle sintesi archiviate…"))
            }
            ReadLoad::Failed(message) => {
                view = view.child(notice(
                    "document-curation-error",
                    ui_error(*message),
                    theme,
                    true,
                ))
            }
            _ => {}
        }
        if let Some(archive) = area.archive.ready() {
            if archive.rows().is_empty() {
                view = view.child(text!("Nessuna sintesi archiviata."));
            } else {
                view = view.child(
                    button(
                        "document-curation-clear",
                        "Svuota le sintesi archiviate…",
                        theme,
                        false,
                        can_read,
                    )
                    .when(can_read, |el| {
                        el.on_click(cx.listener(|this, _, window, cx| {
                            this.review_insights_removal(None, window, cx)
                        }))
                    }),
                );
            }
            for row in archive.rows() {
                let id = row["id"].as_str().unwrap().to_owned();
                let remove_id = id.clone();
                let expanded = area.expanded.as_deref() == Some(&id);
                let attachment = row["attachmentId"].as_str().filter(|id| {
                    self.patient
                        .attachments
                        .ready()
                        .is_some_and(|rows| rows.iter().any(|r| r.id == *id))
                });
                let mut entry = div()
                    .min_w_0()
                    .max_w_full()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .border_b_1()
                    .border_color(theme.rule)
                    .py(px(12.))
                    .child(text!(row["fileName"].as_str().unwrap().to_owned()))
                    .child(text!(format!(
                        "Archiviata il {}",
                        display_date(row["date"].as_str())
                    )))
                    .child(
                        button(
                            format!("document-curation-open-{id}"),
                            if expanded {
                                "Chiudi estratti"
                            } else {
                                "Rivedi gli estratti archiviati"
                            },
                            theme,
                            false,
                            !area.has_work(),
                        )
                        .aria_expanded(expanded)
                        .when(!area.has_work(), |el| {
                            el.on_click(cx.listener(move |this, _, _, cx| {
                                let area = &mut this.patient.document_curation;
                                area.expanded = if expanded { None } else { Some(id.clone()) };
                                area.page = 0;
                                cx.notify();
                            }))
                        }),
                    );
                if expanded {
                    let content = review_text(row);
                    let (text, page_count) =
                        documents::text_window(&content, area.page).unwrap_or(("", 1));
                    entry = entry.child(div().min_w_0().max_w_full().child(text!(text.to_owned())));
                    for (offset, label) in [(-1, "Testo precedente"), (1, "Testo successivo")] {
                        let target = area
                            .page
                            .checked_add_signed(offset)
                            .filter(|p| *p < page_count);
                        entry = entry.child(
                            button(
                                format!("document-curation-page-{offset}"),
                                label,
                                theme,
                                false,
                                target.is_some(),
                            )
                            .when_some(target, |el, target| {
                                el.on_click(cx.listener(move |this, _, _, cx| {
                                    this.patient.document_curation.page = target;
                                    cx.notify();
                                }))
                            }),
                        );
                    }
                    entry = entry.child(text!(format!("Testo {} di {page_count}", area.page + 1)));
                    if let Some(source_id) = attachment {
                        let source_id = source_id.to_owned();
                        entry = entry.child(
                            button(
                                "document-curation-original",
                                "Apri l’originale nell’elenco documenti",
                                theme,
                                false,
                                !area.has_work(),
                            )
                            .when(!area.has_work(), |el| {
                                el.on_click(cx.listener(move |this, _, _, cx| {
                                    this.toggle_document_original(&source_id, cx)
                                }))
                            }),
                        );
                    } else {
                        entry=entry.child(text!("Originale collegato non disponibile. Il nome del file non prova la corrispondenza con un allegato."));
                    }
                    entry = entry.child(
                        button(
                            format!("document-curation-remove-{remove_id}"),
                            "Rimuovi questa sintesi…",
                            theme,
                            false,
                            can_read,
                        )
                        .when(can_read, |el| {
                            el.on_click(cx.listener(move |this, _, window, cx| {
                                this.review_insights_removal(Some(&remove_id), window, cx)
                            }))
                        }),
                    );
                }
                view = view.child(entry);
            }
        }
        match &area.operation {
            Operation::Review(command) => {
                view=view.child(heading("document-curation-confirm-heading","Rimuovere le sintesi selezionate?",theme))
                    .when_some(self.patient.detail.ready(),|el,patient|el.child(text!(format!("Scheda: {}",crate::title::TitleText::name(patient.display_name()).text()))))
                    .children(command.removed().map(|row|text!(row["fileName"].as_str().unwrap_or("Documento").to_owned())))
                    .child(text!("Le sintesi selezionate saranno rimosse dall’archivio. Gli allegati della cartella restano disponibili."))
                    .child(self.form_actions[0].attach(button("document-curation-confirm","Conferma rimozione",theme,true,self.local_host.access().is_some())).on_click(cx.listener(|this,_,_,cx|this.apply_insights_removal(false,cx))))
                    .child(self.form_actions[1].attach(button("document-curation-cancel","Annulla",theme,false,true)).on_click(cx.listener(|this,_,window,cx|{this.cancel_document_curation_review(window,cx);})));
            }
            Operation::Applying => view = view.child(text!("Verifica della rimozione in corso…")),
            Operation::Unconfirmed(_) => {
                view = view
                    .child(
                        self.form_actions[0]
                            .attach(button(
                                "document-curation-verify",
                                "Verifica l’archivio senza ripetere la rimozione",
                                theme,
                                true,
                                true,
                            ))
                            .on_click(
                                cx.listener(|this, _, _, cx| this.apply_insights_removal(true, cx)),
                            ),
                    )
                    .child(
                        self.form_actions[1]
                            .attach(button(
                                "document-curation-close-unknown",
                                "Chiudi e rileggi l’archivio",
                                theme,
                                false,
                                true,
                            ))
                            .on_click(
                                cx.listener(|this, _, _, cx| this.close_unverified_archive(cx)),
                            ),
                    )
            }
            Operation::Idle => {}
        }
        view
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn row() -> Value {
        json!({"id":"insight-a","fileName":"Foto sintetica.jpg","date":"2026-11-01T12:00:00Z","summary":"Sintesi senza modifiche. Caffè e perché. 🩺","rawMarkdown":"Fonte immutata: TEST SINTETICO.","extractedData":{"diagnoses":[{"system":"ICD-10","code":"Z00","description":"Descrizione sintetica invariata"}],"medications":["Terapia sintetica invariata"],"labs":{"Valore sintetico":"42 unità"}}})
    }
    fn profile(version: u64, rows: Value) -> Value {
        json!({"id":"patient-a","ambulatoryId":"scope-a","deletedAt":null,"version":version,"documentInsights":rows.to_string()})
    }
    fn prepare(
        app: &mut ClinicalApp,
        host: &notes_recovery_tests::Host,
        archive: Arc<DocumentInsightsArchive>,
    ) {
        app.session = Some(host.session.clone());
        app.scope = Some("scope-a".into());
        app.install_patient(serde_json::from_value(json!({"id":"patient-a","firstName":"Elena","lastName":"Esempio","taxCode":"SYNTHETIC","version":3})).unwrap());
        app.patient_section = PatientSection::Documents;
        app.patient.attachments = ReadLoad::Ready(vec![]);
        app.patient.document_curation.archive = ReadLoad::Ready(archive);
        app.patient.document_curation.expanded = Some("insight-a".into());
    }
    #[test]
    fn reading_preserves_archived_words_and_every_text_window() {
        let mut entry = row();
        entry["quality"] = json!({"level":"red","reason":"Da controllare sulla fonte sintetica"});
        entry["routedClass"] = json!({"classification":"lab_report","synthesis":{"kind":"deterministic","rationale":"Ragione storica sintetica"}});
        entry["autofill"] = json!({"appliedDiagnoses":["Z00"]});
        let source = format!("{}ULTIMA PAROLA 🩺", "à".repeat(30_000));
        entry["rawMarkdown"] = json!(source);
        let content = review_text(&entry);
        assert!(content.contains("Descrizione sintetica invariata"));
        assert!(content.contains("42 unità"));
        assert!(content.contains("Qualità del documento: Critica"));
        assert!(content.contains("Referto di laboratorio"));
        assert!(content.contains("Sintesi senza modello"));
        assert!(content.contains("Diagnosi aggiunte in precedenza alla scheda\nZ00"));
        assert!(content.ends_with(&source));
        let (_, count) = documents::text_window(&content, 0).unwrap();
        let reconstructed = (0..count)
            .map(|page| documents::text_window(&content, page).unwrap().0)
            .collect::<String>();
        assert_eq!(reconstructed, content);
    }
    #[gpui::test]
    fn archive_review_cancel_and_uncertain_removal_never_send_twice_or_report_unverified_success(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        let access = Arc::new(
            host.session
                .authenticate_local_host(
                    "Synthetic scales fixture passphrase",
                    mediflow_runtime_client::RetirementNotice::new(None),
                )
                .unwrap(),
        );
        host.plan("GET /api/patients/patient-a")
            .send((200, profile(3, json!([row()]))))
            .unwrap();
        let archive = Arc::new(
            access
                .read_document_insights("scope-a", "patient-a")
                .unwrap(),
        );
        let command = Arc::new(
            access
                .prepare_insights_removal(archive.clone(), Some("insight-a"))
                .unwrap(),
        );
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            prepare(app, &host, archive.clone());
            app.patient.document_curation.operation = Operation::Review(command.clone());
            app.navigate(Area::Agenda, cx);
            assert_eq!(app.area, Area::Patients);
            assert!(app.local_work_pending());
            app.apply_insights_removal(false, cx);
        });
        cx.simulate_resize(gpui::size(px(800.), px(840.)));
        for dark in [false, true] {
            view.update(cx, |app, _| {
                app.dark_override = Some(dark);
                app.privacy_shield = false;
            });
            let mut labels = Vec::new();
            let mut commands = Vec::new();
            for offset in [0., -300., -600., -900.] {
                view.update(cx, |app, cx| {
                    app.profile_scroll
                        .set_offset(gpui::point(px(0.), px(offset)));
                    cx.notify();
                });
                rendered_command::take_text_nodes();
                for _ in 0..8 {
                    let mut callbacks = 0;
                    commands.extend(rendered_command::button_ids(|| {
                        callbacks = cx.update(|window, cx| {
                            window.activate_window();
                            window.refresh();
                            window.draw(cx).clear(cx);
                            window.simulate_next_frame(cx)
                        });
                    }));
                    cx.run_until_parked();
                    if callbacks == 0 {
                        break;
                    }
                }
                view.read_with(cx, |app, _| {
                    assert!(app.session.is_some());
                    assert_eq!(app.patient_section, PatientSection::Documents);
                    assert!(!app.directory);
                    assert!(!app.show_other);
                    assert!(app.patient.document_curation.archive.ready().is_some());
                    assert_eq!(
                        app.patient.document_curation.expanded.as_deref(),
                        Some("insight-a")
                    );
                });
                labels.extend(
                    rendered_command::take_text_nodes()
                        .iter()
                        .filter_map(|(_, node)| node.value().map(str::to_owned)),
                );
            }
            assert!(
                labels
                    .iter()
                    .any(|label| label.contains("Sintesi senza modifiche. Caffè e perché. 🩺")),
                "Testi presenti: {labels:?}, comandi: {commands:?}"
            );
            assert!(
                labels
                    .iter()
                    .any(|label| label.contains("Fonte immutata: TEST SINTETICO."))
            );
            assert!(
                labels
                    .iter()
                    .any(|label| label.contains("Originale collegato non disponibile"))
            );
        }
        assert!(
            !host
                .routes()
                .iter()
                .any(|r| r.starts_with("PUT /api/patients"))
        );
        cx.update_window_entity(&view, |app, window, cx| {
            assert!(app.cancel_document_curation_review(window, cx))
        });
        view.read_with(cx, |app, _| assert!(!app.local_work_pending()));
        view.update(cx, |app, cx| {
            app.patient.document_curation.operation = Operation::Review(command.clone());
            app.selected_id = Some("patient-b".into());
            app.run_insights_removal(access.clone(), false, cx);
            assert!(app.message.as_ref().unwrap().1);
            assert!(!app.local_work_pending());
            prepare(app, &host, archive.clone());
        });
        host.plan("GET /api/patients/patient-a")
            .send((200, profile(3, json!([row()]))))
            .unwrap();
        host.plan("PUT /api/patients/patient-a")
            .send((200, json!({"success":true})))
            .unwrap();
        host.plan("GET /api/patients/patient-a")
            .send((503, json!({"error":"synthetic unavailable"})))
            .unwrap();
        view.update(cx, |app, cx| {
            app.patient.document_curation.operation = Operation::Review(command.clone());
            app.run_insights_removal(access.clone(), false, cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(matches!(
                app.patient.document_curation.operation,
                Operation::Unconfirmed(_)
            ));
            assert!(app.message.as_ref().unwrap().1);
            assert!(app.verified.is_none());
            app.run_insights_removal(access.clone(), false, cx);
        });
        host.plan("GET /api/patients/patient-a")
            .send((200, profile(4, json!([]))))
            .unwrap();
        view.update(cx, |app, cx| {
            app.run_insights_removal(access.clone(), true, cx)
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(!app.local_work_pending());
            assert!(
                app.patient
                    .document_curation
                    .archive
                    .ready()
                    .unwrap()
                    .rows()
                    .is_empty()
            );
            assert!(!app.message.as_ref().unwrap().1);
            app.patient.document_curation.operation = Operation::Unconfirmed(command.clone());
            app.close_unverified_archive(cx);
            assert!(!app.local_work_pending());
            assert!(app.patient.document_curation.archive.ready().is_none());
            assert!(app.message.as_ref().unwrap().1);
            app.disconnect(cx);
            assert!(app.patient.document_curation.archive.ready().is_none());
        });
        assert_eq!(
            host.routes()
                .iter()
                .filter(|r| r.starts_with("PUT /api/patients/patient-a"))
                .count(),
            1
        );
    }
}
