use super::*;
use mediflow_runtime_client::AuditFilter;
const LABELS: [&str; 5] = [
    "Tipo evento esatto (facoltativo)",
    "Tipo oggetto esatto (facoltativo)",
    "Riferimento attore (facoltativo)",
    "Esito: success, failure o denied (facoltativo)",
    "Numero massimo di eventi, da 1 a 200",
];
pub(super) struct AuditArea {
    fields: Vec<Entity<TextInput>>,
    origin: usize,
    applied: AuditFilter,
    message: Option<String>,
}
impl AuditArea {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        let fields = LABELS
            .into_iter()
            .enumerate()
            .map(|(i, label)| {
                cx.new(|cx| {
                    TextInput::new(
                        [
                            "audit-event-type",
                            "audit-subject-type",
                            "audit-actor-ref",
                            "audit-outcome",
                            "audit-limit",
                        ][i],
                        label,
                        label,
                        false,
                        theme,
                        cx,
                    )
                })
            })
            .collect::<Vec<_>>();
        fields[4].update(cx, |f, cx| f.set_content("50", cx));
        Self {
            fields,
            origin: 0,
            applied: AuditFilter::default(),
            message: None,
        }
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) {
        for f in &self.fields {
            f.update(cx, |f, cx| f.retire(cx));
        }
        self.origin = 0;
        self.applied = AuditFilter::default();
        self.message = None;
        self.fields[4].update(cx, |f, cx| f.set_content("50", cx));
    }
    pub(super) fn configure(&mut self, theme: Theme, busy: bool, cx: &mut Context<ClinicalApp>) {
        for f in &self.fields {
            f.update(cx, |f, cx| f.configure(theme, busy, cx));
        }
    }
    pub(super) fn filter(&self, cx: &App) -> Result<AuditFilter, RuntimeError> {
        let value = |i: usize| self.fields[i].read(cx).value().trim().to_owned();
        let filter = AuditFilter {
            event_type: value(0),
            subject_type: value(1),
            actor_ref: value(2),
            outcome: value(3),
            origin: ["local", "imported", "unattested"][self.origin].into(),
            limit: value(4).parse().map_err(|_| RuntimeError::InvalidInput)?,
        };
        if filter.valid() {
            Ok(filter)
        } else {
            Err(RuntimeError::InvalidInput)
        }
    }
    pub(super) fn set_applied(&mut self, filter: AuditFilter) {
        self.applied = filter;
        self.message = None;
    }
}
impl ClinicalApp {
    fn read_audit_filters(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() || self.local_host.controls.snapshot.is_none() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let filter = match self.local_host.controls.audit.filter(cx) {
            Ok(f) => f,
            Err(e) => {
                self.local_host.controls.audit.message = Some(ui_error(e));
                cx.notify();
                return;
            }
        };
        let applied = filter.clone();
        self.local_host.operation = Operation::Reading;
        self.run_local_host(
            move || match access.read_filtered_audit(&filter) {
                Err(error) if error.retires_session() || error.status_code() == Some(401) => {
                    Err(error)
                }
                result => Ok(result),
            },
            move |this, result, cx| {
                this.local_host.operation = Operation::Idle;
                match result {
                    Ok(audit) => {
                        this.local_host.controls.audit.set_applied(applied);
                        if let Some(snapshot) = &mut this.local_host.controls.snapshot {
                            snapshot.audit = audit;
                        }
                    }
                    Err(e) => this.local_host.operation = Operation::Failed(ui_error(e)),
                }
                cx.notify();
            },
            cx,
        );
    }
    pub(in crate::shell::local_host::controls) fn audit_filters_view(
        &self,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        let a = &self.local_host.controls.audit;
        let theme = self.theme;
        let enabled = !self.local_host.has_work();
        let mut pane=div().id("audit-filters").flex().flex_col().gap(px(8.))
            .child(text!("I filtri si applicano alla prossima lettura. Il numero richiesto limita il campione e non rappresenta l’intero storico."));
        for (i, field) in a.fields.iter().enumerate() {
            pane = pane.child(
                div()
                    .id(("audit-field", i))
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(text!(LABELS[i]))
                    .child(field.clone()),
            );
        }
        let mut origins = div().id("audit-origin").flex().flex_wrap().gap(px(6.));
        for (i, label) in [
            "Registrati localmente",
            "Importati",
            "Provenienza non attestata",
        ]
        .into_iter()
        .enumerate()
        {
            origins = origins.child(
                button(
                    format!("audit-origin-{i}"),
                    label,
                    theme,
                    a.origin == i,
                    enabled,
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    if !this.local_host.has_work() {
                        this.local_host.controls.audit.origin = i;
                        cx.notify();
                    }
                })),
            );
        }
        pane = pane.child(origins).child(
            button(
                "audit-apply",
                "Applica filtri e rileggi audit",
                theme,
                false,
                enabled,
            )
            .on_click(cx.listener(|this, _, _, cx| this.read_audit_filters(cx))),
        );
        if let Some(message) = &a.message {
            pane = pane.child(notice("audit-filter-error", message.clone(), theme, true));
        }
        let f = &a.applied;
        pane = pane
            .child(governance::fact(
                "Origine richiesta nell’ultima lettura",
                match f.origin.as_str() {
                    "imported" => "Importati",
                    "unattested" => "Provenienza non attestata",
                    _ => "Registrati localmente",
                },
                theme,
            ))
            .child(governance::fact(
                "Limite dell’ultima lettura",
                f.limit.to_string(),
                theme,
            ));
        for (label, value) in [
            ("Tipo evento applicato", &f.event_type),
            ("Tipo oggetto applicato", &f.subject_type),
            ("Attore applicato", &f.actor_ref),
            ("Esito applicato", &f.outcome),
        ] {
            pane = pane.child(governance::fact(
                label,
                if value.is_empty() { "Tutti" } else { value },
                theme,
            ));
        }
        if self
            .local_host
            .controls
            .snapshot
            .as_ref()
            .and_then(|s| s.audit.as_ref().ok())
            .and_then(Value::as_array)
            .is_some_and(|rows| rows.len() >= usize::from(f.limit))
        {
            pane = pane.child(text!(
                "Raggiunto il limite richiesto: lo storico può contenere altri eventi."
            ));
        }
        pane
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[gpui::test]
    fn audit_edits_apply_only_on_request_and_invalid_limits_preserve_previous_rows(
        cx: &mut gpui::TestAppContext,
    ) {
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
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.local_host.authority = Authority::Open(access);
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Controls;
            app.local_host.controls.snapshot = Some(ControlsSnapshot {
                updates: Err(RuntimeError::Missing),
                revision: Err(RuntimeError::Missing),
                audit: Ok(serde_json::json!([])),
                redaction: Err(RuntimeError::Missing),
            });
            app.local_host.controls.audit.fields[4].update(cx, |f, cx| f.set_content("0", cx));
            app.read_audit_filters(cx);
            assert!(app.local_host.controls.audit.message.is_some());
            assert_eq!(app.local_host.controls.audit.applied.limit, 50);
        });
        let before = host.request_count();
        notes_recovery_tests::draw(cx);
        assert_eq!(host.request_count(), before);
        let rows = serde_json::json!([{"eventId":"synthetic","eventType":"settings.updated","occurredAt":"2026-11-01T00:00:00.000Z","outcome":"success"}]);
        host.plan("GET /api/system/audit?origin=local&limit=1&eventType=settings.updated")
            .send((200, rows.clone()))
            .unwrap();
        view.update(cx, |app, cx| {
            app.local_host.controls.audit.fields[4].update(cx, |f, cx| f.set_content("1", cx));
            app.local_host.controls.audit.fields[0]
                .update(cx, |f, cx| f.set_content("settings.updated", cx));
            app.read_audit_filters(cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert_eq!(
                app.local_host
                    .controls
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .audit
                    .as_ref()
                    .unwrap(),
                &rows
            );
            assert_eq!(
                app.local_host.controls.audit.applied.event_type,
                "settings.updated"
            );
            app.local_host.controls.audit.fields[0]
                .update(cx, |f, cx| f.set_content("other.event", cx));
            assert_eq!(
                app.local_host.controls.audit.applied.event_type,
                "settings.updated"
            );
            app.local_host.controls.audit.fields[4].update(cx, |f, cx| f.set_content("201", cx));
            app.read_audit_filters(cx);
            assert_eq!(
                app.local_host
                    .controls
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .audit
                    .as_ref()
                    .unwrap(),
                &rows
            );
            app.withdraw_local_host(cx);
            assert!(app.local_host.controls.snapshot.is_none());
        });
        assert_eq!(host.request_count(), before + 1);
    }
}
