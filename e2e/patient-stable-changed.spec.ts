import Database from 'better-sqlite3';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession, openPatientSection } from './utils';

test.describe.configure({ retries: 0 });

test.beforeEach(({ baseURL }) => {
    const url = baseURL ? new URL(baseURL) : null;
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR ||
        !url || url.hostname !== '127.0.0.1' || url.port === '3000') throw new Error('Serve il banco sintetico su una porta dedicata.');
});

const original = 'Testo originale del referto sintetico D.';
const draft = 'Voce sintetica da rivedere.';
const sourceName = 'referto-sintetico-d.txt';

function updateSyntheticArchive(update: (database: Database.Database) => void) {
    const database = new Database(join(process.env.MEDIFLOW_DATA_DIR!, 'medical.db'), { fileMustExist: true });
    try { database.transaction(update)(database); }
    finally { database.close(); }
}

async function seed(page: Page, crowded = false, twin = false) {
    const fixture = await page.evaluate(async ({ original, sourceName, crowded, twin }) => {
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
        const visit = await post('entries', { patientId: patient.id, type: 'visit', date: '2026-02-05T10:00:00Z', title: 'Visita sintetica di riferimento', content: 'Resoconto della visita precedente.' });
        await post('entries', { patientId: patient.id, type: 'note', date: '2026-02-24T10:00:00Z', title: 'Nota successiva', content: 'Nota sintetica del diario.' });
        const activeName = twin ? 'Terapia attiva gemella' : 'Terapia corrente sintetica';
        const suspendedName = twin ? 'Terapia sospesa gemella' : 'Terapia sospesa sintetica';
        const active = await post('therapies', { patientId: patient.id, drugName: activeName, dosage: twin ? '2 alla sera' : '1 al mattino', status: 'active', startDate: '2026-01-12T12:00:00Z' });
        const changed = await post('therapies', { patientId: patient.id, drugName: suspendedName, dosage: '1 la sera', status: 'suspended', startDate: '2026-01-15T12:00:00Z' });
        await post('entries', { patientId: patient.id, type: 'phone', date: '2026-02-24T10:00:00Z', title: 'Telefonata sintetica', content: twin ? 'Contatto sintetico su un orario.' : 'Telefonata di archivio.' });
        let observationId: string | undefined;
        let previousObservationId: string | undefined;
        if (crowded) {
            for (let index = 9; index < 19; index++) {
                await post('therapies', {
                    patientId: patient.id, drugName: `Altra terapia sintetica ${index}`, dosage: '1 ogni sera', status: 'completed',
                    startDate: '2026-01-15T12:00:00Z', endDate: `2026-02-${String(index).padStart(2, '0')}T12:00:00Z`,
                });
            }
            for (let index = 17; index < 24; index++) {
                await post('entries', { patientId: patient.id, type: 'note', date: `2026-02-${index}T10:00:00Z`,
                    title: `Nota di archivio ${index}`, content: 'Testo sintetico della voce precedente.' });
            }
            const observation = await post('observations', { patientId: patient.id, codeSystem: 'LOINC', code: '2823-3', display: 'Potassio',
                unitSystem: 'UCUM', unitCode: 'mmol/L', value: twin ? 5.8 : 5.6, refHigh: '5.1', observedAt: '2026-02-18T12:00:00Z', source: 'manual' });
            observationId = observation.id;
            const previous = await post('observations', { patientId: patient.id, codeSystem: 'LOINC', code: '2823-3', display: 'Potassio',
                unitSystem: 'UCUM', unitCode: 'mmol/L', value: twin ? 4.6 : 4.8, refHigh: '5.1', observedAt: '2026-01-29T12:00:00Z', source: 'manual' });
            previousObservationId = previous.id;
            for (const name of ['referto-sintetico-precedente.txt', 'lettera-sintetica-precedente.txt']) {
                await post('attachments', { id: crypto.randomUUID(), patientId: patient.id, name, type: 'text/plain', size: original.length,
                    path: `uploads/${name}`, data: `data:text/plain;base64,${btoa(original)}` });
            }
        }
        const source = await post('attachments', { id: crypto.randomUUID(), patientId: patient.id, name: sourceName, type: 'text/plain', size: original.length,
            path: `uploads/${sourceName}`, data: `data:text/plain;base64,${btoa(original)}` });
        return { patient, other, returning, first, source, visit, active, activeName, changed, suspendedName, observationId, previousObservationId };
    }, { original, sourceName, crowded, twin });
    const at = (day: number) => Date.UTC(2026, 1, day, 12) / 1000;
    const offset = twin ? 2 : 0;
    updateSyntheticArchive(database => {
        database.prepare('UPDATE entries SET created_at = ?, recorded_by = ? WHERE id = ?').run(at(6 + offset), 'Operatrice sintetica', fixture.visit.id);
        database.prepare('UPDATE entries SET created_at = ? WHERE patient_id = ? AND id != ?').run(at(24), fixture.patient.id, fixture.visit.id);
        database.prepare("UPDATE entries SET created_at = ? WHERE patient_id = ? AND type = 'phone'").run(at(22 + offset), fixture.patient.id);
        database.prepare('UPDATE therapies SET created_at = ?, updated_at = ? WHERE patient_id = ?').run(at(1), at(1), fixture.patient.id);
        database.prepare("UPDATE therapies SET updated_at = ? WHERE patient_id = ? AND status != 'active'").run(at(13), fixture.patient.id);
        database.prepare('UPDATE therapies SET updated_at = ? WHERE id = ?').run(at(22 + offset), fixture.changed.id);
        if (fixture.observationId) database.prepare('UPDATE observations SET created_at = ? WHERE id = ?').run(at(23 + offset), fixture.observationId);
        if (fixture.previousObservationId) database.prepare('UPDATE observations SET created_at = ? WHERE id = ?').run(at(1), fixture.previousObservationId);
        if (crowded) database.prepare('UPDATE therapies SET updated_at = ?, version = 2 WHERE id = ?').run(at(22 + offset), fixture.active.id);
    });
    return fixture;
}

async function openFromPatients(page: Page, lastName: string, firstName: string, id: string) {
    await page.getByRole('link', { name: 'Pazienti', exact: true }).first().click();
    await page.getByRole('option', { name: new RegExp(`${lastName}.*${firstName}|${firstName}.*${lastName}`) }).click();
    await page.getByRole('link', { name: 'Apri scheda paziente', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${id}/modules$`));
}

async function themes(page: Page, suffix: string) {
    for (const width of [1440, 1280, 1180, 1000, 999, 768, 390, 320]) for (const theme of ['light', 'dark']) {
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
        const tracks = await page.locator('#quadro[data-overview]').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
        expect(tracks).toBe(width >= 1280 ? 3 : width >= 1000 ? 2 : 1);
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
    const changes = page.getByRole('region', { name: 'Variazioni dall’ultima visita', exact: true });
    await expect(changes).toContainText('06/02/2026');
    await expect(changes).toContainText('22/02/2026');
    await expect(changes).toContainText('Terapia sospesa sintetica');
    await expect(changes).not.toContainText('Terapia corrente sintetica');
    const items = await Promise.all([problems.getByText('Problema stabile sintetico').boundingBox(), changes.getByText('Terapia sospesa sintetica').boundingBox(),
        page.getByRole('link', { name: 'Apri il Quadro e le fonti', exact: true }).boundingBox()]);
    const [stable, changed, context] = items.map((item, index) => {
        expect(item).not.toBeNull();
        expect(item!.y).toBeGreaterThan(0);
        if (index < 2) expect(item!.y + item!.height).toBeLessThanOrEqual(660);
        return item!;
    });
    expect(changed.x).toBeLessThan(stable.x);
    expect(changed.x).toBeLessThan(context.x);
    await test.info().attach('primo-sguardo-1180x660', {
        body: JSON.stringify({ problema: stable, variazione: changed, quadro: context }, null, 2), contentType: 'application/json',
    });
    const diary = page.locator('#diario');
    await expect(diary).toContainText('Nota sintetica del diario.');
    expect((await diary.boundingBox())!.y).toBeGreaterThan(changed.y);
    await expect(changes).toContainText('Operatrice sintetica');
    await expect(changes.getByRole('link', { name: /1 telefonata/ })).toHaveAttribute('href', '#diario');
    await changes.getByText('Terapia sospesa sintetica', { exact: true }).click();
    await expect(changes).toContainText('Stato attuale: Sospesa');
    await expect(changes).toContainText('Valore precedente non conservato.');
    await changes.getByRole('button', { name: /Diario del.*Telefonata/ }).click();
    await expect(page.getByRole('region', { name: 'Voce del diario' })).toContainText('Telefonata di archivio.');
    await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Terapie attive', exact: true })).not.toContainText('Terapia sospesa sintetica');
    await expect(changes).not.toContainText(sourceName);
    await changes.getByRole('checkbox', { name: 'Mostra anche documenti e proposte' }).check();
    await expect(changes.getByRole('button', { name: /Documento aggiunto/ })).toContainText(sourceName);

    await openFromPatients(page, first.lastName, first.firstName, other.id);
    await expect(page.getByTestId('lume-scheda-header')).toContainText('Nessun identificativo per ora');
    await expect(page.getByRole('table', { name: 'Problemi', exact: true })).toContainText('Problema del primo accesso');
    await expect(page.getByText('Nessuna visita registrata.')).toBeVisible();
    await expect(changes).toHaveCount(0);
    await expect(page.locator('#quadro')).not.toContainText('Terapia sospesa sintetica');
    await expect(page.locator('#quadro')).not.toContainText(sourceName);
    await themes(page, 'primo');
});

test('D affollata: 12 variazioni, referto durante la bozza e voce registrata e riletta', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 660 });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const { patient, returning, other, first } = await seed(page, true);
    await page.reload();
    const openingStarted = performance.now();
    await openFromPatients(page, returning.lastName, returning.firstName, patient.id);
    const changes = page.getByRole('region', { name: 'Variazioni dall’ultima visita', exact: true });
    const note = page.locator('#diario article').filter({ hasText: 'Nota sintetica del diario.' });
    const potassium = changes.getByText(/Potassio.*5,6/);
    const sourceButton = page.getByRole('button', { name: `Apri originale: ${sourceName}` });
    const newEntry = page.getByRole('link', { name: 'Nuova voce', exact: true });
    await expect(note).toBeVisible();
    await expect(changes).toContainText('Fuori intervallo');
    await expect(changes.getByText('Terapia corrente sintetica', { exact: true })).toBeVisible();
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
        geometry(changes.getByText('Terapia sospesa sintetica', { exact: true })), geometry(note), geometry(potassium),
        geometry(sourceButton), geometry(newEntry),
    ]);
    if (directory) await page.screenshot({ path: `${directory}/affollata-1180.png`, animations: 'disabled' });
    await expect(changes.locator('li:visible')).toHaveCount(13);
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
    await expect(page.getByTestId('document-preview-text')).toHaveText(original);
    await expect(editor).toHaveText(draft);
    const sourceMs = Math.round(performance.now() - sourceStarted);
    const resumeStarted = performance.now();
    await page.getByRole('button', { name: 'Torna alla bozza', exact: true }).click();
    await expect(editor).toBeFocused();
    const resumeMs = Math.round(performance.now() - resumeStarted);
    expect(await selection()).toEqual(before);
    await page.getByRole('button', { name: 'Rivedi', exact: true }).click();
    const review = page.getByRole('region', { name: 'Riepilogo della voce' });
    await expect(review).toContainText(returning.lastName);
    await expect(review).toContainText(draft);
    if (directory) await page.screenshot({ path: `${directory}/revisione-1180.png`, animations: 'disabled' });
    await page.getByRole('button', { name: 'Torna alla bozza', exact: true }).click();
    await expect(editor).toBeFocused();
    expect(await selection()).toEqual(before);
    await page.getByRole('button', { name: 'Rivedi', exact: true }).click();

    const tab = page.getByRole('navigation', { name: 'Cartelle aperte' }).getByRole('link', { name: new RegExp(`${returning.lastName} ${returning.firstName}`) });
    await expect(tab.getByLabel('Bozza conservata')).toBeVisible();
    await openFromPatients(page, first.lastName, first.firstName, other.id);
    await expect(page.getByText('Nessuna visita registrata.')).toBeVisible();
    await expect(page.locator('#quadro')).not.toContainText(draft);
    await tab.click();
    await expect(review).toContainText(draft);

    const saveStarted = performance.now();
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/entries' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Conferma e registra', exact: true }).click();
    const savedResponse = await saved;
    const responseMs = Math.round(performance.now() - saveStarted);
    expect(savedResponse.status()).toBe(201);
    const { id: entryId } = await savedResponse.json() as { id: string };
    const receipt = page.getByRole('region', { name: 'Esito della registrazione' });
    await expect(receipt).toContainText('Registrata alle');
    await expect(receipt).toContainText(draft);
    await expect(changes).toContainText('06/02/2026');
    if (directory) await page.screenshot({ path: `${directory}/rilettura-1180.png`, animations: 'disabled' });
    const readbackMs = Math.round(performance.now() - saveStarted);
    await page.getByRole('link', { name: 'Chiudi la voce', exact: true }).click();
    await page.reload();
    await expect(page.getByText(/nessuna variazione registrata/)).toBeVisible();
    await expect(page.locator('#diario article').filter({ hasText: draft })).toHaveCount(1);
    const audit = await page.evaluate(async () => {
        const response = await fetch('/api/system/audit?eventType=entry.created');
        if (!response.ok) throw new Error(`Audit sintetico: ${response.status}`);
        return response.json() as Promise<{ subjectRef: string; outcome: string }[]>;
    });
    expect(audit.filter(event => event.subjectRef === entryId)).toEqual([expect.objectContaining({ outcome: 'success' })]);
    await test.info().attach('ritorno-affollato', {
        body: JSON.stringify({ viewport: [1180, 660], therapyUpdates: 12, outOfRange: 1,
            geometry: { change: frame[0], latestNote: frame[1], potassium: frame[2], source: frame[3], write: frame[4], potassiumAfterScroll },
            actions: ['Pazienti', 'Seleziona paziente', 'Apri scheda paziente', 'Scorri le variazioni',
                'Nuova voce', 'Scrivi il testo', 'Apri originale', 'Torna alla bozza', 'Rivedi', 'Torna alla bozza', 'Rivedi', 'Conferma e registra', 'Esito', 'Ricarica'],
            cursor: { before, afterReview: before, restored: true },
            browserMs: { openingMs, sourceMs, resumeMs, responseMs, readbackMs } }, null, 2),
        contentType: 'application/json',
    });
    await expect(page.locator('#diario article').filter({ hasText: draft })).toBeVisible();
});

test('D gemella: un contatto nello stesso giorno si legge come voce, e una lettura fallita resta esplicita', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 780 });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const { patient, returning, activeName, suspendedName } = await seed(page, true, true);
    await page.reload();
    await openFromPatients(page, returning.lastName, returning.firstName, patient.id);
    const changes = page.getByRole('region', { name: 'Variazioni dall’ultima visita', exact: true });
    const stable = page.getByRole('table', { name: 'Terapie attive', exact: true });
    await expect(changes).toContainText('08/02/2026');
    await expect(stable.getByRole('row').filter({ hasText: activeName })).toContainText('2 alla sera');
    await expect(stable).not.toContainText(suspendedName);
    await changes.getByText(/Potassio.*5,8/).click();
    await expect(changes).toContainText('4,6 mmol/L');
    await changes.getByText(suspendedName, { exact: true }).click();
    await changes.getByRole('button', { name: /Diario del.*Telefonata/ }).click();
    await expect(page.getByRole('region', { name: 'Voce del diario' })).toContainText('Contatto sintetico su un orario.');
    await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await expect(changes).not.toContainText('Contatto sintetico su un orario.');

    await page.route('**/api/observations?**', route => route.fulfill({ status: 503, json: { error: 'Lettura sintetica non disponibile' } }));
    await page.reload();
    await expect(changes).toContainText('Confronto incompleto. Alcuni dati non sono disponibili.');
    await expect(changes).not.toContainText('nessuna variazione');
});


test('D: due misure dello stesso codice in unità diverse restano distinte nella fascia e nel registro', async ({ page }) => {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const { patient, returning } = await seed(page);
    await page.evaluate(async patientId => {
        for (const row of [
            { value: 68_600, unitCode: 'g', refHigh: '65000', observedAt: '2026-02-18T12:00:00Z' },
            { value: 72, unitCode: 'kg', refHigh: '70', observedAt: '2026-02-19T12:00:00Z' },
        ]) {
            const response = await fetch('/api/observations', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
                    patientId, codeSystem: 'LOINC', code: '29463-7', display: 'Peso', unitSystem: 'UCUM', source: 'manual', ...row,
                }),
            });
            if (!response.ok) throw new Error(`Misura sintetica ${response.status}`);
        }
    }, patient.id);
    await page.reload();
    await openFromPatients(page, returning.lastName, returning.firstName, patient.id);
    const changes = page.getByRole('region', { name: 'Variazioni dall’ultima visita', exact: true });
    const grams = /Peso.*68[.]?600 g/u;
    const kilograms = /Peso.*72 kg/u;
    await changes.getByText(grams).click();
    await changes.getByText(kilograms).click();
    await expect(changes.getByText('Nessuna misura precedente nella stessa unità.', { exact: true })).toHaveCount(2);
    await expect(changes).not.toContainText(/→|68[.,]?600 kg|72 g\b/u);
    const recent = page.getByRole('table', { name: 'Parametri recenti', exact: true });
    await expect(recent.getByRole('row').filter({ hasText: grams })).toHaveCount(1);
    await expect(recent.getByRole('row').filter({ hasText: kilograms })).toHaveCount(1);
    await openPatientSection(page, 'parametri');
    const records = page.locator('#parametri');
    for (const reading of [grams, kilograms]) {
        const row = records.getByRole('table').first().getByRole('row').filter({ hasText: reading });
        await expect(row).toBeVisible();
        await expect(row.getByRole('cell').last()).toHaveText('—');
    }
    await expect(records).not.toContainText(/68[.,]?600 kg|72 g\b/u);
});

test('D: il solo referto aggiunto dopo la visita è raggiungibile e apre l’originale', async ({ page }) => {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const { patient, returning, visit } = await seed(page);
    updateSyntheticArchive(database => {
        const old = Date.UTC(2026, 1, 4, 12) / 1000;
        database.prepare('UPDATE therapies SET created_at = ?, updated_at = ? WHERE patient_id = ?').run(old, old, patient.id);
        database.prepare('UPDATE entries SET created_at = ? WHERE patient_id = ? AND id != ?').run(old, patient.id, visit.id);
    });
    await page.reload();
    await openFromPatients(page, returning.lastName, returning.firstName, patient.id);
    const changes = page.getByRole('region', { name: 'Variazioni dall’ultima visita', exact: true });
    await expect(changes.locator('li')).toHaveCount(0);
    const disclosure = changes.getByRole('checkbox', { name: 'Mostra anche documenti e proposte' });
    await disclosure.check();
    await expect(changes.locator('li')).toHaveCount(1);
    const document = changes.getByRole('button', { name: `Documento aggiunto · ${sourceName}` });
    await document.click();
    await expect(page.getByTestId('document-preview-text')).toHaveText(original);
    await page.getByTestId('document-viewer').getByRole('button', { name: 'Chiudi', exact: true }).click();
    await expect(document).toBeFocused();
    await disclosure.uncheck();
    await expect(changes.locator('li')).toHaveCount(0);
});
