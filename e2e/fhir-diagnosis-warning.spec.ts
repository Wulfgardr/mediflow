/* @Codex WUL-457: exact-string legacy systems only, not malformed-record normalization. */
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test.describe.configure({ retries: 0 });
test.beforeEach(async ({ baseURL }) => {
  if (process.env.MF085_SYNTHETIC_E2E !== '1') throw new Error('Explicit isolated synthetic E2E runtime required');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL ?? 'http://invalid').hostname)) {
    throw new Error('Local isolated E2E host required');
  }
});

const PATIENT_ID = '10000000-0000-4000-8000-000000000081';
const DATE = '2026-07-20T10:30:00.000Z';
const DIAGNOSES = [
  { id: 'synthetic-unknown', system: 'SNOMED-CT', code: 'SYN-UNKNOWN', description: 'Diagnosi sintetica sconosciuta', date: DATE },
  { system: '', code: 'SYN-BLANK', description: 'Diagnosi sintetica senza sistema', date: DATE },
  { id: 'synthetic-known', system: 'ICD-10', code: 'SYN-EXACT', description: 'Diagnosi sintetica riconosciuta', date: DATE },
];
type EntryPoint = 'edit-download' | 'modules-download' | 'modules-share';
type Effects = {
  blobs: number; files: number; objectUrls: number;
  downloads: string[]; shares: string[]; payloads: string[];
};

async function fixture(page: Page, entry: EntryPoint) {
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', {
    configurable: true, value: (data: ShareData) => data.files?.length === 1,
  }));
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = {
    id: PATIENT_ID, version: 1, firstName: 'Diagnosi', lastName: 'Sintetico',
    taxCode: 'SYNTHETIC0000081', birthDate: '1980-01-01T00:00:00.000Z',
    address: '', phone: '', monitoringProfile: 'taken_in_charge',
    diagnoses: DIAGNOSES, createdAt: DATE, updatedAt: DATE,
  };
  await page.route(/\/api\/patients(\/|\?|$)/, route => {
    const request = route.request();
    if (request.method() !== 'GET') throw new Error('This export fixture permits no patient writes');
    const path = new URL(request.url()).pathname;
    return route.fulfill({ json: path === `/api/patients/${PATIENT_ID}` ? patient : [patient] });
  });
  await page.route('**/api/fse/validate-patient?*', route => {
    const summary = { total: 0, ok: 0, withErrors: 0, withWarnings: 0, errorCount: 0, warningCount: 0, items: [] };
    return route.fulfill({ json: {
      patientId: PATIENT_ID, hasErrors: false, hasWarnings: false,
      therapyMedication: summary, observationVitals: summary,
    } });
  });
  await page.goto(`/patients/${PATIENT_ID}/${entry === 'edit-download' ? 'edit' : 'modules'}`);
  await expect(page).toHaveTitle(/MediFlow/);
  if (entry === 'edit-download') {
    await expect(page.getByTestId('lume-workspace-patient-label')).toContainText('Sintetico Diagnosi');
    await expect(page.locator('input[name="firstName"]')).toHaveValue('Diagnosi');
  } else {
    await expect(page.getByRole('heading', { name: 'Sintetico Diagnosi', exact: true, level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Azioni', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Condividi FHIR', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Azioni', exact: true }).click();
  }
  // Install after the modules capability probe, so unrelated startup File creation is excluded.
  await page.evaluate(() => {
    const effects: Effects = { blobs: 0, files: 0, objectUrls: 0, downloads: [], shares: [], payloads: [] };
    (window as Window & { __fhirEffects?: Effects }).__fhirEffects = effects;
    window.Blob = new Proxy(window.Blob, {
      construct(target, args, newTarget) { effects.blobs++; return Reflect.construct(target, args, newTarget); },
    });
    window.File = new Proxy(window.File, {
      construct(target, args, newTarget) { effects.files++; return Reflect.construct(target, args, newTarget); },
    });
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      effects.objectUrls++;
      if (blob instanceof Blob) void blob.text().then(text => effects.payloads.push(text));
      return createObjectURL(blob);
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) effects.downloads.push(this.download);
      click.call(this);
    };
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      const file = data.files?.[0];
      if (!file) throw new Error('Expected one synthetic FHIR file');
      effects.shares.push(file.name);
      effects.payloads.push(await file.text());
    } });
  });
}

async function effects(page: Page): Promise<Effects> {
  return page.evaluate(() => (window as Window & { __fhirEffects?: Effects }).__fhirEffects!);
}

async function openWarning(page: Page, entry: EntryPoint) {
  if (entry !== 'edit-download') await page.getByRole('button', { name: 'Azioni', exact: true }).click();
  await page.getByRole('button', { name: entry === 'modules-share' ? 'Condividi FHIR' : 'Esporta FHIR', exact: true }).click();
  if (entry !== 'modules-share') {
    await page.getByRole('dialog', { name: 'Esporta FHIR con controllo FSE', exact: true })
      .getByRole('button', { name: 'Scarica FHIR JSON', exact: true }).click();
  }
  const warning = page.getByRole('dialog', { name: 'Diagnosi esportate senza codifica', exact: true });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('2 diagnosi hanno un sistema di codifica non riconosciuto o vuoto.');
  await expect(warning).toContainText('Il file conserverà la descrizione di queste diagnosi senza la codifica.');
  await expect(warning).not.toContainText(DIAGNOSES[0].description);
  return warning;
}

function assertPayload(payload: string) {
  const bundle = JSON.parse(payload);
  expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'collection' });
  const conditions = bundle.entry.map((entry: { resource: Record<string, unknown> }) => entry.resource)
    .filter((resource: { resourceType: string }) => resource.resourceType === 'Condition');
  expect(conditions).toHaveLength(3);
  expect(conditions[0].code).toEqual({ text: DIAGNOSES[0].description });
  expect(conditions[1].code).toEqual({ text: DIAGNOSES[1].description });
  expect(conditions[2].code).toEqual({
    text: DIAGNOSES[2].description,
    coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: DIAGNOSES[2].code, display: DIAGNOSES[2].description }],
  });
  for (const condition of conditions) {
    expect(condition.onsetDateTime).toBe(DATE);
    expect(condition.subject.reference).toBe(bundle.entry[0].fullUrl);
  }
  expect(conditions[0].id).toBe('synthetic-unknown');
  expect(conditions[2].id).toBe('synthetic-known');
  expect(payload).not.toContain('http://id.who.int/icd/release/11/mms');
}

for (const entry of ['edit-download', 'modules-download', 'modules-share'] as const) {
  test(`${entry}: repeated cancellation creates no export; acceptance preserves text without fabricated coding`, async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await fixture(page, entry);
    let downloads = 0;
    page.on('download', () => downloads++);
    for (const [iteration, accept] of [false, true, false, true].entries()) {
      const before = await effects(page);
      const previousDownloads = downloads;
      const warning = await openWarning(page, entry);
      expect(await effects(page)).toEqual(before); // Preparation has no artifact side effect.
      if (iteration === 0) await page.screenshot({ path: testInfo.outputPath(`${entry}-warning.png`) });
      const download = accept && entry !== 'modules-share' ? page.waitForEvent('download') : null;
      await warning.getByRole('button', { name: accept ? 'Esporta comunque' : 'Annulla', exact: true }).click();
      await expect(warning).toBeHidden();
      if (entry !== 'modules-share') {
        await expect(page.getByRole('dialog', { name: 'Esporta FHIR con controllo FSE', exact: true })).toBeHidden();
      }
      if (!accept) {
        // Let the async consumer settle; then reopening above also proves cancellation is repeatable.
        await page.waitForTimeout(200);
        expect(await effects(page)).toEqual(before);
        expect(downloads).toBe(previousDownloads);
        continue;
      }
      if (download) {
        const received = await download;
        expect(received.suggestedFilename()).toBe('patient-Sintetico-Diagnosi-fhir.json');
        expect(await received.failure()).toBeNull();
      }
      await expect.poll(async () => (await effects(page)).payloads.length).toBe(before.payloads.length + 1);
      const after = await effects(page);
      expect(after.blobs - before.blobs).toBe(entry === 'edit-download' ? 1 : 0);
      expect(after.files - before.files).toBe(entry === 'edit-download' ? 0 : 1);
      expect(after.objectUrls - before.objectUrls).toBe(entry === 'modules-share' ? 0 : 1);
      expect(after.downloads.length - before.downloads.length).toBe(entry === 'modules-share' ? 0 : 1);
      expect(after.shares.length - before.shares.length).toBe(entry === 'modules-share' ? 1 : 0);
      expect(downloads - previousDownloads).toBe(entry === 'modules-share' ? 0 : 1);
      assertPayload(after.payloads.at(-1)!);
    }
    expect(pageErrors).toEqual([]);
    await expect(page.getByText(/Errore durante (l'esportazione|la condivisione)/)).toHaveCount(0);
  });
}
