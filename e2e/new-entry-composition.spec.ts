import { expect, test, type Locator } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow, openPatientSection } from './utils';

test('Nuova voce: Quadro, bozza unica, uscita protetta e registrazione con fonte', async ({ baseURL }) => {
    test.setTimeout(180_000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw new Error('Runtime e archivio sintetici isolati richiesti');
    const baseline = process.env.NEW_ENTRY_BASELINE === '1', causal = process.env.NEW_ENTRY_CAUSAL === '1';
    const directory = process.env.NEW_ENTRY_SCREENSHOTS, surfaces: unknown[] = [];
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const errors: string[] = [], external: string[] = [], preparations: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') console.log('Browser error:', message.text()); });
    page.on('requestfailed', request => console.log('Request failed:', request.url(), request.failure()?.errorText));
    page.on('request', request => { if (request.method() === 'POST') {
        if (/\/api\/(ai|visit-session)\//u.test(request.url())) preparations.push(request.url());
        if (/\/api\/(entries|attachments)$/u.test(request.url())) writes.push(request.url());
    } });
    await page.route('**/api/siss/session-status', route => route.fulfill({ json: { status: 'unavailable', source: 'atlas-history', checkedAt: '2026-10-26T10:00:00Z', browserProfile: null, warning: 'Fixture sintetica: nessuna osservazione reale.', sessionHealth: 'none', lastModule: null, lastModuleLabel: null, lastModuleAt: null, checkpoints: [] } }));
    await page.route('**/*', route => {
        if (new URL(route.request().url()).origin !== new URL(baseURL).origin) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
    });
    try {
        await bootstrapUnlockedSession(page, '1234');
        const fixture = await page.evaluate(async () => {
            const post = async (path: string, body: unknown) => { const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(`${path}: ${response.status}`); return response.json(); };
            const patient = await post('patients', { firstName: 'Voce', lastName: 'Sintetica', taxCode: `N16${crypto.randomUUID().replaceAll('-', '').slice(0, 13).toUpperCase()}`, birthDate: '1980-01-01', diagnoses: [{ code: 'SYN16', system: 'ICD-10', description: 'Problema inventato W16' }] });
            const old = await post('entries', { patientId: patient.id, type: 'note', date: '2026-10-20', title: 'Nota precedente inventata', content: '<p>Testo precedente originale W16.</p>', metadata: { authorName: 'Ada Sintetica', sourceLabel: 'Fonte storica W16' } });
            await post('therapies', { patientId: patient.id, drugName: 'Farmaco inventato W16', dosage: 'Dose inventata', status: 'active', startDate: '2026-10-01' });
            await post('observations', { patientId: patient.id, codeSystem: 'LOINC', code: 'SYN16', display: 'Peso inventato W16', unitSystem: 'UCUM', unitCode: 'kg', value: 70, observedAt: '2026-10-20', source: 'manual' });
            await post('checkups', { patientId: patient.id, title: 'Controllo inventato W16', date: '2026-11-01', status: 'pending' });
            return { patientId: patient.id as string, oldEntryId: old.id as string };
        });
        writes.length = 0;
        await page.goto(`/patients/${fixture.patientId}/entries/new`);
        const composer = page.getByTestId('progressive-entry-composer'), form = page.locator('form[aria-label="Nuova voce clinica"]');
        const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
        await expect(form).toBeVisible(); await expect(editor).toHaveCount(1);
        await expect(composer.locator('header')).toContainText('Sintetica Voce');
        const capture = async (state: string, anchor: Locator) => {
            if (causal) return;
            if (directory) await mkdir(directory, { recursive: true });
            for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
                await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
                if (size.startsWith('zoom-')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4); else await page.setViewportSize({ width: Number(size), height: 1000 });
                await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
                await anchor.evaluate(element => element.scrollIntoView({ block: 'center' }));
                await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'composer', selector: '[data-testid="progressive-entry-composer"]' }]);
                if (state === 'bozza' && !baseline) {
                    const consult = page.getByRole('button', { name: 'Consulta il Quadro', exact: true });
                    if (await consult.isVisible()) {
                        await consult.click(); await expect(form).toHaveCount(1); await expect(form).toBeHidden();
                        await expect(page.getByRole('heading', { name: 'Quadro', exact: true })).toBeFocused();
                        if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-quadro.png`, animations: 'disabled' });
                        const resume = page.getByRole('button', { name: 'Riprendi la bozza', exact: true }); await resume.focus(); await page.keyboard.press('Enter');
                        await expect(editor).toBeFocused(); await expect(editor).toContainText('Resoconto originale sintetico W16.');
                        await expect(page.getByRole('textbox', { name: 'Bozza o transcript', exact: true })).toHaveValue('Testo dettato manualmente W16.');
                        await expect(page.getByRole('checkbox', { name: 'Ho rivisto questa proposta prima di usarla nel resoconto.', exact: true })).toBeChecked();
                        await expect(form).toContainText('fonte-inventata-W16.txt');
                        await expect(page.getByLabel('Data e ora della voce clinica')).toHaveValue('2026-10-21T09:30');
                    }
                }
                if (state === 'uscita') {
                    const cancel = page.getByRole('button', { name: 'Continua a scrivere', exact: true }); await cancel.focus(); await expect(cancel).toBeFocused();
                    await expect.poll(() => cancel.evaluate(element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return element === hit || element.contains(hit); })).toBe(true);
                }
                if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-${state}.png`, animations: 'disabled' });
                surfaces.push({ theme, size, state, cssWidth: await page.evaluate(() => innerWidth) });
            }
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
        };
        await capture('apertura', editor);
        if (!baseline || causal) { await expect(composer.getByRole('region', { name: 'Riepilogo clinico', exact: true })).toBeVisible(); await expect(composer).toContainText('Problema inventato W16'); if (!causal) await expect(page.getByRole('button', { name: 'Consulta il Quadro', exact: true })).toBeHidden(); }
        await editor.fill('Resoconto originale sintetico W16.');
        await page.getByRole('combobox', { name: 'Luogo della voce clinica', exact: true }).selectOption('home');
        await page.getByLabel('Data e ora della voce clinica').fill('2026-10-21T09:30');
        await page.locator('input[type="file"]').setInputFiles({ name: 'fonte-inventata-W16.txt', mimeType: 'text/plain', buffer: Buffer.from('Originale sintetico W16, da conservare con la voce.') });
        const session = page.locator('details#sessione-visita'); await session.locator(':scope > summary').click();
        const transcript = page.getByRole('textbox', { name: 'Bozza o transcript', exact: true }); await transcript.fill('Testo dettato manualmente W16.');
        const reviewed = page.getByRole('checkbox', { name: 'Ho rivisto questa proposta prima di usarla nel resoconto.', exact: true });
        const insert = page.getByRole('button', { name: 'Inserisci nel resoconto', exact: true }); await expect(insert).toBeDisabled(); await reviewed.check(); await expect(insert).toBeEnabled();
        await capture('bozza', editor);
        if (!baseline) {
            await page.setViewportSize({ width: 390, height: 1000 });
            await page.getByRole('button', { name: 'Consulta il Quadro', exact: true }).click();
            await expect(form).toHaveCount(1); await expect(form).toBeHidden();
            await expect(page.getByRole('heading', { name: 'Quadro', exact: true })).toBeFocused();
            const resume = page.getByRole('button', { name: 'Riprendi la bozza', exact: true }); await resume.focus(); await page.keyboard.press('Enter'); await expect(editor).toBeFocused();
            await expect(editor).toContainText('Resoconto originale sintetico W16.'); await expect(transcript).toHaveValue('Testo dettato manualmente W16.'); await expect(reviewed).toBeChecked();
            await expect(form).toContainText('fonte-inventata-W16.txt');
                        await expect(page.getByLabel('Data e ora della voce clinica')).toHaveValue('2026-10-21T09:30'); await expect(page.getByRole('combobox', { name: 'Luogo della voce clinica', exact: true })).toHaveValue('home');
            await page.setViewportSize({ width: 1440, height: 1000 });
        }
        await composer.getByRole('link', { name: 'Torna alla scheda paziente', exact: true }).click();
        const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('Le modifiche non salvate andranno perse.'); await capture('uscita', dialog);
        await page.getByRole('button', { name: 'Continua a scrivere', exact: true }).click(); await expect(editor).toContainText('Resoconto originale sintetico W16.');
        expect(writes).toEqual([]); await expect(reviewed).toBeChecked(); await insert.click(); await expect(editor).toContainText('Testo dettato manualmente W16.');
        await page.getByRole('button', { name: 'Registra nel diario', exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/patients/${fixture.patientId}/modules$`));
        expect(writes.filter(url => url.endsWith('/entries'))).toHaveLength(1); expect(writes.filter(url => url.endsWith('/attachments'))).toHaveLength(1);
        const result = await page.evaluate(async id => (await fetch(`/api/entries?patientId=${id}`)).json(), fixture.patientId);
        expect(result).toHaveLength(2); const saved = result.find((entry: { id: string }) => entry.id !== fixture.oldEntryId);
        expect(saved).toMatchObject({ version: 1, setting: 'home', type: 'visit' });
        expect(saved.date).toBe(await page.evaluate(() => new Date('2026-10-21T09:30').toISOString())); expect(saved.attachments).toMatch(/^ENC:/u);
        expect(saved.content).toMatch(/^ENC:/u);
        await openPatientSection(page, 'diario');
        const savedRow = page.locator('#diario article').filter({ hasText: 'Resoconto originale sintetico W16.' });
        await expect(savedRow).toContainText('Testo dettato manualmente W16.'); await expect(savedRow.getByRole('button', { name: /fonte-inventata-W16.txt/u })).toBeVisible();
        if (directory) await page.screenshot({ path: `${directory}/manual-upload-label-existing.png`, animations: 'disabled' });
        await savedRow.getByRole('button', { name: /fonte-inventata-W16.txt/u }).click();
        await expect(page.getByTestId('document-preview-text')).toHaveText('Originale sintetico W16, da conservare con la voce.');
        await page.getByTestId('document-viewer').getByRole('button', { name: 'Chiudi', exact: true }).click();
        await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
        await editor.fill('Bozza inventata da abbandonare senza scrivere W16.');
        await composer.getByRole('link', { name: 'Torna alla scheda paziente', exact: true }).click();
        await zoom.setZoom(4);
        await expect.poll(() => page.getByRole('dialog').evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= -1 && box.bottom <= innerHeight + 1; })).toBe(true);
        const leave = page.getByRole('button', { name: 'Esci senza salvare', exact: true });
        await page.getByRole('button', { name: 'Continua a scrivere', exact: true }).focus(); await page.keyboard.press('Tab');
        await expect(leave).toBeFocused();
        await expect.poll(() => leave.evaluate(element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return element === hit || element.contains(hit); })).toBe(true);
        await leave.click(); await expect(page).toHaveURL(new RegExp(`/patients/${fixture.patientId}/modules$`));
        expect(writes).toHaveLength(2); await zoom.setZoom(1);
        await page.getByRole('link', { name: 'Nuova voce', exact: true }).click(); await expect(editor).toHaveText('');
        if (directory) await writeFile(`${directory}/surfaces.json`, JSON.stringify({ fixture, savedEntryId: saved.id, surfaces, errors, external, preparations }, null, 2));
        expect(errors).toEqual([]); expect(external).toEqual([]); expect(preparations).toEqual([]);
    } catch (error) { console.log(JSON.stringify({ errors, external, preparations, writes })); throw error; } finally { await zoom.close(); }
});

test('Quadro in scrittura distingue lettura, errore e paziente non disponibile', async ({ page, baseURL }) => {
    test.skip(process.env.NEW_ENTRY_BASELINE === '1', 'Il Quadro non esiste nella composizione precedente');
    test.setTimeout(90_000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw new Error('Runtime e archivio sintetici isolati richiesti');
    await bootstrapUnlockedSession(page, '1234');
    const patientId = await page.evaluate(async () => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'Quadro', lastName: 'Lettura sintetica', taxCode: `N16${crypto.randomUUID().replaceAll('-', '').slice(0, 13).toUpperCase()}`, birthDate: '1980-01-01', diagnoses: [] }) });
        if (!response.ok) throw new Error(`Synthetic patient: ${response.status}`); return (await response.json()).id as string;
    });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    for (const name of ['therapies', 'observations', 'checkups', 'entries']) await page.route(`**/api/${name}?**`, async route => {
        if (new URL(route.request().url()).searchParams.get('patientId') !== patientId) return route.continue();
        await pending; return route.fulfill({ status: name === 'entries' ? 503 : 500, json: { error: 'Lettura sintetica indisponibile' } });
    });
    try {
        await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`/patients/${patientId}/entries/new`);
        const quadro = page.getByRole('region', { name: 'Riepilogo clinico', exact: true });
        for (const name of ['Terapie attive', 'Misure recenti', 'Controlli aperti']) {
            const section = quadro.getByRole('region', { name, exact: true });
            await expect(section.getByRole('status')).toContainText('in corso'); await expect(section).not.toContainText(/Nessun[ao]? /u);
        }
        const previous = page.getByRole('region', { name: 'Ultime voci registrate', exact: true });
        await expect(previous.getByRole('status')).toContainText('Lettura'); await expect(previous).not.toContainText('Nessuna voce recente');
        release();
        await expect(previous.getByRole('alert')).toHaveText('Voci precedenti non disponibili.'); await expect(previous).not.toContainText('Nessuna voce recente');
        for (const name of ['Terapie attive', 'Misure recenti', 'Controlli aperti']) {
            const section = quadro.getByRole('region', { name, exact: true });
            await expect(section.getByRole('alert')).toContainText('Impossibile leggere'); await expect(section).not.toContainText(/Nessun[ao]? /u);
            await expect(section.locator('table')).toHaveCount(0);
        }
        if (process.env.NEW_ENTRY_SCREENSHOTS) {
            await mkdir(process.env.NEW_ENTRY_SCREENSHOTS, { recursive: true });
            for (const theme of ['giorno', 'grafite']) for (const width of [1440, 768]) {
                await page.setViewportSize({ width, height: 1000 }); await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
                await quadro.scrollIntoViewIfNeeded(); await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }]);
                await page.screenshot({ path: `${process.env.NEW_ENTRY_SCREENSHOTS}/${theme}-${width}-errore-quadro.png`, animations: 'disabled' });
            }
        }
        await page.route(`**/api/patients/${patientId}`, route => route.fulfill({ status: 404, json: { error: 'Synthetic not found' } }));
        await page.reload();
        await expect(page.getByRole('alert').filter({ hasText: 'Paziente non disponibile. Il Quadro non può essere letto.' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Riepilogo clinico', exact: true })).toHaveCount(0);
        await expect(page.getByTestId('progressive-entry-composer').locator('header')).toContainText('Paziente non disponibile.');
    } finally { release(); }
});
