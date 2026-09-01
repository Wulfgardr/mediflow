/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, setAiLaneKillSwitch } from './utils';

type PatientInsightPreviewRequest = {
  schemaVersion: 'mediflow.patient-insight.preview-request.v1';
  requestId: string;
  patientId: string;
  ambulatoryId: string;
  patientRevision: number;
  capturedAt: string;
  sources: {
    focus: { summary: string };
    conditions: Array<{ label: string }>;
    activeTherapies: Array<{ label: string }>;
    recentEvents: Array<{ summary: string }>;
  };
};

const MODEL = 'synthetic-patient-insight:latest';
const REVIEW_REF = `review_${'b'.repeat(32)}`;

async function createSyntheticPatient(page: Page): Promise<string> {
  return await page.evaluate(async (taxCode: string) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Fabric',
        lastName: 'Review',
        taxCode,
        birthDate: '1980-01-01T00:00:00.000Z',
        address: 'Via Sintetica 1',
        phone: '0000000000',
      }),
    });
    const payload = await response.json() as { id?: string; error?: string };
    if (!response.ok || !payload.id) {
      throw new Error(payload.error || `Patient creation failed with HTTP ${response.status}`);
    }
    return payload.id;
  }, `PIFABRIC${Date.now()}`);
}

function availablePreview(request: PatientInsightPreviewRequest) {
  return {
    preview: {
      writesPerformed: 0,
      apply: 'denied',
      status: 'available',
      code: null,
      proposal: {
        schemaVersion: 'mediflow.patient-insight.review-proposal.v2',
        reviewOnly: true,
        summary: 'Sintesi Patient Insight sintetica da revisionare. [S1]',
        currentState: ['Quadro sintetico stabile da verificare. [S1]'],
        alerts: ['Attenzione sintetica da confermare. [S1]'],
        nextSteps: ['Rivedere la fonte sintetica durante il follow-up. [S1]'],
        gaps: ['Dato sintetico ancora da integrare.'],
        generatedAt: request.capturedAt,
        currentness: {
          selectionEpoch: 7,
          patientRevision: request.patientRevision,
          projectionDigest: `sha256_${'a'.repeat(64)}`,
          capturedAt: request.capturedAt,
          verifiedAt: request.capturedAt,
        },
      },
      receipt: {
        schemaVersion: 'mediflow.ai.fabric-resolution.v1',
        capability: 'patient_insight',
        venue: 'local_process',
        provider: 'ollama',
        model: MODEL,
        egress: 'none',
      },
      provenance: {
        schemaVersion: 'mediflow.ai.fabric-provenance.v1',
        capability: 'patient_insight',
        venue: 'local_process',
        provider: 'ollama',
        model: MODEL,
        preprocessing: ['context_minimization', 'envelope_validation'],
      },
      reviewRef: REVIEW_REF,
    },
  };
}

test.describe.configure({ retries: 0 });

test('Patient Insight Fabric mostra una proposta review-only senza authority del chiamante', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  let previewCalls = 0;
  let capturedRequest: PatientInsightPreviewRequest | null = null;
  let generationStarted = false;
  const forbiddenClinicalWrites: string[] = [];

  page.on('request', (request) => {
    if (!generationStarted || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    const pathname = new URL(request.url()).pathname;
    if (/^\/api\/(?:patients|entries|therapies|observations|attachments|checkups)(?:\/|$)/u.test(pathname)) {
      forbiddenClinicalWrites.push(`${request.method()} ${pathname}`);
    }
  });

  await bootstrapUnlockedSession(page, pin);
  await setAiLaneKillSwitch(page, 'aiPatientInsightKillSwitch', 'enabled');
  const patientId = await createSyntheticPatient(page);

  await page.route('**/api/ai/patient-insight/preview', async (route) => {
    previewCalls += 1;
    capturedRequest = route.request().postDataJSON() as PatientInsightPreviewRequest;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(availablePreview(capturedRequest)),
    });
  });

  await page.goto(`/patients/${patientId}/modules#documenti`);
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules#documenti$`));
  const documents = page.getByRole('button', { name: /Documenti Archivio documenti ed evidenze/u });
  await expect(documents).toBeVisible();
  await expect(documents).toHaveAttribute('aria-expanded', 'true');
  generationStarted = true;
  await page.getByRole('button', { name: 'Avvia supporto' }).click();

  const proposal = page.getByTestId('patient-insight-review-proposal');
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText('Bozza da revisionare');
  await expect(proposal).toContainText('0 scritture');
  await expect(proposal).toContainText('Applicazione non consentita');
  await expect(proposal).toContainText('Sintesi Patient Insight sintetica da revisionare. [S1]');
  await expect(proposal).toContainText('Receipt, provenance e currentness');
  await expect(proposal).toContainText(`ollama · ${MODEL} · local_process · egress none`);
  await expect(proposal).toContainText('context_minimization → envelope_validation');
  await expect(proposal).toContainText('epoch 7 · revisione 1');

  expect(previewCalls).toBe(1);
  expect(capturedRequest).not.toBeNull();
  expect(Object.keys(capturedRequest!)).toEqual([
    'schemaVersion', 'requestId', 'patientId', 'ambulatoryId', 'patientRevision', 'capturedAt', 'sources',
  ]);
  expect(capturedRequest).toMatchObject({
    schemaVersion: 'mediflow.patient-insight.preview-request.v1',
    patientId,
    patientRevision: 1,
    sources: {
      focus: { summary: 'Valutazione manuale del follow-up clinico attuale' },
      conditions: [],
      activeTherapies: [],
      recentEvents: [],
    },
  });
  expect(capturedRequest!.requestId).toMatch(/^pi_[0-9a-f-]{36}$/u);
  expect(capturedRequest!.ambulatoryId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
  expect(new Date(capturedRequest!.capturedAt).toISOString()).toBe(capturedRequest!.capturedAt);
  expect(JSON.stringify(capturedRequest)).not.toMatch(/"(?:provider|model|endpoint|apply)"\s*:/u);
  expect(forbiddenClinicalWrites).toEqual([]);
});
