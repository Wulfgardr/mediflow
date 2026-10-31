import { test } from '@playwright/test';
import { openTreatmentReasoningDenial } from './fixtures/treatment-reasoning-denial';

test('Treatment Reasoning Fabric: archivio enabled mostra il diniego senza provider o scritture', async ({ page }) => {
  const run = await openTreatmentReasoningDenial(page);
  try {
    await run.proposals.click();
    await run.proposals.click();
    await run.assertDenied();
    await page.reload();
    await page.locator('#terapie').getByRole('button', { name: 'Proposte', exact: true }).click();
    await run.assertDenied();
  } finally { run.restore(); }
});
