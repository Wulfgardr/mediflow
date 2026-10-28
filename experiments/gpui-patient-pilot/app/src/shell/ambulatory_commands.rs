use super::*;
use mediflow_runtime_client::{
    AmbulatoryCommandAuthority, AmbulatoryCommandContext, AmbulatoryCommandIntent,
    AmbulatoryCommandMarker, AmbulatoryCommandOperation, AmbulatoryCommandOutcome,
    AmbulatoryCommandPreview, AmbulatoryCommandRead, AmbulatoryCommandRecoveryStore,
    AmbulatoryCommandRetirement, HostAmbulatoryCommand,
};
use std::sync::{
    Arc, OnceLock,
    atomic::{AtomicBool, Ordering},
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
}
impl Commands {
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
enum SendResult {
    AdmissionFailed(RuntimeError),
    Executed(Result<AmbulatoryCommandRead, RuntimeError>),
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
            let authorization = current.authenticate(&passphrase);
            drop(passphrase);
            authorization?;
            if recovery {
                Ok(None)
            } else {
                current.preview().map(Some)
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
                    Ok(preview) => {
                        dialog.preview = preview;
                        dialog.phase = Phase::Confirm;
                        if !recovery {
                            dialog.focus_field = Some(1);
                        }
                    }
                    Err(error) => {
                        dialog.phase = Phase::Failed;
                        dialog.error = Some(error);
                    }
                }
                if this
                    .ambulatory_management
                    .destructive
                    .dialog
                    .as_ref()
                    .is_some_and(|dialog| dialog.phase == Phase::Failed)
                {
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
            match current.persist_preview(&store) {
                Err(error) => SendResult::AdmissionFailed(error),
                Ok(proof) => SendResult::Executed(current.execute(&proof, &word)),
            }
        });
        cx.spawn(async move |this, cx| {
            let mut pending = Some(task.await);
            let _ = this.update(cx, |this, cx| {
                let error = match pending.as_ref().unwrap() {
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
                if this
                    .ambulatory_management
                    .destructive
                    .dialog
                    .as_ref()
                    .is_some_and(|dialog| dialog.phase == Phase::Terminal)
                {
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
        let progress = match dialog.phase {
            Phase::Preparing => Some(copy("stati", "preparazione")),
            Phase::Authorizing => Some(copy("stati", "autorizzazione")),
            Phase::Sending => Some(copy("stati", "invio")),
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
        };
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
            let context = if dialog.ack_error {
                copy("errori", "ack_locale")
            } else if dialog.phase == Phase::Unknown {
                copy("errori", "risposta_persa")
            } else if error == RuntimeError::Conflict {
                copy("errori", "piano_cambiato")
            } else if matches!(
                error,
                RuntimeError::Rejected(401)
                    | RuntimeError::Forbidden
                    | RuntimeError::Authentication
            ) {
                copy("errori", "accesso_scaduto")
            } else {
                copy("errori", "autorizzazione")
            };
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
        if dialog.phase == Phase::Unknown || dialog.phase == Phase::Failed && dialog.mode.recovery()
        {
            if dialog.mode.recovery()
                && dialog
                    .flow
                    .as_ref()
                    .is_some_and(|flow| flow.authority() == AmbulatoryCommandAuthority::Authorized)
            {
                view = view.child(
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
                );
            } else if state.marker.is_some() || dialog.preview.is_some() {
                view = view.child(
                    self.ambulatory_button(
                        "ambulatory-command-verify",
                        copy("azioni", "verifica"),
                        theme,
                        true,
                        !dialog.busy,
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.recover_ambulatory_command(cx))),
                );
            }
        }
        if dialog.phase == Phase::Unknown && !dialog.mode.recovery() {
            view = view
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
                        !dialog.busy,
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.recover_ambulatory_command(cx))),
                );
        }
        if dialog.mode.recovery() && matches!(dialog.phase, Phase::Confirm | Phase::Unknown) {
            if dialog.phase == Phase::Confirm {
                view = view.child(
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
                );
            }
            let authorized = dialog
                .flow
                .as_ref()
                .is_some_and(|flow| flow.authority() == AmbulatoryCommandAuthority::Authorized);
            view = view
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
                        !dialog.busy && !dialog.attempted && authorized,
                    )
                    .on_click(
                        cx.listener(|this, _, _, cx| {
                            this.read_or_close_ambulatory_command(true, cx)
                        }),
                    ),
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
