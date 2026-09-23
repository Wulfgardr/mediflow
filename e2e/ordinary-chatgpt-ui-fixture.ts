/* @Codex: HTTP-only synthetic ChatGPT transport for the four real clinical cards. */
import { expect, type Locator, type Page } from '@playwright/test';
import { ORDINARY_FLOW_SCHEMA, ORDINARY_SELECTION_SCHEMA, type OrdinaryFunction } from '../lib/chatgpt-product/ordinary-wire';

const IDS: OrdinaryFunction[] = ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'];
const MODEL = 'synthetic-current-model';
const OPTION = 'synthetic-option-medium';
const REVISION = `sha256_${'a'.repeat(64)}`;
const CATALOG = { revision: 'synthetic-process-catalog', choices: [{ optionId: OPTION, model: MODEL, effort: 'medium' }] };
export type WireFactory = () => unknown;

export function remoteMetadata(id: OrdinaryFunction) {
  const receipt = { schemaVersion: 'mediflow.ai.chatgpt-receipt.v1', capability: id, provider: 'chatgpt_subscription',
    venue: 'cloud', model: MODEL, effort: 'medium', egress: 'redacted_explicit_consent',
    retention: 'chatgpt_service_terms_apply', fallback: 'none', sourceSha256: `sha256_${'a'.repeat(64)}`,
    payloadSha256: 'b'.repeat(64), outputSha256: 'c'.repeat(64) };
  return { receipt, provenance: { schemaVersion: 'mediflow.ai.chatgpt-provenance.v1', capability: id,
    provider: receipt.provider, venue: receipt.venue, model: receipt.model,
    preprocessing: ['context_minimization', 'layer1_redaction', 'layer2_redaction', 'envelope_validation'], receipt } };
}

export async function installOrdinaryChatGptTransport(page: Page, id: OrdinaryFunction, wire: WireFactory) {
  let enabled = false;
  let phase: 'needs_consent' | 'consented' | 'awaiting_login' | 'connected' | 'ready' = 'needs_consent';
  const attemptId = `synthetic-${id}-attempt`;
  const operations: string[] = [];
  const previews: unknown[] = [];
  const clinicalWrites: string[] = [];
  const providerRequests: string[] = [];
  let recording = false;
  const state = () => ({ schema: ORDINARY_FLOW_SCHEMA, attemptId, functionId: id, phase, expiresAt: Date.now() + 120_000 });
  const settings = () => ({ schema: 'mediflow.chatgpt-ordinary-settings.v1', revision: REVISION, enabled,
    retention: 'chatgpt_service_terms_apply', preferences: Object.fromEntries(IDS.map(key => [key, { use: 'local', model: null, effort: null }])),
    lanes: Object.fromEntries(IDS.map(key => [key, 'enabled'])) });
  const disclosure = { schema: 'mediflow.chatgpt-ordinary-disclosure.v1', revision: 'synthetic-disclosure-current', operation: id,
    profileVersion: 'mediflow.ordinary-redacted-profile.v1', contextRevision: 'synthetic-host-context',
    attemptRevision: 'synthetic-host-attempt', qualificationRevision: 'synthetic-host-qualification',
    sourceSha256: `sha256_${'a'.repeat(64)}`, payloadSha256: 'b'.repeat(64), payloadBytes: 100,
    egress: ['auth.openai.com:443', 'chatgpt.com:443'], proposalOnly: true, clinicalWrites: 0 };
  page.on('request', request => {
    const url = new URL(request.url());
    if (['auth.openai.com', 'chatgpt.com'].includes(url.hostname)) providerRequests.push(url.hostname);
    if (!recording || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    const path = url.pathname;
    if (/^\/api\/(?:patients|entries|therapies|observations|attachments)(?:\/|$)/u.test(path)) clinicalWrites.push(`${request.method()} ${path}`);
  });
  const fulfill = (route: import('@playwright/test').Route, value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  await page.route('**/api/settings/ai/chatgpt/ordinary/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const operation = path.slice('/api/settings/ai/chatgpt/ordinary/'.length);
    operations.push(operation);
    if (operation === 'settings') return fulfill(route, settings());
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (operation === 'policy') {
      expect(body).toEqual({ expectedRevision: REVISION, enabled: true, retention: 'chatgpt_service_terms_apply' });
      enabled = true; return fulfill(route, settings());
    }
    expect(body.attemptId).toBe(attemptId);
    if (operation === 'consent') {
      expect(body.expectedDisclosureRevision).toBe(disclosure.revision); phase = 'consented'; return fulfill(route, state());
    }
    if (operation === 'login/start') {
      phase = 'awaiting_login'; return fulfill(route, { ...state(), challenge: { verificationUrl: 'https://auth.openai.com/device', userCode: 'SYNTHETIC-ONLY' } });
    }
    if (operation === 'login/complete') { phase = 'connected'; return fulfill(route, state()); }
    if (operation === 'models') { phase = 'ready'; return fulfill(route, { ...state(), catalog: CATALOG }); }
    if (operation === 'generate') {
      expect(body).toEqual({ attemptId, modelOptionId: OPTION, expectedCatalogRevision: CATALOG.revision });
      return fulfill(route, wire());
    }
    if (operation === 'cancel') return fulfill(route, { schema: ORDINARY_FLOW_SCHEMA, phase: 'closed', cleanupConfirmed: true });
    throw new Error(`Unexpected synthetic ordinary operation: ${operation}`);
  });
  await page.route(`**/api/ai/${id.replaceAll('_', '-')}/preview`, async route => {
    expect(route.request().method()).toBe('POST');
    expect(JSON.parse(route.request().headers()['x-mediflow-function-model'] ?? 'null')).toEqual({
      schema: ORDINARY_SELECTION_SCHEMA, expectedPreferenceRevision: REVISION,
    });
    previews.push(route.request().postDataJSON());
    return fulfill(route, { ...state(), disclosure }, 202);
  });
  return { operations, previews, clinicalWrites, arm: () => { recording = true; },
    assertCompleted: () => {
      expect(previews).toHaveLength(1);
      expect(operations.filter(value => ['consent', 'login/start', 'login/complete', 'models', 'generate'].includes(value))).toEqual([
        'consent', 'login/start', 'login/complete', 'models', 'generate',
      ]);
      expect(operations).toContain('policy');
      expect(operations.filter(value => value === 'generate')).toHaveLength(1);
      expect(clinicalWrites).toEqual([]);
      expect(providerRequests).toEqual([]);
    } };
}

export async function selectOrdinaryChatGpt(scope: Locator) {
  await scope.getByRole('combobox', { name: 'Modello per questa proposta' }).selectOption('chatgpt_subscription');
  const controls = scope.getByRole('group', { name: 'OpenAI per questa proposta' });
  await expect(controls.getByRole('checkbox', { name: /Consenti OpenAI/u })).toBeVisible();
  await controls.getByRole('checkbox', { name: /Consenti OpenAI/u }).click();
  await expect(controls.getByRole('checkbox', { name: /Consenti OpenAI/u })).toBeChecked();
  await expect(controls).toContainText('Usa l’azione di proposta della funzione');
  return controls;
}

export async function finishOrdinaryChatGpt(controls: Locator) {
  await expect(controls).toContainText('Contesto preparato e redatto: 100 byte.');
  await controls.getByRole('button', { name: 'Consenti per questo contesto' }).click();
  await controls.getByRole('button', { name: 'Avvia accesso dedicato ChatGPT' }).click();
  await expect(controls).toContainText('SYNTHETIC-ONLY');
  // The official URL is fixture data only: never open the link or authenticate.
  await controls.getByRole('button', { name: 'Ho completato: verifica accesso' }).click();
  await controls.getByRole('button', { name: 'Leggi catalogo di questo processo' }).click();
  await controls.getByRole('combobox', { name: 'Modello e ragionamento correnti' }).selectOption(OPTION);
  await controls.getByRole('button', { name: 'Genera questa proposta' }).click();
}
