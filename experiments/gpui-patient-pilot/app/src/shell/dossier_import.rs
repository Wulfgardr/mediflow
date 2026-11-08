use super::*;
use mediflow_runtime_client::{DossierImport, dossier};
use serde_json::{Value, json};
use std::sync::Arc;
use zeroize::Zeroize;

#[derive(Default)]
pub(super) struct DossierArea {
    ticket: Arc<()>,
    worker: Option<Arc<DossierImport>>,
    preview: Value,
    outcomes: BTreeMap<String, Value>,
    linked: BTreeMap<String, String>,
    summaries: bool,
    busy: bool,
    status: String,
}
impl Drop for DossierArea {
    fn drop(&mut self) {
        if let Some(worker) = self.worker.take() {
            worker.retire();
        }
        wipe(&mut self.preview);
        for value in self.outcomes.values_mut() {
            wipe(value);
        }
        self.status.zeroize();
    }
}
fn wipe(v: &mut Value) {
    match v {
        Value::String(s) => s.zeroize(),
        Value::Array(a) => a.iter_mut().for_each(wipe),
        Value::Object(o) => o.values_mut().for_each(wipe),
        _ => {}
    }
    *v = Value::Null;
}
fn rows(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn text_value(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn group_identity(group: &Value, patients: &[Value], patient: Option<&str>) -> Value {
    let documents: Vec<_> = rows(&group["sources"])
        .iter()
        .filter(|s| s["status"] == "ready")
        .map(|s| json!({"taxCodes":s["taxCodes"],"patientNames":s["patientNames"]}))
        .collect();
    dossier::identity(&documents, patients, patient)
}
impl ClinicalApp {
    pub(super) fn cancel_dossier(&mut self, cx: &mut Context<Self>) {
        self.patient.dossier = DossierArea::default();
        cx.notify();
    }
    fn choose_dossier(&mut self, cx: &mut Context<Self>) {
        if self.local_host.access().is_none() || self.patient.dossier.busy {
            return;
        }
        self.patient.dossier = DossierArea::default();
        self.patient.dossier.busy = true;
        self.patient.dossier.status =
            "Scegli l’estrazione preparata JSON, poi i documenti originali.".into();
        let epoch = self.epoch;
        let ticket = self.patient.dossier.ticket.clone();
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Scegli estrazione preparata JSON".into()),
        });
        cx.spawn(async move |this, cx| {
            let result = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if this.epoch != epoch || !Arc::ptr_eq(&ticket, &this.patient.dossier.ticket) {
                    return;
                }
                let Ok(Ok(Some(paths))) = result else {
                    this.cancel_dossier(cx);
                    return;
                };
                let Some(path) = paths.into_iter().next() else {
                    this.cancel_dossier(cx);
                    return;
                };
                this.choose_dossier_files(path, cx);
            });
        })
        .detach();
        cx.notify();
    }
    fn choose_dossier_files(&mut self, path: std::path::PathBuf, cx: &mut Context<Self>) {
        let epoch = self.epoch;
        let ticket = self.patient.dossier.ticket.clone();
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: Some("Scegli i documenti del dossier".into()),
        });
        cx.spawn(async move |this, cx| {
            let result = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if this.epoch != epoch || !Arc::ptr_eq(&ticket, &this.patient.dossier.ticket) {
                    return;
                }
                let Ok(Ok(Some(paths))) = result else {
                    this.cancel_dossier(cx);
                    return;
                };
                let (Some(host), Some(scope)) = (this.local_host.access(), this.scope.clone())
                else {
                    this.cancel_dossier(cx);
                    return;
                };
                let patient = this.selected_id.clone();
                this.patient.dossier.status = "Lettura dei file e verifica delle proposte…".into();
                this.run(
                    move || {
                        use std::io::Read;
                        let mut prepared = Zeroizing::new(String::new());
                        std::fs::File::open(path)
                            .map_err(|_| RuntimeError::InvalidInput)?
                            .take(20 * 1024 * 1024 + 1)
                            .read_to_string(&mut prepared)
                            .map_err(|_| RuntimeError::InvalidInput)?;
                        if prepared.len() > 20 * 1024 * 1024 {
                            return Err(RuntimeError::TooLarge);
                        }
                        let worker = Arc::new(DossierImport::open(host, &scope)?);
                        let value =
                            worker.review(prepared.to_string(), paths, patient.as_deref())?;
                        Ok((worker, value))
                    },
                    move |this, result, cx| {
                        if !Arc::ptr_eq(&ticket, &this.patient.dossier.ticket) {
                            return;
                        }
                        this.patient.dossier.busy = false;
                        match result {
                            Ok((worker, preview)) => {
                                let mut linked = BTreeMap::new();
                                for group in rows(&preview["groups"]) {
                                    if let Some(id) = this.selected_id.clone() {
                                        linked.insert(text_value(&group["key"]).to_owned(), id);
                                    }
                                }
                                this.patient.dossier.worker = Some(worker);
                                this.patient.dossier.preview = preview;
                                this.patient.dossier.linked = linked;
                                this.patient.dossier.status =
                                    "Pronto per la revisione. Nessuna scrittura eseguita.".into();
                            }
                            Err(error) => {
                                this.patient.dossier.status =
                                    format!("Revisione non disponibile: {error}")
                            }
                        };
                        cx.notify();
                    },
                    cx,
                );
            });
        })
        .detach();
    }
    fn apply_dossier(&mut self, key: &str, cx: &mut Context<Self>) {
        if self.patient.dossier.busy || self.local_host.access().is_none() {
            return;
        }
        let Some(worker) = self.patient.dossier.worker.clone() else {
            return;
        };
        let Some(patient) = self.patient.dossier.linked.get(key).cloned() else {
            return;
        };
        let Some(group) = rows(&self.patient.dossier.preview["groups"])
            .iter()
            .find(|g| g["key"] == key)
        else {
            return;
        };
        if group_identity(
            group,
            rows(&self.patient.dossier.preview["patients"]),
            Some(&patient),
        )["blocking"]
            == true
        {
            return;
        }
        self.patient.dossier.busy = true;
        self.patient.dossier.status =
            "Applicazione in corso. Ogni esito viene riletto nella scheda.".into();
        let key = key.to_owned();
        let include = self.patient.dossier.summaries;
        let ticket = self.patient.dossier.ticket.clone();
        self.run(move||worker.apply(&key,&patient,include).map(|value|(key,value)),move |this,result,cx|{if !Arc::ptr_eq(&ticket, &this.patient.dossier.ticket) { return; }this.patient.dossier.busy=false;match result{Ok((key,value))=>{this.patient.dossier.outcomes.insert(key,value);this.patient.dossier.status="Applicazione terminata. Controlla gli esiti e ciò che resta da decidere.".into();this.load_sections(cx);},Err(error)=>this.patient.dossier.status=format!("Applicazione interrotta o da verificare: {error}. Le scritture già confermate restano nella scheda.")};cx.notify();},cx);
        cx.notify();
    }
    pub(super) fn dossier_import_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let state = &self.patient.dossier;
        let open = self.local_host.access().is_some();
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(12.))
            .border_b_1()
            .border_color(theme.rule)
            .pb(px(24.))
            .child(section("dossier-import-heading", "Importa dossier", theme));
        if !open {
            return pane.child(notice("dossier-host-closed","Host locale chiuso. Per rivedere e applicare il dossier apri Gestione locale in Impostazioni e conferma l’accesso su questo Mac.",theme,false));
        }
        pane = pane
            .child(
                button(
                    "dossier-select",
                    "Carica estrazione preparata e file…",
                    theme,
                    false,
                    !state.busy,
                )
                .when(!state.busy, |el| {
                    el.on_click(cx.listener(|this, _, _, cx| this.choose_dossier(cx)))
                }),
            )
            .child(
                button(
                    "dossier-cancel",
                    if state.outcomes.is_empty() {
                        "Annulla revisione"
                    } else {
                        "Chiudi revisione"
                    },
                    theme,
                    false,
                    !state.preview.is_null() || state.busy,
                )
                .on_click(cx.listener(|this, _, _, cx| this.cancel_dossier(cx))),
            );
        if !state.status.is_empty() {
            pane = pane.child(text!(state.status.clone()));
        }
        if state.preview.is_null() {
            return pane;
        }
        pane = pane.child(
            button(
                "dossier-summaries",
                if state.summaries {
                    "Ho letto le sintesi: sì"
                } else {
                    "Ho letto le sintesi: no"
                },
                theme,
                false,
                !state.busy,
            )
            .on_click(cx.listener(|this, _, _, cx| {
                this.patient.dossier.summaries = !this.patient.dossier.summaries;
                cx.notify();
            })),
        );
        for warning in rows(&state.preview["warnings"]) {
            pane = pane.child(notice(
                "dossier-parser-warning",
                text_value(warning),
                theme,
                true,
            ));
        }
        for (index, group) in rows(&state.preview["groups"]).iter().enumerate() {
            let key = text_value(&group["key"]);
            let patient = state.linked.get(key);
            let identity = group_identity(
                group,
                rows(&state.preview["patients"]),
                patient.map(String::as_str),
            );
            let blocked = identity["blocking"] == true;
            let mut card = div()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(10.))
                .py(px(12.))
                .child(heading(
                    "dossier-group",
                    format!("Scheda {}", index + 1),
                    theme,
                ))
                .child(notice(
                    format!("dossier-identity-{index}"),
                    text_value(&identity["message"]),
                    theme,
                    blocked,
                ));
            if !rows(&identity["documentPatientCodes"]).is_empty() {
                card = card.child(text!(format!(
                    "Codici fiscali letti: {}",
                    rows(&identity["documentPatientCodes"])
                        .iter()
                        .map(text_value)
                        .collect::<Vec<_>>()
                        .join(" · ")
                )));
            }
            for (pindex, p) in rows(&state.preview["patients"]).iter().enumerate() {
                let id = text_value(&p["id"]).to_owned();
                let groupkey = key.to_owned();
                let code = if text_value(&p["taxCode"]).is_empty() {
                    String::new()
                } else {
                    format!(" · CF {}", text_value(&p["taxCode"]))
                };
                let label = format!(
                    "{} {}{}{}",
                    text_value(&p["lastName"]),
                    text_value(&p["firstName"]),
                    code,
                    if patient == Some(&id) {
                        " · selezionata"
                    } else {
                        ""
                    }
                );
                card = card.child(
                    button(
                        format!("dossier-patient-{index}-{pindex}"),
                        &label,
                        theme,
                        false,
                        !state.busy,
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.patient
                            .dossier
                            .linked
                            .insert(groupkey.clone(), id.clone());
                        cx.notify();
                    })),
                );
            }
            for (sindex, source) in rows(&group["sources"]).iter().enumerate() {
                card = card
                    .child(section(
                        format!("dossier-source-{index}-{sindex}"),
                        text_value(&source["fileName"]),
                        theme,
                    ))
                    .child(text!(format!(
                        "{} · {}",
                        source_state(text_value(&source["status"])),
                        extraction_state(text_value(&source["extraction"]["state"]))
                    )));
                for note in rows(&source["prepared"]["notes"]) {
                    card = card.child(
                        div()
                            .text_color(theme.warning)
                            .child(text!(text_value(note).to_owned())),
                    );
                }
                for fact in rows(&source["facts"]) {
                    let check = text_value(&fact["values"]["preparedCheck"]);
                    let uncertain = !["verified", "approximate", ""].contains(&check)
                        || fact["negated"] == true;
                    let label = format!(
                        "{} · {}\n{}\n{}",
                        fact_label(text_value(&fact["kind"])),
                        if fact["negated"] == true {
                            "Il documento nega questa informazione"
                        } else {
                            check_label(check)
                        },
                        fact["values"]
                            .as_object()
                            .map(|v| v
                                .iter()
                                .filter(|(k, _)| !k.starts_with("prepared")
                                    && !["textSource", "codeSource"].contains(&k.as_str()))
                                .map(|(k, v)| display_value(k, text_value(v)))
                                .filter(|s| !s.is_empty())
                                .collect::<Vec<_>>()
                                .join(" · "))
                            .unwrap_or_default(),
                        text_value(&fact["evidence"]["excerpt"])
                    );
                    card = card.child(
                        div()
                            .min_w_0()
                            .text_color(if uncertain { theme.warning } else { theme.ink })
                            .child(text!(label)),
                    );
                }
                for fact in rows(&source["facts"]) {
                    if let Some(note) = fact["values"]["preparedNotes"].as_str() {
                        card = card.child(
                            div()
                                .text_color(theme.warning)
                                .child(text!(note.to_owned())),
                        );
                    }
                }
                if let Some(body) = source["text"].as_str() {
                    card = card
                        .child(section(
                            format!("dossier-text-{index}-{sindex}"),
                            "Testo letto dal documento, compresi i passaggi da rivedere",
                            theme,
                        ))
                        .child(div().min_w_0().child(text!(body.to_owned())));
                }
            }
            let groupkey = key.to_owned();
            card = card.child(
                button(
                    format!("dossier-apply-{index}"),
                    "Accetta il verificato e applica",
                    theme,
                    true,
                    !state.busy && !blocked && patient.is_some(),
                )
                .when(!state.busy && !blocked && patient.is_some(), |el| {
                    el.on_click(
                        cx.listener(move |this, _, _, cx| this.apply_dossier(&groupkey, cx)),
                    )
                }),
            );
            if let Some(outcome) = state.outcomes.get(key) {
                let applied = &outcome["applied"];
                card = card.child(text!(format!(
                    "Accettati: {} · Da decidere: {} · Saltati: {}",
                    applied["accepted"], applied["leftPending"], applied["skipped"]
                )));
                for result in rows(&outcome["acquired"]) {
                    card = card.child(text!(format!(
                        "Originale: {}",
                        match text_value(&result["status"]) {
                            "stored" => "conservato e riletto",
                            "reused" => "già presente, riletto e verificato",
                            "skipped" => "escluso o duplicato nella selezione",
                            _ => "non acquisito: serve una verifica",
                        }
                    )));
                }
                for result in rows(&applied["applied"]) {
                    card = card.child(text!(format!(
                        "{} · {} {}",
                        if result["partial"] == true {
                            "Applicato in parte: restano fatti da verificare"
                        } else {
                            "Applicazione verificata"
                        },
                        rows(&result["outcomes"]).len(),
                        if rows(&result["outcomes"]).len() == 1 {
                            "esito registrato"
                        } else {
                            "esiti registrati"
                        }
                    )));
                }
            }
            pane = pane.child(card);
        }
        pane
    }
}

fn fact_label(kind: &str) -> &str {
    match kind {
        "therapy" => "Farmaco",
        "diagnosis" => "Diagnosi",
        "observation" => "Osservazione",
        "exemption" => "Esenzione",
        "service_prescription" => "Prestazioni richieste",
        "prosthetic" => "Ausilio",
        "reported_scale" => "Scala riportata",
        "document_entry" => "Sintesi o documento nel diario",
        "anamnesis" => "Anamnesi",
        "assessment" => "Valutazione",
        "invalidity" => "Invalidità",
        "care_context" => "Contesto assistenziale",
        "imaging_report" => "Referto di imaging",
        _ => "Proposta",
    }
}
fn check_label(check: &str) -> &str {
    match check {
        "verified" => "Citazione e valori verificati",
        "approximate" => "Verificato con differenze di lettura OCR",
        "value_missing" => "Valore non scritto accanto al suo esame o farmaco",
        "subject_conflict" => "Il passo si riferisce a un familiare",
        "status_conflict" => "Stato diverso da quello scritto nel documento",
        "not_found" => "Citazione non trovata",
        "short_quote" => "Citazione troppo breve",
        "paraphrase" => "Testo riformulato: da leggere",
        "summary" => "Sintesi da leggere prima di accettare",
        "no_text" => "Testo non disponibile",
        "no_quote" => "Citazione mancante",
        _ => "Proposta del parser: da rivedere",
    }
}

fn source_state(status: &str) -> &str {
    match status {
        "ready" => "Pronto",
        "duplicate_in_selection" => "Copia nella selezione",
        "unreadable" => "File non leggibile",
        "excluded" => "Escluso",
        _ => "Da verificare",
    }
}
fn extraction_state(status: &str) -> &str {
    match status {
        "extracted" => "Testo estratto",
        "failed" => "Estrazione non riuscita",
        _ => "Senza estrazione",
    }
}
fn display_value(key: &str, value: &str) -> String {
    if ["date", "startDate", "endDate", "prescribedAt", "observedAt"].contains(&key)
        && !value.is_empty()
    {
        return display_date(Some(value));
    }
    if key == "status" {
        return match value {
            "completed" => "Storica",
            "active" => "In corso",
            "suspended" => "Sospesa",
            "prescribed" => "Prescritto",
            _ => value,
        }
        .to_owned();
    }
    value.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn preview(blocked: bool, forged: bool) -> Value {
        let text = if blocked {
            "Paziente: Altra Persona\nIl paziente assume Ramipril 5 mg al mattino."
        } else {
            "Paziente: Ada Sintetica\nIl paziente assume Ramipril 5 mg al mattino."
        };
        let result = dossier::prepared_facts(
            &json!({"source":{"sha256":"a".repeat(64),"documentDate":"2026-10-20","summary":null,"facts":[{"kind":"therapy","quote":"Il paziente assume Ramipril 5 mg al mattino","values":{"drugName":"Ramipril","dosage":if forged{"50 mg"}else{"5 mg"},"status":"completed"}}]},"text":text,"units":[{"index":0,"start":0,"end":text.encode_utf16().count()}],"documentDate":"2026-10-20","parserFacts":[],"now":"2026-11-08T12:00:00Z"}),
        );
        json!({"patients":[{"id":"p-a","firstName":"Ada","lastName":"Sintetica","taxCode":""}],"groups":[{"key":"synthetic-group","sources":[{"fileName":"Referto sintetico.pdf","status":"ready","text":text,"taxCodes":[],"patientNames":dossier::patient_names(text),"extraction":{"state":"extracted"},"facts":result["facts"]}]}]})
    }
    #[gpui::test]
    fn local_host_closed_has_no_dossier_apply_and_cancel_clears_review(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.patient.dossier.preview = preview(false, false);
            app.patient
                .dossier
                .linked
                .insert("synthetic-group".into(), "p-a".into());
            let commands = rendered_command::button_ids(|| {
                let _ = app.dossier_import_view(cx);
            });
            assert!(!commands.iter().any(|s| s.starts_with("dossier-apply")));
            app.apply_dossier("synthetic-group", cx);
            assert!(!app.patient.dossier.busy);
            app.cancel_dossier(cx);
            assert!(app.patient.dossier.preview.is_null());
            assert!(app.patient.dossier.linked.is_empty());
        });
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn capture_dossier_states_with_real_headless_renderer() {
        let Ok(directory) = std::env::var("MEDIFLOW_DOSSIER_CAPTURES") else {
            return;
        };
        struct Plane {
            app: Entity<ClinicalApp>,
        }
        impl Render for Plane {
            fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
                self.app.update(cx, |app, cx| {
                    div()
                        .size_full()
                        .bg(app.theme.paper)
                        .p(px(32.))
                        .child(app.dossier_import_view(cx))
                })
            }
        }
        let host = notes_recovery_tests::Host::new();
        let access = Arc::new(
            host.session
                .authenticate_local_host(
                    "Synthetic scales fixture passphrase",
                    mediflow_runtime_client::RetirementNotice::new(None),
                )
                .unwrap(),
        );
        std::fs::create_dir_all(&directory).unwrap();
        for state in [
            "pronto",
            "identita-bloccata",
            "falsificazione-fermata",
            "applicato",
            "host-locale-chiuso",
        ] {
            let mut cx = gpui::HeadlessAppContext::with_platform(
                Arc::new(gpui_apple::AppleTextSystem::new()),
                Arc::new(()),
                gpui_platform::current_headless_renderer,
            );
            let fonts: Vec<std::borrow::Cow<'static, [u8]>> = vec![
                std::borrow::Cow::Borrowed(include_bytes!(
                    "../../../../../app/fonts/Newsreader-Native-Regular.ttf"
                )),
                std::borrow::Cow::Borrowed(include_bytes!(
                    "../../../../../app/fonts/Newsreader-Native-Bold.ttf"
                )),
                std::borrow::Cow::Borrowed(include_bytes!(
                    "../../../../../native/MediFlowMac/Sources/MediFlowAppleShared/Resources/Fonts/IBMPlexMono-Regular.ttf"
                )),
            ];
            cx.update(|cx| cx.text_system().add_fonts(fonts).unwrap());
            let window=cx.open_window(gpui::size(px(1100.),px(1500.)),|window,cx|{let app=cx.new(|cx|ClinicalApp::new(String::new(),window,cx));app.update(cx,|app,_|{app.theme=Theme::for_dark(false);if state!="host-locale-chiuso"{app.local_host.dossier_test_access(access.clone());}app.patient.dossier.preview=preview(state=="identita-bloccata",state=="falsificazione-fermata");app.patient.dossier.linked.insert("synthetic-group".into(),"p-a".into());app.patient.dossier.status=if state=="applicato"{"Applicazione terminata. Controlla gli esiti e ciò che resta da decidere."}else{"Pronto per la revisione. Nessuna scrittura eseguita."}.into();if state=="applicato"{app.patient.dossier.outcomes.insert("synthetic-group".into(),json!({"acquired":[{"status":"stored","verified":true}],"applied":{"accepted":1,"leftPending":0,"skipped":0,"applied":[{"partial":false,"outcomes":[{"outcome":"applied"}]}]}}));}});cx.new(|_|Plane{app})}).unwrap();
            for _ in 0..8 {
                cx.update_window(window.into(), |_, w, cx| {
                    w.refresh();
                    w.draw(cx).clear(cx);
                })
                .unwrap();
                cx.run_until_parked();
            }
            cx.capture_screenshot(window.into())
                .unwrap()
                .save(format!("{directory}/{state}.png"))
                .unwrap();
        }
    }
}
