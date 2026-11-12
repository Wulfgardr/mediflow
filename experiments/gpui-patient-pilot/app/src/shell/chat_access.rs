use super::generation::ChatArea;
use super::*;
use crate::chat_access::references::{CommandReferences, ReferenceScan};
use crate::chat_access::{
    self,
    owner::{Function, Pending, Stage, State},
};
use mediflow_runtime_client::{ChatWriteOutcome, ChatWriteResolution};
use std::{collections::BTreeMap, time::Duration};

pub(super) struct ChatAccess {
    pub(super) voice: super::local_voice::LocalVoice,
    listener: Option<chat_access::Listener>,
    references: CommandReferences,
    recovery_messages: BTreeMap<String, ChatWriteResolution>,
    /// Commands the server confirmed whose local reference could not be
    /// removed. They stay known until the cleanup succeeds, so the scan that
    /// still finds the file never turns them into an uncertain outcome.
    cleanup_failed: BTreeMap<String, ChatWriteOutcome>,
    recovery_namespace: Option<String>,
    recovery_error: bool,
    recovery_busy: bool,
    owner: Option<(String, RuntimeSession)>,
    recovery_epoch: u64,
    pub(super) pending: Option<Pending>,
    patient: mediflow_patient_client::PersonName,
    archive: String,
    pin: Entity<TextInput>,
    excerpt: Entity<TextInput>,
    booking: Entity<TextInput>,
    task: Option<gpui::Task<()>>,
    message: Option<String>,
    last_state: Option<(State, bool)>,
}

impl ChatAccess {
    pub(super) fn new(
        theme: Theme,
        directory: Option<std::path::PathBuf>,
        cx: &mut Context<ClinicalApp>,
    ) -> Self {
        Self {
            voice: super::local_voice::LocalVoice::new(theme, cx),
            listener: chat_access::Listener::configured(),
            references: CommandReferences::new(directory),
            recovery_messages: BTreeMap::new(),
            cleanup_failed: BTreeMap::new(),
            recovery_namespace: None,
            recovery_error: false,
            recovery_busy: false,
            owner: None,
            recovery_epoch: 0,
            pending: None,
            patient: mediflow_patient_client::PersonName::default(),
            archive: String::new(),
            excerpt: cx.new(|cx| {
                TextInput::new(
                    "chat-clinical-excerpt",
                    "Copia qui un passo delle note",
                    "Passo delle note",
                    true,
                    theme,
                    cx,
                )
            }),
            booking: cx.new(|cx| {
                TextInput::new(
                    "chat-booking-date",
                    "Data e ora del controllo",
                    "GG/MM/AAAA HH:MM",
                    false,
                    theme,
                    cx,
                )
            }),
            pin: cx.new(|cx| {
                TextInput::new(
                    "chat-access-pin",
                    "PIN di conferma",
                    "PIN",
                    false,
                    theme,
                    cx,
                )
                .secret()
            }),
            task: None,
            message: None,
            last_state: None,
        }
    }
    fn owns_session(&self, session: &RuntimeSession) -> bool {
        self.owner.as_ref().is_some_and(|(namespace, owner)| {
            !owner.is_locked()
                && !session.is_locked()
                && *namespace == session.chat_write_reference_namespace()
        })
    }
    fn unattached_commands(&self, session: &RuntimeSession) -> std::io::Result<ReferenceScan> {
        let active = self
            .pending
            .as_ref()
            .filter(|_| self.owns_session(session))
            .and_then(|p| {
                p.lock().ok().and_then(|p| {
                    p.therapy()
                        .and_then(|t| t.selected.as_ref().map(|s| s.1.clone()))
                })
            });
        let mut scan = self.references.for_session(session).scan()?;
        scan.ids.retain(|id| Some(id) != active.as_ref());
        Ok(scan)
    }
    pub(super) fn detach(&mut self, cx: &mut App) {
        self.retire(cx);
        if let Some(pending) = self.pending.take()
            && let Ok(mut pending) = pending.lock()
        {
            pending.detach();
        }
        self.owner = None;
    }
    pub(super) fn retire(&mut self, cx: &mut App) {
        self.voice.retire(cx);
        if let Some(pending) = self.pending.as_ref()
            && let Ok(mut pending) = pending.lock()
        {
            pending.withdraw();
        }
        if self.pending.as_ref().is_some_and(|p| {
            p.lock().is_ok_and(|mut p| {
                matches!(
                    p.status(),
                    State::Withdrawn | State::Write(ChatWriteResolution::Confirmed(_))
                )
            })
        }) {
            self.pending = None;
        }
        self.patient = mediflow_patient_client::PersonName::default();
        self.archive.clear();
        self.excerpt
            .update(cx, |input, cx| input.set_content("", cx));
        self.booking
            .update(cx, |input, cx| input.set_content("", cx));
        self.last_state = None;
        self.recovery_messages.clear();
        self.cleanup_failed.clear();
        self.recovery_namespace = None;
        self.recovery_error = false;
        self.recovery_busy = false;
        self.recovery_epoch = self.recovery_epoch.wrapping_add(1);
        self.message = None;
        self.pin.update(cx, |input, cx| input.set_content("", cx));
    }
}

fn booking_omitted_notice(omitted: u64) -> String {
    if omitted == 1 {
        "Mostrati i 20 controlli più vicini a oggi. Un altro controllo futuro non è in elenco: lo trovi nella cartella.".into()
    } else {
        format!(
            "Mostrati i 20 controlli più vicini a oggi. Altri {omitted} controlli futuri non sono in elenco: li trovi nella cartella."
        )
    }
}

/// Local date, time and state of each checkup the booking view read; no titles or notes.
fn booking_agenda_lines(agenda: &mediflow_runtime_client::ChatBookingView) -> Vec<String> {
    agenda
        .rows
        .iter()
        .filter_map(|(date, status)| {
            let local = chrono::DateTime::parse_from_rfc3339(date)
                .ok()?
                .with_timezone(&chrono::Local);
            let state = match status.as_str() {
                "pending" => "da svolgere",
                "completed" => "completato",
                "cancelled" => "annullato",
                _ => return None,
            };
            Some(format!("{} · {state}", local.format("%d/%m/%Y %H:%M")))
        })
        .collect()
}

fn catalog_copy(prosthetics: bool) -> (&'static str, &'static str) {
    if prosthetics {
        (
            "Mostra protesica e ausili nella vista della chat?",
            "Ricerca nel repertorio protesico locale, in sola lettura. Controlla query e risultati sotto. La data di aggiornamento non è verificata. Conferma una sola consultazione entro 30 secondi; nessuna prescrizione o invio al modello.",
        )
    } else {
        (
            "Mostra i farmaci nella vista della chat?",
            "Ricerca nel catalogo AIFA locale, in sola lettura. Controlla query e risultati sotto. La data di aggiornamento non è verificata. Conferma una sola consultazione entro 30 secondi; nessuna prescrizione o invio al modello.",
        )
    }
}

impl ClinicalApp {
    pub(super) fn chat_function_view(&self, cx: &Context<Self>) -> Option<Div> {
        match self.patient.chat_function? {
            Function::Insight => Some(self.patient_insight_view(cx)),
            Function::Synthesis => Some(self.documents_view(cx)),
            Function::Import => Some(self.smart_import_view(cx)),
            Function::OpenLoops
                if self
                    .selected_id
                    .as_deref()
                    .is_some_and(|id| self.open_loops.patient_is(id)) =>
            {
                Some(self.open_loops_view(cx))
            }
            Function::OpenLoops => None,
            Function::EvidenceQueue
                if self
                    .selected_id
                    .as_deref()
                    .is_some_and(|id| self.evidence_queue.patient_is(id)) =>
            {
                Some(self.evidence_queue_view(cx))
            }
            Function::EvidenceQueue => None,
            Function::ServiceMatching
                if self
                    .selected_id
                    .as_deref()
                    .is_some_and(|id| self.service_matching.patient_is(id)) =>
            {
                Some(self.service_matching_view(cx))
            }
            Function::ServiceMatching => None,
            Function::Icd
                if self
                    .selected_id
                    .as_deref()
                    .is_some_and(|id| self.who.patient_is(id)) =>
            {
                Some(self.who_view(cx))
            }
            Function::Icd => None,
        }
    }

    fn show_chat_function(&mut self, function: Function, cx: &mut Context<Self>) {
        for other in Function::ALL {
            if other != function {
                self.chat_area(other).close_view();
            }
        }
        self.area = Area::Patients;
        self.directory = false;
        self.show_other = false;
        self.focus_after_render = true;
        let section = match function {
            Function::Insight
            | Function::Icd
            | Function::OpenLoops
            | Function::EvidenceQueue
            | Function::ServiceMatching => PatientSection::Overview,
            Function::Synthesis | Function::Import => PatientSection::Documents,
        };
        if self.patient_section != section {
            self.section_selected(section, cx);
        }
        if function == Function::Synthesis {
            self.patient.document_details_id = self.patient.synthesis.document.clone();
        }
        self.patient.chat_function = Some(function);
    }
    /// L'area della funzione che la chat chiede: ogni funzione ha la sua,
    /// con il suo legame.
    fn chat_area(&mut self, function: Function) -> &mut dyn ChatArea {
        match function {
            Function::Insight => &mut self.patient.insight,
            Function::Synthesis => &mut self.patient.synthesis.area,
            Function::Import => &mut self.patient.smart_import,
            Function::Icd => &mut self.who,
            Function::OpenLoops => &mut self.open_loops,
            Function::EvidenceQueue => &mut self.evidence_queue,
            Function::ServiceMatching => &mut self.service_matching,
        }
    }

    pub(super) fn open_chat_function(
        &mut self,
        pending: &Pending,
        function: Function,
        cx: &mut Context<Self>,
    ) {
        let binding = self
            .session
            .as_ref()
            .filter(|session| !session.is_locked())
            .filter(|_| {
                self.chat_access.pending.is_none()
                    && !self.chat_access.voice.is_open()
                    && !self.patient_document.is_open()
                    && self.form.is_none()
                    && !self.local_work_pending()
                    && !self.privacy_shield
            })
            .and_then(|session| {
                let scope = self.scope.as_deref()?;
                let patient = self.patient.detail.ready()?;
                if self.selected_id.as_deref() != Some(patient.id.as_str()) {
                    return None;
                }
                Some((
                    session.clone(),
                    session.chat_access_context(scope, &patient.id).ok()?,
                    patient.id.clone(),
                ))
            });
        let Some((session, context, patient_id)) = binding else {
            if let Ok(mut pending) = pending.lock() {
                pending.withdraw();
            }
            cx.notify();
            return;
        };
        if !pending.lock().is_ok_and(|mut pending| {
            pending.function_requested(function) && pending.bind(session, context)
        }) {
            if let Ok(mut pending) = pending.lock() {
                pending.withdraw();
            }
            cx.notify();
            return;
        }
        let occupied = self.chat_area(function).occupied();
        let access = self.local_host.access();
        let early = if occupied {
            Some(Stage::Busy)
        } else if access.is_none()
            && !matches!(
                function,
                Function::Icd
                    | Function::OpenLoops
                    | Function::EvidenceQueue
                    | Function::ServiceMatching
            )
        {
            Some(Stage::Unavailable)
        } else {
            None
        };
        if let Some(stage) = early {
            if stage == Stage::Busy && self.chat_area(function).can_show() {
                self.show_chat_function(function, cx);
            }
            if let Ok(mut pending) = pending.lock() {
                pending.finish_function_open(stage);
            }
            cx.notify();
            return;
        }
        let ticket = self.chat_area(function).hold(pending.clone());
        let admitting = pending.clone();
        let target = pending.clone();
        self.run(
            move || {
                if !chat_access::owner::admit_function(&admitting) {
                    return Ok(None);
                }
                let enabled = match function {
                    Function::Insight
                    | Function::Icd
                    | Function::OpenLoops
                    | Function::EvidenceQueue
                    | Function::ServiceMatching => true,
                    Function::Synthesis => access
                        .unwrap()
                        .document_synthesis_enabled()
                        .unwrap_or(false),
                    Function::Import => access.unwrap().smart_import_enabled().unwrap_or(false),
                };
                Ok(Some(enabled))
            },
            move |this, admitted, cx| {
                let current = this.chat_area(function).holds_chat(&ticket, &target)
                    && this.selected_id.as_deref() == Some(patient_id.as_str());
                if !current
                    || !target
                        .lock()
                        .is_ok_and(|mut pending| pending.function_bound())
                    || !matches!(admitted, Ok(Some(_)))
                {
                    if let Ok(mut pending) = target.lock() {
                        pending.withdraw();
                    }
                    if current {
                        this.chat_area(function).follow_chat();
                    }
                    cx.notify();
                    return;
                }
                if matches!(admitted, Ok(Some(false))) {
                    if let Ok(mut pending) = target.lock() {
                        pending.finish_function_open(Stage::Unavailable);
                    }
                    this.chat_area(function).release();
                    cx.notify();
                    return;
                }
                this.chat_area(function).admitted();
                if function == Function::Synthesis {
                    this.patient.synthesis.document = None;
                }
                this.show_chat_function(function, cx);
                match function {
                    Function::ServiceMatching => {
                        if let Ok(mut pending) = target.lock() {
                            pending.finish_function_open(Stage::Opened);
                        }
                        this.open_service_matching(cx);
                    }
                    Function::EvidenceQueue => {
                        if let Ok(mut pending) = target.lock() {
                            pending.finish_function_open(Stage::Opened);
                        }
                        this.open_patient_evidence_queue(cx);
                    }
                    Function::OpenLoops => {
                        if let Ok(mut pending) = target.lock() {
                            pending.finish_function_open(Stage::Opened);
                        }
                        this.open_patient_loops(cx);
                    }
                    Function::Icd => {
                        this.who
                            .open_for_patient(patient_id.clone(), &this.profile_scroll, cx);
                        this.reference_search
                            .update(cx, |input, cx| input.set_content("", cx));
                        if let Ok(mut pending) = target.lock() {
                            pending.finish_function_open(Stage::Opened);
                        }
                    }
                    Function::Insight => {
                        this.insight_prepare(cx);
                    }
                    Function::Synthesis | Function::Import => {
                        if let Ok(mut pending) = target.lock() {
                            pending.finish_function_open(Stage::Opened);
                        }
                    }
                }
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }

    pub(super) fn start_chat_access(&mut self, cx: &mut Context<Self>) {
        if self.chat_access.listener.is_none() {
            return;
        }
        self.chat_access.task = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(250))
                    .await;
                if this
                    .update(cx, |this, cx| this.poll_chat_access(cx))
                    .is_err()
                {
                    break;
                }
            }
        }));
    }

    fn poll_chat_access(&mut self, cx: &mut Context<Self>) {
        self.poll_chat_voice(cx);
        let mut changed = false;
        for function in Function::ALL {
            changed |= self.chat_area(function).follow_chat();
        }
        if changed {
            cx.notify();
        }
        if self.chat_access.pending.is_some()
            && self
                .session
                .as_ref()
                .is_none_or(|s| !self.chat_access.owns_session(s))
        {
            self.chat_access.detach(cx);
            cx.notify();
        }
        let status = self.chat_access.pending.as_ref().and_then(|p| {
            p.lock().ok().map(|mut p| {
                (
                    p.status(),
                    p.therapy().is_some_and(|t| t.selected.is_some()),
                )
            })
        });
        if status != self.chat_access.last_state {
            self.chat_access.last_state = status;
            cx.notify();
        }
        let editable = self
            .chat_access
            .pending
            .as_ref()
            .is_some_and(|p| p.lock().is_ok_and(|mut p| p.status() == State::Challenge));
        self.chat_access
            .pin
            .update(cx, |input, cx| input.configure(self.theme, !editable, cx));
        let incoming = self
            .chat_access
            .listener
            .as_ref()
            .and_then(|l| l.incoming.try_recv().ok());
        if let Some(pending) = incoming {
            if pending.lock().is_ok_and(|mut p| p.voice_requested()) {
                self.open_chat_voice(&pending, cx);
                return;
            }
            if self.chat_access.voice.is_open() {
                if let Ok(mut p) = pending.lock() {
                    p.withdraw();
                }
                return;
            }
            for function in Function::ALL {
                if pending
                    .lock()
                    .is_ok_and(|mut p| p.function_requested(function))
                {
                    self.open_chat_function(&pending, function, cx);
                    return;
                }
            }
            if pending.lock().is_ok_and(|mut p| p.document_requested()) {
                self.open_chat_patient_document(&pending, cx);
                return;
            }
            self.chat_access.retire(cx);
            if self.chat_access.pending.as_ref().is_some_and(|p| {
                p.lock()
                    .is_ok_and(|mut p| p.status() == State::Write(ChatWriteResolution::Uncertain))
            }) {
                if let Ok(mut p) = pending.lock() {
                    p.withdraw();
                }
                return;
            }
            self.chat_access.pending = None;
            let binding = self.session.as_ref().and_then(|session| {
                let scope = self.scope.as_deref()?;
                let patient = self.patient.detail.ready()?;
                if self.selected_id.as_deref() != Some(&patient.id) {
                    return None;
                }
                Some((
                    session.clone(),
                    session.chat_access_context(scope, &patient.id).ok()?,
                    patient.display_name(),
                    format!(
                        "{} · generazione {}",
                        session.base_url(),
                        session.user().archive_generation
                    ),
                ))
            });
            if let Some((session, context, patient, archive)) = binding {
                if let Ok(mut p) = pending.lock() {
                    p.references = self.chat_access.references.clone();
                }
                if pending
                    .lock()
                    .is_ok_and(|mut pending| pending.bind(session.clone(), context))
                {
                    let preparing = pending.clone();
                    std::thread::spawn(move || crate::chat_access::owner::prepare_card(&preparing));
                    self.chat_access.owner =
                        Some((session.chat_write_reference_namespace(), session.clone()));
                    self.chat_access.patient = patient;
                    self.chat_access.archive = archive;
                    self.chat_access.pending = Some(pending);
                }
            } else if let Ok(mut pending) = pending.lock() {
                pending.withdraw();
            }
            cx.notify();
        }
        if self
            .chat_access
            .pending
            .as_ref()
            .is_some_and(|p| p.lock().is_ok_and(|mut p| p.status() == State::Withdrawn))
        {
            self.chat_access.retire(cx);
            cx.notify();
        }
    }

    fn open_chat_patient_document(&mut self, pending: &Pending, cx: &mut Context<Self>) {
        let available = pending.lock().is_ok_and(|mut p| p.document_requested())
            && !self.patient_document.is_open()
            && self.chat_access.pending.is_none()
            && !self.privacy_shield;
        if available {
            self.open_patient_document(cx);
        }
        if let Ok(mut p) = pending.lock() {
            p.finish_document_open(available && self.patient_document.is_open());
        }
        cx.notify();
    }

    fn approve_chat_access(&mut self, with_pin: bool, cx: &mut Context<Self>) {
        let Some(pending) = self.chat_access.pending.clone() else {
            return;
        };
        let Some((session, context, attempt)) = pending
            .lock()
            .ok()
            .and_then(|mut p| p.begin_confirmation(with_pin))
        else {
            return;
        };
        let therapy_write = pending.lock().is_ok_and(|p| p.therapy().is_some());
        if !with_pin && !pending.lock().is_ok_and(|mut p| p.prepare_biometric()) {
            if let Ok(mut p) = pending.lock() {
                p.withdraw();
            }
            return;
        }
        let pin = Zeroizing::new(self.chat_access.pin.read(cx).value().to_owned());
        self.chat_access
            .pin
            .update(cx, |input, cx| input.set_content("", cx));
        self.chat_access.message = None;
        let target = pending.clone();
        let background = cx.background_executor().spawn(async move {
            let result = if therapy_write {
                if crate::chat_access::owner::execute_therapy(&pending, attempt, &pin) { Ok(()) }
                else { Err("Esito non confermato. Rileggi la ricevuta; non ripetere la scrittura.".to_owned()) }
            } else if with_pin {
                session.confirm_chat_access_pin(&context, &pin).map_err(|error| if error.status_code() == Some(423) {
                    "PIN bloccato dopo troppi tentativi. Attendi lo sblocco previsto dall’home-base.".to_owned()
                } else { "PIN non confermato o sessione non più disponibile.".to_owned() })
            } else {
                attempt.biometric().map_err(str::to_owned).and_then(|()|
                    session.revalidate_chat_access_context(&context).map_err(|error| ui_error(error).to_owned()))
            };
            if !therapy_write && let Ok(mut pending) = pending.lock() { pending.finish(attempt, result.is_ok()); }
            result.err()
        });
        cx.spawn(async move |this, cx| {
            let message = background.await;
            let _ = this.update(cx, |this, cx| {
                if this
                    .chat_access
                    .pending
                    .as_ref()
                    .is_some_and(|p| std::sync::Arc::ptr_eq(p, &target))
                {
                    this.chat_access.message = message;
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn reread_chat_recovery(&mut self, cx: &mut Context<Self>) {
        if self.chat_access.recovery_busy {
            return;
        }
        let Some(session) = self.session.clone().filter(|s| !s.is_locked()) else {
            return;
        };
        let Some(scope) = self.scope.clone() else {
            return;
        };
        let scan = match self.chat_access.unattached_commands(&session) {
            Ok(scan) => scan,
            Err(_) => {
                self.chat_access.recovery_error = true;
                cx.notify();
                return;
            }
        };
        self.chat_access.recovery_error = false;
        if scan.ids.is_empty() {
            cx.notify();
            return;
        }
        self.chat_access.recovery_busy = true;
        let namespace = session.chat_write_reference_namespace();
        if self.chat_access.recovery_namespace.as_ref() != Some(&namespace) {
            self.chat_access.recovery_messages.clear();
            self.chat_access.cleanup_failed.clear();
        }
        self.chat_access.recovery_namespace = Some(namespace.clone());
        self.chat_access.recovery_error = false;
        let references = self.chat_access.references.for_session(&session);
        let epoch = self.chat_access.recovery_epoch;
        let known = self.chat_access.cleanup_failed.clone();
        let task = cx.background_executor().spawn(async move {
            let mut resolutions = BTreeMap::new();
            let mut cleanup_failed = BTreeMap::new();
            for id in scan.ids {
                // A server confirmation already received is not asked again:
                // only the local cleanup is retried.
                let resolution = match known.get(&id) {
                    Some(outcome) => ChatWriteResolution::Confirmed(*outcome),
                    None => {
                        let kind = scan.kinds.get(&id).copied();
                        session
                            .recover_chat_write_command(&scope, &id, kind)
                            .map_or(ChatWriteResolution::Uncertain, |r| r.reconcile())
                    }
                };
                if let ChatWriteResolution::Confirmed(outcome) = resolution
                    && references.confirm(&id, outcome).is_err()
                {
                    cleanup_failed.insert(id.clone(), outcome);
                }
                resolutions.insert(id, resolution);
            }
            (resolutions, cleanup_failed, session)
        });
        cx.spawn(async move |this, cx| {
            let (resolutions, cleanup_failed, owner) = task.await;
            let storage_error = !cleanup_failed.is_empty();
            let _ = this.update(cx, |this, cx| {
                if !owner.is_locked()
                    && this.session.as_ref().is_some_and(|s| {
                        !s.is_locked() && s.chat_write_reference_namespace() == namespace
                    })
                    && this.chat_access.recovery_epoch == epoch
                {
                    this.chat_access.recovery_busy = false;
                    this.chat_access.recovery_messages.extend(resolutions);
                    this.chat_access.cleanup_failed = cleanup_failed;
                    this.chat_access.recovery_error = storage_error;
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
    }

    pub(super) fn chat_recovery_view(&self, cx: &Context<Self>) -> Option<Stateful<Div>> {
        let session = self.session.as_ref().filter(|s| !s.is_locked())?;
        let recovery = self.chat_access.unattached_commands(session);
        let mut messages = if self.chat_access.recovery_namespace.as_ref()
            == Some(&session.chat_write_reference_namespace())
        {
            self.chat_access.recovery_messages.clone()
        } else {
            BTreeMap::new()
        };
        let mut storage_error = self.chat_access.recovery_error
            || recovery.is_err()
            || !self.chat_access.cleanup_failed.is_empty();
        let mut invalid = false;
        let mut pending = false;
        if let Ok(scan) = recovery {
            pending = !scan.ids.is_empty();
            invalid = !scan.invalid.is_empty();
            for id in scan.ids {
                messages.entry(id).or_insert(ChatWriteResolution::Uncertain);
            }
        }
        storage_error |= invalid;
        if messages.is_empty() && !storage_error {
            return None;
        }
        let confirmed = messages.iter().any(|(id, r)| {
            matches!(r, ChatWriteResolution::Confirmed(_))
                && !self.chat_access.cleanup_failed.contains_key(id)
        });
        Some(div().id("native-chat-recovery").flex().flex_col().gap(px(12.)).p(px(20.))
            .children(messages.into_iter().enumerate().map(|(index, (id, resolution))|
                notice(format!("native-chat-recovery-warning-{index}"), format!("Comando {id}: {}", resolution.message()), self.theme, resolution == ChatWriteResolution::Uncertain)))
            .when(storage_error, |el| el.child(notice("native-chat-recovery-storage", "Problema di conservazione locale dei riferimenti. Gli esiti confermati restano confermati. I comandi riconoscibili dal nome possono essere riletti anche se il file è difettoso. Gli altri elementi non sono comandi e vengono ignorati.", self.theme, true)))
            .when(pending, |el| el.child(button("native-chat-recovery-reread", "Rileggi esito e completa il ritiro", self.theme, false, self.scope.is_some() && !self.chat_access.recovery_busy)
                .on_click(cx.listener(|this, _, _, cx| this.reread_chat_recovery(cx)))))
            .when(storage_error && !pending, |el| el.child(button("native-chat-recovery-retry-storage", "Riprova lettura riferimenti locali", self.theme, false, self.scope.is_some())
                .on_click(cx.listener(|this, _, _, cx| this.reread_chat_recovery(cx)))))
            .when(confirmed, |el| el.child(button("native-chat-recovery-dismiss", "Chiudi gli esiti confermati", self.theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| this.dismiss_confirmed_chat_recovery(cx))))))
    }

    fn dismiss_confirmed_chat_recovery(&mut self, cx: &mut Context<Self>) {
        let cleanup_failed = &self.chat_access.cleanup_failed;
        self.chat_access.recovery_messages.retain(|id, r| {
            !matches!(r, ChatWriteResolution::Confirmed(_)) || cleanup_failed.contains_key(id)
        });
        cx.notify();
    }

    pub(super) fn chat_access_view(&self, cx: &Context<Self>) -> Option<Stateful<Div>> {
        let session = self.session.as_ref()?;
        if !self.chat_access.owns_session(session) {
            return None;
        }
        let pending = self.chat_access.pending.as_ref()?;
        let (state, app, opener) = pending
            .lock()
            .ok()
            .map(|mut p| (p.status(), p.app(), p.opener_summary()))?;
        if state == State::Withdrawn {
            return None;
        }
        let review = pending.lock().ok().and_then(|p| {
            p.review().map(|(payload, digest, source)| {
                (payload.to_owned(), digest.to_owned(), source.to_owned())
            })
        });
        let therapy = pending.lock().ok().and_then(|p| {
            p.therapy().map(|t| {
                (
                    t.target.clone(),
                    t.rows.clone(),
                    t.selected.clone(),
                    t.result.clone(),
                    t.booking.clone(),
                )
            })
        });
        let clinical = pending.lock().ok().and_then(|p| {
            p.clinical.as_ref().map(|c| {
                (
                    c.profile
                        .as_ref()
                        .and_then(|p| p.notes.clone())
                        .unwrap_or_default(),
                    c.diagnoses
                        .iter()
                        .chain(c.excerpts.iter())
                        .enumerate()
                        .map(|(i, t)| c.copies.get(&i).unwrap_or(t).clone())
                        .collect::<Vec<_>>(),
                    c.selected.clone(),
                )
            })
        });
        let clinical_mode = clinical.is_some();
        let enabled = state == State::Challenge
            && (review.is_some() || therapy.as_ref().is_some_and(|t| t.2.is_some()));
        let therapy_mode = therapy.is_some();
        let booking_mode = therapy.as_ref().is_some_and(|t| t.4.is_some());
        let catalog_mode = pending.lock().is_ok_and(|p| p.is_catalog());
        let (catalog_title, catalog_notice) = if pending.lock().is_ok_and(|p| p.is_agenda()) {
            (
                "Mostra l’agenda interna nella vista della chat?",
                "Sola lettura dei primi 20 controlli interni, ordinati per data. Solo date e stato, senza nomi, titoli o note. La lettura non prenota nulla e non include candidati da calendario. Conferma una sola consultazione entro 30 secondi.",
            )
        } else {
            catalog_copy(pending.lock().is_ok_and(|p| p.is_prosthetics_catalog()))
        };
        let theme = self.theme;
        Some(div().id("native-chat-access-confirmation").role(Role::Group)
            .aria_label("Conferma accesso della chat").flex_1().min_h_0().overflow_y_scroll()
            .p(px(20.)).border_1().border_color(theme.rule)
            .flex().flex_col().gap(px(12.))
            .child(heading("native-chat-access-title", if booking_mode { "Conferma la prenotazione del controllo" } else if therapy_mode { "Conferma il cambio di stato della terapia" } else if catalog_mode { catalog_title } else if clinical_mode { "Scegli diagnosi e passi delle note" } else { "Condividi la scheda di prova nella chat?" }, theme))
            .child(text!(format!("App richiedente: {app}")).with_id("native-chat-access-app"))
            .child(text!(opener).with_id("native-chat-access-opener"))
            .child(text!(format!("Archivio: {}", self.chat_access.archive)).with_id("native-chat-access-archive"))
            .child(div().id("native-chat-access-patient").child(crate::title::title(crate::title::TitleText::patient_question("Paziente: ", self.chat_access.patient.clone(), ""), theme)))
            .child(notice("native-chat-access-operation", if booking_mode { "Prenotazione di un controllo nell’agenda interna della cartella selezionata. Scrivi data e ora, controlla l’anteprima e conferma con il PIN nativo, una sola volta entro 30 secondi. Titolo fisso «Controllo», nessuna nota. Se l’agenda cambia prima della conferma la prenotazione viene respinta. Nessun calendario personale o servizio esterno." } else if therapy_mode { "Scegli la terapia della cartella selezionata e controlla il nuovo stato. La scrittura usa il PIN nativo, una sola volta entro 30 secondi. I nomi restano qui. Touch ID per questa scrittura non è ancora abilitato." } else if catalog_mode { catalog_notice } else if clinical_mode { "Spunta le diagnosi e i passi da condividere. Copia un passo esatto delle note nel campo sotto e aggiungilo, poi spuntalo. La nota intera non è ammessa. Il testo viene dalle tue note, anche con refusi o errori OCR. Il controllo è un aiuto e non è anonimizzazione. Un dato sconosciuto offuscato di proposito può sfuggire. Sei responsabile di ciò che esce: controlla i byte esatti prima della conferma. Il testo non viene riscritto. Puoi togliere la spunta o modificare una copia qui, senza cambiare la cartella. Le date complete sono escluse." } else { "Scheda sintetica «basic», indipendente dalla cartella selezionata. Controlla i byte sotto: verranno mostrati soltanto nella vista della chat. Nomi e fonti restano qui. Hai 30 secondi per confermare una sola lettura; nessun rinnovo automatico." }, theme, false))
            .when_some(clinical.filter(|_| state == State::Selecting), |mut el, (notes, rows, selected)| {
                el = el.child(notice("chat-clinical-notes", notes, theme, false)).child(self.chat_access.excerpt.clone());
                el = el.child(button("chat-clinical-add", "Aggiungi passo", theme, false, true)
                    .on_click(cx.listener(|this, _, _, cx| {
                        let text = this.chat_access.excerpt.read(cx).value().to_owned();
                        let added = this.chat_access.pending.as_ref().is_some_and(|p| p.lock().is_ok_and(|mut p| p.add_excerpt(&text)));
                        this.chat_access.message = if added { None } else { Some("Scegli un passo esatto e più breve della nota intera, massimo 2048 caratteri.".into()) };
                        if added { this.chat_access.excerpt.update(cx, |input, cx| input.set_content("", cx)); }
                        cx.notify();
                    })));
                el = el.child(button("chat-clinical-save-copy", "Usa il campo come copia modificata", theme, false, true)
                    .on_click(cx.listener(|this, _, _, cx| {
                        let text = this.chat_access.excerpt.read(cx).value().to_owned();
                        let saved = this.chat_access.pending.as_ref().is_some_and(|p| p.lock().is_ok_and(|mut p| p.save_clinical_copy(&text)));
                        this.chat_access.message = if saved { None } else { Some("Scegli prima Modifica copia sulla riga, poi inserisci un testo da 1 a 2048 caratteri.".into()) };
                        cx.notify();
                    })));
                for (index, row) in rows.into_iter().enumerate() {
                    let request = pending.clone();
                    el = el.child(button(format!("chat-clinical-select-{index}"), format!("{} {}", if selected.contains(&index) { "☑" } else { "☐" }, row), theme, false, true)
                        .on_click(cx.listener(move |_, _, _, cx| { if let Ok(mut p) = request.lock() { p.toggle_clinical(index); } cx.notify(); })));
                    let request = pending.clone();
                    el = el.child(button(format!("chat-clinical-edit-{index}"), "Modifica copia", theme, false, true)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if let Some(text) = request.lock().ok().and_then(|mut p| p.edit_clinical(index)) {
                                this.chat_access.excerpt.update(cx, |input, cx| input.set_content(&text, cx));
                            }
                            cx.notify();
                        })));
                }
                let request = pending.clone();
                el.child(button("chat-clinical-prepare", "Prepara selezione", theme, true, !selected.is_empty())
                    .on_click(cx.listener(move |_, _, _, cx| { let request = request.clone(); std::thread::spawn(move || crate::chat_access::owner::prepare_clinical(&request)); cx.notify(); })))
            })
            .when_some(therapy, |mut el, (target, rows, selected, result, booking)| {
                if let Some(booking) = booking {
                    if let Some(agenda) = booking.agenda.as_ref() {
                        el = el.child(text!("Controlli da oggi in avanti, letti all’apertura").with_id("native-chat-booking-agenda-title"));
                        if agenda.rows.is_empty() {
                            el = el.child(notice("native-chat-booking-agenda-empty", "Nessun controllo da oggi in avanti per questa cartella.", theme, false));
                        }
                        for (index, line) in booking_agenda_lines(agenda).into_iter().enumerate() {
                            el = el.child(text!(line).with_id(format!("native-chat-booking-agenda-{index}")));
                        }
                        if agenda.omitted > 0 {
                            el = el.child(notice("native-chat-booking-agenda-truncated", booking_omitted_notice(agenda.omitted), theme, false));
                        }
                    }
                    if let Some(chosen) = booking.chosen {
                        el = el.child(notice("native-chat-booking-preview", format!("Nuovo controllo · {chosen} · da svolgere. Se l’agenda sopra cambia prima della conferma, la prenotazione viene respinta."), theme, false));
                    } else if selected.is_none() {
                        let ready = state == State::Challenge;
                        el = el.child(self.chat_access.booking.clone())
                            .child(button("native-chat-booking-prepare", "Prepara prenotazione", theme, false, ready)
                                .when(ready, |button| button.on_click(cx.listener(|this, _, _, cx| {
                                    let text = this.chat_access.booking.read(cx).value().to_owned();
                                    let Some(request) = this.chat_access.pending.clone() else { return; };
                                    if let Err(error) = crate::chat_access::owner::booking_instant(&text, chrono::Local::now()) {
                                        this.chat_access.message = Some(error.message().into());
                                    } else {
                                        this.chat_access.message = None;
                                        std::thread::spawn(move || crate::chat_access::owner::choose_booking(&request, &text));
                                    }
                                    cx.notify();
                                }))));
                    }
                    if let Some((_, id)) = selected { el = el.child(notice("native-chat-therapy-command", format!("Comando: {id}. Conserva questo riferimento per rileggere l’esito."), theme, false)); }
                    if let Some(result) = result { el = el.child(notice("native-chat-therapy-receipt", format!("Ricevuta e rilettura: {result}"), theme, false)); }
                    if state == State::Write(ChatWriteResolution::Confirmed(mediflow_runtime_client::ChatWriteOutcome::Rejected)) {
                        el = el.child(notice("native-chat-booking-conflict", "L’agenda della cartella è cambiata dopo l’apertura. Nessun controllo prenotato: apri una nuova richiesta e ricontrolla.", theme, true));
                    }
                    return el;
                }
                el = el.child(text!(format!("Nuovo stato: {target}")).with_id("native-chat-therapy-target"));
                for (index, row) in rows.iter().enumerate() {
                    if selected.as_ref().is_none_or(|s| s.0 == index) {
                        let selectable = state == State::Challenge && selected.is_none() && row.status != target;
                        let request = pending.clone();
                        el = el.child(button(format!("native-chat-therapy-{index}"), format!("{} · {} · {} → {} · versione {}", row.drug_name, row.dosage, row.status, target, row.version), theme, false, selectable)
                            .when(selectable, |button| button.on_click(cx.listener(move |_, _, _, cx| {
                                let request = request.clone();
                                std::thread::spawn(move || crate::chat_access::owner::choose_therapy(&request, index));
                                cx.notify();
                            }))));
                    }
                }
                if let Some((_, id)) = selected { el = el.child(notice("native-chat-therapy-command", format!("Comando: {id}. Conserva questo riferimento per rileggere l’esito."), theme, false)); }
                if let Some(result) = result { el = el.child(notice("native-chat-therapy-receipt", format!("Ricevuta e rilettura: {result}"), theme, false)); }
                el
            })
            .when_some(pending.lock().ok().and_then(|p| p.clinical_denial.clone()), |el, message| el.child(notice("chat-clinical-denial", message, theme, true)))
            .when_some(review, |el, (payload, digest, source)| el
                .child(notice("native-chat-card-source", format!("Fonte locale: {source}"), theme, false))
                .child(notice("native-chat-card-payload", payload, theme, false))
                .child(text!(format!("SHA-256: {digest}")).with_id("native-chat-card-digest")))
            .when_some(self.chat_access.message.clone(), |el, message| el.child(notice("native-chat-access-error", message, theme, true)))
            .child(button("native-chat-access-touch-id", "Conferma con Touch ID", theme, true, enabled && !therapy_mode)
                .when(enabled && !therapy_mode, |el| el.on_click(cx.listener(|this, _, _, cx| this.approve_chat_access(false, cx)))))
            .child(self.chat_access.pin.clone())
            .child(button("native-chat-access-pin-confirm", "Conferma con PIN", theme, false, enabled)
                .when(enabled, |el| el.on_click(cx.listener(|this, _, _, cx| this.approve_chat_access(true, cx)))))
            .when(state == State::Write(ChatWriteResolution::Uncertain), |el| el
                .child(notice("native-chat-therapy-uncertain", "Esito da verificare. Il ritiro non è confermato: la scrittura potrebbe essere avvenuta. Rileggi l’esito prima di proseguire.", theme, true))
                .child(button("native-chat-therapy-reread", "Rileggi esito e completa il ritiro", theme, false, true)
                    .on_click(cx.listener(|this, _, _, cx| {
                        if let Some(p) = this.chat_access.pending.clone() {
                            std::thread::spawn(move || { if let Ok(mut p) = p.lock() { p.revoke(); } });
                        }
                        cx.notify();
                    }))))
            .when_some(if let State::Write(resolution) = state { Some(resolution) } else { None }, |el, resolution| el.child(notice("native-chat-therapy-outcome", resolution.message(), theme, resolution == ChatWriteResolution::Uncertain)))
            .child(button("native-chat-access-deny", "Nega e ritira", theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| { this.chat_access.retire(cx); cx.notify(); })))
            .when(state != State::Challenge, |el| el.child(notice("native-chat-access-state",
                if matches!(state, State::Write(ChatWriteResolution::Confirmed(_)) | State::Write(ChatWriteResolution::Uncertain)) { "" } else if state == State::Consumed && therapy_mode { "Operazione terminata. Controlla ricevuta e rilettura; nessuna ripetizione automatica." } else if state == State::Consumed { "Scheda consegnata. Puoi revocare la vista; i byte già ricevuti dall’home-base non vengono cancellati." } else if state == State::Approved { "Scheda autorizzata per una sola lettura nella vista chat." } else { "Conferma in corso…" }, theme, false))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::EntityInputHandler;

    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn document_handoff_opens_existing_flow_once_without_staging_or_writing(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = super::super::notes_recovery_tests::Host::new();
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        app.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            let before = host.request_count();
            let (pending, _peer) = crate::chat_access::owner::tests::document_request();
            app.open_chat_patient_document(&pending, cx);
            assert_eq!(pending.lock().unwrap().status(), State::DocumentOpened);
            assert!(app.patient_document.is_open());
            assert_eq!(host.request_count(), before);
            let (second, _other) = crate::chat_access::owner::tests::document_request();
            app.open_chat_patient_document(&second, cx);
            assert_eq!(second.lock().unwrap().status(), State::Withdrawn);
            assert!(app.patient_document.is_open());
            assert_eq!(host.request_count(), before);
            app.withdraw_patient_document(cx);
        });
    }

    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn document_handoff_cannot_open_without_native_authority(cx: &mut gpui::TestAppContext) {
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        app.update(cx, |app, cx| {
            let (pending, _peer) = crate::chat_access::owner::tests::document_request();
            app.open_chat_patient_document(&pending, cx);
            assert_eq!(pending.lock().unwrap().status(), State::Withdrawn);
            assert!(!app.patient_document.is_open());
            assert!(app.chat_access.pending.is_none());
        });
    }

    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn reopened_authenticated_shell_shows_unresolved_command_without_a_live_request(
        cx: &mut gpui::TestAppContext,
    ) {
        let directory = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("mf-chat-shell-{}", std::process::id()));
        let (session, _host) = crate::chat_access::owner::tests::native_session();
        let references = CommandReferences::new(Some(directory.clone())).for_session(&session);
        references
            .remember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
            .unwrap();
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        app.update(cx, |app, cx| {
            app.chat_access = ChatAccess::new(app.theme, Some(directory.clone()), cx);
            assert!(app.chat_access.pending.is_none());
            assert!(
                app.chat_recovery_view(cx).is_none(),
                "recovery must wait for authentication"
            );
            app.session = Some(session);
            assert!(
                app.chat_recovery_view(cx).is_some(),
                "restart lost the persistent warning"
            );
            assert_eq!(
                app.chat_access
                    .references
                    .for_session(app.session.as_ref().unwrap())
                    .pending()
                    .unwrap()
                    .len(),
                1
            );
            assert!(
                app.chat_access.pending.is_none(),
                "recovery must not recreate execute authority"
            );
        });
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn manual_clinical_selection_adds_exact_passages_and_requires_a_separate_check(
        cx: &mut gpui::TestAppContext,
    ) {
        let (pending, _remote, session, _host) =
            crate::chat_access::owner::tests::clinical_request();
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
        app.update(cx, |app, cx| {
            app.scope = Some("scope-a".into());
            app.chat_access.owner =
                Some((session.chat_write_reference_namespace(), session.clone()));
            app.session = Some(session);
            app.chat_access.pending = Some(pending.clone());
            app.chat_access
                .excerpt
                .update(cx, |input, cx| input.set_content("Passo clinico.", cx));
        });
        super::super::notes_recovery_tests::draw(cx);
        let button = cx
            .debug_bounds("control-label:Aggiungi passo")
            .expect("native selection rendered");
        cx.simulate_click(button.center(), gpui::Modifiers::default());
        cx.run_until_parked();
        {
            let p = pending.lock().unwrap();
            let c = p.clinical.as_ref().unwrap();
            assert_eq!(c.excerpts, ["Passo clinico."]);
            assert!(c.selected.is_empty());
            assert!(p.review().is_none());
        }
        super::super::notes_recovery_tests::draw(cx);
        let check = cx
            .debug_bounds("control-label:☐ Passo clinico.")
            .expect("manual passage check rendered");
        cx.simulate_click(check.center(), gpui::Modifiers::default());
        cx.run_until_parked();
        assert_eq!(
            pending.lock().unwrap().clinical.as_ref().unwrap().selected,
            [1]
        );
        assert_eq!(
            pending.lock().unwrap().edit_clinical(1),
            Some("Passo clinico.".into())
        );
        app.update(cx, |app, cx| {
            app.chat_access.excerpt.update(cx, |input, cx| {
                input.set_content("Passo clinico senza nomi.", cx)
            })
        });
        super::super::notes_recovery_tests::draw(cx);
        let save = cx
            .debug_bounds("control-label:Usa il campo come copia modificata")
            .expect("native copy action rendered");
        cx.simulate_click(save.center(), gpui::Modifiers::default());
        cx.run_until_parked();
        {
            let p = pending.lock().unwrap();
            let c = p.clinical.as_ref().unwrap();
            assert_eq!(c.excerpts, ["Passo clinico."]);
            assert_eq!(c.copies[&1], "Passo clinico senza nomi.");
            assert!(p.review().is_none());
        }
        app.update(cx, |app, cx| app.disconnect(cx));
        assert_eq!(pending.lock().unwrap().status(), State::Withdrawn);
        assert!(pending.lock().unwrap().clinical.is_none());
    }

    #[gpui::test]
    fn confirmation_pin_is_unavailable_to_native_surrounding_text_services(
        cx: &mut gpui::TestAppContext,
    ) {
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let editor = app.read_with(cx, |app, _| app.chat_access.pin.clone());
        cx.update_window_entity(&editor, |input, window, cx| {
            input.set_content("2468", cx);
            let mut actual = Some(0..4);
            assert!(
                input
                    .text_for_range(0..4, &mut actual, window, cx)
                    .is_none()
            );
            assert_eq!(actual, None);
            input.set_content("", cx);
            assert!(input.value().is_empty());
        });
    }
}

#[cfg(all(test, target_os = "macos"))]
mod recovery_regressions {
    use super::*;
    const A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    fn directory() -> std::path::PathBuf {
        std::env::temp_dir().canonicalize().unwrap().join(format!(
            "mf729-giro3-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    fn click(cx: &mut gpui::VisualTestContext, label: &'static str) {
        super::super::notes_recovery_tests::draw(cx);
        let target = cx.debug_bounds(label).expect("control rendered");
        cx.simulate_click(target.center(), gpui::Modifiers::default());
        cx.run_until_parked();
    }
    fn painted(cx: &mut gpui::VisualTestContext) -> Vec<String> {
        let _probe = super::super::rendered_command::begin_inks();
        super::super::notes_recovery_tests::draw(cx);
        super::super::rendered_command::take_inks()
            .into_iter()
            .map(|ink| ink.label)
            .collect()
    }
    #[gpui::test]
    fn logout_detaches_uncertain_request_and_renders_login(cx: &mut gpui::TestAppContext) {
        let directory = directory();
        let (session, _host) = crate::chat_access::owner::tests::native_session();
        let references = CommandReferences::new(Some(directory.clone()));
        let (pending, _remote) = crate::chat_access::owner::tests::unresolved_request(
            session.clone(),
            references.clone(),
        );
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
        app.update(cx, |app, cx| {
            app.chat_access = ChatAccess::new(app.theme, Some(directory.clone()), cx);
            app.chat_access.owner =
                Some((session.chat_write_reference_namespace(), session.clone()));
            app.chat_access.pending = Some(pending.clone());
            app.session = Some(session.clone());
            assert!(app.chat_access_view(cx).is_some());
            app.disconnect(cx);
            assert!(app.session.is_none());
            assert!(
                app.chat_access.pending.is_none(),
                "logout retained the old Request"
            );
            assert!(app.chat_access_view(cx).is_none());
            assert_eq!(references.for_session(&session).pending().unwrap(), [A]);
            assert!(
                pending.lock().unwrap().begin().is_none(),
                "logout retained execute authority"
            );
            pending.lock().unwrap().revoke();
            assert_eq!(
                pending.lock().unwrap().status(),
                State::Write(ChatWriteResolution::Uncertain),
                "detached Request used a closed session to reconcile"
            );
        });
        let labels = painted(cx);
        assert!(!labels.iter().any(|s| s.contains(A)));
        assert!(
            cx.debug_bounds("control-label:Continua con l'accesso")
                .is_some(),
            "login is hidden"
        );
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            directory
                .join(session.chat_write_reference_namespace())
                .join(A),
            std::fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        let reopened = crate::chat_access::owner::tests::relogin(&session);
        app.update(cx, |app, cx| {
            app.session = Some(reopened);
            app.scope = Some("scope-a".into());
            assert!(app.chat_access.pending.is_none());
            assert!(app.chat_recovery_view(cx).is_some());
        });
        let labels = painted(cx);
        assert!(
            labels
                .iter()
                .any(|s| s.contains(A) && s.contains("Esito da verificare"))
        );
        assert!(
            labels
                .iter()
                .any(|s| s.contains("Problema di conservazione locale"))
        );
        click(cx, "control-label:Rileggi esito e completa il ritiro");
        assert!(
            references
                .for_session(&session)
                .pending()
                .unwrap()
                .is_empty(),
            "new login did not recover the original partition"
        );
        assert!(
            painted(cx)
                .iter()
                .any(|s| s.contains(A) && s.contains("Modifica registrata"))
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[gpui::test]
    fn owner_change_hides_and_detaches_previous_request(cx: &mut gpui::TestAppContext) {
        let directory = directory();
        let (first, _host1) = crate::chat_access::owner::tests::native_session_as("first-operator");
        let (second, _host2) =
            crate::chat_access::owner::tests::native_session_as("second-operator");
        let references = CommandReferences::new(Some(directory.clone()));
        let (pending, _remote) =
            crate::chat_access::owner::tests::unresolved_request(first.clone(), references.clone());
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        app.update(cx, |app, cx| {
            app.chat_access = ChatAccess::new(app.theme, Some(directory.clone()), cx);
            app.chat_access.owner = Some((first.chat_write_reference_namespace(), first.clone()));
            app.chat_access.pending = Some(pending);
            app.session = Some(second.clone());
            assert!(
                app.chat_access_view(cx).is_none(),
                "old reference escaped its owner partition"
            );
            app.poll_chat_access(cx);
            assert!(app.chat_access.pending.is_none());
            assert!(app.chat_recovery_view(cx).is_none());
            assert!(
                references
                    .for_session(&second)
                    .pending()
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(references.for_session(&first).pending().unwrap(), [A]);
            app.session = Some(first);
            assert!(
                app.chat_recovery_view(cx).is_some(),
                "original partition lost durable recovery"
            );
        });
        std::fs::remove_dir_all(directory).unwrap();
    }
    // The deny-delete ACL (`chmod +a`) exists only on macOS.
    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn confirmed_command_whose_reference_cannot_be_removed_is_never_shown_as_uncertain(
        cx: &mut gpui::TestAppContext,
    ) {
        let directory = directory();
        let (session, host) = crate::chat_access::owner::tests::native_session();
        let references = CommandReferences::new(Some(directory.clone())).for_session(&session);
        references.remember(A).unwrap();
        let marker = directory
            .join(session.chat_write_reference_namespace())
            .join(A);
        assert!(marker.is_file());
        // A deny-delete ACL keeps the reference readable with its 0600 mode,
        // like an ACL set on the file by another tool.
        let acl = |flag: &[&str]| {
            assert!(
                std::process::Command::new("/bin/chmod")
                    .args(flag)
                    .arg(&marker)
                    .status()
                    .unwrap()
                    .success()
            )
        };
        acl(&["+a", "everyone deny delete"]);
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
        app.update(cx, |app, cx| {
            app.chat_access = ChatAccess::new(app.theme, Some(directory.clone()), cx);
            app.session = Some(session);
            app.scope = Some("scope-a".into());
        });
        click(cx, "control-label:Rileggi esito e completa il ritiro");
        let confirmed_with_storage_error = |labels: Vec<String>| {
            assert!(
                labels
                    .iter()
                    .any(|s| s.contains(A) && s.contains("Modifica registrata")),
                "server confirmation lost: {labels:?}"
            );
            assert!(
                labels
                    .iter()
                    .any(|s| s.contains("Problema di conservazione locale")),
                "storage error lost: {labels:?}"
            );
            assert!(
                !labels.iter().any(|s| s.contains("Esito da verificare")),
                "a confirmed command became uncertain: {labels:?}"
            );
        };
        confirmed_with_storage_error(painted(cx));
        assert_eq!(references.pending().unwrap(), [A]);
        // Taking note of the confirmed outcomes keeps the known command.
        app.update(cx, |app, cx| app.dismiss_confirmed_chat_recovery(cx));
        confirmed_with_storage_error(painted(cx));
        // A new cleanup attempt that still fails keeps the same distinction,
        // without asking the server again: with the host gone, a new read
        // could only answer an uncertain outcome.
        drop(host);
        click(cx, "control-label:Rileggi esito e completa il ritiro");
        confirmed_with_storage_error(painted(cx));
        acl(&["-N"]);
        click(cx, "control-label:Rileggi esito e completa il ritiro");
        assert!(references.pending().unwrap().is_empty());
        let labels = painted(cx);
        assert!(
            !labels
                .iter()
                .any(|s| s.contains("Problema di conservazione locale"))
        );
        assert!(!labels.iter().any(|s| s.contains("Esito da verificare")));
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[gpui::test]
    fn reread_confirmed_command_is_not_uncertain_and_new_command_stays_visible(
        cx: &mut gpui::TestAppContext,
    ) {
        let directory = directory();
        let (session, _host) = crate::chat_access::owner::tests::native_session();
        let references = CommandReferences::new(Some(directory.clone())).for_session(&session);
        references.remember(A).unwrap();
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
        app.update(cx, |app, cx| {
            app.chat_access = ChatAccess::new(app.theme, Some(directory.clone()), cx);
            app.session = Some(session);
            app.scope = Some("scope-a".into());
        });
        click(cx, "control-label:Rileggi esito e completa il ritiro");
        app.read_with(cx, |app, _| {
            assert!(references.pending().unwrap().is_empty());
            assert_eq!(
                app.chat_access.recovery_messages.get(A),
                Some(&ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied))
            );
        });
        app.update(cx, |app, cx| app.reread_chat_recovery(cx));
        cx.run_until_parked();
        assert!(
            !painted(cx)
                .iter()
                .any(|s| s.contains("Il ritiro non è confermato")),
            "empty reread fabricated an uncertainty"
        );
        assert!(
            cx.debug_bounds("control-label:Rileggi esito e completa il ritiro")
                .is_none()
        );
        references.remember(B).unwrap();
        let labels = painted(cx);
        assert!(
            labels
                .iter()
                .any(|s| s.contains(B) && s.contains("Esito da verificare")),
            "new pending command hidden behind old receipt"
        );
        assert!(
            labels
                .iter()
                .any(|s| s.contains(A) && s.contains("Modifica registrata"))
        );
        click(cx, "control-label:Chiudi gli esiti confermati");
        let labels = painted(cx);
        assert!(!labels.iter().any(|s| s.contains(A)));
        assert!(
            labels
                .iter()
                .any(|s| s.contains(B) && s.contains("Esito da verificare"))
        );
        click(cx, "control-label:Rileggi esito e completa il ritiro");
        click(cx, "control-label:Chiudi gli esiti confermati");
        app.update(cx, |app, cx| assert!(app.chat_recovery_view(cx).is_none()));
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[gpui::test]
    fn incomplete_marker_does_not_block_shell_recovery_or_claim_withdrawal(
        cx: &mut gpui::TestAppContext,
    ) {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let directory = directory();
        let (session, _host) = crate::chat_access::owner::tests::native_session();
        let references = CommandReferences::new(Some(directory.clone())).for_session(&session);
        references.remember(A).unwrap();
        let partition = directory.join(session.chat_write_reference_namespace());
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(partition.join(B))
            .unwrap();
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
        app.update(cx, |app, cx| {
            app.chat_access = ChatAccess::new(app.theme, Some(directory.clone()), cx);
            app.session = Some(session);
            app.scope = Some("scope-a".into());
        });
        assert!(
            painted(cx)
                .iter()
                .any(|s| s.contains("Problema di conservazione locale"))
        );
        let labels = painted(cx);
        for id in [A, B] {
            assert!(
                labels
                    .iter()
                    .any(|s| s.contains(id) && s.contains("Esito da verificare"))
            );
        }
        assert!(
            cx.debug_bounds("control-label:Accantona gli elementi locali non validi")
                .is_none()
        );
        click(cx, "control-label:Rileggi esito e completa il ritiro");
        assert!(
            references.pending().unwrap().is_empty(),
            "damaged marker blocked command recovery"
        );
        let labels = painted(cx);
        assert!(
            labels
                .iter()
                .any(|s| s.contains(A) && s.contains("Modifica registrata"))
        );
        assert!(
            labels
                .iter()
                .any(|s| s.contains(B) && s.contains("Modifica registrata"))
        );
        assert!(references.scan().unwrap().invalid.is_empty());
        click(cx, "control-label:Chiudi gli esiti confermati");
        app.update(cx, |app, cx| assert!(app.chat_recovery_view(cx).is_none()));
        std::fs::write(partition.join("not-a-command"), A).unwrap();
        let labels = painted(cx);
        assert!(
            labels
                .iter()
                .any(|s| s.contains("Problema di conservazione locale"))
        );
        assert!(!labels.iter().any(|s| s.contains("Esito da verificare")));
        assert!(references.pending().unwrap().is_empty());
        std::fs::remove_file(partition.join("not-a-command")).unwrap();
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755)).unwrap();
        app.update(cx, |app, cx| app.reread_chat_recovery(cx));
        let labels = painted(cx);
        assert!(
            labels
                .iter()
                .any(|s| s.contains("Problema di conservazione locale"))
        );
        assert!(
            !labels
                .iter()
                .any(|s| s.contains("Il ritiro non è confermato"))
        );
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }
}
