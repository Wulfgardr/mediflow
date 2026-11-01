use super::*;
use crate::theme::{TextRole, TypeStyle};
use mediflow_runtime_client::{PreparedWhoRollback, ReferenceCatalog, valid_who_check_code};
use serde_json::Value;

pub(super) struct WhoAdministration {
    pub(super) busy: bool,
    pub(super) rollback: Option<Arc<PreparedWhoRollback>>,
    readiness: Option<Result<Value, RuntimeError>>,
    checked_at: Option<String>,
    probe: Option<Result<Value, RuntimeError>>,
    code_result: Option<Result<Value, RuntimeError>>,
    code: Entity<TextInput>,
    message: Option<String>,
    receipt: Option<Value>,
    guide: bool,
    step: usize,
    _subscription: Subscription,
}
impl WhoAdministration {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        let code = cx.new(|cx| {
            TextInput::new(
                "who-admin-code",
                "Codice ICD-11",
                "Es. 1A00",
                false,
                theme,
                cx,
            )
        });
        let subscription = cx.subscribe(&code, |this, _, _: &InputChanged, cx| {
            this.local_host.who_administration.code_result = None;
            cx.notify();
        });
        Self {
            busy: false,
            rollback: None,
            readiness: None,
            checked_at: None,
            probe: None,
            code_result: None,
            code,
            message: None,
            receipt: None,
            guide: false,
            step: 0,
            _subscription: subscription,
        }
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) {
        self.busy = false;
        self.rollback = None;
        self.readiness = None;
        self.checked_at = None;
        self.probe = None;
        self.code_result = None;
        self.message = None;
        self.receipt = None;
        self.guide = false;
        self.step = 0;
        self.code.update(cx, |f, cx| f.retire(cx));
    }
    pub(super) fn invalidate_observations(&mut self) {
        self.readiness = None;
        self.checked_at = None;
        self.probe = None;
        self.code_result = None;
        self.rollback = None;
    }
    pub(super) fn configure(&mut self, theme: Theme, busy: bool, cx: &mut Context<ClinicalApp>) {
        self.code.update(cx, |f, cx| f.configure(theme, busy, cx));
    }
}
pub(super) fn timestamp(value: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|d| {
            d.with_timezone(&chrono::Local)
                .format("%d/%m/%Y %H:%M:%S")
                .to_string()
        })
        .unwrap_or_else(|_| "Data non disponibile".into())
}
pub(super) fn readiness_label(status: &str) -> &'static str {
    match status {
        "available" => "Disponibile secondo la risposta dell’host",
        "configured" => "Configurato, non ancora raggiunto",
        "configuration_required" => "Configurazione richiesta",
        "disabled" => "Disattivato",
        _ => "Non disponibile",
    }
}
fn source_label(value: &Value) -> &'static str {
    match value.as_str() {
        Some("embedded") => "Catalogo incorporato",
        Some("live") => "Servizio WHO locale",
        Some("cache") => "Cache, senza verifica del servizio corrente",
        _ => "Fonte non indicata",
    }
}
impl ClinicalApp {
    fn run_who_administration_check(&mut self, action: u8, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let code = self
            .local_host
            .who_administration
            .code
            .read(cx)
            .value()
            .to_owned();
        if action == 2 && !valid_who_check_code(&code) {
            self.local_host.who_administration.message =
                Some("Inserisci un codice ICD-11 valido, fino a 32 caratteri.".into());
            cx.notify();
            return;
        }
        if action==1&&!self.local_host.who_administration.readiness.as_ref().is_some_and(|r|matches!(r,Ok(v) if matches!(v["status"].as_str(),Some("configured"|"available"|"unavailable")))) {return;}
        let area = &mut self.local_host.who_administration;
        area.busy = true;
        area.message = None;
        match action {
            0 => {
                area.readiness = None;
                area.checked_at = None;
                area.probe = None;
                area.code_result = None;
            }
            1 => area.probe = None,
            _ => area.code_result = None,
        }
        let observed_code = code.clone();
        self.run_local_host(
            move || match action {
                0 => access.read_who_administration_readiness(),
                1 => access.probe_who_administration(),
                _ => access.check_who_administration_code(&code),
            },
            move |this, result, cx| {
                let area = &mut this.local_host.who_administration;
                area.busy = false;
                match action {
                    0 => {
                        area.readiness = Some(result);
                        area.checked_at =
                            Some(chrono::Local::now().format("%d/%m/%Y %H:%M:%S").to_string());
                    }
                    1 => area.probe = Some(result),
                    _ => {
                        if area.code.read(cx).value() == observed_code {
                            area.code_result = Some(result);
                        }
                    }
                }
                cx.notify();
            },
            cx,
        );
    }
    fn prepare_who_administration_rollback(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work()
            || self.local_host.references.preview.is_some()
            || self.local_host.references.who_consent
        {
            return;
        }
        let (Some(access), Some(status)) = (
            self.local_host.access(),
            self.local_host.references.snapshot.as_ref(),
        ) else {
            return;
        };
        match access.prepare_who_rollback(status) {
            Ok(command) => self.local_host.who_administration.rollback = Some(Arc::new(command)),
            Err(e) => self.local_host.who_administration.message = Some(ui_error(e)),
        };
        cx.notify();
    }
    fn confirm_who_administration_rollback(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let (Some(access), Some(command)) = (
            self.local_host.access(),
            self.local_host.who_administration.rollback.clone(),
        ) else {
            return;
        };
        self.local_host.who_administration.busy = true;
        self.run_local_host(
            move || access.rollback_who_catalog(&command),
            |this, result, cx| {
                let area = &mut this.local_host.who_administration;
                area.busy = false;
                area.invalidate_observations();
                match result {
                    Ok(write) => {
                        let confirmed = matches!(&write.current, Ok(v) if *v == write.recorded);
                        area.receipt = Some(write.recorded);
                        area.message = Some(if confirmed {
                            "Catalogo precedente ripristinato e riletto.".into()
                        } else {
                            "Ripristino registrato. Stato corrente da verificare: rileggi il catalogo.".into()
                        });
                        this.local_host.references.snapshot = write.current.ok().map(|data| {
                            mediflow_runtime_client::ReferenceStatus { catalog: ReferenceCatalog::Who, data, sources: None }
                        });
                    }
                    Err(error) => {
                        area.message = Some(format!("{} Rileggi il catalogo prima di una nuova conferma.", ui_error(error)));
                        this.local_host.references.snapshot = None;
                    }
                }
                cx.notify();
            },
            cx,
        );
    }
    pub(super) fn who_administration_view(&self, cx: &Context<Self>) -> Stateful<Div> {
        let area = &self.local_host.who_administration;
        let theme = self.theme;
        let enabled = self.local_host.access().is_some() && !self.local_host.has_work();
        let mut pane=div().id("who-administration").flex().flex_col().gap(px(12.))
            .child(section("who-admin-title","Disponibilità e verifica WHO",theme))
            .child(text!("Le verifiche consultano soltanto la terminologia in inglese e non modificano la cartella."))
            .child(div().flex().flex_wrap().gap(px(8.))
                .child(button("who-admin-read","Rileggi disponibilità WHO",theme,false,enabled).on_click(cx.listener(|this,_,_,cx|this.run_who_administration_check(0,cx))))
                .child(button("who-admin-probe","Verifica con termine di esempio",theme,false,enabled&&area.readiness.as_ref().is_some_and(|r|matches!(r,Ok(v) if matches!(v["status"].as_str(),Some("configured"|"available"|"unavailable"))))).on_click(cx.listener(|this,_,_,cx|this.run_who_administration_check(1,cx)))))
            .child(text!("Il termine pubblico di esempio è “cholera”. Una risposta dalla cache non verifica il servizio corrente."));
        if area.busy {
            pane = pane.child(notice(
                "who-admin-busy",
                "Verifica WHO in corso…",
                theme,
                false,
            ));
        }
        if let Some(message) = &area.message {
            pane = pane.child(notice("who-admin-message", message.clone(), theme, false));
        }
        for (id, result) in [
            ("who-admin-readiness", &area.readiness),
            ("who-admin-probe-result", &area.probe),
        ] {
            if let Some(result) = result {
                let mut box_view = div().id(id).flex().flex_col().gap(px(6.));
                match result {
                    Err(e) => {
                        box_view =
                            box_view.child(notice(format!("{id}-error"), ui_error(*e), theme, true))
                    }
                    Ok(v) if id == "who-admin-readiness" => {
                        box_view = box_view
                            .child(governance::fact(
                                "Disponibilità",
                                readiness_label(v["status"].as_str().unwrap_or("")),
                                theme,
                            ))
                            .child(governance::fact(
                                "Sorgente",
                                if v["deployment"] == "embedded" {
                                    "Catalogo incorporato"
                                } else {
                                    "Servizio WHO locale"
                                },
                                theme,
                            ));
                        if let Some(date) = &area.checked_at {
                            box_view =
                                box_view.child(governance::fact("Data della lettura", date, theme));
                        }
                        if let Some(date) = v["lastLiveObservedAt"].as_str() {
                            box_view = box_view.child(governance::fact(
                                "Ultima risposta diretta",
                                timestamp(date),
                                theme,
                            ));
                        }
                        if let Some(hash) = v["datasetSnapshotId"].as_str() {
                            box_view = box_view.child(governance::fact("Dataset", hash, theme));
                        }
                    }
                    Ok(v) => {
                        box_view = box_view
                            .child(governance::fact(
                                "Fonte della verifica",
                                source_label(&v["receipt"]["source"]),
                                theme,
                            ))
                            .child(governance::fact(
                                "Risultati",
                                v["receipt"]["resultCount"].to_string(),
                                theme,
                            ))
                            .child(governance::fact(
                                "Verifica del termine",
                                timestamp(v["receipt"]["completedAt"].as_str().unwrap_or("")),
                                theme,
                            ));
                    }
                }
                pane = pane.child(box_view);
            }
        }
        pane = pane.child(
            div()
                .id("who-code-editor")
                .flex()
                .flex_col()
                .gap(px(6.))
                .child(text!("Codice ICD-11 da verificare"))
                .child(area.code.clone())
                .child(
                    button(
                        "who-admin-code-check",
                        "Verifica codice WHO",
                        theme,
                        false,
                        enabled && valid_who_check_code(area.code.read(cx).value()),
                    )
                    .on_click(
                        cx.listener(|this, _, _, cx| this.run_who_administration_check(2, cx)),
                    ),
                ),
        );
        if let Some(result) = &area.code_result {
            let mut result_view = div().id("who-code-result").flex().flex_col().gap(px(6.));
            match result {
                Err(e) => {
                    result_view =
                        result_view.child(notice("who-code-error", ui_error(*e), theme, true))
                }
                Ok(v) => {
                    result_view = result_view
                        .child(governance::fact(
                            "Codice",
                            v["code"].as_str().unwrap_or(""),
                            theme,
                        ))
                        .child(governance::fact(
                            "Esito",
                            if v["status"] == "found" {
                                "Riconosciuto dalla fonte indicata"
                            } else {
                                "Non trovato nella fonte indicata"
                            },
                            theme,
                        ))
                        .child(governance::fact(
                            "Fonte",
                            source_label(&v["receipt"]["source"]),
                            theme,
                        ))
                        .child(governance::fact(
                            "Data della verifica",
                            timestamp(v["receipt"]["checkedAt"].as_str().unwrap_or("")),
                            theme,
                        ))
                        .child(governance::fact(
                            "Dataset",
                            v["receipt"]["datasetSnapshotId"].as_str().unwrap_or(""),
                            theme,
                        ));
                    if let Some(title) = v["entry"]["stemTitle"].as_str() {
                        result_view = result_view.child(governance::fact(
                            "Titolo del codice base",
                            title,
                            theme,
                        ));
                    }
                }
            }
            pane = pane.child(result_view);
        }
        if let Some(command) = &area.rollback {
            pane=pane.child(section("who-rollback-review","Ripristina il catalogo precedente",theme))
                .child(governance::fact("Revisione del catalogo da sostituire",command.revision().to_string(),theme))
                .child(text!("Verrà riattivata la versione precedente conservata sull’host. I suoi dettagli saranno disponibili dopo il ripristino. Le voci cliniche salvate restano invariate."))
                .child(button("who-rollback-confirm","Conferma ripristino WHO",theme,true,enabled).on_click(cx.listener(|this,_,_,cx|this.confirm_who_administration_rollback(cx))))
                .child(button("who-rollback-cancel","Conserva il catalogo attuale",theme,false,enabled).on_click(cx.listener(|this,_,_,cx|{if !this.local_host.has_work(){this.local_host.who_administration.rollback=None;cx.notify();}})));
        } else {
            pane = pane.child(
                button(
                    "who-rollback-prepare",
                    "Ripristina catalogo WHO precedente…",
                    theme,
                    false,
                    enabled
                        && self
                            .local_host
                            .references
                            .snapshot
                            .as_ref()
                            .is_some_and(|s| {
                                s.catalog == ReferenceCatalog::Who
                                    && s.data["enabled"] == true
                                    && s.data["previousAvailable"] == true
                            }),
                )
                .on_click(
                    cx.listener(|this, _, _, cx| this.prepare_who_administration_rollback(cx)),
                ),
            );
        }
        if let Some(value) = &area.receipt {
            pane = pane.child(
                div()
                    .id("who-rollback-receipt")
                    .child(governance::fact(
                        "Revisione registrata",
                        value["revision"].to_string(),
                        theme,
                    ))
                    .child(governance::fact(
                        "Impronta registrata",
                        value["manifest"]["sha256"]
                            .as_str()
                            .unwrap_or("Non disponibile"),
                        theme,
                    )),
            );
        }
        pane = pane.child(
            button(
                "who-setup-guide",
                "Configura il servizio WHO locale opzionale",
                theme,
                false,
                enabled,
            )
            .on_click(cx.listener(|this, _, _, cx| {
                let a = &mut this.local_host.who_administration;
                a.guide = !a.guide;
                a.step = 0;
                cx.notify();
            })),
        );
        if area.guide {
            let command = if cfg!(target_os = "macos") {
                "./Setup_WHO.command"
            } else if cfg!(target_os = "windows") {
                ".\\Setup_WHO.ps1"
            } else {
                "bash ./Setup_WHO.sh"
            };
            let instructions = [
                "Sul computer che ospita MediFlow servono Node.js 24 e un runtime Docker locale già avviato con motore Linux. Controlla lo spazio per immagine, catalogo e recupero. Se la porta 8382 è occupata, conserva il servizio esistente e consulta il gestore.",
                "Leggi i termini WHO prima dell’installazione. L’eventuale accettazione viene richiesta e registrata dalla procedura sull’host; questa guida non registra un consenso.",
                "Esegui il comando dalla cartella di MediFlow sul computer host. La procedura verifica immagine e dataset previsti dal pacchetto. Copiare il comando non lo esegue.",
                "Al termine rileggi la disponibilità, esegui la verifica con termine di esempio e controlla la fonte. Configurato e risposta dalla cache non equivalgono a un servizio raggiunto.",
                "Se l’avvio non riesce, usa le indicazioni di recupero della procedura sull’host. Conserva catalogo e copie precedenti; questa pagina non arresta né rimuove servizi.",
            ];
            let mut steps = div().id("who-guide-steps").flex().flex_wrap().gap(px(6.));
            for (i, label) in [
                "1. Prepara",
                "2. Termini WHO",
                "3. Installa e avvia",
                "4. Verifica",
                "5. Recupera",
            ]
            .into_iter()
            .enumerate()
            {
                steps = steps.child(
                    button(
                        format!("who-guide-step-{i}"),
                        label,
                        theme,
                        area.step == i,
                        enabled,
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if !this.local_host.has_work() {
                            this.local_host.who_administration.step = i;
                            cx.notify();
                        }
                    })),
                );
            }
            pane = pane
                .child(steps)
                .child(text!(instructions[area.step.min(4)]));
            if area.step == 1 {
                pane = pane.child(
                    button(
                        "who-license-open",
                        "Apri i termini WHO",
                        theme,
                        false,
                        enabled,
                    )
                    .on_click(cx.listener(|_, _, _, cx| {
                        cx.open_url("https://icd.who.int/en/docs/icd11-license.pdf")
                    })),
                );
            }
            if area.step == 2 {
                pane = pane
                    .child(div().type_role(theme, TextRole::Code).child(text!(command)))
                    .child(
                        button(
                            "who-copy-setup-command",
                            "Copia comando di configurazione WHO",
                            theme,
                            false,
                            enabled,
                        )
                        .on_click(cx.listener(move |_, _, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(command.to_owned()))
                        })),
                    );
            }
        }
        pane
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[gpui::test]
    fn who_checks_are_explicit_clear_changed_code_and_retire_on_lock(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(bind_keys);
        let host = notes_recovery_tests::Host::new();
        let access = Arc::new(
            host.session
                .authenticate_local_host(
                    "Synthetic scales fixture passphrase",
                    RetirementNotice::new(None),
                )
                .unwrap(),
        );
        let f: Value = serde_json::from_str(include_str!(
            "../../../../transport/tests/fixtures/who-administration.json"
        ))
        .unwrap();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.local_host.authority = Authority::Open(access);
            app.area = Area::Settings;
            app.settings_page = SettingsPage::References;
            app.local_host.references.catalog = ReferenceCatalog::Who;
        });
        let before = host.request_count();
        notes_recovery_tests::draw(cx);
        assert_eq!(
            host.request_count(),
            before,
            "rendering must not contact WHO"
        );
        view.update(cx, |app, cx| app.run_who_administration_check(2, cx));
        assert_eq!(
            host.request_count(),
            before,
            "invalid empty code must not contact WHO"
        );
        host.plan("GET /api/icd/code-check?code=AA00&release=2026-01")
            .send((200, f["found"].clone()))
            .unwrap();
        view.update(cx, |app, cx| {
            app.local_host
                .who_administration
                .code
                .update(cx, |field, cx| field.set_content("AA00", cx));
            app.run_who_administration_check(2, cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert_eq!(
                app.local_host
                    .who_administration
                    .code_result
                    .as_ref()
                    .unwrap()
                    .as_ref()
                    .unwrap()["status"],
                "found"
            )
        });
        cx.update_window_entity(&view, |app, window, cx| {
            app.local_host
                .who_administration
                .code
                .update(cx, |field, cx| field.focus_and_select(window, cx))
        });
        cx.simulate_input("ZZ99");
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.local_host.who_administration.code_result.is_none())
        });
        view.update(cx, |app, cx| {
            app.local_host.references.snapshot = Some(mediflow_runtime_client::ReferenceStatus {
                catalog: ReferenceCatalog::Who,
                data: f["before"].clone(),
                sources: None,
            });
            app.prepare_who_administration_rollback(cx);
            assert!(app.local_host.who_administration.rollback.is_some());
            assert!(!app.local_host.clinical_command_visible());
        });
        notes_recovery_tests::draw(cx);
        cx.simulate_keystrokes("escape");
        notes_recovery_tests::draw(cx);
        view.update(cx, |app, cx| {
            assert!(app.local_host.who_administration.rollback.is_none());
            assert_eq!(
                app.local_host.who_administration.code.read(cx).value(),
                "ZZ99"
            );
            app.withdraw_local_host(cx);
            assert!(
                app.local_host
                    .who_administration
                    .code
                    .read(cx)
                    .value()
                    .is_empty()
            );
            assert!(app.local_host.who_administration.readiness.is_none());
            assert!(app.local_host.who_administration.code_result.is_none());
        });
        assert!(!host.routes().iter().any(|r| r.starts_with("POST /api/icd")));
    }
}
