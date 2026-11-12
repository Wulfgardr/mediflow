//! Due voci nell'ascolto della visita: un'impronta acustica per ogni frase e
//! l'attribuzione a medico o paziente. Tutto locale e senza modelli:
//! coefficienti cepstrali sulla scala mel (MFCC) e altezza della voce, poi
//! due gruppi. È un aiuto alla revisione, non un riconoscimento affidabile
//! della persona: il medico corregge l'attribuzione prima di preparare la
//! bozza.

use super::listening::SAMPLE_RATE;

/// Finestra di 25 ms con passo di 10 ms, trasformata su 512 punti.
const FRAME: usize = 400;
const HOP: usize = 160;
const FFT: usize = 512;
const MEL_BANDS: usize = 26;
const COEFFICIENTS: usize = 12;
/// Altezza della voce cercata fra 60 e 400 Hz, su finestre da 32 ms ogni 30 ms.
const PITCH_FRAME: usize = 512;
const PITCH_FFT: usize = 1024;
const PITCH_EVERY: usize = 3;
const MIN_LAG: usize = SAMPLE_RATE / 400;
const MAX_LAG: usize = SAMPLE_RATE / 60;
/// Finestre con energia sotto 1/1000 della più forte: silenzio o margine.
const QUIET: f32 = 6.9;
/// Sotto questo valore efficace (-60 dBFS) una finestra è silenzio comunque.
const SILENT_RMS: f32 = 1e-3;

/// Medie e dispersioni dei 12 coefficienti, più l'altezza della voce.
pub(crate) const PRINT: usize = 2 * COEFFICIENTS + 1;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct VoicePrint {
    pub(crate) values: [f32; PRINT],
    /// Finestre con voce: pesano la frase nei gruppi.
    pub(crate) frames: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Speaker {
    Doctor,
    Patient,
}

impl Speaker {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Doctor => "Medico",
            Self::Patient => "Paziente",
        }
    }
    pub(crate) fn other(self) -> Self {
        match self {
            Self::Doctor => Self::Patient,
            Self::Patient => Self::Doctor,
        }
    }
}

/// Bozza della visita: una riga per turno, «Medico: …» o «Paziente: …»; le
/// frasi consecutive della stessa persona stanno sulla stessa riga.
pub(crate) fn draft(lines: &[(Speaker, &str)]) -> String {
    let mut out = String::new();
    let mut previous = None;
    for (speaker, text) in lines {
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        if previous == Some(*speaker) {
            out.push(' ');
        } else {
            if previous.is_some() {
                out.push('\n');
            }
            out.push_str(speaker.label());
            out.push_str(": ");
        }
        out.push_str(text);
        previous = Some(*speaker);
    }
    out
}

/// Scambia medico e paziente all'inizio di ogni riga, lasciando com'è il
/// resto del testo, correzioni del medico comprese.
pub(crate) fn swap_speakers(text: &str) -> String {
    text.split('\n')
        .map(|line| {
            for speaker in [Speaker::Doctor, Speaker::Patient] {
                if let Some(rest) = line
                    .strip_prefix(speaker.label())
                    .and_then(|rest| rest.strip_prefix(':'))
                {
                    return format!("{}:{rest}", speaker.other().label());
                }
            }
            line.to_owned()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Trasformata di Fourier in place, radice 2 (lunghezza potenza di due).
fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let angle = -2.0 * std::f32::consts::PI / len as f32;
        let (w_re, w_im) = (angle.cos(), angle.sin());
        for start in (0..n).step_by(len) {
            let (mut c_re, mut c_im) = (1.0f32, 0.0f32);
            for k in 0..len / 2 {
                let (a, b) = (start + k, start + k + len / 2);
                let t_re = re[b] * c_re - im[b] * c_im;
                let t_im = re[b] * c_im + im[b] * c_re;
                re[b] = re[a] - t_re;
                im[b] = im[a] - t_im;
                re[a] += t_re;
                im[a] += t_im;
                (c_re, c_im) = (c_re * w_re - c_im * w_im, c_re * w_im + c_im * w_re);
            }
        }
        len <<= 1;
    }
}

fn hamming(length: usize) -> Vec<f32> {
    (0..length)
        .map(|i| 0.54 - 0.46 * (2.0 * std::f32::consts::PI * i as f32 / (length - 1) as f32).cos())
        .collect()
}

fn mel(hz: f32) -> f32 {
    2595.0 * (1.0 + hz / 700.0).log10()
}

fn hz(mel: f32) -> f32 {
    700.0 * (10f32.powf(mel / 2595.0) - 1.0)
}

/// Filtri triangolari mel fra 80 e 7600 Hz, sui bin della trasformata.
fn mel_filters() -> Vec<Vec<(usize, f32)>> {
    let (low, high) = (mel(80.0), mel(7600.0));
    let points: Vec<f32> = (0..MEL_BANDS + 2)
        .map(|i| hz(low + (high - low) * i as f32 / (MEL_BANDS + 1) as f32))
        .map(|f| f * FFT as f32 / SAMPLE_RATE as f32)
        .collect();
    (0..MEL_BANDS)
        .map(|band| {
            let (left, center, right) = (points[band], points[band + 1], points[band + 2]);
            (left.floor() as usize..=right.ceil() as usize)
                .filter(|&bin| bin <= FFT / 2)
                .filter_map(|bin| {
                    let x = bin as f32;
                    let weight = if x <= center {
                        (x - left) / (center - left)
                    } else {
                        (right - x) / (right - center)
                    };
                    (weight > 0.0).then_some((bin, weight))
                })
                .collect()
        })
        .collect()
}

/// Altezza della voce di una finestra, in Hz, dall'autocorrelazione.
fn pitch(frame: &[f32], window: &[f32]) -> Option<f32> {
    let mut re = vec![0.0; PITCH_FFT];
    let mut im = vec![0.0; PITCH_FFT];
    for (i, (x, w)) in frame.iter().zip(window).enumerate() {
        re[i] = x * w;
    }
    fft(&mut re, &mut im);
    for (r, i) in re.iter_mut().zip(im.iter_mut()) {
        *r = *r * *r + *i * *i;
        *i = 0.0;
    }
    // L'antitrasformata di uno spettro reale e pari è la trasformata diretta
    // divisa per la lunghezza: basta il rapporto con il ritardo zero.
    fft(&mut re, &mut im);
    let energy = re[0];
    if energy <= f32::EPSILON {
        return None;
    }
    let (lag, peak) = (MIN_LAG..=MAX_LAG)
        .map(|lag| (lag, re[lag] / energy))
        .max_by(|a, b| a.1.total_cmp(&b.1))?;
    (peak > 0.3).then(|| SAMPLE_RATE as f32 / lag as f32)
}

/// Impronta di una frase: medie e dispersioni dei coefficienti sulle
/// finestre con voce, più il logaritmo della mediana dell'altezza. Meno di
/// 0,25 s di voce: nessuna impronta.
pub(crate) fn voice_print(audio: &[f32]) -> Option<VoicePrint> {
    if audio.len() < FRAME {
        return None;
    }
    let window = hamming(FRAME);
    let filters = mel_filters();
    let mut emphasized = Vec::with_capacity(audio.len());
    emphasized.push(audio[0]);
    emphasized.extend(audio.windows(2).map(|w| w[1] - 0.97 * w[0]));
    let mut frames: Vec<(f32, bool, [f32; COEFFICIENTS])> = Vec::new();
    let (mut re, mut im) = (vec![0.0; FFT], vec![0.0; FFT]);
    for start in (0..=emphasized.len() - FRAME).step_by(HOP) {
        re.fill(0.0);
        im.fill(0.0);
        for (i, (x, w)) in emphasized[start..start + FRAME]
            .iter()
            .zip(&window)
            .enumerate()
        {
            re[i] = x * w;
        }
        fft(&mut re, &mut im);
        let audible = (audio[start..start + FRAME]
            .iter()
            .map(|x| x * x)
            .sum::<f32>()
            / FRAME as f32)
            .sqrt()
            >= SILENT_RMS;
        let power: Vec<f32> = (0..=FFT / 2)
            .map(|k| re[k] * re[k] + im[k] * im[k])
            .collect();
        let energy = power.iter().sum::<f32>().max(1e-10).ln();
        let bands: Vec<f32> = filters
            .iter()
            .map(|f| {
                f.iter()
                    .map(|&(bin, w)| power[bin] * w)
                    .sum::<f32>()
                    .max(1e-10)
                    .ln()
            })
            .collect();
        let mut cepstrum = [0.0; COEFFICIENTS];
        for (k, c) in cepstrum.iter_mut().enumerate() {
            *c = bands
                .iter()
                .enumerate()
                .map(|(m, b)| {
                    b * (std::f32::consts::PI * (k + 1) as f32 * (m as f32 + 0.5)
                        / MEL_BANDS as f32)
                        .cos()
                })
                .sum();
        }
        frames.push((energy, audible, cepstrum));
    }
    let loudest = frames.iter().map(|f| f.0).fold(f32::MIN, f32::max);
    let voiced: Vec<usize> = (0..frames.len())
        .filter(|&i| frames[i].1 && frames[i].0 >= loudest - QUIET)
        .collect();
    if voiced.len() < 25 {
        return None;
    }
    let mut values = [0.0; PRINT];
    let count = voiced.len() as f32;
    for k in 0..COEFFICIENTS {
        let mean = voiced.iter().map(|&i| frames[i].2[k]).sum::<f32>() / count;
        let variance = voiced
            .iter()
            .map(|&i| (frames[i].2[k] - mean).powi(2))
            .sum::<f32>()
            / count;
        values[k] = mean;
        values[COEFFICIENTS + k] = variance.sqrt();
    }
    let pitch_window = hamming(PITCH_FRAME);
    let mut pitches: Vec<f32> = voiced
        .iter()
        .step_by(PITCH_EVERY)
        .filter_map(|&i| {
            let start = i * HOP;
            audio
                .get(start..start + PITCH_FRAME)
                .and_then(|frame| pitch(frame, &pitch_window))
        })
        .collect();
    pitches.sort_by(f32::total_cmp);
    values[PRINT - 1] = pitches.get(pitches.len() / 2).map_or(0.0, |f0| f0.log2());
    Some(VoicePrint {
        values,
        frames: voiced.len(),
    })
}

/// Peso di ogni dimensione dopo la standardizzazione: le medie dei
/// coefficienti descrivono il timbro, le dispersioni pesano la metà,
/// l'altezza della voce, una sola dimensione, quanto tre.
fn weight(dimension: usize) -> f32 {
    match dimension {
        d if d < COEFFICIENTS => 1.0,
        d if d < 2 * COEFFICIENTS => 0.5,
        _ => 3.0,
    }
}

fn distance(a: &[f32; PRINT], b: &[f32; PRINT]) -> f32 {
    (0..PRINT).map(|d| weight(d) * (a[d] - b[d]).powi(2)).sum()
}

/// Attribuisce ogni frase a medico o paziente. Due gruppi di impronte
/// standardizzate (k-medie pesate dalla durata, partenza dalla coppia più
/// lontana); è medico il gruppo della prima frase con un'impronta, perché la
/// visita la apre il medico. Le frasi senza impronta prendono la voce della
/// frase precedente. Con meno di due impronte tutto resta al medico.
pub(crate) fn attribute(prints: &[Option<VoicePrint>]) -> Vec<Speaker> {
    let valid: Vec<(usize, VoicePrint)> = prints
        .iter()
        .enumerate()
        .filter_map(|(i, p)| p.map(|p| (i, p)))
        .collect();
    if valid.len() < 2 {
        return vec![Speaker::Doctor; prints.len()];
    }
    let total: f32 = valid.iter().map(|(_, p)| p.frames as f32).sum();
    let mut mean = [0.0f32; PRINT];
    let mut spread = [0.0f32; PRINT];
    for d in 0..PRINT {
        mean[d] = valid
            .iter()
            .map(|(_, p)| p.values[d] * p.frames as f32)
            .sum::<f32>()
            / total;
        spread[d] = (valid
            .iter()
            .map(|(_, p)| (p.values[d] - mean[d]).powi(2) * p.frames as f32)
            .sum::<f32>()
            / total)
            .sqrt()
            .max(1e-6);
    }
    let points: Vec<[f32; PRINT]> = valid
        .iter()
        .map(|(_, p)| std::array::from_fn(|d| (p.values[d] - mean[d]) / spread[d]))
        .collect();
    let weights: Vec<f32> = valid.iter().map(|(_, p)| p.frames as f32).collect();
    let (mut a, mut b) = (0, 1);
    let mut farthest = -1.0;
    for i in 0..points.len() {
        for j in i + 1..points.len() {
            let d = distance(&points[i], &points[j]);
            if d > farthest {
                (farthest, a, b) = (d, i, j);
            }
        }
    }
    let mut centroids = [points[a], points[b]];
    let mut groups = vec![0usize; points.len()];
    for _ in 0..50 {
        let next: Vec<usize> = points
            .iter()
            .map(|p| usize::from(distance(p, &centroids[1]) < distance(p, &centroids[0])))
            .collect();
        let settled = next == groups;
        groups = next;
        for (group, centroid) in centroids.iter_mut().enumerate() {
            let members: Vec<usize> = (0..points.len()).filter(|&i| groups[i] == group).collect();
            let sum: f32 = members.iter().map(|&i| weights[i]).sum();
            if sum > 0.0 {
                *centroid = std::array::from_fn(|d| {
                    members
                        .iter()
                        .map(|&i| points[i][d] * weights[i])
                        .sum::<f32>()
                        / sum
                });
            }
        }
        if settled {
            break;
        }
    }
    let doctor = groups[0];
    let mut speakers = Vec::with_capacity(prints.len());
    let mut by_segment = valid.iter().map(|(i, _)| *i).zip(&groups).peekable();
    let mut previous = Speaker::Doctor;
    for index in 0..prints.len() {
        let speaker = match by_segment.peek() {
            Some(&(i, group)) if i == index => {
                by_segment.next();
                if *group == doctor {
                    Speaker::Doctor
                } else {
                    Speaker::Patient
                }
            }
            _ => previous,
        };
        speakers.push(speaker);
        previous = speaker;
    }
    speakers
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Voce sintetica: impulsi glottali a `f0` Hz passati in due risonanze
    /// (formanti) a `f1` e `f2` Hz, con una leggera variazione dell'altezza.
    pub(crate) fn synthetic_voice(seconds: f32, f0: f32, f1: f32, f2: f32, seed: u32) -> Vec<f32> {
        let n = (seconds * SAMPLE_RATE as f32) as usize;
        let mut phase = 0.0f32;
        let mut source = Vec::with_capacity(n);
        for i in 0..n {
            let t = i as f32 / SAMPLE_RATE as f32;
            let vibrato =
                1.0 + 0.03 * (2.0 * std::f32::consts::PI * (3.0 + seed as f32 * 0.1) * t).sin();
            phase += f0 * vibrato / SAMPLE_RATE as f32;
            let pulse = if phase >= 1.0 {
                phase -= 1.0;
                1.0
            } else {
                0.0
            };
            source.push(pulse);
        }
        let mut out = source;
        for formant in [f1, f2] {
            let r = 0.97f32;
            let theta = 2.0 * std::f32::consts::PI * formant / SAMPLE_RATE as f32;
            let (a1, a2) = (2.0 * r * theta.cos(), -r * r);
            let (mut y1, mut y2) = (0.0f32, 0.0f32);
            for x in &mut out {
                let y = *x + a1 * y1 + a2 * y2;
                (y2, y1) = (y1, y);
                *x = y;
            }
        }
        let peak = out.iter().fold(0.0f32, |m, x| m.max(x.abs())).max(1e-6);
        // Ampiezza che cambia lungo la frase, come le sillabe.
        out.iter()
            .enumerate()
            .map(|(i, x)| {
                let syllable = 0.6 + 0.4 * (i as f32 / 2_400.0 + seed as f32).sin().abs();
                0.3 * x / peak * syllable
            })
            .collect()
    }

    #[test]
    fn fft_matches_a_direct_transform() {
        let n = 64;
        let signal: Vec<f32> = (0..n).map(|i| ((i * 7 % 13) as f32 - 6.0) / 6.0).collect();
        let (mut re, mut im) = (signal.clone(), vec![0.0; n]);
        fft(&mut re, &mut im);
        for k in 0..n {
            let (mut dr, mut di) = (0.0f32, 0.0f32);
            for (t, x) in signal.iter().enumerate() {
                let angle = -2.0 * std::f32::consts::PI * (k * t) as f32 / n as f32;
                dr += x * angle.cos();
                di += x * angle.sin();
            }
            assert!(
                (re[k] - dr).abs() < 1e-3 && (im[k] - di).abs() < 1e-3,
                "bin {k}"
            );
        }
    }

    #[test]
    fn pitch_of_a_pulse_train_is_found() {
        for f0 in [100.0, 150.0, 220.0] {
            let audio = synthetic_voice(1.0, f0, 700.0, 1_200.0, 1);
            let print = voice_print(&audio).unwrap();
            let found = 2f32.powf(print.values[PRINT - 1]);
            assert!(
                (found / f0 - 1.0).abs() < 0.06,
                "{f0} Hz read as {found} Hz"
            );
        }
    }

    #[test]
    fn silence_and_short_noise_have_no_print() {
        assert!(voice_print(&[0.0; 16_000]).is_none());
        assert!(voice_print(&[0.1; 100]).is_none());
    }

    /// Visita sintetica: due voci che si alternano con frasi di lunghezza
    /// diversa. Il medico apre; ogni frase va alla persona giusta.
    #[test]
    fn two_alternating_voices_are_told_apart_and_the_opener_is_the_doctor() {
        let doctor = |seconds, seed| synthetic_voice(seconds, 115.0, 600.0, 1_100.0, seed);
        let patient = |seconds, seed| synthetic_voice(seconds, 210.0, 850.0, 1_900.0, seed);
        let mut prints = Vec::new();
        let mut truth = Vec::new();
        for turn in 0..12u32 {
            let seconds = 0.8 + (turn % 4) as f32 * 0.7;
            let (audio, speaker) = if turn % 2 == 0 {
                (doctor(seconds, turn), Speaker::Doctor)
            } else {
                (patient(seconds, turn), Speaker::Patient)
            };
            prints.push(voice_print(&audio));
            truth.push(speaker);
        }
        // Una frase senza impronta segue la voce precedente.
        prints.insert(3, None);
        truth.insert(3, truth[2]);
        assert_eq!(attribute(&prints), truth);
    }

    #[test]
    fn one_or_no_print_leaves_everything_to_the_doctor() {
        let one = voice_print(&synthetic_voice(1.0, 120.0, 600.0, 1_100.0, 0));
        assert_eq!(attribute(&[None, one, None]), [Speaker::Doctor; 3]);
        assert!(attribute(&[]).is_empty());
    }

    #[test]
    fn the_draft_has_one_line_per_turn_and_the_swap_keeps_edits() {
        use Speaker::*;
        let lines = [
            (Doctor, "Buongiorno."),
            (Doctor, "Come va?"),
            (Patient, "Bene, ma ho le caviglie gonfie."),
            (Doctor, " "),
            (Doctor, "Prende il Ramipril?"),
            (Patient, "Sì."),
        ];
        let text = draft(&lines);
        assert_eq!(
            text,
            "Medico: Buongiorno. Come va?\nPaziente: Bene, ma ho le caviglie gonfie.\nMedico: Prende il Ramipril?\nPaziente: Sì."
        );
        // Il medico ha corretto una parola e aggiunto una riga sua.
        let edited = text.replace("gonfie", "gonfie la sera") + "\nNota: controllo tra un mese.";
        let swapped = swap_speakers(&edited);
        assert_eq!(
            swapped,
            "Paziente: Buongiorno. Come va?\nMedico: Bene, ma ho le caviglie gonfie la sera.\nPaziente: Prende il Ramipril?\nMedico: Sì.\nNota: controllo tra un mese."
        );
        assert_eq!(swap_speakers(&swapped), edited);
        // Solo l'etichetta a inizio riga: le stesse parole nel testo restano.
        assert_eq!(
            swap_speakers("Medico: il paziente: stabile"),
            "Paziente: il paziente: stabile"
        );
        assert!(draft(&[]).is_empty());
    }

    #[test]
    fn labels_and_swap() {
        assert_eq!(Speaker::Doctor.label(), "Medico");
        assert_eq!(Speaker::Patient.label(), "Paziente");
        assert_eq!(Speaker::Doctor.other(), Speaker::Patient);
        assert_eq!(Speaker::Patient.other(), Speaker::Doctor);
    }
}
