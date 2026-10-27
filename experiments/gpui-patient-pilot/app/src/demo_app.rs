//! Explicitly selected process-local demonstration; never a product data source.

use crate::theme::{TypeRole, TypeStyle};
use gpui::{
    App, ClipboardItem, Context, Div, Entity, FocusHandle, Role, SharedString, Stateful,
    Subscription, Window, WindowAppearance, actions, div, prelude::*, px, text,
};
use mediflow_patient_client::{
    ClientError, PatientProfile, Phase, ReadRequest, UpdateOutcome, Workspace,
};

use crate::demo::{DemoService, Scenario};
use crate::text_input::{InputChanged, TextInput};
use crate::theme::Theme;

actions!(
    mediflow_pilot,
    [
        NextFocus,
        PreviousFocus,
        Search,
        ReviewNotes,
        Escape,
        PreviousPatient,
        NextPatient
    ]
);

#[derive(Clone, Copy, PartialEq, Eq)]
enum DiscardAction {
    Reload,
    Hide,
}

#[derive(Clone)]
enum Command {
    Archive(bool),
    Search,
    ToggleTheme,
    SystemTheme,
    Refresh,
    Review,
    Confirm,
    Cancel,
    Discard,
    KeepDraft,
    CopyNotes,
    CopyProfile,
    Hide,
    Resume,
    ShowList,
    ToggleScenarios,
    Scenario(Scenario),
}

pub struct PatientApp {
    service: DemoService,
    workspace: Workspace,
    notes: Entity<TextInput>,
    search: Entity<TextInput>,
    root_focus: FocusHandle,
    review_focus: FocusHandle,
    query: String,
    archived: bool,
    show_list: bool,
    dark_override: Option<bool>,
    theme: Theme,
    dark: bool,
    message: Option<String>,
    discard: Option<DiscardAction>,
    show_scenarios: bool,
    scenario: Scenario,
    resume_id: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl PatientApp {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let dark = is_dark(window);
        let theme = Theme::for_dark(dark);
        let notes = cx.new(|cx| {
            TextInput::new(
                "clinical-workspace-notes",
                "Note della scheda",
                "Scrivi una nota di prova…",
                true,
                theme,
                cx,
            )
        });
        let search = cx.new(|cx| {
            TextInput::new(
                "clinical-workspace-patient-search",
                "Cerca pazienti di prova",
                "Cerca nome o codice…",
                false,
                theme,
                cx,
            )
        });
        let notes_subscription = cx.subscribe(&notes, |this, editor, event: &InputChanged, cx| {
            this.message = None;
            match this.workspace.edit_notes(event.0.clone()) {
                Ok(()) => {}
                Err(error) => {
                    this.message = Some(error_message(error).into());
                    let admitted = this.workspace.draft_notes().to_owned();
                    editor.update(cx, |editor, cx| editor.set_content(admitted, cx));
                }
            }
            cx.notify();
        });
        let search_subscription = cx.subscribe(&search, |this, _, event: &InputChanged, cx| {
            this.query = event.0.clone();
            cx.notify();
        });
        let mut app = Self {
            service: DemoService::default(),
            workspace: Workspace::default(),
            notes,
            search,
            root_focus: cx.focus_handle(),
            review_focus: cx.focus_handle().tab_stop(true),
            query: String::new(),
            archived: false,
            show_list: false,
            dark_override: None,
            theme,
            dark,
            message: None,
            discard: None,
            show_scenarios: false,
            scenario: Scenario::Normal,
            resume_id: None,
            _subscriptions: vec![notes_subscription, search_subscription],
        };
        app.select_patient("prova-001", cx);
        app.show_list = true;
        window.focus(&app.root_focus, cx);
        app
    }

    fn patients(&self) -> Vec<PatientProfile> {
        self.service
            .patients()
            .iter()
            .filter(|p| p.is_archived == self.archived && p.matches_query(&self.query))
            .cloned()
            .collect()
    }

    fn read(&mut self, request: ReadRequest, cx: &mut Context<Self>) {
        let result = self.service.read(&request.patient_id);
        self.workspace.receive_read(&request, result);
        let notes = self.workspace.draft_notes().to_owned();
        self.notes
            .update(cx, |editor, cx| editor.set_content(notes, cx));
    }

    fn select_patient(&mut self, id: &str, cx: &mut Context<Self>) {
        if self.workspace.phase() == Phase::Locked {
            return;
        }
        match self.workspace.select(id) {
            Ok(request) => {
                self.read(request, cx);
                self.message = None;
                self.show_list = false;
                self.discard = None;
            }
            Err(error) => self.message = Some(error_message(error).into()),
        }
        cx.notify();
    }

    fn request_reload(&mut self, action: DiscardAction, cx: &mut Context<Self>) {
        if self.workspace.is_dirty()
            || matches!(
                self.workspace.phase(),
                Phase::Conflict | Phase::Indeterminate
            )
        {
            self.discard = Some(action);
        } else {
            self.discard = Some(action);
            self.discard_confirmed(cx);
        }
        cx.notify();
    }

    fn discard_confirmed(&mut self, cx: &mut Context<Self>) {
        match self.discard.take() {
            Some(DiscardAction::Reload) => {
                if let Some(request) = self.workspace.discard_and_reload() {
                    self.read(request, cx);
                    self.message = if self.workspace.phase() == Phase::Ready {
                        Some(
                            "Scheda riletta. Le note mostrate sono quelle attuali della prova."
                                .into(),
                        )
                    } else {
                        None
                    };
                }
            }
            Some(DiscardAction::Hide) => {
                self.resume_id = self.workspace.selected_id().map(str::to_owned);
                self.workspace.lock();
                self.notes
                    .update(cx, |editor, cx| editor.set_content("", cx));
                self.search
                    .update(cx, |editor, cx| editor.set_content("", cx));
                self.query.clear();
                self.message = None;
            }
            None => {}
        }
        cx.notify();
    }

    fn review(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.discard.is_some() || self.workspace.phase() == Phase::Review {
            return;
        }
        match self.workspace.review() {
            Ok(()) => {
                self.message = None;
                window.focus(&self.review_focus, cx);
            }
            Err(error) => self.message = Some(error_message(error).into()),
        }
        cx.notify();
    }

    fn confirm(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.discard.is_some() {
            return;
        }
        let command = match self.workspace.confirm() {
            Ok(command) => command,
            Err(error) => {
                self.message = Some(error_message(error).into());
                cx.notify();
                return;
            }
        };
        let outcome = self.service.update(&command, self.scenario);
        self.scenario = Scenario::Normal;
        // The service updates its own store. Only a distinct readback can mark Saved.
        if let Some(request) = self.workspace.receive_update(&command, outcome) {
            self.read(request, cx);
        }
        self.message = (outcome == UpdateOutcome::Rejected)
            .then(|| "Non registrata. Nulla è stato scritto. Bozza intatta.".into());
        window.focus(&self.root_focus, cx);
        cx.notify();
    }

    fn command(&mut self, command: Command, window: &mut Window, cx: &mut Context<Self>) {
        match command {
            Command::Archive(archived) => {
                self.archived = archived;
                self.show_list = true;
            }
            Command::Search => {
                self.show_list = true;
                self.search
                    .update(cx, |editor, cx| editor.focus(window, cx));
            }
            Command::ToggleTheme => self.dark_override = Some(!self.dark),
            Command::SystemTheme => self.dark_override = None,
            Command::Refresh => self.request_reload(DiscardAction::Reload, cx),
            Command::Review => self.review(window, cx),
            Command::Confirm => self.confirm(window, cx),
            Command::Cancel => {
                if self.workspace.cancel_review().is_ok() {
                    self.notes.update(cx, |editor, cx| editor.focus(window, cx));
                    self.message = None;
                }
            }
            Command::Discard => self.discard_confirmed(cx),
            Command::KeepDraft => {
                self.discard = None;
                self.notes.update(cx, |editor, cx| editor.focus(window, cx));
            }
            Command::CopyNotes => {
                cx.write_to_clipboard(ClipboardItem::new_string(
                    self.workspace.draft_notes().to_owned(),
                ));
                self.message = Some("Note copiate.".into());
            }
            Command::CopyProfile => {
                if let Some(profile) = self.workspace.selected() {
                    cx.write_to_clipboard(ClipboardItem::new_string(format!(
                        "DATI DI PROVA\n{}\nData di nascita: {}\nCodice di prova: {}\n\nNote\n{}",
                        profile.display_name(),
                        display_date(profile.birth_date.as_deref()),
                        profile.tax_code,
                        self.workspace.draft_notes()
                    )));
                    self.message = Some("Scheda di prova copiata.".into());
                }
            }
            Command::Hide => self.request_reload(DiscardAction::Hide, cx),
            Command::Resume => {
                if self.workspace.phase() == Phase::Locked {
                    let id = self.resume_id.take().unwrap_or_else(|| "prova-001".into());
                    if let Ok(request) = self.workspace.select(&id) {
                        self.read(request, cx);
                        self.message = None;
                        self.show_list = false;
                    }
                }
            }
            Command::ShowList => self.show_list = true,
            Command::ToggleScenarios => self.show_scenarios = !self.show_scenarios,
            Command::Scenario(scenario) => self.scenario = scenario,
        }
        cx.notify();
    }

    fn step_patient(&mut self, next: bool, cx: &mut Context<Self>) {
        if self.workspace.phase() == Phase::Locked {
            return;
        }
        let patients = self.patients();
        if patients.is_empty() {
            return;
        }
        let current = patients
            .iter()
            .position(|p| Some(p.id.as_str()) == self.workspace.selected_id());
        let index = match current {
            Some(i) if next => (i + 1).min(patients.len() - 1),
            Some(i) => i.saturating_sub(1),
            None => 0,
        };
        self.select_patient(&patients[index].id, cx);
    }

    fn button(
        &self,
        id: &'static str,
        label: impl Into<SharedString>,
        command: Command,
        primary: bool,
        enabled: bool,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        crate::components::button(id, label, self.theme, primary, enabled)
            .debug_selector(move || id.into())
            .when(enabled, |el| {
                el.on_click(
                    cx.listener(move |this, _, window, cx| {
                        this.command(command.clone(), window, cx)
                    }),
                )
            })
    }

    fn section(&self, id: &'static str, title: &'static str) -> Stateful<Div> {
        div()
            .id(id)
            .role(Role::Heading)
            .aria_level(2)
            .aria_label(title)
            .type_role(self.theme, TypeRole::Section)
            .text_color(self.theme.secondary)
            .child(text!(title))
    }

    fn sidebar(&self, narrow: bool, cx: &mut Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let patients = self.patients();
        let count = patients.len();
        div()
            .id("clinical-workspace-worklist")
            .debug_selector(|| "clinical-workspace-worklist".into())
            .accessibility_id("clinical-workspace-worklist")
            .role(Role::Navigation)
            .aria_label("Pazienti di prova")
            .w(px(304.))
            .min_w_0()
            .flex_shrink_0()
            .h_full()
            .flex()
            .flex_col()
            .gap(px(20.))
            .p(px(16.))
            .min_h_0()
            .child(
                div()
                    .flex()
                    .items_baseline()
                    .justify_between()
                    .child(
                        div()
                            .type_role(theme, TypeRole::PageTitle)
                            .child(text!("Pazienti")),
                    )
                    .child(
                        div()
                            .type_role(theme, TypeRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(format!("{count}"))),
                    ),
            )
            .child(
                div()
                    .debug_selector(|| "demo-search".into())
                    .child(self.search.clone()),
            )
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .child(
                        self.button(
                            "clinical-workspace-active",
                            "In carico",
                            Command::Archive(false),
                            false,
                            true,
                            cx,
                        )
                        .flex_1()
                        .aria_selected(!self.archived)
                        .when(!self.archived, |el| {
                            el.bg(theme.paper).border_color(theme.ink)
                        }),
                    )
                    .child(
                        self.button(
                            "clinical-workspace-archive",
                            "Archivio",
                            Command::Archive(true),
                            false,
                            true,
                            cx,
                        )
                        .flex_1()
                        .aria_selected(self.archived)
                        .when(self.archived, |el| {
                            el.bg(theme.paper).border_color(theme.ink)
                        }),
                    ),
            )
            .child(
                div()
                    .id("clinical-workspace-patient-list")
                    .debug_selector(|| "clinical-workspace-patient-list".into())
                    .role(Role::List)
                    .aria_label("Elenco pazienti di prova")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .when(patients.is_empty(), |el| {
                        el.child(
                            div()
                                .py(px(20.))
                                .text_color(theme.secondary)
                                .child(text!("Nessun paziente corrisponde alla ricerca.")),
                        )
                    })
                    .children(patients.into_iter().enumerate().map(|(index, patient)| {
                        let id = patient.id.clone();
                        let selected = self.workspace.selected_id() == Some(id.as_str());
                        let author_id =
                            SharedString::from(format!("clinical-workspace-patient-{id}"));
                        div()
                            .id(author_id.clone())
                            .accessibility_id(author_id)
                            .role(Role::ListItem)
                            .aria_position_in_set(index + 1)
                            .aria_size_of_set(count)
                            .aria_selected(selected)
                            .child(
                                div()
                                    .id("open")
                                    .role(Role::Button)
                                    .aria_label(SharedString::from(format!(
                                        "Apri la scheda di {}",
                                        patient.display_name()
                                    )))
                                    .focusable()
                                    .tab_stop(true)
                                    .cursor_pointer()
                                    .min_h(px(40.))
                                    .border_b_1()
                                    .border_color(theme.strong_rule)
                                    .px(px(8.))
                                    .py(px(8.))
                                    .flex()
                                    .items_center()
                                    .gap(px(8.))
                                    .bg(if selected {
                                        theme.selected
                                    } else {
                                        theme.shade
                                    })
                                    .type_role(theme, TypeRole::Strong)
                                    .hover(|style| style.bg(theme.hover))
                                    .focus_visible(|style| {
                                        style.border_2().border_color(theme.fresh)
                                    })
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.select_patient(&id, cx)
                                    }))
                                    .child(
                                        div()
                                            .min_w_0()
                                            .flex_1()
                                            .child(text!(patient.display_name())),
                                    )
                                    .when(
                                        !narrow
                                            && patient
                                                .notes
                                                .as_deref()
                                                .is_some_and(|n| !n.is_empty()),
                                        |el| {
                                            el.child(
                                                div()
                                                    .type_role(theme, TypeRole::Meta)
                                                    .text_color(theme.secondary)
                                                    .child(text!("Note")),
                                            )
                                        },
                                    ),
                            )
                    })),
            )
            .child(
                div()
                    .type_role(theme, TypeRole::Meta)
                    .text_color(theme.secondary)
                    .child(text!(
                        "Nomi e contenuti inventati. Le modifiche si perdono alla chiusura."
                    )),
            )
    }

    fn field(
        &self,
        id: &'static str,
        label: &'static str,
        value: String,
        code: bool,
    ) -> Stateful<Div> {
        div()
            .id(id)
            .role(Role::Group)
            .aria_label(SharedString::from(format!("{label}: {value}")))
            .py(px(12.))
            .border_b_1()
            .border_color(self.theme.rule)
            .flex()
            .flex_col()
            .gap(px(4.))
            .child(
                div()
                    .type_role(self.theme, TypeRole::Meta)
                    .text_color(self.theme.secondary)
                    .child(text!(label)),
            )
            .child(
                div()
                    .type_role(
                        self.theme,
                        if code { TypeRole::Code } else { TypeRole::Body },
                    )
                    .child(text!(value)),
            )
    }

    fn profile(
        &self,
        profile: &PatientProfile,
        compact: bool,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let theme = self.theme;
        let phase = self.workspace.phase();
        div().id("clinical-workspace-profile").debug_selector(|| "demo-profile".into()).accessibility_id("clinical-workspace-profile")
            .role(Role::Main).aria_label(SharedString::from(format!("Scheda di prova di {}", profile.display_name())))
            .flex_1().min_w_0().min_h_0().flex().flex_col().bg(theme.paper).rounded(px(theme.paper_radius)).overflow_hidden()
            .child(div().flex_shrink_0().min_w_0().p(px(if compact { 16. } else { 28. })).border_b_1().border_color(theme.rule).flex().flex_wrap().items_center().justify_between().gap(px(16.)).when(compact, |el| el.flex_col().items_stretch())
                .child(div().flex_1().min_w_0().max_w_full().flex().flex_col().gap(px(8.))
                    .child(div().id("clinical-workspace-patient-name").role(Role::Heading).aria_level(1).aria_label(SharedString::from(profile.display_name()))
                        .type_role(theme, TypeRole::Person { compact }).child(text!(profile.display_name())))
                    .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary).child(text!(if profile.is_archived { "Scheda di prova in archivio" } else { "Scheda di prova in carico" }))))
                .when(!compact, |el| el.child(self.profile_actions(phase, cx))))
            .child(div().id("clinical-workspace-profile-scroll").debug_selector(|| "clinical-workspace-profile-scroll".into()).flex_1().min_h_0().min_w_0().overflow_y_scroll()
                .child(div().p(px(if compact { 16. } else { 28. })).flex().gap(px(if compact { 24. } else { 40. })).when(compact, |el| el.flex_col())
                    .when(compact, |el| el.child(self.profile_actions(phase, cx)))
                    .child(div().w(px(192.)).flex_shrink_0().when(compact, |el| el.w_full())
                        .child(self.section("clinical-workspace-identity-heading", "DATI ANAGRAFICI"))
                        .child(self.field("clinical-workspace-first-name", "Nome", profile.first_name.clone(), false))
                        .child(self.field("clinical-workspace-last-name", "Cognome", profile.last_name.clone(), false))
                        .child(self.field("clinical-workspace-birth-date", "Data di nascita", display_date(profile.birth_date.as_deref()), false))
                        .child(self.field("clinical-workspace-tax-code", "Codice fiscale di prova", profile.tax_code.clone(), true)))
                    .child(div().flex_1().min_w_0().flex().flex_col().gap(px(16.))
                        .child(div().flex().items_center().justify_between().gap(px(12.))
                            .child(self.section("clinical-workspace-notes-heading", if phase == Phase::Review { "NOTE DA REGISTRARE" } else { "NOTE DELLA SCHEDA" }))
                            .child(self.button("clinical-workspace-copy-notes", "Copia note", Command::CopyNotes, false, true, cx)))
                        .when(phase == Phase::Review, |el| el.child(div().id("clinical-workspace-before-notes").role(Role::Group).aria_label("Note attualmente nella scheda")
                            .p(px(16.)).bg(theme.hover).flex().flex_col().gap(px(8.))
                            .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary).child(text!("Attualmente nella scheda")))
                            .child(div().type_role(theme, TypeRole::Prose).text_color(theme.ink).child(text!(profile.notes.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| "Nessuna nota.".into()))))))
                        .child(div().id("clinical-workspace-notes-editor-scroll").max_h(px(304.)).overflow_y_scroll().child(self.notes.clone()))
                        .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary).child(text!(if profile.is_archived {
                            "Scheda in archivio. Note in sola lettura."
                        } else if phase == Phase::Review {
                            "Rileggi il contenuto. Per correggerlo scegli Torna alla bozza."
                        } else { "Scrivi e seleziona il testo. Registra apre la revisione prima della conferma." })))
                        .child(self.scenarios(cx)))))
            .child(self.threshold(profile, cx))
    }

    fn profile_actions(&self, phase: Phase, cx: &mut Context<Self>) -> Div {
        div()
            .flex_shrink_0()
            .max_w_full()
            .flex()
            .flex_wrap()
            .gap(px(8.))
            .child(self.button(
                "clinical-workspace-reread",
                "Rileggi la scheda",
                Command::Refresh,
                false,
                !matches!(phase, Phase::Submitting | Phase::Verifying),
                cx,
            ))
            .child(self.button(
                "clinical-workspace-copy-profile",
                "Copia scheda",
                Command::CopyProfile,
                false,
                true,
                cx,
            ))
    }

    fn scenarios(&self, cx: &mut Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        div().id("clinical-workspace-synthetic-scenarios").flex().flex_col().gap(px(8.)).mt(px(12.))
            .child(self.button("clinical-workspace-show-scenarios", if self.show_scenarios { "Chiudi i casi di prova" } else { "Prova un imprevisto" }, Command::ToggleScenarios, false, true, cx))
            .when(self.show_scenarios, |el| el.child(div().flex().flex_col().gap(px(8.)).p(px(12.)).bg(theme.hover)
                .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary).child(text!("Scegli cosa accadrà alla prossima registrazione. Il caso si applica una volta, solo ai dati di prova.")))
                .children([
                    ("clinical-workspace-scenario-normal", Scenario::Normal),
                    ("clinical-workspace-scenario-conflict", Scenario::Conflict),
                    ("clinical-workspace-scenario-rejected", Scenario::Rejected),
                    ("clinical-workspace-scenario-uncertain", Scenario::Indeterminate),
                    ("clinical-workspace-scenario-read", Scenario::ReadUnavailable),
                ].into_iter().map(|(id, scenario)| self.button(id, scenario.label(), Command::Scenario(scenario), false, true, cx)
                    .aria_selected(self.scenario == scenario).when(self.scenario == scenario, |el| el.border_color(theme.fresh).bg(theme.selected))))))
            .when(!self.show_scenarios && self.scenario != Scenario::Normal, |el| el.child(div().type_role(theme, TypeRole::Meta).text_color(theme.warning).child(text!(format!("▲ Prossima prova: {}", self.scenario.label())))))
    }

    fn threshold(&self, profile: &PatientProfile, cx: &mut Context<Self>) -> Stateful<Div> {
        let phase = self.workspace.phase();
        let theme = self.theme;
        let review = phase == Phase::Review && self.discard.is_none();
        let surface = crate::components::WritingSurface::Plane;
        let background = if review {
            theme.paper
        } else if self.workspace.is_dirty() {
            theme.draft
        } else {
            theme.paper
        };
        let foreground = theme.ink;
        let (status, color) = match phase {
            Phase::Editing => ("Bozza non registrata", theme.fresh),
            Phase::Review => ("Bozza non registrata", foreground),
            Phase::Saved => ("Registrata", theme.ink),
            Phase::Conflict => (
                "▲ La scheda è stata modificata da un'altra postazione di prova. Bozza intatta.",
                theme.warning,
            ),
            Phase::Indeterminate => (
                "▲ Esito non confermato. Bozza intatta: rileggi la scheda prima di riprovare.",
                theme.warning,
            ),
            Phase::Submitting => ("Registrazione in corso…", theme.secondary),
            Phase::Verifying => ("Rilettura delle note…", theme.secondary),
            _ => ("Nessuna modifica da registrare.", theme.secondary),
        };
        div().id("clinical-workspace-save-status").debug_selector(|| "clinical-workspace-save-status".into()).accessibility_id("clinical-workspace-save-status")
            .role(Role::Status).aria_label(status)
            .border_t_1().border_color(if self.workspace.is_dirty() { theme.draft_rule } else { theme.rule })
            .flex_shrink_0().min_w_0().max_w_full().p(px(16.)).bg(background).text_color(foreground).flex().flex_col().gap(px(12.))
            .child(match phase {
                Phase::Editing | Phase::Review => crate::components::writing_status("demo-writing-status", crate::components::WritingInk::Fresh, surface, theme).into_any_element(),
                Phase::Saved => crate::components::writing_status("demo-writing-status", crate::components::WritingInk::Dry, surface, theme).into_any_element(),
                _ => div().text_color(color).type_role(theme, TypeRole::Body).child(text!(status)).into_any_element(),
            })
            .when(self.discard.is_some(), |el| el.child(div().flex().flex_col().gap(px(12.))
                .child(text!(if self.discard == Some(DiscardAction::Hide) { "Scartare la bozza e nascondere i dati di prova?" } else { "Scartare la bozza e rileggere le note attuali? Puoi prima copiare le note." }))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .child(self.button("clinical-workspace-keep-draft", "Mantieni la bozza", Command::KeepDraft, false, true, cx))
                    .child(self.button("clinical-workspace-discard-confirm", if self.discard == Some(DiscardAction::Hide) { "Scarta e nascondi" } else { "Scarta e rileggi" }, Command::Discard, true, true, cx)))))
            .when(review, |el| el.child(div().flex().flex_col().gap(px(12.))
                .child(div().type_role(theme, TypeRole::Threshold).child(text!(format!("Registrare le note nella scheda di {}?", profile.display_name()))))
                .child(div().type_role(theme, TypeRole::Meta).child(text!("1 elemento: note della scheda. La modifica resta solo in memoria.")))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .child(self.button("clinical-workspace-cancel-review", "Torna alla bozza", Command::Cancel, false, true, cx))
                    .child(self.button("clinical-workspace-confirm-save", "Conferma e registra", Command::Confirm, true, true, cx).aria_label(crate::navigation::confirmation_command_label(&profile.display_name())).track_focus(&self.review_focus)))))
            .when(!review && self.discard.is_none(), |el| el.child(div().flex().flex_wrap().items_center().justify_between().gap(px(12.))
                .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary).child(text!(if phase == Phase::Saved {
                    "Le note sono state rilette dopo la registrazione."
                } else if matches!(phase, Phase::Conflict | Phase::Indeterminate) {
                    "Copia la bozza se vuoi conservarla, poi rileggi la scheda."
                } else { "Dati di prova · modifiche solo in memoria" })))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .when(self.workspace.is_dirty(), |el| el.child(self.button("clinical-workspace-discard-draft", "Scarta la bozza", Command::Refresh, false, true, cx)))
                    .child(self.button("clinical-workspace-review-save", "Registra 1 elemento", Command::Review, true,
                        phase == Phase::Editing && self.workspace.is_dirty() && !profile.is_archived, cx)))))
    }
}

impl Render for PatientApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let dark = self.dark_override.unwrap_or_else(|| is_dark(window));
        if dark != self.dark {
            self.dark = dark;
            self.theme = Theme::for_dark(dark);
        }
        let theme = self.theme;
        let phase = self.workspace.phase();
        let read_only = !matches!(phase, Phase::Ready | Phase::Saved | Phase::Editing)
            || self.workspace.selected().is_some_and(|p| p.is_archived);
        self.notes.update(cx, |editor, cx| {
            editor.configure(theme, read_only, cx);
            editor.set_writing_ink(
                if matches!(phase, Phase::Ready | Phase::Saved) {
                    crate::components::WritingInk::Dry
                } else {
                    crate::components::WritingInk::Fresh
                },
                cx,
            );
        });
        self.search.update(cx, |editor, cx| {
            editor.configure(theme, phase == Phase::Locked, cx)
        });
        let width = window.viewport_size().width;
        let compact = width < px(1000.);
        let single = width < px(1000.);
        let profile = self.workspace.selected().cloned();
        let locked = phase == Phase::Locked;

        div().id("clinical-workspace-gpui-pilot").accessibility_id("clinical-workspace-gpui-pilot")
            .role(Role::Application).aria_label("MediFlow, prova pazienti con dati sintetici")
            .track_focus(&self.root_focus).key_context("MediFlowPatientPilot")
            .on_action(cx.listener(|_, _: &NextFocus, w, cx| w.focus_next(cx)))
            .on_action(cx.listener(|_, _: &PreviousFocus, w, cx| w.focus_prev(cx)))
            .on_action(cx.listener(|this, _: &Search, w, cx| this.command(Command::Search, w, cx)))
            .on_action(cx.listener(|this, _: &ReviewNotes, w, cx| {
                if this.discard.is_some() { return; }
                if this.workspace.phase() == Phase::Review { this.confirm(w, cx); }
                else { this.review(w, cx); }
            }))
            .on_action(cx.listener(|this, _: &Escape, w, cx| {
                if this.discard.take().is_some() { cx.notify(); }
                else if this.workspace.phase() == Phase::Review { this.command(Command::Cancel, w, cx); }
            }))
            .on_action(cx.listener(|this, _: &PreviousPatient, _, cx| this.step_patient(false, cx)))
            .on_action(cx.listener(|this, _: &NextPatient, _, cx| this.step_patient(true, cx)))
            .size_full().flex().flex_col().bg(theme.shade).text_color(theme.ink).type_role(theme, TypeRole::Body)
            .child(div().flex_shrink_0().min_w_0().px(px(if single { 16. } else { 28. })).py(px(12.)).flex().flex_wrap().items_center().justify_between().gap(px(12.)).when(single, |el| el.flex_col().items_stretch())
                .child(div().flex().flex_col().gap(px(4.))
                    .child(div().type_role(theme, TypeRole::Brand).child(text!("MediFlow.")))
                    .child(div().id("clinical-workspace-synthetic-label").role(Role::Note).aria_label("Dati di prova. Modifiche solo in memoria.")
                        .type_role(theme, TypeRole::Meta).text_color(theme.secondary).child(text!(if single { "Dati di prova" } else { "Dati di prova · modifiche solo in memoria" }))))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .when(single && !self.show_list && !locked, |el| el.child(self.button("clinical-workspace-back-list", "Pazienti", Command::ShowList, false, true, cx).when(single, |el| el.px(px(6.)))))
                    .child(self.button("clinical-workspace-theme", if self.dark { "Giorno" } else { "Grafite" }, Command::ToggleTheme, false, true, cx).when(single, |el| el.px(px(6.))))
                    .when(self.dark_override.is_some(), |el| el.child(self.button("clinical-workspace-system-theme", if single { "Sistema" } else { "Aspetto di sistema" }, Command::SystemTheme, false, true, cx).when(single, |el| el.px(px(6.)))))
                    .when(!locked, |el| el.child(self.button("clinical-workspace-hide", if single { "Nascondi" } else { "Nascondi dati" }, Command::Hide, false, true, cx).when(single, |el| el.px(px(6.)))))))
            .when(self.message.is_some(), |el| el.child(div().id("clinical-workspace-message").role(Role::Status)
                .aria_label(SharedString::from(self.message.clone().unwrap_or_default()))
                .mx(px(28.)).mb(px(12.)).px(px(12.)).py(px(8.)).bg(theme.paper).border_l_2().border_color(theme.fresh)
                .child(text!(self.message.clone().unwrap_or_default()))))
            .child(div().flex_1().min_h_0().min_w_0().flex().px(px(if single { 16. } else { 12. })).pb(px(16.))
                .when(!locked && (!single || self.show_list), |el| el.child(self.sidebar(compact, cx).when(single, |el| el.w_full())))
                .when(locked, |el| el.child(div().flex_1().flex().flex_col().items_center().justify_center().gap(px(20.)).bg(theme.paper).rounded(px(theme.paper_radius))
                    .child(div().type_role(theme, TypeRole::PageTitle).child(text!("Dati di prova nascosti")))
                    .child(text!("Le schede sintetiche restano in memoria fino alla chiusura."))
                    .child(self.button("clinical-workspace-resume", "Mostra dati di prova", Command::Resume, true, true, cx))))
                .when(!locked && (!single || !self.show_list), |el| match profile {
                    Some(ref profile) => el.child(self.profile(profile, compact, cx)),
                    None => el.child(div().flex_1().flex().flex_col().items_center().justify_center().gap(px(20.)).p(px(28.)).bg(theme.paper).rounded(px(theme.paper_radius))
                        .child(div().type_role(theme, TypeRole::PageTitle).child(text!(if phase == Phase::Unavailable { "La scheda non è disponibile" } else { "Seleziona una scheda di prova" })))
                        .child(text!(if phase == Phase::Unavailable { "La lettura non è riuscita. Nessun dato viene mostrato come vuoto." } else { "Scegli un paziente dall'elenco per leggere o modificare le note." }))
                        .when(phase == Phase::Unavailable, |el| el.child(self.button("clinical-workspace-retry-read", "Riprova", Command::Refresh, true, true, cx)))),
                }))
    }
}

fn is_dark(window: &Window) -> bool {
    matches!(
        window.appearance(),
        WindowAppearance::Dark | WindowAppearance::VibrantDark
    )
}

fn display_date(date: Option<&str>) -> String {
    match date {
        Some(value)
            if value.len() == 10
                && value.is_ascii()
                && value.as_bytes()[4] == b'-'
                && value.as_bytes()[7] == b'-' =>
        {
            format!("{}/{}/{}", &value[8..10], &value[5..7], &value[..4])
        }
        Some(value) => value.to_owned(),
        None => "Non indicata".into(),
    }
}

fn error_message(error: ClientError) -> &'static str {
    match error {
        ClientError::UnsavedChanges => {
            "La bozza è intatta. Registrala o scartala prima di cambiare scheda."
        }
        ClientError::NoChanges => "Nessuna modifica da registrare.",
        ClientError::InvalidInput => {
            "Il testo non può essere accettato. La bozza precedente è intatta: controlla la lunghezza e i caratteri incollati."
        }
        ClientError::WrongPhase => {
            "Completa o annulla il passaggio corrente prima di modificare le note."
        }
        ClientError::VersionExhausted | ClientError::RequestExhausted => {
            "Questa prova ha raggiunto il limite delle operazioni. Copia la bozza e riapri la prova."
        }
    }
}

pub fn bind_keys(cx: &mut App) {
    use gpui::KeyBinding;
    cx.bind_keys([
        KeyBinding::new("tab", NextFocus, None),
        KeyBinding::new("shift-tab", PreviousFocus, None),
        KeyBinding::new("secondary-k", Search, None),
        KeyBinding::new("secondary-enter", ReviewNotes, None),
        KeyBinding::new("escape", Escape, None),
        KeyBinding::new("alt-up", PreviousPatient, None),
        KeyBinding::new("alt-down", NextPatient, None),
    ]);
}

#[cfg(test)]
#[path = "demo_app_tests.rs"]
mod tests;
