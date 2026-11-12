// Prova locale dell'ascolto della visita (WUL-828 punto 3) con il modello whisper vero:
// una visita inventata di oltre dieci minuti a due voci (scripts/fixtures/visita-due-voci.json),
// generata con `say` del Mac, nessun microfono e nessuno scaricamento. Il test Rust
// `real_model_long_session_in_segments` la ascolta a blocchi come farebbe il microfono; qui si
// controlla che medico e paziente siano attribuiti, si misura l'errore di parola e si verifica
// che il calcolo stia al passo con il tempo reale. Il rapporto va in rapporto.json.
// Uso: node scripts/prove-ascolto-visita.mjs <ggml-large-v3-turbo-q5_0.bin> <ggml-silero-v6.2.0.bin>
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_RATE = 16_000;
export const VOICES = { M: 'Eddy (Italian (Italy))', P: 'Grandma (Italian (Italy))' };
export const TURNS = JSON.parse(readFileSync(new URL('./fixtures/visita-due-voci.json', import.meta.url), 'utf8'));
/**
 * Soglie della prova: almeno dieci minuti di visita, attribuzione corretta su almeno l'80% del
 * parlato, calcolo più veloce del tempo reale. L'errore di parola si scrive nel rapporto; la soglia
 * del 20% ferma solo una trascrizione inservibile (misure del 12/11: 5,6-12,5%).
 */
export const MIN_SECONDS = 600;
export const MIN_ATTRIBUTION = 0.8;
export const MAX_RTF = 1;
export const MAX_WER = 0.2;

// Normalizzazione del banco voce (mf-voce-banco/script/normalizza.py, regole 1-4) ridotta a
// quello che il dialogo usa: minuscole, unità in forma breve, numeri in cifre, virgola decimale.
const UNITS = [
  [/mill?igramm[oi]/u, 'mg'], [/chilogramm[oi]|chili/u, 'kg'], [/grammo|grammi/u, 'g'],
  [/mill?ilitr[oi]/u, 'ml'], [/litr[oi]/u, 'l'], [/per ?cento/u, 'percento'],
].map(([rx, short]) => [new RegExp(`(?<![\\p{L}\\d])(?:${rx.source})(?![\\p{L}\\d])`, 'gu'), short]);
const NUMBER = {
  zero: 0, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
  undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17,
  diciotto: 18, diciannove: 19, venti: 20, trenta: 30, quaranta: 40, cinquanta: 50, sessanta: 60,
  settanta: 70, ottanta: 80, novanta: 90, vent: 20, trent: 30, quarant: 40, cinquant: 50, sessant: 60,
  settant: 70, ottant: 80, novant: 90, cento: 'C', cent: 'C', mille: 'M', mila: 'M',
};
const MORPHEMES = Object.keys(NUMBER).sort((a, b) => b.length - a.length);

/** Parola numerica italiana in intero ("centoventicinque" -> 125), altrimenti undefined. */
export function numberWord(word) {
  if (word === 'un' || word === 'una') return 1;
  const split = at => {
    if (at === word.length) return [];
    for (const m of MORPHEMES) {
      if (!word.startsWith(m, at)) continue;
      const rest = split(at + m.length);
      if (rest) return [NUMBER[m], ...rest];
    }
    return undefined;
  };
  const parts = split(0);
  if (!parts?.length) return undefined;
  let total = 0, current = 0;
  for (const p of parts) {
    if (p === 'C') current = Math.max(current, 1) * 100;
    else if (p === 'M') { total += Math.max(current, 1) * 1000; current = 0; }
    else current += p;
  }
  return total + current;
}

export function normalizeWords(text) {
  let t = text.normalize('NFC').toLowerCase();
  t = t.replace(/(\d)[.,](\d)/gu, '$1 virgola $2').replaceAll('%', ' percento ');
  for (const [rx, short] of UNITS) t = t.replace(rx, ` ${short} `);
  t = t.replace(/[’'`´\-–—_]/gu, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return t.split(/\s+/u).filter(Boolean).map(w => String(numberWord(w) ?? w));
}

/** Errore di parola: distanza di Levenshtein fra le parole normalizzate, sul numero di parole di riferimento. */
export function wordErrorRate(reference, hypothesis) {
  const r = normalizeWords(reference), h = normalizeWords(hypothesis);
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] !== h[j - 1])));
    prev = cur;
  }
  return r.length ? prev[h.length] / r.length : 0;
}

/** Campioni PCM a 16 bit di un WAV mono a 16 kHz. */
export function readWav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('non è un WAV');
  let at = 12;
  let format;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === 'fmt ') format = [bytes.readUInt16LE(at + 8), bytes.readUInt32LE(at + 12), bytes.readUInt16LE(at + 22)];
    if (id === 'data') {
      if (format?.join() !== `1,${SAMPLE_RATE},16`) throw new Error('serve un WAV PCM 16 kHz mono 16 bit');
      return new Int16Array(bytes.buffer.slice(bytes.byteOffset + at + 8, bytes.byteOffset + at + 8 + size));
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('WAV senza dati');
}

export function writeWav(samples) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + samples.length * 2, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(samples.length * 2, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, samples.length * 2)]);
}

/** Visita: un secondo di silenzio, battute separate da 0,8 s. Restituisce audio e linea del tempo. */
export function assemble(clips) {
  const pause = new Int16Array(Math.round(0.8 * SAMPLE_RATE));
  const parts = [new Int16Array(SAMPLE_RATE)];
  const timeline = [];
  let t = 1;
  for (const { role, samples } of clips) {
    timeline.push({ role, start: t, end: t + samples.length / SAMPLE_RATE });
    parts.push(samples, pause);
    t += (samples.length + pause.length) / SAMPLE_RATE;
  }
  const audio = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { audio.set(p, offset); offset += p.length; }
  return { audio, timeline };
}

/**
 * Quota del parlato di riferimento attribuita alla persona giusta. Il denominatore è tutto
 * il parlato delle battute: le parti che il riconoscitore perde contano come sbagliate, e
 * frasi sovrapposte sulla stessa battuta non contano due volte.
 */
export function attributionScore(segments, timeline) {
  let right = 0, total = 0;
  for (const turn of timeline) {
    total += turn.end - turn.start;
    const covered = segments
      .filter(([, , , speaker]) => (speaker === 'Medico' ? 'M' : speaker === 'Paziente' ? 'P' : undefined) === turn.role)
      .map(([start, end]) => [Math.max(start, turn.start), Math.min(end, turn.end)])
      .filter(([start, end]) => end > start)
      .sort((a, b) => a[0] - b[0]);
    let reached = turn.start;
    for (const [start, end] of covered) {
      if (end > reached) { right += end - Math.max(start, reached); reached = end; }
    }
  }
  return total > 0 ? right / total : 0;
}

function run(command, args, env, cwd) {
  const result = spawnSync(command, args, { env, cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} uscita ${result.status}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

export function cargoPath(home = userInfo().homedir) {
  return path.join(home, '.cargo', 'bin', 'cargo');
}

export async function main([whisper, vad] = process.argv.slice(2)) {
  if (!whisper || !vad) throw new Error('servono i file del modello whisper e del rilevatore Silero');
  const home = userInfo().homedir;
  const work = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'ascolto-visita-'));
  const clips = TURNS.map(([role, text], index) => {
    const aiff = path.join(work, `${index}.aiff`);
    const wav = path.join(work, `${index}.wav`);
    run('/usr/bin/say', ['-v', VOICES[role], '-r', '175', '-o', aiff, text], process.env);
    run('/usr/bin/afconvert', ['-f', 'WAVE', '-d', `LEI16@${SAMPLE_RATE}`, '-c', '1', aiff, wav], process.env);
    return { role, samples: readWav(readFileSync(wav)) };
  });
  const { audio, timeline } = assemble(clips);
  const visit = path.join(work, 'visita.wav');
  writeFileSync(visit, writeWav(audio));
  const out = path.join(work, 'risultato.json');
  const env = {
    ...process.env, RUSTUP_HOME: path.join(home, '.rustup'), CARGO_HOME: path.join(home, '.cargo'),
    MEDIFLOW_VOCE_WHISPER: whisper, MEDIFLOW_VOCE_VAD: vad, MEDIFLOW_VOCE_FILES: visit,
    MEDIFLOW_VOCE_OUT: out, MEDIFLOW_VOCE_DUE: '1',
  };
  // La cartella del progetto Rust fissa la versione del compilatore (rust-toolchain.toml).
  const pilot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'experiments', 'gpui-patient-pilot');
  run(cargoPath(home), ['test', '-p', 'mediflow-gpui-patient-pilot', '--locked', '--',
    '--ignored', '--exact', 'local_voice::whisper::tests::real_model_long_session_in_segments'], env, pilot);
  const result = JSON.parse(readFileSync(out, 'utf8'));
  const report = measure(result, timeline);
  writeFileSync(path.join(work, 'rapporto.json'), JSON.stringify(report, null, 1));
  console.log(`audio ${report.audio_s.toFixed(0)} s, calcolo ${report.calcolo_s.toFixed(0)} s (RTF ${report.rtf.toFixed(2)}), ` +
    `errore di parola ${(report.errore_di_parola * 100).toFixed(1)}%, attribuzione ${(report.attribuzione * 100).toFixed(0)}% del parlato, ` +
    `${report.frasi} frasi, ${report.battute} battute`);
  console.log(`rapporto: ${path.join(work, 'rapporto.json')}`);
  const failures = gates(report, result.frasi);
  if (failures.length) throw new Error(failures.join('; '));
}

/** Misure del rapporto a partire dal risultato del test Rust e dalla linea del tempo della visita. */
export function measure(result, timeline) {
  return {
    audio_s: result.durata_audio_s, calcolo_s: result.calcolo_s, rtf: result.rtf,
    rss_mb_massimo: result.rss_mb_massimo, battute: timeline.length, frasi: result.frasi.length,
    errore_di_parola: wordErrorRate(TURNS.map(([, text]) => text).join(' '), result.frasi.map(f => f[2]).join(' ')),
    attribuzione: attributionScore(result.frasi, timeline),
    tempi_impronta_ms: result.tempi_impronta_ms, tempo_attribuzione_ms: result.tempo_attribuzione_ms,
  };
}

export function gates(report, segments) {
  const failures = [];
  if (report.audio_s < MIN_SECONDS) failures.push(`visita di ${report.audio_s.toFixed(0)} s, ne servono almeno ${MIN_SECONDS}`);
  if (!segments.length || segments.some(f => f.length < 4)) failures.push('frasi senza medico o paziente');
  if (report.attribuzione < MIN_ATTRIBUTION) failures.push(`attribuzione sotto l'${MIN_ATTRIBUTION * 100}%`);
  if (report.rtf >= MAX_RTF) failures.push(`calcolo più lento del tempo reale (RTF ${report.rtf.toFixed(2)})`);
  if (report.errore_di_parola > MAX_WER) failures.push(`errore di parola sopra il ${MAX_WER * 100}%`);
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
