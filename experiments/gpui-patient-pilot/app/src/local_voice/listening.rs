//! Ciclo di ascolto della dettatura locale: blocchi da 0,5 s, frasi aperte e
//! chiuse dal rilevatore di voce, parziale ridecodificando la frase in corso,
//! definitivo alla chiusura. Il modello e il rilevatore stanno dietro due
//! interfacce, così i test girano senza file di modello.
//!
//! L'audio vive solo in buffer preallocati e azzerati: nessuna scrittura su
//! disco, nessuna riallocazione che lascerebbe copie in memoria.

use zeroize::{Zeroize, Zeroizing};

pub(crate) const SAMPLE_RATE: usize = 16_000;
/// Un blocco di cattura: 0,5 s a 16 kHz.
pub(crate) const BLOCK: usize = SAMPLE_RATE / 2;
/// Finestra del rilevatore Silero a 16 kHz.
pub(crate) const FRAME: usize = 512;
/// Il rilevatore riparte da zero a ogni chiamata: gli si ripassa circa 1 s di
/// audio precedente perché le probabilità dei campioni nuovi abbiano contesto.
const CONTEXT_FRAMES: usize = 31;
const THRESHOLD: f32 = 0.5;
const NEG_THRESHOLD: f32 = 0.35;
/// 0,5 s di silenzio chiudono la frase (come il VAD del banco).
const MIN_SILENCE_FRAMES: usize = 16;
/// Meno di 0,25 s di voce in tutta la frase: rumore, non si decodifica.
const MIN_SPEECH_FRAMES: usize = 8;
/// 0,2 s prima e dopo il parlato, come nel banco.
const PAD: usize = SAMPLE_RATE / 5;
/// Durata massima di una frase: oltre si chiude e se ne apre un'altra.
pub(crate) const MAX_UTTERANCE: usize = 20 * SAMPLE_RATE;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct EngineFailure;

/// Probabilità di voce per ogni finestra da `FRAME` campioni.
pub(crate) trait SpeechDetector {
    fn probabilities(&mut self, samples: &[f32]) -> Result<Vec<f32>, EngineFailure>;
}

/// Trascrizione di una frase intera.
pub(crate) trait Decoder {
    fn decode(&mut self, audio: &[f32]) -> Result<Zeroizing<String>, EngineFailure>;
}

struct Utterance {
    audio: Zeroizing<Vec<f32>>,
    start: usize,
    speech_frames: usize,
    silence_frames: usize,
    speech_end: usize,
}

/// Rilevatore di frasi: riceve blocchi e restituisce le frasi chiuse.
pub(crate) struct Listener<V> {
    detector: V,
    pending: Zeroizing<Vec<f32>>,
    history: Zeroizing<Vec<f32>>,
    utterance: Option<Utterance>,
    consumed: usize,
}

/// Frase chiusa: audio e posizione nella dettatura, in campioni.
pub(crate) struct Closed {
    pub(crate) audio: Zeroizing<Vec<f32>>,
    pub(crate) start: usize,
    pub(crate) end: usize,
}

fn keep_tail(buffer: &mut Vec<f32>, keep: usize) {
    let len = buffer.len();
    if len > keep {
        buffer.copy_within(len - keep.., 0);
        buffer[keep..].fill(0.0);
        buffer.truncate(keep);
    }
}

impl<V: SpeechDetector> Listener<V> {
    pub(crate) fn new(detector: V) -> Self {
        Self {
            detector,
            pending: Zeroizing::new(Vec::with_capacity(BLOCK + FRAME)),
            history: Zeroizing::new(Vec::with_capacity((CONTEXT_FRAMES + 1) * FRAME + BLOCK)),
            utterance: None,
            consumed: 0,
        }
    }

    /// Accoda un blocco e restituisce le frasi che il rilevatore ha chiuso.
    pub(crate) fn push(&mut self, block: &[f32]) -> Result<Vec<Closed>, EngineFailure> {
        let mut closed = Vec::new();
        for chunk in block.chunks(BLOCK) {
            self.pending.extend_from_slice(chunk);
            let frames = self.pending.len() / FRAME;
            if frames == 0 {
                continue;
            }
            let context = (self.history.len() / FRAME).min(CONTEXT_FRAMES) * FRAME;
            let mut input = Zeroizing::new(Vec::with_capacity(context + frames * FRAME));
            input.extend_from_slice(&self.history[self.history.len() - context..]);
            input.extend_from_slice(&self.pending[..frames * FRAME]);
            let probabilities = self.detector.probabilities(&input)?;
            let total = input.len() / FRAME;
            if probabilities.len() < total {
                return Err(EngineFailure);
            }
            for (index, probability) in probabilities[total - frames..total].iter().enumerate() {
                let start = context + index * FRAME;
                let frame = &input[start..start + FRAME];
                if let Some(audio) = self.frame(frame, *probability) {
                    closed.push(audio);
                }
                self.history.extend_from_slice(frame);
                self.consumed += FRAME;
                keep_tail(&mut self.history, (CONTEXT_FRAMES + 1) * FRAME);
            }
            let used = frames * FRAME;
            self.pending.copy_within(used.., 0);
            let rest = self.pending.len() - used;
            self.pending[rest..].fill(0.0);
            self.pending.truncate(rest);
        }
        Ok(closed)
    }

    fn frame(&mut self, frame: &[f32], probability: f32) -> Option<Closed> {
        let Some(utterance) = self.utterance.as_mut() else {
            if probability >= THRESHOLD {
                let mut audio = Zeroizing::new(Vec::with_capacity(MAX_UTTERANCE + FRAME));
                let pad = PAD.min(self.history.len());
                audio.extend_from_slice(&self.history[self.history.len() - pad..]);
                audio.extend_from_slice(frame);
                let speech_end = audio.len();
                self.utterance = Some(Utterance {
                    audio,
                    start: self.consumed - pad,
                    speech_frames: 1,
                    silence_frames: 0,
                    speech_end,
                });
            }
            return None;
        };
        utterance.audio.extend_from_slice(frame);
        if probability >= THRESHOLD {
            utterance.speech_frames += 1;
            utterance.silence_frames = 0;
            utterance.speech_end = utterance.audio.len();
        } else if probability < NEG_THRESHOLD {
            utterance.silence_frames += 1;
        }
        if utterance.silence_frames >= MIN_SILENCE_FRAMES {
            let cut = (utterance.speech_end + PAD).min(utterance.audio.len());
            return self.close(cut);
        }
        if utterance.audio.len() + FRAME > MAX_UTTERANCE {
            let cut = utterance.audio.len();
            return self.close(cut);
        }
        None
    }

    fn close(&mut self, cut: usize) -> Option<Closed> {
        let mut utterance = self.utterance.take()?;
        let result = (utterance.speech_frames >= MIN_SPEECH_FRAMES).then(|| {
            let mut audio = Zeroizing::new(Vec::with_capacity(cut));
            audio.extend_from_slice(&utterance.audio[..cut]);
            Closed {
                audio,
                start: utterance.start,
                end: utterance.start + cut,
            }
        });
        utterance.audio.zeroize();
        result
    }

    /// Audio della frase in corso, se contiene abbastanza voce da decodificare.
    /// Campioni passati dal rilevatore dall'inizio della dettatura.
    pub(crate) fn consumed(&self) -> usize {
        self.consumed
    }

    pub(crate) fn open_audio(&self) -> Option<&[f32]> {
        self.utterance
            .as_ref()
            .filter(|u| u.speech_frames >= MIN_SPEECH_FRAMES)
            .map(|u| &u.audio[..])
    }

    /// Chiude la frase in corso alla fine della dettatura.
    pub(crate) fn finish(&mut self) -> Option<Closed> {
        let cut = self
            .utterance
            .as_ref()
            .map(|u| (u.speech_end + PAD).min(u.audio.len()))?;
        let closed = self.close(cut);
        self.wipe();
        closed
    }

    /// Azzera ogni campione trattenuto.
    pub(crate) fn wipe(&mut self) {
        if let Some(mut utterance) = self.utterance.take() {
            utterance.audio.zeroize();
        }
        self.pending.zeroize();
        self.history.zeroize();
    }

    /// Campioni ancora in memoria (frase aperta, contesto e resto).
    #[cfg(test)]
    pub(crate) fn retained_samples(&self) -> usize {
        self.pending.len()
            + self.history.len()
            + self.utterance.as_ref().map_or(0, |u| u.audio.len())
    }
}

fn words(text: &str) -> Vec<&str> {
    text.split_whitespace().collect()
}

/// Due parole coincidono se restano uguali senza maiuscole e punteggiatura:
/// whisper aggiunge un punto alla fine di un parziale corto.
fn same_word(a: &str, b: &str) -> bool {
    let clean = |w: &str| {
        w.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect::<String>()
    };
    let (a, b) = (clean(a), clean(b));
    !a.is_empty() && a == b
}

/// Regola dell'accordo locale: della frase in corso si mostra solo il prefisso
/// di parole che due parziali consecutivi confermano. Il prefisso confermato
/// non arretra; il definitivo lo sostituisce alla chiusura della frase.
#[derive(Default)]
pub(crate) struct Agreement {
    previous: Zeroizing<String>,
    stable: Zeroizing<String>,
}

impl Agreement {
    pub(crate) fn observe(&mut self, partial: &str) {
        let previous = words(&self.previous);
        let current = words(partial);
        let stable = words(&self.stable);
        let common = previous
            .iter()
            .zip(&current)
            .take_while(|(a, b)| same_word(a, b))
            .count();
        let extends = stable.len() <= current.len()
            && stable.iter().zip(&current).all(|(a, b)| same_word(a, b));
        if common > stable.len() && extends {
            // Le parole già mostrate restano come sono; si aggiungono le nuove.
            let mut next: Vec<&str> = stable.clone();
            next.extend_from_slice(&previous[stable.len()..common]);
            let next = Zeroizing::new(next.join(" "));
            self.stable = next;
        }
        self.previous = Zeroizing::new(partial.to_owned());
    }
    pub(crate) fn stable(&self) -> &str {
        &self.stable
    }
    pub(crate) fn reset(&mut self) {
        self.previous.zeroize();
        self.stable.zeroize();
    }
}

/// Dettatura completa: frasi definitive accumulate e testo stabile da mostrare.
pub(crate) struct Dictation<V, D> {
    listener: Listener<V>,
    decoder: D,
    finals: Zeroizing<String>,
    finals_count: usize,
    agreement: Agreement,
    /// Ultimo istante della griglia da 0,5 s in cui si è decodificato un parziale.
    partial_tick: usize,
    /// Per le prove: inizio, fine (in campioni) e parole di ogni definitivo.
    #[cfg(test)]
    pub(crate) windows: Vec<(usize, usize, usize)>,
}

impl<V: SpeechDetector, D: Decoder> Dictation<V, D> {
    pub(crate) fn new(detector: V, decoder: D) -> Self {
        Self {
            listener: Listener::new(detector),
            decoder,
            finals: Zeroizing::new(String::new()),
            finals_count: 0,
            agreement: Agreement::default(),
            partial_tick: 0,
            #[cfg(test)]
            windows: Vec::new(),
        }
    }

    fn append_final(&mut self, closed: Closed) -> Result<(), EngineFailure> {
        self.agreement.reset();
        let text = self.decoder.decode(&closed.audio)?;
        let text = text.trim();
        self.finals_count += 1;
        #[cfg(test)]
        self.windows
            .push((closed.start, closed.end, text.split_whitespace().count()));
        #[cfg(not(test))]
        let _ = (closed.start, closed.end);
        if !text.is_empty() {
            if !self.finals.is_empty() {
                self.finals.push(' ');
            }
            self.finals.push_str(text);
        }
        Ok(())
    }

    /// Elabora i campioni arrivati, di qualunque lunghezza. Il rilevatore li
    /// guarda tutti, finestra per finestra, e una frase chiusa diventa subito
    /// definitiva. La frase aperta si ridecodifica sulla griglia da 0,5 s: un
    /// solo parziale, sull'audio più recente (i parziali vecchi si saltano).
    pub(crate) fn feed(&mut self, samples: &[f32]) -> Result<(), EngineFailure> {
        for audio in self.listener.push(samples)? {
            self.append_final(audio)?;
        }
        let tick = self.listener.consumed() / BLOCK;
        if tick == self.partial_tick {
            return Ok(());
        }
        self.partial_tick = tick;
        if let Some(audio) = self.listener.open_audio() {
            let partial = self.decoder.decode(audio)?;
            self.agreement.observe(&partial);
        }
        Ok(())
    }

    /// Fine della dettatura: l'ultima frase diventa definitiva.
    pub(crate) fn finish(&mut self) -> Result<(), EngineFailure> {
        let closed = self.listener.finish();
        let result = closed.map_or(Ok(()), |audio| self.append_final(audio));
        self.agreement.reset();
        result
    }

    /// Testo da mostrare in grigio mentre si parla: frasi definitive più il
    /// prefisso confermato della frase in corso. Non si trasferisce.
    pub(crate) fn stable_text(&self) -> Zeroizing<String> {
        let mut text = Zeroizing::new(self.finals.as_str().to_owned());
        let stable = self.agreement.stable();
        if !stable.is_empty() {
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(stable);
        }
        text
    }

    /// Testo definitivo, da consegnare solo allo stato Review.
    pub(crate) fn transcript(&self) -> &str {
        &self.finals
    }

    pub(crate) fn wipe(&mut self) {
        self.listener.wipe();
        self.agreement.reset();
        self.finals.zeroize();
    }

    #[cfg(test)]
    pub(crate) fn retained_samples(&self) -> usize {
        self.listener.retained_samples()
    }

    /// Frasi definitive prodotte finora.
    pub(crate) fn finals_count(&self) -> usize {
        self.finals_count
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Rilevatore finto: voce dove l'ampiezza della finestra supera 0,05.
    pub(crate) struct LoudnessDetector;
    impl SpeechDetector for LoudnessDetector {
        fn probabilities(&mut self, samples: &[f32]) -> Result<Vec<f32>, EngineFailure> {
            Ok(samples
                .chunks(FRAME)
                .map(|f| {
                    if f.iter().any(|x| x.abs() > 0.05) {
                        0.9
                    } else {
                        0.05
                    }
                })
                .collect())
        }
    }

    /// Decodificatore finto: una parola per ogni 0,5 s di audio, numerata;
    /// il parziale cambia l'ultima parola come fa whisper.
    #[derive(Clone, Default)]
    pub(crate) struct CountingDecoder {
        pub(crate) calls: Arc<Mutex<Vec<usize>>>,
    }
    impl Decoder for CountingDecoder {
        fn decode(&mut self, audio: &[f32]) -> Result<Zeroizing<String>, EngineFailure> {
            self.calls.lock().unwrap().push(audio.len());
            let count = audio.len() / BLOCK;
            let mut text: Vec<String> = (1..=count).map(|n| format!("parola{n}")).collect();
            if !audio.len().is_multiple_of(BLOCK) {
                text.push(format!("incerta{}", audio.len() % 7));
            }
            Ok(Zeroizing::new(text.join(" ")))
        }
    }

    pub(crate) fn tone(seconds: f32) -> Vec<f32> {
        (0..(seconds * SAMPLE_RATE as f32) as usize)
            .map(|i| 0.3 * (i as f32 * 0.07).sin().signum())
            .collect()
    }
    pub(crate) fn silence(seconds: f32) -> Vec<f32> {
        vec![0.0; (seconds * SAMPLE_RATE as f32) as usize]
    }

    fn run(
        audio: &[f32],
    ) -> (
        Dictation<LoudnessDetector, CountingDecoder>,
        Vec<String>,
        CountingDecoder,
    ) {
        let decoder = CountingDecoder::default();
        let mut dictation = Dictation::new(LoudnessDetector, decoder.clone());
        let mut shown = Vec::new();
        for block in audio.chunks(BLOCK) {
            dictation.feed(block).unwrap();
            shown.push(dictation.stable_text().to_string());
        }
        (dictation, shown, decoder)
    }

    #[test]
    fn utterances_open_and_close_on_voice_and_become_final() {
        let mut audio = silence(1.0);
        audio.extend(tone(2.0));
        audio.extend(silence(1.5));
        audio.extend(tone(1.0));
        audio.extend(silence(1.5));
        let (dictation, _, decoder) = run(&audio);
        // Two utterances: each closed with 0,2 s of padding on both sides.
        let finals: Vec<usize> = decoder
            .calls
            .lock()
            .unwrap()
            .iter()
            .copied()
            .filter(|n| *n > SAMPLE_RATE * 2 + PAD && *n <= SAMPLE_RATE * 2 + 2 * PAD + FRAME)
            .collect();
        assert_eq!(finals.len(), 1, "first utterance final");
        let text = dictation.transcript();
        assert_eq!(text.matches("parola").count(), 4 + 2, "{text}");
    }

    #[test]
    fn long_silence_never_reaches_the_decoder() {
        let audio = silence(600.0);
        let (dictation, shown, decoder) = run(&audio);
        assert!(decoder.calls.lock().unwrap().is_empty());
        assert!(dictation.transcript().is_empty());
        assert!(shown.iter().all(String::is_empty));
        // Only the VAD context stays in memory, never the whole session.
        assert!(dictation.retained_samples() <= (CONTEXT_FRAMES + 1) * FRAME + FRAME);
    }

    #[test]
    fn short_noise_bursts_are_not_decoded() {
        let mut audio = Vec::new();
        for _ in 0..20 {
            audio.extend(silence(2.0));
            audio.extend(tone(0.1));
        }
        let (dictation, _, decoder) = run(&audio);
        assert!(decoder.calls.lock().unwrap().is_empty());
        assert!(dictation.transcript().is_empty());
    }

    #[test]
    fn shown_text_grows_only_with_words_two_partials_agree_on() {
        let mut audio = silence(0.5);
        audio.extend(tone(4.0));
        let (_, shown, _) = run(&audio);
        for window in shown.windows(2) {
            assert!(
                window[1].starts_with(window[0].as_str()),
                "shown text went back: {window:?}"
            );
        }
        let last = shown.last().unwrap();
        assert!(!last.is_empty());
        assert!(!last.contains("incerta"), "unconfirmed word shown: {last}");
    }

    #[test]
    fn agreement_keeps_only_the_confirmed_prefix() {
        let mut agreement = Agreement::default();
        agreement.observe("prosegue rami");
        assert_eq!(agreement.stable(), "");
        agreement.observe("prosegue ramipril 5");
        assert_eq!(agreement.stable(), "prosegue");
        agreement.observe("prosegue ramipril 5 mg");
        assert_eq!(agreement.stable(), "prosegue ramipril 5");
        agreement.observe("prosegue Ramipril cinque");
        assert_eq!(agreement.stable(), "prosegue ramipril 5", "never goes back");
        agreement.reset();
        agreement.observe("Visita.");
        agreement.observe("visita di controllo");
        assert_eq!(
            agreement.stable(),
            "Visita.",
            "punctuation and case ignored"
        );
        agreement.observe("Visita di controllo del");
        assert_eq!(agreement.stable(), "Visita. di controllo");
        agreement.reset();
        assert_eq!(agreement.stable(), "");
    }

    #[test]
    fn closed_utterances_and_finish_leave_no_audio_behind() {
        let mut audio = tone(1.5);
        audio.extend(silence(1.0));
        let (mut dictation, _, _) = run(&audio);
        assert!(
            dictation.listener.utterance.is_none(),
            "closed utterance kept"
        );
        dictation.feed(&tone(1.0)).unwrap();
        assert!(dictation.listener.utterance.is_some());
        dictation.finish().unwrap();
        assert_eq!(dictation.retained_samples(), 0);
        assert_eq!(dictation.stable_text().as_str(), dictation.transcript());
    }

    #[test]
    fn cancellation_wipes_audio_and_text() {
        let mut audio = tone(1.5);
        audio.extend(silence(1.0));
        audio.extend(tone(1.0));
        let (mut dictation, _, _) = run(&audio);
        assert!(!dictation.transcript().is_empty());
        dictation.wipe();
        assert_eq!(dictation.retained_samples(), 0);
        assert!(dictation.transcript().is_empty());
        assert!(dictation.stable_text().is_empty());
    }

    #[test]
    fn utterances_longer_than_the_limit_are_split() {
        let (dictation, _, decoder) = run(&tone(45.0));
        let calls = decoder.calls.lock().unwrap();
        assert!(calls.iter().all(|n| *n <= MAX_UTTERANCE));
        assert!(dictation.transcript().matches("parola").count() >= 70);
    }

    #[test]
    fn many_blocks_at_once_decode_a_single_partial() {
        let decoder = CountingDecoder::default();
        let mut dictation = Dictation::new(LoudnessDetector, decoder.clone());
        dictation.feed(&tone(3.0)).unwrap();
        assert_eq!(decoder.calls.lock().unwrap().len(), 1);
    }

    #[test]
    fn small_capture_chunks_close_utterances_without_waiting_for_a_block() {
        // Il microfono consegna circa 85 ms alla volta: il rilevatore chiude la
        // frase appena vede 0,5 s di silenzio, i parziali restano a 0,5 s.
        let mut audio = tone(2.0);
        audio.extend(silence(0.6));
        let decoder = CountingDecoder::default();
        let mut dictation = Dictation::new(LoudnessDetector, decoder.clone());
        let mut closed_at = None;
        for (index, chunk) in audio.chunks(1_365).enumerate() {
            dictation.feed(chunk).unwrap();
            if closed_at.is_none() && dictation.finals_count() == 1 {
                closed_at = Some((index + 1) * 1_365);
            }
        }
        let closed_at = closed_at.expect("utterance closed") as f32 / SAMPLE_RATE as f32;
        assert!(closed_at < 2.0 + 0.62, "closed at {closed_at} s");
        let partials = decoder.calls.lock().unwrap().len() - 1;
        assert!(
            partials <= 4,
            "{partials} partial decodes for 2 s of speech"
        );
    }
}
