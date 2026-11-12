use super::*;
use crate::chat_access::owner::{Pending, State as RequestState};
use crate::local_voice::{Event, Fault, Session, State, Visible, reviewed_text};

#[derive(Clone, Debug, PartialEq, Eq)]
struct Binding {
    namespace: String,
    scope: String,
    patient: String,
    revision: u64,
    epoch: u64,
}
struct Work {
    binding: Binding,
    pending: Pending,
    session: Session,
    state: State,
    /// Testo dal vivo già mostrato, per ridisegnare solo quando cambia.
    live: zeroize::Zeroizing<String>,
    /// La trascrizione è già nell'editor di revisione.
    filled: bool,
    /// Tempo trascorso già mostrato: si ridisegna a ogni secondo che passa.
    clock: String,
}
impl Work {
    fn new(binding: Binding, pending: Pending, session: Session) -> Self {
        let state = session.state();
        Self {
            binding,
            pending,
            session,
            state,
            live: Default::default(),
            filled: false,
            clock: String::new(),
        }
    }
}
pub(super) struct LocalVoice {
    work: Option<Work>,
    editor: Entity<TextInput>,
}
impl LocalVoice {
    pub(super) fn is_open(&self) -> bool {
        self.work.is_some()
    }
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        let editor = cx.new(|cx| {
            TextInput::new(
                "chat-voice-review",
                "Trascrizione da rivedere",
                "",
                true,
                theme,
                cx,
            )
        });
        cx.subscribe(&editor, |_, _, _: &crate::text_input::InputChanged, cx| {
            cx.notify()
        })
        .detach();
        Self { work: None, editor }
    }
    pub(super) fn retire(&mut self, cx: &mut App) {
        if let Some(work) = self.work.take()
            && let Ok(mut pending) = work.pending.lock()
        {
            pending.withdraw();
        }
        self.editor.update(cx, |input, cx| input.retire(cx));
    }
}
impl ClinicalApp {
    fn voice_drug_suggestions(&self, cx: &App) -> Vec<crate::local_voice::drug_review::Suggestion> {
        let Some(work) = &self.chat_access.voice.work else {
            return Vec::new();
        };
        if !work.state.reviewable()
            || !work.filled
            || self.voice_binding().as_ref() != Some(&work.binding)
            || !work
                .pending
                .lock()
                .is_ok_and(|mut p| p.status() == RequestState::VoiceOpened)
        {
            return Vec::new();
        }
        let Some(therapies) = self.patient.therapies.ready() else {
            return Vec::new();
        };
        crate::local_voice::drug_review::suggestions(
            self.chat_access.voice.editor.read(cx).value(),
            therapies
                .iter()
                .filter(|t| t.patient_id == work.binding.patient && t.deleted_at.is_none())
                .flat_map(|t| {
                    std::iter::once(t.drug_name.as_str()).chain(t.active_principle.as_deref())
                }),
        )
    }

    fn apply_voice_drug_suggestion(
        &mut self,
        binding: &Binding,
        suggestion: &crate::local_voice::drug_review::Suggestion,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.voice_binding().as_ref() != Some(binding) {
            self.chat_access.voice.retire(cx);
            return;
        }
        if self.voice_drug_suggestions(cx).contains(suggestion) {
            self.chat_access.voice.editor.update(cx, |input, cx| {
                input.correct_word(
                    suggestion.range.clone(),
                    &suggestion.original,
                    &suggestion.replacement,
                    window,
                    cx,
                );
            });
            self.poll_chat_voice(cx);
        }
    }

    fn voice_binding(&self) -> Option<Binding> {
        let session = self.session.as_ref().filter(|s| !s.is_locked())?;
        let patient = self.patient.detail.ready()?;
        if self.privacy_shield
            || self.selected_id.as_ref() != Some(&patient.id)
            || patient.is_archived
            || patient.deleted_at.is_some()
        {
            return None;
        }
        Some(Binding {
            namespace: session.chat_write_reference_namespace(),
            scope: self.scope.clone()?,
            patient: patient.id.clone(),
            revision: patient.version,
            epoch: self.epoch,
        })
    }
    /// Nomi dei farmaci delle terapie del paziente aperto: orientano il
    /// motore whisper e restano sul Mac.
    fn voice_vocabulary(&self) -> zeroize::Zeroizing<String> {
        #[cfg(target_os = "macos")]
        if let Some(therapies) = self.patient.therapies.ready() {
            return crate::local_voice::whisper::vocabulary_prompt(
                therapies.iter().map(|t| t.drug_name.as_str()).chain(
                    therapies
                        .iter()
                        .filter_map(|t| t.active_principle.as_deref()),
                ),
            );
        }
        zeroize::Zeroizing::default()
    }
    pub(super) fn open_chat_voice(&mut self, pending: &Pending, cx: &mut Context<Self>) {
        let binding = self.voice_binding().filter(|_| {
            self.form.is_none()
                && self.chat_access.voice.work.is_none()
                && self.chat_access.pending.is_none()
                && !self.patient_document.is_open()
                && !self.local_work_pending()
                && self.can_write(FormKind::Entry)
        });
        let opened = binding.is_some();
        if let Some(binding) = binding {
            self.chat_access
                .voice
                .editor
                .update(cx, |input, cx| input.set_content("", cx));
            let session = Session::new(self.voice_vocabulary());
            self.chat_access.voice.work = Some(Work::new(binding, pending.clone(), session));
        }
        if let Ok(mut p) = pending.lock() {
            p.finish_voice_open(opened);
        }
        cx.notify();
    }
    pub(super) fn poll_chat_voice(&mut self, cx: &mut Context<Self>) {
        let current = self.voice_binding();
        let Some(work) = self.chat_access.voice.work.as_mut() else {
            return;
        };
        if current.as_ref() != Some(&work.binding)
            || !work
                .pending
                .lock()
                .is_ok_and(|mut p| p.status() == RequestState::VoiceOpened)
        {
            self.chat_access.voice.retire(cx);
            cx.notify();
            return;
        }
        let state = work.session.state();
        // Si confronta il contenuto: una parola rivista può avere la stessa
        // lunghezza della precedente.
        let live = work
            .session
            .live_text()
            .map_or_else(zeroize::Zeroizing::default, |live| {
                let mut text = zeroize::Zeroizing::new(live.confirmed.as_str().to_owned());
                text.push('\u{1}');
                text.push_str(&live.provisional);
                text
            });
        if live != work.live {
            work.live = live;
            cx.notify();
        }
        let transcript = (state.reviewable() && !work.filled)
            .then(|| work.session.review_text())
            .flatten();
        // Una fine senza testo da rivedere è un errore, non una revisione vuota.
        let state = if state == State::Review && !work.filled && transcript.is_none() {
            State::Error(Fault::EngineFailed)
        } else {
            state
        };
        if state != work.state {
            work.state = state;
            cx.notify();
        }
        if let Some(text) = transcript {
            self.chat_access
                .voice
                .editor
                .update(cx, |input, cx| input.set_content(text.as_str(), cx));
            work.filled = true;
            cx.notify();
        }
        let clock = crate::local_voice::recording::clock(
            work.session.machine().elapsed(std::time::Instant::now()),
        );
        if clock != work.clock {
            work.clock = clock;
            cx.notify();
        }
        let editable = work.state.reviewable() && work.filled;
        self.chat_access
            .voice
            .editor
            .update(cx, |input, cx| input.configure(self.theme, !editable, cx));
        let ranges = self
            .voice_drug_suggestions(cx)
            .into_iter()
            .map(|s| s.range)
            .collect();
        self.chat_access
            .voice
            .editor
            .update(cx, |input, cx| input.set_suggestion_ranges(ranges, cx));
    }
    fn transfer_chat_voice(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(work) = &self.chat_access.voice.work else {
            return;
        };
        if self.voice_binding().as_ref() != Some(&work.binding)
            || !work
                .pending
                .lock()
                .is_ok_and(|mut p| p.status() == RequestState::VoiceOpened)
            || self.form.is_some()
        {
            self.chat_access.voice.retire(cx);
            return;
        }
        let Some(text) = reviewed_text(work.state, self.chat_access.voice.editor.read(cx).value())
        else {
            return;
        };
        if self.local_work_pending()
            || self.edit_pending
            || self.document_operation != DocumentOperation::Idle
            || self.patient_document.is_open()
            || !self.can_write(FormKind::Entry)
        {
            return;
        }
        self.chat_access.voice.retire(cx);
        self.open_form(FormKind::Entry, window, cx);
        if let Some(form) = &self.form
            && form.kind == FormKind::Entry
            && form.state == FormState::Draft
        {
            form.fields[2]
                .editor
                .update(cx, |input, cx| input.set_content(text.as_str(), cx));
            self.chat_access.voice.retire(cx);
        }
        cx.notify();
    }
    /// Nell'ascolto della visita, scambia le etichette di medico e paziente
    /// nel testo in revisione, correzioni comprese. Nessun salvataggio.
    fn swap_voice_speakers(&mut self, cx: &mut Context<Self>) {
        let Some(work) = &self.chat_access.voice.work else {
            return;
        };
        if !(work.state.reviewable() && work.filled && work.session.two_voices()) {
            return;
        }
        let swapped = crate::local_voice::voices::swap_speakers(
            self.chat_access.voice.editor.read(cx).value(),
        );
        self.chat_access
            .voice
            .editor
            .update(cx, |input, cx| input.set_content(&swapped, cx));
        self.poll_chat_voice(cx);
        cx.notify();
    }
    /// Dalla dettatura che manca alla pagina dove si installa il modello. La
    /// richiesta della chat si chiude come con «Scarta».
    fn open_voice_model_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.chat_access.voice.retire(cx);
        #[cfg(target_os = "macos")]
        {
            self.navigate(Area::Settings, cx);
            if self.area == Area::Settings {
                self.select_settings_page(SettingsPage::VoiceLocal, window, cx);
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = window;
        cx.notify();
    }
    pub(super) fn chat_voice_view(&self, cx: &Context<Self>) -> Option<Stateful<Div>> {
        let work = self.chat_access.voice.work.as_ref()?;
        let patient = self.patient.detail.ready()?;
        Some(
            div()
                .id("chat-local-voice")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .p(px(20.))
                .flex()
                .flex_col()
                .gap(px(12.))
                .child(heading(
                    "chat-local-voice-title",
                    if work.session.two_voices() {
                        "Ascolto della visita"
                    } else {
                        "Dettatura locale"
                    },
                    self.theme,
                ))
                .child(crate::title::title(
                    crate::title::TitleText::patient_question(
                        "Paziente: ",
                        patient.display_name(),
                        "",
                    ),
                    self.theme,
                ))
                .child({
                    // Il tempo compare dal primo audio registrato e resta
                    // fermo in pausa, alla fine e all'errore.
                    let machine = work.session.machine();
                    voice_indicator(
                        machine.visible_for(work.state),
                        machine.has_recorded().then_some(work.clock.as_str()),
                        self.theme,
                    )
                })
                .when_some(work.state.message(), |el, message| {
                    el.child(notice(
                        "chat-local-voice-state",
                        message,
                        self.theme,
                        matches!(work.state, State::Error(_)),
                    ))
                })
                .when(work.session.limit_reached(), |el| {
                    el.child(notice(
                        "chat-local-voice-limit",
                        crate::local_voice::LIMIT_REACHED,
                        self.theme,
                        false,
                    ))
                })
                .when_some(work.session.model_action(work.state), |el, label| {
                    el.child(
                        button("chat-voice-model", label, self.theme, true, true).on_click(
                            cx.listener(|this, _, window, cx| {
                                this.open_voice_model_settings(window, cx)
                            }),
                        ),
                    )
                })
                .when_some(work.session.live_text(), |el, live| {
                    let (text, provisional) = live.joined();
                    el.child(
                        div()
                            .id("chat-local-voice-live")
                            .min_w_0()
                            .max_w_full()
                            .whitespace_normal()
                            .text_color(self.theme.secondary)
                            .type_role(self.theme, crate::theme::TextRole::Body)
                            .child(live_runs(text.to_string(), provisional, self.theme)),
                    )
                })
                .when(work.session.machine().allows(Event::Start), |el| {
                    el.child(
                        button(
                            "chat-voice-start",
                            "Consenti e avvia",
                            self.theme,
                            true,
                            true,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.poll_chat_voice(cx);
                            if let Some(work) = &this.chat_access.voice.work {
                                work.session.start();
                            }
                            cx.notify();
                        })),
                    )
                    .child(
                        button(
                            "chat-voice-start-visit",
                            "Consenti e ascolta la visita",
                            self.theme,
                            false,
                            true,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.poll_chat_voice(cx);
                            if let Some(work) = &this.chat_access.voice.work {
                                work.session.start_visit();
                            }
                            cx.notify();
                        })),
                    )
                })
                .when(work.state == State::Recording, |el| {
                    el.child(
                        button("chat-voice-pause", "Pausa", self.theme, false, true).on_click(
                            cx.listener(|this, _, _, cx| {
                                if let Some(work) = &this.chat_access.voice.work {
                                    work.session.pause();
                                }
                                cx.notify();
                            }),
                        ),
                    )
                })
                .when(work.state == State::Paused, |el| {
                    el.child(
                        button("chat-voice-resume", "Riprendi", self.theme, false, true).on_click(
                            cx.listener(|this, _, _, cx| {
                                if let Some(work) = &this.chat_access.voice.work {
                                    work.session.resume();
                                }
                                cx.notify();
                            }),
                        ),
                    )
                })
                .when(work.session.machine().allows(Event::Stop), |el| {
                    el.child(
                        button(
                            "chat-voice-stop",
                            "Termina e trascrivi",
                            self.theme,
                            true,
                            true,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            if let Some(work) = &this.chat_access.voice.work {
                                work.session.stop();
                            }
                            cx.notify();
                        })),
                    )
                })
                .when(work.state.reviewable() && work.filled, |el| {
                    el.child(self.chat_access.voice.editor.clone())
                        .children(
                            self.voice_drug_suggestions(cx)
                                .into_iter()
                                .map(|suggestion| {
                                    let binding = work.binding.clone();
                                    button(
                                        format!("chat-voice-drug-{}", suggestion.range.start),
                                        format!(
                                            "{} → {}",
                                            suggestion.original, suggestion.replacement
                                        ),
                                        self.theme,
                                        false,
                                        true,
                                    )
                                    .on_click(cx.listener(
                                        move |this, _, window, cx| {
                                            this.apply_voice_drug_suggestion(
                                                &binding,
                                                &suggestion,
                                                window,
                                                cx,
                                            );
                                        },
                                    ))
                                }),
                        )
                        .when(work.session.two_voices(), |el| {
                            el.child(
                                button(
                                    "chat-voice-swap",
                                    "Scambia medico e paziente",
                                    self.theme,
                                    false,
                                    true,
                                )
                                .on_click(
                                    cx.listener(|this, _, _, cx| this.swap_voice_speakers(cx)),
                                ),
                            )
                        })
                        .child(
                            button(
                                "chat-voice-transfer",
                                "Ho rivisto il testo: prepara la bozza",
                                self.theme,
                                true,
                                true,
                            )
                            .on_click(cx.listener(
                                |this, _, window, cx| this.transfer_chat_voice(window, cx),
                            )),
                        )
                })
                .child(
                    button("chat-voice-discard", "Scarta", self.theme, false, true).on_click(
                        cx.listener(|this, _, _, cx| {
                            this.chat_access.voice.retire(cx);
                            cx.notify();
                        }),
                    ),
                ),
        )
    }
}

/// Indicatore dello stato della registrazione: forma, parola e tempo
/// trascorso, così si distingue anche senza colori. VoiceOver lo legge come
/// stato: «In registrazione, 03:12».
fn voice_indicator(visible: Visible, clock: Option<&str>, theme: Theme) -> Stateful<Div> {
    use crate::local_voice::recording::Shape;
    let label = visible.label();
    let spoken = clock.map_or_else(|| label.to_owned(), |clock| format!("{label}, {clock}"));
    let color = match visible {
        Visible::Recording | Visible::Error => theme.critical,
        _ => theme.ink,
    };
    let size = px(14.);
    let shape = match visible.shape() {
        Shape::Ring => div()
            .size(size)
            .rounded_full()
            .border_2()
            .border_color(color),
        Shape::Dot => div().size(size).rounded_full().bg(color),
        Shape::Bars => div()
            .size(size)
            .flex()
            .justify_between()
            .child(div().w(px(4.)).h_full().bg(color))
            .child(div().w(px(4.)).h_full().bg(color)),
        Shape::Square => div().size(px(12.)).bg(color),
        Shape::Alert => div()
            .size(size)
            .border_2()
            .border_color(color)
            .rounded(px(2.))
            .flex()
            .items_center()
            .justify_center()
            .text_color(color)
            .text_size(px(10.))
            .child("!"),
    };
    let key = visible.key();
    div()
        .id("chat-voice-status")
        .accessibility_id("chat-voice-status")
        .role(Role::Status)
        .aria_label(spoken)
        .flex()
        .flex_wrap()
        .items_center()
        .gap(px(8.))
        .child(
            div()
                .flex_none()
                .debug_selector(move || format!("chat-voice-shape-{key}"))
                .child(shape),
        )
        .child(
            div()
                .text_color(color)
                .type_role(theme, crate::theme::TextRole::Strong)
                .child(observed("chat-voice-status-label", label)),
        )
        .when_some(clock, |el, clock| {
            el.child(
                div()
                    .text_color(color)
                    .type_role(theme, crate::theme::TextRole::Code)
                    .child(observed("chat-voice-status-clock", clock.to_owned())),
            )
        })
}

/// Testo con un id suo; nelle prove lo leggono come VoiceOver.
fn observed(id: &'static str, text: impl Into<SharedString>) -> impl IntoElement {
    let text = gpui::text!(id = id, text);
    #[cfg(test)]
    let text = crate::shell::rendered_command::observe_ink(text);
    text
}

/// Confermato nel grigio della vista, provvisorio a matita (inchiostro della
/// proposta): un tono più chiaro, che asciuga quando due parziali concordano.
fn live_highlights(
    provisional: std::ops::Range<usize>,
    theme: Theme,
) -> Vec<(std::ops::Range<usize>, gpui::HighlightStyle)> {
    let pencil = gpui::HighlightStyle {
        color: Some(theme.pencil),
        ..Default::default()
    };
    (!provisional.is_empty())
        .then_some((provisional, pencil))
        .into_iter()
        .collect()
}
fn live_runs(text: String, provisional: std::ops::Range<usize>, theme: Theme) -> gpui::StyledText {
    gpui::StyledText::new(text).with_highlights(live_highlights(provisional, theme))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::super::notes_recovery_tests::Host;
    use super::*;
    const TEXT: &str = "Nome inventato Ada Esempio. Testo clinico sintetico da correggere.";

    #[gpui::test]
    fn local_voice_requires_review_and_current_patient_before_preparing_common_writer(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        for scenario in 0..8 {
            let (pending, _remote) = crate::chat_access::owner::tests::voice_request();
            pending.lock().unwrap().finish_voice_open(true);
            cx.update_window_entity(&view, |app, window, cx| {
                app.chat_access.voice.retire(cx);
                app.form = None;
                app.session = Some(host.session.clone());
                app.scope = Some("scope-a".into());
                app.selected_id = Some("patient-a".into());
                app.patient.detail = ReadLoad::Ready(serde_json::from_value(serde_json::json!({
                    "id":"patient-a","firstName":"Ada","lastName":"Esempio","taxCode":"SYNTHETIC","version":1
                })).unwrap());
                app.privacy_shield = false;
                let binding = app.voice_binding().unwrap();
                let state = if scenario == 1 { State::Recording } else { State::Review };
                app.chat_access.voice.work = Some(Work::new(binding, pending.clone(), Session::synthetic(state, TEXT)));
                app.chat_access.voice.editor.update(cx, |input, cx| input.set_content(TEXT, cx));
                assert!(app.form.is_none(), "transcription completion must not open a writer");
                app.open_form(FormKind::Entry, window, cx);
                app.open_patient_document(cx);
                assert!(app.form.is_none() && !app.patient_document.is_open(), "another composer replaced the voice review");
                match scenario {
                    2 => app.selected_id = Some("patient-b".into()),
                    3 => app.scope = Some("scope-b".into()),
                    4 => app.epoch += 1,
                    5 => if let ReadLoad::Ready(patient) = &mut app.patient.detail { patient.version += 1; },
                    6 => app.privacy_shield = true,
                    7 => pending.lock().unwrap().withdraw(),
                    _ => {}
                }
                let requests = host.request_count();
                app.transfer_chat_voice(window, cx);
                assert_eq!(host.request_count(), requests, "voice must never write or call a model");
                if scenario == 0 {
                    let form = app.form.as_ref().unwrap();
                    assert!(form.kind == FormKind::Entry && form.state == FormState::Draft);
                    assert_eq!(form.fields[2].editor.read(cx).value(), TEXT);
                    assert!(app.chat_access.voice.work.is_none());
                    assert_eq!(app.chat_access.voice.editor.read(cx).value(), "");
                } else {
                    assert!(app.form.is_none(), "stale or unreviewed text reached the writer");
                }
                app.chat_access.voice.retire(cx);
            });
        }
    }

    #[gpui::test]
    fn whisper_live_text_is_shown_but_only_review_reaches_the_writer(
        cx: &mut gpui::TestAppContext,
    ) {
        use crate::local_voice::listening::tests::{CountingDecoder, LoudnessDetector, tone};
        use crate::local_voice::whisper::{WhisperSession, tests::InjectedSource};
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let (pending, _remote) = crate::chat_access::owner::tests::voice_request();
        pending.lock().unwrap().finish_voice_open(true);
        let whisper = WhisperSession::with_parts(
            LoudnessDetector,
            CountingDecoder::default(),
            Box::new(InjectedSource::paced(tone(600.0), 20.0)),
        );
        cx.update_window_entity(&view, |app, _, _| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.selected_id = Some("patient-a".into());
            app.patient.detail = ReadLoad::Ready(serde_json::from_value(serde_json::json!({
                "id":"patient-a","firstName":"Ada","lastName":"Esempio","taxCode":"SYNTHETIC","version":1
            })).unwrap());
            let binding = app.voice_binding().unwrap();
            let session = Session::with_whisper(whisper);
            assert_eq!(session.state(), State::Disclosure);
            session.start();
            app.chat_access.voice.work = Some(Work::new(binding, pending.clone(), session));
        });
        let mut live = String::new();
        let mut provisional_seen = false;
        let mut confirmed_seen: Vec<String> = Vec::new();
        for _ in 0..2_000 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            cx.update_window_entity(&view, |app, window, cx| {
                app.poll_chat_voice(cx);
                let work = app.chat_access.voice.work.as_ref().unwrap();
                if let Some(text) = work.session.live_text() {
                    provisional_seen |= !text.provisional.is_empty();
                    confirmed_seen.push(text.confirmed.to_string());
                    live = text.confirmed.to_string();
                }
                assert!(
                    work.session.transcript().is_none(),
                    "partial became transferable"
                );
                let requests = host.request_count();
                app.transfer_chat_voice(window, cx);
                assert!(app.form.is_none(), "live text reached the writer");
                assert_eq!(host.request_count(), requests);
                assert_eq!(app.chat_access.voice.editor.read(cx).value(), "");
            });
            if !live.is_empty() {
                break;
            }
        }
        assert!(live.starts_with("parola1"), "live text: {live}");
        assert!(
            !live.contains("incerta"),
            "unconfirmed word confirmed: {live}"
        );
        assert!(provisional_seen, "provisional text never shown");
        for pair in confirmed_seen.windows(2) {
            assert!(
                pair[1].starts_with(pair[0].as_str()),
                "confirmed went back: {pair:?}"
            );
        }
        cx.update_window_entity(&view, |app, _, _| {
            app.chat_access.voice.work.as_ref().unwrap().session.stop();
        });
        let mut reviewed = String::new();
        for _ in 0..2_000 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            cx.update_window_entity(&view, |app, _, cx| {
                app.poll_chat_voice(cx);
                let work = app.chat_access.voice.work.as_ref().unwrap();
                if work.state == State::Review {
                    reviewed = app.chat_access.voice.editor.read(cx).value().to_owned();
                    assert!(work.session.live_text().is_none());
                }
            });
            if !reviewed.is_empty() {
                break;
            }
        }
        assert!(reviewed.starts_with("parola1"), "review text: {reviewed}");
        cx.update_window_entity(&view, |app, window, cx| {
            assert!(
                app.form.is_none(),
                "transcription completion must not open a writer"
            );
            app.transfer_chat_voice(window, cx);
            let form = app.form.as_ref().unwrap();
            assert!(form.kind == FormKind::Entry && form.state == FormState::Draft);
            assert_eq!(form.fields[2].editor.read(cx).value(), reviewed);
        });
    }

    #[test]
    fn provisional_words_use_the_pencil_ink_and_confirmed_words_do_not() {
        let theme = Theme::for_dark(false);
        let live = crate::local_voice::LiveText {
            confirmed: zeroize::Zeroizing::new("prosegue ramipril".into()),
            provisional: zeroize::Zeroizing::new("5 mg".into()),
        };
        let (text, range) = live.joined();
        assert_eq!(text.as_str(), "prosegue ramipril 5 mg");
        assert_eq!(&text[range.clone()], "5 mg");
        for dark in [false, true] {
            let theme = Theme::for_dark(dark);
            let runs = live_highlights(range.clone(), theme);
            assert_eq!(runs.len(), 1, "only the provisional words change ink");
            assert_eq!(runs[0].0, range);
            assert_eq!(runs[0].1.color, Some(theme.pencil));
        }
        assert!(live_highlights(22..22, theme).is_empty());
        let only = crate::local_voice::LiveText {
            confirmed: zeroize::Zeroizing::default(),
            provisional: zeroize::Zeroizing::new("visita".into()),
        };
        assert_eq!(only.joined().1, 0..6);
        assert_ne!(theme.pencil, theme.secondary);
    }

    fn recording_app<'a>(
        cx: &'a mut gpui::TestAppContext,
        host: &Host,
        session: Session,
    ) -> (
        gpui::Entity<ClinicalApp>,
        &'a mut gpui::VisualTestContext,
        impl Sized,
    ) {
        let (pending, remote) = crate::chat_access::owner::tests::voice_request();
        pending.lock().unwrap().finish_voice_open(true);
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.update_window_entity(&view, |app, _, _| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.selected_id = Some("patient-a".into());
            app.patient.detail = ReadLoad::Ready(serde_json::from_value(serde_json::json!({
                "id":"patient-a","firstName":"Ada","lastName":"Esempio","taxCode":"SYNTHETIC","version":1
            })).unwrap());
            let binding = app.voice_binding().unwrap();
            app.chat_access.voice.work = Some(Work::new(binding, pending, session));
        });
        (view, cx, remote)
    }

    /// Comandi e testi della vista come li legge VoiceOver.
    fn voice_page(cx: &mut gpui::VisualTestContext, prefix: &str) -> (Vec<String>, Vec<String>) {
        let draw = |cx: &mut gpui::VisualTestContext| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })
        };
        let ids = rendered_command::button_ids(|| draw(cx));
        let mut nodes = Vec::new();
        rendered_command::capture_all_texts(|| {
            rendered_command::take_text_nodes();
            draw(cx);
            nodes = rendered_command::take_text_nodes();
        });
        let labels = nodes
            .into_iter()
            .filter_map(|(_, node)| node.value().map(str::to_owned))
            .collect();
        (
            ids.into_iter()
                .filter(|id| id.starts_with(prefix))
                .collect(),
            labels,
        )
    }
    fn shows(labels: &[String], text: &str) -> bool {
        labels.iter().any(|label| label.contains(text))
    }

    #[gpui::test]
    fn patient_drug_typos_are_offered_without_changing_the_dictation(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(crate::text_input::bind_keys);
        let host = Host::new();
        let text = "È stabile: Ramipli 5 mg, Metformna 500 mg e Tachipirna. Ramipli la sera.";
        let (view, cx, _remote) = recording_app(cx, &host, Session::synthetic(State::Review, text));
        cx.update_window_entity(&view, |app, _, cx| {
            let therapies = [
                ("Ramipril", "Ramipril"),
                ("Glucophage", "Metformina"),
                ("Tachipirina", "Paracetamolo"),
            ];
            app.patient.therapies = ReadLoad::Ready(
                therapies
                    .into_iter()
                    .enumerate()
                    .map(|(i, (drug, principle))| {
                        serde_json::from_value(serde_json::json!({
                            "id":format!("therapy-{i}"),"patientId":"patient-a","drugName":drug,
                            "activePrinciple":principle,"dosage":"1 compressa","status":"active",
                            "startDate":"2026-01-01","version":1
                        }))
                        .unwrap()
                    })
                    .collect(),
            );
            app.chat_access.voice.work.as_mut().unwrap().state = State::Finalizing;
            app.poll_chat_voice(cx);
            assert_eq!(
                app.chat_access.voice.editor.read(cx).value().as_bytes(),
                text.as_bytes()
            );
        });
        let (ids, labels) = voice_page(cx, "chat-voice-drug-");
        assert_eq!(ids.len(), 4, "missing corrections: {labels:?}");
        for label in [
            "Ramipli → Ramipril",
            "Metformna → Metformina",
            "Tachipirna → Tachipirina",
        ] {
            assert!(shows(&labels, label), "missing {label}: {labels:?}");
        }
        cx.update_window_entity(&view, |app, _, cx| {
            app.poll_chat_voice(cx);
            assert_eq!(
                app.chat_access.voice.editor.read(cx).value().as_bytes(),
                text.as_bytes()
            );
        });
        cx.update_window_entity(&view, |app, _, cx| {
            let requests = host.request_count();
            app.poll_chat_voice(cx);
            assert_eq!(host.request_count(), requests);
            let ranges = app.chat_access.voice.editor.read(cx).suggestion_ranges();
            assert_eq!(
                ranges.iter().map(|r| &text[r.clone()]).collect::<Vec<_>>(),
                ["Ramipli", "Metformna", "Tachipirna", "Ramipli"]
            );
        });
        let target = cx
            .debug_bounds("control-label:Metformna → Metformina")
            .unwrap();
        cx.simulate_click(target.center(), gpui::Modifiers::default());
        cx.update_window_entity(&view, |app, _, cx| {
            assert_eq!(
                app.chat_access.voice.editor.read(cx).value(),
                text.replacen("Metformna", "Metformina", 1)
            );
            assert_eq!(app.voice_drug_suggestions(cx).len(), 3);
            assert!(app.form.is_none());
        });
        cx.simulate_keystrokes("cmd-z");
        cx.update_window_entity(&view, |app, _, cx| {
            assert_eq!(
                app.chat_access.voice.editor.read(cx).value().as_bytes(),
                text.as_bytes()
            );
            app.poll_chat_voice(cx);
            assert_eq!(app.voice_drug_suggestions(cx).len(), 4);
        });
        let stale = cx.update_window_entity(&view, |app, _, cx| {
            let suggestion = app.voice_drug_suggestions(cx).remove(0);
            (app.voice_binding().unwrap(), suggestion)
        });
        cx.update_window_entity(&view, |app, window, cx| {
            let requests = host.request_count();
            app.apply_voice_drug_suggestion(&stale.0, &stale.1, window, cx);
            assert_eq!(
                app.chat_access.voice.editor.read(cx).value(),
                text.replacen("Ramipli", "Ramipril", 1)
            );
            assert_eq!(host.request_count(), requests);
        });
        cx.simulate_keystrokes("cmd-z");
        cx.update_window_entity(&view, |app, window, cx| {
            app.selected_id = Some("patient-b".into());
            assert!(app.voice_drug_suggestions(cx).is_empty());
            app.poll_chat_voice(cx);
            assert!(app.chat_access.voice.work.is_none());
            assert!(
                app.chat_access
                    .voice
                    .editor
                    .read(cx)
                    .suggestion_ranges()
                    .is_empty()
            );
            app.apply_voice_drug_suggestion(&stale.0, &stale.1, window, cx);
            assert!(app.chat_access.voice.work.is_none());
            assert!(app.chat_access.voice.editor.read(cx).value().is_empty());
            assert!(
                app.chat_access
                    .voice
                    .editor
                    .read(cx)
                    .suggestion_ranges()
                    .is_empty()
            );
        });
        let (ids, _) = voice_page(cx, "chat-voice-drug-");
        assert!(ids.is_empty());
    }

    #[gpui::test]
    fn drug_suggestions_require_current_patient_therapies_and_revalidate_each_click(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = Host::new();
        let text = "Ramipli, Ramipril, controllo, lirica, Lasix e Atorvastatna.";
        let (view, cx, _remote) = recording_app(cx, &host, Session::synthetic(State::Review, text));
        cx.update_window_entity(&view, |app, window, cx| {
            app.chat_access.voice.work.as_mut().unwrap().state = State::Finalizing;
            app.poll_chat_voice(cx);
            assert!(app.voice_drug_suggestions(cx).is_empty());
            let therapy = serde_json::from_value(serde_json::json!({
                "id":"therapy-a","patientId":"patient-b","drugName":"Ramipril",
                "dosage":"5 mg","status":"active","startDate":"2026-01-01","version":1
            }))
            .unwrap();
            app.patient.therapies = ReadLoad::Ready(vec![therapy]);
            assert!(
                app.voice_drug_suggestions(cx).is_empty(),
                "other patient's therapy used"
            );
            if let ReadLoad::Ready(therapies) = &mut app.patient.therapies {
                therapies[0].patient_id = "patient-a".into();
            }
            let binding = app.voice_binding().unwrap();
            let suggestions = app.voice_drug_suggestions(cx);
            assert_eq!(suggestions.len(), 1);
            assert_eq!(suggestions[0].original, "Ramipli");
            app.chat_access.voice.editor.update(cx, |input, cx| {
                input.set_content("Testo rivisto a mano.", cx)
            });
            app.apply_voice_drug_suggestion(&binding, &suggestions[0], window, cx);
            assert_eq!(
                app.chat_access.voice.editor.read(cx).value(),
                "Testo rivisto a mano."
            );
            app.chat_access
                .voice
                .editor
                .update(cx, |input, cx| input.set_content(text, cx));
            if let ReadLoad::Ready(therapies) = &mut app.patient.therapies {
                therapies[0].deleted_at = Some("2026-11-12".into());
            }
            app.apply_voice_drug_suggestion(&binding, &suggestions[0], window, cx);
            assert_eq!(app.chat_access.voice.editor.read(cx).value(), text);
            assert!(app.voice_drug_suggestions(cx).is_empty());
        });
    }
    fn model_folder(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "mediflow-dettatura-{name}-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
        ));
        std::fs::create_dir_all(&root).unwrap();
        root
    }
    /// File di prova al posto dei pesi, con l'impronta fissata sui loro byte.
    fn fixture_model(
        directory: &std::path::Path,
    ) -> [&'static crate::local_voice::model::ModelFile; 2] {
        use crate::local_voice::model::{ModelFile, sha256_file};
        std::fs::create_dir_all(directory).unwrap();
        let mut files = Vec::new();
        for (name, bytes) in [
            ("pesi-di-prova.bin", &b"pesi inventati"[..]),
            ("vad-di-prova.bin", b"vad inventato"),
        ] {
            let path = directory.join(name);
            std::fs::write(&path, bytes).unwrap();
            let file: &'static ModelFile = Box::leak(Box::new(ModelFile {
                name,
                url: "https://127.0.0.1/mai-scaricato",
                sha256: Box::leak(sha256_file(&path).unwrap().into_boxed_str()),
                size: bytes.len() as u64,
            }));
            files.push(file);
        }
        [files[0], files[1]]
    }
    /// Motore finto sugli stessi file verificati: una parola ogni 0,5 s.
    fn fake_engine(
        _: &std::path::Path,
        _: &[&'static crate::local_voice::model::ModelFile; 2],
        _: zeroize::Zeroizing<String>,
    ) -> Result<crate::local_voice::whisper::Listener, crate::local_voice::listening::EngineFailure>
    {
        use crate::local_voice::listening::{
            Dictation,
            tests::{CountingDecoder, LoudnessDetector},
        };
        let dictation = Dictation::new(LoudnessDetector, CountingDecoder::default());
        Ok(Box::new(move |source, commands, shared| {
            crate::local_voice::whisper::listen(dictation, source, commands, shared)
        }))
    }

    #[gpui::test]
    fn without_the_model_dictation_is_missing_and_leads_to_the_install_button(
        cx: &mut gpui::TestAppContext,
    ) {
        use crate::local_voice::{model, whisper};
        let host = Host::new();
        let root = model_folder("senza-modello");
        let microphone = std::rc::Rc::new(std::cell::Cell::new(false));
        let opened = microphone.clone();
        let session = Session::open(
            whisper::Engine {
                directory: root.join("modelli-voce"),
                files: model::FILES,
                prompt: zeroize::Zeroizing::default(),
                load: whisper::load_whisper,
            },
            move || {
                opened.set(true);
                None
            },
        );
        assert!(!microphone.get(), "no microphone without the model");
        assert_eq!(session.state(), State::Error(Fault::ModelMissing));
        assert!(session.transcript().is_none() && session.live_text().is_none());
        let (view, cx, _remote) = recording_app(cx, &host, session);
        cx.update_window_entity(&view, |app, _, cx| app.poll_chat_voice(cx));
        let (ids, labels) = voice_page(cx, "chat-voice");
        assert_eq!(
            ids,
            ["chat-voice-model", "chat-voice-discard"],
            "{labels:?}"
        );
        assert!(
            shows(&labels, "Modello vocale non installato."),
            "{labels:?}"
        );
        assert!(shows(&labels, "Installa il modello"), "{labels:?}");
        assert!(!shows(&labels, "Consenti e avvia"), "{labels:?}");
        assert!(!shows(&labels, "Apple"), "{labels:?}");
        // Il gesto porta alla pagina con il pulsante che installa il modello.
        let catalog = model::Catalog::pinned(root.join("modelli-voce"));
        let requests = host.request_count();
        cx.update_window_entity(&view, |app, window, cx| {
            app.voice_model =
                super::super::voice_model::VoiceModelArea::with_catalog(Some(catalog));
            app.open_voice_model_settings(window, cx);
            assert!(app.chat_access.voice.work.is_none());
            assert_eq!(app.area, Area::Settings);
            assert_eq!(app.settings_page, SettingsPage::VoiceLocal);
        });
        assert_eq!(host.request_count(), requests, "no write and no model call");
        let (ids, labels) = voice_page(cx, "voice-model-");
        assert_eq!(ids, ["voice-model-install"], "{labels:?}");
        assert!(
            shows(
                &labels,
                "Modello non installato: la dettatura non è disponibile."
            ),
            "{labels:?}"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[gpui::test]
    fn with_the_model_installed_dictation_reaches_review_and_the_writer(
        cx: &mut gpui::TestAppContext,
    ) {
        use crate::local_voice::listening::tests::tone;
        use crate::local_voice::whisper::{self, tests::InjectedSource};
        let host = Host::new();
        let root = model_folder("con-modello");
        let directory = root.join("modelli-voce");
        let files = fixture_model(&directory);
        let session = Session::open(
            whisper::Engine {
                directory,
                files,
                prompt: zeroize::Zeroizing::default(),
                load: fake_engine,
            },
            || Some(Box::new(InjectedSource::new(tone(3.0))) as Box<dyn whisper::AudioSource>),
        );
        assert_eq!(session.state(), State::Disclosure);
        let (view, cx, _remote) = recording_app(cx, &host, session);
        cx.update_window_entity(&view, |app, _, cx| app.poll_chat_voice(cx));
        let (ids, labels) = voice_page(cx, "chat-voice");
        assert_eq!(
            ids,
            [
                "chat-voice-start",
                "chat-voice-start-visit",
                "chat-voice-discard"
            ],
            "{labels:?}"
        );
        assert!(
            !shows(&labels, "Modello vocale non installato."),
            "{labels:?}"
        );
        cx.update_window_entity(&view, |app, _, _| {
            app.chat_access.voice.work.as_ref().unwrap().session.start();
        });
        let mut reviewed = String::new();
        for _ in 0..4_000 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            cx.update_window_entity(&view, |app, _, cx| {
                app.poll_chat_voice(cx);
                if app.chat_access.voice.work.as_ref().unwrap().state == State::Review {
                    reviewed = app.chat_access.voice.editor.read(cx).value().to_owned();
                }
            });
            if !reviewed.is_empty() {
                break;
            }
        }
        assert!(
            reviewed.starts_with("parola1 parola2"),
            "review text: {reviewed}"
        );
        let (ids, _) = voice_page(cx, "chat-voice");
        assert_eq!(ids, ["chat-voice-transfer", "chat-voice-discard"]);
        let requests = host.request_count();
        cx.update_window_entity(&view, |app, window, cx| {
            app.transfer_chat_voice(window, cx);
            let form = app.form.as_ref().unwrap();
            assert!(form.kind == FormKind::Entry && form.state == FormState::Draft);
            assert_eq!(form.fields[2].editor.read(cx).value(), reviewed);
        });
        assert_eq!(host.request_count(), requests, "the draft is not saved");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[gpui::test]
    fn a_tampered_model_stops_dictation_and_leads_to_reinstall(cx: &mut gpui::TestAppContext) {
        use crate::local_voice::listening::tests::tone;
        use crate::local_voice::whisper::{self, tests::InjectedSource};
        let host = Host::new();
        let root = model_folder("alterato");
        let directory = root.join("modelli-voce");
        let files = fixture_model(&directory);
        std::fs::write(directory.join(files[0].name), b"pesi alterati").unwrap();
        let session = Session::open(
            whisper::Engine {
                directory,
                files,
                prompt: zeroize::Zeroizing::default(),
                load: fake_engine,
            },
            || Some(Box::new(InjectedSource::new(tone(3.0))) as Box<dyn whisper::AudioSource>),
        );
        let (view, cx, _remote) = recording_app(cx, &host, session);
        cx.update_window_entity(&view, |app, _, _| {
            app.chat_access.voice.work.as_ref().unwrap().session.start();
        });
        let mut state = State::Disclosure;
        for _ in 0..4_000 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            state = cx.update_window_entity(&view, |app, _, cx| {
                app.poll_chat_voice(cx);
                app.chat_access.voice.work.as_ref().unwrap().state
            });
            if state == State::Error(Fault::ModelInvalid) {
                break;
            }
        }
        assert_eq!(state, State::Error(Fault::ModelInvalid));
        let (ids, labels) = voice_page(cx, "chat-voice");
        assert_eq!(
            ids,
            ["chat-voice-model", "chat-voice-discard"],
            "{labels:?}"
        );
        assert!(
            shows(
                &labels,
                "Il modello vocale locale è incompleto o diverso da quello atteso."
            ),
            "{labels:?}"
        );
        assert!(shows(&labels, "Reinstalla il modello"), "{labels:?}");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[gpui::test]
    fn live_text_redraws_when_a_word_changes_at_the_same_length(cx: &mut gpui::TestAppContext) {
        use std::{cell::Cell, rc::Rc};
        let host = Host::new();
        let live = std::sync::Arc::new(std::sync::Mutex::new((String::new(), "alfa".to_owned())));
        let (view, cx, _remote) = recording_app(
            cx,
            &host,
            Session::synthetic_live(State::Recording, live.clone()),
        );
        let redraws = Rc::new(Cell::new(0));
        let counter = redraws.clone();
        cx.update(|_, cx| {
            cx.observe(&view, move |_, _| counter.set(counter.get() + 1))
                .detach()
        });
        cx.update_window_entity(&view, |app, _, cx| app.poll_chat_voice(cx));
        cx.run_until_parked();
        let first = redraws.get();
        assert!(first > 0, "first provisional word not drawn");
        *live.lock().unwrap() = (String::new(), "beta".to_owned());
        cx.update_window_entity(&view, |app, _, cx| app.poll_chat_voice(cx));
        cx.run_until_parked();
        assert!(redraws.get() > first, "same-length word change not redrawn");
        cx.update_window_entity(&view, |app, _, _| {
            let shown = app
                .chat_access
                .voice
                .work
                .as_ref()
                .unwrap()
                .session
                .live_text()
                .unwrap();
            assert_eq!(shown.provisional.as_str(), "beta");
        });
    }

    #[gpui::test]
    fn retiring_a_busy_whisper_session_returns_at_once_and_keeps_nothing(
        cx: &mut gpui::TestAppContext,
    ) {
        use crate::local_voice::listening::tests::{LoudnessDetector, tone};
        use crate::local_voice::whisper::{
            WhisperSession,
            tests::{BlockingDecoder, InjectedSource},
        };
        use std::time::{Duration, Instant};
        let host = Host::new();
        let (decoder, gate) = BlockingDecoder::new();
        let whisper = WhisperSession::with_parts(
            LoudnessDetector,
            decoder,
            Box::new(InjectedSource::new(tone(5.0))),
        );
        let shared = whisper.shared_for_test();
        whisper.start();
        gate.entered
            .recv_timeout(Duration::from_secs(10))
            .expect("decoder never started");
        let (view, cx, _remote) = recording_app(cx, &host, Session::with_whisper(whisper));
        // Se il ritiro aspettasse il decodificatore resterebbe fermo: lo si
        // sblocca comunque dopo 1,5 s, così il test fallisce invece di bloccarsi.
        let release = gate.release.clone();
        let releaser = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1_500));
            BlockingDecoder::open(&release);
        });
        let started = Instant::now();
        cx.update_window_entity(&view, |app, _, cx| app.chat_access.voice.retire(cx));
        let elapsed = started.elapsed();
        BlockingDecoder::open(&gate.release);
        releaser.join().unwrap();
        gate.finished
            .recv_timeout(Duration::from_secs(10))
            .expect("worker never ended");
        assert!(
            elapsed < Duration::from_millis(200),
            "retire blocked the interface for {elapsed:?}"
        );
        let s = shared.lock().unwrap();
        assert!(s.transcript.is_none() && s.stable.is_empty() && s.provisional.is_empty());
        assert_eq!(s.retained_after_cancel, Some(0), "audio buffers not wiped");
    }

    const SHAPES: [&str; 5] = [
        "chat-voice-shape-ready",
        "chat-voice-shape-recording",
        "chat-voice-shape-paused",
        "chat-voice-shape-stopped",
        "chat-voice-shape-error",
    ];

    /// Forme disegnate nell'ultimo fotogramma.
    fn shapes(cx: &mut gpui::VisualTestContext) -> Vec<&'static str> {
        SHAPES
            .into_iter()
            .filter(|selector| cx.debug_bounds(selector).is_some())
            .collect()
    }

    /// Ognuno dei cinque stati si vede con una forma, una parola e, dal primo
    /// audio, il tempo trascorso; i comandi sono solo quelli che la macchina
    /// ammette in quello stato.
    #[gpui::test]
    fn each_recording_state_has_its_own_shape_word_clock_and_commands(
        cx: &mut gpui::TestAppContext,
    ) {
        use std::time::Duration;
        let minute = Duration::from_secs(65);
        let text = "Testo sintetico registrato prima dell'interruzione.";
        /// Stato, tempo registrato, forma, parola, tempo mostrato, comandi.
        type Case = (
            State,
            Duration,
            &'static str,
            &'static str,
            Option<&'static str>,
            &'static [&'static str],
        );
        let cases: [Case; 8] = [
            (
                State::Disclosure,
                Duration::ZERO,
                "chat-voice-shape-ready",
                "Pronta",
                None,
                &[
                    "chat-voice-start",
                    "chat-voice-start-visit",
                    "chat-voice-discard",
                ],
            ),
            (
                State::Recording,
                minute,
                "chat-voice-shape-recording",
                "In registrazione",
                Some("01:05"),
                &["chat-voice-pause", "chat-voice-stop", "chat-voice-discard"],
            ),
            (
                State::Paused,
                minute,
                "chat-voice-shape-paused",
                "In pausa",
                Some("01:05"),
                &["chat-voice-resume", "chat-voice-stop", "chat-voice-discard"],
            ),
            (
                State::Finalizing,
                minute,
                "chat-voice-shape-stopped",
                "Ferma",
                Some("01:05"),
                &["chat-voice-discard"],
            ),
            (
                State::Review,
                minute,
                "chat-voice-shape-stopped",
                "Ferma",
                Some("01:05"),
                &["chat-voice-transfer", "chat-voice-discard"],
            ),
            (
                State::Error(Fault::MicrophoneMissing),
                Duration::ZERO,
                "chat-voice-shape-error",
                "Errore",
                None,
                &["chat-voice-discard"],
            ),
            (
                State::Error(Fault::MicrophoneLost),
                minute,
                "chat-voice-shape-error",
                "Errore",
                Some("01:05"),
                &["chat-voice-transfer", "chat-voice-discard"],
            ),
            (
                State::Error(Fault::PermissionDenied),
                Duration::ZERO,
                "chat-voice-shape-error",
                "Errore",
                None,
                &["chat-voice-discard"],
            ),
        ];
        let host = Host::new();
        let (view, cx, _remote) =
            recording_app(cx, &host, Session::synthetic(State::Disclosure, ""));
        let requests = host.request_count();
        for (state, elapsed, shape, word, clock, commands) in cases {
            let keeps_text = elapsed > Duration::ZERO && state.reviewable();
            cx.update_window_entity(&view, |app, _, cx| {
                let work = app.chat_access.voice.work.as_mut().unwrap();
                *work = Work::new(
                    work.binding.clone(),
                    work.pending.clone(),
                    Session::synthetic_at(state, elapsed, if keeps_text { text } else { "" }),
                );
                app.chat_access
                    .voice
                    .editor
                    .update(cx, |input, cx| input.set_content("", cx));
                app.poll_chat_voice(cx);
            });
            let (ids, labels) = voice_page(cx, "chat-voice");
            assert_eq!(ids, commands, "{state:?}: {labels:?}");
            assert_eq!(shapes(cx), [shape], "{state:?}");
            assert!(shows(&labels, word), "{state:?}: {labels:?}");
            for other in ["Pronta", "In registrazione", "In pausa", "Ferma", "Errore"] {
                assert!(
                    other == word || !shows(&labels, other),
                    "{state:?}: {labels:?}"
                );
            }
            match clock {
                Some(clock) => assert!(shows(&labels, clock), "{state:?}: {labels:?}"),
                None => assert!(!labels.iter().any(|l| l.contains(":0")), "{labels:?}"),
            }
            if let State::Error(fault) = state {
                assert!(shows(&labels, fault.message()), "{state:?}: {labels:?}");
            }
            cx.update_window_entity(&view, |app, _, cx| {
                let shown = app.chat_access.voice.editor.read(cx).value().to_owned();
                assert_eq!(shown, if keeps_text { text } else { "" }, "{state:?}");
                assert!(app.form.is_none(), "{state:?}: a writer opened by itself");
            });
        }
        assert_eq!(host.request_count(), requests, "no write and no model call");
    }

    /// Il tempo sullo schermo scorre in registrazione e resta fermo in pausa.
    #[gpui::test]
    fn the_clock_on_screen_runs_while_recording_and_stops_in_pause(cx: &mut gpui::TestAppContext) {
        use std::time::{Duration, Instant};
        let host = Host::new();
        let start = Duration::from_millis(59_400);
        let (view, cx, _remote) = recording_app(
            cx,
            &host,
            Session::synthetic_at(State::Recording, start, ""),
        );
        cx.update_window_entity(&view, |app, _, cx| app.poll_chat_voice(cx));
        let (_, labels) = voice_page(cx, "chat-voice");
        assert!(shows(&labels, "00:59"), "{labels:?}");
        let begun = Instant::now();
        let mut redrawn = false;
        while begun.elapsed() < Duration::from_secs(2) && !redrawn {
            std::thread::sleep(Duration::from_millis(50));
            redrawn = cx.update_window_entity(&view, |app, _, cx| {
                app.poll_chat_voice(cx);
                app.chat_access.voice.work.as_ref().unwrap().clock == "01:00"
            });
        }
        assert!(redrawn, "clock did not advance");
        let (_, labels) = voice_page(cx, "chat-voice");
        assert!(shows(&labels, "01:00"), "{labels:?}");
        cx.update_window_entity(&view, |app, _, cx| {
            let work = app.chat_access.voice.work.as_mut().unwrap();
            *work = Work::new(
                work.binding.clone(),
                work.pending.clone(),
                Session::synthetic_at(State::Paused, start, ""),
            );
            app.poll_chat_voice(cx);
        });
        std::thread::sleep(Duration::from_millis(1_100));
        cx.update_window_entity(&view, |app, _, cx| app.poll_chat_voice(cx));
        let (_, labels) = voice_page(cx, "chat-voice");
        assert!(shows(&labels, "00:59"), "{labels:?}");
        assert!(
            shows(&labels, "Microfono chiuso fino alla ripresa."),
            "{labels:?}"
        );
    }

    /// Il microfono si stacca a metà: la finestra lo dice subito, la cattura è
    /// chiusa, il testo fin lì resta da rivedere e nulla si scrive senza gesto.
    #[gpui::test]
    fn microphone_lost_midway_is_shown_at_once_and_keeps_the_text_unsaved(
        cx: &mut gpui::TestAppContext,
    ) {
        use crate::local_voice::listening::tests::{
            CountingDecoder, LoudnessDetector, silence, tone,
        };
        use crate::local_voice::whisper::{WhisperSession, tests::InjectedSource};
        let host = Host::new();
        let mut audio = Vec::new();
        for _ in 0..10 {
            audio.extend(tone(2.0));
            audio.extend(silence(1.0));
        }
        let mut source = InjectedSource::paced(audio, 10.0);
        source.fail_at = Some(9 * 16_000);
        let log = source.log.clone();
        let whisper = WhisperSession::with_parts(
            LoudnessDetector,
            CountingDecoder::default(),
            Box::new(source),
        );
        let (view, cx, _remote) = recording_app(cx, &host, Session::with_whisper(whisper));
        let requests = host.request_count();
        cx.update_window_entity(&view, |app, _, cx| {
            app.chat_access.voice.work.as_ref().unwrap().session.start();
            app.poll_chat_voice(cx);
        });
        let mut seen = Vec::new();
        for _ in 0..2_000 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            let (state, filled) = cx.update_window_entity(&view, |app, _, cx| {
                app.poll_chat_voice(cx);
                let work = app.chat_access.voice.work.as_ref().unwrap();
                (work.state, work.filled)
            });
            if seen.last() != Some(&state) {
                seen.push(state);
            }
            if filled {
                break;
            }
        }
        let lost = State::Error(Fault::MicrophoneLost);
        assert_eq!(seen.last(), Some(&lost), "{seen:?}");
        assert!(seen.contains(&State::Recording), "{seen:?}");
        assert_eq!(
            *log.lock().unwrap(),
            ["start", "stop"],
            "microphone left open"
        );
        let (ids, labels) = voice_page(cx, "chat-voice");
        assert_eq!(shapes(cx), ["chat-voice-shape-error"]);
        assert!(shows(&labels, "Errore"), "{labels:?}");
        assert!(
            shows(&labels, Fault::MicrophoneLost.message()),
            "{labels:?}"
        );
        assert!(!shows(&labels, "In registrazione"), "{labels:?}");
        assert_eq!(
            ids,
            ["chat-voice-transfer", "chat-voice-discard"],
            "{labels:?}"
        );
        let kept = cx.update_window_entity(&view, |app, _, cx| {
            assert!(app.form.is_none(), "a writer opened by itself");
            app.chat_access.voice.editor.read(cx).value().to_owned()
        });
        assert_eq!(kept.matches("parola").count(), 3 * 4, "{kept}");
        assert_eq!(host.request_count(), requests, "nothing saved");
        cx.update_window_entity(&view, |app, window, cx| {
            app.transfer_chat_voice(window, cx);
            let form = app.form.as_ref().unwrap();
            assert!(form.kind == FormKind::Entry && form.state == FormState::Draft);
            assert_eq!(form.fields[2].editor.read(cx).value(), kept);
        });
        assert_eq!(host.request_count(), requests, "the draft is not saved");
    }

    /// Alla durata massima la registrazione si ferma da sola e la finestra
    /// lo dice; il testo resta da rivedere e nulla si salva da solo.
    #[gpui::test]
    fn a_recording_stopped_at_the_maximum_duration_says_so(cx: &mut gpui::TestAppContext) {
        use crate::local_voice::listening::{
            Dictation, SAMPLE_RATE,
            tests::{CountingDecoder, LoudnessDetector, tone},
        };
        use crate::local_voice::whisper::{WhisperSession, tests::InjectedSource};
        let host = Host::new();
        let dictation = Dictation::new(LoudnessDetector, CountingDecoder::default())
            .with_max_recording(6 * SAMPLE_RATE);
        let whisper =
            WhisperSession::with_dictation(dictation, Box::new(InjectedSource::new(tone(20.0))));
        let (view, cx, _remote) = recording_app(cx, &host, Session::with_whisper(whisper));
        let requests = host.request_count();
        cx.update_window_entity(&view, |app, _, _| {
            app.chat_access.voice.work.as_ref().unwrap().session.start();
        });
        let mut filled = false;
        for _ in 0..2_000 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            filled = cx.update_window_entity(&view, |app, _, cx| {
                app.poll_chat_voice(cx);
                app.chat_access.voice.work.as_ref().unwrap().filled
            });
            if filled {
                break;
            }
        }
        assert!(filled, "no review text");
        let (ids, labels) = voice_page(cx, "chat-voice");
        assert_eq!(
            ids,
            ["chat-voice-transfer", "chat-voice-discard"],
            "{labels:?}"
        );
        assert!(shows(&labels, "Ferma"), "{labels:?}");
        assert!(
            shows(&labels, crate::local_voice::LIMIT_REACHED),
            "{labels:?}"
        );
        cx.update_window_entity(&view, |app, _, cx| {
            let text = app.chat_access.voice.editor.read(cx).value().to_owned();
            // 6 s di voce, una parola finta ogni 0,5 s: l'ultimo mezzo secondo
            // tagliato al limite resta incerto.
            assert_eq!(text.matches("parola").count(), 11, "{text}");
            assert!(app.form.is_none());
        });
        assert_eq!(host.request_count(), requests);
    }

    /// Bozza della visita: una riga per medico e paziente, modificabile, con
    /// l'aiuto sui farmaci del paziente e lo scambio delle due persone; si
    /// prepara solo con il gesto del medico e non si salva da sola.
    #[gpui::test]
    fn a_visit_review_is_attributed_editable_swappable_and_never_saved_by_itself(
        cx: &mut gpui::TestAppContext,
    ) {
        use crate::local_voice::voices::Speaker::{Doctor, Patient};
        cx.update(crate::text_input::bind_keys);
        let host = Host::new();
        let session = Session::synthetic_visit(&[
            (Doctor, "Buongiorno, come va?"),
            (Patient, "Bene. Prendo il Ramipli la mattina."),
            (Patient, "La sera niente."),
            (Doctor, "Continui così."),
        ]);
        let (view, cx, _remote) = recording_app(cx, &host, session);
        let requests = host.request_count();
        let draft = "Medico: Buongiorno, come va?\nPaziente: Bene. Prendo il Ramipli la mattina. La sera niente.\nMedico: Continui così.";
        cx.update_window_entity(&view, |app, _, cx| {
            app.patient.therapies = ReadLoad::Ready(vec![
                serde_json::from_value(serde_json::json!({
                    "id":"therapy-0","patientId":"patient-a","drugName":"Ramipril",
                    "activePrinciple":"Ramipril","dosage":"1 compressa","status":"active",
                    "startDate":"2026-01-01","version":1
                }))
                .unwrap(),
            ]);
            app.poll_chat_voice(cx);
            assert_eq!(app.chat_access.voice.editor.read(cx).value(), draft);
            assert!(app.form.is_none(), "a writer opened by itself");
        });
        let (ids, labels) = voice_page(cx, "chat-voice");
        assert!(!shows(&labels, "Consenti"), "{labels:?}");
        assert!(shows(&labels, "Ferma"), "{labels:?}");
        assert!(shows(&labels, "Ramipli → Ramipril"), "{labels:?}");
        assert_eq!(
            ids.iter()
                .filter(|id| !id.starts_with("chat-voice-drug-"))
                .collect::<Vec<_>>(),
            [
                "chat-voice-swap",
                "chat-voice-transfer",
                "chat-voice-discard"
            ],
            "{labels:?}"
        );
        let target = cx.debug_bounds("control-label:Ramipli → Ramipril").unwrap();
        cx.simulate_click(target.center(), gpui::Modifiers::default());
        let corrected = draft.replacen("Ramipli", "Ramipril", 1);
        cx.update_window_entity(&view, |app, _, cx| {
            assert_eq!(app.chat_access.voice.editor.read(cx).value(), corrected);
        });
        let target = cx
            .debug_bounds("control-label:Scambia medico e paziente")
            .unwrap();
        cx.simulate_click(target.center(), gpui::Modifiers::default());
        let swapped = "Paziente: Buongiorno, come va?\nMedico: Bene. Prendo il Ramipril la mattina. La sera niente.\nPaziente: Continui così.";
        cx.update_window_entity(&view, |app, _, cx| {
            assert_eq!(app.chat_access.voice.editor.read(cx).value(), swapped);
            assert!(app.form.is_none());
        });
        assert_eq!(host.request_count(), requests, "nothing saved");
        cx.update_window_entity(&view, |app, window, cx| {
            app.transfer_chat_voice(window, cx);
            let form = app.form.as_ref().unwrap();
            assert!(form.kind == FormKind::Entry && form.state == FormState::Draft);
            assert_eq!(form.fields[2].editor.read(cx).value(), swapped);
        });
        assert_eq!(host.request_count(), requests, "the draft is not saved");
    }

    /// Pronta: la stessa informativa porta alla dettatura o all'ascolto della
    /// visita, e la scelta vale per tutta la registrazione.
    #[gpui::test]
    fn ready_offers_dictation_or_visit_listening(cx: &mut gpui::TestAppContext) {
        use crate::local_voice::listening::tests::{CountingDecoder, LoudnessDetector, tone};
        use crate::local_voice::whisper::{WhisperSession, tests::InjectedSource};
        let host = Host::new();
        let whisper = WhisperSession::with_parts(
            LoudnessDetector,
            CountingDecoder::default(),
            Box::new(InjectedSource::paced(tone(60.0), 1.0)),
        );
        let (view, cx, _remote) = recording_app(cx, &host, Session::with_whisper(whisper));
        let (ids, labels) = voice_page(cx, "chat-voice");
        assert_eq!(
            ids,
            [
                "chat-voice-start",
                "chat-voice-start-visit",
                "chat-voice-discard"
            ]
        );
        assert!(shows(&labels, "Consenti e ascolta la visita"), "{labels:?}");
        let target = cx
            .debug_bounds("control-label:Consenti e ascolta la visita")
            .unwrap();
        cx.simulate_click(target.center(), gpui::Modifiers::default());
        let mut recording = false;
        for _ in 0..1_000 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            recording = cx.update_window_entity(&view, |app, _, cx| {
                app.poll_chat_voice(cx);
                app.chat_access.voice.work.as_ref().unwrap().state == State::Recording
            });
            if recording {
                break;
            }
        }
        assert!(recording);
        let (ids, labels) = voice_page(cx, "chat-voice");
        assert!(shows(&labels, "In registrazione"), "{labels:?}");
        cx.update_window_entity(&view, |app, _, _| {
            assert!(
                app.chat_access
                    .voice
                    .work
                    .as_ref()
                    .unwrap()
                    .session
                    .two_voices()
            );
        });
        assert_eq!(
            ids,
            ["chat-voice-pause", "chat-voice-stop", "chat-voice-discard"]
        );
    }
}
