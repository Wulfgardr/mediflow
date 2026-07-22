/* @Codex */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Module from 'node:module';
import test from 'node:test';

/* @Codex: registerHooks esiste dal runtime Node 24 ma non ancora nei tipi del
   repo; stesso idioma di cast usato in lib/ai-context.test.ts per _resolveFilename. */
type SyncModuleHooks = {
  resolve?: (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
  load?: (url: string, context: unknown, nextLoad: (url: string, context: unknown) => unknown) => unknown;
};
const { registerHooks } = Module as unknown as { registerHooks: (hooks: SyncModuleHooks) => void };

const cockpitSourceUrl = new URL('./cockpit-shared.tsx', import.meta.url);
const cockpitCssUrl = new URL('./kree8-clinical-cockpit-foundation.module.css', import.meta.url);

/* WUL-362 C1: per esercitare le funzioni dati di cockpit-shared.tsx sotto
   node:test serve uno stub locale dei CSS module, che il loader strip-types
   non gestisce. Lo hook e limitato ai soli import *.module.css. */
const cssModuleStubUrl = 'data:text/javascript,mediflow-css-module-stub';
registerHooks({
  resolve(specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) {
    if (specifier.endsWith('.module.css')) {
      return { shortCircuit: true, url: cssModuleStubUrl };
    }
    return nextResolve(specifier, context);
  },
  load(url: string, context: unknown, nextLoad: (url: string, context: unknown) => unknown) {
    if (url === cssModuleStubUrl) {
      return {
        format: 'commonjs',
        shortCircuit: true,
        source: 'module.exports = new Proxy({}, { get: (_target, prop) => String(prop) });',
      };
    }
    return nextLoad(url, context);
  },
});

test('la pillola condivisa non neutralizza i quattro segnali Lume', async () => {
  const source = await readFile(cockpitSourceUrl, 'utf8');

  assert.match(source, /success:\s*styles\.pillSuccess/);
  assert.match(source, /warning:\s*styles\.pillWarning/);
  assert.match(source, /critical:\s*styles\.pillCritical/);
  assert.match(source, /plum:\s*styles\.pillPlum/);
});

test('le pillole di segnale usano la ricetta 60 testo, 11 fondo, 30 bordo', async () => {
  const css = await readFile(cockpitCssUrl, 'utf8');

  for (const [className, signal] of [
    ['pillSuccess', 'success'],
    ['pillWarning', 'warning'],
    ['pillCritical', 'critical'],
    ['pillPlum', 'plum'],
  ]) {
    const rule = new RegExp(
      `\\.${className}\\s*\\{[^}]*${signal}\\) 11%[^}]*${signal}\\) 60%[^}]*${signal}\\) 30%`,
      's',
    );
    assert.match(css, rule);
  }
});

/* WUL-362 C1: il candidato AI del riquadro paziente passa dal view-model
   canonico del Patient Insight. Wrong-task, envelope invalidi e risultati
   unknown/unreadable non devono mai apparire come riepilogo clinico; i
   fallback non-AI (note, statusReason) restano invariati. */

const WRONG_TASK_AI_SUMMARY = JSON.stringify({
  schemaVersion: 'mediflow.ai.extract.v1',
  task: 'smart_import',
  summary: 'Suggerimenti di import non clinici da non mostrare',
  data: { diagnoses: [], therapies: [], servicePrescriptions: [] },
});

const WRAPPED_WRONG_TASK_AI_SUMMARY = JSON.stringify({
  role: 'assistant',
  content: '{"schemaVersion":"mediflow.ai.extract.v1","task":"smart_import","summary":"Wrapper con task errato da non mostrare"}',
});

const VALID_INSIGHT_AI_SUMMARY = JSON.stringify({
  schemaVersion: 'mediflow.ai.extract.v1',
  task: 'patient_insight',
  summary: 'Quadro clinico stabile in follow-up.',
  data: {
    currentState: ['Paziente stabile in follow-up territoriale.'],
    alerts: ['Controllo pressorio domiciliare da programmare.'],
    nextSteps: [],
    gaps: [],
  },
});

type CockpitSharedModule = {
  buildPatientPreviewSummary: (
    patient: Record<string, unknown>,
    isArchived: boolean,
    isAdi: boolean,
  ) => string;
};

async function loadCockpitShared(): Promise<CockpitSharedModule> {
  return await import('./cockpit-shared') as unknown as CockpitSharedModule;
}

test('cockpit: un envelope wrong-task non appare mai come riepilogo clinico', async () => {
  const { buildPatientPreviewSummary } = await loadCockpitShared();
  const summary = buildPatientPreviewSummary(
    { id: 'patient-c1', aiSummary: WRONG_TASK_AI_SUMMARY },
    false,
    false,
  );

  assert.doesNotMatch(summary, /Suggerimenti di import non clinici/);
  assert.equal(summary, 'Nessuna sintesi clinica disponibile.');
});

test('cockpit: un envelope wrong-task incapsulato in un wrapper provider resta fuori dal riepilogo', async () => {
  const { buildPatientPreviewSummary } = await loadCockpitShared();
  const summary = buildPatientPreviewSummary(
    { id: 'patient-c1', aiSummary: WRAPPED_WRONG_TASK_AI_SUMMARY },
    false,
    false,
  );

  assert.doesNotMatch(summary, /Wrapper con task errato/);
});

test('cockpit: un envelope patient_insight valido rende il quadro canonico del view-model', async () => {
  const { buildPatientPreviewSummary } = await loadCockpitShared();
  const summary = buildPatientPreviewSummary(
    { id: 'patient-c1', aiSummary: VALID_INSIGHT_AI_SUMMARY },
    false,
    false,
  );

  assert.match(summary, /Paziente stabile in follow-up territoriale/);
});

test('cockpit: con aiSummary illeggibile il fallback non-AI sulle note resta attivo', async () => {
  const { buildPatientPreviewSummary } = await loadCockpitShared();
  const summary = buildPatientPreviewSummary(
    {
      id: 'patient-c1',
      aiSummary: WRONG_TASK_AI_SUMMARY,
      notes: 'Percorso ADI attivo con medicazioni bisettimanali.',
    },
    false,
    false,
  );

  assert.match(summary, /Percorso ADI attivo con medicazioni bisettimanali/);
});

test('cockpit: un aiSummary markdown legacy leggibile resta visibile', async () => {
  const { buildPatientPreviewSummary } = await loadCockpitShared();
  const summary = buildPatientPreviewSummary(
    { id: 'patient-c1', aiSummary: '**Quadro attuale:** paziente in follow-up territoriale [S1].' },
    false,
    false,
  );

  assert.match(summary, /paziente in follow-up territoriale/);
});
