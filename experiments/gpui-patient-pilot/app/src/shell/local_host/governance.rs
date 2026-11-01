use super::*;
use mediflow_runtime_client::GovernanceSnapshot;

#[derive(Default)]
pub(super) struct GovernanceArea {
    snapshot: Option<GovernanceSnapshot>,
    reading: bool,
    reports_open: std::collections::HashSet<String>,
}
impl GovernanceArea {
    pub(super) fn withdraw(&mut self) {
        *self = Self::default();
    }
}
pub(super) fn fact(label: &str, value: impl AsRef<str>, theme: Theme) -> Div {
    div().min_w_0().text_color(theme.secondary).child({
        let text = gpui::Text::new(
            gpui::ElementId::Name(label.to_owned().into()),
            format!("{label}: {}", value.as_ref()).into(),
        );
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
        "host_managed" => "Gestito dalla postazione",
        "informational_only" => "Solo informativo",
        "operation_receipt_required" => "Richiede la prova dell’operazione corrente",
        "disabled" => "Disabilitato",
        "local_model" => "Modello locale",
        "separate_api_access_required" => "Accesso API separato",
        "proposal_only_candidate" => "Candidato locale, solo proposta",
        "execution_disabled" => "Esecuzione disabilitata",
        "not_observed" => "Non osservato",
        "denied_by_contract" => "Negato dal contratto",
        "available_unqualified" => "Presente, idoneità da verificare",
        "revoked" => "Revocato",
        "missing" => "Assente",
        "corrupt" | "invalid" => "Non valido",
        "not_applicable" => "Non applicabile",
        "consumer_subscription_is_not_api_access" => {
            "Un abbonamento consumer non equivale all’accesso API"
        }
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
pub(super) fn section_state<T>(
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
    fn governance_report(
        &self,
        key: &str,
        json_path: Option<&str>,
        markdown_path: Option<&str>,
        markdown: Option<&str>,
        report: &serde_json::Value,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        let key = key.to_owned();
        let open = self.local_host.governance.reports_open.contains(&key);
        let mut pane = div()
            .id(format!("governance-report-body-{key}"))
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(
                button(
                    format!("governance-report-{key}"),
                    if open {
                        "Chiudi report integrale"
                    } else {
                        "Leggi report integrale"
                    },
                    self.theme,
                    false,
                    true,
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    if !this.local_host.governance.reports_open.remove(&key) {
                        this.local_host.governance.reports_open.insert(key.clone());
                    }
                    cx.notify();
                })),
            );
        if open {
            pane = pane
                .child(fact(
                    "File JSON sulla postazione",
                    missing(json_path),
                    self.theme,
                ))
                .child(fact(
                    "File Markdown sulla postazione",
                    missing(markdown_path),
                    self.theme,
                ));
            pane = pane.child(fact(
                "Report JSON",
                if report.is_null() {
                    "Nessun report disponibile".into()
                } else {
                    serde_json::to_string_pretty(report).unwrap_or_default()
                },
                self.theme,
            ));
            pane = pane.child(fact(
                "Report Markdown",
                markdown.unwrap_or("Contenuto non disponibile dal servizio"),
                self.theme,
            ));
        }
        pane
    }
    pub(in crate::shell) fn read_governance(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.operation = Operation::Reading;
        self.local_host.governance.snapshot = None;
        self.local_host.governance.reports_open.clear();
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
            pane = pane.child(section("governance-providers", "Provider", theme))
                .child(text!("La configurazione dichiarata non prova un’esecuzione corrente. Sede e uscita effettive richiedono la prova della singola operazione."));
            for provider in &registry.provider_disclosure.providers {
                let mut provider_pane = div()
                    .id(format!("governance-provider-{}", provider.id))
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(text!(provider.label.clone()));
                if provider.id == "athena_mlx" {
                    provider_pane =
                        provider_pane.child(text!("Non disponibile in questa versione"));
                }
                provider_pane = provider_pane.child(fact(
                    "Accesso",
                    provider.declared["accessBoundary"]
                        .as_str()
                        .map(label)
                        .unwrap_or("Non indicato"),
                    theme,
                ));
                for (title, data) in [
                    ("Dichiarato", &provider.declared),
                    ("Effettivo", &provider.effective),
                ] {
                    let mut phase = div()
                        .id(title)
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .child(text!(title));
                    for (key, title) in [
                        ("lifecycle", "Stato"),
                        ("runtimeObservation", "Osservazione"),
                        ("venue", "Sede"),
                        ("egress", "Uscita dati"),
                        ("credentialClass", "Credenziale"),
                        ("executionDisposition", "Esecuzione"),
                    ] {
                        phase = phase.child(fact(
                            title,
                            data[key].as_str().map(label).unwrap_or("Non osservato"),
                            theme,
                        ));
                    }
                    provider_pane = provider_pane.child(phase);
                }
                pane = pane.child(provider_pane);
            }
            for row in &registry.capabilities {
                let treatment = row.id == "treatment_reasoning";
                pane = pane.child(
                    div()
                        .id(format!("governance-capability-{}", row.id))
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
                pane = pane.child(
                    div()
                        .id(format!("governance-row-{}", row.venue))
                        .child(fact(
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
                        )),
                );
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
            pane = pane.child(self.governance_report(
                "parliament",
                report.json_path.as_deref(),
                report.markdown_path.as_deref(),
                None,
                &report.complete_report,
                cx,
            ));
            if let Some(scorecard) = &report.report.scorecard {
                if let Some(summary) = &scorecard.summary {
                    for (title, name, model, score) in [
                        (
                            "Qualità migliore",
                            "bestQualityLabel",
                            "bestQualityModel",
                            "bestQualityScore",
                        ),
                        (
                            "Rapporto qualità/costo",
                            "bestValueLabel",
                            "bestValueModel",
                            "bestValueScore",
                        ),
                        (
                            "Alternativa qualità/costo",
                            "bestValueChallengerLabel",
                            "bestValueChallengerModel",
                            "bestValueChallengerScore",
                        ),
                        (
                            "Più veloce",
                            "fastestLabel",
                            "fastestModel",
                            "fastestAvgLatencyMs",
                        ),
                    ] {
                        let mut summary_row = div()
                            .id(format!("governance-summary-{name}"))
                            .flex()
                            .flex_col()
                            .child(fact(
                                title,
                                summary[name]
                                    .as_str()
                                    .or(summary[model].as_str())
                                    .unwrap_or("Non misurato"),
                                theme,
                            ));
                        if let Some(value) = summary[score].as_f64() {
                            summary_row = summary_row.child(fact(
                                if score == "fastestAvgLatencyMs" {
                                    "Latenza media (ms)"
                                } else {
                                    "Punteggio"
                                },
                                value.to_string(),
                                theme,
                            ));
                        }
                        pane = pane.child(summary_row);
                    }
                }
                if scorecard.summary.is_none() {
                    pane = pane.child(text!(
                        "Riepilogo qualità, costo e velocità non disponibile nel report."
                    ));
                }
                for row in &scorecard.lanes {
                    let row_pane = div()
                        .id(format!("governance-scorecard-{}", row.lane))
                        .flex()
                        .flex_col()
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
                    pane = pane.child(row_pane);
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
                pane = pane.child(div().id(format!("governance-row-{}", row.lane)).child(fact(
                    label(&row.lane),
                    if row.lane == "treatment_reasoning" {
                        "Non disponibile in questa versione"
                    } else if row.state == "disabled" {
                        "Spenta nelle impostazioni"
                    } else {
                        "Non spenta nelle impostazioni, disponibilità da verificare"
                    },
                    theme,
                )));
            }
            for row in &rollout.lanes {
                let mut row_pane = div()
                    .id(format!("governance-rollout-{}", row.lane))
                    .flex()
                    .flex_col()
                    .gap(px(8.));
                row_pane = row_pane.child(fact("Attività", label(&row.lane), theme));
                row_pane = row_pane.child(self.governance_report(
                    &row.lane,
                    row.json_path.as_deref(),
                    row.markdown_path.as_deref(),
                    row.markdown.as_deref(),
                    &row.complete_report,
                    cx,
                ));
                let Some(report) = &row.report else {
                    row_pane = row_pane.child(fact(
                        "Verifica",
                        if row.error.is_some() {
                            "Report non leggibile. Nessun esito disponibile."
                        } else {
                            "Nessuna verifica salvata. Non considerarla pronta."
                        },
                        theme,
                    ));
                    pane = pane.child(row_pane);
                    continue;
                };
                row_pane = row_pane
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
                    row_pane = row_pane
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
                    for (index, issue) in issues.iter().enumerate() {
                        row_pane =
                            row_pane.child(div().id(format!("{title}-{index}")).child(fact(
                                title,
                                format!(
                                    "{}: {}",
                                    missing(issue.id.as_deref()),
                                    missing(issue.message.as_deref())
                                ),
                                theme,
                            )));
                    }
                }
                if report.blockers.is_empty() {
                    row_pane = row_pane.child(text!(
                        "Nessun blocco riportato. Non equivale a un’autorizzazione all’uso."
                    ));
                }
                pane = pane.child(row_pane);
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
    fn governance_integral_report_disclosure_and_lock(cx: &mut gpui::TestAppContext) {
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
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Governance;
            app.local_host.authority = Authority::Open(access);
            let mut data = snapshot();
            data.parliament.as_mut().unwrap().complete_report =
                serde_json::json!({"sample": "Synthetic full report tail"});
            app.local_host.governance.snapshot = Some(data);
        });
        for open in [false, true] {
            view.update(cx, |app, _| {
                if open {
                    app.local_host
                        .governance
                        .reports_open
                        .insert("parliament".into());
                }
            });
            rendered_command::take_text_nodes();
            let ids = rendered_command::button_ids(|| {
                cx.update(|window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                })
            });
            assert!(ids.contains(&"governance-report-parliament".to_owned()));
            let nodes = rendered_command::take_text_nodes();
            assert_eq!(
                nodes.iter().any(|(_, n)| n
                    .value()
                    .is_some_and(|v| v.contains("Synthetic full report tail"))),
                open
            );
            if open {
                assert!(nodes.iter().any(|(_, n)| n.value()
                    == Some("Report Markdown: Contenuto non disponibile dal servizio")));
            }
        }
        view.update(cx, |app, cx| {
            app.withdraw_local_host(cx);
            assert!(app.local_host.governance.reports_open.is_empty());
            assert!(app.local_host.governance.snapshot.is_none());
        });
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
                let mut text_ids = HashSet::new();
                assert!(
                    nodes.iter().all(|(id, _)| text_ids.insert(id.clone())),
                    "duplicate text IDs"
                );
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
