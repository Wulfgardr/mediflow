#!/usr/bin/env node
/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const RECEIPT_PREFIX = 'MEDIFLOW_RECORDING_BENCHMARK_RECEIPT=';
const VOICES = [
  'Alice (Italian (Italy))',
  'Eddy (Italian (Italy))',
  'Flo (Italian (Italy))',
  'Grandma (Italian (Italy))',
  'Grandpa (Italian (Italy))',
];
const RATES = [155, 175, 195];
const SENTENCES = [
  'Questa registrazione artificiale descrive una visita dimostrativa e non contiene informazioni appartenenti a persone reali.',
  'La voce legge frasi italiane semplici con ritmo regolare, pause naturali e parole chiaramente separate.',
  'Il testo serve soltanto a misurare la trascrizione locale sul computer usato per la verifica.',
  'Ogni riferimento è inventato, privo di identità e scollegato da qualunque attività sanitaria effettiva.',
  'Durante la prova il sistema elabora audio sintetico e non apre il microfono della macchina.',
  'La sequenza controlla accuratezza, tempo di completamento, consumo di memoria e limite della coda.',
  'Una frase può cambiare ordine tra le clip mantenendo lo stesso vocabolario neutro e riproducibile.',
  'Al termine il programma elimina tutti i file audio temporanei e conserva soltanto metriche aggregate.',
  'La ricevuta non include trascrizioni, nomi, codici, date cliniche o altri contenuti identificativi.',
  'Questo corpus è un banco di prova tecnico e non misura accuratezza clinica o idoneità diagnostica.',
];

function fail(message, result) {
  const detail = [result?.stdout, result?.stderr].filter(Boolean).join('\n').trim();
  throw new Error(detail ? `${message}\n${detail}` : message);
}

function command(commandPath, args, options = {}) {
  const result = spawnSync(commandPath, args, {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1_024 * 1_024,
    ...options,
  });
  if (result.error || result.status !== 0) fail(`Command failed: ${commandPath}`, result);
  return result;
}

function words(value) {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function buildCorpus(directory) {
  const clips = [];
  for (let index = 0; index < 30; index += 1) {
    const voice = VOICES[index % VOICES.length];
    const rate = RATES[Math.floor(index / VOICES.length) % RATES.length];
    const offset = index % SENTENCES.length;
    const reference = [...SENTENCES.slice(offset), ...SENTENCES.slice(0, offset)].join(' ');
    const id = `clip-${String(index + 1).padStart(2, '0')}`;
    const audioPath = path.join(directory, `${id}.aiff`);
    command('/usr/bin/say', ['-v', voice, '-r', String(rate), '-o', audioPath, reference]);
    clips.push(Object.freeze({ id, audioPath, reference, voice, rate }));
  }
  const stable = clips.map(({ id, reference, voice, rate }) => ({ id, reference, voice, rate }));
  const corpusSha256 = createHash('sha256').update(JSON.stringify(stable)).digest('hex');
  return Object.freeze({
    schemaVersion: 'mediflow.visit-recording.synthetic-benchmark-manifest.v1',
    corpusSha256,
    clips,
  });
}

function parseReceipt(output) {
  const line = output.split(/\r?\n/u).find((candidate) => candidate.startsWith(RECEIPT_PREFIX));
  assert.ok(line, 'Synthetic recording benchmark did not emit a receipt');
  const receipt = JSON.parse(line.slice(RECEIPT_PREFIX.length));
  assert.equal(receipt.schemaVersion, 'mediflow.visit-recording.synthetic-benchmark-receipt.v1');
  assert.equal(receipt.outcome, 'passed');
  return receipt;
}

function render(receipt) {
  const compact = {
    corpusSha256: receipt.corpusSha256,
    clips: receipt.clipCount,
    referenceWords: receipt.referenceWordCount,
    voices: receipt.voiceCount,
    rates: receipt.rateCount,
    werPercent: Number((receipt.wer * 100).toFixed(2)),
    emptyTranscripts: receipt.emptyTranscriptCount,
    p95FinalizationMs: Number(receipt.p95FinalizationMs.toFixed(1)),
    maxRealTimeFactor: Number(receipt.maxRealTimeFactor.toFixed(4)),
    peakQueueBytes: receipt.peakQueueBytes,
    peakRssDeltaBytes: receipt.peakRssDeltaBytes,
  };
  process.stdout.write(`Visit Recording synthetic benchmark passed: ${JSON.stringify(compact)}\n`);
}

function main() {
  assert.equal(process.platform, 'darwin', 'Visit Recording benchmark requires macOS');
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-recording-benchmark-')));
  try {
    const manifest = buildCorpus(directory);
    assert.equal(manifest.clips.length, 30);
    assert.ok(manifest.clips.reduce((total, clip) => total + words(clip.reference), 0) >= 3_000);
    const manifestPath = path.join(directory, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, { encoding: 'utf8', mode: 0o600 });
    const result = command('swift', [
      'test', '--package-path', 'native/MediFlowMac', '--disable-automatic-resolution',
      '--filter', 'VisitRecordingSyntheticBenchmarkTests/testSyntheticCorpusGate',
    ], {
      env: { ...process.env, MEDIFLOW_VISIT_RECORDING_BENCHMARK_MANIFEST: manifestPath },
    });
    render(parseReceipt(result.stdout));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    assert.equal(fs.existsSync(directory), false, 'Synthetic benchmark cleanup failed');
  }
}

main();
