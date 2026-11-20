import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { test, closureGallery } from './fixtures/patient-closure-gallery';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow, openPatientSection, openUnlockedDocument } from './utils';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { sealDiaryEntry } from './fixtures/sealed-diary-entry';

const quadro = (page: Page) => page.locator('#quadro');
const names = ['Problemi', 'Terapie attive', 'Parametri recenti', 'Controlli aperti'];
async function fixture(page: Page, count = 1) {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const id = await page.evaluate(async count => {
        const post = async (route: string, body: unknown) => {
            const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
            return response.json();
        };
        const patient = await post('/api/patients', { firstName: 'Ada sintetica', lastName: 'Quadro', taxCode: `SYN${crypto.randomUUID()}`, birthDate: '1972-04-12', diagnoses: Array.from({ length: count }, (_, n) => ({ code: `SYN${n}`, description: `Problema sintetico ${n + 1}`, system: 'ICD-10', date: '2026-10-01' })) });
        for (let n = 0; n < count; n++) {
            await post('/api/therapies', { patientId: patient.id, drugName: `Farmaco sintetico ${n + 1} 10 mg`, dosage: '1 compressa al mattino', atc: `SYN${n}`, status: 'active', startDate: '2026-10-01' });
            await post('/api/observations', { patientId: patient.id, codeSystem: 'LOINC', code: `SYN${n}`, display: `Misura sintetica ${n + 1}`, unitSystem: 'UCUM', unitCode: 'kg', value: 70 + n, observedAt: '2026-10-01', source: 'manual' });
            await post('/api/checkups', { patientId: patient.id, title: `Controllo sintetico ${n + 1}`, date: '2026-11-01', status: 'pending' });
        }
        return patient.id as string;
    }, count);
    const entry = await sealDiaryEntry(page, { patientId: id, type: 'visit', title: 'Visita sintetica', content: 'Voce inventata per verificare la lettura simultanea del Diario.', date: '2026-10-01' });
    await page.evaluate(async body => {
        const response = await fetch('/api/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(`/api/entries: ${response.status} ${await response.text()}`);
    }, entry);
    await openUnlockedDocument(page, `/patients/${id}/modules`);
    await expect(quadro(page)).toBeVisible();
    await expect(page.locator('#diario')).toContainText('Voce inventata per verificare la lettura simultanea del Diario.');
    return id;
}

for (const count of [0, 1, 8]) test(`quattro tabelle e conteggi con ${count} record`, async ({ page }) => {
    test.setTimeout(180_000);
    await fixture(page, count);
    for (const [index, name] of names.entries()) {
        const section = quadro(page).getByRole('region', { name, exact: true });
        await expect(section).toBeVisible();
        await expect(section.getByRole('heading')).toContainText(`${count} ${index === 1 ? (count === 1 ? 'attiva' : 'attive') : index === 3 ? (count === 1 ? 'aperto' : 'aperti') : index === 0 ? (count === 1 ? 'problema' : 'problemi') : (count === 1 ? 'parametro' : 'parametri')}`);
        if (count) await expect(section.locator('tbody tr')).toHaveCount(count);
        else await expect(section).toContainText(['Nessun problema registrato', 'Nessuna terapia attiva', 'Nessuna misura registrata', 'Nessun controllo aperto'][index]);
    }
    await closureGallery(page, 'quadro', `record-${count}`, quadro(page));
    if (count) {
        for (const label of ['Codice', 'Descrizione', 'Nome e dose', 'Posologia', 'Nome', 'Valore', 'Data', 'Scadenza']) await expect(quadro(page).getByRole('columnheader', { name: label, exact: true }).first()).toBeVisible();
        await expect(quadro(page).getByRole('table', { name: 'Problemi' }).getByRole('cell', { name: /Problema sintetico 1.*01\/10\/2026/ })).toBeVisible();
        await expect(quadro(page).getByRole('table', { name: 'Terapie attive' }).getByRole('cell', { name: /Farmaco sintetico 1.*SYN0/ })).toBeVisible();
        await expect(quadro(page).getByRole('cell', { name: '70 kg', exact: true })).toHaveCSS('text-align', 'right');
    }
});

test('Parametri recenti conta i parametri e conserva lo storico completo in Parametri', async ({ page }) => {
    test.setTimeout(180_000);
    const id = await fixture(page, 0);
    await page.evaluate(async patientId => {
        for (const unitCode of ['kg', 'g']) for (let n = 0; n < 12; n++) {
            const response = await fetch('/api/observations', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ patientId, codeSystem: 'LOINC', code: 'SYN-WEIGHT', display: 'Peso sintetico', unitSystem: 'UCUM', unitCode, value: (70 + n) * (unitCode === 'g' ? 1000 : 1), observedAt: `2026-09-${String(n + 1).padStart(2, '0')}`, source: 'manual' }),
            });
            if (!response.ok) throw new Error(`Observation fixture: ${response.status}`);
        }
    }, id);
    await openUnlockedDocument(page, `/patients/${id}/modules`);
    const measures = quadro(page).getByRole('region', { name: 'Parametri recenti', exact: true });
    await expect(measures.getByRole('heading')).toContainText('2 parametri');
    await expect(measures.locator('tbody tr')).toHaveCount(2);
    await expect(measures.getByRole('cell', { name: /^81 kg \+1 kg dal 11\/0?9\/2026$/ })).toBeVisible();
    await expect(measures.getByRole('cell', { name: /^81000 g \+1000 g dal 11\/0?9\/2026$/ })).toBeVisible();
    await expect(measures.getByRole('cell', { name: /^12\/0?9\/2026$/, exact: true })).toHaveCount(2);
    await closureGallery(page, 'quadro', 'aggregazione-unita-e-storico', quadro(page));
    await openPatientSection(page, 'parametri');
    const history = page.getByRole('complementary', { name: 'Andamento e storia delle misure' });
    await expect(history).toBeVisible();
    const measureRegister = page.locator('#parametri').getByRole('table').first();
    for (const [latest, oldest] of [['81 kg', '70 kg'], ['81000 g', '70000 g']]) {
        const row = measureRegister.getByRole('row').filter({ has: page.getByRole('cell', { name: latest, exact: true }) });
        const open = row.getByRole('button');
        if (await open.getAttribute('aria-expanded') === 'false') await open.click();
        const table = history.locator('section').filter({ has: page.getByRole('cell', { name: latest, exact: true }) });
        await table.getByRole('button', { name: 'Tutte (12)', exact: true }).click();
        await expect(table.locator('tbody tr')).toHaveCount(12);
        await expect(table.getByRole('cell', { name: oldest, exact: true })).toBeVisible();
    }
});

for (const [route, sectionName] of [['therapies', 'Terapie attive'], ['observations', 'Parametri recenti'], ['checkups', 'Controlli aperti']]) test(`errore ${route} distinto dal vuoto`, async ({ page }) => {
    test.setTimeout(180_000);
    const id = await fixture(page, 0);
    await page.route(`**/api/${route}?**`, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic read failure' }) }));
    await openUnlockedDocument(page, `/patients/${id}/modules`);
    const section = quadro(page).getByRole('region', { name: sectionName, exact: true });
    await expect(section.getByRole('alert')).toContainText('Impossibile leggere');
    await expect(section).not.toContainText(/Nessun[ao]? /);
    await expect(section.locator('table')).toHaveCount(0);
    await expect(section.getByRole('heading')).not.toContainText('0');
    await closureGallery(page, 'quadro', `errore-${route}`, section);
});


for (const [routeName, sectionName] of [['therapies', 'Terapie attive'], ['observations', 'Parametri recenti'], ['checkups', 'Controlli aperti']]) test(`caricamento ${routeName} senza zeri o vuoti`, async ({ page }) => {
    test.setTimeout(180_000);
    const id = await fixture(page, 0);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/${routeName}?**`, async route => { await pending; await route.continue(); });
    try {
        await openUnlockedDocument(page, `/patients/${id}/modules`);
        const section = quadro(page).getByRole('region', { name: sectionName, exact: true });
        await expect(section.getByRole('status')).toContainText('in corso');
        await expect(section.getByRole('heading')).not.toContainText('0');
        await closureGallery(page, 'quadro', `caricamento-${routeName}`, section);
        await expect(section).not.toContainText(/Nessun[ao]? /);
        release();
        await expect(section.getByRole('status')).toHaveCount(0);
        await expect(section.getByRole('heading')).toContainText('0');
    } finally { release(); }
});

test('lettura paziente fallita non annuncia problemi assenti', async ({ page }) => {
    test.setTimeout(180_000);
    const id = await fixture(page, 0);
    await page.route(`**/api/patients/${id}`, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic read failure' }) }));
    await openUnlockedDocument(page, `/patients/${id}/modules`);
    await expect(page.getByRole('alert').filter({ hasText: 'Impossibile leggere la scheda paziente' })).toBeVisible();
    await expect(quadro(page)).toHaveCount(0);
    await closureGallery(page, 'quadro', 'paziente-non-disponibile', page.getByRole('alert').filter({ hasText: 'Impossibile leggere la scheda paziente' }));
});

for (const width of [1440, 768, 390]) test(`colonne leggibili a ${width} e Diario simultaneo in estesa`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page, 1);
    const problems = quadro(page).getByRole('region', { name: 'Problemi', exact: true });
    const therapies = quadro(page).getByRole('region', { name: 'Terapie attive', exact: true });
    await expect(problems.getByRole('cell', { name: /Problema sintetico 1.*01\/10\/2026/ })).toBeVisible();
    await expect(therapies.getByRole('cell', { name: /Farmaco sintetico 1.*SYN0/ })).toBeVisible();
    await assertNoHorizontalOverflow(page, [{ label: 'Quadro', selector: '#quadro' }, { label: 'Pagina', selector: 'document' }]);
    await expect(quadro(page).getByRole('cell', { name: '1 compressa al mattino' })).toHaveCSS('font-size', '14px');
    const problemBox = (await problems.boundingBox())!;
    const therapyBox = (await therapies.boundingBox())!;
    if (width >= 1280) {
        const diary = (await page.locator('#diario').boundingBox())!;
        expect(problemBox.x + problemBox.width).toBeLessThanOrEqual(diary.x);
        expect(diary.width).toBeGreaterThan(380);
    } else {
        expect(therapyBox.y + therapyBox.height).toBeLessThanOrEqual(problemBox.y);
        expect(therapyBox.x).toBeCloseTo(problemBox.x, 0);
        expect(therapyBox.width).toBeCloseTo(problemBox.width, 0);
    }
});

async function capture(page: Page, suffix: string) {
    const directory = process.env.QUADRO_EVIDENCE_DIR;
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/${suffix}.png`, fullPage: true, animations: 'disabled' });
    await writeFile(`${directory}/${suffix}.json`, JSON.stringify({ sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), diff: execFileSync('git', ['diff', '--stat'], { encoding: 'utf8' }), viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio })), quadro: await quadro(page).boundingBox(), diario: await page.locator('#diario').boundingBox() }, null, 2));
}
test('catture Quadro Giorno e Grafite', async ({ page }) => {
    test.skip(!process.env.QUADRO_EVIDENCE_DIR, 'raccolta esplicita');
    await fixture(page, 3);
    for (const theme of ['giorno', 'grafite']) for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(theme => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme === 'giorno' ? 'light' : 'dark'); }, theme);
        await capture(page, `${theme}-${width}`);
    }
});
test('zoom browser 200% e catture', async () => {
    test.setTimeout(120_000);
    const browser = await openBrowserZoomFixture(process.env.E2E_BASE_URL || 'http://127.0.0.1:3100');
    try {
        await fixture(browser.page, 3);
        await browser.setZoom(2);
        for (const theme of ['giorno', 'grafite']) {
            await browser.page.evaluate(theme => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme === 'giorno' ? 'light' : 'dark'); }, theme);
            await assertNoHorizontalOverflow(browser.page, [{ label: 'Quadro zoom 200%', selector: '#quadro' }, { label: 'Pagina', selector: 'document' }]);
            await capture(browser.page, `${theme}-1440-zoom-200`);
        }
    } finally { await browser.close(); }
});
