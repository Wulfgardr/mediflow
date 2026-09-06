/* @Codex WUL-674/673: browser states on synthetic configuration, no WHO egress. */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('function configuration is authenticated, complete and distinguishes failed reads from disabled functions', async ({ page, request }) => {
    expect((await request.get('/api/system/function-status')).status()).toBe(401);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await page.route('**/api/system/function-status', route => route.fulfill({ status: 503, json: { error: 'synthetic_unavailable' } }));
    await page.goto('/settings/ai/fabric');
    const panel = page.getByTestId('function-status-panel');
    await expect(panel.getByRole('alert')).toContainText('non significa che le funzioni siano spente');
    await expect(panel.locator('[data-testid^="function-state-"]')).toHaveCount(0);
    await page.unroute('**/api/system/function-status');
    await panel.getByRole('button', { name: 'Rileggi stato', exact: true }).click();
    await expect(panel).toContainText('Configurazione letta il');
    await expect(panel.locator('[data-testid^="function-state-"]')).toHaveCount(7);
    await expect(panel.getByTestId('function-state-patient_insight')).toContainText('Spenta');
    await expect(panel.getByTestId('function-state-document_ocr')).toContainText('Apple Vision');
    await expect(panel).toContainText('Nessun modello eseguito');
    const response = await page.request.get('/api/system/function-status?unexpected=1');
    expect(response.status()).toBe(400);
});

test('WHO verification is explicit and separates live, cache and failure without configuration writes', async ({ page }) => {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    let state = 'disabled';
    let result: 'live' | 'cache' | 'timeout' = 'live';
    let searches = 0;
    await page.route('**/api/icd/proxy*', route => {
        const url = new URL(route.request().url());
        expect(route.request().method()).toBe('GET');
        if (!url.searchParams.size) return route.fulfill({ status: state === 'available' ? 200 : 503,
            json: { schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1', status: state, releaseId: '2026-01', language: 'en' } });
        expect(url.searchParams.get('q')).toBe('cholera');
        searches++;
        if (result === 'timeout') return route.fulfill({ status: 504, json: { code: 'upstream_timeout' } });
        return route.fulfill({ status: 200, json: {
            schemaVersion: 'mediflow.reference-data.icd11-search-response.v1', entries: [{ code: '1A00', description: 'Cholera', system: 'ICD-11' }],
            receipt: { schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v1', operation: 'mediflow.reference_data.icd11.search.v1',
                releaseId: '2026-01', language: 'en', source: result, resultCount: 1, latencyMs: 12, completedAt: '2026-09-06T01:00:00.000Z' },
        } });
    });
    await page.goto('/settings/diagnostica');
    const panel = page.getByTestId('who-setup-panel');
    await expect(panel).toContainText('Servizio WHO ICD-11 disattivato');
    const verify = panel.getByRole('button', { name: 'Verifica con termine di esempio', exact: true });
    await expect(verify).toBeDisabled();
    expect(searches).toBe(0);
    state = 'configured';
    await panel.getByRole('button', { name: 'Rileggi configurazione', exact: true }).click();
    await expect(verify).toBeEnabled();
    expect(searches).toBe(0);
    await verify.click();
    await expect(panel.getByRole('status')).toContainText('Risposta WHO ricevuta');
    result = 'cache';
    await verify.click();
    await expect(panel.getByRole('status')).toContainText('non verifica la rete');
    result = 'timeout';
    await verify.click();
    await expect(panel.getByRole('alert')).toContainText('Verifica non riuscita');
    await expect(panel.getByRole('status')).toHaveCount(0);
    expect(searches).toBe(3);
    await panel.getByText('Configurazione sul server', { exact: true }).click();
    await expect(panel.locator('input, textarea')).toHaveCount(0);
    await expect(panel).toContainText('MEDIFLOW_ICD_WHO_CLIENT_SECRET');
});
