use super::*;
use mediflow_runtime_client::GovernanceSnapshot;

#[derive(Default)]
pub(super) struct GovernanceArea {
    snapshot: Option<GovernanceSnapshot>,
    reading: bool,
}
impl GovernanceArea {
    pub(super) fn withdraw(&mut self) {
        *self = Self::default();
    }
}
fn fact(label: &str, value: impl AsRef<str>, theme: Theme) -> Div {
    div().min_w_0().text_color(theme.secondary).child({
        let text = text!(format!("{label}: {}", value.as_ref()));
        #[cfg(test)]
        let text = rendered_command::observe_text(text);
        text
    })
}
fn missing(value: Option<&str>) -> &str {
    value.filter(|v| !v.is_empty()).unwrap_or("Non indicato")
}
fn list(values: &[String]) -> String {
    if values.is_empty() {
        "Nessuno".into()
    } else {
        values.join(", ")
    }
}
fn label(value: &str) -> &str {
    match value {
        "patient_insight" => "Quadro paziente",
        "smart_import" => "Importazione assistita",
        "document_synthesis" => "Sintesi dei documenti",
        "treatment_reasoning" => "Revisione del trattamento",
        "local_process" => "Questa postazione",
        "home_base" => "Postazione principale",
        "on_device" => "Sul dispositivo",
        "cloud" => "Fuori dalla postazione",
        "available" => "Disponibile",
        "proposal_only" => "Solo proposta da rivedere",
        "manual_only" => "Solo revisione manuale",
        "unavailable" | "offline" => "Non disponibile",
        "unknown" => "Non verificato",
        "degraded" => "Disponibilità ridotta",
        "hold" => "In attesa",
        "prune_ready" => "Pronto per revisione",
        "shadow-ready" => "Solo osservazione, non uso clinico",
        "rollback-required" => "Blocco richiesto",
        "review_first" => "Revisione richiesta",
        "informational" => "Informativa",
        "generative" => "Generativa",
        "deterministic" => "Deterministica",
        "none" => "Nessuna",
        "redacted_explicit_consent" => "Dati redatti e consenso esplicito",
        "target_invalid" => "Indirizzo locale non valido",
        "daemon_unreachable" => "Ollama non risponde",
        "mode_disabled" => "Modalità postazione principale spenta",
        "egress_profile_closed" => "Uscita esterna chiusa",
        "not_implemented" => "Modalità non disponibile",
        "not_probed" => "Stato non verificato",
        "icd_lookup" => "Ricerca diagnosi ICD-11",
        "aifa_drug_search" => "Ricerca farmaci AIFA",
        "service_prescription_matching" => "Abbinamento delle prestazioni",
        "evidence_absorption" => "Organizzazione delle evidenze",
        "patient_open_loops" => "Attività cliniche in sospeso",
        "fhir_export" => "Esportazione FHIR",
        "document_classification" => "Classificazione dei documenti",
        "document_identity_resolution" => "Riconoscimento dell’identità nel documento",
        "pii_redaction_layer1" => "Riduzione dei dati identificativi",
        "fse_document_validation" => "Controllo documenti FSE",
        "observation_range_classification" => "Classificazione dei valori osservati",
        "ocr" => "Lettura di scansioni e immagini",
        "extraction" => "Estrazione",
        "reasoning" => "Supporto al ragionamento",
        "synthesis" => "Sintesi",
        "classification" => "Classificazione",
        "lookup" => "Consultazione",
        "matching" => "Abbinamento",
        "validation" => "Validazione",
        "projection" => "Quadro informativo",
        "export" => "Esportazione",
        "competitive" => "Competitiva",
        "benchmark_only" => "Solo benchmark",
        "integration_pending" => "Integrazione in attesa",
        "blocked" => "Bloccata",
        "redaction" => "Protezione dei dati identificativi",
        "clinical_entities" => "Riconoscimento delle informazioni cliniche",
        "generative_challenger" => "Confronto fra modelli alternativi",
        _ => value,
    }
}
fn section_state<T>(
    id: &'static str,
    result: &Result<T, RuntimeError>,
    theme: Theme,
) -> Option<Stateful<Div>> {
    match result {
        Ok(_) => None,
        Err(RuntimeError::Missing) => Some(notice(
            id,
            "Nessun report salvato disponibile.",
            theme,
            false,
        )),
        Err(error) => Some(notice(id, ui_error(*error), theme, true)),
    }
}
impl ClinicalApp {
    pub(in crate::shell) fn read_governance(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.operation = Operation::Reading;
        self.local_host.governance.snapshot = None;
        self.local_host.governance.reading = true;
        self.run_local_host(
            move || access.read_governance(),
            |this, result, cx| {
                this.local_host.operation = Operation::Idle;
                this.local_host.governance.reading = false;
                match result {
                    Ok(snapshot) => this.local_host.governance.snapshot = Some(snapshot),
                    Err(error) => this.local_host.operation = Operation::Failed(ui_error(error)),
                }
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }
    pub(in crate::shell) fn governance_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let area = &self.local_host.governance;
        let mut pane = div().min_w_0().flex().flex_col().gap(px(16.))
            .child(heading("governance-heading", "Governo Fabric", theme))
            .child(text!("Registro e verifiche salvate sulla postazione. Rileggere non avvia prove, non attiva funzioni e non autorizza invii o uso clinico."))
            .child(self.local_host_panel(cx));
        if self.local_host.access().is_none() {
            return pane;
        }
        pane = pane.child(
            button(
                "governance-read",
                "Rileggi registro e verifiche",
                theme,
                false,
                !self.local_host.has_work(),
            )
            .on_click(cx.listener(|this, _, _, cx| this.read_governance(cx))),
        );
        if area.reading {
            return pane.child(notice(
                "governance-loading",
                "Lettura del registro e delle verifiche…",
                theme,
                false,
            ));
        }
        let Some(snapshot) = &area.snapshot else {
            return pane.child(notice(
                "governance-empty",
                "Registro e verifiche non ancora letti.",
                theme,
                false,
            ));
        };
        pane = pane.child(section(
            "governance-registry",
            "Registro delle capacità",
            theme,
        ));
        if let Some(state) = section_state("governance-registry-error", &snapshot.registry, theme) {
            pane = pane.child(state);
        }
        if let Ok(registry) = &snapshot.registry {
            pane = pane.child(notice("governance-egress", if registry.egress_gate_open { "Uscita esterna APERTA. Verifica policy, consenso e funzione interessata." } else { "Uscita esterna chiusa." }, theme, registry.egress_gate_open))
                .child(text!("La presenza nel registro non prova la disponibilità di un modello o un’esecuzione corrente."));
            for row in &registry.capabilities {
                let treatment = row.id == "treatment_reasoning";
                pane = pane.child(
                    div()
                        .min_w_0()
                        .border_b_1()
                        .border_color(theme.rule)
                        .pb(px(12.))
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .child(text!(label(&row.id).to_owned()))
                        .child(fact("Classe", label(&row.class), theme))
                        .child(fact("Operazione", label(&row.operation), theme))
                        .child(fact("Revisione", label(&row.review), theme))
                        .child(fact(
                            "Disponibilità",
                            if treatment {
                                "Non disponibile in questa versione"
                            } else {
                                label(&row.availability_disposition)
                            },
                            theme,
                        ))
                        .child(fact(
                            "Sedi ammesse",
                            if treatment {
                                "Nessuna".into()
                            } else {
                                list(
                                    &row.venues
                                        .iter()
                                        .map(|v| label(v).to_owned())
                                        .collect::<Vec<_>>(),
                                )
                            },
                            theme,
                        ))
                        .child(fact(
                            "Uscita dati",
                            label(&row.egress_profile.egress),
                            theme,
                        )),
                );
            }
        }
        pane = pane.child(section("governance-venues", "Dove gira il calcolo", theme));
        if let Some(state) = section_state("governance-venues-error", &snapshot.observations, theme)
        {
            pane = pane.child(state);
        }
        if let Ok(observations) = &snapshot.observations {
            pane = pane.child(text!("Nessun dirottamento automatico verso un’altra sede."));
            for row in &observations.observations {
                pane = pane.child(fact(
                    label(&row.venue),
                    format!(
                        "{} · {}",
                        label(&row.state),
                        row.reason
                            .as_deref()
                            .map(label)
                            .unwrap_or("Nessun motivo di indisponibilità riportato")
                    ),
                    theme,
                ));
            }
        }
        pane = pane.child(section(
            "governance-parliament",
            "Confronto modelli AI",
            theme,
        ));
        if let Some(state) =
            section_state("governance-parliament-error", &snapshot.parliament, theme)
        {
            pane = pane.child(state);
        }
        if let Ok(report) = &snapshot.parliament {
            let decision = &report.report.parliament;
            pane = pane
                .child(fact("Aggiornamento del report", &report.updated_at, theme))
                .child(fact("Stato confronto", label(&decision.readiness), theme))
                .child(fact(
                    "Motivo",
                    missing(decision.rationale.as_deref()),
                    theme,
                ))
                .child(fact(
                    "Modello base",
                    missing(decision.baseline_model.as_deref()),
                    theme,
                ))
                .child(fact(
                    "Alternative",
                    list(&decision.challenger_models),
                    theme,
                ))
                .child(fact(
                    "Modelli protetti",
                    list(&decision.protected_models),
                    theme,
                ))
                .child(fact(
                    "Candidati da rimuovere",
                    list(&decision.recommended_prune_models),
                    theme,
                ));
            if let Some(scorecard) = &report.report.scorecard {
                for row in &scorecard.lanes {
                    pane = pane
                        .child(fact(
                            label(&row.lane),
                            format!("{} · {}", label(&row.state), row.capability),
                            theme,
                        ))
                        .child(fact(
                            "Candidati / eseguibili / misurati",
                            format!(
                                "{} / {} / {}",
                                row.total_candidates,
                                row.runnable_candidates,
                                row.benchmarked_candidates
                            ),
                            theme,
                        ))
                        .child(fact(
                            "Modello in esame",
                            missing(
                                row.focus_candidate_label
                                    .as_deref()
                                    .or(row.focus_candidate_model.as_deref()),
                            ),
                            theme,
                        ))
                        .child(fact("Motivi di blocco", list(&row.blockers), theme))
                        .child(fact("Nota", missing(row.focus_note.as_deref()), theme));
                }
            }
        }
        pane = pane.child(section(
            "governance-rollout",
            "Verifiche delle funzioni assistite",
            theme,
        ));
        if let Some(state) = section_state("governance-rollout-error", &snapshot.rollout, theme) {
            pane = pane.child(state);
        }
        if let Ok(rollout) = &snapshot.rollout {
            for row in &rollout.local_controls {
                pane = pane.child(fact(
                    label(&row.lane),
                    if row.lane == "treatment_reasoning" {
                        "Non disponibile in questa versione"
                    } else if row.state == "disabled" {
                        "Spenta nelle impostazioni"
                    } else {
                        "Non spenta nelle impostazioni, disponibilità da verificare"
                    },
                    theme,
                ));
            }
            for row in &rollout.lanes {
                pane = pane.child(fact("Attività", label(&row.lane), theme));
                let Some(report) = &row.report else {
                    pane = pane.child(fact(
                        "Verifica",
                        if row.error.is_some() {
                            "Report non leggibile. Nessun esito disponibile."
                        } else {
                            "Nessuna verifica salvata. Non considerarla pronta."
                        },
                        theme,
                    ));
                    continue;
                };
                pane = pane
                    .child(fact(
                        "Esito salvato",
                        report
                            .status
                            .as_deref()
                            .map(label)
                            .unwrap_or("Non indicato"),
                        theme,
                    ))
                    .child(fact(
                        "Stato registrato",
                        missing(report.current_state.as_deref()),
                        theme,
                    ))
                    .child(fact(
                        "Modello valutato",
                        missing(report.selected_model.as_deref()),
                        theme,
                    ))
                    .child(fact(
                        "Aggiornamento del report",
                        missing(row.updated_at.as_deref()),
                        theme,
                    ));
                if let Some(evidence) = &report.evidence {
                    pane = pane
                        .child(fact(
                            "Attualità delle prove",
                            if evidence.benchmark_fresh == Some(true) {
                                "Confermata nel report"
                            } else {
                                "Non confermata nel report"
                            },
                            theme,
                        ))
                        .child(fact(
                            "Responsabile",
                            missing(evidence.owner.as_deref()),
                            theme,
                        ));
                }
                for (title, issues) in [
                    ("Blocco", &report.blockers),
                    ("Avvertenza", &report.warnings),
                ] {
                    for issue in issues {
                        pane = pane.child(fact(
                            title,
                            format!(
                                "{}: {}",
                                missing(issue.id.as_deref()),
                                missing(issue.message.as_deref())
                            ),
                            theme,
                        ));
                    }
                }
                if report.blockers.is_empty() {
                    pane = pane.child(text!(
                        "Nessun blocco riportato. Non equivale a un’autorizzazione all’uso."
                    ));
                }
            }
        }
        pane
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot() -> GovernanceSnapshot {
        let value: serde_json::Value =
            serde_json::from_str(include_str!("../../../../comparison/governance.json")).unwrap();
        GovernanceSnapshot {
            registry: Ok(serde_json::from_value(value["registry"].clone()).unwrap()),
            observations: Ok(serde_json::from_value(value["observations"].clone()).unwrap()),
            parliament: Ok(serde_json::from_value(value["parliament"].clone()).unwrap()),
            rollout: Ok(serde_json::from_value(value["rollout"].clone()).unwrap()),
        }
    }
    #[gpui::test]
    fn governance_draws_only_reads_and_clears_reports_on_lock(cx: &mut gpui::TestAppContext) {
        let host = notes_recovery_tests::Host::new();
        let access = Arc::new(
            host.session
                .authenticate_local_host(
                    "Synthetic scales fixture passphrase",
                    RetirementNotice::new(None),
                )
                .unwrap(),
        );
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        for scenario in 0..4 {
            view.update(cx, |app, _| {
                app.session = Some(host.session.clone());
                app.area = Area::Settings;
                app.settings_page = SettingsPage::Governance;
                app.local_host.authority = Authority::Open(access.clone());
                let mut data = snapshot();
                if scenario == 1 {
                    data.parliament = Err(RuntimeError::Missing);
                }
                if scenario == 2 {
                    data.observations = Err(RuntimeError::InvalidResponse);
                }
                app.local_host.governance.snapshot = Some(data);
                app.local_host.governance.reading = scenario == 3;
            });
            rendered_command::take_text_nodes();
            let commands = rendered_command::button_ids(|| {
                cx.update(|window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                })
            });
            if scenario != 3 {
                let nodes = rendered_command::take_text_nodes();
                assert!(nodes.iter().any(|(_, node)| node.value()
                    == Some("Disponibilità: Non disponibile in questa versione")));
                assert!(
                    nodes
                        .iter()
                        .any(|(_, node)| node.value() == Some("Sedi ammesse: Nessuna"))
                );
            }
            assert_eq!(
                commands
                    .iter()
                    .filter(|id| *id == "governance-read")
                    .count(),
                1
            );
            assert!(
                commands.iter().all(|id| !id.contains("Switch")
                    && !id.contains("generate")
                    && !id.contains("confirm")),
                "{commands:?}"
            );
            let mut unique = HashSet::new();
            assert!(commands.iter().all(|id| unique.insert(id)));
            view.read_with(cx, |app, _| {
                if scenario == 3 {
                    assert!(app.local_host.governance.reading);
                } else {
                    let snapshot = app.local_host.governance.snapshot.as_ref().unwrap();
                    assert!(snapshot.registry.is_ok());
                }
                assert!(app.local_host.access().is_some());
            });
        }
        view.update(cx, |app, cx| {
            app.local_host.governance.reading = false;
            app.request_discard(Discard::Lock, cx);
            assert!(app.local_host.governance.snapshot.is_none());
            assert!(!app.local_host.governance.reading);
        });
    }
    #[gpui::test]
    fn governance_does_not_offer_reads_without_local_authority(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, _| {
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Governance;
        });
        let commands = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })
        });
        assert!(
            !commands
                .iter()
                .any(|id| id == "governance-read" || id == "local-host-authenticate")
        );
    }
    #[gpui::test]
    fn governance_late_report_cannot_return_after_authority_replacement(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.run_local_host(
                || Ok(snapshot()),
                |this, result, _| this.local_host.governance.snapshot = result.ok(),
                cx,
            );
            app.local_host.withdraw(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.local_host.governance.snapshot.is_none())
        });
    }
}
