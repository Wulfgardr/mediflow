use super::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum DocumentOperation {
    #[default]
    Idle,
    Selecting,
    CheckingImport,
    ChoosingDestination,
    ReadingCopy,
    WritingCopy,
}

impl DocumentOperation {
    fn message(self) -> &'static str {
        match self {
            Self::Idle => "",
            Self::Selecting => "Scelta del documento…",
            Self::CheckingImport => "Verifica del file e dei duplicati…",
            Self::ChoosingDestination => "Scelta della destinazione della copia…",
            Self::ReadingCopy => "Lettura dell’originale…",
            Self::WritingCopy => "Salvataggio della copia…",
        }
    }
}

impl ClinicalApp {
    pub(super) fn documents_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let writable = self.form.is_none()
            && self.document_operation == DocumentOperation::Idle
            && self.patient.attachments.ready().is_some()
            && self.can_write(FormKind::Document)
            && self
                .patient
                .detail
                .ready()
                .is_some_and(|patient| !patient.is_archived && patient.deleted_at.is_none());
        div().min_w_0().max_w_full().flex().flex_col().gap(px(16.))
            .child(div().flex().flex_wrap().items_center().justify_between().gap(px(12.))
                .child(heading("clinical-workspace-documents-heading", "Documenti", theme))
                .child(button("clinical-workspace-new-document", "Aggiungi documento…", theme, true, writable)
                    .when(writable, |el| el.on_click(cx.listener(|this, _, _, cx| this.pick_document(cx))))))
            .child(div().text_color(theme.secondary).child(text!("Prima del salvataggio puoi annullare la copia cambiando scheda o bloccando la sessione. Una copia già avviata può completarsi anche dopo il blocco.")))
            .when(self.document_operation != DocumentOperation::Idle, |el| el.child(notice("clinical-workspace-document-operation", self.document_operation.message(), theme, false)))
            .when_some(self.patient.attachments.state(ReadObject::Documenti), |el, state| el.child(self.render_read_state("clinical-workspace-attachments-state", state, cx)))
            .when(self.patient.attachments.ready().is_some_and(Vec::is_empty), |el| el.child(text!("Nessun documento presente nella scheda.")))
            .children(self.patient.attachments.ready().into_iter().flatten().map(|row| {
                let name = if row.locked_fields.iter().any(|field| field == "name") { "Nome del documento non leggibile".into() } else { row.name.clone() };
                let can_open = self.document_operation == DocumentOperation::Idle && self.form.is_none();
                let available = can_open && !self.copy_state.is_some_and(documents::CopyState::is_writing) && documents::original_readable(row);
                let details_open = self.patient.document_details_id.as_deref() == Some(row.id.as_str());
                let details_id = row.id.clone();
                let id = row.id.clone();
                div().id(SharedString::from(format!("clinical-workspace-document-{id}")))
                    .min_w_0().max_w_full()
                    .border_b_1().border_color(theme.rule).py(px(16.)).flex().flex_col().gap(px(8.))
                    .child(div().min_w_0().max_w_full().type_role(theme, crate::theme::TextRole::Strong).child(crate::title::title(crate::title::TitleText::name(name), theme)))
                    .child(div().min_w_0().max_w_full().type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary)
                        .child(text!(format!("{} · {} · {}", row.mime_type, format_size(row.size), display_date(row.created_at.as_deref())))))
                    .child(div().min_w_0().max_w_full().flex().flex_wrap().gap(px(8.))
                        .child(button(format!("clinical-workspace-document-details-{id}"), if details_open { "Chiudi sintesi e fonte" } else { "Sintesi e fonte" }, theme, false, can_open)
                            .aria_expanded(details_open)
                            .when(can_open, |el| el.on_click(cx.listener(move |this, _, _, cx| this.toggle_document_details(&details_id, cx)))))
                        .child(button(format!("clinical-workspace-download-document-{id}"), "Salva una copia…", theme, false, available)
                            .when(available, |el| el.on_click(cx.listener(move |this, _, _, cx| this.download_document(&id, cx))))))
                    .when(details_open, |el| el.child(self.document_details_view(row, cx)))
            }))
            .child(div().text_color(theme.secondary).child(text!("Ogni caricamento richiede revisione e conferma. Il limite per file è 10 MiB. Le copie vengono salvate soltanto nella destinazione che scegli.")))
            .child(notice("clinical-workspace-documents-native-limits", "Anteprima dell’originale, modifica e cancellazione non ancora disponibili in questa app.", theme, false))
    }

    pub(super) fn pick_document(&mut self, cx: &mut Context<Self>) {
        if self.document_operation != DocumentOperation::Idle
            || self.form.is_some()
            || !self.can_write(FormKind::Document)
            || !self
                .patient
                .detail
                .ready()
                .is_some_and(|patient| !patient.is_archived && patient.deleted_at.is_none())
        {
            return;
        }
        self.document_operation = DocumentOperation::Selecting;
        self.verified = None;
        self.message = None;
        let epoch = self.epoch;
        let authority = self.account_profile.generation;
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Scegli documento".into()),
        });
        cx.spawn(async move |this, cx| {
            let result = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if !this.accept_document_picker(epoch, authority, cx) { return; }
                match result {
                    Ok(Ok(Some(paths))) if paths.len() == 1 => {
                        let path = paths.into_iter().next().expect("one selected path");
                        this.run(move || Ok(documents::read_selected_file(&path)), Self::receive_document_file, cx);
                    }
                    Ok(Ok(None)) => this.document_operation = DocumentOperation::Idle,
                    _ => {
                        this.document_operation = DocumentOperation::Idle;
                        this.message = Some(("Il selettore di file non è disponibile. Nessun file è stato inviato. Riprova la selezione.".into(), true));
                    }
                }
                cx.notify();
            });
        }).detach();
        cx.notify();
    }

    fn receive_document_file(
        &mut self,
        result: Result<Result<documents::Upload, documents::DocumentError>, RuntimeError>,
        cx: &mut Context<Self>,
    ) {
        let upload = match result {
            Ok(Ok(upload)) => upload,
            other => {
                self.receive_document_upload(other, cx);
                return;
            }
        };
        let (Some(session), Some(scope), Some(patient)) = (
            self.session.clone(),
            self.scope.clone(),
            self.selected_id.clone(),
        ) else {
            self.document_operation = DocumentOperation::Idle;
            return;
        };
        self.document_operation = DocumentOperation::CheckingImport;
        self.run(move || {
            let rows = session.list_attachments(&scope, &patient)?;
            let admission = documents::admit_import(upload, &rows, |id| session.read_attachment(&scope, &patient, id))?;
            Ok((admission, rows))
        }, |this, result, cx| {
            match result {
                Ok((documents::ImportAdmission::New(upload), rows)) => {
                    this.patient.attachments = ReadLoad::Ready(rows);
                    this.receive_document_upload(Ok(Ok(upload)), cx);
                }
                Ok((documents::ImportAdmission::Duplicate { existing_id }, rows)) => {
                        this.patient.attachments = ReadLoad::Ready(rows);
                    this.document_operation = DocumentOperation::Idle;
                    this.patient.document_details_id = Some(existing_id);
                    this.message = Some(("Questo documento è già presente nella scheda. Non è stato importato di nuovo.".into(), false));
                }
                Err(error) => {
                    this.document_operation = DocumentOperation::Idle;
                    this.message = Some((format!("{} Il controllo dei duplicati non è riuscito. Il file non è stato inviato.", ui_error(error)), true));
                }
            }
        }, cx);
    }

    pub(super) fn receive_document_upload(
        &mut self,
        result: Result<Result<documents::Upload, documents::DocumentError>, RuntimeError>,
        _cx: &mut Context<Self>,
    ) {
        self.document_operation = DocumentOperation::Idle;
        match result {
            Ok(Ok(upload)) if self.form.is_none() && self.can_write(FormKind::Document) => {
                self.form = Some(Form {
                    kind: FormKind::Document,
                    fields: vec![],
                    upload: Some(upload),
                    edit: None,
                    patient_original: None,
                    created_id: None,
                    therapy: None,
                    scale: None,
                    state: FormState::Draft,
                    _subscriptions: vec![],
                });
                self.show_sections = false;
                self.patient_section = PatientSection::Documents;
                self.directory = false;
                self.verified = None;
                self.focus_after_render = true;
                self.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
            }
            Ok(Ok(_)) => {
                self.message = Some((
                    "È già aperta una bozza o l'accesso è cambiato. Il file non è stato aggiunto."
                        .into(),
                    false,
                ))
            }
            Ok(Err(error)) => self.message = Some((error.to_string(), true)),
            Err(error) => self.message = Some((ui_error(error), true)),
        }
    }

    pub(super) fn accept_document_picker(
        &mut self,
        epoch: u64,
        authority: u64,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.account_profile.generation != authority {
            return false;
        }
        if let Some(error) = self
            .session
            .as_ref()
            .and_then(RuntimeSession::retirement_error)
        {
            self.save_error(error, cx);
            return false;
        }
        self.epoch == epoch && self.session.is_some()
    }

    pub(super) fn run_document_copy(
        &mut self,
        operation: impl FnOnce() -> Result<(), documents::DocumentError> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        let epoch = self.epoch;
        let authority = self.account_profile.generation;
        self.document_operation = DocumentOperation::WritingCopy;
        self.copy_state = Some(documents::CopyState::Writing);
        let task = cx.background_executor().spawn(async move { operation() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                this.copy_state = Some(documents::CopyState::Finished(result));
                if this.epoch == epoch && this.account_profile.generation == authority {
                    this.document_operation = DocumentOperation::Idle;
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    pub(super) fn download_document(&mut self, document_id: &str, cx: &mut Context<Self>) {
        if self.document_operation != DocumentOperation::Idle
            || self.form.is_some()
            || self
                .copy_state
                .is_some_and(documents::CopyState::is_writing)
        {
            return;
        }
        let Some(row) = self
            .patient
            .attachments
            .ready()
            .into_iter()
            .flatten()
            .find(|row| row.id == document_id && documents::original_readable(row))
        else {
            return;
        };
        let id = document_id.to_owned();
        let suggested = documents::suggested_name(&row.name);
        let directory = documents::initial_save_directory();
        // The native picker runs before any content read. Its detached future
        // retains only the identifier, never an already-decrypted document.
        let chosen = cx.prompt_for_new_path(&directory, Some(&suggested));
        let epoch = self.epoch;
        let authority = self.account_profile.generation;
        self.document_operation = DocumentOperation::ChoosingDestination;
        self.message = Some(("Scegli dove salvare la copia del documento.".into(), false));
        cx.spawn(async move |this, cx| {
            let result = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if !this.accept_document_picker(epoch, authority, cx) { return; }
                match result {
                    Ok(Ok(Some(path))) => {
                        let (Some(session), Some(scope), Some(patient_id)) = (this.session.clone(), this.scope.clone(), this.selected_id.clone()) else { return; };
                        let context = session.request_context();
                        this.document_operation = DocumentOperation::ReadingCopy;
                        this.copy_state = Some(documents::CopyState::Reading);
                        this.message = None;
                        this.run(move || {
                            context.check()?;
                            let attachment = session.read_attachment(&scope, &patient_id, &id)?;
                            Ok(documents::decode_attachment(&attachment).map(|bytes| (context, path, bytes)))
                        }, |this, result, cx| {
                            match result {
                                Ok(Ok((context, path, bytes))) => match documents::admit_download(&context, path, bytes) {
                                    Ok(download) => this.run_document_copy(move || download.write(), cx),
                                    Err(error) => {
                                        this.copy_state = Some(documents::CopyState::Withdrawn);
                                        this.document_operation = DocumentOperation::Idle;
                                        if error.retires_session() { this.save_error(error, cx); }
                                    }
                                },
                                Ok(Err(error)) => {
                                    this.copy_state = None;
                                    this.document_operation = DocumentOperation::Idle;
                                    this.message = Some((error.to_string(), true));
                                }
                                Err(error) => {
                                    this.copy_state = Some(documents::CopyState::Withdrawn);
                                    this.document_operation = DocumentOperation::Idle;
                                    this.message = Some((ui_error(error), true));
                                }
                            }
                        }, cx);
                    }
                    Ok(Ok(None)) => { this.document_operation = DocumentOperation::Idle; this.message = None; }
                    _ => {
                        this.document_operation = DocumentOperation::Idle;
                        this.message = Some(("La scelta della destinazione non è disponibile. Nessuna copia è stata creata.".into(), true));
                    }
                }
                cx.notify();
            });
        }).detach();
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    const LIST: &str = "GET /api/v1/network/patients/patient-a/attachments";
    const DETAIL: &str = "GET /api/v1/network/patients/patient-a/attachments/file-a";
    const CREATE: &str = "POST /api/v1/network/patients/patient-a/attachments";

    fn upload() -> Upload {
        Upload {
            name: "nuovo-nome.txt".into(),
            mime_type: "text/plain".into(),
            bytes: std::sync::Arc::new(Zeroizing::new(b"prova".to_vec())),
        }
    }
    fn summary() -> Value {
        json!({"id":"file-a", "patientId":"patient-a", "name":"referto.txt", "path":"referto.txt", "type":"text/plain", "size":5})
    }
    fn prepare(app: &mut ClinicalApp, host: &notes_recovery_tests::Host) {
        app.session = Some(host.session.clone());
        app.scope = Some("scope-a".into());
        app.install_patient(
            serde_json::from_value(
                json!({"id":"patient-a", "firstName":"Elena", "lastName":"Esempio", "taxCode":"SYNTHETIC", "version":1}),
            )
            .unwrap(),
        );
        app.patient.attachments = ReadLoad::Ready(vec![]);
        app.document_operation = DocumentOperation::Selecting;
    }

    #[gpui::test]
    fn duplicate_native_import_rereads_the_existing_source_without_a_post(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        host.plan(LIST).send((200, json!([summary()]))).unwrap();
        let mut detail = summary();
        detail["data"] = json!("data:text/plain;base64,cHJvdmE=");
        host.plan(DETAIL).send((200, detail)).unwrap();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            prepare(app, &host);
            app.receive_document_file(Ok(Ok(upload())), cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.form.is_none());
            assert!(app.verified.is_none());
            assert_eq!(app.document_operation, DocumentOperation::Idle);
            assert_eq!(app.patient.document_details_id.as_deref(), Some("file-a"));
            assert_eq!(app.patient.attachments.ready().unwrap().len(), 1);
            assert!(app.message.as_ref().unwrap().0.contains("già presente"));
        });
        assert!(!host.routes().iter().any(|route| route.starts_with(CREATE)));
    }

    #[gpui::test]
    fn source_disappearing_during_duplicate_check_keeps_the_import_unsent(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        host.plan(LIST).send((200, json!([summary()]))).unwrap();
        host.plan(DETAIL)
            .send((404, json!({"error":"Not found"})))
            .unwrap();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            prepare(app, &host);
            app.receive_document_file(Ok(Ok(upload())), cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.form.is_none() && app.verified.is_none());
            assert!(
                app.message
                    .as_ref()
                    .unwrap()
                    .0
                    .contains("non è stato inviato")
            );
            assert_eq!(app.document_operation, DocumentOperation::Idle);
        });
        assert!(!host.routes().iter().any(|route| route.starts_with(CREATE)));
    }

    #[gpui::test]
    fn acknowledged_import_without_readback_preserves_the_file_and_cannot_be_confirmed_again(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        host.plan(LIST).send((200, json!([]))).unwrap();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            prepare(app, &host);
            app.receive_document_file(Ok(Ok(upload())), cx);
        });
        cx.run_until_parked();
        host.plan(LIST).send((200, json!([]))).unwrap();
        host.plan(CREATE)
            .send((201, json!({"id":"file-a"})))
            .unwrap();
        host.plan(DETAIL)
            .send((503, json!({"error":"Unavailable"})))
            .unwrap();
        cx.update_window_entity(&view, |app, window, cx| app.review_form(window, cx));
        view.update(cx, |app, cx| app.confirm_form(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            let form = app.form.as_ref().unwrap();
            assert!(form.state == FormState::Uncertain);
            assert_eq!(form.upload.as_ref().unwrap().bytes.as_slice(), b"prova");
            assert!(app.verified.is_none());
            app.confirm_form(cx);
        });
        cx.run_until_parked();
        assert_eq!(
            host.routes()
                .iter()
                .filter(|route| route.starts_with(CREATE))
                .count(),
            1
        );
    }
}
