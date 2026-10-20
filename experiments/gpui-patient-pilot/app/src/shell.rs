//! Connected clinical workspace. GPUI owns presentation; the runtime owns records,
//! encryption policy, authorization and writes. No clinical data is persisted here.

mod ai_preferences;
mod ai_status;
mod analytics;
mod document_details;
mod scales;
mod therapy_picker;
mod view_state;
mod who_lookup;

use crate::theme::{TypeRole, TypeStyle};

use gpui::{
    App, ClipboardItem, Context, Div, Entity, FocusHandle, KeyBinding, Role, ScrollAnchor,
    ScrollHandle, SharedString, Stateful, Subscription, Window, WindowAppearance, actions, div,
    prelude::*, px, text,
};
use mediflow_patient_client::{PatientProfile, ReadFailure, UpdateOutcome, Workspace};
use mediflow_runtime_client::{
    AgendaFilter, Ambulatory, Attachment, Checkup, CheckupDraft, DrugCatalogItem, Entry,
    EntryDraft, GlobalEntryFilter, Observation, ObservationDraft, PairingCredentials,
    PatientDetail, PatientSummary, ProfileQueryIntent, RuntimeClient, RuntimeConfig, RuntimeError,
    RuntimeSession, TerminologyRegistryEntry, TerminologyRegistryStatus, Therapy, TherapyDraft,
};
use std::collections::{HashMap, HashSet};

use zeroize::Zeroizing;

use crate::appointments::for_write as appointment_for_write;
use crate::clinical_text;
use crate::components::{
    WritingInk, WritingSurface, brand_icon, button, display_date, heading, notice, plain_text,
    section, tab, writing_status,
};
use crate::documents::{self, Upload};
use crate::editing;
use crate::icons::{Icon, icon};
use crate::navigation::{Area, Layout, PatientSection, adjacent_patient};
use crate::patient_forms;
use crate::references::{ReferenceKind, ReferenceRows};
use crate::text_input::{InputChanged, TextInput};
use crate::theme::Theme;

use ai_preferences::AiPreferences;
use ai_status::AiRuntimeObservation;
use analytics::AnalyticsArea;
use scales::{ScaleArea, ScaleAssessment};
use therapy_picker::TherapySelection;
use view_state::{ReadLoad, ReadObject, ViewState};
use who_lookup::WhoLookup;

actions!(
    mediflow_connected,
    [
        NextFocus,
        PreviousFocus,
        Search,
        SearchView,
        NextPatient,
        PreviousPatient,
        NewEntry,
        Review,
        Escape,
        Refresh,
        Lock
    ]
);

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys(key_bindings());
}

fn key_bindings() -> Vec<KeyBinding> {
    // Negative context checks inspect every ancestor. A text input within
    // the worklist keeps its characters, arrows and IME input.
    let outside_input = Some("MediFlowConnected && !MediFlowTextInput");
    let worklist = Some("MediFlowWorklist && !MediFlowTextInput");
    let rows = Some("MediFlowPatientList && !MediFlowTextInput");
    vec![
        KeyBinding::new("tab", NextFocus, None),
        KeyBinding::new("shift-tab", PreviousFocus, None),
        KeyBinding::new("secondary-k", Search, None),
        KeyBinding::new("/", SearchView, outside_input),
        KeyBinding::new("j", NextPatient, worklist),
        KeyBinding::new("k", PreviousPatient, worklist),
        KeyBinding::new("down", NextPatient, rows),
        KeyBinding::new("up", PreviousPatient, rows),
        KeyBinding::new("secondary-n", NewEntry, outside_input),
        KeyBinding::new("secondary-enter", Review, None),
        KeyBinding::new("escape", Escape, None),
        KeyBinding::new("secondary-r", Refresh, None),
        KeyBinding::new("secondary-l", Lock, None),
        KeyBinding::new("secondary-shift-l", Lock, None),
    ]
}

enum Load<T> {
    Idle,
    Loading,
    Ready(T),
    Failed(String),
}
impl<T> Load<T> {
    fn ready(&self) -> Option<&T> {
        if let Self::Ready(value) = self {
            Some(value)
        } else {
            None
        }
    }
    fn from_result(result: Result<T, RuntimeError>) -> Self {
        match result {
            Ok(value) => Self::Ready(value),
            Err(error) => Self::Failed(ui_error(error)),
        }
    }
    fn message(&self) -> Option<&str> {
        match self {
            Self::Idle => Some("Dati non ancora caricati."),
            Self::Loading => Some("Lettura in corso…"),
            Self::Failed(message) => Some(message),
            Self::Ready(_) => None,
        }
    }
}

struct Field {
    label: &'static str,
    editor: Entity<TextInput>,
    rich_source: Option<String>,
    read_only: bool,
    choices: &'static [(&'static str, &'static str)],
    scroll_target: Option<ScrollTarget>,
}
impl Field {
    fn new(
        id: &'static str,
        label: &'static str,
        value: &str,
        multiline: bool,
        secret: bool,
        theme: Theme,
        cx: &mut Context<ClinicalApp>,
    ) -> Self {
        let editor = cx.new(|cx| {
            let input = TextInput::new(id, label, "", multiline, theme, cx);
            let mut input = if secret { input.secret() } else { input };
            input.set_content(value, cx);
            input
        });
        Self {
            label,
            editor,
            rich_source: None,
            read_only: false,
            choices: &[],
            scroll_target: None,
        }
    }
    fn with_scroll(mut self, handle: &ScrollHandle, cx: &App) -> Self {
        let mut target = ScrollTarget::new(handle, cx);
        target.focus = target.focus.tab_stop(false);
        self.scroll_target = Some(target);
        self
    }
    fn value(&self, cx: &App) -> String {
        self.editor.read(cx).value().to_owned()
    }
}

fn first_text_editor(fields: &[Field]) -> Option<&Field> {
    fields
        .iter()
        .find(|field| !field.read_only && field.rich_source.is_none() && field.choices.is_empty())
}

// Explicit targets keep Tab navigation visible in the existing Div scroll panes.
// GPUI's request_autoscroll is consumed by List, not by Div in the pinned revision.
struct ScrollTarget {
    focus: FocusHandle,
    anchor: ScrollAnchor,
}
impl ScrollTarget {
    fn new(handle: &ScrollHandle, cx: &App) -> Self {
        Self {
            focus: cx.focus_handle().tab_stop(true),
            anchor: ScrollAnchor::for_handle(handle.clone()),
        }
    }
    fn attach(&self, element: Stateful<Div>) -> Stateful<Div> {
        self.attach_enabled(element, true)
    }
    fn attach_enabled(&self, element: Stateful<Div>, enabled: bool) -> Stateful<Div> {
        element
            .track_focus(&self.focus.clone().tab_stop(enabled))
            .anchor_scroll(Some(self.anchor.clone()))
    }
    fn scroll_to(&self, window: &mut Window, cx: &mut App) {
        self.anchor.scroll_to(window, cx);
        window.on_next_frame(|window, _| window.refresh());
    }
    fn reveal_if_focused(&self, window: &mut Window, cx: &mut App) -> bool {
        if self.focus.contains_focused(window, cx) {
            self.scroll_to(window, cx);
            true
        } else {
            false
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct DateInterval {
    from_day: String,
    to_day: String,
    from: Option<String>,
    to: Option<String>,
}
impl DateInterval {
    fn description(&self) -> String {
        match (self.from.is_some(), self.to.is_some()) {
            (false, false) => "Intervallo applicato: tutte le date.".into(),
            (true, false) => format!(
                "Intervallo applicato: dal {}.",
                display_date(Some(&self.from_day))
            ),
            (false, true) => format!(
                "Intervallo applicato: fino al {} compreso.",
                display_date(Some(&self.to_day))
            ),
            (true, true) => format!(
                "Intervallo applicato: dal {} al {} compreso.",
                display_date(Some(&self.from_day)),
                display_date(Some(&self.to_day))
            ),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FormKind {
    Notes,
    Entry,
    Scale,
    Therapy,
    Observation,
    Checkup,
    Document,
    PatientNew,
    PatientProfile,
}
impl FormKind {
    fn title(self) -> &'static str {
        match self {
            Self::Notes => "Note della scheda",
            Self::Entry => "Nuova voce",
            Self::Scale => "Valutazione con scala",
            Self::Therapy => "Nuova terapia",
            Self::Observation => "Nuovo parametro",
            Self::Document => "Nuovo documento",
            Self::Checkup => "Nuovo controllo",
            Self::PatientNew => "Nuova scheda",
            Self::PatientProfile => "Modifica anagrafica",
        }
    }
    fn noun(self) -> &'static str {
        match self {
            Self::Notes => "le note",
            Self::Entry => "una voce di diario",
            Self::Scale => "la valutazione",
            Self::Therapy => "una terapia",
            Self::Observation => "un parametro",
            Self::Document => "un documento",
            Self::Checkup => "un controllo",
            Self::PatientNew => "una nuova scheda",
            Self::PatientProfile => "l'anagrafica",
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum FormState {
    Draft,
    Review,
    Saving,
    Conflict,
    Uncertain,
    Rejected,
}
struct Form {
    kind: FormKind,
    fields: Vec<Field>,
    upload: Option<Upload>,
    edit: Option<editing::Record>,
    patient_original: Option<PatientDetail>,
    created_id: Option<String>,
    therapy: Option<TherapySelection>,
    scale: Option<ScaleAssessment>,
    state: FormState,
    _subscriptions: Vec<Subscription>,
}
impl Form {
    fn selected_drug(&self) -> Option<&DrugCatalogItem> {
        self.therapy.as_ref().and_then(TherapySelection::selected)
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Discard {
    Form,
    Reload,
    Lock,
}

struct PatientData {
    detail: ReadLoad<PatientDetail>,
    entries: ReadLoad<Vec<Entry>>,
    therapies: ReadLoad<Vec<Therapy>>,
    observations: ReadLoad<Vec<Observation>>,
    checkups: ReadLoad<Vec<Checkup>>,
    attachments: Load<Vec<Attachment>>,
    document_details_id: Option<String>,
}
impl Default for PatientData {
    fn default() -> Self {
        Self {
            detail: ReadLoad::Idle,
            entries: ReadLoad::Idle,
            therapies: ReadLoad::Idle,
            observations: ReadLoad::Idle,
            checkups: ReadLoad::Idle,
            attachments: Load::Idle,
            document_details_id: None,
        }
    }
}

// Device pairing is deliberately separate from the operator session. It lives
// only in this window; dropping/changing it zeroizes the retained device token.
struct StoredPairing {
    client: RuntimeClient,
    id: String,
    token: Zeroizing<String>,
}

pub struct ClinicalApp {
    session: Option<RuntimeSession>,
    pairing: Option<StoredPairing>,
    show_tls_pin: bool,
    login_scroll: gpui::ScrollHandle,
    connecting: bool,
    document_busy: bool,
    edit_pending: bool,
    focus_first_field: bool,
    login_fields: Vec<Field>,
    login_actions: [ScrollTarget; 3],
    ambulatories: Load<Vec<Ambulatory>>,
    scope: Option<String>,
    patients: Load<Vec<PatientSummary>>,
    global_patients: Load<Vec<PatientSummary>>,
    agenda: Load<Vec<Checkup>>,
    global_entries: Load<Vec<Entry>>,
    global_query: String,
    global_search: Entity<TextInput>,
    global_search_target: ScrollTarget,
    global_dates: [Field; 2],
    global_interval: DateInterval,
    global_date_error: Option<String>,
    global_apply_target: ScrollTarget,
    area_scroll: ScrollHandle,
    menu_targets: [ScrollTarget; 8],
    reference_kind: ReferenceKind,
    reference_rows: Load<ReferenceRows>,
    reference_search: Entity<TextInput>,
    reference_search_target: ScrollTarget,
    reference_run_target: ScrollTarget,
    reference_query: String,
    drug_count: Load<u64>,
    exemption_count: Load<u64>,
    reference_registry: Load<Vec<TerminologyRegistryEntry>>,
    ai_status: Load<AiRuntimeObservation>,
    ai_refresh_target: ScrollTarget,
    ai_preferences: AiPreferences,
    who: WhoLookup,
    scales: ScaleArea,
    analytics: AnalyticsArea,
    selected_id: Option<String>,
    patient: PatientData,
    core: Workspace,
    area: Area,
    patient_section: PatientSection,
    directory: bool,
    show_other: bool,
    show_sections: bool,
    section_selector_focus: FocusHandle,
    archived: bool,
    query: String,
    search: Entity<TextInput>,
    search_target: ScrollTarget,
    directory_scroll: ScrollHandle,
    patient_targets: HashMap<String, ScrollTarget>,
    form: Option<Form>,
    discard: Option<Discard>,
    message: Option<(String, bool)>,
    verified: Option<String>,
    dark_override: Option<bool>,
    dark: bool,
    text_scale: f32,
    increased_contrast: bool,
    theme: Theme,
    focus: FocusHandle,
    review_focus: FocusHandle,
    form_actions: [ScrollTarget; 8],
    focus_after_render: bool,
    focus_search_after_render: bool,
    profile_scroll: gpui::ScrollHandle,
    read_state_focus: [FocusHandle; 5],
    read_state_commands: Vec<(ReadObject, ViewState)>,
    read_timer: Option<gpui::Task<()>>,
    epoch: u64,
    profile_query_intent: Option<ProfileQueryIntent>,
    _subscriptions: Vec<Subscription>,
}

impl ClinicalApp {
    pub fn new(server: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let dark = matches!(
            window.appearance(),
            WindowAppearance::Dark | WindowAppearance::VibrantDark
        );
        let theme = Theme::for_dark(dark);
        let login_scroll = ScrollHandle::new();
        let profile_scroll = ScrollHandle::new();
        let area_scroll = ScrollHandle::new();
        let directory_scroll = ScrollHandle::new();
        let review_focus = cx.focus_handle().tab_stop(true);
        let mut form_actions: [ScrollTarget; 8] =
            std::array::from_fn(|_| ScrollTarget::new(&profile_scroll, cx));
        form_actions[3].focus = review_focus.clone();
        let login_fields = vec![
            Field::new(
                "clinical-workspace-server",
                "Indirizzo del tuo archivio",
                &server,
                false,
                false,
                theme,
                cx,
            ),
            Field::new(
                "clinical-workspace-tls-pin",
                "Impronta del collegamento HTTPS (se richiesta)",
                "",
                false,
                false,
                theme,
                cx,
            ),
            Field::new(
                "clinical-workspace-pairing-id",
                "Identificativo di abbinamento",
                "",
                false,
                false,
                theme,
                cx,
            ),
            Field::new(
                "clinical-workspace-pairing-token",
                "Codice di abbinamento",
                "",
                false,
                true,
                theme,
                cx,
            ),
            Field::new(
                "clinical-workspace-username",
                "Nome utente",
                "",
                false,
                false,
                theme,
                cx,
            ),
            Field::new(
                "clinical-workspace-passphrase",
                "Frase di accesso",
                "",
                false,
                true,
                theme,
                cx,
            ),
        ]
        .into_iter()
        .map(|field| field.with_scroll(&login_scroll, cx))
        .collect();
        let global_dates = [
            Field::new(
                "clinical-workspace-date-from",
                "Dal (AAAA-MM-GG)",
                "",
                false,
                false,
                theme,
                cx,
            )
            .with_scroll(&area_scroll, cx),
            Field::new(
                "clinical-workspace-date-to",
                "Al (AAAA-MM-GG)",
                "",
                false,
                false,
                theme,
                cx,
            )
            .with_scroll(&area_scroll, cx),
        ];
        let search = cx.new(|cx| {
            TextInput::new(
                "clinical-workspace-patient-search",
                "Cerca un paziente",
                "Nome, cognome o codice fiscale…",
                false,
                theme,
                cx,
            )
        });
        let global_search = cx.new(|cx| {
            TextInput::new(
                "clinical-workspace-global-search",
                "Cerca nei risultati caricati",
                "Paziente, titolo o testo…",
                false,
                theme,
                cx,
            )
        });
        let global_subscription =
            cx.subscribe(&global_search, |this, _, event: &InputChanged, cx| {
                this.global_query.clone_from(&event.0);
                cx.notify();
            });
        let subscription = cx.subscribe(&search, |this, _, event: &InputChanged, cx| {
            this.query.clone_from(&event.0);
            cx.notify();
        });
        let reference_search = cx.new(|cx| {
            TextInput::new(
                "clinical-workspace-reference-search",
                "Cerca nel repertorio",
                "Nome o codice",
                false,
                theme,
                cx,
            )
        });
        let reference_subscription =
            cx.subscribe(&reference_search, |this, _, _: &InputChanged, cx| {
                this.who_query_changed();
                cx.notify();
            });
        let mut app = Self {
            session: None,
            pairing: None,
            show_tls_pin: false,
            login_actions: std::array::from_fn(|_| ScrollTarget::new(&login_scroll, cx)),
            login_scroll,
            connecting: false,
            document_busy: false,
            edit_pending: false,
            focus_first_field: false,
            login_fields,
            ambulatories: Load::Idle,
            scope: None,
            patients: Load::Idle,
            global_patients: Load::Idle,
            agenda: Load::Idle,
            global_entries: Load::Idle,
            global_query: String::new(),
            global_search,
            global_search_target: ScrollTarget::new(&area_scroll, cx),
            global_dates,
            global_interval: DateInterval::default(),
            global_date_error: None,
            global_apply_target: ScrollTarget::new(&area_scroll, cx),
            menu_targets: std::array::from_fn(|_| ScrollTarget::new(&area_scroll, cx)),
            reference_search_target: ScrollTarget::new(&area_scroll, cx),
            reference_run_target: ScrollTarget::new(&area_scroll, cx),
            ai_refresh_target: ScrollTarget::new(&area_scroll, cx),
            ai_preferences: AiPreferences::new(&area_scroll, cx),
            who: WhoLookup::new(&area_scroll, cx),
            scales: ScaleArea::new(&area_scroll, theme, cx),
            analytics: AnalyticsArea::new(theme, cx),
            area_scroll,
            reference_kind: ReferenceKind::Drugs,
            reference_rows: Load::Idle,
            reference_search,
            reference_query: String::new(),
            drug_count: Load::Idle,
            exemption_count: Load::Idle,
            reference_registry: Load::Idle,
            ai_status: Load::Idle,
            selected_id: None,
            patient: PatientData::default(),
            core: Workspace::default(),
            area: Area::Patients,
            patient_section: PatientSection::Overview,
            directory: true,
            show_other: false,
            show_sections: false,
            section_selector_focus: cx.focus_handle().tab_stop(true),
            archived: false,
            query: String::new(),
            search,
            search_target: ScrollTarget::new(&directory_scroll, cx),
            directory_scroll,
            patient_targets: HashMap::new(),
            form: None,
            discard: None,
            message: None,
            verified: None,
            dark_override: None,
            dark,
            text_scale: 1.,
            increased_contrast: false,
            theme,
            focus: cx.focus_handle(),
            review_focus,
            form_actions,
            focus_after_render: false,
            focus_search_after_render: false,
            profile_scroll,
            read_state_focus: std::array::from_fn(|_| cx.focus_handle()),
            read_state_commands: Vec::new(),
            read_timer: None,
            epoch: 0,
            profile_query_intent: None,
            _subscriptions: vec![subscription, global_subscription, reference_subscription],
        };
        let quit = cx.on_app_quit(|this, cx| {
            this.retire_form(cx);
            this.pairing.take();
            let session = this.session.take();
            if let Some(session) = &session {
                session.lock();
            }
            let task = cx.background_executor().spawn(async move {
                if let Some(session) = session {
                    let _ = session.logout();
                }
            });
            async move {
                task.await;
            }
        });
        app._subscriptions.push(quit);
        let release = cx.on_release(|this, cx| {
            this.retire_form(cx);
            this.pairing.take();
            if let Some(session) = this.session.take() {
                session.lock();
                cx.background_executor()
                    .spawn(async move {
                        let _ = session.logout();
                    })
                    .detach();
            }
        });
        app._subscriptions.push(release);
        // GPUI reports this after replacing the rendered dispatch tree. Restore
        // the workspace only when its focused control has disappeared (including
        // responsive controls). Surviving editors and OS window deactivation do
        // not lose their dispatch path, so they keep their focus. No frame loop
        // or list of individual state transitions is needed.
        let focus_lost = cx.on_focus_lost(window, |this, window, cx| {
            window.focus(&this.focus, cx);
        });
        app._subscriptions.push(focus_lost);
        window.focus(&app.focus, cx);
        app
    }

    fn retire_form(&mut self, cx: &mut App) {
        if let Some(form) = self.form.take() {
            if let Some(scale) = &form.scale {
                scale.retire();
            }
            if let Some(therapy) = &form.therapy {
                therapy.retire(cx);
            }
            for field in &form.fields {
                field.editor.update(cx, |input, cx| input.retire(cx));
            }
        }
    }

    fn retire_profile_selection(&self) {
        if let Some(session) = &self.session {
            session.clear_profile_selection();
        }
    }

    fn profile_intent(&mut self, session: &RuntimeSession) -> ProfileQueryIntent {
        if let Some(previous) = self.profile_query_intent.take() {
            previous.cancel();
        }
        let intent = session.profile_query_intent();
        self.profile_query_intent = Some(intent.clone());
        intent
    }

    fn next_epoch(&mut self) {
        self.read_timer = None;
        self.read_state_commands.clear();
        self.ai_preferences.reset();
        self.who.reset();
        self.patient.document_details_id = None;
        if let Some(intent) = self.profile_query_intent.take() {
            intent.cancel();
        }
        self.document_busy = false;
        self.edit_pending = false;
        self.ai_status = Load::Idle;
        self.epoch = self
            .epoch
            .checked_add(1)
            .expect("window request generation exhausted");
    }

    fn run<T: Send + 'static>(
        &self,
        operation: impl FnOnce() -> Result<T, RuntimeError> + Send + 'static,
        apply: impl FnOnce(&mut Self, Result<T, RuntimeError>, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        let epoch = self.epoch;
        let task = cx.background_executor().spawn(async move { operation() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                if this.epoch != epoch {
                    return;
                }
                if let Err(error) = &result
                    && error.is_auth_failure()
                {
                    let message = if this.ai_preferences.is_saving() {
                        format!(
                            "Salvataggio delle preferenze AI non verificato. {}",
                            ui_error(error)
                        )
                    } else if this.form.as_ref().is_some_and(|form| {
                        form.kind == FormKind::Scale
                            && form
                                .scale
                                .as_ref()
                                .is_some_and(ScaleAssessment::has_attempt)
                    }) {
                        format!(
                            "Salvataggio della valutazione non verificato. {}",
                            ui_error(error)
                        )
                    } else {
                        ui_error(error)
                    };
                    this.disconnect(cx);
                    this.message = Some((message, true));
                    return;
                }
                apply(this, result, cx);
                cx.notify();
            });
        })
        .detach();
    }

    fn prepare_pairing(&mut self, cx: &mut Context<Self>) {
        if self.connecting {
            return;
        }
        let address = self.login_fields[0].value(cx).trim().to_owned();
        let pin = self.login_fields[1].value(cx).trim().to_owned();
        let id = self.login_fields[2].value(cx).trim().to_owned();
        let token = Zeroizing::new(self.login_fields[3].value(cx));
        if address.is_empty() || id.is_empty() || token.is_empty() {
            self.message = Some((
                "Completa indirizzo, identificativo e codice di abbinamento.".into(),
                true,
            ));
            cx.notify();
            return;
        }
        self.next_epoch();
        self.connecting = true;
        self.message = None;
        self.login_fields[3]
            .editor
            .update(cx, |input, cx| input.set_content("", cx));
        self.run(
            move || {
                let client = RuntimeClient::new(RuntimeConfig {
                    base_url: address,
                    tls_pin_sha256: (!pin.is_empty()).then_some(pin),
                })?;
                // Local validation is not a connected/authorized device claim.
                let _ = PairingCredentials::new(id.clone(), token.to_string())?;
                Ok(StoredPairing { client, id, token })
            },
            |this, result, _| {
                this.connecting = false;
                match result {
                    Ok(pairing) => {
                        this.pairing = Some(pairing);
                        this.focus_after_render = true;
                        this.login_scroll.set_offset(gpui::point(px(0.), px(0.)));
                    }
                    Err(error) => this.message = Some((ui_error(error), true)),
                }
            },
            cx,
        );
        cx.notify();
    }

    fn forget_pairing(&mut self, cx: &mut Context<Self>) {
        self.disconnect(cx);
        self.pairing.take();
        self.login_scroll.set_offset(gpui::point(px(0.), px(0.)));
        self.login_fields[3]
            .editor
            .update(cx, |input, cx| input.set_content("", cx));
        self.login_fields[5]
            .editor
            .update(cx, |input, cx| input.set_content("", cx));
        self.message = None;
        cx.notify();
    }

    fn connect(&mut self, cx: &mut Context<Self>) {
        if self.connecting {
            return;
        }
        let Some(pairing) = &self.pairing else {
            return;
        };
        let username = self.login_fields[4].value(cx).trim().to_owned();
        let passphrase = Zeroizing::new(self.login_fields[5].value(cx));
        if username.is_empty() || passphrase.is_empty() {
            self.message = Some(("Inserisci nome utente e frase di accesso.".into(), true));
            cx.notify();
            return;
        }
        let client = pairing.client.clone();
        let id = pairing.id.clone();
        let token = Zeroizing::new(pairing.token.to_string());
        self.next_epoch();
        let epoch = self.epoch;
        self.connecting = true;
        self.message = None;
        self.login_fields[5]
            .editor
            .update(cx, |input, cx| input.set_content("", cx));
        let task = cx.background_executor().spawn(async move {
            let pairing = PairingCredentials::new(id, token.to_string())?;
            client.login(pairing, &username, &passphrase)
        });
        cx.spawn(async move |this, cx| {
            let mut result = Some(task.await);
            let _ = this.update(cx, |this, cx| {
                if this.epoch != epoch {
                    return;
                }
                this.connecting = false;
                match result.take().expect("one login result") {
                    Ok(session) => {
                        this.session = Some(session);
                        this.focus_after_render = true;
                        this.message = None;
                        this.load_ambulatories(cx);
                    }
                    Err(error) => this.message = Some((ui_error(error), true)),
                }
                cx.notify();
            });
            if let Some(Ok(session)) = result {
                session.lock();
                cx.background_executor()
                    .spawn(async move {
                        let _ = session.logout();
                    })
                    .detach();
            }
        })
        .detach();
        cx.notify();
    }

    fn disconnect(&mut self, cx: &mut Context<Self>) {
        self.scales.reset(cx);
        self.focus_after_render = true;
        self.focus_search_after_render = false;
        self.patient_targets.clear();
        self.directory_scroll
            .set_offset(gpui::point(px(0.), px(0.)));
        self.next_epoch();
        if let Some(session) = self.session.take() {
            session.lock();
            cx.background_executor()
                .spawn(async move {
                    let _ = session.logout();
                })
                .detach();
        }
        self.connecting = false;
        self.scope = None;
        self.ambulatories = Load::Idle;
        self.patients = Load::Idle;
        self.global_patients = Load::Idle;
        self.agenda = Load::Idle;
        self.global_entries = Load::Idle;
        self.reference_rows = Load::Idle;
        self.reference_query.clear();
        self.drug_count = Load::Idle;
        self.exemption_count = Load::Idle;
        self.reference_registry = Load::Idle;
        self.reference_search
            .update(cx, |input, cx| input.set_content("", cx));
        self.global_query.clear();
        self.global_interval = DateInterval::default();
        self.global_date_error = None;
        for field in &self.global_dates {
            field
                .editor
                .update(cx, |input, cx| input.set_content("", cx));
        }
        self.global_search
            .update(cx, |input, cx| input.set_content("", cx));
        self.retire_profile_selection();
        self.selected_id = None;
        self.patient = PatientData::default();
        self.core.lock();
        self.retire_form(cx);
        self.discard = None;
        self.verified = None;
        self.query.clear();
        self.login_fields[5]
            .editor
            .update(cx, |input, cx| input.set_content("", cx));
        self.search
            .update(cx, |input, cx| input.set_content("", cx));
        self.message = Some((
            "Sessione bloccata. Accedi per tornare al lavoro.".into(),
            false,
        ));
        cx.notify();
    }

    fn load_ambulatories(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else {
            return;
        };
        self.ambulatories = Load::Loading;
        self.run(
            move || session.list_ambulatories(),
            |this, result, cx| match result {
                Ok(rows) => {
                    let selected = rows
                        .iter()
                        .find(|r| r.is_default)
                        .or(rows.first())
                        .map(|r| r.id.clone());
                    this.ambulatories = Load::Ready(rows);
                    if let Some(id) = selected {
                        this.change_scope(&id, cx);
                    }
                }
                Err(error) => this.ambulatories = Load::Failed(ui_error(error)),
            },
            cx,
        );
    }

    fn change_scope(&mut self, id: &str, cx: &mut Context<Self>) {
        if self.form.is_some() {
            self.message = Some((
                "Completa o scarta la bozza prima di cambiare ambulatorio.".into(),
                false,
            ));
            cx.notify();
            return;
        }
        self.focus_after_render = true;
        self.scope = Some(id.to_owned());
        self.global_patients = Load::Idle;
        self.agenda = Load::Idle;
        self.global_entries = Load::Idle;
        self.reference_rows = Load::Idle;
        self.drug_count = Load::Idle;
        self.exemption_count = Load::Idle;
        self.reference_registry = Load::Idle;
        self.retire_profile_selection();
        self.selected_id = None;
        self.patient = PatientData::default();
        self.core = Workspace::default();
        self.directory = true;
        if matches!(self.area, Area::Agenda | Area::Diary) {
            self.patients = Load::Idle;
            self.load_global_area(cx);
        } else if self.area == Area::References {
            self.load_references(cx);
        } else if self.area == Area::Settings {
            self.load_ai_status(cx);
        } else if self.area == Area::Scales {
            self.load_scales(cx);
        } else if self.area == Area::Analytics {
            self.analytics.reset(cx);
            self.load_analytics(cx);
        } else {
            self.load_patients(cx);
        }
    }

    fn load_patients(&mut self, cx: &mut Context<Self>) {
        let (Some(session), Some(scope)) = (self.session.clone(), self.scope.clone()) else {
            return;
        };
        self.next_epoch();
        self.patients = Load::Loading;
        let archived = self.archived;
        self.run(
            move || session.list_patients(&scope, archived),
            |this, result, _| {
                this.patients = Load::from_result(result);
            },
            cx,
        );
        cx.notify();
    }

    fn select_patient(&mut self, id: &str, open: bool, cx: &mut Context<Self>) {
        if self.form.is_some() {
            self.message = Some(("La bozza appartiene al paziente corrente. Completa o scarta prima di cambiare scheda.".into(), false));
            cx.notify();
            return;
        }
        let (Some(session), Some(scope)) = (self.session.clone(), self.scope.clone()) else {
            return;
        };
        let request = match self.core.select(id) {
            Ok(request) => request,
            Err(_) => return,
        };
        if let Err(error) = session.select_profile_patient(&scope, id) {
            self.core
                .receive_read(&request, Err(ReadFailure::Unavailable));
            self.message = Some((ui_error(error), true));
            cx.notify();
            return;
        }
        self.next_epoch();
        self.focus_after_render = open;
        self.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
        self.selected_id = Some(id.to_owned());
        self.directory = !open;
        if self.area != Area::Scales {
            self.area = Area::Patients;
        }
        self.show_other = false;
        self.patient_section = PatientSection::Overview;
        self.patient = PatientData::default();
        self.patient.detail = ReadLoad::loading();
        self.message = None;
        self.verified = None;
        let patient_id = id.to_owned();
        let intent = self.profile_intent(&session);
        self.run(
            move || session.open_patient_profile(&scope, &patient_id, &intent),
            move |this, result, _| match result {
                Ok(patient) => {
                    this.core
                        .receive_read(&request, Ok(profile_for_core(&patient)));
                    this.patient.detail = ReadLoad::Ready(patient);
                }
                Err(error) => {
                    this.core
                        .receive_read(&request, Err(ReadFailure::Unavailable));
                    this.patient.detail = ReadLoad::Failed(error);
                }
            },
            cx,
        );
        if self.area != Area::Scales {
            self.load_sections(cx);
        } else {
            self.watch_patient_reads(cx);
        }
        cx.notify();
    }

    fn load_sections(&mut self, cx: &mut Context<Self>) {
        let (Some(session), Some(scope), Some(id)) = (
            self.session.clone(),
            self.scope.clone(),
            self.selected_id.clone(),
        ) else {
            return;
        };
        self.patient.entries = ReadLoad::loading();
        self.patient.therapies = ReadLoad::loading();
        self.patient.observations = ReadLoad::loading();
        self.patient.checkups = ReadLoad::loading();
        self.patient.attachments = Load::Loading;
        self.patient.document_details_id = None;
        self.watch_patient_reads(cx);
        let s = session.clone();
        let a = scope.clone();
        let p = id.clone();
        self.run(
            move || s.list_entries(&a, &p),
            |this, result, _| this.patient.entries = ReadLoad::from_result(result),
            cx,
        );
        let s = session.clone();
        let a = scope.clone();
        let p = id.clone();
        self.run(
            move || s.list_therapies(&a, &p),
            |this, result, _| this.patient.therapies = ReadLoad::from_result(result),
            cx,
        );
        let s = session.clone();
        let a = scope.clone();
        let p = id.clone();
        self.run(
            move || s.list_observations(&a, &p),
            |this, result, _| this.patient.observations = ReadLoad::from_result(result),
            cx,
        );
        let s = session.clone();
        let a = scope.clone();
        let p = id.clone();
        self.run(
            move || s.list_checkups(&a, &p),
            |this, result, _| this.patient.checkups = ReadLoad::from_result(result),
            cx,
        );
        self.run(
            move || session.list_attachments(&scope, &id),
            |this, result, _| this.patient.attachments = Load::from_result(result),
            cx,
        );
    }

    fn navigate(&mut self, area: Area, cx: &mut Context<Self>) {
        if self.ai_preferences_blocks_navigation(cx) {
            return;
        }
        if self.form.is_some() {
            self.message = Some((
                "Completa o scarta la bozza prima di cambiare area.".into(),
                false,
            ));
        } else {
            self.focus_after_render = true;
            self.show_other = false;
            self.directory = true;
            if self.area != area {
                self.scales.reset(cx);
                self.analytics.reset(cx);
                self.retire_profile_selection();
                self.selected_id = None;
                self.patient = PatientData::default();
                self.core = Workspace::default();
                self.global_query.clear();
                self.global_search
                    .update(cx, |input, cx| input.set_content("", cx));
            }
            self.area_scroll.set_offset(gpui::point(px(0.), px(0.)));
            self.area = area;
            self.message = None;
            if matches!(area, Area::Agenda | Area::Diary) {
                self.load_global_area(cx);
            } else if area == Area::References {
                self.load_references(cx);
            } else if area == Area::Patients {
                self.load_patients(cx);
            } else if area == Area::Settings {
                self.load_ai_status(cx);
            } else if area == Area::Scales {
                self.load_scales(cx);
            } else if area == Area::Analytics {
                self.load_analytics(cx);
            } else {
                self.next_epoch();
            }
        }
        cx.notify();
    }

    fn load_global_area(&mut self, cx: &mut Context<Self>) {
        let (Some(session), Some(scope)) = (self.session.clone(), self.scope.clone()) else {
            return;
        };
        self.next_epoch();
        self.global_patients = Load::Loading;
        let s = session.clone();
        let a = scope.clone();
        self.run(
            move || {
                let mut patients = s.list_patients(&a, false)?;
                patients.extend(s.list_patients(&a, true)?);
                Ok(patients)
            },
            |this, result, _| this.global_patients = Load::from_result(result),
            cx,
        );
        match self.area {
            Area::Agenda => {
                self.agenda = Load::Loading;
                let filter = AgendaFilter {
                    date_from: self.global_interval.from.clone(),
                    date_to: self.global_interval.to.clone(),
                    limit: Some(200),
                    ..Default::default()
                };
                self.run(
                    move || session.list_agenda_with_filter(&scope, &filter),
                    |this, result, _| this.agenda = Load::from_result(result),
                    cx,
                );
            }
            Area::Diary => {
                self.global_entries = Load::Loading;
                let filter = GlobalEntryFilter {
                    date_from: self.global_interval.from.clone(),
                    date_to: self.global_interval.to.clone(),
                    limit: Some(50),
                    ..Default::default()
                };
                self.run(
                    move || session.list_global_entries_with_filter(&scope, &filter),
                    |this, result, _| this.global_entries = Load::from_result(result),
                    cx,
                );
            }
            _ => {}
        }
        cx.notify();
    }

    fn global_patient_name(&self, id: &str) -> String {
        self.global_patients
            .ready()
            .into_iter()
            .flatten()
            .chain(self.patients.ready().into_iter().flatten())
            .find(|patient| patient.id == id)
            .map(PatientSummary::display_name)
            .unwrap_or_else(|| "Paziente non presente nell'elenco caricato".into())
    }

    fn apply_global_interval(&mut self, cx: &mut Context<Self>) {
        if self.session.is_none()
            || self.scope.is_none()
            || !matches!(self.area, Area::Agenda | Area::Diary)
        {
            return;
        }
        match calendar_interval(
            &self.global_dates[0].value(cx),
            &self.global_dates[1].value(cx),
            &chrono::Local,
        ) {
            Ok(interval) => {
                self.global_interval = interval;
                self.global_date_error = None;
                self.load_global_area(cx);
            }
            Err(error) => {
                // Invalid edits do not replace the applied interval or its results.
                self.global_date_error = Some(error);
                cx.notify();
            }
        }
    }

    fn reveal_focused(&self, window: &mut Window, cx: &mut App) {
        let reveal_fields = |fields: &[Field], window: &mut Window, cx: &mut App| {
            fields
                .iter()
                .filter_map(|field| field.scroll_target.as_ref())
                .any(|target| target.reveal_if_focused(window, cx))
        };
        if self.session.is_none() {
            if !reveal_fields(&self.login_fields, window, cx) {
                self.login_actions
                    .iter()
                    .any(|target| target.reveal_if_focused(window, cx));
            }
        } else if let Some(form) = &self.form {
            if form
                .scale
                .as_ref()
                .is_some_and(|scale| scale.reveal_if_focused(window, cx))
            {
                return;
            }
            if !form
                .therapy
                .as_ref()
                .is_some_and(|therapy| therapy.reveal_if_focused(window, cx))
                && !reveal_fields(&form.fields, window, cx)
                && Layout::for_window(f32::from(window.viewport_size().width), self.text_scale)
                    .magnified
            {
                self.form_actions
                    .iter()
                    .any(|target| target.reveal_if_focused(window, cx));
            }
        } else if self.show_other {
            self.menu_targets
                .iter()
                .any(|target| target.reveal_if_focused(window, cx));
        } else if self.area == Area::Patients && self.directory {
            let magnified =
                Layout::for_window(f32::from(window.viewport_size().width), self.text_scale)
                    .magnified;
            if !(magnified && self.search_target.reveal_if_focused(window, cx)) {
                self.patient_targets
                    .values()
                    .any(|target| target.reveal_if_focused(window, cx));
            }
        } else if matches!(self.area, Area::Agenda | Area::Diary)
            && !reveal_fields(&self.global_dates, window, cx)
            && !self.global_apply_target.reveal_if_focused(window, cx)
        {
            self.global_search_target.reveal_if_focused(window, cx);
        } else if self.area == Area::References
            && !self.reference_search_target.reveal_if_focused(window, cx)
        {
            if !self.reference_run_target.reveal_if_focused(window, cx)
                && self.reference_kind == ReferenceKind::Who
            {
                self.who.reveal_if_focused(window, cx);
            }
        } else if self.area == Area::Settings {
            if self.ai_preferences.active {
                self.ai_preferences.reveal_if_focused(window, cx);
            } else {
                self.ai_refresh_target.reveal_if_focused(window, cx);
            }
        } else if self.area == Area::Scales {
            self.scales.reveal_if_focused(window, cx);
        }
    }

    fn sync_patient_targets(&mut self, cx: &App) {
        if self.session.is_none()
            || self.area != Area::Patients
            || !self.directory
            || self.show_other
            || self.form.is_some()
        {
            self.patient_targets.clear();
            return;
        }
        // Only IDs already present in the visible directory are retained. A row's
        // focus identity survives repaint/filtering until that row leaves the UI.
        let visible_ids: HashSet<_> = self
            .patients
            .ready()
            .into_iter()
            .flatten()
            .filter(|patient| patient.matches_query(&self.query))
            .map(|patient| patient.id.clone())
            .collect();
        self.patient_targets
            .retain(|id, _| visible_ids.contains(id));
        for id in visible_ids {
            self.patient_targets
                .entry(id)
                .or_insert_with(|| ScrollTarget::new(&self.directory_scroll, cx));
        }
    }

    fn navigation_shortcuts_available(&self) -> bool {
        self.session
            .as_ref()
            .is_some_and(|session| !session.is_locked())
            && self.scope.is_some()
            && self.form.is_none()
            && self.discard.is_none()
            && !self.edit_pending
            && !self.document_busy
            && !self.show_other
    }

    fn worklist_shortcuts_available(&self) -> bool {
        self.navigation_shortcuts_available()
            && self.area == Area::Patients
            && self.directory
            && self.patients.ready().is_some()
    }

    fn search_view(&mut self, cx: &mut Context<Self>) {
        if !self.navigation_shortcuts_available()
            || !matches!(self.area, Area::Agenda | Area::Diary | Area::References)
                && !(self.area == Area::Patients && self.directory)
        {
            return;
        }
        // Unlike the global shortcut, slash never changes area or leaves a
        // patient sheet. The binding excludes every TextInput, including IME.
        self.focus_after_render = false;
        self.focus_search_after_render = true;
        cx.notify();
    }

    fn focused_patient_id(&self, window: &Window, cx: &App) -> Option<String> {
        self.patient_targets
            .iter()
            .find(|(_, target)| target.focus.contains_focused(window, cx))
            .map(|(id, _)| id.clone())
    }

    fn move_patient(&mut self, previous: bool, window: &mut Window, cx: &mut Context<Self>) {
        if !self.worklist_shortcuts_available() {
            return;
        }
        let visible_ids: Vec<_> = self
            .patients
            .ready()
            .into_iter()
            .flatten()
            .filter(|patient| patient.matches_query(&self.query))
            .map(|patient| patient.id.as_str())
            .collect();
        let focused_id = self.focused_patient_id(window, cx);
        let Some(id) = adjacent_patient(
            &visible_ids,
            focused_id.as_deref(),
            self.selected_id.as_deref(),
            previous,
        )
        .map(str::to_owned) else {
            return;
        };
        if self.selected_id.as_deref() != Some(&id) {
            self.select_patient(&id, false, cx);
        }
        if let Some(target) = self.patient_targets.get(&id) {
            window.focus(&target.focus, cx);
            target.scroll_to(window, cx);
        }
        cx.notify();
    }

    fn new_entry_shortcut(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // A compact menu only blocks the shortcut while it is visible; the
        // remembered toggle must not disable a desktop action after resize.
        let section_menu_visible = self.show_sections
            && !self.directory
            && Layout::for_window(f32::from(window.viewport_size().width), self.text_scale).compact;
        if !self.navigation_shortcuts_available()
            || self.area != Area::Patients
            || section_menu_visible
        {
            return;
        }
        let Some(patient) = self.patient.detail.ready() else {
            return;
        };
        // A Tab-focused row can differ from the loaded preview. Do not create
        // a draft for the previous patient while another row holds the focus.
        if self.selected_id.as_deref() != Some(&patient.id)
            || self
                .focused_patient_id(window, cx)
                .is_some_and(|id| id != patient.id)
        {
            return;
        }
        self.open_form(FormKind::Entry, window, cx);
    }

    fn open_current(&mut self, path: &str, cx: &mut Context<Self>) {
        if let Some(session) = &self.session {
            // Paths originate only from our closed product navigation or loaded IDs.
            cx.open_url(&format!(
                "{}{}",
                session.base_url().trim_end_matches('/'),
                path
            ));
            self.message = Some(("La funzione si apre nell'interfaccia corrente. Potrebbe essere richiesto l'accesso.".into(), false));
        }
        cx.notify();
    }

    fn current_patient_path(&self, suffix: &str) -> Option<String> {
        self.selected_id
            .as_ref()
            .map(|id| format!("/patients/{}/{}", path_segment(id), suffix))
    }

    fn request_discard(&mut self, action: Discard, cx: &mut Context<Self>) {
        if action == Discard::Lock {
            let ai_pending = self.ai_preferences.is_saving();
            let pending = self
                .form
                .as_ref()
                .is_some_and(|form| form.state == FormState::Saving);
            self.disconnect(cx);
            if pending {
                self.message = Some(("Sessione bloccata. Una scrittura era in corso: verifica la scheda dopo l'accesso.".into(), false));
            } else if ai_pending {
                self.message = Some(("Sessione bloccata. Un salvataggio AI era in corso: rileggi le preferenze dopo l’accesso.".into(), false));
            }
            return;
        }
        if action == Discard::Reload && self.ai_preferences.active {
            self.load_ai_preferences(cx);
            return;
        }
        if action == Discard::Reload
            && self
                .form
                .as_ref()
                .is_some_and(|form| form.kind == FormKind::Scale)
        {
            self.reread_scale(cx);
            return;
        }
        if self
            .form
            .as_ref()
            .and_then(|form| form.scale.as_ref())
            .is_some_and(ScaleAssessment::is_working)
        {
            self.message = Some((
                "Operazione in corso. Attendi l’esito prima di chiudere la valutazione.".into(),
                false,
            ));
            cx.notify();
            return;
        }
        if self
            .form
            .as_ref()
            .is_some_and(|form| form.state == FormState::Saving)
        {
            self.message = Some((
                "Registrazione in corso. Attendi l'esito prima di chiudere.".into(),
                false,
            ));
        } else if self.form.is_some() {
            self.discard = Some(action);
        } else {
            self.finish_discard(action, cx);
        }
        cx.notify();
    }

    fn finish_discard(&mut self, action: Discard, cx: &mut Context<Self>) {
        self.focus_after_render = true;
        let was_creation = self
            .form
            .as_ref()
            .is_some_and(|form| form.kind == FormKind::PatientNew);
        let created_id = self.form.as_ref().and_then(|form| form.created_id.clone());
        self.retire_form(cx);
        self.discard = None;
        self.message = None;
        if was_creation {
            self.directory = true;
            if let Some(id) = created_id {
                self.select_patient(&id, true, cx);
            } else {
                self.load_patients(cx);
            }
            return;
        }
        if action == Discard::Lock {
            self.disconnect(cx);
            return;
        }
        self.next_epoch();
        if self.area == Area::Settings {
            self.load_ai_status(cx);
            return;
        }
        if self.area == Area::Scales {
            self.load_scales(cx);
            return;
        }
        if self.area == Area::References {
            if self.scope.is_none() {
                self.load_ambulatories(cx);
            } else if self.reference_kind == ReferenceKind::Who {
                self.request_who(false, cx);
            } else {
                self.drug_count = Load::Idle;
                self.exemption_count = Load::Idle;
                self.reference_registry = Load::Idle;
                self.load_references(cx);
            }
            return;
        }
        if matches!(self.area, Area::Agenda | Area::Diary) {
            if self.scope.is_none() {
                self.load_ambulatories(cx);
            } else {
                self.load_global_area(cx);
            }
            return;
        }
        if let Some(request) = self.core.discard_and_reload() {
            let (Some(session), Some(scope)) = (self.session.clone(), self.scope.clone()) else {
                return;
            };
            let id = request.patient_id.clone();
            let intent = self.profile_intent(&session);
            self.patient.detail = ReadLoad::loading();
            self.run(
                move || session.open_patient_profile(&scope, &id, &intent),
                move |this, result, _| match result {
                    Ok(patient) => {
                        this.core
                            .receive_read(&request, Ok(profile_for_core(&patient)));
                        this.patient.detail = ReadLoad::Ready(patient);
                    }
                    Err(error) => {
                        this.core
                            .receive_read(&request, Err(ReadFailure::Unavailable));
                        this.patient.detail = ReadLoad::Failed(error);
                    }
                },
                cx,
            );
            self.load_sections(cx);
        } else if self.selected_id.is_none() {
            if self.scope.is_none() {
                self.load_ambulatories(cx);
            } else {
                self.load_patients(cx);
            }
        }
        cx.notify();
    }

    fn open_form(&mut self, kind: FormKind, _window: &mut Window, cx: &mut Context<Self>) {
        if self.edit_pending || self.document_busy {
            return;
        }
        if !self.can_write(kind) {
            self.message = Some((
                "Questo accesso non consente la modifica richiesta.".into(),
                true,
            ));
            cx.notify();
            return;
        }
        self.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
        if self.form.is_some() {
            return;
        }
        let Some(patient) = self.patient.detail.ready() else {
            return;
        };
        if patient.is_archived || patient.deleted_at.is_some() {
            self.message = Some(("La scheda archiviata è in sola lettura.".into(), false));
            cx.notify();
            return;
        }
        if kind == FormKind::Notes && patient.field_locked("notes") {
            self.message = Some((
                "Le note non sono leggibili. Non possono essere sostituite da un campo vuoto."
                    .into(),
                true,
            ));
            cx.notify();
            return;
        }
        let today = chrono::Local::now()
            .date_naive()
            .format("%Y-%m-%d")
            .to_string();
        let rows: Vec<(&'static str, &'static str, String, bool)> = match kind {
            FormKind::Document
            | FormKind::PatientNew
            | FormKind::PatientProfile
            | FormKind::Scale => return,
            FormKind::Checkup => vec![
                (
                    "clinical-workspace-checkup-title",
                    "Titolo del controllo",
                    String::new(),
                    false,
                ),
                (
                    "clinical-workspace-checkup-date",
                    "Data (AAAA-MM-GG)",
                    today.clone(),
                    false,
                ),
                (
                    "clinical-workspace-checkup-time",
                    "Ora locale (HH:MM, secondi facoltativi)",
                    String::new(),
                    false,
                ),
                (
                    "clinical-workspace-checkup-notes",
                    "Note del controllo",
                    String::new(),
                    true,
                ),
            ],
            FormKind::Notes => vec![(
                "clinical-workspace-notes",
                "Note della scheda",
                patient.notes.clone().unwrap_or_default(),
                true,
            )],
            FormKind::Entry => vec![
                (
                    "clinical-workspace-entry-title",
                    "Titolo della voce",
                    String::new(),
                    false,
                ),
                (
                    "clinical-workspace-entry-date",
                    "Data (AAAA-MM-GG)",
                    today,
                    false,
                ),
                (
                    "clinical-workspace-entry-content",
                    "Testo della voce",
                    String::new(),
                    true,
                ),
            ],
            FormKind::Therapy => vec![
                (
                    "clinical-workspace-therapy-name",
                    "Farmaco",
                    String::new(),
                    false,
                ),
                (
                    "clinical-workspace-therapy-dosage",
                    "Dose e modalità di assunzione",
                    String::new(),
                    true,
                ),
                (
                    "clinical-workspace-therapy-date",
                    "Data di inizio (AAAA-MM-GG)",
                    today,
                    false,
                ),
                (
                    "clinical-workspace-therapy-reason",
                    "Motivo della terapia",
                    String::new(),
                    true,
                ),
            ],
            FormKind::Observation => vec![
                (
                    "clinical-workspace-observation-name",
                    "Nome del parametro",
                    String::new(),
                    false,
                ),
                (
                    "clinical-workspace-observation-code",
                    "Codice LOINC",
                    String::new(),
                    false,
                ),
                (
                    "clinical-workspace-observation-value",
                    "Valore",
                    String::new(),
                    false,
                ),
                (
                    "clinical-workspace-observation-unit",
                    "Unità UCUM",
                    String::new(),
                    false,
                ),
                (
                    "clinical-workspace-observation-date",
                    "Data (AAAA-MM-GG)",
                    today,
                    false,
                ),
            ],
        };
        let fields: Vec<_> = rows
            .into_iter()
            .map(|(id, label, value, multi)| {
                Field::new(id, label, &value, multi, false, self.theme, cx)
                    .with_scroll(&self.profile_scroll, cx)
            })
            .collect();
        let mut subscriptions = vec![];
        for field in &fields {
            subscriptions.push(cx.subscribe(
                &field.editor,
                move |this, editor, event: &InputChanged, cx| {
                    if kind == FormKind::Notes
                        && let Err(error) = this.core.edit_notes(event.0.clone())
                    {
                        this.message = Some((
                            format!("Modifica non accettata: {}.", client_message(error)),
                            true,
                        ));
                        let text = this.core.draft_notes().to_owned();
                        editor.update(cx, |input, cx| input.set_content(text, cx));
                    }
                    this.verified = None;
                    cx.notify();
                },
            ));
        }
        self.form = Some(Form {
            kind,
            fields,
            upload: None,
            edit: None,
            patient_original: None,
            created_id: None,
            therapy: (kind == FormKind::Therapy)
                .then(|| TherapySelection::new(&self.profile_scroll, cx)),
            scale: None,
            state: FormState::Draft,
            _subscriptions: subscriptions,
        });
        self.show_sections = false;
        // The first render populates the new ScrollAnchor before its scheduled
        // reveal runs. Scheduling here would use the anchor's initial origin.
        self.focus_after_render = true;
        self.focus_first_field = true;
        self.directory = false;
        self.message = None;
        self.verified = None;
        cx.notify();
    }

    fn review_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.discard.is_some() {
            return;
        }
        if self
            .form
            .as_ref()
            .is_some_and(|form| form.kind == FormKind::Scale)
        {
            self.review_scale(cx);
            return;
        }
        let Some(form) = &self.form else {
            return;
        };
        if form.state != FormState::Draft {
            return;
        }
        let values: Vec<_> = form.fields.iter().map(|field| field.value(cx)).collect();
        let error = validate_form_values(form, &values).err();
        if let Some(error) = error {
            self.message = Some((error, true));
            cx.notify();
            return;
        }
        if form.kind == FormKind::Notes
            && let Err(error) = self.core.review()
        {
            self.message = Some((client_message(error).into(), false));
            cx.notify();
            return;
        }
        self.close_drug_search(cx);
        self.form.as_mut().expect("reviewed form").state = FormState::Review;
        self.message = None;
        if Layout::for_window(f32::from(window.viewport_size().width), self.text_scale).magnified {
            self.profile_scroll.scroll_to_bottom();
        }
        window.focus(&self.review_focus, cx);
        cx.notify();
    }

    fn cancel_review(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self
            .form
            .as_ref()
            .is_some_and(|form| form.kind == FormKind::Scale)
        {
            self.cancel_scale_review(cx);
            return;
        }
        let Some(form) = &mut self.form else {
            return;
        };
        if form.state != FormState::Review {
            return;
        }
        if form.kind == FormKind::Notes {
            let _ = self.core.cancel_review();
        }
        form.state = FormState::Draft;
        if let Some(field) = first_text_editor(&form.fields) {
            field.editor.update(cx, |input, cx| input.focus(window, cx));
            if let Some(target) = &field.scroll_target {
                target.scroll_to(window, cx);
            }
        }
        cx.notify();
    }

    fn confirm_form(&mut self, cx: &mut Context<Self>) {
        if self.discard.is_some() {
            return;
        }
        if self
            .form
            .as_ref()
            .is_some_and(|form| form.kind == FormKind::Scale)
        {
            self.confirm_scale(cx);
            return;
        }
        let Some(form) = &self.form else {
            return;
        };
        if form.state != FormState::Review {
            return;
        }
        let kind = form.kind;
        let (Some(session), Some(scope)) = (self.session.clone(), self.scope.clone()) else {
            return;
        };
        let id = self.selected_id.clone().unwrap_or_default();
        if id.is_empty() && kind != FormKind::PatientNew {
            return;
        }
        let patient_original = form.patient_original.clone();
        let upload = form.upload.clone();
        let edit = form.edit.clone();
        let selected_drug = form.selected_drug().cloned();
        let values: Vec<_> = form.fields.iter().map(|field| field.value(cx)).collect();
        if let Err(message) = validate_form_values(form, &values) {
            self.message = Some((message, true));
            cx.notify();
            return;
        }
        self.form.as_mut().expect("confirmed form").state = FormState::Saving;
        self.message = None;
        // Supersede pending reads before writing: an older list cannot replace
        // the authoritative reread after an acknowledged mutation.
        self.next_epoch();
        let intent = self.profile_intent(&session);
        if kind == FormKind::PatientNew {
            self.run(move || patient_forms::create(&session, &scope, &values, &intent), |this, result, cx| {
                match result {
                    Ok(patient_forms::Creation::Verified(row)) => {
                        this.archived = false;
                        this.install_patient(*row);
                        this.saved("Scheda creata e dati anagrafici riletti dall'archivio.", cx);
                        this.load_sections(cx);
                    }
                    Ok(patient_forms::Creation::Unconfirmed { id, read_error }) => {
                        if let Some(form) = &mut this.form { form.created_id = Some(id); }
                        let message = read_error.map_or_else(
                            || "La creazione ha ricevuto una risposta, ma la rilettura non conferma tutti i dati. Rileggi prima di creare altre schede.".into(),
                            |error| format!("{error} La creazione ha ricevuto risposta, ma richiede verifica; non creare di nuovo la stessa scheda."));
                        this.save_unconfirmed(false, message, cx);
                    }
                    Err(error) => this.save_error(error, cx),
                }
            }, cx);
        } else if kind == FormKind::PatientProfile {
            let Some(original) = patient_original else {
                self.save_error(RuntimeError::InvalidInput, cx);
                return;
            };
            self.run(
                move || patient_forms::update(&session, &scope, &original, &values, &intent),
                |this, result, cx| match result {
                    Ok(Some(row)) => {
                        this.install_patient(row);
                        this.saved("Anagrafica modificata e riletta dalla scheda.", cx);
                        this.load_sections(cx);
                    }
                    Ok(None) => this.save_unconfirmed(
                        false,
                        "La rilettura non conferma l'anagrafica modificata. La bozza è conservata."
                            .into(),
                        cx,
                    ),
                    Err(RuntimeError::ProfileTooLarge) => this.save_unconfirmed(false,
                        format!("{} La bozza resta disponibile; verifica l'esito prima di un nuovo invio.", RuntimeError::ProfileTooLarge), cx),
                    Err(error) => this.save_error(error, cx),
                },
                cx,
            );
        } else if let Some(record) = edit {
            self.run(move || record.submit(&session, &scope, &values, selected_drug.as_ref()), |this, result, cx| {
                match result {
                    Ok(true) => this.saved("Modifica registrata e riletta dalla scheda.", cx),
                    Ok(false) => this.save_unconfirmed(false, "La rilettura non conferma tutti i dati modificati. Verifica la scheda prima di un nuovo invio.".into(), cx),
                    Err(error) => this.save_error(error, cx),
                }
                this.load_sections(cx);
            }, cx);
        } else if kind == FormKind::Notes {
            let command = match self.core.confirm() {
                Ok(command) => command,
                Err(error) => {
                    self.form.as_mut().expect("confirmed form").state = FormState::Draft;
                    self.message = Some((client_message(error).into(), true));
                    cx.notify();
                    return;
                }
            };
            let submitted = command.clone();
            self.run(move || {
                session.update_patient_notes(&scope, &id, submitted.expected_version, &submitted.notes)?;
                Ok(session.open_patient_profile(&scope, &id, &intent))
            }, move |this, result, cx| {
                match result {
                    Ok(readback) => {
                        let mut readback_message = "La rilettura non conferma la modifica. La bozza resta disponibile.".to_owned();
                        if let Some(request) = this.core.receive_update(&command, UpdateOutcome::Acknowledged) {
                            match readback {
                                Ok(patient) => {
                                    if patient.field_locked("notes") {
                                        this.core.receive_read(&request, Err(ReadFailure::Invalid));
                                    } else {
                                        this.core.receive_read(&request, Ok(profile_for_core(&patient)));
                                    }
                                    this.patient.detail = ReadLoad::Ready(patient);
                                }
                                Err(error) => {
                                    if error.is_auth_failure() {
                                        this.disconnect(cx);
                                        this.message = Some((ui_error(error), true));
                                        return;
                                    }
                                    if error == RuntimeError::ProfileTooLarge {
                                        readback_message = format!("{error} La bozza resta disponibile; verifica l'esito prima di un nuovo invio.");
                                    }
                                    this.core.receive_read(&request, Err(ReadFailure::Unavailable));
                                }
                            }
                        }
                        if this.core.phase() == mediflow_patient_client::Phase::Saved {
                            this.saved("Note registrate e rilette dalla scheda.", cx);
                        } else { this.save_unconfirmed(false, readback_message, cx); }
                    }
                    Err(error) => {
                        let outcome = if error.is_conflict() { UpdateOutcome::Conflict } else if error.is_indeterminate() { UpdateOutcome::Indeterminate } else { UpdateOutcome::Rejected };
                        this.core.receive_update(&command, outcome);
                        this.save_error(error, cx);
                    }
                }
                this.load_sections(cx);
            }, cx);
        } else if kind == FormKind::Document {
            let Some(upload) = upload else {
                self.save_error(RuntimeError::InvalidInput, cx);
                return;
            };
            self.run(move || {
                let created = session.create_attachment(&scope, &id, &upload.name, &upload.mime_type, &upload.bytes)?;
                after_create_read(session.read_attachment(&scope, &id, &created.id), |row| row.id == created.id && row.patient_id == id && upload.matches(&row))
            }, |this, result, cx| {
                match result {
                    Ok(true) => this.saved("Documento registrato: nome, formato, dimensione e contenuto riletti e verificati.", cx),
                    Ok(false) => this.save_unconfirmed(false, "La rilettura non conferma il documento inviato. Verifica la scheda prima di aggiungerlo di nuovo.".into(), cx),
                    Err(error) => this.save_error(error, cx),
                }
                this.load_sections(cx);
            }, cx);
        } else {
            self.run(move || save_new_record(&session, &scope, &id, kind, &values, selected_drug.as_ref()), |this, result, cx| {
                match result {
                    Ok(true) => this.saved("Elemento registrato e riletto dalla scheda.", cx),
                    Ok(false) => this.save_unconfirmed(false, "La rilettura non conferma tutti i dati inviati. La bozza resta disponibile.".into(), cx),
                    Err(error) => this.save_error(error, cx),
                }
                this.load_sections(cx);
            }, cx);
        }
        cx.notify();
    }

    fn saved(&mut self, message: &str, cx: &mut Context<Self>) {
        self.focus_after_render = true;
        self.retire_form(cx);
        self.discard = None;
        self.verified = Some(message.into());
        self.message = None;
        cx.notify();
    }

    fn save_error(&mut self, error: RuntimeError, cx: &mut Context<Self>) {
        self.focus_after_render = true;
        let conflict = error.is_conflict();
        let message = ui_error(error);
        if error.is_indeterminate() || conflict {
            self.save_unconfirmed(conflict, message, cx);
        } else {
            // An update consumes its prior read even when rejected. Freeze the
            // draft until an explicit reread; never resend with that old version.
            if let Some(form) = &mut self.form {
                form.state = FormState::Rejected;
            }
            self.message = Some((
                format!("{message} La bozza è conservata. Rileggi prima di un nuovo invio."),
                true,
            ));
            cx.notify();
        }
    }

    fn save_unconfirmed(&mut self, conflict: bool, message: String, cx: &mut Context<Self>) {
        self.focus_after_render = true;
        if let Some(form) = &mut self.form {
            form.state = if conflict {
                FormState::Conflict
            } else {
                FormState::Uncertain
            };
        }
        self.message = Some((message, true));
        cx.notify();
    }
}

impl ClinicalApp {
    fn section_selected(&mut self, section: PatientSection, cx: &mut Context<Self>) {
        if self.form.is_some() {
            self.message = Some((
                "Completa o scarta la bozza prima di cambiare modulo.".into(),
                false,
            ));
        } else {
            self.focus_after_render = true;
            self.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
            self.patient_section = section;
            self.show_sections = false;
        }
        cx.notify();
    }

    fn copy_profile(&mut self, cx: &mut Context<Self>) {
        let Some(patient) = self.patient.detail.ready() else {
            return;
        };
        let mut lines = vec![
            patient.display_name(),
            format!("Nascita: {}", display_date(patient.birth_date.as_deref())),
            format!("Codice fiscale: {}", patient.tax_code),
            "Allergie: dato non disponibile".into(),
        ];
        for (label, field, value) in [
            ("Indirizzo", "address", &patient.address),
            ("Telefono", "phone", &patient.phone),
            ("Note", "notes", &patient.notes),
        ] {
            lines.push(format!(
                "{label}: {}",
                if patient.field_locked(field) {
                    "Dato non leggibile".into()
                } else {
                    value
                        .as_deref()
                        .filter(|v| !v.is_empty())
                        .map(plain_text)
                        .unwrap_or_else(|| "Non indicato".into())
                }
            ));
        }
        cx.write_to_clipboard(ClipboardItem::new_string(lines.join("\n")));
        self.message = Some(("Dati della scheda copiati.".into(), false));
        cx.notify();
    }

    fn copy_draft(&mut self, cx: &mut Context<Self>) {
        let Some(form) = &self.form else {
            return;
        };
        let mut text = if let Some(scale) = &form.scale {
            scale.copy_text()
        } else if let Some(upload) = &form.upload {
            format!(
                "Documento scelto, non confermato
{}
{}
{}",
                upload.name,
                upload.mime_type,
                format_size(upload.bytes.len() as u64)
            )
        } else {
            form.fields
                .iter()
                .map(|field| format!("{}\n{}", field.label, field.value(cx)))
                .collect::<Vec<_>>()
                .join("\n\n")
        };
        if let Some(drug) = form.selected_drug() {
            text.push_str("\n\nFarmaco scelto dal repertorio\n");
            text.push_str(&crate::references::drug_text(drug));
        }
        cx.write_to_clipboard(ClipboardItem::new_string(text));
        self.message = Some((
            "Bozza copiata. Non è una conferma di registrazione.".into(),
            false,
        ));
        cx.notify();
    }

    fn brand(&self, compact: bool) -> Div {
        div()
            .min_w_0()
            .max_w_full()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(brand_icon(self.dark, if compact { 28. } else { 32. }))
            .child(
                div()
                    .flex_auto()
                    .min_w_0()
                    .max_w_full()
                    .type_role(self.theme, TypeRole::Brand)
                    .child(text!("MediFlow.")),
            )
    }

    fn navigation_item(&self, area: Area, compact: bool, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let active = self.area == area && !self.show_other;
        let color = if active { theme.fresh } else { theme.ink };
        div()
            .id(area.id())
            .accessibility_id(area.id())
            .role(Role::Button)
            .aria_label(area.title())
            .aria_selected(active)
            .focusable()
            .tab_stop(true)
            .when(self.show_other, |el| {
                let index = Area::ALL
                    .iter()
                    .position(|item| *item == area)
                    .expect("known product area");
                self.menu_targets[index].attach(el)
            })
            .min_w_0()
            .max_w_full()
            .min_h(px(44.))
            .px(px(if compact { 8. } else { 12. }))
            .py(px(8.))
            .flex()
            .when(compact, |el| el.flex_col().flex_1())
            .items_center()
            .gap(px(if compact { 4. } else { 12. }))
            .rounded(px(theme.control_radius))
            .bg(if active { theme.selected } else { theme.shade })
            .border_2()
            .border_color(if active { theme.selected } else { theme.shade })
            .type_role(
                theme,
                if compact {
                    TypeRole::Meta
                } else {
                    TypeRole::Body
                },
            )
            .when(active, |el| el.type_role(theme, TypeRole::Strong))
            .text_color(color)
            .cursor_pointer()
            .hover(move |s| s.bg(theme.hover))
            .focus(move |s| s.border_color(theme.fresh))
            .child(icon(Icon::for_area(area), color, 20.))
            .child(
                div()
                    .min_w_0()
                    .max_w_full()
                    .whitespace_normal()
                    .when(compact, |el| el.w_full().text_center())
                    .when(!compact, |el| el.flex_1())
                    .child(text!(area.title())),
            )
            .on_click(cx.listener(move |this, _, _, cx| this.navigate(area, cx)))
    }

    fn sidebar(&self, layout: Layout, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let operator = self
            .session
            .as_ref()
            .map(|session| {
                session
                    .user()
                    .display_name
                    .clone()
                    .unwrap_or_else(|| session.user().username.clone())
            })
            .unwrap_or_default();
        div()
            .id("clinical-workspace-navigation")
            .accessibility_id("clinical-workspace-navigation")
            .role(Role::Navigation)
            .aria_label("Aree di MediFlow")
            .w(px(layout.navigation))
            .flex_shrink_0()
            .flex()
            .flex_col()
            .gap(px(24.))
            .p(px(12.))
            .child(div().px(px(4.)).py(px(12.)).child(self.brand(false)))
            .child(
                div()
                    .id("clinical-workspace-navigation-items")
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .max_w_full()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .children(
                        Area::ALL
                            .into_iter()
                            .map(|area| self.navigation_item(area, false, cx)),
                    ),
            )
            .child(
                div()
                    .border_t_1()
                    .border_color(theme.rule)
                    .pt(px(16.))
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(
                        div()
                            .px(px(8.))
                            .type_role(theme, TypeRole::Section)
                            .text_color(theme.secondary)
                            .child(text!("ACCESSO PERSONALE")),
                    )
                    .child(
                        div()
                            .px(px(8.))
                            .type_role(theme, TypeRole::Body)
                            .child(text!(operator)),
                    )
                    .child(
                        button("clinical-workspace-lock", "Blocca", theme, false, true)
                            .gap(px(8.))
                            .child(icon(Icon::Lock, theme.ink, 16.))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.request_discard(Discard::Lock, cx)
                            })),
                    ),
            )
    }

    fn bottom_navigation(&self, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        div()
            .id("clinical-workspace-compact-navigation")
            .accessibility_id("clinical-workspace-compact-navigation")
            .role(Role::Navigation)
            .aria_label("Aree di MediFlow")
            .min_w_0()
            .max_w_full()
            .flex()
            .flex_shrink_0()
            .border_t_1()
            .border_color(theme.rule)
            .px(px(4.))
            .py(px(4.))
            .bg(theme.shade)
            .children(
                [Area::Patients, Area::Agenda, Area::Diary]
                    .into_iter()
                    .map(|area| self.navigation_item(area, true, cx)),
            )
            .child(
                div()
                    .id("clinical-workspace-other-areas")
                    .accessibility_id("clinical-workspace-other-areas")
                    .role(Role::Button)
                    .aria_label("Altre aree")
                    .aria_expanded(self.show_other)
                    .focusable()
                    .tab_stop(true)
                    .flex_1()
                    .min_w_0()
                    .max_w_full()
                    .min_h(px(44.))
                    .p(px(8.))
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(4.))
                    .type_role(theme, TypeRole::Meta)
                    .border_2()
                    .border_color(theme.shade)
                    .rounded(px(theme.control_radius))
                    .cursor_pointer()
                    .focus(move |s| s.border_color(theme.fresh))
                    .hover(move |s| s.bg(theme.hover))
                    .child(icon(Icon::More, theme.ink, 20.))
                    .child(
                        div()
                            .w_full()
                            .min_w_0()
                            .max_w_full()
                            .whitespace_normal()
                            .text_center()
                            .child(text!("Altro")),
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.form.is_some() {
                            this.message = Some((
                                "Completa o scarta la bozza prima di cambiare area.".into(),
                                false,
                            ));
                        } else {
                            this.show_other = !this.show_other;
                        }
                        cx.notify();
                    })),
            )
    }

    fn field_view(
        &self,
        field: &Field,
        id: impl Into<SharedString>,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        let theme = self.theme;
        let id = id.into();
        let editable = self.form.as_ref().is_some_and(|form| {
            form.state == FormState::Draft
                && !form.scale.as_ref().is_some_and(ScaleAssessment::is_working)
        }) && self.discard.is_none();
        let content = if let Some(source) = &field.rich_source {
            div()
                .id(id.clone())
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(clinical_text::render(source, WritingInk::Fresh, theme))
                .child(
                    div()
                        .type_role(theme, TypeRole::Meta)
                        .text_color(theme.secondary)
                        .child(text!(
                            "Contenuto conservato. Questo campo resta invariato in questa modifica."
                        )),
                )
                .into_any_element()
        } else if !field.choices.is_empty() {
            let value = field.editor.read(cx).value();
            div()
                .id(id.clone())
                .role(Role::Group)
                .aria_label(field.label)
                .min_w_0()
                .max_w_full()
                .flex()
                .flex_wrap()
                .gap(px(8.))
                .when(
                    !field.choices.iter().any(|(code, _)| value == *code),
                    |el| el.child(text!(format!("Stato registrato: {value}"))),
                )
                .children(field.choices.iter().map(|(code, label)| {
                    let code = *code;
                    let editor = field.editor.clone();
                    button(format!("{id}-{code}"), *label, theme, false, editable)
                        .aria_selected(value == code)
                        .when(value == code, |el| {
                            el.bg(theme.selected).border_color(theme.fresh)
                        })
                        .when(editable, |el| {
                            el.on_click(cx.listener(move |this, _, _, cx| {
                                editor.update(cx, |input, cx| input.set_content(code, cx));
                                this.verified = None;
                                cx.notify();
                            }))
                        })
                }))
                .into_any_element()
        } else {
            div()
                .id(id.clone())
                .min_w_0()
                .child(field.editor.clone())
                .into_any_element()
        };
        div()
            .id(SharedString::from(format!("{id}-field")))
            .when_some(field.scroll_target.as_ref(), |el, target| {
                el.track_focus(&target.focus)
            })
            .min_w_0()
            .max_w_full()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(
                div()
                    .type_role(theme, TypeRole::Body)
                    .child(text!(field.label)),
            )
            .child(
                div()
                    .id(SharedString::from(format!("{id}-scroll-target")))
                    .when_some(field.scroll_target.as_ref(), |el, target| {
                        el.anchor_scroll(Some(target.anchor.clone()))
                    })
                    .child(content),
            )
    }

    fn login_view(&self, layout: Layout, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let paired = self.pairing.is_some();
        let mut panel = div().w_full().min_w_0().max_w(px(640.)).flex_shrink_0().bg(theme.paper)
            .rounded(px(theme.paper_radius)).p(px(if layout.compact { 16. } else { 28. }))
            .flex().flex_col().gap(px(16.))
            .child(div().min_w_0().max_w_full().flex().flex_wrap().items_center().justify_between().gap(px(12.))
                .child(self.brand(true))
                .child(button("clinical-workspace-login-theme", if self.dark { "Giorno" } else { "Grafite" }, theme, false, true)
                    .on_click(cx.listener(|this, _, _, cx| { this.dark_override = Some(!this.dark); cx.notify(); }))))
            .child(div().flex().flex_col().gap(px(8.))
                .child(heading("clinical-workspace-connect-heading", if paired { "Accedi al tuo archivio" } else { "Collega questo dispositivo" }, theme))
                .child(div().text_color(theme.secondary).type_role(theme, TypeRole::Body)
                    .child(text!(if paired { "Sblocca i dati con il tuo account personale." } else { "Usa i dati di abbinamento già assegnati al dispositivo sul computer che ospita l'archivio." }))));
        if let Some(pairing) = &self.pairing {
            panel = panel
                .child(
                    div()
                        .border_b_1()
                        .border_color(theme.rule)
                        .pb(px(16.))
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .child(
                            div()
                                .type_role(theme, TypeRole::Section)
                                .text_color(theme.secondary)
                                .child(text!("ARCHIVIO SCELTO")),
                        )
                        .child(text!(pairing.client.base_url().to_owned())),
                )
                .children((4..6).map(|index| {
                    self.field_view(
                        &self.login_fields[index],
                        format!("clinical-workspace-login-field-{index}"),
                        cx,
                    )
                }));
        } else {
            panel = panel
                .children([0, 2, 3].into_iter().map(|index| {
                    self.field_view(
                        &self.login_fields[index],
                        format!("clinical-workspace-login-field-{index}"),
                        cx,
                    )
                }))
                .child(
                    self.login_actions[0]
                        .attach_enabled(
                            button(
                                "clinical-workspace-toggle-tls-pin",
                                if self.show_tls_pin {
                                    "Nascondi impronta del collegamento"
                                } else {
                                    "Hai un'impronta del collegamento?"
                                },
                                theme,
                                false,
                                !self.connecting,
                            ),
                            !self.connecting,
                        )
                        .aria_expanded(self.show_tls_pin)
                        .when(!self.connecting, |el| {
                            el.on_click(cx.listener(|this, _, _, cx| {
                                this.show_tls_pin = !this.show_tls_pin;
                                cx.notify();
                            }))
                        }),
                )
                .when(self.show_tls_pin, |el| {
                    el.child(self.field_view(
                        &self.login_fields[1],
                        "clinical-workspace-login-field-1",
                        cx,
                    ))
                });
        }
        if let Some((message, error)) = &self.message {
            panel = panel.child(notice(
                "clinical-workspace-login-message",
                message.clone(),
                theme,
                *error,
            ));
        }
        panel = if paired {
            panel.child(self.login_actions[1].attach_enabled(button("clinical-workspace-connect", if self.connecting { "Accesso in corso…" } else { "Accedi all'archivio" }, theme, true, !self.connecting), !self.connecting)
                .when(!self.connecting, |el| el.on_click(cx.listener(|this, _, _, cx| this.connect(cx)))))
                .child(self.login_actions[2].attach_enabled(button("clinical-workspace-change-archive", "Cambia collegamento…", theme, false, !self.connecting), !self.connecting)
                    .when(!self.connecting, |el| el.on_click(cx.listener(|this, _, _, cx| this.forget_pairing(cx)))))
                .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                    .child(text!("La frase di accesso non viene salvata su disco. L'abbinamento resta in memoria fino alla chiusura della finestra.")))
        } else {
            panel.child(self.login_actions[1].attach_enabled(button("clinical-workspace-continue-pairing", if self.connecting { "Preparazione in corso…" } else { "Continua con l'accesso" }, theme, true, !self.connecting), !self.connecting)
                .when(!self.connecting, |el| el.on_click(cx.listener(|this, _, _, cx| this.prepare_pairing(cx)))))
                .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                    .child(text!("Il collegamento sarà verificato quando accedi. I dati di abbinamento non vengono salvati su disco.")))
        };
        div()
            .id("clinical-workspace-connect-scroll")
            .track_scroll(&self.login_scroll)
            .flex_1()
            .min_h_0()
            .min_w_0()
            .max_w_full()
            .overflow_y_scroll()
            .p(px(layout.margin))
            .flex()
            .flex_col()
            .items_center()
            .child(panel)
    }

    fn directory_view(&self, layout: Layout, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let patients: Vec<_> = self
            .patients
            .ready()
            .into_iter()
            .flatten()
            .filter(|patient| patient.matches_query(&self.query))
            .collect();
        let count = self.patients.ready().map(|_| patients.len());
        let header = div()
            .flex_shrink_0()
            .p(px(layout.margin))
            .pb(px(16.))
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(heading(
                        "clinical-workspace-patients-heading",
                        "Pazienti",
                        theme,
                    ))
                    .child(
                        button(
                            "clinical-workspace-new-patient",
                            "Nuova scheda",
                            theme,
                            true,
                            self.can_write(FormKind::PatientNew) && self.scope.is_some(),
                        )
                        .when(
                            self.can_write(FormKind::PatientNew) && self.scope.is_some(),
                            |el| el.on_click(cx.listener(|this, _, _, cx| this.new_patient(cx))),
                        ),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .items_center()
                    .child(
                        div()
                            .type_role(theme, TypeRole::Section)
                            .text_color(theme.secondary)
                            .child(text!("AMBULATORIO")),
                    )
                    .children(
                        self.ambulatories
                            .ready()
                            .into_iter()
                            .flatten()
                            .map(|scope| {
                                let id = scope.id.clone();
                                let selected = self.scope.as_deref() == Some(&id);
                                button(
                                    format!("clinical-workspace-ambulatory-{id}"),
                                    scope.name.clone(),
                                    theme,
                                    false,
                                    true,
                                )
                                .aria_selected(selected)
                                .when(selected, |el| {
                                    el.bg(theme.selected).border_color(theme.fresh)
                                })
                                .on_click(
                                    cx.listener(move |this, _, _, cx| this.change_scope(&id, cx)),
                                )
                            }),
                    ),
            )
            .when(self.ambulatories.message().is_some(), |el| {
                el.child(notice(
                    "clinical-workspace-ambulatories-state",
                    self.ambulatories.message().unwrap_or_default().to_owned(),
                    theme,
                    matches!(self.ambulatories, Load::Failed(_)),
                ))
            })
            .child(
                div()
                    .flex()
                    .when(layout.compact, |el| el.flex_col())
                    .gap(px(12.))
                    .child(
                        div().flex().flex_wrap().gap(px(4.)).children(
                            [
                                (false, "clinical-workspace-filter-active", "Attivi"),
                                (true, "clinical-workspace-filter-archive", "Archivio"),
                            ]
                            .into_iter()
                            .map(|(archived, id, title)| {
                                tab(id, title, self.archived == archived, theme).on_click(
                                    cx.listener(move |this, _, _, cx| {
                                        if this.form.is_some() {
                                            return;
                                        }
                                        this.archived = archived;
                                        this.retire_profile_selection();
                                        this.selected_id = None;
                                        this.patient = PatientData::default();
                                        this.core = Workspace::default();
                                        this.load_patients(cx);
                                    }),
                                )
                            }),
                        ),
                    )
                    .child(
                        self.search_target.attach_enabled(
                            div()
                                .id("clinical-workspace-patient-search-anchor")
                                .flex_1()
                                .min_w_0()
                                .child(self.search.clone()),
                            false,
                        ),
                    ),
            )
            .child(
                div()
                    .text_color(theme.secondary)
                    .type_role(theme, TypeRole::Meta)
                    .child(text!(
                        count
                            .map(|n| format!(
                                "{n} {}",
                                if n == 1 { "paziente" } else { "pazienti" }
                            ))
                            .unwrap_or_else(|| "Lettura dell'elenco…".into())
                    )),
            );
        let rows = div()
            .id("clinical-workspace-directory-scroll")
            .accessibility_id("clinical-workspace-directory-scroll")
            .key_context("MediFlowPatientList")
            .role(Role::List)
            .aria_label("Elenco dei pazienti")
            .min_w_0()
            .when(!layout.magnified, |el| {
                el.track_scroll(&self.directory_scroll)
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
            })
            .when(layout.magnified, |el| el.flex_shrink_0())
            .px(px(layout.margin))
            .pb(px(layout.margin))
            .when(self.patients.message().is_some(), |el| {
                el.child(notice(
                    "clinical-workspace-patients-state",
                    self.patients.message().unwrap_or_default().to_owned(),
                    theme,
                    matches!(self.patients, Load::Failed(_)),
                ))
            })
            .when(count == Some(0), |el| {
                el.child(
                    div()
                        .py(px(40.))
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .child(div().type_role(theme, TypeRole::Strong).child(text!(
                            if self.query.trim().is_empty() {
                                "Nessun paziente in questo elenco"
                            } else {
                                "Nessun paziente corrisponde alla ricerca"
                            }
                        )))
                        .child(div().text_color(theme.secondary).child(text!(
                            "Controlla l'ambulatorio, l'archivio o il testo cercato."
                        ))),
                )
            })
            .children(patients.into_iter().map(|patient| {
                let id = patient.id.clone();
                let selected = self.selected_id.as_deref() == Some(&id);
                let label = format!(
                    "{}, nascita {}, {}",
                    patient.display_name(),
                    display_date(patient.birth_date.as_deref()),
                    if patient.is_archived {
                        "archiviato"
                    } else {
                        "attivo"
                    }
                );
                div()
                    .id(SharedString::from(format!(
                        "clinical-workspace-patient-{id}"
                    )))
                    .accessibility_id(SharedString::from(format!(
                        "clinical-workspace-patient-{id}"
                    )))
                    .role(Role::Button)
                    .aria_label(label)
                    .aria_selected(selected)
                    .focusable()
                    .tab_stop(true)
                    .when_some(self.patient_targets.get(&id), |el, target| {
                        target.attach(el)
                    })
                    .min_h(px(layout.row))
                    .px(px(12.))
                    .py(px(12.))
                    .flex()
                    .items_center()
                    .gap(px(16.))
                    .border_b_1()
                    .border_color(theme.rule)
                    .border_l_2()
                    .border_color(if selected { theme.fresh } else { theme.rule })
                    .bg(if selected {
                        theme.selected
                    } else {
                        theme.paper
                    })
                    .cursor_pointer()
                    .focus(move |s| s.border_color(theme.fresh).bg(theme.selected))
                    .hover(move |s| s.bg(theme.hover))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(4.))
                            .child(
                                div()
                                    .type_role(theme, TypeRole::Strong)
                                    .child(text!(patient.display_name())),
                            )
                            .child(
                                div()
                                    .type_role(theme, TypeRole::Meta)
                                    .text_color(theme.secondary)
                                    .child(text!(format!(
                                        "{}{}{}",
                                        display_date(patient.birth_date.as_deref()),
                                        if patient.is_adi { " · ADI" } else { "" },
                                        if patient.is_archived {
                                            " · Archiviato"
                                        } else {
                                            ""
                                        }
                                    ))),
                            ),
                    )
                    .when(layout.wide && self.selected_id.is_none(), |el| {
                        el.child(
                            div()
                                .w(px(200.))
                                .type_role(theme, TypeRole::Code)
                                .child(text!(patient.tax_code.clone())),
                        )
                    })
                    .when(!layout.compact, |el| {
                        el.child(
                            div()
                                .text_color(theme.secondary)
                                .type_role(theme, TypeRole::Meta)
                                .child(text!(display_date(patient.updated_at.as_deref()))),
                        )
                    })
                    .on_click(cx.listener(move |this, event: &gpui::ClickEvent, _, cx| {
                        this.select_patient(&id, !layout.wide || event.is_keyboard(), cx)
                    }))
            }));
        div()
            .id("clinical-workspace-directory-page")
            .flex_1()
            .min_h_0()
            .min_w_0()
            .flex()
            .flex_col()
            .bg(theme.paper)
            .rounded(px(theme.paper_radius))
            .when(!layout.magnified, |el| el.overflow_hidden())
            .when(layout.magnified, |el| {
                el.track_scroll(&self.directory_scroll).overflow_y_scroll()
            })
            .child(header)
            .child(
                div()
                    .when(!layout.magnified, |el| el.flex_1().min_h_0())
                    .when(layout.magnified, |el| el.flex_shrink_0().flex_col())
                    .flex()
                    .child(rows)
                    .when(layout.wide && self.selected_id.is_some(), |el| {
                        el.child(self.preview(cx))
                    }),
            )
    }

    fn preview(&self, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let mut pane = div()
            .id("clinical-workspace-patient-preview")
            .accessibility_id("clinical-workspace-patient-preview")
            .role(Role::Complementary)
            .aria_label("Anteprima del paziente")
            .w(px(304.))
            .flex_shrink_0()
            .border_l_1()
            .border_color(theme.rule)
            .p(px(24.))
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(20.));
        if let Some(patient) = self.patient.detail.ready() {
            pane = pane
                .child(
                    div()
                        .type_role(theme, TypeRole::PersonPreview)
                        .child(text!(patient.display_name())),
                )
                .child(div().text_color(theme.secondary).child(text!(format!(
                    "Nascita {}",
                    display_date(patient.birth_date.as_deref())
                ))))
                .child(
                    div()
                        .type_role(theme, TypeRole::Code)
                        .child(text!(patient.tax_code.clone())),
                )
                .child(
                    div()
                        .border_t_1()
                        .border_color(theme.rule)
                        .pt(px(16.))
                        .type_role(theme, TypeRole::Body)
                        .child(text!("Allergie: dato non disponibile")),
                )
                .child(self.patient_notes(patient, cx))
                .child(
                    button(
                        "clinical-workspace-open-profile",
                        "Apri scheda",
                        theme,
                        true,
                        true,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.directory = false;
                        cx.notify();
                    })),
                );
        } else {
            pane = pane.child(self.patient_read_hint(
                "clinical-workspace-preview-state",
                &self.patient.detail,
                ReadObject::Scheda,
                cx,
            ));
        }
        pane
    }

    fn patient_notes(&self, patient: &PatientDetail, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let (content, unavailable) = if patient.field_locked("notes") {
            (
                "Le note cifrate non sono leggibili con questo accesso.".to_owned(),
                true,
            )
        } else {
            (
                patient
                    .notes
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_owned)
                    .unwrap_or_else(|| "Nessuna nota presente nella scheda.".into()),
                false,
            )
        };
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(section(
                "clinical-workspace-notes-heading",
                "NOTE DELLA SCHEDA",
                theme,
            ))
            .child(
                div()
                    .id("clinical-workspace-notes-content")
                    .type_role(theme, TypeRole::Prose)
                    .text_color(if unavailable {
                        theme.critical
                    } else {
                        theme.ink
                    })
                    .child(if unavailable {
                        self.unreadable_field("clinical-workspace-notes-unreadable", cx)
                            .into_any_element()
                    } else {
                        clinical_text::render(&content, WritingInk::Dry, theme)
                    }),
            )
    }

    fn profile_view(&self, layout: Layout, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let mut pane = div()
            .id("clinical-workspace-profile-page")
            .flex_1()
            .min_h_0()
            .min_w_0()
            .flex()
            .flex_col()
            .bg(theme.paper)
            .rounded(px(theme.paper_radius))
            .when(!layout.magnified, |el| el.overflow_hidden())
            .when(layout.magnified, |el| {
                el.track_scroll(&self.profile_scroll).overflow_y_scroll()
            });
        let Some(patient) = self.patient.detail.ready() else {
            return pane.child(
                div()
                    .p(px(layout.margin))
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .child(
                        button(
                            "clinical-workspace-back-directory",
                            "Pazienti",
                            theme,
                            false,
                            true,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.directory = true;
                            this.load_patients(cx);
                            this.focus_after_render = true;
                            cx.notify();
                        })),
                    )
                    .child(self.patient_read_hint(
                        "clinical-workspace-detail-state",
                        &self.patient.detail,
                        ReadObject::Scheda,
                        cx,
                    )),
            );
        };
        let writable = !patient.is_archived && patient.deleted_at.is_none() && self.form.is_none();
        pane = pane.child(
            div()
                .flex_shrink_0()
                .p(px(layout.margin))
                .pb(px(16.))
                .border_b_1()
                .border_color(theme.rule)
                .flex()
                .flex_col()
                .gap(px(if layout.compact { 8. } else { 12. }))
                .child(
                    div()
                        .flex()
                        .items_start()
                        .when(layout.magnified, |el| el.flex_col())
                        .justify_between()
                        .gap(px(12.))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .gap(px(8.))
                                .child(
                                    heading(
                                        "clinical-workspace-patient-name",
                                        patient.display_name(),
                                        theme,
                                    )
                                    .type_role(
                                        theme,
                                        TypeRole::Person {
                                            compact: layout.compact,
                                        },
                                    ),
                                )
                                .child(
                                    div()
                                        .type_role(theme, TypeRole::Meta)
                                        .text_color(theme.secondary)
                                        .child(text!(format!(
                                            "Nascita {}{}{}",
                                            display_date(patient.birth_date.as_deref()),
                                            if patient.is_adi { " · ADI" } else { "" },
                                            if patient.is_archived {
                                                " · Scheda archiviata"
                                            } else {
                                                ""
                                            }
                                        ))),
                                )
                                .when(!layout.compact, |el| {
                                    el.child(
                                        div()
                                            .type_role(theme, TypeRole::Code)
                                            .child(text!(patient.tax_code.clone())),
                                    )
                                }),
                        )
                        .child(
                            button(
                                "clinical-workspace-back-directory",
                                "Pazienti",
                                theme,
                                false,
                                self.form.is_none(),
                            )
                            .when(self.form.is_none(), |el| {
                                el.on_click(cx.listener(|this, _, _, cx| {
                                    this.directory = true;
                                    this.load_patients(cx);
                                    this.focus_after_render = true;
                                    cx.notify();
                                }))
                            }),
                        ),
                )
                .child(
                    div()
                        .id("clinical-workspace-allergies")
                        .accessibility_id("clinical-workspace-allergies")
                        .role(Role::Note)
                        .aria_label("Allergie: dato non disponibile in questa scheda")
                        .type_role(theme, TypeRole::Meta)
                        .text_color(theme.secondary)
                        .child(text!("Allergie: dato non disponibile in questa scheda")),
                )
                .when(!layout.compact, |el| {
                    el.child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(8.))
                            .child(
                                button(
                                    "clinical-workspace-new-entry",
                                    "Nuova voce",
                                    theme,
                                    true,
                                    writable && self.can_write(FormKind::Entry),
                                )
                                .when(
                                    writable && self.can_write(FormKind::Entry),
                                    |el| {
                                        el.on_click(cx.listener(|this, _, window, cx| {
                                            this.open_form(FormKind::Entry, window, cx)
                                        }))
                                    },
                                ),
                            )
                            .child(
                                button("clinical-workspace-refresh", "Rileggi", theme, false, true)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.request_discard(Discard::Reload, cx)
                                    })),
                            )
                            .child(
                                button(
                                    "clinical-workspace-copy-profile",
                                    "Copia scheda",
                                    theme,
                                    false,
                                    true,
                                )
                                .on_click(cx.listener(|this, _, _, cx| this.copy_profile(cx))),
                            ),
                    )
                }),
        );
        if layout.compact {
            pane = pane.child(
                div()
                    .flex_shrink_0()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .px(px(16.))
                    .py(px(8.))
                    .child(
                        button(
                            "clinical-workspace-select-module",
                            format!("{} ▾", self.patient_section.title()),
                            theme,
                            false,
                            self.form.is_none(),
                        )
                        .track_focus(&self.section_selector_focus)
                        .flex_1()
                        .aria_expanded(self.show_sections)
                        .when(self.form.is_none(), |el| {
                            el.on_click(cx.listener(|this, _, _, cx| {
                                this.show_sections = !this.show_sections;
                                cx.notify();
                            }))
                        }),
                    )
                    .child(
                        button(
                            "clinical-workspace-new-entry",
                            "Nuova voce",
                            theme,
                            true,
                            writable && self.can_write(FormKind::Entry),
                        )
                        .when(
                            writable && self.can_write(FormKind::Entry),
                            |el| {
                                el.on_click(cx.listener(|this, _, window, cx| {
                                    this.open_form(FormKind::Entry, window, cx)
                                }))
                            },
                        ),
                    ),
            );
        }
        if !layout.compact || self.show_sections {
            pane = pane.child(
                div()
                    .id("clinical-workspace-patient-sections")
                    .accessibility_id("clinical-workspace-patient-sections")
                    .role(Role::TabList)
                    .aria_label("Moduli del paziente")
                    .flex()
                    .flex_wrap()
                    .flex_shrink_0()
                    .px(px(if layout.compact { 16. } else { layout.margin }))
                    .bg(theme.shade)
                    .children(PatientSection::ALL.into_iter().map(|patient_section| {
                        tab(
                            patient_section.id(),
                            patient_section.title(),
                            self.patient_section == patient_section,
                            theme,
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.section_selected(patient_section, cx)
                        }))
                    })),
            );
        }
        let mut content = div()
            .id("clinical-workspace-profile-scroll")
            .min_w_0()
            .when(!layout.magnified, |el| {
                el.track_scroll(&self.profile_scroll)
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
            })
            .when(layout.magnified, |el| el.flex_shrink_0())
            .p(px(layout.margin));
        if self.form.is_some() {
            content = content.child(
                div()
                    .flex()
                    .when(!layout.wide, |el| el.flex_col())
                    .gap(px(layout.gap))
                    .when(layout.wide, |el| {
                        el.child(div().flex_1().min_w_0().child(self.overview(patient, cx)))
                    })
                    .child(div().flex_1().min_w_0().child(self.form_view(cx))),
            );
        } else {
            content = match self.patient_section {
                PatientSection::Overview => content.child(
                    div()
                        .flex()
                        .when(!layout.wide, |el| el.flex_col())
                        .gap(px(layout.gap))
                        .child(div().flex_1().min_w_0().child(self.overview(patient, cx)))
                        .child(div().flex_1().min_w_0().child(self.diary_view(cx))),
                ),
                PatientSection::Diary => content.child(self.diary_view(cx)),
                PatientSection::Therapies => content.child(self.therapies_view(cx)),
                PatientSection::Documents => content.child(self.documents_view(cx)),
                PatientSection::Observations => content.child(self.observations_view(cx)),
                PatientSection::Checkups => content.child(self.checkups_view(cx)),
            };
        }
        pane.child(content).child(self.threshold(layout, cx))
    }

    fn overview(&self, patient: &PatientDetail, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let diagnoses = if patient.field_locked("diagnoses") {
            Err(())
        } else {
            diagnosis_labels(patient.diagnoses.as_deref())
        };
        let mut overview = div()
            .flex()
            .flex_col()
            .gap(px(28.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(section(
                        "clinical-workspace-quadro-heading",
                        "QUADRO",
                        theme,
                    ))
                    .child(
                        div()
                            .type_role(theme, TypeRole::Strong)
                            .child(text!("Problemi e contesto")),
                    )
                    .when(diagnoses.is_err(), |el| {
                        el.child(
                            self.unreadable_field("clinical-workspace-diagnoses-unavailable", cx),
                        )
                    })
                    .when(diagnoses.as_ref().is_ok_and(Vec::is_empty), |el| {
                        el.child(
                            div()
                                .text_color(theme.secondary)
                                .child(text!("Nessun problema riportato nella scheda.")),
                        )
                    })
                    .children(diagnoses.unwrap_or_default().into_iter().map(|label| {
                        div()
                            .border_b_1()
                            .border_color(theme.rule)
                            .py(px(12.))
                            .child(text!(label))
                    })),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(section(
                        "clinical-workspace-active-therapies-heading",
                        "TERAPIE ATTIVE",
                        theme,
                    ))
                    .when(
                        self.patient.therapies.state(ReadObject::Terapie).is_some(),
                        |el| {
                            el.child(self.patient_read_hint(
                                "clinical-workspace-therapies-state",
                                &self.patient.therapies,
                                ReadObject::Terapie,
                                cx,
                            ))
                        },
                    )
                    .when(
                        self.patient.therapies.ready().is_some_and(|rows| {
                            !rows
                                .iter()
                                .any(|row| row.status == "active" && row.deleted_at.is_none())
                        }),
                        |el| {
                            el.child(self.empty_read_state(
                                "clinical-workspace-therapies-empty",
                                ReadObject::Terapie,
                                cx,
                            ))
                        },
                    )
                    .children(
                        self.patient
                            .therapies
                            .ready()
                            .into_iter()
                            .flatten()
                            .filter(|row| row.status == "active" && row.deleted_at.is_none())
                            .map(|row| {
                                div()
                                    .border_b_1()
                                    .border_color(theme.rule)
                                    .py(px(12.))
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.))
                                    .child(
                                        div()
                                            .type_role(theme, TypeRole::Strong)
                                            .child(text!(row.drug_name.clone())),
                                    )
                                    .child(
                                        div()
                                            .text_color(theme.secondary)
                                            .child(text!(row.dosage.clone())),
                                    )
                            }),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(section(
                        "clinical-workspace-followup-heading",
                        "PROSSIMI CONTROLLI",
                        theme,
                    ))
                    .child(
                        button(
                            "clinical-workspace-open-checkups",
                            "Tutti i controlli",
                            theme,
                            false,
                            self.form.is_none(),
                        )
                        .when(self.form.is_none(), |el| {
                            el.on_click(cx.listener(|this, _, _, cx| {
                                this.section_selected(PatientSection::Checkups, cx)
                            }))
                        }),
                    )
                    .when(
                        self.patient.checkups.state(ReadObject::Controlli).is_some(),
                        |el| {
                            el.child(self.patient_read_hint(
                                "clinical-workspace-checkups-state",
                                &self.patient.checkups,
                                ReadObject::Controlli,
                                cx,
                            ))
                        },
                    )
                    .when(
                        self.patient.checkups.ready().is_some_and(|rows| {
                            !rows
                                .iter()
                                .any(|row| row.status == "pending" && row.deleted_at.is_none())
                        }),
                        |el| {
                            el.child(self.empty_read_state(
                                "clinical-workspace-checkups-empty",
                                ReadObject::Controlli,
                                cx,
                            ))
                        },
                    )
                    .children(
                        self.patient
                            .checkups
                            .ready()
                            .into_iter()
                            .flatten()
                            .filter(|row| row.status == "pending" && row.deleted_at.is_none())
                            .map(|row| {
                                div()
                                    .border_b_1()
                                    .border_color(theme.rule)
                                    .py(px(12.))
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.))
                                    .child(
                                        div()
                                            .type_role(theme, TypeRole::Meta)
                                            .text_color(theme.secondary)
                                            .child(text!(display_date(Some(&row.date)))),
                                    )
                                    .child(text!(row.title.clone()))
                            }),
                    ),
            )
            .child(self.patient_notes(patient, cx))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        button(
                            "clinical-workspace-edit-notes",
                            "Modifica note",
                            theme,
                            false,
                            self.form.is_none()
                                && !patient.is_archived
                                && patient.deleted_at.is_none()
                                && !patient.field_locked("notes")
                                && self.can_write(FormKind::Notes),
                        )
                        .when(
                            self.form.is_none()
                                && !patient.is_archived
                                && patient.deleted_at.is_none()
                                && !patient.field_locked("notes")
                                && self.can_write(FormKind::Notes),
                            |el| {
                                el.on_click(cx.listener(|this, _, window, cx| {
                                    this.open_form(FormKind::Notes, window, cx)
                                }))
                            },
                        ),
                    )
                    .child(
                        button(
                            "clinical-workspace-edit-profile",
                            "Modifica anagrafica",
                            theme,
                            false,
                            self.form.is_none()
                                && self.can_write(FormKind::PatientProfile)
                                && !patient.is_archived,
                        )
                        .when(
                            self.form.is_none()
                                && self.can_write(FormKind::PatientProfile)
                                && !patient.is_archived,
                            |el| {
                                el.on_click(
                                    cx.listener(|this, _, _, cx| this.edit_patient_profile(cx)),
                                )
                            },
                        ),
                    )
                    .child(
                        button(
                            "clinical-workspace-current-profile",
                            "Altri dati della scheda…",
                            theme,
                            false,
                            true,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            if let Some(path) = this.current_patient_path("edit") {
                                this.open_current(&path, cx);
                            }
                        })),
                    ),
            );
        if !patient.locked_fields.is_empty() {
            overview =
                overview.child(self.unreadable_field("clinical-workspace-locked-fields", cx));
        }
        overview
    }

    fn load_hint<T>(&self, id: &'static str, state: &Load<T>) -> Stateful<Div> {
        notice(
            id,
            state.message().unwrap_or_default().to_owned(),
            self.theme,
            matches!(state, Load::Failed(_)),
        )
    }

    fn diary_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut rows: Vec<_> = self
            .patient
            .entries
            .ready()
            .into_iter()
            .flatten()
            .filter(|entry| entry.deleted_at.is_none())
            .collect();
        rows.sort_by(|a, b| b.date.cmp(&a.date));
        div().min_w_0().max_w_full().flex().flex_col().gap(px(16.))
            .child(div().min_w_0().max_w_full().flex().flex_wrap().items_center().justify_between().gap(px(12.))
                .child(section("clinical-workspace-diary-heading", "DIARIO", theme))
                .child(button("clinical-workspace-current-diary", "Editor corrente…", theme, false, true)
                    .on_click(cx.listener(|this, _, _, cx| {
                        if let Some(path) = this.current_patient_path("modules#diario") { this.open_current(&path, cx); }
                    }))))
            .when(self.patient.entries.state(ReadObject::Diario).is_some(), |el| el.child(self.patient_read_hint("clinical-workspace-entries-state", &self.patient.entries, ReadObject::Diario, cx)))
            .when(self.patient.entries.ready().is_some() && rows.is_empty(), |el| el.child(
                self.empty_read_state("clinical-workspace-entries-empty", ReadObject::Diario, cx)))
            .children(rows.into_iter().map(|entry| {
                let id = entry.id.clone();
                let edit_id = id.clone();
                let editable = self.can_edit_record(editing::Kind::Entry) && entry.locked_fields.is_empty();
                let unavailable = entry.locked_fields.iter().any(|field| field == "title" || field == "content");
                let title = if entry.locked_fields.iter().any(|field| field == "title") { "Titolo non leggibile".into() } else { entry.title.clone() };
                let prose = if entry.locked_fields.iter().any(|field| field == "content") { "Il testo cifrato non è leggibile con questo accesso.".into() } else { plain_text(&entry.content) };
                let clipboard = format!("{} · {}\n{}\n{}", display_date(Some(&entry.date)), entry_type_label(&entry.entry_type), title, prose);
                div().id(SharedString::from(format!("clinical-workspace-entry-{id}"))).debug_selector(|| format!("clinical-workspace-entry-{id}")).role(Role::Article)
                    .aria_label(SharedString::from(format!("{}, {}", title, display_date(Some(&entry.date)))))
                    .border_b_1().border_color(theme.rule).pb(px(24.)).flex().flex_col().gap(px(8.))
                    .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                        .child(text!(format!("{} · {}", display_date(Some(&entry.date)), entry_type_label(&entry.entry_type)))))
                    .child(div().type_role(theme, TypeRole::Strong).child(text!(title)))
                    .child(if entry.locked_fields.iter().any(|field| field == "content") {
                        self.unreadable_field("clinical-workspace-entry-unreadable", cx).into_any_element()
                    } else { clinical_text::render(&entry.content, WritingInk::Dry, theme) })
                    .child(button(format!("clinical-workspace-edit-entry-{id}"), "Modifica voce", theme, false, editable)
                        .when(editable, |el| el.on_click(cx.listener(move |this, _, _, cx| this.edit_record(editing::Kind::Entry, &edit_id, cx)))))
                    .when(!unavailable, |el| el.child(div().flex().child(button(format!("clinical-workspace-copy-entry-{id}"), "Copia voce", theme, false, true)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(clipboard.clone()));
                            this.message = Some(("Voce copiata.".into(), false)); cx.notify();
                        })))))
            }))
            .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                .child(text!("Liste, enfasi e barrature conservano il significato del testo registrato. Per modifiche di formattazione e allegati usa l'editor corrente.")))
    }

    fn therapies_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let writable = self
            .patient
            .detail
            .ready()
            .is_some_and(|patient| !patient.is_archived && patient.deleted_at.is_none())
            && self.can_write(FormKind::Therapy);
        div()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(heading(
                        "clinical-workspace-therapies-heading",
                        "Terapie",
                        theme,
                    ))
                    .child(
                        button(
                            "clinical-workspace-new-therapy",
                            "Nuova terapia",
                            theme,
                            true,
                            writable,
                        )
                        .when(writable, |el| {
                            el.on_click(cx.listener(|this, _, window, cx| {
                                this.open_form(FormKind::Therapy, window, cx)
                            }))
                        }),
                    ),
            )
            .when(
                self.patient.therapies.state(ReadObject::Terapie).is_some(),
                |el| {
                    el.child(self.patient_read_hint(
                        "clinical-workspace-therapies-state",
                        &self.patient.therapies,
                        ReadObject::Terapie,
                        cx,
                    ))
                },
            )
            .when(
                self.patient.therapies.ready().is_some_and(Vec::is_empty),
                |el| {
                    el.child(self.empty_read_state(
                        "clinical-workspace-therapies-empty",
                        ReadObject::Terapie,
                        cx,
                    ))
                },
            )
            .children(
                self.patient
                    .therapies
                    .ready()
                    .into_iter()
                    .flatten()
                    .filter(|row| row.deleted_at.is_none())
                    .map(|row| {
                        let id = row.id.clone();
                        let editable = self.can_edit_record(editing::Kind::Therapy)
                            && row.locked_fields.is_empty();
                        div()
                            .id(SharedString::from(format!(
                                "clinical-workspace-therapy-{}",
                                row.id
                            )))
                            .min_w_0()
                            .max_w_full()
                            .border_b_1()
                            .border_color(theme.rule)
                            .py(px(16.))
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .child(record_header(
                                theme,
                                div()
                                    .type_role(theme, TypeRole::Strong)
                                    .child(text!(row.drug_name.clone())),
                                div()
                                    .type_role(theme, TypeRole::Meta)
                                    .text_color(theme.secondary)
                                    .child(text!(therapy_status(&row.status))),
                            ))
                            .child(
                                button(
                                    format!("clinical-workspace-edit-therapy-{id}"),
                                    "Modifica terapia",
                                    theme,
                                    false,
                                    editable,
                                )
                                .when(editable, |el| {
                                    el.on_click(cx.listener(move |this, _, _, cx| {
                                        this.edit_record(editing::Kind::Therapy, &id, cx)
                                    }))
                                }),
                            )
                            .child(text!(row.dosage.clone()))
                            .child(
                                div()
                                    .type_role(theme, TypeRole::Meta)
                                    .text_color(theme.secondary)
                                    .child(text!(format!(
                                        "Dal {}{}",
                                        display_date(Some(&row.start_date)),
                                        row.end_date
                                            .as_deref()
                                            .map(|date| format!(" al {}", display_date(Some(date))))
                                            .unwrap_or_default()
                                    ))),
                            )
                            .when(
                                row.locked_fields.iter().any(|field| field == "motivation"),
                                |el| {
                                    el.child(self.unreadable_field(
                                        "clinical-workspace-therapy-unreadable",
                                        cx,
                                    ))
                                },
                            )
                            .when(
                                !row.locked_fields.iter().any(|field| field == "motivation")
                                    && row.motivation.is_some(),
                                |el| {
                                    el.child(div().type_role(theme, TypeRole::Prose).child(
                                        clinical_text::render(
                                            row.motivation.as_deref().unwrap_or_default(),
                                            WritingInk::Dry,
                                            theme,
                                        ),
                                    ))
                                },
                            )
                    }),
            )
            .child(self.current_module_button(
                "clinical-workspace-manage-therapies",
                "Gestisci nell'interfaccia corrente…",
                PatientSection::Therapies,
                cx,
            ))
    }

    fn observations_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let writable = self
            .patient
            .detail
            .ready()
            .is_some_and(|patient| !patient.is_archived && patient.deleted_at.is_none())
            && self.can_write(FormKind::Observation);
        let mut rows: Vec<_> = self
            .patient
            .observations
            .ready()
            .into_iter()
            .flatten()
            .filter(|row| row.deleted_at.is_none())
            .collect();
        rows.sort_by(|a, b| b.observed_at.cmp(&a.observed_at));
        div()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(heading(
                        "clinical-workspace-observations-heading",
                        "Parametri",
                        theme,
                    ))
                    .child(
                        button(
                            "clinical-workspace-new-observation",
                            "Nuovo parametro",
                            theme,
                            true,
                            writable,
                        )
                        .when(writable, |el| {
                            el.on_click(cx.listener(|this, _, window, cx| {
                                this.open_form(FormKind::Observation, window, cx)
                            }))
                        }),
                    ),
            )
            .when(
                self.patient
                    .observations
                    .state(ReadObject::Parametri)
                    .is_some(),
                |el| {
                    el.child(self.patient_read_hint(
                        "clinical-workspace-observations-state",
                        &self.patient.observations,
                        ReadObject::Parametri,
                        cx,
                    ))
                },
            )
            .when(
                self.patient.observations.ready().is_some() && rows.is_empty(),
                |el| {
                    el.child(self.empty_read_state(
                        "clinical-workspace-observations-empty",
                        ReadObject::Parametri,
                        cx,
                    ))
                },
            )
            .children(rows.into_iter().map(|row| {
                let id = row.id.clone();
                let editable = self.can_edit_record(editing::Kind::Observation)
                    && row.locked_fields.is_empty();
                div()
                    .id(SharedString::from(format!(
                        "clinical-workspace-observation-{}",
                        row.id
                    )))
                    .min_w_0()
                    .max_w_full()
                    .border_b_1()
                    .border_color(theme.rule)
                    .py(px(16.))
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(record_header(
                        theme,
                        div()
                            .type_role(theme, TypeRole::Strong)
                            .child(text!(row.display.clone())),
                        div()
                            .type_role(theme, TypeRole::Strong)
                            .child(text!(format!("{} {}", row.value, row.unit_code))),
                    ))
                    .child(
                        div()
                            .type_role(theme, TypeRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(display_date(Some(&row.observed_at)))),
                    )
                    .child(
                        div()
                            .type_role(theme, TypeRole::Code)
                            .text_color(theme.secondary)
                            .child(text!(format!("{} {}", row.code_system, row.code))),
                    )
                    .child(
                        button(
                            format!("clinical-workspace-edit-observation-{id}"),
                            "Modifica parametro",
                            theme,
                            false,
                            editable,
                        )
                        .when(editable, |el| {
                            el.on_click(cx.listener(move |this, _, _, cx| {
                                this.edit_record(editing::Kind::Observation, &id, cx)
                            }))
                        }),
                    )
                    .when(
                        row.locked_fields.iter().any(|field| field == "notes"),
                        |el| {
                            el.child(
                                self.unreadable_field(
                                    "clinical-workspace-observation-unreadable",
                                    cx,
                                ),
                            )
                        },
                    )
                    .when(
                        !row.locked_fields.iter().any(|field| field == "notes")
                            && row.notes.is_some(),
                        |el| {
                            el.child(div().type_role(theme, TypeRole::Prose).child(
                                clinical_text::render(
                                    row.notes.as_deref().unwrap_or_default(),
                                    WritingInk::Dry,
                                    theme,
                                ),
                            ))
                        },
                    )
            }))
            .child(self.current_module_button(
                "clinical-workspace-manage-observations",
                "Andamenti e gestione nell'interfaccia corrente…",
                PatientSection::Observations,
                cx,
            ))
    }

    fn documents_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let writable = self.form.is_none()
            && !self.document_busy
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
            .when(self.document_busy, |el| el.child(notice("clinical-workspace-document-operation", "Operazione sul documento in corso…", theme, false)))
            .when(self.patient.attachments.message().is_some(), |el| el.child(self.load_hint("clinical-workspace-attachments-state", &self.patient.attachments)))
            .when(self.patient.attachments.ready().is_some_and(Vec::is_empty), |el| el.child(text!("Nessun documento presente nella scheda.")))
            .children(self.patient.attachments.ready().into_iter().flatten().map(|row| {
                let name = if row.locked_fields.iter().any(|field| field == "name") { "Nome del documento non leggibile".into() } else { row.name.clone() };
                let can_open = !self.document_busy && self.form.is_none();
                let available = can_open && documents::original_readable(row);
                let details_open = self.patient.document_details_id.as_deref() == Some(row.id.as_str());
                let details_id = row.id.clone();
                let id = row.id.clone();
                div().id(SharedString::from(format!("clinical-workspace-document-{id}")))
                    .min_w_0().max_w_full()
                    .border_b_1().border_color(theme.rule).py(px(16.)).flex().flex_col().gap(px(8.))
                    .child(div().min_w_0().max_w_full().type_role(theme, TypeRole::Strong).child(text!(name)))
                    .child(div().min_w_0().max_w_full().type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                        .child(text!(format!("{} · {} · {}", row.mime_type, format_size(row.size), display_date(row.created_at.as_deref())))))
                    .child(div().min_w_0().max_w_full().flex().flex_wrap().gap(px(8.))
                        .child(button(format!("clinical-workspace-document-details-{id}"), if details_open { "Chiudi sintesi e fonte" } else { "Sintesi e fonte" }, theme, false, can_open)
                            .aria_expanded(details_open)
                            .when(can_open, |el| el.on_click(cx.listener(move |this, _, _, cx| this.toggle_document_details(&details_id, cx)))))
                        .child(button(format!("clinical-workspace-download-document-{id}"), "Salva una copia…", theme, false, available)
                            .when(available, |el| el.on_click(cx.listener(move |this, _, _, cx| this.download_document(&id, cx))))))
                    .when(details_open, |el| el.child(self.document_details_view(row)))
            }))
            .child(div().text_color(theme.secondary).child(text!("Ogni caricamento richiede revisione e conferma. Il limite per file è 10 MiB. Le copie vengono salvate soltanto nella destinazione che scegli.")))
            .child(self.current_module_button("clinical-workspace-manage-documents", "Anteprima dell'originale e gestione…", PatientSection::Documents, cx))
    }

    fn current_module_button(
        &self,
        id: &'static str,
        title: &'static str,
        patient_section: PatientSection,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        button(id, title, self.theme, false, true).on_click(cx.listener(move |this, _, _, cx| {
            if let Some(path) =
                this.current_patient_path(&format!("modules#{}", patient_section.anchor()))
            {
                this.open_current(&path, cx);
            }
        }))
    }

    fn can_write(&self, kind: FormKind) -> bool {
        self.session.as_ref().is_some_and(|session| {
            if kind == FormKind::Scale {
                return session.can_record_scale();
            }
            session.can_write(match kind {
                FormKind::Notes => "network.replica.write-patient-profile",
                FormKind::Entry | FormKind::Scale => "network.replica.write-clinical-diary",
                FormKind::Therapy => "network.replica.write-therapies",
                FormKind::Observation => "network.replica.write-observations",
                FormKind::Document => "network.replica.write-documents",
                FormKind::Checkup => "network.replica.write-checkups",
                FormKind::PatientNew => "network.replica.write-patient-lifecycle",
                FormKind::PatientProfile => "network.replica.write-patient-profile",
            })
        })
    }

    fn form_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let Some(form) = &self.form else {
            return div();
        };
        let review = form.state != FormState::Draft;
        div().flex().flex_col().gap(px(20.))
            .child(div().flex().flex_col().gap(px(8.))
                .child(section("clinical-workspace-draft-heading", if review { "RIVEDI PRIMA DI REGISTRARE" } else { "BOZZA NON REGISTRATA" }, theme))
                .child(div().type_role(theme, TypeRole::PageTitle).text_color(theme.fresh).child(text!(form.edit.as_ref().map_or(form.kind.title(), editing::Record::title))))
                .child(div().text_color(theme.secondary).child(text!(match form.kind {
                    FormKind::Notes => "La conferma sostituisce soltanto le note della scheda del paziente indicato.",
                    FormKind::Entry => "Questa voce è una nota di diario. Per una visita strutturata, un contatto remoto o allegati usa l'editor corrente.",
                    FormKind::Scale => "La valutazione utilizza il questionario letto dall'host.",
                    FormKind::Therapy => "Scegli il farmaco dal repertorio oppure riporta una terapia a testo libero. Verifica dose, motivo e date: la scelta della confezione non li modifica.",
                    FormKind::Observation => "Riporta il valore e le codifiche presenti nel referto. Non vengono dedotte unità, intervalli o interpretazioni cliniche.",
                    FormKind::Document => "Il documento scelto verrà aggiunto alla scheda del paziente indicato. Verifica nome, formato e dimensione prima di registrarlo.",
                    FormKind::Checkup if form.edit.is_none() => "Indica la data e l'ora del controllo nel fuso del computer. L'orario è richiesto e non viene scelto automaticamente.",
                    FormKind::Checkup => "Data e ora sono nel fuso del computer. Se non le modifichi, l'orario registrato resta invariato.",
                    FormKind::PatientNew => "La scheda verrà creata nell'ambulatorio selezionato. I campi non compilati resteranno senza un valore riportato.",
                    FormKind::PatientProfile => "La conferma aggiorna soltanto i campi anagrafici che hai modificato. Le note e gli altri dati clinici restano fuori da questa modifica.",
                }))))
            .when_some(form.upload.as_ref(), |el, upload| el.child(div().flex().flex_col().gap(px(12.))
                .child(div().type_role(theme, TypeRole::Strong).child(text!(upload.name.clone())))
                .child(div().type_role(theme, TypeRole::Meta).child(text!(upload.mime_type.clone())))
                .child(text!(format!("{} · copia scelta in memoria", format_size(upload.bytes.len() as u64))))
                .child(div().text_color(theme.secondary).child(text!("Il formato è associato all'estensione del file. La conferma non interpreta il contenuto e non apre il documento.")))))
            .when(form.kind == FormKind::Therapy, |el| el.child(self.therapy_picker_view(cx)))
            .children(form.fields.iter().enumerate()
                .filter(|(index, field)| !(form.kind == FormKind::Therapy && *index == 0 && field.read_only))
                .map(|(index, field)| self.field_view(field, format!("clinical-workspace-form-field-{index}"), cx)))
            .when(form.kind == FormKind::Entry && !review, |el| el.child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                .child(text!("Il testo della nuova nota è semplice. Le voci già presenti conservano il loro formato originale nell'archivio."))))
    }

    fn threshold(&self, layout: Layout, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let mut threshold = div()
            .id("clinical-workspace-save-threshold")
            .accessibility_id("clinical-workspace-save-threshold")
            .role(Role::Region)
            .aria_label("Stato della scrittura")
            .min_w_0()
            .max_w_full()
            .flex_shrink_0()
            .border_t_1()
            .border_color(theme.rule)
            .px(px(layout.margin))
            .py(px(12.))
            .flex()
            .flex_col()
            .gap(px(12.))
            .bg(theme.paper);
        if let Some(action) = self.discard {
            return threshold.bg(theme.draft)
                .child(div().id("clinical-workspace-discard-question").accessibility_id("clinical-workspace-discard-question").role(Role::AlertDialog).aria_label("Scartare la bozza?")
                    .child(text!(if self.form.as_ref().and_then(|form| form.scale.as_ref()).is_some_and(ScaleAssessment::has_attempt) {
                        "Chiudere la bozza? Un invio potrebbe essere già registrato. La chiusura non annulla una voce nel Diario; copia la bozza e verifica il suo identificativo prima di un nuovo inserimento."
                    } else { "Scartare la bozza? Il testo non registrato verrà eliminato da questa finestra." })))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .child(self.form_actions[4].attach(button("clinical-workspace-keep-draft", "Conserva la bozza", theme, true, true))
                        .on_click(cx.listener(|this, _, _, cx| { this.discard = None; cx.notify(); })))
                    .child(self.form_actions[5].attach(button("clinical-workspace-discard-draft", "Scarta e rileggi", theme, false, true))
                        .on_click(cx.listener(move |this, _, _, cx| this.finish_discard(action, cx)))));
        }
        let Some(form) = &self.form else {
            threshold = threshold.child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .when(layout.magnified, |el| el.flex_col().items_stretch())
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .type_role(theme, TypeRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(self.verified.clone().unwrap_or_else(|| {
                                if self
                                    .patient
                                    .detail
                                    .ready()
                                    .is_some_and(|patient| patient.is_archived)
                                {
                                    "Scheda archiviata · sola lettura".into()
                                } else {
                                    "Scheda letta dall'archivio · nessuna bozza aperta".into()
                                }
                            }))),
                    )
                    .when(layout.compact, |el| {
                        el.child(
                            button("clinical-workspace-refresh", "Rileggi", theme, false, true)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.request_discard(Discard::Reload, cx)
                                })),
                        )
                    }),
            );
            return threshold;
        };
        if form
            .scale
            .as_ref()
            .is_some_and(ScaleAssessment::is_preparing)
        {
            return threshold
                .bg(theme.draft)
                .child(
                    div()
                        .id("clinical-scale-preparing")
                        .accessibility_id("clinical-scale-preparing")
                        .role(Role::Status)
                        .child(text!("Preparazione della valutazione nell’archivio…")),
                )
                .child(text!(
                    "Le risposte restano una bozza. Nessuna registrazione è in corso."
                ));
        }
        let review_enabled = form.scale.as_ref().is_none_or(ScaleAssessment::can_prepare);
        let repeated_scale = form
            .scale
            .as_ref()
            .is_some_and(ScaleAssessment::has_attempt);
        let patient_name = if form.kind == FormKind::PatientNew {
            form.fields
                .iter()
                .take(2)
                .map(|field| field.value(cx))
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            self.patient
                .detail
                .ready()
                .map(PatientDetail::display_name)
                .unwrap_or_default()
        };
        match form.state {
            FormState::Draft => threshold.bg(theme.draft).border_color(theme.draft_rule)
                .child(div().flex().flex_wrap().items_center().justify_between().gap(px(12.))
                    .child(div().flex_1().min_w_0().flex().flex_col().gap(px(4.))
                        .child(writing_status("clinical-workspace-writing-status", WritingInk::Fresh, WritingSurface::Plane, theme))
                        .child(div().type_role(theme, TypeRole::Meta).child(text!(format!("{} · {}", patient_name, form.edit.as_ref().map_or(form.kind.title(), editing::Record::title))))))
                    .child(div().flex().flex_wrap().gap(px(8.))
                        .child(self.form_actions[0].attach(button("clinical-workspace-cancel-form", "Scarta…", theme, false, true))
                            .on_click(cx.listener(|this, _, _, cx| this.request_discard(Discard::Form, cx))))
                        .child(self.form_actions[1].attach_enabled(button("clinical-workspace-review-save", if form.kind == FormKind::Scale { "Prepara e rivedi" } else { "Registra 1 elemento" }, theme, true, review_enabled), review_enabled)
                            .when(review_enabled, |el| el.on_click(cx.listener(|this, _, window, cx| this.review_form(window, cx))))))),
            FormState::Review => threshold.bg(theme.threshold).text_color(theme.threshold_text)
                .child(div().type_role(theme, TypeRole::Threshold).child(text!(if repeated_scale { format!("Ripetere l’invio della stessa valutazione per {patient_name}?") } else if form.kind == FormKind::PatientNew { format!("Creare la scheda di {patient_name} nell'ambulatorio selezionato?") } else { format!("Registrare {} nella scheda di {}?", if form.edit.is_some() { "le modifiche" } else { form.kind.noun() }, patient_name) })))
                .child(div().type_role(theme, TypeRole::Meta).child(text!("Controlla il contenuto qui sopra. La registrazione sarà confermata soltanto dopo la rilettura.")))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .child(self.form_actions[2].attach(button("clinical-workspace-cancel-review", if repeated_scale { "Continua la verifica" } else { "Torna alla bozza" }, theme, false, true))
                        .on_click(cx.listener(|this, _, window, cx| this.cancel_review(window, cx))))
                    .child(self.form_actions[3].attach(button("clinical-workspace-confirm-save", "Conferma e registra", theme, true, true))
                        .on_click(cx.listener(|this, _, _, cx| this.confirm_form(cx))))),
            FormState::Saving => threshold.bg(theme.draft)
                .child(div().id("clinical-workspace-saving-status").accessibility_id("clinical-workspace-saving-status").role(Role::Status).aria_label("Registrazione e rilettura in corso")
                    .child(text!(if form.scale.as_ref().is_some_and(ScaleAssessment::is_reading) { "Rilettura della voce e verifica del contesto in corso…" } else { "Registrazione e rilettura in corso…" })))
                .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                    .child(text!("La bozza resta visibile fino alla verifica. Non inviare di nuovo."))),
            FormState::Conflict | FormState::Uncertain | FormState::Rejected => {
                let label = if form.kind == FormKind::Scale && !repeated_scale { "Valutazione da rivedere. Le risposte sono conservate." } else { match form.state {
                    FormState::Conflict => "La scheda è cambiata. La bozza è conservata.",
                    FormState::Rejected => "La registrazione è stata rifiutata. La bozza è conservata.",
                    _ => "Esito da verificare. La bozza è conservata.",
                }};
                threshold.bg(theme.draft).child(div().id("clinical-workspace-save-uncertain").accessibility_id("clinical-workspace-save-uncertain").role(Role::Alert).aria_label(label).child(text!(label)))
                    .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                        .child(text!(if form.kind == FormKind::Scale { "La rilettura non invia la valutazione. Le risposte restano in questa finestra fino alla verifica o alla chiusura esplicita." } else { "Copia il testo se vuoi conservarlo, poi rileggi la scheda prima di una nuova modifica." })))
                    .child(div().flex().flex_wrap().gap(px(8.))
                        .child(self.form_actions[6].attach(button("clinical-workspace-copy-draft", "Copia bozza", theme, false, true))
                            .on_click(cx.listener(|this, _, _, cx| this.copy_draft(cx))))
                        .child(self.form_actions[7].attach(button("clinical-workspace-reconcile", if form.kind == FormKind::Scale { "Rileggi e verifica" } else { "Rileggi scheda…" }, theme, true, true))
                            .on_click(cx.listener(|this, _, _, cx| this.request_discard(Discard::Reload, cx))))
                        .when(form.kind == FormKind::Scale, |el| el.child(self.form_actions[0].attach(button("clinical-scale-close-draft", "Chiudi bozza…", theme, false, true))
                            .on_click(cx.listener(|this, _, _, cx| this.request_discard(Discard::Form, cx)))))
                        .when(form.scale.as_ref().is_some_and(ScaleAssessment::retry_ready), |el| el.child(self.form_actions[1].attach(button("clinical-scale-review-retry", "Rivedi lo stesso invio", theme, false, true))
                            .on_click(cx.listener(|this, _, _, cx| this.review_scale_retry(cx))))))
            }
        }
    }

    fn other_view(&self, layout: Layout, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        div()
            .w_full()
            .min_w_0()
            .max_w_full()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(heading(
                "clinical-workspace-other-heading",
                "Altre aree",
                theme,
            ))
            .children(
                if layout.magnified {
                    Area::ALL.to_vec()
                } else {
                    vec![
                        Area::References,
                        Area::Analytics,
                        Area::Scales,
                        Area::Settings,
                    ]
                }
                .into_iter()
                .map(|area| self.navigation_item(area, false, cx)),
            )
            .child(
                self.menu_targets[7]
                    .attach(button(
                        "clinical-workspace-lock",
                        "Blocca e nascondi i dati",
                        theme,
                        false,
                        true,
                    ))
                    .on_click(
                        cx.listener(|this, _, _, cx| this.request_discard(Discard::Lock, cx)),
                    ),
            )
    }

    fn area_view(&self, layout: Layout, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let mut area = div()
            .id("clinical-workspace-area-scroll")
            .track_scroll(&self.area_scroll)
            .flex_1()
            .min_h_0()
            .min_w_0()
            .max_w_full()
            .overflow_y_scroll()
            .p(px(layout.margin))
            .bg(theme.paper)
            .rounded(px(theme.paper_radius));
        if self.show_other {
            return area.child(self.other_view(layout, cx));
        }
        if matches!(self.area, Area::Agenda | Area::Diary) {
            return area.child(self.global_area_view(cx));
        }
        if self.area == Area::References {
            return area.child(self.references_view(cx));
        }
        if self.area == Area::Settings {
            return area.child(self.settings_view(cx));
        }
        if self.area == Area::Scales {
            return area.child(self.scales_view(cx));
        }
        if self.area == Area::Analytics {
            return area.child(self.analytics_view(cx));
        }
        let (description, button_label) = match self.area {
            Area::Agenda => (
                "L'agenda raccoglie turni e controlli dei pazienti. Il percorso completo è disponibile nell'interfaccia corrente dell'archivio.",
                "Apri l'agenda corrente",
            ),
            Area::Diary => (
                "Il diario generale riunisce le voci dei diversi pazienti. Qui puoi già leggere e scrivere nella scheda del singolo paziente; il diario generale si apre nell'interfaccia corrente.",
                "Apri il diario generale",
            ),
            Area::References => (
                "Cerca farmaci, diagnosi e repertori nell'interfaccia corrente, collegata allo stesso archivio.",
                "Apri i repertori correnti",
            ),
            _ => (
                "Apri il percorso nell'interfaccia corrente.",
                "Apri interfaccia corrente",
            ),
        };
        let selected = self.area;
        area = area.child(div().w_full().min_w_0().max_w(px(720.)).flex().flex_col().gap(px(24.))
            .child(heading("clinical-workspace-area-heading", self.area.title(), theme))
            .child(div().type_role(theme, TypeRole::Strong).child(text!(description)))
            .child(notice("clinical-workspace-area-connection", "Quest'area non è ancora integrata nella finestra nativa. Il pulsante apre la funzione esistente; l'accesso potrebbe essere richiesto di nuovo.", theme, false))
            .child(button("clinical-workspace-open-current-area", button_label, theme, true, true)
                .on_click(cx.listener(move |this, _, _, cx| this.open_current(selected.current_path(), cx)))));
        area
    }

    fn settings_view(&self, cx: &Context<Self>) -> Div {
        if self.ai_preferences.active {
            return self.ai_preferences_view(cx);
        }
        let theme = self.theme;
        let origin = self
            .session
            .as_ref()
            .map(|session| session.base_url().to_owned())
            .unwrap_or_default();
        div().w_full().min_w_0().max_w(px(760.)).flex().flex_col().gap(px(28.))
            .child(heading("clinical-workspace-settings-heading", "Impostazioni", theme))
            .child(div().flex().flex_col().gap(px(12.))
                .child(section("clinical-workspace-appearance-heading", "ASPETTO", theme))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .children([(None, "clinical-workspace-system-theme", "Sistema"), (Some(false), "clinical-workspace-day-theme", "Giorno"), (Some(true), "clinical-workspace-night-theme", "Grafite")]
                        .into_iter().map(|(value, id, label)| tab(id, label, self.dark_override == value, theme)
                            .on_click(cx.listener(move |this, _, _, cx| { this.dark_override = value; cx.notify(); }))))))
            .child(div().flex().flex_col().gap(px(12.))
                .child(section("clinical-workspace-text-scale-heading", "DIMENSIONE DEL TESTO", theme))
                .child(div().text_color(theme.secondary).child(text!("La pagina passa a una sola colonna quando serve più spazio per leggere.")))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .children([(1., "100%"), (1.25, "125%"), (1.5, "150%"), (2., "200%"), (3., "300%"), (4., "400%")].into_iter().map(|(scale, label)| {
                        button(format!("clinical-workspace-text-scale-{}", (scale * 100.) as u32), label, theme, false, true)
                            .aria_selected(self.text_scale == scale).when(self.text_scale == scale, |el| el.bg(theme.selected).border_color(theme.fresh))
                            .on_click(cx.listener(move |this, _, _, cx| { this.text_scale = scale; cx.notify(); }))
                    }))))
            .child(button("clinical-workspace-increased-contrast", if self.increased_contrast { "Contrasto dei filetti: aumentato" } else { "Aumenta il contrasto dei filetti" }, theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| { this.increased_contrast = !this.increased_contrast; cx.notify(); })))
            .child(button("clinical-workspace-ai-preferences-open", "Preferenze funzioni AI…", theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| {
                    this.area_scroll.set_offset(gpui::point(px(0.), px(0.)));
                    this.load_ai_preferences(cx);
                })))
            .child(self.ai_status_view(cx))
            .child(div().border_t_1().border_color(theme.rule).pt(px(24.)).flex().flex_col().gap(px(12.))
                .child(section("clinical-workspace-connection-heading", "ARCHIVIO COLLEGATO", theme))
                .child(text!(origin))
                .child(div().text_color(theme.secondary).child(text!("Le cartelle vengono lette dall'archivio. Il blocco nasconde subito i dati e chiude l'accesso di questa finestra.")))
                .child(button("clinical-workspace-lock", "Blocca e nascondi i dati", theme, false, true)
                    .on_click(cx.listener(|this, _, _, cx| this.request_discard(Discard::Lock, cx)))))
            .child(button("clinical-workspace-current-settings", "Account, dispositivi e archivio…", theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| this.open_current(Area::Settings.current_path(), cx))))
    }
}

impl ClinicalApp {
    fn global_area_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let agenda = self.area == Area::Agenda;
        let selected = self.area;
        div().w_full().min_w_0().max_w_full().flex().flex_col().gap(px(24.))
            .child(div().flex().flex_wrap().items_center().justify_between().gap(px(12.))
                .child(heading("clinical-workspace-global-heading", if agenda { "Agenda" } else { "Diario generale" }, theme))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .child(button("clinical-workspace-global-refresh", "Rileggi", theme, false, true)
                        .on_click(cx.listener(|this, _, _, cx| this.request_discard(Discard::Reload, cx))))
                    .child(button("clinical-workspace-global-current", "Interfaccia corrente…", theme, false, true)
                        .on_click(cx.listener(move |this, _, _, cx| this.open_current(selected.current_path(), cx))))))
            .child(div().flex().flex_wrap().items_center().gap(px(8.))
                .child(div().type_role(theme, TypeRole::Section).text_color(theme.secondary).child(text!("AMBULATORIO")))
                .children(self.ambulatories.ready().into_iter().flatten().map(|scope| {
                    let id = scope.id.clone();
                    button(format!("clinical-workspace-global-ambulatory-{id}"), scope.name.clone(), theme, false, true)
                        .aria_selected(self.scope.as_deref() == Some(&id))
                        .when(self.scope.as_deref() == Some(&id), |el| el.bg(theme.selected).border_color(theme.fresh))
                        .on_click(cx.listener(move |this, _, _, cx| this.change_scope(&id, cx)))
                })))
            .child(div().flex().flex_col().gap(px(12.))
                .child(section("clinical-workspace-date-interval-heading", "INTERVALLO DI LETTURA", theme))
                .child(div().flex().flex_wrap().items_end().gap(px(12.))
                    .when(self.text_scale >= 2.5, |el| el.flex_col().items_stretch())
                    .children(self.global_dates.iter().enumerate().map(|(index, field)| {
                        div().flex_1().min_w(px(180.)).max_w_full()
                            .child(self.field_view(field, format!("clinical-workspace-date-field-{index}"), cx))
                    }))
                    .child(self.global_apply_target.attach_enabled(button("clinical-workspace-apply-dates", "Applica intervallo", theme, false, self.scope.is_some()), self.scope.is_some())
                        .when(self.scope.is_some(), |el| el.on_click(cx.listener(|this, _, _, cx| this.apply_global_interval(cx))))))
                .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                    .child(text!("I giorni estremi sono inclusi, nel fuso orario di questo computer. Lascia vuoto un campo per non fissare quel limite.")))
                .when_some(self.global_date_error.as_ref(), |el, error| el.child(notice("clinical-workspace-date-error", format!("{error} L'intervallo applicato non è cambiato."), theme, true)))
                .child(div().id("clinical-workspace-applied-interval").role(Role::Status)
                    .type_role(theme, TypeRole::Meta).child(text!(self.global_interval.description()))))
            .child(self.global_search_target.attach_enabled(
                div().id("clinical-workspace-global-search-anchor").min_w_0().max_w_full()
                    .child(self.global_search.clone()),
                false,
            ))
            .when(self.global_patients.message().is_some(), |el| el.child(notice("clinical-workspace-global-patient-names",
                if matches!(self.global_patients, Load::Loading) { "Carico i nomi dei pazienti…" } else { "Alcuni nomi non sono disponibili nell'elenco caricato. Puoi rileggere o aprire la singola scheda." }, theme,
                matches!(self.global_patients, Load::Failed(_)))))
            .child(if agenda { self.agenda_view(cx) } else { self.global_diary_view(cx) })
            .child(div().border_t_1().border_color(theme.rule).pt(px(16.)).type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                .child(text!(if agenda { "La lettura comprende al massimo 200 controlli nell'intervallo applicato, dal meno recente. Altri controlli potrebbero non comparire: restringi l'intervallo per cercarli. La ricerca testuale riguarda soltanto i risultati caricati." }
                    else { "La lettura comprende al massimo le 50 voci più recenti nell'intervallo applicato. Le voci eliminate sono escluse. Per cercare voci meno recenti scegli altre date; la ricerca testuale riguarda soltanto i risultati caricati." })))
    }

    fn agenda_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let query = self.global_query.trim().to_lowercase();
        let today = chrono::Local::now().date_naive();
        let rows: Vec<_> = self
            .agenda
            .ready()
            .into_iter()
            .flatten()
            .filter(|row| {
                row.deleted_at.is_none()
                    && (self
                        .global_patient_name(&row.patient_id)
                        .to_lowercase()
                        .contains(&query)
                        || row.title.to_lowercase().contains(&query)
                        || !row.locked_fields.iter().any(|field| field == "notes")
                            && row
                                .notes
                                .as_deref()
                                .unwrap_or_default()
                                .to_lowercase()
                                .contains(&query))
            })
            .collect();
        let mut content = div().flex().flex_col().gap(px(28.));
        if self.agenda.message().is_some() {
            return content.child(self.load_hint("clinical-workspace-agenda-state", &self.agenda));
        }
        if rows.is_empty() {
            return content.child(
                div()
                    .py(px(28.))
                    .type_role(theme, TypeRole::Strong)
                    .child(text!("Nessun controllo tra i risultati caricati.")),
            );
        }
        for group in AgendaGroup::ALL {
            let mut grouped: Vec<_> = rows
                .iter()
                .copied()
                .filter(|row| agenda_group(&row.status, &row.date, today) == group)
                .collect();
            if grouped.is_empty() {
                continue;
            }
            grouped.sort_by(|left, right| left.date.cmp(&right.date));
            let count = grouped.len();
            content = content.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(section(
                        group.id(),
                        format!("{} · {count}", group.title()),
                        theme,
                    ))
                    .when(group == AgendaGroup::Overdue, |el| {
                        el.child(
                            div()
                                .type_role(theme, TypeRole::Meta)
                                .text_color(theme.secondary)
                                .child(text!(
                                    "Data precedente a oggi, senza completamento registrato."
                                )),
                        )
                    })
                    .children(grouped.into_iter().map(|row| {
                        let patient_id = row.patient_id.clone();
                        let name = self.global_patient_name(&patient_id);
                        div()
                            .id(SharedString::from(format!(
                                "clinical-workspace-agenda-checkup-{}",
                                row.id
                            )))
                            .accessibility_id(SharedString::from(format!(
                                "clinical-workspace-agenda-checkup-{}",
                                row.id
                            )))
                            .role(Role::Button)
                            .aria_label(SharedString::from(format!(
                                "Apri scheda di {name}, {}, {}",
                                row.title,
                                display_date(Some(&row.date))
                            )))
                            .focusable()
                            .tab_stop(true)
                            .cursor_pointer()
                            .min_w_0()
                            .max_w_full()
                            .min_h(px(44.))
                            .px(px(12.))
                            .py(px(16.))
                            .border_b_1()
                            .border_color(theme.rule)
                            .border_l_2()
                            .border_color(theme.rule)
                            .hover(move |style| style.bg(theme.hover))
                            .focus(move |style| style.border_color(theme.fresh).bg(theme.selected))
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .child(record_header(
                                theme,
                                div().type_role(theme, TypeRole::Strong).child(text!(name)),
                                div()
                                    .type_role(theme, TypeRole::Meta)
                                    .text_color(theme.secondary)
                                    .child(text!(display_appointment(&row.date))),
                            ))
                            .child(
                                div()
                                    .type_role(theme, TypeRole::Strong)
                                    .child(text!(row.title.clone())),
                            )
                            .child(
                                div()
                                    .type_role(theme, TypeRole::Meta)
                                    .text_color(theme.secondary)
                                    .child(text!(checkup_status(&row.status))),
                            )
                            .when(
                                row.locked_fields.iter().any(|field| field == "notes"),
                                |el| {
                                    el.child(
                                        div()
                                            .text_color(theme.critical)
                                            .child(text!("Note del controllo non leggibili.")),
                                    )
                                },
                            )
                            .when(
                                !row.locked_fields.iter().any(|field| field == "notes")
                                    && row
                                        .notes
                                        .as_ref()
                                        .is_some_and(|notes| !notes.trim().is_empty()),
                                |el| {
                                    el.child(
                                        div()
                                            .type_role(theme, TypeRole::Prose)
                                            .line_clamp(3)
                                            .child(clinical_text::render(
                                                row.notes.as_deref().unwrap_or_default(),
                                                WritingInk::Dry,
                                                theme,
                                            )),
                                    )
                                },
                            )
                            .child(
                                div()
                                    .type_role(theme, TypeRole::Meta)
                                    .text_color(theme.fresh)
                                    .child(text!("Apri scheda")),
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.select_patient(&patient_id, true, cx)
                            }))
                    })),
            );
        }
        content
    }

    fn global_diary_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let query = self.global_query.trim().to_lowercase();
        let rows: Vec<_> = self
            .global_entries
            .ready()
            .into_iter()
            .flatten()
            .filter(|row| {
                row.deleted_at.is_none()
                    && (self
                        .global_patient_name(&row.patient_id)
                        .to_lowercase()
                        .contains(&query)
                        || !row.locked_fields.iter().any(|field| field == "title")
                            && row.title.to_lowercase().contains(&query)
                        || !row.locked_fields.iter().any(|field| field == "content")
                            && clinical_text::searchable_text(&row.content)
                                .to_lowercase()
                                .contains(&query))
            })
            .collect();
        div()
            .flex()
            .flex_col()
            .gap(px(20.))
            .when(self.global_entries.message().is_some(), |el| {
                el.child(self.load_hint(
                    "clinical-workspace-global-entries-state",
                    &self.global_entries,
                ))
            })
            .when(
                self.global_entries.ready().is_some() && rows.is_empty(),
                |el| {
                    el.child(
                        div()
                            .py(px(28.))
                            .type_role(theme, TypeRole::Strong)
                            .child(text!("Nessuna voce tra i risultati caricati.")),
                    )
                },
            )
            .children(rows.into_iter().map(|row| {
                let patient_id = row.patient_id.clone();
                let name = self.global_patient_name(&patient_id);
                let title = if row.locked_fields.iter().any(|field| field == "title") {
                    "Titolo non leggibile".into()
                } else {
                    row.title.clone()
                };
                let content = if row.locked_fields.iter().any(|field| field == "content") {
                    "Testo cifrato non leggibile con questo accesso.".into()
                } else {
                    plain_text(&row.content)
                };
                div()
                    .id(SharedString::from(format!(
                        "clinical-workspace-global-entry-{}",
                        row.id
                    )))
                    .accessibility_id(SharedString::from(format!(
                        "clinical-workspace-global-entry-{}",
                        row.id
                    )))
                    .role(Role::Button)
                    .aria_label(SharedString::from(format!(
                        "Apri diario di {name}: {title}"
                    )))
                    .focusable()
                    .tab_stop(true)
                    .cursor_pointer()
                    .min_w_0()
                    .max_w_full()
                    .px(px(12.))
                    .py(px(16.))
                    .border_b_1()
                    .border_color(theme.rule)
                    .border_l_2()
                    .border_color(theme.rule)
                    .hover(move |style| style.bg(theme.hover))
                    .focus(move |style| style.border_color(theme.fresh).bg(theme.selected))
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(record_header(
                        theme,
                        div().type_role(theme, TypeRole::Strong).child(text!(name)),
                        div()
                            .type_role(theme, TypeRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(format!(
                                "{} · {}",
                                display_appointment(&row.date),
                                entry_type_label(&row.entry_type)
                            ))),
                    ))
                    .child(div().type_role(theme, TypeRole::Strong).child(text!(title)))
                    .child(div().type_role(theme, TypeRole::Prose).child(
                        if row.locked_fields.iter().any(|field| field == "content") {
                            div().child(text!(content)).into_any_element()
                        } else {
                            clinical_text::render(&row.content, WritingInk::Dry, theme)
                        },
                    ))
                    .child(
                        div()
                            .type_role(theme, TypeRole::Meta)
                            .text_color(theme.fresh)
                            .child(text!("Apri diario del paziente")),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.select_patient(&patient_id, true, cx);
                        this.patient_section = PatientSection::Diary;
                    }))
            }))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AgendaGroup {
    Overdue,
    Upcoming,
    Closed,
    Undated,
}
impl AgendaGroup {
    const ALL: [Self; 4] = [Self::Overdue, Self::Upcoming, Self::Closed, Self::Undated];
    fn title(self) -> &'static str {
        match self {
            Self::Overdue => "SCADUTI",
            Self::Upcoming => "OGGI E PROSSIMI",
            Self::Closed => "CONCLUSI O ANNULLATI",
            Self::Undated => "DATA O STATO DA VERIFICARE",
        }
    }
    fn id(self) -> &'static str {
        match self {
            Self::Overdue => "clinical-workspace-agenda-overdue",
            Self::Upcoming => "clinical-workspace-agenda-upcoming",
            Self::Closed => "clinical-workspace-agenda-closed",
            Self::Undated => "clinical-workspace-agenda-undated",
        }
    }
}

fn calendar_interval<T: chrono::TimeZone>(
    from: &str,
    to: &str,
    zone: &T,
) -> Result<DateInterval, String> {
    let day = |value: &str, label: &str| -> Result<Option<chrono::NaiveDate>, String> {
        let value = value.trim();
        if value.is_empty() {
            return Ok(None);
        }
        chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .ok()
            .filter(|day| value.len() == 10 && day.format("%Y-%m-%d").to_string() == value)
            .map(Some)
            .ok_or_else(|| format!("Data {label} non valida. Usa AAAA-MM-GG."))
    };
    let from_day = day(from, "Dal")?;
    let to_day = day(to, "Al")?;
    if let (Some(from), Some(to)) = (from_day, to_day)
        && from > to
    {
        return Err("La data Dal deve precedere o coincidere con la data Al.".into());
    }
    let endpoint = |day: chrono::NaiveDate, end: bool| -> Result<String, String> {
        let time = if end {
            day.and_hms_milli_opt(23, 59, 59, 999)
        } else {
            day.and_hms_milli_opt(0, 0, 0, 0)
        }
        .expect("valid calendar clock");
        let date = zone.from_local_datetime(&time).single().ok_or_else(|| {
            "Il limite del giorno non è univoco nel fuso locale. Scegli un'altra data.".to_owned()
        })?;
        Ok(date
            .with_timezone(&chrono::Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
    };
    Ok(DateInterval {
        from_day: from_day.map(|day| day.to_string()).unwrap_or_default(),
        to_day: to_day.map(|day| day.to_string()).unwrap_or_default(),
        from: from_day.map(|day| endpoint(day, false)).transpose()?,
        to: to_day.map(|day| endpoint(day, true)).transpose()?,
    })
}

fn agenda_group(status: &str, date: &str, today: chrono::NaiveDate) -> AgendaGroup {
    agenda_group_in_zone(status, date, today, &chrono::Local)
}

fn agenda_group_in_zone<T: chrono::TimeZone>(
    status: &str,
    date: &str,
    today: chrono::NaiveDate,
    zone: &T,
) -> AgendaGroup {
    if matches!(status, "completed" | "cancelled") {
        return AgendaGroup::Closed;
    }
    if status != "pending" {
        return AgendaGroup::Undated;
    }
    let day = chrono::DateTime::parse_from_rfc3339(date)
        .map(|date| date.with_timezone(zone).date_naive())
        .or_else(|_| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d"));
    match day {
        Ok(day) if day < today => AgendaGroup::Overdue,
        Ok(_) => AgendaGroup::Upcoming,
        Err(_) => AgendaGroup::Undated,
    }
}

fn display_appointment(date: &str) -> String {
    display_appointment_in_zone(date, &chrono::Local)
}

fn display_appointment_in_zone<T: chrono::TimeZone>(date: &str, zone: &T) -> String {
    chrono::DateTime::parse_from_rfc3339(date)
        .map(|date| {
            date.with_timezone(zone)
                .naive_local()
                .format("%d/%m/%Y · %H:%M")
                .to_string()
        })
        .unwrap_or_else(|_| display_date(Some(date)))
}

fn checkup_status(status: &str) -> &str {
    match status {
        "pending" => "Da completare",
        "completed" => "Completato",
        "cancelled" => "Annullato",
        value => value,
    }
}

/// Each datum can wrap within the record. At high text scaling, related fields
/// use separate full-width lines instead of competing for a narrow flex row.
fn record_header(theme: Theme, leading: Div, trailing: Div) -> Div {
    div()
        .min_w_0()
        .max_w_full()
        .flex()
        .flex_wrap()
        .items_baseline()
        .justify_between()
        .gap(px(12.))
        .when(theme.scale >= 2.5, |el| el.flex_col().items_stretch())
        .child(leading.min_w_0().max_w_full().whitespace_normal())
        .child(trailing.min_w_0().max_w_full().whitespace_normal())
}

impl Render for ClinicalApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if std::mem::take(&mut self.focus_after_render) {
            window.focus(&self.focus, cx);
        }
        if std::mem::take(&mut self.focus_first_field)
            && let Some(form) = &mut self.form
            && !form
                .therapy
                .as_mut()
                .is_some_and(|therapy| therapy.focus_initial(window, cx))
            && let Some(field) = first_text_editor(&form.fields)
        {
            field.editor.update(cx, |input, cx| input.focus(window, cx));
            if let Some(target) = &field.scroll_target {
                target.scroll_to(window, cx);
            }
        }
        self.dark = self.dark_override.unwrap_or_else(|| {
            matches!(
                window.appearance(),
                WindowAppearance::Dark | WindowAppearance::VibrantDark
            )
        });
        self.theme = Theme::for_dark(self.dark).sized(self.text_scale, self.increased_contrast);
        let theme = self.theme;
        if self.ai_preferences.active {
            self.ai_preferences.prepare_render(window, cx);
        }
        self.prepare_read_state_focus(window, cx);
        self.scales.prepare_render(theme, window, cx);
        self.analytics.prepare_render(theme, cx);
        for field in &self.login_fields {
            field
                .editor
                .update(cx, |input, cx| input.configure(theme, self.connecting, cx));
        }
        self.search
            .update(cx, |input, cx| input.configure(theme, false, cx));
        self.global_search
            .update(cx, |input, cx| input.configure(theme, false, cx));
        for field in &self.global_dates {
            field
                .editor
                .update(cx, |input, cx| input.configure(theme, false, cx));
        }
        self.reference_search
            .update(cx, |input, cx| input.configure(theme, false, cx));
        if let Some(form) = &mut self.form {
            if let Some(scale) = &mut form.scale {
                scale.prepare_render(window, cx);
            }
            if let Some(therapy) = &mut form.therapy {
                therapy.prepare_render(
                    theme,
                    form.state == FormState::Draft && self.discard.is_none(),
                    window,
                    cx,
                );
            }
            for field in &form.fields {
                field.editor.update(cx, |input, cx| {
                    input.configure(
                        theme,
                        form.state != FormState::Draft
                            || form.scale.as_ref().is_some_and(ScaleAssessment::is_working)
                            || self.discard.is_some()
                            || field.read_only
                            || field.rich_source.is_some()
                            || !field.choices.is_empty(),
                        cx,
                    );
                    input.set_writing_ink(WritingInk::Fresh, cx);
                });
            }
        }
        let layout = Layout::for_window(f32::from(window.viewport_size().width), self.text_scale);
        let connected = self.session.is_some();
        self.sync_patient_targets(cx);
        if std::mem::take(&mut self.focus_search_after_render)
            && connected
            && self.form.is_none()
            && !self.show_other
        {
            // Scheduled from render: the following prepaint records the new
            // anchor before ScrollAnchor's next-frame callback reads its origin.
            match self.area {
                Area::References => {
                    self.reference_search
                        .update(cx, |input, cx| input.focus_and_select(window, cx));
                    self.reference_search_target.scroll_to(window, cx);
                }
                Area::Agenda | Area::Diary => {
                    self.global_search
                        .update(cx, |input, cx| input.focus_and_select(window, cx));
                    self.global_search_target.scroll_to(window, cx);
                }
                Area::Patients if self.directory => {
                    self.search
                        .update(cx, |input, cx| input.focus_and_select(window, cx));
                    if layout.magnified {
                        self.search_target.scroll_to(window, cx);
                    }
                }
                _ => {}
            }
        }
        let content = if !connected {
            self.login_view(layout, cx).into_any_element()
        } else if self
            .form
            .as_ref()
            .is_some_and(|form| form.kind == FormKind::PatientNew)
        {
            self.patient_creation_view(layout, cx).into_any_element()
        } else if self
            .form
            .as_ref()
            .is_some_and(|form| form.kind == FormKind::Scale)
        {
            self.scale_workspace_view(layout, cx).into_any_element()
        } else if self.area == Area::Patients && !self.show_other {
            if self.directory {
                self.directory_view(layout, cx).into_any_element()
            } else {
                self.profile_view(layout, cx).into_any_element()
            }
        } else {
            self.area_view(layout, cx).into_any_element()
        };
        div()
            .id("clinical-workspace-gpui")
            .accessibility_id("clinical-workspace-gpui")
            .role(Role::Application)
            .aria_label("MediFlow, spazio di lavoro clinico")
            .track_focus(&self.focus)
            .key_context(if self.worklist_shortcuts_available() {
                "MediFlowConnected MediFlowWorklist"
            } else {
                "MediFlowConnected"
            })
            .on_action(cx.listener(|this, _: &NextFocus, window, cx| {
                window.focus_next(cx);
                this.reveal_focused(window, cx);
            }))
            .on_action(cx.listener(|this, _: &PreviousFocus, window, cx| {
                window.focus_prev(cx);
                this.reveal_focused(window, cx);
            }))
            .on_action(cx.listener(|this, _: &Search, _, cx| {
                if this.session.is_some() && this.form.is_none() {
                    this.show_other = false;
                    this.show_sections = false;
                    match this.area {
                        Area::References | Area::Agenda | Area::Diary => {}
                        _ => {
                            if this.area != Area::Patients {
                                this.navigate(Area::Patients, cx);
                            }
                            this.directory = true;
                        }
                    }
                    this.focus_after_render = false;
                    this.focus_search_after_render = true;
                    cx.notify();
                }
            }))
            .on_action(cx.listener(|this, _: &SearchView, _, cx| this.search_view(cx)))
            .on_action(
                cx.listener(|this, _: &NextPatient, window, cx| {
                    this.move_patient(false, window, cx)
                }),
            )
            .on_action(cx.listener(|this, _: &PreviousPatient, window, cx| {
                this.move_patient(true, window, cx)
            }))
            .on_action(
                cx.listener(|this, _: &NewEntry, window, cx| this.new_entry_shortcut(window, cx)),
            )
            .on_action(cx.listener(|this, _: &Review, window, cx| this.review_form(window, cx)))
            .on_action(cx.listener(|this, _: &Escape, window, cx| {
                if this.discard.take().is_some() {
                    cx.notify();
                } else if this.cancel_ai_preview(cx) {
                } else if this.close_drug_search(cx) {
                    this.focus_after_render = true;
                    this.focus_first_field = true;
                    cx.notify();
                } else if this
                    .form
                    .as_ref()
                    .is_some_and(|form| form.state == FormState::Review)
                {
                    this.cancel_review(window, cx);
                } else if this.show_other || this.show_sections {
                    this.show_other = false;
                    this.show_sections = false;
                    cx.notify();
                }
            }))
            .on_action(cx.listener(|this, _: &Refresh, _, cx| {
                if this.session.is_some() {
                    this.request_discard(Discard::Reload, cx);
                }
            }))
            .on_action(cx.listener(|this, _: &Lock, _, cx| this.request_discard(Discard::Lock, cx)))
            .size_full()
            .flex()
            .flex_col()
            .bg(theme.shade)
            .text_color(theme.ink)
            .type_role(theme, TypeRole::Body)
            .when(connected && layout.magnified, |el| {
                el.child(
                    div()
                        .flex_shrink_0()
                        .min_w_0()
                        .px(px(12.))
                        .py(px(8.))
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(brand_icon(self.dark, 28.))
                        .child(
                            button(
                                "clinical-workspace-magnified-menu",
                                "Menu",
                                theme,
                                false,
                                self.form.is_none(),
                            )
                            .flex_1()
                            .aria_expanded(self.show_other)
                            .when(self.form.is_none(), |el| {
                                el.on_click(cx.listener(|this, _, _, cx| {
                                    this.show_other = !this.show_other;
                                    this.focus_after_render = true;
                                    cx.notify();
                                }))
                            }),
                        )
                        .child(
                            button("clinical-workspace-magnified-lock", "", theme, false, true)
                                .aria_label("Blocca e nascondi i dati")
                                .child(icon(Icon::Lock, theme.ink, 24.))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.request_discard(Discard::Lock, cx)
                                })),
                        ),
                )
            })
            .when(connected && layout.compact && !layout.magnified, |el| {
                el.child(
                    div()
                        .flex_shrink_0()
                        .px(px(16.))
                        .py(px(8.))
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(12.))
                        .child(self.brand(true))
                        .child(
                            button(
                                "clinical-workspace-compact-lock",
                                "Blocca",
                                theme,
                                false,
                                true,
                            )
                            .on_click(
                                cx.listener(|this, _, _, cx| {
                                    this.request_discard(Discard::Lock, cx)
                                }),
                            ),
                        ),
                )
            })
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .flex()
                    .when(connected && !layout.compact, |el| {
                        el.child(self.sidebar(layout, cx))
                    })
                    .child(
                        div()
                            .flex_1()
                            .min_h_0()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .when(connected, |el| {
                                el.p(px(if layout.compact { 0. } else { 12. })).gap(px(12.))
                            })
                            .when(
                                connected
                                    && self.message.is_some()
                                    && !(layout.magnified
                                        && self
                                            .form
                                            .as_ref()
                                            .is_some_and(|form| form.kind == FormKind::Scale)),
                                |el| {
                                    let (message, error) = self.message.clone().unwrap_or_default();
                                    el.child(
                                        notice("clinical-workspace-message", message, theme, error)
                                            .flex_shrink_0(),
                                    )
                                },
                            )
                            .child(content),
                    ),
            )
            .when(connected && layout.compact && !layout.magnified, |el| {
                el.child(self.bottom_navigation(cx))
            })
    }
}

fn validate_form_values(form: &Form, values: &[String]) -> Result<(), String> {
    match form.kind {
        FormKind::PatientNew => patient_forms::create_draft(values).map(|_| ()),
        FormKind::PatientProfile => patient_forms::profile_patch(
            form.patient_original
                .as_ref()
                .ok_or_else(|| "Rileggi la scheda prima di modificarne l'anagrafica.".to_owned())?,
            values,
        )
        .map(|_| ()),
        FormKind::Document if form.upload.is_none() => {
            Err("Scegli il documento da aggiungere.".into())
        }
        _ => form.edit.as_ref().map_or_else(
            || {
                if form.kind == FormKind::Therapy {
                    new_therapy_draft(values, form.selected_drug()).map(|_| ())
                } else {
                    validate_form(form.kind, values)
                }
            },
            |record| record.draft(values, form.selected_drug()).map(|_| ()),
        ),
    }
}

impl ClinicalApp {
    fn install_patient(&mut self, row: PatientDetail) {
        self.core = Workspace::default();
        if let Ok(request) = self.core.select(&row.id) {
            self.core.receive_read(&request, Ok(profile_for_core(&row)));
        }
        self.selected_id = Some(row.id.clone());
        self.patient = PatientData::default();
        self.patient.detail = ReadLoad::Ready(row);
        self.patient_section = PatientSection::Overview;
        self.area = Area::Patients;
        self.directory = false;
        self.show_other = false;
        self.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
    }

    fn new_patient(&mut self, cx: &mut Context<Self>) {
        if self.form.is_some()
            || self.edit_pending
            || self.document_busy
            || self.scope.is_none()
            || !self.can_write(FormKind::PatientNew)
        {
            return;
        }
        self.next_epoch();
        self.retire_profile_selection();
        self.selected_id = None;
        self.patient = PatientData::default();
        self.core = Workspace::default();
        if let (Some(session), Some(scope)) = (&self.session, &self.scope)
            && let Err(error) = session.begin_profile_creation(scope)
        {
            self.message = Some((ui_error(error), true));
            cx.notify();
            return;
        }
        self.area = Area::Patients;
        self.stage_fields(FormKind::PatientNew, patient_forms::fields(None), None, cx);
    }

    fn edit_patient_profile(&mut self, cx: &mut Context<Self>) {
        if self.form.is_some()
            || self.edit_pending
            || self.document_busy
            || !self.can_write(FormKind::PatientProfile)
            || !self
                .patient
                .detail
                .ready()
                .is_some_and(|row| !row.is_archived && row.deleted_at.is_none())
        {
            return;
        }
        let (Some(session), Some(scope), Some(id)) = (
            self.session.clone(),
            self.scope.clone(),
            self.selected_id.clone(),
        ) else {
            return;
        };
        self.edit_pending = true;
        self.message = Some((
            "Rilettura della scheda prima di modificare l'anagrafica…".into(),
            false,
        ));
        let intent = self.profile_intent(&session);
        self.run(move || session.read_patient_profile(&scope, &id, &intent), |this, result, cx| {
            this.edit_pending = false;
            match result {
                Ok(row) if this.form.is_none() && this.selected_id.as_deref() == Some(&row.id) && !row.is_archived && row.deleted_at.is_none() => {
                    this.patient.detail = ReadLoad::Ready(row.clone());
                    this.stage_fields(FormKind::PatientProfile, patient_forms::fields(Some(&row)), None, cx);
                    if let Some(form) = &mut this.form { form.patient_original = Some(row); }
                }
                Ok(_) => this.message = Some(("La scheda o il contesto sono cambiati. Rileggi prima di modificare l'anagrafica.".into(), true)),
                Err(error) => this.message = Some((ui_error(error), true)),
            }
        }, cx);
        cx.notify();
    }

    fn patient_creation_view(&self, layout: Layout, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let scope = self
            .ambulatories
            .ready()
            .into_iter()
            .flatten()
            .find(|row| self.scope.as_deref() == Some(&row.id))
            .map(|row| row.name.clone())
            .unwrap_or_else(|| "Ambulatorio non disponibile".into());
        div()
            .id("clinical-workspace-new-patient-page")
            .min_w_0()
            .min_h_0()
            .flex_1()
            .flex()
            .flex_col()
            .bg(theme.paper)
            .rounded(px(theme.paper_radius))
            .when(layout.magnified, |el| {
                el.track_scroll(&self.profile_scroll).overflow_y_scroll()
            })
            .when(!layout.magnified, |el| el.overflow_hidden())
            .child(
                div()
                    .flex_shrink_0()
                    .p(px(layout.margin))
                    .border_b_1()
                    .border_color(theme.rule)
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(heading(
                        "clinical-workspace-new-patient-heading",
                        "Nuova scheda",
                        theme,
                    ))
                    .child(
                        div()
                            .text_color(theme.secondary)
                            .child(text!(format!("Ambulatorio: {scope}"))),
                    ),
            )
            .child(
                div()
                    .id("clinical-workspace-new-patient-scroll")
                    .min_w_0()
                    .p(px(layout.margin))
                    .when(!layout.magnified, |el| {
                        el.track_scroll(&self.profile_scroll)
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                    })
                    .when(layout.magnified, |el| el.flex_shrink_0())
                    .child(div().max_w(px(760.)).child(self.form_view(cx))),
            )
            .child(self.threshold(layout, cx))
    }
}

fn form_kind(kind: editing::Kind) -> FormKind {
    match kind {
        editing::Kind::Entry => FormKind::Entry,
        editing::Kind::Therapy => FormKind::Therapy,
        editing::Kind::Observation => FormKind::Observation,
        editing::Kind::Checkup => FormKind::Checkup,
    }
}

impl ClinicalApp {
    fn can_edit_record(&self, kind: editing::Kind) -> bool {
        self.form.is_none()
            && !self.edit_pending
            && !self.document_busy
            && self.can_write(form_kind(kind))
            && self
                .patient
                .detail
                .ready()
                .is_some_and(|patient| !patient.is_archived && patient.deleted_at.is_none())
    }

    fn stage_fields(
        &mut self,
        kind: FormKind,
        specifications: Vec<editing::FieldSpec>,
        edit: Option<editing::Record>,
        cx: &mut Context<Self>,
    ) {
        let fields: Vec<_> = specifications
            .into_iter()
            .enumerate()
            .map(|(index, spec)| {
                let mut field = Field::new(
                    spec.id,
                    spec.label,
                    &spec.value,
                    spec.multiline,
                    false,
                    self.theme,
                    cx,
                )
                .with_scroll(&self.profile_scroll, cx);
                if kind == FormKind::Therapy && index == 0 {
                    field.read_only = spec.rich;
                } else {
                    field.rich_source = spec.rich.then_some(spec.value);
                }
                field.choices = spec.choices;
                field
            })
            .collect();
        let subscriptions = fields
            .iter()
            .map(|field| {
                cx.subscribe(&field.editor, |this, _, _: &InputChanged, cx| {
                    this.verified = None;
                    cx.notify();
                })
            })
            .collect();
        self.form = Some(Form {
            kind,
            fields,
            upload: None,
            edit,
            patient_original: None,
            created_id: None,
            therapy: (kind == FormKind::Therapy)
                .then(|| TherapySelection::new(&self.profile_scroll, cx)),
            scale: None,
            state: FormState::Draft,
            _subscriptions: subscriptions,
        });
        self.show_sections = false;
        self.directory = false;
        self.show_other = false;
        self.message = None;
        self.verified = None;
        self.focus_after_render = true;
        self.focus_first_field = true;
        self.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
        cx.notify();
    }

    fn edit_record(&mut self, kind: editing::Kind, record_id: &str, cx: &mut Context<Self>) {
        if !self.can_edit_record(kind) {
            return;
        }
        let (Some(session), Some(scope), Some(patient_id)) = (
            self.session.clone(),
            self.scope.clone(),
            self.selected_id.clone(),
        ) else {
            return;
        };
        let id = record_id.to_owned();
        self.edit_pending = true;
        self.message = Some((
            "Rilettura dell'elemento prima della modifica…".into(),
            false,
        ));
        self.run(move || match kind {
            editing::Kind::Entry => session.read_entry(&scope, &patient_id, &id).map(editing::Record::Entry),
            editing::Kind::Therapy => session.read_therapy(&scope, &patient_id, &id).map(editing::Record::Therapy),
            editing::Kind::Observation => session.read_observation(&scope, &patient_id, &id).map(editing::Record::Observation),
            editing::Kind::Checkup => session.read_checkup(&scope, &patient_id, &id).map(editing::Record::Checkup),
        }, |this, result, cx| {
            this.edit_pending = false;
            match result {
                Ok(record) if record.readable() && this.form.is_none() && this.selected_id.as_deref() == Some(record.patient_id()) => {
                    let kind = form_kind(record.kind());
                    this.patient_section = match kind { FormKind::Entry => PatientSection::Diary, FormKind::Therapy => PatientSection::Therapies, FormKind::Observation => PatientSection::Observations, FormKind::Checkup => PatientSection::Checkups, _ => PatientSection::Overview };
                    this.stage_fields(kind, record.fields(), Some(record), cx);
                }
                Ok(_) => this.message = Some(("L'elemento non è interamente leggibile oppure il contesto è cambiato. Nessuna bozza è stata aperta.".into(), true)),
                Err(error) => this.message = Some((ui_error(error), true)),
            }
        }, cx);
        cx.notify();
    }

    fn checkups_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let writable = self.can_edit_record(editing::Kind::Checkup);
        let mut rows: Vec<_> = self
            .patient
            .checkups
            .ready()
            .into_iter()
            .flatten()
            .filter(|row| row.deleted_at.is_none())
            .collect();
        rows.sort_by(|left, right| right.date.cmp(&left.date));
        div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(heading(
                        "clinical-workspace-checkups-heading",
                        "Controlli",
                        theme,
                    ))
                    .child(
                        button(
                            "clinical-workspace-new-checkup",
                            "Nuovo controllo",
                            theme,
                            true,
                            writable,
                        )
                        .when(writable, |el| {
                            el.on_click(cx.listener(|this, _, window, cx| {
                                this.open_form(FormKind::Checkup, window, cx)
                            }))
                        }),
                    ),
            )
            .when(
                self.patient.checkups.state(ReadObject::Controlli).is_some(),
                |el| {
                    el.child(self.patient_read_hint(
                        "clinical-workspace-checkups-state",
                        &self.patient.checkups,
                        ReadObject::Controlli,
                        cx,
                    ))
                },
            )
            .when(
                self.patient.checkups.ready().is_some() && rows.is_empty(),
                |el| {
                    el.child(self.empty_read_state(
                        "clinical-workspace-checkups-empty",
                        ReadObject::Controlli,
                        cx,
                    ))
                },
            )
            .children(rows.into_iter().map(|row| {
                let id = row.id.clone();
                let available = writable && row.locked_fields.is_empty();
                div()
                    .id(SharedString::from(format!(
                        "clinical-workspace-checkup-{id}"
                    )))
                    .border_b_1()
                    .border_color(theme.rule)
                    .py(px(16.))
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(
                        div()
                            .type_role(theme, TypeRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(format!(
                                "{} · {}",
                                display_appointment(&row.date),
                                checkup_status(&row.status)
                            ))),
                    )
                    .child(div().type_role(theme, TypeRole::Strong).child(text!(
                        if row.locked_fields.iter().any(|field| field == "title") {
                            "Titolo non leggibile".to_owned()
                        } else {
                            row.title.clone()
                        }
                    )))
                    .when(
                        row.locked_fields.iter().any(|field| field == "notes"),
                        |el| {
                            el.child(
                                self.unreadable_field("clinical-workspace-checkup-unreadable", cx),
                            )
                        },
                    )
                    .when(
                        !row.locked_fields.iter().any(|field| field == "notes")
                            && row.notes.is_some(),
                        |el| {
                            el.child(clinical_text::render(
                                row.notes.as_deref().unwrap_or_default(),
                                WritingInk::Dry,
                                theme,
                            ))
                        },
                    )
                    .child(
                        button(
                            format!("clinical-workspace-edit-checkup-{id}"),
                            "Modifica controllo",
                            theme,
                            false,
                            available,
                        )
                        .when(available, |el| {
                            el.on_click(cx.listener(move |this, _, _, cx| {
                                this.edit_record(editing::Kind::Checkup, &id, cx)
                            }))
                        }),
                    )
            }))
    }
}

impl ClinicalApp {
    fn pick_document(&mut self, cx: &mut Context<Self>) {
        if self.document_busy
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
        self.document_busy = true;
        self.message = None;
        let epoch = self.epoch;
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Scegli documento".into()),
        });
        cx.spawn(async move |this, cx| {
            let result = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if this.epoch != epoch || this.session.is_none() { return; }
                match result {
                    Ok(Ok(Some(paths))) if paths.len() == 1 => {
                        let path = paths.into_iter().next().expect("one selected path");
                        this.run(move || Ok(documents::read_selected_file(&path)), |this, result, _| {
                            this.document_busy = false;
                            match result {
                                Ok(Ok(upload)) if this.form.is_none() && this.can_write(FormKind::Document) => {
                                    this.form = Some(Form { kind: FormKind::Document, fields: vec![], upload: Some(upload), edit: None, patient_original: None, created_id: None, therapy: None, scale: None, state: FormState::Draft, _subscriptions: vec![] });
                                    this.show_sections = false;
                                    this.patient_section = PatientSection::Documents;
                                    this.directory = false;
                                    this.verified = None;
                                    this.focus_after_render = true;
                                    this.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
                                }
                                Ok(Ok(_)) => this.message = Some(("È già aperta una bozza o l'accesso è cambiato. Il file non è stato aggiunto.".into(), false)),
                                Ok(Err(error)) => this.message = Some((error.to_string(), true)),
                                Err(error) => this.message = Some((ui_error(error), true)),
                            }
                        }, cx);
                    }
                    Ok(Ok(None)) => this.document_busy = false,
                    _ => {
                        this.document_busy = false;
                        this.message = Some(("Il selettore di file non è disponibile. Puoi riprovare o usare Documenti nell'interfaccia corrente.".into(), true));
                    }
                }
                cx.notify();
            });
        }).detach();
        cx.notify();
    }

    fn download_document(&mut self, document_id: &str, cx: &mut Context<Self>) {
        if self.document_busy || self.form.is_some() {
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
        self.document_busy = true;
        self.message = Some(("Scegli dove salvare la copia del documento.".into(), false));
        cx.spawn(async move |this, cx| {
            let result = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if this.epoch != epoch || this.session.is_none() { return; }
                match result {
                    Ok(Ok(Some(path))) => {
                        let (Some(session), Some(scope), Some(patient_id)) = (this.session.clone(), this.scope.clone(), this.selected_id.clone()) else { return; };
                        this.message = Some(("Lettura, verifica e salvataggio della copia…".into(), false));
                        this.run(move || {
                            if session.is_locked() { return Err(RuntimeError::Locked); }
                            let attachment = session.read_attachment(&scope, &patient_id, &id)?;
                            let bytes = match documents::decode_attachment(&attachment) {
                                Ok(bytes) => bytes,
                                Err(error) => return Ok(Err(error)),
                            };
                            if session.is_locked() { return Err(RuntimeError::Locked); }
                            Ok(documents::write_download(&path, &bytes))
                        }, |this, result, _| {
                            this.document_busy = false;
                            this.message = Some(match result {
                                Ok(Ok(())) => ("Copia salvata nella destinazione scelta. Il documento non è stato aperto.".into(), false),
                                Ok(Err(error)) => (error.to_string(), true),
                                Err(error) => (ui_error(error), true),
                            });
                        }, cx);
                    }
                    Ok(Ok(None)) => { this.document_busy = false; this.message = None; }
                    _ => {
                        this.document_busy = false;
                        this.message = Some(("La scelta della destinazione non è disponibile. Nessuna copia è stata creata.".into(), true));
                    }
                }
                cx.notify();
            });
        }).detach();
        cx.notify();
    }
}

impl ClinicalApp {
    fn load_references(&mut self, cx: &mut Context<Self>) {
        let (Some(session), Some(scope)) = (self.session.clone(), self.scope.clone()) else {
            return;
        };
        self.next_epoch();
        if self.reference_kind == ReferenceKind::Who {
            // Opening/navigating never submits a WHO query or probes a service.
            self.reference_rows = Load::Idle;
            cx.notify();
            return;
        }
        self.reference_query = self.reference_search.read(cx).value().trim().to_owned();
        self.reference_rows = Load::Loading;
        let kind = self.reference_kind;
        let query = self.reference_query.clone();
        if !matches!(self.drug_count, Load::Ready(_)) {
            self.drug_count = Load::Loading;
            let s = session.clone();
            let a = scope.clone();
            self.run(
                move || s.drug_count(&a),
                |this, result, _| this.drug_count = Load::from_result(result),
                cx,
            );
        }
        if !matches!(self.exemption_count, Load::Ready(_)) {
            self.exemption_count = Load::Loading;
            let s = session.clone();
            let a = scope.clone();
            self.run(
                move || s.exemption_count(&a),
                |this, result, _| this.exemption_count = Load::from_result(result),
                cx,
            );
        }
        if !matches!(self.reference_registry, Load::Ready(_)) {
            self.reference_registry = Load::Loading;
            let s = session.clone();
            let a = scope.clone();
            self.run(
                move || s.terminology_systems(&a),
                |this, result, _| this.reference_registry = Load::from_result(result),
                cx,
            );
        }
        self.run(
            move || match kind {
                ReferenceKind::Drugs => session
                    .search_drugs(&scope, &query, kind.limit())
                    .map(ReferenceRows::Drugs),
                ReferenceKind::Exemptions => session
                    .search_exemptions(&scope, &query, kind.limit())
                    .map(ReferenceRows::Exemptions),
                _ => session
                    .search_terminology(
                        &scope,
                        kind.system().ok_or(RuntimeError::InvalidInput)?,
                        &query,
                        kind.limit(),
                    )
                    .map(ReferenceRows::Terminology),
            },
            |this, result, _| this.reference_rows = Load::from_result(result),
            cx,
        );
        cx.notify();
    }

    fn references_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let total = match self.reference_kind {
            ReferenceKind::Drugs => self.drug_count.ready(),
            ReferenceKind::Exemptions => self.exemption_count.ready(),
            _ => None,
        };
        let system = self.reference_kind.system();
        let provenance = system.and_then(|system| {
            self.reference_registry
                .ready()?
                .iter()
                .find(|row| row.system == system)
        });
        let mut pane = div().min_w_0().flex().flex_col().gap(px(20.))
            .child(div().flex().flex_wrap().items_center().justify_between().gap(px(12.))
                .child(heading("clinical-workspace-references-heading", "Repertori", theme))
                .child(button("clinical-workspace-references-refresh", "Rileggi", theme, false, true)
                    .on_click(cx.listener(|this, _, _, cx| this.request_discard(Discard::Reload, cx)))))
            .child(div().text_color(theme.secondary).child(text!("Riferimenti del tuo archivio. La ricerca e la copia non modificano le schede dei pazienti.")))
            .child(div().id("clinical-workspace-reference-tabs").role(Role::TabList).aria_label("Repertori disponibili")
                .flex().flex_wrap().gap(px(4.)).children(ReferenceKind::ALL.into_iter().map(|kind| {
                    tab(kind.id(), kind.title(), self.reference_kind == kind, theme)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.reference_kind = kind;
                            this.load_references(cx);
                        }))
                })))
            .when(self.ambulatories.message().is_some(), |el| el.child(self.load_hint("clinical-workspace-reference-ambulatories-state", &self.ambulatories)))
            .child(div().flex().flex_wrap().gap(px(8.)).items_center()
                .child(div().type_role(theme, TypeRole::Section).text_color(theme.secondary).child(text!("AMBULATORIO")))
                .children(self.ambulatories.ready().into_iter().flatten().map(|scope| {
                    let id = scope.id.clone();
                    button(format!("clinical-workspace-reference-scope-{id}"), scope.name.clone(), theme, false, true)
                        .aria_selected(self.scope.as_deref() == Some(&id))
                        .when(self.scope.as_deref() == Some(&id), |el| el.bg(theme.selected).border_color(theme.fresh))
                        .on_click(cx.listener(move |this, _, _, cx| this.change_scope(&id, cx)))
                })));
        if self.reference_kind == ReferenceKind::Who {
            return pane.child(self.who_view(cx));
        }
        pane = pane.child(div().min_w_0().flex().flex_wrap().gap(px(8.))
                .when(self.text_scale >= 2.5, |el| el.flex_col().items_stretch())
                .child(self.reference_search_target.attach_enabled(
                    div().id("clinical-workspace-reference-search-anchor").flex_1().min_w(px(160.)).max_w_full()
                        .child(self.reference_search.clone()), false))
                .child(self.reference_run_target.attach_enabled(button("clinical-workspace-reference-run-search", "Cerca", theme, true, self.scope.is_some()), self.scope.is_some())
                    .when(self.scope.is_some(), |el| el.on_click(cx.listener(|this, _, _, cx| this.load_references(cx))))))
            .when_some(total, |el, total| el.child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                .child(text!(format!("{total} riferimenti nel repertorio completo dell'archivio.")))))
            .when_some(provenance, |el, provenance| {
                el.child(div().flex().flex_col().gap(px(4.)).type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                    .child(text!(format!("{} · {}", provenance.display, provenance.source)))
                    .when_some(provenance.version.as_ref(), |el, version| el.child(text!(format!("Versione: {version}"))))
                    .when_some(provenance.updated_at.as_ref(), |el, date| el.child(text!(format!("Aggiornamento riportato: {}", display_date(Some(date))))))
                    .when(provenance.status == TerminologyRegistryStatus::Planned, |el| el.child(text!("Il registro indica questo sistema come pianificato. La disponibilità dei risultati dipende dall'archivio.")))
                    .when_some(provenance.notes.as_ref(), |el, notes| el.child(text!(notes.clone()))))
            });
        if let Some(message) = self.reference_rows.message() {
            pane = pane.child(notice(
                "clinical-workspace-reference-state",
                message.to_owned(),
                theme,
                matches!(self.reference_rows, Load::Failed(_)),
            ));
        }
        if let Some(rows) = self.reference_rows.ready() {
            let query = if self.reference_query.is_empty() {
                "prima pagina del repertorio".to_owned()
            } else {
                format!("ricerca «{}»", self.reference_query)
            };
            pane = pane
                .child(
                    div()
                        .type_role(theme, TypeRole::Meta)
                        .text_color(theme.secondary)
                        .child(text!(format!("{} risultati · {query}", rows.len()))),
                )
                .when(rows.len() == 0, |el| {
                    el.child(div().py(px(12.)).child(text!(
                        "Nessun risultato per questa ricerca nel repertorio collegato."
                    )))
                })
                .child(rows.render(theme));
        }
        pane.child(div().border_t_1().border_color(theme.rule).pt(px(16.)).flex().flex_col().gap(px(12.))
            .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary).child(text!(format!("Ogni ricerca mostra al massimo {} risultati. Affina nome o codice per trovare altri riferimenti; il limite non prova che il repertorio sia completo.", self.reference_kind.limit()))))
            .child(button("clinical-workspace-reference-other-systems", "Catalogo ICD-11 incorporato e altri repertori…", theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| this.open_current(Area::References.current_path(), cx))))
            .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary).child(text!("Gli altri sistemi usano il loro percorso nell'interfaccia corrente."))))
    }
}

fn profile_for_core(patient: &PatientDetail) -> PatientProfile {
    PatientProfile {
        id: patient.id.clone(),
        first_name: patient.first_name.clone(),
        last_name: patient.last_name.clone(),
        birth_date: patient.birth_date.clone(),
        tax_code: patient.tax_code.clone(),
        notes: patient.notes.clone(),
        version: patient.version,
        is_archived: patient.is_archived,
    }
}

fn client_message(error: mediflow_patient_client::ClientError) -> &'static str {
    use mediflow_patient_client::ClientError;
    match error {
        ClientError::UnsavedChanges => "Completa o scarta la bozza prima di cambiare scheda.",
        ClientError::NoChanges => "Nessuna modifica da registrare.",
        ClientError::InvalidInput => {
            "Il testo supera il limite o contiene caratteri non accettati. La bozza precedente è conservata."
        }
        ClientError::WrongPhase => {
            "Completa o annulla il passaggio corrente prima di modificare le note."
        }
        ClientError::VersionExhausted | ClientError::RequestExhausted => {
            "Questa scheda non può ricevere altre modifiche da questa finestra. Copia la bozza e riapri la scheda."
        }
    }
}

fn path_segment(value: &str) -> String {
    use std::fmt::Write;
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            write!(encoded, "%{byte:02X}").expect("writing to a String");
        }
    }
    encoded
}

fn diagnosis_labels(value: Option<&str>) -> Result<Vec<String>, ()> {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return Ok(vec![]);
    };
    let parsed: serde_json::Value = serde_json::from_str(value).map_err(|_| ())?;
    let rows = parsed.as_array().ok_or(())?;
    rows.iter()
        .map(|row| {
            if let Some(text) = row.as_str() {
                return Ok(text.to_owned());
            }
            let object = row.as_object().ok_or(())?;
            let code = object
                .get("code")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .trim();
            let label = object
                .get("description")
                .or_else(|| object.get("name"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .trim();
            match (code.is_empty(), label.is_empty()) {
                (false, false) => Ok(format!("{code} · {label}")),
                (true, false) => Ok(label.into()),
                (false, true) => Ok(code.into()),
                (true, true) => Err(()),
            }
        })
        .collect()
}

fn entry_type_label(kind: &str) -> &str {
    match kind {
        "note" => "Nota",
        "visit" => "Visita",
        "remote" => "Contatto remoto",
        value => value,
    }
}

fn therapy_status(status: &str) -> &str {
    match status {
        "active" => "Attiva",
        "suspended" => "Sospesa",
        "completed" => "Conclusa",
        "stopped" => "Interrotta",
        value => value,
    }
}

fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{} KB", bytes.div_ceil(1024))
    } else {
        format!("{:.1} MB", bytes as f64 / (1024. * 1024.))
    }
}

fn date_for_write(value: &str) -> Result<String, String> {
    let value = value.trim();
    let date = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "Inserisci una data valida nel formato AAAA-MM-GG.".to_owned())?;
    if value.len() != 10 || date.format("%Y-%m-%d").to_string() != value {
        return Err("Inserisci la data completa nel formato AAAA-MM-GG.".into());
    }
    // Preserve the existing UTC calendar representation for date-only records.
    // Checkups use appointment_for_write with an explicitly supplied local time.
    Ok(format!("{value}T00:00:00.000Z"))
}

fn validate_form(kind: FormKind, values: &[String]) -> Result<(), String> {
    validate_form_in_zone(kind, values, &chrono::Local)
}

fn validate_form_in_zone<T: chrono::TimeZone>(
    kind: FormKind,
    values: &[String],
    zone: &T,
) -> Result<(), String> {
    let count = match kind {
        FormKind::Notes => 1,
        FormKind::Entry => 3,
        FormKind::Therapy => 4,
        FormKind::Observation => 5,
        FormKind::Document => 0,
        FormKind::Checkup => 4,
        FormKind::PatientNew | FormKind::PatientProfile | FormKind::Scale => {
            return Err("Usa il modulo anagrafico dedicato.".into());
        }
    };
    if values.len() != count {
        return Err("Il modulo non è completo. Riaprilo dalla scheda.".into());
    }
    if values.iter().any(|value| {
        value.contains('\0')
            || value.encode_utf16().count() > mediflow_patient_client::MAX_NOTES_UTF16
    }) {
        return Err("Un campo contiene troppo testo o un carattere non accettato.".into());
    }
    if matches!(kind, FormKind::Notes | FormKind::Document) {
        return Ok(());
    }
    let required: &[usize] = match kind {
        FormKind::Entry => &[0, 1, 2],
        FormKind::Checkup => &[0, 1, 2],
        FormKind::Therapy => &[0, 1, 2],
        FormKind::Observation => &[0, 1, 2, 3, 4],
        _ => &[],
    };
    if required.iter().any(|&index| {
        if kind == FormKind::Observation {
            editing::contract_trim(&values[index]).is_empty()
        } else {
            values[index].trim().is_empty()
        }
    }) {
        return Err("Completa i campi richiesti prima di rivedere la scrittura.".into());
    }
    if kind == FormKind::Checkup {
        appointment_for_write(&values[1], &values[2], zone)?;
        return Ok(());
    }
    let date_index = match kind {
        FormKind::Entry => 1,
        FormKind::Therapy => 2,
        FormKind::Observation => 4,
        FormKind::Notes
        | FormKind::Document
        | FormKind::Checkup
        | FormKind::PatientNew
        | FormKind::PatientProfile
        | FormKind::Scale => {
            unreachable!()
        }
    };
    date_for_write(&values[date_index])?;
    Ok(())
}

fn new_checkup_draft<T: chrono::TimeZone>(
    values: &[String],
    zone: &T,
) -> Result<CheckupDraft, RuntimeError> {
    validate_form_in_zone(FormKind::Checkup, values, zone)
        .map_err(|_| RuntimeError::InvalidInput)?;
    Ok(CheckupDraft {
        title: values[0].trim().to_owned(),
        date: appointment_for_write(&values[1], &values[2], zone)
            .map_err(|_| RuntimeError::InvalidInput)?,
        status: "pending".into(),
        notes: (!values[3].is_empty()).then(|| values[3].clone()),
        source: Some("manual".into()),
    })
}

fn new_observation_draft(values: &[String]) -> Result<ObservationDraft, RuntimeError> {
    validate_form(FormKind::Observation, values).map_err(|_| RuntimeError::InvalidInput)?;
    Ok(ObservationDraft {
        code_system: "LOINC".into(),
        code: editing::contract_trim(&values[1]).into(),
        display: editing::contract_trim(&values[0]).into(),
        unit_system: "UCUM".into(),
        unit_code: editing::contract_trim(&values[3]).into(),
        value: editing::contract_trim(&values[2]).into(),
        observed_at: date_for_write(&values[4]).map_err(|_| RuntimeError::InvalidInput)?,
        source: Some("manual".into()),
        ..Default::default()
    })
}

fn new_therapy_draft(
    values: &[String],
    selected_drug: Option<&DrugCatalogItem>,
) -> Result<TherapyDraft, String> {
    validate_form(FormKind::Therapy, values)?;
    let mut draft = TherapyDraft {
        drug_name: if selected_drug.is_some() {
            values[0].clone()
        } else {
            values[0].trim().into()
        },
        dosage: values[1].clone(),
        status: "active".into(),
        start_date: date_for_write(&values[2])?,
        motivation: (!values[3].trim().is_empty()).then(|| values[3].clone()),
        ..Default::default()
    };
    if let Some(drug) = selected_drug {
        editing::apply_drug_choice(&mut draft, drug)?;
    }
    Ok(draft)
}

fn after_create_read<T>(
    result: Result<T, RuntimeError>,
    matches: impl FnOnce(T) -> bool,
) -> Result<bool, RuntimeError> {
    match result {
        Ok(row) => Ok(matches(row)),
        Err(error) if error.is_auth_failure() => Err(error),
        // Creation was acknowledged. A later read failure must never return the
        // form to an editable/resendable state: the record may already exist.
        Err(_) => Ok(false),
    }
}

fn save_new_record(
    session: &RuntimeSession,
    scope: &str,
    patient_id: &str,
    kind: FormKind,
    values: &[String],
    selected_drug: Option<&DrugCatalogItem>,
) -> Result<bool, RuntimeError> {
    validate_form(kind, values).map_err(|_| RuntimeError::InvalidInput)?;
    match kind {
        FormKind::Entry => {
            let draft = EntryDraft {
                entry_type: "note".into(),
                title: values[0].trim().into(),
                date: date_for_write(&values[1]).map_err(|_| RuntimeError::InvalidInput)?,
                content: values[2].clone(),
                setting: Some("ambulatory".into()),
            };
            let created = session.create_entry(scope, patient_id, &draft)?;
            after_create_read(session.read_entry(scope, patient_id, &created.id), |row| {
                row.id == created.id
                    && row.patient_id == patient_id
                    && row.deleted_at.is_none()
                    && row.locked_fields.is_empty()
                    && row.title == draft.title
                    && row.content == draft.content
                    && row.entry_type == draft.entry_type
                    && row.setting == draft.setting
                    && row.date == draft.date
                    && created.version.is_none_or(|version| row.version == version)
            })
        }
        FormKind::Therapy => {
            let draft =
                new_therapy_draft(values, selected_drug).map_err(|_| RuntimeError::InvalidInput)?;
            let created = session.create_therapy(scope, patient_id, &draft)?;
            after_create_read(
                session.read_therapy(scope, patient_id, &created.id),
                |row| {
                    row.id == created.id
                        && row.patient_id == patient_id
                        && row.deleted_at.is_none()
                        && row.locked_fields.is_empty()
                        && editing::therapy_matches(&row, &draft)
                        && created.version.is_none_or(|version| row.version == version)
                },
            )
        }
        FormKind::Observation => {
            let draft = new_observation_draft(values)?;
            let created = session.create_observation(scope, patient_id, &draft)?;
            after_create_read(
                session.read_observation(scope, patient_id, &created.id),
                |row| {
                    row.id == created.id
                        && row.patient_id == patient_id
                        && row.deleted_at.is_none()
                        && row.locked_fields.is_empty()
                        && row.code_system == draft.code_system
                        && row.code == draft.code
                        && row.display == draft.display
                        && row.unit_system == draft.unit_system
                        && row.unit_code == draft.unit_code
                        && row.value == draft.value
                        && row.observed_at == draft.observed_at
                        && row.source == draft.source
                        && created.version.is_none_or(|version| row.version == version)
                },
            )
        }
        FormKind::Checkup => {
            let draft = new_checkup_draft(values, &chrono::Local)?;
            let created = session.create_checkup(scope, patient_id, &draft)?;
            after_create_read(
                session.read_checkup(scope, patient_id, &created.id),
                |row| {
                    row.id == created.id
                        && row.patient_id == patient_id
                        && row.deleted_at.is_none()
                        && row.locked_fields.is_empty()
                        && row.title == draft.title
                        && row.date == draft.date
                        && row.status == draft.status
                        && row.notes == draft.notes
                        && row.source == draft.source
                        && created.version.is_none_or(|version| row.version == version)
                },
            )
        }
        FormKind::Notes
        | FormKind::Document
        | FormKind::PatientNew
        | FormKind::PatientProfile
        | FormKind::Scale => Err(RuntimeError::InvalidInput),
    }
}

fn ui_error(error: impl std::fmt::Display) -> String {
    error
        .to_string()
        .replace("Il runtime", "Il servizio dell'archivio")
        .replace("il runtime", "la scheda")
        .replace(
            "una passphrase v3",
            "una frase di accesso nel formato corrente",
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::Focusable;

    fn bindings_for_key(key: &str, contexts: &[&str]) -> Vec<KeyBinding> {
        let contexts: Vec<_> = contexts
            .iter()
            .map(|context| gpui::KeyContext::parse(context).unwrap())
            .collect();
        let (bindings, pending) = gpui::Keymap::new(key_bindings())
            .bindings_for_input(&[gpui::Keystroke::parse(key).unwrap()], &contexts);
        assert!(!pending, "single key {key} must not wait for a chord");
        bindings.into_iter().collect()
    }

    fn assert_key_action<A: gpui::Action>(key: &str, contexts: &[&str]) {
        let bindings = bindings_for_key(key, contexts);
        assert_eq!(bindings.len(), 1, "{key} in {contexts:?}");
        assert!(
            bindings[0].action().as_any().is::<A>(),
            "wrong action for {key} in {contexts:?}"
        );
    }

    fn secondary_modifier() -> &'static str {
        if cfg!(target_os = "macos") {
            "cmd"
        } else {
            "ctrl"
        }
    }

    #[test]
    fn worklist_keymap_keeps_characters_and_arrows_in_every_text_input() {
        let worklist = "MediFlowConnected MediFlowWorklist";
        assert_key_action::<SearchView>("/", &["MediFlowConnected"]);
        assert_key_action::<NextPatient>("j", &[worklist]);
        assert_key_action::<PreviousPatient>("k", &[worklist]);
        assert_key_action::<NextPatient>("down", &[worklist, "MediFlowPatientList"]);
        assert_key_action::<PreviousPatient>("up", &[worklist, "MediFlowPatientList"]);

        // Check the actual GPUI predicate engine, including an input context
        // between the root and a nested list context, not just the leaf node.
        let contexts: &[&[&str]] = &[
            &["MediFlowConnected", "MediFlowTextInput"],
            &[worklist, "MediFlowTextInput"],
            &[worklist, "MediFlowPatientList", "MediFlowTextInput"],
            &[worklist, "MediFlowTextInput", "MediFlowPatientList"],
            &["MediFlowConnected MediFlowWorklist MediFlowPatientList MediFlowTextInput"],
        ];
        for context in contexts {
            for key in [
                "/",
                "j",
                "k",
                "down",
                "up",
                &format!("{}-n", secondary_modifier()),
            ] {
                assert!(
                    bindings_for_key(key, context).is_empty(),
                    "{key} in {context:?}"
                );
            }
        }
    }

    #[test]
    fn worklist_keymap_does_not_capture_other_views_or_modified_characters() {
        for context in [&[][..], &["MediFlowConnected"][..], &["OtherView"][..]] {
            for key in ["j", "k", "down", "up"] {
                assert!(
                    bindings_for_key(key, context).is_empty(),
                    "{key} in {context:?}"
                );
            }
        }
        let worklist = "MediFlowConnected MediFlowWorklist";
        for key in ["down", "up"] {
            assert!(bindings_for_key(key, &[worklist]).is_empty());
        }
        for key in [
            "shift-j", "shift-k", "ctrl-j", "alt-j", "alt-k", "alt-/", "ctrl-/", "enter", "space",
        ] {
            assert!(
                bindings_for_key(key, &[worklist, "MediFlowPatientList"]).is_empty(),
                "{key}"
            );
        }
        assert!(bindings_for_key("/", &["OtherView"]).is_empty());
    }

    #[test]
    fn new_entry_is_a_separate_action_and_lock_stays_available_inside_inputs() {
        let modifier = secondary_modifier();
        let connected = "MediFlowConnected MediFlowWorklist";
        assert_key_action::<NewEntry>(&format!("{modifier}-n"), &[connected]);
        assert!(
            bindings_for_key(&format!("{modifier}-n"), &[connected, "MediFlowTextInput"])
                .is_empty()
        );
        for contexts in [&[connected][..], &[connected, "MediFlowTextInput"][..]] {
            assert_key_action::<Lock>(&format!("{modifier}-l"), contexts);
            assert_key_action::<Lock>(&format!("{modifier}-shift-l"), contexts);
            assert_key_action::<Review>(&format!("{modifier}-enter"), contexts);
        }
    }

    #[test]
    fn calendar_intervals_include_whole_local_days_and_preserve_unbounded_ends() {
        let east = chrono::FixedOffset::east_opt(2 * 3600).unwrap();
        let interval = calendar_interval("2026-10-17", "2026-10-17", &east).unwrap();
        assert_eq!(interval.from.as_deref(), Some("2026-10-16T22:00:00.000Z"));
        assert_eq!(interval.to.as_deref(), Some("2026-10-17T21:59:59.999Z"));
        assert_eq!(interval.from_day, "2026-10-17");
        assert_eq!(
            calendar_interval("", "", &east),
            Ok(DateInterval::default())
        );
        let west = chrono::FixedOffset::west_opt(5 * 3600).unwrap();
        let older = calendar_interval("", "2026-10-17", &west).unwrap();
        assert!(older.from.is_none());
        assert_eq!(older.to.as_deref(), Some("2026-10-18T04:59:59.999Z"));
    }

    #[test]
    fn calendar_intervals_reject_invalid_or_reversed_dates_before_a_read() {
        for (from, to) in [
            ("2026-02-29", ""),
            ("2026-1-01", ""),
            ("2026-10-18", "2026-10-17"),
            ("", "2026-10-17T00:00:00Z"),
        ] {
            assert!(calendar_interval(from, to, &chrono::Utc).is_err());
        }
        assert!(calendar_interval("2024-02-29", "2024-02-29", &chrono::Utc).is_ok());
    }

    #[test]
    fn agenda_groups_use_recorded_status_and_calendar_date_without_inventing_a_due_date() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 17).unwrap();
        assert_eq!(
            agenda_group("pending", "2026-10-16", today),
            AgendaGroup::Overdue
        );
        assert_eq!(
            agenda_group("pending", "2026-10-17", today),
            AgendaGroup::Upcoming
        );
        assert_eq!(
            agenda_group("pending", "2026-10-18", today),
            AgendaGroup::Upcoming
        );
        assert_eq!(
            agenda_group("completed", "2026-10-16", today),
            AgendaGroup::Closed
        );
        assert_eq!(
            agenda_group("cancelled", "2026-10-18", today),
            AgendaGroup::Closed
        );
        assert_eq!(
            agenda_group("pending", "not-a-date", today),
            AgendaGroup::Undated
        );
        assert_eq!(
            agenda_group("unknown", "2026-10-16", today),
            AgendaGroup::Undated
        );
    }

    #[test]
    fn acknowledged_creation_never_becomes_resendable_when_reread_fails() {
        for error in [
            RuntimeError::Transport,
            RuntimeError::Missing,
            RuntimeError::InvalidResponse,
            RuntimeError::Conflict,
            RuntimeError::Forbidden,
        ] {
            assert_eq!(after_create_read::<()>(Err(error), |_| true), Ok(false));
        }
        assert_eq!(
            after_create_read::<()>(Err(RuntimeError::Locked), |_| true),
            Err(RuntimeError::Locked)
        );
        assert_eq!(
            after_create_read(Ok("different"), |value| value == "submitted"),
            Ok(false)
        );
    }

    #[test]
    fn clinical_dates_reject_invalid_days_without_normalizing_into_another_month() {
        assert_eq!(
            date_for_write("2024-02-29"),
            Ok("2024-02-29T00:00:00.000Z".into())
        );
        for invalid in [
            "2025-02-29",
            "2026-02-31",
            "17/10/2026",
            "2026-10-17T12:30:00Z",
            "2026-1-1",
        ] {
            assert!(date_for_write(invalid).is_err());
        }
    }

    #[test]
    fn new_checkups_keep_the_chosen_local_day_time_and_agenda_membership() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 18).unwrap();
        for zone in [chrono_tz::America::New_York, chrono_tz::Europe::Rome] {
            let interval = calendar_interval("2026-10-18", "2026-10-18", &zone).unwrap();
            let from =
                chrono::DateTime::parse_from_rfc3339(interval.from.as_ref().unwrap()).unwrap();
            let to = chrono::DateTime::parse_from_rfc3339(interval.to.as_ref().unwrap()).unwrap();
            for time in ["00:00", "09:30", "23:59"] {
                let values = ["Controllo sintetico", "2026-10-18", time, "Note sintetiche"]
                    .map(String::from);
                let draft = new_checkup_draft(&values, &zone).unwrap();
                assert_eq!(draft.notes.as_deref(), Some("Note sintetiche"));
                let instant = chrono::DateTime::parse_from_rfc3339(&draft.date).unwrap();
                assert!(instant >= from && instant <= to, "{zone}: {}", draft.date);
                assert_eq!(
                    display_appointment_in_zone(&draft.date, &zone),
                    format!("18/10/2026 · {time}"),
                    "{zone}"
                );
                assert_eq!(
                    agenda_group_in_zone("pending", &draft.date, today, &zone),
                    AgendaGroup::Upcoming,
                    "{zone}"
                );
                assert_eq!(
                    agenda_group_in_zone("pending", &draft.date, today.succ_opt().unwrap(), &zone),
                    AgendaGroup::Overdue,
                    "{zone}"
                );
            }
        }
        assert_eq!(
            appointment_for_write("2026-10-18", "09:30", &chrono_tz::America::New_York).unwrap(),
            "2026-10-18T13:30:00.000Z"
        );
        assert_eq!(
            appointment_for_write("2026-10-18", "09:30", &chrono_tz::Europe::Rome).unwrap(),
            "2026-10-18T07:30:00.000Z"
        );
    }

    #[test]
    fn new_checkups_require_an_explicit_valid_unambiguous_local_time_before_review_or_write() {
        for (zone, day, time) in [
            (chrono_tz::America::New_York, "2026-03-08", "02:30"),
            (chrono_tz::America::New_York, "2026-11-01", "01:30"),
            (chrono_tz::Europe::Rome, "2026-03-29", "02:30"),
            (chrono_tz::Europe::Rome, "2026-10-25", "02:30"),
            (chrono_tz::Europe::Rome, "2026-02-29", "09:30"),
            (chrono_tz::Europe::Rome, "2026-10-18", ""),
            (chrono_tz::Europe::Rome, "2026-10-18", "9:30"),
            (chrono_tz::Europe::Rome, "2026-10-18", "24:00"),
            (chrono_tz::Europe::Rome, "2026-10-18", "09:60"),
            (chrono_tz::Europe::Rome, "2026-10-18", "09:30Z"),
            (chrono_tz::Europe::Rome, "2026-10-18", "09:30:60"),
            (chrono_tz::Europe::Rome, "2026-10-18", "09:30:00.1"),
            (chrono_tz::Europe::Rome, "2026-10-18", "09:30:00.125"),
            (chrono_tz::Europe::Rome, "2026-10-18", "09:30:00.1234"),
            (chrono_tz::Europe::Rome, "2026-10-18", "09:30:00.123456789"),
            (chrono_tz::Europe::Rome, "2026-10-18", "09:30:00.1234567890"),
        ] {
            let values = ["Controllo sintetico", day, time, ""].map(String::from);
            assert!(
                validate_form_in_zone(FormKind::Checkup, &values, &zone).is_err(),
                "review: {zone} {day} {time}"
            );
            assert!(
                new_checkup_draft(&values, &zone).is_err(),
                "write: {zone} {day} {time}"
            );
        }
        // The old three-field date-only form cannot silently supply midnight.
        assert!(
            validate_form(
                FormKind::Checkup,
                &["Titolo", "2026-10-18", ""].map(String::from)
            )
            .is_err()
        );
    }

    #[test]
    fn existing_timestamp_appointments_retain_their_instant_and_local_display() {
        let date = "2026-10-18T00:30:45.123Z";
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 18).unwrap();
        assert_eq!(
            display_appointment_in_zone(date, &chrono_tz::America::New_York),
            "17/10/2026 · 20:30"
        );
        assert_eq!(
            agenda_group_in_zone("pending", date, today, &chrono_tz::America::New_York),
            AgendaGroup::Overdue
        );
        assert_eq!(
            display_appointment_in_zone(date, &chrono_tz::Europe::Rome),
            "18/10/2026 · 02:30"
        );
        assert_eq!(
            agenda_group_in_zone("pending", date, today, &chrono_tz::Europe::Rome),
            AgendaGroup::Upcoming
        );
    }

    #[test]
    fn new_observation_preserves_qualified_strings_and_decimal_punctuation() {
        let mut values = vec![
            "Parametro".into(),
            "1234-5".into(),
            "12,5".into(),
            "mm[Hg]".into(),
            "2026-10-17".into(),
        ];
        for (value, expected) in [
            ("<5", "<5"),
            ("12,5", "12,5"),
            ("negativo", "negativo"),
            ("\u{feff} <5 \u{feff}", "<5"),
            ("\u{0085}5\u{0085}", "\u{0085}5\u{0085}"),
        ] {
            values[2] = value.into();
            assert_eq!(new_observation_draft(&values).unwrap().value, expected);
        }
        for value in ["", "\t\n ", "\u{feff}"] {
            values[2] = value.into();
            assert!(new_observation_draft(&values).is_err());
        }
    }

    #[test]
    fn unreadable_diagnoses_are_distinct_from_an_empty_problem_list() {
        assert_eq!(diagnosis_labels(None), Ok(vec![]));
        assert_eq!(diagnosis_labels(Some("[]")), Ok(vec![]));
        assert!(diagnosis_labels(Some("not-json")).is_err());
        assert!(diagnosis_labels(Some("[{\"unrecognized\":true}]")).is_err());
        assert_eq!(
            diagnosis_labels(Some(
                "[{\"code\":\"I10\",\"description\":\"Test sintetico\"}]"
            )),
            Ok(vec!["I10 · Test sintetico".into()])
        );
    }

    #[test]
    fn current_interface_links_cannot_inject_paths_queries_or_fragments() {
        assert_eq!(path_segment("patient-1"), "patient-1");
        assert_eq!(path_segment("../a?secret=x#y"), "..%2Fa%3Fsecret%3Dx%23y");
        assert_eq!(path_segment("è"), "%C3%A8");
    }

    // These use GPUI's actual render/dispatch tree with its synthetic platform.
    // No RuntimeSession, archive, network operation or installed OS UI is used.
    fn render_clinical_window(cx: &mut gpui::VisualTestContext) {
        for _ in 0..8 {
            let callbacks = cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
                window.simulate_next_frame(cx)
            });
            cx.run_until_parked();
            if callbacks == 0 {
                return;
            }
        }
        panic!("workspace rendering did not return to an idle frame");
    }

    fn synthetic_notes_form(
        app: &mut ClinicalApp,
        state: FormState,
        cx: &mut Context<ClinicalApp>,
    ) -> Entity<TextInput> {
        let field = Field::new(
            "retired-form-notes",
            "Note sintetiche",
            "Bozza sintetica da ritirare",
            true,
            false,
            app.theme,
            cx,
        );
        let editor = field.editor.clone();
        app.form = Some(Form {
            kind: FormKind::Notes,
            fields: vec![field],
            upload: None,
            edit: None,
            patient_original: None,
            created_id: None,
            therapy: None,
            scale: None,
            state,
            _subscriptions: vec![],
        });
        editor
    }

    #[gpui::test]
    fn lock_discard_and_verified_save_retire_form_editors_even_when_entities_survive(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        for state in [
            FormState::Draft,
            FormState::Review,
            FormState::Saving,
            FormState::Conflict,
            FormState::Uncertain,
            FormState::Rejected,
        ] {
            let editor = view.update(cx, |app, cx| {
                let editor = synthetic_notes_form(app, state, cx);
                app.request_discard(Discard::Lock, cx);
                assert!(app.form.is_none());
                assert_eq!(app.core.phase(), mediflow_patient_client::Phase::Locked);
                editor
            });
            editor.read_with(cx, |input, _| {
                assert!(
                    input.value().is_empty(),
                    "lock must retire a form editor that is still referenced"
                );
                assert!(input.read_only);
            });
            cx.update(|window, cx| {
                editor.update(cx, |input, cx| {
                    gpui::EntityInputHandler::replace_text_in_range(
                        input,
                        None,
                        "Input sintetico tardivo",
                        window,
                        cx,
                    );
                    assert!(input.value().is_empty());
                });
            });
        }
        for saved in [false, true] {
            let editor = view.update(cx, |app, cx| {
                let editor = synthetic_notes_form(app, FormState::Draft, cx);
                if saved {
                    app.saved("Rilettura sintetica verificata", cx);
                } else {
                    app.finish_discard(Discard::Form, cx);
                }
                assert!(app.form.is_none());
                editor
            });
            editor.read_with(cx, |input, _| {
                assert!(input.value().is_empty());
                assert!(input.read_only);
            });
        }
    }

    #[gpui::test]
    fn conflict_uncertain_and_rejected_results_keep_the_active_draft_editor(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        for error in [
            RuntimeError::Conflict,
            RuntimeError::Indeterminate,
            RuntimeError::ReadRequired,
            RuntimeError::ProfileTooLarge,
        ] {
            let editor = view.update(cx, |app, cx| {
                let editor = synthetic_notes_form(app, FormState::Saving, cx);
                app.save_error(error, cx);
                assert!(app.form.is_some());
                editor
            });
            editor.read_with(cx, |input, _| {
                assert_eq!(input.value(), "Bozza sintetica da ritirare");
            });
        }
    }

    #[gpui::test]
    fn releasing_the_clinical_workspace_retires_surviving_form_editors(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let editor = view.update(cx, |app, cx| {
            synthetic_notes_form(app, FormState::Draft, cx)
        });
        cx.update(|window, _| window.remove_window());
        drop(view);
        cx.cx.update(|_| {});
        cx.run_until_parked();
        editor.read_with(cx, |input, _| {
            assert!(input.value().is_empty());
            assert!(input.read_only);
        });
    }

    #[gpui::test]
    fn application_shutdown_retires_form_editors_before_the_workspace_is_released(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let editor = view.update(cx, |app, cx| {
            synthetic_notes_form(app, FormState::Draft, cx)
        });
        cx.cx.update(|app| app.shutdown());
        editor.read_with(cx, |input, _| {
            assert!(input.value().is_empty());
            assert!(input.read_only);
        });
        view.read_with(cx, |app, _| assert!(app.form.is_none()));
    }

    #[gpui::test]
    fn disappearing_controls_restore_the_real_workspace_keyboard_dispatch(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(|cx| {
            bind_keys(cx);
            crate::text_input::bind_keys(cx);
        });
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.show_tls_pin = true;
            cx.notify();
        });
        render_clinical_window(cx);
        cx.update_window_entity(&view, |app, window, cx| {
            app.login_fields[1]
                .editor
                .update(cx, |input, cx| input.focus(window, cx));
            app.login_fields[5]
                .editor
                .update(cx, |input, cx| input.set_content("synthetic-input", cx));
        });
        render_clinical_window(cx);
        cx.update(|window, cx| {
            assert!(
                view.read(cx).login_fields[1]
                    .editor
                    .read(cx)
                    .focus_handle(cx)
                    .is_focused(window)
            );
        });

        // The old focused entity remains alive but its rendered control is gone,
        // exactly the condition shared by threshold and responsive transitions.
        view.update(cx, |app, cx| {
            app.show_tls_pin = false;
            cx.notify();
        });
        render_clinical_window(cx);
        cx.update(|window, cx| {
            assert!(view.read(cx).focus.is_focused(window));
        });
        cx.simulate_keystrokes("tab");
        render_clinical_window(cx);
        cx.update(|window, cx| {
            let app = view.read(cx);
            assert!(app.focus.contains_focused(window, cx));
            assert!(
                !app.focus.is_focused(window),
                "Tab must reach a rendered control"
            );
        });
        cx.simulate_keystrokes("shift-tab");
        render_clinical_window(cx);
        cx.simulate_keystrokes(&format!("{}-l", secondary_modifier()));
        render_clinical_window(cx);
        view.read_with(cx, |app, cx| {
            assert!(app.login_fields[5].value(cx).is_empty());
            assert!(
                app.message
                    .as_ref()
                    .unwrap()
                    .0
                    .starts_with("Sessione bloccata.")
            );
        });
    }

    #[gpui::test]
    fn focus_recovery_preserves_surviving_editors_and_window_deactivation(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.show_tls_pin = true;
            cx.notify();
        });
        render_clinical_window(cx);
        let editor = view.read_with(cx, |app, _| app.login_fields[0].editor.clone());
        cx.update_window_entity(&editor, |input, window, cx| input.focus(window, cx));
        render_clinical_window(cx);
        view.update(cx, |app, cx| {
            app.show_tls_pin = false;
            cx.notify();
        });
        for width in [390., 720., 1200.] {
            cx.simulate_resize(gpui::size(px(width), px(840.)));
            render_clinical_window(cx);
            cx.update(|window, cx| assert!(editor.read(cx).focus_handle(cx).is_focused(window)));
        }
        cx.deactivate_window();
        render_clinical_window(cx);
        cx.update(|window, cx| {
            assert!(editor.read(cx).focus_handle(cx).is_focused(window));
            // The recovery subscription has no animation/frame polling work.
            assert_eq!(window.simulate_next_frame(cx), 0);
        });
    }
}
