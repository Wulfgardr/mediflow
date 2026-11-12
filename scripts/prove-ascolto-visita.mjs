// Prova locale dell'ascolto della visita (WUL-828 punto 3) con il modello whisper vero:
// una visita inventata a due voci generata con `say` del Mac, nessun microfono e nessuno
// scaricamento. Il test Rust `real_model_long_session_in_segments` la ascolta a blocchi
// come farebbe il microfono; qui si controlla che medico e paziente siano attribuiti e che
// il calcolo stia al passo con il tempo reale.
// Uso: node scripts/prove-ascolto-visita.mjs <ggml-large-v3-turbo-q5_0.bin> <ggml-silero-v6.2.0.bin>
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_RATE = 16_000;
export const VOICES = { M: 'Eddy (Italian (Italy))', P: 'Grandma (Italian (Italy))' };
export const TURNS = [
  ['M', 'Buongiorno, si accomodi. Come è andata la settimana con la nuova terapia?'],
  ['P', 'Abbastanza bene, dottore. La notte però mi alzo spesso e la mattina ho le caviglie gonfie.'],
  ['M', 'Prende sempre la furosemide da venticinque milligrammi al mattino?'],
  ['P', 'Sì, alle otto con la colazione, insieme alla cardioaspirina.'],
  ['M', 'Bene. Adesso le misuro la pressione e controllo le caviglie.'],
  ['P', 'Va bene. Devo togliere le calze?'],
  ['M', 'Sì, grazie. La pressione è centotrenta su ottanta. Ci rivediamo tra un mese con gli esami del sangue.'],
  ['P', 'Grazie dottore, prenoto gli esami in farmacia.'],
];
/** Soglie della prova: attribuzione corretta su almeno l'80% del parlato, calcolo più veloce del tempo reale. */
export const MIN_ATTRIBUTION = 0.8;
export const MAX_RTF = 1;

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

/** Quota del parlato attribuita alla persona giusta: ogni frase conta per la sua sovrapposizione con le battute. */
export function attributionScore(segments, timeline) {
  let right = 0, total = 0;
  for (const [start, end, , speaker] of segments) {
    const role = speaker === 'Medico' ? 'M' : speaker === 'Paziente' ? 'P' : undefined;
    for (const turn of timeline) {
      const overlap = Math.max(0, Math.min(end, turn.end) - Math.max(start, turn.start));
      total += overlap;
      if (turn.role === role) right += overlap;
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
  const score = attributionScore(result.frasi, timeline);
  console.log(`audio ${result.durata_audio_s.toFixed(0)} s, calcolo ${result.calcolo_s.toFixed(0)} s, ` +
    `attribuzione ${(score * 100).toFixed(0)}% del parlato, ${result.frasi.length} frasi`);
  if (!result.frasi.length || result.frasi.some(f => f.length < 4)) throw new Error('frasi senza medico o paziente');
  if (score < MIN_ATTRIBUTION) throw new Error(`attribuzione sotto l'${MIN_ATTRIBUTION * 100}%`);
  if (result.rtf >= MAX_RTF) throw new Error(`calcolo più lento del tempo reale (RTF ${result.rtf.toFixed(2)})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
