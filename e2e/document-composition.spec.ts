import { expect, test, type Page } from '@playwright/test';
import { openDocumentActions, bootstrapUnlockedSession, openPatientSection, setAiLaneKillSwitch, assertNoHorizontalOverflow } from './utils';

test.describe.configure({ retries: 0 });

async function documents(page: Page) {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await setAiLaneKillSwitch(page, 'aiDocumentSynthesisKillSwitch', 'disabled');
    const patientId = await page.evaluate(async () => {
        const marker = crypto.randomUUID().replaceAll('-', '').slice(0, 13).toUpperCase();
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ firstName: 'Documenti', lastName: 'Sintetici', taxCode: `W12${marker}`,
                birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }),
        });
        if (!response.ok) throw new Error(`Synthetic document fixture: HTTP ${response.status}`);
        const { id } = await response.json() as { id: string };
        const read = await fetch(`/api/patients/${id}`);
        const current = await read.json() as { version: number };
        const update = await fetch(`/api/patients/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ version: current.version, documentInsights: JSON.stringify([{
                    id: 'historical-source', fileName: 'Fonte storica senza allegato.txt', date: '2026-10-01T09:00:00.000Z',
                    summary: 'Sintesi storica sintetica. Nessun dato reale.', rawMarkdown: 'Testo conservato con la sintesi storica.',
                }]) }),
        });
        if (!update.ok) throw new Error(`Synthetic document archive fixture: HTTP ${update.status}`);
        return id;
    });
    await page.goto(`/patients/${patientId}/modules`);
    await openPatientSection(page, 'documenti');
    const docs = page.getByTestId('patient-documents');
    const names = ['Originale sintetico A.txt', 'Originale sintetico B con un nome molto lungo da leggere senza tagli.txt'];
    await docs.locator('input[type="file"]').setInputFiles(names.map((name, index) => ({ name,
        mimeType: 'text/plain', buffer: Buffer.from(`Originale sintetico ${index === 0 ? 'A' : 'B'}. Nessun dato reale.`) })));
    await expect(docs.getByRole('status').filter({ hasText: '2 allegati salvati' })).toBeVisible();
    await page.reload(); await openPatientSection(page, 'documenti');
    return { docs, names, original: page.getByRole('complementary', { name: 'Originale del documento' }) };
}

test('Documenti: apertura e scelta della sintesi conservano la stessa fonte, senza generazione implicita', async ({ page }, info) => {
    const { docs, names, original } = await documents(page);
    const generations: string[] = [];
    page.on('request', request => {
        if (request.method() === 'POST' && /\/api\/ai\/document-synthesis\//u.test(request.url())) generations.push(request.url());
    });
    const source = docs.getByRole('combobox', { name: /^Documento da sintetizzare/u });
    await openDocumentActions(page, names[0]);
    await docs.getByRole('menuitem', { name: `Prepara sintesi di ${names[0]}`, exact: true }).click();
    await expect(source.locator('option:checked')).toHaveText(names[0]);
    await expect(original.getByTestId('document-preview-text')).toContainText('Originale sintetico A.');
    await docs.getByRole('button', { name: `Visualizza ${names[1]}`, exact: true }).click();
    if (process.env.W12_CAPTURE_DIR) await page.screenshot({ path: `${process.env.W12_CAPTURE_DIR}/${info.project.name || 'chromium'}-source.png`, fullPage: true });
    await expect(source.locator('option:checked')).toHaveText(names[1]);
    await expect(original.getByTestId('document-preview-text')).toContainText('Originale sintetico B.');
    await source.selectOption('');
    await expect(page.getByTestId('document-viewer')).toHaveCount(0);
    await expect(docs.getByText('Scegli un documento per preparare una nuova sintesi.', { exact: true })).toBeVisible();
    expect(generations).toEqual([]);
});

test('Documenti: storico separato dalla nuova proposta e sorgente archiviata distinta dall’originale', async ({ page }) => {
    const { docs } = await documents(page);
    const archive = docs.locator('[data-document-area="archive"]');
    await expect(archive).toBeVisible();
    await expect(docs.locator('[data-document-area="summary"] [data-testid="document-insights-archive"]')).toHaveCount(0);
    await archive.getByRole('button', { name: 'Sintesi archiviate · 1', exact: true }).click();
    await archive.getByRole('button').filter({ hasText: 'Fonte storica senza allegato.txt' }).click();
    await expect(archive.getByText('Sintesi storica sintetica. Nessun dato reale.', { exact: true })).toBeVisible();
    await archive.getByRole('button', { name: 'Testo sorgente archiviato', exact: true }).click();
    await expect(archive.getByText('Testo conservato con la sintesi storica.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('document-viewer')).toHaveCount(0);
});

test('Documenti: errore elenco, fonte scomparsa e rilettura non diventano un falso vuoto', async ({ page }) => {
    const { docs, names } = await documents(page);
    await openDocumentActions(page, names[0]);
    await docs.getByRole('menuitem', { name: `Prepara sintesi di ${names[0]}`, exact: true }).click();
    let mode: 'error' | 'empty' | 'current' = 'error';
    await page.route('**/api/attachments?**', async route => {
        if (route.request().method() !== 'GET' || mode === 'current') return route.continue();
        return mode === 'empty' ? route.fulfill({ status: 200, json: [] })
            : route.fulfill({ status: 503, json: { error: 'synthetic-list-unavailable' } });
    });
    await openDocumentActions(page, names[1]);
    await docs.getByRole('menuitem', { name: 'Elimina ' + names[1], exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Elimina', exact: true }).click();
    await expect(docs.getByText('Elenco documenti non disponibile. Non è possibile stabilire quali file siano presenti.', { exact: true })).toBeVisible();
    await expect(docs.getByText(/^Nessun documento caricato\./u)).toHaveCount(0);
    await expect(page.getByTestId('document-viewer')).toHaveCount(0);
    mode = 'empty';
    await docs.getByRole('button', { name: 'Riprova elenco', exact: true }).click();
    await expect(docs.getByText('La fonte selezionata non è più disponibile nell’elenco. Rileggi l’elenco o scegli un altro documento.', { exact: true })).toBeVisible();
    await expect(docs.getByRole('combobox', { name: /^Documento da sintetizzare/u })).toHaveValue('');
    await expect(page.getByTestId('document-viewer')).toHaveCount(0);
    mode = 'current';
    await docs.getByRole('button', { name: 'Rileggi elenco', exact: true }).click();
    await expect(docs.getByRole('combobox', { name: /^Documento da sintetizzare/u }).locator('option:checked')).toHaveText(names[0]);
    await expect(page.getByTestId('document-preview-text')).toContainText('Originale sintetico A.');
});

test('Documenti: nomi e azioni leggibili a 320 punti e testo ingrandito', async ({ page }) => {
    const { docs, names } = await documents(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await openDocumentActions(page, names[1]);
    await docs.getByRole('menuitem', { name: `Prepara sintesi di ${names[1]}`, exact: true }).click();
    await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'Documenti', selector: '[data-testid="patient-documents"]' }]);
    const row = docs.locator('[data-document-id]').filter({ has: page.getByRole('heading', { name: names[1], exact: true }) });
    const cells = row.locator('tr').first().locator('td');
    const nameBox = await cells.nth(0).boundingBox(), actionsBox = await cells.nth(1).boundingBox();
    expect(nameBox).not.toBeNull(); expect(actionsBox).not.toBeNull();
    expect(actionsBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height - 1);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'Documenti', selector: '[data-testid="patient-documents"]' }]);
    await expect(docs.getByRole('combobox', { name: /^Documento da sintetizzare/u })).toBeVisible();
});

test('Documenti: composizione nei due temi, fonti assenti e viewport compatti', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const { docs, names } = await documents(page);
    await expect(page).toHaveURL(/\/patients\/[^/]+\/modules#documenti$/u);
    await expect(page).toHaveTitle(/MediFlow/u);
    await openDocumentActions(page, names[0]);
    await docs.getByRole('menuitem', { name: `Prepara sintesi di ${names[0]}`, exact: true }).click();
    for (const theme of ['giorno', 'grafite']) {
        for (const width of [1440, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 960 });
            await page.evaluate(theme => {
                document.documentElement.classList.toggle('dark', theme === 'grafite');
                document.documentElement.classList.toggle('light', theme === 'giorno');
            }, theme);
            await expect(page.getByTestId('document-preview-text')).toContainText('Originale sintetico A.');
            await assertNoHorizontalOverflow(page, [{ label: 'Documenti', selector: '[data-testid="patient-documents"]' }]);
            await page.evaluate(() => document.fonts.ready);
            if (process.env.W12_CAPTURE_DIR) {
                await docs.locator('[data-document-area="list"]').scrollIntoViewIfNeeded();
                await page.screenshot({ path: `${process.env.W12_CAPTURE_DIR}/${theme}-${width}-list.png` });
                await docs.locator('[data-document-area="summary"]').scrollIntoViewIfNeeded();
                await page.screenshot({ path: `${process.env.W12_CAPTURE_DIR}/${theme}-${width}-source.png` });
            }
        }
    }
    await openDocumentActions(page, names[0]);
    await docs.getByRole('menuitem', { name: 'Elimina ' + names[0], exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Elimina', exact: true }).click();
    await expect(docs.getByRole('heading', { name: names[0], exact: true })).toHaveCount(0);
    await expect(page.getByTestId('document-viewer')).toHaveCount(0);
    await expect(page.getByTestId('document-synthesis-fabric-result')).toHaveCount(0);
    await expect(docs.getByRole('combobox', { name: /^Documento da sintetizzare/u })).toHaveValue('');
    await expect(page.getByText('Runtime Error', { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
});
