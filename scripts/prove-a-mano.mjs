import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const reservedPorts = [3000, 3443, 11434, 11435];
export function validateEnvironment(env) {
  // No caller-owned archive is accepted, including aliases and symlinks.
  if (env.MEDIFLOW_DATA_DIR) throw new Error('MEDIFLOW_DATA_DIR non ammesso: il comando crea il proprio archivio sintetico');
  for (const [key, value] of Object.entries(env)) {
    if (!value || !/(PORT|URL|ENDPOINT)$/u.test(key)) continue;
    let port = /^\d+$/u.test(value) ? Number(value) : undefined;
    try { port ??= Number(new URL(value).port); } catch {}
    if (reservedPorts.includes(port)) throw new Error(`${key}: porta riservata ${port}`);
  }
}
export async function runProof(proof, env, output) {
  const start = Date.now();
  let status = 'non provato', reason;
  try {
    reason = await proof.unavailable?.();
    if (!reason) {
      const result = await new Promise(resolve => {
        const child = spawn(proof.command[0], proof.command.slice(1), { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let text = '';
        child.stdout.on('data', chunk => { text += chunk; });
        child.stderr.on('data', chunk => { text += chunk; });
        child.once('error', error => resolve({ error, text }));
        child.once('close', code => resolve({ code, text }));
      });
      writeFileSync(path.join(output, `${proof.id}.log`), result.text);
      if (result.error) reason = result.error.message;
      else if (result.code !== 0) { status = 'fallito'; reason = `uscita ${result.code}; vedere ${proof.id}.log`; }
      else if (/# SKIP(?!\p{L})|(?:# |ℹ )?skipped [1-9]|\b[1-9]\d* (?:tests? )?skipped\b|XCTSkip/iu.test(result.text)) reason = `suite con prove saltate; vedere ${proof.id}.log`;
      else { status = 'provato'; reason = 'comando concluso senza errori né skip'; }
    }
  } catch (error) { reason = error.message; }
  return { id: proof.id, status, reason, durationMs: Date.now() - start };
}
const node = process.execPath;
const mac = () => process.platform !== 'darwin' ? 'richiede macOS' : !existsSync('/Applications/Xcode-beta.app') ? 'manca Xcode-beta' : undefined;
const ts = (id, files, unavailable = mac) => ({ id, command: [node, 'scripts/run-strip-types.mjs', '--test', ...files], unavailable: () => !existsSync('node_modules/typescript') ? 'mancano dipendenze npm' : unavailable() });
export function catalog(output) {
  return [
    ts('apple-vision', ['lib/domain/documents/anydoc-apple-vision-ocr.test.ts', 'lib/domain/documents/anydoc-ocr-acceptance.test.ts', 'lib/domain/documents/anydoc-current-source-composition.test.ts']),
    ts('tesseract', ['scripts/anydoc-desktop-ocr-real.test.ts'], () => {
      const manifest = JSON.parse(readFileSync('scripts/anydoc-tesseract-artifacts.json', 'utf8'));
      const missing = manifest.files.filter(file => !existsSync(path.join(manifest.directory, file.name)));
      return missing.length ? `mancano artefatti Tesseract: ${missing.map(file => file.name).join(', ')}` : mac();
    }),
    ts('redazione-protocollo', ['lib/gliner-redaction-runner.test.ts']),
    { id: 'runtime-distribuito', command: [node, '--test', 'scripts/check-standalone-runtime-bundle.test.mjs'], unavailable: mac },
    ts('voce-contratto', ['lib/chat-card/local-voice.test.ts']),
    ts('contenitore-mac', ['lib/chatgpt-execution/execution-mac-probe.test.ts']),
    ts('archivio-mac', ['lib/backup-destination-policy.test.ts', 'lib/native-patient-document.test.ts']),
    { id: 'registrazione-cattura', command: ['swift', 'test', '--package-path', 'native/MediFlowMac', '--disable-automatic-resolution', '--filter', 'VisitRecordingCaptureTests'], unavailable: mac },
    { id: 'registrazione-visita', command: [node, 'scripts/run-visit-recording-synthetic-benchmark.mjs'], unavailable: mac },
    { id: 'visuale-091', command: [node, 'scripts/qualify-visual-091.mjs'], unavailable: () => !existsSync('node_modules/next/dist/bin/next') ? 'mancano dipendenze Next' : undefined },
    { id: 'identita-ui', unavailable: () => 'spec vincolato al banco /Volumes/Vision e reference.json; migrazione del banco necessaria' },
    { id: 'voce-whisper-wul-828', unavailable: () => 'WUL-828: prova reale non ancora integrata; aggancio catalog(output) documentato' },
  ];
}
export function writeReport(output, results) {
    writeFileSync(path.join(output, 'esito.json'), JSON.stringify({ output, results }, null, 2));
    writeFileSync(path.join(output, 'esito.md'), '# Prove locali di rilascio\n\n| Prova | Esito | Motivo | Durata ms |\n|---|---|---|---|\n' + results.map(r => `| ${r.id} | ${r.status} | ${r.reason.replaceAll('|', '/')} | ${r.durationMs} |`).join('\n') + '\n');
}
// HOME isolata: il browser di Playwright resta quello installato dall'utente.
export function browserEnv(source, realHome, platform = process.platform) {
  const cache = platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright';
  const env = { PLAYWRIGHT_BROWSERS_PATH: source.PLAYWRIGHT_BROWSERS_PATH || path.join(realHome, cache) };
  if (source.E2E_BROWSER_CHANNEL) env.E2E_BROWSER_CHANNEL = source.E2E_BROWSER_CHANNEL;
  return env;
}
export async function main() {
  validateEnvironment(process.env);
  if (process.env.CI) throw new Error('Comando riservato alle prove locali');
  const output = realpathSync(mkdtempSync(path.join(tmpdir(), 'mediflow-prove-')));
  const data = path.join(output, 'data'); mkdirSync(data);
  const home = path.join(output, 'home'); mkdirSync(home);
  const temporary = path.join(output, 'tmp'); mkdirSync(temporary);
  writeFileSync(path.join(data, 'SYNTHETIC_ONLY'), 'WUL-830');
  const env = { PATH: process.env.PATH, HOME: home, TMPDIR: temporary, LANG: 'it_IT.UTF-8',
    DEVELOPER_DIR: '/Applications/Xcode-beta.app/Contents/Developer',
    MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DATA_DIR: data, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1',
    VISUAL_091_OUTPUT: path.join(output, 'visuale'), ...browserEnv(process.env, homedir()) };
  const results = [];
  for (const proof of catalog(output)) {
    const result = await runProof(proof, env, output); results.push(result);
    console.log(`${result.id}: ${result.status} (${result.reason})`);
    writeReport(output, results);
  }
  console.log(`Esiti: ${output}`);
  process.exitCode = results.some(r => r.status === 'fallito') ? 1 : results.some(r => r.status === 'non provato') ? 2 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 2; });
