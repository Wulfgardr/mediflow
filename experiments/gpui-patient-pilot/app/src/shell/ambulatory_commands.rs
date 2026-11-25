use super::*;
use mediflow_runtime_client::{
    AmbulatoryCommandAuthority, AmbulatoryCommandContext, AmbulatoryCommandIntent,
    AmbulatoryCommandMarker, AmbulatoryCommandOperation, AmbulatoryCommandOutcome,
    AmbulatoryCommandPreview, AmbulatoryCommandRead, AmbulatoryCommandRecoveryStore,
    AmbulatoryCommandRetirement, AmbulatoryCommandTerminal, HostAmbulatoryCommand,
};
use std::{
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

fn copy(section: &str, key: &str) -> &'static str {
    static COPY: OnceLock<serde_json::Value> = OnceLock::new();
    COPY.get_or_init(|| {
        serde_json::from_str(include_str!("ambulatory_command_copy.json")).expect("command copy")
    })[section][key]
        .as_str()
        .expect("command copy key")
}
fn formatted(section: &str, key: &str, values: &[(&str, String)]) -> String {
    values.iter().fold(
        copy(section, key).to_owned(),
        |value, (key, replacement)| value.replace(&format!("{{{key}}}"), replacement),
    )
}
#[derive(Clone)]
enum Mode {
    Execute(AmbulatoryCommandIntent),
    Recover(AmbulatoryCommandMarker),
}
impl Mode {
    fn operation(&self) -> AmbulatoryCommandOperation {
        match self {
            Self::Execute(intent) => intent.operation,
            Self::Recover(marker) => marker.operation,
        }
    }
    fn recovery(&self) -> bool {
        matches!(self, Self::Recover(_))
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Preparing,
    Authentication,
    Authorizing,
    Confirm,
    Sending,
    AdmissionFailed,
    Unknown,
    Terminal,
    Failed,
    Cancelled,
}
enum Cleanup {
    Idle,
    Pending,
    Confirmed(Arc<AmbulatoryCommandRetirement>),
    Unconfirmed,
}
struct Dialog {
    id: Arc<()>,
    mode: Mode,
    fields: Vec<Field>,
    context: AmbulatoryCommandContext,
    flow: Option<Arc<HostAmbulatoryCommand>>,
    preview: Option<AmbulatoryCommandPreview>,
    phase: Phase,
    busy: bool,
    attempted: bool,
    result: Option<AmbulatoryCommandRead>,
    error: Option<RuntimeError>,
    ack_error: bool,
    cleanup: Cleanup,
    focus_field: Option<usize>,
    invalidated: bool,
    cleanup_started: Arc<AtomicBool>,
    _subscriptions: Vec<Subscription>,
}
#[derive(Default)]
pub(super) struct Commands {
    dialog: Option<Dialog>,
    store: Option<AmbulatoryCommandRecoveryStore>,
    marker: Option<AmbulatoryCommandMarker>,
    loading: Option<Arc<()>>,
    loaded: bool,
    error: Option<RuntimeError>,
    #[cfg(all(test, target_os = "macos"))]
    clock_override_ms: Option<Arc<std::sync::atomic::AtomicU64>>,
}
impl Commands {
    fn now_ms(&self) -> u64 {
        #[cfg(all(test, target_os = "macos"))]
        if let Some(clock) = &self.clock_override_ms {
            return clock.load(Ordering::Acquire);
        }
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_millis() as u64)
    }
    pub(super) fn is_saving(&self) -> bool {
        self.dialog.as_ref().is_some_and(|dialog| dialog.busy)
    }
    pub(super) fn is_open(&self) -> bool {
        self.dialog.is_some()
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) {
        self.loading = None;
        self.loaded = false;
        if let Some(dialog) = self.dialog.take() {
            dialog.context.cancel();
            for field in dialog.fields {
                field.editor.update(cx, |input, cx| input.retire(cx));
            }
            if let Some(flow) = dialog.flow {
                flow.cancel_local();
                if !dialog.cleanup_started.swap(true, Ordering::AcqRel) {
                    cx.background_executor()
                        .spawn(async move {
                            let _ = flow.retire();
                        })
                        .detach();
                }
            }
        }
    }
    pub(super) fn cancel_requests(&mut self) {
        if let Some(dialog) = &mut self.dialog {
            dialog.invalidated = true;
            dialog.context.cancel();
            if let Some(flow) = &dialog.flow {
                flow.cancel_local();
            }
        }
    }
    fn can_begin(&self) -> bool {
        self.loaded
            && self.loading.is_none()
            && self.error.is_none()
            && self.marker.is_none()
            && self.dialog.is_none()
            && self.store.is_some()
    }
}
enum AuthorizeResult {
    Preview(Box<AmbulatoryCommandPreview>),
    Recovery(AmbulatoryCommandRead),
}
enum SendResult {
    Expired,
    AdmissionFailed(RuntimeError),
    Executed(Result<AmbulatoryCommandRead, RuntimeError>),
}
fn dialog_authorized(dialog: &Dialog) -> bool {
    dialog
        .flow
        .as_ref()
        .is_some_and(|flow| flow.authority() == AmbulatoryCommandAuthority::Authorized)
}
fn dialog_state_message(dialog: &Dialog) -> Option<&'static str> {
    match dialog.phase {
        Phase::Preparing => Some(copy("stati", "preparazione")),
        Phase::Authorizing => Some(copy("stati", "autorizzazione")),
        Phase::Sending => Some(copy("stati", "invio")),
        Phase::Unknown if dialog.mode.recovery() && dialog_authorized(dialog) => {
            Some(copy("stati", "non_registrato"))
        }
        Phase::Unknown => Some(copy("stati", "ignoto")),
        Phase::AdmissionFailed => Some(copy("errori", "storage")),
        Phase::Cancelled => Some(copy(
            "stati",
            if dialog.mode.recovery() {
                "ignoto"
            } else {
                "rejected"
            },
        )),
        _ => None,
    }
}
fn dialog_error_context(dialog: &Dialog, error: RuntimeError) -> &'static str {
    if dialog.ack_error {
        copy("errori", "ack_locale")
    } else if error == RuntimeError::Conflict {
        copy("errori", "piano_cambiato")
    } else if matches!(
        error,
        RuntimeError::Rejected(401) | RuntimeError::Forbidden | RuntimeError::Authentication
    ) {
        if dialog.phase == Phase::Failed && dialog.attempted && !dialog.mode.recovery() {
            copy("errori", "accesso_scaduto_prima_invio")
        } else {
            copy("errori", "accesso_scaduto")
        }
    } else if dialog.phase == Phase::Unknown {
        copy("errori", "risposta_persa")
    } else {
        copy("errori", "autorizzazione")
    }
}
fn terminal_detail_message(terminal: &AmbulatoryCommandTerminal) -> Option<&'static str> {
    if terminal.receipt().outcome != AmbulatoryCommandOutcome::Rejected {
        return None;
    }
    match terminal.receipt().reason.as_deref() {
        Some("plan_changed") => Some(copy("stati", "rejected_piano_cambiato")),
        Some("not_admissible") => Some(copy("stati", "rejected_non_ammesso")),
        _ => None,
    }
}

impl ClinicalApp {
    pub(super) fn load_ambulatory_command_recovery(&mut self, cx: &mut Context<Self>) {
        if self.ambulatory_management.destructive.loading.is_some()
            || self.ambulatory_management.destructive.dialog.is_some()
        {
            return;
        }
        let Some(session) = self
            .session
            .clone()
            .filter(RuntimeSession::can_prepare_ambulatory_command)
        else {
            return;
        };
        let directory = match self.local_preferences.ambulatory_command_directory() {
            Ok(directory) => directory,
            Err(error) => {
                self.preferences_error = Some(error.to_string());
                self.preferences_issue = Some(PreferenceIssue::Read);
                None
            }
        };
        let Some(directory) = directory else {
            let state = &mut self.ambulatory_management.destructive;
            state.loaded = true;
            state.error = Some(RuntimeError::ReadRequired);
            return;
        };
        let id = Arc::new(());
        self.ambulatory_management.destructive.loading = Some(id.clone());
        let epoch = self.epoch;
        let authority = self.account_profile.generation;
        let task = cx.background_executor().spawn(async move {
            let store = session.ambulatory_command_recovery_store(&directory)?;
            let marker = store.load()?;
            Ok::<_, RuntimeError>((store, marker))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                if this.check_callback(authority, result.as_ref().err().copied(), cx)
                    != CallbackState::Current
                    || this.epoch != epoch
                {
                    return;
                }
                let state = &mut this.ambulatory_management.destructive;
                if !state
                    .loading
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &id))
                {
                    return;
                }
                state.loading = None;
                state.loaded = true;
                match result {
                    Ok((store, marker)) => {
                        state.store = Some(store);
                        state.marker = marker;
                        state.error = None;
                    }
                    Err(error) => {
                        state.store = None;
                        state.error = Some(error);
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    pub(super) fn can_open_ambulatory_command(&self) -> bool {
        crate::native_lock::available()
            && self
                .session
                .as_ref()
                .is_some_and(RuntimeSession::can_prepare_ambulatory_command)
            && self.ambulatory_management.destructive.can_begin()
            && self.ambulatory_management.draft.is_none()
            && !self.ambulatory_management.has_bootstrap()
    }
    pub(super) fn open_ambulatory_command(
        &mut self,
        id: &str,
        operation: AmbulatoryCommandOperation,
        cx: &mut Context<Self>,
    ) {
        if !self.can_open_ambulatory_command() {
            return;
        }
        let (Some(scope), Some(row)) = (
            self.scope.clone(),
            self.ambulatories
                .ready()
                .and_then(|rows| rows.iter().find(|row| row.id == id)),
        ) else {
            return;
        };
        if operation == AmbulatoryCommandOperation::ClearTest && row.kind.as_deref() != Some("test")
        {
            return;
        }
        let intent = AmbulatoryCommandIntent {
            operation,
            original_scope_id: scope,
            ambulatory_id: row.id.clone(),
            expected_version: row.version,
        };
        self.begin_ambulatory_command(Mode::Execute(intent), cx);
    }
    fn recover_ambulatory_command(&mut self, cx: &mut Context<Self>) {
        let marker = self
            .ambulatory_management
            .destructive
            .marker
            .clone()
            .or_else(|| {
                self.ambulatory_management
                    .destructive
                    .dialog
                    .as_ref()
                    .and_then(|dialog| {
                        dialog
                            .preview
                            .as_ref()
                            .map(|preview| preview.marker.clone())
                    })
            });
        let Some(marker) = marker else {
            return;
        };
        self.ambulatory_management.destructive.withdraw(cx);
        self.begin_ambulatory_command(Mode::Recover(marker), cx);
    }
    fn begin_ambulatory_command(&mut self, mode: Mode, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else {
            return;
        };
        let context = match &mode {
            Mode::Execute(intent) => session.ambulatory_command_context(intent.clone()),
            Mode::Recover(marker) => session.ambulatory_command_recovery_context(marker.clone()),
        };
        let mut context = match context {
            Ok(context) => context,
            Err(error) => {
                self.ambulatory_management.destructive.error = Some(error);
                cx.notify();
                return;
            }
        };
        if let Err(error) = crate::native_lock::bind(&mut context) {
            self.ambulatory_management.destructive.error = Some(error);
            cx.notify();
            return;
        }
        let confirmation = match mode.operation() {
            AmbulatoryCommandOperation::ClearTest => copy("autorizzazione", "conferma_clear"),
            AmbulatoryCommandOperation::Delete => copy("autorizzazione", "conferma_delete"),
        };
        let mut fields = vec![
            Field::new(
                "ambulatory-command-passphrase",
                copy("autorizzazione", "passphrase"),
                "",
                false,
                true,
                self.theme,
                cx,
            )
            .with_scroll(&self.area_scroll, cx),
            Field::new(
                "ambulatory-command-word",
                confirmation,
                "",
                false,
                false,
                self.theme,
                cx,
            )
            .with_scroll(&self.area_scroll, cx),
        ];
        let subscriptions = fields
            .iter_mut()
            .map(|field| cx.subscribe(&field.editor, |_, _, _: &InputChanged, cx| cx.notify()))
            .collect();
        let id = Arc::new(());
        let epoch = self.epoch;
        let authority = self.account_profile.generation;
        let cleanup_started = Arc::new(AtomicBool::new(false));
        self.ambulatory_management.destructive.dialog = Some(Dialog {
            id: id.clone(),
            mode,
            fields,
            context: context.clone(),
            flow: None,
            preview: None,
            phase: Phase::Preparing,
            busy: true,
            attempted: false,
            result: None,
            error: None,
            ack_error: false,
            cleanup: Cleanup::Idle,
            focus_field: None,
            invalidated: false,
            cleanup_started: cleanup_started.clone(),
            _subscriptions: subscriptions,
        });
        let task = cx
            .background_executor()
            .spawn(async move { session.prepare_ambulatory_command(&context).map(Arc::new) });
        cx.spawn(async move |this, cx| {
            let mut pending = Some(task.await);
            let _ = this.update(cx, |this, cx| {
                if !this.command_callback_current(
                    &id,
                    epoch,
                    authority,
                    pending
                        .as_ref()
                        .and_then(|value| value.as_ref().err())
                        .copied(),
                    cx,
                ) {
                    return;
                }
                let dialog = this
                    .ambulatory_management
                    .destructive
                    .dialog
                    .as_mut()
                    .unwrap();
                dialog.busy = false;
                match pending.take().unwrap() {
                    Ok(flow) => {
                        dialog.flow = Some(flow);
                        dialog.phase = Phase::Authentication;
                        dialog.focus_field = Some(0);
                    }
                    Err(error) => {
                        dialog.phase = Phase::Failed;
                        dialog.error = Some(error);
                    }
                }
                cx.notify();
            });
            if let Some(Ok(flow)) = pending {
                flow.cancel_local();
                if !cleanup_started.swap(true, Ordering::AcqRel) {
                    cx.background_executor()
                        .spawn(async move {
                            let _ = flow.retire();
                        })
                        .detach();
                }
            }
        })
        .detach();
        cx.notify();
    }
    fn command_callback_current(
        &mut self,
        id: &Arc<()>,
        epoch: u64,
        authority: u64,
        error: Option<RuntimeError>,
        cx: &mut Context<Self>,
    ) -> bool {
        if self
            .ambulatory_management
            .destructive
            .dialog
            .as_ref()
            .is_some_and(|dialog| {
                Arc::ptr_eq(&dialog.id, id) && !crate::native_lock::current(&dialog.context)
            })
        {
            self.withdraw_ambulatory_command_view(cx);
            cx.notify();
            return false;
        }
        self.check_callback(authority, error, cx) == CallbackState::Current
            && self.epoch == epoch
            && self
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| Arc::ptr_eq(&dialog.id, id))
    }
    fn authorize_ambulatory_command(&mut self, cx: &mut Context<Self>) {
        if self.withdraw_cancelled_ambulatory_command(cx) {
            return;
        }
        let now_ms = self.ambulatory_management.destructive.now_ms();
        let Some(dialog) = &mut self.ambulatory_management.destructive.dialog else {
            return;
        };
        if dialog.busy || dialog.phase != Phase::Authentication {
            return;
        }
        let Some(flow) = dialog.flow.clone() else {
            return;
        };
        let passphrase = Zeroizing::new(dialog.fields[0].value(cx));
        if passphrase.is_empty() {
            return;
        }
        dialog.fields[0]
            .editor
            .update(cx, |input, cx| input.retire(cx));
        dialog.busy = true;
        dialog.phase = Phase::Authorizing;
        dialog.error = None;
        let recovery = dialog.mode.recovery();
        let id = dialog.id.clone();
        let epoch = self.epoch;
        let authority = self.account_profile.generation;
        let current = flow.clone();
        let cleanup_started = dialog.cleanup_started.clone();
        let task = cx.background_executor().spawn(async move {
            if current.expired_at(now_ms) {
                drop(passphrase);
                return Err(RuntimeError::Rejected(401));
            }
            let authorization = current.authenticate(&passphrase);
            drop(passphrase);
            authorization?;
            if recovery {
                current.read_receipt().map(AuthorizeResult::Recovery)
            } else {
                current
                    .preview()
                    .map(|preview| AuthorizeResult::Preview(Box::new(preview)))
            }
        });
        cx.spawn(async move |this, cx| {
            let mut pending = Some(task.await);
            let _ = this.update(cx, |this, cx| {
                if !this.command_callback_current(
                    &id,
                    epoch,
                    authority,
                    pending
                        .as_ref()
                        .and_then(|value| value.as_ref().err())
                        .copied(),
                    cx,
                ) {
                    return;
                }
                let dialog = this
                    .ambulatory_management
                    .destructive
                    .dialog
                    .as_mut()
                    .unwrap();
                dialog.busy = false;
                match pending.take().unwrap() {
                    Ok(AuthorizeResult::Preview(preview)) => {
                        dialog.preview = Some(*preview);
                        dialog.phase = Phase::Confirm;
                        dialog.focus_field = Some(1);
                    }
                    Ok(AuthorizeResult::Recovery(AmbulatoryCommandRead::Unknown)) => {
                        dialog.phase = Phase::Unknown;
                        dialog.result = Some(AmbulatoryCommandRead::Unknown);
                    }
                    Ok(AuthorizeResult::Recovery(result)) => {
                        dialog.phase = Phase::Terminal;
                        dialog.result = Some(result);
                    }
                    Err(error) => {
                        dialog.phase = Phase::Failed;
                        dialog.error = Some(error);
                    }
                }
                let should_retire = this
                    .ambulatory_management
                    .destructive
                    .dialog
                    .as_ref()
                    .is_some_and(|dialog| {
                        matches!(dialog.phase, Phase::Failed | Phase::Terminal)
                            || !dialog_authorized(dialog)
                    });
                if should_retire {
                    this.retire_ambulatory_command_access(cx);
                }
                cx.notify();
            });
            if pending.is_some() {
                flow.cancel_local();
                if !cleanup_started.swap(true, Ordering::AcqRel) {
                    cx.background_executor()
                        .spawn(async move {
                            let _ = flow.retire();
                        })
                        .detach();
                }
            }
        })
        .detach();
        cx.notify();
    }
    fn confirm_ambulatory_command(&mut self, cx: &mut Context<Self>) {
        if self.withdraw_cancelled_ambulatory_command(cx) {
            return;
        }
        let now_ms = self.ambulatory_management.destructive.now_ms();
        let Some(store) = self.ambulatory_management.destructive.store.clone() else {
            return;
        };
        let Some(dialog) = &mut self.ambulatory_management.destructive.dialog else {
            return;
        };
        if dialog.busy
            || dialog.attempted
            || dialog.phase != Phase::Confirm
            || dialog.mode.recovery()
        {
            return;
        }
        let word = dialog.fields[1].value(cx);
        if word != dialog.mode.operation().confirmation() {
            return;
        }
        let Some(flow) = dialog.flow.clone() else {
            return;
        };
        dialog.busy = true;
        dialog.attempted = true;
        dialog.phase = Phase::Sending;
        dialog.error = None;
        for field in &dialog.fields {
            field.editor.update(cx, |input, cx| input.retire(cx));
        }
        let id = dialog.id.clone();
        let epoch = self.epoch;
        let authority = self.account_profile.generation;
        let current = flow.clone();
        let cleanup_started = dialog.cleanup_started.clone();
        let task = cx.background_executor().spawn(async move {
            if current.expired_at(now_ms) {
                SendResult::Expired
            } else {
                match current.persist_preview(&store) {
                    Err(error) => SendResult::AdmissionFailed(error),
                    Ok(proof) => SendResult::Executed(current.execute(&proof, &word)),
                }
            }
        });
        cx.spawn(async move |this, cx| {
            let mut pending = Some(task.await);
            let _ = this.update(cx, |this, cx| {
                let error = match pending.as_ref().unwrap() {
                    SendResult::Expired => Some(RuntimeError::Rejected(401)),
                    SendResult::AdmissionFailed(error) => Some(*error),
                    SendResult::Executed(result) => result.as_ref().err().copied(),
                };
                if !this.command_callback_current(&id, epoch, authority, error, cx) {
                    return;
                }
                let state = &mut this.ambulatory_management.destructive;
                let dialog = state.dialog.as_mut().unwrap();
                dialog.busy = false;
                match pending.take().unwrap() {
                    SendResult::Expired => {
                        dialog.phase = Phase::Failed;
                        dialog.error = Some(RuntimeError::Rejected(401));
                    }
                    SendResult::AdmissionFailed(error) => {
                        dialog.phase = Phase::AdmissionFailed;
                        dialog.error = Some(error);
                    }
                    SendResult::Executed(result) => {
                        if let Some(preview) = &dialog.preview {
                            state.marker = Some(preview.marker.clone());
                        }
                        match result {
                            Ok(result) => {
                                dialog.phase = Phase::Terminal;
                                dialog.result = Some(result);
                            }
                            Err(error) => {
                                dialog.phase = Phase::Unknown;
                                dialog.error = Some(error);
                            }
                        }
                    }
                }
                this.retire_ambulatory_command_access(cx);
                cx.notify();
            });
            if pending.is_some() {
                flow.cancel_local();
                if !cleanup_started.swap(true, Ordering::AcqRel) {
                    cx.background_executor()
                        .spawn(async move {
                            let _ = flow.retire();
                        })
                        .detach();
                }
            }
        })
        .detach();
        cx.notify();
    }
    fn read_or_close_ambulatory_command(&mut self, close: bool, cx: &mut Context<Self>) {
        if self.withdraw_cancelled_ambulatory_command(cx) {
            return;
        }
        let Some(dialog) = &mut self.ambulatory_management.destructive.dialog else {
            return;
        };
        if dialog.busy
            || close && dialog.attempted
            || !dialog.mode.recovery()
            || dialog.phase != Phase::Confirm && dialog.phase != Phase::Unknown
        {
            return;
        }
        let Some(flow) = dialog.flow.clone() else {
            return;
        };
        if flow.authority() != AmbulatoryCommandAuthority::Authorized {
            return;
        }
        dialog.busy = true;
        if close {
            dialog.attempted = true;
        }
        dialog.error = None;
        let id = dialog.id.clone();
        let epoch = self.epoch;
        let authority = self.account_profile.generation;
        let current = flow.clone();
        let cleanup_started = dialog.cleanup_started.clone();
        let task = cx.background_executor().spawn(async move {
            if close {
                current.close()
            } else {
                current.read_receipt()
            }
        });
        cx.spawn(async move |this, cx| {
            let mut pending = Some(task.await);
            let _ = this.update(cx, |this, cx| {
                if !this.command_callback_current(
                    &id,
                    epoch,
                    authority,
                    pending
                        .as_ref()
                        .and_then(|result| result.as_ref().err())
                        .copied(),
                    cx,
                ) {
                    return;
                }
                let dialog = this
                    .ambulatory_management
                    .destructive
                    .dialog
                    .as_mut()
                    .unwrap();
                dialog.busy = false;
                match pending.take().unwrap() {
                    Ok(AmbulatoryCommandRead::Unknown) => {
                        dialog.phase = Phase::Unknown;
                        dialog.result = Some(AmbulatoryCommandRead::Unknown);
                    }
                    Ok(result) => {
                        dialog.phase = Phase::Terminal;
                        dialog.result = Some(result);
                    }
                    Err(error) => {
                        dialog.phase = Phase::Unknown;
                        dialog.error = Some(error);
                    }
                }
                let should_retire = this
                    .ambulatory_management
                    .destructive
                    .dialog
                    .as_ref()
                    .is_some_and(|dialog| {
                        dialog.phase == Phase::Terminal || !dialog_authorized(dialog)
                    });
                if should_retire {
                    this.retire_ambulatory_command_access(cx);
                }
                cx.notify();
            });
            if pending.is_some() {
                flow.cancel_local();
                if !cleanup_started.swap(true, Ordering::AcqRel) {
                    cx.background_executor()
                        .spawn(async move {
                            let _ = flow.retire();
                        })
                        .detach();
                }
            }
        })
        .detach();
        cx.notify();
    }
    fn retire_ambulatory_command_access(&mut self, cx: &mut Context<Self>) {
        let Some(dialog) = &mut self.ambulatory_management.destructive.dialog else {
            return;
        };
        if matches!(dialog.cleanup, Cleanup::Pending | Cleanup::Confirmed(_)) {
            return;
        }
        let Some(flow) = dialog.flow.clone() else {
            return;
        };
        if dialog.cleanup_started.swap(true, Ordering::AcqRel) {
            return;
        }
        dialog.cleanup = Cleanup::Pending;
        flow.cancel_local();
        let id = dialog.id.clone();
        let authority = self.account_profile.generation;
        let task = cx
            .background_executor()
            .spawn(async move { flow.retire().map(Arc::new) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                if this.account_profile.generation != authority {
                    return;
                }
                if this.withdraw_cancelled_ambulatory_command(cx) {
                    return;
                }
                let Some(dialog) = &mut this.ambulatory_management.destructive.dialog else {
                    return;
                };
                if !Arc::ptr_eq(&dialog.id, &id) {
                    return;
                }
                let close_after = dialog.phase == Phase::Cancelled && result.is_ok();
                dialog.cleanup = match result {
                    Ok(proof) => Cleanup::Confirmed(proof),
                    Err(_) => Cleanup::Unconfirmed,
                };
                if close_after {
                    this.close_ambulatory_command_view(cx);
                }
                cx.notify();
            });
        })
        .detach();
    }
    fn retry_ambulatory_command_retirement(&mut self, cx: &mut Context<Self>) {
        let Some(dialog) = &mut self.ambulatory_management.destructive.dialog else {
            return;
        };
        if !matches!(dialog.cleanup, Cleanup::Unconfirmed) {
            return;
        }
        dialog.cleanup = Cleanup::Idle;
        dialog.cleanup_started.store(false, Ordering::Release);
        self.retire_ambulatory_command_access(cx);
        cx.notify();
    }
    fn cancel_ambulatory_command(&mut self, cx: &mut Context<Self>) {
        let Some(dialog) = &mut self.ambulatory_management.destructive.dialog else {
            return;
        };
        if dialog.attempted {
            self.close_ambulatory_command_view(cx);
            return;
        }
        let may_have_session = dialog.flow.is_some()
            && !matches!(dialog.phase, Phase::Preparing | Phase::Authentication);
        dialog.context.cancel();
        dialog.id = Arc::new(());
        dialog.busy = false;
        dialog.phase = Phase::Cancelled;
        dialog.error = None;
        for field in &dialog.fields {
            field.editor.update(cx, |input, cx| input.retire(cx));
        }
        if may_have_session {
            self.retire_ambulatory_command_access(cx);
        } else {
            self.close_ambulatory_command_view(cx);
        }
        cx.notify();
    }
    pub(super) fn close_ambulatory_command_view(&mut self, cx: &mut Context<Self>) {
        if self.withdraw_cancelled_ambulatory_command(cx) {
            return;
        }
        let state = &mut self.ambulatory_management.destructive;
        let acknowledge =
            state
                .dialog
                .as_ref()
                .and_then(|dialog| match (&dialog.result, &dialog.cleanup) {
                    (
                        Some(AmbulatoryCommandRead::Terminal(terminal)),
                        Cleanup::Confirmed(proof),
                    ) => Some((terminal.clone(), proof.clone(), dialog.id.clone())),
                    _ => None,
                });
        if let (Some((terminal, proof, id)), Some(store)) = (acknowledge, state.store.clone()) {
            if let Some(dialog) = &mut state.dialog {
                if dialog.busy {
                    state.withdraw(cx);
                    self.load_ambulatory_command_recovery(cx);
                    cx.notify();
                    return;
                }
                dialog.busy = true;
            }
            let authority = self.account_profile.generation;
            let task = cx.background_executor().spawn(async move {
                store.acknowledge_terminal(&terminal.receipt().marker(), &terminal, &proof)
            });
            cx.spawn(async move |this, cx| {
                let result = task.await;
                let _ = this.update(cx, |this, cx| {
                    if this.account_profile.generation != authority {
                        return;
                    }
                    if this.withdraw_cancelled_ambulatory_command(cx) {
                        return;
                    }
                    let state = &mut this.ambulatory_management.destructive;
                    if !state
                        .dialog
                        .as_ref()
                        .is_some_and(|dialog| Arc::ptr_eq(&dialog.id, &id))
                    {
                        return;
                    }
                    match result {
                        Ok(()) => {
                            state.withdraw(cx);
                            state.marker = None;
                        }
                        Err(error) => {
                            if let Some(dialog) = &mut state.dialog {
                                dialog.busy = false;
                                dialog.ack_error = true;
                                dialog.error = Some(error);
                            }
                        }
                    }
                    this.load_ambulatory_command_recovery(cx);
                    cx.notify();
                });
            })
            .detach();
        } else {
            state.withdraw(cx);
            self.load_ambulatory_command_recovery(cx);
            cx.notify();
        }
    }
    fn withdraw_cancelled_ambulatory_command(&mut self, cx: &mut Context<Self>) -> bool {
        if self
            .ambulatory_management
            .destructive
            .dialog
            .as_ref()
            .is_some_and(|dialog| {
                dialog.invalidated || !crate::native_lock::current(&dialog.context)
            })
        {
            self.withdraw_ambulatory_command_view(cx);
            cx.notify();
            return true;
        }
        false
    }
    pub(super) fn withdraw_ambulatory_command_view(&mut self, cx: &mut Context<Self>) {
        self.ambulatory_management.destructive.withdraw(cx);
    }
}

pub(super) fn command_button_ids() -> Vec<String> {
    [
        "recover", "refresh", "auth", "confirm", "verify", "stop", "cleanup", "close", "cancel",
        "reread",
    ]
    .into_iter()
    .map(|action| format!("ambulatory-command-{action}"))
    .collect()
}
impl ClinicalApp {
    pub(super) fn prepare_ambulatory_command_view(
        &mut self,
        theme: Theme,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.withdraw_cancelled_ambulatory_command(cx) {
            return;
        }
        let Some(dialog) = &mut self.ambulatory_management.destructive.dialog else {
            return;
        };
        for (index, field) in dialog.fields.iter().enumerate() {
            let enabled = !dialog.busy
                && (index == 0 && dialog.phase == Phase::Authentication
                    || index == 1
                        && dialog.phase == Phase::Confirm
                        && !dialog.mode.recovery()
                        && !dialog.attempted);
            field
                .editor
                .update(cx, |input, cx| input.configure(theme, !enabled, cx));
            if let Some(target) = &field.scroll_target {
                target.reveal_if_focused(window, cx);
            }
        }
        if let Some(index) = dialog.focus_field.take() {
            let field = &dialog.fields[index];
            field.editor.update(cx, |input, cx| input.focus(window, cx));
            if let Some(target) = &field.scroll_target {
                target.scroll_to(window, cx);
            }
        }
    }
    pub(super) fn ambulatory_command_row_label(clear: bool) -> &'static str {
        copy("azioni_riga", if clear { "clear" } else { "delete" })
    }
    pub(super) fn ambulatory_command_view(&self, cx: &Context<Self>) -> Div {
        let state = &self.ambulatory_management.destructive;
        let theme = self.theme;
        if !self
            .session
            .as_ref()
            .is_some_and(RuntimeSession::can_prepare_ambulatory_command)
            && state.dialog.is_none()
        {
            return div();
        }
        let mut view = div().flex().flex_col().gap(px(12.));
        if state.loading.is_some() {
            view = view.child(notice(
                "ambulatory-command-store-loading",
                copy("stati", "preparazione"),
                theme,
                false,
            ));
        }
        if let Some(error) = state.error {
            view = view.child(notice(
                "ambulatory-command-store-error",
                format!("{} {}", copy("errori", "recupero_locale"), ui_error(error)),
                theme,
                true,
            ));
        }
        if state.dialog.is_none() {
            if state.marker.is_some() {
                view = view.child(
                    self.ambulatory_button(
                        "ambulatory-command-recover",
                        copy("titoli", "recovery"),
                        theme,
                        true,
                        state.loading.is_none(),
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.recover_ambulatory_command(cx))),
                );
            }
            if state.error.is_some() || !state.loaded {
                view = view.child(
                    self.ambulatory_button(
                        "ambulatory-command-refresh",
                        copy("azioni", "verifica"),
                        theme,
                        false,
                        state.loading.is_none(),
                    )
                    .on_click(
                        cx.listener(|this, _, _, cx| this.load_ambulatory_command_recovery(cx)),
                    ),
                );
            }
            return view;
        }
        let dialog = state.dialog.as_ref().unwrap();
        let terminal = match &dialog.result {
            Some(AmbulatoryCommandRead::Terminal(terminal)) => Some(terminal),
            _ => None,
        };
        let title = terminal
            .map(|terminal| {
                copy(
                    "stati",
                    match terminal.receipt().outcome {
                        AmbulatoryCommandOutcome::Applied => "applied",
                        AmbulatoryCommandOutcome::Rejected => "rejected",
                        AmbulatoryCommandOutcome::Closed => "closed",
                    },
                )
            })
            .unwrap_or_else(|| {
                copy(
                    "titoli",
                    if dialog.mode.recovery() {
                        "recovery"
                    } else if dialog.mode.operation() == AmbulatoryCommandOperation::ClearTest {
                        "clear"
                    } else {
                        "delete"
                    },
                )
            });
        view = view.child(heading("ambulatory-command-title", title, theme));
        if dialog.mode.recovery() {
            view = view.child(notice(
                "ambulatory-command-previous-session",
                copy("recupero", "sessione_precedente"),
                theme,
                false,
            ));
        }
        let progress = dialog_state_message(dialog);
        if let Some(progress) = progress {
            view = view.child(notice(
                "ambulatory-command-state",
                progress,
                theme,
                matches!(dialog.phase, Phase::Unknown | Phase::AdmissionFailed),
            ));
        }
        if let Some(error) = dialog
            .error
            .filter(|_| dialog.phase != Phase::AdmissionFailed)
        {
            let context = dialog_error_context(dialog, error);
            view = view.child(notice(
                "ambulatory-command-error",
                format!("{context} {}", ui_error(error)),
                theme,
                true,
            ));
        }
        if dialog.phase == Phase::Authentication || dialog.phase == Phase::Authorizing {
            view = view
                .child(self.field_view(
                    &dialog.fields[0],
                    "ambulatory-command-passphrase-field",
                    cx,
                ))
                .child(
                    self.ambulatory_button(
                        "ambulatory-command-auth",
                        copy("azioni", "autorizza"),
                        theme,
                        true,
                        !dialog.busy && !dialog.fields[0].value(cx).is_empty(),
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.authorize_ambulatory_command(cx))),
                );
        }
        if dialog.phase == Phase::Confirm
            && !dialog.mode.recovery()
            && let Some(preview) = &dialog.preview
        {
            view = view.child(section(
                "ambulatory-command-preview",
                formatted(
                    "anteprima",
                    "titolo",
                    &[("ambulatorio", preview.target.name.clone())],
                ),
                theme,
            ));
            if let Some(counts) = &preview.counts {
                for (key, count) in [
                    ("cestino", counts.tombstoned_patients),
                    ("scollegati", counts.unlinked_patients),
                    ("preservate", counts.preserved_live_patients),
                ] {
                    view = view.child(
                        text!(formatted(
                            "anteprima",
                            key,
                            &[("conteggio", count.to_string())]
                        ))
                        .with_id(format!("ambulatory-command-count-{key}")),
                    );
                }
            } else {
                view = view.child(
                    text!(copy("anteprima", "delete")).with_id("ambulatory-command-delete-effect"),
                );
            }
            if let Some(fallback) = &preview.fallback {
                view = view.child(
                    text!(formatted(
                        "anteprima",
                        "predefinito",
                        &[("nome", fallback.name.clone())]
                    ))
                    .with_id("ambulatory-command-fallback"),
                );
            }
            view = view
                .child(self.field_view(
                    &dialog.fields[1],
                    "ambulatory-command-confirmation-field",
                    cx,
                ))
                .child(
                    self.ambulatory_button(
                        "ambulatory-command-confirm",
                        copy("azioni", "conferma"),
                        theme,
                        true,
                        !dialog.busy
                            && !dialog.attempted
                            && dialog.fields[1].value(cx) == dialog.mode.operation().confirmation(),
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.confirm_ambulatory_command(cx))),
                );
        }
        if let Some(terminal) = terminal {
            if let Some(detail) = terminal_detail_message(terminal) {
                view = view.child(notice(
                    "ambulatory-command-terminal-detail",
                    detail,
                    theme,
                    false,
                ));
            }
            if terminal.historical() {
                view = view.child(notice(
                    "ambulatory-command-historical",
                    copy("recupero", "storico"),
                    theme,
                    false,
                ));
            }
            view = view.child(
                self.ambulatory_button(
                    "ambulatory-command-reread",
                    copy("azioni", "rileggi"),
                    theme,
                    false,
                    !dialog.busy && !matches!(self.ambulatories, Load::Loading),
                )
                .on_click(cx.listener(|this, _, _, cx| {
                    this.ambulatory_management.rebase = true;
                    this.load_ambulatories(cx);
                })),
            );
        }
        let authorized = dialog_authorized(dialog);
        let recovery_ready = dialog.mode.recovery()
            && matches!(dialog.phase, Phase::Confirm | Phase::Unknown)
            && authorized;
        let needs_reauthorization = (dialog.phase == Phase::Unknown
            || dialog.phase == Phase::Failed && dialog.mode.recovery())
            && !recovery_ready;
        if recovery_ready {
            view = view
                .child(
                    self.ambulatory_button(
                        "ambulatory-command-verify",
                        copy("azioni", "verifica"),
                        theme,
                        true,
                        !dialog.busy,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.read_or_close_ambulatory_command(false, cx)
                    })),
                )
                .child(
                    text!(copy("azioni", "chiusura_spiegazione"))
                        .with_id("ambulatory-command-stop-explanation"),
                )
                .child(
                    self.ambulatory_button(
                        "ambulatory-command-stop",
                        copy("azioni", "chiusura_operazione"),
                        theme,
                        false,
                        !dialog.busy && !dialog.attempted,
                    )
                    .on_click(
                        cx.listener(|this, _, _, cx| {
                            this.read_or_close_ambulatory_command(true, cx)
                        }),
                    ),
                );
        } else if needs_reauthorization && (state.marker.is_some() || dialog.preview.is_some()) {
            view = view.child(
                self.ambulatory_button(
                    "ambulatory-command-verify",
                    copy("azioni", "autorizza_di_nuovo"),
                    theme,
                    true,
                    !dialog.busy,
                )
                .on_click(cx.listener(|this, _, _, cx| this.recover_ambulatory_command(cx))),
            );
        }
        match dialog.cleanup {
            Cleanup::Confirmed(_) => {
                view = view.child(notice(
                    "ambulatory-command-session-closed",
                    copy("stati", "ritiro_confermato"),
                    theme,
                    false,
                ))
            }
            Cleanup::Unconfirmed => {
                view = view
                    .child(notice(
                        "ambulatory-command-session-unconfirmed",
                        copy("stati", "ritiro_non_confermato"),
                        theme,
                        true,
                    ))
                    .child(
                        self.ambulatory_button(
                            "ambulatory-command-cleanup",
                            copy("azioni", "riprova_ritiro"),
                            theme,
                            false,
                            true,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.retry_ambulatory_command_retirement(cx)
                        })),
                    )
            }
            _ => {}
        }
        if terminal.is_some() && !matches!(dialog.cleanup, Cleanup::Confirmed(_)) {
            view = view.child(notice(
                "ambulatory-command-close-waits",
                copy("azioni", "chiudi_attesa"),
                theme,
                false,
            ));
        }
        view.child(
            div()
                .flex()
                .flex_wrap()
                .gap(px(12.))
                .child(
                    self.ambulatory_button(
                        "ambulatory-command-close",
                        copy("azioni", "chiudi"),
                        theme,
                        terminal.is_some(),
                        true,
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.close_ambulatory_command_view(cx))),
                )
                .when(
                    !dialog.attempted && terminal.is_none() && dialog.phase != Phase::Cancelled,
                    |view| {
                        view.child(
                            self.ambulatory_button(
                                "ambulatory-command-cancel",
                                copy("azioni", "annulla"),
                                theme,
                                false,
                                true,
                            )
                            .on_click(
                                cx.listener(|this, _, _, cx| this.cancel_ambulatory_command(cx)),
                            ),
                        )
                    },
                ),
        )
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::{
        collections::HashMap,
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        os::unix::fs::DirBuilderExt,
        path::PathBuf,
        sync::{
            Mutex,
            atomic::{AtomicU64, Ordering},
        },
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    const GENERATION: &str = "22222222-2222-4222-8222-222222222222";
    const PASSPHRASE: &str = "Synthetic scales fixture passphrase";
    const SALT: &str = "AwMDAwMDAwMDAwMDAwMDAw==";
    const WRAPPED_KEY: &str =
        "v3:BQUFBQUFBQUFBQUFAm40aZvQGpityOwyLKhsE40tJdbsjtrugIXzoJ/lk9gjlh5j7pIPeh7DLQ7ikGhA";
    const PREPARATION_MS: u64 = 300_000;
    const CHALLENGE_MS: u64 = 30_000;

    #[derive(Clone)]
    struct FlowState {
        command_id: String,
        ambulatory_id: String,
        original_scope_id: String,
        expected_version: u64,
        operation: String,
        plan_digest: Option<String>,
        control_id: String,
        session_id: Option<String>,
        created_at: u64,
        expires_at: u64,
        session_created_at: Option<u64>,
        expired: bool,
        retired: bool,
    }

    #[derive(Clone)]
    struct LedgerRow {
        marker: Value,
        outcome: String,
        reason: Option<String>,
        committed_at: u64,
        result: Value,
    }

    struct HostState {
        clock_ms: u64,
        next_flow: u64,
        target_version: u64,
        flows: HashMap<String, FlowState>,
        controls: HashMap<String, String>,
        ledger: HashMap<String, LedgerRow>,
        write_audits: Vec<(String, String, u64)>,
        retire_calls: usize,
        execute_calls: usize,
        receipt_calls: usize,
        close_calls: usize,
    }

    struct ControlledHost {
        session: RuntimeSession,
        state: Arc<Mutex<HostState>>,
        socket: std::net::SocketAddr,
        stop: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
        state_dir: PathBuf,
    }

    impl Drop for ControlledHost {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Release);
            let _ = TcpStream::connect(self.socket);
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
            let _ = std::fs::remove_dir_all(&self.state_dir);
        }
    }

    impl ControlledHost {
        fn new(initial_clock_ms: u64) -> Self {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let socket = listener.local_addr().unwrap();
            let state = Arc::new(Mutex::new(HostState {
                clock_ms: initial_clock_ms,
                next_flow: 0,
                target_version: 2,
                flows: HashMap::new(),
                controls: HashMap::new(),
                ledger: HashMap::new(),
                write_audits: Vec::new(),
                retire_calls: 0,
                execute_calls: 0,
                receipt_calls: 0,
                close_calls: 0,
            }));
            let shared = state.clone();
            let stop = Arc::new(AtomicBool::new(false));
            let stopping = stop.clone();
            let worker = thread::spawn(move || {
                loop {
                    let Ok((mut stream, _)) = listener.accept() else {
                        break;
                    };
                    if stopping.load(Ordering::Acquire) {
                        break;
                    }
                    stream
                        .set_read_timeout(Some(Duration::from_secs(10)))
                        .unwrap();
                    let Some((route, headers, body)) = read_http(&mut stream) else {
                        continue;
                    };
                    let (status, extra_headers, payload) =
                        handle_request(&shared, &route, &headers, &body);
                    let body_text = if status == 204 {
                        String::new()
                    } else {
                        payload.to_string()
                    };
                    let _ = write!(
                        stream,
                        "HTTP/1.1 {status} Synthetic\r\n{extra_headers}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body_text}",
                        body_text.len()
                    );
                    let _ = stream.flush();
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
                    PASSPHRASE,
                )
                .unwrap();
            session.list_ambulatories().unwrap();
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let dir = std::env::temp_dir().canonicalize().unwrap().join(format!(
                "mediflow-wul854-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            let mut builder = std::fs::DirBuilder::new();
            builder.recursive(true).mode(0o700);
            builder.create(&dir).unwrap();
            Self {
                session,
                state,
                socket,
                stop,
                worker: Some(worker),
                state_dir: dir,
            }
        }

        fn advance_ms(&self, delta_ms: u64) {
            self.state.lock().unwrap().clock_ms += delta_ms;
        }

        fn web_clear_target(&self) {
            let mut state = self.state.lock().unwrap();
            state.target_version += 1;
            let version = state.target_version;
            state
                .write_audits
                .push(("web".into(), "ambulatory.cleared".into(), version));
        }

        fn preferences(&self) -> LocalPreferencesStore {
            LocalPreferencesStore::from_directory(&self.state_dir).unwrap()
        }

        fn journal_json_count(&self) -> usize {
            let recovery = self.state_dir.join("ambulatory-command-recovery");
            let Ok(entries) = std::fs::read_dir(recovery) else {
                return 0;
            };
            entries
                .filter_map(|entry| entry.ok())
                .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
                .count()
        }
    }

    fn read_http(stream: &mut TcpStream) -> Option<(String, HashMap<String, String>, Value)> {
        let mut bytes = Vec::new();
        let mut buf = [0u8; 4096];
        let header_end = loop {
            let read = stream.read(&mut buf).ok()?;
            if read == 0 {
                return None;
            }
            bytes.extend_from_slice(&buf[..read]);
            if let Some(pos) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                break pos;
            }
        };
        let head = String::from_utf8(bytes[..header_end].to_vec()).ok()?;
        let mut lines = head.lines();
        let first = lines.next()?;
        let mut parts = first.split_whitespace();
        let route = format!("{} {}", parts.next()?, parts.next()?);
        let mut headers = HashMap::new();
        for line in lines {
            if let Some((name, value)) = line.split_once(':') {
                headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
            }
        }
        let len = headers
            .get("content-length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        while bytes.len() < header_end + 4 + len {
            let read = stream.read(&mut buf).ok()?;
            if read == 0 {
                break;
            }
            bytes.extend_from_slice(&buf[..read]);
        }
        let body = if len == 0 {
            Value::Null
        } else {
            serde_json::from_slice(&bytes[header_end + 4..header_end + 4 + len])
                .unwrap_or(Value::Null)
        };
        Some((route, headers, body))
    }

    fn cookie_part(headers: &HashMap<String, String>, name: &str) -> Option<String> {
        headers.get("cookie")?.split(';').find_map(|segment| {
            let (k, v) = segment.trim().split_once('=')?;
            (k == name).then(|| v.to_owned())
        })
    }

    fn authorize_flow(
        state: &mut HostState,
        headers: &HashMap<String, String>,
    ) -> Result<String, (u16, Value)> {
        let Some(reference) = headers
            .get("x-mediflow-ambulatory-command-reference")
            .cloned()
        else {
            return Err((401, json!({"code":"AMBULATORY_COMMAND_DENIED"})));
        };
        let now = state.clock_ms;
        let Some(flow) = state.flows.get_mut(&reference) else {
            return Err((401, json!({"code":"AMBULATORY_COMMAND_DENIED"})));
        };
        if flow.expired {
            return Err((401, json!({"code":"AMBULATORY_AUTHORIZATION_EXPIRED"})));
        }
        if now < flow.created_at || now >= flow.expires_at {
            flow.expired = true;
            return Err((401, json!({"code":"AMBULATORY_PREPARATION_EXPIRED"})));
        }
        let session_id = cookie_part(headers, "mediflow_session");
        let control_id = cookie_part(headers, "mediflow_auth_control");
        if session_id.is_none()
            || session_id != flow.session_id
            || control_id.as_deref() != Some(flow.control_id.as_str())
        {
            return Err((401, json!({"code":"AMBULATORY_COMMAND_DENIED"})));
        }
        let Some(session_created_at) = flow.session_created_at else {
            return Err((401, json!({"code":"AMBULATORY_COMMAND_DENIED"})));
        };
        if now >= session_created_at + CHALLENGE_MS {
            flow.expired = true;
            return Err((401, json!({"code":"AMBULATORY_CHALLENGE_EXPIRED"})));
        }
        Ok(reference)
    }

    fn terminal_reply(row: &LedgerRow) -> Value {
        let mut receipt = row.marker.clone();
        receipt.as_object_mut().unwrap().extend(
            json!({
                "outcome": row.outcome,
                "reason": row.reason,
                "committedAt": row.committed_at,
                "result": row.result
            })
            .as_object()
            .unwrap()
            .clone(),
        );
        json!({"outcome":"terminal","historical":false,"receipt":receipt})
    }

    fn handle_request(
        shared: &Arc<Mutex<HostState>>,
        route: &str,
        headers: &HashMap<String, String>,
        body: &Value,
    ) -> (u16, String, Value) {
        let mut state = shared.lock().unwrap();
        match route {
            "GET /api/auth/check" => {
                let extra = if cookie_part(headers, "mediflow_auth_control").is_some() {
                    format!("ETag: \"{}\"\r\n", "e".repeat(64))
                } else {
                    String::new()
                };
                (
                    200,
                    extra,
                    json!({"status":"ok","isSetup":true,"archiveGeneration":GENERATION,
                        "unlock":{"credential":"passphrase","kdfVersion":3,"salt":SALT}}),
                )
            }
            "POST /api/auth/native/login" => (
                200,
                format!(
                    "Set-Cookie: mediflow_session={}; Path=/; HttpOnly\r\n",
                    "a".repeat(64)
                ),
                json!({"success":true,"id":"synthetic-admin","username":"synthetic","role":"admin",
                    "archiveGeneration":GENERATION,"salt":SALT,"encryptedMasterKey":WRAPPED_KEY}),
            ),
            "GET /api/v1/network/capabilities" => (
                200,
                String::new(),
                json!({"protocolVersion":"1.14.0",
                    "hostPorts": serde_json::from_str::<Value>(include_str!("../../../transport/tests/fixtures/host-ports.json")).unwrap(),
                    "operatingMode":"network-home-base",
                    "capabilities":[{"key":"network.ambulatories.write","requiresPairing":true,"status":"available"}]}),
            ),
            "GET /api/v1/network/ambulatories" => (
                200,
                String::new(),
                json!([
                    {"id":"scope","name":"Sede principale","type":"live","isDefault":true,"version":1},
                    {"id":"target","name":"Sede prova","type":"test","isDefault":false,"version":state.target_version}
                ]),
            ),
            "POST /api/auth/ambulatory-commands/begin" => {
                state.next_flow += 1;
                let n = state.next_flow;
                let purpose = body["purpose"].as_str().unwrap().to_owned();
                let reference = format!("{n:064x}");
                let control_id = format!("ctrl_{n:040x}");
                let (
                    command_id,
                    ambulatory_id,
                    original_scope_id,
                    expected_version,
                    operation,
                    plan_digest,
                ) = if purpose == "execute" {
                    (
                        format!("11111111-1111-4111-8111-{n:012x}"),
                        body["command"]["ambulatoryId"].as_str().unwrap().to_owned(),
                        body["command"]["originalScopeId"]
                            .as_str()
                            .unwrap()
                            .to_owned(),
                        body["command"]["expectedVersion"].as_u64().unwrap(),
                        body["command"]["operation"].as_str().unwrap().to_owned(),
                        None,
                    )
                } else {
                    (
                        body["command"]["commandId"].as_str().unwrap().to_owned(),
                        body["command"]["ambulatoryId"].as_str().unwrap().to_owned(),
                        body["command"]["originalScopeId"]
                            .as_str()
                            .unwrap()
                            .to_owned(),
                        body["command"]["expectedVersion"].as_u64().unwrap(),
                        body["command"]["operation"].as_str().unwrap().to_owned(),
                        Some(body["command"]["planDigest"].as_str().unwrap().to_owned()),
                    )
                };
                let created_at = state.clock_ms;
                let expires_at = created_at + PREPARATION_MS;
                let flow = FlowState {
                    command_id: command_id.clone(),
                    ambulatory_id: ambulatory_id.clone(),
                    original_scope_id: original_scope_id.clone(),
                    expected_version,
                    operation: operation.clone(),
                    plan_digest,
                    control_id: control_id.clone(),
                    session_id: None,
                    created_at,
                    expires_at,
                    session_created_at: None,
                    expired: false,
                    retired: false,
                };
                state.controls.insert(control_id.clone(), reference.clone());
                state.flows.insert(reference.clone(), flow);
                (
                    200,
                    format!("Set-Cookie: mediflow_auth_control={control_id}; Path=/; HttpOnly\r\n"),
                    json!({
                        "protocol": "ambulatory.destructive.v1",
                        "contractVersion": 1,
                        "purpose": purpose,
                        "command": {
                            "protocol": "ambulatory.destructive.v1",
                            "commandId": command_id,
                            "originalArchiveGeneration": GENERATION,
                            "originalScopeId": original_scope_id,
                            "ambulatoryId": ambulatory_id,
                            "expectedVersion": expected_version,
                            "operation": operation
                        },
                        "reference": reference,
                        "currentArchiveGeneration": GENERATION,
                        "expiresAt": expires_at
                    }),
                )
            }
            "POST /api/auth/login" => {
                let control_id = cookie_part(headers, "mediflow_auth_control").unwrap();
                let reference = state.controls.get(&control_id).unwrap().clone();
                let session_id = format!("{:064x}", state.next_flow + 1000);
                let now = state.clock_ms;
                let flow = state.flows.get_mut(&reference).unwrap();
                flow.session_id = Some(session_id.clone());
                flow.session_created_at = Some(now);
                (
                    200,
                    format!("Set-Cookie: mediflow_session={session_id}; Path=/; HttpOnly\r\n"),
                    json!({"success":true,"id":"synthetic-admin","username":"synthetic","role":"admin","archiveGeneration":GENERATION}),
                )
            }
            "POST /api/auth/ambulatory-commands/preview" => {
                let reference = match authorize_flow(&mut state, headers) {
                    Ok(reference) => reference,
                    Err((status, value)) => return (status, String::new(), value),
                };
                let target_version = state.target_version;
                let flow = state.flows.get_mut(&reference).unwrap();
                if flow.expected_version != target_version {
                    return (
                        409,
                        String::new(),
                        json!({"code":"AMBULATORY_PLAN_NOT_ADMISSIBLE"}),
                    );
                }
                let digest = "b".repeat(64);
                flow.plan_digest = Some(digest.clone());
                let challenge_expires_at = flow.session_created_at.unwrap() + CHALLENGE_MS;
                (
                    200,
                    String::new(),
                    json!({
                        "marker": {
                            "protocol": "ambulatory.destructive.v1",
                            "commandId": flow.command_id,
                            "originalArchiveGeneration": GENERATION,
                            "originalScopeId": flow.original_scope_id,
                            "ambulatoryId": flow.ambulatory_id,
                            "expectedVersion": flow.expected_version,
                            "operation": flow.operation,
                            "planDigest": digest
                        },
                        "target": {
                            "id": flow.ambulatory_id,
                            "version": target_version,
                            "name": "Sede prova",
                            "type": "test",
                            "isDefault": false,
                            "parentId": null,
                            "createdAt": 2000
                        },
                        "fallback": null,
                        "counts": {
                            "tombstonedPatients": 0,
                            "unlinkedPatients": 0,
                            "preservedLivePatients": 0,
                            "removedMembershipRows": 0
                        },
                        "challengeExpiresAt": challenge_expires_at
                    }),
                )
            }
            "POST /api/auth/ambulatory-commands/execute" => {
                state.execute_calls += 1;
                let reference = match authorize_flow(&mut state, headers) {
                    Ok(reference) => reference,
                    Err((status, value)) => return (status, String::new(), value),
                };
                let flow = state.flows.get(&reference).unwrap().clone();
                if let Some(existing) = state.ledger.get(&flow.command_id) {
                    return (200, String::new(), terminal_reply(existing));
                }
                let marker = json!({
                    "protocol": "ambulatory.destructive.v1",
                    "commandId": flow.command_id,
                    "originalArchiveGeneration": GENERATION,
                    "originalScopeId": flow.original_scope_id,
                    "ambulatoryId": flow.ambulatory_id,
                    "expectedVersion": flow.expected_version,
                    "operation": flow.operation,
                    "planDigest": flow.plan_digest.clone().unwrap()
                });
                let committed_at = state.clock_ms / 1000;
                let row = if state.target_version != flow.expected_version {
                    LedgerRow {
                        marker,
                        outcome: "rejected".into(),
                        reason: Some("plan_changed".into()),
                        committed_at,
                        result: Value::Null,
                    }
                } else {
                    state.target_version += 1;
                    let version = state.target_version;
                    state.write_audits.push((
                        "native".into(),
                        "ambulatory.cleared".into(),
                        version,
                    ));
                    LedgerRow {
                        marker,
                        outcome: "applied".into(),
                        reason: None,
                        committed_at,
                        result: json!({
                            "targetVersion": version,
                            "affectedAmbulatories": [{"id": flow.ambulatory_id, "version": version}],
                            "clear": {"tombstonedPatients": 0, "unlinkedPatients": 0, "preservedLivePatients": 0, "removedMembershipRows": 0}
                        }),
                    }
                };
                let reply = terminal_reply(&row);
                state.ledger.insert(flow.command_id, row);
                (200, String::new(), reply)
            }
            "POST /api/auth/ambulatory-commands/receipt" => {
                state.receipt_calls += 1;
                let reference = match authorize_flow(&mut state, headers) {
                    Ok(reference) => reference,
                    Err((status, value)) => return (status, String::new(), value),
                };
                let command_id = state.flows.get(&reference).unwrap().command_id.clone();
                if let Some(existing) = state.ledger.get(&command_id) {
                    (200, String::new(), terminal_reply(existing))
                } else {
                    (200, String::new(), json!({"outcome":"unknown"}))
                }
            }
            "POST /api/auth/ambulatory-commands/close" => {
                state.close_calls += 1;
                let reference = match authorize_flow(&mut state, headers) {
                    Ok(reference) => reference,
                    Err((status, value)) => return (status, String::new(), value),
                };
                let flow = state.flows.get(&reference).unwrap().clone();
                if let Some(existing) = state.ledger.get(&flow.command_id) {
                    return (200, String::new(), terminal_reply(existing));
                }
                let row = LedgerRow {
                    marker: json!({
                        "protocol": "ambulatory.destructive.v1",
                        "commandId": flow.command_id,
                        "originalArchiveGeneration": GENERATION,
                        "originalScopeId": flow.original_scope_id,
                        "ambulatoryId": flow.ambulatory_id,
                        "expectedVersion": flow.expected_version,
                        "operation": flow.operation,
                        "planDigest": flow.plan_digest.clone().unwrap()
                    }),
                    outcome: "closed".into(),
                    reason: None,
                    committed_at: state.clock_ms / 1000,
                    result: Value::Null,
                };
                let reply = terminal_reply(&row);
                state.ledger.insert(flow.command_id, row);
                (200, String::new(), reply)
            }
            "POST /api/auth/ambulatory-commands/retire" => {
                state.retire_calls += 1;
                if let Some(reference) = headers.get("x-mediflow-ambulatory-command-reference")
                    && let Some(flow) = state.flows.get_mut(reference)
                {
                    flow.retired = true;
                }
                (204, String::new(), Value::Null)
            }
            other => panic!("unexpected route: {other}"),
        }
    }

    fn settle(cx: &mut gpui::VisualTestContext) {
        for _ in 0..8 {
            cx.run_until_parked();
            thread::sleep(Duration::from_millis(20));
            cx.run_until_parked();
        }
    }

    fn wait_until(
        view: &Entity<ClinicalApp>,
        cx: &mut gpui::VisualTestContext,
        predicate: impl Fn(&ClinicalApp) -> bool,
    ) {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while std::time::Instant::now() < deadline {
            cx.run_until_parked();
            if view.read_with(cx, |app, _| predicate(app)) {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("timed out waiting for ambulatory command state");
    }

    fn draw(cx: &mut gpui::VisualTestContext) {
        for _ in 0..6 {
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
    }

    fn now_unix_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    fn setup_app<'a>(
        cx: &'a mut gpui::TestAppContext,
        host: &ControlledHost,
    ) -> (Entity<ClinicalApp>, &'a mut gpui::VisualTestContext) {
        crate::native_lock::monitor_installed();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.simulate_resize(gpui::size(px(1200.), px(1100.)));
        let rows = host.session.list_ambulatories().unwrap();
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Ambulatories;
            app.local_preferences = host.preferences();
            app.session = Some(host.session.clone());
            app.scope = Some("scope".into());
            app.ambulatory_management.initial_scope = false;
            app.ambulatories = Load::Ready(rows);
            app.load_ambulatory_command_recovery(cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management.destructive.loaded
        });
        (view, cx)
    }

    #[gpui::test]
    fn concurrent_web_clear_and_expired_confirm_then_recovery_after_challenge_or_preparation_expiry_and_within_time(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = ControlledHost::new(now_unix_ms());
        let (view, cx) = setup_app(cx, &host);

        view.update(cx, |app, cx| {
            assert!(app.can_open_ambulatory_command());
            app.open_ambulatory_command("target", AmbulatoryCommandOperation::ClearTest, cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| dialog.phase == Phase::Authentication)
        });

        view.update(cx, |app, cx| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            dialog.fields[0]
                .editor
                .update(cx, |input, cx| input.set_content(PASSPHRASE, cx));
            app.authorize_ambulatory_command(cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| dialog.phase == Phase::Confirm)
        });

        host.web_clear_target();
        host.advance_ms(CHALLENGE_MS + 1_000);

        view.update(cx, |app, cx| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            dialog.fields[1]
                .editor
                .update(cx, |input, cx| input.set_content("SVUOTA", cx));
            app.confirm_ambulatory_command(cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| {
                    !dialog.busy && matches!(dialog.cleanup, Cleanup::Confirmed(_))
                })
        });
        {
            let state = host.state.lock().unwrap();
            assert_eq!(state.target_version, 3);
            assert_eq!(state.write_audits.len(), 1);
            assert!(state.ledger.is_empty());
        }
        view.read_with(cx, |app, _| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            assert!(dialog.phase == Phase::Unknown);
            assert_eq!(
                dialog_error_context(dialog, dialog.error.unwrap()),
                copy("errori", "accesso_scaduto")
            );
        });
        assert_eq!(host.journal_json_count(), 1);

        view.update(cx, |app, cx| {
            app.recover_ambulatory_command(cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| dialog.phase == Phase::Authentication)
        });

        view.update(cx, |app, cx| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            dialog.fields[0]
                .editor
                .update(cx, |input, cx| input.set_content(PASSPHRASE, cx));
            app.authorize_ambulatory_command(cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| !dialog.busy && dialog.phase != Phase::Authorizing)
        });
        view.read_with(cx, |app, _| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            assert!(dialog.phase == Phase::Unknown);
            assert!(dialog_authorized(dialog));
            assert_eq!(
                dialog_state_message(dialog),
                Some(copy("stati", "non_registrato"))
            );
        });

        host.advance_ms(CHALLENGE_MS + 1_000);
        let retire_before_expired_close = host.state.lock().unwrap().retire_calls;
        view.update(cx, |app, cx| {
            app.read_or_close_ambulatory_command(true, cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| {
                    !dialog.busy && matches!(dialog.cleanup, Cleanup::Confirmed(_))
                })
        });
        settle(cx);
        draw(cx);
        assert!(
            host.state.lock().unwrap().retire_calls > retire_before_expired_close,
            "expired recovery close must retire its dedicated WebP3 session"
        );
        view.read_with(cx, |app, _| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            assert_eq!(
                dialog_error_context(dialog, dialog.error.unwrap()),
                copy("errori", "accesso_scaduto")
            );
        });
        assert!(
            cx.debug_bounds("ambulatory-command-stop").is_none(),
            "expired recovery must not leave a disabled Chiudi operazione button"
        );
        let reauthorize_button = cx
            .debug_bounds("ambulatory-command-verify")
            .expect("expired recovery must offer re-authorization");
        cx.simulate_click(reauthorize_button.center(), gpui::Modifiers::default());
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| dialog.phase == Phase::Authentication)
        });
        host.advance_ms(PREPARATION_MS + 1_000);
        let retire_before_expired_prep = host.state.lock().unwrap().retire_calls;
        view.update(cx, |app, cx| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            dialog.fields[0]
                .editor
                .update(cx, |input, cx| input.set_content(PASSPHRASE, cx));
            app.authorize_ambulatory_command(cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| {
                    !dialog.busy && matches!(dialog.cleanup, Cleanup::Confirmed(_))
                })
        });
        settle(cx);
        view.read_with(cx, |app, _| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            assert!(
                dialog.phase == Phase::Failed,
                "expired 5-minute preparation must not pretend recovery authorization succeeded"
            );
            assert_eq!(
                dialog_error_context(dialog, dialog.error.unwrap()),
                copy("errori", "accesso_scaduto")
            );
        });
        assert!(
            host.state.lock().unwrap().retire_calls > retire_before_expired_prep,
            "expired 5-minute recovery preparation must retire its WebP3 session"
        );

        view.update(cx, |app, cx| {
            app.recover_ambulatory_command(cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| dialog.phase == Phase::Authentication)
        });
        view.update(cx, |app, cx| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            dialog.fields[0]
                .editor
                .update(cx, |input, cx| input.set_content(PASSPHRASE, cx));
            app.authorize_ambulatory_command(cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| !dialog.busy && dialog.phase == Phase::Unknown)
        });
        host.advance_ms(5_000);
        view.update(cx, |app, cx| {
            app.read_or_close_ambulatory_command(true, cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| {
                    dialog.phase == Phase::Terminal
                        && matches!(dialog.cleanup, Cleanup::Confirmed(_))
                })
        });
        view.update(cx, |app, cx| {
            app.close_ambulatory_command_view(cx);
        });
        wait_until(&view, cx, |app| app.can_open_ambulatory_command());
        assert_eq!(host.journal_json_count(), 0);
        let state = host.state.lock().unwrap();
        assert_eq!(state.target_version, 3);
        assert_eq!(state.write_audits.len(), 1);
        assert_eq!(state.ledger.len(), 1);
        assert_eq!(state.ledger.values().next().unwrap().outcome, "closed");
    }

    #[gpui::test]
    fn concurrent_web_clear_within_challenge_explains_plan_change_and_unblocks_commands(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = ControlledHost::new(now_unix_ms());
        let (view, cx) = setup_app(cx, &host);

        view.update(cx, |app, cx| {
            app.open_ambulatory_command("target", AmbulatoryCommandOperation::ClearTest, cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| dialog.phase == Phase::Authentication)
        });
        view.update(cx, |app, cx| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            dialog.fields[0]
                .editor
                .update(cx, |input, cx| input.set_content(PASSPHRASE, cx));
            app.authorize_ambulatory_command(cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| dialog.phase == Phase::Confirm)
        });

        host.web_clear_target();
        host.advance_ms(10_000);

        view.update(cx, |app, cx| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            dialog.fields[1]
                .editor
                .update(cx, |input, cx| input.set_content("SVUOTA", cx));
            app.confirm_ambulatory_command(cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| {
                    dialog.phase == Phase::Terminal
                        && matches!(dialog.cleanup, Cleanup::Confirmed(_))
                })
        });
        view.read_with(cx, |app, _| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            let Some(AmbulatoryCommandRead::Terminal(terminal)) = &dialog.result else {
                panic!("expected terminal rejected receipt");
            };
            assert_eq!(
                terminal.receipt().outcome,
                AmbulatoryCommandOutcome::Rejected
            );
            assert_eq!(
                terminal_detail_message(terminal),
                Some(copy("stati", "rejected_piano_cambiato"))
            );
        });
        view.update(cx, |app, cx| {
            app.close_ambulatory_command_view(cx);
        });
        wait_until(&view, cx, |app| app.can_open_ambulatory_command());
        assert_eq!(host.journal_json_count(), 0);
        let state = host.state.lock().unwrap();
        assert_eq!(state.target_version, 3);
        assert_eq!(state.write_audits.len(), 1);
        assert_eq!(state.ledger.len(), 1);
        assert_eq!(state.ledger.values().next().unwrap().outcome, "rejected");
    }

    #[gpui::test]
    fn confirm_after_local_challenge_expiry_never_persists_recovery_marker_or_blocks_commands(
        cx: &mut gpui::TestAppContext,
    ) {
        let initial = now_unix_ms();
        let clock = Arc::new(AtomicU64::new(initial));
        let host = ControlledHost::new(initial);
        let (view, cx) = setup_app(cx, &host);
        view.update(cx, |app, _| {
            app.ambulatory_management.destructive.clock_override_ms = Some(clock.clone());
        });

        view.update(cx, |app, cx| {
            app.open_ambulatory_command("target", AmbulatoryCommandOperation::ClearTest, cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| dialog.phase == Phase::Authentication)
        });
        view.update(cx, |app, cx| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            dialog.fields[0]
                .editor
                .update(cx, |input, cx| input.set_content(PASSPHRASE, cx));
            app.authorize_ambulatory_command(cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| dialog.phase == Phase::Confirm)
        });

        host.web_clear_target();
        host.advance_ms(CHALLENGE_MS + 1_000);
        clock.fetch_add(CHALLENGE_MS + 1_000, Ordering::AcqRel);

        view.update(cx, |app, cx| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            dialog.fields[1]
                .editor
                .update(cx, |input, cx| input.set_content("SVUOTA", cx));
            app.confirm_ambulatory_command(cx);
        });
        wait_until(&view, cx, |app| {
            app.ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .is_some_and(|dialog| {
                    !dialog.busy && matches!(dialog.cleanup, Cleanup::Confirmed(_))
                })
        });
        view.read_with(cx, |app, _| {
            let dialog = app
                .ambulatory_management
                .destructive
                .dialog
                .as_ref()
                .unwrap();
            assert!(dialog.phase == Phase::Failed);
            assert!(app.ambulatory_management.destructive.marker.is_none());
            assert_eq!(
                dialog_error_context(dialog, dialog.error.unwrap()),
                copy("errori", "accesso_scaduto_prima_invio")
            );
        });
        assert_eq!(host.journal_json_count(), 0);
        assert_eq!(host.state.lock().unwrap().execute_calls, 0);

        view.update(cx, |app, cx| {
            app.close_ambulatory_command_view(cx);
        });
        wait_until(&view, cx, |app| app.can_open_ambulatory_command());
        let state = host.state.lock().unwrap();
        assert_eq!(state.target_version, 3);
        assert_eq!(state.write_audits.len(), 1);
        assert!(state.ledger.is_empty());
    }
}
