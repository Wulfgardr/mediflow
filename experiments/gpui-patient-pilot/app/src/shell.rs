//! Connected clinical workspace. GPUI owns presentation; the runtime owns records,
//! encryption policy, authorization and writes. No clinical data is persisted here.

mod account_profile;
mod agenda_flow;
mod ai_preferences;
mod ai_status;
mod ambulatories;
mod ambulatory_commands;
mod analytics;
#[cfg(unix)]
mod chat_access;
mod clinical_forms;
mod document_details;
mod document_library;
pub(crate) mod local_preferences;
mod local_settings;
#[cfg(test)]
mod notes_recovery_tests;
#[cfg(test)]
pub(crate) mod rendered_command;
mod scales;
mod settings;
mod therapy_picker;
mod threshold_actions;
mod view_state;
mod who_lookup;

use crate::theme::{TypeRole, TypeStyle};

use gpui::text;
use gpui::{
    App, ClipboardItem, Context, Div, Entity, FocusHandle, KeyBinding, Role, ScrollAnchor,
    ScrollHandle, SharedString, Stateful, Subscription, Window, WindowAppearance, actions, div,
    prelude::*, px,
};
#[cfg(test)]
macro_rules! text {
    ($($args:tt)*) => { crate::shell::rendered_command::observe_ink(gpui::text!($($args)*)) };
}

use mediflow_patient_client::{PatientProfile, ReadFailure, UpdateOutcome, Workspace};
use mediflow_runtime_client::{
    AgendaFilter, Ambulatory, Attachment, Checkup, CheckupDraft, DrugCatalogItem, Entry,
    EntryDraft, GlobalEntryFilter, Observation, ObservationDraft, PairingCredentials,
    PatientDetail, PatientSummary, ProfileQueryIntent, RequestContext, RuntimeClient,
    RuntimeConfig, RuntimeError, RuntimeSession, TerminologyRegistryEntry,
    TerminologyRegistryStatus, Therapy, TherapyDraft,
};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use zeroize::Zeroizing;

use crate::appointments::for_write as appointment_for_write;
use crate::clinical_text;
use crate::components::{
    WritingInk, WritingSurface, brand_icon, button, confirmation_heading, display_date, heading,
    notice, plain_text, section, tab, writing_status,
};
use crate::documents::{self, Upload};
use crate::editing;
use crate::icons::{Icon, icon};
use crate::navigation::{
    Area, CONFIRMATION_COMMANDS, Layout, PatientSection, ThresholdLayout, ThresholdMode,
    adjacent_patient, confirmation_command_label, confirmation_prefix,
};
use crate::patient_forms;
use crate::references::{ReferenceKind, ReferenceRows};
use crate::text_input::{InputChanged, TextInput};
use crate::theme::Theme;

use account_profile::AccountProfile;
use ai_preferences::AiPreferences;
use ai_status::AiRuntimeObservation;
use analytics::AnalyticsArea;
use document_library::DocumentOperation;
use local_preferences::{LocalPreferences, LocalPreferencesStore};
use local_settings::{PreferenceChange, PreferenceIssue};
use scales::{ScaleArea, ScaleAssessment};
use settings::SettingsPage;
use therapy_picker::TherapySelection;
use view_state::{ReadLoad, ReadObject, ViewState, ViewStateKind};
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
        Lock,
        Privacy
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
        KeyBinding::new("secondary-shift-p", Privacy, None),
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
    fn group<const N: usize>(handle: &ScrollHandle, cx: &App) -> [Self; N] {
        let anchor = ScrollAnchor::for_handle(handle.clone());
        std::array::from_fn(|_| Self {
            focus: cx.focus_handle().tab_stop(true),
            anchor: anchor.clone(),
        })
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
            Self::Notes => "nota",
            Self::Entry => "voce di diario",
            Self::Scale => "valutazione",
            Self::Therapy => "terapia",
            Self::Observation => "parametro",
            Self::Document => "documento",
            Self::Checkup => "controllo",
            Self::PatientNew => "nuova scheda",
            Self::PatientProfile => "anagrafica",
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
    attachments: ReadLoad<Vec<Attachment>>,
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
            attachments: ReadLoad::Idle,
            document_details_id: None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CallbackState {
    Current,
    StaleAuthority,
    Retired,
}

// Device pairing is deliberately separate from the operator session. It lives
// only in this window; dropping/changing it zeroizes the retained device token.
struct StoredPairing {
    client: RuntimeClient,
    id: String,
    token: Zeroizing<String>,
}

pub struct ClinicalApp {
    #[cfg(unix)]
    chat_access: chat_access::ChatAccess,
    session: Option<RuntimeSession>,
    request_context: RequestContext,
    pairing: Option<StoredPairing>,
    show_tls_pin: bool,
    login_scroll: gpui::ScrollHandle,
    connecting: bool,
    document_operation: DocumentOperation,
    copy_state: Option<documents::CopyState>,
    edit_pending: bool,
    focus_first_field: bool,
    login_fields: Vec<Field>,
    login_actions: [ScrollTarget; 3],
    login_appearance: [ScrollTarget; 3],
    settings_appearance: [ScrollTarget; 3],
    ambulatories: Load<Vec<Ambulatory>>,
    ambulatory_management: ambulatories::Management,
    scope: Option<String>,
    patients: Load<Vec<PatientSummary>>,
    global_patients: ReadLoad<Vec<PatientSummary>>,
    agenda: ReadLoad<Vec<Checkup>>,
    agenda_flow: agenda_flow::AgendaFlow,
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
    settings_page: SettingsPage,
    settings_targets: [ScrollTarget; 6],
    account_profile: AccountProfile,
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
    patient_targets: BTreeMap<String, ScrollTarget>,
    form: Option<Form>,
    discard: Option<Discard>,
    message: Option<(String, bool)>,
    verified: Option<String>,
    dark_override: Option<bool>,
    dark: bool,
    text_scale: f32,
    increased_contrast: bool,
    privacy_shield: bool,
    local_preferences: LocalPreferencesStore,
    preferences_issue: Option<PreferenceIssue>,
    preferences_error: Option<String>,
    privacy_scroll: ScrollHandle,
    privacy_commands: [ScrollTarget; 3],
    theme: Theme,
    focus: FocusHandle,
    review_focus: FocusHandle,
    threshold_question: ScrollTarget,
    threshold_menu_open: std::rc::Rc<std::cell::Cell<bool>>,
    threshold_menu_focus: FocusHandle,
    threshold_region_focus: FocusHandle,
    threshold_region_scroll: ScrollHandle,
    #[cfg(test)]
    test_body_size: Option<f32>,
    threshold_menu_scroll: ScrollHandle,
    threshold_menu_targets: [ScrollTarget; 3],
    threshold_mode: std::rc::Rc<std::cell::Cell<ThresholdMode>>,
    threshold_scrolls_with_content: std::rc::Rc<std::cell::Cell<bool>>,
    form_actions: [ScrollTarget; 8],
    focus_after_render: bool,
    focus_search_after_render: bool,
    profile_scroll: gpui::ScrollHandle,
    read_state_focus: [FocusHandle; 9],
    read_state_commands: Vec<(ReadObject, ViewState)>,
    read_timer: Option<gpui::Task<()>>,
    epoch: u64,
    profile_query_intent: Option<ProfileQueryIntent>,
    _subscriptions: Vec<Subscription>,
}

impl ClinicalApp {
    pub fn new(server: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_local_preferences(server, LocalPreferencesStore::system(), window, cx)
    }

    pub(crate) fn with_local_preferences(
        server: String,
        local_preferences: LocalPreferencesStore,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let (preferences, error) = local_preferences.load_with_error();
        let failed = error.is_some();
        let dark = preferences.dark_override.unwrap_or(matches!(
            window.appearance(),
            WindowAppearance::Dark | WindowAppearance::VibrantDark
        ));
        let theme =
            Theme::for_dark(dark).sized(preferences.text_scale, preferences.increased_contrast);
        let login_scroll = ScrollHandle::new();
        let profile_scroll = ScrollHandle::new();
        let area_scroll = ScrollHandle::new();
        let privacy_scroll = ScrollHandle::new();
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
        let threshold_menu_scroll = ScrollHandle::new();
        let threshold_region_scroll = ScrollHandle::new();
        let mut app = Self {
            #[cfg(unix)]
            chat_access: chat_access::ChatAccess::new(theme, cx),
            session: None,
            request_context: RequestContext::default(),
            pairing: None,
            show_tls_pin: false,
            login_actions: std::array::from_fn(|_| ScrollTarget::new(&login_scroll, cx)),
            login_appearance: ScrollTarget::group(&login_scroll, cx),
            settings_appearance: ScrollTarget::group(&area_scroll, cx),
            login_scroll,
            connecting: false,
            document_operation: DocumentOperation::Idle,
            copy_state: None,
            edit_pending: false,
            focus_first_field: false,
            login_fields,
            ambulatories: Load::Idle,
            ambulatory_management: ambulatories::Management::default(),
            scope: None,
            patients: Load::Idle,
            global_patients: ReadLoad::Idle,
            agenda: ReadLoad::Idle,
            agenda_flow: agenda_flow::AgendaFlow::default(),
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
            settings_page: SettingsPage::Overview,
            settings_targets: ScrollTarget::group(&area_scroll, cx),
            account_profile: AccountProfile::new(Theme::for_dark(false), cx),
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
            patient_targets: BTreeMap::new(),
            form: None,
            discard: None,
            message: None,
            verified: None,
            dark_override: preferences.dark_override,
            dark,
            text_scale: preferences.text_scale,
            increased_contrast: preferences.increased_contrast,
            privacy_shield: preferences.privacy_shield,
            local_preferences,
            preferences_issue: failed.then_some(PreferenceIssue::Read),
            preferences_error: error,
            privacy_commands: std::array::from_fn(|_| ScrollTarget::new(&privacy_scroll, cx)),
            privacy_scroll,
            theme,
            focus: cx.focus_handle(),
            review_focus,
            threshold_question: ScrollTarget::new(&profile_scroll, cx),
            threshold_menu_open: std::rc::Rc::new(std::cell::Cell::new(false)),
            threshold_menu_focus: cx.focus_handle().tab_stop(true),
            threshold_region_focus: cx.focus_handle().tab_stop(true),
            threshold_region_scroll,
            #[cfg(test)]
            test_body_size: None,
            threshold_menu_scroll: threshold_menu_scroll.clone(),
            threshold_menu_targets: std::array::from_fn(|_| {
                ScrollTarget::new(&threshold_menu_scroll, cx)
            }),
            threshold_mode: std::rc::Rc::new(std::cell::Cell::new(ThresholdMode::Complete)),
            threshold_scrolls_with_content: Default::default(),
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
        #[cfg(unix)]
        app.start_chat_access(cx);
        let quit = cx.on_app_quit(|this, cx| {
            #[cfg(unix)]
            this.chat_access.retire(cx);
            this.ambulatory_management.destructive.withdraw(cx);
            this.request_context.cancel();
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
            #[cfg(unix)]
            this.chat_access.retire(cx);
            this.ambulatory_management.destructive.withdraw(cx);
            this.request_context.cancel();
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
        let appearance_changed = cx.observe_window_appearance(window, |_, _, cx| cx.notify());
        app._subscriptions.push(appearance_changed);
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
        self.ambulatory_management.destructive.cancel_requests();
        if self.copy_state == Some(documents::CopyState::Reading) {
            self.copy_state = Some(documents::CopyState::Withdrawn);
        }
        self.request_context.cancel();
        self.request_context = RequestContext::default();
        if let Some(session) = &mut self.session {
            session.renew_requests();
        }
        self.next_presentation_epoch();
    }

    fn next_presentation_epoch(&mut self) {
        if matches!(self.ambulatories, Load::Loading) {
            self.ambulatories = Load::Idle;
        }
        self.agenda.interrupt();
        if let Some(refresh) = &mut self.agenda_flow.refresh {
            refresh.interrupt();
        }
        self.global_patients.interrupt();
        self.read_timer = None;
        self.read_state_commands.clear();
        self.ai_preferences.reset();
        if self.settings_page == SettingsPage::AiPreferences {
            self.settings_page = SettingsPage::Overview;
        }
        self.who.reset();
        self.patient.document_details_id = None;
        if let Some(intent) = self.profile_query_intent.take() {
            intent.cancel();
        }
        self.document_operation = DocumentOperation::Idle;
        self.edit_pending = false;
        self.ai_status = Load::Idle;
        self.epoch = self
            .epoch
            .checked_add(1)
            .expect("window request generation exhausted");
    }

    fn check_callback(
        &mut self,
        authority: u64,
        error: Option<RuntimeError>,
        cx: &mut Context<Self>,
    ) -> CallbackState {
        if self.account_profile.generation != authority {
            return CallbackState::StaleAuthority;
        }
        let Some(error) = error.filter(RuntimeError::retires_session).or_else(|| {
            self.session
                .as_ref()
                .and_then(RuntimeSession::retirement_error)
        }) else {
            return CallbackState::Current;
        };
        let message = if self.ai_preferences.is_saving() {
            format!(
                "Salvataggio delle preferenze AI non verificato. {}",
                ui_error(error)
            )
        } else if self.form.as_ref().is_some_and(|form| {
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
        self.disconnect(cx);
        self.message = Some((message, true));
        CallbackState::Retired
    }

    fn run<T: Send + 'static>(
        &self,
        operation: impl FnOnce() -> Result<T, RuntimeError> + Send + 'static,
        apply: impl FnOnce(&mut Self, Result<T, RuntimeError>, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        let epoch = self.epoch;
        let authority = self.account_profile.generation;
        let task = cx.background_executor().spawn(async move { operation() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                if this.check_callback(authority, result.as_ref().err().copied(), cx)
                    != CallbackState::Current
                {
                    return;
                }
                if this.epoch != epoch {
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
        let client = client.with_request_context(self.request_context.clone());
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
        #[cfg(unix)]
        self.chat_access.retire(cx);
        self.analytics.reset(cx);
        self.scales.reset(cx);
        self.account_profile.reset(self.theme, cx);
        self.settings_page = SettingsPage::Overview;
        self.ambulatory_management.reset(self.theme, cx);
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
        self.global_patients = ReadLoad::Idle;
        self.agenda = ReadLoad::Idle;
        self.agenda_flow = agenda_flow::AgendaFlow::default();
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
        if matches!(self.ambulatories, Load::Loading) {
            return;
        }
        self.ambulatories = Load::Loading;
        self.run(
            move || session.list_ambulatories(),
            |this, result, cx| match result {
                Ok(rows) => {
                    this.receive_ambulatories(rows, cx);
                }
                Err(error) => {
                    this.ambulatory_management.rebase = false;
                    this.ambulatories = Load::Failed(ui_error(error));
                }
            },
            cx,
        );
    }

    fn change_scope(&mut self, id: &str, cx: &mut Context<Self>) {
        if self.form.is_some() || self.ambulatory_management.draft.is_some() {
            self.message = Some((
                "Completa o scarta la bozza prima di cambiare ambulatorio.".into(),
                false,
            ));
            cx.notify();
            return;
        }
        if !self
            .ambulatories
            .ready()
            .is_some_and(|rows| rows.iter().any(|row| row.id == id))
        {
            return;
        }
        self.withdraw_ambulatory_command_view(cx);
        self.ambulatory_management.initial_scope = false;
        self.next_epoch();
        self.focus_after_render = true;
        self.scope = Some(id.to_owned());
        self.message = None;
        self.global_patients = ReadLoad::Idle;
        self.agenda = ReadLoad::Idle;
        self.agenda_flow = agenda_flow::AgendaFlow::default();
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
        let (Some(_), Some(scope)) = (&self.session, self.scope.clone()) else {
            return;
        };
        self.next_epoch();
        let session = self.session.as_ref().expect("active session").clone();
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
        let (Some(_), Some(scope)) = (&self.session, self.scope.clone()) else {
            return;
        };
        let request = match self.core.select(id) {
            Ok(request) => request,
            Err(_) => return,
        };
        self.next_epoch();
        let session = self.session.as_ref().expect("active session").clone();
        if let Err(error) = session.select_profile_patient(&scope, id) {
            self.core
                .receive_read(&request, Err(ReadFailure::Unavailable));
            self.message = Some((ui_error(error), true));
            cx.notify();
            return;
        }
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
        self.patient.attachments = ReadLoad::loading();
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
            |this, result, _| this.patient.attachments = ReadLoad::from_result(result),
            cx,
        );
    }

    fn navigate(&mut self, area: Area, cx: &mut Context<Self>) {
        if area == Area::Agenda && self.agenda_flow.origin.is_some() {
            self.return_to_agenda(cx);
            return;
        }
        if self.ambulatory_management.is_saving() {
            return;
        }
        if self.ai_preferences_blocks_navigation(cx) {
            return;
        }
        if self.form.is_some() {
            self.message = Some((
                "Completa o scarta la bozza prima di cambiare area.".into(),
                false,
            ));
        } else {
            self.agenda_flow = agenda_flow::AgendaFlow::default();
            self.focus_after_render = true;
            self.show_other = false;
            self.directory = true;
            if self.area != area {
                self.withdraw_ambulatory_command_view(cx);
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
                self.ensure_account_profile_loaded(cx);
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
        let (Some(_), Some(scope)) = (&self.session, self.scope.clone()) else {
            return;
        };
        self.next_epoch();
        let session = self.session.as_ref().expect("active session").clone();
        self.retry_global_read(ReadObject::NomiPazienti, cx);
        match self.area {
            Area::Agenda => self.retry_global_read(ReadObject::Agenda, cx),
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
        self.watch_patient_reads(cx);
        cx.notify();
    }

    fn global_patient_name(&self, id: &str) -> mediflow_patient_client::PersonName {
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
        if self.threshold_menu_open.get() {
            if let Some(index) = self
                .threshold_menu_targets
                .iter()
                .position(|target| target.focus.is_focused(window))
            {
                self.threshold_menu_scroll.scroll_to_item(index);
                window.refresh();
            }
            return;
        }
        if self.threshold_menu_focus.is_focused(window) {
            self.threshold_region_scroll.scroll_to_item(1);
            window.refresh();
            return;
        }
        if self.threshold_mode.get() == ThresholdMode::FullPlane {
            if !self.threshold_question.reveal_if_focused(window, cx) {
                self.form_actions
                    .iter()
                    .any(|target| target.reveal_if_focused(window, cx));
            }
            return;
        }
        let reveal_fields = |fields: &[Field], window: &mut Window, cx: &mut App| {
            fields
                .iter()
                .filter_map(|field| field.scroll_target.as_ref())
                .any(|target| target.reveal_if_focused(window, cx))
        };
        if self.session.is_none() {
            if self
                .login_appearance
                .iter()
                .any(|target| target.reveal_if_focused(window, cx))
            {
                return;
            }
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
                && (self.threshold_scrolls_with_content.get()
                    || Layout::for_window(f32::from(window.viewport_size().width), self.text_scale)
                        .magnified)
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
            if !self.global_search_target.reveal_if_focused(window, cx) && self.area == Area::Agenda
            {
                self.agenda_flow
                    .targets
                    .values()
                    .any(|target| target.reveal_if_focused(window, cx));
            }
        } else if self.area == Area::References
            && !self.reference_search_target.reveal_if_focused(window, cx)
        {
            if !self.reference_run_target.reveal_if_focused(window, cx)
                && self.reference_kind == ReferenceKind::Who
            {
                self.who.reveal_if_focused(window, cx);
            }
        } else if self.area == Area::Settings {
            if self
                .settings_targets
                .iter()
                .any(|target| target.reveal_if_focused(window, cx))
            {
                return;
            }
            if self
                .settings_appearance
                .iter()
                .any(|target| target.reveal_if_focused(window, cx))
            {
                return;
            }
            if self.settings_page == SettingsPage::AiPreferences {
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
        let visible_ids: BTreeSet<_> = self
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
            && self.document_operation == DocumentOperation::Idle
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
            let ambulatory_pending = self.ambulatory_management.is_saving();
            let pending = self
                .form
                .as_ref()
                .is_some_and(|form| form.state == FormState::Saving);
            self.disconnect(cx);
            if pending {
                self.message = Some(("Sessione bloccata. Una scrittura era in corso: verifica la scheda dopo l'accesso.".into(), false));
            } else if ambulatory_pending {
                self.message = Some(("Sessione bloccata. Un salvataggio delle sedi era in corso: rileggi l’elenco dopo l’accesso.".into(),false));
            } else if ai_pending {
                self.message = Some(("Sessione bloccata. Un salvataggio AI era in corso: rileggi le preferenze dopo l’accesso.".into(), false));
            }
            return;
        }
        if action == Discard::Reload
            && self.area == Area::Settings
            && (self.settings_page == SettingsPage::Ambulatories)
        {
            if !self.ambulatory_management.is_saving()
                && !matches!(self.ambulatories, Load::Loading)
            {
                self.ambulatory_management.rebase = true;
                self.load_ambulatories(cx);
            }
            return;
        }
        if action == Discard::Reload && (self.settings_page == SettingsPage::AiPreferences) {
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
        if action == Discard::Reload
            && self.form.as_ref().is_some_and(|form| {
                form.kind == FormKind::Notes
                    && matches!(
                        form.state,
                        FormState::Conflict | FormState::Uncertain | FormState::Rejected
                    )
            })
        {
            self.reread_notes(cx);
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

    fn reread_notes(&mut self, cx: &mut Context<Self>) {
        let Some(form) = &self.form else {
            return;
        };
        if form.kind != FormKind::Notes
            || !matches!(
                form.state,
                FormState::Conflict | FormState::Uncertain | FormState::Rejected
            )
        {
            return;
        }
        let previous = form.state;
        let (Some(_), Some(scope)) = (&self.session, self.scope.clone()) else {
            return;
        };
        let Ok(request) = self.core.reread_preserving_draft() else {
            return;
        };
        if self.selected_id.as_deref() != Some(&request.patient_id) {
            self.disconnect(cx);
            return;
        }
        self.next_epoch();
        let session = self.session.as_ref().expect("active session").clone();
        self.form.as_mut().expect("notes recovery").state = FormState::Saving;
        self.message = None;
        let intent = self.profile_intent(&session);
        let id = request.patient_id.clone();
        self.run(
            move || session.open_patient_profile(&scope, &id, &intent),
            move |this, result, cx| {
                let patient = match result {
                    Ok(patient) if !patient.field_locked("notes") => patient,
                    Ok(_) => {
                        this.core.receive_read(&request, Err(ReadFailure::Invalid));
                        this.form.as_mut().expect("notes recovery").state = previous;
                        this.message = Some((ui_error(RuntimeError::LockedField), true));
                        return;
                    }
                    Err(RuntimeError::ArchiveReplaced) => {
                        this.disconnect(cx);
                        this.message = Some((ui_error(RuntimeError::ArchiveReplaced), true));
                        return;
                    }
                    Err(error) => {
                        this.core
                            .receive_read(&request, Err(ReadFailure::Unavailable));
                        this.form.as_mut().expect("notes recovery").state = previous;
                        this.message = Some((ui_error(error), true));
                        return;
                    }
                };
                this.apply_notes_reread(&request, previous, patient, cx);
            },
            cx,
        );
        cx.notify();
    }

    fn apply_notes_reread(
        &mut self,
        request: &mediflow_patient_client::ReadRequest,
        previous: FormState,
        patient: PatientDetail,
        cx: &mut Context<Self>,
    ) {
        if !self
            .core
            .receive_read(request, Ok(profile_for_core(&patient)))
        {
            self.form.as_mut().expect("notes recovery").state = previous;
            self.message = Some((ui_error(RuntimeError::InvalidResponse), true));
            return;
        }
        let writable = !patient.is_archived && patient.deleted_at.is_none();
        self.patient.detail = ReadLoad::Ready(patient);
        if self.core.phase() == mediflow_patient_client::Phase::Saved {
            self.saved(
                "Registrata · contenuto confermato dalla rilettura della scheda.",
                cx,
            );
        } else {
            self.form.as_mut().expect("notes recovery").state = if writable {
                FormState::Draft
            } else {
                FormState::Rejected
            };
            if !writable {
                self.core.lock();
                self.message = Some(("La scheda non è più modificabile. La bozza resta disponibile per la copia o lo scarto.".into(), true));
            }
            self.focus_after_render = true;
            self.focus_first_field = writable;
        }
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
        if self.edit_pending || self.document_operation != DocumentOperation::Idle {
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

    fn close_clean_notes(&mut self, cx: &mut Context<Self>) {
        if self
            .form
            .as_ref()
            .is_some_and(|form| form.kind == FormKind::Notes && form.state == FormState::Draft)
            && !self.core.is_dirty()
        {
            self.finish_discard(Discard::Form, cx);
        } else {
            self.request_discard(Discard::Form, cx);
        }
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
            self.message = if error == mediflow_patient_client::ClientError::NoChanges {
                None
            } else {
                Some((client_message(error).into(), false))
            };
            cx.notify();
            return;
        }
        self.close_drug_search(cx);
        self.form.as_mut().expect("reviewed form").state = FormState::Review;
        self.message = None;
        self.threshold_mode.set(ThresholdMode::Complete);
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
        let (Some(_), Some(scope)) = (&self.session, self.scope.clone()) else {
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
        let session = self.session.as_ref().expect("active session").clone();
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
                                    if error.is_auth_failure() || error == RuntimeError::ArchiveReplaced {
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
                            this.saved("Registrata · note rilette dalla scheda.", cx);
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
                let rows = session.list_attachments(&scope, &id)?;
                let upload = match documents::admit_import(upload, &rows, |attachment| session.read_attachment(&scope, &id, attachment))? {
                    documents::ImportAdmission::New(upload) => upload,
                    documents::ImportAdmission::Duplicate { .. } => return Err(RuntimeError::Conflict),
                };
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
        if error.retires_session() {
            self.disconnect(cx);
            self.message = Some((ui_error(error), true));
            return;
        }
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
            crate::patient_text::copy_name(&patient.display_name()),
            format!("Nascita: {}", display_date(patient.birth_date.as_deref())),
            format!(
                "Codice fiscale: {}",
                crate::patient_text::copy_code(&patient.tax_code)
            ),
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
                    .type_role(self.theme, crate::theme::TextRole::Brand)
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
                    crate::theme::TextRole::Meta
                } else {
                    crate::theme::TextRole::Body
                },
            )
            .when(active, |el| {
                el.type_role(theme, crate::theme::TextRole::Strong)
            })
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
                        div().px(px(8.)).text_color(theme.secondary).child(
                            crate::title::title("ACCESSO PERSONALE", theme)
                                .with_role(crate::theme::TitleRole::Section),
                        ),
                    )
                    .child(
                        div()
                            .px(px(8.))
                            .type_role(theme, crate::theme::TextRole::Body)
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
            .mx(px(8.))
            .mb(px(8.))
            .rounded(px(theme.paper_radius))
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
                    .type_role(theme, crate::theme::TextRole::Meta)
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
                        .type_role(theme, crate::theme::TextRole::Meta)
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
                .child(crate::text_input::themed(field.editor.clone(), theme))
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
            .when(
                !self.form.as_ref().is_some_and(|form| {
                    form.kind == FormKind::Notes && self.core.has_notes_comparison()
                }),
                |el| {
                    el.child(
                        div()
                            .debug_selector(|| "clinical-workspace-field-label".into())
                            .text_color(theme.ink)
                            .type_role(theme, crate::theme::TextRole::Body)
                            .child(text!(field.label)),
                    )
                },
            )
            .child(
                div()
                    .id(SharedString::from(format!("{id}-scroll-target")))
                    .debug_selector(move || format!("{id}-scroll-target"))
                    .when_some(field.scroll_target.as_ref(), |el, target| {
                        el.anchor_scroll(Some(target.anchor.clone()))
                    })
                    .child(content),
            )
    }

    fn appearance(&self, width: f32, login: bool, cx: &Context<Self>) -> Stateful<Div> {
        let layout = crate::components::appearance_layout(width, self.theme, cx);
        let targets = if login {
            &self.login_appearance
        } else {
            &self.settings_appearance
        };
        crate::components::appearance_track("clinical-workspace-appearance", self.theme)
            .anchor_scroll(Some(targets[0].anchor.clone()))
            .when(layout.stacked, |el| el.flex_col().w(px(layout.width)))
            .children(
                crate::components::APPEARANCE_CHOICES
                    .into_iter()
                    .enumerate()
                    .map(|(index, (value, id, label))| {
                        crate::components::appearance_segment(
                            value,
                            self.dark_override,
                            id,
                            label,
                            layout.theme,
                        )
                        .when(layout.stacked, |el| el.w_full().flex_shrink_0())
                        .track_focus(&targets[index].focus)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.change_local_preference(PreferenceChange::Appearance(value), cx)
                        }))
                    }),
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
                .child(self.appearance((layout.width-2.*layout.margin).min(640.)-2.*if layout.compact {16.} else {28.},true,cx)))
            .child(self.local_preferences_status(cx))
            .child(div().flex().flex_col().gap(px(8.))
                .child(heading("clinical-workspace-connect-heading", if paired { "Accedi al tuo archivio" } else { "Collega questo dispositivo" }, theme))
                .child(div().text_color(theme.secondary).type_role(theme, crate::theme::TextRole::Body)
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
                            div().text_color(theme.secondary).child(
                                crate::title::title("ARCHIVIO SCELTO", theme)
                                    .with_role(crate::theme::TitleRole::Section),
                            ),
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
                .child(div().type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary)
                    .child(text!("La frase di accesso non viene salvata su disco. L'abbinamento resta in memoria fino alla chiusura della finestra.")))
        } else {
            panel.child(self.login_actions[1].attach_enabled(button("clinical-workspace-continue-pairing", if self.connecting { "Preparazione in corso…" } else { "Continua con l'accesso" }, theme, true, !self.connecting), !self.connecting)
                .when(!self.connecting, |el| el.on_click(cx.listener(|this, _, _, cx| this.prepare_pairing(cx)))))
                .child(div().type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary)
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
                        div().text_color(theme.secondary).child(
                            crate::title::title("AMBULATORIO", theme)
                                .with_role(crate::theme::TitleRole::Section),
                        ),
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
                                .child(crate::text_input::themed(self.search.clone(), theme)),
                            false,
                        ),
                    ),
            )
            .child(
                div()
                    .text_color(theme.secondary)
                    .type_role(theme, crate::theme::TextRole::Meta)
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
                        .child(
                            div()
                                .type_role(theme, crate::theme::TextRole::Strong)
                                .child(text!(if self.query.trim().is_empty() {
                                    "Nessun paziente in questo elenco"
                                } else {
                                    "Nessun paziente corrisponde alla ricerca"
                                })),
                        )
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
                    crate::title::TitleText::name(patient.display_name()).text(),
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
                                    .type_role(theme, crate::theme::TextRole::Strong)
                                    .child(crate::title::title(
                                        crate::title::TitleText::name(patient.display_name()),
                                        theme,
                                    )),
                            )
                            .child(
                                div()
                                    .type_role(theme, crate::theme::TextRole::Meta)
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
                                .type_role(theme, crate::theme::TextRole::Code)
                                .child(crate::title::title(
                                    crate::title::TitleText::code(patient.tax_code.clone()),
                                    theme,
                                )),
                        )
                    })
                    .when(!layout.compact, |el| {
                        el.child(
                            div()
                                .text_color(theme.secondary)
                                .type_role(theme, crate::theme::TextRole::Meta)
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
                    div().child(
                        crate::title::title(
                            crate::title::TitleText::name(patient.display_name()),
                            theme,
                        )
                        .with_role(crate::theme::TitleRole::PersonPreview),
                    ),
                )
                .child(div().text_color(theme.secondary).child(text!(format!(
                    "Nascita {}",
                    display_date(patient.birth_date.as_deref())
                ))))
                .child(div().type_role(theme, crate::theme::TextRole::Code).child(
                    crate::title::title(
                        crate::title::TitleText::code(patient.tax_code.clone()),
                        theme,
                    ),
                ))
                .child(
                    div()
                        .border_t_1()
                        .border_color(theme.rule)
                        .pt(px(16.))
                        .type_role(theme, crate::theme::TextRole::Body)
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
                    .type_role(theme, crate::theme::TextRole::Prose)
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
            .min_w_0()
            .flex()
            .flex_col()
            .reading_surface(theme)
            .rounded(px(theme.paper_radius));
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
                            self.patient_back_label(),
                            theme,
                            false,
                            true,
                        )
                        .debug_selector(|| "clinical-workspace-back-directory".into())
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.back_from_patient(cx);
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
                                .child(crate::components::heading_with_role(
                                    "clinical-workspace-patient-name",
                                    crate::title::TitleText::name(patient.display_name()),
                                    theme,
                                    crate::theme::TitleRole::Person {
                                        compact: layout.compact,
                                    },
                                ))
                                .child(
                                    div()
                                        .type_role(theme, crate::theme::TextRole::Meta)
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
                                        div().type_role(theme, crate::theme::TextRole::Code).child(
                                            crate::title::title(
                                                crate::title::TitleText::code(
                                                    patient.tax_code.clone(),
                                                ),
                                                theme,
                                            ),
                                        ),
                                    )
                                }),
                        )
                        .child(
                            button(
                                "clinical-workspace-back-directory",
                                self.patient_back_label(),
                                theme,
                                false,
                                self.form.is_none(),
                            )
                            .debug_selector(|| "clinical-workspace-back-directory".into())
                            .when(self.form.is_none(), |el| {
                                el.on_click(cx.listener(|this, _, _, cx| {
                                    this.back_from_patient(cx);
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
                        .type_role(theme, crate::theme::TextRole::Meta)
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
                    .py(px(8.))
                    .gap(px(4.))
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
        self.confirmation_plane(
            "clinical-workspace-profile-plane",
            pane.child(content),
            layout,
            cx,
        )
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
                            .type_role(theme, crate::theme::TextRole::Strong)
                            .child({
                                let text = text!("Problemi e contesto");
                                #[cfg(test)]
                                let text = crate::shell::rendered_command::observe_text(text);
                                text
                            }),
                    )
                    .when(diagnoses.is_err(), |el| {
                        el.child(
                            self.unreadable_field("clinical-workspace-diagnoses-unavailable", cx),
                        )
                    })
                    .when(diagnoses.as_ref().is_ok_and(Vec::is_empty), |el| {
                        el.child(div().text_color(theme.secondary).child({
                            let text = text!("Nessun problema riportato nella scheda.");
                            #[cfg(test)]
                            let text = crate::shell::rendered_command::observe_text(text);
                            text
                        }))
                    })
                    .children(
                        diagnoses
                            .unwrap_or_default()
                            .into_iter()
                            .map(|(id, label)| {
                                div()
                                    .id(SharedString::from(id))
                                    .border_b_1()
                                    .border_color(theme.rule)
                                    .py(px(12.))
                                    .child({
                                        let text = text!(label);
                                        #[cfg(test)]
                                        let text =
                                            crate::shell::rendered_command::observe_text(text);
                                        text
                                    })
                            }),
                    ),
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
                                    .id(SharedString::from(format!(
                                        "clinical-overview-therapy-{}",
                                        row.id
                                    )))
                                    .border_b_1()
                                    .border_color(theme.rule)
                                    .py(px(12.))
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.))
                                    .child(
                                        div()
                                            .type_role(theme, crate::theme::TextRole::Strong)
                                            .child({
                                                let text = text!(row.drug_name.clone());
                                                #[cfg(test)]
                                                let text =
                                                    crate::shell::rendered_command::observe_text(
                                                        text,
                                                    );
                                                text
                                            }),
                                    )
                                    .child(div().text_color(theme.secondary).child({
                                        let text = text!(row.dosage.clone());
                                        #[cfg(test)]
                                        let text =
                                            crate::shell::rendered_command::observe_text(text);
                                        text
                                    }))
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
                                    .id(SharedString::from(format!(
                                        "clinical-overview-checkup-{}",
                                        row.id
                                    )))
                                    .border_b_1()
                                    .border_color(theme.rule)
                                    .py(px(12.))
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.))
                                    .child(
                                        div()
                                            .type_role(theme, crate::theme::TextRole::Meta)
                                            .text_color(theme.secondary)
                                            .child({
                                                let text = text!(display_date(Some(&row.date)));
                                                #[cfg(test)]
                                                let text =
                                                    crate::shell::rendered_command::observe_text(
                                                        text,
                                                    );
                                                text
                                            }),
                                    )
                                    .child({
                                        let text = text!(row.title.clone());
                                        #[cfg(test)]
                                        let text =
                                            crate::shell::rendered_command::observe_text(text);
                                        text
                                    })
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
                    .child(div().type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary)
                        .child(text!(format!("{} · {}", display_date(Some(&entry.date)), entry_type_label(&entry.entry_type)))))
                    .child(div().type_role(theme, crate::theme::TextRole::Strong).child(text!(title)))
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
            .child(div().type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary)
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
                                    .type_role(theme, crate::theme::TextRole::Strong)
                                    .child(text!(row.drug_name.clone())),
                                div()
                                    .type_role(theme, crate::theme::TextRole::Meta)
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
                                    .type_role(theme, crate::theme::TextRole::Meta)
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
                                    el.child(
                                        div()
                                            .type_role(theme, crate::theme::TextRole::Prose)
                                            .child(clinical_text::render(
                                                row.motivation.as_deref().unwrap_or_default(),
                                                WritingInk::Dry,
                                                theme,
                                            )),
                                    )
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
                            .type_role(theme, crate::theme::TextRole::Strong)
                            .child(text!(row.display.clone())),
                        div()
                            .type_role(theme, crate::theme::TextRole::Strong)
                            .child(text!(format!("{} {}", row.value, row.unit_code))),
                    ))
                    .child(
                        div()
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(display_date(Some(&row.observed_at)))),
                    )
                    .child(
                        div()
                            .type_role(theme, crate::theme::TextRole::Code)
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
                            el.child(div().type_role(theme, crate::theme::TextRole::Prose).child(
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
            .reading_surface(theme)
            .rounded(px(theme.paper_radius));
        if self.show_other {
            return area.child(self.other_view(layout, cx));
        }
        if matches!(self.area, Area::Agenda | Area::Diary) {
            return area.child(self.global_area_view(layout, cx));
        }
        if self.area == Area::References {
            return area.child(self.references_view(cx));
        }
        if self.area == Area::Settings {
            return area.child(self.settings_view(layout, cx));
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
            .child(div().type_role(theme, crate::theme::TextRole::Strong).child(text!(description)))
            .child(notice("clinical-workspace-area-connection", "Quest'area non è ancora integrata nella finestra nativa. Il pulsante apre la funzione esistente; l'accesso potrebbe essere richiesto di nuovo.", theme, false))
            .child(button("clinical-workspace-open-current-area", button_label, theme, true, true)
                .on_click(cx.listener(move |this, _, _, cx| this.open_current(selected.current_path(), cx)))));
        area
    }
}

impl ClinicalApp {
    fn global_area_view(&self, layout: Layout, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let agenda = self.area == Area::Agenda;
        let selected = self.area;
        div().reading_surface(theme).w_full().min_w_0().max_w_full().flex().flex_col().gap(px(24.))
            .child(div().flex().flex_wrap().items_center().justify_between().gap(px(12.))
                .child(heading("clinical-workspace-global-heading", if agenda { "Agenda" } else { "Diario generale" }, theme))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .when(!agenda, |el| el.child(button("clinical-workspace-global-refresh", "Rileggi", theme, false, true)
                        .debug_selector(|| "clinical-workspace-global-refresh".into())
                        .on_click(cx.listener(|this, _, _, cx| this.request_discard(Discard::Reload, cx)))))
                    .child(button("clinical-workspace-global-current", "Interfaccia corrente…", theme, false, true)
                        .on_click(cx.listener(move |this, _, _, cx| this.open_current(selected.current_path(), cx))))))
            .child(div().flex().flex_wrap().items_center().gap(px(8.))
                .child(div().text_color(theme.secondary).child(crate::title::title("AMBULATORIO", theme).with_role(crate::theme::TitleRole::Section)))
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
                .child(div().type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary)
                    .child(text!("I giorni estremi sono inclusi, nel fuso orario di questo computer. Lascia vuoto un campo per non fissare quel limite.")))
                .when_some(self.global_date_error.as_ref(), |el, error| el.child(notice("clinical-workspace-date-error", format!("{error} L'intervallo applicato non è cambiato."), theme, true)))
                .child(div().id("clinical-workspace-applied-interval").role(Role::Status)
                    .type_role(theme, crate::theme::TextRole::Meta).child(text!(self.global_interval.description()))))
            .child(self.global_search_target.attach_enabled(
                div().id("clinical-workspace-global-search-anchor").min_w_0().max_w_full()
                    .child(crate::text_input::themed(self.global_search.clone(), theme)),
                false,
            ))
            .when_some(self.global_patients.state(ReadObject::NomiPazienti), |el, state| {
                el.child(self.render_global_read_state("clinical-workspace-global-patient-names", state, cx))
            })
            .when(agenda && !self.global_query.trim().is_empty() && self.global_patients.ready().is_none(), |el| el.child(notice(
                "clinical-workspace-agenda-partial-search", "La ricerca per nome è incompleta finché i nomi dei pazienti non sono disponibili. Puoi cercare per titolo del controllo.", theme, false).debug_selector(|| "clinical-workspace-agenda-partial-search".into())))
            .child(if agenda { self.agenda_view(layout.compact, cx) } else { self.global_diary_view(cx).into_any_element() })
            .child(div().border_t_1().border_color(theme.rule).pt(px(16.)).type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary)
                .child(text!(if agenda { "La lettura comprende al massimo 200 controlli nell'intervallo applicato, dal meno recente. Altri controlli potrebbero non comparire: restringi l'intervallo per cercarli. La ricerca testuale riguarda soltanto i risultati caricati." }
                    else { "La lettura comprende al massimo le 50 voci più recenti nell'intervallo applicato. Le voci eliminate sono escluse. Per cercare voci meno recenti scegli altre date; la ricerca testuale riguarda soltanto i risultati caricati." })))
    }

    fn agenda_view(&self, compact: bool, cx: &Context<Self>) -> gpui::AnyElement {
        self.agenda_view_after(compact, std::time::Instant::now(), cx)
    }

    fn agenda_view_after(
        &self,
        compact: bool,
        now: std::time::Instant,
        cx: &Context<Self>,
    ) -> gpui::AnyElement {
        let theme = self.theme;
        let today = chrono::Local::now().date_naive();
        let rows = self.visible_agenda_rows();
        let state = self.agenda_state_after(now);
        let status = self.agenda_status(state.clone());
        let mut content = div()
            .reading_surface(theme)
            .id("clinical-workspace-agenda-list")
            .accessibility_id("clinical-workspace-agenda-list")
            .role(Role::List)
            .aria_label(format!("Agenda. {status}"))
            .debug_selector(|| "clinical-workspace-agenda-list".into())
            .flex()
            .flex_col()
            .gap(px(28.));
        if self.agenda.ready().is_none()
            && let Some(state) = state
        {
            return content
                .child(self.render_global_read_state("clinical-workspace-agenda-state", state, cx))
                .into_any_element();
        }
        let status_text = text!(status.clone());
        #[cfg(test)]
        let status_text = rendered_command::observe_text(status_text);
        let status = div()
            .id("clinical-workspace-agenda-update")
            .accessibility_id("clinical-workspace-agenda-update")
            .role(Role::Status)
            .aria_label(status.clone())
            .debug_selector(|| "clinical-workspace-agenda-update".into())
            .min_h(px(44.))
            .flex()
            .items_center()
            .gap(px(12.))
            .child(status_text)
            .when(
                state
                    .as_ref()
                    .is_some_and(|state| state.command().is_some()),
                |el| {
                    el.child(
                        button(
                            "clinical-workspace-agenda-state-command",
                            "Rileggi",
                            theme,
                            false,
                            true,
                        )
                        .debug_selector(|| "clinical-workspace-agenda-state-command".into())
                        .track_focus(&self.read_state_focus[ReadObject::Agenda.index()])
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.retry_global_read_command(ReadObject::Agenda, cx)
                        })),
                    )
                },
            );
        content = content.child(status);
        if rows.is_empty() {
            return content
                .child(if self.agenda.ready().is_some_and(Vec::is_empty) {
                    self.empty_read_state("clinical-workspace-agenda-empty", ReadObject::Agenda, cx)
                } else {
                    notice(
                        "clinical-workspace-agenda-filter-empty",
                        "Nessun controllo corrisponde alla ricerca tra i risultati caricati.",
                        theme,
                        false,
                    )
                })
                .into_any_element();
        }
        for group in AgendaGroup::ALL {
            let grouped: Vec<_> = rows
                .iter()
                .copied()
                .filter(|row| agenda_group(&row.status, &row.date, today) == group)
                .collect();
            if grouped.is_empty() {
                continue;
            }
            let count = grouped.len();
            content = content.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(section(
                        group.id(),
                        crate::title::TitleText::label(group.title()).with_count(count as u64),
                        theme,
                    ))
                    .when(group == AgendaGroup::Overdue, |el| {
                        el.child(
                            div()
                                .type_role(theme, crate::theme::TextRole::Meta)
                                .text_color(theme.secondary)
                                .child(text!(
                                    "Data precedente a oggi, senza completamento registrato."
                                )),
                        )
                    })
                    .children(grouped.into_iter().map(|row| {
                        let patient_id = row.patient_id.clone();
                        let checkup_id = row.id.clone();
                        let target = &self.agenda_flow.targets[&row.id];
                        let name = self.global_patient_name(&patient_id);
                        let element = div()
                            .id(SharedString::from(format!(
                                "clinical-workspace-agenda-checkup-{}",
                                row.id
                            )))
                            .accessibility_id(SharedString::from(format!(
                                "clinical-workspace-agenda-checkup-{}",
                                row.id
                            )))
                            .debug_selector({
                                let id = row.id.clone();
                                move || format!("clinical-workspace-agenda-checkup-{id}")
                            })
                            .role(Role::Button)
                            .aria_label(SharedString::from(format!(
                                "Apri scheda di {}, {}, {}",
                                crate::title::TitleText::name(name.clone()).text(),
                                row.title,
                                display_date(Some(&row.date))
                            )))
                            .track_focus(&target.focus)
                            .anchor_scroll(Some(target.anchor.clone()))
                            .aria_selected(self.agenda_flow.selected.as_deref() == Some(&row.id))
                            .when(
                                self.agenda_flow.selected.as_deref() == Some(&row.id),
                                |el| el.bg(theme.selected),
                            )
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
                            .child(
                                div()
                                    .flex()
                                    .gap(px(12.))
                                    .items_center()
                                    .when(compact, |el| el.flex_col().items_start())
                                    .child(
                                        div()
                                            .id(SharedString::from(format!(
                                                "agenda-name-{}",
                                                row.id
                                            )))
                                            .debug_selector({
                                                let id = row.id.clone();
                                                move || format!("agenda-name-{id}")
                                            })
                                            .type_role(theme, crate::theme::TextRole::Strong)
                                            .child(crate::title::title(
                                                crate::title::TitleText::name(name),
                                                theme,
                                            )),
                                    )
                                    .child(
                                        div()
                                            .id(SharedString::from(format!(
                                                "agenda-title-{}",
                                                row.id
                                            )))
                                            .debug_selector({
                                                let id = row.id.clone();
                                                move || format!("agenda-title-{id}")
                                            })
                                            .min_w_0()
                                            .flex_1()
                                            .child(text!(row.title.clone())),
                                    )
                                    .child(
                                        div()
                                            .id(SharedString::from(format!(
                                                "agenda-status-{}",
                                                row.id
                                            )))
                                            .debug_selector({
                                                let id = row.id.clone();
                                                move || format!("agenda-status-{id}")
                                            })
                                            .type_role(theme, crate::theme::TextRole::Meta)
                                            .text_color(theme.secondary)
                                            .child(text!(checkup_status(&row.status))),
                                    )
                                    .child(
                                        div()
                                            .id(SharedString::from(format!(
                                                "agenda-date-{}",
                                                row.id
                                            )))
                                            .debug_selector({
                                                let id = row.id.clone();
                                                move || format!("agenda-date-{id}")
                                            })
                                            .type_role(theme, crate::theme::TextRole::Meta)
                                            .text_color(theme.secondary)
                                            .child(text!(display_appointment(&row.date))),
                                    ),
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
                                            .type_role(theme, crate::theme::TextRole::Prose)
                                            .line_clamp(3)
                                            .child(clinical_text::render(
                                                row.notes.as_deref().unwrap_or_default(),
                                                WritingInk::Dry,
                                                theme,
                                            )),
                                    )
                                },
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.open_agenda_patient(&checkup_id, &patient_id, cx)
                            }));
                        #[cfg(test)]
                        let element = rendered_command::observe(element);
                        element
                    })),
            );
        }
        #[cfg(test)]
        let content = rendered_command::observe(content);
        content.into_any_element()
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
                    && (crate::patient_text::search_name(
                        &self.global_patient_name(&row.patient_id),
                    )
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
            .reading_surface(theme)
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
                            .type_role(theme, crate::theme::TextRole::Strong)
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
                        "Apri diario di {}: {title}",
                        crate::title::TitleText::name(name.clone()).text()
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
                        div()
                            .type_role(theme, crate::theme::TextRole::Strong)
                            .child(crate::title::title(
                                crate::title::TitleText::name(name),
                                theme,
                            )),
                        div()
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(format!(
                                "{} · {}",
                                display_appointment(&row.date),
                                entry_type_label(&row.entry_type)
                            ))),
                    ))
                    .child(
                        div()
                            .type_role(theme, crate::theme::TextRole::Strong)
                            .child(text!(title)),
                    )
                    .child(div().type_role(theme, crate::theme::TextRole::Prose).child(
                        if row.locked_fields.iter().any(|field| field == "content") {
                            div().child(text!(content)).into_any_element()
                        } else {
                            clinical_text::render(&row.content, WritingInk::Dry, theme)
                        },
                    ))
                    .child(
                        div()
                            .type_role(theme, crate::theme::TextRole::Meta)
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
        self.prepare_local_appearance(window);
        if self.privacy_shield {
            return self.privacy_view(cx);
        }
        if std::mem::take(&mut self.focus_after_render) {
            let focus = if self.discard.is_none()
                && self.form.as_ref().is_some_and(|form| {
                    form.kind == FormKind::Notes
                        && matches!(form.state, FormState::Conflict | FormState::Uncertain)
                }) {
                &self.form_actions[7].focus
            } else {
                &self.focus
            };
            window.focus(focus, cx);
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
        let theme = self.theme;
        if self.settings_page == SettingsPage::AiPreferences {
            self.ai_preferences.prepare_render(window, cx);
        }
        self.prepare_ambulatory_management(theme, window, cx);
        self.account_profile
            .configure(theme, self.account_profile.read_only(), cx);

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
                    input.set_label(
                        if form.kind == FormKind::Notes && self.core.has_notes_comparison() {
                            "Note della scheda, la tua bozza"
                        } else {
                            field.label
                        },
                        cx,
                    );
                });
            }
        }
        let layout = Layout::for_window(f32::from(window.viewport_size().width), self.text_scale);
        let connected = self.session.is_some();
        self.sync_patient_targets(cx);
        self.prepare_agenda_return(window, cx);
        self.prepare_read_state_focus(window, cx);
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
        #[cfg(unix)]
        let chat_access = self.chat_access_view(cx);
        #[cfg(not(unix))]
        let chat_access: Option<Stateful<Div>> = None;
        let content = if let Some(access) = chat_access {
            access.into_any_element()
        } else if !connected {
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
                if this.threshold_menu_open.get() {
                    this.threshold_menu_open.set(false);
                    window.focus(&this.threshold_menu_focus, cx);
                    this.reveal_focused(window, cx);
                    cx.notify();
                } else if this.discard.take().is_some() {
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
                } else if this.form.is_none() && this.agenda_flow.origin.is_some() {
                    this.return_to_agenda(cx);
                }
            }))
            .on_action(cx.listener(|this, _: &Refresh, _, cx| {
                if this.session.is_some() {
                    this.request_discard(Discard::Reload, cx);
                }
            }))
            .on_action(cx.listener(|this, _: &Lock, _, cx| this.request_discard(Discard::Lock, cx)))
            .on_action(cx.listener(|this, _: &Privacy, window, cx| {
                this.change_local_preference(PreferenceChange::Privacy(true), cx);
                window.focus(&this.focus, cx);
            }))
            .size_full()
            .flex()
            .flex_col()
            .bg(theme.shade)
            .text_color(theme.ink)
            .type_role(theme, crate::theme::TextRole::Body)
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
                                el.p(px(if layout.magnified {
                                    0.
                                } else if layout.compact {
                                    8.
                                } else {
                                    12.
                                }))
                                .gap(px(12.))
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
                            .when_some(self.copy_state, |el, state| {
                                let (message, error) = state.notice();
                                el.child(
                                    notice("clinical-workspace-copy-state", message, theme, error)
                                        .flex_shrink_0(),
                                )
                            })
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
            || self.document_operation != DocumentOperation::Idle
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
            || self.document_operation != DocumentOperation::Idle
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
        let content = div()
            .id("clinical-workspace-new-patient-page")
            .min_w_0()
            .flex()
            .flex_col()
            .bg(theme.paper)
            .rounded(px(theme.paper_radius))
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
                    .child(div().max_w(px(760.)).child(self.form_view(cx))),
            );
        self.confirmation_plane("clinical-workspace-new-patient-plane", content, layout, cx)
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
            && self.document_operation == DocumentOperation::Idle
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
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(format!(
                                "{} · {}",
                                display_appointment(&row.date),
                                checkup_status(&row.status)
                            ))),
                    )
                    .child(
                        div()
                            .type_role(theme, crate::theme::TextRole::Strong)
                            .child(text!(
                                if row.locked_fields.iter().any(|field| field == "title") {
                                    "Titolo non leggibile".to_owned()
                                } else {
                                    row.title.clone()
                                }
                            )),
                    )
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

impl ClinicalApp {}

impl ClinicalApp {
    fn load_references(&mut self, cx: &mut Context<Self>) {
        let (Some(_), Some(scope)) = (&self.session, self.scope.clone()) else {
            return;
        };
        self.next_epoch();
        let session = self.session.as_ref().expect("active session").clone();
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
        let mut pane = div().reading_surface(theme).min_w_0().flex().flex_col().gap(px(20.))
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
                .child(div().text_color(theme.secondary).child(crate::title::title("AMBULATORIO", theme).with_role(crate::theme::TitleRole::Section)))
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
                        .child(crate::text_input::themed(self.reference_search.clone(), theme)), false))
                .child(self.reference_run_target.attach_enabled(button("clinical-workspace-reference-run-search", "Cerca", theme, true, self.scope.is_some()), self.scope.is_some())
                    .when(self.scope.is_some(), |el| el.on_click(cx.listener(|this, _, _, cx| this.load_references(cx))))))
            .when_some(total, |el, total| el.child(div().type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary)
                .child(text!(format!("{total} riferimenti nel repertorio completo dell'archivio.")))))
            .when_some(provenance, |el, provenance| {
                el.child(div().flex().flex_col().gap(px(4.)).type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary)
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
                        .type_role(theme, crate::theme::TextRole::Meta)
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
            .child(div().type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary).child(text!(format!("Ogni ricerca mostra al massimo {} risultati. Affina nome o codice per trovare altri riferimenti; il limite non prova che il repertorio sia completo.", self.reference_kind.limit()))))
            .child(button("clinical-workspace-reference-other-systems", "Catalogo ICD-11 incorporato e altri repertori…", theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| this.open_current(Area::References.current_path(), cx))))
            .child(div().type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary).child(text!("Gli altri sistemi usano il loro percorso nell'interfaccia corrente."))))
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

fn text_identity(value: &str) -> String {
    let hash = value
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
    format!("{hash:016x}")
}

fn diagnosis_labels(value: Option<&str>) -> Result<Vec<(String, String)>, ()> {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return Ok(vec![]);
    };
    let parsed: serde_json::Value = serde_json::from_str(value).map_err(|_| ())?;
    let rows = parsed.as_array().ok_or(())?;
    let mut occurrences = HashMap::<String, usize>::new();
    rows.iter()
        .map(|row| {
            let (identity, label) = if let Some(text) = row.as_str() {
                (text_identity(text), text.to_owned())
            } else {
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
                let identity = object
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .filter(|id| !id.is_empty())
                    .unwrap_or(code);
                let label = match (code.is_empty(), label.is_empty()) {
                    (false, false) => Ok(format!("{code} · {label}")),
                    (true, false) => Ok(label.into()),
                    (false, true) => Ok(code.into()),
                    (true, true) => Err(()),
                }?;
                (
                    text_identity(if identity.is_empty() {
                        &label
                    } else {
                        identity
                    }),
                    label,
                )
            };
            let occurrence = occurrences.entry(identity.clone()).or_default();
            let id = format!("clinical-overview-diagnosis-{identity}-{occurrence}");
            *occurrence += 1;
            Ok((id, label))
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
        Err(error) if error.retires_session() => Err(error),
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

    #[gpui::test]
    fn hcg2_patient_focus_registry_has_stable_traversal(cx: &mut gpui::TestAppContext) {
        cx.update(bind_keys);
        let host = notes_recovery_tests::Host::new();
        for _ in 0..12 {
            let (view, cx) =
                cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
            cx.simulate_resize(gpui::size(px(1200.), px(840.)));
            view.update(cx,|app,cx| {
                app.session=Some(host.session.clone()); app.scope=Some("scope-a".into()); app.directory=true;
                app.patients=Load::Ready(["c","a","e","b","d"].into_iter().map(|id| serde_json::from_value(serde_json::json!({"id":id,"firstName":format!("Nome {id}"),"lastName":"Inventato","taxCode":format!("TEST-{id}"),"version":1})).unwrap()).collect());
                app.sync_patient_targets(cx);
                let allocation:Vec<_>=app.patient_targets.values().map(|target| match gpui::ElementId::from(&target.focus) { gpui::ElementId::FocusHandle(id)=>id,_=>unreachable!() }).collect();
                assert!(allocation.windows(2).all(|ids|ids[0]<ids[1]),"sync must allocate focus targets in deterministic ID order: {allocation:?}");
                cx.notify();
            });
            render_clinical_window(cx);
            for filtered in [false, true, false] {
                view.update(cx, |app, cx| {
                    app.query = if filtered {
                        "Nome b".into()
                    } else {
                        String::new()
                    };
                    cx.notify();
                });
                render_clinical_window(cx);
                let expected = if filtered {
                    vec!["b"]
                } else {
                    vec!["c", "a", "e", "b", "d"]
                };
                view.read_with(cx, |app, _| {
                    assert_eq!(app.patient_targets.len(), expected.len())
                });
                cx.update(|window, cx| {
                    window.activate_window();
                    let focus = view.read(cx).patient_targets[expected[0]].focus.clone();
                    window.focus(&focus, cx);
                });
                for id in expected.iter().skip(1) {
                    cx.simulate_keystrokes("tab");
                    render_clinical_window(cx);
                    cx.update(|window, cx| {
                        assert!(
                            view.read(cx).patient_targets[*id].focus.is_focused(window),
                            "Tab reaches {id}"
                        )
                    });
                }
                for id in expected.iter().rev().skip(1) {
                    cx.simulate_keystrokes("shift-tab");
                    render_clinical_window(cx);
                    cx.update(|window, cx| {
                        assert!(
                            view.read(cx).patient_targets[*id].focus.is_focused(window),
                            "Shift+Tab reaches {id}"
                        )
                    });
                }
            }
        }
    }

    #[gpui::test]
    fn hcg2_connected_clean_shortcut_uses_reserved_status(cx: &mut gpui::TestAppContext) {
        cx.update(bind_keys);
        let host = notes_recovery_tests::Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.select_patient("patient-a", true, cx);
        });
        cx.run_until_parked();
        for width in [390., 800., 1200.] {
            for dark in [false, true] {
                cx.simulate_resize(gpui::size(px(width), px(840.)));
                view.update(cx, |app, cx| {
                    app.dark_override = Some(dark);
                    cx.notify();
                });
                cx.update_window_entity(&view, |app, window, cx| {
                    app.open_form(FormKind::Notes, window, cx)
                });
                render_clinical_window(cx);
                view.read_with(cx, |app, _| assert!(!app.core.is_dirty()));
                let before = [
                    cx.debug_bounds("threshold-bar"),
                    cx.debug_bounds("clinical-workspace-form-field-0-scroll-target"),
                ];
                cx.simulate_keystrokes(if cfg!(target_os = "macos") {
                    "cmd-enter"
                } else {
                    "ctrl-enter"
                });
                render_clinical_window(cx);
                let after = [
                    cx.debug_bounds("threshold-bar"),
                    cx.debug_bounds("clinical-workspace-form-field-0-scroll-target"),
                ];
                eprintln!("HC-G2 connected clean {width}/{dark}: {before:?} => {after:?}");
                assert_eq!(
                    before, after,
                    "clean shortcut must not move connected content"
                );
                assert!(cx.debug_bounds("clinical-workspace-review-save").is_none());
                assert!(cx.debug_bounds("clinical-workspace-message").is_none());
            }
        }
    }

    #[gpui::test]
    fn hcg2_clean_notes_close_rechecks_a_new_draft(cx: &mut gpui::TestAppContext) {
        let host = notes_recovery_tests::Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.select_patient("patient-a", true, cx);
        });
        cx.run_until_parked();
        cx.update_window_entity(&view, |app, window, cx| {
            app.open_form(FormKind::Notes, window, cx)
        });
        view.update(cx, |app, cx| {
            app.core.edit_notes("Nuova bozza sintetica".into()).unwrap();
            app.close_clean_notes(cx);
            assert!(matches!(app.discard, Some(Discard::Form)));
            assert!(app.form.is_some());
            assert_eq!(app.core.draft_notes(), "Nuova bozza sintetica");
            app.core.edit_notes("A: note iniziali".into()).unwrap();
            app.discard = None;
            app.close_clean_notes(cx);
            assert!(app.form.is_none());
        });
    }

    #[gpui::test]
    fn hcg2_connected_appearance_stacks_at_400_percent(cx: &mut gpui::TestAppContext) {
        cx.update(bind_keys);
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        for width in [390., 800., 1200.] {
            for dark in [false, true] {
                cx.simulate_resize(gpui::size(px(width), px(640.)));
                view.update(cx, |app, cx| {
                    app.login_scroll.set_offset(gpui::point(px(0.), px(0.)));
                    app.text_scale = 4.;
                    app.dark_override = Some(dark);
                    app.privacy_shield = false;
                    cx.notify();
                });
                render_clinical_window(cx);
                let mut bottom = px(0.);
                let mut extent = None;
                let mut line_height = None;
                let track = cx.debug_bounds("clinical-workspace-appearance").unwrap();
                for (_, id, label) in crate::components::APPEARANCE_CHOICES {
                    let segment = cx.debug_bounds(id).unwrap();
                    let label_id = match label {
                        "Aspetto di sistema" => "control-label:Aspetto di sistema",
                        "Giorno" => "control-label:Giorno",
                        _ => "control-label:Grafite",
                    };
                    let label = cx.debug_bounds(label_id).unwrap();
                    eprintln!("HC-G2 stacked {width}/{dark} {id}: {segment:?} label={label:?}");
                    assert!(
                        segment.top() >= bottom,
                        "three distinct rows, not a compressed horizontal row"
                    );
                    bottom = segment.bottom();
                    if let Some((left, right)) = extent {
                        assert_eq!((segment.left(), segment.right()), (left, right));
                    } else {
                        extent = Some((segment.left(), segment.right()));
                    }
                    assert_eq!(segment.left(), track.left() + px(3.));
                    assert_eq!(segment.right(), track.right() - px(3.));
                    if let Some(height) = line_height {
                        assert_eq!(label.size.height, height, "each label stays on one line");
                    } else {
                        line_height = Some(label.size.height);
                    }
                    assert!(label.left() >= segment.left() && label.right() <= segment.right());
                    assert!(
                        label.size.height <= px(84.),
                        "one line at 400%, not a wrapped label: {label:?}"
                    );
                }
                cx.update(|window, cx| {
                    window.activate_window();
                    let focus = view.read(cx).focus.clone();
                    window.focus(&focus, cx);
                });
                for _ in 0..if dark { 3 } else { 2 } {
                    cx.simulate_keystrokes("tab");
                    render_clinical_window(cx);
                }
                cx.simulate_keystrokes("enter");
                cx.simulate_event(gpui::KeyUpEvent {
                    keystroke: gpui::Keystroke::parse("enter").unwrap(),
                });
                cx.run_until_parked();
                render_clinical_window(cx);
                view.read_with(cx, |app, _| assert_eq!(app.dark_override, Some(dark)));
                let segment = cx
                    .debug_bounds(if dark {
                        "clinical-workspace-night-theme"
                    } else {
                        "clinical-workspace-day-theme"
                    })
                    .unwrap();
                let label = cx
                    .debug_bounds(if dark {
                        "control-label:Grafite"
                    } else {
                        "control-label:Giorno"
                    })
                    .unwrap();
                assert!(segment.top() >= px(0.) && segment.bottom() <= px(640.));
                assert!(label.top() >= segment.top() && label.bottom() <= segment.bottom());
                for (_, id, _) in crate::components::APPEARANCE_CHOICES {
                    let row = cx.debug_bounds(id).unwrap();
                    assert!(
                        row.top() >= px(0.) && row.bottom() <= px(640.),
                        "whole stacked control remains visible after keyboard activation: {id} {row:?}"
                    );
                }
            }
        }
    }
    use super::*;
    use gpui::Focusable;

    fn overview_accessible_rows(cx: &mut gpui::TestAppContext, kind: u8) {
        let mut app: Option<Entity<ClinicalApp>> = None;
        rendered_command::assert_unique_texts(
            cx,
            move |window, cx| {
                let app = app.get_or_insert_with(|| cx.new(|cx| {
                let mut app = ClinicalApp::new(String::new(), window, cx);
                let patient = serde_json::from_value(serde_json::json!({
                    "id":"synthetic-patient", "firstName":"Synthetic", "lastName":"Fixture",
                    "taxCode":"SYNTHETIC", "version":1,
                    "diagnoses": if kind == 0 { Some("[\"Synthetic one\",\"Synthetic two\"]") } else { None }
                })).unwrap();
                app.install_patient(patient);
                app.patient.therapies = ReadLoad::Ready(if kind == 1 { (0..2).map(|i|
                    serde_json::from_value(serde_json::json!({"id":format!("therapy-{i}"),
                        "patientId":"synthetic-patient", "drugName":"Synthetic drug", "dosage":"Synthetic dose",
                        "status":"active", "startDate":"2026-10-21", "version":1})).unwrap()).collect() } else { vec![] });
                app.patient.checkups = ReadLoad::Ready(if kind == 2 { (0..2).map(|i|
                    serde_json::from_value(serde_json::json!({"id":format!("checkup-{i}"),
                        "patientId":"synthetic-patient", "title":"Synthetic checkup", "date":"2026-10-21",
                        "status":"pending", "version":1})).unwrap()).collect() } else { vec![] });
                app
            }));
                app.update(cx, |app, cx| {
                    app.overview(app.patient.detail.ready().unwrap(), cx)
                        .into_any_element()
                })
            },
            if kind == 0 { 3 } else { 6 },
        );
    }

    #[gpui::test]
    fn overview_diagnoses_accessible_ids(cx: &mut gpui::TestAppContext) {
        overview_accessible_rows(cx, 0);
    }
    #[gpui::test]
    fn overview_therapies_accessible_ids(cx: &mut gpui::TestAppContext) {
        overview_accessible_rows(cx, 1);
    }
    #[gpui::test]
    fn overview_checkups_accessible_ids(cx: &mut gpui::TestAppContext) {
        overview_accessible_rows(cx, 2);
    }

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

    #[gpui::test]
    fn g1a2_admitted_copy_result_after_restore_contains_only_technical_state(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            synthetic_notes_form(app, FormState::Draft, cx);
            app.document_operation = DocumentOperation::Selecting;
            app.run_document_copy(|| Ok(()), cx);
            app.disconnect(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert_eq!(app.copy_state, Some(documents::CopyState::Finished(Ok(()))));
            assert!(app.copy_state.unwrap().notice().0.contains("completata"));
            assert!(app.session.is_none());
            assert!(app.form.is_none());
            assert!(app.selected_id.is_none());
            assert!(app.scope.is_none());
            assert!(app.patient.detail.ready().is_none());
            assert!(app.document_operation == DocumentOperation::Idle);
        });
    }

    #[gpui::test]
    fn g1a2_copy_failure_and_stale_picker_cannot_mutate_a_new_form(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let editor = view.update(cx, |app, cx| {
            let epoch = app.epoch;
            let authority = app.account_profile.generation;
            app.run_document_copy(|| Err(documents::DocumentError::NotWritten), cx);
            app.disconnect(cx);
            let editor = synthetic_notes_form(app, FormState::Draft, cx);
            app.message = Some(("Nuova bozza sintetica".into(), false));
            assert!(!app.accept_document_picker(epoch, authority, cx));
            editor
        });
        cx.run_until_parked();
        view.read_with(cx, |app, cx| {
            assert!(
                app.form
                    .as_ref()
                    .is_some_and(|form| form.kind == FormKind::Notes)
            );
            assert!(!editor.read(cx).value().is_empty());
            assert_eq!(app.message.as_ref().unwrap().0, "Nuova bozza sintetica");
            let (message, failed) = app.copy_state.unwrap().notice();
            assert!(failed);
            assert!(message.contains("parziale"));
        });
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
    fn g1a2_nested_restore_must_propagate_retirement() {
        assert_eq!(
            after_create_read::<()>(Err(RuntimeError::ArchiveReplaced), |_| true),
            Err(RuntimeError::ArchiveReplaced)
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
    fn diagnosis_row_ids_follow_technical_identity_and_hide_labels() {
        let before = diagnosis_labels(Some(r#"[{"id":"synthetic-record","description":"Original synthetic label"},{"code":"SYN","description":"Other label"},"Free text"]"#)).unwrap();
        let after = diagnosis_labels(Some(r#"["Free text",{"code":"SYN","description":"Changed label"},{"id":"synthetic-record","description":"Changed label"}]"#)).unwrap();
        for (left, right) in before.iter().zip(after.iter().rev()) {
            assert_eq!(
                left.0, right.0,
                "IDs follow data after reorder and label changes"
            );
            for forbidden in [
                "Original",
                "Changed",
                "Free text",
                "synthetic-record",
                "SYN",
            ] {
                assert!(!left.0.contains(forbidden));
            }
        }
    }

    #[gpui::test]
    fn overview_duplicate_diagnoses_accessible_ids(cx: &mut gpui::TestAppContext) {
        let mut app: Option<Entity<ClinicalApp>> = None;
        rendered_command::assert_unique_texts(
            cx,
            move |window, cx| {
                let app = app.get_or_insert_with(|| {
                    cx.new(|cx| ClinicalApp::new(String::new(), window, cx))
                });
                app.update(cx, |app, cx| {
                let patient = serde_json::from_value(serde_json::json!({"id":"synthetic-patient", "firstName":"Synthetic", "lastName":"Fixture", "taxCode":"SYNTHETIC", "version":1, "diagnoses":"[\"Repeated label\",\"Repeated label\"]"})).unwrap();
                app.overview(&patient, cx).into_any_element()
            })
            },
            3,
        );
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
            Ok(vec![(
                format!("clinical-overview-diagnosis-{}-0", text_identity("I10")),
                "I10 · Test sintetico".into()
            )])
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

    pub(super) fn synthetic_notes_form(
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
    struct ThresholdTestPlane {
        app: Entity<ClinicalApp>,
    }
    impl Render for ThresholdTestPlane {
        fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            self.app.update(cx, |app, cx| {
                let layout =
                    Layout::for_window(f32::from(window.viewport_size().width), app.text_scale);
                div()
                    .size_full()
                    .flex()
                    .flex_col()
                    .type_role(app.theme, crate::theme::TextRole::Body)
                    .text_color(app.theme.ink)
                    .child(
                        if app
                            .form
                            .as_ref()
                            .is_some_and(|form| form.kind == FormKind::PatientNew)
                        {
                            app.patient_creation_view(layout, cx)
                        } else {
                            app.profile_view(layout, cx)
                        },
                    )
            })
        }
    }

    #[gpui::test]
    fn hcg1_new_patient_confirmation_formats_the_entered_fields_and_accessible_recipient(
        cx: &mut gpui::TestAppContext,
    ) {
        let (root, cx) = cx.add_window_view(|window, cx| {
            let app = cx.new(|cx| ClinicalApp::new(String::new(), window, cx));
            app.update(cx, |app, cx| {
                app.stage_fields(FormKind::PatientNew, patient_forms::fields(None), None, cx);
                let form = app.form.as_mut().unwrap();
                form.fields[0]
                    .editor
                    .update(cx, |input, cx| input.set_content("Luca", cx));
                form.fields[1]
                    .editor
                    .update(cx, |input, cx| input.set_content("Conti", cx));
                form.state = FormState::Review;
            });
            ThresholdTestPlane { app }
        });
        let app = root.read_with(cx, |root, _| root.app.clone());
        for dark in [false, true] {
            app.update(cx, |app, cx| {
                app.theme = Theme::for_dark(dark);
                cx.notify();
            });
            render_clinical_window(cx);
            let (node, _) = rendered_command::node("clinical-workspace-confirm-save");
            assert_eq!(
                node.label(),
                Some("Conferma e registra nella scheda di Conti Luca")
            );
        }
    }

    #[gpui::test]
    fn threshold_full_plane_detail_returns_to_draft_instead_of_pointing_above(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            synthetic_notes_form(app, FormState::Review, cx);
            for kind in [FormKind::Therapy, FormKind::PatientNew, FormKind::Scale] {
                app.form.as_mut().unwrap().kind = kind;
                let full = app.threshold_detail_text(ThresholdMode::FullPlane);
                assert!(!full.contains("qui sopra"));
                assert_eq!(full, "Per rivedere il contenuto torna alla bozza. La registrazione sarà confermata soltanto dopo la rilettura.");
                for mode in [ThresholdMode::Complete, ThresholdMode::Compact] {
                    assert_eq!(app.threshold_detail_text(mode), "Controlla il contenuto qui sopra. La registrazione sarà confermata soltanto dopo la rilettura.");
                }
            }
        });
    }

    #[gpui::test]
    fn threshold_render_keeps_question_commands_and_focused_content_in_their_regions(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(bind_keys);
        let (root, cx) = cx.add_window_view(|window, cx| {
            let app = cx.new(|cx| ClinicalApp::new(String::new(), window, cx));
            app.update(cx, |app, cx| {
                let patient = serde_json::from_value(serde_json::json!({"id":"synthetic", "firstName":"Elena", "lastName":"Moretti", "taxCode":"SYNTHETIC", "notes":"", "version":1})).unwrap();
                app.install_patient(patient);
                let field = Field::new("threshold-fixture-notes", "Note", &"Testo sintetico lungo. ".repeat(180), true, false, app.theme, cx);
                app.form = Some(Form {kind:FormKind::Notes, fields:vec![field], upload:None, edit:None, patient_original:None, created_id:None, therapy:None, scale:None, state:FormState::Review, _subscriptions:vec![]});
            });
            ThresholdTestPlane { app }
        });
        let app = root.read_with(cx, |root, _| root.app.clone());
        for width in [390., 768., 1440.] {
            for scale in [1., 2., 4.] {
                cx.simulate_resize(gpui::size(px(width), px(700.)));
                app.update(cx, |app, cx| {
                    app.threshold_mode.set(ThresholdMode::Complete);
                    app.text_scale = scale;
                    app.theme = Theme::for_dark(false).sized(scale, false);
                    app.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
                    cx.notify();
                });
                render_clinical_window(cx);
                let bar = cx.debug_bounds("threshold-bar").unwrap();
                let confirm = cx.debug_bounds("clinical-workspace-confirm-save").unwrap();
                let question = cx.debug_bounds("threshold-question").unwrap();
                let back = cx.debug_bounds("threshold-back").unwrap();
                assert!(
                    question.bottom() <= back.top(),
                    "question before commands {width}/{scale}"
                );
                assert!(
                    if Layout::for_window(width, scale).compact {
                        back.bottom() <= confirm.top()
                    } else {
                        back.top() <= confirm.top()
                    },
                    "stable command order {width}/{scale}"
                );
                let full = app.read_with(cx, |app, _| {
                    app.threshold_mode.get() == ThresholdMode::FullPlane
                });
                if full {
                    assert_eq!(
                        cx.debug_bounds("threshold-full-plane").unwrap().size.height,
                        px(700.)
                    );
                    assert!(
                        cx.debug_bounds("threshold-scroll").is_none(),
                        "patient content hidden"
                    );
                    let detail = cx.debug_bounds("threshold-detail").unwrap();
                    assert!(
                        confirm.bottom() <= detail.top(),
                        "commands before detail {width}/{scale}"
                    );
                    cx.update(|window, cx| {
                        assert!(
                            app.read(cx).threshold_question.focus.is_focused(window),
                            "initial focus on question {width}/{scale}"
                        )
                    });
                    cx.simulate_keystrokes("tab");
                    render_clinical_window(cx);
                    cx.update(|window, cx| {
                        assert!(
                            app.read(cx).form_actions[2].focus.is_focused(window),
                            "question -> back"
                        )
                    });
                    cx.simulate_keystrokes("tab");
                    render_clinical_window(cx);
                    cx.update(|window, cx| {
                        assert!(
                            app.read(cx).form_actions[3].focus.is_focused(window),
                            "back -> confirm"
                        )
                    });
                    let reached = cx.debug_bounds("clinical-workspace-confirm-save").unwrap();
                    assert!(
                        reached.top() >= px(0.) && reached.bottom() <= px(700.1),
                        "confirm reached by Tab: {reached:?}"
                    );
                } else {
                    let scroll = cx.debug_bounds("threshold-scroll").unwrap();
                    assert_eq!(bar.bottom(), px(700.));
                    assert!(scroll.size.height > px(0.));
                    assert!(
                        bar.bottom() <= px(700.1) && bar.top() >= px(0.),
                        "anchored bar {width}/{scale}: {bar:?}"
                    );
                    assert!(scroll.bottom() <= bar.top(), "no overlap {width}/{scale}");
                    assert!(
                        confirm.bottom() <= px(700.1) && confirm.right() <= px(width + 0.1),
                        "command visible {width}/{scale}"
                    );
                    app.read_with(cx, |app, _| {
                        app.profile_scroll
                            .set_offset(gpui::point(px(0.), px(-100000.)))
                    });
                    render_clinical_window(cx);
                    assert_eq!(
                        cx.debug_bounds("threshold-bar").unwrap(),
                        bar,
                        "bar must not scroll {width}/{scale}"
                    );
                }
            }
        }
        cx.simulate_resize(gpui::size(px(390.), px(700.)));
        app.update(cx, |app, cx| {
            app.text_scale = 4.;
            app.theme = Theme::for_dark(false).sized(4., false);
            cx.notify();
        });
        render_clinical_window(cx);
        cx.simulate_keystrokes("escape");
        render_clinical_window(cx);
        app.read_with(cx, |app, _| {
            assert!(
                app.form.as_ref().unwrap().state == FormState::Draft,
                "Esc returns to draft"
            )
        });
        let scroll = cx.debug_bounds("threshold-scroll").unwrap();
        let bar = cx.debug_bounds("threshold-bar").unwrap();
        assert!(
            scroll.bottom() <= bar.top(),
            "draft content viewport excludes bar"
        );
    }
    #[gpui::test]
    fn threshold_recovery_reserves_content_with_larger_text_metrics(cx: &mut gpui::TestAppContext) {
        let (root, cx) = cx.add_window_view(|window, cx| {
            let app = cx.new(|cx| ClinicalApp::new(String::new(), window, cx));
            app.update(cx, |app, _| {
                app.install_patient(serde_json::from_value(serde_json::json!({"id":"synthetic","firstName":"Elena","lastName":"Moretti","taxCode":"SYNTHETIC","version":1})).unwrap());
                app.form = Some(Form {kind: FormKind::Scale, fields: vec![], upload: None, edit: None, patient_original: None, created_id: None, therapy: None, scale: None, state: FormState::Rejected, _subscriptions: vec![]});
            });
            ThresholdTestPlane { app }
        });
        let app = root.read_with(cx, |root, _| root.app.clone());
        cx.simulate_resize(gpui::size(px(390.), px(582.)));
        for body_size in [54., 56., 57.375] {
            app.update(cx, |app, cx| {
                app.text_scale = 4.;
                app.theme = Theme::for_dark(false).sized(4., false);
                app.theme.scale = body_size / Theme::for_dark(false).body();
                cx.notify();
            });
            render_clinical_window(cx);
            let content = cx.debug_bounds("threshold-scroll").unwrap();
            let bar = cx.debug_bounds("threshold-bar").unwrap();
            let minimum = px(body_size * 1.5);
            assert!(
                content.size.height >= minimum,
                "body={body_size} bar={bar:?} content={content:?}"
            );
            assert!(content.bottom() <= bar.top() && bar.bottom() <= px(582.));
            let region = cx.debug_bounds("threshold-recovery-region").unwrap();
            let title = cx.debug_bounds("threshold-recovery-title").unwrap();
            assert!(region.size.height > px(0.));
            let command = cx.debug_bounds("clinical-workspace-reconcile").unwrap();
            assert!(command.top() >= region.bottom() && command.bottom() <= bar.bottom());
            assert!(command.left() >= px(0.) && command.right() <= px(390.));
            cx.simulate_event(gpui::ScrollWheelEvent {
                position: region.center(),
                delta: gpui::ScrollDelta::Pixels(gpui::point(px(0.), px(-1000.))),
                modifiers: gpui::Modifiers::default(),
                touch_phase: gpui::TouchPhase::Moved,
            });
            render_clinical_window(cx);
            assert!(cx.debug_bounds("threshold-recovery-title").unwrap().top() < title.top());
            assert_eq!(
                cx.debug_bounds("clinical-workspace-reconcile").unwrap(),
                command
            );
            app.read_with(cx, |app, _| {
                assert_eq!(app.threshold_mode.get(), ThresholdMode::Compact)
            });
        }
    }

    #[gpui::test]
    fn threshold_non_destructive_states_keep_their_bar_above_the_fold(
        cx: &mut gpui::TestAppContext,
    ) {
        let (root,cx)=cx.add_window_view(|window,cx| {
            let app=cx.new(|cx|ClinicalApp::new(String::new(),window,cx));
            app.update(cx,|app,cx| {
                app.install_patient(serde_json::from_value(serde_json::json!({"id":"synthetic","firstName":"Elena","lastName":"Moretti","taxCode":"SYNTHETIC","version":1})).unwrap());
                let field=Field::new("state-fixture","Posologia","Una compressa al mattino",false,false,app.theme,cx).with_scroll(&app.profile_scroll,cx);
                app.form=Some(Form{kind:FormKind::Therapy,fields:vec![field],upload:None,edit:None,patient_original:None,created_id:None,therapy:None,scale:None,state:FormState::Draft,_subscriptions:vec![]});
            });
            ThresholdTestPlane{app}
        });
        let app = root.read_with(cx, |root, _| root.app.clone());
        for dark in [false, true] {
            for (width, scale) in [(390., 4.), (768., 2.), (1440., 1.)] {
                cx.simulate_resize(gpui::size(px(width), px(700.)));
                for state in [
                    FormState::Draft,
                    FormState::Saving,
                    FormState::Rejected,
                    FormState::Conflict,
                    FormState::Uncertain,
                ] {
                    app.update(cx, |app, cx| {
                        app.form.as_mut().unwrap().state = state;
                        app.text_scale = scale;
                        app.theme = Theme::for_dark(dark).sized(scale, false);
                        cx.notify();
                    });
                    render_clinical_window(cx);
                    let bar = cx.debug_bounds("threshold-bar").unwrap();
                    let scroll = cx.debug_bounds("threshold-scroll").unwrap();
                    let inline =
                        app.read_with(cx, |app, _| app.threshold_scrolls_with_content.get());
                    if inline {
                        assert_eq!(scroll.size.height, px(700.));
                        assert!(bar.top() >= scroll.top());
                    } else {
                        assert_eq!(bar.bottom(), px(700.));
                        assert!(bar.top() >= px(0.) && scroll.bottom() <= bar.top());
                    }
                    assert!(scroll.size.height > px(0.));
                    app.read_with(cx, |app, _| {
                        app.profile_scroll
                            .set_offset(gpui::point(px(0.), px(-100000.)))
                    });
                    render_clinical_window(cx);
                    if inline {
                        assert!(cx.debug_bounds("threshold-bar").unwrap().top() < bar.top());
                    } else {
                        assert_eq!(cx.debug_bounds("threshold-bar").unwrap(), bar);
                    }
                }
            }
        }
        app.update(cx, |app, cx| {
            app.form.as_mut().unwrap().state = FormState::Draft;
            app.text_scale = 4.;
            app.theme = Theme::for_dark(false).sized(4., false);
            app.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
            cx.notify();
        });
        cx.simulate_resize(gpui::size(px(390.), px(700.)));
        render_clinical_window(cx);
        let (editor, anchor) = app.read_with(cx, |app, _| {
            let field = &app.form.as_ref().unwrap().fields[0];
            (
                field.editor.clone(),
                field.scroll_target.as_ref().unwrap().anchor.clone(),
            )
        });
        cx.update_window_entity(&editor, |input, window, cx| input.focus(window, cx));
        cx.update(|window, cx| anchor.scroll_to(window, cx));
        render_clinical_window(cx);
        let input = cx
            .debug_bounds("clinical-workspace-form-field-0-scroll-target")
            .unwrap();
        let bar = cx.debug_bounds("threshold-bar").unwrap();
        assert!(
            input.top() >= px(0.) && input.bottom() <= bar.top(),
            "focused input above bar: {input:?}, {bar:?}"
        );
        app.update(cx, |app, cx| {
            app.form = None;
            app.verified = Some("Registrazione verificata nell’archivio sintetico.".into());
            app.text_scale = 4.;
            app.theme = Theme::for_dark(false).sized(4., false);
            cx.notify();
        });
        cx.simulate_resize(gpui::size(px(390.), px(700.)));
        render_clinical_window(cx);
        let bar = cx.debug_bounds("threshold-bar").unwrap();
        assert!(bar.top() >= px(0.) && bar.bottom() == px(700.));
    }
    struct ReviewTitleCallers {
        app: Entity<ClinicalApp>,
        mode: u8,
    }
    impl Render for ReviewTitleCallers {
        fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            self.app.update(cx, |app, cx| {
                let layout =
                    Layout::for_window(f32::from(window.viewport_size().width), app.text_scale);
                let content = match self.mode {
                    0 => app.login_view(layout, cx).into_any_element(),
                    1 => app.preview(cx).into_any_element(),
                    2 => app.profile_view(layout, cx).into_any_element(),
                    3 => app.form_view(cx).into_any_element(),
                    5 => app.scales_view(cx).into_any_element(),
                    6 => app.directory_view(layout, cx).into_any_element(),
                    _ => app.settings_view(layout, cx).into_any_element(),
                };
                div()
                    .size_full()
                    .type_role(app.theme, crate::theme::TextRole::Body)
                    .child(content)
            })
        }
    }
    #[gpui::test]
    fn hcg4_review_real_clinical_callers_keep_accessible_titles(cx: &mut gpui::TestAppContext) {
        let (root,cx)=cx.add_window_view(|window,cx| {
            let app=cx.new(|cx| {
                let mut app=ClinicalApp::new(String::new(),window,cx);
                let patient=serde_json::from_value(serde_json::json!({"id":"synthetic-title-patient","firstName":"Elena","lastName":"Schwarzenegger","taxCode":"RSSMRA80A01H501U","version":1})).unwrap();
                app.install_patient(patient);
                app.patients=Load::Ready(vec![serde_json::from_value(serde_json::json!({"id":"synthetic-title-patient","firstName":"Elena","lastName":"Schwarzenegger","taxCode":"RSSMRA80A01H501U","version":1})).unwrap()]);
                scales::tests::stage_title_catalog_fixture(&mut app, cx);
                let therapy=editing::Record::Therapy(serde_json::from_value(serde_json::json!({"id":"synthetic-therapy","patientId":"synthetic-title-patient","drugName":"Prova","dosage":"Prova","status":"active","startDate":"2026-10-29","version":1})).unwrap());
                app.stage_fields(FormKind::Therapy,therapy.fields(),Some(therapy),cx);app
            });ReviewTitleCallers {app,mode:0}
        });
        for scale in [1., 2., 4.] {
            for (mode, expected) in [
                (0, "Collega questo dispositivo"),
                (1, "Schwarzenegger Elena"),
                (2, "Schwarzenegger Elena"),
                (3, "Modifica terapia"),
                (4, "Impostazioni"),
                (5, "Schwarzenegger Elena"),
                (6, "Schwarzenegger Elena"),
            ] {
                root.update(cx, |root, cx| {
                    root.mode = mode;
                    root.app.update(cx, |app, cx| {
                        app.text_scale = scale;
                        app.theme = Theme::for_dark(false).sized(scale, false);
                        cx.notify();
                    });
                    cx.notify();
                });
                cx.simulate_resize(gpui::size(px(390.), px(1800.)));
                crate::title::take_title_nodes();
                cx.update(|window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                });
                let nodes = crate::title::take_title_nodes();
                assert!(
                    nodes
                        .iter()
                        .any(|(_, node, _, _)| node.value() == Some(expected)),
                    "caller {mode}: {expected}"
                );
                let mut ids = std::collections::HashSet::new();
                for (id, node, _, _) in nodes {
                    assert!(ids.insert(id), "duplicate title node");
                    assert!(node.value().is_some());
                }
            }
        }
    }
}

#[cfg(test)]
mod review706b_callers {
    use super::*;
    #[cfg(target_os = "macos")]
    struct Fixture {
        app: Entity<ClinicalApp>,
        mode: u8,
    }
    #[cfg(target_os = "macos")]
    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            self.app.update(cx, |app, cx| {
                let content = match self.mode {
                    0 => app.preview(cx).into_any_element(),
                    1 => app.agenda_view(true, cx),
                    2 => app.global_diary_view(cx).into_any_element(),
                    4 => app
                        .directory_view(Layout::for_window(350., 4.), cx)
                        .into_any_element(),
                    _ => section("independent-section", "DATI ANAGRAFICI", app.theme)
                        .into_any_element(),
                };
                div()
                    .size_full()
                    .type_role(app.theme, crate::theme::TextRole::Body)
                    .child(content)
            })
        }
    }
    fn make_app(window: &mut Window, cx: &mut Context<ClinicalApp>) -> ClinicalApp {
        let mut app = ClinicalApp::new(String::new(), window, cx);
        let patient = serde_json::json!({"id":"review706b-patient","firstName":"","lastName":"Schwarzenegger","taxCode":"RSSMRA80A01H501U","version":1});
        app.install_patient(serde_json::from_value(patient.clone()).unwrap());
        app.global_patients = ReadLoad::Ready(vec![serde_json::from_value(patient).unwrap()]);
        app.agenda=ReadLoad::Ready(vec![serde_json::from_value(serde_json::json!({"id":"review706b-control","patientId":"review706b-patient","version":1,"date":"2099-10-29","title":"Controllo sintetico","status":"pending"})).unwrap()]);
        app.agenda_flow.targets.insert(
            "review706b-control".into(),
            ScrollTarget::new(&app.area_scroll, cx),
        );
        app.global_entries=Load::Ready(vec![serde_json::from_value(serde_json::json!({"id":"review706b-entry","patientId":"review706b-patient","version":1,"date":"2026-10-27","title":"Nota sintetica","type":"note","content":"Prova"})).unwrap()]);
        app.theme = Theme::for_dark(false).sized(2., false);
        app.text_scale = 2.;
        app
    }
    struct Hcg5Page {
        app: Entity<ClinicalApp>,
    }
    impl Render for Hcg5Page {
        fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            self.app.update(cx, |app, cx| {
                let layout =
                    Layout::for_window(f32::from(window.viewport_size().width), app.text_scale);
                div()
                    .size_full()
                    .flex()
                    .flex_col()
                    .type_role(app.theme, crate::theme::TextRole::Body)
                    .child(if app.area == Area::Patients {
                        app.profile_view(layout, cx).into_any_element()
                    } else if app.area == Area::References {
                        app.references_view(cx).into_any_element()
                    } else if app.area == Area::Analytics {
                        app.analytics_view(cx).into_any_element()
                    } else {
                        app.area_view(layout, cx).into_any_element()
                    })
            })
        }
    }
    #[gpui::test]
    fn hcg5_page_inks_and_fields_contrast(cx: &mut gpui::TestAppContext) {
        let (view, cx) = cx.add_window_view(|window, cx| Hcg5Page {
            app: cx.new(|cx| make_app(window, cx)),
        });
        let mut failures = Vec::new();
        for dark in [false, true] {
            let theme = Theme::for_dark(dark);
            for (area, confirm) in [
                (Area::Agenda, false),
                (Area::Diary, false),
                (Area::Patients, false),
                (Area::Settings, false),
                (Area::References, false),
                (Area::Analytics, false),
                (Area::Patients, true),
            ] {
                view.update(cx, |v, cx| {
                    v.app.update(cx, |app, cx| {
                        app.area = area;
                        app.theme = theme;
                        app.text_scale = 1.;
                        app.form = None;
                        if confirm {
                            let record=editing::Record::Checkup(serde_json::from_value(serde_json::json!({"id":"synthetic-checkup","patientId":"review706b-patient","version":1,"date":"2099-10-29","title":"Controllo sintetico","status":"pending"})).unwrap());
                            app.stage_fields(FormKind::Checkup,record.fields(),Some(record),cx);
                            app.form.as_mut().unwrap().state=FormState::Review;
                        }

                        cx.notify();
                    })
                });
                cx.simulate_resize(gpui::size(px(1200.), px(14000.)));
                let _probe = rendered_command::begin_inks();
                rendered_command::take_fields();
                let (quads, scale) = cx.update(|w, cx| {
                    w.refresh();
                    w.draw(cx).clear(cx);
                    (w.painted_quads(), w.scale_factor())
                });
                let inks = rendered_command::painted_contrasts(
                    rendered_command::take_inks(),
                    &quads,
                    scale,
                );
                let fields = rendered_command::take_fields();
                assert!(!inks.is_empty());
                if area == Area::Agenda {
                    for label in [
                        "Dal (AAAA-MM-GG)",
                        "Al (AAAA-MM-GG)",
                        "Intervallo applicato: tutte le date.",
                        "Agenda letta",
                        "Schwarzenegger",
                        "Controllo sintetico",
                        "Interfaccia corrente…",
                        "Applica intervallo",
                    ] {
                        assert!(
                            inks.iter().any(|(text, _)| text == label),
                            "missing observed text {label}: {inks:?}"
                        );
                    }
                    assert!(fields.len() >= 3, "date and search fields must render");
                }
                println!(
                    "INKS dark={dark} confirmation={confirm}: {} texts, {} fields",
                    inks.len(),
                    fields.len()
                );
                for (label, ratio) in inks {
                    if area == Area::Agenda {
                        println!("AGENDA dark={dark} {label:?} text={ratio:.2}");
                    }
                    if ratio < 4.5 {
                        failures.push(format!("dark={dark} {label:?}: text {ratio:.2}"));
                    }
                }
                for (label, ink, paper, border) in fields {
                    let ratio = rendered_command::contrast(ink.to_rgb(), paper.to_rgb());
                    let stroke = rendered_command::contrast(border.to_rgb(), paper.to_rgb());
                    println!("FIELD dark={dark} {label:?} text={ratio:.2} stroke={stroke:.2}");
                    if ratio < 4.5 || stroke < 3. || paper != theme.paper {
                        failures.push(format!("dark={dark} {label}: field text={ratio:.2} border={stroke:.2} theme={}",paper==theme.paper));
                    }
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[gpui::test]
    fn hcg5_contrast_rejects_invisible_text(cx: &mut gpui::TestAppContext) {
        struct Fixture {
            mode: u8,
        }
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let theme = Theme::for_dark(true);
                div()
                    .size_full()
                    .reading_surface(theme)
                    .relative()
                    .child(
                        div()
                            .opacity(if self.mode == 1 {
                                0.
                            } else if self.mode == 3 {
                                0.05
                            } else {
                                1.
                            })
                            .text_color(if self.mode == 0 {
                                theme.paper
                            } else {
                                theme.ink
                            })
                            .child(rendered_command::observe_ink(gpui::text!(
                                "Testo da verificare"
                            ))),
                    )
                    .when(self.mode == 2, |el| {
                        el.child(div().absolute().inset_0().bg(theme.paper))
                    })
            }
        }
        let (view, cx) = cx.add_window_view(|_, _| Fixture { mode: 0 });
        for mode in 0..4 {
            view.update(cx, |v, cx| {
                v.mode = mode;
                cx.notify();
            });
            let _probe = rendered_command::begin_inks();
            let (quads, scale) = cx.update(|w, cx| {
                w.refresh();
                w.draw(cx).clear(cx);
                (w.painted_quads(), w.scale_factor())
            });
            let samples =
                rendered_command::painted_contrasts(rendered_command::take_inks(), &quads, scale);
            assert_eq!(samples.len(), 1);
            assert!(
                samples[0].1 < 4.5,
                "invisible mode {mode} escaped: {samples:?}"
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn hcg5_real_page_margins(cx: &mut gpui::TestAppContext) {
        let mut native = gpui::TestAppContext::build_with_text_system(
            cx.dispatcher.clone(),
            None,
            std::sync::Arc::new(gpui_apple::AppleTextSystem::new()),
        );
        let (view, cx) = native.add_window_view(|window, cx| Hcg5Page {
            app: cx.new(|cx| make_app(window, cx)),
        });
        for dark in [false, true] {
            for scale in [1., 2., 4.] {
                for width in [390., 420., 800.] {
                    for (area, heading) in [
                        (Area::Agenda, "Agenda"),
                        (Area::Diary, "Diario generale"),
                        (Area::Settings, "Impostazioni"),
                        (Area::Patients, "Schwarzenegger"),
                    ] {
                        view.update(cx, |v, cx| {
                            v.app.update(cx, |app, cx| {
                                app.area = area;
                                app.text_scale = scale;
                                app.theme = Theme::for_dark(dark).sized(scale, false);
                                cx.notify();
                            })
                        });
                        cx.simulate_resize(gpui::size(px(width), px(14000.)));
                        crate::title::take_title_nodes();
                        crate::title::take_title_lines();
                        cx.update(|w, cx| {
                            w.refresh();
                            w.draw(cx).clear(cx);
                        });
                        let nodes = crate::title::take_title_nodes();
                        let (_, _, bounds, _) = nodes
                            .iter()
                            .find(|(_, n, _, _)| n.value() == Some(heading))
                            .expect("page heading");
                        let margin = if width / scale < 700. { 16. } else { 28. };
                        assert_eq!(
                            bounds.origin.x,
                            px(margin),
                            "{heading}/{width}/{scale}/{dark}"
                        );
                        if area == Area::Agenda {
                            let status = cx
                                .debug_bounds("clinical-workspace-agenda-update")
                                .expect("agenda status");
                            assert_eq!(status.origin.x, px(margin));
                            println!(
                                "HCG5_POSITION {width} {scale} {dark} {}",
                                f32::from(status.origin.y)
                            );
                            let (_, _, bounds, _) = nodes
                                .iter()
                                .find(|(_, n, _, _)| n.value() == Some("OGGI E PROSSIMI · 1"))
                                .expect("counted section");
                            assert_eq!(bounds.origin.x, px(margin));
                            let lines = crate::title::take_title_lines();
                            let (_, lines) = lines
                                .iter()
                                .find(|(label, _)| label == "OGGI E PROSSIMI · 1")
                                .unwrap();
                            assert!(
                                lines.iter().any(|l| l.contains("PROSSIMI · 1")),
                                "{width}/{scale}/{dark}: {lines:?}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn actual_preview_304(cx: &mut gpui::TestAppContext) {
        let mut native = gpui::TestAppContext::build_with_text_system(
            cx.dispatcher.clone(),
            None,
            std::sync::Arc::new(gpui_apple::AppleTextSystem::new()),
        );
        native.update(|cx| {
            cx.text_system()
                .add_fonts(vec![std::borrow::Cow::Borrowed(include_bytes!(
                    "../../../../app/fonts/Newsreader-Native-Regular.ttf"
                ))])
                .unwrap()
        });
        let (_, cx) = native.add_window_view(|window, cx| Fixture {
            app: cx.new(|cx| make_app(window, cx)),
            mode: 0,
        });
        cx.simulate_resize(gpui::size(px(304.), px(900.)));
        crate::title::take_title_nodes();
        cx.update(|w, cx| {
            w.refresh();
            w.draw(cx).clear(cx);
        });
        let nodes = crate::title::take_title_nodes();
        let (_, node, bounds, glyph_width) = nodes
            .iter()
            .find(|(_, n, _, _)| n.value() == Some("Schwarzenegger"))
            .expect("actual preview uses shared accessible title");
        println!(
            "ACTUAL PREVIEW {:?} bounds={bounds:?} glyph={glyph_width:?}",
            node.value()
        );
        assert!(bounds.right() <= px(280.));
        assert!(*glyph_width <= px(255.));
        assert!(
            bounds.size.height
                <= px(Theme::for_dark(false)
                    .sized(2., false)
                    .role(TypeRole::PersonPreview)
                    .line_height
                    + 1.)
        );
    }
    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn all_actual_callers_use_common_renderer(cx: &mut gpui::TestAppContext) {
        let mut native = gpui::TestAppContext::build_with_text_system(
            cx.dispatcher.clone(),
            None,
            std::sync::Arc::new(gpui_apple::AppleTextSystem::new()),
        );
        let (view, cx) = native.add_window_view(|window, cx| Fixture {
            app: cx.new(|cx| make_app(window, cx)),
            mode: 1,
        });
        let mut missing = Vec::new();
        for (mode, label) in [(1, "Agenda"), (2, "Diario generale"), (3, "Sezione")] {
            view.update(cx, |v, cx| {
                v.mode = mode;
                v.app.update(cx, |app, cx| {
                    app.theme = Theme::for_dark(false).sized(4., false);
                    app.text_scale = 4.;
                    cx.notify();
                });
                cx.notify();
            });
            cx.simulate_resize(gpui::size(px(390.), px(2400.)));
            crate::title::take_title_nodes();
            cx.update(|w, cx| {
                w.refresh();
                w.draw(cx).clear(cx);
            });
            let nodes = crate::title::take_title_nodes();
            let expected = if mode == 3 {
                "DATI ANAGRAFICI"
            } else {
                "Schwarzenegger"
            };
            println!(
                "ACTUAL CALLER {label}: title nodes={:?}",
                nodes
                    .iter()
                    .map(|(_, n, _, _)| n.value())
                    .collect::<Vec<_>>()
            );
            if mode == 1 {
                println!(
                    "AGENDA NAME bounds={:?}",
                    cx.debug_bounds("agenda-name-review706b-control")
                );
            }
            if !nodes.iter().any(|(_, n, _, _)| n.value() == Some(expected)) {
                missing.push(label);
            }
        }
        assert!(
            missing.is_empty(),
            "real callers bypass common renderer: {missing:?}"
        );
    }
    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn actual_directory_name_string_boundary_stays_protected(cx: &mut gpui::TestAppContext) {
        let mut native = gpui::TestAppContext::build_with_text_system(
            cx.dispatcher.clone(),
            None,
            std::sync::Arc::new(gpui_apple::AppleTextSystem::new()),
        );
        let (_, cx) = native.add_window_view(|window, cx| {
            let app = cx.new(|cx| {
                let mut app = make_app(window, cx);
                let source: String = "Elettroencefalografico".to_owned();
                let patient = serde_json::json!({"id":"string-patient", "firstName":"", "lastName": source,"taxCode":"RSSMRA80A01H501U","version":1});
                app.patients = Load::Ready(vec![serde_json::from_value(patient).unwrap()]);
                app.theme = Theme::for_dark(false).sized(4., false); app.text_scale = 4.;
                app
            });
            Fixture { app, mode: 4 }
        });
        cx.simulate_resize(gpui::size(px(350.), px(1400.)));
        crate::title::take_title_nodes();
        crate::title::take_title_lines();
        cx.update(|w, cx| {
            w.refresh();
            w.draw(cx).clear(cx);
        });
        let nodes = crate::title::take_title_nodes();
        let (_, _, bounds, width) = nodes
            .iter()
            .find(|(_, n, _, _)| n.value() == Some("Elettroencefalografico"))
            .expect("real directory name");
        assert!(bounds.right() <= px(350.) && *width <= px(350.));
        let lines = crate::title::take_title_lines();
        let (_, lines) = lines
            .iter()
            .find(|(name, _)| name == "Elettroencefalografico")
            .unwrap();
        assert!(
            !lines.join("").contains('-'),
            "name string boundary acquired prose hyphenation: {lines:?}"
        );
        assert_eq!(lines.join(""), "Elettroencefalografico");
    }
}
