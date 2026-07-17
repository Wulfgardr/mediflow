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
const DATA_DIR = process.env.MEDIFLOW_SCREENSHOTS_DATA_DIR
  ? path.resolve(process.env.MEDIFLOW_SCREENSHOTS_DATA_DIR)
  : path.join(ROOT_DIR, 'tmp-screenshots-data');
const DIST_DIR = process.env.MEDIFLOW_SCREENSHOTS_DIST_DIR || '.next-screenshots';
const BASE_URL = process.env.SCREENSHOTS_BASE_URL || 'http://127.0.0.1:3114';
const PIN = process.env.SCREENSHOTS_PIN || '1234';
const USERNAME = process.env.SCREENSHOTS_USERNAME || 'admin';
const PATIENT_ID = 'screenshots-giulia-fervi';
const PATIENT_CODE = 'FVRGLI58D57Z000H';
const VIEWPORT = { width: 1440, height: 900 };

const PATIENTS = [
  ['Giulia', 'Fervi', 'FVRGLI58D57Z000H', 'I10', 'Ipertensione essenziale', 'Ramipril', '128/76', 'Pressione arteriosa'],
  ['Lorenzo', 'Contarli', 'CTRLNZ49S03Z001V', 'J44.9', 'BPCO', 'Tiotropio', '95', 'Saturazione di ossigeno'],
  ['Anna', 'Rivani', 'RVNNNA61A62Z002L', 'M17.0', 'Gonartrosi bilaterale', 'Paracetamolo', '3', 'Scala numerica del dolore'],
  ['Paolo', 'Grecori', 'GRCPLA54M09Z003P', 'I48.91', 'Fibrillazione atriale', 'Apixaban', '72', 'Frequenza cardiaca'],
  ['Elena', 'Serraldi', 'SRRLNE68H54Z004F', 'E03.9', 'Ipotiroidismo', 'Levotiroxina', '2.1', 'TSH'],
  ['Matteo', 'Russani', 'RSSMTT70C30Z005S', 'E78.5', 'Iperlipidemia non specificata', 'Atorvastatina', '178', 'Colesterolo totale'],
  ['Sara', 'Fontari', 'FNTSRA56P51Z006E', 'N18.3', 'Malattia renale cronica stadio 3', 'Furosemide', '1.18', 'Creatinina'],
  ['Davide', 'Marvini', 'MRNVDD64T05Z007T', 'K21.9', 'Malattia da reflusso gastroesofageo', 'Pantoprazolo', '36.6', 'Temperatura corporea'],
];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT_DIR, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`${command} ${args.join(' ')} exited with ${signal || code}`)));
  });
}

function startServer() {
  const url = new URL(BASE_URL);
  return spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--turbopack', '--hostname', url.hostname, '--port', url.port], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      MEDIFLOW_DATA_DIR: DATA_DIR,
      MEDIFLOW_NEXT_DIST_DIR: DIST_DIR,
      E2E_PIN: PIN,
      E2E_USERNAME: USERNAME,
      E2E_DISPLAY_NAME: 'Dott.ssa Demo Lume',
      E2E_AMBULATORY_NAME: 'Ambulatorio Demo Lume',
    },
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
      // Compilation is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready at ${BASE_URL}`);
}

async function request(page, method, route, body) {
  return page.evaluate(async ({ method: nextMethod, route: nextRoute, body: nextBody }) => {
    const response = await fetch(nextRoute, {
      method: nextMethod,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextBody),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${nextMethod} ${nextRoute} ${response.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  }, { method, route, body });
}

async function write(page, method, route, body) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await request(page, method, route, body);
    } catch (error) {
      if (!/database is locked|SQLITE_BUSY/i.test(String(error)) || attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Database write retry exhausted.');
}

async function seed(page) {
  for (const [index, [firstName, lastName, taxCode, code, description, drugName, value, display]] of PATIENTS.entries()) {
    const id = index === 0 ? PATIENT_ID : `screenshots-${lastName.toLowerCase()}`;
    await write(page, 'POST', '/api/patients', {
      id, firstName, lastName, taxCode, birthDate: `19${58 + index}-04-17T00:00:00.000Z`,
      diagnoses: [{ code, description, system: 'ICD-10' }],
      notes: 'Caso dimostrativo sintetico. Monitoraggio territoriale programmato.', isAdi: index === 0,
    });
    await write(page, 'POST', '/api/therapies', {
      id: `${id}-therapy`, patientId: id, drugName, activePrinciple: drugName,
      dosage: '5 mg, 1 compressa al mattino', diagnosisCode: code, diagnosisName: description,
      status: 'active', startDate: '2025-01-15T08:00:00.000Z', endDate: null,
    });
    await write(page, 'POST', '/api/observations', {
      id: `${id}-observation`, patientId: id, code: '85354-9', display, value,
      unitCode: index === 0 ? 'mm[Hg]' : 'score', codeSystem: 'LOINC', unitSystem: 'UCUM',
      observedAt: '2026-07-14T08:30:00.000Z', notes: 'Rilevazione dimostrativa sintetica', source: 'manual',
    });
    await write(page, 'POST', '/api/entries', {
      id: `${id}-entry`, patientId: id, type: 'visit', title: 'Controllo territoriale',
      date: '2026-07-13T09:30:00.000Z', content: 'Voce di diario dimostrativa sintetica. Rivalutati parametri e aderenza terapeutica.',
    });
  }

  const insights = [{
    id: 'screenshots-insight-cardiology', attachmentId: 'screenshots-attachment-cardiology', date: '2026-07-13T09:30:00.000Z',
    fileName: 'referto-cardiologico-sintetico.pdf', rawMarkdown: 'Referto sintetico con ipertensione essenziale.',
    summary: 'Referto dimostrativo sintetico. Terapia da verificare in revisione.',
    quality: { level: 'green', reason: 'Documento sintetico leggibile' },
    extractedData: { diagnoses: [{ code: 'I10', description: 'Ipertensione essenziale', system: 'ICD-10', confidence: 'high' }] },
    routedClass: { classification: 'cardiology_report', confidence: 'high', synthesis: { kind: 'deterministic', rationale: 'Dati dimostrativi locali' } },
  }];
  await write(page, 'PUT', `/api/patients/${PATIENT_ID}`, { version: 1, documentInsights: JSON.stringify(insights) });
  await write(page, 'POST', '/api/entries', {
    id: `${PATIENT_ID}-entry-phone`, patientId: PATIENT_ID, type: 'phone', title: 'Contatto di follow-up',
    date: '2026-07-14T11:15:00.000Z', content: 'Contatto dimostrativo sintetico: nessuna criticita riferita.',
  });
  for (const [id, name, state] of [
    ['screenshots-attachment-cardiology', 'referto-cardiologico-sintetico.pdf', 'manual_review'],
    ['screenshots-attachment-labs', 'controllo-metabolico-sintetico.pdf', 'ocr_done'],
    ['screenshots-attachment-therapy', 'piano-terapeutico-sintetico.pdf', 'processing'],
  ]) {
    await write(page, 'POST', '/api/attachments', {
      id, name, patientId: PATIENT_ID, type: 'application/pdf', size: 128, path: name,
      data: 'data:application/pdf;base64,JVBERi0xLjQKJSBzaW50ZXRpY28K', summarySnapshot: 'Documento dimostrativo sintetico da rivedere.',
      ocrQueueState: state,
    });
  }
  await write(page, 'POST', '/api/checkups', {
    id: `${PATIENT_ID}-checkup`, patientId: PATIENT_ID, title: 'Controllo pressorio programmato',
    date: '2026-07-16T09:00:00.000Z', notes: 'Appuntamento dimostrativo sintetico', status: 'pending', source: 'manual',
  });
}

async function unlock(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('PIN operatore').fill(PIN);
  await page.getByRole('button', { name: /Sblocca/ }).first().click();
  await page.getByLabel('MediFlow lock screen').waitFor({ state: 'hidden', timeout: 20_000 });
  await page.evaluate(() => {
    localStorage.setItem('mediflow-theme', 'light');
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  });
}

async function waitForScene(page, expectedText) {
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

async function capture(page, relativeUrl, expectedText, fileName, needsPatientCode = true) {
  await page.goto(`${BASE_URL}${relativeUrl}`, { waitUntil: 'domcontentloaded' });
  await waitForScene(page, expectedText);
  if (needsPatientCode) await page.getByText(/Z000H/).first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.screenshot({ path: path.join(OUTPUT_DIR, fileName), fullPage: false, animations: 'disabled' });
}

async function main() {
  const originalTsconfig = fs.readFileSync(TSCONFIG_PATH, 'utf8');
  await run('npm', ['run', 'check:node-runtime']);
  const stale = await fetch(BASE_URL, { signal: AbortSignal.timeout(1500) }).then(() => true).catch(() => false);
  if (stale) throw new Error(`A server already responds on ${BASE_URL}; stop it before rebuilding screenshots.`);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(ROOT_DIR, DIST_DIR), { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  await run(process.execPath, [path.join(ROOT_DIR, 'scripts/prepare-e2e-db.mjs')], { env: {
    ...process.env, MEDIFLOW_DATA_DIR: DATA_DIR, E2E_PIN: PIN, E2E_USERNAME: USERNAME,
    E2E_DISPLAY_NAME: 'Dott.ssa Demo Lume', E2E_AMBULATORY_NAME: 'Ambulatorio Demo Lume',
  } });

  const server = startServer();
  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: 'light' });
    const seedPage = await context.newPage();
    await unlock(seedPage);
    await seed(seedPage);
    await seedPage.close();

    const page = await context.newPage();
    await unlock(page);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await capture(page, '/?area=incarico', 'Fervi Giulia', '01-worklist.png');
    await capture(page, `/patients/${PATIENT_ID}/modules`, 'Scheda paziente', '02-scheda.png');
    await capture(page, `/?area=scheda&paziente=${PATIENT_ID}`, 'Quadro paziente', '03-quadro.png');
    await capture(page, `/?area=revisione&paziente=${PATIENT_ID}`, 'referto-cardiologico-sintetico.pdf', '04-review.png', false);
    await page.goto(`${BASE_URL}/settings/accesso`, { waitUntil: 'domcontentloaded' });
    await waitForScene(page, 'testid:settings-access-section');
    await page.getByRole('button', { name: 'Blocca sessione adesso' }).click();
    await waitForScene(page, 'Sblocca MediFlow');
    await page.screenshot({ path: path.join(OUTPUT_DIR, '05-security.png'), fullPage: false, animations: 'disabled' });
  } finally {
    await browser?.close();
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise((resolve) => server.once('exit', resolve));
    }
    fs.rmSync(path.join(ROOT_DIR, DIST_DIR), { recursive: true, force: true });
    if (fs.readFileSync(TSCONFIG_PATH, 'utf8') !== originalTsconfig) {
      fs.writeFileSync(TSCONFIG_PATH, originalTsconfig);
    }
  }
}

main().then(() => console.log(`Screenshots written to ${OUTPUT_DIR}`)).catch((error) => {
  console.error('[screenshots] Failed:', error);
  process.exitCode = 1;
});
