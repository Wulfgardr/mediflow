#!/usr/bin/env node
/* @Codex */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'screenshots');
const TSCONFIG_PATH = path.join(ROOT_DIR, 'tsconfig.json');
const DATA_DIR = process.env.MEDIFLOW_README_SHOTS_DATA_DIR
  ? path.resolve(process.env.MEDIFLOW_README_SHOTS_DATA_DIR)
  : path.join(ROOT_DIR, 'tmp-readme-shots-data');
const DIST_DIR = process.env.MEDIFLOW_README_SHOTS_DIST_DIR || '.next-readme-shots';
const BASE_URL = process.env.README_SHOTS_BASE_URL || 'http://127.0.0.1:3112';
const REUSE_SERVER = process.env.README_SHOTS_REUSE_SERVER === '1';
const PIN = process.env.README_SHOTS_PIN || '1234';
const USERNAME = process.env.README_SHOTS_USERNAME || 'admin';
const SCREENSHOT_PATIENT_ID = 'readme-shots-giulia-fervi';
const SCREENSHOT_TAX_CODE = 'FVRGLI58D57Z000H';

const DEMO_PATIENTS = [
  {
    id: SCREENSHOT_PATIENT_ID, firstName: 'Giulia', lastName: 'Fervi', taxCode: SCREENSHOT_TAX_CODE, birthDate: '1958-04-17T00:00:00.000Z',
    diagnoses: [{ code: 'I10', description: 'Ipertensione essenziale', system: 'ICD-10' }, { code: 'E11.9', description: 'Diabete mellito tipo 2 senza complicanze', system: 'ICD-10' }],
    notes: 'Caso dimostrativo sintetico. Monitoraggio pressorio e metabolico programmato.',
    therapy: { drugName: 'Ramipril', activePrinciple: 'Ramipril', dosage: '5 mg, 1 compressa al mattino', diagnosisCode: 'I10', diagnosisName: 'Ipertensione essenziale' },
    observation: { code: '85354-9', display: 'Pressione arteriosa', value: '128/76', unitCode: 'mm[Hg]' },
  },
  {
    id: 'readme-shots-lorenzo-contarli', firstName: 'Lorenzo', lastName: 'Contarli', taxCode: 'CTRLNZ49S03Z001V', birthDate: '1949-11-03T00:00:00.000Z',
    diagnoses: [{ code: 'J44.9', description: 'BPCO', system: 'ICD-10' }], notes: 'Caso dimostrativo sintetico. Follow-up respiratorio territoriale.',
    therapy: { drugName: 'Tiotropio', activePrinciple: 'Tiotropio bromuro', dosage: '18 mcg, 1 capsula al giorno', diagnosisCode: 'J44.9', diagnosisName: 'BPCO' },
    observation: { code: '59408-5', display: 'Saturazione di ossigeno', value: '95', unitCode: '%' },
  },
  {
    id: 'readme-shots-anna-rivani', firstName: 'Anna', lastName: 'Rivani', taxCode: 'RVNNNA61A62Z002L', birthDate: '1961-01-22T00:00:00.000Z',
    diagnoses: [{ code: 'M17.0', description: 'Gonartrosi bilaterale', system: 'ICD-10' }], notes: 'Caso dimostrativo sintetico. Controllo del dolore e della mobilita.',
    therapy: { drugName: 'Paracetamolo', activePrinciple: 'Paracetamolo', dosage: '1000 mg al bisogno, massimo 3 al giorno', diagnosisCode: 'M17.0', diagnosisName: 'Gonartrosi bilaterale' },
    observation: { code: '72514-3', display: 'Scala numerica del dolore', value: '3', unitCode: 'score' },
  },
  {
    id: 'readme-shots-paolo-grecori', firstName: 'Paolo', lastName: 'Grecori', taxCode: 'GRCPLA54M09Z003P', birthDate: '1954-08-09T00:00:00.000Z',
    diagnoses: [{ code: 'I48.91', description: 'Fibrillazione atriale', system: 'ICD-10' }], notes: 'Caso dimostrativo sintetico. Verifica periodica della terapia anticoagulante.',
    therapy: { drugName: 'Apixaban', activePrinciple: 'Apixaban', dosage: '5 mg, 1 compressa ogni 12 ore', diagnosisCode: 'I48.91', diagnosisName: 'Fibrillazione atriale' },
    observation: { code: '8867-4', display: 'Frequenza cardiaca', value: '72', unitCode: '/min' },
  },
  {
    id: 'readme-shots-elena-serraldi', firstName: 'Elena', lastName: 'Serraldi', taxCode: 'SRRLNE68H54Z004F', birthDate: '1968-06-14T00:00:00.000Z',
    diagnoses: [{ code: 'E03.9', description: 'Ipotiroidismo non specificato', system: 'ICD-10' }], notes: 'Caso dimostrativo sintetico. Controllo TSH concordato.',
    therapy: { drugName: 'Levotiroxina', activePrinciple: 'Levotiroxina sodica', dosage: '50 mcg, 1 compressa al mattino', diagnosisCode: 'E03.9', diagnosisName: 'Ipotiroidismo' },
    observation: { code: '3016-3', display: 'TSH', value: '2.1', unitCode: 'm[IU]/L' },
  },
  {
    id: 'readme-shots-matteo-russani', firstName: 'Matteo', lastName: 'Russani', taxCode: 'RSSMTT70C30Z005S', birthDate: '1970-03-30T00:00:00.000Z',
    diagnoses: [{ code: 'E78.5', description: 'Iperlipidemia non specificata', system: 'ICD-10' }], notes: 'Caso dimostrativo sintetico. Rivalutazione del profilo lipidico.',
    therapy: { drugName: 'Atorvastatina', activePrinciple: 'Atorvastatina', dosage: '20 mg, 1 compressa la sera', diagnosisCode: 'E78.5', diagnosisName: 'Iperlipidemia' },
    observation: { code: '2093-3', display: 'Colesterolo totale', value: '178', unitCode: 'mg/dL' },
  },
  {
    id: 'readme-shots-sara-fontari', firstName: 'Sara', lastName: 'Fontari', taxCode: 'FNTSRA56P51Z006E', birthDate: '1956-09-11T00:00:00.000Z',
    diagnoses: [{ code: 'N18.3', description: 'Malattia renale cronica stadio 3', system: 'ICD-10' }], notes: 'Caso dimostrativo sintetico. Sorveglianza della funzione renale.',
    therapy: { drugName: 'Furosemide', activePrinciple: 'Furosemide', dosage: '25 mg, 1 compressa al mattino', diagnosisCode: 'N18.3', diagnosisName: 'Malattia renale cronica stadio 3' },
    observation: { code: '2160-0', display: 'Creatinina', value: '1.18', unitCode: 'mg/dL' },
  },
  {
    id: 'readme-shots-davide-marvini', firstName: 'Davide', lastName: 'Marvini', taxCode: 'MRNVDD64T05Z007T', birthDate: '1964-12-05T00:00:00.000Z',
    diagnoses: [{ code: 'K21.9', description: 'Malattia da reflusso gastroesofageo', system: 'ICD-10' }], notes: 'Caso dimostrativo sintetico. Rivalutazione dei sintomi riferiti.',
    therapy: { drugName: 'Pantoprazolo', activePrinciple: 'Pantoprazolo', dosage: '20 mg, 1 compressa prima di colazione', diagnosisCode: 'K21.9', diagnosisName: 'Malattia da reflusso gastroesofageo' },
    observation: { code: '8302-2', display: 'Temperatura corporea', value: '36.6', unitCode: 'Cel' },
  },
];

const DEMO_DOCUMENT_INSIGHTS = [
  {
    id: 'readme-shots-insight-cardiology', attachmentId: 'readme-shots-attachment-cardiology', date: '2026-07-13T09:30:00.000Z', fileName: 'referto-cardiologico-sintetico.pdf',
    rawMarkdown: 'Referto sintetico con ipertensione essenziale e terapia con Ramipril.',
    summary: 'Referto dimostrativo sintetico. Ipertensione essenziale in controllo, terapia con Ramipril da verificare in revisione.',
    quality: { level: 'green', reason: 'Documento sintetico leggibile' },
    extractedData: { diagnoses: [{ code: 'I10', description: 'Ipertensione essenziale', system: 'ICD-10', confidence: 'high' }], medications: ['Ramipril 5 mg'] },
    routedClass: { classification: 'cardiology_report', confidence: 'high', synthesis: { kind: 'deterministic', rationale: 'Dati strutturati dimostrativi locali' } },
  },
  {
    id: 'readme-shots-insight-labs', attachmentId: 'readme-shots-attachment-labs', date: '2026-07-14T11:15:00.000Z', fileName: 'controllo-metabolico-sintetico.pdf',
    rawMarkdown: 'Controllo metabolico sintetico con pressione e glicemia da rivalutare.',
    summary: 'Valori dimostrativi coerenti con il follow-up metabolico programmato. Nessuna promozione automatica.',
    quality: { level: 'yellow', reason: 'Richiede conferma operatore' },
    extractedData: { labs: { 'Pressione arteriosa': '128/76 mmHg', Glicemia: '112 mg/dL' } },
    routedClass: { classification: 'laboratory_report', confidence: 'medium' },
  },
];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT_DIR, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${signal || code}`)));
  });
}

function startServer() {
  const url = new URL(BASE_URL);
  return spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--turbopack', '--hostname', url.hostname, '--port', url.port], {
    cwd: ROOT_DIR,
    env: { ...process.env, MEDIFLOW_DATA_DIR: DATA_DIR, MEDIFLOW_NEXT_DIST_DIR: DIST_DIR, E2E_PIN: PIN, E2E_USERNAME: USERNAME, E2E_DISPLAY_NAME: 'Dott.ssa Demo Lume', E2E_AMBULATORY_NAME: 'Ambulatorio Demo Lume' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function waitForServer(server) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Dev server exited with ${server.exitCode}`);
    try {
      if ((await fetch(`${BASE_URL}/api/auth/check`, { cache: 'no-store' })).ok) return;
    } catch {
      // The server is still compiling. The next poll observes readiness.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready at ${BASE_URL}`);
}

async function request(page, method, route, body) {
  return page.evaluate(async ({ method, route, body }) => {
    const response = await fetch(route, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${route} ${response.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  }, { method, route, body });
}

async function retryDatabaseWrite(operation) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!/database is locked|SQLITE_BUSY/i.test(String(error)) || attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Database write retry exhausted.');
}

function post(page, route, body) {
  return retryDatabaseWrite(() => request(page, 'POST', route, body));
}

function put(page, route, body) {
  return retryDatabaseWrite(() => request(page, 'PUT', route, body));
}

async function seedDemoData(page) {
  for (const [index, patient] of DEMO_PATIENTS.entries()) {
    await post(page, '/api/patients', { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, taxCode: patient.taxCode, birthDate: patient.birthDate, diagnoses: patient.diagnoses, notes: patient.notes, isAdi: index === 0 });
    await post(page, '/api/therapies', { id: `${patient.id}-therapy`, patientId: patient.id, ...patient.therapy, status: 'active', startDate: '2025-01-15T08:00:00.000Z', endDate: null });
    await post(page, '/api/observations', { id: `${patient.id}-observation`, patientId: patient.id, ...patient.observation, codeSystem: 'LOINC', unitSystem: 'UCUM', observedAt: '2026-07-14T08:30:00.000Z', notes: 'Rilevazione dimostrativa sintetica', source: 'manual' });
    await post(page, '/api/entries', { id: `${patient.id}-entry`, patientId: patient.id, type: 'visit', title: 'Controllo territoriale', date: '2026-07-13T09:30:00.000Z', content: 'Voce di diario dimostrativa sintetica. Rivalutati parametri e aderenza terapeutica.' });
  }

  await put(page, `/api/patients/${SCREENSHOT_PATIENT_ID}`, { version: 1, documentInsights: JSON.stringify(DEMO_DOCUMENT_INSIGHTS) });
  await post(page, '/api/entries', { id: `${SCREENSHOT_PATIENT_ID}-entry-phone`, patientId: SCREENSHOT_PATIENT_ID, type: 'phone', title: 'Contatto di follow-up', date: '2026-07-14T11:15:00.000Z', content: 'Contatto dimostrativo sintetico: nessuna criticita riferita, confermato il prossimo controllo.' });
  for (const document of [
    { id: 'readme-shots-attachment-cardiology', name: 'referto-cardiologico-sintetico.pdf', summarySnapshot: 'Referto cardiologico sintetico, codifica I10 da verificare.', ocrQueueState: 'manual_review', ocrQueueReason: 'text_layer_absent' },
    { id: 'readme-shots-attachment-labs', name: 'controllo-metabolico-sintetico.pdf', summarySnapshot: 'Controllo metabolico sintetico, valori da rivedere.', ocrQueueState: 'ocr_done' },
    { id: 'readme-shots-attachment-therapy', name: 'piano-terapeutico-sintetico.pdf', summarySnapshot: 'Piano terapeutico sintetico con Ramipril 5 mg.', ocrQueueState: 'processing', ocrQueueReason: 'image_or_scan' },
  ]) {
    await post(page, '/api/attachments', { ...document, patientId: SCREENSHOT_PATIENT_ID, type: 'application/pdf', size: 128, path: document.name, data: 'data:application/pdf;base64,JVBERi0xLjQKJSBzaW50ZXRpY28K' });
  }
  await post(page, '/api/checkups', { id: `${SCREENSHOT_PATIENT_ID}-checkup`, patientId: SCREENSHOT_PATIENT_ID, title: 'Controllo pressorio programmato', date: '2026-07-16T09:00:00.000Z', notes: 'Appuntamento dimostrativo sintetico', status: 'pending', source: 'manual' });
}

async function waitForQuietScene(page, expectedText) {
  const expected = expectedText.startsWith('testid:')
    ? page.getByTestId(expectedText.slice('testid:'.length))
    : page.getByText(expectedText, { exact: false }).first();
  await expected.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(async () => {
    if (document.fonts.status !== 'loaded') return false;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.querySelector('[role="dialog"][aria-modal="true"]') === null;
  });
}

async function assertPatientCode(page, { required = true } = {}) {
  const unavailable = page.getByText('CF non disponibile', { exact: true });
  if (await unavailable.count()) throw new Error('A visible patient code regressed to "CF non disponibile".');
  if (required) await page.getByText(/Z000H/).first().waitFor({ state: 'visible', timeout: 20_000 });
}

async function capture(page, relativeUrl, expectedText, fileName, options) {
  await page.goto(`${BASE_URL}${relativeUrl}`, { waitUntil: 'domcontentloaded' });
  await waitForQuietScene(page, expectedText);
  await assertPatientCode(page, options);
  if (options?.diagnosis) {
    await page.getByRole('button', { name: options.diagnosis }).waitFor({ state: 'visible', timeout: 20_000 });
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, fileName), fullPage: false, animations: 'disabled' });
}

async function main() {
  const originalTsconfig = fs.readFileSync(TSCONFIG_PATH, 'utf8');
  await run('npm', ['run', 'check:node-runtime']);
  if (!REUSE_SERVER) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(path.join(ROOT_DIR, DIST_DIR), { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    await run(process.execPath, [path.join(ROOT_DIR, 'scripts/prepare-e2e-db.mjs')], { env: { ...process.env, MEDIFLOW_DATA_DIR: DATA_DIR, E2E_PIN: PIN, E2E_USERNAME: USERNAME, E2E_DISPLAY_NAME: 'Dott.ssa Demo Lume', E2E_AMBULATORY_NAME: 'Ambulatorio Demo Lume' } });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let server;
  let browser;
  try {
    if (!REUSE_SERVER) { server = startServer(); await waitForServer(server); }
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
    const seedPage = await context.newPage();
    await seedPage.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    const pinInput = seedPage.getByLabel('PIN operatore');
    await pinInput.waitFor({ state: 'visible', timeout: 20_000 });
    await pinInput.fill(PIN);
    await seedPage.getByRole('button', { name: /Sblocca/ }).first().click();
    await seedPage.getByLabel('MediFlow lock screen').waitFor({ state: 'hidden', timeout: 20_000 });
    await seedDemoData(seedPage);
    await seedPage.close();

    const capturePage = await context.newPage();
    await capturePage.goto(`${BASE_URL}/?area=incarico&paziente=${SCREENSHOT_PATIENT_ID}`, { waitUntil: 'domcontentloaded' });
    const capturePinInput = capturePage.getByLabel('PIN operatore');
    await capturePinInput.waitFor({ state: 'visible', timeout: 20_000 });
    await capturePinInput.fill(PIN);
    await capturePage.getByRole('button', { name: /Sblocca/ }).first().click();
    await capturePage.getByLabel('MediFlow lock screen').waitFor({ state: 'hidden', timeout: 20_000 });
    await capture(capturePage, '/?area=incarico', 'Fervi Giulia', '01-worklist.png', { diagnosis: /I10.*Ipertensione essenziale/ });
    await capture(capturePage, `/patients/${SCREENSHOT_PATIENT_ID}/modules`, 'Archivio Intelligente', '02-scheda.png');
    await capture(capturePage, `/?area=scheda&paziente=${SCREENSHOT_PATIENT_ID}`, 'Quadro paziente', '03-quadro.png');
    await capture(capturePage, `/?area=revisione&paziente=${SCREENSHOT_PATIENT_ID}`, 'referto-cardiologico-sintetico.pdf', '04-review.png', { required: false });
    await capture(capturePage, '/settings/accesso', 'testid:settings-access-section', '05-security.png', { required: false });
    await capturePage.waitForLoadState('networkidle');
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise((resolve) => server.once('exit', resolve)); }
    if (!REUSE_SERVER) fs.rmSync(path.join(ROOT_DIR, DIST_DIR), { recursive: true, force: true });
    if (fs.readFileSync(TSCONFIG_PATH, 'utf8') !== originalTsconfig) fs.writeFileSync(TSCONFIG_PATH, originalTsconfig);
  }
}

main().then(() => console.log(`README screenshots written to ${OUTPUT_DIR}`)).catch((error) => {
  console.error('[readme-shots] Failed:', error);
  process.exitCode = 1;
});
