use super::*;
use crate::theme::{TypeRole, TypeStyle};
use std::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ReadObject {
    Scheda,
    Diario,
    Terapie,
    Parametri,
    Controlli,
}

impl ReadObject {
    fn name(self) -> &'static str {
        match self {
            Self::Scheda => "la scheda",
            Self::Diario => "il diario",
            Self::Terapie => "le terapie",
            Self::Parametri => "i parametri",
            Self::Controlli => "i controlli",
        }
    }

    fn reading(self) -> &'static str {
        match self {
            Self::Scheda => "Lettura della scheda…",
            Self::Diario => "Lettura del diario…",
            Self::Terapie => "Lettura delle terapie…",
            Self::Parametri => "Lettura dei parametri…",
            Self::Controlli => "Lettura dei controlli…",
        }
    }

    fn empty(self) -> &'static str {
        match self {
            Self::Scheda => "Nessuna scheda disponibile.",
            Self::Diario => "Nessuna voce di diario.",
            Self::Terapie => "Nessuna terapia in corso.",
            Self::Parametri => "Nessun parametro registrato.",
            Self::Controlli => "Nessun controllo aperto.",
        }
    }

    fn changed(self, time: &str) -> String {
        match self {
            Self::Scheda => format!("La scheda è cambiata alle {time} su un'altra postazione."),
            Self::Diario => format!("Il diario è cambiato alle {time} su un'altra postazione."),
            Self::Terapie => {
                format!("Le terapie sono cambiate alle {time} su un'altra postazione.")
            }
            Self::Parametri => {
                format!("I parametri sono cambiati alle {time} su un'altra postazione.")
            }
            Self::Controlli => {
                format!("I controlli sono cambiati alle {time} su un'altra postazione.")
            }
        }
    }

    fn failed(self) -> &'static str {
        match self {
            Self::Scheda => "La scheda non si è potuta leggere.",
            Self::Diario => "Il diario non si è potuto leggere.",
            Self::Terapie => "Le terapie non si sono potute leggere.",
            Self::Parametri => "I parametri non si sono potuti leggere.",
            Self::Controlli => "I controlli non si sono potuti leggere.",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ViewStateKind {
    Vuoto,
    Caricamento,
    AttesaLunga {
        fase: String,
        elapsed: u64,
    },
    NonInLinea {
        copia: Option<String>,
    },
    NonPiuAttuale {
        ora: String,
    },
    ArchivioSostituito,
    #[allow(
        dead_code,
        reason = "The shared taxonomy includes write conflicts; this adoption is read-only."
    )]
    Conflitto,
    AccessoNegato,
    CampoIlleggibile,
    Errore,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ViewTone {
    Neutro,
    Attenzione,
    Critico,
}

impl ViewTone {
    fn sign(self) -> &'static str {
        match self {
            Self::Neutro => "",
            Self::Attenzione => "▲ ",
            Self::Critico => "◆ ",
        }
    }

    fn color(self, theme: Theme) -> gpui::Hsla {
        match self {
            Self::Neutro => theme.ink,
            Self::Attenzione => theme.warning,
            Self::Critico => theme.critical,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ViewCommand {
    Riprova,
    Rileggi,
    RileggiScheda,
}

impl ViewCommand {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Riprova => "Riprova la lettura",
            Self::Rileggi => "Rileggi",
            Self::RileggiScheda => "Rileggi la scheda",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ViewState {
    pub object: ReadObject,
    pub kind: ViewStateKind,
}

#[derive(Default)]
pub(super) struct ReadEvidence {
    pub copy_at: Option<String>,
    pub changed_at: Option<String>,
    pub archive_replaced: bool,
}

impl ViewState {
    pub(super) fn new(object: ReadObject, kind: ViewStateKind) -> Self {
        Self { object, kind }
    }

    pub(super) fn from_read_error(
        object: ReadObject,
        error: RuntimeError,
        evidence: ReadEvidence,
    ) -> Self {
        let kind = match error {
            RuntimeError::Forbidden | RuntimeError::Rejected(403) => ViewStateKind::AccessoNegato,
            RuntimeError::Crypto | RuntimeError::LockedField => ViewStateKind::CampoIlleggibile,
            RuntimeError::Conflict if evidence.archive_replaced => {
                ViewStateKind::ArchivioSostituito
            }
            RuntimeError::Conflict | RuntimeError::ReadRequired
                if evidence.changed_at.is_some() =>
            {
                ViewStateKind::NonPiuAttuale {
                    ora: evidence.changed_at.unwrap(),
                }
            }
            RuntimeError::Transport => ViewStateKind::NonInLinea {
                copia: evidence.copy_at,
            },
            _ => ViewStateKind::Errore,
        };
        Self::new(object, kind)
    }

    pub(super) fn tone(&self) -> ViewTone {
        match self.kind {
            ViewStateKind::Vuoto
            | ViewStateKind::Caricamento
            | ViewStateKind::AttesaLunga { .. } => ViewTone::Neutro,
            ViewStateKind::NonInLinea { .. } | ViewStateKind::NonPiuAttuale { .. } => {
                ViewTone::Attenzione
            }
            _ => ViewTone::Critico,
        }
    }

    pub(super) fn command(&self) -> Option<ViewCommand> {
        match self.kind {
            ViewStateKind::NonInLinea { .. } | ViewStateKind::Errore => Some(ViewCommand::Riprova),
            ViewStateKind::NonPiuAttuale { .. } => Some(ViewCommand::Rileggi),
            ViewStateKind::Conflitto => Some(ViewCommand::RileggiScheda),
            _ => None,
        }
    }

    pub(super) fn lines(&self) -> (String, Option<String>) {
        let (first, second) = match &self.kind {
            ViewStateKind::Vuoto => (self.object.empty().into(), None),
            ViewStateKind::Caricamento => (self.object.reading().into(), None),
            ViewStateKind::AttesaLunga { fase, elapsed } => (
                fase.clone(),
                Some(format!("L'archivio sta ancora rispondendo, {elapsed} s")),
            ),
            ViewStateKind::NonInLinea { copia } => (
                "Il computer dell'ambulatorio non risponde.".into(),
                Some(match copia {
                    Some(time) => {
                        format!("Stai leggendo la copia delle {time}; non puoi scrivere.")
                    }
                    None => "Nessuna copia disponibile in questa finestra.".into(),
                }),
            ),
            ViewStateKind::NonPiuAttuale { ora } => (self.object.changed(ora), None),
            ViewStateKind::ArchivioSostituito => (
                "L'archivio è stato ripristinato da una copia.".into(),
                Some("Riapri l'archivio prima di continuare.".into()),
            ),
            ViewStateKind::Conflitto => (
                "Non registrata. Nulla è stato scritto.".into(),
                Some("La bozza è intatta.".into()),
            ),
            ViewStateKind::AccessoNegato => (
                format!("Questa postazione non può vedere {}.", self.object.name()),
                None,
            ),
            ViewStateKind::CampoIlleggibile => (
                "Questo dato non si può leggere con la chiave attuale. Non è vuoto.".into(),
                None,
            ),
            ViewStateKind::Errore => (self.object.failed().into(), None),
        };
        (format!("{}{first}", self.tone().sign()), second)
    }

    pub(super) fn render(
        &self,
        id: &'static str,
        theme: Theme,
        focus: &FocusHandle,
        on_command: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Stateful<Div> {
        let (first, second) = self.lines();
        let label = match &second {
            Some(second) => format!("{first} {second}"),
            None => first.clone(),
        };
        div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .accessibility_id(id)
            .role(if self.tone() == ViewTone::Critico {
                Role::Alert
            } else {
                Role::Status
            })
            .aria_label(label)
            .min_w_0()
            .max_w_full()
            .whitespace_normal()
            .type_role(theme, TypeRole::Body)
            .flex()
            .flex_col()
            .items_start()
            .gap(px(8.))
            .child(
                div()
                    .type_role(theme, TypeRole::Strong)
                    .text_color(self.tone().color(theme))
                    .child(text!(first)),
            )
            .when_some(second, |el, second| {
                el.child(div().text_color(theme.secondary).child(text!(second)))
            })
            .when_some(self.command(), |el, command| {
                el.child(
                    button(format!("{id}-command"), command.label(), theme, false, true)
                        .track_focus(focus)
                        .debug_selector(move || format!("{id}-command"))
                        .on_click(on_command),
                )
            })
    }
}

pub(super) enum ReadLoad<T> {
    Idle,
    Loading { started: Instant },
    Ready(T),
    Failed(RuntimeError),
}

impl<T> ReadLoad<T> {
    pub(super) fn loading() -> Self {
        Self::Loading {
            started: Instant::now(),
        }
    }

    pub(super) fn ready(&self) -> Option<&T> {
        match self {
            Self::Ready(value) => Some(value),
            _ => None,
        }
    }

    pub(super) fn from_result(result: Result<T, RuntimeError>) -> Self {
        match result {
            Ok(value) => Self::Ready(value),
            Err(error) => Self::Failed(error),
        }
    }

    pub(super) fn state(&self, object: ReadObject) -> Option<ViewState> {
        self.state_after(object, Instant::now())
    }

    fn state_after(&self, object: ReadObject, now: Instant) -> Option<ViewState> {
        let kind = match self {
            Self::Idle => ViewStateKind::Caricamento,
            Self::Loading { started } => {
                let elapsed = now.saturating_duration_since(*started).as_secs();
                if elapsed >= 5 {
                    ViewStateKind::AttesaLunga {
                        fase: object.reading().into(),
                        elapsed,
                    }
                } else {
                    ViewStateKind::Caricamento
                }
            }
            Self::Ready(_) => return None,
            Self::Failed(error) => {
                return Some(ViewState::from_read_error(
                    object,
                    *error,
                    ReadEvidence::default(),
                ));
            }
        };
        Some(ViewState::new(object, kind))
    }
}

impl ReadObject {
    fn index(self) -> usize {
        match self {
            Self::Scheda => 0,
            Self::Diario => 1,
            Self::Terapie => 2,
            Self::Parametri => 3,
            Self::Controlli => 4,
        }
    }
}

impl ClinicalApp {
    fn read_state(&self, object: ReadObject) -> Option<ViewState> {
        match object {
            ReadObject::Scheda => self.patient.detail.state(object),
            ReadObject::Diario => self.patient.entries.state(object),
            ReadObject::Terapie => self.patient.therapies.state(object),
            ReadObject::Parametri => self.patient.observations.state(object),
            ReadObject::Controlli => self.patient.checkups.state(object),
        }
    }

    fn render_read_state(
        &self,
        id: &'static str,
        state: ViewState,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        let object = state.object;
        state.render(
            id,
            self.theme,
            &self.read_state_focus[object.index()],
            cx.listener(move |this, _, _, cx| this.retry_patient_read(object, cx)),
        )
    }

    pub(super) fn patient_read_hint<T>(
        &self,
        id: &'static str,
        load: &ReadLoad<T>,
        object: ReadObject,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        self.render_read_state(
            id,
            load.state(object)
                .expect("read hint requires an unavailable section"),
            cx,
        )
    }

    pub(super) fn empty_read_state(
        &self,
        id: &'static str,
        object: ReadObject,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        self.render_read_state(id, ViewState::new(object, ViewStateKind::Vuoto), cx)
    }

    pub(super) fn unreadable_field(&self, id: &'static str, cx: &Context<Self>) -> Stateful<Div> {
        self.render_read_state(
            id,
            ViewState::new(ReadObject::Scheda, ViewStateKind::CampoIlleggibile),
            cx,
        )
    }

    fn visible_read_objects(&self) -> Vec<ReadObject> {
        if self.area != Area::Patients || self.show_other {
            return vec![];
        }
        if self.patient.detail.ready().is_none() || self.directory {
            return vec![ReadObject::Scheda];
        }
        if self.form.is_some() {
            return vec![];
        }
        match self.patient_section {
            PatientSection::Overview => vec![
                ReadObject::Terapie,
                ReadObject::Controlli,
                ReadObject::Diario,
            ],
            PatientSection::Diary => vec![ReadObject::Diario],
            PatientSection::Therapies => vec![ReadObject::Terapie],
            PatientSection::Observations => vec![ReadObject::Parametri],
            PatientSection::Checkups => vec![ReadObject::Controlli],
            PatientSection::Documents => vec![],
        }
    }

    pub(super) fn prepare_read_state_focus(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let background = self.form.is_some();
        let objects = if background
            && Layout::for_window(f32::from(window.viewport_size().width), self.text_scale).wide
        {
            vec![ReadObject::Terapie, ReadObject::Controlli]
        } else {
            self.visible_read_objects()
        };
        let commands: Vec<_> = objects
            .into_iter()
            .filter_map(|object| {
                self.read_state(object)
                    .filter(|state| state.command().is_some())
                    .map(|state| (object, state))
            })
            .collect();
        if let Some((object, _)) = commands
            .iter()
            .find(|command| !self.read_state_commands.contains(command))
            .filter(|_| !background)
        {
            window.focus(&self.read_state_focus[object.index()], cx);
        }
        self.read_state_commands = commands;
    }

    fn patient_read_pending(&self) -> bool {
        matches!(self.patient.detail, ReadLoad::Loading { .. })
            || matches!(self.patient.entries, ReadLoad::Loading { .. })
            || matches!(self.patient.therapies, ReadLoad::Loading { .. })
            || matches!(self.patient.observations, ReadLoad::Loading { .. })
            || matches!(self.patient.checkups, ReadLoad::Loading { .. })
    }

    pub(super) fn watch_patient_reads(&mut self, cx: &mut Context<Self>) {
        let epoch = self.epoch;
        self.read_timer = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_secs(1))
                    .await;
                let pending = this
                    .update(cx, |this, cx| {
                        if this.epoch != epoch || !this.patient_read_pending() {
                            return false;
                        }
                        cx.notify();
                        true
                    })
                    .unwrap_or(false);
                if !pending {
                    break;
                }
            }
        }));
    }

    pub(super) fn retry_patient_read(&mut self, object: ReadObject, cx: &mut Context<Self>) {
        if self
            .read_state(object)
            .is_none_or(|state| state.command().is_none())
        {
            return;
        }
        if object == ReadObject::Scheda {
            self.request_discard(Discard::Reload, cx);
            return;
        }
        let (Some(session), Some(scope), Some(id)) = (
            self.session.clone(),
            self.scope.clone(),
            self.selected_id.clone(),
        ) else {
            return;
        };
        match object {
            ReadObject::Diario => {
                self.patient.entries = ReadLoad::loading();
                self.run(
                    move || session.list_entries(&scope, &id),
                    |this, result, _| this.patient.entries = ReadLoad::from_result(result),
                    cx,
                );
            }
            ReadObject::Terapie => {
                self.patient.therapies = ReadLoad::loading();
                self.run(
                    move || session.list_therapies(&scope, &id),
                    |this, result, _| this.patient.therapies = ReadLoad::from_result(result),
                    cx,
                );
            }
            ReadObject::Parametri => {
                self.patient.observations = ReadLoad::loading();
                self.run(
                    move || session.list_observations(&scope, &id),
                    |this, result, _| this.patient.observations = ReadLoad::from_result(result),
                    cx,
                );
            }
            ReadObject::Controlli => {
                self.patient.checkups = ReadLoad::loading();
                self.run(
                    move || session.list_checkups(&scope, &id),
                    |this, result, _| this.patient.checkups = ReadLoad::from_result(result),
                    cx,
                );
            }
            ReadObject::Scheda => unreachable!(),
        }
        self.watch_patient_reads(cx);
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::Focusable;
    use serde_json::json;
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::{
            Arc, Mutex,
            atomic::{AtomicBool, AtomicU16, Ordering},
        },
        thread,
        time::Duration,
    };

    type StateCase = (
        ViewStateKind,
        &'static str,
        Option<&'static str>,
        ViewTone,
        Option<&'static str>,
    );

    fn cases() -> Vec<StateCase> {
        vec![
            (
                ViewStateKind::Vuoto,
                "Nessuna terapia in corso.",
                None,
                ViewTone::Neutro,
                None,
            ),
            (
                ViewStateKind::Caricamento,
                "Lettura delle terapie…",
                None,
                ViewTone::Neutro,
                None,
            ),
            (
                ViewStateKind::AttesaLunga {
                    fase: "Lettura delle terapie…".into(),
                    elapsed: 12,
                },
                "Lettura delle terapie…",
                Some("L'archivio sta ancora rispondendo, 12 s"),
                ViewTone::Neutro,
                None,
            ),
            (
                ViewStateKind::NonInLinea {
                    copia: Some("10:32".into()),
                },
                "▲ Il computer dell'ambulatorio non risponde.",
                Some("Stai leggendo la copia delle 10:32; non puoi scrivere."),
                ViewTone::Attenzione,
                Some("Riprova la lettura"),
            ),
            (
                ViewStateKind::NonInLinea { copia: None },
                "▲ Il computer dell'ambulatorio non risponde.",
                Some("Nessuna copia disponibile in questa finestra."),
                ViewTone::Attenzione,
                Some("Riprova la lettura"),
            ),
            (
                ViewStateKind::NonPiuAttuale {
                    ora: "19:01".into(),
                },
                "▲ Le terapie sono cambiate alle 19:01 su un'altra postazione.",
                None,
                ViewTone::Attenzione,
                Some("Rileggi"),
            ),
            (
                ViewStateKind::ArchivioSostituito,
                "◆ L'archivio è stato ripristinato da una copia.",
                Some("Riapri l'archivio prima di continuare."),
                ViewTone::Critico,
                None,
            ),
            (
                ViewStateKind::Conflitto,
                "◆ Non registrata. Nulla è stato scritto.",
                Some("La bozza è intatta."),
                ViewTone::Critico,
                Some("Rileggi la scheda"),
            ),
            (
                ViewStateKind::AccessoNegato,
                "◆ Questa postazione non può vedere le terapie.",
                None,
                ViewTone::Critico,
                None,
            ),
            (
                ViewStateKind::CampoIlleggibile,
                "◆ Questo dato non si può leggere con la chiave attuale. Non è vuoto.",
                None,
                ViewTone::Critico,
                None,
            ),
            (
                ViewStateKind::Errore,
                "◆ Le terapie non si sono potute leggere.",
                None,
                ViewTone::Critico,
                Some("Riprova la lettura"),
            ),
        ]
    }

    struct SectionFixture {
        app: Entity<ClinicalApp>,
        state: ViewState,
        dark: bool,
        focus: FocusHandle,
        focus_pending: bool,
        region: Option<gpui::accesskit::Node>,
    }

    impl Render for SectionFixture {
        fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            if std::mem::take(&mut self.focus_pending) && self.state.command().is_some() {
                window.focus(&self.focus, cx);
            }
            let theme = Theme::for_dark(self.dark);
            let app = self.app.clone();
            let state = self.state.render(
                "synthetic-view-state",
                theme,
                &self.focus,
                cx.listener(move |_, _, _, cx| {
                    app.update(cx, |app, cx| {
                        app.retry_patient_read(ReadObject::Terapie, cx)
                    })
                }),
            );
            let mut region = gpui::accesskit::Node::new(gpui::Element::a11y_role(&state).unwrap());
            gpui::Element::write_a11y_info(&state, &mut region);
            self.region = Some(region);
            div()
                .size_full()
                .p(px(24.))
                .bg(theme.paper)
                .text_color(theme.ink)
                .flex()
                .flex_col()
                .gap(px(16.))
                .child(section("synthetic-therapies-heading", "TERAPIE", theme))
                .child(state)
        }
    }

    fn draw(cx: &mut gpui::VisualTestContext) {
        for _ in 0..8 {
            let pending = cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
                window.simulate_next_frame(cx)
            });
            cx.run_until_parked();
            if pending == 0 {
                return;
            }
        }
        panic!("read-state rendering did not settle");
    }

    #[gpui::test]
    fn every_view_state_renders_the_specified_text_tone_and_only_its_secondary_command(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = SyntheticHost::new();
        let (app, _) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        app.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.selected_id = Some("synthetic-patient".into());
        });
        let (view, cx) = cx.add_window_view(|_, cx| SectionFixture {
            app: app.clone(),
            state: ViewState::new(ReadObject::Terapie, ViewStateKind::Vuoto),
            dark: false,
            focus: cx.focus_handle(),
            focus_pending: true,
            region: None,
        });
        for dark in [false, true] {
            for (kind, first, second, tone, command) in cases() {
                view.update(cx, |view, cx| {
                    view.state = ViewState::new(ReadObject::Terapie, kind);
                    view.dark = dark;
                    view.focus_pending = true;
                    assert_eq!(view.state.tone(), tone);
                    let theme = Theme::for_dark(dark);
                    assert_eq!(
                        view.state.tone().color(theme),
                        match tone {
                            ViewTone::Neutro => theme.ink,
                            ViewTone::Attenzione => theme.warning,
                            ViewTone::Critico => theme.critical,
                        }
                    );
                    cx.notify();
                });
                draw(cx);
                view.read_with(cx, |view, _| {
                    let region = view.region.as_ref().unwrap();
                    assert_eq!(
                        region.role(),
                        if tone == ViewTone::Critico {
                            Role::Alert
                        } else {
                            Role::Status
                        }
                    );
                    let expected = second
                        .map_or_else(|| first.to_owned(), |second| format!("{first} {second}"));
                    assert_eq!(region.label(), Some(expected.as_str()));
                    assert_eq!(view.state.command().map(ViewCommand::label), command);
                });
                assert!(cx.debug_bounds("synthetic-view-state").is_some());
                assert_eq!(
                    cx.debug_bounds("synthetic-view-state-command").is_some(),
                    command.is_some(),
                    "{first}"
                );
                if command.is_some() {
                    cx.update(|window, cx| assert!(view.read(cx).focus.is_focused(window)));
                }
            }
        }
        host.assert_no_record_writes();
    }

    #[test]
    fn read_adapter_keeps_denial_and_keys_distinct_and_never_guesses_currentness() {
        for error in [RuntimeError::Forbidden, RuntimeError::Rejected(403)] {
            let state =
                ViewState::from_read_error(ReadObject::Terapie, error, ReadEvidence::default());
            assert_eq!(state.kind, ViewStateKind::AccessoNegato);
            assert_eq!(
                state.command(),
                None,
                "a denial must never offer Riprova la lettura"
            );
        }
        for error in [RuntimeError::Crypto, RuntimeError::LockedField] {
            let state =
                ViewState::from_read_error(ReadObject::Terapie, error, ReadEvidence::default());
            assert_eq!(state.kind, ViewStateKind::CampoIlleggibile);
            assert_eq!(state.command(), None);
        }
        for copy_at in [None, Some("10:32".to_owned())] {
            let state = ViewState::from_read_error(
                ReadObject::Terapie,
                RuntimeError::Transport,
                ReadEvidence {
                    copy_at: copy_at.clone(),
                    ..Default::default()
                },
            );
            assert_eq!(state.kind, ViewStateKind::NonInLinea { copia: copy_at });
        }
        let replaced = ViewState::from_read_error(
            ReadObject::Scheda,
            RuntimeError::Conflict,
            ReadEvidence {
                archive_replaced: true,
                ..Default::default()
            },
        );
        assert_eq!(replaced.kind, ViewStateKind::ArchivioSostituito);
        assert_eq!(replaced.command(), None, "no native reopen path exists");
        for error in [RuntimeError::ReadRequired, RuntimeError::Conflict] {
            assert_eq!(
                ViewState::from_read_error(ReadObject::Terapie, error, ReadEvidence::default())
                    .kind,
                ViewStateKind::Errore
            );
            let stale = ViewState::from_read_error(
                ReadObject::Terapie,
                error,
                ReadEvidence {
                    changed_at: Some("19:01".into()),
                    ..Default::default()
                },
            );
            assert_eq!(
                stale.kind,
                ViewStateKind::NonPiuAttuale {
                    ora: "19:01".into()
                }
            );
            assert_eq!(stale.command(), Some(ViewCommand::Rileggi));
        }
        for error in [
            RuntimeError::Missing,
            RuntimeError::InvalidResponse,
            RuntimeError::Rejected(422),
        ] {
            assert_eq!(
                ViewState::from_read_error(ReadObject::Scheda, error, ReadEvidence::default()).kind,
                ViewStateKind::Errore
            );
        }
    }

    #[test]
    fn long_read_wait_starts_at_five_seconds_and_names_the_real_phase_without_cancellation() {
        let started = Instant::now();
        let read = ReadLoad::<()>::Loading { started };
        assert_eq!(
            read.state_after(ReadObject::Scheda, started + Duration::from_millis(4999))
                .unwrap()
                .kind,
            ViewStateKind::Caricamento
        );
        for seconds in [5, 12, 61] {
            let state = read
                .state_after(ReadObject::Scheda, started + Duration::from_secs(seconds))
                .unwrap();
            assert_eq!(
                state.kind,
                ViewStateKind::AttesaLunga {
                    fase: "Lettura della scheda…".into(),
                    elapsed: seconds
                }
            );
            assert_eq!(state.command(), None);
        }
    }

    fn enter_profile(app: &mut ClinicalApp, host: &SyntheticHost) {
        app.session = Some(host.session.clone());
        app.scope = Some("scope-a".into());
        app.selected_id = Some("synthetic-patient".into());
        app.area = Area::Patients;
        app.directory = false;
        app.patient.detail = ReadLoad::Ready(serde_json::from_value(json!({
            "id":"synthetic-patient", "firstName":"Persona", "lastName":"Sintetica", "taxCode":"SYNTHETIC", "version":1
        })).unwrap());
    }

    #[gpui::test]
    fn diary_stays_readable_when_therapies_are_denied_and_denial_never_offers_retry(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = SyntheticHost::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            enter_profile(app, &host);
            app.load_sections(cx);
        });
        cx.run_until_parked();
        draw(cx);
        assert!(
            cx.debug_bounds("clinical-workspace-therapies-state-command")
                .is_none(),
            "Forbidden rendered Riprova la lettura"
        );
        view.read_with(cx, |app, _| {
            assert_eq!(
                app.patient.entries.ready().unwrap()[0].content,
                "Contenuto sintetico conservato"
            );
            let state = app.patient.therapies.state(ReadObject::Terapie).unwrap();
            assert_eq!(
                state.lines().0,
                "◆ Questa postazione non può vedere le terapie."
            );
            assert_eq!(
                state.command(),
                None,
                "Forbidden must never render Riprova la lettura"
            );
        });
        assert!(
            cx.debug_bounds("clinical-workspace-entry-synthetic-entry")
                .is_some(),
            "successful diary must remain in the rendered profile"
        );
        assert!(
            cx.debug_bounds("clinical-workspace-therapies-state")
                .is_some()
        );
        assert!(
            cx.debug_bounds("clinical-workspace-therapies-state-command")
                .is_none()
        );
        let before = host.requests.lock().unwrap().len();
        view.update(cx, |app, cx| {
            app.retry_patient_read(ReadObject::Terapie, cx)
        });
        cx.run_until_parked();
        assert_eq!(
            host.requests.lock().unwrap().len(),
            before,
            "denied reads cannot be retried even by a stale callback"
        );
        host.assert_no_record_writes();
    }

    #[gpui::test]
    fn reread_and_retry_clicks_only_read_the_failed_section_and_do_not_write(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = SyntheticHost::new();
        host.therapy_status.store(200, Ordering::Release);
        let (app, _) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        app.update(cx, |app, _| enter_profile(app, &host));
        let (view, cx) = cx.add_window_view(|_, cx| SectionFixture {
            app: app.clone(),
            state: ViewState::new(ReadObject::Terapie, ViewStateKind::Errore),
            dark: false,
            focus: cx.focus_handle(),
            focus_pending: true,
            region: None,
        });
        for kind in [
            ViewStateKind::Errore,
            ViewStateKind::NonPiuAttuale {
                ora: "19:01".into(),
            },
        ] {
            app.update(cx, |app, _| {
                app.patient.therapies = ReadLoad::Failed(RuntimeError::InvalidResponse)
            });
            view.update(cx, |view, cx| {
                view.state.kind = kind;
                view.focus_pending = true;
                cx.notify();
            });
            draw(cx);
            let before = host
                .requests
                .lock()
                .unwrap()
                .iter()
                .filter(|request| request.contains("/therapies "))
                .count();
            let bounds = cx.debug_bounds("synthetic-view-state-command").unwrap();
            cx.simulate_click(bounds.center(), gpui::Modifiers::default());
            cx.run_until_parked();
            app.read_with(cx, |app, _| {
                assert!(app.patient.therapies.ready().is_some())
            });
            let requests = host.requests.lock().unwrap();
            assert_eq!(
                requests
                    .iter()
                    .filter(|request| request.contains("/therapies "))
                    .count(),
                before + 1
            );
            assert!(
                !requests.iter().any(|request| request.contains("/entries ")),
                "rereading therapies must not reread the diary"
            );
            drop(requests);
            host.assert_no_record_writes();
        }
    }

    #[gpui::test]
    fn long_wait_never_retries_and_only_a_new_actionable_state_takes_focus(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = SyntheticHost::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            enter_profile(app, &host);
            app.patient_section = PatientSection::Therapies;
            app.patient.therapies = ReadLoad::Loading {
                started: Instant::now() - Duration::from_secs(12),
            };
            app.watch_patient_reads(cx);
        });
        cx.run_until_parked();
        draw(cx);
        assert!(
            cx.debug_bounds("clinical-workspace-therapies-state")
                .is_some()
        );
        assert!(
            cx.debug_bounds("clinical-workspace-therapies-state-command")
                .is_none()
        );
        let before = host.requests.lock().unwrap().len();
        cx.cx.executor().advance_clock(Duration::from_secs(30));
        cx.run_until_parked();
        assert_eq!(
            host.requests.lock().unwrap().len(),
            before,
            "waiting cannot schedule another HTTP read"
        );
        view.read_with(cx, |app, _| {
            assert!(matches!(
                app.read_state(ReadObject::Terapie).unwrap().kind,
                ViewStateKind::AttesaLunga { elapsed: 12.., .. }
            ))
        });
        view.update(cx, |app, cx| {
            app.patient.therapies = ReadLoad::Failed(RuntimeError::InvalidResponse);
            cx.notify();
        });
        draw(cx);
        cx.update(|window, cx| {
            assert!(view.read(cx).read_state_focus[ReadObject::Terapie.index()].is_focused(window))
        });
        cx.update_window_entity(&view, |app, window, cx| window.focus(&app.focus, cx));
        draw(cx);
        cx.update(|window, cx| {
            assert!(
                view.read(cx).focus.is_focused(window),
                "a repaint must not take focus again"
            )
        });
        view.update(cx, |app, cx| {
            app.patient.therapies = ReadLoad::Failed(RuntimeError::Forbidden);
            cx.notify();
        });
        draw(cx);
        cx.update(|window, cx| {
            assert!(
                view.read(cx).focus.is_focused(window),
                "an actionless state must preserve focus"
            )
        });
        host.assert_no_record_writes();
    }

    #[gpui::test]
    fn open_form_keeps_editor_focus_and_text_when_background_reads_fail(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = SyntheticHost::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.simulate_resize(gpui::size(px(1400.), px(900.)));
        view.update(cx, |app, _| enter_profile(app, &host));
        cx.update_window_entity(&view, |app, window, cx| {
            app.open_form(FormKind::Entry, window, cx)
        });
        draw(cx);
        let editor = view.read_with(cx, |app, _| {
            app.form.as_ref().unwrap().fields[0].editor.clone()
        });
        cx.update(|window, cx| {
            assert!(
                editor.read(cx).focus_handle(cx).is_focused(window),
                "the module must start with its first editor focused"
            );
        });
        cx.simulate_input("Bozza medica");
        draw(cx);
        let before = host.requests.lock().unwrap().clone();
        view.update(cx, |app, cx| {
            app.patient.therapies = ReadLoad::Failed(RuntimeError::InvalidResponse);
            app.patient.checkups = ReadLoad::Failed(RuntimeError::InvalidResponse);
            cx.notify();
        });
        draw(cx);
        cx.update(|window, cx| {
            assert!(
                editor.read(cx).focus_handle(cx).is_focused(window),
                "a background read failure must not move focus away from the open module"
            );
        });
        cx.simulate_input(" salvata");
        view.read_with(cx, |app, cx| {
            let draft = app.form.as_ref().unwrap();
            assert_eq!(
                draft.fields[0].value(cx),
                "Bozza medica salvata",
                "keystrokes must land in the draft editor after a background read failure"
            );
        });
        assert!(
            cx.debug_bounds("clinical-workspace-therapies-state-command")
                .is_some()
        );
        assert!(
            cx.debug_bounds("clinical-workspace-checkups-state-command")
                .is_some()
        );
        cx.run_until_parked();
        assert!(
            host.requests.lock().unwrap().len() == before.len(),
            "a background read failure must not schedule any HTTP read"
        );
        host.therapy_status.store(200, Ordering::Release);
        let watched = host.requests.lock().unwrap().len();
        let bounds = cx
            .debug_bounds("clinical-workspace-therapies-state-command")
            .unwrap();
        cx.simulate_click(bounds.center(), gpui::Modifiers::default());
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.patient.therapies.ready().is_some())
        });
        let requests = host.requests.lock().unwrap();
        assert_eq!(
            requests
                .iter()
                .skip(watched)
                .filter(|request| request.contains("/therapies "))
                .count(),
            1,
            "the state command is still reachable and retries only therapies"
        );
        assert!(
            !requests
                .iter()
                .skip(watched)
                .any(|request| request.contains("/checkups ")),
            "the therapies retry must not reread the checkups"
        );
        assert!(
            !requests
                .iter()
                .skip(watched)
                .any(|request| request.contains("/entries ")),
            "the therapies retry must not reread the diary"
        );
        drop(requests);
        host.assert_no_record_writes();
        view.read_with(cx, |app, cx| {
            assert_eq!(
                app.form.as_ref().unwrap().fields[0].value(cx),
                "Bozza medica salvata",
                "the draft text must survive the retry"
            );
        });
        assert!(
            cx.debug_bounds("clinical-workspace-checkups-state-command")
                .is_some()
        );
        host.assert_no_record_writes();
    }

    struct SyntheticHost {
        session: RuntimeSession,
        socket: std::net::SocketAddr,
        requests: Arc<Mutex<Vec<String>>>,
        therapy_status: Arc<AtomicU16>,
        stop: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl SyntheticHost {
        fn new() -> Self {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let socket = listener.local_addr().unwrap();
            let requests = Arc::new(Mutex::new(Vec::new()));
            let captured = requests.clone();
            let therapy_status = Arc::new(AtomicU16::new(403));
            let status = therapy_status.clone();
            let stop = Arc::new(AtomicBool::new(false));
            let stopping = stop.clone();
            let worker = thread::spawn(move || {
                loop {
                    let (mut stream, _) = listener.accept().unwrap();
                    if stopping.load(Ordering::Acquire) {
                        break;
                    }
                    stream
                        .set_read_timeout(Some(Duration::from_secs(10)))
                        .unwrap();
                    let request = read_request(&mut stream);
                    captured.lock().unwrap().push(request.clone());
                    let route = request.lines().next().unwrap();
                    let mut code = 200;
                    let response = if route.starts_with("GET /api/auth/check ") {
                        json!({"status":"ok", "isSetup":true, "archiveGeneration":"synthetic-generation",
                            "unlock":{"credential":"passphrase", "kdfVersion":3, "salt":"AwMDAwMDAwMDAwMDAwMDAw=="}})
                    } else if route.starts_with("POST /api/auth/native/login ") {
                        json!({"success":true, "id":"synthetic-user", "username":"synthetic", "role":"admin",
                            "archiveGeneration":"synthetic-generation", "salt":"AwMDAwMDAwMDAwMDAwMDAw==",
                            "encryptedMasterKey":"v3:BQUFBQUFBQUFBQUFAm40aZvQGpityOwyLKhsE40tJdbsjtrugIXzoJ/lk9gjlh5j7pIPeh7DLQ7ikGhA"})
                    } else if route.starts_with("GET /api/v1/network/capabilities ") {
                        json!({"protocolVersion":"1.13.0", "operatingMode":"network-home-base",
                            "capabilities":[{"key":"network.replica.write-clinical-diary",
                                "requiresPairing":true, "status":"available"}]})
                    } else if route.starts_with("GET /api/v1/network/ambulatories ") {
                        json!([{"id":"scope-a", "name":"Ambulatorio sintetico", "isDefault":true, "version":1}])
                    } else if route.starts_with("GET /api/v1/network/identity ") {
                        json!({"scope":{"effectiveAmbulatoryId":"scope-a", "requestBinding":"expected-ambulatory-id-v1"},
                            "operator":{"userId":"synthetic-user", "authChannel":"native"}})
                    } else if route.starts_with("POST /api/auth/native/logout ") {
                        json!({"success":true})
                    } else if route.contains("/therapies ") {
                        code = status.load(Ordering::Acquire);
                        json!([])
                    } else if route.contains("/entries ") {
                        json!([{"id":"synthetic-entry", "patientId":"synthetic-patient", "type":"visit",
                            "title":"Diario sintetico letto", "content":"Contenuto sintetico conservato", "date":"2026-10-20", "version":1}])
                    } else {
                        assert!(route.starts_with("GET "), "unexpected mutation: {route}");
                        json!([])
                    };
                    let response = response.to_string();
                    write!(stream, "HTTP/1.1 {code} Synthetic\r\nContent-Type: application/json\r\nSet-Cookie: mediflow_session={}; Path=/; HttpOnly\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", "a".repeat(64), response.len()).unwrap();
                }
            });
            let client = RuntimeClient::new(RuntimeConfig {
                base_url: format!("http://{socket}"),
                tls_pin_sha256: None,
            })
            .unwrap();
            let session = client
                .login(
                    PairingCredentials::new("synthetic-device", "x".repeat(64)).unwrap(),
                    "synthetic",
                    "Synthetic scales fixture passphrase",
                )
                .unwrap();
            session.list_ambulatories().unwrap();
            Self {
                session,
                socket,
                requests,
                therapy_status,
                stop,
                worker: Some(worker),
            }
        }

        fn assert_no_record_writes(&self) {
            for request in self.requests.lock().unwrap().iter() {
                let route = request.lines().next().unwrap();
                assert!(
                    route.starts_with("GET ") || route.starts_with("POST /api/auth/native/"),
                    "read command wrote a record: {route}"
                );
            }
        }
    }

    impl Drop for SyntheticHost {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Release);
            let _ = TcpStream::connect(self.socket);
            self.worker.take().unwrap().join().unwrap();
        }
    }

    fn read_request(stream: &mut TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut byte = [0];
        while !bytes.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            bytes.push(byte[0]);
            assert!(bytes.len() < 16384);
        }
        let header = String::from_utf8(bytes).unwrap();
        let size = header
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length: ")
                    .map(|length| length.parse::<usize>().unwrap())
            })
            .unwrap_or(0);
        let mut body = vec![0; size];
        stream.read_exact(&mut body).unwrap();
        header
    }
}
