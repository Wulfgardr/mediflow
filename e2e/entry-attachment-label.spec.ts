import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow } from './utils';

test('Allegati del Diario: etichetta neutra senza dedurre generazione dalla sintesi', async ({ baseURL }) => {
    test.setTimeout(120_000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw new Error('Runtime e archivio sintetici isolati richiesti');
    const baseline = process.env.ATTACHMENT_LABEL_BASELINE === '1', causal = process.env.ATTACHMENT_LABEL_CAUSAL === '1';
    const directory = process.env.ATTACHMENT_LABEL_SCREENSHOTS;
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const errors: string[] = [], external: string[] = [], writes: string[] = [], preparations: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST') {
        if (/\/api\/(entries|attachments)$/u.test(request.url())) writes.push(request.url());
        if (/\/api\/(ai|visit-session)\//u.test(request.url())) preparations.push(request.url());
    } });
    await page.route('**/api/siss/session-status', route => route.fulfill({ json: { status: 'unavailable', source: 'atlas-history', checkedAt: '2026-10-26T10:00:00Z', browserProfile: null, warning: 'Fixture sintetica: nessuna osservazione reale.', sessionHealth: 'none', lastModule: null, lastModuleLabel: null, lastModuleAt: null, checkpoints: [] } }));
    await page.route('**/*', route => {
        if (new URL(route.request().url()).origin !== new URL(baseURL).origin) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
    });
    const sources = [
        { name: 'manuale-inventato.txt', text: 'Originale manuale inventato, nessuna generazione.', summary: 'Allegato alla voce clinica · revisione documentale richiesta' },
        { name: 'storico-inventato.txt', text: 'Originale storico inventato, conservato integralmente.', summary: 'Sintesi storica inventata già conservata: contenuto da rivedere.' },
        { name: 'senza-sintesi-inventato.txt', text: 'Originale inventato senza sintesi associata.', summary: undefined },
    ];
    try {
        await bootstrapUnlockedSession(page, '1234');
        const fixture = await page.evaluate(async sources => {
            const post = async (path: string, body: unknown) => { const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(`${path}: ${response.status}`); return response.json(); };
            const patient = await post('patients', { firstName: 'Allegati', lastName: 'Sintetici', taxCode: `AL7${crypto.randomUUID().replaceAll('-', '').slice(0, 13).toUpperCase()}`, birthDate: '1980-01-01', diagnoses: [] });
            const historicalIds: string[] = [];
            for (const source of sources.slice(1)) {
                const id = crypto.randomUUID();
                await post('attachments', { id, patientId: patient.id, name: source.name, type: 'text/plain', size: source.text.length, path: `uploads/${source.name}`, data: `data:text/plain;base64,${btoa(source.text)}`, ...(source.summary ? { summarySnapshot: source.summary } : {}) });
                historicalIds.push(id);
            }
            const old = await post('entries', { patientId: patient.id, type: 'note', date: '2026-10-01', title: 'Allegati storici inventati', content: 'Voce storica inventata, senza nuove elaborazioni.', attachments: historicalIds });
            return { patientId: patient.id as string, historicalIds, oldEntryId: old.id as string };
        }, sources);
        await page.goto(`/patients/${fixture.patientId}/entries/new`);
        await expect(page.getByTestId('progressive-entry-composer').locator('header')).toContainText('Sintetici Allegati');
        await page.getByRole('textbox', { name: 'Resoconto clinico', exact: true }).fill('Voce manuale inventata con originale allegato.');
        await page.locator('input[type="file"]').setInputFiles({ name: sources[0].name, mimeType: 'text/plain', buffer: Buffer.from(sources[0].text) });
        await page.getByRole('button', { name: 'Registra nel diario', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/patients/${fixture.patientId}/modules$`)); await openPatientSection(page, 'diario');
        const diary = page.locator('#diario');
        const snapshot = async () => page.evaluate(async id => {
            const rows = await (await fetch(`/api/attachments?patientId=${id}`)).json();
            return rows.map((row: Record<string, unknown>) => ({ id: row.id, name: row.name, type: row.type, size: row.size, path: row.path, data: row.data, summarySnapshot: row.summarySnapshot, createdAt: row.createdAt })).sort((left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id));
        }, fixture.patientId);
        const before = await snapshot(); expect(before).toHaveLength(3); writes.length = 0;
        for (const [index, source] of sources.entries()) {
            const card = diary.getByRole('button', { name: new RegExp(source.name.replaceAll('.', '\\.'), 'u') });
            await expect(card).toBeVisible();
            await expect(card.locator('p').last()).toHaveText(baseline && !causal && index < 2 ? 'Analisi IA disponibile' : 'Allegato');
        }
        if (directory) await mkdir(directory, { recursive: true });
        if (!causal) for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '390', 'zoom-400']) {
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
            if (size === 'zoom-400') await zoom.setZoom(4); else await page.setViewportSize({ width: Number(size), height: 1000 });
            await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
            const card = diary.getByRole('button', { name: /manuale-inventato\.txt/u }); await card.evaluate(element => element.scrollIntoView({ block: 'center' })); await card.focus(); await expect(card).toBeFocused();
            await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'Diario', selector: '#diario' }]);
            if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-allegati.png`, animations: 'disabled' });
        }
        await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
        for (const source of sources) {
            const card = diary.getByRole('button', { name: new RegExp(source.name.replaceAll('.', '\\.'), 'u') }); await card.focus(); await page.keyboard.press('Enter');
            const viewer = page.getByTestId('document-viewer'); await expect(viewer).toBeVisible(); await expect(page.getByTestId('document-preview-text')).toHaveText(source.text);
            if (directory) await page.screenshot({ path: `${directory}/originale-${source.name}.png`, animations: 'disabled' });
            await viewer.getByRole('button', { name: 'Chiudi', exact: true }).click(); await expect(viewer).toHaveCount(0);
        }
        await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
        const context = page.getByRole('form', { name: 'Nuova voce clinica', exact: true }).locator(':scope > details').filter({ has: page.locator('summary').filter({ hasText: 'Consulta cartella' }) });
        await context.locator(':scope > summary').click();
        const documents = context.getByRole('region', { name: 'Documenti in cartella', exact: true });
        for (const source of sources) {
            const row = documents.locator('details').filter({ has: page.locator('summary').filter({ hasText: source.name }) });
            await row.locator(':scope > summary').click(); await expect(row).toContainText(source.summary ?? 'Sintesi non disponibile.');
        }
        expect(await snapshot()).toEqual(before); expect(writes).toEqual([]); expect(preparations).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
        if (directory) await writeFile(`${directory}/readback.json`, JSON.stringify({ fixture, attachments: before, unchanged: true, preparations, errors, external }, null, 2));
    } finally { await zoom.close(); }
});
