use super::*;
use crate::chat_access::owner::{Pending, State as RequestState};
use crate::local_voice::{Session, State, reviewed_text};

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
        Self {
            work: None,
            editor: cx.new(|cx| {
                TextInput::new(
                    "chat-voice-review",
                    "Trascrizione da rivedere",
                    "",
                    true,
                    theme,
                    cx,
                )
            }),
        }
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
            let state = session.state();
            self.chat_access.voice.work = Some(Work {
                binding,
                pending: pending.clone(),
                session,
                state,
                live: Default::default(),
            });
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
        if state != work.state {
            work.state = state;
            if state == State::Review {
                if let Some(text) = work.session.transcript() {
                    self.chat_access
                        .voice
                        .editor
                        .update(cx, |input, cx| input.set_content(text.as_str(), cx));
                } else {
                    work.state = State::Unavailable;
                }
            }
            cx.notify();
        }
        self.chat_access.voice.editor.update(cx, |input, cx| {
            input.configure(self.theme, work.state != State::Review, cx)
        });
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
                    "Dettatura locale",
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
                .child(notice(
                    "chat-local-voice-state",
                    work.session.message(work.state),
                    self.theme,
                    matches!(work.state, State::PermissionDenied | State::Unavailable),
                ))
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
                .when(work.state == State::Disclosure, |el| {
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
                })
                .when(work.state == State::Recording, |el| {
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
                .when(work.state == State::Review, |el| {
                    el.child(self.chat_access.voice.editor.clone()).child(
                        button(
                            "chat-voice-transfer",
                            "Ho rivisto il testo: prepara la bozza",
                            self.theme,
                            true,
                            true,
                        )
                        .on_click(
                            cx.listener(|this, _, window, cx| this.transfer_chat_voice(window, cx)),
                        ),
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
                app.chat_access.voice.work = Some(Work { binding, pending: pending.clone(), session: Session::synthetic(state, TEXT), state, live: Default::default() });
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
            let state = session.state();
            assert_eq!(state, State::Disclosure);
            session.start();
            app.chat_access.voice.work = Some(Work { binding, pending: pending.clone(), session, state, live: Default::default() });
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
            let state = session.state();
            app.chat_access.voice.work = Some(Work { binding, pending, session, state, live: Default::default() });
        });
        (view, cx, remote)
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
}
