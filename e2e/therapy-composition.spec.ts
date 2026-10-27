import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

const section = (page: Page) => page.locator('#terapie');
const register = (page: Page) => section(page).locator('[data-clinical-register="therapies"]');
const creation = (page: Page) => section(page).getByRole('button', { name: 'Nuova terapia', exact: true });
const row = (page: Page, name = 'Farmaco sintetico active 1') => section(page).getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
const baseline = process.env.THERAPY_COMPOSITION_BASELINE === '1';
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

async function fixture(page: Page, counts = { active: 0, suspended: 0, completed: 0 }, diagnoses: { system: string; code: string; description: string }[] = []) {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patientId = await page.evaluate(async ({ counts, diagnoses }) => {
        for (const key of ['aiPatientInsightKillSwitch', 'aiSmartImportKillSwitch', 'aiDocumentSynthesisKillSwitch', 'aiTreatmentReasoningKillSwitch']) {
            const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: 'disabled' }) });
            if (!response.ok) throw new Error(`Synthetic setting: ${response.status}`);
        }
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'Ada sintetica', lastName: 'Composizione', taxCode: `SYN${crypto.randomUUID()}`, birthDate: '1972-04-12', diagnoses }) });
        if (!response.ok) throw new Error(`Synthetic patient: ${response.status}`);
        const { id } = await response.json();
        for (const [status, count] of Object.entries(counts)) for (let index = 1; index <= count; index++) {
            const added = await fetch('/api/therapies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), patientId: id, drugName: `Farmaco sintetico ${status} ${index}`, dosage: '1 cp al mattino', status, motivation: 'Nota inventata', startDate: '2026-10-01T08:00:00.000Z', ...(status === 'completed' ? { endDate: '2026-10-15T08:00:00.000Z' } : {}) }) });
            if (!added.ok) throw new Error(`Synthetic therapy: ${added.status}`);
        }
        return id as string;
    }, { counts, diagnoses });
    await page.goto(`/patients/${patientId}/modules`);
    await openPatientSection(page, 'terapie');
    await expect(register(page).getByRole('status', { name: 'Caricamento terapie' })).toHaveCount(0);
    return patientId;
}

async function menu(page: Page, name?: string) {
    await row(page, name).getByRole('button', { name: /^Altre azioni/ }).click();
    return page.getByRole('menu', { name: /^Azioni terapia/ });
}

async function draft(page: Page) {
    await creation(page).click();
    await section(page).getByLabel('Farmaco manuale o galenico').check();
    await section(page).locator('input[name="drugName"]').fill('Preparazione sintetica');
    await section(page).locator('input[name="dosage"]').fill('Dose inventata');
    await section(page).locator('textarea[name="motivation"]').fill('Bozza da conservare');
}

test('creazione testuale accanto al titolo anche nel vuoto', async ({ page }) => {
    await fixture(page);
    await expect(creation(page)).toHaveClass(/mf-button-text/);
    await expect(creation(page)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const heading = section(page).getByRole('heading', { name: /Terapie farmacologiche/ });
    await expect(heading).toHaveCount(1);
    await expect(heading).toHaveCSS('font-size', '12px');
    await expect(heading).toHaveCSS('text-transform', 'uppercase');
    const titleBox = await heading.boundingBox();
    const createBox = await creation(page).boundingBox();
    expect(Math.abs(titleBox!.y - createBox!.y)).toBeLessThan(45);
});

test('Nuova terapia apre la sezione chiusa e mostra subito la bozza', async ({ page }) => {
    await fixture(page);
    const toolbar = page.getByTestId('runtime-twin-toolbar');
    if (await toolbar.count()) await toolbar.getByRole('button', { name: 'Originale', exact: true }).click();
    const toggle = section(page).getByRole('button', { name: /Terapie farmacologiche/ });
    if (await toggle.count()) {
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    }
    await expect(creation(page)).toBeEnabled();
    await creation(page).click();
    if (await toggle.count()) await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(section(page).getByLabel('Farmaco manuale o galenico')).toBeVisible();
    await expect(creation(page)).toBeDisabled();
    await expect(section(page).locator('form')).toContainText('Farmaco');
    await expect(section(page).locator('form input:focus')).toHaveCount(1);
    await section(page).getByRole('button', { name: 'Annulla', exact: true }).click();
    if (await toggle.count()) {
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    }
    await creation(page).click();
    if (await toggle.count()) await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(section(page).getByLabel('Farmaco manuale o galenico')).toBeVisible();
    await expect(section(page).locator('form input:focus')).toHaveCount(1);
});

test('Modifica porta il fuoco nel form anche passando fra terapie', async ({ page }) => {
    await fixture(page, { active: 2, suspended: 0, completed: 0 });
    await row(page).getByRole('button', { name: 'Modifica', exact: true }).click();
    await expect(section(page).locator('form')).toBeVisible();
    await expect(section(page).locator('form input:focus')).toHaveCount(1);
    await row(page, 'Farmaco sintetico active 2').getByRole('button', { name: 'Modifica', exact: true }).click();
    await expect(section(page).locator('form input:focus')).toHaveCount(1);
});

test('form aperto ha un solo principale e conserva bozza e soglia', async ({ page }) => {
    await fixture(page, { active: 1, suspended: 0, completed: 0 });
    await draft(page);
    const direct = row(page).getByRole('button', { name: 'Sospendi', exact: true });
    if (await direct.count()) await direct.click();
    else await (await menu(page)).getByRole('menuitem', { name: 'Sospendi', exact: true }).click();
    const threshold = section(page).getByRole('region', { name: 'Cambio di stato della terapia' });
    await expect(threshold).toContainText('Sospendere');
    await expect(page.locator('.mf-button-primary:visible, .ui-btn-primary:visible')).toHaveCount(1);
    await expect(creation(page)).toBeVisible();
    await expect(creation(page)).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Nuova voce', exact: true })).toHaveClass(/mf-button-secondary/);
    await expect(section(page).locator('textarea[name="motivation"]')).toHaveValue('Bozza da conservare');
    await threshold.getByRole('button', { name: 'Torna alla scheda' }).click();
    await openPatientSection(page, 'documenti');
    await openPatientSection(page, 'terapie');
    await expect(section(page).locator('textarea[name="motivation"]')).toHaveValue('Bozza da conservare');
    await section(page).getByRole('button', { name: 'Annulla', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Nuova voce', exact: true })).toHaveClass(/mf-button-primary/);
});

test('riga attiva espone solo Modifica e menu con distruttiva ultima', async ({ page }) => {
    await fixture(page, { active: 1, suspended: 0, completed: 0 });
    await expect(row(page).getByRole('button', { name: 'Sospendi', exact: true })).toHaveCount(0);
    await expect(row(page).getByRole('button', { name: 'Concludi', exact: true })).toHaveCount(0);
    await expect(row(page).getByRole('button', { name: 'Modifica', exact: true })).toBeVisible();
    const actions = await menu(page);
    await expect(actions.getByRole('menuitem')).toHaveText(['Sospendi', 'Concludi', 'Elimina (inserita per errore)']);
    await actions.press('Escape');
    await expect(row(page).getByRole('button', { name: /^Altre azioni/ })).toBeFocused();
});

test('contatori espliciti distinguono gli stati senza testate ripetute', async ({ page }) => {
    await fixture(page, { active: 1, suspended: 1, completed: 1 });
    await expect(section(page).getByText('1 sospesa', { exact: false })).toBeVisible();
    await expect(section(page).getByText('1 conclusa', { exact: false })).toBeVisible();
    await expect(section(page).getByRole('heading', { name: /Terapie/ })).toHaveCount(1);
});

for (const status of ['active', 'suspended', 'completed'] as const) for (const count of [0, 1, 3]) {
    test(`${count} terapie ${status}: gruppi solo con righe e conteggi coerenti`, async ({ page }) => {
        await fixture(page, { active: 0, suspended: 0, completed: 0, [status]: count });
        await expect(register(page).locator('tbody tr')).toHaveCount(count);
        await expect(register(page).locator('table')).toHaveCount(count ? 1 : 0);
        await expect(creation(page)).toBeVisible();
        const label = status === 'active' ? (count === 1 ? '1 attiva' : `${count} attive`) : status === 'suspended' ? (count === 1 ? '1 sospesa' : `${count} sospese`) : (count === 1 ? '1 conclusa' : `${count} concluse`);
        if (count || status === 'active') await expect(section(page).getByText(label, { exact: false })).toBeVisible();
        if (!count) await expect(register(page)).toContainText('Nessuna terapia');
        else {
            await expect(register(page).getByRole('heading')).toHaveText(status === 'active' ? 'Attive' : status === 'suspended' ? 'Sospese' : 'Concluse');
            const first = row(page, `Farmaco sintetico ${status} 1`);
            await expect(first.getByRole('button', { name: status === 'active' ? 'Modifica' : 'Riattiva', exact: true })).toBeVisible();
            if (status === 'completed') await expect(first.getByRole('button', { name: /^Altre azioni/ })).toHaveCount(0);
            if (status === 'suspended') {
                await first.getByRole('button', { name: /^Altre azioni/ }).click();
                await expect(first.getByRole('menuitem')).toHaveText(['Concludi']);
                await first.getByRole('menu').press('Escape');
            }
            if (status !== 'active') {
                const writes: string[] = [];
                page.on('request', request => { if ((request.method() === 'PUT' && request.url().includes('/api/therapies/')) || (request.method() === 'POST' && /therapy-status-commands\/[^/]+\/execute$/.test(new URL(request.url()).pathname))) writes.push(request.url()); });
                await first.getByRole('button', { name: 'Riattiva', exact: true }).click();
                const threshold = section(page).getByRole('region', { name: 'Cambio di stato della terapia' });
                await expect(threshold).toContainText('Riattivare');
                expect(writes).toEqual([]);
                await threshold.getByRole('button', { name: 'Torna alla scheda' }).click();
            }
        }
    });
}

test('creazione e modifica usano il form esistente e persistono i dati', async ({ page }) => {
    await fixture(page);
    await draft(page);
    await section(page).getByRole('button', { name: 'Salva terapia' }).click();
    const created = row(page, 'Preparazione sintetica');
    await expect(created).toContainText('Dose inventata');
    await created.getByRole('button', { name: 'Modifica', exact: true }).click();
    await section(page).locator('input[name="dosage"]').fill('Dose aggiornata');
    await section(page).getByRole('button', { name: 'Aggiorna terapia' }).click();
    await expect(created).toContainText('Dose aggiornata');
    await page.reload();
    await openPatientSection(page, 'terapie');
    await expect(created).toContainText('Dose aggiornata');
});

test('eliminazione conserva motivo obbligatorio, ritorno prioritario e un solo invio', async ({ page }) => {
    await fixture(page, { active: 1, suspended: 0, completed: 0 });
    const writes: string[] = [];
    page.on('request', request => { if (request.method() === 'DELETE') writes.push(request.url()); });
    const actions = await menu(page);
    const remove = actions.getByRole('menuitem', { name: 'Elimina (inserita per errore)', exact: true });
    await expect(remove).not.toHaveClass(/mf-button-destructive/);
    await remove.click();
    const dialog = page.getByRole('dialog', { name: 'Eliminare questo farmaco dalla cartella?' });
    await expect(dialog.getByRole('button', { name: 'Annulla', exact: true })).toHaveClass(/mf-btn-secondary/);
    await expect(dialog.getByRole('button').filter({ hasText: /^(Annulla|Elimina)$/ })).toHaveText(['Annulla', 'Elimina']);
    const confirm = dialog.getByRole('button', { name: 'Elimina', exact: true });
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveClass(/mf-button-destructive/);
    expect(writes).toEqual([]);
    await dialog.getByRole('button', { name: 'Annulla', exact: true }).click();
    await (await menu(page)).getByRole('menuitem', { name: 'Elimina (inserita per errore)', exact: true }).click();
    await dialog.getByRole('textbox', { name: "Motivazione dell'eliminazione" }).fill('Duplicato sintetico');
    await confirm.click();
    await expect(row(page)).toHaveCount(0);
    expect(writes).toHaveLength(1);
});

for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', 'zoom-200']) {
    test(`cattura terapie ${theme} ${size}`, async ({ page, baseURL }) => {
        const zoom = size === 'zoom-200' ? await openBrowserZoomFixture(baseURL!) : undefined;
        try {
            if (zoom) page = zoom.page;
            await page.setViewportSize({ width: zoom ? 1440 : Number(size), height: 1000 });
            await fixture(page, { active: 3, suspended: 1, completed: 1 });
            await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
            if (zoom) await zoom.setZoom(2);
            const dir = process.env.THERAPY_COMPOSITION_CAPTURES || test.info().outputPath('captures');
            await mkdir(dir, { recursive: true });
            const capture = async (state: string) => {
                await section(page).scrollIntoViewIfNeeded();
                const path = `${dir}/${baseline ? 'prima' : 'dopo'}-${theme}-${size}-${state}.png`;
                const png = await page.screenshot({ path, animations: 'disabled', fullPage: !zoom });
                if (zoom) {
                    expect(png.readUInt32BE(16)).toBe(1440);
                    expect(png.readUInt32BE(20)).toBe(1000);
                }
                await test.info().attach(`${state}-${sha}`, { path, contentType: 'image/png' });
                if (!baseline) await assertNoHorizontalOverflow(page, [{ label: 'documento', selector: 'document' }, { label: 'terapie', selector: '#terapie' }]);
            };
            await capture('registro');
            await draft(page);
            await section(page).locator('input[name="dosage"]').focus();
            if (!baseline) await assertNotClippedInViewport(section(page).locator('input[name="dosage"]'), 'Posologia');
            await capture('form');
            await section(page).getByRole('button', { name: 'Annulla', exact: true }).click();
            if (baseline) await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
            else await (await menu(page)).getByRole('menuitem', { name: 'Sospendi' }).click();
            await capture('conferma');
            await section(page).getByRole('region', { name: 'Cambio di stato della terapia' }).getByRole('button', { name: 'Torna alla scheda' }).click();
            if (!baseline) {
                const actions = await menu(page);
                await assertNotClippedInViewport(actions, 'Azioni terapia');
                await capture('menu');
            }
            await test.info().attach('revisione', { body: `${sha}\n${baseline ? 'prima' : 'dopo'}\n${zoom ? 'Zoom reale Chromium tabs.setZoom/getZoom 200%, viewport fisico 1440.' : `Viewport ${size}.`}`, contentType: 'text/plain' });
        } finally { await zoom?.close(); }
    });
}

for (const width of [1440, 390]) test(`campo terapia riserva spazio al bersaglio di cancellazione ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await fixture(page);
    await page.route('**/api/drugs?**', route => route.fulfill({ json: [] }));
    await creation(page).click();
    const input = section(page).getByPlaceholder('Cerca per nome o principio attivo...', { exact: true });
    await input.fill('Ricerca sintetica con nome del farmaco molto lungo');
    const clear = section(page).getByRole('button', { name: 'Cancella ricerca', exact: true });
    await expect(clear).toBeVisible();
    const fieldBox = await input.boundingBox();
    const clearBox = await clear.boundingBox();
    const paddingRight = await input.evaluate(element => Number.parseFloat(getComputedStyle(element).paddingRight));
    const minimum = width <= 700 ? 44 : 40;
    expect(clearBox?.width).toBeGreaterThanOrEqual(minimum);
    expect(clearBox?.height).toBeGreaterThanOrEqual(minimum);
    expect(paddingRight).toBeGreaterThanOrEqual(fieldBox!.x + fieldBox!.width - clearBox!.x + 8);
    await clear.click({ position: { x: clearBox!.width / 2, y: 2 } });
    await expect(input).toHaveValue('');
});

for (const theme of ['giorno', 'grafite']) for (const width of [1440, 390]) {
    test(`suggerimenti terapia mostrano la selezione ${theme} ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.addInitScript(value => localStorage.setItem('mediflow-theme', value), theme === 'grafite' ? 'dark' : 'light');
        await fixture(page, undefined, [{ system: 'ICD-10', code: 'SYN-A2', description: 'Diagnosi sintetica A2' }]);
        await creation(page).click();
        const choices = ['Diagnosi sintetica A2', 'Prevenzione', 'Nessuna'].map(name => section(page).getByRole('button', { name, exact: true }));
        const background = (choice: typeof choices[number]) => choice.evaluate(element => getComputedStyle(element).backgroundColor);
        const unselectedBackground = await background(choices[0]);
        for (const [index, choice] of choices.entries()) {
            await choice.click();
            await page.mouse.move(0, 0);
            await section(page).locator('input[name="dosage"]').focus();
            await expect.poll(() => background(choice)).not.toBe(unselectedBackground);
            for (const [otherIndex, other] of choices.entries()) {
                await expect(other).toHaveAttribute('aria-pressed', String(index === otherIndex));
                if (index !== otherIndex) await expect.poll(() => background(other)).toBe(unselectedBackground);
            }
            await assertNoHorizontalOverflow(page, [{ label: 'terapie', selector: '#terapie' }]);
            const path = test.info().outputPath(`selezione-${index}-${theme}-${width}.png`);
            await section(page).screenshot({ path, animations: 'disabled' });
            await test.info().attach(`selezione-${index}-${theme}-${width}`, { path, contentType: 'image/png' });
        }
    });
}


test('Farmaco in Grafite mantiene bordo e focus visibile durante la compilazione', async ({ page }) => {
    await fixture(page);
    await page.evaluate(() => {
        localStorage.setItem('mediflow-theme', 'dark');
        document.documentElement.classList.remove('light');
        document.documentElement.classList.add('dark');
    });
    await creation(page).click();
    const drug = section(page).getByRole('combobox', { name: /^Farmaco/ });
    await drug.focus();
    await expect(drug).toBeFocused();
    await expect(drug).toHaveCSS('border-top-width', '1px');
    await expect(drug).toHaveCSS('border-top-style', 'solid');
    expect(await drug.evaluate(element => getComputedStyle(element).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await drug.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
});
