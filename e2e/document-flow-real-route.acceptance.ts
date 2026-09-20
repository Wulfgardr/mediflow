/* @Codex
 * Test-only scenario for the coordinator's real authenticated synthetic Page.
 * Does not log in, read credentials/storageState, seed a patient, intercept routes,
 * instantiate a substitute component, change settings or manufacture readiness.
 * NOT auto-discovered as a spec: the authoritative bootstrap fixture is absent
 * from this partial package. Invoke inside that existing fixture's test().
 */
import { randomUUID } from 'node:crypto';
import { expect, type Page, type Request, type TestInfo } from '@playwright/test';
import { parseDocumentSynthesisPreviewWire } from '../lib/ai-providers/fabric/document-synthesis-preview-wire';
import { openPatientSection } from './utils';

type Options = Readonly<{
    confirmedSyntheticSandbox: true;
    patientUrl: string;
    expectedPageTitle: RegExp;
    synthesis: Readonly<{ mode: 'disabled' }> | Readonly<{
        mode: 'observe-real-result'; ambulatoryId: string; expectedExecutedModel: string;
        expectedSyntheticPatientName: string;
    }>;
}>;
type ObservedRequest = Readonly<{ method: string; path: string; bodyKeys?: readonly string[] }>;
const PREFIX = '/api/ai/document-synthesis/';

export async function assertDocumentFlowRealRoutes(page: Page, info: TestInfo, options: Options): Promise<void> {
    const url = new URL(options.patientUrl);
    if (options.confirmedSyntheticSandbox !== true || url.protocol !== 'http:'
        || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        || !/^\/patients\/[^/]+\/modules$/u.test(url.pathname) || url.username || url.password) {
        throw new Error('A loopback synthetic patient route and explicit sandbox confirmation are required');
    }
    const requests: ObservedRequest[] = [];
    const unexpectedWrites: string[] = [];
    const externalRequests: string[] = [];
    const pageErrors: string[] = [];
    const consoleProblems: string[] = [];
    const observe = (request: Request) => {
        const requestUrl = new URL(request.url());
        if (!['http:', 'https:'].includes(requestUrl.protocol)) return;
        if (requestUrl.origin !== url.origin) { externalRequests.push(requestUrl.origin); return; }
        const method = request.method(); const path = requestUrl.pathname;
        if (!path.startsWith('/api/')) return;
        const keys = path.startsWith(PREFIX) && method === 'POST' ? Object.keys(request.postDataJSON() ?? {}).sort() : undefined;
        requests.push({ method, path, ...(keys ? { bodyKeys: keys } : {}) });
        if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;
        const attachmentWrite = (method === 'POST' && path === '/api/attachments')
            || (method === 'DELETE' && /^\/api\/attachments\/[^/]+$/u.test(path));
        // Existing shell migration resets this retired visual preference on mount.
        // Permit only its exact non-clinical payload, not arbitrary settings writes.
        const settings = method === 'POST' && path === '/api/settings' ? request.postDataJSON() : null;
        const shellPreference = settings?.key === 'uiReduceTransparency' && settings.value === false
            && Object.keys(settings).sort().join(',') === 'key,value';
        const explicitPreview = options.synthesis.mode === 'observe-real-result' && method === 'POST'
            && [PREFIX + 'capture', PREFIX + 'ingest', PREFIX + 'preview', '/api/ai/smart-import/selection', '/api/settings/ai/functions/preview'].includes(path);
        if (!attachmentWrite && !explicitPreview && !shellPreference) unexpectedWrites.push(`${method} ${path}`);
    };
    const onPageError = () => { pageErrors.push('pageerror'); };
    const onConsole = (message: { type(): string; text(): string }) => {
        if (['error', 'warning'].includes(message.type())) consoleProblems.push(`${message.type()}: ${message.text().slice(0, 400)}`);
    };
    page.on('request', observe); page.on('pageerror', onPageError); page.on('console', onConsole);
    const docs = page.getByTestId('patient-documents');
    const rows = docs.locator('[data-document-id]');
    const synthesisCalls = () => requests.filter((item) => item.path.startsWith(PREFIX) && item.method === 'POST');
    const writes = (method: string) => requests.filter((item) => item.method === method && item.path.startsWith('/api/attachments'));
    const openDocuments = async () => {
        await openPatientSection(page, 'documenti');
        await expect(docs).toBeVisible();
        await expect(docs.locator('[data-document-area="list"]')).toHaveAttribute('aria-busy', 'false');
    };
    const verifyHealth = async () => {
        await expect(page).toHaveURL(new RegExp(`/patients/[^/]+/modules(?:#documenti)?$`));
        await expect(page).toHaveTitle(options.expectedPageTitle);
        await expect(docs.getByRole('button', { name: 'Carica documenti', exact: true })).toBeVisible();
        expect(await page.locator('nextjs-portal').evaluateAll((portals) => portals.some((node) => /Runtime Error|Build Error|Unhandled Runtime/u.test(node.textContent ?? '')))).toBe(false);
        expect(pageErrors).toEqual([]); expect(consoleProblems).toEqual([]);
        expect(unexpectedWrites).toEqual([]); expect(externalRequests).toEqual([]);
    };
    try {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(url.href); await openDocuments();
        await expect(rows).toHaveCount(0); // Explicit fixture precondition; never delete unknown pre-existing files.
        await expect(docs.getByText('Nessun documento caricato.', { exact: false })).toBeVisible();
        expect(synthesisCalls()).toEqual([]);
        await verifyHealth();
        await page.screenshot({ path: info.outputPath('document-flow-empty-desktop.png'), fullPage: false });

        const suffix = randomUUID();
        const names = [`synthetic-document-a-${suffix}.txt`, `synthetic-document-b-${suffix}.txt`];
        const files = names.map((name, index) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(`Documento di prova inventato ${index + 1}. La sfera è blu. Nessun dato personale o clinico reale.`) }));
        // Rejection must not consume files, persist anything, or dispatch synthesis.
        await docs.locator('input[type="file"]').setInputFiles(Array.from({ length: 11 }, (_, index) => ({ ...files[0], name: `synthetic-rejected-${index}.txt` })));
        await expect(docs.getByRole('alert')).toContainText('al massimo 10 file');
        expect(writes('POST')).toHaveLength(0);
        await docs.locator('input[type="file"]').setInputFiles(files);
        await expect(docs.getByRole('status').filter({ hasText: '2 allegati salvati' }), 'Both file writes must be acknowledged').toBeVisible().catch(error => {
            throw new Error(`Upload did not complete; observed attachment POSTs=${writes('POST').length}; pageErrors=${pageErrors.length}; consoleProblems=${consoleProblems.length}`, { cause: error });
        });
        await expect(rows).toHaveCount(2);
        expect(writes('POST')).toHaveLength(2);
        expect(synthesisCalls()).toEqual([]);
        await expect(docs.getByLabel('Documento da sintetizzare')).toHaveValue('');
        for (const name of names) {
            const row = rows.filter({ has: page.getByRole('heading', { name, exact: true }) });
            await expect(row).toContainText('Caricato il');
            await expect(row.getByTestId('document-source-status')).toHaveText('Allegato salvato · testo non verificato in questa sessione');
        }
        // A fresh real route read must recover persisted sources, not component memory.
        await page.reload(); await openDocuments(); await expect(rows).toHaveCount(2);
        expect(writes('POST')).toHaveLength(2); expect(synthesisCalls()).toEqual([]);
        const first = rows.filter({ has: page.getByRole('heading', { name: names[0], exact: true }) });
        const second = rows.filter({ has: page.getByRole('heading', { name: names[1], exact: true }) });
        const firstId = await first.getAttribute('data-document-id');
        expect(firstId).toBeTruthy();
        await first.getByRole('button', { name: `Visualizza ${names[0]}`, exact: true }).click();
        await expect(page.getByTestId('document-preview-text')).toHaveText(files[0].buffer.toString('utf8'));
        await expect(page.locator('iframe, object, embed')).toHaveCount(0);
        await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
        await expect(page.getByTestId('document-viewer')).toHaveCount(0);
        await first.getByRole('button', { name: `Prepara sintesi di ${names[0]}`, exact: true }).click();
        await expect(docs.getByLabel('Documento da sintetizzare')).toHaveValue(firstId!);
        expect(synthesisCalls()).toEqual([]);
        if (options.synthesis.mode === 'disabled') {
            await expect(docs.getByTestId('document-upload-synthesis-disabled-note')).toBeVisible();
            await expect(docs.locator('[data-testid^="document-synthesis-fabric-review-"]')).toHaveCount(0);
        } else {
            const scenario = options.synthesis;
            const card = docs.getByTestId(`document-synthesis-fabric-review-${firstId}`);
            await card.getByRole('button', { name: 'Genera proposta', exact: true }).click();
            await expect(card.getByText(`Paziente: ${scenario.expectedSyntheticPatientName}`, { exact: true })).toBeVisible();
            const submit = card.getByRole('button', { name: 'Conferma e genera proposta', exact: true });
            await expect(submit).toBeDisabled();
            await expect(card.getByRole('checkbox')).toBeDisabled();
            await card.getByLabel('Ambulatorio per questa proposta').selectOption(scenario.ambulatoryId);
            await expect(card.getByRole('checkbox')).not.toBeChecked();
            await card.getByRole('checkbox').check();
            await card.getByRole('button', { name: 'Annulla', exact: true }).click();
            expect(synthesisCalls()).toEqual([]);
            await card.getByRole('button', { name: 'Genera proposta', exact: true }).click();
            await expect(card.getByRole('checkbox')).not.toBeChecked();
            await expect(card.getByLabel('Ambulatorio per questa proposta')).toHaveValue('');
            await card.getByLabel('Ambulatorio per questa proposta').selectOption(scenario.ambulatoryId);
            await card.getByRole('checkbox').check();
            const pending = page.waitForResponse((response) => new URL(response.url()).pathname === PREFIX + 'preview' && response.request().method() === 'POST');
            await submit.click();
            const response = await pending;
            expect(response.ok(), 'Enabled scenario requires an observed successful real preview, not an accepted error').toBe(true);
            const wire = parseDocumentSynthesisPreviewWire(await response.json());
            expect(wire).not.toBeNull();
            if (!wire) throw new Error('Real host returned an invalid publication');
            expect(wire.publication.receipt.providerBindingReceipt.model).toBe(scenario.expectedExecutedModel);
            expect(wire.publication.receipt.writesPerformed).toBe(0);
            const result = card.getByTestId('document-synthesis-fabric-result');
            await expect(result).toContainText(wire.publication.output.summary);
            await expect(result.locator('dt', { hasText: 'Modello usato' }).locator('xpath=following-sibling::dd[1]')).toHaveText(scenario.expectedExecutedModel);
            await expect(card.getByTestId('model-picker-document_synthesis')).toHaveCount(0);
            const citations = result.locator('details').filter({ has: page.locator('summary', { hasText: 'Citazioni dal documento' }) });
            expect(await citations.getAttribute('open')).toBeNull();
            await citations.locator('summary').click();
            await expect(citations.locator('blockquote')).toHaveCount(wire.publication.citations.length);
            for (let index = 0; index < wire.publication.citations.length; index += 1) await expect(citations.locator('blockquote').nth(index)).toHaveText(wire.publication.citations[index].quote);
            const verification = result.locator('details').filter({ has: page.locator('summary', { hasText: 'Dettagli di verifica' }) });
            expect(await verification.getAttribute('open')).toBeNull();
            await verification.locator('summary').click();
            await expect(verification).toContainText(wire.publication.receipt.outputSha256);
            await expect(verification).toContainText('0 scritture');
            expect(synthesisCalls().map(({ path, bodyKeys }) => ({ path, bodyKeys }))).toEqual([
                { path: PREFIX + 'capture', bodyKeys: ['attachmentId'] },
                { path: PREFIX + 'ingest', bodyKeys: ['captureHandle'] },
                { path: PREFIX + 'preview', bodyKeys: ['previewHandle'] },
            ]);
            await page.screenshot({ path: info.outputPath('document-flow-real-result.png'), fullPage: false });
            await second.getByRole('button', { name: `Prepara sintesi di ${names[1]}`, exact: true }).click();
            await expect(docs.getByTestId('document-synthesis-fabric-result')).toHaveCount(0);
            expect(synthesisCalls()).toHaveLength(3);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await docs.scrollIntoViewIfNeeded();
        expect(await docs.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        for (const button of await first.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await verifyHealth();
        await page.screenshot({ path: info.outputPath('document-flow-populated-mobile.png'), fullPage: false });

        const deleteRow = async (name: string, cancelFirst: boolean) => {
            const row = rows.filter({ has: page.getByRole('heading', { name, exact: true }) });
            const before = writes('DELETE').length;
            await row.getByRole('button', { name: `Elimina ${name}`, exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Eliminare questo documento?' });
            if (cancelFirst) {
                await dialog.getByRole('button', { name: 'Annulla', exact: true }).click();
                await expect(row).toBeVisible(); expect(writes('DELETE')).toHaveLength(before);
                await row.getByRole('button', { name: `Elimina ${name}`, exact: true }).click();
            }
            await dialog.getByRole('button', { name: 'Elimina', exact: true }).click();
            await expect(row).toHaveCount(0); expect(writes('DELETE')).toHaveLength(before + 1);
        };
        await deleteRow(names[0], true);
        await page.reload(); await openDocuments(); await expect(rows).toHaveCount(1);
        await expect(rows.getByRole('heading', { name: names[1], exact: true })).toBeVisible();
        await deleteRow(names[1], false);
        await expect(docs.getByText('Nessun documento caricato.', { exact: false })).toBeVisible();
        await verifyHealth();
    } finally {
        // Only synthetic request metadata is attached. No headers, cookies, bodies or patient records.
        await info.attach('document-flow-observed-requests', { body: Buffer.from(JSON.stringify({ requests, unexpectedWrites, externalRequests, pageErrors, consoleProblems }, null, 2)), contentType: 'application/json' });
        page.off('request', observe); page.off('pageerror', onPageError); page.off('console', onConsole);
    }
}
