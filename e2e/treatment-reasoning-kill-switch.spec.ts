import { expect, test } from '@playwright/test';
import { openTreatmentReasoningDenial } from './fixtures/treatment-reasoning-denial';
import { bootstrapUnlockedSession, openAiFunzioniSettings } from './utils';

for (const value of ['enabled', 'disabled'] as const) test(`Treatment Reasoning: diniego con valore salvato ${value}`, async ({ page }) => {
  await page.route('**/api/ai/models', route => route.fulfill({ json: { models: [] } }));
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await openAiFunzioniSettings(page);
  const run = await openTreatmentReasoningDenial(page, value);
  try {
    await openAiFunzioniSettings(page);
    const preferences = page.getByTestId('function-preferences');
    await expect(preferences).toContainText('Non disponibile in questa versione');
    await expect(preferences.getByRole('switch', { name: 'Ragionamento terapeutico nella proposta' })).toHaveCount(0);
    const denied = await page.request.post('/api/settings', { data: { key: 'aiTreatmentReasoningKillSwitch', value: value === 'enabled' ? 'disabled' : 'enabled' } });
    expect(denied.status()).toBe(403);
    await run.assertNoEffects();
    expect((await (await page.request.get('/api/settings/aiTreatmentReasoningKillSwitch')).json()).value).toBe(value);
  } finally { run.restore(); }
});
