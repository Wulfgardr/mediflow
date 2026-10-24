import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow, openPatientSection } from './utils';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

const quadro = (page: Page) => page.locator('#quadro');
const names = ['Problemi', 'Terapie attive', 'Misure recenti', 'Controlli aperti'];
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
        await post('/api/entries', { patientId: patient.id, type: 'visit', title: 'Visita sintetica', content: 'Voce inventata per verificare la lettura simultanea del Diario.', date: '2026-10-01' });
        return patient.id as string;
    }, count);
    await page.goto(`/patients/${id}/modules`);
    await expect(quadro(page)).toBeVisible();
    await expect(page.locator('#diario')).toContainText('Voce inventata per verificare la lettura simultanea del Diario.');
    return id;
}

for (const count of [0, 1, 8]) test(`quattro tabelle e conteggi con ${count} record`, async ({ page }) => {
    await fixture(page, count);
    for (const [index, name] of names.entries()) {
        const section = quadro(page).getByRole('region', { name, exact: true });
        await expect(section).toBeVisible();
        await expect(section.getByRole('heading')).toContainText(`${count} ${index === 1 ? (count === 1 ? 'attiva' : 'attive') : index === 3 ? (count === 1 ? 'aperto' : 'aperti') : index === 0 ? (count === 1 ? 'problema' : 'problemi') : (count === 1 ? 'parametro' : 'parametri')}`);
        if (count) await expect(section.locator('tbody tr')).toHaveCount(count);
        else await expect(section).toContainText(['Nessun problema registrato', 'Nessuna terapia attiva', 'Nessuna misura registrata', 'Nessun controllo aperto'][index]);
    }
    if (count) {
        for (const label of ['Codice', 'Descrizione', 'Da quando', 'Nome e dose', 'Posologia', 'ATC', 'Nome', 'Valore e unità', 'Data', 'Variazione', 'Scadenza']) await expect(quadro(page).getByRole('columnheader', { name: label, exact: true }).first()).toBeVisible();
        await expect(quadro(page).getByRole('cell', { name: '70 kg', exact: true })).toHaveCSS('text-align', 'right');
    }
});

test('Misure recenti conta i parametri e conserva lo storico completo in Misure', async ({ page }) => {
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
    await page.goto(`/patients/${id}/modules`);
    const measures = quadro(page).getByRole('region', { name: 'Misure recenti', exact: true });
    await expect(measures.getByRole('heading')).toContainText('2 parametri');
    await expect(measures.locator('tbody tr')).toHaveCount(2);
    await expect(measures.getByRole('cell', { name: '81 kg', exact: true })).toBeVisible();
    await expect(measures.getByRole('cell', { name: '81000 g', exact: true })).toBeVisible();
    await expect(measures.getByRole('cell', { name: /^12\/0?9\/2026$/, exact: true })).toHaveCount(2);
    await expect(measures.getByRole('cell', { name: /^\+1 kg dal 11\/0?9\/2026$/, exact: true })).toBeVisible();
    await expect(measures.getByRole('cell', { name: /^\+1000 g dal 11\/0?9\/2026$/, exact: true })).toBeVisible();
    await openPatientSection(page, 'parametri');
    const history = page.getByRole('complementary', { name: 'Andamento e storia delle misure' });
    await expect(history).toBeVisible();
    await history.getByRole('button', { name: 'Tutte (24)', exact: true }).click();
    await expect(history.locator('tbody tr')).toHaveCount(24);
    await expect(history.getByRole('cell', { name: '70 kg', exact: true })).toBeVisible();
    await expect(history.getByRole('cell', { name: '70000 g', exact: true })).toBeVisible();
});

for (const [route, sectionName] of [['therapies', 'Terapie attive'], ['observations', 'Misure recenti'], ['checkups', 'Controlli aperti']]) test(`errore ${route} distinto dal vuoto`, async ({ page }) => {
    const id = await fixture(page, 0);
    await page.route(`**/api/${route}?**`, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic read failure' }) }));
    await page.goto(`/patients/${id}/modules`);
    const section = quadro(page).getByRole('region', { name: sectionName, exact: true });
    await expect(section.getByRole('alert')).toContainText('Impossibile leggere');
    await expect(section).not.toContainText(/Nessun[ao]? /);
    await expect(section.locator('table')).toHaveCount(0);
    await expect(section.getByRole('heading')).not.toContainText('0');
});


for (const [routeName, sectionName] of [['therapies', 'Terapie attive'], ['observations', 'Misure recenti'], ['checkups', 'Controlli aperti']]) test(`caricamento ${routeName} senza zeri o vuoti`, async ({ page }) => {
    const id = await fixture(page, 0);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/${routeName}?**`, async route => { await pending; await route.continue(); });
    try {
        await page.goto(`/patients/${id}/modules`);
        const section = quadro(page).getByRole('region', { name: sectionName, exact: true });
        await expect(section.getByRole('status')).toContainText('in corso');
        await expect(section.getByRole('heading')).not.toContainText('0');
        await expect(section).not.toContainText(/Nessun[ao]? /);
        release();
        await expect(section.getByRole('status')).toHaveCount(0);
        await expect(section.getByRole('heading')).toContainText('0');
    } finally { release(); }
});

test('lettura paziente fallita non annuncia problemi assenti', async ({ page }) => {
    const id = await fixture(page, 0);
    await page.route(`**/api/patients/${id}`, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic read failure' }) }));
    await page.goto(`/patients/${id}/modules`);
    await expect(page.getByRole('alert').filter({ hasText: 'Impossibile leggere la scheda paziente' })).toBeVisible();
    await expect(quadro(page)).toHaveCount(0);
});

for (const width of [1440, 768, 390]) test(`colonne leggibili a ${width} e Diario simultaneo in estesa`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page, 1);
    for (const name of ['Da quando', 'ATC', 'Variazione']) {
        const column = quadro(page).getByRole('columnheader', { name, exact: true });
        if (width > 1000) await expect(column).toBeVisible(); else await expect(column).toBeHidden();
    }
    await assertNoHorizontalOverflow(page, [{ label: 'Quadro', selector: '#quadro' }, { label: 'Pagina', selector: 'document' }]);
    await expect(quadro(page).getByRole('cell', { name: '1 compressa al mattino' })).toHaveCSS('font-size', '14px');
    if (width > 1000) {
        const sheet = await quadro(page).boundingBox(); const diary = await page.locator('#diario').boundingBox();
        expect(Math.abs(sheet!.y - diary!.y)).toBeLessThan(2);
        expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(diary!.x);
        expect(sheet!.width).toBeGreaterThan(430);
        expect(diary!.width).toBeGreaterThan(380);
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
