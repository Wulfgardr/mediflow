import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

const baseline = process.env.W11_BASELINE === '1';
const section = (page: Page) => page.locator('#parametri');
const register = (page: Page) => page.locator('[data-clinical-register="observations"]');
const creation = (page: Page) => section(page).getByRole('button', { name: 'Nuova misura', exact: true });
const history = (page: Page) => page.getByRole('complementary', { name: 'Andamento e storia delle misure' });

async function fixture(page: Page, count = 1) {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const id = await page.evaluate(async count => {
        const post = async (route: string, body: unknown) => {
            const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
            return response.json();
        };
        const patient = await post('/api/patients', { firstName: 'Ada sintetica', lastName: 'Misure W11', taxCode: `SYN${crypto.randomUUID()}`, birthDate: '1972-04-12' });
        for (let index = 0; index < count; index++) await post('/api/observations', {
            patientId: patient.id, codeSystem: 'LOINC', code: '8480-6', display: 'Pressione sistolica',
            unitSystem: 'UCUM', unitCode: 'mm[Hg]', value: 120 + index, observedAt: `2026-10-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
            refLow: '90', refHigh: '140', notes: `Registrazione sintetica ${index + 1}`, source: 'manual',
        });
        return patient.id as string;
    }, count);
    await page.goto(`/patients/${id}/modules`);
    await openPatientSection(page, 'parametri');
    return id;
}

async function capture(page: Page, state: string, theme: string, size: string) {
    const root = process.env.W11_CAPTURES || test.info().outputPath('captures');
    await mkdir(root, { recursive: true });
    const name = `${baseline ? 'prima' : 'dopo'}-${theme}-${size}-${state}`;
    const png = `${root}/${name}.png`;
    if (state === 'fuoco-parametro') await register(page).getByRole('combobox', { name: 'Parametro', exact: true }).scrollIntoViewIfNeeded();
    else if (state === 'vuoto' && !baseline) await register(page).getByRole('status').scrollIntoViewIfNeeded();
    else await section(page).scrollIntoViewIfNeeded();
    await expect(page.locator('html')).toHaveClass(theme === 'grafite' ? /dark/ : /light/);
    await page.screenshot({ path: png, animations: 'disabled' });
    await writeFile(`${root}/${name}.json`, JSON.stringify({
        head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        diff: execFileSync('git', ['diff', '--stat'], { encoding: 'utf8' }),
        theme, size, state, baseline,
        viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio })),
        visiblePortion: state === 'fuoco-parametro' ? 'Parametro focalizzato, scroll mirato; solo viewport' : state === 'vuoto' ? 'Stato vuoto, scroll mirato; solo viewport' : 'Solo viewport; controlli fuori immagine non attestati',
        actualTheme: await page.evaluate(() => ({ classes: document.documentElement.className,
            surface: getComputedStyle(document.documentElement).getPropertyValue('--lume-surface-focal').trim() })),
        text: await section(page).innerText(),
    }, null, 2));
    await test.info().attach(name, { path: png, contentType: 'image/png' });
}

for (const count of [0, 1, 8]) test(`Misure: titolo unico e creazione stabile con ${count} righe`, async ({ page }) => {
    await fixture(page, count);
    const heading = section(page).locator('[data-section-header]');
    await expect(heading.getByRole('heading')).toContainText(`${count} ${count === 1 ? 'misura' : 'misure'}`);
    await expect(heading.getByRole('button', { name: 'Nuova misura', exact: true })).toBeVisible();
    await expect(register(page).getByRole('heading', { level: 2 })).toHaveCount(0);
    await expect(creation(page)).toHaveCount(1);
    if (count) {
        await expect(history(page).locator('tbody tr')).toHaveCount(Math.min(count, 5));
        if (count > 5) {
            await history(page).getByRole('button', { name: `Tutte (${count})`, exact: true }).click();
            await expect(history(page).locator('tbody tr')).toHaveCount(count);
            await register(page).getByRole('button', { name: 'Per data', exact: true }).click();
            await expect(register(page).locator('tbody tr')).toHaveCount(count);
            await register(page).getByRole('button', { name: 'Per parametro', exact: true }).click();
        }
    } else await expect(register(page).getByRole('status')).toHaveText('Nessuna misura registrata.');
});

for (const state of ['loading', 'error', 'denied'] as const) test(`Misure: lettura ${state} non è vuoto`, async ({ page }) => {
    const id = await fixture(page, 0);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let replies = 0;
    await page.route('**/api/observations?**', async route => {
        if (state === 'loading') await pending;
        await route.fulfill({ status: state === 'error' ? 500 : state === 'denied' ? 403 : 200,
            json: state === 'loading' ? [] : { error: 'Synthetic read failure' } });
        replies++;
    });
    try {
        const requested = page.waitForRequest(request => request.method() === 'GET'
            && request.url().includes(`/api/observations?patientId=${id}`));
        await page.reload();
        const readRequest = await requested;
        await test.info().attach('richiesta-lettura-osservata', { contentType: 'application/json',
            body: JSON.stringify({ method: readRequest.method(), url: readRequest.url(), state }) });
        if (state !== 'loading') await expect.poll(() => replies).toBeGreaterThan(0);
        if (state === 'denied') {
            await expect(page.getByLabel('MediFlow lock screen')).toBeVisible();
            await expect(register(page)).toHaveCount(0);
        } else {
            await openPatientSection(page, 'parametri');
            await expect(register(page).getByRole(state === 'error' ? 'alert' : 'status')).toContainText(state === 'error' ? 'Impossibile leggere le misure' : 'Lettura delle misure in corso');
            await expect(section(page).getByRole('heading')).not.toContainText('0 misure');
            await expect(register(page)).not.toContainText('Nessuna misura');
            await expect(register(page).locator('table')).toHaveCount(0);
            if (state === 'loading') { release(); await expect(register(page)).toContainText('Nessuna misura registrata.'); }
            else {
                await page.unroute('**/api/observations?**');
                await register(page).getByRole('button', { name: 'Riprova la lettura', exact: true }).click();
                await expect(register(page)).toContainText('Nessuna misura registrata.');
                await expect(section(page).getByRole('heading')).toContainText('0 misure');
            }
        }
    } finally { release(); }
});

test('Misure: chiusura e ripresa conservano bozza, select e data; invio usa il paziente corrente', async ({ page }) => {
    const id = await fixture(page, 0);
    await creation(page).click();
    const form = register(page).locator('form');
    const parameter = form.getByRole('combobox', { name: 'Parametro', exact: true });
    await expect(parameter).toBeFocused();
    await expect(page.locator('.mf-button-primary:visible, .ui-btn-primary:visible')).toHaveCount(1);
    await parameter.selectOption('2339-0');
    await form.getByLabel('Valore', { exact: true }).fill('95,5');
    await form.getByLabel('Data e ora').fill('2026-10-12T09:30');
    await form.getByLabel('Note (opzionale)').fill('Bozza sintetica W11');
    const node = await form.getByLabel('Valore', { exact: true }).elementHandle();
    await form.getByRole('button', { name: 'Annulla', exact: true }).click();
    await expect(form).toBeHidden();
    await expect(creation(page)).toBeFocused();
    await creation(page).press('Enter');
    await expect(parameter).toBeFocused();
    await expect(form.getByLabel('Valore', { exact: true })).toHaveValue('95,5');
    expect(await node!.evaluate(element => element.isConnected)).toBe(true);
    await openPatientSection(page, 'terapie');
    await openPatientSection(page, 'parametri');
    await expect(form.getByLabel('Data e ora')).toHaveValue('2026-10-12T09:30');
    const write = page.waitForRequest(request => request.url().endsWith('/api/observations') && request.method() === 'POST');
    await form.getByRole('button', { name: 'Registra parametro', exact: true }).click();
    const body = (await write).postDataJSON();
    await test.info().attach('scrittura-misura-osservata', { contentType: 'application/json', body: JSON.stringify(body) });
    expect(body).toMatchObject({ patientId: id, code: '2339-0', unitCode: 'mg/dL', value: 95.5, source: 'manual' });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(register(page).getByRole('cell', { name: '95.5 mg/dL', exact: true })).toBeVisible();
    await register(page).getByRole('button', { name: 'Glicemia', exact: true }).click();
    await expect(history(page)).toContainText('95.5');
    await expect(form.getByLabel('Valore', { exact: true })).toHaveValue('');
});

test('Misure: menu tastiera e conferma annullata non eliminano record', async ({ page }) => {
    await fixture(page);
    let deletes = 0;
    page.on('request', request => { if (request.method() === 'DELETE' && request.url().includes('/api/observations')) deletes++; });
    const trigger = history(page).getByRole('button', { name: /^Azioni misura/ }).first();
    await trigger.focus();
    await trigger.press('ArrowDown');
    const menu = page.getByRole('menu', { name: /^Azioni misura/ });
    await expect(menu.getByRole('menuitem', { name: 'Elimina misura', exact: true })).toBeFocused();
    await menu.press('Escape');
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await menu.getByRole('menuitem', { name: 'Elimina misura', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Eliminare questa misura?', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Annulla', exact: true }).click();
    await expect(trigger).toBeFocused();
    await expect(history(page).locator('tbody tr')).toHaveCount(1);
    expect(deletes).toBe(0);
});

for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '320', '390', 'zoom-200', 'zoom-400']) {
    test(`cattura Misure ${theme} ${size}`, async ({ page, baseURL }) => {
        const zoom = size.startsWith('zoom-') ? await openBrowserZoomFixture(baseURL!) : undefined;
        try {
            if (zoom) page = zoom.page;
            await page.setViewportSize({ width: zoom ? 1440 : Number(size), height: 1000 });
            const id = await fixture(page, 8);
            await page.evaluate(theme => {
                document.documentElement.classList.toggle('dark', theme === 'grafite');
                document.documentElement.classList.toggle('light', theme === 'giorno');
            }, theme);
            if (zoom) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
            await expect(history(page).locator('tbody tr')).toHaveCount(5);
            await capture(page, 'registro', theme, size);
            if (!baseline && size === '320') {
                await register(page).getByRole('button', { name: 'Per data', exact: true }).click();
                await expect(register(page).locator('tbody tr')).toHaveCount(8);
                await capture(page, 'per-data', theme, size);
                await assertNoHorizontalOverflow(page, [{ label: 'Misure per data', selector: '#parametri' }]);
                await register(page).getByRole('button', { name: 'Per parametro', exact: true }).click();
            }
            await creation(page).click();
            await register(page).getByLabel('Valore', { exact: true }).fill('127');
            await capture(page, 'form', theme, size);
            if (!baseline && zoom) {
                const parameter = register(page).getByRole('combobox', { name: 'Parametro', exact: true });
                await parameter.focus();
                await expect(parameter).toBeFocused();
                await capture(page, 'fuoco-parametro', theme, size);
                await assertNotClippedInViewport(parameter, 'Parametro focalizzato');
            }
            if (baseline) await creation(page).click();
            else await register(page).getByRole('button', { name: 'Annulla', exact: true }).click();
            if (baseline) await history(page).getByRole('button', { name: /^Elimina misura/ }).first().click();
            else {
                await history(page).getByRole('button', { name: /^Azioni misura/ }).first().click();
                await assertNotClippedInViewport(page.getByRole('menu', { name: /^Azioni misura/ }), 'Menu misura');
                await capture(page, 'menu', theme, size);
                await page.getByRole('menuitem', { name: 'Elimina misura', exact: true }).click();
            }
            await capture(page, 'conferma', theme, size);
            await page.getByRole('dialog', { name: 'Eliminare questa misura?', exact: true }).getByRole('button', { name: 'Annulla', exact: true }).click();
            if (!baseline) {
                const geometry = await section(page).evaluate(element => {
                    const table = element.querySelector('aside table')!;
                    const cell = table.querySelector('tbody tr td:last-child')!;
                    const button = cell.querySelector('button')!;
                    const box = (node: Element) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
                    return { section: { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, ...box(element) },
                        table: box(table), cell: { ...box(cell), paddingLeft: getComputedStyle(cell).paddingLeft }, button: box(button) };
                });
                await test.info().attach('geometria-misure', { contentType: 'application/json', body: JSON.stringify(geometry) });
                await assertNoHorizontalOverflow(page, [{ label: 'Misure', selector: '#parametri' }, { label: 'Pagina', selector: 'document' }]);
            }
            await page.route('**/api/observations?**', route => route.fulfill({ json: [] }));
            await page.goto(`/patients/${id}/modules`);
            await openPatientSection(page, 'parametri');
            await expect(register(page)).toContainText('Nessun');
            await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
            await expect(page.locator('html')).toHaveClass(theme === 'grafite' ? /dark/ : /light/);
            await capture(page, 'vuoto', theme, size);
        } finally { await zoom?.close(); }
    });
}
