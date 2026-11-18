use super::*;
use gpui::{AnyWindowHandle, EntityInputHandler, HeadlessAppContext};
use mediflow_runtime_client::PatientCreateDraft;
use serde_json::Value;
use std::sync::Arc;

const ADDITION: &str = "\nQ7 0.9.1: rilettura completata.";

const PDF_ONLY: &str = "K59-S3-4417";
const PDF_ADDITION: &str = "\nS3: potassio da ricontrollare.";

struct Bench {
    pairing: Value,
    scope: String,
    returning: [String; 2],
    crowded: String,
    first: String,
    reader: String,
    referto: String,
    damaged: String,
}

fn login(pairing: &Value) -> RuntimeSession {
    RuntimeClient::new(RuntimeConfig {
        base_url: pairing["server"].as_str().unwrap().into(),
        tls_pin_sha256: None,
    })
    .unwrap()
    .login(
        PairingCredentials::new(
            pairing["clientId"].as_str().unwrap(),
            pairing["token"].as_str().unwrap().to_owned(),
        )
        .unwrap(),
        "performance-baseline",
        "314159",
    )
    .unwrap()
}

fn independent_notes(bench: &Bench, patient: &str) -> Option<String> {
    independent_profile(bench, patient).0
}

fn independent_profile(bench: &Bench, patient: &str) -> (Option<String>, u64, Vec<(String, u64)>) {
    let reader = login(&bench.pairing["reader"]);
    reader.list_ambulatories().unwrap();
    reader
        .select_profile_patient(&bench.scope, patient)
        .unwrap();
    let profile = reader
        .open_patient_profile(&bench.scope, patient, &reader.profile_query_intent())
        .unwrap();
    let documents = reader
        .list_attachments(&bench.scope, patient)
        .unwrap()
        .into_iter()
        .map(|row| (row.id, row.size))
        .collect();
    reader.lock();
    (profile.notes, profile.version, documents)
}

fn bench(path: &str) -> Bench {
    let pairing: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let client = RuntimeClient::new(RuntimeConfig {
        base_url: pairing["server"].as_str().unwrap().into(),
        tls_pin_sha256: None,
    })
    .unwrap();
    let session = client
        .login(
            PairingCredentials::new(
                pairing["clientId"].as_str().unwrap(),
                pairing["token"].as_str().unwrap().to_owned(),
            )
            .unwrap(),
            "performance-baseline",
            "314159",
        )
        .unwrap();
    let scope = session
        .list_ambulatories()
        .unwrap()
        .into_iter()
        .find(|row| row.is_default)
        .unwrap()
        .id;
    let today = chrono::Local::now().date_naive();
    let day = |offset: i64| {
        (today - chrono::Duration::days(offset))
            .format("%Y-%m-%d")
            .to_string()
    };
    let returning = [
        "perf-patient-000000".to_owned(),
        "perf-patient-000001".to_owned(),
    ];
    for patient in &returning {
        session.select_profile_patient(&scope, patient).unwrap();
        session
            .create_entry(
                &scope,
                patient,
                &EntryDraft {
                    entry_type: "visit".into(),
                    title: "Visita di controllo".into(),
                    content: "Parametri stabili. Educazione al controllo quotidiano del peso."
                        .into(),
                    date: day(14),
                    setting: None,
                },
            )
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let therapy = |name: &str, dosage: &str, status: &str| TherapyDraft {
            drug_name: name.into(),
            dosage: dosage.into(),
            status: status.into(),
            start_date: day(30),
            ..TherapyDraft::default()
        };
        session
            .create_therapy(
                &scope,
                patient,
                &therapy("Furosemide 25 mg cpr", "1 cp ore 8, ½ cp ore 14", "active"),
            )
            .unwrap();
        let spiro = session
            .create_therapy(
                &scope,
                patient,
                &therapy("Spironolattone 25 mg cpr", "1 cp al mattino", "active"),
            )
            .unwrap();
        let current = session.read_therapy(&scope, patient, &spiro.id).unwrap();
        session
            .update_therapy(
                &scope,
                patient,
                &spiro.id,
                current.version,
                &therapy("Spironolattone 25 mg cpr", "1 cp al mattino", "suspended"),
            )
            .unwrap();
        for (value, offset) in [("4.8", 40), ("5.6", 8)] {
            session
                .create_observation(
                    &scope,
                    patient,
                    &ObservationDraft {
                        code_system: "LOINC".into(),
                        code: "2823-3".into(),
                        display: "Potassio".into(),
                        unit_system: "UCUM".into(),
                        unit_code: "mmol/L".into(),
                        value: value.into(),
                        ref_low: Some("3.5".into()),
                        ref_high: Some("5.0".into()),
                        observed_at: format!("{}T08:00:00.000Z", day(offset)),
                        source: Some("manual".into()),
                        ..ObservationDraft::default()
                    },
                )
                .unwrap();
        }
    }
    let crowded = "perf-patient-000002".to_owned();
    session.select_profile_patient(&scope, &crowded).unwrap();
    let entry = |kind: &str, title: &str, offset: i64| EntryDraft {
        entry_type: kind.into(),
        title: title.into(),
        content: format!("{title}. Testo sintetico."),
        date: day(offset),
        setting: None,
    };
    session
        .create_entry(&scope, &crowded, &entry("visit", "Visita di controllo", 14))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    for (index, (kind, title)) in [
        ("remote", "Telefonata della figlia"),
        ("remote", "Telefonata per esami"),
        ("note", "Richiesta infermiere di famiglia"),
        ("remote", "Telefonata della farmacia"),
        ("remote", "Riferisce crampi e debolezza"),
        ("note", "Promemoria ricetta"),
        ("remote", "Telefonata della figlia"),
        ("note", "Promemoria trasporto"),
        ("remote", "Conferma appuntamento prelievo"),
    ]
    .into_iter()
    .enumerate()
    {
        session
            .create_entry(&scope, &crowded, &entry(kind, title, 12 - index as i64))
            .unwrap();
    }
    for (name, status) in [
        ("Furosemide 25 mg cpr", "active"),
        ("Bisoprololo 2,5 mg cpr", "active"),
        ("Apixaban 5 mg cpr", "active"),
        ("Metformina 500 mg cpr", "active"),
        ("Ramipril 5 mg cpr", "active"),
        ("Pantoprazolo 20 mg cpr", "active"),
        ("Atorvastatina 20 mg cpr", "active"),
        ("Allopurinolo 100 mg cpr", "completed"),
        ("Spironolattone 25 mg cpr", "suspended"),
    ] {
        let draft = TherapyDraft {
            drug_name: name.into(),
            dosage: "1 cp al giorno".into(),
            status: "active".into(),
            start_date: day(60),
            ..TherapyDraft::default()
        };
        let created = session.create_therapy(&scope, &crowded, &draft).unwrap();
        if status != "active" {
            let current = session.read_therapy(&scope, &crowded, &created.id).unwrap();
            session
                .update_therapy(
                    &scope,
                    &crowded,
                    &created.id,
                    current.version,
                    &TherapyDraft {
                        status: status.into(),
                        end_date: (status == "completed").then(|| day(1)),
                        ..draft
                    },
                )
                .unwrap();
        }
    }
    for (code, display, unit, value, low, high) in [
        ("2823-3", "Potassio", "mmol/L", "5.6", "3.5", "5.0"),
        ("2160-0", "Creatinina", "mg/dL", "1.32", "0.5", "1.1"),
        ("4548-4", "Emoglobina glicata", "%", "7.1", "4.0", "6.0"),
    ] {
        session
            .create_observation(
                &scope,
                &crowded,
                &ObservationDraft {
                    code_system: "LOINC".into(),
                    code: code.into(),
                    display: display.into(),
                    unit_system: "UCUM".into(),
                    unit_code: unit.into(),
                    value: value.into(),
                    ref_low: Some(low.into()),
                    ref_high: Some(high.into()),
                    observed_at: format!("{}T08:00:00.000Z", day(8)),
                    source: Some("manual".into()),
                    ..ObservationDraft::default()
                },
            )
            .unwrap();
    }
    session
        .create_entry(
            &scope,
            &crowded,
            &entry("remote", "Telefonata: sospeso lo spironolattone", 0),
        )
        .unwrap();
    session.clear_profile_selection();
    session.begin_profile_creation(&scope).unwrap();
    let first = session
        .create_patient(
            &scope,
            &PatientCreateDraft {
                first_name: "Nuova".into(),
                last_name: "Accoglienza".into(),
                tax_code: "".into(),
                identifier_type: Some("none".into()),
                birth_date_precision: Some("estimated".into()),
                birth_year: Some(1950),
                ..PatientCreateDraft::default()
            },
        )
        .unwrap()
        .id;
    let reader = "perf-patient-000003".to_owned();
    session.select_profile_patient(&scope, &reader).unwrap();
    session
        .create_entry(
            &scope,
            &reader,
            &EntryDraft {
                entry_type: "visit".into(),
                title: "Visita di controllo".into(),
                content: "Richiesti esami ematici di controllo.".into(),
                date: day(14),
                setting: None,
            },
        )
        .unwrap();
    let pdf = include_bytes!("../../test_support/referto-s3-consultazione.pdf");
    let referto = session
        .create_attachment(
            &scope,
            &reader,
            "Referto laboratorio sintetico.pdf",
            "application/pdf",
            pdf,
        )
        .unwrap()
        .id;
    let damaged = session
        .create_attachment(
            &scope,
            &reader,
            "Referto danneggiato.pdf",
            "application/pdf",
            &pdf[..pdf.len() / 3],
        )
        .unwrap()
        .id;
    session.clear_profile_selection();
    session.lock();
    Bench {
        reader,
        referto,
        damaged,
        pairing,
        scope,
        returning,
        crowded,
        first,
    }
}

fn context() -> HeadlessAppContext {
    let mut cx = HeadlessAppContext::with_platform(
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
    cx
}

struct Run<'a> {
    cx: &'a mut HeadlessAppContext,
    window: AnyWindowHandle,
    directory: String,
    log: Vec<Value>,
}

impl Run<'_> {
    fn app<R>(
        &mut self,
        f: impl FnOnce(&mut ClinicalApp, &mut Window, &mut Context<ClinicalApp>) -> R,
    ) -> R {
        self.cx
            .update_window(self.window, |root, window, cx| {
                root.downcast::<ClinicalApp>()
                    .unwrap()
                    .update(cx, |app, cx| f(app, window, cx))
            })
            .unwrap()
    }

    fn settle(&mut self) {
        for _ in 0..12 {
            self.cx
                .update_window(self.window, |_, window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                })
                .unwrap();
            self.cx.run_until_parked();
        }
    }

    fn shot(&mut self, name: &str, note: &str) {
        let started = std::time::Instant::now();
        self.settle();
        let wait_ms = started.elapsed().as_millis();
        let path = format!("{}/{name}.png", self.directory);
        self.cx
            .capture_screenshot(self.window)
            .unwrap()
            .save(&path)
            .unwrap();
        let state = self.app(|app, _, _| {
            serde_json::json!({
                "message": app.message.as_ref().map(|(text, _)| text.clone()),
                "verified": app.verified.clone(),
                "form": app.form.as_ref().map(|form| match form.state {
                    FormState::Draft => "bozza", FormState::Review => "revisione", FormState::Saving => "invio",
                    FormState::Conflict => "conflitto", FormState::Uncertain => "da verificare", FormState::Rejected => "respinta",
                }),
                "notes": app.patient.detail.ready().and_then(|row| row.notes.clone()),
            })
        });
        self.log
            .push(serde_json::json!({"shot": name, "note": note, "technicalWaitMs": wait_ms, "state": state}));
    }

    fn open(&mut self, id: &str) {
        let id = id.to_owned();
        self.app(move |app, _, cx| app.select_patient(&id, true, cx));
        self.settle();
    }

    fn type_at_end(&mut self, text: &str) -> (usize, String) {
        let text = text.to_owned();
        self.app(move |app, window, cx| {
            let editor = app.form.as_ref().unwrap().fields[0].editor.clone();
            editor.update(cx, |input, cx| {
                input.focus(window, cx);
                let end = input.text_length_utf16(window, cx).unwrap();
                input.set_selected_text_range(end..end, window, cx);
                for character in text.chars() {
                    input.replace_text_in_range(None, &character.to_string(), window, cx);
                }
                let caret = input
                    .selected_text_range(false, window, cx)
                    .unwrap()
                    .range
                    .end;
                (caret, input.value().to_owned())
            })
        })
    }

    fn wait_for_original(&mut self) -> &'static str {
        for _ in 0..200 {
            self.settle();
            let state = self.app(|app, _, _| {
                match app
                    .patient
                    .document_original
                    .as_ref()
                    .map(|original| &original.state)
                {
                    Some(ReadLoad::Ready(Ok(documents::OriginalPreview::Pdf(_)))) => Some("pdf"),
                    Some(ReadLoad::Ready(Ok(_))) => Some("altro"),
                    Some(ReadLoad::Ready(Err(_)) | ReadLoad::Failed(_)) => Some("rifiutato"),
                    None => Some("assente"),
                    _ => None,
                }
            });
            if let Some(state) = state {
                return state;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        panic!("original preview did not settle")
    }

    fn open_first_access(&mut self, bench: &Bench) {
        self.app(|app, _, cx| {
            app.form = None;
            app.patient.record.diary_all = false;
            cx.notify();
        });
        self.open(&bench.first);
    }

    fn caret_and_text(&mut self) -> (usize, String) {
        self.app(|app, window, cx| {
            let editor = app.form.as_ref().unwrap().fields[0].editor.clone();
            editor.update(cx, |input, cx| {
                (
                    input
                        .selected_text_range(false, window, cx)
                        .unwrap()
                        .range
                        .end,
                    input.value().to_owned(),
                )
            })
        })
    }
}

fn open_window(
    cx: &mut HeadlessAppContext,
    bench: &Bench,
    dark: bool,
    width: f32,
    height: f32,
) -> AnyWindowHandle {
    open_scaled_window(cx, bench, dark, width, height, 1.)
}

fn open_scaled_window(
    cx: &mut HeadlessAppContext,
    bench: &Bench,
    dark: bool,
    width: f32,
    height: f32,
    text_scale: f32,
) -> AnyWindowHandle {
    let session = login(&bench.pairing);
    session.list_ambulatories().unwrap();
    let scope = bench.scope.clone();
    let handle = cx
        .open_window(gpui::size(px(width), px(height)), move |window, cx| {
            cx.new(|cx| {
                let mut app = ClinicalApp::new(String::new(), window, cx);
                app.dark_override = Some(dark);
                app.text_scale = text_scale;
                app.session = Some(session);
                app.scope = Some(scope);
                app.area = Area::Patients;
                app.directory = true;
                app
            })
        })
        .unwrap();
    handle.into()
}

const LONG_NOTE: &str = "\nPrimo accesso: riferisce affanno da sforzo da circa tre settimane, peggiorato dopo la sospensione autonoma del diuretico; nessun dolore toracico; caviglie gonfie la sera; chiede indicazioni sul controllo del peso a domicilio e sulla dieta iposodica.";

fn direction_f(run: &mut Run, bench: &Bench, prefix: &str) -> Value {
    run.open(&bench.crowded);
    run.shot(
        &format!("{prefix}-30-affollata-senza-bozza"),
        "Dodici variazioni per tipo dentro il giorno, bozza chiusa",
    );
    run.app(|app, window, cx| app.open_form(FormKind::Notes, window, cx));
    let typed = run.type_at_end("\nControllare il potassio.");
    run.shot(
        &format!("{prefix}-31-affollata-con-bozza"),
        "Bozza aperta: terapie attive subito sotto il compositore",
    );
    let suspended = run.app(|app, _, _| {
        let anchor = app.patient.record.anchor.clone().flatten()?;
        record_changes::changes_since(
            &anchor,
            app.patient.therapies.ready()?,
            app.patient.observations.ready()?,
            &chrono::Local,
        )
        .into_iter()
        .find(|change| change.subject.starts_with("Spironolattone"))
        .map(|change| change.key)
    });
    run.app(move |app, _, cx| {
        app.patient.record.open = suspended;
        cx.notify();
    });
    run.shot(
        &format!("{prefix}-32-nome-aperto"),
        "Un nome aperto: dettaglio e data della variazione",
    );
    run.app(|app, _, cx| app.read_whole_diary(cx));
    let sixth = run.app(|app, _, _| {
        let mut rows: Vec<_> = app
            .patient
            .entries
            .ready()?
            .iter()
            .filter(|row| row.deleted_at.is_none())
            .collect();
        rows.sort_by(|a, b| b.date.cmp(&a.date));
        rows.get(5).map(|row| row.title.clone())
    });
    run.shot(
        &format!("{prefix}-33-diario-intero"),
        "Bozza aperta: il diario si estende in lettura",
    );
    run.app(|app, _, cx| app.close_diary_reading(cx));
    let back = run.caret_and_text();
    assert_eq!(back, typed, "text and caret come back after the diary");
    run.open_first_access(bench);
    run.shot(
        &format!("{prefix}-34-primo-accesso"),
        "Primo accesso, senza visite",
    );
    run.app(|app, window, cx| app.open_form(FormKind::Notes, window, cx));
    let long = run.type_at_end(LONG_NOTE);
    run.shot(
        &format!("{prefix}-35-primo-accesso-testo-lungo"),
        "Primo accesso con una nota lunga in bozza",
    );
    serde_json::json!({"sixthDiaryEntry": sixth, "caretAfterTyping": typed.0, "caretAfterDiary": back.0,
        "longNoteLength": long.1.chars().count()})
}

fn gesture(run: &mut Run, bench: &Bench, patient: &str, prefix: &str) -> Value {
    let original = independent_notes(bench, patient).unwrap_or_default();
    run.app(|app, _, cx| app.load_patients(cx));
    run.shot(
        &format!("{prefix}-01-elenco"),
        "Elenco dei pazienti, prima del gesto",
    );
    run.open(patient);
    run.shot(
        &format!("{prefix}-02-scheda"),
        "Ritorno: scheda aperta dalla lista",
    );
    let first_change = run.app(|app, _, _| {
        let anchor = app.patient.record.anchor.clone().flatten()?;
        record_changes::changes_since(
            &anchor,
            app.patient.therapies.ready()?,
            app.patient.observations.ready()?,
            &chrono::Local,
        )
        .first()
        .map(|change| change.key.clone())
    });
    run.app(move |app, window, cx| {
        app.patient.record.open = first_change;
        app.open_form(FormKind::Notes, window, cx);
    });
    run.shot(
        &format!("{prefix}-03-modifica-aperta"),
        "Modifica note aperta: contesto a destra, testo originale nel campo",
    );
    let typed = run.type_at_end(ADDITION);
    run.shot(
        &format!("{prefix}-04-bozza"),
        "Bozza non registrata con la riga aggiunta",
    );
    run.app(|app, _, cx| {
        app.patient.record.quadro = true;
        cx.notify();
    });
    run.shot(
        &format!("{prefix}-05-fonte-aperta"),
        "Durante la scrittura: Quadro e fonti aperti, variazione aperta",
    );
    run.app(|app, _, cx| {
        app.patient.record.quadro = false;
        cx.notify();
    });
    let restored = run.caret_and_text();
    run.app(|app, window, cx| app.review_form(window, cx));
    run.shot(
        &format!("{prefix}-06-revisione"),
        "Revisione: paziente, oggetto e testo, un solo principale",
    );
    run.app(|app, _, cx| app.confirm_form(cx));
    run.shot(
        &format!("{prefix}-07-registrata"),
        "Esito dopo la rilettura",
    );
    run.app(|app, _, cx| app.back_from_patient(cx));
    run.shot(
        &format!("{prefix}-08-chiusa"),
        "Scheda chiusa, ritorno all'elenco",
    );
    run.open(patient);
    run.shot(
        &format!("{prefix}-09-riaperta"),
        "Scheda riaperta: testo originale più l'aggiunta",
    );
    let reopened =
        run.app(|app, _, _| app.patient.detail.ready().and_then(|row| row.notes.clone()));
    let server = independent_notes(bench, patient);
    let expected = format!("{original}{ADDITION}");
    assert_eq!(typed.1, expected, "the typed draft keeps the original text");
    assert_eq!(
        restored, typed,
        "text and caret survive opening the sources"
    );
    assert_eq!(
        reopened.as_deref(),
        Some(expected.as_str()),
        "the reopened record shows both parts"
    );
    assert_eq!(
        server.as_deref(),
        Some(expected.as_str()),
        "an independent read sees the same note"
    );
    serde_json::json!({"patient": patient, "caretAfterTyping": typed.0, "caretAfterSources": restored.0,
        "reopenedMatches": true, "independentReadMatches": true, "originalLength": original.chars().count()})
}

fn crowded_and_interrupted(run: &mut Run, bench: &Bench, prefix: &str) -> Value {
    let patient = bench.crowded.clone();
    run.open(&patient);
    run.shot(
        &format!("{prefix}-11-affollata"),
        "Ritorno affollato: dodici variazioni e dieci contatti nel diario",
    );
    let changes = run
        .app(|app, _, _| {
            let anchor = app.patient.record.anchor.clone().flatten()?;
            Some(
                record_changes::changes_since(
                    &anchor,
                    app.patient.therapies.ready()?,
                    app.patient.observations.ready()?,
                    &chrono::Local,
                )
                .into_iter()
                .map(|change| (change.key, change.subject, change.kind.label()))
                .collect::<Vec<_>>(),
            )
        })
        .unwrap_or_default();
    let diary_line = run.app(|app, _, _| {
        let anchor = app.patient.record.anchor.clone().flatten()?;
        record_changes::diary_after(&anchor, app.patient.entries.ready()?)
    });
    let spiro = changes
        .iter()
        .find(|(_, subject, _)| subject.starts_with("Spironolattone"))
        .map(|(key, _, _)| key.clone());
    run.app(|app, window, cx| app.open_form(FormKind::Notes, window, cx));
    let typed = run.type_at_end("\nRivalutare il potassio fra una settimana.");
    run.app(move |app, _, cx| {
        app.patient.record.open = spiro;
        cx.notify();
    });
    run.shot(
        &format!("{prefix}-12-bozza-e-variazione"),
        "Bozza aperta, variazione dello spironolattone aperta",
    );
    let entry = run.app(|app, _, _| {
        app.patient
            .entries
            .ready()?
            .iter()
            .find(|entry| entry.title.contains("spironolattone"))
            .map(|entry| entry.id.clone())
    });
    let linked = entry.is_some();
    run.app(move |app, _, cx| {
        if let Some(entry) = entry {
            app.read_record_entry(&entry, cx);
        }
    });
    run.shot(
        &format!("{prefix}-13-voce-sopra-la-bozza"),
        "La voce dello stesso giorno si apre nel Contesto sopra la bozza",
    );
    run.app(|app, _, cx| app.close_record_reading(cx));
    let after_entry = run.caret_and_text();
    let document = run.app(|app, _, _| {
        app.patient
            .attachments
            .ready()?
            .first()
            .map(|row| row.id.clone())
    });
    let referto = document.is_some();
    run.app(move |app, _, cx| {
        if let Some(document) = document {
            app.read_record_document(&document, cx);
        }
    });
    run.wait_for_original();
    run.shot(
        &format!("{prefix}-14-referto-sopra-la-bozza"),
        "Il referto si apre nel Contesto sopra la bozza",
    );
    run.app(|app, _, cx| app.close_record_reading(cx));
    run.shot(
        &format!("{prefix}-15-torna-alla-bozza"),
        "Torna alla bozza: testo e punto di scrittura",
    );
    let after_document = run.caret_and_text();
    run.app(|app, window, cx| app.review_form(window, cx));
    run.shot(
        &format!("{prefix}-16-revisione"),
        "Revisione sulla scheda affollata",
    );
    run.app(|app, _, cx| app.confirm_form(cx));
    run.shot(
        &format!("{prefix}-17-registrata"),
        "Esito sulla scheda affollata",
    );
    assert_eq!(
        after_entry, typed,
        "text and caret survive reading the linked entry"
    );
    assert_eq!(
        after_document, typed,
        "text and caret survive reading the document"
    );
    let stored = independent_notes(bench, &patient).unwrap_or_default();
    assert!(stored.ends_with("Rivalutare il potassio fra una settimana."));
    serde_json::json!({"patient": patient, "bandRows": changes.len(),
        "rows": changes.iter().map(|(_, s, k)| format!("{s}: {k}")).collect::<Vec<_>>(),
        "diaryLine": diary_line, "linkedEntryOpened": linked, "documentOpened": referto,
        "caretAfterTyping": typed.0, "caretAfterEntry": after_entry.0, "caretAfterDocument": after_document.0,
        "independentReadEndsWithAddition": true})
}

fn pdf_while_drafting(run: &mut Run, bench: &Bench, prefix: &str) -> Value {
    let patient = bench.reader.clone();
    let before = independent_profile(bench, &patient);
    run.open(&patient);
    run.app(|app, window, cx| app.open_form(FormKind::Notes, window, cx));
    let typed = run.type_at_end(PDF_ADDITION);
    run.shot(
        &format!("{prefix}-21-bozza-prima-del-referto"),
        "Bozza aperta, referto ancora chiuso",
    );
    let referto = bench.referto.clone();
    run.app(move |app, _, cx| app.read_record_document(&referto, cx));
    let opened = run.wait_for_original();
    run.shot(
        &format!("{prefix}-22-pdf-accanto-alla-bozza"),
        "Il PDF si legge nel riepilogo mentre la bozza resta aperta",
    );
    run.app(|_, window, cx| window.focus_prev(cx));
    run.shot(
        &format!("{prefix}-22b-fuoco"),
        "Fuoco sul comando che precede la bozza",
    );
    let during = independent_profile(bench, &patient);
    run.app(|app, _, cx| app.close_record_reading(cx));
    run.shot(
        &format!("{prefix}-23-torna-alla-bozza"),
        "Torna alla bozza: stesso testo e stesso punto",
    );
    let after_pdf = run.caret_and_text();
    let damaged = bench.damaged.clone();
    run.app(move |app, _, cx| app.read_record_document(&damaged, cx));
    let refused = run.wait_for_original();
    run.shot(
        &format!("{prefix}-24-pdf-illeggibile"),
        "PDF danneggiato: anteprima rifiutata, bozza intatta",
    );
    run.app(|app, _, cx| app.close_record_reading(cx));
    let after_damaged = run.caret_and_text();
    let unchanged = independent_profile(bench, &patient);
    run.app(|app, window, cx| app.review_form(window, cx));
    run.shot(
        &format!("{prefix}-25-revisione"),
        "Revisione dopo la consultazione",
    );
    run.app(|app, _, cx| app.confirm_form(cx));
    run.shot(
        &format!("{prefix}-26-registrata"),
        "Registrata una sola volta",
    );
    let stored = independent_profile(bench, &patient);
    assert_eq!(
        opened, "pdf",
        "the real PDF reaches the authenticated preview"
    );
    assert_eq!(refused, "rifiutato", "a damaged PDF is refused");
    assert_eq!(after_pdf, typed, "text and caret survive reading the PDF");
    assert_eq!(
        after_damaged, typed,
        "text and caret survive the refused PDF"
    );
    assert_eq!(during, before, "reading the PDF writes nothing");
    assert_eq!(unchanged, before, "the refused PDF writes nothing");
    let expected = format!("{}{PDF_ADDITION}", before.0.clone().unwrap_or_default());
    assert_eq!(
        stored.0.as_deref(),
        Some(expected.as_str()),
        "a second session reads the note"
    );
    assert_eq!(stored.1, before.1 + 1, "one confirmation, one version");
    assert_eq!(stored.2, before.2, "documents untouched");
    serde_json::json!({"patient": patient, "pdfOnlyMarker": PDF_ONLY, "opened": opened, "damaged": refused,
        "caretAfterTyping": typed.0, "caretAfterPdf": after_pdf.0, "caretAfterDamaged": after_damaged.0,
        "versionBefore": before.1, "versionDuringReading": during.1, "versionAfterConfirm": stored.1,
        "independentReadMatches": true})
}

#[test]
fn capture_record_d_on_the_synthetic_bench() {
    let (Ok(directory), Ok(pairing)) = (
        std::env::var("MEDIFLOW_RECORD_CAPTURES"),
        std::env::var("MEDIFLOW_RECORD_BENCH"),
    ) else {
        return;
    };
    std::fs::create_dir_all(&directory).unwrap();
    assert!(documents::pdf::test_worker::use_built_binary());
    let bench = bench(&pairing);
    let mut summary = vec![];
    for (dark, theme) in [(false, "giorno"), (true, "grafite")] {
        let mut cx = context();
        let window = open_window(&mut cx, &bench, dark, 1180., 660.);
        let mut run = Run {
            cx: &mut cx,
            window,
            directory: directory.clone(),
            log: vec![],
        };
        let patient = bench.returning[usize::from(dark)].clone();
        let result = gesture(&mut run, &bench, &patient, &format!("{theme}-1180"));
        let crowded = if dark {
            Value::Null
        } else {
            crowded_and_interrupted(&mut run, &bench, &format!("{theme}-1180"))
        };
        let pdf = pdf_while_drafting(&mut run, &bench, &format!("{theme}-1180"));
        let direction = {
            let mut cx = context();
            let window = open_window(&mut cx, &bench, dark, 1180., 660.);
            let mut run = Run {
                cx: &mut cx,
                window,
                directory: directory.clone(),
                log: vec![],
            };
            let result = direction_f(&mut run, &bench, &format!("{theme}-1180-f"));
            let mut cx = context();
            let window = open_scaled_window(&mut cx, &bench, dark, 1440., 900., 2.);
            let mut scaled = Run {
                cx: &mut cx,
                window,
                directory: directory.clone(),
                log: vec![],
            };
            let enlarged = direction_f(&mut scaled, &bench, &format!("{theme}-1440-testo-200"));
            serde_json::json!({"f": result, "enlarged": enlarged, "shots": run.log, "enlargedShots": scaled.log})
        };
        run.open(&bench.first);
        run.shot(
            &format!("{theme}-1180-10-primo-accesso"),
            "Primo accesso, senza identificativo e senza visite",
        );
        summary.push(serde_json::json!({"theme": theme, "gesture": result, "crowded": crowded, "pdf": pdf, "direction": direction, "shots": run.log}));
        for (width, height, label) in [
            (1440., 900., "1440"),
            (820., 660., "820"),
            (390., 760., "390"),
        ] {
            let mut cx = context();
            let window = open_window(&mut cx, &bench, dark, width, height);
            let mut run = Run {
                cx: &mut cx,
                window,
                directory: directory.clone(),
                log: vec![],
            };
            run.open(&patient);
            run.shot(
                &format!("{theme}-{label}-ritorno"),
                "Ritorno dopo la registrazione",
            );
            run.open(&bench.crowded);
            run.shot(&format!("{theme}-{label}-affollata"), "Ritorno affollato");
            run.open(&bench.first);
            run.shot(&format!("{theme}-{label}-primo-accesso"), "Primo accesso");
            summary.push(serde_json::json!({"theme": theme, "size": label, "shots": run.log}));
        }
    }
    std::fs::write(
        format!("{directory}/esito.json"),
        serde_json::to_string_pretty(&summary).unwrap(),
    )
    .unwrap();
}
