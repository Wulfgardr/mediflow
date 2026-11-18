import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession } from './utils';

test.describe.configure({ retries: 0 });

test.beforeEach(({ baseURL }) => {
    const url = baseURL ? new URL(baseURL) : null;
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR ||
        !url || url.hostname !== '127.0.0.1' || url.port === '3000') throw new Error('Serve il banco sintetico su una porta dedicata.');
});

const original = 'Testo originale del referto sintetico D.';
const draft = 'Voce sintetica da rivedere.';
const sourceName = 'referto-sintetico-d.txt';

async function seed(page: Page, crowded = false) {
    return page.evaluate(async ({ original, sourceName, crowded }) => {
        async function post(entity: string, body: object) {
            const response = await fetch(`/api/${entity}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error(`Fixture ${entity}: ${response.status}`);
            return response.json() as Promise<{ id: string }>;
        }
        const suffix = crypto.randomUUID().slice(0, 6);
        const returning = { firstName: 'Ritorno', lastName: `Sintetica D ${suffix}`, identifierType: 'none', taxCode: '', birthDatePrecision: 'estimated', birthYear: 1984,
            diagnoses: [{ code: 'I50.9', description: 'Problema stabile sintetico', system: 'ICD-10', date: '2026-01-12' }] };
        const first = { firstName: 'Primo', lastName: `Sintetica D ${suffix}`, identifierType: 'none', taxCode: '', birthDatePrecision: 'estimated', birthYear: 1991,
            diagnoses: [{ code: 'J45.9', description: 'Problema del primo accesso', system: 'ICD-10' }] };
        const patient = await post('patients', returning);
        const other = await post('patients', first);
        await post('entries', { patientId: patient.id, type: 'visit', date: '2026-02-05T10:00:00Z', title: 'Visita sintetica di riferimento', content: 'Resoconto della visita precedente.' });
        await post('entries', { patientId: patient.id, type: 'note', date: '2026-02-24T10:00:00Z', title: 'Nota successiva', content: 'Nota sintetica del diario.' });
        await post('therapies', { patientId: patient.id, drugName: 'Terapia corrente sintetica', dosage: '1 al mattino', status: 'active', startDate: '2026-01-12T12:00:00Z' });
        await post('therapies', { patientId: patient.id, drugName: 'Terapia conclusa sintetica', dosage: '1 la sera', status: 'completed', startDate: '2026-01-15T12:00:00Z', endDate: '2026-02-20T12:00:00Z' });
        if (crowded) {
            for (let index = 9; index < 20; index++) {
                await post('therapies', {
                    patientId: patient.id, drugName: `Altra terapia sintetica ${index}`, dosage: '1 ogni sera', status: 'completed',
                    startDate: '2026-01-15T12:00:00Z', endDate: `2026-02-${String(index).padStart(2, '0')}T12:00:00Z`,
                });
            }
            for (let index = 17; index < 24; index++) {
                await post('entries', { patientId: patient.id, type: 'note', date: `2026-02-${index}T10:00:00Z`,
                    title: `Nota di archivio ${index}`, content: 'Testo sintetico della voce precedente.' });
            }
            await post('observations', { patientId: patient.id, codeSystem: 'LOINC', code: '2823-3', display: 'Potassio',
                unitSystem: 'UCUM', unitCode: 'mmol/L', value: 5.6, refHigh: '5.1', observedAt: '2026-02-18T12:00:00Z', source: 'manual' });
            for (const name of ['referto-sintetico-precedente.txt', 'lettera-sintetica-precedente.txt']) {
                await post('attachments', { id: crypto.randomUUID(), patientId: patient.id, name, type: 'text/plain', size: original.length,
                    path: `uploads/${name}`, data: `data:text/plain;base64,${btoa(original)}` });
            }
        }
        const source = await post('attachments', { id: crypto.randomUUID(), patientId: patient.id, name: sourceName, type: 'text/plain', size: original.length,
            path: `uploads/${sourceName}`, data: `data:text/plain;base64,${btoa(original)}` });
        return { patient, other, returning, first, source };
    }, { original, sourceName, crowded });
}

async function openFromPatients(page: Page, lastName: string, firstName: string, id: string) {
    await page.getByRole('link', { name: 'Pazienti', exact: true }).first().click();
    await page.getByRole('option', { name: new RegExp(`${lastName}.*${firstName}|${firstName}.*${lastName}`) }).click();
    await page.getByRole('link', { name: 'Apri scheda paziente', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${id}/modules$`));
}

async function themes(page: Page, suffix: string) {
    for (const width of [1440, 1180, 768, 390, 320]) for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 660 });
        await page.evaluate(value => {
            localStorage.setItem('mediflow-theme', value);
            document.documentElement.classList.toggle('light', value === 'light');
            document.documentElement.classList.toggle('dark', value === 'dark');
        }, theme);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const dir = process.env.MEDIFLOW_STABLE_CHANGED_SCREENSHOTS;
        if (dir) await page.screenshot({ path: `${dir}/${suffix}-${width}-${theme}.png`, animations: 'disabled' });
        await assertNoHorizontalOverflow(page, [{ label: 'Scheda', selector: '#quadro' }]);
    }
    await page.setViewportSize({ width: 1180, height: 660 });
}

test('D: dalla lista, primo sguardo al ritorno e cartella senza storico al cambio paziente', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 660 });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const { patient, other, returning, first } = await seed(page);
    await page.reload();
    await openFromPatients(page, returning.lastName, returning.firstName, patient.id);

    const problems = page.getByRole('table', { name: 'Problemi', exact: true });
    await expect(problems).toContainText('Problema stabile sintetico');
    await expect(page.getByRole('table', { name: 'Terapie attive', exact: true })).toContainText('Terapia corrente sintetica');
    await themes(page, 'ritorno');
    const changes = page.getByRole('region', { name: 'Variazioni di terapia', exact: true });
    await expect(changes).toContainText('Dopo la visita del 05/02/2026');
    await expect(changes).toContainText('20/02/2026');
    await expect(changes).toContainText('Terapia conclusa sintetica');
    await expect(changes).not.toContainText('Terapia corrente sintetica');
    const items = await Promise.all([problems.getByText('Problema stabile sintetico').boundingBox(), changes.getByText('Terapia conclusa sintetica').boundingBox(),
        page.getByRole('link', { name: 'Quadro paziente', exact: true }).boundingBox()]);
    const [stable, changed, context] = items.map(item => {
        expect(item).not.toBeNull();
        expect(item!.y).toBeGreaterThan(0);
        expect(item!.y + item!.height).toBeLessThanOrEqual(660);
        return item!;
    });
    expect(stable.x).toBeLessThan(changed.x);
    expect(changed.x).toBeLessThan(context.x);
    await test.info().attach('primo-sguardo-1180x660', {
        body: JSON.stringify({ problema: stable, variazione: changed, quadro: context }, null, 2), contentType: 'application/json',
    });
    const diary = page.locator('#diario');
    await expect(diary).toContainText('Nota sintetica del diario.');
    expect((await diary.boundingBox())!.y).toBeGreaterThan(changed.y);
    await changes.getByText('Fonti del confronto').click();
    await expect(changes.getByRole('link', { name: 'Apri Terapie' })).toBeVisible();

    await openFromPatients(page, first.lastName, first.firstName, other.id);
    await expect(page.getByTestId('lume-scheda-header')).toContainText('Nessun identificativo per ora');
    await expect(page.getByRole('table', { name: 'Problemi', exact: true })).toContainText('Problema del primo accesso');
    await expect(page.getByText('Nessuna visita precedente disponibile per il confronto.')).toBeVisible();
    await expect(changes).toHaveCount(0);
    await expect(page.locator('#quadro')).not.toContainText('Terapia conclusa sintetica');
    await expect(page.locator('#quadro')).not.toContainText(sourceName);
    await themes(page, 'primo');
});

test('D affollata: 12 variazioni, referto durante la bozza e voce registrata e riletta', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 660 });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const { patient, returning } = await seed(page, true);
    await page.reload();
    const openingStarted = performance.now();
    await openFromPatients(page, returning.lastName, returning.firstName, patient.id);
    const changes = page.getByRole('region', { name: 'Variazioni di terapia', exact: true });
    const note = page.locator('#diario article').filter({ hasText: 'Nota sintetica del diario.' });
    const potassium = page.getByRole('region', { name: 'Parametri recenti', exact: true }).getByRole('row').filter({ hasText: '5,6' });
    const sourceButton = page.getByRole('button', { name: `Apri originale: ${sourceName}` });
    const newEntry = page.getByRole('link', { name: 'Nuova voce', exact: true });
    await expect(note).toBeVisible();
    await expect(potassium).toContainText('alto');
    await expect(sourceButton).toBeVisible();
    const openingMs = Math.round(performance.now() - openingStarted);
    const directory = process.env.MEDIFLOW_STABLE_CHANGED_SCREENSHOTS;
    const geometry = async (target: Locator) => target.evaluate(element => {
        const box = element.getBoundingClientRect();
        let workAreaBottom = innerHeight;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (['auto', 'scroll', 'clip', 'hidden'].includes(getComputedStyle(parent).overflowY)) {
                workAreaBottom = Math.min(workAreaBottom, parent.getBoundingClientRect().bottom);
            }
        }
        return { x: Math.round(box.x), y: Math.round(box.y), bottom: Math.round(box.bottom), workAreaBottom,
            topBeyondBottomPx: Math.max(0, Math.round(box.y - workAreaBottom)),
            bottomBeyondBottomPx: Math.max(0, Math.round(box.bottom - workAreaBottom)) };
    });
    const frame = await Promise.all([
        geometry(changes.getByText('Terapia conclusa sintetica', { exact: true })), geometry(note), geometry(potassium),
        geometry(sourceButton), geometry(newEntry),
    ]);
    if (directory) await page.screenshot({ path: `${directory}/affollata-1180.png`, animations: 'disabled' });
    await expect(changes.locator('li:visible')).toHaveCount(2);
    await changes.getByText('Altre variazioni e fonti', { exact: true }).click();
    await expect(changes.locator('li:visible')).toHaveCount(12);
    const openedComparisonNote = await geometry(note);
    await changes.getByText('Altre variazioni e fonti', { exact: true }).click();
    if (frame[2].bottomBeyondBottomPx > 0) await potassium.scrollIntoViewIfNeeded();
    const potassiumAfterScroll = await geometry(potassium);
    expect(potassiumAfterScroll.bottomBeyondBottomPx).toBe(0);
    await newEntry.click();
    await expect(page.getByRole('combobox', { name: 'Tipo di voce', exact: true })).toBeFocused();
    const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
    await editor.fill(draft);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const selection = () => page.evaluate(() => [getSelection()?.anchorOffset, getSelection()?.focusOffset]);
    if (directory) await page.screenshot({ path: `${directory}/scrittura-1180.png`, animations: 'disabled' });
    const before = await selection();
    expect(before[0]).toBe(2);
    const sourceStarted = performance.now();
    await sourceButton.click();
    await expect(page.getByRole('dialog').getByTestId('document-preview-text')).toHaveText(original);
    const sourceMs = Math.round(performance.now() - sourceStarted);
    const resumeStarted = performance.now();
    await page.getByRole('dialog').getByRole('button', { name: 'Chiudi', exact: true }).click();
    await expect(editor).toBeFocused();
    const resumeMs = Math.round(performance.now() - resumeStarted);
    expect(await selection()).toEqual(before);
    await page.getByRole('button', { name: 'Rivedi', exact: true }).click();
    const review = page.getByRole('region', { name: 'Riepilogo della voce' });
    await expect(review).toContainText(returning.lastName);
    await expect(review).toContainText(draft);
    if (directory) await page.screenshot({ path: `${directory}/revisione-1180.png`, animations: 'disabled' });
    await page.getByRole('button', { name: 'Torna a scrivere', exact: true }).click();
    await expect(editor).toBeFocused();
    expect(await selection()).toEqual(before);
    await page.getByRole('button', { name: 'Rivedi', exact: true }).click();

    const saveStarted = performance.now();
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/entries' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Registra nel diario', exact: true }).click();
    const savedResponse = await saved;
    const responseMs = Math.round(performance.now() - saveStarted);
    expect(savedResponse.status()).toBe(201);
    const { id: entryId } = await savedResponse.json() as { id: string };
    await expect(page).toHaveURL(/#diario$/);
    const registered = page.locator('#diario article').filter({ hasText: draft });
    await expect(registered).toBeVisible();
    await expect(registered).toContainText('Registrata da');
    const readbackMs = Math.round(performance.now() - saveStarted);
    await page.reload();
    await expect(page.locator('#diario article').filter({ hasText: draft })).toHaveCount(1);
    const audit = await page.evaluate(async () => {
        const response = await fetch('/api/system/audit?eventType=entry.created');
        if (!response.ok) throw new Error(`Audit sintetico: ${response.status}`);
        return response.json() as Promise<{ subjectRef: string; outcome: string }[]>;
    });
    expect(audit.filter(event => event.subjectRef === entryId)).toEqual([expect.objectContaining({ outcome: 'success' })]);
    await test.info().attach('ritorno-affollato', {
        body: JSON.stringify({ viewport: [1180, 660], total: 12, visibleChanges: 2,
            geometry: { change: frame[0], latestNote: frame[1], potassium: frame[2], source: frame[3], write: frame[4], openedComparisonNote, potassiumAfterScroll },
            actions: ['Pazienti', 'Seleziona paziente', 'Apri scheda paziente', 'Altre variazioni e fonti', 'Richiudi variazioni',
                'Nuova voce', 'Scrivi il testo', 'Apri originale', 'Chiudi originale', 'Rivedi', 'Torna a scrivere', 'Rivedi', 'Registra nel diario', 'Ricarica'],
            cursor: { before, afterReview: before, restored: true },
            browserMs: { openingMs, sourceMs, resumeMs, responseMs, readbackMs } }, null, 2),
        contentType: 'application/json',
    });
    await expect(page.locator('#diario article').filter({ hasText: draft })).toBeVisible();
});
