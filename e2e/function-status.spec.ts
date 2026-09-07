/* @Codex WUL-674/673: browser states on synthetic configuration, no WHO egress. */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';
import { WHO_LOCAL_BINDING_ID } from '../lib/reference-data/icd11-who-local-contract';
import { FUNCTION_IDS } from '../lib/function-status';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
    await expect(panel.locator('[data-testid^="function-state-"]')).toHaveCount(6);
    await expect(panel.getByTestId('function-state-icd11')).toHaveCount(0);
    const completeStatus = await page.request.get('/api/system/function-status');
    expect(completeStatus.status()).toBe(200);
    expect((await completeStatus.json()).functions.map((row: { id: string }) => row.id)).toEqual(FUNCTION_IDS);
    await expect(panel.getByTestId('function-state-patient_insight')).toContainText('Spenta');
    await expect(panel.getByTestId('function-state-document_ocr')).toContainText('Apple Vision');
    await expect(panel).toContainText('Nessun modello eseguito');
    const response = await page.request.get('/api/system/function-status?unexpected=1');
    expect(response.status()).toBe(400);
});

test('WHO local verification is explicit and separates direct response, cache and failure without configuration writes', async ({ page }) => {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    let state = 'disabled';
    let result: 'live' | 'cache' | 'timeout' = 'live';
    let searches = 0;
    let lastLiveObservedAt: string | null = null;
    const binding = { deployment: 'local', bindingId: WHO_LOCAL_BINDING_ID,
        imageDigest: `sha256:${'a'.repeat(64)}`, datasetSnapshotId: `sha256:${'b'.repeat(64)}` }; // synthetic, not artifact locks
    await page.route('**/api/icd/proxy*', route => {
        const url = new URL(route.request().url());
        expect(route.request().method()).toBe('GET');
        if (!url.searchParams.size) return route.fulfill({ status: state === 'available' ? 200 : 503,
            json: { schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v2', status: state, releaseId: '2026-01', language: 'en',
                ...binding, lastLiveObservedAt, lastResultSource: lastLiveObservedAt ? result === 'cache' ? 'cache' : 'live' : null } });
        expect(url.searchParams.get('q')).toBe('cholera');
        searches++;
        if (result === 'timeout') return route.fulfill({ status: 504, json: { code: 'upstream_timeout' } });
        state = 'available';
        if (result === 'live') lastLiveObservedAt = '2026-09-06T01:00:00.000Z';
        return route.fulfill({ status: 200, json: {
            schemaVersion: 'mediflow.reference-data.icd11-search-response.v2', partial: false,
            entries: [{ code: 'AA00', description: 'Synthetic terminology fixture', system: 'ICD-11',
                canonicalUri: 'http:' + '//id.who.int/icd/release/11/2026-01/mms/1000000001' }],
            receipt: { schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v2', operation: 'mediflow.reference_data.icd11.search.v2',
                releaseId: '2026-01', language: 'en', ...binding, source: result, resultCount: 1, latencyMs: 12,
                fetchedAt: '2026-09-06T01:00:00.000Z', expiresAt: '2026-09-07T01:00:00.000Z', completedAt: '2026-09-06T01:00:00.000Z' },
        } });
    });
    await page.goto('/settings/repertori#who-setup');
    const panel = page.getByTestId('who-setup-panel');
    await expect(panel).toContainText('Servizio WHO ICD-11 disattivato');
    const verify = panel.getByRole('button', { name: 'Verifica con termine di esempio', exact: true });
    await expect(verify).toBeDisabled();
    expect(searches).toBe(0);
    state = 'configuration_required';
    await panel.getByRole('button', { name: 'Rileggi configurazione', exact: true }).click();
    await expect(panel).toContainText('Completa il provisioning');
    await expect(verify).toBeDisabled();
    state = 'configured';
    await panel.getByRole('button', { name: 'Rileggi configurazione', exact: true }).click();
    await expect(verify).toBeEnabled();
    expect(searches).toBe(0);
    await verify.click();
    await expect(panel.getByRole('status')).toContainText('Risposta dal servizio WHO locale');
    await expect(panel).toContainText('Ultima risposta diretta:');
    result = 'cache';
    await verify.click();
    await expect(panel.getByRole('status')).toContainText('non verifica il servizio corrente');
    result = 'timeout';
    await verify.click();
    await expect(panel.getByRole('alert')).toContainText('Verifica non riuscita');
    await expect(panel.getByRole('status')).toHaveCount(0);
    expect(searches).toBe(3);
    await panel.getByText('Per chi gestisce il server', { exact: true }).click();
    await expect(panel.getByTestId('who-local-setup-guide').locator('input, textarea')).toHaveCount(0);
    await expect(panel).toContainText('MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST');
    await expect(panel).not.toContainText('MEDIFLOW_ICD_WHO_CLIENT_SECRET');
});

test('WHO selection survives real encrypted patient create/update/read and unrelated edit in the isolated fixture DB', async ({ page, baseURL }) => {
    // This test writes only the marked temporary database prepared by the E2E runner.
    const dataDir = process.env.MEDIFLOW_DATA_DIR;
    if (!dataDir || !path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep)
        || !readFileSync(path.join(dataDir, 'SYNTHETIC_ONLY'), 'utf8').includes('WHO local sidecar')
        || process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY !== '1'
        || !['localhost', '127.0.0.1'].includes(new URL(baseURL!).hostname)) throw new Error('Marked isolated WHO E2E database required');
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    let canonicalUri = 'http:' + '//id.who.int/icd/release/11/2026-01/mms/1000000001';
    let code = 'AA00', title = 'Synthetic WHO selection', query = 'synthetic';
    const reference = { releaseId: '2026-01', language: 'en', bindingId: WHO_LOCAL_BINDING_ID,
        imageDigest: `sha256:${'a'.repeat(64)}`, datasetSnapshotId: `sha256:${'b'.repeat(64)}` };
    let searches = 0;
    await page.route('**/api/icd/proxy*', route => {
        searches++;
        expect(new URL(route.request().url()).searchParams.get('q')).toBe(query);
        return route.fulfill({ json: { schemaVersion: 'mediflow.reference-data.icd11-search-response.v2', partial: true,
            entries: [{ code, description: title, system: 'ICD-11', canonicalUri }],
            receipt: { schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v2', operation: 'mediflow.reference_data.icd11.search.v2',
                ...reference, deployment: 'local', source: 'live', resultCount: 1, latencyMs: 1,
                fetchedAt: '2026-09-06T01:00:00.000Z', completedAt: '2026-09-06T01:00:00.000Z', expiresAt: '2026-09-07T01:00:00.000Z' } } });
    });
    await page.goto('/patients/new');
    await page.locator('input[name="firstName"]').fill('Sintetico');
    await page.locator('input[name="lastName"]').fill('WhoSidecar');
    await page.locator('input[name="taxCode"]').fill('WHOTEST000000001');
    await page.locator('input[name="birthDate"]').fill('1980-01-01');
    await page.getByRole('button', { name: 'Aggiungi diagnosi', exact: true }).click();
    await page.getByPlaceholder('Cerca diagnosi (ICD-11 Official - English)').fill(query);
    await page.getByText('Fonte e riferimenti WHO', { exact: true }).click();
    await expect(page.getByText('Risultati parziali: affina il termine di ricerca.', { exact: true })).toBeVisible();
    await page.getByRole('option', { name: /Synthetic WHO selection/u }).click();
    await expect(page.locator('input[name="diagnoses.0.code"]')).toHaveValue('AA00');
    await expect(page.locator('input[name="diagnoses.0.code"]')).toHaveAttribute('readonly', '');
    const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/patients');
    await page.getByRole('button', { name: 'Crea scheda', exact: true }).click();
    const created = await createdResponse;
    expect(created.ok()).toBe(true);
    const written = created.request().postDataJSON();
    expect(written.diagnoses).toMatch(/^ENC:/u);
    expect(written.diagnoses).not.toContain(canonicalUri);
    const patientId = written.id as string;
    await expect(page).toHaveURL(new URL('/', baseURL!).href);
    const assertReread = async () => {
        await page.goto(`/patients/${patientId}/edit`);
        await expect(page.locator('input[name="diagnoses.0.code"]')).toHaveValue(code);
        await expect(page.locator('input[name="diagnoses.0.description"]')).toHaveValue(title);
        await page.getByText('Riferimento della selezione WHO', { exact: true }).click();
        await expect(page.getByText(canonicalUri, { exact: true })).toBeVisible();
    };
    await assertReread();
    canonicalUri = canonicalUri.slice(0, -1) + '2';
    code = 'AA01'; title = 'Synthetic WHO replacement'; query = 'synthetic replacement';
    await page.getByPlaceholder('Cerca diagnosi (ICD-11 Official - English)').fill(query);
    await page.getByRole('option', { name: /Synthetic WHO replacement/u }).click();
    const replacedResponse = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/patients/${patientId}`);
    await page.getByRole('button', { name: 'Aggiorna scheda', exact: true }).click();
    const replaced = await replacedResponse;
    expect(replaced.ok()).toBe(true);
    expect(replaced.request().postDataJSON().diagnoses).toMatch(/^ENC:/u);
    await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules$`));
    await assertReread();
    await page.locator('input[name="firstName"]').fill('SinteticoModificato');
    const editedResponse = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/patients/${patientId}`);
    await page.getByRole('button', { name: 'Aggiorna scheda', exact: true }).click();
    const edited = await editedResponse;
    expect(edited.ok()).toBe(true);
    expect(edited.request().postDataJSON()).not.toHaveProperty('diagnoses');
    await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules$`));
    await assertReread();
    const stored = await page.request.get(`/api/patients/${patientId}`);
    expect((await stored.json()).diagnoses).toMatch(/^ENC:/u);
    expect(searches).toBe(2);
});
