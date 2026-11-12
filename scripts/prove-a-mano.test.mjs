import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { runProof, validateEnvironment, reservedPorts, writeReport, browserEnv, catalog, listeningUnavailable } from './prove-a-mano.mjs';
import { assemble, attributionScore, readWav, writeWav, SAMPLE_RATE, TURNS, VOICES } from './prove-ascolto-visita.mjs';
test('la HOME isolata non nasconde il browser di Playwright installato', () => {
 assert.deepEqual(browserEnv({}, '/Users/medico', 'darwin'), { PLAYWRIGHT_BROWSERS_PATH: '/Users/medico/Library/Caches/ms-playwright' });
 assert.deepEqual(browserEnv({}, '/home/medico', 'linux'), { PLAYWRIGHT_BROWSERS_PATH: '/home/medico/.cache/ms-playwright' });
 assert.deepEqual(browserEnv({ PLAYWRIGHT_BROWSERS_PATH: '/opt/pw', E2E_BROWSER_CHANNEL: 'chrome' }, '/Users/medico', 'darwin'), { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw', E2E_BROWSER_CHANNEL: 'chrome' });
});
test('tre stati osservabili e skip non dichiarato verde', async () => {
 const output = mkdtempSync(path.join(tmpdir(), 'proof-test-'));
 try {
  const run = (id, code) => runProof({ id, command: [process.execPath, '-e', code] }, {}, output);
  const results = [await run('pass', 'process.exit(0)'), await run('fail', 'process.exit(7)'), await runProof({ id: 'missing', command: ['/missing/proof'] }, {}, output)];
  writeReport(output, results);
  assert.deepEqual(JSON.parse(readFileSync(path.join(output, 'esito.json'))).results.map(r => r.status), ['provato', 'fallito', 'non provato']);
  for (const status of ['provato', 'fallito', 'non provato']) assert.ok(readFileSync(path.join(output, 'esito.md'), 'utf8').includes(status));
  assert.ok(results.every(r => r.durationMs >= 0 && r.reason));
  assert.equal((await run('fail', 'process.exit(7)')).status, 'fallito');
  assert.equal((await runProof({ id: 'missing', command: ['/missing/proof'] }, {}, output)).status, 'non provato');
  assert.equal((await run('playwright-skip', 'console.log("4 skipped")')).status, 'non provato');
  assert.equal((await run('zero-skips', 'console.log("ℹ skipped 0")')).status, 'provato');
  assert.equal((await run('skip', 'console.log("# skipped 1")')).status, 'non provato');
  assert.equal((await run('tap-zero-skips', 'console.log("# pass 3\\n# skipped 0")')).status, 'provato');
  assert.equal((await run('tap-skip-directive', 'console.log("ok 1 - caso # SKIP manca Xcode")')).status, 'non provato');
 } finally { rmSync(output, { recursive: true }); }
});
test('rifiuta archivio reale, qualsiasi archivio esterno e porte riservate', () => {
 for (const data of [path.join(homedir(), 'Library/Application Support/MediFlow'), '/tmp/alias']) assert.throws(() => validateEnvironment({ MEDIFLOW_DATA_DIR: data }));
 for (const port of reservedPorts) {
  assert.throws(() => validateEnvironment({ PORT: String(port) }));
  assert.throws(() => validateEnvironment({ E2E_BASE_URL: `http://127.0.0.1:${port}` }));
 }
 assert.doesNotThrow(() => validateEnvironment({}));
});

test('CLI rifiuta configurazioni riservate prima di lanciare prove', () => {
 for (const extra of [{ MEDIFLOW_DATA_DIR: path.join(homedir(), 'Library/Application Support/MediFlow') }, ...reservedPorts.map(port => ({ PORT: String(port) }))]) {
  const result = spawnSync(process.execPath, ['scripts/prove-a-mano.mjs'], { env: { PATH: process.env.PATH, ...extra }, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /non ammesso|porta riservata/u);
  assert.equal(result.stdout, '');
 }
});

test('ascolto della visita: voce col modello vero, microfono dichiarato non provato, niente voci Apple', () => {
 const ids = catalog('/tmp/x').map(proof => proof.id);
 assert.ok(ids.includes('ascolto-visita-modello') && ids.includes('ascolto-visita-microfono'));
 for (const gone of ['voce-whisper-wul-828', 'registrazione-cattura', 'registrazione-visita']) assert.ok(!ids.includes(gone), gone);
 const microphone = catalog('/tmp/x').find(proof => proof.id === 'ascolto-visita-microfono');
 assert.equal(microphone.command, undefined);
 assert.match(microphone.unavailable(), /microfono vero/u);
 const model = catalog('/tmp/x').find(proof => proof.id === 'ascolto-visita-modello');
 assert.ok(model.command.some(arg => arg.endsWith('ggml-silero-v6.2.0.bin')));
 // Prerequisiti dichiarati prima dell'avvio, senza scaricare nulla.
 const empty = mkdtempSync(path.join(tmpdir(), 'home-'));
 try {
  assert.equal(listeningUnavailable(empty, 'linux'), 'richiede macOS');
  assert.match(listeningUnavailable(empty, 'darwin'), /cargo/u);
 } finally { rmSync(empty, { recursive: true }); }
});

test('ascolto della visita: WAV, linea del tempo e quota attribuita', () => {
 const tone = n => Int16Array.from({ length: n }, (_, i) => (i % 40 < 20 ? 3000 : -3000));
 const { audio, timeline } = assemble([{ role: 'M', samples: tone(SAMPLE_RATE) }, { role: 'P', samples: tone(SAMPLE_RATE / 2) }]);
 assert.deepEqual(timeline.map(t => [t.role, t.start, t.end]), [['M', 1, 2], ['P', 2.8, 3.3]]);
 assert.equal(audio.length, SAMPLE_RATE * (1 + 1 + 0.8 + 0.5 + 0.8));
 assert.deepEqual(Array.from(readWav(writeWav(audio))), Array.from(audio));
 assert.equal(attributionScore([[0.8, 2.1, 'a', 'Medico'], [2.7, 3.4, 'b', 'Paziente']], timeline), 1);
 assert.equal(attributionScore([[0.8, 2.1, 'a', 'Paziente'], [2.7, 3.4, 'b', 'Paziente']], timeline), 0.5 / 1.5);
 assert.equal(attributionScore([[0.8, 2.1, 'a']], timeline), 0);
 // Parlato perso dal riconoscitore: conta nel denominatore, quindi mezza battuta su 1,5 s non passa.
 assert.equal(attributionScore([[1, 1.5, 'a', 'Medico']], timeline), 0.5 / 1.5);
 // Frasi duplicate sulla stessa battuta non gonfiano il punteggio.
 assert.equal(attributionScore([[1, 2, 'a', 'Medico'], [1, 2, 'a', 'Medico']], timeline), 1 / 1.5);
 assert.ok(TURNS.length >= 6 && TURNS.every(([role]) => role in VOICES));
});
