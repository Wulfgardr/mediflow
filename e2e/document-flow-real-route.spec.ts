/* full application and authenticated routes, isolated synthetic data only. */
import { expect, test } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, openPatientSection, setAiLaneKillSwitch, unlockIfNeeded } from './utils';
import type { Page } from '@playwright/test';
import { LOCKED_DATA_PLACEHOLDER } from '../lib/locked-field-guard';
import { assertDocumentFlowRealRoutes } from './document-flow-real-route.acceptance';
import { AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY } from '../lib/ai-document-synthesis-kill-switch';

test('Documenti: upload, persistenza, consultazione e cancellazione senza generazione implicita', async ({ page, baseURL }, info) => {
    test.skip(process.env.E2E_DOCUMENTS_SYNTHETIC_ONLY !== '1', 'Requires explicit isolated synthetic data');
    expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await setAiLaneKillSwitch(page, AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY, 'disabled');
    const patientId = await page.evaluate(async () => {
        const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
        const response = await fetch('/api/patients', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Documento', lastName: 'Sintetico', taxCode: `DOC${suffix}X`, birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }),
        });
        if (!response.ok) throw new Error(`Synthetic patient: HTTP ${response.status}`);
        return (await response.json() as { id: string }).id;
    });
    await assertDocumentFlowRealRoutes(page, info, {
        confirmedSyntheticSandbox: true,
        patientUrl: `${baseURL}/patients/${patientId}/modules`, expectedPageTitle: /MediFlow/,
        synthesis: { mode: 'disabled' },
    });
});


// These fixtures use the same real upload, encryption and isolated runtime as
// the positive acceptance flow. Only the response under examination is delayed
// or changed; the app and its effects are never substituted.
async function originalFixture(page: Page) {
    test.skip(process.env.E2E_DOCUMENTS_SYNTHETIC_ONLY !== '1', 'Requires explicit isolated synthetic data');
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await setAiLaneKillSwitch(page, AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY, 'disabled');
    const patientId = await page.evaluate(async () => {
        const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Originale', lastName: 'Sintetico', taxCode: 'SRC' + suffix + 'X',
                birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }) });
        if (!response.ok) throw new Error('Synthetic original fixture: HTTP ' + response.status);
        return (await response.json() as { id: string }).id;
    });
    const url = '/patients/' + patientId + '/modules';
    await page.goto(url); await openPatientSection(page, 'documenti');
    const docs = page.getByTestId('patient-documents');
    const files = ['A', 'B'].map((letter) => ({ name: 'originale-sintetico-' + letter + '.txt',
        text: 'Testo originale sintetico ' + letter + '. Nessun dato reale.' }));
    const uploads: string[] = [];
    const observe = (request: import('@playwright/test').Request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/attachments') {
            const payload = request.postDataJSON() as { data: string };
            uploads.push(payload.data);
        }
    };
    page.on('request', observe);
    try {
        await docs.locator('input[type="file"]').setInputFiles(files.map((file) => ({
            name: file.name, mimeType: 'text/plain', buffer: Buffer.from(file.text),
        })));
        await expect(docs.getByRole('status').filter({ hasText: '2 allegati salvati' })).toBeVisible();
        expect(uploads).toHaveLength(2); expect(uploads.every((data) => data.startsWith('ENC:'))).toBe(true);
    } finally { page.off('request', observe); }
    await page.reload(); await openPatientSection(page, 'documenti');
    await expect(docs.locator('[data-document-area="list"]')).toHaveAttribute('aria-busy', 'false');
    const sources = await Promise.all(files.map(async (file) => {
        const row = docs.locator('[data-document-id]').filter({ has: page.getByRole('heading', { name: file.name, exact: true }) });
        await expect(row).toBeVisible();
        const id = await row.getAttribute('data-document-id');
        if (!id) throw new Error('Synthetic attachment id absent');
        return { ...file, id };
    }));
    return { docs, sources, url, patientId, original: page.getByRole('complementary', { name: 'Originale del documento' }) };
}

async function delayOriginal(page: Page, id: string) {
    const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), delivered = Promise.withResolvers<void>();
    const aborted: string[] = [];
    page.on('requestfailed', (request) => {
        if (new URL(request.url()).pathname === '/api/attachments/' + id) aborted.push(request.failure()?.errorText ?? '');
    });
    await page.route('**/api/attachments/' + id, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        ready.resolve(); await release.promise;
        // Cancellation makes delivery impossible; its observed requestfailed is
        // asserted by the test, rather than hiding a still-current read error.
        await route.fulfill({ response }).catch(() => undefined);
        delivered.resolve();
    });
    return { ready: ready.promise, release: release.resolve, delivered: delivered.promise, aborted };
}

async function openOriginal(page: Page, name: string) {
    await page.getByRole('button', { name: 'Visualizza ' + name, exact: true }).click();
}

test('Originale: cambiare scelta scarta una risposta tardiva senza mescolare i documenti', async ({ page }) => {
    const { sources: [a, b], original } = await originalFixture(page);
    const pending = await delayOriginal(page, a.id);
    try {
        await openOriginal(page, a.name); await pending.ready;
        await expect(original.getByText('Caricamento originale…', { exact: true })).toBeVisible();
        await expect(original.getByRole('button', { name: 'Chiudi', exact: true })).toBeEnabled();
        await openOriginal(page, b.name);
        await expect(page.getByTestId('document-preview-text')).toHaveText(b.text);
        await expect.poll(() => pending.aborted).toEqual(['net::ERR_ABORTED']);
        pending.release(); await pending.delivered;
        await expect(page.getByTestId('document-preview-text')).toHaveText(b.text);
        await expect(page.getByTestId('document-viewer').getByRole('heading', { name: b.name, exact: true })).toBeVisible();
        await expect(page.getByTestId('document-viewer').getByRole('heading', { name: a.name, exact: true })).toHaveCount(0);
    } finally { pending.release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('Originale: errore e riprova, identità o revisione diversa e dati illeggibili', async ({ page }) => {
    const { sources: [a], original } = await originalFixture(page);
    let responseMode: 'unavailable' | 'valid' | 'patient' | 'id' | 'revision' | 'epoch' | 'source' | 'locked' | 'ciphertext' = 'unavailable';
    await page.route('**/api/attachments/' + a.id, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        if (responseMode === 'unavailable') return route.fulfill({ status: 503, json: { error: 'Synthetic read unavailable' } });
        const body = await response.json() as { id: string; patientId: string; data: string;
            currentness: { sourceRef: string; revision: number; freshnessEpoch: number } };
        if (responseMode === 'patient') body.patientId = 'synthetic-other-patient';
        if (responseMode === 'id') body.id = 'synthetic-other-attachment';
        if (responseMode === 'revision') body.currentness.revision += 1;
        if (responseMode === 'epoch') body.currentness.freshnessEpoch += 1;
        if (responseMode === 'source') body.currentness.sourceRef = body.currentness.sourceRef === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64);
        if (responseMode === 'locked') body.data = LOCKED_DATA_PLACEHOLDER;
        if (responseMode === 'ciphertext') body.data = 'ENC:malformed';
        await route.fulfill({ response, json: body });
    });
    await openOriginal(page, a.name);
    await expect(original.getByRole('button', { name: 'Riprova originale', exact: true })).toBeVisible();
    await expect(page.getByTestId('document-viewer')).toHaveCount(0);
    responseMode = 'valid';
    await original.getByRole('button', { name: 'Riprova originale', exact: true }).click();
    await expect(page.getByTestId('document-preview-text')).toHaveText(a.text);
    await original.getByRole('button', { name: 'Chiudi', exact: true }).click();
    for (const mode of ['patient', 'id', 'revision', 'epoch', 'source', 'locked', 'ciphertext'] as const) {
        responseMode = mode;
        await openOriginal(page, a.name);
        await expect(original.getByRole('alert')).toBeVisible();
        await expect(original.getByText('Caricamento originale…', { exact: true })).toHaveCount(0);
        await expect(page.getByTestId('document-viewer')).toHaveCount(0);
        await expect(page.getByTestId('document-preview-text')).toHaveCount(0);
        await original.getByRole('button', { name: 'Chiudi', exact: true }).click();
    }
    responseMode = 'valid';
    await openOriginal(page, a.name);
    await expect(page.getByTestId('document-preview-text')).toHaveText(a.text);
});

test('Originale: il blocco annulla la lettura e lo sblocco richiede una nuova scelta', async ({ page }) => {
    const { sources: [a], original, docs, url } = await originalFixture(page);
    const pending = await delayOriginal(page, a.id);
    try {
        await openOriginal(page, a.name); await pending.ready;
        await expect(original.getByText('Caricamento originale…', { exact: true })).toBeVisible();
        const locked = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/lock');
        await page.getByRole('button', { name: 'Blocca', exact: true }).click();
        expect((await locked).status()).toBe(200);
        await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
        await expect.poll(() => pending.aborted).toEqual(['net::ERR_ABORTED']);
        pending.release(); await pending.delivered;
        await expect(page.getByTestId('document-viewer')).toHaveCount(0);
        await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
        await expect(page).toHaveURL(new RegExp(url + '(?:#documenti)?$'));
        await openPatientSection(page, 'documenti');
        await expect(docs.locator('[data-document-area="list"]')).toHaveAttribute('aria-busy', 'false');
        await expect(page.getByTestId('document-viewer')).toHaveCount(0);
        await openOriginal(page, a.name);
        await expect(page.getByTestId('document-preview-text')).toHaveText(a.text);
    } finally { pending.release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('Originale: una rilettura fallita nasconde la fonte e pagehide ritira la lettura pendente', async ({ page }) => {
    const { sources: [a, b], original, docs, patientId } = await originalFixture(page);
    await openOriginal(page, a.name);
    await expect(page.getByTestId('document-preview-text')).toHaveText(a.text);
    let failList = true;
    await page.route('**/api/attachments?**', (route) => {
        const url = new URL(route.request().url());
        if (failList && route.request().method() === 'GET' && url.pathname === '/api/attachments'
            && url.searchParams.get('patientId') === patientId) return route.fulfill({ status: 503, json: { error: 'Synthetic list unavailable' } });
        return route.continue();
    });
    // A successful real write causes the app's ordinary scoped invalidation.
    await docs.locator('input[type="file"]').setInputFiles({ name: 'originale-sintetico-C.txt', mimeType: 'text/plain', buffer: Buffer.from('Testo sintetico C.') });
    await expect(docs.getByRole('status').filter({ hasText: '1 allegato salvato' })).toBeVisible();
    await expect(docs.getByRole('button', { name: 'Riprova elenco', exact: true })).toBeVisible();
    await expect(page.getByTestId('document-viewer')).toHaveCount(0);
    failList = false;
    await docs.getByRole('button', { name: 'Riprova elenco', exact: true }).click();
    await expect(docs.locator('[data-document-id]')).toHaveCount(3);
    await expect(page.getByTestId('document-preview-text')).toHaveText(a.text);
    const pending = await delayOriginal(page, b.id);
    try {
        await openOriginal(page, b.name); await pending.ready;
        await expect(original.getByText('Caricamento originale…', { exact: true })).toBeVisible();
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        await expect.poll(() => pending.aborted).toEqual(['net::ERR_ABORTED']);
        await expect(page.getByTestId('document-viewer')).toHaveCount(0);
        pending.release(); await pending.delivered;
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await expect(docs.locator('[data-document-area="list"]')).toHaveAttribute('aria-busy', 'false');
        await expect(page.getByTestId('document-viewer')).toHaveCount(0);
        await expect(original.getByText('Caricamento originale…', { exact: true })).toHaveCount(0);
        await openOriginal(page, b.name);
        await expect(page.getByTestId('document-preview-text')).toHaveText(b.text);
    } finally { pending.release(); await page.unrouteAll({ behavior: 'wait' }); }
});
