//! Explicit, read-only WHO consultation through the paired host. A result
//! belongs to one query generation, area, scope and connection; it never writes.

use super::*;
use crate::theme::TypeStyle;
use mediflow_runtime_client::{
    WHO_ATTRIBUTION, WhoReadiness, WhoReadinessStatus, WhoSearchResponse, WhoSource,
    normalize_who_query,
};

pub(super) struct WhoLookup {
    revision: u64,
    query: Option<String>,
    readiness: Load<WhoReadiness>,
    rows: Load<WhoSearchResponse>,
    read: ScrollTarget,
    cancel: ScrollTarget,
    results: Vec<ScrollTarget>,
}

impl WhoLookup {
    pub(super) fn new(scroll: &ScrollHandle, cx: &App) -> Self {
        Self {
            revision: 0,
            query: None,
            readiness: Load::Idle,
            rows: Load::Idle,
            read: ScrollTarget::new(scroll, cx),
            cancel: ScrollTarget::new(scroll, cx),
            results: vec![],
        }
    }

    fn clear_results(&mut self) {
        self.revision = self
            .revision
            .checked_add(1)
            .expect("WHO request generation exhausted");
        self.query = None;
        self.rows = Load::Idle;
        self.results.clear();
        if matches!(self.readiness, Load::Loading) {
            self.readiness = Load::Idle;
        }
    }

    pub(super) fn reset(&mut self) {
        self.clear_results();
        self.readiness = Load::Idle;
    }

    fn busy(&self) -> bool {
        matches!(self.readiness, Load::Loading) || matches!(self.rows, Load::Loading)
    }

    pub(super) fn reveal_if_focused(&self, window: &mut Window, cx: &mut App) -> bool {
        self.read.reveal_if_focused(window, cx)
            || self.cancel.reveal_if_focused(window, cx)
            || self
                .results
                .iter()
                .any(|target| target.reveal_if_focused(window, cx))
    }
}

#[derive(Clone)]
struct WhoToken {
    authority: u64,
    epoch: u64,
    revision: u64,
    query: Option<String>,
}

enum WhoResult {
    Readiness(Result<WhoReadiness, RuntimeError>),
    Search(Result<WhoSearchResponse, RuntimeError>),
}

impl ClinicalApp {
    pub(super) fn who_query_changed(&mut self) {
        if self.reference_kind == ReferenceKind::Who {
            self.who.clear_results();
        }
    }

    fn begin_who(&mut self, query: Option<String>) -> WhoToken {
        self.who.clear_results();
        if query.is_some() {
            self.who.rows = Load::Loading;
        } else {
            self.who.readiness = Load::Loading;
        }
        self.who.query = query.clone();
        WhoToken {
            authority: self.account_profile.generation,
            epoch: self.epoch,
            revision: self.who.revision,
            query,
        }
    }

    fn current_who(&self, token: &WhoToken, cx: &App) -> bool {
        self.account_profile.generation == token.authority
            && self.area == Area::References
            && self.reference_kind == ReferenceKind::Who
            && self.epoch == token.epoch
            && self.who.revision == token.revision
            && self.who.query == token.query
            && token.query.as_ref().is_none_or(|query| {
                normalize_who_query(self.reference_search.read(cx).value()).as_ref() == Ok(query)
            })
    }

    fn receive_who(&mut self, token: WhoToken, result: WhoResult, cx: &mut Context<Self>) -> bool {
        let error = match &result {
            WhoResult::Readiness(result) => result.as_ref().err().copied(),
            WhoResult::Search(result) => result.as_ref().err().copied(),
        };
        match self.check_callback(token.authority, error, cx) {
            CallbackState::StaleAuthority => return false,
            CallbackState::Retired => return true,
            CallbackState::Current => {}
        }
        if !self.current_who(&token, cx) {
            return false;
        }
        if error.is_some() {
            self.who.readiness = Load::Idle;
        }
        match result {
            WhoResult::Readiness(result) => {
                self.who.readiness = who_load(result);
            }
            WhoResult::Search(result) => {
                self.who.results = result.as_ref().map_or_else(
                    |_| vec![],
                    |rows| {
                        rows.entries
                            .iter()
                            .map(|_| ScrollTarget::new(&self.area_scroll, cx))
                            .collect()
                    },
                );
                self.who.rows = who_load(result);
            }
        }
        true
    }

    pub(super) fn request_who(&mut self, search: bool, cx: &mut Context<Self>) {
        let (Some(session), Some(scope)) = (self.session.clone(), self.scope.clone()) else {
            return;
        };
        if self.who.busy()
            || self.area != Area::References
            || self.reference_kind != ReferenceKind::Who
        {
            return;
        }
        let query = if search {
            match normalize_who_query(self.reference_search.read(cx).value()) {
                Ok(query) => Some(query),
                Err(_) => return,
            }
        } else {
            None
        };
        let token = self.begin_who(query.clone());
        let task = cx.background_executor().spawn(async move {
            match query {
                Some(query) => WhoResult::Search(session.search_who(&scope, &query)),
                None => WhoResult::Readiness(session.read_who_readiness(&scope)),
            }
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                if this.receive_who(token, result, cx) {
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
    }

    fn copy_who_reference(&mut self, token: WhoToken, index: usize, cx: &mut Context<Self>) {
        if !self.current_who(&token, cx) {
            return;
        }
        if let Some(rows) = self.who.rows.ready()
            && let Some(entry) = rows.entries.get(index)
        {
            let receipt = &rows.receipt;
            let copied = format!(
                "{} · {}\n{}\n{}\nRelease: {} · Lingua: {}\nFonte: {}\nAcquisito: {}\nScadenza: {}\nRisultati parziali: {}\nBinding: {}\nImmagine: {}\nDataset: {}",
                entry.system,
                entry.code,
                entry.description,
                entry.canonical_uri,
                receipt.release_id,
                receipt.language,
                source_label(receipt.source),
                receipt.fetched_at,
                receipt.expires_at,
                rows.partial,
                receipt.binding_id,
                receipt.image_digest,
                receipt.dataset_snapshot_id,
            );
            cx.write_to_clipboard(ClipboardItem::new_string(format!(
                "{copied}\n{WHO_ATTRIBUTION}"
            )));
        }
    }

    pub(super) fn who_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let busy = self.who.busy();
        let can_read = self.scope.is_some() && !busy;
        let query_valid = normalize_who_query(self.reference_search.read(cx).value()).is_ok();
        let can_search = can_read && query_valid;
        let token = WhoToken {
            authority: self.account_profile.generation,
            epoch: self.epoch,
            revision: self.who.revision,
            query: self.who.query.clone(),
        };
        let mut pane = div().min_w_0().max_w_full().flex().flex_col().gap(px(16.))
            .child(heading("clinical-workspace-who-heading", crate::title::TitleText::code("ICD-11 WHO"), theme))
            .child(who_text("clinical-who-introduction", "Repertorio in inglese · release 2026-01. Questo percorso consulta il servizio WHO locale sul computer che ospita l’archivio.", theme))
            .child(self.who.read.attach_enabled(button("clinical-workspace-who-readiness", "Leggi stato del servizio", theme, false, can_read), can_read)
                .when(can_read, |el| el.on_click(cx.listener(|this, _, _, cx| this.request_who(false, cx)))))
            .child(who_text("clinical-who-readiness-explanation", "La lettura dello stato riporta l’ultima osservazione disponibile; non avvia una verifica del servizio.", theme));
        pane = match &self.who.readiness {
            Load::Idle => pane.child(notice(
                "clinical-workspace-who-state",
                "Stato del servizio non ancora letto.",
                theme,
                false,
            )),
            Load::Loading => pane.child(notice(
                "clinical-workspace-who-state",
                "Lettura dello stato in corso…",
                theme,
                false,
            )),
            Load::Failed(message) => pane.child(notice(
                "clinical-workspace-who-state",
                message.clone(),
                theme,
                true,
            )),
            Load::Ready(readiness) => pane
                .child(notice(
                    "clinical-workspace-who-state",
                    readiness_label(readiness),
                    theme,
                    readiness.status == WhoReadinessStatus::Unavailable,
                ))
                .when_some(readiness.last_live_observed_at.as_ref(), |el, date| {
                    el.child(who_text(
                        "clinical-who-last-observed",
                        format!("Ultima risposta osservata: {}", display_appointment(date)),
                        theme,
                    ))
                })
                .when_some(readiness.last_result_source, |el, source| {
                    el.child(who_text(
                        "clinical-who-last-source",
                        format!("Ultima origine riportata: {}", source_label(source)),
                        theme,
                    ))
                }),
        };
        pane = pane
            .child(who_text("clinical-who-search-help", "Cerca un termine clinico in inglese o un codice. I titoli originali non vengono tradotti.", theme))
            .child(div().min_w_0().flex().flex_wrap().gap(px(8.))
                .when(self.text_scale >= 2.5, |el| el.flex_col().items_stretch())
                .child(self.reference_search_target.attach_enabled(div().id("clinical-workspace-reference-search-anchor").flex_1().min_w(px(160.)).max_w_full().child(self.reference_search.clone()), false))
                .child(self.reference_run_target.attach_enabled(button("clinical-workspace-reference-run-search", "Cerca in ICD-11 WHO", theme, true, can_search), can_search)
                    .when(can_search, |el| el.on_click(cx.listener(|this, _, _, cx| this.request_who(true, cx))))))
            .when(!query_valid && !self.reference_search.read(cx).value().is_empty(), |el| el.child(notice("clinical-workspace-who-query-hint", "Usa una ricerca breve, senza simboli di marcatura o caratteri invisibili. Riduci il testo e riprova.", theme, false)))
            .when(busy || !matches!(self.who.rows, Load::Idle), |el| el.child(
                self.who.cancel.attach_enabled(button("clinical-workspace-who-cancel", if busy {"Annulla richiesta"} else {"Cancella risultati"}, theme, false, true), true)
                    .on_click(cx.listener(|this, _, _, cx| { this.who.clear_results(); cx.notify(); }))));
        match &self.who.rows {
            Load::Idle => {}
            Load::Loading => {
                pane = pane.child(notice(
                    "clinical-workspace-who-search-state",
                    "Ricerca nel servizio WHO in corso…",
                    theme,
                    false,
                ))
            }
            Load::Failed(message) => {
                pane = pane.child(notice(
                    "clinical-workspace-who-search-state",
                    message.clone(),
                    theme,
                    true,
                ))
            }
            Load::Ready(rows) => {
                let receipt = &rows.receipt;
                pane = pane
                    .child(who_text("clinical-who-result-count", format!("{} risultati per «{}»", rows.entries.len(), self.who.query.as_deref().unwrap_or_default()), theme))
                    .child(who_text("clinical-who-receipt-source", format!("{} · Inglese · Release {}", source_label(receipt.source), receipt.release_id), theme))
                    .child(who_text("clinical-who-receipt-time", format!("Acquisito: {} · Scadenza: {}", display_appointment(&receipt.fetched_at), display_appointment(&receipt.expires_at)), theme))
                    .when(rows.partial, |el| el.child(notice("clinical-workspace-who-partial", "Risultati parziali. Affina la ricerca per trovare altri riferimenti; vengono mostrate al massimo 25 voci.", theme, false)))
                    .when(rows.entries.is_empty(), |el| el.child(notice("clinical-workspace-who-empty", "Nessun risultato per questa ricerca. Prova altri termini in inglese.", theme, false)))
                    .children(rows.entries.iter().enumerate().map(|(index, entry)| {
                        let token = token.clone();
                        div().id(SharedString::from(format!("clinical-workspace-who-result-{}", entry.code)))
                            .min_w_0().max_w_full().border_b_1().border_color(theme.rule).py(px(12.)).flex().flex_col().gap(px(8.))
                            .child(who_text("clinical-who-result-code", format!("ICD-11 · {}", entry.code), theme))
                            .child(div().type_role(theme, crate::theme::TextRole::Strong).child(text!(entry.description.clone())))
                            .child(self.who.results[index].attach_enabled(button(format!("clinical-workspace-who-copy-{index}"), format!("Copia riferimento {}", entry.code), theme, false, true), true)
                                .on_click(cx.listener(move |this, _, _, cx| this.copy_who_reference(token.clone(), index, cx))))
                    }));
            }
        }
        pane.child(who_text("clinical-who-attribution", WHO_ATTRIBUTION, theme))
            .child(who_text("clinical-who-copy-help", "La copia conserva codice, titolo, riferimento e provenienza. Non modifica la scheda del paziente.", theme))
            .child(button("clinical-workspace-who-web", "Catalogo incorporato e controllo codice…", theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| this.open_current(Area::References.current_path(), cx))))
            .child(who_text("clinical-who-web-help", "Il catalogo incorporato e il controllo puntuale dei codici sono disponibili nell’interfaccia web. Non vengono usati automaticamente da questa ricerca.", theme))
    }
}

fn who_load<T>(result: Result<T, RuntimeError>) -> Load<T> {
    match result {
        Ok(value) => Load::Ready(value),
        Err(RuntimeError::InvalidResponse | RuntimeError::TooLarge) => Load::Failed("La risposta WHO non è verificabile o supera il limite. Prova termini più specifici oppure verifica il servizio sul computer dell’archivio.".into()),
        Err(RuntimeError::Transport) => Load::Failed("Il servizio WHO non è raggiungibile o non è disponibile. Verifica il servizio sul computer dell’archivio e riprova quando è pronto.".into()),
        Err(RuntimeError::ReadRequired | RuntimeError::Conflict) => Load::Failed("Il contesto dell’archivio è cambiato durante la consultazione. Rileggi lo stato del servizio e riprova.".into()),
        Err(error) => Load::Failed(ui_error(error)),
    }
}

fn source_label(source: WhoSource) -> &'static str {
    match source {
        WhoSource::Live => "Risposta del servizio locale",
        WhoSource::Cache => "Risultato conservato dal servizio locale",
    }
}

fn readiness_label(readiness: &WhoReadiness) -> &'static str {
    match readiness.status {
        WhoReadinessStatus::Disabled => {
            "Servizio WHO disattivato. Per usarlo, chiedi al responsabile del computer dell’archivio di attivarlo."
        }
        WhoReadinessStatus::ConfigurationRequired => {
            "Servizio WHO da configurare. Chiedi al responsabile del computer dell’archivio di completare la configurazione."
        }
        WhoReadinessStatus::Configured => {
            "Servizio WHO configurato. Non è ancora stata osservata una risposta recente: la disponibilità non è confermata."
        }
        WhoReadinessStatus::Available => {
            "Il computer dell’archivio ha osservato una risposta recente del servizio WHO."
        }
        WhoReadinessStatus::Unavailable => {
            "Servizio WHO non disponibile. Chiedi al responsabile del computer dell’archivio di verificarlo e poi riprova."
        }
    }
}

fn who_text(id: &'static str, label: impl Into<SharedString>, theme: Theme) -> Stateful<Div> {
    let label: SharedString = label.into();
    div()
        .id(id)
        .min_w_0()
        .max_w_full()
        .whitespace_normal()
        .text_color(theme.secondary)
        .child({
            let text = text!(label);
            #[cfg(test)]
            let text = crate::shell::rendered_command::observe_text(text);
            text
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn restore_result(search: bool, error: RuntimeError) -> WhoResult {
        if search {
            WhoResult::Search(Err(error))
        } else {
            WhoResult::Readiness(Err(error))
        }
    }

    fn callback_restore(
        cx: &mut gpui::TestAppContext,
        search: bool,
        stale_query: bool,
        retained_reason: bool,
    ) {
        let host = crate::shell::notes_recovery_tests::Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let (token, editor) = view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.area = Area::References;
            app.reference_kind = ReferenceKind::Who;
            app.reference_search
                .update(cx, |input, cx| input.set_content("synthetic", cx));
            let editor = app.account_profile.synthetic_draft(cx);
            let token = if retained_reason {
                app.begin_who(search.then(|| "synthetic".into()))
            } else {
                host.replace_archive();
                app.request_who(search, cx);
                WhoToken {
                    authority: app.account_profile.generation,
                    epoch: app.epoch,
                    revision: app.who.revision,
                    query: app.who.query.clone(),
                }
            };
            if stale_query {
                app.reference_search
                    .update(cx, |input, cx| input.set_content("different", cx));
                app.who_query_changed();
            }
            (token, editor)
        });
        if retained_reason {
            host.replace_archive();
            let result = if search {
                host.session.search_who("scope-a", "synthetic").map(|_| ())
            } else {
                host.session.read_who_readiness("scope-a").map(|_| ())
            };
            assert_eq!(result, Err(RuntimeError::ArchiveReplaced));
            view.update(cx, |app, cx| {
                app.receive_who(token, restore_result(search, RuntimeError::Transport), cx);
            });
        }
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(
                app.session.is_none(),
                "WHO callback lost current-authority restore"
            );
            assert!(app.form.is_none());
            assert!(app.scope.is_none());
            assert!(app.selected_id.is_none());
            assert!(matches!(app.who.readiness, Load::Idle));
            assert!(matches!(app.who.rows, Load::Idle));
            assert!(
                app.message
                    .as_ref()
                    .unwrap()
                    .0
                    .contains(&ui_error(RuntimeError::ArchiveReplaced))
            );
        });
        editor.read_with(cx, |input, _| {
            assert!(input.value().is_empty());
            assert!(input.read_only);
        });
        let requests = host.request_count();
        assert_eq!(
            host.session
                .update_patient_notes("scope-a", "patient-a", 1, "late write"),
            Err(RuntimeError::Locked)
        );
        assert_eq!(host.request_count(), requests);
    }

    fn old_authority(cx: &mut gpui::TestAppContext, search: bool) {
        let old = crate::shell::notes_recovery_tests::Host::new();
        let fresh = crate::shell::notes_recovery_tests::Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.session = Some(old.session.clone());
            let old_token = app.begin_who(search.then(|| "synthetic".into()));
            app.disconnect(cx);
            app.session = Some(fresh.session.clone());
            app.message = None;
            app.scope = Some("scope-a".into());
            pending(app, cx);
            let editor = app.account_profile.synthetic_draft(cx);
            assert!(!app.receive_who(
                old_token,
                restore_result(search, RuntimeError::ArchiveReplaced),
                cx
            ));
            assert!(
                app.session
                    .as_ref()
                    .is_some_and(|session| !session.is_locked())
            );
            assert_eq!(editor.read(cx).value(), "Bozza account sintetica");
            assert!(app.message.is_none());
            assert!(matches!(app.who.rows, Load::Loading));
        });
        cx.run_until_parked();
        let requests = old.request_count();
        assert_eq!(
            old.session
                .update_patient_notes("scope-a", "patient-a", 1, "late write"),
            Err(RuntimeError::Locked)
        );
        assert_eq!(old.request_count(), requests);
        assert!(
            fresh
                .session
                .can_write("network.replica.write-patient-profile")
        );
    }

    #[gpui::test]
    fn g1a2_r2_who_readiness_current_callback_retires_restore(cx: &mut gpui::TestAppContext) {
        callback_restore(cx, false, false, false);
    }
    #[gpui::test]
    fn g1a2_r2_who_search_current_callback_retires_restore(cx: &mut gpui::TestAppContext) {
        callback_restore(cx, true, false, false);
    }
    #[gpui::test]
    fn g1a2_r2_who_readiness_old_query_same_authority_retires_restore(
        cx: &mut gpui::TestAppContext,
    ) {
        callback_restore(cx, false, true, false);
    }
    #[gpui::test]
    fn g1a2_r2_who_search_old_query_same_authority_retires_restore(cx: &mut gpui::TestAppContext) {
        callback_restore(cx, true, true, false);
    }
    #[gpui::test]
    fn g1a2_r2_who_readiness_consumes_retained_retirement_reason(cx: &mut gpui::TestAppContext) {
        callback_restore(cx, false, true, true);
    }
    #[gpui::test]
    fn g1a2_r2_who_search_consumes_retained_retirement_reason(cx: &mut gpui::TestAppContext) {
        callback_restore(cx, true, true, true);
    }
    #[gpui::test]
    fn g1a2_r2_who_readiness_old_authority_preserves_new_session_and_draft(
        cx: &mut gpui::TestAppContext,
    ) {
        old_authority(cx, false);
    }
    #[gpui::test]
    fn g1a2_r2_who_search_old_authority_preserves_new_session_and_draft(
        cx: &mut gpui::TestAppContext,
    ) {
        old_authority(cx, true);
    }

    #[gpui::test]
    fn who_text_accessible_ids(cx: &mut gpui::TestAppContext) {
        let mut app: Option<Entity<ClinicalApp>> = None;
        rendered_command::assert_unique_texts(
            cx,
            move |window, cx| {
                let app = app.get_or_insert_with(|| {
                    cx.new(|cx| {
                        let mut app = ClinicalApp::new(String::new(), window, cx);
                        let token = pending(&mut app, cx);
                        assert!(app.receive_who(token, WhoResult::Search(Ok(response(false))), cx));
                        app
                    })
                });
                app.update(cx, |app, cx| app.who_view(cx).into_any_element())
            },
            10,
        );
    }

    fn response(empty: bool) -> WhoSearchResponse {
        serde_json::from_value(json!({
            "schemaVersion":"mediflow.reference-data.icd11-search-response.v2",
            "entries":if empty {json!([])} else {json!([{"code":"TEST1","description":"Synthetic English title",
                "system":"ICD-11","canonicalUri":"http://id.who.int/icd/release/11/2026-01/mms/123"}])},
            "partial":true,"receipt":{"schemaVersion":"mediflow.reference-data.icd11-search-receipt.v2",
                "operation":"mediflow.reference_data.icd11.search.v2","releaseId":"2026-01","language":"en",
                "deployment":"local","bindingId":"who.icd11.v2.2026-01.mms.en.local.v1",
                "imageDigest":format!("sha256:{}", "a".repeat(64)),"datasetSnapshotId":format!("sha256:{}", "b".repeat(64)),
                "source":"cache","resultCount":if empty {0} else {1},"latencyMs":1,
                "fetchedAt":"2026-10-19T00:00:00.000Z","expiresAt":"2026-10-20T00:00:00.000Z",
                "completedAt":"2026-10-19T01:00:00.000Z"}
        })).unwrap()
    }

    fn pending(app: &mut ClinicalApp, cx: &mut Context<ClinicalApp>) -> WhoToken {
        app.area = Area::References;
        app.reference_kind = ReferenceKind::Who;
        app.reference_search
            .update(cx, |input, cx| input.set_content("synthetic", cx));
        app.begin_who(Some("synthetic".into()))
    }

    #[gpui::test]
    fn who_query_cancel_area_and_epoch_retire_prior_results(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            let old = pending(app, cx);
            for query in ["other", "synthetic"] {
                app.reference_search
                    .update(cx, |input, cx| input.set_content(query, cx));
                app.who_query_changed();
            }
            assert!(!app.receive_who(old, WhoResult::Search(Ok(response(false))), cx));
            let token = pending(app, cx);
            app.who.clear_results();
            app.disconnect(cx);
            pending(app, cx);
            assert!(!app.receive_who(
                token,
                WhoResult::Search(Err(RuntimeError::Authentication)),
                cx
            ));
            assert_eq!(app.area, Area::References);
            for leave in [0, 1, 2] {
                let token = pending(app, cx);
                match leave {
                    0 => app.area = Area::Patients,
                    1 => app.reference_kind = ReferenceKind::Drugs,
                    _ => app.next_epoch(),
                }
                assert!(!app.receive_who(token, WhoResult::Search(Ok(response(false))), cx));
            }
            // Check live text as well, before its change event is dispatched.
            let token = pending(app, cx);
            app.reference_search
                .update(cx, |input, cx| input.set_content("different", cx));
            assert!(!app.receive_who(token, WhoResult::Search(Ok(response(false))), cx));
        });
    }

    #[gpui::test]
    fn who_failure_and_current_revocation_clear_the_observed_state(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            pending(app, cx);
            let readiness: WhoReadiness = serde_json::from_value(json!({
                "schemaVersion":"mediflow.reference-data.icd11-who-readiness.v2","status":"configured",
                "releaseId":"2026-01","language":"en","deployment":"local",
                "bindingId":"who.icd11.v2.2026-01.mms.en.local.v1","imageDigest":format!("sha256:{}", "a".repeat(64)),
                "datasetSnapshotId":format!("sha256:{}", "b".repeat(64)),"lastLiveObservedAt":null,"lastResultSource":null
            })).unwrap();
            let token = app.begin_who(None);
            assert!(app.receive_who(token, WhoResult::Readiness(Ok(readiness)), cx));
            let observed = app.who.readiness.ready().unwrap();
            assert_eq!(observed.status, WhoReadinessStatus::Configured);
            assert!(readiness_label(observed).contains("disponibilità non è confermata"));
            let token = pending(app, cx);
            assert!(app.receive_who(token, WhoResult::Search(Err(RuntimeError::Transport)), cx));
            assert!(matches!(app.who.rows, Load::Failed(_)));
            assert!(matches!(app.who.readiness, Load::Idle));
            let token = pending(app, cx);
            assert!(app.receive_who(token, WhoResult::Search(Err(RuntimeError::Authentication)), cx));
            assert!(matches!(app.who.rows, Load::Idle));
            assert!(app.reference_search.read(cx).value().is_empty());
            assert!(app.message.as_ref().unwrap().1);
        });
    }

    #[gpui::test]
    fn who_empty_partial_and_copied_reference_keep_the_returned_source(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            let token = pending(app, cx);
            assert!(app.receive_who(token.clone(), WhoResult::Search(Ok(response(false))), cx));
            app.copy_who_reference(token.clone(), 0, cx);
            let copied = cx.read_from_clipboard().unwrap().text().unwrap();
            for expected in [
                "TEST1",
                "Synthetic English title",
                "http://id.who.int/icd/release/11/2026-01/mms/123",
                "2026-01",
                "Lingua: en",
                "conservato dal servizio locale",
                "Risultati parziali: true",
                "who.icd11.v2.2026-01.mms.en.local.v1",
                WHO_ATTRIBUTION,
            ] {
                assert!(copied.contains(expected), "{expected}");
            }
            assert!(copied.contains(&format!("sha256:{}", "a".repeat(64))));
            assert!(copied.contains(&format!("sha256:{}", "b".repeat(64))));
            app.who.clear_results();
            cx.write_to_clipboard(ClipboardItem::new_string("unchanged".into()));
            app.copy_who_reference(token, 0, cx);
            assert_eq!(
                cx.read_from_clipboard().unwrap().text().as_deref(),
                Some("unchanged")
            );
            let token = pending(app, cx);
            assert!(app.receive_who(token, WhoResult::Search(Ok(response(true))), cx));
            let rows = app.who.rows.ready().unwrap();
            assert!(rows.entries.is_empty() && rows.partial);
            assert_eq!(rows.receipt.source, WhoSource::Cache);
            assert!(app.form.is_none());
        });
    }
}
