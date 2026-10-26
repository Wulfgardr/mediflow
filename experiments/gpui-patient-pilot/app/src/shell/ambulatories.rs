use super::*;
use mediflow_runtime_client::{
    AMBULATORY_WRITE_CAPABILITY, AmbulatoryDraft, AmbulatoryMutationReceipt,
    FirstAmbulatoryContext, FirstAmbulatoryDraft, HostBootstrapSession,
};

pub(super) struct Management {
    pub(super) active: bool,
    pub(super) draft: Option<Editor>,
    pub(super) initial_scope: bool,
    bootstrap: Option<BootstrapEditor>,
    focus_editor: bool,
    pub(super) rebase: bool,
    commands: HashMap<String, ScrollTarget>,
    message: Option<(String, bool)>,
}

impl Default for Management {
    fn default() -> Self {
        Self {
            active: false,
            draft: None,
            initial_scope: true,
            bootstrap: None,
            focus_editor: false,
            rebase: false,
            commands: HashMap::new(),
            message: None,
        }
    }
}

impl Management {
    pub(super) fn reset(&mut self, theme: Theme, cx: &mut Context<ClinicalApp>) {
        if let Some(editor) = &self.draft {
            for field in &editor.fields {
                field.editor.update(cx, |input, cx| {
                    input.set_content("", cx);
                    input.configure(theme, true, cx);
                });
            }
        }
        if let Some(editor) = self.bootstrap.take() {
            if let Some(context) = editor.context {
                context.cancel();
            }
            if let Some(web) = editor.web {
                web.cancel_local();
                cx.background_executor()
                    .spawn(async move {
                        let _ = web.retire();
                    })
                    .detach();
            }
            for field in editor.fields {
                field.editor.update(cx, |input, cx| input.retire(cx));
            }
        }
        *self = Self::default();
    }
    pub(super) fn is_saving(&self) -> bool {
        self.draft.as_ref().is_some_and(|draft| draft.saving)
            || self.bootstrap.as_ref().is_some_and(|editor| editor.busy)
    }
}

struct BootstrapEditor {
    fields: Vec<Field>,
    payload: Option<FirstAmbulatoryDraft>,
    context: Option<FirstAmbulatoryContext>,
    web: Option<std::sync::Arc<HostBootstrapSession>>,
    busy: bool,
    attempted: bool,
    observed: Option<String>,
    message: String,
    _subscriptions: Vec<Subscription>,
}

pub(super) struct Editor {
    target: Option<Ambulatory>,
    fields: Vec<Field>,
    parent: Option<String>,
    parent_menu: bool,
    test: bool,
    default: bool,
    saving: bool,
    requires_read: bool,
    creation_unconfirmed: bool,
    accepted: Option<AmbulatoryMutationReceipt>,
    _subscriptions: Vec<Subscription>,
}

impl Editor {
    fn can_save(&self) -> bool {
        !self.saving
            && !self.requires_read
            && self.accepted.is_none()
            && (!self.target.as_ref().is_some_and(|row| row.is_default) || self.default)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Selection {
    Preserve,
    Initial(String),
    Lost,
    Unselected,
}

fn selection(rows: &[Ambulatory], current: Option<&str>, initial: bool) -> Selection {
    match current {
        Some(id) if rows.iter().any(|row| row.id == id) => Selection::Preserve,
        Some(_) => Selection::Lost,
        None if initial => rows
            .iter()
            .find(|row| row.is_default)
            .map(|row| Selection::Initial(row.id.clone()))
            .unwrap_or(Selection::Unselected),
        None => Selection::Unselected,
    }
}

fn ancestry(rows: &[Ambulatory], id: &str) -> Result<Vec<String>, ()> {
    let mut parents = Vec::new();
    let mut seen = HashSet::from([id.to_owned()]);
    let mut current = rows.iter().find(|row| row.id == id).ok_or(())?;
    while let Some(parent) = &current.parent_id {
        if !seen.insert(parent.clone()) {
            return Err(());
        }
        current = rows.iter().find(|row| row.id == *parent).ok_or(())?;
        parents.push(current.id.clone());
    }
    parents.reverse();
    Ok(parents)
}

fn parent_allowed(rows: &[Ambulatory], parent: &str, target: Option<&str>) -> bool {
    parent != target.unwrap_or("")
        && ancestry(rows, parent).is_ok_and(|parents| {
            !target.is_some_and(|id| parents.iter().any(|parent| parent == id))
        })
}

fn row_text(id: &str, field: &str, value: impl Into<SharedString>) -> gpui::Text {
    gpui::Text::new(
        format!("clinical-workspace-ambulatory-{id}-{field}").into(),
        value.into(),
    )
}

impl ClinicalApp {
    fn open_first_ambulatory(&mut self, cx: &mut Context<Self>) {
        if self.ambulatory_management.bootstrap.is_some() {
            return;
        }
        if !self
            .session
            .as_ref()
            .is_some_and(RuntimeSession::can_bootstrap_first_ambulatory)
            || !self.ambulatories.ready().is_some_and(Vec::is_empty)
        {
            return;
        }
        let mut fields: Vec<_> = [
            ("bootstrap-name", "Nome della prima sede", false),
            ("bootstrap-address", "Indirizzo", false),
            ("bootstrap-description", "Descrizione", false),
            (
                "bootstrap-passphrase",
                "Passphrase per predisporre la sede",
                true,
            ),
        ]
        .into_iter()
        .map(|(id, label, secret)| {
            Field::new(id, label, "", false, secret, self.theme, cx)
                .with_scroll(&self.area_scroll, cx)
        })
        .collect();
        let subscriptions = fields
            .iter_mut()
            .map(|field| cx.subscribe(&field.editor, |_, _, _: &InputChanged, cx| cx.notify()))
            .collect();
        self.ambulatory_management.bootstrap=Some(BootstrapEditor{fields,payload:None,context:None,web:None,busy:false,attempted:false,observed:None,message:"Accedi come lo stesso amministratore. La sede sarà operativa e predefinita, senza sede superiore.".into(),_subscriptions:subscriptions});
        self.ambulatory_management.focus_editor = true;
        cx.notify();
    }

    fn cancel_first_ambulatory(&mut self, cx: &mut Context<Self>) {
        let Some(editor) = &mut self.ambulatory_management.bootstrap else {
            return;
        };
        if let Some(context) = editor.context.take() {
            context.cancel();
        }
        if let Some(web) = editor.web.take() {
            web.cancel_local();
            cx.background_executor()
                .spawn(async move {
                    let _ = web.retire();
                })
                .detach();
        }
        editor.busy = false;
        editor.fields[3]
            .editor
            .update(cx, |input, cx| input.set_content("", cx));
        editor.message="Richiesta ritirata qui. Il ritiro remoto non è attestato. Un invio già partito resta da verificare; ID e bozza sono conservati.".into();
        self.next_epoch();
        cx.notify();
    }

    fn authenticate_first_ambulatory(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else {
            return;
        };
        let Some(editor) = &mut self.ambulatory_management.bootstrap else {
            return;
        };
        if editor.busy {
            return;
        }
        let passphrase = Zeroizing::new(editor.fields[3].value(cx));
        editor.fields[3]
            .editor
            .update(cx, |input, cx| input.set_content("", cx));
        let nullable = |value: String| {
            let value = value.trim().to_owned();
            (!value.is_empty()).then_some(value)
        };
        let payload = if editor.attempted {
            editor.payload.clone().ok_or(RuntimeError::ReadRequired)
        } else {
            FirstAmbulatoryDraft::new(
                editor.fields[0].value(cx).trim().to_owned(),
                nullable(editor.fields[1].value(cx)),
                nullable(editor.fields[2].value(cx)),
            )
            .map(|mut draft| {
                if let Some(previous) = &editor.payload {
                    draft.id = previous.id.clone();
                }
                draft
            })
        };
        let payload = match payload {
            Ok(value) => value,
            Err(error) => {
                editor.message = ui_error(error);
                cx.notify();
                return;
            }
        };
        if passphrase.is_empty() {
            editor.message = "Inserisci la passphrase dell’amministratore corrente.".into();
            cx.notify();
            return;
        }
        let context = match session.first_ambulatory_context() {
            Ok(value) => value,
            Err(error) => {
                editor.message = ui_error(error);
                cx.notify();
                return;
            }
        };
        if let Some(old) = editor.context.replace(context.clone()) {
            old.cancel();
        }
        if let Some(web) = editor.web.take() {
            web.cancel_local();
            cx.background_executor()
                .spawn(async move {
                    let _ = web.retire();
                })
                .detach();
        }
        editor.payload = Some(payload.clone());
        editor.busy = true;
        editor.message = "Accesso amministrativo dedicato in corso…".into();
        let epoch = self.epoch;
        let authority = self.account_profile.generation;
        let task = cx.background_executor().spawn(async move {
            session
                .authenticate_first_ambulatory(&context, payload, &passphrase)
                .map(std::sync::Arc::new)
        });
        cx.spawn(async move|this,cx|{
            let mut pending=Some(task.await);
            let _=this.update(cx,|this,cx|{
                let error=pending.as_ref().and_then(|v|v.as_ref().err()).copied();
                if this.check_callback(authority,error,cx)!=CallbackState::Current || this.epoch!=epoch{return;}
                let Some(editor)=&mut this.ambulatory_management.bootstrap else{return;};
                editor.busy=false;
                match pending.take().unwrap(){Ok(web)=>{editor.web=Some(web);editor.message=if editor.attempted{"Accesso dedicato verificato. Puoi rileggere la sede, senza ripetere l’invio."}else{"Accesso dedicato verificato. Controlla la sede e conferma la creazione."}.into();},Err(error)=>editor.message=format!("{} La bozza è conservata; nessun ritiro remoto è attestato.",ui_error(error))}
                cx.notify();
            });
            if let Some(Ok(web))=pending{web.cancel_local();cx.background_executor().spawn(async move{let _=web.retire();}).detach();}
        }).detach();
        cx.notify();
    }

    fn verify_first_ambulatory(&mut self, commit: bool, cx: &mut Context<Self>) {
        let Some(editor) = &mut self.ambulatory_management.bootstrap else {
            return;
        };
        if editor.busy || (commit && editor.attempted) {
            return;
        }
        let Some(web) = editor.web.clone() else {
            return;
        };
        if commit {
            editor.attempted = true;
        }
        editor.busy = true;
        editor.message = if commit {
            "Creazione e rilettura in corso…"
        } else {
            "Rilettura della sede in corso…"
        }
        .into();
        self.run(move||{if commit{web.commit()?;}web.readback()},move|this,result,cx|{
            let Some(editor)=&mut this.ambulatory_management.bootstrap else{return;};editor.busy=false;
            match result{Ok(id)=>{editor.observed=Some(id);editor.message=if commit{"Creazione accettata e sede riletta. Verifica e scegli la sede nel collegamento in uso."}else{"La sede corrisponde ai dati della bozza. La sola rilettura non conferma l’esito dell’invio precedente."}.into();},Err(error)=>{editor.message=format!("{} ID e bozza conservati. Accedi di nuovo prima di riconciliare; nessun reinvio automatico.",ui_error(error));if let Some(web)=editor.web.take(){web.cancel_local();cx.background_executor().spawn(async move{let _=web.retire();}).detach();}}}
        },cx);
        cx.notify();
    }

    fn select_first_ambulatory(&mut self, cx: &mut Context<Self>) {
        let (Some(session), Some(editor)) = (
            self.session.clone(),
            self.ambulatory_management.bootstrap.as_mut(),
        ) else {
            return;
        };
        if editor.busy || editor.observed.is_none() {
            return;
        }
        let Some(payload) = editor.payload.clone() else {
            return;
        };
        editor.busy = true;
        self.run(move||{let rows=session.list_ambulatories()?;if !rows.iter().any(|row|row.id==payload.id && row.version==1 && row.name==payload.name && row.address==payload.address && row.description==payload.description && row.parent_id.is_none() && row.kind.as_deref()==Some("live") && row.is_default){return Err(RuntimeError::Conflict);}Ok((rows,payload.id))},|this,result,cx|{
            match result{Ok((rows,id))=>{if let Some(mut editor)=this.ambulatory_management.bootstrap.take(){if let Some(context)=editor.context.take(){context.cancel();}
if let Some(web)=editor.web.take(){web.cancel_local();cx.background_executor().spawn(async move{let _=web.retire();}).detach();}for field in editor.fields{field.editor.update(cx,|input,cx|input.retire(cx));}}this.receive_ambulatories(rows,cx);this.change_scope(&id,cx);this.ambulatory_management.message=Some(("Sede verificata e selezionata. Il ritiro remoto dell’accesso dedicato non è attestato.".into(),false));},Err(error)=>if let Some(editor)=&mut this.ambulatory_management.bootstrap{editor.busy=false;editor.observed=None;editor.message=format!("{} La sede non è stata selezionata.",ui_error(error));}}
        },cx);
    }

    fn first_ambulatory_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let Some(editor) = &self.ambulatory_management.bootstrap else {
            return div().child(
                self.ambulatory_button(
                    "bootstrap-open",
                    "Predisponi la prima sede su questo Mac…",
                    theme,
                    true,
                    self.session
                        .as_ref()
                        .is_some_and(RuntimeSession::can_bootstrap_first_ambulatory),
                )
                .on_click(cx.listener(|this, _, _, cx| this.open_first_ambulatory(cx))),
            );
        };
        let identity = self
            .session
            .as_ref()
            .map(|session| {
                format!(
                    "Amministratore: {} · Collegamento: {}",
                    session.user().username,
                    session.base_url()
                )
            })
            .unwrap_or_default();
        div().flex().flex_col().gap(px(12.)).child(heading("bootstrap-title","Prima sede",theme)).child(text!(identity).with_id("bootstrap-identity"))
            .child(text!("Questa operazione richiede un accesso amministrativo dedicato. L’indirizzo locale non attesta dove termini un eventuale proxy.").with_id("bootstrap-boundary"))
            .children(editor.fields.iter().enumerate().map(|(index,field)|div().flex().flex_col().gap(px(4.)).child(text!(field.label).with_id(("bootstrap-field-label",index))).child(field.editor.clone())))
            .when_some(editor.payload.as_ref(),|el,payload|el.child(text!(format!("ID conservato: {}",payload.id)).with_id("bootstrap-id")))
            .child(notice("bootstrap-message",editor.message.clone(),theme,false))
            .child(self.ambulatory_button("bootstrap-auth","Accedi per predisporre la sede",theme,false,!editor.busy).on_click(cx.listener(|this,_,_,cx|this.authenticate_first_ambulatory(cx))))
            .child(self.ambulatory_button("bootstrap-confirm","Crea la prima sede",theme,true,!editor.busy && editor.web.is_some() && !editor.attempted).on_click(cx.listener(|this,_,_,cx|this.verify_first_ambulatory(true,cx))))
            .child(self.ambulatory_button("bootstrap-read","Verifica l’esito precedente",theme,false,!editor.busy && editor.web.is_some() && editor.attempted).on_click(cx.listener(|this,_,_,cx|this.verify_first_ambulatory(false,cx))))
            .child(self.ambulatory_button("bootstrap-select","Verifica e usa questa sede",theme,true,!editor.busy && editor.observed.is_some()).on_click(cx.listener(|this,_,_,cx|this.select_first_ambulatory(cx))))
            .child(self.ambulatory_button("bootstrap-cancel","Ritira la richiesta qui",theme,false,true).on_click(cx.listener(|this,_,_,cx|this.cancel_first_ambulatory(cx))))
    }

    pub(super) fn receive_ambulatories(&mut self, rows: Vec<Ambulatory>, cx: &mut Context<Self>) {
        let choice = selection(
            &rows,
            self.scope.as_deref(),
            self.ambulatory_management.initial_scope,
        );
        self.ambulatory_management.initial_scope = false;
        if let Some(draft) = &mut self.ambulatory_management.draft {
            if let Some(accepted) = &draft.accepted {
                if accepted.affected.iter().all(|(id, version)| {
                    rows.iter()
                        .any(|row| row.id == *id && row.version == *version)
                }) {
                    self.ambulatory_management.draft = None;
                    self.ambulatory_management.message =
                        Some(("Ambulatorio salvato e riletto dall’archivio.".into(), false));
                } else {
                    self.ambulatory_management.message = Some(("La modifica è stata accettata, ma la sede è cambiata ancora. La bozza è conservata: confronta l’elenco prima di aprire una nuova modifica.".into(), true));
                }
            } else if self.ambulatory_management.rebase {
                if let Some(target) = &mut draft.target {
                    if let Some(current) = rows.iter().find(|row| row.id == target.id) {
                        *target = current.clone();
                        draft.requires_read = false;
                        self.ambulatory_management.message = Some((
                        "Sedi rilette. Confronta i dati registrati con la bozza prima di salvare."
                            .into(),
                        false,
                    ));
                    } else {
                        draft.requires_read = true;
                        self.ambulatory_management.message = Some(("La sede della bozza non è più disponibile. Il testo è conservato; puoi copiarlo o scartarlo.".into(), true));
                    }
                } else {
                    draft.requires_read = draft.creation_unconfirmed;
                }
            }
        }
        self.ambulatory_management.rebase = false;
        self.ambulatories = Load::Ready(rows);
        match choice {
            Selection::Initial(id) => self.change_scope(&id, cx),
            Selection::Lost => {
                self.scope = None;
                self.next_epoch();
                self.retire_profile_selection();
                self.patients = Load::Idle;
                self.global_patients = Load::Idle;
                self.agenda = Load::Idle;
                self.global_entries = Load::Idle;
                self.patient = PatientData::default();
                self.core.lock();
                if let Some(form) = &mut self.form {
                    form.state = FormState::Conflict;
                }
                self.message = Some(("L’ambulatorio corrente non è più disponibile. Scegli una sede; l’eventuale bozza è conservata e non può essere inviata in un’altra sede.".into(), true));
            }
            Selection::Preserve | Selection::Unselected => {}
        }
    }

    fn open_ambulatory_editor(&mut self, id: Option<&str>, cx: &mut Context<Self>) {
        if self.ambulatory_management.draft.is_some() || !self.can_manage_ambulatories() {
            return;
        }
        let target = match id {
            Some(id) => match self
                .ambulatories
                .ready()
                .and_then(|rows| rows.iter().find(|row| row.id == id))
            {
                Some(row) => Some(row.clone()),
                None => return,
            },
            None => None,
        };
        let mut fields = vec![
            Field::new(
                "clinical-workspace-ambulatory-name",
                "Nome della sede",
                target.as_ref().map_or("", |r| r.name.as_str()),
                false,
                false,
                self.theme,
                cx,
            )
            .with_scroll(&self.area_scroll, cx),
            Field::new(
                "clinical-workspace-ambulatory-address",
                "Indirizzo",
                target
                    .as_ref()
                    .and_then(|r| r.address.as_deref())
                    .unwrap_or(""),
                false,
                false,
                self.theme,
                cx,
            )
            .with_scroll(&self.area_scroll, cx),
            Field::new(
                "clinical-workspace-ambulatory-description",
                "Descrizione",
                target
                    .as_ref()
                    .and_then(|r| r.description.as_deref())
                    .unwrap_or(""),
                true,
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
        self.ambulatory_management.draft = Some(Editor {
            parent: target.as_ref().and_then(|r| r.parent_id.clone()),
            test: target
                .as_ref()
                .is_some_and(|r| r.kind.as_deref() == Some("test")),
            default: target.as_ref().is_some_and(|r| r.is_default),
            target,
            fields,
            parent_menu: false,
            saving: false,
            requires_read: false,
            creation_unconfirmed: false,
            accepted: None,
            _subscriptions: subscriptions,
        });
        self.ambulatory_management.message = None;
        self.ambulatory_management.focus_editor = true;
        self.area_scroll.set_offset(gpui::point(px(0.), px(0.)));
        cx.notify();
    }

    fn can_manage_ambulatories(&self) -> bool {
        self.scope.is_some()
            && self.ambulatories.ready().is_some()
            && self
                .session
                .as_ref()
                .is_some_and(|s| s.can_write(AMBULATORY_WRITE_CAPABILITY))
    }

    fn save_ambulatory_editor(&mut self, cx: &mut Context<Self>) {
        if !self.can_manage_ambulatories() {
            return;
        }
        let Some(editor) = &mut self.ambulatory_management.draft else {
            return;
        };
        if !editor.can_save() {
            return;
        }
        let nullable = |value: String| (!value.trim().is_empty()).then_some(value);
        let draft = AmbulatoryDraft {
            name: editor.fields[0].value(cx).trim().to_owned(),
            address: nullable(editor.fields[1].value(cx)),
            description: nullable(editor.fields[2].value(cx)),
            parent_id: editor.parent.clone(),
            kind: if editor.test { "test" } else { "live" }.into(),
            is_default: editor.default,
        };
        let rows = self.ambulatories.ready().expect("read list");
        if draft.name.is_empty()
            || draft.parent_id.as_ref().is_some_and(|parent| {
                !parent_allowed(rows, parent, editor.target.as_ref().map(|r| r.id.as_str()))
            })
        {
            self.ambulatory_management.message = Some((
                "Indica un nome e una sede superiore valida, senza collegamenti circolari.".into(),
                true,
            ));
            cx.notify();
            return;
        }
        let target = editor
            .target
            .as_ref()
            .map(|row| (row.id.clone(), row.version));
        editor.saving = true;
        let session = self.session.clone().expect("session");
        let scope = self.scope.clone().expect("scope");
        self.run(move || session.save_ambulatory(&scope, target.as_ref().map(|(id,v)| (id.as_str(),*v)), &draft), |this, result, cx| {
            let Some(editor) = &mut this.ambulatory_management.draft else { return; };
            editor.saving = false;
            editor.requires_read = true;
            match result {
                Ok(receipt) => {
                    editor.accepted = Some(receipt);
                    this.ambulatory_management.message = Some(("Modifica accettata dall’archivio. Verifica dell’elenco in corso…".into(), false));
                    this.load_ambulatories(cx);
                }
                Err(error) => {
                    editor.creation_unconfirmed = editor.target.is_none() && matches!(error, RuntimeError::Indeterminate | RuntimeError::Transport | RuntimeError::InvalidResponse);
                    this.ambulatory_management.message = Some((if editor.creation_unconfirmed {
                        "Creazione non confermata. La bozza è conservata e non verrà reinviata. Rileggi l’elenco e verifica se la sede è stata creata prima di scartare questa bozza.".into()
                    } else { format!("{} La bozza è conservata. Rileggi le sedi e confronta prima di inviare un’altra modifica.", ui_error(error)) }, true));
                },
            }
        }, cx);
        cx.notify();
    }

    pub(super) fn prepare_ambulatory_management(
        &mut self,
        theme: Theme,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.ambulatory_management.active || self.area != Area::Settings {
            return;
        }
        if self.ambulatory_management.focus_editor {
            if let Some(field) = self
                .ambulatory_management
                .bootstrap
                .as_ref()
                .and_then(|editor| editor.fields.first())
                .or_else(|| {
                    self.ambulatory_management
                        .draft
                        .as_ref()
                        .and_then(|draft| draft.fields.first())
                })
            {
                field.editor.update(cx, |input, cx| input.focus(window, cx));
                if let Some(target) = &field.scroll_target {
                    target.scroll_to(window, cx);
                }
            }
            self.ambulatory_management.focus_editor = false;
        }
        if let Some(editor) = &self.ambulatory_management.bootstrap {
            for (index, field) in editor.fields.iter().enumerate() {
                field.editor.update(cx, |input, cx| {
                    input.configure(
                        theme,
                        editor.busy || (index < 3 && (editor.web.is_some() || editor.attempted)),
                        cx,
                    )
                });
                if let Some(target) = &field.scroll_target {
                    target.reveal_if_focused(window, cx);
                }
            }
        }
        let mut ids: Vec<String> = ["back", "reread"]
            .into_iter()
            .map(|suffix| format!("clinical-workspace-ambulatories-{suffix}"))
            .chain(
                [
                    "create",
                    "kind-live",
                    "kind-test",
                    "parent",
                    "parent-none",
                    "default",
                    "save",
                    "discard",
                ]
                .into_iter()
                .map(|suffix| format!("clinical-workspace-ambulatory-{suffix}")),
            )
            .collect();
        ids.extend(
            ["open", "auth", "confirm", "read", "select", "cancel"]
                .into_iter()
                .map(|suffix| format!("bootstrap-{suffix}")),
        );
        if let Some(rows) = self.ambulatories.ready() {
            for row in rows {
                for action in ["select", "edit", "parent"] {
                    ids.push(format!("clinical-workspace-ambulatory-{action}-{}", row.id));
                }
            }
        }
        self.ambulatory_management
            .commands
            .retain(|id, _| ids.contains(id));
        for id in ids {
            self.ambulatory_management
                .commands
                .entry(id)
                .or_insert_with(|| ScrollTarget::new(&self.area_scroll, cx));
        }
        for target in self.ambulatory_management.commands.values() {
            target.reveal_if_focused(window, cx);
        }
        if let Some(draft) = &self.ambulatory_management.draft {
            for field in &draft.fields {
                field.editor.update(cx, |input, cx| {
                    input.configure(theme, draft.saving || draft.accepted.is_some(), cx)
                });
                if let Some(target) = &field.scroll_target {
                    target.reveal_if_focused(window, cx);
                }
            }
        }
    }

    fn ambulatory_button(
        &self,
        id: impl Into<SharedString>,
        label: impl Into<SharedString>,
        theme: Theme,
        primary: bool,
        enabled: bool,
    ) -> Stateful<Div> {
        let id = id.into();
        let element = button(id.clone(), label, theme, primary, enabled);
        if let Some(target) = self.ambulatory_management.commands.get(id.as_ref()) {
            target.attach_enabled(element, enabled)
        } else {
            element
        }
    }

    pub(super) fn ambulatory_management_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let management = &self.ambulatory_management;
        let busy = management.is_saving();
        let loaded = matches!(self.ambulatories, Load::Ready(_));
        let mut view = div().w_full().min_w_0().max_w(px(760.)).flex().flex_col().gap(px(24.))
            .child(heading("clinical-workspace-ambulatories-heading", "Ambulatori", theme))
            .child(div().flex().flex_wrap().gap(px(12.))
                .child(self.ambulatory_button("clinical-workspace-ambulatories-back", "Torna alle Impostazioni", theme, false, !busy)
                    .on_click(cx.listener(|this, _, _, cx| { if this.ambulatory_management.is_saving() { return; } this.ambulatory_management.active=false; cx.notify(); })))
                .child(self.ambulatory_button("clinical-workspace-ambulatories-reread", "Rileggi le sedi", theme, false, !busy && !matches!(self.ambulatories, Load::Loading))
                    .on_click(cx.listener(|this, _, _, cx| {
                            if this.ambulatory_management.is_saving() || matches!(this.ambulatories,Load::Loading) { return; }
                            this.ambulatory_management.rebase=true; this.load_ambulatories(cx);
                        }))))
            .child(div().text_color(theme.secondary).child(text!("La sede corrente limita le cartelle visualizzate. La sede predefinita viene proposta al nuovo accesso; cambiarla non sposta la selezione di questa sessione.")));
        if let Some((message, failed)) = &management.message {
            view = view.child(notice(
                "clinical-workspace-ambulatories-message",
                message.clone(),
                theme,
                *failed,
            ));
        }
        if self.scope.is_none() {
            view = view.child(notice("clinical-workspace-ambulatories-no-scope", "Scegli una sede per continuare. Se l’archivio non contiene sedi, la prima va creata sul computer che lo ospita.", theme, false));
        }
        if !self
            .session
            .as_ref()
            .is_some_and(|s| s.can_write(AMBULATORY_WRITE_CAPABILITY))
        {
            view = view.child(notice("clinical-workspace-ambulatories-readonly", "Questo accesso consente di scegliere una sede. Per modificarle serve l’autorizzazione del computer che ospita l’archivio.", theme, false));
        }
        if management.bootstrap.is_some() || self.ambulatories.ready().is_some_and(Vec::is_empty) {
            view = view.child(self.first_ambulatory_view(cx));
        }
        if let Some(editor) = &management.draft {
            let editable = !busy && editor.accepted.is_none();
            let parent_name = editor
                .parent
                .as_ref()
                .map(|id| {
                    self.ambulatories
                        .ready()
                        .and_then(|rows| rows.iter().find(|r| r.id == *id))
                        .map(|r| r.name.clone())
                        .unwrap_or_else(|| "Sede non più disponibile".into())
                })
                .unwrap_or_else(|| "Nessuna".into());
            view = view.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .child(section(
                        "clinical-workspace-ambulatory-editor-heading",
                        if editor.target.is_some() {
                            "Modifica sede"
                        } else {
                            "Nuova sede"
                        },
                        theme,
                    ))
                    .when_some(editor.target.as_ref(), |el, row| {
                        el.child(div().text_color(theme.secondary).child(text!(format!(
                                "Registrato: {} · {} · {}",
                                row.name,
                                row.address.as_deref().unwrap_or("Indirizzo non indicato"),
                                row.description
                                    .as_deref()
                                    .unwrap_or("Descrizione non indicata")
                            ))))
                    })
                    .children(editor.fields.iter().enumerate().map(|(index, field)| {
                        self.field_view(
                            field,
                            format!("clinical-workspace-ambulatory-field-{index}"),
                            cx,
                        )
                    }))
                    .child(
                        div().flex().flex_wrap().gap(px(8.)).children(
                            [(false, "Sede clinica"), (true, "Sede di prova")]
                                .into_iter()
                                .map(|(test, label)| {
                                    self.ambulatory_button(
                                        if test {
                                            "clinical-workspace-ambulatory-kind-test"
                                        } else {
                                            "clinical-workspace-ambulatory-kind-live"
                                        },
                                        label,
                                        theme,
                                        false,
                                        editable,
                                    )
                                    .aria_selected(editor.test == test)
                                    .when(editor.test == test, |el| {
                                        el.bg(theme.selected).border_color(theme.fresh)
                                    })
                                    .when(editable, |el| {
                                        el.on_click(cx.listener(move |this, _, _, cx| {
                                            if let Some(draft) =
                                                &mut this.ambulatory_management.draft
                                            {
                                                if draft.saving || draft.accepted.is_some() {
                                                    return;
                                                }
                                                draft.test = test;
                                            }
                                            cx.notify();
                                        }))
                                    })
                                }),
                        ),
                    )
                    .child(
                        self.ambulatory_button(
                            "clinical-workspace-ambulatory-parent",
                            format!("Sede superiore: {parent_name}"),
                            theme,
                            false,
                            editable,
                        )
                        .aria_expanded(editor.parent_menu)
                        .on_click(cx.listener(|this, _, _, cx| {
                            if let Some(draft) = &mut this.ambulatory_management.draft {
                                if draft.saving || draft.accepted.is_some() {
                                    return;
                                }
                                draft.parent_menu = !draft.parent_menu;
                            }
                            cx.notify();
                        })),
                    )
                    .when(editor.parent_menu, |el| {
                        el.child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(8.))
                                .child(
                                    self.ambulatory_button(
                                        "clinical-workspace-ambulatory-parent-none",
                                        "Nessuna sede superiore",
                                        theme,
                                        false,
                                        editable,
                                    )
                                    .on_click(cx.listener(
                                        |this, _, _, cx| {
                                            if let Some(draft) =
                                                &mut this.ambulatory_management.draft
                                            {
                                                if draft.saving || draft.accepted.is_some() {
                                                    return;
                                                }
                                                draft.parent = None;
                                                draft.parent_menu = false;
                                            }
                                            cx.notify();
                                        },
                                    )),
                                )
                                .children(
                                    self.ambulatories
                                        .ready()
                                        .into_iter()
                                        .flatten()
                                        .filter(|row| {
                                            parent_allowed(
                                                self.ambulatories.ready().unwrap(),
                                                &row.id,
                                                editor.target.as_ref().map(|r| r.id.as_str()),
                                            )
                                        })
                                        .map(|row| {
                                            let id = row.id.clone();
                                            self.ambulatory_button(
                                                format!(
                                                    "clinical-workspace-ambulatory-parent-{id}"
                                                ),
                                                row.name.clone(),
                                                theme,
                                                false,
                                                editable,
                                            )
                                            .aria_selected(editor.parent.as_deref() == Some(&id))
                                            .on_click(
                                                cx.listener(move |this, _, _, cx| {
                                                    if let Some(draft) =
                                                        &mut this.ambulatory_management.draft
                                                    {
                                                        if draft.saving || draft.accepted.is_some()
                                                        {
                                                            return;
                                                        }
                                                        draft.parent = Some(id.clone());
                                                        draft.parent_menu = false;
                                                    }
                                                    cx.notify();
                                                }),
                                            )
                                        }),
                                ),
                        )
                    })
                    .child(
                        self.ambulatory_button(
                            "clinical-workspace-ambulatory-default",
                            if editor.default {
                                "Sede predefinita"
                            } else {
                                "Imposta come predefinita"
                            },
                            theme,
                            false,
                            editable
                                && (!editor.target.as_ref().is_some_and(|r| r.is_default)
                                    || !editor.default),
                        )
                        .aria_selected(editor.default)
                        .on_click(cx.listener(|this, _, _, cx| {
                            if let Some(draft) = &mut this.ambulatory_management.draft {
                                if draft.saving || draft.accepted.is_some() {
                                    return;
                                }
                                draft.default = draft.target.as_ref().is_some_and(|r| r.is_default)
                                    || !draft.default;
                            }
                            cx.notify();
                        })),
                    )
                    .when(editor.target.as_ref().is_some_and(|row|row.is_default) && !editor.default, |el|el.child(notice("clinical-workspace-ambulatory-default-changed","Questa sede è diventata predefinita. Mantieni questo ruolo prima di salvare, oppure rendi predefinita un’altra sede.",theme,false)))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(12.))
                            .child(
                                self.ambulatory_button(
                                    "clinical-workspace-ambulatory-save",
                                    if busy {
                                        "Salvataggio in corso…"
                                    } else {
                                        "Salva sede"
                                    },
                                    theme,
                                    true,
                                    editor.can_save() && self.can_manage_ambulatories(),
                                )
                                .on_click(
                                    cx.listener(|this, _, _, cx| this.save_ambulatory_editor(cx)),
                                ),
                            )
                            .child(
                                self.ambulatory_button(
                                    "clinical-workspace-ambulatory-discard",
                                    "Scarta la bozza della sede",
                                    theme,
                                    false,
                                    !busy,
                                )
                                .on_click(cx.listener(
                                    |this, _, _, cx| {
                                        if this.ambulatory_management.is_saving() {
                                            return;
                                        }
                                        this.ambulatory_management.draft = None;
                                        this.ambulatory_management.message = None;
                                        cx.notify();
                                    },
                                )),
                            ),
                    ),
            );
        } else {
            view = view.child(
                self.ambulatory_button(
                    "clinical-workspace-ambulatory-create",
                    "Nuova sede",
                    theme,
                    true,
                    self.can_manage_ambulatories(),
                )
                .on_click(cx.listener(|this, _, _, cx| this.open_ambulatory_editor(None, cx))),
            );
        }
        view = view.child(section(
            "clinical-workspace-ambulatories-list-heading",
            "Sedi registrate",
            theme,
        ));
        match &self.ambulatories {
            Load::Loading => view.child(notice(
                "clinical-workspace-ambulatories-loading",
                "Lettura delle sedi in corso…",
                theme,
                false,
            )),
            Load::Failed(message) => view.child(notice(
                "clinical-workspace-ambulatories-error",
                format!("{message} L’elenco non è aggiornato. La bozza resta disponibile."),
                theme,
                true,
            )),
            Load::Idle => view.child(notice(
                "clinical-workspace-ambulatories-idle",
                "Rileggi le sedi per iniziare.",
                theme,
                false,
            )),
            Load::Ready(rows) if rows.is_empty() => view.child(notice(
                "clinical-workspace-ambulatories-empty",
                "Nessuna sede presente nell’archivio.",
                theme,
                false,
            )),
            Load::Ready(rows) => {
                let mut sorted: Vec<_> = rows.iter().collect();
                sorted.sort_by_key(|row| {
                    let mut key = ancestry(rows, &row.id).unwrap_or_default();
                    key.push(row.id.clone());
                    key
                });
                view.children(sorted.into_iter().map(|row| {
                    let id=row.id.clone(); let edit_id=id.clone();
                    let path=ancestry(rows,&id);
                    let parent_line=path.as_ref().map(|ids| ids.iter().filter_map(|id| rows.iter().find(|r| r.id==*id).map(|r|r.name.as_str())).collect::<Vec<_>>().join(" / ")).unwrap_or_else(|_|"Collegamento tra sedi non valido: verifica sul computer che ospita l’archivio".into());
                    div().id(format!("clinical-workspace-ambulatory-row-{id}")).border_t_1().border_color(theme.rule).pt(px(16.)).flex().flex_col().gap(px(8.))
                        .when(!parent_line.is_empty(),|el| el.child(div().text_color(theme.secondary).child(row_text(&row.id,"parent-path",parent_line))))
                        .child(row_text(&row.id,"name",format!("{}{}{}",row.name,if row.is_default { " · Predefinita" } else { "" },if row.kind.as_deref()==Some("test") { " · Prova" } else { "" })))
                        .when_some(row.address.as_ref(),|el,address|el.child(row_text(&row.id,"address",address.clone())))
                        .when_some(row.description.as_ref(),|el,description|el.child(div().text_color(theme.secondary).child(row_text(&row.id,"description",description.clone()))))
                        .child(div().flex().flex_wrap().gap(px(12.))
                            .child(self.ambulatory_button(format!("clinical-workspace-ambulatory-select-{id}"),if self.scope.as_deref()==Some(&id) { "Sede corrente" } else { "Lavora in questa sede" },theme,false,!busy && management.draft.is_none()).aria_selected(self.scope.as_deref()==Some(&id)).on_click(cx.listener(move|this,_,_,cx|this.change_scope(&id,cx))))
                            .child(self.ambulatory_button(format!("clinical-workspace-ambulatory-edit-{edit_id}"),"Modifica sede",theme,false,loaded && management.draft.is_none() && self.can_manage_ambulatories()).on_click(cx.listener(move|this,_,_,cx|this.open_ambulatory_editor(Some(&edit_id),cx)))))
                }))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::Focusable;
    fn row(id: &str, version: u64, default: bool, parent: Option<&str>) -> Ambulatory {
        Ambulatory {
            id: id.into(),
            name: format!("Registrato {id}"),
            address: None,
            description: None,
            parent_id: parent.map(str::to_owned),
            kind: Some("live".into()),
            is_default: default,
            version,
            created_at: None,
        }
    }
    fn stage(
        app: &mut ClinicalApp,
        target: Option<Ambulatory>,
        cx: &mut Context<ClinicalApp>,
    ) -> Entity<TextInput> {
        let field = Field::new(
            "ambulatory-synthetic-draft",
            "Nome",
            "Bozza sintetica",
            false,
            false,
            app.theme,
            cx,
        );
        let retained = field.editor.clone();
        app.ambulatory_management.active = true;
        app.ambulatory_management.draft = Some(Editor {
            target,
            fields: vec![field],
            parent: None,
            parent_menu: false,
            test: false,
            default: false,
            saving: false,
            requires_read: true,
            creation_unconfirmed: false,
            accepted: None,
            _subscriptions: vec![],
        });
        retained
    }
    fn bootstrap_draft(
        app: &mut ClinicalApp,
        cx: &mut Context<ClinicalApp>,
    ) -> Vec<Entity<TextInput>> {
        let fields: Vec<_> = [
            ("bootstrap-name", "Nome", "Sede inventata", false),
            ("bootstrap-address", "Indirizzo", "Via inventata", false),
            (
                "bootstrap-description",
                "Descrizione",
                "Bozza conservata",
                false,
            ),
            (
                "bootstrap-passphrase",
                "Passphrase",
                "Passphrase sintetica riservata",
                true,
            ),
        ]
        .into_iter()
        .map(|(id, label, value, secret)| {
            Field::new(id, label, value, false, secret, app.theme, cx)
                .with_scroll(&app.area_scroll, cx)
        })
        .collect();
        let retained = fields.iter().map(|field| field.editor.clone()).collect();
        app.ambulatory_management.active = true;
        app.ambulatory_management.bootstrap = Some(BootstrapEditor {
            fields,
            payload: Some(
                FirstAmbulatoryDraft::new(
                    "Sede inventata".into(),
                    Some("Via inventata".into()),
                    Some("Bozza conservata".into()),
                )
                .unwrap(),
            ),
            context: None,
            web: None,
            busy: true,
            attempted: true,
            observed: None,
            message: "Invio in corso".into(),
            _subscriptions: vec![],
        });
        retained
    }
    #[gpui::test]
    fn bootstrap_cancel_preserves_stable_id_and_draft_without_rearming_and_navigation_keeps_it(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            bootstrap_draft(app, cx);
            let id = app
                .ambulatory_management
                .bootstrap
                .as_ref()
                .unwrap()
                .payload
                .as_ref()
                .unwrap()
                .id
                .clone();
            let epoch = app.epoch;
            app.cancel_first_ambulatory(cx);
            let editor = app.ambulatory_management.bootstrap.as_ref().unwrap();
            assert!(editor.attempted);
            assert!(!editor.busy);
            assert!(editor.web.is_none());
            assert_eq!(editor.payload.as_ref().unwrap().id, id);
            assert_eq!(editor.fields[0].value(cx), "Sede inventata");
            assert!(editor.fields[3].value(cx).is_empty());
            assert_ne!(app.epoch, epoch);
            app.navigate(Area::Agenda, cx);
            app.navigate(Area::Settings, cx);
            assert_eq!(
                app.ambulatory_management
                    .bootstrap
                    .as_ref()
                    .unwrap()
                    .payload
                    .as_ref()
                    .unwrap()
                    .id,
                id
            );
            app.verify_first_ambulatory(true, cx);
            assert!(!app.ambulatory_management.bootstrap.as_ref().unwrap().busy);
        });
    }
    #[gpui::test]
    fn bootstrap_restore_retires_retained_fields_and_first_field_focus_is_real(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let retained = cx.update_window_entity(&view, |app, window, cx| {
            app.area = Area::Settings;
            let retained = bootstrap_draft(app, cx);
            app.ambulatory_management.focus_editor = true;
            app.prepare_ambulatory_management(app.theme, window, cx);
            assert!(retained[0].read(cx).focus_handle(cx).is_focused(window));
            app.save_error(RuntimeError::ArchiveReplaced, cx);
            assert!(app.ambulatory_management.bootstrap.is_none());
            retained
        });
        for input in retained {
            input.read_with(cx, |input, _| {
                assert!(input.value().is_empty());
                assert!(input.read_only);
            });
        }
    }

    #[test]
    fn repeated_ambulatory_rows_have_distinct_stable_accessible_text_nodes() {
        let nodes: Vec<_> = ["a", "b"]
            .into_iter()
            .flat_map(|id| {
                ["name", "address", "description", "parent-path"]
                    .map(|field| row_text(id, field, "Testo sintetico"))
            })
            .collect();
        let ids: HashSet<_> = nodes.iter().map(|text| text.id().unwrap()).collect();
        assert_eq!(ids.len(), nodes.len());
        assert_eq!(
            row_text("a", "name", "Prima").id(),
            row_text("a", "name", "Dopo").id()
        );
    }

    #[test]
    fn initial_default_does_not_become_a_reload_or_scope_loss_fallback() {
        let rows = vec![row("a", 1, false, None), row("b", 1, true, None)];
        assert_eq!(selection(&rows, None, true), Selection::Initial("b".into()));
        assert_eq!(selection(&rows, Some("a"), false), Selection::Preserve);
        assert_eq!(selection(&rows, Some("missing"), true), Selection::Lost);
        assert_eq!(selection(&rows, None, false), Selection::Unselected);
        assert_eq!(
            selection(&[row("a", 1, false, None)], None, true),
            Selection::Unselected
        );
    }
    #[test]
    fn parent_picker_denies_descendants_cycles_and_missing_parents() {
        let rows = vec![
            row("a", 1, true, None),
            row("b", 1, false, Some("a")),
            row("c", 1, false, Some("b")),
            row("orphan", 1, false, Some("missing")),
        ];
        assert!(!parent_allowed(&rows, "c", Some("a")));
        assert!(!parent_allowed(&rows, "a", Some("a")));
        assert!(!parent_allowed(&rows, "orphan", None));
        assert!(parent_allowed(&rows, "a", Some("c")));
        let cycle = vec![row("a", 1, false, Some("b")), row("b", 1, false, Some("a"))];
        assert!(ancestry(&cycle, "a").is_err());
    }
    #[gpui::test]
    fn entering_the_editor_moves_focus_from_the_row_to_the_first_field(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.update_window_entity(&view, |app, window, cx| {
            app.area = Area::Settings;
            let input = stage(app, Some(row("a", 1, false, None)), cx);
            app.ambulatory_management.focus_editor = true;
            app.prepare_ambulatory_management(app.theme, window, cx);
            assert!(input.read(cx).focus_handle(cx).is_focused(window));
            assert!(!app.ambulatory_management.focus_editor);
        });
    }

    #[gpui::test]
    fn only_a_valid_explicit_scope_choice_clears_the_scope_loss_notice(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.ambulatory_management.initial_scope = false;
            app.ambulatories = Load::Ready(vec![row("b", 2, true, None)]);
            app.message = Some(("Sede corrente non disponibile".into(), true));
            app.change_scope("not-admitted", cx);
            assert!(app.scope.is_none());
            assert!(app.message.is_some());
            app.change_scope("b", cx);
            assert_eq!(app.scope.as_deref(), Some("b"));
            assert!(app.message.is_none());
        });
    }

    #[gpui::test]
    fn reload_during_save_keeps_the_callback_epoch_and_retired_reads_can_restart(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            stage(app, Some(row("a", 1, false, None)), cx);
            app.ambulatory_management.draft.as_mut().unwrap().saving = true;
            let epoch = app.epoch;
            app.request_discard(Discard::Reload, cx);
            assert_eq!(
                app.epoch, epoch,
                "reload cannot orphan an in-flight mutation callback"
            );
            assert!(app.ambulatory_management.is_saving());
            assert_eq!(
                app.ambulatory_management.draft.as_ref().unwrap().fields[0].value(cx),
                "Bozza sintetica"
            );
            app.ambulatory_management.draft.as_mut().unwrap().saving = false;
            app.ambulatories = Load::Loading;
            app.next_epoch();
            assert!(
                matches!(app.ambulatories, Load::Idle),
                "a cancelled loading state must be rereadable on return"
            );
            app.request_discard(Discard::Reload, cx);
            assert!(
                app.ambulatory_management.rebase,
                "a deliberate reload belongs to the active editor"
            );
            app.ambulatory_management.rebase = false;
            app.area = Area::Agenda;
            app.request_discard(Discard::Reload, cx);
            assert!(
                !app.ambulatory_management.rebase,
                "reload belongs to the currently visible area"
            );
            assert_eq!(
                app.ambulatory_management.draft.as_ref().unwrap().fields[0].value(cx),
                "Bozza sintetica"
            );
        });
    }

    #[gpui::test]
    fn conflict_preserves_draft_and_only_explicit_reread_updates_the_base(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.scope = Some("a".into());
            app.ambulatory_management.initial_scope = false;
            stage(app, Some(row("a", 1, true, None)), cx);
            app.receive_ambulatories(vec![row("a", 3, true, None)], cx);
            assert_eq!(
                app.ambulatory_management
                    .draft
                    .as_ref()
                    .unwrap()
                    .target
                    .as_ref()
                    .unwrap()
                    .version,
                1
            );
            app.ambulatory_management.rebase = true;
            app.receive_ambulatories(vec![row("a", 3, true, None)], cx);
            let draft = app.ambulatory_management.draft.as_ref().unwrap();
            assert_eq!(draft.fields[0].value(cx), "Bozza sintetica");
            assert_eq!(draft.target.as_ref().unwrap().version, 3);
            assert!(!draft.requires_read);
            assert_eq!(app.scope.as_deref(), Some("a"));
            let draft = app.ambulatory_management.draft.as_mut().unwrap();
            assert!(!draft.can_save(), "cannot demote a newly observed default");
            draft.default = true;
            assert!(
                draft.can_save(),
                "explicitly maintaining the default permits saving"
            );
        });
    }
    #[gpui::test]
    fn scope_loss_keeps_draft_without_selecting_another_default_and_restore_retires_editors(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let retained = view.update(cx, |app, cx| {
            app.scope = Some("a".into());
            app.ambulatory_management.initial_scope = false;
            let retained = stage(app, Some(row("a", 1, false, None)), cx);
            app.stage_fields(
                FormKind::Notes,
                vec![editing::FieldSpec {
                    id: "clinical-synthetic-draft",
                    label: "Note",
                    value: "Bozza clinica della sede a".into(),
                    multiline: true,
                    rich: false,
                    choices: &[],
                }],
                None,
                cx,
            );
            app.receive_ambulatories(vec![row("b", 2, true, None)], cx);
            assert!(app.scope.is_none());
            assert_eq!(
                app.form.as_ref().unwrap().fields[0].value(cx),
                "Bozza clinica della sede a"
            );
            assert!(
                app.form
                    .as_ref()
                    .is_some_and(|form| form.state == FormState::Conflict)
            );
            app.receive_ambulatories(vec![row("b", 2, true, None)], cx);
            assert!(app.scope.is_none());
            assert_eq!(
                app.ambulatory_management.draft.as_ref().unwrap().fields[0].value(cx),
                "Bozza sintetica"
            );
            app.save_error(RuntimeError::ArchiveReplaced, cx);
            assert!(app.ambulatory_management.draft.is_none());
            retained
        });
        retained.read_with(cx, |input, _| {
            assert!(input.value().is_empty());
            assert!(input.read_only);
        });
    }
    #[gpui::test]
    fn accepted_save_requires_readback_of_default_demotions_and_never_rearms_an_uncertain_creation(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.scope = Some("a".into());
            app.ambulatory_management.initial_scope = false;
            stage(app, None, cx);
            let draft = app.ambulatory_management.draft.as_mut().unwrap();
            draft.creation_unconfirmed = true;
            app.ambulatory_management.rebase = true;
            app.receive_ambulatories(vec![row("a", 2, true, None)], cx);
            assert!(
                app.ambulatory_management
                    .draft
                    .as_ref()
                    .unwrap()
                    .requires_read
            );
            app.ambulatory_management.draft.as_mut().unwrap().accepted =
                Some(AmbulatoryMutationReceipt {
                    id: "b".into(),
                    version: 1,
                    affected: vec![("a".into(), 2), ("b".into(), 1)],
                });
            app.receive_ambulatories(vec![row("a", 3, false, None), row("b", 1, true, None)], cx);
            assert!(app.ambulatory_management.draft.is_some());
            app.receive_ambulatories(vec![row("a", 2, false, None), row("b", 1, true, None)], cx);
            assert!(app.ambulatory_management.draft.is_none());
            assert_eq!(app.scope.as_deref(), Some("a"));
        });
    }
}
