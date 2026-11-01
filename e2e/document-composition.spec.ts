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

test('Documenti: Altro mantiene ordine, tastiera e focus dopo la conferma annullata', async ({ page }) => {
    const { docs, names } = await documents(page);
    const deletes: string[] = [];
    page.on('request', request => {
        if (request.method() === 'DELETE') deletes.push(request.url());
    });
    const trigger = docs.getByRole('button', { name: `Altro per ${names[0]}`, exact: true });
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: `Azioni documento ${names[0]}`, exact: true });
    const items = menu.getByRole('menuitem');
    await expect(items).toHaveText(['Estrai testo', 'Prepara sintesi', 'Elimina']);
    await expect(items.first()).toHaveAccessibleName(`Estrai testo localmente da ${names[0]}`);
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toHaveAccessibleName(`Prepara sintesi di ${names[0]}`);
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.last()).toHaveAccessibleName(`Elimina ${names[0]}`);
    await expect(items.last()).toBeFocused();
    await expect(menu.getByRole('separator')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(menu).toHaveCount(0);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    const confirmation = page.getByRole('dialog', { name: `Eliminare il documento «${names[0]}»?`, exact: true });
    const viewer = page.getByTestId('document-viewer');
    await expect(confirmation).toBeVisible();
    await expect(viewer).toHaveCount(0);
    await expect(confirmation.getByRole('button', { name: 'Chiudi', exact: true })).toHaveCSS('border-radius', '10px');
    await confirmation.getByRole('button', { name: 'Annulla', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(viewer).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await docs.getByRole('button', { name: `Visualizza ${names[0]}`, exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(viewer.getByRole('heading', { name: names[0], exact: true })).toBeVisible();
    await expect(docs.getByLabel('Documenti caricati').getByRole('heading', { name: names[0], exact: true })).toBeVisible();
    expect(deletes).toEqual([]);
});

test('Documenti: PDF con immagine oltre soglia rifiuta tutta la pagina; PDF normale resta leggibile', async ({ page }) => {
    const { PDFDocument, PDFName } = await import('pdf-lib');
    const { docs } = await documents(page);
    for (const size of [1, 4000]) {
        const document = await PDFDocument.create();
        const pdfPage = document.addPage([100, 100]);
        const image = document.context.flateStream(new Uint8Array(size === 1 ? [0, 0, 0] : [0]), {
            Type: 'XObject', Subtype: 'Image', Width: size, Height: size, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
        });
        pdfPage.node.setXObject(PDFName.of('Im0'), document.context.register(image));
        pdfPage.node.addContentStream(document.context.register(document.context.flateStream('q 100 0 0 100 0 0 cm /Im0 Do Q')));
        const name = `PDF sintetico ${size}.pdf`;
        await docs.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(await document.save()) });
        await expect(docs.getByRole('button', { name: `Visualizza ${name}`, exact: true })).toBeVisible();
        await docs.getByRole('button', { name: `Visualizza ${name}`, exact: true }).click();
        const viewer = page.getByTestId('document-viewer');
        if (size === 1) {
            await expect(viewer.getByTestId('document-preview-pdf')).toHaveAttribute('data-state', 'ready');
            await expect(viewer.getByTestId('document-preview-error')).toHaveCount(0);
        } else {
            await expect(viewer.getByTestId('document-preview-error')).toBeVisible();
            await expect(viewer.getByTestId('document-preview-pdf-page')).not.toBeVisible();
            await expect(viewer.getByTestId('document-preview-pdf-page')).toHaveAttribute('width', '0');
        }
        await page.keyboard.press('Escape');
    }
});

test('Documenti: un duplicato richiede una scelta e le copie restano distinguibili', async ({ page }) => {
    const { docs, names } = await documents(page);
    const source = { name: names[0], mimeType: 'text/plain', buffer: Buffer.from('Originale sintetico A. Nessun dato reale.') };
    const rows = docs.locator('tbody[data-document-id]');
    await expect(rows).toHaveCount(2);
    await docs.locator('input[type="file"]').setInputFiles(source);
    const dialog = page.getByRole('dialog', { name: 'Possibili documenti duplicati' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Torna all’elenco' }).click();
    await expect(rows).toHaveCount(2);
    await docs.locator('input[type="file"]').setInputFiles(source);
    await dialog.getByRole('button', { name: 'Carica altre copie' }).click();
    await expect(rows).toHaveCount(3);
    await expect(docs.getByText(/Possibile duplicato: stesso nome e dimensione/u)).toHaveCount(2);
    const choices = await docs.getByRole('combobox', { name: /^Documento da sintetizzare/u }).locator('option').allTextContents();
    const copies = choices.filter(label => label.includes(names[0]));
    expect(copies).toHaveLength(2);
    expect(new Set(copies).size).toBe(2);
});

test('Documenti: maschere PDF grandi rifiutano tutta l’anteprima', async ({ page }) => {
    const { readFileSync } = await import('node:fs');
    const { docs } = await documents(page);
    for (const mask of ['smask', 'mask']) {
        const name = `Maschera sintetica ${mask}.pdf`;
        await docs.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/pdf', buffer: readFileSync(`scripts/fixtures/preview-large-${mask}.pdf`) });
        await docs.getByRole('button', { name: `Visualizza ${name}`, exact: true }).click();
        const viewer = page.getByTestId('document-viewer');
        await expect(viewer.getByTestId('document-preview-error')).toBeVisible();
        await expect(viewer.getByTestId('document-preview-pdf-page')).toHaveAttribute('width', '0');
        await viewer.getByRole('button', { name: 'Chiudi', exact: true }).click();
    }
});

test('Documenti e Diario: scansioni 400 e 600 dpi conservano il salvataggio esplicito dell’originale', async ({ page }, info) => {
    const { readFileSync } = await import('node:fs');
    const { docs } = await documents(page);
    let downloads = 0;
    let lastAttachmentId: string | null = null;
    page.on('download', () => downloads++);
    for (const dpi of [400, 600]) {
        const name = `Scansione sintetica ${dpi}.pdf`;
        const original = readFileSync(`scripts/fixtures/preview-a4-${dpi}.pdf`);
        await docs.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/pdf', buffer: original });
        await docs.getByRole('button', { name: `Visualizza ${name}`, exact: true }).click();
        const viewer = page.getByTestId('document-viewer');
        await expect(viewer.getByTestId('document-preview-error')).toBeVisible();
        lastAttachmentId = await docs.locator('tbody[data-document-id]').filter({ has: page.getByRole('heading', { name, exact: true }) }).getAttribute('data-document-id');
        const before = downloads;
        await viewer.getByRole('button', { name: 'Salva originale', exact: true }).click();
        await expect(viewer.getByRole('alert').filter({ hasText: 'copia decifrata' })).toBeVisible();
        expect(downloads).toBe(before);
        await viewer.getByRole('button', { name: 'Annulla', exact: true }).click();
        expect(downloads).toBe(before);
        await viewer.getByRole('button', { name: 'Salva originale', exact: true }).click();
        const pending = page.waitForEvent('download');
        await viewer.getByRole('button', { name: 'Salva copia decifrata', exact: true }).click();
        const download = await pending;
        expect(download.suggestedFilename()).toBe(name);
        const saved = info.outputPath(`originale-${dpi}.pdf`);
        await download.saveAs(saved);
        expect(readFileSync(saved).equals(original)).toBe(true);
        await viewer.getByRole('button', { name: 'Chiudi', exact: true }).click();
    }
    expect(lastAttachmentId).not.toBeNull();
    await page.evaluate(async attachmentId => {
        const patientId = location.pathname.split('/')[2];
        const entry = await fetch('/api/entries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patientId,
            type: 'visit', date: '2026-11-01T09:00:00Z', title: 'Originale sintetico Diario', content: '<p>Solo dati sintetici.</p>', attachments: [attachmentId] }) });
        if (!entry.ok) throw new Error(`Synthetic diary HTTP ${entry.status}`);
    }, lastAttachmentId);
    await page.reload();
    await openPatientSection(page, 'diario');
    await page.locator('#diario').getByRole('button', { name: /Scansione sintetica 600.pdf/u }).click();
    const viewer = page.getByTestId('document-viewer');
    await expect(viewer).toHaveAttribute('role', 'dialog');
    await viewer.getByRole('button', { name: 'Salva originale', exact: true }).click();
    await expect(viewer.getByRole('alert').filter({ hasText: 'copia decifrata' })).toBeVisible();
    const pending = page.waitForEvent('download');
    await viewer.getByRole('button', { name: 'Salva copia decifrata', exact: true }).click();
    const saved = info.outputPath('diario-originale.pdf');
    await (await pending).saveAs(saved);
    expect(readFileSync(saved).equals(readFileSync('scripts/fixtures/preview-a4-600.pdf'))).toBe(true);
});
