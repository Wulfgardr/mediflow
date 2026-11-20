import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { diaryEntrySealer } from './fixtures/sealed-diary-entry';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession, openUnlockedDocument } from './utils';

test.describe.configure({ retries: 0 });

test.beforeEach(({ baseURL }) => {
    const url = baseURL ? new URL(baseURL) : null;
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR ||
        !url || url.hostname !== '127.0.0.1' || url.port === '3000') throw new Error('Serve il banco sintetico su una porta dedicata.');
});

const shots = process.env.MEDIFLOW_ISLANDS_SCREENSHOTS;
const day = 24 * 60 * 60 * 1000;
const visitAt = new Date(Date.now() - 15 * day);
const at = (daysAfterVisit: number) => new Date(visitAt.getTime() + daysAfterVisit * day);

function updateSyntheticArchive(update: (database: Database.Database) => void) {
    const database = new Database(join(process.env.MEDIFLOW_DATA_DIR!, 'medical.db'), { fileMustExist: true });
    try { database.transaction(update)(database); }
    finally { database.close(); }
}

async function seedReturningPatient(page: Page, { sparse = false } = {}) {
    const iso = (date: Date) => date.toISOString();
    const fixture = await page.evaluate(async ({ sparse, visit, phone, measure, previousMeasure, weight, previousWeight, seal }) => {
        async function post(entity: string, body: Record<string, unknown>) {
            const response = await fetch(`/api/${entity}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entity === 'entries' ? await seal(body) : body) });
            if (!response.ok) throw new Error(`Fixture ${entity}: ${response.status}`);
            return response.json() as Promise<{ id: string }>;
        }
        const suffix = crypto.randomUUID().slice(0, 4);
        const patient = await post('patients', {
            firstName: 'Bianca', lastName: `Sintetica ${suffix}`, identifierType: 'none', taxCode: '', birthDatePrecision: 'estimated', birthYear: 1947,
            diagnoses: sparse ? [{ code: 'I10', description: 'Ipertensione essenziale', system: 'ICD-10', date: '2018-05-02' }] : [
                { code: 'I50.9', description: 'Scompenso cardiaco', system: 'ICD-10', date: '2019-03-14' },
                { code: 'I48.91', description: 'Fibrillazione atriale', system: 'ICD-10', date: '2020-06-02' },
                { code: 'E11.9', description: 'Diabete mellito tipo 2', system: 'ICD-10', date: '2015-09-21' },
                { code: 'N18.3', description: 'Malattia renale cronica stadio 3', system: 'ICD-10', date: '2023-01-30' },
            ],
        });
        const visitEntry = await post('entries', { patientId: patient.id, type: 'visit', date: visit, title: 'Visita di controllo', content: 'Compenso discreto, edemi lievi.' });
        if (sparse) {
            const only = await post('therapies', { patientId: patient.id, drugName: 'Amlodipina 5 mg cpr', dosage: '1 cp al mattino', status: 'active', startDate: '2018-05-02T09:00:00Z' });
            return { patient, visitEntry, changed: [] as string[], updated: [] as string[], kept: [only.id], measures: [] as string[], previous: [] as string[] };
        }
        const furosemide = await post('therapies', { patientId: patient.id, drugName: 'Furosemide 25 mg cpr', activePrinciple: 'furosemide', atc: 'C03CA01', dosage: '1 cp ore 8 · ½ cp ore 14', status: 'active', startDate: '2019-03-14T09:00:00Z' });
        const spironolattone = await post('therapies', { patientId: patient.id, drugName: 'Spironolattone 25 mg cpr', atc: 'C03DA01', dosage: '1 cp al mattino', status: 'suspended', startDate: '2021-02-10T09:00:00Z', motivation: 'Scompenso cardiaco' });
        const kept = [];
        for (const [drugName, atc, dosage] of [['Apixaban 5 mg cpr', 'B01AF02', '1 cp ogni 12 ore'], ['Bisoprololo 2,5 mg cpr', 'C07AB07', '1 cp al mattino'], ['Metformina 500 mg cpr', 'A10BA02', '1 cp a pranzo e cena']]) {
            kept.push((await post('therapies', { patientId: patient.id, drugName, atc, dosage, status: 'active', startDate: '2020-06-02T09:00:00Z' })).id);
        }
        await post('entries', { patientId: patient.id, type: 'phone', date: phone, title: 'Telefonata con la figlia', content: 'Potassio 5,6: sospeso spironolattone. Ricontrollo elettroliti tra 7 giorni.' });
        await post('entries', { patientId: patient.id, type: 'access', date: phone, title: 'Nota ADI', content: 'Edemi declivi ++, peso 71,4 kg. Concordato controllo del peso quotidiano.' });
        await post('entries', { patientId: patient.id, type: 'note', date: phone, title: 'Esami', content: 'Esami del 10/11 acquisiti in cartella.' });
        const measures = [];
        const previous = [];
        measures.push((await post('observations', { patientId: patient.id, codeSystem: 'LOINC', code: '2823-3', display: 'Potassio', unitSystem: 'UCUM', unitCode: 'mmol/L', value: 5.6, refLow: '3.5', refHigh: '5.1', observedAt: measure, source: 'manual' })).id);
        previous.push((await post('observations', { patientId: patient.id, codeSystem: 'LOINC', code: '2823-3', display: 'Potassio', unitSystem: 'UCUM', unitCode: 'mmol/L', value: 4.8, refLow: '3.5', refHigh: '5.1', observedAt: previousMeasure, source: 'manual' })).id);
        measures.push((await post('observations', { patientId: patient.id, codeSystem: 'LOINC', code: '29463-7', display: 'Peso', unitSystem: 'UCUM', unitCode: 'kg', value: 71.4, observedAt: weight, source: 'manual' })).id);
        previous.push((await post('observations', { patientId: patient.id, codeSystem: 'LOINC', code: '29463-7', display: 'Peso', unitSystem: 'UCUM', unitCode: 'kg', value: 70.2, observedAt: previousWeight, source: 'manual' })).id);
        for (const [title, date] of [['Elettroliti e creatinina', phone], ['Visita cardiologica', visit]]) {
            await post('checkups', { patientId: patient.id, title, date: new Date(new Date(date).getTime() + 7 * 86400000).toISOString(), status: 'pending', source: 'manual' });
        }
        return { patient, visitEntry, changed: [spironolattone.id], updated: [furosemide.id], kept, measures, previous };
    }, { sparse, visit: iso(visitAt), phone: iso(at(8)), measure: iso(at(6)), previousMeasure: iso(at(-14)), weight: iso(at(8)), previousWeight: iso(visitAt), seal: await diaryEntrySealer(page) });
    const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
    updateSyntheticArchive(database => {
        database.prepare('UPDATE entries SET created_at = ?, recorded_by = ? WHERE id = ?').run(seconds(visitAt), 'Dott. Sintetico', fixture.visitEntry.id);
        database.prepare('UPDATE entries SET created_at = ? WHERE patient_id = ? AND id != ?').run(seconds(at(8)), fixture.patient.id, fixture.visitEntry.id);
        database.prepare('UPDATE therapies SET created_at = ?, updated_at = ? WHERE patient_id = ?').run(seconds(at(-200)), seconds(at(-200)), fixture.patient.id);
        for (const id of fixture.changed) database.prepare('UPDATE therapies SET updated_at = ? WHERE id = ?').run(seconds(at(8)), id);
        for (const id of fixture.updated) database.prepare('UPDATE therapies SET updated_at = ?, version = 2 WHERE id = ?').run(seconds(at(8)), id);
        for (const id of fixture.measures) database.prepare('UPDATE observations SET created_at = ? WHERE id = ?').run(seconds(at(6)), id);
        for (const id of fixture.previous) database.prepare('UPDATE observations SET created_at = ? WHERE id = ?').run(seconds(at(-14)), id);
    });
    return fixture;
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
    await page.evaluate(value => {
        localStorage.setItem('mediflow-theme', value);
        document.documentElement.classList.toggle('light', value === 'light');
        document.documentElement.classList.toggle('dark', value === 'dark');
    }, theme);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function shot(page: Page, name: string) {
    if (shots) await page.screenshot({ path: `${shots}/${name}.png`, animations: 'disabled' });
}

async function islandContract(page: Page) {
    return page.locator('#quadro[data-overview]').evaluate(sheet => {
        const zone = sheet.querySelector('#riepilogo-stabile')!;
        const tray = sheet.querySelector('[data-record-tray="stabile"]')!;
        const island = sheet.querySelector('#riepilogo-problemi')!;
        const changed = sheet.querySelector('#riepilogo-cambiato')!;
        const therapyRow = sheet.querySelector('table[aria-label="Terapie attive"] tbody tr');
        const cells = therapyRow ? [...therapyRow.querySelectorAll('td')].slice(0, 2).map(cell => cell.getBoundingClientRect()) : [];
        return {
            zoneSize: Number.parseFloat(getComputedStyle(zone).fontSize),
            zoneText: [...sheet.querySelectorAll('[data-record-tray] > h2')].map(node => node.textContent),
            changedColor: getComputedStyle(changed).color,
            trayBackground: getComputedStyle(tray).backgroundColor,
            trayShadow: getComputedStyle(tray).boxShadow,
            trayRadius: Number.parseFloat(getComputedStyle(tray).borderRadius),
            trayInset: Number.parseFloat(getComputedStyle(tray).paddingLeft),
            trays: [...sheet.querySelectorAll('[data-record-tray]')].map(node => {
                const box = node.getBoundingClientRect();
                const title = node.querySelector(':scope > h2')!.getBoundingClientRect();
                const first = node.querySelector(':scope > h2 + *')!.getBoundingClientRect();
                return { zone: node.getAttribute('data-record-tray'), x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), bottom: Math.round(box.bottom),
                    titleTop: Math.round(title.top - box.top), innerLeft: Math.round(first.left - box.left), innerTop: Math.round(first.top - box.top) };
            }),
            islandBackground: getComputedStyle(island).backgroundColor,
            islandRadius: Number.parseFloat(getComputedStyle(island).borderRadius),
            posologyBelowName: cells.length === 2 ? cells[1].top >= cells[0].bottom - 1 && Math.abs(cells[1].left - cells[0].left) < 1 : null,
            columns: getComputedStyle(sheet.firstElementChild!).gridTemplateColumns.split(' ').map(Number.parseFloat),
        };
    });
}

test('isole del riepilogo: ritorno con variazioni, dettaglio, fonte e due temi', async ({ page }) => {
    await page.setViewportSize({ width: 1320, height: 880 });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const { patient } = await seedReturningPatient(page);
    await openUnlockedDocument(page, `/patients/${patient.id}/modules`);
    const changes = page.getByRole('region', { name: 'Variazioni dall’ultima visita', exact: true });
    await expect(changes).toContainText('Spironolattone 25 mg cpr');
    await expect(page.locator('#diario')).toContainText('sospeso spironolattone');

    for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        const contract = await islandContract(page);
        expect(contract.zoneSize).toBe(20);
        expect(contract.zoneText).toEqual(['Cambiato dall’ultima visita', 'Stabile', 'Contesto']);
        await expect(page.getByRole('heading', { name: 'Cambiato dall’ultima visita', exact: true })).toBeVisible();
        expect(contract.trayBackground).toBe(theme === 'light' ? 'rgb(240, 242, 244)' : 'rgb(16, 18, 22)');
        expect(contract.trayShadow.match(/\binset\b/g)).toHaveLength(3);
        expect(contract.islandBackground).toBe(theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(31, 34, 40)');
        expect(contract.islandRadius).toBe(14);
        expect(contract.trayInset).toBe(10);
        expect(contract.trayRadius).toBe(contract.islandRadius + contract.trayInset);
        for (const tray of contract.trays) expect(tray.innerLeft).toBe(10);
        expect(new Set(contract.trays.map(tray => tray.y)).size).toBe(1);
        expect(contract.posologyBelowName).toBe(true);
        expect(contract.columns).toHaveLength(3);
        expect(contract.columns[1] / contract.columns[0]).toBeCloseTo(1.2 / 1.04, 1);
        expect(contract.columns[2] / contract.columns[0]).toBeCloseTo(1 / 1.04, 1);
        await test.info().attach(`zone-1320-${theme}`, { body: JSON.stringify(contract, null, 2), contentType: 'application/json' });
        if (shots) writeFileSync(`${shots}/misure-1320-${theme}.json`, JSON.stringify(contract, null, 2));
        await assertNoHorizontalOverflow(page, [{ label: 'Scheda', selector: '#quadro' }]);
        await shot(page, `ritorno-1320-${theme}`);
    }
    await setTheme(page, 'light');

    await expect(changes.getByText('2 terapie', { exact: true })).toBeVisible();
    const strength = page.getByRole('table', { name: 'Terapie attive', exact: true }).getByText('5 mg cpr', { exact: true });
    await expect(strength).toHaveCSS('font-weight', '400');
    await expect(page.getByRole('table', { name: 'Terapie attive', exact: true }).getByText('Apixaban', { exact: true })).toHaveCSS('font-weight', '600');
    await expect(changes.getByText('1 valore fuori intervallo', { exact: true })).toBeVisible();
    await expect(changes.getByRole('link', { name: /1 telefonata · 1 accesso · 1 nota/ })).toHaveAttribute('href', '#diario');
    const spironolattone = changes.locator('details').filter({ hasText: 'Spironolattone 25 mg cpr' });
    await spironolattone.locator('summary').click();
    await expect(spironolattone).toContainText('Stato attuale: Sospesa');
    const state = spironolattone.locator('dt').filter({ hasText: 'Stato attuale' }).locator('..').locator('dd');
    await expect(state).toHaveText('Sospesa');
    await spironolattone.getByRole('button', { name: 'Altri dettagli' }).click();
    await expect(spironolattone.locator('dt').filter({ hasText: 'Posologia registrata' }).locator('..')).toContainText('1 cp al mattino');
    await spironolattone.getByRole('button', { name: 'Meno dettagli' }).click();
    await expect(spironolattone.locator('dt').filter({ hasText: 'Prima' }).locator('..')).toContainText('Non conservato.');
    await expect(spironolattone.getByText('Scompenso cardiaco', { exact: true })).toBeVisible();
    const potassium = changes.locator('details').filter({ hasText: 'Potassio' });
    await potassium.locator('summary').click();
    await expect(potassium).toContainText('4,8 mmol/L');
    await shot(page, 'dettaglio-1320-light');

    const sourceButton = spironolattone.getByRole('button', { name: /Diario del.*Telefonata/ });
    await sourceButton.click();
    await expect(page.getByRole('region', { name: 'Voce del diario' })).toContainText('sospeso spironolattone');
    await shot(page, 'fonte-1320-light');
    await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Voce del diario' })).toHaveCount(0);
    await expect(sourceButton).toBeVisible();
    await expect(sourceButton).toBeFocused();

    const middle = page.locator('[data-record-tray="cambiato"]');
    const before = await middle.evaluate(node => ({ box: node.getBoundingClientRect().toJSON(), scrollable: node.scrollHeight > node.clientHeight }));
    await middle.evaluate(node => { node.scrollTop = node.scrollHeight; });
    const after = await middle.evaluate(node => {
        const box = node.getBoundingClientRect();
        const islands = [...node.querySelectorAll(':scope > .activity > section, :scope > section')].map(island => island.getBoundingClientRect());
        const visible = islands.filter(island => island.bottom > box.top && island.top < box.bottom);
        return { box: box.toJSON(), scrollTop: node.scrollTop, background: getComputedStyle(node).backgroundColor,
            islandsInsideTray: visible.every(island => island.left >= box.left + 10 - 0.5 && island.right <= box.right - 10 + 0.5) };
    });
    expect(after.box).toEqual(before.box);
    expect(after.background).toBe('rgb(240, 242, 244)');
    expect(after.islandsInsideTray).toBe(true);
    if (before.scrollable) expect(after.scrollTop).toBeGreaterThan(0);
    await shot(page, 'cambiato-scorso-1320-light');
    if (shots) writeFileSync(`${shots}/scorrimento-1320-light.json`, JSON.stringify({ before, after }, null, 2));
    await middle.evaluate(node => { node.scrollTop = 0; });
    await shot(page, 'ritorno-dopo-fonte-1320-light');

    const measures = page.getByRole('table', { name: 'Parametri recenti', exact: true });
    await expect(measures.getByRole('cell', { name: /5,6 mmol\/L/ })).toHaveCSS('color', await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--lume-signal-critical)';
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    }));

    for (const [width, height] of [[1180, 660], [402, 874]] as const) {
        await page.setViewportSize({ width, height });
        await setTheme(page, 'light');
        await assertNoHorizontalOverflow(page, [{ label: 'Scheda', selector: '#quadro' }, { label: 'Pagina', selector: 'document' }]);
        await shot(page, `ritorno-${width}-light`);
    }
    await setTheme(page, 'dark');
    await shot(page, 'ritorno-402-dark');
});

test('isole del riepilogo: archivio scarno senza variazioni resta leggibile', async ({ page }) => {
    await page.setViewportSize({ width: 1320, height: 880 });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const { patient } = await seedReturningPatient(page, { sparse: true });
    await openUnlockedDocument(page, `/patients/${patient.id}/modules`);
    await expect(page.getByRole('table', { name: 'Terapie attive', exact: true })).toContainText('Amlodipina 5 mg cpr');
    await expect(page.locator('#quadro')).toContainText('nessuna variazione registrata');
    await expect(page.getByRole('region', { name: 'Variazioni dall’ultima visita', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Parametri recenti', exact: true })).toContainText('Nessuna misura registrata.');
    for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await assertNoHorizontalOverflow(page, [{ label: 'Scheda', selector: '#quadro' }]);
        await shot(page, `scarno-1320-${theme}`);
    }
});

test('isole del riepilogo: la scrittura tiene il diario e le isole raggiungibili', async ({ page }) => {
    await page.setViewportSize({ width: 1320, height: 880 });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const { patient } = await seedReturningPatient(page);
    await openUnlockedDocument(page, `/patients/${patient.id}/modules?voce=nuova`);
    await expect(page.locator('#quadro[data-writing]')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Variazioni dall’ultima visita', exact: true })).toContainText('Spironolattone 25 mg cpr');
    await assertNoHorizontalOverflow(page, [{ label: 'Scheda', selector: '#quadro' }]);
    await shot(page, 'scrivi-1320-light');
});
