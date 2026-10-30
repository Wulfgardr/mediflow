import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection, setAiLaneKillSwitch } from './utils';

test.describe.configure({ retries: 0 });
test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || new URL(baseURL).port === '3000') throw new Error('Usare un server sintetico isolato fuori dalla porta 3000');
  if (process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY !== '1') throw new Error('La copia legacy deve essere disabilitata');
});

test('I-1 Web: crea e rilegge una scheda con tutte le funzioni AI spente', async ({ page, baseURL }) => {
  const unexpectedRequests: string[] = [];
  await page.context().route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL!).origin && ['http:', 'https:'].includes(url.protocol)) {
      unexpectedRequests.push(url.origin);
      await route.abort();
      return;
    }
    if (/\/api\/ai\/.*\/preview$|\/api\/proxy\/ollama\/(chat|generate)$/.test(url.pathname)) {
      unexpectedRequests.push(url.pathname);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  for (const key of ['aiPatientInsightKillSwitch', 'aiSmartImportKillSwitch', 'aiDocumentSynthesisKillSwitch', 'aiTreatmentReasoningKillSwitch'] as const) {
    await setAiLaneKillSwitch(page, key, 'disabled');
  }
  const id = await page.evaluate(async () => {
    const response = await fetch('/api/patients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Locale', lastName: 'Sintetico', taxCode: `LOCAL${Date.now()}`, address: 'Via Sintetica 1', phone: '0000000000' }),
    });
    if (!response.ok) throw new Error(`Creazione: ${response.status}`);
    return (await response.json()).id as string;
  });
  await page.goto(`/patients/${id}/modules`);
  await openPatientSection(page, 'attenzione');
  const disclosure = page.locator('#patient-insight').locator(':scope > div > [data-disclosure-control]');
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
  await expect(page.getByTestId('patient-insight-disabled-card')).toBeVisible();
  const response = await page.request.get(`/api/patients/${id}`);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain(id);
  expect(unexpectedRequests).toEqual([]);
});
